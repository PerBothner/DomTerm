#include "server.h"

#include <sys/mman.h>
#include <junzip.h>
#include <zlib.h>

struct mem_file {
    char* filename;
    JZFileHeader info;
};

struct junzip_mem_handle {
    JZFile handle;
    char *start;
    off_t length;
    int fd;
    long position;
    JZEndRecord endRecord;
    int numEntries;
    struct mem_file *entries;
};

struct open_mem_file {
    struct junzip_mem_handle *handle;
    int index; // in handle->entries table
    char *data;
    long length;
    long position;
};
#define MAX_OPEN_MEM_FILES 32
struct open_mem_file open_mem_files[MAX_OPEN_MEM_FILES];
#define lws_filefd_to_mem_file(FD) \
  ((FD) >= 1000 ? &open_mem_files[(FD)-1000] : NULL)
#define mem_file_to_lws_filefd(MEM) (((MEM)-&open_mem_files[0])+1000)

struct lws_plat_file_ops fops_plat;

struct junzip_mem_handle junzip_handler;

static size_t junzip_mem_read(JZFile *file, void *buf, size_t size)
{
    struct junzip_mem_handle *handle = (struct junzip_mem_handle *) file;
    size_t avail = handle->length - handle->position;
    if (size > avail)
        size = avail;
    memcpy(buf, handle->start + handle->position, size);
    handle->position += size;
    return size;
}

static size_t
junzip_mem_tell(JZFile *file)
{
    struct junzip_mem_handle *handle = (struct junzip_mem_handle *) file;
    return handle->position;
}

static int
junzip_mem_seek(JZFile *file, size_t offset, int whence)
{
    struct junzip_mem_handle *handle = (struct junzip_mem_handle *) file;
    int new_position = -1;
    switch (whence) {
    case SEEK_CUR:      new_position = handle->position + offset; break;
    case SEEK_END:      new_position = handle->length + offset; break;
    case SEEK_SET:      new_position = offset; break;
    default: ;
    }
    if (new_position < 0 || new_position > handle->length) {
        errno = EINVAL; return -1;
    }
    handle->position = new_position;
    return 0;
}

static int
junzip_mem_error(JZFile *file)
{
    return 0;
}

static void
junzip_mem_close(JZFile *file)
{
    struct junzip_mem_handle *handle = (struct junzip_mem_handle *) file;
    munmap(handle->start, handle->length);
    close(handle->fd);
}

JZFile *
init_junzip_handle(struct junzip_mem_handle *handle,
                        char *start, off_t length, int fd)
{
    handle->start = start;
    handle->length = length;
    handle->fd = fd;
    handle->position = 0;
    handle->handle.read = junzip_mem_read;
    handle->handle.tell = junzip_mem_tell;
    handle->handle.seek = junzip_mem_seek;
    handle->handle.error = junzip_mem_error;
    handle->handle.close = junzip_mem_close;
    return &handle->handle;
}

static int zipRecordCallback(JZFile *zip, int idx, JZFileHeader *header, char *filename, void *user_data) {
    struct junzip_mem_handle *handle = (struct junzip_mem_handle *) zip;
    int flen = strlen(filename);
    char *tmp = xmalloc(flen+1);
    memcpy(tmp, filename, flen+1);
    filename = tmp;
    handle->entries[idx].filename = filename;
    handle->entries[idx].info = *header;
    return 1;
}

static char domterm_resource_prefix[] = "domterm:/";

static lws_filefd_type
domserver_fops_open(struct lws *wsi, const char *filename,
                    unsigned long *filelen,
#ifdef LWS_FOP_FLAG_COMPR_ACCEPTABLE_GZIP
                    int *flags
#else
                    int flags
#endif
                    )
{
    lws_filefd_type n;
    if (strncmp(filename, domterm_resource_prefix,
                sizeof(domterm_resource_prefix)-1) == 0) {
        int numEntries = junzip_handler.numEntries;
        const char *entry_name = filename+sizeof(domterm_resource_prefix)-1;
        JZFile *zip = &junzip_handler.handle;
        for (int i = 0; i < numEntries; i++) {
            struct mem_file* entry = &junzip_handler.entries[i];
            if (strcmp(entry->filename, entry_name) == 0) {
                uint32_t uncompressedSize = entry->info.uncompressedSize;
                int j = MAX_OPEN_MEM_FILES;
                struct open_mem_file *mem;
                for (;;) {
                    if (--j == 0) {
                        errno = EMFILE;
                        return LWS_INVALID_FILE;
                    }
                    mem = &open_mem_files[j];
                    if (mem->handle == NULL)
                        break;
                }
                mem->handle = &junzip_handler;
                mem->index = i;
                mem->position = 0;
                size_t offset = entry->info.offset;
                offset += sizeof(JZLocalFileHeader);
                offset += entry->info.fileNameLength
                  + entry->info.extraFieldLength;
                unsigned long rsize;
                int sentCompressed = 0;
#ifdef LWS_FOP_FLAG_COMPR_ACCEPTABLE_GZIP
                if ((*flags & LWS_FOP_FLAG_COMPR_ACCEPTABLE_GZIP) != 0
                    && entry->info.compressionMethod == 8) {
                    uint32_t compressedSize = entry->info.compressedSize;
                    sentCompressed = 1;
                    rsize = 18 + compressedSize;
                    char *data = xmalloc(rsize);
                    mem->data = data;
                    unsigned char *ptr = data;
                    // write 10-bytes header FIXME
                    *ptr++ = 31; *ptr++ = 139; // ID1, ID2
                    *ptr++ = 8; // Compression Method Deflate
                    *ptr++ = 0; // Flags
                    for (int k = 4; --k >= 0; ) *ptr++ = 0; // MTIME = 0
                    *ptr++ = 0; // Extra Flags. should get from generalPurposeBitFlag
                    *ptr++ = 3; // OS=Unix.  Could use versionMadeBy
                    memcpy(ptr, junzip_handler.start + offset, compressedSize);
                    ptr += compressedSize;
                    // write 8-byte footer
                    uint32_t val = entry->info.crc32;
                    for (int k = 4; --k >= 0; ) {
                      *ptr++ = val & 0xFF; val >>= 8;
                    }
                    val = uncompressedSize;
                    for (int k = 4; --k >= 0; ) {
                      *ptr++ = val & 0xFF; val >>= 8;
                    }
                    *flags |= LWS_FOP_FLAG_COMPR_IS_GZIP;
                }
#endif
                if (! sentCompressed) {
                    junzip_mem_seek(zip, offset, SEEK_SET);
                    rsize = uncompressedSize;
                    char *data = xmalloc(rsize);
                    mem->data = data;
                    if (jzReadData(&junzip_handler.handle,
                                   &entry->info, data) != Z_OK) {
                      fprintf(stderr, "Couldn't read file data!");
                      free(data);
                      return -1;
                    }
                }
                mem->length = rsize;
                *filelen = rsize;
                return mem_file_to_lws_filefd(mem);
            }
        }
        errno = EMFILE;
        return LWS_INVALID_FILE;
    }

    /* call through to original platform implementation */
    return  fops_plat.open(wsi, filename, filelen, flags);
}

static int
domserver_fops_close(struct lws *wsi, lws_filefd_type fd)
{
    struct open_mem_file *mem = lws_filefd_to_mem_file(fd);
    if (mem != NULL) {
        mem->handle = NULL;
        free(mem->data);
        mem->data = NULL;
        mem->length = 0;
        mem->index = 0;
        return 0;
    }
    return fops_plat.close(wsi, fd);
}

static unsigned long
domserver_fops_seek_cur(struct lws *wsi, lws_filefd_type fd,
                        long offset_from_cur_pos)
{
    struct open_mem_file *mem = lws_filefd_to_mem_file(fd);
    if (mem != NULL) {
        long new_position = mem->position + offset_from_cur_pos;
        if (new_position < 0 || new_position > mem->length)
            return (off_t) (-1);
        mem->position = new_position;
        return new_position;
    }
    return fops_plat.seek_cur(wsi, fd, offset_from_cur_pos);
}

static int
domserver_fops_read(struct lws *wsi, lws_filefd_type fd, unsigned long *amount,
                    unsigned char *buf, unsigned long len)
{
    struct open_mem_file *mem = lws_filefd_to_mem_file(fd);
    if (mem != NULL) {
       unsigned long avail = mem->length - mem->position;
       if (len > avail)
          len = avail;
       memcpy(buf, mem->data + mem->position, len);
       mem->position += len;
       *amount = len;
       return 0;
    }
    return fops_plat.read(wsi, fd, amount, buf, len);
}

void
initialize_resource_map(struct lws_context *context,
                        const char *domterm_jar_path)
{
    int open_mode = O_RDONLY;
    struct stat statbuf;
#if O_CLOEXEC
    open_mode |= O_CLOEXEC;
#endif
    int fd = open(domterm_jar_path, open_mode);
    if (fd < 0 || fstat(fd, &statbuf) != 0) {
        fprintf(stderr, "domterm: failed to open '%s'\n", domterm_jar_path);
        exit(-1);
    }
    off_t jarsize = statbuf.st_size;
    void *jardata = mmap(NULL, jarsize, PROT_READ, MAP_PRIVATE, fd, 0);
    if (jardata == MAP_FAILED) {
        fprintf(stderr, "domterm: failed to map '%s'\n", domterm_jar_path);
        exit(-1);
    }
    struct junzip_mem_handle *mzip = &junzip_handler;
    JZFile *zip = init_junzip_handle(mzip, jardata, jarsize, fd);

    if(jzReadEndRecord(zip, &mzip->endRecord)) {
        fprintf(stderr, "Couldn't read ZIP file end record.");
        exit(-1);
    }
    int numEntries = mzip->endRecord.numEntries;
    mzip->numEntries = numEntries;
    mzip->entries = xmalloc(numEntries * sizeof(struct mem_file));
    if(jzReadCentralDirectory(zip, &mzip->endRecord, zipRecordCallback, NULL)) {
        printf("Couldn't read ZIP file central record.");
    }

    /* stash original platform fops */
    fops_plat = *(lws_get_fops(context));
    /* override the active fops */
    lws_get_fops(context)->open = domserver_fops_open;
    lws_get_fops(context)->close = domserver_fops_close;
    lws_get_fops(context)->seek_cur = domserver_fops_seek_cur;
    lws_get_fops(context)->read = domserver_fops_read;
}

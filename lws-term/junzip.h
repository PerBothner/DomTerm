/**
 * JUnzip library by Joonas Pihlajamaa (firstname.lastname@iki.fi).
 * Released into public domain. https://github.com/jokkebk/JUnzip
 */

#ifndef __JUNZIP_H
#define __JUNZIP_H

#ifdef __cplusplus
extern "C" {
#endif /* __cplusplus */

#include <stdint.h>

// If you don't have stdint.h, the following two lines should work for most 32/64 bit systems
// typedef unsigned int uint32_t;
// typedef unsigned short uint16_t;

typedef struct JZFile JZFile;

struct JZFile {
    unsigned char *start;
    off_t length;
    long position;
    int numEntries;
    uint32_t centralDirectoryOffset;
};

#define zf_tell(ZF) ((ZF)->position)
#define zf_available(ZF) ((ZF)->length - (ZF)->position)
#define zf_current(ZF) ((ZF)->start + (ZF)->position)
extern size_t zf_read(JZFile *zfile, void *buf, size_t size);
extern int zf_seek_set(JZFile *zfile, size_t offset);
extern int zf_seek_cur(JZFile *zfile, size_t offset);
extern int zf_seek_end(JZFile *zfile, size_t offset);
#define get_u16(PTR) ((PTR)[0] | ((PTR)[1] << 8))
#define get_u32(PTR) ((PTR)[0] | ((PTR)[1]<<8) | ((PTR)[2]<<16) | ((PTR)[3]<<24))

#define ZIP_LOCAL_FILE_HEADER_LENGTH 30

#define ZIP_CENTRAL_SIGNATURE 0
#define ZIP_CENTRAL_VERSION_MADE_BY 4
#define ZIP_CENTRAL_VERSION_NEEDED_TO_EXTRACT 6
#define ZIP_CENTRAL_GENERAL_PURPOSE_BIT_FLAG 8
#define ZIP_CENTRAL_COMPRESSION_METHOD 10
#define ZIP_CENTRAL_LAST_MOD_FILE_TIME 12
#define ZIP_CENTRAL_LAST_MOD_FILE_DATE 14
#define ZIP_CENTRAL_CRC32 16
#define ZIP_CENTRAL_COMPRESSED_SIZE 20
#define ZIP_CENTRAL_UNCOMPRESSED_SIZE 24
#define ZIP_CENTRAL_FILE_NAME_LENGTH 28
#define ZIP_CENTRAL_EXTRA_FIELD_LENGTH 30
#define ZIP_CENTRAL_FILE_COMMENT_LENGTH 32
#define ZIP_CENTRAL_DISK_NUMBER_START 34
#define ZIP_CENTRAL_INTERNAL_FILE_ATTRIBUTES 36
#define ZIP_CENTRAL_EXTERNAL_FILE_ATTRIBUTES 38
#define ZIP_CENTRAL_RELATIVE_OFFSET_OF_LOCAL_HEADER 42
#define ZIP_CENTRAL_DIRECTORY_LENGTH 46

typedef struct {
    uint16_t compressionMethod;
    uint32_t crc32;
    uint32_t compressedSize;
    uint32_t uncompressedSize;
    long fileNameStart;
    uint16_t fileNameLength;
    uint16_t extraFieldLength; // unsupported
    uint32_t offset;
} JZFileHeader;

#define ZIP_END_SIGNATURE_OFFSET 0
#define ZIP_END_DESK_NUMBER 4
#define ZIP_END_CENTRAL_DIRECTORY_DISK_NUMBER 6
#define ZIP_END_NUM_ENTRIES_THIS_DISK 8
#define ZIP_END_NUM_ENTRIES 10
#define ZIP_END_CENTRAL_DIRECTORY_SIZE 12
#define ZIP_END_CENTRAL_DIRECTORY_OFFSET 16
#define ZIP_END_ZIP_COMMENT_LENGTH 20
#define ZIP_END_DIRECTORY_LENGTH 22

// Callback prototype for central and local file record reading functions
typedef int (*JZRecordCallback)(JZFile *zip, int index, JZFileHeader *header);

// Read ZIP file end record. Will move within file.
int jzReadEndRecord(JZFile *zip);

// Read ZIP file global directory. Will move within file.
// Callback is called for each record, until callback returns zero
int jzReadCentralDirectory(JZFile *zip, JZRecordCallback callback);

// Read data from file stream, described by header, to preallocated buffer
// Return value is zlib coded, e.g. Z_OK, or error code
int jzReadData(JZFile *zip, JZFileHeader *header, void *buffer);

#ifdef __cplusplus
};
#endif /* __cplusplus */

#endif

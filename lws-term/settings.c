#include "server.h"
#include <stdlib.h>
#include <unistd.h>
#include <sys/inotify.h>
#include <sys/mman.h>

static int inotify_fd;
char*settings_fname = NULL;
static struct json_object *settings_json_object = NULL;
const char *settings_as_json;

int
callback_inotify(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
  //struct cmd_client *cclient = (struct cmd_client *) user;
    char buf[sizeof(struct inotify_event) + NAME_MAX + 1];
    switch (reason) {
      case LWS_CALLBACK_RAW_RX_FILE: {
        ssize_t n = read(inotify_fd, buf, sizeof(buf));
        read_settings_file(main_options);
        break;
      }
      default:
      //fprintf(stderr, "callback_inotify default reason:%d\n", (int) reason);
        break;
    }

    return 0;
}

void
read_settings_file(struct options *options)
{
    if (settings_json_object != NULL)
        json_object_put(settings_json_object);
    struct json_object *jobj = json_object_new_object();
    settings_json_object = jobj;
    const char *ddir = domterm_dir();
    settings_fname = xmalloc(strlen(ddir) + 40);
    sprintf(settings_fname, "%s/settings.ini", ddir);
    //notify_add_watch(inotify_fd, settings_fname, IN_MODIFY);
    int settings_fd = open(settings_fname, O_RDONLY);
    struct stat stbuf;
    if (settings_fd == -1
        || fstat(settings_fd, &stbuf) != 0 || !S_ISREG(stbuf.st_mode)) {
        return;
    }
    off_t slen = stbuf.st_size;
    unsigned char *sbuf = mmap(NULL, slen, PROT_READ|PROT_WRITE, MAP_PRIVATE,
                               settings_fd, 0);
    unsigned char *send = sbuf + slen;
    unsigned char *sptr = sbuf;
    for (;;) {
    next:
        if (sptr == send)
          goto eof;
        unsigned ch = *sptr;
        if (ch == '#') {
          for (;;) {
            if (sptr == send)
              goto eof;
            ch = *sptr++;
            if (ch == '\r' ||ch == '\n')
              goto next;
          }
        }
        unsigned char *sline = sptr;
        while (ch == ' ' || ch == '\t') {
            ++sptr;
            if (sptr == send)
              goto eof;
            ch = *sptr;
        }
        if (ch == '\r' || ch == '\n') {
          sptr++;
          goto next;
        }
        //if (sptr != sline)
        //  goto err;
        unsigned char *key_start = sptr;
        unsigned char *key_end = NULL;

        for (;;) {
            if ((ch == '=' || ch == ' ' || ch == '\t') && key_end == NULL)
                key_end = sptr;
            if (ch == '=')
              break;
            if (ch == '\r' || ch == '\n')
                goto err;
            ++sptr;
            if (sptr == send)
              goto err;
            ch = *sptr;
        }
        sptr++; // skip '='
        while (sptr < send && (*sptr == ' ' || *sptr == '\t'))
          sptr++;
        unsigned char *value_start = sptr;
        while (sptr < send && *sptr != '\r' && *sptr != '\n')
          sptr++;
        unsigned char*value_end = sptr;
        if (sptr < send)
          sptr++;
        if (value_start == value_end) {
          while (sptr + 2 < send && sptr[0] == ' ' && sptr[1] == '|') {
            sptr += 2;
            while (sptr < send && *sptr != '\r' && *sptr != '\n')
              sptr++;
            if (sptr < send)
              sptr++;
          }
          unsigned char *psrc = value_start;
          unsigned char *pdst = value_start;
          while (psrc < sptr) {
            unsigned ch = *psrc++;
            *pdst++ = ch;
            if (ch == '\n' && psrc[0] == ' ' && psrc[1] == '|') {
              if (psrc-1 == value_start)
                pdst--;
              psrc += 2;
            }
          }
          value_end = pdst;
        }
        *key_end = '\0';
        size_t value_length = value_end-value_start;

        if (strcmp(key_start, "window.geometry") == 0) {
            if (options->geometry != NULL)
                free(options->geometry);
            options->geometry = xmalloc(value_length+1);
            memcpy(options->geometry, value_start, value_length);
            options->geometry[value_length] = '\0';
        }
        json_object_object_add(jobj, key_start,
                json_object_new_string_len(value_start, value_length));
    }
 err:
    fprintf(stderr, "error in %s at byte offset %d\n",
            settings_fname, sptr - sbuf);
 eof:
    munmap(sbuf, slen);
    close(settings_fd);
    settings_as_json = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN);
    request_upload_settings();
}

void
watch_settings_file()
{
    inotify_fd = inotify_init();
    inotify_add_watch(inotify_fd, settings_fname, IN_MODIFY);
    lws_sock_file_fd_type ifd;
    ifd.filefd = inotify_fd;
    lws_adopt_descriptor_vhost(vhost, 0, ifd, "inotify", NULL);
}

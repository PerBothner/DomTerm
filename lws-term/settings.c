#include "server.h"
#include <stdlib.h>
#include <unistd.h>
#include <limits.h>
#if HAVE_INOTIFY
#include <sys/inotify.h>
#endif
#include <sys/mman.h>
#ifndef NAME_MAX
#define NAME_MAX 1024
#endif

char* settings_fname = NULL;
static struct json_object *settings_json_object = NULL;
const char *settings_as_json;
int64_t settings_counter = 0;

#if HAVE_INOTIFY
static int inotify_fd;
int
callback_inotify(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
  //struct cmd_client *cclient = (struct cmd_client *) user;
    char buf[sizeof(struct inotify_event) + NAME_MAX + 1];
    switch (reason) {
    case LWS_CALLBACK_RAW_RX_FILE: {
         if (read(inotify_fd, buf, sizeof buf) > 0)
              read_settings_file(main_options);
         break;
    }
    default:
      //fprintf(stderr, "callback_inotify default reason:%d\n", (int) reason);
        break;
    }

    return 0;
}
#endif

void
read_settings_file(struct options *options)
{
    if (settings_json_object != NULL)
        json_object_put(settings_json_object);
    struct json_object *jobj = json_object_new_object();
    settings_json_object = jobj;
    if (settings_fname == NULL) {
        if (options->settings_file != NULL)
            settings_fname = options->settings_file;
        else {
            const char *ddir = domterm_settings_dir();
            settings_fname = xmalloc(strlen(ddir) + 40);
            sprintf(settings_fname, "%s/settings.ini", ddir);
        }
    }
    int settings_fd = open(settings_fname, O_RDONLY);
    struct stat stbuf;
    if (settings_fd == -1
        || fstat(settings_fd, &stbuf) != 0 || !S_ISREG(stbuf.st_mode)) {
        return;
    }
    json_object_object_add(jobj, "##",
                           json_object_new_int(++settings_counter));

    off_t slen = stbuf.st_size;
    char *sbuf = mmap(NULL, slen, PROT_READ|PROT_WRITE, MAP_PRIVATE,
                      settings_fd, 0);
    char *send = sbuf + slen;
    char *sptr = sbuf;

#define CLEAR_FIELD(FIELD)       \
    if (options->FIELD) {        \
        free(options->FIELD);    \
        options->FIELD = NULL;   \
    }
    CLEAR_FIELD(geometry);
    CLEAR_FIELD(openfile_application);
    CLEAR_FIELD(openlink_application);
    CLEAR_FIELD(shell_command);
    CLEAR_FIELD(command_firefox);
    CLEAR_FIELD(command_chrome);
    CLEAR_FIELD(command_electron);
    CLEAR_FIELD(default_frontend);

    char *emsg = "";
    for (;;) {
    next:
        if (sptr == send)
            goto eof;
        char ch = *sptr;
        if (ch == '#') {
          for (;;) {
            if (sptr == send)
                goto eof;
            ch = *sptr++;
            if (ch == '\r' ||ch == '\n')
              goto next;
          }
        }
        //char *sline = sptr;
        while (ch == ' ' || ch == '\t') {
            ++sptr;
            if (sptr == send)
              goto eof;
            ch = *sptr;
        }
        if (ch == '|') {
            emsg = "\n(continuation marker '|' must follow a single space)";
            goto err;
        }
        if (ch == '\r' || ch == '\n') {
          sptr++;
          goto next;
        }
        //if (sptr != sline)
        //  goto err;
        char *key_start = sptr;
        char *key_end = NULL;

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
        char *value_start = sptr;
        while (sptr < send && *sptr != '\r' && *sptr != '\n')
          sptr++;
        char*value_end = sptr;
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
          char *psrc = value_start;
          char *pdst = value_start;
          while (psrc < sptr) {
            char ch = *psrc++;
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

#define HANDLE_SETTING(NAME, FIELD)                           \
        if (strcmp(key_start, NAME) == 0) {                   \
            options->FIELD = xmalloc(value_length+1);         \
            memcpy(options->FIELD, value_start, value_length);\
            options->FIELD[value_length] = '\0';              \
        }

        HANDLE_SETTING("window.geometry", geometry);
        HANDLE_SETTING("open.file.application", openfile_application);
        HANDLE_SETTING("open.link.application", openlink_application);

        HANDLE_SETTING("shell.default", shell_command);
        HANDLE_SETTING("command.firefox", command_firefox);
        HANDLE_SETTING("command.chrome", command_chrome);
        HANDLE_SETTING("command.electron", command_electron);
        HANDLE_SETTING("frontend.default", default_frontend);

        json_object_object_add(jobj, key_start,
                json_object_new_string_len(value_start, value_length));
    }
 err:
    fprintf(stderr, "error in %s at byte offset %ld%s\n",
            settings_fname, (long) (sptr - sbuf), emsg);
 eof:
    if (options->shell_argv)
        free(options->shell_argv);
    options->shell_argv = parse_args(options->shell_command);

    munmap(sbuf, slen);
    close(settings_fd);
    settings_as_json = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN);
    request_upload_settings();
}

void
watch_settings_file()
{
#if HAVE_INOTIFY
    inotify_fd = inotify_init();
    inotify_add_watch(inotify_fd, settings_fname, IN_MODIFY);
    lws_sock_file_fd_type ifd;
    ifd.filefd = inotify_fd;
    lws_adopt_descriptor_vhost(vhost, 0, ifd, "inotify", NULL);
#endif
}

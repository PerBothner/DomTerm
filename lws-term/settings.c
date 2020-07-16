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

const char* settings_fname = NULL;
struct json_object *settings_json_object = NULL;
const char *settings_as_json; // JSON of settings_json_object
int64_t settings_counter = 0;

struct optinfo { enum option_name name; const char *str; };

static struct optinfo options[] = {
#undef OPTION_S
#undef OPTION_F
#define OPTION_S(NAME, STR) { NAME##_opt, STR },
#define OPTION_F(NAME, STR) { NAME##_opt, STR },
#include "option-names.h"
#undef OPTION_S
#undef OPTION_F
    { NO_opt, NULL },
};

enum option_name
lookup_option(const char *name)
{
    struct optinfo *p = options;
    for (; p->str; p++) {
        if (strcmp(name, p->str) == 0)
            return p->name;
    }
    return NO_opt;
}

void
set_setting(struct json_object **settings, const char *key, const char *value)
{
    if (*settings == NULL)
        *settings = json_object_new_object();
    json_object_object_add(*settings, key,
                           json_object_new_string(value));
}

const char *
get_setting(struct json_object *settings, const char *key)
{
    struct json_object *value;
    if (settings != NULL
        && json_object_object_get_ex(settings, key, &value))
        return json_object_get_string(value);
    else
        return NULL;
}

bool
check_option_arg(char *arg, struct options *opts)
{
    char *eq = strchr(arg, '=');
    if (eq == NULL)
        return false;
    size_t klen = eq-arg;
    char *key = xmalloc(klen+1);
    memcpy(key, arg, klen);
    key[klen] = '\0';
    enum option_name opt = lookup_option(key);
    if (opt == NO_opt)
        printf_error(opts, "unknown option '%s'", key);
    set_setting(&opts->cmd_settings, key, eq+1);
    free(key);
    return true;
}

#if HAVE_INOTIFY
static int inotify_fd;
int
callback_inotify(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
  //struct cmd_client *cclient = (struct cmd_client *) user;
    char buf[sizeof(struct inotify_event) + NAME_MAX + 1];
    switch (reason) {
    case LWS_CALLBACK_RAW_RX_FILE: {
        if (read(inotify_fd, buf, sizeof buf) > 0) {
            read_settings_file(main_options, true);
        }
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
read_settings_file(struct options *options, bool re_reading)
{
    if (settings_json_object != NULL)
        json_object_put(settings_json_object);
    struct json_object *jobj = json_object_new_object();
    settings_json_object = jobj;
    if (settings_fname == NULL) {
        if (options->settings_file != NULL)
            settings_fname = options->settings_file;
        else {
            settings_fname = domterm_settings_default();
        }
    }
    int settings_fd = open(settings_fname, O_RDONLY);
    struct stat stbuf;
    bool bad = false;
    char *vmsg =
        re_reading ? "Re-reading settings file" : "Reading settings file";
    if (settings_fd == -1
        || fstat(settings_fd, &stbuf) != 0 || !S_ISREG(stbuf.st_mode)) {
        vmsg = settings_fd == -1 ? "Missing settings file"
            : "Non-readable settings file";
        bad = true;
    }
    lwsl_notice("%s: %s\n", vmsg, settings_fname);
    if (bad)
        return;
    json_object_object_add(jobj, "##",
                           json_object_new_int(++settings_counter));

    off_t slen = stbuf.st_size;
    char *sbuf = mmap(NULL, slen, PROT_READ|PROT_WRITE, MAP_PRIVATE,
                      settings_fd, 0);
    char *send = sbuf + slen;
    char *sptr = sbuf;


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
        *key_end = '\0';
        if (lookup_option(key_start) == NO_opt) {
        fprintf(stderr, "error in %s at byte offset %ld - unknown option '%s'\n",
            settings_fname, (long) (key_start - sbuf), key_start);
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
        size_t value_length = value_end-value_start;

        json_object_object_add(jobj, key_start,
                json_object_new_string_len(value_start, value_length));
    }
 err:
    fprintf(stderr, "error in %s at byte offset %ld%s\n",
            settings_fname, (long) (sptr - sbuf), emsg);
 eof:

    munmap(sbuf, slen);
    close(settings_fd);
    settings_as_json = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN);
    request_upload_settings();
}

struct json_object *
merged_settings(struct json_object *cmd_settings)
{
    struct json_object *jsettings = settings_json_object;
    if (cmd_settings) {
        if (jsettings == NULL)
            return json_object_get(cmd_settings);
        jsettings = NULL;
        json_object_deep_copy(settings_json_object, &jsettings, NULL);
        json_object_object_foreach(cmd_settings, key, val) {
            json_object_object_add(jsettings, key, json_object_get(val));
        }
        return jsettings;
    } else if (jsettings == NULL)
        return json_object_new_object();
    else
        return json_object_get(jsettings);
}

void
set_settings(struct options *options, struct json_object *msettings)
{
#undef OPTION_S
#undef OPTION_F
#define OPTION_S(FIELD, STR) \
    if (options->FIELD) {        \
        free(options->FIELD);    \
        options->FIELD = NULL;   \
    }
#define OPTION_F(NAME, STR) /* nothing */
#include "option-names.h"

    json_object_object_foreach(msettings, key, val) {
#undef OPTION_S
#define OPTION_S(FIELD,NAME)                                  \
        if (strcmp(key, NAME) == 0) {                   \
            const char *vstr = json_object_get_string(val); \
            int vlen = json_object_get_string_len(val); \
            options->FIELD = xmalloc(vlen+1);         \
            memcpy(options->FIELD, vstr, vlen);\
            options->FIELD[vlen] = '\0';              \
        }
#include "option-names.h"
    }
    if (options->shell_argv)
        free(options->shell_argv);
    options->shell_argv = parse_args(options->shell_command, false);
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

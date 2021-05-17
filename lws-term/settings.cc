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

struct optinfo { enum option_name name; const char *str; int flags; };

#define OPTION_MISC_TYPE 0
#define OPTION_NUMBER_TYPE 1
#define OPTION_STRING_TYPE 2
static struct optinfo options[] = {
#undef OPTION_S
#undef OPTION_F
#define OPTION_S(NAME, STR, TYPE) { NAME##_opt, STR, TYPE },
#define OPTION_F(NAME, STR, TYPE) { NAME##_opt, STR, TYPE },
#include "option-names.h"
#undef OPTION_S
#undef OPTION_F
{ NO_opt, NULL, -1 },
};

void print_settings_prefixed(const char *prefix,
                             const char *before, const char *after,
                             FILE *out)
{
    struct optinfo *p = options;
    size_t plen = strlen(prefix);
    for (; p->str; p++) {
        if (strncmp(prefix, p->str, plen) == 0)
            fprintf(out, "%s%s%s", before, p->str, after);
    }
}

struct optinfo*
lookup_optinfo(const char *name)
{
    struct optinfo *p = options;
    for (; p->str; p++) {
        if (strcmp(name, p->str) == 0)
            return p;
    }
    return NULL;
}

enum option_name
lookup_option(const char *name)
{
    struct optinfo *p = lookup_optinfo(name);
    return p ? p->name : NO_opt;
}

void
set_setting_ex(struct json_object **settings,
               const char *key, const char *value,
               struct optinfo *opt, struct options *options)
{
    if (*settings == NULL)
        *settings = json_object_new_object();
    struct json_object *jval = NULL;
    if (opt && (opt->flags & OPTION_NUMBER_TYPE) != 0) {
        double d; int len;
        sscanf(value, " %lg %n", &d, &len);
        if (len != strlen(value))
            printf_error(options, "value for option '%s' is not a number", key);
        else
            jval = json_object_new_double(d);
    } else if (opt && (opt->flags & OPTION_STRING_TYPE) != 0) {
        char *str = parse_string(value, false);
        jval = json_object_new_string(str);
    } else
        jval = json_object_new_string(value);
    if (jval)
        json_object_object_add(*settings, key, jval);
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

double
get_setting_d(struct json_object *settings, const char *key, double dfault)
{
    errno = 0;
    struct json_object *value;
    if (settings == NULL
        || ! json_object_object_get_ex(settings, key, &value))
        return dfault;
    return json_object_get_double(value);
}

bool
check_option_arg(const char *arg, struct options *opts)
{
    // Allow =OPTNAME=OPTVALUE for command-completion.
    if (arg[0] == '=')
        arg++;
    const char *eq = strchr(arg, '=');
    if (eq == NULL)
        return false;
    size_t klen = eq-arg;
    char *key = challoc(klen+1);
    memcpy(key, arg, klen);
    key[klen] = '\0';
    struct optinfo *opt = lookup_optinfo(key);
    if (opt == NULL)
        printf_error(opts, "unknown option '%s'", key);
    else if ((opt->flags & OPTION_NUMBER_TYPE) != 0) {
        const char *val = eq+1;
        double d; int len;
        sscanf(val, " %lg %n", &d, &len);
        if (len != strlen(val))
            printf_error(opts, "value for option '%s' is not a number", key);
    }
    set_setting_ex(&opts->cmd_settings, key, eq+1, opt, opts);
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

static const char *read_settings_message, *read_settings_filename;

// Needs to be called after logging (which depends on settings) is set up.
void
read_settings_emit_notice()
{
    lwsl_notice("%s: %s\n", read_settings_message, read_settings_filename);
}

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
    const char *vmsg =
        re_reading ? "Re-reading settings file" : "Reading settings file";
    if (settings_fd == -1
        || fstat(settings_fd, &stbuf) != 0 || !S_ISREG(stbuf.st_mode)) {
        vmsg = settings_fd == -1 ? "Missing settings file"
            : "Non-readable settings file";
        bad = true;
    }
    read_settings_message = vmsg;
    read_settings_filename = settings_fname;
    if (re_reading)
        read_settings_emit_notice();
    if (bad)
        return;
    json_object_object_add(jobj, "##",
                           json_object_new_int(++settings_counter));

    off_t slen = stbuf.st_size;
    // +1 in case we need to write '\0' at end-of-file
    char *sbuf = (char*) mmap(NULL, slen+1, PROT_READ|PROT_WRITE, MAP_PRIVATE,
                              settings_fd, 0);
    char *send = sbuf + slen;
    char *sptr = sbuf;


    const char *emsg = "";
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
        struct optinfo* opt = lookup_optinfo(key_start);
        if (opt == NULL) {
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
        *value_end = '\0';

        set_setting_ex(&jobj, key_start, value_start, opt, options);
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
#if JSON_C_VERSION_NUM >= ((0 << 16) | (13 << 8))
        jsettings = NULL;
        json_object_deep_copy(settings_json_object, &jsettings, NULL);
#else
	jsettings = json_tokener_parse(json_object_get_string(settings_json_object));
#endif
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
set_settings(struct options *options)
{
#if HAVE_LIBCLIPBOARD
    set_setting(&options->cmd_settings,
                SERVER_FOR_CLIPBOARD, "paste,selection-paste");
#endif
    if (options->settings != NULL)
        json_object_put(options->settings);
    struct json_object *msettings = merged_settings(options->cmd_settings);
    options->settings = msettings;

    if (options->shell_argv)
        free((void*) options->shell_argv);
    options->shell_argv = parse_args(get_setting(options->settings, "shell.default"), false);
    double d = get_setting_d(options->settings, "remote-output-interval", 10.0);
    options->remote_output_interval = (long) (d * 1000);
    double d2 = get_setting_d(options->settings, "remote-output-timeout", -1.0);
    if (d2 < 0)
        d2  = 2 * d;
    options->remote_output_timeout = (long) (d2 * 1000);
    d = get_setting_d(options->settings, "remote-input-timeout", -1.0);
    if (d < 0)
        d  = 2 * get_setting_d(options->settings, "remote-input-interval", 10.0);
    options->remote_input_timeout = (long) (d * 1000);
}

void
watch_settings_file()
{
#if HAVE_INOTIFY
    inotify_fd = inotify_init();
    inotify_add_watch(inotify_fd, settings_fname, IN_MODIFY);
    lws_sock_file_fd_type ifd;
    ifd.filefd = inotify_fd;
    lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC,
                               ifd, "inotify", NULL);
#endif
}

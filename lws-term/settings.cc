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
json settings_json_object;
std::string settings_as_json; // JSON of settings_json_object
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
set_setting_ex(json& settings,
               const char *key, const char *value,
               struct optinfo *opt, struct options *options)
{
    //struct json_object *jval = NULL;
    if (opt && (opt->flags & OPTION_NUMBER_TYPE) != 0) {
        double d; int len;
        sscanf(value, " %lg %n", &d, &len);
        if ((size_t) len != strlen(value))
            printf_error(options, "value for option '%s' is not a number", key);
        else
            settings[key] = d;
    } else if (opt && (opt->flags & OPTION_STRING_TYPE) != 0) {
        settings[key] = parse_string(value, false);
    } else {
        if (strcmp(key, "window-session-type") == 0) {
            if (strcmp(value, "wayland") != 0 && strcmp(value, "x11") != 0) {
                printf_error(options, "value for option '%s' must be 'wayland' or 'x11'", key);
            }
        }
        settings[key] = value;
    }
}

void
set_setting(json& settings, const char *key, const char *value)
{
    settings[key] = value;
}

// WARNING returns freshly malloc'd string
const char *
get_setting(const json& settings, const char *key)
{
    auto it = settings.find(key);
    if (it == settings.end() || ! it->is_string())
        return nullptr;
    std::string str = *it;
    return strdup(str.c_str()); // FIXME!!
    //return std::string(*it).c_str();
}
std::string
get_setting_s(const json& settings, const char *key, const char *dfault)
{
    auto it = settings.find(key);
    return it == settings.end() || ! it->is_string() ? dfault
        : *it;
}

double
get_setting_d(const json& settings, const char *key, double dfault)
{
    errno = 0;
    auto it = settings.find(key);
    if (it == settings.end() || ! it->is_number())
        return dfault;
    return double(*it);
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
        if ((size_t) len != strlen(val))
            printf_error(opts, "value for option '%s' is not a number", key);
    }
    set_setting_ex(opts->cmd_settings, key, eq+1, opt, opts);
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
    settings_json_object = nullptr;
    json& jobj = settings_json_object;
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
    jobj["##"] = ++settings_counter;

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

        set_setting_ex(jobj, key_start, value_start, opt, options);
    }
 err:
    fprintf(stderr, "error in %s at byte offset %ld%s\n",
            settings_fname, (long) (sptr - sbuf), emsg);
 eof:

    munmap(sbuf, slen);
    close(settings_fd);
    settings_as_json = jobj.dump();
    request_upload_settings();
}
void
merge_settings(json& merged, const json& cmd_settings)
{
    if (settings_json_object.is_object()) {
        for (auto& el : settings_json_object.items()) {
            merged[el.key()] = el.value();
        }
    }
    if (cmd_settings.is_object()) {
        for (auto& el : cmd_settings.items()) {
            merged[el.key()] = el.value();
        }
    }
}

void
set_settings(struct options *options)
{
    if (get_clipboard_command("paste")) {
        std::string server_for_clipboard_option = "paste";
        if (get_clipboard_command("selection-paste"))
            server_for_clipboard_option += ",selection-paste";
        set_setting(options->cmd_settings,
                    SERVER_FOR_CLIPBOARD, server_for_clipboard_option.c_str());
    }
    //if (options->settings != NULL)
    //json_object_put(options->settings);
    //options->settings.clear();
    options->settings = nullptr;
    merge_settings(options->settings, options->cmd_settings);

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
#if 0
enum eval_mode {
    WANT_NUMBER = 1,
    WANT_STRING = 2,
    WANT_STRING_LIST = 3
};

json
evaluate_template(json form, eval_mode mode)
{
    return nullptr; // FIXME
}

json
evaluate_operand(json form, json::iterator& position, eval_mode mode)
{
    json result = nullptr;
    for (;;) {
        if (position == form.end())
            return result;;
        json next = *position;
    }
    if (position == form.end())
        return nullptr;
    json next = *position;
    if (next == "'QSTRING") {
    }
    return nullptr; // FIXME
}

json
evaluate_substitution(json form, eval_mode mode)
{
    json::iterator position = form.begin();
    json op = evaluate_operand(form, position, mode);
    eval_mode op_mode = mode; // FIXME
    for (;;) {
        json arg = evaluate_operand(form, position, op_mode);
    }
    return nullptr; // FIXME
}

std::string parse_quoted_string(const char **ptr)
{
    std::string str;
    const char *p = *ptr;
    for (;;) {
        int ch = 0xFF & *p++;
        if (ch == '\\' && *p) {
            ch = get_string_escape(&p);
        }
    }
    *ptr = (const char*) p;
    return str;
}
#if 0
std::string expand_template(const char *template)
{
    const char *p = template;
    for (; *p; p++) {
        char ch = *p;
        if (ch == '\'' || ch == '\"') {
        } else if (ch == '{') {
        }
    }
}
#endif
#endif

#include "server.h"
#include "version.h"
#include <stdlib.h>
#if HAVE_LIBMAGIC
#include <magic.h>
#endif
#include <sys/mman.h>
#include <sys/stat.h>

struct lws;

int is_domterm_action(int argc, char** argv, const char*cwd,
                      char **env, struct lws *wsi,
                      struct options *opts)
{
    return probe_domterm(false) > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}

void
copy_html_file(FILE *in, FILE *out)
{
    fprintf(out, "\033]72;");
    copy_file(in, out);
    fprintf(out, "\007");
    fflush(out);
}

int html_action(int argc, char** argv, const char*cwd,
                      char **env, struct lws *wsi,
                      struct options *opts)
{
    check_domterm(opts);
    int i = 1;
    if (i == argc) {
        FILE *tout = fdopen(get_tty_out(), "w");
        copy_html_file(stdin, tout);
    } else {
        while (i < argc)  {
            char *arg = argv[i++];
            char *response  = xmalloc(strlen(arg)+40);
            sprintf(response, "\033]72;%s\007", arg);
            ssize_t r = write(get_tty_out(), response, strlen(response));
            free(response);
            if (r <= 0) {
                lwsl_err("write failed\n");
                return EXIT_FAILURE;
            }
        }
    }
    return EXIT_SUCCESS;
}

int imgcat_action(int argc, char** argv, const char*cwd,
                  char **env, struct lws *wsi,
                  struct options *opts)
{
    check_domterm(opts);
    FILE *err = fdopen(opts->fd_err, "w");
    int asize = 0;
    for (int i = 1; i < argc; i++) {
        asize += strlen(argv[i]) + 4;
    }
    char *abuf = xmalloc(asize);
    char *aptr = abuf;
    char *overflow = NULL;
    bool n_arg = false;
    for (int i = 1; i < argc; i++) {
        char *arg = argv[i];
        if (arg[0] == '-') {
            char *eq = arg[1] == '-' ? strchr(arg, '=') : NULL;
            int neq = eq ? eq - arg - 1: -1;
            if (neq >= 0
                && (memcmp(arg+2, "width=", neq) == 0
                    || memcmp(arg+2, "height=", neq) == 0
                    || memcmp(arg+2, "border=", neq) == 0
                    || memcmp(arg+2, "align=", neq) == 0
                    || memcmp(arg+2, "vspace=", neq) == 0
                    || memcmp(arg+2, "hspace=", neq) == 0
                    || memcmp(arg+2, "alt=", neq) == 0
                    || memcmp(arg+2, "longdesc=", neq) == 0)) {
              int n = sprintf(aptr, " %.*s'%s'", neq, arg+2, eq+1);
              aptr += n;
            } else if (neq >= 0
                       && (memcmp(arg+2, "overflow=", neq) == 0
                           || memcmp(arg+2, "overflow-x=", neq) == 0)) {
                overflow = eq + 1;
            } else if (arg[1] == 'n' && arg[2] == 0)
              n_arg = true;
            else {
                fprintf(err, "%s: Invalid argument '%s'\n", argv[0], arg);
                free(abuf);
                fclose(err);
                return EXIT_FAILURE;
            }
        } else {
            *aptr = '\0';
            if (access(arg, R_OK) != 0) {
                 fprintf(err, "imgcat: No such file: %s\n", arg);
                 fclose(err);
                 return EXIT_FAILURE;
            }
            int fimg = open(arg, O_RDONLY);
            struct stat stbuf;
            if (fstat(fimg, &stbuf) != 0 || (!S_ISREG(stbuf.st_mode))) {
              /* Handle error FIXME */
            }
            off_t len = stbuf.st_size;
            unsigned char *img = mmap(NULL, len, PROT_READ, MAP_PRIVATE,
                                      fimg, 0);
            const char *mime;
#if HAVE_LIBMAGIC
            magic_t magic; // FIXME should cache
            magic = magic_open(MAGIC_MIME_TYPE); 
            magic_load(magic, NULL);
            magic_compile(magic, NULL);
            mime = magic_buffer(magic, img, len);
#else
            mime = get_mimetype(arg);
#endif
            if (mime == NULL) {
                 fprintf(err, "imgcat: unknown file type: %s\n", arg);
                 fclose(err);
                 return EXIT_FAILURE;
            }
            if (n_arg)
                overflow = "";
            else if (overflow == NULL)
                overflow = "auto";
            char *b64 = base64_encode(img, len);
            munmap(img, len);
            int rsize = 100+strlen(mime)+strlen(b64)+ strlen(abuf);
            char *response = xmalloc(rsize);
            int n = snprintf(response, rsize,
                    n_arg ? "\033]72;%s<img%s src='data:%s;base64,%s'/>\007"
                    : "\033]72;<div style='overflow-x: %s'><img%s src='data:%s;base64,%s'/></div>\007",
                    overflow, abuf, mime, b64);
            if (n >= rsize)
                 fatal("buffer overflow");
#if HAVE_LIBMAGIC
            magic_close(magic);
#endif
            free(abuf);
            free(b64);
            if (write(get_tty_out(), response, strlen(response)) <= 0) {
                lwsl_err("write failed\n");
                return EXIT_FAILURE;
            }
        }
    }
    return EXIT_SUCCESS;
}

char *read_response(FILE *err)
{
    int fin = get_tty_in();
    size_t bsize = 2048;
    char *buf = xmalloc(bsize);
    tty_save_set_raw(fin);
    int n = read(fin, buf, 2);
    char *msg = NULL;
    if (n != 2 ||
        (buf[0] != (char) 0x9D
         && (buf[0] != (char) 0xc2 || buf[1] != (char) 0x9d))) {
        msg = "(no response received)\n";
    } else {
        size_t old = 0;
        if (buf[0] == (char) 0x9d) {
            buf[0] = buf[1];
            old = 1;
        }
        for (;;) {
            ssize_t n = read(fin, buf+old, bsize-old);
            if (n <= 0) {
                msg = "(malformed response received)\n";
                break;
            }
            char *end = memchr(buf+old, '\n', n);
            if (end != NULL) {
                *end = '\0';
                break;
            }
            old += n;
            bsize = (3 * bsize) >> 1;
            buf = xrealloc(buf, bsize);
        }
    }
    if (msg) {
        fputs(msg, err);
        free(buf);
        buf = NULL;
    }
    tty_restore(fin);
    return buf;
}

int print_stylesheet_action(int argc, char** argv, const char*cwd,
                            char **env, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    close(0);
    if (argc != 2) {
        char *msg = argc < 2 ? "(too few arguments to print-stylesheets)\n"
          : "(too many arguments to print-stylesheets)\n";
        if (write(opts->fd_err, msg, strlen(msg)+1) <= 0)
            lwsl_err("writed failed\n");
        close(opts->fd_err);
        return EXIT_FAILURE;
    }
    FILE *out = fdopen(opts->fd_out, "w");
    FILE *tout = fdopen(get_tty_out(), "w");
    fprintf(tout, "\033]93;%s\007", argv[1]); fflush(tout);
    char *response = read_response(out);
    json_object *jobj = json_tokener_parse(response);
    int nlines = json_object_array_length(jobj);
    for (int i = 0; i < nlines; i++)
        fprintf(stdout, "%s\n",
                json_object_get_string(json_object_array_get_idx(jobj, i)));
    free(response);
    json_object_put(jobj);
    return EXIT_SUCCESS;
}

int list_stylesheets_action(int argc, char** argv, const char*cwd,
                            char **env, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    close(0);
    if (! write_to_tty("\033]90;\007", -1))
         return EXIT_FAILURE;
    FILE *err = fdopen(opts->fd_err, "w");
    char *response = read_response(err);
    FILE *out = fdopen(opts->fd_out, "w");
    char *p = response;
    int i = 0;
    for (; *p != 0; ) {
      fprintf(out, "%d: ", i++);
      char *t = strchr(p, '\t');
      char *end = t != NULL ? t : p + strlen(p);
      fprintf(out, "%.*s\n", (int) (end-p), p);
      if (t == NULL)
        break;
      p = t+1;
    }
    return EXIT_SUCCESS;
}

int load_stylesheet_action(int argc, char** argv, const char*cwd,
                           char **env, struct lws *wsi,
                           struct options *opts)
{
    int replyfd = opts->fd_err;
    check_domterm(opts);
    if (argc != 3) {
        char *msg = argc < 3 ? "too few arguments to load-stylesheet\n"
          : "too many arguments to load-stylesheet\n";
        if (write(replyfd, msg, strlen(msg)+1) <= 0)
            lwsl_err("write failed\n");
        close(replyfd);
        return EXIT_FAILURE;
    }
    char *name = argv[1];
    char *fname = argv[2];
    int in = strcmp(fname, "-") == 0 ? 0 : open(fname, O_RDONLY);
    FILE *err = fdopen(replyfd, "w");
    if (in< 0) {
      fprintf(err, "cannot read '%s'\n", fname);
      return EXIT_FAILURE;
    }
    size_t bsize = 2048;
    int off = 0;
    char *buf = xmalloc(bsize);
    for (;;) {
        if (bsize == off) {
            bsize = (3 * bsize) >> 1;
            buf = xrealloc(buf, bsize);
        }
        ssize_t n = read(in, buf+off, bsize-off);
        if (n < 0) {
          // error
        }
        if (n <= 0)
           break;
        off += n;
    }
    FILE *tout = fdopen(get_tty_out(), "w");
    struct json_object *jname = json_object_new_string(name);
    struct json_object *jvalue = json_object_new_string_len(buf, off);
    fprintf(tout, "\033]95;%s,%s\007",
            json_object_to_json_string_ext(jname, JSON_C_TO_STRING_PLAIN),
            json_object_to_json_string_ext(jvalue, JSON_C_TO_STRING_PLAIN));
    json_object_put(jname);
    json_object_put(jvalue);

    fflush(tout);
    char *str = read_response(err);
    if (str != NULL && str[0]) {
        fprintf(err, "%s\n", str);
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

int maybe_disable_stylesheet(bool disable, int argc, char** argv,
                             struct options *opts)
{
    check_domterm(opts);
    if (argc != 2) {
        char *msg = argc < 2 ? "(too few arguments to disable/enable-stylesheet)\n"
          : "(too many arguments to disable/enable-stylesheet)\n";
        int replyfd = opts->fd_err;
        if (write(replyfd, msg, strlen(msg)+1) <= 0)
            lwsl_err("write failed\n");
        close(replyfd);
        return EXIT_FAILURE;
    }
    char *specifier = argv[1];
    FILE *tout = fdopen(get_tty_out(), "w");
    fprintf(tout, "\033]%d;%s\007", disable?91:92, specifier);
    fflush(tout);
    FILE *out = fdopen(opts->fd_out, "w");
    char *str = read_response(out);
    if (str != NULL && str[0]) {
        fprintf(out, "%s\n", str);
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

int enable_stylesheet_action(int argc, char** argv, const char*cwd,
                             char **env, struct lws *wsi,
                             struct options *opts)
{
    return maybe_disable_stylesheet(false, argc, argv, opts);
}

int disable_stylesheet_action(int argc, char** argv, const char*cwd,
                             char **env, struct lws *wsi,
                             struct options *opts)
{
    return maybe_disable_stylesheet(true, argc, argv, opts);
}

int add_stylerule_action(int argc, char** argv, const char*cwd,
                            char **env, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    FILE *out = fdopen(get_tty_out(), "w");
    for (int i = 1; i < argc; i++) {
        struct json_object *jobj = json_object_new_string(argv[i]);
        fprintf(out, "\033]94;%s\007",
                json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN));
        json_object_put(jobj);
    }
    fclose(out);
    return EXIT_SUCCESS;
}

int view_saved_action(int argc, char** argv, const char*cwd,
                  char **env, struct lws *wsi,
                  struct options *opts)
{
    optind = 1;
    process_options(argc, argv, opts);
    FILE *err = fdopen(opts->fd_err, "w");
    if (optind != argc-1) {
        fprintf(err, optind >= argc ? "domterm view-saved: missing file name\n"
                : "domterm view-saved: more than one file name\n");
        fclose(err);
        return EXIT_FAILURE;
    }
    char *file = argv[optind];
    char *p = file;
    bool saw_scheme = false;
    for (; *p && *p != '/'; p++) {
      if (*p == ':') {
        saw_scheme = 1;
        break;
      }
    }
    char *fscheme = saw_scheme ? "" : "file://";
    char *fencoded = file;
    if (! saw_scheme) {
        if (file[0] != '/') {
          fencoded = xmalloc(strlen(cwd)+strlen(file)+2);
          sprintf(fencoded, "%s/%s", cwd, file);
        }
        if (access(fencoded, R_OK) != 0) {
            fprintf(err, "domterm view-saved: No such file: %s\n", fencoded);
            fclose(err);
            return EXIT_FAILURE;
        }
    }
    fencoded = url_encode(fencoded, 0);
    char *url = xmalloc(strlen(main_html_url) + strlen(fencoded) + 40);
    sprintf(url, "%s%s", fscheme, fencoded);
    if (file != fencoded)
        free(fencoded);
    display_session(opts, NULL, url, -105);
    free(url);
    return EXIT_SUCCESS;
}

int freshline_action(int argc, char** argv, const char*cwd,
                         char **env, struct lws *wsi,
                         struct options *opts)
{
    check_domterm(opts);
    char *cmd = "\033[20u";
    if (write(get_tty_out(), cmd, strlen(cmd)) <= 0)
        return EXIT_FAILURE;
    return EXIT_SUCCESS;
}

int reverse_video_action(int argc, char** argv, const char*cwd,
                         char **env, struct lws *wsi,
                         struct options *opts)
{
    check_domterm(opts);
    if (argc > 2) {
        char *msg ="too many arguments to reverse-video\n";
        int err = opts->fd_err;
        if (write(err, msg, strlen(msg)+1) <= 0)
            lwsl_err("write failed\n");
        close(err);
        return EXIT_FAILURE;
    }
    char *opt = argc < 2 ? "on" : argv[1];
    bool on;
    if (strcasecmp(opt, "on") == 0 || strcasecmp(opt, "yes") == 0
        || strcasecmp(opt, "true") == 0)
      on = true;
    else if (strcasecmp(opt, "off") == 0 || strcasecmp(opt, "no") == 0
             || strcasecmp(opt, "false") == 0)
      on = false;
    else {
        char *msg ="arguments to reverse-video is not on/off/yes/no/true/false\n";
        if (write(opts->fd_err, msg, strlen(msg)+1) <= 0)
            lwsl_err("write failed\n");
        close(opts->fd_err);
        return EXIT_FAILURE;
    }
    char *cmd = on ? "\033[?5h" : "\033[?5l";
    if (write(get_tty_out(), cmd, strlen(cmd)) <= 0)
        return EXIT_FAILURE;
    return EXIT_SUCCESS;
}

struct command commands[] = {
  { .name = "is-domterm",
    .options = COMMAND_IN_CLIENT,
    .action = is_domterm_action },
  { .name ="html",
    .options = COMMAND_IN_CLIENT,
    .action = html_action },
  { .name ="hcat",
    .options = COMMAND_IN_CLIENT|COMMAND_ALIAS },
  { .name ="imgcat",
    .options = COMMAND_IN_CLIENT,
    .action = imgcat_action },
  { .name ="image",
    .options = COMMAND_IN_CLIENT|COMMAND_ALIAS },
  { .name ="add-style",
    .options = COMMAND_IN_CLIENT,
    .action = add_stylerule_action },
  { .name ="enable-stylesheet",
    .options = COMMAND_IN_CLIENT,
    .action = enable_stylesheet_action },
  { .name ="disable-stylesheet",
    .options = COMMAND_IN_CLIENT,
    .action = disable_stylesheet_action },
  { .name ="load-stylesheet",
    .options = COMMAND_IN_CLIENT,
    .action = load_stylesheet_action },
  { .name ="list-stylesheets",
    .options = COMMAND_IN_CLIENT,
    .action = list_stylesheets_action },
  { .name ="print-stylesheet",
    .options = COMMAND_IN_CLIENT,
    .action = print_stylesheet_action },
  { .name ="fresh-line",
    .options = COMMAND_IN_CLIENT,
    .action = freshline_action },
  { .name = "attach", .options = COMMAND_IN_SERVER,
    .action = attach_action},
  { .name = "browse", .options = COMMAND_IN_SERVER,
    .action = browse_action},
  { .name = "view-saved", .options = COMMAND_IN_SERVER,
    .action = view_saved_action},
  { .name = "list",
    .options = COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER,
    .action = list_action },
  { .name = "reverse-video",
    .options = COMMAND_IN_CLIENT,
    .action = reverse_video_action },
  { .name = "help",
    .options = COMMAND_IN_CLIENT,
    .action = help_action },
  { .name = "new", .options = COMMAND_IN_SERVER,
    .action = new_action},
  { .name = 0 }
  };

struct command *
find_command(const char *name)
{
    struct command *cmd = &commands[0];
    for (; ; cmd++) {
        if (cmd->name == NULL)
            return NULL;
        if (strcmp(cmd->name, name) == 0)
            break;
    }
    while ((cmd->options & COMMAND_ALIAS) != 0)
        cmd--;
    return cmd;
}

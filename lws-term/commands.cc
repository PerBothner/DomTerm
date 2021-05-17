#include "server.h"
#include "command-connect.h"
#include <stdlib.h>
#if HAVE_LIBMAGIC
#include <magic.h>
#endif
#include <sys/mman.h>
#include <sys/stat.h>

#define DO_HTML_ACTION_IN_SERVER PASS_STDFILES_UNIX_SOCKET
#define COMPLETE_FOR_BASH_CMD "#complete-for-bash"

struct lws;

extern struct command commands[];

int is_domterm_action(int argc, arglist_t argv, struct lws *wsi,
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

static void print_base_element(const char*base_url, struct sbuf *sbuf)
{
    const char *colon = strchr(base_url, ':');
    const char *sl = colon ? strchr(base_url, '/') : NULL;
    if (colon && (! sl || colon < sl))
        sbuf->printf("<base href='%s'/>", base_url);
    else {
        struct stat stbuf;
        size_t baselen = strlen(base_url);
        sbuf->printf("<base href='http://localhost:%d/RESOURCE/%.*s/",
                    http_port, SERVER_KEY_LENGTH, server_key);
        for (const char *p = base_url; *p; ) {
            char ch = *p++;
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
                || (ch >= '0' && ch <= '9') || ch == '/'
                || ch == '-' || ch == '_' || ch == '.' || ch == '~')
                sbuf->append(p-1, 1);
            else
                sbuf->printf("%%%02x", ch & 0xFF);
        }
        if (baselen > 0 && base_url[baselen-1] != '/'
            && stat(base_url, &stbuf) == 0 && S_ISDIR(stbuf.st_mode))
            sbuf->printf("/");
        sbuf->printf("'/>");
    }
}

int html_action(int argc, arglist_t argv, struct lws *wsi,
                struct options *opts)
{
    bool is_hcat = argc > 0 && strcmp(argv[0], "hcat") == 0;
    if (opts == main_options) // client mode
        check_domterm(opts);
    int i = 1;
    const char *base_url = NULL;
    for (i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (arg[0] == '-') {
            const char *eq = arg[1] == '-' ? strchr(arg, '=') : NULL;
            int neq = eq ? eq - arg - 1: -1;
            if (neq >= 0
                && (memcmp(arg+2, "base-url=", neq) == 0
                    || memcmp(arg+2, "base=", neq) == 0)) {
                base_url = eq+1;
            } else {
                printf_error(opts, "%s: Invalid argument '%s'",
                             argv[0], arg);
                return EXIT_FAILURE;
            }
        } else
            break;
    }

    sbuf sb;
    sb.printf("\033]72;");

    if (is_hcat && i < argc) {
        while (i < argc)  {
            const char *fname = argv[i++];
            char *fname_abs = NULL;
            const char *cwd = opts->cwd;
            if (fname[0] != '/' && cwd != NULL) {
                fname_abs = challoc(strlen(cwd) + strlen(fname) +2);
                sprintf(fname_abs, "%s/%s", cwd, fname);
            }
            FILE *fin = fopen(fname_abs ? fname_abs : fname, "r");
            if (fname_abs != NULL)
                free(fname_abs);
            if (fin == NULL) {
                printf_error(opts, "missing html file '%s'", fname);
                return EXIT_FAILURE;
            }
            if (base_url != NULL)
                print_base_element(base_url, &sb);
            else {
                char *rpath = realpath(fname, NULL);
                print_base_element(rpath, &sb);
                free(rpath);
            }
            sb.copy_file(fin);
            fclose(fin);
        }
    } else {
        if (base_url == NULL)
            base_url = opts->cwd != NULL ? strdup(opts->cwd) : getcwd(NULL, 0);
        if (base_url != NULL) {
            print_base_element(base_url, &sb);
        }
        if (i == argc) {
            FILE *in = fdopen(dup(opts->fd_in), "r");
            sb.copy_file(in);
            fclose(in);
        } else {
            while (i < argc)  {
                sb.append(argv[i++]);
            }
        }
    }
    int ret = EXIT_SUCCESS;
    sb.append("\007", 1);
#if DO_HTML_ACTION_IN_SERVER
    char **ee = env;
    while (*ee && strncmp(*ee, "DOMTERM=", 8) != 0)
        ee++;
    char *t1;
    if (*ee && (t1 = strstr(*ee, ";tty="))) {
        t1 += 5;
        char *t2 = strchr(t1, ';');
        size_t tlen = t2 == NULL ? strlen(t1) : t2 - t1;
        char *tname = xmalloc(tlen+1);
        strncpy(tname, t1, tlen);
        tname[tlen] = 0;
        FOREACH_PCLIENT(pclient) {
            if (strcmp(pclient->ttyname, tname) == 0) {
                FOREACH_WSCLIENT(tclient, pclient) {
                    tclient->ob.extend(sb.len);
                    memcpy(tclient->ob.buffer+tclient->ob.len,
                           sb.buffer, sb.len);
                    tclient->ob.len += sb.len;
                    tclient->ocount += sb.len;
                    lws_callback_on_writable(tclient->out_wsi);
                }
                return EXIT_SUCCESS;
            }
        }
    }
#else
    if (write(get_tty_out(), sb.buffer, sb.len) != (ssize_t) sb.len) {
        lwsl_err("write failed\n");
        ret = EXIT_FAILURE;
    }
#endif
    return ret;
}

int imgcat_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    check_domterm(opts);
    int asize = 0;
    for (int i = 1; i < argc; i++) {
        asize += strlen(argv[i]) + 4;
    }
    char *abuf = challoc(asize);
    char *aptr = abuf;
    const char *overflow = NULL;
    bool n_arg = false;
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (arg[0] == '-') {
            const char *eq = arg[1] == '-' ? strchr(arg, '=') : NULL;
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
                printf_error(opts, "%s: Invalid argument '%s'",
                             argv[0], arg);
                return EXIT_FAILURE;
            }
        } else {
            *aptr = '\0';
            if (access(arg, R_OK) != 0) {
                printf_error(opts, "imgcat: No such file: %s", arg);
                return EXIT_FAILURE;
            }
            int fimg = open(arg, O_RDONLY);
            struct stat stbuf;
            if (fstat(fimg, &stbuf) != 0 || (!S_ISREG(stbuf.st_mode))) {
              /* Handle error FIXME */
            }
            off_t len = stbuf.st_size;
            unsigned char *img = (unsigned char*)
                mmap(NULL, len, PROT_READ, MAP_PRIVATE, fimg, 0);
            const char *mime;
#if HAVE_LIBMAGIC
            magic_t magic; // FIXME should cache
            magic = magic_open(MAGIC_MIME_TYPE); 
            magic_load(magic, NULL);
            magic_compile(magic, NULL);
            mime = magic_buffer(magic, img, len);
            if (mime && strcmp(mime, "text/plain") == 0) {
                // This is mainly for svg.
                const char *mime2 = get_mimetype(arg);
                if (mime2)
                    mime = mime2;
            }
#else
            mime = get_mimetype(arg);
#endif
            if (mime == NULL) {
                printf_error(opts, "imgcat: unknown file type: %s", arg);
                return EXIT_FAILURE;
            }
            if (n_arg)
                overflow = "";
            else if (overflow == NULL)
                overflow = "auto";
            char *b64 = base64_encode(img, len);
            munmap(img, len);
            int rsize = 100+strlen(mime)+strlen(b64)+ strlen(abuf);
            char *response = challoc(rsize);
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

static char *read_response(struct options *opts)
{
    int fin = get_tty_in();
    size_t bsize = 2048;
    char *buf = challoc(bsize);
    tty_save_set_raw(fin);
    int n = read(fin, buf, 2);
    const char *msg = NULL;
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
                msg = "(malformed response received)";
                break;
            }
            char *end = (char*) memchr(buf+old, '\n', n);
            if (end != NULL) {
                *end = '\0';
                break;
            }
            old += n;
            bsize = (3 * bsize) >> 1;
            buf = (char*) xrealloc(buf, bsize);
        }
    }
    if (msg) {
        printf_error(opts, "%s", msg);
        free(buf);
        buf = NULL;
    }
    tty_restore(fin);
    return buf;
}

int print_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    close(0);
    if (argc != 2) {
        printf_error(opts, argc < 2
                     ? "(too few arguments to print-stylesheets)"
                     : "(too many arguments to print-stylesheets)");
        return EXIT_FAILURE;
    }
    FILE *tout = fdopen(get_tty_out(), "w");
    fprintf(tout, "\033]93;%s\007", argv[1]);
    fflush(tout);
    char *response = read_response(opts);
    if (! response)
        return EXIT_FAILURE;
    json_object *jobj = json_tokener_parse(response);
    int nlines = json_object_array_length(jobj);
    for (int i = 0; i < nlines; i++)
        fprintf(stdout, "%s\n",
                json_object_get_string(json_object_array_get_idx(jobj, i)));
    free(response);
    json_object_put(jobj);
    return EXIT_SUCCESS;
}

int list_stylesheets_action(int argc, arglist_t argv, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    close(0);
    if (! write_to_tty("\033]90;\007", -1))
         return EXIT_FAILURE;
    char *response = read_response(opts);
    if (! response)
        return EXIT_FAILURE;
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

int load_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                           struct options *opts)
{
    check_domterm(opts);
    if (argc != 3) {
        printf_error(opts, argc < 3
                     ? "too few arguments to load-stylesheet"
                     : "too many arguments to load-stylesheet");
        return EXIT_FAILURE;
    }
    const char *name = argv[1];
    const char *fname = argv[2];
    int in = strcmp(fname, "-") == 0 ? 0 : open(fname, O_RDONLY);
    if (in < 0) {
        printf_error(opts, "cannot read '%s'", fname);
        return EXIT_FAILURE;
    }
    size_t bsize = 2048;
    size_t off = 0;
    char *buf = challoc(bsize);
    for (;;) {
        if (bsize == off) {
            bsize = (3 * bsize) >> 1;
            buf = (char*) xrealloc(buf, bsize);
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
    char *str = read_response(opts);
    if (str != NULL && str[0]) {
        printf_error(opts, "%s", str);
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

int maybe_disable_stylesheet(bool disable, int argc, arglist_t argv,
                             struct options *opts)
{
    check_domterm(opts);
    if (argc != 2) {
        printf_error(opts, argc < 2
                     ? "(too few arguments to disable/enable-stylesheet)"
                     : "(too many arguments to disable/enable-stylesheet)");
        return EXIT_FAILURE;
    }
    const char *specifier = argv[1];
    FILE *tout = fdopen(get_tty_out(), "w");
    fprintf(tout, "\033]%d;%s\007", disable?91:92, specifier);
    fflush(tout);
    char *str = read_response(opts);
    if (str != NULL && str[0]) {
        printf_error(opts, "%s", str);
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

int enable_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                             struct options *opts)
{
    return maybe_disable_stylesheet(false, argc, argv, opts);
}

int disable_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                             struct options *opts)
{
    return maybe_disable_stylesheet(true, argc, argv, opts);
}

int add_stylerule_action(int argc, arglist_t argv, struct lws *wsi,
                            struct options *opts)
{
    check_domterm(opts);
    FILE *out = fdopen(dup(get_tty_out()), "w");
    for (int i = 1; i < argc; i++) {
        struct json_object *jobj = json_object_new_string(argv[i]);
        fprintf(out, "\033]94;%s\007",
                json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN));
        json_object_put(jobj);
    }
    fclose(out);
    return EXIT_SUCCESS;
}

int list_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    int nclients = 0;
    FILE *out = fdopen(dup(opts->fd_out), "w");
    FOREACH_PCLIENT(pclient)  {
        fprintf(out, "pid: %d", pclient->pid);
        fprintf(out, ", session#: %d", pclient->session_number);
        if (pclient->session_name != NULL)
            fprintf(out, ", name: %s", pclient->session_name); // FIXME-quote?
        int nwindows = 0;
        FOREACH_WSCLIENT(tclient, pclient) { nwindows++; }
        fprintf(out, ", #windows: %d", nwindows);
        fprintf(out, "\n");
        nclients++;
    }
    if (nclients == 0)
        fprintf(out, "(no domterm sessions or server)\n");
    fclose(out);
    return EXIT_SUCCESS;
}

const char *
json_get_property(struct json_object *jobj, const char *fname)
{
    struct json_object *jval = NULL;
    if (json_object_object_get_ex(jobj, fname, &jval)) {
        return json_object_get_string(jval);
    }
    return NULL;
}
bool
json_print_property(FILE *out, struct json_object *jobj, const char *fname,
                    const char *prefix, char *label)
{
    const char *val = json_get_property(jobj, fname);
    if (val)
        fprintf(out, "%s%s: %s", prefix, label == NULL? fname : label, val);
    return val != NULL;
}

static void tclient_status_info(struct tty_client *tclient, FILE *out)
{
    if (tclient->version_info) {
        struct json_object *vobj =
            json_tokener_parse(tclient->version_info);
        const char *prefix = " ";
        if (tclient->is_headless) {
            fprintf(out, "headless");
            prefix = ", ";
        }
        if (json_print_property(out, vobj, "qtwebengine", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "atom", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "electron", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "javaFX", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "chrome", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "appleWebKit", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "firefox", prefix, NULL))
            prefix = ", ";
        //fprintf(out, " %s\n", tclient->version_info);
        json_object_put(vobj);
    }
}

static void pclient_status_info(struct pty_client *pclient, FILE *out)
{
    struct tty_client *tclient = pclient->first_tclient;
    if (pclient->is_ssh_pclient && tclient && tclient->options) {
        const char* remote =
            get_setting(tclient->options->cmd_settings,
                        REMOTE_HOSTUSER_KEY);
        fprintf(out, "ssh to remote %s", remote);
        remote =
            get_setting(tclient->options->cmd_settings,
                        REMOTE_SESSIONNUMBER_KEY);
        if (remote)
            fprintf(out, "#%s", remote);
    } else
        fprintf(out, "pid: %d, tty: %s", pclient->pid, pclient->ttyname);
    if (pclient->session_name != NULL)
        fprintf(out, ", name: %s", pclient->session_name); // FIXME-quote?
    if (pclient->paused)
        fprintf(out, ", paused");
}

static void show_connection_info(struct tty_client *tclient,
                                 FILE * out, int verbosity)
{
    const char *cinfo = tclient->ssh_connection_info;
    if (cinfo != NULL) {
        const char *sp1 = strchr(cinfo, ' ');
        const char *sp2 = sp1 ? strchr(sp1 + 1, ' ') : NULL;
        const char *sp3 = sp2 ? strchr(sp2 + 1, ' ') : NULL;
        size_t clen = strlen(cinfo);
        if (verbosity > 0 && sp2)
            fprintf(out, " from %.*s:%.*s to %.*s:%.*s",
                    (int) (sp1 - cinfo), cinfo,
                    (int) (sp2 - sp1 - 1), sp1 + 1,
                    (int) (sp3 - sp2 - 1), sp2 + 1,
                    (int) (cinfo + clen - sp3 - 1), sp3 + 1);
        else
            fprintf(out, " from %.*s",
                    (int) (sp1 ? sp1 - cinfo : clen), cinfo);
    }
}

static void status_by_session(FILE * out, int verbosity)
{
    int nclients = 0;
    FOREACH_PCLIENT(pclient) {
        nclients++;
            fprintf(out, "session#: %d, ", pclient->session_number);
            pclient_status_info(pclient, out);
            fprintf(out, "\n");
            int nwindows = 0;
            FOREACH_WSCLIENT(tclient, pclient) {
                int number = tclient->connection_number;
                if (tclient->proxyMode == proxy_remote) {
                    if (number >= 0)
                        fprintf(out, "  connection %d", number);
                    fprintf(out, " via ssh");
                    show_connection_info(tclient, out, verbosity);
                } else {
                    if (number >= 0) {
                        fprintf(out, "  window %d", number);
                        if (tclient->main_window > 0)
                            fprintf(out, " in %d", tclient->main_window);
                        fprintf(out, ":");
                    }
                    tclient_status_info(tclient, out);
                }
                if (tclient->is_primary_window)
                     fprintf(out, " (primary)");
                fprintf(out, "\n");
                nwindows++;
            }
            if (nwindows == 0)
                fprintf(out, "  (detached)\n");
    }
    if (nclients == 0)
        fprintf(out, "(no domterm sessions or server)\n");
}

static void status_by_connection(FILE *out, int verbosity)
{
    struct tty_client *tclient, *sub_client;
    int nclients = 0, nsessions = 0;
    FORALL_WSCLIENT(tclient) {
        nclients++;
        if (tclient->proxyMode == proxy_remote) {
            continue;
        }
        if (tclient->main_window > 0)
            continue;
        int number = tclient->connection_number;
        if (number >= 0)
            fprintf(out, "Window %d: ", number);
        else
            fprintf(out, "Window: ");
        tclient_status_info(tclient, out);
        fprintf(out, "\n");
        FORALL_WSCLIENT(sub_client) {
            if (sub_client->main_window != number
                && sub_client->connection_number != number)
                continue;

            struct pty_client *pclient = sub_client->pclient;
            if (pclient == NULL) {
                fprintf(out, "  disconnected .%d\n", sub_client->connection_number);
                continue;
            }
            fprintf(out, "  session#%d", pclient->session_number);
            fprintf(out, ": ");
            pclient_status_info(pclient, out);
            fprintf(out, "\n");
        }
    }
    FOREACH_PCLIENT(pclient) {
        int nremote = 0;
        struct tty_client *single_tclient = NULL;
        FOREACH_WSCLIENT(tclient, pclient) {
            if (tclient->proxyMode == proxy_remote) {
                nremote++;
                if (verbosity > 0) {
                    int number = tclient->connection_number;
                    fprintf(out, "Connection %d via ssh", number);
                    show_connection_info(tclient, out, verbosity);
                    fprintf(out, "\n");
                } else {
                    //cinfo = tclient->ssh_connection_info;
                    single_tclient = tclient;
                }
            }
        }
        if (nremote > 0) {
            if (verbosity == 0) {
                if (nremote == 1) {
                    fprintf(out, "Connection %d via ssh", single_tclient->connection_number);
                    show_connection_info(single_tclient, out, verbosity);
                } else {
                    fprintf(out, "%d connections via ssh:", nremote);
                }
                fprintf(out, "\n");
            }
            fprintf(out, "  session#%d: ", pclient->session_number);
            pclient_status_info(pclient, out);
            fprintf(out, "\n");
        }
    }

    bool seen_detached = false;
    FOREACH_PCLIENT(pclient) {
        nsessions++;
        if (pclient->first_tclient == NULL) {
            if (! seen_detached)
                fprintf(out, "Detached sessions:\n");
            seen_detached = true;
            fprintf(out, "  session#: %d, ", pclient->session_number);
            pclient_status_info(pclient, out);
            fprintf(out, "\n");
        }
    }
    if (nclients + nsessions == 0)
        fprintf(out, "(no domterm sessions or server)\n");
}

int status_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    int verbosity = 0;
    bool by_session = false;
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (strcmp(arg, "--by-session") == 0)
            by_session = true;
        else if (strcmp(arg, "--verbose") == 0)
            verbosity++;
    }
    FILE *out = fdopen(dup(opts->fd_out), "w");
    print_version(out);
    if (settings_fname)
        fprintf(out, "Reading settings from: %s\n", settings_fname);
    fprintf(out, "Backend pid:%d", getpid());
    if (backend_socket_name != NULL)
        fprintf(out, " command-socket:%s", backend_socket_name);
    fprintf(out, "\n");
    if (by_session)
        status_by_session(out, verbosity);
    else
        status_by_connection(out, verbosity);
    fclose(out);
    return EXIT_SUCCESS;
}

int kill_server_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    if (opts == main_options) { // client mode
        printf_error(opts, "no domterm server found");
        return EXIT_FAILURE;
    }
    bool kill_clients = argc == 1 || strcmp(argv[1], "--only") != 0;
    do_exit(1, kill_clients);
    return EXIT_SUCCESS;
}

int view_saved_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    optind = 1;
    process_options(argc, argv, opts);
    if (optind != argc-1) {
        printf_error(opts,
                     optind >= argc
                     ? "domterm view-saved: missing file name"
                     : "domterm view-saved: more than one file name");
        return EXIT_FAILURE;
    }
    const char *file = argv[optind];
    const char *p = file;
    bool saw_scheme = false;
    for (; *p && *p != '/'; p++) {
      if (*p == ':') {
        saw_scheme = 1;
        break;
      }
    }
    const char *fscheme = saw_scheme ? "" : "file://";
    char *fencoded = NULL;
    if (! saw_scheme) {
        if (file[0] != '/') {
            const char *cwd = opts->cwd;
            fencoded = challoc(strlen(cwd)+strlen(file)+2);
            sprintf(fencoded, "%s/%s", cwd, file);
            file = fencoded;
        }
        if (access(file, R_OK) != 0) {
            printf_error(opts,
                         "domterm view-saved: No such file: %s", file);
            free(fencoded);
            return EXIT_FAILURE;
        }
    }
    char *url = challoc(strlen(main_html_url) + strlen(file) + 40);
    sprintf(url, "%s%s", fscheme, file);
    free(fencoded);
    display_session(opts, NULL, url, -105);
    free(url);
    return EXIT_SUCCESS;
}

int freshline_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts)
{
    check_domterm(opts);
    const char *cmd = "\033[20u";
    if (write(get_tty_out(), cmd, strlen(cmd)) <= 0)
        return EXIT_FAILURE;
    return EXIT_SUCCESS;
}

int settings_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts)
{
    if (opts->doing_complete) {
        if (argc > 1) {
            const char *last_arg = argv[argc-1];
            if (last_arg[0] == '=')
                last_arg++;
            print_settings_prefixed(last_arg, "", "=\n", stdout);
        }
        return EXIT_SUCCESS;
    }
    check_domterm(opts);
    struct json_object *settings = opts->cmd_settings;
    if (settings) {
        json_object_put(settings);
        opts->cmd_settings = NULL;
    }
    for (int i = 1; i < argc; i++) {
        if (! check_option_arg(argv[i], opts))
            printf_error(opts, "non-option argument '%s' to settings command",
                         argv[i]);
    }
    settings = opts->cmd_settings;
    if (settings == NULL) {
        printf_error(opts, "no options specified");
        return EXIT_FAILURE;
    }
    FILE *tout = fdopen(dup(get_tty_out()), "w");
    fprintf(tout, URGENT_START_STRING "\033]88;%s\007" URGENT_END_STRING,
            json_object_to_json_string_ext(settings, JSON_C_TO_STRING_PLAIN));
    fclose(tout);
    return EXIT_SUCCESS;
}

int reverse_video_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts)
{
    check_domterm(opts);
    if (argc > 2) {
        printf_error(opts, "too many arguments to reverse-video");
        return EXIT_FAILURE;
    }
    const char *opt = argc < 2 ? "on" : argv[1];
    bool on;
    if (strcasecmp(opt, "on") == 0 || strcasecmp(opt, "yes") == 0
        || strcasecmp(opt, "true") == 0)
      on = true;
    else if (strcasecmp(opt, "off") == 0 || strcasecmp(opt, "no") == 0
             || strcasecmp(opt, "false") == 0)
      on = false;
    else {
        printf_error(opts,
                     "arguments to reverse-video is not on/off/yes/no/true/false");
        return EXIT_FAILURE;
    }
    const char *cmd = on ? "\033[?5h" : "\033[?5l";
    if (write(get_tty_out(), cmd, strlen(cmd)) <= 0)
        return EXIT_FAILURE;
    return EXIT_SUCCESS;
}

int complete_action(int argc, arglist_t argv, struct lws *wsi,
                    struct options *opts)
{
    if (argc != 6)
        return EXIT_FAILURE;
    const char* cline = argv[1]; // COMP_LINE - complete input line
    const char* cpoint = argv[2]; // COMP_POINT - index in cline
    //const char *ccmd = argv[3]; // invoke command
    //const char *cword = argv[4]; // word to complete - unused
    //const char *cprevious = argv[5]; // previous word - unused
    char *line_before = new char[strlen(cline)+5];
    strcpy(line_before, cline);
    long cindex = strtol(cpoint, NULL, 10);
    if (cindex >= 0 && cindex <= (long) strlen(cline))
        line_before[cindex] = '\0';
    if (cindex == 0 || line_before[cindex-1] == ' ')
        strcat(line_before, " ''");

    argblob_t before_argv = parse_args(line_before, false);
    int before_argc = count_args(before_argv) - 1;
    const char *last_arg = before_argv[before_argc];
    struct options copts;
    prescan_options(before_argc, before_argv, &copts);
    const char *cmd = optind < before_argc ? before_argv[optind] : NULL;
    if (cmd == NULL && last_arg[0] == '/') {
        const char *fmt = "/bin/bash -c \"compgen -c '%s'\"";
        char* sysb = new char[strlen(fmt)+strlen(last_arg)];
        sprintf(sysb, fmt, last_arg);
        system(sysb);
        delete[] sysb;
        return EXIT_SUCCESS;
    }
    if (cmd != NULL) {
        struct command *command = find_command(cmd);
        if (command && (command->options & COMMAND_HANDLES_COMPLETION) != 0) {
            copts.doing_complete = true;
            return (command->action)(before_argc+1-optind, before_argv+optind,
                                     NULL, &copts);
        }
    }

    if (last_arg[0] == '=') {
        print_settings_prefixed(last_arg+1, "", "=\n", stdout);
    } else if (last_arg[0] == '-') {
        if (last_arg[1] == '-')
            print_options_prefixed(last_arg+2, "--", stdout);
        else if (last_arg[1] == '0')
            print_options_prefixed(last_arg+1, "--", stdout);
    } else if (cmd == NULL) {
        struct command *p = commands;
        size_t plen = strlen(last_arg);
        for (; p->name; p++) {
            if (strncmp(last_arg, p->name, plen) == 0
                && (p->name[0] != '#' || last_arg[0] == '#')) {
                fprintf(stdout, "%s%s", p->name, " \n");
            }
        }
    }
    return EXIT_SUCCESS;
}

enum window_spec_kind {
    w_number = 0,
    w_top = 1,
    w_current = 2,
    w_current_top = 3
};
enum window_op_kind {
    w_none = 0,
    w_simple = 1
};

int window_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts)
{
    int first_window_number = 1;
    int i = first_window_number;
    for (; i < argc; i++) {
        const char *arg = argv[i];
        if (strcmp(arg, "top") == 0
            || strcmp(arg, "current") == 0
            || strcmp(arg, "current-top") == 0)
            continue;
        if (arg[0] == '\0')
            break;
        char *endptr;
        long num = strtol(arg, &endptr, 10);
        if (arg[0] == '\0' || *endptr)
            break;
        if (! tty_clients.valid_index(num)) {
            printf_error(opts, "domterm window: invalid window number %ld",
                         num);
            return EXIT_FAILURE;
        }
    }
    arglist_t wspec_start = &argv[first_window_number];
    int wspec_count = i - first_window_number;
    const char *subcommand = argc >= i ? argv[i] : NULL;
    bool seen = false;
    const char *seq = NULL;
    enum window_op_kind w_op_kind = w_none;
    const char *default_windows = NULL;
    if (subcommand == NULL) { }
    else if (strcmp(subcommand, "show") == 0) {
        w_op_kind = w_simple;
        default_windows = "top";
        seq = URGENT_WRAP("\033[1t");
    } else if (strcmp(subcommand, "minimize") == 0) {
        w_op_kind = w_simple;
        default_windows = "top";
        seq = URGENT_WRAP("\033[2t");
    } else if (strcmp(subcommand, "hide") == 0) {
        w_op_kind = w_simple;
        default_windows = "top";
        seq = URGENT_WRAP("\033[2;72t");
    } else if (strcmp(subcommand, "toggle-minimize") == 0) {
        w_op_kind = w_simple;
        default_windows = "top";
        seq = URGENT_WRAP("\033[2;73t");
    } else if (strcmp(subcommand, "toggle-hide") == 0) {
        w_op_kind = w_simple;
        default_windows = "top";
        seq = URGENT_WRAP("\033[2;74t");
    } else if (strcmp(subcommand, "close") == 0) {
        w_op_kind = w_simple;
        //default_windows = "current";
        seq = URGENT_WRAP("\033]97;close\007");
    } else if (strcmp(subcommand, "detach") == 0) {
        w_op_kind = w_simple;
        //default_windows = "current";
        seq = URGENT_WRAP("\033]97;detach\007");
    }
    if (w_op_kind == w_none) {
        printf_error(opts,
                     subcommand
                     ? "domterm window: unknown sub-command '%s'"
                     : "domterm window: missing sub-command",
                subcommand);
        return EXIT_FAILURE;
    }
    if (wspec_count == 0) {
        if (default_windows == NULL) {
            printf_error(opts, "missing window specifier - required for window %s",
                         subcommand);
             return EXIT_FAILURE;
        }
        wspec_start = &default_windows;
        wspec_count = 1;
    }
    for (i = 0; i < wspec_count; i++) {
        const char *arg = wspec_start[i];
        enum window_spec_kind w_spec;
        if (strcmp(arg, "top") == 0)
            w_spec = w_top;
#if 0
        else if (strcmp(arg, "current") == 0)
            w_spec = w_current;
        else if (strcmp(arg, "current-top") == 0)
            w_spec = w_current_top;
#endif
        else {
            w_spec = w_number;
        }
        struct tty_client *tclient =
            // error checking of arg was done in initial pass
            w_spec == w_number ? tty_clients[strtol(arg, NULL, 10)]
            : TCLIENT_FIRST;
        for (; tclient != NULL; tclient = TCLIENT_NEXT(tclient)) {
            bool skip = false;
            if (w_spec == w_top || w_spec == w_current_top)
                skip = tclient->main_window != 0;
            if (! skip) {
                switch (w_op_kind) {
                default:
                    printf_to_browser(tclient, seq);
                    lws_callback_on_writable(tclient->wsi);
                }
                seen = true;
            }
            if (w_spec == w_number)
                break;
        }
    }
    if (seen)
        return EXIT_SUCCESS;
    else if (subcommand == 0
             || strcmp(subcommand, "toggle-hide") == 0
             || strcmp(subcommand, "toggle-minimize") == 0) {
        static arglist_t no_args = { NULL };
        return new_action(0, no_args, wsi, opts);
    } else {
        printf_error(opts, "domterm window: no window to '%s'", subcommand);
        return EXIT_FAILURE;
    }
}

struct command commands[] = {
  { .name = "is-domterm",
    .options = COMMAND_IN_CLIENT,
    .action = is_domterm_action },
  { .name ="html",
#if DO_HTML_ACTION_IN_SERVER
    .options = COMMAND_IN_SERVER|COMMAND_CHECK_DOMTERM,
#else
    .options = COMMAND_IN_CLIENT|COMMAND_CHECK_DOMTERM,
#endif
    .action = html_action },
  { .name ="hcat",
#if DO_HTML_ACTION_IN_SERVER
    .options = COMMAND_IN_SERVER|COMMAND_ALIAS|COMMAND_CHECK_DOMTERM },
#else
    .options = COMMAND_IN_CLIENT|COMMAND_ALIAS|COMMAND_CHECK_DOMTERM },
#endif
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
  { .name = REATTACH_COMMAND,
    .options = COMMAND_IN_SERVER|COMMAND_ALIAS },
  { .name = "browse", .options = COMMAND_IN_SERVER,
    .action = browse_action},
  { .name = "view-saved", .options = COMMAND_IN_SERVER,
    .action = view_saved_action},
  { .name = "list",
    .options = COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER,
    .action = list_action },
  { .name = "status",
    .options = COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER,
    .action = status_action },
  { .name = "reverse-video",
    .options = COMMAND_IN_CLIENT,
    .action = reverse_video_action },
  { .name = "help",
    .options = COMMAND_IN_CLIENT,
    .action = help_action },
  { .name = "new", .options = COMMAND_IN_SERVER,
    .action = new_action},
  { .name = "window", .options = COMMAND_IN_SERVER,
    .action = window_action},
  { .name = "settings", .options = COMMAND_IN_CLIENT|COMMAND_HANDLES_COMPLETION,
    .action = settings_action },
  { .name = COMPLETE_FOR_BASH_CMD, .options = COMMAND_IN_CLIENT,
    .action = complete_action },
  { .name = "kill-server",
    .options = COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER,
    .action = kill_server_action },
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

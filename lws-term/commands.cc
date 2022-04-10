#include "server.h"
#include "command-connect.h"
#include <stdlib.h>
#if HAVE_LIBMAGIC
#include <magic.h>
#endif
#include <sys/mman.h>
#include <sys/stat.h>
#include <string>
#include <set>

#define DO_HTML_ACTION_IN_SERVER PASS_STDFILES_UNIX_SOCKET
#define COMPLETE_FOR_BASH_CMD "#complete-for-bash"

struct lws;

extern struct command commands[];

bool check_window_option(const std::string& option,
                         std::set<int>& windows,
                         const char *cmd, struct options *opts)
{
    size_t start = 0;
    size_t osize = option.size();
    const char* sep_chars = ", \t\n\r\f\v";
    for (;;) {
        size_t sep = option.find_first_of(sep_chars, start);
        std::string s = option.substr(start, sep);
        int w;
        bool matched = false;
        if (s != "") {
            for (struct tty_client *tclient  = TCLIENT_FIRST;
                 tclient != NULL; tclient = TCLIENT_NEXT(tclient)) {
                if (tclient->window_name == s) {
                    windows.insert(tclient->index());
                    matched = true;
                }
            }
        }
        if (! matched && s != "") {
            if (s == "all" || s == "all-top" || s == "*" || s == "*^") {
                for (struct tty_client *tclient  = TCLIENT_FIRST;
                     tclient != NULL; tclient = TCLIENT_NEXT(tclient)) {
                    if (tclient->main_window == 0 || s == "all" || s == "*") {
                        windows.insert(tclient->index());
                    }
                }
            } else if (s == "current" || s == "top" || s == "current-top"
                       || s == "." || s == "^" || s == ".^") {
                if (focused_client == nullptr) {
                    printf_error(opts, "domterm %s: no current window", cmd);
                    return false;
                }
                struct tty_client *main;
                if (s == "current" || s == "."
                    || focused_client->main_window == 0
                    || (main = tty_clients(focused_client->main_window)) == nullptr)
                    w = focused_client->index();
                else
                    w = main->index();
                windows.insert(w);
            } else {
                char *endptr;
                const char *s_c = s.c_str();
                long w = strtol(s_c, &endptr, 10);
                if (endptr[0] || (int) w != w ||
                    ! tty_clients.valid_index((int) w)) {
                    printf_error(opts, "domterm %s: invalid window number '%s'",
                                 cmd, s_c);
                    return false;
                }
                windows.insert((int) w);
            }
        }
        if (sep == std::string::npos)
            break;
        start = sep + 1;
    }
    if (windows.empty()) {
        printf_error(opts, "domterm %s: no window specifiers", cmd);
        return false;
    }
    return true;
}

int check_single_window_option(const std::string& woption,
                               const char *cmd, struct options *opts)
{
    std::set<int> windows;
    if (! check_window_option(woption, windows, cmd, opts))
        return -1;
    if (windows.size() != 1 ) {
        printf_error(opts, "domterm %s: multiple windows not allowed", cmd);
        return -1;
    }
    return *windows.begin();
}

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

int simple_window_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts, const char *cmd,
                         const char *seq, const char *default_window)
{
    const char *subarg = argc >= 2 ? argv[1] : NULL;
    std::set<int> windows;
    std::string option = opts->windows;
    if (option.empty())
        option = default_window;
    if (! check_window_option(option, windows, cmd, opts))
        return EXIT_FAILURE;
    for (int w : windows) {
        tty_client *tclient = tty_clients(w);
        tclient->ob.append(seq);
        lws_callback_on_writable(tclient->wsi);
    }
    return EXIT_SUCCESS;
}

void send_request(json& request, const char *cmd,
                  struct options *opts, struct tty_client *tclient)
{
    request["id"] = opts->index();
    request["cmd"] = cmd;
    if (tclient->proxyMode == proxy_remote)
        request["from-ssh-remote"] = true;
    if (tclient->initialized < 2) {
        opts->unsent_request = request.dump();
    } else {
        tclient->ob.printf(URGENT_WRAP("\033]97;%s\007"),
                           request.dump().c_str());
        lws_callback_on_writable(tclient->wsi);
    }
    request_enter(opts, tclient);
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
    argblob_t ee = opts->env;
    while (*ee && strncmp(*ee, "DOMTERM=", 8) != 0)
        ee++;
    const char *t1;
    if (*ee && (t1 = strstr(*ee, ";tty="))) {
        t1 += 5;
        const char *t2 = strchr(t1, ';');
        size_t tlen = t2 == NULL ? strlen(t1) : t2 - t1;
        std::string tname(t1, tlen);
        FOREACH_PCLIENT(pclient) {
            if (strcmp(pclient->ttyname, tname.c_str()) == 0) {
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

static void
await_close(const char *close_response, struct tty_client *tclient,
            struct options *opts)
{
    request_enter(opts, tclient);
    free(opts->close_response); // should never be non-null
    opts->close_response = strdup(close_response);
}

int await_action(int argc, arglist_t argv, struct lws *wsi,
                 struct options *opts)
{
    std::string woption = opts->windows;
    json request;
    json matches;
    int actions = 0;
    const char *close_response = nullptr;
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (strstr(arg, "-w")) {
            if (strlen(arg) > 2) {
                woption = arg + 2;
            } else if (i+1 < argc) {
                woption = argv[++i];
            } else {
                printf_error(opts, "missing argument following -w");
                return EXIT_BAD_CMDARG;
            }
        } else if (strcmp(arg, "--match-output") == 0) {
            if (i + 2 >= argc) {
                printf_error(opts, "missing arguments following '%s'", arg);
                return EXIT_BAD_CMDARG;
            }
            json match_spec;
            match_spec["match"] = argv[i+1];
            match_spec["out"] = argv[i+2];
            i += 2;
            if (i + 1 < argc && argv[i+1][0] != '-' && argv[i+1][0] != '\0') {
                char *endptr;
                long nlines = strtol(argv[i+1], &endptr, 10);
                if (endptr[0] || nlines <= 0) {
                    printf_error(opts, "bad line-count '%s' to '%s' option",
                                 argv[i+1], argv[i-2]);
                    return EXIT_BAD_CMDARG;
                }
                match_spec["nlines"] = nlines;
                i++;
            }
            matches.push_back(match_spec);
            actions++;
        } else if (strcmp(arg, "--timeout") == 0) {
            if (i + 2 >= argc) {
                printf_error(opts, "missing arguments following '%s'", arg);
                return EXIT_BAD_CMDARG;
            }
            char *endptr;
            double tm = strtod(argv[i+1], &endptr);
            if (endptr[0] || tm <= 0) {
                printf_error(opts, "bad timeout value '%s' to '%s' option",
                             argv[i+1], argv[i]);
                return EXIT_BAD_CMDARG;
            }
            request["timeout"] = tm;
            request["timeoutmsg"] = argv[i+2];
            i += 2;
            actions++;
        } else if (strcmp(arg, "--close") == 0) {
            i++;
            close_response = i >= argc ? "" : argv[i++];
        } else {
            printf_error(opts, "unrecogized option '%s'", arg);
            return EXIT_BAD_CMDARG;
        }
    }
    if (woption.empty())
        woption = "current";
    int window = check_single_window_option(woption, "await", opts);
    if (window < 0)
        return EXIT_FAILURE;
    if (matches.size() > 0)
        request["rules"] = matches;
    tty_client* tclient = tty_clients(window);
    if (close_response) {
        await_close(close_response, tclient, opts);
    } else if (actions == 0) {
        printf_error(opts, "no await actions");
        return EXIT_BAD_CMDARG;
    }
    if (actions > 0) {
        send_request(request, "await", opts, tclient);
    }
    return EXIT_WAIT;
}


int print_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                            struct options *opts)
{
    if (argc != 2) {
        printf_error(opts, argc < 2
                     ? "(too few arguments to print-stylesheets)"
                     : "(too many arguments to print-stylesheets)");
        return EXIT_BAD_CMDARG;
    }
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    int window = check_single_window_option(option, "print-stylesheets", opts);
    if (window < 0)
        return EXIT_FAILURE;
    json request;
    request["select"] = argv[1];
    send_request(request, "print-stylesheet", opts, tty_clients(window));
    return EXIT_WAIT;
}

int list_stylesheets_action(int argc, arglist_t argv, struct lws *wsi,
                            struct options *opts)
{
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    int window = check_single_window_option(option, "list-stylesheets", opts);
    if (window < 0)
        return EXIT_FAILURE;
    json request;
    send_request(request, "list-stylesheets", opts, tty_clients(window));
    return EXIT_WAIT;
}

int load_stylesheet_action(int argc, arglist_t argv, struct lws *wsi,
                           struct options *opts)
{
    if (argc != 3) {
        printf_error(opts, argc < 3
                     ? "too few arguments to load-stylesheet"
                     : "too many arguments to load-stylesheet");
        return EXIT_BAD_CMDARG;
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
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    int window = check_single_window_option(option, "load-stylesheet", opts);
    if (window < 0)
        return EXIT_FAILURE;
    json request;
    request["name"] = name;
    request["value"] = std::string(buf, off);
    send_request(request, "load-stylesheet", opts, tty_clients(window));
    return EXIT_WAIT;
}

int maybe_disable_stylesheet(bool disable, int argc, arglist_t argv,
                             struct options *opts)
{
    if (argc != 2) {
        printf_error(opts, argc < 2
                     ? "(too few arguments to disable/enable-stylesheet)"
                     : "(too many arguments to disable/enable-stylesheet)");
        return EXIT_FAILURE;
    }
    const char *command = argv[0];
    const char *specifier = argv[1];
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    int window = check_single_window_option(option, command, opts);
    if (window < 0)
        return EXIT_FAILURE;
    json request;
    request["select"] = specifier;
    send_request(request, command, opts, tty_clients(window));
    return EXIT_WAIT;
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
    const char *subarg = argc >= 2 ? argv[1] : NULL;
    std::set<int> windows;
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    if (! check_window_option(option, windows, "add-style", opts))
        return EXIT_FAILURE;
    for (int w : windows) {
        tty_client *tclient = tty_clients(w);
        for (int i = 1; i < argc; i++) {
            json jobj = argv[i];
            tclient->ob.printf(URGENT_WRAP("\033]94;%s\007"), jobj.dump().c_str());
        }
        lws_callback_on_writable(tclient->wsi);
    }
    return EXIT_SUCCESS;
}

int do_keys_action(int argc, arglist_t argv, struct lws *wsi,
                   struct options *opts)
{
    const char *subarg = argc >= 2 ? argv[1] : NULL;
    std::set<int> windows;
    std::string woption = opts->windows;
    int start = 1;
    while (start < argc) {
        const char *arg = argv[start];
        if (strstr(arg, "-w")) {
            if (strlen(arg) > 2) {
                woption = arg + 2;
                start++;
            } else if (start+1 < argc) {
                woption = argv[start+1];
                start += 2;
            } else {
                printf_error(opts, "missing argument following -w");
                return EXIT_BAD_CMDARG;
            }
        } else
            break;
    }
    if (woption.empty())
        woption = "current";
    if (! check_window_option(woption, windows, "do-keys", opts))
        return EXIT_FAILURE;
    long repeat_count = 1;
    for (int w : windows) {
        tty_client *tclient = tty_clients(w);
        const char *close_response = nullptr;
        optind = start;
        for (;;) {
            json request;
            int c = getopt(argc, (char *const*) argv, "+:N:e:l:C::");
            if (c < 0) {
                if (optind < argc) {
                    request["cmd"] = "do-key";
                    request["keyDown"] = argv[optind];
                    for (int j = 0; j < repeat_count; j++) {
                        tclient->ob.printf(URGENT_WRAP("\033]97;%s\007"), request.dump().c_str());
                    }
                    optind++;
                    continue;
                }
                break;
            }
            switch (c) {
            case '?':
                printf_error(opts, "domterm do-key: unknown option character '%c'", optopt);
                return EXIT_BAD_CMDARG;
            case ':':
                printf_error(opts, "domterm do-key: missing argument to option '-%c'", optopt);
                return EXIT_BAD_CMDARG;
            case 'l':
            case 'e': {
                request["cmd"] = "do-key";
                char *str = optarg;
                if (c == 'e')
                    str = parse_string_escapes(str);
                request["text"] = str;
                for (int j = 0; j < repeat_count; j++) {
                    tclient->ob.printf(URGENT_WRAP("\033]97;%s\007"), request.dump().c_str());
                }
                if (c == 'e')
                    free(str);
                break;
            }
            case 'C':
                close_response = optarg == NULL ? "" : optarg;
                if (windows.size() != 1) {
                    printf_error(opts, "domterm do-key: multiple windows not allowed with -C option");
                    return EXIT_BAD_CMDARG;
                }
                break;
            case 'N':
                char * endptr;
                repeat_count = strtol(optarg, &endptr, 10);
                if (*endptr != '\0') {
                    printf_error(opts, "invalid repeat count");
                    return EXIT_BAD_CMDARG;
                }
                break;
            }
        }
        lws_callback_on_writable(tclient->wsi);
        if (close_response) {
            await_close(close_response, tclient, opts);
            return EXIT_WAIT;
        }
    }
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

bool
json_print_property(FILE *out, const json &jobj, const char *fname,
                    const char *prefix, char *label)
{
    auto jit = jobj.find(fname);
    if (jit == jobj.end() || ! jit->is_string())
        return false;
    std::string val = *jit;
    fprintf(out, "%s%s: %s", prefix, label == NULL? fname : label, val.c_str());
    return true;
}

static void tclient_status_info(struct tty_client *tclient, FILE *out)
{
    if (tclient->version_info) {
        json vobj = json::parse(tclient->version_info, nullptr, false);
        const char *prefix = " ";
        if (tclient->is_headless) {
            fprintf(out, "headless");
            prefix = ", ";
        }
        if (json_print_property(out, vobj, "wry", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "webkitgtk", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "qtwebengine", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "atom", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "electron", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "javaFX", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "edge", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "chrome", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "gtk", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "appleWebKit", prefix, NULL))
            prefix = ", ";
        if (json_print_property(out, vobj, "firefox", prefix, NULL))
            prefix = ", ";
        //fprintf(out, " %s\n", tclient->version_info);
    }
}

static void pclient_status_info(struct pty_client *pclient, FILE *out)
{
    struct tty_client *tclient = pclient->first_tclient;
    if (pclient->is_ssh_pclient && tclient && tclient->options) {
        std::string remote =
            get_setting_s(tclient->options->cmd_settings,
                        REMOTE_HOSTUSER_KEY);
        fprintf(out, "ssh to remote %s", remote.c_str());
        remote =
            get_setting_s(tclient->options->cmd_settings,
                        REMOTE_SESSIONNUMBER_KEY);
        if (! remote.empty())
            fprintf(out, "#%s", remote.c_str());
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
    for (tclient = main_windows.first(); tclient != nullptr;
         tclient = main_windows.next(tclient)) {
        nclients++;
        if (tclient->proxyMode == proxy_remote) {
            continue;
        }
        if (tclient->main_window > 0) // redundant
            continue;
        int number = tclient->connection_number;
        if (number >= 0)
            fprintf(out, "Window %d: ", number);
        else
            fprintf(out, "Window: ");
        tclient_status_info(tclient, out);
        fprintf(out, "\n");
        FORALL_WSCLIENT(sub_client) {
            int cnumber =  sub_client->connection_number;
            if (sub_client->main_window != number && cnumber != number)
                continue;

            struct pty_client *pclient = sub_client->pclient;
            const char* indent = "  ";
            bool has_name = ! sub_client->window_name.empty();
            if (pclient) {
                int snumber = pclient->session_number;
                fprintf(out, "%sTerminal#%d", indent, snumber);
                if (snumber != cnumber)
                    fprintf(out, ":%d", cnumber);
            } else if (sub_client->wkind == browser_window)
                fprintf(out, "%sBrowser:%d", indent, cnumber);
            else if (sub_client->wkind == saved_window)
                fprintf(out, "%sSaved:%d", indent, cnumber);
            else if (verbosity > 0 || cnumber != number || has_name)
                fprintf(out,
                        sub_client->wkind == main_only_window
                        ? "%smain-only:%d"
                        : "%sdisconnected:%d",
                        indent, cnumber);
            if (has_name) {
                fprintf(out, "=\"%s\"",
                        sub_client->window_name.c_str());
            }
            if (pclient) {
                fprintf(out, ": ");
                pclient_status_info(pclient, out);
                fprintf(out, "\n");
            } else if (sub_client->wkind == browser_window
                       || sub_client->wkind == saved_window
                       || verbosity > 0 || cnumber != number || has_name)
                fprintf(out, ": %s\n", sub_client->description.c_str());
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
            fprintf(out, "  Terminal#%d", pclient->session_number);
            if (! pclient->saved_window_name.empty()) {
                fprintf(out, "=\"%s\"",
                        pclient->saved_window_name.c_str());
            }
            fprintf(out, ": ");
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
    bool in_server = opts != main_options;
    if (in_server || verbosity > 0) {
        if (in_server)
            fprintf(out, "Backend pid:%d, command-socket:", getpid());
        else
            fprintf(out, "Failed to find server listening at :");
        fprintf(out, "%s", backend_socket_name);
        fprintf(out, "\n");
    }
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
    display_session(opts, NULL, url, saved_window);
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
    opts->cmd_settings.clear();
    int nsettings = 0;
    for (int i = 1; i < argc; i++) {
        if (check_option_arg(argv[i], opts))
            nsettings++;
        else
            printf_error(opts, "non-option argument '%s' to settings command",
                         argv[i]);
    }
    if (nsettings == 0) {
        printf_error(opts, "no options specified");
        return EXIT_FAILURE;
    }
    FILE *tout = fdopen(dup(get_tty_out()), "w");
    fprintf(tout, URGENT_START_STRING "\033]88;%s\007" URGENT_END_STRING,
            opts->cmd_settings.dump().c_str());
    fclose(tout);
    return EXIT_SUCCESS;
}

int reverse_video_action(int argc, arglist_t argv, struct lws *wsi,
                         struct options *opts)
{
    if (argc > 2) {
        printf_error(opts, "too many arguments to reverse-video");
        return EXIT_FAILURE;
    }
    const char *opt = argc < 2 ? "on" : argv[1];
    int on = bool_value(opt);
    if (on < 0) {
        printf_error(opts,
                     "arguments to reverse-video is not on/off/yes/no/true/false");
        return EXIT_FAILURE;
    }
    const char *cmd = on ? URGENT_WRAP("\033[?5h") : URGENT_WRAP("\033[?5l");
    return simple_window_action(argc, argv, wsi, opts,
                                "reverse-video",
                                cmd,
                                "current");
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
        if (strncmp(last_arg, "--browser=", 10) == 0)
            print_browsers_prefixed(last_arg+10, "", stdout);
        else if (last_arg[1] == '-')
            print_options_prefixed(last_arg+2, "--", stdout);
        else if (last_arg[1] == 'B')
            print_browsers_prefixed(last_arg+2, "-B", stdout);
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

int capture_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    json request;
    optind = 1;
    opterr = 0;
    for (;;) {
        int c = getopt(argc, (char *const*) argv, "+:w:elBT");
        if (c == -1)
            break;
        switch (c) {
        case '?':
            printf_error(opts, "domterm capture: unknown option character '%c'", optopt);
            return EXIT_FAILURE;
        case ':':
            printf_error(opts, "domterm capture: missing argument to option '-%c'", optopt);
            return EXIT_FAILURE;
        case 'w':
            opts->windows = optarg;
            break;
        case 'e':
            request["escape"] = true;
            break;
        case 'l':
            request["soft-linebreaks"] = true;
            break;
        case 'T':
            request["use-tabs"] = true;
            break;
        case 'B':
            request["current-buffer"] = true;
            break;
        }
    }
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    int window = check_single_window_option(option, "capture", opts);
    if (window < 0)
        return EXIT_FAILURE;
    send_request(request, "capture", opts, tty_clients(window));
    return EXIT_WAIT;
}

int close_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    return simple_window_action(argc, argv, wsi, opts,
                                "close",
                                URGENT_WRAP("\033]97;detach\007"),
                                "current");
}

int detach_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    return simple_window_action(argc, argv, wsi, opts,
                                "detach",
                                URGENT_WRAP("\033]97;detach\007"),
                                "current");
}

int set_window_name_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    const char *cmd = argc > 0 ? argv[0] : "set-window-name";
    if (argc != 2) {
        printf_error(opts,
                     argc > 2 ? "too many arguments to %s"
                     : "too few arguments to %s",
                     cmd);
        return EXIT_FAILURE;
    }
    std::string wname = argv[1];
    std::set<int> windows;
    std::string option = opts->windows;
    if (option.empty())
        option = "current";
    if (! check_window_option(option, windows, cmd, opts))
        return EXIT_FAILURE;
    for (int w : windows) {
        tty_clients(w)->set_window_name(wname);
    }
    return EXIT_SUCCESS;
}

int fullscreen_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    const char *subarg = argc >= 2 ? argv[1] : NULL;
    const char *seq;
    int bval;
    if (subarg == NULL || strcmp(subarg, "toggle") == 0)
        seq = URGENT_WRAP("\033]97;fullscreen toggle\007");
    else if ((bval = bool_value(subarg)) == 1)
        seq = URGENT_WRAP("\033]97;fullscreen on\007");
    else if (bval == 0)
        seq = URGENT_WRAP("\033]97;fullscreen off\007");
    else {
        printf_error(opts, "invalid value '%s' to 'fullscreen' command",
                     subarg);
        return EXIT_FAILURE;
    }
    return simple_window_action(argc, argv, wsi, opts,
                                "fullscreen", seq, "top");
}

int hide_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    return simple_window_action(argc, argv, wsi, opts,
                                "hide",
                                URGENT_WRAP("\033[2;72t"),
                                "top");
}

int minimize_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    return simple_window_action(argc, argv, wsi, opts,
                                "minimize",
                                URGENT_WRAP("\033[2t"),
                                "top");
}

int send_input_action(int argc, arglist_t argv, struct lws *wsi,
                      struct options *opts)
{
    const char *session_specifier = nullptr;
    const char *window_specifier = nullptr;
    const char *close_response = nullptr;
    optind = 1;
    opterr = 0;
    for (;;) {
        int c = getopt(argc, (char *const*) argv, "+:w:s:C::");
        if (c == -1)
            break;
        switch (c) {
        case '?':
            printf_error(opts, "domterm send-input: unknown option character '%c'", optopt);
            return EXIT_FAILURE;
        case ':':
            printf_error(opts, "domterm send-input: missing argument to option '-%c'", optopt);
            return EXIT_FAILURE;
        case 'w':
            opts->windows = optarg;
            break;
        case 'C':
            close_response = optarg == NULL ? "" : optarg;
            break;
        case 's':
            session_specifier = optarg;
            break;
        }
    }
    struct pty_client *pclient = nullptr;
    struct tty_client *tclient = nullptr;
    if (session_specifier) {
        if (! opts->windows.empty()) {
            printf_error(opts, "domterm send-input: both -w (window) and -s (session) options");
            return EXIT_FAILURE;
        }
        pclient = find_session(session_specifier);
        if (pclient == NULL) {
            printf_error(opts, "domterm send-input: no session '%s' found", session_specifier);
            return EXIT_FAILURE;
        }
        if (close_response) {
            tclient = pclient->first_tclient;
            if (tclient == nullptr || tclient->next_tclient != nullptr) {
                printf_error(opts, "domterm send-input: -C option requires session with a single window");
                return EXIT_FAILURE;
            }
        }
    } else {
        std::string woption = opts->windows;
        if (woption.empty())
            woption = "current";
        int window = check_single_window_option(woption, "send-input", opts);
        if (window < 0)
            return EXIT_FAILURE;
        tclient = tty_clients(window);
        pclient = tclient->pclient;
        if (pclient == NULL) {
            printf_error(opts, "domterm send-input: no session for window '%s'",
                         woption.c_str());
            return EXIT_FAILURE;
        }
    }
    if (optind == argc) {
        printf_error(opts, "domterm send-input: no input string to send");
        return EXIT_FAILURE;
    }
    bool write_error = false;
    for (int i = optind; ; ) {
        //lwsl_notice("wsend-input '%s'\n", argv[i]);
        char *xstr = parse_string_escapes(argv[i]);
        size_t slen = strlen(xstr);
        write_error = write(pclient->pty, xstr, slen) < slen;
        free(xstr);
        if (write_error || ++i == argc)
            break;
        write_error = write(pclient->pty, " ", 1) != 1;
    }
    if (write_error) {
        printf_error(opts, "domterm send-input: error while writing");
        return EXIT_FAILURE;
    }
    if (close_response) {
        await_close(close_response, tclient, opts);
        return EXIT_WAIT;
    }
    return EXIT_SUCCESS;
}

int show_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    return simple_window_action(argc, argv, wsi, opts,
                                "show",
                                URGENT_WRAP("\033[1t"),
                                "top");
}

int toggle_hide_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    if (NO_TCLIENTS) {
        static char** no_args = { NULL };
        return new_action(0, no_args, wsi, opts);
    }
    const char *cmd = argv[0];
    bool minimize = strcmp(cmd, "toggle-minimize") == 0;
    const char *seq = minimize ? URGENT_WRAP("\033[2;73t")
        : URGENT_WRAP("\033[2;74t");
    return simple_window_action(argc, argv, wsi, opts, cmd, seq, "top");
}

// deprecated - used -w/--window option instead
int window_action(int argc, arglist_t argv, struct lws *wsi,
                  struct options *opts)
{
    if (! opts->windows.empty()) {
        printf_error(opts, "domterm window (deprecated): -w option specified");
        return EXIT_FAILURE;
    }
    int first_window_number = 1;
    int i = first_window_number;
    std::string woptions;
    for (; i < argc; i++) {
        const char *arg = argv[i];
        if (strcmp(arg, "top") != 0
            && strcmp(arg, "current") != 0
            && strcmp(arg, "current-top") != 0) {
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
        if (! woptions.empty())
            woptions += ',';
        woptions += arg;
    }
    arglist_t wspec_start = &argv[first_window_number];
    int wspec_count = i - first_window_number;
    const char *subcommand = argc >= i ? argv[i] : NULL;
    opts->windows = woptions;
    return handle_command(argc-i, argv+i, wsi, opts);
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
  { .name ="add-style", .options = COMMAND_IN_EXISTING_SERVER,
    .action = add_stylerule_action },
  { .name ="enable-stylesheet", .options = COMMAND_IN_EXISTING_SERVER,
    .action = enable_stylesheet_action },
  { .name ="disable-stylesheet", .options = COMMAND_IN_EXISTING_SERVER,
    .action = disable_stylesheet_action },
  { .name ="load-stylesheet", .options = COMMAND_IN_EXISTING_SERVER,
    .action = load_stylesheet_action },
  { .name ="list-stylesheets",
    .options = COMMAND_IN_EXISTING_SERVER,
    .action = list_stylesheets_action },
  { .name ="print-stylesheet",
    .options = COMMAND_IN_EXISTING_SERVER,
    .action = print_stylesheet_action },
  { .name ="fresh-line",
    .options = COMMAND_IN_CLIENT,
    .action = freshline_action },
  { .name = "attach", .options = COMMAND_IN_SERVER,
    .action = attach_action},
  { .name = "await", .options = COMMAND_IN_EXISTING_SERVER,
    .action = await_action},
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
  { .name = "reverse-video", .options = COMMAND_IN_EXISTING_SERVER,
    .action = reverse_video_action },
  { .name = "help",
    .options = COMMAND_IN_CLIENT,
    .action = help_action },
  { .name = "new", .options = COMMAND_IN_SERVER,
    .action = new_action},
  { .name = "window", .options = COMMAND_IN_EXISTING_SERVER,
    .action = window_action},
  { .name = "capture", .options = COMMAND_IN_EXISTING_SERVER,
    .action = capture_action},
  { .name = "close", .options = COMMAND_IN_EXISTING_SERVER,
    .action = close_action},
  { .name = "detach", .options = COMMAND_IN_EXISTING_SERVER,
    .action = detach_action},
  { .name = "set-window-name", .options = COMMAND_IN_EXISTING_SERVER,
    .action = set_window_name_action},
  { .name = "fullscreen", .options = COMMAND_IN_EXISTING_SERVER,
    .action = fullscreen_action},
  { .name = "hide", .options = COMMAND_IN_EXISTING_SERVER,
    .action = hide_action},
  { .name = "minimize", .options = COMMAND_IN_EXISTING_SERVER,
    .action = minimize_action},
  { .name = "show", .options = COMMAND_IN_EXISTING_SERVER,
    .action = show_action},
  { .name = "toggle-hide",
    .options = COMMAND_IN_SERVER,
    .action = toggle_hide_action},
  { .name = "toggle-minimize",
    .options = COMMAND_IN_SERVER,
    .action = toggle_hide_action},
  // send to session
  { .name = "send-input", .options = COMMAND_IN_EXISTING_SERVER,
    .action = send_input_action},
  //send to front-end
  { .name = "do-keys", .options = COMMAND_IN_EXISTING_SERVER,
    .action = do_keys_action},
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

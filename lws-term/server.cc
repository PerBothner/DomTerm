#include "server.h"
#include "command-connect.h"

#include <sys/file.h>
#include <regex.h>
#include <limits.h>
extern char **environ;

#ifndef DEFAULT_SHELL
#define DEFAULT_SHELL "/bin/bash"
#endif

static struct options opts;
struct options *main_options = &opts;
struct lws *cmdwsi = NULL;
char *argv0;

char *main_html_prefix;

static char *make_socket_name(bool);

static FILE *_logfile = NULL;
static void lwsl_emit_stderr_with_flush(int level, const char * line) {
    char buf[50];
    lwsl_timestamp(level, buf, sizeof(buf));
    fprintf(_logfile, "%s%s", buf, line);
    fflush(_logfile);
}

static void
daemonize()
{
#if 1
    if (daemon(1, 0) != 0)
        lwsl_err("daemonizing failed\n");
#else
    if (lws_daemonize(NULL))
        lwsl_err("daemonizing failed\n");
#endif
}

void
maybe_daemonize()
{
    if (opts.do_daemonize > 0) {
        if (_logfile == NULL || _logfile == stdout || _logfile == stderr) {
            lwsl_notice("about to switch to background 'daemon' mode - no more messages.\n");
            lwsl_notice("(To see more messages use --no-daemonize option.)\n");
        } else {
            lwsl_notice("about to switch to background 'daemon' mode\n");
        }
        tty_restore(-1);
        daemonize();
        opts.do_daemonize = -1;
    }
}

/**
 * Run 'cmd', normall in a shell.
 * If 'cclient' is null, this is similar to system(cmd).
 * If 'cclient' is non-null, this is similar to popen(cmd, "r"):
 * set cclient->fd for reading from command's stdout.
 * (If using "browser-socket" client->fd gets replaced by the socket.)
 */
int start_command(struct options *opts, const char *cmd,
                  struct browser_cmd_client *cclient)
{
    bool start_only = cclient != nullptr;
    arglist_t args = parse_args(cmd, true);
    const char *arg0;
    int pipe_fds[2];
    if (start_only && pipe(pipe_fds) < 0)
        return -1;
    if (args != NULL) {
        arg0 = find_in_path(args[0]);
        if (arg0 == NULL) {
            printf_error(opts, "no executable front-end (browser) '%s'",
                         args[0]);
            return EXIT_FAILURE;
        }
    } else {
#if 1
        int r = system(cmd);
        if (! WIFEXITED(r) || (WEXITSTATUS(r) != 0 && ! is_WindowsSubsystemForLinux())) {
            printf_error(opts, "system could not execute %s (return code: %x)",
                         cmd, r);
            return EXIT_FAILURE;
        }
        return EXIT_SUCCESS;
#else
        char *shell = getenv("SHELL");
        if (shell == NULL)
            shell = DEFAULT_SHELL;
        char **shell_argv = parse_args(shell, false);
        int shell_argc = count_args(shell_argv);
        args = xmalloc((shell_argc+3) * sizeof(char*));
        int i;
        for (i = 0; i < shell_argc; i++)
            args[i] = shell_argv[i];
        args[i++] = "-c";
        args[i++] = cmd[0] == '$' && cmd[1] == ' ' ? cmd + 2 : cmd;
        args[i] = NULL;
        arg0 = args[0];
#endif
    }
    pid_t pid = fork();
    if (pid == 0) {
        std::string window_session_type =
            get_setting_s(opts->settings, "window-session-type");
        if (window_session_type.empty()) {
            if (opts->qt_frontend)
                window_session_type = "x11";
        }
        if (! window_session_type.empty())
            setenv("XDG_SESSION_TYPE", window_session_type.c_str(), 1);
        putenv((char*) "ELECTRON_DISABLE_SECURITY_WARNINGS=true");
#if USE_KDDockWidgets || USE_DOCK_MANAGER
        if (opts->qt_frontend) {
#ifdef QT_DOCKING_LIBDIR
            // FIXME - should append, not override
            setenv("LD_LIBRARY_PATH", QT_DOCKING_LIBDIR, 1);
#endif
        }
#endif
        if (start_only) {
            (void) close(pipe_fds[0]);
            if (pipe_fds[1] != STDOUT_FILENO) {
                (void) dup2(pipe_fds[1], STDOUT_FILENO);
                (void) close(pipe_fds[1]);
            }
            int nfd = open("/dev/null", O_WRONLY);
            dup2(nfd, STDERR_FILENO);
        } else {
            daemonize();
        }
        execv(arg0, (char**) args);
        exit(-1);
    } else if (pid > 0) {// master
        free((void*) args);
        if (start_only) {
            cclient->cmd_pid = pid;
            cclient->fd = pipe_fds[0];
            (void)close(pipe_fds[1]);
        }
    } else {
        printf_error(opts, "could not fork front-end command");
        if (start_only) {
            (void)close(pipe_fds[0]);
            (void)close(pipe_fds[1]);
        }
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
int port_specified = -1;
volatile bool force_exit = false;
struct lws_context *context;
struct tty_server tserver;
int http_port;
struct lws_vhost *vhost;
struct tty_client *focused_client = nullptr;
struct lws_context_creation_info info;
struct cmd_client *cclient;

static const struct lws_protocols protocols[] = {
    /* http server for (mostly) static data */
    {"http-only", callback_http, sizeof(struct http_client),  0},

    /* websockets server for communicating with browser */
    {"domterm",   callback_tty,
     BROKEN_LWS_SET_WSI_USER ? sizeof(struct tty_client*) : 0,  0},

    /* callbacks for pty I/O, one pty for each session (process) */
    {"pty",       callback_pty,  sizeof(struct pty_client),  0},

    /* Unix domain socket for client to send to commands to server.
       This is the listener socket on the server. */
    {"cmd",       callback_cmd,  sizeof(struct cmd_client),  0},

    // connect to browser application using socket - only Qt front-end, so far
    {"browser-socket", callback_browser_cmd,  sizeof(struct browser_cmd_client),  0},
    // connect to browser application using pipe - only Electron and Wry - deprecated
    {"browser-output", callback_browser_cmd,  sizeof(struct browser_cmd_client),  0},

#if REMOTE_SSH
    /* "proxy" protocol is an alternative to "domterm" in that
       it proxies between a pty_client and a file (or socket?) handle(s):
       (The pty/application runs on the "Remote" computer;
       the browser/UI runs on the "Local" computer.)
       The handles are stdout/stdin of an ssh (server) session.
       The proxy-in protocol runs on the Remote end and copies input
       (keystokes and other events) received via ssh to the pty/application.
       Output read from the pty_client is written to the file handle (stdout)
       (instead of being written to websocket client).

       If the proxy wraps a socket, there is a single "proxy" wsi.
       If the proxy is an input/output pair, then we need to
       use two struct lws instances (the "proxy" instands wraps input,
       while "proxy-out" wraps output), but they share the same
       "user-data", the same tty_client instance.
    */
    { "proxy", callback_proxy, sizeof(struct tty_client),  0},
    { "proxy-out", callback_proxy, 0,  0},
    { "ssh-stderr", callback_ssh_stderr, sizeof(struct stderr_client), 0 },
#endif

#if HAVE_INOTIFY
    /* calling back for "inotify" to watch settings.ini */
    {"inotify",    callback_inotify,  0,  0},
#endif

    {NULL,        NULL,          0,                          0}
};

#if !defined(LWS_WITHOUT_EXTENSIONS)
// websocket extensions
static const struct lws_extension extensions[] = {
    {"permessage-deflate", lws_extension_callback_pm_deflate, "permessage-deflate"},
    {"deflate-frame",      lws_extension_callback_pm_deflate, "deflate_frame"},
    {NULL, NULL, NULL}
};
#endif

#define ZIP_MOUNT "/"

static struct lws_protocol_vhost_options extra_mimetypes = {
    NULL, NULL, ".mjs", "text/javascript"
};

static struct lws_http_mount mount_domterm_zip = {
    NULL,                   /* linked-list pointer to next*/
    ZIP_MOUNT,              /* mountpoint in URL namespace on this vhost */
    "<change this>",      /* handler */
    "",   /* default filename if none given */
    NULL,
    NULL,
    &extra_mimetypes,
    NULL,
    0,
    0,
    0,
    0,
    0,
    0,
    LWSMPRO_FILE,   /* origin points to a callback */
    sizeof(ZIP_MOUNT)-1,
    NULL,
};

#define CHROME_OPTION 1000
#define FIREFOX_OPTION 1001
#define QTDOMTERM_OPTION 1002
#define ELECTRON_OPTION 1003
#define CHROME_APP_OPTION 1004
#define WEBVIEW_OPTION 1005
#define HEADLESS_OPTION 1006
#define VERBOSE_OPTION 1200
#define FORCE_OPTION 2001
#define DAEMONIZE_OPTION 2002
#define NO_DAEMONIZE_OPTION 2003
#define DETACHED_OPTION 2004
#define GEOMETRY_OPTION 2005
#define QT_REMOTE_DEBUGGING_OPTION 2006
#define NAME_OPTION 2007
#define SETTINGS_FILE_OPTION 2008
#define TTY_PACKET_MODE_OPTION 2009
#define PRINT_BROWSER_OPTION 2010
#define PANE_OPTIONS_START 2100
/* offsets from PANE_OPTIONS_START match 'N' in '\e[90;Nu' command */
#define PANE_OPTION (PANE_OPTIONS_START+pane_best)
#define TAB_OPTION (PANE_OPTIONS_START+pane_tab)
#define LEFT_OPTION (PANE_OPTIONS_START+pane_left)
#define RIGHT_OPTION (PANE_OPTIONS_START+pane_right)
#define ABOVE_OPTION (PANE_OPTIONS_START+pane_above)
#define BELOW_OPTION (PANE_OPTIONS_START+pane_below)
#define BROWSER_PIPE_OPTION (PANE_OPTIONS_START+15)

// command line options
static const struct option options[] = {
    {"port",         required_argument, NULL, 'p'},
    {"browser",      optional_argument, NULL, 'B'},
    {"window",       required_argument, NULL, 'w'},
    {"chrome",       no_argument,       NULL, CHROME_OPTION},
    {"chrome-app",   no_argument,       NULL, CHROME_APP_OPTION},
    {"google-chrome",no_argument,       NULL, CHROME_OPTION},
    {"firefox",      no_argument,       NULL, FIREFOX_OPTION},
    // TODO:  "--chrome-window" --> --new-window '%U'
    // "--chrome-tab" --> --new-tab '%U'
    // "--firefox-window" --> --new-window '%U'
    // "--firefox-tab" --> --new-tab '%U'
    {"qt",           no_argument,       NULL, QTDOMTERM_OPTION},
    {"electron",     no_argument,       NULL, ELECTRON_OPTION},
    {"webview",      no_argument,       NULL, WEBVIEW_OPTION},
    {"force",        no_argument,       NULL, FORCE_OPTION},
    {"daemonize",    no_argument,       NULL, DAEMONIZE_OPTION},
    {"no-daemonize", no_argument,       NULL, NO_DAEMONIZE_OPTION},
    {"name",         required_argument, NULL, NAME_OPTION},
    {"settings",     required_argument, NULL, SETTINGS_FILE_OPTION},
    {"tty-packet-mode",optional_argument,NULL,TTY_PACKET_MODE_OPTION},
    {"detached",     no_argument,       NULL, DETACHED_OPTION},
    {"headless",     no_argument,       NULL, HEADLESS_OPTION},
    {"geometry",     required_argument, NULL, GEOMETRY_OPTION},
    {"pane",         optional_argument, NULL, PANE_OPTION},
    {"tab",          optional_argument, NULL, TAB_OPTION},
    {"left",         optional_argument, NULL, LEFT_OPTION},
    {"right",        optional_argument, NULL, RIGHT_OPTION},
    {"above",        optional_argument, NULL, ABOVE_OPTION},
    {"below",        optional_argument, NULL, BELOW_OPTION},
    {"print-browser-command", no_argument,  NULL, PRINT_BROWSER_OPTION},
#if REMOTE_SSH
    {"browser-pipe", no_argument,       NULL, BROWSER_PIPE_OPTION},
#endif
    {"socket-name",  required_argument, NULL, 'L'},
    {"interface",    required_argument, NULL, 'i'},
    {"credential",   required_argument, NULL, 'c'},
    {"uid",          required_argument, NULL, 'u'},
    {"gid",          required_argument, NULL, 'g'},
    {"signal",       required_argument, NULL, 's'},
    {"reconnect",    required_argument, NULL, 'r'},
#if HAVE_OPENSSL
    {"ssl",          no_argument,       NULL, 'S'},
    {"ssl-cert",     required_argument, NULL, 'C'},
    {"ssl-key",      required_argument, NULL, 'K'},
    {"ssl-ca",       required_argument, NULL, 'A'},
#endif
    {"readonly",     no_argument,       NULL, 'R'},
    {"check-origin", no_argument,       NULL, 'O'},
    {"once",         no_argument,       NULL, 'o'},
    {"debug",        required_argument, NULL, 'd'},
    {"remote-debugging-port", required_argument, NULL, QT_REMOTE_DEBUGGING_OPTION},

    {"version",      no_argument,       NULL, 'v'},
    {"verbose",      no_argument,       NULL, VERBOSE_OPTION },
    {"help",         no_argument,       NULL, 'h'},
    {NULL, 0, 0,                              0}
};
static const char *opt_string = "+p:B::w:i:c:u:g:s:r:aSC:K:A:Rt:Ood:L:vh";

static const char* browser_specifiers[] = {
    // first 2 are windows-specific
    "edge",
    "edge-app",
    // macOS-specific
    "safari",
    // following are generic
    "firefox",
    "browser",
    "electron", "electron-widgets",
    "chrome",
    "chrome-app",
    "google-chrome",
    "qt", "qt-frames", "qt-widgets",
    "webview",
    "wry",
    "/",
    nullptr
};

void print_browsers_prefixed(const char *prefix, const char *before, FILE *out)
{
    size_t plen = strlen(prefix);
    const char **p =
        &browser_specifiers[is_WindowsSubsystemForLinux() ? 0 : 1];
    for (; *p; p++) {
        if (strncmp(prefix, *p, plen) == 0) {
            fprintf(out, "%s%s\n", before, *p);
        }
    }
    if (is_WindowsSubsystemForLinux()) {
    }
}

void print_options_prefixed(const char *prefix, const char *before, FILE *out)
{
    const struct option *p = options;
    size_t plen = strlen(prefix);
    for (; p->name; p++) {
        if (strncmp(prefix, p->name, plen) == 0) {
            const char *after = p->has_arg == required_argument ? "="
                : p->has_arg == no_argument ? " "
                : "";
            fprintf(out, "%s%s%s\n", before, p->name, after);
        }
    }
}

tty_server::tty_server()
{
    session_count = 0;
}

tty_server::~tty_server()
{
    if (socket_path != NULL) {
        struct stat st;
        if (!stat(socket_path, &st)) {
            unlink(socket_path);
        }
        free(socket_path);
    }
}

void
sig_handler(int sig) {
    if (force_exit)
        exit(EXIT_FAILURE);

    char sig_name[20];
    get_sig_name(sig, sig_name, sizeof(sig_name));
    lwsl_notice("received signal: %s (%d), exiting...\n", sig_name, sig);
    force_exit = true;
    tty_restore(-1);
    if (context)
        lws_cancel_service(context);
    lwsl_notice("send ^C to force exit.\n");
}

char *
get_bin_relative_path(const char* app_path)
{
    char* path = get_executable_path();
    int dirname_length = get_executable_directory_length();

    if (dirname_length > 4 && memcmp(path+dirname_length-4, "/bin", 4)==0)
        dirname_length -= 4;

    int app_path_length = strlen(app_path);
    size_t blen = dirname_length + app_path_length + 1;
    char *buf = (char*)xmalloc(blen);
    snprintf(buf, blen, "%.*s%s", dirname_length, path, app_path);
    return buf;
}

char *
get_domterm_jar_path()
{
    return get_bin_relative_path(DOMTERM_DIR_RELATIVE "/domterm.jar");
}

options::options()
{
    headless = false;
    http_server = false;
    something_done = false;
    verbosity = 0;
    paneOp = -1;
    force_option = 0;
    socket_name = NULL;
    do_daemonize = 1;
    debug_level = 0;
    iface = NULL;
#if defined(TIOCPKT) && defined(EXTPROC)
    tty_packet_mode = "extproc";
#else
    tty_packet_mode = "no";
#endif
#if HAVE_OPENSSL
    ssl = false;
    cert_path = NULL;
    key_path = NULL;
    ca_path = NULL;
#endif
    credential = NULL;
    once = false;
    reconnect = 10;
    sig_code = SIGHUP;
    sig_name = NULL; // FIXME
    qt_remote_debugging = NULL;
    fd_in = STDIN_FILENO;
    fd_out = STDOUT_FILENO;
    fd_err = STDERR_FILENO;
    fd_cmd_socket = -1;
    settings_file = NULL;
    shell_argv = NULL;
    env = NULL;
    cwd = NULL;
    remote_output_interval = 0;
    remote_input_timeout = 0;
    remote_output_timeout = 0;
}

options::~options()
{
    // FIXME implement to fix memory leaks
    free((void*) env);
    free((void*) cwd);
#if HAVE_OPENSSL
    free(cert_path);
    free(key_path);
    free(ca_path);
#endif
    free(credential);
    free(close_response);
    if (sig_name)
        free(sig_name);
}

struct options *link_options(struct options *opts)
{
    if (opts) {
        opts->reference_count++;
    } else {
        opts = new struct options;
        opts->reference_count = 1;
    }
    return opts;
}

void
options::release(struct options *opts)
{
    if (opts != main_options && --opts->reference_count == 0) {
        delete opts;
    }
}

static arglist_t default_argv = NULL;

arglist_t default_command(struct options *opts)
{
    if (opts != NULL && opts->shell_argv != NULL)
        return opts->shell_argv;
    else
        return default_argv;
}

void prescan_options(int argc, arglist_t argv, struct options *opts)
{
    // parse command line options
    optind = 1;
    opterr = 0;
    for (;;) {
        int c = getopt_long(argc, (char * const*) argv, opt_string, options, NULL);
        if (c == -1) {
            if (optind < argc && check_option_arg(argv[optind], opts)) {
                optind++;
                continue;
            }
            //fprintf(stderr, "after args optind:%d argc:%d next:%s\n", optind, argc, argv[optind]);
            break;
        }
        if (c == '?')
            break;
        switch (c) {
        case SETTINGS_FILE_OPTION:
            opts->settings_file = optarg;
            break;
        case VERBOSE_OPTION:
            opts->verbosity++;
            break;
        case 'd':
            opts->debug_level = atoi(optarg);
            break;
        }
    }
    opterr = 1;
}

void
print_version (FILE *out)
{
    if (git_describe[0])
        fprintf(out, "DomTerm version %s (git describe: %s)\n",
                LDOMTERM_VERSION, git_describe);
    else
        fprintf(out, "DomTerm version %s\n",
                LDOMTERM_VERSION);
    fprintf(out, "Copyright %s Per Bothner and others\n", LDOMTERM_YEAR);
#ifdef LWS_LIBRARY_VERSION
    fprintf(out, "Using Libwebsockets " LWS_LIBRARY_VERSION "\n");
#endif
}

int process_options(int argc, arglist_t argv, struct options *opts)
{
    // parse command line options
    optind = 1;
    for (;;) {
        int c = getopt_long(argc, (char * const*)argv, opt_string, options, NULL);
        if (c == -1) {
            const char *eq = optind >= argc ? NULL : strchr(argv[optind], '=');
            if (eq) {
                optind++;
                continue;
            }
            break;
        }
        switch (c) {
        case 'h':
            print_help(stderr);
            opts->something_done = true;
            break;
        case 'v':
            print_version(stdout);
            opts->something_done = true;
            break;
        case 'R':
            opts->readonly = true;
            break;
        case 'O':
            opts->check_origin = true;
            break;
        case 'o':
            opts->once = true;
            break;
        case 'p':
            info.port = atoi(optarg);
            port_specified = info.port;
            if (info.port < 0) {
                fprintf(stderr, "domterm: invalid port: %s\n", optarg);
                return -1;
            }
            break;
        case 'B':
            opts->browser_command = optarg == NULL ? "browser" : optarg;
            break;
        case 'w':
            opts->windows = optarg;
            break;
        case FORCE_OPTION:
            opts->force_option = 1;
            break;
        case NO_DAEMONIZE_OPTION:
        case DAEMONIZE_OPTION:
            opts->do_daemonize = (c == DAEMONIZE_OPTION);
            break;
        case NAME_OPTION:
            opts->name_option = optarg;
            break;
        case TTY_PACKET_MODE_OPTION:
            if (optarg != NULL) {
#if !defined(TIOCPKT)
                if (strcmp(optarg, "yes") == 0)
                    fprintf(stderr, "warning - tty package mode not available\n");
#endif
#if ! defined(EXTPROC)
                if (strcmp(optarg, "extproc") == 0)
                    fprintf(stderr, "warning - tty package mode EXTPROC not available\n");
#endif
            }
            opts->tty_packet_mode = optarg == NULL ? "yes" : optarg;
            break;
        case VERBOSE_OPTION:
        case SETTINGS_FILE_OPTION:
        case 'd':
            break; // handled in prescan_options
        case TAB_OPTION:
        case LEFT_OPTION:
        case RIGHT_OPTION:
        case BELOW_OPTION:
        case ABOVE_OPTION:
            opts->paneOp = c - PANE_OPTIONS_START;
            opts->paneBase = argv[optind-1];
            break;
        case PRINT_BROWSER_OPTION:
            opts->print_browser_only = true;
            break;
        case PANE_OPTION:
#if REMOTE_SSH
        case BROWSER_PIPE_OPTION:
#endif
            opts->paneOp = c - PANE_OPTIONS_START;
            /* ... fall through ... */
        case DETACHED_OPTION:
            opts->browser_command = argv[optind-1];
            break;
        case ELECTRON_OPTION:
        case FIREFOX_OPTION:
            opts->browser_command = argv[optind-1] + 2; // Skip '--'
            break;
        case HEADLESS_OPTION:
            opts->headless = true;
            break;
        case GEOMETRY_OPTION: {
            regex_t rx;
#define SZ_REGEX "[0-9]+x[0-9]+"
#define POS_REGEX "[-+][0-9]+[-+][0-9]+"
#define GEOM_REGEX "^" SZ_REGEX "$|^" POS_REGEX "$|^" SZ_REGEX POS_REGEX "$"
            regcomp(&rx, GEOM_REGEX, REG_EXTENDED|REG_NOSUB);
            if (regexec(&rx, optarg, 0, NULL, 0)) {
                fprintf(stderr, "bad geometry specifier '%s'\n", optarg);
                fprintf(stderr, "must have the form: [{WIDTH}x{HEIGHT}][{+-}{XOFF}{+-}{YOFF}]\n");
                exit(-1);
            }
            regfree(&rx);
            opts->geometry_option = optarg;
        }
            break;
        case CHROME_OPTION:
            opts->browser_command = "chrome";
            break;
        case CHROME_APP_OPTION:
            opts->browser_command = "chrome-app";
            break;
        case QTDOMTERM_OPTION:
            opts->browser_command = "qt";
            break;
        case WEBVIEW_OPTION:
            opts->browser_command = "webview";
            break;
        case QT_REMOTE_DEBUGGING_OPTION:
            opts->qt_remote_debugging = strdup(optarg);
            break;
        case 'L':
            opts->socket_name = strdup(optarg);
            break;
        case 'i':
            if (opts->iface != NULL)
                free(opts->iface);
            break;
        case 'c':
            if (strchr(optarg, ':') == NULL) {
                fprintf(stderr, "domterm: invalid credential, format: username:password\n");
                return -1;
            }
            opts->credential = base64_encode((const unsigned char *) optarg, strlen(optarg));
            break;
        case 'u':
            info.uid = atoi(optarg);
            break;
        case 'g':
            info.gid = atoi(optarg);
            break;
        case 's': {
            int sig = get_sig(optarg);
            if (sig > 0) {
                opts->sig_code = get_sig(optarg);
                opts->sig_name = uppercase(strdup(optarg));
            } else {
                fprintf(stderr, "domterm: invalid signal: %s\n", optarg);
                return -1;
            }
        }
            break;
        case 'r':
            opts->reconnect = atoi(optarg);
            if (opts->reconnect <= 0) {
                fprintf(stderr, "domterm: invalid reconnect: %s\n", optarg);
                return -1;
            }
            break;
#if HAVE_OPENSSL
        case 'S':
            opts->ssl = true;
            break;
        case 'C':
            if (opts->cert_path != NULL)
                free(opts->cert_path);
            opts->cert_path = strdup(optarg);
            break;
        case 'K':
            if (opts->key_path != NULL)
                free(opts->key_path);
            opts->key_path = strdup(optarg);
            break;
        case 'A':
            if (opts->ca_path != NULL)
                free(opts->ca_path);
            opts->ca_path = strdup(optarg);
            break;
#endif
        case '?':
            return -1;
        default:
            print_help(stderr);
            return -1;
        }
    }
    return 0;
}

int
main(int argc, char **argv)
{
    argv0 = argv[0];
    memset(&info, 0, sizeof(info));
#if LWS_LIBRARY_VERSION_NUMBER <= 2004002
    // See "problems with big dynamic content" thread on libwebsockets list
    info.keepalive_timeout = 0x7fffffff;
#endif
    info.port = 0;
    info.iface = NULL;
    info.protocols = protocols;
#if HAVE_OPENSSL
    info.ssl_cert_filepath = NULL;
    info.ssl_private_key_filepath = NULL;
#endif
    info.gid = -1;
    info.uid = -1;
    info.max_http_header_pool = 16;
    info.options = LWS_SERVER_OPTION_VALIDATE_UTF8|LWS_SERVER_OPTION_EXPLICIT_VHOSTS;
#if !defined(LWS_WITHOUT_EXTENSIONS)
    info.extensions = extensions;
#endif
    info.timeout_secs = 5;
#ifdef RESOURCE_DIR
    mount_domterm_zip.origin = get_resource_path();
#endif
    info.mounts = &mount_domterm_zip;

    const char *shell = getenv("SHELL");
    if (shell == NULL)
        shell = DEFAULT_SHELL;
    default_argv = parse_args(shell, false);

    prescan_options(argc, (arglist_t) argv, &opts);

    read_settings_file(&opts, false);
    set_settings(&opts);

    int debug_level = opts.debug_level;
    const char *logfilefmt = get_setting(opts.settings, "log.file");
    if (debug_level == 0 && opts.verbosity > 0) {
        debug_level = LLL_ERR|LLL_WARN|LLL_NOTICE
            |(opts.verbosity > 1 ? LLL_INFO : 0);
        if (logfilefmt == NULL)
            logfilefmt = "notimestamp";
    }
    if (debug_level == 0) {
        const char *to_server = get_setting(opts.settings, "log.js-to-server");
        if (to_server && (strcmp(to_server, "true") == 0
                          || strcmp(to_server, "yes") == 0
                          || strcmp(to_server, "both") == 0))
            debug_level = LLL_ERR|LLL_NOTICE;
    }

    if (logfilefmt == NULL)
        logfilefmt = "/tmp/domterm-%P.log";
    if (debug_level == 0)
        lws_set_log_level(debug_level, NULL);
    else if (strcmp(logfilefmt, "stderr") == 0)
        lws_set_log_level(debug_level, lwsl_emit_stderr);
    else if (strcmp(logfilefmt, "stdout") == 0) {
        _logfile = stdout;
        lws_set_log_level(debug_level, lwsl_emit_stderr_with_flush);
    } else if (strcmp(logfilefmt, "stderr-notimestamp") == 0
               || strcmp(logfilefmt, "notimestamp") == 0)
        lws_set_log_level(debug_level, lwsl_emit_stderr_notimestamp);
    else {
        struct sbuf sb;
        const char *p = logfilefmt;
        for (; *p; p++) {
            const char *pc = strchr(p, '%');
            if (pc == NULL) {
                sb.append(p);
                break;
            }
            sb.append(p, pc-p);
            p = pc+1;
            if (pc[1] == 'P') {
                sb.printf("%d", getpid());
            } else if (pc[1] == '%') {
                sb.append("%", 1);
            }
        }
        sb.append("", 1);
        _logfile = fopen((const char *) sb.buffer, "a");
        lws_set_log_level(debug_level, lwsl_emit_stderr_with_flush);
    }

    lwsl_notice("domterm terminal server %s (git describe: %s)\n",
                LDOMTERM_VERSION, git_describe);
    if ((debug_level & LLL_NOTICE) != 0) {
        struct sbuf sb;
        maybe_quote_args(argv, argc, sb);
        lwsl_notice("invoked as:%.*s\n", (int) sb.len, sb.buffer);
    }
    lwsl_notice("Copyright %s Per Bothner and others\n", LDOMTERM_YEAR);
#ifdef LWS_LIBRARY_VERSION
    lwsl_notice("Using Libwebsockets " LWS_LIBRARY_VERSION "\n");
#endif

    read_settings_emit_notice();

    if (process_options(argc, (arglist_t) argv, &opts) != 0)
        return EXIT_BAD_CMDARG;
    if (opts.something_done && argv[optind] == NULL)
        return EXIT_SUCCESS;

    signal(SIGINT, sig_handler);  // ^C
    signal(SIGTERM, sig_handler); // kill

    const char *cmd = argv[optind];
    struct command *command = cmd == NULL ? NULL : find_command(cmd);
    if (command == NULL && cmd != NULL && index(cmd, '/') == NULL
#if REMOTE_SSH
        && strchr(cmd, '@') == NULL
#endif
        ) {
        fprintf(stderr, "domterm: unknown command '%s'\n", cmd);
        exit(EXIT_FAILURE);
    }
    if (command && (command->options & COMMAND_IN_SERVER) != 0
        && (command->options & COMMAND_CHECK_DOMTERM) != 0) {
        check_domterm(&opts);
    }
    int socket = -1;
    if ((command == NULL ||
         (command->options &
          (COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER)) != 0)) {
        backend_socket_name = make_socket_name(false);
        socket = client_connect(backend_socket_name);
    }
    if (command != NULL
        && ((command->options & COMMAND_IN_CLIENT) != 0
            || ((command->options & COMMAND_IN_CLIENT_IF_NO_SERVER) != 0
                && socket < 0))) {
        lwsl_notice("handling command '%s' locally\n", command->name);
        if (command->options == COMMAND_IN_EXISTING_SERVER) {
            if (&opts == main_options) { // client mode
                printf_error(&opts, "no current windows (no server running)");
                return EXIT_FAILURE;
            }
        }
        exit((*command->action)(argc-optind, (arglist_t)argv+optind, &opts));
    }
    if (socket >= 0) {
        exit(client_send_command(socket, argc, argv, environ));
    }

    if (port_specified < 0)
        tserver.client_can_close = true;

#if LWS_LIBRARY_VERSION_MAJOR >= 2
    char server_hdr[128] = "";
    snprintf(server_hdr, sizeof(server_hdr), "domterm/%s (libwebsockets/%s)",
             LDOMTERM_VERSION, LWS_LIBRARY_VERSION);
    info.server_string = server_hdr;
#endif

#if 0
    if (strlen(iface) > 0) {
        info.iface = iface;
        if (endswith(info.iface, ".sock") || endswith(info.iface, ".socket")) {
#ifdef LWS_USE_UNIX_SOCK
            info.options |= LWS_SERVER_OPTION_UNIX_SOCK;
            server->socket_path = strdup(info.iface);
#else
            fprintf(stderr, "libwebsockets is not compiled with UNIX domain socket support");
            return -1;
#endif
        }
    }
#endif
#if HAVE_OPENSSL
    if (opts.ssl) {
        info.ssl_cert_filepath = opts.cert_path;
        info.ssl_private_key_filepath = opts.key_path;
        info.ssl_ca_filepath = opts.ca_path;
        info.ssl_cipher_list = "ECDHE-ECDSA-AES256-GCM-SHA384:"
            "ECDHE-RSA-AES256-GCM-SHA384:"
            "DHE-RSA-AES256-GCM-SHA384:"
            "ECDHE-RSA-AES256-SHA384:"
            "HIGH:!aNULL:!eNULL:!EXPORT:"
            "!DES:!MD5:!PSK:!RC4:!HMAC_SHA1:"
            "!SHA1:!DHE-RSA-AES128-GCM-SHA256:"
            "!DHE-RSA-AES128-SHA256:"
            "!AES128-GCM-SHA256:"
            "!AES128-SHA256:"
            "!DHE-RSA-AES256-SHA256:"
            "!AES256-GCM-SHA384:"
            "!AES256-SHA256";
        if (info.ssl_ca_filepath != NULL && strlen(info.ssl_ca_filepath) > 0)
            info.options |= LWS_SERVER_OPTION_REQUIRE_VALID_OPENSSL_CLIENT_CERT;
#if LWS_LIBRARY_VERSION_MAJOR >= 2
        info.options |= LWS_SERVER_OPTION_REDIRECT_HTTP_TO_HTTPS;
#endif
    }
#endif

    context = lws_create_context(&info);
    if (context == NULL) {
        lwsl_err("libwebsockets init failed\n");
        return 1;
    }
    vhost = lws_create_vhost(context, &info);
#if LWS_LIBRARY_VERSION_MAJOR >= 3
    http_port = lws_get_vhost_port(vhost);
#else
    http_port = info.port;
#endif

    lwsl_notice("creating server socket: '%s'\n",  backend_socket_name);
    lws_sock_file_fd_type csocket;
    csocket.filefd = create_command_socket(backend_socket_name);
    cmdwsi = lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC,
                                        csocket, "cmd", NULL);
    cclient = (struct cmd_client *) lws_wsi_user(cmdwsi);
    cclient->socket = csocket.filefd;
    main_html_prefix = make_socket_name(true);
    generate_random_string(server_key, SERVER_KEY_LENGTH);

    lwsl_info("TTY configuration:\n");
    if (opts.credential != NULL)
        lwsl_info("  credential: %s\n", opts.credential);
    lwsl_info("  reconnect timeout: %ds\n", opts.reconnect);
    lwsl_info("  close signal: %s (%d)\n",
              opts.sig_name != NULL ? opts.sig_name :
              opts.sig_code == SIGHUP ? "SIGHUP" : "???",
              opts.sig_code);
    if (opts.check_origin)
        lwsl_info("  check origin: true\n");
    if (opts.readonly)
        lwsl_info("  readonly: true\n");
    if (opts.once)
        lwsl_info("  once: true\n");
    int ret;
    if (port_specified >= 0 && opts.browser_command.empty()) {
        fprintf(stderr, "Server start on port %d. You can browse %s://localhost:%d/\n",
                http_port, opts.ssl ? "https" : "http", http_port);
        opts.http_server = true;
        ret = 0;
    } else {
        opts.cwd = getcwd(NULL, 0);
        opts.env = copy_strings((const char*const*) environ);
        ret = handle_command(argc-optind, (arglist_t)argv+optind, &opts);
        if (ret == EXIT_FAILURE)
            exit(ret);
    }

    if (ret == 0)
        maybe_daemonize();
    watch_settings_file();

    // libwebsockets main loop
    while (!force_exit) {
        lws_service(context, 100);
    }

    lws_context_destroy(context);

    return ret;
}

bool
is_SwayDesktop()
{
    char *desktop = getenv("XDG_SESSION_DESKTOP");
    return desktop != nullptr && strcmp(desktop, "sway") == 0;
}

bool
is_WindowsSubsystemForLinux()
{
    static int is_WSL_cache;
    if (is_WSL_cache)
        return is_WSL_cache > 0;
    int r;
    int f = open("/proc/version", O_RDONLY);
    if (f < 0)
        r = false;
    else {
        char buf[512];
        int i = 0;
        for (;;) {
            size_t avail = sizeof(buf) - 1 - i;
            if (avail <= 0)
                break;
            ssize_t n = read(f, buf+i, avail);
            if (n <= 0)
                break;
            i += n;
        }
        buf[i] = '\0';
	// In WSL1 the version contains upper-case "Microsoft"
	// In WSL2 the version contains "microsoft-standard-WSL2"
        r = strstr(buf, "icrosoft") != NULL;
        close(f);
    }
    is_WSL_cache = r ? 1 : -1;
    return r;
}

static char *userprofile_cache;

char *get_WSL_userprofile()
{
    if (userprofile_cache == NULL) {
        sbuf sb;
        int px = popen_read("/mnt/c/Windows/System32/cmd.exe /c \"<nul set /p=%UserProfile%\" 2>/dev/null", sb);
        if (! WIFEXITED(px))
            return NULL;
        char *buf = sb.null_terminated();
        char *nl = strchr(buf, '\n');
        if (nl)
            *nl = '\0';
        char *cr = strchr(buf, '\r');
        if (cr)
            *cr = '\0';
        userprofile_cache = strdup(buf);
    }
    return userprofile_cache;
}

static const char *
domterm_dir(bool settings, bool check_wsl)
{
    char *user_profile;
    const char *user_prefix = "C:\\Users\\";
    size_t user_prefix_length;
    char *tmp;
    char *xdg_home = getenv(settings ? "XDG_CONFIG_HOME" : "XDG_RUNTIME_DIR");
    const char *sini = settings ? "/settings.ini" : "";
    if (xdg_home) {
        size_t tlen = strlen(xdg_home)+40;
	tmp = challoc(tlen);
	snprintf(tmp, tlen, "%s/domterm%s", xdg_home, sini);
    } else if (check_wsl && is_WindowsSubsystemForLinux()
               && (user_profile = get_WSL_userprofile()) != NULL
               && strlen(user_profile) > (user_prefix_length = strlen(user_prefix))
               && memcmp(user_profile, user_prefix, user_prefix_length) == 0) {
	const char *fmt = "/mnt/c/Users/%s/AppData/%s/DomTerm%s";
	const char *subdir = settings ? "Roaming" : "Local";
        size_t tlen = strlen(fmt) + strlen(user_profile) + 40;
	tmp = challoc(tlen);
	snprintf(tmp, tlen, fmt, user_profile+user_prefix_length, subdir, sini);
    } else {
        const char *home = find_home();
        size_t tlen = strlen(home)+30;
        tmp = challoc(tlen);
        snprintf(tmp, tlen, "%s/.domterm%s", home, sini);
        if (settings && access(tmp, R_OK) != 0)
            snprintf(tmp, tlen, "%s/.config/domterm%s", home, sini);
        else
            snprintf(tmp, tlen, "%s/.domterm%s", home, sini);
    }
    if (! settings && mkdir(tmp, S_IRWXU) != 0 && errno != EEXIST)
        fatal("cannot create directory '%s'", tmp);
    return tmp;
}

const char *
domterm_settings_default()
{
    static const char *dir = NULL;
    if (dir == NULL)
        dir = domterm_dir(true, true);
    return dir;
}

const char *
domterm_socket_dir()
{
    static const char *dir = NULL;
    if (dir == NULL)
        dir = domterm_dir(false, false);
    return dir;
}

const char *
domterm_genhtml_dir()
{
    static const char *dir = NULL;
    if (dir == NULL)
        dir = domterm_dir(false, true);
    return dir;
}

static char *
make_socket_name(bool html_filename)
{
    const char *ddir = html_filename ? domterm_genhtml_dir()
        : domterm_socket_dir();
    char *r;
    char *socket_name = opts.socket_name;
    if (socket_name != NULL && socket_name[0] != 0) {
        int dot = -1;
        for (int i = 0; ; i++) {
            char ch = socket_name[i];
            if (ch == 0)
                break;
            if (ch == '.')
                dot = i;
            if (ch == '/')
                dot = -1;
        }
	int socket_name_length = strlen(socket_name);
        const char *ext;
	if (html_filename) {
            ext = ""; //.html";
	    if (dot >= 0)
                socket_name_length = dot;
	} else
            ext = dot < 0 ? ".socket" : "";
        int len = socket_name_length + strlen(ext);
        if (socket_name[0] != '/') {
            size_t rlen = len + strlen(ddir) + 2;
            r = challoc(rlen);
            snprintf(r, rlen, "%s/%.*s%s",
                     ddir, socket_name_length, socket_name, ext);
        } else {
            r = challoc(len + 1);
            snprintf(r, len + 1, "%.*s%s",
                     socket_name_length, socket_name, ext);
        }
    } else {
        const char *sname = html_filename ? "/start" : "/default.socket";
        size_t rlen = strlen(ddir)+strlen(sname)+1;
        r = challoc(rlen);
        snprintf(r, rlen, "%s%s", ddir, sname);
    }
    return r;
}

char server_key[SERVER_KEY_LENGTH];

static const char * standard_stylesheets[] = {
    "hlib/domterm-core.css",
    "hlib/domterm-standard.css",
    "hlib/goldenlayout/css/goldenlayout-base.css",
    "hlib/goldenlayout/css/themes/goldenlayout-light-theme.css",
    "hlib/jsMenus.css",
    "hlib/domterm-layout.css",
    "hlib/domterm-default.css",
#if WITH_XTERMJS
    "hlib/xterm.css",
#endif
    NULL
};
static const char * standard_stylesheets_disabled[] = {
    "hlib/goldenlayout/css/themes/goldenlayout-dark-theme.css",
    NULL
};
static const char * standard_stylesheets_simple[] = {
    "hlib/domterm-core.css",
    "hlib/domterm-standard.css",
    "hlib/domterm-default.css",
#if WITH_XTERMJS
    "hlib/xterm.css",
#endif
    NULL
};
struct lib_info {
    const char *file;
    int options;
};

static struct lib_info standard_jslibs[] = {
    {"hlib/domterm-version.js", LIB_WHEN_OUTER|LIB_WHEN_SIMPLE},
    {"hlib/domterm.js", LIB_WHEN_OUTER|LIB_WHEN_SIMPLE},
#if COMBINE_RESOURCES
    {"hlib/dt-combined.js", LIB_WHEN_SIMPLE},
#else
    {"hlib/terminal.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
#if ! WITH_XTERMJS
    {"hlib/domterm-parser.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
#endif
    {"hlib/browserkeymap.js", LIB_WHEN_SIMPLE},
    {"hlib/commands.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
    {"hlib/mark.es6.js", LIB_WHEN_SIMPLE},
    {"hlib/domterm-findtext.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
    {"hlib/FileSaver.js", LIB_WHEN_SIMPLE},
#endif
#if COMBINE_RESOURCES
    {"hlib/dt-outer.js", LIB_WHEN_OUTER},
#else
    {"hlib/domterm-menus.js", LIB_WHEN_OUTER},
    {"hlib/qwebchannel.js", LIB_WHEN_OUTER|LIB_WHEN_SIMPLE},
    {"hlib/jsMenus.js", LIB_WHEN_OUTER},
    {"hlib/screenfull.js", LIB_WHEN_OUTER},
#endif
    {"hlib/domterm-client.js", LIB_WHEN_OUTER|LIB_WHEN_SIMPLE|LIB_AS_MODULE},
#if WITH_XTERMJS
    {"hlib/xterm.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
    {"hlib/fit.js", LIB_WHEN_SIMPLE|LIB_AS_MODULE},
#endif
    {NULL, 0},
};

void
make_html_text(struct sbuf *obuf, int port, int hoptions,
               const char *body_text, int body_length)
{
    char base[40];
    bool simple = (hoptions & LIB_WHEN_OUTER) == 0;
    snprintf(base, sizeof(base), "http://%s:%d/", "localhost", port);
    obuf->printf("<!DOCTYPE html>\n"
                 "<html><head>\n"
                 "<base href='%s'/>\n"
                 "<meta http-equiv='Content-Type' content='text/html;"
                 " charset=UTF-8'>\n"
                 "<title>DomTerm</title>\n",
                 base);
    const char **p;
    for (p = simple ? standard_stylesheets_simple : standard_stylesheets; *p; p++) {
        obuf->printf("<link type='text/css' rel='stylesheet' href='%s'>\n", *p);
    }
    if (! simple) {
        for (p = standard_stylesheets_disabled; *p; p++) {
            obuf->printf("<link type='text/css' rel='stylesheet' href='%s' disabled='true'>\n", *p);
        }
    }
    struct lib_info *lib;
    for (lib = standard_jslibs; lib->file != NULL; lib++) {
        const char *jstype = (lib->options & LIB_AS_MODULE) ? "module" : "text/javascript";
        if ((hoptions & lib->options & (LIB_WHEN_SIMPLE|LIB_WHEN_OUTER)) != 0)
            obuf->printf("<script type='%s' src='%s'> </script>\n",
                         jstype, lib->file);
    }
    if ((hoptions & LIB_WHEN_OUTER) != 0)
        obuf->printf("<script type='text/javascript'>\n"
                     "DomTerm.server_port = %d;\n"
                     "DomTerm.server_key = '%.*s';\n"
                     "</script>\n",
                     port, SERVER_KEY_LENGTH, server_key);
    obuf->printf("</head>\n<body>%.*s</body>\n</html>\n",
                 body_length, body_text);
}

int
callback_browser_cmd(struct lws *wsi, enum lws_callback_reasons reason,
                     void *user, void *in, size_t len) {
    struct browser_cmd_client *cclient = (struct browser_cmd_client *) lws_wsi_user(wsi);
    int status = -1;
    //lwsl_info("browser_cmd callback %d\n", reason);
    switch (reason) {
    case LWS_CALLBACK_RAW_CLOSE_FILE:
        while (waitpid(cclient->cmd_pid, &status, 0) == -1 && errno == EINTR)
            ;
        lwsl_notice("frontend exited with code %d exitcode:%d, pid: %d\n", status, WEXITSTATUS(status), cclient->cmd_pid);
        delete cclient;
        lws_set_wsi_user(wsi, NULL);
        maybe_exit(status == -1 || ! WIFEXITED(status) ? 0
               : WEXITSTATUS(status));
        break;
    case LWS_CALLBACK_RAW_WRITEABLE_FILE: {
        struct sbuf &ibuf = cclient->send_buffer;
        int to_write = ibuf.len - LWS_PRE;
        size_t n =lws_write(cclient->wsi, (unsigned char*) ibuf.buffer+LWS_PRE,
                            to_write, LWS_WRITE_BINARY);
        if (n != to_write)
             lwsl_err("lws_write failure in callback_browser_cmd\n");
        ibuf.len = LWS_PRE;
        break;
    }
    case LWS_CALLBACK_RAW_RX_FILE: {
        struct sbuf &obuf = cclient->output_buffer;
        obuf.extend(1024);
        ssize_t rcount = read(cclient->fd, obuf.avail_start(), obuf.avail_space());
        if (rcount <= 0) {
            if (rcount == 0)
                return 0;
            lwsl_err("browser_cmd failed read from browser errno:%s\n", strerror(errno));
            if (errno == EAGAIN)
                return 0;
            return -1;
        }
        obuf.len += rcount;
        while (obuf.len > 0) {
            char *text = obuf.null_terminated();
            char *newline = strchr(text, '\n');
            if (newline == nullptr)
                break;
            size_t linelen = newline - obuf.buffer;
            *newline = '\0';
            char *cmd = obuf.buffer;
            if (cmd[0])
                lwsl_info("browser_cmd received '%s'\n", cmd);
            if (strncmp(cmd, "CLOSE-WINDOW ", 13) == 0) {
                char *end;
                long wnum = strtol(cmd+13, &end, 10);
                tty_client *mclient = wnum > 0 && ! end[0] ? main_windows(wnum) : nullptr;
                if (mclient) {
                    lwsl_info("frontend window %ld closed\n", wnum);
                    mclient->keep_after_unexpected_close = false;
                    if (mclient->wsi == nullptr)
                        delete mclient;
                    FORALL_WSCLIENT(mclient) {
                        if (mclient->main_window == wnum) {
                            mclient->keep_after_unexpected_close = false;
                            if (mclient->wsi == nullptr)
                                delete mclient;
                        }
                    }
                }
            } else if (strncmp(cmd, "ACTION ", 7) == 0) {
                const char *rest = cmd + 7;
                lwsl_info("requested action '%s'\n", rest);
                if (strcmp(rest, "quit-domterm") == 0) {
                    do_exit(0, true);
                }
                if (strcmp(rest, "new-window") == 0) {
                    open_window("{}", main_options);
                }
            }
            obuf.erase(0, linelen+1);
        }
    }
        break;
    default:
        break;
    }
    return 0;
}

void
error(const char *format, ...)
{
    va_list args;
    va_start (args, format);
    vfprintf (stderr, format, args);
    va_end (args);
    fprintf (stderr, "\n");
}

void
fatal(const char *format, ...)
{
    va_list args;
    va_start (args, format);
    vfprintf (stderr, format, args);
    va_end (args);
    fprintf (stderr, "\n");
    exit(-1);
}

#if 0
/*
 * Get server create lock. If already held then server start is happening in
 * another client, so block until the lock is released and return -2 to
 * retry. Return -1 on failure to continue and start the server anyway.
 */
static int
client_get_lock(char *lockfile)
{
    int lockfd;

    lwsl_notice("lock file is %s\n", lockfile);

    if ((lockfd = open(lockfile, O_WRONLY|O_CREAT, 0600)) == -1) {
        lwsl_notice("open failed: %s\n", strerror(errno));
        return (-1);
    }

    if (flock(lockfd, LOCK_EX|LOCK_NB) == -1) {
        lwsl_notice("flock failed: %s\n", strerror(errno));
        if (errno != EAGAIN)
            return (lockfd);
        while (flock(lockfd, LOCK_EX) == -1 && errno == EINTR)
            /* nothing */;
        close(lockfd);
        return (-2);
    }
    lwsl_notice("flock succeeded\n");

    return (lockfd);
}
#endif

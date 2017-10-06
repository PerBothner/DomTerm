#include "server.h"
#include <sys/file.h>
#include <sys/un.h>

#if 1
#include "version.h"
#else
#define LDOMTERM_VERSION "1.2.2"
#endif

#ifndef DEFAULT_ARGV
#define DEFAULT_ARGV {"/bin/bash", NULL }
#endif

static void make_html_file(int);
static char *make_socket_name(void);
static int create_command_socket(const char *);
static int client_connect (char *socket_path, int start_server);

void
subst_run_command (const char *browser_command, const char *url, int port)
{
    size_t clen = strlen(browser_command);
    char *cmd = xmalloc(clen + strlen(url) + 10);
    char *upos = strstr(browser_command, "%U");
    char *wpos;
    if (upos) {
      size_t beforeU = upos - browser_command;
      sprintf(cmd, "%.*s%s%.*s",
              beforeU, browser_command,
              url,
              clen - beforeU - 2, upos+2);
    } else if ((wpos = strstr(browser_command, "%W")) != NULL) {
        size_t beforeW = wpos - browser_command;
        sprintf(cmd, "%.*s%d%.*s",
                beforeW, browser_command,
                port,
                clen - beforeW - 2, wpos+2);
    } else
        sprintf(cmd, "%s %s", browser_command, url);
    lwsl_notice("frontend command: %s\n", cmd);
    system(cmd);
}

static char *browser_command = NULL;
static int paneOp = -1;
static int port_specified = -1;
volatile bool force_exit = false;
struct lws_context *context;
struct tty_server *server;
struct lws_vhost *vhost;
struct lws *focused_wsi = NULL;
struct lws_context_creation_info info;
struct cmd_client *cclient;
int last_session_number = 0;
const char *(default_argv[]) = DEFAULT_ARGV;

static const struct lws_protocols protocols[] = {
        /* http server for (mostly) static data */
        {"http-only", callback_http, 0,                          0},

        /* websockets server for communicating with browser */
        {"domterm",   callback_tty,  sizeof(struct tty_client),  0},

        /* callbacks for pty I/O, one pty for each session (process) */
        {"pty",       callback_pty,  sizeof(struct pty_client),  0},

        /* Unix domain socket for client to send to commands to server */
        {"cmd",       callback_cmd,  sizeof(struct cmd_client),  0},

        {NULL,        NULL,          0,                          0}
};

// websocket extensions
static const struct lws_extension extensions[] = {
        {"permessage-deflate", lws_extension_callback_pm_deflate, "permessage-deflate"},
        {"deflate-frame",      lws_extension_callback_pm_deflate, "deflate_frame"},
        {NULL, NULL, NULL}
};

#define ZIP_MOUNT "/" 

static struct lws_http_mount mount_domterm_zip = {
        NULL,                   /* linked-list pointer to next*/
        ZIP_MOUNT,              /* mountpoint in URL namespace on this vhost */
        "<change this>",      /* handler */
        "repl-client.html",   /* default filename if none given */
        NULL,
        NULL,
        NULL,
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

        { NULL, NULL } // sentinel
};

#define CHROME_OPTION 1000
#define FIREFOX_OPTION 1001
#define QTDOMTERM_OPTION 1002
#define ELECTRON_OPTION 1003
#define FORCE_OPTION 2001
#define DAEMONIZE_OPTION 2002
#define NO_DAEMONIZE_OPTION 2003
#define DETACHED_OPTION 2004
#define PANE_OPTIONS_START 2100
/* offsets from PANE_OPTIONS_START match 'N' in '\e[90;Nu' command */
#define PANE_OPTION (PANE_OPTIONS_START+1)
#define TAB_OPTION (PANE_OPTIONS_START+2)
#define LEFT_OPTION (PANE_OPTIONS_START+10)
#define RIGHT_OPTION (PANE_OPTIONS_START+11)
#define ABOVE_OPTION (PANE_OPTIONS_START+12)
#define BELOW_OPTION (PANE_OPTIONS_START+13)

// command line options
static const struct option options[] = {
        {"port",         required_argument, NULL, 'p'},
        {"browser",      optional_argument, NULL, 'B'},
        {"chrome",       no_argument,       NULL, CHROME_OPTION},
        {"google-chrome",no_argument,       NULL, CHROME_OPTION},
        {"firefox",      no_argument,       NULL, FIREFOX_OPTION},
        {"qtdomterm",    no_argument,       NULL, QTDOMTERM_OPTION},
        {"qtwebengine",  no_argument,       NULL, QTDOMTERM_OPTION},
        {"electron",     no_argument,       NULL, ELECTRON_OPTION},
        {"force",        no_argument,       NULL, FORCE_OPTION},
        {"daemonize",    no_argument,       NULL, DAEMONIZE_OPTION},
        {"no-daemonize", no_argument,       NULL, NO_DAEMONIZE_OPTION},
        {"detached",     no_argument,       NULL, DETACHED_OPTION},
        {"pane",         no_argument,       NULL, PANE_OPTION},
        {"tab",          no_argument,       NULL, TAB_OPTION},
        {"left",         no_argument,       NULL, LEFT_OPTION},
        {"right",        no_argument,       NULL, RIGHT_OPTION},
        {"above",        no_argument,       NULL, ABOVE_OPTION},
        {"below",        no_argument,       NULL, BELOW_OPTION},
        {"interface",    required_argument, NULL, 'i'},
        {"credential",   required_argument, NULL, 'c'},
        {"uid",          required_argument, NULL, 'u'},
        {"gid",          required_argument, NULL, 'g'},
        {"signal",       required_argument, NULL, 's'},
        {"reconnect",    required_argument, NULL, 'r'},
        {"index",        required_argument, NULL, 'I'},
        {"ssl",          no_argument,       NULL, 'S'},
        {"ssl-cert",     required_argument, NULL, 'C'},
        {"ssl-key",      required_argument, NULL, 'K'},
        {"ssl-ca",       required_argument, NULL, 'A'},
        {"readonly",     no_argument,       NULL, 'R'},
        {"check-origin", no_argument,       NULL, 'O'},
        {"once",         no_argument,       NULL, 'o'},
        {"debug",        required_argument, NULL, 'd'},
        {"version",      no_argument,       NULL, 'v'},
        {"help",         no_argument,       NULL, 'h'},
        {NULL, 0, 0,                              0}
};
static const char *opt_string = "+p:B::i:c:u:g:s:r:I:aSC:K:A:Rt:Ood:vh";

void print_help() {
    fprintf(stderr, "ldomterm is a terminal emulator that uses web technologies\n\n"
                    "USAGE:\n"
                    "    ldomterm [options] [<command> [<arguments...>]]\n\n"
                    "VERSION:\n"
                    "    %s\n\n"
                    "OPTIONS:\n"
                    "    --browser[=command]     Create browser window for terminal.\n"
                    "                            The command can have a '%U' which is replaced by a URL; otherwise ' %U' is append to the command,\n"
                    "                            If no command specified, uses default browser\n"
                    "    --port, -p              Port to listen (default: '0' for random port)\n"
                    "    --interface, -i         Network interface to bind (eg: eth0), or UNIX domain socket path (eg: /var/run/ttyd.sock)\n"
                    "    --credential, -c        Credential for Basic Authentication (format: username:password)\n"
                    "    --uid, -u               User id to run with\n"
                    "    --gid, -g               Group id to run with\n"
                    "    --signal, -s            Signal to send to the command when exit it (default: SIGHUP)\n"
                    "    --reconnect, -r         Time to reconnect for the client in seconds (default: 10)\n"
                    "    --readonly, -R          Do not allow clients to write to the TTY\n"
                    "    --client-option, -t     Send option to client (format: key=value), repeat to add more options\n"
                    "    --check-origin, -O      Do not allow websocket connection from different origin\n"
                    "    --once, -o              Accept only one client and exit on disconnection\n"
                    "    --index, -I             Custom index.html path\n"
                    "    --ssl, -S               Enable SSL\n"
                    "    --ssl-cert, -C          SSL certificate file path\n"
                    "    --ssl-key, -K           SSL key file path\n"
                    "    --ssl-ca, -A            SSL CA file path for client certificate verification\n"
                    "    --debug, -d             Set log level (0-9, default: 0)\n"
                    "    --version, -v           Print the version and exit\n"
                    "    --help, -h              Print this text and exit\n"
                    "If no --port option is specified, --browser is implied.\n",
            LDOMTERM_VERSION
    );
}

char **
copy_argv(int argc, char * const*argv)
{
    if (argc == 0) {
        argv = (char * const*)default_argv;
        argc = 0;
        while (argv[argc])
            argc++;
    }
    char **copy = xmalloc(sizeof(char *) * (argc + 1));
    for (int i = 0; i < argc; i++) {
        copy[i] = strdup(argv[i]);
    }
    copy[argc] = NULL;
    return copy;
}

struct tty_server *
tty_server_new(int argc, char **argv) {
    struct tty_server *ts;
    size_t cmd_len = 0;

    ts = xmalloc(sizeof(struct tty_server));

    memset(ts, 0, sizeof(struct tty_server));
    LIST_INIT(&ts->clients);
    ts->client_count = 0;
    ts->session_count = 0;
    ts->reconnect = 10;
    ts->sig_code = SIGHUP;
    ts->sig_name = strdup("SIGHUP");

    ts->argv = copy_argv(argc, argv);
    return ts;
}

void
tty_server_free(struct tty_server *ts) {
    if (ts == NULL)
        return;
    if (ts->credential != NULL)
        free(ts->credential);
    if (ts->index != NULL)
        free(ts->index);
    free(ts->prefs_json);
    int i = 0;
    do {
        free(ts->argv[i++]);
    } while (ts->argv[i] != NULL);
    free(ts->argv);
    free(ts->sig_name);
    if (ts->socket_path != NULL) {
        struct stat st;
        if (!stat(ts->socket_path, &st)) {
            unlink(ts->socket_path);
        }
        free(ts->socket_path);
    }
    free(ts);
}

void
sig_handler(int sig) {
    if (force_exit)
        exit(EXIT_FAILURE);

    char sig_name[20];
    get_sig_name(sig, sig_name);
    lwsl_notice("received signal: %s (%d), exiting...\n", sig_name, sig);
    force_exit = true;
    lws_cancel_service(context);
    lwsl_notice("send ^C to force exit.\n");
}

char *
get_bin_relative_path(const char* app_path)
{
    char* path = get_executable_path();
    int dirname_length = get_executable_directory_length();
    int i;

    if (dirname_length > 4 && memcmp(path+dirname_length-4, "/bin", 4)==0)
      dirname_length -= 4;

    int app_path_length = strlen(app_path);
    char *buf = (char*)xmalloc(dirname_length + app_path_length + 1);
    sprintf(buf, "%.*s%s", dirname_length, path, app_path);
    return buf;
}

char *
find_in_path(const char *name)
{
    char *path = getenv("PATH");
    int plen = strlen(path);
    char *end = path + plen;
    char *buf = xmalloc(plen + strlen(name) + 2);
    for (;;) {
        char* colon = strchr(path, ':');
        if (colon == NULL)
            colon = end;
        if (path != colon) {
            sprintf(buf, "%.*s/%s", colon-path, path, name);
            if (access(buf, X_OK) == 0)
                return buf;
        }
        if (colon == end)
            return NULL;
        path = colon + 1;
    }
}

char *
chrome_command()
{
    char *cbin = getenv("CHROME_BIN");
    if (cbin != NULL && access(cbin, X_OK) == 0)
        return cbin;
    char *path = find_in_path("chrome");
    if (path != NULL)
        return path;
    return find_in_path("google-chrome");
}

char *
chrome_app_command(char *chrome_cmd)
{
    char *crest = " --app='%U' >/dev/null";
    char *buf = xmalloc(strlen(chrome_cmd)+strlen(crest)+1);
    sprintf(buf, "%s%s", chrome_cmd, crest);
    return buf;
}

char *
firefox_browser_command()
{
    char *firefoxCommand = "firefox";
    char *firefoxMac ="/Applications/Firefox.app/Contents/MacOS/firefox";
    if (access(firefoxMac, X_OK) == 0)
        return firefoxMac;
    return firefoxCommand;
}

/** Try to find the "application.ini" file for the DomTerm XUL application. */
char *
firefox_xul_application()
{
    return get_bin_relative_path("/share/domterm/application.ini");
}

char *
firefox_xul_command(char* app_path)
{
    char* path = NULL;
    char *fcommand = firefox_browser_command();
    int allocated_app_path = app_path == NULL;
    if (allocated_app_path)
        app_path = firefox_xul_application();
    char *format = "%s -app %s -wsprotocol domterm -wspath ws://localhost:%%W &";
    char *buf = xmalloc(strlen(fcommand) + strlen(app_path) + strlen(format));
    sprintf(buf, format, fcommand, app_path);
    if (allocated_app_path)
        free(app_path);
    return buf;
}

char *
firefox_command()
{
#if 1
    char *xulapp = firefox_xul_application();
    if (xulapp != NULL && access(xulapp, R_OK) == 0)
        return firefox_xul_command(xulapp);
    fprintf(stderr, "Firefox XUL application.ini not found.\n");
    fprintf(stderr,
            "Treating as --browser=firefox (which uses a regular Firefox browser window).\n");
#endif
    return "firefox";
}

char *
electron_command(int quiet)
{
    char *epath = find_in_path("electron");
    char *app = get_bin_relative_path("/share/domterm/electron");
    char *format = "%s %s --url '%U'&";
    if (epath == NULL) {
        if (quiet)
            return NULL;
        fprintf(stderr, "'electron' not found in PATH\n");
        exit(-1);
    }
    char *buf = xmalloc(strlen(epath) + strlen(app) + strlen(format));
    sprintf(buf, format, epath, app);
    return buf;
}

void
default_browser_command(const char *url, int port)
{
#ifdef DEFAULT_BROWSER_COMMAND
    subst_run_command(DEFAULT_BROWSER_COMMAND, url, port);
#elif __APPLE__
    subst_run_command("open '%U' > /dev/null 2>&1", url, port);
#elif defined(_WIN32) || defined(__CYGWIN__)
    ShellExecute(0, 0, url, 0, 0 , SW_SHOW) > 32 ? 0 : 1;
#else
    // check if X server is running
    //if (system("xset -q > /dev/null 2>&1"))
    //return 1;

    // Prefer gnome-open or kde-open over xdg-open because xdg-open
    // under Gnome defaults to using 'gio open', which does drops the "hash"
    // part of a "file:" URL, and may also use a non-preferred browser.
    char *path = find_in_path("gnome-open");
    if (path == NULL)
      path = find_in_path("kde-open");
    if (path == NULL)
      path = strdup("xdg-open");
    char *pattern = xmalloc(strlen(path) + 40);
    sprintf(pattern, "%s '%%U' > /dev/null 2>&1", path);
    free(path);
    subst_run_command(pattern, url, port);
    free(pattern);
#endif
}

char *
check_browser_specifier(const char *specifier)
{
    if (specifier == NULL || specifier[0] != '-')
        return NULL;
    if (strcmp(specifier, "--electron") == 0)
      return electron_command(0);
    if (strcmp(specifier, "--qtwebengine") == 0)
        return get_bin_relative_path("/bin/qtdomterm --connect '%U' &");
    if (strcmp(specifier, "--left") == 0 ||
        strcmp(specifier, "--right") == 0 ||
        strcmp(specifier, "--above") == 0 ||
        strcmp(specifier, "--below") == 0 ||
        strcmp(specifier, "--tab") == 0 ||
        strcmp(specifier, "--pane") == 0 ||
        strcmp(specifier, "--detached") == 0)
      return strdup(specifier);
    if (strcmp(specifier, "--browser") == 0)
      return strdup(""); // later
    if (strncmp(specifier, "--browser=", 10) == 0)
      return strdup(specifier+10);
    return NULL;
}

void
do_run_browser(const char *browser_specifier, char *url, int port)
{
    if (browser_specifier==NULL)
        browser_specifier=browser_command;
    //else if (strcmp(browser_specifier, "--detached") == 0)
    //    return;
        if (browser_specifier == NULL && port_specified < 0) {
            // The default is "--electron" if available
            browser_specifier = electron_command(1);
            if (browser_specifier == NULL)
                browser_specifier = "";
        }
        if (strcmp(browser_specifier, "firefox") == 0)
            browser_specifier = firefox_browser_command();
        else if (strcmp(browser_specifier, "chrome") == 0
                 || strcmp(browser_specifier, "google-chrome") == 0) {
            browser_specifier = chrome_command();
            if (browser_specifier == NULL) {
                fprintf(stderr, "neither chrome or google-chrome command found\n");
                exit(-1);
            }
        }
        if (browser_specifier[0] == '\0')
            default_browser_command(url, port);
        else
            subst_run_command(browser_specifier, url, port);
}

char *
get_domterm_jar_path()
{
    return get_bin_relative_path("/share/domterm/domterm.jar");
}

const char*
state_to_json(int argc, char *const*argv, char *const *env)
{
    struct json_object *jobj = json_object_new_object();
    struct json_object *jargv = json_object_new_array();
    struct json_object *jenv = json_object_new_array();
    const char *result;
    char *cwd = getcwd(NULL, 0); /* FIXME used GNU extension */
    int i;
    for (i = 0; i < argc; i++)
        json_object_array_add(jargv, json_object_new_string(argv[i]));
    for (i = 0; ; i++) {
        const char *e = env[i];
        if (e == NULL)
            break;
        json_object_array_add(jenv, json_object_new_string(e));
    }
    json_object_object_add(jobj, "cwd", json_object_new_string(cwd));
    free(cwd);
    json_object_object_add(jobj, "argv", jargv);
    json_object_object_add(jobj, "env", jenv);
    //result = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PRETTY);
    result = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN);
    json_object_put(jobj);
    return result;
}

int
main(int argc, char **argv)
{
    memset(&info, 0, sizeof(info));
    info.port = 0;
    info.iface = NULL;
    info.protocols = protocols;
    info.ssl_cert_filepath = NULL;
    info.ssl_private_key_filepath = NULL;
    info.gid = -1;
    info.uid = -1;
    info.max_http_header_pool = 16;
    info.options = LWS_SERVER_OPTION_VALIDATE_UTF8|LWS_SERVER_OPTION_EXPLICIT_VHOSTS;
    info.extensions = extensions;
    info.timeout_secs = 5;
    mount_domterm_zip.origin = get_resource_path();
    info.mounts = &mount_domterm_zip;

    int debug_level = 0;
    int do_daemonize = 1;
    char iface[128] = "";
    bool ssl = false;
    char cert_path[1024] = "";
    char key_path[1024] = "";
    char ca_path[1024] = "";

    struct json_object *client_prefs = json_object_new_object();

    // parse command line options
    int c;
    while ((c = getopt_long(argc, argv, opt_string, options, NULL)) != -1) {
        switch (c) {
            case 'h':
                print_help();
                return 0;
            case 'v':
                printf("ldomterm version %s\n", LDOMTERM_VERSION);
                printf("Copyright %s Per Bothner and Shuanglei Tao\n", LDOMTERM_YEAR);
                return 0;
            case 'd':
                debug_level = atoi(optarg);
                break;
            case 'R':
                server->readonly = true;
                break;
            case 'O':
                server->check_origin = true;
                break;
            case 'o':
                server->once = true;
                break;
            case 'p':
                info.port = atoi(optarg);
                port_specified = info.port;
                if (info.port < 0) {
                    fprintf(stderr, "ttyd: invalid port: %s\n", optarg);
                    return -1;
                }
                break;
            case 'B':
                browser_command = optarg == NULL ? "" : optarg;
                break;
            case FORCE_OPTION:
                force_option = 1;
                break;
            case NO_DAEMONIZE_OPTION:
            case DAEMONIZE_OPTION:
                do_daemonize = (c == DAEMONIZE_OPTION);
                break;
            case PANE_OPTION:
            case TAB_OPTION:
            case LEFT_OPTION:
            case RIGHT_OPTION:
            case BELOW_OPTION:
            case ABOVE_OPTION:
                paneOp = c - PANE_OPTIONS_START;
                /* ... fall through ... */
            case DETACHED_OPTION:
                browser_command = argv[optind-1];
                break;
            case CHROME_OPTION: {
                char *cbin = chrome_command();
                if (cbin == NULL) {
                    fprintf(stderr, "neither chrome or google-chrome command found\n");
                    exit(-1);
                }
                browser_command = chrome_app_command(cbin);
                break;
            }
            case FIREFOX_OPTION:
                browser_command = firefox_command();
                break;
            case ELECTRON_OPTION:
                browser_command = electron_command(0);
                break;
            case QTDOMTERM_OPTION:
                fprintf(stderr,
                        "Warning: The --qtdomterm option is experimental "
                        "and not fully working!\n");
                browser_command =
                    get_bin_relative_path("/bin/qtdomterm --connect '%U' &");
                break;
            case 'i':
                strncpy(iface, optarg, sizeof(iface));
                iface[sizeof(iface) - 1] = '\0';
                break;
            case 'c':
                if (strchr(optarg, ':') == NULL) {
                    fprintf(stderr, "ttyd: invalid credential, format: username:password\n");
                    return -1;
                }
                server->credential = base64_encode((const unsigned char *) optarg, strlen(optarg));
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
                    server->sig_code = get_sig(optarg);
                    server->sig_name = uppercase(strdup(optarg));
                } else {
                    fprintf(stderr, "ttyd: invalid signal: %s\n", optarg);
                    return -1;
                }
            }
                break;
            case 'r':
                server->reconnect = atoi(optarg);
                if (server->reconnect <= 0) {
                    fprintf(stderr, "ttyd: invalid reconnect: %s\n", optarg);
                    return -1;
                }
                break;
            case 'I':
                if (!strncmp(optarg, "~/", 2)) {
                    const char* home = find_home();
                    server->index = malloc(strlen(home) + strlen(optarg) - 1);
                    sprintf(server->index, "%s%s", home, optarg + 1);
                } else {
                    server->index = strdup(optarg);
                }
                struct stat st;
                if (stat(server->index, &st) == -1) {
                    fprintf(stderr, "Can not stat index.html: %s, error: %s\n", server->index, strerror(errno));
                    return -1;
                }
                if (S_ISDIR(st.st_mode)) {
                    fprintf(stderr, "Invalid index.html path: %s, is it a dir?\n", server->index);
                    return -1;
                }
                break;
            case 'S':
                ssl = true;
                break;
            case 'C':
                strncpy(cert_path, optarg, sizeof(cert_path) - 1);
                cert_path[sizeof(cert_path) - 1] = '\0';
                break;
            case 'K':
                strncpy(key_path, optarg, sizeof(key_path) - 1);
                key_path[sizeof(key_path) - 1] = '\0';
                break;
            case 'A':
                strncpy(ca_path, optarg, sizeof(ca_path) - 1);
                ca_path[sizeof(ca_path) - 1] = '\0';
                break;
            case '?':
                break;
            case 't':
                optind--;
                for (; optind < argc && *argv[optind] != '-'; optind++) {
                    char *option = strdup(optarg);
                    char *key = strsep(&option, "=");
                    if (key == NULL) {
                        fprintf(stderr, "ttyd: invalid client option: %s, format: key=value\n", optarg);
                        return -1;
                    }
                    char *value = strsep(&option, "=");
                    free(option);
                    struct json_object *obj = json_tokener_parse(value);
                    json_object_object_add(client_prefs, key, obj != NULL ? obj : json_object_new_string(value));
                }
                break;
            default:
                print_help();
                return -1;
        }
    }

    const char *cmd = argv[optind];
    if (argv[optind] != NULL) {
        if (cmd != NULL && strcmp(cmd, "is-domterm") == 0) {
            // "Usage: dt-util is-domterm"
            // "Succeeds if running on a DomTerm terminal; fails otherwise."
            // "Typical usage: if dt-util is-domterm; then ...; fi"
            exit(probe_domterm() > 0 ? 0 : -1);
        } else if (strcmp(cmd, "html") == 0 || strcmp(cmd, "hcat") == 0) {
            // "Usage: html html-data..."
            // "Each 'html-data' must be a well-formed HTML fragment"
            // "If there are no arguments, read html from standard input"
            check_domterm();
            int i = optind + 1;
            if (i == argc) {
                char buffer[1024];
                fprintf(stdout, "\033]72;");
                for (;;) {
                    int r = fread(buffer, 1, sizeof(buffer), stdin);
                    if (r <= 0 || fwrite(buffer, 1, r, stdout) <= 0)
                      break;
                }
                fprintf(stdout, "\007");
            } else {
                while (i < argc)  {
                    fprintf(stdout, "\033]72;%s\007", argv[i++]);
                }
            }
            fflush(stderr);
            exit(0);
         }
    }
    char *socket_path = make_socket_name();
    int socket = client_connect(socket_path, 0);
    if (socket >= 0) {
      const char *state_as_json = state_to_json(argc, argv, environ);
      size_t jlen = strlen(state_as_json);
      if (write(socket, state_as_json, jlen) != jlen
          || write(socket, "\f", 1) != 1)
        fatal("bad write to socket");
      for (;;) {
        char buf[100];
        int n = read(socket, buf, sizeof(buf));
        if (n <= 0)
          break;
        write(2, buf, n);
      }
      //if (close(socket) != 0)
      //  fatal("bad close of socket");
      //fprintf(stderr, "done client cmd:%s\n", cmd);
      exit(0);
    } else if (cmd != NULL && strcmp(cmd, "list") == 0) {
      // We don't want to start the server
      fprintf(stderr, "(no domterm sessions or server)\n", cmd);
      exit(0);
    }

    server = tty_server_new(argc-optind, argv+optind);
    server->prefs_json = strdup(json_object_to_json_string(client_prefs));
    json_object_put(client_prefs);

#if 0
    if (server->command == NULL || strlen(server->command) == 0) {
        fprintf(stderr, "ttyd: missing start command\n");
        return -1;
    }
#endif

    if (port_specified < 0)
        server->client_can_close = true;

    lws_set_log_level(debug_level, NULL);

#if LWS_LIBRARY_VERSION_MAJOR >= 2
    char server_hdr[128] = "";
    sprintf(server_hdr, "ldomterm/%s (libwebsockets/%s)", LDOMTERM_VERSION, LWS_LIBRARY_VERSION);
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
    if (ssl) {
        info.ssl_cert_filepath = cert_path;
        info.ssl_private_key_filepath = key_path;
        info.ssl_ca_filepath = ca_path;
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
        if (strlen(info.ssl_ca_filepath) > 0)
            info.options |= LWS_SERVER_OPTION_REQUIRE_VALID_OPENSSL_CLIENT_CERT;
#if LWS_LIBRARY_VERSION_MAJOR >= 2
        info.options |= LWS_SERVER_OPTION_REDIRECT_HTTP_TO_HTTPS;
#endif
    }

    signal(SIGINT, sig_handler);  // ^C
    signal(SIGTERM, sig_handler); // kill

    context = lws_create_context(&info);
    vhost = lws_create_vhost(context, &info);
    if (context == NULL) {
        lwsl_err("libwebsockets init failed\n");
        return 1;
    }

    char *cname = make_socket_name();
    lws_sock_file_fd_type csocket;
    csocket.filefd = create_command_socket(cname);
    struct lws *cmdwsi = lws_adopt_descriptor_vhost(vhost, 0, csocket, "cmd", NULL);
    cclient = (struct cmd_client *) lws_wsi_user(cmdwsi);
    cclient->socket = csocket.filefd;
    make_html_file(info.port);

    lwsl_notice("TTY configuration:\n");
    if (server->credential != NULL)
        lwsl_notice("  credential: %s\n", server->credential);
    lwsl_notice("  reconnect timeout: %ds\n", server->reconnect);
    lwsl_notice("  close signal: %s (%d)\n", server->sig_name, server->sig_code);
    if (server->check_origin)
        lwsl_notice("  check origin: true\n");
    if (server->readonly)
        lwsl_notice("  readonly: true\n");
    if (server->once)
        lwsl_notice("  once: true\n");
    if (server->index != NULL) {
        lwsl_notice("  custom index.html: %s\n", server->index);
    }
    if (port_specified >= 0 && browser_command == NULL) {
        fprintf(stderr, "Server start on port %d. You can browse http://localhost:%d/#ws=same\n",
                info.port, info.port);
    }

    handle_command(argc-optind, argv+optind, ".", environ, NULL, 1);

    if (do_daemonize) {
#if 1
        daemon(1, 0);
#else
        char *lock_path = NULL;
        int r = lws_daemonize(lock_path);
        fprintf(stderr, "lws_daemonize returned %d\n", r);
#endif
    }

    // libwebsockets main loop
    while (!force_exit) {
        lws_service(context, 100);
    }

    lws_context_destroy(context);

    // cleanup
    tty_server_free(server);

    return 0;
}

void
setblocking(int fd, int state)
{
        int mode;

        if ((mode = fcntl(fd, F_GETFL)) != -1) {
                if (!state)
                        mode |= O_NONBLOCK;
                else
                        mode &= ~O_NONBLOCK;
                fcntl(fd, F_SETFL, mode);
        }
}

const char *
domterm_dir ()
{
    static const char *dir = NULL;
    if (dir != NULL)
      return dir;
    const char *home = find_home();
    const char *hdir = "/.domterm";
    char *tmp = xmalloc(strlen(home)+strlen(hdir)+1);
    sprintf(tmp, "%s%s", home, hdir);
    dir = tmp;
    if (mkdir(dir, S_IRWXU) != 0 && errno != EEXIST)
        fatal("cannot create directory");
    return dir;
}

static char *
make_socket_name()
{
    const char *ddir = domterm_dir();
    const char *sname = "/default.socket";
    char buf[100];
    char *r = xmalloc(strlen(ddir)+strlen(sname)+1);
    sprintf(r, "%s%s", ddir, sname);
    return r;
}

char server_key[SERVER_KEY_LENGTH];

static char html_template[] =
    "<!DOCTYPE html>\n"
    "<html><head>\n"
    "<base href='http://%s:%d/'/>\n"
    "<meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>\n"
    "<title>DomTerm</title>\n"
    "<link type='text/css' rel='stylesheet' href='hlib/domterm-core.css'>\n"
    "<link type='text/css' rel='stylesheet' href='hlib/domterm-standard.css'>\n"
    "<link type='text/css' rel='stylesheet' href='hlib/goldenlayout-base.css'>\n"
    "<link type='text/css' rel='stylesheet' href='hlib/domterm-layout.css'>\n"
    "<link type='text/css' rel='stylesheet' href='hlib/domterm-default.css'>\n"
    "<script type='text/javascript' src='hlib/domterm-all.js'> </script>\n"
    "<script type='text/javascript'>\n"
    "DomTerm.server_port = %d;\n"
    "DomTerm.server_key = '%s';\n"
    "if (DomTerm.isElectron()) {\n"
    "    window.nodeRequire = require;\n"
    "    delete window.require;\n"
    "    delete window.exports;\n"
    "    delete window.module;\n"
    "}\n"
    "</script>\n"
    "<script type='text/javascript' src='hlib/jquery.min.js'> </script>\n"
    "<script type='text/javascript' src='hlib/goldenlayout.js'> </script>\n"
    "<script type='text/javascript' src='hlib/domterm-layout.js'> </script>\n"
    "<script type='text/javascript' src='hlib/domterm-menus.js'> </script>\n"
    "<script type='text/javascript' src='hlib/domterm-client.js'> </script>\n"
    "</head>\n"
    "<body></body>\n"
  "</html>\n";

char *main_html_url;
char *main_html_path;

static void
make_html_file(int port)
{
    //uid_t uid = getuid();
    const char *ddir = domterm_dir();
    const char *fname = "/default.html";
    const char*prefix = "file://";
    char *buf = xmalloc(strlen(prefix)+strlen(ddir)+strlen(fname)+1);
    sprintf(buf, "%s%s%s", prefix, ddir, fname);
    main_html_url = buf;
    main_html_path = buf+strlen(prefix);
    FILE *hfile = fopen(main_html_path, "w");
    if (server_key[0] == 0)
        generate_random_string(server_key, SERVER_KEY_LENGTH);
    fprintf(hfile, html_template, "localhost", port, port, server_key);
    fclose(hfile);
}

static const char *server_socket_path = NULL;
static void server_atexit_handler(void) {
    if (server_socket_path != NULL) {
        unlink(server_socket_path);
        server_socket_path = NULL;
    }
    if (main_html_url != NULL) {
        unlink(main_html_path);
        main_html_path = NULL;
        main_html_url = NULL;
    }
}

/* Create command server socket. */
static int
create_command_socket(const char *socket_path)
{
    struct sockaddr_un      sa;
    size_t                  size;
    mode_t                  mask;
    int                     fd;

    memset(&sa, 0, sizeof sa);
    sa.sun_family = AF_UNIX;
    if (strlen(socket_path) >= sizeof sa.sun_path) {
        errno = ENAMETOOLONG;
        return (-1);
    }
    strcpy(sa.sun_path, socket_path);
    unlink(sa.sun_path);

    if ((fd = socket(AF_UNIX, SOCK_STREAM|SOCK_CLOEXEC, 0)) == -1)
        return (-1);

    mask = umask(S_IXUSR|S_IXGRP|S_IRWXO);
    if (bind(fd, (struct sockaddr *) &sa, sizeof(sa)) == -1)
        return (-1);
    umask(mask);
    server_socket_path = socket_path;
    atexit(server_atexit_handler);

    if (listen(fd, 128) == -1)
        return (-1);
    setblocking(fd, 0);

    return (fd);
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

static int
client_connect (char *socket_path, int start_server)
{
    struct sockaddr_un      sa;
    int lockfd = -1, locked = 0;
    char                   *lockfile = NULL;
    int fd;

    memset(&sa, 0, sizeof sa);
    sa.sun_family = AF_UNIX;
    if (strlen(socket_path) >= sizeof sa.sun_path) {
        errno = ENAMETOOLONG;
        fatal("socket name '%s' too long", socket_path);
    }
    strcpy(sa.sun_path, socket_path);

 retry:
    fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0)
      fatal("cannot create client socket");
    if (connect(fd, (struct sockaddr *)&sa, sizeof sa) == -1) {
        //lwsl_notice("connect failed: %s\n", strerror(errno));
        if (errno != ECONNREFUSED && errno != ENOENT)
            goto failed;
        if (!start_server)
            goto failed;
        close(fd);
    }
    if (locked && lockfd >= 0) {
        free(lockfile);
        close(lockfd);
    }
    //setblocking(fd, 0);
    return (fd);

 failed:
    if (locked) {
        free(lockfile);
        close(lockfd);
    }
    close(fd);
    return (-1);
}

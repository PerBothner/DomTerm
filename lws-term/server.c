#include "server.h"

#include <sys/file.h>
#include <sys/un.h>
extern char **environ;

#ifndef DEFAULT_SHELL
#define DEFAULT_SHELL "/bin/bash"
#endif

static struct options opts;
struct options *main_options = &opts;

static void make_html_file(int);
static char *make_socket_name(bool);
static int create_command_socket(const char *);
static int client_connect (char *socket_path, int start_server);

void
subst_run_command (const char *browser_command, const char *url, int port)
{
    size_t clen = strlen(browser_command);
    char *cmd = xmalloc(clen + strlen(url) + 10);
    char *upos = strstr(browser_command, "%U");
    char *wpos;
    const char *url_fixed = url;
    char *url_tmp = NULL;
    if (is_WindowsSubsystemForLinux() && strstr(browser_command, ".exe") != NULL) {
        char *wsl_prefix = "file:///mnt/c/";
	int wsl_prefix_length = strlen(wsl_prefix);
        if (memcmp(url, wsl_prefix, wsl_prefix_length) == 0) {
            url_tmp = xmalloc(strlen(url));
	    url_fixed = url_tmp;
            sprintf(url_tmp, "file:///c:/%s", url+wsl_prefix_length);
	}
    }
    if (upos) {
      size_t beforeU = upos - browser_command;
      sprintf(cmd, "%.*s%s%.*s",
              (int) beforeU, browser_command,
              url_fixed,
              (int) (clen - beforeU - 2), upos+2);
    } else if ((wpos = strstr(browser_command, "%W")) != NULL) {
        size_t beforeW = wpos - browser_command;
        sprintf(cmd, "%.*s%d%.*s",
                (int) beforeW, browser_command,
                port,
                (int) (clen - beforeW - 2), wpos+2);
    } else
        sprintf(cmd, "%s '%s'", browser_command, url_fixed);
    if (url_tmp != NULL)
        free(url_tmp);
    lwsl_notice("frontend command: %s\n", cmd);
    int r = system(cmd);
    if (! WIFEXITED(r) || (WEXITSTATUS(r) != 0 && ! is_WindowsSubsystemForLinux()))
        fatal("system could not execute %s (return code: %x)\n", cmd, r);
}

static int port_specified = -1;
volatile bool force_exit = false;
struct lws_context *context;
struct tty_server *server;
int http_port;
struct lws_vhost *vhost;
struct lws *focused_wsi = NULL;
struct lws_context_creation_info info;
struct cmd_client *cclient;
int last_session_number = 0;

static const struct lws_protocols protocols[] = {
        /* http server for (mostly) static data */
        {"http-only", callback_http, sizeof(struct http_client),  0},

        /* websockets server for communicating with browser */
        {"domterm",   callback_tty,  sizeof(struct tty_client),  0},

        /* callbacks for pty I/O, one pty for each session (process) */
        {"pty",       callback_pty,  sizeof(struct pty_client),  0},

        /* Unix domain socket for client to send to commands to server */
        {"cmd",       callback_cmd,  sizeof(struct cmd_client),  0},

        /* calling back for "inotify" to watch settings.ini */
        {"inotify",    callback_inotify,  0,  0},

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
#define CHROME_APP_OPTION 1004
#define FORCE_OPTION 2001
#define DAEMONIZE_OPTION 2002
#define NO_DAEMONIZE_OPTION 2003
#define DETACHED_OPTION 2004
#define GEOMETRY_OPTION 2005
#define QT_REMOTE_DEBUGGING_OPTION 2006
#define SESSION_NAME_OPTION 2007
#define SETTINGS_FILE_OPTION 2008
#define PANE_OPTIONS_START 2100
/* offsets from PANE_OPTIONS_START match 'N' in '\e[90;Nu' command */
#define PANE_OPTION (PANE_OPTIONS_START+1)
#define TAB_OPTION (PANE_OPTIONS_START+2)
#define LEFT_OPTION (PANE_OPTIONS_START+10)
#define RIGHT_OPTION (PANE_OPTIONS_START+11)
#define ABOVE_OPTION (PANE_OPTIONS_START+12)
#define BELOW_OPTION (PANE_OPTIONS_START+13)
#define PRINT_URL_OPTION (PANE_OPTIONS_START+14)

// command line options
static const struct option options[] = {
        {"port",         required_argument, NULL, 'p'},
        {"browser",      optional_argument, NULL, 'B'},
        {"chrome",       no_argument,       NULL, CHROME_OPTION},
        {"chrome-app",   no_argument,       NULL, CHROME_APP_OPTION},
        {"google-chrome",no_argument,       NULL, CHROME_OPTION},
        {"firefox",      no_argument,       NULL, FIREFOX_OPTION},
        {"qt",           no_argument,       NULL, QTDOMTERM_OPTION},
        {"qtdomterm",    no_argument,       NULL, QTDOMTERM_OPTION},
        {"qtwebengine",  no_argument,       NULL, QTDOMTERM_OPTION},
        {"electron",     no_argument,       NULL, ELECTRON_OPTION},
        {"force",        no_argument,       NULL, FORCE_OPTION},
        {"daemonize",    no_argument,       NULL, DAEMONIZE_OPTION},
        {"no-daemonize", no_argument,       NULL, NO_DAEMONIZE_OPTION},
        {"session-name", required_argument, NULL, SESSION_NAME_OPTION},
        {"sn",           required_argument, NULL, SESSION_NAME_OPTION},
        {"settings",     required_argument, NULL, SETTINGS_FILE_OPTION},
        {"detached",     no_argument,       NULL, DETACHED_OPTION},
        {"geometry",     required_argument, NULL, GEOMETRY_OPTION},
        {"pane",         no_argument,       NULL, PANE_OPTION},
        {"tab",          no_argument,       NULL, TAB_OPTION},
        {"left",         no_argument,       NULL, LEFT_OPTION},
        {"right",        no_argument,       NULL, RIGHT_OPTION},
        {"above",        no_argument,       NULL, ABOVE_OPTION},
        {"below",        no_argument,       NULL, BELOW_OPTION},
        {"print-url",    no_argument,       NULL, PRINT_URL_OPTION},
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
        {"help",         no_argument,       NULL, 'h'},
        {NULL, 0, 0,                              0}
};
static const char *opt_string = "+p:B::i:c:u:g:s:r:aSC:K:A:Rt:Ood:L:vh";

struct tty_server *
tty_server_new(int argc, char **argv) {
    struct tty_server *ts = xmalloc(sizeof(struct tty_server));

    memset(ts, 0, sizeof(struct tty_server));
    LIST_INIT(&ts->clients);
    ts->client_count = 0;
    ts->session_count = 0;

    return ts;
}

void
tty_server_free(struct tty_server *ts) {
    if (ts == NULL)
        return;
    if (ts->options.credential != NULL)
        free(ts->options.credential);
    if (ts->options.sig_name)
        free(ts->options.sig_name);
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

    if (dirname_length > 4 && memcmp(path+dirname_length-4, "/bin", 4)==0)
      dirname_length -= 4;

    int app_path_length = strlen(app_path);
    char *buf = (char*)xmalloc(dirname_length + app_path_length + 1);
    sprintf(buf, "%.*s%s", dirname_length, path, app_path);
    return buf;
}

/* Returns freshly allocated string or NULL. */
char *
find_in_path(const char *name)
{
    if (name[0] == '/' && access(name, X_OK) == 0)
        return strdup(name);
    // FIXME: if (strchr(name, '/') prepend working directory
    char *path = getenv("PATH");
    int plen = strlen(path);
    char *end = path + plen;
    char *buf = xmalloc(plen + strlen(name) + 2);
    for (;;) {
        char* colon = strchr(path, ':');
        if (colon == NULL)
            colon = end;
        if (path != colon) {
             sprintf(buf, "%.*s/%s", (int) (colon-path), path, name);
            if (access(buf, X_OK) == 0)
                return buf;
        }
        if (colon == end)
            return NULL;
        path = colon + 1;
    }
}

char *
fix_for_windows(char * fname)
{
    if (is_WindowsSubsystemForLinux()) {
        int fname_length = strlen(fname);
        static char mnt_prefix[] = "/mnt/";
        static int mnt_prefix_length = sizeof(mnt_prefix)-1;
        if (memcmp(fname, mnt_prefix, mnt_prefix_length) == 0
            && fname_length > mnt_prefix_length) {
            char *buf = xmalloc(fname_length);
            sprintf(buf, "%c:/%s", fname[mnt_prefix_length], fname+mnt_prefix_length+1);
            return buf;
        }
    }
    return fname;
}

/* Result is cached. */
char *
chrome_command()
{
    static char *cbin = NULL;
    if (main_options->command_chrome != NULL)
        return main_options->command_chrome;
    if (cbin)
      return cbin[0] ? cbin : NULL;
    cbin = getenv("CHROME_BIN");
    if (cbin != NULL && access(cbin, X_OK) == 0)
        return cbin;
    if (is_WindowsSubsystemForLinux()) {
#define CHROME_EXE "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
	if (access(CHROME_EXE, X_OK) == 0)
            return "'" CHROME_EXE "'";
    }
    cbin = find_in_path("chrome");
    if (cbin != NULL)
        return cbin;
    cbin = find_in_path("google-chrome");
    if (cbin != NULL)
        return cbin;
    cbin = "";
    return NULL;
}

char *
firefox_browser_command()
{
    if (main_options->command_firefox != NULL)
        return main_options->command_firefox;
    if (is_WindowsSubsystemForLinux())
        return "'/mnt/c/Program Files (x86)/Mozilla Firefox/firefox.exe'";
    char *firefoxCommand = find_in_path("firefox");
    if (firefoxCommand != NULL)
        return firefoxCommand;
    char *firefoxMac ="/Applications/Firefox.app/Contents/MacOS/firefox";
    if (access(firefoxMac, X_OK) == 0)
        return firefoxMac;
    return NULL;
}

#if 0
/** Try to find the "application.ini" file for the DomTerm XUL application. */
char *
firefox_xul_application()
{
    return get_bin_relative_path(DOMTERM_DIR_RELATIVE "/application.ini");
}

char *
firefox_xul_command(char* app_path)
{
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
#endif

char *
firefox_command()
{
#if 0
    char *xulapp = firefox_xul_application();
    if (xulapp != NULL && access(xulapp, R_OK) == 0)
        return firefox_xul_command(xulapp);
    fprintf(stderr, "Firefox XUL application.ini not found.\n");
    fprintf(stderr,
            "Treating as --browser=firefox (which uses a regular Firefox browser window).\n");
#endif
    char *firefox = firefox_browser_command();
    return firefox ? firefox : "firefox";
}

char *
qtwebengine_command(int quiet, struct options *options)
{
    char *cmd = get_bin_relative_path("/bin/qtdomterm");
    if (cmd == NULL || access(cmd, X_OK) != 0) {
        if (cmd == NULL)
            free(cmd);
        if (quiet)
            return NULL;
        fprintf(stderr, "'qtdomterm' missing\n");
        exit(-1);
    }
    int bsize = strlen(cmd)+100;
    char *geometry = options->geometry;
    if (geometry == NULL || !options->geometry[0])
        geometry = main_options->geometry;
    if (geometry)
        bsize += strlen(geometry);
    if (options->qt_remote_debugging)
      bsize += strlen(options->qt_remote_debugging);
    char *buf = xmalloc(bsize);
    strcpy(buf, cmd);
    free(cmd);
    if (geometry && geometry[0]) {
        strcat(buf, " --geometry ");
        strcat(buf, geometry);
    }
    if (options->qt_remote_debugging) {
        strcat(buf, " --remote-debugging-port=");
        strcat(buf, options->qt_remote_debugging);
    }
    strcat(buf, " --connect '%U' &");
    return buf;
}

char *
electron_command(int quiet, struct options *options)
{
    bool epath_free_needed = false;
    char *epath = main_options->command_electron;
    if (epath == NULL) {
        char *ppath = find_in_path("electron");
        if (ppath == NULL && is_WindowsSubsystemForLinux())
            ppath = find_in_path("electron.exe");
        if (ppath == NULL) {
            if (quiet)
                return NULL;
            fprintf(stderr, "'electron' not found in PATH\n");
            exit(-1);
        }
        epath = realpath(ppath, NULL);
        free(ppath);
        epath_free_needed = true;
    }
    char *app = get_bin_relative_path(DOMTERM_DIR_RELATIVE "/electron");
    char *app_fixed = fix_for_windows(app);
    char *format = "%s %s%s%s --url '%U'&";
    const char *g1 = "", *g2 = "";
    if (options->geometry && options->geometry[0]) {
        g1 = " --geometry ";
        g2 = options->geometry;
    }
    char *buf = xmalloc(strlen(epath)+strlen(app_fixed)+strlen(format)
                        +strlen(g1)+strlen(g2));
    sprintf(buf, format, epath, app_fixed, g1, g2);
    if (app_fixed != app)
        free(app_fixed);
    if (epath_free_needed)
        free(epath);
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
    char *path;
    bool free_needed = false;
    if (is_WindowsSubsystemForLinux())
        path = "/mnt/c/Windows/System32/cmd.exe /c start";
    else {
        path = find_in_path("gnome-open");
        if (path == NULL)
            path = find_in_path("kde-open");
        if (path != NULL)
            free_needed = true;
        else
            path = strdup("xdg-open");
    }
    char *pattern = xmalloc(strlen(path) + 40);
    sprintf(pattern, "%s '%%U' > /dev/null 2>&1", path);
    if (free_needed)
        free(path);
    subst_run_command(pattern, url, port);
    free(pattern);
#endif
}

void
default_link_command(const char *url)
{
    default_browser_command(url, 0);
}

void
do_run_browser(struct options *options, char *url, int port)
{
    const char *browser_specifier =
      ((options == NULL || options->browser_command == NULL)
       && opts.default_frontend == NULL
       && opts.browser_command != NULL
       && strcmp(opts.browser_command, "--print-url") != 0)
      ? opts.browser_command
      : options->browser_command;
    //if (browser_specifier==NULL)
        //browser_specifier = opts.browser_command;
    //else if (strcmp(browser_specifier, "--detached") == 0)
    //    return;
    if (browser_specifier == NULL && port_specified < 0) {
        char *default_frontend = main_options->default_frontend;
        if (default_frontend == NULL)
            default_frontend = "electron;qt;chrome;firefox;browser";
        const char *p = default_frontend;
        for (;;) {
            const char *argv0_end = NULL;
            const char *start = NULL;
            const char *end = NULL;
            const char *semi = extract_command_from_list(p, &start, &end, &argv0_end);
            int cmd_length = end-start;
            if (cmd_length > 0) {
                char *cmd = xmalloc(cmd_length + 1);
                memcpy(cmd, start, cmd_length);
                cmd[cmd_length] = '\0';
                int argv0_length = argv0_end-start;
                if (strcmp(cmd, "electron") == 0) {
                     browser_specifier = electron_command(1, options);
                     if (browser_specifier != NULL) {
                         free (cmd);
                         break;
                     }
                } else if (strcmp(cmd, "qt") == 0
                           || strcmp(cmd, "qtdomterm") == 0
                           || strcmp(cmd, "qtwebengine") == 0) {
                    browser_specifier = qtwebengine_command(1, options);
                    if (browser_specifier != NULL)
                        break;
                } else if (strcmp(cmd, "firefox") == 0) {
                    browser_specifier = firefox_browser_command();
                    if (browser_specifier != NULL)
                        break;
                } else if (strcmp(cmd, "chrome") == 0
                             || strcmp(cmd, "google-chrome") == 0) {
                        browser_specifier = chrome_command(); 
                    if (browser_specifier != NULL)
                        break;
                } else {
                    char save_argv0_end = cmd[argv0_length];
                    cmd[argv0_length] = '\0';
                    browser_specifier = find_in_path(cmd);
                    cmd[argv0_length] = save_argv0_end;
                    if (browser_specifier != NULL) {
                        browser_specifier = cmd;
                        break;
                    }
                }
                free(cmd);
            }
            if (*semi == 0) {
                fprintf(stderr, "no front-end command found\n");
                exit(-1);
            }
            p = semi+1;
        }
    }
    if (strcmp(browser_specifier, "--qtwebengine") == 0)
        browser_specifier = qtwebengine_command(0, options);
    if (strcmp(browser_specifier, "--electron") == 0)
        browser_specifier = electron_command(0, options);
    if (strcmp(browser_specifier, "--firefox") == 0)
        browser_specifier = firefox_command();
    else if (strcmp(browser_specifier, "--chrome") == 0
             || strcmp(browser_specifier, "--google-chrome") == 0) {
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
    return get_bin_relative_path(DOMTERM_DIR_RELATIVE "/domterm.jar");
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

void  init_options(struct options *opts)
{
    opts->browser_command = NULL;
    opts->geometry = NULL;
    opts->openfile_application = NULL;
    opts->openlink_application = NULL;
    opts->command_firefox = NULL;
    opts->command_chrome = NULL;
    opts->command_electron = NULL;
    opts->default_frontend = NULL;
    opts->http_server = false;
    opts->something_done = false;
    opts->paneOp = -1;
    opts->force_option = 0;
    opts->socket_name = NULL;
    opts->do_daemonize = 1;
    opts->debug_level = 0;
    opts->iface = NULL;
#if HAVE_OPENSSL
    opts->ssl = false;
    opts->cert_path = NULL;
    opts->key_path = NULL;
    opts->ca_path = NULL;
    opts->credential = NULL;
#endif
    opts->once = false;
    opts->reconnect = 10;
    opts->sig_code = SIGHUP;
    opts->sig_name = NULL; // FIXME
    opts->qt_remote_debugging = NULL;
    opts->fd_out = STDOUT_FILENO;
    opts->fd_err = STDERR_FILENO;
    opts->session_name = NULL;
    opts->settings_file = NULL;
    opts->shell_command = NULL;
    opts->shell_argv = NULL;
}

static char **default_argv = NULL;

char** default_command(struct options *opts)
{
    if (opts != NULL && opts->shell_argv != NULL)
        return opts->shell_argv;
    else if (main_options->shell_argv != NULL)
        return main_options->shell_argv;
    else
        return default_argv;
}

void prescan_options(int argc, char **argv, struct options *opts)
{
    // parse command line options
    int c;
    optind = 1;
    while ((c = getopt_long(argc, argv, opt_string, options, NULL)) != -1) {
        switch (c) {
            case SETTINGS_FILE_OPTION:
                opts->settings_file = optarg;
                break;
        }
    }
}

int process_options(int argc, char **argv, struct options *opts)
{
    // parse command line options
    optind = 1;
    int c;
    while ((c = getopt_long(argc, argv, opt_string, options, NULL)) != -1) {
        switch (c) {
            case 'h':
                print_help(stderr);
                opts->something_done = true;
                break;
            case 'v':
                if (git_describe[0])
                    printf("domterm version %s (git describe: %s)\n",
                           LDOMTERM_VERSION, git_describe);
                else
                    printf("domterm version %s\n",
                           LDOMTERM_VERSION);
                printf("Copyright %s Per Bothner and others\n", LDOMTERM_YEAR);
                opts->something_done = true;
                break;
            case 'd':
                opts->debug_level = atoi(optarg);
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
                    fprintf(stderr, "ttyd: invalid port: %s\n", optarg);
                    return -1;
                }
                break;
            case 'B':
                opts->browser_command = optarg == NULL ? "" : optarg;
                break;
            case FORCE_OPTION:
                opts->force_option = 1;
                break;
            case NO_DAEMONIZE_OPTION:
            case DAEMONIZE_OPTION:
                opts->do_daemonize = (c == DAEMONIZE_OPTION);
                break;
            case SESSION_NAME_OPTION:
                opts->session_name = optarg;
                break;
            case SETTINGS_FILE_OPTION:
                break; // handled in prescan_options
            case PANE_OPTION:
            case TAB_OPTION:
            case LEFT_OPTION:
            case RIGHT_OPTION:
            case BELOW_OPTION:
            case ABOVE_OPTION:
            case PRINT_URL_OPTION:
                opts->paneOp = c - PANE_OPTIONS_START;
                /* ... fall through ... */
            case DETACHED_OPTION:
            case ELECTRON_OPTION:
                opts->browser_command = argv[optind-1];
                break;
            case GEOMETRY_OPTION:
                opts->geometry = optarg;
                break;
            case CHROME_OPTION:
            case CHROME_APP_OPTION: {
                char *cbin = chrome_command();
                if (cbin == NULL) {
                    fprintf(stderr, "neither chrome or google-chrome command found\n");
                    exit(-1);
                }
                if (c == CHROME_APP_OPTION) {
                    char *b = xmalloc(strlen(cbin)+12);
                    sprintf(b, "%s -app='%%U'", cbin);
                    cbin = b;
                }
                opts->browser_command = cbin;
                break;
            }
            case FIREFOX_OPTION:
                opts->browser_command = firefox_command();
                break;
            case QTDOMTERM_OPTION:
                opts->browser_command = "--qtwebengine";
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
                    fprintf(stderr, "ttyd: invalid credential, format: username:password\n");
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
                    fprintf(stderr, "ttyd: invalid signal: %s\n", optarg);
                    return -1;
                }
            }
                break;
            case 'r':
                opts->reconnect = atoi(optarg);
                if (opts->reconnect <= 0) {
                    fprintf(stderr, "ttyd: invalid reconnect: %s\n", optarg);
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
    memset(&info, 0, sizeof(info));
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
    info.extensions = extensions;
    info.timeout_secs = 5;
#ifdef RESOURCE_DIR
    mount_domterm_zip.origin = get_resource_path();
#endif
    info.mounts = &mount_domterm_zip;

    char *shell = getenv("SHELL");
    if (shell == NULL)
        shell = DEFAULT_SHELL;
    default_argv = parse_args(shell);

    init_options(&opts);
    prescan_options(argc, argv, &opts);
    read_settings_file(&opts);
    if (process_options(argc, argv, &opts) != 0)
        return -1;
    if (opts.something_done && argv[optind] == NULL)
        exit(0);

    const char *cmd = argv[optind];
    struct command *command = cmd == NULL ? NULL : find_command(cmd);
    if (command == NULL && cmd != NULL && index(cmd, '/') == NULL) {
        fprintf(stderr, "domterm: unknown command '%s'\n", cmd);
        exit(EXIT_FAILURE);
    }
    int socket = -1;
    if ((command == NULL ||
         (command->options &
          (COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER)) != 0))
      socket = client_connect(make_socket_name(false), 0);
    if (command != NULL
        && ((command->options & COMMAND_IN_CLIENT) != 0
            || ((command->options & COMMAND_IN_CLIENT_IF_NO_SERVER) != 0
                && socket < 0)))
          exit((*command->action)(argc-optind, argv+optind,
                                  NULL, NULL, NULL, &opts));
    if (socket >= 0) {
        const char *state_as_json = state_to_json(argc, argv, environ);
        size_t jlen = strlen(state_as_json);

        struct msghdr msg;
        int myfds[2];
        myfds[0] = STDOUT_FILENO;
        myfds[1] = STDERR_FILENO;
        union u { // for alignment
          char buf[CMSG_SPACE(sizeof myfds)];
          struct cmsghdr align;
        } u;
        msg.msg_control = u.buf;
        msg.msg_controllen = sizeof u.buf;
        struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
        cmsg->cmsg_len = CMSG_LEN(sizeof(int) * 2);
        memcpy(CMSG_DATA(cmsg), myfds, sizeof(int) * 2);
        msg.msg_controllen = cmsg->cmsg_len;
        cmsg->cmsg_level = SOL_SOCKET;
        cmsg->cmsg_type = SCM_RIGHTS;
        struct iovec iov[2];
        iov[0].iov_base = (char*) state_as_json;
        iov[0].iov_len = jlen;
        iov[1].iov_base = "\f";
        iov[1].iov_len = 1;
        msg.msg_name = NULL;
        msg.msg_namelen = 0;
        msg.msg_iov = iov;
        msg.msg_iovlen = 2;
        msg.msg_flags = 0;
        errno = 0;
        ssize_t n1 = sendmsg(socket, &msg, 0);
        close(STDOUT_FILENO);
        close(STDERR_FILENO);
        char ret = -1;
        ssize_t n2 = read(socket, &ret, 1);
        if (n1 < 0 || n2 != 1)
             ret = -1;
        //if (close(socket) != 0)
        //  fatal("bad close of socket");
        close(socket);
        exit(ret);
    }

    server = tty_server_new(argc-optind, argv+optind);
    server->options = opts;

    if (port_specified < 0)
        server->client_can_close = true;

    lws_set_log_level(opts.debug_level, NULL);

#if LWS_LIBRARY_VERSION_MAJOR >= 2
    char server_hdr[128] = "";
    sprintf(server_hdr, "domterm/%s (libwebsockets/%s)", LDOMTERM_VERSION, LWS_LIBRARY_VERSION);
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

    signal(SIGINT, sig_handler);  // ^C
    signal(SIGTERM, sig_handler); // kill

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

    watch_settings_file();

    char *cname = make_socket_name(false);
    lws_sock_file_fd_type csocket;
    csocket.filefd = create_command_socket(cname);
    struct lws *cmdwsi = lws_adopt_descriptor_vhost(vhost, 0, csocket, "cmd", NULL);
    cclient = (struct cmd_client *) lws_wsi_user(cmdwsi);
    cclient->socket = csocket.filefd;
    make_html_file(http_port);

    lwsl_notice("TTY configuration:\n");
    if (opts.credential != NULL)
        lwsl_notice("  credential: %s\n", opts.credential);
    lwsl_notice("  reconnect timeout: %ds\n", opts.reconnect);
    lwsl_notice("  close signal: %s (%d)\n",
                opts.sig_name != NULL ? opts.sig_name :
                opts.sig_code == SIGHUP ? "SIGHUP" : "???",
                opts.sig_code);
    if (opts.check_origin)
        lwsl_notice("  check origin: true\n");
    if (opts.readonly)
        lwsl_notice("  readonly: true\n");
    if (opts.once)
        lwsl_notice("  once: true\n");
    int ret;
    if (port_specified >= 0 && server->options.browser_command == NULL) {
        fprintf(stderr, "Server start on port %d. You can browse %s://localhost:%d/\n",
                http_port, opts.ssl ? "https" : "http", http_port);
        opts.http_server = true;
        ret = 0;
    } else {
        ret = handle_command(argc-optind, argv+optind,
                             ".", environ, NULL, &opts);
    if (ret != 0)
        force_exit = 1;
    }

    if (opts.do_daemonize && ret == 0) {
#if 1
        if (daemon(1, 0) != 0)
            lwsl_err("daemonizing failed\n");
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

    return ret;
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
        r = strstr(buf, "Microsoft") != NULL;
        close(f);
    }
    is_WSL_cache = r ? 1 : -1;
    return r;
}

static char *userprofile_cache;

char *get_WSL_userprofile()
{
    if (userprofile_cache == NULL) {
        FILE *f = popen("/mnt/c/Windows/System32/cmd.exe /C \"echo %USERPROFILE%\"", "r");
        if (f == NULL)
            return NULL;
        char buf[512];
        int i = 0;
        for (;;) {
            size_t avail = sizeof(buf) - 1 - i;
            if (avail <= 0)
                return NULL;
            size_t n = fread(buf+i, 1, avail, f);
            if (n == 0)
                break;
            i += n;
        }
        fclose(f);
        buf[i] = '\0';
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
    char *user_prefix = "C:\\Users\\";
    size_t user_prefix_length;
    char *tmp;
    if (check_wsl && is_WindowsSubsystemForLinux()
	&& (user_profile = get_WSL_userprofile()) != NULL
	&& strlen(user_profile) > (user_prefix_length = strlen(user_prefix))
	&& memcmp(user_profile, user_prefix, user_prefix_length) == 0) {
	const char *fmt = "/mnt/c/Users/%s/AppData/%s/DomTerm";
	char *subdir = settings ? "Roaming" : "Local";
	tmp = xmalloc(strlen(fmt) - 3 + strlen(subdir) + strlen(user_profile) - user_prefix_length);
	sprintf(tmp, fmt, user_profile+user_prefix_length, subdir);
    } else {
        const char *home = find_home();
	const char *hdir = "/.domterm";
	tmp = xmalloc(strlen(home)+strlen(hdir)+1);
	sprintf(tmp, "%s%s", home, hdir);
    }
    if (mkdir(tmp, S_IRWXU) != 0 && errno != EEXIST)
        fatal("cannot create directory '%s'\n, tmp");
    return tmp;
}

const char *
domterm_settings_dir()
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
        char *ext;
	if (html_filename) {
            ext = dot < 0 ? ".html" : "";
	    if (dot >= 0)
                socket_name_length = dot;
	} else
            ext = dot < 0 ? ".socket" : "";
        int len = socket_name_length + strlen(ext);
        if (socket_name[0] != '/') {
            r = xmalloc(len + strlen(ddir) + 2);
            sprintf(r, "%s/%.*s%s", ddir, socket_name_length, socket_name, ext);
        } else {
            r = xmalloc(len + 1);
            sprintf(r, "%.*s%s", socket_name_length, socket_name, ext);
        }
    } else {
      const char *sname = html_filename ? "/default.html" : "/default.socket";
        r = xmalloc(strlen(ddir)+strlen(sname)+1);
        sprintf(r, "%s%s", ddir, sname);
    }
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
    "<script type='text/javascript' src='hlib/qwebchannel.js'> </script>\n"
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
    char *sname = make_socket_name(true);
    char *sext = strrchr(sname, '.');
    const char*prefix = "file://";
    const char *ext = ".html";
    char *buf = xmalloc(strlen(prefix)+(sext-sname)+strlen(ext)+1);
    sprintf(buf, "%s%.*s%s", prefix, (int) (sext-sname), sname, ext);
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

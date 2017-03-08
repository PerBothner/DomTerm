#include "server.h"

#if 1
#include "version.h"
#else
#define LDOMTERM_VERSION "1.2.2"
#endif

#ifndef DEFAULT_ARGV
#define DEFAULT_ARGV {"/bin/bash", NULL }
#endif

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

void
default_browser_command(const char *url, int port)
{
#ifdef DEFAULT_BROWSER_COMMAND
    subst_run_command(DEFAULT_BROWSER_COMMAND, url, port);
#elif __APPLE__
    subst_run_command("open %U > /dev/null 2>&1", url, port);
#elif defined(_WIN32) || defined(__CYGWIN__)
    ShellExecute(0, 0, url, 0, 0 , SW_SHOW) > 32 ? 0 : 1;
#else
    // check if X server is running
    //if (system("xset -q > /dev/null 2>&1"))
    //return 1;
    subst_run_command("xdg-open %U > /dev/null 2>&1", url, port);
#endif
}

volatile bool force_exit = false;
struct lws_context *context;
struct tty_server *server;
char *(default_argv[]) = DEFAULT_ARGV;

// websocket protocols
static const struct lws_protocols protocols[] = {
        {"http-only", callback_http, 0,                          0},
        {"domterm",   callback_tty,  sizeof(struct tty_client),  0},
        {NULL,        NULL,          0,                          0}
};

// websocket extensions
static const struct lws_extension extensions[] = {
        {"permessage-deflate", lws_extension_callback_pm_deflate, "permessage-deflate"},
        {"deflate-frame",      lws_extension_callback_pm_deflate, "deflate_frame"},
        {NULL, NULL, NULL}
};

/*#define ZIP_MOUNT "/domterm" */
#define ZIP_MOUNT "/" 

#if USE_NEW_FOPS
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
#endif

#define CHROME_OPTION 1000
#define FIREFOX_OPTION 1001
#define QTDOMTERM_OPTION 1002

// command line options
static const struct option options[] = {
        {"port",         required_argument, NULL, 'p'},
        {"browser",      optional_argument, NULL, 'B'},
        {"chrome",       no_argument,       NULL, CHROME_OPTION},
        {"google-chrome",no_argument,       NULL, CHROME_OPTION},
        {"firefox",      no_argument,       NULL, FIREFOX_OPTION},
        {"qtdomterm",    no_argument,       NULL, QTDOMTERM_OPTION},
        {"qtwebengine",  no_argument,       NULL, QTDOMTERM_OPTION},
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
static const char *opt_string = "p:B::i:c:u:g:s:r:I:aSC:K:A:Rt:Ood:vh";

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
                    "If no --port option is pecified, --browser --once are implied.\n",
            LDOMTERM_VERSION
    );
}

struct tty_server *
tty_server_new(int argc, char **argv, int start) {
    struct tty_server *ts;
    size_t cmd_len = 0;

    ts = xmalloc(sizeof(struct tty_server));

    memset(ts, 0, sizeof(struct tty_server));
    LIST_INIT(&ts->clients);
    ts->client_count = 0;
    ts->reconnect = 10;
    ts->sig_code = SIGHUP;
    ts->sig_name = strdup("SIGHUP");

    int cmd_argc = argc - start;
    if (cmd_argc == 0) {
        start = 0;
        argv = default_argv;
        cmd_argc = 0;
        while (argv[cmd_argc])
            cmd_argc++;
    }
    char **cmd_argv = &argv[start];
    ts->argv = xmalloc(sizeof(char *) * (cmd_argc + 1));
    for (int i = 0; i < cmd_argc; i++) {
        ts->argv[i] = strdup(cmd_argv[i]);
        cmd_len += strlen(ts->argv[i]);
        if (i != cmd_argc - 1) {
            cmd_len++; // for space
        }
    }
    ts->argv[cmd_argc] = NULL;

    ts->command = xmalloc(cmd_len);
    char *ptr = ts->command;
    for (int i = 0; i < cmd_argc; i++) {
        ptr = stpcpy(ptr, ts->argv[i]);
        if (i != cmd_argc - 1) {
            sprintf(ptr++, "%c", ' ');
        }
    }

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
    free(ts->command);
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

int
calc_command_start(int argc, char **argv) {
    // make a copy of argc and argv
    int argc_copy = argc;
    char **argv_copy = xmalloc(sizeof(char *) * argc);
    for (int i = 0; i < argc; i++) {
        argv_copy[i] = strdup(argv[i]);
    }

    // do not print error message for invalid option
    opterr = 0;
    while (getopt_long(argc_copy, argv_copy, opt_string, options, NULL) != -1)
        ;

    int start = argc;
    if (optind < argc) {
        char *command = argv_copy[optind];
        for (int i = 0; i < argc; i++) {
            if (strcmp(argv[i], command) == 0) {
                start = i;
                break;
            }
        }
    }

    // free argv copy
    for (int i = 0; i < argc; i++) {
        free(argv_copy[i]);
    }
    free(argv_copy);

    // reset for next use
    opterr = 1;
    optind = 0;

    return start;
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
chrome_command()
{
    char *cbin = getenv("CHROME_BIN");
    if (cbin != NULL && access(cbin, X_OK) == 0)
        return cbin;
    char *path = getenv("PATH");
    int plen = strlen(path);
    char *end = path + plen;
    char *buf = xmalloc(plen + 20);
    for (;;) {
        char* colon = strchr(path, ':');
        if (colon == NULL)
            colon = end;
        if (path != colon) {
            sprintf(buf, "%.*s/chrome", colon-path, path);
            if (access(buf, X_OK) == 0)
                return buf;
            sprintf(buf, "%.*s/google-chrome", colon-path, path);
            if (access(buf, X_OK) == 0)
                return buf;
        }
        if (colon == end)
            return NULL;
        path = colon + 1;
    }
}

char *
chrome_app_command(char *chrome_cmd)
{
    char *crest = " --app=%U >/dev/null";
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
    char *xulapp = firefox_xul_application();
    if (xulapp != NULL && access(xulapp, R_OK) == 0) {
        return firefox_xul_command(xulapp);
    } else {
        fprintf(stderr, "Firefox XUL application.ini not found.\n");
        fprintf(stderr,
                "Treating as --browser=firefox (which uses a regular Firefox browser window).\n");
        return "firefox";
    }
}

char *
get_domterm_jar_path()
{
    return get_bin_relative_path("/share/domterm/domterm.jar");
}

int
main(int argc, char **argv) {
    int start = calc_command_start(argc, argv);
    server = tty_server_new(argc, argv, start);

    struct lws_context_creation_info info;
    memset(&info, 0, sizeof(info));
    int port_specified = -1;
    info.port = 0;
    info.iface = NULL;
    info.protocols = protocols;
    info.ssl_cert_filepath = NULL;
    info.ssl_private_key_filepath = NULL;
    info.gid = -1;
    info.uid = -1;
    info.max_http_header_pool = 16;
    info.options = LWS_SERVER_OPTION_VALIDATE_UTF8;
    info.extensions = extensions;
    info.timeout_secs = 5;
#if USE_NEW_FOPS
    mount_domterm_zip.origin = get_resource_path();
    info.mounts = &mount_domterm_zip;
#endif

    int debug_level = 0;
    char iface[128] = "";
    bool ssl = false;
    char cert_path[1024] = "";
    char key_path[1024] = "";
    char ca_path[1024] = "";

    struct json_object *client_prefs = json_object_new_object();
    char *browser_command = NULL;

    // parse command line options
    int c;
    while ((c = getopt_long(start, argv, opt_string, options, NULL)) != -1) {
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
            case QTDOMTERM_OPTION:
                fprintf(stderr,
                        "Warning: The --qtdomterm option is experimental "
                        "and not fully working!\n");
                browser_command =
                    get_bin_relative_path("/bin/qtdomterm --connect %U &");
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
                    const char* home = getenv("HOME");
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
                for (; optind < start && *argv[optind] != '-'; optind++) {
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
    server->prefs_json = strdup(json_object_to_json_string(client_prefs));
    json_object_put(client_prefs);

    if (server->command == NULL || strlen(server->command) == 0) {
        fprintf(stderr, "ttyd: missing start command\n");
        return -1;
    }

    if (port_specified < 0)
        server->once = true;

    lws_set_log_level(debug_level, NULL);

#if LWS_LIBRARY_VERSION_MAJOR >= 2
    char server_hdr[128] = "";
    sprintf(server_hdr, "ldomterm/%s (libwebsockets/%s)", LDOMTERM_VERSION, LWS_LIBRARY_VERSION);
    info.server_string = server_hdr;
#endif

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
    if (context == NULL) {
        lwsl_err("libwebsockets init failed\n");
        return 1;
    }

#if !USE_NEW_FOPS
    initialize_resource_map(context, get_domterm_jar_path());
#endif

    lwsl_notice("TTY configuration:\n");
    if (server->credential != NULL)
        lwsl_notice("  credential: %s\n", server->credential);
    lwsl_notice("  start command: %s\n", server->command);
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
    if (port_specified >= 0 && browser_command == NULL)
      fprintf(stderr, "Server start on port %d. You can browse http://localhost:%d/#ws=same\n",
              info.port, info.port);

    if (browser_command != NULL || port_specified < 0) { 
        char *url = xmalloc(100);
        int port = info.port;
        sprintf(url, "http://localhost:%d/#ws=same", port);
        if (browser_command == NULL && port_specified < 0) {
            // The default is "--chrome" followed by "--browser"
            browser_command = chrome_command();
            if (browser_command != NULL)
                browser_command = chrome_app_command(browser_command);
            else
                browser_command = "";
        }
        if (strcmp(browser_command, "firefox") == 0)
            browser_command = firefox_browser_command();
        else if (strcmp(browser_command, "chrome") == 0
                 || strcmp(browser_command, "google-chrome") == 0) {
            browser_command = chrome_command();
            if (browser_command == NULL) {
                fprintf(stderr, "neither chrome or google-chrome command found\n");
                exit(-1);
            }
        }
        if (browser_command[0] == '\0')
            default_browser_command(url, port);
        else
            subst_run_command(browser_command, url, port);
    }

    // libwebsockets main loop
    while (!force_exit) {
#if ! USE_ADOPT_FILE
        pthread_mutex_lock(&server->lock);
        if (!LIST_EMPTY(&server->clients)) {
            struct tty_client *client;
            LIST_FOREACH(client, &server->clients, list) {
                if (!STAILQ_EMPTY(&client->queue)) {
                    lws_callback_on_writable(client->wsi);
                }
            }
        }
        pthread_mutex_unlock(&server->lock);
#endif
        lws_service(context, 100);
    }

    lws_context_destroy(context);

    // cleanup
    tty_server_free(server);

    return 0;
}

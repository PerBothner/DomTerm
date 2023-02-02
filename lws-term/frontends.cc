/** Manage front-ends (browser applications) for DomTerm. */
   
#include "server.h"
#include <regex>

static std::string current_geometry;
/** Returns a fresh copy of the (non-empty) geometry string, or NULL. */
static const char *
geometry_option(struct options *options)
{
    if (! main_options->geometry_option.empty())
        current_geometry = main_options->geometry_option;
    else {
        current_geometry = get_setting_s(options->settings, "window.geometry");
        tty_client *first_window = main_windows.first();
        // If there is a previous window (in addition to the one
        // currently being created), ignore position part.
        if (first_window && main_windows.next(first_window)) {
            int window_pos = current_geometry.find_first_of("+-");
            if (window_pos != std::string::npos) {
                current_geometry.erase(window_pos);
            }
        }
    }
    return current_geometry.empty() ? nullptr : current_geometry.c_str();
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
            char *buf = challoc(fname_length);
            snprintf(buf, fname_length, "%c:/%s",
                     fname[mnt_prefix_length], fname+mnt_prefix_length+1);
            return buf;
        }
    }
    return fname;
}

/** Return freshly allocated command string or NULL */
static char *
electron_command(struct options *options, int wnum)
{
    char *epath_free_needed = NULL;
    const char *epath = get_setting(options->settings, "command.electron");
    if (epath == NULL) {
        char *ppath = find_in_path("electron");
        if (ppath == NULL && is_WindowsSubsystemForLinux())
            ppath = find_in_path("electron.exe");
        if (ppath == NULL)
            return NULL;
        epath_free_needed = realpath(ppath, NULL);
        epath = epath_free_needed;
        free(ppath);

    }
    char *app = get_bin_relative_path(DOMTERM_DIR_RELATIVE "/electron");
    char *app_fixed = fix_for_windows(app);
    struct sbuf sb;
#ifdef __APPLE__
    sb.printf("/usr/bin/open -a %s --args", epath);
#else
    sb.printf("%s", epath);
#endif
    sb.printf(" %s", app_fixed);
    const char *geometry = geometry_option(options);
    if (geometry)
        sb.printf(" --geometry %s", geometry);
    if (options->headless)
        sb.printf(" --headless");
    if (wnum > 0)
        sb.printf(" --window-number %d", wnum);
    std::string titlebar = get_setting_s(options->settings, "titlebar");
    if (! titlebar.empty())
        sb.printf(" --titlebar '%s'",
                  titlebar == "system" ? "system" : "domterm");
    sb.append(" --url '%U'");
    if (app_fixed != app)
        free(app_fixed);
    if (epath_free_needed)
        free(epath_free_needed);
    return sb.strdup();
}

/** Return freshly allocated command string or NULL */
static char *
qtdomterm_program()
{
    char *cmd = get_bin_relative_path("/bin/qtdomterm");
    if (cmd == NULL || access(cmd, X_OK) != 0) {
        if (cmd == NULL)
            free(cmd);
        return NULL;
    }
    return cmd;
}

/** Return freshly allocated command string or NULL */
static char *
qtwebengine_command(const char *cmd, struct options *options,
                    int wnum, int app_number)
{
    struct sbuf sb;
    const char *geometry = geometry_option(options);
    sb.append(cmd);
    if (geometry)
        sb.printf(" --geometry %s", geometry);
    if (options->qt_remote_debugging)
        sb.printf(" --remote-debugging-port=%s", options->qt_remote_debugging);
    if (wnum > 0)
        sb.printf(" --window-number=%d", wnum);
    if (app_number > 0)
        sb.printf(" --app-number=%d", app_number);
    if (options->headless)
        sb.append(" --headless");
    std::string titlebar = get_setting_s(options->settings, "titlebar");
    if (! titlebar.empty())
        sb.printf(" --titlebar='%s'",
                  titlebar == "system" ? "system" : "domterm");
    sb.printf(" --command-socket='%s'", backend_socket_name);
    sb.append(" --connect '%U'");
    return sb.strdup();
}

/** Return freshly allocated command string or NULL */
static char *
webview_command(struct options *options)
{
    char *cmd = get_bin_relative_path("/libexec/dt-webview");
    if (cmd == NULL || access(cmd, X_OK) != 0) {
        if (cmd == NULL)
            free(cmd);
        return NULL;
    }
    int bsize = strlen(cmd)+100;
    const char *geometry = geometry_option(options);
    if (geometry)
        bsize += strlen(geometry);
    char *buf = challoc(bsize);
    strcpy(buf, cmd);
    free(cmd);
    if (geometry) {
        strcat(buf, " --geometry ");
        strcat(buf, geometry);
    }
    strcat(buf, " '%U'");
    return buf;
}

/** Return freshly allocated command string or NULL */
static char *
wry_command(struct options *options, int wnum)
{
    char *cmd = get_bin_relative_path("/libexec/dt-wry");
    if (cmd == NULL || access(cmd, X_OK) != 0) {
        if (cmd == NULL)
            free(cmd);
        return NULL;
    }
    struct sbuf sb;
    sb.append(cmd);
    const char *geometry = geometry_option(options);
    if (geometry) {
        sb.printf(" --geometry %s", geometry);
    }
    if (wnum > 0)
        sb.printf(" --window-number %d", wnum);
    std::string titlebar = get_setting_s(options->settings, "titlebar");
    if (! titlebar.empty())
        sb.printf(" --titlebar '%s'",
                  titlebar == "system" ? "system" : "domterm");
    sb.append(" '%U'");
    return sb.strdup();
}

/** Return freshly allocated command string or NULL */
const char *
chrome_command(bool app_mode, struct options *options)
{
    bool free_needed = false;
    const char *chrome_cmd = get_setting(options->settings, "command.chrome");
    if (chrome_cmd == NULL && (chrome_cmd = getenv("CHROME_BIN")) != NULL
        && access(chrome_cmd, X_OK) == 0) {
        const char *c = maybe_quote_arg(chrome_cmd);
        free_needed = c != chrome_cmd;
        chrome_cmd = c;
    }
    if (chrome_cmd == NULL) {
        char *pbin = find_in_path("chrome");
        if (pbin == NULL)
            pbin = find_in_path("google-chrome");
        if (pbin != NULL) {
            chrome_cmd = maybe_quote_arg(pbin);
            free_needed = chrome_cmd != pbin;
        }
    }
    if (chrome_cmd == NULL && is_WindowsSubsystemForLinux()) {
#define CHROME_EXE "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
	if (access(CHROME_EXE, X_OK) == 0) {
            chrome_cmd = "'" CHROME_EXE "'";
        }
    }
#if __APPLE__
    // FIXME - better to open -a "Google Chrome" OR open -b com.google.Chrome
#define CHROME_MAC "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if (chrome_cmd == NULL && access(CHROME_MAC, X_OK) == 0) {
        chrome_cmd = "'" CHROME_MAC "'";
    }
#endif
    if (chrome_cmd == NULL)
        return NULL;
    struct sbuf sb;
    sb.append(chrome_cmd);
    if (free_needed)
        free((void*) chrome_cmd);

    geometry_option(options);
    std::string geometry = current_geometry;
    // -Bchrome-app like to create maximum-size windows by default.1
    if (app_mode && geometry.empty())
        geometry = "800x600";
    if (! geometry.empty()) {
        int window_pos = geometry.find_first_of("+-");
        if (window_pos != std::string::npos) {
            geometry.erase(window_pos);
        }
        // chrome uses --window-size=WIDTH,HEIGHT - using comma as separator
        window_pos = geometry.find_first_of("x");
        if (window_pos != std::string::npos) {
            geometry.replace(window_pos, 1, ",");
        }
        sb.printf(" --window-size=%s", geometry.c_str());
    }

    if (options->headless)
        sb.append(" --headless --remote-debugging-port=0 '%U'");
    else if (app_mode)
        sb.append(" --app='%U'");
    return sb.strdup();
}

/** Return freshly allocated command string or NULL */
const char *
edge_browser_command(bool app_mode, struct options *options)
{
    bool free_needed = false;
    const char *edge_cmd = get_setting(options->settings, "command.edge");
    if (edge_cmd == NULL && is_WindowsSubsystemForLinux()) {
#define EDGE_EXE "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
	if (access(EDGE_EXE, X_OK) == 0) {
            edge_cmd = "\"" EDGE_EXE "\"";
        }
    }
    if (edge_cmd == NULL)
        return NULL;
    struct sbuf sb;
    sb.append(edge_cmd);
    if (free_needed)
        free((void*) edge_cmd);
    if (options->headless)
        sb.append(" --headless '%U'");
    else if (app_mode)
        sb.append(" --app='%U%g'");
    return sb.strdup();
}

const char *
firefox_browser_command(struct options *options)
{
    const char *firefox_cmd = get_setting(options->settings, "command.firefox");
    if (firefox_cmd != NULL)
        return firefox_cmd;
    char *firefoxCommand = find_in_path("firefox");
    if (firefoxCommand != NULL)
        return firefoxCommand;
    if (is_WindowsSubsystemForLinux()) {
#define firefoxWSL "/mnt/c/Program Files/Mozilla Firefox/firefox.exe"
#define firefoxWSL86 "/mnt/c/Program Files (x86)/Mozilla Firefox/firefox.exe"
        if (access(firefoxWSL, X_OK) == 0)
            return "\"" firefoxWSL "\"";
        if (access(firefoxWSL86, X_OK) == 0)
            return "\"" firefoxWSL86 "\"";
    }
#define firefoxMac "/Applications/Firefox.app"
    if (access(firefoxMac, X_OK) == 0)
        //return "/usr/bin/open -a " firefoxMac " '%U'";
        return firefoxMac "/Contents/MacOS/firefox '%U'";
    return NULL;
}

std::string default_browser_command()
{
#ifdef DEFAULT_BROWSER_COMMAND
    return DEFAULT_BROWSER_COMMAND;
#elif __APPLE__
    return "/usr/bin/open '%U'";
#else
    // Prefer gnome-open or kde-open over xdg-open because xdg-open
    // under Gnome defaults to using 'gio open', which does drops the "hash"
    // part of a "file:" URL, and may also use a non-preferred browser.
    if (is_WindowsSubsystemForLinux()) {
        return "/mnt/c/Windows/System32/cmd.exe /c start '%U'";
    } else {
        char *mpattern = find_in_path("xdg-open");
        if (mpattern == NULL)
            mpattern = find_in_path("kde-open");
        if (mpattern == NULL)
            return "firefox";
        std::string tmp(mpattern);
        free(mpattern);
        return tmp;
    }
#endif
}

/** Options to request browser client to open new browser window. */
static std::string
browser_run_json_options(struct options *options, const char *url, int wnum)
{
    json jobj;
    jobj["url"] = url;
    const char *geometry = geometry_option(options);
    if (geometry) {
        std::string geom = geometry;
        std::regex position_rx("^(.*)([-+][0-9]+[-+][0-9]+)$");
        std::smatch match;
        if (std::regex_match(geom, match, position_rx)) {
            jobj["position"] = match[2].str();
            geom = match[1].str();
        }
        std::regex size_rx("^([0-9]+)x([0-9]+)$");
        if (std::regex_match(geom, match, size_rx)) {
            jobj["width"] = strtol(match[1].str().c_str(), nullptr, 10);
            jobj["height"] = strtol(match[2].str().c_str(), nullptr, 10);
        }
    }
    if (options->headless)
        jobj["headless"] = true;
    std::string titlebar = get_setting_s(options->settings, "titlebar");
    if (! titlebar.empty())
        jobj["titlebar"] = titlebar;
    if (wnum > 0)
        jobj["windowNumber"] = wnum;
    return jobj.dump();
}

static std::string
subst_command(struct options *opts, const char *browser_command,
              const char *url)
{
    size_t clen = strlen(browser_command);
    const char *upos = strstr(browser_command, "%U");
    const char *gpos = strstr(browser_command, "%g");
    int skip = 2;
    char *url_tmp = NULL;
    const char *url_fixed = url;
    size_t ulen = strlen(url);
    if (upos && gpos && gpos == upos+2) {
        const char *geometry = geometry_option(opts);
        skip = 4;
        if (geometry) {
            size_t tlen = ulen+strlen(geometry)+20;
            char *tbuf = challoc(tlen);
            const char *g1 = strchr(url, '#') ? "&geometry=" : "#geometry";
            snprintf(tbuf, tlen, "%s%s%s", url_fixed, g1, geometry);
	    free(url_tmp);
	    url_fixed = url_tmp = tbuf;
            ulen = strlen(url_fixed);
        }
    }
    sbuf cmd;
    const char *wpos;
    if (is_WindowsSubsystemForLinux() && strstr(browser_command, ".exe") != NULL) {
        const char *wsl_prefix = "file:///mnt/c/";
        size_t wsl_prefix_length = strlen(wsl_prefix);
        if (memcmp(url, wsl_prefix, wsl_prefix_length) == 0) {
	    char *tbuf = challoc(ulen);
            snprintf(tbuf, ulen, "file:///c:/%s", url+wsl_prefix_length);
	    free(url_tmp);
            url_fixed = url_tmp = tbuf;
	}

        const char *cp = strstr(browser_command, "cmd.exe");
        const char *sp;
        if (cp && ((sp = strchr(browser_command, ' ')) == NULL || sp > cp)) {
            char *tbuf = challoc(2 * ulen);
            const char *p0 = url_fixed;
            char *p1 = tbuf;
            const char *metas = "()%!^\"<>&| \t";
            for (;;) {
                char ch = *p0++;
                if (ch != 0 && strchr(metas, ch)) {
                    *p1++ = '^';
                }
                *p1++ = ch;
                if (ch == 0)
                    break;
            }
	    free(url_tmp);
            url_fixed = url_tmp = tbuf;
        }
    }
    if (upos) {
        size_t beforeU = upos - browser_command;
        cmd.printf("%.*s%s%.*s",
                   (int) beforeU, browser_command,
                   url_fixed,
                   (int) (clen - beforeU - skip), upos+skip);
    } else
        cmd.printf("%s '%s'", browser_command, url_fixed);
    free(url_tmp);
    return cmd.null_terminated();
}
static int
subst_run_command(struct options *opts, const char *browser_command,
                  const char *url)
{
    std::string cmd = subst_command(opts, browser_command, url);
    const char *ccmd = cmd.c_str();
    lwsl_notice("starting frontend command: %s\n", ccmd);
    return start_command(opts, ccmd, nullptr);
}

static int
default_browser_run(const char *url, struct options *options)
{
    std::string cmd = default_browser_command();
    return subst_run_command(options, cmd.c_str(), url);
}

void
default_link_command(const char *url)
{
#if !defined(DEFAULT_BROWSER_COMMAND) && (defined(_WIN32)||defined(__CYGWIN__))
    ShellExecute(0, 0, url, 0, 0 , SW_SHOW) > 32 ? 0 : 1;
#else
    default_browser_run(url, main_options);
#endif
}

int
do_run_browser(struct options *options, struct tty_client *tclient, const char *url, int wnum)
{
    bool start_only = false;
    std::string browser_specifier_string; // placeholder for allocation
    const char *browser_specifier;
    if (options != NULL && ! options->browser_command.empty()) {
        browser_specifier = options->browser_command.c_str();
        if (options->paneOp < 0)
            main_options->browser_command = browser_specifier;
    } else if (main_options->browser_command.empty()) {
        browser_specifier = nullptr;
    } else {
        browser_specifier = main_options->browser_command.c_str();
    }
    bool do_electron = false, do_Qt = false, do_wry = false;
    if (port_specified < 0
        && (browser_specifier == nullptr || browser_specifier[0] != '-')) {
        const char *p = browser_specifier;
        if (! p) {
            p = get_setting(options->settings, "browser.default");
            if (! p) {
                if (is_WindowsSubsystemForLinux())
                    p = "edge-app;electron;qt;chrome-app;firefox;browser";
                else if (is_SwayDesktop())
                    p = "wry;electron;qt;chrome-app;safari;firefox;browser";
                else {
#if __APPLE__
                    bool prefer_Qt = true;
#if 0
                    if (Qt framework not installed)
                        prefer_Qt = false;
#endif
                    if (prefer_Qt)
                        p = "qt;wry;electron;chrome-app;firefox;browser";
                    else
                        p = "wry;qt;electron;chrome-app;firefox;browser";
#else
                    p = "electron;qt;wry;chrome-app;safari;firefox;browser";
#endif
                }
            }
        }
        std::string error_if_single;
        int num_tries = 0;
        for (;;) {
            const char *argv0_end = NULL;
            const char *start = NULL;
            const char *end = NULL;
            const char *semi = extract_command_from_list(p, &start, &end, &argv0_end);
            int cmd_length = end-start;
            if (cmd_length > 0) {
                num_tries++;
                std::string cmd(start, cmd_length);
                bool app_mode;
                if (cmd == "browser") {
                    browser_specifier_string = default_browser_command();
                    browser_specifier = browser_specifier_string.c_str();
                    break;
                }
                if (cmd == "electron") {
                    browser_specifier = electron_command(options, wnum);
                    if (browser_specifier == NULL)
                        error_if_single = "'electron' not found in PATH";
                    else {
                        do_electron = true;
                        start_only = true;
                        break;
                    }
                } else if (cmd == "webview") {
                    browser_specifier = webview_command(options);
                    if (browser_specifier == NULL)
                        error_if_single = "cannot find dt-webview command";
                    else
                        break;
                } else if (cmd == "wry") {
                    browser_specifier = wry_command(options, wnum);
                    if (browser_specifier == NULL)
                        error_if_single = "cannot find dt-wry command";
                    else {
                        do_wry = true;
                        start_only = true;
                        break;
                    }
                } else if (cmd == "qt"
                           || cmd == "qtdomterm"
                           || cmd == "qt-frames"
                           || cmd == "qt-widgets"
                           || cmd == "qtwebengine") {
                    char *cmd = qtdomterm_program();
                    if (cmd == nullptr)
                        error_if_single = "'qtdomterm' front-end missing";
                    else {
                        do_Qt = true;
                        browser_specifier_string = cmd;
                        free(cmd);
                        options->qt_frontend = true;
                        start_only = true;
                        break;
                    }
                } else if (cmd == "firefox") {
                    browser_specifier = firefox_browser_command(options);
                    if (browser_specifier == NULL)
                        error_if_single = "firefox not found";
                    else
                        break;
                } else if ((app_mode = (cmd == "chrome-app"))
                           || cmd == "chrome"
                           || cmd == "google-chrome") {
                    browser_specifier = chrome_command(app_mode, options);
                    if (browser_specifier == NULL)
                        error_if_single = "neither chrome or google-chrome command found";
                    else
                        break;
                } else if ((app_mode = (cmd == "edge-app"))
                           || cmd == "edge") {
                    browser_specifier = edge_browser_command(app_mode, options);
                    if (browser_specifier == NULL)
                        error_if_single = "edge browser not found";
                    else
                        break;
#if __APPLE__
                } else if (cmd == "safari") {
                    browser_specifier = "/usr/bin/open -a Safari '%U'";
                    break;
#endif
                }
                else {
                    std::string cmd_arg0(cmd.c_str(), argv0_end - start);
                    if (have_in_path(cmd_arg0.c_str())) {
                        // since we need browser_specifie after cmd exits scope
                        browser_specifier_string = cmd;
                        browser_specifier = browser_specifier_string.c_str();
                        break;
                    } else
                        error_if_single = "browser command '" + cmd_arg0 + "' not found";
                }
            }
            if (*semi == 0) {
                printf_error(options, "%s",
                             error_if_single.empty() || num_tries > 1
                             ? "no front-end command found"
                             : error_if_single.c_str());
                return EXIT_FAILURE;
            }
            p = semi+1;
        }
    }
    if (options->headless) {
        const char *hcmd = get_setting(options->settings, "command.headless");
        if (hcmd) {
            browser_specifier = hcmd;
        } else if ((hcmd = chrome_command(true, options)) != NULL) {
            // default to chrome for headless
            browser_specifier = hcmd;
        } else {
            printf_error(options, "unspecified browser for --headless");
            return EXIT_FAILURE;
        }
    }

    const char *do_pattern = do_electron ? "\"electron\":\""
        : do_Qt ? "\"qtwebengine\":\""
        : do_wry ? "\"wry\":\""
        : NULL;
    // If there is an existing Electron or Qt instance, we want to re-use it.
    // Otherwise, on Qt we get a multi-second delay on startup.
    // This is no longer needed on Electron, but is a slight optimization.
    // Other browsers seem to "combine" user commands better.
    if (do_pattern) {
        for (browser_cmd_client *cclient = browser_cmd_clients.first();
             cclient != nullptr; cclient = browser_cmd_clients.next(cclient)) {
            if (cclient->pattern == do_pattern && cclient->wsi != nullptr) {
                // Only Qt front-end (so far).
                cclient->send_buffer.printf("OPEN-WINDOW %s\n",
                                            browser_run_json_options(options, url, wnum).c_str());
                lws_callback_on_writable(cclient->wsi);
                return EXIT_SUCCESS;
            }
        }
        for (struct tty_client *t = main_windows.first(); t != nullptr;
             t = main_windows.next(t)) {
            if (t->version_info && strstr(t->version_info, do_pattern)) {
                browser_run_json_options(options, url, wnum);
                printf_to_browser(t,
                                  URGENT_START_STRING "\033]108;%s\007" URGENT_END_STRING,
                                  browser_run_json_options(options, url, wnum).c_str());
                lws_callback_on_writable(t->wsi);
                return EXIT_SUCCESS;
            }
        }
    }
    browser_cmd_client *cclient = ! start_only ? nullptr
        : browser_cmd_client::enter_new(wnum);
    if (do_Qt) {
        browser_specifier = qtwebengine_command(browser_specifier_string.c_str(), options, wnum, cclient->app_number);
    }

    // The initial URL passed to the browser is a file: URL to a user-read-only
    // file. This verifies that the browser is running as the current user.
    // It is just a stub file that redirects to a http URL with the real
    // resources.  The loading of JavaScript and CSS is deferred to
    // the redirected http file because CORS (Cross-Origin Resource Sharing)
    // restricts what we can do from file URLs.

    const char *hash_only =
        url && url[0] == '#' && tclient && tclient->connection_number >= 0
        ? url+1
        : nullptr;
    sbuf obuf, nbuf;
    if (hash_only) {
        nbuf.printf("%s-%d.html", main_html_prefix, tclient->connection_number);
        tclient->main_html_filename = nbuf.strdup();
        nbuf.reset();
        nbuf.printf("file://%s", tclient->main_html_filename);
        url = nbuf.null_terminated();
    }
    std::string cmd = subst_command(options, browser_specifier, url);
    browser_specifier = cmd.c_str();
    if (hash_only) {
        obuf.printf(
            "<!DOCTYPE html>\n"
            "<html><head>\n"
            "<meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>\n"
            "<meta http-equiv=\"Content-Security-Policy\""
            " content=\"script-src 'unsafe-inline'\">\n"
            "<!--command used to start front-end: %s-->\n"
            "<script type='text/javascript'>\n"
            "location.replace('http://localhost:%d/no-frames.html#server-key=%.*s&%s');\n"
            "</script>\n"
            "</head>\n"
            "<body></body></html>\n",
            browser_specifier, http_port, SERVER_KEY_LENGTH, server_key,
            hash_only);
        int hfile = open(tclient->main_html_filename, O_WRONLY|O_CREAT|O_TRUNC, S_IRWXU);
        if (hfile < 0
            || write(hfile, obuf.buffer, obuf.len) != (ssize_t) obuf.len
            || close(hfile) != 0)
            lwsl_err("writing %s failed\n", tclient->main_html_filename);

    }

    if (options->print_browser_only) {
        lwsl_notice("not starting (--print-browser-command) frontend command: %s\n", cmd.c_str());
        obuf.reset();
        obuf.printf("%s\n", browser_specifier);
        if (write(options->fd_out, obuf.buffer, obuf.len) <= 0)
            lwsl_err("write failed - do_run_browser\n");
        return 0;
    }
    lwsl_notice("starting frontend command: %s\n", cmd.c_str());
    int r;
    r = start_command(options, cmd.c_str(), cclient);
    if (cclient) {
        if (r < 0)
            return EXIT_FAILURE;
        cclient->pattern = do_pattern;
        if (! do_Qt) { // Electron or Wry front-ends
            lws_sock_file_fd_type fd;
            fd.filefd = cclient->fd;
            struct lws *cmd_lws =
                lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC, fd,
                                           "browser-output", NULL);
            lws_set_wsi_user(cmd_lws, cclient);
        }
        r = EXIT_SUCCESS;
    }
    options->qt_frontend = false;
    return r;
}

bool
in_tiling_window_manager()
{
    return is_SwayDesktop();
}

int
display_session(struct options *options, struct pty_client *pclient,
                const char *url, enum window_kind wkind)
{
    int session_number = pclient == NULL ? -1 : pclient->session_number;
    const char *browser_specifier = options->browser_command.c_str();
    lwsl_notice("display_session %d browser:%s\n", session_number, browser_specifier);
#if REMOTE_SSH
    if (browser_specifier != NULL
        && strcmp(browser_specifier, "--browser-pipe") == 0) {
        display_pipe_session(options, pclient);
        return EXIT_WAIT;
    }
#endif
    int paneOp = options->paneOp;
    bool has_name = ! options->name_option.empty();
    if (browser_specifier != NULL && browser_specifier[0] == '-') {
      if (pclient != NULL && strcmp(browser_specifier, "--detached") == 0) {
          pclient->detach_count = 1;
          if (has_name)
              pclient->session_name = options->name_option;
          options->browser_command = "";
          pclient->start_if_needed(options);
          return EXIT_SUCCESS;
      }
      if (paneOp < 1 || paneOp > 13)
          paneOp = 0;
    }
    std::string subwindows = get_setting_s(options->settings, "subwindows");
    if (subwindows.empty())
        subwindows = get_setting_s(main_options->settings, "subwindows");
    if (subwindows.empty()) {
        if (in_tiling_window_manager()) {
            subwindows = "no";
        } else if (browser_specifier[0] == 'q' && browser_specifier[1] == 't'
                   && strcmp(browser_specifier, "qt-frames") != 0) {
            subwindows = "qt";
        }
    } else if (subwindows == "none")
        subwindows = "no";

    struct tty_client *tclient = nullptr;
    int wnum = -1;
    struct tty_client *wclient = nullptr;
    bool top_marker = false;
    if (wkind != unknown_window) {
        tclient = new tty_client();
        wnum = session_number;
        if (wkind == main_only_window && paneOp > 0) {
            wnum = paneOp;
            paneOp = -1;
            options->paneOp = -1;
        } else if (paneOp > 0) {
            const char *eq = strchr(options->paneBase.c_str(), '=');
            if (eq) {
                std::string wopt = eq + 1;
                int w = check_single_window_option(wopt, "(display)", options);
                if (w < 0) {
                    printf_error(options, "invalid window specifier '%s' in '%s' option",
                                 wopt.c_str(),
                                 browser_specifier);
                    return EXIT_FAILURE;
                }
                size_t wlen = wopt.length();
                top_marker = wlen > 0 && wopt[0] == '^';
                wclient = tty_clients(w);
            } else if (focused_client == NULL) {
                printf_error(options, "no current window for '%s' option",
                             browser_specifier);
                return EXIT_FAILURE;
            } else
                wclient = focused_client;

            options->paneOp = -1;
            options->paneBase = "";
        }
    }
    if (paneOp > 0 && subwindows == "no") {
        if (is_SwayDesktop()) {
            char *swaymsg = find_in_path("swaymsg");
            if (swaymsg) {
                char buf[100];
                int wnum = wclient ? wclient->connection_number : -1;
                int blen = 0;
                if (wnum >= 0)
                    blen = snprintf(buf, sizeof(buf),
                                    "swaymsg '[title=\"DomTerm.*:%d\"]' focus;", wnum);
                if (paneOp == pane_left || paneOp == pane_right)
                    snprintf(buf+blen, sizeof(buf)-blen, "swaymsg split h");
                else if (paneOp == pane_above || paneOp == pane_below || paneOp == pane_best)
                    snprintf(buf+blen, sizeof(buf)-blen, "swaymsg split v");
                else if (paneOp == pane_tab)
                     snprintf(buf+blen, sizeof(buf)-blen, "swaymsg split h;swaymsg layout tabbed");
                else
                    buf[0] = 0;
                if (buf[0]) {
                    system(buf);
                }
            }
            free(swaymsg);
        }
        paneOp = 0;
    }

    if (wkind != unknown_window) {
        tclient->options = link_options(options);
        if (wkind != main_only_window)
            wnum = tclient->set_connection_number(wnum);
        if (paneOp <= 0) {
            wnum = main_windows.enter(tclient, wnum);
            tclient->connection_number = wnum;
        }
        tclient->wkind = wkind;
        if (wkind == browser_window || wkind == saved_window) {
            if (url)
                tclient->description = url;
        } else if (url == NULL && pclient) {
            tclient->link_pclient(pclient);
        }
        if (has_name) {
            tclient->set_window_name(options->name_option);
        } else if (pclient && ! pclient->session_name.empty()) {
            has_name = true;
            tclient->set_window_name(pclient->session_name);
        }
        wnum = tclient->connection_number;
    }
    options->name_option.clear();
    int r = EXIT_SUCCESS;

    if (paneOp > 0) {
        tclient->main_window =
            wclient->main_window || wclient->connection_number;
        json pane_options;
        if (wnum >= 0)
            pane_options["windowNumber"] = wnum;
        if (pclient && pclient->session_number >= 0)
            pane_options["sessionNumber"] = pclient->session_number;
        if (wkind == saved_window || wkind == browser_window) {
            pane_options["componentType"] =
                wkind == browser_window ? "browser" : "view-saved";
            pane_options["url"] = url;
        }
        if (has_name) {
            pane_options["windowName"] = tclient->window_name;
            pane_options["windowNameUnique"] =
                (bool) tclient->window_name_unique;
        }
        int oldnum = wclient->connection_number;
        if (wclient->main_window != 0) {
            wclient = main_windows(wclient->main_window);
            if (oldnum <= 0 || oldnum > 999999
                || wclient == nullptr || wclient->out_wsi == nullptr) {
                printf_error(options, "No existing window %d", oldnum);
                return EXIT_FAILURE;
            }
        }
        if (top_marker && paneOp >= pane_left && paneOp <= pane_below)
            paneOp = pane_main_left + (paneOp - pane_left);
        printf_to_browser(wclient, URGENT_WRAP("\033]%d;%d,%d,%s\007"),
                          104, paneOp, oldnum,
                          pane_options.dump().c_str());
        lws_callback_on_writable(wclient->out_wsi);
    } else if (wkind == browser_window && subwindows == "no") {
        r = do_run_browser(options, tclient, url, wnum);
    } else {
        char *encoded = wkind == browser_window || wkind == saved_window
            ? url_encode(url, 0)
            : NULL;
        if (encoded)
            url = encoded;
        sbuf sb;
        if (wnum >= 0) {
            sb.printf("#window=%d", wnum);
            if (pclient != NULL) {
                sb.printf("&session-number=%d", pclient->session_number);
            }
            if (options->headless)
                sb.printf("&headless=true");

            if (! subwindows.empty())
                sb.printf("&subwindows=%s", subwindows.c_str());

            std::string titlebar = get_setting_s(options->settings, "titlebar");
            if (! titlebar.empty())
                sb.printf("&titlebar=%s", url_encode(titlebar).c_str());
            double verbosity = get_setting_d(options->settings, "log.js-verbosity", -1);
            if (verbosity >= 0)
                sb.printf("&js-verbosity=%g", verbosity);
            double js_string_max = get_setting_d(options->settings, "log.js-string-max", -1);
            if (js_string_max >= 0)
                sb.printf("&log-string-max=%g", js_string_max);
            std::string slog_to_server = get_setting_s(options->settings, "log.js-to-server");
            const char *log_to_server = slog_to_server.empty() ? NULL
                : slog_to_server.c_str();
            if (log_to_server && (strcmp(log_to_server, "yes") == 0
                                  || strcmp(log_to_server, "true") == 0
                                  || strcmp(log_to_server, "both") == 0)) {
                sb.printf("&log-to-server=%s", log_to_server);
            }
            if (has_name) {
                sb.printf(tclient->window_name_unique ? "&wname-unique=%s"
                          : "&wname=%s",
                          url_encode(tclient->window_name).c_str());
            }
            if (wkind == saved_window)
                sb.printf("&view-saved=%s", url);
            else if (wkind == browser_window)
                sb.printf("&browse=%s", url);
            else if (wkind == main_only_window && url
                     && strncmp(url, "open=", 5) == 0)
                sb.printf("&%s", url);
        }
        else
            sb.printf("%s", url);
        if (encoded)
            free(encoded);
        r = do_run_browser(options, tclient, sb.null_terminated(), wnum);
    }
    return r;
}

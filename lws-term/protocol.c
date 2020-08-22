#include "server.h"
#include <limits.h>
#include <sys/stat.h>
#include <termios.h>
#include <utmp.h>

#if HAVE_LIBCLIPBOARD
#include <libclipboard.h>
clipboard_c* clipboard_manager = NULL;
#endif

#define BUF_SIZE 1024

#define USE_RXFLOW (LWS_LIBRARY_VERSION_NUMBER >= (2*1000000+4*1000))
#define UNCONFIRMED_LIMIT 8000

#if defined(TIOCPKT)
// See https://stackoverflow.com/questions/21641754/when-pty-pseudo-terminal-slave-fd-settings-are-changed-by-tcsetattr-how-ca
#define USE_PTY_PACKET_MODE 1
#endif

extern char **environ;

static char eof_message[] = URGENT_START_STRING "\033[99;99u" URGENT_END_STRING;
#define eof_len (sizeof(eof_message)-1)
static char request_contents_message[] =
    OUT_OF_BAND_START_STRING "\033[81u" URGENT_END_STRING;
#define URGENT_WRAP(STR)  URGENT_START_STRING STR URGENT_END_STRING

static char start_replay_mode[] = URGENT_WRAP("\033[97u");
static char end_replay_mode[] = URGENT_WRAP("\033[98u");

/* Invariant: if VALID_SESSION_NUMBER(snum) is false
   then pty_clients[snum] is either NULL or the next valid pty_client
   where snext == pty_clients[snum]->session_number and
   snext > snum && VALID_SESSION_NUMBER(snext). */
struct pty_client **pty_clients; // malloc'd array
int pty_clients_size; // size of pty_clients array
struct tty_client **tty_clients; // malloc'd array
int tty_clients_size;

int
send_initial_message(struct lws *wsi) {
#if 0
    unsigned char message[LWS_PRE + 256];
    unsigned char *p = &message[LWS_PRE];
    int n;

    char hostname[128];
    gethostname(hostname, sizeof(hostname) - 1);

    // window title
    n = sprintf((char *) p, "%c%s (%s)", SET_WINDOW_TITLE, server->command, hostname);
    if (lws_write(wsi, p, (size_t) n, LWS_WRITE_TEXT) < n) {
        return -1;
    }
    // reconnect time
    n = sprintf((char *) p, "%c%d", SET_RECONNECT, server->reconnect);
    if (lws_write(wsi, p, (size_t) n, LWS_WRITE_TEXT) < n) {
        return -1;
    }
#endif
    return 0;
}

#if 0
void logerr(char*prefix, char* str, int n) {
    fprintf(stderr, "write%s %d bytes: \"", prefix, n);
    for (int i = 0; i < n; i++) {
        int ch = str[i] & 0xFF;
        if (ch >= ' ' && ch < 127)
            fputc(ch, stderr);
        else
            fprintf(stderr, "\\%03o", ch);
    }
    fprintf(stderr, "\"\n", n);
}
#endif

#if 0
bool
check_host_origin(struct lws *wsi) {
    int origin_length = lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN);
    char buf[origin_length + 1];
    memset(buf, 0, sizeof(buf));
    int len = lws_hdr_copy(wsi, buf, sizeof(buf), WSI_TOKEN_ORIGIN);
    if (len > 0) {
        const char *prot, *address, *path;
        int port;
        if (lws_parse_uri(buf, &prot, &address, &port, &path))
            return false;
        sprintf(buf, "%s:%d", address, port);
        int host_length = lws_hdr_total_length(wsi, WSI_TOKEN_HOST);
        if (host_length != strlen(buf))
            return false;
        char host_buf[host_length + 1];
        memset(host_buf, 0, sizeof(host_buf));
        len = lws_hdr_copy(wsi, host_buf, sizeof(host_buf), WSI_TOKEN_HOST);
        return len > 0 && strcasecmp(buf, host_buf) == 0;
    }
    return false;
}
#endif

// Maybe remove unneeded preserved output
void trim_preserved(struct pty_client *pclient)
{
    if (pclient->preserve_mode == 2 && pclient->saved_window_contents == NULL)
        return;

    long read_count = pclient->preserved_sent_count - (pclient->preserved_end - pclient->preserved_start);
    long max_unconfirmed = 0;
    FOREACH_WSCLIENT(tclient, pclient) {
         long unconfirmed = (read_count - tclient->confirmed_count) & MASK28;
         if (unconfirmed > max_unconfirmed)
             max_unconfirmed = unconfirmed;
     };
     if (pclient->saved_window_contents) {
         long unconfirmed =
             (read_count - pclient->saved_window_sent_count) & MASK28;
         if (unconfirmed > max_unconfirmed)
             max_unconfirmed = unconfirmed;
     }

     long old_length = pclient->preserved_end - pclient->preserved_start;
     if (max_unconfirmed >= old_length)
         return;
     // Do nothing if max_unconfirmed/old_length < 2/3.
     if (3 * max_unconfirmed < 2 * old_length)
         return;
     // compress
     long unneeded = old_length - max_unconfirmed;
     memmove(pclient->preserved_output,
             pclient->preserved_output+unneeded,
             max_unconfirmed);
     pclient->preserved_start = 0;
     pclient->preserved_end = max_unconfirmed;
     pclient->preserved_sent_count = (pclient->preserved_sent_count + unneeded) & MASK28;
     if (pclient->preserved_size >= 2 * max_unconfirmed) {
         pclient->preserved_size = max_unconfirmed + 512;
         pclient->preserved_output = xrealloc(pclient->preserved_output, pclient->preserved_size);
     }
}

bool
should_backup_output(struct pty_client *pclient)
{
    return pclient->preserve_mode > 0;
}

void
maybe_exit(int exit_code)
{
    lwsl_notice("maybe_exit sess:%d cl:%d\n", server->session_count, server->client_count);
    if (server->session_count + server->client_count == 0) {
        force_exit = true;
        lws_cancel_service(context);
        exit(exit_code);
    }
}

int
pty_destroy(struct pty_client *pclient)
{
    lwsl_notice("exited application for session %d\n",
                pclient->session_number);
    int snum = pclient->session_number;
    if (VALID_SESSION_NUMBER(snum)) {
        struct pty_client *next = pty_clients[snum+1];
        for (; snum >= 0 && pty_clients[snum] == pclient; snum--)
            pty_clients[snum] = next;
    }
    // stop event loop
    pclient->exit = true;
    if (pclient->ttyname != NULL) {
        free(pclient->ttyname);
        pclient->ttyname = NULL;
    }
    if (pclient->saved_window_contents != NULL) {
        free(pclient->saved_window_contents);
        pclient->saved_window_contents = NULL;
    }
    if (pclient->preserved_output != NULL) {
        free(pclient->preserved_output);
        pclient->preserved_output = NULL;
    }
    if (pclient->cmd_settings) {
        json_object_put(pclient->cmd_settings);
        pclient->cmd_settings = NULL;
    }
    if (pclient->cur_pclient) {
        pclient->cur_pclient->cur_pclient = NULL;
        pclient->cur_pclient = NULL;
    }

    int status = -1;
    if (pclient->pid > 0) {
        // kill process and free resource
        lwsl_notice("sending signal %d to process %d\n",
                    server->options.sig_code, pclient->pid);
        if (kill(pclient->pid, server->options.sig_code) != 0) {
            lwsl_err("kill: pid: %d, errno: %d (%s)\n", pclient->pid, errno, strerror(errno));
        }
        int status;
        while (waitpid(pclient->pid, &status, 0) == -1 && errno == EINTR)
            ;
        lwsl_notice("process exited with code %d exitcode:%d, pid: %d\n", status, WEXITSTATUS(status), pclient->pid);
    }
    close(pclient->pty);
#ifndef LWS_TO_KILL_SYNC
#define LWS_TO_KILL_SYNC (-1)
#endif
    // FIXME free client; set pclient to NULL in all matching tty_clients.

    // remove from sessions list
    server->session_count--;
    maybe_exit(status != -1 && WIFEXITED(status) ? WEXITSTATUS(status) : 0);
    return status;
}

void
printf_to_browser(struct tty_client *tclient, const char *format, ...)
{
    va_list ap;
    va_start(ap, format);
    sbuf_vprintf(&tclient->ob, format, ap);
    va_end(ap);
}

// Unlink wsi from pclient's list of client_wsi-s.
static void
unlink_tty_from_pty_only(struct pty_client *pclient,
                    struct lws *wsi, struct tty_client *tclient) {
    lwsl_notice("unlink_tty_from_pty_only p:%p w:%p t:%p\n", pclient, wsi, tclient);
    for (struct tty_client **pt = &pclient->first_tclient; *pt != NULL; ) {
        struct tty_client **nt = &(*pt)->next_tclient;
        if (tclient == *pt) {
            if (*nt == NULL)
                pclient->last_tclient_ptr = pt;
            *pt = *nt;
            break;
        }
        pt = nt;
    }
}

static void
unlink_tty_from_pty(struct pty_client *pclient,
                    struct lws *wsi, struct tty_client *tclient) {
    unlink_tty_from_pty_only(pclient, wsi, tclient);
    // FIXME reclaim memory cleanup for tclient
    struct tty_client *first_tclient = pclient->first_tclient;
    if (first_tclient == NULL && pclient->detach_count == 0) {
        lws_set_timeout(pclient->pty_wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
    }
    // If only one client left, do detachSaveSend
    if (first_tclient != NULL) {
        if (first_tclient->next_tclient == NULL) {
            first_tclient->pty_window_number = -1;
            first_tclient->pty_window_update_needed = true;
            first_tclient->detachSaveSend = true;
        }
    }
}

void
tty_client_destroy(struct lws *wsi, struct tty_client *tclient) {
    // remove from clients list
    lwsl_notice("tty_client_destroy %p conn#%d\n", tclient, tclient->connection_number);
    sbuf_free(&tclient->inb);
    sbuf_free(&tclient->ob);
    if (tclient->version_info != NULL) {
        free(tclient->version_info);
        tclient->version_info = NULL;
    }

    struct pty_client *pclient = tclient->pclient;

    int snum = tclient->connection_number;
    if (VALID_CONNECTION_NUMBER(snum)) {
        struct tty_client *next = tty_clients[snum+1];
        for (; snum >= 0 && tty_clients[snum] == tclient; snum--)
            tty_clients[snum] = next;
    }
    tclient->connection_number = -1;
    free(tclient->ssh_connection_info);
    tclient->ssh_connection_info = NULL;
    if (pclient != NULL)
        unlink_tty_from_pty_only(pclient, wsi, tclient);
}

static void
setWindowSize(struct pty_client *client)
{
    struct winsize ws;
    ws.ws_row = client->nrows;
    ws.ws_col = client->ncols;
    ws.ws_xpixel = (int) client->pixw;
    ws.ws_ypixel = (int) client->pixh;
    if (ioctl(client->pty, TIOCSWINSZ, &ws) < 0)
        lwsl_err("ioctl TIOCSWINSZ: %d (%s)\n", errno, strerror(errno));
}

void link_command(struct lws *wsi, struct tty_client *tclient,
                  struct pty_client *pclient)
{
    tclient->pclient = pclient;
    struct tty_client *first_tclient = pclient->first_tclient;
    tclient->next_tclient = NULL;
    if (GET_REMOTE_HOSTUSER(pclient))
        tclient->proxyMode = proxy_display_local;

    if (first_tclient != NULL) {
        if (first_tclient->next_tclient == NULL)
            first_tclient->pty_window_number = 0;

        // Find the lowest unused pty_window_number.
        // This is O(n^2), but typically n==0.
        int n = -1;
    next_pty_window_number:
        n++;
        FOREACH_WSCLIENT(xclient, pclient) {
          if (xclient->pty_window_number == n)
              goto next_pty_window_number;
        }
        tclient->pty_window_number = n;

        // If following this link_command there are now two clients,
        // notify both clients they don't have to save on detatch
        if (first_tclient->next_tclient == NULL) {
            first_tclient->pty_window_update_needed = true;
            // these was exctly one other tclient
            tclient->detachSaveSend = true;
            lws_callback_on_writable(wsi);
            first_tclient->detachSaveSend = true;
            lws_callback_on_writable(first_tclient->out_wsi);
        }
    }
    lwsl_notice("link_command wsi:%p tclient:%p pclient:%p\n",
                wsi, tclient, pclient);
    tclient->pty_window_update_needed = true;
    *pclient->last_tclient_ptr = tclient;
    pclient->last_tclient_ptr = &tclient->next_tclient;
    if (tclient->proxyMode != proxy_command_local
        && tclient->proxyMode != proxy_display_local)
        focused_wsi = wsi;
    if (pclient->detach_count > 0)
        pclient->detach_count--;
    if (pclient->paused) {
#if USE_RXFLOW
        lwsl_info("session %d unpaused (flow control)\n",
                  pclient->session_number);
        lws_rx_flow_control(pclient->pty_wsi,
                            1|LWS_RXFLOW_REASON_FLAG_PROCESS_NOW);
#endif
        pclient->paused = 0;
    }
}

void put_to_env_array(char **arr, int max, char* eval)
{
    char *eq = index(eval, '=');
    int name_len = eq - eval;
    for (int i = 0; ; i++) {
        if (arr[i] == NULL) {
            if (i == max)
                abort();
            arr[i] = eval;
            arr[i+1] = NULL;
        }
        if (strncmp(arr[i], eval, name_len+1) == 0) {
            arr[i] = eval;
            break;
        }
    }
}

static struct pty_client *
create_pclient(const char *cmd, char*const*argv,
               const char*cwd, char *const*env,
               struct options *opts)
{
    struct lws *outwsi;
    int master;
    int slave;
    bool packet_mode = false;

    if (openpty(&master, &slave,NULL, NULL, NULL)) {
        lwsl_err("openpty\n");
        return NULL;
    }
    fcntl(master, F_SETFD, FD_CLOEXEC);
    fcntl(slave, F_SETFD, FD_CLOEXEC);
#if USE_PTY_PACKET_MODE
    if (! (opts->tty_packet_mode
           && strcmp(opts->tty_packet_mode, "no") == 0)) {
        int nonzero = 1;
        packet_mode = ioctl(master, TIOCPKT, &nonzero) == 0;
    }
#if EXTPROC
    if (packet_mode
        && (opts->tty_packet_mode == NULL
            || strcmp(opts->tty_packet_mode, "extproc") == 0)) {
        struct termios tio;
        tcgetattr(slave, &tio);
        tio.c_lflag |= EXTPROC;
        tcsetattr(slave, TCSANOW, &tio);
    }
#endif
#endif
    char *tname = strdup(ttyname(slave));

    lws_sock_file_fd_type fd;
    fd.filefd = master;
    //if (tclient == NULL)              return NULL;
    outwsi = lws_adopt_descriptor_vhost(vhost, 0, fd, "pty", NULL);
    struct pty_client *pclient = (struct pty_client *) lws_wsi_user(outwsi);
    pclient->ttyname = tname;
    pclient->packet_mode = packet_mode;
    server->session_count++;
    int snum = 1;
    for (; ; snum++) {
        if (snum >= pty_clients_size) {
            int newsize = 3 * pty_clients_size >> 1;
            if (newsize < 20)
                newsize = 20;
            pty_clients = realloc(pty_clients, newsize * sizeof(struct pty_client*));
            for (int i = pty_clients_size; i < newsize; i++)
                pty_clients[i] = NULL;
            pty_clients_size = newsize;
        }
        struct pty_client *next = pty_clients[snum];
        if (next == NULL || next->session_number > snum) {
            if (VALID_CONNECTION_NUMBER(snum))
                continue;
            // Maintain invariant
            for (int iprev = snum;
                 --iprev >= 0 && pty_clients[iprev] == next; ) {
                pty_clients[iprev] = pclient;
            }
            pty_clients[snum] = pclient;
            pclient->session_number = snum;
            break;
        }
    }
    pclient->pid = -1;
    pclient->pty = master;
    pclient->pty_slave = slave;
    pclient->nrows = -1;
    pclient->ncols = -1;
    pclient->pixh = -1;
    pclient->pixw = -1;
    pclient->eof_seen = 0;
    pclient->detach_count = 0;
    pclient->paused = 0;
    pclient->saved_window_contents = NULL;
    pclient->preserved_output = NULL;
    pclient->preserve_mode = 1;
    pclient->first_tclient = NULL;
    pclient->last_tclient_ptr = &pclient->first_tclient;
    pclient->recent_tclient = NULL;
    pclient->session_name_unique = false;
    pclient->pty_wsi = outwsi;
    pclient->cmd = cmd;
    pclient->argv = copy_strings(argv);
    if (opts->cmd_settings)
        pclient->cmd_settings = json_object_get(opts->cmd_settings);
    else
        pclient->cmd_settings = NULL;
    pclient->cwd = strdup(cwd);
    pclient->env = copy_strings(env);
#if __APPLE__
    pclient->awaiting_connection = false;
#endif
#if REMOTE_SSH
    pclient->cmd_socket = -1;
    pclient->cur_pclient = NULL;
#endif
    return pclient;
}

static struct pty_client *
create_link_pclient(struct lws *wsi, struct tty_client *tclient)
{
    char** argv = default_command(main_options);
    char *cmd = find_in_path(argv[0]);
    if (cmd == NULL)
        return NULL;
    struct pty_client *pclient = create_pclient(cmd, argv, ".", environ,
                                                main_options);
    link_command(wsi, (struct tty_client *) lws_wsi_user(wsi), pclient);
    return pclient;
}

// FIXME use pclient->cmd instead of cmd etc
static struct pty_client *
run_command(const char *cmd, char*const*argv, const char*cwd,
            char *const*env, struct pty_client *pclient)
{
    int master = pclient->pty;
    int slave = pclient->pty_slave;
    pid_t pid = fork();
    lwsl_notice("run_command %s after fork child:%d\n", cmd, pid);
    switch (pid) {
    case -1: /* error */
            lwsl_err("forkpty\n");
            close(master);
            close(slave);
            pty_destroy(pclient); // ???
            break;
    case 0: /* child */
            if (login_tty(slave))
                _exit(1);
            if (cwd == NULL || chdir(cwd) != 0) {
                const char *home = find_home();
                if (home == NULL || chdir(home) != 0)
                    if (chdir("/") != 0)
                        lwsl_err("chdir failed\n");
            }
            int env_size = 0;
            while (env[env_size] != NULL) env_size++;
            int env_max = env_size + 10;
            char **nenv = xmalloc((env_max + 1)*sizeof(const char*));
            memcpy(nenv, env, (env_size + 1)*sizeof(const char*));

            put_to_env_array(nenv, env_max, "TERM=xterm-256color");
#if !  WITH_XTERMJS
            put_to_env_array(nenv, env_max, "COLORTERM=truecolor");
            char* dinit = "DOMTERM=";
#ifdef LWS_LIBRARY_VERSION
#define SHOW_LWS_LIBRARY_VERSION "=" LWS_LIBRARY_VERSION
#else
#define SHOW_LWS_LIBRARY_VERSION ""
#endif
            const char *lstr = ";libwebsockets" SHOW_LWS_LIBRARY_VERSION;
            char* pinit = ";tty=";
            char* ttyName = ttyname(0);
            char pidbuf[40];
            pid = getpid();
            size_t dlen = strlen(dinit);
            size_t llen = strlen(lstr);
            size_t plen = strlen(pinit);
            int tlen = ttyName == NULL ? 0 : strlen(ttyName);
            char *version_info =
              /* FIXME   tclient != NULL ? tclient->version_info
                    :*/ "version=" LDOMTERM_VERSION;
            int vlen = version_info == NULL ? 0 : strlen(version_info);
            int mlen = dlen + vlen + llen + (tlen > 0 ? plen + tlen : 0);
            if (pid > 0) {
                sprintf(pidbuf, ";session#=%d;pid=%d",
                        pclient->session_number, pid);
                mlen += strlen(pidbuf);
            }
            char* ebuf = malloc(mlen+1);
            strcpy(ebuf, dinit);
            int offset = dlen;
            if (version_info)
                strcpy(ebuf+offset, version_info);
            offset += vlen;
            strcpy(ebuf+offset, lstr);
            offset += llen;
            if (tlen > 0) {
                strcpy(ebuf+offset, pinit);
                offset += plen;
                strcpy(ebuf+offset, ttyName);
                offset += tlen;
            }
            if (pid > 0) {
                strcpy(ebuf+offset, pidbuf);
                offset += strlen(pidbuf);
            }
            ebuf[mlen] = '\0';
            put_to_env_array(nenv, env_max, ebuf);
#endif
#if ENABLE_LD_PRELOAD
            int normal_user = getuid() == geteuid();
            char* domterm_home = get_bin_relative_path("");
            if (normal_user && domterm_home != NULL) {
#if __APPLE__
                char *fmt =  "DYLD_INSERT_LIBRARIES=%s/lib/domterm-preloads.dylib";
#else
                char *fmt =  "LD_PRELOAD=%s/lib/domterm-preloads.so libdl.so.2";
#endif
                char *buf = malloc(strlen(domterm_home)+strlen(fmt)-1);
                sprintf(buf, fmt, domterm_home);
                put_to_env_array(nenv, env_max, buf);
            }
#endif
            if (execve(cmd, argv, nenv) < 0) {
                perror("execvp");
                exit(1);
            }
            break;
        default: /* parent */
            lwsl_notice("starting application: %s session:%d pid:%d pty:%d\n",
                        pclient->cmd, pclient->session_number, pid, master);
            close(slave);

            pclient->pid = pid;
            if (pclient->nrows >= 0)
               setWindowSize(pclient);
            // lws_change_pollfd ??
            // FIXME do on end: tty_client_destroy(client);
            return pclient;
    }

    return NULL;
}

struct pty_client *
find_session(const char *specifier)
{
    struct pty_client *session = NULL;
    char *pend;
    pid_t pid = strtol(specifier, &pend, 10);
    if (*pend != '\0' || *specifier == '\0')
        pid = -1;

    FOREACH_PCLIENT(pclient) {
        int match = 0;
        if (pclient->pid == pid && pid != -1)
            return pclient;
        if (pclient->session_name != NULL
            && strcmp(specifier, pclient->session_name) == 0)
            match = 1;
        else if (specifier[0] == ':'
                 && strtol(specifier+1, NULL, 10) == pclient->session_number)
          match = 1;
        if (match) {
          if (session != NULL)
            return NULL; // ambiguous
          else
            session = pclient;
        }
    }
    return session;
}

static char localhost_localdomain[] = "localhost.localdomain";

char *
check_template(const char *template, json_object *obj)
{
    const char *filename = get_setting(obj, "filename");
    const char *position = get_setting(obj, "position");
    const char *href = get_setting(obj, "href");
    if (filename != NULL && filename[0] == '/' && filename[1] == '/') {
        if (filename[2] == '/')
            filename = filename + 2;
        else {
            char *colon = strchr(filename+2, '/');
            if (colon == NULL)
                return NULL;
            int fhlen = colon - (filename + 2);
            if (fhlen == sizeof(localhost_localdomain)-1
                && strncmp(filename+2, localhost_localdomain, fhlen) == 0)
                filename = filename + 2 + fhlen;
            else {
#ifndef HOST_NAME_MAX
#define HOST_NAME_MAX 128
#endif
                char hbuf[HOST_NAME_MAX+1];
                int r = gethostname(hbuf, sizeof(hbuf));
                if (r != 0)
                    return NULL;
                if (fhlen == strlen(hbuf)
                    && strncmp(filename+2, hbuf, fhlen) == 0)
                    filename = filename + 2 + fhlen;
                else
                    return NULL;
            }
        }
    }

    int size = 0;
    while (template[0] == '{') {
        // a disjunction of clauses, separated by '|'
        bool ok = false; // true when a previous clause was true
        const char *clause = &template[1];
        for (const char *p = clause; ; p++) {
            char ch = *p;
            if (ch == '\0')
              return NULL;
            if (ch == '|' || ch == '}') {
                if (! ok) {
                    bool negate = *clause=='!';
                    if (negate)
                      clause++;
                    int clen = p - clause;
                    if (clen > 1 && p[-1] == ':') {
                        ok = strncmp(clause, href, clen) == 0;
                    } else if (clause[0] == '.') {
                        const char *h = href;
                        const char *dot = NULL;
                        for (;*h && *h != '#' && *h != '?'; h++)
                          if (*h == '.')
                            dot = h;
                        ok = dot && clen == h - dot
                          && memcmp(dot, clause, clen) == 0;
                    } else if (clen == 7
                               && memcmp(clause, "in-atom", clen) == 0) {
                        struct json_object *jatom = NULL;
                        ok = json_object_object_get_ex(obj, "isAtom", &jatom)
                          && json_object_get_boolean(jatom);
                    } else if (clen == 13
                               && memcmp(clause, "with-position", clen) == 0) {
                        ok = position != NULL;
                    }
                    if (negate)
                        ok = ! ok;
                }
                clause = p + 1;
            }
            if (ch == '}') {
              if (! ok)
                return NULL;
              template = clause;
              break;
            }
        }
    }
    if (strcmp(template, "atom") == 0)
        template = "atom '%F'%:P";
    else if (strcmp(template, "emacs") == 0)
        template = "emacs %+P '%F' > /dev/null 2>&1 ";
    else if (strcmp(template, "emacsclient") == 0)
        template = "emacsclient -n %+P '%F'";
    else if (strcmp(template, "firefox") == 0
             || strcmp(template, "chrome") == 0
             || strcmp(template, "google-chrome") == 0) {
        const char *chr = strcmp(template, "firefox") == 0
          ? firefox_browser_command(main_options)
            : chrome_command(false, main_options);
        if (chr == NULL)
            return NULL;
        char *buf = xmalloc(strlen(chr) + strlen(href)+4);
        sprintf(buf, "%s '%s'", chr, href);
        return buf;
    }
    int i;
    for (i = 0; template[i]; i++) {
        char ch = template[i];
        if (ch == '%' && template[i+1]) {
            char next = template[++i];
            char prefix = 0;
            if ((next == ':' || next == '+') && template[i+1]) {
                prefix = next;
                next = template[++i];
            }
            const char *field;
            if (next == 'F') field = filename;
            else if (next == 'U') field = href;
            else if (next == 'P') field = position;
            else field = "%";
            if (field != NULL)
              size += strlen(field) + (prefix ? 1 : 0);
            else if (! prefix)
                return NULL;
        } else
          size++;
    }
    char *buffer = xmalloc(size+1);
    i = 0;
    char *p = buffer;
    for (i = 0; template[i]; i++) {
        char ch = template[i];
        if (ch == '%' && template[i+1]) {
            char next = template[++i];
            char prefix = 0;
            if ((next == ':' || next == '+') && template[i+1]) {
                prefix = next;
                next = template[++i];
            }
            char t2[2];
            const char *field;
            if (next == 'F') field = filename;
            else if (next == 'U') field = href;
            else if (next == 'P') field = position;
            else {
                t2[0] = ch;
                t2[1] = 0;
                field = t2;
            }
            if (field != NULL) {
                if (prefix)
                    *p++ = prefix;
                strcpy(p, field);
                p += strlen(field);
            }
        } else {
            if (ch == ' ') {
                *p = 0;
                if (strchr(buffer, ' ') == NULL) {
                    char* ex = find_in_path(buffer);
                    free(ex == NULL ? buffer : ex);
                    if (ex == NULL)
                        return NULL;
                }
            }
            *p++ = ch;
        }
    }
    *p = 0;
    return buffer;
}

bool
handle_tlink(const char *template, json_object *obj)
{
    char *t = strdup(template);
    char *p = t;
    char *command = NULL;
    for (;;) {
        const char *start = NULL;
        char *semi = (char*)
            extract_command_from_list(p, &start, NULL, NULL);
        if (*semi)
            *semi = 0;
        else
            semi = NULL;
        command = check_template(start, obj);
        if (command != NULL)
           break;
        if (semi)
            p = semi+1;
        else
            break;
    }
    free(t);
    if (command == NULL)
        return false;
    if (strcmp(command, "browser")==0||strcmp(command, "default")==0) {
        struct json_object *jhref;
        free(command);
        if (json_object_object_get_ex(obj, "href", &jhref)) {
            default_link_command(json_object_get_string(jhref));
            return true;
        }
    }
    lwsl_notice("open linked application %s\n", command);
    bool r = start_command(main_options, command) == EXIT_SUCCESS;
    free(command);
    return r;
}

void
handle_link(json_object *obj)
{
    if (json_object_object_get_ex(obj, "filename", NULL)) {
        const char *template = get_setting(main_options->settings, "open.file.application");
        if (template == NULL)
            template =
              "{in-atom}{with-position|!.html}atom;"
              "{with-position|!.html}emacsclient;"
              "{with-position|!.html}emacs;"
              "{with-position|!.html}atom";
        if (handle_tlink(template, obj))
            return;
    }
    const char *template = get_setting(main_options->settings, "open.link.application");
    if (template == NULL)
        template = "{!mailto:}browser;{!mailto:}chrome;{!mailto:}firefox";
    handle_tlink(template, obj);
}

/** Handle an "event" encoded in the stream from the browser.
 * Return true if handled.  Return false if proxyMode==proxy_local
 * and the event should be sent to the remote end.
 */

bool
reportEvent(const char *name, char *data, size_t dlen,
            struct lws *wsi, struct tty_client *client,
            enum proxy_mode proxyMode)
{
    struct pty_client *pclient = client->pclient;
    if (pclient)
        lwsl_info("reportEvent :%d %s '%s' mode:%d\n",
                  pclient->session_number, name, data, proxyMode);
    else
        lwsl_info("reportEvent %s '%s' mode:%d\n", name, data, proxyMode);
    if (strcmp(name, "WS") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        if (pclient != NULL
            && sscanf(data, "%d %d %g %g", &pclient->nrows, &pclient->ncols,
                      &pclient->pixh, &pclient->pixw) == 4) {
          if (pclient->pty >= 0)
            setWindowSize(pclient);
        }
    } else if (strcmp(name, "VERSION") == 0) {
        char *version_info = xmalloc(dlen+1);
        strcpy(version_info, data);
        client->version_info = version_info;
        if (proxyMode == proxy_display_local)
            return false;
        client->initialized = 0;
        if (pclient == NULL)
            pclient = create_link_pclient(wsi, client);
        if (pclient == NULL)
            return true;
        if (pclient->cmd) {
            run_command(pclient->cmd, pclient->argv, pclient->cwd, pclient->env, pclient);
            free((void*)pclient->cmd); pclient->cmd = NULL;
            free((void*)pclient->argv); pclient->argv = NULL;
            free((void*)pclient->cwd); pclient->cwd = NULL;
            free((void*)pclient->env); pclient->env = NULL;
        }
        if (pclient->saved_window_contents != NULL)
            lws_callback_on_writable(wsi);
    } else if (strcmp(name, "RECEIVED") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        long count;
        sscanf(data, "%ld", &count);
        client->confirmed_count = count;
        if (((client->sent_count - client->confirmed_count) & MASK28) < 1000
            && pclient != NULL && pclient->paused) {
#if USE_RXFLOW
            lwsl_info("session %d unpaused (flow control) (sent:%ld confirmed:%ld)\n",
                      pclient->session_number,
                      client->sent_count, client->confirmed_count);
            lws_rx_flow_control(pclient->pty_wsi,
                                1|LWS_RXFLOW_REASON_FLAG_PROCESS_NOW);
#endif
            pclient->paused = 0;
        }
        trim_preserved(pclient);
    } else if (strcmp(name, "KEY") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        char *q1 = strchr(data, '\t');
        char *q2;
        if (q1 == NULL || (q2 = strchr(q1+1, '\t')) == NULL)
            return true; // ERROR
        struct termios termios;
        int pty = pclient->pty;
        if (pclient->cur_pclient && pclient->cur_pclient->cmd_socket >= 0)
            pty = pclient->cur_pclient->pty;
        if (tcgetattr(pty, &termios) < 0)
          ; //return -1;
        bool isCanon = (termios.c_lflag & ICANON) != 0;
        bool isEchoing = (termios.c_lflag & ECHO) != 0;
        json_object *obj = json_tokener_parse(q2+1);
        const char *kstr = json_object_get_string(obj);
        int klen = json_object_get_string_len(obj);
        int kstr0 = klen != 1 ? -1 : kstr[0];
        if (isCanon && kstr0 != 3 && kstr0 != 4 && kstr0 != 26) {
            printf_to_browser(client, URGENT_WRAP("\033]%d;%.*s\007"),
                              isEchoing ? 74 : 73, (int) dlen, data);
            lws_callback_on_writable(wsi);
        } else {
          int to_drain = 0;
          if (pclient->paused) {
            struct termios term;
            // If we see INTR, we want to drain already-buffered data.
            // But we don't want to drain data that written after the INTR.
            if (tcgetattr(pclient->pty, &term) == 0
                && term.c_cc[VINTR] == kstr0
                && ioctl (pclient->pty, FIONREAD, &to_drain) != 0)
              to_drain = 0;
          }
        lwsl_notice("report KEY pty:%d canon:%d echo:%d klen:%d\n",
                    pclient->pty, isCanon, isEchoing, klen);
          if (write(pclient->pty, kstr, klen) < klen)
             lwsl_err("write INPUT to pty\n");
          while (to_drain > 0) {
            char buf[500];
            ssize_t r = read(pclient->pty, buf,
                             to_drain <= sizeof(buf) ? to_drain : sizeof(buf));
            if (r <= 0)
              break;
            to_drain -= r;
          }
        }
        json_object_put(obj);
    } else if (strcmp(name, "SESSION-NAME") == 0) {
        char *q = strchr(data, '"');
        json_object *obj = json_tokener_parse(q);
        const char *kstr = json_object_get_string(obj);
        int klen = json_object_get_string_len(obj);
        char *session_name = xmalloc(klen+1);
        strcpy(session_name, kstr);
        if (pclient->session_name)
            free(pclient->session_name);
        pclient->session_name = session_name;
        pclient->session_name_unique = true;
        json_object_put(obj);
        FOREACH_PCLIENT(p) {
            if (p != pclient && p->session_name != NULL
                && strcmp(session_name, p->session_name) == 0) {
                struct pty_client *pp = p;
                p->session_name_unique = false;
                for (;;) {
                    FOREACH_WSCLIENT(t, pp) {
                        t->pty_window_update_needed = true;
                        lws_callback_on_writable(t->out_wsi);
                    }
                    if (! pclient->session_name_unique || pp == pclient)
                        break;
                    pp = pclient;
                }
                pclient->session_name_unique = false;
            }
        }
    } else if (strcmp(name, "OPEN-WINDOW") == 0) {
        static char gopt[] =  "geometry=";
        char *g = strstr(data, gopt);
        char *geom = NULL;
        if (g != NULL) {
            g += sizeof(gopt)-1;
            char *gend = strstr(g, "&");
            if (gend == NULL)
                gend = g + strlen(g);
            int glen = gend-g;
            geom = xmalloc(glen+1);
            memcpy(geom, g, glen);
            geom[glen] = 0;
        }
        struct options opts;
        init_options(&opts);
        //opts.geometry = geom;
        set_setting(&opts.cmd_settings, "geometry", geom);
        do_run_browser(&opts, data, -1);
        if (geom != NULL)
            free(geom);
    } else if (strcmp(name, "DETACH") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        bool val = strcmp(data,"0")!=0;
        if (pclient != NULL) {
            if (pclient->detach_count >= 0)
                pclient->detach_count++;
            if (pclient->preserved_output == NULL
                && client->requesting_contents == 0)
                client->requesting_contents = 1;
        }
    } else if (strcmp(name, "CLOSE-SESSION") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        if (pclient != NULL) {
            unlink_tty_from_pty(pclient, wsi, client);
            client->pclient = NULL;
        }
    } else if (strcmp(name, "FOCUSED") == 0) {
        focused_wsi = wsi;
    } else if (strcmp(name, "LINK") == 0) {
        json_object *obj = json_tokener_parse(data);
        handle_link(obj);
        json_object_put(obj);
    } else if (strcmp(name, "REQUEST-CLIPBOARD-TEXT") == 0) {
#if HAVE_LIBCLIPBOARD
        if (clipboard_manager == NULL) {
            clipboard_manager = clipboard_new(NULL);
        }
        char *clipText;
        if (clipboard_manager
            && (clipText = clipboard_text(clipboard_manager)) != NULL) {
            struct json_object *jobj = json_object_new_string(clipText);
            printf_to_browser(client, URGENT_WRAP("\033]231;%s\007"),
                              json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN));
            free(clipText);
            json_object_put(jobj);
            lws_callback_on_writable(wsi);
        }
#endif
    } else if (strcmp(name, "WINDOW-CONTENTS") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        char *q = strchr(data, ',');
        long rcount;
        sscanf(data, "%ld", &rcount);
        int updated = (rcount - pclient->saved_window_sent_count) & MASK28;
        // Roughly: if (rcount < pclient->saved_window_sent_count)
        if ((updated & ((MASK28+1)>>1)) != 0) {
            return true;
        }
        if (pclient->saved_window_contents != NULL)
            free(pclient->saved_window_contents);
        pclient->saved_window_contents = strdup(q+1);
        client->requesting_contents = 0;
        pclient->saved_window_sent_count = rcount;
        trim_preserved(pclient);
    } else if (strcmp(name, "ECHO-URGENT") == 0) {
        json_object *obj = json_tokener_parse(data);
        const char *kstr = json_object_get_string(obj);
        FOREACH_WSCLIENT(t, pclient) {
            printf_to_browser(t, URGENT_WRAP("%s"), kstr);
            lws_callback_on_writable(t->out_wsi);
        }
        json_object_put(obj);
    } else {
    }
    return true;
}

void init_tclient_struct(struct tty_client *client, struct lws *wsi)
{
    client->initialized = 0;
    client->detachSaveSend = false;
    client->uploadSettingsNeeded = true;
    client->requesting_contents = 0;
    client->wsi = wsi;
    client->out_wsi = wsi;
    client->version_info = NULL;
    client->main_window = -1;
    client->pclient = NULL;
    client->sent_count = 0;
    client->confirmed_count = 0;
    sbuf_init(&client->ob);
    sbuf_init(&client->inb);
    sbuf_extend(&client->ob, 2048);
    client->ocount = 0;
    client->proxyMode = no_proxy; // FIXME
    client->connection_number = -1;
    client->pty_window_number = -1;
    client->pty_window_update_needed = false;
    client->ssh_connection_info = NULL;
    client->pending_browser_command = NULL;
    lwsl_notice("init_tclient_struct conn#%d\n",  client->connection_number);
}

static void
set_connection_number(struct tty_client *tclient, struct pty_client *hint)
{
    int snum = 1;
    if (hint != NULL && ! VALID_CONNECTION_NUMBER(hint->session_number))
        snum = hint->session_number;
    for (; ; snum++) {
        if (snum >= tty_clients_size) {
            int newsize = 3 * tty_clients_size >> 1;
            if (newsize < 20)
                newsize = 20;
            tty_clients = realloc(tty_clients, newsize * sizeof(struct tty_client*));
            for (int i = tty_clients_size; i < newsize; i++)
                tty_clients[i] = NULL;
            tty_clients_size = newsize;
        }
        struct tty_client *next = tty_clients[snum];
        if (next == NULL || next->connection_number > snum) {
            if ((hint == NULL || snum != hint->session_number)
                && VALID_SESSION_NUMBER(snum))
                continue;
            // Maintain invariant
            for (int iprev = snum;
                 --iprev >= 0 && tty_clients[iprev] == next; ) {
                tty_clients[iprev] = tclient;
            }
            tty_clients[snum] = tclient;
            tclient->connection_number = snum;
            break;
        }
    }
    lwsl_notice("set_connection_number %p to %d\n", tclient, tclient->connection_number);
}

/** Copy input (keyboard and events) from browser to pty/application.
 * The proxyMode specifies if the input is proxied through ssh.
 */

static int
handle_input(struct lws *wsi, struct tty_client *client,
             enum proxy_mode proxyMode)
{
    if (server->options.readonly)
        return 0;
    size_t clen = client->inb.len;
    unsigned char *msg = client->inb.buffer;
    struct pty_client *pclient = client->pclient;
    if (pclient)
        pclient->recent_tclient = client;
    // FIXME handle PENDING
    int start = 0;
    lwsl_notice("handle_input len:%zu conn#%d pmode:%d pty:%d\n", clen, client->connection_number, proxyMode, pclient==NULL? -99 : pclient->pty);
    for (int i = 0; ; i++) {
        if (i+1 == clen && msg[i] >= 128)
            break;
        if (i == clen || msg[i] == REPORT_EVENT_PREFIX) {
            int w = i - start;
            if (w > 0)
                lwsl_notice(" -handle_input write start:%d w:%d\n", start, w);
            if (w > 0 && pclient && write(pclient->pty, msg+start, w) < w) {
                lwsl_err("write INPUT to pty\n");
                return -1;
            }
            if (i == clen) {
                start = clen;
                break;
            }
            unsigned char* eol = memchr(msg+i, '\n', clen-i);
            if (eol) {
                unsigned char *p = msg+i;
                char* cname = (char*) ++p;
                while (p < eol && *p != ' ')
                    p++;
                unsigned char *name_end = p;
                unsigned char save_name_end = *p;
                *p = '\0';
                if (p < eol)
                    p++;
                while (p < eol && *p == ' ')
                    p++;
                // data is from p to eol
                char *data = (char*) p;
                unsigned char save_data_end = *eol;
                *eol = '\0';
                size_t dlen = eol - p;
                i = eol - msg;
                if (! reportEvent(cname, data, dlen, wsi, client,
                                  proxyMode)) {
                    // don't change start index, so event can be copied
                    *name_end = save_name_end;
                    *eol = save_data_end;
                    continue;
                }
            } else {
                break;
            }
            start = i+1;
        }
    }
    if (start < clen) {
        memmove(client->inb.buffer, client->inb.buffer+start, clen-start);
        client->inb.len = clen - start;
    }
    else if (client->inb.size > 2048)
        sbuf_free(&client->inb);
    else
        client->inb.len = 0;
    return 0;
}

static void
handle_output(struct tty_client *client, struct sbuf *bufp, enum proxy_mode proxyMode)
{
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;
    lwsl_notice("handle_output conn#%d initialized:%d pmode:%d len0:%zu->%zu\n", client->connection_number, client->initialized, proxyMode, client->ob.len, bufp->len);
    bool nonProxy = proxyMode != proxy_command_local && proxyMode != proxy_display_local;
    if (client->uploadSettingsNeeded) { // proxyMode != proxy_local ???
        client->uploadSettingsNeeded = false;
        if (settings_as_json != NULL) {
            sbuf_printf(bufp, URGENT_WRAP("\033]89;%s\007"),
                        settings_as_json);
        }
    }
    if (client->initialized == 0 && proxyMode != proxy_command_local) {
        if (pclient->cmd_settings) {
            //json_object_put(pclient->cmd_settings);
            sbuf_printf(bufp, URGENT_WRAP("\033]88;%s\007"),
                        json_object_to_json_string_ext(pclient->cmd_settings, JSON_C_TO_STRING_PLAIN));
        } else {
            sbuf_printf(bufp, URGENT_WRAP("\033]88;{}\007"));
        }
#define FORMAT_PID_SNUMBER "\033]31;%d\007"
#define FORMAT_SNAME "\033]30;%s\007"
        sbuf_printf(bufp,
                    pclient->session_name
                    ? URGENT_WRAP(FORMAT_PID_SNUMBER FORMAT_SNAME)
                    : URGENT_WRAP(FORMAT_PID_SNUMBER),
                    pclient->pid,
                    pclient->session_name);
        if (pclient->saved_window_contents != NULL) {
            int rcount = pclient->saved_window_sent_count;
            sbuf_printf(bufp,
                        URGENT_WRAP("\033]103;%ld,%s\007"),
                        (long) rcount,
                        (char *) pclient->saved_window_contents);
            client->sent_count = rcount;
            if (pclient->preserve_mode < 2) {
                free(pclient->saved_window_contents);
                pclient->saved_window_contents = NULL;
            }
        }
    }
    if (client->initialized < 2 && proxyMode != proxy_command_local
        && pclient->preserved_output != NULL) {
        size_t pstart = pclient->preserved_start;
        size_t pend = pclient->preserved_end;
        long read_count = pclient->preserved_sent_count - (pend - pstart);
        long rcount = client->sent_count;
        long unconfirmed = (read_count - rcount) & MASK28;
        if (unconfirmed > 0 && pend - pstart >= unconfirmed) {
            pstart = pend - unconfirmed;
            sbuf_append(bufp, start_replay_mode, -1);
            sbuf_append(bufp, pclient->preserved_output+pstart,
                        (int) unconfirmed);
            sbuf_append(bufp, end_replay_mode, -1);
            rcount += unconfirmed;
        }
        rcount = rcount & MASK28;
        client->sent_count = rcount;
        client->confirmed_count = rcount;
        sbuf_printf(bufp,
                    OUT_OF_BAND_START_STRING "\033[96;%ld"
                    URGENT_END_STRING,
                    rcount);
    }
    if (client->pty_window_update_needed && nonProxy) {
        client->pty_window_update_needed = false;
        sbuf_printf(bufp, URGENT_WRAP("\033[91;%d;%d;%d;%du"),
                    pclient->session_number,
                    pclient->session_name_unique,
                    client->pty_window_number+1,
                    client->connection_number);
    }
    if (client->detachSaveSend) { // proxyMode != proxy_local ???
        int tcount = 0;
        FOREACH_WSCLIENT(tclient, pclient) {
            if (++tcount >= 2) break;
        }
        int code = tcount >= 2 ? 0 : pclient->detach_count != 0 ? 2 : 1;
        sbuf_printf(bufp, URGENT_WRAP("\033[82;%du"), code);
        client->detachSaveSend = false;
    }
    if (client->ob.len > 0) {
        //  // proxyMode != proxy_local ??? for count?
        client->sent_count = (client->sent_count + client->ocount) & MASK28;
        sbuf_append(bufp, client->ob.buffer, client->ob.len);
        client->ocount = 0;
        if (client->ob.size > 4000) {
            sbuf_free(&client->ob);
            sbuf_extend(&client->ob, 2048);
        }
        client->ob.len = 0;
    }
    if (client->requesting_contents == 1) { // proxyMode != proxy_local ???
        sbuf_printf(bufp, "%s", request_contents_message);
        client->requesting_contents = 2;
        if (pclient->preserved_output == NULL) {
            pclient->preserved_start = PRESERVE_MIN;
            pclient->preserved_end = pclient->preserved_start;
            pclient->preserved_size = 1024;
            pclient->preserved_output =
                xmalloc(pclient->preserved_size);
        }
        pclient->preserved_sent_count = client->sent_count;
    }
    if (! pclient && client->ob.buffer != NULL
        && proxyMode != proxy_command_local) {
        sbuf_printf(bufp, "%s", eof_message);
        sbuf_free(&client->ob);
    }
    client->initialized = 2;
}

#if REMOTE_SSH
void // FXIME REMOVE?
close_local_proxy(struct pty_client *pclient, int exit_code)
{
#if PASS_STDFILES_UNIX_SOCKET
    lwsl_notice("close_local_proxy sess:%d sock:%d\n", pclient->session_number, pclient->cmd_socket);
#else
    lwsl_notice("close_local_proxy sess:%d sock:%d\n", pclient->session_number,  pclient->cmd_socket);
#endif
    if (pclient->cmd_socket >= 0) {
        char r = exit_code;
        if (write(pclient->cmd_socket, &r, 1) != 1)
            lwsl_err("write %d failed - callback_cmd %s\n", pclient->cmd_socket, strerror(errno));
        close(pclient->cmd_socket);
        pclient->cmd_socket = -1;
    }
}

int
callback_proxy(struct lws *wsi, enum lws_callback_reasons reason,
               void *user, void *in, size_t len)
{
    struct tty_client *tclient = (struct tty_client *) user;
    struct pty_client *pclient = tclient == NULL ? NULL : tclient->pclient;
    struct sbuf buf;
    ssize_t n;
    if (tclient==NULL)
        lwsl_notice("callback_proxy wsi:%p reason:%d - no client\n", wsi, reason);
    else
        lwsl_notice("callback_proxy wsi:%p reason:%d fd:%d conn#%d\n", wsi, reason, tclient==NULL? -99 : tclient->proxy_fd_in, tclient->connection_number);
    switch (reason) {
    case LWS_CALLBACK_RAW_CLOSE_FILE:
        lwsl_notice("proxy RAW_CLOSE_FILE\n");
        if (tclient->wsi == wsi)
            tty_client_destroy(wsi, tclient);
        return 0;
    case LWS_CALLBACK_RAW_RX_FILE: ;
        if (tclient->proxy_fd_in < 0) {
            lwsl_notice("proxy RAW_RX_FILE - no fd cleanup\n");
            // cleanup? FIXME
            return 0;
        }
        // read data, send to
        sbuf_extend(&tclient->inb, 1024);
        n = read(tclient->proxy_fd_in,
                         tclient->inb.buffer + tclient->inb.len,
                         tclient->inb.size - tclient->inb.len);
        lwsl_notice("proxy RAW_RX_FILE n:%ld avail:%zu-%zu\n",
                    (long) n, tclient->inb.size, tclient->inb.len);
        if (n > 0)
            tclient->inb.len += n;
        return handle_input(wsi, tclient, tclient->proxyMode);
    case LWS_CALLBACK_RAW_WRITEABLE_FILE:
        if (tclient->proxy_fd_out < 0) {
            lwsl_notice("proxy RAW_WRITEABLE_FILE - no fd cleanup\n");
#if 0
            // cleanup? FIXME
            if (tclient->pclient)
                close_local_proxy(tclient->pclient, 0);
#endif
            return -1;
        }
        if (tclient->proxyMode == proxy_command_local) {
            unsigned char *fd = memchr(tclient->ob.buffer, 0xFD, tclient->ob.len);
            lwsl_notice("check for FD: %p browser:%s text:%.*s\n", fd, tclient->pending_browser_command, (int) tclient->ob.len, tclient->ob.buffer);
            if (fd && tclient->pclient) {
                tclient->ob.len = 0; // FIXME - simplified
                struct options opts;
                struct termios termios;
                if (pclient && tcgetattr(pclient->pty, &termios) == 0) {
                    termios.c_lflag &= ~(ICANON|ECHO);
                    termios.c_oflag &= ~ONLCR;
                    tcsetattr(pclient->pty, TCSANOW, &termios);
                }
                tty_restore(-1);
                init_options(&opts);
                opts.browser_command = tclient->pending_browser_command;
                display_session(&opts, tclient->pclient, NULL, http_port);
                free(tclient->pending_browser_command);
                tclient->pending_browser_command = NULL;
                if (tclient->out_wsi && tclient->out_wsi != tclient->wsi) {
                    lwsl_notice("set_timeout clear tc:%p\n", tclient->wsi);
                    lws_set_timeout(tclient->wsi,
                                    PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
                }
                tclient->out_wsi = NULL;
                maybe_daemonize();
                ////tty_client_destroy(wsi, tclient);
                //unlink_tty_from_pty_only(tclient->pclient, wsi, tclient);
#if PASS_STDFILES_UNIX_SOCKET
                close_local_proxy(pclient, 0);
#endif
                tclient->proxy_fd_in = -1;
                tclient->proxy_fd_out = -1;
                //tty_client_destroy(pin_lws, lws_wsi_user(pout_lws)); //FIXME
                // daemonize - FIXME
                return -1;
            }
        }
        sbuf_init(&buf);
        handle_output(tclient, &buf, tclient->proxyMode);
        if (tclient->pclient == NULL) {
            lwsl_notice("proxy WRITABLE/close blen:%zu\n", buf.len);
        }
        // data in tclient->ob.
        n = write(tclient->proxy_fd_out, buf.buffer, buf.len);
        lwsl_notice("proxy RAW_WRITEABLE len:%zu written:%zu\n", buf.len, n );
        sbuf_free(&buf);
        return tclient->pclient == NULL ? -1 : 0; // FIXME
    default:
        return 0;
    }
}
#endif

// callback for WebSockets connection
int
callback_tty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len)
{
    struct tty_client *client = (struct tty_client *) user;
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;
    lwsl_notice("callback_tty %p reason:%d conn#%d\n", wsi, (int) reason,
                client == NULL ? -1 : client->connection_number);

    switch (reason) {
    case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION:
        lwsl_notice("callback_tty FILTER_PROTOCOL_CONNECTION\n");
        if (server->options.once && server->client_count > 0) {
            lwsl_notice("refuse to serve new client due to the --once option.\n");
            return -1;
        }
        break;

    case LWS_CALLBACK_ESTABLISHED:
        init_tclient_struct(client, wsi);
        lwsl_notice("tty/CALLBACK_ESTABLISHED conn#%d\n", client->connection_number);
        char arg[100]; // FIXME
        if (! check_server_key(wsi, arg, sizeof(arg) - 1))
            return -1;
        const char*main_window = lws_get_urlarg_by_name(wsi, "main-window=", arg, sizeof(arg) - 1);
        client->main_window = -1;
        if (main_window != NULL) {
            if (strcmp(main_window, "true") == 0)
                client->main_window = 0;
            long num = strtol(main_window, NULL, 10);
            if (num > 0)
                client->main_window = (int) num;
        }
        const char*argval = lws_get_urlarg_by_name(wsi, "no-session=", arg, sizeof(arg) - 1);
        if (argval != NULL) {
            lwsl_info("dummy connection (no session) established\n");
        } else {
            argval = lws_get_urlarg_by_name(wsi, "session-number=", arg, sizeof(arg) - 1);
            long snumber = argval == NULL ? 0 : strtol(argval, NULL, 10);
            struct pty_client *pclient = NULL;
            if (VALID_SESSION_NUMBER(snumber))
                pclient = pty_clients[snumber];
            else {
#if __APPLE__
                FOREACH_PCLIENT(P) {
                    if (p->awaiting_connection) {
                        pclient = p;
                        p->awaiting_connection = false;
                        break;
                    }
                }
#endif
            }
            if (pclient != NULL) {
                link_command(wsi, client, pclient);
                lwsl_info("connection to existing session %ld established\n", snumber);
            } else if (snumber > 0) {
                lwsl_notice("connection to non-existing session %ld - error\n", snumber);
            } else {
                pclient = create_link_pclient(wsi, client);
                lwsl_info("connection to new session %d established\n", pclient->session_number);
            }
            set_connection_number(client, pclient);

            argval = lws_get_urlarg_by_name(wsi, "reconnect=", arg, sizeof(arg) - 1);
            if (argval != NULL) {
                snumber = strtol(argval, NULL, 10);
                client->confirmed_count = snumber;
                client->sent_count = snumber; // FIXME
                client->initialized = 1;
                lws_callback_on_writable(wsi);
            }
        }
        server->client_count++;
        // Defer start_pty so we can set up DOMTERM variable with version_info.

        if (main_options->verbosity > 0 || main_options->debug_level > 0) {
            char hostname[100];
            char address[50];
            lws_get_peer_addresses(wsi, lws_get_socket_fd(wsi),
                                   hostname, sizeof(hostname),
                                   address, sizeof(address));

            lwsl_notice("client connected from %s (%s), #: %d total: %d\n", hostname, address, client->connection_number, server->client_count);
        }
        break;

    case LWS_CALLBACK_SERVER_WRITEABLE:
        //fprintf(stderr, "callback_tty CALLBACK_SERVER_WRITEABLE init:%d connect:%d\n", (int) client->initialized, client->connection_number);
        ;
        struct sbuf buf;
        sbuf_init(&buf);
        sbuf_blank(&buf, LWS_PRE);
        handle_output(client, &buf, client->proxyMode);
        // end handle_output
        int written = buf.len - LWS_PRE;
        lwsl_notice("tty SERVER_WRITEABLE conn#%d written:%d to %p\n", client->connection_number, written, wsi);
        if (written > 0
            && lws_write(wsi, buf.buffer+LWS_PRE, written, LWS_WRITE_BINARY) != written)
            lwsl_err("lws_write\n");
        sbuf_free(&buf);
        break;

    case LWS_CALLBACK_RECEIVE:
         // receive data from websockets client (browser)
         //fprintf(stderr, "callback_tty CALLBACK_RECEIVE len:%d\n", (int) len);
        sbuf_extend(&client->inb, len < 1024 ? 1024 : len + 1);
        sbuf_append(&client->inb, in, len);
        //((unsigned char*)client->inb.buffer)[client->inb.len] = '\0'; // ??
        // check if there are more fragmented messages
        if (lws_remaining_packet_payload(wsi) <= 0
            && lws_is_final_fragment(wsi)) {
            handle_input(wsi, client, client->proxyMode);
        }
        break;

    case LWS_CALLBACK_CLOSED:
         if (focused_wsi == wsi)
              focused_wsi = NULL;
         tty_client_destroy(wsi, client);
         lwsl_notice("client #:%d disconnected, total: %d\n", client->connection_number, server->client_count);
         server->client_count--;
         maybe_exit(0);
         break;

    case LWS_CALLBACK_PROTOCOL_INIT: /* per vhost */
    case LWS_CALLBACK_PROTOCOL_DESTROY: /* per vhost */
    default:
         //fprintf(stderr, "callback_tty default reason:%d\n", (int) reason);
         break;
    }

    return 0;
}

#if REMOTE_SSH
/** Adopt 1 or 2 file descriptors used to copy to/from an ssh process.
 * This is logically a single bi-directional byte stream,
 * but may be a single socket (WebSockets or Unix domain),
 * or a pair of file descriptors (corresponding to stdin/stdout).
 */
void
make_proxy(struct options *options, struct pty_client *pclient, enum proxy_mode proxyMode)
{
    lws_sock_file_fd_type fd;
    fd.filefd = options->fd_in;
    struct lws *pin_lws = lws_adopt_descriptor_vhost(vhost, 0, fd,
                                                     "proxy", NULL);
    struct tty_client *tclient =
        ((struct tty_client *) lws_wsi_user(pin_lws));
    init_tclient_struct(tclient, pin_lws);
    set_connection_number(tclient, pclient);
    tclient->proxy_fd_in = options->fd_in;
    tclient->proxy_fd_out = options->fd_out;
    lwsl_notice("make_proxy in:%d out:%d mode:%d in-conn#%d pin-wsi:%p in-tname:%s\n", options->fd_in, options->fd_out, proxyMode, tclient->connection_number, pin_lws, ttyname(options->fd_in));
    tclient->proxyMode = proxyMode;
    tclient->pclient = pclient;
    const char *ssh_connection;
    if (proxyMode == proxy_remote
        && (ssh_connection = getenv_from_array("SSH_CONNECTION", options->env)) != NULL) {
        tclient->ssh_connection_info = strdup(ssh_connection);
    }

    struct lws *pout_lws;
    if (options->fd_out == options->fd_in) {
        pout_lws = pin_lws;
    } else {
        fd.filefd = options->fd_out;
        // maybe set last 'parent' argument ???
        pout_lws = lws_adopt_descriptor_vhost(vhost, 0, fd, "proxy-out", NULL);
        lws_set_wsi_user(pout_lws, tclient);
        tclient->out_wsi = pout_lws;
        lwsl_notice("- make_proxy out-conn#%d wsi:%p\n", tclient->connection_number, pout_lws);
    }
    if (pclient)
        link_command(pout_lws, tclient, pclient);
    tclient->proxyMode = proxyMode; // do after link_command
    if (proxyMode == proxy_command_local) {
        lwsl_notice("proxy-local browser:%s\n", options->browser_command);
        tclient->pending_browser_command
            = options->browser_command ? strdup(options->browser_command)
            : NULL;
    }
}
#endif

int
display_session(struct options *options, struct pty_client *pclient,
                const char *url, int port)
{
    int session_number = pclient == NULL ? -1 : pclient->session_number;
    const char *browser_specifier = options->browser_command;
    lwsl_notice("display_session %d browser:%s\n", session_number, browser_specifier);
#if REMOTE_SSH
    if (browser_specifier != NULL
        && strcmp(browser_specifier, "--browser-pipe") == 0) {
        // We're the server (remote) side of an ssh connection.
        // Request that the local (client) side open a window.
        // Create a proxy to connect between that window and our pty process,
        // over the ssh connection.
        make_proxy(options, pclient, proxy_remote);
        lwsl_notice("should write open-window message\n");
        char *s =  "\xFDREMOTE-WINDOW \n";
        int sl = strlen(s);
        int nn;
        if ((nn = write(options->fd_out, s, sl)) != sl)
            lwsl_notice("bad write n:%d err:%s\n", (int)nn, strerror(errno));
        //printf_to_browser(client, URGENT_WRAP("open-wrindow"));
        //lws_callback_on_writable(wsi);
        //daemonize client
        return EXIT_WAIT;
    }
#endif
    int paneOp = 0;
    if (browser_specifier != NULL && browser_specifier[0] == '-') {
      if (pclient != NULL && strcmp(browser_specifier, "--detached") == 0) {
          pclient->detach_count = 1;
          return EXIT_SUCCESS;
      }
      if (strcmp(browser_specifier, "--pane") == 0)
          paneOp = 1;
      else if (strcmp(browser_specifier, "--tab") == 0)
          paneOp = 2;
      else if (strcmp(browser_specifier, "--left") == 0)
          paneOp = 10;
      else if (strcmp(browser_specifier, "--right") == 0)
          paneOp = 11;
      else if (strcmp(browser_specifier, "--above") == 0)
          paneOp = 12;
      else if (strcmp(browser_specifier, "--below") == 0)
          paneOp = 13;
    }
    if (paneOp > 0 && focused_wsi == NULL) {
        browser_specifier = NULL;
        paneOp = 0;
    }
    int r = EXIT_SUCCESS;
    if (paneOp > 0) {
        struct tty_client *tclient = (struct tty_client *) lws_wsi_user(focused_wsi);
        if (pclient != NULL)
             printf_to_browser(tclient, URGENT_WRAP("\033[90;%d;%du"),
                               paneOp, session_number);
        else
            printf_to_browser(tclient, URGENT_WRAP("\033]%d;%d,%s\007"),
                               -port, paneOp, url);
        lws_callback_on_writable(focused_wsi);
    } else {
        char *encoded = port == -104 || port == -105
            ? url_encode(url, 0)
            : NULL;
        if (encoded)
            url = encoded;
        char *buf = xmalloc(strlen(main_html_url) + (url == NULL ? 60 : strlen(url) + 60));
        if (pclient != NULL) {
            sprintf(buf, "%s#session-number=%d", main_html_url, pclient->session_number);
#if __APPLE__
            // Needed when using /usr/bin/open as it drops #hash parts
            // of file: URLS.
            pclient->awaiting_connection = true;
#endif
        } else if (port == -105) // view saved file
            sprintf(buf, "%s#view-saved=%s",  main_html_url, url);
        else if (port == -104) // browse url
            sprintf(buf, "%s#browse=%s",  main_html_url, url);
        else
            sprintf(buf, "%s", url);
        if (encoded)
            free(encoded);
        if (browser_specifier
            && strcmp(browser_specifier, "--print-url") == 0) {
            int ulen = strlen(buf);
            buf[ulen] = '\n';
            if (write(options->fd_out, buf, ulen+1) <= 0)
                lwsl_err("write failed - display_session\n");
        } else
            r = do_run_browser(options, buf, port);
        free(buf);
    }
    return r;
}

int new_action(int argc, char** argv,
               struct lws *wsi, struct options *opts)
{
    int skip = argc == 0 || index(argv[0], '/') != NULL ? 0 : 1;
    if (skip == 1) {
        optind = 1;
        if (process_options(argc, argv, opts) < 0)
          return EXIT_FAILURE;
        skip = optind;
    }
    char**args = argc == skip ? default_command(opts)
      : (char**)(argv+skip);
    char *argv0 = args[0];
    char *cmd = find_in_path(argv0);
    struct stat sbuf;
    if (cmd == NULL || access(cmd, X_OK) != 0
        || stat(cmd, &sbuf) != 0 || (sbuf.st_mode & S_IFMT) != S_IFREG) {
        printf_error(opts, "cannot execute '%s'", argv0);
        return EXIT_FAILURE;
    }
    struct pty_client *pclient = create_pclient(cmd, args, opts->cwd, opts->env,
                                                opts);
    int r = display_session(opts, pclient, NULL, http_port);
    if (opts->session_name) {
        pclient->session_name = strdup(opts->session_name);
        opts->session_name = NULL;
    }
    return r;
}

int attach_action(int argc, char** argv, struct lws *wsi, struct options *opts)
{
    optind = 1;
    process_options(argc, argv, opts);
    if (optind >= argc) {
        printf_error(opts, "domterm attach: missing session specifier");
        return EXIT_FAILURE;
    }
    char *session_specifier = argv[optind];
    struct pty_client *pclient = find_session(session_specifier);
    if (pclient == NULL) {
        printf_error(opts, "no session '%s' found", session_specifier);
        return EXIT_FAILURE;
    }

    // If there is an existing tty_client, request contents from browser,
    // if not already doing do.
    struct tty_client *requesting = NULL;
    FOREACH_WSCLIENT(tclient, pclient) {
        if (tclient->requesting_contents > 0) {
            requesting = tclient;
            break;
        }
    }
    if (requesting == NULL && (requesting = pclient->first_tclient) != NULL) {
        requesting->requesting_contents = 1;
        lws_callback_on_writable(requesting->out_wsi);
    }

    return display_session(opts, pclient, NULL, http_port);
}

int browse_action(int argc, char** argv, struct lws *wsi, struct options *opts)
{
    optind = 1;
    process_options(argc, argv, opts);
    if (optind != argc-1) {
        FILE *err = fdopen(opts->fd_out, "w");
        fprintf(err, optind >= argc ? "domterm browse: missing url\n"
                : "domterm browse: more than one url\n");
        fclose(err);
        return EXIT_FAILURE;
    }
    char *url = argv[optind];
    display_session(opts, NULL, url, -104);
    return EXIT_SUCCESS;
}

void
request_upload_settings()
{
    struct tty_client *tclient;
    FORALL_WSCLIENT(tclient) {
        tclient->uploadSettingsNeeded = true;
        lws_callback_on_writable(tclient->wsi);
    }
}

#if REMOTE_SSH
static bool
word_matches(const char *p1, const char *p2)
{
    if (p1 == p2)
        return true;
    if (! p1 || ! p2)
        return false;
    for (;;) {
        char c1 = *p1++;
        char c2 = *p2++;
        bool end1 = c1 == '\0' || c1 == ';';
        bool end2 = c2 == '\0' || c2 == ';';
        if (end1 && end2)
            return true;
        if (end1 || end2 || c1 != c2)
            return false;
    }
}

void
handle_remote(int argc, char** argv, char* at,
              struct options *opts)
{
    // Running 'domterm --BROWSER user@host COMMAND' translates
    // to 'ssh USER@HOSTNAME domterm --browser-pipe COMMAND`
    // The --browser-pipe is a pseudo "browser specification":
    // create a pty running COMMAND such that output from the COMMAND
    // is printed to the stdout, and input read from stdin,
    // with perhaps some extra complication for events.
    // Locally, we create a tclient in --BROWSER, but instead
    // of the pclient/pty we do the following.

    char** ssh_args;
    char* _ssh_args[2];
    int ssh_argc;
    const char *ssh_cmd = get_setting(opts->settings, "command.ssh");
    if (ssh_cmd) {
        ssh_args = parse_args(ssh_cmd, false);
        ssh_argc = count_args(ssh_args);
    } else {
        ssh_args = _ssh_args;
        ssh_args[0] = "ssh";
        ssh_args[1] = NULL;
        ssh_argc = 1;
    }
    char *ssh = ssh_args == 0 ? NULL : find_in_path(ssh_args[0]);
    if (ssh == NULL) {
        printf_error(opts, "domterm: ssh command not found - required for remote");
        return;
    }
    char** domterm_args;
    char* _domterm_args[2];
    int domterm_argc;
    const char *domterm_cmd = get_setting(opts->settings, "command.remote-domterm");
    if (domterm_cmd) {
        domterm_args = parse_args(domterm_cmd, false);
        domterm_argc = count_args(domterm_args);
    } else {
        domterm_args = _domterm_args;
        domterm_args[0] = "domterm";
        domterm_args[1] = NULL;
        domterm_argc = 1;
    }

    int max_rargc = argc+ssh_argc+domterm_argc+8;
        char** rargv = xmalloc(sizeof(char*)*(max_rargc+1));
        int rargc = 0;
        for (int i = 0; i < ssh_argc; i++)
            rargv[rargc++] = ssh_args[i];
        // argv[0] is @host or user@host. Pass host or user@host to ssh
        char *host_arg = argv[0];
        rargv[rargc++] = at==host_arg ? at+1 : host_arg;
        for (int i = 0; i < domterm_argc; i++)
            rargv[rargc++] = domterm_args[i];
        rargv[rargc++] = "--browser-pipe";
        for (int i = 1; i < argc; i++)
            rargv[rargc++] = argv[i];
        if (rargc > max_rargc)
            fatal("too many arguments");
        rargv[rargc] = NULL;
#if 1
        const char *dt = getenv_from_array("DOMTERM", opts->env);
        char *tn;
        struct pty_client *cur_pclient = NULL;
        if (dt && (tn = strstr(dt, ";tty=")) != NULL) {
            tn += 5;
            // char *semi = strchr(tn, ';');
            lwsl_notice("remote tty:%s\n", tn);
            FOREACH_PCLIENT(p) {
                if (word_matches(p->ttyname, tn)) {
                    lwsl_notice("- matches pty #%d pty:%d\n", p->session_number, p->pty);
                    cur_pclient = p;
                    break;
                }
            }
        }
        //char *tn = strstr(
        int tin = STDIN_FILENO;
        if (isatty(tin)) {
            tty_save_set_raw(tin);
        }
        struct pty_client *pclient = create_pclient(ssh, rargv,
                                                    opts->cwd, opts->env,
                                                    opts);
#if 1
        if (cur_pclient) {
            cur_pclient->cur_pclient = pclient;
            pclient->cur_pclient = cur_pclient;
        }
#endif
        char tbuf[20];
        sprintf(tbuf, "%d", pclient->session_number);
        set_setting(&pclient->cmd_settings, LOCAL_SESSIONNUMBER_KEY, tbuf);
        set_setting(&pclient->cmd_settings, REMOTE_HOSTUSER_KEY, host_arg);
        lwsl_notice("handle_remote pcl:%p\n", pclient);
        make_proxy(opts, pclient, proxy_command_local);
        run_command(pclient->cmd, pclient->argv, pclient->cwd, pclient->env, pclient);
        // FIXME free fields - see reportEvent
        //int r = EXIT_WAIT; // FIXME
        pclient->cmd_socket = opts->fd_cmd_socket;
#else
            lwsl_notice("before fork ssh:%s in/out/err:%d/%d/%d\n",
                        ssh, opts->fd_in, opts->fd_out, opts->fd_err);
            pid_t pid = fork();
            lwsl_notice("after fork ssh pid:%d\n", pid);
            if (pid == 0) {
                for (int i = 0; rargv[i] != NULL; i++) {
                    lwsl_notice("- arg[%d]='%s'\n", i, rargv[i]);
                }
                /*
                for (int i = 0; environ[i] != NULL; i++) {
                    lwsl_notice("- env[%d]='%s'\n", i, environ[i]);
                }
                */
                if (opts->fd_in != 0) {
                    dup2(opts->fd_in, 0); close(opts->fd_in);
                }
                if (opts->fd_out != 1) {
                    dup2(opts->fd_out, 1); close(opts->fd_out);
                }
                if (opts->fd_err != 2) {
                    dup2(opts->fd_err, 2); close(opts->fd_err);
                }
                lwsl_notice("- after dup2 ttyname(0)=%s is(1)=%d\n", ttyname(0), isatty(1));
                execve(ssh, rargv, environ);
                exit(-1);
            } else if (pid > 0) {// master
                //free(args);
            } else {
                printf_error(opts, "could not fork front-end command");
                // return EXIT_FAILURE;
            }
        }
#endif
        free(rargv);
        //free(user);
}
#endif

int
handle_command(int argc, char** argv, struct lws *wsi, struct options *opts)
{
    lwsl_notice("handle_command argv0:%s\n", argv[0]);
    struct command *command = argc == 0 ? NULL : find_command(argv[0]);
    const char *domterm_env_value = getenv_from_array("DOMTERM", opts->env);
    if (domterm_env_value) {
        static char pid_key[] = ";pid=";
        int current_session_pid = 0;
        char *p = strstr(domterm_env_value, pid_key);
        if (p)
            sscanf(p+(sizeof(pid_key)-1), "%d", &current_session_pid);
        if (current_session_pid) {
            FOREACH_PCLIENT(pclient) {
                if (pclient->pid == current_session_pid) {
                    opts->requesting_session = pclient;
                    break;
                }
            }
        }
    }
    if (command != NULL) {
        lwsl_notice("handle command '%s'\n", command->name);
        return (*command->action)(argc, argv, wsi, opts);
    }
    char *at;
    if (argc == 0 || index(argv[0], '/') != NULL) {
        return new_action(argc, argv, wsi, opts);
#if REMOTE_SSH
    } else if ((at = index(argv[0], '@')) != NULL) {
        handle_remote(argc, argv, at, opts);
        return EXIT_WAIT;
#endif
    } else {
        // normally caught earlier
        printf_error(opts, "domterm: unknown command '%s'", argv[0]);
        return EXIT_FAILURE;
    }
    return 0;
}

int
callback_pty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct pty_client *pclient = (struct pty_client *) user;
    switch (reason) {
        case LWS_CALLBACK_RAW_RX_FILE: {
            lwsl_notice("callback_pty LWS_CALLBACK_RAW_RX_FILE wsi:%p len:%zu\n",
                        wsi, len);
            long min_unconfirmed = LONG_MAX;
            int avail = INT_MAX;
            int tclients_seen = 0;
            long last_sent_count = -1, last_confirmed_count = -1;
            FOREACH_WSCLIENT(tclient, pclient) {
                tclients_seen++;
                last_sent_count = tclient->sent_count;
                last_confirmed_count = tclient->confirmed_count;
                long unconfirmed =
                  ((last_sent_count - last_confirmed_count) & MASK28)
                  + tclient->ocount;
                if (unconfirmed < min_unconfirmed)
                  min_unconfirmed = unconfirmed;
                int tavail = tclient->ob.size - tclient->ob.len;
                if (tavail < 1000) {
                    sbuf_extend(&tclient->ob, 1000);
                    tavail = tclient->ob.size - tclient->ob.len;
                }
                if (tavail < avail)
                    avail = tavail;
            }
            if ((min_unconfirmed >= UNCONFIRMED_LIMIT || avail == 0
                 || pclient->paused)
                && ! GET_REMOTE_HOSTUSER(pclient)) {
                if (! pclient->paused) {
#if USE_RXFLOW
                    lwsl_info(tclients_seen == 1
                              ? "session %d paused (flow control) %ld bytes ahead sent:%ld confirmed:%ld\n"
                              : "session %d paused (flow control) %ld bytes ahead\n",
                              pclient->session_number, min_unconfirmed,
                              last_sent_count,
                              last_confirmed_count);
                    lws_rx_flow_control(wsi, 0|LWS_RXFLOW_REASON_FLAG_PROCESS_NOW);
#endif
                    pclient->paused = 1;
                }
                break;
            }
            if (avail >= eof_len) {
                char *data_start = NULL;
                int data_length = 0, read_length = 0;
                FOREACH_WSCLIENT(tclient, pclient) {
                    if (data_start == NULL) {
                        data_start = tclient->ob.buffer+tclient->ob.len;
                        ssize_t n;
                        if (pclient->packet_mode) {
#if USE_PTY_PACKET_MODE
                            // We know data_start > obuffer_raw, so
                            // it's safe to access data_start[-1].
                            char save_byte = data_start[-1];
                            n = read(pclient->pty, data_start-1, avail+1);
                            lwsl_notice("RAW_RX pty %d session %d read %ld tclient#%d a\n",
                                        pclient->pty, pclient->session_number, (long) n, tclient->connection_number);
                            char pcmd = data_start[-1];
                            data_start[-1] = save_byte;
#if TIOCPKT_IOCTL
                            if (n == 1 && (pcmd & TIOCPKT_IOCTL) != 0) {
                                struct termios tio;
                                tcgetattr(pclient->pty, &tio);
                                const char* icanon_str = (tio.c_lflag & ICANON) != 0 ? "icanon" :  "-icanon";
                                const char* echo_str = (tio.c_lflag & ECHO) != 0 ? "echo" :  "-echo";
                                const char* extproc_str = "";
#if EXTPROC
                                if ((tio.c_lflag & EXTPROC) != 0)
                                    extproc_str = " extproc";
#endif
                                n = sprintf(data_start,
                                            URGENT_WRAP("\033]71; %s %s%s lflag:%lx\007"),
                                            icanon_str, echo_str,
                                            extproc_str,
                                            (unsigned long) tio.c_lflag);
                                data_length = n;
                            }
                            else
#endif
                                read_length = n > 0 ? n - 1 : n;
#endif
                        } else {
                            n = read(pclient->pty, data_start, avail);
                            lwsl_notice("RAW_RX pty %d session %d read %ld tclient#%d b\n",
                                        pclient->pty, pclient->session_number,
                                        (long) n, tclient->connection_number);
                            read_length = n;
                        }
                        data_length += read_length;
                    } else {
                        memcpy(tclient->ob.buffer+tclient->ob.len,
                               data_start, data_length);
                    }
                    tclient->ob.len += data_length;
                    tclient->ocount += read_length;
                    lws_callback_on_writable(tclient->out_wsi);
                }
                if (should_backup_output(pclient)) {
                    if (pclient->preserved_output == NULL) {
                        pclient->preserved_start = PRESERVE_MIN;
                        pclient->preserved_end = 0;
                        pclient->preserved_size = 0;
                    }
                    size_t needed = pclient->preserved_end + data_length;
                    if (needed > pclient->preserved_size) {
                          size_t nsize = (3 * pclient->preserved_size) >> 1;
                          if (nsize < 1024)
                              nsize = 1024;
                          if (needed > nsize)
                               nsize = needed;
                          char * nbuffer = xrealloc(pclient->preserved_output, nsize);
                          pclient->preserved_output = nbuffer;
                          pclient->preserved_size = nsize;
                     }
                     memcpy(pclient->preserved_output + pclient->preserved_end,
                            data_start, data_length);
                     pclient->preserved_end += data_length;
                }
            }
        }
        break;
        case LWS_CALLBACK_RAW_CLOSE_FILE: {
            lwsl_notice("callback_pty LWS_CALLBACK_RAW_CLOSE_FILE cmd_sock:%d\n", pclient->cmd_socket);
            pclient->eof_seen = 1;
            int status = pty_destroy(pclient);
            FOREACH_WSCLIENT(tclient, pclient) {
                lwsl_notice("- pty close conn#%d proxy_fd:%d\n", tclient->connection_number, tclient->proxy_fd_in);
                if (tclient->proxy_fd_in >= 0) {
#if PASS_STDFILES_UNIX_SOCKET
//                    printf_to_browser(tclient, "%c",
//                                      WEXITSTATUS(status));
#else
                    printf_to_browser(tclient, "%c%c",
                                      PASS_STDFILES_EXIT_CODE,
                                      WEXITSTATUS(status));
#endif
                }
                // FIXME tclient->exit_status = WEXITSTATUS(status);
                lws_callback_on_writable(tclient->out_wsi);
                tclient->pclient = NULL;
            }
#if REMOTE_SSH && PASS_STDFILES_UNIX_SOCKET
            close_local_proxy(pclient, WEXITSTATUS(status));
#endif
            //return -1;
        }
        break;
    default:
        lwsl_notice("callback_pty default reason:%d\n", (int) reason);
            break;
    }

    return 0;
}

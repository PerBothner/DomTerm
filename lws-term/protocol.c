#include "server.h"
#include <limits.h>
#include <sys/stat.h>
#include <termios.h>
#include <utmp.h>
#include <time.h>

#if HAVE_LIBCLIPBOARD
#include <libclipboard.h>
clipboard_c* clipboard_manager = NULL;
#endif

#define BUF_SIZE 1024

#define USE_RXFLOW (LWS_LIBRARY_VERSION_NUMBER >= (2*1000000+4*1000))
// Maximum number of unconfirmed bytes before pausing
// Must be at least as much as "flow-confirm-every" setting.
#define MAX_UNCONFIRMED 8000
// Maximum number of unconfirmed bytes to continue after pausing
// Must be at least as much as "flow-confirm-every" setting.
#define MAX_CONTINUE 4000

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

static struct pty_client *
handle_remote(int argc, arglist_t argv, struct options *opts, struct tty_client *tclient);

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
    lwsl_notice("maybe_exit %d sess:%d cl:%d\n", exit_code, server->session_count, server->client_count);
    if (server->session_count + server->client_count == 0) {
        force_exit = true;
        lws_cancel_service(context);
        exit(exit_code);
    }
}

static void
pclient_close(struct pty_client *pclient, bool xxtimed_out)
{
    int snum = pclient->session_number;
    bool timed_out = (pclient->pflags & timed_out_flag) != 0;
    lwsl_notice("exited application for session %d\n", snum);
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
    if (pclient->cur_pclient) {
        pclient->cur_pclient->cur_pclient = NULL;
        pclient->cur_pclient = NULL;
    }
    free((void*)pclient->argv);

    int status = -1;
    if (pclient->pid > 0) {
        // kill process and free resource
        lwsl_notice("sending signal %d to process %d\n",
                    server->options.sig_code, pclient->pid);
        if (kill(pclient->pid, server->options.sig_code) != 0) {
            lwsl_err("kill: pid: %d, errno: %d (%s)\n", pclient->pid, errno, strerror(errno));
        }
        while (waitpid(pclient->pid, &status, 0) == -1 && errno == EINTR)
            ;
        lwsl_notice("process exited with code %d exitcode:%d, pid: %d\n", status, WEXITSTATUS(status), pclient->pid);
    }
    close(pclient->pty);

#ifndef LWS_TO_KILL_SYNC
#define LWS_TO_KILL_SYNC (-1)
#endif
    // FIXME free client; set pclient to NULL in all matching tty_clients.
    bool connection_failure = false;

    FOREACH_WSCLIENT(tclient, pclient) {
        lwsl_notice("- pty close %d conn#%d proxy_fd:%d mode:%d\n", status, tclient->connection_number, tclient->proxy_fd_in, tclient->proxyMode);
        tclient->pclient = NULL;
        if ((pclient->pflags & ssh_pclient_flag) != 0) {
            if ((tclient->misc_flags & tclient_proxy_flag) == 0) {
                printf_to_browser(tclient,
                                  timed_out
                                  ? URGENT_WRAP("\033[99;97u")
                                  : (status != -1 && WIFEXITED(status)
                                     && WEXITSTATUS(status) == 0xFF)
                                  ? URGENT_WRAP("\033[99;98u")
                                  : eof_message);
                connection_failure = true;
            } else {
#if !PASS_STDFILES_UNIX_SOCKET
                printf_to_browser(tclient, "%c%c",
                                  PASS_STDFILES_EXIT_CODE,
                                  WEXITSTATUS(status));
#endif
            }
        }
        lws_callback_on_writable(tclient->out_wsi);
    }

    if (WEXITSTATUS(status) == 0xFF && connection_failure) {
        lwsl_notice("DISCONNECTED\n");
    }
    if (VALID_SESSION_NUMBER(snum)) {
        struct pty_client *next = pty_clients[snum+1];
        for (; snum >= 0 && pty_clients[snum] == pclient; snum--)
            pty_clients[snum] = next;
    }

// remove from sessions list
    server->session_count--;
    lwsl_notice("before maybe_exit status:%d exited:%d statis:%d\n",
                status, WIFEXITED(status), WEXITSTATUS(status));
    maybe_exit(status == -1 || ! WIFEXITED(status) ? 0
               : WEXITSTATUS(status) == 0xFF ? 0xFE : WEXITSTATUS(status));
#if REMOTE_SSH && PASS_STDFILES_UNIX_SOCKET
    close_local_proxy(pclient, WEXITSTATUS(status));
#endif
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
unlink_tty_from_pty(struct pty_client *pclient,
                    struct lws *wsi, struct tty_client *tclient)
{
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
    struct tty_client *first_tclient = pclient->first_tclient;
    if ((tclient->proxyMode != proxy_command_local && first_tclient == NULL && pclient->detach_count == 0
         && ((tclient->misc_flags & close_requested_flag) != 0
             || (tclient->misc_flags & detach_on_disconnect_flag) == 0))
        || tclient->proxyMode == proxy_display_local) {
        lwsl_notice("- close pty flags %x pmode:%d\n", tclient->misc_flags, tclient->proxyMode);
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

static void
clear_connection_number(struct tty_client *tclient)
{
    int snum = tclient->connection_number;
    if (VALID_CONNECTION_NUMBER(snum)) {
        // update to maintain tty_clients invariant
        struct tty_client *next = tty_clients[snum+1];
        for (; snum >= 0 && tty_clients[snum] == tclient; snum--)
            tty_clients[snum] = next;
    }
    tclient->connection_number = -1;
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
    clear_connection_number(tclient);
    free(tclient->ssh_connection_info);
    tclient->ssh_connection_info = NULL;
    if (pclient != NULL)
        unlink_tty_from_pty(pclient, wsi, tclient);
    if (tclient->options) {
        release_options(tclient->options);
        tclient->options = NULL;
    }

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
    tclient->pclient = pclient; // sometimes redundant
    struct tty_client *first_tclient = pclient->first_tclient;

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
        // notify both clients they don't have to save on detach
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
create_pclient(const char *cmd, arglist_t argv, struct options *opts,
               bool ssh_remoting, struct tty_client *t_hint)
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
    if (! ssh_remoting
        && ! (opts->tty_packet_mode
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
    SET_PCLIENT_FLAG(pclient, packet_mode_flag, packet_mode);
    server->session_count++;
    int snum = 1;
    if (t_hint && VALID_CONNECTION_NUMBER(t_hint->connection_number)
        && ! VALID_SESSION_NUMBER(t_hint->connection_number))
        snum = t_hint->connection_number;
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
            if ((t_hint == NULL || snum != t_hint->connection_number)
                 && VALID_CONNECTION_NUMBER(snum))
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
    pclient->stderr_client = NULL;
    pclient->nrows = -1;
    pclient->ncols = -1;
    pclient->pixh = -1;
    pclient->pixw = -1;
    pclient->detach_count = 0;
    pclient->paused = 0;
    pclient->saved_window_contents = NULL;
    pclient->preserved_output = NULL;
    pclient->preserve_mode = 1;
    pclient->first_tclient = NULL;
    pclient->last_tclient_ptr = &pclient->first_tclient;
    pclient->recent_tclient = NULL;
    pclient->session_name = NULL;
    pclient->pflags = 0;
    pclient->pty_wsi = outwsi;
    pclient->cmd = cmd;
    pclient->argv = copy_strings(argv);
#if REMOTE_SSH
    pclient->cmd_socket = -1;
    pclient->cur_pclient = NULL;
#endif
    return pclient;
}

// FIXME use pclient->cmd instead of cmd etc
static struct pty_client *
run_command(const char *cmd, arglist_t argv, const char*cwd,
            arglist_t env, struct pty_client *pclient)
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
            pclient_close(pclient, false); // ???
            break;
    case 0: /* child */
#if 0
            if (login_tty(slave))
                _exit(1);
#else
            // Like login_tty, but optionally stderr separate
            (void) setsid();
            if (ioctl(slave, TIOCSCTTY, (char *)NULL) == -1)
		_exit(1);
            while (dup2(slave, 0) == -1 && errno == EBUSY) {}
            while (dup2(slave, 1) == -1 && errno == EBUSY) {}
            int child_stderr = slave;
            if (pclient != NULL && pclient->stderr_client)
                child_stderr = pclient->stderr_client->pipe_writer;
            while (dup2(child_stderr, 2) == -1 && errno == EBUSY) {}
#endif
            if (cwd != NULL && chdir(cwd) != 0) {
                const char *home = find_home();
                if (home == NULL || chdir(home) != 0)
                    if (chdir("/") != 0)
                        lwsl_err("chdir failed\n");
            }
            if (env == NULL)
                env = (arglist_t)environ;
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
            if (execve(cmd, (char * const*)argv, nenv) < 0) {
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
        else if ((specifier[0] == '#' || specifier[0] == ':'/*DEPRECATED*/)
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

struct test_link_data {
    const char *href;
    const char *position;
    json_object *obj;
};

static bool test_link_clause(const char *clause, void* data)
{
    struct test_link_data *test_data = data;
    int clen = strlen(clause);
    if (clen > 1 && clause[clen-1] == ':') {
        return strcmp(clause, test_data->href) == 0;
    } else if (clause[0] == '.') {
        const char *h = test_data->href;
        const char *dot = NULL;
        for (;*h && *h != '#' && *h != '?'; h++)
            if (*h == '.')
                dot = h;
        return dot && clen == h - dot
            && memcmp(dot, clause, clen) == 0;
    } else if (clen == 7
               && memcmp(clause, "in-atom", clen) == 0) {
        struct json_object *jatom = NULL;
        return  json_object_object_get_ex(test_data->obj, "isAtom", &jatom)
            && json_object_get_boolean(jatom);
    } else if (clen == 13
               && memcmp(clause, "with-position", clen) == 0) {
        return test_data->position != NULL;
    }
    return false;
}

char *
check_template(char *template, json_object *obj)
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
    struct test_link_data test_data;
    test_data.href = href;
    test_data.position = position;
    test_data.obj = obj;
    template = check_conditional(template, test_link_clause, &test_data);
    if (! template)
        return NULL;

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
        command = check_template(p + (start-p), obj);
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
            return true;
        if (pclient->cmd) {
            struct options *options = client->options;
            run_command(pclient->cmd, pclient->argv,
                        options ? options->cwd : NULL,
                        options ? options->env : NULL,
                        pclient);
            free((void*)pclient->cmd); pclient->cmd = NULL;
            free((void*)pclient->argv); pclient->argv = NULL;
        }
        if (pclient->saved_window_contents != NULL)
            lws_callback_on_writable(wsi);
    } else if (strcmp(name, "RECEIVED") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        long count;
        sscanf(data, "%ld", &count);
        client->confirmed_count = count;
        if (((client->sent_count - client->confirmed_count) & MASK28) < MAX_CONTINUE
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
        if (pclient != NULL)
            trim_preserved(pclient);
    } else if (strcmp(name, "KEY") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        char *q1 = strchr(data, '\t');
        char *q2;
        if (q1 == NULL || (q2 = strchr(q1+1, '\t')) == NULL)
            return true; // ERROR
        bool isCanon = true, isEchoing = true;
        if (pclient) {
            struct termios termios;
            int pty = pclient->pty;
            if (pclient->cur_pclient && pclient->cur_pclient->cmd_socket >= 0)
                pty = pclient->cur_pclient->pty;
            if (tcgetattr(pty, &termios) < 0)
                ; //return -1;
            isCanon = (termios.c_lflag & ICANON) != 0;
            isEchoing = (termios.c_lflag & ECHO) != 0;
        }
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
            lwsl_info("report KEY pty:%d canon:%d echo:%d klen:%d\n",
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
        SET_PCLIENT_FLAG(pclient, session_name_unique_flag, true);
        json_object_put(obj);
        FOREACH_PCLIENT(p) {
            if (p != pclient && p->session_name != NULL
                && strcmp(session_name, p->session_name) == 0) {
                struct pty_client *pp = p;
                SET_PCLIENT_FLAG(p, session_name_unique_flag, false);
                for (;;) {
                    FOREACH_WSCLIENT(t, pp) {
                        t->pty_window_update_needed = true;
                        lws_callback_on_writable(t->out_wsi);
                    }
                    if ((pclient->pflags & session_name_unique_flag) == 0
                        || pp == pclient)
                        break;
                    pp = pclient;
                }
                SET_PCLIENT_FLAG(pclient, session_name_unique_flag, false);
            }
        }
    } else if (strcmp(name, "SESSION-NUMBER-ECHO") == 0) {
        struct options *options = client->options;
        if (proxyMode == proxy_display_local && options) {
            set_setting(&options->cmd_settings, REMOTE_SESSIONNUMBER_KEY, data);
        }
        return true;
    } else if (strcmp(name, "OPEN-WINDOW") == 0) {
        struct options *options = client->options;
        static char gopt[] =  "geometry=";
        char *g0 = strstr(data, gopt);
        char *geom = NULL;
        if (g0 != NULL) {
            char *g = g0 + sizeof(gopt)-1;
            char *gend = strstr(g, "&");
            if (gend == NULL)
                gend = g + strlen(g);
            int glen = gend-g;
            geom = xmalloc(glen+1);
            memcpy(geom, g, glen);
            geom[glen] = 0;
            if (! options)
                client->options = options = link_options(NULL);
            set_setting(&options->cmd_settings, "geometry", geom);
        }
        display_session(options, NULL,
                        data[0] == '#' && g0 == data + 1 ? NULL : data, -1);
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
        client->misc_flags |= close_requested_flag;
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
    } else if (strcmp(name, "LOG") == 0) {
        static bool note_written = false;
        if (! note_written)
            lwsl_notice("(lines starting with '#NN:' (like the following) are from browser at connection NN)\n");
        json_object *dobj = json_tokener_parse(data);
        const char *dstr = json_object_get_string(dobj);
        int dlen = json_object_get_string_len(dobj);
        lwsl_notice("#%d: %.*s\n", client->connection_number, dlen, dstr);
        json_object_put(dobj);
        note_written = true;
    } else if (strcmp(name, "ECHO-URGENT") == 0) {
        json_object *obj = json_tokener_parse(data);
        const char *kstr = json_object_get_string(obj);
        FOREACH_WSCLIENT(t, pclient) {
            printf_to_browser(t, URGENT_WRAP("%s"), kstr);
            lws_callback_on_writable(t->out_wsi);
        }
        json_object_put(obj);
    } else if (strcmp(name, "RECONNECT") == 0) {
        struct options *options = client->options;
        if (! options) {
            lwsl_err("RECONNECT with NULL options field\n");
            return true;
        }
        if (pclient) {
            lwsl_err("RECONNECT while already connected\n");
            return true;
        }
        const char *host_arg = get_setting(options->cmd_settings, REMOTE_HOSTUSER_KEY);
        const char *rargv[5];
        rargv[0] = host_arg;
        rargv[1] = REATTACH_COMMAND;
        rargv[2] = data;
        rargv[3] = NULL;
        pclient = handle_remote(3, rargv, options, client);
        link_command(wsi, client, pclient);
        printf_to_browser(client,
                          URGENT_WRAP("\033[99;95u\033]72;<p><i>(Attempting reconnect to %s using ssh.)</i></p>\007"), host_arg);
        lws_callback_on_writable(client->out_wsi);
        return true;
    } else {
    }
    return true;
}

void init_tclient_struct(struct tty_client *client)
{
    client->initialized = 0;
    client->options = NULL;
    client->misc_flags = detach_on_disconnect_flag;
    client->detachSaveSend = false;
    client->uploadSettingsNeeded = true;
    client->requesting_contents = 0;
    client->wsi = NULL;
    client->out_wsi = NULL;
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
    client->next_tclient = NULL;
    lwsl_notice("init_tclient_struct conn#%d\n",  client->connection_number);
}

static void
set_connection_number(struct tty_client *tclient, int hint)
{
    int snum = 1;
    if (hint > 0 && ! VALID_CONNECTION_NUMBER(hint))
        snum = hint;
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
            if ((hint < 0 || snum != hint)
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
    lwsl_info("handle_input len:%zu conn#%d pmode:%d pty:%d\n", clen, client->connection_number, proxyMode, pclient==NULL? -99 : pclient->pty);
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
                } else if (proxyMode == proxy_remote
                           && strcmp(cname, "CLOSE-SESSION") == 0)
                    return -1;
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

static int
handle_output(struct tty_client *client,  enum proxy_mode proxyMode, bool to_proxy)
{
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;

    if (client->proxyMode == proxy_command_local) {
        unsigned char *fd = memchr(client->ob.buffer, 0xFD, client->ob.len);
        lwsl_notice("check for FD: %p text[%.*s] pclient:%p\n", fd, (int) client->ob.len, client->ob.buffer, pclient);
        if (fd && pclient) {
            client->ob.len = 0; // FIXME - simplified
            struct termios termios;
            if (pclient && tcgetattr(pclient->pty, &termios) == 0) {
                termios.c_lflag &= ~(ICANON|ECHO);
                termios.c_oflag &= ~ONLCR;
                tcsetattr(pclient->pty, TCSANOW, &termios);
            }
            tty_restore(-1);
            //client->proxyMode = proxy_display_local;

            if (to_proxy) {
                clear_connection_number(client);
                display_session(client->options, pclient, NULL, http_port);
                if (client->out_wsi && client->out_wsi != client->wsi) {
                    lwsl_notice("set_timeout clear tc:%p\n", client->wsi);
                    lws_set_timeout(client->wsi,
                                    PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
                }
                client->out_wsi = NULL;
                maybe_daemonize();
#if PASS_STDFILES_UNIX_SOCKET
                close_local_proxy(pclient, 0);
#endif
                client->proxy_fd_in = -1;
                client->proxy_fd_out = -1;
                return -1;
            } else {
                client->proxyMode = proxy_display_local;
                // We have an existing websocket connection, but
                // got disconnected and then re-connected.
                printf_to_browser(client,
                                  URGENT_WRAP("\033[99;96u"));
            }
        }
    }

    lwsl_info("handle_output conn#%d initialized:%d pmode:%d len0:%zu pty_up_n:%d\n", client->connection_number, client->initialized, proxyMode, client->ob.len, client->pty_window_update_needed);
    bool nonProxy = proxyMode != proxy_command_local && proxyMode != proxy_display_local;
    struct sbuf buf;
    struct sbuf *bufp = &buf;
    sbuf_init(bufp);
    if (! to_proxy)
        sbuf_blank(bufp, LWS_PRE);
    if (client->uploadSettingsNeeded) { // proxyMode != proxy_local ???
        client->uploadSettingsNeeded = false;
        if (settings_as_json != NULL) {
            sbuf_printf(bufp, URGENT_WRAP("\033]89;%s\007"),
                        settings_as_json);
        }
    }
    if (client->initialized == 0 && proxyMode != proxy_command_local) {
        if (client->options && client->options->cmd_settings) {
            //json_object_put(client->cmd_settings);
            sbuf_printf(bufp, URGENT_WRAP("\033]88;%s\007"),
                        json_object_to_json_string_ext(client->options->cmd_settings, JSON_C_TO_STRING_PLAIN));
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
        && pclient && pclient->preserved_output != NULL) {
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
    if (client->pty_window_update_needed && proxyMode != proxy_command_local) {
        client->pty_window_update_needed = false;
        int kind = proxyMode == proxy_display_local ? 2
            : (pclient->pflags & session_name_unique_flag) != 0;
        lwsl_info("- send session info %d\n", pclient->session_number);
        sbuf_printf(bufp, URGENT_WRAP("\033[91;%d;%d;%d;%du"),
                    kind,
                    pclient->session_number,
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
    if (pclient==NULL)
        lwsl_notice("- empty pclient buf:%d for %p\n", client->ob.buffer != NULL, client);
    if (! pclient && client->ob.buffer != NULL
        && proxyMode != proxy_command_local) {
        if (proxyMode != proxy_display_local)
            sbuf_printf(bufp, "%s", eof_message);
        sbuf_free(&client->ob);
    }
    client->initialized = 2;

    if (to_proxy) {
        if (bufp->len > 0 && proxyMode == proxy_remote && client->options) {
            long output_timeout = client->options->remote_output_interval;
            if (output_timeout)
                lws_set_timer_usecs(client->out_wsi, output_timeout * (LWS_USEC_PER_SEC / 1000));
        }
        if (client->pclient == NULL) {
            lwsl_notice("proxy WRITABLE/close blen:%zu\n", bufp->len);
        }
        // data in tclient->ob.
        size_t n = write(client->proxy_fd_out, bufp->buffer, bufp->len);
        lwsl_notice("proxy RAW_WRITEABLE %d len:%zu written:%zu pclient:%p\n",
                    client->proxy_fd_out, bufp->len, n, client->pclient);
    } else {
        struct lws *wsi = client->wsi;
        int written = bufp->len - LWS_PRE;
        lwsl_info("tty SERVER_WRITEABLE conn#%d written:%d sent: %ld to %p\n", client->connection_number, written, (long) client->sent_count, wsi);
        if (written > 0
            && lws_write(wsi, bufp->buffer+LWS_PRE, written, LWS_WRITE_BINARY) != written)
            lwsl_err("lws_write\n");
    }
    sbuf_free(bufp);
    return to_proxy && client->pclient == NULL ? -1 : 0;
}

#if REMOTE_SSH
#if PASS_STDFILES_UNIX_SOCKET
void close_local_proxy(struct pty_client *pclient, int exit_code)
{
    lwsl_notice("close_local_proxy sess:%d sock:%d\n", pclient->session_number, pclient->cmd_socket);
    if (pclient->cmd_socket >= 0) {
        char r = exit_code;
        if (write(pclient->cmd_socket, &r, 1) != 1)
            lwsl_err("write %d failed - callback_cmd %s\n", pclient->cmd_socket, strerror(errno));
        close(pclient->cmd_socket);
        pclient->cmd_socket = -1;
    }
}
#endif

#if 0
static long
get_elapsed_time_ms ()
{
#if defined(CLOCK_REALTIME) || defined(CLOCK_TAI)
    struct timespec ts;
#if defined(CLOCK_TAI)
    clock_gettime(CLOCK_TAI, &ts);
#else
    clock_gettime(CLOCK_REALTIME, &ts);
#endif
    return ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
#else
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return tv.tv_sec * 1000 + tv.tv_usec / 1000;
#endif
}
#endif

int
callback_proxy(struct lws *wsi, enum lws_callback_reasons reason,
               void *user, void *in, size_t len)
{
    struct tty_client *tclient = (struct tty_client *) user;
    struct pty_client *pclient = tclient == NULL ? NULL : tclient->pclient;
    ssize_t n;
    if (tclient==NULL)
        lwsl_info("callback_proxy wsi:%p reason:%d - no client\n", wsi, reason);
    else
        lwsl_info("callback_proxy wsi:%p reason:%d fd:%d conn#%d\n", wsi, reason, tclient==NULL? -99 : tclient->proxy_fd_in, tclient->connection_number);
    switch (reason) {
    case LWS_CALLBACK_RAW_CLOSE_FILE:
        lwsl_notice("proxy RAW_CLOSE_FILE\n");
        if (tclient->wsi == wsi)
            tty_client_destroy(wsi, tclient);
        return 0;
    case LWS_CALLBACK_TIMER:
        lwsl_notice("proxy CALLBACK_TIMER\n");
        if (tclient->proxyMode == proxy_remote && tclient->options) {
            if (wsi == tclient->wsi) {
                return -1;
            }
            long output_interval = tclient->options->remote_output_interval;
            if (output_interval) {
                lwsl_info("- CALLBACK_TIMER send ping\n");
                printf_to_browser(tclient, URGENT_WRAP(""));
                lws_callback_on_writable(tclient->out_wsi);
                lws_set_timer_usecs(tclient->out_wsi, output_interval * (LWS_USEC_PER_SEC / 1000));
            }
        }
        return 0;

    case LWS_CALLBACK_RAW_RX_FILE: ;
        if (tclient->proxy_fd_in < 0) {
            lwsl_info("proxy RAW_RX_FILE - no fd cleanup\n");
            // cleanup? FIXME
            return 0;
        }
        if (tclient->proxyMode == proxy_remote && tclient->options) {
            long input_timeout = tclient->options->remote_input_timeout;
            if (input_timeout)
                lws_set_timer_usecs(tclient->wsi, input_timeout * (LWS_USEC_PER_SEC / 1000));
        }
        // read data, send to
        sbuf_extend(&tclient->inb, 1024);
        n = read(tclient->proxy_fd_in,
                         tclient->inb.buffer + tclient->inb.len,
                         tclient->inb.size - tclient->inb.len);
        lwsl_info("proxy RAW_RX_FILE n:%ld avail:%zu-%zu\n",
                    (long) n, tclient->inb.size, tclient->inb.len);
        if (n <= 0) {
            return n < 0 && errno == EAGAIN ? 0 : -1;
        }
        tclient->inb.len += n;
        return handle_input(wsi, tclient, tclient->proxyMode);
    case LWS_CALLBACK_RAW_WRITEABLE_FILE:
        if (tclient->proxy_fd_out < 0) {
            lwsl_info("proxy RAW_WRITEABLE_FILE - no fd cleanup\n");
            return -1;
        }
        return handle_output(tclient, tclient->proxyMode, true);
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
    struct tty_client *client = WSI_GET_TCLIENT(wsi);
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;
    lwsl_info("callback_tty %p reason:%d conn#%d\n", wsi, (int) reason,
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
        lwsl_notice("tty/CALLBACK_ESTABLISHED %s client:%p\n", in, client);
        char arg[100]; // FIXME
        long wnum = -1;
        if (! check_server_key(wsi, arg, sizeof(arg) - 1))
            return -1;

        const char *reconnect = lws_get_urlarg_by_name(wsi, "reconnect=", arg, sizeof(arg) - 1);
        long reconnect_value = reconnect == NULL ? -1
            : strtol(reconnect, NULL, 10);
        const char *no_session = lws_get_urlarg_by_name(wsi, "no-session=", arg, sizeof(arg) - 1);
        const char*window = lws_get_urlarg_by_name(wsi, "window=", arg, sizeof(arg) - 1);
        if (window != NULL) {
            wnum = strtol(window, NULL, 10);
            if (VALID_CONNECTION_NUMBER(wnum))
                client = tty_clients[wnum];
            else if (reconnect_value < 0) {
                lwsl_err("connection with invalid connection number %s - error\n", window);
                break;
            }
        } else {
            if (! no_session) {
                // Needed on Apple when using /usr/bin/open as it
                // drops #hash parts of file: URLS.
                FORALL_WSCLIENT(client) {
                    if (client->pclient && client->wsi == NULL) {
                        break;
                    }
                }
            }
        }
        if (client == NULL) {
            client = xmalloc(sizeof(struct tty_client));
            init_tclient_struct(client);
        }
        WSI_SET_TCLIENT(wsi, client);
        pclient = client->pclient;
        if (pclient == NULL) {
            const char*snumber = lws_get_urlarg_by_name(wsi, "session-number=", arg, sizeof(arg) - 1);
            if (snumber)
                pclient = PCLIENT_FROM_NUMBER(strtol(snumber, NULL, 10));
        }
        client->wsi = wsi;
        client->out_wsi = wsi;
        const char*main_window = lws_get_urlarg_by_name(wsi, "main-window=", arg, sizeof(arg) - 1);
        client->main_window = -1;
        if (main_window != NULL) {
            long snum;
            if (strcmp(main_window, "true") == 0)
                client->main_window = 0;
            else if ((snum = strtol(main_window, NULL, 10)) > 0) {
                client->main_window = (int) snum;
                if (client->options == NULL) {
                    struct tty_client *main_client = TCLIENT_FROM_NUMBER(snum);
                    if (main_client != NULL && main_client->options)
                        client->options = link_options(main_client->options);
                }
            }
        }
        const char*headless = lws_get_urlarg_by_name(wsi, "headless=", arg, sizeof(arg) - 1);
        if (headless && strcmp(headless, "true") == 0)
            client->misc_flags |= headless_flag;

        if (no_session != NULL) {
            lwsl_info("dummy connection (no session) established\n");
        } else {
            if (pclient != NULL) {
                if ((pclient->pflags & ssh_pclient_flag) != 0)
                    client->proxyMode = proxy_display_local;
                link_command(wsi, client, pclient);
                lwsl_info("connection to existing session %ld established\n", pclient->session_number);
            } else {
                arglist_t argv = default_command(main_options);
                char *cmd = find_in_path(argv[0]);
                if (cmd != NULL) {
                    pclient = create_pclient(cmd, argv, main_options, false, NULL);
                    link_command(wsi, (struct tty_client *) lws_wsi_user(wsi),
                                 pclient);
                    lwsl_info("connection to new session %d established\n",
                              pclient->session_number);
                }
            }

            if (reconnect_value >= 0) {
                client->confirmed_count = reconnect_value;
                client->sent_count = reconnect_value; // FIXME
                client->initialized = 1;
                lws_callback_on_writable(wsi);
            }
        }
        if (client->connection_number < 0)
            set_connection_number(client,
                                  reconnect_value > 0 && wnum > 0 ? wnum
                                  : pclient ? pclient->session_number : -1);

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
        return handle_output(client, client->proxyMode, false);

    case LWS_CALLBACK_RECEIVE:
        if (client == NULL) {
            lwsl_err("callback_tty (WS) LWS_CALLBACK_RECEIVE with null client\n");
            return -1;
        }
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
        if (client == NULL)
            break;
         if (focused_wsi == wsi)
              focused_wsi = NULL;
         tty_client_destroy(wsi, client);
#if ! BROKEN_LWS_SET_WSI_USER
         lws_set_wsi_user(wsi, NULL);
#endif
         free(client);
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
struct tty_client *
make_proxy(struct options *options, struct pty_client *pclient, enum proxy_mode proxyMode)
{
    int fd_in = options->fd_in;
    int fd_out = options->fd_out;
    // If proxy_remote, use two lws objects because it simplifies timer handling
    if (proxyMode == proxy_remote && fd_out == fd_in)
        fd_out = dup(fd_out);
    lws_sock_file_fd_type fd;
    fd.filefd = fd_in;
    struct lws *pin_lws = lws_adopt_descriptor_vhost(vhost, 0, fd,
                                                     "proxy", NULL);
    struct tty_client *tclient =
        ((struct tty_client *) lws_wsi_user(pin_lws));
    init_tclient_struct(tclient);
    tclient->misc_flags |= tclient_proxy_flag;
    set_connection_number(tclient, pclient ? pclient->session_number : -1);
    tclient->proxy_fd_in = fd_in;
    tclient->proxy_fd_out = fd_out;
    lwsl_notice("make_proxy in:%d out:%d mode:%d in-conn#%d pin-wsi:%p in-tname:%s\n", options->fd_in, options->fd_out, proxyMode, tclient->connection_number, pin_lws, ttyname(options->fd_in));
    tclient->proxyMode = proxyMode;
    tclient->pclient = pclient;
    const char *ssh_connection;
    if (proxyMode == proxy_remote
        && (ssh_connection = getenv_from_array("SSH_CONNECTION", options->env)) != NULL) {
        tclient->ssh_connection_info = strdup(ssh_connection);
    }

    struct lws *pout_lws;
    if (fd_in == fd_out) {
        pout_lws = pin_lws;
    } else {
        fd.filefd = fd_out;
        // maybe set last 'parent' argument ???
        pout_lws = lws_adopt_descriptor_vhost(vhost, 0, fd, "proxy-out", NULL);
        lws_set_wsi_user(pout_lws, tclient);
        lwsl_notice("- make_proxy out-conn#%d wsi:%p\n", tclient->connection_number, pout_lws);
        lws_rx_flow_control(pout_lws, 0);
    }
    tclient->wsi = pin_lws;
    tclient->out_wsi = pout_lws;
    if (pclient)
        link_command(pout_lws, tclient, pclient);
    tclient->options = link_options(options);
    tclient->proxyMode = proxyMode; // do after link_command
    return tclient;
}
#endif

// We're the server (remote) side of an ssh connection.
// Request that the local (client) side open a window.
// Create a proxy to connect between that window and our pty process,
// over the ssh connection.
static struct tty_client *
display_pipe_session(struct options *options, struct pty_client *pclient)
{
    struct tty_client *tclient = make_proxy(options, pclient, proxy_remote);
    if (options && options->remote_output_interval) {
        printf_to_browser(tclient, URGENT_WRAP(""));
    }
    lwsl_notice("should write open-window message\n");
    char *s =  "\xFDREMOTE-WINDOW \n";
    int sl = strlen(s);
    int nn;
    if ((nn = write(options->fd_out, s, sl)) != sl)
        lwsl_notice("bad write n:%d err:%s\n", (int)nn, strerror(errno));
    //printf_to_browser(client, URGENT_WRAP("open-window"));
    //lws_callback_on_writable(wsi);
    //daemonize client
    return tclient;
}

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
        display_pipe_session(options, pclient);
        return EXIT_WAIT;
    }
#endif
    int paneOp = options->paneOp;
    if (browser_specifier != NULL && browser_specifier[0] == '-') {
      if (pclient != NULL && strcmp(browser_specifier, "--detached") == 0) {
          pclient->detach_count = 1;
          return EXIT_SUCCESS;
      }
      if (paneOp < 1 || paneOp > 13)
          paneOp = 0;
    }
    int wnum = -1;
    if (port != -104 && port != -105 && url == NULL) {
        struct tty_client *tclient = xmalloc(sizeof(struct tty_client));
        init_tclient_struct(tclient);
        tclient->options = link_options(options);
        set_connection_number(tclient, pclient ? pclient->session_number : -1);
        tclient->pclient = pclient; // maybe move to set_connection_number
        wnum = tclient->connection_number;
    }
    int r = EXIT_SUCCESS;
    if (paneOp > 0) {
        char *eq = strchr(browser_specifier, '=');
        struct tty_client *tclient;
        if (eq) {
            char *endp;
            long w = strtol(eq+1, &endp, 10);
            if (w <= 0 || *endp || ! VALID_CONNECTION_NUMBER(w)) {
                printf_error(options, "invalid window number in '%s' option",
                             browser_specifier);
                return EXIT_FAILURE;
            }
            tclient = TCLIENT_FROM_NUMBER(w);
        } else if (focused_wsi == NULL) {
            printf_error(options, "no current window for '%s' option",
                         browser_specifier);
            return EXIT_FAILURE;
        } else
            tclient = (struct tty_client *) lws_wsi_user(focused_wsi);
        if (wnum >= 0)
             printf_to_browser(tclient, URGENT_WRAP("\033[90;%d;%du"),
                               paneOp, wnum);
        else
            printf_to_browser(tclient, URGENT_WRAP("\033]%d;%d,%s\007"),
                               -port, paneOp, url);
        lws_callback_on_writable(tclient->out_wsi);
    } else {
        char *encoded = port == -104 || port == -105
            ? url_encode(url, 0)
            : NULL;
        if (encoded)
            url = encoded;
        struct sbuf sb;
        sbuf_init(&sb);
        if (wnum >= 0) {
            const char *main_url = url ? url : main_html_url;
            sbuf_append(&sb, main_url, -1);
            if (strchr(main_url, '#') == NULL)
                sbuf_append(&sb, "#", 1);
            // Note we use ';' rather than the traditional '&' to separate parts
            // of the fragment.  Using '&' causes a mysterious bug (at
            // least on Electron, Qt, and Webview) when added "&js-verbosity=N".
            if (pclient != NULL) {
                sbuf_printf(&sb, ";session-number=%d", pclient->session_number);
            }
            sbuf_printf(&sb, ";window=%d", wnum);
            if (options->headless)
                sbuf_printf(&sb, ";headless=true");
            const char *verbosity = get_setting(options->settings, "log.js-verbosity");
            if (verbosity) {
                char *endv;
                double d = strtod(verbosity, &endv);
                if (endv == verbosity + strlen(verbosity))
                    sbuf_printf(&sb, ";js-verbosity=%g", d);
            }
            const char *log_to_server = get_setting(options->settings, "log.js-to-server");
            if (log_to_server && (strcmp(log_to_server, "yes") == 0
                                  || strcmp(log_to_server, "true") == 0
                                  || strcmp(log_to_server, "both") == 0)) {
                sbuf_printf(&sb, ";log-to-server=%s", log_to_server);
            }
        } else if (port == -105) // view saved file
            sbuf_printf(&sb, "%s#view-saved=%s",  main_html_url, url);
        else if (port == -104) // browse url
            sbuf_printf(&sb, "%s#browse=%s",  main_html_url, url);
        else
            sbuf_printf(&sb, "%s", url);
        if (encoded)
            free(encoded);
        if (browser_specifier
            && strcmp(browser_specifier, "--print-url") == 0) {
            sbuf_append(&sb, "\n", 1);
            if (write(options->fd_out, sb.buffer, sb.len) <= 0)
                lwsl_err("write failed - display_session\n");
        } else
            r = do_run_browser(options, sb.buffer, port);
        sbuf_free(&sb);
    }
    return r;
}

int new_action(int argc, arglist_t argv,
               struct lws *wsi, struct options *opts)
{
    int skip = argc == 0 || index(argv[0], '/') != NULL ? 0 : 1;
    if (skip == 1) {
        optind = 1;
        if (process_options(argc, argv, opts) < 0)
          return EXIT_FAILURE;
        skip = optind;
    }
    arglist_t args = argc == skip ? default_command(opts) : (argv+skip);
    const char *argv0 = args[0];
    const char *cmd = find_in_path(argv0);
    struct stat sbuf;
    if (cmd == NULL || access(cmd, X_OK) != 0
        || stat(cmd, &sbuf) != 0 || (sbuf.st_mode & S_IFMT) != S_IFREG) {
        printf_error(opts, "cannot execute '%s'", argv0);
        return EXIT_FAILURE;
    }
    struct pty_client *pclient = create_pclient(cmd, args, opts, false, NULL);
    int r = display_session(opts, pclient, NULL, http_port);
    if (r == EXIT_FAILURE) {
        lws_set_timeout(pclient->pty_wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
    }
    else if (opts->session_name) {
        pclient->session_name = strdup(opts->session_name);
        opts->session_name = NULL;
    }
    return r;
}

int attach_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    bool is_reattach = argc > 0 && strcmp(argv[0], REATTACH_COMMAND) == 0;
    optind = 1;
    process_options(argc, argv, opts);
    if (optind >= argc) {
        printf_error(opts, "domterm attach: missing session specifier");
        return EXIT_FAILURE;
    }
    const char *session_specifier = argv[optind];
    struct pty_client *pclient;
    long rcount = -1;
    if (is_reattach) {
        long snum;
        if (sscanf(argv[optind], "%ld,%ld", &snum, &rcount) != 2) {
            printf_error(opts, "bad reattach request '%s'", argv[optind]);
            return EXIT_FAILURE;
        }
        pclient = PCLIENT_FROM_NUMBER(snum);
    } else
        pclient = find_session(session_specifier);
    if (pclient == NULL) {
        printf_error(opts, "no session '%s' found", session_specifier);
        return EXIT_FAILURE;
    }
    if ((pclient->pflags & ssh_pclient_flag) != 0) {
        printf_error(opts, "cannot attach to internal ssh session '%s' - attach to remote instead", session_specifier);
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
    lwsl_notice("reattach sess:%ld rcoud:%ld\n", pclient->session_number, rcount);
    if (is_reattach) {
        struct tty_client *tclient = display_pipe_session(opts, pclient);
        tclient->confirmed_count = rcount;
        tclient->sent_count = rcount;
        tclient->initialized = 1;
        return EXIT_WAIT;
    }
    return display_session(opts, pclient, NULL, http_port);
}

int browse_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
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
    const char *url = argv[optind];
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

struct test_host_data {
    const char *host;
};

static bool test_host_clause(const char *clause, void* data)
{
    struct test_host_data *test_data = data;
    char *at_in_clause = strchr(clause, '@');
    if (at_in_clause) {
        const char *at_in_connection = strchr(test_data->host, '@');
        if (at_in_connection && at_in_clause == clause)
            return strcmp(at_in_clause, at_in_connection) == 0;
        else
            return strcmp(clause, test_data->host) == 0;
    }
    return false; // actually ERROR
}

// Check list of conditional clauses for a match with 'host'.
// Return freshly allocated command from matching conditional, or NULL.
static char *
expand_host_conditional(const char *expr, const char *host)
{
    char *r = NULL;
    if (expr != NULL) {
        struct test_host_data test_data;
        test_data.host = host;
        char *t = strdup(expr);
        char *p = t;
        for (;;) {
            const char *start = NULL;
            char *semi = (char*)
                extract_command_from_list(p, &start, NULL, NULL);
            if (*semi)
                *semi = 0;
            else
                semi = NULL;
            char *command = check_conditional(p + (start-p),
                                              test_host_clause, &test_data);
            if (command != NULL) {
                r = strdup(command);
                break;
            }
            if (semi)
                p = semi+1;
            else
                break;
        }
        free(t);
    }
    return r;
}

struct pty_client *
handle_remote(int argc, arglist_t argv, struct options *opts, struct tty_client *tclient)
{
    // Running 'domterm --BROWSER user@host COMMAND' translates
    // to 'ssh USER@HOSTNAME domterm --browser-pipe COMMAND`
    // The --browser-pipe is a pseudo "browser specification":
    // create a pty running COMMAND such that output from the COMMAND
    // is printed to the stdout, and input read from stdin,
    // with perhaps some extra complication for events.
    // Locally, we create a tclient in --BROWSER, but instead
    // of the pclient/pty we do the following.

    const char *host_arg = argv[0];
    char *at = strchr(host_arg, '@');
    const char *ssh_cmd = get_setting(opts->settings, "command.ssh");
    char *ssh_expanded = expand_host_conditional(ssh_cmd, host_arg);
    static char *ssh_default = "ssh";
    if (ssh_expanded == NULL)
        ssh_expanded = strdup(ssh_default);
    argblob_t ssh_args = parse_args(ssh_expanded, false);
    int ssh_argc = count_args(ssh_args);
    free(ssh_expanded);
    char *ssh = ssh_args == 0 ? NULL : find_in_path(ssh_args[0]);
    if (ssh == NULL) {
        printf_error(opts, "domterm: ssh command not found - required for remote");
        free((void*)ssh_args);
        return NULL;
    }
    const char *domterm_cmd = get_setting(opts->settings, "command.remote-domterm");
    char *dt_expanded = expand_host_conditional(domterm_cmd, host_arg);
    if (dt_expanded == NULL)
        dt_expanded = strdup("domterm");
    argblob_t domterm_args = parse_args(dt_expanded, false);
    int domterm_argc = count_args(domterm_args);
    free(dt_expanded);

    int max_rargc = argc+ssh_argc+domterm_argc+8;
    const char** rargv = xmalloc(sizeof(char*)*(max_rargc+1));
        int rargc = 0;
        for (int i = 0; i < ssh_argc; i++)
            rargv[rargc++] = ssh_args[i];
        // argv[0] is @host or user@host. Pass host or user@host to ssh
        rargv[rargc++] = at==host_arg ? at+1 : host_arg;
        for (int i = 0; i < domterm_argc; i++)
            rargv[rargc++] = domterm_args[i];
        rargv[rargc++] = "--browser-pipe";
        for (int i = 1; i < argc; i++)
            rargv[rargc++] = argv[i];
        if (rargc > max_rargc)
            fatal("too many arguments");
        rargv[rargc] = NULL;

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
        struct pty_client *pclient = create_pclient(ssh, rargv, opts, true, tclient);

        // Create pipe for stderr from ssh.
        // This so we can separate ssh error messages from session output.
        int stderr_pipe[2];
        int p = pipe(stderr_pipe);
        lws_sock_file_fd_type lfd;
        lfd.filefd = stderr_pipe[0];
        struct lws *stderr_lws = lws_adopt_descriptor_vhost(vhost, 0, lfd, "ssh-stderr", NULL);
        struct stderr_client *sclient =
            (struct stderr_client *) lws_wsi_user(stderr_lws);
        sclient->wsi = stderr_lws;
        sclient->pclient = pclient;
        sclient->pipe_reader = stderr_pipe[0];
        sclient->pipe_writer = stderr_pipe[1];
        pclient->stderr_client = sclient;

#if 1
        if (cur_pclient) {
            cur_pclient->cur_pclient = pclient;
            pclient->cur_pclient = cur_pclient;
        }
#endif
        pclient->pflags |= ssh_pclient_flag;
        char tbuf[20];
        sprintf(tbuf, "%d", pclient->session_number);
        set_setting(&opts->cmd_settings, LOCAL_SESSIONNUMBER_KEY, tbuf);
        set_setting(&opts->cmd_settings, REMOTE_HOSTUSER_KEY, host_arg);
        lwsl_notice("handle_remote pcl:%p\n", pclient);
        if (tclient == NULL)
            make_proxy(opts, pclient, proxy_command_local);
        else
            tclient->proxyMode = proxy_command_local;
        run_command(pclient->cmd, pclient->argv, opts->cwd, opts->env, pclient);
        // FIXME free fields - see reportEvent
        //int r = EXIT_WAIT; // FIXME
        pclient->cmd_socket = opts->fd_cmd_socket;
        free(rargv);
        free((void*)domterm_args);
        free((void*)ssh_args);
        //free(user);
    return pclient;
}
#endif

int
handle_command(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    lwsl_notice("handle_command %s (%s)\n",
                argc == 0 ? "(default-new)" :argv[0],
                opts == main_options ? "locally"
                : "received from command socket");
    struct command *command = argc == 0 ? NULL : find_command(argv[0]);
    if (command != NULL) {
        lwsl_notice("handle command '%s'\n", command->name);
        return (*command->action)(argc, argv, wsi, opts);
    }
    if (argc == 0 || index(argv[0], '/') != NULL) {
        return new_action(argc, argv, wsi, opts);
#if REMOTE_SSH
    } else if (strchr(argv[0], '@') != NULL) {
        handle_remote(argc, argv, opts, NULL);
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
handle_process_output(struct lws *wsi, struct pty_client *pclient,
                      int fd_in, struct stderr_client *stderr_client) {
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
            if ((min_unconfirmed >= MAX_UNCONFIRMED || avail == 0
                 || pclient->paused)
                && (pclient->pflags & session_name_unique_flag) == 0) {
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
                return 0;
            }
            if (avail >= eof_len) {
                char *data_start = NULL;
                int data_length = 0, read_length = 0;
                FOREACH_WSCLIENT(tclient, pclient) {
                    if (data_start == NULL) {
                        data_start = tclient->ob.buffer+tclient->ob.len;
                        ssize_t n;
                        if ((pclient->pflags & packet_mode_flag) != 0) {
#if USE_PTY_PACKET_MODE
                            // We know data_start > obuffer_raw, so
                            // it's safe to access data_start[-1].
                            char save_byte = data_start[-1];
                            n = read(fd_in, data_start-1, avail+1);
                            lwsl_info("RAW_RX pty %d session %d read %ld tclient#%d a\n",
                                      fd_in, pclient->session_number, (long) n, tclient->connection_number);
                            if (n == 0)
                                return -1;
                            char pcmd = data_start[-1];
                            data_start[-1] = save_byte;
#if TIOCPKT_IOCTL
                            if (n == 1 && (pcmd & TIOCPKT_IOCTL) != 0) {
                                struct termios tio;
                                tcgetattr(fd_in, &tio);
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
                            n = read(fd_in, data_start, avail);
                            lwsl_info("RAW_RX pty %d session %d read %ld tclient#%d\n",
                                      fd_in, pclient->session_number,
                                      (long) n, tclient->connection_number);
                            if (n == 0)
                                return -1;
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
            return 0;
}

int
callback_pty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct pty_client *pclient = (struct pty_client *) user;
    switch (reason) {
        case LWS_CALLBACK_RAW_RX_FILE:
            lwsl_info("callback_pty LWS_CALLBACK_RAW_RX_FILE wsi:%p len:%zu\n",
                      wsi, len);
            struct tty_client *tclient = pclient->first_tclient;
            if ((pclient->pflags & ssh_pclient_flag) != 0
                && tclient && tclient->options
                && tclient->options->remote_output_timeout) {
                lws_set_timer_usecs(wsi,
                                    tclient->options->remote_output_timeout
                                    * (LWS_USEC_PER_SEC / 1000));
            }
            return handle_process_output(wsi, pclient, pclient->pty, NULL);
        case LWS_CALLBACK_TIMER:
            // If we're the local (client) end of ssh.
            lwsl_notice("callback_pty LWS_CALLBACK_TIMER cmd_sock:%d\n", pclient->cmd_socket);
            if ((pclient->pflags & ssh_pclient_flag) != 0) {
                pclient->pflags |= timed_out_flag;
                //pclient_close(pclient, true);
                //break;
                return -1;
            }
            break;
        case LWS_CALLBACK_RAW_CLOSE_FILE: {
            lwsl_notice("callback_pty LWS_CALLBACK_RAW_CLOSE_FILE cmd_sock:%d\n", pclient->cmd_socket);
            pclient_close(pclient, false);
        }
        break;
    default:
        lwsl_info("callback_pty default reason:%d\n", (int) reason);
        break;
    }

    return 0;
}

extern int
callback_ssh_stderr(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len)
{
    struct stderr_client *sclient = (struct stderr_client *) user;
    switch (reason) {
    case LWS_CALLBACK_RAW_RX_FILE: ;
        struct pty_client *pclient = sclient->pclient;
        if (!pclient)
        lwsl_notice("callback_ssh_stdin LWS_CALLBACK_RAW_RX_FILE sclient:%p pclient:%p\n", sclient, pclient);
        if (pclient) {
            struct tty_client *tclient = pclient->first_tclient;
            lwsl_notice("callback_ssh_stdin LWS_CALLBACK_RAW_RX_FILE sclient:%p pclient:%p tclient:%p\n", sclient, pclient, tclient);
            if (tclient && (tclient->misc_flags & tclient_proxy_flag) == 0) {
                size_t buf_len = 2000;
                char *buf = xmalloc(buf_len);
                int nr = read(sclient->pipe_reader, buf, buf_len);
                lwsl_notice("- read %d\n", nr);
                if (nr > 0) {
                    json_object *jstr = json_object_new_string_len(buf, nr);
                    printf_to_browser(tclient, URGENT_WRAP("\033]232;%s\007"),
                                      json_object_to_json_string(jstr));
                    lws_callback_on_writable(tclient->out_wsi);
                    json_object_put(jstr);
                }
                free(buf);
                return nr >= 0 ? 0 : -1;
            }
            return handle_process_output(wsi, pclient, sclient->pipe_reader, sclient);
        }
        return 0;
    default:
        lwsl_notice("callback_ssh_stdin reason %d\n", reason);
        return 0;
   }
}

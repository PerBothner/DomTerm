#include "server.h"
#include <limits.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <termios.h>
#include <utmp.h>
#include <time.h>
#include <new>

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
static char request_contents_message[] = URGENT_WRAP("\033[81u");

static char start_replay_mode[] = "\033[97u";
static char end_replay_mode[] = "\033[98u";

id_table<pty_client> pty_clients;
id_table<tty_client> tty_clients;
id_table<tty_client> main_windows;

int current_dragover_window = -1;
int drag_start_window = -1;

static struct pty_client *
handle_remote(int argc, arglist_t argv, struct options *opts, struct tty_client *tclient);

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

    size_t old_length = pclient->preserved_end - pclient->preserved_start;
    long read_count = pclient->preserved_sent_count + old_length;
    size_t max_unconfirmed = 0;
    FOREACH_WSCLIENT(tclient, pclient) {
         size_t unconfirmed = (read_count - tclient->confirmed_count) & MASK28;
         if (unconfirmed > max_unconfirmed)
             max_unconfirmed = unconfirmed;
     };
     if (pclient->saved_window_contents) {
         size_t unconfirmed =
             (read_count - pclient->saved_window_sent_count) & MASK28;
         if (unconfirmed > max_unconfirmed)
             max_unconfirmed = unconfirmed;
     }

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
         pclient->preserved_output = (char*)
             xrealloc(pclient->preserved_output, pclient->preserved_size);
     }
}

bool
should_backup_output(struct pty_client *pclient)
{
    return pclient->preserve_mode > 0;
}

void
do_exit(int exit_code, bool kill_clients)
{
    struct tty_client *tclient;
    bool wait_needed = false;
    if (kill_clients) {
        FORALL_WSCLIENT(tclient) {
            if (tclient->out_wsi) {
                printf_to_browser(tclient,
                                  OUT_OF_BAND_START_STRING "\033]97;kill\007" URGENT_END_STRING);
                lws_callback_on_writable(tclient->out_wsi);
                wait_needed = true;
            }
        }
    }
    if (wait_needed) {
        lws_set_timer_usecs(cmdwsi, 500 * LWS_USEC_PER_SEC/1000);
        return;
    }
    force_exit = true;
    lws_cancel_service(context);
    exit(exit_code);
}

void
maybe_exit(int exit_code)
{
    lwsl_notice("maybe_exit %d sess:%d cl:%s\n", exit_code, tserver.session_count, NO_TCLIENTS?"none":"some");
    if (tserver.session_count == 0 && NO_TCLIENTS)
        do_exit(exit_code, false);
}

#if REMOTE_SSH
void finish_request(struct options *opts, int exit_code, bool do_close)
{
    if (opts == main_options)
        do_exit(exit_code, false);
    lwsl_notice("finish_request in:"+opts->fd_in);
#if PASS_STDFILES_UNIX_SOCKET
    if (do_close) {
        // fd_in and fs_out are closed by the wsl
        if (opts->fd_err >= 0 && opts->fd_err != STDERR_FILENO) {
            close(opts->fd_err);
            opts->fd_err = -1;
        }
    }
#endif
    if (opts->fd_cmd_socket >= 0) {
        char r[2];
        int rcount = 0;
#if !PASS_STDFILES_UNIX_SOCKET
        r[rcount++] = PASS_STDFILES_EXIT_CODE;
#endif
        r[rcount++] = exit_code;
        if (write(opts->fd_cmd_socket, r, rcount) != rcount)
            lwsl_err("write %d failed - callback_cmd %s\n", opts->fd_cmd_socket, strerror(errno));
        if (do_close) {
            close(opts->fd_cmd_socket);
            opts->fd_cmd_socket = -1;
        }
    }
}

static void
pclient_close(struct pty_client *pclient, bool xxtimed_out)
{
    int snum = pclient->session_number;
    bool timed_out = pclient->timed_out;
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
                    main_options->sig_code, pclient->pid);
        if (kill(pclient->pid, main_options->sig_code) != 0) {
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

    struct tty_client *tnext;
    for (struct tty_client *tclient = pclient->first_tclient;
         tclient != NULL; tclient = tnext) {
        tnext = tclient->next_tclient;
        lwsl_notice("- pty close %d conn#%d proxy_fd:%d mode:%d\n", status, tclient->connection_number, tclient->options->fd_in, tclient->proxyMode);
        tclient->pclient = NULL;
        if (tclient->out_wsi == NULL)
            continue;
        if (pclient->is_ssh_pclient) {
            if (! tclient->is_tclient_proxy()) { // proxy_display_local ?
                printf_to_browser(tclient,
                                  timed_out
                                  ? URGENT_WRAP("\033[99;97u")
                                  : (status != -1 && WIFEXITED(status)
                                     && WEXITSTATUS(status) == 0xFF)
                                  ? URGENT_WRAP("\033[99;98u")
                                  : eof_message);
                if (! timed_out)
                    tclient->keep_after_unexpected_close = false;
                connection_failure = true;
            } else {
                finish_request(tclient->options, WEXITSTATUS(status), true);
                struct lws *wsi = tclient->wsi;
                struct lws *out_wsi = tclient->out_wsi;
                if (wsi != out_wsi)
                    lws_set_timeout(out_wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
                lws_set_timeout(wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
            }
        }
        if (tclient->out_wsi)
            lws_callback_on_writable(tclient->out_wsi);
    }

    if (WEXITSTATUS(status) == 0xFF && connection_failure) {
        lwsl_notice("DISCONNECTED\n");
    }
    pty_clients.remove(pclient);

// remove from sessions list
    tserver.session_count--;
    lwsl_notice("before maybe_exit status:%d exited:%d statis:%d\n",
                status, WIFEXITED(status), WEXITSTATUS(status));
    maybe_exit(status == -1 || ! WIFEXITED(status) ? 0
               : WEXITSTATUS(status) == 0xFF ? 0xFE : WEXITSTATUS(status));
}

void
printf_to_browser(struct tty_client *tclient, const char *format, ...)
{
    va_list ap;
    va_start(ap, format);
    tclient->ob.vprintf(format, ap);
    va_end(ap);
}

static void
set_connection_number(struct tty_client *tclient, int hint)
{
    int snum = tty_clients.enter(tclient, hint);
    tclient->connection_number = snum;
    lwsl_notice("set_connection_number %p to %d\n", tclient, tclient->connection_number);
}

static void
clear_connection_number(struct tty_client *tclient)
{
    tty_clients.remove(tclient);
    tclient->connection_number = -1;
}

// Unlink wsi from pclient's list of client_wsi-s.
static void
unlink_tty_from_pty(struct pty_client *pclient, struct tty_client *tclient)
{
    lwsl_notice("unlink_tty_from_pty p:%p t:%p\n", pclient, tclient);
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
    if (tclient->is_primary_window) {
        tclient->is_primary_window = false;
        pclient->has_primary_window = false;
        FOREACH_WSCLIENT(tother, pclient) {
            if (tother->out_wsi != NULL) {
                tother->is_primary_window = true;
                pclient->has_primary_window = true;
                break;
            }
        }
    }
    struct tty_client *first_tclient = pclient->first_tclient;
    if ((tclient->proxyMode != proxy_command_local && first_tclient == NULL && pclient->detach_count == 0
         && (tclient->close_requested
             || ! tclient->keep_after_unexpected_close
             || ! tclient->detach_on_disconnect))
        || tclient->proxyMode == proxy_display_local) {
        lwsl_notice("- close pty pmode:%d\n", tclient->proxyMode);
        lws_set_timeout(pclient->pty_wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
    } else if (tclient->main_window == 0
        && tclient->connection_number == pclient->session_number) {
        // The session correspding to the main window was detached.
        // The connection is kept around to handle window-level operations.
        // Re-number that connection so the old window number is
        // available when we attach a new window to the session.
        // (We prefer to have window/connection numbers match session numbers.)
        int old_number = tclient->connection_number;
        clear_connection_number(tclient);
        set_connection_number(tclient, -1);
        int new_number = tclient->connection_number;
        struct tty_client *tother;
        FORALL_WSCLIENT(tother) {
            if (tother->main_window == old_number)
                tother->main_window = new_number;
        }
        tclient->pty_window_update_needed = true;
        lws_callback_on_writable(tclient->wsi);
    }
    tclient->wkind =
        tclient->main_window == 0 ?  main_only_window : unknown_window;

    // If only one client left, do detachSaveSend
    if (first_tclient != NULL) {
        if (first_tclient->next_tclient == NULL) {
            first_tclient->pty_window_number = -1;
            first_tclient->pty_window_update_needed = true;
            first_tclient->detachSaveSend = true;
        }
    }
}

tty_client::~tty_client()
{
    struct tty_client *tclient = this;
    bool keep_client = false;
    // remove from clients list
    lwsl_notice("tty_client destroy %p conn#%d keep:%d\n", tclient, tclient->connection_number, keep_client);
    if (tclient->version_info != NULL && !keep_client) {
        free(tclient->version_info);
        tclient->version_info = NULL;
    }

    struct pty_client *pclient = tclient->pclient;
    int wnumber = tclient->connection_number;
    if (! keep_client) {
        clear_connection_number(tclient);
        free(tclient->ssh_connection_info);
        tclient->ssh_connection_info = NULL;
        if (pclient != NULL)
            unlink_tty_from_pty(pclient, tclient);
        tclient->pclient = NULL;
    }
    if (tclient->options && !keep_client) {
        options::release(tclient->options);
        tclient->options = NULL;
    }
    tclient->wsi = NULL;
    tclient->out_wsi = NULL;

    struct options *request;
    while ((request = pending_requests.first()) != nullptr) {
        pending_requests.remove(request);
        char *close_response = request->close_response;
        if (close_response) {
            request->close_response = nullptr;
            size_t len = strlen(close_response);
            if (len > 0) {
                close_response[len] = '\n';
                write(request->fd_out, close_response, len+1);
            }
            free(close_response);
            finish_request(request, EXIT_SUCCESS, true);
        } else {
            printf_error(request, "Window %d closed before responding.",
                         wnumber);
            finish_request(request, EXIT_FAILURE, true);
        }
        options::release(request);
    }
}

void
tty_client::set_window_name(const std::string& name)
{
    bool old_unique = this->window_name_unique;
    bool unique = true;
    bool same_name = window_name == name;
    struct tty_client *oclient;
    FORALL_WSCLIENT(oclient) {
        if (oclient != this && oclient->window_name == name) {
            unique = false;
        }
    }
    if (same_name && unique == old_unique)
        return;
    std::string old_name = this->window_name;
    this->window_name_unique = unique;
    if (! same_name) {
        this->window_name = name;
        if (pclient)
            pclient->saved_window_name = name;
    }

    if (! unique || ! old_unique) {
        FORALL_WSCLIENT(oclient) {
            if (oclient != this
                && (oclient->window_name == old_name
                    || oclient->window_name == name)) {
                std::string oname = oclient->window_name;
                // update oclient->window_name_unique.
                oclient->set_window_name(oname);
            }
        }
    }

    json request;
    request["cmd"] = "set-window-name";
    request["windowName"] = name;
    request["windowNumber"] = index();
    request["windowNameUnique"] = unique;
    struct tty_client *tclient = this;
    tclient->name_update_needed = true;
    if (out_wsi == nullptr && main_window != 0) {
        tclient = tty_clients(main_window);
    }
    if (tclient) {
        tclient->ob.printf(URGENT_WRAP("\033]97;%s\007"),
                           request.dump().c_str());
        if (tclient->out_wsi != nullptr)
            lws_callback_on_writable(tclient->wsi);
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

void
link_clients(struct tty_client *tclient, struct pty_client *pclient)
{
    tclient->pclient = pclient; // sometimes redundant
    *pclient->last_tclient_ptr = tclient;
    pclient->last_tclient_ptr = &tclient->next_tclient;
    tclient->wkind = dterminal_window;
}

void link_command(struct lws *wsi, struct tty_client *tclient,
                  struct pty_client *pclient)
{
    if (tclient->pclient == NULL)
        link_clients(tclient, pclient);

    if (! pclient->has_primary_window) {
        tclient->is_primary_window = true;
        pclient->has_primary_window = true;
    }
    int n = 0;
    struct tty_client *oclient = NULL;
    FOREACH_WSCLIENT(xclient, pclient) {
        if (xclient->out_wsi != NULL) {
            n++;
            if (xclient != tclient)
                oclient = xclient;
        }
    }
    tclient->pty_window_number =
        n <= 1 ? -1 :
        // FIXME this should be an actual sequence number
        pclient->has_primary_window;
    // If following this link_command there are now two clients,
    // notify both clients they don't have to save on detach
    if (oclient != NULL) {
        oclient->pty_window_update_needed = true;
        oclient->pty_window_number = 0;
        tclient->detachSaveSend = true;
        oclient->detachSaveSend = true;
        lws_callback_on_writable(wsi);
        lws_callback_on_writable(oclient->out_wsi);
    }
    lwsl_notice("link_command wsi:%p tclient:%p pclient:%p\n",
                wsi, tclient, pclient);
    tclient->pty_window_update_needed = true;
    if (tclient->proxyMode != proxy_command_local
        && tclient->proxyMode != proxy_display_local)
        focused_client = tclient;
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

void put_to_env_array(const char **arr, int max, const char* eval)
{
    const char *eq = index(eval, '=');
    int name_len = eq - eval;
    for (int i = 0; ; i++) {
        if (arr[i] == NULL) {
            if (i == max)
                abort();
            arr[i] = (char *) eval;
            arr[i+1] = NULL;
        }
        if (strncmp(arr[i], eval, name_len+1) == 0) {
            arr[i] = eval;
            break;
        }
    }
}

template<typename T>
bool id_table<T>::avoid_index(int i, int hint) {
    return valid_index(i) ||
        (i != hint && (tty_clients.valid_index(i) ||
                       main_windows.valid_index(i) ||
                       pty_clients.valid_index(i)));
}

template<typename T>
int id_table<T>::enter(T *entry, int hint)
{
    int snum = 1;
    if (hint > 0 && ! valid_index(hint) && ! avoid_index(hint, -1))
        snum = hint;
    for (; ; snum++) {
        if (snum >= sz) {
            int newsize = 3 * sz >> 1;
            if (newsize < 20)
                newsize = 20;
            elements = (T**) realloc(elements, newsize * sizeof(T*));
            for (int i = sz; i < newsize; i++)
                elements[i] = nullptr;
            sz = newsize;
        }
        T*next = elements[snum];
        if (next == NULL || next->index() > snum) {
            if ((hint < 0 || snum != hint) && avoid_index(snum, hint))
                continue;
            // Maintain invariant
            for (int iprev = snum;
                 --iprev >= 0 && elements[iprev] == next; ) {
                elements[iprev] = entry;
            }
            elements[snum] = entry;
            //pclient->session_number = snum;
            break;
        }
    }
    return snum;
}
template<typename T>
void id_table<T>::remove(T* entry)
{
    if (entry == nullptr)
        return;
    int index = entry->index();
    if (! valid_index(index))
        return;
    T* next = elements[index+1];
    for (; index >= 0 && elements[index] == entry; index--)
            elements[index] = next;
}

void
request_enter(struct options *opts, tty_client* tclient)
{
    tclient->pending_requests.enter(opts, opts->index());
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
    outwsi = lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC, fd,
                                        "pty", NULL);
    struct pty_client *pclient = (struct pty_client *) lws_wsi_user(outwsi);
    pclient->ttyname = tname;
    pclient->uses_packet_mode = packet_mode;
    tserver.session_count++;

    int hint = t_hint ? t_hint->connection_number : -1;
    if (hint > 0 &&
        (! tty_clients.valid_index(hint) || pty_clients.valid_index(hint)))
        hint = -1;
    int snum = pty_clients.enter(pclient, hint);
    pclient->session_number = snum;

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
    pclient->timed_out = false;
    pclient->session_name_unique = false;
    pclient->is_ssh_pclient = false;
    pclient->has_primary_window = false;
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
    case 0: { /* child */
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
            const char **nenv = (const char **) xmalloc((env_max + 1)*sizeof(const char*));
            memcpy(nenv, env, (env_size + 1)*sizeof(const char*));

            put_to_env_array(nenv, env_max, "TERM=xterm-256color");
#if !  WITH_XTERMJS
            put_to_env_array(nenv, env_max, "COLORTERM=truecolor");
            const char* dinit = "DOMTERM=";
#ifdef LWS_LIBRARY_VERSION
#define SHOW_LWS_LIBRARY_VERSION "=" LWS_LIBRARY_VERSION
#else
#define SHOW_LWS_LIBRARY_VERSION ""
#endif
            const char *lstr = ";libwebsockets" SHOW_LWS_LIBRARY_VERSION;
            const char* pinit = ";tty=";
            char* ttyName = ttyname(0);
            char pidbuf[40];
            pid = getpid();
            size_t dlen = strlen(dinit);
            size_t llen = strlen(lstr);
            size_t plen = strlen(pinit);
            int tlen = ttyName == NULL ? 0 : strlen(ttyName);
            const char *version_info =
              /* FIXME   tclient != NULL ? tclient->version_info
                    :*/ "version=" LDOMTERM_VERSION;
            int vlen = version_info == NULL ? 0 : strlen(version_info);
            int mlen = dlen + vlen + llen + (tlen > 0 ? plen + tlen : 0);
            if (pid > 0) {
                sprintf(pidbuf, ";session#=%d;pid=%d",
                        pclient->session_number, pid);
                mlen += strlen(pidbuf);
            }
            char* ebuf = challoc(mlen+1);
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
            if (execve(cmd, (char * const*)argv, (char **) nenv) < 0) {
                perror("execvp");
                exit(1);
            }
            break;
    }
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
    struct pty_client *session = nullptr;
    char *pend;
    pid_t pid = -1;
    if (specifier[0] == '$' && specifier[1] != '\0') {
        pid = strtol(specifier+1, &pend, 10);
        if (*pend != '\0')
            pid = -1;
    }
    int snum = -1;
    if (specifier[0] >= '0' && specifier[1] <= '9') {
        snum = strtol(specifier, &pend, 10);
        if (*pend != '\0')
            snum = -1;
    }

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
        else if (snum >= 0 && snum == pclient->session_number)
          match = 1;
        if (match) {
          if (session != NULL)
            return NULL; // ambiguous
          else
            session = pclient;
        }
    }
    if (session == nullptr && snum >= 0) {
        tty_client *tclient = tty_clients(snum);
        if (tclient)
            session = tclient->pclient;
    }
    return session;
}

static char localhost_localdomain[] = "localhost.localdomain";

struct test_link_data {
    const char* href;
    const char* position;
    const json *obj;
};

static bool test_link_clause(const char *clause, void* data)
{
    struct test_link_data *test_data = (struct test_link_data *) data;
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
        auto jatom = test_data->obj->find("isAtom");
        return jatom != test_data->obj->end() && jatom->is_boolean() && *jatom;
    } else if (clen == 13
               && memcmp(clause, "with-position", clen) == 0) {
        return test_data->position != NULL;
    }
    return false;
}

char *
check_template(const char *tmplate, const json& obj)
{
    std::string sfilename = get_setting_s(obj, "filename");
    std::string sposition = get_setting_s(obj, "position");
    std::string shref = get_setting_s(obj, "href");
    const char*filename = sfilename.empty() ? NULL : sfilename.c_str();
    const char*position = sposition.empty() ? NULL : sposition.c_str();
    const char*href = shref.empty() ? NULL : shref.c_str();
    if (filename != NULL && filename[0] == '/' && filename[1] == '/') {
        if (filename[2] == '/')
            filename = filename + 2;
        else {
            const char *colon = strchr(filename+2, '/');
            if (colon == NULL)
                return NULL;
            size_t fhlen = colon - (filename + 2);
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
    test_data.obj = &obj;
    tmplate = check_conditional(tmplate, test_link_clause, &test_data);
    if (! tmplate)
        return NULL;

    if (strcmp(tmplate, "atom") == 0)
        tmplate = "atom '%F'%:P";
    else if (strcmp(tmplate, "emacs") == 0)
        tmplate = "emacs %+P '%F' > /dev/null 2>&1 ";
    else if (strcmp(tmplate, "emacsclient") == 0)
        tmplate = "emacsclient -n %+P '%F'";
    else if (strcmp(tmplate, "firefox") == 0
             || strcmp(tmplate, "chrome") == 0
             || strcmp(tmplate, "google-chrome") == 0) {
        const char *chr = strcmp(tmplate, "firefox") == 0
          ? firefox_browser_command(main_options)
            : chrome_command(false, main_options);
        if (chr == NULL)
            return NULL;
        char *buf = challoc(strlen(chr) + strlen(href)+4);
        sprintf(buf, "%s '%s'", chr, href);
        return buf;
    }
    int i;
    for (i = 0; tmplate[i]; i++) {
        char ch = tmplate[i];
        if (ch == '%' && tmplate[i+1]) {
            char next = tmplate[++i];
            char prefix = 0;
            if ((next == ':' || next == '+') && tmplate[i+1]) {
                prefix = next;
                next = tmplate[++i];
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
    char *buffer = challoc(size+1);
    i = 0;
    char *p = buffer;
    for (i = 0; tmplate[i]; i++) {
        char ch = tmplate[i];
        if (ch == '%' && tmplate[i+1]) {
            char next = tmplate[++i];
            char prefix = 0;
            if ((next == ':' || next == '+') && tmplate[i+1]) {
                prefix = next;
                next = tmplate[++i];
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

static bool
handle_tlink(const char *tmplate, const json& obj)
{
    char *t = strdup(tmplate);
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
        free(command);
        auto jit = obj.find("href");
        if (jit != obj.end() && jit->is_string()) {
            default_link_command(std::string(*jit).c_str());
            return true;
        }
    }
    lwsl_notice("open linked application %s\n", command);
    bool r = start_command(main_options, command) == EXIT_SUCCESS;
    free(command);
    return r;
}

static void
backup_output(struct pty_client *pclient, char *data_start, int data_length)
{
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
        char * nbuffer = (char *) xrealloc(pclient->preserved_output, nsize);
        pclient->preserved_output = nbuffer;
        pclient->preserved_size = nsize;
    }
    memcpy(pclient->preserved_output + pclient->preserved_end,
           data_start, data_length);
    pclient->preserved_end += data_length;
}

static void
handle_link(const json& obj)
{
    if (obj.find("filename") != obj.end()) {
        std::string stmplate = get_setting_s(main_options->settings, "open.file.application");
        const char *tmplate = ! stmplate.empty() ? stmplate.c_str()
            : "{in-atom}{with-position|!.html}atom;"
              "{with-position|!.html}emacsclient;"
              "{with-position|!.html}emacs;"
              "{with-position|!.html}atom";
        if (handle_tlink(tmplate, obj))
            return;
    }
    std::string stmplate = get_setting_s(main_options->settings, "open.link.application");
    const char *tmplate = ! stmplate.empty() ? stmplate.c_str()
        : "{!mailto:}browser;{!mailto:}chrome;{!mailto:}firefox";
    handle_tlink(tmplate, obj);
}

static void
reconnect(struct lws *wsi, struct tty_client *client,
          const char *host_arg, const char *data)
{
    struct options *options = client->options;
    const char *rargv[5];
    rargv[0] = host_arg;
    rargv[1] = REATTACH_COMMAND;
    rargv[2] = data;
    rargv[3] = NULL;
    struct pty_client *pclient = handle_remote(3, rargv, options, client);
    link_command(wsi, client, pclient);
    printf_to_browser(client,
                      URGENT_WRAP("\033[99;95u\033]72;<p><i>(Attempting reconnect to %s using ssh.)</i></p>\007"), host_arg);
    lws_callback_on_writable(client->out_wsi);
}

#if defined(TIOCSIG)
static void
maybe_signal (struct pty_client *pclient, int sig, int ch)
{
    ioctl(pclient->pty, TIOCSIG, (char *)(size_t)sig);
    if (ch >= 0) {
        char cbuf[12];
        int n = ch >= ' ' && ch != 127 ? sprintf(cbuf, "%c", ch)
            : sprintf(cbuf, "^%c", ch == 127 ? '?' : ch + 64);
        FOREACH_WSCLIENT(tclient, pclient) {
            tclient->ob.append(cbuf);
            tclient->ocount += n;
            lws_callback_on_writable(tclient->out_wsi);
        }
    }
}
#endif

/** Handle an "event" encoded in the stream from the browser.
 * Return true if handled.  Return false if proxyMode==proxy_local
 * and the event should be sent to the remote end.
 */

bool
reportEvent(const char *name, char *data, size_t dlen,
            struct lws *wsi, struct tty_client *client,
            enum proxy_mode proxyMode)
{
    struct options *options = client->options;
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
            && client->is_primary_window
            && sscanf(data, "%d %d %g %g", &pclient->nrows, &pclient->ncols,
                      &pclient->pixh, &pclient->pixw) == 4) {
          if (pclient->pty >= 0)
            setWindowSize(pclient);
          bool need_backup = should_backup_output(pclient);
          FOREACH_WSCLIENT(wclient, pclient) {
              if (wclient->out_wsi != NULL) {
                  int olen = wclient->ob.len;
                  printf_to_browser(wclient,
                                    OUT_OF_BAND_START_STRING "\027"
                                    "\033[8;%d;%d;%dt"
                                    URGENT_END_STRING,
                                    pclient->nrows, pclient->ncols, 8);
                  int n = wclient->ob.len - olen;
                  wclient->ocount += n;
                  lws_callback_on_writable(wclient->out_wsi);
                  if (need_backup) {
                      backup_output(pclient, wclient->ob.buffer + olen, n);
                      need_backup = false;
                  }
              }
          }
        }
    } else if (strcmp(name, "VERSION") == 0) {
        char *version_info = challoc(dlen+1);
        strcpy(version_info, data);
        client->version_info = version_info;
        client->initialized = 0;
        if (proxyMode == proxy_display_local)
            return false;
        if (pclient == NULL) {
            client->pty_window_update_needed = true;
            lws_callback_on_writable(client->out_wsi);
            return true;
        }
        if (pclient->cmd) {
            run_command(pclient->cmd, pclient->argv,
                        options ? options->cwd : NULL,
                        options ? options->env : NULL,
                        pclient);
            free((void*)pclient->cmd); pclient->cmd = NULL;
            free((void*)pclient->argv); pclient->argv = NULL;
        }
        if (pclient->saved_window_contents != NULL
            || client->pending_requests.first())
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
        bool isCanon = true, isEchoing = true, isExtproc = false;
        struct termios trmios;
        if (pclient) {
            int pty = pclient->pty;
            if (pclient->cur_pclient && pclient->cur_pclient->cmd_socket >= 0)
                pty = pclient->cur_pclient->pty;
            if (tcgetattr(pty, &trmios) < 0)
                ; //return -1;
            isCanon = (trmios.c_lflag & ICANON) != 0;
            isEchoing = (trmios.c_lflag & ECHO) != 0;
#if EXTPROC
            isExtproc = (trmios.c_lflag & EXTPROC) != 0;
#endif
        } else {
            trmios.c_cc[VINTR] = 3;
            trmios.c_cc[VEOF] = 4;
            trmios.c_cc[VSUSP] = 032;
            trmios.c_cc[VQUIT] = 034;
        }
        json obj = json::parse(q2+1, nullptr, false);
        std::string str = obj.is_string() ? obj : "";
        const char *kstr = str.c_str();
        int klen = str.length();
        int kstr0 = klen != 1 ? -1 : kstr[0];
        if (isCanon
            && kstr0 != trmios.c_cc[VINTR]
            && kstr0 != trmios.c_cc[VEOF]
            && kstr0 != trmios.c_cc[VSUSP]
            && kstr0 != trmios.c_cc[VQUIT]) {
            printf_to_browser(client, OUT_OF_BAND_WRAP("\033]%d;%.*s\007"),
                              isEchoing ? 74 : 73, (int) dlen, data);
            lws_callback_on_writable(wsi);
        } else {
            size_t to_drain = 0;
            if (pclient->paused) {
                // If we see INTR, we want to drain already-buffered data.
                // But we don't want to drain data that written after the INTR.
                if ((trmios.c_cc[VINTR] == kstr0
                     || trmios.c_cc[VQUIT] == kstr0)
                    && ioctl (pclient->pty, FIONREAD, &to_drain) != 0)
                    to_drain = 0;
            }
            lwsl_info("report KEY pty:%d canon:%d echo:%d klen:%d\n",
                      pclient->pty, isCanon, isEchoing, klen);
#if defined(TIOCSIG)
            bool packet_mode = isExtproc && (trmios.c_lflag & ISIG) != 0;
            int ch0 = isCanon ? kstr0 : -1;
            if (packet_mode && kstr0 == trmios.c_cc[VINTR])
                // kill(- pclient->pid, SIGINT);
                maybe_signal(pclient, SIGINT, ch0);
            else if (packet_mode && kstr0 == trmios.c_cc[VSUSP])
                maybe_signal(pclient, SIGTSTP, ch0);
            else if (packet_mode && kstr0 == trmios.c_cc[VQUIT])
                maybe_signal(pclient, SIGQUIT, ch0);
            else
#endif
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
    } else if (strcmp(name, "WINDOW-NAME") == 0) {
        char *q = strchr(data, '"');
        json obj = json::parse(q, nullptr, false);
        std::string str = obj.is_string() ? obj : "";
        client->set_window_name(str);
#if 0
        const char *kstr = str.c_str();
        int klen = str.length();
        char *session_name = challoc(klen+1);
        strcpy(session_name, kstr);
        if (pclient->session_name)
            free(pclient->session_name);
        pclient->session_name = session_name;
        pclient->session_name_unique = true;
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
#endif
    } else if (strcmp(name, "SESSION-NUMBER-ECHO") == 0) {
        if (proxyMode == proxy_display_local && options) {
            set_setting(options->cmd_settings, REMOTE_SESSIONNUMBER_KEY, data);
        }
        return true;
    } else if (strcmp(name, "RESPONSE") == 0) {
        json obj = json::parse(data, nullptr, false);
        if (obj.is_object() && obj.contains("id")
            && obj["id"].is_number()) {
            if (obj.contains("from-ssh-remote")
                && proxyMode == proxy_display_local)
                return false;
            int rid = obj["id"].get<int>();
            struct options *request = client->pending_requests(rid);
            if (request) {
                client->pending_requests.remove(request);
                int exit_code = EXIT_SUCCESS;
                if (obj.contains("out") && obj["out"].is_string()) {
                    std::string result = obj["out"].get<std::string>();
                    const char *cresult = result.c_str();
                    size_t clen = result.length();
                    write(request->fd_out, cresult, clen); // FIXME check
                }
                if (obj.contains("err") && obj["err"].is_string()) {
                    std::string result = obj["err"].get<std::string>();
                    printf_error(request, "%s", result.c_str());
                    exit_code = EXIT_FAILURE;
                }
                finish_request(request, exit_code, true);
                options::release(request);
            }
        } else {
            lwsl_err("RESPONSE with bad object syntax or missing'id'\n");
        }
    } else if (strcmp(name, "OPEN-WINDOW") == 0) {
        static char gopt[] =  "geometry=";
        char *g0 = strstr(data, gopt);
        char *geom = NULL;
        if (g0 != NULL) {
            char *g = g0 + sizeof(gopt)-1;
            char *gend = strstr(g, "&");
            if (gend == NULL)
                gend = g + strlen(g);
            int glen = gend-g;
            geom = challoc(glen+1);
            memcpy(geom, g, glen);
            geom[glen] = 0;
            if (! options)
                client->options = options = link_options(NULL);
            options->geometry_option = geom;
        }
        const char* url = !data[0] || (data[0] == '#' && g0 == data + 1) ? NULL
            : data;
        struct pty_client *npclient = nullptr;
        if (! url) {
            arglist_t argv = default_command(options);
            char *cmd = find_in_path(argv[0]);
            if (cmd != NULL)
                npclient = create_pclient(cmd, argv, options, false, nullptr);
        }
        display_session(options, npclient, url,
                        url ? unknown_window : dterminal_window);
        if (geom != NULL)
            free(geom);
    } else if (strcmp(name, "DETACH") == 0) {
        if (proxyMode == proxy_display_local)
            return false;
        if (pclient != NULL) {
            if (pclient->detach_count >= 0)
                pclient->detach_count++;
            if (pclient->preserved_output == NULL
                && client->requesting_contents == 0)
                client->requesting_contents = 1;
        }
    } else if (strcmp(name, "CLOSE-WINDOW") == 0) {
        char *end;
        struct tty_client *wclient = NULL;
        long wnum = strtol(data, &end, 10);
        if (data[0] && ! end[0])
            wclient = tty_clients(wnum);
        if (wclient == nullptr)
            wclient = client;
        else
            pclient = wclient->pclient;
        wclient->close_requested = true;
        if (proxyMode == proxy_display_local)
            return false;
        if (pclient != NULL) {
            unlink_tty_from_pty(pclient, wclient);
            wclient->pclient = NULL;
        } else {
            clear_connection_number(wclient);
            if (wclient != client)
                delete wclient;
        }
    } else if (strcmp(name, "FOCUSED") == 0) {
        focused_client = client;
    } else if (strcmp(name, "LINK") == 0) {
        json obj = json::parse(data, nullptr, false);
        handle_link(obj);
    } else if (strcmp(name, "REQUEST-CLIPBOARD-TEXT") == 0
        || strcmp(name, "REQUEST-SELECTION-TEXT") == 0) {
        bool getting_clipboard = strcmp(name, "REQUEST-CLIPBOARD-TEXT") == 0;
        if (options == NULL)
            options = main_options;
        std::string get_clipboard_cmd =
            get_setting_s(options->settings,
                          getting_clipboard ? "command.get-clipboard"
                          : "command.get-selection");
        if (get_clipboard_cmd.empty()) {
            const char *cmd = get_clipboard_command(getting_clipboard ? "paste" : "selection-paste");
            if (cmd)
                get_clipboard_cmd = cmd;
        }
        struct sbuf sb;
        int px;
        if (! get_clipboard_cmd.empty()
            && ((px = popen_read(get_clipboard_cmd.c_str(), sb)), WIFEXITED(px) && WEXITSTATUS(px) == 0)) {
            if (sb.len > 0 && sb.buffer[sb.len-1] == '\n') {
                sb.len--;
                if (sb.len > 0 && sb.buffer[sb.len-1] == '\r')
                    sb.len--;
            }
            json jobj = sb.null_terminated();
            printf_to_browser(client, URGENT_WRAP("\033]231;%s\007"),
                              jobj.dump().c_str());
            lws_callback_on_writable(wsi);
        }
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
        json dobj = json::parse(data, nullptr, false);
        if (dobj.is_string()) {
            std::string dstr = dobj;
            lwsl_notice("#%d: %.*s\n", client->connection_number,
                        dstr.length(), dstr.c_str());
        }
        note_written = true;
    } else if (strcmp(name, "ECHO-URGENT") == 0) {
        json obj = json::parse(data, nullptr, false);
        if (obj.is_string()) {
            std::string str = obj;
            FOREACH_WSCLIENT(t, pclient) {
                printf_to_browser(t, URGENT_WRAP("%s"), str.c_str());
                lws_callback_on_writable(t->out_wsi);
            }
        }
    } else if (strcmp(name, "DRAG") == 0) {
        bool dstart = false, dend = false;
        int enter_or_leave = -1;
        int wnum = client->connection_number;
        if (strcmp(data, "start") == 0)
            dstart = true;
        else if (strcmp(data, "end") == 0)
            dend = true;
        else if (strcmp(data, "enter-window") == 0)
            enter_or_leave = 0;
        else if (strcmp(data, "leave-window") == 0)
            enter_or_leave = 1;
        if (dstart || dend) {
            struct tty_client *tother;
            FORALL_WSCLIENT(tother) {
                if (tother->main_window == 0 && tother != client) {
                    printf_to_browser(tother, URGENT_WRAP("\033[106;%dt"),
                                      dstart ? 1 : 2);
                    lws_callback_on_writable(tother->out_wsi);
                }
            }
            drag_start_window = dstart ? wnum : -1;
        }
        if (enter_or_leave >= 0) {
            current_dragover_window =
                enter_or_leave == 0 ? client->connection_number : -1;
            struct tty_client *dclient = tty_clients(drag_start_window);
            if (dclient && dclient->out_wsi) {
                 printf_to_browser(dclient, URGENT_WRAP("\033[106;%dt"),
                                   // enter: 4; leave: 5
                                   4 + enter_or_leave);
                lws_callback_on_writable(dclient->out_wsi);
            }
        }
    } else if (strcmp(name, "RECONNECT") == 0) {
        if (! options) {
            lwsl_err("RECONNECT with NULL options field\n");
            return true;
        }
        if (pclient) {
            lwsl_err("RECONNECT while already connected\n");
            return true;
        }
        std::string host_arg = get_setting_s(options->cmd_settings, REMOTE_HOSTUSER_KEY);
        reconnect(wsi, client, host_arg.c_str(), data);
        return true;
    } else {
    }
    return true;
}

tty_client::tty_client()
{
    this->initialized = -1;
    this->options = NULL;
    this->is_headless = false;
    this->is_primary_window = false;
    this->close_requested = false;
    this->keep_after_unexpected_close = false;
    this->detach_on_disconnect = true;
    this->detachSaveSend = false;
    this->uploadSettingsNeeded = true;
    this->requesting_contents = 0;
    this->wsi = NULL;
    this->out_wsi = NULL;
    this->version_info = NULL;
    this->main_window = -1;
    this->pclient = NULL;
    this->sent_count = 0;
    this->confirmed_count = 0;
    this->ob.extend(20000);
    this->ocount = 0;
    this->proxyMode = no_proxy; // FIXME
    this->wkind = unknown_window;
    this->connection_number = -1;
    this->pty_window_number = -1;
    this->pty_window_update_needed = false;
    this->ssh_connection_info = NULL;
    this->next_tclient = NULL;
    lwsl_notice("init_tclient_struct conn#%d\n",  this->connection_number);
}

/** Copy input (keyboard and events) from browser to pty/application.
 * The proxyMode specifies if the input is proxied through ssh.
 */

static int
handle_input(struct lws *wsi, struct tty_client *client,
             enum proxy_mode proxyMode)
{
    if (main_options->readonly)
        return 0;
    size_t clen = client->inb.len;
    unsigned char *msg = (unsigned char*) client->inb.buffer;
    struct pty_client *pclient = client->pclient;
    if (pclient)
        pclient->recent_tclient = client;
    // FIXME handle PENDING
    size_t start = 0;
    lwsl_info("handle_input len:%zu conn#%d pmode:%d pty:%d\n", clen, client->connection_number, proxyMode, pclient==NULL? -99 : pclient->pty);
    for (size_t i = 0; ; i++) {
        if (i == clen || msg[i] == REPORT_EVENT_PREFIX) {
            int w = i - start;
            if (w > 0)
                lwsl_notice(" -handle_input write start:%zu w:%d\n", start, w);
            if (w > 0 && pclient && write(pclient->pty, msg+start, w) < w) {
                lwsl_err("write INPUT to pty\n");
                return -1;
            }
            if (i == clen) {
                start = clen;
                break;
            }
            unsigned char* eol = (unsigned char*) memchr(msg+i, '\n', clen-i);
            if (eol && eol == msg+i+1
                && proxyMode != proxy_display_local) {
                /// Saw 0xFD '\n'. Write 0xFD.
                *eol = REPORT_EVENT_PREFIX;
                i = eol - msg - 1; // Sets start to eol index.
            } else if (eol) {
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
                           && strcmp(cname, "CLOSE-WINDOW") == 0)
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
        client->inb.reset();
    else
        client->inb.len = 0;
    return 0;
}

static int
handle_output(struct tty_client *client,  enum proxy_mode proxyMode, bool to_proxy)
{
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;

    if (client->proxyMode == proxy_command_local) {
        unsigned char *fd = (unsigned char *)
            memchr(client->ob.buffer, 0xFD, client->ob.len);
        lwsl_notice("check for FD: %p text[%.*s] pclient:%p\n", fd, (int) client->ob.len, client->ob.buffer, pclient);
        if (fd && pclient) {
            client->ob.len = 0; // FIXME - simplified
            struct termios termios;
            if (tcgetattr(pclient->pty, &termios) == 0) {
                termios.c_lflag &= ~(ICANON|ECHO);
                termios.c_oflag &= ~ONLCR;
                tcsetattr(pclient->pty, TCSANOW, &termios);
            }
            tty_restore(-1);
            //client->proxyMode = proxy_display_local;

            if (to_proxy) {
                clear_connection_number(client);
                display_session(client->options, pclient,
                                nullptr, dterminal_window);
                if (client->out_wsi && client->out_wsi != client->wsi) {
                    lwsl_notice("set_timeout clear tc:%p\n", client->wsi);
                    client->keep_after_unexpected_close = false;
                    lws_set_timeout(client->wsi,
                                    PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
                }
                client->out_wsi = NULL;
                maybe_daemonize();
#if PASS_STDFILES_UNIX_SOCKET
                if (pclient->cmd_socket >= 0) {
                    close(pclient->cmd_socket);
                    pclient->cmd_socket = -1;
                }
#endif
                if (client->options) {
                    client->options->fd_in = -1;
                    client->options->fd_out = -1;
                }
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
    sbuf sb;
    if (! to_proxy)
        sb.blank(LWS_PRE);
    if (client->uploadSettingsNeeded) { // proxyMode != proxy_local ???
        client->uploadSettingsNeeded = false;
        if (! settings_as_json.empty()) {
            sb.printf(URGENT_WRAP("\033]89;%s\007"), settings_as_json.c_str());
        }
    }
    if (client->initialized == 0 && proxyMode != proxy_command_local) {
        if (client->options && client->options->cmd_settings.is_object()) {
            sb.printf(URGENT_WRAP("\033]88;%s\007"),
                      client->options->cmd_settings.dump().c_str());
        } else {
            sb.printf(URGENT_WRAP("\033]88;{}\007"));
        }
        if (pclient && pclient->pid > 0) {
#define FORMAT_PID_SNUMBER "\033]31;%d\007"
#define FORMAT_SNAME "\033]30;%s\007"
            sb.printf(pclient->session_name
                      ? URGENT_WRAP(FORMAT_PID_SNUMBER FORMAT_SNAME)
                      : URGENT_WRAP(FORMAT_PID_SNUMBER),
                      pclient->pid,
                      pclient->session_name);
        }
        if (pclient && pclient->saved_window_contents != NULL) {
            int rcount = pclient->saved_window_sent_count;
            sb.printf(URGENT_WRAP("\033]103;%ld,%s\007"),
                      (long) rcount, (char *) pclient->saved_window_contents);
            client->sent_count = rcount;
            if (pclient->preserve_mode < 2) {
                free(pclient->saved_window_contents);
                pclient->saved_window_contents = NULL;
            }
        }
    }
    if ((client->initialized >> 1) == 0 && proxyMode != proxy_command_local
        && pclient && pclient->preserved_output != NULL) {
        size_t pstart = pclient->preserved_start;
        size_t pend = pclient->preserved_end;
        long read_count = pclient->preserved_sent_count + (pend - pstart);
        long rcount = client->sent_count;
        size_t unconfirmed = (read_count - rcount - client->ocount) & MASK28;
        if (unconfirmed > 0 && pend - pstart >= unconfirmed) {
            pstart = pend - unconfirmed;
            sb.append(start_replay_mode);
            sb.append(pclient->preserved_output+pstart,
                       (int) unconfirmed);
            sb.append(end_replay_mode);
            rcount += unconfirmed;
        }
        rcount = rcount & MASK28;
        client->sent_count = rcount;
        client->confirmed_count = rcount;
        sb.printf(OUT_OF_BAND_START_STRING "\033[96;%ld"
                  URGENT_END_STRING, rcount);
    }
    if (client->pty_window_update_needed
        && client->initialized >= 0
        && proxyMode != proxy_display_local
        && proxyMode != proxy_command_local) {
        client->pty_window_update_needed = false;
        int kind = proxyMode == proxy_display_local ? 2
            : ! pclient ? 0
            : (int) pclient->session_name_unique;
        sb.printf(URGENT_WRAP("\033[91;%d;%d;%d;%du"),
                  kind,
                  pclient ? pclient->session_number : 0,
                  client->pty_window_number+1,
                  client->connection_number);
    }
#if 0
    if (client->name_update_needed
        && client->initialized >= 0
        && proxyMode != proxy_display_local
        && proxyMode != proxy_command_local) {
        client->name_update_needed = false;
    }
#endif
    if (client->detachSaveSend) { // proxyMode != proxy_local ???
        int tcount = 0;
        FOREACH_WSCLIENT(tclient, pclient) {
            if (++tcount >= 2) break;
        }
        int code = tcount >= 2 ? 0 : pclient->detach_count != 0 ? 2 : 1;
        sb.printf(URGENT_WRAP("\033[82;%du"), code);
        client->detachSaveSend = false;
    }
    if (client->ob.len > 0) {
        //  // proxyMode != proxy_local ??? for count?
        client->sent_count = (client->sent_count + client->ocount) & MASK28;
        sb.append(client->ob);
        client->ocount = 0;
        if (client->ob.size > 40000) {
            client->ob.reset();
            client->ob.extend(20000);
        }
        client->ob.len = 0;
    }
    for (struct options *request = client->pending_requests.first();
         request != nullptr;
         request = client->pending_requests.next(request)) {
        std::string& crequest = request->unsent_request;
        if (! crequest.empty()) {
            sb.printf(URGENT_WRAP("\033]97;%s\007"), crequest.c_str());
            crequest = "";
        }
    }
    if (client->requesting_contents == 1) { // proxyMode != proxy_local ???
        sb.printf("%s", request_contents_message);
        client->requesting_contents = 2;
    }
    if (pclient==NULL)
        lwsl_notice("- empty pclient buf:%d for %p\n", client->ob.buffer != NULL, client);
    if (! pclient && client->wkind == dterminal_window
        && client->ob.buffer != NULL
        && proxyMode != proxy_command_local) {
        if (proxyMode != proxy_display_local) {
            client->keep_after_unexpected_close = false;
            sb.printf("%s", eof_message);
        }
        client->ob.reset();
    }

    if (client->initialized >= 0)
        client->initialized = 2;

    if (to_proxy) {
        if (sb.len > 0 && proxyMode == proxy_remote && client->options) {
            long output_timeout = client->options->remote_output_interval;
            if (output_timeout)
                lws_set_timer_usecs(client->out_wsi, output_timeout * (LWS_USEC_PER_SEC / 1000));
        }
        if (client->pclient == NULL) {
            lwsl_notice("proxy WRITABLE/close blen:%zu\n", sb.len);
        }
        // data in tclient->ob.
        size_t n = write(client->options->fd_out, sb.buffer, sb.len);
        lwsl_notice("proxy RAW_WRITEABLE %d len:%zu written:%zu pclient:%p\n",
                    client->options->fd_out, sb.len, n, client->pclient);
    } else {
        struct lws *wsi = client->wsi;
        int written = sb.len - LWS_PRE;
        lwsl_info("tty SERVER_WRITEABLE conn#%d written:%d sent: %ld to %p\n", client->connection_number, written, (long) client->sent_count, wsi);
        if (written > 0
            && lws_write(wsi, (unsigned char*) sb.buffer+LWS_PRE,
                         written, LWS_WRITE_BINARY) != written)
            lwsl_err("lws_write\n");
    }
    return to_proxy && client->pclient == NULL ? -1 : 0;
}

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
    ssize_t n;
    if (tclient==NULL)
        lwsl_info("callback_proxy wsi:%p reason:%d - no client\n", wsi, reason);
    else
        lwsl_info("callback_proxy wsi:%p reason:%d fd:%d conn#%d\n", wsi, reason, tclient==NULL||tclient->options==NULL? -99 : tclient->options->fd_in, tclient->connection_number);
    switch (reason) {
    case LWS_CALLBACK_RAW_CLOSE_FILE:
        lwsl_notice("proxy RAW_CLOSE_FILE\n");
        if (tclient->wsi == wsi)
            tclient->~tty_client();
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
        if (tclient->options->fd_in < 0) {
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
        tclient->inb.extend(1024);
        n = read(tclient->options->fd_in,
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
        if (tclient->options->fd_out < 0) {
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
        if (main_options->once && ! NO_TCLIENTS) {
            lwsl_notice("refuse to serve new client due to the --once option.\n");
            return -1;
        }
        break;

    case LWS_CALLBACK_ESTABLISHED: {
        lwsl_notice("tty/CALLBACK_ESTABLISHED client:%p\n", client);
        char arg[100]; // FIXME
        if (! check_server_key(wsi,
                               lws_get_urlarg_by_name(wsi, "server-key=", arg, sizeof(arg) - 1)))
            return -1;

        int main_window = -1;
        const char*main_window_arg = lws_get_urlarg_by_name(wsi, "main-window=", arg, sizeof(arg) - 1);
        if (main_window_arg != nullptr) {
            long snum;
            if (strcmp(main_window_arg, "true") == 0)
                main_window = 0;
             else if ((snum = strtol(main_window_arg, NULL, 10)) > 0) {
                 main_window = (int) snum;
             }
        }
        const char *reconnect_arg = lws_get_urlarg_by_name(wsi, "reconnect=", arg, sizeof(arg) - 1);
        long reconnect_value = reconnect_arg == NULL ? -1
            : strtol(reconnect_arg, NULL, 10);
        const char*window = lws_get_urlarg_by_name(wsi, "window=", arg, sizeof(arg) - 1);
        long wnum = window != nullptr ? strtol(window, nullptr, 10) : -1;
        const char *no_session = lws_get_urlarg_by_name(wsi, "no-session=", arg, sizeof(arg) - 1);
        if (no_session && strcmp(no_session, "top") == 0
            && main_window == 0 && main_windows.valid_index(wnum) ) {
            client = main_windows[wnum];
            if (tty_clients(wnum) == client)
                tty_clients.remove(client);
        } else if (wnum >= 0) {
            if (tty_clients.valid_index(wnum))
                client = tty_clients[wnum];
            else if (main_windows.valid_index(main_window)) {
                client = main_windows[main_window];
                main_windows.remove(client);
                struct tty_client *mclient = new tty_client();
                mclient->wkind = main_only_window;
                mclient->wsi = client->wsi;
                mclient->out_wsi = client->out_wsi;
                WSI_SET_TCLIENT(client->wsi, mclient);
                if (client->version_info)
                    mclient->version_info = strdup(client->version_info);
                mclient->main_window = 0;
                mclient->options = link_options(client->options);
                mclient->connection_number = main_windows.enter(mclient, main_window);
                tty_clients.enter(client, wnum);
            } else if (reconnect_value < 0) {
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
            client = new tty_client();
        }
        WSI_SET_TCLIENT(wsi, client);
        pclient = client->pclient;
        if (pclient == NULL) {
            const char*snumber = lws_get_urlarg_by_name(wsi, "session-number=", arg, sizeof(arg) - 1);
            if (snumber)
                pclient = pty_clients(strtol(snumber, NULL, 10));
        }
        client->wsi = wsi;
        client->out_wsi = wsi;
        client->main_window = main_window;
        if (main_window > 0 && client->options == NULL) {
            struct tty_client *main_client = main_windows(main_window);
            if (main_client != NULL && main_client->options) {
                client->options = link_options(main_client->options);
            }
        }
        const char*headless_arg = lws_get_urlarg_by_name(wsi, "headless=", arg, sizeof(arg) - 1);
        if (headless_arg && strcmp(headless_arg, "true") == 0)
            client->is_headless = true;

        if (no_session != NULL) {
            lwsl_info("dummy connection (no session) established\n");
        } else {
            if (pclient != NULL) {
                if (pclient->is_ssh_pclient)
                    client->proxyMode = proxy_display_local;
                if (client->pclient != pclient)
                    link_clients(client, pclient);
                link_command(wsi, client, pclient);
                lwsl_info("connection to existing session %d established\n", pclient->session_number);
            } else {
                const char*rsession = lws_get_urlarg_by_name(wsi, "rsession=", arg, sizeof(arg) - 1);
                long rsess;
                if (rsession && (rsess = strtol(rsession, NULL, 0)) > 0) {
                    char data[50];
                    sprintf(data, "%ld,%ld", rsess, reconnect_value);
                    const char *host_arg= lws_get_urlarg_by_name(wsi, "remote=", arg, sizeof(arg) - 1);
                    if (host_arg) {
                        reconnect(wsi, client, host_arg, data);
                        break;
                    }
                }

                arglist_t argv = default_command(main_options);
                char *cmd = find_in_path(argv[0]);
                if (cmd != NULL) {
                    pclient = create_pclient(cmd, argv, main_options, false, client);
                    link_command(wsi, client, pclient);
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

        // Defer start_pty so we can set up DOMTERM variable with version_info.

        if (main_options->verbosity > 0 || main_options->debug_level > 0) {
            char hostname[100];
            char address[50];
            lws_get_peer_addresses(wsi, lws_get_socket_fd(wsi),
                                   hostname, sizeof(hostname),
                                   address, sizeof(address));

            lwsl_notice("client connected from %s (%s), #: %d\n", hostname, address, client->connection_number);
        }
        break;
    }

    case LWS_CALLBACK_SERVER_WRITEABLE:
        return handle_output(client, client->proxyMode, false);

    case LWS_CALLBACK_RECEIVE:
        if (client == NULL) {
            lwsl_err("callback_tty (WS) LWS_CALLBACK_RECEIVE with null client\n");
            return -1;
        }
         // receive data from websockets client (browser)
         //fprintf(stderr, "callback_tty CALLBACK_RECEIVE len:%d\n", (int) len);
        client->inb.extend(len < 1024 ? 1024 : len + 1);
        client->inb.append((char *) in, len);
        //((unsigned char*)client->inb.buffer)[client->inb.len] = '\0'; // ??
        // check if there are more fragmented messages
        if (lws_remaining_packet_payload(wsi) <= 0
            && lws_is_final_fragment(wsi)) {
            handle_input(wsi, client, client->proxyMode);
        }
        break;

    case LWS_CALLBACK_CLOSED: {
        if (client == NULL)
            break;
         if (focused_client == client)
              focused_client = NULL;
#if ! BROKEN_LWS_SET_WSI_USER
         lws_set_wsi_user(wsi, NULL);
#endif
         bool keep_client = client->keep_after_unexpected_close && ! client->close_requested;
         if (keep_client) {
             client->wsi = NULL;
             client->out_wsi = NULL;
         } else {
             delete client;
         }
         lwsl_notice("client #:%d disconnected\n", client->connection_number);
         maybe_exit(0);
         break;
    }
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
    struct lws *pin_lws =
        lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC, fd,
                                   "proxy", NULL);
    struct tty_client *tclient =
        new (lws_wsi_user(pin_lws)) tty_client();
    set_connection_number(tclient, pclient ? pclient->session_number : -1);
    lwsl_notice("make_proxy in:%d out:%d mode:%d in-conn#%d pin-wsi:%p in-tname:%s\n", options->fd_in, options->fd_out, proxyMode, tclient->connection_number, pin_lws, ttyname(options->fd_in));
    tclient->proxyMode = proxyMode;
    link_clients(tclient, pclient);
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
        pout_lws = lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC, fd, "proxy-out", NULL);
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
    const char *s =  "\xFDREMOTE-WINDOW \n";
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
    if (browser_specifier != NULL && browser_specifier[0] == '-') {
      if (pclient != NULL && strcmp(browser_specifier, "--detached") == 0) {
          pclient->detach_count = 1;
          return EXIT_SUCCESS;
      }
      if (paneOp < 1 || paneOp > 13)
          paneOp = 0;
    }
    struct tty_client *tclient = nullptr;
    int wnum = -1;
    bool has_name = ! options->name_option.empty();
    struct tty_client *wclient = nullptr;
    if (paneOp > 0) {
        const char *eq = strchr(browser_specifier, '=');
        if (eq) {
            std::string wopt = eq + 1;
            int w = check_single_window_option(wopt, "(display)", options);
            if (w < 0) {
                printf_error(options, "invalid window specifier '%s' in '%s' option",
                             wopt.c_str(),
                             browser_specifier);
                return EXIT_FAILURE;
            }
            wclient = tty_clients(w);
        } else if (focused_client == NULL) {
            printf_error(options, "no current window for '%s' option",
                         browser_specifier);
            return EXIT_FAILURE;
        } else
            wclient = focused_client;
    }
    if (wkind != unknown_window) {
        tclient = new tty_client();
        if (paneOp > 0) {
            options->paneOp = -1;
            options->browser_command = "";
        }
        tclient->options = link_options(options);
        set_connection_number(tclient, pclient ? pclient->session_number : -1);
        if (paneOp <= 0)
            main_windows.enter(tclient, tclient->connection_number);
        tclient->wkind = wkind;
        if (wkind != browser_window && wkind != saved_window
            && url == NULL && pclient) {
            link_clients(tclient, pclient);
        } else if (wkind == browser_window) {
            if (url)
                tclient->description = url;
        }
        if (has_name) {
            tclient->set_window_name(options->name_option);
        } else if (pclient && ! pclient->saved_window_name.empty()) {
            has_name = true;
            tclient->set_window_name(pclient->saved_window_name);
        }
        wnum = tclient->connection_number;
    }
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
        char oldnum_buffer[12];
        oldnum_buffer[0] = 0;
        if (wclient->out_wsi == NULL) {
            int oldnum = wclient->connection_number;
            if (wclient->main_window == 0 || oldnum <= 0 || oldnum > 999999
                || (wclient = tty_clients(wclient->main_window)) == nullptr
                || wclient->out_wsi == nullptr) {
                printf_error(options, "No existing window %d", oldnum);
                return EXIT_FAILURE;
            }
            sprintf(oldnum_buffer, ",%d",oldnum);
        }
        printf_to_browser(wclient, URGENT_WRAP("\033]%d;%d%s,%s\007"),
                          104, paneOp, oldnum_buffer,
                          pane_options.dump().c_str());
        lws_callback_on_writable(wclient->out_wsi);
    } else {
        char *encoded = wkind == browser_window || wkind == saved_window
            ? url_encode(url, 0)
            : NULL;
        if (encoded)
            url = encoded;
        sbuf sb;
        if (wnum >= 0) {
            const char *main_url = main_html_url;
            sb.append(main_url);
            sb.append("#no-frames.html::"); // FIXME rename
            // Note we use ';' rather than the traditional '&' to separate parts
            // of the fragment.  Using '&' causes a mysterious bug (at
            // least on Electron, Qt, and Webview) when added "&js-verbosity=N".
            if (pclient != NULL) {
                sb.printf(";session-number=%d", pclient->session_number);
            }
            sb.printf(";window=%d", wnum);
            if (options->headless)
                sb.printf(";headless=true");
            std::string titlebar = get_setting_s(options->settings, "titlebar");
            if (! titlebar.empty())
                sb.printf(";titlebar=%s", url_encode(titlebar).c_str());
            std::string verbosity = get_setting_s(options->settings, "log.js-verbosity");
            if (! verbosity.empty()) // as OPTION_NUMBER_TYPE does not need encoding
                sb.printf(";js-verbosity=%s", verbosity.c_str());
            std::string js_string_max = get_setting_s(options->settings, "log.js-string-max");
            if (! js_string_max.empty()) // as OPTION_NUMBER_TYPE does not need encoding
                sb.printf(";log-string-max=%s", js_string_max.c_str());
            std::string slog_to_server = get_setting_s(options->settings, "log.js-to-server");
            const char *log_to_server = slog_to_server.empty() ? NULL
                : slog_to_server.c_str();
            if (log_to_server && (strcmp(log_to_server, "yes") == 0
                                  || strcmp(log_to_server, "true") == 0
                                  || strcmp(log_to_server, "both") == 0)) {
                sb.printf(";log-to-server=%s", log_to_server);
            }
            if (has_name) {
                sb.printf(tclient->window_name_unique ? ";wname-unique=%s"
                          : ";wname=%s",
                          url_encode(tclient->window_name).c_str());
            }
            if (wkind == saved_window)
                sb.printf(";view-saved=%s", url);
            else if (wkind == browser_window)
                sb.printf(";browse=%s", url);
        }
        else
            sb.printf("%s", url);
        if (encoded)
            free(encoded);
        if (browser_specifier
            && strcmp(browser_specifier, "--print-url") == 0) {
            sb.append("\n", 1);
            if (write(options->fd_out, sb.buffer, sb.len) <= 0)
                lwsl_err("write failed - display_session\n");
        } else
            r = do_run_browser(options, sb.null_terminated());
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
    int r = display_session(opts, pclient, nullptr, dterminal_window);
    if (r == EXIT_FAILURE) {
        lws_set_timeout(pclient->pty_wsi, PENDING_TIMEOUT_SHUTDOWN_FLUSH, LWS_TO_KILL_SYNC);
    }
#if 0
    else if (opts->session_name) {
        pclient->session_name = strdup(opts->session_name);
        opts->session_name = NULL;
    }
#endif
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
        pclient = pty_clients(snum);
    } else
        pclient = find_session(session_specifier);
    if (pclient == NULL) {
        printf_error(opts, "no session '%s' found", session_specifier);
        return EXIT_FAILURE;
    }
    if (pclient->is_ssh_pclient) {
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
    lwsl_notice("reattach sess:%d rcount:%ld\n", pclient->session_number, rcount);
    if (is_reattach) {
        struct tty_client *tclient = display_pipe_session(opts, pclient);
        tclient->confirmed_count = rcount;
        tclient->sent_count = rcount;
        tclient->initialized = 1;
        return EXIT_WAIT;
    }
    return display_session(opts, pclient, nullptr, dterminal_window);
}

int browse_action(int argc, arglist_t argv, struct lws *wsi, struct options *opts)
{
    optind = 1;
    // FIXME - note process_options looks for 'foo=value' which can be in URLs
    // process_options(argc, argv, opts);
    if (optind != argc-1) {
        FILE *err = fdopen(opts->fd_out, "w");
        fprintf(err, optind >= argc ? "domterm browse: missing url\n"
                : "domterm browse: more than one url\n");
        fclose(err);
        return EXIT_FAILURE;
    }
    const char *url = argv[optind];
    display_session(opts, NULL, url, browser_window);
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
    struct test_host_data *test_data = (struct test_host_data *) data;
    const char *at_in_clause = strchr(clause, '@');
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
        const char *p = t;
        for (;;) {
            const char *start = NULL;
            char *semi = (char*)
                extract_command_from_list(p, &start, NULL, NULL);
            if (*semi)
                *semi = 0;
            else
                semi = NULL;
            const char *command =
                check_conditional(p + (start-p), test_host_clause, &test_data);
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
    char *host_url;
    char *host_spec = NULL;
    if (strncmp(host_arg, "ssh://", 6) == 0) {
        host_url = strdup(host_arg);
        host_arg += 6;
    } else {
        // An ssh URL may not be of the form "ssh://@HOSTNAME".
        // So skip an initial '@' and then prepend "ssh://".
        const char *h = host_arg[0] == '@' ? host_arg + 1 : host_arg;
        char *tmp = challoc(strlen(h)+7);
        sprintf(tmp, "ssh://%s", h);
        host_url = tmp;
    }
    if (strchr(host_arg, '@') == NULL) {
        char *tmp = challoc(strlen(host_arg)+2);
        sprintf(tmp, "@%s", host_arg);
        host_spec = tmp;
    } else {
        host_spec = strdup(host_arg);
    }
    std::string ssh_cmd = get_setting_s(opts->settings, "command.ssh");
    char *ssh_expanded = expand_host_conditional(ssh_cmd.c_str(), host_spec);
    static const char *ssh_default = "ssh";
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
    std::string domterm_cmd = get_setting_s(opts->settings, "command.remote-domterm");
    char *dt_expanded = expand_host_conditional(domterm_cmd.c_str(), host_spec);
    if (dt_expanded == NULL)
        dt_expanded = strdup("domterm");
    argblob_t domterm_args = parse_args(dt_expanded, false);
    int domterm_argc = count_args(domterm_args);
    free(dt_expanded);

    int max_rargc = argc+ssh_argc+domterm_argc+8;
    const char** rargv = (const char**) xmalloc(sizeof(char*)*(max_rargc+1));
        int rargc = 0;
        for (int i = 0; i < ssh_argc; i++)
            rargv[rargc++] = ssh_args[i];
        rargv[rargc++] = host_url;
        for (int i = 0; i < domterm_argc; i++)
            rargv[rargc++] = domterm_args[i];
        rargv[rargc++] = "--browser-pipe";
        for (int i = 1; i < argc; i++)
            rargv[rargc++] = argv[i];
        if (rargc > max_rargc)
            fatal("too many arguments");
        rargv[rargc] = NULL;

        const char *dt = getenv_from_array((char*) "DOMTERM", opts->env);
        const char *tn;
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
        int tin = STDIN_FILENO;
        if (isatty(tin)) {
            tty_save_set_raw(tin);
        }
        struct pty_client *pclient = create_pclient(ssh, rargv, opts, true, tclient);

        // Create pipe for stderr from ssh.
        // This so we can separate ssh error messages from session output.
        int stderr_pipe[2];
        (void) pipe(stderr_pipe);
        lws_sock_file_fd_type lfd;
        lfd.filefd = stderr_pipe[0];
        struct lws *stderr_lws =
            lws_adopt_descriptor_vhost(vhost, LWS_ADOPT_RAW_FILE_DESC, lfd,
                                       "ssh-stderr", NULL);
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
        pclient->is_ssh_pclient = true;
        pclient->preserve_mode = 0;
        char tbuf[20];
        sprintf(tbuf, "%d", pclient->session_number);
        set_setting(opts->cmd_settings, LOCAL_SESSIONNUMBER_KEY, tbuf);
        set_setting(opts->cmd_settings, REMOTE_HOSTUSER_KEY, host_spec);
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
        free(host_spec);
        free(host_url);
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
    if (opts != main_options && ! opts->geometry_option.empty()) {
        main_options->geometry_option = opts->geometry_option;
        opts->geometry_option.clear();
    }
    const char *argv0 = argc > 0 ? argv[0] : "";
    struct command *command = argc == 0 ? NULL : find_command(argv0);
    int ret = 0;
    if (command != NULL) {
        lwsl_notice("handle command '%s'\n", command->name);
        ret = (*command->action)(argc, argv, wsi, opts);
    } else if (strchr(argv0, '@') != NULL || strncmp(argv0, "ssh://", 6) == 0) {
        handle_remote(argc, argv, opts, NULL);
        ret = EXIT_WAIT;
    } else if (argc == 0 || strchr(argv0, '/') != NULL) {
        ret = new_action(argc, argv, wsi, opts);
    } else {
        // normally caught earlier
        printf_error(opts, "domterm: unknown command '%s'", argv[0]);
        ret = EXIT_FAILURE;
    }
    // If --geometry specified position, make it one-time.
    int window_pos = main_options->geometry_option.find_first_of("+-");
    if (window_pos != std::string::npos) {
        main_options->geometry_option.erase(window_pos);
    }
    return ret;

}

int
handle_process_output(struct lws *wsi, struct pty_client *pclient,
                      int fd_in, struct stderr_client *stderr_client) {
            long min_unconfirmed = LONG_MAX;
            size_t avail = INT_MAX;
            int tclients_seen = 0;
            long last_sent_count = -1, last_confirmed_count = -1;
            FOREACH_WSCLIENT(tclient, pclient) {
                if (! tclient->out_wsi)
                    continue;
                tclients_seen++;
                last_sent_count = tclient->sent_count;
                last_confirmed_count = tclient->confirmed_count;
                long unconfirmed =
                  ((last_sent_count - last_confirmed_count) & MASK28)
                  + tclient->ocount;
                if (unconfirmed < min_unconfirmed)
                  min_unconfirmed = unconfirmed;
                size_t tavail = tclient->ob.size - tclient->ob.len;
                if (tavail < 5000) {
                    tclient->ob.extend(5000);
                    tavail = tclient->ob.size - tclient->ob.len;
                }
                if (tavail < avail)
                    avail = tavail;
            }
            if (min_unconfirmed >= MAX_UNCONFIRMED || avail == 0
                || pclient->paused) {
                if (! pclient->paused) {
#if USE_RXFLOW
                    lwsl_info(tclients_seen == 1
                              ? "session %d paused (flow control) %ld bytes ahead sent:%ld confirmed:%ld\n"
                              : tclients_seen == 0
                              ? "session %d paused (flow control) - awaiting clients\n"
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
                    if (! tclient->out_wsi)
                        continue;
                    if (data_start == NULL) {
                        data_start = tclient->ob.buffer+tclient->ob.len;
                        ssize_t n;
                        if (pclient->uses_packet_mode) {
#if USE_PTY_PACKET_MODE
                            // We know data_start > obuffer_raw, so
                            // it's safe to access data_start[-1].
                            char save_byte = data_start[-1];
                            n = read(fd_in, data_start-1, avail+1);
                            lwsl_info("RAW_RX pty %d session %d read %ld avail %ld tclient#%d\n",
                                      fd_in, pclient->session_number, (long) n, (long) avail, tclient->connection_number);
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
                                int data_old_length = tclient->ob.len;
                                tclient->ob.printf(
                                    URGENT_START_STRING "\033]71; %s %s",
                                    icanon_str, echo_str);
#if EXTPROC
                                if ((tio.c_lflag & EXTPROC) != 0)
                                    tclient->ob.append(" extproc");
#endif
                                if ((tio.c_lflag & ISIG) != 0) {
                                    int v = tio.c_cc[VINTR];
                                    if (v != _POSIX_VDISABLE)
                                        tclient->ob.printf(" intr=%d", v);
                                    v = tio.c_cc[VEOF];
                                    if (v != _POSIX_VDISABLE)
                                        tclient->ob.printf(" eof=%d", v);
                                    v = tio.c_cc[VSUSP];
                                    if (v != _POSIX_VDISABLE)
                                        tclient->ob.printf(" susp=%d", v);
                                    v = tio.c_cc[VQUIT];
                                    if (v != _POSIX_VDISABLE)
                                        tclient->ob.printf(" quit=%d", v);
                                }
                                tclient->ob.printf(
                                    " lflag:%lx\007" URGENT_END_STRING,
                                    (unsigned long) tio.c_lflag);
                                data_start = tclient->ob.buffer+data_old_length;
                                n = tclient->ob.len - data_old_length;
                                data_length = n;
                                tclient->ob.len -= n; // added back below
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
                    backup_output(pclient, data_start, read_length);
                }
            }
            return 0;
}

int
callback_pty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct pty_client *pclient = (struct pty_client *) user;
    switch (reason) {
    case LWS_CALLBACK_RAW_RX_FILE: {
            lwsl_info("callback_pty LWS_CALLBACK_RAW_RX_FILE wsi:%p len:%zu\n",
                      wsi, len);
            struct tty_client *tclient = pclient->first_tclient;
            if (pclient->is_ssh_pclient
                && tclient && tclient->options
                && tclient->options->remote_output_timeout) {
                lws_set_timer_usecs(wsi,
                                    tclient->options->remote_output_timeout
                                    * (LWS_USEC_PER_SEC / 1000));
            }
            return handle_process_output(wsi, pclient, pclient->pty, NULL);
    }
    case LWS_CALLBACK_TIMER:
            // If we're the local (client) end of ssh.
            lwsl_notice("callback_pty LWS_CALLBACK_TIMER\n");
            if (pclient->is_ssh_pclient) {
                pclient->timed_out = true;
                //pclient_close(pclient, true);
                //break;
                return -1;
            }
            break;
        case LWS_CALLBACK_RAW_CLOSE_FILE: {
            lwsl_notice("callback_pty LWS_CALLBACK_RAW_CLOSE_FILE\n");
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
    case LWS_CALLBACK_RAW_RX_FILE: {
        struct pty_client *pclient = sclient->pclient;
        if (!pclient)
        lwsl_notice("callback_ssh_stdin LWS_CALLBACK_RAW_RX_FILE sclient:%p pclient:%p\n", sclient, pclient);
        if (pclient) {
            struct tty_client *tclient = pclient->first_tclient;
            lwsl_notice("callback_ssh_stdin LWS_CALLBACK_RAW_RX_FILE sclient:%p pclient:%p tclient:%p\n", sclient, pclient, tclient);
            if (tclient && ! tclient->is_tclient_proxy()) {
                size_t buf_len = 2000;
                char *buf = challoc(buf_len);
                int nr = read(sclient->pipe_reader, buf, buf_len);
                lwsl_notice("- read %d\n", nr);
                if (nr > 0) {
                    json jstr = std::string(buf, nr);
                    printf_to_browser(tclient, URGENT_WRAP("\033]232;%s\007"),
                                      jstr.dump().c_str());
                    lws_callback_on_writable(tclient->out_wsi);
                }
                free(buf);
                return nr >= 0 ? 0 : -1;
            }
            return handle_process_output(wsi, pclient, sclient->pipe_reader, sclient);
        }
        return 0;
    }
    default:
        lwsl_notice("callback_ssh_stdin reason %d\n", reason);
        return 0;
   }
}

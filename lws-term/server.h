#include "version.h"

#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <fcntl.h>
#include <getopt.h>
#include <pthread.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <assert.h>
#include <json.h>

// True when enabling future proxy support
#define REMOTE_SSH 1
#define EXIT_WAIT (-2)

#ifdef __APPLE__
#include <util.h>
#elif defined(__FreeBSD__)
#include <libutil.h>
#else
#include <pty.h>
#endif

#include <libwebsockets.h>
#if HAVE_OPENSSL && !defined(LWS_OPENSSL_SUPPORT)
#undef HAVE_OPENSSL
#define HAVE_OPENSSL 0
#endif

#define BROKEN_LWS_SET_WSI_USER (LWS_LIBRARY_VERSION_MAJOR < 4)
#if BROKEN_LWS_SET_WSI_USER
#define WSI_GET_TCLIENT(WSI) (lws_wsi_user(WSI) ? *(struct tty_client**)lws_wsi_user(WSI) : NULL)
#define WSI_SET_TCLIENT(WSI, TCLIENT) (*(struct tty_client**)lws_wsi_user(WSI) = TCLIENT)
#else
#define WSI_GET_TCLIENT(WSI) ((struct tty_client*)lws_wsi_user(WSI))
#define WSI_SET_TCLIENT(WSI, TCLIENT) lws_set_wsi_user(WSI, TCLIENT)
#endif

#include "command-connect.h"

#include "utils.h"

#define SERVER_KEY_LENGTH 20
extern char server_key[SERVER_KEY_LENGTH];
extern char *main_html_url;
extern char *main_html_path;
extern char *backend_socket_name;
extern const char *settings_fname;
extern struct json_object *settings_json_object;
extern volatile bool force_exit;
extern struct lws *cmdwsi;
extern struct lws_context *context;
extern struct tty_server *server;
extern struct lws_vhost *vhost;

extern struct pty_client **pty_clients; // malloc'd array
extern int pty_clients_size; // number of allocated elements of pty_clients
#define VALID_SESSION_NUMBER(NUM) \
    ((NUM) > 0 && (NUM) < pty_clients_size && pty_clients[NUM] != NULL && pty_clients[NUM]->session_number == (NUM))
// Invariant for pty_clients array:
// If SNUM is valid then pty_clients[SNUM].session_number == SNUM.
// Otherwise (if SNUM is < pty_clients_size): pty_clients[SNUM] is points
// to NULL or the next valid element in pty_clients.
#define PCLIENT_FROM_NUMBER(NUM) \
    (VALID_SESSION_NUMBER(NUM) ? pty_clients[NUM] : NULL)

// tty_clients has similar invariants and logic as pty_clients
extern struct tty_client **tty_clients; // malloc'd array
extern int tty_clients_size; // number of allocated elements tty_clients
#define VALID_CONNECTION_NUMBER(NUM) \
    ((NUM) > 0 && (NUM) < tty_clients_size && tty_clients[NUM] != NULL && tty_clients[NUM]->connection_number == (NUM))
#define TCLIENT_FROM_NUMBER(NUM) \
    (VALID_CONNECTION_NUMBER(NUM) ? tty_clients[NUM] : NULL)

extern int http_port;
//extern struct tty_client *focused_client;
extern struct lws_context_creation_info info; // FIXME rename
extern struct lws *focused_wsi;
extern struct cmd_client *cclient;
extern struct options *main_options;
extern const char *settings_as_json; // FIXME
extern char git_describe[];
#if REMOTE_SSH
extern int
callback_proxy(struct lws *wsi, enum lws_callback_reasons reason,
                  void *user, void *in, size_t len);
extern int
callback_proxy_in(struct lws *wsi, enum lws_callback_reasons reason,
                  void *user, void *in, size_t len);
extern int
callback_proxy_out(struct lws *wsi, enum lws_callback_reasons reason,
                   void *user, void *in, size_t len);
#endif

/** The kind of connection (of a struct tty_client). */
enum proxy_mode {
    no_proxy = 0, //< No proxying - this is a WebSockets connection.
    proxy_command_local = 1, ///< proxying, between local shell and ssh
    proxy_display_local = 2, ///< proxying, between local display and ssh
    proxy_remote = 3 ///< Proxying, we're the remote end.
                     ///< Copy to/from ssh client and application (pty). */
};

enum option_name {
#define OPTION_S(NAME, STR, TYPE) NAME##_opt,
#define OPTION_F(NAME, STR, TYPE) NAME##_opt,
#include "option-names.h"
    NO_opt
#undef OPTION_S
#undef OPTION_F
};

enum pclient_flags {
    ssh_pclient_flag = 1,
    session_name_unique_flag = 2,
    packet_mode_flag = 4,
    timed_out_flag = 8
};
#define SET_PCLIENT_FLAG(PCLIENT, FLAG, VALUE) \
    ((VALUE) ? ((PCLIENT)->pflags |= (FLAG)) : ((PCLIENT)->pflags &= ~(FLAG)))

/**
 * Data specific to a pty process.
 * This is the user structure for the libwebsockets "pty" protocol.
 */
struct pty_client {
    int pid;
    int pty; // pty master
    int pty_slave;
    struct stderr_client *stderr_client;
    int session_number;
    char *session_name;
    int nrows, ncols;
    float pixh, pixw;
    enum pclient_flags pflags : 8;
    bool exit;
    // Number of "pending" re-attach after detach; -1 is allow infinite.
    int detach_count;
    int paused;
    struct tty_client *first_tclient;
    struct tty_client **last_tclient_ptr;
    struct lws *pty_wsi;
    struct tty_client *recent_tclient;
    char *saved_window_contents;
    long saved_window_sent_count; // corresponding to saved_window_contents
    char *ttyname;

    // The following are used to attach to already-visible session.
    char *preserved_output; // data send since window-contents request
    size_t preserved_start; // start of valid data in preserved_output
#define PRESERVE_MIN 0
    size_t preserved_end; // end of valid data in preserved_output
    size_t preserved_size; // allocated size of preserved_output

    // 1: preserve output since last confirmed (default); 2: preserve all
    int preserve_mode : 3;

    long preserved_sent_count;  // sent_count at preserved_output start
    // (Should be minumum of saved_window_sent_count (if saved_window_contents)
    // and miniumum of confirmed_count for each tclient.)

    const char *cmd;
    argblob_t argv;
#if REMOTE_SSH
    // Domain socket to communicate between client and (local) server.
    int cmd_socket;
    struct pty_client *cur_pclient;
#endif
};

struct stderr_client {
    struct lws *wsi;
    int pipe_reader;
    int pipe_writer;
    struct pty_client *pclient;
};

enum tclient_flags {
    //no_flags = 0,
    tclient_proxy_flag = 1,
    detach_on_disconnect_flag = 2,
    close_requested_flag = 4,
    headless_flag = 8
    //detach_requested_flag = 16,
};

/**
 * Data specific to a WebSocket (browser) client connection or a proxy stream.
 * The user structure for the libwebsockets "domterm" and "proxy" protocols.
 * The backback handler moves data to/from a paired pty_client pclient.
 */
struct tty_client {
    struct tty_client *next_tclient; // link in list headed by pty_client:first_tclient [an 'out' field]
    struct pty_client *pclient;
    struct options *options;

    /// Normally a tty_client wraps a bi-directional input/output file/socket.
    /// In some proxy modes we have distinct file descriptors for in and out.
    /// Hence we need two struct lws objects, but they share the same
    /// "user_data", a single tty_client object.
    /// If the file/socket is bi-directional, then 'wsi' == 'out_wsi'.
    /// Otherwise, 'wsi' handles reading from one descriptor (and writing
    /// to the pclient);
    /// 'out_wsi' handles writing (data that has been read from the
    /// pclient) to the other descriptor.
    /// An 'in' field is used in conjuction with 'wsi'.
    /// An 'out' field is used in conjuction with 'out_wsi'.
    struct lws *wsi;
    struct lws *out_wsi;

    // 0: Not initialized; 2: initialized
    // 1: reconnecting - client has state, but connection was dropped
    int initialized : 3;

    enum tclient_flags misc_flags;
    bool detachSaveSend; // need to send a detachSaveNeeded command
    bool uploadSettingsNeeded; // need to upload settings to client
    int main_window; // 0 if top-level, or number of main window
    enum proxy_mode proxyMode;

    // 1: attach requested - need to get contents from existing window
    // 2: sent window-contents request to browser
    char requesting_contents;

    char *version_info; // received from client [an 'in' field]
    // both sent_count and confirmed_count are modulo MASK28.
    long sent_count; // # bytes sent to (any) tty_client [an 'out' field]
    long confirmed_count; // # bytes confirmed received from (some) tty_client [an 'out' field]
    struct sbuf inb;  // input buffer (data/events from client) [an 'in' field]
    struct sbuf ob; // data to be sent to UI (or proxy)
    // (a mix of output from pty and from server) [an 'out' field]

    size_t ocount; // amount to increment sent_count (ocount <= ob.len)
    // (This is bytes read from pty output, and does not include
    // uncounted messages from the server.) [an 'out' field]

    int connection_number; // unique number
    int pty_window_number; // Numbered within each pty_client; -1 if only one
    bool pty_window_update_needed;
    int proxy_fd_in, proxy_fd_out;
    char *ssh_connection_info;
};

struct http_client {
    bool owns_data;
    char *data;
    char *ptr;
    int length;
};

struct cmd_client {
    int socket;
};
#define MASK28 0xfffffff

struct options {
    int reference_count;
    bool readonly;                            // whether not allow clients to write to the TTY
    bool headless;
    bool http_server;
    bool ssl;
    bool force_option;
    bool something_done;
    int do_daemonize;
    int verbosity;
    int debug_level;
    struct json_object *cmd_settings;
    struct json_object *settings; // merge of cmd_settings and global settings
    // Possible memory leak if we start recalim options objects.
    const char *browser_command;
    char *tty_packet_mode;
    int paneOp;
    char *iface;
#if HAVE_OPENSSL
    char *cert_path;
    char *key_path;
    char *ca_path;
#endif
    char *socket_name;
    bool check_origin;                        // whether allow websocket connection from different origin
    bool once;                                // whether accept only one client and exit on disconnection
    char *credential;                         // encoded basic auth credential
    int reconnect;                            // reconnect timeout
    int sig_code;                             // close signal
    char *sig_name;                           // human readable signal string
    char *qt_remote_debugging;
    int fd_in;
    int fd_out;
    int fd_err;
    int fd_cmd_socket;
    char *session_name;
    char *settings_file;
    argblob_t shell_argv;               // parse_args("shell.default" setting);
    const char*cwd; // use as current current dir; NULL means that of process
    argblob_t env; // environment to use; if NULL use that of process
    long remote_input_timeout; // remote-input-timeout setting, as ms
    long remote_output_timeout; // remote-output-timeout setting, as ms
    long remote_output_interval; // remote-output-timeout setting, as ms
};

struct tty_server {
    int client_count;                         // number of current_clients
    int session_count;                        // session count
    int connection_count;                     // clients requested (ever)
    bool client_can_close;
    char *socket_path;                        // UNIX domain socket path
    pthread_mutex_t lock;
    struct options options;
};

extern int
callback_http(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);

extern void initialize_resource_map(struct lws_context *, const char*);
extern void maybe_daemonize(void);
extern void do_exit(int, bool);

extern int
callback_tty(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);

extern int
callback_pty(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);
extern int
callback_cmd(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);
extern int
callback_inotify(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);
extern int
callback_ssh_stderr(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len);

#ifdef RESOURCE_DIR
extern char *get_resource_path();
#endif
extern int get_executable_directory_length();
extern char* get_executable_path();
extern char *get_bin_relative_path(const char* app_path);
const char *domterm_settings_default(void);
extern bool is_WindowsSubsystemForLinux(void);
extern int handle_command(int argc, arglist_t argv, struct lws *wsi,
                          struct options *opts);
extern int display_session(struct options *, struct pty_client *,
                           const char *, int);
extern int do_run_browser(struct options *, const char *url, int port);
extern int start_command(struct options *, char *cmd);
extern char* check_browser_specifier(const char *specifier);
extern void printf_to_browser(struct tty_client *, const char *, ...);
extern void fatal(const char *format, ...);
extern const char *find_home(void);
extern void init_options(struct options *options);
extern void destroy_options(struct options *options);
extern struct options *link_options(struct options *options);
extern void release_options(struct options *options);
extern const char *firefox_browser_command(struct options *options);
extern const char *chrome_command(bool app_mode, struct options *options);
extern void default_link_command(const char *url);
extern int process_options(int argc, arglist_t argv, struct options *options);
extern arglist_t default_command(struct options *opts);
extern void request_upload_settings();
extern void read_settings_file(struct options*, bool);
extern void read_settings_emit_notice();
extern struct json_object *merged_settings(struct json_object *cmd_settings);
extern void set_settings(struct options *options);
extern enum option_name lookup_option(const char *name);
extern const char *get_setting(json_object *opts, const char *key);
extern void set_setting(struct json_object **, const char *key, const char *val);
extern bool check_option_arg(const char *arg, struct options *opts);

// A "setting" that starts with "`" is an internal setting.
#define LOCAL_SESSIONNUMBER_KEY "`local-session-number"
#define REMOTE_HOSTUSER_KEY "`remote-host-user"
#define REMOTE_SESSIONNUMBER_KEY "`remote-session-number"

extern void watch_settings_file(void);
extern int probe_domterm(bool);
extern void check_domterm(struct options *);
extern void generate_random_string (char *buf, int nchars);
extern void tty_save_set_raw(int tty_in);
extern void tty_restore(int tty_in);
extern int get_tty_in();
extern int get_tty_out();
extern bool write_to_tty(const char *str, ssize_t len);
extern const char * get_mimetype(const char *file);
extern char *url_encode(const char *in, int mode);
extern void copy_file(FILE*in, FILE*out);
extern const char *getenv_from_array(char* key, arglist_t envarray);
extern void copy_html_file(FILE*in, FILE*out);
#define LIB_WHEN_SIMPLE 1
#define LIB_WHEN_OUTER 2
#define LIB_WHEN_NOFRAMES 4
#define LIB_AS_MODULE 8
extern void make_html_text(struct sbuf *obuf, int port, int options,
                           const char *body_text, int body_length);
extern int count_args(arglist_t);
extern argblob_t parse_args(const char*, bool);
extern char* parse_string(const char*, bool);
extern const char * maybe_quote_arg(const char *in);

#if COMPILED_IN_RESOURCES
struct resource {
  char *name;
  unsigned char *data;
  unsigned int length;
};
extern struct resource resources[];
#endif
#define FOREACH_PCLIENT(P) \
    for (struct pty_client *P = pty_clients == NULL ? NULL : pty_clients[1];\
         P != NULL;\
         P = pty_clients[P->session_number+1])
#define FOREACH_WSCLIENT(VAR, PCLIENT)      \
  for (struct tty_client *VAR = (PCLIENT)->first_tclient; VAR != NULL; \
       VAR = (VAR)->next_tclient)
#define TCLIENT_FIRST (tty_clients == NULL ? NULL : tty_clients[1])
#define TCLIENT_NEXT(VAR) (tty_clients[VAR->connection_number+1])
#define FORALL_WSCLIENT(VAR) \
    for (VAR = TCLIENT_FIRST; VAR != NULL; VAR = TCLIENT_NEXT(VAR))

// These are used to delimit "out-of-band" urgent messages.
#define URGENT_START_STRING "\023\026"
#define OUT_OF_BAND_START_STRING "\023"
#define URGENT_END_STRING "\024"

#define COMMAND_ALIAS 1
#define COMMAND_IN_CLIENT 2
#define COMMAND_IN_CLIENT_IF_NO_SERVER 4
#define COMMAND_IN_SERVER 8
#define COMMAND_CHECK_DOMTERM 16
#define REATTACH_COMMAND "INTERNAL-re-attach"

// 0xFD cannot appear in a UTF-8 sequence
#define REPORT_EVENT_PREFIX 0xFD

/* The procedure that executes a command.
 * The return value should be one of EXIT_SUCCESS, EXIT_FAILURE,
 * or EXIT_IN_SERVER (if executed by command).
 */
typedef int (*action_t)(int argc, arglist_t argv, struct lws *wsi,
                        struct options *opts);

struct command {
  const char *name;
  int options;
  action_t action;
};

extern struct command * find_command(const char *name);
extern int attach_action(int, arglist_t, struct lws *, struct options *);
extern int browse_action(int, arglist_t, struct lws *, struct options *);
extern int view_saved_action(int, arglist_t, struct lws *, struct options *);
extern int help_action(int, arglist_t, struct lws *, struct options *);
extern int new_action(int, arglist_t, struct lws *, struct options *);
extern void print_version(FILE*);
extern char*find_in_path();
extern void print_help(FILE*);
extern bool check_server_key(struct lws *wsi, char *arg, size_t alen);

#ifndef DOMTERM_DIR_RELATIVE
/* Data directory, relative to binary's parent directory.
   I.e. relative to $bindir/.. which is usually the same as $prefix,
   using autotools terminology. */
#define DOMTERM_DIR_RELATIVE "/share/domterm"
#endif

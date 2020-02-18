
// Set PASS_STDFILES_UNIX_SOCKET if passing file descriptors
// over socket from client command to server, using sendmsg/recvmsg.
// I can't get this to work on MacOS.
// Alternatively, multiplex stdout, stderr, and exit code on connection socket.
#define USING_NAMED_PIPES_FOR_CLIENT 0 /*for now*/
#if defined(__APPLE__) || defined(USING_NAMED_PIPES_FOR_CLIENT)
#define PASS_STDFILES_UNIX_SOCKET 0
// Multiplex stdout, stderr, and exit code on connection socket.
// Next byte is exit code.
#define PASS_STDFILES_EXIT_CODE '\001'
// Send following bytes to stdout.
#define PASS_STDFILES_SWITCH_TO_STDOUT '\002'
// Send following bytes to stderr.
#define PASS_STDFILES_SWITCH_TO_STDERR '\003'
//#define PASS_STDFILES_SWITCH_TO_STDERR_STRING "\003"
#else
#define PASS_STDFILES_UNIX_SOCKET 1
#endif

extern int client_connect (char *socket_path);
extern int client_send_command(int socket, int argc, char *const*argv,
                               char *const *env);
extern int create_command_socket(const char *);

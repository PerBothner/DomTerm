extern int client_connect (char *socket_path);
extern int client_send_command(int socket, int argc, char *const*argv,
                               char *const *env);
extern int create_command_socket(const char *);

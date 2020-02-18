/* Handle connect between client command and server command. */

#include "server.h"
#include "command-connect.h"

#include <sys/un.h>
#include <sys/uio.h>

char *backend_socket_name;
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

void
setblocking(int fd, int state)
{
    int mode = fcntl(fd, F_GETFL);
    if (mode != -1) {
        if (!state)
            mode |= O_NONBLOCK;
        else
            mode &= ~O_NONBLOCK;
        fcntl(fd, F_SETFL, mode);
    }
}

/* Create command server socket. */
int
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

#ifdef SOCK_CLOEXEC
#define SOCK_OPTIONS (SOCK_STREAM|SOCK_CLOEXEC)
#else
#define SOCK_OPTIONS (SOCK_STREAM)
#endif
    if ((fd = socket(AF_UNIX, SOCK_OPTIONS, 0)) == -1)
        return (-1);

    mask = umask(S_IXUSR|S_IRWXG|S_IRWXO);
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

static struct json_object *
state_to_json(int argc, char *const*argv, char *const *env)
{
    struct json_object *jobj = json_object_new_object();
    struct json_object *jargv = json_object_new_array();
    struct json_object *jenv = json_object_new_array();
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
    return jobj;
}

/* Try to connect to server.
 * Return socket or -1 if server not found.
 */
int
client_connect (char *socket_path)
{
    struct sockaddr_un      sa;
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
        fatal("cannot create client socket '%s' -> %s",
              socket_path, strerror(errno));
    int c = connect(fd, (struct sockaddr *)&sa, sizeof sa);
    lwsl_notice("connecting to server socket '%s': %s\n",
                socket_path,
                c == 0 ? "ok" : strerror(errno));
    if (c == 0)
        return fd;
    close(fd);
    return -1;
}

/** Send command from client to server, using socket. */
int
client_send_command(int socket, int argc, char *const*argv, char *const *env)
{
    json_object *jobj = state_to_json(argc, argv, env);
    const char *state_as_json = json_object_to_json_string_ext(jobj, JSON_C_TO_STRING_PLAIN);

    size_t jlen = strlen(state_as_json);

    struct iovec iov[2];
    iov[0].iov_base = (char*) state_as_json;
    iov[0].iov_len = jlen;
    iov[1].iov_base = "\f";
    iov[1].iov_len = 1;

#if PASS_STDFILES_UNIX_SOCKET
    struct msghdr msg;
    int myfds[3];
    myfds[0] = STDIN_FILENO;
    myfds[1] = STDOUT_FILENO;
    myfds[2] = STDERR_FILENO;
    union u { // for alignment
        char buf[CMSG_SPACE(sizeof myfds)];
        struct cmsghdr align;
    } u;
    msg.msg_control = u.buf;
    msg.msg_controllen = sizeof u.buf;
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
    cmsg->cmsg_len = CMSG_LEN(sizeof(int) * 3);
    memcpy(CMSG_DATA(cmsg), myfds, sizeof(int) * 3);
    msg.msg_controllen = cmsg->cmsg_len;
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type = SCM_RIGHTS;
    msg.msg_name = NULL;
    msg.msg_namelen = 0;
    msg.msg_iov = iov;
    msg.msg_iovlen = 2;
    msg.msg_flags = 0;
    errno = 0;
    lwsl_notice("sending command '%s' to server\n",
                argc ? argv[0] : "(implicit-new)");
    ssize_t n1 = sendmsg(socket, &msg, 0);
    close(STDIN_FILENO);
    close(STDOUT_FILENO);
    //don't close STDERR_FILENO, for the sake of lwsl_notice below
#else
    writev(socket, iov, 2);
#endif
    json_object_put(jobj);
    char ret = 0;
#if PASS_STDFILES_UNIX_SOCKET
    ssize_t n2 = read(socket, &ret, 1);
    if (n1 < 0 || n2 != 1)
        ret = -1;
#else
    size_t rsize = 512;
    unsigned char *rbuf = xmalloc(rsize);
    int cur_out = STDOUT_FILENO;
    for (;;) {
        int nr = read(socket, rbuf, rsize);
        if (nr <= 0)
	    break;
        int start = 0;
        for (int i = 0; ; i++) {
	    int ch = i >= nr ? -1 : rbuf[i];
            if (ch <= '\003') {
                if (i > start) {
                    if (cur_out < 0)
                        ret = rbuf[nr-1];
                    else
                        write(cur_out, rbuf+start, i-start);
                }
                if (ch < 0)
                    break;
                start = i+1;
                if (ch == PASS_STDFILES_SWITCH_TO_STDERR)
                    cur_out = STDERR_FILENO;
                else if (ch == PASS_STDFILES_SWITCH_TO_STDOUT)
                    cur_out = STDOUT_FILENO;
                else if (ch == PASS_STDFILES_EXIT_CODE)
                    cur_out = -1;
            }
        }
    }
#endif
    //if (close(socket) != 0)
    //  fatal("bad close of socket");
    close(socket);
    lwsl_notice("received exit code %d from server; exiting", ret);
    return ret;
}

int
callback_cmd(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct cmd_client *cclient = (struct cmd_client *) user;
    int socket;
    switch (reason) {
        case LWS_CALLBACK_RAW_RX_FILE:
            socket = cclient->socket;
            //fprintf(stderr, "callback_cmd RAW_RX reason:%d socket:%d getpid:%d\n", (int) reason, socket, getpid());
            struct sockaddr sa;
            socklen_t slen = sizeof sa;
#ifdef SOCK_CLOEXEC
            int sockfd = accept4(socket, &sa, &slen, SOCK_CLOEXEC);
#else
            int sockfd = accept(socket, &sa, &slen);
#endif
            size_t jblen = 512;
            char *jbuf = xmalloc(jblen);
            int jpos = 0;
            struct options opts;
            init_options(&opts);
            for (;;) {
                if (jblen-jpos < 512) {
                    jblen = (3 * jblen) >> 1;
                    jbuf = xrealloc(jbuf, jblen);
                }
#if PASS_STDFILES_UNIX_SOCKET
                struct msghdr msg;
                struct iovec iov;
                int myfds[3];
                union u { // for alignment
                    char buf[CMSG_SPACE(sizeof myfds)];
                    struct cmsghdr align;
                } u;
                msg.msg_control = u.buf;
                msg.msg_controllen = sizeof u.buf;
                struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
                cmsg->cmsg_len = CMSG_LEN(sizeof(int) * 3);
                iov.iov_base = jbuf+jpos;
                iov.iov_len = jblen-jpos;
                msg.msg_name = NULL;
                msg.msg_namelen = 0;
                msg.msg_iov = &iov;
                msg.msg_iovlen = 1;
                msg.msg_flags = 0;
                ssize_t n = recvmsg(sockfd, &msg, 0);
                if (msg.msg_controllen > 0) {
                    memcpy(myfds, CMSG_DATA(cmsg), 3*sizeof(int));
                    opts.fd_in = myfds[0];
                    opts.fd_out = myfds[1];
                    opts.fd_err = myfds[2];
                }
#else
#if 1
		struct pollfd pfd = { sockfd, POLLIN, 0 };
		poll(&pfd, 1, 3000); // FIXME needed?
#endif
		ssize_t n = read(sockfd, jbuf+jpos, jblen-jpos);
		opts.fd_out = sockfd;
		opts.fd_err = sockfd;
#endif
                if (n <= 0) {
                  break;
                } else if (jbuf[jpos+n-1] == '\f') {
                  jpos += n-1;
                  break;
                }
                jpos += n;
            }
            jbuf[jpos] = 0;
            //fprintf(stderr, "from-client: %d bytes '%.*s'\n", jpos, jpos, jbuf);
            struct json_object *jobj
              = json_tokener_parse(jbuf);
            if (jobj == NULL)
              fatal("json parse fail");
            struct json_object *jcwd = NULL;
            struct json_object *jargv = NULL;
            struct json_object *jenv = NULL;
            const char *cwd = NULL;
            // if (!json_object_object_get_ex(jobj, "cwd", &jcwd))
            //   fatal("jswon no cwd");
            int argc = -1;
            char **argv = NULL;
            char **env = NULL;
            if (json_object_object_get_ex(jobj, "cwd", &jcwd)
                && (cwd = strdup(json_object_get_string(jcwd))) != NULL) {
            }
            if (json_object_object_get_ex(jobj, "argv", &jargv)) {
                argc = json_object_array_length(jargv);
                argv = xmalloc(sizeof(char*) * (argc+1));
                for (int i = 0; i <argc; i++) {
                  argv[i] = strdup(json_object_get_string(json_object_array_get_idx(jargv, i)));
                }
                argv[argc] = NULL;
            }
            if (json_object_object_get_ex(jobj, "env", &jenv)) {
                int nenv = json_object_array_length(jenv);
                env = xmalloc(sizeof(char*) * (nenv+1));
                for (int i = 0; i <nenv; i++) {
                  env[i] = strdup(json_object_get_string(json_object_array_get_idx(jenv, i)));
                }
                env[nenv] = NULL;
            }
            json_object_put(jobj);
            optind = 1;
            process_options(argc, argv, &opts);
            int ret = handle_command(argc-optind, argv+optind,
                                     cwd, env, wsi, &opts);
            close(opts.fd_in);
            close(opts.fd_out);
            close(opts.fd_err);
            char r = (char) ret;
            if (write(sockfd, &r, 1) != 1)
                lwsl_err("write failed\n");
            close(sockfd);
            // FIXME: free argv, cwd, env
            break;
    default:
      //fprintf(stderr, "callback_cmd default reason:%d\n", (int) reason);
            break;
    }

    return 0;
}

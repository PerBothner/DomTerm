#include "server.h"

#define BUF_SIZE 1024

static char eof_message[] = "\033[99;99u";
#define eof_len (sizeof(eof_message)-1)

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
    // client preferences
    n = sprintf((char *) p, "%c%s", SET_PREFERENCES, server->prefs_json);
    if (lws_write(wsi, p, (size_t) n, LWS_WRITE_TEXT) < n) {
        return -1;
    }
#endif
    return 0;
}

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

void
tty_client_destroy(struct tty_client *client) {
    if (client->exit || client->pid <= 0)
        return;

    // stop event loop
    client->exit = true;

    // kill process and free resource
    lwsl_notice("sending %s to process %d\n", server->sig_name, client->pid);
    if (kill(client->pid, server->sig_code) != 0) {
        lwsl_err("kill: pid, errno: %d (%s)\n", client->pid, errno, strerror(errno));
    }
    int status;
    while (waitpid(client->pid, &status, 0) == -1 && errno == EINTR)
        ;
    lwsl_notice("process exited with code %d, pid: %d\n", status, client->pid);
    close(client->pty);

    // free the buffer
    if (client->buffer != NULL)
        free(client->buffer);
    if (client->version_info != NULL)
      free(client->version_info);

    // remove from clients list
    server->client_count--;
#if !USE_ADOPT_FILE
    pthread_mutex_lock(&server->lock);
    LIST_REMOVE(client, list);
    pthread_mutex_unlock(&server->lock);
#endif
}

static void
setWindowSize(struct tty_client *client)
{
    struct winsize ws;
    ws.ws_row = client->nrows;
    ws.ws_col = client->ncols;
    ws.ws_xpixel = (int) client->pixw;
    ws.ws_ypixel = (int) client->pixh;
    if (ioctl(client->pty, TIOCSWINSZ, &ws) < 0)
        lwsl_err("ioctl TIOCSWINSZ: %d (%s)\n", errno, strerror(errno));
}

void *
run_command
#if USE_ADOPT_FILE
(struct lws *wsi, struct tty_client *client)
#else
(void *args)
#endif
{
#if USE_ADOPT_FILE
    struct lws *outwsi;
#else
    struct tty_client *client = (struct tty_client *) args;
#endif
    int pty;
    int bytes;
    char buf[BUF_SIZE];
    fd_set des_set;

    pid_t pid = forkpty(&pty, NULL, NULL, NULL);

    switch (pid) {
        case -1: /* error */
            lwsl_err("forkpty\n");
            break;
        case 0: /* child */
            if (setenv("TERM", "xterm-256color", true) < 0) {
                perror("setenv");
                exit(1);
            }
            char* dinit = "DOMTERM=";
#ifdef LWS_LIBRARY_VERSION
#define SHOW_LWS_LIBRARY_VERSION "=" LWS_LIBRARY_VERSION
#else
#define SHOW_LWS_LIBRARY_VERSION ""
#endif
            const char *lstr = ";libwebsockets" SHOW_LWS_LIBRARY_VERSION;
            char* pinit = ";tty=";
            char* ttyName = ttyname(0);
            size_t dlen = strlen(dinit);
            size_t llen = strlen(lstr);
            size_t plen = strlen(pinit);
            int tlen = ttyName == NULL ? 0 : strlen(ttyName);
            char *version_info = client->version_info;
            int vlen = version_info == NULL ? 0 : strlen(version_info);
            int mlen = dlen + vlen + llen + (tlen > 0 ? plen + tlen : 0);
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
            ebuf[mlen] = '\0';
            putenv(ebuf);
            putenv("COLORTERM=truecolor");
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
                putenv(buf);
            }
#endif
            if (execvp(server->argv[0], server->argv) < 0) {
                perror("execvp");
                exit(1);
            }
            break;
        default: /* parent */
            lwsl_notice("started process, pid: %d\n", pid);
            client->pid = pid;
            client->pty = pty;
            if (client->nrows >= 0)
               setWindowSize(client);
#if USE_ADOPT_FILE
            lws_sock_file_fd_type fd;
            fd.filefd = pty;
            client->osize = 2048;
            client->obuffer = xmalloc(client->osize);
            client->olen = 0;
            client->pty_read_available = 0;
            client->sent_count = 0;
            client->confirmed_count = 0;
            client->paused = 0;
            outwsi = lws_adopt_descriptor_vhost(lws_get_vhost(wsi), 0, fd, "domterm", wsi);
            client->pty_wsi = outwsi;
            // lws_change_pollfd ??
            // FIXME do on end: tty_client_destroy(client);
#else
            while (!client->exit) {
                FD_ZERO (&des_set);
                FD_SET (pty, &des_set);

                if (select(pty + 1, &des_set, NULL, NULL, NULL) < 0) {
                    break;
                }

                if (FD_ISSET (pty, &des_set)) {
                    memset(buf, 0, BUF_SIZE);
                    bytes = (int) read(pty, buf, BUF_SIZE);
                    struct pty_data *frame = (struct pty_data *) xmalloc(sizeof(struct pty_data));
                    frame->len = bytes;
                    if (bytes > 0) {
                        frame->data = xmalloc((size_t) bytes);
                        memcpy(frame->data, buf, bytes);
                    } else if (client->eof_seen == 0)
                        client->eof_seen = 1;
                    pthread_mutex_lock(&client->lock);
                    STAILQ_INSERT_TAIL(&client->queue, frame, list);
                    pthread_mutex_unlock(&client->lock);
                }
            }
            tty_client_destroy(client);
#endif
            break;
    }

    return 0;
}

#if !USE_ADOPT_FILE
void
start_pty(struct tty_client *client)
{
    STAILQ_INIT(&client->queue);
    if (pthread_create(&client->thread, NULL, run_command, client) != 0) {
        lwsl_err("pthread_create\n");
        //return -1;
    }
}
#endif

void
reportEvent(const char *name, char *data, size_t dlen,
            struct lws *wsi, struct tty_client *client)
{
    // FIXME call reportEvent(cname, data)
    if (strcmp(name, "WS") == 0) {
        if (sscanf(data, "%d %d %g %g", &client->nrows, &client->ncols,
                   &client->pixh, &client->pixw) == 4) {
          if (client->pty >= 0)
            setWindowSize(client);
        }
    } else if (strcmp(name, "VERSION") == 0) {
        char *version_info = xmalloc(dlen+1);
        strcpy(version_info, data);
        client->version_info = version_info;
        if (! client->pty_started) {
          client->pty_started = true;
#if USE_ADOPT_FILE
          run_command(wsi, client);
#else
          start_pty(client);
#endif
        }
    } else if (strcmp(name, "RECEIVED") == 0) {
        long count;
        sscanf(data, "%ld", &count);
        //fprintf(stderr, "RECEIVED %ld sent:%ld\n", count, client->sent_count);
        client->confirmed_count = count;
        if (((client->sent_count - client->confirmed_count) & MASK28) < 1000
            && client->paused) {
          lws_rx_flow_control(client->pty_wsi, 1);
          client->paused = 0;
        }
    } else if (strcmp(name, "KEY") == 0) {
        char *q = strchr(data, '"');
        struct termios termios;
        if (tcgetattr(client->pty, &termios) < 0)
          ; //return -1;
        bool isCanon = (termios.c_lflag & ICANON) != 0;
        bool isEchoing = (termios.c_lflag & ECHO) != 0;
        json_object *obj = json_tokener_parse(q);
        const char *kstr = json_object_get_string(obj);
        int klen = json_object_get_string_len(obj);
        int kstr0 = klen != 1 ? -1 : kstr[0];
        if (isCanon && kstr0 != 3 && kstr0 != 4 && kstr0 != 26) {
            char tbuf[40];
            char *rbuf = dlen < 30 ? tbuf : xmalloc(dlen+10);
            sprintf(rbuf, "\033]%d;%.*s\007", isEchoing ? 74 : 73, dlen, data);
            size_t rlen = strlen(rbuf);
#if USE_ADOPT_FILE
            client->sent_count = (client->sent_count + rlen) & MASK28;
#endif
            if (lws_write(client->wsi, rbuf, rlen, LWS_WRITE_BINARY) < rlen)
                lwsl_err("lws_write\n");
            if (rbuf != tbuf)
                free (rbuf);
        } else {
          if (write(client->pty, kstr, klen) < klen)
             lwsl_err("write INPUT to pty\n");
        }
        json_object_put(obj);
    }
}

int
callback_tty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct tty_client *client = (struct tty_client *) user;
    //struct winsize *size;

    switch (reason) {
        case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION:
            //fprintf(stderr, "callback_tty FILTER_PROTOCOL_CONNECTION\n");
            if (server->once && server->client_count > 0) {
                lwsl_notice("refuse to serve new client due to the --once option.\n");
                return -1;
            }
#if 0
            if (server->check_origin && !check_host_origin(wsi)) {
                lwsl_notice("refuse to serve new client from different origin due to the --check-origin option.\n");
                return -1;
            }
#endif
            break;

        case LWS_CALLBACK_ESTABLISHED:
            //fprintf(stderr, "callback_tty CALLBACK_ESTABLISHED\n");
            client->exit = false;
            client->initialized = false;
            client->authenticated = false;
            client->wsi = wsi;
            client->buffer = NULL;
            client->version_info = NULL;
            client->pty = -1;
            client->nrows = -1;
            client->ncols = -1;
            client->pixh = -1;
            client->pixw = -1;
            lws_get_peer_addresses(wsi, lws_get_socket_fd(wsi),
                                   client->hostname, sizeof(client->hostname),
                                   client->address, sizeof(client->address));
            client->pty_started = false;
            client->eof_seen = 0;
            // Defer start_pty so we can set up DOMTERM variable with version_info.
            // start_pty(client);

#if USE_ADOPT_FILE
            server->client_count++;
#else
            pthread_mutex_lock(&server->lock);
            LIST_INSERT_HEAD(&server->clients, client, list);
            server->client_count++;
            pthread_mutex_unlock(&server->lock);
#endif

            lwsl_notice("client connected from %s (%s), total: %d\n", client->hostname, client->address, server->client_count);
            break;

#if USE_ADOPT_FILE
        case LWS_CALLBACK_RAW_RX_FILE: {
            long xsent;
            client = lws_wsi_user(lws_get_parent(wsi));
            xsent = (client->sent_count - client->confirmed_count) & MASK28;
            //fprintf(stderr, "callback_tty RAW_RX_FILE sent:%ld confirmed:%ld diff:%d\n",(int)client->sent_count, (int)client->confirmed_count, (int)xsent );
            size_t avail = client->osize - client->olen;
            if (xsent >= 2000 || client->paused) {
                //fprintf(stderr, "RX paused:%d\n", client->paused);
                client->paused = 1;
                break;
            }
            if (avail > 2500 - xsent)
              avail = 2500 - xsent;
            if (avail >= eof_len) {
                ssize_t n = read(client->pty, client->obuffer+client->olen,
                                 avail);
                if (n > 0)
                    client->olen += n;
                else if (client->eof_seen == 0) {
                    client->eof_seen = 1;
                    memcpy(client->obuffer+client->olen,
                           eof_message, eof_len);
                    client->olen += eof_len;
                }
            }
            ((struct tty_client *) lws_wsi_user(lws_get_parent(wsi)))
              ->pty_read_available = 1;
            lws_callback_on_writable(lws_get_parent(wsi));
        }
        break;
        case LWS_CALLBACK_RAW_CLOSE_FILE: {
            struct lws *parent_wsi = lws_get_parent(wsi);
            //fprintf(stderr, "callback_tty RAW_CLOSE_FILE eof-seen:%d\n", client->eof_seen);
            if (parent_wsi != NULL) {
                client = (struct tty_client *) lws_wsi_user(parent_wsi);
                if (client->eof_seen == 0)
                    client->eof_seen = 1;
                if (client->eof_seen < 2) {
                    client->eof_seen = 2;
                    memcpy(client->obuffer+client->olen,
                           eof_message, eof_len);
                    client->olen += eof_len;
                }
                lws_callback_on_writable(parent_wsi);
            }
        }
        break;
#endif
        case LWS_CALLBACK_SERVER_WRITEABLE:
            //fprintf(stderr, "callback_tty CALLBACK_SERVER_WRITEABLE init:%d eof:%d\n", client->initialized, client->eof_seen);
            if (!client->initialized) {
              //if (send_initial_message(wsi) < 0)
              //    return -1;
                client->initialized = true;
                //break;
            }
#if USE_ADOPT_FILE
            client->sent_count = (client->sent_count + client->olen) & MASK28;
             if (client->olen > 0) {
               //fprintf(stderr, "send %d sent:%ld\n", client->olen, client->sent_count);
              if (lws_write(wsi, client->obuffer, client->olen, LWS_WRITE_BINARY)
                  < client->olen) {
                    lwsl_err("lws_write\n");
                    break;
                }
                client->olen = 0;
            }
            if (! client->paused)
              lws_rx_flow_control(client->pty_wsi, 1);
#else
            pthread_mutex_lock(&client->lock);
            while (!STAILQ_EMPTY(&client->queue)) {
                struct pty_data *frame = STAILQ_FIRST(&client->queue);
                // read error or client exited, close connection
                if (frame->len <= 0) {
                    STAILQ_REMOVE_HEAD(&client->queue, list);
                    if (client->eof_seen == 1) {
                        if (lws_write(wsi, eof_message, eof_len,
                                      LWS_WRITE_BINARY) < eof_len) {
                          lwsl_err("lws_write\n");
                        }
                        client->eof_seen = 2;
                    } else {
                        free(frame);
                        return -1;
                    }
                    break;
                }

                if (lws_write(wsi, frame->data, frame->len, LWS_WRITE_BINARY) < frame->len) {
                    lwsl_err("lws_write\n");
                    break;
                }
                STAILQ_REMOVE_HEAD(&client->queue, list);
                free(frame->data);
                free(frame);

                if (lws_partial_buffered(wsi)) {
                    lws_callback_on_writable(wsi);
                    break;
                }
            }
            pthread_mutex_unlock(&client->lock);
#endif
            break;

        case LWS_CALLBACK_RECEIVE:
            //fprintf(stderr, "callback_tty CALLBACK_RECEIVE len:%d\n", (int) len);
            if (client->buffer == NULL) {
                client->buffer = xmalloc(len + 1);
                client->len = len;
                memcpy(client->buffer, in, len);
            } else {
                client->buffer = xrealloc(client->buffer, client->len + len + 1);
                memcpy(client->buffer + client->len, in, len);
                client->len += len;
            }
            client->buffer[client->len] = '\0';

            // check if there are more fragmented messages
            if (lws_remaining_packet_payload(wsi) > 0 || !lws_is_final_fragment(wsi)) {
                return 0;
            }

            if (server->readonly)
              return 0;
            size_t clen = client->len;
            unsigned char *msg = (unsigned char*) client->buffer;
            // FIXME handle PENDING
            int start = 0;
            for (int i = 0; ; i++) {
                if (i+1 == clen && msg[i] >= 128)
                    break;
                // 0x92 (utf-8 0xc2,0x92) "Private Use 2".
                if (i == clen || msg[i] == 0x92
                    || (msg[i] == 0xc2 && msg[i+1] == 0x92)) {
                    int w = i - start;
                    if (w > 0 && write(client->pty, msg+start, w) < w) {
                        lwsl_err("write INPUT to pty\n");
                        return -1;
                    }
                    if (i == clen) {
                        start = clen;
                        break;
                    }
                    // look for reported event
                    if (msg[i] == 0xc2)
                      i++;
                    unsigned char* eol = memchr(msg+i, '\n', clen-i);
                    if (eol) {
                        unsigned char *p = (char*) msg+i;
                        char* cname = (char*) ++p;
                        while (p < eol && *p != ' ')
                          p++;
                        *p = '\0';
                        if (p < eol)
                          p++;
                        while (p < eol && *p == ' ')
                          p++;
                        // data is from p to eol
                        char *data = (char*) p;
                        *eol = '\0';
                        size_t dlen = eol - p;
                        reportEvent(cname, data, dlen, wsi, client);
                        i = eol - msg;
                    } else {
                        break;
                    }
                    start = i+1;
                }
            }
            if (start < clen) {
              memmove(client->buffer, client->buffer+start, clen-start);
              client->len = clen - start;
            }
            else if (client->buffer != NULL) {
                free(client->buffer);
                client->buffer = NULL;
            }
            break;

        case LWS_CALLBACK_CLOSED:
            //fprintf(stderr, "callback_tty CALLBACK_CLOSED\n");
            tty_client_destroy(client);
            lwsl_notice("client disconnected from %s (%s), total: %d\n", client->hostname, client->address, server->client_count);
            if (server->once && server->client_count == 0) {
                lwsl_notice("exiting due to the --once option.\n");
                force_exit = true;
                lws_cancel_service(context);
                exit(0);
            }
            break;

        default:
            //fprintf(stderr, "callback_tty default reason:%d\n", (int) reason);
            break;
    }

    return 0;
}

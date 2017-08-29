#include "server.h"

#define BUF_SIZE 1024

extern char **environ;
static char eof_message[] = "\033[99;99u";
#define eof_len (sizeof(eof_message)-1)

struct per_vhost_data__domterm {
    struct pty_client *pty_client_list;
};

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
tty_client_destroy(struct lws *wsi, struct pty_client *client) {
    if (client->exit || client->pid <= 0)
        return;

    struct per_vhost_data__domterm *v =
      (struct per_vhost_data__domterm *)
      lws_protocol_vh_priv_get(lws_get_vhost(wsi),
                               lws_get_protocol(wsi));

    struct pty_client **p = &v->pty_client_list;
    for (;*p != NULL; p = &(*p)->next_pty_client) {
        if (*p == client) {
            *p = client->next_pty_client;
            break;
        }
    }

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
    if (client->obuffer == NULL)
      free(client->obuffer);
    // FIXME free client; set pclient to NULL in all matching tty_clients.

    // remove from clients list
    server->client_count--;
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

void *
run_command(struct lws *wsi, struct tty_client *tclient)
{
    struct lws *outwsi;
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
            //char **env = environ; /* by default */
            const char *lstr = ";libwebsockets" SHOW_LWS_LIBRARY_VERSION;
            char* pinit = ";tty=";
            char* ttyName = ttyname(0);
            char pidbuf[40];
            pid = getpid();
            size_t dlen = strlen(dinit);
            size_t llen = strlen(lstr);
            size_t plen = strlen(pinit);
            int tlen = ttyName == NULL ? 0 : strlen(ttyName);
            char *version_info = tclient->version_info;
            int vlen = version_info == NULL ? 0 : strlen(version_info);
            int mlen = dlen + vlen + llen + (tlen > 0 ? plen + tlen : 0);
            if (pid > 0) {
                sprintf(pidbuf, ";pid=%d", pid);
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
            /*if (execvpe(server->argv[0], server->argv, env) < 0) {*/
            if (execvp(server->argv[0], server->argv) < 0) {
                perror("execvp");
                exit(1);
            }
            break;
        default: /* parent */
            lwsl_notice("started process, pid: %d\n", pid);
            lws_sock_file_fd_type fd;
            fd.filefd = pty;
            outwsi = lws_adopt_descriptor_vhost(lws_get_vhost(wsi), 0, fd, "pty", NULL);
            struct pty_client *pclient = (struct pty_client *) lws_wsi_user(outwsi);
            struct per_vhost_data__domterm *v =
              (struct per_vhost_data__domterm *)
              lws_protocol_vh_priv_get(lws_get_vhost(wsi),
                                       lws_get_protocol(wsi));
            pclient->next_pty_client = v->pty_client_list;
            v->pty_client_list = pclient;

            tclient->pclient = pclient;
            tclient->next_client_wsi = pclient->first_client_wsi;
            pclient->first_client_wsi = wsi;

            pclient->pid = pid;
            pclient->pty = pty;
            pclient->nrows = -1;
            pclient->ncols = -1;
            pclient->pixh = -1;
            pclient->pixw = -1;
            pclient->eof_seen = 0;
            pclient->paused = 0;
            if (pclient->nrows >= 0)
               setWindowSize(pclient);
            pclient->osize = 2048;
            pclient->obuffer = xmalloc(pclient->osize);
            pclient->olen = 0;
            pclient->sent_count = 0;
            pclient->confirmed_count = 0;
            pclient->pty_wsi = outwsi;
            // lws_change_pollfd ??
            // FIXME do on end: tty_client_destroy(client);
            break;
    }

    return 0;
}

void
reportEvent(const char *name, char *data, size_t dlen,
            struct lws *wsi, struct tty_client *client)
{
    struct pty_client *pclient = client->pclient;
    // FIXME call reportEvent(cname, data)
    if (strcmp(name, "WS") == 0) {
        if (sscanf(data, "%d %d %g %g", &pclient->nrows, &pclient->ncols,
                   &pclient->pixh, &pclient->pixw) == 4) {
          if (pclient->pty >= 0)
            setWindowSize(pclient);
        }
    } else if (strcmp(name, "VERSION") == 0) {
        char *version_info = xmalloc(dlen+1);
        strcpy(version_info, data);
        client->version_info = version_info;
        if (pclient == NULL) {
          run_command(wsi, client);
        }
    } else if (strcmp(name, "RECEIVED") == 0) {
        long count;
        sscanf(data, "%ld", &count);
        //fprintf(stderr, "RECEIVED %ld sent:%ld\n", count, client->sent_count);
        pclient->confirmed_count = count;
        if (((pclient->sent_count - pclient->confirmed_count) & MASK28) < 1000
            && pclient->paused) {
          lws_rx_flow_control(pclient->pty_wsi, 1);
          pclient->paused = 0;
        }
    } else if (strcmp(name, "KEY") == 0) {
        char *q = strchr(data, '"');
        struct termios termios;
        if (tcgetattr(pclient->pty, &termios) < 0)
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
            pclient->sent_count = (pclient->sent_count + rlen) & MASK28;
            // FIXME per wsclient
            if (lws_write(client->wsi, rbuf, rlen, LWS_WRITE_BINARY) < rlen)
                lwsl_err("lws_write\n");
            if (rbuf != tbuf)
                free (rbuf);
        } else {
          int bytesAv;
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
    }
}

int
callback_tty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct tty_client *client = (struct tty_client *) user;
    struct pty_client *pclient = client == NULL ? NULL : client->pclient;
    //struct winsize *size;
    struct per_vhost_data__domterm *v =
                        (struct per_vhost_data__domterm *)
                        lws_protocol_vh_priv_get(lws_get_vhost(wsi),
                                        lws_get_protocol(wsi));

    switch (reason) {
        case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION:
            //fprintf(stderr, "callback_tty FILTER_PROTOCOL_CONNECTION\n");
            if (server->once && server->client_count > 0) {
                lwsl_notice("refuse to serve new client due to the --once option.\n");
                return -1;
            }
            break;

        case LWS_CALLBACK_ESTABLISHED:
            client->initialized = false;
            client->authenticated = false;
            client->wsi = wsi;
            client->buffer = NULL;
            client->version_info = NULL;
            client->pclient = NULL;
            client->osent = 0;
          {
            char arg[100]; // FIXME
            const char*connect_pid = lws_get_urlarg_by_name(wsi, "connect-pid", arg, sizeof(arg) - 1);
            int cpid = connect_pid == NULL ? -2 : strtol(connect_pid, NULL, 10);
            if (connect_pid != NULL && connect_pid[0] == '='
                && (cpid = strtol(connect_pid+1, NULL, 10)) != 0) {
              struct pty_client *pclient = v->pty_client_list;
              for (; pclient != NULL; pclient = pclient->next_pty_client) {
                if (pclient->pid == cpid) {
                  client->pclient = pclient;
                  client->next_client_wsi = pclient->first_client_wsi;
                  pclient->first_client_wsi = wsi;
                  break;
                }
              }
            }
          }
            lws_get_peer_addresses(wsi, lws_get_socket_fd(wsi),
                                   client->hostname, sizeof(client->hostname),
                                   client->address, sizeof(client->address));
            // Defer start_pty so we can set up DOMTERM variable with version_info.
            // start_pty(client);

            server->client_count++;

            lwsl_notice("client connected from %s (%s), total: %d\n", client->hostname, client->address, server->client_count);
            break;

        case LWS_CALLBACK_SERVER_WRITEABLE:
            //fprintf(stderr, "callback_tty CALLBACK_SERVER_WRITEABLE init:%d eof:%d\n", client->initialized, client->pclient->eof_seen);
            if (!client->initialized) {
              //if (send_initial_message(wsi) < 0)
              //    return -1;
                client->initialized = true;
                //break;
            }
            if (client->osent < pclient->olen) {
              //fprintf(stderr, "send %d sent:%ld\n", client->olen, client->sent_count);
              size_t dlen = pclient->olen - client->osent;
              if (lws_write(wsi, pclient->obuffer + client->osent,
                            dlen, LWS_WRITE_BINARY)
                  < dlen) {
                    lwsl_err("lws_write\n");
                    break;
                }
              client->osent += dlen;;
            }
            if (! pclient->paused)
              lws_rx_flow_control(pclient->pty_wsi, 1);
            break;

        case LWS_CALLBACK_RECEIVE:
            // receive data from websockets client (browser)
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
            struct pty_client *pclient = client->pclient;
            // FIXME handle PENDING
            int start = 0;
            for (int i = 0; ; i++) {
                if (i+1 == clen && msg[i] >= 128)
                    break;
                // 0x92 (utf-8 0xc2,0x92) "Private Use 2".
                if (i == clen || msg[i] == 0x92
                    || (msg[i] == 0xc2 && msg[i+1] == 0x92)) {
                    int w = i - start;
                    if (w > 0 && write(pclient->pty, msg+start, w) < w) {
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
            tty_client_destroy(wsi, client->pclient);
            lwsl_notice("client disconnected from %s (%s), total: %d\n", client->hostname, client->address, server->client_count);
            if (server->once && server->client_count == 0) {
                lwsl_notice("exiting due to the --once option.\n");
                force_exit = true;
                lws_cancel_service(context);
                exit(0);
            }
            if (client->version_info != NULL) {
                free(client->version_info);
                client->version_info = NULL;
            }
            if (client->buffer != NULL) {
                free(client->buffer);
                client->buffer = NULL;
            }
            break;

        case LWS_CALLBACK_PROTOCOL_INIT: /* per vhost */
              lws_protocol_vh_priv_zalloc(lws_get_vhost(wsi),
                                          lws_get_protocol(wsi),
                                          sizeof(struct per_vhost_data__domterm));
              break;

        case LWS_CALLBACK_PROTOCOL_DESTROY: /* per vhost */
            break;

    default:
            //fprintf(stderr, "callback_tty default reason:%d\n", (int) reason);
            break;
    }

    return 0;
}

int
callback_pty(struct lws *wsi, enum lws_callback_reasons reason,
             void *user, void *in, size_t len) {
    struct pty_client *pclient = (struct pty_client *) user;
    switch (reason) {
        case LWS_CALLBACK_RAW_RX_FILE: {
            struct lws *wsclient_wsi;
            long xsent = (pclient->sent_count - pclient->confirmed_count) & MASK28;
            size_t avail = pclient->osize - pclient->olen;
            if (xsent >= 2000 || pclient->paused) {
                //fprintf(stderr, "RX paused:%d\n", client->paused);
                pclient->paused = 1;
                break;
            }
            size_t min_osent = pclient->olen;
            FOREACH_WSCLIENT(wsclient_wsi, pclient) {
                struct tty_client *tclient = (struct tty_client *) lws_wsi_user(wsclient_wsi);
                if (tclient->osent <  min_osent)
                    min_osent = tclient->osent;
            }
            FOREACH_WSCLIENT(wsclient_wsi, pclient) {
                struct tty_client *tclient = (struct tty_client *) lws_wsi_user(wsclient_wsi);
                tclient->osent -= min_osent;
            }
            if (min_osent < pclient->olen) {
                memcpy(pclient->obuffer, pclient->obuffer+min_osent,
                       pclient->olen - min_osent);
            }
            pclient->olen -= min_osent;
            if (avail > 2500 - xsent)
              avail = 2500 - xsent;
            if (avail >= eof_len) {
                ssize_t n = read(pclient->pty, pclient->obuffer+pclient->olen,
                                 avail);
                if (n <= 0) {
                    n = 0;
                    if (pclient->eof_seen == 0) {
                        pclient->eof_seen = 1;
                        memcpy(pclient->obuffer+pclient->olen,
                               eof_message, eof_len);
                        n = eof_len;
                    }
                }
                pclient->olen += n;
                pclient->sent_count = (pclient->sent_count + n) & MASK28;
            }
            FOREACH_WSCLIENT(wsclient_wsi, pclient) {
              lws_callback_on_writable(wsclient_wsi);
            }
        }
        break;
        case LWS_CALLBACK_RAW_CLOSE_FILE: {
            struct lws *wsclient_wsi = pclient->first_client_wsi;
            while (wsclient_wsi != NULL) {
                struct tty_client *tclient = (struct tty_client *) lws_wsi_user(wsclient_wsi);
                if (pclient->eof_seen == 0)
                    pclient->eof_seen = 1;
                if (pclient->eof_seen < 2) {
                    pclient->eof_seen = 2;
                    memcpy(pclient->obuffer+pclient->olen,
                           eof_message, eof_len);
                    pclient->olen += eof_len;
                }
                lws_callback_on_writable(wsclient_wsi);
                wsclient_wsi = tclient->next_client_wsi;
            }
        }
        break;
    default:
            //fprintf(stderr, "callback_pty default reason:%d\n", (int) reason);
            break;
    }

    return 0;
}

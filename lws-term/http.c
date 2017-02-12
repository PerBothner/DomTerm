#include "server.h"
//#include "html.h"

#ifdef RESOURCE_DIR
static char *resource_path = NULL;
char *
get_resource_path()
{
  if (resource_path == NULL) {
      resource_path = RESOURCE_DIR;
      if (resource_path[0] != '/') {
          char *cmd_path = get_executable_path();
          int cmd_dir_length = get_executable_directory_length();
          char *buf = xmalloc(cmd_dir_length + strlen(resource_path) + 2);
          sprintf(buf, "%.*s/%s", cmd_dir_length, cmd_path, resource_path);
          resource_path = buf;
      }
  }
  return resource_path;
}
#endif

const char * get_mimetype(const char *file)
{
        int n = strlen(file);

        if (n < 5)
                return NULL;

        if (!strcmp(&file[n - 4], ".ico"))
                return "image/x-icon";

        if (!strcmp(&file[n - 4], ".png"))
                return "image/png";

        if (!strcmp(&file[n - 5], ".html"))
                return "text/html";

        if (!strcmp(&file[n - 4], ".css"))
                return "text/css";

        if (!strcmp(&file[n - 3], ".js"))
                return "text/javascript";

        return NULL;
}

int
check_auth(struct lws *wsi) {
    if (server->credential == NULL)
        return 0;

    int hdr_length = lws_hdr_total_length(wsi, WSI_TOKEN_HTTP_AUTHORIZATION);
    char buf[hdr_length + 1];
    int len = lws_hdr_copy(wsi, buf, sizeof(buf), WSI_TOKEN_HTTP_AUTHORIZATION);
    if (len > 0) {
        // extract base64 text from authorization header
        char *ptr = &buf[0];
        char *token, *b64_text = NULL;
        int i = 1;
        while ((token = strsep(&ptr, " ")) != NULL) {
            if (strlen(token) == 0)
                continue;
            if (i++ == 2) {
                b64_text = token;
                break;
            }
        }
        if (b64_text != NULL && !strcmp(b64_text, server->credential))
            return 0;
    }

    unsigned char buffer[1024 + LWS_PRE], *p, *end;
    p = buffer + LWS_PRE;
    end = p + sizeof(buffer) - LWS_PRE;

    if (lws_add_http_header_status(wsi, HTTP_STATUS_UNAUTHORIZED, &p, end))
        return 1;
    if (lws_add_http_header_by_token(wsi,
                                     WSI_TOKEN_HTTP_WWW_AUTHENTICATE,
                                     (unsigned char *) "Basic realm=\"ttyd\"",
                                     18, &p, end))
        return 1;
    if (lws_add_http_header_content_length(wsi, 0, &p, end))
        return 1;
    if (lws_finalize_http_header(wsi, &p, end))
        return 1;
    if (lws_write(wsi, buffer + LWS_PRE, p - (buffer + LWS_PRE), LWS_WRITE_HTTP_HEADERS) < 0)
        return 1;

    return -1;
}

int
callback_http(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len) {
    unsigned char buffer[4096 + LWS_PRE], *p, *end;
    char buf[256];

    switch (reason) {
        case LWS_CALLBACK_HTTP:
            {
                char name[100], rip[50];
                lws_get_peer_addresses(wsi, lws_get_socket_fd(wsi), name, sizeof(name), rip, sizeof(rip));
                lwsl_notice("HTTP connect from %s (%s), path: %s\n", name, rip, in);
            }

            if (len < 1) {
                lws_return_http_status(wsi, HTTP_STATUS_BAD_REQUEST, NULL);
                goto try_to_reuse;
            }

            switch (check_auth(wsi)) {
                case 0:
                    break;
                case -1:
                    goto try_to_reuse;
                case 1:
                default:
                    return 1;
            }

            // if a legal POST URL, let it continue and accept data
            if (lws_hdr_total_length(wsi, WSI_TOKEN_POST_URI))
                return 0;

            p = buffer + LWS_PRE;
            end = p + sizeof(buffer) - LWS_PRE;

            if (!strncmp((const char *) in, "/auth_token.js", 14)) {
                size_t n = server->credential != NULL ? sprintf(buf, "var tty_auth_token = '%s';", server->credential) : 0;

                if (lws_add_http_header_status(wsi, HTTP_STATUS_OK, &p, end))
                    return 1;
                if (lws_add_http_header_by_token(wsi,
                                                 WSI_TOKEN_HTTP_CONTENT_TYPE,
                                                 (unsigned char *) "application/javascript",
                                                 22, &p, end))
                    return 1;
                if (lws_add_http_header_content_length(wsi, (unsigned long) n, &p, end))
                    return 1;
                if (lws_finalize_http_header(wsi, &p, end))
                    return 1;
                if (lws_write(wsi, buffer + LWS_PRE, p - (buffer + LWS_PRE), LWS_WRITE_HTTP_HEADERS) < 0)
                    return 1;
                if (n > 0 && lws_write_http(wsi, buf, n) < 0) {
                    return 1;
                }
                goto try_to_reuse;
            }

            const char* fname  = in;
            if (fname == NULL || strcmp(fname, "/") == 0)
                fname = "/repl-client.html";
            const char* content_type = get_mimetype(fname);
            if (content_type == NULL)
              content_type = "text/html";
#if COMPILED_IN_RESOURCES
            struct resource *resource = &resources[0];
            while (resource->name != NULL && strcmp(resource->name, fname+1) != 0)
                resource++;
            if (resource->name != NULL) {
                if (lws_add_http_header_status(wsi, HTTP_STATUS_OK, &p, end))
                    return 1;
                if (lws_add_http_header_by_token(wsi, WSI_TOKEN_HTTP_CONTENT_TYPE,
                                                 (const unsigned char *) content_type,
                                                 strlen(content_type), &p, end)) // ???
                    return 1;
                if (lws_add_http_header_content_length(wsi,
                                                       resource->length, &p, end))
                    return 1;
                if (lws_finalize_http_header(wsi, &p, end))
                    return 1;
                if (lws_write(wsi, buffer + LWS_PRE, p - (buffer + LWS_PRE), LWS_WRITE_HTTP_HEADERS) < 0)
                    return 1;

                if (lws_write_http(wsi, resource->data, resource->length) < 0)
                    return 1;

            }
#else
            const char* resource_path = get_resource_path();
            size_t flen = strlen(resource_path) + strlen(fname) + 1;
            char *buf = malloc(flen);
            sprintf(buf, "%s%s", resource_path, fname);
            int n = lws_serve_http_file(wsi, buf, content_type, NULL, 0);
            // FIXME free buf when?
            if (n < 0 || (n > 0 && lws_http_transaction_completed(wsi)))
              return 1;
#endif
            lws_return_http_status(wsi, HTTP_STATUS_NOT_FOUND, NULL);
            goto try_to_reuse;

        case LWS_CALLBACK_OPENSSL_PERFORM_CLIENT_CERT_VERIFICATION:
            if (!len || (SSL_get_verify_result((SSL *) in) != X509_V_OK)) {
                int err = X509_STORE_CTX_get_error((X509_STORE_CTX *) user);
                int depth = X509_STORE_CTX_get_error_depth((X509_STORE_CTX *) user);
                const char *msg = X509_verify_cert_error_string(err);
                lwsl_err("client certificate verification error: %s (%d), depth: %d\n", msg, err, depth);
                return 1;
            }
            break;

        default:
            break;
    }

    return 0;

    /* if we're on HTTP1.1 or 2.0, will keep the idle connection alive */
    try_to_reuse:
    if (lws_http_transaction_completed(wsi))
        return -1;

    return 0;
}

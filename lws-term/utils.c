#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <ctype.h>
#include <string.h>
#include <signal.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include "whereami.h"

bool force_option = 0;

void *
xmalloc(size_t size) {
    if (size == 0)
        return NULL;
    void *p = malloc(size);
    if (!p)
        abort();
    return p;
}

void *
xrealloc(void *p, size_t size) {
    if ((size == 0) && (p == NULL))
        return NULL;
    p = realloc(p, size);
    if (!p)
        abort();
    return p;
}

char *
uppercase(char *str) {
    int i = 0;
    do {
        str[i] = (char) toupper(str[i]);
    } while (str[i++] != '\0');
    return str;
}

bool
endswith(const char * str, const char * suffix) {
    size_t str_len = strlen(str);
    size_t suffix_len = strlen(suffix);
    return str_len > suffix_len && !strcmp(str + (str_len - suffix_len), suffix);
}

int
get_sig_name(int sig, char *buf) {
    int n = sprintf(buf, "SIG%s", sig < NSIG ? strsignal(sig) : "unknown");
    uppercase(buf);
    return n;
}

int
get_sig(const char *sig_name) {
    if (strcasestr(sig_name, "sig") != sig_name || strlen(sig_name) <= 3) {
        return -1;
    }
    for (int sig = 1; sig < NSIG; sig++) {
        const char *name = strsignal(sig);
        if (strcasecmp(name, sig_name + 3) == 0)
            return sig;
    }
    return -1;
}

// https://github.com/darkk/redsocks/blob/master/base64.c
char *
base64_encode(const unsigned char *buffer, size_t length) {
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    char *ret, *dst;
    unsigned i_bits = 0;
    int i_shift = 0;
    int bytes_remaining = (int) length;

    ret = dst = xmalloc((size_t) (((length + 2) / 3 * 4) + 1));
    while (bytes_remaining) {
        i_bits = (i_bits << 8) + *buffer++;
        bytes_remaining--;
        i_shift += 8;

        do {
            *dst++ = b64[(i_bits << 6 >> i_shift) & 0x3f];
            i_shift -= 6;
        } while (i_shift > 6 || (bytes_remaining == 0 && i_shift > 0));
    }
    while ((dst - ret) & 3)
        *dst++ = '=';
    *dst = '\0';

    return ret;
}

static char *executable_path = NULL;
static int dirname_length;

char *
get_executable_path()
{
    if (executable_path == NULL) {
        int length = wai_getExecutablePath(NULL, 0, &dirname_length);
        executable_path = (char*) xmalloc(length + 1);
        wai_getExecutablePath(executable_path, length, &dirname_length);
        executable_path[length] = '\0';
    }
    return executable_path;
}

int
get_executable_directory_length()
{
    if (executable_path == NULL)
        (void) get_executable_path();
    return dirname_length;
}

static int tty_in = -1;
static int tty_out = -1;

/** Are we running under DomTerm?
 * Return 1 if true, 0 if else, -1 if error.
 */
int
probe_domterm ()
{
    /* probe if TERM unset, or contains "xterm", or DOMTERM is set */
    char *term_env = getenv("TERM");
    char *domterm_env = getenv("DOMTERM");
    if (! ((domterm_env && domterm_env[0])
           || term_env == NULL || term_env[0] == '\0'
           || strstr(term_env, "xterm") != NULL))
        return 0;

    if (tty_in < 0)
        tty_in = open("/dev/tty", O_RDONLY);
    if (tty_out < 0)
        tty_out = open("/dev/tty", O_WRONLY);
    int timeout = 1000;
    struct pollfd pfd;
    if (tty_in < 0 || tty_out < 0)
        return -1;
    int i = 0;
    char msg1[] = "\033[>0c";
    struct termios save_term;
    struct termios tmp_term;
    char response_prefix[] = "\033[>990;";
    int response_prefix_length = sizeof(response_prefix)-1;
    char buffer[50];
    // close(tty_out);
    pfd.fd = tty_in;
    pfd.events = POLLIN;
    pfd.revents = 0;
    int result = 1;
    tcgetattr(tty_in, &save_term);
    tmp_term = save_term;
    tmp_term.c_lflag &= ~(ICANON | ISIG | ECHO | ECHOCTL | ECHOE |      \
                          ECHOK | ECHOKE | ECHONL | ECHOPRT );
    tcsetattr(tty_in, TCSANOW, &tmp_term);

    if (write(tty_out, msg1, sizeof(msg1)-1) != sizeof(msg1)-1)
      return -1; // FIXME
    while (i < response_prefix_length) {
        int r = poll(&pfd, 1, timeout);
        if (r <= 0) { /* error or timeout */
            result = r;
            break;
        }
        r = read(tty_in, buffer+i, response_prefix_length-i);
        if (r <= 0) {
            result = -1;
            break;
        }
        i += r;
        if (i > 0 && memcmp(buffer, response_prefix, i) != 0) {
            result = 0;
            break;
        }
    }
    if (result >= 0) {
        for (;;) {
          if (read(tty_in, buffer, 1) <= 0) {
              result = -1;
              break;
          }
          if (buffer[0] == 'c')
              break;
        }
    }
    tcsetattr(tty_in, TCSANOW, &save_term);

    return result;
}

void
check_domterm ()
{
    if (force_option == 0 && probe_domterm() <= 0) {
        fprintf(stderr, "domterm: don't seem to be running under DomTerm - use --force to force");
        exit(-1);
    }
}

#define _GNU_SOURCE

#include "server.h"
#include "command-connect.h"

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <ctype.h>
#include <string.h>
#include <signal.h>
#include <poll.h>
#include <pwd.h>
#include <termios.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include "whereami.h"
#if HAVE_GETRANDOM
extern int getrandom(void *buf, size_t buflen, unsigned int flags);
#else
#include <time.h>
#endif

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
xstrdup(const char *s)
{
    if (s == NULL)
        return NULL;
    size_t len = strlen(s);
    char *r = xmalloc(len+1);
    strcpy(r, s);
    return r;
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

int count_args(arglist_t argv)
{
    int i = 0;
    while (argv[i])
        i++;
    return i;
}

static int hex_digit(int ch)
{
  if (ch >= '0' && ch <= '9')
    return ch - '0';
  if (ch >= 'a' && ch <= 'z')
    return ch - 'a' + 10;
  if (ch >= 'A' && ch <= 'Z')
    return ch - 'A' + 10;
  return -1;
}

static int count_hex_digits(const char *p, int max, int *valp)
{
  int i = 0;
  int val = 0;
  for (; i < max; i++) {
    int d = hex_digit(p[i]);
    if (d < 0)
      break;
    val = 16 * val + d;
  }
  if (valp)
    *valp = val;
  return i;
}

void*
parse_arg_string(const char *args, bool check_shell_specials, int dim)
{
    if (args == NULL)
        return NULL;
    int lengths = 0; // used for sum of strlen for all arguments
    int argc = 0;
    char *str = NULL;
    char **argv = NULL;
    char context = -1; // '\'', '"', 0 (in-word), or -1 (between words)
    for (int pass = 0; pass < 2; pass++) {
        // pass==0: calculate space needed; pass==1: fill in result array.
        const char *p = args;
        char *q = NULL;
        if (pass == 1) {
            if (dim == 0) { // create single string result
                str = xmalloc(lengths + (argc == 0 ? 1 :argc));
                q = (char*) str;
            } else { // create array of strings
                argv = xmalloc((argc+1) * sizeof(char*) + lengths + argc);
                q = (char*) &argv[argc+1];
            }
            context = -1;
            argc = 0;
        }
        for (;;) {
            int ch = *p++;
            if (ch == 0) {
                if (pass == 1 && (argc > 0 || dim == 0))
                    *q = '\0';
                break;
            }
            if (context <= 0 && (ch == ' ' || ch == '\t')) {
                context = -1;
                continue;
            }
            if (context < 0) {
                context = 0;
                if (pass == 1) {
                    if (dim != 0) {
                        if (argc > 0)
                            *q++ = '\0';
                        argv[argc] = q;
                    } else if (argc > 0)
                        *q++ = ' ';
                }
                argc++;
            }
            if ((ch == '\'' || ch == '"') && context <= 0) {
              context = ch;
              continue;
            } else if (ch == context && (ch == '\'' || ch == '"')) {
              context = 0;
              continue;
            } else if (ch == '\\' && *p) {
                ch = *p++;
                switch (ch) {
                case 'a': ch = '\007';  break;
                case 'b': ch = '\b';  break;
                case 'e': ch = '\033';  break;
                case 'f': ch = '\f';  break;
                case 'n': ch = '\n';  break;
                case 'r': ch = '\r';  break;
                case 't': ch = '\t';  break;
                case 'v': ch = '\v';  break;
                case '"':
                case '\\':
                case '/': // JSON
                    // ch = ch;
                    break;
		case 'u':
                    if (*p == '{') {
                        int hval = 0;
                        int nhex = count_hex_digits(p+1, 6, &hval);
                        if (nhex == 0 || p[nhex+1] != '}')
                            ; // ERROR
                        ch = hval;
                        p += nhex + 2;
                    } else {
                        int hval = 0;
                        int nhex = count_hex_digits(p, 4, &hval);
                        if (nhex != 4)
                            ; // ERROR
                        ch = hval;
                        p += nhex;
                    }
                    break;
                    // MAYBE \0 OCT OCT OCT
                    // MAYBE \x HEX HEX
                    // MAYBE \U HEX HEX HEX HEX HEX HEX HEX HEX
                    // MAYBE \ SP* NEWLINE - ignore
                default:
                    ;
                }
            } else if (check_shell_specials && pass == 0
                       && (ch == '$' || ch == '&' || ch == '|'
                           || ch == '<' || ch == '>')) {
                return NULL;
            }
            int nbytes = ch <= 0x7F ? 1 : ch <= 0x7FF ? 2
                : ch <= 0xFFFF ? 3 : 4;
            if (pass == 0) {
                lengths += nbytes;
            } else {
                if (nbytes <= 1)
                    *q++ = ch;
                else {
                    *q++ = (0xF0 << (4 - nbytes)) | (ch >> 6*(nbytes-1));
                    for (int i = 2; i <= nbytes; i++)
                        *q++ = 0x80 | ((ch >> 6*(nbytes-i)) & 0x3F);
                }
            }
        }
    }
    if (dim == 0)
        return str;
    else {
        argv[argc] = NULL;
        return argv;
    }
}

/* Parse an argument list (a list of possible-quoted "words").
 * This follows extended shell syntax.
 * If check_shell_specials is true and
 * args contains any of "&|<>$" *not* quoted, return NULL.
 * The result is a single buffer containing both the
 * pointers and all the strings.
 * To free the buffer, free the result of this function;
 * do not free any individual arguments.
 */
argblob_t
parse_args(const char *args, bool check_shell_specials)
{
    return (argblob_t) parse_arg_string(args, check_shell_specials, 1);
}

char*
parse_string(const char *args, bool check_shell_specials)
{
    return (char*) parse_arg_string(args, check_shell_specials, 0);
}

/** If 'in' has "special" characters, return 'in' surrounded by single-quotes.
 * If so, the result is freshly allocated; the original is unmodified.
 * A single quote in the input is surrounded by double-quotes.
 * If no special characters, return 'in' unchanged.
 */
const char *
maybe_quote_arg(const char *in)
{
    char *out = NULL;
    char *q = NULL;
    for (int pass = 0; pass < 2; pass++) {
        const char *p = in;
        int apos_count = 0;
        int bad_count = 0;
        for (;;) {
            int ch = *p++ & 0xFF;
            if (ch == 0)
                break;
            if (ch == '\'') {
                if (pass == 0)
                    apos_count++;
                else {
                    *q++ = '\'';
                    *q++ = '\"';
                    *q++ = '\'';
                    *q++ = '\"';
                    *q++ = '\'';
                }
            } else if ((ch >= 'a' && ch <= 'z')
                       || (ch >= 'A' && ch <= 'Z')
                       || (ch >= '0' && ch <= '9')
                       || ch == '/' || ch == '_' || ch == '-' || ch == '.'
                       || ch >= 128) {
                if (pass > 0)
                    *q++ = ch;
            } else {
                if (pass == 0)
                    bad_count++;
                else
                    *q++ = ch;
            }
            if (apos_count + bad_count == 0)
                return in;
            if (pass == 0) {
                size_t in_size = (char*) p - in;
                out = xmalloc(in_size + 5 * apos_count + 3);
                q = out;
                *q++ = '\'';
            } else {
                *q++ = '\'';
                *q = 0;
                break;
            }
        }
    }
    return out;
}

/* Returns either NULL or a freshly malloc'd urlencoding of 'in'. */
char *
url_encode(const char *in, int mode)
{
    static unsigned char b16[] = "0123456789ABCDEF";
    int bad_count = 0;
    char *out = NULL;
    for (int pass = 0; pass < 2; pass++) {
        const char *p = in;
        char *q = out;
        while (*p) {
            int ch = *p++;
            bool ok = (ch >= '0' && ch <= '9')
              || (ch >= 'a' && ch < 'z')
              || (ch >= 'A' && ch < 'Z')
              || (ch == '/') /* may depend on mode */
              || (ch == '.' || ch == '-' || ch == '_'  || ch == '*');
            if (pass == 0) {
                if (! ok)
                  bad_count++;
            } else {
                if (ok)
                  *q++ = ch;
                else {
                    *q++ = '%';
                    *q++ = b16[(ch>>4) & 0xF];
                    *q++ = b16[ch & 0xF];
                }
            }
        }
        if (pass == 0) {
            if (bad_count == 0)
                return NULL;
            size_t in_size = (char*) p - in;
            out = xmalloc(in_size + 2 * bad_count + 1);
        } else
            *q = 0;
    }
    return out;
}

/* Create a copy of an array os strings (as in argv or environ)
 * The result is a one malloc'd "blob" to be free'd with a single call to free.
 */
argblob_t
copy_strings(const char*const* strs)
{
    size_t ndata = 0;
    size_t nstrs = 0;
    const char*const* s = strs;
    for (; *s; s++) {
        nstrs++;
        ndata += strlen(*s) + 1;
    }
    size_t hsize = sizeof(char*) * (nstrs+1);
    char** r = xmalloc(hsize + ndata);
    s = strs;
    char *d = (char*)r  + hsize;
    char** t = r;
    for (;*s; s++) {
        strcpy(d, *s);
        *t++ = d;
        d += strlen(d) + 1;
    }
    *t = NULL;
    return (argblob_t) r;
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

static struct termios save_term;
static int tty_raw_fd = -1;
static bool atexit_restore_registered = false;

static void atexit_restore(void)
{
    tty_restore(-1);
}

void
tty_save_set_raw(int tty_in)
{
    struct termios tmp_term;
    tcgetattr(tty_in, &save_term);
    tmp_term = save_term;
    tmp_term.c_lflag &= ~(ICANON | ISIG | ECHO | ECHOCTL | ECHOE |
                          ECHOK | ECHOKE | ECHONL | ECHOPRT);
    tcsetattr(tty_in, TCSANOW, &tmp_term);
    tty_raw_fd = tty_in;
    if (! atexit_restore_registered) {
        atexit(atexit_restore);
        atexit_restore_registered = true;
    }
}

void tty_restore(int tty_in)
{
    if (tty_in < 0)
        tty_in = tty_raw_fd;
    if (tty_in >= 0) {
        int r = tcsetattr(tty_in, TCSANOW, &save_term);
    }
    tty_raw_fd = -1;
}

int
get_tty_in()
{
    if (tty_in < 0)
        tty_in = open("/dev/tty", O_RDONLY);
    return tty_in;
}

int
get_tty_out()
{
    if (tty_out < 0)
        tty_out = open("/dev/tty", O_WRONLY);
    return tty_out;
}

bool
write_to_tty(const char *str, ssize_t len)
{
    if (len == -1)
        len = strlen(str);
    return write(get_tty_out(), str, len) == len;
}

/** Are we running under DomTerm?
 * Return 1 if true, 0 if else, -1 if error.
 */
int
probe_domterm(bool use_stdout)
{
    /* probe if TERM unset, or contains "xterm", or DOMTERM is set */
    char *term_env = getenv("TERM");
    char *domterm_env = getenv("DOMTERM");
    if (! ((domterm_env && domterm_env[0])
           || term_env == NULL || term_env[0] == '\0'
           || strstr(term_env, "xterm") != NULL))
        return 0;

    int tin = use_stdout ? 0 : get_tty_in();
    int tout = use_stdout ? 1 : get_tty_out();
    int timeout = 1000;
    struct pollfd pfd;
    if (tin < 0 || tout < 0)
        return -1;
    if (! isatty(tin) || ! isatty(tout))
        return 0;
    int i = 0;
    char msg1[] = "\033[>0c";
    //struct termios save_term;
    char response_prefix[] = "\033[>990;";
    int response_prefix_length = sizeof(response_prefix)-1;
    char buffer[50];
    // close(tout);
    pfd.fd = tin;
    pfd.events = POLLIN;
    pfd.revents = 0;
    int result = 1;
    tty_save_set_raw(tin);

    if (write(tout, msg1, sizeof(msg1)-1) != sizeof(msg1)-1)
      return -1; // FIXME
    int match = 0;
    while (i < response_prefix_length && result > 0) {
        int r = poll(&pfd, 1, timeout);
        if (r <= 0) { /* error or timeout */
            result = r;
            break;
        }
        r = read(tin, buffer+i, response_prefix_length-i);
        if (r <= 0) {
            result = -1;
            break;
        }
        i += r;
        while (match < i && result > 0) {
            if (buffer[match] == response_prefix[match])
                match++;
            else
                result = 0;
        }
    }
    if (match >= 3 && memchr(buffer, 'c', i) == NULL) {
        // We got a valid but non-matching response.
        // Scan until we see the final 'c'.
        for (;;) {
          if (read(tin, buffer, 1) <= 0) {
              result = -1;
              break;
          }
          if (buffer[0] == 'c')
              break;
        }
    }
    tty_restore(tin);
    return result;
}

void
check_domterm(struct options *opts)
{
    if (opts->force_option == 0 && probe_domterm(false) <= 0) {
        fprintf(stderr, "domterm: don't seem to be running under DomTerm - use --force to force\n");
        exit(-1);
    }
}

const char *
find_home(void)
{
        struct passwd           *pw;
        static const char       *home;

        if (home != NULL)
                return (home);

        home = getenv("HOME");
        if (home == NULL || *home == '\0') {
                pw = getpwuid(getuid());
                if (pw != NULL)
                        home = pw->pw_dir;
                else
                        home = NULL;
        }

        return (home);
}

void
generate_random_string (char *buf, int nchars)
{
    static char wchars[] =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
#if HAVE_GETRANDOM
    getrandom(buf, nchars, 0);
    // This "wastes" 2 bits per byte in the result from get random.
    // We can avoid this by calling getrandom with ceiling(nchars*6 / 8),
    // and the getting 6 bits a time from getrandom result.
    for (int i = nchars; --i >= 0; )
        buf[i] = wchars[buf[i] & 0x3F];
#else
    static int srand_called = 0;
    if (! srand_called) {
        srand(time(NULL));
        srand_called = 1;
    }
    for (int i = nchars; --i >= 0; )
        buf[i] = wchars[rand() & 0x3F];
#endif
}

void copy_file(FILE*in, FILE*out)
{
    char buffer[1024];
    for (;;) {
        int r = fread(buffer, 1, sizeof(buffer), in);
        if (r <= 0 || fwrite(buffer, 1, r, out) <= 0)
            break;
    }
}

/** Look for a 'command' in list.
 * A command is any string ending in a *non-quoted* ';' or '\n' or end of string.
 * Returns the end of the command.
 * If startp is non-NULL, it is set to the first non-whitespace char.
 * If endp is non-NULL it is the end of the command without trailing whitespace.
 * If cmd_endp is non-NULL it is set to the end of an initial "command" -
 *   i.e. first whitespace char or same as endp.
 */
const char *
extract_command_from_list(const char *list, const char **startp,
                          const char **endp, const char **cmd_endp)
{
    const char *p = list;
    while (*p && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n'))
        p++;
    if (startp)
        *startp = p;
    const char *cmd_end = NULL;
    char context = 0; // '\'', '"', or 0
    for (;; p++) {
        char ch = *p;
        if (ch == context && context > 0)
            context = 0;
        else if (context == 0 && (ch == '\'' || ch == '"')) {
            context = ch;
        } else if (ch == 0 || (context == 0 && (ch == ';' || ch == '\n'))) {
            if (cmd_end == NULL)
                cmd_end = p;
            break;
        } else if (cmd_end == NULL
                   && (ch == ' ' || ch == '\t' || ch == '\r'))
            cmd_end = p;
    }
    if (endp) {
        const char *end = p;
        while (end > list && (end[-1] == ' '|| end[-1]=='\t'))
            end--;
        *endp = end;
    }
    if (cmd_endp)
        *cmd_endp = cmd_end;
    return p;
}

// Check a 'template' (conditional string) that initial clauses match.
// On match return rest of string after clauses.
// 'template' is temporarily modified
char *
check_conditional(char *template, test_function_t tester, void* data)
{
    int size = 0;
    while (template[0] == '{') {
        // a disjunction of clauses, separated by '|'
        bool ok = false; // true when a previous clause was true
        char *clause = &template[1];
        for (char *p = clause; ; p++) {
            char ch = *p;
            if (ch == '\0')
              return NULL;
            if (ch == '|' || ch == '}') {
                if (! ok) {
                    bool negate = *clause=='!';
                    if (negate)
                      clause++;
                    int clen = p - clause;
                    *p = '\0';
                    ok = tester(clause, data);
                    *p = ch;
                    if (negate)
                        ok = ! ok;
                }
                clause = p + 1;
            }
            if (ch == '}') {
              if (! ok)
                return NULL;
              template = clause;
              break;
            }
        }
    }
    return template[0] ? template : NULL;
}

const char *
getenv_from_array(char* key, arglist_t envarray)
{
    extern char **environ;  // Needed on MacOS.
    arglist_t p = envarray ? envarray : (arglist_t)environ;
    int keylen = strlen(key);
    for (; *p; p++) {
        const char *e = *p;
        if (memcmp(e, key, keylen) == 0
            && e[keylen] == '=')
            return e + keylen + 1;
    }
    return NULL;
}

void sbuf_init(struct sbuf *buf)
{
    buf->buffer = NULL;
    buf->len = 0;
    buf->size = 0;
}

void sbuf_free(struct sbuf *buf)
{
    if (buf->buffer != NULL)
        free(buf->buffer);
    sbuf_init(buf);
}

char *sbuf_strdup(struct sbuf *buf)
{
    size_t len = buf->len;
    char *r = xmalloc(len + 1);
    memcpy(r, buf->buffer, len);
    r[len] = '\0';
    return r;
}

void
sbuf_extend(struct sbuf *buf, int needed)
{
    int min_size = buf->len + needed;
    if (min_size > buf->size) {
        int xsize = (3 * buf->size) >> 1;
        if (min_size < xsize)
            min_size = xsize;
        buf->size = min_size;
        buf->buffer = realloc(buf->buffer, min_size);
    }
}
void *
sbuf_blank(struct sbuf *buf, int space)
{
    sbuf_extend(buf, space);
    char *p = buf->buffer + buf->len;
    buf->len += space;
    return p;
}

void
sbuf_append(struct sbuf *buf, const void *bytes, ssize_t length)
{
    if (length < 0)
        length = strlen(bytes);
    sbuf_extend(buf, length);
    memcpy(buf->buffer + buf->len, bytes, length);
    buf->len += length;
}

void
sbuf_vprintf(struct sbuf *buf, const char *format, va_list ap)
{
    sbuf_extend(buf, 80);
    int avail = buf->size - buf->len;
    va_list ap2;
    va_copy(ap2, ap);
    int len = vsnprintf(buf->buffer + buf->len, avail, format, ap2);
    va_end(ap2);
    if (len >= avail) {
        va_copy(ap2, ap);
        sbuf_extend(buf, len+1);
        avail = buf->size - buf->len;
        len = vsnprintf(buf->buffer + buf->len, avail, format, ap2);
        va_end(ap2);
    }
    buf->len += len;
}

void
sbuf_printf(struct sbuf *buf, const char *format, ...)
{
    va_list ap;
    va_start(ap, format);
    sbuf_vprintf(buf, format, ap);
    va_end(ap);
}

void
sbuf_copy_file(struct sbuf *buf, FILE*in)
{
    for (;;) {
        sbuf_extend(buf, 2048);
        int r = fread(buf->buffer + buf->len, 1,  buf->size - buf->len, in);
        if (r <= 0)
            break;
        sbuf_blank(buf, r);
    }
}

void
printf_error(struct options *opts, const char *format, ...)
{
    struct sbuf buf[1];
    bool in_domterm = false;  // TODO - needs some work to get right
    sbuf_init(buf);
#if ! PASS_STDFILES_UNIX_SOCKET
    bool from_client = opts != main_options;
    char out_code = PASS_STDFILES_SWITCH_TO_STDERR;
    if (from_client)
        sbuf_append(buf, &out_code, 1);
#endif
    if (in_domterm)
        sbuf_append(buf, "\033[12u", -1);
    va_list ap;
    va_start(ap, format);
    sbuf_vprintf(buf, format, ap);
    va_end(ap);
    if (in_domterm)
        sbuf_append(buf, "\033[11u", -1);
    sbuf_append(buf, "\n", -1);
 #if ! PASS_STDFILES_UNIX_SOCKET
    out_code = PASS_STDFILES_SWITCH_TO_STDOUT;
    if (from_client)
        sbuf_append(buf, &out_code, 1);
#endif
    write(opts->fd_err, buf->buffer, buf->len);
    sbuf_free(buf);
}

#ifndef TTYD_UTIL_H
#define TTYD_UTIL_H

struct options;

typedef const char *string_t;
typedef const string_t *arglist_t; // Also used for environments

// An argblob_t is the same as an arglist_t, but malloced as a single "blob"
// This type indicates the receiver "owns" (is responsible for freeing) it
typedef arglist_t argblob_t;

extern void printf_error(const struct options *opts, const char *format, ...)
#ifdef __GNUC__
    __attribute__((format(printf, 2,3)))
#endif
    ;

// malloc with NULL check
void *
xmalloc(size_t size);

#define challoc(SIZE) ((char*) xmalloc(SIZE));

// realloc with NULL check
void *
xrealloc(void *p, size_t size);

// strdup with NULL check
extern char * xstrdup(const char *s);

// Convert a string to upper case
char *
uppercase(char *str);

// Check whether str ends with suffix
bool
endswith(const char * str, const char * suffix);

// Get human readable signal string
int
get_sig_name(int sig, char *buf, size_t blen);

// Get signal code from string like SIGHUP
int
get_sig(const char *sig_name);

// Encode text to base64, the caller should free the returned string
char *
base64_encode(const unsigned char *buffer, size_t length);

argblob_t copy_strings(const char*const* strs);
extern int count_args(arglist_t);
extern argblob_t parse_args(const char*, bool);
extern char* parse_string(const char*, bool);
extern char* parse_string_escapes(const char*);
extern int get_string_escape(const char **ptr);

class sbuf {
public:
    sbuf();
    ~sbuf();
    void reset();
    void erase(size_t index, size_t count);
    void extend(int needed);
    void append(const char *bytes, ssize_t length);
    void append(const char *bytes) {
        append(bytes, -1);
    }
    void append(const sbuf& sb) {
        append(sb.buffer, sb.len);
    }
    void* blank(int space);
    size_t avail_space() { return size - len; }
    char *avail_start() { return buffer + len; }
    char *null_terminated();
    void copy_file(FILE* in);
    void vprintf(const char *format, va_list ap)
#ifdef __GNUC__
        __attribute__((format(printf, 2, 0)))
#endif
        ;
    void printf(const char *format, ...)
#ifdef __GNUC__
        __attribute__((format(printf, 2, 3)))
#endif
        ;
    char *strdup();
#if 0
    operator basic_string_view() const { return basic_string_view(buffer, len); }
#endif
    char *buffer;
    size_t len;
    size_t size;
};

extern const char *extract_command_from_list(const char *, const char **,
                                             const char**, const char **);
typedef bool (*test_function_t)(const char *clause, void* data);
extern const char *check_conditional(const char *, test_function_t, void*);
extern int popen_read(const char *command, sbuf& sb);
extern const char *get_clipboard_command(const char *op, bool clear_cache=false);
extern char*find_in_path(const char*);
extern bool have_in_path(const char*);
extern int bool_value(const char*);
extern const char * maybe_quote_arg(const char *in);
extern void maybe_quote_args(arglist_t argv, int argc, sbuf& sb);
extern int has_url_scheme(const char*);

#endif //TTYD_UTIL_H

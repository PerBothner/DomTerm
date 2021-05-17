#ifndef TTYD_UTIL_H
#define TTYD_UTIL_H

struct options;

typedef const char *string_t;
typedef const string_t *arglist_t; // Also used for environments

// An argblob_t is the same as an arglist_t, but malloced as a single "blob"
// This type indicates the receiver "owns" (is responsible for freeing) it
typedef arglist_t argblob_t;

extern void printf_error(struct options *opts, const char *format, ...)
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
get_sig_name(int sig, char *buf);

// Get signal code from string like SIGHUP
int
get_sig(const char *sig_name);

// Encode text to base64, the caller should free the returned string
char *
base64_encode(const unsigned char *buffer, size_t length);

argblob_t copy_strings(const char*const* strs);

class sbuf {
public:
    sbuf();
    ~sbuf();
    void reset();
    void extend(int needed);
    void append(const char *bytes, ssize_t length);
    void append(const char *bytes) {
        append(bytes, -1);
    }
    void append(const sbuf& sb) {
        append(sb.buffer, sb.len);
    }
    void* blank(int space);
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
#endif //TTYD_UTIL_H

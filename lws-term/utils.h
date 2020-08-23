#ifndef TTYD_UTIL_H
#define TTYD_UTIL_H

struct options;

extern void printf_error(struct options *opts, const char *format, ...)
#ifdef __GNUC__
    __attribute__((format(printf, 2,3)))
#endif
    ;

// malloc with NULL check
void *
xmalloc(size_t size);

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

char*const* copy_strings(char*const* strs);

struct sbuf {
    void *buffer;
    size_t len;
    size_t size;
};

extern void sbuf_init(struct sbuf *buf);
extern void sbuf_free(struct sbuf *buf);
extern char *sbuf_strdup(struct sbuf *buf);
extern void sbuf_extend(struct sbuf *buf, int needed);
extern void *sbuf_blank(struct sbuf *buf, int space);
extern void sbuf_append(struct sbuf *buf, const void *bytes, ssize_t length);
extern void sbuf_printf(struct sbuf *buf, const char *format, ...)
#ifdef __GNUC__
    __attribute__((format(printf, 2, 3)))
#endif
    ;
extern void sbuf_vprintf(struct sbuf *buf, const char *format, va_list ap)
#ifdef __GNUC__
    __attribute__((format(printf, 2, 0)))
#endif
    ;
extern void sbuf_copy_file(struct sbuf *buf, FILE*in);
#endif //TTYD_UTIL_H

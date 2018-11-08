//#define _GNU_SOURCE

// FIXME add dprintf writev

#include <stdio.h>
#include <dlfcn.h>
#include <sys/uio.h>
#include <unistd.h>
#include <stdarg.h>
#include <error.h>
#include <stdlib.h>
#include <termios.h>
#include <string.h>

// Should standard error be redirected to standard output, but
// wrapped with appropriate escape codes?
// This doesn't work completely/reliably, so it is disabled.
#define WRAP_STDERR 1

static char* domtermEnv = getenv("DOMTERM");

static int checkState = 0;
static bool inDomTerm()
{
  if (checkState == 0)
    {
      //char *tname = ttyname(1);
      checkState = 1; // FIXME
    }
  return checkState > 0;
}
static int checkStates[3];
static bool isDomTerm(int fd) {
  if (checkStates[fd] == 0)
    {
      char *tname = ttyname(fd);
      if (tname == nullptr || domtermEnv == nullptr)
        {
          checkStates[fd] = -1;
          return false;
        }
      else if (strstr(domtermEnv, tname) != nullptr)
        {
          checkStates[fd] = 1;
        }
    }
  return checkStates[fd] > 0;
}

int dup2(int oldfd, int newfd)
{
  typedef int (*dup2_type)(int,int);
  static dup2_type original_dup2 = (dup2_type) dlsym(RTLD_NEXT, "dup2");
  int result = (*original_dup2)(oldfd,newfd);
  if (newfd >= 0 && newfd <= 2) {
    //SKIP = true;
    checkState = 0;
    checkStates[newfd] = 0;
    //fprintf(stderr, "dup2 %d -> %d tty:%s\n", oldfd, newfd, ttyname(newfd));
  }
  return result;
}

#if WRAP_STDERR
#define ERR_START "\033[12u"
#define ERR_END "\033[11u"
#define ERR_START_LENGTH 5
#define ERR_END_LENGTH 5

typedef ssize_t (*writev_type)(int, const struct iovec *, int);
static writev_type original_writev = (writev_type) dlsym(RTLD_NEXT, "writev");

ssize_t write(int fd, const void *buf, size_t count)
{
  typedef ssize_t (*write_type)(int,const void*,size_t);
  static write_type original_write = (write_type) dlsym(RTLD_NEXT, "write");
  if (! inDomTerm() || fd != 2)
    return (*original_write)(fd, buf, count);
  struct iovec iovs[3];
  iovs[0].iov_base = (void*) ERR_START;
  iovs[0].iov_len = ERR_START_LENGTH;
  iovs[1].iov_base = (void*) buf;
  iovs[1].iov_len = count;
  iovs[2].iov_base = (void*) ERR_END;
  iovs[2].iov_len = ERR_END_LENGTH;
  return original_writev(1, iovs, 3);
}

ssize_t writev(int fd, const struct iovec *iov, int iovcnt)
{
    if (! inDomTerm() || fd != 2 || iovcnt > 8)
        return (*original_writev)(fd, iov, iovcnt);
    struct iovec iovx[10];
    iovx[0].iov_base = (void*) ERR_START;
    iovx[0].iov_len = ERR_START_LENGTH;
    for (int i = 0; i < iovcnt; i++) {
        iovx[i+1].iov_base = iov[i].iov_base;
        iovx[i+1].iov_len = iov[i].iov_len;
    }
    iovx[iovcnt+1].iov_base = (void*) ERR_END;
    iovx[iovcnt+1].iov_len = ERR_END_LENGTH;
    return original_writev(1, iovx, iovcnt+2);
}

#if 0
// This causes things to break quickly.
// No idea why, but it may be a bad idea to try to
// intercept stdio calls.
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream)
{
  typedef size_t (*fwrite_type)(const void*,size_t, size_t, FILE*);
  static fwrite_type original_fwrite = (fwrite_type) dlsym(RTLD_NEXT, "fwrite");
  if (! isDomTerm(1) || ! isDomTerm(2) || fileno(stream) != 2 || fileno(stdout) != 1)
    return (*original_fwrite)(ptr, size, nmemb, stream);
  if ((*original_fwrite)(ERR_START, ERR_START_LENGTH, 1, stdout) != 1)
    return 0;
  size_t ret = (*original_fwrite)(ptr, size, nmemb, stdout);
  if ((*original_fwrite)(ERR_END, ERR_END_LENGTH, 1, stdout) != 1)
    return 0;
  return ret;
}
#endif

int fprintf(FILE *stream, const char *format, ...)
{
  va_list args;
  va_start(args, format);
  int result = vfprintf(stream, format, args);
  va_end(args);
  return result;
}

int vfprintf(FILE *stream, const char *format, va_list ap)
{
  typedef int (*vfprintf_type)(FILE *stream, const char *format, va_list ap);
  static vfprintf_type original_vfprintf = (vfprintf_type) dlsym(RTLD_NEXT, "vfprintf");
  if (! inDomTerm() || stream != stderr)
    return (*original_vfprintf)(stream, format, ap);
  if (fprintf(stdout, "%s", ERR_START) <= 0)
    return -1;
  int result = (*original_vfprintf)(stdout, format, ap);
  if (fprintf(stdout, "%s", ERR_END) <= 0)
    return -1;
  return result;
}

void error(int status, int errnum, const char *format, ...)
{
  typedef void (*error_type)(int status, int errnum, const char *format, ...);
  static error_type original_error = (error_type) dlsym(RTLD_NEXT, "error");
  va_list ap;
  va_start(ap, format);
  int size = vsnprintf(nullptr, 0, format, ap) + 1;
  va_end(ap);
  char *msg = size <= 0 ? nullptr : (char*) malloc(size);
  if (size > 0)
    {
      va_start(ap, format);
      size = vsnprintf(msg, size, format, ap);
      va_end(ap);
    }
  fprintf(stdout, "%s", ERR_START);
  (*original_error)(status, errnum, "%s", msg==nullptr ? "???" : msg);
  fprintf(stdout, "%s", ERR_END);
  free(msg);
}
#endif /* WRAP_STDERR */

int tcsetattr(int fd, int optional_actions, const struct termios *termios_p)
{
  typedef int (*tcsetattr_type)(int, int, const struct termios *);
  static tcsetattr_type original_tcsetattr = (tcsetattr_type) dlsym(RTLD_NEXT, "tcsetattr");
  int result = (*original_tcsetattr)(fd, optional_actions, termios_p);
  if (isDomTerm(fd) && fd >= 0 && fd <= 2)
    {
      const char* icanon_str = (termios_p->c_lflag & ICANON) != 0 ? "icanon" :  "-icanon";
      const char* echo_str = (termios_p->c_lflag & ECHO) != 0 ? "echo" :  "-echo";
      char buf[100];
      sprintf(buf, "\033]71; %s %s \007", icanon_str, echo_str);
      write(1, buf, strlen(buf));
    }
  return result;
}

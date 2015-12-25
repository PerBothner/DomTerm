/*
 * Copyright (c) 2011, 2014 Oracle and/or its affiliates.
 * All rights reserved. Use is subject to license terms.
 *
 * This file is available and licensed under the following license:
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *  - Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  - Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the distribution.
 *  - Neither the name of Oracle Corporation nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "org_domterm_pty_PTY.h"
#include <pty_fork.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>      /* for definition of errno */
#include <stdarg.h>     /* ISO C variable aruments */
#include <sys/stat.h>
#include <syslog.h>

#include <termios.h>
#ifndef TIOCGWINSZ
#include <sys/ioctl.h>
#endif
#include "apue.h"

int log_to_stderr = 1;

#ifdef __GNUC__
#define UNUSED(VAR) __attribute__((unused)) VAR
#else
#define UNUSED(VAR) VAR
#endif

typedef JNIEnv *JNIEnvP;

JNIEXPORT jint JNICALL Java_org_domterm_pty_PTY_init
(JNIEnv *env, jobject UNUSED(pclas), jobjectArray args, jobjectArray moreEnv)
{
  int fdm;
  char            slave_name[20];
  pid_t pid;

  pid = pty_fork(&fdm);

  if (pid == 0) // child
    {
      // FIXME convert args instead of using command_args
      jsize nargs = (*env)->GetArrayLength(env, args);
      char** cargs = malloc(sizeof(char*)*(nargs+1));
      int i;
      for (i = 0; i < nargs; i++)
        {
          jbyteArray arg =
            (jbyteArray) (*env)->GetObjectArrayElement(env, args, i);
          int alen = (*env)->GetArrayLength(env, arg);
          char* buf = malloc(alen+1);
          buf[alen] = 0;
          (*env)->GetByteArrayRegion(env, arg, 0, alen, (jbyte*) buf);
          cargs[i] = buf;
        }
      cargs[nargs] = NULL;

      jsize nenv = (*env)->GetArrayLength(env, moreEnv);
      for (i = 0; i < nenv; i++)
        {
          jbyteArray arg =
            (jbyteArray) (*env)->GetObjectArrayElement(env, moreEnv, i);
          int alen = (*env)->GetArrayLength(env, arg);
          char* buf = malloc(alen+1);
          buf[alen] = 0;
          (*env)->GetByteArrayRegion(env, arg, 0, alen, (jbyte*) buf);
          putenv(buf);
        }
      execvp(cargs[0], cargs);
    }
  return fdm;
}

JNIEXPORT void Java_org_domterm_pty_PTY_writeToChildInput__I_3BII
(JNIEnvP env, jclass UNUSED(pclas), jint fdm, jbyteArray buf, jint start, jint length)
{
  //fprintf(stderr, "writeToChildInputN\n"); fflush(stderr);
  jbyte* nbuf = (*env)->GetByteArrayElements(env, buf, NULL);
  int nwritten = write(fdm, nbuf+start, length);
  (*env)->ReleaseByteArrayElements(env, buf, nbuf, 0);
  if (nwritten != length)
    err_sys("failed to write to child");
}

JNIEXPORT void JNICALL Java_org_domterm_pty_PTY_writeToChildInput__II
(JNIEnvP UNUSED(env), jclass UNUSED(pclas), jint fdm, jint b)
{
  //fprintf(stderr, "writeToChildInput1\n"); fflush(stderr);
  char buf = (char) b;
  int nwritten = write(fdm, &buf, 1);
  if (nwritten != 1)
    err_sys("failed to write to child");
}

JNIEXPORT jint JNICALL Java_org_domterm_pty_PTY_readFromChildOutput__I_3BII
(JNIEnvP env, jclass UNUSED(pclas), jint fdm, jbyteArray buf, jint start, jint length)
{
  //fprintf(stderr, "before readFromChildOutputN fdm:%d start:%d\n", fdm, start); fflush(stderr);
  jbyte* nbuf = (*env)->GetByteArrayElements(env, buf, NULL);
  int nread = read(fdm, nbuf+start, length);
  /*
  fprintf(stderr, "readFromChildOutputN %d: \"", nread);
  { int j = 0; for (j = 0;  j < nread;  j++) {
      char c = nbuf[start+j];
      if (c>=' '&&c<127) fputc(c, stderr);
      else if (c=='\n') fputs("\\n", stderr);
      else if (c=='\r') fputs("\\r", stderr);
      else if (c=='"') fputs("\\\"", stderr);
      else fprintf(stderr, "\\%03o", c); }
      fprintf(stderr, "\"\n"); fflush(stderr);}
  */
  (*env)->ReleaseByteArrayElements(env, buf, nbuf, 0);
  return nread;
}
JNIEXPORT jint JNICALL Java_PTY_readFromChildOutput__I
(JNIEnvP UNUSED(env), jclass UNUSED(pclas), jint fdm)
{
  char buf;
  int nread = read(fdm, &buf, 1);
  return nread >= 0 ? buf : nread;
}

JNIEXPORT void JNICALL Java_org_domterm_pty_PTY_setWindowSize
(JNIEnvP UNUSED(env), jclass UNUSED(pclas),
 jint fdm, jint nrows, jint ncols, jint pixw, jint pixh)
{
  struct winsize ws;
  ws.ws_row = nrows;
  ws.ws_col = ncols;
  ws.ws_xpixel = pixw;
  ws.ws_ypixel = pixh;
  if (ioctl(fdm, TIOCSWINSZ, &ws) < 0) /* *** fds or fdm ??? */
    err_sys("TIOCSWINSZ error on slave pty");
}

/*
 * Class:     org_domterm_pty_PTY
 * Method:    getTtyMode
 * Signature: (I)I
 */
JNIEXPORT jint JNICALL Java_org_domterm_pty_PTY_getTtyMode
(JNIEnvP UNUSED(env), jclass UNUSED(pclas), jint fdm)
{
  struct termios term_master;
  if (tcgetattr(fdm, &term_master) < 0)
    return -1;
  jint result = 0;
  if ((term_master.c_lflag & ICANON) != 0)
    result |= 1;
  return result;
}

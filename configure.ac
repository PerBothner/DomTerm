dnl Autoconf script for DomTerm
AC_INIT([DomTerm],[0.2])

AC_CONFIG_AUX_DIR(autotools-aux)
AM_INIT_AUTOMAKE([foreign])
AC_CANONICAL_HOST
AC_EXEEXT
AC_OBJEXT
AC_PROG_CC
AC_PROG_CXX
AC_PROG_SED

AC_ARG_WITH(java,
  AS_HELP_STRING(--without-java,Build Java help library))

AC_ARG_WITH(java_websocket,
  AS_HELP_STRING(--with-java_websocket@<:@=/path/to/java_websocket.jar@:>@,Build server using Java-WebServer (default true)))

AC_ARG_ENABLE(pty,
  AS_HELP_STRING(--enable-pty,Enable support for PTYs (default true except on Windows)))

AC_ARG_WITH(javafx,
  AS_HELP_STRING(--with-javafx@<:@=jfxrt.jar@:>@,Enable support for JavaFX))

AC_ARG_WITH(qtwebengine,
  AS_HELP_STRING(--with-qtwebengine,Build QtWebEngine front-end))

conf_classpath=
echo host: $host
pathsep="$PATH_SEPARATOR"
case ${host} in
  *-*-mingw*|*-*-cygwin*) CLASSPATH_SEPARATOR=";" ;;
  *) CLASSPATH_SEPARATOR="$PATH_SEPARATOR"
esac
case ${host} in
  *darwin*)
    JAVA_INCLUDE_SUBDIR=darwin
    LIBEXT=.dylib
    ;;
  *-*-mingw*|*-*-cygwin*)
    JAVA_INCLUDE_SUBDIR=win32
    LIBEXT=.dll
    ;;
  *linux*)
    JAVA_INCLUDE_SUBDIR=linux
    LIBEXT=.so
    ;;
  *)
    LIBEXT=.so
    ;;
esac

AM_CONDITIONAL(WITH_QTWEBENGINE, test "$with_qtwebengine" = "yes")

AC_CHECK_PROGS(QMAKE, qmake-qt5 qmake, qmake)

AM_CONDITIONAL(WITH_JAVA, test "$with_java" != "no")

if test "$with_java" = "no" && test -z "${with_java_websocket}"
then
  with_java_websocket="no"
fi
case "${with_java_websocket}" in
  yes | "")
    conf_classpath=java_websocket.jar${CLASSPATH_SEPARATOR}$conf_classpath
    ;;
  no)
    ;;
  *)
    conf_classpath=${with_java_websocket}${CLASSPATH_SEPARATOR}$conf_classpath
    ;;
esac
AM_CONDITIONAL(WITH_JAVA_WEBSOCKET, test "$with_java_websocket" != "no")

case ${with_javafx} in
  "yes" | "no" | "")
    ;;
  *)
    if test -f "${with_javafx}" ; then true
    elif test -f "${with_javafx}/rt/lib/jfxrt.jar"
    then with_javafx="${with_javafx}/rt/lib/jfxrt.jar"
    elif test -f "${with_javafx}/lib/jfxrt.jar"
    then with_javafx="${with_javafx}/lib/jfxrt.jar"
    elif test -f "${with_javafx}/jre/lib/jfxrt.jar"
    then with_javafx="${with_javafx}/jre/lib/jfxrt.jar"
    fi
    conf_classpath=${with_javafx}${CLASSPATH_SEPARATOR}$conf_classpath ;;
esac
AM_CONDITIONAL(WITH_JAVAFX, test "$with_javafx" != "" -a "$with_javafx" != "no")

if test -z "$enable_pty"; then
  if test "$CLASSPATH_SEPARATOR" = ";" || test "$with_java" = "no"
  then enable_pty="no"
  else enable_pty="yes"
  fi
fi
AM_CONDITIONAL(ENABLE_PTY, test "$enable_pty" = "yes")

if test "$with_java" != "no"
then
  if test '(' -z "${JAVA_HOME}" ')' -o '(' '!' -f "${JAVA_HOME}/bin/javac" ')'
  then
    if test -x /usr/libexec/java_home
    then JAVA_HOME=`/usr/libexec/java_home`
    else
      javac_path=`command -v javac`
      if test -n "${javac_path}"
      then JAVA_HOME=`readlink -f $javac_path | sed -e 's#/bin/javac##'`
      fi
    fi
  fi
fi

DOMTERM_VERSION=`<$srcdir/hlib/terminal.js sed -n -e 's/.*this.versionString = "\(0.43\)".*$/\1/p'`

AC_SUBST(CC)
AC_SUBST(CFLAGS)
AC_SUBST(LIBEXT)
AC_SUBST(SED)
AC_SUBST(CLASSPATH_SEPARATOR)
AC_SUBST(conf_classpath)
AC_SUBST(JAVA_HOME)
AC_SUBST(JAVA_INCLUDE_SUBDIR)
AC_SUBST(DOMTERM_VERSION)

AC_CONFIG_FILES([Makefile qtdomterm/dt_version.h])
AC_OUTPUT

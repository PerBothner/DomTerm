dnl Autoconf script for DomTerm
AC_INIT([DomTerm],[0.2])

AC_CONFIG_AUX_DIR(autotools-aux)
AC_CANONICAL_HOST
AC_EXEEXT
AC_OBJEXT
AC_PROG_CC
AC_PROG_CXX
AC_PROG_SED

AC_ARG_WITH(java_websocket,
  AS_HELP_STRING(--with-java_websocket@<:@=/path/to/java_websocket.jar@:>@,Build server using Java-WebServer (default true)))

AC_ARG_ENABLE(pty,
  AS_HELP_STRING(--enable-pty,Enable support for PTYs (default true except on Windows)))

AC_ARG_WITH(javafx,
  AS_HELP_STRING(--with-javafx@<:@=jfxrt.jar@:>@,Enable support for JavaFX))

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


case "${enable_pty}" in
  yes)
    ENABLE_PTY_TRUE=''
    ;;
  no)
    ENABLE_PTY_TRUE='#'
    ;;
  "")
    if test "$CLASSPATH_SEPARATOR" = ";"
    then ENABLE_PTY_TRUE='#'
    else ENABLE_PTY_TRUE=''
    fi
    ;;
    *) ;;
esac

case "${with_java_websocket}" in
  yes | "")
    conf_classpath=java_websocket.jar${CLASSPATH_SEPARATOR}$conf_classpath
    WITH_JAVA_WEBSOCKET_TRUE=
    ;;
  no)
    WITH_JAVA_WEBSOCKET_TRUE='#'
    ;;
  *)
    conf_classpath=${with_java_websocket}${CLASSPATH_SEPARATOR}$conf_classpath
    WITH_JAVA_WEBSOCKET_TRUE=
    ;;
esac

case ${with_javafx} in
  yes)
    WITH_JAVAFX_TRUE=''
    ;;
  no)
    WITH_JAVAFX_TRUE='#'
    ;;
  "")
    WITH_JAVAFX_TRUE='#'
    ;;
  *)
    WITH_JAVAFX_TRUE='#'
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

if test -z "${JAVA_HOME}"
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

AC_SUBST(CC)
AC_SUBST(CFLAGS)
AC_SUBST(LIBEXT)
AC_SUBST(SED)
AC_SUBST(CLASSPATH_SEPARATOR)
AC_SUBST(conf_classpath)
AC_SUBST(WITH_JAVA_WEBSOCKET)
AC_SUBST(WITH_JAVA_WEBSOCKET_TRUE)
AC_SUBST(WITH_JAVAFX_TRUE)
AC_SUBST(ENABLE_PTY_TRUE)
AC_SUBST(JAVA_HOME)
AC_SUBST(JAVA_INCLUDE_SUBDIR)

AC_CONFIG_FILES([Makefile])
AC_OUTPUT

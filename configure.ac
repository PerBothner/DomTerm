dnl Autoconf script for DomTerm
AC_INIT([DomTerm],[0.90],,domterm)
AC_CONFIG_SRCDIR([doc/DomTerm.texi])
AM_MAINTAINER_MODE([enable])

DOMTERM_VERSION="${PACKAGE_VERSION}"
DOMTERM_YEAR="2017"

AC_CONFIG_AUX_DIR(autotools-aux)
AM_INIT_AUTOMAKE([foreign subdir-objects no-dependencies])
AC_CANONICAL_HOST
AC_EXEEXT
AC_OBJEXT
AC_PROG_CC
AC_PROG_CXX
AC_PROG_SED
AC_PROG_MKDIR_P
AC_PROG_LN_S
AC_CHECK_FUNC([getrandom], [HAVE_GETRANDOM=1], [HAVE_GETRANDOM=0])

AC_ARG_WITH(java,
  AS_HELP_STRING(--without-java,Build Java help library))

AC_ARG_WITH(java_websocket,
  AS_HELP_STRING(--with-java_websocket@<:@=/path/to/java_websocket.jar@:>@,Build server using Java-WebServer))

AC_ARG_WITH(libwebsockets,
  AS_HELP_STRING(--with-libwebsockets,Build server using libwebsockets))

AC_ARG_WITH(qtwebengine,
  AS_HELP_STRING(--with-qtwebengine,Build QtWebEngine front-end))

AC_ARG_ENABLE(pty,
  AS_HELP_STRING(--enable-pty,Enable support for PTYs (default true except on Windows)))

AC_ARG_ENABLE(ld-preload,
  AS_HELP_STRING(--enable-ld-preload,Make use of LD_PRELOAD to modify standard functions))

AC_ARG_WITH(javafx,
  AS_HELP_STRING(--with-javafx@<:@=jfxrt.jar@:>@,Enable support for JavaFX))

AC_ARG_WITH(closure_compiler,
  AC_HELP_STRING("--with-closure-compiler[=@<:@=compiler.jar@:>],compress JavaScript with Closure))

AC_ARG_ENABLE(compiled-in-resources)

pathsep="$PATH_SEPARATOR"
case ${host} in
  *-*-mingw*|*-*-cygwin*) CLASSPATH_SEPARATOR=";" ;;
  *) CLASSPATH_SEPARATOR="$PATH_SEPARATOR"
esac
case "${srcdir}" in
  ".")  conf_classpath="";;
  *) conf_classpath="${srcdir}";;
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

AC_CHECK_PROGS(QMAKE, qmake-qt5 qmake, qmake)

AM_CONDITIONAL(WITH_QTWEBENGINE, test "$with_qtwebengine" = "yes")

AM_CONDITIONAL(WITH_LIBWEBSOCKETS, test "$with_libwebsockets" != "no")

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
AM_CONDITIONAL(WITH_JAVA_WEBSOCKET,
  test "$with_java_websocket" != "no" -a "$with_java_websocket" != "")

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

AM_CONDITIONAL(ENABLE_LD_PRELOAD, test "$enable_ld_preload" = "yes")
AM_CONDITIONAL(ENABLE_COMPILED_IN_RESOURCES,
    test "$enable_compiled_in_resources" = "yes")

dnl FIXME We might want to figure out datadir_relative by
dnl decl comparing datadir to bindir or prefix.
dnl If datadir and prefix set, remove prefix from datadir.
dnl If bindir is set, use bindir without last component instead of prefix.
dnl Otherwise default to "share"
datadir_relative="share"

AC_SUBST(datadir_relative)

PKG_PROG_PKG_CONFIG
if test "$with_libwebsockets" != "no"; then
  PKG_CHECK_MODULES(JSON_C, json-c)
  PKG_CHECK_MODULES(OPENSSL, openssl)
  PKG_CHECK_MODULES(LIBCAP, libcap, true, true)
  case "${with_libwebsockets}" in
    "yes" | "")
      PKG_CHECK_MODULES(LIBWEBSOCKETS, [libwebsockets >= 2.2.0])
      ;;
    *)
      #LIBWEBSOCKETS_LIBS="-L ${with_libwebsockets}/lib -lwebsockets"
      LIBWEBSOCKETS_LIBS="${with_libwebsockets}/lib/libwebsockets.a"
      LIBWEBSOCKETS_CFLAGS="-I${with_libwebsockets}/include"
      ;;
  esac
fi
ldomterm_misc_includes=
if (which brew>&/dev/null)
then
  ldomterm_misc_includes="-I$(brew --prefix)/include"
fi
AC_SUBST(ldomterm_misc_includes)

case "$with_closure_compiler" in
  "yes")
    CLOSURE_COMPILER='closure-compiler' ;;
  *".jar")
    CLOSURE_COMPILER='$(JAVA_WITH_PATH)'" -jar ${with_closure_compiler}" ;;
  "no" | "")
    CLOSURE_COMPILER="NONE" ;;
  *)
    CLOSURE_COMPILER="${with_closure_compiler}" ;;
esac
AM_CONDITIONAL(WITH_CLOSURE_COMPILER, test "$CLOSURE_COMPILER" != "NONE")
AC_SUBST(CLOSURE_COMPILER)

AC_SUBST(CC)
AC_SUBST(CFLAGS)
AC_SUBST(LIBEXT)
AC_SUBST(SED)
AC_SUBST(CLASSPATH_SEPARATOR)
AC_SUBST(conf_classpath)
AC_SUBST(JAVA_HOME)
AC_SUBST(JAVA_INCLUDE_SUBDIR)
AC_SUBST(LIBWEBSOCKETS_LIBS)
AC_SUBST(LIBWEBSOCKETS_CFLAGS)
AC_SUBST(DOMTERM_VERSION)
AC_SUBST(DOMTERM_YEAR)
AC_SUBST(HAVE_GETRANDOM)

AC_CONFIG_FILES([Makefile hlib/domterm-version.js
                 lws-term/Makefile qtdomterm/dt_version.h lws-term/version.h]
                 share/domterm/electron/package.json:electron/package.json)
AC_CONFIG_LINKS(share/domterm/chrome.manifest:xulapp/chrome.manifest
                share/domterm/defaults/preferences/prefs.js:xulapp/defaults/preferences/prefs.js
                share/domterm/electron/main.js:electron/main.js)

AC_OUTPUT

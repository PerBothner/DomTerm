all-am: ldomterm$(EXEEXT) ../bin/domterm$(EXEEXT)

# Note we use a hard link.  This is so when we execute ../bin/domterm,
# and then try figure out the executable's directory (so we can look for
# resource files) we get ../bin and not the lws-term.
# (This is to make execute-in-place and execute-after-install be similar.)
LN_H = ln
../bin/domterm$(EXEEXT): ldomterm$(EXEEXT)
	$(MKDIR_P) ../bin
	@rm -f ../bin/domterm$(EXEEXT)
	cd ../bin && $(LN_H) ../lws-term/ldomterm$(EXEEXT) domterm$(EXEEXT)
if MACOS
FRAMEWORK_ARG = -framework Cocoa
else
FRAMEWORK_ARG = -lxcb
endif
LIBWEBSOCKETS_LIBARG = @LIBWEBSOCKETS_LIBS@
bin_PROGRAMS = ldomterm
ldomterm_SOURCES = server.cc utils.cc protocol.cc http.cc whereami.c \
  commands.cc command-connect.cc help.cc junzip.c settings.cc
nodist_ldomterm_SOURCES = git-describe.c
ldomterm_CFLAGS = $(OPENSSL_CFLAGS) -I$(srcdir)/lws-term @LIBWEBSOCKETS_CFLAGS@ @ldomterm_misc_includes@
ldomterm_CXXFLAGS = $(OPENSSL_CFLAGS) -I$(srcdir)/lws-term @LIBWEBSOCKETS_CFLAGS@ @ldomterm_misc_includes@
if ENABLE_LD_PRELOAD
ldomterm_CFLAGS += -DENABLE_LD_PRELOAD
endif
ldomterm_LDADD = $(LIBWEBSOCKETS_LIBARG) $(OPENSSL_LIBS) $(LIBCAP_LIBS) -lpthread -lutil -lz $(LIBMAGIC_LIBS)
#CLIENT_DATA_DIR = @DOMTERM_DIR_RELATIVE@
CLIENT_DATA_DIR = .
if COMBINE_RESOURCES
LWS_RESOURCES = hlib/dt-combined.js hlib/dt-outer.js $(HLIB_FIXED_FILES_MISC) hlib/domterm-version.js
else
LWS_RESOURCES = $(HLIB_FIXED_FILES_INNER) $(HLIB_FIXED_FILES_OUTER) $(HLIB_FIXED_FILES_MISC) hlib/domterm-version.js
endif
XTERMJS_RESOURCES_SOURCE = $(XTERMJS_PATH)/xterm.js \
  $(XTERMJS_PATH)/xterm.css $(XTERMJS_PATH)/addons/fit/fit.js
XTERMJS_RESOURCES = hlib/xterm.js hlib/xterm.css hlib/fit.js
if WITH_XTERMJS
LWS_RESOURCES += $(XTERMJS_RESOURCES)
endif
if ENABLE_COMPILED_IN_RESOURCES
nodist_ldomterm_SOURCES += resources.cc
ldomterm_CXXFLAGS += -DCOMPILED_IN_RESOURCES
else
ldomterm_CXXFLAGS += -DRESOURCE_DIR='"../share/domterm"'
endif
if USE_KDDockWidgets
ldomterm_CXXFLAGS += -DUSE_KDDockWidgets=1 $(QT_DOCKING_CFLAGS) -DQT_DOCKING_LIBDIR='"$(QT_DOCKING_LIBDIR)"'
endif
if USE_QT_DOCKING
ldomterm_CXXFLAGS += -DUSE_DOCK_MANAGER=1 $(QT_DOCKING_CFLAGS) -DQT_DOCKING_LIBDIR='"$(QT_DOCKING_LIBDIR)"'
endif
XXD = xxd
CLEANFILES = resources.cc git-describe.c xterm.stamp \
  ../hlib/xterm.js ../hlib/xterm.css ../hlib/fit.js ../bin/domterm$(EXEEXT)

xterm.stamp:
if WITH_XTERMJS
	cd ../hlib && $(LN_S) $(XTERMJS_RESOURCES_SOURCE) .
endif
	touch xterm.stamp

resources.cc: ../client-data-links.stamp xterm.stamp
	echo '#include "server.h"' >tmp-resources.c
	for file in $(LWS_RESOURCES); do \
	  (cd $(top_builddir)/$(CLIENT_DATA_DIR)  && $(XXD) -i $$file -) | \
	    sed -e 's|unsigned int \(.*\) = \(.*\);|#define \1 \2|' \
	    >>tmp-resources.c; \
	done
	echo 'struct resource resources[] = {' >>tmp-resources.c
	for file in $(LWS_RESOURCES); do \
          name=`echo "$$file"|sed -e 's|[-./]|_|g'`; \
	  echo '    { "'$$file'", '$$name', '$$name'_len },' >>tmp-resources.c; \
	done
	echo '    { NULL, NULL, 0}' >>tmp-resources.c; \
	echo '};' >>tmp-resources.c; \
	mv tmp-resources.c $@

git-describe.c:
	test -d $(top_srcdir)/.git \
	&& GIT_REVISION=`cd $(top_srcdir) && git describe --always --dirty --long --tags 2>/dev/null`; \
	echo 'char git_describe[] = "'$${GIT_REVISION}'";' > $@

install-exec-am: ../bin/domterm$(EXEEXT)
	$(INSTALL_PROGRAM_ENV) $(INSTALL_PROGRAM) ../bin/domterm$(EXEEXT) "$(DESTDIR)$(bindir)"
EXTRA_DIST = junzip.h server.h whereami.h utils.h \
  command-connect.h option-names.h

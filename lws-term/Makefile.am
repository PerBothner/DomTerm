all-am: ldomterm$(EXEEXT) ../bin/domterm$(EXEEXT)

# Note we use a hard link.  This is so when we execute ../bin/domterm,
# and then try figure out the executable's directory (so we can look for
# resource files) we get ../bin and not the lws-term.
# (This is to make execute-in-place and execute-after-install be similar.)
LN_H = ln
../bin/domterm$(EXEEXT): ldomterm$(EXEEXT)
	cd .. && $(MKDIR_P) bin
	@rm -f ../bin/domterm$(EXEEXT)
	cd ../bin && $(LN_H) ../lws-term/ldomterm$(EXEEXT) domterm$(EXEEXT)

LIBWEBSOCKETS_LIBARG = @LIBWEBSOCKETS_LIBS@
bin_PROGRAMS = ldomterm
ldomterm_SOURCES = server.c utils.c protocol.c http.c whereami.c \
  commands.c help.c junzip.c settings.c
nodist_ldomterm_SOURCES = git-describe.c
ldomterm_CFLAGS = $(OPENSSL_CFLAGS) $(JSON_C_CFLAGS) @ldomterm_misc_includes@ -I$(srcdir)/lws-term @LIBWEBSOCKETS_CFLAGS@
if ENABLE_LD_PRELOAD
ldomterm_CFLAGS += -DENABLE_LD_PRELOAD
endif
ldomterm_LDADD = $(LIBWEBSOCKETS_LIBARG) $(OPENSSL_LIBS) $(JSON_C_LIBS) $(LIBCAP_LIBS) -lpthread -lutil -lz $(LIBMAGIC_LIBS)
#CLIENT_DATA_DIR = @DOMTERM_DIR_RELATIVE@
CLIENT_DATA_DIR = .
LWS_RESOURCES = hlib/domterm-all.js hlib/domterm-client.js \
  hlib/jquery.min.js hlib/goldenlayout.js hlib/domterm-layout.js hlib/domterm-menus.js \
  hlib/domterm-core.css hlib/domterm-standard.css hlib/domterm-default.css \
  hlib/goldenlayout-base.css hlib/domterm-layout.css
if ENABLE_COMPILED_IN_RESOURCES
nodist_ldomterm_SOURCES += resources.c
ldomterm_CFLAGS += -DCOMPILED_IN_RESOURCES
else
ldomterm_CFLAGS += -DRESOURCE_DIR='"../share/domterm"'
endif
XXD = xxd
CLEANFILES = resources.c git-describe.c

resources.c: ../client-data-links.stamp
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
	mv tmp-resources.c resources.c

git-describe.c:
	test -d $(top_srcdir)/.git \
	&& GIT_REVISION=`cd $(top_srcdir) && git describe --always --dirty --long --tags 2>/dev/null`; \
	echo 'char git_describe[] = "'$${GIT_REVISION}'";' > $@

install-exec-am: ../bin/domterm$(EXEEXT)
	$(INSTALL_PROGRAM_ENV) $(INSTALL_PROGRAM) ../bin/domterm$(EXEEXT) "$(DESTDIR)$(bindir)"

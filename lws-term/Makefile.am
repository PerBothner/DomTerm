all-am: ldomterm$(EXEEXT) ../bin/ldomterm$(EXEEXT)

../bin/ldomterm$(EXEEXT): ldomterm$(EXEEXT)
	cd .. && $(MKDIR_P) bin
	cd ../bin && $(LN_S) ../lws-term/ldomterm$(EXEEXT) ldomterm$(EXEEXT)

LIBWEBSOCKETS_LIBARG = -lwebsockets
bin_PROGRAMS = ldomterm
ldomterm_SOURCES = server.c utils.c \
  protocol.c http.c resources.c whereami.c
ldomterm_CFLAGS = -I/usr/include/json-c -I$(srcdir)/lws-term
ldomterm_LDADD = $(LIBWEBSOCKETS_LIBARG) -lssl -lcrypto -lpthread -ljson-c -lutil
CLIENT_DATA_DIR = @datadir_relative@/domterm
LWS_RESOURCES = repl-client.html hlib/domterm-all.js hlib/domterm-client.js \
  hlib/domterm-core.css hlib/domterm-standard.css hlib/domterm-default.css
XXD = xxd
CLEANFILES = resources.c

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

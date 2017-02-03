JAVA_HOME = @JAVA_HOME@
SED = @SED@
JAVA = java
JAVAC = javac
LN_S = ln -s
JAVA_INCLUDE_SUBDIR = @JAVA_INCLUDE_SUBDIR@
JAVAC_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVAC)
JAVA_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVA)

if ENABLE_PTY
LIBPTY = libpty@LIBEXT@
endif
if WITH_QTWEBENGINE
QTDOMTERM = bin/qtdomterm
endif
if WITH_JAVA
DOMTERM_JAR = lib/domterm.jar
endif
DT_CFLAGS =
if ENABLE_LD_PRELOAD
PRELOADS_SO = lib/domterm-preloads.so
DT_CFLAGS += -DENABLE_LD_PRELOAD
endif
if WITH_LIBWEBSOCKETS
LDOMTERM = bin/ldomterm
endif

all: d/domterm hlib/domterm-all.js $(DOMTERM_JAR) $(LIBPTY) $(PRELOADS_SO) xulapp/domterm.jar $(QTDOMTERM) $(LDOMTERM)

native/pty/org_domterm_pty_PTY.h: $(DOMTERM_JAR)
	javah -d native/pty org.domterm.pty.PTY
	touch native/pty/org_domterm_pty_PTY.h

lib/domterm-preloads.so: native/preloads.cc
	$(CXX) $(DT_CFLAGS) -Wall -fPIC -shared -o $@ native/preloads.cc

PTY_COMMON_PARAMS = -fno-strict-aliasing -fPIC -W -Wall  -Wno-unused -Wno-parentheses -fno-omit-frame-pointer

native/pty/pty.o native/pty/pty_fork.o: native/pty/org_domterm_pty_PTY.h

.c.o:
	$(CC) -O2 -ffast-math $(PTY_COMMON_PARAMS) -Inative/pty -I$(JAVA_HOME)/include -I$(JAVA_HOME)/include/$(JAVA_INCLUDE_SUBDIR) $(DT_CFLAGS) -c $< -o $@

libpty@LIBEXT@: native/pty/pty.o native/pty/pty_fork.o native/pty/error.o
	$(CC) $(PTY_COMMON_PARAMS) -shared -o $@ $^

d/domterm: d/domterm.ti
	tic -o. $<

run-pty: libpty@LIBEXT@ d/domterm $(DOMTERM_JAR)
	$(JAVA_WITH_PATH) -Djava.library.path=`pwd` -jar  $(DOMTERM_JAR) --pty

hlib/domterm-all.js: hlib/terminal.js hlib/FileSaver.js hlib/ResizeSensor.js hlib/bililiteRange.js
if WITH_CLOSURE_COMPILER
# ADVANCED_OPTIMIZATION doesn't quite work, even with closure-externs.js.
# There are some problem - and qtdomterm doesn't work at all. FIXME
#	$(JAVA_WITH_PATH) -jar @with_closure_compiler@  --js hlib/terminal.js --js hlib/closure-externs.js --compilation_level ADVANCED_OPTIMIZATIONS >tmp-domterm-all.js
#	$(JAVA_WITH_PATH) -jar @with_closure_compiler@ --js hlib/bililiteRange.js hlib/FileSaver.js hlib/ResizeSensor.js >>tmp-domterm-all.js
	$(JAVA_WITH_PATH) -jar @with_closure_compiler@  --js hlib/terminal.js --js hlib/bililiteRange.js hlib/FileSaver.js hlib/ResizeSensor.js >tmp-domterm-all.js
	mv tmp-domterm-all.js hlib/domterm-all.js
else
	cat hlib/bililiteRange.js hlib/terminal.js hlib/FileSaver.js hlib/ResizeSensor.js > hlib/domterm-all.js
endif

EXTRA_CLASSPATH =
SERVER_ARGS =
run-server: libpty@LIBEXT@ d/domterm $(DOMTERM_JAR)
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer $(SERVER_ARGS)

# Start up DomTerm as a Firefox/XUL app. Requires already-running server.
# (See also run-firefox.)
run-xul: xulapp/domterm.jar
	firefox -app xulapp/application.ini

# Start up DomTerm as a Firefox/XUL-based terminal emulator.
# (Like run-xul, but automatically runs server and connects to it.)
run-firefox: libpty@LIBEXT@ domterm.jar d/domterm xulapp/domterm.jar
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer --firefox $(SERVER_ARGS)

run-chrome: libpty.so $(DOMTERM_JAR) d/domterm
	$(JAVA) -cp $(EXTRA_CLASSPATH):$(DOMTERM_JAR) -Djava.library.path=`pwd` org.domterm.websocket.DomServer --chrome $(SERVER_ARGS)

run-shell: $(DOMTERM_JAR)
	CLASSPATH=$(DOMTERM_JAR) $(JAVA_WITH_PATH) org.domterm.javafx.RunProcess

clean:
	-rm -rf org/classes.stamp tmp-* org/domterm/*.class org/domterm/*/*.class websocketterm/*.class libpty@LIBEXT@ build doc/DomTerm.xml web/*.html $(DOMTERM_JAR) native/pty/*.o native/pty/org_domterm_pty_PTY.h xulapp/domterm.jar hlib/domterm-all.js lib/*.so
	-rm -rf lws-term/*.o lws-term/resources.c bin/ldomterm
	@WITH_QTWEBENGINE_TRUE@ cd qtdomterm && $(MAKE) clean
	@WITH_QTWEBENGINE_TRUE@ rm -rf bin/qtdomterm
	-rm -f qtdomterm/data/hlib/domterm-all.js \
	  qtdomterm/data/hlib/domterm-core.css \
	  qtdomterm/data/hlib/domterm-standard.css \
	  qtdomterm/data/hlib/domterm-default.css

websocket_sources = org/domterm/websocket/DomServer.java
pty_sources = org/domterm/pty/PtyBackend.java org/domterm/pty/PTY.java
javafx_sources =\
    org/domterm/javafx/WebTerminalApp.java \
    org/domterm/javafx/RunClass.java \
    org/domterm/javafx/RunProcess.java \
    org/domterm/javafx/WebWriter.java \
    org/domterm/javafx/WebTerminal.java \
    org/domterm/javafx/Main.java
javafx_pty_sources = org/domterm/pty/RunPty.java

domterm_jar_sources = \
  org/domterm/Backend.java \
  org/domterm/ClassBackend.java \
  org/domterm/ProcessBackend.java \
  org/domterm/util/DomTermErrorStream.java \
  org/domterm/util/DomTermErrorWriter.java \
  org/domterm/util/StringBufferedWriter.java \
  org/domterm/util/StyleSheets.java \
  org/domterm/util/Util.java \
  org/domterm/util/WTDebug.java \
  org/domterm/util/Utf8WriterOutputStream.java
if WITH_JAVA_WEBSOCKET
  domterm_jar_sources += $(websocket_sources)
endif
if ENABLE_PTY
  domterm_jar_sources += $(pty_sources)
endif
if WITH_JAVAFX
  domterm_jar_sources += $(javafx_sources)
if WITH_JAVAFX
  domterm_jar_sources += $(javafx_pty_sources)
endif
endif

org/classes.stamp: $(domterm_jar_sources)
	$(JAVAC_WITH_PATH) -cp .@CLASSPATH_SEPARATOR@@conf_classpath@ $?
	touch org/classes.stamp

PLAIN_COPY_TO_JAR = repl-client.html jfx-term.html hlib/domterm-*.js hlib/*.css org/domterm/*.class org/domterm/*/*.class

$(DOMTERM_JAR): org/classes.stamp hlib/domterm-all.js
	mkdir -p lib tmp-for-jar
	tar cf - $(PLAIN_COPY_TO_JAR) | (cd tmp-for-jar; tar xf -)
	cp xulapp/chrome/content/domterm.xul tmp-for-jar/
if WITH_JAVA_WEBSOCKET
	cd tmp-for-jar && unzip -o ../java_websocket.jar 'org/java_websocket/*.class'
endif
	cd tmp-for-jar && \
	  jar cmf ../domterm-jar-manifest ../$(DOMTERM_JAR) .

xulapp/domterm.jar: $(DOMTERM_JAR)
	cd xulapp && ln -s ../$(DOMTERM_JAR) domterm.jar

MAKEINFO = makeinfo
srcdir = .
XSLT = xsltproc
DOCBOOK_XSL_DIR = /home/bothner/Software/docbook-xsl-1.78.1
doc/index.html: doc/DomTerm.texi
	$(MAKEINFO) -I$(srcdir) --html --no-node-files $< -o doc

DOC_IMAGES = \
  doc/images/domterm-1.png \
  doc/images/domterm-2.png \
  doc/images/domterm-sh-svg.png \
  doc/images/domterm-polygon-1.png \
  doc/images/emacs-in-firefox-1.png

doc/DomTerm.xml: doc/DomTerm.texi
	$(MAKEINFO) -I=doc --docbook doc/DomTerm.texi -o - | \
	$(SED) \
	-e 's|_002d|-|g' \
	-e 's|<emphasis></emphasis>||' \
	-e 's|<inlinemediaobject><imageobject><imagedata fileref="\(.*\)" format="\(.*\)"></imagedata></imageobject></inlinemediaobject>|<ulink url="\1"><inlinemediaobject><imageobject><imagedata fileref="\1" format="\2"></imagedata></imageobject></inlinemediaobject></ulink>|' \
	-e 's|<chapter label="" id="Top">|<chapter label="Top" id="Top"><?dbhtml filename="index.html"?>|' \
	> doc/DomTerm.xml

web/index.html: doc/DomTerm.xml Makefile
	$(XSLT) --path $(DOCBOOK_XSL_DIR)/html \
	  --output web/  \
	  --stringparam root.filename toc \
	  --stringparam generate.section.toc.level 0 \
	  --stringparam chunker.output.encoding UTF-8 \
	  --stringparam chunker.output.doctype-public "-//W3C//DTD HTML 4.01 Transitional//EN" \
	  --stringparam generate.index 1 \
	  --stringparam use.id.as.filename 1 \
	  --stringparam chunker.output.indent yes \
	  --stringparam chunk.first.sections 1 \
	  --stringparam chunk.section.depth 1 \
	  --stringparam chapter.autolabel 0 \
	  --stringparam chunk.fast 1 \
	  --stringparam toc.max.depth 4 \
	  --stringparam toc.list.type ul \
	  --stringparam toc.section.depth 3 \
	  --stringparam chunk.separate.lots 1 \
	  --stringparam chunk.tocs.and.lots 1 \
	  doc/style/domterm.xsl doc/DomTerm.xml
	$(SED) -s 's|<a name=".*"></a>Why|Why|' <web/index.html >web/tmp-index.html
	mv web/tmp-index.html web/index.html
	patch --no-backup-if-mismatch -p0 <doc/webdoc.patch
	mkdir -p web/images
	cp $(DOC_IMAGES) web/images

WEB_SERVER_ROOT=bothner@bothner.com:domterm.org
upload-web: web/index.html
	cd web && \
	  rsync -v -r -u -l -p -t --relative . $(WEB_SERVER_ROOT)

qtdomterm/data/hlib/domterm-all.js:
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/domterm-all.js .

qtdomterm/data/hlib/domterm-core.css:
	mkdir -p qtdomterm/data/hlib
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/domterm-core.css .

qtdomterm/data/hlib/domterm-standard.css:
	mkdir -p qtdomterm/data/hlib
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/domterm-standard.css .

qtdomterm/data/hlib/domterm-default.css:
	mkdir -p qtdomterm/data/hlib
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/domterm-default.css .

bin/qtdomterm: \
  qtdomterm/data/hlib/domterm-all.js \
  qtdomterm/data/hlib/domterm-core.css \
  qtdomterm/data/hlib/domterm-standard.css \
  qtdomterm/data/hlib/domterm-default.css
	cd qtdomterm && @QMAKE@ -makefile PREFIX=$(prefix) && $(MAKE)

LIBWEBSOCKETS_LIBARG = -lwebsockets
bin/ldomterm: lws-term/server.o lws-term/utils.o lws-term/protocol.o lws-term/http.o lws-term/resources.o
	$(CC) -o $@ $^ $(LIBWEBSOCKETS_LIBARG) -lssl -lcrypto -lpthread -ljson-c -lutil

lws-term/%.o: $(srcdir)/lws-term/%.c
	$(CC) -c -g -I/usr/include/json-c $< -o $@

lws-term/repl_client.h: repl-client.h

LWS_RESOURCES = repl-client.html hlib/domterm-all.js hlib/domterm-client.js \
  hlib/domterm-core.css hlib/domterm-standard.css hlib/domterm-default.css
XXD = xxd

lws-term/resources.c: $(LWS_RESOURCES)
	echo '#include "server.h"' >lws-term/tmp-resources.c
	for file in $(LWS_RESOURCES); do \
	  (cd $(srcdir) && $(XXD) -i $$file -) | \
	    sed -e 's|unsigned int \(.*\) = \(.*\);|#define \1 \2|' \
	    >>lws-term/tmp-resources.c; \
	done
	echo 'struct resource resources[] = {' >>lws-term/tmp-resources.c
	for file in $(LWS_RESOURCES); do \
          name=`echo "$$file"|sed -e 's|[-./]|_|g'`; \
	  echo '    { "'$$file'", '$$name', '$$name'_len },' >>lws-term/tmp-resources.c; \
	done
	echo '    { NULL, NULL, 0}' >>lws-term/tmp-resources.c; \
	echo '};' >>lws-term/tmp-resources.c; \
	mv lws-term/tmp-resources.c lws-term/resources.c

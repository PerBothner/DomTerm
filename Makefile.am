DIST_SUBDIRS = lws-term
SUBDIRS = .
JAVA_HOME = @JAVA_HOME@
SED = @SED@
JAVA = java
JAVAC = javac
LN_S = ln -sf
JAVA_INCLUDE_SUBDIR = @JAVA_INCLUDE_SUBDIR@
JAVAC_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVAC)
JAVA_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVA)
CLIENT_DATA_DIR = .
#CLIENT_DATA_DIR = @datadir_relative@/domterm

if ENABLE_PTY
LIBPTY = lib/libdomterm-pty@LIBEXT@
endif
if WITH_QTWEBENGINE
QTDOMTERM = bin/qtdomterm
endif
domterm_jar_dir = share/domterm

if WITH_JAVA
DOMTERM_JAR = $(domterm_jar_dir)/domterm.jar
if WITH_JAVA_WEBSOCKET
WSDOMTERM_JAR = $(domterm_jar_dir)/wsdomterm.jar
endif
endif
DT_CFLAGS =
if ENABLE_LD_PRELOAD
PRELOADS_SO = lib/domterm-preloads$(LIBEXT)
DT_CFLAGS += -DENABLE_LD_PRELOAD
endif
if WITH_LIBWEBSOCKETS
SUBDIRS += lws-term
endif

all-am: d/domterm $(CLIENT_DATA_DIR)/hlib/domterm-all.js client-data-links.stamp $(DOMTERM_JAR) $(WSDOMTERM_JAR) $(LIBPTY) $(PRELOADS_SO) $(QTDOMTERM) $(LDOMTERM) bin/domterm share/domterm/application.ini

# application.ini has to be copied, not linked; or it can't find domterm.jar
share/domterm/application.ini: $(srcdir)/xulapp/application.ini
	cp $< $@

bin/domterm:
	@rm -f bin/domterm
if WITH_LIBWEBSOCKETS
	cd bin && $(LN_S) ldomterm domterm
else
if WITH_QTWEBENGINE
	cd bin && $(LN_S) qtdomterm domterm
else
	cd bin && $(LN_S) jdomterm domterm
endif
endif

native/pty/org_domterm_pty_PTY.h: $(DOMTERM_JAR)
	javah -cp $(DOMTERM_JAR) -d native/pty org.domterm.pty.PTY
	touch native/pty/org_domterm_pty_PTY.h

lib/domterm-preloads$(LIBEXT): native/preloads.cc
	$(CXX) $(DT_CFLAGS) -Wall -fPIC -shared -o $@ native/preloads.cc

PTY_COMMON_PARAMS = -fno-strict-aliasing -fPIC -W -Wall  -Wno-unused -Wno-parentheses -fno-omit-frame-pointer

native/pty/pty.o native/pty/pty_fork.o: native/pty/org_domterm_pty_PTY.h

.c.o:
	$(CC) -O2 -ffast-math $(PTY_COMMON_PARAMS) -I$(srcdir)/native/pty -I$(JAVA_HOME)/include -I$(JAVA_HOME)/include/$(JAVA_INCLUDE_SUBDIR) $(DT_CFLAGS) -c $< -o $@

$(LIBPTY): native/pty/pty.o native/pty/pty_fork.o native/pty/error.o
	$(MKDIR_P) lib
	$(CC) $(PTY_COMMON_PARAMS) -shared -o $@ $^

d/domterm: d/domterm.ti
	tic -o. $<

run-pty: libpty@LIBEXT@ d/domterm $(DOMTERM_JAR)
	$(JAVA_WITH_PATH) -Djava.library.path=`pwd` -jar  $(DOMTERM_JAR) --pty

JS_LIBS = hlib/FileSaver.js hlib/ResizeSensor.js hlib/bililiteRange.js hlib/wcwidth.js

HLIB_FIXED_FILES = hlib/domterm-client.js \
  hlib/domterm-core.css hlib/domterm-standard.css hlib/domterm-default.css
CLIENT_DATA_FILES = repl-client.html $(HLIB_FIXED_FILES)
HLIB_DATA_FILES = $(HLIB_FIXED_FILES) hlib/domterm-all.js

client-data-links.stamp: $(CLIENT_DATA_DIR)/hlib/domterm-all.js
	if test "$(srcdir)" != "."; then \
	  cd $(CLIENT_DATA_DIR); \
	  for file in $(CLIENT_DATA_FILES); do \
	      $(LN_S) $(abs_srcdir)/$$file $$file; done; \
	fi
	touch client-data-links.stamp

$(CLIENT_DATA_DIR)/hlib/domterm-all.js: hlib/terminal.js $(JS_LIBS)
	$(MKDIR_P) $(CLIENT_DATA_DIR)/hlib
if WITH_CLOSURE_COMPILER
# ADVANCED_OPTIMIZATION doesn't quite work, even with closure-externs.js.
# There are some problem - and qtdomterm doesn't work at all. FIXME
#	@CLOSURE_COMPILER@ --js hlib/terminal.js --js hlib/domterm-paging.js --js hlib/closure-externs.js --compilation_level ADVANCED_OPTIMIZATIONS >tmp-domterm-all.js
#	@CLOSURE_COMPILER@ --js $(JS_LIBS) >>tmp-domterm-all.js
	(cd $(srcdir) && @CLOSURE_COMPILER@ --language_in=ES6 --language_out=ES5 --js hlib/terminal.js --js hlib/domterm-paging.js --js $(JS_LIBS)) >tmp-domterm-all.js
	cat hlib/domterm-version.js >> tmp-domterm-all.js
else
	(cd $(srcdir) && cat $(JS_LIBS) hlib/terminal.js hlib/domterm-paging.js) > tmp-domterm-all.js
	cat hlib/domterm-version.js >> tmp-domterm-all.js
endif
	mv tmp-domterm-all.js $(CLIENT_DATA_DIR)/hlib/domterm-all.js

EXTRA_CLASSPATH =
SERVER_ARGS =
run-server: libpty@LIBEXT@ d/domterm $(DOMTERM_JAR)
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer $(SERVER_ARGS)

# Start up DomTerm as a Firefox/XUL-based terminal emulator.
# (Like run-xul, but automatically runs server and connects to it.)
run-firefox: $(LIBPTY) domterm.jar d/domterm xulapp/domterm.jar
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer --firefox $(SERVER_ARGS)

run-chrome: $(LIBPTY) $(DOMTERM_JAR) d/domterm
	$(JAVA) -cp $(EXTRA_CLASSPATH):$(DOMTERM_JAR) -Djava.library.path=`pwd` org.domterm.websocket.DomServer --chrome $(SERVER_ARGS)

run-shell: $(DOMTERM_JAR)
	CLASSPATH=$(DOMTERM_JAR) $(JAVA_WITH_PATH) org.domterm.javafx.RunProcess

clean-am:
	-rm -rf *.stamp tmp-* org/domterm/*.class org/domterm/*/*.class websocketterm/*.class libpty@LIBEXT@ build doc/DomTerm.xml web/*.html $(DOMTERM_JAR) $(WSDOMTERM_JAR) native/pty/*.o native/pty/org_domterm_pty_PTY.h lib/*$(LIBEXT)
	-rm -rf bin/ldomterm bin/domterm hlib/domterm-all.js \
	  share/domterm/application.ini \
	  doc/domterm.1 doc/ldomterm.1 doc/qtdomterm.1 doc/qt-util.1
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
  org/domterm/DomHttpServer.java \
  org/domterm/ClassBackend.java \
  org/domterm/ProcessBackend.java \
  org/domterm/util/DomTermErrorStream.java \
  org/domterm/util/DomTermErrorWriter.java \
  org/domterm/util/StringBufferedWriter.java \
  org/domterm/util/StyleSheets.java \
  org/domterm/util/Util.java \
  org/domterm/util/WTDebug.java \
  org/domterm/util/Utf8WriterOutputStream.java
wsdomterm_jar_sources =
if WITH_JAVA_WEBSOCKET
  wsdomterm_jar_sources += $(websocket_sources)
endif
if ENABLE_PTY
  domterm_jar_sources += $(pty_sources)
endif
if WITH_JAVAFX
  domterm_jar_sources += $(javafx_sources)
if ENABLE_PTY
  domterm_jar_sources += $(javafx_pty_sources)
endif
endif

classes.stamp: $(domterm_jar_sources)
	$(JAVAC_WITH_PATH) -d . -cp .@CLASSPATH_SEPARATOR@@conf_classpath@ $?
	touch classes.stamp

wsclasses.stamp: $(wsdomterm_jar_sources)
	$(JAVAC_WITH_PATH) -d . -cp .@CLASSPATH_SEPARATOR@@conf_classpath@ $?
	touch wsclasses.stamp

MISC_COPY_TO_JAR = repl-client.html jfx-term.html \
  hlib/goldenlayout-base.css hlib/domterm-layout.css hlib/jquery.min.js hlib/goldenlayout.js hlib/domterm-layout.js hlib/domterm-menus.js

PLAIN_COPY_TO_JAR =  $(MISC_COPY_TO_JAR) hlib/domterm-*.js hlib/*.css \
  org/domterm/*.class org/domterm/javafx/*.class org/domterm/pty/*.class \
  org/domterm/util/*.class

$(DOMTERM_JAR): classes.stamp hlib/domterm-all.js $(MISC_COPY_TO_JAR)
	$(MKDIR_P) $(domterm_jar_dir) tmp-for-jar
	tar cf - $(PLAIN_COPY_TO_JAR) | (cd tmp-for-jar; tar xf -)
	cp xulapp/domterm.xul tmp-for-jar/
	cd tmp-for-jar && \
	  jar cmf $(abs_top_srcdir)/domterm-jar-manifest ../$(DOMTERM_JAR) .
	rm -rf tmp-for-jar

$(WSDOMTERM_JAR): wsclasses.stamp wsclasses.stamp
	$(MKDIR_P) $(wsdomterm_jar_dir) tmp-for-jar
	tar cf - org/domterm/websocket/*.class | (cd tmp-for-jar; tar xf -)
if WITH_JAVA_WEBSOCKET
	cd tmp-for-jar && unzip -o ../java_websocket.jar 'org/java_websocket/*.class'
endif
	cd tmp-for-jar && \
	  jar cmf $(abs_top_srcdir)/wsdomterm-jar-manifest ../$(WSDOMTERM_JAR) .
	rm -rf tmp-for-jar

MAKEINFO = makeinfo
XSLT = xsltproc
DOCBOOK_XSL_DIR = /home/bothner/Software/docbook-xsl-1.78.1
doc/index.html: doc/DomTerm.texi
	$(MAKEINFO) -I$(srcdir) --html --no-node-files $< -o doc

DOC_IMAGES = \
  doc/domterm1.svg \
  doc/images/domterm-1.png \
  doc/images/domterm-2.png \
  doc/images/domterm-panes-2.png \
  doc/images/domterm-sh-svg.png \
  doc/images/domterm-polygon-1.png \
  doc/images/emacs-in-firefox-1.png

doc/DomTerm.xml: doc/DomTerm.texi
	$(MKDIR_P) doc
	$(MAKEINFO) -I=doc --docbook $< -o - | \
	$(SED) \
	-e 's|_002d|-|g' \
	-e 's|<emphasis></emphasis>||' \
	-e 's|<inlinemediaobject><imageobject><imagedata fileref="\(.*\)" format="\(.*\)"></imagedata></imageobject></inlinemediaobject>|<ulink url="\1"><inlinemediaobject><imageobject><imagedata fileref="\1" format="\2"></imagedata></imageobject></inlinemediaobject></ulink>|' \
	-e 's|<chapter label="" id="Top">|<chapter label="Top" id="Top"><?dbhtml filename="index.html"?>|' \
	-e '/Suspends additional output/s|><listitem>| continuation="continues"><listitem>|' \
	> doc/DomTerm.xml

web/index.html: doc/DomTerm.xml Makefile
	$(MKDIR_P) web/images
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
	  $(srcdir)/doc/style/domterm.xsl doc/DomTerm.xml
	$(SED) -s 's|<a name=".*"></a>Why|Why|' <web/index.html >web/tmp-index.html
	mv web/tmp-index.html web/index.html
	patch --no-backup-if-mismatch -p0 <$(srcdir)/doc/webdoc.patch
	cd $(srcdir) && cp $(DOC_IMAGES) $(abs_builddir)/web/images

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

if WITH_JAVA
xulapp_DATA = xulapp/application.ini xulapp/chrome.manifest
xulappprefs_DATA = xulapp/defaults/preferences/prefs.js
xulappdir = $(datadir)/domterm
xulappprefsdir = $(datadir)/domterm/defaults/preferences
endif

ELECTRON_FILES = electron/package.json electron/main.js

install-data-local:
if WITH_JAVA
	$(MKDIR_P) $(DESTDIR)$(pkgdatadir)
	$(INSTALL_DATA) -t $(DESTDIR)$(pkgdatadir) share/domterm/domterm.jar
endif
	$(MKDIR_P) $(DESTDIR)$(datadir)/applications \
	    $(DESTDIR)$(datadir)/appdata
	$(INSTALL_DATA) domterm.desktop $(DESTDIR)$(datadir)/applications/
	$(INSTALL_DATA) domterm.appdata.xml $(DESTDIR)$(datadir)/appdata/
if WITH_QTWEBENGINE
	$(INSTALL_DATA) qtdomterm.desktop $(DESTDIR)$(datadir)/applications/
	$(INSTALL_DATA) qtdomterm.appdata.xml $(DESTDIR)$(datadir)/appdata/
endif
	$(INSTALL_SCRIPT) bin/jdomterm $(DESTDIR)$(pkgdatadir)
	$(MKDIR_P) $(DESTDIR)$(datadir)/domterm/electron
	$(INSTALL_DATA) electron/package.json electron/main.js \
	    $(DESTDIR)$(datadir)/domterm/electron/

install-ldomterm:
	cd lws-term && $(MAKE) install

install-exec-hook:
	$(MKDIR_P) $(DESTDIR)$(bindir)
if WITH_QTWEBENGINE
	$(INSTALL_PROGRAM) bin/qtdomterm$(EXEEXT) $(DESTDIR)$(bindir)/qtdomterm$(EXEEXT)
endif
if WITH_LIBWEBSOCKETS
	cd $(DESTDIR)$(bindir) && $(LN_S) ldomterm domterm
else
if WITH_QTWEBENGINE
	cd $(DESTDIR)$(bindir) && $(LN_S) qtdomterm$(EXEEXT) domterm
else
	cd $(DESTDIR)$(bindir) && $(LN_S) ../share/domterm/jdomterm domterm
endif
endif

man1_MANS = doc/domterm.man
if WITH_LIBWEBSOCKETS
man1_MANS += doc/ldomterm.man
endif
if WITH_QTWEBENGINE
man1_MANS += doc/qtdomterm.man
endif

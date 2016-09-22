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
DOMTERM_JAR = domterm.jar
endif

all: d/domterm $(DOMTERM_JAR) $(LIBPTY) xulapp/domterm-chrome.jar $(QTDOMTERM)

native/pty/org_domterm_pty_PTY.h: domterm.jar
	javah -d native/pty org.domterm.pty.PTY

PTY_COMMON_PARAMS = -fno-strict-aliasing -fPIC -W -Wall  -Wno-unused -Wno-parentheses -fno-omit-frame-pointer

native/pty/pty.o native/pty/pty_fork.o: native/pty/org_domterm_pty_PTY.h

.c.o:
	$(CC) -O2 -ffast-math $(PTY_COMMON_PARAMS) -Inative/pty -I$(JAVA_HOME)/include -I$(JAVA_HOME)/include/$(JAVA_INCLUDE_SUBDIR) -c $< -o $@

libpty@LIBEXT@: native/pty/pty.o native/pty/pty_fork.o native/pty/error.o
	$(CC) $(PTY_COMMON_PARAMS) -shared -o $@ $^

d/domterm: d/domterm.ti
	tic -o. $<

run-pty: libpty@LIBEXT@ d/domterm domterm.jar
	$(JAVA_WITH_PATH) -Djava.library.path=`pwd` -jar domterm.jar --pty

EXTRA_CLASSPATH =
SERVER_ARGS =
run-server: libpty@LIBEXT@ d/domterm domterm.jar
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer $(SERVER_ARGS)

# Start up DomTerm as a Firefox/XUL app. Requires already-running server.
# (See also run-firefox.)
make run-xul: xulapp/domterm-chrome.jar
	firefox -app xulapp/application.ini

# Start up DomTerm as a Firefox/XUL-based terminal emulator.
# (Like run-xul, but automatically runs server and connects to it.)
run-firefox: libpty@LIBEXT@ domterm.jar d/domterm xulapp/domterm-chrome.jar
	$(JAVA) -cp $(EXTRA_CLASSPATH)@CLASSPATH_SEPARATOR@domterm.jar@CLASSPATH_SEPARATOR@@conf_classpath@ -Djava.library.path=`pwd` org.domterm.websocket.DomServer --firefox $(SERVER_ARGS)

run-chrome: libpty.so domterm.jar d/domterm xulapp/domterm-chrome.jar
	$(JAVA) -cp $(EXTRA_CLASSPATH):domterm.jar:java_websocket.jar: -Djava.library.path=`pwd` org.domterm.websocket.DomServer --chrome $(SERVER_ARGS)

run-shell: domterm.jar
	CLASSPATH=domterm.jar $(JAVA_WITH_PATH) org.domterm.javafx.RunProcess

clean:
	-rm -rf org/classes.stamp tmp-for-jar tmp-for-xul org/domterm/*.class org/domterm/*/*.class websocketterm/*.class libpty@LIBEXT@ build doc/DomTerm.xml web/*.html domterm.jar tmp-repl.in native/pty/*.o native/pty/org_domterm_pty_PTY.h xulapp/domterm-chrome.jar
	@WITH_QTWEBENGINE_TRUE@ cd qtdomterm && $(MAKE) clean
	@WITH_QTWEBENGINE_TRUE@ rm -rf bin/qtdomterm
	-rm -f qtdomterm/data/hlib/terminal.js qtdomterm/data/hlib/ResizeSensor.js qtdomterm/data/hlib/FileSaver.js qtdomterm/data/hlib/bililiteRange.js \
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

tmp-for-jar/jfx-term.html: jfx-term.html hlib/terminal.js Makefile
# JavaFX seems to have a problem loading .js files referenced from repl.html,
# in a .jar, but inline javascript and css works.
# So we use use sed to inline it into one by repl.html.
# Ugly - hopefully we can figure out what is going on.
	$(SED) \
	  -e '/<link .*hlib.domterm-standard.css">/i</style>' \
	  -e '/<link .*hlib.domterm-default.css">/i</style>' \
	  -e '/ResizeSensor.js/i</style>' \
	  -e '/ResizeSensor.js/i<script>' \
	  -e '/<link .*hlib.domterm-core.css">/rhlib/domterm-core.css' \
	  -e '/<link .*hlib.domterm-standard.css">/rhlib/domterm-standard.css' \
	  -e '/<link .*hlib.domterm-default.css">/rhlib/domterm-default.css' \
	  -e 's/<link rel="stylesheet"\(.*\) href=".*"/<style\1/' \
	  -e '/domterm-default/a</style>' \
	  -e '/domterm-default/a<script type="text/javascript">' \
	  -e 's|<script type="text.javascript">||' \
	  -e '/<script .*src=.*.ResizeSensor.js.*>/rhlib/ResizeSensor.js' \
	  -e '/<script .*src=.*.FileSaver.js.*>/rhlib/FileSaver.js' \
	  -e '/<script .*src=.*.bililiteRange.js.*>/rhlib/bililiteRange.js' \
	  -e '/<script .*src=.*.terminal.js.*>/rhlib/terminal.js' \
	  -e 's|<script .*src=.*.*.js.*script>||' \
	  <jfx-term.html >$@

domterm.jar: org/classes.stamp hlib/terminal.js
	mkdir -p tmp-for-jar
@ENABLE_PTY_TRUE@	$(MAKE) tmp-for-jar/jfx-term.html
	tar cf - org/domterm/*.class hlib/*.js hlib/*.css org/domterm/*/*.class | (cd tmp-for-jar; tar xf -)
	cd tmp-for-jar && \
	  jar cmf ../domterm-jar-manifest ../domterm.jar org/domterm/*.class org/domterm/*/*.class jfx-term.html hlib/*.js hlib/*.css

xulapp/domterm-chrome.jar: hlib/terminal.js xulapp/chrome/content/domterm.xul
	mkdir -p tmp-for-xul tmp-for-xul/chrome \
	  tmp-for-xul/chrome/content tmp-for-xul/chrome/content
	tar cf - hlib/*.js repl-client.html hlib/*.css |\
	  (cd tmp-for-xul/chrome/content; tar xf -)
	cp xulapp/chrome/content/domterm.xul tmp-for-xul/chrome/content
	(cd tmp-for-xul; zip -r ../xulapp/domterm-chrome.jar chrome)

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

qtdomterm/data/hlib/terminal.js:
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/terminal.js .

qtdomterm/data/hlib/ResizeSensor.js:
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/ResizeSensor.js .

qtdomterm/data/hlib/FileSaver.js:
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/FileSaver.js .

qtdomterm/data/hlib/bililiteRange.js:
	cd qtdomterm/data/hlib && $(LN_S) ../../../hlib/bililiteRange.js .

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
  qtdomterm/data/hlib/terminal.js \
  qtdomterm/data/hlib/ResizeSensor.js \
  qtdomterm/data/hlib/FileSaver.js \
  qtdomterm/data/hlib/bililiteRange.js \
  qtdomterm/data/hlib/domterm-core.css \
  qtdomterm/data/hlib/domterm-standard.css \
  qtdomterm/data/hlib/domterm-default.css
	cd qtdomterm && @QMAKE@ -makefile PREFIX=$(prefix) && $(MAKE)

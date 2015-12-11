JAVA_HOME = /opt/jdk1.8/
JAVA = java
JAVAC = javac
JAVAC_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVAC)
JAVA_WITH_PATH = PATH=$(JAVA_HOME)/bin:$(PATH) $(JAVA)
TYRUS_LIBS = websocket-ri-archive-1.9/lib
TYRUS_APIS = websocket-ri-archive-1.9/api
TYRUS_EXTS = websocket-ri-archive-1.9/ext
JLIBS = $(TYRUS_APIS)/javax.websocket-api-1.1.jar:$(TYRUS_LIBS)/tyrus-server-1.9.jar:$(TYRUS_LIBS)/tyrus-spi-1.9.jar:$(TYRUS_LIBS)/tyrus-core-1.9.jar:$(TYRUS_LIBS)/tyrus-container-grizzly-server-1.9.jar:$(TYRUS_EXTS)/grizzly-framework-2.3.15-gfa.jar:$(TYRUS_EXTS)/grizzly-http-server-2.3.15-gfa.jar:$(TYRUS_EXTS)/grizzly-http-2.3.15-gfa.jar:$(TYRUS_LIBS)/tyrus-container-grizzly-client-1.9.jar

websocketterm/ReplServer.class: websocketterm/ReplServer.java
	$(JAVAC) websocketterm/ReplServer.java -cp .:$(JLIBS)

websocketterm/WebSocketServer.class: websocketterm/WebSocketServer.java
	$(JAVAC) websocketterm/WebSocketServer.java -cp .:$(JLIBS)

org/domterm/util/Util.class: org/domterm/util/Util.java
	$(JAVAC) $<

ptyconsole/PTY.class: ptyconsole/PTY.java
	$(JAVAC) ptyconsole/PTY.java

ptyconsole/ptyconsole_PTY.h: ptyconsole/PTY.class
	javah -d ptyconsole ptyconsole.PTY

org/domterm/javafx/WebTerminal.class: org/domterm/javafx/WebTerminal.java
	$(JAVAC_WITH_PATH) $<

org/domterm/javafx/WebWriter.class: org/domterm/javafx/WebWriter.java org/domterm/javafx/WebTerminal.class
	$(JAVAC_WITH_PATH) $<

webterminal/ShellConsole.class: webterminal/ShellConsole.java org/domterm/javafx/WebTerminal.class org/domterm/javafx/WebWriter.class
	$(JAVAC_WITH_PATH) webterminal/ShellConsole.java

org/domtern/Client.class: org/domterm/Client.java
	$(JAVAC_WITH_PATH) $<

ptyconsole/PtyClient.class: ptyconsole/PtyClient.java org/domterm/javafx/WebTerminal.class org/domterm/javafx/WebWriter.class ptyconsole/PTY.class org/domterm/Client.class
	$(JAVAC_WITH_PATH) ptyconsole/PtyClient.java

ptyconsole/App.class: ptyconsole/App.java ptyconsole/PtyClient.class
	$(JAVAC_WITH_PATH) ptyconsole/App.java

libpty.so:
	cd ptyconsole && $(MAKE) all DIST_DIR=.. JDK_HOME=$(JAVA_HOME)

d/domterm: d/domterm.ti
	tic -o. $<

run-pty: ptyconsole/App.class libpty.so d/domterm
	$(JAVA_WITH_PATH) -Djava.library.path=`pwd` ptyconsole.App

run-server: websocketterm/WebSocketServer.class websocketterm/ReplServer.class org/domterm/util/Util.class libpty.so d/domterm
	$(JAVA) -cp .:$(JLIBS) -Djava.library.path=`pwd` websocketterm.WebSocketServer

run-shell: webterminal/ShellConsole.class
	$(JAVA_WITH_PATH) webterminal.ShellConsole

clean:
	-rm -rf webterminal/*.class ptyconsole/*.class websocketterm/*.class libpty.so build doc/DomTerm.xml web/*.html

MAKEINFO = makeinfo
srcdir = .
DOMTERM_HTMLDIR = doc/html
XSLT = xsltproc
DOCBOOK_XSL_DIR = /home/bothner/Software/docbook-xsl-1.78.1
doc/DomTerm.html: doc/DomTerm.texi
	$(MAKEINFO) -I$(srcdir) --html --no-node-files $< -o $(DOMTERM_HTMLDIR)

doc/DomTerm.xml: doc/DomTerm.texi
	$(MAKEINFO) -I=doc --docbook doc/DomTerm.texi -o - | \
	sed \
	-e 's|_002d|-|g' \
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
	  --stringparam chunk.section.depth 0 \
	  --stringparam chapter.autolabel 0 \
	  --stringparam chunk.fast 1 \
	  --stringparam toc.max.depth 4 \
	  --stringparam toc.list.type ul \
	  --stringparam toc.section.depth 3 \
	  --stringparam chunk.separate.lots 1 \
	  --stringparam chunk.tocs.and.lots 1 \
	  doc/style/domterm.xsl doc/DomTerm.xml

WEB_SERVER_ROOT=bothner@bothner.com:domterm.org
upload-web:
	cd web && \
	  rsync -v -r -u -l -p -t --relative . $(WEB_SERVER_ROOT)

# DomTerm - a terminal emulator and console using DOM and JavaScript

DomTerm is a combined terminal emulator and REPL console using web
technlogies - i.e. JavaScript and DOM: Users can type commands which
gets sent to an application, which evaluates the command, and displays
the results, typically in some kind of type-script format.

The [JWebTerminal](https://github.com/PerBothner/JWebTerminal) project
was based on similar concepts, but was mostly written in Java using
[Javafx WebView]https://docs.oracle.com/javafx/2/webview/jfxpub-webview.htm).
JWebTerminal is currently more stable with fewer bugs, but DomTerm has a more
efficient and flexible design, and will not require Java.

## Why another terminal emulator

The goal of this project is to combine two related but
separate tools: a terminal emulator, and a rich-text console,
and do it properly.

There are many terminal emulators, including quite a few written in JavaScript.
However, they generally work with a rectangular grid of characters,
and don't integrate rich text (images, math, variable-width text,
variable-length lines, interaction) well.

There are also various tools designed for REPL-style interaction,
chat clients, etc. [IPython](http://ipython.org/) is a popular example.
However, they don't work as terminal emulators, or if they do, they
do it by switching modes.

For rich text applications it seems obvious to use web technlogies:
DOM and JavaScript.

One goal of this project is a stand-alone terminal emulator application
that techies can use as a day-to-day terminal emulator, and that also
seamlessly provides support for rich text and interaction. That means
an embedded web engine.

The core of the project is a JavaScript package that can be used and
embedded in different modes.

## Usage modes

There are two basic modes:
- In line-editing mode each input line is an input field you
edit locally (in the browser).  The finished line is sent to the
application when you type Enter.
- In character mode each character is sent directly to the application,
which is also responsible for input echoing.

Applications of DomTerm include:
- A chat/talk window.
- A read-eval-print-loop for an interactive scripting language.
- A command console.
- A terminal emulator.

## Sample applications

### Standalone terminal emulator

This is a prototype of a stand-alone terminal emulator program.
It uses PTYs so it only works on Unix-like systems.
The prototype uses Java and the JavaFX WebView component (based on WebKit).
It needs OpenJDK 1.8 but should otherwise not need anything else.

To run the terminal emulator, first edit Makefile to set JAVA_HOME,
and then do:

    make run-pty

The code to set up the handshake between JavaScript and Java is not
robust and sometimes fails.

There is no "chrome" (menus, buttons, etc), so far.

### Future: Standalone terminal emulator

Rather than using JavaFX WebView, some other toolkits to consider include:
- [Chromium Embedded Framework](https://bitbucket.org/chromiumembedded/ce)
- Mozilla Servo: http://lwn.net/Articles/647921/
- [Atom/Electon](http://atom.io)
- QtWebEngine
- [WebKitGtk+](http://webkitgtk.org/)

### Using WebSockets between a server and a browser

This allows you to use "any" modern browser as the client.
This is nice for development, as you can use the browser's
JavaScript console and debugger, DOM inspector, and so on.
The browser talks to a special server using WebSockets; the
server uses PTYs.

The server uses various third-party Java libraries, and is
*not* covered by the DomTerm license.

To start the server do:

    make run-server

then use a web brower to read file:///path/to/DomTerm/repl-client.html

The websocketterm/ReplServer.java uses standard JavaEE annotations,
so it should be possibly to deploy it in an EE server like Glassfish.

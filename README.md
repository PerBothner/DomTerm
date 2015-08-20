# DomTerm - a terminal emulator and console using DOM and JavaScript

DomTerm is a combined terminal emulator and REPL console using web
technlogies - i.e. JavaScript and DOM: Users can type commands which
gets sent to an application, which evaluates the command, and displays
the results, typically in some kind of type-script format.

It is a follow-up and replacement to my earlier JWebTerminal project,
which was mostly written in Java using Javafx WebView.  JWebTerminal
is currently more stable with fewer bugs, but DomTerm has a more
efficient and flexible design, and does not require Java.

## Why another terminal emulator

The goal of this projects is to combine two related but
separate tools: terminal emulator, and rich-text console,
and do it properly.

There are many terminal emulators, including quite a few written in JavaScript.
However, they generally work with a rectangulat grid of characters,
and don't integrate rich text (images, math, variable-width text,
variable-length lines) well.

There are also various tools designed for REPL-style interaction,
chat clients, etc.  IPython is a popular example.  However, they don't
work as terminal emulators, or if they do, they do it by switching modes.

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

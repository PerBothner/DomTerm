===========================================
domterm - terminal emulator and multiplexer
===========================================

Synopsis
========
``domterm`` [*options*] [*command* *arguments* ...]

Description
===========
DomTerm is a terminal emulator that supports embedded graphics and html;
builtin tiling and tabs; session management; and more.

The ``domterm`` commands manages terminal sessions, and
creates windows (and sub-windows) to display them.
The display is uses an embedded web browser (using electron
or QtWebEngine); you can also use a regular desktop browser.

Commands
========
``help`` [*topic*]

``new`` [command [arguments]]

``attach`` <session>

``browse`` <url>

and more ...

Options
=======

--geometry WIDTHxHEIGHT
  The size of the main window.

and more ...

See also
========
qtdomterm(1)

http://domterm.org/ - the DomTerm home page

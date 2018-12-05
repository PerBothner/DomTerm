# Using xterm.js for DomTerm's rendering engine

[Xterm.js](https://xtermjs.org/) is terminal emulator "core"
used by many terminals and other JavaScript-based tools.
Its main advantage is performance; in addition it benefits
from a large community.  However, it is lacking many DomTerm
features, most obviously embedded graphics or other HTML.

There is an experimental build of DomTerm that uses xterm.js
for basic terminal emulator functionality (escape sequence
processing, and drawing).  Basic terminal output is quite
a bit faster than with the default DomTerm engine.  However,
much functionality is missing.

To try it, grab and build my fork of xterm.js:

    git clone git@github.com:PerBothner/xterm.js.git
    cd xterm.js
    yarn
    XTERM_DIR=`pwd`

The build DomTerm with the extra `--with-xterm.js` flag to configure:

    cd /path/to/this-directory
    autoreconf -i
    ./configure --with-xterm.js=${XTERM_DIR}/build
    make

Then to run it, do:

    bin/domterm

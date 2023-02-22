# Using xterm.js for DomTerm's rendering engine

[Xterm.js](https://xtermjs.org/) is terminal emulator "core"
used by many terminals and other JavaScript-based tools.
Its main advantage is performance; in addition it benefits
from a large community.  However, it is lacking many DomTerm
features, most obviously embedded graphics or other HTML.

DomTerm now has experimental support for using xterm.js.
You can have some windows using the DomTerm emulator
and windows using the xterm.js emulator - at the same time.

To try it, checkout and build DomTerm as described [here](https://domterm.org/Downloading-and-building.html), with one change:
When running `configure` add the `--with-xterm.js` option.
If you want to be able to see what is going on, `--enable-debug` is also suggested.

To select the xterm.js emulator specify the `terminal=xtermjs` [setting](https://domterm.org/Settings.html). This can be specified on the `domterm` command line or in the `settings.ini` configuration file.
To open a terminal using the DomTerm emulator, specify `terminal=domterm` (the default).

A list of features available when using `terminal=xtermjs` is planned,
as well as a list of features only available when using `terminal=domterm`.

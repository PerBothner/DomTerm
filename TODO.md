# Ideas and projects for DomTerm

## Basic functionality

#### Make robust enough for actual use

Other terminal emulators:

[term.js](https://github.com/chjj/term.js/)
has quite complete terminal emulation and even better documentation.
Howewver, it's based on a simple 2-d array (char value and attributes
encoded as an integer).

#### Use vttest for testing

http://invisible-island.net/vttest/

#### Re-wrap on line length change

#### Improve copy and paste

Handle exporting html to clipboard.

Implement Ctrl-Shift-C as copy and Ctrl-Shift-V as paste.
(At least in standaline ptyconsole.App, as there may be security
problems when using a normal browser.)

Fix paste in line-editing mode.

Think about how to do multi-line paste.

## Write a better stand-line application

Should probably have a (hideable) top menubar (in additon to pop-up menu).

Allow switching styles.

Evaluate using other ligher-weight (?) toolkits than JavaFx WebView.

## Extra features

### Readline style hooks and improvements

The idea is the line-editing mode would provide the
functionality of readline or similar programs.

#### Add history support in line-editing mode

http://sdether.github.io/josh.js/ has readline and history emulation

there is a history addition for node.js's  https://nodejs.org/api/readline.html

#### Colorize output differently for prompt and input

#### Readline hooks to recognize when it's running under DomTerm

The idea is readline would delegate basic line editing
(and re-display) to DomTerm, while DomTerm would call back
to readline for command completion, history, etc.

This has a couple of advantages over plain readline:
One is to have mousing actually work (i.e. no more
readline not being able to move the cursor on mouse-clicks).
Another advantage is local editing, which is a benefit
over slow links (such as satellites) or when you don't
want to interrupt the server needlessly.

Readline should at least behave as if the screen width were infinite,
delegating line-wrapping to DomTerm.

#### Customizable key sequences, as in readline

### Pretty-printing

Add hooks for Lisp-style pretty-printing.  The idea is a pretty-printer
woudl emit groups and "text blocks" and DomTerm would do line-breaking.
Specifically, lines would be re-broken on window size change.

### Integrated pagination (like more/less)

Emacs term mode does this.

### Graphics hooks

Allow processe to send HTML and graphics to DomTerm.
See some previous work: http://per.bothner.com/blog/2007/ReplPane/

#### Allow printing images

A REPL might want to "print" an image which we want to display.
This could use a blob: or data: URL (neither of which are universally
supported) or create a URL to a temporary file.

#### Event forwarding to inferior

A process may "print"/paint graphics with event handlers.
For example a button.  On clicking the button, the click
should be bundled as an event objects sent back to the inferior.

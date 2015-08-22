## Basic functionality

#### Make robust enough for actual use

#### Use vttest for testing

#### Detect re-sizing, and send re-size report to client.

The ResizeManger hook should enable this.

#### Re-wrap on line length change

#### Handle copy and paste

Copy should "sanitize" the DOM.  For example soft line wraps
need to be eliminated.

#### Get line-editing mode working

## Write a better stand-line application

For example, we need a menu to select between character and line mode,
or to export the DOM to a "notebook".

Using JavaFx WebView is probably the wrong toolkit for this.

## Extra features

### Readline style hooks and improvements

The idea is the line-editing mode would provide the
functionality of readline or similar programs.

#### Automatic switching to from line-editing mode

In addition to "char mode" and "line mode" (like the
Emacs term mode) there should be an "auto mode" which watches
the states of the inferior pty to automatically switch
between them.  This would be like the existing rlfe program.

Ideally you'd want to integrat with the kernel
terminal sub-system, to suppress echoing.   In lieu of
that, line editing mode should delete the input line
from the DOM before sending them to the inferior.
To avoid annoying flashing, it should do so lazily:
Don't remove the input line until we get some
output from the inferior.  (Emacs term does this, IIRC.)

#### Add history support in line-editing mode

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

#### Customizable key sequences, as in readline

### Pretty-printing

Add hooks for Lisp-style pretty-printing.  The idea is a pretty-printer
woudl emit groups and "text blocks" and DomTerm would do line-breaking.
Specifically, lines would be re-broken on window size change.

### Integrated pagination (like more/less)

Emacs term mode does this.

### Graphics hooks

Allow processe to send HTML and graphics to DomTerm.

### Allow printing images

A REPL might want to "print" an image which we want to display.
This could use a blob: or data: URL (neither of which are universally
supported) or create a URL to a temporary file.

### Event forwarding to inferior

A process may "print"/paint graphics with event handlers.
For example a button.  On clicking the button, the click
should be bundled as an event objects sent back to the inferior.

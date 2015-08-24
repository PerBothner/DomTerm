# Notes towards design and specification documents

## The WebTeminal object

A WebTerminal class (should be renamed DomTerm?) encapsulates the
the statge of a terminal emulator / console.

### Line structure

"Line" here refer to "visual line": A section of the DOM that should be
treated as a line for cursor movement.  Line breaks may come from the
client, or be inserted by the line break algorithm.

The lineStarts array maps from a line number to the DOM location
of the start of the corresponding line.

The lineEnds array maps to the end of each line.
Alwways points to a span node with the line attribute set.
Normally lineEnds[i] == lineStarts[i+1]; however, sometimes
lineStarts[i] is the start of a <div> or other block element.

## DOM structure

`<div class="interaction">`
A "console object" is representated as a <div> of class "interaction".
The only required structure is that all newlines are
wrapped in a <span> that has a line attribute.
Logical structure may use span or div nodes. (TBD).

`<span id="input1" std="input" contenteditable="true">` -
The location of the input cursor.
In char-mode the contents are empty.  In line-mode contains
the current enput line.
Referenced by the inputLine field of the DomTerm object.

`<span line="hard">` =
A "hard" newline.  Has a "\n" text node as its sole child.

`<span line="soft">` -
A "soft" newline, as breaked by line-breaking.
It's sole child is a text node consisting of wrapString
followed by a newline.  The newline might be followed by indentation.

`<span line="end">` -
Marks the end of the final line.  Has no contents.

## Colors and high-lighting

Escape sequences (for example `"\e[4m"` - "underlined", or
`"\e[32m"` - "set foreground color to green") are translated to
<span> elements with "`style`" attributes (for example
`<span style="text-decoration:underline">` or `<span style="color: green">`).
After creating such a `<span>` the current position is moved inside it.

If we've previously processed "set foreground color to green", and we
see a request for "underlined" it is easy to ceate a nested `<span>`
for the latter.  But what if we then see "set foreground color to red"?
We don't want to nest <span style="color: red">` inside
<span style="color: green">` - that could lead to some deep and
ugly nesting.  Instead, we move the cursor outside bot existing
spans, and then create new spans for red and underlined.

The `<span>` nodes are created lazily just before characters are
inserted, by `_adjustStyle`, which compares the current active styles
with the desired ones (set by `_pushStyle`).

A possibly better approach would be to match each highlight style into
a `class` attribute (for example `green-foreground-style` and
`underlined-style`).  A default stylesheet can map each style class to
the correspoding CSS rules.  This has the advantage that one could
override the highlighting appearance with a custom style sheet.

## Line-breaking / pretty-printing

For a terminal emulator we need to preserve (not collapse) whitespace,
and (usually) we want to line-break in the middle of a word.

These CSS properties come close:
   white-space: pre-wrap; word-break: break-all
This is simple and fast.  However:
- It doesn't help in inserting a visual indicator, line Emacs's arrow,
  to indicate when a line was broken.
- It doesn't help managing the line table.
- It doesn't help with pretty-printing (for example grouping).

Hence we need to do the job ourselves.

Define a DOM API for (LISP-style) pretty-printing.
Line-breaking is re-calculated on page width change.

`<span line="fill">`
`<span line="linear">` -
Line break types, as in Common Lisp.

`<span class="group" ident=N">`

Derek Oppen algorithm

Stable, Flexible, Peephole Pretty-Printing
http://macbeth.cs.ucdavis.edu/ph-final.pdf

## Future: Saved notebooks

A "notebook" is a saved (and potentially executable)
representation of a session.

IPython/Jupyter has a [JSON encoding for "notebooks"
](https://ipython.org/ipython-doc/3/notebook/nbformat.html).
This is flexible and extensible, but requires special tools.

The DomTerm notebook format should just be a simple html page.
Essentially a serialization of the DOM.  The page may include
some generated header information and metadata.  It may include
references to JavaScript that would allow former execution,
as well as viewing actions (like hide/unhide, wrap-to-fit, etc).
This references should be simple and relative, so the actual
JavaScript loaded can depend on context.

The format must be XML-compatible (XHTML) so it can be
parsed by XML tools such as XSLT.

Specific format TBD.

The html page must be viewable and look reasonable in a browser even
if JavaScript library or style files are missing or JavaScript is
disabled.

A notebook may be include assitional resources in other files,
such as images.  If notebook  consists of multiple files,
they should be bundled in a zip archive (like LibreOffice does).

Tools to convert to and from Jupyter format would be nice,
so we should avoid gratuitous conceptual incompatibility.

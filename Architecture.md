# Notes towwards design and specification documents

## The WebTeminal object

A WebTerminal class (should be renamed DomTerm?) encapsulates the

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

<div class="interaction">
A "console object" is representated as a <div> of class "interaction".
The only required structure is that all newlines are
wrapped in a <span> that has a line attribute.
Logical structure may use span or div nodes. (TBD).

<span id="input1" std="input" contenteditable="true">
The location of the input cursor.
In char-mode the contents are empty.  In line-mode contains
the current enput line.
Referenced by the inputLine field of the DomTerm object.

<span line="hard">
A "hard" newline.  Has a "\n" text node as its sole child.

<span line="soft">
A "soft" newline, as breaked by line-breaking.
It's sole child is a text node consisting of wrapString
followed by a newline.  The newline might be followed by indentation.

<span line="end">
Marks the end of the final line.  Has no contents.

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

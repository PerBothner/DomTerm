/*
 * Copyright (c) 2015 Per Bothner.
 *
 * Converted to JavaScript from WebTerminal.java, which has the license:
 *
 * Copyright (c) 2011, 2014 Oracle and/or its affiliates.
 * All rights reserved. Use is subject to license terms.
 *
 * This file is available and licensed under the following license:
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *  - Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  - Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the distribution.
 *  - Neither the name of Oracle Corporation nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

function DomTerm(name, topNode) {
    // A unique name for this DomTerm instance.
    // Should match the syntax for an XML NCName, as it is used to
    // generate "id" attributes.  I.e. only allowed special characters
    // are '_', '-', and '.'; the first character must be a letter or '_'.
    // (Colons are technically allowed, but could cause problems.)
    // Generated named have the format:  name + "__" + something.
    this.name = name;

    // Input lines that have not been processed yet.
    // In some modes we support enhanced type-ahead: Input lines are queued
    // up and only released when requested.  This allows output from an
    // earlier command, as well as prompt text for a later command, to
    // be inserted before a later input-line.
    this.pendingInput = null;

    this.lineIdCounter = 0; // FIXME temporary debugging

    this.insertMode = false;

    this.lineEditing = false;

    // If true, we automatically switching lineEditing depending
    // on slate pty's canon mode.  TODO
    this.autoEditing = true;

    this.verbosity = 0;

    // Use the doLineEdit when in lineEditing mode.
    // Because default this is only used in autoEditing mode, for the
    // character when switching fro character to line mode,
    // because doLineEdit is rather incomplete.
    // However, doLineEdit does open the possibility of user keymaps.
    this.useDoLineEdit = false;

    // True if a client performs echo on lines sent to it.
    // In that case, when lineEditing is true, when a completed
    // input line is sent to the client, it gets echoed by the client.
    // Hence we get two copies of each input line.
    // If this setting is true, we clear the contents of the input line
    // before the client echo.
    // If lineEditing is false, the client is always responsible
    // for echo, so this setting is ignored in that case.
    this.clientDoesEcho = true;

    // Used to implement clientDoesEscho handling.
    this._deferredForDeletion = null;

    // Cursor motion is relative to the start of this element
    // (normally a div or pre).
    // I.e. the cursor home location is the start of this element.
    // "Erase screen" only erases in this element.
    // Probably REDUNDANT/OBSOLETE - replace by lineStarts[homeLine] ?
    this.cursorHome = null;

    this.topNode = null;

    // ??? FIXME we want to get rid of this - use currentLogicalLine.
    this.initial = null;

    // Current line number, 0-origin, relative to start of cursorHome.
    // -1 if unknown. */
    this.currentCursorLine = -1;

    // Current column number, 0-origin, relative to start of cursorHome.
    // -1 if unknown. */
    this.currentCursorColumn = -1;

    this.savedCursorLine = 0;
    this.savedCursorColumn = 0;

    // If inserting a character at this column width, insert a wrap-break.
    this.wrapWidth = 80;

    this.rightMarginWidth = 0;

    // Number of vertical pixels available.
    this.availHeight = 0;
    // Number of horizontal pixels available.
    // Doesn't count scrollbar or rightMarginWidth.
    this.availWidth = 0;

    this.wrapOnLongLines = true;

    // This is the column width at which the next line implicitly starts.
    // Compare with wrapWidth - if both are less than 9999999
    // then they should normally be equal. */
    this.columnWidth = 9999999;

    this.numRows = 24;
    this.numColumns = 80;

    // First (top) line of scroll region, 0-origin.
    this.scrollRegionTop = 0;

    // Last (bottom) line of scroll region, 1-origin.
    // Equivalently, first line following scroll region, 0-origin.
    // The value -1 is equivalent to numRows.
    this.scrollRegionBottom = -1;

    this.controlSequenceState = DomTerm.INITIAL_STATE;

    // The output position (cursor) - insert output before this node.
    // Usually equal to inputLine except for temporary updates,
    // or when lineEditing is true.
    // If null, this means append output to the end of the output container's
    // children. (FIXME: The null case is not fully debugged.)
    this.outputBefore = null;

    // The parent node of the output position.
    // New output is by default inserted into this Node,
    // at the position indicated by outputBefore.
    this.outputContainer = null;

    this.inputLine = null;

    this.inputLineNumber = 0;

    this.parameters = new Array();

    // Map line number to beginning of each line.
    // This is either a block-level element like <div> or <body>,
    // or the end of the previous line - lineEnds[line-1].
    this.lineStarts = new Array();

    // Map line number to end of each line.
    // This is a <span> element with a line attribute.
    this.lineEnds = new Array();

    // Index of the 'home' position in the lineStarts table.
    // Cursor motion is relative to the start of this line
    // (normally a div or pre).
    // "Erase screen" only erases starting at this line.
    this.homeLine = 0;

    // A stack of currently active "style" strings.
    this._currentStyles = new Array();

    // True if currentStyles may not match the current style context.
    // Thus the context needs to be adjusted before text is inserted.
    this._adjustStyleNeeded = false;

    this.defaultBackgroundColor = "white";
    this.defaultForegroundColor = "black";

    this.usingAlternateScreenBuffer = false;
    this.savedCursorHome = null;
    this.savedHomeLine = -1;

    this.delta2DHelper = new Array(2);

    if (topNode)
        this.initializeTerminal(topNode);
}

// For debugging (may be overridden)
DomTerm.prototype.log = function(str) {
    console.log(str);
};

// States of escape sequences handler state machine.
DomTerm.INITIAL_STATE = 0;
DomTerm.SEEN_ESC_STATE = 1;
/** We have seen ESC '['. */
DomTerm.SEEN_ESC_LBRACKET_STATE = 2;
/** We have seen ESC '[' '?'. */
DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE = 3;
/** We have seen ESC ']'. */
DomTerm.SEEN_ESC_RBRACKET_STATE = 4;
/** We have seen ESC ']' numeric-parameter ';'. */
DomTerm.SEEN_ESC_BRACKET_TEXT_STATE = 5;

// FIXME StringBuilder curTextParameter;

// On older JS implementations use implementation of repeat from:
// http://stackoverflow.com/questions/202605/repeat-string-javascript
// Needed for Chrome 39.
if (!String.prototype.repeat) {
  String.prototype.repeat = function(num)
    { return new Array(num + 1).join(this);}
};

if (!String.prototype.startsWith) {
  // Needed for Chrome 39 - supposedly available in Chrome 41.
  Object.defineProperty(String.prototype, 'startsWith', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function(searchString, position) {
      position = position || 0;
      return this.lastIndexOf(searchString, position) === position;
    }
  });
};

DomTerm.makeSpaces = function(n) {
    return ' '.repeat(n)
};

DomTerm.prototype.getScrollTop = function() {
    return this.scrollRegionTop;
};
DomTerm.prototype.getScrollBottom = function() {
    return this.scrollRegionBottom < 0 ? this.numRows : this.scrollRegionBottom;
};

// Return column number following a tab at initial {@code col}.
// Ths col is the initial column, 0-origin.
// Return the column number (0-origin) after a tab.
// Default implementation assumes tabs every 8 columns.
 DomTerm.prototype.nextTabCol = function(col) {
    return (col & ~7) + 8;
};

/** Returns number of columns needed for argument character.
 * Currently always returns 1 (except for 'zero width space').
 * However, in the future we should handle zero-width characters
 * as well as double-width characters, and composing charcters.
 */
DomTerm.prototype.charColumns = function(ch) {
    if (ch == 0x200B)
        return 0;
    return 1;
};

/** Calculate a "column state" after appending a given char.
 * A non-negative column state is a number of columns.
 * The value -1 as a return value indicates a newline character.
 *
 * In the future, a value less than -1 can be used to encode an
 * initial part of a compound character, including a start surrogate.
 * Compound character support is not implemented yet,
 * nor is support for zero-width or double-width characters.
 
 * The ch is the next character to output.
 * The startState is the column state before emitting {@code ch}
 *   This is basically the number of columns, but in the future we
 *   might use the high-order bits for flags, fractional columns etc.
 * Returns the column state after {@code ch} is appended,
 *  or -1 after a character that starts a new line.
 */
DomTerm.prototype.updateColumn = function(ch, startState) {
    if (ch == 10 /* '\n' */ ||
        ch == 13 /* '\r' */ ||
        ch == 12 /* '\f' */)
        return -1;
    if (startState < 0) {
        // TODO handle surrogates, compound characters, etc.
    }
    if (ch == 9 /* '\t' - tab */)
        return this.nextTabCol(startState);
    return startState+this.charColumns(ch);
};

DomTerm.prototype.saveCursor = function() {
    this.savedCursorLine = this.getCursorLine();
    this.savedCursorColumn = this.getCursorColumn();
};
 
DomTerm.prototype.restoreCursor = function() {
    this.moveTo(this.savedCursorLine, this.savedCursorColumn);
}; 


/** Move forwards relative to cursorHome.
 * Add spaces as needed.
 * @param goalLine number of lines (non-negative) to move down from startNod
e
* @param goalColumn number of columns to move right from the start of the g
oalLine
*/
DomTerm.prototype.moveTo = function(goalLine, goalColumn) {
    if (goalLine < 0)
        goalLine = 0;
    else if (goalLine >= this.numRows)
        goalLine = this.numRows-1;
    if (goalColumn < 0)
        goalColumn = 0;
    else if (goalColumn >= this.numColumns)
        goalColumn = this.numColumns-1;
    this.moveToIn(goalLine, goalColumn, true);
};

/** Move forwards relative to startNode.
 * @param startNode the origin (zero) location - usually this is {@code cursorHome}
 * @param goalLine number of lines (non-negative) to move down from startNode
 * @param goalColumn number of columns to move right from the start of teh goalLine
 * @param addSpaceAsNeeded if we should add blank linesor spaces if needed to move as requested; otherwise stop at the last existing line, or (just past the) last existing contents of the goalLine
 */
DomTerm.prototype.moveToIn = function(goalLine, goalColumn, addSpaceAsNeeded) {
    this._adjustStyleNeeded = true; // FIXME optimize?
    var line = this.getCursorLine();
    var column = this.getCursorColumn();
    if (this.verbosity >= 2)
        this.log("moveTo lineCount:"+this.lineStarts.length+" homeL:"+this.homeLine+" goalLine:"+goalLine+" line:"+line+" goalCol:"+goalColumn+" col:"+column);
    // This moves current (and parent) forwards in the DOM tree
    // until we reach the desired (goalLine,goalColumn).
    // The invariant is if current is non-null, then the position is
    // just before current (and parent == current.parentNode);
    // otherwise, the position is after the last child of parent.

    // First we use the current position or the lineStarts table
    // to quickly go to the desired line.
    var current, parent;
    if (goalLine == line && goalColumn >= column) {
        current = this.outputBefore;
        parent = this.outputContainer;
    } else {
        var homeLine = this.homeLine;
        var lineCount = this.lineStarts.length;
        var absLine = homeLine+goalLine;
        while (absLine >= lineCount) {
            if (! addSpaceAsNeeded)
                return;
            var last = this.lineEnds[lineCount-1];
            if (! last) {
                this.log("bad last!");
            }
            var kind = last.getAttribute("line");
            if (kind=="end") {
                last.setAttribute("line", "hard");
                //this.appendText(last, "\n");
            }
            var next = this._createEndNode();
            if (! last.parentNode)
                this.log("null parentNode!");
            last.parentNode.appendChild(next);
            this.lineStarts[lineCount] = last;
            this.lineEnds[lineCount] = next;
            var nextLine = lineCount;
            lineCount++;
            if (lineCount > homeLine + this.numRows) {
                homeLine = lineCount - this.numRows;
                goalLine -= homeLine - this.homeLine;
                this.homeLine = homeLine;
                this.cursorHome = this.lineStarts[homeLine];
            }
            /*
            while (homeLine < nextLine) {
                var homeTop = homeLine == 0 ? this.lineStarts[homeLine].offsetTop
                    : this.lineEnds[homeLine-1].offsetTop + this.lineEnds[homeLine-1].offsetHeight;
                if (next.offsetTop+next.offsetHeight <= homeTop + this.availHeight)
                    break;
                homeLine++;
                var homeStart = this.lineStarts[homeLine];
                this.cursorHome = homeStart;
            }
            */
        }
        var lineStart = this.lineStarts[absLine];
        //this.log("- lineStart:"+lineStart+" homeL:"+homeLine+" goalL:"+goalLine+" lines.len:"+this.lineStarts.length+" absLine:"+absLine);
        if (absLine > 0 && lineStart == this.lineEnds[absLine-1]) {
            current = lineStart.nextSibling;
            parent = lineStart.parentNode;
        } else {
            parent = lineStart;
            if (lineStart) {
                current = lineStart.firstChild;
            } else
                this.log("- bad lineStart");
        }
        if (!current)
            console.log("null current after init moveTo line");
        line = goalLine;
        column = 0;
    }
    if (column != goalColumn) {
        var lineEnd = this.lineEnds[this.homeLine+line];

        // Temporarily remove inputLine from tree.
        if (this.inputLine != null) {
            var inputParent = this.inputLine.parentNode;
            if (inputParent != null) {
                if (this.outputBefore==this.inputLine)
                    this.outputBefore = this.outputBefore.nextSibling;
                if (current==this.inputLine)
                    current = current.nextSibling;
                inputParent.removeChild(this.inputLine);
                // Removing input line may leave 2 Text nodes adjacent.
                // These are merged below.
            }
        }
        // At this point we're at the correct line; scan to the desired column.
        mainLoop:
        while (column < goalColumn) {
            if (parent==null||(current!=null&&parent!=current.parentNode))
                this.log("BAD PARENT "+WTDebug.pnode(parent)+" OF "+WTDebug.pnode(current));
            if (current == lineEnd) {
                if (addSpaceAsNeeded) {
                    var str = DomTerm.makeSpaces(goalColumn-column);
                    if (current && current.previousSibling instanceof Text)
                        current.previousSibling.appendData(str);
                    else
                        parent.insertBefore(document.createTextNode(str), current);
                    column = goalColumn;
                }
                else
                    goalColumn = column;
                break;
            }
            else if (current instanceof Text) {
                var tnode = current;
                var tstart = 0;
                var before;
                while ((before = tnode.previousSibling) instanceof Text) {
                    // merge nodes
                    // (adjacent text nodes may happen after removing inputLine)
                    var beforeData = before.data;
                    tstart += beforeData.length;
                    tnode.insertData(0, beforeData);
                    parent.removeChild(before);
                }
                var text = tnode.textContent;
                var tlen = text.length;
                var i = tstart;
                for (; i < tlen;  i++) {
                    if (line >= goalLine && column >= goalColumn) {
                        tnode.splitText(i);
                        break;
                    }
                    var ch = text.charCodeAt(i);
                    var nextColumn = this.updateColumn(ch, column);
                    if (nextColumn > this.columnWidth) {
                        line++;
                        column = this.updateColumn(ch, 0);
                    }
                    else if (nextColumn == -1) {
                        //console.log("nextCol=-1 ch "+
                        if (line == goalLine) {
                            var nspaces = goalColumn-column;
                            if (addSpaceAsNeeded) {
                                var spaces = DomTerm.makeSpaces(nspaces);
                                tnode.insertData(i, spaces);
                                tlen += nspaces;
                                i += nspaces;
                            }
                            column = goalColumn;
                            i--;
                        } else {
                            line++;
                            column = 0;
                            if (ch == 13 /*'\r'*/
                                && i+1<tlen
                                && text.charCodeAt(i+1) == 10 /*'\n'*/)
                                i++;
                        }
                    }
                    else
                        column = nextColumn;
                }
            }

            //if (parent==null||(current!=null&&parent!=current.parentNode))            error("BAD PARENT "+WTDebug.pnode(parent)+" OF "+WTDebug.pnode(current));
            // If there is a child, go the the first child next.
            var ch;
            if (current != null) {
                if (current instanceof Element
                    && this.isObjectElement(current))
                    column += 1;
                else {
                    ch = current.firstChild;
                    if (ch != null) {
                        parent = current;
                        if (! ch)
                            console.log("setting current to null 1");
                        current = ch;
                        continue;
                    }
                }
                // Otherwise, go to the next sibling.
                ch = current.nextSibling;
                if (ch != null) {
                    if (! ch)
                        console.log("setting current to null 2");
                    current = ch;
                    //if (parent==null||(current!=null&&parent!=current.parentNode))                    throw new Error("BAD PARENT "+WTDebug.pnode(parent)+" OF "+WTDebug.pnode(current));
                    continue;
                }
                // Otherwise go to the parent's sibling - but this gets complicated.
                if (this.isBlockNode(current))
                    line++;
            }

            ch = current;
            for (;;) {
                //this.log(" move 2 parent:%s body:%s line:%s goal:%s curl:%s current:%s", parent, this.topNode, line, goalLine, this.currentCursorLine, current);
                if (parent == this.initial || parent == this.topNode) {
                    current = null;
                    var fill = goalColumn - column;
                    //console.log(" move 2 fill:%s pareent:%s", fill, parent);
                    if (fill > 0) {
                        this.appendText(parent, DomTerm.makeSpaces(fill))
                    }
                    line = goalLine;
                    column = goalColumn;
                    break mainLoop;
                }
                var sib = parent.nextSibling;
                ch = parent; // ??
                parent = parent.parentNode;
                if (sib != null) {
                    current = sib;
                    //parent = ch;
                    break;
                }
            }
        }
    }
    //console.log("after mainLoop parent:%s", parent);
    if (parent == this.topNode && this.isBlockNode(current)) {
        parent = current;
        current = parent.firstChild;
    }
    if (this.inputLine != null) {
        parent.insertBefore(this.inputLine, current);
        this.inputLine.focus();
        current = this.inputLine;
    }
    this.outputContainer = parent;
    this.outputBefore = current;
    this.currentCursorLine = line;
    this.currentCursorColumn = column;
};

/** Move cursor to beginning of line, relative.
 * @param deltaLines line number to move to, relative to current line.
 */
DomTerm.prototype.cursorLineStart = function(deltaLines) {
    this.moveToIn(this.getCursorLine()+deltaLines, 0, true);
};

DomTerm.prototype.cursorDown = function(deltaLines) {
    this.moveTo(this.getCursorLine()+deltaLines, this.getCursorColumn());
};

DomTerm.prototype.cursorRight = function(count) {
    // FIXME optimize same way cursorLeft is.
    //long lcol = this.delta2D(this.cursorHome, this.outputBefore);
    //inline = (int) (lcol >> 32);
    //int col = (int) (lcol >> 1) & 0x7fffffff;
    this.moveTo(this.getCursorLine(), this.getCursorColumn()+count);
};

DomTerm.prototype.cursorLeft = function(count) {
    if (count == 0)
        return;
    var prev = this.outputBefore.previousSibling;
    // Optimize common case
    if (prev instanceof Text) {
        var tstr = prev.textContent;
        var len = tstr.length;
        var tcols = 0;
        var tcount = 0;
        for (;;) {
            if (tcols == count)
                break;
            if (tcount == len) {
                tcount = -1;
                break;
            }
            tcount++;
            var ch = tstr.charCodeAt(len-tcount);
            var chcols = this.charColumns(ch);
            if (ch == 10/*'\n'*/ || ch == 13/*'\r'*/ || ch == 12/*'\f'*/
                || ch == 9/*'\t'*/
                || chcols < 0 || tcols+chcols > count) {
                tcount = -1;
                break;
            }
            tcols += chcols;
        }
        if (tcount > 0) {
            var after = tstr.substring(len-tcount);
            prev.deleteData(len-tcount, tcount);
            count -= tcols;

            var following = this.outputBefore.nextSibling;
            if (following && following.nodeType == 3/*TEXT_NODE*/) {
                following.replaceData(0, 0, after);
            } else {
                var nafter = document.createTextNode(after);
                this.outputContainer.insertBefore(nafter, following);
            }
            if (this.currentCursorColumn > 0)
                this.currentCursorColumn -= tcols;
        }
    }
    if (count > 0) {
        this.moveTo(this.getCursorLine(), this.getCursorColumn()-count);
    }
};

DomTerm.prototype.outputLFasCRLF = function() {
    return this.lineEditing;
};

/** Add a style property specifier to the _currentStyles list.
 * However, if the new specifier "cancels" an existing specifier,
 * just remove the old one.
 * @param styleNameWithColon style property name including colon,
 *     (for example "text-decoration:").
 * @param styleValue style property value string (for example "underline"),
 *     or null to indicate the default value.
 */
DomTerm.prototype._pushStyle = function(styleNameWithColon, styleValue) {
    var nstyles = this._currentStyles.length;
    var i = 0;
    for (;  i < nstyles;  i++) {
        if (this._currentStyles[i].startsWith(styleNameWithColon)) {
            // Remove old _currentStyles[i]
            while (++i < nstyles) {
                this._currentStyles[i-1] = this._currentStyles[i];
            }
            this._currentStyles.pop();
            break;
        }
    }
    if (styleValue != null)
        this._currentStyles.push(styleNameWithColon+' '+styleValue);
};

/** Adjust style at current position to match desired style.
 * The desired style is a specified by the _currentStyles list.
 * This usually means adding {@code <span style=...>} nodes around the
 * current position.  If the current position is already inside
 * a {@code <span style=...>} node that doesn't match the desired style,
 * then we have to split the {@code span} node so the current
 * position is not inside the span node, but text before and after is.
 */
DomTerm.prototype._adjustStyle = function() {
    this._adjustStyleNeeded = false;
    var parentStyles = new Array();
    for (var n = this.outputContainer;  n != this.topNode && n != null;
         n = n.parentNode) {
        if (n instanceof Element) {
            var style = n.getAttribute("style");
            if (style != null && style.length > 0)
                parentStyles.push(style);
        }
    }

    // Compare the parentStyles and _currentStyles lists,
    // so we can "keep" the styles where the match, and pop or add
    // the styles where they don't match.
    var keptStyles = 0;
    var currentStylesLength = this._currentStyles.length;
    var j;
    for (j = parentStyles.length; --j >= 0; ) {
        var parentStyle = parentStyles[j];
        if (parentStyle != null) {
            if (keptStyles == currentStylesLength) {
                break;
            }

            // Matching is made more complicated because parentStyles
            // may specify multiple properties in a single style attribute.
            // For example "color: red; background-color: blue".
            var k = 0;
            while (k >= 0 && (parentStyle = parentStyle.trim()).length > 0) {
                // Assume property values cannot contain semi-colons.
                // This may fail if there are string-valued properties,
                // since we don't check for quoted semi-colons.
                var semi = parentStyle.indexOf(';');
                var s;
                if (semi >= 0) {
                    s = parentStyle.substring(0, semi).trim();
                    parentStyle = parentStyle.substring(semi+1);
                    if (s.length == 0)
                        continue;
                }
                else {
                    s = parentStyle;
                    parentStyle = "";
                }
                if (keptStyles+k < currentStylesLength
                    && s == this._currentStyles[keptStyles+k])
                    k++;
                else
                    k = -1;
            }

            if (k >= 0)
                keptStyles += k;
            else
                break;                   
        }
    }
    var popCount = j+1;
    while (--popCount >= 0) {
        // Pop style - move inputLine outside current (style) span.
        var following = this.inputLine.nextSibling;
        var span1 = this.inputLine.parentNode;
        if (! span1) {
            console.log("null span1 inputLine:"+this.inputLine);
        }
        var parent = span1.parentNode;
        span1.removeChild(this.inputLine);
        this.outputContainer = parent;
        parent.insertBefore(this.inputLine, span1.nextSibling);
        this.outputBefore = this.inputLine;
        if (following != null) {
            var span2 = this.createSpanNode();
            var classAttr = span1.getAttribute("class");
            var styleAttr = span1.getAttribute("style");
            if (classAttr != null && classAttr.length > 0)
                span2.setAttribute("class", classAttr);
            if (styleAttr != null && styleAttr.length > 0)
                span2.setAttribute("style", styleAttr);
            parent.insertBefore(span2, this.inputLine.nextSibling);
            do {
                var ch = following;
                following = ch.nextSibling;
                span1.removeChild(ch);
                span2.appendChild(ch);
            } while (following != null);
        }
        this.inputLine.focus();
    }
    if (keptStyles < currentStylesLength) {
        this.outputBefore = this.inputLine.nextSibling;
        this.outputContainer.removeChild(this.inputLine);
        var styleValue = null;
        do {
            var s = this._currentStyles[keptStyles];
            styleValue = styleValue == null ? s : styleValue + ';' + s;
        } while (++keptStyles < currentStylesLength);
        var spanNode = this.createSpanNode();
        spanNode.setAttribute("style", styleValue);
        this.outputContainer.insertBefore(spanNode, this.outputBefore);
        this.outputContainer = spanNode;
        this.outputBefore = null;
        spanNode.appendChild(this.inputLine);
        this.outputBefore = this.inputLine;
        this.inputLine.focus();
    }
};

DomTerm.prototype.insertLinesIgnoreScroll = function(count) {
    this._checkLines();
    var line = this.getCursorLine();
    var absLine = this.homeLine+line;
    var column = this.getCursorColumn();
    if (column != 0)
        this.moveTo(line, 0);
    var pos = this.outputBefore;
    var oldLength = this.lineStarts.length;
    this.lineStarts.length += count;
    this.lineEnds.length += count;
    for (var i = oldLength-1-count; i > absLine+count; i--) {
        this.lineStarts[i+count] = this.lineStarts[i];
        this.lineEnds[i+count] = this.lineEnds[i];
    }
    this.lineEnds[absLine+count] = this.lineEnds[absLine];
    for (var i = 0; i < count;  i++) {
        var newLine = this._createLineNode("hard", "\n");
        this.outputContainer.insertBefore(newLine, pos);
        this.lineEnds[absLine+i] = newLine;
        this.lineStarts[absLine+i+1] = newLine;
    }
    if (column != null)
        this.moveTo(line, column);
    this._checkLines();
    /*
    var text = document.createTextNode("\n".repeat(count));
    if (this.outputBefore == this.inputLine && this.inputLine != null)
        this.outputContainer.insertBefore(text, this.outputBefore.nextSibling);
    else {
        this.insertNode(text);
        this.outputBefore = text;
    }
    */
};

DomTerm.prototype._rootNode = function(node) {
    for (;;) {
        var parent = node.parentNode;
        if (! parent)
            return node;
        node = parent;
    }
};

DomTerm.prototype._isAnAncestor = function(node, ancestor) {
    while (node != ancestor) {
        var parent = node.parentNode;
        if (! parent)
            return false;
        node = parent;
    }
    return true;
};

DomTerm.prototype.deleteLinesIgnoreScroll = function(count) {
    console.log("deleteLinesIgnoreScroll %d", count);
    this._checkLines();
    var line = this.getCursorLine();
    var absLine = this.homeLine+line;
    var start = this.lineStarts[absLine];
    var end;
    if (count < 0 || absLine+count >= this.lineStarts.length) {
        end = this.lineEnds[this.lineEnds.length-1];
        count = this.lineStarts.length - absLine;
    } else
        end = this.lineStarts[absLine+count];
    var cur = this.outputBefore;
    var parent = this.outputContainer;
    //if (end && cur && end.parentNode == this.outputContainer) {
    var inputLine = this.inputLine;
    var inputRoot = this._rootNode(inputLine);
    while (cur != end) {
        if (this._isAnAncestor(end, cur)) {
            parent = cur;
            cur = cur.firstChild;
        } else if (cur == null) {
            cur = parent.nextSibling;
            if (! cur)
                break;
            parent = cur.parentNode;
        } else {
            var next = cur.nextSibling;
            parent.removeChild(cur);
            cur = next;
        }
    }
    // If inputLine was among deleted content, put it just before end.
    if (inputRoot != this._rootNode(inputLine)) {
        if (inputLine.parentNode)
            inputLine.parentNode.removeChild(inputLine);
        if (! end.parentNode) {
            this.log("bad end node "+end);
        }
        end.parentNode.insertBefore(inputLine, end);
    }
    this.lineEnds[absLine] = end;
    var length = this.lineStarts.length;
    for (var i = absLine+1;  i+count < length;  i++) {
        this.lineStarts[i] = this.lineStarts[i+count];
        this.lineEnds[i] = this.lineEnds[i+count];
    }
    length -= count - 1;
    this.lineStarts.length = length;
    this.lineEnds.length = length;
    this.outputBefore = end;
    this.outputContainer = end.parentNode;
    this._checkLines();
    /*
    } else {
        for (var i = count; --i >= 0; ) {
            this.eraseCharactersRight(-2, true);
        }
    }
*/
};

DomTerm.prototype.insertLines = function(count) {
    var line = this.getCursorLine();
    this.moveTo(this.getScrollBottom()-count, 0);
    this.deleteLinesIgnoreScroll(count);
    this.moveTo(line, 0);
    this.insertLinesIgnoreScroll(count);
};

 DomTerm.prototype.deleteLines = function(count) {
     this.deleteLinesIgnoreScroll(count);
     var line = this.getCursorLine();
     var scrollBottom = this.getScrollBottom(); 
     var insertNeeded = true; // FIXME: scrollBottom != last_line
     if (insertNeeded) {
         this.cursorLineStart(scrollBottom - line - count);
         this.insertLinesIgnoreScroll(count);
     }
     this.moveTo(line, 0);
 };

DomTerm.prototype.scrollForward = function(count) {
    var line = this.getCursorLine();
    this.moveTo(this.getScrollTop(), 0);
    this.deleteLinesIgnoreScroll(count);
    var scrollRegionSize = this.getScrollBottom() - this.getScrollTop();
    this.cursorLineStart(scrollRegionSize-count);
    this.insertLinesIgnoreScroll(count);
    this.moveTo(line, 0);
};

DomTerm.prototype.scrollReverse = function(count) {
    var line = this.getCursorLine();
    this.moveTo(this.getScrollBottom()-count, 0);
    this.deleteLinesIgnoreScroll(count);
    this.moveTo(this.getScrollTop(), 0);
    this.insertLinesIgnoreScroll(count);
    this.moveTo(line, 0);
};

DomTerm.prototype._checkLines = function() {
    for (var i = 0;  i < this.lineEnds.length; i++) {
        if (! this.lineEnds[i] || ! this.lineEnds[i].parentNode) {
            this.log("bad lineEdnds i:"+i);
        }
    }
}

DomTerm.prototype.createSpanNode = function() {
    return document.createElement("span");
};

DomTerm.prototype.makeId = function(local) {
    return this.name + "__" + local;
};

DomTerm.prototype._createLineNode = function(kind, text) {
    var el = document.createElement("span");
    el.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
    el.setAttribute("line", kind);
    if (text)
        el.appendChild(document.createTextNode(text));
    return el;
};
 
DomTerm.prototype._createEndNode = function(kind) {
    return this._createLineNode("end", "\n");
};

DomTerm.prototype.setAlternateScreenBuffer = function(val) {
    if (this.usingAlternateScreenBuffer != val) {
        if (val) {
            // FIXME should scroll top of new buffer to top of window.
            var buffer = document.createElement("pre");
            this.savedCursorHome = this.cursorHome;
            this.savedHomeLine = this.homeLine;
            this.topNode.appendChild(buffer);
            this.cursorHome = buffer;
            this.outputContainer.removeChild(this.inputLine);
            buffer.appendChild(this.inputLine);
            this.outputContainer = buffer;
            this.outputBefore = this.inputLine;
            this.currentCursorColumn = 0;
            this.currentCursorLine = 0;
        } else { 
            this.outputContainer.removeChild(this.inputLine);
            this.cursorHome.parentNode.removeChild(this.cursorHome);
            this.cursorHome = this.savedCursorHome;
            this.homeLine = this.savedHomeLine;
            this.cursorHome.appendChild(this.inputLine);
            this.outputContainer = this.cursorHome;
            this.outputBefore = this.inputLine;
            this.savedCursorHome = null;
            this.savedHomeLine = -1;
            this.outputContainer = this.cursorHome;
            this.resetCursorCache();
        }
        this.inputLine.focus();
        this.usingAlternateScreenBuffer = val;
        this.scrollRegionTop = 0;
        this.scrollRegionBottom = -1;
    }
};


/** True if an img/object/a element.
 * These are treated as black boxes similar to a single
 * 1-column character.
 * @param node an Element we want to check
 * @return true iff the {@code node} shoudl be treated as a
 *  block-box embedded object.
 *  For now returns true for {@code img}, {@code a}, and {@code object}.
 *  (We should perhaps treat {@code a} as text.)
 */
DomTerm.prototype.isObjectElement = function(node) {
    var tag = node.tagName;
    return "A" == tag || "OBJECT" == tag || "IMG" == tag;
};

DomTerm.prototype.isBlockNode = function(node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "P" == tag || "DIV" == tag || "PRE" == tag;
};

// Obsolete?  We should never have a <br> node in the DOM.
// (If we allow it, we should wrap it in a <span line="br">.)
DomTerm.prototype.isBreakNode = function( node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "BR" == tag;
};

DomTerm.prototype.isSpanNode = function(node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "SPAN" == tag;
};

DomTerm.prototype.initializeTerminal = function(topNode) {
    var wt = this;
    this.topNode = topNode;
    var rulerName = this.makeId("ruler");
    var helperNode = document.createElement("div");
    helperNode.setAttribute("id", this.makeId("helper"));
    helperNode.setAttribute("style", "position: absolute; visibility: hidden");
    topNode.insertBefore(helperNode, topNode.firstChild);
    var rulerNode = document.createElement("span");
    rulerNode.setAttribute("id", rulerName);
    rulerNode.setAttribute("class", "wrap");
    rulerNode.appendChild(document
                          .createTextNode("abcdefghijklmnopqrstuvwxyz"));
    this._rulerNode = rulerNode;
    helperNode.appendChild(rulerNode);

    var wrapDummy = this._createLineNode("soft", "\n");
    helperNode.appendChild(wrapDummy);
    this._wrapDummy = wrapDummy;

    // FIXME we want the resize-sensor to be a child of helperNode
    var dt = this;
    new ResizeSensor(topNode, function () {
        if (dt.verbosity > 0)
            dt.log("ResizeSensor called"); 
        // FIXME do some throttling.
        // The link below has an example using requestAnimationFrame:
        // https://developer.mozilla.org/en-US/docs/Web/Events/scroll
        dt.measureWindow();
    });

    var mainNode = document.createElement("div");
    mainNode.setAttribute("id", this.makeId("main"));
    mainNode.setAttribute("class", "interaction");
    topNode.appendChild(mainNode);

    document.onkeydown =
        function(e) { dt.keyDownHandler(e ? e : window.event) };
    document.onkeypress =
        function(e) { dt.keyPressHandler(e ? e : window.event) };
    document.addEventListener("paste",
                              function(e) {
                                  dt.pasteText(e.clipboardData.getData("text"));
                                  e.preventDefault(); },
                             false);

    this.initial = mainNode; //document.getElementById(mainName);
    this.lineStarts[0] = this.initial;
    this.outputContainer = this.initial;
    this.cursorHome = this.initial;
    this.addInputLine();
    this.outputBefore = this.inputLine;
    this.pendingInput = this.inputLine;
    var lineEnd = this._createEndNode();
    this.initial.appendChild(lineEnd);
    this.lineEnds[0] = lineEnd;

    this.measureWindow();

};

DomTerm.prototype.measureWindow = function()  {
    var ruler = this._rulerNode; //document.getElementById(rulerName);
    var rect = ruler.getBoundingClientRect()
    var charWidth = ruler.offsetWidth/26.0;
    var charHeight = ruler.offsetHeight;
    this.rightMarginWidth = this._wrapDummy.offsetWidth;
    //this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.topNode+" clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.initial.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+charWidth+" chH:"+charHeight+" ht:"+availHeight);
    // We calculate rows from initial.clientWidth because we don't
    // want to include the scroll-bar.  On the other hand, for veritcal
    // height we have to look at the parent of the topNode because
    // topNode may not have grown to full size yet.
    var availHeight = this.topNode.parentNode.clientHeight;
    var availWidth = this.initial.clientWidth - this.rightMarginWidth;
    var numRows = Math.floor(availHeight / charHeight);
    var numColumns = Math.floor(availWidth / charWidth);
    if (numRows != this.numRows || numColumns != this.numColumns
        || availHeight != this.availHeight || availWidth != this.availWidth) {
        this.setWindowSize(numRows, numColumns, availHeight, availWidth);
    }
    this.numRows = numRows;
    this.numColumns = numColumns;
    this.availHeight = availHeight;
    this.availWidth = availWidth;
    //this.log("ruler ow:"+ruler.offsetWidth+" cl-h:"+ruler.clientHeight+" cl-w:"+ruler.clientWidth+" = "+(ruler.offsetWidth/26.0)+"/char h:"+ruler.offsetHeight+" rect:.l:"+rect.left+" r:"+rect.right+" r.t:"+rect.top+" r.b:"+rect.bottom+" numCols:"+this.numColumns+" numRows:"+this.numRows);
    this.wrapWidth = this.numColumns;
};

DomTerm.prototype.reportEvent = function(name, data) {
    // 0x92 is "Private Use 2".
    // FIXME should encode data
    this.processInputCharacters("\x92"+name+" "+data+"\n");
};
DomTerm.prototype.setWindowSize = function(numRows, numColumns,
                                           availHeight, availWidth) {
    if (this.verbosity >= 2)
        this.log("windowSizeChanged numRows:"+numRows+" numCols:"+numColumns);
    this.reportEvent("WS", numRows+" "+numColumns+" "+availHeight+" "+availWidth);
};

DomTerm.prototype.addInputLine = function() {
    var inputNode = this.createSpanNode();
    var id = this.makeId("I"+(++this.inputLineNumber));
    inputNode.setAttribute("id", id);
    inputNode.setAttribute("std", "input");
    inputNode.contentEditable = true;
    this.insertNode(inputNode);

    /*
    // The Java WebView has a kludge to deal with that insertion caret isn't
    // visible until something has inserted into the input line.
    // So we insert U-200B "zero width space". This gets removed in enter.
    // (Note if a space is inserted and removed from the UI then the
    // caret remains visible.  Thus a cleaner work-around would be if
    // we could simulate this.  I haven't gotten that to work so far.)
    */
    //var dummyText = document.createTextNode("\u200B");
    //inputNode.appendChild(dummyText);

    this.inputLine = inputNode;
    this.inputLine.focus();
};

DomTerm.prototype.resetCursorCache = function() {
    this.currentCursorColumn = -1;
    this.currentCursorLine = -1;
};

/** Calculate (lines, columns) from startNode inclusive to stopNode (exclusive).
 * The startNode is the origin - the zero/start location.
 * The stopNode is the goal/end location.
 * The result is a 2-element array, where result[0] is incremented by
 * the number of lines and result[1] the number of columns.
 * Return true id we actually saw stopNode.
*/
DomTerm.prototype.delta2D = function(startNode, stopNode, result) {
    //console.log("delta2D start start:%s stop:%s ->%s:%s", startNode, stopNode, result[0], result[1]);
    if (startNode == stopNode)
        return true;
    if (startNode instanceof Text) {
        var tnode = startNode;
        var text = tnode.textContent;
        var tlen = text.length;
        var line = result[0];
        var col = result[1];
        for (var i = 0; i < tlen;  i++) {
            var ch = text.charCodeAt(i);

            col = this.updateColumn(ch, col);
            if (col > this.columnWidth) {
                line++;
                col = this.updateColumn(ch, 0);
            }
            else if (col == -1) {
                line++;
                col = 0;
                if (ch == 13 /*'\r'*/ && i+1<tlen
                    && text.charCodeAt(i+1) == 10 /*'\n'*/)
                    i++;
            }
        }
        result[0] = line;
        result[1] = col;
        return false;
    }
    if (this.isBreakNode(startNode)) {
        result[0] = result[0] + 1;
        result[1] = 0;
        return false;
    }
    if (startNode instanceof Element) {
        if (this.isObjectElement(startNode)) {
            // FIXME
        }
        for (var n = startNode.firstChild; n != null;
             n = n.nextSibling) {
            if (this.delta2D(n, stopNode, result))
                return true;
        }
        if (this.isBlockNode(startNode)) {
            // Combine with isBreadNode case FIXME?
            result[0] = result[0] + 1;
            result[1] = 0;
            return false;
        }
    }
    return false;
};

DomTerm.prototype.updateCursorCache = function() {
    var tmp = this.delta2DHelper;
    tmp[0] = 0;
    tmp[1] = 0;
    var x = this.delta2D(this.cursorHome, this.outputBefore, tmp);
    //console.log("updateCursorCache outBef:%s ->%s:%s r:%s", this.outputBefore, tmp[0], tmp[1], x);
    this.currentCursorLine = tmp[0];
    this.currentCursorColumn = tmp[1];
};

/** Get line of current cursor position.
 * This is 0-origin (i.e. 0 is the top line), relative to cursorHome. */
DomTerm.prototype.getCursorLine = function() {
    if (this.currentCursorLine < 0)
        this.updateCursorCache();
    return this.currentCursorLine;
};

/** Get column of current cursor position.
 * This is 0-origin (i.e. 0 is the left column), relative to cursorHome. */
DomTerm.prototype.getCursorColumn = function() {
    if (this.currentCursorColumn < 0)
        this.updateCursorCache();
    return this.currentCursorColumn;
};

DomTerm.prototype.grabInput = function(input) {
    if (input instanceof Text)
        return input.data;
    if (this.isSpanNode(input) && input.getAttribute("line"))
        return "";
    var result = "";
    for (var n = input.firstChild; n != null;
         n = n.nextSibling) {
        result = result + this.grabInput(n);
    }
    return result;
};

DomTerm.prototype.getPendingInput = function() {
    var text = null;
    while (this.pendingInput != this.inputLine && text == null) {
        if (this.isSpanNode(pendingInput)) {
            text = this.grabInput(pendingInput);
            if (text.length == 0)
                text = null;
        } else if (this.isBreakNode(this.pendingInput)) {
                text = "\n";
        } else if (this.pendingInput instanceof Text) {
            text = pendingInput.data;
            if (text.length == 0)
                text = null;
        } else {
            //WTDebug.println("UNEXPECTED NODE: "+WTDebug.pnode(pendingInput));
        }
        this.pendingInput = this.pendingInput.nextSibling;
    }
    this.outputBefore = this.pendingInput;
    return text;
};

DomTerm.prototype.handleEnter = function(event) {
    this._doDeferredDeletion();
    // For now we only support the normal case when  outputSave == inputLine.
    var oldInputLine = this.inputLine;
    var text = this.grabInput(oldInputLine);
    var spanNode;
    if (this.clientDoesEcho) {
        this._deferredForDeletion = oldInputLine;
        spanNode = this.createSpanNode();
        spanNode.setAttribute("class", "domterm-dummy");
        oldInputLine.appendChild(spanNode);
    }
    oldInputLine.removeAttribute("contenteditable");
    var line = this.getCursorLine();
    var column = this.getCursorColumn();
    this.outputBefore = oldInputLine.nextSibling;
    this.outputContainer = oldInputLine.parentNode;
    this.inputLine = null; // To avoid confusing cursorLineStart
    this.cursorLineStart(1);
    this.addInputLine();
    if (this.clientDoesEcho) {
        this.outputBefore = spanNode;
        this.outputContainer = oldInputLine;
        this.currentCursorLine = line;
        this.currentCursorColumn = column;
    }
    return text;
};

DomTerm.prototype.appendText = function(parent, data) {
    if (data.length == 0)
        return;
    var last = parent.lastChild;
    if (last instanceof Text)
        last.appendData(data);
    else
        parent.appendChild(document.createTextNode(data));
};

/** Insert a <br> node. */
DomTerm.prototype.insertBreak = function() {
    var breakNode = document.createElement("br");
    this.insertNode(breakNode);
    this.currentCursorColumn = 0;
    if (this.currentCursorLine >= 0)
        this.currentCursorLine++;
};

/** Erase from the current position until stopNode.
 * If currently inside stopNode, erase to end of stopNode;
 * otherwise erase until start of stopNode.
 */
DomTerm.prototype.eraseUntil = function(stopNode) {
    this.deleteLinesIgnoreScroll(this.numRows-this.getCursorLine());
    /*
    var current = this.outputBefore;
    var parent = this.outputContainer;
    if (current==this.inputLine && current != null)
        current=current.nextSibling;
    for (;;) {
        if (current == stopNode)
            break;
        if (current == null) {
            current = parent;
            parent = current.parentNode;
        } else {
            var next = current.nextSibling;
            parent.removeChild(current);
            current = next;
        }
    }
    var line = this.homeLine + this.getCursorLine();
    var lastEnd = this.lineEnds[line];
    //console.log("updateLine homestart:%s curL:%s line:%s last:%s",  this.homeLine, this.getCursorLine(). line, lastEnd);
    this.lineStarts.length = line+1;
    this.lineEnds.length = line+1;
    this.lineEnds[line]= lastEnd;
    stopNode.appendChild(lastEnd);
*/
};

/** Erase or delete characters in the current line.
 * If 'doDelete' is true delete characters (and move the rest of the line left);
 * if 'doDelete' is false erase characters (replace them with space).
 * The 'count' is the number of characters to erase/delete;
 * a count of -1 or -2 means erase to the end of the line.
 * The value -2 means also erase the end-of-line marker
 * (unless it has the line="end" property).  Does not update lineStart/lineEnd.
 */
DomTerm.prototype.eraseCharactersRight = function(count, doDelete) {
    var todo = count >= 0 ? count : 999999999;
    // Note that the traversal logic is similar to move.
    var current = this.outputBefore;
    var parent = this.outputContainer;
    var lineEnd = this.lineEnds[this.homeLine+this.getCursorLine()];
    if (current==this.inputLine && current != null)
        current=current.nextSibling;
    var curColumn = -1;
    for (;;) {
        if (current == lineEnd) {
            if (count == -2) {
                parent = current.parentNode; // Probably redundant
                parent.removeChild(current);
                while (this.isSpanNode(parent) && parent.firstChild == null) {
                    var pparent = parent.parentNode;
                    pparent.removeChild(parent);
                    parent = pparent;
                }
            }
            break;
        }
        if (this.isBreakNode(current) || todo <= 0) {
            break;
        }
        else if (current instanceof Text) {
            var tnode = current;
            var text = tnode.textContent;
            var length = text.length;

            var i = 0;
            if (count < 0) {
                i = length;
            } else {
                for (; i < length; i++) {
                    if (todo <= 0)
                        break;
                    var ch = text.charCodeAt(i);
                    // Optimization - don't need to calculate getCurrentColumn.
                    if (ch >= 32/*' '*/ && ch < 127) {
                        todo--;
                    }
                    else if (ch == 13/*'\r'*/ || ch == 10/*'\n'*/ || ch == 12/*'\f'*/) {
                        todo = 0;
                        break;
                    }
                    else {
                        if (curColumn < 0)
                            curColumn = this.getCursorColumn();
                        var col = this.updateColumn(ch,
                                                    curColumn+(count-todo));
                        todo = count - (col - curColumn);
                        // general case using updateColumn FIXME
                    }
                }
            }

            if (i >= length && doDelete) {
                var next = current.nextSibling;
                parent.removeChild(current);
                current = next;
                //break;
            }
            else {
                if (doDelete)
                    tnode.deleteData(0, i);
                else {
                    tnode.replaceData(0, i, DomTerm.makeSpaces(i));
                }
            }
            continue;
        } else if (current instanceof Element) {
            if (this.isObjectElement(current)) {
                var next = current.nextSibling;
                parent.removeChild(current);
                current = next;
                todo--;
                continue;
            }
        }

        var ch;
        if (current != null) {
            // If there is a child, go to the first child next.
            ch = current.firstChild;
            if (ch != null) {
                parent = current;
                current = ch;
                continue;
            }
            // Otherwise, go to the next sibling.
            ch = current.nextSibling;
            if (ch != null) {
                current = ch;
                continue;
            }

            // Otherwise go to the parent's sibling - but this gets complicated.
            if (this.isBlockNode(current))
                break;
        }

        //ch = current;
        for (;;) {
            if (parent == this.topNode) {
                return;
            }
            if (! parent)
                this.log("null parent in eraseCharactersRight!");
            var sib = parent.nextSibling;
            var pparent = parent.parentNode;
            if (this.isSpanNode(parent) && parent.firstChild == null)
                pparent.removeChild(parent);
            parent = pparent;
            if (sib != null) {
                current = sib;
                break;
            }
        }
    }
};


DomTerm.prototype.eraseLineRight = function() {
    this.eraseCharactersRight(-1, true);
};

DomTerm.prototype.eraseLineLeft = function() {
    var column = getCursorColumn();
    this.cursorLineStart(0);
    this.eraseCharactersRight(column, false);
    this.cursorRight(column);
};

DomTerm.prototype.rgb = function(r,g,b) {
    return "rgb("+this.getParameter(i+2,0)
        +","+this.getParameter(i+3,0)
        +","+this.getParameter(i+4,0)+")";
};

DomTerm.prototype.color256 = function(u) {
    // FIXME This is just the default - could be overridden.
    //   0.. 16: system colors
    if (u < 16) {
        switch (u) {
        case 0: return this.rgb(0x00, 0x00, 0x00); // Black
        case 1: return this.rgb(0xB2, 0x18, 0x18); // Red
        case 2: return this.rgb(0x18, 0xB2, 0x18); // Green
        case 3: return this.rgb(0xB2, 0x68, 0x18); // Yellow
        case 4: return this.rgb(0x18, 0x18, 0xB2); // Blue
        case 5: return this.rgb(0xB2, 0x18, 0xB2); // Magenta
        case 6: return this.rgb(0x18, 0xB2, 0xB2); // Cyan
        case 7: return this.rgb(0xB2, 0xB2, 0xB2); // White
            // intensive versions
        case 8: return this.rgb(0x68, 0x68, 0x68);
        case 9: return this.rgb(0xFF, 0x54, 0x54);
        case 10: return this.rgb(0x54, 0xFF, 0x54);
        case 11: return this.rgb(0xFF, 0xFF, 0x54);
        case 12: return this.rgb(0x54, 0x54, 0xFF);
        case 13: return this.rgb(0xFF, 0x54, 0xFF);
        case 14: return this.rgb(0x54, 0xFF, 0xFF);
        case 15: return this.rgb(0xFF, 0xFF, 0xFF);
        }
    }
    u -= 16;

    //  16..231: 6x6x6 rgb color cube
    if (u < 216) {
        return this.rgb(((u / 36) % 6) ? (40 * ((u / 36) % 6) + 55) : 0,
                        ((u / 6) % 6) ? (40 * ((u / 6) % 6) + 55) : 0,
                        ((u / 1) % 6) ? (40 * ((u / 1) % 6) + 55) : 0);
    }
    u -= 216;

    // 232..255: gray, leaving out black and white
    var gray = u * 10 + 8;
    return this.rgb(gray, gray, gray);
};

DomTerm.prototype.getParameter = function(index, defaultValue) {
    var arr = this.parameters;
    return arr.length > index && arr[index] ? arr[index] : defaultValue;
}

DomTerm.prototype.handleControlSequence = function(last) {
    var param;
    switch (last) {
    case 64 /*'@'*/:
        var saveInsertMode = this.insertMode;
        this.insertMode = true;
        param = this.getParameter(0, 1);
        this.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param,
                           'O', this.getCursorColumn()+param);
        this.cursorLeft(param);
        this.insertMode = saveInsertMode;
        break;
    case 65 /*'A'*/: // cursor up
        this.cursorDown(- this.getParameter(0, 1));
        break;
    case 66 /*'B'*/: // cursor down
        this.cursorDown(this.getParameter(0, 1));
        break;
    case 67 /*'C'*/:
        this.cursorRight(this.getParameter(0, 1));
        break;
    case 68 /*'D'*/:
        this.cursorLeft(this.getParameter(0, 1));
        break;
    case 71 /*'G*/:
        this.moveTo(this.getCursorLine(), this.getParameter(0, 1)-1);
        break;
    case 72 /*'H*/:
        this.moveTo(this.getParameter(0, 1)-1, this.getParameter(1, 1)-1);
        break;
    case 74 /*'J'*/:
        param = this.getParameter(0, 0);
        if (param == 0) // Erase below.
            this.eraseUntil(this.topNode);
        else {
            var saveLine = this.getCursorLine();
            var saveCol = this.getCursorColumn();
            if (param == 1) { // Erase above
                for (var line = 0;  line < saveLine;  line++) {
                    this.moveTo(line, 0);
                    this.eraseLineRight();
                }
                if (saveCol != 0) {
                    this.moveTo(saveLine, 0);
                    this.raseCharactersRight(saveCol, false);
                }
            } else { // Erase all
                this.moveTo(0, 0);
                this.eraseUntil(this.topNode);
            }
        }
        break;
    case 75 /*'K'*/:
        param = this.getParameter(0, 0);
        if (param != 1) {
            this.eraseLineRight();
            var lineEnd = this.lineEnds[this.homeLine+this.getCursorLine()];
            if (lineEnd.getAttribute("line")=="soft")
                lineEnd.setAttribute("line", "hard");
        }
        if (param >= 1)
            this.eraseLineLeft();
        break;
    case 76 /*'L'*/: // Insert lines
        this.insertLines(this.getParameter(0, 1));
        break;
    case 77 /*'M'*/: // Delete lines
        this.deleteLines(this.getParameter(0, 1));
        break;
    case 80 /*'P'*/: // Delete characters
        this.eraseCharactersRight(this.getParameter(0, 1), true);
        break;
    case 83 /*'S'*/:
        this.scrollForward(this.getParameter(0, 1));
        break;
    case 84 /*'T'*/:
        param = this.getParameter(0, 1);
        if (curNumParameter >= 5)
            ; // FIXME Initiate mouse tracking.
        this.scrollReverse(curNumParameter);
        break;
    case 100 /*'d'*/: // Line Position Absolute
        this.moveTo(this.getParameter(0, 1)-1, this.getCursorColumn());
        break;
    case 104 /*'h'*/:
        param = this.getParameter(0, 0);
        if (this.controlSequenceState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // DEC Private Mode Set (DECSET)
            switch (param) {
            case 1000:
                // Send Mouse X & Y on button press and release.
                // This is the X11 xterm mouse protocol.   Sent by emacs.
                break; // FIXME
            case 1006:
                // Enable SGR Mouse Mode.  Sent by emacs.
                break; // FIXME
            case 47:
            case 1047:
                this.setAlternateScreenBuffer(true);
                break;
            case 1048:
                this.saveCursor();
                break;
            case 1049:
                this.saveCursor();
                this.setAlternateScreenBuffer(true);
                break;
            }
        }
        else {
            switch (param) {
            case 4:
                this.insertMode = true;
                break;
            }
        }
        break;
    case 108 /*'l'*/:
        param = this.getParameter(0, 0);
        if (this.controlSequenceState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // DEC Private Mode Reset (DECRST)
            switch (param) {
            case 47:
            case 1047:
                // should clear first?
                this.setAlternateScreenBuffer(false);
                break;
            case 1048:
                this.restoreCursor();
                break;
            case 1049:
                this.setAlternateScreenBuffer(false);
                this.restoreCursor();
                break;
            }
        } else {
            switch (param) {
            case 4:
                insertMode = false;
                break;
            }
        }
        break;
     case 109 /*'m'*/:
        var numParameters = this.parameters.length;
        if (numParameters == 0)
            this._currentStyles.length = 0;
        for (var i = 0; i < numParameters; i++) {
            param = this.getParameter(i, -1);
            if (param <= 0)
                this._currentStyles.length = 0;
            else {
                var nstyles = this._currentStyles.length;
                switch (param) {
                case 1:
                    this._pushStyle("font-weight:", "bold");
                    break;
                case 22:
                    this._pushStyle("font-weight:", null/*"normal"*/);
                    break;
                case 4:
                    this._pushStyle("text-decoration:", "underline");
                    break;
                case 24:
                    this._pushStyle("text-decoration:", null/*"none"*/);
                    break;
                case 7:
                    this._pushStyle("color:", this.defaultBackgroundColor);
                    this._pushStyle("background-color:", this.defaultForegroundColor);
                    break;
                case 27:
                    this._pushStyle("color:", null/*defaultForegroundColor*/);
                    this._pushStyle("background-color:", null/*defaultBackgroundColor*/);
                    break;
                case 30: this._pushStyle("color:", "black"); break;
                case 31: this._pushStyle("color:", "red"); break;
                case 32: this._pushStyle("color:", "green"); break;
                case 33: this._pushStyle("color:", "yellow"); break;
                case 34: this._pushStyle("color:", "blue"); break;
                case 35: this._pushStyle("color:", "magenta"); break;
                case 36: this._pushStyle("color:", "cyan"); break;
                case 37: this._pushStyle("color:", "white"); break;
                case 38:
                case 48:
                    var property = param==38 ? " color" : "background-color:";
                    if (this.getParameter(i+1,-1) == 2
                        && numParameters >= i+5) {
                        var color = 
                            this._pushStyle(property,
                                             this.rgb(this.getParameter(i+2,0),
                                                      this.getParameter(i+3,0),
                                                      this.getParameter(i+4,0)));
                        i += 5;
                    } else if (this.getParameter(i+1,-1) == 5
                               && numParameters >= i+2) {
                        var c = this.getParameter(i+2,0);
                        this._pushStyle(property, c);
                        i += 2;
                    }
                    break;
                case 39: this._pushStyle("color:", null/*defaultForegroundColor*/); break;
                case 40: this._pushStyle("background-color:", "black"); break;
                case 41: this._pushStyle("background-color:", "red"); break;
                case 42: this._pushStyle("background-color:", "green"); break;
                case 43: this._pushStyle("background-color:", "yellow"); break;
                case 44: this._pushStyle("background-color:", "blue"); break;
                case 45: this._pushStyle("background-color:", "magenta"); break;
                case 46: this._pushStyle("background-color:", "cyan"); break;
                case 47: this._pushStyle("background-color:", "white"); break;
                case 49: this._pushStyle("background-color:", null/*defaultBackgroundColor*/); break
                }
            }
        }
        this._adjustStyleNeeded = true;
        if (this.verbosity >= 2)
            console.log("currentStyles: "+this._currentStyles);
        break;
    case 110 /*'n'*/:
        switch (this.getParameter(0, 0)) {
        case 5:
            this.processResponseCharacters("\x1B[0n");
            break;
        case 6:
            this.processResponseCharacters("\x1B["+this.numRows
                                           +";"+this.numColumns+"R");
            break;
        }
        break;
    case 114 /*'r'*/:
        this.scrollRegionTop = this.getParameter(0, 1) - 1;
        this.scrollRegionBottom = this.getParameter(0, -1);
        break;
    case 116 /*'t'*/: // Xterm window manipulation.
        switch (this.getParameter(0, 0)) {
        case 18: // Report the size of the text area in characters.
            this.processResponseCharacters("\x1B[8;"+this.numRows
                                           +";"+this.numColumns+"t");
            break;
        };
        break;
    default:
        ; // FIXME
    }
};

DomTerm.prototype.handleBell = function() {
    // Do nothing, for now.
};

DomTerm.prototype.handleOperatingSystemControl = function(code, text) {
    if (this.verbosity >= 2)
        this.log("handleOperatingSystemControl "+code+" '"+text+"'");
    if (code == 72) {
        inputLine.insertAdjacentHTML("beforeBegin", text);
    } else if (code == 74) {
        var sp = text.indexOf(' ');
        var key = parseInt(text.substring(0, sp), 10);
        var kstr = JSON.parse(text.substring(sp+1));
        this.log("OSC KEY k:"+key+" kstr:"+this.toQuoted(kstr));
        this.lineEditing = true;
        this.doLineEdit(key, kstr);
    } else {
        // WTDebug.println("Saw Operating System Control #"+code+" \""+WTDebug.toQuoted(text)+"\"");
    }
};

DomTerm.prototype._doDeferredDeletion = function() {
    var deferred = this._deferredForDeletion;
    if (deferred) {
        var child = deferred.firstChild;
        while (child && child != this.outputBefore) {
            var next = child.nextSibling;
            deferred.removeChild(child);
            child = next;
        }
        this._deferredForDeletion = null;
    }
}

DomTerm.prototype.insertString = function(str, kind) {
    if (this.verbosity >= 2)
        this.log("insertString '"+this.toQuoted(str)+"' state:"+this.controlSequenceState);
    /*
    var indexTextEnd = function(str, start) {
        var len = str.length;
        for (var i = start; i < len; i++) {
            var ch = str.charCodeAt(i);
            if (ch == 7 || ch == 0)
                return i;
        }
        return i;
    };
    */
    this._doDeferredDeletion();
    var slen = str.length;
    var i = 0;
    var prevEnd = 0;
    var curColumn = this.getCursorColumn();
    for (; i < slen; i++) {
        var ch = str.charCodeAt(i);
        //this.log("- insert char:"+ch+'="'+String.fromCharCode(ch)+'" state:'+this.controlSequenceState);
        switch (this.controlSequenceState) {
        case DomTerm.SEEN_ESC_STATE:
            switch (ch) {
            case 91 /*'['*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_STATE;
                this.parameters.length = 1;
                this.parameters[0] = null;
                continue;
            case 93 /*']'*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_RBRACKET_STATE;
                this.parameters.length = 1;
                this.parameters[0] = null;
                continue;
            case 55 /*'7'*/: // DECSC
                this.saveCursor(); // FIXME
                break;
            case 56 /*'8'*/: // DECRC
                this.restoreCursor(); // FIXME
                break;
            case 77 /*'M'*/: // Reverse index
                this.insertLines(1); // FIXME
                break;
            }
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            prevEnd = i + 1;
            curColumn = this.getCursorColumn();
            break;
        case DomTerm.SEEN_ESC_LBRACKET_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE:
            if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                var plen = this.parameters.length;
                var cur = this.parameters[plen-1];
                cur = cur ? 10 * cur : 0;
                this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
            }
            else if (ch == 59 /*';'*/) {
                this.parameters.push(null);
            } else if (ch == 63 /*'?'*/)
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE;
            else {
                this.handleControlSequence(ch);
                this.parameters.length = 1;
                prevEnd = i + 1;
                curColumn = this.getCursorColumn();
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            }
            continue;

        case DomTerm.SEEN_ESC_RBRACKET_STATE:
            // if (ch == 4) // set/read color palette
            if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                var plen = this.parameters.length;
                var cur = this.parameters[plen-1];
                cur = cur ? 10 * cur : 0;
                this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
            }
            else if (ch == 59 /*';'*/) {
                this.log("enter esc br text state");
                this.controlSequenceState = DomTerm.SEEN_ESC_BRACKET_TEXT_STATE;
                //prevEnd = indexTextEnd(str, i);
                this.parameters.push("");
                prevEnv = i + 1;
                //this.parameters.push(str.substring(i, prevEnd));
                //i = prevEnd;
            } else {
                this.parameters.length = 1;
                prevEnd = i + 1;
                curColumn = this.getCursorColumn();
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            }
            continue;
        case DomTerm.SEEN_ESC_BRACKET_TEXT_STATE:
            if (ch == 7 || ch == 0) {
                this.parameters[1] =
                    this.parameters[1] + str.substring(prevEnv, i);
                this.handleOperatingSystemControl(this.parameters[0], this.parameters[1]);
                this.parameters.length = 1;
                prevEnd = i + 1;
                curColumn = this.getCursorColumn();
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            } else {
                // Do nothing, for now.
            }
            continue;
        case DomTerm.INITIAL_STATE:
            switch (ch) {
            case 13: // '\r' carriage return
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
                //this.currentCursorColumn = column;
                if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                    && this.getCursorLine() !== this.scrollRegionBottom-1) {
                    this.cursorLineStart(1);
                    i++;
                } else {
                    this.cursorLineStart(0);
                }
                prevEnd = i + 1;
                curColumn = 0;
                break;
            case 10: // '\n' newline
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
                if (this.outputLFasCRLF()) {
                    if (this.insertMode) {
                        this.insertRawOutput("\n"); // FIXME
                        if (this.currentCursorLine >= 0)
                            this.currentCursorLine++;
                        this.currentCursorColumn = 0;
                    } else {
                        this.cursorLineStart(1);
                    }
                }
                // Only scroll if this.scrollRegionBottom explicitly set to a value >= 0.
                else if (this.scrollRegionBottom >= 0 // FIXME redundant?
                         && this.getCursorLine() == this.scrollRegionBottom-1)
                    this.scrollForward(1);
                else
                    this.cursorDown(1);
                prevEnd = i + 1;
                curColumn = this.currentCursorColumn;
                break;
            case 27 /* Escape */:
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
                //this.currentCursorColumn = column;
                prevEnd = i + 1;
                this.controlSequenceState = DomTerm.SEEN_ESC_STATE;
                continue;
            case 8 /*'\b'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn); 
                this.cursorLeft(1);
                prevEnd = i + 1; 
                curColumn = this.currentCursorColumn;
                break;
            case 9 /*'\t'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
                var nextStop = this.nextTabCol(this.getCursorColumn());
                console.log("TAB %d-%d", this.currentCursorColumn, nextStop);
                this.cursorRight(nextStop-this.currentCursorColumn);
                curColumn = this.currentCursorColumn;
                prevEnd = i + 1;
                break;
            case 7 /*'\a'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind, curColumn); 
                //this.currentCursorColumn = column;
                this.handleBell();
                prevEnd = i + 1;
                break;
            default:
                var nextColumn = this.updateColumn(ch, curColumn);
                if (nextColumn > this.wrapWidth) {
                    /*
                    if (this.wrapOnLongLines) {
                        this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
                        this.insertWrapBreak();
                        prevEnd = i;
                    }
                    */
                    //line++;
                    nextColumn = this.updateColumn(ch, 0);
                }
                curColumn = nextColumn;
            }
        }
    }
    if (this.controlSequenceState == DomTerm.INITIAL_STATE) {
        this.insertSimpleOutput(str, prevEnd, i, kind, curColumn);
        //this.currentCursorColumn = column;
    }
    if (this.controlSequenceState == DomTerm.SEEN_ESC_BRACKET_TEXT_STATE) {
        this.parameters[1] = this.parameters[1] + str.substring(prevEnv, i);
    }
    if (true) { // FIXME only if "scrollWanted"
        var last = this.topNode.lastChild;
        var lastBottom = last.offsetTop + last.offsetHeight;
        if (lastBottom > this.topNode.scrollTop + this.availHeight)
            this.topNode.scrollTop = lastBottom - this.availHeight;
    }
};

DomTerm.prototype.insertSimpleOutput = function(str, beginIndex, endIndex, kind, endColumn) {
    var sslen = endIndex - beginIndex;
    if (sslen == 0)
        return;

    var slen = str.length;
    if (beginIndex > 0 || endIndex != slen) {
        str = str.substring(beginIndex, endIndex);
        slen = endIndex - beginIndex;
    }
    if (this.verbosity >= 2)
        this.log("insertSimple '"+this.toQuoted(str)+"'"+" adjustStyle:"+this._adjustStyleNeeded);
    if (this._adjustStyleNeeded)
        this._adjustStyle();
    var column =this.getCursorColumn();
    var widthInColums = endColumn-column;
    if (! this.insertMode) {
        this.eraseCharactersRight(widthInColums, true);
    } else if (false && this.wrapOnLongLines) {
        // ????
            this.moveToIn(this.getCursorLine(), this.wrapWidth-widthInColums, false);
            this.eraseCharactersRight(-1, true);
            this.moveTo(this.getCursorLine(), column);
    }
    if (false /* FIXME kind == 'E'*/) {
        var errElement = this.createSpanNode();
        errElement.setAttribute("std", "error");
        //errElement.setAttribute("style", "font-weight: bold; color: green; background: blue");
        //resetCursorCache(); // FIXME - should avoid
        this.insertNode(errElement);
        errElement.appendChild(document.createTextNode(str));
        this.outputBefore = errElement.nextSibling;
    }
    else {
        var beforePos = this.outputBefore.offsetLeft;
        var textNode = this.insertRawOutput(str);
        var afterPos = this.outputBefore.offsetLeft;
        var lineEnd = this.lineEnds[this.homeLine+this.getCursorLine()];
        //this.log("after insert outputBefore:"+this.outputBefore+" lineEnd:"+lineEnd+" out.next:"+this.outputBefore.nextSibling+" line.prev:"+lineEnd.previousSibling+" out.next==line?"+(this.outputBefore.nextSibling==lineEnd)+" beforePos:"+beforePos+" afterPos:"+afterPos);
        var clientWidth = this.initial.clientWidth;
        var excess = afterPos - (clientWidth - this.rightMarginWidth);
        var availWidth = clientWidth - this.rightMarginWidth;
        if (afterPos > availWidth) {
            // wrap needed:
            var textData = textNode.data;
            var textLength = textData.length;
            var goodLength = textLength - slen;
            // number of chars known to require wrapping
            var badLength = textLength;
            // Width in pixels corresponding to goodLength:
            var goodWidth = beforePos;
            // Width in pixels corresponding to badLength:
            var badWidth = afterPos;
            while (goodLength + 1 < badLength) {
                // instead of the midpoint between goodLength and badLength
                // we try to find the fraction of the string corresponding
                // to available width.
                var nextTry =
                    goodLength
                    + Math.round((badLength - goodLength)
                                 * (availWidth - goodWidth)
                                 / (badWidth - goodWidth));
                // Some paranoia:
                var xxxtry = nextTry;
                if (nextTry <= goodLength)
                    nextTry = goodLength + 1;
                else if (nextTry >= badLength)
                    nextTry = badLength - 1;
                // FIXME check for split surrogate pair
                textNode.data = textData.substring(0, nextTry);
                var nextWidth = this.outputBefore.offsetLeft;
                console.log("nextTry: "+xxxtry+"="+goodLength+"("+(badLength-goodLength)+"*"+(availWidth - goodWidth)+"/"+(badWidth - goodWidth)+")"
                            +"->"+nextTry+" goodL:"+goodLength+" badL:"+badLength+" goodW:"+goodWidth+" badW:"+badWidth+" availW:"+availWidth+" nextWidth:"+nextWidth);
                if (nextWidth > availWidth) {
                    badLength = nextTry;
                    badWidth = nextWidth
                } else {
                    goodLength = nextTry;
                    goodWidth = nextWidth;
                }
            }
            if (textNode.data.length != goodLength)
                textNode.data = textData.substring(0, goodLength);
            // ASSUME textNode.data == textData.subString(0, goodLength);
            this.eraseLineRight();
            // insert soft wrap (re-use existing line, but make soft)
            this.cursorLineStart(1);
            lineEnd.setAttribute("line", "soft");
            // insert rest of new line recursively
            this.insertSimpleOutput(textData, goodLength, textLength,
                                   textLength-goodLength);
            endColumn = this.currentCursorColumn;
        }
        // FIXME This does doesn't seem to work on Chrome:
        // It doesn't handle offsetLength the same as Mozilla.
        else if (! lineEnd) {
            // FIXME
            this.log("bad lineEnd");
        }
        else if (lineEnd.offsetLeft > availWidth) {
            // FIXME there may be stuff between outputBefore and
            // lineEnd, and it may need to be truncated.
            // truncate needed:
            // FIXME find out much between outputBefore and lineEnd fits
            // remove whatever doesn't fit.
        }
        //console.log("after insert ["+str+"]"+" out:"+this.outputBefore+" o.left:"+this.outputBefore.offsetLeft+" curL:"+this.getCursorLine()+" lineEnd:"+this.lineEnds[this.getCursorLine()]+" .oL="+this.lineEnds[this.getCursorLine()].offsetLeft);
    }
    this.currentCursorColumn = endColumn;
};

DomTerm.prototype.insertRawOutput = function( str) {
    var node
        = this.outputBefore != null ? this.outputBefore.previousSibling
        : this.outputContainer.lastChild;
    if (node instanceof Text)
        node.appendData(str);
    else {
        node = document.createTextNode(str);
        this.insertNode(node);
    }
    /*
    var strRect = this.outputContainer.getBoundingClientRect();
    var topRect = this.topNode.getBoundingClientRect();
    if (strRect.right > topRect.right - charWidth) {
    }
    */
    return node;
};

/** Insert element at current position, and move to start of element.
 * @param element to be inserted at current output position.
 *  This element should have no parents *or* children.
 *  It becomes the new outputContainer.
 */
DomTerm.prototype.pushIntoElement = function(element) {
    this.resetCursorCache(); // FIXME - not needed if element is span, say.
    this.insertNode(element);
    this.outputContainer = element;
    this.outputBefore = null;
};

/** Move position to follow current container. */
DomTerm.prototype.popFromElement = function() {
    var element = this.outputContainer;
    this.outputContainer = element.parentNode;
    this.outputBefore = element.nextSibling;
};

/** Insert a node at (before) current position.
 * Caller needs to update cursor cache or call resetCursorCache.
 * The node to be inserted at current output position.
 *   (Should not have any parents or siblings.)
 */
DomTerm.prototype.insertNode = function (node) {
    this.outputContainer.insertBefore(node, this.outputBefore);
};

/** Send a response to the client.
* By default just calls processInputCharacters.
*/
DomTerm.prototype.processResponseCharacters = function(str) {
    this.processInputCharacters(str);
};

/** This function should be overidden. */
DomTerm.prototype.processInputCharacters = function(str) {
    this.log("processInputCharacters called with %s characters", str.length);
};

function dtest(x) {
    return "[dtest: "+x+"]";
}

DomTerm.prototype.wtest = function (x) {
    this.log("called wtest");
    return dtest(x);
};

DomTerm.prototype.processEnter = function(event) {
    var text = this.handleEnter(event);
    if (this.verbosity >= 2)
        this.log("processEnter \""+this.toQuoted(text)+"\"");
    this.processInputCharacters(text+"\r");
};

DomTerm.prototype.isApplicationMode = function() {
    return true;
};

DomTerm.prototype.arrowKeySequence = function(ch) {
    return (this.isApplicationMode() ? "\x1BO" : "\x1B[")+ch;
};

DomTerm.prototype.keyDownToString = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    switch (key) {
    case 8: /* Backspace */ return "\177";
    case 9: /* Tab */    return "\t";
    case 27: /* Esc */   return "\x1B";
    case 33 /* PageUp*/: return "\x1B[5~";
    case 34 /* PageDown*/:return"\x1B[6~";
    case 35 /*End*/:     return "\x1B[4~";
    case 36 /*Home*/:    return "\x1B[1~";
    case 37 /*Left*/:  return this.arrowKeySequence("D");
    case 38 /*Up*/:    return this.arrowKeySequence("A");
    case 39 /*Right*/: return this.arrowKeySequence("C");
    case 40 /*Down*/:  return this.arrowKeySequence("B");
    case 45 /*Insert*/:  return "\x1B[2~";
    case 46 /*Delete*/:  return "\x1B[3~"; // In some modes: 127;
    case 112: /* F1 */   return "\x1BOP";
    case 113: /* F2 */   return "\x1BOQ";
    case 114: /* F3 */   return "\x1BOR";
    case 115: /* F4 */   return "\x1BOS";
    case 116: /* F5 */   return "\x1B[15~";
    case 117: /* F6 */   return "\x1B[17~";
    case 118: /* F7 */   return "\x1B[18~";
    case 119: /* F8 */   return "\x1B[19~";
    case 120: /* F9 */   return "\x1B[20~";
    case 121: /* F10 */  return "\x1B[21~";
    case 122: /* F11 */  return "\x1B[23~";
    case 123: /* F12 */  return "\x1B[24~";
    case 124: /* F13 */  return "\x1B[1;2P";
    case 125: /* F14 */  return "\x1B[1;2Q";
    case 126: /* F15 */  return "\x1B[1;2R";
    case 127: /* F16 */  return "\x1B[1;2S";
    case 128: /* F17 */  return "\x1B[15;2~";
    case 129: /* F18 */  return "\x1B[17;2~";
    case 130: /* F19 */  return "\x1B[18;2~";
    case 131: /* F20 */  return "\x1B[19;2~";
    case 132: /* F21 */  return "\x1B[20;2~";
    case 133: /* F22 */  return "\x1B[21;2~";
    case 134: /* F23 */  return "\x1B[23;2~";
    case 135: /* F24 */  return "\x1B[24;2~";
    default:
        if (event.ctrlKey && key >=65 && key <= 90) {
            return String.fromCharCode(key-64);
        }
        else if (event.altKey || event.metaKey) {
            var str = String.fromCharCode(key);
            if (! event.shiftKey)
                str = str.toLowerCase();
            return (event.altKey ? "\x1B" : "\x18@s") + str;
        }
        return null;
    }
};

DomTerm.prototype.pasteText = function(str) {
    if (this.lineEditing) {
        var rng = bililiteRange(this.inputLine).bounds('selection');
        rng.text(str, 'end');
        rng.select();
    } else {
        this.processInputCharacters(str);
    }
};

DomTerm.prototype.doLineEdit = function(key, str) {
    this.log("doLineEdit "+key+" "+JSON.stringify(str));
    var rng = bililiteRange(this.inputLine).bounds('selection');
    switch (key) {
    case 8:
        rng.sendkeys('{Backspace}');
        rng.select();
        break;
    case 37:
        rng.sendkeys('{ArrowLeft}');
        rng.select();
        break;
    case 39:
        rng.sendkeys('{ArrowRight}');
        rng.select();
        break;
    case 46:
        rng.sendkeys('{Delete}');
        rng.select();
        break;
    default:
        rng.text(str, 'end');
        rng.select();
    }
};

DomTerm.prototype.getSelectedText = function() {
    return window.getSelection().toString();
};

DomTerm.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" data:"+event.data+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event);
    if (this.lineEditing) {
        if (key == 13) {
            event.preventDefault();
            this.processEnter(event);
            if (this.autoEditing)
                this.lineEditing = false;
        }
        else if (key == 68 && event.ctrlKey
                 && this.grabInput(this.inputLine).length == 0) {
            this.log("ctrl-D");
            if (this.autoEditing)
                this.lineEditing = false;
            this.processInputCharacters(this.keyDownToString(event));
        } else if (this.useDoLineEdit) {
            var str = this.keyDownToString(event);
            if (str) {
                event.preventDefault();
                this.log("KEY "+key+" "+JSON.stringify(str));
                this.doLineEdit(key, str);
            }
        }
    } else {
        var str = this.keyDownToString(event);
        if (str) {
            event.preventDefault();
            if (this.autoEditing)
                this.reportEvent("KEY", ""+key+" "+JSON.stringify(str));
            else
                this.processInputCharacters(str);
        }
    }
};

DomTerm.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" data:"+event.data+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" t:"+this.grabInput(this.inputLine)+" lineEdit:"+this.lineEditing+" inputLine:"+this.inputLine);
    if (this.lineEditing) {
        if (this.useDoLineEdit) {
            event.preventDefault();
            var str = String.fromCharCode(key);
            this.doLineEdit(-key, str);
        }
        this.inputLine.focus();
    } else {
        if (event.which !== 0
            && key != 8
            && ! (event.ctrlKey && key >= 97 && key <= 122)) {
            var str = String.fromCharCode(key);
            if (this.autoEditing)
                this.reportEvent("KEY", ""+(-key)+" "+JSON.stringify(str));
            else
                this.processInputCharacters(str);
        }
        event.preventDefault();
    }
};

// For debugging
DomTerm.prototype.toQuoted = function(str) {
    var i = 0;
    var len = str.length;
    for (;  i < len;  i++) {
        var enc = null;
        var ch = str.charCodeAt(i);
        if (ch == 13)
           enc = "\\r";
        else if (ch == 10)
            enc = "\\n";
        else if (ch == 9)
            enc = "\\t";
        else if (ch == 27)
            enc = "\\E";
        else if (ch < 32 || ch >= 127)
            enc = String.fromCharCode(92,((ch>>6)&7)+48,((ch>>3)&7)+48,(ch&7)+48);
        else if (ch == 34 /*'\"'*/ || ch == 39 /*'\''*/)
            enc = String.fromCharCode(92, ch);
        if (enc) {
            var delta = enc.length - 1;
            str = str.substring(0, i)+enc+str.substring(i+1);
            len += delta;
            i += delta;
        }
    }
    return str;
};

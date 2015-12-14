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

"use strict";

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
    // character when switching from character to line mode,
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
    this._currentStyleMap = new Map();
    this._currentStyleSpan = null;

    this.defaultBackgroundColor = "white";
    this.defaultForegroundColor = "black";

    this.usingAlternateScreenBuffer = false;
    this.savedCursorHome = null;
    this.savedHomeLine = -1;

    this.history = new Array();
    this.historyCursor = -1;

    if (topNode)
        this.initializeTerminal(topNode);
}

// For debugging (may be overridden)
DomTerm.prototype.log = function(str) {
    // JSON.stringify encodes escape as "\\u001b" which is hard to read.
    str = str.replace(/\\u001b/g, "\\e");
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
DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE = 5;

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

DomTerm.prototype.widthInColumns = function(str, start, end) {
    var w = 0;
    for (var i = start; i < end;  i++) {
        var ch = str.charCodeAt(i);
        w = this.updateColumn(ch, w);
        if (w < 0)
            w = 0;
    }
    return w;
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
 * @param goalColumn number of columns to move right from the start of the goalLine
 * @param addSpaceAsNeeded if we should add blank linesor spaces if needed to move as requested; otherwise stop at the last existing line, or (just past the) last existing contents of the goalLine
 */
DomTerm.prototype.moveToIn = function(goalLine, goalColumn, addSpaceAsNeeded) {
    var line = this.getCursorLine();
    var column = this.getCursorColumn();
    if (this.verbosity >= 3)
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

            var preNode = document.createElement("pre");
            // preNode.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
            var lastParent = last;
            for (;;) {
                var tag = lastParent.tagName;
                if (tag == "PRE" || tag == "DIV" || tag == "P")
                    break;
                var p = lastParent.parentNode;
                if (p == this.initial)
                    break;
                lastParent = p;
            }
            lastParent.parentNode.appendChild(preNode);
            var next = this._createLineNode("hard", "\n");
            preNode.appendChild(next);
            this.lineStarts[lineCount] = preNode;
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
                    // FIXME maybe use _normalize1
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
    this.moveTo(this.getCursorLine(), this.getCursorColumn()+count);
};

DomTerm.prototype.cursorLeft = function(count) {
    if (count == 0)
        return;
    var prev = this.outputBefore ? this.outputBefore.previousSibling
        : this.outputContainer.lastChild;
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
            if (tcount == len)
                prev.parentNode.removeChild(prev);
            else
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

// Should we treat LF as CR-LF ?
// FIXME Perhaps we should just have the Client convert LF to CR-LF
DomTerm.prototype.outputLFasCRLF = function() {
    return ! this.clientDoesEcho;
};

/** Add a style property specifier to the _currentStyleMap.
 * However, if the new specifier "cancels" an existing specifier,
 * just remove the old one.
 * @param styleName style property name (for example "text-decoration").
 * @param styleValue style property value string (for example "underline"),
 *     or null to indicate the default value.
 */
DomTerm.prototype._pushStyle = function(styleName, styleValue) {
    if (styleValue)
        this._currentStyleMap.set(styleName, styleValue);
    else
        this._currentStyleMap.delete(styleName);
    this._currentStyleSpan = null;
};

DomTerm.prototype._clearStyle = function() {
    var std = this._currentStyleMap.get("std");
    this._currentStyleMap.clear();
    if (std != null)
        this._currentStyleMap.set("std", std);
};

/** Adjust style at current position to match desired style.
 * The desired style is a specified by the _currentStyleMap.
 * This usually means adding {@code <span style=...>} nodes around the
 * current position.  If the current position is already inside
 * a {@code <span style=...>} node that doesn't match the desired style,
 * then we have to split the {@code span} node so the current
 * position is not inside the span node, but text before and after is.
 */
DomTerm.prototype._adjustStyle = function() {
    var parentSpan = this.outputContainer;
    var inStyleSpan = parentSpan.getAttribute("class") == "term-style";
    if (this._currentStyleMap.size == 0 && ! inStyleSpan) {
        this._currentStyleSpan = parentSpan;
        return;
    }
    var inputLineMoved = false;
    if (this.inputLine == this.outputBefore) {
        this.outputBefore = this.outputBefore.nextSibling;
        parentSpan.removeChild(this.inputLine);
        inputLineMoved = true;
    }
    if (inStyleSpan) {
        if (this.outputBefore) {
            // split into new child
            var restSpan = this.createSpanNode();
            parentSpan.parentNode.insertBefore(restSpan,
                                               parentSpan.nextSibling);
            // Copy attributes
            this._copyAttributes(parentSpan, restSpan);
            this._moveNodes(this.outputBefore, restSpan);
        }
        this.outputContainer = parentSpan.parentNode;
        this.outputBefore = parentSpan.nextSibling;
    }
    if (this._currentStyleMap.size != 0) {
        var styleSpan = this.createSpanNode();
        styleSpan.setAttribute("class", "term-style");
        var styleAttr = null;
        var decoration = null;
        var reverse = false;
        var fgcolor = null;
        var bgcolor = null;
        for (var key of this._currentStyleMap.keys()) {
            var value = this._currentStyleMap.get(key);
            switch (key) {
            case "reverse":
                reverse = true;
                break;
            case "color":
                fgcolor = value;
                break;
            case "background-color":
                bgcolor = value;
                break;
            case "text-underline":
                decoration = decoration ? decoration + " underline" : "underline";
                break;
            case "text-overline":
                decoration = decoration ? decoration + " overline" : "overline";
                break;
            case "text-blink":
                decoration = decoration ? decoration + " blink" : "blink";
                break;
            case "text-line-through":
                decoration = decoration ? decoration + " line-through" : "line-through";
                break;
            case "std":
            case "font-weight":
                styleSpan.setAttribute(key, value);
                break;
            }
        }
        if (reverse) {
            var tmp = bgcolor ? bgcolor : this.defaultBackgroundColor;
            bgcolor = fgcolor ? fgcolor : this.defaultForegroundColor;
            fgcolor = tmp;
        }
        if (fgcolor) {
            styleSpan.setAttribute("color", fgcolor);
            if (fgcolor.length > 0 && fgcolor.charCodeAt(0) == 35) {
                fgcolor = "color: "+fgcolor;
                styleAttr = styleAttr ? styleAttr+";"+fgcolor : fgcolor;
            }
        }
        if (bgcolor) {
            styleSpan.setAttribute("background-color", bgcolor);
            if (bgcolor.length > 0 && bgcolor.charCodeAt(0) == 35) {
                bgcolor = "background-color: "+bgcolor;
                styleAttr = styleAttr ? styleAttr+";"+bgcolor : bgcolor;
            }
        }
        if (styleAttr)
            styleSpan.setAttribute("style", styleAttr);
        if (decoration)
            styleSpan.setAttribute("text-decoration", decoration);
        /* Possibly optimization: FIXME
           This optimization only works if before a matching style span;
           should also do it if we were inStyleSpan.
           if (this.outputBefore is a span whose attributes
           match the new styleSpan)
           styleSpan = this.outputBefore;
           else
           [Maybe do the match at the same time as setAttribute using:
           function styleSet(newSpan, attrName, attrValue, oldSpan) {
               newSpan.setAttribute(attrName. attrValue);
               return oldSpan && oldSpan.getAttribute(attrName)==attrValue;
           }]
        */
        this.outputContainer.insertBefore(styleSpan, this.outputBefore);
        this._currentStyleSpan = styleSpan;
        this.outputContainer = styleSpan;
        // styleSpan.firstChild is null unless we did the above optimization
        this.outputBefore = styleSpan.firstChild;
    }
    if (inputLineMoved) {
        this.outputContainer.insertBefore(this.inputLine, this.outputBefore);
        this.outputBefore = this.inputLine;
    }
};

DomTerm.prototype.insertLinesIgnoreScroll = function(count) {
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
        // FIXME create new <pre> nodes
        var newLine = this._createLineNode("hard", "\n");
        this.outputContainer.insertBefore(newLine, pos);
        this.lineEnds[absLine+i] = newLine;
        this.lineStarts[absLine+i+1] = newLine;
    }
    if (column != null)
        this.moveTo(line, column);
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
    var line = this.getCursorLine();
    var absLine = this.homeLine+line;
    var start = this.lineStarts[absLine];
    var startPrevious = start.previousSibling;
    var startParent = start.parentNode;
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
            while (parent.firstChild == null && parent != this.initial) {
                cur = parent;
                parent = parent.parentNode;
                next = cur.nextSibling;
                parent.removeChild(cur);
                cur = next;
            }
        }
    }
    if (start.parentNode == null) {
        start = startPrevious ? startPrevious.nextSibling : null;
        this.lineStarts[absLine] = start ? start : startParent.firstChild;
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
    // If inputLine was among deleted content, put it just before end.
    if (inputRoot != this._rootNode(inputLine)) {
        if (inputLine.parentNode)
            inputLine.parentNode.removeChild(inputLine);
        if (! end.parentNode) {
            this.log("bad end node "+end);
        }
        end.parentNode.insertBefore(inputLine, end);
        end = inputLine;
    }
    this.outputBefore = end;
    this.outputContainer = end.parentNode;
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
    var helperNode = document.createElement("pre");
    helperNode.setAttribute("id", this.makeId("helper"));
    helperNode.setAttribute("style", "position: absolute; visibility: hidden");
    topNode.insertBefore(helperNode, topNode.firstChild);
    var rulerNode = document.createElement("span");
    rulerNode.setAttribute("id", this.makeId("ruler"));
    rulerNode.setAttribute("class", "wrap");
    rulerNode.appendChild(document
                          .createTextNode("abcdefghijklmnopqrstuvwxyz"));
    this._rulerNode = rulerNode;
    helperNode.appendChild(rulerNode);

    var wrapDummy = this._createLineNode("soft", null);
    helperNode.appendChild(wrapDummy);
    this._wrapDummy = wrapDummy;

    var dt = this;
    this._resizeHandler = null;
    // FIXME we want the resize-sensor to be a child of helperNode
    new ResizeSensor(topNode, function () {
        // See https://developer.mozilla.org/en-US/docs/Web/Events/resize#Example
        if (! dt._resizeHandler) {
            dt._resizeHandler = setTimeout(function() {
                dt._resizeHandler = null;
                if (dt.verbosity > 0)
                    dt.log("ResizeSensor called"); 
                var oldWidth = dt.availWidth;
                dt.measureWindow();
                if (dt.availWidth != oldWidth)
                    dt._breakAllLines(oldWidth);
            }, 100 /* milli-seconds */);
        }
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
    var preNode = document.createElement("pre");
    mainNode.appendChild(preNode);
    this.lineStarts[0] = preNode;
    this.outputContainer = preNode;
    this.cursorHome = preNode;
    this.addInputLine();
    this.outputBefore = this.inputLine;
    this.pendingInput = this.inputLine;
    var lineEnd = this._createLineNode("hard", "\n");
    preNode.appendChild(lineEnd);
    this.lineEnds[0] = lineEnd;

    this.measureWindow();

};

DomTerm.prototype.measureWindow = function()  {
    var ruler = this._rulerNode;
    var rect = ruler.getBoundingClientRect()
    var charWidth = ruler.offsetWidth/26.0;
    var charHeight = ruler.parentNode.offsetHeight;
    this.rightMarginWidth = this._wrapDummy.offsetWidth;
    this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.topNode+" clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.initial.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+charWidth+" chH:"+charHeight+" ht:"+availHeight);
    // We calculate rows from initial.clientWidth because we don't
    // want to include the scroll-bar.  On the other hand, for vertical
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
    this.log("ruler ow:"+ruler.offsetWidth+" cl-h:"+ruler.clientHeight+" cl-w:"+ruler.clientWidth+" = "+(ruler.offsetWidth/26.0)+"/char h:"+ruler.offsetHeight+" rect:.l:"+rect.left+" r:"+rect.right+" r.t:"+rect.top+" r.b:"+rect.bottom+" numCols:"+this.numColumns+" numRows:"+this.numRows);
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
    inputNode.spellcheck = false;
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
};

DomTerm.prototype.resetCursorCache = function() {
    this.currentCursorColumn = -1;
    this.currentCursorLine = -1;
};

DomTerm.prototype.updateCursorCache = function() {
    var goal = this.outputBefore;
    var line = this.currentCursorLine;
    if (line >= 0)
        line += this.homeLine;
    else {
        var n = goal;
        while (n) {
            var tag = n.nodeName;
            if (tag == "PRE" || tag == "P" || tag == "DIV")
                break;
            n = n.parentNode;
        }
        if (n) {
            line = this.homeLine;
            var len = this.lineStarts.length;
            for (; line < len; line++) {
                if (this.lineStarts[line] == n)
                    break;
            }
        }
        if (line < 0)
            line = this.homeLine;
    }
    var parent = this.lineStarts[line];
    var cur = parent.firstChild;
    if (line > 0 && parent == this.lineEnds[line-1]) {
        cur = parent.nextSibling;
        parent = parent.parentNode;
    }
    var col = 0;
    while (cur != goal) {
        if (cur == null) {
            cur = parent.nextSibling;
            parent = parent.parentNode;
            if (cur == null || parent == null) // Shouldn't happen
                break;
        } else if (cur instanceof Element) {
            var tag = cur.nodeName;
            if (tag == "BR") {
                line++;
                col = 0;
                cur = cur.nextSibling;
                continue;
            } else if (tag == "OBJECT" || tag == "IMG") {
                col++;
                cur = cur.nextSibling;
                continue;
           } else if (tag == "A")
                ; //
            else if (tag == "SPAN" && cur.getAttribute("line")) {
                line++;
                col = 0;
                cur = cur.nextSibling;
            } else if (tag == "P" || tag == "PRE" || tag == "DIV")
                ; //
            // FIXME handle line special
            // isBreak
            parent = cur;
            cur = cur.firstChild;
        } else {
            if (cur instanceof Text) {
                var tnode = cur;
                var text = tnode.textContent;
                var tlen = text.length;
                for (var i = 0; i < tlen;  i++) {
                    var ch = text.charCodeAt(i);
                    col = this.updateColumn(ch, col);
                    if (col == -1) {
                        line++;
                        col = 0;
                        if (ch == 13 /*'\r'*/ && i+1<tlen
                            && text.charCodeAt(i+1) == 10 /*'\n'*/)
                            i++;
                    }
                }
            }
            cur = cur.nextSibling;
        }
    }
    this.currentCursorLine = line - this.homeLine;
    this.currentCursorColumn = col;
    return;
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

DomTerm.prototype.historyAdd = function(str) {
    if (this.historyCursor >= 0)
        this.history[this.history.length-1] = str;
    else
        this.history.push(str);
    this.historyCursor = -1;
};

DomTerm.prototype.historyMove = function(delta) {
    var str = this.grabInput(this.inputLine);
    if (this.historyCursor >= 0) {
        this.history[this.historyCursor] = str;
    } else {
        this.historyCursor = this.history.length;
        this.history.push(str);
    }
    var newIndex = this.historyCursor + delta;
    if (newIndex < 0 || newIndex >= this.history.length)
        return; // ERROR FIXME
    this.historyCursor = newIndex;
    str = this.history[newIndex];
    var inputLine = this.inputLine;
    for (var child = inputLine.firstChild; child != null; ) {
        var next = child.nextSibling;
        inputLine.removeChild(child);
        child = next;
    }
    inputLine.appendChild(document.createTextNode(str));
};

DomTerm.prototype.handleEnter = function(event) {
    this._doDeferredDeletion();
    // For now we only support the normal case when outputBefore == inputLine.
    var oldInputLine = this.inputLine;
    var text = this.grabInput(oldInputLine);
    this.historyAdd(text);
    var spanNode;
    oldInputLine.removeAttribute("contenteditable");
    var line = this.getCursorLine();
    this.outputBefore = oldInputLine.nextSibling;
    this.outputContainer = oldInputLine.parentNode;
    this.inputLine = null; // To avoid confusing cursorLineStart
    if (! this.clientDoesEcho)
        this.cursorLineStart(1);
    this.addInputLine();
    if (this.clientDoesEcho) {
        this._deferredForDeletion = oldInputLine;
        this.outputBefore = null;
        this.outputContainer = oldInputLine;
        this.currentCursorLine = line;
        this.currentCursorColumn = -1;
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

DomTerm.prototype._normalize1 = function(tnode) {
    for (;;) {
        var next = tnode.nextSibling;
        if (! (next instanceof Text))
            return;
        tnode.appendData(next.data);
        tnode.parentNode.removeChild(next)
    }
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
    this._clearWrap();
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

DomTerm.prototype._clearWrap = function() {
    var absLine = this.homeLine+this.getCursorLine();
    var lineEnd = this.lineEnds[absLine];
    if (lineEnd.getAttribute("line")=="soft") {
        // Try to convert soft line break to hard break, using a <div>
        // FIXME: note that readline emits "UVW\e[0KX\rXYZ" for a soft
        // break between "UVW" and "XYZ", so we might want to optimize
        // this case.
        var parent = lineEnd.parentNode;
        var pname = parent.nodeName;
        // If lineEnd is inside a SPAN, move it outside.
        while (pname == "SPAN") {
            if (lineEnd.nextSibling) {
                var newSpan = document.createElement(pname);
                this._copyAttributes(parent, newSpan);
                this._moveNodes(lineEnd.nextSibling, newSpan);
                parent.parentNode.insertBefore(newSpan, parent.nextSibling);
            }
            parent.parentNode.insertBefore(lineEnd, parent.nextSibling);
            parent = parent.parentNode;
            pname = parent.nodeName;
        }
        if (pname == "PRE" || pname == "P") {
            var newBlock = document.createElement(pname);
            this._copyAttributes(parent, newBlock);
            this._moveNodes(lineEnd.nextSibling, newBlock);
            this.lineStarts[absLine+1] = newBlock;
            parent.parentNode.insertBefore(newBlock, parent.nextSibling);
        }
        // otherwise we have a non-standard line
        // Regardless, do:
        lineEnd.setAttribute("line", "hard");
        var child = lineEnd.firstChild;
        if (child)
            lineEnd.removeChild(child);
        lineEnd.appendChild(document.createTextNode("\n"));
    }
};

DomTerm.prototype._copyAttributes = function(oldElement, newElement) {
    var attrs = oldElement.attributes;
    for (var i = attrs.length; --i >= 0; ) {
        var attr = attrs[i];
        if (attr.specified)
            newElement.setAttribute(attr.name, attr.value);
    }
};

DomTerm.prototype._moveNodes = function(firstChild, newParent) {
    for (var child = firstChild; child != null; ) {
        var next = child.nextSibling;
        child.parentNode.removeChild(child);
        newParent.appendChild(child);
        child = next;
    }
};

/** Erase or delete characters in the current line.
 * If 'doDelete' is true delete characters (and move the rest of the line left);
 * if 'doDelete' is false erase characters (replace them with space).
 * The 'count' is the number of characters to erase/delete;
 * a count of -1 means erase to the end of the line.
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
    while (current != lineEnd && todo > 0) {
        if (current == null) {
            if (parent == null)
                break; // Shouldn't happen
            current = parent.nextSibling;
            parent = parent.parentNode;
        } else if (current instanceof Element) {
            parent = current;
            current = current.firstChild;
        } else if (current instanceof Text) {
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

            var next = current.nextSibling;
            if (! doDelete)
                tnode.replaceData(0, i, DomTerm.makeSpaces(i));
            else if (i < length)
                tnode.deleteData(0, i);
            else  {
                parent.removeChild(current);
                while (parent.firstChild == null && parent != this.initial) {
                    current = parent;
                    parent = parent.parentNode;
                    next = current.nextSibling;
                    parent.removeChild(current);
                }
            }
            current = next;
        } else { // XML comments? Processing instructions?
            current = current.nextSibling;
        }
    }
};


DomTerm.prototype.eraseLineRight = function() {
    this.eraseCharactersRight(-1, true);
    this._clearWrap();
};

DomTerm.prototype.eraseLineLeft = function() {
    var column = this.getCursorColumn();
    this.cursorLineStart(0);
    this.eraseCharactersRight(column, false);
    this.cursorRight(column);
};

DomTerm.prototype.rgb = function(r,g,b) {
    var digits = "0123456789ABCDEF";
    var r1 = r & 15;
    var g1 = g & 15;
    var b1 = b & 15;
    return String.fromCharCode(35/*'#'*/,
                               digits.charCodeAt((r-r1)/16),
                               digits.charCodeAt(r1),
                               digits.charCodeAt((g-g1)/16),
                               digits.charCodeAt(g1),
                               digits.charCodeAt((b-b1)/16),
                               digits.charCodeAt(b1));
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
        case 7: return this.rgb(0xB2, 0xB2, 0xB2); // White (light gray)
            // intensive versions
        case 8: return this.rgb(0x68, 0x68, 0x68); // dark-gray
        case 9: return this.rgb(0xFF, 0x54, 0x54); // light-red
        case 10: return this.rgb(0x54, 0xFF, 0x54); // light-green
        case 11: return this.rgb(0xFF, 0xFF, 0x54); // light-yellow
        case 12: return this.rgb(0x54, 0x54, 0xFF); // light-blue
        case 13: return this.rgb(0xFF, 0x54, 0xFF); // light-magenta
        case 14: return this.rgb(0x54, 0xFF, 0xFF); // light-cyan
        case 15: return this.rgb(0xFF, 0xFF, 0xFF); // White
        }
    }
    u -= 16;

    //  16..231: 6x6x6 rgb color cube
    if (u < 216) {
        var bcode = u % 6;
        u = (u - bcode) / 6;
        var gcode = u % 6;
        u = (u - gcode) / 6;
        var rcode = u % 6;
        return this.rgb(rcode > 0 ? rcode * 40 + 55 : 0,
                        gcode > 0 ? gcode * 40 + 55 : 0,
                        bcode > 0 ? bcode * 40 + 55 : 0);
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
        this.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param,'O');
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
        if (param != 1)
            this.eraseLineRight();
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
        this._clearWrap();
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
            this._clearStyle();
        for (var i = 0; i < numParameters; i++) {
            param = this.getParameter(i, -1);
            if (param <= 0)
                this._clearStyle();
            else {
                switch (param) {
                case 1:
                    this._pushStyle("font-weight", "bold");
                    break;
                case 2:
                    this._pushStyle("font-weight", "lighter");
                    break;
                case 22:
                    this._pushStyle("font-weight", null/*"normal"*/);
                    break;
                case 4:
                    this._pushStyle("text-underline", "yes");
                    break;
                case 24:
                    this._pushStyle("text-underline", null/*"none"*/);
                    break;
                case 5:
                    this._pushStyle("text-blink", "yes");
                    break;
                case 25:
                    this._pushStyle("text-blink", null);
                    break;
                case 7:
                    this._pushStyle("reverse", "yes");
                    break;
                case 9:
                    this._pushStyle("text-line-through", "yes");
                    break;
                case 29:
                    this._pushStyle("text-line-through", null/*"none"*/);
                    break;
                case 27:
                    this._pushStyle("reverse", null);
                    break;
                case 30: this._pushStyle("color", "black"); break;
                case 31: this._pushStyle("color", "red"); break;
                case 32: this._pushStyle("color", "green"); break;
                case 33: this._pushStyle("color", "yellow"); break;
                case 34: this._pushStyle("color", "blue"); break;
                case 35: this._pushStyle("color", "magenta"); break;
                case 36: this._pushStyle("color", "cyan"); break;
                case 37: this._pushStyle("color", "light-gray"); break;
                case 38:
                case 48:
                    var property = param==38 ? "color" : "background-color";
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
                        this._pushStyle(property, this.color256(c));
                        i += 2;
                    }
                    break;
                case 39: this._pushStyle("color", null/*defaultForegroundColor*/); break;
                case 40: this._pushStyle("background-color", "black"); break;
                case 41: this._pushStyle("background-color", "red"); break;
                case 42: this._pushStyle("background-color", "green"); break;
                case 43: this._pushStyle("background-color", "yellow"); break;
                case 44: this._pushStyle("background-color", "blue"); break;
                case 45: this._pushStyle("background-color", "magenta"); break;
                case 46: this._pushStyle("background-color", "cyan"); break;
                case 47: this._pushStyle("background-color", "light-gray"); break;
                case 49: this._pushStyle("background-color", null/*defaultBackgroundColor*/); break
                case 90: this._pushStyle("color", "dark-gray"); break;
                case 91: this._pushStyle("color", "light-red"); break;
                case 92: this._pushStyle("color", "light-green"); break;
                case 93: this._pushStyle("color", "light-yellow"); break;
                case 94: this._pushStyle("color", "light-blue"); break;
                case 95: this._pushStyle("color", "light-magenta"); break;
                case 96: this._pushStyle("color", "light-cyan"); break;
                case 97: this._pushStyle("color", "white"); break;
                case 100: this._pushStyle("background-color", "dark-gray"); break;
                case 101: this._pushStyle("background-color", "light-red"); break;
                case 102: this._pushStyle("background-color", "light-green"); break;
                case 103: this._pushStyle("background-color", "light-yellow"); break;
                case 104: this._pushStyle("background-color", "light-blue"); break;
                case 105: this._pushStyle("background-color", "light-magenta"); break;
                case 106: this._pushStyle("background-color", "light-cyan"); break;
                case 107: this._pushStyle("background-color", "white"); break;
                }
            }
        }
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
    case 117 /*'u'*/:
        switch (this.getParameter(0, 0)) {
        case 11:
            this._pushStyle("std", null);
            break;
        case 12:
            this._pushStyle("std", "error");
            break;
        case 13:
            this._pushStyle("std", null);
            // Force inputLine outside prompt
            this._adjustStyle();
            break;
        case 14:
            this._pushStyle("std", "prompt");
            break;
        case 15:
            this._pushStyle("std", this.outputLFasCRLF() ? null : "input");
            this._adjustStyle();
            break;
        case 20: // set input mode
            switch (this.getParameter(1, 112)) {
            case 97 /*'a'*/: //auto
                this.autoEditing = true;
                this.lineEditing = true;
                this.clientDoesEcho = true;
                break;
            case 99 /*'c'*/: //char
                this.autoEditing = false;
                this.lineEditing = false;
                this.clientDoesEcho = true;
                break;
            case 108 /*'l'*/: //line
                this.autoEditing = false;
                this.lineEditing = true;
                this.clientDoesEcho = true;
                break;
            case 112 /*'p'*/: //pipe
                this.autoEditing = false;
                this.lineEditing = true;
                this.clientDoesEcho = false;
                break;
            }
            break;
        }
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
        this.log("insertString "+JSON.stringify(str)+" state:"+this.controlSequenceState);
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
                this.controlSequenceState = DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE;
                //prevEnd = indexTextEnd(str, i);
                this.parameters.push("");
                prevEnd = i + 1;
                //this.parameters.push(str.substring(i, prevEnd));
                //i = prevEnd;
            } else {
                this.parameters.length = 1;
                prevEnd = i + 1;
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            }
            continue;
        case DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE:
            if (ch == 7 || ch == 0) {
                this.parameters[1] =
                    this.parameters[1] + str.substring(prevEnd, i);
                this.handleOperatingSystemControl(this.parameters[0], this.parameters[1]);
                this.parameters.length = 1;
                prevEnd = i + 1;
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            } else {
                // Do nothing, for now.
            }
            continue;
        case DomTerm.INITIAL_STATE:
            switch (ch) {
            case 13: // '\r' carriage return
                this.insertSimpleOutput(str, prevEnd, i, kind);
                if (this._currentStyleMap.get("std") == "input")
                    this._pushStyle("std", null);
                //this.currentCursorColumn = column;
                if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                    && this.getCursorLine() !== this.scrollRegionBottom-1) {
                    this.cursorLineStart(1);
                    i++;
                } else {
                    this.cursorLineStart(0);
                }
                prevEnd = i + 1;
                break;
            case 10: // '\n' newline
                this.insertSimpleOutput(str, prevEnd, i, kind);
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
                    this.moveToIn(this.getCursorLine()+1, this.getCursorColumn(), true);
                prevEnd = i + 1;
                break;
            case 27 /* Escape */:
                this.insertSimpleOutput(str, prevEnd, i, kind);
                //this.currentCursorColumn = column;
                prevEnd = i + 1;
                this.controlSequenceState = DomTerm.SEEN_ESC_STATE;
                continue;
            case 8 /*'\b'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind);
                this.cursorLeft(1);
                prevEnd = i + 1; 
                break;
            case 9 /*'\t'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind);
                var nextStop = this.nextTabCol(this.getCursorColumn());
                this.cursorRight(nextStop-this.currentCursorColumn);
                prevEnd = i + 1;
                break;
            case 7 /*'\a'*/:
                this.insertSimpleOutput(str, prevEnd, i, kind); 
                //this.currentCursorColumn = column;
                this.handleBell();
                prevEnd = i + 1;
                break;
            default:
                ;
            }
        }
    }
    if (this.controlSequenceState == DomTerm.INITIAL_STATE) {
        this.insertSimpleOutput(str, prevEnd, i, kind);
        //this.currentCursorColumn = column;
    }
    if (this.controlSequenceState == DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE) {
        this.parameters[1] = this.parameters[1] + str.substring(prevEnv, i);
    }
    if (true) { // FIXME only if "scrollWanted"
        var last = this.topNode.lastChild;
        var lastBottom = last.offsetTop + last.offsetHeight;
        if (lastBottom > this.topNode.scrollTop + this.availHeight)
            this.topNode.scrollTop = lastBottom - this.availHeight;
    }
    this.inputLine.focus();
};

DomTerm.prototype._breakAllLines = function(oldWidth) {
    var changed = false;
    for (var line = 0;  line < this.lineStarts.length;  line++) {
        // First remove any existing soft line breaks.
        var delta = 0;
        for (;;) {
            var end = this.lineEnds[line+delta];
            if (! this.isSpanNode(end)
                || end.getAttribute("line")!="soft")
                break;
            if (this.outputBefore == end)
                this.outputBefore = end.nextSibling;
            var prev = end.previousSibling;
            end.parentNode.removeChild(end);
            if (prev instanceof Text)
                this._normalize1(prev);
            delta++;
        }
        if (delta > 0) {
            var lineCount = this.lineEnds.length;
            this.lineEnds[line] = this.lineEnds[line+delta];
            for (var i = line+1; i < lineCount; i++) {
                this.lineEnds[i] = this.lineEnds[i+delta];
                this.lineStarts[i] = this.lineStarts[i+delta];
            }
            this.lineStarts.length = lineCount-delta;
            this.lineEnds.length = lineCount-delta;
            changed = true; // FIXME needlessly conservative
        }
        var end = this.lineEnds[line];
        if (! end) {
            console.log("bad line "+line+" of "+ this.lineEnds.length);
        }
        if (end.offsetLeft > this.availWidth) {
            var start = this.lineStarts[line];
            changed = true; // FIXME needlessly conservative
            if (this.isBlockNode(start)) {
                var oldCount = this.lineEnds.length;
                this._breakLine(start.firstChild, line, 0, this.availWidth, true);
                var newCount = this.lineEnds.length;
                line += newCount - oldCount;
            }
            // else if start is a "hard" line FIXME
            // (Normally that is not the case but see ESC [ K handling.)
        }
        //line -= delta;
    }
    if (changed)
        this.resetCursorCache();
}

DomTerm.prototype._breakLine = function(start, line, beforePos, availWidth, rebreak) {
    for (var el = start; el != null;  ) {
        var next = el.nextSibling;
        if (el instanceof Element) {
            var right = beforePos + el.offsetWidth;
            if (right > availWidth) {
                right = this._breakLine(el.firstChild, line, beforePos, availWidth, rebreak);
            }
            beforePos = right;
        } else { // el instanceof Text
            this._normalize1(el);
            var right = this._offsetLeft(el.nextSibling, el.parentNode);
            if (right > availWidth) {
                next = this._breakText(el, line, beforePos, right, availWidth, rebreak);
                right = 0; // FIXME rest
            }
        }
        el = next;
    }
};

DomTerm.prototype._offsetLeft = function(node, parent) {
    var right;
    if (node != null)
        return node.offsetLeft;
    //else if (no previous line breaks in parent)
    //  return parent.offsetLeft + parent.offsetWidth;
    else {
        var rects = parent.getClientRects();
        return rects[rects.length-1].right;
    }
}

DomTerm.prototype._breakText = function(textNode, line, beforePos, afterPos, availWidth, rebreak) {
    var lineNode = this._createLineNode("soft", null);
    textNode.parentNode.insertBefore(lineNode,
                                     textNode.nextSibling);
    var textData = textNode.data;
    var textLength = textData.length;
    var goodLength = 0; // Can sometimes do better FIXME
    // number of chars known to require wrapping
    var badLength = textLength;
    // Width in pixels corresponding to goodLength:
    var goodWidth = beforePos;
    // Width in pixels corresponding to badLength:
    //var afterPos = right; // FIXME combine
    var badWidth = afterPos;
    // Binary search for split point
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
        if (nextTry <= goodLength)
            nextTry = goodLength + 1;
        else if (nextTry >= badLength)
            nextTry = badLength - 1;
        // FIXME check for split surrogate pair
        textNode.data = textData.substring(0, nextTry);
        var nextPos = lineNode.offsetLeft;
        if (nextPos > availWidth) {
            badLength = nextTry;
            badWidth = nextPos
        } else {
            goodLength = nextTry;
            goodWidth = nextPos;
        }
    }
    if (goodLength == 0) {
        this.log("BAD goodLength!");
    }
    if (textNode.data.length != goodLength)
        textNode.data = textData.substring(0, goodLength);
    // ASSUME textNode.data == textData.subString(0, goodLength);
    var lineCount = this.lineStarts.length;
    var lineEnd = this.lineEnds[line];
    if (rebreak || lineCount == line + 1) {
        for (var i = lineCount; --i > line; ) {
            this.lineStarts[i+1] = this.lineStarts[i];
            this.lineEnds[i+1] = this.lineEnds[i];
        }
        this.lineEnds[line+1] = lineEnd;
        this.lineStarts[line+1] = lineNode;
        this.lineEnds[line] = lineNode;
        // FIXME following lines are duplicated with moveToIn
        lineCount++;
        var homeLine = this.homeLine;
        if (lineCount > homeLine + this.numRows) {
            homeLine = lineCount - this.numRows;
            //goalLine -= homeLine - this.homeLine;
            this.homeLine = homeLine;
            this.cursorHome = this.lineStarts[homeLine];
        }
    } else {
        // insert soft wrap (re-use existing line, but make soft)
        if (lineEnd.nodeName != "SPAN"
               || lineEnd.getAttribute("line") != "soft") {
            var nextLine = this.lineStarts[line+1];
            this._moveNodes(nextLine.firstChild, lineEnd.parentNode);
            nextLine.parentNode.removeChild(nextLine);
        }
        this.lineEnds[line] = lineNode;
        this.lineStarts[line+1] = lineNode;
        lineEnd.parentNode.removeChild(lineEnd);
    }
    if (goodLength < textLength) {
        var restString = textData.substring(goodLength);
        var rest = document.createTextNode(restString);
        lineNode.parentNode.insertBefore(rest, lineNode.nextSibling);
        return rest;
    } else
        return rebreak ? lineNode.nextSibling : null;
};

DomTerm.prototype.insertSimpleOutput = function(str, beginIndex, endIndex, kind) {
    var sslen = endIndex - beginIndex;
    if (sslen == 0)
        return;

    var slen = str.length;
    if (beginIndex > 0 || endIndex != slen) {
        str = str.substring(beginIndex, endIndex);
        slen = endIndex - beginIndex;
    }
    if (this.verbosity >= 2)
        this.log("insertSimple '"+this.toQuoted(str)+"'");
    if (this._currentStyleSpan != this.outputContainer)
        this._adjustStyle();
    var widthInColums = -1;
    if (! this.insertMode) {
        widthInColums = this.widthInColumns(str, 0, slen);
        this.eraseCharactersRight(widthInColums, true);
    }

    var beforePos = this._offsetLeft(this.outputBefore, this.outputContainer);
    var textNode = this.insertRawOutput(str);
    var absLine = this.homeLine+this.getCursorLine();
    while (textNode != null) {
        var afterPos = this._offsetLeft(this.outputBefore,
                                        this.outputContainer);
        var lineEnd = this.lineEnds[absLine];
        var clientWidth = this.initial.clientWidth;
        var availWidth = clientWidth - this.rightMarginWidth;
        if (afterPos > availWidth) {
            // wrap needed:
            textNode = this._breakText(textNode, absLine, beforePos, afterPos, availWidth, false);
            absLine++;
            widthInColums = -1;
        } else
            textNode = null;
    }
    this.currentCursorLine = absLine - this.homeLine;
    this.currentCursorColumn =
        this.currentCursorColumn < 0 || widthInColums < 0 ? -1
        : this.currentCursorColumn + widthInColums;
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
    this.processInputCharacters(text+"\r"); // Or +"\n" FIXME
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
    case 8: /* Backspace */ return "\x7F";
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
    case 38: /*Up*/
        this.historyMove(-1);
        break;
    case 40: /*Down*/
        this.historyMove(1);
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
        } else if (this.useDoLineEdit || key == 38/*Up*/ || key == 40/*Down*/) {
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
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" data:"+event.data+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" t:"+this.grabInput(this.inputLine)+" lineEdit:"+this.lineEditing+" do-line-edit:"+this.useDoLineEdit+" inputLine:"+this.inputLine);
    if (this.lineEditing) {
        if (this.useDoLineEdit) {
            event.preventDefault();
            var str = String.fromCharCode(key);
            this.doLineEdit(-key, str);
        }
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

/*
// For debugging
DomTerm.prototype._checkTree = function() {
    var node = this.initial;
    var dt = this;
    function error(str) {
        dt.log("ERROR: "+str);
    };
    var parent = node.parentNode;
    var cur = node;
    var istart = 0;
    var iend = 0;
    var nlines = this.lineStarts.length;
    if (this.outputBefore
        && this.outputBefore.parentNode != this.outputContainer)
        error("bad outputContainer");
    for (;;) {
        if (cur == this.outputBefore && parent == this.outputContainer) {
            if (this.currentCursorLine >= 0)
                if (this.homeLine + this.currentCursorLine != iend)
                    error("bad currentCursorLine");
        }
        if (cur == null) {
            if (parent == null)
                break; // Shouldn't happen
            cur = parent.nextSibling;
            parent = parent.parentNode;
        } else if (cur instanceof Element) {
            if (cur.nodeName == "PRE" && cur.firstChild == null) {
                error("EMPTY <pre>!");
            }
            if (istart < nlines && this.lineStarts[istart] == cur)
                istart++;
            if (iend < nlines && this.lineEnds[iend] == cur)
                iend++;
            if (iend > istart || istart > iend+1)
                error("LINE TABLE out of order");
            parent = cur;
            cur = cur.firstChild;
        } else {
            if (cur instanceof Text) {
                if (cur.data.length == 0) {
                    error("EMPTY Text!");
                }
            }
            cur = cur.nextSibling;
        }
   }
    if (istart != nlines || iend != nlines) {
        error("bad line table!");
    }
};
*/

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

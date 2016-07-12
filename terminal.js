/*
 * Copyright (c) 2015, 2016 Per Bothner.
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

/** [The following was helpful, including code and comment snippets.]
 * term.js - an xterm emulator
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * https://github.com/chjj/term.js
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
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
    // If true, treat "\n" as "\r\n".
    this.automaticNewlineMode = false;

    this.lineEditing = false;

    // If true, we automatically switching lineEditing depending
    // on slate pty's canon mode.  TODO
    this.autoEditing = true;

    this.verbosity = 0;

    this.versionInfo = "version=0.2";

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

    this.topNode = null;

    // ??? FIXME we want to get rid of this
    this.initial = null;

    // Used if needed to add extra space at the bottom, for proper scrolling.
    // See note in eraseDisplay.
    this._vspacer = null;

    // Current line number, 0-origin, relative to start of cursorHome.
    // -1 if unknown. */
    this.currentCursorLine = -1;

    // Current column number, 0-origin, relative to start of cursorHome.
    // -1 if unknown. */
    this.currentCursorColumn = -1;

    this.savedCursorLine = 0;
    this.savedCursorColumn = 0;

    this.rightMarginWidth = 0;

    // Number of vertical pixels available.
    this.availHeight = 0;
    // Number of horizontal pixels available.
    // Doesn't count scrollbar or rightMarginWidth.
    this.availWidth = 0;

    this.numRows = 24;
    this.numColumns = 80;

    // First (top) line of scroll region, 0-origin (relative to homeLine).
    this._regionTop = 0;
    // Last (bottom) line of scroll region, 1-origin.
    // Equivalently, first line following scroll region, 0-origin.
    // Note that xterm's bot_marg is _regionBottom-1.
    this._regionBottom = this.numRows;
    this._regionLeft = 0;
    this._regionRight = this.numColumns;

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

    // True if inputLine should move with outputBefore.
    this.inputFollowsOutput = true;

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
    // (normally a pre).
    // "Erase screen" only erases starting at this line.
    this.homeLine = 0;

    // A stack of currently active "style" strings.
    this._currentStyleMap = new Map();
    this._currentStyleSpan = null;

    this.applicationCursorKeysMode = false;
    this.originMode = false;
    // (wraparoundMode & 2) if wraparound enabled
    // (wraparoundMode & 1) if reverse wraparound should also be enabled
    this.wraparoundMode = 2;
    this.bracketedPasteMode = false;

    this.defaultBackgroundColor = "white";
    this.defaultForegroundColor = "black";

    this.usingAlternateScreenBuffer = false;

    this.history = null;
    this.historyCursor = -1;
    this.historyStorageKey = "DomTerm.history";
    this.historyStorageMax = 200;

    // If non-null: A function that maps charCodes to replacement strings.
    // (If the function returns null, uses the input unmodified.)
    this.charMapper = null;
    this._Gcharsets = [null, null, null, null];
    this._Glevel = 0;

    this._currentCommandGroup = null;
    this._currentCommandOutput = null;
    this._currentCommandHideable = false;

    if (topNode)
        this.initializeTerminal(topNode);
    var dt = this;
    this._showHideEventHandler =
        function(evt) { dt._showHideHandler(evt); };
    this._unforceWidthInColumns =
        function(evt) {
            dt.forceWidthInColumns(-1);
            window.removeEventListener("resize",
                                       dt._unforceWidthInColumns, true);
        };
}

DomTerm.prototype.eofSeen = function() {
    this.historySave();
    this.history.length = 0;
    this.close();
};

DomTerm.prototype.close = function() {
    window.close();
};

DomTerm.prototype.startCommandGroup = function() {
    var container = this.outputContainer;
    var containerTag = container.tagName;
    if ((containerTag == "PRE" || containerTag == "P"
         || (containerTag == "DIV" && container.getAttribute("class") == "domterm-pre"))
        && container.firstChild == this.outputBefore) {
        var commandGroup = document.createElement("div");
        commandGroup.setAttribute("class", "command-group");
        var oldGroup = this._currentCommandGroup;
        var oldOutput = this._currentCommandOutput;
        if (oldGroup && ! this._isAnAncestor(container, oldGroup)) {
            oldGroup = null;
            oldOutput = null;
        }
        if (oldGroup) {
            var cur = container;
            var parent = container.parentNode;
            var oldBefore = oldGroup.nextSibling;
            for (;;) {
                this._moveNodes(cur, oldGroup.parentNode, oldBefore);
                if (parent == oldGroup)
                    break;
                cur = parent.nextSibling;
                parent = parent.parentNode;
            }
        }
        container.parentNode.insertBefore(commandGroup, container);
        commandGroup.appendChild(container);
        // this._moveNodes(firstChild, newParent)
        // Remove old empty domterm-output container.
        if (oldOutput && oldOutput.firstChild == null
            && oldOutput != this.outputContainer) { // paranoia
            oldOutput.parentNode.removeChild(oldOutput);
        }
        this._currentCommandGroup = commandGroup;
        this._currentCommandOutput = null;
        this._currentCommandHideable = false;
    }
};

// For debugging (may be overridden)
DomTerm.prototype.log = function(str) {
    // JSON.stringify encodes escape as "\\u001b" which is hard to read.
    str = str.replace(/\\u001b/g, "\\e");
    console.log(str);
};

// States of escape sequences handler state machine.
DomTerm.INITIAL_STATE = 0;
/** We have seen ESC. */
DomTerm.SEEN_ESC_STATE = 1;
/** We have seen ESC '['. */
DomTerm.SEEN_ESC_LBRACKET_STATE = 2;
/** We have seen ESC '[' '?'. */
DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE = 3;
/** We have seen ESC '[' '!'. */
DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE = 4;
/** We have seen ESC '[' '>'. */
DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE = 5;
/** We have seen ESC ']'. */
DomTerm.SEEN_ESC_RBRACKET_STATE = 6;
/** We have seen ESC ']' numeric-parameter ';'. */
DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE = 7;
/** We have seen ESC '#'. */
DomTerm.SEEN_ESC_SHARP_STATE = 8;
DomTerm.SEEN_ESC_CHARSET0 = 9;
DomTerm.SEEN_ESC_CHARSET1 = 10;
DomTerm.SEEN_ESC_CHARSET2 = 11;
DomTerm.SEEN_ESC_CHARSET3 = 12;
DomTerm.SEEN_ESC_SS2 = 13;
DomTerm.SEEN_ESC_SS3 = 14;

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

DomTerm.prototype._setRegionTB = function(top, bottom) {
    this._regionTop = top;
    this._regionBottom = bottom < 0 ? this.numRows : bottom;
};

DomTerm.prototype._setRegionLR = function(left, right) {
    this._regionLeft = left;
    this._regionRight = right < 0 ? this.numColumns : right;
};

DomTerm.prototype._homeOffset = function() {
    var lineStart = this.lineStarts[this.homeLine];
    var offset = lineStart.offsetTop;
    if (lineStart.nodeNode == "SPAN")
        offset += lineStart.offsetHeight;
    return offset;
};

DomTerm.prototype._checkSpacer = function() {
    var needed;
    if (this.homeLine == 0)
        needed = 0;
    else {
        var height = this._vspacer.offsetTop - this._homeOffset();
        needed = this.availHeight - height;
    }
    this._adjustSpacer(needed);
};
DomTerm.prototype._adjustSpacer = function(needed) {
    var vspacer = this._vspacer;
    if (needed > 0) {
        vspacer.style.height = needed + "px";
        vspacer.dtHeight = needed;
    } else if (vspacer.dtHeight != 0) {
        vspacer.style.height = "";
        vspacer.dtHeight = 0;
    }
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
    this.moveToIn(this.savedCursorLine, this.savedCursorColumn, true);
}; 


/** Move to give position relative to cursorHome or region.
 * Add spaces as needed.
*/
DomTerm.prototype.cursorSet = function(line, column, regionRelative) {
    var rowLimit, colLimit;
    if (regionRelative) {
        line += this._regionTop;
        column += this._regionLeft;
        rowLimit = this._regionBottom;
        colLimit = this._regionRight;
    } else {
        rowLimit = this._numRows;
        colLimit = this.numColumns;
    }
    if (line < 0)
        line = 0;
    else if (line >= rowLimit)
        line = rowLimit-1;
    if (column < 0)
        column = 0;
    else if (column >= colLimit)
        column = colLimit-1;
    this.moveToIn(line, column, true);
};

/** Move to the request position.
 * @param goalLine number of lines (non-negative) to down from homeLine
 * @param goalColumn number of columns to move right from the start of the goalLine
 * @param addSpaceAsNeeded if we should add blank lines or spaces if needed to move as requested; otherwise stop at the last existing line, or (just past the) last existing contents of the goalLine
 */
DomTerm.prototype.moveToIn = function(goalLine, goalColumn, addSpaceAsNeeded) {
    this._removeInputLine();
    var line = this.currentCursorLine;
    var column = this.currentCursorColumn;
    var checkSpacer = false;
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
    if (goalLine == line && column >= 0 && goalColumn >= column) {
        current = this.outputBefore;
        parent = this.outputContainer;
    } else {
        var homeLine = this.homeLine;
        var lineCount = this.lineStarts.length;
        var absLine = homeLine+goalLine;
        // FIXME this doesn't handle _currentCommandGroup != null
        // and absLine < lineCount
        while (absLine >= lineCount) {
            if (! addSpaceAsNeeded)
                return;
            var preNode = this._createPreNode();
            checkSpacer = true;
            // preNode.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
            if (lineCount == this.homeLine)
                parent = this.initial;
            else {
                var lastParent = this.lineEnds[lineCount-1];
                for (;;) {
                    if (this.isBlockNode(lastParent))
                        break;
                    var p = lastParent.parentNode;
                    if (p == this.initial)
                        break;
                    lastParent = p;
                }
                if (lastParent.parentNode == this._currentCommandGroup) {
                    var commandOutput = document.createElement("div");
                    commandOutput.setAttribute("class", "command-output");
                    if (this._currentCommandHideable)
                        commandOutput.setAttribute("domterm-hidden", "false");
                    this._currentCommandOutput = commandOutput;
                    this._currentCommandGroup.appendChild(commandOutput);
                    parent = commandOutput;
                } else {
                    parent = lastParent.parentNode;
                }
            }
            parent.appendChild(preNode);
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
                this._adjustSpacer(0);
                checkSpacer = false;
            }
            /*
            while (homeLine < nextLine) {
                var homeTop = homeLine == 0 ? this.lineStarts[homeLine].offsetTop
                    : this.lineEnds[homeLine-1].offsetTop + this.lineEnds[homeLine-1].offsetHeight;
                if (next.offsetTop+next.offsetHeight <= homeTop + this.availHeight)
                    break;
                homeLine++;
                var homeStart = this.lineStarts[homeLine];
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
                    if (nextColumn == -1) {
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
    this.outputContainer = parent;
    this.outputBefore = current;
    this._removeInputLine();
    this.currentCursorLine = line;
    this.currentCursorColumn = column;
    if (checkSpacer)
        this._checkSpacer();
};

DomTerm.prototype._removeInputLine = function() {
    if (this.inputFollowsOutput && this.inputLine) {
        var inputParent = this.inputLine.parentNode;
        if (inputParent != null) {
            if (this.outputBefore==this.inputLine)
                this.outputBefore = this.outputBefore.nextSibling;
            inputParent.removeChild(this.inputLine);
        }
    }
};

DomTerm.prototype._restoreInputLine = function() {
    if (this.inputFollowsOutput && this.outputBefore != this.inputLine) {
        this.outputContainer.insertBefore(this.inputLine, this.outputBefore);
        this.outputBefore = this.inputLine;
    }
};

/** Move cursor to beginning of line, relative.
 * @param deltaLines line number to move to, relative to current line.
 */
DomTerm.prototype.cursorLineStart = function(deltaLines) {
    this.moveToIn(this.getCursorLine()+deltaLines, 0, true);
};

DomTerm.prototype.cursorDown = function(count) {
    this.cursorSet(this.getCursorLine()+count, this.getCursorColumn(), false);
};

DomTerm.prototype.cursorNewLine = function(autoNewline) {
    if (autoNewline) {
        if (this.insertMode) {
            this.insertRawOutput("\n"); // FIXME
            if (this.currentCursorLine >= 0)
                this.currentCursorLine++;
            this.currentCursorColumn = 0;
        } else {
            this.cursorLineStart(1);
        }
    }
    // Only scroll if this._regionBottom explicitly set to a value >= 0.
    else if ((this._regionTop > 0
              || this._regionBottom < this.numRows)
             && this.getCursorLine() == this._regionBottom-1)
        this.scrollForward(1);
    else
        this.moveToIn(this.getCursorLine()+1, this.getCursorColumn(), true);
};

DomTerm.prototype.cursorRight = function(count) {
    // FIXME optimize same way cursorLeft is.
    this.cursorSet(this.getCursorLine(), this.getCursorColumn()+count, false);
};

DomTerm.prototype.cursorLeft = function(count, maybeWrap) {
    if (count == 0)
        return;
    var left = this._regionLeft;
    var before = this.getCursorColumn();
    if (before < left)
        left = 0;
    else if (before == this.numColumns && (this.wraparoundMode != 3))
        count++;
    var goal = before - count;
    if (goal < left) {
        // logic based on the CursorBack procedure in xterm.
        var line = this.getCursorLine();
        if (maybeWrap) {
            var width = this._regionRight - left;
            var offset = width * line + goal - left;
            if (offset < 0) {
                var length = width * this.numRows;
                offset = -offset;
                var rem = offset % length;
                offset += ((offset - rem) / length + 1) * length;
            }
            var rem = offset % width;
            line = (offset - rem) / width;
            left += rem;
        }
        this.cursorSet(line, left, false);
        return;
    }
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

            var following = this.outputBefore;
            var inputOk = this.inputLine == following
                && this.inputFollowsOutput
                && this.inputLine.firstChild == null;
            if (inputOk)
                following = following.nextSibling;
            if (following && following.nodeType == 3/*TEXT_NODE*/) {
                following.replaceData(0, 0, after);
            } else {
                var nafter = document.createTextNode(after);
                this.outputContainer.insertBefore(nafter, following);
                if (! inputOk) {
                    this.outputBefore = nafter;
                    this._removeInputLine();
                }
            }
            if (this.currentCursorColumn > 0)
                this.currentCursorColumn -= tcols;
        }
    }
    if (count > 0) {
        this.cursorSet(this.getCursorLine(), goal, false);
    }
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
    this._currentStyleSpan = null;
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
            var restSpan = this._createSpanNode();
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
        var styleSpan = this._createSpanNode();
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
    this._removeInputLine();
};

DomTerm.prototype.insertLinesIgnoreScroll = function(count, line) {
    var absLine = this.homeLine+line;
    var oldLength = this.lineStarts.length;
    var column = this.getCursorColumn();
    var oldStart, oldParent;
    if (absLine >= oldLength) {
        oldParent = this.initial;
        oldStart = null;
    } else {
        if (absLine > 0)
            this._clearWrap(absLine-1);
        oldStart = this.lineStarts[absLine];
        oldParent = oldStart.parentNode;
    }
    this.lineStarts.length += count;
    this.lineEnds.length += count;
    for (var i = oldLength-1; i >= absLine; i--) {
        this.lineStarts[i+count] = this.lineStarts[i];
        this.lineEnds[i+count] = this.lineEnds[i];
    }
    this._addBlankLines(count, absLine, oldParent, oldStart);
    this.resetCursorCache();
    this.moveToIn(line, column, true);
};

DomTerm.prototype._addBlankLines = function(count, absLine, parent, oldStart) {
    for (var i = 0; i < count;  i++) {
        var preNode = this._createPreNode();
        var newLine = this._createLineNode("hard", "\n");
        preNode.appendChild(newLine);
        parent.insertBefore(preNode, oldStart);
        this.lineStarts[absLine+i] = preNode;
        this.lineEnds[absLine+i] = newLine;
    }
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

DomTerm.prototype.deleteLinesIgnoreScroll = function(count, restoreCursor) {
    var line = this.getCursorLine();
    var absLine = this.homeLine+line;
    if (absLine > 0)
        this._clearWrap(absLine-1);
    var start = this.lineStarts[absLine];
    var startPrevious = start.previousSibling;
    var startParent = start.parentNode;
    var end;
    var all = count < 0 || absLine+count >= this.lineStarts.length;
    if (all) {
        if (restoreCursor)
            end = this.lineEnds[this.lineEnds.length-1];
        else {
            end = null;
            all = false;
        }
        count = this.lineStarts.length - absLine;
    } else
        end = this.lineStarts[absLine+count];
    var cur = this.outputBefore;
    var parent = this.outputContainer;
    //if (end && cur && end.parentNode == this.outputContainer) {
    var inputLine = this.inputLine;
    var inputRoot = this._rootNode(inputLine);
    for (;;) {
        if (cur == null) {
            while (parent != null && parent.nextSibling == null)
                parent = parent.parentNode;
            if (! parent || parent == this.initial)
                break;
            cur = parent.nextSibling;
            parent = cur.parentNode;
        } else if (cur == end) {
            break;
        } else if (end != null && this._isAnAncestor(end, cur)) {
            parent = cur;
            cur = cur.firstChild;
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
    if (all) {
        if (! this._isAnAncestor(start, this.topNode)) {
            start = end;
            for (;;) {
                if (start.tagName == "PRE"|| start.tagName == "P"
                    || start.tagName == "DIV")
                    break;
                start = start.parentNode;
            }
            this.lineStarts[absLine] = start;
        }
    }
    else
        this.lineStarts[absLine] = this.lineStarts[absLine+count];
    this.lineEnds[absLine] = all ? end : this.lineEnds[absLine+count];
    var length = this.lineStarts.length;
    for (var i = absLine+1;  i+count < length;  i++) {
        this.lineStarts[i] = this.lineStarts[i+count];
        this.lineEnds[i] = this.lineEnds[i+count];
    }
    length -= all ? count - 1 : count;
    this.lineStarts.length = length;
    this.lineEnds.length = length;
    if (restoreCursor) {
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
    }
};

DomTerm.prototype._insertLinesAt = function(count, line, regionBottom) {
    var avail = regionBottom - line;
    if (count > avail)
        count = avail;
    if (count <= 0)
        return;
    this.moveToIn(regionBottom-count, 0, true);
    this.deleteLinesIgnoreScroll(count, false);
    if (count > this.numRows)
        count = this.numRows;
    this.insertLinesIgnoreScroll(count, line);
    this._removeInputLine();
};

DomTerm.prototype.insertLines = function(count) {
    var line = this.getCursorLine();
    if (line >= this._regionTop)
        this._insertLinesAt(count, line, this._regionBottom);
};

DomTerm.prototype._deleteLinesAt = function(count, line) {
    this.deleteLinesIgnoreScroll(count, false);
    var scrollBottom = this._regionBottom;
    var savedLines = scrollBottom - line - count;
    if (savedLines > 0) {
        this.insertLinesIgnoreScroll(count, scrollBottom - count);
    }
    this.resetCursorCache();
    this.moveToIn(line, 0, true);
    this._removeInputLine();
};

 DomTerm.prototype.deleteLines = function(count) {
     this._deleteLinesAt(count, this.getCursorLine());
};

DomTerm.prototype.scrollForward = function(count) {
    var line = this.getCursorLine();
    this.moveToIn(this._regionTop, 0, true);
    this._deleteLinesAt(count, this._regionTop);
    this.moveToIn(line, 0, true);
};

DomTerm.prototype.scrollReverse = function(count) {
    var line = this.getCursorLine();
    this._insertLinesAt(count, this._regionTop, this._regionBottom);
    this.moveToIn(line, 0, true);
};

DomTerm.prototype._createPreNode = function() {
    //return document.createElement("pre");
    // Prefer <div> over <pre> because Firefox adds extra lines when doing a Copy
    // spanning multiple <pre> nodes.
    var n = document.createElement("div");
    n.setAttribute("class", "domterm-pre");
    return n;
};

DomTerm.prototype._createSpanNode = function() {
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
            var nextLine = this.lineEnds.length;
            var bufNode = this._createBuffer(this._altBufferName);
            this.topNode.insertBefore(bufNode, this._vspacer);
            bufNode.saveHomeLine = this.homeLine;
            bufNode.saveInitial = this.initial;
            bufNode.saveLastLine = nextLine;
            var newLineNode = bufNode.firstChild;
            this.homeLine = nextLine;
            this.currentCursorLine = 0;
            this.currentCursorColumn = 0;
            this.outputContainer = newLineNode;
            this.outputBefore = newLineNode.firstChild;
            this._removeInputLine();
            this.initial = bufNode;
        } else {
            var bufNode = this.initial;
            this.initial = bufNode.saveInitial;
            this.lineStarts.length = bufNode.saveLastLine;
            this.lineEnds.length = bufNode.saveLastLine;
            this.homeLine = bufNode.saveHomeLine;
            this.moveToIn(0, 0, false);
            bufNode.parentNode.removeChild(bufNode);
        }
        this.usingAlternateScreenBuffer = val;
        this._setRegionTB(0, -1);
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
    try {
        if (window.localStorage) {
            var v = localStorage[this.historyStorageKey];
            if (v)
                this.history = JSON.parse(v);
        }
    } catch (e) { }
    if (! this.history)
        this.history = new Array();

    this.topNode = topNode;
    var helperNode = this._createPreNode();
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

    this._mainBufferName = this.makeId("main")
    this._altBufferName = this.makeId("alternate")

    var mainNode = this._createBuffer(this._mainBufferName);
    topNode.appendChild(mainNode);
    var vspacer = document.createElement("div");
    vspacer.setAttribute("class", "domterm-spacer");
    vspacer.dtHeight = 0;
    topNode.appendChild(vspacer);
    this._vspacer = vspacer;

    this.initial = mainNode;
    var preNode = mainNode.firstChild;
    this.outputContainer = preNode;
    this.outputBefore = preNode.firstChild;
    this.addInputLine();
    this.outputBefore = this.inputLine;
    this.pendingInput = this.inputLine;

    document.onkeydown =
        function(e) { dt.keyDownHandler(e ? e : window.event) };
    document.onkeypress =
        function(e) { dt.keyPressHandler(e ? e : window.event) };
    document.addEventListener("paste",
                              function(e) {
                                  dt.pasteText(e.clipboardData.getData("text"));
                                  e.preventDefault(); },
                              false);
    window.addEventListener("unload",
                            function(event) { dt.historySave(); });
    topNode.addEventListener("click",
                             function(e) {
                                 var target = e.target;
                                 if (target instanceof Element
                                     && target.nodeName == "A")
                                     dt.handleLink(e, target.getAttribute("href"));
                             },
                             false);
    if (window.chrome && chrome.contextMenus && chrome.contextMenus.onClicked) {
        chrome.contextMenus.onClicked.addListener(function(info) {
            switch (info.menuItemId) {
            case "context-paste":
                dt.doPaste();
                break;
            case "context-copy":
                dt.doCopy();
                break;
            }
            dt.log("context menu even info:"+info);
        });
    }
    this.measureWindow();
};

DomTerm.prototype._createBuffer = function(bufName) {
    var bufNode = document.createElement("div");
    bufNode.setAttribute("id", bufName);
    bufNode.setAttribute("class", "interaction");
    if (true)
        this._addBlankLines(1, this.lineEnds.length, bufNode, null);
    else {
        var preNode = this._createPreNode();
        var lineEnd = this._createLineNode("hard", "\n");
        preNode.appendChild(lineEnd);
        bufNode.appendChild(preNode);
        this.lineStarts.push(preNode);
        this.lineEnds.push(lineEnd);
    }
    return bufNode;
};

/* If browsers allows, should re-size actula window instead. FIXME */
DomTerm.prototype.forceWidthInColumns = function(numCols) {
    if (numCols <= 0) {
        this.topNode.style.width = "";
    } else {
        // FIXME add sanity check?
        var ruler = this._rulerNode;
        var charWidth = ruler.offsetWidth/26.0;
        var width = numCols * charWidth + this.rightMarginWidth
            + (this.topNode.offsetWidth - this.topNode.clientWidth);
        var topNode = this.topNode;
        topNode.style.width = width+"px";
        window.addEventListener("resize", this._unforceWidthInColumns, true);
        this.measureWindow();
    }
};

DomTerm.prototype.measureWindow = function()  {
    var ruler = this._rulerNode;
    var rect = ruler.getBoundingClientRect()
    var charWidth = ruler.offsetWidth/26.0;
    var charHeight = ruler.parentNode.offsetHeight;
    this.rightMarginWidth = this._wrapDummy.offsetWidth;
    if (this.verbosity >= 2)
        this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.topNode+" clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.initial.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+charWidth+" chH:"+charHeight+" ht:"+availHeight);
    // We calculate columns from initial.clientWidth because we don't
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
    this._setRegionTB(0, -1);
    this.availHeight = availHeight;
    this.availWidth = availWidth;
    if (this.verbosity >= 2)
        this.log("ruler ow:"+ruler.offsetWidth+" cl-h:"+ruler.clientHeight+" cl-w:"+ruler.clientWidth+" = "+(ruler.offsetWidth/26.0)+"/char h:"+ruler.offsetHeight+" rect:.l:"+rect.left+" r:"+rect.right+" r.t:"+rect.top+" r.b:"+rect.bottom+" numCols:"+this.numColumns+" numRows:"+this.numRows);
};

DomTerm.prototype.showHideMarkers = [
    // pairs of 'show'/'hide' markers, with 'show' (currently hidden) first
    // "[show]", "[hide]",
    "\u25B6", "\u25BC", // black right-pointing / down-pointing triangle
    "\u25B8", "\u25BE", // black right-pointing / down-pointing small triangle
    "\u25B7", "\u25BD", // white right-pointing / down-pointing triangle
    "\u229E", "\u229F"  // squared plus / squared minus
];

DomTerm.prototype._showHideHandler = function(event) {
    var target = event.target;
    var child = target.firstChild;
    if (target.tagName == "SPAN"
        && (child instanceof Text | child == null)) {
        var oldText = child == null ? "" : child.data;
        var markers = this.showHideMarkers;
        var i = markers.length;
        while (i >= 0 && oldText != markers[i])
            --i;
        var wasHidden;
        var oldHidingValue = target.getAttribute("domterm-hiding");
        if (oldHidingValue)
            wasHidden = oldHidingValue == "true";
        else if (i < 0)
            wasHidden = false;
        else
            wasHidden = (i & 1) == 0;
        if (child && i >= 0)
            child.data = markers[wasHidden ? i+1 : i-1];
        target.setAttribute("domterm-hiding", wasHidden ? "false" : "true");

        // For all following-siblings of target,
        // plus all following-siblings of target's parent
        // (assuming parent is a PRE or P or DIV),
        // flip the domterm-hidden attribute.
        var node = target;
        for (;;) {
            var next = node.nextSibling;
            if (next == null) {
                var parent = node.parentNode;
                if (parent == target.parentNode
                    && (parent.tagName == "PRE" || parent.tagName == "P"
                        || parent.tagName == "DIV"))
                    next = parent.nextSibling;
            }
            node = next;
            if (node == null)
                break;
            if (node instanceof Element) {
                var hidden = node.getAttribute("domterm-hidden");
                if (hidden=="true")
                    node.setAttribute("domterm-hidden", "false")
                else if (hidden=="false")
                    node.setAttribute("domterm-hidden", "true")
            }
        }
    }
};

DomTerm.prototype.reportEvent = function(name, data) {
    // 0x92 is "Private Use 2".
    // FIXME should encode data
    this.processInputCharacters("\x92"+name+" "+data+"\n");
};

DomTerm.prototype.reportKeyEvent = function(key, str) {
    this.reportEvent("KEY", ""+key+" "+JSON.stringify(str));
};

DomTerm.prototype.setWindowSize = function(numRows, numColumns,
                                           availHeight, availWidth) {
    if (this.verbosity >= 2)
        this.log("windowSizeChanged numRows:"+numRows+" numCols:"+numColumns);
    this.reportEvent("WS", numRows+" "+numColumns+" "+availHeight+" "+availWidth);
};

DomTerm.prototype.addInputLine = function() {
    var inputNode = this._createSpanNode();
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
            if (this.isBlockNode(n))
                break;
            n = n.parentNode;
        }
        if (n) {
            var len = this.lineStarts.length;
            for (var ln = this.homeLine; ln < len; ln++) {
                if (this.lineStarts[ln] == n) {
                    line = ln;
                    break;
                }
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
            while (parent != null && parent.nextSibling == null)
                parent = parent.parentNode;
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
            } else if (tag == "A") {
                ;
            } else if (tag == "SPAN" && cur.getAttribute("line")) {
                line++;
                col = 0;
            } else if (tag == "P" || tag == "PRE" || tag == "DIV") {
                // FIXME handle line specially
            }
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

DomTerm.prototype.historyAdd = function(str, append) {
    if (this.historyCursor >= 0) // FIX consider append
        this.history[this.history.length-1] = str;
    else if (append && this.history.length >= 0) {
        this.history[this.history.length-1] =
            this.history[this.history.length-1] + '\n' + str;
    } else
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
    this._scrollIfNeeded();
};

DomTerm.prototype.historySave = function() {
    var h = this.history;
    try {
        if (h.length > 0 && window.localStorage) {
            var first = h.length - this.historyStorageMax;
            if (first > 0)
                h = h.slice(first);
            localStorage[this.historyStorageKey] = JSON.stringify(h);
        }
    } catch (e) { }  
};

DomTerm.prototype.handleEnter = function(text) {
    this._doDeferredDeletion();
    // For now we only support the normal case when outputBefore == inputLine.
    var oldInputLine = this.inputLine;
    this.historyAdd(text, oldInputLine.getAttribute("continuation") == "true");
    var spanNode;
    oldInputLine.removeAttribute("contenteditable");
    var line = this.getCursorLine();
    this.outputBefore = oldInputLine.nextSibling;
    this.outputContainer = oldInputLine.parentNode;
    if (! this.clientDoesEcho) {
        this.inputFollowsOutput = false;
        this.inputLine = null; // To avoid confusing cursorLineStart
        this.cursorLineStart(1);
        this.inputFollowsOutput = true;
    }
    this.addInputLine();
    if (this.clientDoesEcho) {
        this._deferredForDeletion = oldInputLine;
        this.currentCursorLine = line;
        this.currentCursorColumn = -1;
    }
    this.outputBefore = this.inputLine;
    this.outputContainer = this.inputLine.parentNode;
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

DomTerm.prototype.eraseDisplay = function(param) {
    var saveLine = this.getCursorLine();
    var saveCol = this.getCursorColumn();
    if (param == 0 && saveLine == 0 && saveCol == 0)
        param = 2;
    // When we erase the whole screen, we want to scroll the display so
    // the home line is the top of the visible screen.  This cannot be
    // done by erasing individual lines, because there may be partial lines
    // (if numRows*charHeight < availHeight in measureWindow's calculation),
    // and we don't want those to be visible.
    // There could also be lines that have non-standard height.
    // Hence the need for the adjustable _vspacer.
    // When we erase only part of the display, we want to leave the rest
    // alone, without scrolling.
    switch (param) {
    case 1: // Erase above
        for (var line = 0;  line < saveLine;  line++) {
            this.moveToIn(line, 0, true);
            this.eraseLineRight();
        }
        if (saveCol != 0) {
            this.moveToIn(saveLine, 0, true);
            this.eraseCharactersRight(saveCol+1, false);
        }
        break;
    case 3: // Delete saved scrolled-off lines - xterm extension
        var saveHome = this.homeLine;
        this.homeLine =
            this.usingAlternateScreenBuffer ? this.initial.saveLastLine
            : 0;
        var removed = saveHome - this.homeLine;
        if (removed > 0) {
            this.resetCursorCache();
            this.moveToIn(0, 0, false);
            this.deleteLinesIgnoreScroll(removed, false);
            this.resetCursorCache();
        }
        break;
    default:
        var startLine = param == 0 ? saveLine : 0;
        if (this.usingAlternateScreenBuffer && startLine == 0
            && param == 2 && this.initial.saveHomeLine > 0) {
            // FIXME maybe this is a bad idea
            var saveHome = this.homeLine;
            this.homeLine = this.initial.saveLastLine;
            var homeAdjust = saveHome - this.homeLine;
            this.resetCursorCache();
            saveLine -= homeAdjust;
            startLine -= homeAdjust;
        }
        var count = this.lineStarts.length-startLine-this.homeLine;
        if (param == 0) {
            this.eraseCharactersRight(-1, true);
            count--;
            while (--count >= 0) {
                startLine++;
                this.moveToIn(startLine, 0, false);
                this.eraseCharactersRight(-1, true);
            }
        }
        else if (count > 0) {
            this.moveToIn(startLine, 0, false);
            this.deleteLinesIgnoreScroll(count, false);
            this.resetCursorCache();
        }
        break;
    }
    this.moveToIn(saveLine, saveCol, true);
    this._checkSpacer();
};

/** clear line-wrap indicator from absLine to absLine+1.
 *  The default for absLine is homeLine+getCursorLine().
 */
DomTerm.prototype._clearWrap = function(absLine) {
    if (! absLine)
        absLine = this.homeLine+this.getCursorLine();
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
        if (pname == "PRE" || pname == "P" || pname == "DIV") {
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

DomTerm.prototype._moveNodes = function(firstChild, newParent, newBefore) {
    if (! newBefore)
        newBefore = null;
    for (var child = firstChild; child != null; ) {
        var next = child.nextSibling;
        child.parentNode.removeChild(child);
        newParent.insertBefore(child, newBefore);
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
    var previous = current == null ? parent.lastChild
        : current.previousSibling;
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
    this.outputBefore = previous != null ? previous.nextSibling
        : this.outputContainer.firstChild;
};


DomTerm.prototype.eraseLineRight = function() {
    this.eraseCharactersRight(-1, true);
    this._clearWrap();
};

DomTerm.prototype.eraseLineLeft = function() {
    var column = this.getCursorColumn();
    this.cursorLineStart(0);
    this.eraseCharactersRight(column+1, false);
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
    var oldState = this.controlSequenceState;
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    switch (last) {
    case 64 /*'@'*/:
        var saveInsertMode = this.insertMode;
        this.insertMode = true;
        param = this.getParameter(0, 1);
        this.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param);
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
        this.cursorLeft(this.getParameter(0, 1),
                        (this.wraparoundMode & 3) == 3);
        break;
    case 71 /*'G'*/: // HPA- horizontal position absolute
    case 96 /*'`'*/:
        var line = this.getCursorLine();
        this.cursorSet(this.originMode ? line - this._regionTop : line,
                       this.getParameter(0, 1)-1,
                       this.originMode);
        break;
    case 102 /*'f'*/:
    case 72 /*'H'*/: // CUP cursor position
        this.cursorSet(this.getParameter(0, 1)-1, this.getParameter(1, 1)-1,
                      this.originMode);
        break;
    case 74 /*'J'*/:
        this.eraseDisplay(this.getParameter(0, 0));
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
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // Sixel/ReGIS graphics - not implemented
            this.processResponseCharacters("\x1B[?0;3;0S");
            break;
        }
        this.scrollForward(this.getParameter(0, 1));
        break;
    case 84 /*'T'*/:
        param = this.getParameter(0, 1);
        if (curNumParameter >= 5) {
            // FIXME Initiate mouse tracking.
        }
        this.scrollReverse(curNumParameter);
        break;
    case 97 /*'a'*/: // HPR
        var line = this.getCursorLine();
        var column = this.getCursorColumn();
        this.cursorSet(this.originMode ? line - this._regionTop : line,
                       this.originMode ? column - this._regionLeft : column
                       + this.getParameter(0, 1),
                       this.originMode);
    case 99 /*'c'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE) {
            // Send Device Attributes (Secondary DA).
            this.processResponseCharacters("\x1B[>0;0;0c");
        } else {
            // Send Device Attributes (Primary DA)
            this.processResponseCharacters("\x1B[?1;0c");
        }
        break;
    case 100 /*'d'*/: // VPA Line Position Absolute
        var col = this.getCursorColumn();
        this.cursorSet(this.getParameter(0, 1)-1,
                       this.originMode ? col - this._regionLeft : col,
                       this.originMode);
        break;
    case 101 /*'e'*/: // VPR
        var line = this.getCursorLine();
        var column = this.getCursorColumn();
        this.cursorSet(this.originMode ? line - this._regionTop : line
                       + this.getParameter(0, 1),
                       this.originMode ? column - this._regionLeft : column,
                       this.originMode);
    case 104 /*'h'*/:
        param = this.getParameter(0, 0);
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // DEC Private Mode Set (DECSET)
            switch (param) {
            case 1:
                // Application Cursor Keys (DECCKM).
                this.applicationCursorKeysMode = true;
                break;
            case 3:
                this.forceWidthInColumns(132);
                break;
            case 6:
                this.originMode = true;
                break;
            case 7:
                this.wraparoundMode |= 2;
                break;
            case 45:
                this.wraparoundMode |= 1;
                break;
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
            case 2004:
                this.bracketedPasteMode = true;
                break;
            }
        }
        else {
            switch (param) {
            case 4:
                this.insertMode = true;
                break;
            case 20:
                this.automaticNewlineMode = true;
                break;
            }
        }
        break;
    case 108 /*'l'*/:
        param = this.getParameter(0, 0);
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // DEC Private Mode Reset (DECRST)
            switch (param) {
            case 1:
                // Normal Cursor Keys (DECCKM)
                this.applicationCursorKeysMode = false;
                break;
            case 3:
                this.forceWidthInColumns(80);
                break;
            case 6:
                this.originMode = false;
                break;
            case 7:
                this.wraparoundMode &= ~2;
                break;
            case 45:
                this.wraparoundMode &= ~1;
                break;
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
            case 2004:
                this.bracketedPasteMode = false;
                break;
            }
        } else {
            switch (param) {
            case 4:
                this.insertMode = false;
                break;
            case 20:
                this.automaticNewlineMode = false;
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
                case 3:
                    this._pushStyle("font-style", "italic");
                    break;
                case 23:
                    this._pushStyle("font-style", null);
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
            var r = this.getCursorLine();
            var c = this.getCursorColumn();
            if (c == this.numColumns)
                c--;
            if (this.originMode) {
                r -= this._regionTop;
                c -= this._regionLeft;
            }
            this.processResponseCharacters("\x1B["+(r+1)+";"+(c+1)+"R");
            break;
        }
        break;
    case 112 /*'p'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE) {
            // Soft terminal reset (DECSTR)
            this.resetTerminal(False, False);
        }
        break;
    case 114 /*'r'*/: // DECSTBM - set scrolling region
        var top = this.getParameter(0, 1);
        var bot = this.getParameter(1, -1);
        if (bot > this.numRows || bot <= 0)
            bot = this.numRows;
        if (bot > top) {
            this._setRegionTB(top - 1, bot);
            this.cursorSet(0, 0, this.originMode);
        }
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
        case 18: // End non-selectable prompt
            var container = this.outputContainer;
            var content = container.textContent;
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
            this.outputContainer.setAttribute("value", content);
            // ... fall through ...
        case 13: // End (selectable) prompt
            this._pushStyle("std", null);
            // Force inputLine outside prompt
            this._adjustStyle();
            break;
        case 14:
        case 24:
            var curOutput = this._currentCommandOutput;
            if (curOutput
                && curOutput.firstChild == this.outputContainer
               && curOutput.firstChild == curOutput.lastChild) {
                // This is a continuation prompt, for multiline input.
                // Remove the _currentCommandOutput.
                curOutput.parentNode.insertBefore(this.outputContainer, curOutput);
                curOutput.parentNode.removeChild(curOutput);
                if (this._currentCommandHideable)
                    this.outputContainer.setAttribute("domterm-hidden", "false");
            }
            this._pushStyle("std", "prompt");
            if (param == 24)
                this.inputLine.setAttribute("continuation", "true");
            else
                this.inputLine.removeAttribute("continuation");
            break;
        case 15:
            this._pushStyle("std", "input");
            this._adjustStyle();
            break;
        case 16:
            this._pushStyle("std", "hider");
            this._adjustStyle(); // Force - even if empty
            this._currentCommandHideable = true;
            break;
        case 17:
            this._pushStyle("std", null);
            this.outputContainer.addEventListener("click",
                                                  this._showHideEventHandler,
                                                  true);
            this._adjustStyle();
            break;
        case 19:
            this.startCommandGroup();
            break;
        case 80: // set input mode
            this.setInputMode(this.getParameter(1, 112));
            break;
        case 99:
            if (this.getParameter(1, 0) == 99)
                this.eofSeen();
            break;
        }
        break;
    default:
        if (last < 32) {
            // vttest depends on this behavior
            this.insertString(String.fromCharCode(last));
            if (last != 24 && last != 26 && last != 27)
                this.controlSequenceState = oldState;
        } else
            ; // FIXME
    }
};

DomTerm.prototype.handleBell = function() {
    // Do nothing, for now.
};

DomTerm.prototype.handleLink = function(event, href) {
    event.preventDefault();
    this.reportEvent("ALINK", JSON.stringify(href));
};

DomTerm.prototype.setWindowTitle = function(title, option) {
    document.title = title;
};

DomTerm.prototype.resetTerminal = function(full, saved) {
    // Corresponds to xterm's ReallyReset function
    this._setRegionTB(0, -1);
    this._setRegionLR(0, -1);
    this.originMode = false;
    this.bracketedPasteMode = false;
    this.wraparoundMode = 2;
    this.forceWidthInColumns(-1);
    // FIXME a bunch more
};

DomTerm.prototype._selectGcharset = function(g, whenShifted/*igored*/) {
    this._Glevel = g;
    this.charMapper = this._Gcharsets[g];
};

// DEC Special Character and Line Drawing Set.
// http://vt100.net/docs/vt102-ug/table5-13.html
// A lot of curses apps use this if they see TERM=xterm.
// testing: echo -e '\e(0a\e(B'
// The xterm output sometimes seems to conflict with the
// reference above. xterm seems in line with the reference
// when running vttest however.
// The table below now uses xterm's output from vttest.
DomTerm.charsetSCLD = function(ch) {
    if (ch >= 96 && ch <= 126)
        return "\u25c6\u2592\u2409\u240c\u240d\u240a\u00b0\u00b1\u2424\u240b\u2518\u2510\u250c\u2514\u253c\u23ba\u23bb\u2500\u23bc\u23bd\u251c\u2524\u2534\u252c\u2502\u2264\u2265\u03c0\u2260\u00a3\u00b7".charAt(ch-96);
    return null;
};
DomTerm.charsetUK = function(ch) {
    // Convert '#' to pound (sterling) sign
    if (ch==35)
        return "\xa3";
    return null;
};

DomTerm.prototype._unsafeInsertHTML = function(text) {
    if (this.verbosity >= 1)
        this.log("_unsafeInsertHTML "+JSON.stringify(text));
    if (this.outputBefore != null)
        this.outputBefore.insertAdjacentHTML("beforebegin", text);
    else
        this.outputContainer.insertAdjacentHTML("beforeend", text);
};

// Bit 0 (value 1): Allow in inserted HTML
// Bit 1 (value 2): Some attributes may need scrubbing
// Bit 2 (value 4): "Phrasing [inline] content"
// Bit 3 (value 8): Allow in SVG
DomTerm.prototype.elementInfo = function(tag, parents) {
    var v = DomTerm.HTMLinfo.hasOwnProperty(tag) ? DomTerm.HTMLinfo[tag] : 0;

    if ((v & 8) == 8) { // If allow in SVG, check parents for svg
        for (var i = parents.length; --i >= 0; ) {
            if (parents[i] == "svg") {
                v |= 1;
                break;
            }
        }
    }
    return v;
};

DomTerm.prototype.allowAttribute = function(name, value, einfo, parents) {
    //Should "style" be allowed?  Or further scrubbed?
    //It is required for SVG. FIXME.
    //if (name=="style")
    //    return false;
    if (name.startsWith("on"))
        return false;
    if ((einfo & 2) != 0) {
        if (name=="href" || name=="src") {
            // scrub for "javascript:"
            var amp = value.indexOf("&");
            var colon = value.indexOf(":");
            if (amp >= 0 && amp <= 11 && (colon < 0 || amp <= colon))
                return false;
            if (value.startsWith("javascript:"))
                return false;
        }
    }
    return true;
};

//FIXME Study the following:
//https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet

DomTerm.HTMLinfo = {
    "a": 7, // need to check "href" for "javascript:"
    "abbr": 5,
    "altGlyph": 12,
    "altGlyphDef": 12,
    "altGlyphItem": 12,
    "animate": 12,
    "animateColor": 12,
    "animateMotion": 12,
    "animateTransform": 12,
    "b": 5,
    "circle": 12,
    "cite": 5,
    "clipPath": 12,
    "code": 5,
    "color-profile": 12,
    "cursor": 12,
    "dfn": 5,
    "defs": 12,
    "desc": 12,
    "div": 1,
    "ellipse": 12,
    "em": 5,
    "feBlend": 12,
    "feColorMatrix": 12,
    "feComponentTransfer": 12,
    "feComposite": 12,
    "feConvolveMatrix": 12,
    "feDiffuseLighting": 12,
    "feDisplacementMap": 12,
    "feDistantLight": 12,
    "feFlood": 12,
    "feFuncA": 12,
    "feFuncB": 12,
    "feFuncG": 12,
    "feFuncR": 12,
    "feGaussianBlur": 12,
    "feImage": 12,
    "feMerge": 12,
    "feMergeNode": 12,
    "feMorphology": 12,
    "feOffset": 12,
    "fePointLight": 12,
    "feSpecularLighting": 12,
    "feSpotLight": 12,
    "feTile": 12,
    "feTurbulence": 12,
    "filter": 12,
    "font": 12,
    "font-face": 12,
    "font-face-format": 12,
    "font-face-name": 12,
    "font-face-src": 12,
    "font-face-uri": 12,
    "foreignObject": 12,
    "g": 12,
    "glyph": 12,
    "glyphRef": 12,
    "hkern": 12,
    "hr": 1,
    "i": 5,
    "image": 12, // FIXME
    "img": 7, // need to check "src" for "javascript:"
    "line": 12,
    "linearGradient": 12,
    "mark": 5,
    "marker": 12,
    "mask": 12,
    "metadata": 12,
    "missing-glyph": 12,
    "mpath": 12,
    "p": 1,
    "path": 12,
    "pattern": 12,
    "polygon": 12,
    "polyline": 12,
    "pre": 1,
    "q": 5,
    "radialGradient": 12,
    "rect": 12,
    "samp": 5,
    "script": 12, // ?
    "script": 0,
    "set": 12,
    "small": 5,
    "span": 5,
    "stop": 12,
    "strong": 5,
    "style": 12,
    "sub": 5,
    "sup": 5,
    "svg": 13,
    "switch": 12,
    "symbol": 12,
    "text": 12,
    "textPath": 12,
    "title": 12,
    "tref": 12,
    "tspan": 12,
    "u": 5,
    "use": 12,
    "view": 12,
    "var": 5,
    "vkern": 12,
    
    // Phrasing content:
    //area (if it is a descendant of a map element) audio bdi bdo br button canvas data datalist del embed iframe input ins kbd keygen label map math meter noscript object output progress q ruby s select svg template textarea time u  video wbr text
};

DomTerm.prototype._scrubAndInsertHTML = function(str) {
    var len = str.length;
    var start = 0;
    var ok = 0;
    var i = 0;
    var activeTags = new Array();
    loop:
    for (;;) {
        if (i == len) {
            ok = i;
            break;
        }
        var ch = str.charCodeAt(i++);
        switch (ch) {
        case 38 /*'&'*/:
            ok = i-1;
            for (;;) {
                if (i == len)
                    break loop;
                ch = str.charCodeAt(i++);
                if (ch == 59) //';'
                    break;
                if (! ((ch >= 65 && ch <= 90)  // 'A'..'Z'
                       || (ch >= 97 && ch <= 122) // 'a'..'z'
                       || (ch >= 48 && ch <= 57) // '0'..'9'
                       || (ch == 35 && i==ok+2))) // initial '#'
                    break loop;
            }
            break;
        case 62: // '>'
            ok = i-1;
            break;
        case 60 /*'<'*/:
            ok = i-1;
            if (i + 1 == len)
                break loop; // invalid
            ch = str.charCodeAt(i++);
            var end = ch == 47; // '/';
            if (end)
                ch = str.charCodeAt(i++);
            for (;;) {
                if (i == len)
                    break loop; // invalid
                ch = str.charCodeAt(i++);
                if (! ((ch >= 65 && ch <= 90)  // 'A'..'Z'
                       || (ch >= 97 && ch <= 122) // 'a'..'z'
                       || (ch >= 48 && ch <= 57) // '0'..'9'
                       || (ch == 35 && i==ok+2))) // initial '#'
                    break;
            }
            if (end) {
                if (ch != 62) // '>'
                    break loop; // invalid
                var tag = str.substring(ok+2,i-1);
                if (activeTags.length == 0) {
                    // FIXME check current context
                    break loop;
                } else if (activeTags.pop() == tag) {
                    ok = i;
                    continue;
                } else
                    break loop; // invalid - tag mismatch                    
            } else {
                var tag = str.substring(ok+1,i-1);
                var einfo = this.elementInfo(tag, activeTags);
                if ((einfo & 1) == 0)
                    break loop;
                activeTags.push(tag);
                // we've seen start tag - now check for attributes
                for (;;) {
                    while (ch == 32 && i < len)
                        ch = str.charCodeAt(i++);
                    var attrstart = i-1;
                    while (ch != 61 && ch != 62 && ch != 47) { //' =' '>' '/'
                        if (i == len || ch == 60 || ch == 38) //'<' or '&'
                            break loop; // invalid
                        ch = str.charCodeAt(i++);
                    }
                    var attrend = i-1;
                    if (attrstart == attrend) {
                        if (ch == 62 || ch == 47) // '>' or '/'
                            break;
                        else
                            break loop; // invalid - junk in element start
                    }
                    if (ch != 61) // '='
                        break loop; // invalid - name not followed by '='
                    var attrname = str.substring(attrstart,attrend);
                    if (i == len)
                        break loop; // invalid
                    var quote = i == len ? -1 : str.charCodeAt(i++);
                    if (quote != 34 && quote != 39) // '"' or '\''
                        break loop; // invalid
                    var valstart = i;
                    for (;;) {
                        if (i+1 >= len) //i+1 to allow for '/' or '>'
                            break loop; // invalid
                        ch = str.charCodeAt(i++);
                        if (ch == quote)
                            break;
                    }
                    var attrvalue = str.substring(valstart,i-1);
                    if (! this.allowAttribute(attrname, attrvalue,
                                              einfo, activeTags))
                        break loop;
                    ch = str.charCodeAt(i++); // safe because of prior i+1

                }
                while (ch == 32 && i < len)
                    ch = str.charCodeAt(i++);
                if (ch == 47) { // '/'
                    if (i == len || str.charCodeAt(i++) != 62) // '>'
                        break loop; // invalid
                    activeTags.pop();
                } else if (ch != 62) // '>'
                    break loop; // invalid
                ok = i;
            }
            break;
        }
    }
    if (ok < len) {
        var span = this._createSpanNode();
        span.setAttribute("style", "background-color: #fbb");
        this.insertNode(span);
        span.appendChild(document.createTextNode(str.substring(ok, len)));
    }
    else if (ok > start) {
        this._unsafeInsertHTML(str.substring(start, ok));
    }
};


DomTerm.prototype.handleOperatingSystemControl = function(code, text) {
    if (this.verbosity >= 2)
        this.log("handleOperatingSystemControl "+code+" '"+text+"'");
    switch (code) {
    case 0:
    case 1:
    case 2:
        this.setWindowTitle(text, code);
        break;
    case 72:
        this._scrubAndInsertHTML(text);
        this.cursorColumn = -1;
        break;
    case 74:
        var sp = text.indexOf(' ');
        var key = parseInt(text.substring(0, sp), 10);
        var kstr = JSON.parse(text.substring(sp+1));
        if (this.verbosity >= 2)
            this.log("OSC KEY k:"+key+" kstr:"+this.toQuoted(kstr));
        this.lineEditing = true;
        this.doLineEdit(key, kstr);
        break;
    case 7:
        // text is pwd as URL: "file://HOST/PWD"
        // Is printed by /etc/profile/vte.sh on Fedora
        break;
    case 777:
        // text is "\u001b]777;COMMAND"
        // Is printed by /etc/profile/vte.sh on Fedora
        break;
    case 90:
        this.reportStylesheets();
        break;
    case 91:
    case 92:
        var r = this.maybeDisableStyleSheet(text, code==91);
        this.processResponseCharacters("\x9D" + r + "\n");
        break;
    case 93:
        var r = this.printStyleSheet(text);
        this.processResponseCharacters("\x9D" + r + "\n");
        break;
    case 94:
        this.addStyleRule(JSON.parse(text));
        this.measureWindow();
        break;
    case 95:
        var args = JSON.parse("["+text+"]");
        var r = this.loadStyleSheet(args[0], args[1]);
        this.processResponseCharacters("\x9D" + r + "\n");
        this.measureWindow();
        break;
    default:
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

DomTerm.prototype.insertString = function(str) {
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
        var state = this.controlSequenceState;
        switch (state) {
        case DomTerm.SEEN_ESC_STATE:
            this.insertSimpleOutput(str, prevEnd, i);
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            switch (ch) {
            case 35 /*'#'*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_SHARP_STATE;
                break;
            case 40 /*'('*/: // Designate G0 Character Set (ISO 2022, VT100)
                this.controlSequenceState = DomTerm.SEEN_ESC_CHARSET0;
                break;
            case 41 /*')'*/: // Designate G1 Character Set
            case 45 /*'-'*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_CHARSET1;
                break;
            case 42 /*'*'*/: // Designate G2 Character Set
            case 46 /*'.'*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_CHARSET2;
                break;
            case 43 /*'+'*/: // Designate G3 Character Set
                this.controlSequenceState = DomTerm.SEEN_ESC_CHARSET3;
                break;
            case 47 /*'/'*/: // Designate G3 Character Set (VT300).
                // These work for 96-character sets only.
                // followed by A:  -> ISO Latin-1 Supplemental.
                break; // FIXME - not implemented
            case 55 /*'7'*/: // DECSC
                this.saveCursor(); // FIXME
                break;
            case 56 /*'8'*/: // DECRC
                this.restoreCursor(); // FIXME
                break;
            case 68 /*'D'**/: // IND index
                this.cursorNewLine(false);
                break;
            case 69 /*'E'*/: // NEL
                this.cursorNewLine(true);
                break;
            case 77 /*'M'*/: // Reverse index
                var line = this.getCursorLine();
                if (line == this._regionTop)
                    this.scrollReverse(1);
                this.cursorDown(-1);
                break;
            case 78 /*'N'*/: // SS2
            case 79 /*'O'*/: // SS3
                this.controlSequenceState = ch - 78 + DomTerm.SEEN_ESC_SS2;
                break;
            case 91 /*'['*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_STATE;
                this.parameters.length = 1;
                this.parameters[0] = null;
                break;
            case 93 /*']'*/:
                this.controlSequenceState = DomTerm.SEEN_ESC_RBRACKET_STATE;
                this.parameters.length = 1;
                this.parameters[0] = null;
                break;
            case 99 /*'c'*/: // Full Reset (RIS)
                this.resetTerminal(True, True);
                break;
            case 110 /*'n'*/: // LS2
            case 111 /*'o'*/: // LS3
                this._selectGcharset(ch-108, false);
                break;
            case 126 /*'~'*/: // LS1R
            case 125 /*'}'*/: // LS2R
            case 124 /*'|'*/: // LS3R
                this._selectGcharset(127-ch, true); // Not implemented
                break;
            //case 60 /*'<'*/: // Exit VT52 mode (Enter VT100 mode
            //case 61 /*'='*/: // VT52 mode: Enter alternate keypad mode
            //case 62 /*'>'*/: // VT52 mode: Enter alternate keypad mode
            default: ;
            }
            prevEnd = i + 1;
            break;
        case DomTerm.SEEN_ESC_LBRACKET_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE:
            if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                var plen = this.parameters.length;
                var cur = this.parameters[plen-1];
                cur = cur ? 10 * cur : 0;
                this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
            }
            else if (ch == 59 /*';'*/) {
                this.parameters.push(null);
            }
            else if (ch == 62 /*'>'*/)
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE;
            else if (ch == 63 /*'?'*/)
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE;
            else if (ch == 33 /*'!'*/)
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE;
            else {
                this.handleControlSequence(ch);
                this.parameters.length = 1;
                prevEnd = i + 1;
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
        case DomTerm.SEEN_ESC_CHARSET0:
        case DomTerm.SEEN_ESC_CHARSET1:
        case DomTerm.SEEN_ESC_CHARSET2:
        case DomTerm.SEEN_ESC_CHARSET3:
            var cs;
            switch (ch) {
            case 48 /*'0'*/: // DEC Special Character and Line Drawing Set.
                cs = DomTerm.charsetSCLD;
                break;
            case 65 /*'A'*/: // UK
                cs = DomTerm.charsetUK;
                break;
            case 66 /*'B'*/: // United States (USASCII).
            default:
                cs = null;
            };
            var g = state-DomTerm.SEEN_ESC_CHARSET0;
            this._Gcharsets[g] = cs;
            this._selectGcharset(this._Glevel, false);
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            prevEnd = i + 1;
            break;
        case DomTerm.SEEN_ESC_SHARP_STATE: /* SCR */
            switch (ch) {
            case 56 /*'8'*/: // DEC Screen Alignment Test (DECALN)
                this._setRegionTB(0, -1);
                this._setRegionLR(0, -1);
                this.moveToIn(0, 0, true);
                this.eraseDisplay(0);
                var Es = "E".repeat(this.numColumns);
                for (var r = 0; ; ) {
                    this.insertSimpleOutput(Es, 0, this.numColumns);
                    if (++r >= this.numRows)
                        break;
                    this.cursorLineStart(1);
                }
                this.moveToIn(0, 0, true);
                break;
            }
            prevEnd = i + 1;
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            break;
        case DomTerm.SEEN_ESC_SS2:
        case DomTerm.SEEN_ESC_SS3:
            var mapper = this._Gcharsets[state-DomTerm.SEEN_ESC_SS2+2];
            prevEnv = i;
            if (mapper != null) {
                var chm = this.charMapper(ch);
                if (chm != null) {
                    this.insertSimpleOutput(chm, 0, chm.length);
                    prevEnd = i + 1;
                }
            }
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            break;
        case DomTerm.INITIAL_STATE:
            switch (ch) {
            case 13: // '\r' carriage return
                this.insertSimpleOutput(str, prevEnd, i);
                //this.currentCursorColumn = column;
                // FIXME adjust for _regionLeft
                if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                    && this.getCursorLine() !== this._regionBottom-1) {
                    if (this._currentStyleMap.get("std") == "input")
                        this._pushStyle("std", null);
                    this.cursorLineStart(1);
                    i++;
                } else {
                    this.cursorLineStart(0);
                }
                prevEnd = i + 1;
                break;
            case 10: // '\n' newline
            case 11: // vertical tab
            case 12: // form feed
                this.insertSimpleOutput(str, prevEnd, i);
                if (this._currentStyleMap.get("std") == "input")
                    this._pushStyle("std", null);
                this.cursorNewLine(this.automaticNewlineMode);
                prevEnd = i + 1;
                break;
            case 27 /* Escape */:
                this.insertSimpleOutput(str, prevEnd, i);
                //this.currentCursorColumn = column;
                prevEnd = i + 1;
                this.controlSequenceState = DomTerm.SEEN_ESC_STATE;
                continue;
            case 8 /*'\b'*/:
                this.insertSimpleOutput(str, prevEnd, i);
                this.cursorLeft(1);
                prevEnd = i + 1; 
                break;
            case 9 /*'\t'*/:
                this.insertSimpleOutput(str, prevEnd, i);
                var nextStop = this.nextTabCol(this.getCursorColumn());
                this.cursorRight(nextStop-this.currentCursorColumn);
                prevEnd = i + 1;
                break;
            case 7 /*'\a'*/:
                this.insertSimpleOutput(str, prevEnd, i); 
                //this.currentCursorColumn = column;
                this.handleBell();
                prevEnd = i + 1;
                break;
            case 24: case 26:
                this.controlSequenceState = DomTerm.INITIAL_STATE;
                break;
            case 14 /*SO*/:
                this._selectGcharset(1, false);
                break;
            case 15 /*SI*/:
                this._selectGcharset(0, false);
                break;
            case 5 /*ENQ*/: // FIXME
            case 0: case 1: case 2:  case 3:
            case 4: case 6:
            case 16: case 17: case 18: case 19:
            case 20: case 21: case 22: case 23: case 25:
            case 28: case 29: case 30: case 31:
            case 7: // ignore
                this.insertSimpleOutput(str, prevEnd, i);
                prevEnd = i + 1;
                break;
            default:
                if (this.charMapper != null) {
                    var chm = this.charMapper(ch);
                    if (chm != null) {
                        this.insertSimpleOutput(str, prevEnd, i);
                        this.insertSimpleOutput(chm, 0, chm.length);
                        prevEnd = i + 1;
                        break;
                    }
                }
            }
        }
    }
    if (this.controlSequenceState == DomTerm.INITIAL_STATE) {
        this.insertSimpleOutput(str, prevEnd, i);
        //this.currentCursorColumn = column;
    }
    if (this.controlSequenceState == DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE) {
        this.parameters[1] = this.parameters[1] + str.substring(prevEnd, i);
    }
    this._restoreInputLine();
    if (true) { // FIXME only if "scrollWanted"
        this._scrollIfNeeded();
    }
    this.inputLine.focus();
};

DomTerm.prototype._scrollIfNeeded = function() {
    var last = this.topNode.lastChild;
    var lastBottom = last.offsetTop + last.offsetHeight;
    if (lastBottom > this.topNode.scrollTop + this.availHeight)
        this.topNode.scrollTop = lastBottom - this.availHeight;
}

DomTerm.prototype._breakAllLines = function(oldWidth) {
    var changed = false;
    var startLine = 0;
    if (this.usingAlternateScreenBuffer) {
        if (this.initial && this.initial.saveLastLine >= 0) // paranoia
            startLine = this.initial.saveLastLine;
        else
            startLine = this.homeLine;
    }
    for (var line = startLine;  line < this.lineStarts.length;  line++) {
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
    if (this.lineStarts.length - this.homeLine > this.numRows) {
        var absLine = this.homeLine + this.getCursorLine();
        this.homeLine = this.lineStarts.length - this.numRows;
        if (absLine < this.homeLine) {
            this.resetCursorCache();
            this.moveToIn(0, 0, false);
        }
    }
}

DomTerm.prototype._breakLine = function(start, line, beforePos, availWidth, rebreak) {
    for (var el = start; el != null;  ) {
        var next;
        if (el instanceof Element) {
            next = el.nextSibling;
            var right = beforePos + el.offsetWidth;
            if (right > availWidth) {
                right = this._breakLine(el.firstChild, line, beforePos, availWidth, rebreak);
            }
            beforePos = right;
        } else { // el instanceof Text
            this._normalize1(el);
            next = el.nextSibling;
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
    if (goodLength == 0)
        textNode.parentNode.removeChild(textNode);
    else if (textNode.data.length != goodLength)
        textNode.data = textData.substring(0, goodLength);
    // textNode.data == textData.subString(0,goodLength) || goodLength == 0;
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
        if (lineEnd == this.outputBefore) {
            this.outputBefore = lineEnd.nextSibling;
            this.outputContainer = lineEnd.parentNode;
        }
        lineEnd.parentNode.removeChild(lineEnd);
    }
    if (goodLength < textLength) {
        var rest;
        if (goodLength == 0) {
            textNode.data = textData;
            rest = textNode;
        } else {
            var restString = textData.substring(goodLength);
            rest = document.createTextNode(restString);
        }
        lineNode.parentNode.insertBefore(rest, lineNode.nextSibling);
        return rest;
    } else
        return rebreak ? lineNode.nextSibling : null;
};

DomTerm.prototype.insertSimpleOutput = function(str, beginIndex, endIndex) {
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
    var absLine = this.homeLine+this.getCursorLine();
    var textNode = this.insertRawOutput(str);
    while (textNode != null) {
        var afterPos = this._offsetLeft(this.outputBefore,
                                        this.outputContainer);
        var lineEnd = this.lineEnds[absLine];
        var clientWidth = this.initial.clientWidth;
        var availWidth = clientWidth - this.rightMarginWidth;
        if (afterPos > availWidth && this.wraparoundMode >= 2) {
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

DomTerm.prototype.reportText = function(text, suffix) {
    if (this.bracketedPasteMode)
        text = "\x1B[200~" + text + "\x1B[201~";
    if (suffix)
        text = text + suffix;
    this.processInputCharacters(text);
};

/** This function should be overidden. */
DomTerm.prototype.processInputCharacters = function(str) {
    this.log("processInputCharacters called with %s characters", str.length);
};

DomTerm.prototype.processEnter = function() {
    var text = this.grabInput(this.inputLine);
    this.handleEnter(text);
    if (this.verbosity >= 2)
        this.log("processEnter \""+this.toQuoted(text)+"\"");
    this.reportText(text, "\n");
};

/** param is either a numerical code, as as string (e.g. "15" for F5);
    or "O" for ones that use SS3 (F1 to F4);
    or "" for ones that use CSI or SS3 depending on application mode.
*/
DomTerm.prototype.specialKeySequence = function(param, last, event) {
    var csi = "\x1B[";
    var mods = 0;
    if (event.shiftKey)
        mods += 1;
    if (event.altKey)
        mods += 2;
    if (event.ctrlKey)
        mods += 4;
    if (event.metaKey)
        mods += 8;
    if (mods > 0)
        return csi+(param==""||param=="O"?"1":param)+";"+(mods+1)+last;
    else if ((this.applicationCursorKeysMode && param == "") || param == "O")
        return "\x1BO"+last;
    else
        return csi+param+last;
};

DomTerm.prototype.keyDownToString = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    switch (key) {
    case 8: /* Backspace */ return "\x7F";
    case 9: /* Tab */    return "\t";
    case 27: /* Esc */   return "\x1B";
    case 33 /* PageUp*/: return this.specialKeySequence("5", "~", event);
    case 34 /* PageDown*/:return this.specialKeySequence("6", "~", event);
    case 35 /*End*/:     return this.specialKeySequence("", "F", event);
    case 36 /*Home*/:    return this.specialKeySequence("", "H", event);
    case 37 /*Left*/:  return this.specialKeySequence("", "D", event);
    case 38 /*Up*/:    return this.specialKeySequence("", "A", event);
    case 39 /*Right*/: return this.specialKeySequence("", "C", event);
    case 40 /*Down*/:  return this.specialKeySequence("", "B", event);
    case 45 /*Insert*/:  return this.specialKeySequence("2", "~", event);
    case 46 /*Delete*/:  return this.specialKeySequence("3", "~", event);
    case 112: /* F1 */   return this.specialKeySequence("O", "P", event);
    case 113: /* F2 */   return this.specialKeySequence("O", "Q", event);
    case 114: /* F3 */   return this.specialKeySequence("O", "R", event);
    case 115: /* F4 */   return this.specialKeySequence("O", "S", event);
    case 116: /* F5 */   return this.specialKeySequence("15", "~", event);
    case 117: /* F6 */   return this.specialKeySequence("17", "~", event);
    case 118: /* F7 */   return this.specialKeySequence("18", "~", event);
    case 119: /* F8 */   return this.specialKeySequence("19", "~", event);
    case 120: /* F9 */   return this.specialKeySequence("20", "~", event);
    case 121: /* F10 */  return this.specialKeySequence("21", "~", event);
    case 122: /* F11 */  return this.specialKeySequence("23", "~", event);
    case 123: /* F12 */  return this.specialKeySequence("24", "~", event);
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
    case 91: case 93: case 224:
        // Command-key on MacOS (Chrome or Firefox)
        return null;
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
        this.reportText(str);
    }
};

DomTerm.prototype.doPaste = function() {
    this.inputLine.focus();
    return document.execCommand("paste", false);
};

DomTerm.prototype.doCopy = function() {
    return document.execCommand("copy", false);
};

DomTerm.prototype.getSelectedText = function() {
    return window.getSelection().toString();
};

DomTerm.prototype.listStylesheets = function() {
    var styleSheets = document.styleSheets;
    var result = new Array();
    var numStyleSheets = styleSheets.length;
    for (var i = 0; i < numStyleSheets; i++) {
        var styleSheet = styleSheets[i];
        var title = styleSheet.title;
        var href = styleSheet.ownerNode.getAttribute("href");
        if (! href)
             href = styleSheet.ownerNode.getAttribute("name");
        var line = styleSheet.disabled ? "disabled " : "enabled  ";
        line += title ? JSON.stringify(title) : "-";
        line += " ";
        line += href ? JSON.stringify(href) : "-";
        result[i] = line;
    }
    return result;
};

DomTerm.prototype.reportStylesheets = function() {
    this.processResponseCharacters("\x9D" + this.listStylesheets().join("\t")
                                   + "\n");
};

DomTerm.prototype.printStyleSheet = function(specifier) {
    var styleSheet = this.findStyleSheet(specifier);
    if (typeof styleSheet == "string")
        return styleSheet; // error message
    var rules = styleSheet.cssRules;
    if (! rules)
        return "stylesheet rules not available";
    var count = rules.length;
    var result = "";
    for (var i = 0; i < count; i++) {
        if (i > 0)
            result = result + " ";
        result = result + JSON.stringify(rules[i].cssText);
    }
    return result;
};

DomTerm.prototype.createStyleSheet = function() {
    var head = document.getElementsByTagName("head")[0];
    var style = document.createElement("style");
    head.appendChild(style);
    return style.sheet;
    //var styleSheets = document.styleSheets;
    //return styleSheets[styleSheets.length-1];
}

DomTerm.prototype.getTemporaryStyleSheet = function() {
    var styleSheet = this.temporaryStyleSheet;
    if (! styleSheet || ! styleSheet.parentNode) {
        styleSheet = this.createStyleSheet();
        styleSheet.ownerNode.setAttribute("name", "(temporary-styles)");
        this.temporaryStyleSheet = styleSheet;
    }
    return styleSheet;
};

DomTerm.prototype.addStyleRule = function(styleRule) {
    var styleSheet = this.getTemporaryStyleSheet();
    styleSheet.insertRule(styleRule, styleSheet.cssRules.length);
};

DomTerm.prototype.loadStyleSheet = function(name, value) {
    var styleSheets = document.styleSheets;
    var i = styleSheets.length;
    var ownerNode;
    for (;;) {
        if (--i < 0) {
            ownerNode = null;
            break;
        }
        var ownerNode = styleSheets[i].ownerNode;
        if (ownerNode && ownerNode.getAttribute("name") == name)
            break;
    }
    var parent;
    var following;
    if (ownerNode == null) {
        parent = document.getElementsByTagName("head")[0];
        following = null;
        i = styleSheets.length;
    } else {
        parent = ownerNode.parentNode;
        following = ownerNode.nextSibling;
        parent.removeChild(ownerNode);
    }
    ownerNode = document.createElement("style");
    ownerNode.setAttribute("name", name);
    ownerNode.appendChild(document.createTextNode(value));
    parent.insertBefore(ownerNode, following);
    return i;
};

/** Look for a styleshet named by the specifier.
 * Return a CSSStyleSheet if found or a string (error message) ptherwise.
*/
DomTerm.prototype.findStyleSheet = function(specifier) {
    if (! specifier || typeof specifier != "string")
        return "invalid stylesheet specifier";
    var styleSheets = document.styleSheets;
    var styleSheet;
    var index = Number(specifier);
    if (index) {
        if (index < 0 || index >= styleSheets.length)
            return "invalid stylesheet index";
        return styleSheet = styleSheets[index];
    } else {
        var exactMatch = -1;
        var ignoreCaseMatch = -1;
        var substringMatch = -1;
        var specifierLc = specifier.toLowerCase();
        for (var i = styleSheets.length; --i >= 0; ) {
            styleSheet = styleSheets[i];
            if (styleSheet.title) {
                if (styleSheet.title == specifier)
                    exactMatch = exactMatch == -1 ? i : -2;
                var titleLc = styleSheet.title.toLowerCase();
                if (titleLc == specifierLc)
                    ignoreCaseMatch = ignoreCaseMatch == -1 ? i : -2;
                if (titleLc.indexOf(specifierLc) >= 0)
                    substringMatch = substringMatch == -1 ? i : -2;
            }
        }
        if (exactMatch >= 0)
            return styleSheets[exactMatch];
        if (ignoreCaseMatch >= 0)
            return styleSheets[ignoreCaseMatch];
        if (substringMatch >= 0)
            return styleSheets[substringMatch];
        if (exactMatch == -2 || ignoreCaseMatch == -2 || substringMatch == -2)
            return "ambiguous stylesheet specifier";
        return "no matching stylesheet";
    }
};

DomTerm.prototype.maybeDisableStyleSheet = function(specifier, disable) {
    var styleSheet = this.findStyleSheet(specifier);
    if (typeof styleSheet == "string")
        return styleSheet;
    styleSheet.disabled = disable;
    return "";
};

DomTerm.prototype.setInputMode = function(mode) {
    switch (mode) {
    case 97 /*'a'*/: //auto
        this.autoEditing = true;
        this.lineEditing = false;
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
    this.automaticNewlineMode = ! this.clientDoesEcho;
};

DomTerm.prototype.doLineEdit = function(key, str) {
    if (this.verbosity >= 2)
        this.log("doLineEdit "+key+" "+JSON.stringify(str));
    var rng = bililiteRange(this.inputLine).bounds('selection');
    switch (key) {
    case 13: // key-down event
    case -13: // key-press event
        this.processEnter();
        break;
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

DomTerm.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event);
    // Ctrl-Shift-C is Copy and Ctrl-Shift-V is Paste
    if (event.ctrlKey && event.shiftKey && (key == 67 || key == 86)) {
        // Google Chrome doesn't allow execCommand("paste") but Ctrl-Shift-V
        // works by default.  In Firefox, it's the other way round.
        if (key == 67 ? this.doCopy() : this.doPaste())
            event.preventDefault();
        return;
    }
    if (this.lineEditing) {
        this.inputLine.focus();
        if (key == 13) {
            event.preventDefault();
            this.processEnter();
            if (this.autoEditing)
                this.lineEditing = false;
        }
        else if (event.ctrlKey
                 && (key == 67 // ctrl-C
                     || (key == 68 // ctrl-D
                         && this.grabInput(this.inputLine).length == 0))) {
            event.preventDefault();
            if (this.autoEditing)
                this.lineEditing = false;
            this.reportKeyEvent(64 - key, // crl-C -> -3; ctrl-D -> -4
                                this.keyDownToString(event));
        } else if (key == 38/*Up*/) {
            if (this._atTopInputLine()) {
                event.preventDefault();
                this.historyMove(-1);
            }
        } else if (key == 40/*Down*/) {
            if (this._atBottomInputLine()) {
                event.preventDefault();
                this.historyMove(1);
            }
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
                this.reportKeyEvent(key, str);
            else
                this.processInputCharacters(str);
        }
    }
};

DomTerm.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" t:"+this.grabInput(this.inputLine)+" lineEdit:"+this.lineEditing+" do-line-edit:"+this.useDoLineEdit+" inputLine:"+this.inputLine);
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
                this.reportKeyEvent(-key, str);
            else
                this.processInputCharacters(str);
        }
        event.preventDefault();
    }
};

// For debugging: Checks a bunch of invariants
DomTerm.prototype._checkTree = function() {
    var node = this.initial;
    if (node.saveInitial)
        node = node.saveInitial;
    var dt = this;
    function error(str) {
        dt.log("ERROR: "+str);
    };
    var parent = node.parentNode;
    var cur = node;
    var istart = 0;
    var iend = 0;
    var nlines = this.lineStarts.length;
    if (this.currentCursorLine >= 0
        && this.homeLine + this.currentCursorLine >= nlines)
        error("bad currentCursorLine");
    if (this.outputBefore
        && this.outputBefore.parentNode != this.outputContainer)
        error("bad outputContainer");
    if (this.inputFollowsOutput && this.inputLine.parentNode
        && this.outputBefore != this.inputLine)
        error("bad inputLine");
    if (! this._isAnAncestor(this.outputContainer, this.initial))
        error("outputContainer not in initial");
    if (! this._isAnAncestor(this.lineStarts[this.homeLine], this.initial))
        error("homeLine not in initial");
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
            if (istart < nlines && this.lineStarts[istart] == cur)
                istart++;
            else if (istart + 1 < nlines && this.lineStarts[istart+1] == cur)
                error("line table out of order - missing line "+istart);
            if (iend < nlines && this.lineEnds[iend] == cur)
                iend++;
            if (iend > istart || istart > iend+1)
                error("line table out of order");
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
    if (this.lineStarts.length - this.homeLine > this.numRows)
        error("bad homeLine value!");
    if (this.usingAlternateScreenBuffer) {
        var main = this.initial.saveInitial;
        if (! main)
            error("saveInitial of alternate-screenbuffer not set");
        if (this._isAnAncestor(this.initial, main))
            error("alternate-screenbuffer nested in main-screenbuffer");
    }
};

DomTerm.prototype._atBottomInputLine = function() {
    var r1 = window.getSelection().getRangeAt(0);
    var r2 = document.createRange();
    r2.selectNode(this.inputLine);
    return this._countLinesBetween(r1.endContainer, r1.endOffset,
                                   r2.endContainer, r2.endOffset) <= 0;
};
DomTerm.prototype._atTopInputLine = function() {
    var r = window.getSelection().getRangeAt(0);
    return this._countLinesBetween(this.inputLine, 0,
                                   r.endContainer, r.endOffset) <= 0;
};

DomTerm.prototype._countLinesBetween = function(startNode, startOffset,
                                                endNode, endOffset) {
    var range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    // FIXME rather expensive - but it doesn't matter for short inputs
    var textBefore = range.cloneContents().textContent;
    var textLength = textBefore.length;
    var count = 0;
    for (var i = 0; i < textLength;  i++) {
        if (textBefore.charCodeAt(i) == 10)
            count++
    }
    return count;
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

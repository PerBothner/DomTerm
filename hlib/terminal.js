/** @license Copyright (c) 2015, 2016, 2017 Per Bothner.
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

/** [DOMToString was useful for the _formatDOM code.]
Copyright (c) 2009 Brett Zamir

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
    */
"use strict";

if (typeof ResizeSensor == "undefined" && typeof require !== "undefined")
    var ResizeSensor = require("./ResizeSensor.js");

/** @constructor */

function DomTerm(name, topNode) {
    // A unique name for this DomTerm instance.
    // Should match the syntax for an XML NCName, as it is used to
    // generate "id" attributes.  I.e. only allowed special characters
    // are '_', '-', and '.'; the first character must be a letter or '_'.
    // (Colons are technically allowed, but could cause problems.)
    // Generated named have the format:  name + "__" + something.
    this.name = name;

    this._updateTimer = null;

    this.windowName = null;
    this.windowTitle = null;
    this.iconName = null;
    
    // Input lines that have not been processed yet.
    // In some modes we support enhanced type-ahead: Input lines are queued
    // up and only released when requested.  This allows output from an
    // earlier command, as well as prompt text for a later command, to
    // be inserted before a later input-line.
    this.pendingInput = null;

    this._deferredLinebreaksStart = -1;

    this.lineIdCounter = 0; // FIXME temporary debugging

    this.insertMode = false;
    // If true, treat "\n" as "\r\n".
    this.automaticNewlineMode = false;

    // How are typed characters processed?
    // -1: character mode (each character/keystroke sent immediately to process)
    // 1: line mode (local editing, sent to process when Enter types).
    // 0: auto mode (either line and character depending on _clientWantsEditing)
    this._lineEditingMode = 0;
    // 1: client/inferor is in "canonical mode; 0: non-canonical mode.
    this._clientWantsEditing = 0;

    // We have two variations of autoEditing:
    // - If autoCheckInferior is false, then the inferior actively sends OSC 71
    // " handle tcsetattr", and we switch based on that. This is experimental.
    // - If autoCheckInferior is true, then when the user types a character
    // (and not isLineEditing()), then we send a "KEY" command to the
    // inferior, which calls tcgetattr to decide what to do.  (If CANON, the
    // key is sent back to DomTerm; otherwise, it is sent to the child proess.)
    this.autoLazyCheckInferior = true;

    // 0: not in paging or pause mode
    // 1: in paging mode
    // 2: in paused mode
    this._pagingMode = 0;
    this._muxMode = false;

    this._autoPaging = false;
    this._temporaryAutoPaging = false;
    this._pauseLimit = -1;
    this._receivedCount = 0;
    this._confirmedCount = 0;

    this.caretStyle = 1; // only if *not* isLineEditing()

    this.verbosity = 0;

    // Use the doLineEdit function when isLineEditing().
    // By default this is only used in autoEditing mode, in two cases:
    // (1) for the first character when switching from character to line mode.
    // (This is because we have check the backend pty for its status before
    // we can switch to lineEditing mode.)
    // (2) in cononical no-echo ("password") mode, because at least Chrome's
    // default actions does not edit a non-visible contentEditable field.
    // Otherwise (for now) we use the builtin contentEditable actions,
    // because doLineEdit's functionalty is relatively incomplete.
    // However, doLineEdit does open the possibility of user keymaps.
    this.useDoLineEdit = false;
    this._usingDoLineEdit = false;

    // True if a client performs echo on lines sent to it.
    // In that case, when isLineEditing(), when a completed
    // input line is sent to the client, it gets echoed by the client.
    // Hence we get two copies of each input line.
    // If this setting is true, we clear the contents of the input line
    // before the client echo.
    // If isLineEditing() is false, the client is always responsible
    // for echo, so this setting is ignored in that case.
    this.clientDoesEcho = true;

    // Used to implement clientDoesEscho handling.
    this._deferredForDeletion = null;

    this.topNode = null;

    // ??? FIXME we want to get rid of this
    this.initial = null;

    this._displayInfoWidget = null;
    this._displaySizePendingTimeouts = 0;
    this.modeLineGenerator = null;

    // Used if needed to add extra space at the bottom, for proper scrolling.
    // See note in eraseDisplay.
    this._vspacer = null;

    // Current line number, 0-origin, relative to start topNode
    // -1 if unknown. */
    this.currentAbsLine = -1;

    // Current column number, 0-origin
    // -1 if unknown. */
    this.currentCursorColumn = -1;

    this._savedCursor = null;

    this.rightMarginWidth = 0;

    // Number of vertical pixels available.
    this.availHeight = 0;
    // Number of horizontal pixels available.
    // Doesn't count scrollbar or rightMarginWidth.
    this.availWidth = 0;

    this.charWidth = 1;  // Width of a character in pixels
    this.charHeight = 1; // Height of a character in pixels

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
    // or when isLineEditing().
    // If null, this means append output to the end of the output container's
    // children. (FIXME: The null case is not fully debugged.)
    /** @type {Node|null} */
    this.outputBefore = null;

    // The parent node of the output position.
    // New output is by default inserted into this Node,
    // at the position indicated by outputBefore.
    /** @type {Node|null} */
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
    // It can be null if the corresponding lineStart is a block element
    // (possibly inserted using HTML "printing"); in that case the line
    // does not support line-breaking.
    this.lineEnds = new Array();

    // Index of the 'home' position in the lineStarts table.
    // Cursor motion is relative to the start of this line
    // (normally a pre).
    // "Erase screen" only erases starting at this line.
    this.homeLine = 0;

    // A stack of currently active "style" strings.
    this._currentStyleMap = new Map();
    // A span whose style is "correct" for _currentStyleMap.
    this._currentStyleSpan = null;

    this.applicationCursorKeysMode = false;
    this.originMode = false;
    // (wraparoundMode & 2) if wraparound enabled
    // (wraparoundMode & 1) if reverse wraparound should also be enabled
    this.wraparoundMode = 2;
    this.bracketedPasteMode = false;

    // One of: 0 (no mouse handling); 9 (X10); 1000 (VT200);
    //   1001 (VT200_HIGHLIGHT); 1002 (BTN_EVENT); 1003 (ANY_EVENT)
    this._mouseMode = 0;

    // How mouse coordinates are encoded in the response:
    // 0 - old single-byte; 1005 (UTF8-EXT); 1006 (SGR_EXT); 1015 (URXVT_EXT)
    this._mouseCoordEncoding = 0;

    this._sendFocus = false;

    /** @type {Array|null} */
    this.saved_DEC_private_mode_flags = null;

    // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/
    // 1: IME Composing going on;
    // 0: composition just ended - Used to swallow keyup event related to compositionend
    this._composing = -1; // > 0: IME Composing going on

    this._tabDefaultStart = 0;
    this._tabsAdded = null;

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

    /** @type {Element|null} */
    this._currentCommandGroup = null;
    /** @type {Element|null} */
    this._currentCommandOutput = null;
    /** @type{boolean} */
    this._currentCommandHideable = false;

    this._currentPprintGroup = null;
    // a chain of "line" and "pprint-group" elements that need
    // sectionEnd to be set (to a later "line" at same or higher level).
    this._needSectionEndList = null;
    this._needSectionEndFence = null;

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
    this._mouseEventHandler =
        function(evt) { dt._mouseHandler(evt); };
}

DomTerm._instanceCounter = 0;
DomTerm.layoutManager = null;

DomTerm.freshName = function() {
    return "domterm-"+(++DomTerm._instanceCounter);
}

DomTerm.prototype.eofSeen = function() {
    this.historySave();
    this.history.length = 0;
    this.close();
};

DomTerm.prototype.close = function() {
    if (DomTerm.domTermLayoutClose)
        DomTerm.domTermLayoutClose(this);
    else
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
        // this._moveNodes(firstChild, newParent, null)
        // Remove old empty domterm-output container.
        if (oldOutput && oldOutput.firstChild == null
            && oldOutput.parentNode != null
            && oldOutput != this.outputContainer) { // paranoia
            oldOutput.parentNode.removeChild(oldOutput);
        }
        this._currentCommandGroup = commandGroup;
        this._currentCommandOutput = null;
        this._currentCommandHideable = false;
    }
    this._temporaryAutoPaging = false;
};

// For debugging (may be overridden)
DomTerm.prototype.log = function(str) {
    // JSON.stringify encodes escape as "\\u001b" which is hard to read.
    str = str.replace(/\\u001b/g, "\\e");
    console.log(str);
};

DomTerm.focusedTerm = null;

DomTerm.setFocus = function(term) {
    var current = DomTerm.focusedTerm;
    if (current == term)
        return;
    if (current !== null) {
        current.topNode.classList.remove("domterm-active");
        if (current._sendFocus)
            current.processResponseCharacters("\x1b[O");
    }
    if (term != null) {
        term.topNode.classList.add("domterm-active");
        if (term._sendFocus)
            term.processResponseCharacters("\x1b[I");
        document.title = term.windowTitle;
    }
    if (DomTerm.layoutManager)
        DomTerm.showFocusedPane(term);
    DomTerm.focusedTerm = term;
}

DomTerm.prototype.maybeFocus = function() {
    if (this.hasFocus()) {
        if (this.inputLine && this.inputLine.parentNode)
            this.inputLine.focus();
    }
}


DomTerm.prototype.hasFocus = function() {
    return DomTerm.focusedTerm = this;
}

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
/** We have seen ESC '[' ' '. */
DomTerm.SEEN_ESC_LBRACKET_SPACE_STATE = 6;
/** We have seen ESC ']'. */
DomTerm.SEEN_ESC_RBRACKET_STATE = 7;
/** We have seen ESC ']' numeric-parameter ';'. */
DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE = 8;
/** We have seen ESC '#'. */
DomTerm.SEEN_ESC_SHARP_STATE = 9;
DomTerm.SEEN_ESC_CHARSET0 = 10;
DomTerm.SEEN_ESC_CHARSET1 = 11;
DomTerm.SEEN_ESC_CHARSET2 = 12;
DomTerm.SEEN_ESC_CHARSET3 = 13;
DomTerm.SEEN_ESC_SS2 = 14;
DomTerm.SEEN_ESC_SS3 = 15;
DomTerm.SEEN_SURROGATE_HIGH = 16;

// On older JS implementations use implementation of repeat from:
// http://stackoverflow.com/questions/202605/repeat-string-javascript
// Needed for Chrome 39.
if (!String.prototype.repeat) {
  String.prototype.repeat = function(num)
    { return new Array(num + 1).join(this);}
};

if (!String.prototype.startsWith) {
    // Needed for Chrome 39 - supposedly available in Chrome 41.
    String.prototype.startsWith = function(searchString, position){
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
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
    if (lineStart.nodeName == "SPAN")
        offset += lineStart.offsetHeight;
    return offset;
};

DomTerm.prototype._checkSpacer = function() {
    if (this._vspacer != null) {
        var height = this._vspacer.offsetTop - this._homeOffset();
        this._adjustSpacer(this.availHeight - height);
    }
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

DomTerm.prototype.atTabStop = function(col) {
    if (col >= this._tabDefaultStart)
        if ((col & ~7) == 0)
            return true;
    return this._tabsAdded && this._tabsAdded[col];
}

// Return column number following a tab at initial {@code col}.
// Ths col is the initial column, 0-origin.
// Return the column number (0-origin) after a tab.
// Default implementation assumes tabs every 8 columns.
DomTerm.prototype.nextTabCol = function(col) {
    if (this._tabsAdded == null && this._tabDefaultStart == 0)
        return (col & ~7) + 8;
    var max = this.numColumns - 1;
    for (var i = col; ; i++) {
        if (i >= max || this.atTabStop(i))
            return i;
    }
};

DomTerm.prototype.tabToNextStop = function() {
    var col = this.getCursorColumn();
    if (col == this.numColumns && (this.wraparoundMode & 2) != 0) {
        this.cursorLineStart(1);
        if (this.atTabStop(0))
            return true;
        col = 0;
    }
    var nextStop = this.nextTabCol(col);
    if (nextStop <= col)
        return false;
    this.cursorRight(nextStop-col);
    return true;
}

DomTerm.prototype.tabToPrevStop = function() {
    var col = this.getCursorColumn();
    while (--col > 0 && ! this.atTabStop(col)) { }
    this.columnSet(col);
}

DomTerm.prototype.setTabStop = function(col, set) {
    if (this._tabsAdded == null)
        this._tabsAdded = new Array();
    if (! set && (col & ~7) == 0 && col >= this._tabDefaultStart) {
        for (var i = this._tabDefaultStart; i < col; i = (i & ~7) + 8) {
            this._tabsAdded[i] = true;
        }
        this._tabDefaultStart = col + 1;
    }
    this._tabsAdded[col] = set;
};

DomTerm.prototype.clearAllTabs = function() {
    this._tabsAdded = null;
    this._tabDefaultStart = Number.POSITIVE_INFINITY;
};

DomTerm.prototype.resetTabs = function() {
    this._tabsAdded = null;
    this._tabDefaultStart = 0;
};

DomTerm.prototype._restoreLineTables = function(startNode, startLine) {
    var start = null;
    var dt = this;
    dt._currentPprintGroup = null;

    for (var cur = startNode.firstChild; ;) {
        if (cur == null || cur == startNode)
            break;
        var descend = false;
        if (cur instanceof Text) {
            var data = cur.data;
            var dlen = data.length;
            for (var i = 0; i < dlen; i++) {
                var ch = data.codePointAt(i);
                if (ch == 10) {
                    if (i > 0)
                        cur.parentNode.insertBefore(document.createTextNode(data.substring(0,i)), cur);
                    var line = this._createLineNode("hard", "\n");
                    cur.parentNode.insertBefore(line, cur);
                    if (i+1 == dlen)
                        cur.parentNode.removeChild(cur);
                    else {
                        cur.deleteData(i+1, dlen-i-1);
                    }
                    cur = line; // continue with Element case below
                    break;
                }
                var cwidth = this.wcwidthInContext(ch, cur.parentNode);
                if (cwidth == 2) {
                    var i1 = ch > 0xffff ? i + 2 : i + 1;
                    var wcnode = this._createSpanNode();
                    wcnode.setAttribute("class", "wc-node");
                    wcnode.appendChild(document.createTextNode(String.fromCodePoint(ch)));
                    cur.parentNode.insertBefore(wcnode, cur.nextSibling);
                    if (i == 0)
                        cur.parentNode.removeChild(cur);
                    else
                        cur.deleteData(i, dlen-i);
                    cur = wcnode;
                    if (i1 < dlen) {
                        data = data.substring(i1, dlen);
                        var next = document.createTextNode(data);
                        cur.parentNode.insertBefore(next, cur.nextSibling);
                        cur = next;
                        dlen -= i1;
                        i = -1;
                    } else
                        break;
                }
            }
        }
        if (cur instanceof Element) {
            var tag = cur.tagName;
            if (cur.firstChild)
                descend = true;
            if (tag == "DIV" || tag == "PRE" || tag == "P") {
                var hasData = false;
                var prevWasBlock = false;
                // Check to see if cur has any non-block children:
                for (var ch = cur.firstChild; ch != null; ) {
                    var next = ch.nextSibling;
                    var isBlockNode = false;
                    if (ch instanceof Text) {
                        if (ch.data == "\n" && prevWasBlock) {
                            // The "write" routine adds newlines after these
                            // block elements, for better human-readability.
                            // Remote them here.
                            cur.removeChild(ch);
                            ch = next;
                            continue;
                        }
                        hasData = true;
                    } else if (ch instanceof Element) {
                        isBlockNode = this.isBlockNode(ch);
                        if (! isBlockNode)
                            hasData = true;
                    }
                    ch = next;
                    prevWasBlock = isBlockNode;
                }
                if (hasData) {
                    start = cur;
                    this.lineStarts[startLine] = start;
                    this.lineEnds[startLine] = null;
                    startLine++;
                }
            } else if (tag == "SPAN") {
                var line = cur.getAttribute("line");
                var cls =  cur.getAttribute("class");
                if (line) {
                    descend = false;
                    cur.outerPprintGroup = this._currentPprintGroup;
                    //this.currentCursorLine = startLine;
                    //this.currentCursorColumn = -1;
                    this._setPendingSectionEnds(cur);
                    if (line == "hard" || line == "br") {
                        if (start != null && cur.parentNode == start
                            && cur.nextSibling == null) { // normal case
                            this.lineEnds[startLine-1] = cur;
                            start = null;
                        } else if (startLine > 0) { // shouldn't happen
                            this.lineEnds[startLine-1] = cur;
                            this.lineStarts[startLine] = cur;
                            startLine++;
                            start = cur;
                        }
                    } else {
                        cur._needSectionEndNext = this._needSectionEndList;
                        this._needSectionEndList = cur;
                    }
                } else if (cls == "wc-node") {
                    descend = false;
                } else if (cls == "pprint-group") {
                    this._pushPprintGroup(cur);
                }
            }
        }

        if (descend) {
            cur = cur.firstChild;
        } else {
            for (;;) {
                if (cur.nodeName == "SPAN"
                    && cur.getAttribute("class") == "pprint-group")
                    this._popPprintGroup();
                var next = cur.nextSibling;
                if (next != null) {
                    cur = next;
                    break;
                }
                cur = cur.parentNode;
                if (cur == startNode)
                    break;
            }
        }
    }
};

DomTerm.prototype.saveCursor = function() {
    this._savedCursor = {
        line: this.getCursorLine(),
        column: this.getCursorColumn(),
        fgcolor:  this._currentStyleMap.get("color"),
        bgcolor:  this._currentStyleMap.get("background-color"),
        weight: this._currentStyleMap.get("font-weight"),
        blink: this._currentStyleMap.get("text-blink"),
        underline: this._currentStyleMap.get("text-underline"),
        reverse: this._currentStyleMap.get("reverse"),
        origin: this.originMode,
        wraparound: this.wraparoundMode,
        glevel: this._Glevel,
        charset0: this._Gcharsets[0],
        charset1: this._Gcharsets[1],
        charset2: this._Gcharsets[2],
        charset3: this._Gcharsets[3],
        charMapper: this.charMapper
    };
};
 
DomTerm.prototype.restoreCursor = function() {
    var saved = this._savedCursor;
    if (saved) {
        this.moveToAbs(saved.line+this.homeLine, saved.column, true);
        this._Gcharsets[0] = saved.charset0;
        this._Gcharsets[1] = saved.charset1;
        this._Gcharsets[2] = saved.charset2;
        this._Gcharsets[3] = saved.charset3;
        this._Glevel = saved.glevel;
        this.charMapper = saved.charMapper;
        this._pushStyle("color", saved.fgcolor);
        this._pushStyle("background-color", saved.bgcolor);
        this._pushStyle("font-weight", saved.weight);
        this._pushStyle("text-blink", saved.blink);
        this._pushStyle("text-underline", saved.underline);
        this._pushStyle("reverse", saved.reverse);
        this.originMode = saved.origin;
        this.wraparoundMode = saved.wraparound;
    } else {
        this._Gcharsets[0] = null;
        this._Gcharsets[1] = null;
        this._Gcharsets[2] = null;
        this._Gcharsets[3] = null;
        this.charMapper = null;
        this._Glevel = 0;
    }
}; 

DomTerm.prototype.columnSet = function(column) {
    this.cursorSet(this.getCursorLine(), column, false);
}

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
        rowLimit = this.numRows;
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
    this.moveToAbs(line+this.homeLine, column, true);
};

/** Move to the request position.
 * @param goalAbsLine number of lines (non-negative) to down topNode start
 * @param goalColumn number of columns to move right from the start of the goalLine
 * @param addSpaceAsNeeded if we should add blank lines or spaces if needed to move as requested; otherwise stop at the last existing line, or (just past the) last existing contents of the goalLine. In this case homeLine may be adjusted.
 */
DomTerm.prototype.moveToAbs = function(goalAbsLine, goalColumn, addSpaceAsNeeded) {
    //Only if char-edit? FIXME
    this._removeInputLine();
    var absLine = this.currentAbsLine;
    var column = this.currentCursorColumn;
    if (this.verbosity >= 3)
        this.log("moveTo lineCount:"+this.lineStarts.length+" homeL:"+this.homeLine+" goalLine:"+goalAbsLine+" line:"+absLine+" goalCol:"+goalColumn+" col:"+column);
    // This moves current (and parent) forwards in the DOM tree
    // until we reach the desired (goalAbsLine,goalColumn).
    // The invariant is if current is non-null, then the position is
    // just before current (and parent == current.parentNode);
    // otherwise, the position is after the last child of parent.

    // First we use the current position or the lineStarts table
    // to quickly go to the desired line.
    var current, parent;
    if (goalAbsLine == absLine && column >= 0 && goalColumn >= column) {
        current = this.outputBefore;
        parent = this.outputContainer;
    } else {
        var homeLine = this.homeLine;
        var lineCount = this.lineStarts.length;
        // FIXME this doesn't handle _currentCommandGroup != null
        // and goalAbsLine < lineCount
        while (goalAbsLine >= lineCount) {
            if (! addSpaceAsNeeded)
                return;
            var preNode = this._createPreNode();
            // preNode.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
            if (lineCount == this.homeLine)
                parent = this.initial;
            else {
                var lastParent = this.lineEnds[lineCount-1];
                if (lastParent == null)
                   lastParent = this.lineStarts[lineCount-1]; 
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
            this._setPendingSectionEnds(this.lineEnds[lineCount-1]);
            this.lineStarts[lineCount] = preNode;
            this.lineEnds[lineCount] = next;
            var nextLine = lineCount;
            lineCount++;
            if (lineCount > homeLine + this.numRows) {
                homeLine = lineCount - this.numRows;
                this.homeLine = homeLine;
                this._adjustSpacer(0);
            }
        }
        var lineStart = this.lineStarts[goalAbsLine];
        //this.log("- lineStart:"+lineStart+" homeL:"+homeLine+" goalL:"+goalAbsLine+" lines.len:"+this.lineStarts.length);
        if (goalAbsLine > 0 && lineStart == this.lineEnds[goalAbsLine-1]) {
            current = lineStart.nextSibling;
            parent = lineStart.parentNode;
        } else {
            parent = lineStart;
            if (lineStart) {
                current = lineStart.firstChild;
            } else
                this.log("- bad lineStart");
        }
        absLine = goalAbsLine;
        column = 0;
    }
    if (column != goalColumn) {
        var lineEnd = this.lineEnds[absLine];
        // At this point we're at the correct line; scan to the desired column.
        mainLoop:
        while (column < goalColumn) {
            if (parent==null||(current!=null&&parent!=current.parentNode))
                this.log("BAD PARENT "+parent+" OF "+current);
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
                    if (absLine >= goalAbsLine && column >= goalColumn) {
                        tnode.splitText(i);
                        break;
                    }
                    var ch = text.codePointAt(i);
                    if (ch > 0xffff) i++;
                    if (ch == 10 || ch == 13 || ch == 12) { // One of "\n\r\f"
                        // Paranoia - we should never have raw "\n\r\f" in text,
                        // but it can happen if HTML is inserted and not cleaned up.
                        if (absLine == goalAbsLine) {
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
                            absLine++;
                            column = 0;
                            if (ch == 13 /*'\r'*/
                                && i+1<tlen
                                && text.charCodeAt(i+1) == 10 /*'\n'*/)
                                i++;
                        }
                    }
                    else {
                        column += this.wcwidthInContext(ch, tnode.parentNode);
                    }
                }
            }

            //if (parent==null||(current!=null&&parent!=current.parentNode))            error("BAD PARENT "+WTDebug.pnode(parent)+" OF "+WTDebug.pnode(current));
            // If there is a child, go the the first child next.
            var ch;
            if (current != null) {
                var valueAttr = ! (current instanceof Element) ? null
                    : current.getAttribute("value");
                if (current instanceof Element
                    && this.isObjectElement(current))
                    column += 1;
                else if (valueAttr
                         && current.getAttribute("std")=="prompt") {
                    var w = this.strWidthInContext(valueAttr, current);
                    column += w;
                    if (column > goalColumn) {
                        column -= w;
                        var t = document.createTextNode(valueAttr);
                        current.insertBefore(t, current.firstChild);
                        current.removeAttribute("value");
                        parent = current;
                        current = t;
                        continue;
                    }
                } else {
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
                    absLine++;
            }

            ch = current;
            for (;;) {
                //this.log(" move 2 parent:%s body:%s line:%s goal:%s curl:%s current:%s", parent, this.topNode, absLine, goalAbsLine, this.currentAbsLine, current);
                if (parent == this.initial || parent == this.topNode) {
                    current = null;
                    var fill = goalColumn - column;
                    //console.log(" move 2 fill:%s pareent:%s", fill, parent);
                    if (fill > 0) {
                        this.appendText(parent, DomTerm.makeSpaces(fill))
                    }
                    absLine = goalAbsLine;
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
    /*
    if (moveInput) {
        parent.insertBefore(this.inputLine, current);
        current = this.inputLine;
    }
    */
    var oldBefore = this.outputBefore;
    this.outputContainer = parent;
    this.outputBefore = current;
    if (oldBefore != current && oldBefore instanceof Text
        && oldBefore.previousSibling instanceof Text)
        this._normalize1(oldBefore.previousSibling);
    //this._removeInputLine();
    this.currentAbsLine = absLine;
    this.currentCursorColumn = column;
};

DomTerm.prototype._followingText = function(cur) {
    for (;;) {
        if (cur instanceof Text)
            return cur;
        else if (cur instanceof Element) {
            var line = cur.getAttribute("line");
            if (line != null)
                return null;
            if (cur.getAttribute("line") != null)
                return cur;
            if (cur.firstChild)
                cur = cur.firstChild;
            else {
                for (;;) {
                    if (cur == null)
                        return null;
                    if (cur.nextSibling) {
                        cur = cur.nextSibling;
                        break;
                    }
                    cur = cur.parentNode;
                }
            }
        }
        else
            return null;
    }
};

DomTerm.prototype._removeCaret = function() {
    var inputLine = this.inputLine;
    if (inputLine && inputLine.getAttribute("caret")) {
        var child = inputLine.firstChild;
        inputLine.removeAttribute("caret");
        if (child instanceof Text) {
            var text = this._followingText(inputLine.followingSibling);
            if (text instanceof Text) {
                text.insertData(0, child.data);
                inputLine.removeChild(child);
            } else {
                inputLine.removeChild(child);
                inputLine.parentNode.insertBefore(child, inputLine.nextSibling);
            }
        }
    }
}

DomTerm.prototype._removeInputLine = function() {
    if (this.inputFollowsOutput && this.inputLine) {
        var inputParent = this.inputLine.parentNode;
        if (inputParent != null) {
            this._removeCaret();
            if (this.outputBefore==this.inputLine)
                this.outputBefore = this.outputBefore.nextSibling;
            inputParent.removeChild(this.inputLine);
        }
    }
};

DomTerm.prototype.setCaretStyle = function(style) {
    this.caretStyle = style;
};

DomTerm.prototype.useStyledCaret = function() {
    return this.caretStyle < 5;
};

DomTerm.prototype.isLineEditing = function() {
    return this._lineEditingMode + this._clientWantsEditing > 0
        || this._composing > 0;
}

DomTerm.prototype._restoreInputLine = function() {
    if (this.inputFollowsOutput && this.outputBefore != this.inputLine) {
        this.outputContainer.insertBefore(this.inputLine, this.outputBefore);
        this.outputBefore = this.inputLine;
        if (this.useStyledCaret() && ! this.isLineEditing()) {
            if (! (this.inputLine.firstChild instanceof Text)
                || this.inputLine.firstChild.data.length == 0) {
                var text = this._followingText(this.outputBefore);
                if (text instanceof Text && text.data.length > 0) {
                    var tdata = text.data;
                    var sz = 1;
                    if (tdata.length >= 2) {
                        var ch0 = tdata.charCodeAt(0);
                        var ch1 = tdata.charCodeAt(1);
                        if (ch0 >= 0xD800 && ch0 <= 0xDBFF
                            && ch1 >= 0xDC00 && ch1 <= DFFF)
                            sz = 2;
                    }
                    var ch = tdata.substring(0, sz);
                    this.inputLine.appendChild(document.createTextNode(ch));
                    if (sz == text.length)
                        text.parentNode.removeChild(text);
                    else
                        text.deleteData(0, sz);
                    this.inputLine.removeAttribute("value");
                }
                else
                    this.inputLine.setAttribute("value", " ");
            }
            var cstyle;
            switch (this.caretStyle) {
            default:
                cstyle = "blinking-block"; break;
            case 2:
                cstyle = "block"; break;
            case 3:
                cstyle = "blinking-underline"; break;
            case 4:
                cstyle = "underline"; break;
            }
            this.inputLine.setAttribute("caret", cstyle);
        }
        this.maybeFocus();
    }
};

/** Move cursor to beginning of line, relative.
 * @param deltaLines line number to move to, relative to current line.
 */
DomTerm.prototype.cursorLineStart = function(deltaLines) {
    this.moveToAbs(this.getAbsCursorLine()+deltaLines, 0, true);
};

DomTerm.prototype.cursorDown = function(count) {
    var cur = this.getCursorLine();
    var next = cur+count;
    if (count > 0) {
        var end = cur > this._regionBottom ? this.numRows : this._regionBottom;
        if (next >= end)
            next = end - 1;
    } else if (count < 0) {
        var min = cur < this._regionTop ? 0 : this._regionTop;
        if (next < min)
            next = min;
    }
    this.moveToAbs(next+this.homeLine, this.getCursorColumn(), true);
};

DomTerm.prototype.cursorNewLine = function(autoNewline) {
    if (autoNewline) {
        if (this.insertMode) {
            this.insertRawOutput("\n"); // FIXME
            if (this.currentAbsLine >= 0)
                this.currentAbsLine++;
            this.currentCursorColumn = 0;
        } else {
            this.cursorLineStart(1);
        }
    }
    // Only scroll if this._regionBottom explicitly set to a value >= 0.
    else if ((this._regionTop > 0
              || this._regionBottom < this.numRows
              || this.usingAlternateScreenBuffer)
             && this.getCursorLine() == this._regionBottom-1)
        this.scrollForward(1);
    else
        this.moveToAbs(this.getAbsCursorLine()+1, this.getCursorColumn(), true);
};

DomTerm.prototype.cursorRight = function(count) {
    // FIXME optimize same way cursorLeft is.
    this.columnSet(this.getCursorColumn()+count);
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
            if (ch >= 0xDC00 && ch <= 0xDFFF && len > tcount) {
                var ch0 =  tstr.charCodeAt(len-tcount-1);
                if (ch0 >= 0xD800 && ch0 <= 0xDBFF) {
                    ch = (ch0 - 0xD800) * 0x400 + ch - 0xDC00 + 0x10000;
                    tcount++;
                }
            }
            var chcols = this.wcwidthInContext(ch, prev.parentNode);
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
        this.columnSet(goal);
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
DomTerm.prototype.mapColorName = function(name) {
    return "var(--dt-"+name.replace(/-/, "")+")";
}
DomTerm.prototype._pushFgStdColor = function(name) {
    this._pushStyle("color", this.mapColorName(name));
}
DomTerm.prototype._pushBgStdColor = function(name) {
    this._pushStyle("background-color", this.mapColorName(name));
}

DomTerm.prototype._getStdMode = function() {
    for (var stdElement = this.outputContainer;
         stdElement instanceof Element;
         stdElement = stdElement.parentNode) {
        if (stdElement.getAttribute("std"))
            return stdElement;
    }
    return null;
};

DomTerm.prototype._pushStdMode = function(styleValue) {
    var stdElement = this._getStdMode();
    if (stdElement == null ? styleValue == null
        : stdElement.getAttribute("std") == styleValue)
        return;
    if (stdElement != null) {
        var cur = this.outputBefore;
        var parent = this.outputContainer;
        while (parent != stdElement.parentNode) {
            if (cur != null)
                this._splitNode(parent, cur);
            var nextp = parent.parentNode;
            cur = parent.nextSibling;
            parent = nextp;
        }
        this.outputBefore = stdElement.nextSibling;
        this.outputContainer = stdElement.parentNode;
    }
    if (styleValue != null) {
        stdElement = this._createSpanNode();
        stdElement.setAttribute("std", styleValue);
        this._pushIntoElement(stdElement);
    }
};

DomTerm.prototype._clearStyle = function() {
    this._currentStyleMap.clear();
    this._currentStyleSpan = null;
};

DomTerm.prototype._splitNode = function(node, splitPoint) {
    var newNode = document.createElement(node.nodeName);
    this._copyAttributes(node, newNode);
    this._moveNodes(splitPoint, newNode, null);
    node.parentNode.insertBefore(newNode, node.nextSibling);
    return newNode;
};

DomTerm.prototype._popStyleSpan = function() {
    var parentSpan = this.outputContainer;
    if (this.outputBefore) {
        // split into new child
        this._splitNode(parentSpan, this.outputBefore);
    }
    this.outputContainer = parentSpan.parentNode;
    this.outputBefore = parentSpan.nextSibling;
    this._currentStyleSpan = null;
};

DomTerm._styleAttributes = ["style", "color", "background-color",
                            "font-weight", "text-decoration"];
DomTerm._styleSpansMatch = function(newSpan, oldSpan) {
    for (var i = DomTerm._styleAttributes.length; --i >= 0; ) {
        var attrName = DomTerm._styleAttributes[i];
        if (newSpan.getAttribute(attrName) !== oldSpan.getAttribute(attrName))
            return false;
    }
    return true;
};
/** A saved session file has "domterm-noscript" in the "class" attribute.
 * When viewing the session file, JavaScript removes the "domterm-noscript".
 * A CSS selector "domterm-noscript" is used for fall-back styling for
 * the non-JavaScript case. */
DomTerm._savedSessionClassNoScript = "domterm domterm-saved-session domterm-noscript";
DomTerm._savedSessionClass = "domterm domterm-saved-session";

DomTerm.prototype.isSavedSession = function() {
    var cl = this.topNode == null ? null : this.topNode.getAttribute("class");
    return cl != null && cl.indexOf("domterm-saved-session") >= 0;
}

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
    var needBackground = false;
    if (! inStyleSpan && this._currentStyleMap.get("background-color") == null) {
        var block = this._getOuterBlock(parentSpan);
        if (block && this._getBackgroundColor(block) != null) {
            needBackground = true;
        }
    }
    if (this._currentStyleMap.size == 0 && ! inStyleSpan && ! needBackground) {
        this._currentStyleSpan = parentSpan;
        return;
    }
    this._removeInputLine();
    if (this.inputLine == this.outputBefore) {
        this.outputBefore = this.outputBefore.nextSibling;
        parentSpan.removeChild(this.inputLine);
    }
    if (inStyleSpan) {
        this._popStyleSpan();
    }
    if (this._currentStyleMap.size != 0 || needBackground) {
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
            case "font-weight":
                styleSpan.setAttribute(key, value);
                break;
            }
        }
        if (reverse) {
            if (bgcolor || fgcolor) {
                var tmp = bgcolor ? bgcolor : "var(--dt-bgcolor)";
                bgcolor = fgcolor ? fgcolor : "var(--dt-fgcolor)";
                fgcolor = tmp;
            } else {
                styleSpan.setAttribute("reverse", "yes");
            }
        }
        if (fgcolor) {
            var fgstyle = "color: "+fgcolor;
            styleAttr = styleAttr ? styleAttr+";"+fgstyle : fgstyle;
        }
        if (needBackground && ! bgcolor && ! reverse)
            bgcolor = "var(--dt-bgcolor)";
        if (bgcolor) {
            var bgstyle = "background-color: "+bgcolor;
            styleAttr = styleAttr ? styleAttr+";"+bgstyle : bgstyle;
        }
        if (styleAttr)
            styleSpan.setAttribute("style", styleAttr);
        if (decoration)
            styleSpan.setAttribute("text-decoration", decoration);

        var previous = this.outputBefore ? this.outputBefore.previousSibling
            : this.outputContainer.lastChild;
        if (previous instanceof Element
            && previous.getAttribute("class") == "term-style"
            && DomTerm._styleSpansMatch(styleSpan, previous)) {
            this.outputBefore = null;
            styleSpan = previous;
        } else {
            if (this.outputBefore instanceof Element
                && this.outputBefore.getAttribute("class") == "term-style"
                && DomTerm._styleSpansMatch(styleSpan, this.outputBefore)) {
                styleSpan = this.outputBefore;
            } else {
                this.outputContainer.insertBefore(styleSpan, this.outputBefore);
            }
            this.outputBefore = styleSpan.firstChild;
        }
        this._currentStyleSpan = styleSpan;
        this.outputContainer = styleSpan;
    }
};

DomTerm.prototype.insertLinesIgnoreScroll = function(count, line) {
    var absLine = this.homeLine+line;
    var oldLength = this.lineStarts.length;
    var column = this.getCursorColumn();
    var oldStart, oldParent;
    var startLine;
    if (absLine >= oldLength) {
        oldParent = this.initial;
        oldStart = null;
        count += absLine - oldLength;
        startLine = oldLength;
    } else {
        if (absLine > 0)
            this._clearWrap(absLine-1);
        oldStart = this.lineStarts[absLine];
        startLine = absLine;
        oldParent = oldStart.parentNode;
        this.lineStarts.length += count;
        this.lineEnds.length += count;
        for (var i = oldLength-1; i >= startLine; i--) {
            this.lineStarts[i+count] = this.lineStarts[i];
            this.lineEnds[i+count] = this.lineEnds[i];
        }
    }
    this._addBlankLines(count, startLine, oldParent, oldStart);
    this.resetCursorCache();
    this.moveToAbs(absLine, column, true);
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
    var absLine = this.getAbsCursorLine();
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
    } else {
        this._clearWrap(absLine+count-1);
        end = this.lineStarts[absLine+count];
    }
    var cur = this.outputBefore;
    var parent = this.outputContainer;
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
    this.moveToAbs(regionBottom+this.homeLine-count, 0, true);
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
    this.moveToAbs(line, 0, true);
    var scrollBottom = this._regionBottom;
    var regionHeight = scrollBottom +this.homeLine - line;
    if (count > regionHeight)
        count = regionHeight;
    this.deleteLinesIgnoreScroll(count, false);
    this.insertLinesIgnoreScroll(count, scrollBottom - count);
    this.resetCursorCache();
    this.moveToAbs(line, 0, true);
    this._removeInputLine();
};

 DomTerm.prototype.deleteLines = function(count) {
     this._deleteLinesAt(count, this.getAbsCursorLine());
};

DomTerm.prototype.scrollForward = function(count) {
    var line = this.getCursorLine();
    this.moveToAbs(this._regionTop+this.homeLine, 0, true);
    this._deleteLinesAt(count, this._regionTop+this.homeLine);
    this.moveToAbs(line+this.homeLine, 0, true);
};

DomTerm.prototype.scrollReverse = function(count) {
    var line = this.getAbsCursorLine();
    this._insertLinesAt(count, this._regionTop, this._regionBottom);
    this.moveToAbs(line, 0, true);
};

DomTerm.prototype._currentStyleBackground = function() {
    return this._currentStyleMap.get("background-color");
}

DomTerm.prototype._getBackgroundColor = function(element) {
    var st = element.getAttribute("style");
    if (st) {
        var n = "background-color:";
        var nlen = n.length;
        var i = st.indexOf(n);
        if (i >= 0) {
            var nend = st.indexOf(";", i);
            if (nend < 0)
                nend = st.length;
            return st.substring(i+nlen, nend).trim();
        }
    }
    return null;
}
DomTerm.prototype._setBackgroundColor = function(element, bgcolor) {
    var st = element.getAttribute("style");
    if (st) {
        if (! bgcolor)
            element.removeAttribute("style");
        else {
            var n = "background-color:";
            var i = st.indexOf(n);
            if (i >= 0) {
                var nend = st.indexOf(";", i);
                if (nend < 0)
                    st = st.substring(0, n);
                else
                    st = st.substring(0, n) + st.substring(nend+1);
            }
            element.setAttribute("style", "background-color: "+bgcolor+";"+st);
        }
    } else if (bgcolor) {
        element.setAttribute("style", "background-color: "+bgcolor);
    }
}

DomTerm.prototype._createPreNode = function() {
    //return document.createElement("pre");
    // Prefer <div> over <pre> because Firefox adds extra lines when doing a Copy
    // spanning multiple <pre> nodes.
    var n = document.createElement("div");
    var bg = this._currentStyleBackground();
    this._setBackgroundColor(n, bg);
    n.setAttribute("class", "domterm-pre");
    return n;
};

DomTerm.prototype._createSpanNode = function() {
    return document.createElement("span");
};

DomTerm.prototype.makeId = function(local) {
    return this.name + "__" + local;
};

DomTerm.prototype._createLineNode = function(kind, text="") {
    var el = document.createElement("span");
    // the following is for debugging
    el.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
    el.setAttribute("line", kind);
    el.outerPprintGroup = this._currentPprintGroup;
    if (text)
        el.appendChild(document.createTextNode(text));
    return el;
};
 
DomTerm.prototype.setAlternateScreenBuffer = function(val) {
    if (this.usingAlternateScreenBuffer != val) {
        this._setRegionTB(0, -1);
        if (val) {
            var line = this.getCursorLine();
            var col = this.getCursorColumn();
            // FIXME should scroll top of new buffer to top of window.
            var nextLine = this.lineEnds.length;
            var bufNode = this._createBuffer(this._altBufferName);
            this.topNode.insertBefore(bufNode, this._vspacer);
            bufNode.saveHomeLine = this.homeLine;
            bufNode.saveInitial = this.initial;
            bufNode.saveLastLine = nextLine;
            bufNode.savedCursor = this._savedCursor;
            this._savedCursor = null;
            var newLineNode = bufNode.firstChild;
            this.homeLine = nextLine;
            this.outputContainer = newLineNode;
            this.outputBefore = newLineNode.firstChild;
            this._removeInputLine();
            this.initial = bufNode;
            this.resetCursorCache();
            this.moveToAbs(line+this.homeLine, col, true);
            if (this._pauseLimit >= 0)
                this._pauseLimit += bufNode.offsetTop;
        } else {
            var bufNode = this.initial;
            this.initial = bufNode.saveInitial;
            this.lineStarts.length = bufNode.saveLastLine;
            this.lineEnds.length = bufNode.saveLastLine;
            this.homeLine = bufNode.saveHomeLine;
            this._savedCursor = bufNode.savedCursor;
            this.moveToAbs(this.homeLine, 0, false);
            bufNode.parentNode.removeChild(bufNode);
            if (this._pauseLimit >= 0)
                this._pauseLimit = this.initial.offsetTop + this.availHeight;
        }
        this.usingAlternateScreenBuffer = val;
    }
};


/** True if an img/object/a element.
 * These are treated as black boxes similar to a single
 * 1-column character.
 * @param node an Element we want to check
 * @return true iff the {@code node} should be treated as a
 *  block-box embedded object.
 *  For now returns true for {@code img}, {@code a}, and {@code object}.
 *  (We should perhaps treat {@code a} as text.)
 */
DomTerm.prototype.isObjectElement = function(node) {
    var tag = node.tagName;
    return "OBJECT" == tag ||
        "IMG" == tag || "SVG" == tag || "IFRAME" == tag;
};

DomTerm.prototype.isBlockNode = function(node) {
    var tag = node.tagName;
    return "P" == tag || "DIV" == tag || "PRE" == tag;
};

DomTerm.prototype._getOuterBlock = function(node) {
    for (var n = node; n; n = n.parentNode) {
        if (this.isBlockNode(n))
            return n;
    }
    return null;
}

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

DomTerm.prototype._initializeDomTerm = function(topNode) {
    this.topNode = topNode;
    topNode.terminal = this;
    var name = topNode.name;
    if (name)
        this.setSessionName(name);

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

    var wrapDummy = this._createLineNode("soft");
    wrapDummy.setAttribute("breaking", "yes");
    helperNode.appendChild(wrapDummy);
    this._wrapDummy = wrapDummy;
    DomTerm.setFocus(this);
    var dt = this;
    this.attachResizeSensor();
    this.measureWindow();

    this.topNode.addEventListener("mousedown", this._mouseEventHandler, true);
    /*
    function docMouseDown(event) {
        if (! dt._isAnAncestor(event.target, dt.topNode)
            && DomTerm.focusedTerm === dt) {
            DomTerm.setFocus(null);
        }
    }
    document.addEventListener("mousedown", docMouseDown, false);
    */
};

DomTerm.prototype.resizeHandler = function() {
    var dt = this;
    // FIXME we want the resize-sensor to be a child of helperNode
    if (dt.verbosity > 0)
        dt.log("ResizeSensor called "+dt.name); 
    var oldWidth = dt.availWidth;
    dt.measureWindow();
    dt._displaySizeInfoWithTimeout();

    if (dt.availWidth != oldWidth) {
        dt._breakAllLines();
        dt.resetCursorCache();
    }
    var minHome = dt.lineStarts.length - dt.numRows;
    dt.homeLine = minHome < 0 ? 0 : minHome;
    dt._checkSpacer();
    dt._scrollIfNeeded();
}

DomTerm.prototype.attachResizeSensor = function() {
    var dt = this;
    dt._resizeSensor = new ResizeSensor(dt.topNode, function() { dt.resizeHandler(); });
}

DomTerm.prototype.detachResizeSensor = function() {
    if (this._resizeSensor)
        this._resizeSensor.detach();
    this._resizeSensor = null;
};

DomTerm.prototype._displayInputModeWithTimeout = function(text) {
    this._displayInfoWithTimeout(text);
};

DomTerm.prototype._displayInfoWithTimeout = function(text) {
    var dt = this;
    dt._displayInfoMessage(text);
    dt._displaySizePendingTimeouts++;
    function clear() {
        var widget = dt._displayInfoWidget;
        if (widget == null) {
            dt._displaySizePendingTimeouts = 0;
        } else if (--dt._displaySizePendingTimeouts == 0) {
            dt._updatePagerInfo();
        }
    };
    setTimeout(clear, 2000);
};

DomTerm.prototype._clearInfoMessage = function() {
    var widget = this._displayInfoWidget;
    if (widget != null) {
        widget.parentNode.removeChild(widget);
        this._displayInfoWidget = null;
        this._displaySizePendingTimeouts = 0;
    }
}

DomTerm.prototype._displaySizeInfoWithTimeout = function() {
    // Might be nicer to keep displaying the size-info while
    // button-1 is pressed. However, that seems a bit tricky.
    var text = ""+this.numColumns+" x "+this.numRows
        +" ("+this.availWidth+"px x "+this.availHeight+"px)";
    var ratio = window.devicePixelRatio;
    if (ratio)
        text += " "+(ratio*100.0).toFixed(0)+"%";
    this._displayInfoWithTimeout(text);
};

/** Display contents in _displayInfoWidget.
 * The contents is updated with innerHTML, so "<>&" must be escaped. */
DomTerm.prototype._displayInfoMessage = function(contents) {
    var div = this._displayInfoWidget;
    if (div == null) {
        div = document.createElement("div");
        div.setAttribute("class", "domterm-show-info");
        this.topNode.insertBefore(div, this.topNode.firstChild);
        this._displayInfoWidget = div;
    }
    div.innerHTML = contents;
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

    this._initializeDomTerm(topNode);

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

    var dt = this;
    document.addEventListener("keydown",
                              function(e) { dt.keyDownHandler(e) }, true);
    document.addEventListener("keypress",
                              function(e) { dt.keyPressHandler(e) }, true);
    document.addEventListener("input",
                              function(e) { dt.inputHandler(e); },
                              true);
    topNode.addEventListener("focus", function(e) { console.log("focus handler"); DomTerm.setFocus(dt); }, false);
    function compositionStart(ev) {
        dt._composing = 1;
        dt._removeCaret();
        if (dt.verbosity >= 1) dt.log("compositionStart");
    }
    function compositionEnd(ev) {
        if (dt.verbosity >= 1) dt.log("compositionEnd");
        dt._composing = 0;
        if (! dt.isLineEditing())
            dt._sendInputContents();
    }
    topNode.addEventListener("compositionstart", compositionStart, true);
    topNode.addEventListener("compositionend", compositionEnd, true);
    topNode.addEventListener("paste",
                             function(e) {
                                 dt.pasteText(e.clipboardData.getData("text"));
                                 e.preventDefault(); },
                              true);
    window.addEventListener("unload",
                            function(event) { dt.historySave(); });
    topNode.addEventListener("click",
                             function(e) {
                                 var target = e.target;
                                 /* FUTURE POPUP
                                 if (dt._isAnAncestor(target, dt._popupMenu)) {
                                     dt.handleContextMenu(dt._popupMenu, e);
                                 } else
                                 */
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
};

DomTerm.prototype._createBuffer = function(bufName) {
    var bufNode = document.createElement("div");
    bufNode.setAttribute("id", bufName);
    bufNode.setAttribute("class", "interaction");
    this._addBlankLines(1, this.lineEnds.length, bufNode, null);
    return bufNode;
};

/* If browsers allows, should re-size actual window instead. FIXME */
DomTerm.prototype.forceWidthInColumns = function(numCols) {
    if (numCols <= 0) {
        this.topNode.style.width = "";
    } else {
        // FIXME add sanity check?
        var ruler = this._rulerNode;
        var charWidth = ruler.offsetWidth/26.0;
        // Add half a column for rounding issues - see comment in measureWindow
        var width = (numCols + 0.5) * charWidth + this.rightMarginWidth
            + (this.topNode.offsetWidth - this.topNode.clientWidth);
        var topNode = this.topNode;
        topNode.style.width = width+"px";
        window.addEventListener("resize", this._unforceWidthInColumns, true);
        this.measureWindow();
        this.eraseDisplay(2);
        this._setRegionLR(0, -1);
        this.moveToAbs(this.homeLine, 0, false);
    }
};

DomTerm.prototype.measureWindow = function()  {
    var ruler = this._rulerNode;
    var rbox = ruler.getBoundingClientRect();
    this.charWidth = rbox.width/26.0;
    this.charHeight = rbox.height;
    this.rightMarginWidth = this._wrapDummy.offsetWidth;
    if (this.verbosity >= 2)
        this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.topNode+" clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.topNode.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+this.charWidth+" chH:"+this.charHeight+" ht:"+availHeight);
    var availHeight = this.topNode.clientHeight;
    var availWidth = this.topNode.clientWidth - this.rightMarginWidth;
    var numRows = Math.floor(availHeight / this.charHeight);
    var numColumns = Math.floor(availWidth / this.charWidth);
    // KLUDGE Add some tolerance for rounding errors.
    // This is occasionally needed, at least on Chrome.
    // FIXME - Better would be to use separate line-breaking measurements
    // when in traditional terminal mode (monospace and no html emitted):
    // In that case we should line-break based on character counts rather
    // than measured offsets.
    availWidth = (numColumns + 0.5) * this.charWidth;
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
        this.log("ruler ow:"+ruler.offsetWidth+" cl-h:"+ruler.clientHeight+" cl-w:"+ruler.clientWidth+" = "+(ruler.offsetWidth/26.0)+"/char h:"+ruler.offsetHeight+" numCols:"+this.numColumns+" numRows:"+this.numRows);
    this.topNode.setAttribute("style",
                              "--wchar-width: "+(this.charWidth * 2)+"px");
};

/* FUTURE POPUP
DomTerm.prototype.handleContextMenu = function(menu, event) {
    //this.log("handleContextMenu");
    var id = event.target.getAttribute("id");
    if (id == "domterm-popup-copy") {
        this.doCopy();
    } else if (id == "domterm-popup-paste") {
        this.doPaste();
    }
}

DomTerm.prototype.createContextMenu = function() {
    var menu = this._popupMenu;
    if (menu != null)
        return;
    // Copy and Paste run into security issues.
    // Other "menu-style" actions should be possible.
    var copyDiv = document.createElement("div");
    copyDiv.appendChild(document.createTextNode("Copy"));
    copyDiv.setAttribute("class", "domterm-popup-action");
    copyDiv.setAttribute("id", "domterm-popup-copy");
    var pasteDiv = document.createElement("div");
    pasteDiv.appendChild(document.createTextNode("Paste"));
    pasteDiv.setAttribute("class", "domterm-popup-action");
    pasteDiv.setAttribute("id", "domterm-popup-paste");
    menu = document.createElement("div");
    menu.setAttribute("class", "domterm-main-popup");
    menu.appendChild(copyDiv);
    menu.appendChild(pasteDiv);
    this.topNode.insertBefore(menu, this.topNode.firstChild);
    this._popupMenu = menu;
};
*/

DomTerm.prototype._mouseHandler = function(ev) {
    if (this.verbosity >= 2)
        this.log("mouse event "+ev.type+": "+ev+" t:"+this.topNode.id+" pageX:"+ev.pageX+" Y:"+ev.pageY);
    if (ev.type == "mousedown") {
        DomTerm.setFocus(this);
    }
    /* FUTURE POPUP
    if (ev.ctrlKey && ev.button == 2) {
        this.createContextMenu();
        ev.preventDefault();
        return;
    }
    */
    if (ev.shiftKey || ev.target == this.topNode)
        return;
    if (this._mouseMode == 0 && (! ev.altKey || ev.button != 0))
        return;

    var saveCol = this.currentCursorColumn;
    var saveLine = this.currentAbsLine;
    var saveBefore = this.outputBefore;
    var saveContainer = this.outputContainer;
    this.outputContainer = ev.target;
    this.outputBefore = this.outputContainer.firstChild;
    this.resetCursorCache();
    var row = this.getCursorLine();
    var col = this.getCursorColumn();
    this.currentCursorColumn = saveCol;
    this.currentAbsLine = saveLine;
    this.outputBefore = saveBefore;
    this.outputContainer = saveContainer;
    var xdelta = ev.pageX - ev.target.offsetLeft;
    var ydelta = ev.pageY + this.topNode.scrollTop - ev.target.offsetTop;
    for (var top = this.topNode; top != null; top = top.offsetParent) {
        xdelta -= top.offsetLeft;
        ydelta -= top.offsetTop;
    }
    col += Math.floor(xdelta / this.charWidth);
    row += Math.floor(ydelta / this.charHeight);
    var mod = (ev.shiftKey?4:0) | (ev.metaKey?8:0) | (ev.ctrlKey?16:0);

    if (this._mouseMode == 0 && ev.altKey) {
        var curVLine = this.getAbsCursorLine();
        var goalVLine = row+this.homeLine;
        var curLine = curVLine;
        var goalLine = curVLine;
        while (this.isSpanNode(this.lineStarts[goalLine]))
            goalLine--;
        while (this.isSpanNode(this.lineStarts[curLine]))
            curLine--;
        if (curLine != goalLine)
            return; // FIXME should allow as long as same "command-group"
        var goalCol = col + (goalVLine - goalLine) * this.numColumns;
        var curCol = this.getCursorColumn()
            + (curVLine - curLine) * this.numColumns;
        var delta = goalCol - curCol;
        var arrow;
        var n;
        if (delta >= 0) {
            arrow = this.specialKeySequence("", "C", null); // char-right
            n = delta;
        } else {
            n = -delta;
            arrow = this.specialKeySequence("", "D", null); // char-left
        }
        if (n > 0)
            this.processInputCharacters(arrow.repeat(n));
        return;
    }

    var final = "M";
    var button = Math.min(ev.which - 1, 2) | mod;
    switch (ev.type) {
    case 'mousedown':
        if (this._mouseMode >= 1002)
            this.topNode.addEventListener("mousemove",
                                          this._mouseEventHandler);
        break;
    case 'mouseup':
        if (this._mouseMode >= 1002)
            this.topNode.removeEventListener("mousemove",
                                             this._mouseEventHandler);
        switch (this._mouseCoordEncoding) {
        case 1006: case 1015:
            final = "m";
            break;
        default:
            button = 3;
        }
        break;
    case 'mousemove':
        if (row == this.mouseRow && col == this.mouseCol)
            return;
        button += 32;
        break;
    case 'wheel':
        button = (ev.deltaY ? (ev.deltaY <= 0 ? 64 : 65)
                  : (ev.wheelDeltaY > 0 ? 64 : 65));
        break;
    default:
        return;
    }

    if (this.verbosity >= 2)
        this.log("mouse event "+ev+" type:"+ev.type+" cl:"+ev.clientX+"/"+ev.clientY+" p:"+ev.pageX+"/"+ev.pageY+" row:"+row+" col:"+col+" button:"+button+" mode:"+this._mouseMode+" ext_coord:"+this._mouseCoordEncoding);

    if (button < 0 || col < 0 || col >= this.numColumns
        || row < 0 || row >= this.numRows)
        return;

    function encodeButton(button, dt) {
        var value = button;
        switch (dt._mouseCoordEncoding) {
        case 1005: // FIXME
        default:
            return String.fromCharCode(value+32);
        case 1015:
            value += 32;
            // fall through
        case 1006: // SGR
            return ""+value;
        }
    }
    function encodeCoordinate(val, prependSeparator, dt) {
        // Note val is 0-origin, to match xterm's EmitMousePosition
        switch (dt._mouseCoordEncoding) {
        case 1005:
            // FIXME UTF8 encoding
        default:
            return String.fromCharCode(val == 255-32 ? 0 : val + 33);
        case 1006: case 1015:
            return (prependSeparator?";":"")+(val+1);
        }
    }
    var result = "\x1b[";
    switch (this._mouseCoordEncoding) {
    case 1006: result += "<"; break;
    case 1015: break;
    default:
        result += "M";
        final = "";
        break;
    }
    this.mouseRow = row;
    this.mouseCol = col;
    result += encodeButton(button, this);
    result += encodeCoordinate(col, true, this);
    result += encodeCoordinate(row, true, this);
    result += final;
    ev.preventDefault();
    this.processResponseCharacters(result);
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

        // For all following-siblings of the start-node,
        // plus all following-siblings of the start-node's parent
        // (assuming that parent is a PRE or P or DIV),
        // flip the domterm-hidden attribute.
        // The start node is either the "hider" node itself,
        // or if the "hider" is nested in a "prompt", the latter.
        var start = target;
        if (start.parentNode.getAttribute("std") == "prompt")
            start = start.parentNode;
        var node = start;
        for (;;) {
            var next = node.nextSibling;
            if (next == null) {
                var parent = node.parentNode;
                if (parent == start.parentNode && this.isBlockNode(parent))
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

DomTerm.prototype.freshLine = function() {
    var lineno = this.getAbsCursorLine();
    var line = this.lineStarts[lineno];
    var end = this.lineEnds[lineno];
    if (line.firstChild == this.outputBefore)
        return;
    this.cursorLineStart(1);
};

DomTerm.prototype.reportEvent = function(name, data) {
    // 0x92 is "Private Use 2".
    // FIXME should encode data
    if (this.verbosity >= 2)
        this.log("reportEvent "+this.name+": "+name+" "+data);
    this.processInputCharacters("\x92"+name+" "+data+"\n");
};

DomTerm.prototype.reportKeyEvent = function(key, str) {
    this.reportEvent("KEY", ""+key+" "+JSON.stringify(str));
};

DomTerm.prototype.setWindowSize = function(numRows, numColumns,
                                           availHeight, availWidth) {
    if (! numRows)
        console.log("BAD numRows");
    this.reportEvent("WS", numRows+" "+numColumns+" "+availHeight+" "+availWidth);
};

DomTerm.prototype.addInputLine = function() {
    if (this.inputLine)
        this.inputLine.removeAttribute("caret");
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

/*
DomTerm.prototype._forEachElementIn = function(node, func) {
    for (var cur = node.firstChild; ;) {
        if (cur == null || cur == node)
            break;
        if (cur instanceof Element)
            func(cur);
        if (cur instanceof Element && cur.firstChild) {
            cur = cur.firstChild;
        } else if (cur.nextSibling)
            cur = cur.nextSibling;
        else {
            for (;;) {
                cur = cur.parentNode;
                if (cur == node)
                    break;
                if (cur.nextSibling) {
                    cur = cur.nextSibling;
                    break;
                }
            }
        }
    }
};
*/

DomTerm.prototype.resetCursorCache = function() {
    this.currentCursorColumn = -1;
    this.currentAbsLine = -1;
};

DomTerm.prototype.updateCursorCache = function() {
    var goal = this.outputBefore;
    var goalParent = this.outputContainer;
    var line = this.currentAbsLine;
    if (line < 0) {
        var n = this._getOuterBlock(goal ? goal : goalParent);
        var len = this.lineStarts.length;
        var home = this.homeLine;
        // homeLine may be invalid after _breakAllLines
        if (home >= len)
            home = 0;
        if (n) {
            // search after homeLine first, then before it
            for (var i = 0; i < len; i++) {
                var ln = i + home;
                if (ln >= len)
                    ln -= len;
                if (this.lineStarts[ln] == n) {
                    line = ln;
                    break;
                }
            }
        }
        if (line < 0)
            line = home;
    }
    var parent = this.lineStarts[line];
    var cur = parent.firstChild;
    if (line > 0 && parent == this.lineEnds[line-1]) {
        cur = parent.nextSibling;
        parent = parent.parentNode;
    }
    var col = 0;
    while (cur != goal || (goal == null && parent != goalParent)) {
        if (cur == null) {
            cur = parent.nextSibling;
            parent = parent.parentNode;
        } else if (cur instanceof Element) {
            var tag = cur.nodeName;
            var lineAttr;
            if (tag == "BR"
                || (tag == "SPAN"
                    && (lineAttr = cur.getAttribute("line")) != null)) {
                if (cur == goalParent)
                    break;
                var breaking = cur.getAttribute("breaking");
                if (breaking || lineAttr == "hard"
                    || lineAttr == "soft" || lineAttr == "br")
                    line++;
                col = 0; // FIXME? maybe
                cur = cur.nextSibling;
                continue;
            } else if (this.isObjectElement(cur)) {
                if (cur == goalParent)
                    break;
                col++;
                cur = cur.nextSibling;
                continue;
            } else if (tag == "P" || tag == "PRE" || tag == "DIV") {
                // FIXME handle line specially
            } else if (cur.getAttribute("std")=="prompt") {
                var valueAttr = cur.getAttribute("value");
                if (valueAttr)
                    col += this.strWidthInContext(valueAttr, cur);
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
                    var ch = text.codePointAt(i);
                    if (ch > 0xffff) i++;
                    if (ch == 10 || ch == 13 || ch == 12) {
                        line++;
                        col = 0;
                        if (ch == 13 /*'\r'*/ && i+1<tlen
                            && text.charCodeAt(i+1) == 10 /*'\n'*/)
                            i++;
                    }
                    else
                        col += this.wcwidthInContext(ch, cur.parentNode);
                }
            }
            cur = cur.nextSibling;
        }
    }
    this.currentAbsLine = line;
    this.currentCursorColumn = col;
    return;
};

/** Get line of current cursor position.
 * This is 0-origin (i.e. 0 is the top line), relative to cursorHome. */
DomTerm.prototype.getCursorLine = function() {
    if (this.currentAbsLine < 0)
        this.updateCursorCache();
    return this.currentAbsLine - this.homeLine
};

DomTerm.prototype.getAbsCursorLine = function() {
    if (this.currentAbsLine < 0)
        this.updateCursorCache();
    return this.currentAbsLine;
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
        this.currentAbsLine = line+this.homeLine;
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
        if (! (next instanceof Text) || next == this.outputBefore)
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
    if (this.currentAbsLine >= 0)
        this.currentAbsLine++;
};

DomTerm.prototype.eraseDisplay = function(param) {
    var saveLine = this.getAbsCursorLine();
    var saveCol = this.getCursorColumn();
    if (param == 0 && saveLine == this.homeLine && saveCol == 0)
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
        for (var line = this.homeLine;  line < saveLine;  line++) {
            this.moveToAbs(line, 0, true);
            this.eraseLineRight();
        }
        if (saveCol != 0) {
            this.moveToAbs(saveLine, 0, true);
            this.eraseCharactersRight(saveCol+1);
        }
        break;
    case 3: // Delete saved scrolled-off lines - xterm extension
        this._pauseLimit = this.availHeight;
        var saveHome = this.homeLine;
        this.homeLine =
            this.usingAlternateScreenBuffer ? this.initial.saveLastLine
            : 0;
        var removed = saveHome - this.homeLine;
        if (removed > 0) {
            this.moveToAbs(this.homeLine, 0, false);
            this.deleteLinesIgnoreScroll(removed, false);
            this.resetCursorCache();
            saveLine -= removed;
        }
        break;
    default:
        var startLine = param == 0 ? saveLine : this.homeLine;
        if (this.usingAlternateScreenBuffer && startLine == this.homeLine
            && param == 2 && this.initial.saveHomeLine > 0) {
            // FIXME maybe this is a bad idea
            var saveHome = this.homeLine;
            this.homeLine = this.initial.saveLastLine;
            var homeAdjust = saveHome - this.homeLine;
            this.resetCursorCache();
            saveLine -= homeAdjust;
            startLine -= homeAdjust;
        }
        var count = this.lineStarts.length-startLine;
        if (param == 0) {
            this.eraseLineRight();
            count--;
            while (--count >= 0) {
                startLine++;
                this.moveToAbs(startLine, 0, false);
                this.eraseLineRight();
            }
        }
        else if (count > 0) {
            this.moveToAbs(startLine, 0, false);
            this.deleteLinesIgnoreScroll(count, false);
            this.resetCursorCache();
        }
        break;
    }
    if (param == 0 || param == 2) {
        var bg = this._currentStyleBackground();
        if (bg != null) {
             this.moveToAbs(this.numRows-1+this.homeLine, 0, true);
        }
        if (this._vspacer != null)
            this._setBackgroundColor(this._vspacer, bg);
    }
    this.moveToAbs(saveLine, saveCol, true);
};

/** set line-wrap indicator from absLine to absLine+1.
 */
DomTerm.prototype._forceWrap = function(absLine) {
    var end = this.lineEnds[absLine];
    var nextLine = this.lineStarts[absLine+1];
    if (nextLine != end) {
        // nextLine must be block-content
        this._moveNodes(nextLine.firstChild, end.parentNode, end.nextSibling);
        nextLine.parentNode.removeChild(nextLine);
        this.lineStarts[absLine+1] = end;
    }
    if (end.getAttribute("line") != "soft") {
        end.setAttribute("line", "soft");
        end.setAttribute("breaking", "yes");
        while (end.firstChild != null)
            end.removeChild(end.firstChild);
    }
};

/** clear line-wrap indicator from absLine to absLine+1.
 *  The default for absLine is getAbsCursorLine().
 */
DomTerm.prototype._clearWrap = function(absLine=this.getAbsCursorLine()) {
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
                this._splitNode(parent, lineEnd.nextSibling);
            }
            parent.parentNode.insertBefore(lineEnd, parent.nextSibling);
            if (lineEnd == this.outputBefore)
                this.outputContainer = parent.parentNode;
            parent = parent.parentNode;
            pname = parent.nodeName;
        }
        if (pname == "PRE" || pname == "P" || pname == "DIV") {
            var newBlock = this._splitNode(parent, lineEnd.nextSibling);
            this.lineStarts[absLine+1] = newBlock;
        }
        // otherwise we have a non-standard line
        // Regardless, do:
        lineEnd.setAttribute("line", "hard");
        lineEnd.removeAttribute("breaking");
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
        if (attr.specified && attr.name != "id")
            newElement.setAttribute(attr.name, attr.value);
    }
};

DomTerm.prototype._moveNodes = function(firstChild, newParent, newBefore) {
    var oldParent = firstChild ? firstChild.parentNode : null;
    for (var child = firstChild; child != null; ) {
        var next = child.nextSibling;
        child.parentNode.removeChild(child);
        newParent.insertBefore(child, newBefore);
        child = next;
    }
    if (oldParent == this.outputContainer
        &&  (this.outputBefore == null
             || this.outputBefore.parentNode != oldParent))
        this.outputContainer = newParent;
};

/** Erase or delete characters in the current line.
 * If 'doDelete' is true delete characters (and move the rest of the line left);
 * if 'doDelete' is false erase characters (replace them with space).
 * The 'count' is the number of characters to erase/delete;
 * a count of -1 means erase to the end of the line.
 */
DomTerm.prototype.eraseCharactersRight = function(count, doDelete=false) {
    if (count > 0 && ! doDelete) {
        // handle BCH FIXME
        var avail = this.numColumns - this.getCursorColumn();
        if (count > avail)
            count = avail;
        this.insertSimpleOutput(DomTerm.makeSpaces(count), 0, count, count);
        this.cursorLeft(count == avail ? count - 1 : count, false);
        return;
    }
    this.deleteCharactersRight(count);
};
DomTerm.prototype.deleteCharactersRight = function(count) {
    var todo = count >= 0 ? count : 999999999;
    // Note that the traversal logic is similar to move.
    var current = this.outputBefore;
    var parent = this.outputContainer;
    var lineEnd = this.lineEnds[this.getAbsCursorLine()];
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
            var valueAttr = current.getAttribute("value");
            if (valueAttr && current.getAttribute("std")=="prompt") {
                current.insertBefore(document.createTextNode(valueAttr),
                                     current.firstChild);
                current.removeAttribute("value");
            }
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
                    var ch = text.codePointAt(i);
                    if (ch > 0xffff) i++;
                    // Optimization - don't need to calculate getCurrentColumn.
                    if (ch >= 32/*' '*/ && ch < 127) {
                        todo--;
                    }
                    else if (ch == 13/*'\r'*/ || ch == 10/*'\n'*/ || ch == 12/*'\f'*/) {
                        // shouldn't normally happen - we get to lineEnd first
                        todo = 0;
                        break;
                    }
                    else {
                        todo -= this.wcwidthInContext(ch, current.parentNode);
                    }
                }
            }

            var next = current.nextSibling;
            if (i < length)
                tnode.deleteData(0, i);
            else  {
                parent.removeChild(current);
                while (parent.firstChild == null
                       && parent != this.initial
                       && parent != this._currentStyleSpan) {
                    current = parent;
                    parent = parent.parentNode;
                    if (current == this.outputContainer) {
                        this.outputContainer = parent;
                        previous = current.previousSibling;
                    }
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
    return todo <= 0;
};


DomTerm.prototype.eraseLineRight = function() {
    this.deleteCharactersRight(-1);
    this._clearWrap();
    this._eraseLineEnd();
}

DomTerm.prototype._eraseLineEnd = function() {
    var line = this.lineStarts[this.getAbsCursorLine()];
    var bg = this._currentStyleBackground();
    var oldbg = this._getBackgroundColor(line);
    if (bg != oldbg) {
        this._setBackgroundColor(line, bg);
        var col = this.getCursorColumn();
        if (col > 0) {
            // FIXME avoid this if also doing eraseLineRight
            var end = this.lineEnds[this.getAbsCursorLine()];
            if (oldbg == null)
                oldbg = "var(-dt-bgcolor)";
            for (var ch = line.firstChild;
                 ch != null && ch != end; ) {
                var next = ch.nextSibling;
                if (ch instanceof Text) {
                    var span = this._createSpanNode();
                    line.removeChild(ch);
                    span.appendChild(ch);
                    line.insertBefore(span, next);
                    ch = span;
                }
                if (ch.nodeName == "SPAN"
                    && this._getBackgroundColor(ch) == null)
                    this._setBackgroundColor(ch, oldbg);
                ch = next;
            }
        }
    }
};

DomTerm.prototype.eraseLineLeft = function() {
    var column = this.getCursorColumn();
    this.cursorLineStart(0);
    this.eraseCharactersRight(column+1);
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

DomTerm.prototype.get_DEC_private_mode = function(param) {
    switch (param) {
    case 1: return this.applicationCursorKeysMode;
    case 3: return this.numColumns == 132;
    case 5: return this.topNode.getAttribute("reverse-video") != null;
    case 6: return this.originMode;
    case 7: return (this.wraparoundMode & 2) != 0;
    case 45: return (this.wraparoundMode & 1) != 0;
    case 47: // fall though
    case 1047: return this.usingAlternateScreenBuffer;
    case 1048: return this._savedCursor != null;
    case 1049: return this.usingAlternateScreenBuffer;
    case 2004: return this.bracketedPasteMode;
    case 9: case 1000: case 1001: case 1002: case 1003:
        return this._mouseMode == param;
    case 1004:
        return this._sendMouse;
    case 1005: case 1006: case 1015:
        return this._mouseCoordEncoding == param;
    }
}
/** Do DECSET or related option.
 */
DomTerm.prototype.set_DEC_private_mode = function(param, value) {
    switch (param) {
    case 1:
        // Application Cursor Keys (DECCKM).
        this.applicationCursorKeysMode = value;
        break;
    case 3:
        this.forceWidthInColumns(value ? 132 : 80);
        break;
    case 5: // Reverse Video (DECSCNM)
        if (value)
            this.topNode.setAttribute("reverse-video", "yes");
        else
            this.topNode.removeAttribute("reverse-video");
        break;
    case 6:
        this.originMode = value;
        break;
    case 7:
        if (value)
            this.wraparoundMode |= 2;
        else
            this.wraparoundMode &= ~2;
        break;
    case 45:
        if (value)
            this.wraparoundMode |= 1;
        else
            this.wraparoundMode &= ~1;
        break;
    case 9: case 1000: case 1001: case 1002: case 1003:
        var handler = this._mouseEventHandler;
        if (value) {
            this.topNode.addEventListener("mouseup", handler);
            this.topNode.addEventListener("wheel", handler);
        } else {
            this.topNode.removeEventListener("mouseup", handler);
            this.topNode.removeEventListener("wheel", handler);
        }
        this._mouseMode = value ? param : 0;
        break;
    case 1004: // Send FocusIn/FocusOut events.
        this._sendFocus = true;
        break;
    case 1005: case 1006: case 1015:
        this._mouseCoordEncoding = value ? param : 0;
        break;
    case 47:
    case 1047:
        this.setAlternateScreenBuffer(value);
        break;
    case 1048:
        if (value)
            this.saveCursor();
        else
            this.restoreCursor();
        break;
    case 1049:
        if (value) {
            this.saveCursor();
            this.setAlternateScreenBuffer(true);
        } else {
            this.setAlternateScreenBuffer(false);
            this.restoreCursor();
        }
        break;
    case 2004:
        this.bracketedPasteMode = value;
        break;
    }
};

DomTerm.prototype.handleControlSequence = function(last) {
    var param;
    var oldState = this.controlSequenceState;
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    if (last != 109 /*'m'*/)
        this._breakDeferredLines();
    switch (last) {
    case 64 /*'@'*/:
        var saveInsertMode = this.insertMode;
        this.insertMode = true;
        param = this.getParameter(0, 1);
        this.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param, param);
        this.cursorLeft(param, false);
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
    case 69 /*'E'*/: // Cursor Next Line (CNL)
        this._breakDeferredLines();
        this.cursorDown(this.getParameter(0, 1));
        this.cursorLineStart(0);
        break;
    case 70 /*'F'*/: // Cursor Preceding Line (CPL)
        this._breakDeferredLines();
        this.cursorDown(- this.getParameter(0, 1));
        this.cursorLineStart(0);
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
    case 73 /*'I'*/: // CHT Cursor Forward Tabulation
        for (var n = this.getParameter(0, 1);
             --n >= 0 && this.tabToNextStop(); ) {
        }
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
        this.columnSet(this._regionLeft);
        this.insertLines(this.getParameter(0, 1));
        break;
    case 77 /*'M'*/: // Delete lines
        this.columnSet(this._regionLeft);
        this.deleteLines(this.getParameter(0, 1));
        break;
    case 80 /*'P'*/: // Delete characters
        this.deleteCharactersRight(this.getParameter(0, 1));
        this._clearWrap();
        this._eraseLineEnd();
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
        /* FIXME Initiate mouse tracking.
        if (curNumParameter >= 5) { ... }
        */
        this.scrollReverse(param);
        break;
    case 88 /*'X'*/: // Erase character (ECH)
        param = this.getParameter(0, 1);
        this.eraseCharactersRight(param);
        break;
    case 90 /*'Z'*/: // CBT Cursor Backward Tabulation
        for (var n = this.getParameter(0, 1); --n >= 0; )
            this.tabToPrevStop();
        break;
    case 97 /*'a'*/: // HPR
        var line = this.getCursorLine();
        var column = this.getCursorColumn();
        this.cursorSet(this.originMode ? line - this._regionTop : line,
                       this.originMode ? column - this._regionLeft : column
                       + this.getParameter(0, 1),
                       this.originMode);
        break;
    case 98 /*'b'*/: // Repeat the preceding graphic character (REP)
        param = this.getParameter(0, 1);
        var prev = this.outputBefore == null ? this.outputContainer.lastChild
            : this.outputBefore.previousSibling;
        if (prev instanceof Text) {
            var d = prev.data;
            var dl = d.length;
            if (dl > 0) {
                var c1 = d.charCodeAt(dl-1);
                var c0 = dl > 1 && c1 >= 0xDC00 && c1 <= 0xDFFF
                    ? d.charCodeAt(dl-2) : -1;
                var w = c0 >= 0xD800 && c0 <= 0xDBFF ? 2 : 1;
                var str = d.substring(dl-w).repeat(param);
                this.insertSimpleOutput(str, 0, str.length, -1);
            }
        }
        break;
    case 99 /*'c'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE) {
            // Send Device Attributes (Secondary DA).
            // Translate version string X.Y.Z to integer XYYYZZ.
            var version = DomTerm.versionString.split(".");
            var vnum = 0;
            var v = version[0] ? Number(version[0]) : Number.NaN;
            if (! isNaN(v)) {
                vnum += 100000 * v;
                v = version[1] ? Number(version[1]) : Number.NaN;
                if (! isNaN(v)) {
                    vnum += 100 * v;
                    v = version[2] ? Number(version[2]) : Number.NaN;
                    if (! isNaN(v)) {
                        vnum += v;
                    }
                }
            }
            // 990 is "DM" in roman numerals.
            this.processResponseCharacters("\x1B[>990;"+vnum+";0c");
        } else if (oldState == DomTerm.SEEN_ESC_LBRACKET_STATE) {
            // Send Device Attributes (Primary DA)
            this.processResponseCharacters("\x1B[?62;1;22c");
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
    case 103 /*'g'*/: // TBC Tab Clear
        param = this.getParameter(0, 0);
        if (param <= 0)
            this.setTabStop(this.getCursorColumn(), false);
        else if (param == 3)
            this.clearAllTabs();
        break;
    case 104 /*'h'*/:
        param = this.getParameter(0, 0);
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // DEC Private Mode Set (DECSET)
            this.set_DEC_private_mode(param, true);
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
            this.set_DEC_private_mode(param, false);
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
                case 30: this._pushFgStdColor("black"); break;
                case 31: this._pushFgStdColor("red"); break;
                case 32: this._pushFgStdColor("green"); break;
                case 33: this._pushFgStdColor("yellow"); break;
                case 34: this._pushFgStdColor("blue"); break;
                case 35: this._pushFgStdColor("magenta"); break;
                case 36: this._pushFgStdColor("cyan"); break;
                case 37: this._pushFgStdColor("light-gray"); break;
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
                case 40: this._pushBgStdColor("black"); break;
                case 41: this._pushBgStdColor("red"); break;
                case 42: this._pushBgStdColor("green"); break;
                case 43: this._pushBgStdColor("yellow"); break;
                case 44: this._pushBgStdColor("blue"); break;
                case 45: this._pushBgStdColor("magenta"); break;
                case 46: this._pushBgStdColor("cyan"); break;
                case 47: this._pushBgStdColor("light-gray"); break;
                case 49: this._pushStyle("background-color", null/*defaultBackgroundColor*/); break
                case 90: this._pushFgStdColor("dark-gray"); break;
                case 91: this._pushFgStdColor("light-red"); break;
                case 92: this._pushFgStdColor("light-green"); break;
                case 93: this._pushFgStdColor("light-yellow"); break;
                case 94: this._pushFgStdColor("light-blue"); break;
                case 95: this._pushFgStdColor("light-magenta"); break;
                case 96: this._pushFgStdColor("light-cyan"); break;
                case 97: this._pushFgStdColor("white"); break;
                case 100: this._pushBgStdColor("dark-gray"); break;
                case 101: this._pushBgStdColor("light-red"); break;
                case 102: this._pushBgStdColor("light-green"); break;
                case 103: this._pushBgStdColor("light-yellow"); break;
                case 104: this._pushBgStdColor("light-blue"); break;
                case 105: this._pushBgStdColor("light-magenta"); break;
                case 106: this._pushBgStdColor("light-cyan"); break;
                case 107: this._pushBgStdColor("white"); break;
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
        case 15: // request printer status
            if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                this.processResponseCharacters("\x1B[?13n"); // No printer
            }
            break;
        case 25: // request UDK status
            if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                this.processResponseCharacters("\x1B[?20n");
            }
            break;
        case 26:
            this.processResponseCharacters("\x1B[?27;1;0;0n");
            break;
        }
        break;
    case 112 /*'p'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE) {
            // Soft terminal reset (DECSTR)
            this.resetTerminal(false, false);
        }
        break;
    case 113 /*'q'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_SPACE_STATE) {
            // Set cursor style (DECSCUSR, VT520).
            this.setCaretStyle(this.getParameter(0, 0));
        }
        break;
    case 114 /*'r'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // Restore DEC Private Mode Values.
            if (this.saved_DEC_private_mode_flags == null)
                break;
            var numParameters = this.parameters.length;
            for (var i = 0; i < numParameters; i++) {
                param = this.getParameter(i, -1);
                var saved = this.saved_DEC_private_mode_flags[param];
                this.set_DEC_private_mode(param, saved);
            }
        }
        // DECSTBM - set scrolling region
        var top = this.getParameter(0, 1);
        var bot = this.getParameter(1, -1);
        if (bot > this.numRows || bot <= 0)
            bot = this.numRows;
        if (bot > top) {
            this._setRegionTB(top - 1, bot);
            this.cursorSet(0, 0, this.originMode);
        }
        break;
    case 115 /*'s'*/:
        if (oldState == DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE) {
            // Save DEC Private Mode Values.
            if (this.saved_DEC_private_mode_flags == null)
                this.saved_DEC_private_mode_flags = new Array();
            var numParameters = this.parameters.length;
            for (var i = 0; i < numParameters; i++) {
                param = this.getParameter(i, -1);
                this.saved_DEC_private_mode_flags[param]
                    = this.get_DEC_private_mode(param);
            }
            break;
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
            this._pushStdMode(null);
            break;
        case 12:
            this._pushStdMode("error");
            break;
        case 18: // End non-selectable prompt
            var container = this.outputContainer;
            if (container.nodeName == "SPAN"
                && container.getAttribute("std")=="prompt") {
                var content = container.textContent;
                if (content != "") {
                    while (container.firstChild) {
                        container.removeChild(container.firstChild);
                    }
                    this.outputContainer.setAttribute("value", content);
                }
            }
            // ... fall through ...
        case 13: // End (selectable) prompt
            this._pushStdMode(null);
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
            this._pushStdMode("prompt");
            if (param == 24)
                this.inputLine.setAttribute("continuation", "true");
            else
                this.inputLine.removeAttribute("continuation");
            break;
        case 15:
            this._pushStdMode("input");
            this._adjustStyle();
            break;
        case 16:
            var hider = this._createSpanNode();
            hider.setAttribute("std", "hider");
            this._pushIntoElement(hider);
            this._currentCommandHideable = true;
            break;
        case 17:
            this.outputContainer.addEventListener("click",
                                                  this._showHideEventHandler,
                                                  true);
            if (this.isSpanNode(this.outputContainer) // sanity check
                && this.outputContainer.getAttribute("std") == "hider")
                this.popFromElement();
            break;
        case 19:
            this.freshLine();
            this.startCommandGroup();
            break;
        case 20:
            this.freshLine();
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
    case 120 /*'x'*/: // Request Terminal Parameters (DECREQTPARM)
        this.processResponseCharacters("\x1B["+(this.getParameter(0, 0)+2)+";1;1;128;128;1;0x");
        break;
    //case 122 /*'z'*/: Nethack tiledata
    //    http://nethackwiki.com/wiki/Vt_tiledata
    // Partially implemented by hterm
    default:
        if (last < 32) {
            // vttest depends on this behavior
            this.insertString(String.fromCharCode(last));
            if (last != 24 && last != 26 && last != 27)
                this.controlSequenceState = oldState;
        } else { // FIXME
        }
    }
};

DomTerm.prototype.handleBell = function() {
    // Do nothing, for now.
};

DomTerm.prototype.handleLink = function(event, href) {
    event.preventDefault();
    this.reportEvent("ALINK", JSON.stringify(href));
};

// Set the "session name" which is the "name" attribute of the toplevel div.
// It can be used in stylesheets as well as the window title.
DomTerm.prototype.setSessionName = function(title) {
    this.topNode.setAttribute("name", title);
    this.reportEvent("SESSION-NAME", JSON.stringify(title));
    if (DomTerm.setLayoutTitle)
        DomTerm.setLayoutTitle(this, title, this.windowName);
}

DomTerm.prototype.sessionName = function() {
    var sname = this.topNode.getAttribute("name");
    return sname ? sname : this.name;
};

DomTerm.prototype.setWindowTitle = function(title, option) {
    switch (option) {
    case 0:
        this.windowName = title;
        this.iconName = title;
        break;
    case 1:
        this.iconName = title;
        break;
    case 2:        
        this.windowName = title;
        break;
    case 30:
        this.setSessionName(title);
        break;
    }
    if (DomTerm.setLayoutTitle)
        DomTerm.setLayoutTitle(this, this.sessionName(), this.windowName);
    this.updateWindowTitle(this.formatWindowTitle());
};

DomTerm.prototype.formatWindowTitle = function() {
    var str = this.windowName ? this.windowName
        : this.iconName ? this.iconName
        : "";
    var sessionName = this.sessionName();
    //if (! sessionName)
    //    sessionName = this.name;
    if (sessionName) {
        if (str)
            str += " ";
        str += "[" + sessionName + "]";
    }
    return str;
}

DomTerm.prototype.updateWindowTitle = function(str) {
    this.windowTitle = str;
    if (this.hasFocus())
        document.title = str;
}

DomTerm.prototype.resetTerminal = function(full, saved) {
    // Corresponds to xterm's ReallyReset function
    if (saved)
        this.eraseDisplay(saved);
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    this._setRegionTB(0, -1);
    this._setRegionLR(0, -1);
    this.originMode = false;
    this.bracketedPasteMode = false;
    this.wraparoundMode = 2;
    this.forceWidthInColumns(-1);
    this._mouseMode = 0;
    this._mouseCoordEncoding = 0;
    this._Glevel = 0;
    this._currentCommandGroup = null;
    this._currentCommandOutput = null;
    this._currentCommandHideable = false;
    this._currentPprintGroup = null;
    this._needSectionEndFence = null;
    this.resetTabs();

    // FIXME a bunch more
};

DomTerm.prototype._selectGcharset = function(g, whenShifted/*ignored*/) {
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
    if (text.length > 0) {
        if (this.outputBefore != null)
            this.outputBefore.insertAdjacentHTML("beforebegin", text);
        else
            this.outputContainer.insertAdjacentHTML("beforeend", text);
    }
};

// Bit 0 (value 1): Allow in inserted HTML
// Bit 1 (value 2): Some attributes may need scrubbing
// Bit 2 (value 4): "Phrasing [inline] content"
// Bit 3 (value 8): Allow in SVG
// Bit 4 (value 16): Void (empty) HTML element
DomTerm.prototype.elementInfo = function(tag, parents=null) {
    var v = DomTerm.HTMLinfo.hasOwnProperty(tag) ? DomTerm.HTMLinfo[tag] : 0;

    if ((v & 8) == 8 && parents) { // If allow in SVG, check parents for svg
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

// See elementInfo comment for bit values.
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
    "area": 0x14,
    "b": 5,
    "base": 0x10,//metadata
    "basefont": 0x10, //obsolete
    "br": 0x15,
    "circle": 12,
    "cite": 5,
    "clipPath": 12,
    "code": 5,
    "col": 0x11,
    "color-profile": 12,
    "command": 0x15, // obsolete
    "cursor": 12,
    "dfn": 5,
    "defs": 12,
    "desc": 12,
    "div": 1,
    "ellipse": 12,
    "em": 5,
    "embed": 0x14,
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
    "frame": 0x10,
    "g": 12,
    "glyph": 12,
    "glyphRef": 12,
    "hkern": 12,
    "hr": 0x11,
    "i": 5,
    //"iframe": 1, // ??? maybe
    "image": 12, // FIXME
    "img": 0x17, // need to check "src" for "javascript:"
    "input": 0x15,
    //"isindex": 0x10, //metadata
    "keygen": 0x15,
    "line": 12,
    "linearGradient": 12,
    "link": 0x10, //metadata
    "mark": 5,
    "marker": 12,
    "mask": 12,
    "meta": 0x10, //metadata
    "metadata": 12,
    "missing-glyph": 12,
    "mpath": 12,
    "p": 1,
    //"para": 0x10, //???
    "param": 0x10,
    "path": 12,
    "pattern": 12,
    "polygon": 12,
    "polyline": 12,
    "pre": 1,
    "q": 5,
    "radialGradient": 12,
    "rect": 12,
    "samp": 5,
    //"script": 12, // ?
    "script": 0,
    "set": 12,
    "small": 5,
    "source": 0x10,
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
    //"track": 0x10,
    "tref": 12,
    "tspan": 12,
    "u": 5,
    "use": 12,
    "view": 12,
    "var": 5,
    "vkern": 12,
    "wbr": 0x15,
    
    // Phrasing content:
    //area (if it is a descendant of a map element) audio bdi bdo br button canvas data datalist del embed iframe input ins kbd keygen label map math meter noscript object output progress q ruby s select svg template textarea time u  video wbr text
};

DomTerm.prototype._scrubAndInsertHTML = function(str) {
    var len = str.length;
    var start = 0;
    var ok = 0;
    var i = 0;
    var startLine = this.getAbsCursorLine();
    var activeTags = new Array();
    loop:
    for (;;) {
        if (i == len) {
            ok = i;
            break;
        }
        var ch = str.charCodeAt(i++);
        switch (ch) {
        case 10:
        case 12:
        case 13:
            if (activeTags.length == 0) {
                this._unsafeInsertHTML(str.substring(start, i-1)); 
                this.cursorLineStart(1);
                if (ch == 13 && i < len && str.charCodeAt(i) == 10)
                    i++;
                start = i;
                ok = i;
            }
            break;
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
            if (ch == 33 && i + 1 < len
                && str.charCodeAt(i) == 45 && str.charCodeAt(i+1) == 45) {
                // Saw comment start "<!--". Look for "-->".
                i += 2;
                for (; ; i++) {
                    if (i + 2 >= len)
                        break loop; // invalid
                    if (str.charCodeAt(i) == 45
                        && str.charCodeAt(i+1) == 45
                        && str.charCodeAt(i+2) == 62) {
                        i += 3;
                        ok = i;
                        break;
                    }
                }
                break;
            }
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
                    // maybe TODO: allow unbalanced "</foo>" to pop from foo.
                    break loop;
                } else if (activeTags.pop() == tag) {
                    ok = i;
                    if (activeTags.length == 0
                        && (this.elementInfo(tag, activeTags) & 4) == 0) {
                        this.freshLine();
                        var line = this.getAbsCursorLine();
                        var lstart = this.lineStarts[line];
                        var lend = this.lineEnds[line];
                        var emptyLine = (lstart == this.outputContainer
                                         && lstart.firstChild == lend
                                         && this.outputBefore == lend);
                        this._unsafeInsertHTML(str.substring(start, ok));
                        var created = lstart.firstChild;
                        if (emptyLine && created.nextSibling == lend) {
                            lstart.removeChild(created);
                            if (lend != null)
                                lstart.removeChild(lend);
                            lstart.parentNode.insertBefore(created, lstart);
                            lstart.parentNode.removeChild(lstart);
                            this.lineStarts[line] = created;
                            this.lineEnds[line] = null;
                            this.resetCursorCache();
                            this.outputContainer = created;
                            this.outputBefore = null;
                            this.freshLine();
                        }
                        start = i;
                        //insert immediately, as new line
                    }
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
                    while (ch <= 32 && i < len)
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
                    for (ch = 32; ch <= 32 && i < len; )
                        ch = str.charCodeAt(i++);
                    var quote = i == len ? -1 : ch;
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
    else {
        if (ok > start) {
            this._unsafeInsertHTML(str.substring(start, ok)); 
            this.resetCursorCache();
        }
        this._updateLinebreaksStart(startLine);
    }
    //this.cursorColumn = -1;
};


DomTerm.prototype.handleOperatingSystemControl = function(code, text) {
    if (this.verbosity >= 2)
        this.log("handleOperatingSystemControl "+code+" '"+text+"'");
    if (! (code >= 110 && code <= 118))
        this._breakDeferredLines();
    switch (code) {
    case 0:
    case 1:
    case 2:
    case 30:
        this.setWindowTitle(text, code);
        break;
    case 71:
        // handle tcsetattr
        var canon = text.indexOf(" icanon ") >= 0;
        var echo = text.indexOf(" echo ") >= 0;
        this.autoLazyCheckInferior = false;
        this._clientWantsEditing = canon ? 1 : 0;
        break;
    case 72:
        this._scrubAndInsertHTML(text);
        break;
    case 73:
    case 74:
        var sp = text.indexOf(' ');
        var key = parseInt(text.substring(0, sp), 10);
        var kstr = JSON.parse(text.substring(sp+1));
        if (this.verbosity >= 2)
            this.log("OSC KEY k:"+key+" kstr:"+this.toQuoted(kstr));
        this._clientWantsEditing = 1;
        if (code == 73 && this.inputLine) {
            this.inputLine.setAttribute("domterm-noecho", "true");
            this._usingDoLineEdit = true;
        }
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
    case 96:
        var args = JSON.parse("["+text+"]");
        var r = this.loadStyleSheet(args[0], args[1]);
        if (code == 95)
            this.processResponseCharacters("\x9D" + r + "\n");
        this.measureWindow();
        break;
    case 102:
        this.reportEvent("GET-HTML", JSON.stringify(this.getAsHTML(true)));
        break;
    case 110: // start prettyprinting-group
        if (this._currentStyleSpan == this.outputContainer
            && this.outputContainer.getAttribute("class") == "term-style")
            this._popStyleSpan();
        //this._adjustStyle();
        var ppgroup = this._createSpanNode();
        ppgroup.setAttribute("class", "pprint-group");
        text = text.trim();
        if (text) {
            var prefix = String(JSON.parse(text));
            var span = this._createSpanNode();
            span.setAttribute("class", "pprint-prefix");
            var tnode = document.createTextNode(prefix);
            span.appendChild(tnode);
            this.insertNode(span);
        }
        this._pushIntoElement(ppgroup);
        this._pushPprintGroup(ppgroup);
        break;
    case 111: // end prettyprinting-group
        if (this._currentPprintGroup != null) {
            if (this._isAnAncestor(this.outputContainer, this._currentPprintGroup)) {
                var saveBefore = this.outputBefore;
                var saveContainer = this.outputContainer;
                for (;;) {
                    var isGroup = this.outputContainer == this._currentPprintGroup;
                    this.popFromElement();
                    if (isGroup)
                        break;
                }
            }
            this._popPprintGroup();
        }
        break;
    case 112: // adjust indentation relative to current position
    case 113: // adjust indentation relative to block start
    case 114: // add indentation string
        try {
            var span = this._createSpanNode();
            span.setAttribute("class", "pprint-indent");
            if (code == 114)
                span.setAttribute("indentation", JSON.parse(text));
            else {
                span.setAttribute(code == 112 ? "delta" : "block-delta", text);
                var num = Number(text); // check formatting
            }
            this.insertNode(span);
        } catch (e) {
            this.log("bad indentation specifier '"+text+"' - caught "+e);
        }
        break;

    case 115: // fill-style linebreak for pretty-printing
    case 116: // linear-style linebreak for pretty-printing
    case 117: // miser-style linebreak for pretty-printing
              // Currently treated as "fill"
    case 118: // required linebreak for pretty-printing
        var kind = code == 115 ? "fill"
            : code == 116 ? "linear"
            : code == 117 ? "miser" : "required";
        var line = this._createLineNode(kind);
        text = text.trim();
        if (text.length > 0) {
            try {
                var strings = JSON.parse("["+text+"]");
                if (strings[0]) {
                    line.setAttribute("pre-break", strings[0]);
                }
                if (strings[1]) {
                    line.setAttribute("post-break", strings[1]);
                }
                if (strings[2]) {
                    var nonbreak = this._createSpanNode();
                    nonbreak.setAttribute("class", "pprint-non-break");
                    nonbreak.appendChild(document.createTextNode(strings[2]));
                    line.appendChild(nonbreak);
                }
            } catch (e) {
                this.log("bad line-break specifier '"+text+"' - caught "+e);
            }
        }
        this.insertNode(line);
        if (this._needSectionEndList) {
            var absLine = this.getAbsCursorLine();
            while (this.lineStarts[absLine].nodeName=="SPAN")
                absLine--;
            if (this._deferredLinebreaksStart < 0
                || this._deferredLinebreaksStart > absLine)
                this._deferredLinebreaksStart = absLine;
        }
        this._setPendingSectionEnds(line);
        if (kind=="required")
            this.lineStarts[this.getAbsCursorLine()].alwaysMeasureForBreak = true;
        line._needSectionEndNext = this._needSectionEndList;
        this._needSectionEndList = line;
        break;
    default:
        // WTDebug.println("Saw Operating System Control #"+code+" \""+WTDebug.toQuoted(text)+"\"");
    }
};

DomTerm.prototype._setPendingSectionEnds = function(end) {
    for (var pending = this._needSectionEndList;
         pending != this._needSectionEndFence; ) {
        var next = pending._needSectionEndNext;
        pending._needSectionEndNext = undefined;
        pending.sectionEnd = end;
        pending = next;
    }
    this._needSectionEndList = this._needSectionEndFence;
};

DomTerm.prototype._pushPprintGroup = function(ppgroup) {
    ppgroup.outerPprintGroup = this._currentPprintGroup;
    this._currentPprintGroup = ppgroup;
    ppgroup._needSectionEndNext = this._needSectionEndList;
    this._needSectionEndList = ppgroup;
    ppgroup._saveSectionEndFence = this._needSectionEndFence;
    this._needSectionEndFence = this._needSectionEndList;
};

DomTerm.prototype._popPprintGroup = function() {
    var ppgroup = this._currentPprintGroup;
    if (ppgroup) {
        this._currentPprintGroup = ppgroup.outerPprintGroup;
        this._needSectionEndFence = ppgroup._saveSectionEndFence;
        ppgroup._saveSectionEndFence = undefined;
    }
}

var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

DomTerm.prototype.getAsHTML = function(saveMode=false) {
    var string = "<!DOCTYPE html>\n";
    var dt = this;

    function  escapeText(text) {
        // Assume single quote is not used in atributes
        return text.replace(/[&<>"]/g, function(m) { return escapeMap[m]; });
    };

    function formatDOM(node) {
        var children, i = 0;
        switch (node.nodeType) {
        case 1: // element
            var tagName = node.tagName.toLowerCase();
            var tagAttributes = node.attributes;
            var prefix = node.prefix;
            var id = node.getAttribute("id");
            var cls = node.getAttribute("class");

            if (tagName == "div") {
                if (id == "domterm__helper" || cls == "domterm-spacer"
                    || cls == "resize-sensor" || cls == "domterm-show-info")
                    break;
            } else if (tagName == "span") {
                if (cls == "pprint-indentation")
                    break;
                if (cls == "wc-node") {
                    string += node.textContent;
                    break;
                }
            }

            var s = '<' + tagName;
            var skip = false;
            if (tagAttributes.length) {
                for (i = 0; i < tagAttributes.length; i++) {
                    var aname = tagAttributes[i].nodeName;
                    var avalue = tagAttributes[i].nodeValue;
                    if (aname=="line" && tagName=="span") {
                        if (avalue=="soft")
                            skip = true;
                        else if (avalue == "hard") {
                            string += "\n";
                            skip = true;
                        }
                    } else if (aname == "class" && avalue == "domterm"
                             && tagName == "div")
                        avalue = DomTerm._savedSessionClassNoScript;
                    else if ((tagName == "link" && aname == "href")
                             || (tagName == "script" && aname == "src")) {
                        avalue = avalue.replace("qrc:", "");
                        if (avalue == "hlib/domterm-client.js")
                            avalue = "hlib/domterm-saved.js";
                        if (avalue == "hlib/qwebchannel.js")
                            skip = true;
                    } else if (aname=="breaking" && tagName=="span"
                               && node.getAttribute("line"))
                        continue;
                    s += ' ' + aname+ // .toLowerCase() +
                        '="' + escapeText(avalue) + '"';
                }
            }
            if (skip)
                break;
            string += s;
            if (!node.firstChild) {
                if ((dt.elementInfo(tagName) & 0x10) == 0)
                    string += '></'+tagName+'>';
                else
                    string += '/>';
            } else {
                string += '>';
                children = node.childNodes;
                for (i = 0; i < children.length; i++) {
                    formatDOM(children[i]); // , namespaces
                }
                if (saveMode
                    && tagName == "title"
                    && node.parentNode instanceof Element
                    && node.parentNode.tagName.toLowerCase() == "head") {
                    string += " saved ";
                    var now = new Date();
                    string += now.getFullYear();
                    var month = now.getMonth() + 1;
                    string += (month < 10 ? "-0" : "-") + month;
                    var date = now.getDate();
                    string += (date < 10 ? "-0" : "-") + date;
                    var hours = now.getHours();
                    string += (hours < 10 ? " 0" : " ") + hours;
                    var minutes = now.getMinutes();
                    string += (minutes < 10 ? ":0" : ":") + minutes;
                }
                string += '<\/' + tagName + '>';
            }
            if (tagName == 'div' || tagName == 'p' || tagName == 'body'
                || tagName == 'pre')
                string += '\n';
            break;
        case 2: // ATTRIBUTE (should only get here if passing in an attribute node)
            string += ' ' + node.name+ // .toLowerCase() +
            '="' + escapeText(node.value) + '"'; // .toLowerCase()
            break;
        case 3: // TEXT
            string += escapeText(node.nodeValue);
            break;
        case 4: // CDATA
            if (node.nodeValue.indexOf(']]'+'>') !== -1) {
                invalidStateError();
            }
            string += '<'+'![CDATA[';
            string += node.nodeValue;
            string += ']]'+'>';
            break;
        };
    };

    formatDOM(document.documentElement);
    return string;
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

/* 'bytes' should be an ArrayBufferView, typically a Uint8Array */
DomTerm.prototype.insertBytes = function(bytes) {
    if (this.verbosity >= 2)
        this.log("insertBytes "+this.name+" "+typeof bytes);
    if (this.decoder == null)
        this.decoder = new TextDecoder(); //label = "utf-8");
    var str = this.decoder.decode(bytes, {stream:true});
    this.insertString(str); 
}

DomTerm.prototype._pauseContinue = function(skip = false) {
    var wasMode = this._pagingMode;
    this._pagingMode = 0;
    this.modeLineGenerator = null;
    if (wasMode != 0)
        this._updatePagerInfo();
    if (this.verbosity >= 2)
        this.log("pauseContinue was mode="+wasMode);
    if (wasMode == 2) {
        var text = this.parameters[1];
        this.parameters[1] = null;
        if (! skip && text)
            this.insertString(text);
        this._confirmedCount = this._receivedCount;
        text = this.parameters[1];
        // FIXME maybe this._temporaryAutoPaging = true;
        if (text == null || text.length < 500) {
            if (this.verbosity >= 2)
                this.log("report RECEIVED "+this._confirmedCount);
            this.reportEvent("RECEIVED", this._confirmedCount);
        }
    }
}

DomTerm.prototype.insertString = function(str) {
    if (this.verbosity >= 2)
        this.log("insertString "+JSON.stringify(str)+" state:"+this.controlSequenceState);
    if (this._pagingMode == 2) {
        this.parameters[1] = this.parameters[1] + str;
        return;
    }
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
    var dt = this;
    var update = function() {
        dt._updateTimer = null;
        dt._breakDeferredLines();
        dt._checkSpacer();
        // FIXME only if "scrollWanted"
        if (dt._pagingMode == 0)
            dt._scrollIfNeeded();
        dt._restoreInputLine();
    };
    if (this.useStyledCaret())
        this._removeInputLine();
    this._doDeferredDeletion();
    var slen = str.length;
    var i = 0;
    var prevEnd = 0;
    var columnWidth = 0; // number of columns since prevEnv
    for (; i < slen; i++) {
        var ch = str.charCodeAt(i);
        //this.log("- insert char:"+ch+'="'+String.fromCharCode(ch)+'" state:'+this.controlSequenceState);
        var state = this.controlSequenceState;
        switch (state) {
        case DomTerm.SEEN_SURROGATE_HIGH:
            // must have i==0
            str = this.parameters[0] + str;
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            slen++;
            i = -1;
            break;
        case DomTerm.SEEN_ESC_STATE:
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            if (ch != 91 /*'['*/ && ch != 93 /*']'*/
                && ! (ch >= 40 && ch <= 47) && ! (ch >= 78 && ch <= 79))
                this._breakDeferredLines();
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
            case 72 /*'H'*/: // HTS Tab Set
                this.setTabStop(this.getCursorColumn(), true);
                break;
            case 77 /*'M'*/: // Reverse index (cursor up with scrolling)
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
            prevEnd = i + 1; columnWidth = 0;
            break;
        case DomTerm.SEEN_ESC_LBRACKET_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_QUESTION_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_EXCLAMATION_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_GREATER_STATE:
        case DomTerm.SEEN_ESC_LBRACKET_SPACE_STATE:
            if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                var plen = this.parameters.length;
                var cur = this.parameters[plen-1];
                cur = cur ? 10 * cur : 0;
                this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
            }
            else if (ch == 58 /*':'*/) {
                // See https://bugzilla.gnome.org/show_bug.cgi?id=685759
                // This is a cheat - treat ':' same as ';'.
                // Better would be to append digits and colons into a single
                // string parameter.
                this.parameters.push(null);
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
            else if (ch == 32/*' '*/)
                this.controlSequenceState = DomTerm.SEEN_ESC_LBRACKET_SPACE_STATE;
            else {
                this.handleControlSequence(ch);
                this.parameters.length = 1;
                prevEnd = i + 1; columnWidth = 0;
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
            else if (ch == 59 /*';'*/ || ch == 7 || ch == 0 || ch == 27) {
                this.controlSequenceState = DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE;
                this.parameters.push("");
                if (ch != 59)
                    i--; // re-read 7 or 0
                prevEnd = i + 1; columnWidth = 0;
            } else {
                this.parameters.length = 1;
                prevEnd = i + 1; columnWidth = 0;
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            }
            continue;
        case DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE:
            if (ch == 7 || ch == 0 || ch == 27) {
                this.parameters[1] =
                    this.parameters[1] + str.substring(prevEnd, i);
                this.handleOperatingSystemControl(this.parameters[0], this.parameters[1]);
                this.parameters.length = 1;
                prevEnd = i + 1; columnWidth = 0;
                this.controlSequenceState =
                    ch == 27 ? DomTerm.SEEN_ESC_STATE
                    : DomTerm.INITIAL_STATE;
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
            prevEnd = i + 1; columnWidth = 0;
            break;
        case DomTerm.SEEN_ESC_SHARP_STATE: /* SCR */
            switch (ch) {
            case 53 /*'5'*/: // DEC single-width line (DECSWL)
            case 54 /*'6'*/: // DEC double-width line (DECDWL)
                // DECDWL is a property of the entire current line.
                // I.e. existing character on the current line are re-drawn.
                // DECSWL undoes any previous DECDWL for that line.
                // In lieu of stylesheet support, we can place each
                // character in its own <span class="wc-node">.
                // (ASCII characters should be replaced by full-width forms.)
                // However, cursor motion treats each double-width
                // character as a singe column.  FIXME
                break;
            case 56 /*'8'*/: // DEC Screen Alignment Test (DECALN)
                this._setRegionTB(0, -1);
                this._setRegionLR(0, -1);
                this.moveToAbs(this.homeLine, 0, true);
                this.eraseDisplay(0);
                var Es = "E".repeat(this.numColumns);
                this._currentStyleSpan = null;
                var savedStyleMap = this._currentStyleMap;
                this._currentStyleMap = new Map();
                for (var r = 0; ; ) {
                    this.insertSimpleOutput(Es, 0, this.numColumns, this.numColumns);
                    if (++r >= this.numRows)
                        break;
                    this.cursorLineStart(1);
                }
                this._currentStyleMap = savedStyleMap;
                this.moveToAbs(this.homeLine, 0, true);
                break;
            }
            prevEnd = i + 1; columnWidth = 0;
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            break;
        case DomTerm.SEEN_ESC_SS2: // _Gcharsets[2]
        case DomTerm.SEEN_ESC_SS3: // _Gcharsets[3]
            var mapper = this._Gcharsets[state-DomTerm.SEEN_ESC_SS2+2];
            prevEnv = i;
            if (mapper != null) {
                var chm = mapper(ch);
                if (chm != null) {
                    this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    this.insertSimpleOutput(chm, 0, chm.length, -1);
                    prevEnd = i + 1;  columnWidth = 0;
                }
            }
            this.controlSequenceState = DomTerm.INITIAL_STATE;
            break;
        case DomTerm.INITIAL_STATE:
            switch (ch) {
            case 13: // '\r' carriage return
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                //this.currentCursorColumn = column;
                // FIXME adjust for _regionLeft
                if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                    && ! this.usingAlternateScreenBuffer
                    && (this._regionBottom == this.numRows
                        || this.getCursorLine() != this._regionBottom-1)) {
                    var stdMode = this._getStdMode(); 
                    if (stdMode && stdMode.getAttribute("std") == "input")
                        this._pushStdMode(null);
                    if (this._pauseNeeded()) {
                        this.parameters[1] = str.substring(i);
                        update();
                        this._enterPaging(true);
                        return;
                    }
                    this.cursorLineStart(1);
                    i++;
                } else {
                    this._breakDeferredLines();
                    this.cursorLineStart(0);
                }
                prevEnd = i + 1; columnWidth = 0;
                break;
            case 10: // '\n' newline
            case 11: // vertical tab
            case 12: // form feed
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                this._breakDeferredLines();
                if (this._currentStyleMap.get("std") == "input")
                    this._pushStdMode(null);
                if (this._pauseNeeded()) {
                    this.parameters[1] = str.substring(i);
                    update();
                    this._enterPaging(true);
                    return;
                }
                this.cursorNewLine(this.automaticNewlineMode);
                prevEnd = i + 1; columnWidth = 0;
                break;
            case 27 /* Escape */:
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                //this.currentCursorColumn = column;
                prevEnd = i + 1; columnWidth = 0;
                this.controlSequenceState = DomTerm.SEEN_ESC_STATE;
                continue;
            case 8 /*'\b'*/:
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                this._breakDeferredLines();
                this.cursorLeft(1, false);
                prevEnd = i + 1;  columnWidth = 0;
                break;
            case 9 /*'\t'*/:
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                this._breakDeferredLines();
                this.tabToNextStop();
                prevEnd = i + 1;  columnWidth = 0;
                break;
            case 7 /*'\a'*/:
                this.insertSimpleOutput(str, prevEnd, i, columnWidth); 
                //this.currentCursorColumn = column;
                this.handleBell();
                prevEnd = i + 1; columnWidth = 0;
                break;
            case 24: case 26:
                this.controlSequenceState = DomTerm.INITIAL_STATE;
                break;
            case 14 /*SO*/: // Switch to Alternate Character Set G1
            case 15 /*SI*/: // Switch to Standard Character Set G0
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                prevEnd = i + 1; columnWidth = 0;
                this._selectGcharset(15-ch, false);
                break;
            case 5 /*ENQ*/: // FIXME
            case 0: case 1: case 2:  case 3:
            case 4: case 6:
            case 16: case 17: case 18: case 19:
            case 20: case 21: case 22: case 23: case 25:
            case 28: case 29: case 30: case 31:
                // ignore
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                prevEnd = i + 1; columnWidth = 0;
                break;
            default:
                var i0 = i;
                if (ch >= 0xD800 && ch <= 0xDBFF) {
                    i++;
                    if (i == slen) {
                        this.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                        this.parameters[0] = str.charAt(i0);
                        this.controlSequenceState = DomTerm.SEEN_SURROGATE_HIGH;
                        break;
                    } else {
                        ch = ((ch - 0xD800) * 0x400)
                            + ( str.charCodeAt(i) - 0xDC00) + 0x10000;
                    }
                }
                var chm = this.charMapper == null ? null : this.charMapper(ch);
                var multipleChars = chm != null;
                if (chm != null && chm.length == 2) {
                    var ch0 = chm.charCodeAt(0);
                    var ch1 = chm.charCodeAt(1);
                    if (ch0 >= 0xd800 && ch0 <= 0xdbff
                        && ch1 >= 0xdc00 && ch1 <= 0xdfff) {
                        ch = (ch0-0xd800)*0x400 + (ch1-0xdc00)+0x10000;
                        multipleChars = false;
                    }
                }
                if (multipleChars) {
                    this.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                    this.insertSimpleOutput(chm, 0, chm.length);
                    prevEnd = i + 1; columnWidth = 0;
                    break;
                }
                var cwidth = this.wcwidthInContext(ch, this.outputContainer);
                if (cwidth == 2) {
                    this.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                    prevEnd = i + 1; columnWidth = 0;
                    if (chm == null)
                        chm = str.substring(i0, prevEnd);
                    var wcnode = this._createSpanNode();
                    wcnode.setAttribute("class", "wc-node");
                    this._pushIntoElement(wcnode);
                    this.insertSimpleOutput(chm, 0, chm.length, 2);
                    this.popFromElement();
                    break;
                }
                columnWidth += cwidth;
            }
        }
    }
    if (this.controlSequenceState == DomTerm.INITIAL_STATE) {
        this.insertSimpleOutput(str, prevEnd, i, columnWidth);
        //this.currentCursorColumn = column;
    }
    if (this.controlSequenceState == DomTerm.SEEN_ESC_RBRACKET_TEXT_STATE) {
        this.parameters[1] = this.parameters[1] + str.substring(prevEnd, i);
    }

    if (window.requestAnimationFrame) {
        if (this._updateTimer)
            cancelAnimationFrame(this._updateTimer);
        this._updateTimer = requestAnimationFrame(update);
    } else {
        if (this._updateTimer)
            clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(update, 100);
    }
};

DomTerm.prototype._scrollIfNeeded = function() {
    var last = this.topNode.lastChild;
    var lastBottom = last.offsetTop + last.offsetHeight;
    if (lastBottom > this.topNode.scrollTop + this.availHeight) {
        if (this.verbosity >= 2)
            this.log("scroll-needed was:"+this.topNode.scrollTop+" to "
                     +(lastBottom - this.availHeight));
        this.topNode.scrollTop = lastBottom - this.availHeight;
    }
}

DomTerm.prototype._breakDeferredLines = function() {
    var start = this._deferredLinebreaksStart;
    if (start >= 0) {
        this._deferredLinebreaksStart = -1;
        this._breakAllLines(start);
        if ((this._regionTop > 0 || this._regionBottom < this.numRows)
            && this.getCursorLine() == this._regionBottom-1) {
            // scroll if needed
            var lines = this.getCursorLine() - this._regionTop + 1;
            var regionHeight = this._regionBottom - this._regionTop;
            var scrollCount = lines - regionHeight;
            if (scrollCount > 0) {
                this.moveToAbs(this._regionTop+this.homeLine, 0, true);
                this.deleteLinesIgnoreScroll(scrollCount, false);
                this.moveToAbs(this._regionBottom +this.homeLine- 1, 0, true);
            }
        }
    }
};

DomTerm.prototype._breakAllLines = function(startLine = -1) {
    // The indentation array is a stack of the following:
    // - a <span> node containing pre-line prefixes; or
    // - an absolute x-position (in pixels)
    var indentation = new Array();

    function addIndentation(dt, el) {
        var n = indentation.length;
        var curPosition = 0;
        var goalPosition = 0;
        var insertPosition = el.lastChild;
        if (insertPosition == null
            || insertPosition.nodeName != "SPAN"
            || insertPosition.getAttribute("class") != "pprint-post-break")
            insertPosition = null;
        for (var i = 0; ;  ) {
            var indent = i == n ? null : indentation[i++];
            if ((indent == null || indent instanceof Element)
                && goalPosition > curPosition) {
                var span = dt._createSpanNode();
                span.setAttribute("class", "pprint-indentation");
                span.setAttribute("style",
                                  "padding-left: "+(goalPosition-curPosition)+"px");
                el.insertBefore(span, insertPosition);
                curPosition = goalPosition;
            }
            if (indent == null)
                break;
            if (indent instanceof Element) {
                indent = indent.cloneNode(false);
                el.insertBefore(indent, insertPosition);
                curPosition = el.offsetLeft + el.offsetWidth;
                goalPosition = curPosition;
            }
            else
                goalPosition = indent;
        }
        if (el.getAttribute("line") != "soft"
            && el.getAttribute("pre-break") == null
            && (el.firstChild == null
                || el.firstChild.nodeName != "SPAN"
                || el.firstChild.getAttribute("class") != "pprint-pre-break"))
            el.setAttribute("pre-break", ""); // Needed for CSS
        el.setAttribute("breaking", "yes");
        return curPosition;
    };

    function insertIntoLines(dt, el) {
        var lineCount = dt.lineStarts.length;
        var lineEnd = dt.lineEnds[line];

        for (var i = lineCount; --i > line; ) {
            dt.lineStarts[i+1] = dt.lineStarts[i];
            dt.lineEnds[i+1] = dt.lineEnds[i];
        }
        dt.lineEnds[line+1] = lineEnd;
        dt.lineStarts[line+1] = el;
        dt.lineEnds[line] = el;
        // FIXME following lines are duplicated with moveToAbs
        lineCount++;
        var homeLine = dt.homeLine;
        if (lineCount > homeLine + dt.numRows) {
            homeLine = lineCount - dt.numRows;
            //goalLine -= homeLine - dt.homeLine;
            dt.homeLine = homeLine;
        }
    };

    function breakLine (dt, start, beforePos, availWidth) {
        var pprintGroup = null; // FIXME if starting inside a group

        // Using two passes is an optimization, because mixing offsetLeft
        // calls with DOM mutation is very expensive.
        var topLeft = dt.topNode.getBoundingClientRect().left;
        for (var el = start.parentNode;
             el != null && el.nodeName == "SPAN"; el = el.parentNode) {
            // This is needed when we start with an existing soft break
            var rects = el.getClientRects();
            var nrects = rects.length;
            if (nrects == 0) {
                el.measureLeft = 0;
                el.measureWidth = 0;
            } else {
                var measureLeft = rects[nrects-1].left;
                el.measureLeft = measureLeft - topLeft;
                el.measureWidth = rects[nrects-1].right - measureLeft;
            }
        }
        // First pass - measure (call offsetLeft) but do not change DOM
        for (var el = start; el != null; ) {
            var lineAttr;
            var skipChildren = false;
            if (el instanceof Text || dt.isObjectElement(el)
                || el.getAttribute("class") == "wc-node") {
                skipChildren = true;
            } else if (el.nodeName == "SPAN"
                       && (lineAttr = el.getAttribute("line")) != null) {
                skipChildren = true;
                if ((lineAttr == "hard" || lineAttr == "soft")
                    && el.outerPprintGroup == null)
                    break;
                if (lineAttr == "linear") {
                    var group = el.outerPprintGroup;
                    var sectionEnd = group ? group.sectionEnd : null;
                    if (! sectionEnd)
                        sectionEnd = dt.lineEnds[line];
                }
            } else if (el.getAttribute("class") == "pprint-indent") {
                skipChildren = true;
                el.pprintGroup = pprintGroup;
            } else if (el.getAttribute("class") == "pprint-group") {
                pprintGroup = el;
            }
            if (el instanceof Element) {
                el.measureLeft = el.offsetLeft;
                el.measureWidth = el.offsetWidth;
            }
            if (el.firstChild != null && ! skipChildren)
                el = el.firstChild;
            else {
                for (;;) {
                    if (el == null)
                        break;
                    if (el == pprintGroup) { // pop pprint-group
                        pprintGroup = pprintGroup.outerPprintGroup;
                    }
                    var next = el.nextSibling;
                    if (next != null) {
                        el = next;
                        break;
                    }
                    el = el.parentNode;
                }
            }
        }
        var end = dt.lineEnds[line];
        end.measureLeft = end.offsetLeft;
        end.measureWidth = end.offsetWidth;

        // second pass - edit DOM, but don't look at offsetLeft
        // beforePos is typically el.offsetLeft (if el is an element).
        var beforePos = 0;
        // startOffset is the difference (beforePos - beforeMeasure),
        // where beforeMeasure is typically el.measureLeft (if an element).
        // If el is a Text, beforePos and beforeMeasure are calculated.
        var startOffset = 0;
        var sectionStartLine = line;
        for (var el = start; el != null; ) {
            // startOffset is the value of measureWidth corresponding
            // to the start of the current line.
            var lineAttr;
            var dobreak = false;
            var skipChildren = false;
            var measureWidth = el instanceof Element ? el.measureWidth : 0;
            if (el instanceof Text || dt.isObjectElement(el)
                || el.getAttribute("class") == "wc-node") {
                skipChildren = true;
                if (el instanceof Text)
                    dt._normalize1(el);
                next = el.nextSibling;
                var afterMeasure;
                if (next instanceof Element)
                    afterMeasure = next.measureLeft;
                else {
                    var p = el instanceof Element ? el : el.parentNode;
                    afterMeasure = p.measureLeft+p.measureWidth;
                }
                var right = afterMeasure - startOffset;
                if (right > availWidth) {
                    var beforeMeasure = beforePos + startOffset;
                    var lineNode = dt._createLineNode("soft");
                    var indentWidth;
                    if (el instanceof Text) {
                        el.parentNode.insertBefore(lineNode, el.nextSibling);
                        var rest = dt._breakString(el, lineNode, beforePos,
                                                   right, availWidth);
                        insertIntoLines(dt, lineNode);
                        el = lineNode;
                        indentWidth = addIndentation(dt, el);
                        var oldWidth = afterMeasure - beforeMeasure;
                        var beforeWidth = lineNode.offsetLeft;
                        rest = document.createTextNode(rest);
                        el.parentNode.insertBefore(rest, el.nextSibling);
                        next = rest;
                    } else { // dt.isObjectElement(el) or wc-node
                        insertIntoLines(dt, lineNode);
                        el.parentNode.insertBefore(lineNode, el);
                        indentWidth = addIndentation(dt, lineNode);
                    }
                    line++;
                    beforeMeasure += lineNode.offsetLeft - beforePos;
                    beforePos = indentWidth;
                    startOffset = beforeMeasure - beforePos;
                    dobreak = true;
                } else {
                    beforePos = right;
                }
            } else if (el.nodeName == "SPAN"
                       && (lineAttr = el.getAttribute("line")) != null) {
                skipChildren = true;
                if ((lineAttr == "hard" || lineAttr == "soft")
                    && el.outerPprintGroup == null)
                    break;
                if (lineAttr == "linear") {
                    var group = el.outerPprintGroup;
                    var sectionEnd = group ? group.sectionEnd : null;
                    if (! sectionEnd)
                        sectionEnd = dt.lineEnds[line];
                    var containingSectionStartLine =
                        el.outerPprintGroup == null ? sectionStartLine
                        : el.outerPprintGroup.saveSectionStartLine;
                    if (line > containingSectionStartLine
                        || (sectionEnd.measureLeft - startOffset) > availWidth)
                        dobreak = true;
                } else if (lineAttr == "hard" || lineAttr == "required")
                    dobreak = true;
                else if (lineAttr == "fill" || lineAttr == "miser") {
                    var sectionEnd = el.sectionEnd;
                    if (! sectionEnd)
                        sectionEnd = dt.lineEnds[line];
                    if (sectionEnd && (sectionEnd.measureLeft - startOffset) > availWidth
                        || line > sectionStartLine)
                        dobreak = true;
                }
                if (dobreak) {
                    startOffset = el.measureLeft + el.measureWidth;
                    var indentWidth = addIndentation(dt, el);
                    startOffset -= indentWidth;
                    beforePos = indentWidth;
                    if (lineAttr != "hard") {
                        insertIntoLines(dt, el);
                        line++;
                    }
                }
                sectionStartLine = line;
            } else if (el.getAttribute("class") == "pprint-indent") {
                skipChildren = true;
                var extra = el.getAttribute("indentation");
                var delta = el.getAttribute("delta");
                var blockDelta = el.getAttribute("block-delta");
                if (delta) {
                    indentation.push(el.measureLeft - startOffset
                                     + (dt.charWidth * Number(delta)));
                } else if (blockDelta) {
                    var startBlockPosition = pprintGroup == null ? 0
                        : (pprintGroup.measureLeft - startOffset);
                    indentation.push(startBlockPosition
                                     + (dt.charWidth * Number(blockDelta)));
                }
                if (extra) {
                    var span = dt._createSpanNode();
                    span.setAttribute("class", "pprint-indentation");
                    span.setAttribute("value", extra);
                    indentation.push(span);
                }
            } else if (el.getAttribute("class") == "pprint-group") {
                var previous = el.previousSibling;
                el.indentLengthBeforeBlock = indentation.length;
                el.saveSectionStartLine = sectionStartLine;
                sectionStartLine = line;
                if (previous && previous.nodeName == "SPAN"
                    && previous.getAttribute("class") == "pprint-prefix") {
                    var prefix = previous.firstChild.data;
                    var span = dt._createSpanNode();
                    span.setAttribute("class", "indentation");
                    span.setAttribute("value", extra);
                    indentation.push(previous.measureLeft - startOffset);
                    indentation.push(span);
                }
                indentation.push(el.measureLeft - startOffset);
                pprintGroup = el;
                el.breakSeen = false;
            }
            if (dobreak) {
                for (var g = pprintGroup; g != null; g = g.outerPprintGroup)
                    g.breakSeen = true;
            } else {
                beforePos += measureWidth;
            }
            if (el.firstChild != null && ! skipChildren)
                el = el.firstChild;
            else {
                for (;;) {
                    if (el == null)
                        break;
                    if (el == pprintGroup) { // pop pprint-group
                        indentation.length = el.indentLengthBeforeBlock;
                        pprintGroup = pprintGroup.outerPprintGroup;
                        sectionStartLine = el.saveSectionStartLine;
                    }
                    var next = el.nextSibling;
                    if (next != null) {
                        el = next;
                        break;
                    }
                    el = el.parentNode;
                }
            }
        }
    };

    if (startLine < 0) {
        startLine = 0;
        if (this.usingAlternateScreenBuffer) {
            if (this.initial && this.initial.saveLastLine >= 0) // paranoia
                startLine = this.initial.saveLastLine;
            else
                startLine = this.homeLine;
        }
    }

    var delta = 0;
    // First remove any existing soft line breaks.
    for (var line = startLine+1;  line < this.lineStarts.length;  line++) {
        var lineStart = this.lineStarts[line];
        if (delta > 0) {
            this.lineStarts[line-delta] = this.lineStarts[line];
            this.lineEnds[line-delta-1] = this.lineEnds[line-1];
        }
        if (! this.isSpanNode(lineStart))
            continue;
        var lineAttr = lineStart.getAttribute("line");
        if (! lineAttr)
            continue;
        if (lineStart.getAttribute("breaking")=="yes") {
            lineStart.removeAttribute("breaking");
            for (var child = lineStart.firstChild;
                 child != null; ) {
                var next = child.nextSibling;
                if (child.getAttribute("class") == "pprint-indentation")
                    lineStart.removeChild(child);
                child = next;
            }
        }
        if (lineAttr != "hard" && lineAttr != "br") {
            // Remove "soft" line breaks from DOM
            if (lineAttr == "soft" || lineAttr == "space") {
                if (this.outputBefore == lineStart)
                    this.outputBefore = lineStart.nextSibling;
                var prev = lineStart.previousSibling;
                lineStart.parentNode.removeChild(lineStart);
                if (prev instanceof Text)
                    this._normalize1(prev);
            }
            // Remove "soft" "fill" "miser" "space" breaks from the line-table
            delta++;
        }
    }
    var changed = false;
    if (delta > 0) {
        // Update line tables
        var lineCount = this.lineEnds.length;
        this.lineEnds[lineCount-delta-1] = this.lineEnds[lineCount-1];
        this.lineStarts.length = lineCount-delta;
        this.lineEnds.length = lineCount-delta;
        changed = true; // FIXME needlessly conservative
    }

    for (var line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        var end = this.lineEnds[line];
        if (start.alwaysMeasureForBreak
            || (end != null && end.offsetLeft > this.availWidth)) {
            changed = true; // FIXME needlessly conservative
            var first = this.isBlockNode(start) ? start.firstChild
                : start.nextSibling;
            breakLine(this, first, 0, this.availWidth);
        }
    }
    if (changed)
        this.resetCursorCache();
    if (this.lineStarts.length - this.homeLine > this.numRows) {
        var absLine = this.getAbsCursorLine();
        this.homeLine = this.lineStarts.length - this.numRows;
        if (absLine < this.homeLine) {
            this.resetCursorCache();
            this.moveToAbs(this.homeLine, 0, false);
        }
    }
}

DomTerm.prototype._breakString = function(textNode, lineNode, beforePos, afterPos, availWidth) {
    var dt = this;
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
    else if (textNode.data.length != goodLength) {
        if ((this.wraparoundMode & 2) != 0) {
            textNode.data = textData.substring(0, goodLength);
        } else {
            // FIXME handle surrogates
            textData = (textData.substring(0, goodLength-1)
                        + textData.substring(textLength-1));
            textNode.data = textData;
            return "";
        }
    }

    if (goodLength < textLength) {
        var rest;
        if (goodLength == 0) {
            textNode.data = "";
            return textData;
        } else {
            return textData.substring(goodLength);
        }
    }
    return "";
};

DomTerm.prototype.insertSimpleOutput = function(str, beginIndex, endIndex,
                                               widthInColumns = -1) {
    var sslen = endIndex - beginIndex;
    if (sslen == 0)
        return;

    var slen = str.length;
    if (beginIndex > 0 || endIndex != slen) {
        str = str.substring(beginIndex, endIndex);
        slen = endIndex - beginIndex;
    }
    if (this.verbosity >= 3)
        this.log("insertSimple '"+this.toQuoted(str)+"'");
    var absLine = this.getAbsCursorLine();
    var fits = true;
    if (this.outputBefore instanceof Element
        && this.outputBefore.getAttribute("line")
        && this.outputBefore.previousSibling instanceof Element
        && this.outputBefore.previousSibling.getAttribute("std")) {
        this.outputContainer = this.outputBefore.previousSibling;
        this.outputBefore = null;
    }
    if (widthInColumns < 0)
        widthInColumns = this.strWidthInContext(str, this.outputContainer);
    if (this.insertMode) {
        var line = this.getAbsCursorLine();
        var col = this.getCursorColumn();
        var trunccol = this.numColumns-widthInColumns;
        // This would be simpler and faster if we had a generalization
        // of eraseCharactersRight which erases after an initial skip. FIXME
        // I.e. eraseCharactersAfterSkip(col < trunccol ? trunccol - col : 0);
        var saveContainer = this.outputContainer;
        var saveOutput = this.outputBefore;
        var firstInParent = saveOutput == saveContainer.firstChild;
        var prev = saveOutput ? saveOutput.previousSibling : null;
        if (col < trunccol)
            this.moveToAbs(line, trunccol, false);
        this.deleteCharactersRight(-1);
        if (col < trunccol) {
            if (firstInParent || prev instanceof Element) {
                this.outputContainer = saveContainer;
                this.outputBefore =
                    firstInParent ? saveContainer.firstChild
                    : prev.nextSibling;
                this.currentAbsLine = line;
                this.currentCursorColumn = col;
            } else {
                this.moveToAbs(line, col, true);
            }
        }
    } else {
        // FIXME optimize if end of line
        fits = this.deleteCharactersRight(widthInColumns);
    }
    if (this._currentStyleSpan != this.outputContainer)
        this._adjustStyle();
    if (! fits && absLine < this.lineStarts.length - 1) {
        this._breakDeferredLines();
        // maybe adjust line/absLine? FIXME
        for (;;) {
            var textNode = this.insertRawOutput(str);
            if (this.getCursorColumn() + widthInColumns <= this.numColumns)
                break;
            var right = this.availWidth;
            str = this._breakString(textNode, this.lineEnds[absLine], 0, right, this.availWidth);
            //current is after inserted textNode;
            var oldContainer = this.outputContainer;
            var oldLine = this.lineEnds[absLine];
            if (this.outputBefore != null
                || oldContainer.nextSibling != oldLine)
                oldLine = null;
            var oldContainerNext = oldContainer.nextSibling;
            this.cursorLineStart(1);
            this._forceWrap(absLine);
            // Move newly-softened line inside oldContainer.
            if (oldLine
                && this.outputContainer == oldLine.parentNode
                && this.outputBefore == oldLine.nextSibling) {
                oldContainer.appendChild(oldLine);
                this.outputContainer = oldContainer;
                this.outputBefore = null;
            }
            absLine++;
            widthInColumns = this.strWidthInContext(str, this.outputContainer);
            this.deleteCharactersRight(widthInColumns);
        }
    }
    else {
        this.insertRawOutput(str);
        this._updateLinebreaksStart(absLine);
    }
    this.currentAbsLine = absLine;
    this.currentCursorColumn =
        this.currentCursorColumn < 0 || widthInColumns < 0 ? -1
        : this.currentCursorColumn + widthInColumns;
};

DomTerm.prototype._updateLinebreaksStart = function(absLine) {
    // Contending optimizations:
    // If we're on the last line, we may be doing bulk output,
    // so avoid acessing offsetLeft (expensive because it forces layout).
    // If we're not on the last, we may be doing cursor adressing,
    // and we want to avoid calling _breakAllLines needlessly.
    if (this._deferredLinebreaksStart < 0
        && (absLine == this.lineEnds.length - 1
            || (this.lineEnds[absLine] != null
                && this.lineEnds[absLine].offsetLeft > this.availWidth)))
        this._deferredLinebreaksStart = absLine;
}

DomTerm.prototype.insertRawOutput = function(str) {
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
    if (strRect.right > topRect.right - this.charWidth) {
    }
    */
    return node;
};

/** Insert element at current position, and move to start of element.
 * @param element to be inserted at current output position.
 *  This element should have no parents *or* children.
 *  It becomes the new outputContainer.
 */
DomTerm.prototype._pushIntoElement = function(element) {
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
 * The node to be inserted before current output position.
 *   (Should not have any parents or siblings.)
 */
DomTerm.prototype.insertNode = function (node) {
    this.outputContainer.insertBefore(node, this.outputBefore);
};

/** Send a response to the client.
* By default just calls processInputCharacters.
*/
DomTerm.prototype.processResponseCharacters = function(str) {
    if (this.verbosity >= 3)
        this.log("processResponse: "+JSON.stringify(str));
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
    if (this.verbosity >= 2)
        this.log("processInputCharacters called with "+str.length+" characters");
};

DomTerm.prototype.processEnter = function() {
    this._restoreInputLine();
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
    if (event) {
        if (event.shiftKey)
            mods += 1;
        if (event.altKey)
            mods += 2;
        if (event.ctrlKey)
            mods += 4;
        if (event.metaKey)
            mods += 8;
    }
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
    case 13: /* Return/Enter */ return "\r";
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
    case 122: /* F11 */
        //return this.specialKeySequence("23", "~", event);
        return null; // default handling, which is normally full-screen
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
    case 17: /* Ctrl */
    case 18: /* Alt */
    case 20: /* CapsLoc */
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
    if (this.isLineEditing()) {
        var rng = bililiteRange(this.inputLine).bounds('selection');
        rng.text(str, 'end');
        rng.select();
    } else {
        this.reportText(str, null);
    }
};

DomTerm.prototype.doPaste = function() {
    this.maybeFocus();
    return document.execCommand("paste", false);
};

DomTerm.prototype.doCopy = function() {
    return document.execCommand("copy", false);
};

DomTerm.prototype.doSaveAs = function() {
    var dt = this;
    this._pickFile(function(fname) {
        if (fname)
            dt._writeFile(dt.getAsHTML(true), fname);
    });
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
    if (! styleSheet || ! styleSheet.ownerNode) {
        styleSheet = this.createStyleSheet();
        styleSheet.ownerNode.setAttribute("name", "(temporary-styles)");
        this.temporaryStyleSheet = styleSheet;
    }
    return styleSheet;
};

DomTerm.prototype.addStyleRule = function(styleRule) {
    var styleSheet = this.getTemporaryStyleSheet();
    try {
	styleSheet.insertRule(styleRule, styleSheet.cssRules.length);
    } catch (e) {
	this.log(e.toString());
    }
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
    if (! isNaN(index)) {
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
    var wasEditing = this.isLineEditing();
    switch (mode) {
    case 97 /*'a'*/: //auto
        this._lineEditingMode = 0;
        this.clientDoesEcho = true;
        break;
    case 99 /*'c'*/: //char
        this._lineEditingMode = -1;
        this.clientDoesEcho = true;
        break;
    case 108 /*'l'*/: //line
        this._lineEditingMode = 1;
        this.clientDoesEcho = true;
        break;
    case 112 /*'p'*/: //pipe
        this._lineEditingMode = 1;
        this.clientDoesEcho = false;
        break;
    }
    this._restoreInputLine();
    if (wasEditing && ! this.isLineEditing()) {
        this._sendInputContents();
    }
    this.automaticNewlineMode = ! this.clientDoesEcho;
};

DomTerm.prototype.getInputMode = function() {
    if (this._lineEditingMode == 0)
        return 97; // auto
    else if (this._lineEditingMode > 0)
        return 108; // line
    else
        return 99; // char
}

DomTerm.prototype.nextInputMode = function() {
    var mode;
    var displayString;
    if (this._lineEditingMode == 0) {
        // was 'auto', change to 'line'
        mode = 108; // 'l'
        displayString = "Input mode: line";
    } else if (this._lineEditingMode > 0) {
        // was 'line' change to 'char'
        mode = 99; // 'c'
        displayString = "Input mode: character";
    } else {
        // was 'char' change to 'auto'
        mode = 97; // 'a'
        displayString = "Input mode: automatic";
    }
    this.setInputMode(mode);
    this.inputModeChanged(mode);
    this._displayInputModeWithTimeout(displayString);
}

DomTerm.prototype._sendInputContents = function() {
    this._doDeferredDeletion();
    var text = this.grabInput(this.inputLine);
    this._deferredForDeletion = this.inputLine;
    this.reportText(text);
}

DomTerm.prototype.inputModeChanged = function(mode) {
    this.reportEvent("INPUT-MODE-CHANGED", '"'+String.fromCharCode(mode)+'"');
}

DomTerm.prototype.doLineEdit = function(key, str) {
    if (this.verbosity >= 2)
        this.log("doLineEdit "+key+" "+JSON.stringify(str));
    if (key == -13      // key-press event
        || key == 13) { // key-down event
        this.processEnter();
        return;
    }
    this._restoreInputLine();
    switch (key) {
    case 38: /*Up*/
        if (this._atTopInputLine()) {
            this.historyMove(-1);
            return;
        }
        break;
    case 40: /*Down*/
        if (this._atBottomInputLine()) {
            this.historyMove(1);
            return;
        }
        break;
    }
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

DomTerm.prototype._writeFile = function(data, filePath) {
    if (DomTerm.isElectron()) {
        var fs = nodeRequire('fs');
        if (filePath) {
            fs.writeFile(filePath, data, function (err) {
                alert("An error ocurred creating the file "+ err.message);
            });
        }
    } else {
        saveAs(new Blob([data], {type: "text/html;charset=utf-8"}),
               filePath, true);
    }
};

/* Request from user name for file to save.
   Then call callname(fname) is user-supplied name.
   If user cancels then fname will have a false value (null or undefined).
*/
DomTerm.prototype._pickFile = function(callback) {
    var fname = this.sessionName()+".html";
    if (DomTerm.isElectron()) {
        const {dialog} = nodeRequire('electron').remote;
        dialog.showSaveDialog({defaultPath: fname}, callback);
    } else {
        callback(prompt("save contents as: ", fname));
    }
};

DomTerm.prototype._adjustPauseLimit = function(node) {
    var limit = node.offsetTop + this.availHeight;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
}

DomTerm.prototype._isOurEvent = function(event) {
    //return this._isAnAncestor(event.target, this.topNode);
    return DomTerm.focusedTerm == this;
}

DomTerm.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event);

    if (! this._isOurEvent(event))
        return;
    if (this._composing > 0 || event.which === 229)
        return;
    if (this._composing == 0)
        this._composing = -1;

    // Ctrl-Shift-C is Copy and Ctrl-Shift-V is Paste
    if (event.ctrlKey && event.shiftKey) {
        switch (key) {
        case 33 /*PageUp*/:
        case 34 /*PageDown*/:
            this._pagePage(key == 33 ? -1 : 1);
            event.preventDefault();
            return;
        case 35 /*End*/:
            this._pageBottom();
            event.preventDefault();
            return;
        case 36 /*Home*/:
            this._pageTop();
            event.preventDefault();
            return;
        case 38 /*Up*/:
        case 40 /*Down*/:
            this._pageLine(key == 38 ? -1 : 1);
            event.preventDefault();
            return;
        case 67: // Control-Shift-C
            if (this.doCopy())
                event.preventDefault();
            return;
        case 73: // Control-shift-I
            this.nextInputMode();
            event.preventDefault();
            return;
        case 77: // Control-Shift-M
            if (this.enterMuxMode) {
                this.enterMuxMode();
                event.preventDefault();
            }
            return;
        case 78: // Control-Shift-N
            if (DomTerm.layoutAddSibling) {
                DomTerm.layoutAddSibling(this);
                event.preventDefault();
                return;
            }
            break;
       case 80: // Control-Shift-P
            if (this._currentlyPagingOrPaused()) {
                this._temporaryAutoPaging = false;
                this._pauseContinue();
                this._exitPaging();
            } else
                this._enterPaging(true);
            event.preventDefault();
            return;
        case 83: // Control-Shift-S
            this.doSaveAs();
            event.preventDefault();
            return;
        case 84: // Control-Shift-T
            if (DomTerm.layoutAddTab) {
                DomTerm.layoutAddTab(this);
                event.preventDefault();
                return;
            }
            break;
        case 86: // Control-Shift-V
            // Google Chrome doesn't allow execCommand("paste") but Ctrl-Shift-V
            // works by default.  In Firefox, it's the other way round.
            if (this.doPaste())
                event.preventDefault();
            return;
        }
    }
    if (this._currentlyPagingOrPaused()) {
        this._pageKeyHandler(event, key, false);
        return;
    }
    if (this._muxMode) {
        this._muxKeyHandler(event, key, false);
        return;
    }
    this._adjustPauseLimit(this.outputContainer);
    if (this.isLineEditing()) {
        if (! this.useStyledCaret())
            this.maybeFocus();
        if (key == 13) {
            event.preventDefault();
            if (event.shiftKey) {
                this.pasteText("\n");
            } else {
                this.processEnter();
                if (this._lineEditingMode == 0 && this.autoLazyCheckInferior) {
                    this._clientWantsEditing = 0;
                    this._usingDoLineEdit = this.useDoLineEdit;
                }
            }
        }
        else if (event.ctrlKey
                 && (key == 67 // ctrl-C
                     || key == 90 // ctrl-Z
                     || (key == 68 // ctrl-D
                         && this.grabInput(this.inputLine).length == 0))) {
            event.preventDefault();
            if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
                this._clientWantsEditing = 0;
            this.reportKeyEvent(64 - key, // ctrl-C -> -3; ctrl-D -> -4
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
        } else if (this._usingDoLineEdit) {
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
            if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
                this.reportKeyEvent(key, str);
            else
                this.processInputCharacters(str);
        }
    }
};

DomTerm.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" t:"+this.grabInput(this.inputLine)+" inputLine:"+this.inputLine);
    if (! this._isOurEvent(event))
        return;
    if (this._currentlyPagingOrPaused()) {
        this._pageKeyHandler(event, key, true);
        return;
    }
    if (this._muxMode) {
        this._muxKeyHandler(event, key, true);
        return;
    }
    this._adjustPauseLimit(this.outputContainer);
    if (this.isLineEditing()) {
        if (this._usingDoLineEdit) {
            event.preventDefault();
            var str = String.fromCharCode(key);
            this.doLineEdit(-key, str);
        }
    } else {
        if (event.which !== 0
            && key != 8
            && ! event.ctrlKey) {
            var str = String.fromCharCode(key);
            if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
                this.reportKeyEvent(-key, str);
            else
                this.processInputCharacters(str);
            event.preventDefault();
        }
    }
};

DomTerm.prototype.inputHandler = function(event) {
    if (this.verbosity >= 2)
        this.log("input "+event+ " which:"+event.which+" data:'"+event.data);
    if (event.target == this.inputLine && ! this.isLineEditing()
        && this.inputLine != this._deferredForDeletion) {
        var text = this.grabInput(this.inputLine);
        var ch = this.inputLine.firstChild;
        while (ch != null) {
            var next = ch.nextSibling;
            this.inputLine.removeChild(ch);
            ch = next;
        }
        this.reportText(text, null);
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
    if (this.currentAbsLine >= 0
        && this.currentAbsLine >= nlines)
        error("bad currentAbsLine");
    var isSavedSession = this.isSavedSession();
    if ((this.outputBefore
         && this.outputBefore.parentNode != this.outputContainer)
        || (! isSavedSession && this.outputContainer.parentNode == null))
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
            if (this.currentAbsLine >= 0)
                if (this.currentAbsLine != iend)
                    error("bad currentAbsLine");
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
if (typeof exports === "object")
    module.exports = DomTerm;

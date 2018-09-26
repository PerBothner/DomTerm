/** @license Copyright (c) 2015, 2016, 2017, 2018 Per Bothner.
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

if (typeof WcWidth == "undefined" && typeof require !== "undefined")
    var WcWidth = require("./wcwidth.js");

if (typeof browserKeymap == "undefined" && typeof require !== "undefined")
    var browserKeymap = require("./browserkeymap.js");

DomTerm.DEFAULT_CARET_STYLE = 1; // blinking-block
DomTerm.INFO_TIMEOUT = 800;

/** @constructor */

function DomTerm(name, topNode) {
    // A unique name (the "session-name") for this DomTerm instance.
    // Generated names have the format:  name + "__" + something.
    this.name = name;

    // Options/state that should be saved/restored on detach/attach.
    // Restricted to properties that are JSON-serializable.
    // WORK IN PROGRESS
    var sstate = {};
    this.sstate = sstate;

    this._updateTimer = null;

    sstate.windowName = null;
    sstate.windowTitle = null;
    sstate.iconName = null;
    sstate.lastWorkingPath = null;
    sstate.sessionNumber = -1;
    sstate.sessionNameUnique = false;
    this.windowNumber = -1;
    this._settingsCounterInstance = -1;
    
    // Input lines that have not been processed yet.
    // In some modes we support enhanced type-ahead: Input lines are queued
    // up and only released when requested.  This allows output from an
    // earlier command, as well as prompt text for a later command, to
    // be inserted before a later input-line.
    this.pendingInput = null;

    this._deferredLinebreaksStart = -1;

    this.lineIdCounter = 0; // FIXME temporary debugging

    sstate.insertMode = false;
    // If non-zero, treat "\n" as "\r\n".
    // Bit 1 controls output; bit 2 controls input (handling of Enter key).
    sstate.automaticNewlineMode = 0;

    // How are typed characters processed?
    // -1: character mode (each character/keystroke sent immediately to process)
    // 1: line mode (local editing, sent to process when Enter typed).
    // 0: auto mode (either line and character depending on _clientWantsEditing)
    this._lineEditingMode = 0;
    // 1: client/inferior is in "canonical mode; 0: non-canonical mode.
    this._clientWantsEditing = 0;
    this._numericArgument = null;

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

    // User option: automatic paging enabled
    this._autoPaging = false;
    this._autoPagingTemporary = false;
    this._pauseLimit = -1;
    // number of (non-urgent) bytes received and processed
    this._receivedCount = 0;
    this._confirmedCount = 0;
    this._replayMode = false;

    this.caretStyle = DomTerm.DEFAULT_CARET_STYLE;
    this._usingSelectionCaret = false;
    this.caretStyleFromSettings = -1; // style.caret from settings.ini
    sstate.caretStyleFromCharSeq = -1; // caret from escape sequence
    sstate.showCaret = true;

    this.verbosity = 0;

    // Use the doLineEdit function when isLineEditing().
    // True if a client performs echo on lines sent to it.
    // In that case, when isLineEditing(), when a completed
    // input line is sent to the client, it gets echoed by the client.
    // Hence we get two copies of each input line.
    // If this setting is true, we clear the contents of the input line
    // before the client echo.
    // If isLineEditing() is false, the client is always responsible
    // for echo, so this setting is ignored in that case.
    this.clientDoesEcho = true;
    // True if pty in ECHO mode
    this._clientPtyEcho = true;
    // True if EXTPROC tty flag is set. (Linux-only)
    this._clientPtyExtProc = false;

    // Used to implement clientDoesEcho handling.
    this._deferredForDeletion = null;
    this.deferredForDeletionTimeout = 2000;
    // this.passwordHideChar = "\u2022"; // Bullet = used by Chrome
    this.passwordHideChar = "\u25CF"; // Black circle - used by Firefox/IE
    this.passwordShowCharTimeout = 800;

    this.topNode = null;

    // ??? FIXME do we want to get rid of this? at least rename it
    // The <div class='interaction'> that is either the main or the
    // alternate screen buffer.  Same as _currentBufferNode()
    this.initial = null;

    this._displayInfoWidget = null;
    this._displayInfoShowing = false;
    this._displaySizePendingTimeouts = 0;
    this.modeLineGenerator = null;

    this._miscOptions = {};

    // Used if needed to add extra space at the bottom, for proper scrolling.
    // See note in eraseDisplay.
    this._vspacer = null;
    this.scrollOnKeystroke = true;
    this._usingScrollBar = false;
    this._disableScrollOnOutput = false;

    // Current line number, 0-origin, relative to start topNode
    // -1 if unknown. */
    this.currentAbsLine = -1;

    // Current column number, 0-origin
    // -1 if unknown. */
    this.currentCursorColumn = -1;

    this.rightMarginWidth = 0;

    // See https://stackoverflow.com/questions/9847580/how-to-detect-safari-chrome-ie-firefox-and-opera-browser/9851769
    // Internet Explorer 6-11
    var isIE = /*@cc_on!@*/false || !!document.documentMode;
    // Edge 20+
    var isEdge = !isIE && !!window.StyleMedia;

    this._useTabCharInDom = !isIE && !isEdge;

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
    this.parameters = new Array();
    this._savedControlState = null;

    // The output position (cursor) - insert output before this node.
    // If null, append output to the end of the output container's children.
    /** @type {Node|null} */
    this.outputBefore = null;

    // The parent node of the output position.
    // New output is by default inserted into this Node,
    // at the position indicated by outputBefore.
    /** @type {Node|null} */
    this.outputContainer = null;

    // this is a small (0 or 1 characters) span for the text caret.
    // When line-editing this is the *input* caret;
    // output is inserted at (outputContainer,outputBefore)
    this._caretNode = null;
    // When line-editing this is the actively edited line,
    // that has not yet been sent to the process.
    // In this case _caretSpan is required to be within _inputLine.
    this._inputLine = null;

    this._miniBuffer = null;
    this._searchMode = false;

    // True if _inputLine should move with outputBefore.
    this.inputFollowsOutput = true;

    this.inputLineNumber = 0;

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

    sstate.applicationCursorKeysMode = false;
    sstate.originMode = false;
    // (wraparoundMode & 2) if wraparound enabled
    // (wraparoundMode & 1) if reverse wraparound should also be enabled
    sstate.wraparoundMode = 2;
    sstate.bracketedPasteMode = false;

    // One of: 0 (no mouse handling); 9 (X10); 1000 (VT200);
    //   1001 (VT200_HIGHLIGHT); 1002 (BTN_EVENT); 1003 (ANY_EVENT)
    sstate.mouseMode = 0;

    // How mouse coordinates are encoded in the response:
    // 0 - old single-byte; 1005 (UTF8-EXT); 1006 (SGR_EXT); 1015 (URXVT_EXT)
    sstate.mouseCoordEncoding = 0;

    sstate.sendFocus = false;

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
    this.historySearchStart = -1;
    this.historySearchForwards = false;
    this.historySearchSaved = "";
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

    // As reported from backend;
    // 0: Not the only window
    // 1: this is the only window of the session, detach not set
    // 2: this is the only window of the session, detach set
    this._detachSaveNeeded = 1;

    if (topNode)
        this.initializeTerminal(topNode);
    var dt = this;
    this._showHideEventHandler =
        function(evt) { dt._showHideHandler(evt); };
    this._updateDisplay = function() {
        dt._updateTimer = null;
        dt._breakDeferredLines();
        dt._checkSpacer();
        // FIXME only if "scrollWanted"
        if (dt._pagingMode == 0)
            dt._scrollIfNeeded();
        dt._restoreInputLine();
    };
    this._unforceWidthInColumns =
        function(evt) {
            dt.forceWidthInColumns(-1);
            window.removeEventListener("resize",
                                       dt._unforceWidthInColumns, true);
        };
    this._mouseEventHandler =
        function(evt) { dt._mouseHandler(evt); };
    this._mouseEnterHandler =
        function(event) {
            var ref;
            if (dt.sstate.mouseMode == 0
                && (ref = event.target.getAttribute("href"))) {
                dt._displayInfoWithTimeout(DomTerm.escapeText(ref));
            }
        };
    this.wcwidth = new WcWidth();
}

DomTerm.makeElement = function(parent, name) {
    var topNode = document.createElement("div");
    topNode.setAttribute("class", "domterm");
    topNode.setAttribute("id", name);
    if (parent)
        parent.appendChild(topNode);
    return topNode;
}

DomTerm._instanceCounter = 0;
DomTerm.layoutManager = null;
// These are used to delimit "out-of-bound" urgent messages.
DomTerm.URGENT_BEGIN1 = 19; // '\023' - device control 3
DomTerm.URGENT_BEGIN2 = 22; // '\026' - SYN synchronous idle
DomTerm.URGENT_END = 20; // \024' - device control 4
DomTerm.URGENT_COUNTED = 21;

DomTerm.freshName = function() {
    return "domterm-"+(++DomTerm._instanceCounter);
}

DomTerm._deleteDataTail = function(text, count) {
    if (count == 0)
        return;
    let dlen = text.length;
    if (count == dlen)
        text.parentNode.removeChild(text);
    else
        text.deleteData(dlen-count, count);
}

DomTerm._deleteData = function(text, start, count) {
    if (count == 0)
        return;
    let dlen = text.length;
    if (count == dlen)
        text.parentNode.removeChild(text);
    else
        text.deleteData(start, count);
}

DomTerm.prototype.eofSeen = function() {
    this.historySave();
    this.history.length = 0;
    DomTerm.closeFromEof(this);
};

DomTerm.detach = function(dt=DomTerm.focusedTerm) {
    if (dt) {
        dt.reportEvent("DETACH", "");
        if (dt._detachSaveNeeded == 1)
            dt._detachSaveNeeded = 2;
        dt.close();
    }
};

DomTerm.saveWindowContents = function(dt=DomTerm.focusedTerm) {
    if (!dt)
        return;
    dt._restoreInputLine();
    var rcount = dt._savedControlState ? dt._savedControlState.receivedCount
        : dt._receivedCount;
    var data =
        rcount
        + ',{"sstate":'+JSON.stringify(dt.sstate);
    if (dt.usingAlternateScreenBuffer)
        data += ', "alternateBuffer":'+dt.usingAlternateScreenBuffer;
    data += ', "html":'
        + JSON.stringify(dt.getAsHTML(false))
        +'}';
    dt.reportEvent("WINDOW-CONTENTS", data);
}

DomTerm.closeFromEof = function(dt) {
    dt.close();
}

DomTerm.windowClose = function() {
    window.close();
}

DomTerm.setTitle = function(title) {
    document.title = title;
}

DomTerm.newPane = function(paneOp, sessionPid, dt) {
    if (DomTerm.layoutAddPane)
        DomTerm.layoutAddPane(dt, paneOp, sessionPid);
}

DomTerm.prototype.close = function() {
    if (this._detachSaveNeeded == 2) {
        DomTerm.saveWindowContents(this);
    }
    if (DomTerm.layoutManager && DomTerm.domTermLayoutClose)
        DomTerm.domTermLayoutClose(this, DomTerm.domTermToLayoutItem(this));
    else
        DomTerm.windowClose();
};

DomTerm.prototype.startCommandGroup = function(parentKey, pushing=0) {
    var container = this.outputContainer;
    var containerTag = container.tagName;
    if ((containerTag == "PRE" || containerTag == "P"
         || (containerTag == "DIV"
             && container.classList.contains("domterm-pre")))
        && container.firstChild == this.outputBefore
        && (this._currentCommandGroup == null
            || this._currentCommandGroup.firstChild != container)) {
        var commandGroup = null;
        var oldGroup = this._currentCommandGroup;
        if (pushing >= 0) {
            commandGroup = document.createElement("div");
            commandGroup.setAttribute("class", "command-group");
            if (parentKey)
                commandGroup.setAttribute(pushing > 0 ? "group-id" : "group-parent-id", parentKey);
        }
        var oldOutput = this._currentCommandOutput;
        let prevGroup = oldGroup;
        if (pushing <= 0) {
            for (let p = oldGroup; ;  p = p.parentNode) {
                if (! (p instanceof Element)) {
                    oldGroup = null;
                    break;
                }
                if (p.classList.contains("command-group")) {
                    let gpid = p.getAttribute("group-parent-id");
                    let gid = p.getAttribute("group-id");
                    if (pushing == 0) {
                        if ((gpid || ! gid) && gpid == parentKey) {
                            oldGroup = p;
                            break;
                        }
                        if ((gid || ! gpid) && gid == parentKey) {
                            oldGroup = prevGroup;
                            break;
                        }
                    } else {
                        if (gid == parentKey) {
                            oldGroup = p;
                            break;
                        }
                    }
                    prevGroup = p;
                }
            }
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
        }
        if (pushing >= 0) {
            container.parentNode.insertBefore(commandGroup, container);
            commandGroup.appendChild(container);
        }
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
        this.sstate.continuationPromptPattern = undefined;
    }
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
    DomTerm.showFocusedTerm(term);
    if (term != null)
        term.reportEvent("FOCUSED", ""); // to server
    if (current == term)
        return;
    if (current !== null) {
        current.topNode.classList.remove("domterm-active");
        if (current.sstate.sendFocus)
            current.processResponseCharacters("\x1b[O");
    }
    if (term != null) {
        term.topNode.classList.add("domterm-active");
        if (term.sstate.sendFocus)
            term.processResponseCharacters("\x1b[I"); // to application
        DomTerm.setTitle(term.sstate.windowTitle);
        DomTerm.inputModeChanged(term, term.getInputMode());
    }
    //DomTerm.showFocusedTerm(term);
    DomTerm.focusedTerm = term;
}

// Overridden for atom-domterm
DomTerm.showFocusedTerm = function(term) {
    if (DomTerm.layoutManager) {
        var item = term ? DomTerm.domTermToLayoutItem(term) : null;
        DomTerm.showFocusedPane(item);
    }
}

DomTerm.prototype.doFocus = function() {
    DomTerm.setFocus(this);
    this.maybeFocus();
}

DomTerm.prototype.maybeFocus = function() {
    if (this.hasFocus()) {
        this.topNode.focus();
    }
}

DomTerm.prototype.hasFocus = function() {
    return DomTerm.focusedTerm == this;
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
DomTerm.SEEN_CR = 17;

// Possible values for _widthMode field of elements in lineStarts table.
// This is related to the _widthColumns field in the same elements,
// which (if not undefined) is the number of columns in the current
// (displayed) line.
DomTerm._WIDTH_MODE_NORMAL = 0;
DomTerm._WIDTH_MODE_TAB_SEEN = 1; // tab *or* pprint-node seen
DomTerm._WIDTH_MODE_VARIABLE_SEEN = 2; // HTML or variable-width font

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
    if (vspacer.dtHeight != needed) {
        if (needed > 0) {
            vspacer.style.height = needed + "px";
            vspacer.dtHeight = needed;
        } else if (vspacer.dtHeight != 0) {
            vspacer.style.height = "";
            vspacer.dtHeight = 0;
        }
    }
};

/*
DomTerm.prototype.atLineEnd = function() {
    var parent = this.outputContainer;
    var next = this.outputBefore;
    while (next == null) {
        next = parent.nextSibling;
        parent = parent.parentNode;
    }
    return next.nodeName == "SPAN" && next.getAttribute("line") == "hard";
}
*/

DomTerm.prototype.wcwidthInContext = function(ucs, context) {
    return this.wcwidth.wcwidthInContext(ucs, context);
}

DomTerm.prototype.strWidthInContext = function(str, context) {
    return this.wcwidth.strWidthInContext(str, context);
}

DomTerm.prototype.atTabStop = function(col) {
    if (col >= this._tabDefaultStart)
        if ((col & 7) == 0)
            return true;
    return this._tabsAdded && this._tabsAdded[col];
}

// Return column number following a tab at initial {@code col}.
// Ths col is the initial column, 0-origin.
// Return the column number (0-origin) after a tab.
// Default implementation assumes tabs every 8 columns.
DomTerm.prototype.nextTabCol = function(col) {
    var max = this.numColumns - 1;
    if (this._tabsAdded == null && this._tabDefaultStart == 0) {
        var r = (col & ~7) + 8;
        return r < max ? r : max;
    }
    for (var i = col; ; i++) {
        if (i >= max || this.atTabStop(i))
            return i;
    }
};

DomTerm.prototype.tabToNextStop = function(isTabChar) {
    function endsWithSpaces(str, w) {
        var len = str.length;
        if (len < w)
            return false;
        for (let i = w; i > 0; i--)
            if (str.charCodeAt(len-i) != 32)
                return false;
        return true;
    }
    var col = this.getCursorColumn();
    if (col == this.numColumns && (this.sstate.wraparoundMode & 2) != 0) {
        this.cursorLineStart(1);
        if (this.atTabStop(0))
            return true;
        col = 0;
    }
    var nextStop = this.nextTabCol(col);
    if (nextStop <= col)
        return false;
    var w = nextStop-col;
    this.cursorRight(w);
    var prev;
    if (isTabChar && this._useTabCharInDom && this.outputBefore
        && (prev = this.outputBefore.previousSibling) instanceof Text
        && endsWithSpaces(prev.data,  w)) {
        var span = this._createSpanNode();
        span.appendChild(document.createTextNode('\t'));
        // For standard tabs, we prefer to set tab-size to 8, as that
        // is preserved under re-flow.  However, with non-standard tab-stops,
        // or if the nextCol is not divisible by 8 (because we're at the
        // right column) use the actual next column.
        var typical = this._tabsAdded == null && (nextStop & 7) == 0;
        span.setAttribute('style', 'tab-size:'+(typical ? 8 : nextStop));
        this.outputContainer.insertBefore(span, this.outputBefore);
        DomTerm._deleteDataTail(prev, w);
    }
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

    for (var cur = startNode; ;) {
        if (cur == null || cur == this._vspacer)
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
                    DomTerm._deleteData(cur, 0, i+1);
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
                    DomTerm._deleteData(cur, i, dlen-i);
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
            var tag = cur.tagName.toLowerCase();
            if (cur.firstChild)
                descend = true;
            var classList = cur.classList;
            if (tag == "div"
                && (classList.contains("domterm-ruler")
                    || classList.contains("resize-sensor")
                    || classList.contains("domterm-show-info")))
                descend = false;
            else if (this.isBlockTag(tag)) {
                var hasData = false;
                var prevWasBlock = false;
                // Check to see if cur has any non-block children:
                for (var ch = cur.firstChild; ch != null; ) {
                    var next = ch.nextSibling;
                    var isBlockNode = false;
                    if (ch instanceof Text) {
                        if (prevWasBlock && ch.data.trim() == "") {
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
                    start._widthMode = DomTerm._WIDTH_MODE_NORMAL;
                    if (tag != "pre"
                        && (tag != "div"
                            || ! cur.classList.contains("domterm-pre"))) {
                        cur.classList.add("domterm-opaque");
                        descend = false;
                        start._widthMode = DomTerm._WIDTH_MODE_VARIABLE_SEEN;
                    }
                    this.lineStarts[startLine] = start;
                    this.lineEnds[startLine] = null;
                    startLine++;
                }
            } else if (tag == "span") {
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
                        start._widthMode = DomTerm._WIDTH_MODE_TAB_SEEN;
                        cur._needSectionEndNext = this._needSectionEndList;
                        this._needSectionEndList = cur;
                    }
                } else if (cls == "wc-node") {
                    descend = false;
                } else if (cls == "pprint-group") {
                    start._widthMode = DomTerm._WIDTH_MODE_TAB_SEEN;
                    this._pushPprintGroup(cur);
                }
            }
        }

        if (descend) {
            cur = cur.firstChild;
        } else {
            for (;;) {
                if (cur.nodeName == "SPAN"
                    && cur.classList.contains("pprint-group"))
                    this._popPprintGroup();
                var next = cur.nextSibling;
                if (next != null) {
                    cur = next;
                    break;
                }
                cur = cur.parentNode;
            }
        }
    }
};

DomTerm.prototype.saveCursor = function() {
    this.sstate.savedCursor = {
        line: this.getCursorLine(),
        column: this.getCursorColumn(),
        fgcolor:  this._currentStyleMap.get("color"),
        bgcolor:  this._currentStyleMap.get("background-color"),
        weight: this._currentStyleMap.get("font-weight"),
        blink: this._currentStyleMap.get("text-blink"),
        underline: this._currentStyleMap.get("text-underline"),
        reverse: this._currentStyleMap.get("reverse"),
        origin: this.sstate.originMode,
        wraparound: this.sstate.wraparoundMode,
        glevel: this._Glevel,
        charset0: this._Gcharsets[0],
        charset1: this._Gcharsets[1],
        charset2: this._Gcharsets[2],
        charset3: this._Gcharsets[3],
        charMapper: this.charMapper
    };
};

// Re-calculate alternate buffer's saveLastLine property.
DomTerm.prototype._restoreSaveLastLine = function() {
    if (this.usingAlternateScreenBuffer) {
        var line = 0;
        var dt = this;
        var altBuffer = DomTerm._currentBufferNode(this, true);
        function findAltBuffer(node) {
            if (node == altBuffer) {
                altBuffer.saveLastLine = line;
                return node;
            }
            if (node == dt.lineStarts[line])
                line++;
            return true;
        }
        this._forEachElementIn(this.topNode, findAltBuffer);
    }
}
 
DomTerm.prototype.restoreCursor = function() {
    var saved = this.sstate.savedCursor;
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
        this.sstate.originMode = saved.origin;
        this.sstate.wraparoundMode = saved.wraparound;
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
            this._setBackgroundColor(preNode,
                                     this._getBackgroundColor(this._vspacer));
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
            preNode._widthMode = DomTerm._WIDTH_MODE_NORMAL;
            preNode._widthColumns = 0;
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
            var handled = false;
            if (current && current.nodeName == "SPAN") {
                var tcol = -1;
                var st = current.getAttribute("style");
                if (st && st.startsWith("tab-size:")) {
                    tcol = Number(st.substring(9));
                }
                if (! isNaN(tcol) && tcol > 0) {
                    tcol = (column / tcol) * tcol + tcol;
                    if (goalColumn >= tcol) {
                        column = tcol;
                        handled = true;
                    } else {
                        var text = document.createTextNode(DomTerm.makeSpaces(tcol-column));
                        parent.insertBefore(text, current);
                        parent.removeChild(current);
                        current = text;
                    }
                }
            }
            if (handled) {
            } else if (current == lineEnd) {
                if (addSpaceAsNeeded) {
                    var str = DomTerm.makeSpaces(goalColumn-column);
                    var prev = current.previousSibling;
                    // Motivation: handle '\t' while inside <span std="error">.
                    // (Java stacktraces by default prints with tabs.)
                    if (prev && prev.nodeName == "SPAN"
                        && prev.getAttribute("std")
                        && this._isAnAncestor(this.outputContainer,
                                              current.previousSibling)) {
                        parent = current.previousSibling;
                        current = null;
                    }
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
                    if (ch == 9) {
                        // handle TAB *not* in a <span style='tab-size:pos'>
                        var tcol = this.nextTabCol(column);
                        if (goalColumn >= tcol)
                            column = tcol;
                        else {
                            var w = tcol - column;
                            tnode.replaceData(i, 1, DomTerm.makeSpaces(w));
                            tlen += w - 1;
                            i--;
                        }
                    } else if (ch == 10 || ch == 13 || ch == 12) { // One of "\n\r\f"
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
    var oldBefore = this.outputBefore;
    this.outputContainer = parent;
    this.outputBefore = current;
    if (oldBefore != current && oldBefore instanceof Text
        && oldBefore.previousSibling instanceof Text)
        this._normalize1(oldBefore.previousSibling);
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

DomTerm.prototype._showPassword = function() {
    let input = this._inputLine;
    if (input && input.classList.contains("noecho")
        && this.sstate.hiddenText) {
        DomTerm._replaceTextContents(input, this.sstate.hiddenText);
        this.sstate.hiddenText = undefined;
    }
}

DomTerm.prototype._hidePassword = function() {
    let input = this._inputLine;
    if (input && input.classList.contains("noecho")) {
        let ctext = this.sstate.hiddenText || input.textContent;
        let clen =  DomTerm._countCodePoints(ctext);
        DomTerm._replaceTextContents(input, this.passwordHideChar.repeat(clen));
        this.sstate.hiddenText = ctext;
    }
}

// "Normalize" caret by moving caret text to following node.
// Doesn't actually remove the _caretNode node, for that use _removeInputLine.
// FIXME maybe rename to _removeCaretText
DomTerm.prototype._removeCaret = function(normalize=true) {
    var caretNode = this._caretNode;
    this._showPassword();
    if (caretNode && caretNode.getAttribute("caret")) {
        var child = caretNode.firstChild;
        caretNode.removeAttribute("caret");
        if (child instanceof Text) {
            var text = this._followingText(caretNode.nextSibling);
            if (normalize && text instanceof Text) {
                text.insertData(0, child.data);
                caretNode.removeChild(child);
            } else {
                caretNode.removeChild(child);
                caretNode.parentNode.insertBefore(child, caretNode.nextSibling);
            }
        }
    }
}

DomTerm.prototype._removeInputFromLineTable = function() {
    let startLine = this.getAbsCursorLine();
    let seenAfter = false;
    function removeInputLineBreaks(lineStart, lineno) {
        if (lineStart.getAttribute("line"))
            return true;
        seenAfter = true;
        if (seenAfter)
            return false;
    }
    this._adjustLines(startLine, removeInputLineBreaks);
}

DomTerm.prototype._removeInputLine = function() {
    if (this.inputFollowsOutput) {
        this._removeCaret();
        var caretParent = this._caretNode.parentNode;
        if (caretParent != null) {
            // FIXME Is this needed/desirable? maybe just _removeCaret
            // That would avoid need for _restoreCaretNode.
            if (this.outputBefore==this._caretNode)
                this.outputBefore = this.outputBefore.nextSibling;
            caretParent.removeChild(this._caretNode);
        }
    }
};

DomTerm.prototype.setCaretStyle = function(style) {
    if (style == DomTerm.DEFAULT_CARET_STYLE) {
        if (this.caretStyleFromSettings >= 0)
            style = this.caretStyleFromSettings;
        this.sstate.caretStyleFromCharSeq = -1;
    } else
        this.sstate.caretStyleFromCharSeq = style;
    if (style < 5 && this.caretStyle >= 5) {
        let sel = document.getSelection();
        if (sel.focusNode == this._caretNode
            && sel.anchorNode == this._caretNode
            && sel.focusOffset == 0 && sel.anchorOffset == 0) {
            sel.removeAllRanges();
        }
    }
    this._caretNode.removeAttribute("caret");
    this.caretStyle = style;
};

DomTerm.prototype.useStyledCaret = function() {
    return this.caretStyle < 5 && ! this._usingSelectionCaret
        && this.sstate.showCaret;
};

DomTerm.prototype.isLineEditing = function() {
    return this._lineEditingMode + this._clientWantsEditing > 0
        || (this._clientPtyExtProc + this._clientPtyEcho
            + this._clientWantsEditing == 3)
        || this._composing > 0;
}

/** Number of Unicode code points in string */
DomTerm._countCodePoints = function(str) {
    let n = 0;
    for (let i = str.length; --i >= 0; ) {
        let ch = str.charCodeAt(i);
        if (ch < 0xDC00 || ch > 0xDFFF) // if not low/trailing surrogate
            n++;
    }
    return n;
}

/** Find index in string after skipping specified Unicode code points */
DomTerm._indexCodePoint = function(str, index) {
    let len = str.length;
    let j = 0;
    for (let i = 0; ; i++) {
        if (j == index)
            return i;
        if (i >= len)
            return -1;
        let ch = str.charCodeAt(i);
        if (ch < 0xDC00 || ch > 0xDFFF) // if not low/trailing surrogate
            j++;
    }
}

DomTerm._replaceTextContents = function(el, text) {
    function replace(n) {
        let d = n.data;
        let dlen = DomTerm._indexCodePoint(text, DomTerm._countCodePoints(d));
        if (dlen < 0) {
            console.log("error in _replaceTextContents");
            return el;
        }
        n.data = text.substring(0, dlen);
        text = text.substring(dlen);
        return null;
    }
    DomTerm._forEachTextIn(el, replace);
};

DomTerm.prototype._restoreCaret = function() {
    this._restoreCaretNode();
    let cparent = this._caretNode.parentNode;
    if (! this._suppressHidePassword)
        this._hidePassword();
    if (this.useStyledCaret()) {
        if (! this._caretNode.getAttribute("caret")
            && (! (this._caretNode.firstChild instanceof Text)
                || this._caretNode.firstChild.data.length == 0)) {
            var text = this._followingText(this._caretNode);
            if (text instanceof Text && text.data.length > 0) {
                var tdata = text.data;
                var sz = 1;
                if (tdata.length >= 2) {
                    var ch0 = tdata.charCodeAt(0);
                    var ch1 = tdata.charCodeAt(1);
                    if (ch0 >= 0xD800 && ch0 <= 0xDBFF
                        && ch1 >= 0xDC00 && ch1 <= 0xDFFF)
                        sz = 2;
                }
                var ch = tdata.substring(0, sz);
                this._caretNode.appendChild(document.createTextNode(ch));
                let ptext = text.parentNode;
                DomTerm._deleteData(text, 0, sz);
                this._caretNode.removeAttribute("value");
                if (this._caretNode.parentNode == this._deferredForDeletion
                    && ptext != this._deferredForDeletion)
                    this._deferredForDeletion.textAfter += ch;
            }
            else
                this._caretNode.setAttribute("value", " ");
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
        this._caretNode.setAttribute("caret", cstyle);
    }
    else {
        let sel = document.getSelection();
        if (sel.isCollapsed) {
            if (this.sstate.showCaret)
                sel.collapse(this._caretNode, 0);
            else
                sel.removeAllRanges();
        }
    }
}

DomTerm.prototype._restoreCaretNode = function() {
    if (this._caretNode.parentNode == null) {
        this.outputContainer.insertBefore(this._caretNode, this.outputBefore);
        this.outputBefore = this._caretNode;
    }
}

DomTerm.prototype._restoreInputLine = function(caretToo = true) {
    let inputLine = this.isLineEditing() ? this._inputLine : this._caretNode;
    if (this.inputFollowsOutput && inputLine != null) {
        let lineno;
        if (this.isLineEditing()) {
            lineno = this.getAbsCursorLine();
            inputLine.startLineNumber = lineno;
        }
        if (this.outputBefore != inputLine && this.outputContainer != inputLine
           && this.outputContainer.parentNode != inputLine) {
            this.outputContainer.insertBefore(inputLine, this.outputBefore);
            this.outputBefore = inputLine;
            if (this._pagingMode == 0)
                this.maybeFocus();
            if (this.isLineEditing()) {
                let dt = this;
                // Takes time proportional to the number of lines in _inputLine
                // times lines below the input.  Both are likely to be small.
                this._forEachElementIn(inputLine,
                                       function (el) {
                                           if (el.nodeName == "SPAN"
                                               && el.getAttribute("Line")=="hard") {
                                               DomTerm._insertIntoLines(dt, el, lineno++);
                                               return false;
                                           }
                                           return true;
                                       });
            }
        }
    }
    if (caretToo)
        this._restoreCaret();
}

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
        if (this.sstate.insertMode) {
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
    else if (before == this.numColumns && (this.sstate.wraparoundMode != 3))
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
            DomTerm._deleteDataTail(prev, tcount);
            count -= tcols;

            var following = this.outputBefore;
            var input = this._inputLine != null ? this._inputLine
                : this._caretNode;
            var inputOk = input == following
                && this.inputFollowsOutput
                && input.firstChild == null;
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

DomTerm.prototype._getStdElement = function(element=this.outputContainer) {
    for (var stdElement = element;
         stdElement instanceof Element;
         stdElement = stdElement.parentNode) {
        if (stdElement.getAttribute("std"))
            return stdElement;
    }
    return null;
};
DomTerm.prototype._getStdMode = function(element=this.outputContainer) {
    let el = this._getStdElement(element);
    return el == null ? null : el.getAttribute("std");
}

DomTerm.prototype._pushStdMode = function(styleValue) {
    if (styleValue == null
        && this._currentStyleMap.get("std")) {
        this._pushStyle("std", null);
        this._adjustStyle();
        return;
    }
    var stdElement = this._getStdElement();
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
    var inStyleSpan = parentSpan.classList.contains("term-style");
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
    if (inStyleSpan) {
        this._popStyleSpan();
    }
    if (this._currentStyleMap.size != 0 || needBackground) {
        var styleSpan = this._createSpanNode();
        styleSpan.setAttribute("class", "term-style");
        var styleAttr = null;
        var decoration = null;
        var stdKind = null;
        var reverse = false;
        var fgcolor = null;
        var bgcolor = null;
        for (var key of this._currentStyleMap.keys()) {
            var value = this._currentStyleMap.get(key);
            switch (key) {
            case "std":
                stdKind = value;
                break;
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
                var tmp = bgcolor ? bgcolor : "var(--background-color)";
                bgcolor = fgcolor ? fgcolor : "var(--foreground-color)";
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
            bgcolor = "var(--background-color)";
        if (bgcolor) {
            var bgstyle = "background-color: "+bgcolor;
            styleAttr = styleAttr ? styleAttr+";"+bgstyle : bgstyle;
        }
        if (styleAttr)
            styleSpan.setAttribute("style", styleAttr);
        if (decoration)
            styleSpan.setAttribute("text-decoration", decoration);
        if (stdKind)
            styleSpan.setAttribute("std", stdKind);

        var previous = this.outputBefore ? this.outputBefore.previousSibling
            : this.outputContainer.lastChild;
        if (previous instanceof Element
            && previous.classList.contains("term-style")
            && DomTerm._styleSpansMatch(styleSpan, previous)) {
            this.outputBefore = null;
            styleSpan = previous;
        } else {
            if (this.outputBefore instanceof Element
                && this.outputBefore.classList.contains("term-style")
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
        this._setBackgroundColor(preNode, this._currentStyleBackground());
        var newLine = this._createLineNode("hard", "\n");
        preNode.appendChild(newLine);
        parent.insertBefore(preNode, oldStart);
        preNode._widthMode = DomTerm._WIDTH_MODE_NORMAL;
        preNode._widthColumns = 0;
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

DomTerm._getAncestorDomTerm = function(node) {
    for (let p = node; p instanceof Element; p = p.parentNode) {
        if (p.nodeName=="DIV" && p.classList.contains("domterm"))
            return p.terminal;
    }
    return null;
}

DomTerm._isInElement = function(node, name="A") {
    for (let p = node; p instanceof Element; p = p.parentNode) {
        let ptag = p.nodeName;
        if (ptag == name)
            return p;
        if (ptag == "DIV" && name=="A")
            break;
    }
}

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
    var absLine = this.getAbsCursorLine();
    if (absLine > 0)
        this._clearWrap(absLine-1);
    var start = this.lineStarts[absLine];
    var startPrevious = start.previousSibling;
    var startParent = start.parentNode;
    var end;
    var all = count < 0 || absLine+count >= this.lineStarts.length;
    if (all) {
        end = null;
        all = false;
        count = this.lineStarts.length - absLine;
    } else {
        this._clearWrap(absLine+count-1);
        end = this.lineStarts[absLine+count];
    }
    var cur = this.outputBefore;
    var parent = this.outputContainer;
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
    if (all) { // remove - never done FIXME
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
};

DomTerm.prototype._insertLinesAt = function(count, line, regionBottom) {
    var avail = regionBottom - line;
    if (count > avail)
        count = avail;
    if (count <= 0)
        return;
    this.moveToAbs(regionBottom+this.homeLine-count, 0, true);
    this.deleteLinesIgnoreScroll(count);
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
    this.deleteLinesIgnoreScroll(count);
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
    n.setAttribute("class", "domterm-pre");
    return n;
};

DomTerm.prototype._getOuterPre = function(node) {
    for (var v = node; v != null && v != this.topNode; v = v.parentNode) {
        if (v.classList.contains("domterm-pre"))
            return v;
    }
    return null;
}

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
 
DomTerm._currentBufferNode =
    function(dt, alternate=dt.usingAlternateScreenBuffer) {
    var bnode = null;
    for (let node = dt.topNode.firstChild; node != null;
         node = node.nextSibling) {
        if (node.nodeName == 'DIV'
            && node.getAttribute('class') == 'interaction') {
            bnode = node;
            if (! alternate)
                break;
        }
    }
    return bnode;
}

DomTerm.prototype.setAlternateScreenBuffer = function(val) {
    if (this.usingAlternateScreenBuffer != val) {
        this._setRegionTB(0, -1);
        if (val) {
            var line = this.getCursorLine();
            var col = this.getCursorColumn();
            // FIXME should scroll top of new buffer to top of window.
            var nextLine = this.lineEnds.length;
            this.initial.setAttribute("buffer", "main");
            var bufNode = this._createBuffer(this._altBufferName, "alternate");
            this.topNode.insertBefore(bufNode, this._vspacer);
            var homeOffset = DomTerm._homeLineOffset(this);
            var homeNode = this.lineStarts[this.homeLine - homeOffset];
            homeNode.setAttribute("home-line", homeOffset);
            bufNode.saveLastLine = nextLine;
            this.sstate.savedCursorMain = this.sstate.savedCursor;
            this.sstate.savedCursor = undefined;
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
            this.initial = DomTerm._currentBufferNode(this, false);
            this.initial.setAttribute("buffer", "main only");
            this.lineStarts.length = bufNode.saveLastLine;
            this.lineEnds.length = bufNode.saveLastLine;
            var homeNode = null;
            var homeOffset = -1;
            this._forEachElementIn(this.initial,
                                   function(node) {
                                       var offset = node.getAttribute('home-line');
                                       if (offset) {
                                           homeNode = node;
                                           homeOffset = 0 + parseInt(offset, 10);
                                           return node;
                                       }
                                       return true;
                                   });
            this.homeLine = this._computeHomeLine(homeNode, homeOffset, false);
            this.sstate.savedCursor = this.sstate.savedCursorMain;
            this.sstate.savedCursorMain = undefined;
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
    return node instanceof Element
        && this.isBlockTag(node.tagName.toLowerCase());
};

DomTerm.prototype.isBlockTag = function(tag) { // lowercase tag
    var einfo = DomTerm._elementInfo(tag, null);
    return (einfo & DomTerm._ELEMENT_KIND_INLINE) == 0;
}

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
    topNode.contentEditable = true;
    topNode.spellcheck = false;
    topNode.terminal = this;

    var helperNode = this._createPreNode();
    helperNode.setAttribute("style", "position: absolute; visibility: hidden");
    helperNode.classList.add("domterm-ruler");
    topNode.insertBefore(helperNode, topNode.firstChild);
    var rulerNode = document.createElement("span");
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
    // Should be zero - support for topNode.offsetLeft!=0 is broken
    this._topLeft = dt.topNode.offsetLeft;

    topNode.addEventListener('wheel',
                             function(e) { dt._disableScrollOnOutput = true; },
                             {passive: true});
    this.topNode.addEventListener("mousedown", this._mouseEventHandler, true);
    this.topNode.addEventListener("mouseup", this._mouseEventHandler, true);

    this.topNode.addEventListener("contextmenu",
                                  function(e) {
                                      if (dt.sstate.mouseMode != 0
                                          || (DomTerm.showContextMenu
                                              && DomTerm.showContextMenu(dt, e, DomTerm._contextLink?"A":"")))
                                          e.preventDefault();
                                  }, false);

    document.addEventListener("selectionchange", function() {
        let sel = document.getSelection();
        let point = sel.isCollapsed;
        dt._usingSelectionCaret = ! point && dt.isLineEditing();
        if (dt.isLineEditing() && dt._inputLine != null
            && sel.focusNode != null
            && (sel.focusNode != dt._caretNode || sel.focusOffset != 0)) {
            dt._restoreInputLine(false);
            let r = new Range();
            r.selectNodeContents(dt._inputLine);
            if (r.comparePoint(sel.focusNode, sel.focusOffset) == 0) {
                if (dt._caretNode.firstChild == sel.focusNode) {
                    console.log("handle _caretNode.firstChild == sel.focusNode");
                }
                // The focusNode may the text child of dt._caretNode.
                // In that case save it before calling _removeCaret.
                let focusNode = sel.focusNode;
                let focusOffset = sel.focusOffset;
                dt._removeCaret(false);
                if (focusNode == dt._caretNode)
                    r.setStartAfter(focusNode);
                else
                    r.setStart(focusNode, focusOffset);
                r.insertNode(dt._caretNode);
                dt._inputLine.normalize();
                // same position, but "normalized"
                // Chrome likes this better, after Shift-Left when no selection
                if (point)
                    sel.collapse(dt._caretNode, 0);
                else
                    sel.extend(dt._caretNode, 0);
            } else
                dt._usingSelectionCaret = false;
        }
        if (point) {
            dt._restoreCaret();
        }
    });

    /*
    function docMouseDown(event) {
        if (! dt._isAnAncestor(event.target, dt.topNode)
            && DomTerm.focusedTerm === dt) {
            DomTerm.setFocus(null);
        }
    }
    document.addEventListener("mousedown", docMouseDown, false);
    */
    if (! DomTerm._userStyleSet)
        this.loadStyleSheet("user", "");

    this._mainBufferName = this.makeId("main")
    this._altBufferName = this.makeId("alternate")

    var mainNode = this._createBuffer(this._mainBufferName, "main only");
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
};

/*
DomTerm.prototype._findHomeLine = function(bufNode) {
    this._forEachElementIn(bufNode,
                           function(node) {
                               var offset = node.getAttribute('home-line');
                               return offset != null ? node : null;
                           });
}
*/

DomTerm.prototype._computeHomeLine = function(home_node, home_offset,
                                             alternate) {
    var line = -1;
    var home_line = -1;
    if (home_node) {
        for (var l = this.lineStarts.length; --l >= 0; ) {
            if (this.lineStarts[l] == home_node) {
                home_line = l;
                line = l + home_offset;
                break;
            }
        }
    }
    if (line < 0) {
        line = alternate ? this.initial.saveLastLine : 0;
    }
    var minHome = this.lineStarts.length - this.numRows;
    return line <= minHome ? minHome
        : line < this.lineStarts.length ? line : home_line;
}

DomTerm._checkStyleResize = function(dt) { dt.resizeHandler(); }

DomTerm.prototype.resizeHandler = function() {
    var dt = this;
    // FIXME we want the resize-sensor to be a child of helperNode
    if (dt.verbosity > 0)
        dt.log("ResizeSensor called "+dt.name); 
    var oldWidth = dt.availWidth;
    dt.measureWindow();
    dt._displaySizeInfoWithTimeout();

    var home_offset = DomTerm._homeLineOffset(dt);
    var home_node = dt.lineStarts[dt.homeLine - home_offset];
    if (dt.availWidth != oldWidth && dt.availWidth > 0) {
        dt._removeCaret();
        dt._breakAllLines();
        dt._restoreSaveLastLine();
        dt.resetCursorCache();
    }
    dt.homeLine = dt._computeHomeLine(home_node, home_offset,
                                     dt.usingAlternateScreenBuffer);
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
        if (! dt._displayInfoShowing) {
            dt._displaySizePendingTimeouts = 0;
        } else if (--dt._displaySizePendingTimeouts == 0) {
            dt._updatePagerInfo();
        }
    };
    setTimeout(clear, DomTerm.INFO_TIMEOUT);
};

DomTerm.prototype._clearInfoMessage = function() {
    this._displayInfoMessage(null);
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

DomTerm.prototype._displayInfoMessage = function(contents) {
    DomTerm.displayInfoMessage(contents, this);
    this._displayInfoShowing = contents != null;
    if (contents == null)
        this._displaySizePendingTimeouts = 0;
}

/** Display contents in _displayInfoWidget., or clear if null.
 * The contents is updated with innerHTML, so "<>&" must be escaped. */
DomTerm.displayInfoInWidget = function(contents, dt) {
    var div = dt._displayInfoWidget;
    if (contents == null) {
        if (div != null) {
            div.parentNode.removeChild(div);
            dt._displayInfoWidget = null;
        }
        return;
    }
    if (div == null) {
        div = document.createElement("div");
        div.setAttribute("class", "domterm-show-info");
        dt.topNode.insertBefore(div, dt.topNode.firstChild);
        dt._displayInfoWidget = div;
    }
    div.innerHTML = contents;
};

/** Display contents using displayInfoInWidget or something equivalent. */
DomTerm.displayInfoMessage = DomTerm.displayInfoInWidget;

DomTerm.prototype.showMiniBuffer = function(prefix, postfix) {
    DomTerm.displayInfoInWidget(prefix, this);
    let miniBuffer = this._createSpanNode();
    miniBuffer.classList.add("editing");
    miniBuffer.setAttribute("std", "input");
    this._miniBuffer = miniBuffer;
    var div = this._displayInfoWidget;
    div.appendChild(miniBuffer);
    div.insertAdjacentHTML("beforeend", postfix);
    document.getSelection().collapse(miniBuffer, 0);
    miniBuffer.contentEditable = true;
    div.contentEditable = false;
}

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

    var caretNode = this._createSpanNode();
    this._caretNode = caretNode;
    caretNode.setAttribute("std", "caret");
    caretNode.contentEditable = true;
    caretNode.spellcheck = false;
    this.insertNode(caretNode);
    this.outputBefore = caretNode;
    this.pendingInput = caretNode;

    var dt = this;
    topNode.addEventListener("keydown",
                             function(e) { dt.keyDownHandler(e) }, false);
    topNode.addEventListener("keypress",
                             function(e) { dt.keyPressHandler(e) }, false);
    topNode.addEventListener("input",
      function(e) { dt.inputHandler(e); }, true);
    if (! DomTerm.isAtom()) { // kludge for Atom
        topNode.addEventListener("focusin", function(e) {
            DomTerm.setFocus(dt);
        }, false);
    }
    function compositionStart(ev) {
        dt._composing = 1;
        dt.editorAddLine();
        dt._inputLine.parentNode.contentEditable = false;
        dt._removeCaret();
        document.getSelection().collapse(dt._caretNode, 0);
        if (dt.verbosity >= 1) dt.log("compositionStart");
    }
    function compositionEnd(ev) {
        if (dt.verbosity >= 1) dt.log("compositionEnd");
        dt._inputLine.parentNode.contentEditable = 'inherit';
        dt._composing = 0;
        let before = dt._caretNode.prevousSibling;
        dt._moveNodes(dt._caretNode.firstChild, dt._caretNode.parentNode,
                      dt._caretNode);
        if (before instanceof Text)
            dt._normalize(before);
        if (!dt.isLineEditing()) {
            dt._sendInputContents();
            dt._inputLine = null;
        }
        dt._restoreCaret();
    }
    topNode.addEventListener("compositionstart", compositionStart, true);
    topNode.addEventListener("compositionend", compositionEnd, true);
    topNode.addEventListener("paste",
                             function(e) {
                                 dt.pasteText(e.clipboardData.getData("text"));
                                 e.preventDefault(); },
                              false);
    window.addEventListener("unload",
                            function(event) { dt.historySave(); });
    topNode.addEventListener("click",
                             function(e) {
                                 var target = e.target;
                                 for (let n = target; n instanceof Element;
                                      n = n.parentNode) {
                                     let ntag = n.nodeName;
                                     if (ntag == "A") {
                                         if (! n.classList.contains("plain")
                                             || e.ctrlKey) {
                                             e.preventDefault();
                                             DomTerm.handleLink(n);
                                         }
                                         return;
                                     }
                                     if (ntag == "DIV")
                                         break;
                                 }
                             },
                             false);
    if (window.chrome && chrome.contextMenus && chrome.contextMenus.onClicked) {
        chrome.contextMenus.onClicked.addListener(function(info) {
            switch (info.menuItemId) {
            case "context-paste":
                DomTerm.doPaste(dt);
                break;
            case "context-copy":
                DomTerm.doCopy();
                break;
            }
            dt.log("context menu even info:"+info);
        });
    }
};

DomTerm.prototype._createBuffer = function(idName, bufName) {
    var bufNode = document.createElement("div");
    bufNode.setAttribute("id", idName);
    bufNode.setAttribute("buffer", bufName);
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
    var availHeight = this.topNode.clientHeight;
    if (this.verbosity >= 2)
        console.log("measureWindow "+this.name+" avH:"+availHeight);
    var clientWidth = this.topNode.clientWidth;
    if (availHeight == 0 || clientWidth == 0) {
        return;
    }
    var ruler = this._rulerNode;
    var rbox = ruler.getBoundingClientRect();
    this.charWidth = rbox.width/26.0;
    this.charHeight = rbox.height;
    this.rightMarginWidth = this._wrapDummy.offsetWidth;
    if (this.verbosity >= 2)
        this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.name+"["+this.topNode.getAttribute("class")+"] clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.topNode.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+this.charWidth+" chH:"+this.charHeight+" ht:"+availHeight+" rbox:"+rbox);
    var availWidth = clientWidth - this.rightMarginWidth;
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

    this._updateMiscOptions();
};

DomTerm.prototype.setMiscOptions = function(map) {
    this._miscOptions = map;
    this._updateMiscOptions();
};

DomTerm.prototype._updateMiscOptions = function(map) {
    var map = this._miscOptions;
    var style = "";

    // handle 'foreground' and 'background'
    const foreground = map.foreground;
    const background = map.background;
    let hex3re = /^#[0-9a-fA-F]{3}$/;
    let hex6re = /^#[0-9a-fA-F]{6}$/;
    const fgCols = foreground && foreground.match(hex6re) ? 2
          : foreground && foreground.match(hex3re) ? 1 : 0;
    const bgCols = background && background.match(hex6re) ? 2
          : background && background.match(hex3re) ? 1 : 0;
    if (fgCols && bgCols) {
        let fgSum = 0, bgSum = 0;
        for (let i = 0; i < 3; i++) {
            fgSum += parseInt(foreground.substring(1+fgCols*i, 3+fgCols*i), 16);
            bgSum += parseInt(background.substring(1+bgCols*i, 3+bgCols*i), 16);
        }
        if (foreground.length == 4)
            fgSum = 17 * fgSum;
        if (background.length == 4)
            bgSum = 17 * bgSum;
        let darkStyle = fgSum > bgSum;
        if (darkStyle) {
            style += "--main-light-color:"+foreground
                +";--main-dark-color:"+background+";";
        } else {
            style += "--main-light-color:"+background
                +";--main-dark-color:"+foreground+";";
        }
        this.setReverseVideo(darkStyle);
    } else {
        if (foreground)
            style += "--foreground-color: "+foreground+";";
        if (background)
            style += "--background-color: "+background+";";
    }

    style += "--wchar-width: "+(this.charWidth * 2)+"px";
    this.topNode.setAttribute("style", style);
};

DomTerm.showContextMenu = null;

DomTerm.prototype._mouseHandler = function(ev) {
    if (this.verbosity >= 2)
        this.log("mouse event "+ev.type+": "+ev+" t:"+this.topNode.id+" pageX:"+ev.pageX+" Y:"+ev.pageY+" mmode:"+this.sstate.mouseMode+" but:"+ev.button);

    if (ev.type == "mouseup") {
        this._usingScrollBar = false;
        if (this.sstate.mouseMode == 0 && ev.button == 0) {
            let sel = document.getSelection();
            if (sel.isCollapsed) {
                // we don't want a visible caret FIXME handle caretStyle >= 5
                sel.removeAllRanges();
            }
            this.maybeFocus();
        }
    }
    if (ev.type == "mousedown") {
        if (ev.button == 0 && ev.target == this.topNode) // in scrollbar
            this._usingScrollBar = true;
        DomTerm.setFocus(this);
    }
    if (this.sstate.mouseMode == 0 && ev.button == 2) {
        DomTerm._contextTarget = ev.target;
        DomTerm._contextLink = DomTerm._isInElement(ev.target, "A");
    }
    if (ev.type == "mouseup" && this.sstate.mouseMode == 0
        && this._currentlyPagingOrPaused()
        && this.topNode.scrollTop+this.availHeight >= this._vspacer.offsetTop)
            this._pauseContinue();

    if (ev.shiftKey || ev.target == this.topNode)
        return;

    var current_input_node = null;     // current std="input" element
    var current_pre_node = null;       // current class="domterm-pre" element
    var target_input_node = null;      // target std="input" element
    var target_pre_node = null;        // target class="domterm-pre" element
    // readlineMode is used to translate a click to arrow-key movements.
    // It is enabled on certain conditions when mouseMode is unset:
    // either altKey is set or both target and current position are
    // in the same multi-line-edit group.
    var readlineMode = false;
    var readlineForced = false; // basically if ev.altKey
    if (ev.type == "mouseup"
        && this.sstate.mouseMode == 0 && ! this.isLineEditing()
        && (window.getSelection().isCollapsed || ev.button == 1)) {
        target_pre_node = this._getOuterPre(ev.target);
        current_pre_node = this._getOuterPre(this.outputContainer);
        if (target_pre_node != null && current_pre_node != null) {
            readlineForced = ev.altKey;
            let firstSibling = target_pre_node.parentNode.firstChild;
            readlineMode = readlineForced
                || (target_pre_node.classList.contains("input-line")
                    && current_pre_node.classList.contains("input-line")
                    && (target_pre_node == current_pre_node
                        || (target_pre_node.parentNode == current_pre_node.parentNode
                            && firstSibling instanceof Element
                            && firstSibling.classList.contains("multi-line-edit"))));
        }
    }
    if (this.sstate.mouseMode == 0
        && (! readlineMode || (ev.button != 0 && ev.button != 1))){
        return;
    }

    // Get mouse coordinates relative to topNode.
    var xdelta = ev.pageX;
    var ydelta = ev.pageY + this.topNode.scrollTop;
    for (var top = this.topNode; top != null; top = top.offsetParent) {
        xdelta -= top.offsetLeft;
        ydelta -= top.offsetTop;
    }

    // Temporarily set position to ev.target (with some adjustments if
    // in readlineMode).  That way we can use updateCursorCache to get
    // an initial approximation of the corresponding row/col.
    // This gives us better results for variable-height lines
    // (and to a less reliable extent: variable-width characters).
    var saveCol = this.currentCursorColumn;
    var saveLine = this.currentAbsLine;
    var saveBefore = this.outputBefore;
    var saveContainer = this.outputContainer;
    var target = ev.target;
    this.outputContainer = ev.target;
    this.outputBefore = this.outputContainer.firstChild;
    var adjustInTarget = true;

    // Some readlineMode adjustments before we calculate row/col.
    if (readlineMode) {
        let child0 = target_pre_node.firstChild;
        let child = child0;
        // Get first target_pre_node child neither hider or prompt
        while (child instanceof Element
               && child.nodeName=="SPAN") {
            let ltype = child.getAttribute("std");
            if (ltype != "hider" && ltype != "prompt")
                break;
            child = child.nextSibling;
        }
        // If click is in prompt or hider element, go to following element
        if (child instanceof Element
            && xdelta <= child.offsetLeft
            && ydelta < child0.offsetTop + child0.offsetHeight) {
            target = child;
            this.outputContainer = target_pre_node;
            this.outputBefore = child;
            adjustInTarget= false;
            if (child instanceof Element
                && child.getAttribute("std") == "input")
                target_input_node = child;
        }

        // If both current and target lines starts with a prompt,
        // we want to subtract prompt widths (in case they are different).
        if (! readlineForced && target_pre_node != current_pre_node
           && target_input_node) {
            child = current_pre_node.firstChild;
            while (child instanceof Element
                   && child.nodeName=="SPAN") {
                let ltype = child.getAttribute("std");
                if (ltype != "hider" && ltype != "prompt")
                    break;
                child = child.nextSibling;
            }
            if (child instanceof Element
                && child.getAttribute("std") == "input")
                current_input_node = child;
        }

        // if the click is past the last character in the line, adjust.
        let targetLineChild = target_pre_node.lastChild;
        if (ev.target == target_pre_node
            && targetLineChild && targetLineChild.getAttribute("line")
            && ydelta >= targetLineChild.offsetTop
            && xdelta >= targetLineChild.offsetLeft) {
            var previousSibling = targetLineChild.previousSibling;
            if (previousSibling instanceof Element
                && previousSibling.getAttribute("std") == "input")
                target_input_node = previousSibling;
            this.outputContainer = targetLineChild.parentNode;
            this.outputBefore = targetLineChild;
            target = targetLineChild;
            adjustInTarget= false;
       }
    }
    this.resetCursorCache();
    var row = this.getCursorLine();
    var col = this.getCursorColumn();
    this.currentCursorColumn = saveCol;
    this.currentAbsLine = saveLine;
    this.outputBefore = saveBefore;
    this.outputContainer = saveContainer;

    if (adjustInTarget) {
        xdelta -= target.offsetLeft;
        ydelta -= target.offsetTop;
        // (xdelta,ydelta) are relative to ev.target
        col += Math.floor(xdelta / this.charWidth);
        row += Math.floor(ydelta / this.charHeight);
    }
    var mod = (ev.shiftKey?4:0) | (ev.metaKey?8:0) | (ev.ctrlKey?16:0);

    if (readlineMode) {
        var curVLine = this.getAbsCursorLine();
        var goalVLine = row+this.homeLine;
        var curLine = curVLine;
        var goalLine = goalVLine;
        while (this.isSpanNode(this.lineStarts[goalLine]))
            goalLine--;
        while (this.isSpanNode(this.lineStarts[curLine]))
            curLine--;
        var nLeft = 0, nRight = 0;
        var output = "";
        var goalCol = col + (goalVLine - goalLine) * this.numColumns;
        var curCol = this.getCursorColumn()
            + (curVLine - curLine) * this.numColumns;
        if (curLine != goalLine) {
            nLeft = curCol;
            nRight = goalCol;
            if (current_input_node && target_input_node) {
                nLeft -= Math.floor(current_input_node.offsetLeft / this.charWidth);
                nRight -= Math.floor(target_input_node.offsetLeft / this.charWidth);
            } else {
                if (nLeft > nRight) {
                    nLeft -= nRight;
                    nRight = 0;
                } else {
                    nRight -= nLeft;
                    nLeft = 0;
                }
            }
            let aboveLine = goalLine > curLine ? curLine : goalLine;
            let belowLine = goalLine > curLine ? goalLine : curLine;
            var n = 0;
            // abs(goalLine-curLine) is number of screen lines.
            // We need number of logical lines.
            for (var i = aboveLine; i < belowLine; i++) {
                if (! this.isSpanNode(this.lineStarts[i]))
                    n++;
            }
            // count characters before currentBefore in current_input_node
            // LEFT that number
            //var n = goalLine - curLine;
            var moveVert = "";
            if (goalLine > curLine)
                moveVert = this.specialKeySequence("", "B", null);
            else if (goalLine < curLine)
                moveVert = this.specialKeySequence("", "A", null);
            output = moveVert.repeat(n);
            // DOWN (or UP if negative) (goalLine-curLine).
        } else {
            var delta = goalCol - curCol;
            if (delta >= 0)
                nRight = delta;
            else
                nLeft = -delta;
        }
        if (nLeft > 0)  {
            var moveLeft = this.specialKeySequence("", "D", null);
            output = moveLeft.repeat(nLeft) + output;
        }
        if (nRight > 0)  {
            var moveRight = this.specialKeySequence("", "C", null);
            output = output + moveRight.repeat(nRight);
        }
        this.processInputCharacters(output);
        return;
    }

    var final = "M";
    var button = Math.min(ev.which - 1, 2) | mod;
    switch (ev.type) {
    case 'mousedown':
        if (this.sstate.mouseMode >= 1002)
            this.topNode.addEventListener("mousemove",
                                          this._mouseEventHandler);
        break;
    case 'mouseup':
        if (this.sstate.mouseMode >= 1002)
            this.topNode.removeEventListener("mousemove",
                                             this._mouseEventHandler);
        switch (this.sstate.mouseCoordEncoding) {
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
        this.log("mouse event "+ev+" type:"+ev.type+" cl:"+ev.clientX+"/"+ev.clientY+" p:"+ev.pageX+"/"+ev.pageY+" row:"+row+" col:"+col+" button:"+button+" mode:"+this.sstate.mouseMode+" ext_coord:"+this.sstate.mouseCoordEncoding);

    if (button < 0 || col < 0 || col >= this.numColumns
        || row < 0 || row >= this.numRows)
        return;

    function encodeButton(button, dt) {
        var value = button;
        switch (dt.sstate.mouseCoordEncoding) {
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
        switch (dt.sstate.mouseCoordEncoding) {
        case 1005:
            // FIXME UTF8 encoding
        default:
            return String.fromCharCode(val == 255-32 ? 0 : val + 33);
        case 1006: case 1015:
            return (prependSeparator?";":"")+(val+1);
        }
    }
    var result = "\x1b[";
    switch (this.sstate.mouseCoordEncoding) {
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
    "\u2295", "\u2296", // circled plus / circled minus
    "\u229E", "\u229F"  // squared plus / squared minus
];

DomTerm.prototype._showHideHandler = function(event) {
    var target = event.target;
    var child = target.firstChild;
    if (target.tagName == "SPAN"
        && (child instanceof Text || child == null)) {
        let oldText = child == null ? "" : child.data;
        let showText = target.getAttribute("show");
        let hideText = target.getAttribute("hide");
        let wasHidden;
        if (showText !== null && hideText !== null) {
            wasHidden = oldText == showText;
            child.data = wasHidden ? hideText : showText;
        } else {
            var markers = this.showHideMarkers;
            var i = markers.length;
            while (--i >= 0 && oldText != markers[i]) {}
            var oldHidingValue = target.getAttribute("domterm-hiding");
            if (oldHidingValue)
                wasHidden = oldHidingValue == "true";
            else if (i < 0)
                wasHidden = false;
            else
                wasHidden = (i & 1) == 0;
            if (child && i >= 0)
                child.data = markers[wasHidden ? i+1 : i-1];
        }
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
    this.requestUpdateDisplay();
};

DomTerm.prototype.freshLine = function() {
    var lineno = this.getAbsCursorLine();
    var line = this.lineStarts[lineno];
    var end = this.lineEnds[lineno];
    for (let n = line; n != null; n = n.firstChild) {
        if (n == this.outputContainer && n.firstChild == this.outputBefore)
            return;
    }
    this.cursorLineStart(1);
};

DomTerm.prototype.reportEvent = function(name, data) {
    // 0x92 is "Private Use 2".
    // FIXME should encode data
    if (this.verbosity >= 2)
        this.log("reportEvent "+this.name+": "+name+" "+data);
    this.processInputCharacters("\x92"+name+" "+data+"\n");
};

DomTerm.prototype.reportKeyEvent = function(keyName, str) {
    this.reportEvent("KEY", ""+keyName+"\t"+JSON.stringify(str));
};

DomTerm.prototype._initPendingInput = function(str) {
    if (this._deferredForDeletion &&
        this._deferredForDeletion != this.outputContainer) {
        this._doDeferredDeletion();
    }
    var pending = this._deferredForDeletion;
    if (pending == null) {
        this._removeCaret();
        var pending = this._createSpanNode();
        pending.textBefore = "";
        pending.textAfter = "";
        pending.pendingEcho = "";
        pending.classList.add("pending");

        this._deferredForDeletion = pending;
        this._requestDeletePendingEcho();
        this._restoreCaretNode();
        this._caretNode.parentNode.insertBefore(pending, this._caretNode);
        pending.appendChild(this._caretNode);
        if (this.outputBefore == this._caretNode)
            this.outputContainer = pending;
    }
    return pending;
}

DomTerm.prototype._addPendingInput = function(str) {
    var pending = this._initPendingInput();
    this._caretNode.parentNode.insertBefore(document.createTextNode(str),
                                            this._caretNode);
    pending.pendingEcho += str;
    pending.normalize();
    this._restoreCaret();
}

DomTerm._PENDING_LEFT = 2;
DomTerm._PENDING_RIGHT = DomTerm._PENDING_LEFT+1;
DomTerm._PENDING_DELETE = 4;

DomTerm.prototype._editPendingInput = function(forwards, doDelete) {
    var pending = this._initPendingInput();
    this._removeCaret();
    let text = forwards ? this._caretNode.nextSibling
        : this._caretNode.previousSibling;
    let outerText = null;
    if (text == null) {
        outerText = forwards ? pending.nextSibling : pending.previousSibling;
        text = outerText;
    }
    if (text instanceof Text && text.data.length > 0) {
        let ch = text.data.substring(forwards ? 0 : text.data.length-1,
                                     forwards ? 1 : text.data.length);
        let chlen = 1;
        // FIXME adjust ch/chlen if a surroagte
        text.deleteData(forwards ? 0 : text.data.length-chlen, chlen);
        if (outerText != null) {
            if (forwards)
                pending.textAfter = pending.textAfter + ch;
            else
                pending.textBefore = ch + pending.textBefore;
        }
        if (! doDelete) {
            let prevText = forwards ? this._caretNode.previousSibling : this._caretNode.nextSibling;
            if (prevText == null) {
                prevText = document.createTextNode(ch);
                this._caretNode.parentNode.insertBefore(prevText,
                                                        forwards ? this._caretNode
                                                        : this._caretNode.nextSibling);
            } else
                prevText.insertData(forwards ? prevText.data.length : 0,
                                    ch);
        }
        let code = (forwards ? DomTerm._PENDING_RIGHT : DomTerm._PENDING_LEFT)
            + (doDelete ? DomTerm._PENDING_DELETE : 0);
        pending.pendingEcho += String.fromCharCode(code);
        pending.normalize();
        if (outerText)
            outerText.parentNode.normalize();
        this._restoreCaret();
    }
}

DomTerm.prototype._respondSimpleInput = function(str, keyName) {
    if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
        this.reportKeyEvent(keyName, str);
    else
        this.processInputCharacters(str);
}

DomTerm.prototype.setWindowSize = function(numRows, numColumns,
                                           availHeight, availWidth) {
    this.reportEvent("WS", numRows+" "+numColumns+" "+availHeight+" "+availWidth);
};

/**
* Iterate for sub-node of 'node', starting with 'start'.
* Call 'func' for each node (if allNodes is true) or each Element
* (if allNodes is false).  If the value returned by 'func' is not a boolean,
* stop interating and return that as the result of forEachElementIn.
* If the value is true, continue with children; if false, skip children.
*/
DomTerm.prototype._forEachElementIn = function(node, func, allNodes=false, backwards=false, start=backwards?node.lastChild:node.firstChild) {
    for (var cur = start; ;) {
        if (cur == null || cur == node)
            break;
        let doChildren = true
        if (allNodes || cur instanceof Element) {
            var r = func(cur);
            if (r === true || r === false)
                doChildren = r;
            else
                return r;
        }
        let next;
        if (doChildren && cur instanceof Element
            && (next = backwards?cur.lastChild:cur.firstChild) != null) {
            cur = next;
        } else {
            for (;;) {
                next = backwards?cur.previousSibling:cur.nextSibling;
                if (next != null) {
                    cur = next;
                    break;
                }
                cur = cur.parentNode;
                if (cur == node)
                    break;
            }
        }
    }
    return null;
};

DomTerm._forEachTextIn = function(el, fun) {
    let n = el;
    for (;;) {
        if (n instanceof Text) {
            let r = fun(n);
            if (r != null)
                return r;
        }
        let next = n.firstChild
        if (next) {
            n = next;
        } else {
            for (;;) {
                if (n == el)
                    return null;
                next = n.nextSibling;
                if (next) {
                    n = next;
                    break;
                }
                n = n.parentNode;
            }
        }
    }
}

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
                    if (ch == 9) {
                        var tcol = null;
                        if (tlen == 1 && parent.nodeName == "SPAN") {
                            var st = parent.getAttribute("style");
                            if (st && st.startsWith("tab-size:")) {
                                tcol = Number(st.substring(9));
                            }
                        }
                        if (tcol)
                            col = (col / tcol) * tcol + tcol;
                        else
                            col = this.nextTabCol(col);
                    } else if (ch == 10 || ch == 13 || ch == 12) {
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
    if (input == null)
        return "";
    if (input instanceof Text)
        return input.data;
    if (this.isSpanNode(input) && input.getAttribute("std")=="prompt")
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
    while (this.pendingInput != this._inputLine && text == null) {
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
    } else if (str != "")
        this.history.push(str);
    this.historyCursor = -1;
};

DomTerm.prototype.historySearch =
function(str, forwards = this.historySearchForwards) {
    let step = forwards ? 1 : -1;
    for (let i = this.historySearchStart;
         (i += step) >= 0 && i < this.history.length; ) {
        if (this.history[i].indexOf(str) >= 0) {
            i -= this.historyCursor >= 0 ? this.historyCursor
                : this.history.length;
            this.historyMove(i);
            if (this._displayInfoWidget
                && this._displayInfoWidget.firstChild instanceof Text) {
                let prefix = this._displayInfoWidget.firstChild;
                if (prefix.data.startsWith("failed "))
                    prefix.deleteData(0, 7);
            }
            return;
        }
    }
    if (this._displayInfoWidget
        && this._displayInfoWidget.firstChild instanceof Text) {
        let prefix = this._displayInfoWidget.firstChild;
        if (! prefix.data.startsWith("failed "))
            prefix.insertData(0, "failed ");
    }
}

DomTerm.prototype.historyMove = function(delta) {
    var str = this.grabInput(this._inputLine);
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
    var inputLine = this._inputLine;
    this._removeCaret();
    for (var child = inputLine.firstChild; child != null; ) {
        var next = child.nextSibling;
        inputLine.removeChild(child);
        child = next;
    }
    inputLine.appendChild(this._caretNode);
    this._removeInputFromLineTable();
    this._restoreCaret();
    this.editorInsertString(str);
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
    var oldInputLine = this._inputLine;
    var spanNode;
    var line = this.getAbsCursorLine();
    let suppressEcho = ((this._clientPtyEcho
                         && (! this._clientPtyExtProc
                             || ! this._clientWantsEditing))
                        || text == null);
    if (oldInputLine != null) {
        let noecho = oldInputLine.classList.contains("noecho");
        if (noecho)
            oldInputLine.classList.remove("noecho");
        let cont = oldInputLine.getAttribute("continuation");
        if (text != null && ! noecho)
            this.historyAdd(text, cont == "true");
        this.outputContainer = oldInputLine;
        this.outputBefore = this._caretNode;
        if (this._getStdMode(oldInputLine.parentNode) !== "input") {
            let wrap = this._createSpanNode();
            wrap.setAttribute("std", "input");
            oldInputLine.parentNode.insertBefore(wrap, oldInputLine);
            wrap.appendChild(oldInputLine);
        }
    }
    this._inputLine = null;
    if (suppressEcho) {
        this._removeInputFromLineTable();
        oldInputLine.classList.add("pending");
        this._deferredForDeletion = oldInputLine;
        this._requestDeletePendingEcho();
        this.currentAbsLine = line+this.homeLine;
        this.currentCursorColumn = -1;
        this.resetCursorCache();
    } else if (! this.sstate.hiddenText) {
        this._removeCaret();
        let inputParent = oldInputLine.parentNode;
        this.outputContainer = inputParent;
        this.outputBefore = oldInputLine;
        this._removeInputLine();
        this.outputContainer = oldInputLine.parentNode;
        this.outputBefore = oldInputLine.nextSibling;
        this.resetCursorCache();
        this.cursorLineStart(1);
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
            this.deleteLinesIgnoreScroll(removed);
            this.resetCursorCache();
            saveLine -= removed;
        }
        break;
    default:
        var startLine = param == 0 ? saveLine : this.homeLine;
        if (param == 2 && this.usingAlternateScreenBuffer
            && this.homeLine > this.initial.saveLastLine) {
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
            this.deleteLinesIgnoreScroll(count);
            this.resetCursorCache();
        }
        break;
    }
    if ((param == 0 || param == 2) && this._vspacer != null)
        this._setBackgroundColor(this._vspacer, this._currentStyleBackground());
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
    if (lineEnd != null && lineEnd.getAttribute("line")=="soft") {
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
            var oldNextLine = this.lineStarts[absLine+1];
            this.lineStarts[absLine+1] = newBlock;
            newBlock._widthColumns = oldNextLine._widthColumns;
            newBlock._widthMode = oldNextLine._widthMode;
            oldNextLine._widthColumns = undefined;
            oldNextLine._widthMode = undefined;
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

// Clean up readline when input is an exact multiple of the line length.
// Then cursor is alone on an empty final line.  Readlines sends "\e[A\r\n".
// (Zsh/fish are worse.)
DomTerm.prototype._fixEmptyLastInputLine = function() {
    this._clearWrap();
    let ln = this.getAbsCursorLine();
    if (ln == this.lineStarts.length - 2) {
        let last = this.lineStarts[ln+1];
        let lastText = last.textContent;
        if (lastText == '\n' || lastText == ' \n') {
            last.parentNode.removeChild(last);
            this.lineStarts.length = ln + 1;
            this.lineEnds.length = ln + 1;
        }
    }
}

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
    var lineNo = this.getAbsCursorLine();
    var lineEnd = this.lineEnds[lineNo];
    var colNo = this.getCursorColumn();
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
    if (count < 0)
	this.lineStarts[lineNo]._widthColumns = colNo;
    else if (this.lineStarts[lineNo]._widthColumns !== undefined)
	this.lineStarts[lineNo]._widthColumns -= count - todo;
    return todo <= 0;
};


DomTerm.prototype.eraseLineRight = function() {
    this.deleteCharactersRight(-1);
    this._clearWrap();
    this._eraseLineEnd();
}

// New "whitespace" at the end of the line need to be set to Background Color.
DomTerm.prototype._eraseLineEnd = function() {
    var line = this.lineStarts[this.getAbsCursorLine()];
    var bg = this._currentStyleBackground();
    var oldbg = this._getBackgroundColor(line);
    // We need to change to "line background color"
    if (bg != oldbg) {
        this._setBackgroundColor(line, bg);
        var col = this.getCursorColumn();
        if (col > 0) {
            // FIXME avoid this if also doing eraseLineRight
            var end = this.lineEnds[this.getAbsCursorLine()];
            if (oldbg == null)
                oldbg = "var(-dt-bgcolor)";
            // ... but existing text must keep existing color.
            for (var ch = line.firstChild;
                 ch != null && ch != end; ) {
                var next = ch.nextSibling;
                if (ch instanceof Text) {
                    var span = this._createSpanNode();
                    line.removeChild(ch);
                    span.appendChild(ch);
                    if (ch == this.outputBefore)
                        this.outputContainer = span;
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
    return arr.length > index && arr[index] != null ? arr[index] : defaultValue;
}

DomTerm.prototype.get_DEC_private_mode = function(param) {
    switch (param) {
    case 1: return this.sstate.applicationCursorKeysMode;
    case 3: return this.numColumns == 132;
    case 5: return this.topNode.getAttribute("reverse-video") != null;
    case 6: return this.sstate.originMode;
    case 7: return (this.sstate.wraparoundMode & 2) != 0;
    case 12: // Stop/start blinking cursor (AT&T 610) - sent by emacs
        return false; // FIXME
    case 25: // Hide/show cursor (DECTCEM) - sent by emacs
        return this.sstate.showCaret;
    case 45: return (this.sstate.wraparoundMode & 1) != 0;
    case 47: // fall though
    case 1047: return this.usingAlternateScreenBuffer;
    case 1048: return this.sstate.savedCursor !== undefined;
    case 1049: return this.usingAlternateScreenBuffer;
    case 2004: return this.sstate.bracketedPasteMode;
    case 9: case 1000: case 1001: case 1002: case 1003:
        return this.sstate.mouseMode == param;
    case 1004:
        return this._sendMouse;
    case 1005: case 1006: case 1015:
        return this.sstate.mouseCoordEncoding == param;
    }
}
/** Do DECSET or related option.
 */
DomTerm.prototype.set_DEC_private_mode = function(param, value) {
    switch (param) {
    case 1:
        // Application Cursor Keys (DECCKM).
        this.sstate.applicationCursorKeysMode = value;
        break;
    case 3:
        this.forceWidthInColumns(value ? 132 : 80);
        break;
    case 5: // Reverse Video (DECSCNM)
        this.setReverseVideo(value);
        break;
    case 6:
        this.sstate.originMode = value;
        break;
    case 7:
        if (value)
            this.sstate.wraparoundMode |= 2;
        else
            this.sstate.wraparoundMode &= ~2;
        break;
    case 12: // Stop/start blinking cursor (AT&T 610)
        // Not sure how this should be combined with caretStyleFromCharSeq.
        // Emacs sends this, but only to set/reset it temporarily.
        break;
    case 25: // Hide/show cursor (DECTCEM) - sent by emacs
        this.sstate.showCaret = value;
        break;
    case 45:
        if (value)
            this.sstate.wraparoundMode |= 1;
        else
            this.sstate.wraparoundMode &= ~1;
        break;
    case 9: case 1000: case 1001: case 1002: case 1003:
        var handler = this._mouseEventHandler;
        if (value) {
            this.topNode.addEventListener("wheel", handler);
        } else {
            this.topNode.removeEventListener("wheel", handler);
        }
        this.sstate.mouseMode = value ? param : 0;
        break;
    case 1004: // Send FocusIn/FocusOut events.
        this.sstate.sendFocus = true;
        break;
    case 1005: case 1006: case 1015:
        this.sstate.mouseCoordEncoding = value ? param : 0;
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
        this.sstate.bracketedPasteMode = value;
        break;
    }
};

DomTerm.prototype.pushControlState = function() {
    var save = {
        controlSequenceState: this.controlSequenceState,
        parameters: this.parameters,
        decoder: this.decoder,
        receivedCount: this._receivedCount,
        count_urgent: false,
        _savedControlState: this._savedControlState
    };
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    this.parameters = new Array();
    this.decoder = new TextDecoder(); //label = "utf-8");
    this._savedControlState = save;
}

DomTerm.prototype.popControlState = function() {
    var saved = this._savedControlState;
    if (saved) {
        this.controlSequenceState = saved.controlSequenceState;
        this.parameters = saved.parameters;
        this.decoder = saved.decoder;
        this._savedControlState = saved.controlSequenceState;
        // Control sequences in "urgent messages" don't count to
        // receivedCount. (They are typically window-specific and
        // should not be replayed when another window is attached.)
        var old = this._receivedCount;
        if (saved.count_urgent)
            this._receivedCount = (this._receivedCount + 2) & DomTerm._mask28;
        else
            this._receivedCount = saved.receivedCount;
    }
}

DomTerm.prototype.handleControlSequence = function(last) {
    var param;
    var oldState = this.controlSequenceState;
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    if (last != 109 /*'m'*/)
        this._breakDeferredLines();
    switch (last) {
    case 64 /*'@'*/:
        var saveInsertMode = this.sstate.insertMode;
        this.sstate.insertMode = true;
        param = this.getParameter(0, 1);
        this.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param, param);
        this.cursorLeft(param, false);
        this.sstate.insertMode = saveInsertMode;
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
                        (this.sstate.wraparoundMode & 3) == 3);
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
        this.cursorSet(this.sstate.originMode ? line - this._regionTop : line,
                       this.getParameter(0, 1)-1,
                       this.sstate.originMode);
        break;
    case 102 /*'f'*/:
    case 72 /*'H'*/: // CUP cursor position
        this.cursorSet(this.getParameter(0, 1)-1, this.getParameter(1, 1)-1,
                      this.sstate.originMode);
        break;
    case 73 /*'I'*/: // CHT Cursor Forward Tabulation
        for (var n = this.getParameter(0, 1);
             --n >= 0 && this.tabToNextStop(false); ) {
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
        this.cursorSet(this.sstate.originMode ? line - this._regionTop : line,
                       this.sstate.originMode ? column - this._regionLeft : column
                       + this.getParameter(0, 1),
                       this.sstate.originMode);
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
                       this.sstate.originMode ? col - this._regionLeft : col,
                       this.sstate.originMode);
        break;
    case 101 /*'e'*/: // VPR
        var line = this.getCursorLine();
        var column = this.getCursorColumn();
        this.cursorSet(this.sstate.originMode ? line - this._regionTop : line
                       + this.getParameter(0, 1),
                       this.sstate.originMode ? column - this._regionLeft : column,
                       this.sstate.originMode);
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
                this.sstate.insertMode = true;
                break;
            case 20:
                this.sstate.automaticNewlineMode = this.getParameter(1, 3);
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
                this.sstate.insertMode = false;
                break;
            case 20:
                this.sstate.automaticNewlineMode = 0;
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
            if (this.sstate.originMode) {
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
            this.setCaretStyle(this.getParameter(0, 1));
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
            this.cursorSet(0, 0, this.sstate.originMode);
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
            /*
            NOT CLEAR IF THIS IS USEFUL - CAN'T REPRODUCE
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
            */
            this._pushStdMode("prompt");
            if (this._inputLine != null) {
                if (param == 24)
                    this._inputLine.setAttribute("continuation", "true");
                else
                    this._inputLine.removeAttribute("continuation");
            }
            break;
        case 15:
            var submode = this.getParameter(1, 1);
            // 0 - client does not do line editing (no arrow key support)
            // 1 - single-line line editing (a la GNU readline)
            // 2 - first line of potentially multi-line (a la jline3)
            this._pushStdMode("input");
            // If there is existing content on the current line,
            // move it into new input <span>.
            var newParent = this.outputContainer;
            var firstChild = newParent.nextSibling;
            for (var child = firstChild;
                 child != null
                 && (child.tagName!="SPAN"
                     ||child.getAttribute("line")=="soft"); ) {
                var next = child.nextSibling;
                child.parentNode.removeChild(child);
                newParent.appendChild(child);
                child = next;
            }
            this.outputBefore = newParent.firstChild;
            var ln = newParent.parentNode;
            var cl = ln.classList;
            if (submode != 0 && cl.contains("domterm-pre")
                && ! ln.parentNode.classList.contains("input-line")) {
                cl.add("input-line");
                if (submode==2)
                    cl.add("multi-line-edit");
            }
            this._adjustStyle();
            break;
        case 16:
            var hider = this._createSpanNode();
            hider.setAttribute("std", "hider");
            this._pushIntoElement(hider);
            hider.outerStyleSpan = this._currentStyleSpan;
            this._currentStyle = hider;
            hider.parentNode.hasHider = true;
            this._currentCommandHideable = true;
            break;
        case 17:
            this.outputContainer.addEventListener("click",
                                                  this._showHideEventHandler,
                                                  true);
            if (this.isSpanNode(this.outputContainer) // sanity check
                && this.outputContainer.getAttribute("std") == "hider") {
                if (this.outputContainer == this._currentStyleSpan)
                    this._currentStyleSpan = this.outputContainer.outerStyle;
                let t = this.outputContainer.firstChild;
                if (t instanceof Text
                    && DomTerm._countCodePoints(t.data) == 2) {
                    let split = DomTerm._indexCodePoint(t.data, 1);
                    let hide = t.data.substring(0, split);
                    let show = t.data.substring(split);
                    // optimize if matching showHideMarkers
                    let markers = this.showHideMarkers;
                    let i = markers.length;
                    while ((i -= 2) >= 0
                           && (show != markers[i] || hide != markers[i+1])) {
                    }
                    if (i < 0) {
                        this.outputContainer.setAttribute("show", show);
                        this.outputContainer.setAttribute("hide", hide);
                    }
                    t.data = hide;
                    if (this.currentCursorColumn > 0)
                        this.currentCursorColumn--;
                }
                this.popFromElement();
            }
            break;
        case 19:
            this.freshLine();
            this.startCommandGroup(null);
            break;
        case 20:
            this.freshLine();
            break;
        case 80: // set input mode
            this.setInputMode(this.getParameter(1, 112));
            break;
        case 81: // get-window-contents
            DomTerm.saveWindowContents(this);
            this._removeInputLine();
            break;
        case 82:
            this._detachSaveNeeded = this.getParameter(1,1);
            break;
        case 83: // push/pop domterm-hidden span
            param = this.getParameter(1, 0);
            if (param == 0) { // pop
                if (this.outputBefore == null) {
                    this.outputBefore = this.outputContainer.nextSibling;
                    this.outputContainer = this.outputContainer.parentNode;
                }
            } else {
                let span = this._createSpanNode();
                span.setAttribute("domterm-hidden",
                                  param == 1 ? "false" : "true");
                this._pushIntoElement(span);
            }
            break;
        case 90:
            DomTerm.newPane(this.getParameter(1, 0),
                            this.getParameter(2, 0),
                            this);
            break;
        case 91:
            this.sstate.sessionNumber = this.getParameter(1, 0);
            this.topNode.setAttribute("session-number", this.sstate.sessionNumber);
            this.sstate.sessionNameUnique = this.getParameter(2, 0) != 0;
            this.windowNumber = this.getParameter(3, 0)-1;
            this.updateWindowTitle();
            break;
        case 92:
            switch (this.getParameter(1, 0)) {
            case 1:
                if (! this._autoPaging) {
                    this._autoPaging = true;
                    this._autoPagingTemporary = true;
                }
                break;
            case 2:
                this._autoPagingTemporary = this.outputContainer;
                break;
            }
            break;
        case 96:
            this._receivedCount = this.getParameter(1,0);
            this._confirmedCount = this._receivedCount;
            if (this._savedControlState)
                this._savedControlState.receivedCount = this._receivedCount;
            break;
        case 97:
            this._replayMode = true;
            break;
        case 98:
            this._replayMode = false;
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

DomTerm.requestOpenLink = function(obj, dt=DomTerm.focusedTerm) {
    if (dt != null)
        dt.reportEvent("LINK", JSON.stringify(obj));
}

DomTerm.handleLink = function(element) {
    let dt = DomTerm._getAncestorDomTerm(element);
    if (! dt)
        return;
    var href = element.getAttribute("href");
    if (href.startsWith('#'))
        window.location.hash = href;
    else {
        var obj = {
            href: href,
            text: element.textContent
        };
        if (DomTerm.isAtom())
            obj.isAtom = true;
        var filename = null;
        var m;
        if ((m = href.match(/^file:(.*)#position=([0-9:-]*)$/)) != null) {
            filename = m[1];
            obj.position = m[2];
        } else if ((m = href.match(/^file:([^&#]*)$/)) != null) {
            filename = m[1];
        }
        if (filename) {
            if (filename.startsWith("///"))
                filename = filename.substring(2);
            obj.filename = decodeURIComponent(filename);
        }
        DomTerm.requestOpenLink(obj, dt);
    }
};

// Set the "session name" which is the "name" attribute of the toplevel div.
// It can be used in stylesheets as well as the window title.
DomTerm.prototype.setSessionName = function(title) {
    this.setWindowTitle(title, 30);
}

// FIXME misleading function name - this is not just the session name
DomTerm.prototype.sessionName = function() {
    var sname = this.topNode.getAttribute("name");
    if (! sname)
        sname = "DomTerm" + ":" + this.sstate.sessionNumber;
    else if (! this.sstate.sessionNameUnique)
        sname = sname + ":" + this.sstate.sessionNumber;
    if (this.windowNumber >= 0) {
        /*
        function format2Letters(n) {
            var rem = n % 26;
            var last = String.fromCharCode(97+rem);
            if (n > 26)
                return format2Letters((n - rem) / 26) + last;
            else
                return last;
        }
        sname = sname + format2Letters(this.windowNumber);
        */
        sname = sname + "." + this.windowNumber;
    }
    return sname;
};

DomTerm.prototype.setWindowTitle = function(title, option) {
    switch (option) {
    case 0:
        this.sstate.windowName = title;
        this.sstate.iconName = title;
        break;
    case 1:
        this.sstate.iconName = title;
        break;
    case 2:
        this.sstate.windowName = title;
        break;
    case 30:
        this.name = title;
        this.topNode.setAttribute("name", title);
        this.sstate.sessionNameUnique = true;
        this.reportEvent("SESSION-NAME", JSON.stringify(title));
        break;
    }
    this.updateWindowTitle();
};

DomTerm.prototype.formatWindowTitle = function() {
    var str = this.sstate.windowName ? this.sstate.windowName
        : this.sstate.iconName ? this.sstate.iconName
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

DomTerm.prototype.updateWindowTitle = function() {
    if (DomTerm.setLayoutTitle)
        DomTerm.setLayoutTitle(this, this.sessionName(), this.sstate.windowName);
    var str = this.formatWindowTitle()
    this.sstate.windowTitle = str;
    if (this.hasFocus())
        DomTerm.setTitle(str);
}

DomTerm.prototype.resetTerminal = function(full, saved) {
    // Corresponds to xterm's ReallyReset function
    if (saved)
        this.eraseDisplay(saved);
    this.controlSequenceState = DomTerm.INITIAL_STATE;
    this._setRegionTB(0, -1);
    this._setRegionLR(0, -1);
    this.sstate.originMode = false;
    this.sstate.bracketedPasteMode = false;
    this.sstate.wraparoundMode = 2;
    this.forceWidthInColumns(-1);
    this.sstate.mouseMode = 0;
    this.sstate.mouseCoordEncoding = 0;
    this._Glevel = 0;
    this.charMapper = null;
    this._Gcharsets[0] = null;
    this._Gcharsets[1] = null;
    this._Gcharsets[2] = null;
    this._Gcharsets[3] = null;
    this._currentCommandGroup = null;
    this._currentCommandOutput = null;
    this._currentCommandHideable = false;
    this._currentPprintGroup = null;
    this._needSectionEndFence = null;
    this.resetTabs();

    // FIXME a bunch more
};

DomTerm.prototype.setReverseVideo = function(value) {
    if (value)
        this.topNode.setAttribute("reverse-video", "yes");
    else
        this.topNode.removeAttribute("reverse-video");
}

DomTerm.prototype._asBoolean = function(value) {
    return value == "true" || value == "yes" || value == "on";
}

DomTerm._settingsCounter = -1;
DomTerm.settingsHook = null;
DomTerm.defaultWidth = -1;
DomTerm.defaultHeight = -1;

DomTerm.prototype.setSettings = function(obj) {
    var settingsCounter = obj["##"];
    if (this._settingsCounterInstance == settingsCounter)
        return;
    this._settingsCounterInstance = settingsCounter;

    this.linkAllowedUrlSchemes = DomTerm.prototype.linkAllowedUrlSchemes;
    var link_conditions = "";
    var val = obj["open.file.application"];
    var a = val ? val : "";
    val = obj["open.link.application"];
    if (val)
        a += val;
    for (;;) {
        var m = a.match(/^[^{]*{([^:}]*)\b([a-zA-Z][-a-zA-Z0-9+.]*:)([^]*)$/);
        if (! m)
            break;
        this.linkAllowedUrlSchemes += m[2];
        a = m[1]+m[3];
    }

    var style_dark = obj["style.dark"];
    if (style_dark) {
        this.setReverseVideo(this._asBoolean(style_dark));
        this._style_dark_set = true;
    } else if (this._style_dark_set) {
        this.setReverseVideo(false);
        this._style_dark_set = false;
    }
    var cstyle = obj["style.caret"];
    if (cstyle) {
        cstyle = String(cstyle).trim();
        switch (cstyle) {
        case "blinking-block": cstyle = 0; break;
        case "block": cstyle = 2; break;
        case "blinking-underline": cstyle = 3; break;
        case "underline": cstyle = 4; break;
        case "blinking-bar": cstyle = 5; break;
        case "bar": cstyle = 6; break;
        default: cstyle = Number(cstyle); break;
        }
    }
    if (cstyle >= 0 && cstyle <= 6) {
        if (this.sstate.caretStyleFromCharSeq < 0)
            this.setCaretStyle(cstyle);
        this.caretStyleFromSettings = cstyle;
    } else {
        this.caretStyleFromSettings = -1;
        this.setCaretStyle(DomTerm.DEFAULT_CARET_STYLE);
    }

    if (DomTerm._settingsCounter != settingsCounter) {
        DomTerm._settingsCounter = settingsCounter;
        var style_user = obj["style.user"];
        if (style_user) {
            this.loadStyleSheet("user", style_user);
            DomTerm._userStyleSet = true;
        } else if (DomTerm._userStyleSet) {
            this.loadStyleSheet("user", "");
            DomTerm._userStyleSet = false;
        }
        var geom = obj["window.geometry"];
        if (geom) {
            try {
                var m = geom.match(/^([0-9]+)x([0-9]+)$/);
                if (m) {
                    DomTerm.defaultWidth = Number(m[1]);
                    DomTerm.defaultHeight = Number(m[2]);
                }
            } catch (e) { }
        } else {
            DomTerm.defaultWidth = -1;
            DomTerm.defaultHeight = -1;
        }

        var lineeditMap = obj["keymap.line-edit"];
        if (lineeditMap != null) {
            let map = "{" + lineeditMap.trim().replace(/\n/g, ",") + "}";
            map = map.replace(/("[^"]+")\s*:\s*([^"',\s]+)/g, '$1: "$2"')
                .replace(/('[^']+')\s*:\s*([^"',\s]+)/g, '$1: "$2"');
            try {
                DomTerm.lineEditKeymap =
                    DomTerm.lineEditKeymapDefault.update(JSON.parse(map));
            } catch (e) {
            }
        } else
            DomTerm.lineEditKeymap = DomTerm.lineEditKeymapDefault;
    }

    if (DomTerm.settingsHook) {
        var style_qt = obj["style.qt"];
        DomTerm.settingsHook("style.qt", style_qt ? style_qt : "");
    }
    DomTerm._checkStyleResize(this);
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

DomTerm._addMouseEnterHandlers = function(dt, node=dt.topNode) {
    var links = node.getElementsByTagName("a");
    for (var i = links.length; --i >= 0; ) {
        var link = links[i];
        if (! link.hasMouseEnter) {
            link.addEventListener("mouseenter", dt._mouseEnterHandler, false);
            link.hasMouseEnter = true;
        }
    }
}

DomTerm.prototype._unsafeInsertHTML = function(text) {
    if (this.verbosity >= 1)
        this.log("_unsafeInsertHTML "+JSON.stringify(text));
    if (text.length > 0) {
        if (this.outputBefore == null)
            this.outputContainer.insertAdjacentHTML("beforeend", text);
        else if (this.outputBefore instanceof Element)
            this.outputBefore.insertAdjacentHTML("beforebegin", text);
        else {
            let tmp = document.createElement("span");
            this.outputContainer.insertBefore(tmp, this.outputBefore);
            tmp.insertAdjacentHTML("beforebegin", text);
            this.outputContainer.removeChild(tmp);
        }
        DomTerm._addMouseEnterHandlers(this, this.outputContainer);
    }
};

DomTerm._ELEMENT_KIND_ALLOW = 1; // Allow in inserted HTML
DomTerm._ELEMENT_KIND_CHECK_JS_TAG = 2; // Check href/src for "javascript:"
DomTerm._ELEMENT_KIND_INLINE = 4; // Phrasing [inline] content
DomTerm._ELEMENT_KIND_SVG = 8; // Allow in SVG
DomTerm._ELEMENT_KIND_EMPTY = 16; // Void (empty) HTML element, like <hr>
DomTerm._ELEMENT_KIND_TABLE = 32; // allowed in table
DomTerm._ELEMENT_KIND_SKIP_TAG = 64; // ignore (skip) element (tag)
DomTerm._ELEMENT_KIND_CONVERT_TO_DIV = 128; // used for <body>
DomTerm._ELEMENT_KIND_SKIP_FULLY = 256; // skip element (tag and contents)
DomTerm._ELEMENT_KIND_SKIP_TAG_OR_FULLY = DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_SKIP_FULLY;

DomTerm._elementInfo = function(tag, parents=null) {
    var v = DomTerm.HTMLinfo.hasOwnProperty(tag) ? DomTerm.HTMLinfo[tag] : 0;

    if ((v & DomTerm._ELEMENT_KIND_SVG) != 0 && parents) {
        // If allow in SVG, check parents for svg
        for (var i = parents.length; --i >= 0; ) {
            if (parents[i] == "svg") {
                v |= DomTerm._ELEMENT_KIND_ALLOW;
                v &= ~DomTerm._ELEMENT_KIND_SKIP_TAG_OR_FULLY;
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
    if ((einfo & DomTerm._ELEMENT_KIND_CHECK_JS_TAG) != 0) {
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
    "a": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_CHECK_JS_TAG+DomTerm._ELEMENT_KIND_ALLOW,
    "abbr": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "altGlyph": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "altGlyphDef": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "altGlyphItem": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "animate": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "animateColor": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "animateMotion": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "animateTransform": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "area": 0x14,
    "b": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "base": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_CHECK_JS_TAG+DomTerm._ELEMENT_KIND_ALLOW,
    "basefont": DomTerm._ELEMENT_KIND_EMPTY, //obsolete
    "big": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "blockquote": DomTerm._ELEMENT_KIND_ALLOW,
    "br": 0x15,
    "body": DomTerm._ELEMENT_KIND_CONVERT_TO_DIV+DomTerm._ELEMENT_KIND_ALLOW,
    "center": DomTerm._ELEMENT_KIND_ALLOW,
    "circle": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "cite": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "clipPath": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "code": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "col": 0x11,
    "color-profile": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "command": 0x15, // obsolete
    "cursor": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "dd": DomTerm._ELEMENT_KIND_ALLOW,
    "dfn": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "defs": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "desc": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "div": DomTerm._ELEMENT_KIND_ALLOW,
    "dl": DomTerm._ELEMENT_KIND_ALLOW,
    "dt": DomTerm._ELEMENT_KIND_ALLOW,
    "ellipse": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "em": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "embed": 0x14,
    "feBlend": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feColorMatrix": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feComponentTransfer": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feComposite": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feConvolveMatrix": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feDiffuseLighting": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feDisplacementMap": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feDistantLight": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feFlood": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feFuncA": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feFuncB": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feFuncG": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feFuncR": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feGaussianBlur": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feImage": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feMerge": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feMergeNode": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feMorphology": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feOffset": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "fePointLight": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feSpecularLighting": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feSpotLight": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feTile": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "feTurbulence": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "figcaption": DomTerm._ELEMENT_KIND_ALLOW,
    "figure": DomTerm._ELEMENT_KIND_ALLOW,
    "filter": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font-face": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font-face-format": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font-face-name": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font-face-src": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "font-face-uri": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "foreignObject": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "frame": 0x10,
    "g": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "glyph": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "glyphRef": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "h1": DomTerm._ELEMENT_KIND_ALLOW,
    "h2": DomTerm._ELEMENT_KIND_ALLOW,
    "h3": DomTerm._ELEMENT_KIND_ALLOW,
    "h4": DomTerm._ELEMENT_KIND_ALLOW,
    "h5": DomTerm._ELEMENT_KIND_ALLOW,
    "h6": DomTerm._ELEMENT_KIND_ALLOW,
    "head": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_ALLOW,
    "header": DomTerm._ELEMENT_KIND_ALLOW,
    "hkern": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "hr": DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_ALLOW,
    "html": 0x41,
    "i": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    //"iframe": DomTerm._ELEMENT_KIND_ALLOW, // ??? maybe
    "image": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE, // FIXME
    "img": 0x17, // need to check "src" for "javascript:"
    "input": 0x15,
    //"isindex": 0x10, //metadata
    "kbd": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "keygen": 0x15,
    "li": DomTerm._ELEMENT_KIND_ALLOW,
    "line": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "linearGradient": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "link": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_ALLOW,
    "mark": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "marker": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mask": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "meta": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_ALLOW,
    "metadata": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "missing-glyph": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mpath": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "ol": DomTerm._ELEMENT_KIND_ALLOW,
    "p": DomTerm._ELEMENT_KIND_ALLOW,
    //"para": 0x10, //???
    "param": DomTerm._ELEMENT_KIND_EMPTY, // invalid
    "path": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "pattern": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "polygon": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "polyline": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "pre": DomTerm._ELEMENT_KIND_ALLOW,
    "q": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "radialGradient": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "rect": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "samp": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "script": DomTerm._ELEMENT_KIND_SKIP_FULLY+DomTerm._ELEMENT_KIND_ALLOW,
    "set": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "small": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "source": DomTerm._ELEMENT_KIND_EMPTY, // invalid
    "span": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "stop": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "strong": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "style": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_SKIP_FULLY+DomTerm._ELEMENT_KIND_ALLOW,
    "sub": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "sup": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "svg": 13,
    "switch": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "symbol": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "table": DomTerm._ELEMENT_KIND_ALLOW,
    "tbody": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "thead": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "tfoot": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "tr": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "td": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "text": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "textPath": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "title": DomTerm._ELEMENT_KIND_SKIP_FULLY+DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_ALLOW,
    //"track": 0x10,
    "tref": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "tspan": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "tt": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "u": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "ul": 1,
    "use": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "view": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "var": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "vkern": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "wbr": 0x15,
    
    // Phrasing content:
    //area (if it is a descendant of a map element) audio bdi bdo br button canvas data datalist del embed iframe input ins kbd keygen label map math meter noscript object output progress q ruby s select svg template textarea time u  video wbr text
};

DomTerm.prototype._scrubAndInsertHTML = function(str) {
    function skipWhitespace(pos) {
        for (; pos < len; pos++) {
            let c = str.charCodeAt(pos);
            if (c != 32 && (c < 8 || c > 13))
                break;
        }
        return pos;
    }
    var doctypeRE = /^\s*<!DOCTYPE\s[^>]*>\s*/;
    var len = str.length;
    var baseUrl = null;
    var start = 0;
    var ok = 0;
    var i = 0;
    var startLine = this.getAbsCursorLine();
    // FIXME could be smarter - we should avoid _WIDTH_MODE_VARIABLE_SEEN
    // until we actually see something that needs it.
    this.lineStarts[startLine]._widthMode = DomTerm._WIDTH_MODE_VARIABLE_SEEN;
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
                this.lineStarts[this.getAbsCursorLine()]._widthMode =
                    DomTerm._WIDTH_MODE_VARIABLE_SEEN;
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
            if (ok == 0 && ch == 33) {
                let m = str.match(doctypeRE);
                if (m) {
                    str = str.substring(m[0].length);
                    len = str.length;
                    i = 0;
                    break;
                }
            }
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
                        if (activeTags.length == 0)
                            i = skipWhitespace(i);
                        str = str.substring(0, ok) + str.substring(i);
                        len = str.length;
                        i = ok;
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
                var einfo = DomTerm._elementInfo(tag, activeTags);
                if (activeTags.length == 0) {
                    // maybe TODO: allow unbalanced "</foo>" to pop from foo.
                    break loop;
                } else if (activeTags.pop() == tag) {
                    if ((einfo & DomTerm._ELEMENT_KIND_CONVERT_TO_DIV) != 0) {
                        i = skipWhitespace(i);
                        str = str.substring(0, ok) + "</div>" + str.substring(i);
                        len = str.length;
                        ok = i = ok + 6;
                    } else if ((einfo & DomTerm._ELEMENT_KIND_SKIP_TAG_OR_FULLY) != 0) {
                        if ((einfo & DomTerm._ELEMENT_KIND_SKIP_FULLY) != 0)
                            ok = activeTags.pop();
                        if ((einfo & DomTerm._ELEMENT_KIND_INLINE) == 0)
                            i = skipWhitespace(i);
                        str = str.substring(0, ok) + str.substring(i);
                        len = str.length;
                        i = ok;
                    } else if ((einfo & DomTerm._ELEMENT_KIND_INLINE) == 0) {
                        let i2 = skipWhitespace(i);
                        if (i2 > i) {
                            str = str.substring(0, i) + str.substring(i2);
                            len = str.length;
                        }
                    }
                    ok = i;
                    if (activeTags.length == 0
                        && (DomTerm._elementInfo(tag, activeTags) & 4) == 0) {
                        this._breakDeferredLines();
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
                            lstart.parentNode.insertBefore(created, lstart);
                            var delta = this.lineStarts.length;
                            this._restoreLineTables(created, line);
                            this.outputContainer = lstart;
                            this.outputBefore = lend;
                            this.resetCursorCache();
                        }
                        start = i;
                        //insert immediately, as new line
                    }
                    continue;
                } else
                    break loop; // invalid - tag mismatch                    
            } else {
                var tag = str.substring(ok+1,i-1);
                var einfo = DomTerm._elementInfo(tag, activeTags);
                if ((einfo & DomTerm._ELEMENT_KIND_ALLOW) == 0)
                    break loop;
                if ((einfo & DomTerm._ELEMENT_KIND_SKIP_FULLY) != 0) {
                    activeTags.push(ok);
                }
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
                    var attrname = str.substring(attrstart,attrend);
                    while (ch <= 32 && i < len)
                        ch = str.charCodeAt(i++);
                    let valstart, valendl
                    if (ch == 61) { // '='
                        if (i == len)
                            break loop; // invalid
                        for (ch = 32; ch <= 32 && i < len; )
                            ch = str.charCodeAt(i++);
                        var quote = i == len ? -1 : ch;
                        if (quote != 34 && quote != 39) // '"' or '\''
                            break loop; // invalid
                        valstart = i;
                        for (;;) {
                            if (i+1 >= len) //i+1 to allow for '/' or '>'
                                break loop; // invalid
                            ch = str.charCodeAt(i++);
                            if (ch == quote)
                                break;
                        }
                        valend = i-1;
                    } else {
                        if (ch == '/' || ch == '>' || ch == '<')
                            i--;
                        valstart = i;
                        valend = i;
                    }
                    let attrvalue = str.substring(valstart, valend);
                    if (! this.allowAttribute(attrname, attrvalue,
                                              einfo, activeTags))
                        break loop;
                    if ((einfo & DomTerm._ELEMENT_KIND_CHECK_JS_TAG) != 0
                        && (attrname=="href" || attrname=="src")) {
                        if (tag == "base" && attrname == "href") {
                            baseUrl = attrvalue;
                        } else if (baseUrl != null
                                   && attrvalue.indexOf(":") < 0) {
                            // resolve attrvalue relative to baseUrl
                            try {
                                attrvalue = new URL(attrvalue, baseUrl).href;
                                i = valstart + attrvalue.length+1;
                            } catch (e) {
                                break loop;
                            }
                            str = str.substring(0, valstart) + attrvalue
                                + str.substring(valend);
                        }
                    }
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
                else if ((einfo & DomTerm._ELEMENT_KIND_EMPTY) != 0)
                    activeTags.pop();
                if ((einfo & DomTerm._ELEMENT_KIND_CONVERT_TO_DIV) != 0) {
                    str = str.substring(0, ok)
                        + "<div" + str.substring(ok+5);
                    len = str.length;
                    i = ok + 5;
                } else if ((einfo & DomTerm._ELEMENT_KIND_SKIP_TAG) != 0) {
                    str = str.substring(0, ok) + str.substring(i);
                    len = str.length;
                    i = ok;
                }
                if ((einfo & DomTerm._ELEMENT_KIND_INLINE) == 0) {
                    let i2 = skipWhitespace(i);
                    if (i2 > i) {
                        str = str.substring(0, i) + str.substring(i2);
                        len = str.length;
                    }
                }
                ok = i;
            }
            break;
        }
    }
    if (ok < len) {
        str = DomTerm.escapeText(str.substring(ok, len));
        str = '<div style="color: red"><b>Inserted invalid HTML starting here:</b>'
            + '<pre style="background-color: #fee">'
            + str + '</pre></div>';
        this._scrubAndInsertHTML(str);
    }
    else if (ok > start) {
        this._unsafeInsertHTML(str.substring(start, ok));
        this.resetCursorCache();
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
    case 31:
        this.topNode.setAttribute("pid", text);
        break;
    case 8:
        var semi = text.indexOf(';');
        if (semi >= 0) {
            let options = text.substring(0, semi);
            let url = text.substring(semi+1);
            let oldLink = DomTerm._isInElement(this.outputContainer, "A");
            if (oldLink) {
                while (this.outputContainer != oldLink)
                    this._popStyleSpan();
                this._popStyleSpan();
            }
            if (url) {
                let newLink = document.createElement("A");
                newLink.setAttribute("href", url);
                newLink.setAttribute("class", "plain");
                this._pushIntoElement(newLink);
                DomTerm._addMouseEnterHandlers(this, newLink.parentNode);
            }
        }
        break;
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
        var sname = code==10 ? "color" : code==11 ? "background-color" : null;
        if (text=='?') {
            var color = "inherit";
            if (sname) {
                color = window.
                    getComputedStyle(DomTerm.focusedTerm.topNode)[sname];
                // convert "rgb(R,G,B)" to "rgb:RRRR/GGGG/BBBB"
                var match = color
                    .match(/rgb[(]([0-9]+),[ ]*([0-9]+),[ ]*([0-9]+)[)]/);
                if (match) {
                    var r = Number(match[1]);
                    var g = Number(match[2]);
                    var b = Number(match[3]);
                    if (! isNaN(r) && ! isNaN(g) && ! isNaN(b)) {
                        color = "rgb:" + (r*256).toString(16)
                            + "/" + (g*256).toString(16)
                            + "/" + (b*256).toString(16);
                    }
                }
                // Emacs looks at background-color to select
                // light or dark theming.
            }
            this.processResponseCharacters("\x1b]"+code+";"+color+"\x1b\\");
        } else {
            if (sname) {
                // convert "rgb:RRRR/GGGG/BBBB" to "rgb(R,G,B)"
                var match = text
                    .match(/rgb:([0-9a-fA-F]+)[/]([0-9a-fA-F]+)[/]([0-9a-fA-F]+)/);
                if (match) {
                    var r =  parseInt(match[1],16);
                    var g =  parseInt(match[2],16);
                    var b =  parseInt(match[3],16);
                    if (! isNaN(r) && ! isNaN(g) && ! isNaN(b)) {
                        text = "rgb(" + Math.round(r/256.0)
                            + "," + Math.round(g/256.0)
                            + "," + Math.round(b/256.0) +")";
                    }
                }
                this.topNode.style[sname] = text;
            }
        }
        break;
    case 71:
        // handle tcsetattr
        var canon = text.indexOf(" icanon ") >= 0;
        var echo = text.indexOf(" echo ") >= 0;
        var extproc = text.indexOf(" extproc ") >= 0;
        if (canon == 0 && this.isLineEditing() && this._inputLine) {
            let text = this.grabInput(this._inputLine);
            this._restoreInputLine();

            let r = new Range();
            r.selectNodeContents(this._inputLine);
            r.setStartBefore(this._caretNode);
            let afterText = r.toString();
            this.handleEnter(null);
            this.reportText(text);
            let afterCount = this.strWidthInContext(afterText, this._inputLine);
            if (afterCount > 0) {
                this.processInputCharacters
                    (this.specialKeySequence("", "D", null).repeat(afterCount));
            }
            this._doDeferredDeletion();
        }
        this._clientWantsEditing = canon ? 1 : 0;
        this._clientPtyEcho = echo ? 1 : 0;
        this._clientPtyExtProc = extproc ? 1 : 0;
        break;
    case 72:
        this._scrubAndInsertHTML(text);
        break;
    case 73:
    case 74:
        this._clientPtyEcho = code != 73;
        if (this._clientWantsEditing)
            return;
        var tb = text.indexOf('\t');
        var keyName = tb < 0 ? text : text.substring(0, tb);
        var kstr = tb < 0 ? "?" : JSON.parse(text.substring(tb+1));
        if (this.verbosity >= 2)
            this.log("OSC KEY k:"+keyName+" kstr:"+this.toQuoted(kstr));
        this._clientWantsEditing = 1;
        this.editorAddLine();
        if (keyName == "paste")
            this.editorInsertString(kstr);
        else
            this.doLineEdit(keyName);
        break;
    case 7:
        // text is pwd as URL: "file://HOST/PWD"
        // Is printed by /etc/profile.d/vte.sh on Fedora
        this.sstate.lastWorkingPath = text;
        break;
    case 777:
        // text is "\u001b]777;COMMAND"
        // Is printed by /etc/profile/vte.sh on Fedora
        break;
    case 88:
        var obj = JSON.parse(text);
        if (typeof obj.passwordHideChar == "string"
            && obj.passwordHideChar.length == 1)
            this.passwordHideChar = obj.passwordHideChar;
        if (typeof obj.passwordShowCharTimeout == "number")
            this.passwordShowCharTimeout = obj.passwordShowCharTimeout;
        if (typeof obj.deferredForDeletionTimeout == "number")
            this.deferredForDeletionTimeout = obj.deferredForDeletionTimeout;
        if (typeof obj.historyStorageKey == "string")
            this.historyStorageKey = obj.historyStorageKey;
        if (typeof obj.historyStorageMax == "number")
            this.historyStorageMax = obj.historyStorageMax;
        break;
    case 89:
        this.setSettings(JSON.parse(text));
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
        break;
    case 102:
        DomTerm.sendSavedHtml(this, this.getAsHTML(true));
        break;
    case 103: // restore saved snapshot
        var comma = text.indexOf(",");
        var rcount = Number(text.substring(0,comma));
        var data = JSON.parse(text.substring(comma+1));
        var main = this._vspacer.previousSibling;
        if (main instanceof Element &&
            main.getAttribute('class') == 'interaction') {
            this._vspacer.insertAdjacentHTML('beforebegin', data.html);
            var parent = main.parentNode;
            parent.removeChild(main);
            this.sstate = data.sstate;
            this.topNode.setAttribute("session-number",
                                      this.sstate.sessionNumber);
            if (data.alternateBuffer)
                this.usingAlternateScreenBuffer = data.alternateBuffer;
            var dt = this;
            this._inputLine = null;
            function findInputLine(node) {
                if (node.getAttribute('std') == 'caret')
                    dt._caretNode = node;
                if (node.classList.contains('editing'))
                    dt._inputLine = node;
                return true;
            };
            this.initial = DomTerm._currentBufferNode(this);
            this._forEachElementIn(parent, findInputLine);
            this.outputBefore =
                this._inputLine != null ? this._inputLine : this._caretNode;
            this.outputContainer = this.outputBefore.parentNode;
            this.resetCursorCache();
            this._restoreLineTables(this.topNode, 0);
            dt._restoreSaveLastLine();
            DomTerm._addMouseEnterHandlers(this);
            dt._breakAllLines();
            var home_node; // FIXME
            var home_offset = -1;
            dt.homeLine = dt._computeHomeLine(home_node, home_offset,
                                              dt.usingAlternateScreenBuffer);
            dt._receivedCount = 0;
            dt._confirmedCount = 0;
            this.updateWindowTitle();
        }
        break;
    case 104:
    case 105:
        var m = text.match(/^([0-9]+),/);
        if (m && DomTerm.layoutAddPane) {
            var paneOp = Number(m[1]);
            text = text.substring(m[1].length+1);
            DomTerm.layoutAddPane(this, paneOp, 0,
                                  {type: 'component',
                                   componentName: code==104?'browser':'view-saved',
                                   url: text });
        }
        break;
    case 108:
        DomTerm.openNewWindow(this, JSON.parse(text));
        break;
    case 110: // start prettyprinting-group
        if (this._currentStyleSpan == this.outputContainer
            && this.outputContainer.classList.contains("term-style"))
            this._popStyleSpan();
        //this._adjustStyle();
        {
            let lineStart = this.lineStarts[this.getAbsCursorLine()];
            if (lineStart._widthMode < DomTerm._WIDTH_MODE_TAB_SEEN)
	        lineStart._widthMode = DomTerm._WIDTH_MODE_TAB_SEEN;
        }
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
        if (ppgroup.parentNode.hasHider)
            ppgroup.setAttribute("domterm-hidden", "false");
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
        let lineStart = this.lineStarts[this.getAbsCursorLine()];
        if (lineStart._widthMode < DomTerm._WIDTH_MODE_TAB_SEEN)
            lineStart._widthMode = DomTerm._WIDTH_MODE_TAB_SEEN;
        var line = this._createLineNode(kind);
        text = text.trim();
        if (text.length > 0) {
            try {
                var strings = JSON.parse("["+text+"]");
                let nobreakStr = strings[2];
                if (strings[0]) {
                    line.setAttribute("pre-break", strings[0]);
                }
                if (strings[1]) {
                    line.setAttribute("post-break", strings[1]);
                }
                if (nobreakStr) {
                    var nonbreak = this._createSpanNode();
                    nonbreak.setAttribute("class", "pprint-non-break");
                    nonbreak.appendChild(document.createTextNode(nobreakStr));
                    line.appendChild(nonbreak);
                    let w = this.strWidthInContext(nobreakStr,
                                                    this.outputContainer);
                    if (lineStart._widthColumns !== undefined)
                        lineStart._widthColumns += w;
                    if (this.currentCursorColumn >= 0)
                        this.currentCursorColumn += w;
                }
            } catch (e) {
                this.log("bad line-break specifier '"+text+"' - caught "+e);
            }
        }
        this.insertNode(line);
        if (line.parentNode.hasHider)
            line.setAttribute("domterm-hidden", "false");
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
    case 119:
        this.freshLine();
        this.startCommandGroup(text, 0); // new sibling group
        break;
    case 120:
        this.freshLine();
        this.startCommandGroup(text, 1); // new child group
        break;
    case 121:
        this.freshLine();
        this.startCommandGroup(text, -1); // exit group
        break;
    case 122:
        this.sstate.continuationPromptPattern = text;
        break;
    case 123:
        if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
            this._clientWantsEditing = 1;
        if (this.isLineEditing())
            this.editorContinueInput();
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

DomTerm.escapeText = function(text) {
    // Assume single quote is not used in attributes
    return text.replace(/[&<>"]/g, function(m) { return escapeMap[m]; });
};

DomTerm._homeLineOffset = function(dt) {
    var home_offset = 0;
    while (dt.homeLine - home_offset >= 0) {
        var home_node = dt.lineStarts[dt.homeLine - home_offset];
        if (home_node.nodeName != "SPAN")
            break;
        home_offset++;
    }
    return home_offset;
}

DomTerm._nodeToHtml = function(node, dt, saveMode) {
    var string = "";
    var savedTime = "";
    if (saveMode) {
        var now = new Date();
        savedTime += now.getFullYear();
        var month = now.getMonth() + 1;
        savedTime += (month < 10 ? "-0" : "-") + month;
        var date = now.getDate();
        savedTime += (date < 10 ? "-0" : "-") + date;
        var hours = now.getHours();
        savedTime += (hours < 10 ? " 0" : " ") + hours;
        var minutes = now.getMinutes();
        savedTime += (minutes < 10 ? ":0" : ":") + minutes;
    }

    var home_offset = dt == null ? 0 : DomTerm._homeLineOffset(dt);
    var home_node = dt == null ? null : dt.lineStarts[dt.homeLine - home_offset];

    function formatList(list) {
        for (let i = 0; i < list.length; i++) {
            formatDOM(list[i]); // , namespaces
        }
    }

    function formatDOM(node) {
        var i = 0;
        switch (node.nodeType) {
        case 1: // element
            var tagName = node.tagName.toLowerCase();
            var tagAttributes = node.attributes;
            var prefix = node.prefix;
            var id = node.getAttribute("id");
            var cls = node.getAttribute("class");

            if (tagName == "div") {
                if (cls == "domterm-pre domterm-ruler"
                    || cls == "domterm-spacer"
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

            if (node == home_node)
                s += ' ' + 'home-line="'+home_offset+ '"';

            if (tagAttributes.length) {
                for (i = 0; i < tagAttributes.length; i++) {
                    var aname = tagAttributes[i].name;
                    var avalue = tagAttributes[i].value;
                    if (aname=="line" && tagName=="span") {
                        if (avalue=="soft")
                            skip = true;
                        else if (avalue == "hard") {
                            string += "\n";
                            skip = true;
                        }
                    } else if (aname == "class"
                               && node.classList.contains("domterm")) {
                        avalue = DomTerm._savedSessionClassNoScript;
                        if (saveMode) {
                            if (savedTime)
                                s += ' saved-time="' + savedTime+'"';
                            s += ' saved-version="'+DomTerm.versionString+'"';
                        }
                    }
                    else if (aname=="breaking" && tagName=="span"
                               && node.getAttribute("line"))
                        continue;
                    s += ' ' + aname+ // .toLowerCase() +
                        '="' + DomTerm.escapeText(avalue) + '"';
                }
            }
            if (skip)
                break;
            string += s;
            if (!node.firstChild) {
                if ((DomTerm._elementInfo(tagName) & 0x10) == 0)
                    string += '></'+tagName+'>';
                else
                    string += '/>';
            } else {
                string += '>';
                formatList(node.childNodes);
                string += '<\/' + tagName + '>';
            }
            if (tagName == 'div' || tagName == 'p' || tagName == 'body'
                || tagName == 'pre')
                string += '\n';
            break;
        case 2: // ATTRIBUTE (should only get here if passing in an attribute node)
            string += ' ' + node.name+ // .toLowerCase() +
            '="' + DomTerm.escapeText(node.value) + '"'; // .toLowerCase()
            break;
        case 3: // TEXT
            string += DomTerm.escapeText(node.nodeValue);
            break;
        case 4: // CDATA
            if (node.nodeValue.indexOf(']]'+'>') !== -1) {
                invalidStateError();
            }
            string += '<'+'![CDATA[';
            string += node.nodeValue;
            string += ']]'+'>';
            break;
        case 11: // DOCUMENT_FRAGMENT
            for (let ch = node.firstChild; ch != null; ch = ch.nextSibling)
                string += DomTerm._nodeToHtml(ch);
            break;
        };
    };
    formatDOM(node);
    return string;
}

DomTerm.prototype.getAsHTML = function(saveMode=false) {
    if (saveMode)
        return DomTerm._nodeToHtml(this.topNode, this, saveMode);
    else {
        var string = "";
        var list = this.topNode.childNodes;
        for (let i = 0; i < list.length; i++) {
            string += DomTerm._nodeToHtml(list[i], this, saveMode);
        }
        return string;
    }
};

DomTerm.prototype._doDeferredDeletion = function() {
    var deferred = this._deferredForDeletion;
    if (deferred && deferred.parentNode) {
        this._removeCaret();
        this.outputContainer = deferred.parentNode;
        this.outputContainer.insertBefore(this._caretNode, deferred);
        this.outputBefore = this._caretNode;
        if (deferred.textBefore) {
            this.outputContainer.insertBefore(document.createTextNode(deferred.textBefore), this.outputBefore);
        }
        if (deferred.textAfter) {
            this.outputContainer.insertBefore(document.createTextNode(deferred.textAfter), this.outputBefore ? this.outputBefore.nextSibling : null);
        }
        deferred.normalize;
        deferred.parentNode.removeChild(deferred);
        this._deferredForDeletion = null;
    }
}

/* 'bytes' should be an ArrayBufferView, typically a Uint8Array */
DomTerm.prototype.insertBytes = function(bytes) {
    var len = bytes.length;
    if (this.verbosity >= 2)
        this.log("insertBytes "+this.name+" "+typeof bytes+" count:"+len+" received:"+this._receivedCount);
    while (len > 0) {
        if (this.decoder == null)
            this.decoder = new TextDecoder(); //label = "utf-8");
        var urgent_begin = -1;
        var urgent_end = -1;
        for (var i = 0; i < len; i++) {
            var ch = bytes[i];
            if (ch == DomTerm.URGENT_BEGIN1 && urgent_begin < 0)
                urgent_begin = i;
            else if (ch == DomTerm.URGENT_END) {
                urgent_end = i;
                break;
            }
        }
        var plen = urgent_begin >= 0 && (urgent_end < 0 || urgent_end > urgent_begin) ? urgent_begin
            : urgent_end >= 0 ? urgent_end : len;
        if (urgent_end > urgent_begin && urgent_begin >= 0
            && bytes[urgent_begin+1] == DomTerm.URGENT_BEGIN2) {
            this.pushControlState();
            this.insertString(this.decoder
                              .decode(bytes.slice(urgent_begin+2, urgent_end),
                                      {stream:true}));
            this.popControlState();
            bytes.copyWithin(urgent_begin, urgent_end+1);
            len = len-(urgent_end+1-urgent_begin);
            bytes = bytes.slice(0, len);
        } else {
            if (plen > 0) {
                this.insertString(this.decoder
                                  .decode(bytes.slice(0, plen), {stream:true}));
            }
            // update receivedCount before calling push/popControlState
            this._receivedCount = (this._receivedCount + plen) & DomTerm._mask28;
            if (plen == len) {
                len = 0;
            } else {
                var dlen = plen + 1; // amount consumed this iteration
                bytes = bytes.slice(dlen, len);
                len -= dlen;
                if (plen == urgent_begin)
                    this.pushControlState();
                else //plen == urgent_end
                    this.popControlState();
            }
        }
    }
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
        if (text == null || text.length < 500 || skip) {
            if (this.verbosity >= 2)
                this.log("report RECEIVED "+this._confirmedCount);
            this.reportEvent("RECEIVED", this._confirmedCount);
        }
    }
}

DomTerm.prototype.cancelUpdateDisplay = function() {
    if (this._updateTimer) {
        if (window.requestAnimationFrame)
            cancelAnimationFrame(this._updateTimer);
        else
            clearTimeout(this._updateTimer);
        this._updateTimer = null;
    }
}
DomTerm.prototype.requestUpdateDisplay = function() {
    this.cancelUpdateDisplay();
    if (window.requestAnimationFrame)
        this._updateTimer = requestAnimationFrame(this._updateDisplay);
    else
        this._updateTimer = setTimeout(this._updateDisplay, 100);
}

DomTerm.prototype._requestDeletePendingEcho = function() {
    if (this._deferredForDeletion == null)
        return;
    if (this._deletePendingEchoTimer != null)
        clearTimeout(this._deletePendingEchoTimer);
    var dt = this;
    function clear() { dt._deletePendingEchoTimer = null;
                       dt._doDeferredDeletion(); };
    let timeout = dt.deferredForDeletionTimeout;
    if (timeout)
        this._deletePendingEchoTimer = setTimeout(clear, timeout);
    else
        clear();
}

DomTerm.prototype.insertString = function(str) {
    var slen = str.length;
    if (slen == 0)
        return;
    if (this.verbosity >= 2) {
        //var d = new Date(); var ms = (1000*d.getSeconds()+d.getMilliseconds();
        if (str.length > 200)
            this.log("insertString "+JSON.stringify(str.substring(0,200))+"... state:"+this.controlSequenceState/*+" ms:"+ms*/);
        else
            this.log("insertString "+JSON.stringify(str)+" state:"+this.controlSequenceState/*+" ms:"+ms*/);
    }
    if (this._pagingMode == 2) {
        this.parameters[1] = this.parameters[1] + str;
        return;
    }
    if (this._disableScrollOnOutput && this._scrollNeeded() == this.topNode.scrollTop)
        this._disableScrollOnOutput = false;
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
    // FIXME this breaks selections overlapping the _inputLine
    if (this.useStyledCaret())
        this._removeInputLine();
    var pendingEchoNode = this._deferredForDeletion;
    let pendingEchoBlock = null;
    if (pendingEchoNode) {
        if (! pendingEchoNode.pendingEcho
            || pendingEchoNode.pendingEcho.length == 1)
            pendingEchoNode = null;
        else {
            pendingEchoBlock = this._getOuterBlock(pendingEchoNode);
            let r = document.createRange();
            r.selectNode(pendingEchoBlock);
            r.setEndBefore(pendingEchoNode);
            pendingEchoNode.oldBefore = r.toString();
            r.selectNode(pendingEchoBlock);
            r.setStartAfter(pendingEchoNode);
            pendingEchoNode.oldAfter = r.toString();
        }
        this._doDeferredDeletion();
    }
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
                this.resetTerminal(true, true);
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
            if (ch == 92/*'\\'*/) {
                // check for ST in the form of ESC '\\'
                var p1 = this.parameters[1]
                var len = p1.length;
                if (i > prevEnd) {
                    p1 = p1 + str.substring(prevEnd, i);
                    len += i - prevEnd;
                    prevEnd = i;
                }
                if (len > 0 && p1.charCodeAt(len-1) == 27) {
                    p1 = p1.substring(0,len-1);
                    ch = 0x9c;
                }
                this.parameters[1] = p1;
            }
            if (ch == 7 || ch == 0 || ch == 0x9c) {
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
        case DomTerm.SEEN_CR:
            if (ch != 10)
                this.controlSequenceState = DomTerm.INITIAL_STATE;
            /* falls through */
        case DomTerm.INITIAL_STATE:
            if (DomTerm._doLinkify && DomTerm.isDelimiter(ch)
                && this.linkify(str, prevEnd, i, columnWidth, ch)) {
                prevEnd = i;
                columnWidth = 0;
            }
            switch (ch) {
            case 13: // '\r' carriage return
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                //this.currentCursorColumn = column;
                var oldContainer = this.outputContainer;
                // FIXME adjust for _regionLeft
                if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                    && ! this.usingAlternateScreenBuffer
                    && (this._regionBottom == this.numRows
                        || this.getCursorLine() != this._regionBottom-1)) {
                    if (this._pauseNeeded()) {
                        this.parameters[1] = str.substring(i);
                        this._updateDisplay();
                        this._enterPaging(true);
                        return;
                    }
                    this._fixEmptyLastInputLine();
                    this.cursorLineStart(1);
                    i++;
                } else {
                    this._breakDeferredLines();
                    this.cursorLineStart(0);
                    this.controlSequenceState = DomTerm.SEEN_CR;
                }
                if (oldContainer.firstChild == null
                    && oldContainer != this.outputContainer
                    && (oldContainer.getAttribute("std")
                        || oldContainer == this._currentStyleSpan)) {
                    if (this.outputBefore == oldContainer)
                        this.outputBefore = oldContainer.nextSibling;
                    let parent = oldContainer.parentNode;
                    parent.removeChild(oldContainer);
                }
                prevEnd = i + 1; columnWidth = 0;
                break;
            case 10: // '\n' newline
            case 11: // vertical tab
            case 12: // form feed
                this.insertSimpleOutput(str, prevEnd, i, columnWidth);
                this._breakDeferredLines();
                if (this._pauseNeeded()) {
                    this.parameters[1] = str.substring(i);
                    this._updateDisplay();
                    this._enterPaging(true);
                    return;
                }
                if (this.controlSequenceState == DomTerm.SEEN_CR) {
                    this._fixEmptyLastInputLine();
                    this.controlSequenceState =  DomTerm.INITIAL_STATE;
                }
                this.cursorNewLine((this.sstate.automaticNewlineMode & 1) != 0);
                if (this.isLineEditing())
                    this.editorAddLine();
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
		{
                    this.tabToNextStop(true);
		    let lineStart = this.lineStarts[this.getAbsCursorLine()];
		    if (lineStart._widthMode < DomTerm._WIDTH_MODE_TAB_SEEN)
			lineStart._widthMode = DomTerm._WIDTH_MODE_TAB_SEEN;
                    let col = this.getCursorColumn();
		    if (lineStart._widthColumns !== undefined
                        && col > lineStart._widthColumns)
                        lineStart._widthColumns = col;
		}
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
                if (ch == DomTerm.URGENT_COUNTED && this._savedControlState)
                    this._savedControlState.count_urgent = true;
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

    // Check if output "accounts for" partial prefix of pendingEcho.
    // If so restore deferred pendingEcho for rest of old pendingEcho.
    if (pendingEchoNode
        && pendingEchoBlock == this._getOuterBlock(this.outputContainer)) {
        let oldBefore = pendingEchoNode.oldBefore;
        let oldAfter = pendingEchoNode.oldAfter;
        let newLine = pendingEchoBlock.textContent;
        if (oldBefore.length + oldAfter.length <= newLine.length
            && this.outputBefore != null
            && oldBefore == newLine.substring(0, oldBefore.length)
            && oldAfter == newLine.substring(newLine.length-oldAfter.length)) {
            let newText = newLine.substring(oldBefore.length,
                                            newLine.length-oldAfter.length);
            let oldText = pendingEchoNode.textBefore + pendingEchoNode.textAfter;
            let oldIndex = pendingEchoNode.textBefore.length;
            let r = document.createRange();
            r.selectNode(pendingEchoBlock);
            this._restoreCaretNode();
            r.setEndBefore(this._caretNode);
            let newIndex = r.toString().length - oldBefore.length;
            let delta = newText.length - oldText.length;
            let pendingEcho = pendingEchoNode.pendingEcho;
            let plen = pendingEcho.length;
            let caret = this._caretNode;
            let prevNode = caret.previousSibling;
            let nextNode = caret.nextSibling;
            let insertOnly = true;
            for (let i = plen; --i >= 0; ) {
                if (pendingEcho.charCodeAt(i) < 16) insertOnly = false;
            }
            if (insertOnly && delta > 0 && newIndex == oldIndex + delta
                && (pendingEchoNode.textBefore + pendingEcho.substring(0,delta)
                    == newText.substring(0, newIndex))
                && pendingEchoNode.textAfter == newText.substring(newIndex)) {
                this._addPendingInput(pendingEchoNode.pendingEcho.substring(delta));
            } else if ((newIndex == 0
                        || (prevNode instanceof Text
                            && prevNode.data.length >= newIndex))
                       && (newIndex == newText.length
                           || (nextNode instanceof Text
                               && nextNode.data.length >= newText.length - newIndex))) {
                // slow checking for more complex pendingEcho
                let text = oldText;
                let index = oldIndex;
                for (let i = 0; i < plen; ) {
                    let ch = pendingEcho.charCodeAt(i);
                    if (ch >= 8) {
                        text = text.substring(0, index) + String.fromCharCode(ch) + text.substring(index);
                        index++;
                    } else {
                        let ldelta = 0;
                        let rdelta = 0;
                        switch (ch) {
                        case DomTerm._PENDING_LEFT:
                            ldelta = -1; rdelta = -1; break;
                        case DomTerm._PENDING_RIGHT:
                            ldelta = 1; rdelta = 1; break;
                        case DomTerm._PENDING_LEFT+DomTerm._PENDING_DELETE:
                            ldelta = -1; rdelta = 0; break;
                        case DomTerm._PENDING_RIGHT+DomTerm._PENDING_DELETE:
                            ldelta = 0; rdelta = 1; break;
                        }
                        text = text.substring(0, index+ldelta) + text.substring(index+rdelta);
                        index += ldelta;
                    }
                    if (++i == len)
                        break;
                    if (text == newText && index == newIndex) {
                        // found match.  Note we don't stop the loop,
                        // because a later match is better than a partial match.
                        if (pendingEchoNode.parentNode == null) {
                            DomTerm._deleteDataTail(prevNode, newIndex);
                            DomTerm._deleteData(nextNode,
                                                0, newText.length-newIndex);
                            pendingEchoNode = this._initPendingInput();
                        }
                        pendingEchoNode.textBefore = text.substring(0, index);
                        pendingEchoNode.textAfter = text.substring(index);
                        pendingEchoNode.pendingEcho = pendingEcho.substring(i);
                    }
                }
                if (pendingEchoNode.parentNode != null) {
                    let t1 = text.substring(0, index);
                    let t2 = text.substring(index);
                    let parent = caret.parentNode;
                    if (t1)
                        parent.insertBefore(document.createTextNode(t1), caret);
                    if (t2)
                        parent.appendChild(document.createTextNode(t2));
                }
            }
        }
    }

    if (this._pauseNeeded()) {
        this.parameters[1] = "";
        this.cancelUpdateDisplay();
        this._enterPaging(true);
        this._updateDisplay();
        this.topNode.scrollTop = this._pauseLimit - this.availHeight;
        return;
    }
    this.requestUpdateDisplay();
};

DomTerm.prototype._scrollNeeded = function() {
    var last = this.topNode.lastChild; // ??? always _vspacer
    var lastBottom = last.offsetTop + last.offsetHeight;
    return lastBottom - this.availHeight;
};

DomTerm.prototype._scrollIfNeeded = function() {
    let needed = this._scrollNeeded();
    if (needed > this.topNode.scrollTop) {
        if (this.verbosity >= 3)
            this.log("scroll-needed was:"+this.topNode.scrollTop+" to "
                     +needed);
        if (this._usingScrollBar || this._disableScrollOnOutput)
            this._disableScrollOnOutput = true;
        else
            this.topNode.scrollTop = needed;
    }
}

DomTerm.prototype._enableScroll = function() {
    this._disableScrollOnOutput = false;
    this._scrollIfNeeded();
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
                this.deleteLinesIgnoreScroll(scrollCount);
                this.moveToAbs(this._regionBottom +this.homeLine- 1, 0, true);
            }
        }
    }
};

DomTerm._doLinkify = true;
DomTerm._forceMeasureBreaks = false;

DomTerm.prototype._adjustLines = function(startLine, action) {
    var delta = 0;
    var prevLine = this.lineStarts[startLine];
    var skipRest = false;
    for (var line = startLine+1;  line < this.lineStarts.length;  line++) {
        var lineStart = this.lineStarts[line];
        if (delta > 0) {
            this.lineStarts[line-delta] = this.lineStarts[line];
            this.lineEnds[line-delta-1] = this.lineEnds[line-1];
        }
        let lineAttr = lineStart.getAttribute("line");
        if (action(lineStart, line-delta)) {
            delta++;
        } else
	    prevLine = lineStart;
    }
    if (delta == 0)
        return false;
    // Update line tables
    var lineCount = this.lineEnds.length;
    this.lineEnds[lineCount-delta-1] = this.lineEnds[lineCount-1];
    this.lineStarts.length = lineCount-delta;
    this.lineEnds.length = lineCount-delta;
    return true;
}

// Remove existing soft line breaks.
// FIXME use _adjustLines
DomTerm.prototype._unbreakLines = function(startLine, single=false) {
    var delta = 0;
    var prevLine = this.lineStarts[startLine];
    var skipRest = false;
    for (var line = startLine+1;  line < this.lineStarts.length;  line++) {
        var lineStart = this.lineStarts[line];
        if (delta > 0) {
            this.lineStarts[line-delta] = this.lineStarts[line];
            this.lineEnds[line-delta-1] = this.lineEnds[line-1];
        }
        let lineAttr = lineStart.getAttribute("line");
        if (! this.isSpanNode(lineStart) || ! lineAttr || skipRest) {
            if (single && line > startLine+1) {
                if (delta == 0)
                    break;
                skipRest = true;
            }
            prevLine = lineStart;
            continue;
        }
        if (lineStart.getAttribute("breaking")=="yes") {
            lineStart.removeAttribute("breaking");
            for (var child = lineStart.firstChild;
                 child != null; ) {
                var next = child.nextSibling;
                if (child.classList.contains("pprint-indentation"))
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
                if (prevLine) {
                    if (prevLine._widthColumns !== undefined
                        && lineStart._widthColumns !== undefined)
                        prevLine._widthColumns += lineStart._widthColumns;
                    if (lineStart._widthMode > prevLine._widthMode)
                        prevLine._widthMode = lineStart._widthMode;
                }
            }
            // Remove "soft" "fill" "miser" "space" breaks from the line-table
            delta++;
        } else
	    prevLine = lineStart;
    }
    if (delta == 0)
        return false;
    // Update line tables
    var lineCount = this.lineEnds.length;
    this.lineEnds[lineCount-delta-1] = this.lineEnds[lineCount-1];
    this.lineStarts.length = lineCount-delta;
    this.lineEnds.length = lineCount-delta;
    return true; // FIXME needlessly conservative
}

DomTerm._insertIntoLines = function(dt, el, line) {
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
}

DomTerm.prototype._breakAllLines = function(startLine = -1) {
    // The indentation array is a stack of the following:
    // - a <span> node containing pre-line prefixes; or
    // - an absolute x-position (in pixels)
    var indentation = new Array();

    function addIndentation(dt, el, countColumns) {
        var n = indentation.length;
        var curPosition = 0;
        var goalPosition = 0;
        var insertPosition = el.lastChild;
        if (insertPosition == null
            || insertPosition.nodeName != "SPAN"
            || ! insertPosition.classList.contains("pprint-post-break"))
            insertPosition = null;
        let previousIdentElement = null;
        let previousStartPosition = 0;
        for (var i = 0; ;  ) {
            var indent = i == n ? null : indentation[i++];
            if ((indent == null || indent instanceof Element)
                && goalPosition > curPosition) {
                var span = dt._createSpanNode();
                span.setAttribute("class", "pprint-indentation");
                var left = goalPosition-curPosition;
                span.setAttribute("style",
                                  "padding-left: "+left+"px");
                el.insertBefore(span, insertPosition);
                curPosition = goalPosition;
            }
            if (indent == null)
                break;
            if (indent instanceof Element) {
                let t = indent.getAttribute("value");
                let tprev;
                if (previousIdentElement && t
                    && (tprev = previousIdentElement.getAttribute("value"))) {
                    t = tprev + t;
                    previousIdentElement.setAttribute("value", t);
                    indent = previousIdentElement;
                } else {
                    previousStartPosition = curPosition;
                    indent = indent.cloneNode(false);
                    previousIdentElement = indent;
                    el.insertBefore(indent, insertPosition);
                    if (! t && countColumns)
                        t = el.textContent;
                }
                let w = countColumns
                    ? dt.strWidthInContext(t, el) * dt.charWidth
                    : indent.offsetWidth;
                curPosition = previousStartPosition + w;
                goalPosition = curPosition;
            }
            else {
                if (indent >= curPosition + 0.5)
                    previousIdentElement = null;
                goalPosition = indent;
            }
        }
        if (el.getAttribute("line") != "soft"
            && el.getAttribute("pre-break") == null
            && (el.firstChild == null
                || el.firstChild.nodeName != "SPAN"
                || ! el.firstChild.classList.contains("pprint-pre-break")))
            el.setAttribute("pre-break", ""); // Needed for CSS
        el.setAttribute("breaking", "yes");
        return curPosition;
    };

    // Using two passes is an optimization, because mixing offsetLeft
    // calls with DOM mutation is very expensive.
    // (This is not an issue when countColums us true.)
    //
    // First pass - measure (call offsetLeft) but do not change DOM
    function breakLine1 (dt, start, beforePos, availWidth, countColumns) {
        var pprintGroup = null; // FIXME if starting inside a group

        if (! countColumns) {
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
                    el.measureLeft = measureLeft - dt._topLeft;
                    el.measureWidth = rects[nrects-1].right - measureLeft;
                }
            }
        }
        var beforeCol = dt._topLeft;
        for (var el = start; el != null; ) {
            var lineAttr;
            var skipChildren = false;
            if (el instanceof Element) {
                if (countColumns) {
                    el.measureLeft = beforeCol * dt.charWidth;
                } else {
                    el.measureLeft = el.offsetLeft;
                    el.measureWidth = el.offsetWidth;
                }
            }
            if (el instanceof Text) {
                if (! countColumns)
                    skipChildren = true;
                else if (el.data == '\t')
                    beforeCol = dt.nextTabCol(beforeCol);
                else
                    beforeCol += dt.strWidthInContext(el.data, el);
            } else if (el.classList.contains("wc-node")) {
	        if (countColumns)
	            beforeCol += 2;
                skipChildren = true;
	    } else if (dt.isObjectElement(el)) {
                skipChildren = true;
            } else if (el.nodeName == "SPAN"
                       && (lineAttr = el.getAttribute("line")) != null) {
                if ((lineAttr == "hard" || lineAttr == "soft")
                    && el.outerPprintGroup == null) {
                    skipChildren = true;
                    break;
                }
                if (lineAttr == "linear") {
                    var group = el.outerPprintGroup;
                    var sectionEnd = group ? group.sectionEnd : null;
                    if (! sectionEnd)
                        sectionEnd = dt.lineEnds[line];
                }
            } else if (el.classList.contains("pprint-indent")) {
                skipChildren = true;
                el.pprintGroup = pprintGroup;
            } else if (el.classList.contains("pprint-group")) {
                pprintGroup = el;
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
                    if (countColumns && el instanceof Element)
                        el.measureWidth =
                            beforeCol * dt.charWidth - el.measureLeft;
                    if (next != null) {
                        el = next;
                        break;
                    }
                    el = el.parentNode;
                }
            }
        }
        var end = dt.lineEnds[line];
        end.measureLeft =
            countColumns ?  beforeCol * dt.charWidth : end.offsetLeft;
        end.measureWidth = 0; // end.offsetWidth;
    }

    function breakLine2 (dt, start, beforePos, availWidth, countColumns) {
        // second pass - edit DOM, but don't look at offsetLeft
        var pprintGroup = null; // FIXME if starting inside a group
        // beforePos is typically el.offsetLeft (if el is an element).
        var beforePos = 0;
        // startOffset is the difference (beforePos - beforeMeasure),
        // where beforeMeasure is typically el.measureLeft (if an element).
        // If el is a Text, beforePos and beforeMeasure are calculated.
        var startOffset = 0;
        var sectionStartLine = line;
        var didbreak = true;
        for (var el = start; el != null; ) {
            // startOffset is the value of measureWidth corresponding
            // to the start of the current line.
            var lineAttr;
            var dobreak = false;
            var skipChildren = false;
            var measureWidth = el instanceof Element ? el.measureWidth : 0;
            const isText = el instanceof Text;
            check_fits:
            if (isText || dt.isObjectElement(el)
                || el.classList.contains("wc-node")) {
                skipChildren = true;
                if (isText)
                    dt._normalize1(el);
                next = el.nextSibling;
                var afterMeasure;
                if (next instanceof Element)
                    afterMeasure = next.measureLeft;
                else {
                    var p = el instanceof Element ? el : el.parentNode;
                    afterMeasure = p.measureLeft+p.measureWidth;
                }
                var beforeMeasure = beforePos + startOffset;
                measureWidth = afterMeasure - beforeMeasure;
                var right = afterMeasure - startOffset;
                if (right > availWidth
                    && (beforePos > 0 || isText)) {
                    var lineNode = dt._createLineNode("soft");
                    var indentWidth;
                    var oldel = el;
                    if (isText) {
                        el.parentNode.insertBefore(lineNode, el.nextSibling);
                        var rest = dt._breakString(el, lineNode, beforePos,
                                                   right, availWidth, didbreak,
                                                   countColumns);
                        if (rest == "") {
                            // It all "fits", after all.  Can happen in
                            // pathological cases when there isn't room for
                            // even a single character but didbreak forces
                            // us to include one character on each line.
                            beforePos = right;
                            el.parentNode.removeChild(lineNode);
                            break check_fits;
                        }
                        DomTerm._insertIntoLines(dt, lineNode, line);
                        el = lineNode;
                        indentWidth = addIndentation(dt, el, countColumns);
                        rest = document.createTextNode(rest);
                        el.parentNode.insertBefore(rest, el.nextSibling);
                        next = rest;
                    } else { // dt.isObjectElement(el) or wc-node
                        DomTerm._insertIntoLines(dt, lineNode, line);
                        el.parentNode.insertBefore(lineNode, el);
                        indentWidth = addIndentation(dt, lineNode, countColumns);
                    }
                    lineNode._widthMode = dt.lineStarts[line]._widthMode;
                    line++;
                    if (! countColumns)
                        beforeMeasure += lineNode.offsetLeft - beforePos;
                    else if (isText) {
                        let beforeColumns = oldel.parentNode == null ? 0
                            : dt.strWidthInContext(oldel.data, el);
                        beforeMeasure += dt.charWidth * beforeColumns;
                        let oldWidthCols = dt.lineStarts[line-1]._widthColumns;
                        if (oldWidthCols) {
                            let beforeCols = beforeMeasure / dt.charWidth;
                            dt.lineStarts[line-1]._widthColumns = beforeCols;
                            lineNode._widthColumns = oldWidthCols - beforeCols;
                        }
                    } else
                        beforeMeasure = el.measureLeft;
                    beforePos = indentWidth;
                    startOffset = beforeMeasure - beforePos;
                    dobreak = true;
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
                    var indentWidth = addIndentation(dt, el, countColumns);
                    startOffset -= indentWidth;
                    beforePos = indentWidth;
                    if (lineAttr != "hard") {
                        DomTerm._insertIntoLines(dt, el, line);
                        line++;
                    }
                    measureWidth = 0;
                }
                sectionStartLine = line;
            } else if (el.classList.contains("pprint-indent")) {
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
            } else if (el.classList.contains("pprint-group")) {
                var previous = el.previousSibling;
                el.indentLengthBeforeBlock = indentation.length;
                el.saveSectionStartLine = sectionStartLine;
                sectionStartLine = line;
                if (previous && previous.nodeName == "SPAN"
                    && previous.classList.contains("pprint-prefix")) {
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
            }
            didbreak = dobreak;
            if (el.firstChild != null && ! skipChildren)
                el = el.firstChild;
            else {
                if (! didbreak)
                    beforePos += measureWidth;
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

    function breakNeeded(dt, lineNo, lineStart) {
        var wmode = lineStart._widthMode;
        // NOTE: If might be worthwhile using widthColums tracking also
        // for the wmode == DomTerm._WIDTH_MODE_TAB_SEEN case,
        // but we have to adjust for pre-break./post-break/non-break
        // and indentation columns. Tabs are need extra care.
        if (! DomTerm._forceMeasureBreaks
            && wmode < DomTerm._WIDTH_MODE_TAB_SEEN
            && lineStart._widthColumns !== undefined) {
            return lineStart._widthColumns > dt.numColumns;
        }
        var end = dt.lineEnds[lineNo];
        return end != null && end.offsetLeft > dt.availWidth;
    }

    if (startLine < 0) {
        startLine = 0;
        if (this.usingAlternateScreenBuffer) {
            if (this.initial && this.initial.saveLastLine >= 0) // paranoia
                startLine = this.initial.saveLastLine;
            else
                startLine = this.homeLine;
        }
    }

    var changed = this._unbreakLines(startLine);

    for (var line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start.classList.contains("domterm-opaque"))
            continue;
        var end = this.lineEnds[line];
        if (start.alwaysMeasureForBreak || breakNeeded(this, line, start)) {
            changed = true; // FIXME needlessly conservative
            start.breakNeeded = true;
            var first;
            if (this.isBlockNode(start))
                first = start.firstChild;
            else {
                while (start.nextSibling == null)
                    start = start.parentNode;
                first = start.nextSibling;
            }
            var countColumns = ! DomTerm._forceMeasureBreaks
                && start._widthMode < DomTerm._WIDTH_MODE_VARIABLE_SEEN;
            breakLine1(this, first, 0, this.availWidth, countColumns);
        }
    }
    for (var line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start.breakNeeded) {
            start.breakNeeded = false;
            var first;
            if (this.isBlockNode(start))
                first = start.firstChild;
            else {
                while (start.nextSibling == null)
                    start = start.parentNode;
                first = start.nextSibling;
            }
            var countColumns = !DomTerm._forceMeasureBreaks
                && start._widthMode < DomTerm._WIDTH_MODE_VARIABLE_SEEN;
            breakLine2(this, first, 0, this.availWidth, countColumns);
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

DomTerm.prototype._breakString = function(textNode, lineNode, beforePos, afterPos, availWidth, forceSomething, countColumns) {
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
    if (countColumns) {
        var col = Math.floor((availWidth-beforePos) / dt.charWidth);
        goodLength = this.wcwidth.columnToIndexInContext(textData, 0, col,
                                                         textNode);
        badLength = 0;
    }
    // Binary search for split point (only if !countColumns)
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
    if (forceSomething && goodLength == 0) {
        var ch0len = 1;
        if (textLength >= 2) {
            // check for surrogates (FIXME better to handle grapheme clusters)
            var ch0 = textData.charCodeAt(0);
            var ch1 = textData.charCodeAt(1);
            if (ch0 >= 0xD800 && ch0 <= 0xDBFF
                && ch1 >= 0xdc00 && ch1 <= 0xdfff)
                ch0len = 2;
        }
        goodLength = ch0len;
    }
    if (goodLength == 0)
        textNode.parentNode.removeChild(textNode);
    else if (textNode.data.length != goodLength) {
        if ((this.sstate.wraparoundMode & 2) != 0) {
            textNode.data = textData.substring(0, goodLength);
        } else {
            // FIXME handle surrogates
            textData = (textData.substring(0, goodLength-1)
                        + textData.substring(textLength-1));
            textNode.data = textData;
            return "";
        }
    }

    return goodLength < textLength ? textData.substring(goodLength) : "";
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
    if (this.sstate.insertMode) {
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
            str = this._breakString(textNode, this.lineEnds[absLine], 0, right, this.availWidth, false, false/*FIXME-countColumns*/);
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
    let column = this.currentCursorColumn;
    if (column >= 0)
        this.currentCursorColumn = (column += widthInColumns);
    else
        column = this.getCursorColumn();
    let lineStart = this.lineStarts[absLine];
    if (lineStart._widthColumns !== undefined
        && lineStart._widthColumns < column)
        lineStart._widthColumns = column;
};

DomTerm.prototype._updateLinebreaksStart = function(absLine, requestUpdate=false) {
    // Contending optimizations:
    // If we're on the last line, we may be doing bulk output,
    // so avoid accessing offsetLeft (expensive because it forces layout).
    // If we're not on the last, we may be doing cursor adressing,
    // and we want to avoid calling _breakAllLines needlessly.
    if (this._deferredLinebreaksStart < 0
        && (absLine == this.lineEnds.length - 1
            || (this.lineEnds[absLine] != null
                // FIXME maybe use _widthColumns
                && this.lineEnds[absLine].offsetLeft > this.availWidth)))
        this._deferredLinebreaksStart = absLine;
    if (requestUpdate)
        this.requestUpdateDisplay();
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
    if (! this._replayMode) {
        if (this.verbosity >= 3)
            this.log("processResponse: "+JSON.stringify(str));
        this.processInputCharacters(str);
    }
};

DomTerm.prototype.reportText = function(text, suffix) {
    if (this.sstate.bracketedPasteMode)
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
    let oldInput = this._inputLine;
    let passwordField = oldInput.classList.contains("noecho")
        && this.sstate.hiddenText;
    var text = passwordField ? this.sstate.hiddenText
        : this.grabInput(this._inputLine);
    this.handleEnter(text);
    if (passwordField) {
        this.sstate.hiddenText = undefined;
        while (oldInput.firstChild)
            oldInput.removeChild(oldInput.firstChild);
        if (this.outputContainer == oldInput)
            this.outputBefore = null;
    }
    this._restoreCaret();
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
    else if ((this.sstate.applicationCursorKeysMode && param == "") || param == "O")
        return "\x1BO"+last;
    else
        return csi+param+last;
};

DomTerm.prototype.keyEnterToString  = function() {
    if ((this.sstate.automaticNewlineMode & 2) != 0)
        return "\r\n";
    else
        return "\r";
}

DomTerm.prototype.keyDownToString = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    switch (key) {
    case 8: /* Backspace */ return "\x7F";
    case 9: /* Tab */   return event.shiftKey ? "\x1B[Z" : "\t";
    case 13: /* Return/Enter */
        return event.altKey ? "\x1B\r" : this.keyEnterToString();
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
        if (event.ctrlKey) {
            var code = -1;
            if (key >=65 && key <= 90)
                code = key-64;
            if (key >= 219 && key <= 222)
                code = key-192;
            if (key == 32 || event.key=="@")
                code = 0;
            if (event.key == "?")
                code = 127;
            if (event.key=="^" || event.key=="~" || event.key=="`")
                code = 30;
            if (event.key=="_")
                code = 31;
            if (code >= 0)
                return String.fromCharCode(code);
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
    let editing = this.isLineEditing();
    let nl_asis = true; // leave '\n' as-is (rather than convert to '\r')?
    if (true) { // xterm has an 'allowPasteControls' flag
        let raw = str;
        let len = raw.length;
        str = "";
        let start = 0;
        for (let i = 0; ; i++) {
            let ch = i >= len ? -1 : raw.charCodeAt(i);
            if ((ch < 32 && ch != 8 && ch != 9 && ch != 13
                 && ! (ch == 10 && nl_asis))
                || (ch >= 128 && ch < 160)
                || ch < 0) {
                str += raw.substring(start, i);
                if (ch == 10)
                    str += this.keyEnterToString();
                start = i + 1;
            }
            if (ch < 0)
                break;
        }
    }

    if (editing) {
        this.editorInsertString(str);
    } else {
        this._addPendingInput(str);
        if (this.sstate.bracketedPasteMode || this._lineEditingMode != 0)
            this.reportText(str, null);
        else
            this.reportKeyEvent("paste", str);
    }
};

DomTerm.copyLink = function(element=DomTerm._contextLink) {
    if (element instanceof Element) {
        let href = element.getAttribute("href");
        if (href)
            DomTerm.copyText(href);
    }
}
DomTerm.copyText = function(str) {
    var container = document.firstElementChild.lastChild;
    var element = document.createElement("span");
    element.appendChild(document.createTextNode(str));
    element.setAttribute("style", "position: fixed");
    container.appendChild(element);
    DomTerm.copyElement(element);
    container.removeChild(element);
}

DomTerm.copyElement = function(element=DomTerm._contextLink) {
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    DomTerm.doCopy();
    selection.removeAllRanges();
}

DomTerm.doContextCopy = function() {
    if (DomTerm._contextLink && window.getSelection().isCollapsed)
        DomTerm.copyElement();
    else
        DomTerm.doCopy();
}

DomTerm.doPaste = function(dt=DomTerm.focusedTerm) {
    let sel = document.getSelection();
    if (sel.rangeCount == 0)
        sel.collapse(dt._caretNode, 0);
    if (dt != null)
        dt.maybeFocus();
    return document.execCommand("paste", false);
};

DomTerm._selectionAsHTML = function(sel = window.getSelection()) {
    var hstring = "";
    for(var i = 0; i < sel.rangeCount; i++) {
        var fragment = sel.getRangeAt(i).cloneContents();
        hstring += DomTerm._nodeToHtml(fragment, null, false);
    }
    return hstring;
}

DomTerm.doCopy = function(asHTML=false) {
    function handler (event){
        var sel = window.getSelection();
        var html = DomTerm._selectionAsHTML(sel);
        if (asHTML) {
            event.clipboardData.setData('text/plain', html);
        } else {
            event.clipboardData.setData('text/plain', sel.toString());
            event.clipboardData.setData('text/html', html);
        }
        event.preventDefault();
        document.removeEventListener('copy', handler, true);
    }
    document.addEventListener('copy', handler, true);
    return document.execCommand("copy", false);
};

DomTerm.prototype.doSaveAs = function() {
    var dt = this;
    this._pickSaveFile(function(fname) {
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
    var result = "[";
    for (var i = 0; i < count; i++) {
        if (i > 0)
            result = result + ",";
        result = result + JSON.stringify(rules[i].cssText);
    }
    return result+"]";
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
    DomTerm._checkStyleResize(this);
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
    parent.insertBefore(ownerNode, following);
    if (value) {
        ownerNode.appendChild(document.createTextNode(value));
        DomTerm._checkStyleResize(this);
    }
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
    DomTerm._checkStyleResize(this);
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
    if (this.isLineEditing())
        this.editorAddLine();
    this._restoreInputLine();
    if (wasEditing && ! this.isLineEditing()) {
        this._sendInputContents();
    }
    this.sstate.automaticNewlineMode = this.clientDoesEcho ? 0 : 3;
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
    DomTerm.inputModeChanged(this, mode);
    this._displayInputModeWithTimeout(displayString);
}

DomTerm.prototype._sendInputContents = function() {
    this._doDeferredDeletion();
    if (this._inputLine != null) {
        var text = this.grabInput(this._inputLine);
        this._deferredForDeletion = this._inputLine;
        this._requestDeletePendingEcho();
        this._addPendingInput(text);
        this.reportText(text);
    }
}

DomTerm.inputModeChanged = function(dt, mode) {
    dt.reportEvent("INPUT-MODE-CHANGED", '"'+String.fromCharCode(mode)+'"');
}

DomTerm.prototype._pushToCaret = function() {
    let saved = {
        before: this.outputBefore, container: this.outputContainer };
    this.outputBefore = this._caretNode;
    this.outputContainer = this._caretNode.parentNode;
    this.resetCursorCache();
    return saved;
}

DomTerm.prototype._popFromCaret = function(saved) {
    this.outputBefore = saved.before;
    this.outputContainer = saved.container;
    this.resetCursorCache();
}

DomTerm.commandMap = new Object();
DomTerm.commandMap['paste-text'] = function(dt, key) {
    DomTerm.doPaste(dt);
    return true; }
DomTerm.commandMap['backward-char'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "move", "char");
    return true; }
DomTerm.commandMap['backward-word'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "move", "word");
    return true; }
DomTerm.commandMap['forward-char'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "move", "char");
    return true; }
DomTerm.commandMap['forward-word'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "move", "word");
    return true; }
DomTerm.commandMap['backward-char-extend'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "extend", "char");
    return true; }
DomTerm.commandMap['backward-word-extend'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "extend", "word");
    return true; }
DomTerm.commandMap['forward-char-extend'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "extend", "char");
    return true; }
DomTerm.commandMap['forward-word-extend'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "extend", "word");
    return true; }
DomTerm.commandMap['backward-delete-char'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "delete", "char");
    return true; }
DomTerm.commandMap['backward-delete-word'] = function(dt, key) {
    dt.editorBackspace(dt.numericArgumentGet(), "delete", "word");
    return true; }
DomTerm.commandMap['forward-delete-char'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "delete", "char");
    return true; }
DomTerm.commandMap['forward-delete-word'] = function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "delete", "word");
    return true; }
DomTerm.commandMap['beginning-of-line'] = function(dt, key) {
    dt.editorMoveStartOrEndLine(false); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['end-of-line'] = function(dt, key) {
    dt.editorMoveStartOrEndLine(true); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['beginning-of-line-extend'] = function(dt, key) {
    dt.editorMoveStartOrEndLine(false, "extend"); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['end-of-line-extend'] = function(dt, key) {
    dt.editorMoveStartOrEndLine(true, "extend"); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['beginning-of-input'] = function(dt, key) {
    dt.editorMoveHomeOrEnd(false); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['end-of-input'] = function(dt, key) {
    dt.editorMoveHomeOrEnd(true); dt._numericArgument = null;
    return true; }
DomTerm.commandMap['up-line-or-history'] = function(dt, key) {
    if (! dt.editorMoveLines(true, dt.numericArgumentGet()))
        dt.historyMove(-1);
    return true;
}
DomTerm.commandMap['down-line-or-history'] = function(dt, key) {
    if (! dt.editorMoveLines(false, dt.numericArgumentGet()))
        dt.historyMove(1)
    return true;
}
DomTerm.commandMap['ignore-action'] = function(dt, key) {
    return true; }
DomTerm.commandMap['default-action'] = function(dt, key) {
    return false; }
DomTerm.commandMap['accept-line'] = function(dt, key) {
    dt.processEnter();
    if (dt._lineEditingMode == 0 && dt.autoLazyCheckInferior)
        dt._clientWantsEditing = 0;
    return true; }
DomTerm.commandMap['insert-newline'] = function(dt, key) {
    dt.editorInsertString("\n");
    return true; }
DomTerm.commandMap['backward-search-history'] = function(dt, key) {
    dt.showMiniBuffer("backward history search: \u2018", "\u2019");
    function search(mrecords, observer) {
        dt.historySearch(dt._miniBuffer.textContent);
    }
    let observer = new MutationObserver(search);
    observer.observe(dt._miniBuffer,
                     { attributes: false, childList: true, characterData: true, subtree: true });
    dt._miniBuffer.observer = observer;
    dt._searchMode = true;
    dt.historySearchForwards = false;
    dt.historySearchStart =
        dt.historyCursor < 0 ? dt.history.length
        : dt.historyCursor;
    return true;
}

// "Mod-" is Cmd on Mac and Ctrl otherwise.
DomTerm.lineEditKeymapDefault = new browserKeymap({
    "Ctrl-R": "backward-search-history",
    "Mod-V": "paste-text",
    "Ctrl-Shift-V": "paste-text",
    "Left": 'backward-char',
    "Mod-Left": 'backward-word',
    "Right": 'forward-char',
    "Mod-Right": 'forward-word',
    "Shift-Left": "backward-char-extend",
    "Shift-Mod-Left": "backward-word-extend",
    "Shift-Right": "forward-char-extend",
    "Shift-Mod-Right": "forward-word-extend",
    "Shift-End": "end-of-line-extend",
    "Shift-Home": "beginning-of-line-extend",
    //"Shift-Mod-Home": "beginning-of-input-extend",
    //"Shift-Mod-End": "end-of-input-extend",
    "Backspace": "backward-delete-char",
    "Mod-Backspace": "backward-delete-word",
    "Delete": "forward-delete-char",
    "Mod-Delete": "forward-delete-word",
    //"Mod-Home": "beginning-of-input",
    //"Mod-End": "end-of-input",
    "Ctrl-Home": "beginning-of-input",
    "Ctrl-End": "end-of-input",
    "End": "end-of-line",
    "Home": "beginning-of-line",
    "End": "end-of-line",
    "Down": "down-line-or-history",
    "Up": "up-line-or-history",
    "Enter": "accept-line",
    "Alt-Enter": "insert-newline",
    // The following should be controlled by a user preference
    // for emacs-like keybindings. FIXME
    "Alt-B": "backward-word",
    "Alt-F": "forward-word",
    "Ctrl-A": "beginning-of-line",
    "Ctrl-B": "backward-char",
    "Ctrl-D": "forward-delete-char",
    "Ctrl-E": "end-of-line",
    "Ctrl-F": "forward-char",
    "Ctrl-N": "down-line-or-history",
    "Ctrl-P": "up-line-or-history"
}, {});
DomTerm.lineEditKeymap = DomTerm.lineEditKeymapDefault;

DomTerm.prototype.doLineEdit = function(keyName) {
    if (this.verbosity >= 2)
        this.log("doLineEdit "+keyName);

    this.editorAddLine();
    let keymaps = [ DomTerm.lineEditKeymap ];
    for (let map of keymaps) {
        let commandName = map.lookup(keyName);
        if (commandName) {
            let command = DomTerm.commandMap[commandName];
            if (command) {
                let ret = command(this, keyName);
                if (ret) {
                    return ret;
                }
            }
        }
    }
    if (keyName.length >= 3 && keyName.charCodeAt(0) == 39/*"'"*/) {
        let ch = keyName.length == 3 ? keyName.charCodeAt(1) : -1;
        if (ch >= 0 && ch < 32)
            return false;
        let str = keyName.substring(1, keyName.length-1);
        let sel = window.getSelection();
        if (! sel.isCollapsed) {
            this.editorBackspace(1, "delete", "char");
        }
        let count = this.numericArgumentGet();
        if (count >= 0)
            str = str.repeat(count);
        this.editorInsertString(str);

        if (this._inputLine.classList.contains("noecho")
            && ! this.sstate.hiddenText
            && this._isAnAncestor(this._caretNode, this._inputLine) // paranoia
            && this.passwordShowCharTimeout) {
            // Temporarily display inserted char(s), with dots for other chars.
            // After timeout all chars shown as dots.
            let r = new Range();
            r.selectNodeContents(this._inputLine);
            let wlength = DomTerm._countCodePoints(r.toString());
            r.setEndBefore(this._caretNode);
            let wbefore = DomTerm._countCodePoints(r.toString());
            let ctext = this._inputLine.textContent;
            let wstr = DomTerm._countCodePoints(str);
            let before = this.passwordHideChar.repeat(wbefore-wstr);
            let after = this.passwordHideChar.repeat(wlength-wbefore);
            DomTerm._replaceTextContents(this._inputLine, before + str + after);
            this.sstate.hiddenText = ctext;
            let dt = this;
            setTimeout(function() { dt._suppressHidePassword = false;
                                    dt._hidePassword(); },
                       this.passwordShowCharTimeout);
            this._suppressHidePassword = true;
        }
        return true;
    }
    return false;
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

DomTerm.saveFileCounter = 0;

/* Request from user name for file to save.
   Then call callname(fname) is user-supplied name.
   If user cancels then fname will have a false value (null or undefined).
*/
DomTerm.prototype._pickSaveFile = function(callback) {
    var fname = "domterm-saved-"+(++DomTerm.saveFileCounter)+".html";
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

DomTerm.sendSavedHtml = function(dt, html) {
    dt.reportEvent("GET-HTML", JSON.stringify(html));
}

DomTerm.openNewWindow = function(dt, options={}) {
    let url = options.url;
    if (! url)
        url = DomTerm.mainLocation;
    let width = options.width || DomTerm.defaultWidth;
    let height = options.height || DomTerm.defaultHeight;
    if (options.geometry) {
        let m = options.geometry.match(/geometry=([0-9][0-9]*)x([0-9][0-9]*)/);
        if (m) {
            width = geometry[1];
            height = geometry[2];
        }
    }

    if (DomTerm.isElectron()) {
        const { ipcRenderer } = nodeRequire('electron');
        ipcRenderer.send('request-mainprocess-action',
                         { action: 'new-window', width: width, height: height, url: url });
    } else if (true) {
        window.open(url, "_blank", "width="+width+",height="+height);
    } else
        dt.reportEvent("OPEN-WINDOW",
                       url + (url.indexOf('#') < 0 ? '#' : '&') +
                       ((width && height) ? ("geometry="+width+"x"+height) : "")
                      );
}

DomTerm.prototype._isOurEvent = function(event) {
    //return this._isAnAncestor(event.target, this.topNode);
    return this.hasFocus();
}

DomTerm.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event+" name:"+browserKeymap.keyName(event));
    let keyName = browserKeymap.keyName(event);
    if (! keyName && event.key)
        keyName = event.key;
    if (! this._isOurEvent(event))
        return;
    if (this._composing > 0 || event.which === 229)
        return;
    if (this._composing == 0)
        this._composing = -1;

    if (event.ctrlKey && event.shiftKey) {
        switch (key) {
        case 65: // Control-Shift-A
            if (this.enterMuxMode) {
                this.enterMuxMode();
                event.preventDefault();
            }
            return;
        case 73: // Control-shift-I
            return;
        case 76: // Control-shift-L
            this.nextInputMode();
            event.preventDefault();
            return;
        case 77: // Control-Shift-M
            if (this._currentlyPagingOrPaused()) {
                this._pauseContinue();
                this._exitPaging();
            } else
                this._enterPaging(true);
            event.preventDefault();
            return;
        case 78: // Control-Shift-N
            DomTerm.openNewWindow(this);
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
        }
    }
    if (event.ctrlKey && (event.shiftKey || this.isLineEditing())) {
        switch (key) {
        case 33 /*PageUp*/:
        case 34 /*PageDown*/:
            this._disableScrollOnOutput = true;
            this._pagePage(key == 33 ? -1 : 1);
            event.preventDefault();
            return;
        case 35 /*End*/:
            this._pageBottom();
            event.preventDefault();
            return;
        case 36 /*Home*/:
            this._disableScrollOnOutput = true;
            this._pageTop();
            event.preventDefault();
            return;
        case 38 /*Up*/:
        case 40 /*Down*/:
            this._disableScrollOnOutput = true;
            this._pageLine(key == 38 ? -1 : 1);
            event.preventDefault();
            return;
        case 67: // Control[-Shift]-C
            if (! event.shiftKey && document.getSelection().isCollapsed)
                break;
            if (DomTerm.doCopy())
                event.preventDefault();
            return;
        case 86: // Control-Shift-V
            // Google Chrome doesn't allow execCommand("paste") but Ctrl-Shift-V
            // works by default.  In Firefox, it's the other way round.
            if (DomTerm.doPaste(this))
                event.preventDefault();
            return;
        case 88: // Control[-Shift]-X
            if (this.isLineEditing()) {
                // FIXME narrow selection to _inputLine
                if (DomTerm.doCopy())
                    event.preventDefault();
                this.editorBackspace(1, "delete", "char");
                return;
            }
            break;
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
        if (this._searchMode) {
            if (keyName == "Backspace" || keyName == "Delete"
                || keyName == "Left" || keyName == "Right"
                || keyName == "Ctrl" || keyName == "Alt") {
                return;
            }
            if (keyName == "Ctrl-R" || keyName == "Ctrl-S") {
                this.historySearchForwards = keyName == "Ctrl-S";
                this.historySearchStart =
                    this.historyCursor >= 0 ? this.historyCursor
                    : this.history.length;
                let str = this._miniBuffer.textContent;
                if (str == "") {
                    str = this.historySearchSaved;
                    this._miniBuffer.innerText = str;
                }
                this.historySearch(str);
                event.preventDefault();
                if (this._displayInfoWidget
                    && this._displayInfoWidget.firstChild instanceof Text) {
                    let prefix = this._displayInfoWidget.firstChild;
                    let dirstr = this.historySearchForwards ? "forward" : "backward";
                    let m = prefix.data.match(/^(.*)(forward|backward)(.*)$/);
                    if (m)
                        prefix.data = m[1] + dirstr + m[3];
                }
                return;
            }
            if (keyName == "Esc" || keyName == "Enter" || keyName == "Tab"
                || keyName == "Down" || keyName == "Up"
                || event.ctrlKey || event.altKey) {
                DomTerm.displayInfoInWidget(null, this);
                this.historySearchSaved = this._miniBuffer.textContent;
                this.historyAdd(this._inputLine.textContent, false);
                this._searchMode = false;
                if (this._miniBuffer.observer) {
                    this._miniBuffer.observer.disconnect();
                    this._miniBuffer.observer = undefined;
                }
                this._miniBuffer = null;
                if (keyName == "Tab") {
                    this.maybeFocus();
                    event.preventDefault();
                    return;
                }
            }
        }
        if (event.altKey
            && ((key >= 48 && key <= 57)
                || (key==189 && this._numericArgument == null))) {
            let c = String.fromCharCode(key == 189 ? 45 : key);
            this._numericArgument = this._numericArgument == null ? c
                : this._numericArgument + c;
            event.preventDefault();
        }
        else if (event.ctrlKey
                 && (key == 67 // ctrl-C
                     || key == 90 // ctrl-Z
                     || (key == 68 // ctrl-D
                         && this.grabInput(this._inputLine).length == 0))) {
            event.preventDefault();
            if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
                this._clientWantsEditing = 0;
            this.reportKeyEvent(keyName,
                                this.keyDownToString(event));
        } else {
            if (this.doLineEdit(keyName))
                event.preventDefault();
        }
    } else {
        var str = this.keyDownToString(event);
        if (str) {
            if (this.scrollOnKeystroke)
                this._enableScroll();
            event.preventDefault();
            if (keyName == "Left" || keyName == "Right") {
                this._editPendingInput(keyName == "Right", false);
            }
            if (keyName == "Backspace" || keyName == "Delete") {
                this._editPendingInput(keyName == "Delete", true);
            }
            if (key == 13 && event.altKey)
                this.reportText(str, null);
            else
                this._respondSimpleInput(str, keyName);
        }
    }
};

DomTerm.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    if (this.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" name:"+browserKeymap.keyName(event));
    if (! this._isOurEvent(event))
        return;
    let keyName = browserKeymap.keyName(event);
    if (this._composing > 0)
        return;
    if (this._currentlyPagingOrPaused()) {
        this._pageKeyHandler(event, key, true);
        return;
    }
    if (this._muxMode) {
        this._muxKeyHandler(event, key, true);
        return;
    }
    if (this.scrollOnKeystroke)
        this._enableScroll();
    this._adjustPauseLimit(this.outputContainer);
    if (this.isLineEditing()) {
        if (this._searchMode) {
            this._miniBuffer.focus();
            return;
        }
        else if (this.doLineEdit(keyName))
            event.preventDefault();
    } else {
        if (event.which !== 0
            && key != 8
            && ! event.ctrlKey) {
            var str = String.fromCharCode(key);
            this._addPendingInput(str);
            this._respondSimpleInput (str, keyName);
            event.preventDefault();
        }
    }
};

DomTerm.prototype.inputHandler = function(event) {
    if (this.verbosity >= 2)
        this.log("input "+event+" which:"+event.which+" data:'"+event.data);
    if (event.target == this._inputLine && ! this.isLineEditing()
        && this._inputLine != this._deferredForDeletion) {
        var text = this.grabInput(this._inputLine);
        var ch = this._inputLine.firstChild;
        while (ch != null) {
            var next = ch.nextSibling;
            this._inputLine.removeChild(ch);
            ch = next;
        }
        this._addPendingInput(text);
        this.reportText(text, null);
    }
};

// For debugging: Checks a bunch of invariants
DomTerm.prototype._checkTree = function() {
    var node = DomTerm._currentBufferNode(this, false);
    var dt = this;
    function error(str) {
        dt.log("ERROR: "+str);
    };
    var parent = node.parentNode;
    var cur = node;
    var istart = 0;
    var iend = 0;
    var nlines = this.lineStarts.length;
    if ((typeof this.currentAbsLine != "number")
       || (this.currentAbsLine >= 0
           && this.currentAbsLine >= nlines))
        error("bad currentAbsLine");
    var isSavedSession = this.isSavedSession();
    if (this._caretNode.parentNode != null && this._inputLine == null
        && this._caretNode != this.outputBefore)
        error("bad _caretNode");
    if ((this.outputBefore
         && this.outputBefore.parentNode != this.outputContainer)
        || this.outputContainer == null
        || (! isSavedSession && this.outputContainer.parentNode == null))
        error("bad outputContainer");
    if (this.inputFollowsOutput && this._inputLine
        && this._inputLine.parentNode && this.outputBefore != this._inputLine)
        error("bad inputLine");
    if (! this._isAnAncestor(this.outputContainer, this.initial))
        error("outputContainer not in initial");
    for (let i = nlines; --i >= this.homeLine; )
        if (! this._isAnAncestor(this.lineStarts[i], this.initial))
            error("line "+i+" not in initial");
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
            if (istart < nlines && this.lineStarts[istart] == cur) {
                if (iend == istart && this.lineEnds[iend] == null)
                    iend++;
                istart++;
            } else if (istart + 1 < nlines && this.lineStarts[istart+1] == cur)
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
    // NOTE this may happen after inserting html
    if (this.lineStarts.length - this.homeLine > this.numRows)
        error("bad homeLine value!");
    if (this.usingAlternateScreenBuffer) {
        var main = DomTerm._currentBufferNode(this, false);
        if (! main || main == this.initial)
            error("missing main-screenbuffer");
        if (this._isAnAncestor(this.initial, main))
            error("alternate-screenbuffer nested in main-screenbuffer");
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

DomTerm._mask28 = 0xfffffff;
DomTerm.usingAjax = false;
DomTerm.usingQtWebEngine = !! location.hash.match(/[#&]qtwebengine/);

// data can be a DomString or an ArrayBuffer.
DomTerm._handleOutputData = function(dt, data) {
    var dlen;
    if (data instanceof ArrayBuffer) {
        dt.insertBytes(new Uint8Array(data));
        dlen = data.byteLength;
        // updating _receivedCount is handled by insertBytes
    } else {
        dt.insertString(data);
        dlen = data.length;
        dt._receivedCount = (dt._receivedCount + dlen) & DomTerm._mask28;
    }
    if (dt._pagingMode != 2 && ! this._replayMode
        && ((dt._receivedCount - dt._confirmedCount) & DomTerm._mask28) > 500) {
        dt._confirmedCount = dt._receivedCount;
        dt.reportEvent("RECEIVED", dt._confirmedCount);
    }
    return dlen;
}

/** Connect using WebSockets */
DomTerm.connectWS = function(name, wspath, wsprotocol, topNode=null) {
    if (name == null) {
        name = topNode == null ? null : topNode.getAttribute("id");
        if (name == null)
            name = "domterm";
    }
    if (topNode == null)
        topNode = document.getElementById(name);
    var wt = new DomTerm(name);
    if (DomTerm.inAtomFlag && DomTerm.isInIFrame()) {
        // Have atom-domterm's DomTermView create the WebSocket.  This avoids
        // the WebSocket being closed when the iframe is moved around.
        wt.topNode = topNode;
        DomTerm.focusedTerm = wt;
        DomTerm.sendParentMessage("domterm-new-websocket", wspath, wsprotocol);
        wt.closeConnection = function() {
             DomTerm.sendParentMessage("domterm-socket-close"); }
        wt.processInputCharacters = function(str) {
            DomTerm.sendParentMessage("domterm-socket-send", str); }
        return;
    }
    var wsocket = new WebSocket(wspath, wsprotocol);
    wsocket.binaryType = "arraybuffer";
    wt.closeConnection = function() { wsocket.close(); };
    wt.processInputCharacters = function(str) {
        /* TEST LATENCY
        let delay = DomTerm._extraDelayForTesting;
        if (delay === undefined)
            DomTerm._extraDelayForTesting = delay = 600;
        if (delay) {
            setTimeout(function() { wsocket.send(str); }, delay);
            return;
        }
        */
        wsocket.send(str);
    };
    wsocket.onmessage = function(evt) {
        DomTerm._handleOutputData(wt, evt.data);
    }
    wsocket.onopen = function(e) {
        wt.reportEvent("VERSION", DomTerm.versionInfo);
        wt.initializeTerminal(topNode);
    };
}

DomTerm._makeWsUrl = function(query=null) {
    var ws = location.hash.match(/ws=([^,&]*)/);
    var url;
    if (DomTerm.server_port==undefined || (ws && ws[1]=="same"))
        url = (location.protocol == "https:" ? "wss:" : "ws:")
            + "//"+location.hostname+":" + location.port + "/replsrc";
    else if (ws)
        url = "ws:"+ws[1];
    else
        url = "ws://localhost:"+DomTerm.server_port+"/replsrc";
    if (query)
        url = url + '?' + query;
    if (DomTerm.server_key)
        url = url + (query ? '&' : '?') + 'server-key=' + DomTerm.server_key;
    return url;
}

DomTerm.connectHttp = function(node, query=null) {
    var url = DomTerm._makeWsUrl(query);
    DomTerm.connectWS(null, url, "domterm", node);
}

DomTerm.isDelimiter = (function() {
    let delimiterChars = '()<>[]{}`;|\'"';
    let mask1 = 0; // mask for char values 32..63
    let mask2 = 0; // mask for char values 64..95
    let mask3 = 0; // mask for char values 96..127
    for (let i = delimiterChars.length; --i >= 0; ) {
        let ch = delimiterChars.charCodeAt(i);
        if (ch >= 32 && ch < 64)
            mask1 |= 1 << (ch - 32);
        else if (ch >= 64 && ch < 96)
            mask2 |= 1 << (ch - 64);
        else if (ch >= 96 && ch < 128)
            mask3 |= 1 << (ch - 96);
    }
    return function(ch) {
        if (ch < 64)
            return ch <= 32 ? true : (mask1 & (1 << (ch - 32))) != 0;
        else if (ch < 128)
            return ch < 96 ? (mask2 & (1 << (ch - 64))) != 0
            : (mask3 & (1 << (ch - 96))) != 0;
        else
            return false;
    }
})();

DomTerm.prototype.linkAllowedUrlSchemes = ":http:https:file:ftp:mailto:";

DomTerm.prototype.linkify = function(str, start, end, columnWidth, delimiter) {
    const dt = this;
    function rindexDelimiter(str, start, end) {
        for (let i = end; --i >= start; )
            if (DomTerm.isDelimiter(str.charCodeAt(i)))
                return i;
        return -1;
    }
    function isURL(str) {
        const m = str.match(/^([a-zA-Z][-a-zA-Z0-9+.]*:)[/]*[^/:].*/);
        return m && dt.linkAllowedUrlSchemes.indexOf(":"+m[1]) >= 0;
    }
    function isEmail(str) {
        return str.match(/^[^@]+@[^@]+\.[^@]+$/);
    }
    let smode = this._getStdMode();
    if (smode == "input" || smode == "prompt" || smode == "hider")
        return false;
    let fstart = rindexDelimiter(str, start, end)+1;
    let fragment = str.substring(fstart > 0 ? fstart : start, end);
    let firstToMove = null;
    if (DomTerm._isInElement(this.outputContainer, "A"))
        return false;
    if (fstart == 0) {
        let previous = this.outputBefore != null ? this.outputBefore.previousSibling
            : this.outputContainer.lastChild;
        for (; previous != null; previous = previous.previousSibling) {
            if (previous instanceof Element) {
                // Allow wc-node (wide characters) and soft line-breaks.
                // Should we allow other Element types?
                if (! (previous.class == "wc-node"
                       || previous.getAttribute("line") == "soft"))
                    return false;
            }
            let pfragment = previous.textContent;
            fstart = rindexDelimiter(pfragment, 0, pfragment.length)+1;
            firstToMove = previous;
            if (fstart > 0) {
                if (! (previous instanceof Text)
                    && fstart < pfragment.length-1)
                    return false;
                fragment = pfragment.substring(fstart) + fragment;
                break;
            }
            fragment = pfragment + fragment;
        }
        if (previous == null) {
            // Check if we're at start of line
            // Roughly equivalue to: this.outputContainer.offsetLeft
            // - but that causes expensive re-flow
            for (let p = this.outputContainer; ! this.isBlockNode(p); ) {
                let pp = p.parentNode;
                if (pp.firstChild != p)
                    return false;
                p = pp;
            }
        }
    }
    let flength = fragment.length;
    if (flength <= 1)
        return false;
    let href = null;
    let m = null;
    let afterLen = 0;
    let afterStr = "";
    // FIXME Only handles "GNU-style" (including javac) error messages.
    // See problemMatcher.ts in vscode source and compile.el in emacs source
    // for a list of other patterns we might consider supporting.
    if (fragment.charCodeAt(flength-1)==58/*':'*/
        // FIXME should handle windows-style filename C:\XXXX
        && ((m = fragment.match(/^([^:]+):([0-9]+:[0-9]+-[0-9]+:[0-9]+):$/)) != null
            || (m = fragment.match(/^([^:]+):([0-9]+:[0-9]+-[0-9]+):$/)) != null
            || (m = fragment.match(/^([^:]+):([0-9]+:[0-9]+):$/)) != null
            || (m = fragment.match(/^([^:]+):([0-9]+):$/)) != null)) {
        afterLen = 1;
        afterStr = ":";
        let fname = m[1];
        let position = m[2];
        if (fname.charCodeAt(0) != 47 /*'/'*/) {
            let dir = this.sstate.lastWorkingPath;
            let m = dir == null ? null : dir.match(/^file:[/][/][^/]*([/].*)$/);
            if (! m)
                return false;
            fname = m[1] + "/" + fname;
        }
        let encoded = "";
        let sl;
        while ((sl = fname.indexOf("/")) >= 0) {
            encoded = encoded + encodeURIComponent(fname.substring(0,sl)) + "/";
            fname = fname.substring(sl+1);
        }
        encoded = encoded + encodeURIComponent(fname);
        href= "file://" + encoded+ "#position=" + position;
    }
    else {
        if (flength > 1) {
            // The characters '.' ',' '?' '!' are allowed in a link,
            // but not as the final character.
            let last = fragment.charCodeAt(flength-1);
            if (last == 46/*'.'*/ || last == 44/*','*/
                || last == 33/*'!'*/ || last == 63/*'?'*/) {
                afterStr = fragment.substring(flength-1, flength);
                fragment = fragment.substring(0, flength-1);
                afterLen = 1;
            }
        }
        if (isURL(fragment))
            href = fragment;
        else if (fragment.startsWith("www.") && isURL("http://"+fragment))
            href = "http://"+fragment;
        else if (isEmail(fragment)) {
            href = "mailto:"+fragment;
        } else
            return false;
    }
    columnWidth -= afterLen;
    if (fstart > start && firstToMove == null) {
        this.insertSimpleOutput(str, start, fstart, -1);
        start = fstart;
        columnWidth = -1;
    }
    let alink = document.createElement("a");
    alink.setAttribute("class", "matched plain");
    alink.setAttribute("href", href);
    this._pushIntoElement(alink);
    if (end-afterLen > start)
        this.insertSimpleOutput(str, start, end-afterLen, columnWidth);
    this.outputContainer = alink.parentNode;
    this.outputBefore = alink.nextSibling;
    let old = alink.firstChild;
    for (let n = firstToMove; n && n != alink; ) {
        let next = n.nextSibling;
        if (n == firstToMove && fstart > 0) {
            next = n.splitText(fstart);
        } else
            alink.insertBefore(n, old);
        n = next;
    }
    DomTerm._addMouseEnterHandlers(this, alink.parentNode);
    if (afterLen > 0) {
        if (end == start && alink.lastChild instanceof Text) {
            let data = alink.lastChild.data;
            if (data.length > afterLen
                && data.charAt(data.length-afterLen) == afterStr)
                alink.lastChild.deleteData(data.length-afterLen, afterLen);
            else
                afterLen = 0;
        }
        if (afterLen > 0)
            this.insertSimpleOutput(afterStr, 0, afterLen, afterLen);
    }
    alink.normalize();
    return true;
}

DomTerm.prototype._currentlyPagingOrPaused = function() {
    return this._pagingMode > 0;
};

function _pagerModeInfo(dt) {
    var prefix =  dt._pagingMode == 2 ? "<b>PAUSED</b>" : "<b>PAGER</b>";
    if (dt._numericArgument) {
        return prefix+": numeric argument: "+dt._numericArgument;
    }
    return prefix+": type SPACE for more; Ctrl-Shift-M to exit paging";
}

DomTerm.prototype._updatePagerInfo = function() {
    if (this.modeLineGenerator != null)
        this._displayInfoMessage(this.modeLineGenerator(this));
    else
        this._clearInfoMessage();
}

DomTerm.prototype._pageScrollAbsolute = function(percent) {
    if (percent < 0)
        percent = 0;
    else if (percent >= 100)
        percent = 100;
    var scrollTop = percent * this._vspacer.offsetTop * 0.01;
    var limit = scrollTop + this.availHeight;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
    var vtop = this._vspacer.offsetTop;
    if (limit > vtop) {// set _displayPostEofPage mode
        var vpad = limit - vtop;
        var maxpad = this.availHeight - charHeight; // matches 'less'
        this._adjustSpacer(vpad > maxMap ? maxpad : vpad);
    }
    this.topNode.scrollTop = scrollTop;
}

DomTerm.prototype._pageScroll = function(delta) {
    var scroll = this.topNode.scrollTop;
    var limit = scroll + this.availHeight + delta;
    var vtop = this._vspacer.offsetTop;
    var extend = limit > this._pauseLimit;
    if (extend)
        this._pauseLimit = limit;
    scroll += delta;
    if (scroll < 0)
        scroll = 0;
    // FIXME actual limit is this._vspacer.offsetTop - availHeight
    // adjusted by vspacer height
    else if (scroll > vtop)
        scroll = vtop;
    // FIXME may do nothing if spacer size is empty
    this.topNode.scrollTop = scroll;
    if (limit > vtop)
        this._pauseContinue();
}

DomTerm.prototype._pagePage = function(count) {
    var amount = count * this.availHeight;
    if (count > 0)
        amount -= this.charHeight;
    else if (count < 0)
        amount += this.charHeight;
    this._pageScroll(amount);
}

DomTerm.prototype._pageLine = function(count) {
    this._pageScroll(count * this.charHeight);
}

DomTerm.prototype._pageTop = function() {
    this.topNode.scrollTop = 0;
}

DomTerm.prototype._pageBottom = function() {
    this.topNode.scrollTop = this._vspacer.offsetTop;
}

DomTerm.prototype._enterPaging = function(pause) {
    // this._displayInputModeWithTimeout(displayString);
    this._pageNumericArgumentClear();
    this._pagingMode = pause ? 2 : 1;
    this.modeLineGenerator = _pagerModeInfo;
    this._updatePagerInfo();
}

DomTerm.prototype._exitPaging = function() {
    this._pagingMode = 0;
    this.modeLineGenerator = null;
    this._updatePagerInfo();
}

DomTerm.toggleAutoPaging = function(dt = DomTerm.focusedTerm) {
    if (dt)
        dt._autoPaging = ! dt._autoPaging;
}

DomTerm.prototype._pageNumericArgumentGet = function(def = 1) {
    var arg = this._numericArgument;
    return arg == null ? def : Number(arg);
}
DomTerm.prototype._pageNumericArgumentClear = function() {
    var hadValue =  this._numericArgument;
    this._numericArgument = null;
    if (hadValue)
        this._updatePagerInfo();
}
DomTerm.prototype._pageNumericArgumentAndClear = function(def = 1) {
    var val = this._pageNumericArgumentGet(def);
    this._pageNumericArgumentClear();
    return val;
}

DomTerm.prototype._pageKeyHandler = function(event, key, press) {
    var arg = this._numericArgument;
    // Shift-PageUp and Shift-PageDown should maybe work in all modes?
    // Ctrl-Shift-Up / C-S-Down to scroll by one line, in all modes?
    if (this.verbosity >= 2)
        this.log("page-key key:"+key+" event:"+event+" press:"+press);
    switch (key) {
        // C-Home start
        // C-End end
    case 13: // Enter
        this._pageLine(this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 33: // Page-up
        // Also Shift-Space
        // Also backspace? DEL? 'b'?
        this._pagePage(- this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 32: // Space
        // ... fall through ...
    case 34: // Page-down
        this._pagePage(this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 36: // Home
        this._pageTop();
        event.preventDefault();
        break;
     case 35: // End
        this._pageBottom();
        event.preventDefault();
        break;
    case 40 /*Down*/:
        // ... fall through ...
    case 38 /*Up*/:
        this._pageLine(key == 38 ? -1 : 1);
        event.preventDefault();
        break;
    case 77: // 'M'
        var oldMode = this._pagingMode;
        if (oldMode==2)
            this._pauseContinue();
        this._enterPaging(oldMode==1);
        event.preventDefault();
        break;
    case 112: // 'p'
    case 37: // '%'
        // MAYBE: 'p' relative to current "group"; 'P' relative to absline 0.
        // MAYBE: 'P' toggle pager/pause mode
        this._pageScrollAbsolute(this._pageNumericArgumentAndClear(50));
        event.preventDefault();
        break;
    case 65: // 'A'
        if (event.shiftKey) {
            DomTerm.toggleAutoPaging(this);
            this._displayInfoWithTimeout("<b>PAGER</b>: auto paging mode "
                                             +(this._autoPaging?"on":"off"));
            event.preventDefault();
        }
        break;
    case 67:
        if (event.ctrlKey) { // ctrl-C
            this.reportKeyEvent(keyName, this.keyDownToString(event));
            this._pauseContinue(true);
            this._adjustPauseLimit(this.outputContainer);
            event.preventDefault();
        }
        break;
    default:
        if (press) {
            var arg = this._numericArgument;
            var next = String.fromCharCode(key);
            // '0'..'9' || '-' and initial || .'.
            if ((key >= 48 && key <= 57) || (key == 45 && ! arg) || key == 46) {
                arg = arg ? arg + next : next;
                this._numericArgument = arg;
                event.preventDefault();
                this._updatePagerInfo();
            }
        }
    }
};

/*
DomTerm.prototype._togglePaging = function() {
    if (this._inPagingMode) {
        this._exitPaging();
        this._inPagingMode = false;
    } else {
        this._enterPaging();
        this._inPagingMode = true;
    }
    this._updatePagerInfo();
}
*/

DomTerm.prototype._pauseNeeded = function() {
    if (this._autoPaging && this._autoPagingTemporary instanceof Element
        && this.topNode.scrollTop+this.availHeight > this._autoPagingTemporary.offsetTop) {
        this._autoPaging = false;
        this._autoPagingTemporary = false;
    }
    return (this._pagingMode > 0 || this._autoPaging)
        && this._vspacer.offsetTop + this.charHeight > this._pauseLimit;
};

DomTerm.prototype.editorAddLine = function() {
    if (this.scrollOnKeystroke)
        this._enableScroll();
    if (this._inputLine == null) {
        this._removeInputLine();
        var inputNode = this._createSpanNode();
        inputNode.classList.add("editing");
        inputNode.setAttribute("std", "input");
        this._removeCaret();
        if (this.outputBefore==this._caretNode)
            this.outputBefore = this.outputBefore.nextSibling;
        inputNode.appendChild(this._caretNode);
        this.insertNode(inputNode);
        this._restoreCaret();
        this.maybeFocus();
        this.outputBefore = inputNode;
        let pre = this._getOuterPre(inputNode);
        if (pre)
            pre.classList.add("input-line");
        this._inputLine = inputNode;
        this._restoreInputLine();
        this._numericArgument = null;
    } else if (this._inputLine.parentNode == null) {
        this._restoreInputLine();
    }
    if (! this._clientPtyEcho
        && (this._clientWantsEditing != 0 || this._clientPtyExtProc == 0))
        this._inputLine.classList.add("noecho");
}

// FIXME combine with _pageNumericArgumentGet
DomTerm.prototype.numericArgumentGet = function() {
    let s = this._numericArgument;
    if (s == null)
       return 1;
    if (s == "-")
        s = "-1";
    this._numericArgument = null;
    return Number(s);
}

DomTerm.prototype.editorMoveLines = function(backwards, count) {
    if (count == 0)
        return true;
    let delta1 = backwards ? -1 : 1;
    let goalColumn = this.sstate.goalColumn;
    let save = this._pushToCaret();
    let oldColumn = this.getCursorColumn();
    let oldLine = this.getAbsCursorLine();
    this._popFromCaret(save);
    this.editorMoveStartOrEndLine(false);
    save = this._pushToCaret();
    // start of (logical) line (after prompt)
    let startColumn = this.getCursorColumn();
    let startLine = this.getAbsCursorLine();
    this._popFromCaret(save);
    // calculate start (logical) column number (after prompt).
    let column = oldColumn - startColumn
        + this.numColumns * (oldLine - startLine);
    if (goalColumn && goalColumn > column)
        column = goalColumn;
    let line = startLine;
    if (backwards) {
        for (;;) {
            if (count <= 0)
                break;
            if (! this._newlineInInputLine(line))
                break;
            line--;
            let ln = this.lineStarts[line];
            if (ln.nodeName != "SPAN" || ln.getAttribute("line") == "hard")
                count--;
        }
    } else {
        for (;;) {
            if (count <= 0)
                break;
            if (! this._newlineInInputLine(line+1))
                break;
            line++;
            let ln = this.lineStarts[line];
            if (ln.nodeName != "SPAN" || ln.getAttribute("line") == "hard")
                count--;
        }
    }
    this._removeCaret();
    let parent, next;
    if (! this._newlineInInputLine(line)) {
        parent = this._inputLine;
        next = parent.firstChild;
    } else {
        var node = this.lineStarts[line];
        parent = node.parentNode;
        next = node.nextSibling;
        if (next instanceof Element
            && next.getAttribute("std") == "prompt") {
            node = next;
            next = node.nextSibling;
        }
    }
    parent.insertBefore(this._caretNode, next);
    this.editorBackspace(- column, "move", "char", "line");
    this.sstate.goalColumn = column;
    this._restoreCaret();
    return count <= 0;
}

DomTerm.prototype.editorMoveToRangeStart = function(range) {
    this._removeCaret();
    if (range.startContainer == this._caretNode)
        return;
    try {
        range.insertNode(this._caretNode);
    } catch(e) {
        console.log("caught "+e);
    }
    this._inputLine.normalize();
    this._restoreCaret();
}

DomTerm.prototype.editorMoveStartOrEndLine = function(toEnd, action="move") {
    this.editorBackspace(toEnd ? -Infinity : Infinity,
                         action, "char", "line");
    this.sstate.goalColumn = undefined; // FIXME add other places
}

DomTerm.prototype.editorMoveHomeOrEnd = function(toEnd) {
    let r = new Range();
    r.selectNodeContents(this._inputLine);
    if (toEnd)
        r.setStart(r.endContainer, r.endOffset);
    this.editorMoveToRangeStart(r);
    this.sstate.goalColumn = undefined; // FIXME add other places
}

DomTerm.prototype.editorMoveToPosition = function(node, offset) {
    let r = new Range();
    r.selectNodeContents(this._inputLine);
    let c = r.comparePoint(node, offset);
    if (c == 0)
        r.setStart(node, offset);
    else if (c > 0)
        r.collapse(false);
    this.editorMoveToRangeStart(r);
}

DomTerm.prototype._updateAutomaticPrompts = function() {
    var pattern = this.sstate.continuationPromptPattern;
    var initialPrompt = "";
    var initialPromptNode = null;//this._currentPromptNode;
    if (this._inputLine && this._inputLine.previousSibling instanceof Element
        && this._inputLine.previousSibling.getAttribute("std") == "prompt")
        initialPromptNode = this._inputLine.previousSibling;
    else if (this._inputLine && this._inputLine.parentNode instanceof Element
             && this._inputLine.parentNode.getAttribute("std") == "input"
             && this._inputLine.parentNode.previousSibling instanceof Element
             && this._inputLine.parentNode.previousSibling.getAttribute("std") == "prompt")
        initialPromptNode = this._inputLine.parentNode.previousSibling;
    let lineno = 0;
    if (initialPromptNode) {
        // FIXME don't need to calculate this if pattern has no padding
        // or if padding has the form %99Px
        initialPrompt = initialPromptNode.textContent;
        var prev = initialPromptNode.previousSibling;
        if (prev && prev.nodeName == "SPAN"
            && prev.getAttribute("std") == "hider")
            initialPrompt = prev.textContent + initialPrompt;
        let initialNumber = this._getIntegerBefore(initialPrompt);
        if (initialNumber > 0)
            lineno += initialNumber;
    }
    if (! pattern) {
        pattern = this.promptPatternFromInitial(initialPrompt);
    }

    let startNum = this._inputLine.startLineNumber + 1;
    for (let i = startNum; i < this.lineStarts.length; i++) {
        if (! this._newlineInInputLine(i))
            break;
        let start = this.lineStarts[i];
        if (start.getAttribute("line") != "hard")
            continue;
        let next = start.nextSibling;
        if (next && next.nodeName == "SPAN"
            && next.getAttribute("std") == "prompt") {
            let newPrompt = this._continuationPrompt(pattern, ++lineno,
                                                 initialPrompt.length);
            let oldPrompt = next.getAttribute("value");
            let w = this.strWidthInContext(newPrompt, start);
            if (oldPrompt)
                w -= this.strWidthInContext(oldPrompt, start);
            if (start._widthColumns  !== undefined)
                start._widthColumns += w;
            next.setAttribute("value", newPrompt);
        }
    }
}

// True if this is an internal line break in multi-line _inputLine.
// False if the linebreak immediately before or after the _inputLine.
// Unspecified for other linebreaks.
DomTerm.prototype._newlineInInputLine = function(i) {
    // OR:
    // let start = this.lineStarts[i];
    // return start.nodeName == "SPAN" &&  start != this._inputLine.nextSibling
    return i > 0 && i < this.lineStarts.length
        && this.lineStarts[i] == this.lineEnds[i-1];
}

DomTerm.prototype.editorContinueInput = function() {
    let outputParent = this.outputContainer.parentNode; // command-output
    let previous = outputParent.previousSibling; // domterm-pre input-line
    let previousInputLineNode = previous.lastChild;
    let previousInputStd = previousInputLineNode.previousSibling;
    let editSpan =  this._createSpanNode();
    editSpan.classList.add("editing");
    editSpan.setAttribute("std", "input");
    this._removeCaret();
    previousInputStd.insertBefore(editSpan, previousInputStd.firstChild);
    this._moveNodes(editSpan.nextSibling, editSpan, null);
    editSpan.appendChild(previousInputLineNode);
    let lastLine = this.outputContainer.firstChild;
    previous.appendChild(lastLine);
    outputParent.removeChild(this.outputContainer);
    outputParent.parentNode.removeChild(outputParent)
    this._inputLine = editSpan;
    let lastLineNo = this.lineStarts.length-1;
    this.lineStarts[lastLineNo] = this.lineEnds[lastLineNo-1]
    let prompt = this._createSpanNode();
    prompt.setAttribute("std", "prompt");
    editSpan.appendChild(prompt);
    this.editorMoveHomeOrEnd(true);
    this.outputContainer=editSpan.parentNode;
    this.outputBefore=editSpan;
    this.resetCursorCache()
    this._inputLine.startLineNumber = this.getAbsCursorLine();
    this._updateAutomaticPrompts();
}

DomTerm.prototype.editorInsertString = function(str, inserting=true) {
    this._showPassword();
    this._updateLinebreaksStart(this.getAbsCursorLine(), true);
    for (;;) {
        let nl = str.indexOf('\n');
        let str1 = nl < 0 ? str : str.substring(0, nl);
        if (str1 != "") {
            let saved = this._pushToCaret();
            if (inserting) {
                this.insertRawOutput(str1);
                let line = this.lineStarts[this.getAbsCursorLine()];
                line._widthColumns += this.strWidthInContext(str1, line);
            } else {
                let saveInserting = this.sstate.insertMode;
                this.sstate.insertMode = inserting;
                this.insertSimpleOutput(str1, 0, str.length, -1);
                this.sstate.insertMode = saveInserting;
            }
            this._popFromCaret(saved);
        }
        if (nl < 0)
            break;
        let saved = this._pushToCaret();
        let newline = this._createLineNode("hard", "\n");
        let lineno = this.getAbsCursorLine();
        DomTerm._insertIntoLines(this, newline, lineno);
        this.insertNode(newline);
        let prompt = this._createSpanNode();
        prompt.setAttribute("std", "prompt");
        this._pushIntoElement(prompt);
        this.popFromElement();
        this._updateAutomaticPrompts();
        //let pwidth = this.strWidthInContext(promptString, prompt);
        //newline._widthColumns += pwidth; FIXME
        this.currentAbsLine = lineno+1;
        this.currentCursorColumn = -1; // FIXME pwidth;
        //this._updateLinebreaksStart(this.getAbsCursorLine(), true);
        this._popFromCaret(saved);
        str = str.substring(nl+1);
    }
}

DomTerm.prototype.editorDeleteRange = function(range) {
    let str = range.toString();
    range.deleteContents();
    let lineNum = this.getAbsCursorLine();
    this._unbreakLines(lineNum, true);
    let line = this.lineStarts[lineNum];
    line._widthColumns -= this.strWidthInContext(str, line);
    this._updateLinebreaksStart(lineNum, true);
}

DomTerm.editorNonWordChar = function(ch) {
    return " \t\n\r!\"#$%&'()*+,-./:;<=>?@[\\]^_{|}".indexOf(ch) >= 0;
}

/**
 * unit: "char", "word"
 * action: one of "move", "extend" (extend selection), or "delete"
 * stopAt: one of "", "line" (stop before moving to different hard line),
 * or "visible-line" (stop before moving to different screen line).
 */
DomTerm.prototype.editorBackspace = function(count, action, unit, stopAt="") {
    this.sstate.goalColumn = undefined;
    let doDelete = action == "delete";
    let doWords = unit == "word";
    let doLines = unit == "line";
    let backwards = count > 0;
    let todo = backwards ? count : -count;
    let dt = this;
    let wordCharSeen = false;
    let range;
    let linesCount = 0;

    function fun(node) {
        if (node == dt._caretNode)
            return false;
        if (! (node instanceof Text)) {
            if (node.nodeName == "SPAN"
                && node.getAttribute("line") != null) {
                let stopped = false;
                if (stopAt == "visible-line")
                    stopped = true;
                else if (node.textContent == "")
                    return false;
                else if (stopAt == "line")
                    stopped = true;
                linesCount++;
                if (stopped) {
                    backwards = !backwards;
                    todo = 0;
                } else if (doWords) {
                    if (wordCharSeen)
                        todo--;
                    wordCharSeen = false;
                } else
                    todo--;
                if (todo == 0) {
                    if (backwards)
                        range.setStartBefore(node);
                    else {
                        let next = node.nextSibling;
                        if (next instanceof Element
                            && next.getAttribute("std") == "prompt")
                            node = next;
                        range.setEndAfter(node);
                    }
                    return null;
                }
            }
            return true;
        }
        // else: node instanceof Text
        if (unit == "line")
            return false;
        var data = node.data;
        let dlen = data.length;
        let istart = backwards ? dlen : 0;
        let index = istart;
        for (;; ) {
            if (todo == 0) {
                if (backwards)
                    range.setStart(node, index);
                else
                    range.setEnd(node, index);
                return null;
            }
            if (index == (backwards ? 0 : dlen))
                return false;
            let i0 = index;
            let c = data.charCodeAt(backwards ? --index : index++);
            let clen = 1;
            if (backwards ? (index > 0 && c >= 0xdc00 && c <= 0xdfff)
                : (index < dlen && c >= 0xd800 && c <= 0xdbff)) {
                let c2 = data.charCodeAt(backwards ? index-1 : index);
                if (backwards ? (c2 >= 0xd800 && c2 <= 0xdbff)
                    : (c2 >= 0xdc00 && c2 <= 0xdfff)) {
                    clen = 2;
                    if (backwards) index--; else index++;
                    // c = FIXME
                }
            }
            if (doWords) {
                let sep = DomTerm.editorNonWordChar(String.fromCharCode(c));
                if (sep && wordCharSeen) {
                    index = i0;
                } else {
                    todo++;
                }
                wordCharSeen = ! sep;
            }
            todo--;
        }
        if (doDelete) {
            // FIXME remove node
            node.parentNode.insertBefore(dt._caretNode, before);
        }
        return false;
    }
    let sel = document.getSelection();
    if (! sel.isCollapsed && action != "extend") {
        if (doDelete) {
            for (let i = sel.rangeCount; --i >= 0; ) {
                let r = new Range();
                r.selectNodeContents(this._inputLine);
                let sr = sel.getRangeAt(i);
                if (r.comparePoint(sr.startContainer, sr.startOffset) >= 0)
                    r.setStart(sr.startContainer, sr.startOffset);
                if (r.comparePoint(sr.endContainer, sr.endOffset) <= 0)
                    r.setEnd(sr.endContainer, sr.endOffset);
                this.editorDeleteRange(r);
            }
        } else {
            let r = sel.getRangeAt(0);
            let node = backwards ? r.startContainer : r.endContainer;
            let offset = backwards ? r.startOffset : r.endOffset;
            this.editorMoveToPosition(node, offset);
        }
        sel.removeAllRanges();
    } else {
        this._removeCaret();
        range = document.createRange();
        range.selectNodeContents(this._inputLine);
        if (backwards)
            range.setEndBefore(this._caretNode);
        else
            range.setStartAfter(this._caretNode);
        if (action == "extend" && sel.isCollapsed)
            sel.collapse(dt._caretNode, 0);
        this._forEachElementIn(this._inputLine, fun, true, backwards,
                               this._caretNode);
        if (doDelete) {
            this.editorDeleteRange(range);
            if (linesCount > 0)
                this._updateAutomaticPrompts();
            this._restoreCaret();
        } else if (action=="extend") {
            sel.extend(backwards?range.startContainer:range.endContainer,
                       backwards?range.startOffset:range.endOffset);
        } else {
            if (! backwards)
                range.collapse();
            dt.editorMoveToRangeStart(range);
        }
    }
    return todo;
}

DomTerm.prototype._lastDigit = function(str) {
    for (var j = str.length; --j >= 0; ) {
        var d = str.charCodeAt(j);
        if (d >= 48 && d <= 57)
            return j+1;
    }
    return -1;
}

DomTerm.prototype._getIntegerBefore = function(str, last) {
    if (! last)
        last = this._lastDigit(str);
    for (var j = last; --j >= 0; ) {
        var d = str.charCodeAt(j);
        if (d < 48 || d > 57)
            return Number(str.substring(j+1, last));
    }
    return -1;
}

/** Create prompt for a continuation line.
 * initial: The prompt for the initial line of the multi-line input/
 * pattern: A pattern to use to generate the prompt.
 *  '%N' - include line number here
 *  '%P<digits><c>' - include padding here, repeating following character <c>
 *     as needed to bring the width as specified by <digits>
 *  '%P<c>' - as before, but use width from initial prompt
 *  '%%' - include literal "%" here
 */
DomTerm.prototype._continuationPrompt = function(pattern, lineno, width) {
    var padding = null;
    var part1 = ""; // build text before the padding
    var part2 = ""; // build text after the padding
    var previous = 0;
    var prev = 0; // index of end of previous '%' sequence
    var plength = pattern.length;
    for (;;) {
        var pc = pattern.indexOf("%", prev);
        if (pc < 0 || pc + 1 == plength) {
            part2 = part2 + pattern.substring(prev);
            break;
        }
        var ch1 = pattern.charAt(pc+1);
        if (ch1 == '%')
            pc++;
        var before = pattern.substring(prev, pc);
        if (ch1 == "N") {
            if (lineno >= 0)
                before = before + lineno;
            pc++;
        }
        if (padding)
            part2 = part2 + before;
        else
            part1 = part1 + before;
        if (ch1 == "P" && pc + 2 < plength) {
            var w = -1;
            pc += 2;
            for (;;) {
                var ch2 = pattern.charCodeAt(pc);
                if (ch2 < 48 || ch2 > 57)
                    break;
                ch2 -= 48;
                w = w == -1 ? ch2 : (10 * w) + ch2;
                pc++;
            }
            if (w >= 0)
                width = w;
            padding = pattern.charAt(pc);
        }
        prev = pc + 1;
    }
    var neededPadding = width ? width - part1.length - part2.length : 0;
    if (padding == null || neededPadding <= 0)
        return part1 + part2;
    else
        return part1 + padding.repeat(neededPadding) + part2;
};

/** Create a default continuation prompt pattern based on initial prompt.
 * The result is "%P%N" followed by a suffix designed to align
 * with a line number in the initial prompt.
 */
DomTerm.prototype.promptPatternFromInitial = function(initialPrompt) {
    return 4 * initialPrompt.length > this.numColumns ? "> " : "%P.> ";
    /*
    var width = initialPrompt.length;
    var lastd = this._lastDigit(initialPrompt);
    var j = width;
    while (--j >= 0) {
        var ch = initialPrompt.charCodeAt(j);
        if (ch != 32 && ch != 58) // neither ' ' nor ':'
            break;
    }
    j++;
    var suffix = initialPrompt.substring(j);
    var pattern = "%P.%N";
    if (lastd > 0)
        pattern = pattern + ".".repeat(j - lastd);
    return pattern + suffix;
*/
};

/* DEBUGGING
DomTerm.prototype._showSelection = function() {
    let sel = document.getSelection();
    if (sel.anchorNode == null)
        return "sel[no-ranges]";
    let r = new Range();
    let n = this._inputLine;
    if (!n || !n.parentNode)
        n = this.initial;
    r.setStart(n, 0);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    let r1 = r.toString();
    r.setEnd(sel.focusNode, sel.focusOffset);
    let aa=sel.anchorNode instanceof Text ? "text["+sel.anchorNode.data+"]"
        : "element["+sel.anchorNode.tagName+"."+sel.anchorNode.getAttribute("class")+"]";
    let ff=sel.focusNode instanceof Text ? "text["+sel.focusNode.data+"]"
        : "element["+sel.focusNode.tagName+"."+sel.focusNode.getAttribute("class")+"]";
    return "secl[anchor:"+aa+",to-anchor:"+r1+",focus:"+ff+",to-focus:"+r.toString()+",col:"+sel.isCollapsed+"]";
}
*/

if (typeof exports === "object")
    module.exports = DomTerm;

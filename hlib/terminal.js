/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019, 2020, 2021 Per Bothner.
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

export { Terminal };
import { commandMap } from './commands.js';
var WcWidth = window.WcWidth;

class Terminal {
  constructor(name, topNode=null, no_session=null) {
    // A unique name (the "session-name") for this DomTerm instance.
    // Generated names have the format:  name + "__" + something.
    this.name = name;

    // Options/state that should be saved/restored on detach/attach.
    // Restricted to properties that are JSON-serializable,
    // and that need to be saved/restored on detach/attach.
    var sstate = {};

    this.sstate = sstate;

    this.clearVisibleState();

    this._updateTimer = null;

    sstate.windowName = null;
    sstate.windowTitle = null;
    sstate.iconName = null;
    sstate.lastWorkingPath = null;
    sstate.sessionNumber = -1;
    sstate.sessionNameUnique = false;
    sstate.paneNumber = -1;
    sstate.doLinkify = true;

    // the local window number.
    // Normally same as connectionNumber, except when remoting over ssh.
    // When remoting over ssh, this is the local server's connection number.
    this.windowNumber = -1;
    // connection number for (application, possibly-remote) process
    // When remoting over ssh, this is the remote server's connection number.
    this.connectionNumber = -1;

    this.windowForSessionNumber = -1;
    this._settingsCounterInstance = -1;
    
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

    // Emacs-style mark mode
    this._markMode = false;

    // We have two variations of autoEditing:
    // - If autoCheckInferior is false, then the inferior actively sends OSC 71
    // " handle tcsetattr", and we switch based on that. This is experimental.
    // - If autoCheckInferior is true, then when the user types a character
    // (and not isLineEditing()), then we send a "KEY" command to the
    // inferior, which calls tcgetattr to decide what to do.  (If CANON, the
    // key is sent back to DomTerm; otherwise, it is sent to the child proess.)
    this.autoLazyCheckInferior = true;
    // Number of "KEY" events reported, modulo 1024.
    this._keyEventCounter = 0;
    this._keyEventBuffer = new Array();

    // 0: not in paging or pause mode
    // 1: in paging mode
    // 2: in paused mode
    this._pagingMode = 0;
    this._muxMode = false;

    // User option: automatic paging enabled
    this._autoPaging = false;
    // true if temporary auto-paging has been requested
    // an Element if temporary auto-paging is finished,
    // but we may still be paused.
    this._autoPagingTemporary = false;
    this._pauseLimit = -1;
    // number of (non-urgent) bytes received and processed
    this._receivedCount = 0;
    this._confirmedCount = 0;
    this._replayMode = false;

    /** Style for char mode caret, based on caret.style in settings.ini. */
    this.caretStyleFromSettings = Terminal.DEFAULT_CARET_STYLE;
    /** Style for char mode caret, based on received escape sequence. */
    sstate.caretStyleFromCharSeq = -1; // caret from escape sequence
    /** Style to use for caret in char mode.
     * Based on caretStyleFromSettings and caretStyleFromCharSeq. */
    this.caretCharStyle = this.caretStyleFromSettings;
    /** Style to use caret in line-edit and mini-buffer modes. */
    this.caretEditStyle = Terminal.DEFAULT_EDIT_CARET_STYLE;
    sstate.showCaret = true;

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

    // Editing actions that have been done locally (and tentatively echoed)
    // but have not been confirmed by remote echo.
    // It's a mix of insertions (plain characters) and PENDING_XXX opcodes.
    this._pendingEcho = "";

    this._displayInfoWidget = null;

    // Table of named options local to this terminal.
    // Maybe set from command-line or UI
    this.sstate.termOptions = {};
    // Table of named options global to domterm server.
    // Normally read from settings.ini
    this._globalOptions = {};

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
    this._computedZoom = 1.0;

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

    /** True if in the middle of a wide character. */
    this.outputInWide = false;

    // this is a small (0 or 1 characters) span for the text caret.
    // When line-editing this is the *input* caret;
    // output is inserted at (outputContainer,outputBefore)
    this._caretNode = null;
    // When line-editing this is the actively edited line,
    // that has not yet been sent to the process.
    // In this case _caretNode is required to be within _inputLine.
    this._inputLine = null;

    let vcaretNode = this._createSpanNode();
    this.viewCaretNode = vcaretNode;
    vcaretNode.setAttribute("std", "caret");
    vcaretNode.classList.add("focus-caret");
    vcaretNode.stayOut = true;
    // A work-around for a Chrome bug (?) where a border or outline
    // is not shown at the left edge of the domterm window.
    // Instead we create this relative-positioned filled vcaretBar.
    let vcaretNode1 = this._createSpanNode();
    vcaretNode1.classList.add("focus-caret-mark");
    vcaretNode.appendChild(vcaretNode1);
    let vcaretNode2 = this._createSpanNode();
    vcaretNode2.classList.add("focus-caret-line");
    vcaretNode.appendChild(vcaretNode2);
    this.viewCaretLineNode = vcaretNode2;

    this._miniBuffer = null;
    this._searchInHistoryMode = false;

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
    this._focusinLastEvent = false;

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

    // If non-null: A function that maps charCodes to replacement strings.
    // (If the function returns null, uses the input unmodified.)
    this.charMapper = null;
    this._Gcharsets = [null, null, null, null];
    this._GlevelL = 0;
    this._GlevelR = 0;
    this._Gshift = 0;

    this._currentPprintGroup = null;

    // As reported from backend;
    // 0: Not the only window
    // 1: this is the only window of the session, detach not set
    // 2: this is the only window of the session, detach set
    this._detachSaveNeeded = 1;

    this._mainBufferName = this.makeId("main")
    this._altBufferName = this.makeId("alternate")
    if (topNode) {
        this.topNode = topNode;
        topNode.spellcheck = false;
        topNode.terminal = this;
        this.buffers = document.createElement("div");
        this.buffers.classList.add("domterm-buffers");
        this.buffers.contentEditable = false;
        topNode.appendChild(this.buffers);
        this._topOffset = 0; // placeholder - set in measureWindow
        if (no_session=='view-saved') {
            let buffers = document.getElementsByClassName("interaction");
            this.initial = buffers[buffers.length-1];
        } else {
            this.initial = this._createBuffer(this._mainBufferName, "main only");
            this.buffers.appendChild(this.initial);
        }
    }

    var dt = this;
    this._showHideEventHandler =
          function(evt) { dt._showHideHandler(evt); dt._clearSelection(); evt.preventDefault();};
    this._updateDisplay = function() {
        dt.cancelUpdateDisplay();
        dt._updateTimer = null;
        if (! dt.topNode)
            return;
        dt._breakDeferredLines();
        dt._checkSpacer();
        // FIXME only if "scrollWanted"
        dt._restoreInputLine();
        if (dt.viewCaretNode.parentNode === null)
            dt._scrollIfNeeded();
        else
            dt.adjustFocusCaretStyle();
        /*
        if (dt._markMode > 0) {
            // update selection so focus follows caret
            dt._restoreCaretNode();
            dt._removeCaret();
            let sel = document.getSelection();
            sel.extend(dt._caretNode, 0);
        }
        */
    };
    this._unforceWidthInColumns =
        function(evt) {
            dt.forceWidthInColumns(-1);
            window.removeEventListener("resize",
                                       dt._unforceWidthInColumns, true);
        };
    this._linkNeedsCtrlClick = (node) => {
        let cl = node.classList;
        return cl.contains("subtle");
    };
    this._mouseEventHandler =
        function(evt) { dt._mouseHandler(evt); };
    this._mouseEnterHandler =
        function(event) {
            var ref;
            let curTarget = event.currentTarget;
            if (dt.sstate.mouseMode == 0
                && (ref = curTarget.getAttribute("href"))) {
                // Consider: https://github.com/mdings/electron-tooltip
                if (true) {
                    let infoHtml = '<span class="url">' + DomTerm.escapeText(ref) + '</span>';
                    if (dt._linkNeedsCtrlClick(curTarget))
                        infoHtml += "<br/><i>(Ctrl+Click to open link)</i>";
                    dt._linkInfoDiv = DomTerm.addInfoDisplay(infoHtml, dt._linkInfoDiv, dt);
                    let leaveHandler = (e) => {
                        DomTerm.removeInfoDisplay(dt._linkInfoDiv, dt);
                        curTarget.removeEventListener("mouseleave",
                                                      leaveHandler, false);
                    };
                    curTarget.addEventListener("mouseleave",
                                                  leaveHandler, false);
                } else {
                    curTarget.setAttribute("title", ref);
                    //curTarget.addEventListener, remove, false);
                }
            }
        };
    this.wcwidth = new WcWidth();
  }

    isLineEditing() {
        return (this._lineEditingMode + this._clientWantsEditing > 0
                // extproc turns off echo by the tty driver, which means we need
                // to simulate echo if the applications requests icanon+echo mode.
                // For simplicity in this case, ignore _lineEditingMode < 0..
                || (this._clientPtyExtProc + this._clientPtyEcho
                    + this._clientWantsEditing == 3)
                || this._composing > 0)
            && ! this._currentlyPagingOrPaused();
    }

    isLineEditingOrMinibuffer() {
        return this.isLineEditing() || this._miniBuffer;
    }

    getOption(name, dflt = undefined) {
        let opt = this.sstate.termOptions[name];
        if (opt !== undefined)
            return opt;
        opt = this._globalOptions[name];
        return opt === undefined ? dflt : opt;
    }
    getRemoteHostUser() {
        return this.sstate.termOptions["`remote-host-user"];
    }
    isRemoteSession() {
        return !!this.getRemoteHostUser();
    }

    isPrimaryWindow() { return this.windowForSessionNumber == 0; }
    isSecondaryWindow() { return this.windowForSessionNumber > 0; }

    unconfirmedMax() {
        return this.getOption("flow-confirm-every", 500);
    }

    caretStyle(editStyle = this._caretNode.useEditCaretStyle) {
        return editStyle ? this.caretEditStyle : this.caretCharStyle;
    }

    // state can be true, false or "toggle"
    setMarkMode(state) {
        let oldState = this._markMode;
        let set = state == "toggle" ? ! oldState : state;
        let cl = this.topNode.classList;
        if (set) {
            this._markMode = true;
            cl.add('markmode');
        } else {
            this._markMode = false;
            cl.remove('markmode');
        }
        if (oldState !== this._markMode)
            this._displayInputModeWithTimeout(this._modeInfo("M"));
    }

    // This is called both when constructing a new Terminal, and
    // when closing the session (while preserving the WebSocket).
    clearVisibleState() {
        if (this.topNode && this.topNode.parentNode)
            this.topNode.parentNode.removeChild(this.topNode);
        this.topNode = null;

        // The parent node of the output position.
        // New output is by default inserted into this Node,
        // at the position indicated by outputBefore.
        /** @type {Node|null} */
        this.outputContainer = null;

        // The output position (cursor) - insert output before this node.
        // If null, append output to the end of the output container's children.
        // If an integer, the outputContainer is a Text,
        // or a span with a content-value attribute (in which case
        // outputBefore is an index in the content-value string).
        /** @type {Node|Number|null} */
        this.outputBefore = null;

        // ??? FIXME do we want to get rid of this? at least rename it
        // The <div class='interaction'> that is either the main or the
        // alternate screen buffer.  Same as _currentBufferNode(this, -1)
        this.initial = null;

        if (this._caretNode && this._caretNode.parentNode)
            this._caretNode.parentNode.removeChild(this._caretNode);
        this.sstate.doLinkify = false;
        this._inputLine = null;

        // Used if needed to add extra space at the bottom, for
        // proper scrolling.  See note in eraseDisplay.
        this._vspacer = null;

        this.lineStarts = null;
        this.lineEnds = null;
        // A stack of currently active "style" strings.
        this._currentStyleMap = new Map();
        // A span whose style is "correct" for _currentStyleMap.
        this._currentStyleSpan = null;
        this.detachResizeSensor();
        // Used to implement clientDoesEcho handling.
        this._deferredForDeletion = null;

        document.removeEventListener("selectionchange",
                                     this._selectionchangeListener);
        this._selectionchangeListener = null;
    }

    /// Are we reporting mouse events?
    mouseReporting() {
        return this.sstate.mouseMode !== 0
            && ! this._pagingMode && ! this.isLineEditing()
            && ! this.sstate.disconnected;
    }

    maybeResetWantsEditing() {
        if (this._lineEditingMode == 0 && this.autoLazyCheckInferior)
            this._clientWantsEditing = 0;
    }

    detachSession() {
        this.reportEvent("DETACH", "");
        if (this._detachSaveNeeded == 1)
            this._detachSaveNeeded = 2;
        this.close();
    }

    //maybeExtendInput() { }

    startPrompt(options = []) {
        this.sstate.stayInInputMode = true;
        let ln = this.outputContainer;
        if (Terminal.isNormalBlock(ln))
            ln.classList.add("input-line");

        let promptKind = Terminal.namedOptionFromArray(options, "k=");
        let isContinuationLine = promptKind === "c";
        if (promptKind == "i") {
            let commandGroup = this.currentCommandGroup(this.lineStarts[this.lineEnds.length-1]);
            if (commandGroup) {
                this.outputContainer = commandGroup.firstChild;
                this.outputBefore = this.outputContainer.firstChild;
                this.resetCursorCache();
            }
        }
        this.sstate.inInputMode = false;
        this.sstate.inPromptMode = true;
        var curOutput = this.currentCommandOutput();
        // MOVE to: maybeExtendInput
        if (curOutput
            && curOutput.firstChild == this.outputContainer
            && curOutput.firstChild == curOutput.lastChild) {
            // This is a continuation prompt, for multiline input.
            // Remove the current command-output.
            let previousInput = curOutput.previousSibling;
            if (previousInput instanceof Element
                && this.outputContainer.classList.contains("domterm-pre")
                && previousInput.classList.contains("input-line")) {
                const line = this.getAbsCursorLine();
                if (this.lineStarts[line] == this.outputContainer)
                    this.lineStarts[line] = this.lineEnds[line-1];
                this._moveNodes(this.outputContainer.firstChild, previousInput, null);
                // outputContainer is updated by _moveNodes
            }
            else
                curOutput.parentNode.insertBefore(this.outputContainer, curOutput);
            curOutput.parentNode.removeChild(curOutput);
        }
        let lineno = this.getAbsCursorLine();
        if (promptKind === "s") {
            let firstInput = this.outputContainer;
            if (firstInput.classList.contains("input-line")) {
                let newLine = document.createElement(firstInput.nodeName);
                this._copyAttributes(firstInput, newLine);
                firstInput.parentNode.insertBefore(newLine, firstInput.nextSibling);
                this._moveNodes(this.lineStarts[lineno].nextSibling, newLine, null);
                this.lineStarts[lineno] = newLine;
                this.outputContainer = newLine;
            }
        }
        this._fixOutputPosition();
        this._pushStdMode("prompt");
        if (promptKind)
            this.outputContainer.setAttribute("prompt-kind", promptKind);
        let prev = this.outputContainer.previousSibling;
        let m;
        if (promptKind == "r"
            && prev instanceof Text
            && (m = prev.data.match(/([ ]+)$/)) != null) {
            const mcount = m[1].length;
            let plen = prev.length - mcount;
            let pad = this._createSpanNode();
            pad.setAttribute("content-value", m[1]);
            prev.parentNode.insertBefore(pad, this.outputContainer);
            if (plen)
                prev.deleteData(plen, mcount);
            else
                prev.parentNode.removeChild(prev);
            this.lineStarts[lineno].alwaysMeasureForBreak = true;
        }
        if (this._inputLine != null) {
            if (isContinuationLine)
                this._inputLine.setAttribute("continuation", "true");
            else
                this._inputLine.removeAttribute("continuation");
        }
    }

    /* Start of user input, following any prompt.
     */
    startInput(stayInInputMode, options=[]) {
        this.sstate.stayInInputMode = stayInInputMode;
        this._pushStdMode(null);
        this.sstate.inInputMode = true;
        this.sstate.inPromptMode = false;
        this._fixOutputPosition();
        let ln = this.outputContainer;
        if (Terminal.isNormalBlock(ln))
            ln.classList.add("input-line");

        let prev = this.outputBefore ? this.outputBefore.previousSibling
            : this.outputContainer.lastChild;
        // Move old/tentative input to after previous output:
        // If the line number of the new prompt matches that of a
        // previous continuation line, move the latter to here.
        if (false // FIXME - needs some work/testing
            // Also unclear how useful this is - probably only for line mode?
            && prev instanceof Element
            && prev.getAttribute("std")=="prompt") {
            let lnum = prev.getAttribute("content-value");
            lnum = this._getIntegerBefore(lnum || prev.textContent);
            let gr = this.currentCommandGroup();
            let plin;
            let dt = this;
            for (; lnum && gr; gr = gr ? gr.previousSibling : null) {
                for (let plin = gr.lastChild; plin != null && gr != null;
                     plin = plin.previousSibling) {
                    if (! (plin instanceof Element
                           && plin.classList.contains("input-line")))
                        continue;
                    function fun(node) {
                        if (node.tagName == "SPAN"
                            && node.getAttribute("std") == "prompt"
                            && node.previousSibling instanceof Element
                            && node.previousSibling.getAttribute("line")) {
                            let val = node.lineno;
                            if (val && val <= lnum) {
                                gr = null;
                                return val == lnum ? node : null;
                            }
                            return false;
                        }
                        return true;
                    }
                    let pr = Terminal._forEachElementIn(plin, fun, false, true);
                    if (pr) {
                        // FIXME broken if pr is nested
                        this.outputContainer = plin;
                        this.outputBefore = plin.firstChild;
                        this.resetCursorCache();
                        let startLine = this.getAbsCursorLine();
                        this._moveNodes(pr.nextSibling, newParent, null);
                        pr.parentNode.removeChild(pr.previousSibling);
                        pr.parentNode.removeChild(pr);
                        this.outputContainer = prev.nextSibling;
                        this.outputBefore = null;
                        // FIXME rather non-optimal
                        this._restoreLineTables(plin, startLine, true)
                        this._updateLinebreaksStart(startLine);
                        this.resetCursorCache();
                        this.cursorLineStart(1);
                    }
                }
            }
        }
    }

    _splitParents(stop) {
        var cur = this.outputBefore;
        var parent = this.outputContainer;
        while (parent !== stop) {
            cur = cur == null ? parent.nextSibling
                : cur.previousSibling == null ? parent
                : this._splitNode(parent, cur);
            parent = parent.parentNode;
        }
        this.outputBefore = cur;
        this.outputContainer = parent;
        return cur;
    }

    startOutput() {
        this.sstate.inInputMode = false;
        this.sstate.inPromptMode = false;
        const group = this.currentCommandGroup();
        if (group && group.lastChild instanceof Element
            && group.lastChild.classList.contains("input-line")
            && this._isAnAncestor(this.outputContainer, group.lastChild)) {
            const lineNo = this.getAbsCursorLine();
            let cur = this._splitParents(group);
            cur.classList.remove("input-line");
            cur.removeAttribute("click-move");
            let commandOutput = document.createElement("div");
            commandOutput.setAttribute("class", "command-output");
            group.insertBefore(commandOutput, cur);
            commandOutput.appendChild(cur);
            Terminal._forEachElementIn(cur,
                                       (el) => {
                                           if (el.getAttribute("std")==="input") {
                                               this._moveNodes(el.firstChild, el.parentNode, el);
                                               el.parentNode.removeChild(el);
                                               return false;
                                           }
                                           return true;
                                       });
            cur.normalize();
            this.lineStarts[lineNo] = cur;
            this.moveToAbs(lineNo, 0, true);
            while (this.lineStarts.length > lineNo
                   && this.lineEnds[this.lineStarts.length-1]===cur.lastChild
                   && this.lineStarts[this.lineStarts.length-1]===cur.lastChild.previousSibling
                   && this.lineEnds[this.lineStarts.length-2]===cur.lastChild.previousSibling) {
                this.lineStarts.pop();
                this.lineEnds.pop();
                cur.removeChild(cur.lastChild);
            }
        }
    }

    _maybeBracketed(text) {
        if (this.sstate.bracketedPasteMode)
            text = "\x1B[200~" + text + "\x1B[201~";
        return text;
    }

    currentCommandGroup(current = this.outputContainer) {
        for (let n = current; n; n = n.parentNode) {
            if (n instanceof Element && n.classList.contains("command-group"))
                return n;
        }
        return null;
    }

    currentCommandOutput(current = this.outputContainer) {
        for (let n = current; n; n = n.parentNode) {
            if (n instanceof Element) {
                let cl = n.classList;
                if (cl.contains("command-output"))
                    return n;
                if (cl.contains("command-group"))
                    break;
            }
        }
        return null;
    }

    setMouseMode(value) {
        var handler = this._mouseEventHandler;
        if (value) {
            this.topNode.addEventListener("wheel", handler);
            this.topNode.classList.add("hide-selection");
        } else {
            this.topNode.removeEventListener("wheel", handler);
            this.topNode.classList.remove("hide-selection");
        }
        if (value !== 1003)
            this.topNode.removeEventListener("mousemove", handler);
        else if (this.sstate.mouseMode !== 1003 && value === 1003)
            this.topNode.addEventListener("mousemove", handler);
        this.sstate.mouseMode = value;
    }

    // Height of data in buffers.
    // Same as _vspacer.offsetTop but more precise (and slower)
    _dataHeight() {
        return this._vspacer.getBoundingClientRect().top
            + this.buffers.scrollTop - this._topOffset;
    }
}
Terminal.caretStyles = [null/*default*/, "blinking-block", "block",
                        "blinking-underline", "underline",
                        "blinking-bar", "bar", "native" ];
Terminal.DEFAULT_CARET_STYLE = 1; // blinking-block
Terminal.DEFAULT_EDIT_CARET_STYLE = 5; // blinking-bar
Terminal.NATIVE_CARET_STYLE = Terminal.caretStyles.indexOf("native");
Terminal.BELL_TIMEOUT = 400;
/** On receiving BEL (ctrl-G) display this text in info widget. */
Terminal.BELL_TEXT = "BELL!";
/** Length of time to display BELL_TEXT. */
Terminal.INFO_TIMEOUT = 1200;

window.addEventListener("unload", DomTerm.closeAll);

// Handle selection
DomTerm.EDITING_SELECTION = 1;
// Handle keypress, optionally-shifted left/right-arrow, home/end locally.
//DomTerm.EDITING_LOCAL_BASIC = 2;
// Handle Emacs key sequences locally.
// Handle history locally
// Handle shift of motion keys to extend selection

DomTerm.makeElement = function(name, parent = DomTerm.layoutTop) {
    let topNode;
    if (DomTerm.usingXtermJs()) {
        let xterm = new window.Terminal();
        xterm.open(parent);
        topNode = xterm.element;
        topNode.xterm = xterm;
    } else {
        topNode = document.createElement("div");
        parent.appendChild(topNode);
    }
    topNode.classList.add("domterm");
    topNode.setAttribute("name", name);
    if (typeof DomTermLayout !== "undefined"
        && DomTermLayout._oldFocusedContent == null)
        DomTermLayout._oldFocusedContent = topNode;
    return topNode;
}

// These are used to delimit "out-of-bound" urgent messages.
Terminal.URGENT_BEGIN1 = 19; // '\023' (DC1) - out-of-band/urgent start
Terminal.URGENT_STATELESS_COUNTED = 21; // '\x15'
Terminal.URGENT_FIRST_COUNTED = 23; // '\x17'
Terminal.URGENT_FIRST_NONCOUNTED = 22; // '\x16'
Terminal.URGENT_END = 20; // \024' - device control 4

Terminal.prototype._deleteData = function(text, start, count) {
    if (count == 0)
        return;
    let dlen = text.length;
    if (count == dlen) {
        if (text === this.outputBefore)
            this.outputBefore = text.nextSibling;
        else if (text === this.outputContainer) {
            this.outputContainer = text.parentNode;
            this.outputBefore = text.nextSibling;
        }
        text.parentNode.removeChild(text);
    } else {
        if (text === this.outputContainer)
            this.outputBefore -= start;
        text.deleteData(start, count);
    }
}

Terminal.prototype.eofSeen = function() {
    this.historySave();
    DomTerm.closeFromEof(this);
};

DomTerm.isFrameParent = function() {
    return DomTerm.useIFrame && ! DomTerm.isInIFrame()
        && DomTermLayout._oldFocusedContent;
}

DomTerm.saveWindowContents = function(dt=DomTerm.focusedTerm) {
    if (!dt)
        return;
    dt._restoreInputLine();
    var rcount = dt.parser._savedControlState ? dt.parser._savedControlState.receivedCount
        : dt._receivedCount;
    var data =
        rcount
        + ',{"sstate":'+JSON.stringify(dt.sstate);
    data += ',"rows":'+dt.numRows+',"columns":'+dt.numColumns;
    data += ', "html":'
        + JSON.stringify(dt.getAsHTML(false))
        +'}';
    dt.reportEvent("WINDOW-CONTENTS", data);
}

DomTerm.closeFromEof = function(dt) {
    dt.close();
}

Terminal.prototype.close = function() {
    if (this._detachSaveNeeded == 2) {
        DomTerm.saveWindowContents(this);
    }
    if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("layout-close");
    else if (DomTermLayout.manager && DomTermLayout.layoutClose) {
        DomTermLayout.layoutClose(this.topNode,
                                  DomTerm.domTermToLayoutItem(this));
    } else
        DomTerm.windowClose();
};

Terminal.prototype.startCommandGroup = function(parentKey, pushing=0, options=[]) {
    this.sstate.inInputMode = false;
    this.sstate.inPromptMode = false;
    const container = this.outputContainer;
    let commandGroup = document.createElement("div");
    commandGroup.setAttribute("class", "command-group");
    if (parentKey)
        commandGroup.setAttribute(pushing > 0 ? "group-id" : "group-parent-id", parentKey);
    container.parentNode.insertBefore(commandGroup, container);
    commandGroup.appendChild(container);
    let clickMove = Terminal.namedOptionFromArray(options, "cl=");
    if (clickMove)
        container.setAttribute("click-move", clickMove);
    this.sstate.continuationPromptPattern = undefined;
};

Terminal.prototype.endCommandGroup = function(parentKey, maybePush) {
    this.sstate.inInputMode = false;
    var oldGroup = this.currentCommandGroup();
    let prevGroup = oldGroup;
    for (let p = oldGroup; ;  p = p.parentNode) {
        if (! (p instanceof Element)) {
            oldGroup = null;
            break;
        }
        if (p.classList.contains("command-group")) {
            let gpid = p.getAttribute("group-parent-id");
            let gid = p.getAttribute("group-id");
            if (maybePush) {
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
    this.popCommandGroup(oldGroup);
}

Terminal.prototype.popCommandGroup = function(oldGroup) {
    let oldOutput;
    if (oldGroup && ! this._isAnAncestor(this.outputContainer, oldGroup)) {
        oldGroup = null;
        oldOutput = null;
    } else
        oldOutput = this.currentCommandOutput();
    if (oldGroup) {
        var oldBefore = oldGroup.nextSibling;
        const preNode = this._createPreNode();
        const lineno = this.getAbsCursorLine();
        if (lineno > 0)
            this._clearWrap(lineno-1);
        this._fixOutputPosition();
        let cur = this.outputBefore;
        let parent = this.outputContainer;
        this.lineStarts[lineno] = preNode;
        oldGroup.parentNode.appendChild(preNode);
        for (;;) {
            this._moveNodes(cur, preNode, null);
            const pnext = parent.nextSibling;
            const pparent = parent.parentNode;
            if (parent.firstChild == null)
                pparent.removeChild(parent);
            if (parent == oldGroup)
                break;
            cur = pnext;
            parent = pparent;
        }
        if (this.outputContainer.parentNode !== null
            && this.outputContainer.firstChild == null) {
            this.outputContainer.parentNode.removeChild(this.outputContainer);
        }
        if (preNode.firstChild instanceof Element
            && preNode.firstChild.getAttribute("line")) {
            preNode._widthMode = Terminal._WIDTH_MODE_NORMAL;
            preNode._widthColumns = 0;
        }
        this.outputContainer = preNode;
        this.outputBefore = preNode.firstChild;

        // Remove old empty domterm-output container.
        if (oldOutput && oldOutput.firstChild == null
            && oldOutput.parentNode != null
            && oldOutput != this.outputContainer) { // paranoia
            oldOutput.parentNode.removeChild(oldOutput);
        }
        this._maybeAddTailHider(oldGroup);
    }
}

Terminal.prototype._maybeAddTailHider = function(oldGroup) {
        let nLines = 0;
        let firstLine = null;
        function checkLine(n) {
            const ln = n.getAttribute("line")
            if (ln && ln !== "soft" && n.nodeName == "SPAN") {
                if (firstLine == null) {
                    firstLine = n;
                }
                return ++nLines >= 2 ? n : false;
            } else if (n.classList.contains("domterm-opaque")) {
                return ++nLines >= 2 ? n : false;
            } else
                return true;
        }
        Terminal._forEachElementIn(oldGroup, checkLine);

        // If multiple input lines, split into separate input-line elements.
        // The main reason is that the tail-hider elements gets displayed
        // at the correct location, but it may also help make some things
        // (such as re-flow) more efficient.
        let firstInput;
        if (nLines > 1
            && oldGroup.firstChild == (firstInput = firstLine.parentNode)
            && firstInput.classList.contains("input-line")) {
            let lineEnd = null;
            let ln = this.lineStarts.length;
            while (--ln >= 0 && this.lineStarts[ln] !== firstInput) {
                lineEnd = this.lineEnds[ln];
                if (lineEnd == firstInput.lastChild)
                    break;
            }
            for (; ln >= 0; --ln) {
                let lineStart = this.lineStarts[ln];
                if (lineStart == firstInput)
                    break;
                if (lineStart.parentNode == firstInput
                    && lineStart.getAttribute("line") == "hard") {
                    let newLine = document.createElement(firstInput.nodeName);
                    this._copyAttributes(firstInput, newLine);
                    firstInput.parentNode.insertBefore(newLine, firstInput.nextSibling);
                    for (let n = lineStart.nextSibling; ; ) {
                        let next = n.nextSibling;
                        newLine.appendChild(n);
                        if (n == lineEnd)
                            break;
                        n = next;
                    }
                    this.lineStarts[ln] = newLine;
                    lineEnd = lineStart;
                }
            }
        }
        if (nLines > 1) {
            const button = this._createSpanNode("tail-hider");
            button.stayOut = true;
            firstLine.insertBefore(button, firstLine.firstChild);
            button.addEventListener("click",
                                    this._showHideEventHandler,
                                    true);
        }
}

Terminal.prototype.log = function(str) {
    // JSON.stringify encodes escape as "\\u001b" which is hard to read.
    str = str.replace(/\\u001b/g, "\\e").replace(/[\u007f]/g, "\\x7f");
    let to_server = DomTerm.logToServer;
    let report = to_server === "yes" || to_server === "true";
    if (report) {
        let saveVerbosity = DomTerm.verbosity;
        if (this._socketOpen) {
            DomTerm.verbosity = 0;
            try {
                this.reportEvent("LOG", JSON.stringify(str));
            } catch (e) {
                console.log("couldn't log-to-server: "+str);
            }
            DomTerm.verbosity = saveVerbosity;
        } else
            DomTerm.log(str, this);
    }
    if (! report || to_server === "both")
        console.log(str);
};
Terminal.prototype._handleSavedLog = function(str) {
    if (this._socketOpen && DomTerm._savedLogEntries) {
        let arr = DomTerm._savedLogEntries;
        let len = arr.length;
        for (let i = 0; i < len; i++)
            this.log(arr[i]);
        DomTerm._savedLogEntries = null;
    }
}

DomTerm.focusedTerm = null; // used if !useIFrame

// Handle changes relating to this terminal gaining or losing focus.
// This runs in the current frame (inner context).
// focused: 0 - lose focus; 1 or 2 - gain focus.
// (if 2 - also request low-level focus)
// Runs in terminal's frame
Terminal.prototype.setFocused = function(focused) {
    if (! this._rulerNode) // skip if _initializeDomTerm not called
        return;
    if (focused > 0) {
        this.topNode.classList.add("domterm-active");
        DomTerm.setTitle(this.sstate.windowTitle);
        if (! this.isSavedSession()) {
            this.reportEvent("FOCUSED", ""); // to server
            DomTerm.inputModeChanged(this, this.getInputMode());
        }
        if (focused == 2)
            this.maybeFocus();
    } else if (this.topNode) {
        this.topNode.classList.remove("domterm-active");
    }
    if (this.sstate.sendFocus)
        this.processResponseCharacters(focused ? "\x1b[I" : "\x1b[O");
}

DomTerm.selectNextPane = function(forwards) {
    if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
        DomTerm.sendParentMessage("domterm-next-pane", forwards);
    }
    else {
        DomTermLayout.selectNextPane(forwards);
    }
};

// originMode can be one of (should simplify):
// "F" - focusin event (in inferior frame)
// "X" - selectNextPane
// "N" - initializeDomTerm
// "A" - activeContentItemHandler (event handler called by GoldenLayout)
// "C" - layoutInit
// "S" - mousedown [only if !useIFrame]
DomTerm.setFocus = function(term, originMode="") {
    if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
        //DomTerm.focusedTerm = term;
        if (originMode == "F" || originMode == "N")
            term.setFocused(1);
        DomTerm.sendParentMessage("focus-event", originMode);
    } else {
        if (DomTerm.useIFrame)
            DomTerm.showFocusedTerm(term);
        var current = DomTerm.focusedTerm;
        if (! DomTerm.useIFrame) {
            if (current == term)
                return;
            if (current !== null)
                current.setFocused(0);
        }
        if (term != null)
            term.setFocused(1);
    }
    DomTerm.focusedTerm = term;
}

// Overridden for atom-domterm
DomTerm.showFocusedTerm = function(term) {
    if (DomTermLayout.manager) {
        var item = term ? DomTerm.domTermToLayoutItem(term) : null;
        DomTermLayout.showFocusedPane(item, term ? term.topNode : null);
    }
}

// Convenience function for Theia package
Terminal.prototype.doFocus = function() {
    DomTerm.setFocus(this);
    this.maybeFocus();
}

Terminal.prototype.maybeFocus = function() {
    let goal = this.topNode;
    if (this.hasFocus() && document.activeElement !== goal) {
        goal.focus({preventScroll: true});
    }
}

Terminal.prototype.hasFocus = function() {
    return this.topNode.classList.contains("domterm-active");
}

// Possible values for _widthMode field of elements in lineStarts table.
// This is related to the _widthColumns field in the same elements,
// which (if not undefined) is the number of columns in the current
// (displayed) line.
Terminal._WIDTH_MODE_NORMAL = 0;
Terminal._WIDTH_MODE_TAB_SEEN = 1; // tab seen
Terminal._WIDTH_MODE_PPRINT_SEEN = 2; // tab *or* pprint-node seen
Terminal._WIDTH_MODE_VARIABLE_SEEN = 3; // HTML or variable-width font

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

Terminal.prototype._setRegionTB = function(top, bottom) {
    this._regionTop = top;
    this._regionBottom = bottom < 0 ? this.numRows : bottom;
};

Terminal.prototype._setRegionLR = function(left, right) {
    this._regionLeft = left;
    this._regionRight = right < 0 ? this.numColumns : right;
};

Terminal.prototype._homeOffset = function(homeLine = this.homeLine) {
    var lineStart = this.lineStarts[homeLine];
    let stop = this.topNode;
    // In case homeLine is hidden
    while (lineStart !== stop && lineStart.offsetParent == null)
        lineStart = lineStart.parentNode;
    var offset = lineStart.nodeName == "SPAN" ? lineStart.offsetHeight : 0;
    while (lineStart !== stop) {
        offset += lineStart.offsetTop;
        lineStart = lineStart.offsetParent;
    }
    return offset;
};

Terminal.prototype._checkSpacer = function() {
    if (this._vspacer != null) {
        let needed;
        if (this._vspacer.dtHeight < 0)
            needed = -1;
        else {
            needed = this.actualHeight - this._vspacer.offsetTop
                + (this.initial.noScrollTop ? 0 : this._homeOffset(this.homeLine));
            if (needed < 0)
                needed = 0;
        }
        this._adjustSpacer(needed);
    }
};

/** Adjust height of _vspacer element.
 * The value -1 is to force _checkSpacer to set the height to 0.
 */
Terminal.prototype._adjustSpacer = function(needed) {
    var vspacer = this._vspacer;
    if (needed === NaN)
        console.log("needed NAN!");
    if (vspacer.dtHeight != needed) {
        if (needed > 0) {
            vspacer.style.height = needed + "px";
        } else if (vspacer.dtHeight > 0) {
            vspacer.style.height = "";
        }
        vspacer.dtHeight = needed;
    }
};

/*
Terminal.prototype.atLineEnd = function() {
    var parent = this.outputContainer;
    var next = this.outputBefore;
    while (next == null) {
        next = parent.nextSibling;
        parent = parent.parentNode;
    }
    return next.nodeName == "SPAN" && next.getAttribute("line") == "hard";
}
*/

Terminal.prototype.wcwidthInContext = function(ucs, context) {
    return this.wcwidth.wcwidthInContext(ucs, context);
}

Terminal.prototype.strWidthInContext = function(str, context) {
    return this.wcwidth.strWidthInContext(str, context);
}

// Return char index in str corresponding to specified columns.
// If not enough characters in str, return (actual_column - columns),
// i.e. the negative of the shortfall.
// I.e. same as (but more efficient than):
// let n = strWidthInContext(str, context);
// return n >= columns ? columnToIndexInContext(str, 0, colums, context)
//     : n - columns;
Terminal.prototype.strColumnToIndex = function(str, columns, context=null) {
    let i = 0;
    let length = str.length;
    let todo = columns;
    for (; todo > 0; i++) {
        if (i >= length)
            return -todo;
        var ch = str.codePointAt(i);
        if (ch > 0xffff) i++;
        // Optimization - don't need to calculate getCurrentColumn.
        if (ch >= 32/*' '*/ && ch < 127) {
            todo--;
        }
        else if (ch == 13/*'\r'*/ || ch == 10/*'\n'*/ || ch == 12/*'\f'*/) {
            // shouldn't normally happen - we get to lineEnd first
            todo = 0;
            return i;
        }
        else {
            todo -= this.wcwidthInContext(ch, context);
        }
    }
    return i;
}

Terminal.prototype.atTabStop = function(col) {
    if (col >= this._tabDefaultStart)
        if ((col & 7) == 0)
            return true;
    return this._tabsAdded && this._tabsAdded[col];
}

// Return column number following a tab at initial {@code col}.
// Ths col is the initial column, 0-origin.
// Return the column number (0-origin) after a tab.
// Default implementation assumes tabs every 8 columns.
Terminal.prototype.nextTabCol = function(col) {
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

Terminal.prototype.tabToNextStop = function(isTabChar) {
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
    if (isTabChar && this._useTabCharInDom && this._fixOutputPosition()
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
        this._deleteData(prev, prev.length-w, w);
    }
    return true;
}

Terminal.prototype.tabToPrevStop = function() {
    var col = this.getCursorColumn();
    while (--col > 0 && ! this.atTabStop(col)) { }
    this.columnSet(col);
}

Terminal.prototype.setTabStop = function(col, set) {
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

Terminal.prototype.clearAllTabs = function() {
    this._tabsAdded = null;
    this._tabDefaultStart = Number.POSITIVE_INFINITY;
};

Terminal.prototype.resetTabs = function() {
    this._tabsAdded = null;
    this._tabDefaultStart = 0;
};

// Placeholder for future permisions-checking framework
Terminal.prototype.checkPermission = function(featureName) {
    return true;
}

Terminal.prototype._restoreLineTables = function(startNode, startLine, skipText = false) {
    this.lineStarts.length = startLine;
    this.lineEnds.length = startLine;
    var start = null;
    var startBlock = null;
    let seenDataThisLine = false;
    var dt = this;
    dt._currentPprintGroup = null;

    for (var cur = startNode; ;) {
        if (cur == null || cur == this._vspacer)
            break;
        var descend = false;
        if (cur instanceof Text && ! skipText) {
            seenDataThisLine = true;
            var data = cur.data;
            var dlen = data.length;
            for (var i = 0; i < dlen; i++) {
                var ch = data.codePointAt(i);
                if (ch == 10) {
                    if (i > 0)
                        cur.parentNode.insertBefore(document.createTextNode(data.substring(0,i)), cur);
                    let white = window.getComputedStyle(cur.parentNode)['white-space'];
                    let line = white=='normal' || white=='nowrap'
                        ? this._createSpanNode('non-pre-newline', ' ')
                        : this._createLineNode("hard", "\n");
                    cur.parentNode.insertBefore(line, cur);
                    this._deleteData(cur, 0, i+1);
                    cur = line; // continue with Element case below
                    break;
                }
                var cwidth = this.wcwidthInContext(ch, cur.parentNode);
                if (cwidth == 2) {
                    var i1 = ch > 0xffff ? i + 2 : i + 1;
                    const wcnode =
                        this._createSpanNode("wc-node",
                                             String.fromCodePoint(ch));
                    cur.parentNode.insertBefore(wcnode, cur.nextSibling);
                    this._deleteData(cur, i, dlen-i);
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
            else if (Terminal.isBlockTag(tag)) {
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
                    } else if (ch instanceof Element && ! hasData) {
                        isBlockNode = Terminal.isBlockNode(ch);
                        if (! isBlockNode
                            && !ch.classList.contains("focus-area"))
                            hasData = true;
                    }
                    ch = next;
                    prevWasBlock = isBlockNode;
                }
                if (hasData) {
                    start = cur;
                    startBlock = cur;
                    start._widthMode = Terminal._WIDTH_MODE_NORMAL;
                    // FIXME calculate _widthColumns
                    if (! DomTerm.isLineBlock(cur)) {
                        cur.classList.add("domterm-opaque");
                        descend = false;
                        start._widthMode = Terminal._WIDTH_MODE_VARIABLE_SEEN;
                    }
                    this.lineStarts[startLine] = start;
                    this.lineEnds[startLine] = null;
                    seenDataThisLine = false;
                }
            } else if (tag == "span") {
                var line = cur.getAttribute("line");
                var cls =  cur.getAttribute("class");
                if (line) {
                    descend = false;
                    cur.outerPprintGroup = this._currentPprintGroup;
                    //this.currentCursorLine = startLine;
                    //this.currentCursorColumn = -1;
                    if (line == "hard" || line == "br") {
                        if (startLine > 0 && this.lineStarts[startLine] == null)
                            this.lineStarts[startLine] = this.lineEnds[startLine-1];
                        this.lineEnds[startLine] = cur;
                        startLine++;
                        start = cur;
                        seenDataThisLine = false;
                    } else {
                        start._widthMode = Terminal._WIDTH_MODE_PPRINT_SEEN;
                    }
                } else {
                    if (cls == "wc-node" || cls == "focus-area") {
                        descend = false;
                    } else if (cls == "pprint-group") {
                        start._widthMode = Terminal._WIDTH_MODE_PPRINT_SEEN;
                        this._pushPprintGroup(cur);
                    }
                    seenDataThisLine = true;
                }
            } else {
                seenDataThisLine = true;
            }
        }

        if (descend) {
            cur = cur.firstChild;
        } else {
            for (;;) {
                if (cur.nodeName == "SPAN"
                    && cur.classList.contains("pprint-group"))
                    this._popPprintGroup();
                if (cur == startBlock) {
                    if (seenDataThisLine || this.lineStarts[startLine]) {
                        if (startLine > 0 && this.lineStarts[startLine] == null)
                            this.lineStarts[startLine] = this.lineEnds[startLine-1];
                        // This simplifies traversal logic various places.
                        // (Ideally should use a distinct "line"-type.)
                        let end = this._createLineNode("hard", "\n");
                        startBlock.appendChild(end);
                        this.lineEnds[startLine] = end;
                        seenDataThisLine = false;
                        startLine++;
                    }
                }
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

Terminal.prototype.saveCursor = function() {
    // https://github.com/PerBothner/DomTerm/issues/61#issuecomment-453873818
    this.sstate.savedCursor = {
        line: this.getCursorLine(),
        column: this.getCursorColumn(),
        currentStyleMap: new Map(this._currentStyleMap),
        origin: this.sstate.originMode,
        wraparound: this.sstate.wraparoundMode,
        bracketedPasteMode: this.sstate.bracketedPasteMode,
        mouseMode: this.sstate.mouseMode,
        mouseCoordEncoding: this.sstate.mouseCoordEncoding,
        tabsAdded: this._tabsAdded,
        tabDefaultStart: this._tabDefaultStart,
        regionTop: this._regionTop,
        regionBottom: this._regionBottom,
        regionLeft: this._regionLeft,
        regionRight: this._regionLeft,
        currentPprintGroup: this._currentPprintGroup,
        glevelL: this._GlevelL,
        glevelR: this._GlevelR,
        gshift: this._Gshift,
        charset0: this._Gcharsets[0],
        charset1: this._Gcharsets[1],
        charset2: this._Gcharsets[2],
        charset3: this._Gcharsets[3],
        charMapper: this.charMapper
    };
};

// Re-calculate alternate buffer's saveLastLine property.
Terminal.prototype._restoreSaveLastLine = function() {
    let line = 0;
    const findAltBuffer = (node) => {
        if (node.parentNode == this.buffers
            && node.classList.contains("interaction")) {
            node.saveLastLine = line;
        }
        if (node == this.lineStarts[line])
            line++;
        return true;
    }
    Terminal._forEachElementIn(this.topNode, findAltBuffer);
};
 
Terminal.prototype.restoreCursor = function(restoreExtraState = false) {
    var saved = this.sstate.savedCursor;
    if (saved) {
        this.moveToAbs(saved.line+this.homeLine, saved.column, true);
        this._Gcharsets[0] = saved.charset0;
        this._Gcharsets[1] = saved.charset1;
        this._Gcharsets[2] = saved.charset2;
        this._Gcharsets[3] = saved.charset3;
        this._GlevelL = saved.glevelL;
        this._GlevelR = saved.glevelR;
        this._Gshift = saved.gshift;
        this.charMapper = saved.charMapper;
        this._currentStyleMap = saved.currentStyleMap;
        this.sstate.originMode = saved.origin;
        this.sstate.wraparoundMode = saved.wraparound;
        if (restoreExtraState) {
            this.sstate.bracketedPasteMode = saved.bracketedPasteMode;
            this.setMouseMode(saved.mouseMode);
            this.sstate.mouseCoordEncoding = saved.mouseCoordEncoding;
            this._tabsAdded = saved.tabsAdded;
            this._tabDefaultStart = saved.tabDefaultStart;
            this._setRegionTB(saved.regionTop, saved.regionBottom);
            this._setRegionLR(saved.regionLeft, saved.regionRight);
            this._currentPprintGroup = saved.currentPprintGroup;
        }
    } else {
        this.resetCharsets();
    }
}; 

Terminal.prototype.columnSet = function(column) {
    this.cursorSet(this.getCursorLine(), column, false);
}

/** Move to give position relative to cursorHome or region.
 * Add spaces as needed.
*/
Terminal.prototype.cursorSet = function(line, column, regionRelative) {
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

Terminal.prototype._maybeGoDeeper = function(current) {
    let parent = null;
    while (current instanceof Element) {
        let tag = current.tagName.toLowerCase();
        if (! Terminal.isBlockTag(tag)
            && tag !== "td"
            && (tag !== "span" || current.stayOut
                || current.getAttribute("content-value")))
            break;
        parent = current;
        current = parent.firstChild;
    }
    return parent;
}

/** Append new line.
 * 'mode' is "hard", "soft", or "block"
 */
Terminal.prototype._appendLine = function(mode, lastParent, parent, before=null) {
    let next = this._createLineNode(mode == "soft" ? "soft" : "hard");
    let lineCount = this.lineStarts.length;
    let prevLineEnd = this.lineEnds[lineCount-1];
    let lineStart;
    if (mode == "block") {
        let preNode = this._createPreNode();
        preNode.appendChild(next);
        parent.appendChild(preNode);
        this._setBackgroundColor(preNode,
                                 this._getBackgroundColor(this._vspacer));
        lineStart = preNode;
        this.lineEnds[lineCount] = next;
    } else {
        lastParent.insertBefore(next, before);
        lineStart = next;
        this.lineEnds[lineCount] = prevLineEnd;
        this.lineEnds[lineCount-1] = next;
    }
    lineStart._widthMode = Terminal._WIDTH_MODE_NORMAL;
    lineStart._widthColumns = 0;
    this.lineStarts[lineCount] = lineStart;
    let nextLine = lineCount;
    lineCount++;
    let homeLine = this.homeLine;
    if (lineCount > homeLine + this.numRows) {
        homeLine = lineCount - this.numRows;
        this.homeLine = homeLine;
        this._adjustSpacer(-1);
    }
    return parent;
}

/** Move to the request position.
 * @param goalAbsLine number of lines (non-negative) to down topNode start
 * @param goalColumn number of columns to move right from the start of the goalLine
 * @param addSpaceAsNeeded if we should add blank lines or spaces if needed to move as requested; otherwise stop at the last existing line, or (just past the) last existing contents of the goalLine. In this case homeLine may be adjusted.
 */
Terminal.prototype.moveToAbs = function(goalAbsLine, goalColumn, addSpaceAsNeeded) {
    //Only if char-edit? FIXME
    //this._removeInputLine();
    var absLine = this.currentAbsLine;
    var column = this.currentCursorColumn;
    if (DomTerm.verbosity >= 3)
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
        if (this.outputInWide) {
            column--;
            if (current instanceof Element && current.tagName == "SPAN"
                && current.getAttribute("class") == "wc-node") {
                current = parent;
                parent = current.parentNode;
            }
        } else if (typeof current === 'number') {
            // Wasteful (should just scan forwards) but simple.
            let val = parent instanceof Text ? parent.data
                : parent.getAttribute("content-value");
            column -= this.strWidthInContext(val.substring(0, current), parent);
            current = parent;
            parent = current.parentNode;
        }
    } else {
        var homeLine = this.homeLine;
        var lineCount = this.lineStarts.length;
        // FIXME this doesn't handle currentCommandGroup() != null
        // and goalAbsLine < lineCount
        const currentGroup = this.currentCommandGroup();
        let before = null;
        while (goalAbsLine >= lineCount) {
            if (! addSpaceAsNeeded)
                return;
            let lastParent;
            let newPre = true;
            if (lineCount == this.homeLine) {
                parent = this.initial;
                lastParent = null;
            } else {
                lastParent = this.lineEnds[lineCount-1];
                if (lastParent == null)
                    lastParent = this.lineStarts[lineCount-1];
                for (;;) {
                    if (Terminal.isBlockNode(lastParent))
                        break;
                    var p = lastParent.parentNode;
                    if (p == this.initial)
                        break;
                    lastParent = p;
                }
                if (lastParent.parentNode == currentGroup) {
                    if (lastParent.classList.contains("input-line")
                        && this.sstate.stayInInputMode) {
                        parent = lastParent;
                        before = lastParent.lastChild;
                        newPre = false;
                    } else {
                        // FIXME use startOutput
                        var commandOutput = document.createElement("div");
                        commandOutput.setAttribute("class", "command-output");
                        currentGroup.appendChild(commandOutput);
                        parent = commandOutput;
                    }
                } else {
                    parent = lastParent.parentNode;
                }
            }
            parent = this._appendLine(newPre?"block":"hard", lastParent,
                                      parent, before);
            lineCount++;
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
    this.outputInWide = false;
    if (column != goalColumn) {
        var lineEnd = this.lineEnds[absLine];
        let lineStart = this.lineStarts[absLine];
        // At this point we're at the correct line; scan to the desired column.
        mainLoop:
        while (column < goalColumn) {
            var handled = false; // if column has been updated for current
            if (current instanceof Element && current.nodeName == "SPAN") {
                let valueAttr = current.getAttribute("content-value");
                if (valueAttr) {
                    let c = this.strColumnToIndex(valueAttr,
                                                  goalColumn - column,
                                                  current);
                    if (c < 0) {
                        column = goalColumn + c;
                        handled = true;
                    } else {
                        column = goalColumn;
                        if (c == valueAttr.length) {
                            handled = true;
                        } else {
                            parent = current;
                            current = c;
                            break mainLoop;
                        }
                    }
                } else if (current.getAttribute("class") == "wc-node") {
                    if (column + 2 <= goalColumn) {
                        column += 2;
                    } else { //if (column + 1 == goalColumn) {
                        column += 1;
                        this.outputInWide = true;
                    }
                    handled = true;
                } else {
                    var tcol = -1;
                    var st = current.getAttribute("style");
                    if (st && st.startsWith("tab-size:")) {
                        tcol = Number(st.substring(9));
                    }
                    if (! isNaN(tcol) && tcol > 0) {
                        tcol = Math.trunc(column / tcol) * tcol + tcol;
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
            }
            if (handled) {
            } else if (current == lineEnd) {
                if (addSpaceAsNeeded) {
                    var str = DomTerm.makeSpaces(goalColumn-column);
                    var prev = current.previousSibling;
                    // Motivation: handle '\t' while inside <span std="error">.
                    // (Java stacktraces by default prints with tabs.)
                    if (prev && prev.nodeName == "SPAN"
                        && prev.getAttribute("std") == "error"
                        && this._isAnAncestor(this.outputContainer,
                                              current.previousSibling)) {
                        parent = current.previousSibling;
                        current = null;
                    }
                    let input = this._getOuterPre(parent, "input-line");
                    if (input && input != parent) {
                        this.outputBefore = current;
                        this.outputContainer = parent;
                        this._splitParents(input);
                        current = this.outputBefore;
                        parent = this.outputContainer;
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
            else if (current instanceof Text || parent instanceof Text) {
                let tnode, tstart;
                if (current instanceof Text) {
                    tnode = current;
                    tstart = 0;
                } else {
                    tnode = parent;
                    tstart = current;
                    current = tnode;
                    parent = tnode.parentNode;
                }
                var before;
                var text = tnode.textContent;
                var tlen = text.length;
                var i = tstart;
                for (; i < tlen;  i++) {
                    if (absLine >= goalAbsLine && column >= goalColumn) {
                        parent = tnode;
                        current = i;
                        break mainLoop;
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
            if (current instanceof Node) {
                if (current instanceof Element && !handled) {
                    let valueAttr = current.getAttribute("content-value");
                    if (this.isObjectElement(current))
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
                }
                // Otherwise, go to the next sibling.
                ch = current.nextSibling;
                if (ch != null || (ch == lineEnd && parent == lineStart)) {
                    if (! ch)
                        console.log("setting current to null 2");
                    current = ch;
                    continue;
                }
                // Otherwise go to the parent's sibling - but this gets complicated.
                if (Terminal.isBlockNode(current))
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
                if (parent == null)
                    console.log("NULL parent!");
                var sib = parent.nextSibling;
                ch = parent; // ??
                parent = parent.parentNode;
                if (sib != null || (sib == lineEnd && parent == lineStart)) {
                    current = sib;
                    //parent = ch;
                    break;
                }
            }
        }
    }
    let nparent = this._maybeGoDeeper(current);
    if (nparent) {
        parent = nparent;
        current = nparent.firstChild;
    }
    if (parent == this._caretNode) {
        console.log("moveAbs FIX1");
        current = current == parent.firstChild ? parent : parent.nextSibling;
        parent = parent.parentNode;
    }
    if (parent == this._caretNode.firstChild) {
        console.log("moveAbs FIX2");
        current = current == 0 ? this._caretNode : this._caretNode.nextSibling;
        parent =  this._caretNode.parentNode;
    }
    this.outputContainer = parent;
    this.outputBefore = current;
    this.currentAbsLine = absLine;
    this.currentCursorColumn = column;
};

Terminal.prototype._followingText = function(cur, backwards = false) {
    function check(node) {
        if (node == cur)
            return false;
        if (node.tagName == "SPAN" && node.getAttribute("line"))
            return null;
        if (node.tagName == "SPAN" && node.getAttribute("content-value"))
            return node;
        if (node instanceof Text)
            return node;
        return true;
    }
    return Terminal._forEachElementIn(this._getOuterBlock(cur, true), check,
                                      true, backwards, cur);
};

Terminal.prototype._showPassword = function() {
    let input = this._inputLine;
    if (input && input.classList.contains("noecho")
        && this.sstate.hiddenText) {
        DomTerm._replaceTextContents(input, this.sstate.hiddenText);
        this.sstate.hiddenText = undefined;
    }
}

Terminal.prototype.passwordHideChar = function() {
    // "\u25CF" Black circle (used by Firefox/IE); "\u2022" Bullet (Chrome)
    return this.getOption("password-hide-char", "\u25CF");
}

Terminal.prototype._hidePassword = function() {
    let input = this._inputLine;
    if (input && input.classList.contains("noecho")) {
        let ctext = this.sstate.hiddenText || input.textContent;
        let clen =  DomTerm._countCodePoints(ctext);
        DomTerm._replaceTextContents(input, this.passwordHideChar().repeat(clen));
        this.sstate.hiddenText = ctext;
    }
}

// "Normalize" caret by moving caret text to following node.
// Doesn't actually remove the _caretNode node, for that use _removeInputLine.
// FIXME maybe rename to _removeCaretText
Terminal.prototype._removeCaret = function(normalize=true) {
    var caretNode = this._caretNode;
    if (caretNode && caretNode.getAttribute("caret")) {
        var child = caretNode.firstChild;
        caretNode.removeAttribute("caret");
        let next = caretNode.nextSibling;
        if (child instanceof Text) {
            let sel = document.getSelection();
            let focusNode = sel.focusNode;
            let anchorNode = sel.anchorNode;
            let focusOffset = sel.focusOffset;
            let anchorOffset = sel.anchorOffset;
            if (normalize && next !== this.outputBefore
                && next instanceof Text) {
                if (focusNode == caretNode || focusNode == child)
                    focusNode = focusOffset == 1 ? next : caretNode;
                if (anchorNode == caretNode || anchorNode == child)
                    anchorNode = anchorOffset == 1 ? next : caretNode;
                if (focusNode == next)
                    focusOffset++;
                if (anchorNode == next)
                    anchorOffset++;
                next.insertData(0, child.data);
                if (next === this.outputContainer)
                    this.outputBefore += child.length;
                caretNode.removeChild(child);
            } else {
                caretNode.removeChild(child);
                caretNode.parentNode.insertBefore(child, caretNode.nextSibling);
            }
            if (sel.rangeCount) {
                sel.setBaseAndExtent(anchorNode, anchorOffset,
                                     focusNode, focusOffset);
            }
        }
        let value = caretNode.getAttribute("value");
        let nextValue;
        if (value && next && next.nodeName == "SPAN"
            && (nextValue = next.getAttribute("content-value")) != null) {
            next.setAttribute("content-value", value + nextValue);
        }
    }
}

Terminal.prototype._removeInputFromLineTable = function() {
    let startLine = this.getAbsCursorLine();
    let seenAfter = false;
    function removeInputLineBreaks(prevLine, lineStart, lineAttr, lineno) {
        if (lineStart.getAttribute("line"))
            return true;
        seenAfter = true;
        if (seenAfter)
            return false;
    }
    this._adjustLines(startLine, removeInputLineBreaks);
}

Terminal.prototype._removeInputLine = function() {
    if (this.inputFollowsOutput) {
        this._removeCaret();
        let inputLine = this._inputLine;
        if (inputLine) {
            if (inputLine.parentNode && inputLine !== this._miniBuffer) {
                this._removeInputFromLineTable();
                if (this.outputBefore == inputLine)
                    this.outputBefore = inputLine.nextSibling;
                inputLine.parentNode.removeChild(inputLine);
            }
            return;
        }
        var caretParent = this._caretNode.parentNode;
        if (caretParent != null) {
            let r;
            if (this.isLineEditing()) {
                r = new Range();
                r.selectNode(this._caretNode);
            } else
                r = this._positionToRange();
            let before = this._caretNode.previousSibling;
            if (document.activeElement === this._caretNode)
                this.maybeFocus();
            let sel = window.getSelection();
            if (sel.focusNode == this._caretNode)
                sel.removeAllRanges();
            caretParent.removeChild(this._caretNode);
            if (before instanceof Text && before.nextSibling instanceof Text)
                before.parentNode.normalize();
            this._positionFromRange(r);
        }
    }
};

Terminal.prototype.useStyledCaret = function(caretStyle = this.caretStyle()) {
    return caretStyle !== Terminal.NATIVE_CARET_STYLE
        && this.sstate.showCaret;
};
/* True if caret element needs a "value" character. */
Terminal.prototype._caretNeedsValue = function(caretStyle = this.caretStyle()) {
    return caretStyle <= 4;
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

Terminal.prototype._restoreCaret = function() {
    if (this._caretNode == null)
        return;
    this._restoreCaretNode();
    let sel = window.getSelection();
    if (sel.focusNode == null)
        sel.collapse(this._caretNode, 0);
    let cparent = this._caretNode.parentNode;
    if (! this._suppressHidePassword)
        this._hidePassword();
    const cstyle = this.caretStyle();
    if (this.useStyledCaret(cstyle)) {
        if (! this._caretNode.getAttribute("caret")
            && (! (this._caretNode.firstChild instanceof Text)
                || this._caretNode.firstChild.data.length == 0)) {
            if (this._caretNeedsValue(cstyle)) {
                let text = this._followingText(this._caretNode);
                let tdata = text instanceof Text ? text.data
                    : text instanceof Element ? text.getAttribute("content-value")
                    : null;
                if (tdata) {
                    if (text.previousSibling !== this._caretNode) {
                        text.parentNode.insertBefore(this._caretNode, text);
                        if (this.outputBefore === this._caretNode)
                            this.outputContainer = text.parentNode;
                    }
                    var sz = 1;
                    if (tdata.length >= 2) {
                        var ch0 = tdata.charCodeAt(0);
                        var ch1 = tdata.charCodeAt(1);
                        if (ch0 >= 0xD800 && ch0 <= 0xDBFF
                            && ch1 >= 0xDC00 && ch1 <= 0xDFFF)
                            sz = 2;
                    }
                    let ptext = text.parentNode;
                    if (DomTerm._isPendingSpan(ptext)
                        && this._caretNode.parentNode !== ptext) {
                        if (this.outputBefore === this._caretNode)
                            this.outputBefore = this._caretNode.nextSibling;
                        ptext.insertBefore(this._caretNode, text);
                    }
                    var ch = tdata.substring(0, sz);
                    if (text === this.outputBefore
                        || (text === this.outputContainer
                            && this.outputBefore < sz)) {
                        this.outputBefore = this._caretNode;
                        this.outputContainer = this.outputBefore.parentNode;
                    } else if (text === this.outputContainer) {
                        this.outputBefore -= sz;
                    }
                    if (text instanceof Text) {
                        this._caretNode.appendChild(document.createTextNode(ch));
                        this._deleteData(text, 0, sz);
                        this._caretNode.removeAttribute("value");
                    } else { // content-value attribute
                        this._caretNode.setAttribute("value", ch);
                        text.setAttribute("content-value", tdata.substring(sz));
                    }
                    /*
                    if (this._caretNode.parentNode == this._deferredForDeletion
                        && ptext != this._deferredForDeletion)
                        this._deferredForDeletion.textAfter += ch;
                    */
                } else
                    this._caretNode.setAttribute("value", " ");
            } else
                this._caretNode.removeAttribute("value");
        }
        const cstyleStr = Terminal.caretStyles[cstyle];
        if (cstyleStr)
            this._caretNode.setAttribute("caret", cstyleStr);
    }
    else {
        let sel = document.getSelection();
        if (sel.isCollapsed) {
            if (this.sstate.showCaret)
                sel.collapse(this._caretNode, 0);
            else if (! this._mouseButtonPressed)
                this._clearSelection();
        }
    }
}

Terminal.prototype._restoreCaretNode = function() {
    if (this._caretNode.parentNode == null) {
        this._fixOutputPosition();
        this.outputContainer.insertBefore(this._caretNode, this.outputBefore);
        this.outputContainer.normalize();
        this.outputBefore = this._caretNode;
    }
}

Terminal.prototype._restoreInputLine = function(caretToo = true) {
    let inputLine = this._inputLine || this._caretNode;
    if (this.inputFollowsOutput && inputLine != null
       && inputLine !== this._miniBuffer) {
        let lineno;
        if (this._inputLine) {
            lineno = this.getAbsCursorLine();
            inputLine.startLineNumber = lineno;
        }
        this._fixOutputPosition();
        if (inputLine.parentNode === null) {
            this.outputContainer.insertBefore(inputLine, this.outputBefore);
            //this.outputContainer.normalize();
            this.outputBefore = inputLine;
            if (this._pagingMode == 0 && ! DomTerm.usingXtermJs())
                this.maybeFocus();
            if (this._inputLine) {
                let dt = this;
                // Takes time proportional to the number of lines in _inputLine
                // times lines below the input.  Both are likely to be small.
                Terminal._forEachElementIn(inputLine,
                                       function (el) {
                                           if (el.nodeName == "SPAN"
                                               && el.getAttribute("Line")=="hard") {
                                               dt._insertIntoLines(el, lineno++);
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
Terminal.prototype.cursorLineStart = function(deltaLines) {
    let curLine = this.getAbsCursorLine();
    if (deltaLines == 1 && curLine == this.lineStarts.length-1) {
        if (this._currentStyleMap.size == 0)
            this._adjustStyle();
        if (this._pendingEchoNewlines
            && --this._pendingEchoNewlines == 0
            && this.outputBefore === null
            && this.outputContainer.nodeName === "SPAN") {
            this.outputBefore = this.outputContainer.nextSibling;
            this.outputContainer = this.outputContainer.parentNode;
        }
        let next = this.outputBefore;
        let parent = this.outputContainer;
        // If output position inside an inline element *and* at end of line,
        // then we prefer to insert a nested newline element (to avoid
        // breaking up semantically-meaningful spans).
        // Otherwise, create a new line block (domterm-pre, usually).
        let newBlock = Terminal.isBlockNode(parent);
        if (! newBlock) {
            let endLine = this.lineEnds[curLine];
            for (; parent  ;) {
                if (next != null && next != endLine) {
                    newBlock = true;
                    break;
                }
                if (Terminal.isBlockNode(parent))
                    break;
                next = parent.nextSibling;
                parent = parent.parentNode;
            }
        }
        if (! newBlock) {
            this._appendLine("hard", this.outputContainer, null, this.outputBefore);
            let newLine = this.lineEnds[curLine];
            this.outputContainer = newLine.parentNode;
            this.outputBefore = newLine.nextSibling;
            this.currentAbsLine = curLine + 1;
            this.currentCursorColumn = 0;
            return;
        }
    }
    this.moveToAbs(curLine+deltaLines, 0, true);
};

Terminal.prototype.cursorDown = function(count) {
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
    let col = this.getCursorColumn();
    if (col === this.numColumns)
        col--;
    this.moveToAbs(next+this.homeLine, col, true);
};

Terminal.prototype.cursorNewLine = function(autoNewline) {
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

Terminal.prototype.cursorRight = function(count) {
    // FIXME optimize same way cursorLeft is.
    this.columnSet(this.getCursorColumn()+count);
};

Terminal.prototype.cursorLeft = function(count, maybeWrap) {
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
    // Optimize common case
    let tcount, prev;
    if (this.outputContainer instanceof Text) {
        prev = this.outputContainer;
        tcount = prev.data.length - this.outputBefore;
    } else {
        prev = this.outputBefore ? this.outputBefore.previousSibling
            : this.outputContainer.lastChild;
        tcount = 0;
    }
    if (prev instanceof Text) {
        let tstr = prev.data;
        let len = tstr.length;
        // tcount is index in tstr, counting from end
        let tcols = 0;
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
        count -= tcols;
        if (tcount == 0) {
            this.outputContainer=prev.parentNode;
            this.outputBefore=prev.nextSibling;
        } else if (len==tcount) {
            this.outputContainer=prev.parentNode;
            this.outputBefore=prev;
        } else if (tcount > 0) {
            this.outputContainer = prev;
            this.outputBefore = len - tcount;
            this._normalize1(prev);
        }
        if (tcount > 0 && this.currentCursorColumn > 0)
            this.currentCursorColumn -= tcols;
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
Terminal.prototype._pushStyle = function(styleName, styleValue) {
    if (styleValue)
        this._currentStyleMap.set(styleName, styleValue);
    else
        this._currentStyleMap.delete(styleName);
    this._currentStyleSpan = null;
};
Terminal.prototype.mapColorName = function(name) {
    return "var(--dt-"+name.replace(/-/, "")+")";
}
Terminal.prototype._pushFgStdColor = function(name) {
    this._pushStyle("color", this.mapColorName(name));
}
Terminal.prototype._pushBgStdColor = function(name) {
    this._pushStyle("background-color", this.mapColorName(name));
}

Terminal._getStdElement = function(element) {
    if (element instanceof Text)
        element = element.parentNode;
    for (var stdElement = element;
         stdElement instanceof Element;
         stdElement = stdElement.parentNode) {
        if (stdElement.getAttribute("std"))
            return stdElement;
    }
    return null;
};
Terminal.prototype._getStdMode = function(element=this.outputContainer) {
    let el = Terminal._getStdElement(element);
    return el == null ? null : el.getAttribute("std");
}

Terminal.prototype._pushStdMode = function(styleValue) {
    var stdElement = Terminal._getStdElement(this.outputContainer);
    if (stdElement == null ? styleValue == null
        : stdElement.getAttribute("std") == styleValue)
        return;
    if (stdElement != null) {
        this._fixOutputPosition();
        this._splitParents(stdElement.parentNode);
    }
    if (styleValue != null) {
        let nxt = this.outputBefore;
        if (nxt instanceof Element && nxt.getAttribute("std") === styleValue) {
            // This can happen after implicit startPrompt (OSC 133 A)
            // followed by explicit startPrompt (PSC 133 P).
            this.outputContainer = nxt;
            this.outputBefore = nxt.firstChild;
        } else {
            stdElement = this._createSpanNode();
            stdElement.setAttribute("std", styleValue);
            this._pushIntoElement(stdElement);
        }
    }
};

Terminal.prototype._clearStyle = function() {
    this._currentStyleMap.clear();
    this._currentStyleSpan = null;
};

Terminal.prototype._splitNode = function(node, splitPoint) {
    var newNode = document.createElement(node.nodeName);
    this._copyAttributes(node, newNode);
    this._moveNodes(splitPoint, newNode, null);
    node.parentNode.insertBefore(newNode, node.nextSibling);
    return newNode;
};

Terminal.prototype._popStyleSpan = function() {
    this._currentStyleSpan = null;
    this._fixOutputPosition();
    var parentSpan = this.outputContainer;
    if (this.outputBefore != null) {
        if (this.outputBefore == this.outputContainer.firstChild) {
            this.outputContainer = parentSpan.parentNode;
            this.outputBefore = parentSpan;
            return;
        }
        // split into new child
        this._splitNode(parentSpan, this.outputBefore);
    }
    this.outputContainer = parentSpan.parentNode;
    this.outputBefore = parentSpan.nextSibling;
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

Terminal.prototype.isSavedSession = function() {
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
Terminal.prototype._adjustStyle = function() {
    var parentSpan = this.outputContainer;
    if (this.sstate.inInputMode) {
        this._fixOutputPosition();
        parentSpan = this.outputContainer;
        let n = parentSpan;
        let p = this.outputBefore;
        while (n instanceof Node
               && ! (n.nodeName == "DIV" && n.classList.contains("input-line"))) {
            if (n.nodeName == "SPAN" && n.getAttribute("std")) {
                n = null;
                break;
            }
            p = n;
            n = n.parentNode;
        }
        if (n instanceof Element) {
            if (p instanceof Element && p.getAttribute("std") == "input") {
                this.outputContainer = p;
                this.outputBefore = p.firstChild;
            } else if (p !== null && p.previousSibling instanceof Element
                       && p.previousSibling.getAttribute("std") == "input") {
                this.outputContainer = p.previousSibling; // ????
                this.outputBefore = null;
            } else if (p == null && n.lastChild instanceof Element
                       && n.lastChild.getAttribute("std") == "input") {
                this.outputContainer = n.lastChild;
                this.outputBefore = null;
            } else {
                const stdElement = this._createSpanNode();
                stdElement.setAttribute("std", "input");
                n.insertBefore(stdElement, p);
                if (n == parentSpan) {
                    this.outputContainer = stdElement;
                    this.outputBefore = null;
                } else {
                    stdElement.appendChild(p);
                }
            }
        }
    }
    if (parentSpan instanceof Text)
        parentSpan = parentSpan.parentNode;
    if (this._currentStyleSpan === parentSpan)
        return;
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
        let styleSpan = this._createSpanNode("term-style");
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
        this._fixOutputPosition();
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

Terminal.prototype.insertLinesIgnoreScroll = function(count, line) {
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

Terminal.prototype._addBlankLines = function(count, absLine, parent, oldStart) {
    for (var i = 0; i < count;  i++) {
        var preNode = this._createPreNode();
        this._setBackgroundColor(preNode, this._currentStyleBackground());
        var newLine = this._createLineNode("hard", "\n");
        preNode.appendChild(newLine);
        parent.insertBefore(preNode, oldStart);
        preNode._widthMode = Terminal._WIDTH_MODE_NORMAL;
        preNode._widthColumns = 0;
        this.lineStarts[absLine+i] = preNode;
        this.lineEnds[absLine+i] = newLine;
    }
};

Terminal.prototype._rootNode = function(node) {
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

Terminal.prototype._isAnAncestor = function(node, ancestor) {
    while (node != ancestor) {
        var parent = node.parentNode;
        if (! parent)
            return false;
        node = parent;
    }
    return true;
};

Terminal.prototype.deleteLinesIgnoreScroll = function(count, absLine = this.getAbsCursorLine()) {
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
    var parent = start.parentNode;
    let cur = absLine > 0 && start == this.lineEnds[absLine-1]
        ? start.nextSibling
        : start;
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
                if (Terminal.isNormalBlock(start))
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
    if (this.homeLine > length)
        this.homeLine = length;
};

Terminal.prototype._insertLinesAt = function(count, line, regionBottom) {
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

Terminal.prototype.insertLines = function(count) {
    var line = this.getCursorLine();
    if (line >= this._regionTop)
        this._insertLinesAt(count, line, this._regionBottom);
};

Terminal.prototype._deleteLinesAt = function(count, line) {
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

 Terminal.prototype.deleteLines = function(count) {
     this._deleteLinesAt(count, this.getAbsCursorLine());
};

Terminal.prototype.scrollForward = function(count) {
    var line = this.getCursorLine();
    this.moveToAbs(this._regionTop+this.homeLine, 0, true);
    this._deleteLinesAt(count, this._regionTop+this.homeLine);
    this.moveToAbs(line+this.homeLine, 0, true);
};

Terminal.prototype.scrollReverse = function(count) {
    var line = this.getAbsCursorLine();
    this._insertLinesAt(count, this._regionTop, this._regionBottom);
    this.moveToAbs(line, 0, true);
};

Terminal.prototype._currentStyleBackground = function() {
    return this._currentStyleMap.get("background-color");
}

Terminal.prototype._getBackgroundColor = function(element) {
    return element.style.backgroundColor || null;
}
Terminal.prototype._setBackgroundColor = function(element, bgcolor) {
    element.style.backgroundColor = bgcolor || "";
}

Terminal.prototype._createPreNode = function() {
    //return document.createElement("pre");
    // Prefer <div> over <pre> because Firefox adds extra lines when doing a Copy
    // spanning multiple <pre> nodes.
    var n = document.createElement("div");
    n.setAttribute("class", "domterm-pre");
    return n;
};

Terminal.prototype._getOuterPre = function(node, className = "domterm-pre") {
    for (var v = node; v != null && v != this.topNode; v = v.parentNode) {
        if (v instanceof Element && v.classList.contains(className))
            return v;
    }
    return null;
}
Terminal.prototype._getOuterInputArea = function(node = this._caretNode) {
    if (node === this._caretNode) {
        let v = node.previousSibling;
        if (v instanceof Element && v.getAttribute("std") == "input")
            return v;
    }
    for (var v = node; v != null && v != this.topNode; v = v.parentNode) {
        if (v instanceof Element && v.getAttribute("std") == "input")
            return v;
    }
    return null;
}

Terminal.prototype._createSpanNode = function(cls=null, txt=null) {
    let el = document.createElement("span");
    if (cls)
        el.setAttribute("class", cls);
    if (txt)
        el.appendChild(document.createTextNode(txt));
    return el;
};

Terminal.prototype.makeId = function(local) {
    return this.name + "__" + local;
};

Terminal.prototype._createLineNode = function(kind, text=kind=="hard"?"\n":"") {
    var el = document.createElement("span");
    // the following is for debugging
    el.setAttribute("id", this.makeId("L"+(++this.lineIdCounter)));
    if (kind=="soft")
        el.setAttribute("breaking", "yes");
    el.setAttribute("line", kind);
    el.stayOut = true;
    el.outerPprintGroup = this._currentPprintGroup;
    if (text)
        el.appendChild(document.createTextNode(text));
    return el;
};
 
// If index >= 0, index from first (top)
// If index < 0, index from last (bottom).
// 0 is first buffer; -1 is current (last) buffer.
DomTerm._currentBufferNode = function(dt, index)
{
    let node = index >= 0 ? dt.buffers.firstChild : dt.buffers.lastChild;
    let todo = index >= 0 ? index : -1 - index;
    while (node) {
        if (node.nodeName == 'DIV'
            && node.classList.contains('interaction')
            && --todo < 0) {
            break;
        }
        node = index >= 0 ? node.nextSibling : node.previousSibling;
    }
    return node;
}

Terminal.prototype.getAllBuffers = function() {
    let buffers = [];
    for (let bnode = this.buffers.firstChild; bnode;
         bnode = bnode.nextSibling) {
        if (bnode.nodeName == 'DIV'
            && bnode.classList.contains('interaction'))
            buffers.push(bnode);
    }
    return buffers;
}

Terminal.prototype.pushClearScreenBuffer = function(alternate, noScrollTop) {
    this.saveCursor();
    this.pushScreenBuffer(alternate);
    this.cursorSet(0, 0, false);
    this.resetTerminal(-1, false);
    this.eraseDisplay(0);
    if (noScrollTop)
        this.initial.noScrollTop = true;
}
Terminal.prototype.popRestoreScreenBuffer = function() {
    this.popScreenBuffer();
    this.restoreCursor(true);
}

Terminal.prototype.pushScreenBuffer = function(alternate = true) {
    const line = this.getCursorLine();
    const col = this.getCursorColumn();
    const nextLine = this.lineEnds.length;
    const bufNode = this._createBuffer(this._altBufferName,
                                       alternate ? "alternate" : "main");
    this.buffers.insertBefore(bufNode, this.initial.nextSibling);
    const homeOffset = DomTerm._homeLineOffset(this);
    const homeNode = this.lineStarts[this.homeLine - homeOffset];
    homeNode.setAttribute("home-line", homeOffset);
    bufNode.saveLastLine = nextLine;
    this.sstate.savedCursorMain = this.sstate.savedCursor;
    this.sstate.savedCursor = undefined;
    this.sstate.savedPauseLimit = this._pauseLimit;
    const newLineNode = bufNode.firstChild;
    this.homeLine = nextLine;
    this.outputContainer = newLineNode;
    this.outputBefore = newLineNode.firstChild;
    this._removeInputLine();
    bufNode.style.width = this.initial.style.width;
    this.initial = bufNode;
    this.resetCursorCache();
    this.moveToAbs(line+this.homeLine, col, true);
    this._adjustPauseLimit();
    this.usingAlternateScreenBuffer = alternate;
}

Terminal.prototype.popScreenBuffer = function()
{
    const bufNode = this.initial;
    const bufPrev = DomTerm._currentBufferNode(this, -2);
    if (! bufPrev)
        return;
    this.initial = bufPrev;
    this.lineStarts.length = bufNode.saveLastLine;
    this.lineEnds.length = bufNode.saveLastLine;
    let homeNode = null;
    let homeOffset = -1;
    Terminal._forEachElementIn(this.initial,
                               function(node) {
                                   const offset = node.getAttribute('home-line');
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
    if (! DomTerm._currentBufferNode(this, -2))
        bufPrev.setAttribute("buffer", "main only");
    this._pauseLimit = this.sstate.savedPauseLimit;
}

Terminal.prototype.setAlternateScreenBuffer = function(val) {
    if (this.usingAlternateScreenBuffer != val) {
        this._setRegionTB(0, -1);
        if (val) {
            this.pushScreenBuffer(val);
        } else {
            this.popScreenBuffer();
            this.usingAlternateScreenBuffer = val; // FIXME
        }
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
Terminal.prototype.isObjectElement = function(node) {
    var tag = node.tagName;
    return "OBJECT" == tag || "CANVAS" == tag
        || "IMG" == tag || "SVG" == tag || "IFRAME" == tag;
};

Terminal.isNormalBlock = function(node) {
    let tag = node.nodeName;
    return tag == "PRE" || tag == "P" || tag == "DIV";
}

Terminal.isBlockNode = function(node) {
    return node instanceof Element
        && Terminal.isBlockTag(node.tagName.toLowerCase());
};

Terminal.isBlockTag = function(tag) { // lowercase tag
    var einfo = DomTerm._elementInfo(tag, null);
    return (einfo & DomTerm._ELEMENT_KIND_INLINE) == 0;
}

Terminal.prototype._getOuterBlock = function(node, stopIfInputLine=false) {
    for (var n = node; n; n = n.parentNode) {
        if ((stopIfInputLine && n == this._inputLine)
            || Terminal.isBlockNode(n))
            return n;
    }
    return null;
}

// Obsolete?  We should never have a <br> node in the DOM.
// (If we allow it, we should wrap it in a <span line="br">.)
Terminal.prototype.isBreakNode = function( node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "BR" == tag;
};

Terminal.prototype.isSpanNode = function(node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "SPAN" == tag;
};

// Set up event handlers and resize-handling for active and saved sessions.
// Should be called after settings loaded (specifically after
// stylesheets set/loaded) but before processing output text.
Terminal.prototype._initializeDomTerm = function(topNode) {
    if (this._rulerNode)
        return;
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

    topNode.contentEditable = true;

    var wrapDummy = this._createLineNode("soft");
    helperNode.appendChild(wrapDummy);
    this._wrapDummy = wrapDummy;
    DomTerm.setFocus(this, "N");
    var dt = this;
    // Should be zero - support for topNode.offsetLeft!=0 is broken
    this._topLeft = dt.topNode.offsetLeft;

    this._mouseButtonPressed = false;
    this._didExtend = false;

    topNode.addEventListener('wheel',
                             function(e) { dt._disableScrollOnOutput = true; },
                             {passive: true});
    topNode.addEventListener("mousedown", this._mouseEventHandler, false);
    topNode.addEventListener("mouseup", this._mouseEventHandler, false);
    topNode.addEventListener("mouseleave",
                             function(e) {
                                 dt._altPresssed = false;
                                 if (dt._mouseButtonPressed)
                                     dt._updateSelected();
                                 dt._mouseButtonPressed = false;
                             }, false);
    function handleContextMenu(e) {
        if (dt.sstate.mouseMode != 0)
            e.preventDefault();
        else if (DomTerm.showContextMenu && ! e.shiftKey) {
            let opts = {inputMode: dt.getInputMode(),
                        autoPaging: dt._autoPaging,
                        clientX: e.clientX / dt._computedZoom,
                        clientY: e.clientY / dt._computedZoom};
            let link = DomTerm._isInElement(e.target, "A");
            if (link) {
                opts.contextType = "A";
                opts.href = link.getAttribute("href");
                let range = document.createRange();
                range.selectNodeContents(link);
                opts.contentValue = {
                    text: Terminal._rangeAsText(range),
                    html: Terminal._rangeAsHTML(range)
                };
            }
            if (DomTerm.showContextMenu(opts))
                e.preventDefault();
        }
    }
    this.topNode.addEventListener("contextmenu", handleContextMenu, false);

    this._selectionchangeListener = function(e) {
        let sel = document.getSelection();
        let point = sel.isCollapsed;
        if (DomTerm.verbosity >= 3)
            dt.log("selectionchange col:"+point+" sel:"+DomTerm.displaySelection(sel)+" str:'"+sel.toString()+"' alt:"+dt._altPressed);
        if (dt._composing > 0)
            return;
        if (! point && dt._displayInfoWidget) {
            // The following hack wouldn't be needed if browsers supported
            // 'user-select: contain', or if the work-around using
            // contentEditable (see addInfoDisplay) worked consistently
            // (it seems to work on Chrome).
            let focusWidget = dt._getOuterPre(sel.focusNode, "domterm-info-widget");
            let anchorWidget = dt._getOuterPre(sel.anchorNode, "domterm-info-widget");
            if (focusWidget !== anchorWidget) {
                if (anchorWidget) {
                    let wrange = new Range();
                    wrange.selectNodeContents(anchorWidget);
                    let comp = sel.focusNode
                        .compareDocumentPosition(anchorWidget);
                    if ((comp & 4) != 0)
                        sel.extend(wrange.startContainer, wrange.startOffset);
                    else
                        sel.extend(wrange.endContainer, wrange.endOffset);
                } else
                    sel.extend(sel.anchorNode, sel.anchorOffset);
            }
        }
        if (dt._focusinLastEvent) {
            dt._focusinLastEvent = false;
            if (point && sel.focusOffset === 0
                && sel.focusNode == dt._vspacer) {
                // Chrome sometimes emits this extra selectionchange event.
                // It used to be to the very first text location, but
                // now hits the _vspacer element.
                return; //  Ignore it.
            }
        }
        // (We want to not update selection while a mouse button mouse is pressed.)
        if (! dt._mouseButtonPressed)
            dt._updateSelected();

        dt._restoreCaret();
    }
    document.addEventListener("selectionchange", dt._selectionchangeListener);

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


    this.attachResizeSensor();

    var vspacer = document.createElement("div");
    vspacer.setAttribute("class", "domterm-spacer");
    vspacer.dtHeight = 0;
    this.buffers.appendChild(vspacer);
    this._vspacer = vspacer;
};

/*
Terminal.prototype._findHomeLine = function(bufNode) {
    Terminal._forEachElementIn(bufNode,
                           function(node) {
                               var offset = node.getAttribute('home-line');
                               return offset != null ? node : null;
                           });
}
*/

Terminal.prototype._computeHomeLine = function(home_node, home_offset,
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
        line = this.initial.saveLastLine;
    }
    var minHome = this.lineStarts.length - this.numRows;
    return line <= minHome ? minHome
        : line < this.lineStarts.length ? line : home_line;
}

DomTerm._checkStyleResize = function(dt) { dt.resizeHandler(); }

Terminal.prototype.resizeHandler = function() {
    var dt = this;
    // FIXME we want the resize-sensor to be a child of helperNode
    if (DomTerm.verbosity > 0)
        dt.log("ResizeSensor called "+dt.name); 
    var oldWidth = dt.availWidth;
    dt.measureWindow();
    if (DomTerm.usingXtermJs()) return;
    let minColumns = dt.getOption("terminal.minimum-width", 5);
    if (this.numColumns < minColumns)
        this.forceWidthInColumns(minColumns);
    dt._displaySizeInfoWithTimeout();

    var home_offset = DomTerm._homeLineOffset(dt);
    var home_node = dt.lineStarts[dt.homeLine - home_offset];
    if (dt.availWidth != oldWidth && dt.availWidth > 0) {
        dt._removeCaret();
        dt._breakAllLines(-2);
        dt._restoreSaveLastLine();
        dt.resetCursorCache();
        if (dt._displayInfoWidget) {
            DomTerm._positionInfoWidget(dt._displayInfoWidget, dt);
        }
    }
    if (dt.usingAlternateScreenBuffer)
        dt.homeLine = dt._computeHomeLine(home_node, home_offset, true);
    else {
        const minHome = this.lineStarts.length - this.numRows;
        const bufferFirstLine = this.initial.saveLastLine;
        dt.homeLine = minHome >= bufferFirstLine ? minHome : bufferFirstLine;
    }
    dt._checkSpacer();
    dt._scrollIfNeeded();
}

Terminal.prototype.attachResizeSensor = function() {
    var dt = this;
    dt._resizeSensor = new ResizeSensor(dt.topNode, function() { dt.resizeHandler(); });
}

Terminal.prototype.detachResizeSensor = function() {
    if (this._resizeSensor)
        this._resizeSensor.detach();
    this._resizeSensor = null;
};

Terminal.prototype._displayInputModeWithTimeout = function(text) {
    text = '<span>'+text+'</span>';
    this._modeInfoDiv = this._displayInfoWithTimeout(text, this._modeInfoDiv);
};

Terminal.prototype._displayInfoWithTimeout = function(text, div = null, timeout = Terminal.INFO_TIMEOUT) {
    var dt = this;
    if (div == null)
        div = document.createElement("div");
    div = DomTerm.addInfoDisplay(text, div, dt);
    if (timeout >= 0) {
        function clear() {
            div.timeoutId = undefined;
            DomTerm.removeInfoDisplay(div, dt);
        };
        if (div.timeoutId)
            clearTimeout(div.timeoutId);
        div.timeoutId = setTimeout(clear, timeout);
    }
    return div;
};

Terminal.prototype._sizeInfoText = function() {
    // Might be nicer to keep displaying the size-info while
    // button-1 is pressed. However, that seems a bit tricky.
    let text = ""+this.numColumns+"\xD7"+this.numRows
        +" ("+DomTerm.toFixed(this.availWidth, 2)+"\xD7"
        +DomTerm.toFixed(this.availHeight, 2);
    if (this.sstate.forcedSize) {
        text += "px, actual:"
            + DomTerm.toFixed(this.topNode.clientWidth -  this.rightMarginWidth)
            + "\xD7" + DomTerm.toFixed(this.actualHeight);
    }
    text += "px)";
    let ratio = window.devicePixelRatio;
    if (ratio)
        text += " "+(ratio*100.0).toFixed(0)+"%";
    return text;
}

Terminal.prototype._displaySizeInfoWithTimeout = function() {
    this._resizeInfoDiv =
        this._displayInfoWithTimeout(this._sizeInfoText(), this._resizeInfoDiv);
};

DomTerm.removeInfoDisplay = function(div, dt) {
    let closeHandler = div.closeHandler;
    if (closeHandler) {
        div.closeHandler = undefined;
        closeHandler(div);
    }
    var widget = dt._displayInfoWidget;
    if (widget && div && div.parentNode == widget) {
        widget.removeChild(div);
        let first = widget.firstChild;
        if (first == null
            || (first.nextSibling == null
                && first.classList.contains("domterm-show-info-header"))) {
            if (widget.mousedownHandler)
                widget.removeEventHandler("mousedown", widget.mousedownHandler, false);
            widget.mousedownHandler = undefined;
            widget.parentNode.removeChild(widget);
            dt._displayInfoWidget = null;
        }
    }
}
DomTerm._positionInfoWidget = function(widget, dt) {
    let top = dt.topNode;
    top.insertBefore(widget, top.firstChild);
    let topOffset = 0, leftOffset = 0; //, rightOffset = 0;
    let offset = dt._displayInfoYoffset;
    if (typeof offset !== "number") {
        offset = (dt.numRows > 10 ? 1.2 : 0.2) * dt.charHeight;
        dt._displayInfoYoffset = offset;
    }
    if (offset < 0) {
        topOffset = topOffset + dt.topNode.offsetHeight - widget.offsetHeight;
    }
    widget.style["top"] = (offset + topOffset) + "px";
    widget.style["bottom"] = "auto";
}

DomTerm.addInfoDisplay = function(contents, div, dt) {
    // FIXME inconsistent terminology 'widget'
    // Maybe "domterm-show-info" should be "domterm-show-container".
    // Maybe "domterm-info-widget" should be "domterm-info-panel" or "-popup".
    let widget = dt._displayInfoWidget;
    if (widget == null) {
        widget = document.createElement("div");
        widget.setAttribute("class", "domterm-show-info");
        // Workaround for lack of browser support for 'user-select: contain'
        widget.contentEditable = true;

        let header = document.createElement("div");
        header.setAttribute("class", "domterm-show-info-header");
        let close = document.createElement("span");
        header.appendChild(close);
        widget.appendChild(header);

        widget.style["box-sizing"] = "border-box";
        dt._displayInfoWidget = widget;
        let closeAllWidgets = (ev) => {
            for (let panel = widget.firstChild; panel !== null;) {
                let next = panel.nextSibling;
                if (panel.classList.contains("domterm-info-widget"))
                    DomTerm.removeInfoDisplay(panel, dt);
                panel = next;
            }
        }
        widget.mouseDownHandler = (edown) => {
            widget.classList.add("domterm-moving");
            let oldX = edown.pageX / dt._computedZoom;
            let oldY = edown.pageY / dt._computedZoom;// + this.buffers.scrollTop;
            widget.mouseHandler = (e) => {
                let x = e.pageX / dt._computedZoom;
                let y = e.pageY / dt._computedZoom;// + this.buffers.scrollTop;
                if (e.type == "mouseup" || e.type == "mouseleave") {
                    //widget.mouseDown = undefined;
                    if (widget.mouseHandler) {
                        dt.topNode.removeEventListener("mouseup", widget.mouseHandler, false);
                        dt.topNode.removeEventListener("mouseleave", widget.mouseHandler, false);
                        dt.topNode.removeEventListener("mousemove", widget.mouseHandler, false);
                        widget.classList.remove("domterm-moving");
                        widget.mouseHandler = undefined;
                    }
                }
                let diffY = y - oldY;
                if (e.type == "mousemove"
                    && Math.abs(diffY) >= 0) {
                    let diffY = y - oldY;
                    dt._displayInfoYoffset += diffY;
                    // if close to top/bottom edge, switch to relative to it
                    if (dt._displayInfoYoffset >= 0
                        && dt._displayInfoYoffset + widget.offsetHeight > 0.8 * dt.topNode.offsetHeight)
                        dt._displayInfoYoffset =
                        dt._displayInfoYoffset + widget.offsetHeight - dt.topNode.offsetHeight;
                    else if (dt._displayInfoYoffset < 0
                             && widget.offsetHeight - dt._displayInfoYoffset > 0.8 * dt.topNode.offsetHeight)
                        dt._displayInfoYoffset =
                        dt._displayInfoYoffset - widget.offsetHeight + dt.topNode.offsetHeight;
                    DomTerm._positionInfoWidget(widget, dt);
                    oldY = y;
                }
                e.preventDefault();
            };
            dt.topNode.addEventListener("mouseup", widget.mouseHandler, false);
            dt.topNode.addEventListener("mouseleave", widget.mouseHandler, false);
            dt.topNode.addEventListener("mousemove", widget.mouseHandler, false);
            edown.preventDefault();
        };
        header.addEventListener("mousedown", widget.mouseDownHandler, false);
        close.addEventListener("click", closeAllWidgets, false);
    }
    if (! div)
        div = document.createElement("div");
    div.classList.add("domterm-info-widget");
    // Workaround for lack of browser support for 'user-select: contain'
    div.contentEditable = false;
    if (div.parentNode !== widget)
        widget.appendChild(div);
    if (contents.indexOf('<') < 0)
        contents = "<span>" + contents + "</span>";
    div.innerHTML = contents;
    DomTerm._positionInfoWidget(widget, dt);
    return div;
};

DomTerm.displayMiscInfo = function(dt, show) {
    if (show) {
        let contents = "<span>DomTerm "+DomTerm.versionString;
        let sessionNumber = dt.sstate.sessionNumber;
        let rhost = dt.getRemoteHostUser();
        if (rhost)
            contents += " session (remote) "+rhost+"#"+sessionNumber;
        else
            contents += " session #"+sessionNumber;
        if (dt.sstate.disconnected)
            contents += " disconnected";
        else if (dt.windowNumber >= 0) {
            contents += " window:"+dt.windowNumber;
            if (dt.isSecondaryWindow())
                contents += " (secondary)";
            else if (dt.isPrimaryWindow())
                contents += " (primary)";
        }
        contents += "<br/>";
        contents += dt._modeInfo() + "<br/>Size: " + dt._sizeInfoText();
        if (dt.sstate.lastWorkingPath)
            contents += "<br/>Last path: <code>"+DomTerm.escapeText(dt.sstate.lastWorkingPath)+"</code>";
        contents += "</span>";
        dt._showingMiscInfo = DomTerm.addInfoDisplay(contents, dt._showingMiscInfo, dt);
    } else if (dt._showingMiscInfo) {
        DomTerm.removeInfoDisplay(dt._showingMiscInfo, dt);
        dt._showingMiscInfo = undefined;
    }
}

Terminal.prototype._clearPendingDisplayMiscInfo = function() {
    let wasPending = this._keyupDisplayInfo;
    if (wasPending)
        this.topNode.removeEventListener("keyup", wasPending, false);
    this._keyupDisplayInfo = undefined;
    return wasPending;
};

Terminal.prototype.showMiniBuffer = function(options) {
    let prefix = options.prefix || "";
    let postfix = options.postfix || "";
    let contents = '<span>' + prefix
        + '<span class="editing" std="input"></span>'
        + postfix + '</span>';
    let div = DomTerm.addInfoDisplay(contents, null, this);
    let miniBuffer = div.querySelector(".editing");
    this._miniBuffer = miniBuffer;
    miniBuffer.saveInputLine = this._inputLine;
    miniBuffer.saveCaretNode = this._caretNode;
    let caretNode = this._createSpanNode();
    caretNode.setAttribute("std", "caret");
    caretNode.useEditCaretStyle = true;
    caretNode.stayOut = true;
    this._inputLine = miniBuffer;
    this._caretNode = caretNode;
    miniBuffer.caretNode = caretNode;
    miniBuffer.appendChild(caretNode);
    miniBuffer.infoDiv = div;
    document.getSelection().collapse(miniBuffer, 0);
    miniBuffer.contentEditable = true;
    div.contentEditable = false;
    if (options.keymaps)
        miniBuffer.keymaps = options.keymaps;
    if (options.infoClassName)
        div.setAttribute("class", options.infoClassName);
    if (options.mutationCallback) {
        let observer = new MutationObserver(options.mutationCallback);
        observer.observe(miniBuffer,
                         { attributes: false, childList: false, characterData: true, subtree: true });
        miniBuffer.observer = observer;
    }
    div.closeHandler = (d) => {
        if (miniBuffer.observer) {
            miniBuffer.observer.disconnect();
            miniBuffer.observer = undefined;
        }
        this._inputLine = miniBuffer.saveInputLine;
        this._caretNode = miniBuffer.saveCaretNode;
        this._miniBuffer = null;
    };
    return miniBuffer;
}

Terminal.prototype.removeMiniBuffer = function(miniBuffer = this._miniBuffer) {
    this.maybeFocus(); // otherwise focus may be lost when caret is removed
    DomTerm.removeInfoDisplay(miniBuffer.infoDiv, this);
}

// Set up event handlers and more for an actual session.
// Not called in view-saved mode or dummy Terminal created for 'browse'
Terminal.prototype.initializeTerminal = function(topNode) {
    try {
        if (window.localStorage) {
            var v = localStorage[this.historyStorageKey()];
            if (v)
                this.history = JSON.parse(v);
        }
    } catch (e) { }
    if (! this.history)
        this.history = new Array();

    this.parser = new window.DTParser(this);
    this.topNode = topNode;
    topNode.spellcheck = false;
    topNode.terminal = this;

    var preNode = this.initial.firstChild;
    this.outputContainer = preNode;
    this.outputBefore = preNode.firstChild;

    let caretNode = this._createSpanNode();
    this._caretNode = caretNode;
    caretNode.setAttribute("std", "caret");
    caretNode.contentEditable = true; // FIXME also minibuffer
    caretNode.stayOut = true;
    this.insertNode(caretNode);
    this.outputBefore = caretNode;

    var dt = this;
    topNode.addEventListener("keydown",
                             function(e) {
                                 dt.keyDownHandler(e);
                             }, false);
    topNode.addEventListener("keypress",
                             function(e) { dt.keyPressHandler(e) }, false);
    topNode.addEventListener("input",
      function(e) { dt.inputHandler(e); }, true);
    if (! DomTerm.isAtom()) { // kludge for Atom
        topNode.addEventListener("focusin", function(e) {
            dt._focusinLastEvent = true;
            DomTerm.setFocus(dt, "F");
        }, false);
    }
    function compositionStart(ev) {
        if (DomTerm.verbosity >= 1)
            dt.log("compositionStart "+JSON.stringify(ev.data)+" was-c:"+dt._composing);
        dt._composing = 1;
        dt._removeCaret();
    }
    function compositionEnd(ev) {
        if (DomTerm.verbosity >= 1)
            dt.log("compositionEnd "+JSON.stringify(ev.data));
        dt._composing = 0;
        let data = ev.data;
        if (data) {
            const caret = dt._caretNode;
            if (dt.isLineEditing()) {
                dt.editorAddLine();
                dt._moveNodes(caret.firstChild, caret.parentNode, caret);
            } else {
                if (dt.sstate.bracketedPasteMode || dt._lineEditingMode != 0)
                    dt.reportText(data, null);
                else
                    dt.reportKeyEvent("ime", data);
                let pending = dt._createPendingSpan();
                caret.parentNode.insertBefore(pending, caret);
                dt._moveNodes(caret.firstChild, pending, null);
            }
        }
    }
    topNode.addEventListener("compositionstart", compositionStart, true);
    topNode.addEventListener("compositionupdate",
                             (e) => {
                                 if (DomTerm.verbosity >= 2)
                                     dt.log("compositionupdate d:"+e.data);
                             },
                             true);
    topNode.addEventListener("compositionend", compositionEnd, true);
    topNode.addEventListener("paste",
                             function(e) {
                                 dt.pasteText(e.clipboardData.getData("text"));
                                 e.preventDefault(); },
                              false);
    topNode.addEventListener("click",
                             function(e) {
                                 var target = e.target;
                                 for (let n = target; n instanceof Element;
                                      n = n.parentNode) {
                                     let ntag = n.nodeName;
                                     if (ntag == "A") {
                                         if (e.ctrlKey || ! dt._linkNeedsCtrlClick(n)) {
                                             DomTerm.handleLinkRef(n.getAttribute("href"),
                                                                   n.textContent, dt);

                                         }
                                         e.preventDefault();
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

Terminal.prototype._createBuffer = function(idName, bufName) {
    var bufNode = document.createElement("div");
    bufNode.setAttribute("id", idName);
    bufNode.setAttribute("buffer", bufName);
    bufNode.setAttribute("class", "interaction");
    // Needed when composing (IME) on Chromium.
    // Otherwise the composition buffer may be displayed inside the
    // prompt string rather than the input area (specifically in _caretNode).
    this._addBlankLines(1, this.lineEnds.length, bufNode, null);
    bufNode.saveLastLine = 0;
    return bufNode;
};

/* If browsers allows, should re-size actual window instead. FIXME */
Terminal.prototype.forceWidthInColumns =
    function(numCols, numRows = numCols <= 0 ? -1 : this.numRows,
             mode = 0)
{
    if (mode == 8 && ! this.isSecondaryWindow() && ! this._replayMode)
        return;
    this.sstate.forcedSize = numCols <= 0 && numRows <= 0 ? undefined
        : mode == 8 ? true : "secondary";
    if ((numCols === this.numColumss || numCols < 0)
        && (numRows === this.numRows || numRows < 0))
        return;
    this.numColumns = numCols;
    this.numRows = numRows;
    if (numCols > 0 || numRows > 0) {
        this.resizeHandler();
        if (mode != 8) {
            // Don't unforce on resize for seconary windows
            window.addEventListener("resize", this._unforceWidthInColumns, true);
            this.eraseDisplay(2);
            this._setRegionLR(0, -1);
            this.moveToAbs(this.homeLine, 0, false);
        }
    }
};

Terminal.prototype.measureWindow = function()  {
    if (DomTerm.usingXtermJs()) {
        window.fit.fit(this.xterm);
        return;
    }
    let ruler = this._rulerNode;
    if (! ruler)
        return;
    let lcaret = this.viewCaretLineNode;
    lcaret.style.width = "";
    lcaret.style.left = "";
    let topRect = this.topNode.getBoundingClientRect();
    this.actualHeight = topRect.height;
    this._topOffset = topRect.y;
    if (DomTerm.verbosity >= 2)
        this.log("measureWindow "+this.name+" h:"+this.actualHeight);
    var rbox = ruler.getBoundingClientRect();
    this.charWidth = rbox.width/26.0;
    this.charHeight = rbox.height;
    this.rightMarginWidth = this._wrapDummy.getBoundingClientRect().width;
    let numRows, numColumns, availWidth, availHeight, styleWidth;
    if (this.sstate.forcedSize) {
        numRows = this.numRows;
        numColumns = this.numColumns;
        availWidth = (numColumns + 0.5) * this.charWidth;
        styleWidth = (availWidth + this.rightMarginWidth)+"px";
    } else {
       styleWidth = "";
    }
    if (this._styleWidth != styleWidth) {
        let buffers = document.getElementsByClassName("interaction");
        for (let i = buffers.length; --i >= 0; )
            buffers[i].style.width = styleWidth;
        this._vspacer.style.width = styleWidth;
        this._styleWidth = styleWidth;
    }
    if (this.sstate.forcedSize) {
        availHeight = (numRows + 0.5) * this.charHeight
            + (this.topNode.offsetHeight - this.topNode.clientHeight);
    } else {
        // We use initial's width (rather than topNode's), which allows
        // topNode to include padding.  But style.width must have been reset.
        availWidth = this.initial.getBoundingClientRect().width
            - this.rightMarginWidth;
        availHeight = this.actualHeight;
        numRows = Math.floor(availHeight / this.charHeight);
        numColumns = Math.floor(availWidth / this.charWidth);
        // KLUDGE Add some tolerance for rounding errors.
        // This is occasionally needed, at least on Chrome.
        // FIXME - Better would be to use separate line-breaking measurements
        // when in traditional terminal mode (monospace and no html emitted):
        // In that case we should line-break based on character counts rather
        // than measured offsets.
        availWidth = (numColumns + 0.5) * this.charWidth;
    }

    if (DomTerm.verbosity >= 2)
        this.log("wrapDummy:"+this._wrapDummy+" width:"+this.rightMarginWidth+" top:"+this.name+"["+this.topNode.getAttribute("class")+"] clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.topNode.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+this.charWidth+" chH:"+this.charHeight+" ht:"+availHeight+" rbox:"+rbox);
    if ((numRows != this.numRows || numColumns != this.numColumns
         || availHeight != this.availHeight || availWidth != this.availWidth)
        && ! this.isSavedSession()) {
        this.setWindowSize(numRows, numColumns, availHeight, availWidth);
    }
    this.numRows = numRows;
    this.numColumns = numColumns;
    this._setRegionTB(0, -1);
    this.availHeight = availHeight;
    this.availWidth = availWidth;
    if (DomTerm.verbosity >= 2)
        this.log("ruler ow:"+ruler.offsetWidth+" cl-h:"+ruler.clientHeight+" cl-w:"+ruler.clientWidth+" = "+(ruler.offsetWidth/26.0)+"/char h:"+ruler.offsetHeight+" numCols:"+this.numColumns+" numRows:"+this.numRows);

    this.adjustFocusCaretStyle();
    this._updateMiscOptions();
    let computedZoom = window.getComputedStyle(document.body)['zoom'];
    this._computedZoom = Number(computedZoom);
    if (! this._computedZoom)
        this._computedZoom = 1.0;
};

Terminal.prototype._updateMiscOptions = function() {
    const topStyle = this.topNode.style;
    /* FUTURE: handle 'foreground' and 'background' options
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
        topStyle.setProperty("--main-light-color",
                             darkStyle ? foreground : background)
        topStyle.setProperty("--main-dark-color",
                             darkStyle ? background : foreground);
        this.setReverseVideo(darkStyle);
    } else {
        if (foreground)
            topStyle.setProperty("--foreground-color", foreground);
        if (background)
            topStyle.setProperty("--background-color", background);
    }
    */
    topStyle.setProperty("--wchar-width", (this.charWidth * 2)+"px");
    topStyle.setProperty("--char-height", this.charHeight+"px");
};

DomTerm.showContextMenu = null;

// Logically "clear" the selection.
// This could be done using removeAllRanges, but then IME doesn't get activated.
// (IME needs an element that is focused and selected *before* typing starts.)
// Hence we make an empty selection on the caret.
// When composing starts, we have to be careful to not make DOM
// changes that might break the selection.
Terminal.prototype._clearSelection = function(keepViewCaret = false) {
    let sel = document.getSelection();
    let viewCaretNode = this.viewCaretNode;
    if (viewCaretNode && viewCaretNode.parentNode) {
        if (! keepViewCaret) {
            let viewCaretPrevious = viewCaretNode.previousSibling;
            viewCaretNode.parentNode.removeChild(viewCaretNode);
            if (viewCaretPrevious instanceof Text)
                this._normalize1(viewCaretPrevious);
        } else {
            sel.collapse(viewCaretNode, 0);
            return;
        }
    }
    let caretNode = this._caretNode;
    if (caretNode && caretNode.parentNode) {
        sel.collapse(caretNode, 0);
    } else if (sel.anchorNode !== null)
        sel.removeAllRanges();
}

/** Do after selection has changed, but "stabilized".
 * If xxx?
 * If focusNode is in same "outer pre" (_getOuterPre) as the caretNode
 * AND "readline-mode" [FIXME] send array keys to move caret to focus position.
 */
Terminal.prototype._updateSelected = function() {
    let dt = this;

    if (this.mouseReporting()) {
        return;
    }

    let sel = document.getSelection();
    let point =
        ! dt._didExtend
        && (sel.focusNode === sel.anchorNode
            ? sel.focusOffset === sel.anchorOffset
            // toString is probably wasteful - but isCollapsed can be wrong.
            : sel.toString().length == 0);
    if (this._pagingMode > 0) {
        if (sel.focusNode !== this.viewCaretNode
            && sel.focusNode !== null) {
            let r = document.createRange();
            let focusNode = sel.focusNode;
            let focusOffset = sel.focusOffset;
            if (focusNode.parentNode === this._caretNode
               || focusNode === this._caretNode) {
                r.selectNode(this._caretNode);
                if (focusOffset == 0) {
                    focusNode = r.startContainer;
                    focusOffset = r.startOffset;
                } else {
                    focusNode = r.endContainer;
                    focusOffset = r.endOffset;
                }
            }
            if (focusNode instanceof Text && focusOffset == 0)
                r.setStartBefore(focusNode);
            else if (focusNode instanceof Text && focusOffset == focusNode.length)
                r.setStartAfter(focusNode);
            else
                r.setStart(focusNode, focusOffset);
            // FIXME if after LINE node and end of DIV, move to start of next DIV.
            let viewCaretPrevious = this.viewCaretNode.previousSibling;
            if (viewCaretPrevious instanceof Text) {
                viewCaretPrevious.parentNode.removeChild(this.viewCaretNode);
                this._normalize1(viewCaretPrevious);
            }
            if (focusNode !== this.viewCaretNode.firstChild
                && focusNode !== this.viewCaretNode.firstChild.firstChild)
                r.insertNode(this.viewCaretNode);
            if (point) {
                sel.collapse(this.viewCaretNode, 0);
            } else {
                sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset,
                                     this.viewCaretNode, 0);
            }
            this.scrollToCaret(this.viewCaretNode);
        }
    }

    let moveCaret = false;
    let currentPreNode = null;       // current class="domterm-pre" element
    let targetPreNode = null;        // target class="domterm-pre" element
    let readlineForced = dt._altPressed;
    let moveOption = readlineForced ? "w" : null;
    if (dt._caretNode && dt._caretNode.parentNode !== null
        && sel.focusNode !== null
        // only moveCaret if (single non-drag) mouse-click and not in paging-mode
        && this._pagingMode == 0 && point) {
        if (readlineForced) {
            targetPreNode = dt._getOuterBlock(sel.focusNode);
            moveCaret = targetPreNode != null;
        } else if (dt._miniBuffer) {
            moveCaret = dt._isAnAncestor(sel.focusNode, dt._miniBuffer);
        } else {
            targetPreNode = dt._getOuterPre(sel.focusNode);
            currentPreNode = this._getOuterPre(this.outputContainer);
            if (targetPreNode != null && currentPreNode != null) {
                let firstSibling = targetPreNode.parentNode.firstChild;
                moveCaret = targetPreNode.classList.contains("input-line")
                    && targetPreNode == currentPreNode
                    && (moveOption = this.isLineEditing() ? "v"
                        : currentPreNode.getAttribute("click-move"))
                    && (point || dt._getStdMode(sel.focusNode) !== "prompt");
            }
        }
    }
    if (moveCaret && ! readlineForced
        && targetPreNode !== dt._getOuterPre(dt._caretNode))
        moveCaret = false;
    if (moveCaret && ! dt.isLineEditingOrMinibuffer()) {
        let targetNode = sel.focusNode;
        let targetOffset = sel.focusOffset;
        if (! readlineForced) {
            const targetFirst = targetPreNode.firstChild;
            // Alternatively: use input span, which does not include initial prompt
            if (targetFirst instanceof Element
                && targetFirst.getAttribute("std")==="prompt"
                && dt._isAnAncestor(targetNode, targetFirst)) {
                targetNode = targetFirst.parentNode;
                targetOffset = 1;
            }
        }
        let r = document.createRange();
        r.setEnd(targetNode, targetOffset);
        r.collapse();
        let direction = r.comparePoint(dt._caretNode, 0);
        let forwards = direction < 0;
        if (forwards)
            r.setStartBefore(dt._caretNode, 0);
        else
            r.setEndBefore(dt._caretNode, 0);
        let textBetween = Terminal._rangeAsText(r);
        let firstNewline = -1;
        let lastNewline = -1;
        let numNewlines = 0;
        for (let i = textBetween.length; --i >= 0; ) {
            if (textBetween.charCodeAt(i) == 10) {
                firstNewline = i;
                if (lastNewline < 0)
                    lastNewline = i;
                numNewlines++;
            }
        }
        if (direction == 0 || textBetween.length == 0
            || (numNewlines > 0
                && (moveOption == null || moveOption == "line")))
            moveCaret = false;
        else {
            let multiLine = numNewlines > 0;
            let columns = DomTerm._countCodePoints(textBetween);
            let moveLeft = dt.keyNameToChars("Left");
            let moveRight = dt.keyNameToChars("Right");
            let output = "";
            if (multiLine && (moveOption == "v"||moveOption == "w")) {
                let rprefix = new Range();
                let startBlock = this._getOuterBlock(r.startContainer);
                if (startBlock.firstChild instanceof Element
                    && startBlock.firstChild.getAttribute("std")==="prompt")
                    rprefix.setStartAfter(startBlock.firstChild);
                else
                    rprefix.selectNode(startBlock);
                rprefix.setEnd(r.startContainer, r.startOffset);
                let prefixText = Terminal._rangeAsText(rprefix);
                let prefixNl = prefixText.indexOf('\n');
                if (prefixNl >= 0)
                    prefixText = prefixText.substring(prefixNl+1);
                let firstColumn = DomTerm._countCodePoints(prefixText);
                let lastColumn = DomTerm._countCodePoints(textBetween.substring(lastNewline+1));
                let leftCount = forwards ? firstColumn : lastColumn;
                let rightCount = forwards ? lastColumn : firstColumn;
                if (moveOption == "w") {
                    if (leftCount > rightCount) {
                        leftCount -= rightCount;
                        rightCount = 0;
                    } else {
                        rightCount -= leftCount;
                        leftCount = 0;
                    }
                }
                output = moveLeft.repeat(leftCount);
                output += dt.keyNameToChars(forwards ? "Down" : "Up")
                    .repeat(numNewlines);
                output += moveRight.repeat(rightCount);
            }
            else if (forwards) {
                output = moveRight.repeat(columns);
            } else {
                output = moveLeft.repeat(columns);
            }
            dt.processInputCharacters(output);
        }
    }

    if (moveCaret) {
        let focusNode = sel.focusNode;
        let anchorNode = sel.anchorNode;
        let focusOffset = sel.focusOffset;
        let anchorOffset = sel.anchorOffset;
        if (moveCaret
            && (sel.focusNode != dt._caretNode || sel.focusOffset != 0)) {
            dt._removeCaret();
            if (! dt.isLineEditing())
                dt._removeInputLine();
            let r = new Range();
            r.setStart(sel.focusNode, sel.focusOffset);
            r.insertNode(dt._caretNode);
            if (sel.focusNode == this.outputContainer
                && this.outputContainer instanceof Text) {
                let outlen = this.outputContainer.length;
                if (this.outputBefore > outlen) {
                    this.outputBefore -= outlen;
                    this.outputContainer = dt._caretNode.nextSibling;
                }
            }
        }
    }
    if (point
        && this._composing <= 0
        //&& this._pagingMode == 0
        && DomTerm.focusedTerm==this
        && ! this._mouseButtonPresse
        && this.caretStyle() !== Terminal.NATIVE_CARET_STYLE) {
        this._clearSelection(true);
    }
}
Terminal.prototype._mouseHandler = function(ev) {
    if (DomTerm.verbosity >= 2)
        this.log("mouse event "+ev.type+": "+ev+" t:"+this.topNode.id+" pageX:"+ev.pageX+" Y:"+ev.pageY+" mmode:"+this.sstate.mouseMode+" but:"+ev.button+" alt:"+ev.altKey);

    // Avoids clearing selection.  Helps on Chrome, at least.
    if (ev.type == "mousedown" && ev.button == 2)
        ev.preventDefault();
    // Middle-button paste doesn't work on GtkWebKit/Wayland.
    // (It uses clipboard instead of selection.)
    if (ev.type == "mousedown" && ev.button == 1
        && DomTerm.versions.appleWebKit
        && DomTerm.versions.userAgent.match(/X11/)
        && ((","+this.getOption("`server-for-clipboard", "")+",")
            .indexOf(",selection-paste,") >= 0)) {
        ev.preventDefault();
        this.reportEvent("REQUEST-SELECTION-TEXT", "")
        return;
    }
    this._focusinLastEvent = false;
    this._altPressed = ev.altKey;
    let wasPressed = this._mouseButtonPressed;
    this._mouseButtonPressed = ev.type !== "mouseup";

    // Get mouse coordinates relative to buffers.
    let xdelta = ev.pageX / this._computedZoom;
    let ydelta = ev.pageY / this._computedZoom + this.buffers.scrollTop;
    for (var top = this.buffers; top != null; top = top.offsetParent) {
        xdelta -= top.offsetLeft;
        ydelta -= top.offsetTop;
    }

    if (ev.type == "mouseup") {
        if (wasPressed)
            this._updateSelected();
        this._usingScrollBar = false;
        /*
        if (this.sstate.mouseMode == 0 && ev.button == 0) {
            let sel = document.getSelection();
            if (sel.isCollapsed) {
                // we don't want a visible caret FIXME handle caretStyle() >= 5
                //sel.removeAllRanges();
            }
        }
        */
    }
    if (ev.type == "mousedown") {
        if (ev.button == 0 && xdelta >= this.buffers.clientWidth) // in scrollbar
            this._usingScrollBar = true;
        this.setMarkMode(false);
        this._didExtend = ev.shiftKey;
        this.sstate.goalColumn = undefined;
        if (! DomTerm.useIFrame)
            DomTerm.setFocus(this, "S");
        this.maybeFocus();
        this._clearPendingDisplayMiscInfo()
    }
    /*
    if (ev.type == "mouseup" && this.sstate.mouseMode == 0
        && this._currentlyPagingOrPaused()
        && this.buffers.scrollTop+this.availHeight >= this._vspacer.offsetTop)
            this._pauseContinue();
    */

    if (ev.shiftKey || ev.target == this.topNode || ! this.mouseReporting())
         return;

    // Temporarily set position to ev.target.
    // That way we can use updateCursorCache to get
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
    this.resetCursorCache();
    var row = this.getCursorLine();
    var col = this.getCursorColumn();
    this.currentCursorColumn = saveCol;
    this.currentAbsLine = saveLine;
    this.outputBefore = saveBefore;
    this.outputContainer = saveContainer;
    xdelta -= target.offsetLeft;
    ydelta -= target.offsetTop;
    // (xdelta,ydelta) are relative to ev.target
    col += Math.floor(xdelta / this.charWidth);
    row += Math.floor(ydelta / this.charHeight);

    var mod = (ev.shiftKey?4:0) | (ev.metaKey?8:0) | (ev.ctrlKey?16:0);
    var final = "M";
    var button = Math.min(ev.which - 1, 2) | mod;
    switch (ev.type) {
    case 'mousedown':
        if (this.sstate.mouseMode === 1002)
            this.topNode.addEventListener("mousemove",
                                          this._mouseEventHandler);
        break;
    case 'mouseup':
        if (this.sstate.mouseMode === 1002)
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

    if (DomTerm.verbosity >= 2)
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
    this.processResponseCharacters(result);
};

Terminal.prototype.showHideMarkers = [
    // pairs of 'show'/'hide' markers, with 'show' (currently hidden) first
    // "[show]", "[hide]",
    "\u25B6", "\u25BC", // black right-pointing / down-pointing triangle
    "\u25B8", "\u25BE", // black right-pointing / down-pointing small triangle
    "\u25B7", "\u25BD", // white right-pointing / down-pointing triangle
    "\u2295", "\u2296", // circled plus / circled minus
    "\u229E", "\u229F"  // squared plus / squared minus
];

Terminal.prototype._showHideHandler = function(event) {
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
        if (start.tagName == "SPAN" && start.classList.contains("tail-hider"))
            start = start.parentNode;
        if (start.parentNode.getAttribute("std") == "prompt")
            start = start.parentNode;
        var node = start;
        for (;;) {
            var next = node.nextSibling;
            if (next == null) {
                var parent = node.parentNode;
                if (parent == start.parentNode && Terminal.isBlockNode(parent))
                    next = parent.nextSibling;
            }
            node = next;
            if (node == null)
                break;
            if (! (node instanceof Element)) {
                var span = this._createSpanNode("wrap-for-hiding");
                node.parentNode.insertBefore(span, node);
                span.appendChild(node);
                node = span;
            }
            if (node instanceof Element) {
                var hidden = node.getAttribute("domterm-hidden");
                if (hidden=="true") {
                    if (node.getAttribute("class") == "wrap-for-hiding") {
                        this._moveNodes(node.firstChild,
                                        node.parentNode, node);
                        next = node.previousSibling;
                        node.parentNode.removeChild(node);
                        node = next;
                    } else
                        node.setAttribute("domterm-hidden", "false")
                } else
                    node.setAttribute("domterm-hidden", "true")
            }
        }
    }
    this.requestUpdateDisplay();
};

Terminal.prototype.freshLine = function() {
    var lineno = this.getAbsCursorLine();
    var line = this.lineStarts[lineno];
    var end = this.lineEnds[lineno];
    if (this.outputBefore instanceof Node) {
        const prev = this.outputBefore.previousSibling;
        if (prev instanceof Element && prev.getAttribute("line") == "hard")
            return;
    }
    for (let n = line; n != null; n = n.firstChild) {
        if (n == this.outputContainer && n.firstChild == this.outputBefore)
            return;
    }
    this.cursorLineStart(1);
};

Terminal.prototype.reportEvent = function(name, data = "") {
    // Send 0xFD + name + ' ' + data + '\n'
    // where 0xFD is sent as a raw unencoded byte.
    // 0xFD cannot appear in a UTF-8 sequence
    let str = name + ' ' + data;
    let slen = str.length;
    if (DomTerm.verbosity >= 2)
        this.log("reportEvent "+this.name+": "+str);
    // Max 3 bytes per UTF-16 character
    let buffer = new ArrayBuffer(2 + 3 * slen);
    let encoder = this._encoder;
    if (! encoder)
        this._encoder = encoder = new TextEncoder();
    let nbytes;
    let buf1 = new Uint8Array(buffer, 1);
    if (encoder.encodeInto) {
        let res = this._encoder.encodeInto(str, buf1);
        if (res.read < slen) { return; } // shouldn't happen
        nbytes = res.written;
    } else {
        let ebytes = encoder.encode(str);
        nbytes = ebytes.byteLength;
        buf1.set(ebytes);
    }
    let buf0 = new Uint8Array(buffer, 0, nbytes+2);
    buf0.fill(0xFD, 0, 1);
    buf0.fill(10, nbytes+1, nbytes+2); // append '\n'
    this.processInputBytes(buf0);
};

Terminal.prototype.reportKeyEvent = function(keyName, str) {
    let seqno = this._keyEventCounter;
    let data = ""+keyName+"\t"+seqno+"\t"+JSON.stringify(str);
    this._keyEventBuffer[seqno & 31] = data;
    this.reportEvent("KEY", data);
    this._keyEventCounter = (seqno + 1) & 1023;
};

Terminal.prototype._createPendingSpan = function(span = this._createSpanNode()) {
    span.classList.add("pending");
    span.nextDeferred = this._deferredForDeletion;
    this._deferredForDeletion = span;
    this._requestDeletePendingEcho();
    return span;
}

Terminal.prototype._addPendingInput = function(str) {
    if (DomTerm.usingXtermJs())
        return;
    this._restoreCaretNode();
    const caret = this._caretNode;
    let pending = caret.previousSibling;
    if (! DomTerm._isPendingSpan(pending)) {
        pending = this._createPendingSpan();
        caret.parentNode.insertBefore(pending, caret);
    }
    if (pending.firstChild instanceof Text)
        pending.firstChild.appendData(str);
    else
        pending.appendChild(document.createTextNode(str));
    this._pendingEcho += str;
}

Terminal._PENDING_LEFT = 2;
Terminal._PENDING_FORWARDS = 1;
Terminal._PENDING_RIGHT = Terminal._PENDING_LEFT+Terminal._PENDING_FORWARDS;
Terminal._PENDING_DELETE = 4;

DomTerm._isPendingSpan = function(node) {
    return node instanceof Element
        && node.tagName === "SPAN"
        && node.classList.contains("pending");
}

Terminal.prototype._editPendingInput = function(forwards, doDelete,
                                                count = 1, range = null) {
    this._restoreCaretNode();
    this._removeCaret();
    let block = this._getOuterInputArea();
    if (block === null)
        return;
    if (range === null) {
        range = document.createRange();
        range.selectNodeContents(block);
        if (! forwards)
            range.setEndBefore(this._caretNode);
        else
            range.setStartAfter(this._caretNode);
    }
    let dt = this;
    function wrapText(node, start, end) {
        if (start === end)
            return;
        let parent = node.parentNode;
        let dlen = node.data.length;
        if (end != dlen)
            node.splitText(end);
        if (start > 0)
            node = node.splitText(start);
        const pending = dt._createPendingSpan();
        parent.insertBefore(pending, node);
        pending.setAttribute("old-text", node.data);
        if (node == dt.outputBefore)
            dt.outputBefore = pending;
        if (doDelete)
            parent.removeChild(node);
        else
            pending.appendChild(node);
        pending.setAttribute("direction", forwards ? "Right" : "Left");
    }
    let scanState = { linesCount: 0, todo: count, unit: "char", stopAt: "", wrapText: wrapText };
    Terminal.scanInRange(range, ! forwards, scanState);
    if (! doDelete) {
        let caret = this._caretNode;
        if (this.outputBefore == caret)
            this.outputBefore = caret.nextSibling;
        if (caret.parentNode)
            caret.parentNode.removeChild(caret);
        if (forwards)
            range.collapse();
        let start = range.startContainer;
        if (start instanceof Text && range.startOffset == 0)
            start.parentNode.insertBefore(caret, start);
        else if (start instanceof Text && range.startOffset == start.length)
            start.parentNode.insertBefore(caret, start.nextSibling);
        else
            range.insertNode(caret);
        let cparent = caret.parentNode;
        if (DomTerm._isPendingSpan(cparent)) {
            cparent.normalize(); // paranoia
            if (caret.nextSibling == null)
                cparent.parentNode.insertBefore(caret, cparent.nextSibling);
            else if (caret.previousSibling == null)
                cparent.parentNode.insertBefore(caret, cparent);
            else {
                let following = this._createPendingSpan();
                cparent.parentNode.insertBefore(following, cparent.nextSibling);
                following.appendChild(caret.nextSibling);
                cparent.parentNode.insertBefore(caret, cparent.nextSibling);
            }
        }
    }
    let code = (forwards ? Terminal._PENDING_RIGHT : Terminal._PENDING_LEFT)
        + (doDelete ? Terminal._PENDING_DELETE : 0);
    this._pendingEcho = this._pendingEcho
        + String.fromCharCode(code).repeat(count - scanState.todo);
    this._restoreCaret();
}

Terminal.prototype._respondSimpleInput = function(str, keyName) {
    if ((this._lineEditingMode == 0 && this.autoLazyCheckInferior)
        || (this._specialKeys && this._specialKeys.indexOf(str) >= 0))
        this.reportKeyEvent(keyName, str);
    else
        this.processInputCharacters(str);
}

Terminal.prototype.setWindowSize = function(numRows, numColumns,
                                            availHeight, availWidth) {
    this.reportEvent("WS", numRows+" "+numColumns+" "+availHeight+" "+availWidth);
};

Terminal.namedOptionFromArray = function(options, namex, defValue=null) {
    const n = options.length;
    for (let i = 0; i < n; i++) {
        const t = options[i];
        if (t.startsWith(namex))
            return t.substring(namex.length);
    }
    return defValue;
}

/**
* Iterate for sub-node of 'node', starting with 'start'.
* Call 'func' for each node (if allNodes is true) or each Element
* (if allNodes is false).  If the value returned by 'func' is not a boolean,
* stop iterating and return that as the result of forEachElementIn.
* If the value is true, continue with children; if false, skip children.
* The function may safely remove or replace the active node,
* or change its children.
*/
Terminal._forEachElementIn = function(node, func, allNodes=false, backwards=false, start=backwards?node.lastChild:node.firstChild, elementExit=null) {
    let starting = true;
    for (var cur = start; ;) {
        if (cur == null || (cur == node && !starting))
            break;
        starting = false;
        let sibling = backwards?cur.previousSibling:cur.nextSibling;
        let parent = cur.parentNode;
        let doChildren = true;
        if (allNodes || cur instanceof Element) {
            let r = func(cur);
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
                if (elementExit && cur instanceof Element) {
                    let r = elementExit(cur);
                    if (r !== false)
                        return r;
                }
                next = sibling;
                if (next != null) {
                    cur = next;
                    break;
                }
                cur = parent;
                if (cur == node)
                    break;
                sibling = backwards?cur.previousSibling:cur.nextSibling;
                parent = cur.parentNode;
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

Terminal.prototype.resetCursorCache = function() {
    this.currentCursorColumn = -1;
    this.currentAbsLine = -1;
};

Terminal.prototype.updateCursorCache = function() {
    var goal = this.outputBefore;
    var goalParent = this.outputContainer;
    if (goal instanceof Number) { // and goalParent instanceof Text
        goal = goalParent.nextSibling;
        goalParent = goalParent.parentNode;
    }
    var line = this.currentAbsLine;
    if (line < 0) {
        var n = this._getOuterBlock(goal instanceof Element ? goal : goalParent);
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
    let cur = this.lineStarts[line];
    let parent = cur.parentNode;
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
            } else if (tag == "SPAN") {
                var valueAttr = cur.getAttribute("content-value");
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
                var tlen = cur == this.outputContainer ? this.outputBefore : text.length;
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
                            col = Math.trunc(col / tcol) * tcol + tcol;
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
                if (cur == this.outputContainer)
                    break;
            }
            cur = cur.nextSibling;
        }
    }
    this.currentAbsLine = line;
    this.currentCursorColumn = col + (this.outputInWide ? 1 : 0);
    return;
};

/** Get line of current cursor position.
 * This is 0-origin (i.e. 0 is the top line), relative to cursorHome. */
Terminal.prototype.getCursorLine = function() {
    if (this.currentAbsLine < 0)
        this.updateCursorCache();
    return this.currentAbsLine - this.homeLine;
};

Terminal.prototype.getAbsCursorLine = function() {
    if (this.currentAbsLine < 0)
        this.updateCursorCache();
    return this.currentAbsLine;
};

/** Get column of current cursor position.
 * This is 0-origin (i.e. 0 is the left column), relative to cursorHome. */
Terminal.prototype.getCursorColumn = function() {
    if (this.currentCursorColumn < 0)
        this.updateCursorCache();
    return this.currentCursorColumn;
};

Terminal.prototype._fixOutputPosition = function() {
    if (typeof this.outputBefore === "number") {
        let pos = this.outputBefore;
        let value;
        let container = this.outputContainer;
        if (container instanceof Text) {
            this.outputBefore = pos == 0 ? container
                : pos == container.data.length ? container.nextSibling
                : container.splitText(pos);
            this.outputContainer = container.parentNode;
        } else if (container.nodeName == "SPAN"
                   && (value = container.getAttribute("content-value"))
                   != null) {
            let ipos = Number(value);
            if (ipos == 0) {
                this.outputContainer = container.parentNode;
                this.outputBefore = container;
            } else if (ipos == value.length) {
                this.outputContainer = container.parentNode;
                this.outputBefore = container.nextSibling;
            } else {
                let part2 = this._createSpanNode();
                this._copyAttributes(container, part2);
                container.setAttribute("content-value",
                                       value.substring(0, ipos));
                part2.setAttribute("content-value",
                                   value.substring(ipos));
                container.parentNode.insertBefore(part2, container.nextSibling);
                this.outputContainer = container.parentNode;
                this.outputBefore = part2;
            }
        } else {
            this.outputBefore = container.childNodes[pos];
            if (this.outputBefore === undefined)
                this.outputBefore = null;
        }
    }
    return this.outputBefore;
}

Terminal.prototype.grabInput = function(input) {
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

Terminal.prototype.historyAdd = function(str, append) {
    if (this.historyCursor >= 0) // FIX consider append
        this.history[this.history.length-1] = str;
    else if (append && this.history.length >= 0) {
        this.history[this.history.length-1] =
            this.history[this.history.length-1] + '\n' + str;
    } else if (str != "")
        this.history.push(str);
    this.historyCursor = -1;
};

Terminal.prototype.historySearch =
function(str, forwards = this.historySearchForwards) {
    let step = forwards ? 1 : -1;
    for (let i = this.historySearchStart;
         (i += step) >= 0 && i < this.history.length; ) {
        if (this.history[i].indexOf(str) >= 0) {
            i -= this.historyCursor >= 0 ? this.historyCursor
                : this.history.length;
            this.historyMove(i);
            if (this._miniBuffer) {
                let prefix = this._miniBuffer.previousSibling;
                if (prefix instanceof Text
                    && prefix.data.startsWith("failed "))
                    prefix.deleteData(0, 7);
            }
            return;
        }
    }
    if (this._miniBuffer) {
        let prefix = this._miniBuffer.previousSibling;
        if (prefix instanceof Text
            && ! prefix.data.startsWith("failed "))
            prefix.insertData(0, "failed ");
    }
}

Terminal.prototype.historyMove = function(delta) {
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

Terminal.prototype.historyStorageKey = function() {
    return this.getOption("history.storage-key", "DomTerm.history");
}

Terminal.prototype.historySave = function() {
    var h = this.history;
    try {
        if (h && h.length > 0 && window.localStorage) {
            let hmax = this.getOption("history.storage-max", 200);
            if (typeof hmax == "number") {
                let first = h.length = hmax;
                if (first > 0)
                    h = h.slice(first);
            }
            localStorage[this.historyStorageKey()] = JSON.stringify(h);
            h.length = 0;
        }
    } catch (e) { }  
};

Terminal.prototype.appendText = function(parent, data) {
    if (data.length == 0)
        return;
    var last = parent.lastChild;
    if (last instanceof Text)
        last.appendData(data);
    else
        parent.appendChild(document.createTextNode(data));
};

Terminal.prototype._positionToRange = function(range = null) {
    if (! range)
        range = new Range();
    let container = this.outputContainer;
    let before = this.outputBefore;
    if (container instanceof Text) {
        range.setStart(container, before);
    } else {
        if (before)
            range.setStartBefore(before);
        else {
            range.selectNodeContents(container);
            range.collapse(false);
        }
    }
    return range;
}

// set (outputContainer,outputBefore) from start of given range
Terminal.prototype._positionFromRange = function(range) {
    const container = range.startContainer;
    let offset = range.startOffset;
    this.outputContainer = container;
    if (container instanceof Text) {
        this.outputBefore = offset;
    } else {
        let child = container.firstChild;
        while (--offset >= 0)
            child = child.nextSibling;
        this.outputBefore = child;
    }
}

Terminal.prototype._normalize1 = function(tnode) {
    if (tnode.nextSibling instanceof Text) {
        let noPos = this.outputContainer === null;
        const r = noPos || this._positionToRange();
        tnode.parentNode.normalize();
        noPos || this._positionFromRange(r);
    }
};

/** Insert a <br> node. */
Terminal.prototype.insertBreak = function() {
    var breakNode = document.createElement("br");
    this.insertNode(breakNode);
    this.currentCursorColumn = 0;
    if (this.currentAbsLine >= 0)
        this.currentAbsLine++;
};

Terminal.prototype.eraseDisplay = function(param) {
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
        this.homeLine = this.initial.saveLastLine;
        var removed = saveHome - this.homeLine;
        if (removed > 0) {
            this.moveToAbs(this.homeLine, 0, false);
            this.deleteLinesIgnoreScroll(removed);
            this.resetCursorCache();
            saveLine -= removed;
        }
        break;
    case 7:
        let lineBelow = saveLine+1;
        while (lineBelow < this.lineStarts.length
               && this.lineStarts[lineBelow].getAttribute("line") != null)
            lineBelow++;
        if (lineBelow < this.lineStarts.length)
            this.deleteLinesIgnoreScroll(-1, lineBelow);
        let lineFirst = saveLine;
        while (lineFirst > 0
               && this.lineStarts[lineFirst].getAttribute("line") != null)
            lineFirst--;
        let dstart = this.initial.saveLastLine;
        let dcount = lineFirst - dstart;
        this.deleteLinesIgnoreScroll(dcount, dstart);
        this.homeLine = lineFirst >= this.homeLine ? dstart
            : this.homeLine - dcount;
        saveLine -= dcount;
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
            if (--count > 0)
                this.deleteLinesIgnoreScroll(count, startLine+1);
        }
        else if (count > 0) {
            this.moveToAbs(startLine, 0, false);
            this.deleteLinesIgnoreScroll(count);
            this.resetCursorCache();
        }
        break;
    }
    if ((param == 0 || param == 2) && this._vspacer != null) {
        this._setBackgroundColor(this._vspacer, this._currentStyleBackground());
        if (this._vspacer.dtHeight < 0)
            this._vspacer.dtHeight = 0;
    }
    this.moveToAbs(saveLine, saveCol, true);
};

/** set line-wrap indicator from absLine to absLine+1.
 */
Terminal.prototype._forceWrap = function(absLine) {
    var end = this.lineEnds[absLine];
    var nextLine = this.lineStarts[absLine+1];
    if (nextLine != end) {
        // nextLine must be block-content
        this._moveNodes(nextLine.firstChild, end.parentNode, end.nextSibling);
        nextLine.parentNode.removeChild(nextLine);
        this.lineStarts[absLine+1] = end;
        end._widthMode = nextLine._widthMode;
        end._widthColumns = nextLine._widthColumns;
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
Terminal.prototype._clearWrap = function(absLine=this.getAbsCursorLine()) {
    var lineEnd = this.lineEnds[absLine];
    if (lineEnd != null && lineEnd.getAttribute("line")=="soft") {
        // Try to convert soft line break to hard break, using a <div>
        // FIXME: note that readline emits "UVW\e[0KX\rXYZ" for a soft
        // break between "UVW" and "XYZ", so we might want to optimize
        // this case.
        var parent = lineEnd.parentNode;
        var pname = parent.nodeName;
        if (Terminal.isNormalBlock(parent)
            && ! parent.classList.contains("input-line")) {
            var newBlock = this._splitNode(parent, lineEnd.nextSibling);
            // If a wrapped input line is edited to a single (or fewer) lines,
            // remove "input-line" styling for following lines.
            // FIXME This won't handle removing non-wrapped input lines.
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

Terminal.prototype._copyAttributes = function(oldElement, newElement) {
    var attrs = oldElement.attributes;
    for (var i = attrs.length; --i >= 0; ) {
        var attr = attrs[i];
        if (attr.specified && attr.name != "id")
            newElement.setAttribute(attr.name, attr.value);
    }
};

Terminal.prototype._moveNodes = function(firstChild, newParent, newBefore) {
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
Terminal.prototype.eraseCharactersRight = function(count, doDelete=false) {
    if (count > 0 && ! doDelete) {
        // handle BCH FIXME
        var avail = this.numColumns - this.getCursorColumn();
        if (count > avail)
            count = avail;
        this.insertSimpleOutput(DomTerm.makeSpaces(count), 0, count);
        this.cursorLeft(count == avail ? count - 1 : count, false);
        return;
    }
    this.deleteCharactersRight(count);
};
Terminal.prototype.deleteCharactersRight = function(count, removeEmptySpan=true) {
    var todo = count >= 0 ? count : 999999999;
    // Note that the traversal logic is similar to move.
    this._fixOutputPosition();
    var current = this.outputBefore;
    var parent = this.outputContainer;
    var lineNo = this.getAbsCursorLine();
    var lineEnd = this.lineEnds[lineNo];
    var colNo = this.getCursorColumn();
    var previous = current == null ? parent.lastChild
        : current.previousSibling;
    var curColumn = -1;
    let tvalue;
    while (current != lineEnd && todo > 0) {
        if (current == null) {
            if (parent == null)
                break; // Shouldn't happen
            current = parent.nextSibling;
            parent = parent.parentNode;
        } else if (this.isObjectElement(current)) {
            let next = current.nextSibling;
            parent.removeChild(current);
            current = next;
            todo--;
        } else if (current instanceof Text
                   || (current instanceof Element
                       && (tvalue = current.getAttribute("content-value")) != null
                       && current.nodeName == "SPAN")) {
            if (current instanceof Text) {
                tvalue = current.textContent;
            }
            var length = tvalue.length;

            var i = 0;
            if (count < 0) {
                i = length;
            } else {
                i = this.strColumnToIndex(tvalue, todo, current.parentNode);
                todo = i < 0 ? -i : 0;
                i = i < 0 ? length : i;
            }

            var next = current.nextSibling;
            if (i < length) {
                if (current instanceof Text)
                    current.deleteData(0, i);
                else
                    current.setAttribute("content-value", tvalue.substring(i));
            } else  {
                parent.removeChild(current);
                while (parent.firstChild == null && parent != this.initial) {
                    if (parent != this._currentStyleSpan)
                        this._currentStyleSpan = null;
                    current = parent;
                    parent = parent.parentNode;
                    // Alternatively, let the "prompt" span be deleted, but
                    // re-create it in _adjustStyle - as done for inInputMode.
                    if (this.sstate.inPromptMode
                        && current.tagName == "SPAN"
                        && current.getAttribute("std") == "prompt")
                        break;
                    if (current == this._currentStyleSpan)
                        this._currentStyleSpan = null;
                    if (current == this.outputContainer) {
                        this.outputContainer = parent;
                        previous = current.previousSibling;
                    }
                    next = current.nextSibling;
                    parent.removeChild(current);
                }
            }
            current = next;
        } else if (current instanceof Element) {
            parent = current;
            current = current.firstChild;
        } else { // XML comments? Processing instructions?
            current = current.nextSibling;
        }
    }
    this._fixOutputPosition();
    this.outputBefore = previous != null ? previous.nextSibling
        : this.outputContainer.firstChild;
    if (count < 0)
	this.lineStarts[lineNo]._widthColumns = colNo;
    else if (this.lineStarts[lineNo]._widthColumns !== undefined)
	this.lineStarts[lineNo]._widthColumns -= count - todo;
    return todo <= 0;
};


Terminal.prototype.eraseLineRight = function() {
    this.deleteCharactersRight(-1);
    this._clearWrap();
    this._eraseLineEnd();

    /*
    // delete (rather just erase) final empty lines
    let lastLine = this.getAbsCursorLine();
    while (lastLine == this.lineStarts.length-1) {
        const start = this.lineStarts[lastLine];
        const end = this.lineEnds[lastLine];
        if (start.firstChild !== end && start.nextSibling !== end)
            break;
        this.deleteLinesIgnoreScroll(1, lastLine);
        lastLine--;
    }
    */
}

// New "whitespace" at the end of the line need to be set to Background Color.
Terminal.prototype._eraseLineEnd = function() {
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
                oldbg = "var(--background-color)";
            // ... but existing text must keep existing color.
            for (var ch = line.firstChild;
                 ch != null && ch != end; ) {
                var next = ch.nextSibling;
                if (ch instanceof Text) {
                    var span = this._createSpanNode();
                    line.removeChild(ch);
                    span.appendChild(ch);
                    this._fixOutputPosition();
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

Terminal.prototype.eraseLineLeft = function() {
    var column = this.getCursorColumn();
    this.cursorLineStart(0);
    this.eraseCharactersRight(column+1);
    this.cursorRight(column);
};

Terminal.prototype.rgb = function(r,g,b) {
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

Terminal.prototype.color256 = function(u) {
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

Terminal.prototype.handleBell = function() {
    if (Terminal.BELL_TEXT && Terminal.BELL_TIMEOUT)
        this._displayInfoWithTimeout(Terminal.BELL_TEXT, null, Terminal.BELL_TIMEOUT);
};

DomTerm.requestOpenLink = function(obj, dt=DomTerm.focusedTerm) {
    if (dt != null)
        dt.reportEvent("LINK", JSON.stringify(obj));
}

DomTerm.handleLink = function(options=DomTerm._contextOptions) {
    if (DomTerm.dispatchTerminalMessage("open-link", options))
        return;
    let dt = DomTerm.focusedTerm;
    if (dt && options && options.href) {
        let contents = options.contentValue &&  options.contentValue.text;
        DomTerm.handleLinkRef(options.href, contents, dt);
    }
}
DomTerm.handleLinkRef = function(href, textContent, dt) {
    if (href.startsWith('#'))
        window.location.hash = href;
    else {
        var obj = {
            href: href,
            text: textContent
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

// Set the "session name" which is the "session-name" attribute of the toplevel div.
// It can be used in stylesheets as well as the window title.
Terminal.prototype.setSessionName = function(title) {
    this.setWindowTitle(title, 30);
}

Terminal.prototype.setSessionNumber = function(kind, snumber,
                                               windowForSession, windowNumber) {
    let unique = kind != 0;
    if (kind == 2) {
        this.windowNumber = windowNumber;
    } else {
        this.sstate.sessionNumber = snumber;
        this.topNode.setAttribute("session-number", snumber);
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("set-session-number", snumber);
        }
        this.reportEvent("SESSION-NUMBER-ECHO", snumber);
        this.sstate.sessionNameUnique = unique;
        if (this.windowNumber < 0)
            this.windowNumber = windowNumber;
        this.connectionNumber = windowNumber;
        if (DomTermLayout._mainWindowNumber < 0)
            DomTermLayout._mainWindowNumber = windowNumber;
        this.windowForSessionNumber = windowForSession;
        if (this.sstate.forcedSize == "secondary"
            && !this.isSecondaryWindow())
            this.forceWidthInColumns(-1);
    }
    this.updateWindowTitle();
}

// FIXME misleading function name - this is not just the session name
Terminal.prototype.sessionName = function() {
    var sname = this.topNode.getAttribute("session-name");
    let snumber = this.sstate.sessionNumber;
    if (! sname) {
        let rhost = this.getRemoteHostUser();
        sname  = "DomTerm";
        let wnumber = this.windowNumber;
        if (wnumber)
            sname += ":"+wnumber;
        if (rhost) {
            let at = rhost.indexOf('@');
            if (at >= 0)
                rhost = rhost.substring(at+1);
            if (! rhost)
                host = "";
            sname += "=" + rhost + "#" + snumber;
        } else {
            if (snumber && snumber != wnumber)
                sname += "#"+snumber;
        }
    }
    else if (! this.sstate.sessionNameUnique)
        sname = sname + "#" + snumber;
    return sname;
};

Terminal.prototype.setWindowTitle = function(title, option) {
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
        this.topNode.setAttribute("session-name", title);
        this.sstate.sessionNameUnique = true;
        this.reportEvent("SESSION-NAME", JSON.stringify(title));
        break;
    }
    this.updateWindowTitle();
};

Terminal.prototype.formatWindowTitle = function() {
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

Terminal.prototype.updateWindowTitle = function() {
    let sname = this.sessionName();
    let wname = this.sstate.windowName;
    if (DomTerm.setLayoutTitle)
        DomTerm.setLayoutTitle(this.topNode, sname, wname);
    var str = this.formatWindowTitle()
    this.sstate.windowTitle = str;
    if (this.hasFocus())
        DomTerm.setTitle(str);
}

Terminal.prototype.resetCharsets = function() {
    this._GlevelL = 0;
    this._GlevelR = 0;
    this._Gshift = 0;
    this.charMapper = null;
    this._Gcharsets[0] = null;
    this._Gcharsets[1] = null;
    this._Gcharsets[2] = null;
    this._Gcharsets[3] = null;
};

// full==-1: reset stuff restored by restoreCursor(true)
// full==0: normal reset
// full==1: full reset
Terminal.prototype.resetTerminal = function(full, saved) {
    // Corresponds to xterm's ReallyReset function

    if (saved)
        this.eraseDisplay(saved);

    this.sstate.originMode = false;
    this.sstate.bracketedPasteMode = false;
    this.sstate.wraparoundMode = 2;
    this._currentStyleMap = new Map();
    this.resetCharsets();
    this.setMouseMode(0);
    this.sstate.mouseCoordEncoding = 0;
    this.resetTabs();
    this._setRegionTB(0, -1);
    this._setRegionLR(0, -1);
    this._currentPprintGroup = null;

    if (full >= 0) {
        this.forceWidthInColumns(-1);
    }
    // FIXME a bunch more
};

Terminal.prototype.setReverseVideo = function(value) {
    if (value)
        this.topNode.setAttribute("reverse-video", "yes");
    else
        this.topNode.removeAttribute("reverse-video");
}

Terminal.prototype._asBoolean = function(value) {
    return value == "true" || value == "yes" || value == "on";
}

DomTerm._settingsCounter = -1;
DomTerm.settingsHook = null;
DomTerm.defaultWidth = -1;
DomTerm.defaultHeight = -1;

Terminal.prototype.setSettings = function(obj) {
    var settingsCounter = obj["##"];
    if (this._settingsCounterInstance == settingsCounter)
        return;
    this._globalOptions = obj;
    this._settingsCounterInstance = settingsCounter;
    this.updateSettings();
}

Terminal.prototype.updateSettings = function() {
    let getOption = (name, dflt = undefined) => this.getOption(name, dflt);
    let val;

    val = getOption("log.js-verbosity", -1);
    if (val) {
        let v = Number(val);
        if (v >= 0)
            DomTerm.verbosity = v;
    }
    val = getOption("log.js-to-server", false);
    if (val)
        DomTerm.logToServer = val;
    val = getOption("log.js-string-max", null);
    DomTerm.logStringMax = val !== null ? val : 200;

    this.linkAllowedUrlSchemes = Terminal.prototype.linkAllowedUrlSchemes;
    var link_conditions = "";
    val = getOption("open.file.application");
    var a = val ? val : "";
    val = getOption("open.link.application");
    if (val)
        a += val;
    for (;;) {
        var m = a.match(/^[^{]*{([^:}]*)\b([a-zA-Z][-a-zA-Z0-9+.]*:)([^]*)$/);
        if (! m)
            break;
        this.linkAllowedUrlSchemes += m[2];
        a = m[1]+m[3];
    }
    if (this.isRemoteSession()) {
        this._remote_input_interval =
            1000 * getOption("remote-input-interval", 10);
        let timeout = getOption("remote-output-timeout", -1);
        if (timeout < 0)
            timeout = 2 * getOption("remote-output-interval", 10);
        this._remote_output_timeout = 1000 * timeout;
    } else {
        this._remote_input_interval = 0;
        this._remote_output_timeout = 0;
    }

    var style_dark = getOption("style.dark", "auto");
    if (style_dark !== this._style_dark_old) {
        this._style_dark_old = style_dark;
        let dark_query = this._style_dark_query;
        if (style_dark === "auto" && ! dark_query && window.matchMedia) {
            dark_query = window.matchMedia('(prefers-color-scheme: dark)');
            this._style_dark_query = dark_query;
        }
        if (this._style_dark_listener) {
            dark_query.removeEventListener('change', this._style_dark_listener);
            this._style_dark_listener = undefined;
        }
        if (style_dark === "auto") {
            if (dark_query) {
                this._style_dark_listener = (e) => {
                    this.setReverseVideo(e.matches);
                };
                dark_query.addEventListener('change', this._style_dark_listener);
                style_dark = dark_query.matches ? "true" : "false";
            } else
                style_dark = "false";
        }
        this.setReverseVideo(this._asBoolean(style_dark));
    }

    for (let c = 0; c <= 1; c++) {
        let cstyle = getOption(c ? "style.edit-caret" : "style.caret");
        let nstyle = -1;
        if (cstyle) {
            cstyle = String(cstyle).trim();
            nstyle = Terminal.caretStyles.indexOf(cstyle);
            if (nstyle < 0) {
                nstyle = Number(cstyle);
                if (! nstyle)
                    nstyle = -1;
            }
        }
        if (nstyle < 0 || nstyle >= Terminal.caretStyles.length) {
            nstyle = c ? Terminal.DEFAULT_EDIT_CARET_STYLE
                : Terminal.DEFAULT_CARET_STYLE;
        }
        if (c)
            this.caretEditStyle = nstyle;
        else {
            this.caretStyleFromSettings = nstyle;
            if (this.sstate.caretStyleFromCharSeq < 0)
                this.caretCharStyle = nstyle;
        }
    }

   // if (DomTerm._settingsCounter != settingsCounter) {
   //     DomTerm._settingsCounter = settingsCounter;
        var style_user = getOption("style.user");
        if (style_user) {
            this.loadStyleSheet("user", style_user);
            DomTerm._userStyleSet = true;
        } else if (DomTerm._userStyleSet) {
            this.loadStyleSheet("user", "");
            DomTerm._userStyleSet = false;
        }
        var geom = getOption("window.geometry");
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

        function updateKeyMap(mapName, defaultMap) {
            var mapValue = getOption(mapName);
            if (mapValue != null) {
                let map = mapValue.trim().replace(/\n/g, ",");
                // FIXME this is not as robust/general as it should be
                map = map.replace(/("[^"]+")\s*:\s*([^"',\s]+)/g, '$1: "$2"')
                    .replace(/'([^']+)'\s*:\s*([^"',\s]+)/g, '"$1": "$2"');
                try {
                    return defaultMap.update(JSON.parse("{" + map + "}"));
                } catch (e) {
                    console.log("syntax error in "+mapName+" in settings file ("+e+")");
                }
            }
            return defaultMap;
        }
        DomTerm.lineEditKeymap = updateKeyMap("keymap.line-edit", DomTerm.lineEditKeymapDefault);
        DomTerm.masterKeymap = updateKeyMap("keymap.master", DomTerm.masterKeymapDefault);
    //}

    if (DomTerm.settingsHook) {
        var style_qt = getOption("style.qt");
        DomTerm.settingsHook("style.qt", style_qt ? style_qt : "");
    }
    DomTerm._checkStyleResize(this);
};

Terminal.prototype._selectGcharset = function(g, whenShifted/*ignored*/) {
    if (whenShifted)
        this._GlevelR = g;
    else
        this._GlevelL = g;
    if (this._Gcharsets[this._GlevelL] == null
        && this._Gcharsets[this._GlevelR] == null) {
        this.charMapper = null;
        return;
    }
    /*
    this.charMapper = (ch, bytes, nextIndex, endIndex) => {
        let shifted;
        if (ch >= 128 && ch <= 255) {
            ch -= 128;
            shifted = true;
        }
        this.charMapper = this._Gcharsets[g];
        let set = this._Gcharsets[shifted ? this._GlevelR : this._GlevelL];
        if (set == null)
            return ch < 32 || ch >= 127 ? 0 : (ch | (1 << 21));
        return set(ch, bytes, nextIndex, endIndex);
    };
    */
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
DomTerm.charsetSCLD = function(ch, bytes, nextIndex, endIndex) {
    if (ch < 32 || ch >= 127)
        return 0;
    if (ch >= 96 && ch <= 126)
        ch = "\u25c6\u2592\u2409\u240c\u240d\u240a\u00b0\u00b1\u2424\u240b\u2518\u2510\u250c\u2514\u253c\u23ba\u23bb\u2500\u23bc\u23bd\u251c\u2524\u2534\u252c\u2502\u2264\u2265\u03c0\u2260\u00a3\u00b7".charCodeAt(ch-96);
    return ch | (1 << 21);
};
DomTerm.charsetUK = function(ch, bytes, nextIndex, endIndex) {
    if (ch < 32 || ch >= 127)
        return 0;
    // Convert '#' to pound (sterling) sign
    if (ch==35)
        ch = 0xa3;
    return ch | (1 << 21);
};
DomTerm.charset_8859_1 = function(ch, bytes, nextIndex, endIndex) {
    if (ch < 32 || ch == 127)
        return 0;
    return ch | (1 << 21);
}

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

Terminal.prototype._unsafeInsertHTML = function(text) {
    if (DomTerm.verbosity >= 1)
        this.log("_unsafeInsertHTML "+JSON.stringify(text));
    if (text.length > 0) {
        if (this.outputBefore == null)
            this.outputContainer.insertAdjacentHTML("beforeend", text);
        else if (this.outputBefore instanceof Element)
            this.outputBefore.insertAdjacentHTML("beforebegin", text);
        else {
            this._fixOutputPosition();
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
DomTerm._ELEMENT_KIND_MATH = 512; // Allow in MathML
DomTerm._ELEMENT_KIND_EMPTY = 16; // Void (empty) HTML element, like <hr>
DomTerm._ELEMENT_KIND_TABLE = 32; // allowed in table
DomTerm._ELEMENT_KIND_SKIP_TAG = 64; // ignore (skip) element (tag)
DomTerm._ELEMENT_KIND_CONVERT_TO_DIV = 128; // used for <body> and <html>
DomTerm._ELEMENT_KIND_SKIP_FULLY = 256; // skip element (tag and contents)
DomTerm._ELEMENT_KIND_SKIP_TAG_OR_FULLY = DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_SKIP_FULLY;

DomTerm._elementInfo = function(tag, parents=null) {
    var v = DomTerm.HTMLinfo.hasOwnProperty(tag)
        ||  DomTerm.HTMLinfo.hasOwnProperty(tag = tag.toLowerCase())
        ? DomTerm.HTMLinfo[tag]
        : 0;

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

Terminal.prototype.allowAttribute = function(name, value, einfo, parents) {
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
    "acronym": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "address": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
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
    "canvas": DomTerm._ELEMENT_KIND_INLINE,
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
    "html": DomTerm._ELEMENT_KIND_CONVERT_TO_DIV+DomTerm._ELEMENT_KIND_ALLOW,
    "i": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "iframe": DomTerm._ELEMENT_KIND_ALLOW,
    "image": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE, // FIXME
    "img": DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_CHECK_JS_TAG+DomTerm._ELEMENT_KIND_ALLOW,
    "input": 0x15,
    //"isindex": 0x10, //metadata
    "kbd": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "keygen": 0x15,
    "li": DomTerm._ELEMENT_KIND_ALLOW,
    "line": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "linearGradient": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "link": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_ALLOW,
    "maction": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "maligngroup": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "malignmark": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mark": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "marker": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mask": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "math": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "menclose": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "merror": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mfrac": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "meta": DomTerm._ELEMENT_KIND_SKIP_TAG+DomTerm._ELEMENT_KIND_EMPTY+DomTerm._ELEMENT_KIND_ALLOW,
    "metadata": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mi": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "missing-glyph": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mlongdiv": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mmultiscripts": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mn": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mo": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mover": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mpadded": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mpath": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "mphantom": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mroot": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mrow": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "ms": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mscarries": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mscarry": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msgroup": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msline": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mspace": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msqrt": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msrow": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mstack": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mstyle": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msub": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msubsup": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "msup": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mtable": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mtd": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mtext": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "mtr": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "munder": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "munderover": DomTerm._ELEMENT_KIND_MATH+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
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
    "svg": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_ALLOW,
    "switch": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "symbol": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "table": DomTerm._ELEMENT_KIND_ALLOW,
    "tbody": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "thead": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "tfoot": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "tr": DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "td": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
    "text": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "textPath": DomTerm._ELEMENT_KIND_SVG+DomTerm._ELEMENT_KIND_INLINE,
    "th": DomTerm._ELEMENT_KIND_INLINE+DomTerm._ELEMENT_KIND_TABLE+DomTerm._ELEMENT_KIND_ALLOW,
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

Terminal.prototype._scrubAndInsertHTML = function(str) {
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
    this.lineStarts[startLine]._widthMode = Terminal._WIDTH_MODE_VARIABLE_SEEN;
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
                    Terminal._WIDTH_MODE_VARIABLE_SEEN;
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
                    let valstart, valend;
                    if (ch == 61) { // '='
                        if (i == len)
                            break loop; // invalid
                        for (ch = 32; ch <= 32 && i < len; )
                            ch = str.charCodeAt(i++);
                        var quote = i == len ? -1 : ch;
                        if (quote == 34 || quote == 39) { // '"' or '\''
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
                            // Unquoted attribute value
                            valstart = i-1;
                            while (ch > 32 && ch != 34 && ch != 39
                                   && (ch < 60 || ch > 62) && ch != 96)
                                ch = str.charCodeAt(i++);
                            valend = --i;
                        }
                    } else {
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
                            len = str.length;
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
    } else if (activeTags.length > 0) {
        str = "";
        while (activeTags.length)
            str += '&lt;/' + activeTags.pop() + '&gt;'
        str = '<div style="color: red"><b>Inserted invalid HTML - missing close tags:</b>'
            + ' <code style="background-color: #fee">'
            + str + '</code></div>';
        this._scrubAndInsertHTML(str);
    } else if (ok > start) {
        this._unsafeInsertHTML(str.substring(start, ok));
        this.resetCursorCache();
        this._updateLinebreaksStart(startLine);
    }
    //this.cursorColumn = -1;
};


Terminal.prototype._pushPprintGroup = function(ppgroup) {
    ppgroup.outerPprintGroup = this._currentPprintGroup;
    this._currentPprintGroup = ppgroup;
};

Terminal.prototype._popPprintGroup = function() {
    var ppgroup = this._currentPprintGroup;
    if (ppgroup) {
        this._currentPprintGroup = ppgroup.outerPprintGroup;
    }
}

// Difference between homeLine and and containing block element
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

Terminal._nodeToHtml = function(node, dt, saveMode) {
    if (! node)
        return '<!--'+node+'-->';
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

    function formatList(list, isBreakingLine) {
        for (let i = 0; i < list.length; i++) {
            let el = list[i];
            if (isBreakingLine) {
                let cl = el.classList;
                if (! (cl.contains("pre-break")
                       || cl.contains("post-break")
                       || cl.contains("non-break")))
                    continute;
            }
            formatDOM(el); // , namespaces
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
                if (cls == "domterm-buffers") {
                    formatList(node.childNodes, false);
                    break;
                }
            } else if (tagName == "span") {
                if (cls == "focus-area" || cls == "focus-caret")
                    break;
                if (cls == "wc-node") {
                    string += node.textContent;
                    break;
                }
                if (cls == 'non-pre-newline') {
                    string += '\n';
                    break;
                }
            }

            var s = '<' + tagName;
            var skip = false;

            if (node == home_node)
                s += ' ' + 'home-line="'+home_offset+ '"';

            let isBreakingLine = false;
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
                             && node.getAttribute("line")) {
                        isBreakingLine = true;
                        continue;
                    }
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
                formatList(node.childNodes, isBreakingLine);
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
                string += Terminal._nodeToHtml(ch);
            break;
        };
    };
    formatDOM(node);
    return string;
}

Terminal.prototype.getAsHTML = function(saveMode=false) {
    if (saveMode)
        return Terminal._nodeToHtml(this.topNode, this, saveMode);
    else {
        var string = "";
        var list = this.topNode.childNodes;
        for (let i = 0; i < list.length; i++) {
            string += Terminal._nodeToHtml(list[i], this, saveMode);
        }
        return string;
    }
};

Terminal.prototype._doDeferredDeletion = function() {
    var deferred = this._deferredForDeletion;
    if (deferred) {
        this._removeCaret();
        let parent;

        while (deferred && (parent = deferred.parentNode) != null) {
            let oldText = deferred.getAttribute("old-text");
            /*
            if (deferred.continueEditing) {
                FIXME
            }
            */
            if (this._caretNode.parentNode == deferred)
                parent.insertBefore(this._caretNode, deferred);
            if (oldText) {
                let tnode = document.createTextNode(oldText);
                let next = deferred.nextSibling;
                if (next === this._caretNode
                    && deferred.getAttribute("direction") === "Right") {
                    next = next.nextSibling;
                }
                parent.insertBefore(tnode, next);
            }
            if (this.outputBefore == deferred
                || this.outputContainer == deferred
                || this.outputContainer.parentNode == deferred) {
                this.outputBefore = deferred.nextSibling;
                this.outputContainer = deferred.parentNode;
            }
            let tprev = deferred.previousSibling;
            let tnext = deferred.nextSibling;
            parent.removeChild(deferred);
            if (tprev instanceof Text)
                this._normalize1(tprev);
            else if (tnext instanceof Text)
                this._normalize1(tnext);
            deferred = deferred.nextDeferred;
        }
        this._deferredForDeletion = null;
        this._restoreCaret();
    }
    this._pendingEcho = "";
}

Terminal.prototype._downContinue = function(height, paging) {
    let end = this._dataHeight();
    let limit = end + height;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
    this._clearSelection();
    this._pauseContinue(paging);
    DomTerm.setAutoPaging("true", this);
}

Terminal.prototype._downLinesOrContinue = function(count, paging) {
    let todo = this.editorMoveLines(false, count, false);
    if (todo > 0) {
        this._pauseLimit =  this._dataHeight();
        this._downContinue(todo * this.charHeight, paging);
    }
}

Terminal.prototype._pauseContinue = function(paging = false, skip = false) {
    if (this.sstate.disconnected) {
        this._reconnect();
    }
    if (! paging)
        this._clearSelection();
    var wasMode = this._pagingMode;
    this._pagingMode = paging ? 1 : 0;
    if (wasMode != 0)
        this._displayInputModeWithTimeout(this._modeInfo("C"));
    if (DomTerm.verbosity >= 2)
        this.log("pauseContinue was mode="+wasMode);
    if (wasMode == 2) {
        var text = this.parser._deferredBytes;
        if (text) {
            this.parser._deferredBytes = undefined;
            if (skip) {
                this._receivedCount
                    = (this._receivedCount + text.length) & Terminal._mask28;
            } else
                this.parseBytes(text);
        }
        this._maybeConfirmReceived();
    }
}

Terminal.prototype.cancelUpdateDisplay = function() {
    if (this._updateTimer) {
        if (window.requestAnimationFrame)
            cancelAnimationFrame(this._updateTimer);
        else
            clearTimeout(this._updateTimer);
        this._updateTimer = null;
    }
}
Terminal.prototype.requestUpdateDisplay = function() {
    this.cancelUpdateDisplay();
    if (window.requestAnimationFrame)
        this._updateTimer = requestAnimationFrame(this._updateDisplay);
    else
        this._updateTimer = setTimeout(this._updateDisplay, 100);
}

Terminal.prototype._requestDeletePendingEcho = function() {
    if (this._deferredForDeletion == null)
        return;
    if (this._deletePendingEchoTimer != null)
        clearTimeout(this._deletePendingEchoTimer);
    var dt = this;
    function clear() {
        dt._deletePendingEchoTimer = null;
                       dt._doDeferredDeletion();
                       if (! dt.isLineEditing()) {
                           dt._removeInputLine();
                           dt._restoreInputLine();
                       }
                     };
    let timeout = dt.getOption("predicted-input-timeout", 0.4);
    if (timeout)
        this._deletePendingEchoTimer = setTimeout(clear, timeout*1000);
    else
        clear();
}

Terminal.prototype._confirmReceived = function() {
    this._confirmedCount = this._receivedCount;
    this.reportEvent("RECEIVED", this._confirmedCount);
}
Terminal.prototype._maybeConfirmReceived = function() {
    if (this._pagingMode != 2 && ! this._replayMode
        && (! this._savedControlState || this._savedControlState.counted)
        && ((this._receivedCount - this._confirmedCount) & Terminal._mask28) > this.unconfirmedMax()) {
        this._confirmReceived();
    }
}

/* 'bytes' should be an ArrayBufferView, typically a Uint8Array */
Terminal.prototype.insertBytes = function(bytes) {
    var len = bytes.length;
    let startIndex = 0;
    let endIndex = bytes.length;
    if (DomTerm.verbosity >= 2)
        this.log("insertBytes "+this.name+" "+typeof bytes+" count:"+len+" received:"+this._receivedCount);
    while (startIndex < endIndex) {
        let urgent_begin = -1;
        let urgent_end = -1;
        for (let  i = startIndex; i < endIndex; i++) {
            var ch = bytes[i];
            if (ch == Terminal.URGENT_BEGIN1) {
                urgent_begin = i;
                break;
            } else if (ch == Terminal.URGENT_END) {
                urgent_end = i;
                break;
            }
        }
        if (urgent_begin >= 0 && (urgent_end < 0 || urgent_end > urgent_begin)) {
            if (urgent_begin > startIndex) {
                this.parser._deferredBytes = this.parser.withDeferredBytes(bytes, startIndex, urgent_begin);
            }
            this.pushControlState();
            startIndex = urgent_begin + 1;

        } else {
            let cstate = this._savedControlState;
            if (cstate && cstate.urgent === undefined) {
                startIndex += cstate.setFromFollowingByte(bytes[startIndex]);
                if (! cstate.urgent && cstate.deferredBytes) {
                    this._savedControlState = cstate._savedControlState;
                    let defb = cstate.deferredBytes;
                    cstate.deferredBytes = undefined;
                    this._savedControlState = cstate._savedControlState;
                    this.parseBytes(defb);
                    this._savedControlState = cstate;
                }
            }
            if (urgent_end >= 0) {
                this.parseBytes(bytes, startIndex, urgent_end);
                this.popControlState();
                startIndex = urgent_end + 1;
                let defb = this.parser._deferredBytes;
                if (startIndex == endIndex && defb) {
                    this.parser._deferredBytes = undefined;
                    this.parseBytes(defb);
                }
            } else {
                this.parseBytes(bytes, startIndex, endIndex);
                startIndex = endIndex;
            }
        }
        this._maybeConfirmReceived();
    }
}

Terminal.prototype.pushControlState = function() {
    const dt = this;
    var saved = {
        receivedCount: this._receivedCount,
        setFromFollowingByte(ch) {
            let start;
            if (ch == window.DTerminal.URGENT_STATELESS_COUNTED
                || ch == window.DTerminal.URGENT_FIRST_COUNTED) {
                start = 1;
                this.counted = true;
                this.urgent = ch == window.DTerminal.URGENT_FIRST_COUNTED;
            }
            else {
                this.counted = false;
                let urgent = ch == window.DTerminal.URGENT_FIRST_NONCOUNTED;
                this.urgent = urgent;
                start = urgent ? 1 : 0;
            }
            const preBytes = this._deferredBytes;
            if (! this.urgent && preBytes) {
                dt.savedControlState = this._savedControlState;
                this._deferredBytes = undefined;
                dt.parser.parseBytes(preBytes);
                dt.savedControlState = this;
            }
            return start;
        },
        _savedControlState: this._savedControlState
    }
    this._savedControlState = saved;
    if (! DomTerm.usingXtermJs())
        this.parser.pushControlState(saved);
}
Terminal.prototype.popControlState = function() {
    var saved = this._savedControlState;
    if (saved) {
        this._savedControlState = saved._savedControlState;
        if (! DomTerm.usingXtermJs()) {
            this.parser.popControlState(saved);
        }
        // Control sequences in "urgent messages" don't count to
        // receivedCount. (They are typically window-specific and
        // should not be replayed when another window is attached.)
        if (saved.counted)
            this._receivedCount = (this._receivedCount + 2) & Terminal._mask28;
        else
            this._receivedCount = saved.receivedCount;
    }
}

// overridden if usingXtermJs()
Terminal.prototype.insertString = function(str) {
    this.parser.insertString(str);
}
// overridden if usingXtermJs()
Terminal.prototype.parseBytes = function(bytes, beginIndex = 0, endIndex = bytes.length) {
    let rlen = endIndex - beginIndex;
    if (this.parser._deferredBytes)
        rlen += this.parser._deferredBytes.length;

    if (false) { // DEBUGGING of partial sequences
        // number of trailing bytes to do one-by-one; -1 is all of them.
        let do_one_by_one = -1;
        if (do_one_by_one >= 0 && endIndex > beginIndex + do_one_by_one) {
            let next = endIndex - do_one_by_one;
            this.parser.parseBytes(bytes, beginIndex, next);
            beginIndex = next;
        }
        for (let i = beginIndex; i < endIndex; i++)
            this.parser.parseBytes(bytes, i, i+1);
    } else
        this.parser.parseBytes(bytes, beginIndex, endIndex);
    if (this.parser._deferredBytes)
        rlen -= this.parser._deferredBytes.length;
    this._receivedCount = (this._receivedCount + rlen) & Terminal._mask28;

}

Terminal.prototype._scrollNeeded = function() {
    var last = this._vspacer;
    if (! last)
        return 0;
    let lastBottom = last.getBoundingClientRect().bottom+this.buffers.scrollTop
    return lastBottom - this.actualHeight;
};

// Optimization of term._scrollNeeded() == term.buffers.scrollTop (approx)
Terminal.prototype._scrolledAtBottom = function() {
    var last = this._vspacer;
    return last == null
        || Math.abs(last.getBoundingClientRect().bottom - this.actualHeight) < 0.2;
}

Terminal.prototype._scrollIfNeeded = function() {
    let needed = this._scrollNeeded();
    if (needed > this.buffers.scrollTop) {
        if (DomTerm.verbosity >= 3)
            this.log("scroll-needed was:"+this.buffers.scrollTop+" to "
                     +needed);
        if (this._usingScrollBar || this._disableScrollOnOutput)
            this._disableScrollOnOutput = true;
        else
            this.buffers.scrollTop = needed;
    }
}

Terminal.prototype.adjustFocusCaretStyle = function() {
    let caret = this.viewCaretNode;
    if (caret && caret.parentNode) {
        let lcaret = this.viewCaretLineNode;
        let rect = caret.getBoundingClientRect();
        lcaret.style.width = this.initial.clientWidth + "px";
        lcaret.style.left = (-rect.x) + "px";
    }
};

Terminal.prototype.scrollToCaret = function(caret = null, force = null) {
    if (caret == null) {
        caret = this.viewCaretNode;
        if (caret == null || caret.parentNode == null)
            caret = this._caretNode;
    }
    if (caret.parentNode == null)
        return;
    let rect = caret.getBoundingClientRect();
    let top = rect.y + this.buffers.scrollTop - this._topOffset;
    let bottom = top + rect.height;
    if (force === "bottom" || bottom > this.buffers.scrollTop + this.availHeight) {
        this.buffers.scrollTop = Math.max(0, bottom - this.availHeight + 1);
    } else if (force == "top" || top < this.buffers.scrollTop) {
        this.buffers.scrollTop = top;
    }
    this.adjustFocusCaretStyle();
}

Terminal.prototype._enableScroll = function() {
    this._disableScrollOnOutput = false;
    this._scrollIfNeeded();
}

Terminal.prototype._breakDeferredLines = function() {
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

Terminal._forceMeasureBreaks = false;

Terminal.prototype._adjustLines = function(startLine, action, single=false, stopLine=null) {
    var delta = 0;
    var prevLine = this.lineStarts[startLine];
    var skipRest = false;
    for (var line = startLine+1;  line < this.lineStarts.length;  line++) {
        var lineStart = this.lineStarts[line];
        if (lineStart === stopLine)
            skipRest = true;
        if (delta > 0) {
            this.lineStarts[line-delta] = lineStart;
            this.lineEnds[line-delta-1] = this.lineEnds[line-1];
        }
        let lineAttr = lineStart.getAttribute("line");
        if (skipRest || ! this.isSpanNode(lineStart) || ! lineAttr) {
            if (single && line > startLine+1) {
                if (delta == 0)
                    break;
                skipRest = true;
            }
            prevLine = lineStart;
            continue;
        }
        if (action(prevLine, lineStart, lineAttr, line-delta)) {
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
Terminal.prototype._unbreakLines = function(startLine, single=false, stopLine) {
    let action = (prevLine, lineStart, lineAttr, lineno) => {
        if (lineStart.getAttribute("breaking")=="yes") {
            lineStart.removeAttribute("breaking");
            for (let child = lineStart.firstChild; child != null; ) {
                var next = child.nextSibling;
                if (child instanceof Text /* added '\n' */
                    || child.classList.contains("pprint-indent"))
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
                    if (prevLine._widthColumns !== undefined) {
                        let curWidth = lineStart._widthColumns;
                        prevLine._widthColumns = curWidth !== undefined
                            ? prevLine._widthColumns + curWidth
                            : undefined;
                    }
                    if (lineStart._widthMode > prevLine._widthMode)
                        prevLine._widthMode = lineStart._widthMode;
                }
            }
            // Remove "soft" "fill" "miser" "space" breaks from the line-table
            return true;
        } else
            return false;
    };
    return this._adjustLines(startLine, action, single, stopLine);
}

Terminal.prototype._insertIntoLines = function(el, line) {
    var lineCount = this.lineStarts.length;
    var lineEnd = this.lineEnds[line];

    for (var i = lineCount; --i > line; ) {
        this.lineStarts[i+1] = this.lineStarts[i];
        this.lineEnds[i+1] = this.lineEnds[i];
    }
    this.lineEnds[line+1] = lineEnd;
    this.lineStarts[line+1] = el;
    this.lineEnds[line] = el;
    // FIXME following lines are duplicated with moveToAbs
    lineCount++;
    var homeLine = this.homeLine;
    if (lineCount > homeLine + this.numRows) {
        homeLine = lineCount - this.numRows;
        //goalLine -= homeLine - this.homeLine;
        this.homeLine = homeLine;
    }
}

/** Break lines starting with startLine.
 * startLine == -1 means break all lines.
 * startLine == -2 means break all lines until current input line.
 */
Terminal.prototype._breakAllLines = function(startLine = -1) {
    if (DomTerm.verbosity >= 3)
        this.log("_breakAllLines startLine:"+startLine
                 +" cols:"+this.numColumns);
    // The indentation array is a stack of the following:
    // - a <span> node containing pre-line prefixes; or
    // - an absolute x-position (in pixels)
    var indentation = new Array();
    let line;

    function addIndentation(dt, el, countColumns) {
        var n = indentation.length;
        var curPosition = 0;
        var goalPosition = 0;
        var insertPosition = el.lastChild;
        if (insertPosition == null
            || insertPosition.nodeName != "SPAN"
            || ! insertPosition.classList.contains("pprint-post-break"))
            insertPosition = null;
        if (el.getAttribute("line") !== "soft") {
            el.insertBefore(document.createTextNode("\n"), insertPosition);
        }
        let previousStartPosition = 0;
        for (var i = 0; ;  ) {
            var indent = i == n ? null : indentation[i++];
            if ((indent == null || indent instanceof Element)
                && goalPosition > curPosition) {
                var span = dt._createSpanNode("pprint-indent");
                var left = goalPosition-curPosition;
                let numChars = Math.floor((left + 1) / dt.charWidth);
                if (numChars > 0) {
                    span.appendChild(document.createTextNode(DomTerm.makeSpaces(numChars)));
                    let delta = numChars * dt.charWidth;
                    curPosition += delta;
                    left -= delta;
                }
                if (left > 1) {
                    curPosition += left;
                    span.setAttribute("style",
                                      "padding-left: "+left+"px");
                }
                el.insertBefore(span, insertPosition);
            }
            if (indent == null)
                break;
            if (indent instanceof Element) {
                let t = indent.getAttribute("content-value");
                let tprev;
                previousStartPosition = curPosition;
                indent = indent.cloneNode(true);
                el.insertBefore(indent, insertPosition);
                if (! t && countColumns)
                    t = el.textContent;
                let w = countColumns
                    ? dt.strWidthInContext(t, el) * dt.charWidth
                    : indent.offsetWidth;
                curPosition = previousStartPosition + w;
                goalPosition = curPosition;
            }
            else {
                goalPosition = indent;
            }
        }
        el.setAttribute("breaking", "yes");
        return curPosition;
    };

    // Using two passes is an optimization, because mixing offsetLeft
    // calls with DOM mutation is very expensive.
    // (This is not an issue when countColums is true.)
    //
    // First pass: measure offset and width but do not change DOM.
    // For each Element, set the measureLeft/measureWidth properties to
    // (roughly) offsetLeft/offsetWidth.  Pretty-printing elements
    // pprint-indent (with child text), pre-break, and post-break elements
    // are measured (measureWidth is set) but do not count for the width
    // of containing elements. (This happens automatically if !countColumnts.)
    // If countColumns, use characters counts to calculate widths instead
    // of accessing offsetLeft/offsetWidth properties; this is faster,
    // though less general.
    // Assumes soft line breaks have been removed.
    // Does not depend on current available width.

    function breakLine1 (dt, start, countColumns) {
        let pprintGroup = null; // FIXME if starting inside a group
        // A chain of "line" and "pprint-group" elements that need
        // sectionEnd to be set (to a later "line" at same or higher level).
        let needSectionEndList = null;
        let needSectionEndFence = null;
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
        let value;
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
                for (let pending = needSectionEndList;
                     pending != needSectionEndFence; ) {
                    var next = pending._needSectionEndNext;
                    pending._needSectionEndNext = undefined;
                    pending.sectionEnd = el;
                    pending = next;
                }
                needSectionEndList = needSectionEndFence;
                if (lineAttr == "hard" || lineAttr == "soft") {
                    if (el.outerPprintGroup == null) {
                        skipChildren = true;
                        break;
                    }
                } else {
                    el._needSectionEndNext = needSectionEndList;
                    needSectionEndList = el;
                }
                if (lineAttr == "required")
                    pprintGroup.breakSeen = true;
            } else if (el.classList.contains("pprint-indent")) {
                el.pprintGroup = pprintGroup;
            } else if (el.classList.contains("pprint-group")) {
                pprintGroup = el;
                pprintGroup.breakSeen = false;
                el._needSectionEndNext = needSectionEndList;
                needSectionEndList = el;
                el._saveSectionEndFence = needSectionEndFence;
                needSectionEndFence = needSectionEndList;
            } else if ((value = el.getAttribute("content-value")) != null
                       && el.nodeName == "SPAN") {
                if (countColumns)
                    beforeCol += dt.strWidthInContext(value, el);
            }
            if (el.firstChild != null && ! skipChildren)
                el = el.firstChild;
            else {
                for (;;) {
                    if (el == null)
                        break;
                    if (el == pprintGroup) { // pop pprint-group
                        let outerGroup = pprintGroup.outerPprintGroup;
                        if (pprintGroup.breakSeen && outerGroup)
                            outerGroup.breakSeen = true;
                        pprintGroup = outerGroup;
                        needSectionEndFence = el._saveSectionEndFence;
                        el._saveSectionEndFence = undefined;
                    }
                    var next = el.nextSibling;
                    if (countColumns && el instanceof Element) {
                        el.measureWidth =
                            beforeCol * dt.charWidth - el.measureLeft;
                        let cls = el.classList;
                        if (cls.contains("pprint-indent")
                            || cls.contains("pre-break")
                            || cls.contains("post-break")) {
                            // These are not visible (when not breaking),
                            // so we want to measure their width, but they are
                            // "out-of-band" - not part of the cumulative width.
                            beforeCol = el.measureLeft / dt.charWidth;
                        }
                    }
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
            let previous, value;
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
                        dt._insertIntoLines(lineNode, line);
                        indentWidth =
                            addIndentation(dt, lineNode, countColumns);
                        rest = el.parentNode === null && el.data === rest ? el
                            : document.createTextNode(rest);
                        if (el == dt.outputContainer
                           && dt.outputBefore > el.length) {
                            dt.outputContainer = rest;
                            dt.outputBefore -= el.length;
                        }
                        el = lineNode;
                        el.parentNode.insertBefore(rest, el.nextSibling);
                        next = rest;
                    } else { // dt.isObjectElement(el) or wc-node
                        dt._insertIntoLines(lineNode, line);
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
                var group = el.outerPprintGroup;
                if (lineAttr == "linear") {
                    var sectionEnd = group ? group.sectionEnd : null;
                    if (! sectionEnd)
                        sectionEnd = dt.lineEnds[line];
                    var containingSectionStartLine =
                        el.outerPprintGroup == null ? sectionStartLine
                        : el.outerPprintGroup.saveSectionStartLine;
                    if ((group && group.breakSeen)
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
                    if (group)
                        group.breakSeen = true;
                    startOffset = el.measureLeft + el.measureWidth;
                    var indentWidth = addIndentation(dt, el, countColumns);
                    let lastChild = el.lastChild;
                    if (lastChild instanceof Element
                         && lastChild.classList.contains("post-break")) {
                        indentWidth += lastChild.measureWidth;
                    }
                    beforePos = indentWidth;
                    startOffset -= beforePos;
                    if (lineAttr != "hard") {
                        dt._insertIntoLines(el, line);
                        line++;
                    }
                    measureWidth = 0;
                }
                sectionStartLine = line;
            } else if (el.classList.contains("pprint-indent")) {
                skipChildren = true;
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
                } else {
                    indentation.push(el);
                }
            } else if (el.classList.contains("pprint-group")) {
                previous = el.previousSibling;
                el.indentLengthBeforeBlock = indentation.length;
                el.saveSectionStartLine = sectionStartLine;
                sectionStartLine = line;
                if (previous && previous.nodeName == "SPAN"
                    && previous.classList.contains("pprint-prefix")) {
                    var prefix = previous.firstChild.data;
                    var span = dt._createSpanNode("indentation");
                    span.setAttribute("content-value", extra);
                    indentation.push(previous.measureLeft - startOffset);
                    indentation.push(span);
                }
                indentation.push(el.measureLeft - startOffset);
                pprintGroup = el;
            } else if (el.getAttribute("prompt-kind") == "r"
                       && (previous = el.previousSibling) instanceof Element
                       && ((value = previous.getAttribute("content-value"))
                           != null)) {
                let start = previous.measureLeft - startOffset;
                let pad = availWidth - start - measureWidth;
                if (pad < dt.charWidth) { // hide
                    previous.setAttribute("content-value", "");
                    el.style.visibility = "hidden";
                    el.style.position = "absolute";
                } else {
                    let numSpaces = Math.floor((pad + 0.1) / dt.charWidth);
                    let spaces = DomTerm.makeSpaces(numSpaces);
                    previous.setAttribute("content-value", spaces);
                    startOffset -= numSpaces * dt.charWidth - previous.measureWidth;
                    el.style.visibility = "";
                    el.style.position = "";
                }
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
        indentation.length = 0;
    };

    function breakNeeded(dt, lineNo, lineStart) {
        var wmode = lineStart._widthMode;
        // NOTE: If might be worthwhile using widthColums tracking also
        // for the wmode == Terminal._WIDTH_MODE_PPRINT_SEEN case,
        // but we have to adjust for pre-break./post-break/non-break
        // and indentation columns.
        if (! Terminal._forceMeasureBreaks
            && wmode <= Terminal._WIDTH_MODE_TAB_SEEN
            && lineStart._widthColumns !== undefined) {
            return lineStart._widthColumns > dt.numColumns;
        }
        var end = dt.lineEnds[lineNo];
        // FIXME use measureLeft if set
        return end != null && end.offsetLeft > dt.availWidth;
    }

    let firstInputLine = null;
    if (startLine < 0) {
        if (startLine == -2)
            firstInputLine = this._getOuterPre(this.outputContainer, "input-line");
        startLine = 0;
        if (this.initial && this.initial.saveLastLine >= 0) // paranoia
            startLine = this.initial.saveLastLine;
        else
            startLine = this.homeLine;
    }

    var changed = this._unbreakLines(startLine, false, firstInputLine);

    for (line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start == firstInputLine)
            break;
        if (start.classList.contains("domterm-opaque"))
            continue;
        var end = this.lineEnds[line];
        if (start.alwaysMeasureForBreak || breakNeeded(this, line, start)) {
            changed = true; // FIXME needlessly conservative
            start.breakNeeded = true;
            var first;
            if (Terminal.isBlockNode(start))
                first = start.firstChild;
            else {
                while (start.nextSibling == null)
                    start = start.parentNode;
                first = start.nextSibling;
            }
            var countColumns = ! Terminal._forceMeasureBreaks
                && start._widthMode < Terminal._WIDTH_MODE_VARIABLE_SEEN;
            breakLine1(this, first, countColumns);
        }
    }
    for (line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start.breakNeeded) {
            start.breakNeeded = false;
            var first;
            if (Terminal.isBlockNode(start))
                first = start.firstChild;
            else {
                while (start.nextSibling == null)
                    start = start.parentNode;
                first = start.nextSibling;
            }
            var countColumns = !Terminal._forceMeasureBreaks
                && start._widthMode < Terminal._WIDTH_MODE_VARIABLE_SEEN;
            breakLine2(this, first, 0, this.availWidth, countColumns);
        }
    }

    if (changed)
        this.resetCursorCache();
    let numLines = this.lineStarts.length;
    if (this.homeLine >= numLines)
        this.homeLine = numLines - 1;
    if (numLines - this.homeLine > this.numRows) {
        var absLine = this.getAbsCursorLine();
        this.homeLine = numLines - this.numRows;
        if (absLine < this.homeLine) {
            this.resetCursorCache();
            this.moveToAbs(this.homeLine, 0, false);
        }
    }
}

Terminal.prototype._breakString = function(textNode, lineNode, beforePos, afterPos, availWidth, forceSomething, countColumns) {
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

Terminal.prototype.insertSimpleOutput = function(str, beginIndex, endIndex) {
    var sslen = endIndex - beginIndex;
    if (sslen == 0)
        return;

    let widthInColumns = 0;
    let segments = [];
    let widths = [];
    let numCols = 0;
    const preferWide = false; //this.ambiguousCharsAreWide(context);
    for (let i = beginIndex; ; ) {
        let width;
        let next_i;
        if (i >= endIndex) {
            width = -1;
        } else {
            var codePoint = str.codePointAt(i);
            next_i = i + ((codePoint <= 0xffff) ? 1 : 2);
            width = preferWide ? this.wcwidth.charWidthRegardAmbiguous(codePoint)
                : this.wcwidth.charWidthDisregardAmbiguous(codePoint);
        }
        if (i > beginIndex && width != 1) {
            segments.push(str.substring(beginIndex, i));
            widths.push(numCols);
        }
        if (width < 0)
            break;
        if (width == 2) {
            const wcnode = this._createSpanNode("wc-node",
                                                str.substring(i, next_i));
            segments.push(wcnode);
            widths.push(2);
            beginIndex = next_i;
            numCols = 0;
        } else
            numCols++;
        widthInColumns += width;
        i = next_i;
    }

    let nsegments = segments.length;
    if (nsegments == 0)
        return;
    let isegment = 0;
    if (DomTerm.verbosity >= 3)
        this.log("insertSimple '"+this.toQuoted(str.substring(beginIndex,endIndex))+"'");
    let absLine = this.getAbsCursorLine();
    var fits = true;
    if (this.outputBefore instanceof Element
        && this.outputBefore.getAttribute("line")) {
        let prev = this.outputBefore.previousSibling;
        if (prev instanceof Element
            && prev.getAttribute("std")
            && prev.getAttribute("std") != "prompt"
            && prev.getAttribute("std") != "caret"
            && prev.getAttribute("std") != "hider") {
            this.outputContainer = this.outputBefore.previousSibling;
            this.outputBefore = null;
        }
    }
    if (this.outputContainer.tagName == "SPAN"
        && this.outputContainer.getAttribute("class") == "wc-node"
        && this.outputBefore == this.outputContainer.firstChild) {
        this.outputBefore = this.outputContainer;
        this.outputContainer = this.outputBefore.parentNode;
    }
    if (this.outputBefore instanceof Text) {
        this.outputContainer = this.outputBefore;
        this.outputBefore = 0;
    }
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
        this._adjustStyle();
    } else {
        if (this.outputContainer instanceof Text)
            this._adjustStyle();
        /*
        for (;;) {
            if (isegment == nsegments)
                return;
            let seg = segments[isegment];
            let oldChild;
            if (seg instanceof Element
                && this.outBefore.tagName == "SPAN"
                && this.outputBefore.getAttribute("class") == "wc-node"
                && (oldChild = this.outputBefore.firstChild) instanceof Text) {
                if (oldChild.data !== seg.firstChild.data) {
                    oldChild.data = seg.firstChild.data;
                }
                this.outputBefore = this.outputBefore.nextSibling;
                isegment++;
            } else if (typeof seg === "string" && this.outputBefore instanceof Text) {
                ... check if seg is prefix of this.outputBefore ...
            } else
                break;
        }
        */
        // FIXME - merge the following optimizations into the above loop
        if (this.outputContainer instanceof Text) {
            let oldStr = this.outputContainer.data.substring(this.outputBefore);
            if (oldStr.startsWith(str)) {
                // Editors sometimes move the cursor right by re-sending.
                // Optimize this case.  This avoids changing the DOM, which is
                // desirble (for one it avoids messing with the selection).
                this.outputBefore += str.length;
                if (this.currentCursorColumn >= 0)
                    this.currentCursorColumn += widthInColumns;
                str = null;
                nsegments = 0;
            }
            else if (false) { // FIXME
                let oldColWidth = this.strWidthInContext(oldStr, this.outputContainer);
                // optimize if new string is less wide than old text
                if (widthInColumns <= oldColWidth
                    // For simplicty: no double-width chars
                    && widthInColumns == str.length // FIXME
                    && oldColWidth == oldStr.length) {
                    let strCharLen = DomTerm._countCodePoints(str);
                    let oldLength = DomTerm._indexCodePoint(oldStr, strCharLen);
                    this.outputContainer.replaceData(this.outputBefore, oldLength, str);
                    this.outputBefore += str.length;
                    str = null;
                    nsegments = 0;
                }
            }
        }
        if (str == null)
            fits = true;
        else {
            // FIXME optimize if end of line
            fits = this.deleteCharactersRight(widthInColumns, true);
        }
    }
    if (! fits && absLine < this.lineStarts.length - 1) {
        this._clearWrap(absLine);
        this._breakDeferredLines();
        absLine = this.getAbsCursorLine();
    }
    for (;;) {
        if (isegment >= nsegments)
            break;
        let seg = segments[isegment];
        let cols = widths[isegment];
        this._adjustStyle();
        let textNode;
        if (seg instanceof Element) {
            this.insertNode(seg);
            textNode = seg.firstChild;
        } else {
            textNode = this.insertRawOutput(seg);
        }
        //let prevLine = absLine;
        let lineStart = this.lineStarts[absLine];
        let column = this.getCursorColumn();
        if (column + cols > this.numColumns) {
            if (seg instanceof Element) {
                if (this.getCursorColumn() <= this.numColumns) {
                    isegment--;
                }
            } else {
                const tparent = textNode.parentNode;
                const tprev = textNode.previousSibling;
                const tnext = textNode.nextSibling;
                let countColumns = ! Terminal._forceMeasureBreaks
                    && lineStart._widthMode < Terminal._WIDTH_MODE_VARIABLE_SEEN;
                let left = countColumns ? column * this.charWidth
                      : tprev === null ? tparent.offsetLeft
                      : tprev.offsetLeft + tprev.offsetWidth;
                // In case insertRawOutput appended to a pre-existing text node,
                if (countColumns && textNode.length > seg.length) {
                    left -= (this.strWidthInContext(textNode.data, this.outputContainer) - cols)
                        * this.charWidth;
                }
                let right = countColumns ? left + cols * this.charWidth
                      : tnext !== null ? tnext.offsetLeft
                      : tparent.offsetLeft + tparent.offsetWidth;
                seg = this._breakString(textNode, this.lineEnds[absLine], left, right, this.availWidth, false, countColumns);
                if (seg) {
                    segments[isegment] = seg;
                    let r = this.strWidthInContext(seg, this.outputContainer);
                    cols -= r;
                    widths[isegment] = r;
                    isegment--;
                }
            }
            //current is after inserted textNode;
            var oldContainer = this.outputContainer;
            let oldLine = this.lineEnds[absLine];
            if (this.outputBefore != null
                || oldContainer.nextSibling != oldLine)
                oldLine = null;
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
            this._updateLinebreaksStart(absLine);
            absLine++;
            this.deleteCharactersRight(widthInColumns - cols, false);
            column += cols;
            if (lineStart._widthColumns !== undefined
                && lineStart._widthColumns < column)
                lineStart._widthColumns = column;
        } else {
            this.currentCursorColumn = (column += cols);
            if (lineStart._widthColumns !== undefined)
                lineStart._widthColumns += cols;
        }
        widthInColumns -= cols;
        isegment++;
        this.currentAbsLine = absLine;
    }
};

Terminal.prototype._updateLinebreaksStart = function(absLine, requestUpdate=false) {
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

Terminal.prototype.insertRawOutput = function(str) {
    var node
        = this._fixOutputPosition() != null ? this.outputBefore.previousSibling
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
Terminal.prototype._pushIntoElement = function(element) {
    this.insertNode(element);
    this.outputContainer = element;
    this.outputBefore = null;
};

/** Move position to follow current container. */
Terminal.prototype.popFromElement = function() {
    var element = this.outputContainer;
    this.outputContainer = element.parentNode;
    this.outputBefore = element.nextSibling;
};

/** Insert a node at (before) current position.
 * Caller needs to update cursor cache or call resetCursorCache.
 * The node to be inserted before current output position.
 *   (Should not have any parents or siblings.)
 */
Terminal.prototype.insertNode = function (node) {
    this._fixOutputPosition();
    this.outputContainer.insertBefore(node, this.outputBefore);
};

/** Send a response to the client.
* By default just calls processInputCharacters.
*/
Terminal.prototype.processResponseCharacters = function(str) {
    if (! this._replayMode && ! this.isSecondaryWindow()) {
        if (DomTerm.verbosity >= 3)
            this.log("processResponse: "+JSON.stringify(str));
        this.processInputCharacters(str);
    }
};

Terminal.prototype.reportText = function(text, suffix) {
    text = this._maybeBracketed(text);
    if (suffix)
        text = text + suffix;
    this.processInputCharacters(text);
};

/** This function should be overidden. */
Terminal.prototype.processInputCharacters = function(str) {
    if (DomTerm.verbosity >= 1) {
        let jstr = str.length > 200
            ? JSON.stringify(str.substring(0,200))+"..."
            : JSON.stringify(str);
        this.log("processInputCharacters "+str.length+": "+jstr);
    }
    let encoder = this._encoder;
    if (! encoder)
        this._encoder = encoder = new TextEncoder();
    this.processInputBytes(encoder.encode(str));
};

Terminal.prototype.processEnter = function() {
    this._restoreInputLine(false);
    this.editorUpdateRemote();
    this._sendInputContents(true);
    this._restoreCaret();
};
/** Update remote input line to match local edited input line. */
Terminal.prototype._updateRemote = function(input, extraText="") {
    let remoteBefore = input.textBefore || "";
    let remoteAfter = input.textAfter || "";
    //input.textBefore = undefined;
    //input.textAfter = undefined;
    // FIXME compare editorUpdateRemote()
    let r = new Range();
    r.selectNodeContents(input);
    let localText = r.toString();
    r.setStartBefore(this._caretNode);
    let localAfter = r.toString();
    let localBefore = localText.substring(0, localText.length-localAfter.length);
    let sharedBefore = 0;
    for (let i = 0;
         i < remoteBefore.length && i < localBefore.length
         && remoteBefore.charCodeAt(i) == localBefore.charCodeAt(i);
         i++) {
        sharedBefore++;
    }
    let sharedAfter = 0;
    let ir = remoteAfter.length; let il = localAfter.length;
    while (--il >= 0 && --ir >= 0
           && remoteAfter.charCodeAt(ir) == localAfter.charCodeAt(il)) {
        sharedAfter++;
    }
    let countCp = DomTerm._countCodePoints;
    let deleteBefore = countCp(remoteBefore.substring(sharedBefore));
    let deleteAfter = countCp(remoteAfter.substring(0, remoteAfter.length-sharedAfter));
    let afterCount = countCp(localAfter.substring(0, localAfter.length-sharedAfter));
    let report =
        (deleteBefore == 0 ? "" :
         this.keyNameToChars("Backspace").repeat(deleteBefore)) +
        (deleteAfter == 0 ? "" :
         this.keyNameToChars("Delete").repeat(deleteAfter));
    report += this._maybeBracketed(localText.substring(sharedBefore, localText.length-sharedAfter));
    if (afterCount > 0) {
        report += this.keyNameToChars("Left").repeat(afterCount);
    }
    this.processInputCharacters(report+extraText);
    input.textBefore = localBefore;
    input.textAfter = localAfter;
}

Terminal.prototype.keyEnterToString  = function() {
    if ((this.sstate.automaticNewlineMode & 2) != 0)
        return "\r\n";
    else
        return "\n";
}

Terminal._keyCodeToValue = function(ecode) {
    if (ecode.startsWith("Digit"))
        return ecode.substring(5);
    if (ecode.startsWith("Key"))
            return ecode.substring(3);
    switch (ecode) {
    case "Minus": return "-";
    case "Plus": return "+";
    case "Equal": return "=";
    case "Comma": return ",";
    case "Semicolon": return ";";
    case "Comma": return ",";
    case "Period": return ".";
    }
    return "";
}

Terminal.prototype.eventToKeyName = function(event) {
    if (! event.key)
        return browserKeymap.keyName(event);
    let base = event.key;
    let shift = event.shiftKey && base != "Shift"
    if (event.type == "keypress") {
        base = "'" + base + "'";
        shift = false;
    }
    // Normalize keynames to match (older) browserKeymap names
    switch (base) {
        case "ArrowLeft": base = "Left"; break;
        case "ArrowRight": base = "Right"; break;
        case "ArrowUp": base = "Up"; break;
        case "ArrowDown": base = "Down"; break;
        case "Control": base = "Ctrl"; break;
        case "Escape": base = "Esc"; break;
        case " ": base = "Space"; break;
    }
    if (base.length == 1 && base >= 'a' && base <= 'z')
        base = base.toUpperCase();
    let name = base
    if (shift && base.length == 1) {
        let codeChar = Terminal._keyCodeToValue(event.code);
        if (codeChar && codeChar != base)
            shift = false;
    }
    if (name == null || event.altGraphKey) return null
    if (event.altKey && base != "Alt") name = "Alt+" + name
    if (event.ctrlKey && base != "Ctrl") name = "Ctrl+" + name
    if (event.metaKey && base != "Cmd") name = "Cmd+" + name
    if (shift) name = "Shift+" + name
    return name;
}

Terminal.prototype.keyNameToChars = function(keyName) {
    const isShift = (mods) => mods.indexOf("Shift+") >= 0;
    const isCtrl = (mods) => mods.indexOf("Ctrl+") >= 0;
    const isAlt = (mods) => mods.indexOf("Alt+") >= 0;
    const isCmd = (mods) => mods.indexOf("Cmd+") >= 0;
    const specialKeySequence = (param, last, modStr) => {
        // param is either a numerical code, as as string (e.g. "15" for F5);
        // or "O" for ones that use SS3 (F1 to F4);
        // or "" for ones that use CSI or SS3 depending on application mode.
        var csi = "\x1B[";
        var mods = 0;
        if (isShift(modStr))
            mods += 1;
        if (isAlt(modStr))
            mods += 2;
        if (isCtrl(modStr))
            mods += 4;
        if (isCmd(modStr))
            mods += 8;
        if (mods > 0)
            return csi+(param==""||param=="O"?"1":param)+";"+(mods+1)+last;
        else if ((this.sstate.applicationCursorKeysMode && param == "") || param == "O")
            return "\x1BO"+last;
        else
            return csi+param+last;
    }

    const dash = keyName.lastIndexOf("+");
    const mods = dash > 0 ? keyName.substring(0, dash+1) : "";
    let baseName = dash > 0 ? keyName.substring(dash+1) : keyName;
    switch (baseName) {
    case "Backspace": return "\x7F";
    case "Tab":  return isShift(mods) ? "\x1B[Z" :  "\t";
    case "Enter": return isAlt(mods) ? "\x1B\r" : this.keyEnterToString();
    case "Esc": return "\x1B";
    case "PageUp": return specialKeySequence("5", "~", mods);
    case "PageDown": return specialKeySequence("6", "~", mods);
    case "End":      return specialKeySequence("", "F", mods);
    case "Home":     return specialKeySequence("", "H", mods);
    case "Left":     return specialKeySequence("", "D", mods);
    case "Up":       return specialKeySequence("", "A", mods);
    case "Right":    return specialKeySequence("", "C", mods);
    case "Down":     return specialKeySequence("", "B", mods);
    case "Insert":   return specialKeySequence("2", "~", mods);
    case "Delete":   return specialKeySequence("3", "~", mods);
    case "F1":   return specialKeySequence("O", "P", mods);
    case "F2":   return specialKeySequence("O", "Q", mods);
    case "F3":   return specialKeySequence("O", "R", mods);
    case "F4":   return specialKeySequence("O", "S", mods);
    case "F5":   return specialKeySequence("15", "~", mods);
    case "F6":   return specialKeySequence("17", "~", mods);
    case "F7":   return specialKeySequence("18", "~", mods);
    case "F8":   return specialKeySequence("19", "~", mods);
    case "F9":   return specialKeySequence("20", "~", mods);
    case "F10":  return specialKeySequence("21", "~", mods);
    case "F11":
        //return specialKeySequence("23", "~", mods);
        return null; // default handling, which is normally full-screen
    case "F12":  return specialKeySequence("24", "~", mods);
    case "F13":  return "\x1B[1;2P";
    case "F14":  return "\x1B[1;2Q";
    case "F15":  return "\x1B[1;2R";
    case "F16":  return "\x1B[1;2S";
    case "F17":  return "\x1B[15;2~";
    case "F18":  return "\x1B[17;2~";
    case "F19":  return "\x1B[18;2~";
    case "F20":  return "\x1B[19;2~";
    case "F21":  return "\x1B[20;2~";
    case "F22":  return "\x1B[21;2~";
    case "F23":  return "\x1B[23;2~";
    case "F24":  return "\x1B[24;2~";
    case "Ctrl":
    case "Alt":
    case "CapsLock":
    case "Mod":
        return null;
    default:
        if ((mods == "Ctrl+" || mods == "Shift+Ctrl+")
            && baseName.length == 1) {
            let ch = baseName.charCodeAt(0);
            if ((ch >= 65 && ch <= 90 && mods == "Ctrl+")
                || ch == 32 || ch == 64 || (ch >= 91 && ch <= 95))
                return String.fromCharCode(ch & 31);
        }
        if (baseName.length == 1
            && (mods == "Alt+" || mods == "Shift+Alt+")) {
            if (baseName >= "A" && baseName <= "Z" && mods == "Alt+")
                baseName = baseName.toLowerCase();
            return "\x1B" + baseName;
        }
        return DomTerm.keyNameChar(keyName);
    }
}

Terminal.prototype.pasteText = function(str) {
    let editing = this.isLineEditing();
    let nl_asis = editing; // leave '\n' as-is (rather than convert to '\r')?
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
        this._clearSelection();
        this._addPendingInput(str);
        if (this.sstate.bracketedPasteMode || this._lineEditingMode != 0)
            this.reportText(str, null);
        else
            this.reportKeyEvent("paste", str);
    }
};

DomTerm.copyLink = function(options=DomTerm._contextOptions) {
    let href = options && options.href;
    if (href)
        DomTerm.copyText(href);
}

DomTerm.copyText = function(str) {
    return DomTerm.valueToClipboard({ text: str, html: "" });
}

DomTerm.doContextCopy = function() {
    let contentValue = DomTerm._contextOptions && DomTerm._contextOptions.contentValue;
    if (contentValue && window.getSelection().isCollapsed)
        DomTerm.valueToClipboard(contentValue);
    else
        DomTerm.doCopy();
}

DomTerm.doPaste = function(dt=DomTerm.focusedTerm) {
    let sel = document.getSelection();
    dt.maybeFocus();
    let useClipboardApi = DomTerm.isElectron();
    if (useClipboardApi) {
        navigator.clipboard.readText().then(clipText =>
            dt.pasteText(clipText));
    } else if ((","+dt.getOption("`server-for-clipboard", "")+",")
               .indexOf(",paste,") >= 0) {
        dt.reportEvent("REQUEST-CLIPBOARD-TEXT", "");
    } else {
        document.execCommand("paste", false);
    }
    return true;
};

Terminal._rangeAsHTML = function(range) {
    return Terminal._nodeToHtml(range.cloneContents(), null, null);
}

Terminal._selectionAsHTML = function(sel = window.getSelection()) {
    var hstring = "";
    for(var i = 0; i < sel.rangeCount; i++) {
        hstring += Terminal._rangeAsHTML(sel.getRangeAt(i));
    }
    return hstring;
}

Terminal._rangeAsText = function(range) {
    let t = "";
    function wrapText(tnode, start, end) {
        let parent = tnode.parentNode;
        // Skip text that is input-line but not actual input (std="input")
        // (for example "spacer" text before a right-prompt).
        if (parent instanceof Element) {
            if (parent.getAttribute("std") === "caret")
                parent = parent.parentNode;
            if (parent.classList.contains("input-line"))
                return;
        }
        let style = window.getComputedStyle(parent);
        if (style["visibility"] === "hidden"
            || style["display"] === "none")
            return;
        let stdElement = Terminal._getStdElement(tnode);
        if (stdElement && stdElement.getAttribute("prompt-kind") == "r")
            return;
        t += tnode.data.substring(start, end);
    }
    function elementExit(node) {
        if (Terminal.isBlockNode(node)
            && t.length > 0 && t.charCodeAt(t.length-1) != 10)
            t += '\n';
        return false;
    }
    function lineHandler(node) { return true; }
    let scanState = { linesCount: 0, todo: Infinity, unit: "char", stopAt: "",
                      wrapText: wrapText, elementExit, lineHandler };
    Terminal.scanInRange(range, false, scanState);
    return t;
}

Terminal._selectionAsText = function(sel = window.getSelection()) {
    var hstring = "";
    for(var i = 0; i < sel.rangeCount; i++) {
        hstring += Terminal._rangeAsText(sel.getRangeAt(i));
    }
    return hstring;
    //return sel.toString();
}

Terminal._selectionValue = function(asHTML) {
    var sel = window.getSelection();
    var html = Terminal._selectionAsHTML(sel);
    return asHTML ? { text: html, html: "" }
    : { text: Terminal._selectionAsText(sel), html: html };
}

DomTerm.valueToClipboard = function(values) {
    if (DomTerm.isElectron() || DomTerm.usingQtWebEngine) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("value-to-clipboard", values);
        }
        else if (DomTerm.isElectron()) {
            electronAccess.clipboard.write(values);
        }
        return true;
    }
    function handler (event){
        if (values.text)
            event.clipboardData.setData('text/plain', values.text);
        if (values.html)
            event.clipboardData.setData('text/html', values.html);
        event.preventDefault();
        document.removeEventListener('copy', handler, true);
    }
    document.addEventListener('copy', handler, true);
    return document.execCommand("copy", false);
}

DomTerm.doCopy = function(asHTML=false) {
    if (DomTerm.dispatchTerminalMessage("copy-selection", asHTML))
        return true;
    // Terminal
    return DomTerm.valueToClipboard(Terminal._selectionValue(asHTML));
};

DomTerm.doSaveAs = function(dt = DomTerm.focusedTerm) {
    if (DomTerm.dispatchTerminalMessage("request-save-file"))
        return;
    if (! dt)
        return;
    let data = dt.getAsHTML(true);
    if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("save-file", data);
    else
        DomTerm.saveFile(data);
};

DomTerm.saveFile = function(data) {
    var fname = "domterm-saved-"+(++DomTerm.saveFileCounter)+".html";
    if (DomTerm.isElectron()) {
        function callback(value) {
            let filePath = value.filePath;
            if (filePath)
                electronAccess.fs.writeFile(filePath, data, function (err) {
                    if (err)
                        alert("An error ocurred creating the file "+ err.message);
                });
        }
        electronAccess.ipcRenderer.invoke('open-dialog', 'save',
                                          {defaultPath: fname})
            .then(callback);
    } else {
        let filePath = prompt("save contents as: ", fname);
        if (filePath)
            saveAs(new Blob([data], {type: "text/html;charset=utf-8"}),
                   filePath, true);
    }
}

Terminal.prototype.getSelectedText = function() {
    return window.getSelection().toString();
};

Terminal.prototype.listStylesheets = function() {
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

Terminal.prototype.reportStylesheets = function() {
    this.processResponseCharacters("\x9D" + this.listStylesheets().join("\t")
                                   + "\n");
};

Terminal.prototype.printStyleSheet = function(specifier) {
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

Terminal.prototype.createStyleSheet = function() {
    var head = document.getElementsByTagName("head")[0];
    var style = document.createElement("style");
    head.appendChild(style);
    return style.sheet;
    //var styleSheets = document.styleSheets;
    //return styleSheets[styleSheets.length-1];
}

Terminal.prototype.getTemporaryStyleSheet = function() {
    var styleSheet = this.temporaryStyleSheet;
    if (! styleSheet || ! styleSheet.ownerNode) {
        styleSheet = this.createStyleSheet();
        styleSheet.ownerNode.setAttribute("name", "(temporary-styles)");
        this.temporaryStyleSheet = styleSheet;
    }
    return styleSheet;
};

Terminal.prototype.addStyleRule = function(styleRule) {
    var styleSheet = this.getTemporaryStyleSheet();
    try {
	styleSheet.insertRule(styleRule, styleSheet.cssRules.length);
    } catch (e) {
	this.log(e.toString());
    }
    DomTerm._checkStyleResize(this);
};

Terminal.prototype.loadStyleSheet = function(name, value) {
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
 * Return a CSSStyleSheet if found or a string (error message) otherwise.
*/
Terminal.prototype.findStyleSheet = function(specifier) {
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

Terminal.prototype.maybeDisableStyleSheet = function(specifier, disable) {
    var styleSheet = this.findStyleSheet(specifier);
    if (typeof styleSheet == "string")
        return styleSheet;
    styleSheet.disabled = disable;
    DomTerm._checkStyleResize(this);
    return "";
};

DomTerm.setInputMode = function(mode, dt = DomTerm.focusedTerm) {
    if (DomTerm.dispatchTerminalMessage("set-input-mode", mode))
        return;
    if (! DomTerm.supportsAutoInputMode && mode == 97)
        mode = 99;
    var wasEditing = dt.isLineEditing();
    switch (mode) {
    case 0: //next
        dt.nextInputMode();
        return;
    case 97 /*'a'*/: //auto
        dt._lineEditingMode = 0;
        dt.clientDoesEcho = true;
        break;
    case 99 /*'c'*/: //char
        dt._lineEditingMode = -1;
        dt.clientDoesEcho = true;
        break;
    case 108 /*'l'*/: //line
        dt._lineEditingMode = 1;
        dt.clientDoesEcho = true;
        break;
    case 112 /*'p'*/: //pipe
        dt._lineEditingMode = 1;
        dt.clientDoesEcho = false;
        break;
    }
    if (DomTerm.usingXtermJs())
        return;
    if (dt.isLineEditing())
        dt.editorAddLine();
    dt._restoreInputLine();
    if (wasEditing && ! dt.isLineEditing()) {
        dt._sendInputContents(false);
        dt._inputLine = null;
    }
    dt.sstate.automaticNewlineMode = dt.clientDoesEcho ? 0 : 3;
};

Terminal.prototype.getInputMode = function() {
    if (this._lineEditingMode == 0)
        return 97; // auto
    else if (this._lineEditingMode > 0)
        return 108; // line
    else
        return 99; // char
}

Terminal.prototype.nextInputMode = function() {
    var mode;
    var displayString;
    if (this._lineEditingMode < 0) {
        // was 'char' change to 'line'
        mode = 108; // 'l'
    } else if (this._lineEditingMode == 0
               || ! DomTerm.supportsAutoInputMode) {
        // was 'auto' (or auto not supported), change to 'char'
        mode = 99; // 'c'
    } else {
        // was 'line' change to 'auto'
        mode = 97; // 'a'
    }
    DomTerm.setInputMode(mode, this);
    DomTerm.inputModeChanged(this, mode);
    this._displayInputModeWithTimeout(this._modeInfo("I"));
}

Terminal.prototype._sendInputContents = function(sendEnter) {
    let oldInputLine = this._inputLine;
    let passwordField = oldInputLine
        && oldInputLine.classList.contains("noecho")
        && this.sstate.hiddenText;
    if (sendEnter && oldInputLine)
        this.editorMoveStartOrEndInput(true);
    let enterToSend = ! sendEnter ? ""
        : passwordField && this._clientPtyExtProc ? "\n"
        : this.keyEnterToString();
    if (passwordField)
        this.reportText(passwordField, enterToSend);
    else if (oldInputLine)
        this._updateRemote(oldInputLine, enterToSend);
    this._doDeferredDeletion();
    if (DomTerm.verbosity >= 2 && oldInputLine)
        this.log("sendInputContents "+this.toQuoted(this.grabInput(this._inputLine))+" sendEnter:"+sendEnter);
    var spanNode;
    var line = this.getAbsCursorLine();
    let suppressEcho = this.clientDoesEcho
        && ((this._clientPtyEcho && ! this._clientPtyExtProc)
            || ! this._clientWantsEditing
            || ! sendEnter);
    if (oldInputLine != null) {
        let noecho = oldInputLine.classList.contains("noecho");
        if (noecho)
            oldInputLine.classList.remove("noecho");
        let cont = oldInputLine.getAttribute("continuation");
        if (sendEnter && ! noecho)
            this.historyAdd(this.grabInput(this._inputLine), cont == "true");
        this.outputContainer = oldInputLine.parentNode;
        this.outputBefore = oldInputLine.nextSibling;
        if (this._getStdMode(oldInputLine.parentNode) !== "input") {
            let wrap = this._createSpanNode();
            wrap.setAttribute("std", "input");
            oldInputLine.parentNode.insertBefore(wrap, oldInputLine);
            wrap.appendChild(oldInputLine);
        }
    }
    this._inputLine = null;
    this._caretNode.useEditCaretStyle = false;
    if (suppressEcho) {
        if (oldInputLine != null) {
            this._createPendingSpan(oldInputLine);
            this._pendingEchoNewlines = 1;
            let txt = oldInputLine.textContent;
            for (let i = txt.length; --i >= 0; )
                if (txt.charCodeAt(i) === 10)
                    ++this._pendingEchoNewlines;
        }
        this._removeInputFromLineTable();
        this.resetCursorCache();
    } else if (passwordField) {
        this.sstate.hiddenText = undefined;
        if (this._caretNode.parentNode)
            this._caretNode.parentNode(this._caretNode);
        oldInputLine.parentNode.removeChild(oldInputLine);
        if (this.outputContainer == oldInputLine)
            this.outputBefore = null;
    } else {
        this._removeCaret();
        if (oldInputLine) {
            let inputParent = oldInputLine.parentNode;
            this._removeInputLine();
            if (inputParent.getAttribute("std") == "input") {
                this._moveNodes(oldInputLine.firstChild, inputParent, oldInputLine);
                inputParent.removeChild(oldInputLine);
                if (this.outputContainer == oldInputLine)
                    this.outputContainer = inputParent;
            }
            this.resetCursorCache();
        }
        while (this.outputBefore === null
               && this.outputContainer.nodeName === "SPAN") {
            this.outputBefore = this.outputContainer.nextSibling;
            this.outputContainer = this.outputContainer.parentNode;
        }
        this.cursorLineStart(1);
    }
}

DomTerm.inputModeChanged = function(dt, mode) {
    if (mode === dt._oldInputMode)
        return;
    dt.reportEvent("INPUT-MODE-CHANGED", '"'+String.fromCharCode(mode)+'"');
    dt._oldInputMode = mode;
}
DomTerm.autoPagerChanged = function(dt, mode) {
    dt._displayInfoWithTimeout("<b>PAGER</b>: auto paging mode "
                               +(mode?"on":"off"));
}

Terminal.prototype._pushToCaret = function(useFocus = false) {
    //this._fixOutputPosition();
    let saved = {
        before: this.outputBefore, container: this.outputContainer };
    if (useFocus && this.viewCaretNode && this.viewCaretNode.parentNode) {
        this.outputBefore = this.viewCaretNode;
    } else {
        this.outputBefore = this._caretNode;
    }
    this.outputContainer = this.outputBefore.parentNode;
    this.resetCursorCache();
    return saved;
}

Terminal.prototype._popFromCaret = function(saved) {
    this.outputBefore = saved.before;
    this.outputContainer = saved.container;
    this.resetCursorCache();
}

DomTerm.masterKeymapDefault =
    new window.browserKeymap(
        Object.assign({
            "F7": "toggle-paging-mode", // actually toogle view-paused-mode
            "Shift-F7": "enter-paging-mode",
            "F11": "toggle-fullscreen",
            "Shift-F11": "toggle-fullscreen-current-window",
            "Ctrl+Insert": "copy-text",
            "Shift-Insert": "paste-text",
            "Ctrl-Shift-A": "enter-mux-mode",
            "Ctrl-Shift-F": "find-text",
            "Ctrl+Shift+L": "input-mode-cycle",
            "Ctrl+Shift+M": "toggle-paging-mode",
            "Ctrl+Shift+N": "new-window",
            "Ctrl-Shift-S": "save-as-html",
            "Ctrl-Shift-T": "new-tab",
            "Ctrl-Shift-X": "cut-text",
            //"Ctrl-@": "toggle-mark-mode",
            "Ctrl-Shift-Home": "scroll-top",
            "Ctrl-Shift-End": "scroll-bottom",
            "Ctrl-Shift-Up": "scroll-line-up",
            "Ctrl-Shift-Down": "scroll-line-down",
            "Ctrl-Shift-PageUp": "scroll-page-up",
            "Ctrl-Shift-PageDown": "scroll-page-down"
        }, window._dt_toggleDeveloperTools ? {
            "Ctrl-Shift-I": "toggle-developer-tools"
        } : {
        }, DomTerm.isMac ? {
            "Mod-V": "paste-text",
            "Mod-C": "copy-text"
        } : {
            "Ctrl-Shift-V": "paste-text",
            "Ctrl-Shift-C": "copy-text"
        }));
DomTerm.masterKeymap = DomTerm.masterKeymapDefault;

// "Mod-" is Cmd on Mac and Ctrl otherwise.
DomTerm.lineEditKeymapDefault = new browserKeymap({
    //"Tab": 'client-action',
    //"Ctrl-T": 'client-action',
    "Ctrl-@": "toggle-mark-mode",
    "Ctrl-C": DomTerm.isMac ? "client-action" : "copy-text-or-interrupt",
    "Ctrl+F": "find-text",
    "Ctrl-R": "backward-search-history",
    "Mod-V": "paste-text",
    "Ctrl-X": "cut-text",
    "Ctrl-Shift-X": "cut-text",
    "Ctrl-Z": "client-action",
    "Ctrl-\\": "client-action",
    "Left": 'backward-char',
    "Mod-Left": 'backward-word',
    "Right": 'forward-char',
    "Mod-Right": 'forward-word',
    "Shift-Left": "backward-char-extend",
    "Shift-Mod-Left": "backward-word-extend",
    "Shift-Right": "forward-char-extend",
    "Shift-Mod-Right": "forward-word-extend",
    "Shift-Up": "up-line-extend",
    "Shift-Down": "down-line-extend",
    "Shift-End": "end-of-line-extend",
    "Shift-Home": "beginning-of-line-extend",
    "Ctrl+Down": "scroll-line-down",
    "Ctrl-Up": "scroll-line-up",
    "Ctrl-PageUp": "scroll-page-up",
    "Ctrl-PageDown": "scroll-page-down",
    "Shift-Alt-Home": "beginning-of-input-extend",
    "Shift-Alt-End": "end-of-input-extend",
    "Backspace": "backward-delete-char",
    "Mod-Backspace": "backward-delete-word",
    "Delete": "forward-delete-char",
    "Mod-Delete": "forward-delete-word",
    "Ctrl+Home": "scroll-top",
    "Ctrl+End": "scroll-bottom",
    "Alt+Home": "beginning-of-input",
    "Alt+End": "end-of-input",
    "Home": "beginning-of-line",
    "End": "end-of-line",
    "Down": "down-line-or-history",
    "Up": "up-line-or-history",
    "Enter": "accept-line",
    "Alt-Enter": "insert-newline",
    "Alt-0": "numeric-argument",
    "Alt-1": "numeric-argument",
    "Alt-2": "numeric-argument",
    "Alt-3": "numeric-argument",
    "Alt-4": "numeric-argument",
    "Alt-5": "numeric-argument",
    "Alt-6": "numeric-argument",
    "Alt-7": "numeric-argument",
    "Alt-8": "numeric-argument",
    "Alt-9": "numeric-argument",
    "Alt--": "numeric-argument",
    "Alt-.": "numeric-argument",
    "Esc": "exit-line-mode",
    "Ctrl-!": "swap-focus-anchor",
    "Ctrl-@": "toggle-mark-mode",
    // The following should be controlled by a user preference
    // for emacs-like keybindings. FIXME
    "Alt-B": "backward-word",
    "Alt-F": "forward-word",
    "Ctrl-A": "beginning-of-line",
    "Ctrl-B": "backward-char",
    "Ctrl-D": "forward-delete-char-or-eof",
    "Ctrl-E": "end-of-line",
    //"Ctrl-F": "forward-char",
    "Ctrl-K": "kill-line",
    "Ctrl-N": "down-line-or-history",
    "Ctrl-P": "up-line-or-history",
    "(keypress)": "insert-char"
});
DomTerm.lineEditKeymap = DomTerm.lineEditKeymapDefault;

DomTerm.pagingKeymapDefault = new browserKeymap({
    "F11": "toggle-fullscreen",
    "Shift-F11": "toggle-fullscreen-current-window",
    "Ctrl-C": DomTerm.isMac ? "paging-interrupt" : "paging-copy-or-interrupt",
    "Ctrl-F": "find-text",
    "Ctrl-Shift-C": "copy-text",
    "Esc": "exit-paging-mode",
    "Ctrl+Shift+M": "toggle-paging-mode",
    "'a'": "toggle-auto-pager",
    "'0'": "numeric-argument",
    "'1'": "numeric-argument",
    "'2'": "numeric-argument",
    "'3'": "numeric-argument",
    "'4'": "numeric-argument",
    "'5'": "numeric-argument",
    "'6'": "numeric-argument",
    "'7'": "numeric-argument",
    "'8'": "numeric-argument",
    "'9'": "numeric-argument",
    "'-'": "numeric-argument",
    "'.'": "numeric-argument",
    "Alt-0": "numeric-argument",
    "Alt-1": "numeric-argument",
    "Alt-2": "numeric-argument",
    "Alt-3": "numeric-argument",
    "Alt-4": "numeric-argument",
    "Alt-5": "numeric-argument",
    "Alt-6": "numeric-argument",
    "Alt-7": "numeric-argument",
    "Alt-8": "numeric-argument",
    "Alt-9": "numeric-argument",
    "Alt--": "numeric-argument",
    "Alt-.": "numeric-argument",
    "Ctrl-!": "swap-focus-anchor",
    "Ctrl-@": "toggle-mark-mode",
    "Left": "backward-char",
    "Mod-Left": 'backward-word',
    "Right": "forward-char",
    "Mod-Right": 'forward-word',
    "Shift-Left": "backward-char-extend",
    "Shift-Mod-Left": "backward-word-extend",
    "Shift-Right": "forward-char-extend",
    "Shift-Mod-Right": "forward-word-extend",
    "Up": "up-line",
    "Down": "down-line-or-unpause",
    "Shift-Up": "up-line-extend",
    "Shift-Down": "down-line-extend",
    "Mod-Right": 'forward-word',
    "Ctrl-Down": "scroll-line-down",
    "Ctrl-Up": "scroll-line-up",
    "Ctrl-PageUp": "scroll-page-up",
    "Ctrl-PageDown": "scroll-page-down",
    "Ctrl-Home": "scroll-top",
    "Ctrl-End": "scroll-bottom",
    "PageUp": "up-page",
    "PageDown": "down-page-or-unpause",
    "Home": "beginning-of-line",
    "End": "end-of-line",
    "Shift-Home": "beginning-of-line-extend",
    "Shift-End": "end-of-line-extend",
    "Alt-Home": "beginning-of-buffer",
    "Alt-End": "end-of-buffer",
    "Alt-Shift-Home": "beginning-of-buffer-extend",
    "Alt-Shift-End": "end-of-buffer-extend",
    "Shift-Enter": "up-line",
    "Enter": "down-line-or-continue",
    "Shift-Space": "up-page",
    "Space": "down-page-or-continue",
    "'c'": "exit-pager-disable-auto",
    "'p'": "scroll-percentage",
    "'r'": "toggle-pause-mode",
    "'%'": "scroll-percentage",
    "(keypress)": "paging-keypress"
});
DomTerm.pagingKeymap = DomTerm.pagingKeymapDefault;

/** If keyName is a key-press, return pressed key; otherwise null. */
DomTerm.keyNameChar = function(keyName) {
    if (keyName.length >= 3 && keyName.charCodeAt(0) == 39/*"'"*/)
        return keyName.charAt(1);
    else
        return null;
};

/** May be overridden. */
DomTerm.dispatchTerminalMessage = function(command, ...args) {
    return false;
}

// This is overridden in the layout-manager context if using useIFrame.
DomTerm.doNamedCommand = function(name, dt=DomTerm.focusedTerm) {
    if (! DomTerm.dispatchTerminalMessage("do-command", name))
        commandMap[name](dt, null);
}

DomTerm.handleKey = function(map, dt, keyName) {
    let maps = typeof map == "object" && map instanceof Array ? map : [map];
    if (dt._markMode && keyName.indexOf("Shift+") < 0) {
        let skeyName = "Shift+" + keyName;
        for (let map of maps) {
            let cmd = map.lookup(skeyName);
            if (typeof cmd === "string" && cmd.endsWith("-extend")) {
                let r = commandMap[cmd](dt, keyName);
                dt.previousKeyName = keyName;
                return r;
            }
        }
    }
    let command;
    for (let map of maps) {
        if (typeof map == "function")
            command = map(this, keyName);
        else {
            command = map.lookup(keyName);
            if (! command && DomTerm.keyNameChar(keyName) != null)
                command = map.lookup("(keypress)");
        }
        if (typeof command == "string" || command instanceof String)
            command = commandMap[command];
        if (command) {
            dt._didExtend = false;
            let r = typeof command == "function" ? command(dt, keyName)
                : command;
            dt.previousKeyName = keyName;
            return r;
        }
    }
    return false;
};

Terminal.prototype.doLineEdit = function(keyName) {
    if (DomTerm.verbosity >= 2)
        this.log("doLineEdit "+keyName);

    let keymaps = (this._miniBuffer && this._miniBuffer.keymaps)
        || [ DomTerm.lineEditKeymap ];
    return DomTerm.handleKey(keymaps, this, keyName);
};

DomTerm.saveFileCounter = 0;

Terminal.prototype._adjustPauseLimit = function() {
    let node = this._caretNode;
    if (node == null || node.parentNode == null) {
        node = this.outputContainer;
        if (node instanceof Text)
            node = node.parentNode;
    }
    if (node == null)
        return;
    let offsetTop = 0;
    for (; node && node !== this.topNode; node = node.offsetParent) {
        offsetTop += node.offsetTop;
    }
    var limit = offsetTop + this.availHeight;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
}

Terminal.sendSavedHtml = function(dt, html) {
    dt.reportEvent("GET-HTML", JSON.stringify(html));
}

Terminal.prototype._isOurEvent = function(event) {
    if(DomTerm.isMac && event.metaKey)
        // All Command keys should be handled by OSX itself.
        return false;
    //return this._isAnAncestor(event.target, this.topNode);
    return this.hasFocus();
}

Terminal.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    let keyName = this.eventToKeyName(event);
    if (DomTerm.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event+" name:"+keyName+" old:"+(this._inputLine != null)+" col:"+document.getSelection().isCollapsed);

    if (! keyName && event.key)
        keyName = event.key;
    if (! this._isOurEvent(event))
        return;
    if (this._composing > 0 || event.which === 229)
        return;
    if (this._composing == 0)
        this._composing = -1;

    if (this._clearPendingDisplayMiscInfo()) {
    } else if (this._showingMiscInfo) {
        DomTerm.displayMiscInfo(this, false);
    } else if (keyName == "Ctrl") {
        let keyup = (e) => {
            DomTerm.displayMiscInfo(this, true);
            this.topNode.removeEventListener("keyup", keyup, false);
            this._keyupDisplayInfo = undefined;
        }
        this._keyupDisplayInfo = keyup;
        this.topNode.addEventListener("keyup", keyup, false);
    }

    if (this._muxMode) {
        this._muxKeyHandler(event, key, false);
        return;
    }
    if (this._currentlyPagingOrPaused() && ! this._miniBuffer
        && this.pageKeyHandler(keyName)) {
        event.preventDefault();
        return;
    }
    let editing = this.isLineEditingOrMinibuffer();
    if (editing) {
        if (! this.useStyledCaret())
            this.maybeFocus();
        if (this._searchInHistoryMode) {
            if (keyName == "Ctrl+R" || keyName == "Ctrl+S") {
                this.historySearchForwards = keyName == "Ctrl+S";
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
                let miniBuffer = this._miniBuffer;
                this.removeMiniBuffer(miniBuffer);
                this.historySearchSaved = miniBuffer.textContent;
                this.historyAdd(this._inputLine.textContent, false);
                this._searchInHistoryMode = false;
                if (keyName == "Tab") {
                    this.maybeFocus();
                    event.preventDefault();
                    return;
                }
            }
        }
        if (this.doLineEdit(keyName)) {
            event.preventDefault();
            return;
        }
    }
    if (DomTerm.handleKey(DomTerm.masterKeymap, this, keyName)) {
        event.preventDefault();
        return;
    }

    if (! editing) {
        let str = this.keyNameToChars(keyName);
        if (str) {
            if (this.scrollOnKeystroke)
                this._enableScroll();
            event.preventDefault();
            if (! DomTerm.usingXtermJs()) {
                if (keyName == "Left" || keyName == "Right") {
                    this._editPendingInput(keyName == "Right", false);
                }
                if (keyName == "Backspace" || keyName == "Delete") {
                    if (window.getSelection().isCollapsed)
                        this._editPendingInput(keyName == "Delete", true);
                    else {
                        this.deleteSelected(false);
                        return;
                    }
                }
            }
            this._adjustPauseLimit();
            this._respondSimpleInput(str, keyName);
        }
    }
};

Terminal.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    let keyName = this.eventToKeyName(event);
    if (DomTerm.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" name:"+keyName+" in-l:"+this._inputLine);
    if (! this._isOurEvent(event))
        return;
    if (this._composing > 0)
        return;
    if (this._muxMode) {
        this._muxKeyHandler(event, key, true);
        return;
    }
    if (this._currentlyPagingOrPaused() && ! this._miniBuffer) {
        this.pageKeyHandler(keyName);
        event.preventDefault();
        return;
    }
    if (this.scrollOnKeystroke && ! this._miniBuffer)
        this._enableScroll();
    if (this.isLineEditingOrMinibuffer()) {
        if (this.doLineEdit(keyName))
            event.preventDefault();
    } else {
        if (event.which !== 0
            && key != 8
            && ! event.ctrlKey) {
            var str = String.fromCharCode(key);
            this._clearSelection();
            this._addPendingInput(str);
            this._respondSimpleInput (str, keyName);
            event.preventDefault();
        }
    }
};

Terminal.prototype.inputHandler = function(event) {
    if (DomTerm.verbosity >= 2)
        this.log("input "+event+" which:"+event.which+" data:"+JSON.stringify(event.data));
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
Terminal.prototype._checkTree = function() {
    var node = DomTerm._currentBufferNode(this, 0);
    var dt = this;
    function error(str) {
        dt.log("ERROR: "+str);
    };
    if (this.outputContainer instanceof Text
        && this.outputBefore > this.outputContainer.length)
        error("bad outputContainer");
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
    let value;
    if (this.outputContainer == null
        || (this.outputContainer instanceof Text
            ? (typeof this.outputBefore != "number"
               || this.outputBefore < 0
               || this.outputBefore > this.outputContainer.length)
            : typeof this.outputBefore === "number"
            ? (this.outputContainer.nodeName !== "SPAN"
               || (value = this.outputContainer.getAttribute('content-value')) == null
               || this.outputBefore < 0
               || this.outputBefore > value.length)
            : (this.outputBefore
               && this.outputBefore.parentNode != this.outputContainer))
        || (! isSavedSession && this.outputContainer.parentNode == null))
        error("bad outputContainer");
    else if (this._deferredForDeletion) {
        for (let deferred = this._deferredForDeletion;
             deferred != null; deferred = deferred.nextSibling) {
            /*
            if (deferred.parentNode == null
                || ! (deferred.firstChild == null
                      || (deferred.firstChild instanceof Text
                          && deferred.firstChild.nextSibling == null)))
                error("bad deferred-pending1");
            else if (this.outputContainer == deferred
                     || this.outputContainer == deferred.firstChild)
                error("bad deferred-pending2");
            */
        }
    }
    if (this.inputFollowsOutput && this._inputLine
        && this._inputLine.parentNode && this.outputBefore != this._inputLine)
        error("bad inputLine");
    if (this.homeLine < 0 || this.homeLine >= nlines)
        error("homeLine out of range");
    if (this.viewCaretNode==this.outputContainer)
        error("outputContainer is focus-node");
    if (this.viewCaretNode && this.viewCaretNode.textContent)
        error("non-empty focus-node");
    if (false) {
        // this can happen after a resize.
        let aline = this.currentAbsLine;
        if (this.getAbsCursorLine() < this.homeLine)
            error("homeLine after current");
        this.currentAbsLine = aline;
    }
    if (! this._isAnAncestor(this.outputContainer, this.initial))
        error("outputContainer not in initial");
    if (this._currentPprintGroup != null
        && ! this._isAnAncestor(this.outputContainer, this._currentPprintGroup))
        error("not in non-null pprint-group");
    for (let i = nlines; --i >= this.homeLine; )
        if (! this._isAnAncestor(this.lineStarts[i], this.initial))
            error("line "+i+" not in initial");
    let currentLineStart = null;
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
            /*
            if (cur.getAttribute("std") == "input") {
                if (cur.firstChild == null)
                    error("empty input element");
                if (cur.nextSibling instanceof Element
                    && cur.nextSibling !== this.outputBefore
                    && cur.nextSibling.getAttribute("std") == "input")
                    error("duplicate input element");
            }
            */
            if (cur.getAttribute("std") == "prompt"
                && ! parent.classList.contains("input-line"))
                error("prompt not in input-line");
            if (cur.getAttribute("class") == "wc-node") {
                let ch = cur.firstChild;
                if (ch instanceof Element) {
                    if (ch !== this._caretNode)
                        error("bad element child in wc-node");
                    ch = ch.nextSibling;
                }
                if (cur.firstChild == null || ! (ch instanceof Text))
                    error("missing text in wc-node");
            }
            if (istart < nlines && this.lineStarts[istart] == cur) {
                if (iend == istart && this.lineEnds[iend] == null)
                    iend++;
                if (Terminal.isBlockNode(cur)) {
                    currentLineStart = cur;
                } else {
                    if (! this._isAnAncestor(cur, currentLineStart))
                        error("line start node not in line start block");
                }
                istart++;
            } else if (istart + 1 < nlines && this.lineStarts[istart+1] == cur)
                error("line table out of order - missing line "+istart);
            if (iend < nlines && this.lineEnds[iend] == cur) {
                let softFollowingNeeded = cur.getAttribute("line") == "soft";
                for (let n = cur; ; n = n.parentNode) {
                    if (! (n instanceof Element)) {
                        error("line end node not in line start block");
                        break;
                    }
                    if (n == currentLineStart) {
                        if (softFollowingNeeded)
                            error("soft line end node at end of block "+cur.getAttribute("id"));
                        break;
                    }
                    softFollowingNeeded = softFollowingNeeded
                        && n.nextSibling == null;
                }
                iend++;
            }
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
        const main = DomTerm._currentBufferNode(this, 0);
        if (! main || main == this.initial)
            error("missing main-screenbuffer");
        if (this._isAnAncestor(this.initial, main))
            error("alternate-screenbuffer nested in main-screenbuffer");
    }
};

// For debugging
Terminal.prototype.toQuoted = function(str) {
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

Terminal._mask28 = 0xfffffff;

// data can be a DomString or an ArrayBuffer.
DomTerm._handleOutputData = function(dt, data) {
    if (data instanceof Blob) {
        data.arrayBuffer()
            .then(buffer => DomTerm._handleOutputData(dt, buffer));
        return data.size;
    }
    var dlen;
    if (data instanceof ArrayBuffer) {
        dt.insertBytes(new Uint8Array(data));
        dlen = data.byteLength;
        // updating _receivedCount is handled by insertBytes
    } else {
        dt.insertString(data);
        dlen = data.length;
        dt._receivedCount = (dt._receivedCount + dlen) & Terminal._mask28;
        dt._maybeConfirmReceived();
    }
    return dlen;
}

DomTerm.initXtermJs = function(dt, topNode) {
    let xterm = topNode.xterm;
    this.xterm = xterm;
    topNode.terminal = dt;
    DomTerm.setInputMode(99, dt);
    dt.topNode = xterm.element;
    dt.insertString = function(str) {
        xterm.write(str); };
    dt.parseBytes = function(bytes, beginIndex, endIndex) {
        xterm.write(bytes.slice(beginIndex, endIndex)); };
    xterm.on('data', function(data) {
        dt.processInputCharacters(data);
    });
    xterm.on('resize', function(data) {
        dt.setWindowSize(data.rows, data.cols, data.height||0, data.width||0);
    });
    xterm.attachCustomKeyEventHandler(function(e) {
        if (e.type == 'keypress')
            dt.keyPressHandler(e);
        else
            dt.keyDownHandler(e);
        return false;
    });
    xterm.textarea.addEventListener("focus",
                                    (e) => DomTerm.setFocus(dt, "F"));
    dt.attachResizeSensor();
    dt.xterm = xterm;
    if (window.fit)
        window.fit.fit(xterm);
    xterm.linkHandler = function(e, uri) {
        DomTerm.handleLinkRef(uri, undefined, dt);
    };
    xterm.addCsiHandler("u",
                               function(params,collect) {
                                   switch (params[0]) {
                                   case 90:
                                       DomTerm.newPane(params[1], params[2], dt);
                                       return true;
                                   case 91:
                                       dt.setSessionNumber(params[1],
                                                           params[2],
                                                           params[3]-1);
                                       return true;
                                   case 99:
                                       if (params[1]==99) {
                                           dt.eofSeen();
                                           return true;
                                       }
                                       break;
                                   }
                                   return false;
                               });
    xterm.addOscHandler(0, function(data) { dt.setWindowTitle(data, 0); return false; });
    xterm.addOscHandler(1, function(data) { dt.setWindowTitle(data, 1); return false; });
    xterm.addOscHandler(2, function(data) { dt.setWindowTitle(data, 2); return false; });
    xterm.addOscHandler(30, function(data) { dt.setWindowTitle(data, 30); return false; });
}

/** Connect using WebSockets */
Terminal.connectWS = function(name, wspath, wsprotocol, topNode=null, no_session=null) {
    if (name == null) {
        name = topNode == null ? null : topNode.getAttribute("id");
        if (name == null)
            name = "domterm";
    }
    var wt = new Terminal(name, topNode, no_session);
    if (DomTerm.inAtomFlag && DomTerm.isInIFrame()) {
        // Have atom-domterm's DomTermView create the WebSocket.  This avoids
        // the WebSocket being closed when the iframe is moved around.
        DomTerm.focusedTerm = wt;
        DomTerm.sendParentMessage("domterm-new-websocket", wspath, wsprotocol);
        wt.closeConnection = function() {
             DomTerm.sendParentMessage("domterm-socket-close"); }
        wt.processInputBytes = function(str) {
            DomTerm.sendParentMessage("domterm-socket-send", str); }
        return;
    }
    let wsocket = Terminal.newWS(wspath, wsprotocol, wt);
    wsocket.onopen = function(e) {
        wt._reconnectCount = 0;
        if (topNode == null)
            return;
        if (DomTerm.usingXtermJs() && window.Terminal != undefined) {
            DomTerm.initXtermJs(wt, topNode);
            DomTerm.setFocus(wt, "N");
        } else {
            wt._socketOpen = true;
            wt._handleSavedLog();
            if (topNode.classList.contains("domterm-wrapper"))
                topNode = DomTerm.makeElement(name, topNode);
            wt.initializeTerminal(topNode);
        }
        wt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
    };
}

Terminal.prototype.showConnectFailure = function(ecode, reconnect=null, toRemote=true)  {
    if (this._showConnectFailElement)
        return;

    if (reconnect == null) {
        reconnect = () => {
            this.reportEvent("RECONNECT", this.sstate.sessionNumber+","+this._receivedCount);
        };
    }
    let reconnectId = "show-connectfail-reconnect";
    let pageModeId = "show-connectfail-paging";
    let msg = '<div class="show-connection-failure">';
    if (toRemote) {
        msg += '<h1>Connection to remote session lost</h1>';
        if (this._ssh_error_msg) {
            this.pushClearScreenBuffer(false, true);
            this.insertString(this._ssh_error_msg);
            let ssh_msg = this.initial.innerHTML;
            this.popRestoreScreenBuffer();
            msg += `<p>Ssh (connection from backend server) reported error:</p>`
                + `<p><span std="error">${ssh_msg}</span></p>`;
            this._ssh_error_msg = undefined;
        } else
            msg += `<p>Ssh connection from backend server to remote session timed out or closed.</p>`;
    } else {
        msg += '<h1>Connection to backend lost</h1>';
        msg += `<p>Too may failures (error code ${ecode}) attempting WebSockets connection to backend server.</p>`;
    }
    msg += `<button id="${reconnectId}">Try to re-connect</button> <button id="${pageModeId}">Switch to read-only (paging) mode</button></div>`;
    this.topNode.insertAdjacentHTML('afterbegin', msg);
    let top = this.topNode;
    let div = top.firstChild;
    this._showConnectFailElement = div;
    let topOffset = 0, leftOffset = 0;
    for (let n = top; n; n = n.offsetParent) {
        topOffset += n.offsetTop;
        leftOffset += n.offsetLeft;
    }
    let w = top.offsetWidth;
    div.style["top"] = (topOffset + 0.10 * this.availHeight) + "px";
    div.style["left"] = (0.12 * w + leftOffset) + "px";
    div.style["width"] = ((1 - 2 * 0.12) * w) + "px";
    div.style["box-sizing"] = "border-box";

    this.initial.style.opacity = "0.3";
    this.sstate.disconnected = true;
    let handler = (event) => {
        let eid = event.srcElement.getAttribute('id');
        if (eid == reconnectId || eid == pageModeId) {
            this.initial.style.opacity = "";
            div.removeEventListener("click", handler, false);
            div.parentNode.removeChild(div);
            this._showConnectFailElement = undefined;
        }
        if (eid == reconnectId) {
            this.sstate.disconnected = false;
            reconnect();
            return;
        }
        if (eid == pageModeId) {
            this._enterPaging();
            this._reconnect = reconnect;
            return;
        }
    }
    div.addEventListener("click", handler, false);
};

Terminal.newWS = function(wspath, wsprotocol, wt) {
    let wsocket;
    try {
        wsocket = new WebSocket(wspath, wsprotocol);
        if (DomTerm.verbosity > 0)
            DomTerm.log("created WebSocket on  "+wspath);
    } catch (e) {
        DomTerm.log("caught "+e.toString());
    }
    wsocket.binaryType = "arraybuffer";
    wt.closeConnection = function() { wsocket.close(); };
    wt._remote_input_timer_id = 0; // -1 means inside remote_input_timer
    let remote_input_timer = () => {
        if (! wt._remote_input_interval)
            return;
        wt._remote_input_timer_id = -1;
        wt._confirmReceived();
    };
    wt.processInputBytes = function(bytes) {
        let delay = wt.getOption("debug.input.extra-delay", 0);
        let sendBytes = () => {
            if (wt._remote_input_timer_id > 0) {
                clearTimeout(wt._remote_input_timer_id);
                wt._remote_input_timer_id = 0;
            }
            if (wt._remote_input_interval > 0 && ! wt.sstate.disconnected)
                wt._remote_input_timer_id = setTimeout(remote_input_timer, wt._remote_input_interval);
            wsocket.send(bytes);
        };
        if (delay && wt._remote_input_timer_id >= 0)
            setTimeout(sendBytes, delay*1000);
        else
            sendBytes();
    };
    let remote_output_timer = () => {
        wt.log("TIMEOUT - no output");
        wt.showConnectFailure(-1);
    }
    wt._remote_output_timer_id = 0; // -1 means inside remote_output_timer
    wsocket.onmessage = function(evt) {
        DomTerm._handleOutputData(wt, evt.data);
        if (wt._remote_output_timer_id > 0) {
            clearTimeout(wt._remote_output_timer_id);
            wt._remote_output_timer_id = 0;
        }
        if (wt._remote_output_timeout > 0)
            wt._remote_output_timer_id = setTimeout(remote_output_timer, wt._remote_output_timeout);
    }
    wsocket.onerror = function(e) {
        if (DomTerm.verbosity > 0)
            DomTerm.log("unexpected WebSocket error code:"+e.code+" e:"+e);
    }
    wsocket.onclose = function(e) {
        if (DomTerm.verbosity > 0)
            DomTerm.log("unexpected WebSocket (connection:"+wt.windowNumber+") close code:"+e.code+" e:"+e);
        wt._socketOpen = false;
        let reconnect = () => {
            let reconnect = "&reconnect=" + wt._receivedCount;
            wt._reconnectCount++;
            let m = wspath.match(/^(.*)&reconnect=([0-9]+)(.*)$/);
            if (m)
                wspath = m[1] + reconnect + m[3];
            else
                wspath = wspath + reconnect;
            let remote = wt.getRemoteHostUser();
            if (remote)
                wspath += ("&remote=" + encodeURIComponent(remote)
                           + "&rsession=" + wt.sstate.sessionNumber);
            let wsocket = Terminal.newWS(wspath, wsprotocol, wt);
            wsocket.onopen = function(e) {
                wt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
                wt._confirmedCount = wt._receivedCount;
                wt._socketOpen = true;
                wt._handleSavedLog();
            };
        };
        let reconnectDelay = [0, 200, 400, 400][wt._reconnectCount];
        if (reconnectDelay == 0)
            reconnect();
        else if (reconnectDelay)
            setTimeout(reconnect, reconnectDelay);
        else {
            console.log("TOO MANY CONNECT fAILURES");
            wt.showConnectFailure(e.code, reconnect, false);
        }
    }
    return wsocket;
}

Terminal._makeWsUrl = function(query=null) {
    var ws = location.hash.match(/ws=([^,&]*)/);
    var url;
    let protocol = location.protocol == "https:" ? "wss:" : "ws:";
    if (DomTerm.server_port==undefined || (ws && ws[1]=="same"))
        url = protocol
            + "//"+location.hostname+":" + location.port + "/replsrc";
    else if (ws)
        url = protocol+ws[1];
    else
        url = protocol+"//localhost:"+DomTerm.server_port+"/replsrc";
    if (DomTerm.server_key && ('&'+query).indexOf('&server-key=') < 0) {
        query = (query ? (query + '&') : '')
            + 'server-key=' + DomTerm.server_key;
    }
    if (! DomTerm.isInIFrame()) {
        query = (query ? (query + '&') : '')
            + 'main-window=true';
    }
    if (query)
        url = url + '?' + query;
    return url;
}

DomTerm.initSavedFile = function(topNode) {
    var name = "domterm";
    var dt = new Terminal(name, topNode, 'view-saved');
    dt.initial = document.getElementById(dt.makeId("main"));
    dt._initializeDomTerm(topNode);
    dt.sstate.windowName = "saved by DomTerm "+topNode.getAttribute("saved-version") + " on "+topNode.getAttribute("saved-time");
    dt.topNode.classList.remove("domterm-noscript");
    dt.measureWindow();
    dt._restoreLineTables(topNode, 0);
    dt._breakAllLines();
    dt.updateWindowTitle();
    function showHideHandler(e) {
        var target = e.target;
        if (target instanceof Element
            && target.nodeName == "SPAN"
            && target.getAttribute("std") == "hider") { // FIXME
            dt._showHideHandler(e);
            e.preventDefault();
        }
    }
    topNode.addEventListener("click", showHideHandler, false);
    for (let group of topNode.getElementsByClassName("command-group")) {
        dt._maybeAddTailHider(group);
    }
    dt.setWindowSize = function(numRows, numColumns,
                                availHeight, availWidth) {
    };
}

Terminal.connectHttp = function(node, query=null) {
    var url = Terminal._makeWsUrl(query);
    Terminal.connectWS(null, url, "domterm", node);
}

Terminal.isDelimiter = (function() {
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

Terminal.prototype.linkAllowedUrlSchemes = ":http:https:file:ftp:mailto:";

Terminal.prototype.linkify = function(str, start, end, delimiter/*unused*/) {
    const dt = this;
    let smode = this._getStdMode();
    if (smode == "input" || smode == "prompt" || smode == "hider")
        return false;
    if (DomTerm._isInElement(this.outputContainer, "A"))
        return false;

    function rindexDelimiter(str, start, end) {
        for (let i = end; --i >= start; )
            if (Terminal.isDelimiter(str.charCodeAt(i)))
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
    let fstart = rindexDelimiter(str, start, end)+1;
    let fragment = str.substring(fstart > 0 ? fstart : start, end);
    let firstToMove = null;
    if (fstart == 0) {
        let container = this.outputContainer;
        let previous = container instanceof Text ? container
            : this.outputBefore != null ? this.outputBefore.previousSibling
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
            let pfraglen = previous == container ? this.outputBefore
                : pfragment.length;
            fstart = rindexDelimiter(pfragment, 0, pfraglen)+1;
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
            for (let p = this.outputContainer; ! Terminal.isBlockNode(p); ) {
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
    if (fstart > start && firstToMove == null) {
        this.insertSimpleOutput(str, start, fstart);
        start = fstart;
    }
    let alink = document.createElement("a");
    alink.setAttribute("class", "matched subtle plain");
    alink.setAttribute("href", href);
    this._pushIntoElement(alink);
    if (end-afterLen > start)
        this.insertSimpleOutput(str, start, end-afterLen);
    let old = alink.firstChild;
    for (let n = firstToMove; n && n != alink; ) {
        let next = n.nextSibling;
        if (n == firstToMove && fstart > 0) {
            next = n.splitText(fstart);
        } else
            alink.insertBefore(n, old);
        n = next;
    }
    var saveCol = this.currentCursorColumn;
    var saveLine = this.currentAbsLine;
    this.outputContainer = alink.parentNode;
    this.outputBefore = alink;
    this.resetCursorCache();
    let linkLine = this.getAbsCursorLine();
    if (this._deferredLinebreaksStart < 0
        || this._deferredLinebreaksStart > linkLine)
        this._deferredLinebreaksStart = linkLine;
    this.outputBefore = alink.nextSibling;
    this.currentCursorColumn = saveCol;
    this.currentAbsLine = saveLine;

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
            this.insertSimpleOutput(afterStr, 0, afterLen);
    }
    alink.normalize();
    return true;
}

Terminal.prototype._currentlyPagingOrPaused = function() {
    return this._pagingMode > 0;
};

Terminal.prototype._modeInfo = function(emphasize="") {
    let mode = "Mode:";
    let emphPaging = emphasize.indexOf("P") >= 0;
    let emphExtend = emphasize.indexOf("M") >= 0;
    let emphInput = emphasize.indexOf("I") >= 0;
    let emphContinued = emphasize.indexOf("C") >= 0;
    if (emphContinued) {
        mode += "<b>auto-pause-continued</b>";
    }
    if (emphPaging)
        mode += "<b>";
    if (this._pagingMode > 0) {
        mode += this._pagingMode > 1 ? " view-paused" : " view-running";
        if (emphExtend && ! emphPaging)
            mode += "<b>";
        if (this._markMode)
            mode += "/extend";
        else if (emphExtend)
            mode += "(not extend)";
        if (emphExtend && ! emphPaging)
            mode += "</b>";
        if (this._autoPaging)
            mode += "(auto-pause)";
    } else if (emphPaging) {
        mode += " (not paging)";
    } else {
        if (emphExtend && ! emphPaging)
            mode += "<b>";
        if (this._markMode)
            mode += "extend";
        else if (emphExtend)
            mode += "(not extend)";
        if (emphExtend && ! emphPaging)
            mode += "</b>";
    }
    if (emphPaging)
        mode += "</b>";
    mode += " ";
    if (emphInput)
        mode += "<b>";
    if (this._lineEditingMode < 0)
        mode += "input=char";
    else if (this._lineEditingMode > 0)
        mode += "input=line";
    else if (this.isLineEditing())
        mode += "input=auto (currently line)";
    else
        mode += "input=auto (currently char)";
    if (emphInput)
        mode += "</b>";
    return mode;
}

Terminal.prototype._updateCountInfo = function() {
    if (this._numericArgument) {
        let info = "<span>count: "+this._numericArgument+"</span>";
        this._countInfoDiv = DomTerm.addInfoDisplay(info, this._countInfoDiv, this);
    } else if (this._countInfoDiv) {
        DomTerm.removeInfoDisplay(this._countInfoDiv, this);
        this._countInfoDiv = undefined;
    }
}

Terminal.prototype._updatePagerInfo = function() {
    this._updateCountInfo();
}

Terminal.prototype._pageScrollAbsolute = function(percent) {
    if (percent < 0)
        percent = 0;
    else if (percent >= 100)
        percent = 100;
    var scrollTop = this._vspacer.offsetTop * percent * 0.01;
    var limit = scrollTop + this.availHeight;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
    var vtop = this._vspacer.offsetTop;
    if (limit > vtop) {// set _displayPostEofPage mode
        var vpad = limit - vtop;
        var maxpad = this.availHeight - this.charHeight; // matches 'less'
        this._adjustSpacer(vpad > maxpad ? maxpad : vpad);
    }
    this.buffers.scrollTop = scrollTop;
}

Terminal.prototype._pageScroll = function(delta, scrollOnly = false) {
    let scroll = this.buffers.scrollTop + delta;
    let limit = scroll + this.availHeight;
    let vtop = this._vspacer.offsetTop;
    if (scroll < 0)
        scroll = 0;
    // FIXME actual limit is this._vspacer.offsetTop - availHeight
    // adjusted by vspacer height
    else if (scroll > vtop)
        scroll = vtop;
    // FIXME may do nothing if spacer size is empty
    this.buffers.scrollTop = scroll;
    if (! scrollOnly) {
        if (limit > this._pauseLimit)
            this._pauseLimit = limit;
        if (limit > vtop)
            this._pauseContinue();
    }
}

/** Move focus cursor count number of pages up or down.
 * However, if count === 'limit' (and !moveUp), move to pauselimit.
 */
Terminal.prototype._pageUpOrDown = function(count, moveUp, paging) {
    let iline = this.lineStarts.length;
    let line;
    let lineBlock;
    let force;
    if (count === 'limit' || count > 0)
        force = 'bottom';
    else if (count < 0) {
        force = 'top';
        moveUp = ! moveUp;
        count = - count;
    } else
        force = null;
    if (moveUp) {
        let top = this.buffers.scrollTop;
        top -= (count - 1) * this.actualHeight;
        top += this.charHeight;
        for (;;) {
            --iline;
            line = this.lineStarts[iline];
            lineBlock = line.getAttribute("line") === null;
            if (iline == 0)
                break;
            let lineRect = line.getBoundingClientRect();
            // The "top" of a line starting with a line object
            // is actually the bottom of the line object.
            let lineTop = this.buffers.scrollTop
                + (lineBlock ? lineRect.top : lineRect.bottom);
            if (lineTop < top)
                break;
        }
    } else {
        let top;
        if (count === 'limit') {
            top = this._pauseLimit + 0.8;
        } else {
            let cursor =
                this.viewCaretNode && this.viewCaretNode.parentNode ? this.viewCaretNode
                : this.outputBefore instanceof Element ? this.outputBefore
                : this.outputContainer instanceof Element ? this.outputContainer
                : this.outputContainer.parentNode;
            let height = count * this.actualHeight;
            let scTop = this.buffers.scrollTop;
            top = cursor.getBoundingClientRect().y + scTop + height;
            let vtop = this._vspacer.getBoundingClientRect().y + scTop;
            if (top > vtop) {
                vtop -= this.actualHeight;
                if (vtop >= 0)
                    this.buffers.scrollTop = vtop;
                if (top > this._pauseLimit)
                    this._pauseLimit = top;
                this._downContinue(-1, paging);
                return;
            }
        }
        for (;;) {
            --iline;
            line = this.lineStarts[iline];
            lineBlock = line.getAttribute("line") === null;
            if (iline == 0)
                break;
            let lineEnd = this.lineEnds[iline];
            if (lineEnd == null)
                lineEnd = line;
            let lineBot = this.buffers.scrollTop - this._topOffset
                + lineEnd.getBoundingClientRect().bottom;
            if (lineBot <= top)
                break;
        }
    }
    if (lineBlock)
        line.insertBefore(this.viewCaretNode, line.firstChild);
    else
        line.parentNode.insertBefore(this.viewCaretNode, line.nextSibling);
    this._disableScrollOnOutput = true;
    this.scrollToCaret(null, force);
};

Terminal.prototype._scrollPage = function(count) {
    var amount = count * this.availHeight;
    if (count > 0)
        amount -= this.charHeight;
    else if (count < 0)
        amount += this.charHeight;
    this._pageScroll(amount, true);
}

Terminal.prototype._scrollLine = function(count) {
    this._pageScroll(count * this.charHeight, true);
}

Terminal.prototype._pageTop = function() {
    this.buffers.scrollTop = 0;
}

Terminal.prototype._pageBottom = function() {
    let target = this._vspacer.offsetTop - this.availHeight;
    if (target < 0)
        target = 0;
    if (target - this.buffers.scrollTop <= 1
        && this._currentlyPagingOrPaused()) {
        this._pauseLimit = -1;
        this._pauseContinue();
        return;
    }
    this.buffers.scrollTop = target;
}

Terminal.prototype._enterPaging = function(pause = true) {
    let cl = this.topNode.classList;
    cl.add("focusmode");
    if (pause) {
        cl.add("paused");
    } else {
        cl.remove("paused");
    }
    this._numericArgument = null;
    this._pagingMode = pause ? 2 : 1;
    this._displayInputModeWithTimeout(this._modeInfo("P"));

    let sel = document.getSelection();
    if (sel.focusNode == null) {
        let before = this._caretNode;
        let parent = before.parentNode;
        if (! parent) {
            this._fixOutputPosition();
            before = this.outputBefore;
            parent = this.outputContainer;
        }
        parent.insertBefore(this.viewCaretNode, before);
        sel.collapse(this.viewCaretNode, 0);
        this.adjustFocusCaretStyle();
    } else {
        this._updateSelected();
    }
}


Terminal.prototype._exitPaging = function() {
    let cl = this.topNode.classList;
    cl.remove("focusmode");
    cl.remove("paused");
    if (! this.isLineEditing())
        this.setMarkMode(false);
    let focusCaret = this.viewCaretNode;
    if (focusCaret && focusCaret.parentNode)
        focusCaret.parentNode.removeChild(focusCaret);
    this._pagingMode = 0;
    this._displayInputModeWithTimeout(this._modeInfo("P"));
}

DomTerm.setAutoPaging = function(mode, dt = DomTerm.focusedTerm) {
    if (! DomTerm.dispatchTerminalMessage("auto-paging", mode) && dt)
        dt._autoPaging = mode == "toggle" ? ! dt._autoPaging
        : mode == "on" || mode == "true";
}

Terminal.prototype.pageKeyHandler = function(keyName) {
    return DomTerm.handleKey(DomTerm.pagingKeymap, this, keyName);
};

/*
Terminal.prototype._togglePaging = function() {
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

Terminal.prototype._pauseNeeded = function() {
    return (this._pagingMode > 1 || this._autoPaging || this._autoPagingTemporary)
        && this._pauseLimit >= 0
        && this._vspacer.offsetTop + this.charHeight > this._pauseLimit;
};

Terminal.prototype.editorUpdateRemote = function() {
    let input = this._inputLine;
    if (input && input.textBefore === undefined) {
        let r = new Range();
        r.selectNodeContents(input);
        let localText = r.toString();
        r.setStartBefore(this._caretNode);
        let localAfter = r.toString();
        input.textBefore = localText.substring(0, localText.length-localAfter.length);
        input.textAfter = localAfter;
    }
};

Terminal.prototype.editorAddLine = function() {
    if (this.scrollOnKeystroke)
        this._enableScroll();
    if (this._inputLine == null) {
        this._removeInputLine();
        var inputNode = this._createSpanNode("editing");
        inputNode.setAttribute("std", "input");
        this._removeCaret();
        if (this.outputBefore==this._caretNode)
            this.outputBefore = this.outputBefore.nextSibling;
        inputNode.appendChild(this._caretNode);
        this.insertNode(inputNode);
        this._caretNode.useEditCaretStyle = true;
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
    this.editorUpdateRemote();
    if (! this._clientPtyEcho
        && (this._clientWantsEditing != 0 || this._clientPtyExtProc == 0))
        this._inputLine.classList.add("noecho");
}

Terminal.prototype.numericArgumentGet = function(def = 1) {
    let s = this._numericArgument;
    if (s == null)
       return def;
    if (s == "-")
        s = "-1";
    this._numericArgument = null;
    this._updatePagerInfo();
    return Number(s);
}

/** Move COUNT lines down (or up if COUNT is negative).
 * Return number of lines we aren't able to do.
 */
Terminal.prototype.editorMoveLines = function(backwards, count, extend = false) {
    if (count == 0)
        return 0;
    let delta1 = backwards ? -1 : 1;
    let goalColumn = this.sstate.goalColumn;
    let save = this._pushToCaret(this._pagingMode);
    let oldColumn = this.getCursorColumn();
    let oldLine = this.getAbsCursorLine();
    if (this._pagingMode) {
        let todo = 0;
        let startBefore = this.outputBefore;
        let startContainer = this.outputContainer;
        let column = oldColumn;
        if (goalColumn && goalColumn > column)
            column = goalColumn;
        let line = backwards ? oldLine - count : oldLine + count;
        if (line < 0) {
            todo = -line;
            line = 0;
        } else if (line >= this.lineStarts.length) {
            todo = line - (this.lineStarts.length - 1);
            line = this.lineStarts.length - 1;
        }
        this.moveToAbs(line, column, false);
        function posToRangeEnd(outputBefore, outputContainer) {
            let r = new Range();
            if (typeof outputBefore == "number")
                r.setEnd(outputContainer, outputBefore);
            else if (outputBefore)
                r.setEndBefore(outputBefore);
            else
                r.selectNodeContents(outputContainer);
            return r;
        }
        let r = posToRangeEnd(this.outputBefore, this.outputContainer);
        let sel = window.getSelection();
        // Same logic as editorMoveStartOrEndBuffer
        if (extend) {
            let anchorNode, anchorOffset;
            if (sel.anchorNode == null) {
                let ra = posToRangeEnd(startBefore, startContainer);
                anchorNode = ra.endContainer;
                anchorOffset = ra.endOffset;
            } else {
                anchorNode = sel.anchorNode;
                anchorOffset = sel.anchorOffset;
            }
            sel.setBaseAndExtent(anchorNode, anchorOffset,
                                 r.endContainer, r.endOffset);
        } else
            sel.collapse(r.endContainer, r.endOffset);
        this._popFromCaret(save);
        this.sstate.goalColumn = column;
        return todo;
    }
    this.editorAddLine();
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
    parent.normalize();
    this.editMove(- column, "move", "char", "line");
    this.sstate.goalColumn = column;
    this._restoreCaret();
    return count <= 0 ? 0 : count;
}

Terminal.prototype.editorMoveToRangeStart = function(range) {
    this._removeCaret();
    if (range.startContainer == this._caretNode)
        return;
    try {
        let p = this._caretNode.parentNode;
        if (p) p.removeChild(this._caretNode);
        range.insertNode(this._caretNode);
        this.scrollToCaret(this._caretNode);
    } catch(e) {
        console.log("caught "+e);
    }
    if (this._inputLine && this._inputLine.parentNode)
        this._inputLine.normalize();
    window.getSelection().collapse(this._caretNode, 0);
    this._restoreCaret();
}

Terminal.prototype.editorMoveStartOrEndBuffer = function(toEnd, action="move") {
    let r = new Range();
    if (toEnd) {
        const nlines = this.lineEnds.length;
        const last = this.lineEnds[nlines-1];
        if (last)
            r.setEndBefore(last);
        else
            r.selectNodeContents(this.lineStarts[nlines-1]);
    } else
        r.setEnd(this.lineStarts[0], 0);
    let sel = window.getSelection();
    if (action == "move") {
        sel.collapse(r.endContainer, r.endOffset);
    } else if (sel.anchorNode !== null) {
        sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset,
                             r.endContainer, r.endOffset);
    } else {
        // slow but simple
        this.extendSelection(toEnd ? -Infinity : Infinity, "char", "buffer");
    }
}

Terminal.prototype.editorMoveStartOrEndLine = function(toEnd, extend=false) {
    let count = toEnd ? -Infinity : Infinity;
    if (extend)
        this.extendSelection(count, "char", "line");
    else
        this.editMovePosition(count, "char", "line");
    this.sstate.goalColumn = undefined; // FIXME add other places
}

Terminal.prototype.editorMoveStartOrEndInput = function(toEnd, action="move") {
    let count = toEnd ? -Infinity : Infinity;
    if (action==="extend")
        this.extendSelection(count, "char", "input");
    else
        this.editMovePosition(count, "char", "input");
    this.sstate.goalColumn = undefined; // FIXME add other places
}

Terminal.prototype._updateAutomaticPrompts = function() {
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
    let defaultPattern = ! pattern;
    if (defaultPattern) {
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
            let oldPrompt = next.getAttribute("content-value");
            let w = this.strWidthInContext(newPrompt, start);
            if (oldPrompt)
                w -= this.strWidthInContext(oldPrompt, start);
            if (start._widthColumns  !== undefined)
                start._widthColumns += w;
            next.lineno = lineno; // MAYBE use attribute (better save/restore)
            next.defaultPattern = defaultPattern;
            next.setAttribute("content-value", newPrompt);
        }
    }
}

// True if this is an internal line break in multi-line _inputLine.
// False if the linebreak immediately before or after the _inputLine.
// Unspecified for other linebreaks.
Terminal.prototype._newlineInInputLine = function(i) {
    // OR:
    // let start = this.lineStarts[i];
    // return start.nodeName == "SPAN" &&  start != this._inputLine.nextSibling
    return i > 0 && i < this.lineStarts.length
        && this.lineStarts[i] == this.lineEnds[i-1]
        && this._isAnAncestor(this.lineStarts[i], this._inputLine);
}

Terminal.prototype.editorContinueInput = function() {
    let outputParent = this.outputContainer.parentNode; // command-output
    let previous = outputParent.previousSibling; // domterm-pre input-line
    let previousInputLineNode = previous.lastChild;
    let previousInputStd = previousInputLineNode.previousSibling;
    let editSpan =  this._createSpanNode("editing");
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
    editSpan.textBefore = "";
    editSpan.textAfter = "";
    let lastLineNo = this.lineStarts.length-1;
    this.lineStarts[lastLineNo] = this.lineEnds[lastLineNo-1]
    let prompt = this._createSpanNode();
    prompt.setAttribute("std", "prompt");
    prompt.stayOut = true;
    editSpan.appendChild(prompt);
    this.editorMoveStartOrEndInput(true);
    this.outputContainer=editSpan.parentNode;
    this.outputBefore=editSpan;
    this.resetCursorCache()
    this._inputLine.startLineNumber = this.getAbsCursorLine();
    this._updateAutomaticPrompts();
}

Terminal.prototype.editorInsertString = function(str, inserting=true) {
    this.editorAddLine();
    this._showPassword();
    if (! this._miniBuffer)
        this._updateLinebreaksStart(this.getAbsCursorLine(), true);
    for (;;) {
        let nl = str.indexOf('\n');
        let str1 = nl < 0 ? str : str.substring(0, nl);
        if (str1 != "") {
            let saved = this._pushToCaret();
            if (inserting) {
                this.insertRawOutput(str1);
                if (! this._miniBuffer) {
                    let line = this.lineStarts[this.getAbsCursorLine()];
                    line._widthColumns += this.strWidthInContext(str1, line);
                }
            } else {
                let saveInserting = this.sstate.insertMode;
                this.sstate.insertMode = inserting;
                this.insertSimpleOutput(str1, 0, str.length);
                this.sstate.insertMode = saveInserting;
            }
            this._popFromCaret(saved);
        }
        if (nl < 0)
            break;
        let saved = this._pushToCaret();
        let newline = this._createLineNode("hard", "\n");
        let lineno = this.getAbsCursorLine();
        this._insertIntoLines(newline, lineno);
        this.insertNode(newline);
        let prompt = this._createSpanNode();
        prompt.setAttribute("std", "prompt");
        prompt.stayOut = true;
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

Terminal.prototype.editorDeleteRange = function(range, toClipboard,
                                               linesCount = -1) {
    let str = range.toString();
    if (toClipboard)
        DomTerm.valueToClipboard({text: str,
                                  html: Terminal._rangeAsHTML(range)});
    let hadCaret = this._caretNode && this._caretNode.parentNode;
    range.deleteContents();
    if (hadCaret && ! this._caretNode.parentNode)
        range.insertNode(this._caretNode);
    range.commonAncestorContainer.normalize();
    let lineNum = this.getAbsCursorLine();
    this._unbreakLines(lineNum, true, null);
    let line = this.lineStarts[lineNum];
    line._widthColumns -= this.strWidthInContext(str, line);
    if (linesCount != 0)
        this._restoreLineTables(line, lineNum, true);
    this._updateLinebreaksStart(lineNum, true);
}

DomTerm.editorNonWordChar = function(ch) {
    return " \t\n\r!\"#$%&'()*+,-./:;<=>?@[\\]^_{|}".indexOf(ch) >= 0;
}

/** Scan through a Range.
 * If backwards is false: scan forwards, starting from range start;
 * stop at or before range end; update range end if stopped earlier.
 * If backwards is true: scan backwards, starting from range end;
 * stop at or before range start; update range start if stopped earlier.
 * (I.e. Change end/start position of range if backwards is false/true.)
 *
 * state: various options and counters:
 * state.todo: Infinity, or maximum number of units
 * state.unit: "char", "word", "line"
 * state.stopAt: one of "", "line" (stop before moving to different hard line),
 *   "visible-line" (stop before moving to different screen line),
 *   "input" (line-edit input area), or "buffer".
 * state.linesCount: increment for each newline
 * state.wrapText: function called on each text node
 * state.lineHandler: handler for non-stopping lines.
 */
Terminal.scanInRange = function(range, backwards, state) {
    let unit = state.unit;
    let doWords = unit == "word";
    let stopAt = state.stopAt;
    let wordCharSeen = false;
    let firstNode = backwards ? range.endContainer : range.startContainer;
    let lastNode = backwards ? range.startContainer : range.endContainer;
    let skipFirst;
    if (firstNode instanceof CharacterData)
        skipFirst = 0;
    else if (backwards)
        skipFirst = 1 + firstNode.childNodes.length - range.endOffset;
    else
        skipFirst = 1 + range.startOffset;
    /*
    let lastNonSkip = lastNode instanceof CharacterData ? 1
        : backwards ? lastNode.childNodes.length - range.startOffset
        : range.endOffset;
    */
    let lastOffset = backwards ?  range.startOffset : range.endOffset;
    let stopNode = null;
    if (! (lastNode instanceof CharacterData)) {
        let lastChildren = lastNode.childNodes;
        // possibly undefined if at start/beginning of container
        stopNode = lastChildren[backwards ? lastOffset-1 : lastOffset];
    }
    function elementExit(node) {
        if (state.elementExit)
            (state.elementExit) (node);
        return node === lastNode ? null : false;
    }
    function blockAfterLine(line) {
        function f(n) {
            let ch = n.firstChild;
            return n !== line && ch !== null
                && (Terminal.isNormalBlock(ch) || n);
            /*
            if (n == line || ch == null)
                return false;
            if (! Terminal.isNormalBlock(ch))
                return n;
            return true;
            */
        }
        let n = Terminal._forEachElementIn(range.commonAncestorContainer,
                                           f, false, false, line);
        return n && range.isPointInRange(n, 0) ? n : null;
    }
    function fun(node) {
        if (skipFirst > 0) {
            skipFirst--;
            return node == firstNode;
        }
        if (node === stopNode)
            return null;
        /*
        if (node.parentNode == lastNode) {
            if (lastNonSkip == 0)
                return null;
            lastNonSkip--;
        }
        */
        if (! (node instanceof Text)) {
            if (node.nodeName == "SPAN" && node.getAttribute("std") == "caret")
                return ! node.classList.contains("focus-caret");
            if (node.nodeName == "SPAN"
                && node.getAttribute("line") != null) {
                let stopped = false;
                if (stopAt == "visible-line")
                    stopped = true;
                else if (node.textContent == "")
                    return false;
                else if (stopAt == "line")
                    stopped = true;
                state.linesCount++;
                if (stopped) {
                    state.todo = 0;
                } else if (doWords) {
                    if (wordCharSeen)
                        state.todo--;
                    wordCharSeen = false;
                } else
                    state.todo--;
                if (state.todo == 0) {
                    if (backwards == stopped) {
                        let next = node.nextSibling;
                        if (next instanceof Element
                            && next.getAttribute("std") == "prompt")
                            node = next;
                    }
                    if (backwards) {
                        if (stopped) {
                            let next = blockAfterLine(node);
                            if (next)
                                range.setStart(next, 0);
                            else
                                range.setStartAfter(node);
                        }
                        else
                            range.setStartBefore(node);
                    } else {
                        if (stopped)
                            range.setEndBefore(node);
                        else {
                            let next = blockAfterLine(node);
                            if (next)
                                range.setEnd(next, 0);
                            else
                                range.setEndAfter(node);
                            //return false;
                        }
                    }
                    return null;
                }
                return state.lineHandler ? state.lineHandler(node) : false;
            }
            return true;
        }
        // else: node instanceof Text
        if (unit == "line")
            return false;
        var data = node.data;
        let dlen = data.length;
        let istart = backwards ? dlen : 0;
        if (node == firstNode)
            istart = backwards ? range.endOffset : range.startOffset;
        let dend = node !== lastNode ? (backwards ? 0 : dlen)
            : (backwards ? range.startOffset : dlen = range.endOffset);
        let index = istart;
        for (;; ) {
            if (state.wrapText && (state.todo == 0 || index == dend)) {
                if (backwards)
                    state.wrapText(node, index, istart);
                else
                    state.wrapText(node, istart, index);
            }
            if (state.todo == 0) {
                if (backwards)
                    range.setStart(node, index);
                else
                    range.setEnd(node, index);
                return null;
            }
            if (index == dend)
                return node == lastNode ? null : false;
            let i0 = index;
            let i1 = backwards ? --index : index++;
            // Optimization: skip character processing if Infinity
            if (state.todo < Infinity) {
                let c = data.charCodeAt(i1);
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
                        state.todo++;
                    }
                    wordCharSeen = ! sep;
                }
                state.todo--;
            }
        }
        return false;
    }
    Terminal._forEachElementIn(range.commonAncestorContainer, fun,
                               true, backwards, firstNode, elementExit);
}

Terminal.prototype.deleteSelected = function(toClipboard) {
    let input = this.isLineEditing() ? this._inputLine
        : this._getOuterInputArea();
    if (input == null)
        return;
    if (! this.isLineEditing()) {
        //this._editPendingInput(forwards, true, count);
        //if (toClipboard) ...;
        //return;
    }
    let sel = document.getSelection();
    let text = "",  html = "";
    for (let i = sel.rangeCount; --i >= 0; ) {
        let r = new Range();
        r.selectNodeContents(input);
        let sr = sel.getRangeAt(i);
        if (r.comparePoint(sr.startContainer, sr.startOffset) >= 0)
            r.setStart(sr.startContainer, sr.startOffset);
        if (r.comparePoint(sr.endContainer, sr.endOffset) <= 0)
            r.setEnd(sr.endContainer, sr.endOffset);
        let rstring = r.toString();
        if (toClipboard) {
            text += rstring;
            html += Terminal._rangeAsHTML(r);
        }
        if (this.isLineEditingOrMinibuffer())
            this.editorDeleteRange(r, false);
        else {
            let forwards = sr.endContainer === sel.anchorNode
                && sr.endOffset === sel.anchorOffset;
            let count = rstring.length;
            this._editPendingInput(forwards, true, Infinity, r);
            this.processInputCharacters(this.keyNameToChars(forwards ? "Delete" : "Backspace").repeat(count));
        }
    }
    if (toClipboard)
        DomTerm.valueToClipboard({text: text, html: html });
    this._clearSelection();
}

Terminal.prototype.editorRestrictedRange = function(restrictToInputLine) {
    let range = document.createRange();
    if (restrictToInputLine) {
        range.selectNodeContents(this._inputLine);
    } else {
        let firstBuf = DomTerm._currentBufferNode(this, 0);
        range.setStartBefore(firstBuf);
        range.setEndAfter(this.initial);
    }
    return range;
}

/** Do an edit operation, such as move, extend selection, or delete.
 * unit: "char", "word"
 * action: one of "move" (move caret), "move-focus" (move selection's focus),
 * "extend", "extend-focus", "delete", or "kill" (cut to clipboard).
 * stopAt: one of "", "line" (stop before moving to different hard line),
 * or "visible-line" (stop before moving to different screen line),
 * "input" (line-edit input area), or "buffer".
 */
Terminal.prototype.editMove = function(count, action, unit,
                                       stopAt=undefined) {
    if (stopAt === undefined)
        stopAt = this.shouldMoveFocus() ? "buffer" : "input";
    this.sstate.goalColumn = undefined;
    let doDelete = action == "delete" || action == "kill";
    let backwards = count > 0;
    let todo = backwards ? count : -count;
    let dt = this;
    let wordCharSeen = false; //
    let range;
    let linesCount = 0;

    let sel = document.getSelection();
    let useSelection = ! sel.isCollapsed
        && (! this._miniBuffer
            || (this._isAnAncestor(sel.focusNode, this._miniBuffer)
                && this._isAnAncestor(sel.anchorNode, this._miniBuffer)));
    if (useSelection && doDelete) {
        this.deleteSelected(action=="kill");
        if (this._pagingMode == 0)
            sel.removeAllRanges();
    } else {
        if (useSelection && action == "move")
            this._clearSelection();
        this._removeCaret();
        range = this.editorRestrictedRange(stopAt!=="buffer"
                                           && this._inputLine);
        let anchorNode, anchorOffset;
        if (action == "move" || sel.anchorNode === null || this._miniBuffer) {
            let caret = (this.viewCaretNode && this.viewCaretNode.parentNode
                         && (action == "move-focus" || action == "extend-focus"))
                ? this.viewCaretNode
                : this._caretNode;
            anchorNode = caret;
            anchorOffset = 0;
            if (backwards)
                range.setEndBefore(caret);
            else
                range.setStartAfter(caret);
        } else {
            // "move-focus" and valid anchorNode
            anchorNode = sel.anchorNode
            anchorOffset = sel.anchorOffset;
            if (backwards)
                range.setEnd(sel.focusNode, sel.focusOffset);
            else
                range.setStart(sel.focusNode, sel.focusOffset);
        }
        let scanState = { linesCount: 0, todo: todo, unit: unit, stopAt: stopAt };
        Terminal.scanInRange(range, backwards, scanState);
        linesCount = scanState.linesCount;
        todo = scanState.todo;
        if (doDelete) {
            this.editorDeleteRange(range, action == "kill", linesCount);
            if (linesCount > 0)
                this._updateAutomaticPrompts();
            this._restoreCaret();
        } else if (action == "extend" || action == "extend-focus") {
            if (backwards)
                sel.setBaseAndExtent(anchorNode, anchorOffset,
                                     range.startContainer, range.startOffset);
            else
                sel.setBaseAndExtent(anchorNode, anchorOffset,
                                     range.endContainer, range.endOffset);
        } else {
            if (! backwards)
                range.collapse();
            if (action !== "move-focus")
                dt.editorMoveToRangeStart(range);
            else
                sel.collapse(range.startContainer, range.startOffset);
        }
    }
    return todo;
}

Terminal.prototype.shouldMoveFocus = function() {
    return this._pagingMode > 0 && ! this._miniBuffer;
}

// Move caret or focus-caret depending on context.
Terminal.prototype.editMovePosition = function(count, unit, stopAt=undefined) {
    let action = this.shouldMoveFocus() ? "move-focus" : "move";
    this.editMove(count, action, unit, stopAt);
}

Terminal.prototype.extendSelection = function(count, unit, stopAt=undefined) {
    this._didExtend = true;
    return this.editMove(count,  this.shouldMoveFocus() ? "extend-focus" : "extend", unit, stopAt);
}

Terminal.prototype._lastDigit = function(str) {
    for (var j = str.length; --j >= 0; ) {
        var d = str.charCodeAt(j);
        if (d >= 48 && d <= 57)
            return j+1;
    }
    return -1;
}

Terminal.prototype._getIntegerBefore = function(str, last) {
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
Terminal.prototype._continuationPrompt = function(pattern, lineno, width) {
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
Terminal.prototype.promptPatternFromInitial = function(initialPrompt) {
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
Terminal.prototype._showSelection = function() {
    let sel = document.getSelection();
    if (sel.anchorNode == null)
        return "sel[no-ranges]";
    let r = new Range();
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    let r1 = r.toString();
    let r1len = r1.length;
    if (r1len > 20)
        r1 = r1.substring(r1len-20);
    r1 = JSON.stringify(r1);
    r.setEnd(sel.focusNode, sel.focusOffset);
    let r2 = r.toString();
    let r2len = r2.length;
    if (r2len > 20)
        r2 = r2.substring(r2len-20);
    r2 = JSON.stringify(r2);
    //let aa=sel.anchorNode instanceof Text ? "text["+sel.anchorNode.data+"]"
    //: "element["+sel.anchorNode.tagName+"."+sel.anchorNode.getAttribute("class")+"]";
    let aa = Terminal._nodeToHtml(sel.anchorNode,this);
    let ff=sel.focusNode instanceof Text ? "text["+sel.focusNode.data+"]"
        : "element["+sel.focusNode.tagName+"."+sel.focusNode.getAttribute("class")+"]";
    return "secl[anchor:"+aa+",aoff:"+sel.anchorOffset+",to-anchor:"+r1+(sel.isCollapsed?",":(",focus:"+ff+",to-focus:"+r2))+" col:"+sel.isCollapsed+"]";
}
*/

/** Runs in DomTerm sub-window. */
function _muxModeInfo(dt) {
    return "(MUX mode)";
}

/** Runs in DomTerm sub-window. */
Terminal.prototype.enterMuxMode = function() {
    this._showingMuxInfo = DomTerm.addInfoDisplay("window (MUX) mode", this._showingMuxInfo, this);
    this._muxMode = true;
    this._updatePagerInfo();
}

/** Runs in DomTerm sub-window. */
Terminal.prototype.exitMuxMode = function() {
    DomTerm.removeInfoDisplay(this._showingMuxInfo, this);
    this._muxMode = false;
    this._updatePagerInfo();
}

/** Runs in DomTerm sub-window. */
Terminal.prototype._muxKeyHandler = function(event, key, press) {
    if (DomTerm.verbosity >= 2)
        this.log("mux-key key:"+key+" event:"+event+" press:"+press);
    let paneOp = 0;
    switch (key) {
    case 13: // Enter
        DomTerm.newPane(1, null, this);
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 16: /*Shift*/
    case 17: /*Control*/
    case 18: /*Alt*/
        return;
    case 37 /*Left*/:
        if (paneOp == 0) paneOp = 10;
        /* fall through */
    case 38 /*Up*/:
        if (paneOp == 0) paneOp = 12;
        /* fall through */
    case 39 /*Right*/:
        if (paneOp == 0) paneOp = 11;
        /* fall through */
    case 40 /*Down*/:
        if (paneOp == 0) paneOp = 13;
        if (event.ctrlKey) {
            DomTerm.newPane(paneOp);
            this.exitMuxMode();
            event.preventDefault();
        } else {
            DomTerm.selectNextPane(key==39||key==40);
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 68:
        if (event.ctrlKey && window._dt_toggleDeveloperTools) {
            window._dt_toggleDeveloperTools();
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 84: // T
        if (! event.ctrlKey) {
            DomTerm.newPane(2);
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 87: // W
        if (event.shiftKey) {
            let wholeStack = event.ctrlKey;
            if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
                DomTerm.sendParentMessage("popout-window", wholeStack);
            } else {
                var pane = DomTerm.domTermToLayoutItem(this);
                DomTermLayout.popoutWindow(wholeStack ? pane.parent : pane, this);
            }
        } else {
            // FIXME make new window
        }
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 100: // 'd'
        if (! event.ctrlKey) {
            this.detachSession();
            this.exitMuxMode();
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        break;
    default:
    case 27: // Escape
        this.exitMuxMode();
        event.preventDefault();
        break;
    }
}

// Only if !useIFrame
DomTerm.domTermToLayoutItem = function(dt) {
    if (! DomTermLayout.manager)
        return null;
    var node = dt.topNode;
    if (node instanceof Element && node.classList.contains("lm_content"))
        return DomTermLayout._elementToLayoutItem(node);
    else
        return null;
}

window.DTerminal = Terminal;

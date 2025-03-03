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
import * as Settings from './settings-manager.js';
import { addInfoDisplay } from './domterm-overlays.js';
import * as UnicodeProperties from './unicode/uc-properties.js';
import * as DtUtil from './domterm-utils.js';

class Terminal extends PaneInfo {
  constructor(windowNumber, kind) {
    super(windowNumber, kind);

    this.paneInfo = this;
    // Options/state that should be saved/restored on detach/attach.
    // Restricted to properties that are JSON-serializable,
    // and that need to be saved/restored on detach/attach.
    var sstate = {};

    this.sstate = sstate;

    this.clearVisibleState();

    this._updateTimer = null;

    // It might make sense to only allocate sstate if kind !== "top".
    // However, that seems likely to might break something.
    // Instead !sstyle.styleMap can be used to detect a "top" pseudo-Terminal.
    if (this.kind !== "top") {
        // A stack of currently active "style" strings.
        sstate.styleMap = new Map();
    }
    sstate.windowTitle = null; // As set by xterm escape sequence
    sstate.iconName = null;
    sstate.lastWorkingPath = null;
    sstate.sessionNumber = -1;
    //sstate.paneNumber = -1;

    this.windowForSessionNumber = -1;
    
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

    this.darkMode = false; // from settings
    this.sstate.reverseVideo = false; // from DECSCNM escape sequence

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

    // Number of vertical pixels available.
    this.availHeight = 0;
    // Number of horizontal pixels available.
    // Doesn't count scrollbar or rightMarginWidth.
    this.availWidth = 0;

    this.charWidth = 1;  // Width of a character in pixels
    this.charHeight = 1; // Height of a character in pixels
    this._computedZoom = 1.0; // DEPRECATED

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

    /** True if requested to be in the middle of a wide character. */
    this.outputInWide = false;

    // this is a small (0 or 1 characters) span for the text caret.
    // When line-editing this is the *input* caret;
    // output is inserted at (outputContainer,outputBefore)
    this._caretNode = null;
    // When line-editing this is the actively edited line,
    // that has not yet been sent to the process.
    // In this case _caretNode is required to be within _inputLine.
    this._inputLine = null;

    let vcaretNode = document.createElement("div");
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
    this.viewCaretMarkNode = vcaretNode1;
    let vcaretNode2 = document.createElement("div");
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
    // 0 - old single-byte; 1005 (UTF8-EXT); 1006 (SGR_EXT); 1015 (URXVT_EXT); 1016 (SGR-Pixels)
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
  }
  get charWidthI() { return Math.round(this.charWidth); }
  get charHeightI() { return Math.round(this.charHeight); }

  setupElements(topNode) {
    this.terminal = this;
    let name = topNode == null ? null : topNode.getAttribute("id");
    if (name == null)
        name = "domterm";
    // A unique name for this DomTerm instance. NOT USED?
    // Generated names have the format:  name + "__" + something.
    this.name = name; // deprecated

    if (! DomTerm.mainTerm)
        DomTerm.mainTerm = this;

    const dt = this;
    if (topNode) {
        this.topNode = topNode;
        topNode.spellcheck = false;
        topNode.terminal = this;
        if (this.kind == 'view-saved') {
            // re-purpose the top-level node from the saved file.
            const buffers = topNode.firstElementChild;
            this.buffers = buffers;
            buffers.removeAttribute("class");
            buffers.removeAttribute("style");
            const topClass = topNode.classList;
            topClass.add("domterm-saved-session");
            for (const aname of ["saved-version", "saved-time"]) {
                const at = buffers.getAttribute(aname);
                if (at) {
                    topNode.setAttribute(aname, at);
                    buffers.removeAttribute(aname);
                }
            }
        } else {
            this.buffers = document.createElement("div");
        }
        this.buffers.classList.add("dt-buffers");
        this.buffers.contentEditable = false;
        topNode.appendChild(this.buffers);
        this.buffers.addEventListener('scroll',
                                      (e) => {
                                          dt.requestUpdateDisplay();
                                          const adjust = dt.buffers._adjustFloatingTableHead;
                                          if (adjust)
                                              adjust();
                                      },
                                      false);
        this._topOffset = 0; // placeholder - set in measureWindow
        if (this.kind == 'view-saved') {
            let buffers = document.getElementsByClassName('dt-buffer');
            this.initial = buffers[buffers.length-1];
        } else {
            this.initial = this._createBuffer(this._mainBufferName, "main only");
            this.initial._saveLastLine = 0;
            this.buffers.appendChild(this.initial);
        }
    }

    this._showHideEventHandler =
          function(evt) { dt._showHideHandler(evt); dt._clearSelection(); evt.preventDefault();};

    this.updateDeferLimit = 200;
    this._updateDisplay = function(time) {
        dt._lastUpdateDisplayTime = time;
        if (dt._deferUpdate) {
            if (dt._deferMax === undefined)
                dt._deferMax = time + dt.updateDeferLimit;
            if (time >= dt._deferMax)
                dt._deferMax = undefined;
            else {
                dt._deferUpdate = undefined;
                dt._updateTimer = requestAnimationFrame(dt._updateDisplay);
                return;
            }
        }
        dt._updateTimer = null;
        if (! dt.topNode)
            return;
        dt._restoreInputLine();
        dt._breakVisibleLines();
        dt._checkSpacer();
        // FIXME only if "scrollWanted"
        if (dt.viewCaretNode.parentNode === null)
            dt._scrollIfNeeded();
        else {
            dt.adjustFocusCaretStyle();
        }
        dt.setEditingLine(dt.isLineEditingMode()
                          ? dt._getOuterBlock(dt.outputContainer)
                          : null);
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
                && (ref = (curTarget.getAttribute("domterm-href")
                           || curTarget.getAttribute("href")))) {
                let infoHtml = '<span class="url">' + DtUtil.escapeText(ref) + '</span>';
                if (dt._linkNeedsCtrlClick(curTarget))
                    infoHtml += "<br/><i>(Ctrl+Click to open link)</i>";
                dt.hoverHandler(event, dt, curTarget,
                                (popDiv, element) => {
                                    popDiv.innerHTML = infoHtml;
                                });
            }
        };
    }

    setEditingLine(el) {
        if (el !== this._currentEditingLine) {
            if (this._currentEditingLine)
                this._currentEditingLine.classList.remove('dt-editing-line');
            if (el)
                el.classList.add('dt-editing-line');
            this._currentEditingLine = el;
        }
    }
    isLineEditingMode() {
        return (this._lineEditingMode + this._clientWantsEditing > 0
                // extproc turns off echo by the tty driver, which means we need
                // to simulate echo if the applications requests icanon+echo mode.
                // For simplicity in this case, ignore _lineEditingMode < 0..
                || (this._clientPtyExtProc + this._clientPtyEcho
                    + this._clientWantsEditing == 3)
                || this._composing > 0);
    }

    isLineEditing() {
        return this.isLineEditingMode() && ! this._currentlyPagingOrPaused();
    }

    updateColor(setting, value, context) {
        if (this.topNode)
            this.topNode.style.setProperty(setting.cssVariable, value);
    }

    updateCaretColor(caret, caretAccent, context) {
        const topStyle = this.topNode?.style;
        if (topStyle) {
            topStyle.setProperty("--caret-color", caret);
            topStyle.setProperty("--caret-accent-color", caretAccent);
        }
    }

    updateSelectionColor(foreground, background, inactive, context) {
        if (! this.topNode)
            return;
        const topStyle = this.topNode?.style;
        const list = [
            "--selection-foreground-color", foreground,
            "--selection-background-color", background,
            "--selection-inactive-color", inactive
        ];
        for (let i = 0; i < 6; i += 2) {
            const propname = list[i];
            const value = list[i+1];
            if (value)
                topStyle.setProperty(propname, value);
            else
                topStyle.removeProperty(propname);
        }
    }

    applicationCursorKeysMode() {
        return this.sstate.applicationCursorKeysMode;
    }

    isLineEditingOrMinibuffer() {
        return this.isLineEditing() || this._miniBuffer;
    }

    hasClipboardServer(mode) {
        const option = this.getOption("`server-for-clipboard", "");
        return `,${option},`.indexOf(`,${mode},`) >= 0;
    }

    getRemoteHostUser() {
        return this.paneInfo.termOptions["`remote-host-user"];
    }
    isRemoteSession() {
        return !!this.getRemoteHostUser();
    }

    isPrimaryWindow() { return this.windowForSessionNumber == 0; }
    isSecondaryWindow() { return this.windowForSessionNumber > 0; }

    unconfirmedMax() {
        return this.getOption("flow-confirm-every", 500);
    }

    caretStyle(editStyle = this._caretNode && this._caretNode.useEditCaretStyle) {
        return editStyle ? this.caretEditStyle : this.caretCharStyle;
    }

    showViewCaret(show = true) {
        if (show)
            this.buffers.insertBefore(this.viewCaretNode, null);
        else
            this.viewCaretNode.remove();
    }

    startBlinkTimer() {
        if (this._blinkHideTime == undefined)
            setBlinkRate(); // initialize to defaults
        // _blinkEnabled: undefined or 0 - no blinking elements;
        // 1 - blinking elements but blinking disabled (hideTime is 0);
        // 2 - active blinking
        if (this._blinkHideTime === 0)
            this._blinkEnabled = 1;
        else if (this._blinkEnabled !== 2) {
            let hiding = false;
            let flip = () => {
                let hideTime = this._blinkHideTime;
                if (hiding) {
                    this.topNode.classList.remove('blinking-hide');
                    if (! this.buffers.querySelector('.term-style[text-decoration~="blink"]')) {
                        this._blinkEnabled = 0;
                        return;
                    }
                }
                if (hideTime === 0) {
                    this._blinkEnabled = 1;
                } else if (hiding) {
                    hiding = false;
                    setTimeout(flip, this._blinkShowTime);
                } else {
                    this.topNode.classList.add('blinking-hide');
                    hiding = true;
                    setTimeout(flip, hideTime);
                }
            }
            setTimeout(flip, this._blinkShowTimw);
            this._blinkEnabled = 2;
        }
    }

    setBlinkRate(str = "") {
        let m;
        if ((m = str.match(/^ *([.0-9]+) +([.0-9]+) *$/))
            || (m = str.match(/^ *([.0-9]+) *, *([.0-9]+) *$/))) {
            this._blinkHideTime = 1000 * m[1];
            this._blinkShowTime = 1000 * m[2];
        } else if ((m = str.match(/^ *([.0-9]+) *$/))) {
            this._blinkHideTime = this._blinkShowTime = 1000 * m[1];
        } else { // default values
            this._blinkShowTime = 700;
            this._blinkHideTime = 300;
        }
        if (this._blinkHideTime !== 0 && this._blinkEnabled == 1)
            this.startBlinkTimer();
    }

    setOptionsWithResponse(settings, options) {
        let errmsg = '';
        const context = new Settings.EvalContext(this);
        context.reportError = (context, message) => {
            if (errmsg)
                errmsg += '\n';
            errmsg += `setting '${context?.curSetting?.name}': ${message}`;
        };
        try {
            this.setOptions(options.settings, context);
        } catch (e) {
            errmsg = "caught "+e;
        }
        let r = {};
        if (errmsg)
            r.err = errmsg;
        this.sendResponse(r, options);
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
        this.detachResizeSensor();
        if (DomTerm.focusedTerm == this)
            DomTerm.focusedTerm = null;
        if (DomTerm.focusedPane == this)
            DomTerm.focusedPane = null;

        if (this.kind === "xterminal")
            return;

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
        // The <div class='dt-buffer'> that is either the main or the
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
        this._deferredLinebreaksStart = -1;
        this.sstate.styleMap = null;
        // A span whose style is "correct" for sstate.styleMap.
        this._currentStyleSpan = null;
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
        this.close(true, false);
    }

    //maybeExtendInput() { }

    startPrompt(options = []) {
        let ln = this.outputContainer;
        if (DtUtil.isNormalBlock(ln))
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
        this.outputContainer.keep_if_empty;
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

    _clearPromptMode() {
        this.sstate.inPromptMode = false;
        const stdElement = Terminal._getStdElement(this.outputContainer);
        if (stdElement && stdElement.getAttribute("std") == "prompt")
            delete stdElement.keep_if_empty;
    }

    /* Start of user input, following any prompt.
     */
    startInput(stayInInputMode, options=[]) {
        this.sstate.stayInInputMode = stayInInputMode;
        this._clearPromptMode();
        this.sstate.inInputMode = true;
        this._pushStdMode(null);
        this._fixOutputPosition();
        let ln = this.outputContainer;
        if (DtUtil.isNormalBlock(ln))
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
                    let pr = DtUtil.forEachElementIn(plin, fun, false, true);
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
            let prev = cur === null ? parent.lastChild : cur.previousSibling;
            cur = cur == null ? parent.nextSibling
                : cur.previousSibling == null ? parent
                : this._splitNode(parent, cur);
            parent = parent.parentNode;
            if (prev instanceof Element && prev.getAttribute("line") !== null
                && ! DtUtil.isBlockNode(prev.parentNode)) {
                parent.insertBefore(prev, cur);
            }
        }
        this.outputBefore = cur;
        this.outputContainer = parent;
        return cur;
    }

    startOutput() {
        this.sstate.inInputMode = false;
        this._clearPromptMode();
        const group = this.currentCommandGroup();
        if (group && group.lastChild instanceof Element
            && group.lastChild.classList.contains("input-line")
            && group.lastChild.contains(this.outputContainer)) {
            const lineNo = this.getAbsCursorLine();
            let cur = this._splitParents(group);
            cur.classList.remove("input-line", "dt-editing-line");
            cur.removeAttribute("click-move");
            let commandOutput = document.createElement("div");
            commandOutput.setAttribute("class", "command-output");
            group.insertBefore(commandOutput, cur);
            commandOutput.appendChild(cur);
            DtUtil.forEachElementIn(cur,
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
            cur._widthMode = Terminal._WIDTH_MODE_NORMAL;
            cur._widthColumns = 0;
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

    disableMouseMode(disable) {
        const oldMode = this.sstate.mouseMode;
        this.setMouseMode(disable ? 0 : oldMode);
        this.sstate.mouseMode = oldMode;
    }

    /** Concatenate _deferredBytes with slice of bytes.
     * Return concatenated array.  Clears _deferredBytes. */
    withDeferredBytes(bytes, beginIndex = 0, endIndex = bytes.length) {
        if (this._deferredBytes) {
            let dlen = this._deferredBytes.length;
            let narr = new Uint8Array(dlen + (endIndex - beginIndex));
            narr.set(this._deferredBytes);
            narr.set(bytes.subarray(beginIndex, endIndex), dlen);
            this._deferredBytes = undefined;
            return narr;
        } else {
            return bytes.slice(beginIndex, endIndex);
        }
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

Terminal.defaultXtRendererType = 'dom'; // 'dom' or 'webgl'

window.addEventListener("unload", DomTerm.closeAll);

// Handle selection
DomTerm.EDITING_SELECTION = 1;
// Handle keypress, optionally-shifted left/right-arrow, home/end locally.
//DomTerm.EDITING_LOCAL_BASIC = 2;
// Handle Emacs key sequences locally.
// Handle history locally
// Handle shift of motion keys to extend selection

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

DomTerm.isFrameParent = function() {
    return DomTerm.useIFrame && ! DomTerm.isInIFrame()
        && DomTerm._oldFocusedContent;
}

Terminal.prototype.saveWindowContents = function() {
    this._restoreInputLine();
    var rcount = this.parser._savedControlState ? this.parser._savedControlState.receivedCount
        : this._receivedCount;
    var data =
        rcount
        + ',{"sstate":'+DtUtil.toJson(this.sstate);
    data += ',"rows":'+this.numRows+',"columns":'+this.numColumns;
    data += ', "html":'
        + JSON.stringify(this.getAsHTML(false))
        +'}';
    this.reportEvent("WINDOW-CONTENTS", data);
}

DomTerm.closeFromEof = function(dt) {
    dt.close();
}

// detach is true, false, or "export"
Terminal.prototype.close = function(detach = false, fromLayoutEvent = false) {
    const wnumber = this.number;
    this.historySave();
    if (detach) {
        if (detach !== "export") // handled by "dragExported" handler
            this.reportEvent("DETACH", "");
        if (this._detachSaveNeeded == 1) {
            this._detachSaveNeeded = 2;
        }
    }
    if (this._detachSaveNeeded == 2) {
        this.saveWindowContents();
        this._detachSaveNeeded = 1;
    }
    this.reportEvent("CLOSE-WINDOW");
    this._closeSent = true;
    this.clearVisibleState();
    this.inputFollowsOutput = false;

    if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("layout-close", fromLayoutEvent);
    else if (DomTerm._layout && wnumber >= 0) {
        setTimeout(() => {
            // Note this.windowNumber might have changed from wnumber
            DomTerm._layout.layoutClose(this.topNode,
                                        wnumber,
                                        fromLayoutEvent);
       }, 1);
    } else if (! fromLayoutEvent)
        DomTerm.windowClose();
};

Terminal.prototype.startCommandGroup = function(parentKey, pushing=0, options=[]) {
    const container = this.outputContainer;
    let commandGroup;
    if (this.sstate.inInputMode) {
        for (let p = container; p instanceof Element; p = p.parentNode) {
            const cl = p.classList;
            if (cl.contains("command-output"))
                break;
            if (cl.contains("command-group")) {
                commandGroup = p;
                break;
            }
        }
    }
    if (! commandGroup) {
        commandGroup = document.createElement("div");
        commandGroup.setAttribute("class", "command-group");
        if (parentKey)
            commandGroup.setAttribute(pushing > 0 ? "group-id" : "group-parent-id", parentKey);
        container.parentNode.insertBefore(commandGroup, container);
        commandGroup.appendChild(container);
    }
    this.sstate.inInputMode = false;
    this.sstate.inPromptMode = false;
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
    if (oldGroup && ! oldGroup.contains(this.outputContainer)) {
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
            preNode._breakState = Terminal._BREAKS_UNMEASURED;
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
        DtUtil.forEachElementIn(oldGroup, checkLine);

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
            this.reportEvent("LOG", JSON.stringify(str), false);
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
    this.previousKeyName = undefined;
    if (! this._rulerNode || DomTerm.handlingJsMenu() || ! this.topNode)
        return;  // skip if _initializeDomTerm not called
    let classList = this.topNode.classList;
    let wasFocused = classList.contains("domterm-active");
    const changeFocused = wasFocused !== (focused > 0);
    if (focused > 0) {
        classList.add("domterm-active");
        DomTerm.displayWindowTitle(this.getTitleInfo());
        if (! this.isSavedSession()) {
            this.reportEvent("FOCUSED", ""); // to server
            if (changeFocused)
                DomTerm.inputModeChanged(this, this.getInputMode());
        }
        if (focused == 2)
            this.maybeFocus();
    } else if (this.topNode) {
        classList.remove("domterm-active");
    }
    if (this.sstate.sendFocus)
        this.processResponseCharacters(focused ? "\x1b[I" : "\x1b[O");
}

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
        if (! DomTerm.useIFrame && current !== null)
            current.setFocused(0);
        if (term != null)
            term.setFocused(1);
    }
    DomTerm.focusedTerm = term;
}

DomTerm.showFocusedTerm = function(term) {
    let m = DomTerm._layout;
    if (m) {
        let item = term ? term.layoutItem : null;
        DomTerm.showFocusedPane(term ? term.topNode : null);
        m.manager.focusComponent(item);
    }
}

// Convenience function for Theia package
Terminal.prototype.doFocus = function() {
    DomTerm.setFocus(this);
    this.maybeFocus();
}

Terminal.prototype.maybeFocus = function(force = false) {
    let goal = this.topNode;
    const active = document.activeElement;
    if ((force || this.hasFocus())
        && active !== goal && active != this._caretNode) {
        let sel = document.getSelection();
        let fNode = sel.focusNode;
        let fOffset = sel.focusOffset;
        let aNode = sel.anchorNode;
        let aOffset = sel.anchorOffset;
        let collapsed = sel.isCollapsed;
        goal.focus({preventScroll: true});
        if (sel.focusNode !== fNode) {
            if (fNode === null)
                sel.removeAllRanges();
            else
                sel.setBaseAndExtent(aNode, aOffset, fNode, fOffset);
        }
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

// Possible values for _breakState field of elements in lineStarts table.
Terminal._BREAKS_UNMEASURED = 0;
Terminal._BREAKS_MEASURED = 1;
Terminal._BREAKS_VALID = 2;
Terminal._BREAKS_MEASURED_VALID = 3;

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
        const old = this.sstate.bottomHeight;
        if (this.sstate.bottomHeight < 0.5)
            needed = -1;
        else {
            needed = this.actualHeight - this._vspacer.offsetTop
                + (this.initial.noScrollTop ? 0 : this._homeOffset(this.homeLine));
            if (needed < 0.5)
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
    if (this.sstate.bottomHeight !== needed) {
        if (needed > 0) {
            vspacer.style.height = needed + "px";
        } else if (this.sstate.bottomHeight > 0) {
            vspacer.style.height = "";
        }
        this.sstate.bottomHeight = needed;
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

Terminal.prototype.wcwidthInContext = function(codePoint, context) {
    let preferWide = false; // potentially depends on context
    return UnicodeProperties.infoToWidth(UnicodeProperties.getInfo(codePoint),
                                         preferWide);
}

Terminal.prototype.strWidthInContext = function(str, context) {
    let preferWide = false; // potentially depends on context
    return UnicodeProperties.strWidth(str, preferWide);
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

Terminal._endsWithSpaces = function(str, w) {
    var len = str.length;
    if (w < 0)
        w = len;
    else if (len < w)
        return false;
    for (let i = w; i > 0; i--)
        if (str.charCodeAt(len-i) != 32)
            return false;
    return true;
};

Terminal.prototype.tabToNextStop = function(isTabChar) {
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
    if (isTabChar && this._fixOutputPosition()
        && (prev = this.outputBefore.previousSibling) instanceof Text
        && Terminal._endsWithSpaces(prev.data,  w)) {
        let span = this._createSpanNode(null,
                                        prev.data.substring(prev.length-w));
        span.setAttribute('dt-tab', nextStop);
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
            let dpos = 0; // position in node.data
            let data = cur.data;
            let dlen = data.length;
            let nl = data.indexOf('\n');
            if (nl < 0)
                nl = dlen;
            let segments = [];
            DtUtil.getGraphemeSegments (data, 0, nl, segments, null);
            const nsegments = segments ? segments.length : 0;
            const parent = cur.parentNode;
            for (let isegment = 0; isegment < nsegments; isegment++) {
                const seg = segments[isegment];
                if (seg instanceof Element) {
                    const rest = dpos === 0 ? cur
                          : dpos === nl ? null : cur.splitText(dpos);
                    let glen = seg.firstChild.length;
                    parent.insertBefore(seg, rest);
                    if (rest) {
                        if (cur != rest)
                            dpos = 0;
                        rest.deleteData(dpos, glen);
                        cur = rest;
                    }
                } else {
                    dpos += seg.length;
                }
            }
            if (nl < dlen) {
                const rest = data.substr(nl + 1);
                //const following = dpos === 0 ? cur : dpos == dlen ? null : cur.splitText(dpos);
                let white = window.getComputedStyle(cur.parentNode)['white-space'];
                let line = white=='normal' || white=='nowrap'
                    ? this._createSpanNode('non-pre-newline', ' ')
                    : this._createLineNode("hard", "\n");
                parent.insertBefore(line, cur.nextSibling);
                if (nl === 0)
                    parent.removeChild(cur);
                else
                    cur.deleteData(nl, dlen - nl);
                if (rest)
                    parent.insertBefore(document.createTextNode(rest),
                                        line.nextSibling);
                cur = line; // continue with Element case below
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
            else if (DtUtil.isBlockTag(tag)) {
                var hasData = false;
                var prevWasBlock = false;
                // Check to see if cur has any non-block children:
                for (var ch = cur.firstChild; ch != null; ) {
                    var next = ch.nextSibling;
                    let isBlock = false;
                    if (ch instanceof Text) {
                        if (prevWasBlock && ch.data.trim() == "") {
                            cur.removeChild(ch);
                            ch = next;
                            continue;
                        }
                        hasData = true;
                    } else if (ch instanceof Element && ! hasData) {
                        isBlock = DtUtil.isBlockNode(ch);
                        if (! isBlock && !ch.classList.contains("focus-area"))
                            hasData = true;
                    }
                    ch = next;
                    prevWasBlock = isBlock;
                }
                if (hasData) {
                    start = cur;
                    startBlock = cur;
                    start._widthMode = Terminal._WIDTH_MODE_NORMAL;
                    start._breakState = Terminal._BREAKS_UNMEASURED;
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
                const cls =  cur.classList;
                if (line) {
                    descend = false;
                    cur.outerPprintGroup = this._currentPprintGroup;
                    //this.currentCursorLine = startLine;
                    //this.currentCursorColumn = -1;
                    if (line == "hard" || line == "br"
                        || cur.getAttribute('breaking') === 'yes') {
                        if (startLine > 0 && this.lineStarts[startLine] == null)
                            this.lineStarts[startLine] = this.lineEnds[startLine-1];
                        this.lineEnds[startLine] = cur;
                        startLine++;
                        start = cur;
                        seenDataThisLine = false;
                    } else {
                        start._widthMode = Terminal._WIDTH_MODE_PPRINT_SEEN;
                        start._breakState = Terminal._BREAKS_UNMEASURED;
                    }
                } else {
                    if (cls.contains("dt-cluster")
                        || cls.contains("focus-area")) {
                        descend = false;
                    } else if (cls.contains("pprint-group")) {
                        start._breakState = Terminal._BREAKS_UNMEASURED;
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
        styleMap: new Map(this.sstate.styleMap),
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

Terminal.prototype.curBufferStartLine = function() {
    if (this.initial._saveLastLine < 0) {
        const saveBefore = this.outputBefore;
        const saveContainer = this.outputContainer;
        const saveLine = this.currentAbsLine;
        const saveColumn = this.currentCursorColumn;
        this.resetCursorCache();
        this.outputContainer = this.initial.firstChild;
        this.outputBefore = this.outputContainer.firstChild;
        this.initial._saveLastLine = this.getAbsCursorLine();
        this.outputBefore = saveBefore;
        this.outputContainer = saveContainer;
        this.currentAbsLine = saveLine;
        this.currentCursorColumn = saveColumn;
    }
    return this.initial._saveLastLine;
}

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
        this.sstate.styleMap = saved.styleMap;
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
        if (! DtUtil.isBlockTag(tag)
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
    lineStart._breakState = Terminal._BREAKS_UNMEASURED;
    lineStart._widthColumns = 0;
    this.lineStarts[lineCount] = lineStart;
    this._updateHomeLine();
    return parent;
}
Terminal.prototype._updateHomeLine = function() {
    let homeLine = this.homeLine;
    let lineCount = this.lineStarts.length;
    if (lineCount > homeLine + this.numRows) {
        homeLine = lineCount - this.numRows;
        this.homeLine = homeLine;
        this._adjustSpacer(-1);
    }
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
                    if (DtUtil.isBlockNode(lastParent))
                        break;
                    var p = lastParent.parentNode;
                    if (p == this.initial)
                        break;
                    lastParent = p;
                }
                if (lastParent.parentNode == currentGroup) {
                    let lastClass = lastParent.classList;
                    if (this.sstate.stayInInputMode
                        /*(lastClass.contains("input-line")
                         && this.sstate.stayInInputMode)
                        || lastClass.contains("diagnostic")*/) {
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
                let cls = current.classList;
                if (valueAttr !== null) {
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
                } else if (cls.contains("dt-cluster")) {
                    if (cls.contains("w1")) {
                        column += 1;
                    } else if (column + 2 <= goalColumn) {
                        column += 2;
                    } else { //if (column + 1 == goalColumn) {
                        column += 1;
                        this.outputInWide = true;
                        break;
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
                        && current.previousSibling.contains(this.outputContainer)) {
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
                    const oldbg = this._getBackgroundColor(lineEnd);
                    if (current && current.previousSibling instanceof Text
                       && ! oldbg)
                        current.previousSibling.appendData(str);
                    else {
                        let t = document.createTextNode(str);
                        if (oldbg) {
                            let w = this._createSpanNode();
                            this._setBackgroundColor(w, oldbg);
                            w.appendChild(t);
                            t = w;
                        }
                        parent.insertBefore(t, current);
                    }
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
                    if (DtUtil.isObjectElement(current)) {
                        if (! current.classList.contains("dt-background"))
                            column += 1;
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
                if (DtUtil.isBlockNode(current))
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
    if (current instanceof Element
        && current.classList.contains("dt-background"))
        current = current.nextSibling;
    this.outputContainer = parent;
    this.outputBefore = current;
    this.currentAbsLine = absLine;
    this.currentCursorColumn = column;
};

Terminal.prototype._followingText = function(cur, backwards = false,
                                             lineOk = false) {
    function check(node) {
        if (node == cur)
            return true;
        if (node.tagName == "SPAN" && node.getAttribute("line"))
            return lineOk ? node : null;
        if (node.tagName == "SPAN" && node.getAttribute("content-value"))
            return node;
        if (node instanceof Text)
            return node;
        return true;
    }
    return DtUtil.forEachElementIn(this._getOuterBlock(cur, true), check,
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
            caretNode.removeAttribute("value");
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
        this._removeCaretNode();
    }
}
Terminal.prototype._removeCaretNode = function() {
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
    DtUtil.forEachTextIn(el, replace);
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
                    let anchorNode = sel.anchorNode;
                    let anchorOffset = sel.anchorOffset;
                    let focusNode = sel.focusNode;
                    let focusOffset = sel.focusOffset;
                    let fixAnchor = anchorNode === text;
                    let fixFocus = focusNode === text;

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
                        if (fixAnchor || fixFocus) {
                            if (fixFocus) {
                                if (focusOffset == 0)
                                    focusNode = this._caretNode.firstChild;
                                else
                                    focusOffset -= sz;
                            }
                            if (fixAnchor) {
                                if (anchorOffset == 0)
                                    anchorNode = this._caretNode.firstChild;
                                else
                                    anchorOffset -= sz;
                            }
                            sel.setBaseAndExtent(anchorNode, anchorOffset,
                                                 focusNode, focusOffset);
                        }
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
                this.lineStarts[lineno]._breakState = Terminal._BREAKS_UNMEASURED;
                // Takes time proportional to the number of lines in _inputLine
                // times lines below the input.  Both are likely to be small.
                DtUtil.forEachElementIn(inputLine,
                                        (el) => {
                                            let ln = el.nodeName === "SPAN"
                                                && el.getAttribute("line");
                                            if (ln === 'hard'
                                                || (ln && el.getAttribute('breaking')==='yes')) {
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
Terminal.prototype.cursorLineStart = function(deltaLines, kind=undefined) {
    let curLine = this.getAbsCursorLine();
    if (deltaLines == 1 && curLine == this.lineStarts.length-1) {
        if (this.sstate.styleMap.size == 0)
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
        let newBlock;
        if (kind)
            newBlock = false;
        else {
            newBlock = DtUtil.isBlockNode(parent);
            if (! newBlock) {
                let endLine = this.lineEnds[curLine];
                for (; parent  ;) {
                    if (next === this._caretNode && next)
                        next = next.nextSibling;
                    if (next != null && next != endLine) {
                        newBlock = true;
                        break;
                    }
                    if (DtUtil.isBlockNode(parent))
                        break;
                    next = parent.nextSibling;
                    parent = parent.parentNode;
                }
            }
        }
        if (! newBlock) {
            this._appendLine(kind || "hard",
                             this.outputContainer, null, this.outputBefore);
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
        this.scrollForwardInRegion(1);
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

/** Add a style property specifier to the sstate.styleMap.
 * However, if the new specifier "cancels" an existing specifier,
 * just remove the old one.
 * @param styleName style property name (for example "text-decoration").
 * @param styleValue style property value string (for example "underline"),
 *     or null to indicate the default value.
 */
Terminal.prototype._pushStyle = function(styleName, styleValue) {
    if (styleValue)
        this.sstate.styleMap.set(styleName, styleValue);
    else
        this.sstate.styleMap.delete(styleName);
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
        let prev = nxt ? nxt.previousSibling : this.outputContainer.lastChild;
        if (nxt instanceof Element && nxt.getAttribute("std") === styleValue) {
            // This can happen after implicit startPrompt (OSC 133 A)
            // followed by explicit startPrompt (PSC 133 P).
            this.outputContainer = nxt;
            this.outputBefore = nxt.firstChild;
        } else if (prev instanceof Element
                   && prev.getAttribute("std") === styleValue) {
            this.outputContainer = prev;
            this.outputBefore = null;
        } else {
            stdElement = this._createSpanNode();
            stdElement.setAttribute("std", styleValue);
            this._pushIntoElement(stdElement);
        }
    }
};

Terminal.prototype._clearStyle = function() {
    this.sstate.styleMap.clear();
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
 * The desired style is a specified by the sstate.styleMap.
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
    if (! inStyleSpan && this.sstate.styleMap.get("background-color") == null) {
        var block = this._getOuterBlock(parentSpan);
        if (block && this._getBackgroundColor(block) != null) {
            needBackground = true;
        }
    }
    if (this.sstate.styleMap.size == 0 && ! inStyleSpan && ! needBackground) {
        this._currentStyleSpan = parentSpan;
        return;
    }
    this._removeInputLine();
    if (inStyleSpan) {
        this._popStyleSpan();
    }
    if (this.sstate.styleMap.size != 0 || needBackground) {
        let styleSpan = this._createSpanNode("term-style");
        var styleAttr = null;
        var decoration = null;
        var stdKind = null;
        var reverse = false;
        var fgcolor = null;
        var bgcolor = null;
        for (var key of this.sstate.styleMap.keys()) {
            var value = this.sstate.styleMap.get(key);
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
                this.startBlinkTimer();
                decoration = decoration ? decoration + " blink" : "blink";
                break;
            case "text-line-through":
                decoration = decoration ? decoration + " line-through" : "line-through";
                break;
            case "font-weight":
            case "font-style":
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
        preNode._breakState = Terminal._BREAKS_UNMEASURED;
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
        } else if (end != null && cur.contains(end)) {
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
        if (! this.topNode.contains(start)) {
            start = end;
            for (;;) {
                if (DtUtil.isNormalBlock(start))
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

Terminal.prototype.scrollForwardInRegion = function(count) {
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
    return this.sstate.styleMap.get("background-color");
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

Terminal.prototype._createSpanNode = function(cls=null, txt=null) { // DEPRECATED
    return DtUtil.createSpanNode(cls, txt);
};

Terminal.prototype.makeId = function(local) {
    return this.name + "__" + local;
};

Terminal.prototype._createLineNode = function(kind, text=kind=="hard"||kind=="soft"?"\n":"") {
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
            && node.classList.contains('dt-buffer')
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
            && bnode.classList.contains('dt-buffer'))
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
    bufNode._saveLastLine = nextLine;
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
    const lastLine = this.curBufferStartLine();
    this.initial = bufPrev;
    this.lineStarts.length = lastLine;
    this.lineEnds.length = lastLine;
    let homeNode = null;
    let homeOffset = -1;
    DtUtil.forEachElementIn(this.initial,
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

Terminal.prototype._getOuterBlock = function(node, stopIfInputLine=false) {
    for (var n = node; n; n = n.parentNode) {
        if ((stopIfInputLine && n == this._inputLine)
            || DtUtil.isBlockNode(n))
            return n;
    }
    return null;
}

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
                        windowNumber: dt.topNode.windowNumber,
                        clientX: e.clientX / dt._computedZoom,
                        clientY: e.clientY / dt._computedZoom};
            let link = DomTerm._isInElement(e.target, "A");
            if (link) {
                opts.contextType = "A";
                opts.href = link.getAttribute("domterm-href") || link.getAttribute("href");
                let range = document.createRange();
                range.selectNodeContents(link);
                opts.contentValue = {
                    text: Terminal._rangeAsText(range),
                    html: Terminal._rangeAsHTML(range)
                };
            }
            DomTerm._contextOptions = opts;
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
    }
    document.addEventListener("selectionchange", dt._selectionchangeListener);

    if (! DomTerm._userStyleSet)
        this.loadStyleSheet("user", "");


    this.attachResizeSensor();

    var vspacer = document.createElement("div");
    vspacer.setAttribute("class", "domterm-spacer");
    this.sstate.bottomHeight = 0;
    this.buffers.appendChild(vspacer);
    this._vspacer = vspacer;
};

/*
Terminal.prototype._findHomeLine = function(bufNode) {
    DtUtil.forEachElementIn(bufNode,
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
        line = this.curBufferStartLine();
    }
    var minHome = this.lineStarts.length - this.numRows;
    return line <= minHome ? minHome
        : line < this.lineStarts.length ? line : home_line;
}

DomTerm._checkStyleResize = function(dt) { dt.resizeHandler(); }

Terminal.prototype.resizeHandler = function() {
    if (! this._rulerNode)
        return;
    var dt = this;
    // FIXME we want the resize-sensor to be a child of helperNode
    if (DomTerm.verbosity > 0)
        dt.log("resizeHandler called "+dt.name);
    let oldWidth = dt.availWidth;
    let oldHeight = this.actualHeight;
    let oldCharWidth = this.charWidth;
    dt.measureWindow();
    let minColumns = dt.getOption("terminal.minimum-width", 5);
    let minRows = 2;
    if (this.numColumns < minColumns || this.numRows < minRows)
        this.forceWidthInColumns(Math.max(minColumns, this.numColumns),
                                 Math.max(minRows, this.numRows));
    if (dt.availWidth !== oldWidth || this.actualHeight !== oldHeight)
        dt._displaySizeInfoWithTimeout();

    if (dt.availWidth != oldWidth && dt.availWidth > 0) {
        dt._removeCaret();
        let mask = oldCharWidth !== this.charWidth ? 0
            : ~Terminal._BREAKS_VALID;
        for (let i = dt.lineStarts.length; --i >= 0; ) {
            dt.lineStarts[i]._breakState &= mask;
        }
        const buffers = dt.getAllBuffers();
        for (let i = buffers.length; --i > 0; ) {
            buffers[i]._saveLastLine = -1;
        }
        if (dt._displayInfoWidget) {
            DomTerm._positionInfoWidget(dt._displayInfoWidget, dt);
        }
        DomTerm.resizeTitlebar();
        dt.requestUpdateDisplay();
    }
}

Terminal.prototype.attachResizeSensor = function() {
    this._resizeObserver = new ResizeObserver(entries => {
        this.resizeHandler();
    });
    this._resizeObserver.observe(this.contentElement);
}

Terminal.prototype.detachResizeSensor = function() {
    if (this._resizeObserver)
        this._resizeObserver.unobserve(this.contentElement);
    this._resizeObserver = undefined;
};

Terminal.prototype._displayInputModeWithTimeout = function(text) {
    text = '<span>'+text+'</span>';
    this._modeInfoDiv = this._displayInfoWithTimeout(text, this._modeInfoDiv);
};

Terminal.prototype._displayInfoWithTimeout = function(text, div = null, timeout = Terminal.INFO_TIMEOUT) {
    var dt = this;
    if (div == null)
        div = document.createElement("div");
    div = addInfoDisplay(text, div, dt);
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

/** Generic handler for bringing up a popup panel on "hover".
 * Call this by "mouseenter" handler.
 */
Terminal.prototype.hoverHandler = function(event, dt, element, setInfoAction) {
    let enterDelay = 400;
    let leaveDelay = 200;
    let leaveTimer = null;
    let mouseInPopup = false;
    if (element._hoverPending)
        return;
    if (element._popup) {
        if (leaveTimer)
            clearTimeout(leaveTimer);
        leaveTimer = null;
        return;
    }

    const remove = () => {
        if (element._popup && element._popup.remove)
            element._popup.remove(element._popup);
        element._popup = undefined;
        element.removeEventListener("mouseleave",
                                      leaveHandler, false);
        element._hoverPending = undefined;
    };

    const hoverEnter = (element, setInfoAction) => {
        let popup = document.createElement("div");
        popup.classList.add("dt-context-popup");
        setInfoAction(popup, element);
        this.topNode.appendChild(popup);
        element._popup = popup;
        popup.style.left = '0px';
        popup.style.top = '0px';
        const popBox = popup.getBoundingClientRect();
        const elBox = element.getBoundingClientRect();
        const elBoxes = element.getClientRects();
        const nBoxes = elBoxes.length;
        if (nBoxes > 0) {
            let margin = 8;
            let closest = elBoxes[0];
            let top = closest.top - popBox.height;
            // Position popup above element, if there is room.
            if (top >= margin)
                popup.style.top = (top - margin) + "px";
            else {
                closest = elBoxes[nBoxes-1];
                popup.style.top = (elBox.bottom + margin) + "px";
            }
            let elLeft = closest.left;
            let elRight = closest.right;
            let hGoal = 0.5 * (elLeft + elRight);
            let left = hGoal - 0.5 * popBox.width;
            let wwidth = this.buffers.offsetWidth - 2;
            if (left < 0)
                left = 0;
            else if (left + popBox.width > wwidth)
                left = wwidth - popBox.width;
            popup.style.left = left + 'px';
        }
        if (! element.style.outline) {
            element._added_outline = true;
            let bcolor = window.getComputedStyle(popup)['border-color'];
            element.style.outline = "thin solid "+bcolor;
            popup.remove = (popup) => {
                this.topNode.removeChild(popup);
                if (element._added_outline) {
                    element.style.outline = "";
                    element._added_outline = undefined;
                };
            }
        }
        popup.addEventListener("mouseenter",
                               () => {
                                   if (leaveTimer)
                                       clearTimeout(leaveTimer);
                                   leaveTimer = null;
                                   mouseInPopup = true;
                               }, false);
        popup.addEventListener("mouseleave",
                               () => {
                                   if (leaveTimer)
                                       clearTimeout(leaveTimer);
                                   leaveTimer = setTimeout(remove, leaveDelay);
                                   mouseInPopup = false;
                               }, false);
        element._hoverPending = undefined;
    }

    let enterTimer = setTimeout(hoverEnter, enterDelay, element, setInfoAction);
    element._hoverPending = 1;
    let leaveHandler = (e) => {
        clearTimeout(enterTimer);
        leaveTimer = setTimeout(remove, leaveDelay);
    };
    element.addEventListener("mouseleave",
                             leaveHandler, false);
}

Terminal.prototype._sizeInfoText = function() {
    // Might be nicer to keep displaying the size-info while
    // button-1 is pressed. However, that seems a bit tricky.
    let text = ""+this.numColumns+"\xD7"+this.numRows
        +" ("+DtUtil.toFixed(this.availWidth, 2)+"\xD7"
        +DtUtil.toFixed(this.availHeight, 2);
    if (this.sstate.forcedSize) {
        text += "px, actual:"
            + DtUtil.toFixed(this.topNode.clientWidth -  this.rightMarginWidth)
            + "\xD7" + DtUtil.toFixed(this.actualHeight);
    }
    text += "px)";
    /* // This is confusing as it doesn't reliably include scale (zoom).
    let ratio = window.devicePixelRatio;
    if (ratio)
    text += " "+(ratio*100.0).toFixed(0)+"%";
    */
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
    let top = dt.contentElement;
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
        else if (dt.topNode && dt.topNode.windowNumber >= 0) {
            contents += " window:"+dt.topNode.windowNumber;
            if (dt.isSecondaryWindow())
                contents += " (secondary)";
            else if (dt.isPrimaryWindow())
                contents += " (primary)";
        }
        contents += "<br/>";
        contents += dt._modeInfo() + "<br/>Size: " + dt._sizeInfoText();
        if (dt.sstate.lastWorkingPath)
            contents += "<br/>Last path: <code>"+ DtUtil.escapeText(dt.sstate.lastWorkingPath)+"</code>";
        contents += "</span>";
        dt._showingMiscInfo = addInfoDisplay(contents, dt._showingMiscInfo, dt);
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
    let div = addInfoDisplay(contents, null, this);
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
                         { attributes: false, childList: true, characterData: true, subtree: true });
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
    this.sstate.doLinkify = true;

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
            if (dt.isLineEditingOrMinibuffer()) {
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
                                 if (dt._ignorePaste)
                                     return;
                                 dt.pasteText(e.clipboardData.getData("text"));
                                 e.preventDefault(); },
                                 false);
    topNode.addEventListener("click",
                             function(e) { DomTerm.clickLink(e, dt); },
                             false);
    /*
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
    */
};

Terminal.prototype._createBuffer = function(idName, bufName) {
    var bufNode = document.createElement("div");
    bufNode.setAttribute("id", idName);
    bufNode.setAttribute("buffer", bufName);
    bufNode.setAttribute("class", "dt-buffer");
    // Needed when composing (IME) on Chromium.
    // Otherwise the composition buffer may be displayed inside the
    // prompt string rather than the input area (specifically in _caretNode).
    this._addBlankLines(1, this.lineEnds.length, bufNode, null);
    bufNode._saveLastLine = -1;
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
    let ruler = this._rulerNode;
    if (! ruler)
        return;
    let topRect = this.buffers.getBoundingClientRect();
    if (topRect.width === 0 && topRect.height === 0)
        return;
    this.actualHeight = topRect.height;
    this._topOffset = topRect.y;
    if (DomTerm.verbosity >= 2)
        this.log("measureWindow "+this.name+" h:"+this.actualHeight+" forced:"+this.sstate.forcedSize);
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
        let buffers = document.getElementsByClassName("dt-buffer");
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
        this.log("wrapDummy width:"+this.rightMarginWidth+" top:"+this.name+"["+this.topNode.getAttribute("class")+"] clW:"+this.topNode.clientWidth+" clH:"+this.topNode.clientHeight+" top.offH:"+this.topNode.offsetHeight+" it.w:"+this.topNode.clientWidth+" it.h:"+this.topNode.clientHeight+" chW:"+this.charWidth+" chH:"+this.charHeight+" ht:"+availHeight+" rbox:"+rbox);
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
    const zoomTop = this.topNode || document.body;
    let computedZoom = window.getComputedStyle(zoomTop)['zoom']; // DEPRECATED
    this._computedZoom = Number(computedZoom);
    if (! this._computedZoom)
        this._computedZoom = 1.0;
};

Terminal.prototype._updateMiscOptions = function() {
    const topStyle = this.topNode.style;
    topStyle.setProperty("--char-width", this.charWidth+"px");
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
Terminal.prototype._clearSelection = function() {
    let sel = document.getSelection();
    let viewCaretNode = this.viewCaretNode;
    if (viewCaretNode && viewCaretNode.parentNode) {
        this.showViewCaret(false);
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
Terminal.prototype._updateSelected = function(fromMouseUp = false) {
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
        if (sel.focusNode !== null
            && this.buffers.contains(sel.focusNode)) {
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
            this.showViewCaret();
            this.scrollToCaret(this.viewCaretNode);
            this.requestUpdateDisplay();
        }
    }

    let moveCaret = false;
    let currentPreNode = null;       // current class="domterm-pre" element
    let targetPreNode = null;        // target class="domterm-pre" element
    let readlineForced = dt._altPressed;
    let moveOption = readlineForced ? "w" : null;
    if (dt._caretNode && dt._caretNode.parentNode !== null
        && fromMouseUp && sel.focusNode !== null
        // only moveCaret if (single non-drag) mouse-click and not in paging-mode
        && this._pagingMode == 0 && point) {
        if (readlineForced) {
            targetPreNode = dt._getOuterBlock(sel.focusNode);
            moveCaret = targetPreNode != null;
        } else if (dt._miniBuffer) {
            moveCaret = dt._miniBuffer.contains(sel.focusNode);
        } else {
            targetPreNode = dt._getOuterPre(sel.focusNode);
            currentPreNode = this._getOuterPre(this.outputContainer);
            if (targetPreNode != null && currentPreNode != null) {
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
                && targetFirst.contains(targetNode)) {
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
            if (dt.isLineEditing())
                dt._restoreCaret();
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
}
Terminal.prototype._mouseHandler = function(ev) {
    if (DomTerm.verbosity >= 2)
        this.log("mouse event "+ev.type+": "+ev+" t:"+this.topNode.id+" pageX:"+ev.pageX+" Y:"+ev.pageY+" mmode:"+this.sstate.mouseMode+" but:"+ev.button+" alt:"+ev.altKey);

    // Avoids clearing selection.  Helps on Chrome, at least.
    if (ev.type == "mousedown" && ev.button == 2)
        ev.preventDefault();
    this.previousKeyName = undefined;
    if (ev.button == 1 // middle-button should do "paste selection" on X11/Wayland
        && DomTerm.versions.userAgent.match(/X11/)) { // Also set for Wayland
        ev.preventDefault();
        this._ignorePaste = true;
        if (ev.type == "mousedown" && ! this.mouseReporting()
            && this.hasClipboardServer("selection-paste")) {
            this.reportEvent("REQUEST-SELECTION-TEXT", "");
            return;
        }
    }

    this._focusinLastEvent = false;
    this._altPressed = ev.altKey;
    let wasPressed = this._mouseButtonPressed;
    this._mouseButtonPressed = ev.type === "mousedown";

    // Get mouse coordinates relative to viewport.
    let xdelta = ev.pageX / this._computedZoom;
    let ydelta = ev.pageY / this._computedZoom;

    if (ev.type == "mouseup") {
        if (wasPressed)
            this._updateSelected(true);
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
        if (ev.button == 0 // check if in scrollbar
            && xdelta >= this.initial.getBoundingClientRect().right)
            this._usingScrollBar = true;
        this.setMarkMode(false);
        this._didExtend = ev.shiftKey;
        this.sstate.goalX = undefined;
        if (! DomTerm.useIFrame)
            DomTerm.setFocus(this, "S");
        if (ev.button !== 2)
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
    let buffer = this._getOuterPre(target, "dt-buffers");
    if (buffer == null || target == buffer) {
        return;
    }
    this.outputContainer = ev.target;
    this.outputBefore = this.outputContainer.firstChild;
    this.resetCursorCache();
    var row = this.getCursorLine();
    var col = this.getCursorColumn();
    this.currentCursorColumn = saveCol;
    this.currentAbsLine = saveLine;
    this.outputBefore = saveBefore;
    this.outputContainer = saveContainer;
    let targetBounds = target.getClientRects();
    if (targetBounds.length == 0)
        return;
    targetBounds = targetBounds[0];
    xdelta -= targetBounds.left;
    ydelta -= targetBounds.top;
    let encoding = this.sstate.mouseCoordEncoding;
    if (encoding === 1016) {
        col = xdelta; // ???
        row = ydelta;
    } else {
        col += Math.floor(xdelta / this.charWidth);
        row += Math.floor(ydelta / this.charHeight);
    }

    var mod = (ev.shiftKey?4:0) | (ev.metaKey?8:0) | (ev.ctrlKey?16:0);
    let bfinal = 77; // 'M'
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
        switch (encoding) {
        case 1006: case 1015: case 1016:
            bfinal = 109; // 'm'
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
        this.log("mouse event "+ev+" type:"+ev.type+" cl:"+ev.clientX+"/"+ev.clientY+" p:"+ev.pageX+"/"+ev.pageY+" row:"+row+" col:"+col+" button:"+button+" mode:"+this.sstate.mouseMode+" ext_coord:"+encoding);

    if (button < 0 || col < 0 || col >= this.numColumns
        || row < 0 || row >= this.numRows)
        return;

    let barray = new Uint8Array(50);
    barray[0] = 0x1b; barray[1] = 91; // '\x1b[' CSI
    let blen = 2;
    function encodeInteger(i) { // Add non-negative integer to barray
        if (i >= 10) {
            encodeInteger(i / 10);
            i %= 10;
        }
        barray[blen++] = 48+i;
    }
    function encodeButton(button) {
        var value = button;
        switch (encoding) {
        case 1005: // FIXME
        default:
            barray[blen++] = value+32;
            return;
        case 1015:
            value += 32;
            // fall through
        case 1006: // SGR
        case 1016: // SGR-Pixels
            encodeInteger(value);
            return;
        }
    }

    function encodeCoordinate(val, prependSeparator) {
        // Note val is 0-origin, to match xterm's EmitMousePosition
        switch (encoding) {
        case 1005:
            if (val >= 95) {
                val += 33;
                barray[blen++] = 0xC0 | ((val >> 6) & 0x1F);
                barray[blen++] = 0x80 | (val & 0x3F);
                return;
            }
        default:
            barray[blen++] = val == 255-32 ? 0 : val + 33;
            return;
        case 1006: case 1015: case 1016:
            if (prependSeparator)
                barray[blen++] = 59; // ';'
            encodeInteger(val+1);
            return;
        }
    }
    switch (encoding) {
    case 1006:
    case 1016:
        barray[blen++] = 60; // '<'
        break;
    case 1015: break;
    default:
        barray[blen++] = 77;
        bfinal = -1;
        break;
    }
    this.mouseRow = row;
    this.mouseCol = col;
    encodeButton(button);
    encodeCoordinate(col, true);
    encodeCoordinate(row, true);
    if (bfinal >= 0)
        barray[blen++] = bfinal;
    this.processResponseBytes(barray.subarray(0, blen));
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
        if (start.tagName == "SPAN" && start.classList.contains("tail-hider")) {
            start = start.parentNode;
            if (start.tagName == "SPAN" && start.getAttribute("line"))
                start = start.parentNode;
        }
        if (start.parentNode.getAttribute("std") == "prompt")
            start = start.parentNode;
        var node = start;
        for (;;) {
            var next = node.nextSibling;
            if (next == null) {
                var parent = node.parentNode;
                if (parent == start.parentNode && DtUtil.isBlockNode(parent))
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

Terminal.prototype.reportEvent = function(name, data = "",
                                          logIt = DomTerm.verbosity >= 2) {
    // Send 0xFD + name + ' ' + data + '\n'
    // where 0xFD is sent as a raw unencoded byte.
    // 0xFD cannot appear in a UTF-8 sequence
    let str = name + ' ' + data;
    let slen = str.length;
    if (logIt)
        this.log("reportEvent "+str);
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

Terminal.prototype.sendResponse = function(data, options) {
    if (options.id)
        data.id = options.id;
    let from_remote = options['from-ssh-remote'];
    if (from_remote)
        data['from-ssh-remote'] = from_remote;
    this.reportEvent("RESPONSE", JSON.stringify(data));
}

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
    let scanState = { linesCount: 0, todo: count, unit: "grapheme", stopAt: "", wrapText: wrapText };
    DtUtil.scanInRange(range, ! forwards, scanState);
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
    const sel = document.getSelection();
    if (sel.isCollapsed && this._caretNode.parentNode)
        sel.collapse(this._caretNode, 0);
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
    if (line > 0 && cur == this.lineEnds[line-1]) {
        cur = cur.nextSibling;
    }
    var col = 0;
    while (cur != goal || (goal == null && parent != goalParent)) {
        if (cur == null) {
            if (parent == null) {
                DomTerm.log("unexpected end in updateCursorCache");
                break;
            }
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
            } else if (DtUtil.isObjectElement(cur)) {
                if (cur == goalParent)
                    break;
                if (! cur.classList.contains("dt-background"))
                    col++;
                cur = cur.nextSibling;
                continue;
            } else if (tag == "P" || tag == "PRE" || tag == "DIV") {
                // FIXME handle line specially
            } else if (tag == "SPAN") {
                let cl = cur.classList;
                if (cl.contains("dt-cluster")) {
                    col += cl.contains("w2") ? 2 : 1;
                    cur = cur.nextSibling;
                    continue;
                }
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
    if (DtUtil.isSpanNode(input) && input.getAttribute("std")=="prompt")
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
    if (inputLine) {
        this._removeCaret();
        for (var child = inputLine.firstChild; child != null; ) {
            var next = child.nextSibling;
            inputLine.removeChild(child);
            child = next;
        }
        inputLine.appendChild(this._caretNode);
        this._removeInputFromLineTable();
        this._restoreCaret();
    }
    this.editorInsertString(str);
    this.maybeFocus();
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
        this.homeLine = this.curBufferStartLine();
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
        let dstart = this.curBufferStartLine();
        let dcount = lineFirst - dstart;
        this.deleteLinesIgnoreScroll(dcount, dstart);
        this.homeLine = lineFirst >= this.homeLine ? dstart
            : this.homeLine - dcount;
        saveLine -= dcount;
        break;
    default:
        var startLine = param == 0 ? saveLine : this.homeLine;
        if (param == 2 && this.usingAlternateScreenBuffer) {
            let bufferStart = this.curBufferStartLine();
            if (this.homeLine > bufferStart) {
                var saveHome = this.homeLine;
                this.homeLine = bufferStart;
                var homeAdjust = saveHome - this.homeLine;
                this.resetCursorCache();
                saveLine -= homeAdjust;
                startLine -= homeAdjust;
            }
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
        if (this.sstate.bottomHeight < 0)
            this.sstate.bottomHeight = 0;
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
        end._breakState = Terminal._BREAKS_UNMEASURED;
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
        if (DtUtil.isNormalBlock(parent)
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
            if (oldNextLine._breakState !== undefined) {
                oldNextLine._breakState &= ~Terminal._BREAKS_MEASURED;
                newBlock._breakState = oldNextLine._breakState;
            }
        }
        // otherwise we have a non-standard line
        // Regardless, do:
        lineEnd.setAttribute("line", "hard");
        lineEnd.removeAttribute("breaking");
        let oldMeasure = lineEnd.measureLeft;
        if (oldMeasure) {
            DtUtil.forEachElementIn(this._getOuterBlock(lineEnd),
                                    (el)=> {
                                        if (el.measureLeft
                                            && el.measureLeft >= oldMeasure)
                                            el.measureLeft -= oldMeasure;
                                    },
                                    false, false, lineEnd);
        }
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
        if (attr.specified && attr.name !== "id")
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
    let next;
    for (; current != lineEnd; current = next) {
        if (! parent)
            break; // Shouldn't happen
        next = current?.nextSibling;
        if (parent.firstChild == null && parent != this.initial) {
            if (parent != this._currentStyleSpan)
                this._currentStyleSpan = null;
            current = parent;
            parent = parent.parentNode;
            next = current.nextSibling;
            if (current.keep_if_empty)
                continue;
            if (current == this._currentStyleSpan)
                this._currentStyleSpan = null;
            if (current == this.outputContainer) {
                this.outputContainer = parent;
                previous = current.previousSibling;
            }
            parent.removeChild(current);
        }
        else if (todo <= 0)
            break;
        else if (current == null) {
            next = parent.nextSibling;
            parent = parent.parentNode;
        } else if (DtUtil.isObjectElement(current)) {
            if (! current.classList.contains("dt-background")) {
                parent.removeChild(current);
                todo--;
            }
        } else if (current instanceof Text
                   || (current instanceof Element
                       && (tvalue = current.getAttribute("content-value")) != null
                       && current.nodeName == "SPAN")) {
            if (current instanceof Text) {
                tvalue = current.textContent;
            }
            const length = tvalue.length;

            let i = 0;
            if (count < 0) {
                i = length;
            } else {
                i = this.strColumnToIndex(tvalue, todo, current.parentNode);
                todo = i < 0 ? -i : 0;
                i = i < 0 ? length : i;
            }

            if (i < length) {
                if (current instanceof Text)
                    current.deleteData(0, i);
                else
                    current.setAttribute("content-value", tvalue.substring(i));
                break;
            } else  {
                parent.removeChild(current);
            }
        } else if (current instanceof Element) {
            let cl = current.classList;
            if (cl.contains("dt-cluster")) {
                if (todo >= 0)
                    todo -= cl.contains("w2") ? 2 : 1;
                parent.removeChild(current);
            } else {
                parent = current;
                next = current.firstChild;
            }
        }
    }
    this._fixOutputPosition();
    this.outputBefore = previous != null ? previous.nextSibling
        : this.outputContainer.firstChild;
    let lineStart = this.lineStarts[lineNo];
    if (count < 0)
        lineStart._widthColumns = colNo;
    else if (lineStart._widthColumns !== undefined)
	lineStart._widthColumns -= count - todo;
    lineStart._breakState &= ~Terminal._BREAKS_MEASURED;
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

Terminal.prototype.handleBell = function() {
    if (Terminal.BELL_TEXT && Terminal.BELL_TIMEOUT)
        this._displayInfoWithTimeout(Terminal.BELL_TEXT, null, Terminal.BELL_TIMEOUT);
};

DomTerm.requestOpenLink = function(obj, dt = DomTerm.focusedTerm || DomTerm.mainTerm) {
    dt.reportEvent("LINK", JSON.stringify(obj));
}

DomTerm.handleLink = function(options=DomTerm._contextOptions) {
    if (options && options.href) {
        let contents = options.contentValue &&  options.contentValue.text;
        DomTerm.handleLinkRef(options.href, contents);
    }
}
DomTerm.handleLinkRef = function(href, textContent, dt=undefined) {
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

Terminal.prototype.setSessionNumber = function(kind, snumber,
                                               windowForSession, windowNumber) {
    let unique = kind != 0;
    if (kind !== 2) {
        const mainWindowForce = this.topNode == null;
        this.sstate.sessionNumber = snumber || -1;
        if (DomTerm._mainWindowNumber < 0 || mainWindowForce)
            DomTerm._mainWindowNumber = windowNumber;
        this.windowForSessionNumber = windowForSession;
        if (this.topNode) {
            this.topNode.setAttribute("session-number", snumber);
            this.reportEvent("SESSION-NUMBER-ECHO", snumber);
            if (this.sstate.forcedSize && !this.isSecondaryWindow())
                this.forceWidthInColumns(-1);
        }
    }
    if (this.topNode) {
        // When remoting over ssh, windowNumber is actually the
        // connection-number of the remote server.
        // Don't use that as the windowNumber.
        if (! (this.topNode.windowNumber > 0))
            this.topNode.windowNumber = windowNumber;
        this.updateWindowTitle();
    }
}

Terminal.prototype.getWindowTitle = function() {
    return this.sstate.windowTitle ? this.sstate.windowTitle
        : this.sstate.iconName ? this.sstate.iconName
        : "";
}

Terminal.prototype.setWindowTitle = function(title, option) {
    switch (option) {
    case 0:
        this.sstate.windowTitle = title;
        this.sstate.iconName = title;
        break;
    case 1:
        this.sstate.iconName = title;
        break;
    case 2:
        this.sstate.windowTitle = title;
        break;
    case 30:
        this.name = title;
        this.topNode.setAttribute("window-name", title);
        this.topNode.windowNameUnique = true;
        this.reportEvent("WINDOW-NAME", JSON.stringify(title));
        break;
    }
    this.updateWindowTitle();
};

Terminal.prototype.getTitleInfo = function() {
    let wtitle = this.getWindowTitle();
    const info = { };
    if (wtitle)
        info.windowTitle = wtitle;
    const snumber = this.sstate.sessionNumber;
    const wnumber = this.number;
    const wname = this.topNode?.getAttribute("window-name");
    if (wtitle)
        info.windowTitle = wtitle;
    if (snumber >= 0)
        info.sessionNumber = snumber;
    if (wnumber)
        info.windowNumber = wnumber;
    if (wname) {
        info.windowName = wname;
        info.windowNameUnique = this.topNode.windowNameUnique;
    }
    const rhost = this.getRemoteHostUser();
    if (rhost)
        info.remoteHostUser = rhost;
    return info;
}

Terminal.prototype.updateWindowTitle = function() {
    const info = this.getTitleInfo();
    const layout = DomTerm._layout;
    if (DomTerm.isSubWindow())
        DomTerm.sendParentMessage("domterm-set-title", info);
    else if (layout && layout.manager && this.layoutItem)
        layout.updateLayoutTitle(this.layoutItem, info);
    if (this.hasFocus())
        DomTerm.displayWindowTitle(info);
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
    this.sstate.reverseVideo = false;
    this.sstate.styleMap = new Map();
    this.resetCharsets();
    this.setMouseMode(0);
    this.sstate.mouseCoordEncoding = 0;
    this.sstate.sendFocus = false;
    this.sstate.modifyOtherKeys = undefined;
    this.resetTabs();
    this._setRegionTB(0, -1);
    this._setRegionLR(0, -1);
    this._currentPprintGroup = null;

    if (full >= 0) {
        this.forceWidthInColumns(-1);
    }
    if (full > 0) {
        delete this.sstate.sixelDisplayMode;
        delete this.sstate.sixelScrollsRight;
    }
    // FIXME a bunch more
};

Terminal.prototype.updateReverseVideo = function() {
    const value = this.darkMode !== this.sstate.reverseVideo;
    if (value) {
        document.body.setAttribute("reverse-video", "yes");
        if (this.topNode)
            this.topNode.setAttribute("reverse-video", "yes");
    } else {
        document.body.removeAttribute("reverse-video");
        if (this.topNode)
            this.topNode.removeAttribute("reverse-video");
    }
    if (! DomTerm.isSubWindow()) {
        const gl_style_light = document.head
              .querySelector("head link[href='hlib/goldenlayout/css/themes/goldenlayout-light-theme.css']");
        const gl_style_dark = document.head
              .querySelector("head link[href='hlib/goldenlayout/css/themes/goldenlayout-dark-theme.css']");
        if (gl_style_light && gl_style_dark) {
            gl_style_light.disabled = value;
            gl_style_dark.disabled = ! value;
        }
    }
}

Terminal.prototype._asBoolean = function(value) {
    return value === "true" || value === "yes" || value === "on";
}

DomTerm.settingsHook = null;
DomTerm.defaultWidth = -1;
DomTerm.defaultHeight = -1;

Terminal.prototype.setSettings = function(obj) {
    let settingsCounter = obj["##"];
    if (DomTerm._settingsCounter == settingsCounter)
        return;
    DomTerm.globalSettings = obj;
    DomTerm._settingsCounter = settingsCounter;
    this.updateSettings();
}

DomTerm.initSettings = function(term) {
    // Table of named options local to this pane or terminal.
    // Maybe set from command-line or UI
    term.termOptions = {};

    const settings = {};
    term.settings = settings;
    const addSetting = (name, evalMode, defaultTemplate, onChangeAction) => {
        const setting = new Settings.Setting(name);
        setting.evalMode = evalMode;
        setting.defaultTemplate = defaultTemplate;
        if (onChangeAction)
            setting.onChangeAction = onChangeAction;
        settings[name] = setting;
        return setting;
    };

    addSetting("log.js-verbosity", Settings.NUMBER_VALUE, "0",
               (setting, context) => {
                   const val = setting.value;
                   if (val >= 0)
                       DomTerm.verbosity = val;
               });
    addSetting("log.js-string-max", Settings.NUMBER_VALUE, "200",
               (setting, context) => {
                   const val = setting.value;
                   DomTerm.logStringMax = val >= 0 ? val : 200;
               });

    addSetting("output-byte-by-byte", Settings.NUMBER_VALUE, "0",
               (setting, context) => {
                   if (context.pane)
                       context.pane._output_byte_by_byte = setting.value;
               });
    addSetting("xtermjs", Settings.STRING_VALUE, "false",
               (setting, context) => {
                   let val = setting.value;
                   let v = Settings.stringAsBoolean(val);
                   const pane = context.pane;
                   const isXtermjs = window.XTermPane &&
                         pane instanceof XTermPane;
                   if (val === "dom" || val == "webgl")
                       v = 1;
                   else if (v > 0 && isXtermjs)
                       val = Terminal.defaultXtRendererType;
                   if (v < 0) {
                       context.reportError(context,
                                           "invalid 'xtermjs' value "+JSON.stringify(val));
                   } else if (isXtermjs && v > 0) {
                       pane.rendererType = val;
                       pane.setRendererType(val);
                   } else if (isXtermjs || v > 0) {
                       context.reportError(context,
                                           "cannot enable/disable 'xtermjs' after start");
                   }
               });
    function updateColor(setting, context) {
        const name = context?.curSetting.name;
        const term = context.pane;
        const value = setting.value;
        term.updateColor(setting, value, context);
    }

    const addColorSetting = (name, cssVariable, xtermThemeField, defaultTemplate) => {
        const setting = addSetting(name, Settings.STRING_VALUE, defaultTemplate, updateColor);
        setting.cssVariable = cssVariable;
        setting.xtermThemeField = xtermThemeField;
        return setting;
    }

    const bgColor = addColorSetting("color.background",
                                    "--background-color", "background",
                                    "{?{style.dark};{color.black};#fffff8}");
    const fgColor = addColorSetting("color.foreground",
                                    "--foreground-color", "foreground",
                                    "{?{style.dark};#fffff8;{color.black}}");
    addColorSetting("color.black", "--dt-black", "black", "#000000");
    addColorSetting("color.red", "--dt-red", "red", "#CD0000");
    addColorSetting("color.green", "--dt-green", "green", "#00CD00");
    addColorSetting("color.yellow", "--dt-yellow", "yellow", "#CDCD00");
    addColorSetting("color.blue", "--dt-blue", "blue", "#0000CD");
    addColorSetting("color.magenta", "--dt-magenta", "magenta", "#CD00CD");
    addColorSetting("color.cyan", "--dt-cyan", "cyan", "#00CDCD");
    addColorSetting("color.white", "--dt-lightgray", "white", "#E5E5E5");
    addColorSetting("color.bright-black", "--dt-darkgray", "brightBlack", "#4D4D4D");
    addColorSetting("color.bright-red", "--dt-lightred", "brightRed", "#FF0000");
    addColorSetting("color.bright-green", "--dt-lightgreen", "brightGreen", "#00FF00");
    addColorSetting("color.bright-yellow", "--dt-lightyellow", "brightYellow", "#FFFF00");
    addColorSetting("color.bright-blue", "--dt-lightblue", "brightBlue", "#0000FF");
    addColorSetting("color.bright-magenta", "--dt-lightmagenta", "brightMagenta", "#FF00FF");
    addColorSetting("color.bright-cyan", "--dt-lightcyan", "brightCyan", "#00FFFF");
    addColorSetting("color.bright-white", "--dt-white", "brightWhite", "#FFFFFF");

    function updateCaret(setting, context) {
        const forEditCaret = context?.curSetting.name === "style.edit-caret";
        let cstyle = setting.value;
        let nstyle = -1;
        if (cstyle) {
            cstyle = String(cstyle).trim();
            nstyle = DTerminal.caretStyles.indexOf(cstyle);
            if (nstyle < 0) {
                nstyle = Number(cstyle);
                if (! nstyle) {
                    context.reportError(context, "invalid caret style name");
                    nstyle = -1;
                }
            }
        }
        if (nstyle < 0 || nstyle >= DTerminal.caretStyles.length) {
            nstyle = forEditCaret ? DTerminal.DEFAULT_EDIT_CARET_STYLE
                : DTerminal.DEFAULT_CARET_STYLE;
        }
        const term = context.pane;
        if (forEditCaret)
            term.caretEditStyle = nstyle;
        else {
            term.caretStyleFromSettings = nstyle;
            if (term.sstate.caretStyleFromCharSeq < 0)
                term.caretCharStyle = nstyle;
        }
    }
    addSetting("style.caret", 0, DTerminal.caretStyles[DTerminal.DEFAULT_CARET_STYLE], updateCaret);
    addSetting("style.edit-caret", 0, DTerminal.caretStyles[DTerminal.DEFAULT_EDIT_CARET_STYLE], updateCaret);

    addSetting("color.caret", Settings.LIST_VALUE|Settings.STRING_VALUE, "{color.foreground} {color.background}",
               (setting, context) => {
                   const val = setting.value;
                   const val1 = val.length > 0 ? val[0] : fgColor.value;
                   const val2 = val.length > 1 ? val[1] : bgColor.value;
                   context?.pane?.updateCaretColor(val1, val2, context);
               });

    addSetting("color.selection", Settings.LIST_VALUE|Settings.STRING_VALUE, "",
               (setting, context) => {
                   const val = setting.value;
                   const v1 = val.length > 0 ? val[0] : "";
                   const v2 = val.length > 1 ? val[1] : "";
                   const v3 = val.length > 2 ? val[2]
                         : val.length > 1 ? v2 : "";
                   context?.pane?.updateSelectionColor(v1, v2, v3, context);
               });

    addSetting("keymap.line-edit", Settings.MAP_VALUE|Settings.STRING_VALUE, "",
               (setting, context) => {
                   DomTerm.lineEditKeymap =
                       DomTerm.lineEditKeymapDefault.update(setting.value);
               });
    addSetting("keymap.master", Settings.MAP_VALUE|Settings.STRING_VALUE, "",
               (setting, context) => {
                   DomTerm.masterKeymap =
                       DomTerm.masterKeymap.update(setting.value);
               });

    const darkSetting = addSetting("style.dark", Settings.NUMBER_VALUE, "auto",
               (setting, context) => {
                   term.darkMode = setting.value;
                   term.updateReverseVideo();
               });
    darkSetting.evaluateTemplate = (context) => {
        const tmode = Settings.HYBRID_VALUE;
        let value = Settings.evaluateTemplate(context, tmode);
        let dark_query = term._style_dark_query;
        if (term._style_dark_listener) {
            dark_query.removeEventListener('change', term._style_dark_listener);
            term._style_dark_listener = undefined;
        }
        if (value.length === 1 && value[0] === "auto") {
            if (! dark_query && window.matchMedia) {
                dark_query = window.matchMedia('(prefers-color-scheme: dark)');
                term._style_dark_query = dark_query;
            }
            if (dark_query) {
                term._style_dark_listener = (e) => {
                    const context = new Settings.EvalContext(term);
                    context.pushSetting(darkSetting);
                    darkSetting.update(e.matches, context);
                    context.popSetting();
                    context.handlePending();
                };
                dark_query.addEventListener('change', term._style_dark_listener);
                return dark_query.matches;
            } else
                return false;
        }
        return Settings.convertValue(value, tmode,
                                     Settings.BOOLEAN_VALUE, context);
    };
};

Terminal.prototype.updateSettings = function(context = undefined) {
    let getOption = (name, dflt = undefined) => this.getOption(name, dflt);
    let val;
    const pane = this.paneInfo;

    const pending = new Array();
    if (! context)
        context = new Settings.EvalContext(pane);
    for (const key in this.settings) {
        const setting = this.settings[key];
        const newSetting = getOption(key) || setting.defaultTemplate;
        const oldSetting = setting.template;
        if (newSetting !== oldSetting) {
            setting.template = newSetting;
            context.pushPending(setting);
        }
    }
    context.handlePending();

    val = getOption("log.js-to-server", false);
    if (val)
        DomTerm.logToServer = val;

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
        pane._remote_input_interval =
            1000 * getOption("remote-input-interval", 10);
        let timeout = getOption("remote-output-timeout", -1);
        if (timeout < 0)
            timeout = 2 * getOption("remote-output-interval", 10);
        this._remote_output_timeout = 1000 * timeout;
    } else {
        pane._remote_input_interval = 0;
        this._remote_output_timeout = 0;
    }

    this.setBlinkRate(getOption("style.blink-rate", ""));

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

function tableIntersectionCallback(entries, observer) {
    entries.forEach(entry => {
        const table = entry.target.parentNode;
        if (table && table.tagName == "TABLE") {
            // The element that we "float" to the top is the <tr> element.
            // It might be cleaner to re-position the <thead> element,
            // but that makes the IntersectionObserver logic difficult.
            const float_element = table.firstElementChild?.firstElementChild;
            if (! float_element)
                return;
            const root = this.root;
            const rootTop = root.getBoundingClientRect().top;
            const rect = table.getBoundingClientRect();
            const needHeaderFloat = rect.top + 1 <= rootTop
                  && rect.bottom - 1 > rootTop;
            const cl = table.classList;
            const hasHeaderFloat = cl.contains("dt-float-thead");
            if (! hasHeaderFloat && needHeaderFloat) {
                cl.add("dt-float-thead");
                if (root._currentFloatedTable
                    && table !== root._currentFloatedTable) {
                    root._currentFloatedTable.classList.remove("dt-float-thead");
                }
                root._currentFloatedTable = table;
                const adjustFloatingTableHead = () => {
                    float_element.style.top = `${rootTop - table.getBoundingClientRect().top}px`;
                };
                adjustFloatingTableHead();
                root._adjustFloatingTableHead = adjustFloatingTableHead;
            } else if (! needHeaderFloat && hasHeaderFloat) {
                cl.remove("dt-float-thead");
                root._currentFloatedTable = undefined;
                root._adjustFloatingTableHead = undefined;
                float_element.style.top = "";
            }
        }
    });
}

DomTerm._addMouseEnterHandlers = function(dt, node=dt.topNode) {
    // Should we convert 'ref' attribute to 'domterm-href'?
    // Desirable if using a desktop browser to avoid duplicate URL hover.
    // Not needed (but harmless) on embedded browsers
    // (at least Electron, Qt, WebView/Gtk).
    let renameLinkHref = true;
    var links = node.getElementsByTagName("a");
    for (let i = links.length; --i >= 0; ) {
        var link = links[i];
        if (! link.hasMouseEnter) {
            if (renameLinkHref
                && link.getAttribute("domterm-href") == null) {
                let href = link.getAttribute("href");
                if (href) {
                    link.setAttribute("domterm-href", href);
                    link.removeAttribute("href");
                }
            }
            link.addEventListener("mouseenter", dt._mouseEnterHandler, false);
            link.hasMouseEnter = true;
        }
    }

    const tables = node.getElementsByTagName("table");
    for (let i = tables.length; --i >= 0; ) {
        const table = tables[i];
        const thead = table.firstElementChild;
        const tbody = table.lastElementChild;
        if (! table.hasIntersectionObserver && thead && tbody
            && thead.tagName === "THEAD" && tbody.tagName === "TBODY") {
            table.hasIntersectionObserver = true;
            let observer = dt._intersectionObserver;
            if (! observer) {
                let options = {
                    root: dt.buffers,
                    threshold: [0.01, 0.99]
                };
                observer = new IntersectionObserver(tableIntersectionCallback,
                                                    options);
                dt._intersectionObserver = observer;
            }
            observer.observe(tbody);
            observer.observe(thead);
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

// Maybe use a separate library, perhaps DomPurify ?
Terminal.prototype._scrubAndInsertHTML = function(str, handleLines = true) {
    const handleNewline = (str, i, start, len) => {
        this._unsafeInsertHTML(str.substring(start, i-1));
        /*
          if (pauseNeeded) {
          this._deferredBytes = ....;
          this.controlSequenceState = DTParser.PAUSE_REQUESTED;
          }
        */
        this.cursorLineStart(1);
        let ln = this.lineStarts[this.getAbsCursorLine()];
        ln._widthMode = Terminal._WIDTH_MODE_VARIABLE_SEEN;
        ln._breakState = Terminal._BREAKS_UNMEASURED;
        if (str.charCodeAt(i-1) == 13 && i < len && str.charCodeAt(i) == 10)
            i++;
        return i;
    };
    const handlePopOuterBlock = (str) => {
        this._breakDeferredLines();
        this.freshLine();
        const line = this.getAbsCursorLine();
        const lstart = this.lineStarts[line];
        const lend = this.lineEnds[line];
        const emptyLine = (lstart == this.outputContainer
                           && lstart.firstChild == lend
                           && this.outputBefore == lend);
        this._unsafeInsertHTML(str);
        const created = lstart.firstChild;
        if (emptyLine && created.nextSibling == lend) {
            lstart.removeChild(created);
            lstart.parentNode.insertBefore(created, lstart);
            const delta = this.lineStarts.length;
            this._restoreLineTables(created, line);
            this.outputContainer = lstart;
            this.outputBefore = lend;
            this.resetCursorCache();
        }
        //insert immediately, as new line
    }

    let options = { handleNewline, handlePopOuterBlock };
    let startLine = this.getAbsCursorLine();
    // FIXME could be smarter - we should avoid _WIDTH_MODE_VARIABLE_SEEN
    // until we actually see something that needs it.
    this.lineStarts[startLine]._widthMode = Terminal._WIDTH_MODE_VARIABLE_SEEN;
    this.lineStarts[startLine]._breakState = Terminal._BREAKS_UNMEASURED;
    str = DtUtil.scrubHtml(str, options);
    if (str) {
        this._unsafeInsertHTML(str);
        if (! options.errorSeen) {
            this.resetCursorCache();
            this._updateLinebreaksStart(startLine);
        }
    }
    this._updateHomeLine();
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
                if (cls == "dt-buffers") {
                    formatList(node.childNodes, false);
                    break;
                }
            } else if (tagName == "span") {
                if (cls == "focus-area" || cls == "focus-caret")
                    break;
                if (cls == "dt-cluster") {
                    string += node.textContent;
                    break;
                }
                if (cls == 'non-pre-newline') {
                    string += '\n';
                    break;
                }
            } else if (tagName === "canvas"
                       && node.class.contains("dt-background")) {
                tagName = "img";
                const sattr = document.createAttribute("src");
                sattr.value = node.toDataURL();
                tagAttributes = [sattr, ...tagAttributes];
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
                    else if (aname === "domterm-href")
                        aname = "href";
                    else if (aname=="breaking" && tagName=="span"
                             && node.getAttribute("line")) {
                        isBreakingLine = true;
                        continue;
                    }
                    s += ' ' + aname+ // .toLowerCase() +
                        '="' + DtUtil.escapeText(avalue) + '"';
                }
            }
            if (skip)
                break;
            string += s;
            if (!node.firstChild) {
                if (DtUtil.isEmptyTag(tagName))
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
            '="' + DtUtil.escapeText(node.value) + '"'; // .toLowerCase()
            break;
        case 3: // TEXT
            string += DtUtil.escapeText(node.nodeValue);
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
    if (height > 0) {
        let end = this._dataHeight();
        let limit = end + height;
        if (limit > this._pauseLimit)
            this._pauseLimit = limit;
    }
    if (! paging)
        this._clearSelection();
    this._disableScrollOnOutput = false;
    this._pauseContinue(paging);
    DomTerm.setAutoPaging("true", this);
}

Terminal.prototype._downLinesOrContinue = function(count, paging) {
    let todo = this.editorMoveLines(false, count, false);
    if (todo > 0) {
        this._pauseLimit = this._dataHeight() + count * this.charHeight + 2;
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
    this.disableMouseMode(paging);
    if (wasMode != 0)
        this._displayInputModeWithTimeout(this._modeInfo("C"));
    if (DomTerm.verbosity >= 2)
        this.log("pauseContinue was mode="+wasMode);
    if (wasMode == 2) {
        var text = this._deferredBytes;
        if (text) {
            this._deferredBytes = undefined;
            if (skip) {
                this._receivedCount
                    = (this._receivedCount + text.length) & Terminal._mask28;
            } else
                this.parseBytes(text);
        }
        this._maybeConfirmReceived();
    }
}

Terminal.prototype.requestUpdateDisplay = function() {
    if (this._updateTimer)
        this._deferUpdate = true;
    else
        this._updateTimer = requestAnimationFrame(this._updateDisplay);
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
Terminal.prototype.insertBytes = function(bytes, startIndex = 0, endIndex = bytes.length) {
    if (DomTerm.verbosity >= 2)
        this.log("insertBytes "+this.name+" "+typeof bytes+" count:"+(endIndex-startIndex)+" received:"+this._receivedCount);
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
                this._deferredBytes = this.withDeferredBytes(bytes, startIndex, urgent_begin);
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
                let defb = this._deferredBytes;
                if (startIndex == endIndex && defb) {
                    this._deferredBytes = undefined;
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
        deferredBytes: this._deferredBytes,
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
    this._deferredBytes = undefined;
    this._savedControlState = saved;
    if (! DomTerm.usingXtermJs())
        this.parser.pushControlState(saved);
}
Terminal.prototype.popControlState = function() {
    var saved = this._savedControlState;
    if (saved) {
        this._savedControlState = saved._savedControlState;
        this._deferredBytes = saved.deferredBytes;
        if (! DomTerm.usingXtermJs()) {
            this.parser.popControlState(saved);
        }
        // Control sequences in "urgent messages" don't count to
        // receivedCount. (They are typically window-specific and
        // should not be replayed when another window is attached.)
        if (saved.counted)
            this._receivedCount = (this._receivedCount + 3) & Terminal._mask28;
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
    if (! this.parser) {
        console.log("data received for non-terminal window (browse or view-saved)");
        console.trace("ignored for now "+this.kind);
        return;
    }

    let rlen = endIndex - beginIndex;
    if (this._deferredBytes)
        rlen += this._deferredBytes.length;
    this.parser.parseBytes(bytes, beginIndex, endIndex);
    if (this._deferredBytes)
        rlen -= this._deferredBytes.length;
    this._receivedCount = (this._receivedCount + rlen) & Terminal._mask28;

    if (this._afterOutputHook) {
        let n = this._afterOutputHook.length;
        let j = 0;
        for (let i = 0; i < n; i++) {
            if (! this._afterOutputHook[i]()) {
                this._afterOutputHook[j++] = this._afterOutputHook[i];
            }
        }
        if (j !== n) {
            if (j == 0)
                this._afterOutputHook = undefined;
            else
                this._afterOutputHook.length = j;
        }
    }

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
    const sel = document.getSelection();
    if (this.viewCaretNode.parentNode && sel.focusNode !== null) {
        let rect = DtUtil.positionBoundingRect(sel.focusNode, sel.focusOffset);
        if (rect.height == 0)
            return;
        let caret = this.viewCaretMarkNode;
        let outerRect = this.topNode.getBoundingClientRect();
        caret.style.top = `${rect.top - outerRect.top}px`;
        caret.style.left = `${rect.left - outerRect.left}px`;
        caret.style.bottom = `${outerRect.bottom - rect.bottom}px`;
        caret.style.right = `${outerRect.width - rect.right}px`;
        let lcaret = this.viewCaretLineNode;
        lcaret.style.top = `${rect.top - outerRect.top}px`;
        lcaret.style.bottom = `${outerRect.bottom - rect.bottom}px`;
        lcaret.style.left = `${outerRect.left}px`;
        lcaret.style.right = `${this.rightMarginWidth}px`;
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
    let rect;
    if (caret === this.viewCaretNode) {
        rect = DtUtil.positionBoundingRect(); // from selection
     } else
        rect = caret.getBoundingClientRect();
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
        if (skipRest || ! DtUtil.isSpanNode(lineStart) || ! lineAttr) {
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
Terminal.prototype._unbreakLines = function(startLine, single, stopLine, linesToRevertAfterMeasure=null) {
    // If a continuation line (following a soft line-break) is
    // _BREAKS_UNMEASURED then the entire logical line needs to be measured.
    // To do that,it needs to be unbroken. (Could be optimized in the
    // countColumns case.)  Usually not an issue as long as line-breaking
    // is deferred until we have a complete logical line.
    let measureNeeded = false;
    let lineNum = this.lineStarts.length;
    while (--lineNum > startLine || (measureNeeded && lineNum >= 0)) {
        let lineStart = this.lineStarts[lineNum];
        let lineAttr = lineStart.getAttribute('line');
        if (lineAttr) {
            if (lineAttr !== "hard"
                && lineStart._breakState == Terminal._BREAKS_UNMEASURED)
                measureNeeded = true;
        } else {
            measureNeeded = false;
        }
    }
    if (lineNum < startLine)
        startLine = lineNum;
    let invalidBreakSeen = false;
    let lineToRevertStartLength = linesToRevertAfterMeasure ? linesToRevertAfterMeasure.length : 0;
    let afterLine = () => {
        if (linesToRevertAfterMeasure) {
            if (invalidBreakSeen)
                lineToRevertStartLength = linesToRevertAfterMeasure.length;
            else
                linesToRevertAfterMeasure.length = lineToRevertStartLength;
        }
        invalidBreakSeen = false;
    };
    let action = (prevLine, lineStart, lineAttr, lineno) => {
        if (prevLine.getAttribute('line') == null) {
            afterLine();
        }
        if (prevLine._breakState >= Terminal._BREAKS_VALID
           && ! invalidBreakSeen) {
            if (linesToRevertAfterMeasure
                && (lineStart.getAttribute("breaking")=="yes"))
                linesToRevertAfterMeasure.push(prevLine);
            return false;
        }
        if (lineStart.getAttribute("breaking")=="yes") {
            invalidBreakSeen = true;
            lineStart.removeAttribute("breaking");
            for (let child = lineStart.firstChild; child != null; ) {
                var next = child.nextSibling;
                if (child instanceof Text /* added '\n' */
                    || child.classList.contains("pprint-indentation"))
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
                    //prevLine._breakState = Terminal._BREAKS_UNMEASURED;
                }
            }
            // Remove "soft" "fill" "miser" "space" breaks from the line-table
            return true;
        } else
            return false;
    };
    let changed = this._adjustLines(startLine, action, single, stopLine);
    afterLine();
    return changed;
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
    this._updateHomeLine();
}

Terminal.prototype._breakVisibleLines = function() {
    // Find startLine (lowest index) where line top >= scrollTop.
    let startLine = this.lineStarts.length - 1;
    let scrollTop = this.buffers.scrollTop;
    for (; startLine > 0; startLine--) {
        let line = this.lineStarts[startLine];
        if (line.getAttribute("line"))
            continue;
        let lineRect = line.getBoundingClientRect();
        if (lineRect.top < 0)
            break;
    }
    const home_offset = DomTerm._homeLineOffset(this);
    const home_node = this.lineStarts[this.homeLine - home_offset];
    this._breakAllLines(startLine);
    const changed = true; // FIXME
    if (changed) {
        this.resetCursorCache();
        this.homeLine = this._computeHomeLine(home_node, home_offset, true);
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
                var span = dt._createSpanNode("pprint-indentation");
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
    // For each Element, the measureLeft/measureWidth properties are
    // (roughly) offsetLeft/offsetWidth, under the assemption of
    // infine line width (no soft line breaks).  Pretty-printing elements
    // pprint-indent (with child text), pre-break, and post-break elements
    // are measured (measureWidth is set) but do not count for the width
    // of containing elements. (This happens automatically if !countColumnts.)
    // If countColumns, use characters counts to calculate widths instead
    // of accessing offsetLeft/offsetWidth properties; this is faster,
    // though less general.

    function _breakLine1 (dt, line, start, countColumns) {
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
        let lineStart = dt.lineStarts[line];
        let beforePos = lineStart && lineStart.measureLeft !== undefined
            ? lineStart.measureLeft
            : dt._topLeft;
        let value;
        for (var el = start; el != null; ) {
            var lineAttr;
            var skipChildren = false;
            let ecl; // el.classList, if defined
            if (el instanceof Element) {
                if (countColumns) {
                    el.measureLeft = beforePos;
                } else {
                    el.measureLeft = el.offsetLeft;
                    el.measureWidth = el.offsetWidth;
                }
            }
            let cls;
            if (el instanceof Text) {
                if (! countColumns)
                    skipChildren = true;
                else if (el.data == '\t')
                    beforePos = dt.charWidth * dt.nextTabCol(beforeCol);
                else
                    beforePos += dt.charWidth * dt.strWidthInContext(el.data, el);
            } else if ((cls = el.classList).contains("dt-cluster")) {
	        if (countColumns)
	            beforePos += (cls.contains("w1") ? 1 : 2) * dt.charWidth;
                skipChildren = true;
	    } else if (DtUtil.isObjectElement(el)) {
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
                    el.measureLeft = beforePos;
                    el.measureWidth = 0;
                    if (el.outerPprintGroup == null) {
                        skipChildren = true;
                        break;
                    }
                } else {
                    el._needSectionEndNext = needSectionEndList;
                    needSectionEndList = el;
                }
            } else if ((ecl = el.classList).contains('pprint-indentation')) {
                skipChildren = true;
            } else if (ecl.contains("pprint-indent")) {
                el.pprintGroup = pprintGroup;
            } else if (ecl.contains("pprint-group")) {
                pprintGroup = el;
                el._needSectionEndNext = needSectionEndList;
                needSectionEndList = el;
                el._saveSectionEndFence = needSectionEndFence;
                needSectionEndFence = needSectionEndList;
            } else if ((value = el.getAttribute("content-value")) != null
                       && el.nodeName == "SPAN") {
                if (el.previousSibling === dt._caretNode) {
                    // Should be a no-op
                    el.measureLeft -= el.previousSibling.measureWidth;
                }
                if (countColumns)
                    beforePos += dt.charWidth * dt.strWidthInContext(value, el);
            }
            if (el.firstChild != null && ! skipChildren)
                el = el.firstChild;
            else {
                for (;;) {
                    if (el == null)
                        break;
                    if (el == pprintGroup) { // pop pprint-group
                        let outerGroup = pprintGroup.outerPprintGroup;
                        pprintGroup = outerGroup;
                        needSectionEndFence = el._saveSectionEndFence;
                        el._saveSectionEndFence = undefined;
                    }
                    var next = el.nextSibling;
                    if (countColumns && el instanceof Element) {
                        el.measureWidth = beforePos - el.measureLeft;
                        let cls = el.classList;
                        if (cls.contains("pprint-indent")
                            || cls.contains("pre-break")
                            || cls.contains("post-break")) {
                            // These are not visible (when not breaking),
                            // so we want to measure their width, but they are
                            // "out-of-band" - not part of the cumulative width.
                            beforePos = el.measureLeft;
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
            countColumns ?  beforePos : end.offsetLeft;
        //countColumns ?  beforeCol * dt.charWidth : end.offsetLeft;
        end.measureWidth = 0; // end.offsetWidth;
    }

    function breakLine2 (dt, line, lineStart, availWidth, countColumns) {
        // second pass - edit DOM, but don't look at offsetLeft
        let start, startOffset;
        if (DtUtil.isBlockNode(lineStart)) {
            start = lineStart.firstChild;
            startOffset = 0;
        } else {
            for (let p = lineStart; ; p = p.parentNode) {
                start = p.nextSibling;
                if (start !== null)
                    break;
            }
            startOffset = lineStart.measureLeft || 0;
        }
        var pprintGroup = null; // FIXME if starting inside a group
        // beforePos is typically el.offsetLeft (if el is an element)
        // - i.e. relative to the start of the current (physical) line.
        // startOffset is the difference (beforeMeasure - beforePos),
        // where beforeMeasure is typically el.measureLeft (if an element)
        // - i.e. relative to the start of the logical unbroken line.
        // If el is a Text, beforePos and beforeMeasure are calculated.
        let beforePos = 0;
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
            if (isText || DtUtil.isObjectElement(el)
                || el.classList.contains("dt-cluster")
               ) {
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
                        var rest = dt._breakString(el, lineNode,
                                                   beforeMeasure, afterMeasure,
                                                   availWidth+startOffset,
                                                   didbreak, countColumns);
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
                        if (lineNode.previousSibling === dt._caretNode)
                            el.parentNode.insertBefore(el, dt._caretNode);
                        next = rest;
                    } else { // DtUtil.isObjectElement(el) or dt-cluster
                        dt._insertIntoLines(lineNode, line);
                        el.parentNode.insertBefore(lineNode, el);
                        lineNode.measureLeft = el.measureLeft;
                        lineNode.measureWidth = 0;
                        indentWidth = addIndentation(dt, lineNode, countColumns);
                    }
                    lineNode._widthMode = dt.lineStarts[line]._widthMode;
                    let prevLine = dt.lineStarts[line];
                    lineNode._breakState = prevLine._breakState;
                    prevLine._breakState |= Terminal._BREAKS_VALID;
                    line++;
                    beforeMeasure = lineNode.measureLeft;
                    if (countColumns) {
                        let beforeColumns = oldel.parentNode == null ? 0
                            : oldel.previousSibling==lineNode ? 0
                            : dt.strWidthInContext(oldel.data, el);
                        let oldWidthCols = dt.lineStarts[line-1]._widthColumns;
                        if (oldWidthCols) {
                            let startMeasure =
                                dt.lineStarts[line-1].measureLeft || 0;
                            let beforeCols =
                                (beforeMeasure - startMeasure) / dt.charWidth;
                            dt.lineStarts[line-1]._widthColumns = beforeCols;
                            lineNode._widthColumns = oldWidthCols - beforeCols;
                        }
                    }
                    beforePos = indentWidth;
                    startOffset = beforeMeasure - beforePos;
                    dobreak = true;
                }
            } else if (el.nodeName == "SPAN"
                       && (lineAttr = el.getAttribute("line")) != null) {
                skipChildren = true;
                if ((lineAttr == "hard" || lineAttr == "soft")
                    && el.outerPprintGroup == null) {
                    el.measureLeft = beforePos + startOffset;
                    break;
                }
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
                    el._breakState |= Terminal._BREAKS_VALID;
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
                el.breakSeen = false;
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
                if (previous.previousSibling === dt._caretNode) {
                    const caretValue = dt._caretNode.getAttribute("value");
                    if (caretValue) {
                        pad -= dt.charWidth
                            * dt.strWidthInContext(caretValue, el);
                    }
                }
                const adjustMargin = false;
                if (pad < dt.charWidth) { // hide
                    previous.setAttribute("content-value", "");
                    el.style.visibility = "hidden";
                    el.style.position = "absolute";
                    if (adjustMargin)
                        previous.style.marginRight = "";
                } else {
                    if (adjustMargin) {
                        // Better for non-monospace fonts, but fragile.
                        previous.setAttribute("content-value", " ");
                        previous.style.marginRight = `${pad-dt.charWidth}px`;
                        startOffset -= pad - previous.measureWidth;
                    } else {
                        let numSpaces = Math.floor((pad + 0.1) / dt.charWidth);
                        let spaces = DomTerm.makeSpaces(numSpaces);
                        previous.setAttribute("content-value", spaces);
                        startOffset -= numSpaces * dt.charWidth - previous.measureWidth;
                    }
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
        return line;
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
        if (this.initial && this.curBufferStartLine() >= 0) // paranoia
            startLine = this.curBufferStartLine();
        else
            startLine = this.homeLine;
    }

    let linesToRevertAfterMeasure = [];
    let changed = this._unbreakLines(startLine, false, firstInputLine,
                                    linesToRevertAfterMeasure);
    for (let i = linesToRevertAfterMeasure.length; --i >= 0; ) {
        let e = linesToRevertAfterMeasure[i];
        if (e.getAttribute('breaking') === 'yes')
            e.setAttribute('breaking', 'measuring');
    }
    for (let line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start == firstInputLine)
            break;
        if (start.classList.contains("domterm-opaque"))
            continue;
        if (start._breakState >= Terminal._BREAKS_MEASURED)
            continue;
        var end = this.lineEnds[line];
        if (start.alwaysMeasureForBreak || breakNeeded(this, line, start)) {
            changed = true; // FIXME needlessly conservative
            var first;
            if (DtUtil.isBlockNode(start))
                first = start.firstChild;
            else {
                while (start.nextSibling == null)
                    start = start.parentNode;
                first = start.nextSibling;
            }
            var countColumns = ! Terminal._forceMeasureBreaks
                && start._widthMode !== undefined
                && start._widthMode < Terminal._WIDTH_MODE_VARIABLE_SEEN;
            _breakLine1(this, line, first, countColumns);
            start._breakState = Terminal._BREAKS_MEASURED;
        } else
            start._breakState |= Terminal._BREAKS_VALID;
    }
    for (let i = linesToRevertAfterMeasure.length; --i >= 0; ) {
        let e = linesToRevertAfterMeasure[i];
        if (e.getAttribute('breaking') === 'measuring')
            e.setAttribute('breaking', 'yes');
    }
    for (let line = startLine;  line < this.lineStarts.length;  line++) {
        var start = this.lineStarts[line];
        if (start._breakState === Terminal._BREAKS_MEASURED) {
            var countColumns = !Terminal._forceMeasureBreaks
                && start._widthMode < Terminal._WIDTH_MODE_VARIABLE_SEEN;
            line = breakLine2(this, line, start, this.availWidth, countColumns);
            this.lineStarts[line]._breakState |= Terminal._BREAKS_VALID;
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

/** Break textNode's string so as much as possible fits on current line.
 * The 'beforePos' is position at start of string;
 * 'afterPos' is position at end of string;
 * 'availWidth' is position at end of current line (afterPos > availWidth).
 * All of these are 'measureLeft' positions - i.e. relative to start of logical
 * line, assuming no optional line-breaks.
*/
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
        goodLength = UnicodeProperties.columnToIndexInContext(textData, 0, col,
                                                              false);
        goodWidth += col * dt.charWidth;
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
            // check for surrogates
            var ch0 = textData.charCodeAt(0);
            var ch1 = textData.charCodeAt(1);
            if (ch0 >= 0xD800 && ch0 <= 0xDBFF
                && ch1 >= 0xdc00 && ch1 <= 0xdfff)
                ch0len = 2;
        }
        goodLength = ch0len;
    }
    if ((this.sstate.wraparoundMode & 2) === 0) {
        // If no wraparound, drop excess characters - but keep last character.
        // Pretty useless, but that's the standard.
        // No surrogate handling, since this is only used for tests.
        textData = (textData.substring(0, goodLength-1)
                    + textData.substring(textLength-1));
        textNode.data = textData;
        return "";
    }
    if (goodLength == 0)
        textNode.parentNode.removeChild(textNode);
    else
        textNode.data = textData.substring(0, goodLength);
    lineNode.measureLeft = goodWidth;
    lineNode.measureWidth = 0;
    return goodLength < textLength ? textData.substring(goodLength) : "";
};

/** Insert str.substr(beginIndex,endIndex) at current position.
 * inserting: 0: overwrite mode;
 * 1: insert in current line, drop characters shifted out of line;
 * 2: true insert
 */

Terminal.prototype.insertSimpleOutput = function(str, beginIndex, endIndex,
             inserting=this.sstate.insertMode ? 1 : 0) {
    var sslen = endIndex - beginIndex;
    if (sslen == 0)
        return;

    if (DomTerm.verbosity >= 3)
        this.log("insertSimple '"+this.toQuoted(str.substring(beginIndex,endIndex))+"'");
    let absLine = this.getAbsCursorLine();
    let following = this.outputBefore;
    let parent = this.outputContainer;
    while (following == null) {
        following = parent.nextSibling;
        parent = parent.parentNode;
    }
    let atEnd = following==this.lineEnds[absLine];
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
        && this.outputContainer.classList.contains("dt-cluster")
        && this.outputBefore == this.outputContainer.firstChild) {
        this.outputBefore = this.outputContainer;
        this.outputContainer = this.outputBefore.parentNode;
    }
    let outputPrevious = this.outputBefore === null ? this.outputContainer.lastChild
        : this.outputBefore instanceof Node ? this.outputBefore.previousSibling : null;
    if (outputPrevious instanceof Element
        && outputPrevious.classList.contains("dt-cluster")) {
        // Check for cluster that combines previous cluster with start of str.
        let breakBefore =
            str.length > 0
            && outputPrevious._prevInfo !== undefined
            && UnicodeProperties.shouldJoin(outputPrevious._prevInfo,
                                            UnicodeProperties.getInfo(str.codePointAt(0))) <= 0;
        if (! breakBefore) {
            this.outputBefore = outputPrevious;
            if (atEnd || inserting) {
                this.outputBefore = outputPrevious.nextSibling;
                this.outputContainer.removeChild(outputPrevious);
            }
            str = outputPrevious.textContent + str;
            let w = outputPrevious.classList.contains("w2") ? 2 : 1;
            if (this.currentCursorColumn >= w)
                this.currentCursorColumn -= w;
            sslen = str.length;
            beginIndex = 0;
            endIndex = sslen;
        }
    }
    if (this.outputBefore && this.outputBefore.previousSibling instanceof Text) {
        this.outputContainer = this.outputBefore.previousSibling;
        this.outputBefore = this.outputContainer.length;
    } else if (this.outputBefore instanceof Text) {
        this.outputContainer = this.outputBefore;
        this.outputBefore = 0;
    }
    if (this.outputContainer instanceof Text && this.outputBefore > 0) {
        let data = this.outputContainer.data;
        let lastLen = 1;
        let lastChar = data.charCodeAt(this.outputBefore);
        if (lastChar >= 0xDC00 && lastChar <= 0xDFFF
            && this.outputBefore >= 2) { // low surrogate
            lastChar = data.codePointAt(this.outputBefore-2);
            lastLen = 2;
        }
        let join1 = UnicodeProperties.shouldJoin(0, UnicodeProperties.getInfo(lastChar));
        let join2 = UnicodeProperties.shouldJoin(join1,
                                                 UnicodeProperties.getInfo(str.codePointAt(0)));
        if (join2 > 0) {
            str = data.substring(this.outputBefore - lastLen, this.outputBefore)
                + str;
            this.outputBefore -= lastLen;
            if (this.currentCursorColumn > 0)
                this.currentCursorColumn--;
            sslen = str.length;
            beginIndex = 0;
            endIndex = sslen;
            if (atEnd || inserting) {
                this.outputContainer.deleteData(this.outputBefore, lastLen);
                let lineStart = this.lineStarts[absLine];
                if (lineStart._widthColumns !== undefined)
                    lineStart._widthColumns -= lastLen;
            }
        }
    }

    let segments = [];
    let widths = [];
    let widthInColumns = DtUtil.getGraphemeSegments(str, beginIndex, endIndex,
                                                    segments, widths);

    let nsegments = segments.length;
    if (nsegments == 0)
        return;
    let isegment = 0;
    if (inserting == 0) {
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
                && this.classList.contains("dt-cluster")
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
        if (str == null || atEnd)
            fits = true;
        else {
            // FIXME optimize if end of line
            fits = this.deleteCharactersRight(widthInColumns, true);
        }
    } else if (inserting == 1) {
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
        //this._clearWrap(line);
        this.deleteCharactersRight(-1);
        if (col < trunccol) {
            if (true || firstInParent || prev instanceof Element) {
                this.outputContainer = saveContainer;
                this.outputBefore = saveOutput;
                //firstInParent ? saveContainer.firstChild
                //: prev.nextSibling;
                this.currentAbsLine = line;
                this.currentCursorColumn = col;
            } else {
                this.moveToAbs(line, col, true);
            }
        }
        this._adjustStyle();
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
        if (!atEnd && column + cols > this.numColumns) {
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
            this.cursorLineStart(1, "soft");
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
            if (atEnd)
                this._updateLinebreaksStart(absLine);
        }
        lineStart._breakState = Terminal._BREAKS_UNMEASURED;
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

// If needed, escape '\xFD' as '\xFD\n'.
Terminal.escapeInputBytes = function(bytes) {
    let len = bytes.length;
    let scount = 0;
    for (let i = len; --i >= 0; ) {
        if (bytes[i] === 0xFD)
            scount++;
    }
    if (scount == 0)
        return bytes;
    let nbytes = new Uint8Array(len+scount);
    let j = 0;
    for (let i = 0; i < len; i++) {
        let v = bytes[i];
        nbytes[j++] = v;
        if (v === 0xFD)
            nbytes[j++] = 10;
    }
    return nbytes;
}
Terminal.prototype.processResponseBytes = function(bytes) {
    if (! this._replayMode && ! this.isSecondaryWindow()) {
        if (DomTerm.verbosity >= 3)
            this.log("processResponse: "+bytes.length+" bytes");
        this.processInputBytes(Terminal.escapeInputBytes(bytes));
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
    if (this._currentEditingLine
        && this._currentEditingLine.contains(this.outputContainer)) {
        let cl = this._currentEditingLine.classList;
        if (! cl.contains('input-line'))
            cl.add('input-line');
        this._currentEditingLine._breakState = Terminal._BREAKS_UNMEASURED;
    }
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
    else if (this._clientWantsEditing) // actually should depend on icrnl
        return "\n";
    else
        return "\r";
}

/* (currently unused)
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
    case "Backquote": return "`";
    }
    return "";
}
*/

Terminal.prototype.eventToKeyName = function(event, type=event.type) {
    if (! event.key)
        return browserKeymap.keyName(event);
    let base = event.key;
    let shift = event.shiftKey && base !== "Shift";
    if (type == "keypress") {
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
    let name = base;
    if (name == null || event.altGraphKey) return null
    let mods = "";
    if (event.altKey && base != "Alt") mods= "Alt+" + mods;
    if (event.ctrlKey && base != "Ctrl") mods = "Ctrl+" + mods;
    if (event.metaKey && base != "Cmd") mods = "Cmd+" + mods;
    // Only add "Shift+" if there are other modifiers *or* it didn't change key.
    // E.g. "Shift+A" should be plain "A", but we do want "Shift+Enter".
    // "Shift" of "." on US keyboard should be plain ">",
    // while Shift+Ctrl with "." (on US keyboard) should be "Shift+Ctrl+>".
    if (shift &&
        (event.key===event.code || base === "Space" || base === "Meta"
         || (mods !== "" && event.code == "Key" + event.key)))
        mods = "Shift+" + mods;
    return mods + name;
}

Terminal.prototype.keyNameToChars = function(keyName, event=null) {
    const isShift = (mods, e=event) =>
          mods.indexOf("Shift+") >= 0 || (e && e.shiftKey);
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
        else if ((this.applicationCursorKeysMode() && param == "") || param == "O")
            return "\x1BO"+last;
        else
            return csi+param+last;
    }
    const otherKeys = (ch, mods) => {
        if (true) // xterm modifyOtherKeys
            return specialKeySequence("27", ";" + ch + "~", mods);
        else // xterm formatOtherKeys
            return specialKeySequence(ch, "u", mods);
    };
    if (DomTerm.isKeyPressName(keyName))
        return keyName.charAt(1);
    const dash = keyName.substring(0,keyName.length-1).lastIndexOf("+");
    const mods = dash > 0 ? keyName.substring(0, dash+1) : "";
    let baseName = dash > 0 ? keyName.substring(dash+1) : keyName;
    switch (baseName) {
    case "Backspace": return "\x7F";
    case "Tab": return mods==="Shift+" ? "\x1B[Z" : mods==="" ? "\t"
            : otherKeys(9, mods);
    case "Enter": return mods==="Alt+" ? "\x1B\r"
            : mods==="" ? this.keyEnterToString()
            : otherKeys(13, mods);
    case "Space": return mods==="" || mods=="Shift+" ? " "
            : mods==="Ctrl+" ? "\0"
            : otherKeys(0, mods);
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
        let ch = baseName.codePointAt(0);
        if (baseName.length == (ch <= 0xFFFF ? 1 : 2) && mods) {
            if (mods == "Ctrl+" || mods == "Shift+Ctrl+") {
                if ((ch >= 65 && ch <= 90 && mods == "Ctrl+")
                    || ch == 32 || ch == 64 || (ch >= 91 && ch <= 95))
                    return String.fromCharCode(ch & 31);
            }
            if (mods == "Alt+" || mods == "Shift+Alt+") {
                if (ch >= 65 && ch <= 90 && mods == "Alt+")
                    baseName = baseName.toLowerCase();
                return "\x1B" + baseName;
            }
            if (this.sstate.modifyOtherKeys)
                return otherKeys(ch, mods);
        }
        return null;
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

Terminal.prototype.pasteTextFromJson = function(jstr) {
    try {
        this.pasteText(JSON.parse(jstr));
    } catch (e) {
        this.log("caught " + e + " in pasteTextFromJson (OSC 231)");
    }
}


DomTerm.copyLink = function(options=DomTerm._contextOptions) {
    let href = options && options.href;
    if (href)
        DomTerm.copyText(href);
}

DomTerm.copyText = function(str) {
    return DomTerm.valueToClipboard({ text: str, html: "" });
}

DomTerm.doPaste = function(dt=DomTerm.focusedTerm) {
    let sel = document.getSelection();
    dt.maybeFocus();
    dt._ignorePaste = undefined;
    let useClipboardApi = DomTerm.isElectron();
    if (useClipboardApi) {
        navigator.clipboard.readText().then(clipText =>
            dt.pasteText(clipText));
    } else if (dt.hasClipboardServer("paste")) {
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

Terminal.colorNames = [
    'black', 'red', 'green', 'yellow',
    'blue', 'magenta', 'cyan', 'lightgray',
    'darkgray', 'lightred', 'lightgreen', 'lightyellow',
    'lightblue', 'lightmagenta', 'lightcyan', 'white' ];

Terminal._rangeAsText = function(range, options={}) {
    let t = "";
    let addEscapes = options['escape'];
    let softLinebreaks = options['soft-linebreaks'];
    let useTabs = options['use-tabs'];
    let prevBg = null, prevFg = null, prevStyle = null;
    let lineNonEmpty = 0; // 0: empty; 1: only whitespace; 2: non-space seen
    let lastEnd = 0;
    const BOLD = 1 << 1; //font-weight=bold
    const LIGHTER = 1 << 2; //font-weight=lighter
    const ITALIC = 1 << 3; //font-style=italic
    const UNDERLINE = 1 << 4; // text-underline=yes
    const BLINK = 1 << 5; // text-blink=yes
    const INVERSE = 1 << 7; // reverse=yes
    const CROSSED_OUT = 1 << 9; // text-line-through=yes
    function wrapText(tnode, start, end) {
        let parent = tnode.parentNode;
        let lineColor = '';
        const inLineEnd = parent.getAttribute('line');
        if (inLineEnd) {
            if (inLineEnd == "soft")
                return;
            end = start; // skip actual '\n' text, but handle escapes (lineColor)
        }
        if (addEscapes) {
            let curBg = null, curFg = null, curStyle = 0;
            for (let p = parent; ; p = p.parentNode) {
                let isBlock = DtUtil.isBlockNode(p);
                let pstyle = p.style;
                if (! curFg)
                    curFg = pstyle['color'];
                if (isBlock && lineNonEmpty == 0) {
                    lineColor = pstyle['background-color'];
                }
                if (! curBg)
                    curBg = pstyle['background-color'];
                let decoration = p.getAttribute('text-decoration');
                if (decoration) {
                    if (decoration.indexOf('underline') >= 0)
                        curStyle |= UNDERLINE;
                    if (decoration.indexOf('blink') >= 0)
                        curStyle |= BLINK;
                }
                let weight = p.getAttribute('font-weight');
                if (weight === 'bold')
                    curStyle |= BOLD;
                if (weight === 'lighter')
                    curStyle |= LIGHTER;
                if (p.getAttribute('reverse') === 'yes')
                    curStyle |= INVERSE;
                if (p.getAttribute('font-style') === 'italic')
                    curStyle |= ITALIC;
                if (isBlock) {
                    break;
                }
            }
            function encodeColor(cssValue, isBackground) {
                let m;
                if (!cssValue)
                    t += isBackground ? '\x1B[49m' : '\x1B[39m';
                else if ((m = cssValue.match(/var\(--dt-(.*)\)/))) {
                    let num = Terminal.colorNames.indexOf(m[1]);
                    if (num >= 0 && num < 16) {
                        let code = num < 8 ? num + 30 : num - 8 + 90;
                        if (isBackground)
                            code += 10;
                        t += '\x1B[' + code + 'm';
                    }
                } else if ((m = cssValue.match(/#(..)(..)(..)/))) {
                    t += '\x1B['
                        + (isBackground ? 48 : 38) + ';2;'
                        + parseInt(m[1], 16) + ';'
                        + parseInt(m[2], 16) + ';'
                        + parseInt(m[3], 16) + 'm';
                } else if ((m = cssValue.match(/rgb\(([0-9]+), *([0-9]+), *([0-9]+)\)/))) {
                    t += '\x1B['
                        + (isBackground ? 48 : 38) + ';2;'
                        + m[1] + ';'
                        + m[2] + ';'
                        + m[3] + 'm';
                }
            }
            if (lineColor) {
                encodeColor(lineColor, true);
                prevBg = lineColor;
                t += '\x1B[K'; // Erase in Line, for Background Color Erase
            }
            if (! inLineEnd) {
                if (curStyle !== prevStyle) {
                    let m = '';
                    function ifAdded(mask, value) {
                        if ((curStyle & mask) && ! (prevStyle & mask))
                            m += ';'+value;
                    }
                    function ifRemoved(mask, value) {
                        if (! (curStyle & mask) && (prevStyle & mask))
                            m += ';'+value;
                    }
                    ifRemoved(BOLD, 22);
                    ifRemoved(LIGHTER, 22);
                    ifAdded(BOLD, 1);
                    ifAdded(LIGHTER, 2);
                    ifAdded(ITALIC, 3);
                    ifAdded(UNDERLINE, 4);
                    ifAdded(BLINK, 5);
                    ifAdded(INVERSE, 7);
                    ifAdded(CROSSED_OUT, 9);
                    ifRemoved(ITALIC, 23);
                    ifRemoved(UNDERLINE, 24);
                    ifRemoved(BLINK, 25);
                    ifRemoved(INVERSE, 27);
                    ifRemoved(CROSSED_OUT, 29);
                    if (m)
                        t += '\x1B[' + m.substring(1) + 'm';
                    prevStyle = curStyle;
                }
                if (curFg !== prevFg) {
                    encodeColor(curFg, false);
                    prevFg = curFg;
                }
                if (curBg !== prevBg) {
                    encodeColor(curBg, true);
                    prevBg = curBg;
                }
            }
        }
        // Skip text that is input-line but not actual input (std="input")
        // (for example "spacer" text before a right-prompt).
        if (parent instanceof Element) {
            if (parent.getAttribute("std") === "caret")
                parent = parent.parentNode;
            if (useTabs && parent.getAttribute('dt-tab')
                && Terminal._endsWithSpaces(tnode.textContent, -1)
                && parent.firstChild instanceof Text) {
                if (tnode == parent.firstChild)
                    t += '\t';
                return;
            }
            if (parent.classList.contains("input-line"))
                return;
        }
        let style = window.getComputedStyle(parent);
        if (style["visibility"] === "hidden"
            || style["display"] === "none")
            return;
        const stdElement = Terminal._getStdElement(tnode);
        if (stdElement) {
            const promptKind = stdElement.getAttribute("prompt-kind");
            if (promptKind && (promptKind === "r" || promptKind === "c"))
                return;
        }
        let str = tnode.data.substring(start, end);
        t += str;
        if (end > start && lineNonEmpty < 2) {
            lineNonEmpty = str.trim() ? 2 : 1;
        }
    }
    function elementExit(node) {
        let endOfLine /* : string | false */ = false;
        if (DtUtil.isBlockNode(node)
            && t.length > 0 && t.charCodeAt(t.length-1) != 10) {
            endOfLine = '\n';
        }
        let lineAttr = node.getAttribute('line');
        if (lineAttr) {
            endOfLine = (softLinebreaks && node.getAttribute('breaking') === 'yes') ? '\n'
                : lineAttr === "soft" ? false : node.textContent;
        }
        const wasNonEmpty = lineNonEmpty;
        if (endOfLine !== false) {
            if (addEscapes && (prevFg || prevBg || prevStyle)) {
                t += '\x1B[m';
                prevFg = prevBg = '';
                prevStyle = 0;
            }
            lineNonEmpty = 0;
            t += endOfLine;
            if (wasNonEmpty == 2) {
                lastEnd = t.length;
            }
        }
        return false;
    }
    function lineHandler(node) { return true; }
    let scanState = { linesCount: 0, todo: Infinity, unit: "grapheme", stopAt: "",
                      wrapText: wrapText, elementExit, lineHandler };
    DtUtil.scanInRange(range, false, scanState);
    if (addEscapes && (prevFg || prevBg)) {
        t += '\x1B[m';
    }
    if (softLinebreaks) {
        // Remove space/tab/cr at end of lines, and extra newlines at end
        t = t.substring(0, lastEnd).replace(/[ \t\r]+\n/g, '\n');
    }
    return t;
}

Terminal._selectionAsText = function(options = {}, sel = window.getSelection()) {
    var hstring = "";
    for(var i = 0; i < sel.rangeCount; i++) {
        hstring += Terminal._rangeAsText(sel.getRangeAt(i), options);
    }
    return hstring;
    //return sel.toString();
}

Terminal._selectionValue = function(asHTML) {
    var sel = window.getSelection();
    var html = Terminal._selectionAsHTML(sel);
    return asHTML ? { text: html, html: "" }
    : { text: Terminal._selectionAsText({}, sel), html: html };
}

DomTerm.valueToClipboard = function(values) {
    if (DomTerm.isElectron() || DomTerm.usingQtWebEngine) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("value-to-clipboard", values);
            return true;
        } else if (DomTerm.isElectron() && electronAccess.clipboard) {
            electronAccess.clipboard.write(values);
            return true;
        }
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
        electronAccess.ipcRenderer.invoke('save-file',
                                          {defaultPath: fname}, data);
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
    this.setEditingLine(null);
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
    else if (enterToSend)
        this.processInputCharacters(enterToSend);
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
            this._caretNode.parentNode.removeChild(this._caretNode);
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
    const wasStyleSpan = this.outputContainer === this._currentStyleSpan;
    let saved = {
        before: this.outputBefore, container: this.outputContainer,
        outputInWide: this.outputInWide,
        wasStyleSpan };
    if (useFocus && this.viewCaretNode.parentNode) {
        const sel = document.getSelection();
        this.outputContainer = sel.focusNode;
        this.outputBefore = sel.focusOffset;
    } else {
        this.outputBefore = this._caretNode;
        this.outputContainer = this.outputBefore.parentNode;
    }
    this.outputInWide = false;
    if (wasStyleSpan && this._currentStyleSpan.contains(this.outputBefore))
        this._currentStyleSpan = this.outputContainer;
    this.resetCursorCache();
    return saved;
}

Terminal.prototype._popFromCaret = function(saved) {
    this.outputBefore = saved.before;
    this.outputContainer = saved.container;
    this.outputInWide = saved.outputInWide;
    if (saved.wasStyleSpan)
        this._currentStyleSpan = saved.container;
    this.resetCursorCache();
}

DomTerm.masterKeymapDefault =
    new window.browserKeymap(
        Object.assign({
            "F7": "toggle-paging-mode", // actually toogle view-paused-mode
            "Shift-F7": "enter-paging-mode",
            // FUTURE/FIXME: "Shift-F10": "context-menu", // Used by Konsole, Windows
            "F11": "toggle-fullscreen",
            "Shift-F11": "toggle-fullscreen-current-window",
            "Ctrl+Insert": "copy-text",
            "Shift-Insert": "paste-text",
            "Mod++": "window-zoom-in",
            "Mod+-": "window-zoom-out",
            "Mod+0": "window-zoom-reset",
            "Alt+Mod++": "pane-zoom-in",
            "Alt+Mod+-": "pane-zoom-out",
            "Alt+Mod+0": "pane-zoom-reset",
            "Ctrl-Shift-A": "enter-mux-mode",
            "Ctrl-Shift-F": "find-text",
            "Ctrl+Shift+L": "input-mode-cycle",
            "Ctrl+Shift+M": "toggle-paging-mode",
            "Ctrl+Shift+N": "new-window",
            // FUTURE: "Ctrl-Shift-P": "command-palette",
            "Ctrl-Shift-S": "save-as-html",
            "Ctrl-Shift-T": "new-tab",
            //"Ctrl-@": "toggle-mark-mode",
            "Ctrl-Shift-Home": "scroll-top",
            "Ctrl-Shift-End": "scroll-bottom",
            "Ctrl-Shift-PageUp": "scroll-page-up",
            "Ctrl-Shift-PageDown": "scroll-page-down"
        }, DomTerm.isMac ? {
            "Alt+Cmd+I": "toggle-developer-tools",
            "Ctrl+F2": "default-action", /* focus menubar */
            "Cmd+Up": "scroll-line-up", // iterm2 - Terminal: previous command
            "Cmd-Down": "scroll-line-down", // iterm2 - Terminal: next command
            "Shift+PageUp": "scroll-page-up", // iterm2
            "Shift+PageDown": "scroll-page-down", // iterm2
            "Cmd+PageUp": "scroll-page-up", // iterm2
            "Cmd+PageDown": "scroll-page-down", // iterm2
            "Mod-F": "find-text",
            "Mod-V": "paste-text",
            "Mod-C": "copy-text",
            "Mod-X": "cut-text",
            "Cmd+Q": "quit-domterm",
            "Cmd+W": "close-pane",
        } : {
            "Ctrl+C": "copy-text-maybe",
            "Ctrl+V": "paste-text-maybe",
            "Ctrl-Shift-F10": "focus-menubar", // Used by Konsole
            // "ContextMenu":  "context-menu",
            // "Ctrl-ContextMenu": "context-menu",
            "Ctrl-Shift-Up": "scroll-line-up",
            "Ctrl-Shift-Down": "scroll-line-down",
            "Ctrl+Shift+I": "toggle-developer-tools",
            "Ctrl-Shift-V": "paste-text",
            "Ctrl-Shift-C": "copy-text",
            "Ctrl+Shift+Q": "quit-domterm",
            "Ctrl-Shift+W": "close-pane",
            "Ctrl-Shift-X": "cut-text"
        }));
DomTerm.masterKeymap = DomTerm.masterKeymapDefault;

// "Mod-" is Cmd on Mac and Ctrl otherwise.
DomTerm.lineEditKeymapDefault = new browserKeymap( Object.assign({
    //"Tab": 'client-action',
    //"Ctrl-T": 'client-action',
    "Ctrl-@": "toggle-mark-mode",
    "Ctrl-C": DomTerm.isMac ? "client-action" : "copy-text-or-interrupt",
    "Mod+F": "find-text",
    "Ctrl-R": "backward-search-history",
    "Mod-V": "paste-text",
    "Ctrl-X": "cut-text",
    "Ctrl-Z": "client-action",
    "Ctrl-\\": "client-action",
    "Left": 'backward-char',
    "Right": 'forward-char',
    "Shift-Left": "backward-char-extend",
    "Shift-Right": "forward-char-extend",
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
    "Alt+Down": "down-paragraph-or-history",
    "Alt+Up": "up-paragraph-or-history",
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
    "Ctrl-A": "beginning-of-paragraph",
    "Ctrl-B": "backward-char",
    "Ctrl-D": "forward-delete-char-or-eof",
    "Ctrl-E": "end-of-paragraph",
    //"Ctrl-F": "forward-char",
    "Ctrl-K": "kill-line",
    "Ctrl-N": "down-paragraph-or-history",
    "Ctrl-P": "up-paragraph-or-history",
    "(keypress)": "insert-char"
}, DomTerm.isMac ? {
    "Alt+Left": 'backward-word',
    "Alt+Right": 'forward-word',
    "Alt+Shift+Left": "backward-word-extend",
    "Alt+Shift+Right": "forward-word-extend",
    "Mod+X": "cut-text",
} : {
    "F10": "focus-menubar",
    "Ctrl+Left": 'backward-word',
    "Ctrl+Right": 'forward-word',
    "Ctrl+Shift+Left": "backward-word-extend",
    "Ctrl+Shift+Right": "forward-word-extend",
    "Ctrl-Shift+X": "cut-text",
}));
DomTerm.lineEditKeymap = DomTerm.lineEditKeymapDefault;

DomTerm.pagingKeymapDefault = new browserKeymap({
    "F10": "focus-menubar",
    "F11": "toggle-fullscreen",
    "Shift-F11": "toggle-fullscreen-current-window",
    "Ctrl-C": DomTerm.isMac ? "paging-interrupt" : "paging-copy-or-interrupt",
    "Ctrl-F": "find-text",
    "Ctrl-Shift-C": "copy-text",
    "Esc": "exit-paging-mode",
    "Ctrl+Shift+M": "toggle-paging-mode",
    "a": "toggle-auto-pager",
    "0": "numeric-argument",
    "1": "numeric-argument",
    "2": "numeric-argument",
    "3": "numeric-argument",
    "4": "numeric-argument",
    "5": "numeric-argument",
    "6": "numeric-argument",
    "7": "numeric-argument",
    "8": "numeric-argument",
    "9": "numeric-argument",
    "-": "numeric-argument",
    ".": "numeric-argument",
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
    "Alt+Up": "up-paragraph",
    "Alt+Down": "down-paragraph",
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
    "Enter": "next-line-or-continue",
    "Shift-Space": "up-page",
    "Space": "down-page-or-continue",
    "'c'": "exit-pager-disable-auto",
    "'p'": "scroll-percentage",
    "'r'": "toggle-pause-mode",
    "'%'": "scroll-percentage",
    // The following should be controlled by a user preference
    // for emacs-like keybindings. FIXME
    "Alt-B": "backward-word",
    "Alt-F": "forward-word",
    "Ctrl-A": "beginning-of-paragraph",
    "Ctrl-B": "backward-char",
    "Ctrl-E": "end-of-paragraph",
    //"Ctrl-F": "forward-char",
    "Ctrl-N": "down-paragraph",
    "Ctrl-P": "up-paragraph",
    "(keypress)": "paging-keypress"
});
DomTerm.pagingKeymap = DomTerm.pagingKeymapDefault;

DomTerm.muxKeymap = new browserKeymap({
    "D": "detach-session",
    "W": "popout-tab",
    "Ctrl-W": "popout-tabset",
    "T": "new-tab",
    "Enter": "new-pane",
    "Esc": "ignore-action",
    "Left": "select-pane-left",
    "Up": "select-pane-up",
    "Right": "select-pane-right",
    "Down": "select-pane-down",
    "Mod-Left": "new-pane-left", //OLD
    "Mod-Right": "new-pane-right",
    "Mod-Down": "new-pane-below",
    "Mod-Up": "new-pane-above",
    "Alt+Left": "new-pane-left",
    "Alt+Right": "new-pane-right",
    "Alt+Down": "new-pane-below",
    "Alt+Up": "new-pane-above"
});
DomTerm.isKeyPressName = function(keyName) {
    return keyName.length >= 3 && keyName.charCodeAt(0) == 39/*"'"*/;
};

/** May be overridden. */
DomTerm.dispatchTerminalMessage = function(command, ...args) {
    return false;
}

DomTerm.doNamedCommand = function(name, pane=undefined, keyName=null) {
    let command = commandMap[name];
    if (! command)
        return; // ERROR
    if (command.context === "parent" && DomTerm.isSubWindow()) {
        DomTerm.sendParentMessage("do-command", name, keyName);
    } else {
        if (! pane)
            pane = DomTerm.focusedPane;
        if (command.context === "terminal"
            && ! (pane instanceof Terminal)) {
            const ctype = pane.kind;
            if (ctype !== "domterm" && ctype !== "dterminal"
                && ctype !== "xterminal" && ctype !== "view-saved")
                return;
            if (pane.terminal)
                command(pane, keyName);
            else if (! DomTerm.isSubWindow())
                DomTerm.sendChildMessage(pane.number, "do-command",
                                         name, keyName);
        }
        else
            command(pane, keyName);
    }
}

DomTerm.handleKey = function(map, dt, keyName, event=null) {
    let maps = typeof map == "object" && map instanceof Array ? map : [map];
    if (dt._markMode && keyName.indexOf("Shift+") < 0) {
        let skeyName = "Shift+" + keyName;
        for (let map of maps) {
            let cmd = map.lookup(skeyName);
            if (typeof cmd === "string" && cmd.endsWith("-extend")) {
                let r = commandMap[cmd](dt, keyName);
                dt.previousKeyName = keyName;
                if (r === true && event)
                    event.preventDefault();
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
            if (! command && DomTerm.isKeyPressName(keyName))
                command = map.lookup("(keypress)");
        }
        if (typeof command == "string" || command instanceof String) {
            let cmd = commandMap[command];
            if (cmd && cmd.context === 'parent'
                && DomTerm.isInIFrame()) {
                DomTerm.sendParentMessage("do-command", command, keyName);
                return true;
            }
            command = cmd;
        }
        if (command) {
            dt._didExtend = false;
            let r = typeof command == "function" ? command(dt, keyName)
                : command;
            dt.previousKeyName = keyName;
            // Don't preventDefault if r is "do-default".
            if (r === true && event)
                event.preventDefault();
            return r;
        }
    }
    return false;
};

Terminal.prototype.doLineEdit = function(keyName) {
    if (DomTerm.verbosity >= 2)
        this.log("doLineEdit "+keyName);

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
            if (this._displayInfoWidget
                && this._displayInfoWidget.firstChild instanceof Text) {
                let prefix = this._displayInfoWidget.firstChild;
                let dirstr = this.historySearchForwards ? "forward" : "backward";
                let m = prefix.data.match(/^(.*)(forward|backward)(.*)$/);
                if (m)
                    prefix.data = m[1] + dirstr + m[3];
            }
            return true;
        }
        if (keyName == "Esc" || keyName == "Enter" || keyName == "Tab"
            || keyName == "Down" || keyName == "Up"
            /*|| event.ctrlKey || event.altKey*/) {
            let miniBuffer = this._miniBuffer;
            this.removeMiniBuffer(miniBuffer);
            this.historySearchSaved = miniBuffer.textContent;
            this.historyAdd(this._inputLine.textContent, false);
            this._searchInHistoryMode = false;
            if (keyName == "Tab") {
                this.maybeFocus();
                return true;
            }
        }
    }

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
    return this.hasFocus();
}

Terminal.prototype.keyDownHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    let keyName = this.eventToKeyName(event);
    if (DomTerm.verbosity >= 2)
        this.log("key-down kc:"+key+" key:"+event.key+" code:"+event.code+" ctrl:"+event.ctrlKey+" sh:"+event.shiftKey+" alt:"+event.altKey+" meta:"+event.metaKey+" char:"+event.char+" event:"+event+" name:"+keyName+" old:"+(this._inputLine != null)+" col:"+document.getSelection().isCollapsed);

    if (! keyName && event.key)
        keyName = event.key;
    if (! this._isOurEvent(event))
        return false;
    if (this._composing > 0 || event.which === 229)
        return false;
    if (this._composing == 0)
        this._composing = -1;

    if (this._clearPendingDisplayMiscInfo()) {
    } else if (this._showingMiscInfo) {
        DomTerm.displayMiscInfo(this, false);
    } else if (keyName == "Ctrl" && this.kind !== "xterminal") {
        let keyup = (e) => {
            DomTerm.displayMiscInfo(this, true);
            this.topNode.removeEventListener("keyup", keyup, false);
            this._keyupDisplayInfo = undefined;
        }
        this._keyupDisplayInfo = keyup;
        this.topNode.addEventListener("keyup", keyup, false);
    }

    return this.processKeyDown(keyName, event);
}

Terminal.prototype.processKeyDown = function(keyName, event = null)
{
    if (this._muxMode) {
        if (DomTerm.handleKey(DomTerm.muxKeymap, this, keyName)) {
            this.exitMuxMode();
            event && event.preventDefault();
        }
        return true;
    }
    if (this._currentlyPagingOrPaused() && ! this._miniBuffer
        && this.pageKeyHandler(keyName)) {
        event && event.preventDefault();
        return true;
    }
    let editing = this.isLineEditingOrMinibuffer();
    if (editing) {
        if (! this.useStyledCaret())
            this.maybeFocus();
        if (this.doLineEdit(keyName)) {
            event && event.preventDefault();
            return true;
        }
    }
    if (DomTerm.handleKey(DomTerm.masterKeymap, this, keyName, event)) {
        return true;
    }

    if (! editing) {
        let str = this.keyNameToChars(keyName, event);
        if (str) {
            if (this.scrollOnKeystroke)
                this._enableScroll();
            event && event.preventDefault();
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
            return true;
        }
    }
    return false;
};

Terminal.prototype.keyPressHandler = function(event) {
    var key = event.keyCode ? event.keyCode : event.which;
    let keyName = this.eventToKeyName(event, "keypress");
    if (DomTerm.verbosity >= 2)
        this.log("key-press kc:"+key+" key:"+event.key+" code:"+event.keyCode+" char:"+event.keyChar+" ctrl:"+event.ctrlKey+" alt:"+event.altKey+" which:"+event.which+" name:"+keyName+" in-l:"+this._inputLine);
    if (! this._isOurEvent(event))
        return;
    if (this._composing > 0)
        return;
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
            const str = event.key;
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
    var dt = this;
    function error(str) {
        dt.log("ERROR: "+str);
    };
    if (! this.topNode)
        return;
    var node = DomTerm._currentBufferNode(this, 0);
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
    if (this.outputContainer == null)
        error("bad outputContainer (null)");
    else if (this.outputContainer instanceof Text) {
        if (typeof this.outputBefore != "number"
            || this.outputBefore < 0
            || this.outputBefore > this.outputContainer.length)
            error("bad outputContainer (null)");
    } else if (typeof this.outputBefore === "number") {
        if (this.outputContainer.nodeName !== "SPAN"
            || (value = this.outputContainer.getAttribute('content-value')) == null
            || this.outputBefore < 0
            || this.outputBefore > value.length)
            error("bad outputContainer (for numeric outputBefore)");
    } else if (this.outputBefore
               && this.outputBefore.parentNode != this.outputContainer)
        error("bad outputContainer (not parent of outputBefore)")
    else if (! isSavedSession && this.outputContainer.parentNode == null)
        error("bad outputContainer (no parent)");
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
    if (this.homeLine < 0 || this.homeLine >= nlines
        || this.homeLine + this.numRows < nlines)
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
    if (! this.initial.contains(this.outputContainer))
        error("outputContainer not in initial");
    if (this._currentPprintGroup != null
        && ! this._currentPprintGroup.contains(this.outputContainer))
        error("not in non-null pprint-group");
    for (let i = nlines; --i >= this.homeLine; )
        if (! this.initial.contains(this.lineStarts[i]))
            error("line "+i+" not in initial");
    if (this._caretNode && this._caretNode.firstElementChild)
        error("element in caret");
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
                && dt._getOuterPre(parent, 'input-line') === null)
                error("prompt not in input-line");
            if (cur.classList.contains("dt-cluster")) {
                let ch = cur.firstChild;
                if (ch instanceof Element) {
                    if (ch !== this._caretNode)
                        error("bad element child in dt-cluster");
                    ch = ch.nextSibling;
                }
                if (cur.firstChild == null || ! (ch instanceof Text))
                    error("missing text in dt-cluster");
            }
            if (istart < nlines && this.lineStarts[istart] == cur) {
                if (iend == istart && this.lineEnds[iend] == null)
                    iend++;
                if (DtUtil.isBlockNode(cur)) {
                    currentLineStart = cur;
                } else {
                    if (! currentLineStart.contains(cur))
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
        if (main.contains(this.initial))
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
        let bytes = new Uint8Array(data);
        let do_one_by_one = dt._output_byte_by_byte;
        if (do_one_by_one) { // DEBUGGING of partial sequences
            // number of trailing bytes to do one-by-one; -1 is all of them.
            let endIndex = bytes.length;
            let next = do_one_by_one < 0 ? 0 : endIndex - do_one_by_one;
            if (next > 0)
                dt.insertBytes(bytes, 0, next);
            else
                next = 0;
            for (; next < endIndex; next++)
                dt.insertBytes(bytes, next, next+1);
        } else
            dt.insertBytes(bytes);
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

DomTerm.initXtermJs = function(dt, topNode) { // OBSOLETE
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
    xterm.addOscHandler(0, function(data) { dt.setWindowTitle(data, 0); return false; });
    xterm.addOscHandler(1, function(data) { dt.setWindowTitle(data, 1); return false; });
    xterm.addOscHandler(2, function(data) { dt.setWindowTitle(data, 2); return false; });
    xterm.addOscHandler(30, function(data) { dt.setWindowTitle(data, 30); return false; });
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
            if (DtUtil.isDelimiter(str.charCodeAt(i)))
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
                // Allow dt-cluster (wide characters) and soft line-breaks.
                // Should we allow other Element types?
                if (! (previous.classList.contains("dt-cluster")
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
            for (let p = this.outputContainer; ! DtUtil.isBlockNode(p); ) {
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
    if (end-afterLen > start) {
        alink.keep_if_empty = true;
        this.insertSimpleOutput(str, start, end-afterLen);
        delete alink.keep_if_empty;
    }
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
        this._countInfoDiv = addInfoDisplay(info, this._countInfoDiv, this);
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
            let rect;
            if (this.viewCaretNode.parentNode) {
                rect = DtUtil.positionBoundingRect();
            } else {
                let cursor = this.outputBefore instanceof Element ? this.outputBefore
                    : this.outputContainer instanceof Element ? this.outputContainer
                    : this.outputContainer.parentNode;
                rect = cursor.getBoundingClientRect();
            }
            let height = count * this.actualHeight;
            let scTop = this.buffers.scrollTop;
            top = rect.y + scTop + height;
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
    const sel = document.getSelection();
    if (lineBlock) {
        const text = this._followingText(line, false, true);
        let offset = 0;
        if (text) {
            if (text.tagName == "SPAN" && text.getAttribute("line")
                && text.firstChild) {
                line = text.firstChild;
            } else
                line = text;
        }
        sel.setBaseAndExtent(line, offset, line, offset);
    } else {
        const r = new Range();
        r.setEndAfter(line);
        sel.setBaseAndExtent(r.endContainer, r.endOffset,
                             r.endContainer, r.endOffset);
    }
    this.showViewCaret(true);
    this._disableScrollOnOutput = true;
    this.scrollToCaret(null, force);
};

Terminal.prototype.scrollPage = function(count) {
    var amount = count * this.availHeight;
    if (count > 0)
        amount -= this.charHeight;
    else if (count < 0)
        amount += this.charHeight;
    this._pageScroll(amount, true);
}

Terminal.prototype.scrollLine = function(count) {
    this._pageScroll(count * this.charHeight, true);
}

Terminal.prototype.pageTop = function() {
    this.buffers.scrollTop = 0;
}

Terminal.prototype.pageBottom = function() {
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
    this.disableMouseMode(true);
    this._displayInputModeWithTimeout(this._modeInfo("P"));

    let sel = document.getSelection();
    if (sel.focusNode == null) {
        if (this._pauseLimit > 0) {
            this._pageUpOrDown("limit", false, true);
        } else {
            let before = this._caretNode;
            let parent = before.parentNode;
            if (! parent) {
                this._fixOutputPosition();
                before = this.outputBefore;
                parent = this.outputContainer;
            }
            const r = new Range();
            if (before)
                r.setEndBefore(before);
            else
                r.setNodeContents(parent);
            sel.setBaseAndExtent(r.endContainer, r.endOffset,
                                 r.endContainer, r.endOffset);
            this.showViewCaret();
            this.adjustFocusCaretStyle();
        }
    } else {
        this._updateSelected();
    }
    this.maybeFocus();
}


Terminal.prototype._exitPaging = function() {
    let cl = this.topNode.classList;
    cl.remove("focusmode");
    cl.remove("paused");
    if (! this.isLineEditing())
        this.setMarkMode(false);
    this.showViewCaret(false);
    this._pagingMode = 0;
    this.disableMouseMode(false);
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
        if (pre) {
            pre.classList.add("input-line");
            this.setEditingLine(pre);
        }
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

Terminal._setSelection = function(extend, startContainer, startBefore, container, offset) {
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
                             container, offset);
    } else
        sel.collapse(container, offset);
};

/** Move AMOUNT lines down/up (depending on if backwards is false/true).
 * If amount is "current", move with current line, depending on goalX.
 * If localLines===false: move within visble (screen) line;
 * if localLines===true: move within logical line (paragraph);
 * if localLines==="smart" (only valid if amount==="current): do "smart"
 *   move to start/end line, similar to vsCode's handling of Home/End.
 * Return number of lines we aren't able to do.
 */
Terminal.prototype.editorMoveLines =
    function(backwards, amount, extend = false, logicalLines = false)
{
    if (amount === 0)
        return 0;
    let count = amount === "current" ? 0 : amount;
    function rangeAsText(oldNode, oldOffset, newNode, newOffset, backwards) {
        const r = new Range();
        if (backwards) {
            r.setStart(newNode, newOffset);
            r.setEnd(oldNode, oldOffset);
        } else {
            r.setStart(oldNode, oldOffset);
            r.setEnd(newNode, newOffset);
        };
        return Terminal._rangeAsText(r);
    };

    // Get row number (visible line) within logical line
    const rowInLine = (startNode, startOffset, rect) => {
        let nrows = 0;
        for (;;) {
            let new_pos = DtUtil.caretMoveLine(true, rect.top, rect.bottom, startNode, startOffset, 0, false)
            if (! new_pos || ! this.buffers.contains(new_pos.parent))
                break;
            const new_rect = DtUtil.positionBoundingRect(new_pos.parent, new_pos.offset);
            if (new_rect.top >= rect.top || new_rect.bottom >= rect.bottom)
                break;
            const textTraversed = rangeAsText(startNode, startOffset,
                                              new_pos.parent, new_pos.offset,
                                              true);
            startNode = new_pos.parent;
            startOffset = new_pos.offset;
            if (textTraversed.indexOf('\n') >= 0)
                break;
            nrows++;
            rect = new_rect;
        }
        return nrows;
    }

    this._removeCaret();
    let rect, startOffset;
    const sel = document.getSelection();
    let startNode = sel.focusNode;
    if (this._pagingMode && startNode !== null) {
        startOffset = sel.focusOffset;
        rect = DtUtil.positionBoundingRect(startNode, startOffset);
    } else {
        let caret = this._caretNode;
        if (! caret || ! caret.parentNode)
            return count;
        rect = caret.getBoundingClientRect();
        startNode = caret;
        startOffset = 0;
    }
    let continueToLineEnd = logicalLines === true;
    let startPos = new DtUtil.DPosition(startNode, startOffset);
    let goalX = this.sstate.goalX;
    let goalRow;
    // Don't need currentRow/startRow unless amount=="current" OR
    // logicalInes OR goalX is unset. Should OPTIMIZE.
    let startRow = rowInLine(startNode, startOffset, rect);
    let currentRow = startRow;
    if (typeof goalX === "number") {
        goalRow = Math.trunc(goalX / this.availWidth);
        goalX = goalX % this.availWidth;
    } else {
        if (continueToLineEnd) {
            goalRow = currentRow;
        }
        goalX = rect.x;
        this.sstate.goalX = goalX + this.availWidth * currentRow;
    }
    if (amount === "current")
        this.sstate.goalX = undefined;
    let result_pos;
    let prevNode = startNode;
    let prevOffset = startOffset;
    for (;;) {
        const thisX = continueToLineEnd && currentRow + 1 < goalRow
              ? this.availWidth
              : goalX;
        let new_pos = DtUtil.caretMoveLine(backwards, rect.top, rect.bottom, prevNode, prevOffset, thisX, amount === "current" && ! continueToLineEnd);
        if (! new_pos || ! this.buffers.contains(new_pos.parent))
            break;
        if (! this._pagingMode) {
            if (! this._inputLine.contains(new_pos.parent))
                break;
            // if (in prompt or content-value) adjust
        }
        const new_rect = DtUtil.positionBoundingRect(new_pos.parent, new_pos.offset);
        if (amount !== "current") {
            if (backwards
                ? new_pos.top >= rect.top || new_pos.bottom >= rect.bottom
                : new_pos.top <= rect.top || new_pos.bottom <= rect.bottom) {
                result_pos = new_pos; // ???
                break;
            }
        }
        if (logicalLines === false && --count <= 0) {
            result_pos = new_pos;
            this.sstate.goalX = goalX
                + this.availWidth * rowInLine(new_pos.parent, new_pos.offset, new_rect);
            break;
        }
        rect = new_rect;
        if (continueToLineEnd || amount === "current") {
            // If we didn't moved over any newlines, try more.
            const textTraversed = rangeAsText(prevNode, prevOffset, new_pos.parent, new_pos.offset, backwards);
            prevNode = new_pos.parent;
            prevOffset = new_pos.offset;
            let new_line = textTraversed.indexOf('\n') >= 0;
            if (amount === "current") {
                if (new_line)
                    break;
                result_pos = new_pos;
                if (logicalLines === "smart") {
                    if (backwards) {
                        const r = new Range();
                        r.setStart(result_pos.parent, result_pos.offset);
                        r.setEndAfter(this.initial);
                        const spaces = DtUtil.skipHSpace(r);
                        const wasAtFirstNonSpace = textTraversed.length === spaces;
                        const atStartLine = ! continueToLineEnd;
                        if ((currentRow == 0 || atStartLine)
                            && spaces !== 0 && ! wasAtFirstNonSpace) {
                            result_pos = new DtUtil.DPosition(r.endContainer, r.endOffset);
                            break;
                        } else if (currentRow == 0
                                   || (atStartLine && ! wasAtFirstNonSpace
                                       && textTraversed.length > 0)) {
                            result_pos = new_pos;
                            break;
                        } else if (atStartLine) {
                            continueToLineEnd = true;
                            goalRow = 0;
                        }
                    } else {
                        if (textTraversed.length === 0) {
                            result_pos = new_pos;
                            // move to end of logical line FIXME
                            continueToLineEnd = true;
                            goalRow = Infinity;
                        } else {
                            if (! continueToLineEnd || ! new_line)
                                result_pos = new_pos;
                            if (! continueToLineEnd || new_line)
                                break;
                        }
                    }
                } else if (! continueToLineEnd && currentRow === startRow
                           && textTraversed.length > 0) {
                    break;
                }
            }
            if (new_line) {
                if (backwards)
                    currentRow = rowInLine(prevNode, prevOffset, rect);
                else
                    currentRow = 0;
                count--;
            } else {
                if (backwards) currentRow --;
                else currentRow++;
            }
            if (count < 0)
                break;
            if (count == 0 && amount !== "current"
                && (backwards ? currentRow <= goalRow : currentRow >= goalRow)) {
                if (backwards && new_line && currentRow === goalRow
                    && thisX === this.availWidth && amount !== "current") {
                    // Try again in current line with goalX.
                    amount = "current";
                    logicalLines = false;
                    continueToLineEnd = false;
                    continue;
                }
                result_pos = new_pos;
                break;
            }
        }
        result_pos = new_pos;
    }
    if (result_pos)
        Terminal._setSelection(extend, startNode, startOffset,
                               result_pos.parent, result_pos.offset);

    return count;
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
        this.extendSelection(toEnd ? -Infinity : Infinity, "grapheme", "buffer");
    }
}

Terminal.prototype.editorMoveStartOrEndLine = function(toEnd, extend=false, logicalLines=undefined) {
    if (toEnd)
        this.sstate.goalX = this.availWidth - 4; // FIXME
    else
        this.sstate.goalX = 4; // FIXME
    this.editorMoveLines(! toEnd, "current", extend, logicalLines ? true : "smart");
    return;
    let count = toEnd ? -Infinity : Infinity;
    if (extend)
        this.extendSelection(count, "grapheme", "line");
    else
        this.editMovePosition(count, "grapheme", "line");
    this.sstate.goalX = undefined; // FIXME add other places
}

Terminal.prototype.editorMoveStartOrEndInput = function(toEnd, action="move") {
    let count = toEnd ? -Infinity : Infinity;
    if (action==="extend")
        this.extendSelection(count, "grapheme", "input");
    else
        this.editMovePosition(count, "grapheme", "input");
    this.sstate.goalX = undefined; // FIXME add other places
}

Terminal.prototype._updateAutomaticPrompts = function() {
    var pattern = this.sstate.continuationPromptPattern;
    var initialPrompt = "";
    var initialPromptNode = null;//this._currentPromptNode;
    let initialPromptWidth = -1;
    if (! pattern && this._inputLine) {
        initialPromptWidth = this._inputLine.offsetLeft
            - this._inputLine.offsetParent.offsetLeft;
        if (initialPromptWidth <= 1)
            initialPromptWidth = 0;
    } else if (this._inputLine
               && this._inputLine.previousSibling instanceof Element
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
            let w, newPrompt;
            if (initialPromptWidth >= 0) {
                next.setAttribute("content-value", ' ');
                next.style.width = initialPromptWidth + 'px';
                w = (initialPromptWidth + 0.5) / this.charWidth;
                newPrompt = DomTerm.makeSpaces(w);
            } else {
                newPrompt = this._continuationPrompt(pattern, ++lineno,
                                                     initialPrompt.length);
                w = this.strWidthInContext(newPrompt, start);
            }
            let oldPrompt = next.getAttribute("content-value");
            if (oldPrompt)
                w -= this.strWidthInContext(oldPrompt, start);
            if (start._widthColumns  !== undefined)
                start._widthColumns += w;
            start._breakState = Terminal._BREAKS_UNMEASURED;
            next.lineno = lineno; // MAYBE use attribute (better save/restore)
            //next.defaultPattern = defaultPattern;
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
        && this._inputLine.contains(this.lineStarts[i]);
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

Terminal.prototype.editorInsertString = function(str, hidePassword = false, inserting=2) {
    if (this._miniBuffer) {
        let saved = this._pushToCaret();
        this.insertRawOutput(str);
        this._popFromCaret(saved);
        return;
    }
    this.editorAddLine();
    this._showPassword();
    this._updateLinebreaksStart(this.getAbsCursorLine(), true);
    for (;;) {
        let nl = str.indexOf('\n');
        let str1 = nl < 0 ? str : str.substring(0, nl);
        if (str1 != "") {
            let saved = this._pushToCaret();
            this._removeCaret();
            this._removeCaretNode();
            this.insertSimpleOutput(str1, 0, str1.length, inserting);
            this._restoreCaretNode()
            this._popFromCaret(saved);
            if (hidePassword) {
                let pwtimeout;
                if (this._inputLine.classList.contains("noecho")
                    && ! this.sstate.hiddenText
                    && (pwtimeout
                        = this.getOption("password-show-char-timeout", 0.8))) {
                    // Temporarily display inserted char(s), with dots for other chars.
                    // After timeout all chars shown as dots.
                    let r = new Range();
                    r.selectNodeContents(this._inputLine);
                    let wlength = DomTerm._countCodePoints(r.toString());
                    r.setEndBefore(this._caretNode);
                    let wbefore = DomTerm._countCodePoints(r.toString());
                    let ctext = this._inputLine.textContent;
                    let wstr = DomTerm._countCodePoints(str);
                    let pwchar = this.passwordHideChar();
                    let before = pwchar.repeat(wbefore-wstr);
                    let after = pwchar.repeat(wlength-wbefore);
                    DomTerm._replaceTextContents(this._inputLine, before + str + after);
                    this.sstate.hiddenText = ctext;
                    setTimeout(() => { this._suppressHidePassword = false;
                                       this._hidePassword(); },
                               pwtimeout * 1000);
                    this._suppressHidePassword = true;
                }

            }
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

Terminal.prototype.editorDeleteRange = function(range, toClipboard) {
    let str = range.toString();
    if (toClipboard)
        DomTerm.valueToClipboard({text: str,
                                  html: Terminal._rangeAsHTML(range)});
    let hadCaret = this._caretNode
        && range.intersectsNode(this._caretNode);
    range.deleteContents();
    if (hadCaret)
        range.insertNode(this._caretNode);
    range.commonAncestorContainer.normalize();
    this.resetCursorCache();
    let lineNum = this.getAbsCursorLine();
    this._unbreakLines(lineNum, true, null);
    let line = this.lineStarts[lineNum];
    line._widthMode = undefined;
    line._widthColumns = undefined;
    line._breakState = Terminal._BREAKS_UNMEASURED;
    this._restoreLineTables(line, lineNum, true);
    this._updateLinebreaksStart(lineNum, true);
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
 * unit: "char", "grapheme", "word"
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
    this.sstate.goalX = undefined;
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
            || (this._miniBuffer.contains(sel.focusNode)
                && this._miniBuffer.contains(sel.anchorNode)));
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
        if (action == "move" || doDelete || sel.anchorNode === null || this._miniBuffer) {
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
        DtUtil.scanInRange(range, backwards, scanState);
        linesCount = scanState.linesCount;
        todo = scanState.todo;
        if (doDelete) {
            this.editorDeleteRange(range, action == "kill");
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
    DomTerm.displaySelection();
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

Terminal.loadSavedFile = function(topNode, url) {
    if (url.startsWith("file:")) {
        url = "http://localhost:"+DomTerm.server_port
            +"/get-file/"+DomTerm.server_key
            +"/"+url.substring(5);
    }
    topNode.innerHTML = "<h2>waiting for file data ...</h2>";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.onreadystatechange = function() {
        if (xhr.readyState != 4)
            return;
        var responseText = xhr.responseText;
        if (! responseText) {
            topNode.innerHTML = "<h2>error loading "+url+"</h2>";
            return;
        }

        topNode.removeChild(topNode.firstElementChild);
        let purifyConfig = {
            RETURN_DOM_FRAGMENT: true // return a document object instead of a string

        };
        topNode.innerHTML = DtUtil.scrubHtml(responseText, {});

        let name = "domterm";
        const dt = new Terminal(name, topNode, 'view-saved'); // FIXME
        dt.initial = document.getElementById(dt.makeId("main"));
        dt._initializeDomTerm(topNode);
        dt.sstate.windowTitle = "saved by DomTerm "+topNode.getAttribute("saved-version") + " on "+topNode.getAttribute("saved-time");
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
    };
    xhr.send("");
};

/** Runs in DomTerm sub-window. */
function _muxModeInfo(dt) {
    return "(MUX mode)";
}

/** Runs in DomTerm sub-window. */
Terminal.prototype.enterMuxMode = function() {
    this._showingMuxInfo = addInfoDisplay("window (MUX) mode", this._showingMuxInfo, this);
    this._muxMode = true;
    this._updatePagerInfo();
}

/** Runs in DomTerm sub-window. */
Terminal.prototype.exitMuxMode = function() {
    DomTerm.removeInfoDisplay(this._showingMuxInfo, this);
    this._muxMode = false;
    this._updatePagerInfo();
}

window.DTerminal = Terminal;

export { DTParser };
import { Terminal } from './terminal.js';

class DTParser {
    constructor(term) {
        this.term = term;
        this.controlSequenceState = DTParser.INITIAL_STATE;
        this._urgentControlState = DTParser.INITIAL_STATE;
        this.parameters = new Array();
        this._textParameter = null;
        this._savedControlState = null;
        /** @type {Array|null} */
        this.saved_DEC_private_mode_flags = null;
    }

    /* 'bytes' should be an ArrayBufferView, typically a Uint8Array */
    insertBytes(bytes) {
        const term = this.term;
        var len = bytes.length;
        if (term.verbosity >= 2)
            term.log("insertBytes "+term.name+" "+typeof bytes+" count:"+len+" received:"+term._receivedCount);
        while (len > 0) {
            if (this.decoder == null)
                this.decoder = new TextDecoder(); //label = "utf-8");
            var urgent_begin = -1;
            var urgent_end = -1;
            for (var i = 0; i < len; i++) {
                var ch = bytes[i];
                if (ch == DTParser.URGENT_BEGIN1 && urgent_begin < 0)
                    urgent_begin = i;
                else if (ch == DTParser.URGENT_END) {
                    urgent_end = i;
                    break;
                }
            }
            var plen = urgent_begin >= 0 && (urgent_end < 0 || urgent_end > urgent_begin) ? urgent_begin
                : urgent_end >= 0 ? urgent_end : len;
            if (urgent_end > urgent_begin && urgent_begin >= 0
                && bytes[urgent_begin+1] == DTParser.URGENT_BEGIN2) {
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
                term._receivedCount = (term._receivedCount + plen) & Terminal._mask28;
                if (plen == len) {
                    len = 0;
                } else {
                    var dlen = plen + 1; // amount consumed term.iteration
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

    insertString(str) {
        const term = this.term;
        //const Terminal = window.DTerminal; // FIXME
        var slen = str.length;
        if (slen == 0)
            return;
        if (term.verbosity >= 2) {
            //var d = new Date(); var ms = (1000*d.getSeconds()+d.getMilliseconds();
            if (str.length > 200)
                term.log("insertString "+JSON.stringify(str.substring(0,200))+"... state:"+this.controlSequenceState/*+" ms:"+ms*/);
            else
                term.log("insertString "+JSON.stringify(str)+" state:"+this.controlSequenceState/*+" ms:"+ms*/);
        }
        if (term._pagingMode == 2) {
            this._textParameter = this._textParameter + str;
            return;
        }
        if (term._disableScrollOnOutput && term._scrollNeeded() == term.topNode.scrollTop)
            term._disableScrollOnOutput = false;
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
        var dt = term;
        let pendingEchoOldBefore, pendingEchoOldAfter, pendingEchoOld,
            pendingEchoBlock;
        let pendingEchoString = term._pendingEcho;
        if (term._deferredForDeletion) {
            pendingEchoBlock = term._getOuterBlock(term._caretNode);
            term._doDeferredDeletion();
            if (pendingEchoString.length > 1
                && pendingEchoBlock) {
                term._removeCaret();
                let r = document.createRange();
                r.selectNode(pendingEchoBlock);
                pendingEchoOld = r.toString();
                if (term.outputBefore == null)
                    r.setEndAfter(term.outputContainer);
                else if (typeof term.outputBefore == "number")
                    r.setEnd(term.outputContainer, term.outputBefore);
                else
                    r.setEndBefore(term.outputBefore);
                pendingEchoOldBefore = r.toString();
                pendingEchoOldAfter = pendingEchoOld.substring(pendingEchoOldBefore.length);
            }
            else
                pendingEchoString = "";
        }
        // FIXME term breaks selections overlapping the _inputLine
        if (term.useStyledCaret())
            term._removeInputLine();
        var pendingEchoNode = term._deferredForDeletion;
        var i = 0;
        var prevEnd = 0;
        var columnWidth = 0; // number of columns since prevEnv
        for (; i < slen; i++) {
            var ch = str.charCodeAt(i);
            //term.log("- insert char:"+ch+'="'+String.fromCharCode(ch)+'" state:'+this.controlSequenceState);
            var state = this.controlSequenceState;
            switch (state) {
            case DTParser.SEEN_SURROGATE_HIGH:
                // must have i==0
                str = this.parameters[0] + str;
                this.controlSequenceState = DTParser.INITIAL_STATE;
                slen++;
                i = -1;
                break;
            case DTParser.SEEN_ESC_STATE:
                this.controlSequenceState = DTParser.INITIAL_STATE;
                if (ch != 91 /*'['*/ && ch != 93 /*']'*/
                    && ! (ch >= 40 && ch <= 47) && ! (ch >= 78 && ch <= 79))
                    term._breakDeferredLines();
                switch (ch) {
                case 35 /*'#'*/:
                    this.controlSequenceState = DTParser.SEEN_ESC_SHARP_STATE;
                    break;
                case 40 /*'('*/: // Designate G0 Character Set (ISO 2022, VT100)
                    this.controlSequenceState = DTParser.SEEN_ESC_CHARSET0;
                    break;
                case 41 /*')'*/: // Designate G1 Character Set
                case 45 /*'-'*/:
                    this.controlSequenceState = DTParser.SEEN_ESC_CHARSET1;
                    break;
                case 42 /*'*'*/: // Designate G2 Character Set
                case 46 /*'.'*/:
                    this.controlSequenceState = DTParser.SEEN_ESC_CHARSET2;
                    break;
                case 43 /*'+'*/: // Designate G3 Character Set
                    this.controlSequenceState = DTParser.SEEN_ESC_CHARSET3;
                    break;
                case 47 /*'/'*/: // Designate G3 Character Set (VT300).
                    // These work for 96-character sets only.
                    // followed by A:  -> ISO Latin-1 Supplemental.
                    break; // FIXME - not implemented
                case 55 /*'7'*/: // DECSC
                    term.saveCursor(); // FIXME
                    break;
                case 56 /*'8'*/: // DECRC
                    term.restoreCursor(); // FIXME
                    break;
                case 68 /*'D'**/: // IND index
                    term.cursorNewLine(false);
                    break;
                case 69 /*'E'*/: // NEL
                    term.cursorNewLine(true);
                    break;
                case 72 /*'H'*/: // HTS Tab Set
                    term.setTabStop(term.getCursorColumn(), true);
                    break;
                case 77 /*'M'*/: // Reverse index (cursor up with scrolling)
                    var line = term.getCursorLine();
                    if (line == term._regionTop)
                        term.scrollReverse(1);
                    term.cursorDown(-1);
                    break;
                case 78 /*'N'*/: // SS2
                case 79 /*'O'*/: // SS3
                    this.controlSequenceState = ch - 78 + DTParser.SEEN_ESC_SS2;
                    break;
                case 80 /*'P'*/: // DCS
                    this.controlSequenceState = DTParser.SEEN_DCS_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._textParameter = "";
                    break;
                case 91 /*'['*/: // CSI
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._textParameter = "";
                    break;
                case 92 /*'\\'*/: // ST (String Terminator)
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 93 /*']'*/: // OSC
                case 95 /*'\\'*/: // Application Program Command (APC)
                    this.controlSequenceState =
                        ch == 93 ? DTParser.SEEN_OSC_STATE
                        : DTParser.SEEN_APC_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._textParameter = "";
                    break;
                case 99 /*'c'*/: // Full Reset (RIS)
                    term.resetTerminal(true, true);
                    break;
                case 110 /*'n'*/: // LS2
                case 111 /*'o'*/: // LS3
                    term._selectGcharset(ch-108, false);
                    break;
                case 126 /*'~'*/: // LS1R
                case 125 /*'}'*/: // LS2R
                case 124 /*'|'*/: // LS3R
                    term._selectGcharset(127-ch, true); // Not implemented
                    break;
                    //case 60 /*'<'*/: // Exit VT52 mode (Enter VT100 mode
                    //case 61 /*'='*/: // VT52 mode: Enter alternate keypad mode
                    //case 62 /*'>'*/: // VT52 mode: Enter alternate keypad mode
                default: ;
                }
                prevEnd = i + 1; columnWidth = 0;
                break;
            case DTParser.SEEN_ESC_LBRACKET_STATE:
            case DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE:
            case DTParser.SEEN_ESC_LBRACKET_EXCLAMATION_STATE:
            case DTParser.SEEN_ESC_LBRACKET_GREATER_STATE:
            case DTParser.SEEN_ESC_LBRACKET_SPACE_STATE:
            case DTParser.SEEN_DCS_STATE:
                if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                    var plen = this.parameters.length;
                    var cur = this.parameters[plen-1];
                    cur = cur ? 10 * cur : 0;
                    this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
                }
                else if (ch == 58 /*':'*/) {
                    // See https://bugzilla.gnome.org/show_bug.cgi?id=685759
                    // Term is a cheat - treat ':' same as ';'.
                    // Better would be to append digits and colons into a single
                    // string parameter.
                    this.parameters.push(null);
                }
                else if (ch == 59 /*';'*/) {
                    this.parameters.push(null);
                }
                else if (state == DTParser.SEEN_DCS_STATE) {
                    this.controlSequenceState = DTParser.SEEN_DCS_TEXT_STATE;
                    i--;
                } else if (ch == 62 /*'>'*/)
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_GREATER_STATE;
                else if (ch == 63 /*'?'*/)
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE;
                else if (ch == 33 /*'!'*/)
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_EXCLAMATION_STATE;
                else if (ch == 32/*' '*/)
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_SPACE_STATE;
                else {
                    this.handleControlSequence(ch);
                    this.parameters.length = 1;
                    prevEnd = i + 1; columnWidth = 0;
                }
                continue;

            case DTParser.SEEN_OSC_STATE:
                // if (ch == 4) // set/read color palette
                if (ch >= 48 /*'0'*/ && ch <= 57 /*'9'*/) {
                    var plen = this.parameters.length;
                    var cur = this.parameters[plen-1];
                    cur = cur ? 10 * cur : 0;
                    this.parameters[plen-1] = cur + (ch - 48 /*'0'*/);
                }
                else if (ch == 59 /*';'*/ || ch == 7 || ch == 0 || ch == 27) {
                    this.controlSequenceState = DTParser.SEEN_OSC_TEXT_STATE;
                    this.parameters.push("");
                    if (ch != 59)
                        i--; // re-read 7 or 0
                    prevEnd = i + 1; columnWidth = 0;
                } else {
                    this.parameters.length = 1;
                    prevEnd = i + 1; columnWidth = 0;
                }
                continue;
            case DTParser.SEEN_OSC_TEXT_STATE:
            case DTParser.SEEN_DCS_TEXT_STATE:
            case DTParser.SEEN_APC_STATE:
                if (ch == 7 || ch == 0 || ch == 0x9c || ch == 27) {
                    this._textParameter =
                        this._textParameter + str.substring(prevEnd, i);
                    try {
                        if (state === DTParser.SEEN_DCS_TEXT_STATE) {
                            term.handleDeviceControlString(this.parameters, this._textParameter);
                        }
                        else if (state == DTParser.SEEN_OSC_TEXT_STATE) {
                            this.handleOperatingSystemControl(this.parameters[0], this._textParameter);
                        } else {
                            // APC ignored
                        }
                    } catch (e) {
                        console.log("caught "+e);
                    }
                    this.parameters.length = 1;
                    prevEnd = i + 1; columnWidth = 0;
                    this.controlSequenceState =
                        ch == 27 ? DTParser.SEEN_ESC_STATE
                        : DTParser.INITIAL_STATE;
                } else {
                    // Do nothing, for now.
                }
                continue;
            case DTParser.SEEN_ESC_CHARSET0:
            case DTParser.SEEN_ESC_CHARSET1:
            case DTParser.SEEN_ESC_CHARSET2:
            case DTParser.SEEN_ESC_CHARSET3:
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
                var g = state-DTParser.SEEN_ESC_CHARSET0;
                term._Gcharsets[g] = cs;
                term._selectGcharset(term._Glevel, false);
                this.controlSequenceState = DTParser.INITIAL_STATE;
                prevEnd = i + 1; columnWidth = 0;
                break;
            case DTParser.SEEN_ESC_SHARP_STATE: /* SCR */
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
                    term._setRegionTB(0, -1);
                    term._setRegionLR(0, -1);
                    term.moveToAbs(term.homeLine, 0, true);
                    term.eraseDisplay(0);
                    var Es = "E".repeat(term.numColumns);
                    term._currentStyleSpan = null;
                    var savedStyleMap = term._currentStyleMap;
                    term._currentStyleMap = new Map();
                    for (var r = 0; ; ) {
                        term.insertSimpleOutput(Es, 0, term.numColumns, term.numColumns);
                        if (++r >= term.numRows)
                            break;
                        term.cursorLineStart(1);
                    }
                    term._currentStyleMap = savedStyleMap;
                    term.moveToAbs(term.homeLine, 0, true);
                    break;
                }
                prevEnd = i + 1; columnWidth = 0;
                this.controlSequenceState = DTParser.INITIAL_STATE;
                break;
            case DTParser.SEEN_ESC_SS2: // _Gcharsets[2]
            case DTParser.SEEN_ESC_SS3: // _Gcharsets[3]
                var mapper = term._Gcharsets[state-DTParser.SEEN_ESC_SS2+2];
                prevEnv = i;
                if (mapper != null) {
                    var chm = mapper(ch);
                    if (chm != null) {
                        term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                        term.insertSimpleOutput(chm, 0, chm.length, -1);
                        prevEnd = i + 1;  columnWidth = 0;
                    }
                }
                this.controlSequenceState = DTParser.INITIAL_STATE;
                break;
            case DTParser.SEEN_CR:
                if (ch != 10)
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                /* falls through */
            case DTParser.INITIAL_STATE:
            case DTParser.SEEN_ERROUT_END_STATE:
                if (DTParser._doLinkify && DTParser.isDelimiter(ch)
                    && term.linkify(str, prevEnd, i, columnWidth, ch)) {
                    prevEnd = i;
                    columnWidth = 0;
                }
                switch (ch) {
                case 13: // '\r' carriage return
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    //term.currentCursorColumn = column;
                    var oldContainer = term.outputContainer;
                    if (oldContainer instanceof Text)
                        oldContainer = oldContainer.parentNode;
                    // FIXME adjust for _regionLeft
                    if (term._currentPprintGroup !== null) {
                        this.controlSequenceState = DTParser.SEEN_CR;
                    } else if (i+1 < slen && str.charCodeAt(i+1) == 10 /*'\n'*/
                               && ! term.usingAlternateScreenBuffer
                               && (term._regionBottom == term.numRows
                                   || term.getCursorLine() != term._regionBottom-1)) {
                        if (term._pauseNeeded()) {
                            this._textParameter = str.substring(i);
                            term._updateDisplay();
                            term._enterPaging(true);
                            return;
                        }
                        term.cursorLineStart(1);
                        if (term.outputBefore instanceof Element
                            && term.outputBefore.getAttribute("expecting-echo")) {
                            term.outputBefore.removeAttribute("expecting-echo");
                            term.outputBefore = term.outputBefore.nextSibling;
                            term.resetCursorCache();
                        }
                        i++;
                    } else {
                        term._breakDeferredLines();
                        term.cursorLineStart(0);
                        this.controlSequenceState = DTParser.SEEN_CR;
                    }
                    if (oldContainer.firstChild == null
                        && oldContainer != term.outputContainer
                        && (oldContainer.getAttribute("std")
                            || oldContainer == term._currentStyleSpan)) {
                        if (term.outputBefore == oldContainer)
                            term.outputBefore = oldContainer.nextSibling;
                        let parent = oldContainer.parentNode;
                        parent.removeChild(oldContainer);
                    }
                    prevEnd = i + 1; columnWidth = 0;
                    break;
                case 10: // '\n' newline
                case 11: // vertical tab
                case 12: // form feed
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    if (term._currentPprintGroup !== null
                        && this.controlSequenceState == DTParser.SEEN_CR) {
                        this.handleOperatingSystemControl(118, "");
                    } else {
                        term._breakDeferredLines();
                        if (term._pauseNeeded()) {
                            this._textParameter = str.substring(i);
                            term._updateDisplay();
                            term._enterPaging(true);
                            return;
                        }
                        term.cursorNewLine((term.sstate.automaticNewlineMode & 1) != 0);
                    }
                    if (this.controlSequenceState == DTParser.SEEN_CR) {
                        this.controlSequenceState =  DTParser.INITIAL_STATE;
                    }
                    prevEnd = i + 1; columnWidth = 0;
                    break;
                case 27 /* Escape */:
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    var nextState = DTParser.SEEN_ESC_STATE;
                    if (state == DTParser.SEEN_ERROUT_END_STATE) {
                        // cancelled by an immediate start-of-error-output
                        if (i + 5 <= slen
                            && str.charCodeAt(i+1) == 91/*'['*/
                            && str.charCodeAt(i+2) == 49/*'1'*/
                            && str.charCodeAt(i+3) == 50/*'2'*/
                            && str.charCodeAt(i+4) == 117/*'u'*/
                            && term._getStdMode() == "error") {
                            i += 4;
                            nextState = DTParser.INITIAL_STATE;
                        } else
                            term._pushStdMode(null);
                    }
                    //term.currentCursorColumn = column;
                    prevEnd = i + 1; columnWidth = 0;
                    this.controlSequenceState = nextState;
                    continue;
                case 8 /*'\b'*/:
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    term._breakDeferredLines();
                    term.cursorLeft(1, false);
                    prevEnd = i + 1;  columnWidth = 0;
                    break;
                case 9 /*'\t'*/:
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    term._breakDeferredLines();
		    {
                        term.tabToNextStop(true);
		        let lineStart = term.lineStarts[term.getAbsCursorLine()];
		        if (lineStart._widthMode < Terminal._WIDTH_MODE_TAB_SEEN)
			    lineStart._widthMode = Terminal._WIDTH_MODE_TAB_SEEN;
                        let col = term.getCursorColumn();
		        if (lineStart._widthColumns !== undefined
                            && col > lineStart._widthColumns)
                            lineStart._widthColumns = col;
		    }
                    prevEnd = i + 1;  columnWidth = 0;
                    break;
                case 7 /*'\a'*/:
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth); 
                    //term.currentCursorColumn = column;
                    term.handleBell();
                    prevEnd = i + 1; columnWidth = 0;
                    break;
                case 24: case 26:
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 14 /*SO*/: // Switch to Alternate Character Set G1
                case 15 /*SI*/: // Switch to Standard Character Set G0
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    prevEnd = i + 1; columnWidth = 0;
                    term._selectGcharset(15-ch, false);
                    break;
                case 5 /*ENQ*/: // FIXME
                case 0: case 1: case 2:  case 3:
                case 4: case 6:
                case 16: case 17: case 18: case 19:
                case 20: case 21: case 22: case 23: case 25:
                case 28: case 29: case 30: case 31:
                    if (ch == DTParser.URGENT_COUNTED && term._savedControlState)
                        term._savedControlState.count_urgent = true;
                    // ignore
                    term.insertSimpleOutput(str, prevEnd, i, columnWidth);
                    prevEnd = i + 1; columnWidth = 0;
                    break;
                case 0x9c: // ST (String Terminator
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 0x90: // DCS
                case 0x9b: // CSI
                case 0x9d: // OSC
                case 0x9F: // APC
                    this.controlSequenceState =
                        ch == 0x9b ? DTParser.SEEN_ESC_LBRACKET_STATE
                        : ch == 0x9d ? DTParser.SEEN_OSC_STAT
                        : ch == 0x90 ? DTParser.SEEN_DCS_STATE
                        : DTParser.SEEN_APC_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._textParameter = "";
                    break;
                default:
                    var i0 = i;
                    if (ch >= 0xD800 && ch <= 0xDBFF) {
                        i++;
                        if (i == slen) {
                            term.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                            this.parameters[0] = str.charAt(i0);
                            this.controlSequenceState = DTParser.SEEN_SURROGATE_HIGH;
                            break;
                        } else {
                            ch = ((ch - 0xD800) * 0x400)
                                + ( str.charCodeAt(i) - 0xDC00) + 0x10000;
                        }
                    }
                    var chm = term.charMapper == null ? null : term.charMapper(ch);
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
                        term.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                        term.insertSimpleOutput(chm, 0, chm.length);
                        prevEnd = i + 1; columnWidth = 0;
                        break;
                    }
                    var cwidth = term.wcwidthInContext(ch, term.outputContainer);
                    if (cwidth == 2) {
                        term.insertSimpleOutput(str, prevEnd, i0, columnWidth);
                        prevEnd = i + 1; columnWidth = 0;
                        if (chm == null)
                            chm = str.substring(i0, prevEnd);
                        var wcnode = term._createSpanNode();
                        wcnode.setAttribute("class", "wc-node");
                        term._pushIntoElement(wcnode);
                        term.insertSimpleOutput(chm, 0, chm.length, 2);
                        term.popFromElement();
                        break;
                    }
                    columnWidth += cwidth;
                }
            }
        }
        if (this.controlSequenceState == DTParser.INITIAL_STATE) {
            term.insertSimpleOutput(str, prevEnd, i, columnWidth);
            //term.currentCursorColumn = column;
        }
        if (this.controlSequenceState === DTParser.SEEN_OSC_TEXT_STATE
            || this.controlSequenceState === DTParser.SEEN_DCS_TEXT_STATE) {
            this._textParameter = this._textParameter + str.substring(prevEnd, i);
        }

        // Check if output "accounts for" partial prefix of pendingEcho.
        // If so restore deferred pendingEcho for rest of old pendingEcho.
        if (pendingEchoBlock && pendingEchoString && ! term.isLineEditing()
            && pendingEchoBlock == term._getOuterBlock(term.outputContainer)) {
            term._restoreCaretNode();
            let r = document.createRange();
            r.selectNode(pendingEchoBlock);
            r.setEndBefore(term._caretNode);
            let newBefore = r.toString();
            r.selectNode(pendingEchoBlock);
            r.setStartAfter(term._caretNode);
            let newAfter = r.toString();
            let plen = pendingEchoString.length;
            let newText = newBefore + newAfter;
            let newIndex = newBefore.length;
            let insertOnly = true;
            for (let i = plen; --i >= 0; ) {
                if (pendingEchoString.charCodeAt(i) < 16) insertOnly = false;
            }
            let oldBeforeLength = pendingEchoOldBefore.length;
            let beforeDiff = newBefore.length - oldBeforeLength;
            if (insertOnly && beforeDiff >= 0 && beforeDiff <= oldBeforeLength
                && newAfter == pendingEchoOldAfter
                && (newBefore == pendingEchoOldBefore
                    + pendingEchoString.substring(0, beforeDiff))) {
                term._addPendingInput(pendingEchoString.substring(beforeDiff));
            } else {
                // slow checking for more complex pendingEcho
                let text = pendingEchoOld;
                let index = pendingEchoOldBefore.length;
                let pendingTail = null;
                for (let i = 0; i < plen; i++) {
                    let ch = pendingEchoString.charCodeAt(i);
                    if (ch >= 8) {
                        text = text.substring(0, index) + String.fromCharCode(ch) + text.substring(index);
                        index++;
                    } else {
                        let ldelta = 0;
                        let rdelta = 0;
                        switch (ch) {
                        case DTParser._PENDING_LEFT:
                            ldelta = -1; rdelta = -1; break;
                        case DTParser._PENDING_RIGHT:
                            ldelta = 1; rdelta = 1; break;
                        case DTParser._PENDING_LEFT+DTParser._PENDING_DELETE:
                            ldelta = -1; rdelta = 0; break;
                        case DTParser._PENDING_RIGHT+DTParser._PENDING_DELETE:
                            ldelta = 0; rdelta = 1; break;
                        }
                        text = text.substring(0, index+ldelta) + text.substring(index+rdelta);
                        index += ldelta;
                    }
                    if (text == newText && index == newIndex) {
                        // found match.  Note we don't stop the loop,
                        // because a later match is better than a partial match.
                        pendingTail = pendingEchoString.substring(i+1);
                    }
                }
                if (pendingTail) {
                    let plen = pendingTail.length;
                    for (let i = 0; i < plen; ) {
                        let ch = pendingTail.charCodeAt(i);
                        if (ch >= 8) {
                            let j = i+1;
                            while (j < plen && pendingTail.charCodeAt(j) >= 8)
                                j++;
                            term._addPendingInput(pendingTail.substring(i, j));
                            i = j;
                        } else {
                            let doDelete = (ch & DTParser._PENDING_DELETE) != 0;
                            let forwards = (ch & DTParser._PENDING_FORWARDS) != 0;
                            term._editPendingInput(forwards, doDelete);
                            i++;
                        }
                    }
                }
            }
        }

        if (term._pauseNeeded()) {
            this._textParameter = "";
            term.cancelUpdateDisplay();
            term._enterPaging(true);
            term._updateDisplay();
            term.topNode.scrollTop = term._pauseLimit - term.availHeight;
            return;
        }
        term.requestUpdateDisplay();
    };

    handleControlSequence(last) {
        const term = this.term;
        var param;
        var oldState = this.controlSequenceState;
        this.controlSequenceState = DTParser.INITIAL_STATE;
        if (last != 109 /*'m'*/)
            term._breakDeferredLines();
        switch (last) {
        case 64 /*'@'*/:
            var saveInsertMode = term.sstate.insertMode;
            term.sstate.insertMode = true;
            param = term.getParameter(0, 1);
            term.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param, param);
            term.cursorLeft(param, false);
            term.sstate.insertMode = saveInsertMode;
            break;
        case 65 /*'A'*/: // cursor up
            term.cursorDown(- term.getParameter(0, 1));
            break;
        case 66 /*'B'*/: // cursor down
            term.cursorDown(term.getParameter(0, 1));
            break;
        case 67 /*'C'*/:
            term.cursorRight(term.getParameter(0, 1));
            break;
        case 68 /*'D'*/:
            term.cursorLeft(term.getParameter(0, 1),
                            (term.sstate.wraparoundMode & 3) == 3);
            break;
        case 69 /*'E'*/: // Cursor Next Line (CNL)
            term._breakDeferredLines();
            term.cursorDown(term.getParameter(0, 1));
            term.cursorLineStart(0);
            break;
        case 70 /*'F'*/: // Cursor Preceding Line (CPL)
            term._breakDeferredLines();
            term.cursorDown(- term.getParameter(0, 1));
            term.cursorLineStart(0);
            break;
        case 71 /*'G'*/: // HPA- horizontal position absolute
        case 96 /*'`'*/:
            var line = term.getCursorLine();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line,
                           term.getParameter(0, 1)-1,
                           term.sstate.originMode);
            break;
        case 102 /*'f'*/:
        case 72 /*'H'*/: // CUP cursor position
            term.cursorSet(term.getParameter(0, 1)-1, term.getParameter(1, 1)-1,
                           term.sstate.originMode);
            break;
        case 73 /*'I'*/: // CHT Cursor Forward Tabulation
            for (var n = term.getParameter(0, 1);
                 --n >= 0 && term.tabToNextStop(false); ) {
            }
            break;
        case 74 /*'J'*/:
            term.eraseDisplay(term.getParameter(0, 0));
            break;
        case 75 /*'K'*/:
            param = term.getParameter(0, 0);
            if (param != 1)
                term.eraseLineRight();
            if (param >= 1)
                term.eraseLineLeft();
            break;
        case 76 /*'L'*/: // Insert lines
            term.columnSet(term._regionLeft);
            term.insertLines(term.getParameter(0, 1));
            break;
        case 77 /*'M'*/: // Delete lines
            term.columnSet(term._regionLeft);
            term.deleteLines(term.getParameter(0, 1));
            break;
        case 80 /*'P'*/: // Delete characters
            term.deleteCharactersRight(term.getParameter(0, 1));
            term._clearWrap();
            term._eraseLineEnd();
            break;
        case 83 /*'S'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                // Sixel/ReGIS graphics
                // Sixel is implemented, but not term query.
                let pi = term.getParameter(0, 1);
                term.processResponseCharacters("\x1B[?"+pi+";3;0S");
                break;
            }
            term.scrollForward(term.getParameter(0, 1));
            break;
        case 84 /*'T'*/:
            param = term.getParameter(0, 1);
            /* FIXME Initiate mouse tracking.
               if (curNumParameter >= 5) { ... }
            */
            term.scrollReverse(param);
            break;
        case 88 /*'X'*/: // Erase character (ECH)
            param = term.getParameter(0, 1);
            term.eraseCharactersRight(param);
            break;
        case 90 /*'Z'*/: // CBT Cursor Backward Tabulation
            for (var n = term.getParameter(0, 1); --n >= 0; )
                term.tabToPrevStop();
            break;
        case 97 /*'a'*/: // HPR
            var line = term.getCursorLine();
            var column = term.getCursorColumn();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line,
                           term.sstate.originMode ? column - term._regionLeft : column
                           + term.getParameter(0, 1),
                           term.sstate.originMode);
            break;
        case 98 /*'b'*/: // Repeat the preceding graphic character (REP)
            param = term.getParameter(0, 1);
            term._fixOutputPosition();
            var prev = term.outputBefore == null ? term.outputContainer.lastChild
                : term.outputBefore.previousSibling;
            if (prev instanceof Text) {
                var d = prev.data;
                var dl = d.length;
                if (dl > 0) {
                    var c1 = d.charCodeAt(dl-1);
                    var c0 = dl > 1 && c1 >= 0xDC00 && c1 <= 0xDFFF
                        ? d.charCodeAt(dl-2) : -1;
                    var w = c0 >= 0xD800 && c0 <= 0xDBFF ? 2 : 1;
                    var str = d.substring(dl-w).repeat(param);
                    term.insertSimpleOutput(str, 0, str.length, -1);
                }
            }
            break;
        case 99 /*'c'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_GREATER_STATE) {
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
                term.processResponseCharacters("\x1B[>990;"+vnum+";0c");
            } else if (oldState == DTParser.SEEN_ESC_LBRACKET_STATE) {
                // Send Device Attributes (Primary DA)
                term.processResponseCharacters("\x1B[?62;1;22c");
            }
            break;
        case 100 /*'d'*/: // VPA Line Position Absolute
            var col = term.getCursorColumn();
            term.cursorSet(term.getParameter(0, 1)-1,
                           term.sstate.originMode ? col - term._regionLeft : col,
                           term.sstate.originMode);
            break;
        case 101 /*'e'*/: // VPR
            var line = term.getCursorLine();
            var column = term.getCursorColumn();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line
                           + term.getParameter(0, 1),
                           term.sstate.originMode ? column - term._regionLeft : column,
                           term.sstate.originMode);
        case 103 /*'g'*/: // TBC Tab Clear
            param = term.getParameter(0, 0);
            if (param <= 0)
                term.setTabStop(term.getCursorColumn(), false);
            else if (param == 3)
                term.clearAllTabs();
            break;
        case 104 /*'h'*/:
            param = term.getParameter(0, 0);
            if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                // DEC Private Mode Set (DECSET)
                this.set_DEC_private_mode(param, true);
            }
            else {
                switch (param) {
                case 4:
                    term.sstate.insertMode = true;
                    break;
                case 20:
                    term.sstate.automaticNewlineMode = term.getParameter(1, 3);
                    break;
                }
            }
            break;
        case 108 /*'l'*/:
            param = term.getParameter(0, 0);
            if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                // DEC Private Mode Reset (DECRST)
                this.set_DEC_private_mode(param, false);
            } else {
                switch (param) {
                case 4:
                    term.sstate.insertMode = false;
                    break;
                case 20:
                    term.sstate.automaticNewlineMode = 0;
                    break;
                }
            }
            break;
        case 109 /*'m'*/:
            var numParameters = this.parameters.length;
            if (numParameters == 0)
                term._clearStyle();
            for (var i = 0; i < numParameters; i++) {
                param = term.getParameter(i, -1);
                if (param <= 0)
                    term._clearStyle();
                else {
                    switch (param) {
                    case 1:
                        term._pushStyle("font-weight", "bold");
                        break;
                    case 2:
                        term._pushStyle("font-weight", "lighter");
                        break;
                    case 22:
                        term._pushStyle("font-weight", null/*"normal"*/);
                        break;
                    case 3:
                        term._pushStyle("font-style", "italic");
                        break;
                    case 23:
                        term._pushStyle("font-style", null);
                        break;
                    case 4:
                        term._pushStyle("text-underline", "yes");
                        break;
                    case 24:
                        term._pushStyle("text-underline", null/*"none"*/);
                        break;
                    case 5:
                        term._pushStyle("text-blink", "yes");
                        break;
                    case 25:
                        term._pushStyle("text-blink", null);
                        break;
                    case 7:
                        term._pushStyle("reverse", "yes");
                        break;
                    case 9:
                        term._pushStyle("text-line-through", "yes");
                        break;
                    case 29:
                        term._pushStyle("text-line-through", null/*"none"*/);
                        break;
                    case 27:
                        term._pushStyle("reverse", null);
                        break;
                    case 30: term._pushFgStdColor("black"); break;
                    case 31: term._pushFgStdColor("red"); break;
                    case 32: term._pushFgStdColor("green"); break;
                    case 33: term._pushFgStdColor("yellow"); break;
                    case 34: term._pushFgStdColor("blue"); break;
                    case 35: term._pushFgStdColor("magenta"); break;
                    case 36: term._pushFgStdColor("cyan"); break;
                    case 37: term._pushFgStdColor("light-gray"); break;
                    case 38:
                    case 48:
                        var property = param==38 ? "color" : "background-color";
                        if (term.getParameter(i+1,-1) == 2
                            && numParameters >= i+5) {
                            var color = 
                                term._pushStyle(property,
                                                term.rgb(term.getParameter(i+2,0),
                                                         term.getParameter(i+3,0),
                                                         term.getParameter(i+4,0)));
                            i += 5;
                        } else if (term.getParameter(i+1,-1) == 5
                                   && numParameters >= i+2) {
                            var c = term.getParameter(i+2,0);
                            term._pushStyle(property, term.color256(c));
                            i += 2;
                        }
                        break;
                    case 39: term._pushStyle("color", null/*defaultForegroundColor*/); break;
                    case 40: term._pushBgStdColor("black"); break;
                    case 41: term._pushBgStdColor("red"); break;
                    case 42: term._pushBgStdColor("green"); break;
                    case 43: term._pushBgStdColor("yellow"); break;
                    case 44: term._pushBgStdColor("blue"); break;
                    case 45: term._pushBgStdColor("magenta"); break;
                    case 46: term._pushBgStdColor("cyan"); break;
                    case 47: term._pushBgStdColor("light-gray"); break;
                    case 49: term._pushStyle("background-color", null/*defaultBackgroundColor*/); break
                    case 90: term._pushFgStdColor("dark-gray"); break;
                    case 91: term._pushFgStdColor("light-red"); break;
                    case 92: term._pushFgStdColor("light-green"); break;
                    case 93: term._pushFgStdColor("light-yellow"); break;
                    case 94: term._pushFgStdColor("light-blue"); break;
                    case 95: term._pushFgStdColor("light-magenta"); break;
                    case 96: term._pushFgStdColor("light-cyan"); break;
                    case 97: term._pushFgStdColor("white"); break;
                    case 100: term._pushBgStdColor("dark-gray"); break;
                    case 101: term._pushBgStdColor("light-red"); break;
                    case 102: term._pushBgStdColor("light-green"); break;
                    case 103: term._pushBgStdColor("light-yellow"); break;
                    case 104: term._pushBgStdColor("light-blue"); break;
                    case 105: term._pushBgStdColor("light-magenta"); break;
                    case 106: term._pushBgStdColor("light-cyan"); break;
                    case 107: term._pushBgStdColor("white"); break;
                    }
                }
            }
            break;
        case 110 /*'n'*/:
            switch (term.getParameter(0, 0)) {
            case 5: // Device Status Report (DSR)
                term.processResponseCharacters("\x1B[0n");
                break;
            case 6: // Report Cursor Position (CPR)
                var r = term.getCursorLine();
                var c = term.getCursorColumn();
                if (c == term.numColumns)
                    c--;
                if (term.sstate.originMode) {
                    r -= term._regionTop;
                    c -= term._regionLeft;
                }
                term.processResponseCharacters("\x1B["+(r+1)+";"+(c+1)+"R");
                break;
            case 15: // request printer status
                if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                    term.processResponseCharacters("\x1B[?13n"); // No printer
                }
                break;
            case 25: // request UDK status
                if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                    term.processResponseCharacters("\x1B[?20n");
                }
                break;
            case 26:
                term.processResponseCharacters("\x1B[?27;1;0;0n");
                break;
            }
            break;
        case 112 /*'p'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_EXCLAMATION_STATE) {
                // Soft terminal reset (DECSTR)
                term.resetTerminal(false, false);
            }
            break;
        case 113 /*'q'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_SPACE_STATE) {
                // Set cursor style (DECSCUSR, VT520).
                term.setCaretStyle(term.getParameter(0, 1));
            }
            break;
        case 114 /*'r'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                // Restore DEC Private Mode Values.
                if (this.saved_DEC_private_mode_flags == null)
                    break;
                var numParameters = this.parameters.length;
                for (var i = 0; i < numParameters; i++) {
                    param = term.getParameter(i, -1);
                    var saved = this.saved_DEC_private_mode_flags[param];
                    this.set_DEC_private_mode(param, saved);
                }
            }
            // DECSTBM - set scrolling region
            var top = term.getParameter(0, 1);
            var bot = term.getParameter(1, -1);
            if (bot > term.numRows || bot <= 0)
                bot = term.numRows;
            if (bot > top) {
                term._setRegionTB(top - 1, bot);
                term.cursorSet(0, 0, term.sstate.originMode);
            }
            break;
        case 115 /*'s'*/:
            if (oldState == DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE) {
                // Save DEC Private Mode Values.
                if (this.saved_DEC_private_mode_flags == null)
                    this.saved_DEC_private_mode_flags = new Array();
                var numParameters = this.parameters.length;
                for (var i = 0; i < numParameters; i++) {
                    param = term.getParameter(i, -1);
                    this.saved_DEC_private_mode_flags[param]
                        = this.get_DEC_private_mode(param);
                }
                break;
            }
            break;
        case 116 /*'t'*/: // Xterm window manipulation.
            var w, h;
            switch (term.getParameter(0, 0)) {
            case 14:
                if (term.getParameter(1, 0) == 2) {
                    w = window.outerWidth;
                    h = window.outerHeight;
                } else {
                    w = term.availWidth;
                    h = term.availHeight;
                }
                term.processResponseCharacters("\x1B[4;"+Math.trunc(h)
                                               +";"+Math.trunc(w)+"t");
                break;
            case 18: // Report the size of the text area in characters.
                term.processResponseCharacters("\x1B[8;"+term.numRows
                                               +";"+term.numColumns+"t");
                break;
            };
            break;
        case 117 /*'u'*/:
            switch (term.getParameter(0, 0)) {
            case 11:
                this.controlSequenceState = DTParser.SEEN_ERROUT_END_STATE;
                break;
            case 12:
                term._pushStdMode("error");
                break;
            case 18: // End non-selectable prompt
                var container = term.outputContainer;
                if (container.nodeName == "SPAN"
                    && container.getAttribute("std")=="prompt") {
                    var content = container.textContent;
                    if (content != "") {
                        while (container.firstChild) {
                            container.removeChild(container.firstChild);
                        }
                        term.outputContainer.setAttribute("value", content);
                    }
                }
                // ... fall through ...
            case 13: // End (selectable) prompt
                term._pushStdMode(null);
                // Force inputLine outside prompt
                term._adjustStyle();
                break;
            case 14:
            case 24:
                var curOutput = term._currentCommandOutput;
                if (curOutput
                    && curOutput.firstChild == term.outputContainer
                    && curOutput.firstChild == curOutput.lastChild) {
                    // Term is a continuation prompt, for multiline input.
                    // Remove the _currentCommandOutput.
                    curOutput.parentNode.insertBefore(term.outputContainer, curOutput);
                    curOutput.parentNode.removeChild(curOutput);
                    if (term._currentCommandHideable)
                        term.outputContainer.setAttribute("domterm-hidden", "false");
                }

                term._pushStdMode("prompt");
                if (term._inputLine != null) {
                    if (term.getParameter(0, 0) == 24)
                        term._inputLine.setAttribute("continuation", "true");
                    else
                        term._inputLine.removeAttribute("continuation");
                }
                break;
            case 15:
                var submode = term.getParameter(1, 1);
                // 0 - client does not do line editing (no arrow key support)
                // 1 - single-line line editing (a la GNU readline)
                // 2 - first line of potentially multi-line (a la jline3)
                term._pushStdMode("input");
                var newParent = term.outputContainer;
                let prev = newParent.previousSibling;

                // If there is existing content on the current line,
                // move it into new input <span>.
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
                term._fixOutputPosition();
                term.outputBefore = newParent.firstChild;
                var ln = newParent.parentNode;
                var cl = ln.classList;
                if (submode != 0 && cl.contains("domterm-pre")
                    && ! ln.parentNode.classList.contains("input-line")) {
                    cl.add("input-line");
                    if (submode==2)
                        cl.add("multi-line-edit");
                }

                // Move old/tentative input to after previous output:
                // If the line number of the new prompt matches that of a
                // previous continuation line, move the latter to here.
                if (prev && prev.getAttribute("std")=="prompt") {
                    let lnum = prev.getAttribute("value");
                    lnum = term._getIntegerBefore(lnum || prev.textContent);
                    let gr = term._currentCommandGroup;
                    let plin;
                    let dt = term;
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
                            let pr = term._forEachElementIn(plin, fun, false, true);
                            if (pr) {
                                // FIXME broken if pr is nested
                                term.outputContainer = plin;
                                term.outputBefore = plin.firstChild;
                                term.resetCursorCache();
                                let startLine = term.getAbsCursorLine();
                                term._moveNodes(pr.nextSibling, newParent, null);
                                pr.parentNode.removeChild(pr.previousSibling);
                                pr.parentNode.removeChild(pr);
                                term.outputContainer = prev.nextSibling;
                                term.outputBefore = null;
                                // FIXME rather non-optimal
                                term._restoreLineTables(plin, startLine, true)
                                term._updateLinebreaksStart(startLine);
                                term.resetCursorCache();
                                term.cursorLineStart(1);
                            }
                        }
                    }
                }

                term._adjustStyle();
                break;
            case 16:
                var hider = term._createSpanNode();
                hider.setAttribute("std", "hider");
                term._pushIntoElement(hider);
                hider.outerStyleSpan = term._currentStyleSpan;
                term._currentStyle = hider;
                hider.parentNode.hasHider = true;
                term._currentCommandHideable = true;
                break;
            case 17:
                term.outputContainer.addEventListener("click",
                                                      term._showHideEventHandler,
                                                      true);
                if (term.isSpanNode(term.outputContainer) // sanity check
                    && term.outputContainer.getAttribute("std") == "hider") {
                    if (term.outputContainer == term._currentStyleSpan)
                        term._currentStyleSpan = term.outputContainer.outerStyle;
                    let t = term.outputContainer.firstChild;
                    if (t instanceof Text
                        && DomTerm._countCodePoints(t.data) == 2) {
                        let split = DomTerm._indexCodePoint(t.data, 1);
                        let hide = t.data.substring(0, split);
                        let show = t.data.substring(split);
                        // optimize if matching showHideMarkers
                        let markers = term.showHideMarkers;
                        let i = markers.length;
                        while ((i -= 2) >= 0
                               && (show != markers[i] || hide != markers[i+1])) {
                        }
                        if (i < 0) {
                            term.outputContainer.setAttribute("show", show);
                            term.outputContainer.setAttribute("hide", hide);
                        }
                        t.data = hide;
                        if (term.currentCursorColumn > 0)
                            term.currentCursorColumn--;
                    }
                    term.popFromElement();
                }
                break;
            case 19:
                term.freshLine();
                term.startCommandGroup(null);
                break;
            case 20:
                term.freshLine();
                break;
            case 44:
                var param = term.getParameter(1, 0);
                switch (param) {
                case 0:
                    term.popFromElement();
                    break;
                }
                break;
            case 80: // set input mode
                DomTerm.setInputMode(term.getParameter(1, 112), term);
                break;
            case 81: // get-window-contents
                DomTerm.saveWindowContents(term);
                term._removeInputLine();
                break;
            case 82:
                term._detachSaveNeeded = term.getParameter(1,1);
                break;
            case 83: // push/pop domterm-hidden span
                param = term.getParameter(1, 0);
                if (param == 0) { // pop
                    if (term.outputBefore == null) {
                        term.outputBefore = term.outputContainer.nextSibling;
                        term.outputContainer = term.outputContainer.parentNode;
                    }
                } else {
                    let span = term._createSpanNode();
                    span.setAttribute("domterm-hidden",
                                      param == 1 ? "false" : "true");
                    term._pushIntoElement(span);
                }
                break;
            case 90:
                DomTerm.newPane(term.getParameter(1, 0),
                                term.getParameter(2, 0),
                                term);
                break;
            case 91:
                term.setSessionNumber(term.getParameter(1, 0),
                                      term.getParameter(2, 0) != 0,
                                      term.getParameter(3, 0)-1);
                break;
            case 92:
                switch (term.getParameter(1, 0)) {
                case 1:
                    if (! term._autoPaging) {
                        term._autoPaging = true;
                        term._autoPagingTemporary = true;
                    }
                    break;
                case 2:
                    term._autoPagingTemporary = term.outputContainer;
                    break;
                }
                break;
            case 96:
                term._receivedCount = term.getParameter(1,0);
                term._confirmedCount = term._receivedCount;
                if (term._savedControlState)
                    term._savedControlState.receivedCount = term._receivedCount;
                break;
            case 97:
                term._replayMode = true;
                break;
            case 98:
                term._replayMode = false;
                break;
            case 99:
                if (term.getParameter(1, 0) == 99)
                    term.eofSeen();
                break;
            }
        break;
        case 120: /*'x'*/ // Request Terminal.Parameters (DECREQTPARM)
            term.processResponseCharacters("\x1B["+(term.getParameter(0, 0)+2)+";1;1;128;128;1;0x");
            break;
            //case 122 /*'z'*/: Nethack tiledata
            //    http://nethackwiki.com/wiki/Vt_tiledata
            // Partially implemented by hterm
        default:
            if (last < 32) {
                // vttest depends on term behavior
                this.insertString(String.fromCharCode(last));
                if (last != 24 && last != 26 && last != 27)
                    this.controlSequenceState = oldState;
            } else { // FIXME
            }
        }
    };

    get_DEC_private_mode(param) {
        const term = this.term;
        switch (param) {
        case 1: return term.sstate.applicationCursorKeysMode;
        case 3: return term.numColumns == 132;
        case 5: return term.topNode.getAttribute("reverse-video") != null;
        case 6: return term.sstate.originMode;
        case 7: return (term.sstate.wraparoundMode & 2) != 0;
        case 12: // Stop/start blinking cursor (AT&T 610) - sent by emacs
            return false; // FIXME
        case 25: // Hide/show cursor (DECTCEM) - sent by emacs
            return term.sstate.showCaret;
        case 45: return (term.sstate.wraparoundMode & 1) != 0;
        case 47: // fall though
        case 1047: return term.usingAlternateScreenBuffer;
        case 1048: return term.sstate.savedCursor !== undefined;
        case 1049: return term.usingAlternateScreenBuffer;
        case 2004: return term.sstate.bracketedPasteMode;
        case 9: case 1000: case 1001: case 1002: case 1003:
            return term.sstate.mouseMode == param;
        case 1004:
            return term._sendMouse;
        case 1005: case 1006: case 1015:
            return term.sstate.mouseCoordEncoding == param;
        }
    }

    /** Do DECSET or related option.
     */
    set_DEC_private_mode(param, value) {
        const term = this.term;
        switch (param) {
        case 1:
            // Application Cursor Keys (DECCKM).
            term.sstate.applicationCursorKeysMode = value;
            break;
        case 3:
            term.forceWidthInColumns(value ? 132 : 80);
            break;
        case 5: // Reverse Video (DECSCNM)
            term.setReverseVideo(value);
            break;
        case 6:
            term.sstate.originMode = value;
            break;
        case 7:
            if (value)
                term.sstate.wraparoundMode |= 2;
            else
                term.sstate.wraparoundMode &= ~2;
            break;
        case 12: // Stop/start blinking cursor (AT&T 610)
            // Not sure how term should be combined with caretStyleFromCharSeq.
            // Emacs sends term, but only to set/reset it temporarily.
            break;
        case 25: // Hide/show cursor (DECTCEM) - sent by emacs
            term.sstate.showCaret = value;
            break;
        case 45:
            if (value)
                term.sstate.wraparoundMode |= 1;
            else
                term.sstate.wraparoundMode &= ~1;
            break;
        case 9: case 1000: case 1001: case 1002: case 1003:
            var handler = term._mouseEventHandler;
            if (value) {
                term.topNode.addEventListener("wheel", handler);
            } else {
                term.topNode.removeEventListener("wheel", handler);
            }
            term.sstate.mouseMode = value ? param : 0;
            break;
        case 1004: // Send FocusIn/FocusOut events.
            term.sstate.sendFocus = true;
            break;
        case 1005: case 1006: case 1015:
            term.sstate.mouseCoordEncoding = value ? param : 0;
            break;
        case 47:
        case 1047:
            term.setAlternateScreenBuffer(value);
            break;
        case 1048:
            if (value)
                term.saveCursor();
            else
                term.restoreCursor();
            break;
        case 1049:
            if (value) {
                term.saveCursor();
                term.setAlternateScreenBuffer(true);
            } else {
                term.setAlternateScreenBuffer(false);
                term.restoreCursor();
            }
            break;
        case 2004:
            term.sstate.bracketedPasteMode = value;
            break;
        }
    };

    handleOperatingSystemControl(code, text) {
        const term = this.term;
        if (term.verbosity >= 2)
            term.log("handleOperatingSystemControl "+code+" '"+text+"'");
        if (! (code >= 110 && code <= 118))
            term._breakDeferredLines();
        switch (code) {
        case 0:
        case 1:
        case 2:
        case 30:
            term.setWindowTitle(text, code);
            break;
        case 31:
            term.topNode.setAttribute("pid", text);
            if (DomTerm.useIFrame) {
                DomTerm.sendParentMessage("set-pid", text);
            }
            break;
        case 8:
            var semi = text.indexOf(';');
            if (semi >= 0) {
                let options = text.substring(0, semi);
                let url = text.substring(semi+1);
                let oldLink = DomTerm._isInElement(term.outputContainer, "A");
                if (oldLink) {
                    while (term.outputContainer != oldLink)
                        term._popStyleSpan();
                    term._popStyleSpan();
                }
                if (url) {
                    let newLink = document.createElement("A");
                    newLink.setAttribute("href", url);
                    newLink.setAttribute("class", "plain");
                    term._pushIntoElement(newLink);
                    DomTerm._addMouseEnterHandlers(term, newLink.parentNode);
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
                term.processResponseCharacters("\x1b]"+code+";"+color+"\x1b\\");
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
                    term.topNode.style[sname] = text;
                }
            }
            break;
        case 44:
            var span = term._createSpanNode();
            span.setAttribute("class", "diagnostic");
            if (text)
                span.setAttribute("info", text);
            var options;
            try {
                options = JSON.parse("{"+text+"}");
            } catch (e) { options = {}; }
            term._pushIntoElement(span);
            break;
        case 71:
            // handle tcsetattr
            var canon = text.indexOf(" icanon ") >= 0;
            var echo = text.indexOf(" echo ") >= 0;
            var extproc = text.indexOf(" extproc ") >= 0;
            if (canon == 0 && term.isLineEditing() && term._inputLine) {
                let text = term.grabInput(term._inputLine);
                term._restoreInputLine();

                let r = new Range();
                r.selectNodeContents(term._inputLine);
                r.setStartBefore(term._caretNode);
                let afterText = r.toString();
                term.handleEnter(null);
                term.reportText(text);
                let afterCount = term.strWidthInContext(afterText, term._inputLine);
                if (afterCount > 0) {
                    term.processInputCharacters
                    (term.keyNameToChars("Left").repeat(afterCount));
                }
                term._doDeferredDeletion();
            }
            term._clientWantsEditing = canon ? 1 : 0;
            term._clientPtyEcho = echo ? 1 : 0;
            term._clientPtyExtProc = extproc ? 1 : 0;
            term.autoLazyCheckInferior = extproc ? 0 : 1;
            break;
        case 72:
            term._scrubAndInsertHTML(text);
            break;
        case 73:
        case 74:
            term._clientPtyEcho = code != 73;
            if (! term._clientWantsEditing) {
                // We sent a KEY event, and got it back, because the pty
                // is in canon mode.  Enter line-editing mode.
                let keyName, seqno, kstr;
                function extractEditKey(text) {
                    let tb1 = text.indexOf('\t');
                    let tb2 = tb1 < 0 ? -1 : text.indexOf('\t', tb1+1);
                    if (tb2 < 0)
                        tb2 = text.length;
                    keyName = tb1 < 0 ? text : text.substring(0, tb1);
                    seqno = tb1 < 0 ? -1 : JSON.parse(text.substring(tb1+1, tb2));
                    kstr = tb2 < 0 ? "?" : JSON.parse(text.substring(tb2+1));
                }
                function processEditKey(dt) {
                    dt._clientWantsEditing = 1;
                    dt.editorAddLine();
                    if (keyName == "paste")
                        dt.editorInsertString(kstr);
                    else
                        dt.doLineEdit(keyName);
                }
                let firstEditCommand = term._inputLine == null;
                extractEditKey(text);
                if (term.verbosity >= 2)
                    term.log("OSC KEY k:"+keyName+" kstr:"+term.toQuoted(kstr)+" seq:"+seqno);
                if (firstEditCommand) { 
                    processEditKey(term);
                    // If we have have sent other KEY events subsequent to the
                    // one we got back, process them now, to avoid out-of-order
                    // edits with ones that are done subsequently locally.
                    for (let i = seqno;
                         (i = (i + 1) & 31) != (term._keyEventCounter & 31); ) {
                        extractEditKey(term._keyEventBuffer[i]);
                        processEditKey(term);
                    }
                } else {
                    // We got back a KEY event which was previously handled.
                }
            }
            break;
        case 7:
            // text is pwd as URL: "file://HOST/PWD"
            // Is printed by /etc/profile.d/vte.sh on Fedora
            term.sstate.lastWorkingPath = text;
            break;
        case 777:
            // text is "\u001b]777;COMMAND"
            // Is printed by /etc/profile/vte.sh on Fedora
            break;
        case 88:
            var obj = JSON.parse(text);
            if (typeof obj.passwordHideChar == "string"
                && obj.passwordHideChar.length == 1)
                term.passwordHideChar = obj.passwordHideChar;
            if (typeof obj.passwordShowCharTimeout == "number")
                term.passwordShowCharTimeout = obj.passwordShowCharTimeout;
            if (typeof obj.deferredForDeletionTimeout == "number")
                term.deferredForDeletionTimeout = obj.deferredForDeletionTimeout;
            if (typeof obj.historyStorageKey == "string")
                term.historyStorageKey = obj.historyStorageKey;
            if (typeof obj.historyStorageMax == "number")
                term.historyStorageMax = obj.historyStorageMax;
            break;
        case 89:
            term.setSettings(JSON.parse(text));
            break;
        case 90:
            term.reportStylesheets();
            break;
        case 91:
        case 92:
            var r = term.maybeDisableStyleSheet(text, code==91);
            term.processResponseCharacters("\x9D" + r + "\n");
            break;
        case 93:
            var r = term.printStyleSheet(text);
            term.processResponseCharacters("\x9D" + r + "\n");
            break;
        case 94:
            term.addStyleRule(JSON.parse(text));
            term.measureWindow();
            break;
        case 95:
        case 96:
            var args = JSON.parse("["+text+"]");
            var r = term.loadStyleSheet(args[0], args[1]);
            if (code == 95)
                term.processResponseCharacters("\x9D" + r + "\n");
            break;
        case 102:
            DTParser.sendSavedHtml(term, term.getAsHTML(true));
            break;
        case 103: // restore saved snapshot
            var comma = text.indexOf(",");
            var rcount = Number(text.substring(0,comma));
            var data = JSON.parse(text.substring(comma+1));
            var main = term._vspacer.previousSibling;
            if (main instanceof Element &&
                main.getAttribute('class') == 'interaction') {
                term._vspacer.insertAdjacentHTML('beforebegin', data.html);
                var parent = main.parentNode;
                parent.removeChild(main);
                term.sstate = data.sstate;
                term.topNode.setAttribute("session-number",
                                          term.sstate.sessionNumber);
                if (data.alternateBuffer)
                    term.usingAlternateScreenBuffer = data.alternateBuffer;
                var dt = term;
                term._inputLine = null;
                function findInputLine(node) {
                    if (node.getAttribute('std') == 'caret')
                        dt._caretNode = node;
                    if (node.classList.contains('editing'))
                        dt._inputLine = node;
                    return true;
                };
                term.initial = DomTerm._currentBufferNode(term);
                term._forEachElementIn(parent, findInputLine);
                term.outputBefore =
                    term._inputLine != null ? term._inputLine : term._caretNode;
                term.outputContainer = term.outputBefore.parentNode;
                term.resetCursorCache();
                term._restoreLineTables(term.topNode, 0);
                dt._restoreSaveLastLine();
                DomTerm._addMouseEnterHandlers(term);
                dt._breakAllLines();
                var home_node; // FIXME
                var home_offset = -1;
                dt.homeLine = dt._computeHomeLine(home_node, home_offset,
                                                  dt.usingAlternateScreenBuffer);
                dt._receivedCount = 0;
                dt._confirmedCount = 0;
                term.updateWindowTitle();
            }
            break;
        case 104:
        case 105:
            var m = text.match(/^([0-9]+),/);
            if (m) {
                var paneOp = Number(m[1]);
                DomTerm.newPane(paneOp,
                                {type: 'component',
                                 componentName: code==104?'browser':'view-saved',
                                 url: text.substring(m[1].length+1) });
            }
            break;
        case 108:
            DomTerm.openNewWindow(term, JSON.parse(text));
            break;
        case 110: // start prettyprinting-group
            if (term._currentStyleSpan == term.outputContainer
                && term.outputContainer.classList.contains("term-style"))
                term._popStyleSpan();
            //term._adjustStyle();
            {
                let lineStart = term.lineStarts[term.getAbsCursorLine()];
                if (lineStart._widthMode < Terminal._WIDTH_MODE_PPRINT_SEEN)
	            lineStart._widthMode = Terminal._WIDTH_MODE_PPRINT_SEEN;
            }
            var ppgroup = term._createSpanNode();
            ppgroup.setAttribute("class", "pprint-group");
            text = text.trim();
            if (text) {
                var prefix = String(JSON.parse(text));
                var span = term._createSpanNode();
                span.setAttribute("class", "pprint-prefix");
                var tnode = document.createTextNode(prefix);
                span.appendChild(tnode);
                term.insertNode(span);
            }
            term._pushIntoElement(ppgroup);
            term._pushPprintGroup(ppgroup);
            if (ppgroup.parentNode.hasHider)
                ppgroup.setAttribute("domterm-hidden", "false");
            break;
        case 111: // end prettyprinting-group
            if (term._currentPprintGroup != null) {
                if (term._isAnAncestor(term.outputContainer, term._currentPprintGroup)) {
                    var saveBefore = term.outputBefore;
                    var saveContainer = term.outputContainer;
                    for (;;) {
                        var isGroup = term.outputContainer == term._currentPprintGroup;
                        term.popFromElement();
                        if (isGroup)
                            break;
                    }
                }
                term._popPprintGroup();
            }
            break;
        case 112: // adjust indentation relative to current position
        case 113: // adjust indentation relative to block start
        case 114: // add indentation string
            try {
                var span = term._createSpanNode();
                span.setAttribute("class", "pprint-indent");
                if (code == 114)
                    span.setAttribute("indentation", JSON.parse(text));
                else {
                    span.setAttribute(code == 112 ? "delta" : "block-delta", text);
                    var num = Number(text); // check formatting
                }
                term.insertNode(span);
            } catch (e) {
                term.log("bad indentation specifier '"+text+"' - caught "+e);
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
            let lineStart = term.lineStarts[term.getAbsCursorLine()];
            if (lineStart._widthMode < Terminal._WIDTH_MODE_PPRINT_SEEN)
                lineStart._widthMode = Terminal._WIDTH_MODE_PPRINT_SEEN;
            var line = term._createLineNode(kind);
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
                        var nonbreak = term._createSpanNode();
                        nonbreak.setAttribute("class", "pprint-non-break");
                        nonbreak.appendChild(document.createTextNode(nobreakStr));
                        line.appendChild(nonbreak);
                        let w = term.strWidthInContext(nobreakStr,
                                                       term.outputContainer);
                        if (lineStart._widthColumns !== undefined)
                            lineStart._widthColumns += w;
                        if (term.currentCursorColumn >= 0)
                            term.currentCursorColumn += w;
                    }
                } catch (e) {
                    term.log("bad line-break specifier '"+text+"' - caught "+e);
                }
            }
            term.insertNode(line);
            if (line.parentNode.hasHider)
                line.setAttribute("domterm-hidden", "false");
            if (term._needSectionEndList) {
                var absLine = term.getAbsCursorLine();
                while (term.lineStarts[absLine].nodeName=="SPAN")
                    absLine--;
                if (term._deferredLinebreaksStart < 0
                    || term._deferredLinebreaksStart > absLine)
                    term._deferredLinebreaksStart = absLine;
            }
            term._setPendingSectionEnds(line);
            if (kind=="required")
                term.lineStarts[term.getAbsCursorLine()].alwaysMeasureForBreak = true;
            line._needSectionEndNext = term._needSectionEndList;
            term._needSectionEndList = line;
            break;
        case 119:
            term.freshLine();
            term.startCommandGroup(text, 0); // new sibling group
            break;
        case 120:
            term.freshLine();
            term.startCommandGroup(text, 1); // new child group
            break;
        case 121:
            term.freshLine();
            term.startCommandGroup(text, -1); // exit group
            break;
        case 122:
            term.sstate.continuationPromptPattern = text;
            break;
        case 123:
            if (term._lineEditingMode == 0 && term.autoLazyCheckInferior)
                term._clientWantsEditing = 1;
            if (term.isLineEditing())
                term.editorContinueInput();
            break;
        default:
            // WTDebug.println("Saw Operating System Control #"+code+" \""+WTDebug.toQuoted(text)+"\"");
        }
    };

    pushControlState() {
        var save = {
            controlSequenceState: this.controlSequenceState,
            parameters: this.parameters,
            textParameter: this._textParameter,
            decoder: this.decoder,
            receivedCount: this._receivedCount,
            count_urgent: false,
            _savedControlState: this._savedControlState
        };
        this.controlSequenceState = this._urgentControlState;
        this.parameters = new Array();
        this._textParameter = null;
        this.decoder = new TextDecoder(); //label = "utf-8");
        this._savedControlState = save;
    }

    popControlState() {
        var saved = this._savedControlState;
        if (saved) {
            this._urgentControlState = this.controlSequenceState;
            this.controlSequenceState = saved.controlSequenceState;
            this.parameters = saved.parameters;
            this._textParameter = saved.textParameter;
            this.decoder = saved.decoder;
            this._savedControlState = saved.controlSequenceState;
            // Control sequences in "urgent messages" don't count to
            // receivedCount. (They are typically window-specific and
            // should not be replayed when another window is attached.)
            var old = this._receivedCount;
            if (saved.count_urgent)
                this._receivedCount = (this._receivedCount + 2) & Terminal._mask28;
            else
                this._receivedCount = saved.receivedCount;
        }
    }
}

// States of escape sequences handler state machine.
DTParser.INITIAL_STATE = 0;
/** We have seen ESC. */
DTParser.SEEN_ESC_STATE = 1;
/** We have seen ESC '['. */
DTParser.SEEN_ESC_LBRACKET_STATE = 2;
/** We have seen ESC '[' '?'. */
DTParser.SEEN_ESC_LBRACKET_QUESTION_STATE = 3;
/** We have seen ESC '[' '!'. */
DTParser.SEEN_ESC_LBRACKET_EXCLAMATION_STATE = 4;
/** We have seen ESC '[' '>'. */
DTParser.SEEN_ESC_LBRACKET_GREATER_STATE = 5;
/** We have seen ESC '[' ' '. */
DTParser.SEEN_ESC_LBRACKET_SPACE_STATE = 6;
/** We have seen OSC: ESC ']' or 0x9d. */
DTParser.SEEN_OSC_STATE = 7;
/** We have seen OSC numeric-parameter ';'. */
DTParser.SEEN_OSC_TEXT_STATE = 8;
/** We have seen ESC '#'. */
DTParser.SEEN_ESC_SHARP_STATE = 9;
DTParser.SEEN_ESC_CHARSET0 = 10;
DTParser.SEEN_ESC_CHARSET1 = 11;
DTParser.SEEN_ESC_CHARSET2 = 12;
DTParser.SEEN_ESC_CHARSET3 = 13;
DTParser.SEEN_ESC_SS2 = 14;
DTParser.SEEN_ESC_SS3 = 15;
DTParser.SEEN_SURROGATE_HIGH = 16;
DTParser.SEEN_CR = 17;
/** Seen but deferred a request to exit std="error" mode. */
DTParser.SEEN_ERROUT_END_STATE = 18;
DTParser.SEEN_DCS_STATE = 19;
DTParser.SEEN_DCS_TEXT_STATE = 20;
DTParser.SEEN_ACS_STATE = 21;

// These are used to delimit "out-of-bound" urgent messages.
DTParser.URGENT_BEGIN1 = 19; // '\023' - device control 3
DTParser.URGENT_BEGIN2 = 22; // '\026' - SYN synchronous idle
DTParser.URGENT_END = 20; // \024' - device control 4
DTParser.URGENT_COUNTED = 21;

window.DTParser = DTParser;

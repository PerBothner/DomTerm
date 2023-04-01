export { DTParser };
import { Terminal } from './terminal.js';
import * as DtUtil from './domterm-utils.js';

class DTParser {
    constructor(term) {
        this.term = term;
        this.controlSequenceState = DTParser.INITIAL_STATE;
        this.parameters = new Array();
        this.textParameter = null;
        // _flagChars contains contains prefix characters, and "intermediates" prefixed by ';'.
        // Thus CSI ? Ps $ p (DECRQM) should set _flagChars to "?;$".
        this._flagChars = "";
        /** @type {Array|null} */
        this.saved_DEC_private_mode_flags = null;
    }
    decodeBytes(bytes, beginIndex = 0, endIndex = bytes.length) {
        if (this.decoder == null)
            this.decoder = new TextDecoder(); //label = "utf-8");
        return this.decoder.decode(bytes.subarray(beginIndex, endIndex),
                                  {stream:true});
    }

    insertString(str) {
        if (this.encoder == null)
            this.encoder = new TextEncoder();
        let bytes = this.encoder.encode(str);
        this.parseBytes(bytes, 0, bytes.length);
    }

    parseBytes(bytes, beginIndex, endIndex) {
        if (beginIndex === endIndex)
            return;
        const term = this.term;
        if (DomTerm.verbosity >= 2) {
            //var d = new Date(); var ms = (1000*d.getSeconds()+d.getMilliseconds();
            let jstr = DomTerm.JsonLimited(this.decodeBytes(bytes, beginIndex, endIndex));
            if (term._pagingMode == 2)
                jstr += " paused";
            if (term._savedControlState)
                jstr += " urgent";
            term.log("parseBytes "+jstr+" state:"+this.controlSequenceState/*+" ms:"+ms*/);
        }
        if (term._deferredBytes) {
            bytes = term.withDeferredBytes(bytes, beginIndex, endIndex);
            beginIndex = 0;
            endIndex = bytes.length;
        }
        if (term._pagingMode == 2
            && ! (term._savedControlState
                  && term._savedControlState.urgent)) {
            term._deferredBytes =
                beginIndex == 0 && endIndex == bytes.length ? bytes
                : bytes.slice(beginIndex, endIndex);
            return;
        }
        if (term._disableScrollOnOutput && term._scrolledAtBottom())
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
        term._pendingEcho = "";
        if (term._deferredForDeletion) {
            pendingEchoBlock = term._getOuterBlock(term._caretNode);
            term._doDeferredDeletion();
            if (pendingEchoString.length > 1
                && pendingEchoBlock) {
                term._removeCaret();
                // Set pendingEchoOldBefore/pendingEchoOldAfter to string value
                // of text in pendingEchoBlock before/after current position
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
        //if (term.isLineEditing())
            term._removeInputLine();
        let i = beginIndex;
        for (; ; i++) {
            //term.log("- insert char:"+ch+'="'+String.fromCharCode(ch)+'" state:'+this.controlSequenceState);
            var state = this.controlSequenceState;
            if (state === DTParser.PAUSE_REQUESTED) {
                this.controlSequenceState = DTParser.INITIAL_STATE;
                term._deferredBytes = term.withDeferredBytes(bytes, i, endIndex);
                term._breakVisibleLines();
                term._pageUpOrDown('limit', false, true);
                term._enterPaging(true);
                term._updateDisplay();
                return;
            }
            if (i >= endIndex)
                break;
            let ch = bytes[i];
            switch (state) {
            case DTParser.SEEN_ESC_STATE:
                this.controlSequenceState = DTParser.INITIAL_STATE;
                if (ch != 91 /*'['*/ && ch != 93 /*']'*/
                    && ! (ch >= 40 && ch <= 47) && ! (ch >= 78 && ch <= 79))
                    term._breakDeferredLines();
                switch (ch) {
                case 35 /*'#'*/:
                    this.controlSequenceState = DTParser.SEEN_ESC_SHARP_STATE;
                    break;
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
                case 93 /*']'*/: // OSC
                case 94 /*'^'*/: // PM
                case 95 /*'\\'*/: // Application Program Command (APC)
                    this.controlSequenceState =
                        ch === 93 ? DTParser.SEEN_OSC_STATE
                        : ch === 80 ? DTParser.SEEN_DCS_STATE
                        : ch === 94 ? DTParser.SEEN_PM_STATE
                        : DTParser.SEEN_APC_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._flagChars = "";
                    break;
                case 91 /*'['*/: // CSI
                    this.controlSequenceState = DTParser.SEEN_ESC_LBRACKET_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    this._flagChars = "";
                    break;
                case 92 /*'\\'*/: // ST (String Terminator)
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 99 /*'c'*/: // Full Reset (RIS)
                    term.resetTerminal(1, true);
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
                default:
                    if (ch >= 0x20 && ch <= 0x2F) {
                        this.controlSequenceState =
                            DTParser.SEEN_ESC_2022_PREFIX;
                        this._flagsChars = String.fromCharCode(ch);
                    }
                }
                break;
            case DTParser.SEEN_ESC_2022_PREFIX:
                if (ch >= 0x20 && ch <= 0x2F) {
                    this._flagsChars += String.fromCharCode(ch);
                }
                else {
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    let cs = null;
                    let level = -1;
                    let set96 = false;
                    switch (this._flagsChars) {
                    case "(": // Designate G0 Character Set (ISO 2022, VT100)
                        level = 0; set96 = false; break;
                    case ")": // Designate G1 Character Set
                        level = 1; set96 = false; break;
                    case "-":
                        level = 1; set96 = true; break;
                        break;
                    case "*": // Designate G2 Character Set
                        level = 2; set96 = false; break;
                    case ".":
                        level = 2; set96 = true; break;
                    case "+": // Designate G3 Character Set
                        level = 3; set96 = false; break;
                    case "/":
                        level = 3; set96 = true; break;
                    case "/":
                        // Designate G3 Character Set (VT300).
                        // These work for 96-character sets only.
                        // followed by A:  -> ISO Latin-1 Supplemental.
                        break; // FIXME - not implemented
                    }
                    switch (ch) {
                    case 48 /*'0'*/: // DEC Special Character and Line Drawing Set.
                        cs = DomTerm.charsetSCLD;
                        break;
                    case 65 /*'A'*/: // UK
                        cs = DomTerm.charsetUK;
                        break;
                    case 66 /*'B'*/: // United States (USASCII).
                        ch = DomTerm.charset_8859_;
                        break;
                    case 71: /*'G'*/
                        if (this._flagsChars === "%") { // UTF-8
                            term.resetCharsets();
                        }
                        break;
                    default:
                    }
                    if (level >= 0) {
                        var g = level;
                        term._Gcharsets[g] = cs;
                        term._selectGcharset(g, false);
                    }
                }
                break;
            case DTParser.SEEN_ESC_LBRACKET_STATE:
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
                    if (ch === 113 /*'q'*/ && ! this._flagChars) {
                        this.controlSequenceState = DTParser.SEEN_DCS_SIXEL_STATE;
                    } else {
                        this.controlSequenceState = DTParser.SEEN_DCS_TEXT_STATE;
                        i--;
                    }
                } else if ((ch >= 60 && ch <= 63) /* in "<=>?" */
                           || (ch >= 32 && ch <= 39) /* in " !\"#$%&'" */) {
                    if (this.parameters.length)
                        this._flagChars += ";";
                    this._flagChars += String.fromCharCode(bytes[i]);
                } else {
                    this.handleControlSequence(ch);
                    this.parameters.length = 1;
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
                } else {
                    this.parameters.length = 1;
                }
                continue;
            case DTParser.SEEN_DCS_SIXEL_STATE:
                if (! window.SixelDecoder) {
                    term._deferredBytes = term.withDeferredBytes(bytes, i, endIndex);
                    if (window.SixelDecoder === undefined) {
                        window.SixelDecoder = null;
                        import('./sixel-decode.js')
                            .then(mod => {
                                mod.DecoderAsync().then(inst => {
                                    window.SixelDecoder = inst;
                                    let text = term._deferredBytes;
                                    if (text) {
                                        term._deferredBytes = undefined;
                                        term.parseBytes(text);
                                        term._maybeConfirmReceived();
                                    }
                                });
                            }).catch((e) => {
                                term.log("failed to import sixel-decode.js - "+e);
                            });
                    }
                    term._updateDisplay();
                    return;
                }
                // ... fall through ...
            case DTParser.SEEN_DCS_TEXT_STATE:
            case DTParser.SEEN_OSC_TEXT_STATE:
            case DTParser.SEEN_PM_STATE:
            case DTParser.SEEN_APC_STATE:
                for (let start = i; ; ) {
                    let found = ch == 7 || ch == 0 || ch == 27;
                    if (ch == 0x9c) {
                        // Few if any programs use 9C for String Terminator
                        // because it can be part of a UTF-8 sequence.
                        // However, Emca-48 does specify it. Ecma-48 requires
                        // parameter bytes to be 0x8-0xD or 0x20-0x7E,
                        // while 0x9c in UTF-8 must be preceded by a byte
                        // with high-bit set, so we can use that to distinguish.
                        let prev = i > start ? bytes[i-1]
                            : this.textParameter && this.textParameter.length
                            ? this.textParameter[this.textParameter.length-1]
                            : 0;
                        found = prev < 128;
                    }
                    if (! found && i + 1 < endIndex)
                        ch = bytes[++i];
                    else {
                        let end = found ? i : i+1;
                        let oldBytes = this.textParameter;
                        let newBytes = bytes.subarray(start, end);
                        let oldLen = oldBytes ? oldBytes.length : 0;
                        let narr = new Uint8Array(oldLen + end - start)
                        if (oldBytes)
                            narr.set(oldBytes);
                        narr.set(newBytes, oldLen);
                        if (found) {
                            this.controlSequenceState =
                                ch == 27 ? DTParser.SEEN_ESC_STATE
                                : DTParser.INITIAL_STATE;
                            this.textParameter = null;
                            try {
                                if (state == DTParser.SEEN_OSC_TEXT_STATE) {
                                    let text = this.decodeBytes(narr);
                                    this.handleOperatingSystemControl(this.parameters[0], text);
                                } else if (state === DTParser.SEEN_DCS_SIXEL_STATE) {
                                    this.handleSixel(narr);
                                } else if (state === DTParser.SEEN_DCS_TEXT_STATE) {
                                    this.handleDeviceControlString(this.parameters, narr);
                                } else {
                                    // APC and PM ignored
                                }
                            } catch (e) {
                            }
                        } else {
                            this.textParameter = narr;
                        }
                        break;
                    }
                }
                break;

            case DTParser.SEEN_ESC_SHARP_STATE: /* SCR */
                switch (ch) {
                case 53 /*'5'*/: // DEC single-width line (DECSWL)
                case 54 /*'6'*/: // DEC double-width line (DECDWL)
                    // DECDWL is a property of the entire current line.
                    // I.e. existing character on the current line are re-drawn.
                    // DECSWL undoes any previous DECDWL for that line.
                    // In lieu of stylesheet support, we can place each
                    // character in its own <span class="dt-cluster w2">.
                    // (ASCII characters should be replaced by full-width forms.)
                    // However, cursor motion treats each double-width
                    // character as a singe column.  FIXME
                    break;
                case 56 /*'8'*/: // DEC Screen Alignment Test (DECALN)
                    term._setRegionTB(0, -1);
                    term._setRegionLR(0, -1);
                    term.moveToAbs(term.homeLine, 0, true);
                    var Es = "E".repeat(term.numColumns);
                    term._currentStyleSpan = null;
                    var savedStyleMap = term.sstate.styleMap;
                    term.sstate.styleMap = new Map();
                    term._currentStyleSpan = null;
                    term.eraseDisplay(0);
                    for (var r = 0; ; ) {
                        term.insertSimpleOutput(Es, 0, term.numColumns);
                        if (++r >= term.numRows)
                            break;
                        term.cursorLineStart(1);
                    }
                    term.sstate.styleMap = savedStyleMap;
                    term._currentStyleSpan = null;
                    term.moveToAbs(term.homeLine, 0, true);
                    break;
                }
                this.controlSequenceState = DTParser.INITIAL_STATE;
                break;
            case DTParser.SEEN_ESC_SS2: // _Gcharsets[2]
            case DTParser.SEEN_ESC_SS3: // _Gcharsets[3]
                // not implemented
                this.controlSequenceState = DTParser.INITIAL_STATE;
                break;
            case DTParser.SEEN_CR:
                if (ch != 10)
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                /* falls through */
            case DTParser.INITIAL_STATE:
                if (term.sstate.doLinkify && DtUtil.isDelimiter(ch)
                    && term.linkify("", 0, 0, ch)) {
                }
                switch (ch) {
                case 13: // '\r' carriage return
                    //term.currentCursorColumn = column;
                    var oldContainer = term.outputContainer;
                    if (oldContainer instanceof Text)
                        oldContainer = oldContainer.parentNode;
                    this.saveOutputBefore = term.outputBefore;
                    this.saveOutputContainer = term.outputContainer;
                    // FIXME adjust for _regionLeft
                    if (term._currentPprintGroup !== null) {
                        this.controlSequenceState = DTParser.SEEN_CR;
                        break;
                    }
                    if (! term.usingAlternateScreenBuffer
                        && (term._regionBottom == term.numRows
                            || term.getCursorLine() != term._regionBottom-1)) {
                        if (i+1 < endIndex && bytes[i+1] == 10 /*'\n'*/) {
                            if (term._pauseNeeded()) {
                                i--;
                                this.controlSequenceState = DTParser.PAUSE_REQUESTED;
                                continue;
                            }
                            term.cursorLineStart(1);
                            i++;
                            break;
                        }
                        this.controlSequenceState = DTParser.SEEN_CR;
                    }
                    term._breakDeferredLines();
                    term.cursorLineStart(0);
                    break;
                case 10: // '\n' newline
                case 11: // vertical tab
                case 12: // form feed
                    if (term._currentPprintGroup !== null
                        && this.controlSequenceState == DTParser.SEEN_CR) {
                        this.handleOperatingSystemControl(118, "");
                        this.controlSequenceState = DTParser.INITIAL_STATE;
                    } else {
                        if (term._pauseNeeded()) {
                            i--;
                            this.controlSequenceState = DTParser.PAUSE_REQUESTED;
                            continue;
                        }
                        if (this.controlSequenceState == DTParser.SEEN_CR) {
                            term.outputBefore = this.saveOutputBefore;
                            term.outputContainer = this.saveOutputContainer;
                            term.resetCursorCache();
                            term.cursorLineStart(1);
                            this.controlSequenceState = DTParser.INITIAL_STATE;
                        } else
                            term.cursorNewLine((term.sstate.automaticNewlineMode & 1) != 0);
                    }
                    break;
                case 27 /* Escape */:
                    var nextState = DTParser.SEEN_ESC_STATE;
                    //term.currentCursorColumn = column;
                    this.controlSequenceState = nextState;
                    continue;
                case 8 /*'\b'*/:
                    term._breakDeferredLines();
                    term.cursorLeft(1, false);
                    break;
                case 9 /*'\t'*/:
                    term._breakDeferredLines();
		    {
                        term.tabToNextStop(true);
		        let lineStart = term.lineStarts[term.getAbsCursorLine()];
		        if (lineStart._widthMode < Terminal._WIDTH_MODE_TAB_SEEN)
			    lineStart._widthMode = Terminal._WIDTH_MODE_TAB_SEEN;
                        lineStart._breakState = Terminal._BREAKS_UNMEASURED;
                        let col = term.getCursorColumn();
		        if (lineStart._widthColumns !== undefined
                            && col > lineStart._widthColumns)
                            lineStart._widthColumns = col;
		    }
                    break;
                case 7 /*'\a'*/:
                    //term.currentCursorColumn = column;
                    term.handleBell();
                    break;
                case 24: case 26:
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 14 /*SO*/: // Switch to Alternate Character Set G1
                case 15 /*SI*/: // Switch to Standard Character Set G0
                    term._selectGcharset(15-ch, false);
                    //term._Gshift = 15-ch;
                    break;
                case 5 /*ENQ*/: // FIXME
                case 0: case 1: case 2:  case 3:
                case 4: case 6:
                case 16: case 17: case 18: case 19:
                case 20: case 21: case 22: case 23: case 25:
                case 28: case 29: case 30: case 31:
                    // ignore
                    break;
                case 0x9c: // ST (String Terminator
                    this.controlSequenceState = DTParser.INITIAL_STATE;
                    break;
                case 0x90: // DCS
                case 0x9b: // CSI
                case 0x9d: // OSC
                case 0x9e: // PM
                case 0x9F: // APC
                    this.controlSequenceState =
                        ch == 0x9b ? DTParser.SEEN_ESC_LBRACKET_STATE
                        : ch == 0x9d ? DTParser.SEEN_OSC_STATE
                        : ch == 0x90 ? DTParser.SEEN_DCS_STATE
                        : ch == 0x9e ? DTParser.SEEN_PM_STATE
                        : DTParser.SEEN_APC_STATE;
                    this.parameters.length = 1;
                    this.parameters[0] = null;
                    break;
                default:
                    let mapper = term.charMapper;
                    let tstr = "";
                    for (; i < endIndex; ) {
                        let len;
                        let ch = bytes[i];
                        if (mapper) {
                            ch = mapper(ch, bytes, i+1, endIndex);
                            // returns CH | (LEN << 21)
                            // where CH is codepoint of character seen, and
                            // LEN is number of chars consumed by CH,
                            // or 0 if a control character was seen,
                            // or -1 if an incomplete encoding was seen.
                            len = ch >> 21;
                            ch &= 0x1FFFFF;
                        } else { // handle UTF-8 inline
                            if (ch < 32) {
                                len = 0;
                            } else if (ch < 127) {
                                len = 1;
                            } else if (ch < 0xA0) {
                                len = 0;
                            } else if (ch <= 0xDF) { // 2-byte character
                                if (i + 2 > endIndex) {
                                    len = -1;
                                } else {
                                    let ch2 = bytes[i+1];
                                    if (ch2 >= 0x80 && ch2 <= 0xBF) {
                                        ch = ((ch & 0x1F) << 6)
                                            + (ch2 & 0x3F);
                                        len = 2;
                                    } else {
                                        ch = DTParser.REPLACEMENT_CHARACTER;
                                        len = ch2 >= 0x80 ? 2 : 1;
                                    }
                                }
                            } else if (ch <= 0xEF) { // 3-byte character
                                if (i + 3 > endIndex) {
                                    len = -1;
                                } else {
                                    let ch2 = bytes[i+1];
                                    let ch3 = bytes[i+2];
                                    if (ch2 >= 0x80 && ch2 <= 0xBF
                                        && ch2 >= 0x80 && ch2 <= 0xBF) {
                                        ch = ((ch & 0x0F) << 12)
                                            + ((ch2 & 0x3F) << 6)
                                            + (ch3 & 0x3F);
                                        len = 3;
                                    } else {
                                        ch = DTParser.REPLACEMENT_CHARACTER;
                                        len = ch2 < 0x80 ? 1 : ch3 < 0x80 ? 2 : 3;
                                    }
                                }
                            } else if (ch <= 0xF7) { // 4-byte character
                                if (i + 4 > endIndex) {
                                    len = -1;
                                } else {
                                    let ch2 = bytes[i+1];
                                    let ch3 = bytes[i+2];
                                    let ch4 = bytes[i+3];
                                    if (ch2 >= 0x80 && ch2 <= 0xBF
                                        && ch2 >= 0x80 && ch2 <= 0xBF
                                        && ch3 >= 0x80 && ch3 <= 0xBF) {
                                        ch = ((ch & 0x07) << 18)
                                            + ((ch2 & 0x3F) << 12)
                                            + ((ch3 & 0x3F) << 6)
                                            + (ch4 & 0x3F);
                                        len = 4;
                                    } else {
                                        ch = DTParser.REPLACEMENT_CHARACTER;
                                        len = ch2 < 0x80 ? 1 : ch3 < 0x80 ? 2
                                            : ch4 < 0x80 ? 3 : 4;
                                    }
                                }
                            } else {
                                ch = DTParser.REPLACEMENT_CHARACTER;
                                len = 1;
                            }
                        }
                        if (len < 0) {// ??
                            // incomplete character
                            term._deferredBytes = bytes.slice(i, endIndex);
                            i = endIndex;
                            break;
                        } else if (len == 0) {
                            if (tstr.length == 0)
                                i++; // ignore character
                            break;
                        } else {
                            if (ch <= 0xFFFF) {
                                tstr += String.fromCharCode(ch);
                            } else {
                                ch -= 0x10000;
                                tstr += String.fromCharCode((ch >> 10) + 0xD800)
                                    + String.fromCharCode((ch % 0x400) + 0xDC00);
                            }
                            i += len;
                        }
                    }
                    if (tstr) {
                        let tstart = 0;
                        let tend = tstr.length;
                        // Start checking for delimiters at 1, since we already tested the
                        // initial byte at the head of case DTParser.INITIAL_STATE.
                        for (let ti = 1; ; ti++) {
                            let tch = ti < tend ? tstr.charCodeAt(ti)
                                : i < endIndex ? bytes[i] : 'X';
                            if (term.sstate.doLinkify
                                && DtUtil.isDelimiter(tch)
                                && term.linkify(tstr, tstart, ti, tch)) {
                                tstart = ti;
                            }
                            if (ti == tend) {
                                term.insertSimpleOutput(tstr, tstart, tend);
                                break;
                            }
                        }
                    }
                    i--; // compensate for increment in 'for'
                    continue;
                }
                break;
            }
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
                        case Terminal._PENDING_LEFT:
                            ldelta = -1; rdelta = -1; break;
                        case Terminal._PENDING_RIGHT:
                            ldelta = 1; rdelta = 1; break;
                        case Terminal._PENDING_LEFT+Terminal._PENDING_DELETE:
                            ldelta = -1; rdelta = 0; break;
                        case Terminal._PENDING_RIGHT+Terminal._PENDING_DELETE:
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
                            let doDelete = (ch & Terminal._PENDING_DELETE) != 0;
                            let forwards = (ch & Terminal._PENDING_FORWARDS) != 0;
                            term._editPendingInput(forwards, doDelete);
                            i++;
                        }
                    }
                }
            }
        }
        if (term._deferredBytes && DomTerm.verbosity >= 3) {
            let jstr = DomTerm.JsonLimited(this.decodeBytes(term._deferredBytes));;
            term.log("deferred by parseBytes "+jstr);
        }
        term.requestUpdateDisplay();
    }

    handleControlSequence(last) {
        const term = this.term;
        var param, param1;
        var oldState = this.controlSequenceState;
        this.controlSequenceState = DTParser.INITIAL_STATE;
        if (last !== 109 /*'m'*/ && last !== 117 /*'u'*/) // FIXME
            term._breakDeferredLines();
        switch (last) {
        case 64 /*'@'*/: { // ICH - insert character
            let saveInsertMode = term.sstate.insertMode;
            let row = term.getAbsCursorLine();
            let col = term.getCursorColumn();
            term.sstate.insertMode = true;
            param = this.getParameterOneIfDefault(0);
            if (col === term.numColumns) {
                col--;
                term.moveToAbs(row, col, false);
            }
            term.insertSimpleOutput(DomTerm.makeSpaces(param), 0, param);
            term.moveToAbs(row, col, false);
            term.sstate.insertMode = saveInsertMode;
            break;
        }
        case 65 /*'A'*/: // CUU - cursor up
            term.cursorDown(- this.getParameterOneIfDefault(0));
            break;
        case 66 /*'B'*/: // CUD - cursor down
            term.cursorDown(this.getParameterOneIfDefault(0));
            break;
        case 67 /*'C'*/: // CUF
            term.cursorRight(this.getParameterOneIfDefault(0));
            break;
        case 68 /*'D'*/: // CUB
            term.cursorLeft(this.getParameterOneIfDefault(0),
                            (term.sstate.wraparoundMode & 3) == 3);
            break;
        case 69 /*'E'*/: // Cursor Next Line (CNL)
            term._breakDeferredLines();
            term.cursorDown(this.getParameter(0, 1));
            term.cursorLineStart(0);
            break;
        case 70 /*'F'*/: // Cursor Preceding Line (CPL)
            term._breakDeferredLines();
            term.cursorDown(- this.getParameter(0, 1));
            term.cursorLineStart(0);
            break;
        case 71 /*'G'*/: // HPA- horizontal position absolute
        case 96 /*'`'*/:
            var line = term.getCursorLine();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line,
                           this.getParameterOneIfDefault(0)-1,
                           term.sstate.originMode);
            break;
        case 102 /*'f'*/:
        case 72 /*'H'*/: // CUP cursor position
            term.cursorSet(this.getParameterOneIfDefault(0)-1,
                           this.getParameterOneIfDefault(1)-1,
                           term.sstate.originMode);
            break;
        case 73 /*'I'*/: // CHT Cursor Forward Tabulation
            for (var n = this.getParameterOneIfDefault(0);
                 --n >= 0 && term.tabToNextStop(false); ) {
            }
            break;
        case 74 /*'J'*/:
            term.eraseDisplay(this.getParameter(0, 0));
            break;
        case 75 /*'K'*/:
            param = this.getParameter(0, 0);
            if (param != 1)
                term.eraseLineRight();
            if (param >= 1)
                term.eraseLineLeft();
            break;
        case 76 /*'L'*/: // IL - Insert lines
            term.columnSet(term._regionLeft);
            term.insertLines(this.getParameterOneIfDefault(0));
            break;
        case 77 /*'M'*/: // DL - Delete lines
            term.columnSet(term._regionLeft);
            term.deleteLines(this.getParameterOneIfDefault(0));
            break;
        case 80 /*'P'*/: // DCH - Delete characters
            term.deleteCharactersRight(this.getParameterOneIfDefault(0));
            term._clearWrap();
            term._eraseLineEnd();
            break;
        case 83 /*'S'*/:
            if (this._flagChars.indexOf('?') >= 0) {
                // Sixel/ReGIS graphics
                // Sixel is implemented, but not term query.
                let pi = this.getParameter(0, 1);
                term.processResponseCharacters("\x1B[?"+pi+";3;0S");
                break;
            } else { // Scroll up
                let count = this.getParameter(0, 1);
                let saved_home = term.homeLine;
                term.moveToAbs(term.getAbsCursorLine()+count, term.getCursorColumn(), true);
                const newHome = saved_home + count;
                if (newHome < term.lineStarts.length)
                    term.homeLine = newHome;
            }
            break;
        case 84 /*'T'*/:
            /* FIXME Initiate mouse tracking.
               if (curNumParameter >= 5) { ... }
            */
            param = this.getParameterOneIfDefault(0);
            term.scrollReverse(param);
            break;
        case 88 /*'X'*/: // Erase character (ECH)
            param = this.getParameterOneIfDefault(0);
            term.eraseCharactersRight(param);
            break;
        case 90 /*'Z'*/: // CBT Cursor Backward Tabulation
            for (var n = this.getParameterOneIfDefault(0); --n >= 0; )
                term.tabToPrevStop();
            break;
        case 97 /*'a'*/: // HPR
            var line = term.getCursorLine();
            var column = term.getCursorColumn();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line,
                           term.sstate.originMode ? column - term._regionLeft : column
                           + this.getParameterOneIfDefault(0),
                           term.sstate.originMode);
            break;
        case 98 /*'b'*/: // Repeat the preceding graphic character (REP)
            param = this.getParameter(0, 1);
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
                    term.insertSimpleOutput(str, 0, str.length);
                }
            }
            break;
        case 99 /*'c'*/:
            if (this._flagChars.indexOf('>') >= 0) {
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
                let response = "\x1B[>990;"+vnum+";0c";
                //let response = "\x1B[>65;5003;1c"; // GNOME terminal 3.36.1.1
                //let response = "\x1B[>41;351;0c"; // xterm 352
                //let response = "x1B[>0;115;0c"; // Konsole 20.04.1
                //let response = "\x1B[>0;276;0c"; // xterm.js
                term.processResponseCharacters(response);
            } else if (this._flagChars.indexOf('=') >= 0) {
                // Send Device Attributes (Tertiary DA).
                term.processResponseCharacters("\x1BP!|00000000\x1B\\");
            } else if (oldState == DTParser.SEEN_ESC_LBRACKET_STATE) {
                // Send Device Attributes (Primary DA)
                // VT220; 132 columns; Sixel; color
                term.processResponseCharacters("\x1B[?62;1;4;22;100c");
            }
            break;
        case 100 /*'d'*/: // VPA Line Position Absolute
            var col = term.getCursorColumn();
            term.cursorSet(this.getParameterOneIfDefault(0)-1,
                           term.sstate.originMode ? col - term._regionLeft : col,
                           term.sstate.originMode);
            break;
        case 101 /*'e'*/: // VPR
            var line = term.getCursorLine();
            var column = term.getCursorColumn();
            term.cursorSet(term.sstate.originMode ? line - term._regionTop : line
                           + this.getParameterOneIfDefault(0),
                           term.sstate.originMode ? column - term._regionLeft : column,
                           term.sstate.originMode);
        case 103 /*'g'*/: // TBC Tab Clear
            param = this.getParameter(0, 0);
            if (param <= 0)
                term.setTabStop(term.getCursorColumn(), false);
            else if (param == 3)
                term.clearAllTabs();
            break;
        case 104 /*'h'*/:
            if (this._flagChars.indexOf('?') >= 0) {
                // DEC Private Mode Set (DECSET)
                let numParameters = this.parameters.length;
                for (let i = 0; i < numParameters; i++) {
                    this.set_DEC_private_mode(this.getParameter(i, 0), true);
                }
            }
            else {
                param = this.getParameter(0, 0);
                switch (param) {
                case 4:
                    term.sstate.insertMode = true;
                    break;
                case 20:
                    term.sstate.automaticNewlineMode = this.getParameter(1, 3);
                    break;
                }
            }
            break;
        case 108 /*'l'*/:
            if (this._flagChars.indexOf('?') >= 0) {
                // DEC Private Mode Reset (DECRST)
                let numParameters = this.parameters.length;
                for (let i = 0; i < numParameters; i++) {
                    this.set_DEC_private_mode(this.getParameter(i, 0), false);
                }
            } else {
                param = this.getParameter(0, 0);
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
            if (this._flagChars.indexOf('>') >= 0) {
                switch (this.getParameter(0, -1)) {
                case 4: // modifyOtherKeys
                    // Emacs sends "\e[>4;1m" to initialize; "\e[>4m" to reset
                    let value = this.getParameter(1, -1);
                    term.sstate.modifyOtherKeys = value < 0 ? undefined : value;
                    break;
                }
                break;
            }
            if (numParameters == 0)
                term._clearStyle();
            for (var i = 0; i < numParameters; i++) {
                param = this.getParameter(i, -1);
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
                    case 30: case 31: case 32: case 33:
                    case 34: case 35: case 36: case 37:
                        term._pushFgStdColor(Terminal.colorNames[param-30]);
                        break;
                    case 38:
                    case 48:
                        var property = param==38 ? "color" : "background-color";
                        if (this.getParameter(i+1,-1) == 2
                            && numParameters > i+4) {
                            var color = 
                                term._pushStyle(property,
                                                DtUtil.rgb(this.getParameter(i+2,0),
                                                           this.getParameter(i+3,0),
                                                           this.getParameter(i+4,0)));
                            i += 4;
                        } else if (this.getParameter(i+1,-1) == 5
                                   && numParameters > i+2) {
                            var c = this.getParameter(i+2,0);
                            term._pushStyle(property, DtUtil.color256(c));
                            i += 2;
                        }
                        break;
                    case 39: term._pushStyle("color", null/*defaultForegroundColor*/); break;
                    case 40: case 41: case 42: case 43:
                    case 44: case 45: case 46: case 47:
                        term._pushBgStdColor(Terminal.colorNames[param-40]);
                        break;
                    case 49:
                        term._pushStyle("background-color", null/*defaultBackgroundColor*/);
                        break;
                    case 90: case 91: case 92: case 93:
                    case 94: case 95: case 96: case 97:
                        term._pushFgStdColor(Terminal.colorNames[param-90+8]);
                        break;
                    case 100: case 101: case 102: case 103:
                    case 104: case 105: case 106: case 107:
                        term._pushBgStdColor(Terminal.colorNames[param-100+8]);
                        break;
                    }
                }
            }
            break;
        case 110 /*'n'*/:
            switch (this.getParameter(0, 0)) {
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
                if (this._flagChars.indexOf('?') >= 0) {
                    term.processResponseCharacters("\x1B[?13n"); // No printer
                }
                break;
            case 25: // request UDK status
                if (this._flagChars.indexOf('?') >= 0) {
                    term.processResponseCharacters("\x1B[?20n");
                }
                break;
            case 26:
                term.processResponseCharacters("\x1B[?27;1;0;0n");
                break;
            }
            break;
        case 112 /*'p'*/:
            if (this._flagChars.indexOf('!') >= 0) {
                // Soft terminal reset (DECSTR)
                term.resetTerminal(0, false);
            } else if (this._flagChars.indexOf('"') >= 0) {
                // Set conformance level (DECSCL)
            } else if (this._flagChars === ";$" || this._flagChars === "?;$") { // DECRQM
                const ps = this.getParameter(0, 0);
                const m = this._flagChars === ";$" ? this.get_mode(ps) : this.get_DEC_private_mode(ps);
                term.processResponseCharacters(`\x1B[?${ps};${m ? 1 : m === true ? 2 : 0}$y`);
            }
            break;
        case 113 /*'q'*/:
            if (this._flagChars === ' ') {
                // Set cursor style (DECSCUSR, VT520).
                let style = this.getParameter(0, 1);
                if (style > 0 && style < Terminal.caretStyles.length) {
                    term.sstate.caretStyleFromCharSeq = style;
                    this.caretCharStyle = style;
                } else {
                    term.sstate.caretStyleFromCharSeq = -1;
                    this.caretCharStyle = this.caretStyleFromSettings;
                }
            } else if (this._flagChars === '>') { // XTVERSION
                const version = `DomTerm(${DomTerm.versionString})`;
                term.processResponseCharacters(`\x1BP>|${version}\x1B\\`);
            }
            break;
        case 114 /*'r'*/:
            if (this._flagChars.indexOf('?') >= 0) {
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
            var top = Math.max(this.getParameter(0, 1), 1);
            var bot = this.getParameter(1, -1);
            if (bot > term.numRows || bot <= 0)
                bot = term.numRows;
            if (bot > top) {
                term._setRegionTB(top - 1, bot);
                term.cursorSet(0, 0, term.sstate.originMode);
            }
            break;
        case 115 /*'s'*/:
            if (this._flagChars.indexOf('?') >= 0) {
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
            } else if (this._flagChars == '') {
                term.saveCursor();
            }
            break;
        case 116 /*'t'*/: // Xterm window manipulation.
            if (this._flagChars == '') { // Window manipulation (XTWINOPS)
                let w, h;
                switch (this.getParameter(0, 0)) {
                case 1:
                    DomTerm.windowOp('show');
                    break;
                case 2:
                    const sub = this.getParameter(1, 0);
                    let wop = null;
                    switch (sub) {
                    case 72:
                        wop = 'hide';
                        break;
                    case 73:
                    case 74:
                        if (document.hidden)
                            wop = 'show';
                        else if (sub == 73)
                            wop = 'minimize';
                        else
                            wop = 'hide';
                        break;
                    default:
                        wop = 'minimize';
                        break;
                    }
                    if (wop)
                        DomTerm.windowOp(wop);
                    break;
                case 8: // Resize text area to given height and width in chars
                    h = this.getParameter(1, term.numRows);
                    w = this.getParameter(2, term.numColumns);
                    term.forceWidthInColumns(w, h,
                                             this.getParameter(3, 0));
                    break;
                case 14:
                    if (this.getParameter(1, 0) == 2) {
                        w = window.outerWidth;
                        h = window.outerHeight;
                    } else {
                        w = term.availWidth;
                        h = term.availHeight;
                    }
                    term.processResponseCharacters("\x1B[4;"+Math.trunc(h)
                                                   +";"+Math.trunc(w)+"t");
                    break;
                case 16: // Report (rounded) character cell size in pixels
                    term.processResponseCharacters(
                        "\x1B[6;"+term.charHeightI
                            +";"+term.charWidthI+"t");
                    break;
                case 18: // Report the size of the text area in characters.
                    term.processResponseCharacters("\x1B[8;"+term.numRows
                                                   +";"+term.numColumns+"t");
                    break;
                case 22:  // save the window's title(s) on stack
                    {
                        const kind = this.getParameter(1, 0);
                        const old = term.sstate.save_title;
                        let wName = kind == 1 && old ? old.windowTitle
                            : term.sstate.windowTitle;
                        let iName = kind == 2 && old ? old.iconName
                            : term.sstate.iconName;
                        term.sstate.save_title = {
                            windowTitle: term.sstate.windowTitle,
                            iconName: term.sstate.iconName,
                            next: old
                        };
                    }
                    break;
                case 23: // restore the window's title(s) from stack
                    let stitle = term.sstate.save_title;
                    if (stitle) {
                        const kind = this.getParameter(1, 0);
                        if (kind == 0 || kind == 2)
                            term.sstate.windowTitle = stitle.windowTitle;
                        if (kind == 0 || kind == 1)
                            term.sstate.iconName = stitle.iconName;
                        term.sstate.save_title = stitle.next;
                        term.updateWindowTitle();
                    }
                    break;
                case 106: {
                    const op = this.getParameter(1, 0);
                    DomTerm.withLayout((m) => {
                        if (op == 1 /*start*/ || op == 2 /*end*/)
                            m.manager.draggingInOtherWindow(op==2);
                        else if (op == 4 /*enter*/ || op == 5 /*leave*/)
                            m.dragNotificationFromServer(op==4);
                        else if (op == 6 /* drop*/)
                            m.manager.droppedInOtherWindow();
                    }, true);
                    break;
                    }
                }
            };
            break;
        case 117 /*'u'*/:
            param = this.getParameter(0, 0);
            if (param !== 11 && param !== 12 && param !== 16 && param !== 17
               && param !== 83)
                term._breakDeferredLines();
            switch (param) {
            case 0: // Restore cursor (SCORC)
                term.restoreCursor();
                break;
            case 11:
                term._pushStdMode(null);
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
                        term.outputContainer.setAttribute("content-value",
                                                          content);
                    }
                }
                // ... fall through ...
            case 13: // End (selectable) prompt
                term._pushStdMode(null);
                // Force inputLine outside prompt
                term._adjustStyle();
                break;
            case 14:
                term.startPrompt();
                break;
            case 24:
                term.startPrompt(["k=c"]);
                break;
            case 15:
                // FIXME combine new line with previous line(s)
                // into a single input-line element.
                term.startInput(false, []);
                if (term.outputContainer.classList.contains("input-line")) {
                    var editmode = this.getParameter(1, -1);
                    if (editmode < 0 &&
                        ! term.outputContainer.getAttribute("click-move"))
                        editmode = 1;
                    if (editmode > 0) {
                        term.outputContainer.setAttribute("click-move",
                                                          editmode > 1 ? "m"
                                                          : "line");
                    }
                }
                break;
            case 16:
                var hider = term._createSpanNode();
                hider.setAttribute("std", "hider");
                term._pushIntoElement(hider);
                hider.outerStyleSpan = term._currentStyleSpan;
                term._currentStyle = hider;
                hider.parentNode.hasHider = true;
                break;
            case 17:
                term.outputContainer.addEventListener("click",
                                                      term._showHideEventHandler,
                                                      true);
                if (DtUtil.isSpanNode(term.outputContainer) // sanity check
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
                term.endCommandGroup(null, true);
                term.startCommandGroup(null);
                break;
            case 20:
                term.freshLine();
                break;
            case 44:
                var param = this.getParameter(1, 0);
                switch (param) {
                case 0:
                    term.sstate.stayInInputMode = undefined;
                    term.popFromElement();
                    break;
                }
                break;
            case 80: // set input mode
                DomTerm.setInputMode(this.getParameter(1, 112), term);
                break;
            case 81: // get-window-contents
                term.saveWindowContents();
                term._removeInputLine();
                break;
            case 82:
                term._detachSaveNeeded = this.getParameter(1,1);
                break;
            case 83: // push/pop domterm-hidden span
                param = this.getParameter(1, 0);
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
            case 84:
                param1 = this.getParameter(1, 0);
                switch (param1) {
                case 1: // pop buffer
                    this.popRestoreScreenBuffer();
                    break;
                case 2: // push new main buffer (no scrolling)
                case 3: // push new main buffer (scroll to top)
                    // case 4: push new alternate buffer (no scrolling) future?
                case 5: // push new alternate buffer (scroll to top)
                    term.pushClearScreenBuffer(param1==4, (param1 & 1) == 0);
                    break;
                }
                break;
            case 91:
                term.setSessionNumber(this.getParameter(1, 0),
                                      this.getParameter(2, 0),
                                      this.getParameter(3, 0)-1,
                                      this.getParameter(4, 0));
                break;
            case 92:
                switch (this.getParameter(1, 0)) {
                case 1:
                    if (! term._autoPaging) {
                        term._autoPagingTemporary = true;
                        term._adjustPauseLimit();
                    }
                    break;
                case 2:
                    if (this.controlSequenceState === DTParser.INITIAL_STATE
                        && term._pauseNeeded()) {
                        this.controlSequenceState = DTParser.PAUSE_REQUESTED;
                    }
                    term._autoPagingTemporary = false;
                    break;
                }
                break;
            case 96:
                term._receivedCount = this.getParameter(1,0);
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
                param1 = this.getParameter(1, 0);
                switch (param1) {
                case 95:
                    if (DomTerm.verbosity >= 1)
                        term.log("RECONNECT request!");
                    term.pushClearScreenBuffer(false, true);
                    term.initial.classList.add("reconnecting");
                    break;
                case 96: //re-connected
                    term.popRestoreScreenBuffer();
                    break;
                case 97:
                case 98:
                    if (DomTerm.verbosity >= 1)
                        term.log("DISCONNECTED! (pty close)");
                    if (term.initial.classList.contains("reconnecting"))
                        term.popRestoreScreenBuffer();
                    term.showConnectFailure(-1);
                    break;
                case 99:
                    DomTerm.closeFromEof(term);
                    break;
                }
                break;
            }
        break;
        case 120: /*'x'*/ // Request Terminal.Parameters (DECREQTPARM)
            term.processResponseCharacters("\x1B["+(this.getParameter(0, 0)+2)+";1;1;128;128;1;0x");
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

    handleSixel(bytes) {
        const term = this.term;
        const six = window.SixelDecoder;
        six.init();
        six.decode(bytes);
        let sw = six.width, sh = six.height;
        let insertContainer, insertBefore;
        let w = sw, h = sh;
        let oldImage;
        let canvas;
        let oldLine, oldColumn;
        if (term.sstate.sixelDisplayMode) { // not sixel scrolling
            // FIXME attach canvas to lineStarts[homeLine]
            // do not adjust cursor position
            // FIXME check if line is line span
            insertContainer = term.lineStarts[term.homeLine];
            insertBefore = insertContainer.firstChild;
        } else { // sixel scrolling
            term._fixOutputPosition();
            oldLine = term.getAbsCursorLine();
            oldColumn = term.getCursorColumn();
            let next = term.outputBefore;
            let prev = next ? next.previousSibling : term.outputContainer.lastChild;
            if (prev instanceof Element && (prev.tagName === "IMG" || prev.tagName === "CANVAS")) {
                next = prev;
            }
            if (next == term._caretNode)
                next = next.nextSibling;
            const oldTag = next instanceof Element && next.tagName;
            insertContainer = term.outputContainer;
            if (oldTag === "CANVAS" || oldTag === "IMG") {
                const oldHeight = next.height;
                const oldWidth = next.width;
                oldImage = next;
                if (oldHeight >= h)
                    h = oldHeight;
                if (oldWidth >= w)
                    w = oldWidth;
                if (oldTag === "CANVAS" && oldHeight >= sh && oldWidth >= sw) {
                    this.outputBefore = canvas = next;
                } else {
                    canvas = document.createElement("canvas");
                    w = Math.max(w, oldWidth);
                    h = Math.max(h, oldHeight)
                    canvas.setAttribute("width", w);
                    canvas.setAttribute("height", h);
                    insertContainer.insertBefore(canvas, next.nextSibling);
                    next.remove();
                    this.outputBefore = canvas
                }
            }
            insertBefore = term.outputBefore;
        }
        if (! canvas) {
            canvas = document.createElement("canvas");
            canvas.setAttribute("width", w);
            canvas.setAttribute("height", h);
        }
        const ctx = canvas.getContext('2d');
        if (oldImage && oldImage !== canvas)
            ctx.drawImage(oldImage, 0, 0);
        if (sw > 0 && sh > 0) {
            const idata = new ImageData(new Uint8ClampedArray(six.data32.buffer, 0, sw * sh * 4),
                                        sw, sh);
            ctx.putImageData(idata, 0, 0);
        }
        // ??? adjust by devicePixelRatio and zoom?
        const charWidthI = term.charWidthI;
        const charHeightI = term.charHeightI;

        canvas.classList.add("dt-background");
        const cstyle = canvas.style;
        const cw = w / term.charWidthI * term.charWidth;
        const ch = h / term.charHeightI * term.charHeight;
        // Using position="relative" would seem to be cleaner and
        // more robust, but I can't get the stacking contexts to work, even
        // with z-index=auto.  Specifically, captions written by nplayer
        // aren't visible, even though they are later in the document order.
        // Instead, use negative margins to set the effective width to 0.
        cstyle.marginRight = `-${cw}px`;
        cstyle.marginBottom = `-${ch}px`;
        cstyle.display = "inline";
        cstyle.verticalAlign = "top";
        cstyle.width = `${cw}px`;
        cstyle.height = `${ch}px`;
        if (canvas != insertBefore) {
            insertContainer.insertBefore(canvas, insertBefore);
        }
        term.outputBefore = canvas.nextSibling;
        if (! (term.outputBefore instanceof Element
               && term.outputBefore.getAttribute("line") !== null)) {
            const scols = Math.floor(sw / charWidthI + 0.9);
            const saveBackground = term._currentStyleBackground();
            term._pushStyle("background-color", "transparent");
            term.insertSimpleOutput(DomTerm.makeSpaces(scols), 0, scols);
            term._pushStyle("background-color", saveBackground);
        }
        if (! term.sstate.sixelDisplayMode) {
            let line = term.lineStarts[oldLine];
            let wcols = Math.floor(w / charWidthI + 0.9);
            let hlines = Math.floor(h / charHeightI + 0.9);
            if (term.sstate.sixelScrollsRight) {
            } else {
                wcols = 0;
            }
            let newColumn = oldColumn+wcols;
            if (newColumn >= term._regionRight) {
                newColumn = term._regionLeft;
                hlines++;
            }
            if (line._widthColumns !== undefined)
                line._widthColumns += Math.max(line._widthColumns, newColumn);
            if (term.currentCursorColumn >= 0)
                term.currentCursorColumn += wcols;
            line._widthMode = Terminal._WIDTH_MODE_VARIABLE_SEEN;
            line._breakState = Terminal._BREAKS_UNMEASURED;
            term.moveToAbs(oldLine+hlines-1, newColumn, true);
        }
    }

    handleDeviceControlString(params, bytes) {
        const term = this.term;
        if (bytes.length == 0)
            return;
        if (bytes[0] === 113 /*'q'*/ && this._flagChars === "$") {
            // DCS $ q Request Status String DECRQSS
            let response = null;
            /*
            let text = this.decodeBytes(bytes);
            switch (text.substring(2)) {
            case xxx: response = "???"; break;
            }
            */
            // DECRPSS—Report Selection or Setting
            term.processResponseCharacters(response ? "\x900$r"+response+"\x9C"
                                           : "\x901$r\x9C");
            return;
        } else
            console.log("handleDeviceControlString");
    }

    get_mode(param) {
        const term = this.term;
        switch (param) {
        case 4: return term.sstate.insertMode;
        case 20: return term.sstate.automaticNewlineMode !== 0;
        }
        return undefined;
    }

    get_DEC_private_mode(param) {
        const term = this.term;
        switch (param) {
        case 1: return term.sstate.applicationCursorKeysMode;
        case 3: return term.numColumns == 132;
        case 5: return term.sstate.reverseVideo;
        case 6: return term.sstate.originMode;
        case 7: return (term.sstate.wraparoundMode & 2) != 0;
        case 12: // Stop/start blinking cursor (AT&T 610) - sent by emacs
            return false; // FIXME
        case 25: // Hide/show cursor (DECTCEM) - sent by emacs
            return term.sstate.showCaret;
        case 45: return (term.sstate.wraparoundMode & 1) != 0;
        case 80: return !!term.sstate.sixelDisplayMode;
        case 47: // fall though
        case 1047: return term.usingAlternateScreenBuffer;
        case 1048: return term.sstate.savedCursor !== undefined;
        case 1049: return term.usingAlternateScreenBuffer;
        case 2004: return term.sstate.bracketedPasteMode;
        case 8452: return !!term.sstate.sixelScrollsRight;
        case 9: case 1000: case 1001: case 1002: case 1003:
            return term.sstate.mouseMode == param;
        case 1004:
            return term.sstate.sendFocus;
        case 1005: case 1006: case 1015: case 1016:
            return term.sstate.mouseCoordEncoding == param;
        }
        return undefined;
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
            term.sstate.reverseVideo = value;
            // TermInfo for xterm and similar has 'flash=\E[?5h$<100/>\E[?5l'.
            // I.e. "visible bell" by doing: reverse-video, short-delay, reset.
            // Unfortunately, the short delay may get dropped, so we see
            // no flash. Worse: clearing and setting the disabled flag on
            // stylesheets in quick order seems to confuse Chrome-based
            // browsers.  Using a short timeout avoids both problems.
            if (value)
                term.updateReverseVideo();
            else
                setTimeout(() => term.updateReverseVideo(), 50);
            break;
        case 6: // DECOM
            term.sstate.originMode = value;
            term.cursorSet(0, 0, value);
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
        case 80:
            if (value)
                term.sstate.sixelDisplayMode = true;
            else
                delete term.sstate.sixelDisplayMode;
            console.log("DECSDM "+value);
            break;
        case 9: case 1000: case 1001: case 1002: case 1003:
            term.setMouseMode(value ? param : 0);
            break;
        case 1004: // Send FocusIn/FocusOut events.
            term.sstate.sendFocus = value;
            break;
        case 1005: case 1006: case 1015: case 1016:
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
        case 8452:
            console.log("sixel scrolls right: "+value);
            if (value)
                term.sstate.sixelScrollsRight = true;
            else
                delete term.sstate.sixelScrollsRight;
            break;
        }
    };

    handleOperatingSystemControl(code, text) {
        const term = this.term;
        if (DomTerm.verbosity >= 2)
            term.log("handleOperatingSystemControl "+code+" "+DomTerm.JsonLimited(text));
        if (! (code >= 110 && code <= 118))
            term._breakDeferredLines();
        let semi;
        switch (code) {
        case 0:
        case 1:
        case 2:
        case 30:
            term.setWindowTitle(text, code);
            break;
        case 31:
            text = text.trim();
            if (text && text != "0")
                term.topNode.setAttribute("pid", text);
            term._initializeDomTerm(term.topNode);
            break;
        case 8:
            semi = text.indexOf(';');
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
                    newLink.setAttribute("class", "subtle plain");
                    term._pushIntoElement(newLink);
                    DomTerm._addMouseEnterHandlers(term, newLink.parentNode);
                }
            }
            break;
        case 4: {
            let m = text.match(/^([0-9]+);(.*)$/);
            if (m) {
                let c = parseInt(m[1], 10);
                const cvar = c >= 0 && c < 16
                      && `--dt-${Terminal.colorNames[c]}`;
                if (m[2] === "?") {
                    let color;
                    if (c >= 0 && c < 16)
                        color = getComputedStyle(term.topNode).getPropertyValue(cvar);
                    color = color || (c >= 0 && c < 256 ? DtUtil.color256(c) : "");
                    m = color.match(/#([0-9a-fA-F]{2])([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
                    if (m)
                        term.processResponseCharacters(`\x1b]4;${c};rgb:${m[1]}/${m[2]}/${m[3]}\x1b\\`);
                } else if (m[2] && c >= 0 && c < 16) {
                    // convert "rgb:RR/GG/BB" to "#RRGGBB"
                    let m2 = m[2]
                        .match(/rgb:([0-9a-fA-F]{2})[/]([0-9a-fA-F]{2})[/]([0-9a-fA-F]{2})/);
                    if (m2) {
                        term.topNode.style.setProperty(cvar, `#${m2[1]}${m2[2]}${m2[3]}`);
                    }
                }
            }
            break;
        }
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
            var span = term._createSpanNode("diagnostic");
            if (text)
                span.setAttribute("info", text);
            /* FUTURE:
            var options;
            try {
                options = JSON.parse("{"+text+"}");
            } catch (e) { options = {}; }
            */
            term._pushIntoElement(span);
            term.sstate.stayInInputMode = undefined;
            break;
        case 52: { // Manipulate Selection Data (subset)
            let semi = text.indexOf(';');
            if (semi >= 0) {
                let data = text.substring(semi+1);
                for (let i = 0; i < semi; i++) {
                    let where = text.charAt(i);
                    if (data == '?') { // get
                        let send_data = (text) => {
                            term.processResponseCharacters("\x1B]52;"+where
                                                           +";"+btoa(text)
                                                           +"\x1B\\");
                        };
                        if (where == 'c') { // get clipboard
                            if (! term.checkPermission("get-clipboard"))
                                send_data("{get-clipboard not allowed}");
                            else if (term.hasClipboardServer("paste"))
                                term.reportEvent("REQUEST-CLIPBOARD-TEXT", "OSC52");
                            else
                                navigator.clipboard.readText().then(send_data);
                        } else if (where == 'p') { // get primary (selection)
                            if (! term.checkPermission("get-selection"))
                                send_data("{get-selection not allowed}");
                            else if (term.hasClipboardServer("selection-paste"))
                                term.reportEvent("REQUEST-SELECTION-TEXT", "OSC52");
                            else
                                send_data(Terminal._selectionAsText());
                        }
                    } else { // set
                        let str = atob(data);
                        if (where == 'c')  // set clipboard
                            if (term.checkPermission("set-clipboard"))
                                DomTerm.valueToClipboard({text: str });
                        else if (where == 'p') { // set primary (selection)
                            // TODO: Maybe copy to focus-area and selection
                        }
                    }
                }
            }
            break;
        }
        case 71: {
            // handle tcsetattr
            let canon = text.indexOf(" icanon ") >= 0;
            let echo = text.indexOf(" echo ") >= 0;
            let extproc = text.indexOf(" extproc ") >= 0;
            if (canon == 0 && term.isLineEditing() && term._inputLine) {
                term._sendInputContents(false);
            }
            let specialKeys = "";
            for (const keyName of ["intr", "susp", "eof", "quit"]) {
                let m = text.match(new RegExp(" " + keyName + "=([0-9]+)"));
                if (m) {
                    specialKeys += String.fromCharCode(Number(m[1]));
                }
            }
            term._specialKeys = specialKeys;
            term._clientWantsEditing = canon ? 1 : 0;
            term._clientPtyEcho = echo;
            term._clientPtyExtProc = extproc ? 1 : 0;
            term.autoLazyCheckInferior = extproc ? 0 : 1;
            break;
        }
        case 72:
            term._scrubAndInsertHTML(text);
            break;
        case 721:
            semi = text.indexOf(';');
            if (semi > 0) {
                let key = text.substring(0, semi);
                text = text.substring(semi+1);
                let elements =
                    term.initial.getElementsByClassName("can-replace-children");
                for (let n = elements.length; --n >= 0; ) {
                    let element = elements[n];
                    if (element.getAttribute("replace-key")===key) {
                        let saveBefore = term.outputBefore;
                        let saveContainer = term.outputContainer;
                        term.outputContainer = element;
                        term.outputBefore = null;
                        while (element.firstChild)
                            element.removeChild(element.firstChild);
                        term._scrubAndInsertHTML(text);
                        term.outputContainer = saveContainer;
                        term.outputBefore = saveBefore;
                        term.resetCursorCache();
                        break;
                    }
                }
            }
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
                    if (keyName === "paste" || keyName === "ime")
                        dt.editorInsertString(kstr);
                    else
                        dt.doLineEdit(keyName);
                }
                let firstEditCommand = term._inputLine == null;
                extractEditKey(text);
                if (DomTerm.verbosity >= 2)
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
            DomTerm.setOptions(text);
            break;
        case 89:
            try {
                term.setSettings(JSON.parse(text));
            } catch(e) {
                console.log("error parsing settings file: "+e);
            }
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
            break;
        case 95:
        case 96:
            var args = JSON.parse("["+text+"]");
            var r = term.loadStyleSheet(args[0], args[1]);
            if (code == 95)
                term.processResponseCharacters("\x9D" + r + "\n");
            break;
        case 97: {
            let options, command;
            if (text.charCodeAt(0) == 123/*'{'*/) {
                try {
                    options = JSON.parse(text);
                } catch (ex) {
                    options = { cmd: "unknown" };
                }
                command = options.cmd;
            } else {
                command = text;
                options = { cmd: text };
            }
            switch (command) {
            case 'capture': {
                let response;
                if (options['selection-only'])
                    response = Terminal._selectionAsText(options);
                else {
                    let range = new Range();
                    let rnode = options['current-buffer'] ? term.initial : term.buffers;
                    range.selectNode(rnode);
                    response = Terminal._rangeAsText(range, options);
                }
                term.sendResponse({out: response}, options);
                break;
            }
            case 'await': {
                let timer = null;
                let rules = options.rules || [];
                let fn = () => {
                    let output = null;
                    for (let i = 0; ; i++) {
                        if (i >= rules.length)
                            return false;
                        let rule = rules[i];
                        if (rule.match) {
                            let rxflags = rule.rxflags || '';
                            let rx = new RegExp(rule.match, rxflags);
                            let nlines = rule.nlines || 1;
                            let lines_checked = 0;
                            let iline = term.lineStarts.length - 1;
                            for (; output == null && iline >= 0; iline--) {
                                let ln = term.lineStarts[iline];
                                if (! DtUtil.isBlockNode(ln))
                                    continue;
                                let text = ln.textContent;
                                if (lines_checked == 0
                                    && text.trimEnd().length == 0)
                                    continue;
                                lines_checked++;
                                if (rx.test(text)) {
                                    output = rule.out || '';
                                    break;
                                }
                                if (lines_checked >= nlines)
                                    break;
                            }
                            if (output !== null)
                                break;
                        }
                    }
                    if (timer)
                        clearTimeout(timer);
                    timer = null;
                    if (output && output.length > 0
                        && output.charCodeAt(output.length-1) != 10)
                        output += '\n';
                    term.sendResponse({out: output}, options);
                    return true;
                }
                if (fn())
                    return;
                if (! term._afterOutputHook)
                    term._afterOutputHook = [];
                term._afterOutputHook.push(fn);
                if (typeof options.timeout === "number") {
                    timer = setTimeout(() => {
                        let hook = term._afterOutputHook;
                        if (hook) {
                            let i = hook.findIndex((e)=>(e===fn));
                            if (i >= 0) hook.splice(i, 1);
                        }
                        let errmsg = options.timeoutmsg;
                        if (errmsg === undefined)
                            errmsg = 'timeout';
                        term.sendResponse({err: errmsg}, options);
                    }, options.timeout * 1000);
                }
                break;
            }
            case 'list-stylesheets': {
                let sheets = term.listStylesheets();
                let result = '';
                for (let i = 0; i < sheets.length; i++) {
                    result += i + ': ' + sheets[i] + '\n';
                }
                term.sendResponse({out: result}, options);
                break;
            }
            case 'load-stylesheet': {
                let r = term.loadStyleSheet(options.name, options.value);
                term.sendResponse({out: id}, options);
                break;
            }
            case 'enable-stylesheet':
            case 'disable-stylesheet': {
                let disable = command === 'disable-stylesheet';
                let r = term.maybeDisableStyleSheet(options.select, disable);
                term.sendResponse({err: r}, options);
                break;
            }
            case 'print-stylesheet': {
                let styleSheet = term.findStyleSheet(options.select);
                if (! (typeof styleSheet == "string")
                    && ! styleSheet.cssRules)
                    styleSheet = "stylesheet rules not available";
                let r;
                if (typeof styleSheet == "string") {
                    r = { err: styleSheet };
                } else {
                    r = "";
                    for (const rule of styleSheet.cssRules) {
                        r += rule.cssText + '\n';
                    }
                    r = { out: r };
                }
                term.sendResponse(r, options);
                break;
            }
            case 'set-window-name':
                if (typeof options.windowName === "string"
                    && typeof options.windowNumber == "number") {
                    DomTerm.updateTitle(null/*content*/, options);
                }
                break;
            case 'close':
                term.close();
                break;
            case 'kill': // force-close
                term.close(); // For now
                break;
            case 'detach':
                term.detachSession();
                break;
            case 'do-key': {
                let str = options.keyDown || options.text;
                if (str) {
                    let r = options.keyDown
                        && term.processKeyDown(browserKeymap.normalizeKeyName(str.replace(/(Alt|Ctrl|Cmd|Shift)-/g, "$1+")));
                    if (! r) {
                        if (term.isLineEditingOrMinibuffer())
                            term.editorInsertString(str, true);
                        else
                            term.processInputCharacters(str);
                    }
                }
                break;
            }
            case 'fullscreen on':
            case 'fullscreen off':
            case 'fullscreen toggle':
                DomTerm.windowOp('fullscreen', command.substring(11));
                break;
            }
            break;
        }
        case 102:
            DTParser.sendSavedHtml(term, term.getAsHTML(true));
            break;
        case 103: // restore saved snapshot
            var comma = text.indexOf(",");
            var rcount = Number(text.substring(0,comma));
            var data = DtUtil.fromJson(text.substring(comma+1));
            let main = term.initial;
            if (main instanceof Element &&
                main.getAttribute('class') == 'dt-buffer') {
                term._vspacer.insertAdjacentHTML('beforebegin', data.html);
                var parent = main.parentNode;
                parent.removeChild(main);
                term.sstate = data.sstate;
                term.topNode.setAttribute("session-number",
                                          term.sstate.sessionNumber);
                var dt = term;
                term._inputLine = null;
                function findInputLine(node) {
                    if (node.getAttribute('std') == 'caret')
                        dt._caretNode = node;
                    if (node.classList.contains('editing'))
                        dt._inputLine = node;
                    return true;
                };
                term._replayMode = true;
                term.initial = DomTerm._currentBufferNode(term, -1);
                let bufAttr = term.initial.getAttribute("buffer");
                term.usingAlternateScreenBuffer =
                    bufAttr && bufAttr.indexOf("alternate") >= 0;
                DtUtil.forEachElementIn(parent, findInputLine);
                term.outputBefore =
                    term._inputLine != null ? term._inputLine : term._caretNode;
                term.outputContainer = term.outputBefore.parentNode;
                term.resetCursorCache();
                term._restoreLineTables(term.topNode, 0);
                DomTerm._addMouseEnterHandlers(term);
                if (data.rows && data.columns)
                    dt.forceWidthInColumns(data.columns, data.rows, 8);
                dt._breakAllLines();
                const home_node = main.querySelector("*[home-line]");
                if (home_node) {
                    const home_line = home_node.getAttribute("home-line");
                    const home_offset = parseInt(home_line) || 0;
                    dt.homeLine = dt._computeHomeLine(home_node, home_offset,
                                                      dt.usingAlternateScreenBuffer);
                    home_node.removeAttribute("home-line");
                }
                term.updateWindowTitle();
                let saved = term._savedControlState;
                if (saved && ! saved.counted)
                    saved.receivedCount = rcount;
                else
                    term._receivedCount = rcount;
                term._confirmedCount = rcount;
                term._replayMode = false;
            }
            break;
        case 104: {
            // Reset color number
            if (text === "")
                text = "0;1;2;3;4;5;6;7;8;9;10;11;12;13;14;15";
            const tlen = text.length;
            for (let i = 0; i < tlen; ) {
                let semi = text.indexOf(";", i);
                let last = semi < 0 ? tlen : semi;
                let cnum = Number(text.substring(i, last));
                if (cnum >= 0 && cnum < 16) {
                    term.topNode.style.removeProperty(`--dt-${Terminal.colorNames[c]}`);
                }
                i = last + 1;
            }
            break;
        }
        case 204:
            try {
                const wargs = JSON.parse("[" + text + "]");
                const paneOp = wargs[0];
                const options = wargs[wargs.length-1];
                if (wargs.length === 3) {
                    const wnum = wargs[1];
                    DomTerm.withLayout((m) => {
                        let oldItem = m._numberToLayoutItem(wnum);
                        if (oldItem)
                            m.addPaneRelative(oldItem, paneOp, options);
                    }, true);
                }
            } catch (e) {
                term.log("bad new-pane request (" + e + "): " +JSON.stringify(text));
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
                lineStart._breakState = Terminal._BREAKS_UNMEASURED;
            }
            var ppgroup = term._createSpanNode("pprint-group");
            text = text.trim();
            if (text) {
                var prefix = String(JSON.parse(text));
                var span = term._createSpanNode("pprint-prefix");
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
                if (term._currentPprintGroup.contains(term.outputContainer)) {
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
                var span = term._createSpanNode("pprint-indent");
                if (code == 114)
                    span.appendChild(document.createTextNode(JSON.parse(text)));
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
            lineStart._breakState = Terminal._BREAKS_UNMEASURED;
            var line = term._createLineNode(kind);
            text = text.trim();
            if (text.length > 0) {
                try {
                    var strings = JSON.parse("["+text+"]");
                    let nobreakStr = strings[2];
                    if (strings[0]) {
                        line.appendChild(term
                                         ._createSpanNode("pprint-pre-break",
                                                          strings[0]));
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
                        lineStart._breakState = Terminal._BREAKS_UNMEASURED;
                        if (term.currentCursorColumn >= 0)
                            term.currentCursorColumn += w;
                    }


                    if (strings[1]) {
                        line.appendChild(term
                                         ._createSpanNode("pprint-post-break",
                                                          strings[1]));
                    }
                } catch (e) {
                    term.log("bad line-break specifier '"+text+"' - caught "+e);
                }
            }
            term.insertNode(line);
            if (line.parentNode.hasHider)
                line.setAttribute("domterm-hidden", "false");
            if (term._currentPprintGroup) {
                var absLine = term.getAbsCursorLine();
                while (term.lineStarts[absLine].nodeName=="SPAN")
                    absLine--;
                if (term._deferredLinebreaksStart < 0
                    || term._deferredLinebreaksStart > absLine)
                    term._deferredLinebreaksStart = absLine;
            }
            if (kind=="required")
                term.lineStarts[term.getAbsCursorLine()].alwaysMeasureForBreak = true;
            break;
        case 119:
            term.freshLine();
            term.endCommandGroup(text, true);
            term.startCommandGroup(text, 0); // new sibling group
            break;
        case 120:
            term.freshLine();
            term.startCommandGroup(text, 1); // new child group
            break;
        case 121:
            term.freshLine();
            term.endCommandGroup(text, false);
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
        case 133: // iTerm2/FinalTerm shell-integration
            function splitOptions(text) { // FIXME move elsewhere
                let options = new Array();
                let start = 0;
                let tlen = text.length;
                for (let i = 0; ; i++) {
                    if (i == tlen || text.charCodeAt(i) == 59) {
                        if (i > start)
                            options.push(text.substring(start, i));
                        if (i == tlen)
                            break;
                        start = i+1;
                    }
                }
                return options;
            }

            let ch0 = text.charCodeAt(0);
            let options = splitOptions(text.substring(1));
            let aid;
            switch (ch0) {
            case 65: // 'A' - FTCS_PROMPT
            case 78: // 'N'
                term.freshLine();
                aid = Terminal.namedOptionFromArray(options, "aid=");
                if (ch0 == 78)
                    term.endCommandGroup(aid, true);
                // In case of fish "omitted newline" hack
                term._clearWrap(term.getAbsCursorLine()-1);
                term.startCommandGroup(aid, 1, options);
                term.startPrompt(options);
                break;
            case 66: // 'B' FTCS_COMMAND_START like CSI 15u
            case 73: // 'I'
                term.startInput(ch0==66, options);
                break;
            case 67: // 'C'
                term.startOutput();
                term.sstate.stayInInputMode = undefined;
                break;
            case 80: // 'P'
                term.startPrompt(options);
                break;
            case 68: // 'D'
                let exitCode = Terminal.namedOptionFromArray(options, "err=");
                if (exitCode == null && options.length > 0
                    && options[0] && options[0] !== "0")
                    exitCode = options[0];
                let oldGroup = term.currentCommandGroup();
                aid = Terminal.namedOptionFromArray(options, "aid=");
                term.endCommandGroup(aid, false);
                term.sstate.stayInInputMode = undefined;
                if (exitCode && oldGroup) {
                    const button = term._createSpanNode("error-exit-mark");
                    button.setAttribute("exit-code", exitCode);
                    button.setAttribute("title", "exit-code: "+exitCode);
                    oldGroup.appendChild(button);
                }
                break;
            case 76: // 'L'
                term.freshLine();
                break;
            }
            break;
        case 231: // paste
            term.pasteTextFromJson(text);
            break;
        case 232:
            try {
                let str = JSON.parse(text);
                term._ssh_error_msg = (term._ssh_error_msg || "") + str;
            } catch (e) {
                term.log("caught " + e + " in OSC 212 (ssh-error)");
            }
            break;
        case 1337: // various iTerms extensions:
            // RemoteHost=USER@HOST
            // CurrentDir=DIRECTORY
            // more...
            break;
        default:
            // WTDebug.println("Saw Operating System Control #"+code+" \""+WTDebug.toQuoted(text)+"\"");
        }
    };

    pushControlState(saved) {
        saved.controlSequenceState = this.controlSequenceState;
        saved.parameters = this.parameters;
        saved.textParameter = this.textParameter;
        saved.flagChars = this._flagChars;
        this.controlSequenceState = DTParser.INITIAL_STATE;
        this.textParameter = null;
        this._flagChars = "";
        this.parameters = new Array();
    }

    popControlState(saved) {
        this.controlSequenceState = saved.controlSequenceState;
        this.parameters = saved.parameters;
        this.textParameter = saved.textParameter;
        this._flagChars = saved.flagChars;
    }

    getParameter(index, defaultValue) {
        var arr = this.parameters;
        return arr.length > index && arr[index] != null ? arr[index]
            : defaultValue;
    }

    /* Like getParameter(index,1) but missing *or* 0 returns 1. */
    getParameterOneIfDefault(index) {
        return this.parameters[index] || 1;
    }
}

// States of escape sequences handler state machine.
DTParser.INITIAL_STATE = 0;
/** We have seen ESC. */
DTParser.SEEN_ESC_STATE = 1;
/** We have seen CSI: ESC '['. */
DTParser.SEEN_ESC_LBRACKET_STATE = 2;
/** We have seen OSC: ESC ']' or 0x9d. */
DTParser.SEEN_OSC_STATE = 6;
/** We have seen OSC numeric-parameter ';'. */
DTParser.SEEN_OSC_TEXT_STATE = 7;
/** Saw ESC followed by one or more of 0x20..0x2F.
* Used for ISO/IEC 2022 codes. */
DTParser.SEEN_ESC_2022_PREFIX = 8;
/** We have seen ESC '#'. */
DTParser.SEEN_ESC_SHARP_STATE = 9;
DTParser.SEEN_ESC_SS2 = 14;
DTParser.SEEN_ESC_SS3 = 15;
DTParser.SEEN_CR = 17;
DTParser.SEEN_DCS_STATE = 19;
DTParser.SEEN_DCS_TEXT_STATE = 20;
/** Seen DCS params q */
DTParser.SEEN_DCS_SIXEL_STATE = 21;
DTParser.SEEN_PM_STATE = 22;
DTParser.SEEN_APC_STATE = 23;
DTParser.PAUSE_REQUESTED = 24;

DTParser.REPLACEMENT_CHARACTER = 0xFFFD;

window.DTParser = DTParser;

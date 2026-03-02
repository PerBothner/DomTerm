import { Terminal as DTerminal } from './terminal.js';
import * as DtUtil from './domterm-utils.js';
import { Terminal as XTerm, init, FitAddon } from './ghostty-web.js';

class GhTermPane extends DTerminal {
    constructor(windowNumber) {
        super(windowNumber, "ghterminal");
        console.log('construct GhTermPane #'+windowNumber);
        this.activateLink = (event, uri) => {
            DomTerm.handleLinkRef(uri, undefined, this);
        };
        let linkPopup;
        const ctrlRequiredForLink = () => { return true; };
        const removeLinkPopup = () => {
            if (linkPopup) {
                linkPopup.remove();
                linkPopup = undefined;
            }
        };
        const showLinkPopup = (event, text, topNode) => {
            removeLinkPopup();
            let popup = document.createElement('div');
            popup.classList.add('dt-context-popup');
            popup.style.position = 'absolute'; // or 'fixed' ???
            popup.style.top = (event.clientY + 25) + 'px';
            popup.style.right = '0.5em';
            popup.innerText = text;
            if (ctrlRequiredForLink()) {
                popup.appendChild(document.createElement('br'));
                const e2 = document.createElement('i');
                e2.innerText = `(${DomTerm.isMac ? 'Cmd' : 'Ctrl'}+Click to open link)`;
                popup.appendChild(e2);
            }
            topNode.appendChild(popup);
            const popupHeight = popup.offsetHeight;
            if (event.clientY + 25 + popupHeight > topNode.clientHeight) {
                let y = event.clientY - 25 - popupHeight;
                popup.style.top = (y < 0 ? 0 : y) + 'px';
            }
            linkPopup = popup;
        };
        this.linkHandler = {
            activate: (ev, text, range) => {
                if (! ctrlRequiredForLink()
                    || (DomTerm.isMac ? ev.metaKey : ev.ctrlKey)) {
                    this.activateLink(ev, text);
                }
            },
            hover: (ev, text, range) => {
                showLinkPopup(ev, text, ev.target);
            },
            leave: (ev, text, range) => {
                removeLinkPopup();
            },
            allowNonHttpProtocols: true
        };
        this.fitAddon = new FitAddon();
    }
    initializeTerminal(_topNode) {
        const xterm = this.terminal;
        this.xterm = xterm;
        xterm.onBell(() => {
            this.handleBell();
        });
        xterm.onData((string) => {
            this.processResponseCharacters(string);
        });
        xterm.onResize((sz) => {
            if (! this._replayMode)
                this.setWindowSize(sz.rows, sz.cols, 0, 0);
        });

        xterm.onTitleChange((title) => {
            this.setWindowTitle(title, 2);
        });
        xterm.loadAddon(this.fitAddon);
        this.fitAddon.fit();
        this.attachResizeSensor();
    }
    hasFocus() {
        return this.contentElement.classList.contains("focus");
    }
    setFocused(focused) {
        if (focused)
            this.xterm.focus();
        else
            this.xterm.blur()
    }
    maybeFocus() {
    }
    applicationCursorKeysMode() {
        return this.xterm.modes.applicationCursorKeysMode;
    }
    resizeHandler() {
        this.fitAddon.fit();
    }
    parseBytes(bytes, beginIndex = 0, endIndex = bytes.length) {
        if (DomTerm.verbosity >= 2) {
            if (this._decoder == null)
                this._decoder = new TextDecoder(); //label = "utf-8");
            const str = this._decoder.decode(bytes.subarray(beginIndex, endIndex),
                                             {stream:true});
            let jstr = DomTerm.JsonLimited(str);
            if (this._pagingMode == 2)
                jstr += " paused";
            if (this._savedControlState)
                jstr += " urgent";
            this.log("parseBytes "+jstr+" state:"+this.controlSequenceState/*+" ms:"+ms*/);
        }
        let rlen = endIndex - beginIndex;
        this.terminal.write(bytes.slice(beginIndex, endIndex));
        this._receivedCount = (this._receivedCount + rlen) & DTerminal._mask28;
    }
    _isOurEvent(event) {
        return true; // maybe check "focus" class
    }
    _scrollIfNeeded() {
        return false;
    }
    pageTop() {
        this.xterm.scrollToTop();
    }
    pageBottom() {
        this.xterm.scrollToBottom();
    }
    scrollPage(count) {
        this.xterm.scrollPages(count);
    }
    scrollLine(count) {
        this.xterm.scrollLines(count);
    }
    saveWindowContents() {
        const rcount = this._receivedCount;
        let data =
            rcount
            + ',{"sstate":'+DtUtil.toJson(this.sstate);
        data += ',"rows":'+this.xterm.rows+',"columns":'+this.xterm.cols;
        data += ', "serialized":'
            + JSON.stringify(this.serializeAddon.serialize())
            +'}';
            this.reportEvent("WINDOW-CONTENTS", data);
    }

}
window.GhTermPane = GhTermPane;

async function ghInitialized() {
    console.log('before await init');
    await init();
    console.log('after await init');
    return XTerm;
}

window.ghInitialized = ghInitialized();

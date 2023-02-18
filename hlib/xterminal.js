import { Terminal as DTerminal } from './terminal.js';

const XTerm = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;

class XTermPane extends DTerminal {
    constructor(windowNumber) {
        super(windowNumber, "xterminal");
        this.fitAddon = new FitAddon();
    }
    initializeTerminal(_topNode) {
        const xterm = this.terminal;

        // MAYBE use attachCustomKeyEventHandler instead of onKey
        xterm.onKey((arg) => {
            const ev = arg.domEvent;
            const etype = ev.type;
            console.log("onKey2 "+JSON.stringify(arg.key)+" type:"+arg.domEvent.type);
            if (etype !== "keydown"
                || ! this.keyDownHandler(ev)) {
                this.keyPressHandler(ev, "'" + arg.key + "'");
            }
        });
        xterm.onResize((cols, rows) => {
            console.log("onResize "+cols+"x"+rows);
            this.setWindowSize(rows, cols, 0, 0);
        });
        xterm.onTitleChange((title) => {
            console.log("title changed: "+title);
            this.setWindowTitle(title, 2);
        });
        xterm.loadAddon(this.fitAddon);
        this.fitAddon.fit();
    }
    hasFocus() {
        return this.contentElement.classList.contains("focus");
    }
    seFocused(focused) {
        if (focused)
            xterm.focus();
        else
            xterm.blur()
    }
    measureWindow() {
        this.fitAddon.fit();
    }
    insertBytes(bytes, beginIndex, endIndex) {
        this.parseBytes(bytes, beginIndex, endIndex);
    }
    parseBytes(bytes, beginIndex, endIndex) {
        this.terminal.write(bytes.slice(beginIndex, endIndex));
    }
    _isOurEvent(event) {
        return true; // maybe check "focus" class
    }
    _scrollIfNeeded() {
        return false;
    }
}
window.XTermPane = XTermPane;

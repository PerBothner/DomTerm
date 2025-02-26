import { Terminal as DTerminal } from './terminal.js';
import * as DtUtil from './domterm-utils.js';

const XTerm = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;
const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;
//Not available in xterm.js 5.5.0, which is current NPM version.
//const UnicodeProvider = window.UnicodeGraphemesAddon.UnicodeGraphemesAddon);
const ImageAddon = window.ImageAddon.ImageAddon;
//The following doesn't work - see https://github.com/xtermjs/xterm.js/issues/4424
//const SerializeAddon = SerializeAddon.SerializeAddon;
const WebglAddon = window.WebglAddon.WebglAddon;

// customize as needed (showing addon defaults)
const imageCustomSettings = {
  enableSizeReports: true,    // whether to enable CSI t reports (see below)
  pixelLimit: 16777216,       // max. pixel size of a single image
  sixelSupport: true,         // enable sixel support
  sixelScrolling: true,       // whether to scroll on image output
  sixelPaletteLimit: 256,     // initial sixel palette size
  sixelSizeLimit: 25000000,   // size limit of a single sixel sequence
  storageLimit: 128,          // FIFO storage limit in MB
  showPlaceholder: true,      // whether to show a placeholder for evicted images
  iipSupport: true,           // enable iTerm IIP support
  iipSizeLimit: 20000000      // size limit of a single IIP sequence
};
class XTermPane extends DTerminal {
    constructor(windowNumber) {
        super(windowNumber, "xterminal");
        this.activateLink = (event, uri) => {
            console.log("link activate "+uri);
            DomTerm.handleLinkRef(uri, undefined, this);
        };
        this.linkHandler = {
            activate: (ev, text, range) => {
                this.activateLink(ev, text);
            },
            hover: (ev, text, range) => {
                console.log("link hover "+text);
            },
            leave: (ev, text, range) => {
                console.log("link leave "+text);
            },
            allowNonHttpProtocols: true
        };
        this.fitAddon = new FitAddon();
        this.webLinksAddon = new WebLinksAddon(this.activateLink, this.linkHandler);
        this.serializeAddon = new SerializeAddon.SerializeAddon();
        if (window.UnicodeGraphemesAddon)
            this.unicodeProvider = new window.UnicodeGraphemesAddon.UnicodeGraphemesAddon();
        this.imageAddon = new ImageAddon(imageCustomSettings);
    }
    initializeTerminal(_topNode) {
        this.rendererType = DTerminal.defaultXtRendererType;
        const xterm = this.terminal;
        this.xterm = xterm;

        xterm.options.linkHandler = this.linkHandler;
        xterm.options.scrollback = Infinity;
        let insertHtmlSupported = xterm.options.allowInsertHtml !== undefined;
        let allowInsertHtml = insertHtmlSupported; // FIXME
        xterm.options.allowInsertHtml = allowInsertHtml;
        xterm.options.scrollPartialLines = true;
        xterm.options.allowProposedApi = true;
        const winOptions = xterm.options.windowOptions;
        /*
        winOptions.restoreWin = true;
        winOptions.minimizeWin = true;
        winOptions.setWinSizeChars = true;
        */
        winOptions.getWinSizeChars = true;
        winOptions.getWinSizePixels = true;
        winOptions.getCellSizePixels = true;
        winOptions.pushTitle = true;
        winOptions.popTitle = true;

        xterm.attachCustomKeyEventHandler((e) => {
            if (e.type == 'keypress')
                this.keyPressHandler(e);
            else if (e.type == 'keydown')
                this.keyDownHandler(e);
            return false;
        });

        xterm.parser
            .addCsiHandler({final: 'u'},
                           params => {
                               switch (params[0]) {
                               case 91:
                                   this.setSessionNumber(params[1],
                                                         params[2],
                                                         params[3]-1,
                                                         params[4]);
                                   break;
                               case 99:
                                   if (params[1]==99) {
                                       DomTerm.closeFromEof(this);
                                       return true;
                                   }
                                   break;
                               default:
                                   console.log("csi handler for u "+params[0]);
                               }
                               return false;
                           });
        if (allowInsertHtml) {
            xterm.parser
                .registerOscHandler(72,
                                    (text) => {
                                        const htmlOptions = {};
                                        text = DtUtil.scrubHtml(text, htmlOptions);
                                        xterm.insertHtml(text);
                                        //term._scrubAndInsertHTML(text); });
                                    });
        }
        xterm.parser
            .registerOscHandler(88,
                                (text) => { DomTerm.setOptions(text); });
        xterm.parser
            .registerOscHandler(89,
                                (text) => {
                                    try {
                                        this.setSettings(JSON.parse(text));
                                    } catch(e) {
                                        console.log("error parsing settings file: "+e);
                                    }
                                });
        xterm.parser
            .registerOscHandler(97,
                                (text) => {
                                    let options, command;
                                    try {
                                        options = JSON.parse(text);
                                    } catch (ex) {
                                        options = { cmd: "unknown" };
                                    }
                                    command = options.cmd;
                                    switch (command) {
                                    case 'set-settings':
                                        this.setOptionsWithResponse(options.settings, options);
                                        break;
                                    default:
                                        console.log("unhandled OSC 97: "+command+" - "+text);
                                    };
                                });

        xterm.parser
            .registerOscHandler(103,
                                (text) => {
                                    console.log("restore saved snapshot "+text);
                                    const comma = text.indexOf(",");
                                    const rcount = Number(text.substring(0,comma));
                                    const data = DtUtil.fromJson(text.substring(comma+1));
                                    this._replayMode = true;
                                    this.sstate = data.sstate;
                                    xterm.resize(data.columns, data.rows);
                                    xterm.write(data.serialized,
                                                () => {
                                                    this._replayMode = false;
                                                    this._confirmedCount = rcount;
                                                    this.fitAddon.fit();
                                                });
                                });
        xterm.parser
            .registerOscHandler(231,
                                (data) => {
                                    this.pasteTextFromJson(data);
                                    return true;
                                });

        xterm.onBell(() => {
            this.handleBell();
        });
        xterm.onBinary((string) => {
            this.processResponseBytes(Uint8Array.from(string, v => v.charCodeAt(0)));
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
        xterm.loadAddon(this.webLinksAddon);
        xterm.loadAddon(this.imageAddon);
        xterm.loadAddon(this.serializeAddon);
        this.fitAddon.fit();
        if (this.unicodeProvider)
            xterm.loadAddon(this.unicodeProvider);
        this.attachResizeSensor();
        this.setRendererType(this.rendererType);
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

    updateThemeLater(context) {
        let theme = context._pendingTheme;
        if (! theme) {
            const oldTheme = this.xterm.options.theme;
            theme = {};
            if (oldTheme)
                Object.assign(theme, oldTheme);
            context.addCleanupHook((context) => {
                this.xterm.options.theme = theme;
            });
            context._pendingTheme = theme;
        }
        return theme;
    }

    updateColor(setting, value, context) {
        if (! value.match(/^#[0-9a-fA-F]{6}$/)) {
            context.reportError(context, "bad color "+JSON.stringify(value)+" for "+setting.name);
            return;
        }
        this.updateThemeLater(context)[setting.xtermThemeField] = value;
    }

    updateCaretColor(caret, caretAccent, context) {
        const theme = this.updateThemeLater(context);
        theme.cursor = caret;
        theme.cursorAccent = caretAccent;
    }

    updateSelectionColor(foreground, background, inactive, context) {
        const theme = this.updateThemeLater(context);
        if (! foreground && ! background && ! inactive) {
            foreground = '#ffffff';
            background = inactive = '#4040ff';
        }
        theme.selectionForeground = foreground;
        theme.selectionBackground = background;
        theme.selectionInactiveBackground = inactive;
    }

    // based on code in ttyd
    setRendererType(value) {
        //const { terminal } = this;
        const disposeWebglRenderer = () => {
            try {
                this.webglAddon?.dispose();
            } catch {
                // ignore
            }
            this.webglAddon = undefined;
        };
        const enableWebglRenderer = () => {
            if (this.webglAddon) return;
            this.webglAddon = new WebglAddon();
            try {
                this.webglAddon.onContextLoss(() => {
                    this.webglAddon?.dispose();
                });
                this.xterm.loadAddon(this.webglAddon);
                console.log('WebGL renderer loaded');
            } catch (e) {
                console.log('WebGL renderer could not be loaded, falling back to dom renderer', e);
                disposeWebglRenderer();
            }
        };

        switch (value) {
            case 'webgl':
                enableWebglRenderer();
                break;
            case 'dom':
                disposeWebglRenderer();
                console.log('dom renderer loaded');
                break;
            default:
                break;
        }
    }
}
window.XTermPane = XTermPane;

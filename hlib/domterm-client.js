import * as DtUtil from './domterm-utils.js';

// These should perhaps be combined
DomTerm.subwindows = true;
DomTerm.simpleLayout = false;

DomTerm.addTitlebar = false;

DomTerm.usingJsMenus = function() {
    // It might make sense to use jsMenus even for Electron.
    // One reason is support multi-key keybindings
    return ! DomTerm.simpleLayout && typeof MenuItem !== "undefined"
        && (! (DomTerm.isElectron() || DomTerm.usingQtWebEngine)
            || (DomTerm.addTitlebar && ! DomTerm.isMac));
}

DomTerm.useToolkitSubwindows = false;

// Non-zero if we should create each domterm terminal in a separate <iframe>.
// Only relevant when using a layout manager like GoldenLayout.
// Issues with !useIFrame:
// - Potentially less secure (all terminals in same frame).
// - Shared 'id' space.
// - Single selection rather than one per terminal.
// - CORS-related complications (we use a "file:" html file to verify browser
//   has read access, but that file can't load modules from "http:")
// Issues with useFrame:
// - Performance (extra overhead).
// - When using jsMenus with most deskop browsers, menu Copy doesn't work;
//   it does work when !useIFrame. (Menu Paste doesn't work either way.)
// - Popout-window buttons don't work.
// - Minor Qt context-menu glitch: When using iframe, showContextMenu
//   is called *after* the native event handler (see webview.cpp).
// The value 1 means don't use an iframe for the initial window, only
// subsequent ones.  The value 2 means use an iframe for all windows.
// Only using iframe for subsequent windows gives most of the benefits
// with less of the cost, plus it makes no-layout modes more consistent.
// It also makes debugging a bit simpler.
DomTerm.useIFrame = ! DomTerm.simpleLayout ? 1 : 0;

function setupQWebChannel(channel) {
    const backend = channel.objects.backend;
    DomTerm._qtBackend = backend;
    if (! DomTerm.usingJsMenus() && ! DomTerm.isSubWindow()) {
        DomTerm.popupMenu = function(cmenu, options) {
            backend.showContextMenu(JSON.stringify(cmenu));
        }
        const showContextMenu = DomTerm.showContextMenu;
        DomTerm.showContextMenu = function(options) {
            showContextMenu(options);
            return false;
        }
    }
    DomTerm.startSystemMove = function() {
        backend.startSystemMove();
    }
    DomTerm.startSystemResize = function(edges) {
        backend.startSystemResize(edges);
    }

    DomTerm.doCopy = function(asHTML=false) {
        if (DomTerm.dispatchTerminalMessage("request-selection", asHTML))
            return;
        DomTerm.valueToClipboard(Terminal._selectionValue(asHTML));
    }

    DomTerm.valueToClipboard = function(values) {
        backend.setClipboard(values.text, values.html);
        return true;
    }
    DomTerm.settingsHook = function(key, value) {
        backend.setSetting(key, value);
    };
    DomTerm.inputModeChanged = function(term, mode) {
        backend.inputModeChanged(mode);
    }
    if (DomTerm.mainSearchParams.get('qtdocking')) {
        DomTerm.newPane = function(paneOp, options=null, oldPane=DomTerm.focusedPane) {
            let windowNumber = options.windowNumber || -1;
            let url;
            if (options && options.componentType === "browser"
                && options.url) {
                url = options.url;
            } else {
                let url = DomTerm.paneLocation;
                if (options && options.sessionNumber) {
                    url += url.indexOf('#') >= 0 ? '&' : '#';
                    url += "session-number="+options.sessionNumber;
                }
                url = DomTerm.addLocationParams(url);
            }
            backend.newPane(paneOp, windowNumber, url);
        };
    }
    const oldAutoPagerChanged = DomTerm.autoPagerChanged;
    DomTerm.autoPagerChanged = function(term, mode) {
        backend.autoPagerChanged(mode);
        oldAutoPagerChanged(term, mode);
    }
    backend.writeOperatingSystemControl.connect(function(code, text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.handleOperatingSystemControl(code, text);
    });
    backend.forwardToParentWindow.connect((wnum, command, jargs) => {
        handleMessageFromChild(wnum, command, JSON.parse(jargs));
    });
    backend.forwardToChildWindow.connect((command, jargs) => {
        handleMessageFromParent(command, JSON.parse(jargs));
    });
    backend.reportEventToServer.connect(function(name, data) {
        let dt = DomTerm.focusedTerm;
        if (dt)
            dt.reportEvent(name, data);
    })
    backend.handleSimpleCommand.connect(function(command) {
        DomTerm.doNamedCommand(command);
    });
    backend.logToBrowserConsole.connect(function(str) {
        DomTerm.log(str);
    });
    DomTerm.saveFile = function(data) { backend.saveFile(data); }
    window.closeMainWindow = function() { backend.windowOp('close'); }
    DomTerm.windowOp = function(opname) { backend.windowOp(opname); }
    if (! DomTerm.addTitlebar) {
        window.setWindowTitle = function(title) {
            backend.setWindowTitle(title == null ? "" : title); };
    }
    DomTerm.sendSavedHtml = function(dt, html) { backend.setSavedHtml(html); }

    if (DomTerm.useToolkitSubwindows) {
        Object.assign(DomTerm.apphooks, {
            adoptPane: backend.adoptPane,
            closePane: backend.closePane,
            focusPane: backend.focusPane,
            lowerOrRaisePanes: backend.lowerOrRaisePanes,
            newPane: backend.newPane,
            sendChildMessage: backend.sendChildMessage,
            sendParentMessage: (command, args) => {
                backend.sendParentMessage(command, JSON.stringify(args));
            },
            setGeometry: backend.setGeometry,
            setPaneZoom: backend.setPaneZoom,
            showPane: backend.showPane
        });
    }
};

function setupParentMessages1() {
    // DomTerm.apphooks.sendParentMessage may not have been set yet.
    if (DomTerm.useToolkitSubwindows) {
        DomTerm.sendParentMessage = function(command, ...args) {
            DomTerm.apphooks.sendParentMessage(command, args);
        }
    } else {
        DomTerm.sendParentMessage = function(command, ...args) {
            window.parent.postMessage({"command": command, "args": args}, "*");
        }
    }
    DomTerm.showFocusedTerm = function(dt) {
        DomTerm.sendParentMessage("domterm-focused"); }
}

function setupParentMessages2() {
    DomTerm.showContextMenu = function(options) {
        DomTerm.sendParentMessage("domterm-context-menu", options);
        return ! DomTerm.usingQtWebEngine;
    }
}

DomTerm.createTitlebar = function(titlebarNode, tabs) {
    while (titlebarNode.firstChild)
        titlebarNode.removeChild(titlebarNode.firstChild);
    let titleButtons = DomTerm.titlebarButtons;
    if (! titleButtons) {
        titleButtons = DtUtil.createSpanNode("dt-titlebar-buttons");
        DomTerm.titlebarButtons = titleButtons;
        if (DomTerm.isMac) {
            if (DomTerm.isElectron()) {
                titleButtons.style.paddingRight = "68px";
            } else {
                titleButtons.classList.add("traffic-lights");
                titleButtons.insertAdjacentHTML('beforeend',
                                                '<button title="Close" class="dt-titlebar-button traffic-light traffic-light-close" id="dt-titlebar-close"></button>'
                                                + '<button title="Minimize" class="dt-titlebar-button traffic-light traffic-light-minimize" id="dt-titlebar-minimize"></button>'
                                                + '<button title="Maximize" class="dt-titlebar-button traffic-light traffic-light-maximize" id="dt-titlebar-maximize"></button>');
            }
        } else {
            titleButtons.insertAdjacentHTML('beforeend',
                                            '<span title="Minimize" class="dt-titlebar-button" id="dt-titlebar-minimize">&#x25BD;</span>'
                                            + '<span title="Maximize" class="dt-titlebar-button" id="dt-titlebar-maximize">&#x25B3;</span>'
                                            + '<span title="Close" class="dt-titlebar-button" id="dt-titlebar-close">&#x2612;</span>');
        }
    }

    let titlebarInitial = DomTerm.titlebarInitial;
    if (! titlebarInitial) {
        titlebarInitial = DtUtil.createSpanNode("dt-titlebar-prefix");
        DomTerm.titlebarButtons = titleButtons;
        if (DomTerm.isMac) {
            titlebarInitial.appendChild(titleButtons);
        }
        if (true) {
            let iconNode = document.createElement('img');
            iconNode.setAttribute('src', '/favicon.ico');
            iconNode.setAttribute("title", "DomTerm");
            titlebarInitial.appendChild(iconNode);
        }
        if (! DomTerm.isMac || DomTerm.versions.wry) {
            DomTerm._savedMenubarParent = titlebarInitial;
            DomTerm._savedMenubarBefore = null;
        }
    }
    if (DomTerm._savedMenuBar && DomTerm._savedMenubarParent) {
        Menu.setApplicationMenu(DomTerm._savedMenuBar,
                                DomTerm._savedMenubarParent,
                                DomTerm._savedMenubarBefore);
    }
    titlebarNode.appendChild(titlebarInitial);
    if (tabs) {
        titlebarNode.appendChild(tabs);
    } else {
        let titleNode = document.createElement('span');
        titleNode.classList.add('dt-window-title');
        titlebarNode.appendChild(titleNode);
        titleNode.innerText = "DomTerm window";
        DomTerm.displayWindowTitle = (info) => {
            // optimize if (partially) unchanged - FIXME
            let str = DomTerm.formatWindowLabel(info);
            titleNode.innerText = str;
            const wtitle = info.windowTitle;
            if (wtitle) {
                const wstr = "(" + wtitle +")";
                const tnode = DtUtil.createSpanNode("domterm-windowname", wstr);
                str = str ? str + " " + wstr : wstr;
                titleNode.appendChild(tnode);
            }
            DomTerm.displayTitleString(str);
        };
    }
    function dragWindowTarget(target) {
        for (let p = target; p instanceof Element; p = p.parentNode) {
            const cl = p.classList;
            if (cl.contains("dt-titlebar")) return true;
            if (cl.contains("menubar")) return false;
            if (cl.contains("lm_tab")) return false;
            if (cl.contains("dt-titlebar-button")) return false;
        }
        return false;
    }
    if (DomTerm.versions.wry || DomTerm.usingQtWebEngine) {
        function drag (e) {
            if (! dragWindowTarget(e.target))
                return;
            if (DomTerm.versions.wry)
                ipc.postMessage('drag-window');
            if (DomTerm.startSystemMove) {
                DomTerm.startSystemMove();
            }
        };
        titlebarNode.addEventListener('mousedown', drag);
        titlebarNode.addEventListener('touchstart', drag);
    }
    if (! DomTerm.isMac) {
        titlebarNode.appendChild(titleButtons);
    }
    if (! DomTerm.isMac || ! DomTerm.isElectron()) {
        titlebarNode.querySelector("#dt-titlebar-minimize")
            .addEventListener('click', (e) => {
                DomTerm.windowOp('minimize');
        });
        titlebarNode.querySelector("#dt-titlebar-maximize")
            .addEventListener('click', (e) => {
                DomTerm.doNamedCommand('toggle-fullscreen');
            });
        titlebarNode.querySelector("#dt-titlebar-close")
            .addEventListener('click', (e) => DomTerm.doNamedCommand('close-window'));
    }
}

function createResizeAreas() {
    if (DomTerm.versions.wry || DomTerm.usingQtWebEngine) {
        const resizeAreas = document.createElement('div');
        resizeAreas.classList.add("dt-resize-areas");
        document.body.appendChild(resizeAreas);
        function resizeHandler(ev) {
            const edges = ev.target.getAttribute("edges");
            DomTerm?.startSystemResize(edges);
        }
        function subarea(edges) {
            const resizeArea = document.createElement('div');
            resizeAreas.appendChild(resizeArea);
            resizeArea.classList.add("dt-resize-area");
            resizeArea.setAttribute("edges", edges);
            resizeArea.addEventListener('mousedown', resizeHandler);
        }
        subarea("n");
        subarea("s");
        subarea("e");
        subarea("w");
        subarea("s w");
        subarea("s e");
        subarea("n w");
        subarea("n e");
    }
}

DomTerm.resizeTitlebar = function(titlebarElement = DomTerm.titlebarCurrent) {
    if (! DomTerm.addTitlebar)
        return;
    console.log("resizeTitlebar");
};

function loadHandler(event) {
    //if (DomTermLayout.initialize === undefined || window.GoldenLayout === undefined)
    //DomTerm.useIFrame = false;
    const DomTermLayout = DomTerm._domtermLayout;
    let url = location.href;
    let hash = location.hash.replace(/^#/, '');
    let params = new URLSearchParams(hash);
    let sparams = new URLSearchParams(location.search);
    DomTerm.mainSearchParams = params;
    let m = params.get('js-verbosity');
    if (m) {
        let v = Number(m);
        if (v >= 0)
            DomTerm.verbosity = v;
    }
    m = params.get('log-string-max');
    if (m) {
        let v = Number(m);
        if (! isNaN(v))
            DomTerm.logStringMax = v;
    }
    m = params.get('log-to-server');
    if (m)
        DomTerm.logToServer = m;
    m = params.get('titlebar');
    if (m !== "system"
        && (m || DomTerm.isElectron() || DomTerm.usingQtWebEngine || DomTerm.versions.wry)) {
        DomTerm.addTitlebar = true;
    }
    const useXtermJs = params.get("terminal") === "xtermjs";
    if (useXtermJs && typeof window.XTermPane === "undefined")
        DomTerm.useIFrame = 2;
    m = params.get("subwindows");
    if (m === "qt") {
        DomTerm.useToolkitSubwindows = true;
        DomTerm.useIFrame = 2;
    } else if (m === "electron") {
        DomTerm.useToolkitSubwindows = true;
        DomTerm.useIFrame = 2;
        Object.assign(DomTerm.apphooks, {
            adoptPane: (wnum) => {
                electronAccess.ipcRenderer.send('adopt-pane', wnum);
            },
            closePane: (wnum) => {
                electronAccess.ipcRenderer.send('close-pane', wnum);
            },
            newPane: (wnum, url) => {
                electronAccess.ipcRenderer.send('new-pane', wnum, url);
            },
            sendChildMessage: (wnum, command, jargs) => {
                electronAccess.ipcRenderer.send('forward-message-to-child',
                                                wnum, command, jargs);
            },
            setGeometry: (wnum, x, y, width, height) => {
                const ratio = window.devicePixelRatio;
                electronAccess.ipcRenderer.send('set-pane-geometry',
                                                wnum, ratio * x, ratio * y,
                                                ratio * width, ratio * height);
            }
        });
        electronAccess.ipcRenderer.on('from-child-message',
                                      (event, wnum, command, args) => {
                                          handleMessageFromChild(wnum, command, args);
                                      });
    } else if (m === "no") {
        DomTerm.subwindows = false;
    }
    DomTerm.layoutTop = document.body;
    if (DomTerm.verbosity > 0)
        DomTerm.log("loadHandler "+url);
    DomTerm.server_port = location.port || DomTerm.server_port;
    DomTerm.topLocation = url;
    let hashPos = url.indexOf('#');
    DomTerm.mainLocation = hashPos < 0 ? url : url.substring(0, hashPos);
    DomTerm.paneLocation = ! DomTerm.useIFrame ? DomTerm.mainLocation
        : "http://localhost:"+DomTerm.server_port+"/simple.html";
    if (! DomTerm.server_key && (m = params.get('server-key')) != null) {
        DomTerm.server_key = m;
    }
    if (DomTerm.usingQtWebEngine) {
        DomTerm.paneLocation =
            DomTerm.paneLocation.replace("/simple.html", "/simple.html?with=qchannel");
        if (DomTerm.useToolkitSubwindows || ! DomTerm.isInIFrame())
            new QWebChannel(qt.webChannelTransport, setupQWebChannel);
    }
    if (DomTerm.isElectron()) {
        if (! DomTerm.isSubWindow()) {
            window.electronAccess.ipcRenderer
                .on("log-to-browser-console",
                    (_e, str) => DomTerm.log(str));
        } else if (DomTerm.useToolkitSubwindows) {
            electronAccess.ipcRenderer.on('from-parent-message',
                                          (event, command, jargs) => {
                                              handleMessageFromParent(command, JSON.parse(jargs));
                                          });
            DomTerm.apphooks.sendParentMessage = (command, args) => {
                electronAccess.ipcRenderer.send('forward-message-to-parent', command, args);
            };
        }
    }
    m = location.hash.match(/atom([^&;]*)/);
    if (m) {
        DomTerm.inAtomFlag = true;
        if (DomTerm.isInIFrame()) {
            setupParentMessages1();
            DomTerm.closeFromEof = function(dt) {
                DomTerm.sendParentMessage("domterm-close-from-eof"); }
        } else {
            DomTerm.sendParentMessage = function(command, ...args) {
                electronAccess.ipcRenderer.sendToHost(command, ...args);
             }
        }
        setupParentMessages2();
        /* Not relevant with new multi-message framework.
        DomTerm.displayInfoMessage = function(contents, dt) {
            DomTerm.sendParentMessage("domterm-status-message", contents);
        }
        */
    }

    let bodyNode = document.getElementsByTagName("body")[0];
    if (! DomTerm.useIFrame || ! DomTerm.isInIFrame()) {
        if (DomTerm.addTitlebar) {
            let titlebarNode = document.createElement('div');
            titlebarNode.classList.add('dt-titlebar');
            if (DomTerm.versions.wry) {
                //titlebarNode.setAttribute("data-tauri-drag-region", "");
                DomTerm.startSystemResize = function(edges) {
                    ipc.postMessage('resize-window ' + edges);
                }
            }
            titlebarNode.spellcheck = false;
            bodyNode.appendChild(titlebarNode);
            DomTerm.titlebarElement = titlebarNode;
            DomTerm.titlebarCurrent = titlebarNode;
            DomTerm.createTitlebar(titlebarNode, null);
            createResizeAreas();
            if (DomTerm.isMac && ! DomTerm.isElectron()) {
                const slink = document.createElement("link");
                slink.rel = "stylesheet";
                slink.text = "text/css";
                slink.href = "hlib/macos-traffic-lights.css";
                document.getElementsByTagName("head")[0].appendChild(slink);
            }
        }
        if (DomTerm.createMenus && ! DomTerm.simpleLayout)
            DomTerm.createMenus();
        DomTerm.resizeTitlebar(DomTerm.titlebarElement);
    }

    m = location.hash.match(/open=([^&;]*)/);
    const open_encoded = m ? decodeURIComponent(m[1]) : null;
    if (open_encoded)
        DomTerm.useIFrame = 2;

    let layoutInitAlways = DomTerm.subwindows && (DomTerm.useIFrame == 2 || DomTerm.addTitlebar);
    if (DomTerm.useIFrame || layoutInitAlways) {
        if (! DomTerm.isInIFrame()) {
            DomTerm.dispatchTerminalMessage = function(command, ...args) {
                const wnum = DomTerm.focusedWindowNumber;
                if (wnum > 0 && DomTerm.focusedTerm !== DomTerm.mainTerm) {
                    DomTerm.sendChildMessage(wnum, command, ...args);
                    return true;
                }
                return false;
            }
            DomTerm.sendChildMessage = function(lcontent, command, ...args) {
                let wnum, pane;
                if (lcontent instanceof PaneInfo) {
                    pane = lcontent;
                    wnum = pane.number;
                } else if (typeof lcontent === "number") {
                    wnum = lcontent;
                    pane = DomTerm.paneMap[wnum];
                }
                const terminal = pane?.terminal;
                let childWindow;
                if (DomTerm.apphooks.sendChildMessage && wnum >= 0) {
                    DomTerm.apphooks.sendChildMessage(wnum, command, JSON.stringify(args));
                } else if (terminal) {
                    handleMessageFromParent(command, args, terminal);
                } else if (pane?.contentElement instanceof HTMLIFrameElement
                           && (childWindow = pane?.contentElement?.contentWindow)) {
                    childWindow.postMessage({"command": command, "args": args}, "*");
                } else
                    console.log("sending "+command+" to unknown or closed child - ignored");
            }
        } else {
            setupParentMessages1();
            setupParentMessages2();
            DomTerm.displayWindowTitle = function(info) {
                DomTerm.sendParentMessage("set-window-title", info); }
        }
    }

    function focusHandler(e) {
        const focused = e.type === "focus";
        const wnum = DomTerm._mainWindowNumber;
        if (! DomTerm.isSubWindow())
            DomTerm.setWindowFocused(focused, false, wnum);
        else if (DomTerm.sendParentMessage)
            DomTerm.sendParentMessage("domterm-focus-window", focused, wnum);
    }
    window.addEventListener("focus", focusHandler);
    window.addEventListener("blur", focusHandler);
    let resizeTimeoutId = undefined;
    window.addEventListener("resize",
                            (ev) => {
                                if (resizeTimeoutId !== undefined)
                                    clearTimeout(resizeTimeoutId);
                                resizeTimeoutId = setTimeout(() => {
                                    DomTerm.updateBodySizeWithZoom();
                                    DomTerm.updateSizeFromBody();
                                }, 100);
                            },  { passive: true });
    DomTerm.setWindowFocused(true, DomTerm.isSubWindow());

    // non-null if we need to create a websocket but we have no Terminal
    let no_session = null;
    let browse_param = params.get("browse");
    if (browse_param)
        no_session = "browse";
    else if ((browse_param = params.get("view-saved")))
        no_session = "view-saved";
    const mwin = params.get('window');
    const mwinnum = mwin && Number(mwin) >= 0 ? Number(mwin) : -1;
    const snum = params.get('session-number');
    if (! DomTerm.isSubWindow()) {
        if (no_session === null
            && (DomTerm.useIFrame == 2))
            no_session = "top";
        if (no_session || useXtermJs) {
            const wparams = new URLSearchParams(hash);
            wparams.append("no-session", "top");
            wparams.delete("open");
            wparams.delete("session-number");
            wparams.set("main-window", "true");
            const pane = new DTerminal(mwinnum, "top");
            const dt = DomTerm.connectWS(wparams.toString(), pane, null);
            pane.terminal = dt;
            wparams.delete("main-window");
        }
        if (mwinnum >= 0)
            DomTerm._mainWindowNumber = mwinnum;
    }
    let paneParams = new URLSearchParams();
    let copyParams = ['server-key', 'js-verbosity', 'log-string-max',
                      'log-to-server', 'headless', 'titlebar',
                      'qtdocking', 'subwindows'];
    for (let i = copyParams.length;  --i >= 0; ) {
        let pname = copyParams[i];
        let pvalue = params.get(pname);
        if (pvalue)
            paneParams.set(pname, pvalue);
    }
    DomTerm.mainLocationParams = paneParams.toString();
    const lastBodyChild = document.body.lastChild;
    DomTerm.layoutBefore = null;
    if (open_encoded) {
        DomTerm.withLayout((m) => m.initSaved(JSON.parse(open_encoded)));
    } else if (DomTerm.loadDomTerm) { // used by electron-nodepty
        DomTerm.loadDomTerm();
    } else {
        let query = hash; // location.hash ? location.hash.substring(1).replace(/;/g, '&') : null;
        if (! DomTerm.isSubWindow()) {
            const cstate = { windowNumber: mwinnum };
            const snumn = snum && Number(snum);
            if (snumn > 0)
                cstate.sessionNumber = snumn;
            const wnameUnique = params.get("wname-unique");
            const wname = params.get("wname") || wnameUnique;
            if (params.get("terminal")==="xtermjs")
                cstate.use_xtermjs = true;
            if (wname) {
                cstate.windowName = wname;
                cstate.windowNameUnique = !!wnameUnique;
            }
            let ctype = useXtermJs ? "xterminal" : "domterm";
            if (browse_param) {
                cstate.url = browse_param;
                ctype = no_session === "browse" ? "browser" : no_session;
            }
            const config = { type: 'component',
                             componentType: ctype,
                             componentState: cstate };
           DomTerm._initialLayoutConfig = config;
        }
        let topNodes = [];
        topNodes = document.getElementsByClassName("domterm");
        if (topNodes.length == 0)
            topNodes = document.getElementsByClassName("domterm-wrapper");
        if (layoutInitAlways && ! DomTerm.isSubWindow()) {
            DomTerm.withLayout((m) => { m.initialize([DomTerm._initialLayoutConfig]); });
        } else if (topNodes.length == 0) {
            let name = (DomTerm.useIFrame && window.name) || DomTerm.freshName();
            let parent = DomTerm.layoutTop;
            // only needed if we might use DnD setDragImage
            if (! DomTerm.isSubWindow() && DomTerm.useSeparateContentChild()) {
                const wrapper = document.createElement("div");
                wrapper.classList.add("domterm-wrapper");
                parent.appendChild(wrapper);
                parent = wrapper;
            }
            let el;
            const mode = no_session === "browse" ? 'B' : 'T';
            if ((DomTerm.useIFrame == 2 || mode === 'B')
                && ! DomTerm.isSubWindow()) {
                if (snum)
                    paneParams.set('session-number', snum);
                if (mwin) {
                    paneParams.set('window', mwin);
                    paneParams.set('main-window', mwin);
                }
                DomTerm.mainLocationParams = paneParams.toString();
                const frame_url = mode === 'B' ? browse_param
                      : DomTerm.paneLocation/*+location.hash*/;
                el = DomTerm.makeIFrameWrapper(frame_url, mode, parent);
                DomTerm.maybeWindowName(el);
                paneParams.delete('session-number');
                paneParams.delete('window');
                DomTerm.mainLocationParams = paneParams.toString();
            } else {
                el = DomTerm.makeElement(name, parent, useXtermJs);
                if (DomTerm.mainTerm?.kind === "top")
                    query += "&main-window="+DomTerm._mainWindowNumber;
                else
                    query += "&main-window=true";
            }
            const pane = PaneInfo.create(mwinnum, useXtermJs ? "xterminal" : "dterminal");
            pane.contentElement = el;
            el.paneInfo = pane;
            DomTerm.focusedPane = pane;
            topNodes = [ el ];
            DomTerm._contentElement = el;
            DomTerm.updateSizeFromBody();
        }
        if (location.search.search(/wait/) >= 0) {
        } else if (! no_session || no_session === "view-saved") {
            for (var i = 0; i < topNodes.length; i++) {
                const top = topNodes[i];
                if (no_session === "view-saved") {
                    Terminal.loadSavedFile(top, browse_param);
                } else {
                    DomTerm.connectWS(query, top.paneInfo, top);
                }
                DomTerm.maybeWindowName(top);
            }
        }
        DomTerm.layoutBefore = lastBodyChild ? lastBodyChild.nextSibling : null;
    }
    if (lastBodyChild && lastBodyChild.parentNode == DomTerm._savedMenubarParent)
        DomTerm._savedMenubarBefore = lastBodyChild ? lastBodyChild.nextSibling : null;
    if (!DomTerm.inAtomFlag)
        location.hash = "";
}

DomTerm.handleCommand = function(iframe, command, args) {
    return false;
}

function handleMessageFromParent(command, args, dt = DomTerm.focusedTerm)
{
    if (dt == null) {
        dt = DomTerm.mainTerm;
    }
    const pane = dt ? dt.paneInfo : DomTerm.focusedPane;
    switch (command) {
    case "do-command":
        DomTerm.doNamedCommand(args[0], pane, args[1]);
        break;
    case "set-focused":
        if (pane)
            pane.setFocused(args[0]);
        break;
    case "term-settings":
        pane.termOptions = args[0];
        DomTerm.updateSettings(pane);
        break;
    case 'set-pane-zoom':
        DomTerm.updateBodyScale(args[0]);
        break;
    case "domterm-close":
        if (pane)
            pane.close(args[0], args[1]);
        break;
    }
}

function handleMessageFromChild(windowNum, command, args) {
    let dlayout = DomTerm._layout;
    let pane = DomTerm.paneMap[windowNum];
    if (! pane) {
        console.log(`bad window number ${windowNum} to '${command}' command`);
        return;
    }
    let item = pane.layoutItem;
    let lcontent = pane.contentElement;
    switch (command) {
    case "do-command":
        DomTerm.doNamedCommand(args[0], pane, args[1]);
        break;
    case "domterm-focus-window":
        DomTerm.setWindowFocused(args[0], true, args[1]);
        break;
    case "focus-event":
        if (item) {
            dlayout._selectLayoutPane(item, args[0]);
        }
        break;
    case "domterm-next-pane":
        if (dlayout && dlayout.manager) {
            dlayout.selectNextPane(args[0], windowNum);
        }
        break;
    case "layout-close":
        if (dlayout && dlayout.manager) {
            dlayout.layoutClose(lcontent/*item && item.container.element*/,
                                windowNum, args[0]);
        } else
            DomTerm.windowClose();
        break;
    case "domterm-set-title":
        if (item) {
            dlayout.updateLayoutTitle(item, args[0]);
        }
        break;
    case "domterm-update-title":
        DomTerm.updateTitle(null, args[0]);
        break;
    case "set-window-title":
        DomTerm.displayWindowTitle(args[0]);
        break;
    case "domterm-context-menu":
        let options = args[0];
        let x = options.clientX;
        let y = options.clientY;
        let element = item?.parent?.childElementContainer;
        if (element && x !== undefined && y !== undefined) {
            let ibox = element.getBoundingClientRect();
            x = x + element.clientLeft + ibox.x;
            y = y + element.clientTop + ibox.y;
            options = Object.assign({}, options, { "clientX": x, "clientY": y});
        }
        DomTerm._contextOptions = options;
        DomTerm.showContextMenu(options);
        break;
    case "value-to-clipboard":
        DomTerm.valueToClipboard(args[0]);
        break;
    default:
        console.log("unhandled command '"+command+"' in handleMessageFromChild");
    }
}

/* Used by atom-domterm or if useIFrame. */
function handleMessage(event) {
    const DomTermLayout = DomTerm._domtermLayout;
    var data = event.data;
    var dt=DomTerm.focusedTerm;
    let iframe = null;
    for (let ch = DomTerm.layoutTop.firstChild; ch != null; ch = ch.nextSibling) {
        let fr = ch.tagName == "DIV" && ch.classList.contains("lm_component")
            ? ch.lastChild
            : ch;
        if (fr && fr.tagName == "IFRAME" && fr.contentWindow == event.source) {
            iframe = fr;
            break;
        }
    }
    let windowNum = iframe && iframe.windowNumber;
    if (data.command && data.args
             && DomTerm.handleCommand(iframe, data.command, data.args))
        return;
    else if (data.command=="domterm-new-window") { // child to parent
        DomTerm.openNewWindow(null, data.args[0]);
    } else if (data.command=="auto-paging") {
            DomTerm.setAutoPaging(data.args[0]);
    } else if(data.command=="save-file") {
        DomTerm.saveFile(data.args[0]);
    } else if (data.command=="set-input-mode") { // message to child
        DomTerm.setInputMode(data.args[0]);
    } else if (data.command=="request-save-file") { // message to child
        DomTerm.doSaveAs();
    } else if (data.command=="popout-window") {
        let wholeStack = data.args[0];
        if (iframe) {
            let pane = DomTermLayout._elementToLayoutItem(iframe);
            DomTermLayout.popoutWindow(wholeStack ? pane.parent : pane);
        }
    } else if (data.command=="domterm-socket-close") { // message to child
        let pane = DomTerm.focusedPane;
        if (pane)
            pane.closeConnection();
    } else if (data.command=="request-selection") { // parent to child
        // FIXME rename to doNamedCommand("copy"/"copy-as-html");
        DomTerm.sendParentMessage("value-to-clipboard",
                                  Terminal._selectionValue(data.args[0]));
    } else if (data.command=="copy-selection") { // message to child
        DomTerm.doCopy(data.args[0]);
    } else if (data.command=="open-link") { // message to child
        DomTerm.handleLink(data.args[0]);
    } else if (data.command && data.args) {
        if (! iframe)
            handleMessageFromParent(data.command, data.args);
        else
            handleMessageFromChild(windowNum, data.command, data.args);
    } else
        console.log("received message "+data+" command:"+data.command+" dt:"+ dt);
}

window.addEventListener("load", loadHandler, false);
window.addEventListener("message", handleMessage, false);

(function(geometry) {
    if (geometry)
        window.resizeTo(geometry[1], geometry[2]);
})(location.hash.match(/geometry=([0-9][0-9]*)x([0-9][0-9]*)/));

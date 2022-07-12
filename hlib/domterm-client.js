var maxAjaxInterval = 2000;

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

/** Connect using XMLHttpRequest ("ajax") */
function connectAjax(name, prefix="", topNode=null)
{
    var wt = new DTerminal(name);
    if (topNode == null)
        topNode = document.getElementById("domterm");
    var xhr = new XMLHttpRequest();
    var sessionKey = 0;
    var pendingInput = null;
    var ajaxInterval = 200;
    var awaitingAjax = false;
    var timer = null;

    function handleAjaxOpen() {
        if (xhr.readyState === 4) {
            var key = xhr.responseText.replace(/key=/, "");
            wt.initializeTerminal(topNode);
            sessionKey = key;
            requestIO();
        }
    }

    function handleTimeout() {
        timer = null;
        requestIO();
    }

    function handleAjaxIO() {
        if (xhr.readyState === 4) {
	    var dlen = DomTerm._handleOutputData(wt, xhr.response);
            awaitingAjax = false;

            if (pendingInput != null) {
                ajaxInterval = 0;
                requestIO();
            } else {
                if (dlen > 0)
                    ajaxInterval = 0;
                ajaxInterval += 200;
                if (ajaxInterval > maxAjaxInterval)
                    ajaxInterval = maxAjaxInterval;
                timer = setTimeout(handleTimeout, ajaxInterval);
            }
        }
    }
    function requestIO() {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
        xhr.open("POST", prefix+"io-"+sessionKey);
        xhr.onreadystatechange = handleAjaxIO;
        xhr.responseType = "blob";
        var bytes = pendingInput;
        if (bytes !== null)
            ajaxInterval = 0;
        pendingInput = null;
        xhr.onerror= function(e) {
            wt.close();
        }
        let blob = new Blob(bytes == null ? [] : [bytes]);
        xhr.send(blob);
        awaitingAjax = true;
    }

    function onUnload(evt) {
        var request = new XMLHttpRequest();
        request.open("POST",prefix+"close-"+sessionKey);
        request.send("");
    }
    window.addEventListener("beforeunload", onUnload, false);

    function processInput(bytes) {
        if (pendingInput == null)
            pendingInput = bytes;
        else {
            let buf = new ArrayBuffer(pendingInput.byteLength+bytes.byteLength);
            let narr = new Uint8Array(buf);
            narr.set(pendingInput, 0);
            narr.set(bytes, pendingInput.byteLength);
            pendingInput = narr;
        }
        if (! awaitingAjax) {
            requestIO();
        }
    }
    wt.processInputBytes = processInput;

    xhr.open("POST", prefix+"open.txt");
    xhr.onreadystatechange = handleAjaxOpen;
    xhr.send("VERSION="+JSON.stringify(DomTerm.versionInfo));
}

function setupQWebChannel(channel) {
    var backend = channel.objects.backend;
    DomTerm._qtBackend = backend;
    if (! DomTerm.usingJsMenus() && ! DomTerm.addTitlebar) {
        DomTerm.showContextMenu = function(options) {
            backend.showContextMenu(options.contextType);
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
        DomTerm.valueToClipboard(DTerminal._selectionValue(asHTML));
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
        DomTerm.newPane = function(paneOp, options=null, dt=DomTerm.focusedTerm) {
            if (options && options.componentType === "browser"
                && options.url) {
                backend.newPane(paneOp, options.url);
            } else {
                let url = DomTerm.paneLocation;
                if (options && options.sessionNumber) {
                    url += url.indexOf('#') >= 0 ? '&' : '#';
                    url += "session-number="+options.sessionNumber;
                }
                backend.newPane(paneOp, DomTerm.addLocationParams(url));
            }
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
    backend.writeInputMode.connect(function(mode) {
        DomTerm.setInputMode(mode);
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
    backend.pasteText.connect(function(text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.pasteText(text);
    });
    backend.layoutAddPane.connect(function(paneOp) {
        DomTerm.newPane(paneOp);
    });
    backend.handleSimpleCommand.connect(function(command) {
        DomTerm.doNamedCommand(command);
    });
    backend.copyAsHTML.connect(function() {
        DomTerm.doCopy(true);
    });
    backend.logToBrowserConsole.connect(function(str) {
        DomTerm.log(str);
    });
    DomTerm.saveFile = function(data) { backend.saveFile(data); }
    DomTerm.windowClose = function() { backend.windowOp('close'); }
    DomTerm.windowOp = function(opname) { backend.windowOp(opname); }
    if (! DomTerm.addTitlebar) {
        window.setWindowTitle = function(title) {
            backend.setWindowTitle(title == null ? "" : title); };
    }
    DomTerm.sendSavedHtml = function(dt, html) { backend.setSavedHtml(html); }
};

function maybeWindowName(el, params = DomTerm.mainSearchParams) {
    if (params && el) {
        const wparam = params.get("window");
        const wnum = wparam ? Number(wparam) : -1;
        if (wnum >= 0)
            el.windowNumber = wnum;
        let wname_unique = params.get("wname-unique");
        let name = wname_unique || params.get("wname");
        if (name) {
            el.setAttribute("window-name", name);
            el.windowNameUnique = !!wname_unique;
        }
    }
    return el;
}

function viewSavedFile(urlEncoded, contextNode=DomTerm.layoutTop) {
    let url = decodeURIComponent(urlEncoded);
    // Requesting the saved file using a file: URL runs into CORS
    // (Cross-Origin Resource Sharing) restrictions on desktop browsers.
    if (url.startsWith("file:")) {
        url = "http://localhost:"+DomTerm.server_port
            +"/saved-file/"+DomTerm.server_key
            +"/"+url.substring(5);
        return DomTerm.makeIFrameWrapper(url, 'V', contextNode);
    }
    let el = DomTerm.makeElement(DomTerm.freshName());
    el.innerHTML = "<h2>waiting for file data ...</h2>";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.onreadystatechange = function() {
        if (xhr.readyState != 4)
            return;
        var responseText = xhr.responseText;
        if (! responseText) {
            el.innerHTML = "<h2>error loading "+url+"</h2>";
            return;
        }
        el.innerHTML = responseText;
        DomTermLayout.initSaved(el);
    };
    xhr.send("");
    return el;
}

function setupParentMessages1() {
    if (DomTerm.useToolkitSubwindows) {
        DomTerm.sendParentMessage = function(command, ...args) {
            DomTerm._qtBackend.sendParentMessage(command, JSON.stringify(args));
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

function createTitlebar(titlebarNode, tabs) {
    while (titlebarNode.firstChild)
        titlebarNode.removeChild(titlebarNode.firstChild);
    let titleButtons = DomTerm.titlebarButtons;
    if (! titleButtons) {
        titleButtons = DomTerm.createSpanNode("dt-titlebar-buttons");
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
        titlebarInitial = DomTerm.createSpanNode("dt-titlebar-prefix");
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
        DomTerm.displayWindowTitle = (wname, wtitle) => {
            // optimize if (partially) unchanged - FIXME
            titleNode.innerText = wname + (wtitle ? " " : "");
            if (wtitle) {
                const tnode = DomTerm.createSpanNode("domterm-windowname", "(" + wtitle +")");
                titleNode.appendChild(tnode);
            }
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
                ipc.postMessage('drag_window');
            if (DomTerm.startSystemMove) {
                DomTerm.startSystemMove();
            }
        };
        titlebarNode.addEventListener('mousedown', drag);
        titlebarNode.addEventListener('touchstart', drag);
    }
    if (DomTerm.usingQtWebEngine) {
        const resizeAreas = document.createElement('div');
        resizeAreas.classList.add("dt-resize-areas");
        function resizeHandler(ev) {
            const edges = ev.target.getAttribute("edges");
            DomTerm.startSystemResize(edges);
        }
        function subarea(edges) {
            const resizeArea = document.createElement('div');
            resizeArea.classList.add("dt-resize-area");
            resizeArea.setAttribute("edges", edges);
            document.body.appendChild(resizeAreas);
            resizeAreas.appendChild(resizeArea);
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

function resizeTitlebar(titlebarElement = DomTerm.titlebarCurrent) {
    if (! DomTerm.addTitlebar)
        return;
    console.log("resizeTitlebar");
}

function loadHandler(event) {
    //if (DomTermLayout.initialize === undefined || window.GoldenLayout === undefined)
    //DomTerm.useIFrame = false;
    const DomTermLayout = DomTerm._domtermLayout;
    let url = location.href;

    let hash = location.hash.replace(/^#[;]*/, '').replace(/;/g, '&');
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
    m = params.get("subwindows");
    if (m === "qt") {
        DomTerm.useToolkitSubwindows = true;
        DomTerm.useIFrame = 2;
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
    if (DomTerm.usingQtWebEngine
        && (DomTerm.useToolkitSubwindows || ! DomTerm.isInIFrame())) {
        new QWebChannel(qt.webChannelTransport, setupQWebChannel);
    }
    if (DomTerm.isElectron() && ! DomTerm.isSubWindow()) {
        window.electronAccess.ipcRenderer
            .on("log-to-browser-console",
                (_e, str) => DomTerm.log(str));
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
            bodyNode.appendChild(titlebarNode);
            DomTerm.titlebarElement = titlebarNode;
            DomTerm.titlebarCurrent = titlebarNode;
            createTitlebar(titlebarNode, null);
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
        resizeTitlebar(DomTerm.titlebarElement);
    }
    let bodyChild = bodyNode.firstElementChild;
    if (bodyChild) {
        let bodyClassList = bodyChild.classList;
        if (bodyClassList.contains('dt-titlebar') || bodyClassList.contains('nwjs-menu')) {
            let wrapTopNode = document.createElement('div');
            wrapTopNode.setAttribute("class", "below-menubar");
            bodyNode.appendChild(wrapTopNode);
            if (DomTerm._savedMenubarParent === bodyNode
                && DomTerm._savedMenubarBefore === null)
                DomTerm._savedMenubarBefore = wrapTopNode;
            DomTerm.layoutTop = wrapTopNode;
        }
    }
    m = location.hash.match(/open=([^&;]*)/);
    const open_encoded = m ? decodeURIComponent(m[1]) : null;
    if (open_encoded)
        DomTerm.useIFrame = 2;

    let layoutInitAlways = true; //DomTerm.useIFrame == 2;
    if (DomTerm.useIFrame || layoutInitAlways) {
        if (! DomTerm.isInIFrame()) {
            DomTerm.dispatchTerminalMessage = function(command, ...args) {
                const lcontent = DomTerm._oldFocusedContent;
                const w = lcontent && lcontent.contentWindow;
                if (w) {
                    w.postMessage({"command": command, "args": args}, "*");
                    return true;
                }
                return false;
            }
            DomTerm.sendChildMessage = function(lcontent, command, ...args) {
                if (typeof lcontent === "number") {
                    if (DomTerm.useToolkitSubwindows) {
                        DomTerm._qtBackend.sendChildMessage(lcontent, command, JSON.stringify(args));
                        return;
                    } else {
                        const item = DomTerm._layout._numberToLayoutItem(lcontent);
                        if (! item || ! item.component)
                            return;
                        lcontent = item.component;
                        if (lcontent && lcontent.terminal) {
                            handleMessageFromParent(command, args,
                                                    lcontent.terminal);
                            return;
                        }
                        // ... else fall through ...
                    }
                }
                let w = lcontent && lcontent.contentWindow;
                if (w)
                    w.postMessage({"command": command, "args": args}, "*");
                else
                    console.log("sending "+command+" to unknown or closed child - ignored");
            }
        } else {
            setupParentMessages1();
            setupParentMessages2();
            DomTerm.displayWindowTitle = function(wname, wtitle) {
                DomTerm.sendParentMessage("set-window-title", wname, wtitle); }
        }
    }

    function focusHandler(e) {
        const focused = e.type === "focus";
        if (window == top)
            DomTerm.setWindowFocused(focused, false);
        else if (DomTerm.sendParentMessage)
            DomTerm.sendParentMessage("domterm-focus-window", focused);
    }
    window.addEventListener("focus", focusHandler);
    window.addEventListener("blur", focusHandler);
    DomTerm.setWindowFocused(true, DomTerm.isSubWindow());

    // non-null if we need to create a websocket but we have no Terminal
    let no_session = null;
    if ((m = location.hash.match(/view-saved=([^&;]*)/))) {
        maybeWindowName(viewSavedFile(m[1]));
        no_session = "view-saved";
    }
    const browse_param = params.get("browse");
    if (browse_param)
        no_session = "browse";
    if (location.pathname.startsWith("/saved-file/")) {
        DomTerm.initSavedFile(DomTerm.layoutTop.firstChild);
        return;
    }
    const mwin = params.get('window');
    const mwinnum = mwin && Number(mwin) >= 0 ? Number(mwin) : -1;
    const snum = params.get('session-number');
    if (! DomTerm.isSubWindow()) {
        if (no_session === null && DomTerm.useIFrame == 2)
            no_session = "top";
        if (no_session) {
            const wparams = new URLSearchParams(hash);
            wparams.append("no-session", no_session);
            wparams.delete("open");
            wparams.delete("session-number");
            wparams.set("main-window", "true");
            DTerminal.connectWS(null, wparams.toString(), null, no_session);
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
    /*
    const windowConfigKey = sparams.get("gl-window");
    if (windowConfigKey) {
        const windowConfigStr = localStorage.getItem(windowConfigKey);
        if (windowConfigStr === null) {
            throw new Error('Null gl-window Config');
        }
        localStorage.removeItem(windowConfigKey);
        const minifiedWindowConfig = JSON.parse(windowConfigStr);
        DomTerm.withLayout((m) => {
            m.popinWindow(minifiedWindowConfig);
        });
        return;
    }
    */
    let topNodes = [];
    if (open_encoded) {
        DomTerm.withLayout((m) => m.initSaved(JSON.parse(open_encoded)));
    } else if (layoutInitAlways && ! DomTerm.isSubWindow()) {
        const cstate = { windowNumber: mwinnum };
        if (snum)
            cstate.sessionNumber = snum;
        const wnameUnique = params.get("wname-unique");
        const wname = params.get("wname") || wnameUnique;
        if (wname) {
            cstate.windowName = wname;
            cstate.windowNameUnique = !!wnameUnique;
        }
        cstate.windowName = wname;
        let ctype = 'domterm';
        if (browse_param) {
            cstate.url = browse_param;
            ctype = "browser";
        }
        const config = { type: 'component',
                         componentType: ctype,
                         componentState: cstate };
        DomTerm.withLayout((m) => { m.initialize([config]); });
    } else if (DomTerm.loadDomTerm) { // used by electron-nodepty
        DomTerm.loadDomTerm();
    } else {
        topNodes = document.getElementsByClassName("domterm");
        if (topNodes.length == 0)
            topNodes = document.getElementsByClassName("domterm-wrapper");
        if (topNodes.length == 0) {
            let name = (DomTerm.useIFrame && window.name) || DomTerm.freshName();
            let parent = DomTerm.layoutTop;
            if (! DomTerm.isSubWindow() && ! DomTerm.useToolkitSubwindow) {
                const wrapper = document.createElement("div");
                wrapper.classList.add("lm_component");
                wrapper.style.width = "100%";
                wrapper.style.height = "100%";
                parent.appendChild(wrapper);
                parent = wrapper;
            }
            let el;
            if (DomTerm.useIFrame == 2 && ! DomTerm.isSubWindow()) {
                if (snum)
                    paneParams.set('session-number', snum);
                if (mwin) {
                    paneParams.set('window', mwin);
                    paneParams.set('main-window', mwin);
                }
                DomTerm.mainLocationParams = paneParams.toString();
                el = DomTerm.makeIFrameWrapper(DomTerm.paneLocation/*+location.hash*/,
                                               'T', parent);
                maybeWindowName(el);
                paneParams.delete('session-number');
                paneParams.delete('window');
                DomTerm.mainLocationParams = paneParams.toString();
            } else {
                el = DomTerm.makeElement(name, parent);
            }
            topNodes = [ el ];
        }
        let query = hash; // location.hash ? location.hash.substring(1).replace(/;/g, '&') : null;
        if (location.search.search(/wait/) >= 0) {
        } else if (location.hash == "#ajax" || ! window.WebSocket) {
            DomTerm.usingAjax = true;
            for (var i = 0; i < topNodes.length; i++)
                connectAjax("domterm", "", topNodes[i]);
        } else if (! no_session) {
            for (var i = 0; i < topNodes.length; i++) {
                const top = topNodes[i];
                DTerminal.connectWS(null, query, top, no_session);
                maybeWindowName(top);
            }
        }
    }
    if (!DomTerm.inAtomFlag)
        location.hash = "";
}

DomTerm.handleCommand = function(iframe, command, args) {
    return false;
}

function handleMessageFromParent(command, args, dt = DomTerm.focusedTerm)
{
    switch (command) {
    case "set-focused":
        if (dt)
            dt.setFocused(args[0]);
        break;
    case "domterm-close":
        if (dt)
            dt.close(args[0], args[1]);
        break;
    }
}

function handleMessageFromChild(windowNum, command, args) {
    let dlayout = DomTerm._layout;
    let item;
    let lcontent = null;
    if (windowNum >= 0) {
        item = dlayout?._numberToLayoutItem(windowNum);
        for (let ch = DomTerm.layoutTop.firstElementChild; ch != null;
             ch = ch.nextElementSibling) {
            const ch2 = ch.classList.contains("lm_content") ? ch
                  : ch.firstElementChild;
            if ((ch === ch2 || (ch2 && ch2.classList.contains("lm_content")))
                && ch2.windowNumber == windowNum) {
                lcontent = ch2;
                break;
            }
        }
    } else {
        console.log(`bad window number ${windowNum} to '${command}' command`);
    }
    switch (command) {
    case "domterm-focus-window":
        DomTerm.setWindowFocused(args[0], true);
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
            dlayout.layoutClose(lcontent/*item && item.container.element*/, item, args[0]);
        } else
            DomTerm.windowClose();
        break;
    case "domterm-set-title":
        if (item) {
            dlayout.setLayoutTitle(item, args[0], args[1]);
        }
        break;
    case "domterm-update-title":
        DomTerm.updateTitle(null, args[0]);
        break;
    case "set-window-title":
        DomTerm.displayWindowTitle(args[0], args[1]);
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
    else if (data.command=="handle-output")
        DomTerm._handleOutputData(dt, data.output);
    else if (data.command=="socket-open") { // used by atom-domterm
        dt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
        dt.reportEvent("DETACH", "");
        dt.initializeTerminal(dt.topNode);
    } else if (data.command=="domterm-add-pane") { // in parent from child
        DomTerm.withLayout((m) =>
            m.addPane(data.args[0], data.args[1], iframe));
    } else if (data.command=="domterm-new-window") { // either direction
        DomTerm.openNewWindow(null, data.args[0]);
    } else if (data.command=="do-command") {
        DomTerm.doNamedCommand(data.args[0], iframe, data.args[1]);
    } else if (data.command=="auto-paging") {
            DomTerm.setAutoPaging(data.args[0]);
    } else if(data.command=="save-file") {
        DomTerm.saveFile(data.args[0]);
    } else if (data.command=="set-pid") {
        if (iframe)
            iframe.setAttribute("pid", data.args[0]);
    } else if (data.command=="domterm-numbers") {
        if (iframe) {
            if (data.args[0] > 0)
                iframe.setAttribute("session-number", data.args[0]);
            if (typeof data.args[1] === "number" && data.args[1] > 0)
                iframe.windowNumber = data.args[1];
        }
    } else if (data.command=="set-input-mode") { // message to child
        DomTerm.setInputMode(data.args[0]);
    } else if (data.command=="request-save-file") { // message to child
        DomTerm.doSaveAs();
    } else if (data.command=="popout-window") {
        let wholeStack = data.args[0];
        if (iframe) {
            let pane = DomTermLayout._elementToLayoutItem(iframe);
            DomTermLayout.popoutWindow(wholeStack ? pane.parent : pane, null);
        }
    } else if (data.command=="domterm-socket-close") { // message to child
        let dt = DomTerm.focusedTerm;
        if (dt)
            dt.closeConnection();
    } else if (data.command=="request-selection") { // parent to child
        // FIXME rename to doNamedCommand("copy"/"copy-as-html");
        DomTerm.sendParentMessage("value-to-clipboard",
                                   DTerminal._selectionValue(data.args[0]));
    } else if (data.command=="value-to-clipboard") { // in layout-context
        DomTerm.valueToClipboard(data.args[0]);
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

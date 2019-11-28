var maxAjaxInterval = 2000;

DomTerm.simpleLayout = false;

DomTerm.usingJsMenus = function() {
    // It might make sense to use jsMenus even for Electron.
    // One reason is support multi-key keybindings
    return ! DomTerm.simpleLayout && typeof MenuItem !== "undefined"
        && ! DomTerm.isElectron()
        && ! DomTerm.usingQtWebEngine;
}

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
// - jsMenus has problems, especially when mouse leaves the menu.
//   (A click should popdown menus, but doesn't. Keyboard navigation breaks.)
// - When using jsMenus with most deskop browsers, menu Copy doesn't work;
//   it does work when !useIFrame. (Menu Paste doesn't work either way.)
// - Popout-window buttons don't work.
// - Minor Qt context-menu glitch: When using iframe, showContextMenu
//   is called *after* the native event handler (see webview.cpp).
// The value 1 means don't use an iframe for the initial window, only
// subsequent ones.  The value 2 means use an iframe for all windows.
// Only using iframe for subsequent windows gives most of the benefits
// with less of the cost, plus it makes no-layout modes more consistent.
DomTerm.useIFrame = ! DomTerm.simpleLayout
    && ! DomTerm.usingJsMenus() ? 1 : 0;

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

DomTerm.handleSimpleMessage = function(command) {
    if (command=="serialize")
        DomTerm.saveWindowContents();  //or maybe DomTerm.detach();
    else if (command=="destroy-window")
        dt.reportEvent("destroy-window", "");
    else if (command=="open-link")
        DomTerm.handleLink(DomTerm._contextLink);
    else if (command=="copy-link-address")
        DomTerm.copyLink();
    else if (command=="copy")
        DomTerm.doCopy();
    else if (command=="context-copy")
        DomTerm.doContextCopy();
}

function setupQWebChannel(channel) {
    var backend = channel.objects.backend;
    DomTerm.showContextMenu = function(options) {
        backend.showContextMenu(options.contextType);
        return false;
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
    backend.pasteText.connect(function(text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.pasteText(text);
    });
    backend.layoutAddPane.connect(function(paneOp) {
        DomTerm.newPane(paneOp);
    });
    backend.handleSimpleMessage.connect(DomTerm.handleSimpleMessage);
    backend.handleSimpleCommand.connect(function(command) {
        DomTerm.doNamedCommand(command);
    });
    backend.copyAsHTML.connect(function() {
        DomTerm.doCopy(true);
    });
    DomTerm.saveFile = function(data) { backend.saveFile(data); }
    DomTerm.windowClose = function() { backend.closeMainWindow(); };
    DomTerm.setTitle = function(title) {
        backend.setWindowTitle(title == null ? "" : title); };
    DomTerm.sendSavedHtml = function(dt, html) { backend.setSavedHtml(html); }
    DomTerm.openNewWindow = function(dt, options={}) {
        let width = options.width || DomTerm.defaultWidth;
        let height = options.height || DomTerm.defaultHeight;
        backend.openNewWindow(width, height, options.url);
    }
};

function viewSavedFile(urlEncoded, contextNode=DomTerm.layoutTop) {
    let url;
    // Requesting the saved file using a file: URL runs into CORS
    // (Cross-Origin Resource Sharing) restrictions on desktop browsers.
    if (urlEncoded.startsWith("file:///")) {
        url = "http://localhost:"+DomTerm.server_port+"/saved-file/?server-key="+DomTerm.server_key+"&file="+urlEncoded.substring(7);
        return DomTermLayout.makeIFrameWrapper(url, false, contextNode);
    } else
        url = decodeURIComponent(urlEncoded);
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
    DomTerm.sendParentMessage = function(command, ...args) {
        window.parent.postMessage({"command": command, "args": args}, "*");
    }
    DomTerm.showFocusedTerm = function(dt) {
        DomTerm.sendParentMessage("domterm-focused"); }
    DomTerm.windowClose = function() {
        DomTerm.sendParentMessage("domterm-close"); }
}
function setupParentMessages2() {
    DomTerm.showContextMenu = function(options) {
        DomTerm.sendParentMessage("domterm-context-menu", options);
        return ! DomTerm.usingQtWebEngine;
    }
}

function loadHandler(event) {
    //if (DomTermLayout.initialize === undefined || window.GoldenLayout === undefined)
    //DomTerm.useIFrame = false;
    // console.log("loadHandler "+location);
    DomTerm.layoutTop = document.body;
    let url = location.href;
    let hashPos = url.indexOf('#');
    let uhash = "";
    if (hashPos >= 0) {
        uhash = url.substring(hashPos);
        url = url.substring(0, hashPos);
    }
    DomTerm.server_port = location.port || DomTerm.server_port;
    DomTerm.topLocation = url;
    if (DomTerm.useIFrame) {
        DomTerm.mainLocation = "http://localhost:"+DomTerm.server_port+"/simple.html";
    } else
        DomTerm.mainLocation = url;
    var m = url.match(/[#&]server-key=([^&]*)/);
    if (! DomTerm.server_key && (m = url.match(/[#&]server-key=([^&]*)/))) {
        DomTerm.server_key = m[1];
    }
    if (DomTerm.usingQtWebEngine && ! DomTerm.isInIFrame()) {
        new QWebChannel(qt.webChannelTransport, setupQWebChannel);
    }
    m = location.hash.match(/atom([^&]*)/);
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
        DomTerm.displayInfoMessage = function(contents, dt) {
            DomTerm.sendParentMessage("domterm-status-message", contents);
        }
    }
    if (! DomTerm.useIFrame || ! DomTerm.isInIFrame())
        if (DomTerm.setContextMenu && ! DomTerm.simpleLayout)
            DomTerm.setContextMenu();
    m = location.hash.match(/open=([^&]*)/);
    var open_encoded = m ? decodeURIComponent(m[1]) : null;
    if (open_encoded) {
        DomTermLayout.initSaved(JSON.parse(open_encoded));
        return;
    }
    var bodyNode = document.getElementsByTagName("body")[0];
    if (bodyNode.firstElementChild
        && bodyNode.firstElementChild.classList.contains("nwjs-menu")) {
        var wrapTopNode = document.createElement("div");
        wrapTopNode.setAttribute("class", "below-menubar");
        bodyNode.appendChild(wrapTopNode);
        DomTerm.layoutTop = wrapTopNode;
    }
    var layoutInitAlways = false;
    if (layoutInitAlways && ! DomTerm.isInIFrame()) {
        DomTermLayout.initialize(null);
        return;
    }
    var topNodes = document.getElementsByClassName("domterm");
    if (topNodes.length == 0)
        topNodes = document.getElementsByClassName("domterm-wrapper");
    if (DomTerm.useIFrame) {
        if (! DomTerm.isInIFrame()) {
            DomTerm.dispatchTerminalMessage = function(command, ...args) {
                const lcontent = DomTermLayout._oldFocusedContent;
                if (lcontent && lcontent.contentWindow) {
                    lcontent.contentWindow.postMessage({"command": command,
                                                        "args": args}, "*");
                    return true;
                }
                return false;
            }
            DomTerm.sendChildMessage = function(lcontent, command, ...args) {
                if (lcontent)
                    lcontent.contentWindow.postMessage({"command": command,
                                                        "args": args}, "*");
                else
                    console.log("sending "+command+" to unknow child - ignored");
            }
        } else {
            setupParentMessages1();
            setupParentMessages2();
            DomTerm.setTitle = function(title) {
                DomTerm.sendParentMessage("set-window-title", title); }
        }
    }
    if (top !== window && DomTerm.sendParentMessage) {
        // handled by handleMessage (for iframe pane)
        // *or* handled by atom-domterm.
        DomTerm.setLayoutTitle = function(dt, title, wname) {
            DomTerm.sendParentMessage("domterm-set-title", title, wname);
        };
    }
    m = location.hash.match(/view-saved=([^&]*)/);
    if (m) {
        viewSavedFile(m[1]);
        return;
    }
    if (location.pathname === "/saved-file/") {
        DomTerm.initSavedFile(DomTerm.layoutTop.firstChild);
        return;
    }
    if (DomTerm.useIFrame == 2 && ! DomTerm.isInIFrame()) {
        DomTermLayout.makeIFrameWrapper(DomTerm.mainLocation+uhash);
        return;
    }
    if (topNodes.length == 0) {
        let name = (DomTerm.useIFrame && window.name) || DomTerm.freshName();
        topNodes = [ DomTerm.makeElement(name) ];
    }
    if (location.search.search(/wait/) >= 0) {
    } else if (location.hash == "#ajax" || ! window.WebSocket) {
        DomTerm.usingAjax = true;
        for (var i = 0; i < topNodes.length; i++)
            connectAjax("domterm", "", topNodes[i]);
    } else {
        var wsurl = DTerminal._makeWsUrl(location.hash ? location.hash.substring(1) : null);
        for (var i = 0; i < topNodes.length; i++) {
            DTerminal.connectWS(null, wsurl, "domterm", topNodes[i]);
        }
    }
    if (!DomTerm.inAtomFlag)
        location.hash = "";
}

/* Used by atom-domterm or if useIFrame. */
function handleMessage(event) {
    var data = event.data;
    var dt=DomTerm.focusedTerm;
    let iframe = null;
    for (let ch = DomTerm.layoutTop.firstChild; ch != null; ch = ch.nextSibling) {
        if (ch.tagName == "IFRAME" && ch.contentWindow == event.source) {
            iframe = ch;
            break;
        }
    }
    if (typeof data == "string" || data instanceof String)
        DomTerm.handleSimpleMessage(data);
    else if (data.command=="handle-output")
        DomTerm._handleOutputData(dt, data.output);
    else if (data.command=="socket-open") {
        dt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
        dt.reportEvent("DETACH", "");
        dt.initializeTerminal(dt.topNode);
    } else if (data.command=="domterm-context-menu") {
        let options = data.args[0];
        let x = options.clientX;
        let y = options.clienty;
        if (iframe && x !== undefined && y !== undefined) {
            x = x + iframe.offsetLeft + iframe.clientLeft;
            y = y + iframe.offsetTop + iframe.clientTop;
            options = Object.assign({}, options, { "clientX": x, "clientY": y});
        }
        DomTerm.showContextMenu(options);
    } else if (data.command=="domterm-new-pane") { // either direction
        DomTerm.newPane(data.args[0], data.args[1]);
    } else if (data.command=="domterm-new-window") { // either direction
        DomTerm.openNewWindow(null, data.args[0]);
    } else if (data.command=="do-command") {
        DomTerm.doNamedCommand(data.args[0]);
    } else if (data.command=="auto-paging") {
            DomTerm.setAutoPaging(data.args[0]);
    } else if (data.command=="domterm-next-pane") {
        if (DomTermLayout.manager)
            DomTermLayout.selectNextPane(data.args[0], iframe);
    } else if (data.command=="set-window-title") {
        DomTerm.setTitle(data.args[0]);
    } else if (data.command=="layout-close") {
        if (DomTermLayout.manager)
            DomTermLayout.layoutClose(iframe,
                                      DomTermLayout._elementToLayoutItem(iframe));
        else
            DomTerm.windowClose();
    } else if(data.command=="save-file") {
        DomTerm.saveFile(data.args[0]);
    } else if (data.command=="focus-event") {
        if (iframe) {
            let originMode = data.args[0];
            if (DomTermLayout.manager)
                DomTermLayout._selectLayoutPane(DomTermLayout._elementToLayoutItem(iframe), originMode);
            else {
                DomTermLayout._focusChild(iframe, originMode);
                DomTermLayout._oldFocusedContent = iframe;
            }
        }
    } else if (data.command=="domterm-set-title") {
        if (iframe)
            DomTerm.setLayoutTitle(iframe,
                                         data.args[0], data.args[1]);
    } else if (data.command=="set-pid") {
        if (iframe)
            iframe.setAttribute("pid", data.args[0]);
    } else if (data.command=="set-session-number") {
        if (iframe)
            iframe.setAttribute("session-number", data.args[0]);
    } else if (data.command=="set-input-mode") { // message to child
        DomTerm.setInputMode(data.args[0]);
    } else if (data.command=="request-save-file") { // message to child
        DomTerm.doSaveAs();
    } else if (data.command=="set-focused") { // message to child
        let op = data.args[0];
        let dt = DomTerm.focusedTerm;
        if (dt) {
            dt.setFocused(op);
        }
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
    } else if (data.args.length == 0) {
        DomTerm.handleSimpleMessage(data.command);
    } else
        console.log("received message "+data+" command:"+data.command+" dt:"+ dt);
}

window.addEventListener("load", loadHandler, false);
window.addEventListener("message", handleMessage, false);

(function(geometry) {
    if (geometry)
        window.resizeTo(geometry[1], geometry[2]);
})(location.hash.match(/geometry=([0-9][0-9]*)x([0-9][0-9]*)/));

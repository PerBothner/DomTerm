var maxAjaxInterval = 2000;

DomTerm.simpleLayout = false;

DomTerm.usingJsMenus = function() {
    return ! DomTerm.simpleLayout && typeof MenuItem !== "undefined"
        && ! DomTerm.isElectron() && ! DomTerm.usingQtWebEngine;
}

// True if we should create each domterm terminal in a separate <iframe>.
// Only relevant when using a layout manager like GoldenLayout.
// Issues with !useIFrame:
// - Potentially less secure (all terminals in same frame).
// - Shared 'id' space.
// - Single selection rather than one per terminal.
// Issues with useFrame:
// - Performance (extra overhead).
// - jsMenus has problems, especially when mouse leaves the menu.
//   (A click should popdown menus, but doesn't. Keyboard navigation breaks.)
// - When using jsMenus with most deskop browsers, menu Copy doesn't work;
//   it does work when !useIFrame. (Menu Paste doesn't work either way.)
// - Popout-window buttons don't work.
DomTerm.useIFrame = ! DomTerm.simpleLayout
    && ! DomTerm.useXtermJs
    && ! DomTerm.usingJsMenus();

/** Connect using XMLHttpRequest ("ajax") */
function connectAjax(name, prefix="", topNode=null)
{
    var wt = new DomTerm(name);
    if (topNode == null)
        topNode = document.getElementById("domterm");
    var xhr = new XMLHttpRequest();
    var sessionKey = 0;
    var pendingInput = "";
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

            if (pendingInput.length > 0) {
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
        xhr.responseType = "text";
        var text = pendingInput;
        if (text.length > 0)
            ajaxInterval = 0;
        pendingInput = "";
        xhr.onerror= function(e) {
            wt.close();
        }
        xhr.send(text);
        awaitingAjax = true;
    }

    function onUnload(evt) {
        var request = new XMLHttpRequest();
        request.open("POST",prefix+"close-"+sessionKey);
        request.send("");
    }
    window.addEventListener("beforeunload", onUnload, false);

    function processInput(str) {
        pendingInput = pendingInput + str;
        if (! awaitingAjax) {
            requestIO();
        }
    }
    wt.processInputCharacters = processInput;

    xhr.open("POST", prefix+"open.txt");
    xhr.onreadystatechange = handleAjaxOpen;
    xhr.send("VERSION="+JSON.stringify(DomTerm.versionInfo));
}

DomTerm.handleSimpleMessage = function(command) {
    if (command=="serialize")
        DomTerm.saveWindowContents();  //or maybe DomTerm.detach();
    else if (command=="destroy-window")
        dt.reportEvent("destroy-window", "");
    else if (command=="detach")
        DomTerm.detach();
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
        if (DomTerm.useIFrame && ! DomTerm.isInIFrame()
            && DomTerm._oldFocusedContent) {
            DomTerm.sendChildMessage(DomTerm._oldFocusedContent,
                                     "request-selection", asHTML);
            return true;
        }
        DomTerm.valueToClipboard(DomTerm._selectionValue(asHTML));
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
    backend.writeOperatingSystemControl.connect(function(code, text) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.handleOperatingSystemControl(code, text);
    });
    backend.writeInputMode.connect(function(mode) {
        DomTerm.setInputMode(mode);
    });
    backend.layoutAddPane.connect(function(paneOp) {
        DomTerm.newPane(paneOp);
    });
    backend.detachSession.connect(function() {
        DomTerm.detach();
    });
    backend.handleSimpleMessage.connect(DomTerm.handleSimpleMessage);
    backend.copyAsHTML.connect(function() {
        DomTerm.doCopy(true);
    });
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
        return DomTerm.makeIFrameWrapper(url, false, contextNode);
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
        DomTerm.initSavedFile(el);
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
        DomTerm.setLayoutTitle = function(dt, title, wname) {
            DomTerm.sendParentMessage("domterm-set-title", title, wname);
        };
}

function loadHandler(event) {
    if (DomTerm.layoutInit === undefined || window.GoldenLayout === undefined)
        useIFrame = false;
    DomTerm.layoutTop = document.body;
    let url = location.href;
    let hashPos = url.indexOf('#');
    let uhash = "";
    if (hashPos >= 0) {
        uhash = url.substring(hashPos);
        url = url.substring(0, hashPos);
    }
    if (DomTerm.useIFrame)
        DomTerm.mainLocation = "http://127.0.0.1:"+DomTerm.server_port+"/simple.html";
    else
        DomTerm.mainLocation = url;
    var m;
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
                const {ipcRenderer} = nodeRequire('electron');
                ipcRenderer.sendToHost(command, ...args);
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
        DomTerm._initSavedLayout(JSON.parse(open_encoded));
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
        var cpid = location.hash.match(/connect-pid=([0-9]*)/);
        DomTerm.layoutInit(null);
        return;
    }
    var topNodes = document.getElementsByClassName("domterm");
    if (topNodes.length == 0)
        topNodes = document.getElementsByClassName("domterm-wrapper");
    if (DomTerm.useIFrame) {
        if (! DomTerm.isInIFrame()) {
            DomTerm.sendChildMessage = function(lcontent, command, ...args) {
                lcontent.contentWindow.postMessage({"command": command, "args": args}, "*");
            }
        } else {
            setupParentMessages1();
            setupParentMessages2();
            DomTerm.setTitle = function(title) {
                DomTerm.sendParentMessage("set-window-title", title); }
        }
    }
    m = location.hash.match(/view-saved=([^&]*)/);
    if (m) {
        var bodyNode = document.getElementsByTagName("body")[0];
        viewSavedFile(m[1], bodyNode);
        return;
    }
    if (location.pathname === "/saved-file/") {
        DomTerm.initSavedFile(DomTerm.layoutTop.firstChild);
        return;
    }
    if (DomTerm.useIFrame && ! DomTerm.isInIFrame()) {
        DomTerm.makeIFrameWrapper(DomTerm.mainLocation+uhash);
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
        var wsurl = DomTerm._makeWsUrl(location.hash ? location.hash.substring(1) : null);
        for (var i = 0; i < topNodes.length; i++) {
            DomTerm.connectWS(null, wsurl, "domterm", topNodes[i]);
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
    } else if (data.command=="auto-paging") {
            DomTerm.setAutoPaging(data.args[0]);
    } else if (data.command=="domterm-next-pane") {
        if (DomTerm.layoutManager)
            DomTerm.selectNextPane(data.args[0], iframe);
    } else if (data.command=="set-window-title") {
        DomTerm.setTitle(data.args[0]);
    } else if (data.command=="layout-close") {
        if (DomTerm.layoutManager)
            DomTerm.domTermLayoutClose(iframe,
                                       DomTerm._elementToLayoutItem(iframe));
        else
            DomTerm.windowClose();
    } else if(data.command=="save-file") {
        DomTerm.saveFile(data.args[0]);
    } else if (data.command=="focus-event") {
        let originMode = data.args[0];
        if (DomTerm.layoutManager)
            DomTerm._selectLayoutPane(DomTerm._elementToLayoutItem(iframe), originMode);
        else {
            DomTerm._focusChild(iframe, originMode);
            DomTerm._oldFocusedContent = iframe;
        }
    } else if (data.command=="domterm-set-title") {
        if (iframe)
            DomTerm.setLayoutTitle(iframe,
                                   data.args[0], data.args[1]);
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
    } else if (data.command=="domterm-socket-close") { // message to child
        let dt = DomTerm.focusedTerm;
        if (dt)
            dt.closeConnection();
    } else if (data.command=="request-selection") { // parent to child
        DomTerm.sendParentMessage("selection-value",
                                   DomTerm._selectionValue(data.args[0]));
    } else if (data.command=="selection-value") {
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

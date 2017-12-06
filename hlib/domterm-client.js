DomTerm._mask28 = 0xfffffff;
DomTerm.usingAjax = false;
DomTerm.usingQtWebEngine = !! location.hash.match(/[#&]qtwebengine/);

// data can be a DomString or an ArrayBuffer.
DomTerm._handleOutputData = function(dt, data) {
    var dlen;
    if (data instanceof ArrayBuffer) {
        dt.insertBytes(new Uint8Array(data));
        dlen = data.byteLength;
        // updating _receivedCount is handled by insertBytes
    } else {
        dt.insertString(data);
        dlen = data.length;
        dt._receivedCount = (dt._receivedCount + dlen) & DomTerm._mask28;
    }
    if (dt._pagingMode != 2
        && ((dt._receivedCount - dt._confirmedCount) & DomTerm._mask28) > 500) {
        dt._confirmedCount = dt._receivedCount;
        dt.reportEvent("RECEIVED", dt._confirmedCount);
    }
    return dlen;
}

/** Connect using WebSockets */
function connect(name, wspath, wsprotocol, topNode=null) {
    if (name == null) {
        name = topNode == null ? null : topNode.getAttribute("id");
        if (name == null)
            name = "domterm";
    }
    if (topNode == null)
        topNode = document.getElementById(name);
    var wt = new DomTerm(name);
    var wsocket = new WebSocket(wspath, wsprotocol);
    wt.closeConnection = function() { wsocket.close(); };
    wsocket.binaryType = "arraybuffer";
    wt.processInputCharacters = function(str) { wsocket.send(str); };
    wsocket.onmessage = function(evt) {
	DomTerm._handleOutputData(wt, evt.data);
    }
    wsocket.onopen = function(e) {
        wsocket.send("\x92VERSION "+DomTerm.versionInfo+"\n");
        wt.initializeTerminal(topNode);
    };
}

var maxAjaxInterval = 2000;

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
    xhr.send("VERSION="+DomTerm.versionInfo);
}

function makeWsUrl(query=null) {
    var ws = location.hash.match(/ws=([^,&]*)/);
    var url;
    if (ws) {
        var path = ws[1];
        if (path == "same")
            url = (location.protocol == "https:" ? "wss:" : "ws:")
            + "//"+location.hostname+":" + location.port + "/replsrc";
        else
            url = "ws:"+path;
    } else
        url = "ws://localhost:"+DomTerm.server_port+"/replsrc";
    if (query)
        url = url + '?' + query;
    if (DomTerm.server_key)
        url = url + (query ? '&' : '?') + 'server-key=' + DomTerm.server_key;
    return url;
}

function connectHttp(node, query=null) {
    var url = makeWsUrl(query);
    connect(null, url, "domterm", node);
}

function setupQWebChannel(channel) {
    var backend = channel.objects.backend;
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
        var dt = DomTerm.focusedTerm;
        if (dt)
            dt.setInputMode(mode);
    });
    backend.layoutAddPane.connect(function(paneOp) {
        var dt = DomTerm.focusedTerm;
        if (dt)
            DomTerm.layoutAddPane(dt, paneOp);
    });
    DomTerm.windowClose = function() { backend.closeMainWindow(); };
    DomTerm.setTitle = function(title) { backend.setWindowTitle(title); };
    DomTerm.sendSavedHtml = function(dt, html) { backend.setSavedHtml(html); }
    DomTerm.openNewWindow = function(dt, width=DomTerm.defaultWidth, height=DomTerm.defaultHeight, parameter=null) {
        let url = location.href;
        let hash = url.indexOf('#');
        if (hash >= 0)
            url = url.substring(0, hash);
        if (parameter)
            url = url + "#" + parameter;
        backend.openNewWindow(width, height, url);
    }
};

function viewSavedFile(url, bodyNode) {
    bodyNode.innerHTML = "<h2>waiting for file data ...</h2>";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.onreadystatechange = function() {
        if (xhr.readyState != 4)
            return;
        var responseText = xhr.responseText;
        if (! responseText) {
            bodyNode.innerHTML = "<h2></h2>";
            bodyNode.firstChild.appendChild(document.createTextNode("error loading "+url));
            return;
        }
        bodyNode.innerHTML = responseText;
        var topNode = bodyNode.firstChild;
        var name = "domterm";
        var dt = new DomTerm(name);
        dt.initial = document.getElementById(dt.makeId("main"));
        dt._initializeDomTerm(topNode);
        dt.sstate.windowName = "saved by DomTerm "+topNode.getAttribute("saved-version") + " on "+topNode.getAttribute("saved-time");
        dt._restoreLineTables(topNode, 0);
        dt._breakAllLines();
        dt.updateWindowTitle();
        function showHideHandler(e) {
            var target = e.target;
            if (target instanceof Element
                && target.nodeName == "SPAN"
                && target.getAttribute("std") == "hider") {
                dt._showHideHandler(e);
                e.preventDefault();
            }
        }
        topNode.addEventListener("click", showHideHandler, false);
        dt.setWindowSize = function(numRows, numColumns,
                                    availHeight, availWidth) {
        };
    };
    xhr.send("");
}

function loadHandler(event) {
    if (DomTerm.usingQtWebEngine) {
        new QWebChannel(qt.webChannelTransport, setupQWebChannel);
    }
    DomTerm.setContextMenu();
    var m = location.hash.match(/open=([^&]*)/);
    var open_encoded = m ? decodeURIComponent(m[1]) : null;
    if (open_encoded) {
        DomTerm._initSavedLayout(JSON.parse(open_encoded));
        return;
    }
    m = location.hash.match(/view-saved=([^&]*)/);
    if (m) {
        var bodyNode = document.getElementsByTagName("body")[0];
        viewSavedFile(decodeURIComponent(m[1]), bodyNode);
        return;
    }
    var layoutInitAlways = false;
    if (layoutInitAlways) {
        var cpid = location.hash.match(/connect-pid=([0-9]*)/);
        DomTerm.newSessionPid = cpid ? 0+cpid[1] : 0;
        DomTerm.layoutInit(null);
        DomTerm.newSessionPid = 0;
        return;
    }
    var topNodes = document.getElementsByClassName("domterm");
    if (topNodes.length == 0) {
        var bodyNode = document.getElementsByTagName("body")[0];
        var topNode = DomTerm.makeElement(bodyNode, DomTerm.freshName());
        topNodes = [ topNode ];
    }
    if (location.search.search(/wait/) >= 0) {
    } else if (location.hash == "#ajax" || ! window.WebSocket) {
        DomTerm.usingAjax = true;
        for (var i = 0; i < topNodes.length; i++)
            connectAjax("domterm", "", topNodes[i]);
    } else {
        var url = makeWsUrl(location.hash ? location.hash.substring(1) : null);
        for (var i = 0; i < topNodes.length; i++) {
            connect(null, url, "domterm", topNodes[i]);
        }
    }
    location.hash = "";
}

window.addEventListener("load", loadHandler, false);

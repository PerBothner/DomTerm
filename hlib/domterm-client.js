DomTerm._mask28 = 0xfffffff;
DomTerm.usingAjax = false;

// data can be a DomString or an ArrayBuffer.
DomTerm._handleOutputData = function(dt, data) {
    var dlen;
    if (data instanceof ArrayBuffer) {
        dt.insertBytes(new Uint8Array(data));
        dlen = data.byteLength;
    } else {
        dt.insertString(data);
        dlen = data.length;
    }
    dt._receivedCount = (dt._receivedCount + dlen) & DomTerm._mask28;
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

function _activeContentItemHandler(item) {
    var dt = DomTerm.layoutItemToDomTerm(item);
    console.log(" activeContentItemHandler "+item+" dt:"+(dt?dt.name:dt));
    if (dt) {
        DomTerm.setFocus(dt);
    }
}

function loadHandler(event) {
    DomTerm.setContextMenu();
    if (false) {
        DomTerm.layoutInit(null);
        return;
    }
    var topNodes = document.getElementsByClassName("domterm");
    if (topNodes.length == 0) {
        var topNode = document.createElement("div");
        topNode.setAttribute("class", "domterm");
        topNode.setAttribute("id", DomTerm.freshName());
        var bodyNode = document.getElementsByTagName("body")[0];
        bodyNode.appendChild(topNode);
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

}

function unloadHandler(evt) {
    //dt.reportEvent("WINDOW-CLOSED", "");
    if (DomTerm.isElectron()) {
        const {app} = nodeRequire('electron').remote
        app.on('certificate-error',
               function (event, webContents, url, error, certificate, callback)
               { callback(true); });
    }
    var request = new XMLHttpRequest();
    // FIXME maybe use POST?
    request.open("GET", "(WINDOW-CLOSED)");
    request.send(null);
}

window.addEventListener("load", loadHandler, false);
if (! DomTerm.usingAjax)
    window.addEventListener("beforeunload", unloadHandler, false);

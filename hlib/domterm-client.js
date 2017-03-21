DomTerm._mask28 = 0xfffffff;

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
    if (((dt._receivedCount - dt._confirmedCount) & DomTerm._mask28) > 500) {
        dt._confirmedCount = dt._receivedCount;
        dt.reportEvent("RECEIVED", dt._confirmedCount);
    }
    return dlen;
}

/** Connect using WebSockets */
function connect(wspath, wsprotocol) {
    var wt = new DomTerm("domterm");
    window.domterm1 = wt;
    var wsocket = new WebSocket(wspath, wsprotocol);
    wsocket.binaryType = "arraybuffer";
    wt.processInputCharacters = function(str) { wsocket.send(str); };
    wsocket.onmessage = function(evt) {
	DomTerm._handleOutputData(wt, evt.data);
    }
    var topNode = document.getElementById("domterm");
    wsocket.onopen = function(e) {
        wsocket.send("\x92VERSION "+DomTerm.versionInfo+"\n");
        wt.initializeTerminal(topNode);
 };
}

var maxAjaxInterval = 2000;

/** Connect using XMLHttpRequest ("ajax") */
function connectAjax(prefix="")
{
    var wt = new DomTerm("domterm");
    window.domterm1 = wt;
    var xhr = new XMLHttpRequest();
    var sessionKey = 0;
    var pendingInput = "";
    var ajaxInterval = 200;
    var awaitingAjax = false;
    var timer = null;

    function handleAjaxOpen() {
        var xhr = window.xmlHttpRequest;
        var wt = window.domterm1;
        if (xhr.readyState === 4) {
            var key = xhr.responseText.replace(/key=/, "");
            var topNode = document.getElementById("domterm");
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
    window.xmlHttpRequest = xhr;
}

function loadHandler(event) {
    if (location.search.search(/wait/) >= 0) {
    } else if (location.hash == "#ajax" || ! window.WebSocket) {
        connectAjax();
    } else {
        var ws = location.hash.match(/ws=([^,&]*)/);
        var url;
        if (ws) {
            var path = ws[1];
            if (path == "same")
                url = (location.protocol == "https:" ? "wss:" : "ws:")
                + "//localhost:" + location.port + "/replsrc";
            else
                url = "ws:"+path;
        } else
            url = "ws://localhost:8025/websocket/replsrv";
        // A kludge - the libwebsockets server requires a protocol "domterm",
        // but the Java-WebServer server doesn't support that.  FIXME
        var wsprotocol = location.hash.indexOf("ws=same") >= 0
            ? "domterm" : [];
        connect(url, wsprotocol);
    }
}
window.addEventListener("load", loadHandler, false);

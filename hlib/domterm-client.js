function connect(wspath, wsprotocol) {
    var wt = new DomTerm("domterm");
    window.domterm1 = wt;
    var wsocket = new WebSocket(wspath, wsprotocol);
    wsocket.binaryType = "arraybuffer";
    wt.processInputCharacters = function(str) { wsocket.send(str); };
    wsocket.onmessage = function(evt) {
        if (evt.data instanceof ArrayBuffer)
            wt.insertBytes(new Uint8Array(evt.data));
        else
            wt.insertString(evt.data);
    }
    var topNode = document.getElementById("domterm");
    wsocket.onopen = function(e) {
        wsocket.send("\x92VERSION "+wt.versionInfo+"\n");
        wt.initializeTerminal(topNode); };
}

function loadHandler(event) {
    if (location.search.search(/wait/) < 0) {
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

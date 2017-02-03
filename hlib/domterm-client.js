function connect(wspath) {
    var wt = new DomTerm("domterm");
    window.domterm1 = wt;
    // A kludge - the libwebsockets server requires a protocol "domterm",
    // but the Java-WebServer server doesn't support that.  FIXME
    var wsocket = location.hash.indexOf("ws=same") >= 0
        ? new WebSocket(wspath, "domterm")
        : new WebSocket(wspath);
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
    var query = location.search;
    var ws = location.hash.match(/ws=([^&]*)/);
    if (ws) {
        var path = ws[1];
        if (path == "same")
            url = (location.protocol == "https:" ? "wss:" : "ws:")
            + "//localhost:" + location.port + "/replsrc";
        else
            url = "ws:"+path;
        connect(url);
    } else if (query.search(/wait/) < 0)
        connect("ws://localhost:8025/websocket/replsrv");
}
window.addEventListener("load", loadHandler, false);

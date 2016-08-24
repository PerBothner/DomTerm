function connect(wspath) {
    var wt = new DomTerm("domterm");
    window.domterm1 = wt;
    var wsocket = new WebSocket(wspath);
    wt.processInputCharacters = function(str) { wsocket.send(str); };
    wsocket.onmessage = function(evt) {  wt.insertString(evt.data); }
    var topNode = document.getElementById("domterm");
    wsocket.onopen = function(e) {
        wsocket.send("\x92VERSION "+wt.versionInfo+"\n");
        wt.initializeTerminal(topNode); };
}
function loadHandler(event) {
    var query = location.search;
    var ws = query.match(/ws=([^&]*)/);
    if (! ws)
        ws = location.hash.match(/ws=([^&]*)/);
    if (ws)
        connect("ws:"+ws[1]);
    else if (query.search(/wait/) < 0)
        connect("ws://localhost:8025/websocket/replsrv");
}
window.addEventListener("load", loadHandler, false);

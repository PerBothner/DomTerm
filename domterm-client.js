function connect(wspath) {
    var wt = new DomTerm("term1");
    window.domterm1 = wt;
    var wsocket = new WebSocket(wspath);
    wt.processInputCharacters = function(str) { wsocket.send(str); };
    wsocket.onmessage = function(evt) {  wt.insertString(evt.data); }
    var topNode = document.getElementById("term1");
    wsocket.onopen = function(e) {
        wsocket.send("\x92VERSION "+wt.versionInfo+"\n");
        wt.initializeTerminal(topNode); };
}
function loadHandler(event) {
    if (location.search.search(/wait/) < 0)
        connect("ws://localhost:8025/websocket/replsrv");
}
window.addEventListener("load", loadHandler, false);

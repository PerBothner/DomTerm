function loadHandler(event) {
    var wt = new DomTerm("term1");
    window.domterm1 = wt;
    var topNode = document.getElementById("domterm");

    var query = location.search;
    var ws = query.match(/ws=([^&]*)/);
    if (ws) {
        var wsocket = new WebSocket(ws[1]);
        wt.processInputCharacters = function(str) { wsocket.send(str); };
        wsocket.onmessage = function(evt) {  wt.insertString(evt.data); }
        var topNode = document.getElementById("term1");
        wsocket.onopen = function(e) {
            wsocket.send("\x92VERSION QtDomTerm;"+wt.versionInfo+"\n");
            wt.initializeTerminal(topNode); };
        return;
    }
    new QWebChannel(qt.webChannelTransport,
        function(channel) {
            var backend = channel.objects.backend;
            window.backend = backend;
            backend.reportEvent("VERSION", wt.versionInfo);
            wt.initializeTerminal(topNode);
            wt.processInputCharacters =
                function(str) { if (backend) backend.processInputCharacters(str); };
            wt.reportEvent =
                function(name, data) { if (backend) backend.reportEvent(name, data); };
            wt.log =
                function(str) {
                    if (backend) backend.log(str); };
            wt.close = function() { if (backend) backend.close(); }
            backend.write.connect(function (msg) {
                wt.insertString(msg); });
            backend.run();
    });
}
window.addEventListener("load", loadHandler, false);

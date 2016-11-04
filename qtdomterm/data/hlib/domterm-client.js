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
            /*
            wt.log =
                function(str) {
                    if (backend) backend.log(str); };
            */
            wt.close = function() { if (backend) backend.close(); }
            backend.writeInputMode.connect(function(mode) {
                wt.setInputMode(mode);
            });
            backend.writeSetCaretStyle.connect(function(mode) {
                wt.setCaretStyle(mode);
            });
            backend.writeOperatingSystemControl.connect(function(code, text) {
                wt.handleOperatingSystemControl(code, text);
            });
            // Decode encoding done by Backend::onReceiveBlock
            // See backend.cpp.
            backend.writeEncoded.connect(function(length, encoded) {
                var bytes = new Uint8Array(length);
                var j = 0;
                for (var i = 0; i < length; ) {
                    var ch = encoded.charCodeAt(j++);
                    if (ch >= 32 || (ch >= 8 && ch <= 13))
                        bytes[i++] = ch;
                    else if (ch == 14)
                        bytes[i++] = 27;
                    else if (ch == 15) {
                        bytes[i++] = 0xC0 | (encoded.charCodeAt(j++) - 48);
                        bytes[i++] = 0x80 | (encoded.charCodeAt(j++) - 48);
                    } else if (ch >= 16 && ch < 32) {
                        bytes[i++] = 0xE0 | (ch-16);
                        bytes[i++] = 0x80 | (encoded.charCodeAt(j++) - 48);
                        bytes[i++] = 0x80 | (encoded.charCodeAt(j++) - 48);
                    } else if (ch > 4) {
                        bytes[i++] = 0xC0 | (ch - 4);
                        bytes[i++] = 0x80 | (encoded.charCodeAt(j++) - 48);
                    } else
                        bytes[i++] =
                          (ch << 6) | (encoded.charCodeAt(j++) - 48)
                }
                wt.insertBytes(bytes);
            });

            /*
            backend.write.connect(function (msg) {
                wt.insertString(msg); });
            */
            backend.run();
    });
}
window.addEventListener("load", loadHandler, false);

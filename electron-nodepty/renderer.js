function connectSession(term, termElement, paneId=0) {
    const ipcRenderer = electronAccess.ipcRenderer;

    term.processInputBytes = function(data) {
        ipcRenderer.send('process-input-bytes', paneId, data);
    };
    term.reportEvent = function(name, data) {
        ipcRenderer.send('report-event', paneId, name, data);
    };
    term.setWindowSize = function(numRows, numColumns,
                                  availHeight, availWidth) {
        ipcRenderer.send('set-window-size', paneId, numRows, numColumns,
                         availHeight, availWidth);
    };
    ipcRenderer.on('output-data', function (event, paneId, data) {
        if (paneId == 0)
            DomTerm._handleOutputData(term, data);
        else {
            let childNode = DomTerm.layoutTop.firstChild;
            for (; childNode != null; childNode = childNode.nextSibling) {
                if (childNode.tagName == "IFRAME"
                    && childNode.paneNumber === paneId) {
                    DomTerm.sendChildMessage(childNode,
                                             'output-data', paneId, data);
                }
            }
        }
    });
    DomTerm.aboutMessageVariant = function() {
        return ' This variant of DomTerm uses Electron '
            + DomTerm.versions.electron
            + ' for the "front-end" and node.js ' + electronAccess.process.versions.node +' with node-pty for the "back-end".';
    };

    term.initializeTerminal(termElement);
    term.reportEvent("VERSION", DomTerm.versionInfo);
}

DomTerm.loadDomTerm = function() {
    console.log("loadDomTerm called in iframe:"+DomTerm.isInIFrame());
    DomTerm.mainLocation = location.href;
    let name = "kterm1";
    let termElement = DomTerm.makeElement(name, document.body);
    let term = new window.DTerminal(name);
    DomTerm.setInputMode(99, term);
    DomTerm.supportsAutoInputMode = false;

    if (! DomTerm.isInIFrame()) {
        connectSession(term, termElement);
        DomTerm.handleCommand = function(iframe, command, args) {
            let paneId = iframe ? iframe.paneNumber : 0;
            if (command == 'process-input-bytes'
                || command == 'report-event'
                || command == 'set-window-size') {
                electronAccess.ipcRenderer.send(command, paneId, ... args);
                return true;
            }
            return false;
        }
        DomTerm.newPaneHook = function(paneNumber, sessionNumber, wrapper) {
            electronAccess.ipcRenderer.send('new-pane', paneNumber, -1);
        }
    } else {
        // in iframe
        DomTerm.handleCommand = function(iframe, command, args) {
            if (command==='output-data') {
                DomTerm._handleOutputData(DomTerm.focusedTerm, args[1]);
                return true;
            }
            return false;
        }
        term.processInputBytes = function(data) {
            DomTerm.sendParentMessage('process-input-bytes', data);
        };
        term.reportEvent = function(name, data) {
            console.log("inferior reportEvent "+name+" "+data);
            DomTerm.sendParentMessage("report-event", name, data);
        };
        term.setWindowSize = function(numRows, numColumns,
                                      availHeight, availWidth) {
            DomTerm.sendParentMessage('set-window-size',
                                      numRows, numColumns,
                                      availHeight, availWidth);
        };
        term.initializeTerminal(termElement);
    }
}

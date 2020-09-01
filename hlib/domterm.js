/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019 Per Bothner.
 */

const DomTerm = new Object(); //maybe use Terminal - FIXME

class DomTermLayout {
};

DomTermLayout.manager = null;

DomTerm.verbosity = 0;
DomTerm.logToServer = false;
DomTerm._savedLogEntries = null;

DomTerm.log = function(str, dt=null) {
    if (dt && dt._socketOpen)
        dt.log(str);
    else {
        let to_server = DomTerm.logToServer;
        let report = to_server === "yes" || to_server === "true";
        if (report || report === "both") {
            if (! DomTerm._savedLogEntries)
                DomTerm._savedLogEntries = new Array();
            DomTerm._savedLogEntries.push(str);
        }
        if (! report || report == "bothner") {
            console.log(str);
        }
    }
}

DomTerm._instanceCounter = 0;

/** The <body>, or a node below the menubar if using jsMenus. */
DomTerm.layoutTop = null; // document.body is null until loaded

DomTerm.supportsAutoInputMode = true;

DomTerm.freshName = function() {
    return "domterm-"+(++DomTerm._instanceCounter);
}

DomTerm.isInIFrame = function() { return window.parent != window; }

DomTerm.usingAjax = false;
DomTerm.usingQtWebEngine = !!navigator.userAgent.match(/QtWebEngine[/]([^ ]+)/);

DomTerm._escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

DomTerm.escapeText = function(text) {
    // Assume single quote is not used in attributes
    return text.replace(/[&<>"]/g,
                        function(m) { return DomTerm._escapeMap[m]; });
};

DomTerm.isLineBlock = function(node) {
    let tag = node.tagName;
    return tag == "PRE" || tag == "P"
        || (tag == "DIV" && node.classList.contains("domterm-pre"));
}

DomTerm.setTitle = function(title) {
    if (window.setWindowTitle)
        window.setWindowTitle(title); // hook used by --webview
    else
       document.title = title;
}

DomTerm.forEachTerminal = function(func) {
    if (DomTerm.useIFrame && DomTerm.focusedTerm) // optimization
        return (func)(DomTerm.focusedTerm);
    let elements = document.getElementsByClassName("domterm");
    let n = elements.length;
    for (let i = 0; i < n; i++) {
        let t = elements[i].terminal;
        if (t)
            (func)(t);
    }
}

// True if pane should be split into a vertical stack, with new pane --below.
DomTerm._splitVertically = function(dt) {
    return dt.numColumns < 3*dt.numRows && (dt.numRows>40 || dt.numColumns<90);
}

/* Can be called in either DomTerm sub-window or layout-manager context. */
DomTerm.newPane = function(paneOp, options = null, dt = DomTerm.focusedTerm) {
    if (paneOp == 1 && dt) // convert to --right or --below
        paneOp = DomTerm._splitVertically(dt) ? 13 : 11;
    if (paneOp == 1 && DomTerm.useIFrame && ! DomTerm.isInIFrame())
        DomTerm.sendChildMessage(DomTermLayout._oldFocusedContent, "domterm-new-pane", paneOp, options);
    else if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("domterm-new-pane", paneOp, options);
    else if (paneOp == 1 && DomTermLayout.addSibling) {
        DomTermLayout.addSibling(options, DomTerm._splitVertically(dt));
    } else if (paneOp == 2 && DomTermLayout.addTab)
        DomTermLayout.addTab(options);
    else if (DomTermLayout.addSibling) {
        DomTermLayout.addSibling(options,
                                 paneOp==12||paneOp==13, paneOp==11||paneOp==13);
    }
    //DomTerm.newSessionPid = 0;
}

DomTerm.closeAll = function(event) {
    DomTerm.forEachTerminal(dt => {
        dt.historySave();
        dt.reportEvent("CLOSE-SESSION");
    })
}

DomTerm.windowClose = function() {
    if (window.closeMainWindow) {
        DomTerm.closeAll(null);
        window.closeMainWindow(); // hook used by --webview
    } else
        window.close();
}

DomTerm._extractGeometryOptions = function(options={}) {
    if (options.width && options.height)
        return options;
    let width = options.width;
    let height = options.height;
    if (options.geometry) {
        let hasSize = -1, hasPos = -1;
        let m = options.geometry.match(/^([0-9]+)x([0-9]+)$/);
        if (m) {
            hasSize = 0;
        } else if ((m = options.geometry.match(/^([-+][0-9]+[-+][0-9]+)$/))) {
            hasPos = 0;
        } else if ((m = options.geometry.match(/^([0-9]+)x([0-9]+)([-+][0-9]+[-+][0-9]+)$/))) {
            hasSize = 0;
            hasPos = 2;
        }
        if (hasSize >= 0) {
            width = Number(m[1]);
            height = Number(m[2]);
        }
        if (hasPos >= 0 && options.position === undefined
            && options.x === undefined && options.y === undefined) {
            options = Object.assign({ position: m[hasPos+1] }, options);
        }
    }
    if (! width || ! height) {
        if (DomTerm.isElectron() && ! DomTerm.isInIFrame()) {
            let sz = electronAccess.getCurrentWindow().getContentSize();
            width = sz[0];
            height = sz[1];
        } else if (! DomTerm.isInIFrame()) {
            width = window.outerWidth;
            height = window.outerHeight;
        } else {
            width = DomTerm.defaultWidth;
            height = DomTerm.defaultHeight;
        }
    }
    return Object.assign({ width: width, height: height }, options);
}

DomTerm.openNewWindow = function(dt, options={}) {
    options = DomTerm._extractGeometryOptions(options);
    let url = options.url;
    if (! url)
        options.url = DomTerm.topLocation;
    if (DomTerm.isElectron()) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("domterm-new-window", options);
        } else {
            electronAccess.ipcRenderer.send('window-ops', 'new-window', options);
        }
    } else {
        let width = options.width;
        let height = options.height;
        if (dt) {
            dt.reportEvent("OPEN-WINDOW",
                           url + (url.indexOf('#') < 0 ? '#' : '&') +
                           ((width && height) ? ("geometry="+width+"x"+height) : "")
                          );
        } else {
            window.open(url, "_blank", "width="+width+",height="+height);
        }
    }
}

window.DomTerm = DomTerm;
window.DomTermLayout = DomTermLayout;

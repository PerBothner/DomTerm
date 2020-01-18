/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019 Per Bothner.
 */

const DomTerm = new Object(); //maybe use Terminal - FIXME

class DomTermLayout {
};

DomTermLayout.manager = null;

DomTerm._instanceCounter = 0;

/** The <body>, or a node below the menubar if using jsMenus. */
DomTerm.layoutTop = null; // document.body is null until loaded

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
    document.title = title;
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

DomTerm.windowClose = function() {
    window.close();
}

DomTerm._extractGeometryOptions = function(options={}) {
    if (options.width && options.height)
        return options;
    let width = options.width || DomTerm.defaultWidth;
    let height = options.height || DomTerm.defaultHeight;
    if (options.geometry) {
        let m = options.geometry.match(/^([0-9][0-9]*)x([0-9][0-9]*)$/);
        if (m) {
            width = Number(m[1]);
            height = Number(m[2]);
        }
    }
    return Object.assign({ width: width, height: height }, options);
}

DomTerm.openNewWindow = function(dt, options={}) {
    options = DomTerm._extractGeometryOptions(options);
    let url = options.url;
    if (! url)
        url = DomTerm.topLocation;
    if (DomTerm.isElectron()) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("domterm-new-window", options);
        } else {
            electronAccess.ipcRenderer.send('request-mainprocess-action',
                                            Object.assign({ action: 'new-window', url: url },
                                                          options));
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

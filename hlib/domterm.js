/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019, 2021 Per Bothner.
 */

class DomTermLayout {
};

DomTermLayout.manager = null;

DomTerm.verbosity = 0;
DomTerm.logToServer = false;
DomTerm.logStringMax = 200;
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
        if (! report || report == "both") {
            console.log(str);
        }
    }
}

// For DEBUGGING
DomTerm.toDisplayString = function(datum, offset = -1) {
    if (datum instanceof Text && offset < 0)
        return "Text:" + DomTerm.JsonLimited(datum.data);
    if (datum instanceof Text && offset <= datum.length)
        return "Text:" + DomTerm.JsonLimited(datum.data.substring(0, offset)) + '^' + DomTerm.JsonLimited(datum.data.substring(offset));
    if (offset >= 0 && datum !== null) {
        return DomTerm.toDisplayString(datum, -1) + '^' + offset;
    }
    if (datum instanceof Element) {
        let r = '<' + datum.tagName.toLowerCase();
        let attrs = datum.attributes;
        for(var i = attrs.length - 1; i >= 0; i--) {
            r += ' ' + attrs[i].name + '=' + DomTerm.JsonLimited(attrs[i].value);
        }
        return r + '>';
    }
    if (datum instanceof String || typeof datum === "string")
        return DomTerm.JsonLimited(datum);
    return datum;
}
// For DEBUGGING
DomTerm.displaySelection = function(sel = document.getSelection()) {
    let r = sel.isCollapsed ? '' : 'anc:';
    r += DomTerm.toDisplayString(sel.anchorNode, sel.anchorOffset);
    if (sel.isCollapsed)
        r += ',collapsed';
    else if (sel.anchorNode === sel.focusNode)
        r += ',foc:^' + sel.focusOffset;
    else
        r += ',foc:' + DomTerm.toDisplayString(sel.focusNode, sel.focusOffset);
    return r;
}

DomTerm.JsonLimited = function(val) {
    let maxLog = DomTerm.logStringMax;
    if (maxLog > 0) {
        if (typeof val === "string" && val.length > maxLog)
            return JSON.stringify(val.substring(0,maxLog))+"...";
        let jstr = JSON.stringify(val);
        if (jstr.length > maxLog)
             return jstr.substring(0,maxLog)+"...";
    }
    return JSON.stringify(val);
};

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

// Like toFixed, but strip off trailing zeros and decimal point
DomTerm.toFixed = function(n, d) {
    let s = Number(n).toFixed(d);
    let nzeros = 0;
    let len = s.length;
    for (;;) {
        let last = s.charAt(len-nzeros-1);
        if (last !== '0' && last !== '.')
            break;
        nzeros++;
        if (last == '.')
            break;
    }
    return nzeros ? s.substring(0, len-nzeros) : s;
}

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

/* Can be called in either DomTerm sub-window or layout-manager context. */
DomTerm.newPane = function(paneOp, options = null, dt = DomTerm.focusedTerm) {
    if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("domterm-add-pane", paneOp, options);
    else if (DomTermLayout.addPane)
        DomTermLayout.addPane(paneOp, options);
    //DomTerm.newSessionPid = 0;
}

DomTerm.closeAll = function(event) {
    DomTerm.forEachTerminal(dt => {
        dt.historySave();
        if (dt.processInputBytes)
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

// 'hide', 'show', 'minimize'
DomTerm.windowOp = function(opname) {
    if (DomTerm.isElectron()) {
        electronAccess.ipcRenderer.send('window-ops', opname, null);
    }
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
            return options;
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
    if (DomTerm.isElectron() && (url || ! dt)) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("domterm-new-window", options);
        } else {
            if (! url)
                options.url = DomTerm.mainLocation + "#" + DomTerm.mainLocationParams;
            electronAccess.ipcRenderer.send('window-ops', 'new-window', options);
        }
    } else {
        let width = options.width;
        let height = options.height;
        if (dt) {
            if (! url)
                url = "";
            if (width && height)
                url += (url.indexOf('#') < 0 ? '#' : '&')
                    + "geometry="+width+"x"+height;
            dt.reportEvent("OPEN-WINDOW", url);
        } else {
            if (! url)
                url = DomTerm.mainLocation + "#" + DomTerm.mainLocationParams;
            window.open(url, "_blank", "width="+width+",height="+height);
        }
    }
}

DomTerm.addLocationParams = function(url) {
    if (DomTerm.mainLocationParams)
        url += (url.indexOf('#') >= 0 ? '&' : '#')
        + DomTerm.mainLocationParams;
    if (DomTerm.server_key && ! url.match(/[#&]server-key=/)) {
        url = url
            + (url.indexOf('#') >= 0 ? '&' : '#')
            + "server-key=" + DomTerm.server_key;
    }
    return url;
}

if (DomTerm.isElectron()) {
    window._dt_toggleDeveloperTools = function() {
        electronAccess.ipcRenderer.send('window-ops', 'toggle-devtools', null);
    }
};

window.DomTerm = DomTerm;
window.DomTermLayout = DomTermLayout;

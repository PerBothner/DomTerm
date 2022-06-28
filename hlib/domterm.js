/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019, 2021 Per Bothner.
 */

DomTerm.verbosity = 0;
DomTerm.logToServer = false;
DomTerm.logStringMax = 200;
DomTerm._savedLogEntries = null;
DomTerm._mainWindowNumber = -1;

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
             return jstr.substring(0,maxLog)+"\"...";
    }
    return JSON.stringify(val);
};

DomTerm._instanceCounter = 0;

// The current domterm Terminal *or* domterm-wrapper iframe Element.
DomTerm._oldFocusedContent = null;
DomTerm.focusedWindowNum = -1;

DomTerm.mainTerm = null;

/** The <body>, or a node below the menubar if using jsMenus. */
DomTerm.layoutTop = null; // document.body is null until loaded

DomTerm.withLayout = function(callback, err = undefined) {
    const path = './domterm-layout.js';
    if (DomTerm._layout)
        callback(DomTerm._layout);
    else import(path)
        .then(mod => {
            const dl = mod.DomTermLayout;
            DomTerm._layout = dl;
            callback(dl);
        }, err || ((e)=> {
            console.log(`import '${path}'${e.lineNumber ? ` (line:${e.lineNumber})` : ""} failed: ${e}`);
        }));
};

DomTerm.supportsAutoInputMode = true;

DomTerm.freshName = function() {
    return "domterm-"+(++DomTerm._instanceCounter);
}

//DomTerm.isInIFrame = function() { return window.parent != window; }
DomTerm.isInIFrame = function() { return DomTerm.isSubWindow(); }
DomTerm.isSubWindow = function() { return location.pathname == "/simple.html"; }

DomTerm.usingAjax = false;
DomTerm.usingQtWebEngine = !!navigator.userAgent.match(/QtWebEngine[/]([^ ]+)/);

DomTerm._escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

DomTerm.clickLink = function(e, dt = DomTerm.focuedTerm) {
    let target = e.target;
    for (let n = target; n instanceof Element; n = n.parentNode) {
        let ntag = n.nodeName;
        if (ntag == "A") {
            let href = (n.getAttribute("domterm-href")
                        || n.getAttribute("href"));
            if (href
                && (e.ctrlKey || !dt || ! dt._linkNeedsCtrlClick(n))) {
                DomTerm.handleLinkRef(href,
                                      n.textContent, dt);

            }
            e.preventDefault();
            return true;
        }
        if (ntag == "DIV")
            break;
    }
    return false;
}

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

DomTerm.displayWindowTitle = function(name, title) {
    let str = name || "";
    if (title) {
        if (str)
            str += " ";
        str += "(" + title +")";
    }

    if (window.setWindowTitle)
        window.setWindowTitle(str); // hook used by -Bwebview, -Bwry, -Bqt
    else
       document.title = str;
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

/* Can be called in either DomTerm sub-window or layout-manager context.
   * Note this is in the DomTerm global object, not DomTermLayout. FIXME?
 */
DomTerm.newPane = function(paneOp, options = null, dt = DomTerm.focusedTerm) {
    let oldWindowNum = dt ? dt.windowNumber : DomTerm.focusedWindowNum;
    if (! dt)
        dt = DomTerm.mainTerm;
    dt.reportEvent("OPEN-PANE",
                   `${paneOp},${oldWindowNum},${options ? JSON.stringify(options) : "{}"}`);
}

DomTerm.updateContentTitle = function(content, options) {
    if (options.windowName !== undefined) {
        if (options.windowName)
            content.setAttribute("window-name", options.windowName);
        else
            content.removeAttribute("window-name");
    }
    if (options.windowNameUnique !== undefined)
        content.windowNameUnique = options.windowNameUnique;
}

DomTerm.updateTitle = function(content, options) {
    if (DomTerm.useIFrame && DomTerm.isInIFrame())
        DomTerm.sendParentMessage("domterm-update-title", options);
    else {
        const dl = DomTerm._layout;
        let item;
        if (dl) {
            if (typeof options.windowNumber == "number") {
                item = dl._numberToLayoutItem(options.windowNumber);
                if (item && !DomTerm.useToolkitSubwindows)
                    content = item.component;
            } else if (content) {
                item = dl._elementToLayoutItem(content);
            }
        };
        const cstate = item?.toConfig().componentState;
        if (cstate) {
            if (options.windowName !== undefined) {
                if (options.windowName)
                    cstate.windowName = options.windowName;
                else
                    delete cstate.windowName;
            }
            if (options.windowNameUnique !== undefined)
                cstate.windowNameUnique = options.windowNameUnique;
            if (dl && item) {
                dl.updateLayoutTitle(item, null);
            };
        }
        if (content) {
            DomTerm.updateContentTitle(content, options); // FIXME
            if (dl && item) {
                dl.updateLayoutTitle(item, content);
            };
        }
    }
}

// detach is true, false, or "export"
DomTerm.closeSession = function(content = DomTerm._oldFocusedContent,
                                detach = false, fromLayoutEvent = false) {
    if (content && content.terminal && content.terminal.topNode)
        content.terminal.close(detach, fromLayoutEvent);
    else if (content) {
        DomTerm.sendChildMessage(content, "domterm-close", detach, fromLayoutEvent);
    }
}

DomTerm.closeAll = function(event) {
    DomTerm._layout.manager.root.destroy();
}

DomTerm.windowClose = function() {
    if (window.closeMainWindow) {
        window.closeMainWindow(); // hook used by --webview
    } else {
        window.close();
    }
}

// 'hide', 'show', 'minimize', 'fullscreen'
DomTerm.windowOp = function(opname, arg=null) {
    if (opname === 'fullscreen') {
        // arg must be 'on', 'off', 'toogle' (or null)
        let current = screenfull.isFullscreen;
        let goal = arg===null || arg === 'toggle' ? ! current
            : arg && arg !== 'off';
        if (goal !== current) {
            if (! DomTerm.isElectron()) {
                if (current)
                    screenfull.exit();
                else
                    screenfull.request();
            }
        }
    }
    if (DomTerm.isElectron()) {
        electronAccess.ipcRenderer.send('window-ops', opname, arg);
    }
    if (DomTerm.versions.wry) {
        if (opname === 'minimize' || opname === 'hide' || opname === 'show') {
            ipc.postMessage(opname);
        }
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
        if (! DomTerm.isInIFrame()) {
            width = window.outerWidth;
            height = window.outerHeight;
        } else {
            width = DomTerm.defaultWidth;
            height = DomTerm.defaultHeight;
        }
    }
    if (width > 0 && height > 0)
        return Object.assign({ width: width, height: height }, options);
    else
        return options;
}

DomTerm.openNewWindow = function(dt, options={}) {
    if (! dt)
        dt = DomTerm.mainTerm;
    options = DomTerm._extractGeometryOptions(options);
    let url = options.url;
    if ((DomTerm.isElectron() || DomTerm.versions.wry
         || DomTerm._qtBackend)
        && (url || ! dt)) {
        if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
            DomTerm.sendParentMessage("domterm-new-window", options);
        } else {
            if (! url)
                options.url = DomTerm.mainLocation + "#" + DomTerm.mainLocationParams;
            if (DomTerm.isElectron())
                electronAccess.ipcRenderer.send('window-ops', 'new-window', options);
            else if (DomTerm._qtBackend)
                DomTerm._qtBackend.openNewWindow(options.width, options.height,
                                                 options.position || "",
                                                 url, !!options['headless'],
                                                 options.titlebar || "");
            else // DomTerm.versions.wry
                ipc.postMessage("new-window "+JSON.stringify(options));
        }
    } else {
        if (dt) {
            dt.reportEvent("OPEN-WINDOW", JSON.stringify(options));
        } else {
            let width = options.width;
            let height = options.height;
            if (! url)
                url = DomTerm.mainLocation + "#" + DomTerm.mainLocationParams;
            let wopt = "";
            if (width > 0 && height > 0)
                wopt = "width="+width+",height="+height;
            window.open(url, "_blank", wopt);
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

DomTerm.showFocusedPane = function(lcontent) {
    //if (DomTerm.handlingJsMenu())
    //    return;
    if (DomTerm._oldFocusedContent != lcontent) {
        if (DomTerm._oldFocusedContent != null)
            DomTerm._oldFocusedContent.classList.remove("domterm-active");
        if (lcontent)
            lcontent.classList.add("domterm-active");

        DomTerm._oldFocusedContent = lcontent;
    }
};
DomTerm.focusChild = function(iframe, originMode) { // OBSOLETE?
    let oldContent = DomTerm._oldFocusedContent;
    if (iframe !== oldContent || originMode=="C") {
        if (oldContent != null) {
            let terminal = oldContent.terminal;
            if (oldContent.tagName == "IFRAME") {
                if (oldContent.contentWindow)
                    DomTerm.sendChildMessage(oldContent, "set-focused", 0);
            } else if (terminal) {
                if (terminal.topNode)
                    terminal.setFocused(0);
            }
        }
        if (originMode != "F") {
            if (! iframe) {
                return;
            }
            let terminal = iframe.terminal;
            if (iframe.tagName == "IFRAME")
                DomTerm.sendChildMessage(iframe, "set-focused", 2);
            else if (terminal)
                terminal.setFocused(2);
        }
    }
    DomTerm.showFocusedPane(iframe);
}

DomTerm.createSpanNode = function(cls=null, txt=null) {
    let el = document.createElement("span");
    if (cls)
        el.setAttribute("class", cls);
    if (txt)
        el.appendChild(document.createTextNode(txt));
    return el;
};


DomTerm.addSubWindowParams = function(location, mode) {
    if (mode == 'T') {
        location = DomTerm.addLocationParams(location);
    } else if (location.startsWith('file:')) {
        location = "http://localhost:"+DomTerm.server_port + '/get-file/'
            + DomTerm.server_key + '/' + location.substring(5);
    }
    if (DomTerm._mainWindowNumber >= 0 && (mode == 'T' || mode == 'V')) {
        location = location
            + (location.indexOf('#') >= 0 ? '&' : '#')
            + "main-window=" + DomTerm._mainWindowNumber;
    }
    return location;
};

// mode is 'T' (terminal), 'V' (view-saved), or 'B' (browse)
DomTerm.makeIFrameWrapper = function(location, mode='T',
                                     parent=DomTerm.layoutTop) {
    let ifr = document.createElement("iframe");
    let name = DomTerm.freshName();
    ifr.setAttribute("name", name);
    if (location) {
        location = DomTerm.addSubWindowParams(location, mode);
    }
    //if (mode == 'B')
    //ifr.layoutWindowTitle = location;
    ifr.setAttribute("src", location);
    ifr.setAttribute("class", "domterm-wrapper");
    if (DomTerm._oldFocusedContent == null)
        DomTerm._oldFocusedContent = ifr;
    for (let ch = parent.firstChild; ; ch = ch.nextSibling) {
        if (ch == null || ch.tagName != "IFRAME") {
            parent.insertBefore(ifr, ch);
            break;
        }
    }
    return ifr;
}
DomTerm.handlingJsMenu = function() {
    return typeof Menu !== "undefined" && Menu._topmostMenu;
};

if (DomTerm.isElectron()) {
    window._dt_toggleDeveloperTools = function() {
        electronAccess.ipcRenderer.send('window-ops', 'toggle-devtools', null);
    }
};

window.DomTerm = DomTerm;

/** @license Copyright (c) 2015, 2016, 2017, 2018, 2019, 2021 Per Bothner.
 */

DomTerm.verbosity = 0;
DomTerm.logToServer = false;
DomTerm.logStringMax = 200;
DomTerm._savedLogEntries = null;
DomTerm._mainWindowNumber = -1;
DomTerm.useDragAndDrop = true;
DomTerm.copyForDragImage = DomTerm.useDragAndDrop;
DomTerm.useSeparateContentChild = function() {
    return DomTerm.copyForDragImage && ! DomTerm.useToolkitSubwindow
        && DomTerm.subwindows;
}

// Whole-window zoom set by settings
DomTerm.zoomMainBase = 1.0;
// Adjustment to whole-window zoom by zoom-in/-out commands
DomTerm.zoomMainAdjust = 1.0;

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
    else if (sel.anchorNode === sel.focusNode) {
        if (sel.anchorNode instanceof Text) {
            const data = sel.focusNode.data;
            if (sel.anchorOffset < sel.focusOffset)
                r = "Text:" + DomTerm.JsonLimited(data.substring(0, sel.anchorOffset)) + '_' + DomTerm.JsonLimited(data.substring(sel.anchorOffset, sel.focusOffset))+ '^' + DomTerm.JsonLimited(data.substring(sel.focusOffset));
            else
                r = "Text:" + DomTerm.JsonLimited(data.substring(0, sel.focusOffset)) + '^' + DomTerm.JsonLimited(data.substring(sel.focusOffset, sel.anchorOffset))+ '_' + DomTerm.JsonLimited(data.substring(sel.anchorOffset));
        } else
            r += ',foc:^' + sel.focusOffset;
    } else
        r += ',foc:' + DomTerm.toDisplayString(sel.focusNode, sel.focusOffset);
    return r;
}

DomTerm.JsonLimited = function(val) {
    let maxLog = DomTerm.logStringMax;
    if (maxLog > 0) {
        if (typeof val === "string" && val.length > maxLog)
            return JSON.stringify(val.substring(0,maxLog-50))+"..."+JSON.stringify(val.substring(val.length-50));
        let jstr = JSON.stringify(val);
        if (jstr.length > maxLog)
             return jstr.substring(0,maxLog)+"\"...";
    }
    return JSON.stringify(val);
};

DomTerm._instanceCounter = 0;

// The current domterm Terminal *or* domterm-wrapper iframe Element.
DomTerm._oldFocusedContent = null;
/** Current PaneInfo or null. */
DomTerm.focusedPane = null;
DomTerm.focusedWindowNumber = 0;

DomTerm.mainTerm = null;

/** The <body>, or a node below the menubar if using jsMenus. */
DomTerm.layoutTop = null; // document.body is null until loaded

DomTerm.withLayout = function(callback, initIfNeeded = false, err = undefined) {
    const path = './domterm-layout.js';
    if (DomTerm._layout)
        callback(DomTerm._layout);
    else import(path)
        .then(mod => {
            const dl = mod.DomTermLayout;
            DomTerm._layout = dl;
            if (initIfNeeded && ! dl.manager)
                dl.initialize();
            callback(dl);
        }, err || ((e)=> {
            console.log(`import '${path}'${e.lineNumber ? ` (line:${e.lineNumber})` : ""} failed: ${e}`);
        }));
};

DomTerm.supportsAutoInputMode = true;

DomTerm.freshName = function() {
    return "domterm-"+(++DomTerm._instanceCounter);
}

// Table of named options global to domterm server.
// Normally read from settings.ini
DomTerm.globalSettings = {};
DomTerm._settingsCounter = -1;

//DomTerm.isInIFrame = function() { return window.parent != window; }
DomTerm.isInIFrame = function() { return DomTerm.isSubWindow(); }
DomTerm.isSubWindow = function() { const p = location.pathname; return p === "/simple.html" || p === "/xtermjs.html"; }

DomTerm.usingQtWebEngine = !!navigator.userAgent.match(/QtWebEngine[/]([^ ]+)/);

/** Hooks for up-calling to the browser application.
 * Depends on the front-end used. */
DomTerm.apphooks = {};

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

DomTerm.isLineBlock = function(node) {
    let tag = node.tagName;
    return tag == "PRE" || tag == "P"
        || (tag == "DIV" && node.classList.contains("domterm-pre"));
}

DomTerm.formatWindowLabel = function(info) {
    let label;
    if (info.windowName) {
        label = info.windowName
        if (! info.windowNameUnique
            && info.windowNumber !== undefined)
            label += ":" + info.windowNumber;
    } else {
        label = info.url ? "Browser" : "DomTerm";
        const wnum = info.windowNumber;
        let rhost = info.remoteHostUser;
        const snum = info.sessionNumber;
        if (wnum !== undefined) {
            if (! rhost && snum !== undefined && snum !== wnum)
                label += "#" + snum;
            label += ":" + wnum;
        }
        if (rhost) {
            let at = rhost.indexOf('@');
            if (at >= 0)
                rhost = rhost.substring(at+1);
            label += "@" + rhost;
            if (snum)
                label += "#" + snum;
        }
    }
    return label;
};

DomTerm.displayTitleString = function(str) {
    if (window.setWindowTitle)
        window.setWindowTitle(str); // hook used by -Bwebview, -Bwry, -Bqt
    else
       document.title = str;
}

DomTerm.displayWindowTitle = function(info) {
    let str = DomTerm.formatWindowLabel(info) || "";
    const title = info.windowTitle;
    if (title) {
        if (str)
            str += " ";
        str += "(" + title +")";
    }
    DomTerm.displayTitleString(str);
}

DomTerm.maybeWindowName = function(el, params = DomTerm.mainSearchParams) {
    if (params && el) {
        const wparam = params.get("window");
        const wnum = wparam ? Number(wparam) : -1;
        if (wnum >= 0)
            el.windowNumber = wnum;
        let wname_unique = params.get("wname-unique");
        let name = wname_unique || params.get("wname");
        if (name) {
            el.setAttribute("window-name", name);
            el.windowNameUnique = !!wname_unique;
        }
    }
    return el;
};

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
   * Note this is in the DomTerm global object, not DomTermLayout.
 */
DomTerm.newPane = function(paneOp, options = null, oldPane) {
    if (! oldPane)
        oldPane = DomTerm.focusedPane || DomTerm.mainTerm;
    let oldWindowNum = oldPane.number;
    if (typeof oldWindowNum !== "number")
        return; // ERROR
    DomTerm.mainTerm
        .reportEvent("OPEN-PANE",
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
    if (DomTerm.useIFrame && DomTerm.isSubWindow())
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
                dl.updateLayoutTitle(item, cstate);
            };
        }
        if (content) {
            DomTerm.updateContentTitle(content, options); // FIXME
            if (dl && item) {
                dl.updateLayoutTitle(item);
            };
        }
    }
}

// detach is true, false, or "export"
DomTerm.closeSession = function(pane = DomTerm.focusedPane,
                                detach = false, fromLayoutEvent = false) {
    if (pane) {
        if (pane.terminal) {
            pane.close(detach, fromLayoutEvent);
        } else {
            DomTerm.sendChildMessage(pane, "domterm-close", detach, fromLayoutEvent);
        }
    }
}

DomTerm.closeAll = function(event) {
    if (DomTerm._layout && DomTerm._layout.manager)
        DomTerm._layout.manager.root.destroy();
}

DomTerm.windowClose = function() {
    const mainTerm = DomTerm.mainTerm;
    if (mainTerm && mainTerm._socketOpen && ! mainTerm._closeSent)
        mainTerm.reportEvent("CLOSE-WINDOW");
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

// Handle '{SETTINGS}' or 'WNUM,{OPTIONS}'/
DomTerm.setOptions = function(jtext) {
    try {
        var obj2 = JSON.parse("["+jtext+"]");
        let obj = obj2[obj2.length-1];
        let pane = obj2.length >= 2 ? DomTerm.paneMap[obj2[0]]
            : DomTerm.mainTerm.paneInfo;
        pane.setOptions(obj);
    } catch(e) {
        console.log("error handling local settings "+e);
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
    if (! (dt instanceof window.DTerminal))
        dt = DomTerm.mainTerm;
    options = DomTerm._extractGeometryOptions(options);
    let url = options.url;
    console.log("openNewWindow dt:"+(typeof dt==="object" ? dt.constructor?.name : dt)+" url:"+url);
    if ((DomTerm.isElectron() || DomTerm.versions.wry
         || DomTerm._qtBackend)
        && url) {
        if (url.charAt(0) == '#')
            options.url = DomTerm.mainLocation + url + "&server-key=" + DomTerm.server_key;
        if (DomTerm.isElectron())
            electronAccess.ipcRenderer.send('window-ops', 'new-window', options);
        else if (DomTerm._qtBackend)
            DomTerm._qtBackend.openNewWindow(JSON.stringify(options));
        else // DomTerm.versions.wry
            ipc.postMessage("new-window "+JSON.stringify(options));
    } else {
        if (dt) {
            dt.reportEvent("OPEN-WINDOW", JSON.stringify(options));
        } else {
            // should never happen
            let width = options.width;
            let height = options.height;
            if (! url)
                url = DomTerm.mainLocation + "#" + DomTerm.mainLocationParams;
            else if (url.charAt(0) == '#')
                options.url = DomTerm.mainLocation + url + "&server-key=" + DomTerm.server_key;
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

DomTerm.focusedTop = undefined;
DomTerm.focusedChild = undefined;
DomTerm.focusedChanged = true;
DomTerm.setWindowFocused = function(focused, fromChild, windowNumber) {
    const oldFocused = DomTerm.focusedTop || DomTerm.focusedChild;
    if (fromChild)
        DomTerm.focusedChild = focused;
    else
        DomTerm.focusedTop = focused;
    const newFocused = DomTerm.focusedTop || DomTerm.focusedChild;
    if (newFocused !== oldFocused) {
        if (newFocused) {
            document.body.classList.add("focused");
        } else {
            document.body.classList.remove("focused");
        }
        if (DomTerm.focusedChild && DomTerm.apphooks.focusPane && windowNumber > 0) {
            DomTerm.apphooks.focusPane(windowNumber);
        }
    }
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

DomTerm.hackFileUrl = function(location) {
    // Work around CORS limitations.
    return "http://localhost:"+DomTerm.server_port + '/get-file/'
        + DomTerm.server_key + '/' + location.substring(5);
}

DomTerm.addSubWindowParams = function(location, mode) {
    if (mode == 'T' || mode == 'V') {
        location = DomTerm.addLocationParams(location);
    } else if (location.startsWith('file:')) {
        location = DomTerm.hackFileUrl(location);
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
    parent.appendChild(ifr);
    return ifr;
}

// Either element/iframe/wrapper (if no LayoutManager);
// or the root element of the LayoutManager;
DomTerm._contentElement = null;
DomTerm._contentSetSize = function(w, h) {
    const st = DomTerm._contentElement.style;
    st.width = `${w}px`;
    st.height = `${h}px`;
}
DomTerm.updateSizeFromBody = function() {
    const body = document.body;
    const element = DomTerm._contentElement;
    if (element) {
        const width = body.offsetWidth - element.offsetLeft;
        const height = body.offsetHeight - element.offsetTop;
        DomTerm._contentSetSize(width, height);
    }
};

DomTerm.updateBodySizeWithZoom = function() {
    if (DomTerm.useToolkitSubwindows || DomTerm.isElectron() || DomTerm._qtBackend)
        return;
    const zoom = document.body.zoomFactor;
    const bodyStyle = document.body.style;
    if (zoom && (zoom < 0.99 || zoom > 1.01)) {
        const topElement = document.documentElement;
        bodyStyle.width = `${topElement.offsetWidth / zoom}px`;
        bodyStyle.height = `${topElement.offsetHeight / zoom}px`;
    } else {
        bodyStyle.width = "";
        bodyStyle.height = "";
    }
}

DomTerm.updatePaneZoom = function(pane) {
    const element = pane.contentElement;
    const scale = pane.paneZoom();
    if (element) {
        if (scale > 0.99 && scale < 1.01) {
            element.style.removeProperty("transform");
            element.style.removeProperty("transform-orgin");
        } else {
            element.style.setProperty("transform", `scale(${scale})`);
            element.style.setProperty("transform-origin", "top left");
        }
        DomTerm._layout.updateContentSize(pane);
    } else if (DomTerm.apphooks.setPaneZoom) {
        DomTerm.apphooks.setPaneZoom(pane.number, scale);
    }
}
DomTerm.updateZoom = function() {
    let node = document.body;
    const zoom = DomTerm.zoomMainBase * DomTerm.zoomMainAdjust;
    const oldZoom = node.zoomFactor || 1.0;
    if (zoom === oldZoom)
        return;
    node.zoomFactor = zoom;

    if (DomTerm.isElectron()) {
        const webFrame = electronAccess.webFrame;
        webFrame.setZoomFactor(webFrame.getZoomFactor() * zoom / oldZoom);
    } else if (DomTerm._qtBackend) {
        DomTerm._qtBackend.setMainZoom(zoom);
    } else if (false && DomTerm.versions.wry) { // FUTURE - TODO
    } else {
        if (zoom >= 0.99 && zoom <= 1.01) {
            node.zoomFactor = undefined;
            node.style.removeProperty("transform");
            node.style.removeProperty("transform-orgin");
        } else {
            node.zoomFactor = zoom;
            node.style.setProperty("transform",
                                   `scale(${node.zoomFactor})`);
            node.style.setProperty("transform-origin", "top left");
        }
        DomTerm.updateBodySizeWithZoom();
        DomTerm.updateSizeFromBody();
    }
}

DomTerm.updateSettings = function(pane, context) {
    if (pane.terminal)
        pane.updateSettings(context);
    else if (pane.layoutItem) {
        const componentType = pane.layoutItem.toConfig().componentType;
        if (componentType === "domterm" || componentType === "view-saved")
            DomTerm.sendChildMessage(pane, "term-settings", pane.termOptions);
    }

    if (! DomTerm.isSubWindow()) {
        const mainZoom = DomTerm.mainTerm.getOption("window-scale", 1.0);
        if (mainZoom != DomTerm.zoomMainBase) {
            DomTerm.zoomMainBase = mainZoom;
            DomTerm.updateZoom();
        }
        const paneZoom = pane.getOption("pane-scale", 1.0);
        if (pane && paneZoom != pane.zoomSetting) {
            pane.zoomSetting = paneZoom;
            DomTerm.updatePaneZoom(pane);
        }
    }
}

DomTerm.makeElement = function(name, parent = DomTerm.layoutTop, useXtermJs = false) {
    let topNode;
    if (! useXtermJs || ! DomTerm.isSubWindow()) {
        topNode = document.createElement("div");
        if (DomTerm.subwindows)
            topNode.classList.add("lm_content");
        parent.appendChild(topNode);
        parent = topNode;
    }
    if (useXtermJs) {
        let xterm = new window.Terminal();
        xterm.open(parent);
        if (DomTerm.isSubWindow())
            topNode = xterm.element;
        topNode.xterm = xterm;
    }
    topNode.classList.add("domterm");
    topNode.setAttribute("name", name);
    if (DomTerm._oldFocusedContent == null)
        DomTerm._oldFocusedContent = topNode;
    return topNode;
}

DomTerm._makeWsUrl = function(query=null) {
    var ws = ("#"+location.hash).match(/[#&;]ws=([^,&]*)/);
    var url;
    let protocol = location.protocol == "https:" ? "wss:" : "ws:";
    if (DomTerm.server_port==undefined || (ws && ws[1]=="same"))
        url = protocol
            + "//"+location.hostname+":" + location.port + "/replsrc";
    else if (ws)
        url = protocol+ws[1];
    else
        url = protocol+"//localhost:"+DomTerm.server_port+"/replsrc";
    if (DomTerm.server_key && ('&'+query).indexOf('&server-key=') < 0) {
        query = (query ? (query + '&') : '')
            + 'server-key=' + DomTerm.server_key;
    }
    if (query)
        url = url + '?' + query;
    return url;
}

DomTerm.newWS = function(wspath, wsprotocol, pane) {
    const wt = pane; //.terminal;
    let wsocket;
    try {
        wsocket = new WebSocket(wspath, wsprotocol);
        if (DomTerm.verbosity > 0)
            console.log("created WebSocket on  "+wspath);
    } catch (e) {
        DomTerm.log("caught "+e.toString());
    }
    wsocket.binaryType = "arraybuffer";
    pane.closeConnection = function() { wsocket.close(); };
    pane._remote_input_timer_id = 0; // -1 means inside remote_input_timer
    let remote_input_timer = () => {
        if (! pane._remote_input_interval)
            return;
        pane._remote_input_timer_id = -1;
        wt._confirmReceived();
    };
    pane.processInputBytes = function(bytes) {
        let delay = pane.getOption("debug.input.extra-delay", 0);
        let sendBytes = () => {
            if (pane._remote_input_timer_id > 0) {
                clearTimeout(pane._remote_input_timer_id);
                pane._remote_input_timer_id = 0;
            }
            if (pane._remote_input_interval > 0 && ! wt.sstate.disconnected/*FIXME*/)
                pane._remote_input_timer_id = setTimeout(remote_input_timer, pane._remote_input_interval);
            wsocket.send(bytes);
        };
        if (delay && pane._remote_input_timer_id >= 0)
            setTimeout(sendBytes, delay*1000);
        else
            sendBytes();
    };
    let remote_output_timer = () => {
        pane.log("TIMEOUT - no output");
        pane.showConnectFailure(-1);
    }
    pane._remote_output_timer_id = 0; // -1 means inside remote_output_timer
    wsocket.onmessage = function(evt) {
        DomTerm._handleOutputData(pane, evt.data);
        if (pane._remote_output_timer_id > 0) {
            clearTimeout(pane._remote_output_timer_id);
            pane._remote_output_timer_id = 0;
        }
        if (pane._remote_output_timeout > 0)
            pane._remote_output_timer_id = setTimeout(remote_output_timer, pane._remote_output_timeout);
    }
    wsocket.onerror = function(e) {
        if (DomTerm.verbosity > 0)
            DomTerm.log("unexpected WebSocket error code:"+e.code+" e:"+e);
    }
    wsocket.onclose = function(e) {
        if (DomTerm.verbosity > 0)
            DomTerm.log("unexpected WebSocket (connection:"+wt.topNode?.windowNumber+") close code:"+e.code+" e:"+e);
        pane._socketOpen = false;
        let reconnect = () => {
            let reconnect = "&reconnect=" + wt._receivedCount;
            wt._reconnectCount++;
            let m = wspath.match(/^(.*)&reconnect=([0-9]+)(.*)$/);
            if (m)
                wspath = m[1] + reconnect + m[3];
            else
                wspath = wspath + reconnect;
            let remote = wt.getRemoteHostUser();
            if (remote)
                wspath += ("&remote=" + encodeURIComponent(remote)
                           + "&rsession=" + wt.sstate.sessionNumber);
            let wsocket = DomTerm.newWS(wspath, wsprotocol, pane);
            wsocket.onopen = function(e) {
                wt.reportEvent("VERSION", JSON.stringify(DomTerm.versions));
                wt._confirmedCount = wt._receivedCount;
                wt._socketOpen = true;
                wt._handleSavedLog();
            };
        };
        let reconnectDelay = [0, 200, 400, 400][wt._reconnectCount];
        if (reconnectDelay == 0)
            reconnect();
        else if (reconnectDelay)
            setTimeout(reconnect, reconnectDelay);
        else {
            console.log("TOO MANY CONNECT fAILURES");
            wt.showConnectFailure(e.code, reconnect, false);
        }
    }
    return wsocket;
}

/** Connect using WebSockets */
DomTerm.connectWS = function(query, pane, topNode=null) {
    const wsprotocol = "domterm";
    const no_session = pane.kind;
    const wspath = DomTerm._makeWsUrl(query);
    const useXtermJs = no_session === "xterminal";
    if (useXtermJs)
        pane.terminal = topNode.xterm;
    else
        pane.setupElements(topNode);
    let wt = pane;
    let wsocket = DomTerm.newWS(wspath, wsprotocol, pane);
    wsocket.onopen = function(e) {
        wt._reconnectCount = 0;
        wt._socketOpen = true;
        if (topNode !== null) {
            if (DomTerm.usingXtermJs() && window.Terminal != undefined) {
                //DomTerm.initXtermJs(wt, topNode);
                // DomTerm.setFocus(wt, "N");
            } else {
                wt._handleSavedLog();
                if (topNode.classList.contains("domterm-wrapper"))
                    topNode = DomTerm.makeElement(name, topNode, useXtermJs);
            }
            pane.initializeTerminal(topNode);
        } else if (! DomTerm.isInIFrame()) {
            wt.parser = new window.DTParser(wt);
            wt.inputFollowsOutput = false;
        }
        wt.reportEvent(topNode ? "CONNECT" : "VERSION",
                       JSON.stringify(DomTerm.versions));
    };
    return wt;
}

DomTerm.handlingJsMenu = function() {
    return typeof Menu !== "undefined" && Menu._topmostMenu;
};

if (DomTerm.isElectron()) {
    window._dt_toggleDeveloperTools = function() {
        electronAccess.ipcRenderer.send('window-ops', 'toggle-devtools', null);
    }
};

class PaneInfo {
    constructor(windowNumber, kind) {
        this.number = windowNumber;
        if (windowNumber > 0)
            DomTerm.paneMap[windowNumber] = this;

        /** One of "dterminal" (domterm terminal) or "domterm" (legacy name);
         * "xterminal" (xterm.js-based terminal); "top" (top container);
         * "browser" or "view-saved". */
        this.kind = kind;
        /** The ComponentItem for this pane if using GoldenLayout. */
        this.layoutItem = undefined;

        /** The ComponentContainer for this pane if using GoldenLayout. */
        this.layoutContainer = undefined;

        /** The HTMLElement for this pane, if any.
         * If DomTerm.useToolkitSubwindows: undefined.
         * Otherwise, either the topNode of a Terminal or an iframe. */
        this.contentElement = undefined;

        /** The 'pane-scale' setting for this pane.
         * This needs to multiplied by DomTerm.zoomMainBase
         * and DomTerm.zoomMainAdjust. */
        this.zoomSetting = 1.0;

        /** Zoom adjustment from pane-zoon-in/pane-zoom-out commands.
         * This needs to multiplied by zoomSetting as well
         * as DomTerm.zoomMainBase and DomTerm.zoomMainAdjust. */
        this.zoomAdjust = 1.0;

        DomTerm.initSettings(this);
    }

    paneZoom() { return this.zoomSetting * this.zoomAdjust; }

    effectiveZoom() {
        return DomTerm.zoomMainBase * DomTerm.zoomMainAdjust * this.paneZoom();
    }

    getOption(name, dflt = undefined) {
        let opt = this.termOptions[name];
        if (opt !== undefined)
            return opt;
        opt = DomTerm.globalSettings[name];
        return opt === undefined ? dflt : opt;
    }

    setOptions(options, context) {
        for (const prop in options) {
            if (options[prop] == null)
                delete this.termOptions[prop];
            else
                this.termOptions[prop] = options[prop];
        }
        DomTerm.updateSettings(this, context);
    }
}

PaneInfo.create = function(windowNumber, kind) {
    if (kind == "xterminal" && window.XTermPane != undefined)
        return new window.XTermPane(windowNumber);
    else if (kind === "dterminal" || kind === "xterminal" || kind == "top" || kind == "browse")
        return new DTerminal(windowNumber, kind);
    else
        return new PaneInfo(windowNumber, kind);
}

/** Map from windowNumber to Paneinfo. */
DomTerm.paneMap = new Array();

window.DomTerm = DomTerm;

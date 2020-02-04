/* A glue layer for a layout mangager, initially GoldenLayout.
 */

DomTermLayout._pendingTerminals = null;

// The current lm_stack
DomTermLayout._oldFocusedPane = null;

// The current (or previous) lm.items.Component
DomTermLayout._oldFocusedItem = null;

// The current domterm *or* domterm-wrapper iframe Element.
// Same as DomTermLayout._oldFocusedItem.container._contentElement1
DomTermLayout._oldFocusedContent = null;

DomTermLayout.selectNextPane = function(forwards, wrapper=DomTermLayout._oldFocusedContent) {
    let item = DomTermLayout._elementToLayoutItem(wrapper);
    var r = item;
    for (;;) {
        var p = r.parent;
        var i = DomTermLayout._indexInParent(r);
        var nexti = forwards ? i + 1 : i - 1;
        var next;
        if (nexti >= 0 && nexti < p.contentItems.length)
            next = p.contentItems[nexti];
        else if (p.type == 'root')
            next = p;
        else
            next = null;
        if (next != null) {
            while (next.contentItems.length > 0) {
                next = forwards ? next.contentItems[0]
                    : next.contentItems[next.contentItems.length-1];
            }
            if (next != item)
                DomTermLayout._selectLayoutPane(next, "X");
            return;
        } else {
            r = p;
        }
    }
}

DomTermLayout._indexInParent = function (component) {
    var i = 0;
    var parent = component.parent;
    var ppChildren = parent.contentItems;
    while (i < ppChildren.length && ppChildren[i] != component) i++;
    return i;
}

DomTermLayout.addSibling = function(newItemConfig,
                                    isColumn, addAfter=true)
{
    if (newItemConfig == null)
        newItemConfig = DomTermLayout.newItemConfig;
    else if (typeof newItemConfig == "number")
        newItemConfig = Object.assign({sessionNumber: newItemConfig },
                                      DomTermLayout.newItemConfig);
    if (! DomTermLayout.manager)
        DomTermLayout.initialize();
    var r = DomTermLayout._oldFocusedItem;
    var type = isColumn ? 'column' : 'row';
    if (r) {
        var p = r.parent;
        if (p && p.type == "stack") {
            var pp = p.parent;
            if (pp.type != type) {
                var rowOrColumn = pp.layoutManager.createContentItem( { type: type }, p );
                pp.replaceChild(p, rowOrColumn);
                rowOrColumn.addChild(p, 0, true);
                pp = rowOrColumn;
            }
            var i = DomTermLayout._indexInParent(p);
            pp.addChild(newItemConfig, addAfter ? i+1: i);
            return;
        }
        r.parent.addChild(newItemConfig); // FIXME index after r
    }
};

DomTermLayout.addTab = function(newItemConfig = null) {
    if (newItemConfig == null)
        newItemConfig = DomTermLayout.newItemConfig;
    else if (typeof newItemConfig == "number")
        newItemConfig = Object.assign({sessionNumber: newItemConfig },
                                      DomTermLayout.newItemConfig);
    if (! DomTermLayout.manager)
        DomTermLayout.initialize();
    var r = DomTermLayout._oldFocusedItem;
    if (r)
        r.parent.addChild(newItemConfig); // FIXME index after r
};

DomTermLayout.showFocusedPane = function(item, lcontent = item.container._contentElement1) {
    DomTermLayout.showFocusedPaneL(item, lcontent);
    DomTermLayout.showFocusedPaneF(lcontent);
};
DomTermLayout.showFocusedPaneL = function(item, lcontent = item.container._contentElement1) {
    if (DomTermLayout._oldFocusedItem != item) {
        var stackPane = item && item.parent.element ? item.parent.element[0] : null;
        if (DomTermLayout._oldFocusedPane != null)
            DomTermLayout._oldFocusedPane.classList.remove("domterm-active");
        if (stackPane != null)
            stackPane.classList.add("domterm-active");
        DomTermLayout._oldFocusedPane = stackPane;
        DomTermLayout._oldFocusedItem = item;
    }
};
DomTermLayout.showFocusedPaneF = function(lcontent) {
    if (DomTermLayout._oldFocusedContent != lcontent) {
        if (DomTermLayout._oldFocusedContent != null)
            DomTermLayout._oldFocusedContent.classList.remove("domterm-active");
        if (lcontent != null)
            lcontent.classList.add("domterm-active");

        DomTermLayout._oldFocusedContent = lcontent;
    }
};
DomTermLayout._focusChild = function(iframe, originMode) {
    let oldContent = DomTermLayout._oldFocusedContent;
    if (iframe !== oldContent || originMode=="C") {
        if (oldContent != null) {
            let terminal = oldContent.terminal;
            if (oldContent.tagName == "IFRAME")
                DomTerm.sendChildMessage(oldContent, "set-focused", 0);
            else if (terminal)
                terminal.setFocused(0);
        }
        if (originMode != "F") {
            let terminal = iframe.terminal;
            if (iframe.tagName == "IFRAME")
                DomTerm.sendChildMessage(iframe, "set-focused", 2);
            else if (terminal)
                terminal.setFocused(2);
        }
    }
}

DomTermLayout._elementToLayoutItem = function(goal, item = DomTermLayout.manager.root) {
    if (item.element[0] == goal
        || (item.container && item.container.getElement()[0] == goal))
        return item;
    var citems = item.contentItems;
    for (var i = 0; i < citems.length; i++) {
        var r = DomTermLayout._elementToLayoutItem(goal, citems[i]);
        if (r)
            return r;
    }
    return null;
}

DomTermLayout._selectLayoutPane = function(component, originMode) {
    if (DomTerm.useIFrame) {
        DomTermLayout._focusChild(component.container._contentElement1, originMode);
    } else if (! DomTerm.useXtermJs) {
        let element = component.container.getElement()[0].firstChild;
        let dt = element && element.classList.contains("domterm")
            ? element.terminal
            : null;
        DomTerm.setFocus(dt);
        if (dt != null)
            dt.maybeFocus();
    }
    component.parent.setActiveContentItem(component);
    DomTermLayout._focusChild(component.container._contentElement1, originMode);
}

// item is a domterm element or an iframe domterm-wrapper (if useIFrame)
DomTerm.setLayoutTitle = function(item, title, wname) {
    title = DomTerm.escapeText(title);
    if (wname) {
        wname = DomTerm.escapeText(wname);
        title = title+'<span class="domterm-windowname"> '+wname+'</span>';
    }
    if (! DomTermLayout.manager) {
        item.layoutTitle = title;
        return;
    }
    const r = DomTermLayout._elementToLayoutItem(item);
    if (r) {
        r.setTitle(title);
    }
}

DomTermLayout.popoutWindow = function(item, dt = null) {
    var wholeStack = item.type == 'stack';
    var sizeElement = item.element[0];
    if (! wholeStack)
        sizeElement = item.container._contentElement1;
    var w = sizeElement.offsetWidth;
    var h = sizeElement.offsetHeight;
    // FIXME adjust for menu bar height
    function encode(item) {
        if (item.componentName == "domterm") {
            // FIXME item.container._contentElement is <iframe>
            let topNode = item.container._contentElement1;
            return '{"sessionNumber":'+topNode.getAttribute("session-number")+'}';
        } else if (item.componentName == "browser")
            return '{"url":'+JSON.stringify(item.config.url)+'}';
        else
            return "{}";
    }
    function remove(item) {
        if (item.componentName == "domterm") {
            DomTerm.doNamedCommand('detach-session');
            //DomTerm.detach(item.container._contentElement1.firstChild.terminal);
        } else {
            let lcontent = item.container._contentElement1;
            if (lcontent && lcontent.parentNode)
                lcontent.parentNode.removeChild(lcontent);
            item.remove(item);
        }
    }
    var e;
    var toRemove = new Array();
    if (wholeStack) {
        e = "[";
        var items = item.contentItems;
        for (var i = 0; i < items.length; i++) {
            e = e + (i > 0 ? "," : "") + encode(items[i]);
            toRemove[i] = items[i];
        }
        e = e + ']';
    } else {
        toRemove[0] = item;
        e = encode(item);
    }

    let newurl = DomTerm.topLocation+"#open="+encodeURIComponent(e);
    DomTerm.openNewWindow(dt, { width: w, height: h, url: newurl });
    let savedContent = DomTermLayout._oldFocusedContent;
    for (var i = 0; i < toRemove.length; i++) {
        let item = toRemove[i];
        DomTermLayout._oldFocusedContent = item.container._contentElement1;
        if (DomTermLayout._oldFocusedContent == savedContent)
            savedContent = null;
        remove(item);
    }
    DomTermLayout._oldFocusedContent = savedContent;
}

DomTermLayout.config = {
    settings:  { showMaximiseIcon: false,
                 popoutWholeStack: function(e) { return e.ctrlKey; },
                 onPopoutClick: function(item, event) {
                     var aitem = item.type != 'stack' ? item
                         : item._activeContentItem;
                     DomTermLayout.popoutWindow(aitem);
                 }},
    content: [{
        type: 'component',
        componentName: 'domterm',
        componentState: 'A'
    }],
    dimensions: {
	borderWidth: 1
    }
};

DomTermLayout.newItemConfig = {
    type: 'component',
    componentName: 'domterm',
    componentState: 'X'
};

/* bogus?
DomTerm.layoutResized = function(event) {
    var dt = this.terminal;
    if (dt && dt._rulerNode)
        dt.resizeHandler();
}
*/

DomTermLayout.layoutClose = function(lcontent, r, from_handler=false) {
    if (r) {
        var p = r.parent;
        if (p && p.type == 'stack'
            && p.contentItems.length == 1
            && p.parent.type == 'root'
            && p.parent.contentItems.length == 1) {
            DomTerm.windowClose();
        } else {
            DomTermLayout.selectNextPane(true, lcontent);
            if (lcontent && lcontent.parentNode)
                lcontent.parentNode.removeChild(lcontent);
            if (! from_handler)
                r.remove();
        }
    }
}

DomTermLayout.layoutClosed = function(event) {
    const el = this.getElement()[0];
    const dt = el.terminal;
    if (el.tagName !== "IFRAME" && dt) {
        // We don't call closeConnection() because we might need the WebSocket
        // connection for window-level operations, such as show/minimize.
        dt.reportEvent("CLOSE-SESSION");
        dt.clearVisibleState();
    }
    DomTermLayout.layoutClose(el, this.parent, true);
}

DomTerm._lastPaneNumber = 0;

DomTerm._newPaneNumber = function() {
    return ++DomTerm._lastPaneNumber;
}

DomTerm.newPaneHook = null;

DomTermLayout._initTerminal = function(sessionNumber, container) {
    let wrapped;
    let paneNumber = DomTerm._newPaneNumber();
    if (DomTerm.useIFrame) {
        let url = DomTerm.mainLocation;
        url += (url.indexOf('#') >= 0 ? '&' : '#')
            + "pane-number="+paneNumber;
        if (sessionNumber)
            url += "&session-number="+sessionNumber;
        wrapped = DomTermLayout.makeIFrameWrapper(url);
        if (container && DomTermLayout._oldFocusedItem == null)
            DomTermLayout._oldFocusedItem = container.parent;
    } else {
        let name = DomTerm.freshName();
        let el = DomTerm.makeElement(name);
        wrapped = el;
        wrapped.name = name;
        var query = sessionNumber ? "session-number="+sessionNumber : null;
        DTerminal.connectHttp(el, query);
    }
    wrapped.paneNumber = paneNumber;
    if (DomTerm.newPaneHook)
        DomTerm.newPaneHook(paneNumber, sessionNumber, wrapped);
    return wrapped;
}

DomTermLayout.initialize = function() {
    let top = DomTerm.layoutTop || document.body;
    let lcontent = DomTermLayout._oldFocusedContent;
    DomTermLayout.manager = new GoldenLayout(DomTermLayout.config, top);
    DomTermLayout.manager.registerComponent( 'domterm', function( container, componentConfig ){
        var el;
        var name;
        let wrapped;
        if (lcontent != null) {
            wrapped = lcontent;
            container._contentElement1 = wrapped;
            name = lcontent.layoutTitle
                || lcontent.getAttribute("name")
                || DomTerm.freshName();
            lcontent.layoutTitle = undefined;
            lcontent = null;
        } else {
            var config = container._config;
            wrapped = DomTermLayout._initTerminal(config.sessionNumber, container);
            name = wrapped.name;
            container._contentElement1 = wrapped;
        }
        DomTermLayout.showFocusedPaneL(container.parent, wrapped);
        wrapped.classList.add("lm_content");
        container.setTitle(name);
        //if (! DomTerm.useXtermJs)
        //container.on('resize', DomTerm.layoutResized, wrapped);
        container.on('destroy', DomTermLayout.layoutClosed, container);

        if (top !== document.body)
            new ResizeSensor(DomTermLayout.manager.container,
                             function() { DomTermLayout.manager.updateSize(); });
    });

    DomTermLayout.manager.registerComponent( 'view-saved', function( container, componentConfig ){
        container.on('destroy', DomTermLayout.layoutClosed, container);
        let el = viewSavedFile(container._config.url);
        container._contentElement1 = el;
        el.classList.add("lm_content");
        //container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTermLayout.layoutClosed, container);
    });

    DomTermLayout.manager.registerComponent( 'browser', function( container, componentConfig ){
        container.on('destroy', DomTermLayout.layoutClosed, container);
        let el = DomTermLayout.makeIFrameWrapper(container._config.url, false);
        container._contentElement1 = el;
        el.classList.add("lm_content");
        //container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTermLayout.layoutClosed, container);
    });

    function activeContentItemHandler(item) {
        if (item.config.componentName == "browser")
            DomTerm.setTitle(item.config.url);
        DomTermLayout._focusChild(item.container._contentElement1, "A");
        DomTermLayout.showFocusedPane(item);
    }

    function checkClick(event) {
        for (var t = event.target; t instanceof Element; t = t.parentNode) {
            if (t.classList.contains("lm_header")) {
                var item = DomTermLayout._elementToLayoutItem(t.parentNode);
                DomTermLayout._selectLayoutPane(item._activeContentItem, "C");
                return;
            }
        }
    }

    DomTermLayout.manager.init();
    DomTermLayout.manager.on('activeContentItemChanged',
                             activeContentItemHandler);
    DomTermLayout.manager.root.element[0]
        .addEventListener('click', checkClick, false);
    DomTermLayout.manager.on('stateChanged',
                             function() {
                                 let item = DomTermLayout._oldFocusedItem;
                                 if (item && item.parent
                                     && item.parent.type == "stack") {
                                     let st = item.parent;
                                     let act = st._activeContentItem;
                                     if (item !== act) {
                                         item.container._contentElement1
                                             .classList.remove("domterm-active");
                                         act.container._contentElement1
                                             .classList.add("domterm-active");
                                     }
                                 }
                             });
}

DomTermLayout.initSaved = function(data) {
    if (data.sessionNumber) {
        DomTermLayout._initTerminal(data.sessionNumber, null);
        } else if (data instanceof Array) {
            var n = data.length;
            DomTermLayout._pendingTerminals = new Array();
            for (var i = 0; i < n; i++) {
                var w = data[i];
                var newItemConfig = null;
                if (w.sessionNumber) {
                    newItemConfig = Object.assign({sessionNumber: w.sessionNumber }, // FIXME
                                                  DomTermLayout.newItemConfig);
                } else if (w.url) {
                    newItemConfig = {type: 'component',
                                     componentName: 'browser',
                                     url: w.url };
                }
                if (newItemConfig) {
                    if (i == 0) {
                        DomTermLayout.config.content = [newItemConfig];
                        DomTermLayout.initialize();
                    } else {
                        var stack = DomTermLayout.manager.root.contentItems[0];
                        stack.addChild(newItemConfig);
                    }
                }
            }
            n = DomTermLayout._pendingTerminals.length;
            for (var i = 0; i < n; i++) {
                let el = DomTermLayout._pendingTerminals[i];
                var sessionNumber = el.getAttribute("session-number");
                var query = pid ? "session-number="+sessionNumber : null;
                Terminal.connectHttp(el, query);
            }
            DomTermLayout._pendingTerminals = null;
        }
}

DomTermLayout.makeIFrameWrapper = function(location, terminal=true,
                                     parent=DomTerm.layoutTop) {
    let ifr = document.createElement("iframe");
    let name = DomTerm.freshName();
    ifr.setAttribute("name", name);
    if (terminal) {
        if (DomTerm.server_key && ! location.match(/[#&]server-key=/)) {
            location = location
                + (location.indexOf('#') >= 0 ? '&' : '#')
                + "server-key=" + DomTerm.server_key;
        }
    }
    ifr.setAttribute("src", location);
    ifr.setAttribute("class", "domterm-wrapper");
    if (DomTermLayout._oldFocusedContent == null)
        DomTermLayout._oldFocusedContent = ifr;
    for (let ch = parent.firstChild; ; ch = ch.nextSibling) {
        if (ch == null || ch.tagName != "IFRAME") {
            parent.insertBefore(ifr, ch);
            break;
        }
    }
    return ifr;
}

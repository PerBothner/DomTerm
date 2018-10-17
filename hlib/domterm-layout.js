/* A glue layer for a layout mangager, initially GoldenLayout.
 */

DomTerm._pendingTerminals = null;

function _muxModeInfo(dt) {
    return "(MUX mode)";
}

DomTerm.prototype.enterMuxMode = function() {
    this.modeLineGenerator = _muxModeInfo;
    this._muxMode = true;
    this._updatePagerInfo();
}

DomTerm.prototype.exitMuxMode = function() {
    this.modeLineGenerator = null;
    this._muxMode = false;
    this._updatePagerInfo();
}

/** Runs in DomTerm sub-window. */
DomTerm.prototype._muxKeyHandler = function(event, key, press) {
    if (this.verbosity >= 2)
        this.log("mux-key key:"+key+" event:"+event+" press:"+press);
    let paneOp = 0;
    switch (key) {
    case 13: // Enter
        DomTerm.layoutAddSibling(this);
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 16: /*Shift*/
    case 17: /*Control*/
    case 18: /*Alt*/
        return;
    case 37 /*Left*/:
        if (paneOp == 0) paneOp = 10;
        /* fall through */
    case 38 /*Up*/:
        if (paneOp == 0) paneOp = 12;
        /* fall through */
    case 39 /*Right*/:
        if (paneOp == 0) paneOp = 11;
        /* fall through */
    case 40 /*Down*/:
        if (paneOp == 0) paneOp = 13;
        if (event.ctrlKey) {
            DomTerm.newPane(paneOp);
            this.exitMuxMode();
            event.preventDefault();
        } else {
            DomTerm.selectNextPane(key==39||key==40);
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 68:
        if (event.ctrlKey && DomTerm.isElectron()) {
            nodeRequire('electron').remote.getCurrentWindow().toggleDevTools();
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 84: // T
        if (! event.ctrlKey) {
            DomTerm.newPane(2);
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    case 87: // W
        if (event.shiftKey) {
            var pane = DomTerm.domTermToLayoutItem(this);
            var wholeStack = event.ctrlKey;
            DomTerm.popoutWindow(wholeStack ? pane.parent : pane, this);
        } else {
            // FIXME make new window
        }
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 100: // 'd'
        if (! event.ctrlKey) {
            DomTerm.detach(this);
            this.exitMuxMode();
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        break;
    default:
    case 27: // Escape
        this.exitMuxMode();
        event.preventDefault();
        break;
    }
}

/** Map a layoutItem (GoldenLayout contentItem?) to a DomTerm instance.
*/
DomTerm.layoutItemToDomTerm = function(item) {
    var element = item.container.getElement()[0].firstChild;
    return element.classList.contains("domterm") ? element.terminal : null;
};

DomTerm._elementToLayoutItem = function(goal, item = DomTerm.layoutManager.root) {
    if (item.element[0] == goal
        || (item.container && item.container.getElement()[0] == goal))
        return item;
    var citems = item.contentItems;
    for (var i = 0; i < citems.length; i++) {
        var r = DomTerm._elementToLayoutItem(goal, citems[i]);
        if (r)
            return r;
    }
    return null;
}

DomTerm.domTermToLayoutItem = function(dt) {
    if (! DomTerm.layoutManager)
        return null;
    var node = dt.topNode;
    var goal = node.parentNode;
    if (goal instanceof Element && goal.classList.contains("lm_content"))
        return DomTerm._elementToLayoutItem(goal);
    else
        return null;
}

DomTerm.domTermLayoutClosed = function(event) {
    var el = this.getElement()[0];
    if (! DomTerm.useIFrame) {
        var dt = el.firstChild.terminal;
        if (dt && dt.closeConnection)
            dt.closeConnection();
    }
    DomTerm.domTermLayoutClose(el, this.parent, true);
}
DomTerm.domTermLayoutClose = function(lcontent, r, from_handler=false) {
    if (r) {
        var p = r.parent;
        if (p && p.type == 'stack'
            && p.contentItems.length == 1
            && p.parent.type == 'root'
            && p.parent.contentItems.length == 1) {
            DomTerm.windowClose();
        } else {
            DomTerm.selectNextPane(true, lcontent);
            if (lcontent && lcontent.parentNode)
                lcontent.parentNode.removeChild(lcontent);
            if (! from_handler)
                r.remove();
        }
    }
}

// The current lm_stack
DomTerm._oldFocusedPane = null;

// The current (or previous) lm.items.Component
DomTerm._oldFocusedItem = null;

// The current domterm-wrapper Element.
// Same as DomTerm._oldFocusedItem.container._contentElement1
DomTerm._oldFocusedContent = null;

DomTerm.showFocusedPane = function(item, lcontent = item.container._contentElement1) {
    DomTerm.showFocusedPaneL(item, lcontent);
    DomTerm.showFocusedPaneF(lcontent);
};
DomTerm.showFocusedPaneL = function(item, lcontent = item.container._contentElement1) {
    if (DomTerm._oldFocusedItem != item) {
        var stackPane = item && item.parent.element ? item.parent.element[0] : null;
        if (DomTerm._oldFocusedPane != null)
            DomTerm._oldFocusedPane.classList.remove("domterm-active");
        if (stackPane != null)
            stackPane.classList.add("domterm-active");
        DomTerm._oldFocusedPane = stackPane;
        DomTerm._oldFocusedItem = item;
    }
};
DomTerm.showFocusedPaneF = function(lcontent) {
    if (DomTerm._oldFocusedContent != lcontent) {
        if (DomTerm._oldFocusedContent != null)
            DomTerm._oldFocusedContent.classList.remove("domterm-active");
        if (lcontent != null)
            lcontent.classList.add("domterm-active");

        DomTerm._oldFocusedContent = lcontent;
    }
};
/* Must be called in layout-manager context. */
DomTerm._selectLayoutPane = function(component, originMode) {
    if (DomTerm.useIFrame) {
        DomTerm._focusChild(component.container._contentElement1, originMode);
    } else {
        var dt = DomTerm.layoutItemToDomTerm(component);
        DomTerm.setFocus(dt);
        dt.maybeFocus();
    }
    component.parent.setActiveContentItem(component);
    DomTerm._focusChild(component.container._contentElement1, originMode);
}
DomTerm._focusChild = function(iframe, originMode) {
    let oldContent = DomTerm._oldFocusedContent;
    if (iframe !== oldContent || originMode=="C") {
        if (DomTerm.useIFrame) {
            if (oldContent != null)
                DomTerm.sendChildMessage(oldContent, "set-focused", 0);
            if (originMode != "F")
                DomTerm.sendChildMessage(iframe, "set-focused", 2);
        } else {
            if (oldContent != null)
                oldContent.firstChild.terminal.setFocused(0);
            if (originMode != "F" && iframe.firstChild.terminal) //originMode != "A")
                iframe.firstChild.terminal.setFocused(2);
        }
    }
}

/* Can be called in either DomTerm sub-window or layout-manager context. */
DomTerm.selectNextPane = function(forwards, wrapper=DomTerm._oldFocusedContent) {
    if (DomTerm.useIFrame && DomTerm.isInIFrame()) {
        DomTerm.sendParentMessage("domterm-next-pane", forwards);
        return;
    }
    let item = DomTerm._elementToLayoutItem(wrapper);
    var r = item;
    for (;;) {
        var p = r.parent;
        var i = DomTerm._indexInParent(r);
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
                DomTerm._selectLayoutPane(next, "X");
            return;
        } else {
            r = p;
        }
    }
}
DomTerm._indexInParent = function (component) {
    var i = 0;
    var parent = component.parent;
    var ppChildren = parent.contentItems;
    while (i < ppChildren.length && ppChildren[i] != component) i++;
    return i;
}

DomTerm._splitVertically = function(dt) {
    return dt.numColumns<4*dt.numRows && (dt.numRows>40 || dt.numColumns<90);
}

DomTerm.layoutAddSibling = function(dt, newItemConfig = null,
                                    isColumn=DomTerm._splitVertically(dt),
                                    addAfter=true)
{
    if (newItemConfig == null)
        newItemConfig = DomTerm.newItemConfig;
    else if (typeof newItemConfig == "number")
        newItemConfig = Object.assign({sessionPid: newItemConfig },
                                      DomTerm.newItemConfig);
    if (! DomTerm.layoutManager)
        DomTerm.layoutInit(dt);
    var r = dt == null ? DomTerm._oldFocusedItem
        : DomTerm.domTermToLayoutItem(dt);
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
            var i = DomTerm._indexInParent(p);
            pp.addChild(newItemConfig, addAfter ? i+1: i);
            return;
        }
        r.parent.addChild(newItemConfig); // FIXME index after r
    }
};

DomTerm.layoutAddTab = function(dt, newItemConfig = null) {
    if (newItemConfig == null)
        newItemConfig = DomTerm.newItemConfig;
    else if (typeof newItemConfig == "number")
        newItemConfig = Object.assign({sessionPid: newItemConfig },
                                      DomTerm.newItemConfig);
    if (dt == null)
        dt = DomTerm.focusedTerm;
    if (! DomTerm.layoutManager)
        DomTerm.layoutInit(dt);
    var r = dt == null ? DomTerm._oldFocusedItem
        : DomTerm.domTermToLayoutItem(dt);
    if (r)
        r.parent.addChild(newItemConfig); // FIXME index after r
};

// item is an iframe if useIFrame; a DomTerm otherwise.
DomTerm.setLayoutTitle = function(item, title, wname) {
    title = DomTerm.escapeText(title);
    if (wname) {
        wname = DomTerm.escapeText(wname);
        title = title+'<span class="domterm-windowname"> '+wname+'</span>';
    }
    let r;
    if (! DomTerm.useIFrame)
        r = DomTerm.domTermToLayoutItem(item);
    else if (DomTerm.layoutManager)
        r = DomTerm._elementToLayoutItem(item);
    else {
        item.layoutTitle = title;
        return;
    }
    if (r) {
        r.setTitle(title);
    }
}

DomTerm.popoutWindow = function(item, dt) {
    var wholeStack = item.type == 'stack';
    var sizeElement = item.element[0];
    if (! wholeStack)
        sizeElement = item.container._contentElement1;
    var w = sizeElement.offsetWidth;
    var h = sizeElement.offsetHeight;
    // FIXME adjust for menu bar height
    function encode(item) {
        if (item.componentName == "domterm") {
            var topNode = item.container._contentElement1.firstChild;
            return '{"pid":'+topNode.getAttribute("pid")+'}';
        } else if (item.componentName == "browser")
            return '{"url":'+JSON.stringify(item.config.url)+'}';
        else
            return "{}";
    }
    function remove(item) {
        if (item.componentName == "domterm")
            DomTerm.detach(item.container._contentElement1.firstChild.terminal);
        else {
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

    let newurl = DomTerm.mainLocation+"#open="+encodeURIComponent(e);
    DomTerm.openNewWindow(dt, { width: w, height: h, url: newurl });
    for (var i = 0; i < toRemove.length; i++) {
        remove(toRemove[i]);
    }
}

DomTerm.layoutConfig = {
    settings:  { showMaximiseIcon: false,
                 popoutWholeStack: function(e) { return e.ctrlKey; },
                 onPopoutClick: function(item, event) {
                     var aitem = item.type != 'stack' ? item
                         : item._activeContentItem;
                     var dt = DomTerm.layoutItemToDomTerm(aitem);
                     if (! dt)
                         dt = DomTerm.focusedTerm;
                     if (dt)
                         DomTerm.popoutWindow(item, dt);
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
DomTerm.newItemConfig = {
    type: 'component',
    componentName: 'domterm',
    componentState: 'X'
};

DomTerm.layoutResized = function(event) {
    var dt = this.terminal;
    if (dt && dt._rulerNode)
        dt.resizeHandler();
}

DomTerm.layoutInit = function(term) {
    let top = DomTerm.layoutTop || document.body;
    let lcontent = DomTerm._oldFocusedContent;
    DomTerm.layoutManager = new GoldenLayout(DomTerm.layoutConfig, top);
    DomTerm.layoutManager.registerComponent( 'domterm', function( container, componentConfig ){
        var el;
        var name;
        let wrapped;
        /*if (term != null) {
            el = term.topNode;
            term.detachResizeSensor();
            name = term.sessionName();
            term = null;
            wrapped = el.parentNode;
        } else*/ if (lcontent != null) {
            wrapped = lcontent;
            container._contentElement1 = wrapped;
            if (DomTerm.useIFrame) {
                name = wrapped.layoutTitle;
                wrapped.layoutTitle = undefined;
            } else
                name = DomTerm.freshName();
            lcontent = null;
        } else {
            var config = container._config;
            var sessionPid = config.sessionPid;
            if (DomTerm.useIFrame) {
                let url = DomTerm.mainLocation;
                if (sessionPid)
                    url += (url.indexOf('#') >= 0 ? '&' : '#')
                    + "connect-pid="+sessionPid;
                wrapped = DomTerm.makeIFrameWrapper(url);
                if (DomTerm._oldFocusedItem == null)
                    DomTerm._oldFocusedItem = container.parent;
                name = wrapped.name;
            } else {
                name = DomTerm.freshName();
                el = DomTerm.makeElement(name);
                wrapped = el.parentNode;
            }
            container._contentElement1 = wrapped;
            if (DomTerm._pendingTerminals) {
                DomTerm._pendingTerminals.push(el);
                if (config.sessionPid)
                    el.setAttribute("pid", sessionPid);
            } else if (! DomTerm.useIFrame) {
                var query = sessionPid ? "connect-pid="+sessionPid : null;
                DomTerm.connectHttp(el, query);
            }
        }
        DomTerm.showFocusedPaneL(container.parent, wrapped);
        wrapped.classList.add("lm_content");
        container.setTitle(name);
        container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTerm.domTermLayoutClosed, container);

        if (top !== document.body)
            new ResizeSensor(DomTerm.layoutManager.container,
                             function() { console.log("layout/resize"); DomTerm.layoutManager.updateSize(); });
    });

    DomTerm.layoutManager.registerComponent( 'view-saved', function( container, componentConfig ){
        var url = container._config.url
        var el = container.getElement()[0];
        viewSavedFile(url, el);
        container.setTitle(name);
        container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTerm.domTermLayoutClosed, container);
    });

    DomTerm.layoutManager.registerComponent( 'browser', function( container, componentConfig ){
        var el = document.createElement("iframe");
        el.setAttribute("src", container._config.url);
        el.setAttribute("style", "width: 100%; height: 100%");
        container.getElement()[0].appendChild(el);
        container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTerm.domTermLayoutClosed, container);
    });

    function activeContentItemHandler(item) {
        if (item.config.componentName == "browser")
            DomTerm.setTitle(item.config.url);
        DomTerm._focusChild(item.container._contentElement1, "A");
        DomTerm.showFocusedPane(item);
    }

    function checkClick(event) {
        for (var t = event.target; t instanceof Element; t = t.parentNode) {
            if (t.classList.contains("lm_header")) {
                var item = DomTerm._elementToLayoutItem(t.parentNode);
                DomTerm._selectLayoutPane(item._activeContentItem, "C");
                return;
            }
        }
    }

    DomTerm.layoutManager.init();
    DomTerm.layoutManager.on('activeContentItemChanged',
                             activeContentItemHandler);
    DomTerm.layoutManager.root.element[0]
        .addEventListener('click', checkClick, false);
    DomTerm.layoutManager.on('stateChanged',
                             function() {
                                 let item = DomTerm._oldFocusedItem;
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

DomTerm._initSavedLayout = function(data) {
        if (data.pid) {
            var topNode = DomTerm.makeElement(DomTerm.freshName());
            DomTerm.connectHttp(topNode, "connect-pid="+data.pid);
        } else if (data instanceof Array) {
            var n = data.length;
            DomTerm._pendingTerminals = new Array();
            for (var i = 0; i < n; i++) {
                var w = data[i];
                var newItemConfig = null;
                if (w.pid) {
                    newItemConfig = Object.assign({sessionPid: w.pid },
                                                  DomTerm.newItemConfig);
                } else if (w.url) {
                    newItemConfig = {type: 'component',
                                     componentName: 'browser',
                                     url: w.url };
                }
                if (newItemConfig) {
                    if (i == 0) {
                        DomTerm.layoutConfig.content = [newItemConfig];
                        DomTerm.layoutInit(null);
                    } else {
                        var stack = DomTerm.layoutManager.root.contentItems[0];
                        stack.addChild(newItemConfig);
                    }
                }
            }
            n = DomTerm._pendingTerminals.length;
            for (var i = 0; i < n; i++) {
                let el = DomTerm._pendingTerminals[i];
                var pid = el.getAttribute("pid");
                var query = pid ? "connect-pid="+pid : null;
                DomTerm.connectHttp(el, query);
            }
            DomTerm._pendingTerminals = null;
        }
}

/* A glue layer for a layout mangager, initially GoldenLayout.
 */

DomTerm.newSessionPid = 0;

function _muxModeInfo(dt) {
    return "(MUX mode)";
}

function _escapeHTML(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

DomTerm.prototype._muxKeyHandler = function(event, key, press) {
    if (this.verbosity >= 2)
        this.log("mux-key key:"+key+" event:"+event+" press:"+press);
    switch (key) {
    case 13: // Enter
        DomTerm.layoutAddSibling(this);
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 27: // Escape
        this.exitMuxMode();
        event.preventDefault();
        break;
    case 40 /*Down*/:
    case 38 /*Up*/:
    case 37 /*Left*/:
    case 39 /*Right*/:
        if (event.ctrlKey) {
            DomTerm.layoutAddSibling(this, key==38||key==40, key==39||key==40);
            this.exitMuxMode();
            event.preventDefault();
        } else {
            DomTerm.selectNextPane(this, key==39||key==40);
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
        if (event.ctrlKey) {
            DomTerm.layoutAddTab(this);
            this.exitMuxMode();
            event.preventDefault();
        }
        break;
    }
}

/** Map a layoutItem (GoldenLayout contentItem?) to a DomTerm instance.
*/
DomTerm.layoutItemToDomTerm = function(item) {
    return item.element[0].firstChild.firstChild.terminal;
};

DomTerm.domTermToLayoutItem = function(dt) {
    if (! DomTerm.layoutManager)
        return null;
    var goal = DomTerm.domTermToLayoutElement(dt);
    function find(item) {
        if (item.element[0] == goal)
            return item;
        var citems = item.contentItems;
        for (var i = 0; i < citems.length; i++) {
            var r = find(citems[i]);
            if (r)
                return r;
        }
        return null;
    };
    return find(DomTerm.layoutManager.root);
}

DomTerm.domTermLayoutClosed = function(event) {
    var dt = this.terminal;
    if (dt) {
        dt.closeConnection();
        DomTerm.domTermLayoutClose(dt, true);
    }
}
DomTerm.domTermLayoutClose = function(dt, from_handler=false) {
    var r = DomTerm.domTermToLayoutItem(dt);
    if (r) {
        var p = r.parent;
        if (p && p.type == 'stack'
            && p.contentItems.length == 1
            && p.parent.type == 'root'
            && p.parent.contentItems.length == 1) {
            window.close();
        } else {
            DomTerm.selectNextPane(dt, true);
            dt = DomTerm.focusedTerm;
            if (! from_handler)
                r.remove();
            DomTerm.setFocus(dt);
            dt.maybeFocus();
        }
    }
}
DomTerm._oldFocusedPane = null;
DomTerm.showFocusedPane = function(dt) {
    var stackPane;
    if (dt == null)
        stackPane = null;
    else {
        var p = DomTerm.domTermToLayoutItem(dt);
        stackPane = p ? p.parent.element[0] : null;
    }
    if (DomTerm._oldFocusedPane != stackPane) {
        if (DomTerm._oldFocusedPane != null)
            DomTerm._oldFocusedPane.classList.remove("domterm-active");
        if (stackPane != null)
            stackPane.classList.add("domterm-active");
        DomTerm._oldFocusedPane = stackPane;
    }
};
DomTerm._selectLayoutPane = function(component) {
    var dt = DomTerm.layoutItemToDomTerm(component);
    var p = component.parent;
    if (p.type == 'stack')
        p.setActiveContentItem(component);
    DomTerm.setFocus(dt);
}
DomTerm.selectNextPane = function(dt, forwards) {
    var cur = DomTerm.domTermToLayoutItem(dt);
    var r = cur;
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
            if (next != cur)
                DomTerm._selectLayoutPane(next);
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

DomTerm.layoutAddPane = function(dt, paneOp, sessionPid=0) {
    DomTerm.newSessionPid = sessionPid;
    switch (paneOp) {
    case 1: // new pane
        DomTerm.layoutAddSibling(dt);
        break;
    case 2: // tab
        DomTerm.layoutAddTab(dt);
        break;
    case 10: // Left
    case 11: // Right
    case 12: // Above
    case 13: // Below
        DomTerm.layoutAddSibling(dt,
                                 paneOp==12||paneOp==13,
                                 paneOp==11||paneOp==13);
        break;
    }
    DomTerm.newSessionPid = 0;
}

DomTerm.layoutAddSibling = function(
        dt,
        isColumn=DomTerm._splitVertically(dt),
        addAfter=true) {
    if (! DomTerm.layoutManager)
        DomTerm.layoutInit(dt);
    var r = DomTerm.domTermToLayoutItem(dt);
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
            pp.addChild(DomTerm.newItemConfig, addAfter ? i+1: i);
            return;
        }
        r.parent.addChild(DomTerm.newItemConfig); // FIXME index after r
    }
};

DomTerm.layoutAddTab = function(dt) {
    if (dt == null)
        dt = DomTerm.focusedTerm;
    if (! DomTerm.layoutManager)
        DomTerm.layoutInit(dt);
    var r = DomTerm.domTermToLayoutItem(dt);
    if (r)
        r.parent.addChild(DomTerm.newItemConfig); // FIXME index after r
};

DomTerm.domTermToLayoutElement = function(domterm) {
    var node = domterm.topNode;
    var parentNode = node.parentNode;
    if (parentNode instanceof Element && parentNode.classList.contains("lm_content")) {
        parentNode = parentNode.parentNode
        if (parentNode instanceof Element
            && parentNode.classList.contains("lm_item_container"))
            return parentNode;
    }
    return null;
}
DomTerm.setLayoutTitle = function(dt, title, wname) {
    var r = DomTerm.domTermToLayoutItem(dt);
    title = _escapeHTML(title);
    if (r) {
        var p = r.parent;
        if (p.type == 'stack' && p._activeContentItem == r
            && wname) {
            wname = _escapeHTML(wname);
            title = title+'<span class="domterm-windowname"> '+wname+'</span>';
        }
        r.setTitle(title);
    }
}

DomTerm.layoutConfig = {
    //settings: { hasHeaders: false },
    content: [{
            type: 'component',
            componentName: 'domterm',
            componentState: 'A'
    }],
    dimensions: {
	borderWidth: 3
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
    DomTerm.layoutManager = new GoldenLayout(DomTerm.layoutConfig);
    DomTerm.layoutManager.registerComponent( 'domterm', function( container, componentConfig ){
        var el;
        var name;
        if (term != null) {
            el = term.topNode;
            term.detachResizeSensor();
            name = term.sessionName();
            term = null;
            container.getElement()[0].appendChild(el);
        } else {
            var sessionPid = DomTerm.newSessionPid;
            el = document.createElement("div");
            el.setAttribute("class", "domterm");
            name = DomTerm.freshName();
            el.setAttribute("id", name);
            container.getElement()[0].appendChild(el);
            var query = sessionPid ? "connect-pid="+sessionPid : null;
            connectHttp(el, query);
        }
        container.setTitle(name);
        container.on('resize', DomTerm.layoutResized, el);
        container.on('destroy', DomTerm.domTermLayoutClosed, el);
    });

    DomTerm.layoutManager.init();
    DomTerm.layoutManager.on('activeContentItemChanged', _activeContentItemHandler);
}

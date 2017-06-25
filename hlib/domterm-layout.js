/* A glue layer for a layout mangager, initially GoldenLayout.
 */

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
        DomTerm.domTermLayoutAddSibling(this, true, true);
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
            DomTerm.domTermLayoutAddSibling(this, key==38||key==40,
                                            key==39||key==40);
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
            DomTerm.domTermLayoutAddTab(this);
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

DomTerm.domTermLayoutClose = function(dt) {
    var r = DomTerm.domTermToLayoutItem(dt);
    if (r) {
        var p = r.parent;
        if (p && p.type == 'stack'
            && p.parent.type == 'root'
            && p.parent.contentItems.length == 1) {
            window.unloadHandler(null);
            window.close();
        } else
            r.remove();
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
DomTerm.domTermLayoutAddSibling = function(dt, isColumn, addAfter) {
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

DomTerm.domTermLayoutAddTab = function(dt) {
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
    var t = this instanceof Element ? this.getAttribute("id") : this;
    var dt = this.terminal;
    if (dt && dt._rulerNode)
        dt.resizeHandler();
}

DomTerm.layoutInit = function(term) {
    DomTerm.layoutManager = new GoldenLayout(DomTerm.layoutConfig);
    DomTerm.layoutManager.registerComponent( 'domterm', function( container, componentState ){
        var el;
        var name;
        if (term != null) {
            el = term.topNode;
            term.detachResizeSensor();
            name = term.sessionName();
            term = null;
            container.getElement()[0].appendChild(el);
        } else {
            el = document.createElement("div");
            el.setAttribute("class", "domterm");
            name = DomTerm.freshName();
            el.setAttribute("id", name);
            container.getElement()[0].appendChild(el);
            connectHttp(el);
        }
        container.setTitle(name);
        container.on('resize', DomTerm.layoutResized, el);
    });

    DomTerm.layoutManager.init();
    DomTerm.layoutManager.on('activeContentItemChanged', _activeContentItemHandler);
}

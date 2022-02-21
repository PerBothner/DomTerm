/* A glue layer for a layout mangager, initially GoldenLayout.
 */

export { DomTermLayout };

import { GoldenLayout, LayoutConfig, ResolvedLayoutConfig, ItemConfig, ResolvedItemConfig, Tab } from './goldenlayout.js';

class DomTermLayout {
};

DomTerm._domtermLayout = DomTermLayout;

DomTermLayout._pendingTerminals = null;

DomTermLayout.manager = null;

DomTermLayout.selectNextPane = function(forwards, wrapper=DomTerm._oldFocusedContent) {
    if (DomTermLayout.manager == null)
        return;
    let item = DomTermLayout._elementToLayoutItem(wrapper);
    var r = item;
    for (;;) {
        var p = r.parent;
        var i = DomTermLayout._indexInParent(r);
        var nexti = forwards ? i + 1 : i - 1;
        var next;
        if (nexti >= 0 && nexti < p.contentItems.length)
            next = p.contentItems[nexti];
        else if (p.type == 'ground')
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
    if (parent == null)
        return 0;
    var ppChildren = parent.contentItems;
    while (i < ppChildren.length && ppChildren[i] != component) i++;
    return i;
}

DomTermLayout.shouldSplitVertically = function(w, h) {
    return 2*w < 3*h && (h > 800 || w < 900)
}

DomTermLayout.addPane = function(paneOp, newItemConfig,
                                 wrapper = DomTerm._oldFocusedContent)
{
    if (! DomTermLayout.manager)
        DomTermLayout.initialize();
    let oldItem = DomTermLayout._elementToLayoutItem(wrapper);
    if (oldItem)
        DomTermLayout.addPaneRelative(oldItem, paneOp, newItemConfig);
}

DomTermLayout.addPaneRelative = function(oldItem, paneOp, newItemConfig)
{
    if (paneOp == 1) { // convert to --right or --below
        paneOp = DomTermLayout.shouldSplitVertically(oldItem.container.width,
                                                     oldItem.container.height)
            ? 13 : 11;
    }

    let config = { type: 'component', componentType: 'domterm' };
    let extraConfig;
    if (newItemConfig) {
        extraConfig = newItemConfig;
        if (newItemConfig.componentType)
            config.componentType = newItemConfig.componentType;
    } else
        extraConfig = {};
    config.title = "(DomTerm)"+DomTermLayout._count; // FIXME
    config.componentState = extraConfig;
    let addAfter = paneOp == 2 || paneOp==11 || paneOp==13;
    let p = oldItem.parent;
    if (paneOp == 2) { // new tab
        const i = DomTermLayout._indexInParent(oldItem);
        p.addItem(ItemConfig.resolve(config), addAfter ? i+1: i);
    } else {
        let isColumn = paneOp==12||paneOp==13;
        var type = isColumn ? 'column' : 'row';
        if (p && p.type == "stack") {
            var pp = p.parent;
            if (pp.type != type && paneOp != 2) {
                const rowOrColumn = p.layoutManager.createContentItem(ResolvedItemConfig.createDefault(type), p);
                pp.replaceChild(p, rowOrColumn);
                rowOrColumn.addChild(p, 0, true);
                rowOrColumn.updateSize();
                pp = rowOrColumn;
            }
            var i = DomTermLayout._indexInParent(p);
            pp.addItem(ItemConfig.resolve(config), addAfter ? i+1: i);
            return;
        }
        p.addChild(newItemConfig); // FIXME index after r
    }
};

DomTermLayout.showFocusedPane = function(lcontent) {
    //if (DomTerm.handlingJsMenu())
    //    return;
    if (DomTerm._oldFocusedContent != lcontent) {
        if (DomTerm._oldFocusedContent != null)
            DomTerm._oldFocusedContent.classList.remove("domterm-active");
        if (lcontent != null)
            lcontent.classList.add("domterm-active");

        DomTerm._oldFocusedContent = lcontent;
    }
};
DomTermLayout._focusChild = function(iframe, originMode) {
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
            let terminal = iframe.terminal;
            if (iframe.tagName == "IFRAME")
                DomTerm.sendChildMessage(iframe, "set-focused", 2);
            else if (terminal)
                terminal.setFocused(2);
        }
    }
}

DomTermLayout.domTermToLayoutItem = function(dt) { // FIXME
    //if (! DomTermLayout.manager)
    //    return null;
    let node = dt.topNode;
    if (node instanceof Element && node.classList.contains("lm_content"))
        return DomTermLayout._elementToLayoutItem(node);
    else
        return null;
}

DomTermLayout._elementToLayoutItem = function(goal, item = DomTermLayout.manager.root) {
    if (goal._layoutItem)
        return goal._layoutItem;
    if (item.element == goal
        || (item.container && item.container.getElement() == goal))
        return item;
    var citems = item.contentItems;
    for (var i = 0; i < citems.length; i++) {
        var r = DomTermLayout._elementToLayoutItem(goal, citems[i]);
        if (r)
            return r;
    }
    return null;
}

DomTermLayout._numberToLayoutItem = function(wnum, item = DomTermLayout.manager.root) {
    if ((item.component && item.component.windowNumber === wnum)
        || (item.container && item.container.getElement().windowNumber == wnum))
        return item;
    var citems = item.contentItems;
    for (var i = 0; i < citems.length; i++) {
        var r = DomTermLayout._numberToLayoutItem(wnum, citems[i]);
        if (r)
            return r;
    }
    return null;
}

DomTermLayout.setLayoutTitle = function(content, title, wname) {
    const item = DomTermLayout._elementToLayoutItem(content);
    if (item)
        DomTermLayout.setContainerTitle(item, title, wname);
}

DomTermLayout.updateLayoutTitle = function(item, content) {
    let title = content.getAttribute("window-name");
    if (title) {
        if (! content.windowNameUnique
            && content.windowNumber !== undefined)
            title += ":" + content.windowNumber;
    } else {
        title = "DomTerm"; // FIXME
        if (content.windowNumber !== undefined)
            title += ":" + content.windowNumber;
    }
    DomTermLayout.setContainerTitle(item, title, content.layoutWindowTitle);
}

DomTermLayout.setContainerTitle = function(item, title, wname) {
    item.setTitle(title);
    item.setTitleRenderer((container, el, width, flags) => {
        // Redundant if we use innerHTML/innerText:
        //while (el.lastChild) el.removeChild(el.lastChild);
        if (wname &&
            ((flags & Tab.RenderFlags.InDropdownMenu) ||
             ! (flags & Tab.RenderFlags.DropdownActive))) {
            el.innerHTML =
                DomTerm.escapeText(title)+' <span class="domterm-windowname">('+DomTerm.escapeText(wname)+')</span>';
        } else {
            el.innerText = title;
        }
    });
}

DomTermLayout._selectLayoutPane = function(component, originMode) {
    if (! DomTerm.useIFrame && ! DomTerm.usingXtermJs()) {
        let element = component.container.getElement().firstChild;
        let dt = element && element.classList.contains("domterm")
            ? element.terminal
            : null;
        DomTerm.setFocus(dt);
        if (dt != null)
            dt.maybeFocus();
    }
    DomTermLayout.manager.focusComponent(component);
}

DomTermLayout.popoutWindow = function(item, dt = null) {
    var wholeStack = item.type == 'stack';
    var sizeElement = item.element;
    var w = sizeElement.offsetWidth;
    var h = sizeElement.offsetHeight;
    if (! wholeStack) {
        DomTerm.closeSession(item.component, true, false);
    }
    // FIXME adjust for menu bar height
    function encode(item) {
        if (item.componentType == "domterm") {
            const node = item.component;
            return '{"sessionNumber":'+node.getAttribute("session-number")+'}';
        } else if (item.componentType == "browser")
            return '{"url":'+JSON.stringify(item.config.url)+'}';
        else
            return "{}";
    }
    function remove(item) {
        if (item.componentType !== "domterm") {
            let lcontent = item.container.element;
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
}

/*
DomTermLayout.popinWindow = function(minifiedWindowConfig) {
    const resolvedConfig = ResolvedLayoutConfig.unminifyConfig(minifiedWindowConfig);
    const config = LayoutConfig.fromResolved(resolvedConfig);
    DomTermLayout.initialize([config.root]);
};
*/

DomTermLayout.newItemConfig = {
    type: 'component',
    componentType: 'domterm',
    componentState: {}
};

DomTermLayout.config = {
    settings:  { showMaximiseIcon: false,
                 reorderOnTabMenuClick: false,
                 useDragAndDrop: true,
                 checkGlWindowKey: false,
               },
    content: [{
        type: 'component',
        componentType: 'domterm',
        componentState: 'A'
    }],
    dimensions: {
        contentInset: 0,
	borderWidth: 1
    }
};

DomTermLayout._containerHandleResize = function(container, wrapped) {
    if (DomTerm.usingXtermJs() || wrapped.nodeName == "IFRAME")
        return;
    container.on('resize',
                 (event) => {
                     var dt = wrapped.terminal;
                     if (dt && dt._rulerNode)
                         dt.resizeHandler();
                 })
}

DomTermLayout.layoutClose = function(lcontent, r, from_handler=false) {
    if (r) {
        var p = r.parent;
        if (p && p.type == 'stack'
            && p.contentItems.length == 1
            && p.parent.type == 'ground'
            && p.parent.contentItems.length == 1) {
            DomTerm.windowClose();
        } else if (! from_handler) {
            DomTermLayout.selectNextPane(true, lcontent);
            if (lcontent && lcontent.parentNode)
                lcontent.parentNode.removeChild(lcontent);
            r.remove();
        }
    }
}

DomTermLayout.onLayoutClosed = function(container) {
    return (event) => {
        const config = container.parent.toConfig();
        if (config.componentType === "browser"
            || config.componentType === "view-saved") {
            const dt = DomTerm.focusedTerm;
            const wnum = container.component.windowNumber;
            if (dt && wnum) {
                dt.reportEvent("CLOSE-WINDOW", wnum);
            }
            DomTermLayout.layoutClose(container.component, container.parent, true);
            return;
        }
        DomTerm.closeSession(container.component, false, true);
    };
}

DomTerm._lastPaneNumber = 0;

DomTerm._newPaneNumber = function() {
    return ++DomTerm._lastPaneNumber;
}

DomTerm.newPaneHook = null;

DomTermLayout._initTerminal = function(config, parent = DomTerm.layoutTop) {
    let cstate = config.componentState;
    let wrapped;
    let sessionNumber = cstate.sessionNumber;
    let paneNumber = DomTerm._newPaneNumber();
    if (DomTerm.useIFrame || (cstate && cstate.componentType === 'browser')) {
        let url = cstate && cstate.url; //cstate.componentType === 'browser' ? cstate.urlconfig.url;
        if (! url) {
            url = DomTerm.paneLocation;
            url += url.indexOf('#') >= 0 ? '&' : '#';
            url += "pane-number="+paneNumber; // ?? used for?
            if (sessionNumber)
                url += "&session-number="+sessionNumber;
            if (cstate) {
                if (cstate.windowNumber)
                    url += "&window="+cstate.windowNumber;
                if (cstate.windowName)
                    url += (cstate.windowNameUnique ? "&wname-unique="
                            : "&wname=")
                        + cstate.windowName;
            }
        }
        wrapped = DomTerm.makeIFrameWrapper(url, 'T', parent);
    } else {
        let name = DomTerm.freshName();
        let el = DomTerm.makeElement(name, parent);
        wrapped = el;
        wrapped.name = name;
        let query = sessionNumber ? "session-number="+sessionNumber : null;
        el.query = query;
    }
    wrapped.paneNumber = paneNumber;
    if (DomTerm.newPaneHook)
        DomTerm.newPaneHook(paneNumber, sessionNumber, wrapped);
    return wrapped;
}

DomTermLayout.initialize = function(initialContent = [DomTermLayout.newItemConfig]) {
    function activeContentItemHandler(item) {
        //if (item.componentName == "browser")
        //    DomTerm.setTitle(item.config.url);
        DomTermLayout._focusChild(item.container.element, "A");
        DomTermLayout.showFocusedPane(item.container.element);
    }

    let top = DomTerm.layoutTop || document.body;
    let lcontent = DomTerm._oldFocusedContent;

    let lparent = lcontent && lcontent.parentElement;
    const config = Object.assign({}, DomTermLayout.config, { content: initialContent });
    DomTermLayout.manager = new GoldenLayout(config, top);

    DomTermLayout.manager.createContainerElement = (manager, config) => {
        if (lparent && lparent.classList.contains("lm_component")) {
            const element = lparent;
            lparent = null;
            return element;
        }
        const element = document.createElement('div');
        DomTerm.layoutTop.appendChild(element);
        return element;
    };
    DomTermLayout.manager.popoutClickHandler = (stack, event) => {
        if (event.ctrlKey) {
            DomTermLayout.popoutWindow(stack);
        } else {
            DomTermLayout.popoutWindow(stack.getActiveComponentItem());
        }
        return true;
    }

    DomTermLayout.manager.registerComponent( 'domterm', function( container, componentConfig ){
        var el;
        let name;
        let wrapped;
        if (lcontent != null) {
            wrapped = lcontent;
            let e = DomTerm._oldFocusedContent;
            name = (e && (e.layoutTitle || e.getAttribute("name")))
                || DomTerm.freshName();
            lcontent.layoutTitle = undefined;
            lcontent = null;
        } else {
            var config = container._config;
            wrapped = DomTermLayout._initTerminal(config, container.element);
            name = wrapped.name;
            if (! DomTerm.useIFrame) {
                DTerminal.connectHttp(wrapped, wrapped.query);
            }
        }
        DomTermLayout.showFocusedPane(wrapped);
        wrapped.classList.add("lm_content");
        wrapped._layoutItem = container.parent;
        if (typeof componentConfig.windowNumber === "number")
            wrapped.windowNumber = componentConfig.windowNumber;
        DomTerm.updateContentTitle(wrapped, componentConfig);
        DomTermLayout.updateLayoutTitle(container.parent, wrapped);
        container.stateRequestEvent = () => {
            const state = {};
            // FIXME make work for iframe
            let sessionNumber = wrapped.getAttribute("session-number");
            if (sessionNumber)
                state.sessionNumber = sessionNumber;
            return state;
        };

        container.on("dragExported", (component) => {
            DomTerm.closeSession(component.component, true, true);
        });

        container.on('destroy', DomTermLayout.onLayoutClosed(container));
        if (top !== document.body) {
            (new ResizeObserver(entries => {
                DomTermLayout.manager.updateSize(); })
            ).observe(top);
        }
        wrapped.rootHtmlElement = wrapped;
        return wrapped;
    }, false /*not virtual*/);

    DomTermLayout.manager.registerComponent( 'view-saved', function( container, componentConfig ){
        container.on('destroy', DomTermLayout.onLayoutClosed(container));
        let el = viewSavedFile(componentConfig.url);
        if (typeof componentConfig.windowNumber === "number")
            el.windowNumber = componentConfig.windowNumber;
        el.rootHtmlElement = el;
        return el;
    }, true /*virtual*/);

    DomTermLayout.manager.registerComponent( 'browser', function( container, componentConfig ){
        container.on('destroy', DomTermLayout.onLayoutClosed(container));
        const url = componentConfig.url;
        let el = DomTerm.makeIFrameWrapper(url, 'B');
        let title = "B";
        const wnum = componentConfig.windowNumber;
        if (typeof wnum === "number") {
            el.windowNumber = wnum;
            title = "B-" + wnum ;
        }
        DomTerm.updateContentTitle(el, componentConfig);
        DomTermLayout.updateLayoutTitle(container.parent, el);
        el.rootHtmlElement = el;
        return el;
    }, true /* virtual*/);

    function checkClick(event) {
        for (var t = event.target; t instanceof Element; t = t.parentNode) {
            if (t.classList.contains("lm_header")) {
                var item = DomTermLayout._elementToLayoutItem(t.parentNode);
                DomTermLayout._selectLayoutPane(item._activeComponentItem, "C");
                return;
            }
        }
    }

    console.log("before GL init");
    DomTermLayout.manager.init(); // ??
    console.log("after GL init");
    DomTermLayout.manager.on('activeContentItemChanged',
                             activeContentItemHandler);

    DomTermLayout.manager.on('dragstart',
                             (e) => {
                                 const dt = DomTerm.focusedTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "start");
                             });
    DomTermLayout.manager.on('dragend',
                             (e) => {
                                 const dt = DomTerm.focusedTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "end");
                             });

    let root = DomTermLayout.manager.container;
    DomTermLayout.manager.on('focus',
                             (e) => {
                                 let dt = e.target.component;
                                 DomTermLayout._focusChild(dt, 'X')
                                 DomTermLayout.showFocusedPane(dt); // ??
                             });
}

DomTermLayout.initSaved = function(data) {
    if (data.sessionNumber) {
        DomTermLayout.initialize([{ type: 'component',
                                    componentType: 'domterm',
                                    componentState: {sessionNumber: data.sessionNumber}}]);
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
                    newItemConfig = {//type: 'component',
                                     componentType: 'browser',
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

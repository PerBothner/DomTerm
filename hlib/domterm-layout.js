/* A glue layer for a layout mangager, initially GoldenLayout.
 */

export { DomTermLayout };

import { GoldenLayout, LayoutConfig, ResolvedLayoutConfig, ItemConfig, ResolvedItemConfig, RowOrColumn, Tab } from './goldenlayout.js';
import { escapeText } from './domterm-utils.js';

class DomTermLayout {
};

DomTerm._domtermLayout = DomTermLayout;

DomTermLayout.manager = null;

DomTermLayout.selectNextPane = function(forwards, oldWindowNum) {
    if (DomTermLayout.manager == null)
        return;
    const item = DomTermLayout._numberToLayoutItem(oldWindowNum);
    if (! item)
        return;
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

DomTermLayout.updateSize = function() {
    const lm = DomTermLayout.manager;
    if (! lm || ! lm.root.element )
        return;
    const element = lm.root.element;
    const body = document.body;
    const width = body.offsetWidth - element.offsetLeft;
    const height = body.offsetHeight - element.offsetTop;
    lm.setSize(width, height);
}

/*
  * paneOp - see enum pane_specifer in server.h.
 */
DomTermLayout.addPaneRelative = function(oldItem, paneOp, newItemConfig)
{
    if (paneOp == 1) { // convert to --right or --below
        paneOp = DomTermLayout.shouldSplitVertically(oldItem.container.width,
                                                     oldItem.container.height)
            ? 13 : 11;
    }

    const ctype = newItemConfig.use_xtermjs ? 'xterminal' : 'domterm';
    let config = { componentType: ctype, type: 'component' };
    let extraConfig;
    if (newItemConfig) {
        extraConfig = newItemConfig;
        if (newItemConfig.componentType)
            config.componentType = newItemConfig.componentType;
    } else
        extraConfig = {};
    config.title = "(DomTerm)"+DomTermLayout._count; // FIXME
    config.componentState = extraConfig;
    let top_relative = paneOp >= 18 && paneOp < 21;
    if (top_relative) {
        paneOp -= 8;
    }
    let addAfter = paneOp == 2 || paneOp==11 || paneOp==13;
    let p = oldItem.parent;
    if (paneOp == 2) { // new tab
        const i = DomTermLayout._indexInParent(oldItem);
        p.addItem(ItemConfig.resolve(config), addAfter ? i+1: i);
    } else {
        let isColumn = paneOp==12||paneOp==13;
        var type = isColumn ? 'column' : 'row';
        let ground = p.layoutManager.groundItem;
        let column = ground.contentItems.length !== 1 ? null
            : ground.contentItems[0];
        if (top_relative && column instanceof RowOrColumn) {
            if (column.type !== type) {
                const rowOrColumn = p.layoutManager.createContentItem(ResolvedItemConfig.createDefault(type), ground);
                ground.replaceChild(column, rowOrColumn);
                rowOrColumn.addChild(column, 0, true);
                rowOrColumn.updateSize();
                column = rowOrColumn;
            }
            column.addItem(ItemConfig.resolve(config), addAfter ? column.contentItems.length : 0);
            return;
        }
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
    const wrapper = DomTerm.useSeparateContentChild() ? goal.parentNode : goal;
    if (item.container && item.container.element === wrapper)
        return item;
    var citems = item.contentItems;
    for (let i = 0; i < citems.length; i++) {
        const r = DomTermLayout._elementToLayoutItem(goal, citems[i]);
        if (r)
            return r;
    }
    return null;
}

DomTermLayout._numberToLayoutItem = function(wnum) {
    return DomTermLayout.manager.findFirstComponentItemById(`${wnum}`);
}

DomTermLayout.updateLayoutTitle = function(item,
                                           cstate = item?.toConfig().componentState) {
    let title = DomTerm.formatWindowLabel(cstate);
    const wname = cstate.windowTitle || cstate.url;

    item.setTitle(title);
    item.setTitleRenderer((container, el, width, flags) => {
        // Redundant if we use innerHTML/innerText:
        //while (el.lastChild) el.removeChild(el.lastChild);
        if (wname &&
            ((flags & Tab.RenderFlags.InDropdownMenu) ||
             ! (flags & Tab.RenderFlags.DropdownActive))) {
            el.innerHTML =
                escapeText(title)+' <span class="domterm-windowname">('+escapeText(wname)+')</span>';
        } else {
            el.innerText = title;
        }
    });
}

DomTermLayout.focusPane = function(pane, focused) {
    const item = pane.layoutItem;
    let element = item?.container?.element;
    if (element && element.firstElementChild
        && element.firstElementChild.classList.contains("lm_content"))
        element = element.firstElementChild;
    if (pane.setFocused)
        pane.setFocused(focused);
    else if (pane.number >= 0) {
        DomTerm.sendChildMessage(pane.number, "set-focused", focused);
    }
};

DomTermLayout._selectLayoutPane = function(component, originMode/*unused*/) {
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
    DomTerm.focusedPane = component.container.paneInfo;
    DomTerm.focusedWindowNumber = Number(component.id) || 0;
}

DomTermLayout.popoutWindow = function(item, screenX, screenY) {
    const wholeStack = item.type == 'stack';
    // True if dropped to desktop; false if popout-button clicked
    const dragged = typeof screenX === "number";
    let bodyZoom = Number(window.getComputedStyle(document.body)['zoom']);
    const zoom = (window.devicePixelRatio || 1.0)
          * (bodyZoom || 1.0);

    const sizeElement = item.element;
    var w = sizeElement?.offsetWidth * zoom;
    var h = sizeElement?.offsetHeight * zoom;
    const e = [];
    const options = { width: w, height: h, content: e };
    DomTermLayout._pendingPopoutComponents = 0;

    function encode(item) {
        const itemConfig = item.toConfig();
        const cstate = itemConfig?.componentState;
        const wnum = cstate?.windowNumber;
        const snum = cstate?.sessionNumber;
        DomTerm.mainTerm.reportEvent("DETACH-WINDOW", item.id);
        if (DomTerm.useToolkitSubwindows) {
            if (! dragged) {
                DomTermLayout.selectNextPane(true, wnum);
                item.remove();
                if (DomTermLayout.manager.root.contentItems.length == 0)
                    DomTerm.windowClose();
            }
        } else
            DomTerm.closeSession(item.container.paneInfo, "export", dragged);
        if (wnum && ! options.windowNumber)
            options.windowNumber = wnum;
        if (snum && ! options.sessionNumber)
            options.sessionNumber = snum;
       if (! DomTerm.useToolkitSubwindows && wnum
            && item.componentType == "domterm") {
            DomTermLayout._pendingPopoutComponents++;
        }
        return itemConfig;
    }

    if (wholeStack) {
        var items = item.contentItems;
        for (var i = 0; i < items.length; i++) {
            e.push(encode(items[i]));
        }
    } else {
        e.push(encode(item));
    }

    if (dragged && screenX >= 0 && screenY >= 0) {
        const wX = screenX - DomTermLayout.dragStartOffsetX;
        const wY = screenY - DomTermLayout.dragStartOffsetY;
        options.position = `+${Math.round(wX)}+${Math.round(wY)}`;
    }
    DomTermLayout._pendingPopoutOptions = options;
    let dt = DomTerm.mainTerm;

    setTimeout(() => {
        if (DomTermLayout._pendingPopoutOptions) {
            const soptions = JSON.stringify(DomTermLayout._pendingPopoutOptions);
            dt.reportEvent("OPEN-WINDOW", soptions);
        }
    }, DomTermLayout._pendingPopoutComponents === 0 ? 0 : 2000);
}

/*
DomTermLayout.popinWindow = function(minifiedWindowConfig) {
    const resolvedConfig = ResolvedLayoutConfig.unminifyConfig(minifiedWindowConfig);
    const config = LayoutConfig.fromResolved(resolvedConfig);
    DomTermLayout.initialize([config.root]);
};
*/

DomTermLayout.config = {
    settings:  { showMaximiseIcon: false,
                 reorderOnTabMenuClick: false,
                 useDragAndDrop: DomTerm.useDragAndDrop,
                 copyForDragImage: DomTerm.copyForDragImage && ! DomTerm.useToolkitSubwindows,
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

DomTermLayout._containerHandleResize = function(container, wrapped) { // unused ???
    if (DomTerm.usingXtermJs() || wrapped.nodeName == "IFRAME")
        return;
    container.on('resize',
                 (event) => {
                     var dt = wrapped.terminal;
                     if (dt && dt._rulerNode)
                         dt.resizeHandler();
                 })
}

DomTermLayout.layoutClose = function(lcontent, windowNumber, from_handler=false) {
    if (DomTerm.apphooks.closePane) {
        DomTerm.apphooks.closePane(windowNumber);
    }
    const r = DomTermLayout._numberToLayoutItem(windowNumber)
    if (r && ! from_handler) {
        DomTermLayout.selectNextPane(true, windowNumber);
        r.remove();
    }
    if (windowNumber === DomTerm.focusedWindowNumber)
        DomTerm.focusedWindowNumber = 0;
    const pane = DomTerm.paneMap[windowNumber];
    if (pane.layoutItem === r) {
        pane.layoutItem = undefined;
        pane.layoutContainer = undefined;
        DomTerm.paneMap[windowNumber] = undefined;
    }
    DomTermLayout._pendingPopoutComponents--;
    if (DomTermLayout._pendingPopoutOptions && DomTerm.mainTerm
        && ! DomTermLayout._pendingPopoutComponents) {
        DomTerm.mainTerm.reportEvent("OPEN-WINDOW", JSON.stringify(DomTermLayout._pendingPopoutOptions));
        DomTermLayout._pendingPopoutOptions = undefined;
    }
    if (DomTermLayout.manager.root.contentItems.length == 0)
        DomTerm.windowClose();
    if (lcontent) {
        if (lcontent.parentNode instanceof Element
            && lcontent.parentNode.classList.contains("lm_component"))
            lcontent = lcontent.parentNode;
        lcontent.remove();
    }
}

DomTermLayout.onLayoutClosed = function(container) {
    const handler = (event) => {
        container.off('destroy', handler);
        const config = container.parent.toConfig();
        const wnum = config.componentState?.windowNumber;
        const pane = container.paneInfo;
        const content = pane.contentElement;
        if (config.componentType === "browser"
            || config.componentType === "view-saved") {
            const dt = DomTerm.mainTerm;
            if (dt && wnum) {
                dt.reportEvent("CLOSE-WINDOW", wnum);
            }
            DomTermLayout.layoutClose(content, wnum, true);
            return;
        }
        DomTerm.closeSession(pane, false, true);
    };
    return handler;
}
//DomTermLayout.inSomeWindow = false;
DomTermLayout.dragNotificationFromServer = function(entering) {
    DomTermLayout.manager.enterOrLeaveSomeWindow(entering);
    if (! entering && this.delayedDragEndTimer) {
        clearTimeout(this.delayedDragEndTimer);
        (this.delayedDragEndFunction)();
        this.delayedDragEndFunction = undefined;
        this.delayedDragEndTimer = undefined;
    }
};

DomTermLayout._lastPaneNumber = 0;

DomTermLayout._newPaneNumber = function() {
    return ++DomTermLayout._lastPaneNumber;
}

DomTerm.newPaneHook = null; // is this ever set ???

DomTermLayout._initPane = function(cstate, ctype, parent = DomTerm.layoutTop) {
    let wrapped;
    let sessionNumber = cstate.sessionNumber;
    let windowNumber = cstate.windowNumber;
    let paneNumber = DomTermLayout._newPaneNumber();
    let query = "pane-number="+paneNumber; // ?? used for?
    if (sessionNumber)
        query += `&session-number=${sessionNumber}`;
    if (cstate) {
        if (windowNumber)
            query += `&window=${windowNumber}`;
        if (cstate.windowName)
            query += (cstate.windowNameUnique ? "&wname-unique="
                      : "&wname=")
            + cstate.windowName;
    }
    const ptype = ctype == "domterm" ? "dterminal" : ctype;
    let pane;
    if (DomTerm.useIFrame >= (paneNumber > 1 ? 1 : 2)
        || ctype === 'browser') {
        pane = new PaneInfo(cstate.windowNumber, ptype);
        let url = ctype !== "view-saved" && cstate && cstate.url;
        if (! url) {
            url = DomTerm.paneLocation;
            if (query)
                url += (url.indexOf('#') >= 0 ? '&' : '#') + query;
            if (cstate.use_xtermjs) {
                url = url.replace(/[/]simple.html([?][^#]*)?#/,
                                  "/xtermjs.html$1#terminal=xtermjs&");
            }
            if (ctype === "view-saved" && cstate.url)
                url += (url.indexOf('#') >= 0 ? '&' : '#')
                + "view-saved=" +encodeURIComponent(cstate.url);
        }
        if (DomTerm.apphooks.newPane && cstate.windowNumber >= 0 /*&& cstate.componentType === 'browser'*/) {
            url = DomTerm.addSubWindowParams(url, cstate.componentType === 'browser'?'B':'T'/*FIXME*/);
            DomTerm.apphooks.newPane(cstate.windowNumber, url);
            wrapped = undefined; // FIXME
        } else {
            const mode = ctype === 'browser' ? 'B'
                  : ctype === 'view-saved' ? 'V'
                  : 'T';
            wrapped = DomTerm.makeIFrameWrapper(url, mode, parent);
            pane.contentElement = wrapped;
            wrapped.paneInfo = pane;
        }
    } else {
        pane = PaneInfo.create(cstate.windowNumber, ptype);
        let name = DomTerm.freshName();
        let el = DomTerm.makeElement(name, parent, ctype=== "xterminal");
        wrapped = el;
        pane.contentElement = wrapped;
        wrapped.paneInfo = pane;
        wrapped.name = name;
        if (DomTerm.mainTerm && DomTerm._mainWindowNumber >= 0)
            query += `&main-window=${DomTerm._mainWindowNumber}`;
        else
            query += "&main-window=true";
        el.query = query;
        DomTerm.maybeWindowName(el, new URLSearchParams(query));
        if (ctype === "view-saved") {
            DTerminal.loadSavedFile(el, cstate.url);
        } else {
            DomTerm.connectWS(query, pane, el);
        }
    }
    if (wrapped) {
        wrapped.paneNumber = paneNumber;
        if (cstate.windowNumber >= 0)
            wrapped.windowNumber = cstate.windowNumber;
        if (DomTerm.newPaneHook)
            DomTerm.newPaneHook(paneNumber, sessionNumber, wrapped);
    }
    return pane;
}

// This is actually called during the capture phase of a mousedown,
// so we can clear old focus early in the process.
function _handleLayoutClick(ev) {
    for (let el = ev.target; el; el = el.parentElement) {
        const cl = el.classList;
        if (cl.contains("lm_content"))
            return;
        if (cl.contains("lm_header")) {
            DomTermLayout.manager.clearComponentFocus(true);
            return;
        } else if (cl.contains("dt-titlebar")) {
            if (DomTerm.focusedPane) {
                // to force focus to be updated
                DomTermLayout.manager.clearComponentFocus(true);
                DomTermLayout.manager.focusComponent(DomTerm.focusedPane.layoutItem);
            }
            return;
        }
    }
}

DomTermLayout.updateContentSize = function(pane) {
    // Based on updateNodeSize in goldenlayout's component-item.ts.
    // Also takes zoom into account.
    const container = pane.layoutContainer;
    const item = pane.layoutItem;
    const mainZoom = (! DomTerm.isElectron() && ! DomTerm._qtBackend && document.body.zoomFactor) || 1.0;
    const itemZoom = mainZoom * pane.paneZoom();
    const componentElement = container.element;
    const contentElement = DomTerm.useSeparateContentChild()
          ? componentElement.lastChild
          : componentElement;
    if (contentElement instanceof HTMLElement
        && item.parent.type === 'stack') {
        const stackElement = item.parentItem.element;
        let stackBounds;
        const itemElement = item.element;
        const itemBounds = itemElement.getBoundingClientRect();
        const layoutBounds = DomTermLayout.manager.container.getBoundingClientRect();
        if (componentElement instanceof HTMLElement
            && contentElement !== componentElement) {
            stackBounds = stackElement.getBoundingClientRect();
            componentElement.style.top = `${(stackBounds.top - layoutBounds.top) / mainZoom}px`;
            componentElement.style.left = `${(stackBounds.left - layoutBounds.left) / mainZoom}px`;
            componentElement.style.width = `${stackBounds.width / itemZoom}px`;
            componentElement.style.height = `${stackBounds.height / itemZoom}px`;
        } else {
            stackBounds = layoutBounds;
        }
        contentElement.style.position = "absolute";
        contentElement.style.top = `${(itemBounds.top - stackBounds.top) / mainZoom}px`;
        contentElement.style.left = `${(itemBounds.left - stackBounds.left) / itemZoom}px`;
        contentElement.style.width = `${itemBounds.width / itemZoom}px`;
        contentElement.style.height = `${itemBounds.height / itemZoom}px`;
    }
}

DomTermLayout.initialize = function(initialContent = null) {
    function activeContentItemHandler(item) {
        DomTerm.showFocusedPane(item.container.elemen);
    }

    let top = DomTerm.layoutTop || document.body;
    let before = DomTerm.layoutBefore === undefined ? top.firstChild : DomTerm.layoutBefore;
    let lcontent = DomTerm._oldFocusedContent;
    let lparent = lcontent && lcontent.parentElement;
    if (initialContent == null) {
        const newConfig = DomTerm._initialLayoutConfig
              || {
                  type: 'component',
                  componentType: 'domterm',
                  componentState: {}
              };
        initialContent = [ newConfig ];
    }
    const config = Object.assign({}, DomTermLayout.config, { content: initialContent });
    const lmanager = new GoldenLayout(config, top, before);
    DomTermLayout.manager = lmanager;
    let lastContainer = null;

    DomTermLayout.manager.createContainerElement = (manager, config, item) => {
        const type = config.componentType;
        const componentConfig = config.componentState;
        let wnum = componentConfig.windowNumber;
        let element;
        let pane;
        let wrapped;
        let parent = DomTerm.layoutTop;
        if (DomTerm.useToolkitSubwindows && DomTerm.apphooks.adoptPane) {
            element = undefined;
            if (componentConfig.initialized && wnum) { // dropped from elsewhere
                DomTerm.apphooks.adoptPane(Number(wnum));
                DomTerm.mainTerm.reportEvent("WINDOW-MOVED", wnum);
                pane = new PaneInfo(wnum);
            } else {
                pane = DomTermLayout._initPane(componentConfig, type, undefined);
            }
        } else if (lcontent != null) {
            element = lcontent;
            if (lparent && lparent.classList.contains("domterm-wrapper"))
                lparent.classList.add("lm_component");
            const wtitle = ! componentConfig.windowTitle
                  && DomTerm.focusedTerm?.getWindowTitle();
            if (wtitle)
                componentConfig.windowTitle = wtitle;
            lcontent.paneNumber = DomTermLayout._newPaneNumber();
            element = lparent;
            lcontent = null;
        } else {
            if (DomTerm.useSeparateContentChild()) {
                element = document.createElement('div');
                element.classList.add("domterm-wrapper", "lm_component");
                parent.appendChild(element);
                parent = element;
            }
            pane = DomTermLayout._initPane(componentConfig, type, parent);
            element = DomTerm.useSeparateContentChild() ? parent
                : pane.contentElement;
        }
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

    function registerComponent(container, componentConfig) {
        const type = container.componentType;
        let wnum = componentConfig.windowNumber;
        lastContainer = container;
        const pane = DomTerm.paneMap[wnum];
        pane.layoutContainer = container;
        pane.layoutItem = container.parent;
        container.paneInfo = pane;
        componentConfig.initialized = true;
        const content = pane.contentElement;
        if (content) {
            content.classList.add("lm_content");
            content._layoutItem = container.parent;
            DomTerm.showFocusedPane(content);
            if (DomTerm.useSeparateContentChild()) {
                let wrapped = content.parentNode;
                if (typeof wnum === "number")
                    wrapped.windowNumber = wnum;
            }
        }
        const item = container.parent;
        DomTermLayout.updateLayoutTitle(item, componentConfig);
        item.id = `${wnum}`;
        container.stateRequestEvent = () => { return componentConfig; }

        if (DomTerm.useToolkitSubwindows && wnum >= 0) {
            container.virtualVisibilityChangeRequiredEvent = (container, visible) => {
                if (DomTerm.apphooks.showPane) {
                    DomTerm.apphooks.showPane(wnum, visible);
                }
            };
        }
        container.notifyResize = (container, x, y, width, height) => {
            const pane = container.paneInfo;
            if (DomTerm.apphooks.setGeometry) {
                DomTerm.apphooks.setGeometry(wnum, x, y, width, height);
            } else {
                DomTermLayout.updateContentSize(pane);
            }
        };

        container.on("dragMoved", (screenX, screenY, component) => {
            const wX = screenX - DomTermLayout.dragStartOffsetX;
            const wY = screenY - DomTermLayout.dragStartOffsetY;
            if (DomTerm.isElectron())
                electronAccess.ipcRenderer.send("move-window",
                                                { x: Math.round(wX), y: Math.round(wY)} );
            else if (DomTerm.versions.wry)
                ipc.postMessage(`move-window +${Math.round(wX)}+${Math.round(wY)}`);
            else if (DomTerm._qtBackend)
                DomTerm._qtBackend.moveMainWindow(Math.round(wX), Math.round(wY));
        });
        container.on("dragExported", (screenX, screenY, component) => {
            if (DomTermLayout.manager.inSomeWindow) {
                DomTerm.mainTerm.reportEvent("DETACH-WINDOW", component.id);
                if (! DomTerm.useToolkitSubwindows)
                    DomTerm.closeSession(component.container.paneInfo, "export", true);
            } else {
                DomTermLayout.popoutWindow(component, screenX, screenY);
            }
        });

        container.on('destroy', DomTermLayout.onLayoutClosed(container));
        if (top !== document.body) {
            (new ResizeObserver(entries => {
                DomTermLayout.manager.updateSize(); })
            ).observe(top);
        }
        return content;
    }

    DomTermLayout.manager.registerComponent('domterm'/*SHOULD be "dterminal"*/, registerComponent);
    DomTermLayout.manager.registerComponent("xterminal", registerComponent);
    DomTermLayout.manager.registerComponent("browser", registerComponent);
    DomTermLayout.manager.registerComponent("view-saved", registerComponent);

    function checkClick(event) {
        for (var t = event.target; t instanceof Element; t = t.parentNode) {
            if (t.classList.contains("lm_header")) {
                var item = DomTermLayout._elementToLayoutItem(t.parentNode);
                DomTermLayout._selectLayoutPane(item._activeComponentItem, "C");
                return;
            }
        }
    }

    DomTermLayout.manager.init(); // ??
    if (top == document.body) {
        DomTerm._contentSetSize = function(w, h) {
            lmanager.setSize(w, h);
        };
        const lelement = lmanager.root.element;
        DomTerm._contentElement = lelement;
        lmanager.containerWidthAndHeight = () => {
            // compare DomTerm.updateSizeFromBody
            const body = document.body;
            return {
                width: body.offsetWidth - lelement.offsetLeft,
                height: body.offsetHeight - lelement.offsetTop,
            }
        };
        DomTerm.updateSizeFromBody();
    }
    DomTermLayout.manager.on('activeContentItemChanged',
                             activeContentItemHandler);
    DomTermLayout.manager.on('stateChanged',
                             () => {
                                 const rootChildren = DomTermLayout.manager.root.contentItems;
                                 const singleStack = rootChildren.length === 1
                                       && rootChildren[0].type == "stack"
                                       ? rootChildren[0]
                                       : null;
                                 const singleComponent = singleStack
                                       && singleStack.contentItems.length === 1;
                                 if (! DomTerm.addTitlebar)
                                     return;
                                 if (singleStack !== DomTermLayout.singleStack) {
                                     if (DomTermLayout.singleStack) {
                                         if (DomTerm.titlebarInitial && DomTerm.titlebarElement) {
                                             DomTerm.titlebarElement.insertBefore(DomTerm.titlebarInitial, DomTerm.titlebarElement.firstChild);
                                         }
                                         const header = DomTermLayout.singleStack.header;
                                         header.element.classList.remove("dt-titlebar");
                                         header.layoutDefault();
                                         DomTerm.titlebarCurrent = DomTerm.titlebarElement;
                                     }
                                     if (singleStack) {
                                         const header = singleStack.header;
                                         const hel = header.element;
                                         hel.classList.add("dt-titlebar");
                                         DomTerm.titlebarCurrent = hel;
                                         DomTerm.createTitlebar(hel, header.tabsContainerElement);
                                         DomTerm.titlebarElement.style.display = "none";
                                         // change to merged header
                                     } else {
                                         DomTerm.titlebarElement.style.display = "flex";
                                         DomTerm.createTitlebar(DomTerm.titlebarElement, null);
                                     }
                                     DomTermLayout.singleStack = singleStack;
                                     DomTerm.updateSizeFromBody();
                                 }
                             });
    DomTermLayout.manager.on('dragstart',
                             (ev, item) => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 const ratio = window.devicePixelRatio;
                                 const stackBounds = item.parent.element.getBoundingClientRect();
                                 DomTermLayout.dragStartOffsetX =
                                     ratio * (ev.clientX - stackBounds.left);
                                 DomTermLayout.dragStartOffsetY =
                                     ratio * (ev.clientY - stackBounds.top);
                                 if (dt)
                                     dt.reportEvent("DRAG", "start");
                                 if (DomTerm.apphooks.lowerOrRaisePanes) {
                                     DomTerm.apphooks.lowerOrRaisePanes(false, true);
                                 }
                             });
    DomTermLayout.manager.on('dragend',
                             () => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "end");
                                 if (DomTerm.apphooks.lowerOrRaisePanes) {
                                     DomTerm.apphooks.lowerOrRaisePanes(true, true);
                                 }
                             });

    function onDragEvent(eventName, reportName) {
        DomTermLayout.manager.on(eventName,
                                 (e) => {
                                     const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                     if (dt)
                                         dt.reportEvent("DRAG", reportName);
                                 });
    };
    onDragEvent('drag-enter-window', 'enter-window');
    onDragEvent('drag-leave-window', 'leave-window');
    onDragEvent('drop', 'drop');

    document.body.addEventListener("mousedown", _handleLayoutClick, true);
    let root = DomTermLayout.manager.container;
    DomTermLayout.manager.on('focus',
                             (e) => {
                                 const item = e.target;
                                 const oldPane = DomTerm.focusedPane;
                                 const newPane = item.container.paneInfo;
                                 const newWindow = newPane.number;
                                 const widowFocused = DomTerm.focusedTop || DomTerm.focusedChild;
                                 if (DomTerm.focusedChanged || newPane !== oldPane) {
                                     DomTerm.focusedPane = newPane;
                                     if (! DomTerm._menuActive)
                                         DomTerm.focusedWindowNumber = newWindow || 0;
                                     DomTerm.focusedChanged = false;
                                     if (newPane !== oldPane && oldPane)
                                         DomTermLayout.focusPane(oldPane, 0);

                                     if (newPane)
                                     DomTermLayout.focusPane(newPane, 2);
                                 }
                                 if (newPane) {
                                     if (DomTerm.apphooks.focusPane)
                                         DomTerm.apphooks.focusPane(newWindow);
                                     else if (newPane.contentElement.component instanceof HTMLIFrameElement)
                                     newPane.contentElement.focus({preventScroll: true});
                                 }
                             });
    if (lastContainer)
        DomTermLayout._selectLayoutPane(lastContainer.parent, "X");
}

DomTermLayout.initSaved = function(data) {
    if (data.sessionNumber) {
        DomTermLayout.initialize([{ type: 'component',
                                    componentType: 'domterm',
                                    componentState: {sessionNumber: data.sessionNumber}}]);
    } else if (data instanceof Array) {
        DomTermLayout.initialize(data);
    }
}

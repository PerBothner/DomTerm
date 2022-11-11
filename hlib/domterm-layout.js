/* A glue layer for a layout mangager, initially GoldenLayout.
 */

export { DomTermLayout };

import { GoldenLayout, LayoutConfig, ResolvedLayoutConfig, ItemConfig, ResolvedItemConfig, RowOrColumn, Tab } from './goldenlayout.js';

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
                DomTerm.escapeText(title)+' <span class="domterm-windowname">('+DomTerm.escapeText(wname)+')</span>';
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
    let wnum;
    if (element && element.terminal)
        element.terminal.setFocused(focused);
    else if ((wnum = Number(item.id)) >= 0) {
        DomTerm.sendChildMessage(wnum, "set-focused", focused);
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

DomTermLayout.popoutWindow = function(item, fromLayoutEvent = false) {
    const wholeStack = item.type == 'stack';
    // True if dropped to desktop; false if popout-button clicked
    const dragged = !!fromLayoutEvent;
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
        const wnum = itemConfig?.componentState?.windowNumber;
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

    if (fromLayoutEvent instanceof DragEvent
        && fromLayoutEvent.screenX >= 0
        && fromLayoutEvent.screenY >= 0) {
        const wX = fromLayoutEvent.screenX - DomTermLayout.dragStartOffsetX;
        const wY = fromLayoutEvent.screenY - DomTermLayout.dragStartOffsetY;
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
    if (DomTerm.useToolkitSubwindows) {
        DomTerm._qtBackend.closePane(windowNumber);
    }
    const r = DomTermLayout._numberToLayoutItem(windowNumber)
    if (r && ! from_handler) {
        DomTermLayout.selectNextPane(true, windowNumber);
        r.remove();
    }
    if (DomTermLayout.manager.root.contentItems.length == 0)
        DomTerm.windowClose();
    DomTermLayout._pendingPopoutComponents--;
    if (DomTermLayout._pendingPopoutOptions && DomTerm.mainTerm
        && ! DomTermLayout._pendingPopoutComponents) {
        DomTerm.mainTerm.reportEvent("OPEN-WINDOW", JSON.stringify(DomTermLayout._pendingPopoutOptions));
        DomTermLayout._pendingPopoutOptions = undefined;
    }
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
    DomTermLayout.manager.inSomeWindow = entering;
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
    let pane = new PaneInfo(cstate.windowNumber);
    if (DomTerm.useIFrame >= (paneNumber > 1 ? 1 : 2)
        || ctype === 'browser') {
        let url = ctype !== "view-saved" && cstate && cstate.url;
        if (! url) {
            url = DomTerm.paneLocation;
            if (query)
                url += (url.indexOf('#') >= 0 ? '&' : '#') + query;
            if (ctype === "view-saved" && cstate.url)
                url += (url.indexOf('#') >= 0 ? '&' : '#')
                + "view-saved=" +encodeURIComponent(cstate.url);
        }
        if (DomTerm.useToolkitSubwindows && cstate.windowNumber >= 0 /*&& cstate.componentType === 'browser'*/) {
            url = DomTerm.addSubWindowParams(url, cstate.componentType === 'browser'?'B':'T'/*FIXME*/);
            DomTerm._qtBackend.newPane(cstate.windowNumber, url);
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
        let name = DomTerm.freshName();
        let el = DomTerm.makeElement(name, parent);
        wrapped = el;
        pane.contentElement = wrapped;
        wrapped.paneInfo = pane;
        wrapped.name = name;
        if (DomTerm.mainTerm && DomTerm._mainWindowNumber >= 0)
            query += `&main-window=${DomTerm._mainWindowNumber}`;
        else
            query += "&main-window=true";
        el.query = query;
        maybeWindowName(el, new URLSearchParams(query));
        if (ctype === "view-saved") {
            DomTerm.loadSavedFile(el, cstate.url);
        } else {
            DTerminal.connectWS(query, el, null);
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
    const contentElement = container.wrapped;
    const componentElement =
          (contentElement instanceof HTMLElement
           && contentElement.parentNode instanceof HTMLElement
           && contentElement.parentNode.classList.contains("lm_component"))
          ? contentElement.parentNode
          : contentElement;
    if (contentElement instanceof HTMLElement
        && item.parent.type === 'stack') {
        const stackElement = item.parentItem.element;
        const stackBounds = stackElement.getBoundingClientRect();
        const itemElement = item.element;
        const itemBounds = itemElement.getBoundingClientRect();
        const layoutBounds = DomTermLayout.manager.container.getBoundingClientRect();
        if (componentElement instanceof HTMLElement
            && contentElement !== componentElement) {
            componentElement.style.top = `${(stackBounds.top - layoutBounds.top) / mainZoom}px`;
            componentElement.style.left = `${(stackBounds.left - layoutBounds.left) / mainZoom}px`;
            componentElement.style.width = `${stackBounds.width / itemZoom}px`;
            componentElement.style.height = `${stackBounds.height / itemZoom}px`;
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
    if (initialContent == null) {
        const newConfig = DomTerm._initialLayoutConfig
              || {
                  type: 'component',
                  componentType: 'domterm',
                  componentState: {}
              };
        initialContent = [ newConfig ];
    }
    let lparent = lcontent && lcontent.parentElement;
    const config = Object.assign({}, DomTermLayout.config, { content: initialContent });
    const lmanager = new GoldenLayout(config, top, before);
    DomTermLayout.manager = lmanager;
    let lastContainer = null;

    DomTermLayout.manager.createContainerElement = (manager, config) => {
        if (DomTerm.useToolkitSubwindows) {
            return undefined;
        }
        let element;
        if (lparent && lparent.classList.contains("domterm-wrapper")) {
            lparent.classList.add("lm_component");
            element = lparent;
            lparent = null;
        } else {
            element = document.createElement('div');
            DomTerm.layoutTop.appendChild(element);
        }
        return element;
    };
    DomTermLayout.manager.popoutClickHandler = (stack, event) => {
        if (event.ctrlKey) {
            DomTermLayout.popoutWindow(stack, event);
        } else {
            DomTermLayout.popoutWindow(stack.getActiveComponentItem());
        }
        return true;
    }

    function registerComponent(container, componentConfig) {
        const type = container.componentType;
        let wnum = componentConfig.windowNumber;
        lastContainer = container;
        var el;
        let name;
        let wrapped;
        let pane;
        if (DomTerm.useToolkitSubwindows && componentConfig.initialized
           && wnum) { // dropped from elsewhere
            DomTerm._qtBackend.adoptPane(Number(wnum));
            DomTerm.mainTerm.reportEvent("WINDOW-MOVED", wnum);
            pane = new PaneInfo(wnum);
            wrapped = undefined;
        } else if (lcontent != null && type === "domterm") {
            const wtitle = ! componentConfig.windowTitle
                  && DomTerm.focusedTerm?.getWindowTitle();
            if (wtitle)
                componentConfig.windowTitle = wtitle;
            wrapped = lcontent;
            let e = DomTerm._oldFocusedContent;
            pane = DomTerm.focusedPane;
            name = (e && (e.layoutTitle || e.getAttribute("name")))
                || DomTerm.freshName();
            wrapped.paneNumber = DomTermLayout._newPaneNumber();
            lcontent.layoutTitle = undefined; // ???
            lcontent = null;
        } else {
            pane = DomTermLayout._initPane(componentConfig, type, container.element);
            wrapped = pane.contentElement;
        }
        pane.layoutContainer = container;
        pane.layoutItem = container.parent;
        container.paneInfo = pane;
        componentConfig.initialized = true;
        if (wrapped) {
            name = wrapped.name;
            DomTerm.showFocusedPane(wrapped);
            wrapped.classList.add("lm_content");
            wrapped._layoutItem = container.parent;
            if (typeof wnum === "number")
                wrapped.windowNumber = wnum;
        }
        const item = container.parent;
        DomTermLayout.updateLayoutTitle(item, componentConfig);
        item.id = `${wnum}`;
        container.stateRequestEvent = () => { return componentConfig; }

        if (DomTerm.useToolkitSubwindows && wnum >= 0) {
            container.virtualVisibilityChangeRequiredEvent = (container, visible) => {
                if (DomTerm.useToolkitSubwindows) {
                    DomTerm._qtBackend.showPane(wnum, visible);
                }
            };
        }
        container.notifyResize = (container, x, y, width, height) => {
            const pane = container.paneInfo;
            if (DomTerm.useToolkitSubwindows) {
                DomTerm._qtBackend.setGeometry(wnum, x, y, width, height);
            } else {
                DomTermLayout.updateContentSize(pane);
            }
        };

        componentConfig.initialized = true;

        container.on("dragExported", (event, component) => {
            if (DomTermLayout.manager.inSomeWindow) {
                DomTerm.mainTerm.reportEvent("DETACH-WINDOW", component.id);
                if (! DomTerm.useToolkitSubwindows)
                    DomTerm.closeSession(component.container.paneInfo, "export", true);
            } else {
                DomTermLayout.popoutWindow(component, event);
            }
        });

        container.on('destroy', DomTermLayout.onLayoutClosed(container));
        if (top !== document.body) {
            (new ResizeObserver(entries => {
                DomTermLayout.manager.updateSize(); })
            ).observe(top);
        }
        container.wrapped = wrapped;
        return undefined;
    }

    DomTermLayout.manager.registerComponent( 'domterm', registerComponent);
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
                                         createTitlebar(hel, header.tabsContainerElement);
                                         DomTerm.titlebarElement.style.display = "none";
                                         // change to merged header
                                     } else {
                                         DomTerm.titlebarElement.style.display = "flex";
                                         createTitlebar(DomTerm.titlebarElement, null);
                                     }
                                     DomTermLayout.singleStack = singleStack;
                                     DomTerm.updateSizeFromBody();
                                 }
                             });
    DomTermLayout.manager.on('dragstart',
                             (ev, item) => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 const clientRect = item.element.getBoundingClientRect();
                                 DomTermLayout.dragStartOffsetX = ev.clientX - clientRect.left;
                                 DomTermLayout.dragStartOffsetY = ev.clientY - clientRect.top;
                                 if (dt)
                                     dt.reportEvent("DRAG", "start");
                                 if (DomTerm.useToolkitSubwindows) {
                                     DomTerm._qtBackend.lowerOrRaisePanes(false, true);
                                 }
                             });
    DomTermLayout.manager.on('dragend',
                             (e) => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "end");
                                 if (DomTerm.useToolkitSubwindows) {
                                     DomTerm._qtBackend.lowerOrRaisePanes(true, true);
                                 }
                             });

    DomTermLayout.manager.on('drag-enter-window',
                             (e) => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "enter-window");
                             });

    DomTermLayout.manager.on('drag-leave-window',
                             (e) => {
                                 const dt = DomTerm.focusedTerm||DomTerm.mainTerm;
                                 if (dt)
                                     dt.reportEvent("DRAG", "leave-window");
                             });

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
                                     if (DomTerm.useToolkitSubwindows)
                                         DomTerm._qtBackend.focusPane(newWindow);
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

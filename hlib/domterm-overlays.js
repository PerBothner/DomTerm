export { addDragHandler, addInfoDisplay, showMessage, showAboutMessage };

function aboutMessageVariant() {
    if (DomTerm.isElectron()) {
        return '<br/>This frontend uses Electron '
            + DomTerm.versions.electron
            + '.';
    } else if (DomTerm.usingQtWebEngine) {
        return '<br/>This frontend uses QtWebEngine '
            + DomTerm.versions.qtwebengine
            + '.';
    } else if (DomTerm.versions.wry) {
        return '<br/>This frontend uses <a href="https://github.com/tauri-apps/wry">Wry</a> '+DomTerm.versions.wry+'.';
    }
    return "";
}

function aboutMessage() {
    var s = ''; //'<h2>Welcome to DomTerm.</h2>\n';
    s += '<p><b>DomTerm</b> is terminal emulator based on web technologies. ';
    s += 'Features include embedded graphics and html; tabs and sub-windows; detachable session.</p>\n';
    s += '<p>Home page: <a href="https://domterm.org/" target="_blank"><code>https://domterm.org</code></a>.</p>\n';
    s += '<p>DomTerm version '+DomTerm.versionString+'.';
    s += aboutMessageVariant();
    s += '</p>\n';
    s += '<p>Copyright '+DomTerm.copyrightYear+' Per Bothner and others.</p>';
    s += '<script>function handler(event) { if (event.keyCode==27) window.close();} window.addEventListener("keydown", handler);</script>\n';
    return s;
}

function showMessage(title, message) {
    let msg =
        '<div class="dt-overlay-titlebar">'
        + '<span class="dt-close-button">&#x2612;</span>'
        + title
        + '</div><div class="dt-overlay-body">'
        + message + '</div>';
    let popup = document.createElement("div");
    popup.classList.add("dt-popup-panel");
    popup.innerHTML = msg;
    //For some unknown reason, selections work if we use topNode,
    //not not if we use layoutTop or body.
    let parent = DomTerm.layoutTop || document.body;
    parent.appendChild(popup);
    let oldX = 50, oldY = 50;
    popup.style.left = oldX + 'px';
    popup.style.top = oldY + 'px';
    let close;
    let clickHandler = (e) => {
        let n = e.target;
        if (n.classList.contains("dt-close-button")) {
            close();
            return;
        }
        DomTerm.clickLink(e);
    }
    let keydownHandler = (e) => {
        if (e.keyCode == 27) {
            e.preventDefault();
	    e.stopPropagation();
            close();
        }
    };
    let header = popup.querySelector('.dt-overlay-titlebar');
    let updatePosition = (diffX, diffY) => {
        oldX += diffX;
        oldY += diffY;
        popup.style.left = oldX + 'px';
        popup.style.top = oldY + 'px';
    };
    addDragHandler(header, popup, updatePosition, parent);
    close = () => {
        popup.removeEventListener('click', clickHandler);
        parent.removeEventListener('keydown', keydownHandler, true);
        popup.parentNode.removeChild(popup);
        if (DomTerm.useToolkitSubwindows) {
            DomTerm._qtBackend.lowerOrRaisePanes(true, true);
            const wnum = DomTerm.focusedWindowNumber;
            if (wnum > 0)
                DomTerm._qtBackend.focusPane(wnum);
        }
    }
    popup.addEventListener('click', clickHandler);
    parent.addEventListener('keydown', keydownHandler, true);
    popup.addEventListener('keydown', keydownHandler, true);
    if (DomTerm.useToolkitSubwindows)
        DomTerm._qtBackend.lowerOrRaisePanes(false, true);
}

/** Display "About DomTerm" popup.
 *
 * Currently creates panel as floating <div> child of DomTerm.layoutTop.
 * Advantages (compared to new top-level window):
 * - Portable - no permission issues.
 * - Re-direct links to preferred browser (by sending LINK to backend).
 * _ Moving main window moves "About" popup along with it.
 * - Handle Escape key to close.
 * Disadvantages:
 * - Escape key not handled if active window is in an iframe.
 * - Forced to stay with bounds of top-level window.
 * - Close button style does not match main window.
 */
function showAboutMessage() {
    let msg = aboutMessage();
    if (true) {
        showMessage('<h2 style="margin: 0.4ex 0px">About DomTerm</h2>',
                    msg);
    } else if (DomTerm.isElectron()) {
        electronAccess.ipcRenderer
            .send('open-simple-window',
                  {width: 500, height: 400, title: 'About DomTerm', show: false},
                  'data:text/html,'+encodeURIComponent(msg));
    } else {
        let win = window.open("", "About DomTerm",
                              "height=300,width=400"
                              +",left="+(window.screenX+200)
                              +",top="+(window.screenY+200));
        win.document.title = "About DomTerm";
        win.document.body.innerHTML = msg;
    }
}

function addDragHandler(header, widget, updatePosition, topNode) {
    widget.mouseDownHandler = (edown) => {
        let computedZoomStyle =  window.getComputedStyle(header)['zoom'];
        let computedZoom = Number(computedZoomStyle) || 1.0;
        widget.classList.add("dt-moving");
        let oldX = edown.pageX / computedZoom;
        let oldY = edown.pageY / computedZoom;// + this.buffers.scrollTop;
        let mouseHandler = (e) => {
            let x = e.pageX / computedZoom;
            let y = e.pageY / computedZoom;// + this.buffers.scrollTop;
            if (e.type == "mouseup" || e.type == "mouseleave") {
                //widget.mouseDown = undefined;
                if (mouseHandler) {
                    topNode.removeEventListener("mouseup", mouseHandler, false);
                    topNode.removeEventListener("mouseleave", mouseHandler, false);
                    topNode.removeEventListener("mousemove", mouseHandler, false);
                    widget.classList.remove("dt-moving");
                    mouseHandler = undefined;
                    //updatePosition(done);
                }
            }
            let diffX = x - oldX;
            let diffY = y - oldY;
            if (e.type == "mousemove"
                && (Math.abs(diffX) > 0 || Math.abs(diffY) > 0)) {
                updatePosition(diffX, diffY);
                oldX = x;
                oldY = y;
            }
            e.preventDefault();
        };
        topNode.addEventListener("mouseup", mouseHandler, false);
        topNode.addEventListener("mouseleave", mouseHandler, false);
        topNode.addEventListener("mousemove", mouseHandler, false);
        edown.preventDefault();
    };
    header.addEventListener("mousedown", widget.mouseDownHandler, false);
}

function addInfoDisplay(contents, div, dt) {
    // FIXME inconsistent terminology 'widget'
    // Maybe "domterm-show-info" should be "domterm-show-container".
    // Maybe "domterm-info-widget" should be "domterm-info-panel" or "-popup".
    let widget = dt._displayInfoWidget;
    if (widget == null) {
        widget = document.createElement("div");
        widget.setAttribute("class", "domterm-show-info");
        // Workaround for lack of browser support for 'user-select: contain'
        widget.contentEditable = true;

        let header = document.createElement("div");
        header.setAttribute("class", "domterm-show-info-header");
        let close = document.createElement("span");
        header.appendChild(close);
        widget.appendChild(header);

        widget.style["box-sizing"] = "border-box";
        dt._displayInfoWidget = widget;
        let closeAllWidgets = (ev) => {
            for (let panel = widget.firstChild; panel !== null;) {
                let next = panel.nextSibling;
                if (panel.classList.contains("domterm-info-widget"))
                    DomTerm.removeInfoDisplay(panel, dt);
                panel = next;
            }
        }
        let updatePositionOnDrag = (diffX, diffY) => {
            dt._displayInfoYoffset += diffY;
            // if close to top/bottom edge, switch to relative to it
            if (dt._displayInfoYoffset >= 0
                && dt._displayInfoYoffset + widget.offsetHeight > 0.8 * dt.topNode.offsetHeight)
                dt._displayInfoYoffset =
                dt._displayInfoYoffset + widget.offsetHeight - dt.topNode.offsetHeight;
            else if (dt._displayInfoYoffset < 0
                     && widget.offsetHeight - dt._displayInfoYoffset > 0.8 * dt.topNode.offsetHeight)
                dt._displayInfoYoffset =
                dt._displayInfoYoffset - widget.offsetHeight + dt.topNode.offsetHeight;
            DomTerm._positionInfoWidget(widget, dt);
        };
        addDragHandler(header, widget, updatePositionOnDrag, dt.topNode);
        header.addEventListener("mousedown", widget.mouseDownHandler, false);
        close.addEventListener("click", closeAllWidgets, false);
    }
    if (! div)
        div = document.createElement("div");
    div.classList.add("domterm-info-widget");
    // Workaround for lack of browser support for 'user-select: contain'
    div.contentEditable = false;
    if (div.parentNode !== widget)
        widget.appendChild(div);
    if (contents) {
        if (contents.indexOf('<') < 0)
            contents = "<span>" + contents + "</span>";
        div.innerHTML = contents;
    }
    DomTerm._positionInfoWidget(widget, dt);
    return div;
};

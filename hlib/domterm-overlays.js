export { showMessage, showAboutMessage };

function aboutMessageVariant() {
    if (DomTerm.isElectron()) {
        return '<br/>The "frontend" uses Electron '
            + DomTerm.versions.electron
            + '.';
    } else if (DomTerm.versions.wry) {
        return '<br/>The "frontend" uses <a href="https://github.com/tauri-apps/wry">Wry</a> '+DomTerm.versions.wry+'.';
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
    let parent = DomTerm.layoutTop || document.body;
    parent.appendChild(popup);
    popup.style.left = '50px';
    popup.style.top = '50px';
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
    let mouseDownHandler = (e) => {
    }
    close = () => {
        popup.removeEventListener('click', clickHandler);
        parent.removeEventListener('keydown', keydownHandler, true);
        popup.parentNode.removeChild(popup);
    }
    popup.addEventListener('click', clickHandler);
    parent.addEventListener('keydown', keydownHandler, true);
    popup.addEventListener('keydown', keydownHandler, true);
}

function showAboutMessage() {
    if (true) {
        showMessage('<h2 style="margin: 0.4ex 0px">About DomTerm</h2>',
                    aboutMessage());
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

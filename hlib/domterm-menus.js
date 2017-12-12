DomTerm.savedMenuBar = null;

DomTerm.aboutMessage = function() {
    var s = '<h2>Welcome to DomTerm.</h2>\n';
    s += '<p>DomTerm is terminal emulator based on web technologies. ';
    s += 'Features include embedded graphicss and html; tabs and sub-windows; save as html.</p>\n';
    s += '<p>Home page: <a href="http://domterm.org/" target="_blank"><code>http://domterm.org</code></a>.</p>\n';
    s += '<p>DomTerm version '+DomTerm.versionString+'.';
    if (DomTerm.isElectron()) {
        s += ' This variant of DomTerm uses Electron '
            + process.versions.electron
            + ' for the "front-end" and libwebsockets for the "back-end".';
    }
    s += '</p>\n';
    s += '<p>Copyright '+DomTerm.copyrightYear+' Per Bothner and others.</p>';
    s += '<script>function handler(event) { if (event.keyCode==27) window.close();} window.addEventListener("keydown", handler);</script>\n';
    return s;
}

DomTerm.showAboutMessage = function() {
    const {BrowserWindow} = nodeRequire('electron').remote
    let win = new BrowserWindow({width: 500, height: 400,
                                 title: 'About DomTerm', show: false});
    win.setMenu(null)
    win.loadURL('data:text/html,'+encodeURIComponent(DomTerm.aboutMessage()));
    win.show();
}

DomTerm.createElectronMenus = function() {
    const muxPrefix = 'CommandOrControl+Shift+M';
    const {remote} = nodeRequire('electron')
    const {Menu, MenuItem, shell} = remote
    const copyItem = new MenuItem({label: 'Copy', accelerator: 'CommandOrControl+Shift+C',click() {
        if (DomTerm.focusedTerm) DomTerm.focusedTerm.doCopy(); }});
    const pasteItem = new MenuItem({label: 'Paste', accelerator: 'CommandOrControl+Shift+V', role: 'paste' });
    var showingMenuBar = true;
    const showMenuBarItem = new MenuItem({label: 'Show menubar',
                                          type: 'checkbox',
                                          click: function(menuItem, browserWindow, event) { showingMenuBar = ! showingMenuBar; Menu.setApplicationMenu(showingMenuBar ? DomTerm.savedMenuBar : null); },
                                          checked: true});
    const autoPagingItem = new MenuItem({label: 'Automatic Pager',
                                         type: 'checkbox',
                                         click: function() {
                                             DomTerm.toggleAutoPaging(); }});
    const showInspectorItem =
          new MenuItem({label: 'Toggle Developer Tools',
                        accelerator: '',
                        click: function(item, focusedWindow) {
                            if (focusedWindow)
                                focusedWindow.toggleDevTools();
                        }});
    function inputModeClickHandler(menuItem, browserWindow, event) {
        const dt = DomTerm.focusedTerm;
        if (! dt)
            return;
        if (menuItem == cycleInputModesItem)
            dt.nextInputMode();
        else {
            let mode = menuItem == charModeItem ? 99
                : menuItem == lineModeItem ? 108
                : 97;
            dt.setInputMode(mode);
        }
            
    }
    // These are logically radio buttons, but I'm having
    // trouble getting that to work.
    const charModeItem = new MenuItem({label: 'Char mode', type: 'checkbox',
                                       click: inputModeClickHandler});
    const lineModeItem = new MenuItem({label: 'Line mode', type: 'checkbox',
                                       click: inputModeClickHandler});
    const autoModeItem = new MenuItem({label: 'Auto mode', type: 'checkbox',
                                       click: inputModeClickHandler});
    const cycleInputModesItem = new MenuItem({label: 'Cycle input modes',
                                              accelerator: 'Ctrl+Shift+I',
                                              click: inputModeClickHandler});

    const inputMenu = new Menu();
    inputMenu.append(charModeItem);
    inputMenu.append(lineModeItem);
    inputMenu.append(autoModeItem);
    const inputModeMenu = new MenuItem({label: 'Input mode',
                                        submenu: inputMenu});
    const saveAsItem = new MenuItem({label: 'Save as HTML',
                                     accelerator: 'Ctrl+Shift+S',
                                     click: function() {
                                         const dt = DomTerm.focusedTerm;
                                         if (dt)
                                             dt.doSaveAs();
                                     }});


    const quitItem = new MenuItem({label: 'Quit', role: 'quit'});
    const newWindowItem = new MenuItem({label: 'New terminal window',
                                      accelerator: 'Ctrl+Shift+N',
                                      click: function() {
                                          DomTerm.openNewWindow(DomTerm.focusedTerm);
                                      }});
    const newTabItem = new MenuItem({label: 'New terminal tab',
                                      accelerator: 'Ctrl+Shift+T',
                                      click: function() {
                                          DomTerm.layoutAddTab(DomTerm.focusedTerm);
                                      }});
    const newPaneItem = new MenuItem({label: 'New terminal (right/below)',
                                      accelerator: 'Ctrl+Shift+A Enter',
                                      click: function() {
                                          DomTerm.layoutAddSibling(DomTerm.focusedTerm);
                                      }});
    const newTerminalMenu = new Menu();
    newTerminalMenu.append(newWindowItem);
    newTerminalMenu.append(newTabItem);
    newTerminalMenu.append(newPaneItem);
    newTerminalMenu.append(new MenuItem({label: 'New terminal above',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, true, false); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal below',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, true, true); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal left',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, false, false); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal right',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, false, true); }}));
    const newTerminalMenuItem = new MenuItem({label: 'New Terminal',
                                              submenu: newTerminalMenu});
    const detachMenuItem =
          new MenuItem({label: 'Detach session',
                        click: function() { DomTerm.detach(); }});

    const homePageItem = new MenuItem({label: 'DomTerm home page',
                                       click: function() { shell.openExternal('http://domterm.org') }});
    const aboutItem = new MenuItem({label: 'About DomTerm',
                                    click: DomTerm.showAboutMessage});

    const contextMenu = new Menu()
    contextMenu.append(showMenuBarItem);
    contextMenu.append(copyItem);
    contextMenu.append(pasteItem);
    contextMenu.append(inputModeMenu);
    contextMenu.append(autoPagingItem);
    contextMenu.append(newTerminalMenuItem);
    contextMenu.append(detachMenuItem);
    contextMenu.append(showInspectorItem);

    DomTerm.savedMenuBar =
        Menu.buildFromTemplate([{label: 'File',
                                 submenu: [
                                     newWindowItem,
                                     newTabItem,
                                     saveAsItem,
                                     quitItem]},
                                {label: 'Edit',
                                 submenu: [
                                     copyItem,
                                     pasteItem]},
                                {label: 'View',
                                 submenu: [
                                     showMenuBarItem,
                                     {role: 'togglefullscreen'},
                                     {type: 'separator'},
                                     {role: 'resetzoom'},
                                     {role: 'zoomin'},
                                     {role: 'zoomout'},
                                     {type: 'separator'},
                                     showInspectorItem
                                 ]},
                                {label: 'Terminal',
                                 submenu: [
                                     cycleInputModesItem,
                                     newTerminalMenuItem,
                                     detachMenuItem]},
                                {label: 'Help',
                                 submenu: [
                                     aboutItem,
                                     homePageItem]}
                               ]);

    Menu.setApplicationMenu(showMenuBarItem ? DomTerm.savedMenuBar : null);
    window.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        const dt = DomTerm.focusedTerm;
        const mode = dt ? dt.getInputMode() : 0;
        charModeItem.checked = mode == 99;
        lineModeItem.checked = mode == 108;
        autoModeItem.checked = mode == 97;
        autoPagingItem.checked = dt ? dt._autoPaging : false;
        contextMenu.popup(remote.getCurrentWindow())
    }, false)
}

DomTerm.setContextMenu = function() {
    if (DomTerm.isElectron() && ! DomTerm.isAtom()) {
        DomTerm.createElectronMenus();
    }
}

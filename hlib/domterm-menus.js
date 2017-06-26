DomTerm.savedMenuBar = null;

DomTerm.aboutMessage = 'Welcome to DomTerm.<br/>A terminal emulator.';

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
    const newPaneItem = new MenuItem({label: 'New terminal (right/below)',
                                      accelerator: 'Ctrl+Shift+N',
                                      click: function() {
                                          DomTerm.layoutAddSibling(DomTerm.focusedTerm);
                                      }});
    const newTabItem = new MenuItem({label: 'New terminal tab',
                                      accelerator: 'Ctrl+Shift+T',
                                      click: function() {
                                          DomTerm.layoutAddTab(DomTerm.focusedTerm);
                                      }});
    const newTerminalMenu = new Menu();
    newTerminalMenu.append(newTabItem);
    newTerminalMenu.append(newPaneItem);
    newTerminalMenu.append(new MenuItem({label: 'New terminal above',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, true, false); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal below',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, true, true); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal left',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, false, false); }}));
    newTerminalMenu.append(new MenuItem({label: 'New terminal right',
                                         click: function() {
                                             DomTerm.layoutAddSibling(DomTerm.focusedTerm, false, true); }}));
    const newTerminalMenuItem = new MenuItem({label: 'New Terminal',
                                              submenu: newTerminalMenu});

    const homePageItem = new MenuItem({label: 'DomTerm home page',
                                       click: function() { shell.openExternal('http://domterm.org') }});
    /*
    const aboutItem = new MenuItem({label: 'About DomTerm',
                                    click: function() {
                                        var dt = DomTerm.focusedTerm;
                                        dt.modeLineGenerator = function(dt) { return DomTerm.aboutMessage; }; dt._updatePagerInfo();}});
    */

    const contextMenu = new Menu()
    contextMenu.append(showMenuBarItem);
    contextMenu.append(copyItem);
    contextMenu.append(pasteItem);
    contextMenu.append(inputModeMenu);
    contextMenu.append(newTerminalMenuItem);
    contextMenu.append(showInspectorItem);

    DomTerm.savedMenuBar =
        Menu.buildFromTemplate([{label: 'File',
                                 submenu: [
                                     newTabItem,
                                     newPaneItem,
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
                                     newTerminalMenuItem]},
                                {label: 'Help',
                                 submenu: [
                                     //aboutItem,
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
        contextMenu.popup(remote.getCurrentWindow())
    }, false)
}

DomTerm.setContextMenu = function() {
    if (DomTerm.isElectron()) {
        DomTerm.createElectronMenus();
    }
}

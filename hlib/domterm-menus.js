//var { Menu, MenuItem} = require("./mwjs-menu-browser.js");
//import { Menu, MenuItem} from "./mwjs-menu-browser.js";

DomTerm.savedMenuBar = null;

DomTerm.aboutMessageVariant = function() {
    if (DomTerm.isElectron()) {
        return ' This variant of DomTerm uses Electron '
            + DomTerm.versions.electron
            + ' for the "front-end" and libwebsockets for the "back-end".';
    }
    return "";
}

DomTerm.aboutMessage = function() {
    var s = '<h2>Welcome to DomTerm.</h2>\n';
    s += '<p>DomTerm is terminal emulator based on web technologies. ';
    s += 'Features include embedded graphics and html; tabs and sub-windows; detachable session.</p>\n';
    s += '<p>Home page: <a href="https://domterm.org/" target="_blank"><code>https://domterm.org</code></a>.</p>\n';
    s += '<p>DomTerm version '+DomTerm.versionString+'.';
    s += DomTerm.aboutMessageVariant();
    s += '</p>\n';
    s += '<p>Copyright '+DomTerm.copyrightYear+' Per Bothner and others.</p>';
    s += '<script>function handler(event) { if (event.keyCode==27) window.close();} window.addEventListener("keydown", handler);</script>\n';
    return s;
}

DomTerm.showAboutMessage = function() {
    let msg = DomTerm.aboutMessage();
    if (DomTerm.isElectron()) {
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

DomTerm.createMenus = function(options) {
    let platform = options.platform;
    let menuItem = options.menuItem; // DomTerm.makeMenuItem;
    let popup = options.popup;
    let Menu = options.Menu;
    let isElectron = DomTerm.isElectron();
    let electronMenus = platform == "electron";

    function showMenubar(show) {
        if (electronMenus)
            electronAccess.ipcRenderer.send('window-ops', 'set-menubar-visibility', show);
        else
            Menu.setApplicationMenu(show ? DomTerm.savedMenuBar : null);
    }
    const muxPrefix = 'CommandOrControl+Shift+M';
    const copyItem =
          menuItem({label: 'Copy', accelerator: DomTerm.isMac ? 'Cmd+C' : 'Ctrl+Shift+C',
                    clickClientAction: "copy-text"});
    const copyAsHtmlItem =
          menuItem({label: 'Copy as HTML',
                    clickClientAction: "copy-html"});
    const pasteItem =
          menuItem({label: 'Paste', accelerator: DomTerm.isMac ? 'Cmd+V' : 'Ctrl+Shift+V',
                    clickClientAction: "paste-text"});
    var showingMenuBar = true;
    const showMenuBarItem = menuItem({label: 'Show menubar',
                                      type: 'checkbox',
                                      click: function() {
                                          showingMenuBar = ! showingMenuBar;
                                          showMenubar(showingMenuBar);
                                      },
                                      checked: true});
    const autoPagingItem = menuItem({label: 'Automatic Pager',
                                     accelerator: "Ctrl+Shift+M A",
                                     type: 'checkbox',
                                     clickClientAction: 'toggle-auto-pager'});
    // These are logically radio buttons, but I'm having
    // trouble getting that to work.
    const charModeItem = menuItem({label: 'Char mode', type: 'checkbox',
                                   clickClientAction: 'input-mode-char'});
    const lineModeItem = menuItem({label: 'Line mode', type: 'checkbox',
                                   clickClientAction: 'input-mode-line'});
    const autoModeItem = menuItem({label: 'Auto mode', type: 'checkbox',
                                   clickClientAction: 'input-mode-auto'});
    const cycleInputModesItem = menuItem({label: 'Cycle input modes',
                                          accelerator: 'Ctrl+Shift+L',
                                          clickClientAction: 'input-mode-cycle'});

    const inputMenu = new Menu();
    inputMenu.append(charModeItem);
    inputMenu.append(lineModeItem);
    inputMenu.append(autoModeItem);
    const inputModeMenu = menuItem({label: 'Input mode',
                                    submenu: inputMenu});
    const saveAsItem = menuItem({label: 'Save as HTML',
                                 accelerator: 'CommandOrControl+Shift+S',
                                 clickClientAction: 'save-as-html'});

    const quitItem =  electronMenus ? menuItem({label: 'Quit', role: 'quit'})
          : menuItem({label: 'Quit', clickClientAction: 'close-window'});
    const newWindowItem = menuItem({label: 'New terminal window',
                                    accelerator: DomTerm.isMac ? 'Cmd+N' : 'Ctrl+Shift+N',
                                    clickClientAction: 'new-window'});
    const newTabItem = menuItem({label: 'New terminal tab',
                                 accelerator: DomTerm.isMac ? 'Cmd+T' : 'Ctrl+Shift+T',
                                 clickClientAction: 'new-tab'});
    const newPaneItem = menuItem({label: 'New terminal (right/below)',
                                      accelerator: 'Ctrl+Shift+A Enter',
                                  clickClientAction: 'new-pane'});
    const newTerminalMenu = new Menu();
    newTerminalMenu.append(newWindowItem);
    newTerminalMenu.append(newTabItem);
    newTerminalMenu.append(newPaneItem);
    newTerminalMenu.append(menuItem({label: 'New terminal above',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Up',
                                     clickClientAction: 'new-pane-above'}));
    newTerminalMenu.append(menuItem({label: 'New terminal below',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Down',
                                     clickClientAction: 'new-pane-below'}));
    newTerminalMenu.append(menuItem({label: 'New terminal left',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Left',
                                     clickClientAction: 'new-pane-left'}));
    newTerminalMenu.append(menuItem({label: 'New terminal right',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Right',
                                     clickClientAction: 'new-pane-right'}));
    const newTerminalMenuItem = menuItem({label: 'New Terminal',
                                          submenu: newTerminalMenu});
    const detachMenuItem =
          menuItem({label: 'Detach session',
                    clickClientAction: 'detach-session'});
    const resetMenuItem =
          menuItem({label: 'Reset',
                    clickClientAction: "reset-terminal-soft"});
   const homePageItem =
          menuItem({label: 'DomTerm home page',
                    clickClientAction: 'open-domterm-homepage'});
    const aboutItem = menuItem({label: 'About DomTerm',
                                clickClientAction: 'show-about-message'});
    const openLinkItem = menuItem({label: 'Open Link',
                                   clickClientAction: 'open-link'});
    const copyLinkItem = menuItem({label: 'Copy Link Address',
                                   clickClientAction: 'copy-link-address'});
    const copyLinkTextItem =
          menuItem({label: 'Copy', accelerator: DomTerm.isMac ? 'Cmd+C' : 'Ctrl+Shift+C',
                    click() { DomTerm.doContextCopy(); }});
    const copyLinkSep = menuItem({type: 'separator'});

    const contextMenu = new Menu();
    contextMenu.append(showMenuBarItem);
    contextMenu.append(copyItem);
    contextMenu.append(pasteItem);
    contextMenu.append(inputModeMenu);
    contextMenu.append(autoPagingItem);
    contextMenu.append(newTerminalMenuItem);
    contextMenu.append(detachMenuItem);
    const contextLinkMenu = new Menu();
    contextLinkMenu.append(openLinkItem);
    contextLinkMenu.append(copyLinkItem);
    contextLinkMenu.append(copyLinkSep);
    contextLinkMenu.append(showMenuBarItem);
    contextLinkMenu.append(copyLinkTextItem); // not plain copyItem
    contextLinkMenu.append(pasteItem);
    contextLinkMenu.append(inputModeMenu);
    contextLinkMenu.append(autoPagingItem);
    contextLinkMenu.append(newTerminalMenuItem);
    contextLinkMenu.append(detachMenuItem);
    const showInspectorItem = ! isElectron ? null
          : menuItem({label: 'Toggle Developer Tools',
                      accelerator: 'Ctrl+Shift+I',
                      click: function(item, focusedWindow) {
                          if (focusedWindow)
                              focusedWindow.toggleDevTools();
                      }});

    let fileMenu = new Menu();
    fileMenu.append(newWindowItem);
    fileMenu.append(newTabItem);
    fileMenu.append(saveAsItem);
    fileMenu.append(quitItem);
    //let fileMenuItem = menuItem({label: 'File', submenu: fileMenu});
    let editMenu = new Menu();
    editMenu.append(copyItem);
    editMenu.append(copyAsHtmlItem);
    editMenu.append(pasteItem);
    editMenu.append(menuItem({label: 'Clear Buffer',
                              clickClientAction: 'clear-buffer'}));
    editMenu.append(menuItem({label: 'Find',
                              accelerator: 'Ctrl+Shift+F',
                              clickClientAction: 'find-text'}));
    let viewMenu = new Menu();
    viewMenu.append(showMenuBarItem);

    if (electronMenus) {
        viewMenu.append(menuItem({role: 'togglefullscreen'}));
    } else if (typeof screenfull !== "undefined") {
        let fullscreenExitItem;
        let fullscreenAllItem =
            menuItem({label: "Full screen (all)", type: 'checkbox',
                      accelerator: 'F11',
                      clickClientAction: 'toggle-fullscreen'});
        let fullscreenCurrentItem =
            menuItem({label: "Full screen (current)", type: 'checkbox',
                      accelerator: 'Shift-F11',
                      clickClientAction: 'toggle-fullscreen-current-window'});
        fullscreenExitItem = menuItem({label: "Exit full screen",
                                       visible: false, // hidden unless fullscreen
                                       click: function() {
                                           if (screenfull.isFullscreen)
                                               screenfull.exit();
                                           fullscreenExitItem.visible = false;
                                       }});
        if (screenfull.isEnabled) {
            screenfull.on('change', () => {
                fullscreenAllItem.checked = false;
                fullscreenCurrentItem.checked = false;
                if (screenfull.isFullscreen) {
                    fullscreenExitItem.visible = true;
                    Menu.contextMenuParent = screenfull.element;
                    if (screenfull.element && screenfull.element.nodeName == "DIV")
                        fullscreenCurrentItem.checked = true;
                    else
                        fullscreenAllItem.checked = true;
                } else {
                    fullscreenExitItem.visible = false;
                    Menu.contextMenuParent = null;
                }
                showMenuBarItem.enabled = ! fullscreenCurrentItem.checked;
	    });
        }
        viewMenu.append(fullscreenAllItem);
        viewMenu.append(fullscreenCurrentItem);
        contextMenu.append(fullscreenExitItem);
    }

    if (isElectron) {
        viewMenu.append(menuItem({type: 'separator'}));
        viewMenu.append(menuItem({role: 'resetzoom'}));
        viewMenu.append(menuItem({role: 'zoomin'}));
        viewMenu.append(menuItem({role: 'zoomout'}));
        viewMenu.append(menuItem({type: 'separator'}));
    }
    if (showInspectorItem != null)
        viewMenu.append(showInspectorItem);
    let terminalMenu = new Menu();
    terminalMenu.append(cycleInputModesItem);
    terminalMenu.append(newTerminalMenuItem);
    terminalMenu.append(detachMenuItem);
    terminalMenu.append(resetMenuItem);
    let helpMenu = new Menu();
    helpMenu.append(aboutItem);
    if (homePageItem != null)
        helpMenu.append(homePageItem);

    let menuBar = new Menu({ type: 'menubar' });
    menuBar.append(menuItem({label: 'File', submenu: fileMenu}));
    menuBar.append(menuItem({label: 'Edit', submenu: editMenu}));
    menuBar.append(menuItem({label: 'View', submenu: viewMenu}));
    menuBar.append(menuItem({label: 'Terminal', submenu: terminalMenu}));
    menuBar.append(menuItem({label: 'Help', submenu: helpMenu}));
    if (electronMenus)
        menuBar = Menu.buildFromTemplate(menuBar.items);
    else if (isElectron)
        electronAccess.ipcRenderer.send('window-ops', 'set-menubar-visibility', false);
    Menu.setApplicationMenu(menuBar);
    DomTerm.savedMenuBar = menuBar;

    DomTerm.showContextMenu = function(options) {
        DomTerm._contextOptions = options;
        const mode = options.inputMode;
        if (mode) {
            charModeItem.checked = mode == 99;
            lineModeItem.checked = mode == 108;
            autoModeItem.checked = mode == 97;
        }
        autoModeItem.visible = DomTerm.supportsAutoInputMode;
        if (options.autoPaging !== undefined)
            autoPagingItem.checked = options.autoPaging;
        let cmenu = options.contextType=="A" ? contextLinkMenu : contextMenu;
        popup(cmenu, options);
        return true;
    };
}

if (DomTerm.isElectron() ) {
    electronAccess.ipcRenderer.on('do-named-command', (e, command) => {
        DomTerm.doNamedCommand(command);
    });
}

DomTerm.popupMenu = function(items, options) {
    if (DomTerm.isElectron() && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        electronAccess.ipcRenderer.send("show-context-menu", items, options);
    } else if (false && DomTerm.usingQtWebEngine) {
        // TODO
    } else if (! DomTerm.isAtom()) {
        let menu =  DomTerm.makeMenu(items);
        let x = options.x || options.clientX || 0;
        let y = options.y || options.clientY || 0;
        //if (menu.node)
        //    menu.popdown();
        menu.popup(x, y);
    }
}
DomTerm.makeMenu = function(items) {
    if (DomTerm.isElectron() && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        const {Menu, MenuItem} = electronAccess;
        let menu = new Menu();
        for (item of items) {
            menu.append(DomTerm.makeMenuItem(item));
        }
        return menu;
    } else if (false && DomTerm.usingQtWebEngine) {
        // TODO
    } else if (! DomTerm.isAtom()) {
        let menu = new Menu();
        for (item of items) {
            menu.append(DomTerm.makeMenuItem(item));
        }
        return menu;
    }
    return null;
}
DomTerm.makeMenuItem = function(options) {
    if (DomTerm._makeMenuItem)
        return DomTerm._makeMenuItem(options);
    if (DomTerm.isElectron() && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        const {Menu, MenuItem} = electronAccess;
        function menuItem(options) {
            if (options && options.accelerator
                && options.accelerator.indexOf(' ') >= 0)
                options.accelerator = undefined;
            const clickClientAction = options && options.clickClientAction;
            if (clickClientAction) {
                // FIXME FUTURE Handle in main.js, to avoid need for "remote"
                options.click = function() {
                    DomTerm.doNamedCommand(clickClientAction);
                };
                options.clickClientAction = undefined;
            }
            return new MenuItem(options);
        }
        DomTerm._makeMenuItem = menuItem;
        return menuItem(options);
    } else if (false && DomTerm.usingQtWebEngine) {
        // TODO
    } else if (! DomTerm.isAtom()) {
        function menuItem(options) {
            const clickClientAction = options && options.clickClientAction;
            if (clickClientAction) {
                options.click = function() {
                    DomTerm.doNamedCommand(clickClientAction);
                };
                options.clickClientAction = undefined;
            }
            return new MenuItem(options);
        }
        DomTerm._makeMenuItem = menuItem;
        return menuItem(options);
    }
    return null; // ERROR
}

DomTerm.setContextMenu = function() {
    if (DomTerm.isElectron() && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        const {Menu, MenuItem} = electronAccess;
        function popup(cmenu, options) {
            cmenu.popup(options);
        }
        DomTerm.createMenus({platform: "electron",
                             popup: popup,
                             menuItem: DomTerm.makeMenuItem,
                             Menu: Menu
                            });
    } else if (! DomTerm.isAtom() && ! DomTerm.usingQtWebEngine) {
        function popup(cmenu, options) {
            let clientX = options.x || options.clientX || 0;
            let clientY = options.y || options.clientY || 0;
            if (cmenu.node)
                cmenu.popdown();
            cmenu.popup(clientX, clientY);
        }
        DomTerm.createMenus({platform: "generic",
                             popup: popup,
                             menuItem: DomTerm.makeMenuItem,
                             Menu: Menu
                            });
    }
}

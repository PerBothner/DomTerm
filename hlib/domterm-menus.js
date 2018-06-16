DomTerm.savedMenuBar = null;

DomTerm.aboutMessage = function() {
    var s = '<h2>Welcome to DomTerm.</h2>\n';
    s += '<p>DomTerm is terminal emulator based on web technologies. ';
    s += 'Features include embedded graphics and html; tabs and sub-windows; detachable session.</p>\n';
    s += '<p>Home page: <a href="https://domterm.org/" target="_blank"><code>http://domterm.org</code></a>.</p>\n';
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
    let msg = DomTerm.aboutMessage();
    if (DomTerm.isElectron()) {
        const {BrowserWindow} = nodeRequire('electron').remote
        let win = new BrowserWindow({width: 500, height: 400,
                                     title: 'About DomTerm', show: false});
        win.setMenu(null)
        win.loadURL('data:text/html,'+encodeURIComponent(msg));
        win.show();
    } else {
        let win = window.open("", "About DomTerm", 'height=500,width=400');
        win.document.title = "About DomTerm";
        win.document.body.innerHTML = msg;
    }
}

DomTerm.createMenus = function(options) {
    let platform = options.platform;
    let menuItem = options.menuItem;
    let popup = options.popup;
    let Menu = options.Menu;

    const muxPrefix = 'CommandOrControl+Shift+M';
    const copyItem =
          menuItem({label: 'Copy', accelerator: 'CommandOrControl+Shift+C',
                        click() { DomTerm.doCopy(); }});
    const copyAsHtmlItem =
          menuItem({label: 'Copy as HTML',
                    click() { DomTerm.doCopy(true); }});
    const pasteItem = platform == "electron"
          ? menuItem({label: 'Paste', accelerator: 'CommandOrControl+Shift+V',
                      role: 'paste' })
          : menuItem({label: 'Paste', accelerator: 'CommandOrControl+Shift+V',
                      click() { DomTerm.doPaste(); }});
    var showingMenuBar = true;
    const showMenuBarItem = menuItem({label: 'Show menubar',
                                      type: 'checkbox',
                                      click: function() {
                                          showingMenuBar = ! showingMenuBar;
                                          options.showMenubar(showingMenuBar);
                                      },
                                      checked: true});
    const autoPagingItem = menuItem({label: 'Automatic Pager',
                                         type: 'checkbox',
                                         click: function() {
                                             DomTerm.toggleAutoPaging(); }});
    function inputModeClickHandler(menuItem) {
        const dt = DomTerm.focusedTerm;
        if (! dt)
            return;
        console.log("inputModeClickHandler "+menuItem.label);
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
    const charModeItem = menuItem({label: 'Char mode', type: 'checkbox',
                                   click: inputModeClickHandler});
    const lineModeItem = menuItem({label: 'Line mode', type: 'checkbox',
                                   click: inputModeClickHandler});
    const autoModeItem = menuItem({label: 'Auto mode', type: 'checkbox',
                                   click: inputModeClickHandler});
    const cycleInputModesItem = menuItem({label: 'Cycle input modes',
                                          accelerator: 'Ctrl+Shift+L',
                                          click: inputModeClickHandler});

    const inputMenu = new Menu();
    inputMenu.append(charModeItem);
    inputMenu.append(lineModeItem);
    inputMenu.append(autoModeItem);
    const inputModeMenu = menuItem({label: 'Input mode',
                                    submenu: inputMenu});
    const saveAsItem = menuItem({label: 'Save as HTML',
                                 accelerator: 'Ctrl+Shift+S',
                                 click: function() {
                                     const dt = DomTerm.focusedTerm;
                                     if (dt)
                                         dt.doSaveAs();
                                 }});

    const quitItem =  platform == "electron" ? menuItem({label: 'Quit', role: 'quit'})
          : menuItem({label: 'Quit', click: DomTerm.windowClose });
    const newWindowItem = menuItem({label: 'New terminal window',
                                    accelerator: 'Ctrl+Shift+N',
                                    click: function() {
                                        DomTerm.openNewWindow(DomTerm.focusedTerm);
                                    }});
    const newTabItem = menuItem({label: 'New terminal tab',
                                      accelerator: 'Ctrl+Shift+T',
                                      click: function() {
                                          DomTerm.layoutAddTab(DomTerm.focusedTerm);
                                      }});
    const newPaneItem = menuItem({label: 'New terminal (right/below)',
                                      accelerator: 'Ctrl+Shift+A Enter',
                                      click: function() {
                                          DomTerm.layoutAddSibling(DomTerm.focusedTerm);
                                      }});
    const newTerminalMenu = new Menu();
    newTerminalMenu.append(newWindowItem);
    newTerminalMenu.append(newTabItem);
    newTerminalMenu.append(newPaneItem);
    newTerminalMenu.append(menuItem({label: 'New terminal above',
                                     click: function() {
                                         DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, true, false); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal below',
                                     click: function() {
                                         DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, true, true); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal left',
                                     click: function() {
                                         DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, false, false); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal right',
                                     click: function() {
                                         DomTerm.layoutAddSibling(DomTerm.focusedTerm, null, false, true); }}));
    const newTerminalMenuItem = menuItem({label: 'New Terminal',
                                          submenu: newTerminalMenu});
    const detachMenuItem =
          menuItem({label: 'Detach session',
                    click: function() { DomTerm.detach(); }});
    let openLink = options.requestOpenLink;
    const homePageItem = ! openLink ? null
          : menuItem({label: 'DomTerm home page',
                      click: function() { openLink('http://domterm.org') }});
    const aboutItem = menuItem({label: 'About DomTerm',
                                click: DomTerm.showAboutMessage});
    const openLinkItem = menuItem({label: 'Open Link',
                                   click: function(mitem, bwin, ev) {
                                       DomTerm.handleLink(DomTerm._contextLink);
                                   }});
    const copyLinkItem = menuItem({label: 'Copy Link Address',
                                   click: function(mitem, bwin, ev) {
                                       DomTerm.copyLink();
                                   }});
    const copyLinkTextItem =
          menuItem({label: 'Copy', accelerator: 'CommandOrControl+Shift+C',
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
    const showInspectorItem = platform != "electron" ? null
          : menuItem({label: 'Toggle Developer Tools',
                      accelerator: 'Ctrl+Shift+I',
                      click: function(item, focusedWindow) {
                          if (focusedWindow)
                              focusedWindow.toggleDevTools();
                      }});
    if (showInspectorItem != null) {
        contextMenu.append(showInspectorItem);
        contextLinkMenu.append(showInspectorItem);
    }

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

    let viewMenu = new Menu();
    viewMenu.append(showMenuBarItem);

    if (platform=="electron") {
        viewMenu.append(menuItem({role: 'togglefullscreen'}));
    } else if (typeof screenfull !== "undefined") {
        let fullscreenExitItem;
        let fullscreenAllItem = menuItem({label: "Full screen (all)", type: 'checkbox',
                                          click: function() {
                                              console.log("fullscreen "+screenfull.isFullscreen+" en:"+screenfull.enabled);
                                              fullscreenExitItem.visible = true;
                                              if (screenfull.isFullscreen)
                                                  screenfull.exit();
                                              else
                                                  screenfull.request();
                                          }})
        let fullscreenCurrentItem = menuItem({label: "Full screen (current)", type: 'checkbox',
                                              click: function() {
                                                  console.log("fullscreen "+screenfull.isFullscreen+" en:"+screenfull.enabled);
                                                  let dt = DomTerm.focusedTerm;
                                                  let requesting = ! screenfull.isFullscreen;
                                                  if (! requesting) {
                                                      requesting =
                                                          screenfull.element.nodeName != "DIV";
                                                      screenfull.exit();
                                                  }
                                                  if (requesting) {
                                                      fullscreenExitItem.visible = true;
                                                      if (dt)
                                                          screenfull.request(dt.topNode);
                                                      else
                                                          screenfull.request();
                                                  }
                                              }})
        fullscreenExitItem = menuItem({label: "Exit full screen",
                                       visible: false, // hidden unless fullscreen
                                       click: function() {
                                           if (screenfull.isFullscreen)
                                               screenfull.exit();
                                           fullscreenExitItem.visible = false;
                                       }});
        if (screenfull.enabled) {
	    screenfull.on('change', () => {
                fullscreenAllItem.checked = false;
                fullscreenCurrentItem.checked = false;
                if (screenfull.isFullscreen) {
                    Menu.contextMenuParent = screenfull.element;
                    if (screenfull.element && screenfull.element.nodeName == "DIV")
                        fullscreenCurrentItem.checked = true;
                    else
                        fullscreenAllItem.checked = true;
                } else {
                    Menu.contextMenuParent = null;
                }
                showMenuBarItem.enabled = ! fullscreenCurrentItem.checked;
	    });
        }
        viewMenu.append(fullscreenAllItem);
        viewMenu.append(fullscreenCurrentItem);
        contextMenu.append(fullscreenExitItem);
    }

    if (platform=="electron") {
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
    if (platform=="electron") {
        menuBar = Menu.buildFromTemplate(menuBar.items);
    } else {
        window.menuBar = menuBar;
    }
    DomTerm.savedMenuBar = menuBar;
    Menu.setApplicationMenu(showMenuBarItem ? DomTerm.savedMenuBar : null);

    DomTerm.showContextMenu = function(dt, e, contextType) {
        const mode = dt.getInputMode();
        charModeItem.checked = mode == 99;
        lineModeItem.checked = mode == 108;
        autoModeItem.checked = mode == 97;
        autoPagingItem.checked = dt._autoPaging;
        let cmenu = contextType=="A" ? contextLinkMenu : contextMenu;
        popup(cmenu, e);
    };
}

DomTerm.setContextMenu = function() {
    if (DomTerm.isElectron() && ! DomTerm.isAtom()) {
        const {remote} = nodeRequire('electron')
        const {Menu, MenuItem} = remote
        function menuItem(options) {
            return new MenuItem(options);
        }
        function popup(cmenu, e) {
            cmenu.popup(remote.getCurrentWindow());
        }
        DomTerm.createMenus({platform: "electron",
                             popup: popup,
                             menuItem: menuItem,
                             Menu: Menu,
                             requestOpenLink: remote.shell.openExternal,
                             showMenubar: function(show) {
                                 Menu.setApplicationMenu(show ? DomTerm.savedMenuBar : null);
                             }
});
    } else if (! DomTerm.isAtom()
               && ! DomTerm.usingQtWebEngine
               && typeof nwjsMenuBrowser !== 'undefined') {
        function menuItem(options) {
            return new nwjsMenuBrowser.MenuItem(options);
        }
        function popup(cmenu, e) {
            if (! e.ctrlKey && ! e.shiftKey) {
	        e.preventDefault();
	        cmenu.popup(e.clientX, e.clientY);
            }
        }
        DomTerm.createMenus({platform: "nwjs",
                             popup: popup,
                             menuItem: menuItem,
                             Menu: nwjsMenuBrowser.Menu,
                             requestOpenLink: function(url) {
                                 DomTerm.requestOpenLink({href: url});
                             },
                             showMenubar: function(show) {
                                 let m = document.getElementsByClassName('menubar');
                                 if (m.length == 0)
                                     return;
                                 if (show)
                                     m[0].removeAttribute('domterm-hidden');
                                 else
                                     m[0].setAttribute('domterm-hidden', 'true');
                             }
                            });
    }
}

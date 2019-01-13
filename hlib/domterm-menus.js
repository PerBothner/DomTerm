//var { Menu, MenuItem} = require("./mwjs-menu-browser.js");
//import { Menu, MenuItem} from "./mwjs-menu-browser.js";

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

    function showMenubar(show) {
        Menu.setApplicationMenu(show ? DomTerm.savedMenuBar : null);
    }
    const muxPrefix = 'CommandOrControl+Shift+M';
    const copyItem =
          menuItem({label: 'Copy', accelerator: DomTerm.isMac ? 'Cmd+C' : 'Ctrl+Shift+C',
                        click() { DomTerm.doCopy(); }});
    const copyAsHtmlItem =
          menuItem({label: 'Copy as HTML',
                    click() { DomTerm.doCopy(true); }});
    const pasteItem = platform == "electron"
          ? menuItem({label: 'Paste', accelerator: DomTerm.isMac ? 'Cmd+V' : 'Ctrl+Shift+V',
                      role: 'paste' })
          : menuItem({label: 'Paste', accelerator: DomTerm.isMac ? 'Cmd+V' : 'Ctrl+Shift+V',
                      click() { DomTerm.doPaste(); }});
    var showingMenuBar = true;
    const showMenuBarItem = menuItem({label: 'Show menubar',
                                      type: 'checkbox',
                                      click: function() {
                                          showingMenuBar = ! showingMenuBar;
                                          showMenubar(showingMenuBar);
                                      },
                                      checked: true});
    const autoPagingItem = menuItem({label: 'Automatic Pager',
                                         type: 'checkbox',
                                         click: function() {
                                             DomTerm.setAutoPaging("toggle");
                                         }});
    function inputModeClickHandler(menuItem) {
        DomTerm.setInputMode(menuItem == charModeItem ? 99
                             : menuItem == lineModeItem ? 108
                             : menuItem == autoModeItem ? 97
                             : 0);
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
                                 accelerator: 'CommandOrControl+Shift+S',
                                 click: function() {
                                     DomTerm.doSaveAs();
                                 }});

    const quitItem =  platform == "electron" ? menuItem({label: 'Quit', role: 'quit'})
          : menuItem({label: 'Quit', click: DomTerm.windowClose });
    const newWindowItem = menuItem({label: 'New terminal window',
                                    accelerator: DomTerm.isMac ? 'Cmd+N' : 'Ctrl+Shift+N',
                                    click: function() {
                                        DomTerm.openNewWindow(DomTerm.focusedTerm);
                                    }});
    const newTabItem = menuItem({label: 'New terminal tab',
                                      accelerator: DomTerm.isMac ? 'Cmd+T' : 'Ctrl+Shift+T',
                                      click: function() {
                                          DomTerm.layoutAddTab(DomTerm.focusedTerm);
                                      }});
    const newPaneItem = menuItem({label: 'New terminal (right/below)',
                                      accelerator: 'Ctrl+Shift+A Enter',
                                      click: function() {
                                          DomTerm.newPane(1);
                                      }});
    const newTerminalMenu = new Menu();
    newTerminalMenu.append(newWindowItem);
    newTerminalMenu.append(newTabItem);
    newTerminalMenu.append(newPaneItem);
    newTerminalMenu.append(menuItem({label: 'New terminal above',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Up',
                                     click: function() {
                                         DomTerm.newPane(12); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal below',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Down',
                                     click: function() {
                                         DomTerm.newPane(13); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal left',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Left',
                                     click: function() {
                                         DomTerm.newPane(10); }}));
    newTerminalMenu.append(menuItem({label: 'New terminal right',
                                     accelerator: 'Ctrl+Shift+A Ctrl+Right',
                                     click: function() {
                                         DomTerm.newPane(11); }}));
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
    editMenu.append(menuItem({label: 'Clear Buffer',
                              click:
                              function() {
                                  DomTerm.commandMap['clear-buffer']
                                  (DomTerm.focusedTerm, null)
                              }}));
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
    }
    DomTerm.savedMenuBar = menuBar;
    showMenubar(showMenuBarItem);

    DomTerm.showContextMenu = function(options) {
        const mode = options.inputMode;
        if (mode) {
            charModeItem.checked = mode == 99;
            lineModeItem.checked = mode == 108;
            autoModeItem.checked = mode == 97;
        }
        if (options.autoPaging !== undefined)
            autoPagingItem.checked = options.autoPaging;
        let cmenu = options.contextType=="A" ? contextLinkMenu : contextMenu;
        popup(cmenu, options);
        return true;
    };
}

DomTerm.setContextMenu = function() {
    if (DomTerm.isElectron() && ! DomTerm.isAtom()) {
        const {remote} = nodeRequire('electron')
        const {Menu, MenuItem} = remote
        function menuItem(options) {
            return new MenuItem(options);
        }
        function popup(cmenu, options) {
            cmenu.popup(remote.getCurrentWindow());
        }
        DomTerm.createMenus({platform: "electron",
                             popup: popup,
                             menuItem: menuItem,
                             Menu: Menu,
                             requestOpenLink: remote.shell.openExternal
                            });
    } else if (! DomTerm.isAtom() && ! DomTerm.usingQtWebEngine) {
        function menuItem(options) {
            return new MenuItem(options);
        }
        function popup(cmenu, options) {
            let clientX = options.clientX || 0;
            let clientY = options.clientY || 0;
            if (cmenu.node)
                cmenu.popdown();
            cmenu.popup(clientX, clientY);
        }
        DomTerm.createMenus({platform: "generic",
                             popup: popup,
                             menuItem: menuItem,
                             Menu: Menu,
                             requestOpenLink: function(url) {
                                 DomTerm.requestOpenLink({href: url});
                             }
                            });
    }
}

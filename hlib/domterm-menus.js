DomTerm.createMenus = function(options) {
    let platform;
    if (DomTerm.isAtom())
        return;
    else if (DomTerm.usingJsMenus())
        platform = "generic";
    else if (DomTerm.isElectron())
        platform = "electron";
    else if (DomTerm.usingQtWebEngine)
        platform = "qt";
else
        return;
    let menuItem = DomTerm.makeMenuItem;
    let isElectron = DomTerm.isElectron();
    let electronMenus = platform == "electron" && ! DomTerm._savedMenuBar;

    function showMenubar(show) {
        if (electronMenus)
            electronAccess.ipcRenderer.send('window-ops', 'set-menubar-visibility', show);
        else if (platform === "qt")
            DomTerm._qtBackend.showMenubar(show);
        else {
            if (! DomTerm.subwindows
                && DomTerm._savedMenubarParent
                && DomTerm._savedMenubarParent.classList.contains("dt-titlebar-prefix")) {
                DomTerm._savedMenubarParent.parentNode.style.display =
                    show ? "" : "none";
            }
            Menu.setApplicationMenu(show ? DomTerm._savedMenuBar : null,
                                    DomTerm._savedMenubarParent,
                                    DomTerm._savedMenubarBefore);
            DomTerm.updateSizeFromBody();
        }
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
                                      clickClientAction: 'toggle-menubar',
                                      checked: true});
    DomTerm.toggleMenubar = function() {
        showingMenuBar = ! showingMenuBar;
        showMenubar(showingMenuBar);
    }
    const autoPagingItem = menuItem({label: 'Automatic Pager',
                                     accelerator: ["Ctrl+Shift+M", "A"],
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

    const inputMenu = DomTerm.makeMenu([
        charModeItem, lineModeItem, autoModeItem ]);
    const inputModeMenu = menuItem({label: 'Input mode', type: 'radio',
                                    submenu: inputMenu});
    const saveAsItem = menuItem({label: 'Save as HTML',
                                 accelerator: 'CommandOrControl+Shift+S',
                                 clickClientAction: 'save-as-html'});

    const quitItem =  menuItem({label: 'Quit',
                                accelerator: DomTerm.isMac ? 'Cmd+Q' : 'CommandOrControl+Shift+Q',
                                clickClientAction: 'quit-domterm' });
    const closeItem = menuItem({label: 'Close session',
                                accelerator: DomTerm.isMac ? 'Cmd+W' : 'CommandOrControl+Shift+W',
                                clickClientAction: 'close-pane'});
    const newWindowItem = menuItem({label: 'New terminal window',
                                    accelerator: DomTerm.isMac ? 'Cmd+N' : 'Ctrl+Shift+N',
                                    clickClientAction: 'new-window'});
    const newTabItem = menuItem({label: 'New terminal tab',
                                 accelerator: DomTerm.isMac ? 'Cmd+T' : 'Ctrl+Shift+T',
                                 clickClientAction: 'new-tab'});
    const newPaneItem = menuItem({label: 'New terminal (right/below)',
                                  accelerator: ['Ctrl+Shift+A', 'Enter'],
                                  clickClientAction: 'new-pane'});
    const newTerminalMenu = DomTerm.makeMenu([
        newWindowItem,
        newTabItem,
        newPaneItem,
        menuItem({label: 'New terminal above',
                  accelerator: ['Ctrl+Shift+A', 'Ctrl+Up'],
                  clickClientAction: 'new-pane-above'}),
        menuItem({label: 'New terminal below',
                  accelerator: ['Ctrl+Shift+A', 'Ctrl+Down'],
                  clickClientAction: 'new-pane-below'}),
        menuItem({label: 'New terminal left',
                  accelerator: ['Ctrl+Shift+A', 'Ctrl+Left'],
                  clickClientAction: 'new-pane-left'}),
        menuItem({label: 'New terminal right',
                  accelerator: ['Ctrl+Shift+A', 'Ctrl+Right'],
                  clickClientAction: 'new-pane-right'})
    ]);
    const newTerminalMenuItem = menuItem({label: 'New Terminal',
                                          type: 'submenu',
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
                    clickClientAction: 'copy-in-context'});
    const copyLinkSep = menuItem({type: 'separator'});
    const fullscreenExitItem =
        // Note that electron/main.js checks for this specific label.
        menuItem({label: "Exit full screen",
                  visible: false, // hidden unless fullscreen
                  clickClientAction: 'exit-fullscreen'});
    const contextMenu = DomTerm.makeMenu([
        showMenuBarItem,
        copyItem,
        pasteItem,
        inputModeMenu,
        autoPagingItem,
        newTerminalMenuItem,
        detachMenuItem,
        fullscreenExitItem
    ]);
    const contextLinkMenu = DomTerm.makeMenu([
        openLinkItem,
        copyLinkItem,
        copyLinkSep,
        showMenuBarItem,
        copyLinkTextItem, // not plain copyItem
        pasteItem,
        inputModeMenu,
        autoPagingItem,
        newTerminalMenuItem,
        detachMenuItem,
        fullscreenExitItem
    ]);
    const showInspectorItem = ! window._dt_toggleDeveloperTools ? null
          : menuItem({label: 'Toggle Developer Tools',
                      accelerator: DomTerm.isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                      clickClientAction: 'toggle-developer-tools'});
    let fileMenu = DomTerm.makeMenu([
        newWindowItem,
        newTabItem,
        saveAsItem,
        closeItem,
        quitItem
    ]);
    let editMenu = DomTerm.makeMenu([
        copyItem,
        copyAsHtmlItem,
        pasteItem,
        menuItem({label: 'Clear Buffer',
                  clickClientAction: 'clear-buffer'}),
        menuItem({label: 'Find',
                  accelerator: 'Ctrl+Shift+F',
                  clickClientAction: 'find-text'})
    ]);
    let viewMenuItems = [];
    viewMenuItems.push(showMenuBarItem);
    if (electronMenus) {
        viewMenuItems.push(menuItem({role: 'togglefullscreen'}));
    } else if (typeof screenfull !== "undefined") {
        let fullscreenAllItem =
            menuItem({label: "Full screen (all)", type: 'checkbox',
                      accelerator: 'F11',
                      clickClientAction: 'toggle-fullscreen'});
        let fullscreenCurrentItem =
            menuItem({label: "Full screen (current)", type: 'checkbox',
                      accelerator: 'Shift-F11',
                      clickClientAction: 'toggle-fullscreen-current-window'});
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
        viewMenuItems.push(fullscreenAllItem);
        viewMenuItems.push(fullscreenCurrentItem);
    }
    viewMenuItems.push(menuItem({type: 'separator'}));

    viewMenuItems.push(menuItem({label: "Zoom In (all)",
                                 accelerator: DomTerm.isMac ? "Cmd++" : "Ctrl++",
                                 clickClientAction: "window-zoom-in"}));
    viewMenuItems.push(menuItem({label: "Zoom Out (all)",
                                 accelerator: DomTerm.isMac ? "Cmd+-" : "Ctrl+-",
                                 clickClientAction: "window-zoom-out"}));
    viewMenuItems.push(menuItem({label: "Zoom Reset (all)",
                                 accelerator: DomTerm.isMac ? "Cmd+0" : "Ctrl+0",
                                 clickClientAction: "window-zoom-reset"}));
    viewMenuItems.push(menuItem({label: "Zoom In (pane)",
                                 accelerator: DomTerm.isMac ? "Alt+Cmd++" : "Alt+Ctrl++",
                                 clickClientAction: "pane-zoom-in"}));
    viewMenuItems.push(menuItem({label: "Zoom Out (pane)",
                                 accelerator: DomTerm.isMac ? "Alt+Cmd+-" : "Alt+Ctrl+-",
                                 clickClientAction: "pane-zoom-out"}));
    viewMenuItems.push(menuItem({label: "Zoom Reset (pane)",
                                 accelerator: DomTerm.isMac ? "Alt+Cmd+0" : "Alt+Ctrl+0",
                                 clickClientAction: "pane-zoom-reset"}));

    if (showInspectorItem != null) {
        viewMenuItems.push(menuItem({type: 'separator'}));
        viewMenuItems.push(showInspectorItem);
    }
    let terminalMenu = DomTerm.makeMenu([
        cycleInputModesItem,
        newTerminalMenuItem,
        detachMenuItem,
        resetMenuItem
    ]);
    let helpMenu = DomTerm.makeMenu([
        aboutItem, homePageItem
    ]);
    let menuBarItems = [
        menuItem({label: 'File', submenu: fileMenu}),
        menuItem({label: 'Edit', submenu: editMenu}),
        menuItem({label: 'View', submenu: DomTerm.makeMenu(viewMenuItems)}),
        menuItem({label: 'Terminal', submenu: terminalMenu}),
        menuItem({label: 'Help', submenu: helpMenu})
    ];
    //let hamburgerChar = "\u2261";
    let hamburgerChar = "\u2630";
    let hamburgerMenuItems = [
        menuItem({label: hamburgerChar, submenu: menuBarItems})
    ];
    let menuBar;
    if (electronMenus) {
        electronAccess.ipcRenderer.send('set-application-menu', menuBarItems);
    } else if (platform !== "qt") {
        //menuBar = new Menu({ type: 'menubar' }, hamburgerMenuItems);
        menuBar = new Menu({ type: 'menubar' }, menuBarItems);
        if (isElectron)
            electronAccess.ipcRenderer.send('window-ops', 'set-menubar-visibility', false);
        DomTerm._savedMenuBar = menuBar;
        if (! DomTerm._savedMenubarParent) {
            const parent = document.body;
            DomTerm._savedMenubarParent = parent;
            DomTerm._savedMenubarBefore = parent.firstElementChild;
        }
        let menuCount = 0;
        Menu.showMenuNode = function(menu, menuNode, width, height, base_x, base_y, x, y) {
            /* // FUTURE (requires being able to position popup windows,
            // which is an issue on Wayland - plus more work)
            const moptions = {};
            let mtext = menuNode.outerHTML;
            moptions.url = `data:text/html,<html><head>
<base href="${location.origin}/"/>
<link type="text/css" rel="stylesheet" href="hlib/jsMenus.css"/>
<script type="text/javascript" src="hlib/jsMenus.js"></script>
</head>
<body><hr/>${mtext}</body></head>`;
            moptions.width = width;
            moptions.height = height;
            moptions.titlebar = "none";
            moptions.position = `+${base_x}+${base_y}`;
            DomTerm.openNewWindow(null, moptions);
            */
            const mcount = menuCount++;
            if (DomTerm.useToolkitSubwindows && mcount == 0) {
                DomTerm._qtBackend.lowerOrRaisePanes(false, true);
            }
            DomTerm._focusMenu();
            DomTerm._menuActive = true;
            return false;
        };
        Menu.hideMenuNode = function(menu, menuNode) {
            if (--menuCount <= 0) {
                const layout = DomTerm._layout;
                const wnum = DomTerm._contextOptions?.windowNumber
                      || DomTerm.focusedWindowNumber;
                if (DomTerm.useToolkitSubwindows) {
                    DomTerm._qtBackend.lowerOrRaisePanes(true, true);
                    if (wnum > 0)
                        DomTerm._qtBackend.focusPane(wnum);
                } else if (layout && wnum > 0) {
                    layout._selectLayoutPane(layout._numberToLayoutItem(wnum));
                }
                DomTerm._menuActive = false;
            }
        };
        Menu.menuDone = function(menuItem) {
            DomTerm._contextOptions = undefined;
        }
        showMenubar(true);
    }

    DomTerm.showContextMenu = function(options) {
        const mode = options.inputMode;
        if (mode) {
            charModeItem.checked = mode == 99;
            lineModeItem.checked = mode == 108;
            autoModeItem.checked = mode == 97;
        }
        showMenuBarItem.checked = showingMenuBar;
        autoModeItem.visible = DomTerm.supportsAutoInputMode;
        fullscreenExitItem.visible = screenfull.isFullscreen;
        if (options.autoPaging !== undefined)
            autoPagingItem.checked = options.autoPaging;
        let cmenu = options.contextType=="A" ? contextLinkMenu : contextMenu;
        DomTerm.popupMenu(cmenu, options);
        return true;
    };
}

if (DomTerm.isElectron() ) {
    electronAccess.ipcRenderer.on('do-named-command', (e, command) => {
        DomTerm.doNamedCommand(command);
    });
}

DomTerm._focusMenu = function() {
    if (DomTerm.useToolkitSubwindows)
        DomTerm._qtBackend.focusPane(-1);
    else if (document.activeElement instanceof HTMLIFrameElement)
        Menu._menubarNode?.focus({preventScroll: true});
}

DomTerm.focusMenubar = function() {
    if (! Menu.focusMenubar)
        return false;
    DomTerm._focusMenu();
    Menu.focusMenubar();
    return true;
}

DomTerm.popupMenu = function(menu, options) {
    if (DomTerm.isElectron() && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        electronAccess.ipcRenderer.send("show-context-menu", menu, options);
    } else if (! DomTerm.isAtom()) {
        let x = options.x || options.clientX || 0;
        let y = options.y || options.clientY || 0;
        if (menu.node)
            menu.popdown();
        menu.popup(x, y);
        DomTerm._focusMenu();
    }
}
DomTerm.makeMenu = function(items) {
    if (items instanceof Menu)
        return items;
    if ((DomTerm.isElectron()  || DomTerm.usingQtWebEngine)
        && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        return items;
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
    if (options instanceof MenuItem)
        return options;
    if (DomTerm._makeMenuItem)
        return DomTerm._makeMenuItem(options);
    if ((DomTerm.isElectron() || DomTerm.usingQtWebEngine)
        && ! DomTerm.usingJsMenus() && ! DomTerm.isAtom()) {
        function menuItem(options) {
            return options;
        }
        DomTerm._makeMenuItem = menuItem;
        return menuItem(options);
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

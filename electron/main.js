const {app, ipcMain, BrowserWindow, screen, dialog, Menu} = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs')

// Keep a global reference of the window objects, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windowList = new Array();

function createInitialWindow (argv) {
    // options = yargs(process.argv[1..]).wrap(100)
    // and load the index.html of the app.
    let argc = argv.length;
    let options = { };
    let headless = false;
    var url = "http://localhost:7033/#ws=same";
    var geometry = null;
    for (let i = 2; i < argc; i++) {
        let arg = argv[i];
        if (arg == "--devtools")
            options.openDevTools = true;
        else if (arg == "--headless")
            headless = true;
        else if (arg == "--titlebar" && i+1 < argc)
            options.titlebar = argv[++i];
        else if (arg == "--window-number" && i+1 < argc)
            options.windowNumber = Number(argv[++i]);
        else if (arg == "--url" && i+1 < argc)
            url = argv[++i];
        else if (arg == "--geometry" && i+1 < argc)
            geometry = argv[++i];
        else
            console.log("arg#"+i+": "+JSON.stringify(argv[i]));
    }

    // Create the browser window.
    if (geometry) {
        let hasSize = -1, hasPos = -1;
        let m = geometry.match(/^([0-9]+)x([0-9]+)$/);
        if (m) {
            hasSize = 0;
        } else if ((m = geometry.match(/^([-+][0-9]+[-+][0-9]+)$/))) {
            hasPos = 0;
        } else if ((m = geometry.match(/^([0-9]+)x([0-9]+)([-+][0-9]+[-+][0-9]+)$/))) {
            hasSize = 0;
            hasPos = 2;
        }
        if (hasSize >= 0) {
            options.width = Number(m[1]);
            options.height = Number(m[2]);
        }
        if (hasPos >= 0) {
            options.position = m[hasPos+1];
        }
    }
    openNewWindow(url, options, headless);
}
var previousUrl = null;
var previousWidth = 800;
var previousHeight = 600;

function openNewWindow (url, options, headless) {
    if (! url)
        url = previousUrl;
    else
        previousUrl = url;

    // Check if this is a 'file://.../start-WNUM.html' bridge URL from DomTerm
    // (used to make sure browser has read permission to user's files).
    // If so, read the file to extract the real url.
    // This avoids issues with file URLs - and might be slightly faster.
    let m = url.match("^file://(.*/start[^/]*.html)$");
    if (m) {
        fs.readFile(m[1], "utf-8", (err, data) => {
            if (! err) {
                let mloc = data.match(/location.replace.'([^']*)'.;/);
                if (mloc)
                    url = mloc[1];
            }
            createNewWindow(url, options, headless);
        });
    } else {
        createNewWindow(url, options, headless);
    }
}

function createNewWindow (url, options, headless)
{
    let w = options.width;
    let h = options.height;
    if (w <= 0)
        w = previousWidth;
    else
        previousWidth = w;
    if (h <= 0)
        h = previousHeight;
    else
        previousHeight = h;
    let frame = options.titlebar && options.titlebar === "system";
    let bwoptions = {
        width: w, height: h,
        webPreferences: {contextIsolation: false, worldSafeExecuteJavaScript: false, enableRemoteModule: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js')},
        useContentSize: true,
        frame: frame, transparent: !frame,
        show: false};
    if (process.platform === 'darwin' && ! frame) {
        bwoptions.titleBarStyle = "hidden";
        bwoptions.trafficLightPosition = { x: 8, y: 5 };
    }
    if (options.x !== undefined && options.y !== undefined) {
        bwoptions.x = options.x;
        bwoptions.y = options.y;
    } else if (options.position) {
        let negx = false, negy = false;
        let m = options.position.match(/^([-+])([0-9][0-9]*)([-+])([0-9][0-9]*)$/);
        if (m) {
            x = Number(m[2]);
            y = Number(m[4]);
            negx = m[1] === '-';
            negy = m[3] === '-';
            if (negx || negy) {
                let cursor = screen.getCursorScreenPoint();
                let display =
                    (cursor && screen.getDisplayNearestPoint(cursor))
                    || screen.getPrimaryDisplay();
                let area = display.workArea;
                if (negx)
                    x = area.x + area.width - x - w;
                if (negy)
                    y = area.y = area.height - y - h;
            }
            if (x >= 0 && y >= 0) {
                bwoptions.x = x;
                bwoptions.y = y;
            }
        }
    }
    if (process.platform == "win32")
	bwoptions.icon = __dirname.replace("\\electron", "\\domterm2.ico");
    let win = new BrowserWindow(bwoptions);
    const wnum = options.windowNumber;
    windowList.push(win);
    win.loadURL(url);
    if (options.openDevTools)
        win.webContents.openDevTools()
    if (! headless)
        win.once('ready-to-show', function () { win.show(); });
    win.on('closed', () => {
        process.stdout.write("CLOSE-WINDOW "+wnum+"\n");
        let index = windowList.indexOf(win);
        if (index >= 0)
            windowList.splice(index, 1);
    });
}

function eventToWindow(event) {
    return BrowserWindow.fromWebContents(event.sender);
}

function logToBrowserConsole(window, message) { // FOR DEBUGGING
    window.send('log-to-browser-console', message);
}

ipcMain.on('window-ops', (event, command, arg) => {
    let win;
    switch (command) {
    case 'new-window':
        if (! arg.width || ! arg.height) {
            let sz = eventToWindow(event).getContentSize();
            arg = Object.assign({ width: sz[0], height: sz[1] }, arg);
        }
        openNewWindow(arg.url, arg, false);
        break;
    case 'hide':
        eventToWindow(event).hide();
        break;
    case 'show':
        eventToWindow(event).show();
        break;
    case 'minimize':
        eventToWindow(event).minimize();
        break;
    case 'toggle-devtools':
        eventToWindow(event).toggleDevTools();
        break;
    case 'fullscreen':
        win = eventToWindow(event);
        arg = arg === 'toggle' ? ! win.isFullScreen()
            : arg && arg !== 'false' && arg !== 'off' && arg !== 'no';
        win.setFullScreen(arg == 'toggle' ? ! win.isFullScreen() : arg);
        break;
    case 'set-menubar-visibility':
        eventToWindow(event).setMenuBarVisibility(arg);
        break;
    }
});

function fixMenuItems(items, win = null) {
    return items.map((item) => {
        const clickClientAction = item.clickClientAction;
        if (clickClientAction) {
            item.click = function(menuItem, browserWindow, event) {
                browserWindow.send('do-named-command', clickClientAction);
            };
            item.clickClientAction = undefined;
        }
        if (win && item.visible === false && item.label == "Exit full screen")
            item.visible = win.isFullScreen()
        if (item.accelerator && item.accelerator.indexOf(' ') >= 0)
            item.accelerator = undefined;
        if (item.submenu)
            item.submenu = fixMenuItems(item.submenu, win);
        return item;
    });
}

ipcMain.on('set-application-menu', (event, template) => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(fixMenuItems(template)));
});

ipcMain.on('move-window', (event, rect) => {
    let win = BrowserWindow.fromWebContents(event.sender);
    win.setBounds(rect);
})

ipcMain.on('show-context-menu', (event, items, options) => {
    let win = BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.buildFromTemplate(fixMenuItems(items, win));
    let oarg = {window: win };
    if (options.x !== undefined && options.y !== undefined) {
        oarg.x = Math.round(options.x);
        oarg.y = Math.round(options.y);
    }
    menu.popup(oarg);
});

ipcMain.on('open-simple-window', (event, options, url) => {
    let win = new BrowserWindow(options);
    win.setMenu(null);
    win.loadURL(url);
    win.show();
});

ipcMain.handle('open-dialog', async (event, kind, options) => {
    return await dialog.showSaveDialog(options);
});

ipcMain.handle('save-file', async (event, options, data) => {
    dialog.showSaveDialog(options).then((value) => {
        let filePath = value.filePath;
        if (filePath)
            fs.writeFile(filePath, data, function (err) {
                if (err)
                    alert("An error ocurred creating the file "+ err.message);
            });
    });
});

ipcMain.handle('messagebox', async (event, options) => {
    let moptions = { };
    moptions.message = options.message;
    if (options.title)
        moptions.title = options.title;
    if (options.detail)
        moptions.detail = options.detail;
    if (options.initialFocus)
        moptions.defaultId = options.initialFocus;
    if (options.buttons) {
        const mbuttons = [];
        for (const button of options.buttons) {
            mbuttons.push(button.text);
        }
        moptions.buttons = mbuttons;
    }
    return dialog.showMessageBox(eventToWindow(event), moptions)
        .then((value) => options.buttons[value.response].value);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', (launchInfo) => {
    if (app.requestSingleInstanceLock()) {
        let argv = process.argv;
        createInitialWindow(argv);
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            createInitialWindow(commandLine);
        });
    } else
        app.quit();
});


// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (windowList.length == 0) {
      createInitialWindow(process.argv);
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

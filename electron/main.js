const {app, ipcMain, BrowserWindow, screen} = require('electron')
const path = require('path')
const url = require('url')

// Keep a global reference of the window objects, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windowList = new Array();

function createInitialWindow (argv) {
    // options = yargs(process.argv[1..]).wrap(100)
    // and load the index.html of the app.
    let argc = argv.length;
    let openDevTools = false;
    let headless = false;
    var url = "http://localhost:7033/#ws=same";
    var geometry = null;
    for (let i = 2; i < argc; i++) {
        let arg = argv[i];
        if (arg == "--devtools")
            openDevTools = true;
        else if (arg == "--headless")
            headless = true;
        else if (arg == "--url" && i+1 < argc)
            url = argv[++i];
        else if (arg == "--geometry" && i+1 < argc)
            geometry = argv[++i];
        else
            console.log("arg#"+i+": "+JSON.stringify(argv[i]));
    }

    // Create the browser window.
    let options = { openDevTools: openDevTools};
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
    createNewWindow(url, options, headless);
}
var previousUrl = null;
var previousWidth = 800;
var previousHeight = 600;

function createNewWindow (url, options, headless) {
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
    if (! url)
        url = previousUrl;
    else
        previousUrl = url;
    let bwoptions = {
        width: w, height: h,
        webPreferences: {nodeIntegration: false, preload: path.join(__dirname, 'preload.js')},
        useContentSize: true, show: false};
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
    windowList.push(win);
    win.loadURL(url);
    if (options.openDevTools)
        win.webContents.openDevTools()
    if (! headless)
        win.once('ready-to-show', function () { win.show(); });
    win.on('closed', () => {
        let index = windowList.indexOf(win);
        if (index >= 0)
            windowList.splice(index, 1);
    });
}

function eventToWindow(event) {
    return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on('window-ops', (event, command, arg) => {
    switch (command) {
    case 'new-window':
        createNewWindow(arg.url, arg, false);
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
    case 'set-menubar-visibility':
        eventToWindow(event).setMenuBarVisibility(arg);
        break;
    }
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

const {app, BrowserWindow} = require('electron')
const path = require('path')
const url = require('url')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow () {
    // options = yargs(process.argv[1..]).wrap(100)
    // and load the index.html of the app.
    let argv = process.argv;
    let argc = argv.length;
    let openDevTools = false;
    var url = "http://localhost:7033/#ws=same";
    var geometry = null;
    for (let i = 2; i < argc; i++) {
        let arg = argv[i];
        if (arg == "--devtools")
            openDevTools = true;
        else if (arg == "--url" && i+1 < argc)
            url = argv[++i];
        else if (arg == "--geometry" && i+1 < argc)
            geometry = argv[++i];
        else
            console.log("arg#"+i+": "+JSON.stringify(argv[i]));
    }

    // Create the browser window.
    var w = 800, h = 600;
    var m = geometry ? geometry.match(/^([0-9]+)x([0-9]+)$/) : null;
    if (m) {
        w = Number(m[1]);
        h = Number(m[2]);
    }
    win = new BrowserWindow({width: w, height: h, show: false})

    win.loadURL(url);

    if (openDevTools)
        win.webContents.openDevTools()

    win.once('ready-to-show', () => {
            win.show()
        })

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

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
  if (win === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

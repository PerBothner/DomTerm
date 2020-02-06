const {app, ipcMain, BrowserWindow, screen, protocol } = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs')
const { Readable, PassThrough } = require('stream');

const packageVersion = require('./package.json').version;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windowList = new Array();

let sessionList = new Array();

let lastSessionNumber = 0;

function createSession() {
    var os = require('os');
    var pty = require('node-pty');
    let sessionNumber = ++lastSessionNumber;

    // Initialize node-pty with an appropriate shell
    const shell = process.env[os.platform() === 'win32' ? 'COMSPEC' : 'SHELL'];
    const domtermVar = "version=" + packageVersion
          + ";session#=" + sessionNumber;
    const ptyOptions = {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: Object.assign({}, process.env,
        { DOMTERM: domtermVar, COLORTERM: "truecolor"})
    };
    const ptyProcess = pty.spawn(shell, [], ptyOptions);
    const connections = new Array();
    const session = { ptyProcess: ptyProcess,
                      sessionNumber: sessionNumber,
                      connections: connections
                    };
    sessionList.push(session);
    ptyProcess.on('data', function (data) {
        for (let i = connections.length; --i >= 0; ) {
            const connection = connections[i];
            connection.window.webContents.send('output-data',
                                               connection.paneId,  data);
        }
    });
    
    return session;
}

function mimetypeFromPath(path) {
    if (path.endsWith(".js"))
        return "text/javascript";
    if (path.endsWith(".css"))
        return "text/css";
    if (path.endsWith(".html"))
        return "text/html";
    if (path.endsWith(".ico"))
        return "image/x-icon";
    if (path.endsWith(".png"))
        return "image/png";
    if (path.endsWith(".jpeg") || path.endsWith(".jpg"))
        return "image/jpeg";
    if (path.endsWith(".svg"))
        return "image/svg+xml";
    return "text/plain";
}

function sessionFromNumber(sessionNumber) {
    for (let i = sessionList.length; --i >= 0; ) {
        let session = sessionList[i];
        if (session.sessionNumber === sessionNumber)
            return session;
    }
    return session;
}

function createInitialWindow (argv) {
    // options = yargs(process.argv[1..]).wrap(100)
    // and load the index.html of the app.
    let argc = argv.length;
    let openDevTools = false;
    let rurl = "dtresource:/index.html";
    var geometry = null;
    for (let i = 2; i < argc; i++) {
        let arg = argv[i];
        if (arg == "--devtools")
            openDevTools = true;
        else if (arg == "--url" && i+1 < argc)
            rurl = argv[++i];
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
    createNewWindow(rurl, options);
}

var previousUrl = null;
var previousWidth = 800;
var previousHeight = 600;

function createNewWindow (url, options) {
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
    let session = createSession();
    session.connections.push({window: win, paneId: 0, session: session });
    win.paneIdToSession = [session];
    win.loadURL(url);
    if (options.openDevTools)
        win.webContents.openDevTools()
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
function eventToSession(event, paneId=0) {
    // FIXME handle paneId
    return eventToWindow(event).paneIdToSession[paneId];
}

ipcMain.on('new-pane', (event, paneId, sessionNumber) => {
    let session = sessionNumber >= 0 ? sessionFromNumber(sessionNumber)
        : createSession();
    let window = eventToWindow(event);
    let pane = { window: window, paneId: paneId, session: session };
    window.paneIdToSession[paneId] = session;
    session.connections.push(pane);
});

ipcMain.on('process-input-bytes', (event, paneId, data) => {
    let session = eventToSession(event, paneId);
    if (session)
        session.ptyProcess.write(data);
});
function urgentWrap(text) {
    return `\x13\x16${text}\x14`;
}
ipcMain.on('report-event', (event, paneId, name, data) => {
    let session = eventToSession(event, paneId);
    if (session) {
        // handle reportEvent
        logNotice("reportEvent "+name+" '"+data+"'");
        if (name === 'VERSION') {
            let win = eventToWindow(event);
            let text = urgentWrap(`\x1B[91;${session.sessionNumber};${0};${0}u`);
            // FIXME also send contents of settings.ini
            win.webContents.send('output-data',  paneId,  text);
        }
    }
});
ipcMain.on('set-window-size',
           (event, paneId, numRows, numColumns,  availHeight, availWidth) => {
               let session = eventToSession(event, paneId);
               if (session) {
                   session.ptyProcess.resize(numColumns, numRows);
               }});

ipcMain.on('new-window', (event, url, options) => {
    createNewWindow(url, options);
});
var logVerbose = 1;

function logNotice(text) {
    if (logVerbose > 0)
        process.stderr.write(text+"\n");
}

function mainHtml() {
    return `<!DOCTYPE html>
<html><head>
<meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>
<title>DomTerm</title>
<base href='dtresource:/'>
<link type='text/css' rel='stylesheet' href='hlib/domterm-core.css'>
<link type='text/css' rel='stylesheet' href='hlib/domterm-standard.css'>
<link type='text/css' rel='stylesheet' href='hlib/goldenlayout-base.css'>
<link type='text/css' rel='stylesheet' href='hlib/domterm-layout.css'>
<link type='text/css' rel='stylesheet' href='hlib/domterm-default.css'>
<script type='text/javascript' src='hlib/domterm.js'> </script>
<script type='text/javascript' src='hlib/domterm-version.js'> </script>
<script type='module' src='hlib/terminal.js'> </script>
<script type='module' src='hlib/domterm-parser.js'> </script>
<script type='module' src='hlib/sixel/Colors.js'> </script>
<script type='module' src='hlib/sixel/SixelDecoder.js'> </script>
<script type='text/javascript' src='hlib/ResizeSensor.js'> </script>
<script type='text/javascript' src='hlib/FileSaver.js'> </script>
<script type='text/javascript' src='hlib/wcwidth.js'> </script>
<script type='text/javascript' src='hlib/browserkeymap.js'> </script>
<script type='text/javascript' src='hlib/jquery.min.js'> </script>
<script type='text/javascript' src='hlib/goldenlayout.js'> </script>
<script type='text/javascript' src='hlib/domterm-layout.js'> </script>
<script type='text/javascript' src='hlib/domterm-menus.js'> </script>
<script type='module' src='hlib/commands.js'> </script>
<script type='text/javascript' src='renderer.js'> </script>
<script type='text/javascript' src='hlib/domterm-client.js'> </script>
</script>
</head>
<body></body>
</html>
`;
}

function handleResource(request, callback) {
    let url = new URL(request.url);
    let st;
    let upath = url.pathname;
    logNotice("callback '"+upath+"'");
    if (upath === "/index.html") {
        let hstring = mainHtml();
        function createStream (text) {
            const rv = new PassThrough() // PassThrough is also a Readable stream
            rv.push(text)
            rv.push(null)
            return rv
        }
        st = createStream(hstring);
        //logNotice("readable from string: "+JSON.stringify(st));
    } else {
        let path = upath == "/renderer.js"
            /*|| upath == "/index.html"*/ ? __dirname+upath
            : __dirname+"/.."+upath;
        logNotice("handle "+upath+" -> "+path+"'");
        st = fs.createReadStream(path);
    }
    logNotice("mime("+upath+")='"+mimetypeFromPath(upath)+"'");
    callback({statusCode: 200,
              headers: {
                  'Access-Control-Allow-Origin': '*',
                  'content-type': mimetypeFromPath(upath) },
              data: st});
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', (launchInfo) => {
    if (app.requestSingleInstanceLock()) {
        protocol.registerStreamProtocol('dtresource', handleResource);
        let argv = process.argv;
        createInitialWindow(argv);
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            createInitialWindow(commandLine);
        });
    } else
        app.quit();
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (windowList.length === 0) {
        createInitialWindow(process.argv);
    }
})

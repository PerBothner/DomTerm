const _electronAccess = require('electron');
process.once('loaded', () => {
    let remote = _electronAccess.remote;
    global.electronAccess = {
        BrowserWindow: remote.BrowserWindow,
        clipboard: _electronAccess.clipboard,
        dialog: remote.dialog,
        fs: remote.fs,
        getCurrentWindow: remote.getCurrentWindow,
        ipcRenderer: _electronAccess.ipcRenderer,
        Menu: remote.Menu,
        MenuItem: remote.MenuItem,
        shell: remote.shell
    };
})

{
    const _electron = require('electron');
    const _fs = require('fs');
    const _require = require;
    const remote = _electron.remote;
    const _electronAccess = {
        BrowserWindow: remote.BrowserWindow,
        clipboard: _electron.clipboard,
        dialog: remote.dialog,
        fs: _fs,
        getCurrentWindow: remote.getCurrentWindow,
        ipcRenderer: _electron.ipcRenderer,
        Menu: remote.Menu,
        MenuItem: remote.MenuItem,
        require: _require,
        shell: remote.shell
    }
    process.once('loaded', () => {
        global.electronAccess = _electronAccess;
    })
}

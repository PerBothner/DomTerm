{
    const _electron = require('electron');
    const _fs = require('fs');
    const _require = require;
    const remote = _electron.remote;
    const _electronAccess = {
        clipboard: _electron.clipboard,
        fs: _fs,
        ipcRenderer: _electron.ipcRenderer,
        Menu: remote.Menu,
        MenuItem: remote.MenuItem,
        require: _require
    }
    process.once('loaded', () => {
        global.electronAccess = _electronAccess;
    })
}

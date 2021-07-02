{
    const _electron = require('electron');
    const _fs = require('fs');
    const _require = require;
    const _electronAccess = {
        clipboard: _electron.clipboard,
        fs: _fs,
        ipcRenderer: _electron.ipcRenderer,
        require: _require
    }
    process.once('loaded', () => {
        global.electronAccess = _electronAccess;
    })
}

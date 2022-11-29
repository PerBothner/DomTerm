{
    const _electron = require('electron');
    const _require = require;
    const _electronAccess = {
        webFrame: _electron.webFrame,
        clipboard: _electron.clipboard,
        ipcRenderer: _electron.ipcRenderer,
        require: _require
    }
    process.once('loaded', () => {
        global.electronAccess = _electronAccess;
    })
}

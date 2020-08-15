DomTerm using Electron+Node.js for back-end as well as front-end.

Experimental.

Building:
(See https://github.com/electron/electron-rebuild)

cd $DOMTERM_DIR/electron-nodepty
npm install --save-dev electron-rebuild
$(npm bin)/electron-rebuild --version `electron --version`

Running:

electron $DOMTERM_DIR/electron-nodepty

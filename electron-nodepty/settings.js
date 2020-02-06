const { logVerbosity, logNotice, logInfo } = require('./logging');
const fs = require('fs');

let settingsFilename = null;
let _settingsData = null;
let settingsCounter = 0;

function settingsData() { return _settingsData; }

function parseSettings(data) {
    let obj = {};
    obj['##'] = ++settingsCounter;
    let lines = data.split(/[\r]?\n/);
    let nlines = lines.length;
    for (let i = 0; i < nlines; i++) {
        let line = lines[i].trim();
        if (line.length == 0 || line.charCodeAt(0) == 35 /*'#'*/)
            continue;
        let m = line.match(/^([^=\s]+)\s*=\s*([^=\s]*)\s*$/);
        if (m) {
            let key = m[1];
            let value = m[2];
            if (value === "") {
                if (i + 1 < nlines)
                while (i + 1 < nlines
                       && (line = lines[i+1]) && line.length >= 2
                       && line.charCodeAt(0) === 32 /*' '*/
                       && line.charCodeAt(1) === 124 /*'|'*/) {
                    value += line.substring(2) + '\n';
                    i++;
                }
            }
            obj[key] = value;
        } else
            logNotice("parsing settings line "+(i+1)+" - bad syntax ["+line+"]");
    }
    return obj;
}

function readSettings(filename, callbackOnChange) {
    fs.readFile(filename, 'utf8', (err, data) => {
        if (err)
            logNotice("error reading settings file ("+filename+"): "+err);
        else {
            logNotice("reading settings file ("+filename+")");
            _settingsData = parseSettings(data);
            callbackOnChange(_settingsData);
        }
    })
}

function initSettings(settingsArg, callbackOnChange) {
    let settings = settingsArg;
    if (settings == null) {
        let xdg_home = process.env["XDG_CONFIG_HOME"];
        if (xdg_home)
            settings = xdg_home + "/domterm/settings.ini";
        else {
            let home = process.env['HOME'];
            if (! home)
                home = process.cwd();
            if (home)
                settings = home + "/.config/domterm/settings.ini"
        }
    }
    settingsFilename = settings;
    if (settings) {
        readSettings(settings, callbackOnChange);
        fs.watchFile(settings,
                     (current, previous) => {
                         readSettings(settings, callbackOnChange);
                     });
    }
}

module.exports = { initSettings, parseSettings, settingsFilename, settingsData }

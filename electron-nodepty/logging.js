var logVerbosity = 0;

function initLog(verbosity) {
    logVerbosity = verbosity;
}

function logIf(text, cond=true) {
    if (cond)
        process.stderr.write(text+"\n");
}
function logNotice(text) { logIf(text, logVerbosity > 0) ; }
function logInfo(text) { logIf(text, logVerbosity > 1) ; }

module.exports = { initLog, logVerbosity, logNotice, logInfo };

// Used when compiling terminal.js with Google's Closure compiler
// in "advanced optimization" mode.
// NEEDS WORK.
window['DomTerm'] = DomTerm;
DomTerm.prototype.processInputCharacters = function(str) {
    this['processInputCharacters'](str);
};
DomTerm.prototype['initializeTerminal'] = DomTerm.prototype.initializeTerminal;
DomTerm.prototype['insertBytes'] = DomTerm.prototype.insertBytes;
DomTerm.prototype['insertString'] = DomTerm.prototype.insertString;
DomTerm.prototype['reportEvent'] = DomTerm.prototype.reportEvent;
DomTerm.prototype['setInputMode'] = DomTerm.prototype.setInputMode;
//DomTerm.prototype['doPaste'] = DomTerm.prototype.doPaste;
//DomTerm.prototype['doCopy'] = DomTerm.prototype.doCopy;
DomTerm.prototype['doSaveAs'] = DomTerm.prototype.doSaveAs;
DomTerm.prototype['processInputCharacters'] = DomTerm.prototype.processInputCharacters;

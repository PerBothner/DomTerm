export { commandMap, lookupCommand };
import { Terminal } from './terminal.js';

const commandMap = new Object();

function cmd(name, action) {
    commandMap[name] = action;
}
function lookupCommand(name) {
    return commandMap[name];
}

cmd('cycle-input-mode',
    function(dt, key) {
        dt.nextInputMode();
        return true;
    });
cmd('clear-buffer',
    function(dt, key) {
        dt.reportEvent("ECHO-URGENT", JSON.stringify("\x1b[7J"));
        return true;
    });
cmd('new-window',
    function(dt, key) {
        DomTerm.openNewWindow(dt);
        return true;
    });
cmd('new-tab',
    function(dt, key) {
        DomTerm.newPane(2, null, dt);
        return true;
    });
cmd('scroll-top',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pageTop();
        return true;
    });
cmd('scroll-bottom',
    function(dt, key) {
        dt._pageBottom();
        return true;
    });
cmd('scroll-line-up',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pageLine(-1);
        return true;
    });
cmd('scroll-line-down',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pageLine(1);
        return true;
    });
cmd('scroll-page-up',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pagePage(-1);
        return true;
    });
cmd('scroll-page-down',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pagePage(1);
        return true;
    });
cmd('enter-mux-mode',
    function(dt, key) {
        if (! dt.enterMuxMode)
            return false;
        dt.enterMuxMode();
        return true;
    });
cmd('toggle-fullscreen',
    function(dt, key) {
        if (screenfull.isFullscreen)
            screenfull.exit();
        else
            screenfull.request();
        return true;
    });
cmd('toggle-fullscreen-current-window',
    function(dt, key) {
        let requesting = ! screenfull.isFullscreen;
        if (! requesting) {
            requesting =
                screenfull.element.nodeName != "DIV";
            screenfull.exit();
        }
        if (requesting) {
            let dt = DomTerm.focusedTerm;
            if (dt)
                screenfull.request(dt.topNode);
            else
                screenfull.request();
        }
    });
cmd('toggle-paging-mode',
    function(dt, key) {
        if (dt._currentlyPagingOrPaused()) {
            dt._pauseContinue();
            dt._exitPaging();
        } else
            dt._enterPaging(true);
        return true;
    });
cmd('toggle-auto-pager',
    function(dt, key) {
        if (dt._currentlyPagingOrPaused()) {
            DomTerm.setAutoPaging("toggle", dt);
            dt._pauseContinue();
            dt._exitPaging();
        } else
            DomTerm.setAutoPaging("toggle", dt);
        DomTerm.autoPagerChanged(dt, dt._autoPaging);
    });

cmd('save-as-html',
    function(dt, key) {
        DomTerm.doSaveAs(dt);
        return true;
    });
cmd('paste-text',
    function(dt, key) {
        return DomTerm.doPaste(dt);
    });
cmd('copy-text',
    function(dt, key) {
        return DomTerm.valueToClipboard(Terminal._selectionValue(false));
    });
cmd('copy-html',
    function(dt, key) {
        return DomTerm.valueToClipboard(Terminal._selectionValue(true));
    });
cmd('copy-text-or-interrupt',
    function(dt, key) {
        if (document.getSelection().isCollapsed)
            return (commandMap['client-action'])(dt, key);
        let value = Terminal._selectionValue(false);
        dt._clearSelection();
        return DomTerm.valueToClipboard(value);
   });
cmd('cut-text',
    function(dt, key) {
        if (! window.getSelection().isCollapsed) {
            //dt.editorBackspace(1, "kill", "line", "buffer");
            dt.deleteSelected(true);
        }
        return true; });
cmd('backward-char',
    function(dt, key) {
        dt.editorBackspace(dt.numericArgumentGet(), "move", "char");
        return true; });
cmd('backward-word',
    function(dt, key) {
        dt.editorBackspace(dt.numericArgumentGet(), "move", "word");
        return true; });
cmd('forward-char',
    function(dt, key) {
        dt.editorBackspace(- dt.numericArgumentGet(), "move", "char");
        return true; });
cmd('forward-word',
    function(dt, key) {
        dt.editorBackspace(- dt.numericArgumentGet(), "move", "word");
        return true; });
cmd('backward-char-extend',
    function(dt, key) {
        dt.extendSelection(dt.numericArgumentGet(), "char");
        return true; });
cmd('backward-word-extend',
    function(dt, key) {
        dt.extendSelection(dt.numericArgumentGet(), "word");
        return true; });
cmd('forward-char-extend',
    function(dt, key) {
        dt.extendSelection(- dt.numericArgumentGet(), "char");
        return true; });
cmd('forward-word-extend',
    function(dt, key) {
        dt.extendSelection(- dt.numericArgumentGet(), "word");
        return true; });
cmd('backward-delete-char',
    function(dt, key) {
        dt.editorBackspace(dt.numericArgumentGet(), "delete", "char");
        return true; });
cmd('backward-delete-word',
    function(dt, key) {
        dt.editorBackspace(dt.numericArgumentGet(), "delete", "word");
        return true; });
cmd('forward-delete-char',
    function(dt, key) {
        dt.editorBackspace(- dt.numericArgumentGet(), "delete", "char");
        return true; });
cmd('forward-delete-char-or-eof',
   function(dt, key) {
       let cmd = 'client-action';
       if (dt.grabInput(dt._inputLine).length > 0)
           cmd = "forward-delete-char";
       return (commandMap[cmd])(dt, key);
   });
cmd('forward-delete-word',
    function(dt, key) {
    dt.editorBackspace(- dt.numericArgumentGet(), "delete", "word");
        return true; });
cmd('beginning-of-line',
    function(dt, key) {
        dt.editorMoveStartOrEndLine(false); dt._numericArgument = null;
        return true; });
cmd('end-of-line',
    function(dt, key) {
        dt.editorMoveStartOrEndLine(true); dt._numericArgument = null;
        return true; });
cmd('beginning-of-line-extend',
    function(dt, key) {
        dt.editorMoveStartOrEndLine(false, "extend"); dt._numericArgument = null;
        return true; });
cmd('end-of-line-extend',
    function(dt, key) {
        dt.editorMoveStartOrEndLine(true, "extend"); dt._numericArgument = null;
        return true; });
cmd('kill-line',
    function(dt, key) {
        let count = dt.numericArgumentGet();
        dt.editorBackspace(- count, "kill", "line", "buffer");
        return true; });
cmd('beginning-of-input',
    function(dt, key) {
        dt.editorMoveHomeOrEnd(false); dt._numericArgument = null;
        return true; });
cmd('end-of-input',
    function(dt, key) {
        dt.editorMoveHomeOrEnd(true); dt._numericArgument = null;
        return true; });
cmd('up-line-or-history',
    function(dt, key) {
        if (! dt.editorMoveLines(true, dt.numericArgumentGet()))
            dt.historyMove(-1);
        return true;
    });
cmd('down-line-or-history',
    function(dt, key) {
        if (! dt.editorMoveLines(false, dt.numericArgumentGet()))
            dt.historyMove(1)
        return true;
    });
cmd('ignore-action',
    function(dt, key) {
        return true; });
cmd('default-action',
    function(dt, key) {
        return false; });
cmd('client-action',
    function(dt, key) {
        if (! dt.isLineEditing())
            return false;
        let str = dt.keyNameToChars(key);
        let input = dt._inputLine;
        if (str) {
            dt._updateRemote(input);
            dt.processInputCharacters(str);
            input.classList.add("pending");
            dt._deferredForDeletion = input;
            input.continueEditing = true;
            dt.outputBefore = dt._caretNode;
            dt.outputContainer = dt._caretNode.parentNode;
            return true;
        }
        return false; });
cmd('control-action',
   function(dt, key) {
    let cmd = 'client-action';
    if (key == "Ctrl-D"
        && dt.grabInput(dt._inputLine).length > 0)
        cmd = "forward-delete-char";
    return (DomTerm.commandMap[cmd])(dt, key);
   });
cmd('numeric-argument',
    function(dt, key) {
        let klen = key.length;
        let c = key.charAt(klen-1);
        dt._numericArgument = dt._numericArgument == null ? c
            : dt._numericArgument + c;
        dt._displayInfoMessage("count: "+dt._numericArgument);
        return true;
    });
cmd('accept-line',
    function(dt, key) {
        dt.processEnter();
        if (dt._lineEditingMode == 0 && dt.autoLazyCheckInferior)
            dt._clientWantsEditing = 0;
        return true; });
cmd('insert-newline',
    function(dt, key) {
        dt.editorInsertString("\n");
        return true; });
cmd('backward-search-history',
    function(dt, key) {
        dt.showMiniBuffer("backward history search: \u2018", "\u2019");
        function search(mrecords, observer) {
            dt.historySearch(dt._miniBuffer.textContent);
        }
        let observer = new MutationObserver(search);
        observer.observe(dt._miniBuffer,
                         { attributes: false, childList: true, characterData: true, subtree: true });
        dt._miniBuffer.observer = observer;
        dt._searchMode = true;
        dt.historySearchForwards = false;
        dt.historySearchStart =
            dt.historyCursor < 0 ? dt.history.length
            : dt.historyCursor;
        return true;
    });

cmd('insert-char',
    function(dt, keyName) {
        let ch = keyName.length == 3 ? keyName.charCodeAt(1) : -1;
        if (ch >= 0 && ch < 32)
            return false;
        let str = keyName.substring(1, keyName.length-1);
        let sel = window.getSelection();
        if (! sel.isCollapsed) {
            dt.editorBackspace(1, "delete", "char");
        }
        let count = dt.numericArgumentGet();
        if (count >= 0)
            str = str.repeat(count);
        dt.editorInsertString(str);
        let pwtimeout;
        if (dt._inputLine.classList.contains("noecho")
            && ! dt.sstate.hiddenText
            && (pwtimeout
                = dt.getOption("password-show-char-timeout", 0.8))) {
            // Temporarily display inserted char(s), with dots for other chars.
            // After timeout all chars shown as dots.
            let r = new Range();
            r.selectNodeContents(dt._inputLine);
            let wlength = DomTerm._countCodePoints(r.toString());
            r.setEndBefore(dt._caretNode);
            let wbefore = DomTerm._countCodePoints(r.toString());
            let ctext = dt._inputLine.textContent;
            let wstr = DomTerm._countCodePoints(str);
            let pwchar = dt.passwordHideChar();
            let before = pwchar.repeat(wbefore-wstr);
            let after = pwchar.repeat(wlength-wbefore);
            DomTerm._replaceTextContents(dt._inputLine, before + str + after);
            dt.sstate.hiddenText = ctext;
            setTimeout(function() { dt._suppressHidePassword = false;
                                    dt._hidePassword(); },
                       pwtimeout * 1000);
            dt._suppressHidePassword = true;
        }
        return true;
    });
cmd('detach-session',
    function(dt, keyName) {
        dt.detachSession();
    });

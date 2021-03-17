export { commandMap, lookupCommand, cmd };
import { Terminal } from './terminal.js';

const commandMap = new Object();

function cmd(name, action) {
    commandMap[name] = action;
}
function lookupCommand(name) {
    return commandMap[name];
}

cmd('input-mode-line',
    function(dt, key) {
        DomTerm.setInputMode(108, dt);
        return true;
    });
cmd('input-mode-char',
    function(dt, key) {
        DomTerm.setInputMode(99, dt);
        return true;
    });
cmd('input-mode-auto',
    function(dt, key) {
        DomTerm.setInputMode(97, dt);
        return true;
    });
cmd('input-mode-cycle',
    function(dt, key) {
        dt.nextInputMode();
        return true;
    });
cmd('clear-buffer',
    function(dt, key) {
        dt.reportEvent("ECHO-URGENT", JSON.stringify("\x1b[7J"));
        return true;
    });
cmd('reset-terminal-soft',
    function(dt, key) {
        dt.reportEvent("ECHO-URGENT", JSON.stringify("\x1b[!p"));
        return true;
    });
cmd('close-window',
    function(dt, key) {
        DomTerm.windowClose();
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
cmd('new-pane',
    function(dt, key) {
        DomTerm.newPane(1, null, dt);
        return true;
    });
cmd('new-pane-left',
    function(dt, key) {
        DomTerm.newPane(10, null, dt);
        return true;
    });
cmd('new-pane-right',
    function(dt, key) {
        DomTerm.newPane(11, null, dt);
        return true;
    });
cmd('new-pane-above',
    function(dt, key) {
        DomTerm.newPane(12, null, dt);
        return true;
    });
cmd('new-pane-below',
    function(dt, key) {
        DomTerm.newPane(13, null, dt);
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
        dt._scrollLine(- dt.numericArgumentGet(1));
        return true;
    });
cmd('scroll-line-down',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._scrollLine(dt.numericArgumentGet(1));
        return true;
    });
cmd('scroll-page-up',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._scrollPage(- dt.numericArgumentGet(1));
        return true;
    });
cmd('scroll-page-down',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._scrollPage(dt.numericArgumentGet(1));
        return true;
    });
cmd('scroll-percentage',
    function(dt, key) {
        dt._disableScrollOnOutput = true;
        dt._pageScrollAbsolute(dt.numericArgumentGet(50));
        return true;
    });
cmd('up-page',
    function(dt, key) {
        dt._pageUpOrDown(dt.numericArgumentGet(1), true);
        return true;
    });
cmd('down-page-or-continue',
    function(dt, key) {
        dt._pageUpOrDown(dt.numericArgumentGet(1), false, false);
        return true;
    });
cmd('down-page-or-unpause',
    function(dt, key) {
        dt._pageUpOrDown(dt.numericArgumentGet(1), false, true);
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
cmd('paging-keypress',
    function(dt, key) {
        dt._displayInputModeWithTimeout(dt._modeInfo("P"));
        return true;
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
cmd('exit-paging-mode',
    function(dt, key) {
        if (dt._currentlyPagingOrPaused()) {
            if (dt._markMode) {
                dt.setMarkMode(false);
            } else {
                dt._pauseContinue();
                dt._exitPaging();
            }
        }
        return true;
    });
cmd('exit-line-mode',
    function(dt, key) {
        if (dt._markMode) {
            dt.setMarkMode(false);
            return true
        }
        return false;
    });
cmd('exit-pager-disable-auto',
    function(dt, key) {
        DomTerm.setAutoPaging("false", dt);
        if (dt._currentlyPagingOrPaused()) {
            dt._pauseContinue();
            dt._exitPaging();
        };
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
        return true;
    });
cmd('toggle-pause-mode',
    function(dt, key) {
        let oldMode = dt._pagingMode;
        if (oldMode==2)
            dt._pauseContinue();
        dt._enterPaging(oldMode==1);
        return true;
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
        let cmd = document.getSelection().isCollapsed || key === dt.previousKeyName
            ? 'client-action'
            : 'copy-text';
        return (commandMap[cmd])(dt, key);
    });
cmd('paging-interrupt',
    function(dt, key) {
        dt.reportKeyEvent(key, dt.keyNameToChars(key));
        dt._pauseContinue(false, true);
        dt._adjustPauseLimit();
        return true;
    });
cmd('paging-copy-or-interrupt',
    function(dt, key) {
        let cmd = document.getSelection().isCollapsed || key === dt.previousKeyName
            ? 'paging-interrupt'
            : 'copy-text';
        return (commandMap[cmd])(dt, key);
    });
cmd('cut-text',
    function(dt, key) {
        if (! window.getSelection().isCollapsed) {
            //dt.editMove(1, "kill", "line", "buffer");
            dt.deleteSelected(true);
        }
        return true; });
cmd('backward-char',
    function(dt, key) {
        dt.editMovePosition(dt.numericArgumentGet(), "char");
        return true; });
cmd('backward-word',
    function(dt, key) {
        dt.editMovePosition(dt.numericArgumentGet(), "word");
        return true; });
cmd('forward-char',
    function(dt, key) {
        dt.editMovePosition(- dt.numericArgumentGet(), "char");
        return true; });
cmd('forward-word',
    function(dt, key) {
        dt.editMovePosition(- dt.numericArgumentGet(), "word");
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
        dt.editMove(dt.numericArgumentGet(), "delete", "char");
        return true; });
cmd('backward-delete-word',
    function(dt, key) {
        dt.editMove(dt.numericArgumentGet(), "delete", "word");
        return true; });
cmd('forward-delete-char',
    function(dt, key) {
        dt.editMove(- dt.numericArgumentGet(), "delete", "char");
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
    dt.editMove(- dt.numericArgumentGet(), "delete", "word");
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
        dt.editorMoveStartOrEndLine(false, true); dt._numericArgument = null;
        return true; });
cmd('end-of-line-extend',
    function(dt, key) {
        dt.editorMoveStartOrEndLine(true, true); dt._numericArgument = null;
        return true; });
cmd('kill-line',
    function(dt, key) {
        let count = dt.numericArgumentGet();
        dt.editMove(- count, "kill", "line", "buffer");
        return true; });
cmd('beginning-of-buffer',
    function(dt, key) {
        dt.editorMoveStartOrEndBuffer(false, "move"); dt._numericArgument = null;
        return true; });
cmd('end-of-buffer',
    function(dt, key) {
        dt.editorMoveStartOrEndBuffer(true, "move"); dt._numericArgument = null;
        return true; });
cmd('beginning-of-buffer-extend',
    function(dt, key) {
        dt.editorMoveStartOrEndBuffer(false, "extend"); dt._numericArgument = null;
        return true; });
cmd('end-of-buffer-extend',
    function(dt, key) {
        dt.editorMoveStartOrEndBuffer(true, "extend"); dt._numericArgument = null;
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
        if (dt.editorMoveLines(true, dt.numericArgumentGet()) > 0)
            dt.historyMove(-1);
        return true;
    });
cmd('down-line-or-history',
    function(dt, key) {
        if (dt.editorMoveLines(false, dt.numericArgumentGet()) > 0)
            dt.historyMove(1)
        return true;
    });
cmd('up-line',
    function(dt, key) {
        dt.editorMoveLines(true, dt.numericArgumentGet(), false);
        return true;
    });
cmd('down-line',
    function(dt, key) {
        dt.editorMoveLines(false, dt.numericArgumentGet(), false)
        return true;
    });
cmd('down-line-or-unpause',
    function(dt, key) {
        dt._downLinesOrContinue(dt.numericArgumentGet(), true);
        return true;
    });
cmd('down-line-or-continue',
    function(dt, key) {
        dt._downLinesOrContinue(dt.numericArgumentGet(), false);
        return true;
    });
cmd('up-line-extend',
    function(dt, key) {
        dt.editorMoveLines(true, dt.numericArgumentGet(), true);
        return true;
    });
cmd('down-line-extend',
    function(dt, key) {
        dt.editorMoveLines(false, dt.numericArgumentGet(), true)
        return true;
    });
cmd('toggle-mark-mode',
    function(dt, key) {
        dt.setMarkMode('toggle');
        return true;
    });
cmd('swap-focus-anchor',
    function(dt, key) {
        let sel = window.getSelection();
        if (! sel.isCollapsed) {
            sel.setBaseAndExtent(sel.focusNode, sel.focusOffset,
                                 sel.anchorNode, sel.anchorOffset);
            dt._didExtend = true;
        }
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
        if (str) {
            dt.editorMoveHomeOrEnd(true);
            dt.editorInsertString(str);
            dt._sendInputContents(false);
            dt._inputLine = null;
            dt.maybeResetWantsEditing();
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
        let c = key.charAt(klen == 3 ? 1 : klen-1);
        dt._numericArgument = dt._numericArgument == null ? c
            : dt._numericArgument + c;
        dt._updateCountInfo();
        return true;
    });
cmd('accept-line',
    function(dt, key) {
        dt.processEnter();
        dt.maybeResetWantsEditing();
        return true; });
cmd('insert-newline',
    function(dt, key) {
        dt.editorInsertString("\n");
        return true; });
cmd('backward-search-history',
    function(dt, key) {
        dt.editorAddLine();
        function search(mrecords, observer) {
            dt._inputLine = dt._miniBuffer.saveInputLine;
            dt._caretNode = dt._miniBuffer.saveCaretNode;
            dt.historySearch(dt._miniBuffer.textContent);
            dt._inputLine = dt._miniBuffer;
            dt._caretNode = dt._miniBuffer.caretNode;
        }
        dt.showMiniBuffer({prefix: "backward history search: \u2018",
                           postfix: "\u2019",
                           mutationCallback: search});
        dt._searchInHistoryMode = true;
        dt.historySearchForwards = false;
        dt.historySearchStart =
            dt.historyCursor < 0 ? dt.history.length
            : dt.historyCursor;
        return true;
    });

cmd('insert-char',
    function(dt, keyName) {
        let deleteSelection = false;
        let ch = keyName.length == 3 ? keyName.charCodeAt(1) : -1;
        if (ch >= 0 && ch < 32)
            return false;
        let str = keyName.substring(1, keyName.length-1);
        if (deleteSelection) {
            let sel = window.getSelection();
            if (! sel.isCollapsed) {
                dt.editMove(1, "delete", "char");
            }
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
        return true;
    });
cmd('open-link',
    function(dt, keyName) {
        DomTerm.handleLink();;
        return true;
    });
cmd('copy-link-address',
    function(dt, keyName) {
        DomTerm.copyLink();;
        return true;
    });
cmd('open-domterm-homepage',
    function(dt, keyName) {
        DomTerm.requestOpenLink({href: 'https://domterm.org'});
        return true;
    });
cmd('show-about-message',
    function(dt, keyName) {
        DomTerm.showAboutMessage();
        return true;
    });

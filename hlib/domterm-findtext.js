export { FindText };
import { Terminal } from './terminal.js';
import { commandMap, cmd } from './commands.js';

class FindText {
    constructor(term) {
        this.term = term;

        this.mark = new Mark(term.getAllBuffers());
        this.searchString = "";
        if (term._findRegExp === undefined)
            term._findRegExp = false;
        if (term._findMatchCase === undefined)
            term._findMatchCase = false;
        if (term._findMatchWord === undefined)
            term._findMatchWord = false;
        this.matches = null;
        this.curMatch = -1;
        this.basePosition = term._positionToRange();
        this.buttonHandler = (event) => {
            let id = event.target.getAttribute("id");
            const dt = this.term;
            if (id === 'find-button-next')
                FindText.doNext(term, true);
            else if (id === 'find-button-previous')
                FindText.doNext(term, false);
            else if (id === 'find-button-kind') {
                let rect = event.target.getBoundingClientRect();
                let x = rect.x * term._computedZoom;
                let y = rect.bottom * term._computedZoom;
                DomTerm.popupMenu(DomTerm.makeMenu(this.kindPopupTemplate),
                                  {x: x, y: y});
            }
        };
        this.matchCaseTemplate = {
            label: "Match Case",
            type: "checkbox",
            checked: term._findMatchCase,
            accelerator: "Alt+C",
            clickClientAction: "find-toggle-match-case"
        };
        this.matchWordTemplate = {
            label: "Match Whole Word",
            type: "checkbox",
            checked: term._findMatchWord,
            accelerator: "Alt+W",
            clickClientAction: "find-toggle-match-word"
        };
        this.matchRegExpTemplate = {
            label: "Regular Expression",
            type: "checkbox",
            checked: term._findRegExp,
            accelerator: "Alt+R",
            clickClientAction: "find-toggle-regexp"
        };
        this.kindPopupTemplate = [
            this.matchCaseTemplate,
            this.matchWordTemplate,
            this.matchRegExpTemplate
        ];
    }
    unmark() {
        const sel = window.getSelection();
        const range = sel.focusedNode === null ? null : this.selectedRange;
        this.mark.unmark();
        // selection is likely to be cleared by DOM changes in unmark - but
        // the saved selectedRange can be used to restore it.
        if (range) {
            if (this.selectedForwards)
                sel.setBaseAndExtent(range.startContainer, range.startOffset,
                                     range.endContainer, range.endOffset);
            else
                sel.setBaseAndExtent(range.endContainer, range.endOffset,
                                     range.startContainer, range.startOffset);
        }
        this.selectedRange = null;
    }

    update() {
        let text = this.searchString;
        if (this.matches !== null)
            this.unmark();
        if (text.length == 0) {
            this.matches = null;
            this.resultCountView.innerHTML = `No results`;
            this.resultCountView.classList.remove("not-found");
            this.minibuf.infoDiv.classList.add("no-matches");
            this.selectedRange = null;
            return;
        }
        this.matches = [];
        let curMatch = [];
        let eachMatch = (m) => {
            if (! m.matchContinuation) {
                curMatch = [];
                this.matches.push(curMatch);
            }
            curMatch.push(m);
        };
        let options = {
            element: "mark",
            className: "match",
            each: eachMatch,
            acrossElements: true
        };
        let regexp = this._regexp;
        if (! regexp) {
            if (! this.term._findRegExp) {
                // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
                text = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            let rmode = this.term._findMatchCase ? "gmu" : "gmui";
            try {
                // First do search without added word-boundary-markers,
                // to catch and report errors without them.
                regexp = new RegExp(text, rmode);
                if (this.term._findMatchWord) {
                    text = '\\b' + text + '\\b';
                    regexp = new RegExp(text, rmode);
                }
            } catch (e) {
                console.log(e);
                this.resultCountView.innerText = e.message;
                this.resultCountView.classList.add("not-found");
                this.minibuf.infoDiv.classList.add("no-matches");
                return;
            }
            this._regexp = regexp;
        }
        this.mark.markRegExp(regexp, options);
        this.curMatch = -1;
        this.curMatch = this.findFollowingMatch(this.currentlyForwards);
        if (this.matches.length) {
            this.selectMatch(this.curMatch, this.currentlyForwards);
            this.resultCountView.classList.remove("not-found");
            this.minibuf.infoDiv.classList.remove("no-matches");
        } else {
            this.resultCountView.innerHTML = `No results`;
            this.resultCountView.classList.add("not-found");
            this.minibuf.infoDiv.classList.add("no-matches");
        }
    }
    updateSearchMode() {
        this._regexp = null;
        let str = this.term._findMatchCase ? "MatchCase" : "IgnoreCase";
        if (this.term._findMatchWord)
            str += "/Word";
        if (this.term._findRegExp)
            str += "/RX";
        let button = this.minibuf.infoDiv.querySelector("#find-button-kind");
        button.innerHTML = str;
    }
    setDirection(forwards) {
        if (this.currentlyForwards !== forwards) {
            this.minibuf.infoDiv
                .setAttribute("search-direction",
                              forwards ? "forwards" : "backwards");
        }
        this.currentlyForwards = forwards;
    }
    selectMatch(index, forwards) {
        let parts = this.matches[index];
        let nparts = parts.length;
        let range = document.createRange();
        this.selectedRange = range;
        this.selectedForwards = forwards;
        range.selectNode(parts[0]);
        if (nparts > 1)
            range.setEndAfter(parts[nparts-1]);
        let sel = document.getSelection();
        if (forwards)
            sel.setBaseAndExtent(range.startContainer, range.startOffset,
                                 range.endContainer, range.endOffset);
        else
            sel.setBaseAndExtent(range.endContainer, range.endOffset,
                                 range.startContainer, range.startOffset);
        this.resultCountView.innerHTML = `${index+1} of ${this.matches.length} results`;
    }
    findFollowingMatch(forwards) {
        let nmatches = this.matches == null ? 0 : this.matches.length;
        if (nmatches === 0)
            return; // ERROR?
        let range = document.createRange();
        if (forwards) {
            for (let i = 0; i < nmatches; i++) {
                let parts = this.matches[i];
                let nparts = parts.length;
                range.selectNode(parts[0]);
                if (range.compareBoundaryPoints(Range.START_TO_START,
                                                this.basePosition) >= 0) {
                    return i;
                }
            }
            return 0;
        } else {
            for (let i = nmatches; --i >= 0; ) {
                let parts = this.matches[i];
                let nparts = parts.length;
                range.selectNode(parts[nparts-1]);
                if (range.compareBoundaryPoints(Range.END_TO_END,
                                                this.basePosition) <= 0) {
                    return i;
                }
            }
            return nmatches - 1;
        }
    }
}

FindText.doNext = function(dt, forwards) {
    let ft = dt._findText;
    ft.setDirection(forwards);
    if (! ft) {
        return false; // ERROR?
    }
    if (ft.matches == null)
        return true;
    let nmatches = ft.matches.length;
    if (nmatches == 0)
        return false; // ERROR?
    if (ft.curMatch < 0) // FIXME
        ft.curMatch = 0;
    let sel = document.getSelection();
    ft.basePosition.setStart(sel.focusNode, sel.focusOffset);
    ft.basePosition.collapse(true);
    // Trick to implement modulo
    let nextMatch = (((ft.curMatch + (forwards ? 1 : -1)) % nmatches)
                     + nmatches) % nmatches;
    ft.selectMatch(nextMatch, forwards);
    ft.curMatch = nextMatch;
    return true;
}

cmd('find-text',
    function(dt, keyName) {
        FindText.startSearch(dt);
        return true;
    });

cmd('find-select-pattern',
    function(dt, key) {
        document.getSelection().selectAllChildren(dt._findText.minibuf);
        return true;
    });

cmd('find-next-match',
    function(dt, key) {
        FindText.doNext(dt, true);
        return true;
    });

cmd('find-previous-match',
    function(dt, key) {
        FindText.doNext(dt, false);
        return true;
    });

cmd('find-exit',
    function(dt, key) {
        dt.removeMiniBuffer(dt._findText.minibuf);
        return true;
    });

cmd('find-toggle-match-case',
    function(dt, key) {
        let ft = dt._findText;
        dt._findMatchCase = ! dt._findMatchCase;
        ft.matchCaseTemplate.checked = dt._findMatchCase;
        ft.updateSearchMode();
        ft.update();
        return true;
    }, {
        context: "terminal"
    });
cmd('find-toggle-match-word',
    function(dt, key) {
        let ft = dt._findText;
        dt._findMatchWord = ! dt._findMatchWord;
        ft.matchWordTemplate.checked = dt._findMatchWord;
        ft.updateSearchMode();
        ft.update();
        return true;
    }, {
        context: "terminal"
    });
cmd('find-toggle-regexp',
    function(dt, key) {
        let ft = dt._findText;
        dt._findRegExp = ! dt._findRegExp;
        ft.matchRegExpTemplate.checked = dt._findRegExp;
        ft.updateSearchMode();
        ft.update();
        return true;
    }, {
        context: "terminal"
    });

FindText.keymap = new window.browserKeymap({
    "Left": 'backward-char',
    "Mod-Left": 'backward-word',
    "Right": 'forward-char',
    "Mod-Right": 'forward-word',
    "Backspace": "backward-delete-char",
    "Mod-Backspace": "backward-delete-word",
    "Delete": "forward-delete-char",
    "Mod-Delete": "forward-delete-word",
    "Enter": "find-next-match",
    "Shift-Enter": "find-previous-match",
    "Down": "find-next-match",
    "Up": "find-previous-match",
    "Home": "beginning-of-line",
    "End": "end-of-line",
    //"Shift-Left": "backward-char-extend",
    //"Shift-Mod-Left": "backward-word-extend",
    //"Shift-Right": "forward-char-extend",
    //"Shift-Mod-Right": "forward-word-extend",
    //"Shift-Home": "beginning-of-line-extend",
    //"Shift-End": "end-of-line-extend",
    "Ctrl-C": "copy-text",
    "Mod-V": "paste-text",
    "Ctrl-Down": "scroll-line-down",
    "Ctrl-Up": "scroll-line-up",
    "Ctrl-PageUp": "scroll-page-up",
    "Ctrl-PageDown": "scroll-page-down",
    "Ctrl-Home": "scroll-top",
    "Ctrl-End": "scroll-bottom",
    "Ctrl-F": "find-select-pattern",
    "Ctrl-Shift-F": "find-select-pattern",
    "Ctrl-X": "cut-text",
    "Ctrl-Shift-X": "cut-text",
    "Alt-C": "find-toggle-match-case",
    "Alt-R": "find-toggle-regexp",
    "Alt-W": "find-toggle-match-word",
    "Esc": "find-exit",
    "(keypress)": "insert-char"
});

FindText.startSearch = function(dt) {
    let ft = new FindText(dt);
    function changeCallback(mrecords, observer) {
        ft.searchString = ft.term._miniBuffer.textContent;
        ft._regexp = null;
        ft.update();
    }
    let minibuf = dt.showMiniBuffer({prefix: "Find: ",
                                     postfix: '<button class="find-text-button" id="find-button-kind">Plain</button><span class="find-result">No results</span></button><button class="find-text-button" id="find-button-previous">\u21e7</button><button  class="find-text-button" id="find-button-next">\u21e9</button>',
                                     keymaps: [ FindText.keymap /*,
                                                DomTerm.lineEditKeymap*/ ],
                                     infoClassName: "domterm-info-widget find-text no-matches",
                                     mutationCallback: changeCallback});
    let panel = minibuf.infoDiv;
    for (let button of panel.querySelectorAll(".find-text-button")) {
        button.addEventListener("click", ft.buttonHandler);
    }
    ft.minibuf = minibuf;
    ft.resultCountView = panel.querySelector(".find-result");;
    dt._findText = ft;
    let mCloseHandler = panel.closeHandler;
    panel.closeHandler = (d) => {
        if (ft.matches !== null)
            ft.unmark();
        dt._findText = undefined;
        if (mCloseHandler)
            mCloseHandler(d);
    };
    ft.updateSearchMode();
    ft.setDirection(true);
    return ft;
}

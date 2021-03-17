export { FindText };
import { Terminal } from './terminal.js';
import { commandMap, cmd } from './commands.js';

class FindText {
    constructor(term) {
        this.term = term;

        this.mark = new Mark(term.getAllBuffers());
        this.searchString = "";
        this.searchRegExp = false;
        this.matches = null;
        this.curMatch = -1;
        //if (dt.viewCaretNode && dt.viewCaretNode.parentNode)
        // ; // FIXME
        this.basePosition = term._positionToRange();
        this.currentlyForwards = true;
        this.buttonHandler = (event) => {
            let id = event.target.getAttribute("id");
            FindText.doNext(term, id==='find-button-next');
        };
    }

    update() {
        let text = this.term._miniBuffer.textContent;
        console.log("findtext changed "+JSON.stringify(text));
        if (this.matches !== null)
            this.mark.unmark();
        if (text.length == 0) {
            this.matches = null;
            this.resultCountView.innerHTML = `No results`;
            this.resultCountView.classList.remove("not-found");
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
        if (this.searchRegExp) {
            this.mark.markRegExp(text, options);
        } else {
            this.mark.mark(text, options);
        }
        this.curMatch = -1;
        this.curMatch = this.findFollowingMatch(this.currentlyForwards);
        if (this.matches.length) {
            this.selectMatch(this.curMatch, this.currentlyForwards);
            this.resultCountView.classList.remove("not-found");
        } else {
            this.resultCountView.innerHTML = `No results`;
            this.resultCountView.classList.add("not-found");
        }
    }
    selectMatch(index, forwards) {
        let parts = this.matches[index];
        let nparts = parts.length;
        let range = document.createRange();
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
    console.log("do find-doNext frow:"+forwards);
    let ft = dt._findText;
    ft.currentlyForwards = forwards;
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

cmd('find-next-match',
    function(dt, key) {
        return FindText.doNext(dt, true);
    });

cmd('find-previous-match',
    function(dt, key) {
        return FindText.doNext(dt, false);
    });

cmd('find-exit',
    function(dt, key) {
        let ft = dt._findText;
        if (ft.matches !== null)
            ft.mark.unmark();
        dt.removeMiniBuffer(ft.minibuf);
        dt._findText = undefined;
        return true;
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
    "Ctrl-C": "copy-text",
    "Mod-V": "paste-text",
    "Ctrl-X": "cut-text",
    "Ctrl-Shift-X": "cut-text",
    "Esc": "find-exit",
    "(keypress)": "insert-char"
});

FindText.startSearch = function(dt) {
    let ft = new FindText(dt);
    function changeCallback(mrecords, observer) {
        ft.update();
    }
    let minibuf = dt.showMiniBuffer({prefix: "Find: ",
                                     postfix: ' <span class="find-result">No results</span><button class="find-text-button" id="find-button-previous">\u21e7</button><button  class="find-text-button" id="find-button-next">\u21e9</button>',
                                     keymaps: [ FindText.keymap /*,
                                                DomTerm.lineEditKeymap*/ ],
                                     infoClassName: "find-text",
                                     mutationCallback: changeCallback});
    for (let button of minibuf.infoDiv.querySelectorAll(".find-text-button")) {
        button.addEventListener("click", ft.buttonHandler);
    }
    ft.minibuf = minibuf;
    ft.resultCountView = minibuf.nextSibling.nextSibling;
    dt._findText = ft;
    return ft;
}

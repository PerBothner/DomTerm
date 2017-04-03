DomTerm.prototype._currentlyPagingOrPaused = function() {
    return this._pagingMode > 0;
};

DomTerm.prototype._pagerModeInfo = function() {
    var prefix =  this._pagingMode == 2 ? "<b>PAUSED</b>" : "<b>PAGER</b>";
    if (this._pageNumericArgument) {
        return prefix+": numeric argument: "+this._pageNumericArgument;
    }
    return prefix+": type SPACE for more; Ctrl-Shift-P to exit paging";
}

DomTerm.prototype._updatePagerInfo = function() {
    if (this._currentlyPagingOrPaused()) {
        this._displayInfoMessage(this._pagerModeInfo());
    } else {
        this._clearInfoMessage();
    }
}

DomTerm.prototype._pageScrollAbsolute = function(percent) {
    if (percent < 0)
        percent = 0;
    else if (percent >= 100)
        percent = 100;
    var scrollTop = percent * this._vspacer.offsetTop * 0.01;
    var limit = scrollTop + this.availHeight;
    if (limit > this._pauseLimit)
        this._pauseLimit = limit;
    var vtop = this._vspacer.offsetTop;
    if (limit > vtop) {// set _displayPostEofPage mode
        var vpad = limit - vtop;
        var maxpad = this.availHeight - charHeight; // matches 'less'
        this._adjustSpacer(vpad > maxMap ? maxpad : vpad);
    }
    this.topNode.scrollTop = scrollTop;
}

DomTerm.prototype._pageScroll = function(delta) {
    var scroll = this.topNode.scrollTop;
    var limit = scroll + this.availHeight;
    var vtop = this._vspacer.offsetTop;
    if (limit < vtop)
        limit = vtop;
    limit += delta;
    var extend = limit > this._pauseLimit;
    if (extend)
        this._pauseLimit = limit;
    scroll += delta;
    if (scroll < 0)
        scroll = 0;
    // FIXME actual limit is this._vspacer.offsetTop - availHeight
    // adjusted by vspacer height
    else if (scroll > vtop)
        scroll = vtop;
    // FIXME may do nothing if spacer size is empty
    this.topNode.scrollTop = scroll;
    if (extend)
        this._pauseContinue();
    else
        this._temporaryAutoPaging = false;
}

DomTerm.prototype._pagePage = function(count) {
    var xxxold = this.topNode.scrollTop;
    this._pageScroll(count * this.availHeight - this.charHeight);
    if (this.verbosity >= 2)
        this.log("after pagePage "+count+" offset:"+xxxold+"->"+this.topNode.scrollTop);
}

DomTerm.prototype._pageLine = function(count) {
    this._pageScroll(count * this.charHeight);
}

DomTerm.prototype._pageTop = function() {
    this.topNode.scrollTop = 0;
}

DomTerm.prototype._pageBottom = function() {
    this.topNode.scrollTop = this._vspacer.offsetTop;
}

DomTerm.prototype._enterPaging = function(pause) {
    // this._displayInputModeWithTimeout(displayString);
    this._pageNumericArgumentClear();
    this._temporaryAutoPaging = false;
    this._pagingMode = pause ? 2 : 1;
    this._updatePagerInfo();
}

DomTerm.prototype._exitPaging = function() {
    this._pagingMode = 0;
    this._updatePagerInfo();
}

DomTerm.prototype._pageNumericArgumentGet = function(def = 1) {
    var arg = this._pageNumericArgument;
    return arg == null ? def : Number(arg);
}
DomTerm.prototype._pageNumericArgumentClear = function() {
    var hadValue =  this._pageNumericArgument;
    this._pageNumericArgument = null;
    if (hadValue)
        this._updatePagerInfo();
}
DomTerm.prototype._pageNumericArgumentAndClear = function(def = 1) {
    var val = this._pageNumericArgumentGet(def);
    this._pageNumericArgumentClear();
    return val;
}

DomTerm.prototype._pageKeyHandler = function(event, key, press) {
    var arg = this._pageNumericArgument;
    // Shift-PagUp and Shift-PageDown should maybe work in all modes?
    // Ctrl-Shift-Up / C-S-Down to scroll by one line, in all modes?
    if (this.verbosity >= 2)
        this.log("page-key key:"+key+" event:"+event+" press:"+press);
    switch (key) {
        // C-Home start
        // C-End end
    case 13: // Enter
        this._temporaryAutoPaging = this._pagingMode == 2;
        this._pageLine(this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 33: // Page-up
        // Also Shift-Space
        // Also backspace? DEL? 'b'?
        this._pagePage(- this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 32: // Space
        this._temporaryAutoPaging = this._pagingMode == 2;
        // ... fall through ...
    case 34: // Page-down
        this._pagePage(this._pageNumericArgumentAndClear(1));
        event.preventDefault();
        break;
    case 36: // Home
        this._pageTop();
        event.preventDefault();
        break;
     case 35: // End
        this._pageBottom();
        event.preventDefault();
        break;
    case 40 /*Down*/:
        this._temporaryAutoPaging = this._pagingMode == 2;
        // ... fall through ...
    case 38 /*Up*/:
        this._pageLine(key == 38 ? -1 : 1);
        event.preventDefault();
        break;
    case 80: // 'P'
        var oldMode = this._pagingMode;
        if (oldMode==2)
            this._pauseContinue();
        this._enterPaging(oldMode==1);
        event.preventDefault();
        break;
    case 112: // 'p'
    case 37: // '%'
        // MAYBE: 'p' relative to current "group"; 'P' relative to absline 0.
        // MAYBE: 'P' toggle pager/pause mode
        this._pageScrollAbsolute(this._pageNumericArgumentAndClear(50));
        event.preventDefault();
        break;
    case 65: // 'A'
        if (event.shiftKey) {
            this._autoPaging = ! this._autoPaging;
            this._displayInfoWithTimeout("<b>PAGER</b>: auto paging mode "
                                             +(this._autoPaging?"on":"off"));
            event.preventDefault();
        }
        break;
    case 67:
        if (event.ctrlKey) {
            this.reportKeyEvent(3, this.keyDownToString(event));
            this._pauseContinue();
            event.preventDefault();
        }
        break;
    default:
        if (press) {
            var arg = this._pageNumericArgument;
            var next = String.fromCharCode(key);
            // '0'..'9' || '-' and initial || .'.
            if ((key >= 48 && key <= 57) || (key == 45 && ! arg) || key == 46) {
                arg = arg ? arg + next : next;
                this._pageNumericArgument = arg;
                event.preventDefault();
                this._updatePagerInfo();
            } else if (key == 46) { // "." FIXME desired for '%'
            }
        }
    }
};

/*
DomTerm.prototype._togglePaging = function() {
    if (this._inPagingMode) {
        this._exitPaging();
        this._inPagingMode = false;
    } else {
        this._enterPaging();
        this._inPagingMode = true;
    }
    this._updatePagerInfo();
}
*/

DomTerm.prototype._pauseNeeded = function() {
    return (this._pagingMode > 0
            || this._autoPaging || this._temporaryAutoPaging)
        && this._vspacer.offsetTop + this.charHeight > this._pauseLimit
    // && this._pauseLimit >= 0
        && this._regionBottom == this.numRows
        && this.getCursorLine() == this._regionBottom-1;
};

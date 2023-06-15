export { Setting, EvalContext, convertValue, evaluateTemplate, EVAL_TO_NUMBER, EVAL_TO_BOOLEAN, EVAL_TO_HYBRID, EVAL_TO_STRING, EVAL_TO_LIST };

const EVAL_TO_LIST = 1;
const EVAL_TO_STRING = 2;
const EVAL_TO_BOOLEAN = 4;
const EVAL_TO_NUMBER = 8;
// Evaluate a "word" to an array of values, which are conceptually
// concatenated together. Elements are booleans, number, or strings.
// String elements appear in odd-numbered groups: The initial (and every other)
// string element is unquoted text; the second (if any) (and every other)
// element is quoted text.
// For example, abc\nde"xy"z becomes: ["abc", "\n", "de" "xy" "z"]
const EVAL_TO_HYBRID = 16;

class Setting {
    constructor(name) {
        this.name = name;
        this.template = undefined;
        this.defaultTemplate = undefined;
        this.value = undefined;
        this.invalid = true;
        this.listeners = new Set();
        this.dependencies = [];
        this.onChangeAction = undefined;
        this.evalMode = 0;
        this.evaluateTemplate = (context) => {
            return evaluateTemplate(context, this.evalMode);
        };
    }

    update(newValue, context) {
        this.invalid = false;
        const oldValue = this.value;
        if (! EvalContext.sameValue(newValue, oldValue)) {
            this.value = newValue;
            if (this.onChangeAction)
                this.onChangeAction(this, context);
            for (const listener of this.listeners) {
                context.pushPending(listener);
            }
        }
    }

    noteDependency(dependency) {
        if (! dependency.listeners.has(this)) {
            dependency.listeners.add(this);
            this.dependencies.push(dependency);
        }
    }

    get(context) {
        if (this.invalid) {
            context.pushSetting(this);
            this.update(this.evaluateTemplate(context), context);
            context.popSetting();
        }
        return this.value;
    }
    recalculate(context) {
        const oldValue = this.value;
        context.pushSetting(this);
        this.update(this.evaluateTemplate(context), context);
        context.popSetting();
    }
}

function defaultReportError(context, message) {
    console.log("setting "+context?.curSetting.name+": "+message);
}

class EvalContext {
    constructor(pane) {
        this.skipNesting = 0;
        this.pane = pane;
        this.reportError = defaultReportError;
        this.saveStack = [];
        this.pendingSettings = [];
    }

    setSetting(setting) {
        this.template = setting.template;
        this.curIndex = 0;
        this.curSetting = setting;
    }

    pushSetting(setting) {
        if (this.saveStack.length >= 30)
            throw "self-reference evaluating "+setting.name;
        this.saveStack.push(this.template);
        this.saveStack.push(this.curIndex);
        this.saveStack.push(this.curSetting);
        this.template = setting.template;
        this.curIndex = 0;
        this.curSetting = setting;
    }

    popSetting() {
        this.curSetting = this.saveStack.pop();
        this.curIndex = this.saveStack.pop();
        this.template = this.saveStack.pop();
    }

    pushPending(setting) {
        setting.invalid = true;
        if (this.pendingSettings.indexOf(setting) < 0)
            this.pendingSettings.push(setting);
    }

    addCleanupHook(hook) {
        const oldCleanup = this.cleanupHook;
        if (! oldCleanup)
            this.cleanupHook = hook;
        else
            this.cleanupHook = (context) => {
                oldCleanup(context);
                hook(context);
            };
    }

    handlePending() {
        for (;;) {
            const setting = this.pendingSettings.pop();
            if (! setting)
                break;
            if (setting.invalid) {
                setting.recalculate(this);
            }
        }
        for (;;) {
            const cleanupHook = this.cleanupHook;
            if (! cleanupHook)
                break;
            this.cleanupHook = undefined;
            cleanupHook(this);
        }
    }

    skipSpaces(skipNewLines = false) {
        let i = this.curIndex;
        let template = this.template;
        let end = template.length;
        let result = undefined;
        let ch;
        for (;;) {
            if (i >= end) {
                ch = -1;
                break;
            }
            ch = template.charCodeAt(i);
            if (ch !== 32 && ch !== 9 && (ch != 10 || !skipNewLines)) {
                break;
            }
            i++;
        }
        this.curIndex = i;
        return ch;
    }

    lookupOperator(name) {
        return this.pane?.settings[name];
    }
};

EvalContext.sameValue = function(val1, val2, nesting = 0) {
    if (Object.is(val1, val2))
        return true;
    if (nesting >= 5)
        return false;
    if (val1 instanceof Array && val2 instanceof Array) {
        const len1 = val1.length;
        const len2 = val2.length;
        if (len1 !== len2)
            return false;
        for (let i = 0; i < len1; i++) {
            if (! EvalContext.sameValue(val1[i], val2[i], nesting + 1))
                return false;
        }
        return true;
    }
    if (val1 instanceof Element && val2 instanceof Element)
        return val1.outerHTML === val2.outerHTML;
    return false;
}

function evaluateTemplate(context, mode) {
    return evaluatePhrase(context, mode);
};

// Evaluate a sequence of words.
// Ended by unquoted newline, ';', '}' or end-of-string.
function evaluatePhrase(context, mode) {
    const listMode = mode|EVAL_TO_LIST;
    let result = [];
    for (;;) {
        let ch = context.skipSpaces();
        // stop if end, or '}' or ';' or '\n'.
        if (ch === -1 || ch === 125 || ch === 59 || ch === 10)
            break;
        const word = evaluateWord(context, listMode);
        result = result.concat(word);
    }
    return convertValue(result, listMode, mode, context);
}

class TemplateFunction {
    constructor(name, apply) {
        this.name = name;
        this.apply = apply;
    }
};

const templateFunctions = (() => {
    let table = {};
    function make(name, apply) {
        let f = new TemplateFunction(name, apply);
        table[name] = f;
        return f;
    }
    function makeNumeric(name, apply) {
        let f = make(name, apply);
        table[name] = f;
        f.expectedMode = (argno) => EVAL_TO_NUMBER;
        return f;
    }
    makeNumeric(
        "+",
        (args) => {
            let r = 0;
            for (const arg of args ) { r += arg; }
            return r;
        });
    makeNumeric(
        "*",
        (args) => {
            let r = 1;
            for (const arg of args ) { r *= arg; }
            return r;
        });
    return table;
})();

// After '{?'
function evaluateCondition(context, mode) {
    let template = context.template;
    let end = template.length;
    let result;
    for (;;) {
        // After '{?' or ';?'
        let selected = false;
        for (;;) {
            let ch = context.skipSpaces(true);
            if (ch < 0 || ch === 125) { // end or '}
                // FUTURE: Allow {?cond}A;B instead of {?cond;A;B}
                context.reportError(context, "missing ending ';' after '{?'");
                break;
            }
            if (ch === 59) { // ';'
                context.curIndex++;
                break;
            }
            let negate = ch === 33; // '!'
            if (negate) context.curIndex++;
            let val = evaluateWord(context, EVAL_TO_BOOLEAN);
            if (! selected && negate ? ! val : val) {
                selected = true;
                context.skipNesting++;
            }
        }
        if (selected) {  // undo above skipNesting++
            context.skipNesting--;
        }
        if (! selected) {
            context.skipNesting++;
        }
        let value = evaluatePhrase(context, mode);
        if (! selected) {
            context.skipNesting--;
        }
        if (selected)
            result = value;
        let ch = context.skipSpaces();
        if (ch === -1 || ch === 125) { // end of string or '}'
            context.reportError("non-terminated condiional");
            if (selected)
                return value;
            else
                return convertValue("", EVAL_TO_STRING, mode, context);
        } else { // ch is ';' or '\n'
            context.curIndex++;
            ch = context.curIndex < end ? template.charCodeAt(context.curIndex) : -1;
            if (ch === 63) { // '?'
                context.curIndex++;
            } else {
                if (selected) {
                    context.skipNesting++;
                }
                value = evaluatePhrase(context, mode);
                if (selected) {
                    context.skipNesting--;
                }
                if (! selected)
                    result = value;
                return result;
            }
        }
    }
}

function appendHybrid(hybrid, value) {
    if (typeof value === "string")
        value = ["", value, ""];
    if (value instanceof Array) {
        const vlen = value.length;
        if (vlen === 0)
            return;
        const first = value[0];
        const prevWasString = hybrid.length > 0
              && typeof hybrid[hybrid.length-1] === "string";
        let start = 0;
        if (prevWasString && typeof first === "string") {
            start = 1;
            hybrid[hybrid.length-1] += first;
        }
        for (let i = start; i < vlen; i++)
            hybrid.push(value[i]);
    } else
        hybrid.push(value);
}

// Return a "word" as a string.
// Future may support number of return value, depending on options.
function evaluateWord(context, mode) {
    let i = context.curIndex;
    let template = context.template;
    let end = template.length;
    const buildHybrid = (mode & (EVAL_TO_HYBRID|EVAL_TO_BOOLEAN)) !== 0;
    let tmode = buildHybrid ? EVAL_TO_HYBRID : EVAL_TO_STRING;
    // either an array or a string
    let result = buildHybrid ? [] : "";
    context.skipSpaces();
    for (;; ) {
        if (i >= end)
            break;
        let ch = template.charCodeAt(i++);
        if (ch === 32 || ch === 9) { // SPACE or '\t'
            break;
        } else if (ch === 34 || ch === 39) { // '\"' or '\''
            context.curIndex = i;
            let str = evaluateQuotedString(context, ch);
            i = context.curIndex;
            if (! buildHybrid)
                result += str;
            else
                appendHybrid(result, ["", str, ""]);
        } else if (ch === 123) { // '{'
            if (i < end && template.charCodeAt(i) === 63) { // '?'
                context.curIndex = i + 1;
                result += evaluateCondition(context, mode); // FIXME
                i = context.curIndex;
            } else {
                context.curIndex = i;
                let str = evaluateWord(context, EVAL_TO_STRING);
                let fun = templateFunctions[str];
                let op = context.lookupOperator(str);
                let args = [];
                for (let iarg = 1;; iarg++) {
                    if (context.curIndex >= end) {
                        context.reportError(context, "missing '}'");
                        i = end;
                        break;
                    }
                    let ch = context.skipSpaces();
                    if (ch === 125) { // '}'
                        i = context.curIndex + 1;
                        break;
                    }
                    let argmode = fun && fun.expectedMode ? fun.expectedMode(iarg): 0;
                    argmode &= ~EVAL_TO_LIST; // FIXME
                    let arg = evaluateWord(context, argmode);
                    args.push(arg);
                }
                if (context.skipNesting > 0) {
                    result = "skip";
                } else if (fun) {
                    result = fun.apply(args);
                } else if (op instanceof Setting) {
                    if (context.curSetting)
                        context.curSetting.noteDependency(op);
                    let val = convertValue(op.get(context), op.evalMode,
                                           tmode, context);
                    if (buildHybrid)
                        appendHybrid(result, val);
                    else
                        result += val;
                } else {
                    context.reportError(context, `unknown function or variable ${str}`);
                    result = '???';
                }
            }
        } else if (ch === 125 || ch == 59) { // '}' or ';'
            i--;
            break;
        } else if (ch === 92) { // '\\'
            context.curIndex = i;
            let ch = evaluateStringEscape(context);
            i = context.curIndex;
            result += ch; // FIXME
        } else {
            const str = String.fromCodePoint(ch);
            if (! buildHybrid)
                result += str;
            else
                appendHybrid(result, [str]);
        }
    }
    context.curIndex = i;
    return convertValue(result, tmode, mode, context);
}

function evaluateStringEscape(context) {
    let i = context.curIndex;
    let template = context.template;
    let end = template.length;
    let ch = i < end ? template.charCodeAt(i++) : -1;
    let errval = 63; // '?'
    switch (ch) {
    case -1:
        context.reportError(context, 'incomplete string escape');
        break;
    case 97: ch = 7; break; // '\a'
    case 98: ch = 8; break; // '\b'
    case 101: ch = 27; break; // '\e' -> Escape
    case 102: ch = 12; break; // '\f'
    case 110: ch = 10; break; // '\n'
    case 114: ch = 13; break; // '\r'
    case 116: ch = 9; break; // '\t'
    case 118: ch = 11; break; // '\v'
    case 34: // '"'
    case 39: // '\''
    case 47: // '/' (JSON)
    case 92: // '\\'
        break;
    case 117: // '\uXXXX' or '\u{XXXXXX}'
        let next = i < end ? template.charCodeAt(i) : -1;
        let maxDigits = 4;
        const sawCurly = i < end && template.charCodeAt(i) === 123;
        if (sawCurly) {
            i++;
            maxDigits = 12; // actually 6, but better error-handling
        }
        let j = i;
        while (j < end && j <= i + maxDigits) {
            let d = template.charCodeAt(j);
            if ((d >= 48 && d <= 57) || (d >= 65 && d <= 70) || (d >= 97 && d <= 102))
                j++;
            else
                break;
        }
        if (i === j) {
            context.reportError(context, "missing hex digits after \\u");
            ch = errval;
        } else {
            ch = parseInt(template.substring(i, j), 16);
        }
        if (sawCurly) {
            if (j === end || template.charCodeAt(j) !== 125) {
                context.reportError(context, "missing '}' after '\\u{HEX' escape");
            } else {
                if (j > i + 6)
                    context.reportError(context, "too many hex digits in '\\u{HEX' escape");
                j++;
            }
        }
        i = j;
        break;
    default:
        ch = errval;
        context.reportError(context, 'unknown string escape \\' + template.charAt(i-1));
        break;
    }
    context.curIndex = i;
    return ch < 0 ? '' : String.fromCodePoint(ch);
}

function evaluateQuotedString(context, delim) {
    // Don't handle '\\' escapes in a single-quoted 'string'.
    const handleEscapes = delim == 39;
    // However, two '\'' in a row becomes a single '\''.
    const quoteIfDoubled = delim == 39;
    let i = context.curIndex;
    let template = context.template;
    let end = template.length;
    let result = '';
    for (;; ) {
        if (i >= end) {
            context.reportError(context, "missing end of quoted string");
            break;
        }
        let ch = template.charCodeAt(i++);
        if (ch === delim) {
            if (quoteIfDoubled && i < end && template.charCodeAt(i) === delimit) {
                result += String.fromCharCode(delim);
                i++;
            } else {
                break;
            }
        }
        if (ch === 92 && handleEscapes) { // '\\'
            context.curIndex = i;
            let ch = evaluateStringEscape(context);
            i = context.curIndex; 
           result += ch;
        } else {
            let j = i;
            while (j < end && (ch = template.charCodeAt(j)) !== delim
                   && !(ch === 92 && handleEscapes)) {
                j++;
            }
            result += template.substring(i - 1, j);
            i = j;
        }
    }
    context.curIndex = i;
    return result;
}


function convertValue(value, srcMode, dstMode, context) {
    if (srcMode === dstMode)
        return value;
    // non-list to list
    if ((srcMode & EVAL_TO_LIST) === 0
        && (dstMode & EVAL_TO_LIST) !== 0) {
        return [convertValue(value, srcMode,
                             dstMode & ~EVAL_TO_LIST,
                             context)];
    }
    // list to non-list
    if ((srcMode & EVAL_TO_LIST) !== 0
        && (dstMode & EVAL_TO_LIST) === 0) {
        if (value.length === 1)
         return convertValue(value[0], srcMode & ~EVAL_TO_LIST,
                             dstMode, context);
        // convert to string - convert each element, separated by space
        if ((dstMode & EVAL_TO_STRING) !== 0) {
            let result = '';
            let first = true;
            for (const el of value) {
                let str = convertValue(el, srcMode & ~EVAL_TO_LIST,
                                       dstMode, context);
                if (first)
                    result += " ";
                result += str;
                first = false;
            }
            return result;
        }
        if ((dstMode & EVAL_TO_HYBRID) !== 0) {
            // FIXME
        }
        context.reportError(context, "invalid conversion");
        return (dstMode & EVAL_TO_NUMBER) !== 0 ? NaN : false;
    }
    if ((srcMode & EVAL_TO_LIST) !== 0
        && (dstMode & EVAL_TO_LIST) !== 0) {
        let result = [];
        for (const el of value) {
            el.push(convertValue(el, srcMode & ~EVAL_TO_LIST,
                                 dstMode & ~EVAL_TO_LIST,
                                 context));
        }
        return result;
    }
    // non-list to non-list
    if ((dstMode & EVAL_TO_STRING) !== 0
        || (dstMode & EVAL_TO_NUMBER) !== 0) {
        if ((srcMode & EVAL_TO_HYBRID) != 0) {
            let str = "";
            for (const el of value)
                str += `${el}`;
            value = str;
        } else
            value = `${value}`;
        if ((dstMode & EVAL_TO_NUMBER) !== 0) {
            const num = Number(value);
            if (isNaN(num) && value.trim() != "NaN")
                context.reportError(context, "value is not a number");
            value = num;
        }
        return value;
    }
    if ((dstMode & EVAL_TO_BOOLEAN) !== 0) {
        if ((srcMode & EVAL_TO_STRING) !== 0)
            return value.length > 0;
        if ((srcMode & EVAL_TO_NUMBER) !== 0)
            return value > 0;
        if ((srcMode & EVAL_TO_NUMBER) !== 0)
            return value > 0;
        if ((srcMode & EVAL_TO_HYBRID) !== 0) {
            if (value.length == 1) {
                let el = value[0];
                if (typeof el === "string") {
                    if (el === "true" || el === "yes" || el === "on" || el === "1")
                        return true;
                    if (el !== "false" && el !== "no" && el !== "off" && el !== "0")
                        context.reportError(context, `cannot convert ${JSON.stringify(el)} to boolean`);
                    return false;
                } else {
                    return !!el;
                }
            } else if (value.length === 3
                       && value[0] === "" && value[2] === "")
                return value[1].length > 0;
            else {
                context.reportError(context, "cannot convert value to boolean");
                return false;
            }
        }
    }
    if ((dstMode & EVAL_TO_HYBRID) !== 0) {
        if ((srcMode & EVAL_TO_STRING) !== 0)
            value = ["", value, ""];
        else
            value = [value];
    }
    return value;
}

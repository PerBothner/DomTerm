import * as UnicodeProperties from './unicode/uc-properties.js';

export class DPosition {
    constructor(parent = undefined, offset = undefined) {
        this.parent = parent;
        /** Offset in parent */
        this.offset = offset;
        this.before = undefined;
        /** X cordinate  of position/caret, in px units relative to viewport. */
        this.x = undefined;
        /** Top of position/caret, in px units relative to viewport. */
        this.top = undefined;
        /** Bottom of position/caret, in px units relative to viewport. */
        this.top = undefined;
    }
};

function jsonReplacer(key, value) {
    if (value instanceof Map) {
        return { "%T": "Map", "$V": Array.from(value.entries()) };
    } else {
        return value;
    }
}

function jsonReviver(key, value) {
    if (typeof value === "object" && value !== null) {
        if (value["%T"] === "Map")
            return new Map(value["$V"]);
    }
    return value;
}

export function toJson(value) {
    return JSON.stringify(value, jsonReplacer);
}

export function fromJson(text) {
    return JSON.parse(text, jsonReviver);
}

const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

export function escapeText(text) {
    // Assume single quote is not used in attributes
    return text.replace(/[&<>"]/g,
                        function(m) { return escapeMap[m]; });
};

// Like Number.toFixed, but strip off trailing zeros and decimal point
export function toFixed(n, d) {
    let s = Number(n).toFixed(d);
    let nzeros = 0;
    let len = s.length;
    for (;;) {
        let last = s.charAt(len-nzeros-1);
        if (last !== '0' && last !== '.')
            break;
        nzeros++;
        if (last == '.')
            break;
    }
    return nzeros ? s.substring(0, len-nzeros) : s;
}

const ELEMENT_KIND_ALLOW = 1; // Allow in inserted HTML
const ELEMENT_KIND_CHECK_JS_TAG = 2; // Check href/src for "javascript:"
const ELEMENT_KIND_INLINE = 4; // Phrasing [inline] content
const ELEMENT_KIND_SVG = 8; // Allow in SVG
const ELEMENT_KIND_MATH = 512; // Allow in MathML
const ELEMENT_KIND_EMPTY = 16; // Void (empty) HTML element, like <hr>
const ELEMENT_KIND_TABLE = 32; // allowed in table
const ELEMENT_KIND_SKIP_TAG = 64; // ignore (skip) element (tag)
const ELEMENT_KIND_CONVERT_TO_DIV = 128; // used for <body> and <html>
const ELEMENT_KIND_SKIP_FULLY = 256; // skip element (tag and contents)
const ELEMENT_KIND_SKIP_TAG_OR_FULLY = ELEMENT_KIND_SKIP_TAG+ELEMENT_KIND_SKIP_FULLY;

//FIXME Study the following:
//https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet

// See elementInfo comment for bit values.
const HTMLinfo = {
    "a": ELEMENT_KIND_INLINE+ELEMENT_KIND_CHECK_JS_TAG+ELEMENT_KIND_ALLOW,
    "abbr": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "acronym": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "address": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "altGlyph": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "altGlyphDef": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "altGlyphItem": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "animate": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "animateColor": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "animateMotion": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "animateTransform": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "area": 0x14,
    "b": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "base": ELEMENT_KIND_SKIP_TAG+ELEMENT_KIND_EMPTY+ELEMENT_KIND_CHECK_JS_TAG+ELEMENT_KIND_ALLOW,
    "basefont": ELEMENT_KIND_EMPTY, //obsolete
    "big": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "blockquote": ELEMENT_KIND_ALLOW,
    "br": ELEMENT_KIND_EMPTY+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "body": ELEMENT_KIND_CONVERT_TO_DIV+ELEMENT_KIND_ALLOW,
    "canvas": ELEMENT_KIND_INLINE,
    "center": ELEMENT_KIND_ALLOW,
    "circle": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "cite": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "clipPath": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "code": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "col": 0x11,
    "color-profile": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "command": 0x15, // obsolete
    "cursor": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "dd": ELEMENT_KIND_ALLOW,
    "dfn": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "defs": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "desc": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "div": ELEMENT_KIND_ALLOW,
    "dl": ELEMENT_KIND_ALLOW,
    "dt": ELEMENT_KIND_ALLOW,
    "ellipse": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "em": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "embed": 0x14,
    "feBlend": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feColorMatrix": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feComponentTransfer": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feComposite": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feConvolveMatrix": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feDiffuseLighting": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feDisplacementMap": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feDistantLight": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feFlood": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feFuncA": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feFuncB": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feFuncG": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feFuncR": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feGaussianBlur": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feImage": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feMerge": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feMergeNode": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feMorphology": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feOffset": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "fePointLight": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feSpecularLighting": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feSpotLight": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feTile": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "feTurbulence": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "figcaption": ELEMENT_KIND_ALLOW,
    "figure": ELEMENT_KIND_ALLOW,
    "filter": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font-face": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font-face-format": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font-face-name": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font-face-src": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "font-face-uri": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "foreignObject": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "frame": ELEMENT_KIND_EMPTY,
    "g": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "glyph": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "glyphRef": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "h1": ELEMENT_KIND_ALLOW,
    "h2": ELEMENT_KIND_ALLOW,
    "h3": ELEMENT_KIND_ALLOW,
    "h4": ELEMENT_KIND_ALLOW,
    "h5": ELEMENT_KIND_ALLOW,
    "h6": ELEMENT_KIND_ALLOW,
    "head": ELEMENT_KIND_SKIP_TAG+ELEMENT_KIND_ALLOW,
    "header": ELEMENT_KIND_ALLOW,
    "hkern": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "hr": ELEMENT_KIND_EMPTY+ELEMENT_KIND_ALLOW,
    "html": ELEMENT_KIND_CONVERT_TO_DIV+ELEMENT_KIND_ALLOW,
    "i": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "iframe": ELEMENT_KIND_ALLOW,
    "image": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE, // FIXME
    "img": ELEMENT_KIND_EMPTY+ELEMENT_KIND_INLINE+ELEMENT_KIND_CHECK_JS_TAG+ELEMENT_KIND_ALLOW,
    "input": 0x15,
    //"isindex": 0x10, //metadata
    "kbd": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "keygen": 0x15,
    "li": ELEMENT_KIND_ALLOW,
    "line": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "linearGradient": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "link": ELEMENT_KIND_SKIP_TAG+ELEMENT_KIND_EMPTY+ELEMENT_KIND_ALLOW,
    "maction": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "maligngroup": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "malignmark": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mark": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "marker": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "mask": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "math": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "menclose": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "merror": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mfrac": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "meta": ELEMENT_KIND_SKIP_TAG+ELEMENT_KIND_EMPTY+ELEMENT_KIND_ALLOW,
    "metadata": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "mi": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "missing-glyph": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "mlongdiv": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mmultiscripts": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mn": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mo": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mover": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mpadded": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mpath": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "mphantom": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mroot": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mrow": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "ms": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mscarries": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mscarry": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msgroup": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msline": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mspace": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msqrt": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msrow": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mstack": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mstyle": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msub": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msubsup": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "msup": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mtable": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mtd": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mtext": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "mtr": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "munder": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "munderover": ELEMENT_KIND_MATH+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "ol": ELEMENT_KIND_ALLOW,
    "p": ELEMENT_KIND_ALLOW,
    //"para": ELEMENT_KIND_EMPTY, //???
    "param": ELEMENT_KIND_EMPTY, // invalid
    "path": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "pattern": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "polygon": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "polyline": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "pre": ELEMENT_KIND_ALLOW,
    "q": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "radialGradient": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "rect": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "rdf:RDF": ELEMENT_KIND_SKIP_FULLY+ELEMENT_KIND_ALLOW,
    "samp": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "script": ELEMENT_KIND_SKIP_FULLY+ELEMENT_KIND_ALLOW,
    "set": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "small": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "sodipodi:namedview": ELEMENT_KIND_SKIP_FULLY+ELEMENT_KIND_ALLOW, // Inkscape metadata
    "source": ELEMENT_KIND_EMPTY, // invalid
    "span": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "stop": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "strong": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "style": ELEMENT_KIND_SVG+ELEMENT_KIND_SKIP_FULLY+ELEMENT_KIND_ALLOW,
    "sub": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "sup": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "svg": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "switch": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "symbol": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "table": ELEMENT_KIND_ALLOW,
    "tbody": ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "thead": ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "tfoot": ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "tr": ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "td": ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "text": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "textPath": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "th": ELEMENT_KIND_INLINE+ELEMENT_KIND_TABLE+ELEMENT_KIND_ALLOW,
    "title": ELEMENT_KIND_SKIP_FULLY+ELEMENT_KIND_SVG+ELEMENT_KIND_ALLOW,
    //"track": ELEMENT_KIND_EMPTY,
    "tref": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "tspan": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "tt": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "u": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "ul": 1,
    "use": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "view": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "var": ELEMENT_KIND_INLINE+ELEMENT_KIND_ALLOW,
    "vkern": ELEMENT_KIND_SVG+ELEMENT_KIND_INLINE,
    "wbr": 0x15,

    // Phrasing content:
    //area (if it is a descendant of a map element) audio bdi bdo br button canvas data datalist del embed iframe input ins kbd keygen label map math meter noscript object output progress q ruby s select svg template textarea time u  video wbr text
};

function elementInfo(tag, parents=null) {
    var v = HTMLinfo.hasOwnProperty(tag)
        ||  HTMLinfo.hasOwnProperty(tag = tag.toLowerCase())
        ? HTMLinfo[tag]
        : 0;

    if ((v & ELEMENT_KIND_SVG) != 0 && parents) {
        // If allow in SVG, check parents for svg
        for (var i = parents.length; --i >= 0; ) {
            if (parents[i] == "svg") {
                v |= ELEMENT_KIND_ALLOW;
                v &= ~ELEMENT_KIND_SKIP_TAG_OR_FULLY;
                break;
            }
        }
    }
    return v;
};

export function scrubHtml(str, options = {}) {
    function skipWhitespace(pos) {
        for (; pos < len; pos++) {
            let c = str.charCodeAt(pos);
            if (c != 32 && (c < 8 || c > 13))
                break;
        }
        return pos;
    }
    var doctypeRE = /^\s*<!DOCTYPE\s[^>]*>\s*/;
    var xmldeclRE = /^\s*<[?]xml version=[^>]*>\s*/;
    var len = str.length;
    var baseUrl = null;
    var start = 0;
    var ok = 0;
    var i = 0;
    let skipping = 0;

    var activeTags = new Array();
    loop:
    for (;;) {
        if (i == len) {
            ok = i;
            break;
        }
        var ch = str.charCodeAt(i++);
        switch (ch) {
        case 10:
        case 12:
        case 13:
            if (activeTags.length == 0 && options.handleNewline) {
                i = options.handleNewline(str, i, start, len);
                start = i;
                ok = i;
            }
            break;
        case 38 /*'&'*/:
            ok = i-1;
            for (;;) {
                if (i == len)
                    break loop;
                ch = str.charCodeAt(i++);
                if (ch == 59) //';'
                    break;
                if (! ((ch >= 65 && ch <= 90)  // 'A'..'Z'
                       || (ch >= 97 && ch <= 122) // 'a'..'z'
                       || (ch >= 48 && ch <= 57) // '0'..'9'
                       || (ch == 35 && i==ok+2))) // initial '#'
                    break loop;
            }
            break;
        case 62: // '>'
            ok = i-1;
            break;
        case 60 /*'<'*/:
            ok = i-1;
            if (i + 1 == len)
                break loop; // invalid
            ch = str.charCodeAt(i++);
            if (ok == 0) {
                let m;
                if ((ch === 33 /*'!'*/ && (m = str.match(doctypeRE)))
                    || (ch === 63 /*'?'*/ && (m = str.match(xmldeclRE)))) {
                    str = str.substring(m[0].length);
                    len = str.length;
                    i = 0;
                    break;
                }
            }
            if (ch == 33 && i + 1 < len
                && str.charCodeAt(i) == 45 && str.charCodeAt(i+1) == 45) {
                // Saw comment start "<!--". Look for "-->".
                i += 2;
                for (; ; i++) {
                    if (i + 2 >= len)
                        break loop; // invalid
                    if (str.charCodeAt(i) == 45
                        && str.charCodeAt(i+1) == 45
                        && str.charCodeAt(i+2) == 62) {
                        i += 3;
                        if (activeTags.length == 0)
                            i = skipWhitespace(i);
                        str = str.substring(0, ok) + str.substring(i);
                        len = str.length;
                        i = ok;
                        break;
                    }
                }
                break;
            }

            var end = ch == 47; // '/';
            if (end)
                ch = str.charCodeAt(i++);
            for (;;) {
                if (i == len)
                    break loop; // invalid
                ch = str.charCodeAt(i++);
                if (! ((ch >= 65 && ch <= 90)  // 'A'..'Z'
                       || (ch >= 97 && ch <= 122) // 'a'..'z'
                       || (ch >= 48 && ch <= 57) // '0'..'9'
                       || ch == 58 // ':'
                       || (ch == 35 && i==ok+2))) // initial '#'
                    break;
            }
            if (end) {
                if (ch != 62) // '>'
                    break loop; // invalid
                var tag = str.substring(ok+2,i-1);
                var einfo = elementInfo(tag, activeTags);
                if (activeTags.length == 0) {
                    // maybe TODO: allow unbalanced "</foo>" to pop from foo.
                    break loop;
                } else if (activeTags.pop() == tag) {
                    if ((einfo & ELEMENT_KIND_CONVERT_TO_DIV) != 0) {
                        i = skipWhitespace(i);
                        str = str.substring(0, ok) + "</div>" + str.substring(i);
                        len = str.length;
                        ok = i = ok + 6;
                    } else if ((einfo & ELEMENT_KIND_SKIP_TAG_OR_FULLY) != 0) {
                        if ((einfo & ELEMENT_KIND_SKIP_FULLY) != 0) {
                            skipping--;
                            ok = activeTags.pop();
                        }
                        if ((einfo & ELEMENT_KIND_INLINE) == 0)
                            i = skipWhitespace(i);
                        str = str.substring(0, ok) + str.substring(i);
                        len = str.length;
                        i = ok;
                    } else if ((einfo & ELEMENT_KIND_INLINE) == 0) {
                        let i2 = skipWhitespace(i);
                        if (i2 > i) {
                            str = str.substring(0, i) + str.substring(i2);
                            len = str.length;
                        }
                    }
                    ok = i;
                    if (activeTags.length == 0
                        && options.handlePopOuterBlock
                        && (elementInfo(tag, activeTags) & ELEMENT_KIND_INLINE) == 0) {
                        options.handlePopOuterBlock(str.substring(start, ok));
                        start = i;
                    }
                    continue;
                } else
                    break loop; // invalid - tag mismatch
            } else { // element start tag
                var tag = str.substring(ok+1,i-1);
                var einfo = elementInfo(tag, activeTags);
                if ((einfo & ELEMENT_KIND_ALLOW) == 0 && skipping == 0)
                    break loop;
                if ((einfo & ELEMENT_KIND_SKIP_FULLY) != 0) {
                    activeTags.push(ok);
                    skipping++;
                }
                activeTags.push(tag);
                // we've seen start tag - now check for attributes
                for (;;) {
                    while (ch <= 32 && i < len)
                        ch = str.charCodeAt(i++);
                    var attrstart = i-1;
                    while (ch != 61 && ch != 62 && ch != 47) { //' =' '>' '/'
                        if (i == len || ch == 60 || ch == 38) //'<' or '&'
                            break loop; // invalid
                        ch = str.charCodeAt(i++);
                    }
                    var attrend = i-1;
                    if (attrstart == attrend) {
                        if (ch == 62 || ch == 47) // '>' or '/'
                            break;
                        else
                            break loop; // invalid - junk in element start
                    }
                    var attrname = str.substring(attrstart,attrend);
                    while (ch <= 32 && i < len)
                        ch = str.charCodeAt(i++);
                    let valstart, valend;
                    if (ch == 61) { // '='
                        if (i == len)
                            break loop; // invalid
                        for (ch = 32; ch <= 32 && i < len; )
                            ch = str.charCodeAt(i++);
                        var quote = i == len ? -1 : ch;
                        if (quote == 34 || quote == 39) { // '"' or '\''
                            valstart = i;
                            for (;;) {
                                if (i+1 >= len) //i+1 to allow for '/' or '>'
                                    break loop; // invalid
                                ch = str.charCodeAt(i++);
                                if (ch == quote)
                                    break;
                            }
                            valend = i-1;
                        } else {
                            // Unquoted attribute value
                            valstart = i-1;
                            while (ch > 32 && ch != 34 && ch != 39
                                   && (ch < 60 || ch > 62) && ch != 96)
                                ch = str.charCodeAt(i++);
                            valend = --i;
                        }
                    } else {
                        i--;
                        valstart = i;
                        valend = i;
                    }
                    let attrvalue = str.substring(valstart, valend);
                    if (! allowAttribute(attrname, attrvalue,
                                              einfo, activeTags))
                        break loop;
                    if ((einfo & ELEMENT_KIND_CHECK_JS_TAG) != 0
                        && (attrname=="href" || attrname=="domterm-href"
                            || attrname=="src")) {
                        if (tag == "base" && attrname == "href") {
                            baseUrl = attrvalue;
                        } else if (baseUrl != null
                                   && attrvalue.indexOf(":") < 0) {
                            // resolve attrvalue relative to baseUrl
                            try {
                                attrvalue = new URL(attrvalue, baseUrl).href;
                                i = valstart + attrvalue.length+1;
                            } catch (e) {
                                break loop;
                            }
                            str = str.substring(0, valstart) + attrvalue
                                + str.substring(valend);
                            len = str.length;
                        }
                    }
                    ch = str.charCodeAt(i++); // safe because of prior i+1

                }
                while (ch == 32 && i < len)
                    ch = str.charCodeAt(i++);
                if (ch == 47) { // '/'
                    if (i == len || str.charCodeAt(i++) != 62) // '>'
                        break loop; // invalid
                    activeTags.pop();
                    if ((einfo & ELEMENT_KIND_SKIP_FULLY) != 0) {
                        skipping--;
                        ok = activeTags.pop();
                    }
                } else if (ch != 62) // '>'
                    break loop; // invalid
                else if ((einfo & ELEMENT_KIND_EMPTY) != 0)
                    activeTags.pop();
                if ((einfo & ELEMENT_KIND_CONVERT_TO_DIV) != 0) {
                    str = str.substring(0, ok)
                        + "<div" + str.substring(ok+5);
                    len = str.length;
                    i = ok + 5;
                } else if ((einfo & ELEMENT_KIND_SKIP_TAG) != 0) {
                    str = str.substring(0, ok) + str.substring(i);
                    len = str.length;
                    i = ok;
                }
                if ((einfo & ELEMENT_KIND_INLINE) == 0) {
                    let i2 = skipWhitespace(i);
                    if (i2 > i) {
                        str = str.substring(0, i) + str.substring(i2);
                        len = str.length;
                    }
                }
                ok = i;
            }
            break;
        }
    }
    if (ok < len) {
        str = escapeText(str.substring(ok, len));
        str = '<div style="color: red"><b>Inserted invalid HTML starting here:</b>'
            + '<pre style="background-color: #fee">'
            + str + '</pre></div>';
        options.errorSeen = "invalid";
    } else if (activeTags.length > 0) {
        str = "";
        while (activeTags.length)
            str += '&lt;/' + activeTags.pop() + '&gt;'
        str = '<div style="color: red"><b>Inserted invalid HTML - missing close tags:</b>'
            + ' <code style="background-color: #fee">'
            + str + '</code></div>';
        options.errorSeen = "unclosed"
    } else {
        str = str.substring(start, ok);
    }
    return str;
}

function allowAttribute(name, value, einfo, parents) {
    //Should "style" be allowed?  Or further scrubbed?
    //It is required for SVG. FIXME.
    //if (name=="style")
    //    return false;
    if (name.startsWith("on"))
        return false;
    if ((einfo & ELEMENT_KIND_CHECK_JS_TAG) != 0) {
        if (name=="href" || name=="domterm-href" || name=="src") {
            // scrub for "javascript:"
            var amp = value.indexOf("&");
            var colon = value.indexOf(":");
            if (amp >= 0 && amp <= 11 && (colon < 0 || amp <= colon))
                return false;
            if (value.startsWith("javascript:"))
                return false;
        }
    }
    return true;
};

export function isEmptyTag(tag) { // lowercase tag
    return (elementInfo(tag, null) & ELEMENT_KIND_EMPTY) == 0;
}

export function isBlockTag(tag) { // lowercase tag
    var einfo = elementInfo(tag, null);
    return (einfo & ELEMENT_KIND_INLINE) == 0;
}

export function isBlockNode(node) {
    return node instanceof Element
        && isBlockTag(node.tagName.toLowerCase());
};

/** True if an img/object/a element.
 * These are treated as black boxes similar to a single
 * 1-column character.
 * @param node an Element we want to check
 * @return true iff the {@code node} should be treated as a
 *  block-box embedded object.
 *  For now returns true for {@code img}, {@code a}, and {@code object}.
 *  (We should perhaps treat {@code a} as text.)
 */
export function isObjectElement(node)
{
    var tag = node.tagName;
    return "OBJECT" == tag || "CANVAS" == tag
        || "IMG" == tag || "SVG" == tag || "IFRAME" == tag;
};

export function isSpanNode(node) {
    if (! (node instanceof Element)) return false;
    var tag = node.tagName;
    return "SPAN" == tag;
};

export function isNormalBlock(node) {
    let tag = node.nodeName;
    return tag == "PRE" || tag == "P" || tag == "DIV";
}

export function createSpanNode(cls=null, txt=null) {
    let el = document.createElement("span");
    if (cls)
        el.setAttribute("class", cls);
    if (txt)
        el.appendChild(document.createTextNode(txt));
    return el;
};

/**
* Iterate for sub-node of 'node', starting with 'start'.
* Call 'func' for each node (if allNodes is true) or each Element
* (if allNodes is false).  If the value returned by 'func' is not a boolean,
* stop iterating and return that as the result of forEachElementIn.
* If the value is true, continue with children; if false, skip children.
* The function may safely remove or replace the active node,
* or change its children.
*/
export function forEachElementIn(node,
                                 func,
                                 allNodes=false,
                                 backwards=false,
                                 start=backwards?node.lastChild:node.firstChild,
                                 elementExit=null) {
    let starting = true;
    for (var cur = start; ;) {
        if (cur == null || (cur == node && !starting))
            break;
        starting = false;
        let sibling = backwards?cur.previousSibling:cur.nextSibling;
        let parent = cur.parentNode;
        let doChildren = true;
        if (allNodes || cur instanceof Element) {
            let r = func(cur);
            if (r === true || r === false)
                doChildren = r;
            else
                return r;
        }
        let next;
        if (doChildren && cur instanceof Element
            && (next = backwards?cur.lastChild:cur.firstChild) != null) {
            cur = next;
        } else {
            for (;;) {
                if (elementExit && cur instanceof Element) {
                    let r = elementExit(cur);
                    if (r !== false)
                        return r;
                }
                next = sibling;
                if (next != null) {
                    cur = next;
                    break;
                }
                cur = parent;
                if (cur == node)
                    break;
                sibling = backwards?cur.previousSibling:cur.nextSibling;
                parent = cur.parentNode;
            }
        }
    }
    return null;
};

export function forEachTextIn(el, fun) {
    let n = el;
    for (;;) {
        if (n instanceof Text) {
            let r = fun(n);
            if (r != null)
                return r;
        }
        let next = n.firstChild
        if (next) {
            n = next;
        } else {
            for (;;) {
                if (n == el)
                    return null;
                next = n.nextSibling;
                if (next) {
                    n = next;
                    break;
                }
                n = n.parentNode;
            }
        }
    }
}

function editorNonWordChar(ch) {
    return " \t\n\r!\"#$%&'()*+,-./:;<=>?@[\\]^_{|}".indexOf(ch) >= 0;
}

/** Scan through a Range.
 * If backwards is false: scan forwards, starting from range start;
 * stop at or before range end; update range end if stopped earlier.
 * If backwards is true: scan backwards, starting from range end;
 * stop at or before range start; update range start if stopped earlier.
 * (I.e. Change end/start position of range if backwards is false/true.)
 *
 * state: various options and counters:
 * state.todo: Infinity, or maximum number of units
 * state.unit: "char", "grapheme", "word", "line"
 * state.stopAt: one of "", "line" (stop before moving to different hard line),
 *   "visible-line" (stop before moving to different screen line),
 *   "input" (line-edit input area), or "buffer".
 * state.linesCount: increment for each (non-soft) newline
 * state.wrapText: function called on each text node - return int or undefined
 * - if wrapText returns integer, stop at that index
 * state.lineHandler: handler for non-stopping lines.
 */
export function scanInRange(range, backwards, state) {
    let unit = state.unit;
    let doWords = unit == "word";
    let doGraphemes = unit == "grapheme"
    let stopAt = state.stopAt;
    let wordCharSeen = false;
    let firstNode = backwards ? range.endContainer : range.startContainer;
    let lastNode = backwards ? range.startContainer : range.endContainer;
    let skipFirst;
    if (firstNode instanceof CharacterData)
        skipFirst = 0;
    else if (backwards)
        skipFirst = 1 + firstNode.childNodes.length - range.endOffset;
    else
        skipFirst = 1 + range.startOffset;
    /*
    let lastNonSkip = lastNode instanceof CharacterData ? 1
        : backwards ? lastNode.childNodes.length - range.startOffset
        : range.endOffset;
    */
    let lastOffset = backwards ?  range.startOffset : range.endOffset;
    let stopNode = null;
    if (! (lastNode instanceof CharacterData)) {
        let lastChildren = lastNode.childNodes;
        // possibly undefined if at start/beginning of container
        stopNode = lastChildren[backwards ? lastOffset-1 : lastOffset];
    }
    function elementExit(node) {
        if (state.elementExit)
            (state.elementExit) (node);
        return node === lastNode ? null : false;
    }
    function blockAfterLine(line) {
        function f(n) {
            if (n instanceof Text)
                return n;
            if (! (n instanceof Element))
                return false;
            let ch = n.firstChild;
            return n !== line && ch !== null
                && (isNormalBlock(ch) || n);
            /*
            if (n == line || ch == null)
                return false;
            if (! isNormalBlock(ch))
                return n;
            return true;
            */
        }
        let n = forEachElementIn(range.commonAncestorContainer,
                                           f, true, false, line);
        return n && range.isPointInRange(n, 0) ? n : null;
    }
    function updateRangeWhenDone(node, stopped) {
        if (backwards) {
            if (stopped)
                range.setStartAfter(node);
            else
                range.setStartBefore(node);
        } else {
            if (stopped)
                range.setEndBefore(node);
            else {
                if (node.nextSibling instanceof Element
                         && node.nextSibling.getAttribute('line') === 'soft')
                    range.setEndAfter(node.nextSibling);
                else
                    range.setEndAfter(node);
            }
        }
    }
    function fun(node) {
        if (skipFirst > 0) {
            skipFirst--;
            return node == firstNode;
        }
        if (node === stopNode)
            return null;
        /*
        if (node.parentNode == lastNode) {
            if (lastNonSkip == 0)
                return null;
            lastNonSkip--;
        }
        */
        if (! (node instanceof Text)) {
            if (node.nodeName == "SPAN" && node.getAttribute("std") == "caret")
                return ! node.classList.contains("focus-caret");
            if (node.nodeName == "SPAN"
                && node.getAttribute("line") != null) {
                let stopped = false;
                if (stopAt == "visible-line")
                    stopped = true;
                else if (node.textContent == "")
                    return false;
                else if (stopAt == "line")
                    stopped = true;
                state.linesCount++;
                if (stopped) {
                    state.todo = 0;
                } else if (doWords) {
                    if (wordCharSeen)
                        state.todo--;
                    wordCharSeen = false;
                } else
                    state.todo--;
                if (state.todo == 0) {
                    let next;
                    if (backwards == stopped) {
                        next = node.nextSibling;
                        if (next instanceof Element
                            && next.getAttribute("std") == "prompt")
                            node = next;
                    }
                    if (backwards == stopped
                        && (next = blockAfterLine(node))) {
                        if (backwards)
                            range.setStart(next, 0);
                        else
                            range.setEnd(next, 0);
                    } else
                        updateRangeWhenDone(node, stopped);
                    return null;
                }
                return state.lineHandler ? state.lineHandler(node) : false;
            }
            return true;
        }
        // else: node instanceof Text
        if (unit == "line")
            return false;
        var data = node.data;
        let dlen = data.length;
        let istart = backwards ? dlen : 0;
        if (node == firstNode)
            istart = backwards ? range.endOffset : range.startOffset;
        let dend = node !== lastNode ? (backwards ? 0 : dlen)
            : (backwards ? range.startOffset : (dlen = range.endOffset));
        let index = istart;
        for (;; ) {
            if (state.wrapText && (state.todo == 0 || index == dend)) {
                const r = state.wrapText(node,
                                         backwards ? index : istart,
                                         backwards ? istart : index);
                if (r !== undefined) {
                    state.todo = 0;
                    index = r;
                }
            }
            if (state.todo == 0) {
                if (backwards)
                    range.setStart(node, index);
                else if (index === dlen
                         && node.nextSibling instanceof Element
                         && node.nextSibling.getAttribute('line') === 'soft')
                    range.setEndAfter(node.nextSibling);
                else
                    range.setEnd(node, index);
                return null;
            }
            if (index == dend)
                return node == lastNode ? null : false;
            let i0 = index;
            let i1 = backwards ? --index : index++;
            // Optimization: skip character processing if Infinity
            if (state.todo < Infinity) {
                let c = data.charCodeAt(i1);
                if (backwards ? (index > 0 && c >= 0xdc00 && c <= 0xdfff)
                    : (index < dlen && c >= 0xd800 && c <= 0xdbff)) {
                    let c2 = data.charCodeAt(backwards ? index-1 : index);
                    if (backwards ? (c2 >= 0xd800 && c2 <= 0xdbff)
                        : (c2 >= 0xdc00 && c2 <= 0xdfff)) {
                        if (backwards) index--; else index++;
                        c = data.codePointAt(backwards ? index : index - 2);
                    }
                }
                if (doWords) {
                    let sep = editorNonWordChar(String.fromCharCode(c));
                    if (sep && wordCharSeen) {
                        index = i0;
                    } else {
                        state.todo++;
                    }
                    wordCharSeen = ! sep;
                } else if (doGraphemes) {
                    let joinState = UnicodeProperties.getInfo(c);
                    if (backwards) {
                        while (index > dend) {
                            let prevChar =  data.charCodeAt(index - 1);
                            let prevW = prevChar >= 0xDC00 && prevChar <= 0xDFFF ? 2 : 1;
                            if (prevW == 2)
                                prevChar = data.codePointAt(index - prevW);
                            const prevInfo = UnicodeProperties.getInfo(prevChar);
                            const joinCode = UnicodeProperties.shouldJoinBackwards(prevInfo, joinState);
                            if (joinCode <= 0)
                                break;
                            index -= prevW;
                            joinState = joinCode;
                        }
                    } else {
                        // Does not handle an odd number of Regional Indicators.
                        // FIXME Need to handle that specially.
                        for (; index < dlen; ) {
                            const nextChar = data.codePointAt(index);
                            const nextInfo = UnicodeProperties.getInfo(nextChar);
                            const joinCode =
                                  UnicodeProperties.shouldJoin(joinState,
                                                               nextInfo);
                            if (joinCode <= 0)
                                break;
                            index += ((nextChar <= 0xffff) ? 1 : 2);
                            joinState = joinCode;
                        }
                    }
                }
                state.todo--;
            }
        }
        return false;
    }
    forEachElementIn(range.commonAncestorContainer, fun,
                     true, backwards, firstNode, elementExit);
}

export const isDelimiter = (function() {
    let delimiterChars = '()<>[]{}`;|\'"';
    let mask1 = 0; // mask for char values 32..63
    let mask2 = 0; // mask for char values 64..95
    let mask3 = 0; // mask for char values 96..127
    for (let i = delimiterChars.length; --i >= 0; ) {
        let ch = delimiterChars.charCodeAt(i);
        if (ch >= 32 && ch < 64)
            mask1 |= 1 << (ch - 32);
        else if (ch >= 64 && ch < 96)
            mask2 |= 1 << (ch - 64);
        else if (ch >= 96 && ch < 128)
            mask3 |= 1 << (ch - 96);
    }
    return function(ch) {
        if (ch < 64)
            return ch <= 32 ? true : (mask1 & (1 << (ch - 32))) != 0;
        else if (ch < 128)
            return ch < 96 ? (mask2 & (1 << (ch - 64))) != 0
            : (mask3 & (1 << (ch - 96))) != 0;
        else
            return false;
    }
})();

// Might be more efficient to use caretPositionFromPoint/caretRangeFromPoint
// but those have browser-dependent edge cases and issues.
export function caretMoveLine(backwards, startTop, startBottom, startNode, startOffset, goalX, startLineOK) {
    let state = new DPosition();
    let range = new Range();

    function checkNode(node) {
        let currentParent, currentOffset, currentTop, currentBottom, currentX;
        function isBetter() {
            if (! state.parent)
                return true;
            if (backwards ? currentBottom < state.bottom - 1
                : currentTop > state.top + 1)
                return false;
            return Math.abs(currentX - goalX) < Math.abs(state.x - goalX);
        }
        function updateIfBetter() {
            if (isBetter()) {
                state.parent = currentParent;
                state.offset = currentOffset;
                state.top = currentTop;
                state.bottom = currentBottom;
                state.x = currentX;
            }
        }
        if (node instanceof Element) {
            const rect = node.getBoundingClientRect();
            if (backwards && ! startLineOK) {
                if (rect.top >= startTop - 1 && rect.bottom >= startBottom - 1)
                    return false;
            }
            if (! backwards && ! startLineOK) {
                if (rect.top <= startTop + 1 && rect.bottom <= startBottom + 1)
                    return false;
            }
            if (backwards && state.top >= 0
                && rect.bottom < state.top)
                return null;
            if (! backwards && state.top >= 0
                && rect.top > state.bottom)
                return null;
            if (node.getAttribute("line") !== null) {
                if (node.firstChild instanceof Text) {
                    currentParent = node.firstChild;
                    currentOffset = 0;
                    currentTop = rect.top;
                    currentBottom = rect.bottom;
                    currentX = rect.x;
                    updateIfBetter();
                }
                return false;
            }
            if (isObjectElement(node)) { // FIXME
                return false;
            }
            return true;
        } else if (node instanceof Text) {
            const data = node.data;
            const dstart =
                  node == startNode && ! backwards ? startOffset : 0;
            const dend =
                  node == startNode && backwards ? startOffset : node.length;
            currentParent = node;
            let words = [dstart];
            for (let i = dstart; i < dend; i++) {
                if (data.charAt(i) === ' ')
                    words.push(i + 1);
            }
            if (words[words.length-1] != dend || words.length == 1)
                words.push(dend);
            const nwords = words.length;
            // Each 'word' ends in a space or end-of-string.
            for (let j = 1; j < nwords; j++) {
                let k = backwards ? nwords - j : j;
                let wstart = words[k-1];
                let wend = words[k];
                console.log("process word "+wstart+"..<"+wend+" "+JSON.stringify(data.substring(wstart, wend)));
                // process data[wstart..<wend]
                let i = wstart;
                let prevJoinState = 0;
                for (;;) {
                    // FIXME redudant end-point handling?
                    let skip = false;
                    let codePoint; // integer or undefined of end-of-string
                    if (i < wend) {
                        codePoint = i >= wend ? -1 : data.codePointAt(i);
                        const charInfo = UnicodeProperties.getInfo(codePoint);
                        const joinState = UnicodeProperties.shouldJoin(prevJoinState, charInfo);
                        prevJoinState = joinState;
                        skip = joinState > 0;
                    }
                    range.setEnd(node, i);
                    range.collapse();
                    const rect = range.getBoundingClientRect();
                    if (backwards && ! startLineOK) {
                        if (rect.top >= startTop && rect.bottom >= startBottom)
                            skip = true;
                    }
                    if (! backwards && ! startLineOK) {
                        if (rect.top <= startTop && rect.bottom <= startBottom)
                            skip = true;
                    }
                    if (! skip) {
                        currentX = rect.x;
                        currentTop = rect.top;
                        currentBottom = rect.bottom;
                        currentOffset = i;
                        updateIfBetter();
                    }
                    if (i >= wend)
                        break;
                    i = i + ((codePoint <= 0xffff) ? 1 : 2);
                }
            }
        }
        return true;
    };
    forEachElementIn(this.buffers, checkNode, true, backwards, startNode);
    if (state.parent) {
        return state;
    }
    return undefined;
}

export function caretFromPoint(x, y) { // DEPRECATED - use caretMoveLine
    if (document.caretPositionFromPoint) {
        return document.caretPositionFromPoint(x, y);
    }
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range)
            return { offsetNode: range.startContainer,
                     offset: range.startOffset };
    }
    return undefined;
}

export function positionBoundingRect(node, offset) {
    if (node === undefined) {
        const sel = document.getSelection();
        node = sel.focusNode;
        offset = sel.focusOffset;
    }
    while (offset === 0 && node instanceof Element && node.firstChild)
        node = node.firstChild;
    const r = new Range();
    r.setEnd(node, offset);
    r.collapse();
    let rect = r.getBoundingClientRect();
    if (rect.height === 0) {
        const children = node.childNodes;
        const preferSizeOfPrevious = true; // FIXME
        if (offset > 0
            && (preferSizeOfPrevious
                || offset >= children.length)) {
            const previous = children[offset - 1];
            if (previous instanceof Text) {
                const r = new Range();
                r.setEnd(previous, previous.length);
                r.collapse();
                rect = r.getBoundingClientRect();
            } else {
                const prevRects = previous.getClientRects();
                if (prevRects.length > 0) {
                    rect = prevRects[prevRects.length - 1];
                    rect = new DOMRect(rect.right, rect.top, 0, rect.heigh);
                }
            }
        } else if (offset < children.length) {
            const next = children[sel.focusOffset];
            if (next instanceof Text) {
                const r = new Range();
                r.setEnd(next, 0);
                r.collapse();
                rect = r.getBoundingClientRect();
            } else {
                const nextRects = next.getClientRects();
                if (nextRects.length > 0) {
                    rect = nextRects[0];
                    rect = new DOMRect(rect.left, rect.top, 0, rect.heigh);
                }
            }
        }
    }
    return rect;
}

export function skipCharactersUntil(range, charPredicate, stopAt) {
    let count = 0;
    function wrapText(node, start, end) {
        const data = node.data;
        for (let i = start; i < end; i++) {
            if (charPredicate(data.charCodeAt(i)))
                return i;
            count++;
        }
    }
    let scanState = { todo: Infinity, unit: "char", stopAt: stopAt, wrapText: wrapText };
    scanInRange(range, false, scanState);
    return count;
}

export function skipHSpace(range) {
    return skipCharactersUntil(range, (ch) => ch !== 32 && ch != 9,
                              "visible-line");
}

/** Divide a string into grapheme clusters.
 * The resulting clusters as added to the 'segments' array.
 * A string segment represents one or more simple clusters
 * (single-character, single-column).
 * Other clusters are represented by <span class="cluster"> elements.
 */
export function getGraphemeSegments(str, beginIndex, endIndex, segments, widths) {
    let widthInColumns = 0;
    let colsToHere = 0; // columns in str.substring(beginIndex,i)
    let colsToCluster = 0; // columns in str.substring(beginIndex,clusterStart)
    let prevInfo = 0;
    const preferWide = false; //this.ambiguousCharsAreWide(context);
    let inCluster = false; //FIXME
    let clusterStart = 0;
    let width = 0; // max of w (below) of characters from clusterStart..i.
    for (let i = beginIndex; ; ) {
        // Text in str.substring.(beginIndex, i) is "simple" clusters.
        let codePoint, codeInfo, joinState, shouldBreak;
        let w; // 0 - normal; 1 - force 1-column; 2 - wide
        // 'width' is max of 'w' since clusterStart
        if (i >= endIndex) {
            codePoint = -1;
            codeInfo = -1; // ???
            joinState = 0;
            shouldBreak = true;
            w = 0;
        } else {
            codePoint = str.codePointAt(i);
            codeInfo = UnicodeProperties.getInfo(codePoint);
            joinState = UnicodeProperties.shouldJoin(prevInfo, codeInfo);
            shouldBreak = joinState <= 0;
            w = UnicodeProperties.infoToWidthInfo(codeInfo);
            if (w >= 2) {
                // Treat emoji_presentation_selector as WIDE.
                w = w == 3 || preferWide || codePoint === 0xfe0f ? 2 : 0;
            }
        }
        // A <span class="cluster">...</span> contains one or more
        // characters that should be treated an extended grapheme cluster.
        // A "cluster w1" is 1 column wide; "cluster w2' is 2 columns.
        // A single wide character should be a "cluster w2".
        // A "cluster w1" may be used for a single narrow character
        // to force it to the correct width - e.g. Braille characters.
        // A "cluster pictographic" is "cluster w2" with Pict property.
        if (shouldBreak) {
            if (width == 0 &&
                (i == clusterStart+1
                 || (i == clusterStart+2
                     && str.charCodeAt(clusterStart) > 0xffff))) {
                clusterStart = i;
                colsToCluster = colsToHere;
            }
            if (clusterStart > beginIndex
                && (w > 0 || width > 0 || prevInfo > 0 || codePoint < 0)) {
                segments.push(str.substring(beginIndex, clusterStart));
                if (widths)
                    widths.push(colsToCluster);
                widthInColumns += colsToCluster;
                beginIndex = clusterStart;
                colsToHere = 0;
            }
            if (clusterStart < i && (width > 0 || prevInfo > 0 || codePoint < 0)) {
                if (prevInfo == UnicodeProperties.GRAPHEME_BREAK_SAW_Regional_Pair)
                    width = 2;
                const node = createSpanNode(
                    width >= 2 ? "dt-cluster w2" : "dt-cluster w1",
                    str.substring(clusterStart, i));
                node.stayOut = true;
                node._prevInfo = prevInfo;
                segments.push(node);
                width = width >= 2 ? 2 : 1;
                if (widths)
                    widths.push(width);
                widthInColumns += width;
                beginIndex = i;
                width = 0;
                colsToHere = 0;
            }
            clusterStart = i;
            colsToCluster = colsToHere;
        }
        if (i >= endIndex)
            break;
        // next_w
        prevInfo = joinState;
        if (w > width)
            width = w;
        i = i + ((codePoint <= 0xffff) ? 1 : 2);
        colsToHere += 1; // Only used for narrow simple chars
    }
    return widthInColumns;
}

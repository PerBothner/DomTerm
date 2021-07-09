import UnicodeTrie from './unicode-trie/index.mjs';
const trieRaw = "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";
let _data = null;
{
  const bin = window.atob(trieRaw);
  _data = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++)
    _data[i] = bin.charCodeAt(i);
}
const trieData = new UnicodeTrie(_data);
const GRAPHEME_BREAK_MASK = 0xF;
const GRAPHEME_BREAK_SHIFT = 0;
const CHARWIDTH_MASK = 0x30;
const CHARWIDTH_SHIFT = 4;

// Values for the GRAPHEME_BREAK property
const GRAPHEME_BREAK_Other = 0; // includes CR, LF, Control
const GRAPHEME_BREAK_Prepend = 1;
const GRAPHEME_BREAK_Extend = 2;
const GRAPHEME_BREAK_Regional_Indicator = 3;
const GRAPHEME_BREAK_SpacingMark = 4;
const GRAPHEME_BREAK_Hangul_L = 5;
const GRAPHEME_BREAK_Hangul_V = 6;
const GRAPHEME_BREAK_Hangul_T = 7;
const GRAPHEME_BREAK_Hangul_LV = 8;
const GRAPHEME_BREAK_Hangul_LVT = 9;
const GRAPHEME_BREAK_ZWJ = 10;
const GRAPHEME_BREAK_ExtPic = 11;

const GRAPHEME_BREAK_SAW_Regional = -3;

const CHARWIDTH_NORMAL = 0;
const CHARWIDTH_FORCE_1COLUMN = 1;
const CHARWIDTH_EA_AMBIGUOUS = 2;
const CHARWIDTH_WIDE = 3;

// In the following 'info' is an encoded value from trie.get(codePoint)

function infoToWidthInfo(info) {
    return (info & CHARWIDTH_MASK) >> CHARWIDTH_SHIFT;
}

function infoToWidth(info, ambiguousIsWide = false) {
    const v = infoToWidthInfo(info);
    return v < CHARWIDTH_EA_AMBIGUOUS ? 1
        : v >= CHARWIDTH_WIDE || ambiguousIsWide ? 2 : 1;
}

function strWidth(str, preferWide) {
    let width = 0;
    for (let i = 0; i < str.length;) {
        const codePoint = str.codePointAt(i);
        width += infoToWidth(getInfo(codePoint), preferWide);
        i += (codePoint <= 0xffff) ? 1 : 2;
    }
    return width;
}

function columnToIndexInContext(str, startIndex, column, preferWide) {
    let rv = 0;
    for (let i = startIndex; ;) {
	if (i >= str.length)
	    return i;
	const codePoint = str.codePointAt(i);
	const w = infoToWidth(getInfo(codePoint), preferWide);
	rv += w;
	if (rv > column)
	    return i;
	i += (codePoint <= 0xffff) ? 1 : 2;
    }
}


// Test if should break between beforeState and afterCode.
// Return <= 0 if should break; > 0 if should join.
// 'beforeState' is  the return value from the previous possible break;
// the value 0 is start of string.
// 'afterCode' is the GRAPHEME_BREAK_Xxx value for the following codepoint.
function shouldJoin(beforeState, afterInfo) {
    let afterCode = (afterInfo & GRAPHEME_BREAK_MASK) >> GRAPHEME_BREAK_SHIFT;
    if (beforeState >= GRAPHEME_BREAK_Hangul_L
        && beforeState <= GRAPHEME_BREAK_Hangul_LVT) {
        if (beforeState == GRAPHEME_BREAK_Hangul_L // GB6
            && (afterCode == GRAPHEME_BREAK_Hangul_L
                || afterCode == GRAPHEME_BREAK_Hangul_V
                || afterCode == GRAPHEME_BREAK_Hangul_LV
                || afterCode == GRAPHEME_BREAK_Hangul_LVT))
            return afterCode;
        if ((beforeState == GRAPHEME_BREAK_Hangul_LV // GB7
             || beforeState == GRAPHEME_BREAK_Hangul_V)
            && (afterCode == GRAPHEME_BREAK_Hangul_V
                || afterCode == GRAPHEME_BREAK_Hangul_T))
            return afterCode;
        if ((beforeState == GRAPHEME_BREAK_Hangul_LVT // GB8
             || beforeState == GRAPHEME_BREAK_Hangul_T)
            && afterCode == GRAPHEME_BREAK_Hangul_T)
            return afterCode;
    }
    if (afterCode == GRAPHEME_BREAK_Extend // GB9
        || afterCode == GRAPHEME_BREAK_ZWJ
        || afterCode == GRAPHEME_BREAK_SpacingMark) // GB9b
        return afterCode;
    if (beforeState == GRAPHEME_BREAK_ZWJ // GB11
        && afterCode == GRAPHEME_BREAK_ExtPic)
        return afterCode;
    if (afterCode == GRAPHEME_BREAK_Regional_Indicator) // GB12, GB13
        return beforeState == GRAPHEME_BREAK_SAW_Regional ? afterCode
        : GRAPHEME_BREAK_SAW_Regional;
    return 0;
}

const getInfo = typeof trieData === "undefined" ? undefined
      : (codePoint) => { return trieData.get(codePoint);};

export { 
    GRAPHEME_BREAK_MASK,
    GRAPHEME_BREAK_SHIFT,
    GRAPHEME_BREAK_Other,
    GRAPHEME_BREAK_Prepend,
    GRAPHEME_BREAK_Extend,
    GRAPHEME_BREAK_Regional_Indicator,
    GRAPHEME_BREAK_SpacingMark,
    GRAPHEME_BREAK_Hangul_L,
    GRAPHEME_BREAK_Hangul_V,
    GRAPHEME_BREAK_Hangul_T,
    GRAPHEME_BREAK_Hangul_LV,
    GRAPHEME_BREAK_Hangul_LVT,
    GRAPHEME_BREAK_ZWJ,
    GRAPHEME_BREAK_ExtPic,
    CHARWIDTH_MASK,
    CHARWIDTH_SHIFT,
    CHARWIDTH_NORMAL,
    CHARWIDTH_FORCE_1COLUMN,
    CHARWIDTH_EA_AMBIGUOUS,
    CHARWIDTH_WIDE,
    infoToWidthInfo,
    infoToWidth,
    shouldJoin,
    getInfo,
    strWidth,
    columnToIndexInContext
};


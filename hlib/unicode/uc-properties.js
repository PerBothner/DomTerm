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


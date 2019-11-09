export const BIG_ENDIAN = new Uint8Array(new Uint32Array([0xFF000000]).buffer)[0] === 0xFF;
export function red(n) {
    return (BIG_ENDIAN ? n >>> 24 : n) & 0xFF;
}
export function green(n) {
    return (BIG_ENDIAN ? n >>> 16 : n >>> 8) & 0xFF;
}
export function blue(n) {
    return (BIG_ENDIAN ? n >>> 8 : n >>> 16) & 0xFF;
}
export function alpha(n) {
    return (BIG_ENDIAN ? n : n >>> 24) & 0xFF;
}
export function toRGBA8888(r, g, b, a = 255) {
    return (BIG_ENDIAN)
        ? ((r & 0xFF) << 24 | (g & 0xFF) << 16 | (b % 0xFF) << 8 | (a & 0xFF)) >>> 0
        : ((a & 0xFF) << 24 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}
export function fromRGBA8888(color) {
    return (BIG_ENDIAN)
        ? [color >>> 24, (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF]
        : [color & 0xFF, (color >> 8) & 0xFF, (color >> 16) & 0xFF, color >>> 24];
}
export function nearestColorIndex(color, palette) {
    const r = red(color);
    const g = green(color);
    const b = blue(color);
    let min = Number.MAX_SAFE_INTEGER;
    let idx = -1;
    for (let i = 0; i < palette.length; ++i) {
        const dr = r - palette[i][0];
        const dg = g - palette[i][1];
        const db = b - palette[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (!d)
            return i;
        if (d < min) {
            min = d;
            idx = i;
        }
    }
    return idx;
}
function hue2rgb(p, q, t) {
    if (t < 0)
        t += 1;
    if (t > 1)
        t -= 1;
    if (t < 1 / 6)
        return p + (q - p) * 6 * t;
    if (t < 1 / 2)
        return q;
    if (t < 2 / 3)
        return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
function hlsToRgb(h, l, s) {
    let r;
    let g;
    let b;
    if (s === 0) {
        r = g = b = l;
    }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return (BIG_ENDIAN)
        ? (Math.round(r * 255) << 24 | Math.round(g * 255) << 16 | Math.round(b * 255) << 8 | 0xFF) >>> 0
        : (0xFF000000 | Math.round(b * 255) << 16 | Math.round(g * 255) << 8 | Math.round(r * 255)) >>> 0;
}
export function normalizeRGB(r, g, b) {
    return (BIG_ENDIAN)
        ? (Math.round(r / 100 * 255) << 24 | Math.round(g / 100 * 255) << 16 | Math.round(b / 100 * 255) << 8 | 0xFF) >>> 0
        : (0xFF000000 | Math.round(b / 100 * 255) << 16 | Math.round(g / 100 * 255) << 8 | Math.round(r / 100 * 255)) >>> 0;
}
export function normalizeHLS(h, l, s) {
    return hlsToRgb((h + 240) / 360 - 1, l / 100, s / 100);
}
export const PALETTE_VT340_COLOR = [
    normalizeRGB(0, 0, 0),
    normalizeRGB(20, 20, 80),
    normalizeRGB(80, 13, 13),
    normalizeRGB(20, 80, 20),
    normalizeRGB(80, 20, 80),
    normalizeRGB(20, 80, 80),
    normalizeRGB(80, 80, 20),
    normalizeRGB(53, 53, 53),
    normalizeRGB(26, 26, 26),
    normalizeRGB(33, 33, 60),
    normalizeRGB(60, 26, 26),
    normalizeRGB(33, 60, 33),
    normalizeRGB(60, 33, 60),
    normalizeRGB(33, 60, 60),
    normalizeRGB(60, 60, 33),
    normalizeRGB(80, 80, 80)
];
export const PALETTE_VT340_GREY = [
    normalizeRGB(0, 0, 0),
    normalizeRGB(13, 13, 13),
    normalizeRGB(26, 26, 26),
    normalizeRGB(40, 40, 40),
    normalizeRGB(6, 6, 6),
    normalizeRGB(20, 20, 20),
    normalizeRGB(33, 33, 33),
    normalizeRGB(46, 46, 46),
    normalizeRGB(0, 0, 0),
    normalizeRGB(13, 13, 13),
    normalizeRGB(26, 26, 26),
    normalizeRGB(40, 40, 40),
    normalizeRGB(6, 6, 6),
    normalizeRGB(20, 20, 20),
    normalizeRGB(33, 33, 33),
    normalizeRGB(46, 46, 46)
];
export const PALETTE_ANSI_256 = (() => {
    const p = [
        toRGBA8888(0, 0, 0),
        toRGBA8888(205, 0, 0),
        toRGBA8888(0, 205, 0),
        toRGBA8888(205, 205, 0),
        toRGBA8888(0, 0, 238),
        toRGBA8888(205, 0, 205),
        toRGBA8888(0, 250, 205),
        toRGBA8888(229, 229, 229),
        toRGBA8888(127, 127, 127),
        toRGBA8888(255, 0, 0),
        toRGBA8888(0, 255, 0),
        toRGBA8888(255, 255, 0),
        toRGBA8888(92, 92, 255),
        toRGBA8888(255, 0, 255),
        toRGBA8888(0, 255, 255),
        toRGBA8888(255, 255, 255),
    ];
    const d = [0, 95, 135, 175, 215, 255];
    for (let r = 0; r < 6; ++r) {
        for (let g = 0; g < 6; ++g) {
            for (let b = 0; b < 6; ++b) {
                p.push(toRGBA8888(d[r], d[g], d[b]));
            }
        }
    }
    for (let v = 8; v <= 238; v += 10) {
        p.push(toRGBA8888(v, v, v));
    }
    return p;
})();
export const DEFAULT_BACKGROUND = toRGBA8888(0, 0, 0, 255);

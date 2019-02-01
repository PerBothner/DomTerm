/** system endianess */
const BIG_ENDIAN = new Uint8Array(new Uint32Array([0xFF000000]).buffer)[0] === 0xFF;
export function toRGBA8888(r, g, b, a) {
    return (BIG_ENDIAN)
        ? (r & 0xFF) << 24 | (g & 0xFF) << 16 | (b % 0xFF) << 8 | (a & 0xFF) // RGBA32
        : (a & 0xFF) << 24 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF); // ABGR32
}
export function fromRGBA8888(color) {
    return (BIG_ENDIAN)
        ? [color >> 24, (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF]
        : [color & 0xFF, (color >> 8) & 0xFF, (color >> 16) & 0xFF, color >> 24];
}
/**
 * 16 predefined color registers of VT340
 *
 * taken from https://vt100.net/docs/vt3xx-gp/chapter2.html#S2.4
 * Table 2-3 VT340 Default Color Map Map Location  Default Color
 * * These colors are less saturated than colors 1 through 6.
 *                R   G   B
 * 0  Black       0  0  0
 * 1  Blue        20  20  80
 * 2  Red         80  13  13
 * 3  Green       20  80  20
 * 4  Magenta     80  20  80
 * 5  Cyan        20  80  80
 * 6  Yellow      80  80  20
 * 7  Gray 50%    53  53  53
 * 8  Gray 25%    26  26  26
 * 9  Blue*       33  33  60
 * 10 Red*        60  26  26
 * 11 Green*      33  60  33
 * 12 Magenta*    60  33  60
 * 13 Cyan*       33  60  60
 * 14 Yellow*     60  60  33
 * 15 Gray 75%    80  80  80
*/
const DEFAULT_COLORS = [
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
    normalizeRGB(80, 80, 80),
];
const DEFAULT_BACKGROUND = toRGBA8888(0, 0, 0, 255);
// color conversions
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
    if (s == 0) {
        r = g = b = l;
    }
    else {
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return (BIG_ENDIAN)
        ? Math.round(r * 255) << 24 | Math.round(g * 255) << 16 | Math.round(b * 255) << 8 | 0xFF // RGBA32
        : 0xFF000000 | Math.round(b * 255) << 16 | Math.round(g * 255) << 8 | Math.round(r * 255); // ABGR32
}
function normalizeRGB(r, g, b) {
    return (BIG_ENDIAN)
        ? Math.round(r / 100 * 255) << 24 | Math.round(g / 100 * 255) << 16 | Math.round(b / 100 * 255) << 8 | 0xFF // RGBA32
        : 0xFF000000 | Math.round(b / 100 * 255) << 16 | Math.round(g / 100 * 255) << 8 | Math.round(r / 100 * 255); // ABGR32
}
function normalizeHLS(h, l, s) {
    // Note: hue value is turned by 240° in VT340
    return hlsToRgb((h + 240) / 360 - 1, l / 100, s / 100);
}
/**
 * Class to hold a single sixel band.
 * The underlying data storage grows with `addSixel` if needed.
 * For multiple colors reset the the band cursor with `CR()`.
 * The class stores information about touched pixels, thus will not
 * overdraw a pixel with a default color that was never touched.
 */
class SixelBand {
    constructor(length = 4) {
        this._cursor = 0;
        this.width = 0;
        this.data = new Uint32Array(length * 6);
    }
    /**
     * Add a sixel to the band.
     * Called by the parser for any data byte of the sixel stream.
     */
    addSixel(code, color) {
        const pos = this._cursor * 6;
        // resize by power of 2 if needed
        if (pos >= this.data.length) {
            const data = new Uint32Array(this.data.length * 2);
            data.set(this.data);
            this.data = data;
        }
        // update data
        code -= 63;
        for (let p = 0; p < 6; ++p) {
            if (code & (1 << p)) {
                this.data[pos + p] = color;
            }
        }
        // update cursor pos and length
        this._cursor++;
        this.width = Math.max(this.width, this._cursor);
    }
    addSixels(data, start, end, color) {
        for (let pos = start; pos < end; ++pos) {
            this.addSixel(data[pos], color);
        }
    }
    /**
     * Carriage return.
     */
    CR() {
        this._cursor = 0;
    }
    /**
     * Copy a single row of pixels to `target`.
     * Low level method to access the band's image data.
     * Not for direct usage (no bound checks), use `SixelImage.toImageData` instead.
     */
    copyPixelRow(target, offset, row, start, length) {
        const end = Math.min(this.width, start + length);
        let pixel = 0;
        for (let i = start; i < end; ++i) {
            if (pixel = this.data[i * 6 + row]) {
                target[offset + i] = pixel;
            }
        }
    }
}
function r(low, high) {
    let c = high - low;
    const arr = new Array(c);
    while (c--) {
        arr[c] = --high;
    }
    return arr;
}
export class TransitionTable {
    constructor(length) {
        this.table = new Uint8Array(length);
    }
    add(code, state, action, next) {
        this.table[state << 8 | code] = action << 4 | next;
    }
    addMany(codes, state, action, next) {
        for (let i = 0; i < codes.length; i++) {
            this.table[state << 8 | codes[i]] = action << 4 | next;
        }
    }
}
const SIXEL_TABLE = (() => {
    const table = new TransitionTable(1024); //  4 STATES * 256 codes
    const states = r(0 /* DATA */, 3 /* COLOR */ + 1);
    let state;
    // default transition for all states
    for (state in states) {
        // Note: ignore never changes state
        table.addMany(r(0x00, 0x80), state, 0 /* ignore */, state);
    }
    // DATA state
    table.addMany(r(63, 127), 0 /* DATA */, 1 /* draw */, 0 /* DATA */);
    table.add(33, 0 /* DATA */, 0 /* ignore */, 1 /* COMPRESSION */);
    table.add(34, 0 /* DATA */, 0 /* ignore */, 2 /* ATTR */);
    table.add(35, 0 /* DATA */, 0 /* ignore */, 3 /* COLOR */);
    table.add(36, 0 /* DATA */, 2 /* cr */, 0 /* DATA */);
    table.add(45, 0 /* DATA */, 3 /* lf */, 0 /* DATA */);
    // COMPRESSION
    table.addMany(r(48, 58), 1 /* COMPRESSION */, 5 /* storeParam */, 1 /* COMPRESSION */);
    table.addMany(r(63, 127), 1 /* COMPRESSION */, 4 /* repeatedDraw */, 0 /* DATA */);
    table.add(33, 1 /* COMPRESSION */, 6 /* shiftParam */, 1 /* COMPRESSION */);
    // ATTR
    table.addMany(r(48, 58), 2 /* ATTR */, 5 /* storeParam */, 2 /* ATTR */);
    table.add(59, 2 /* ATTR */, 6 /* shiftParam */, 2 /* ATTR */);
    table.addMany(r(63, 127), 2 /* ATTR */, 7 /* applyParam */, 0 /* DATA */);
    table.add(33, 2 /* ATTR */, 7 /* applyParam */, 1 /* COMPRESSION */);
    table.add(34, 2 /* ATTR */, 7 /* applyParam */, 2 /* ATTR */);
    table.add(35, 2 /* ATTR */, 7 /* applyParam */, 3 /* COLOR */);
    table.add(36, 2 /* ATTR */, 7 /* applyParam */, 0 /* DATA */);
    table.add(45, 2 /* ATTR */, 7 /* applyParam */, 0 /* DATA */);
    // COLOR
    table.addMany(r(48, 58), 3 /* COLOR */, 5 /* storeParam */, 3 /* COLOR */);
    table.add(59, 3 /* COLOR */, 6 /* shiftParam */, 3 /* COLOR */);
    table.addMany(r(63, 127), 3 /* COLOR */, 7 /* applyParam */, 0 /* DATA */);
    table.add(33, 3 /* COLOR */, 7 /* applyParam */, 1 /* COMPRESSION */);
    table.add(34, 3 /* COLOR */, 7 /* applyParam */, 2 /* ATTR */);
    table.add(35, 3 /* COLOR */, 7 /* applyParam */, 3 /* COLOR */);
    table.add(36, 3 /* COLOR */, 7 /* applyParam */, 0 /* DATA */);
    table.add(45, 3 /* COLOR */, 7 /* applyParam */, 0 /* DATA */);
    return table;
})();
/**
 * Sixel image class.
 *
 * The class provides image attributes `width` and `height`.
 * With `toImageData` the pixel data can be copied to an `ImageData`
 * for further processing.
 * `write` and `writeString` decode the data streamlined, therefore it
 * is possible to grab partial images during transmission.
 * Note that the class is meant to run behind an escape sequence parser,
 * thus the data should only be the real data part of the sequence and not
 * contain the introducer and the closing bytes.
 * The constructor takes an optional argument `fillColor`. This color gets
 * applied to non zero pixels later on during `toImageData`.
 */
export class SixelImage {
    constructor(fillColor = DEFAULT_BACKGROUND) {
        this.fillColor = fillColor;
        this._initialState = 0 /* DATA */;
        this._currentState = this._initialState;
        this._bands = [];
        this._params = [0];
        this._colors = Object.assign([], DEFAULT_COLORS);
        this._currentColor = this._colors[0];
        this._currentBand = null;
        this._width = 0;
        this._height = 0;
    }
    get height() {
        return this._height || this._bands.length * 6;
    }
    get width() {
        return this._width || Math.max.apply(null, this._bands.map(el => el.width)) | 0;
    }
    writeString(data, start = 0, end = data.length) {
        const bytes = new Uint8Array(end - start);
        let j = 0;
        for (let i = start; i < end; ++i) {
            bytes[j++] = data.charCodeAt(i);
        }
        this.write(bytes);
    }
    /**
     * Write sixel data to the image.
     * Decodes the sixel data and creates the image.
     */
    write(data, start = 0, end = data.length) {
        let currentState = this._currentState;
        let dataStart = -1;
        let band = this._currentBand;
        let color = this._currentColor;
        let params = this._params;
        for (let i = start; i < end; ++i) {
            const code = data[i];
            const transition = SIXEL_TABLE.table[currentState << 8 | (code < 0x7F ? code : 0xFF)];
            switch (transition >> 4) {
                case 1 /* draw */:
                    dataStart = (~dataStart) ? dataStart : i;
                    break;
                case 0 /* ignore */:
                    if (currentState === 0 /* DATA */ && ~dataStart) {
                        if (!band) {
                            band = new SixelBand(this.width || 4);
                            this._bands.push(band);
                        }
                        band.addSixels(data, dataStart, i, color);
                    }
                    dataStart = -1;
                    break;
                case 4 /* repeatedDraw */:
                    if (!band) {
                        band = new SixelBand(this.width || 4);
                        this._bands.push(band);
                    }
                    let repeat = 0;
                    for (let i = 0; i < params.length; ++i) {
                        repeat += params[i];
                    }
                    for (let i = 0; i < repeat; ++i) {
                        band.addSixel(code, color);
                    }
                    dataStart = -1;
                    params = [0];
                    break;
                case 5 /* storeParam */:
                    params[params.length - 1] = params[params.length - 1] * 10 + code - 48;
                    break;
                case 6 /* shiftParam */:
                    params.push(0);
                    break;
                case 2 /* cr */:
                    if (~dataStart) {
                        if (!band) {
                            band = new SixelBand(this.width || 4);
                            this._bands.push(band);
                        }
                        band.addSixels(data, dataStart, i, color);
                        dataStart = -1;
                    }
                    if (band) {
                        band.CR();
                    }
                    break;
                case 3 /* lf */:
                    if (~dataStart) {
                        if (!band) {
                            band = new SixelBand(this.width || 4);
                            this._bands.push(band);
                        }
                        band.addSixels(data, dataStart, i, color);
                        dataStart = -1;
                    }
                    band = null;
                    break;
                case 7 /* applyParam */:
                    if (currentState === 3 /* COLOR */) {
                        if (params.length >= 5) {
                            if (params[1] === 1) {
                                // HLS color
                                this._colors[params[0]] = color = normalizeHLS(params[2], params[3], params[4]);
                            }
                            else if (params[1] === 2) {
                                // RGB color
                                this._colors[params[0]] = color = normalizeRGB(params[2], params[3], params[4]);
                            }
                        }
                        else if (params.length === 1) {
                            color = this._colors[params[0]] || this._colors[0];
                        }
                    }
                    else if (currentState === 2 /* ATTR */) {
                        // we only use width and height
                        if (params.length === 4) {
                            this._width = params[2];
                            this._height = params[3];
                        }
                    }
                    params = [0];
                    dataStart = -1;
                    if ((transition & 15) === 0 /* DATA */ && code > 62 && code < 127) {
                        dataStart = i;
                    }
                    break;
            }
            currentState = transition & 15;
        }
        if (currentState === 0 /* DATA */ && ~dataStart) {
            if (!band) {
                band = new SixelBand(this.width || 4);
                this._bands.push(band);
            }
            band.addSixels(data, dataStart, end, color);
        }
        // save state and buffers
        this._currentState = currentState;
        this._currentColor = color;
        this._params = params;
        this._currentBand = band;
    }
    /**
     * Write image data into `target`.
     * `target` should be specified with correct `width` and `height`.
     * `dx` and `dy` mark the destination offset.
     * `sx` and `sy` mark the source offset, `swidth` and `sheight` the size to be copied.
     * With `fillColor` the default fill color set in the ctor can be overwritten.
     * Returns the modified `target`.
     */
    toImageData(target, width, height, dx = 0, dy = 0, sx = 0, sy = 0, swidth = this.width, sheight = this.height, fillColor = this.fillColor) {
        if (dx < 0 || dy < 0 || sx < 0 || sy < 0 || swidth < 0 || sheight < 0) {
            throw new Error('negative values are invalid');
        }
        if (width * height * 4 !== target.length) {
            throw new Error('wrong geometry of target');
        }
        // border checks
        if (dx >= width || dy >= height) {
            return target;
        }
        if (sx >= this.width || sy >= this.height) {
            return target;
        }
        // determine copy area
        swidth = Math.min(swidth, width - dx, this.width);
        sheight = Math.min(sheight, height - dy, this.height);
        if (swidth <= 0 || sheight <= 0) {
            return target;
        }
        // copy data on 32 bit values
        const target32 = new Uint32Array(target.buffer);
        let p = sy % 6;
        let bandIdx = (sy / 6) | 0;
        let i = 0;
        while (bandIdx < this._bands.length && i < sheight) {
            const offset = (dy + i) * width + dx;
            if (fillColor) {
                const end = offset + swidth;
                for (let k = offset; k < end; ++k) {
                    target32[k] = fillColor;
                }
            }
            this._bands[bandIdx].copyPixelRow(target32, offset - sx, p, sx, swidth);
            p++;
            i++;
            if (p === 6) {
                bandIdx++;
                p = 0;
            }
        }
        if (fillColor) {
            while (i < sheight) {
                const offset = (dy + i) * width + dx;
                const end = offset + swidth;
                for (let k = offset; k < end; ++k) {
                    target32[k] = fillColor;
                }
                i++;
            }
        }
        return target;
    }
}
//# sourceMappingURL=index.js.map
import { PALETTE_VT340_COLOR, DEFAULT_BACKGROUND, normalizeHLS, normalizeRGB } from './Colors.js';
const OFFSETS = [];
for (let i = 0; i < 64; ++i) {
    const indices = [];
    if (i & 1)
        indices.push(0);
    if (i & 2)
        indices.push(1);
    if (i & 4)
        indices.push(2);
    if (i & 8)
        indices.push(3);
    if (i & 16)
        indices.push(4);
    if (i & 32)
        indices.push(5);
    OFFSETS.push(indices);
}
class SixelBand {
    constructor(length = 4) {
        this.cursor = 0;
        this.width = 0;
        this.data = new Uint32Array(length * 6);
    }
    get memUsage() {
        return this.data.length * 4;
    }
    getHeight() {
        for (let row = 5; row >= 0; --row) {
            const end = this.width * 6 + row;
            for (let pos = row; pos < end; pos += 6) {
                if (this.data[pos]) {
                    return row + 1;
                }
            }
        }
        return 0;
    }
    put(code, color, repeat) {
        let pos = this.cursor * 6;
        const lastPos = pos + repeat * 6 - 6;
        if (lastPos >= this.data.length) {
            let length = this.data.length;
            while (lastPos >= (length *= 2))
                ;
            const data = new Uint32Array(length);
            data.set(this.data);
            this.data = data;
        }
        this.cursor += repeat;
        this.width = Math.max(this.width, this.cursor);
        if (code) {
            const t = OFFSETS[code];
            const l = t.length;
            while (repeat--) {
                for (let i = 0; i < l; ++i) {
                    this.data[pos + t[i]] = color;
                }
                pos += 6;
            }
        }
    }
    copyPixelRow(target, offset, row, start, length) {
        const end = Math.min(this.width, start + length);
        let sOffset = start * 6 + row;
        let pixel = 0;
        for (let i = start; i < end; ++i) {
            if (pixel = this.data[sOffset]) {
                target[offset + i] = pixel;
            }
            sOffset += 6;
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
class TransitionTable {
    constructor(length) {
        this.table = new Uint8Array(length);
    }
    add(code, state, action, next) {
        this.table[state << 7 | code] = action << 4 | next;
    }
    addMany(codes, state, action, next) {
        for (let i = 0; i < codes.length; i++) {
            this.table[state << 7 | codes[i]] = action << 4 | next;
        }
    }
}
const SIXEL_TABLE = (() => {
    const table = new TransitionTable(512);
    const states = r(0, 3 + 1);
    let state;
    for (state in states) {
        table.addMany(r(0x00, 0x80), state, 0, state);
    }
    table.addMany(r(63, 127), 0, 1, 0);
    table.add(33, 0, 0, 1);
    table.add(34, 0, 0, 2);
    table.add(35, 0, 0, 3);
    table.add(36, 0, 2, 0);
    table.add(45, 0, 3, 0);
    table.addMany(r(48, 58), 1, 5, 1);
    table.addMany(r(63, 127), 1, 4, 0);
    table.add(33, 1, 6, 1);
    table.addMany(r(48, 58), 2, 5, 2);
    table.add(59, 2, 6, 2);
    table.addMany(r(63, 127), 2, 7, 0);
    table.add(33, 2, 7, 1);
    table.add(34, 2, 7, 2);
    table.add(35, 2, 7, 3);
    table.add(36, 2, 7, 0);
    table.add(45, 2, 7, 0);
    table.addMany(r(48, 58), 3, 5, 3);
    table.add(59, 3, 6, 3);
    table.addMany(r(63, 127), 3, 7, 0);
    table.add(33, 3, 7, 1);
    table.add(34, 3, 7, 2);
    table.add(35, 3, 7, 3);
    table.add(36, 3, 7, 0);
    table.add(45, 3, 7, 0);
    return table;
})();
class Params {
    constructor() {
        this.length = 1;
        this.params = new Uint32Array(32);
    }
    reset() {
        this.params[0] = 0;
        this.length = 1;
    }
    addParam() {
        this.params[this.length++] = 0;
    }
    addDigit(v) {
        this.params[this.length - 1] = this.params[this.length - 1] * 10 + v;
    }
}
export class SixelDecoder {
    constructor(fillColor = DEFAULT_BACKGROUND, palette = Object.assign([], PALETTE_VT340_COLOR), paletteLimit = 65536) {
        this.fillColor = fillColor;
        this.palette = palette;
        this.paletteLimit = paletteLimit;
        this.bands = [];
        this.rasterRatioNumerator = 0;
        this.rasterRatioDenominator = 0;
        this.rasterWidth = 0;
        this.rasterHeight = 0;
        this._initialState = 0;
        this._currentState = this._initialState;
        this._params = new Params();
        this._currentColor = this.palette[0];
        this._currentBand = new SixelBand();
        this.bands.push(this._currentBand);
    }
    get width() {
        return this.rasterWidth || this.realWidth;
    }
    get height() {
        return this.rasterHeight || this.realHeight;
    }
    get realWidth() {
        return Math.max.apply(null, this.bands.map(el => el.width));
    }
    get realHeight() {
        if (this.bands.length === 1 && !this.bands[0].getHeight())
            return 0;
        return (this.bands.length - 1) * 6 + this.bands[this.bands.length - 1].getHeight() || 6;
    }
    get memUsage() {
        return this.bands.reduce((accu, cur) => accu + cur.memUsage, 0);
    }
    decodeString(data, start = 0, end = data.length) {
        if (!this._buffer || this._buffer.length < end - start) {
            this._buffer = new Uint8Array(end - start);
        }
        let j = 0;
        for (let i = start; i < end; ++i) {
            this._buffer[j++] = data.charCodeAt(i);
        }
        this.decode(this._buffer, 0, j);
    }
    decode(data, start = 0, end = data.length) {
        let currentState = this._currentState;
        let band = this._currentBand;
        let color = this._currentColor;
        let params = this._params;
        for (let i = start; i < end; ++i) {
            let code = data[i] & 0x7F;
            const transition = SIXEL_TABLE.table[currentState << 7 | code];
            switch (transition >> 4) {
                case 1:
                    band.put(code - 63, color, 1);
                    break;
                case 0:
                    break;
                case 5:
                    params.addDigit(code - 48);
                    break;
                case 7:
                    if (currentState === 3) {
                        if (params.length === 1) {
                            color = this.palette[params.params[0] % this.paletteLimit] >>> 0;
                        }
                        else if (params.length === 5) {
                            if (params.params[1] < 3
                                && params.params[1] === 1 ? params.params[2] <= 360 : params.params[2] <= 100
                                && params.params[2] <= 100
                                && params.params[3] <= 100) {
                                switch (params.params[1]) {
                                    case 2:
                                        this.palette[params.params[0] % this.paletteLimit] = color = normalizeRGB(params.params[2], params.params[3], params.params[4]);
                                        break;
                                    case 1:
                                        this.palette[params.params[0] % this.paletteLimit] = color = normalizeHLS(params.params[2], params.params[3], params.params[4]);
                                        break;
                                    case 0:
                                        color = this.palette[params.params[0] % this.paletteLimit] >>> 0;
                                }
                            }
                        }
                    }
                    else if (currentState === 2) {
                        if (this.bands.length === 1 && !band.cursor) {
                            if (params.length === 4) {
                                this.rasterRatioNumerator = params.params[0];
                                this.rasterRatioDenominator = params.params[1];
                                this.rasterWidth = params.params[2];
                                this.rasterHeight = params.params[3];
                            }
                        }
                    }
                    params.reset();
                    if ((transition & 15) === 0 && code > 62 && code < 127) {
                        band.put(code - 63, color, 1);
                    }
                    break;
                case 4:
                    let repeat = 0;
                    for (let i = 0; i < params.length; ++i) {
                        repeat += params.params[i] || 1;
                    }
                    band.put(code - 63, color, repeat);
                    params.reset();
                    break;
                case 2:
                    band.cursor = 0;
                    break;
                case 6:
                    params.addParam();
                    break;
                case 3:
                    band = new SixelBand(this.width || 4);
                    this.bands.push(band);
                    break;
            }
            currentState = transition & 15;
        }
        this._currentState = currentState;
        this._currentColor = color;
        this._params = params;
        this._currentBand = band;
    }
    toPixelData(target, width, height, dx = 0, dy = 0, sx = 0, sy = 0, swidth = this.width, sheight = this.height, fillColor = this.fillColor) {
        if (dx < 0 || dy < 0 || sx < 0 || sy < 0 || swidth < 0 || sheight < 0) {
            throw new Error('negative values are invalid');
        }
        if (width * height * 4 !== target.length) {
            throw new Error('wrong geometry of target');
        }
        if (dx >= width || dy >= height) {
            return target;
        }
        if (sx >= this.width || sy >= this.height) {
            return target;
        }
        swidth = Math.min(swidth, width - dx, this.width);
        sheight = Math.min(sheight, height - dy, this.height);
        if (swidth <= 0 || sheight <= 0) {
            return target;
        }
        const target32 = new Uint32Array(target.buffer);
        let p = sy % 6;
        let bandIdx = (sy / 6) | 0;
        let i = 0;
        while (bandIdx < this.bands.length && i < sheight) {
            const offset = (dy + i) * width + dx;
            if (fillColor) {
                target32.fill(fillColor, offset, offset + swidth);
            }
            this.bands[bandIdx].copyPixelRow(target32, offset - sx, p, sx, swidth);
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
                target32.fill(fillColor, offset, offset + swidth);
                i++;
            }
        }
        return target;
    }
}

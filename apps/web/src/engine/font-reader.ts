// A minimal OpenType reader: enough to turn text into the font's real outlines. Reads TrueType
// (glyf) and CFF outlines, cmap, hmtx, variable fonts (fvar, avar, gvar) and the single and
// ligature substitutions of GSUB (ligatures, tabular figures, small caps, stylistic sets...).
// Outlines come back in font units, y up.

export type PathCommand = { op: "M" | "L"; x: number; y: number } | { op: "Q"; x1: number; y1: number; x: number; y: number } | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: "Z" };

export interface FontAxis {
    tag: string;
    min: number;
    def: number;
    max: number;
    // The axis's own name from the font (the name table), when it has one.
    name?: string;
}

// A named instance of a variable font ("Semi Bold", "Condensed Light"): its axis values by tag.
export interface FontInstance {
    name: string;
    coords: Record<string, number>;
}

export interface ParsedFont {
    unitsPerEm: number;
    numGlyphs: number;
    italic: boolean;
    weight: number;
    axes: FontAxis[];
    // Named instances (fvar), for the stops on Type settings › Variable's sliders.
    instances: FontInstance[];
    features: string[];
    glyphIndex(codePoint: number): number;
    advance(gid: number): number;
    // Normalised axis coordinates (-1..1, after avar) for a set of axis values.
    normalize(values: Record<string, number>): number[];
    glyphPath(gid: number, coords?: number[]): PathCommand[];
    // Applies GSUB features: each output glyph with the index of the first input it came from.
    substitute(gids: number[], features: Set<string>): { gid: number; from: number; count: number }[];
}

class Reader {
    view: DataView;
    constructor(buf: ArrayBuffer) {
        this.view = new DataView(buf);
    }
    u8(o: number) {
        return this.view.getUint8(o);
    }
    i8(o: number) {
        return this.view.getInt8(o);
    }
    u16(o: number) {
        return this.view.getUint16(o);
    }
    i16(o: number) {
        return this.view.getInt16(o);
    }
    u32(o: number) {
        return this.view.getUint32(o);
    }
    fixed(o: number) {
        return this.view.getInt32(o) / 65536;
    }
    f2dot14(o: number) {
        return this.view.getInt16(o) / 16384;
    }
    tag(o: number) {
        return String.fromCharCode(this.u8(o), this.u8(o + 1), this.u8(o + 2), this.u8(o + 3));
    }
}

export function parseFont(buffer: ArrayBuffer): ParsedFont | null {
    const r = new Reader(buffer);
    let base = 0;
    const signature = r.tag(0);
    // A collection: the first font.
    if (signature === "ttcf") base = r.u32(12);
    const sfnt = r.u32(base);
    if (sfnt !== 0x00010000 && r.tag(base) !== "OTTO" && r.tag(base) !== "true") return null;
    const tables = new Map<string, { offset: number; length: number }>();
    const count = r.u16(base + 4);
    for (let i = 0; i < count; i++) {
        const rec = base + 12 + i * 16;
        tables.set(r.tag(rec), { offset: r.u32(rec + 8), length: r.u32(rec + 12) });
    }
    const head = tables.get("head");
    const maxp = tables.get("maxp");
    const hhea = tables.get("hhea");
    if (!head || !maxp) return null;
    const unitsPerEm = r.u16(head.offset + 18);
    const indexToLoc = r.i16(head.offset + 50);
    const macStyle = r.u16(head.offset + 44);
    const numGlyphs = r.u16(maxp.offset + 4);
    const os2 = tables.get("OS/2");
    const weight = os2 ? r.u16(os2.offset + 4) : 400;
    const italic = Boolean(macStyle & 2) || (os2 ? Boolean(r.u16(os2.offset + 62) & 1) : false);

    // Horizontal metrics.
    const hmtx = tables.get("hmtx");
    const numberOfHMetrics = hhea ? r.u16(hhea.offset + 34) : 0;
    const advance = (gid: number) => {
        if (!hmtx || numberOfHMetrics === 0) return unitsPerEm / 2;
        const i = Math.min(gid, numberOfHMetrics - 1);
        return r.u16(hmtx.offset + i * 4);
    };

    const glyphIndex = readCmap(r, tables.get("cmap"));
    const names = readNames(r, tables.get("name"));
    const { axes, instances } = readFvar(r, tables.get("fvar"), names);
    const avar = readAvar(r, tables.get("avar"), axes.length);
    const normalize = (values: Record<string, number>) =>
        axes.map((axis, i) => {
            const v = Math.min(axis.max, Math.max(axis.min, values[axis.tag] ?? axis.def));
            let n = v < axis.def ? (axis.def === axis.min ? 0 : (v - axis.def) / (axis.def - axis.min)) : axis.def === axis.max ? 0 : (v - axis.def) / (axis.max - axis.def);
            const map = avar[i];
            if (map && map.length) n = mapAvar(map, n);
            return n;
        });

    let glyphPath: (gid: number, coords?: number[]) => PathCommand[] = () => [];
    const glyf = tables.get("glyf");
    const loca = tables.get("loca");
    const cff = tables.get("CFF ");
    if (glyf && loca) {
        const gvar = readGvar(r, tables.get("gvar"));
        const offsetOf = (gid: number) => (indexToLoc === 0 ? r.u16(loca.offset + gid * 2) * 2 : r.u32(loca.offset + gid * 4));
        const glyphPoints = (gid: number, coords: number[] | undefined, depth: number): TTContour[] => {
            if (gid < 0 || gid >= numGlyphs || depth > 8) return [];
            const start = offsetOf(gid);
            const end = offsetOf(gid + 1);
            if (end <= start) return [];
            const o = glyf.offset + start;
            const contours = r.i16(o);
            if (contours >= 0) {
                const simple = readSimpleGlyph(r, o, contours);
                if (gvar && coords && coords.some((c) => c !== 0)) applyGvar(r, gvar, gid, coords, simple, null);
                return simple;
            }
            // Composite: components placed by offsets (which variations can move too).
            const parts = readComposite(r, o);
            if (gvar && coords && coords.some((c) => c !== 0)) applyGvar(r, gvar, gid, coords, null, parts);
            const out: TTContour[] = [];
            for (const part of parts) {
                const sub = glyphPoints(part.gid, coords, depth + 1);
                for (const c of sub) out.push(c.map((p) => ({ x: part.a * p.x + part.c * p.y + part.dx, y: part.b * p.x + part.d * p.y + part.dy, on: p.on })));
            }
            return out;
        };
        glyphPath = (gid, coords) => contoursToPath(glyphPoints(gid, coords, 0));
    } else if (cff) {
        const charstrings = readCff(r, cff.offset);
        if (charstrings) glyphPath = (gid) => charstrings(gid);
    }

    const gsub = readGsub(r, tables.get("GSUB"));
    return {
        unitsPerEm,
        numGlyphs,
        italic,
        weight,
        axes,
        instances,
        features: gsub ? [...new Set(gsub.features.map((f) => f.tag))] : [],
        glyphIndex,
        advance,
        normalize,
        glyphPath,
        substitute: (gids, features) => (gsub ? applyGsub(r, gsub, gids, features) : gids.map((gid, i) => ({ gid, from: i, count: 1 }))),
    };
}

// cmap: formats 4 and 12 (and 6 and 0), Unicode or Windows encodings.
function readCmap(r: Reader, table: { offset: number } | undefined): (cp: number) => number {
    if (!table) return () => 0;
    const n = r.u16(table.offset + 2);
    let best: { offset: number; format: number; score: number } | null = null;
    for (let i = 0; i < n; i++) {
        const rec = table.offset + 4 + i * 8;
        const platform = r.u16(rec);
        const encoding = r.u16(rec + 2);
        const offset = table.offset + r.u32(rec + 4);
        const format = r.u16(offset);
        const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
        if (!unicode) continue;
        const score = (format === 12 ? 10 : format === 4 ? 5 : format === 6 ? 2 : format === 0 ? 1 : 0) + (encoding === 10 ? 1 : 0);
        if (score && (!best || score > best.score)) best = { offset, format, score };
    }
    if (!best) return () => 0;
    const o = best.offset;
    const cache = new Map<number, number>();
    const lookup = (cp: number): number => {
        if (best.format === 12) {
            const groups = r.u32(o + 12);
            let lo = 0;
            let hi = groups - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const g = o + 16 + mid * 12;
                const start = r.u32(g);
                const end = r.u32(g + 4);
                if (cp < start) hi = mid - 1;
                else if (cp > end) lo = mid + 1;
                else return r.u32(g + 8) + (cp - start);
            }
            return 0;
        }
        if (best.format === 4) {
            if (cp > 0xffff) return 0;
            const segX2 = r.u16(o + 6);
            const ends = o + 14;
            const starts = ends + segX2 + 2;
            const deltas = starts + segX2;
            const ranges = deltas + segX2;
            for (let i = 0; i < segX2 / 2; i++) {
                const end = r.u16(ends + i * 2);
                if (cp > end) continue;
                const start = r.u16(starts + i * 2);
                if (cp < start) return 0;
                const delta = r.i16(deltas + i * 2);
                const range = r.u16(ranges + i * 2);
                if (range === 0) return (cp + delta) & 0xffff;
                const at = ranges + i * 2 + range + (cp - start) * 2;
                const g = r.u16(at);
                return g === 0 ? 0 : (g + delta) & 0xffff;
            }
            return 0;
        }
        if (best.format === 6) {
            const first = r.u16(o + 6);
            const count = r.u16(o + 8);
            return cp >= first && cp < first + count ? r.u16(o + 10 + (cp - first) * 2) : 0;
        }
        if (best.format === 0) return cp < 256 ? r.u8(o + 6 + cp) : 0;
        return 0;
    };
    return (cp) => {
        let g = cache.get(cp);
        if (g === undefined) {
            g = lookup(cp);
            cache.set(cp, g);
        }
        return g;
    };
}

function readFvar(r: Reader, table: { offset: number } | undefined, names: Map<number, string>): { axes: FontAxis[]; instances: FontInstance[] } {
    if (!table) return { axes: [], instances: [] };
    const o = table.offset;
    const axesOffset = r.u16(o + 4);
    const count = r.u16(o + 8);
    const size = r.u16(o + 10);
    const instanceCount = r.u16(o + 12);
    const instanceSize = r.u16(o + 14);
    const axes: FontAxis[] = [];
    for (let i = 0; i < count; i++) {
        const a = o + axesOffset + i * size;
        const name = size >= 20 ? names.get(r.u16(a + 18)) : undefined;
        axes.push({ tag: r.tag(a), min: r.fixed(a + 4), def: r.fixed(a + 8), max: r.fixed(a + 12), ...(name ? { name } : {}) });
    }
    const instances: FontInstance[] = [];
    if (instanceSize >= 4 + count * 4) {
        const start = o + axesOffset + count * size;
        for (let i = 0; i < instanceCount; i++) {
            const at = start + i * instanceSize;
            const coords: Record<string, number> = {};
            axes.forEach((axis, k) => {
                coords[axis.tag] = r.fixed(at + 4 + k * 4);
            });
            instances.push({ name: names.get(r.u16(at)) ?? `Instance ${i + 1}`, coords });
        }
    }
    return { axes, instances };
}

// The font's name strings by id (Windows Unicode English first, then Mac Roman).
function readNames(r: Reader, table: { offset: number; length: number } | undefined): Map<number, string> {
    const out = new Map<number, string>();
    if (!table) return out;
    try {
        const o = table.offset;
        const count = r.u16(o + 2);
        const strings = o + r.u16(o + 4);
        const rank = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            const rec = o + 6 + i * 12;
            const platform = r.u16(rec);
            const encoding = r.u16(rec + 2);
            const language = r.u16(rec + 4);
            const id = r.u16(rec + 6);
            const length = r.u16(rec + 8);
            const at = strings + r.u16(rec + 10);
            let score = -1;
            let text = "";
            if (platform === 3 && (encoding === 1 || encoding === 10)) {
                score = language === 0x409 ? 3 : 2;
                for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(r.u16(at + k));
            } else if (platform === 0) {
                score = 1;
                for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(r.u16(at + k));
            } else if (platform === 1 && encoding === 0) {
                score = 0;
                for (let k = 0; k < length; k++) text += String.fromCharCode(r.u8(at + k));
            }
            if (score < 0 || (rank.get(id) ?? -1) >= score) continue;
            rank.set(id, score);
            out.set(id, text);
        }
    } catch {
        // A damaged name table: no names.
    }
    return out;
}

function readAvar(r: Reader, table: { offset: number } | undefined, axisCount: number): [number, number][][] {
    if (!table) return [];
    let o = table.offset + 6;
    const count = Math.min(axisCount, r.u16(table.offset + 4));
    const out: [number, number][][] = [];
    for (let i = 0; i < count; i++) {
        const n = r.u16(o);
        o += 2;
        const map: [number, number][] = [];
        for (let j = 0; j < n; j++) {
            map.push([r.f2dot14(o), r.f2dot14(o + 2)]);
            o += 4;
        }
        out.push(map);
    }
    return out;
}

function mapAvar(map: [number, number][], v: number): number {
    for (let i = 1; i < map.length; i++) {
        const [a0, b0] = map[i - 1] as [number, number];
        const [a1, b1] = map[i] as [number, number];
        if (v <= a1) return a1 === a0 ? b0 : b0 + ((v - a0) / (a1 - a0)) * (b1 - b0);
    }
    return v;
}

type TTPoint = { x: number; y: number; on: boolean };
type TTContour = TTPoint[];

function readSimpleGlyph(r: Reader, o: number, contours: number): TTContour[] {
    const ends: number[] = [];
    for (let i = 0; i < contours; i++) ends.push(r.u16(o + 10 + i * 2));
    const total = contours ? (ends[contours - 1] ?? -1) + 1 : 0;
    let p = o + 10 + contours * 2;
    const instructionLength = r.u16(p);
    p += 2 + instructionLength;
    const flags: number[] = [];
    while (flags.length < total) {
        const f = r.u8(p++);
        flags.push(f);
        if (f & 8) {
            const repeat = r.u8(p++);
            for (let k = 0; k < repeat; k++) flags.push(f);
        }
    }
    const xs: number[] = [];
    let x = 0;
    for (const f of flags) {
        if (f & 2) {
            const d = r.u8(p++);
            x += f & 16 ? d : -d;
        } else if (!(f & 16)) {
            x += r.i16(p);
            p += 2;
        }
        xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (const f of flags) {
        if (f & 4) {
            const d = r.u8(p++);
            y += f & 32 ? d : -d;
        } else if (!(f & 32)) {
            y += r.i16(p);
            p += 2;
        }
        ys.push(y);
    }
    const out: TTContour[] = [];
    let start = 0;
    for (const end of ends) {
        const c: TTContour = [];
        for (let i = start; i <= end; i++) c.push({ x: xs[i] ?? 0, y: ys[i] ?? 0, on: Boolean((flags[i] ?? 1) & 1) });
        out.push(c);
        start = end + 1;
    }
    return out;
}

interface Component {
    gid: number;
    a: number;
    b: number;
    c: number;
    d: number;
    dx: number;
    dy: number;
}

function readComposite(r: Reader, o: number): Component[] {
    const parts: Component[] = [];
    let p = o + 10;
    let more = true;
    while (more) {
        const flags = r.u16(p);
        const gid = r.u16(p + 2);
        p += 4;
        let dx: number;
        let dy: number;
        if (flags & 1) {
            dx = flags & 2 ? r.i16(p) : r.u16(p);
            dy = flags & 2 ? r.i16(p + 2) : r.u16(p + 2);
            p += 4;
        } else {
            dx = flags & 2 ? r.i8(p) : r.u8(p);
            dy = flags & 2 ? r.i8(p + 1) : r.u8(p + 1);
            p += 2;
        }
        // Point-matching placement (flag 2 clear) is rare; treat the numbers as no offset.
        if (!(flags & 2)) {
            dx = 0;
            dy = 0;
        }
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        if (flags & 8) {
            a = d = r.f2dot14(p);
            p += 2;
        } else if (flags & 0x40) {
            a = r.f2dot14(p);
            d = r.f2dot14(p + 2);
            p += 4;
        } else if (flags & 0x80) {
            a = r.f2dot14(p);
            b = r.f2dot14(p + 2);
            c = r.f2dot14(p + 4);
            d = r.f2dot14(p + 6);
            p += 8;
        }
        parts.push({ gid, a, b, c, d, dx, dy });
        more = Boolean(flags & 0x20);
    }
    return parts;
}

// TrueType quadratic contours to path commands (consecutive off-curve points imply an on-curve
// point halfway between them).
function contoursToPath(contours: TTContour[]): PathCommand[] {
    const out: PathCommand[] = [];
    for (const c of contours) {
        if (!c.length) continue;
        const n = c.length;
        let startIndex = c.findIndex((p) => p.on);
        let start: { x: number; y: number };
        if (startIndex < 0) {
            const a = c[0] as TTPoint;
            const b = c[1 % n] as TTPoint;
            start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            startIndex = 0;
        } else start = c[startIndex] as TTPoint;
        out.push({ op: "M", x: start.x, y: start.y });
        let control: TTPoint | null = c[startIndex]?.on ? null : (c[startIndex] as TTPoint);
        for (let k = 1; k <= n; k++) {
            const p = c[(startIndex + k) % n] as TTPoint;
            const isClose = k === n;
            if (p.on) {
                if (control) out.push({ op: "Q", x1: control.x, y1: control.y, x: p.x, y: p.y });
                else if (!isClose) out.push({ op: "L", x: p.x, y: p.y });
                control = null;
            } else {
                if (control) {
                    const mid = { x: (control.x + p.x) / 2, y: (control.y + p.y) / 2 };
                    out.push({ op: "Q", x1: control.x, y1: control.y, x: mid.x, y: mid.y });
                }
                control = p;
            }
        }
        if (control) out.push({ op: "Q", x1: control.x, y1: control.y, x: start.x, y: start.y });
        out.push({ op: "Z" });
    }
    return out;
}

// gvar: per-glyph point deltas for variable TrueType fonts.
interface Gvar {
    offset: number;
    axisCount: number;
    sharedTuples: number[][];
    glyphOffset: (gid: number) => [number, number];
}

function readGvar(r: Reader, table: { offset: number } | undefined): Gvar | null {
    if (!table) return null;
    const o = table.offset;
    const axisCount = r.u16(o + 4);
    const sharedCount = r.u16(o + 6);
    const sharedOffset = o + r.u32(o + 8);
    const glyphCount = r.u16(o + 12);
    const flags = r.u16(o + 14);
    const dataOffset = o + r.u32(o + 16);
    const sharedTuples: number[][] = [];
    for (let i = 0; i < sharedCount; i++) {
        const t: number[] = [];
        for (let a = 0; a < axisCount; a++) t.push(r.f2dot14(sharedOffset + (i * axisCount + a) * 2));
        sharedTuples.push(t);
    }
    const long = Boolean(flags & 1);
    const offsets = o + 20;
    const at = (i: number) => (long ? r.u32(offsets + i * 4) : r.u16(offsets + i * 2) * 2);
    return {
        offset: o,
        axisCount,
        sharedTuples,
        glyphOffset: (gid) => (gid >= glyphCount ? [0, 0] : [dataOffset + at(gid), dataOffset + at(gid + 1)]),
    };
}

function readPointNumbers(r: Reader, p: number): { points: number[] | null; next: number } {
    let count = r.u8(p++);
    if (count & 0x80) count = ((count & 0x7f) << 8) | r.u8(p++);
    if (count === 0) return { points: null, next: p };
    const points: number[] = [];
    let last = 0;
    while (points.length < count) {
        const control = r.u8(p++);
        const runCount = (control & 0x7f) + 1;
        const words = Boolean(control & 0x80);
        for (let i = 0; i < runCount && points.length < count; i++) {
            const d = words ? r.u16(p) : r.u8(p);
            p += words ? 2 : 1;
            last += d;
            points.push(last);
        }
    }
    return { points, next: p };
}

function readDeltas(r: Reader, p: number, count: number): { deltas: number[]; next: number } {
    const deltas: number[] = [];
    while (deltas.length < count) {
        const control = r.u8(p++);
        const runCount = (control & 0x3f) + 1;
        if (control & 0x80) {
            for (let i = 0; i < runCount; i++) deltas.push(0);
        } else if (control & 0x40) {
            for (let i = 0; i < runCount; i++) {
                deltas.push(r.i16(p));
                p += 2;
            }
        } else {
            for (let i = 0; i < runCount; i++) deltas.push(r.i8(p++));
        }
    }
    return { deltas: deltas.slice(0, count), next: p };
}

function tupleScalar(coords: number[], peak: number[], start: number[] | null, end: number[] | null): number {
    let scalar = 1;
    for (let i = 0; i < peak.length; i++) {
        const pk = peak[i] ?? 0;
        if (pk === 0) continue;
        const v = coords[i] ?? 0;
        if (v === 0) return 0;
        if (start && end) {
            const s = start[i] ?? 0;
            const e = end[i] ?? 0;
            if (v < s || v > e) return 0;
            if (v < pk) scalar *= pk === s ? 1 : (v - s) / (pk - s);
            else if (v > pk) scalar *= e === pk ? 1 : (e - v) / (e - pk);
        } else {
            if ((v < 0 && pk > 0) || (v > 0 && pk < 0)) return 0;
            if (Math.abs(v) < Math.abs(pk)) scalar *= v / pk;
        }
    }
    return scalar;
}

// Adds the variation deltas for these coordinates to a simple glyph's points (in place) or to a
// composite's component offsets.
function applyGvar(r: Reader, gvar: Gvar, gid: number, coords: number[], contours: TTContour[] | null, parts: Component[] | null) {
    const [start, end] = gvar.glyphOffset(gid);
    if (end <= start) return;
    const flat: TTPoint[] = contours ? contours.flat() : (parts ?? []).map((c) => ({ x: c.dx, y: c.dy, on: true }));
    const pointCount = flat.length + 4;
    const ends: number[] = [];
    if (contours) {
        let n = 0;
        for (const c of contours) {
            n += c.length;
            ends.push(n - 1);
        }
    }
    const dx = new Float64Array(flat.length);
    const dy = new Float64Array(flat.length);
    let tupleCount = r.u16(start);
    const sharedPointsFlag = Boolean(tupleCount & 0x8000);
    tupleCount &= 0x0fff;
    let data = start + r.u16(start + 2);
    let sharedPoints: number[] | null = null;
    if (sharedPointsFlag) {
        const read = readPointNumbers(r, data);
        sharedPoints = read.points;
        data = read.next;
    }
    let h = start + 4;
    for (let t = 0; t < tupleCount; t++) {
        const size = r.u16(h);
        const index = r.u16(h + 2);
        h += 4;
        let peak: number[];
        if (index & 0x8000) {
            peak = [];
            for (let a = 0; a < gvar.axisCount; a++) peak.push(r.f2dot14(h + a * 2));
            h += gvar.axisCount * 2;
        } else peak = gvar.sharedTuples[index & 0x0fff] ?? [];
        let s: number[] | null = null;
        let e: number[] | null = null;
        if (index & 0x4000) {
            s = [];
            e = [];
            for (let a = 0; a < gvar.axisCount; a++) s.push(r.f2dot14(h + a * 2));
            h += gvar.axisCount * 2;
            for (let a = 0; a < gvar.axisCount; a++) e.push(r.f2dot14(h + a * 2));
            h += gvar.axisCount * 2;
        }
        const scalar = tupleScalar(coords, peak, s, e);
        const tupleData = data;
        data += size;
        if (scalar === 0) continue;
        let p = tupleData;
        let points = sharedPoints;
        if (index & 0x2000) {
            const read = readPointNumbers(r, p);
            points = read.points;
            p = read.next;
        }
        const n = points ? points.length : pointCount;
        const xs = readDeltas(r, p, n);
        const ys = readDeltas(r, xs.next, n);
        if (!points) {
            for (let i = 0; i < flat.length; i++) {
                dx[i] = (dx[i] ?? 0) + (xs.deltas[i] ?? 0) * scalar;
                dy[i] = (dy[i] ?? 0) + (ys.deltas[i] ?? 0) * scalar;
            }
            continue;
        }
        // Sparse deltas: unreferenced points are interpolated (IUP) within their contour.
        const tx = new Float64Array(flat.length);
        const ty = new Float64Array(flat.length);
        const touched = new Uint8Array(flat.length);
        points.forEach((pt, i) => {
            if (pt >= flat.length) return;
            tx[pt] = xs.deltas[i] ?? 0;
            ty[pt] = ys.deltas[i] ?? 0;
            touched[pt] = 1;
        });
        if (contours) {
            let first = 0;
            for (const last of ends) {
                iup(flat, tx, touched, first, last, "x");
                iup(flat, ty, touched, first, last, "y");
                first = last + 1;
            }
        }
        for (let i = 0; i < flat.length; i++) {
            dx[i] = (dx[i] ?? 0) + (tx[i] ?? 0) * scalar;
            dy[i] = (dy[i] ?? 0) + (ty[i] ?? 0) * scalar;
        }
    }
    if (contours) {
        let i = 0;
        for (const c of contours) {
            for (const p of c) {
                p.x += dx[i] ?? 0;
                p.y += dy[i] ?? 0;
                i++;
            }
        }
    } else if (parts) {
        parts.forEach((c, i) => {
            c.dx += dx[i] ?? 0;
            c.dy += dy[i] ?? 0;
        });
    }
}

function iup(points: TTPoint[], delta: Float64Array, touched: Uint8Array, first: number, last: number, axis: "x" | "y") {
    const refs: number[] = [];
    for (let i = first; i <= last; i++) if (touched[i]) refs.push(i);
    if (!refs.length) return;
    if (refs.length === 1) {
        const d = delta[refs[0] as number] ?? 0;
        for (let i = first; i <= last; i++) if (!touched[i]) delta[i] = d;
        return;
    }
    for (let k = 0; k < refs.length; k++) {
        const a = refs[k] as number;
        const b = refs[(k + 1) % refs.length] as number;
        let i = a + 1;
        while (true) {
            if (i > last) i = first;
            if (i === b) break;
            const pa = points[a]?.[axis] ?? 0;
            const pb = points[b]?.[axis] ?? 0;
            const da = delta[a] ?? 0;
            const db = delta[b] ?? 0;
            const v = points[i]?.[axis] ?? 0;
            const lo = Math.min(pa, pb);
            const hi = Math.max(pa, pb);
            if (v <= lo) delta[i] = pa < pb ? da : db;
            else if (v >= hi) delta[i] = pa > pb ? da : db;
            else delta[i] = da + ((v - pa) / (pb - pa)) * (db - da);
            i++;
        }
    }
}

// CFF: Type 2 charstrings, with local and global subroutines and CID fonts' per-font privates.
function readIndex(r: Reader, o: number): { items: [number, number][]; end: number } {
    const count = r.u16(o);
    if (count === 0) return { items: [], end: o + 2 };
    const offSize = r.u8(o + 2);
    const offAt = (i: number) => {
        let v = 0;
        for (let k = 0; k < offSize; k++) v = v * 256 + r.u8(o + 3 + i * offSize + k);
        return v;
    };
    const dataStart = o + 3 + (count + 1) * offSize - 1;
    const items: [number, number][] = [];
    for (let i = 0; i < count; i++) items.push([dataStart + offAt(i), dataStart + offAt(i + 1)]);
    return { items, end: dataStart + offAt(count) };
}

function readDict(r: Reader, start: number, end: number): Map<number, number[]> {
    const out = new Map<number, number[]>();
    let operands: number[] = [];
    let p = start;
    while (p < end) {
        const b0 = r.u8(p);
        if (b0 <= 21) {
            let op = b0;
            p++;
            if (b0 === 12) op = 1200 + r.u8(p++);
            out.set(op, operands);
            operands = [];
        } else if (b0 === 28) {
            operands.push(r.i16(p + 1));
            p += 3;
        } else if (b0 === 29) {
            operands.push(r.view.getInt32(p + 1));
            p += 5;
        } else if (b0 === 30) {
            // Real number in nibbles.
            let s = "";
            p++;
            let done = false;
            while (!done) {
                const byte = r.u8(p++);
                for (const nib of [byte >> 4, byte & 15]) {
                    if (nib === 15) {
                        done = true;
                        break;
                    }
                    s += nib <= 9 ? String(nib) : nib === 10 ? "." : nib === 11 ? "E" : nib === 12 ? "E-" : nib === 14 ? "-" : "";
                }
            }
            operands.push(Number.parseFloat(s));
        } else if (b0 >= 32 && b0 <= 246) {
            operands.push(b0 - 139);
            p++;
        } else if (b0 >= 247 && b0 <= 250) {
            operands.push((b0 - 247) * 256 + r.u8(p + 1) + 108);
            p += 2;
        } else if (b0 >= 251 && b0 <= 254) {
            operands.push(-(b0 - 251) * 256 - r.u8(p + 1) - 108);
            p += 2;
        } else p++;
    }
    return out;
}

const bias = (count: number) => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768);

function readCff(r: Reader, o: number): ((gid: number) => PathCommand[]) | null {
    const hdrSize = r.u8(o + 2);
    const names = readIndex(r, o + hdrSize);
    const topDicts = readIndex(r, names.end);
    const strings = readIndex(r, topDicts.end);
    const gsubrs = readIndex(r, strings.end);
    const top = topDicts.items[0];
    if (!top) return null;
    const dict = readDict(r, top[0], top[1]);
    const charStringsOffset = dict.get(17)?.[0];
    if (charStringsOffset === undefined) return null;
    const charStrings = readIndex(r, o + charStringsOffset);
    const privateOf = (entry: number[] | undefined) => {
        if (!entry || entry.length < 2) return { subrs: [] as [number, number][] };
        const [size, offset] = entry as [number, number];
        const pd = readDict(r, o + offset, o + offset + size);
        const subrsOffset = pd.get(19)?.[0];
        return { subrs: subrsOffset !== undefined ? readIndex(r, o + offset + subrsOffset).items : [] };
    };
    const mainPrivate = privateOf(dict.get(18));
    // CID-keyed fonts pick a private dict per glyph.
    let fdPrivates: { subrs: [number, number][] }[] = [];
    let fdSelect: ((gid: number) => number) | null = null;
    const fdArrayOffset = dict.get(1236)?.[0];
    const fdSelectOffset = dict.get(1237)?.[0];
    if (fdArrayOffset !== undefined && fdSelectOffset !== undefined) {
        fdPrivates = readIndex(r, o + fdArrayOffset).items.map(([s, e]) => privateOf(readDict(r, s, e).get(18)));
        const fs = o + fdSelectOffset;
        const format = r.u8(fs);
        if (format === 0) fdSelect = (gid) => r.u8(fs + 1 + gid);
        else if (format === 3) {
            const nRanges = r.u16(fs + 1);
            fdSelect = (gid) => {
                for (let i = 0; i < nRanges; i++) {
                    const first = r.u16(fs + 3 + i * 3);
                    const next = r.u16(fs + 3 + (i + 1) * 3);
                    if (gid >= first && gid < next) return r.u8(fs + 3 + i * 3 + 2);
                }
                return 0;
            };
        }
    }
    return (gid) => {
        const cs = charStrings.items[gid];
        if (!cs) return [];
        const local = fdSelect ? (fdPrivates[fdSelect(gid)]?.subrs ?? []) : mainPrivate.subrs;
        return runCharstring(r, cs, local, gsubrs.items);
    };
}

function runCharstring(r: Reader, main: [number, number], subrs: [number, number][], gsubrs: [number, number][]): PathCommand[] {
    const out: PathCommand[] = [];
    const stack: number[] = [];
    let x = 0;
    let y = 0;
    let stems = 0;
    let haveWidth = false;
    let open = false;
    const localBias = bias(subrs.length);
    const globalBias = bias(gsubrs.length);
    const close = () => {
        if (open) out.push({ op: "Z" });
        open = false;
    };
    const moveTo = (dx: number, dy: number) => {
        close();
        x += dx;
        y += dy;
        out.push({ op: "M", x, y });
        open = true;
    };
    const lineTo = (dx: number, dy: number) => {
        x += dx;
        y += dy;
        out.push({ op: "L", x, y });
    };
    const curveTo = (a: number, b: number, c: number, d: number, e: number, f: number) => {
        const x1 = x + a;
        const y1 = y + b;
        const x2 = x1 + c;
        const y2 = y1 + d;
        x = x2 + e;
        y = y2 + f;
        out.push({ op: "C", x1, y1, x2, y2, x, y });
    };
    // The first stack-clearing operator may carry the advance width first.
    const width = () => {
        if (!haveWidth) {
            if (stack.length % 2 === 1) stack.shift();
            haveWidth = true;
        }
    };
    let depth = 0;
    const run = ([start, end]: [number, number]): boolean => {
        if (++depth > 10) return true;
        let p = start;
        while (p < end) {
            const b0 = r.u8(p++);
            if (b0 >= 32 || b0 === 28) {
                if (b0 === 28) {
                    stack.push(r.i16(p));
                    p += 2;
                } else if (b0 <= 246) stack.push(b0 - 139);
                else if (b0 <= 250) stack.push((b0 - 247) * 256 + r.u8(p++) + 108);
                else if (b0 <= 254) stack.push(-(b0 - 251) * 256 - r.u8(p++) - 108);
                else {
                    stack.push(r.view.getInt32(p) / 65536);
                    p += 4;
                }
                continue;
            }
            switch (b0) {
                case 1:
                case 3:
                case 18:
                case 23:
                    width();
                    stems += stack.length >> 1;
                    stack.length = 0;
                    break;
                case 19:
                case 20:
                    width();
                    stems += stack.length >> 1;
                    stack.length = 0;
                    p += (stems + 7) >> 3;
                    break;
                case 21:
                    width();
                    moveTo(stack[stack.length - 2] ?? 0, stack[stack.length - 1] ?? 0);
                    stack.length = 0;
                    break;
                case 22:
                    if (!haveWidth && stack.length > 1) stack.shift();
                    haveWidth = true;
                    moveTo(stack[stack.length - 1] ?? 0, 0);
                    stack.length = 0;
                    break;
                case 4:
                    if (!haveWidth && stack.length > 1) stack.shift();
                    haveWidth = true;
                    moveTo(0, stack[stack.length - 1] ?? 0);
                    stack.length = 0;
                    break;
                case 5:
                    for (let i = 0; i + 1 < stack.length; i += 2) lineTo(stack[i] ?? 0, stack[i + 1] ?? 0);
                    stack.length = 0;
                    break;
                case 6:
                case 7: {
                    let horizontal = b0 === 6;
                    for (const v of stack) {
                        if (horizontal) lineTo(v, 0);
                        else lineTo(0, v);
                        horizontal = !horizontal;
                    }
                    stack.length = 0;
                    break;
                }
                case 8:
                    for (let i = 0; i + 5 < stack.length; i += 6) curveTo(stack[i] ?? 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, stack[i + 3] ?? 0, stack[i + 4] ?? 0, stack[i + 5] ?? 0);
                    stack.length = 0;
                    break;
                case 24: {
                    let i = 0;
                    for (; i + 5 < stack.length - 2; i += 6) curveTo(stack[i] ?? 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, stack[i + 3] ?? 0, stack[i + 4] ?? 0, stack[i + 5] ?? 0);
                    lineTo(stack[i] ?? 0, stack[i + 1] ?? 0);
                    stack.length = 0;
                    break;
                }
                case 25: {
                    let i = 0;
                    for (; i + 1 < stack.length - 6; i += 2) lineTo(stack[i] ?? 0, stack[i + 1] ?? 0);
                    curveTo(stack[i] ?? 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, stack[i + 3] ?? 0, stack[i + 4] ?? 0, stack[i + 5] ?? 0);
                    stack.length = 0;
                    break;
                }
                case 27: {
                    // hhcurveto: dy1? {dxa dxb dyb dxc}+
                    let i = 0;
                    let dy1 = 0;
                    if (stack.length % 2) dy1 = stack[i++] ?? 0;
                    for (; i + 3 < stack.length; i += 4) {
                        curveTo(stack[i] ?? 0, dy1, stack[i + 1] ?? 0, stack[i + 2] ?? 0, stack[i + 3] ?? 0, 0);
                        dy1 = 0;
                    }
                    stack.length = 0;
                    break;
                }
                case 26: {
                    // vvcurveto: dx1? {dya dxb dyb dyc}+
                    let i = 0;
                    let dx1 = 0;
                    if (stack.length % 2) dx1 = stack[i++] ?? 0;
                    for (; i + 3 < stack.length; i += 4) {
                        curveTo(dx1, stack[i] ?? 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, 0, stack[i + 3] ?? 0);
                        dx1 = 0;
                    }
                    stack.length = 0;
                    break;
                }
                case 30:
                case 31: {
                    let horizontal = b0 === 31;
                    let i = 0;
                    while (i + 3 < stack.length) {
                        const last = stack.length - i === 5;
                        const extra = last ? (stack[i + 4] ?? 0) : 0;
                        if (horizontal) curveTo(stack[i] ?? 0, 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, extra, stack[i + 3] ?? 0);
                        else curveTo(0, stack[i] ?? 0, stack[i + 1] ?? 0, stack[i + 2] ?? 0, stack[i + 3] ?? 0, extra);
                        i += last ? 5 : 4;
                        horizontal = !horizontal;
                    }
                    stack.length = 0;
                    break;
                }
                case 10: {
                    const index = (stack.pop() ?? 0) + localBias;
                    const sub = subrs[index];
                    if (sub && run(sub)) return true;
                    break;
                }
                case 29: {
                    const index = (stack.pop() ?? 0) + globalBias;
                    const sub = gsubrs[index];
                    if (sub && run(sub)) return true;
                    break;
                }
                case 11:
                    depth--;
                    return false;
                case 14:
                    width();
                    close();
                    stack.length = 0;
                    return true;
                case 12: {
                    const b1 = r.u8(p++);
                    const s = stack;
                    if (b1 === 35) {
                        curveTo(s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0, s[4] ?? 0, s[5] ?? 0);
                        curveTo(s[6] ?? 0, s[7] ?? 0, s[8] ?? 0, s[9] ?? 0, s[10] ?? 0, s[11] ?? 0);
                    } else if (b1 === 34) {
                        curveTo(s[0] ?? 0, 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0, 0);
                        curveTo(s[4] ?? 0, 0, s[5] ?? 0, -(s[2] ?? 0), s[6] ?? 0, 0);
                    } else if (b1 === 36) {
                        curveTo(s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0, s[4] ?? 0, 0);
                        curveTo(s[5] ?? 0, 0, s[6] ?? 0, s[7] ?? 0, s[8] ?? 0, -((s[1] ?? 0) + (s[3] ?? 0) + (s[7] ?? 0)));
                    } else if (b1 === 37) {
                        const sx = x;
                        const sy = y;
                        curveTo(s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0, s[4] ?? 0, s[5] ?? 0);
                        const dx = (s[0] ?? 0) + (s[2] ?? 0) + (s[4] ?? 0) + (s[6] ?? 0) + (s[8] ?? 0);
                        const dy = (s[1] ?? 0) + (s[3] ?? 0) + (s[5] ?? 0) + (s[7] ?? 0) + (s[9] ?? 0);
                        const last = s[10] ?? 0;
                        const x1 = x + (s[6] ?? 0);
                        const y1 = y + (s[7] ?? 0);
                        const x2 = x1 + (s[8] ?? 0);
                        const y2 = y1 + (s[9] ?? 0);
                        if (Math.abs(dx) > Math.abs(dy)) {
                            x = x2 + last;
                            y = sy;
                        } else {
                            x = sx;
                            y = y2 + last;
                        }
                        out.push({ op: "C", x1, y1, x2, y2, x, y });
                    }
                    stack.length = 0;
                    break;
                }
                default:
                    stack.length = 0;
            }
        }
        depth--;
        return false;
    };
    run(main);
    close();
    return out;
}

// GSUB: the features and their single (type 1) and ligature (type 4) lookups.
interface Gsub {
    features: { tag: string; lookups: number[] }[];
    lookups: { type: number; subtables: number[] }[];
}

function readGsub(r: Reader, table: { offset: number } | undefined): Gsub | null {
    if (!table) return null;
    const o = table.offset;
    const featureList = o + r.u16(o + 6);
    const lookupList = o + r.u16(o + 8);
    const features: Gsub["features"] = [];
    const fCount = r.u16(featureList);
    for (let i = 0; i < fCount; i++) {
        const rec = featureList + 2 + i * 6;
        const f = featureList + r.u16(rec + 4);
        const n = r.u16(f + 2);
        const lookups: number[] = [];
        for (let k = 0; k < n; k++) lookups.push(r.u16(f + 4 + k * 2));
        features.push({ tag: r.tag(rec), lookups });
    }
    const lookups: Gsub["lookups"] = [];
    const lCount = r.u16(lookupList);
    for (let i = 0; i < lCount; i++) {
        const l = lookupList + r.u16(lookupList + 2 + i * 2);
        let type = r.u16(l);
        const n = r.u16(l + 4);
        const subtables: number[] = [];
        for (let k = 0; k < n; k++) {
            let st = l + r.u16(l + 6 + k * 2);
            // Extension lookups point at the real subtable.
            if (type === 7) {
                type = r.u16(st + 2);
                st += r.u32(st + 4);
            }
            subtables.push(st);
        }
        lookups.push({ type, subtables });
    }
    return { features, lookups };
}

function coverageIndex(r: Reader, o: number, gid: number): number {
    const format = r.u16(o);
    const count = r.u16(o + 2);
    if (format === 1) {
        let lo = 0;
        let hi = count - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const g = r.u16(o + 4 + mid * 2);
            if (g < gid) lo = mid + 1;
            else if (g > gid) hi = mid - 1;
            else return mid;
        }
        return -1;
    }
    if (format === 2) {
        let lo = 0;
        let hi = count - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const rec = o + 4 + mid * 6;
            const start = r.u16(rec);
            const end = r.u16(rec + 2);
            if (gid < start) hi = mid - 1;
            else if (gid > end) lo = mid + 1;
            else return r.u16(rec + 4) + gid - start;
        }
    }
    return -1;
}

function applyGsub(r: Reader, gsub: Gsub, input: number[], features: Set<string>): { gid: number; from: number; count: number }[] {
    let glyphs = input.map((gid, i) => ({ gid, from: i, count: 1 }));
    const order = [...new Set(gsub.features.filter((f) => features.has(f.tag)).flatMap((f) => f.lookups))].sort((a, b) => a - b);
    for (const index of order) {
        const lookup = gsub.lookups[index];
        if (!lookup) continue;
        if (lookup.type === 1) {
            glyphs = glyphs.map((g) => {
                for (const st of lookup.subtables) {
                    const format = r.u16(st);
                    const cov = coverageIndex(r, st + r.u16(st + 2), g.gid);
                    if (cov < 0) continue;
                    if (format === 1) return { ...g, gid: (g.gid + r.i16(st + 4)) & 0xffff };
                    if (format === 2 && cov < r.u16(st + 4)) return { ...g, gid: r.u16(st + 6 + cov * 2) };
                }
                return g;
            });
        } else if (lookup.type === 4) {
            const out: typeof glyphs = [];
            let i = 0;
            while (i < glyphs.length) {
                const g = glyphs[i] as (typeof glyphs)[number];
                let matched: { gid: number; length: number } | null = null;
                for (const st of lookup.subtables) {
                    const cov = coverageIndex(r, st + r.u16(st + 2), g.gid);
                    if (cov < 0 || cov >= r.u16(st + 4)) continue;
                    const set = st + r.u16(st + 6 + cov * 2);
                    const ligs = r.u16(set);
                    for (let k = 0; k < ligs && !matched; k++) {
                        const lig = set + r.u16(set + 2 + k * 2);
                        const comp = r.u16(lig + 2);
                        let ok = i + comp <= glyphs.length;
                        for (let c = 1; ok && c < comp; c++) if (glyphs[i + c]?.gid !== r.u16(lig + 4 + (c - 1) * 2)) ok = false;
                        if (ok) matched = { gid: r.u16(lig), length: comp };
                    }
                    if (matched) break;
                }
                if (matched) {
                    const last = glyphs[i + matched.length - 1] as (typeof glyphs)[number];
                    out.push({ gid: matched.gid, from: g.from, count: last.from + last.count - g.from });
                    i += matched.length;
                } else {
                    out.push(g);
                    i++;
                }
            }
            glyphs = out;
        }
    }
    return glyphs;
}

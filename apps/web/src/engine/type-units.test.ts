import { describe, expect, it } from "vitest";
import { parseFont } from "./font-reader";
import { axisStops, parseTypedUnit, snapToStop } from "./type-units";

describe("typed units", () => {
    it("reads numbers with and without a unit, and Auto", () => {
        expect(parseTypedUnit("24")).toEqual({ kind: "number", value: 24, unit: null });
        expect(parseTypedUnit("150%")).toEqual({ kind: "number", value: 150, unit: "%" });
        expect(parseTypedUnit(" -0.5 px ")).toEqual({ kind: "number", value: -0.5, unit: "px" });
        expect(parseTypedUnit("Auto")).toEqual({ kind: "auto" });
        // Maths is left to the number field.
        expect(parseTypedUnit("12+4")).toBeNull();
        expect(parseTypedUnit("abc")).toBeNull();
    });
});

describe("axis stops", () => {
    const instances = [
        { name: "Thin", coords: { wght: 100, slnt: 0 } },
        { name: "Regular", coords: { wght: 400, slnt: 0 } },
        { name: "Semi Bold", coords: { wght: 600, slnt: 0 } },
        { name: "Thin Italic", coords: { wght: 100, slnt: -10 } },
        { name: "Black", coords: { wght: 900, slnt: 0 } },
    ];

    it("puts one dot per named value, named by the first instance there", () => {
        expect(axisStops("wght", 100, 900, instances)).toEqual([
            { value: 100, name: "Thin" },
            { value: 400, name: "Regular" },
            { value: 600, name: "Semi Bold" },
            { value: 900, name: "Black" },
        ]);
        expect(axisStops("slnt", -10, 0, instances).map((s) => s.value)).toEqual([-10, 0]);
        // An axis with a single named value has no dots.
        expect(axisStops("opsz", 14, 32, [{ name: "A", coords: { opsz: 14 } }])).toEqual([]);
    });

    it("snaps a drag that lands near a stop", () => {
        const stops = [{ value: 400 }, { value: 600 }];
        expect(snapToStop(612, stops, 100, 900)).toBe(600);
        expect(snapToStop(640, stops, 100, 900)).toBe(640);
    });
});

// A minimal font file with head, maxp, name and fvar tables: two axes and three named instances.
function variableFont(): ArrayBuffer {
    const names: [number, string][] = [
        [256, "Weight"],
        [257, "Slant"],
        [258, "Regular"],
        [259, "Bold"],
        [260, "Bold Italic"],
    ];
    const strings = names.map(([, t]) => t);
    const nameLen = 6 + names.length * 12 + strings.reduce((n, t) => n + t.length * 2, 0);
    const axisCount = 2;
    const instanceCount = 3;
    const fvarLen = 16 + axisCount * 20 + instanceCount * (4 + axisCount * 4);
    const tables: [string, number][] = [
        ["fvar", fvarLen],
        ["head", 54],
        ["maxp", 6],
        ["name", nameLen],
    ];
    let offset = 12 + tables.length * 16;
    const placed = tables.map(([tag, len]) => {
        const at = offset;
        offset += Math.ceil(len / 4) * 4;
        return { tag, len, at };
    });
    const buf = new ArrayBuffer(offset);
    const v = new DataView(buf);
    const tag = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    const fixed = (o: number, n: number) => v.setInt32(o, Math.round(n * 65536));
    v.setUint32(0, 0x00010000);
    v.setUint16(4, tables.length);
    placed.forEach((t, i) => {
        tag(12 + i * 16, t.tag);
        v.setUint32(12 + i * 16 + 8, t.at);
        v.setUint32(12 + i * 16 + 12, t.len);
    });
    const at = (t: string) => placed.find((p) => p.tag === t)?.at ?? 0;
    v.setUint16(at("head") + 18, 1000);
    v.setUint16(at("maxp") + 4, 1);
    // name: format 0, Windows Unicode English records.
    const n0 = at("name");
    v.setUint16(n0 + 2, names.length);
    v.setUint16(n0 + 4, 6 + names.length * 12);
    let str = 0;
    names.forEach(([id, text], i) => {
        const rec = n0 + 6 + i * 12;
        v.setUint16(rec, 3);
        v.setUint16(rec + 2, 1);
        v.setUint16(rec + 4, 0x409);
        v.setUint16(rec + 6, id);
        v.setUint16(rec + 8, text.length * 2);
        v.setUint16(rec + 10, str);
        [...text].forEach((c, k) => v.setUint16(n0 + 6 + names.length * 12 + str + k * 2, c.charCodeAt(0)));
        str += text.length * 2;
    });
    // fvar
    const f = at("fvar");
    v.setUint16(f, 1);
    v.setUint16(f + 4, 16);
    v.setUint16(f + 6, 2);
    v.setUint16(f + 8, axisCount);
    v.setUint16(f + 10, 20);
    v.setUint16(f + 12, instanceCount);
    v.setUint16(f + 14, 4 + axisCount * 4);
    const axes: [string, number, number, number, number][] = [
        ["wght", 100, 400, 900, 256],
        ["slnt", -10, 0, 0, 257],
    ];
    axes.forEach(([t, min, def, max, nameId], i) => {
        const a = f + 16 + i * 20;
        tag(a, t);
        fixed(a + 4, min);
        fixed(a + 8, def);
        fixed(a + 12, max);
        v.setUint16(a + 18, nameId);
    });
    const inst: [number, number, number][] = [
        [258, 400, 0],
        [259, 700, 0],
        [260, 700, -10],
    ];
    inst.forEach(([nameId, w, s], i) => {
        const o = f + 16 + axisCount * 20 + i * (4 + axisCount * 4);
        v.setUint16(o, nameId);
        fixed(o + 4, w);
        fixed(o + 8, s);
    });
    return buf;
}

describe("font variations (fvar)", () => {
    it("reads the axes with their names and the named instances", () => {
        const font = parseFont(variableFont());
        expect(font?.axes).toEqual([
            { tag: "wght", min: 100, def: 400, max: 900, name: "Weight" },
            { tag: "slnt", min: -10, def: 0, max: 0, name: "Slant" },
        ]);
        expect(font?.instances).toEqual([
            { name: "Regular", coords: { wght: 400, slnt: 0 } },
            { name: "Bold", coords: { wght: 700, slnt: 0 } },
            { name: "Bold Italic", coords: { wght: 700, slnt: -10 } },
        ]);
        expect(axisStops("wght", 100, 900, font?.instances ?? []).map((s) => s.name)).toEqual(["Regular", "Bold"]);
    });
});

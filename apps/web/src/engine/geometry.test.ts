import { describe, expect, it } from "vitest";
import { booleanResult, booleanShapes } from "./booleans";
import { booleanPaths } from "./clip";
import { applyCommand } from "./commands";
import { flattenNodes } from "./flatten";
import { makeNode } from "./nodes";
import { offsetSubpaths, pointCount, simplifySubpaths } from "./path-ops";
import type { BooleanOp, NagmaDocument, Rect, Subpath } from "./types";
import { booleanContains, ellipseSubpaths, pathBounds, rectSubpaths, samplePath } from "./vector";
import { faceAt, filledSubpaths, initiallyFilled, insidePoly, isFaceFilled, networkFaces, paintFaces, pointDegrees } from "./vector-network";
import { PAGE, add, box, emptyDoc, node } from "../test/core-fixtures";

const rect = (x: number, y: number, w: number, h: number): Subpath[] => rectSubpaths(x, y, w, h, [0, 0, 0, 0]);

// jsdom has no canvas hit testing, so containment is checked on the sampled outlines (even-odd).
function inside(subs: Subpath[], x: number, y: number): boolean {
    let count = 0;
    for (const poly of samplePath(subs)) if (poly.length > 2 && insidePoly(poly, { x, y })) count++;
    return count % 2 === 1;
}

// Filled area by counting unit cells (exact for axis-aligned shapes on whole pixels).
function area(subs: Subpath[], b: Rect = pathBounds(subs) ?? { x: 0, y: 0, w: 0, h: 0 }): number {
    let n = 0;
    for (let x = Math.floor(b.x); x < b.x + b.w; x++) for (let y = Math.floor(b.y); y < b.y + b.h; y++) if (inside(subs, x + 0.5, y + 0.5)) n++;
    return n;
}

function toPolyline(p: { x: number; y: number }, line: { x: number; y: number }[]): number {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!;
        const b = line[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
}

const near = (a: Rect | null, b: Rect, eps = 1e-6) => {
    expect(a).not.toBeNull();
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs((a as Rect)[k] - b[k])).toBeLessThanOrEqual(eps);
};

describe("boolean operations", () => {
    const A = rect(0, 0, 100, 100);
    const B = rect(50, 50, 100, 100);
    it.each([
        ["union", { x: 0, y: 0, w: 150, h: 150 }, 17500, [[25, 25, true], [75, 75, true], [125, 125, true], [125, 25, false]]],
        ["subtract", { x: 0, y: 0, w: 100, h: 100 }, 7500, [[25, 25, true], [75, 75, false], [125, 125, false]]],
        ["intersect", { x: 50, y: 50, w: 50, h: 50 }, 2500, [[25, 25, false], [75, 75, true], [125, 125, false]]],
        ["exclude", { x: 0, y: 0, w: 150, h: 150 }, 15000, [[25, 25, true], [75, 75, false], [125, 125, true], [125, 25, false]]],
    ] as [BooleanOp, Rect, number, [number, number, boolean][]][])("%s of two overlapping squares", (op, bounds, expectedArea, probes) => {
        const result = booleanPaths(op, [A, B]);
        near(pathBounds(result), bounds);
        expect(area(result)).toBe(expectedArea);
        for (const [x, y, want] of probes) {
            expect(inside(result, x, y)).toBe(want);
            // The live hit test agrees with the result.
            expect(booleanContains(op, [inside(A, x, y), inside(B, x, y)])).toBe(want);
        }
    });

    it("disjoint shapes: union keeps both, intersect is empty, subtract keeps the first", () => {
        const C = rect(200, 0, 10, 10);
        expect(area(booleanPaths("union", [A, C]))).toBe(10100);
        expect(booleanPaths("intersect", [A, C])).toEqual([]);
        expect(area(booleanPaths("subtract", [A, C]))).toBe(10000);
    });

    it("identical shapes: exclude is empty, intersect is the shape", () => {
        expect(area(booleanPaths("exclude", [A, rect(0, 0, 100, 100)]), { x: 0, y: 0, w: 100, h: 100 })).toBe(0);
        near(pathBounds(booleanPaths("intersect", [A, rect(0, 0, 100, 100)])), { x: 0, y: 0, w: 100, h: 100 });
    });

    it("a hole: subtracting a smaller square inside leaves a ring", () => {
        const ring = booleanPaths("subtract", [A, rect(25, 25, 50, 50)]);
        expect(inside(ring, 10, 10)).toBe(true);
        expect(inside(ring, 50, 50)).toBe(false);
        expect(area(ring)).toBe(7500);
    });

    it("curved shapes: two circles' union contains both centres, intersection only the lens", () => {
        const c1 = ellipseSubpaths(0, 0, 100, 100, null);
        const c2 = ellipseSubpaths(60, 0, 100, 100, null);
        const u = booleanPaths("union", [c1, c2]);
        const i = booleanPaths("intersect", [c1, c2]);
        near(pathBounds(u), { x: 0, y: 0, w: 160, h: 100 }, 0.5);
        near(pathBounds(i), { x: 60, y: 10, w: 40, h: 80 }, 1);
        expect(inside(u, 50, 50) && inside(u, 110, 50)).toBe(true);
        expect(inside(i, 80, 50)).toBe(true);
        expect(inside(i, 30, 50)).toBe(false);
    });

    it("no shapes, or empty shapes, give nothing", () => {
        for (const op of ["union", "subtract", "intersect", "exclude"] as BooleanOp[]) {
            expect(booleanPaths(op, [])).toEqual([]);
            expect(booleanPaths(op, [[], []])).toEqual([]);
        }
        expect(booleanContains("union", [])).toBe(false);
    });

    function booleanDoc(op: BooleanOp, extra: Partial<Record<"r2", object>> = {}): NagmaDocument {
        const doc = emptyDoc();
        return applyCommand(doc, {
            type: "batch",
            commands: [
                { type: "node.create", node: makeNode(doc, "boolean", { x: 0, y: 0, w: 1, h: 1 }, PAGE, { id: "BO", booleanOp: op }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 0, y: 0, w: 100, h: 100 }, "BO", { id: "r1" }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 50, y: 50, w: 100, h: 100 }, "BO", { id: "r2", ...extra.r2 }) },
            ],
        });
    }

    it.each([
        ["union", { x: 0, y: 0, w: 150, h: 150 }],
        ["subtract", { x: 0, y: 0, w: 100, h: 100 }],
        ["intersect", { x: 50, y: 50, w: 50, h: 50 }],
        ["exclude", { x: 0, y: 0, w: 150, h: 150 }],
    ] as [BooleanOp, Rect][])("a %s layer's box is its result's extent", (op, want) => {
        const doc = booleanDoc(op);
        near(box(doc, "BO"), want);
        near(pathBounds(booleanResult(doc, node(doc, "BO"))), want);
    });

    it("hidden children don't take part; changing the op refits the box", () => {
        const hidden = booleanDoc("union", { r2: { visible: false } });
        expect(booleanShapes(hidden, node(hidden, "BO"))).toHaveLength(1);
        near(box(hidden, "BO"), { x: 0, y: 0, w: 100, h: 100 });
        const doc = applyCommand(booleanDoc("union"), { type: "node.update", id: "BO", patch: { booleanOp: "intersect" } });
        near(box(doc, "BO"), { x: 50, y: 50, w: 50, h: 50 });
    });

    it("a rotated child takes part with its rotation", () => {
        const doc = booleanDoc("union", { r2: { x: 200, y: 0, w: 100, h: 100, rotation: 45 } });
        const half = 50 * Math.SQRT2;
        near(box(doc, "BO"), { x: 0, y: 50 - half, w: 250 + half, h: 2 * half }, 1e-3);
    });
});

describe("flatten", () => {
    function doc(): NagmaDocument {
        let d = add(emptyDoc(), "rect", "a", { x: 0, y: 0, w: 100, h: 100 });
        d = add(d, "ellipse", "b", { x: 50, y: 50, w: 100, h: 100 });
        d = add(d, "frame", "F", { x: 500, y: 0, w: 100, h: 100 });
        d = add(d, "rect", "c", { x: 500, y: 0, w: 10, h: 10 }, "F");
        d = add(d, "rect", "rot", { x: 0, y: 300, w: 100, h: 100 }, PAGE, { rotation: 45 });
        const path = { w: 10, h: 10, subpaths: rect(0, 0, 10, 10) };
        d = add(d, "vector", "v", { x: 300, y: 300, w: 10, h: 10 }, PAGE, { path });
        return d;
    }

    it("two shapes become one vector with their combined box, above them, in one step", () => {
        const d = doc();
        const result = flattenNodes(d, ["a", "b"]);
        expect(result).not.toBeNull();
        const after = applyCommand(d, { type: "batch", commands: result!.commands });
        const v = node(after, result!.id);
        expect(v.type).toBe("vector");
        near(box(after, v.id), { x: 0, y: 0, w: 150, h: 150 }, 1e-3);
        expect(after.nodes.a).toBeUndefined();
        expect(after.nodes.b).toBeUndefined();
        // Keeps the top layer's look.
        expect(v.fills).toEqual(node(d, "b").fills);
        expect(node(after, PAGE).children.indexOf(v.id)).toBe(0);
    });

    it("a single rectangle turns into a vector in place", () => {
        const result = flattenNodes(doc(), ["a"]);
        expect(result?.id).toBe("a");
        expect(result?.commands).toEqual([expect.objectContaining({ type: "node.convert", id: "a", to: "vector" })]);
        const after = applyCommand(doc(), result!.commands[0]!);
        expect(node(after, "a").type).toBe("vector");
        near(box(after, "a"), { x: 0, y: 0, w: 100, h: 100 });
    });

    // Regression: the new vector's box went through pixel snapping while its path kept the exact
    // size, so flattening anything off the pixel grid stretched and shifted it slightly.
    it("a rotated shape flattens to its turned outline", () => {
        const result = flattenNodes(doc(), ["rot", "a"]);
        const after = applyCommand(doc(), { type: "batch", commands: result!.commands });
        const half = 50 * Math.SQRT2;
        near(box(after, result!.id), { x: 50 - half, y: 0, w: 2 * half, h: 350 + half }, 1e-3);
    });

    it("frames, pages, a lone vector and nothing don't flatten", () => {
        expect(flattenNodes(doc(), ["F"])).toBeNull();
        expect(flattenNodes(doc(), [PAGE])).toBeNull();
        expect(flattenNodes(doc(), ["v"])).toBeNull();
        expect(flattenNodes(doc(), [])).toBeNull();
        expect(flattenNodes(doc(), ["missing"])).toBeNull();
    });

    it("a layer inside a frame flattens with its siblings into that frame", () => {
        let d = doc();
        d = add(d, "rect", "c2", { x: 550, y: 50, w: 10, h: 10 }, "F");
        const result = flattenNodes(d, ["c", "c2"]);
        const after = applyCommand(d, { type: "batch", commands: result!.commands });
        expect(node(after, result!.id).parentId).toBe("F");
        near(box(after, result!.id), { x: 500, y: 0, w: 60, h: 60 });
    });
});

describe("vector networks", () => {
    const line = (pts: [number, number][], closed = false): Subpath => ({ closed, points: pts.map(([x, y]) => ({ x, y, in: null, out: null })) });

    it("one closed square is one region, filled initially", () => {
        const subs = [line([[0, 0], [10, 0], [10, 10], [0, 10]], true)];
        const faces = networkFaces(subs);
        expect(faces).toHaveLength(1);
        expect(faces[0]!.area).toBeCloseTo(100, 6);
        expect(initiallyFilled(subs, faces)).toEqual([faces[0]!.id]);
    });

    it("an open path has no regions", () => {
        const subs = [line([[0, 0], [10, 0], [10, 10]])];
        expect(networkFaces(subs)).toEqual([]);
        expect(initiallyFilled(subs)).toEqual([]);
    });

    it("a square split by a line through it has two regions", () => {
        const subs = [line([[0, 0], [10, 0], [10, 10], [0, 10]], true), line([[5, 0], [5, 10]])];
        const faces = networkFaces(subs);
        expect(faces).toHaveLength(2);
        expect(faces.map((f) => Math.round(f.area)).sort()).toEqual([50, 50]);
        expect(faceAt(faces, { x: 2, y: 5 })).not.toBe(faceAt(faces, { x: 8, y: 5 }));
        // The split points are junctions of three segments.
        expect(pointDegrees(subs).get("500:0")).toBe(3);
    });

    it("two overlapping squares give three regions (crossings become points)", () => {
        const subs = [line([[0, 0], [10, 0], [10, 10], [0, 10]], true), line([[5, 5], [15, 5], [15, 15], [5, 15]], true)];
        const faces = networkFaces(subs);
        expect(faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([25, 75, 75]);
        // As a plain path both squares fill, so every region starts filled.
        expect(initiallyFilled(subs, faces)).toHaveLength(3);
        const overlap = faceAt(faces, { x: 7, y: 7 });
        expect(overlap?.area).toBeCloseTo(25, 3);
    });

    it("a shape inside another is a hole of the outer region", () => {
        const subs = [line([[0, 0], [30, 0], [30, 30], [0, 30]], true), line([[10, 10], [20, 10], [20, 20], [10, 20]], true)];
        const faces = networkFaces(subs);
        expect(faces).toHaveLength(2);
        const outer = faceAt(faces, { x: 5, y: 5 })!;
        expect(outer.holes).toHaveLength(1);
        // Inside the hole, the smallest region is the inner square.
        expect(faceAt(faces, { x: 15, y: 15 })?.area).toBeCloseTo(100, 3);
        // Filling only the outer region leaves the hole empty (even-odd).
        const fill = filledSubpaths(subs, [outer.id]);
        expect(inside(fill, 5, 5)).toBe(true);
        expect(inside(fill, 15, 15)).toBe(false);
    });

    it("the paint tool toggles regions; the first edit starts from the plain fill", () => {
        const subs = [line([[0, 0], [10, 0], [10, 10], [0, 10]], true), line([[5, 0], [5, 10]])];
        const v = makeNode(emptyDoc(), "vector", { x: 0, y: 0, w: 10, h: 10 }, PAGE);
        const faces = networkFaces(subs);
        const left = faceAt(faces, { x: 2, y: 5 })!;
        const right = faceAt(faces, { x: 8, y: 5 })!;
        expect(isFaceFilled(v, subs, left.id)).toBe(true);
        const cleared = { ...v, regionFills: paintFaces(v, subs, [left.id], true) };
        expect(cleared.regionFills).toHaveLength(1);
        expect(isFaceFilled(cleared, subs, left.id)).toBe(false);
        expect(isFaceFilled(cleared, subs, right.id)).toBe(true);
        const refilled = { ...cleared, regionFills: paintFaces(cleared, subs, [left.id], false) };
        expect(isFaceFilled(refilled, subs, left.id)).toBe(true);
        // Remembered points find the regions again after the network changes (a point added).
        const moved = [line([[0, 0], [10, 0], [10, 10], [0, 10]], true), line([[5, 0], [5, 5], [5, 10]])];
        const movedFaces = networkFaces(moved);
        expect(isFaceFilled(cleared, moved, faceAt(movedFaces, { x: 8, y: 5 })!.id)).toBe(true);
        expect(isFaceFilled(cleared, moved, faceAt(movedFaces, { x: 2, y: 5 })!.id)).toBe(false);
    });

    it("degenerate input: no subpaths, single points", () => {
        expect(networkFaces([])).toEqual([]);
        expect(networkFaces([line([[1, 1]])])).toEqual([]);
        expect(networkFaces([line([[1, 1]], true)])).toEqual([]);
    });
});

describe("offset and simplify path", () => {
    const square = rect(0, 0, 100, 100);

    it.each(["miter", "round", "bevel"] as const)("offset %s grows a square by the distance", (join) => {
        const out = offsetSubpaths(square, 10, join);
        const b = pathBounds(out)!;
        near(b, { x: -10, y: -10, w: 120, h: 120 }, 0.6);
        expect(inside(out, -5, 50)).toBe(true);
        expect(inside(out, 50, 50)).toBe(true);
        // Corners: miter keeps the sharp corner, round and bevel cut it.
        expect(inside(out, -8, -8)).toBe(join === "miter");
    });

    it.each(["miter", "round", "bevel"] as const)("negative offset %s shrinks it", (join) => {
        const out = offsetSubpaths(square, -10, join);
        near(pathBounds(out), { x: 10, y: 10, w: 80, h: 80 }, 0.6);
        expect(inside(out, 5, 50)).toBe(false);
        expect(inside(out, 50, 50)).toBe(true);
    });

    it("a miter past the limit becomes a bevel", () => {
        const sharp: Subpath[] = [{ closed: true, points: [{ x: 0, y: 0, in: null, out: null }, { x: 100, y: 5, in: null, out: null }, { x: 0, y: 10, in: null, out: null }] }];
        const limited = pathBounds(offsetSubpaths(sharp, 5, "miter", 2))!;
        const free = pathBounds(offsetSubpaths(sharp, 5, "miter", 100))!;
        expect(free.w).toBeGreaterThan(limited.w + 10);
    });

    it("an open line becomes a band either side", () => {
        const open: Subpath[] = [{ closed: false, points: [{ x: 0, y: 0, in: null, out: null }, { x: 100, y: 0, in: null, out: null }] }];
        near(pathBounds(offsetSubpaths(open, 4, "miter")), { x: 0, y: -4, w: 100, h: 8 }, 1e-6);
    });

    it("degenerate inputs don't crash", () => {
        expect(offsetSubpaths(square, 0, "round")).toBe(square);
        expect(offsetSubpaths([], 5, "round")).toEqual([]);
        const dot: Subpath[] = [{ closed: false, points: [{ x: 1, y: 1, in: null, out: null }] }];
        expect(offsetSubpaths(dot, 5, "round")).toEqual([]);
        const zeroLen: Subpath[] = [{ closed: false, points: [{ x: 1, y: 1, in: null, out: null }, { x: 1, y: 1, in: null, out: null }] }];
        expect(() => offsetSubpaths(zeroLen, 5, "miter")).not.toThrow();
        // Shrinking a shape by more than its size leaves nothing.
        expect(offsetSubpaths(rect(0, 0, 10, 10), -20, "miter")).toEqual([]);
    });

    it("simplify reduces points within tolerance and keeps the endpoints of open paths", () => {
        const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 0.2 + (i > 50 ? (i - 50) : 0), in: null, out: null }));
        const subs: Subpath[] = [{ closed: false, points: pts }];
        const out = simplifySubpaths(subs, 1);
        expect(pointCount(out)).toBeLessThan(20);
        expect(out[0]!.points[0]).toMatchObject({ x: 0, y: 0 });
        const last = out[0]!.points.at(-1)!;
        expect(last.x).toBe(100);
        expect(last.y).toBeCloseTo(pts[100]!.y, 9);
        // Regression: smooth segments next to a bend strayed 4px from the original at tolerance 1.
        // Every original point stays within tolerance of the simplified outline.
        const samples = samplePath(out, 64)[0]!;
        for (const p of pts) expect(toPolyline(p, samples)).toBeLessThanOrEqual(1.01);
    });

    // Regression: a closed path was cut at its first point, which is also its last, so the pass saw
    // no distance at all and Simplify path left every closed shape unchanged.
    it("simplify reduces a densely sampled closed curve and stays within tolerance", () => {
        const circle = samplePath(ellipseSubpaths(0, 0, 200, 200, null), 24)[0]!.slice(0, -1);
        const dense: Subpath[] = [{ closed: true, points: circle.map((p) => ({ ...p, in: null, out: null })) }];
        expect(pointCount(dense)).toBe(96);
        const out = simplifySubpaths(dense, 1);
        expect(out[0]!.closed).toBe(true);
        expect(pointCount(out)).toBeLessThan(40);
        const samples = samplePath(out, 64).flat();
        for (const p of circle) expect(toPolyline(p, samples)).toBeLessThanOrEqual(1.01);
        near(pathBounds(out), { x: 0, y: 0, w: 200, h: 200 }, 1);
    });

    it("simplify keeps a closed square's corners", () => {
        // 40 points along the square's outline (10 per side).
        const ring = [...Array(10).keys()].flatMap((i) => [[i * 10, 0], [100, i * 10], [100 - i * 10, 100], [0, 100 - i * 10]] as [number, number][]);
        const order = [0, 1, 2, 3].flatMap((side) => ring.filter((_, k) => k % 4 === side));
        const dense: Subpath[] = [{ closed: true, points: order.map(([x, y]) => ({ x, y, in: null, out: null })) }];
        expect(pointCount(dense)).toBe(40);
        const out = simplifySubpaths(dense, 0.5);
        expect(out[0]!.closed).toBe(true);
        expect(out[0]!.points).toHaveLength(4);
        near(pathBounds(out), { x: 0, y: 0, w: 100, h: 100 });
    });

    it("simplify with zero or negative tolerance, or tiny paths, changes nothing", () => {
        expect(simplifySubpaths(square, 0)).toBe(square);
        expect(simplifySubpaths(square, -3)).toBe(square);
        const two: Subpath[] = [{ closed: false, points: [{ x: 0, y: 0, in: null, out: null }, { x: 5, y: 5, in: null, out: null }] }];
        expect(simplifySubpaths(two, 2)).toEqual(two);
        expect(simplifySubpaths([], 2)).toEqual([]);
        const one: Subpath[] = [{ closed: false, points: [{ x: 0, y: 0, in: null, out: null }] }];
        expect(simplifySubpaths(one, 2)).toEqual(one);
    });
});

describe("offset and simplify on the selection", () => {
    it("an offset copy of an ellipse keeps the exact offset box (not snapped to whole pixels)", async () => {
        const { editor } = await import("./store");
        const { offsetSelection } = await import("./path-ops");
        editor.loadDocument(add(emptyDoc(), "ellipse", "e", { x: 0, y: 0, w: 100, h: 100 }), null);
        editor.set({ selection: ["e"] });
        expect(offsetSelection(2.5, "round", 4)).toBe(1);
        const copy = node(editor.get().doc, editor.get().selection[0] as string);
        expect(copy.name).toBe(`${node(editor.get().doc, "e").name} offset`);
        near(box(editor.get().doc, copy.id), { x: -2.5, y: -2.5, w: 105, h: 105 }, 0.3);
        expect(copy.x).not.toBe(Math.round(copy.x));
        // The path's box and the layer's agree, so nothing is stretched.
        expect(copy.path?.w).toBeCloseTo(copy.w, 9);
        expect(copy.path?.h).toBeCloseTo(copy.h, 9);
    });

    it("simplify turns a rectangle into a vector without changing it", async () => {
        const { simplifyCommands } = await import("./path-ops");
        const { editor } = await import("./store");
        const doc = add(emptyDoc(), "rect", "r", { x: 10, y: 10, w: 100, h: 50 });
        editor.loadDocument(doc, null);
        editor.set({ selection: ["r"] });
        const after = applyCommand(doc, { type: "batch", commands: simplifyCommands(1, doc) });
        expect(node(after, "r").type).toBe("vector");
        near(box(after, "r"), { x: 10, y: 10, w: 100, h: 50 });
    });
});

describe("boolean operations: random rectangles", () => {
    function rng(seed: number) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 2 ** 32;
        };
    }
    it.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i: areas add up (union = A + B − A∩B, exclude = union − A∩B, subtract = A − A∩B)", (seed) => {
        const r = rng(seed);
        const R = () => rect(Math.floor(r() * 30), Math.floor(r() * 30), 1 + Math.floor(r() * 30), 1 + Math.floor(r() * 30));
        const A = R();
        const B = R();
        const frame = { x: 0, y: 0, w: 60, h: 60 };
        const a = area(A, frame);
        const b = area(B, frame);
        const i = area(booleanPaths("intersect", [A, B]), frame);
        expect(area(booleanPaths("union", [A, B]), frame)).toBe(a + b - i);
        expect(area(booleanPaths("exclude", [A, B]), frame)).toBe(a + b - 2 * i);
        expect(area(booleanPaths("subtract", [A, B]), frame)).toBe(a - i);
    });
});

// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "../engine/inspect-settings";
import { describe, expect, it } from "vitest";
import { makeNode } from "../engine/nodes";
import type { NagmaDocument, PathPoint, SceneNode, Subpath } from "../engine/types";
import { fitPath, placedSubpaths, samplePath } from "../engine/vector";
import { PAGE, emptyDoc } from "../test/core-fixtures";
import { closeLastSubpath, deleteVertices, hitSegment, insertPoint, removeLastPoint, shapeLastPoint } from "./vector-edit";

// Point editing with the pen: a click on a segment splits it there without changing the curve,
// Delete takes a point out and joins its neighbours (a closed path stays closed), Backspace while
// drawing removes the last point, and closing joins the last point to the first.

type Pt = { x: number; y: number };

const P = (x: number, y: number, inH: Pt | null = null, outH: Pt | null = null): PathPoint => ({ x, y, in: inH, out: outH });

function vector(doc: NagmaDocument, subs: Subpath[]): SceneNode {
    const fitted = fitPath(subs);
    return makeNode(doc, "vector", fitted, PAGE, { id: "V", path: fitted.path, parametric: null });
}

// A square, a circle and a rounded-corner shape whose top edge is straight on one side only.
const square = (): Subpath => ({ closed: true, points: [P(0, 0), P(100, 0), P(100, 100), P(0, 100)] });
const K = 0.5522847498 * 50;
const circle = (): Subpath => ({
    closed: true,
    points: [P(50, 0, { x: 50 - K, y: 0 }, { x: 50 + K, y: 0 }), P(100, 50, { x: 100, y: 50 - K }, { x: 100, y: 50 + K }), P(50, 100, { x: 50 + K, y: 100 }, { x: 50 - K, y: 100 }), P(0, 50, { x: 0, y: 50 + K }, { x: 0, y: 50 - K })],
});
const halfCurved = (): Subpath => ({ closed: false, points: [P(0, 0, null, { x: 40, y: -40 }), P(100, 0), P(100, 100)] });

// The distance from a point to the nearest spot of a finely sampled path (its polyline).
function distanceToPath(subs: Subpath[], p: Pt): number {
    let best = Infinity;
    for (const poly of samplePath(subs, 200)) {
        for (let i = 0; i + 1 < poly.length; i++) {
            const a = poly[i]!;
            const b = poly[i + 1]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
        }
    }
    return best;
}

const applied = (node: SceneNode, patch: Partial<SceneNode>) => ({ ...node, ...patch }) as SceneNode;

describe("inserting a point on a segment", () => {
    it("splits a straight segment at the click, with no handles, and keeps the path closed", () => {
        const node = vector(emptyDoc(), [square()]);
        const added = insertPoint(node, { sub: 0, index: 0, t: 0.5, point: { x: 50, y: 0 } });
        expect(added).not.toBeNull();
        const next = applied(node, added!.patch);
        const sub = placedSubpaths(next)[0]!;
        expect(sub.closed).toBe(true);
        expect(sub.points).toHaveLength(5);
        expect(added!.ref).toEqual({ sub: 0, index: 1, part: "anchor" });
        expect(sub.points[1]).toEqual(P(50, 0));
        expect(sub.points.every((p) => !p.in && !p.out)).toBe(true);
        // The layer's box is unchanged.
        expect([next.x, next.y, next.w, next.h]).toEqual([0, 0, 100, 100]);
    });

    it("splits a curve without changing its shape", () => {
        const node = vector(emptyDoc(), [circle()]);
        const before = placedSubpaths(node);
        const added = insertPoint(node, { sub: 0, index: 0, t: 0.3, point: { x: 0, y: 0 } });
        const after = placedSubpaths(applied(node, added!.patch));
        expect(after[0]!.points).toHaveLength(5);
        expect(after[0]!.closed).toBe(true);
        // Every point of the old curve still lies on the new one, and the new point has both handles.
        for (const poly of samplePath(before, 40)) for (const q of poly) expect(distanceToPath(after, q)).toBeLessThan(0.05);
        const mid = after[0]!.points[1]!;
        expect(mid.in && mid.out).toBeTruthy();
    });

    it("splits the last segment of a closed path (back to the first point)", () => {
        const node = vector(emptyDoc(), [square()]);
        const added = insertPoint(node, { sub: 0, index: 3, t: 0.5, point: { x: 0, y: 50 } });
        const sub = placedSubpaths(applied(node, added!.patch))[0]!;
        expect(sub.closed).toBe(true);
        expect(sub.points.map((p) => [p.x, p.y])).toEqual([
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 50],
        ]);
        expect(added!.ref.index).toBe(4);
    });

    it("gives no zero-length handles when one side of the segment was straight", () => {
        const node = vector(emptyDoc(), [halfCurved()]);
        const added = insertPoint(node, { sub: 0, index: 0, t: 0.5, point: { x: 50, y: -15 } });
        const sub = placedSubpaths(applied(node, added!.patch))[0]!;
        expect(sub.points).toHaveLength(4);
        // The end that was straight stays a sharp point (no handle sitting on top of it).
        expect(sub.points[2]!.in).toBeNull();
        expect(sub.points[0]!.out).not.toBeNull();
        const mid = sub.points[1]!;
        expect(mid.in && mid.out).toBeTruthy();
        expect(Math.hypot(mid.out!.x - mid.x, mid.out!.y - mid.y)).toBeGreaterThan(1);
    });

    it("hit-tests the segment at the spot clicked", () => {
        let doc = emptyDoc();
        const node = vector(doc, [square()]);
        doc = { ...doc, nodes: { ...doc.nodes, V: node } };
        const camera = { x: 0, y: 0, zoom: 1 };
        const hit = hitSegment(doc, node, camera, 100, 60);
        expect(hit).not.toBeNull();
        expect(hit!.sub).toBe(0);
        expect(hit!.index).toBe(1);
        expect(hit!.t).toBeCloseTo(0.6, 1);
        expect(hitSegment(doc, node, camera, 50, 50)).toBeNull();
    });
});

describe("deleting points", () => {
    it("joins the neighbours of a deleted point and keeps the path closed", () => {
        const node = vector(emptyDoc(), [square()]);
        const patch = deleteVertices(node, [{ sub: 0, index: 1, part: "anchor" }], false);
        expect(patch).not.toBeNull();
        const sub = placedSubpaths(applied(node, patch!))[0]!;
        expect(sub.closed).toBe(true);
        expect(sub.points.map((p) => [p.x, p.y])).toEqual([
            [0, 0],
            [100, 100],
            [0, 100],
        ]);
        expect(placedSubpaths(applied(node, patch!))).toHaveLength(1);
    });

    it("keeps the neighbours' handles so the curve runs on across the gap", () => {
        const node = vector(emptyDoc(), [circle()]);
        const patch = deleteVertices(node, [{ sub: 0, index: 1, part: "anchor" }], false);
        const sub = placedSubpaths(applied(node, patch!))[0]!;
        expect(sub.closed).toBe(true);
        expect(sub.points).toHaveLength(3);
        expect(sub.points[0]!.out).toEqual({ x: 50 + K, y: 0 });
        expect(sub.points[1]!.in).toEqual({ x: 50 + K, y: 100 });
    });

    it("removes several points at once, by their original indices", () => {
        const node = vector(emptyDoc(), [square()]);
        const patch = deleteVertices(
            node,
            [
                { sub: 0, index: 0, part: "anchor" },
                { sub: 0, index: 2, part: "anchor" },
            ],
            false,
        );
        const sub = placedSubpaths(applied(node, patch!))[0]!;
        expect(sub.points.map((p) => [p.x, p.y])).toEqual([
            [100, 0],
            [0, 100],
        ]);
    });

    it("takes a point shared by two paths of the network out of both", () => {
        // A square with a branch drawn from its corner by the pen (the branch starts on the corner).
        const node = vector(emptyDoc(), [square(), { closed: false, points: [P(100, 0), P(150, 50), P(200, 0)] }]);
        const patch = deleteVertices(node, [{ sub: 0, index: 1, part: "anchor" }], false);
        const subs = placedSubpaths(applied(node, patch!));
        expect(subs).toHaveLength(2);
        expect(subs[0]!.points).toHaveLength(3);
        expect(subs[0]!.closed).toBe(true);
        expect(subs[1]!.points.map((p) => [p.x, p.y])).toEqual([
            [150, 50],
            [200, 0],
        ]);
    });

    it("drops a path left with a single point, and reports nothing left", () => {
        const node = vector(emptyDoc(), [{ closed: false, points: [P(0, 0), P(50, 50)] }]);
        expect(deleteVertices(node, [{ sub: 0, index: 0, part: "anchor" }], false)).toBeNull();
    });
});

describe("drawing with the pen", () => {
    it("Backspace takes the last point off; an emptied path goes too", () => {
        const node = vector(emptyDoc(), [{ closed: false, points: [P(0, 0), P(50, 0), P(50, 50)] }]);
        const patch = removeLastPoint(node);
        expect(placedSubpaths(applied(node, patch!))[0]!.points.map((p) => [p.x, p.y])).toEqual([
            [0, 0],
            [50, 0],
        ]);
        const two = vector(emptyDoc(), [square(), { closed: false, points: [P(0, 0)] }]);
        expect(placedSubpaths(applied(two, removeLastPoint(two)!))).toHaveLength(1);
        expect(removeLastPoint(vector(emptyDoc(), [{ closed: false, points: [P(0, 0)] }]))).toBeNull();
    });

    it("dragging while placing pulls out symmetric handles", () => {
        const node = vector(emptyDoc(), [{ closed: false, points: [P(0, 0), P(100, 0)] }]);
        const sub = placedSubpaths(applied(node, shapeLastPoint(node, { x: 140, y: 30 })))[0]!;
        const last = sub.points[1]!;
        expect(last.out!.x).toBeCloseTo(140);
        expect(last.out!.y).toBeCloseTo(30);
        expect(last.in!.x).toBeCloseTo(60);
        expect(last.in!.y).toBeCloseTo(-30);
    });

    it("clicking the first point closes the path", () => {
        const node = vector(emptyDoc(), [{ closed: false, points: [P(0, 0), P(100, 0), P(50, 80)] }]);
        const sub = placedSubpaths(applied(node, closeLastSubpath(node)))[0]!;
        expect(sub.closed).toBe(true);
        expect(sub.points).toHaveLength(3);
    });
});

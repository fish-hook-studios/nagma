import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { constrain } from "./constraints";
import { makeNode } from "./nodes";
import type { Constraints, NagmaDocument, Rect } from "./types";
import { PAGE, add, box, emptyDoc, node, plain, undoOf } from "../test/core-fixtures";

// A 200 × 100 frame at (100, 100) with a child 20 from the left, 30 from the top, 40 × 20
// (so 140 from the right and 50 from the bottom).
function setup(c: Constraints, frameType: "frame" | "component" = "frame"): NagmaDocument {
    let doc = add(emptyDoc(), frameType, "F", { x: 100, y: 100, w: 200, h: 100 });
    doc = add(doc, "rect", "c", { x: 120, y: 130, w: 40, h: 20 }, "F", { constraints: c });
    return doc;
}

const resize = (doc: NagmaDocument, to: Partial<Rect>, ignoreConstraints = false) => applyCommand(doc, { type: "node.update", id: "F", patch: to, ...(ignoreConstraints ? { ignoreConstraints } : {}) });

describe("constraints when a frame is resized", () => {
    // Frame grows to 400 × 300 (same corner).
    it.each([
        [{ h: "left", v: "top" }, { x: 120, y: 130, w: 40, h: 20 }],
        [{ h: "right", v: "bottom" }, { x: 500 - 140 - 40, y: 400 - 50 - 20, w: 40, h: 20 }],
        [{ h: "left-right", v: "top-bottom" }, { x: 120, y: 130, w: 400 - 20 - 140, h: 300 - 30 - 50 }],
        [{ h: "center", v: "center" }, { x: 100 + 200 - (100 - 20), y: 100 + 150 - (50 - 30), w: 40, h: 20 }],
        [{ h: "scale", v: "scale" }, { x: 100 + 20 * 2, y: 100 + 30 * 3, w: 80, h: 60 }],
        [{ h: "left", v: "scale" }, { x: 120, y: 190, w: 40, h: 60 }],
        [{ h: "right", v: "top-bottom" }, { x: 320, y: 130, w: 40, h: 220 }],
    ] as [Constraints, Rect][])("%o", (c, want) => {
        const doc = resize(setup(c), { w: 400, h: 300 });
        const got = box(doc, "c");
        for (const k of ["x", "y", "w", "h"] as const) expect(got[k]).toBeCloseTo(want[k], 6);
    });

    it("default constraints are left and top", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 100, h: 100 });
        doc = add(doc, "rect", "c", { x: 10, y: 10, w: 10, h: 10 }, "F");
        expect(box(resize(doc, { x: -50, w: 150 }), "c")).toEqual({ x: -40, y: 10, w: 10, h: 10 });
    });

    it("moving the frame's left edge keeps right-pinned layers in place on screen", () => {
        const doc = resize(setup({ h: "right", v: "top" }), { x: 50, w: 250 });
        expect(box(doc, "c")).toEqual({ x: 120, y: 130, w: 40, h: 20 });
    });

    it("shrinking below the margins never gives a zero or negative size", () => {
        const doc = resize(setup({ h: "left-right", v: "top-bottom" }), { w: 50, h: 20 });
        expect(node(doc, "c").w).toBe(1);
        expect(node(doc, "c").h).toBe(1);
        const scaled = resize(setup({ h: "scale", v: "scale" }), { w: 1, h: 1 });
        expect(node(scaled, "c").w).toBeGreaterThanOrEqual(1);
    });

    it("ignoreConstraints leaves children where they are", () => {
        const doc = resize(setup({ h: "scale", v: "scale" }), { w: 400, h: 300 }, true);
        expect(box(doc, "c")).toEqual({ x: 120, y: 130, w: 40, h: 20 });
    });

    it("components follow constraints too", () => {
        const doc = resize(setup({ h: "right", v: "bottom" }, "component"), { w: 300 });
        expect(node(doc, "c").x).toBe(220);
    });

    it("a nested frame that stretches passes the resize on to its own children", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 200, h: 200 });
        doc = add(doc, "frame", "inner", { x: 10, y: 10, w: 100, h: 100 }, "F", { constraints: { h: "left-right", v: "top" } });
        doc = add(doc, "rect", "deep", { x: 90, y: 20, w: 10, h: 10 }, "inner", { constraints: { h: "right", v: "top" } });
        doc = resize(doc, { w: 300 });
        expect(box(doc, "inner")).toMatchObject({ x: 10, w: 200 });
        expect(box(doc, "deep")).toMatchObject({ x: 190, w: 10 });
    });

    it("a left-pinned child frame moves its contents with it", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 200, h: 200 });
        doc = add(doc, "frame", "inner", { x: 150, y: 10, w: 40, h: 40 }, "F", { constraints: { h: "right", v: "top" } });
        doc = add(doc, "rect", "deep", { x: 160, y: 20, w: 10, h: 10 }, "inner");
        doc = resize(doc, { w: 300 });
        expect(box(doc, "inner")).toMatchObject({ x: 250 });
        expect(box(doc, "deep")).toMatchObject({ x: 260 });
    });

    it("groups scale their contents and are refitted", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 100, h: 100 });
        doc = applyCommand(doc, {
            type: "batch",
            commands: [
                { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, "F", { id: "G", constraints: { h: "scale", v: "top" } }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 10, y: 10, w: 10, h: 10 }, "G", { id: "g1" }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 30, y: 10, w: 10, h: 10 }, "G", { id: "g2" }) },
            ],
        });
        doc = resize(doc, { w: 200 });
        expect(box(doc, "g1")).toEqual({ x: 20, y: 10, w: 20, h: 10 });
        expect(box(doc, "g2")).toEqual({ x: 60, y: 10, w: 20, h: 10 });
        expect(box(doc, "G")).toEqual({ x: 20, y: 10, w: 60, h: 10 });
    });

    it("auto layout frames don't apply constraints (the stack places children)", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 100, h: 100 });
        doc = add(doc, "rect", "c", { x: 0, y: 0, w: 10, h: 10 }, "F", { constraints: { h: "right", v: "bottom" } });
        doc = applyCommand(doc, { type: "node.update", id: "F", patch: { layout: { direction: "horizontal", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } } });
        doc = resize(doc, { w: 300 });
        expect(box(doc, "c")).toMatchObject({ x: 0, y: 0 });
    });

    it("resizing is undone exactly, children included", () => {
        const before = setup({ h: "scale", v: "center" });
        const after = resize(before, { w: 333, h: 77, x: 5 });
        expect(plain(undoOf(before, after))).toEqual(plain(before));
    });

    it("constrain() is a pure function of the boxes", () => {
        const child = makeNode(emptyDoc(), "rect", { x: 10, y: 10, w: 10, h: 10 }, PAGE, { constraints: { h: "center", v: "scale" } });
        expect(constrain(child, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 10, y: 10, w: 10, h: 10 });
        expect(constrain(child, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 50, h: 50 })).toMatchObject({ h: 10 });
    });
});

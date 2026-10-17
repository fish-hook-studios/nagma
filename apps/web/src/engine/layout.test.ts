import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { areaOf, isAdvancedGrid, placeChildren, planGrid } from "./grid-layout";
import { layoutIndexAt } from "./layout";
import { solid } from "./paint";
import type { AutoLayout, NagmaDocument, SceneNode } from "./types";
import { PAGE, add, box, emptyDoc, node } from "../test/core-fixtures";

type Kid = [id: string, w: number, h: number, extra?: Partial<SceneNode>];

const L = (patch: Partial<AutoLayout> = {}): AutoLayout => ({ direction: "horizontal", gap: 5, padding: [10, 20, 30, 40], primary: "start", counter: "start", ...patch });

// A 300 × 100 frame at (100, 100) with the given children, then auto layout switched on.
function stack(layout: AutoLayout, kids: Kid[], frame: Partial<SceneNode> = {}): NagmaDocument {
    let doc = add(emptyDoc(), "frame", "F", { x: 100, y: 100, w: 300, h: 100 });
    let x = 1000;
    for (const [id, w, h, extra] of kids) {
        doc = add(doc, "rect", id, { x, y: 1000, w, h }, "F", extra ?? {});
        x += 100;
    }
    return applyCommand(doc, { type: "node.update", id: "F", patch: { layout, ...frame } });
}

const two: Kid[] = [
    ["a", 50, 20],
    ["b", 30, 40],
];

describe("auto layout: horizontal placement and alignment", () => {
    it.each([
        ["start/start", L(), { a: [140, 110], b: [195, 110] }],
        ["counter center", L({ counter: "center" }), { a: [140, 130], b: [195, 120] }],
        ["counter end", L({ counter: "end" }), { a: [140, 150], b: [195, 130] }],
        ["primary center", L({ primary: "center" }), { a: [140 + 77.5, 110], b: [195 + 77.5, 110] }],
        ["primary end", L({ primary: "end" }), { a: [140 + 155, 110], b: [195 + 155, 110] }],
        // Space between ignores the stored gap: 240 inside, 80 of children.
        ["space between", L({ primary: "between" }), { a: [140, 110], b: [350, 110] }],
        ["space around", L({ primary: "around" }), { a: [180, 110], b: [310, 110] }],
        ["space evenly", L({ primary: "evenly" }), { a: [140 + 160 / 3, 110], b: [140 + 160 / 3 + 50 + 160 / 3, 110] }],
    ] as [string, AutoLayout, Record<string, [number, number]>][])("%s", (_name, layout, want) => {
        const doc = stack(layout, two);
        for (const [id, [x, y]] of Object.entries(want)) {
            expect(node(doc, id).x).toBeCloseTo(x, 6);
            expect(node(doc, id).y).toBeCloseTo(y, 6);
        }
        // Fixed frames keep their size.
        expect(box(doc, "F")).toEqual({ x: 100, y: 100, w: 300, h: 100 });
    });

    it("space between with one child keeps it at the start, or centres it with loneCenter", () => {
        expect(node(stack(L({ primary: "between" }), [["a", 50, 20]]), "a").x).toBe(140);
        expect(node(stack(L({ primary: "between", loneCenter: true }), [["a", 50, 20]]), "a").x).toBe(140 + 95);
    });

    it("vertical stacks run top to bottom", () => {
        const doc = stack(L({ direction: "vertical", counter: "center" }), two, { h: 200 });
        // Inner width 240: a centred at 40 + 95, b at 40 + 105.
        expect(box(doc, "a")).toEqual({ x: 235, y: 110, w: 50, h: 20 });
        expect(box(doc, "b")).toEqual({ x: 245, y: 135, w: 30, h: 40 });
    });

    it("reverse order of children follows the children list", () => {
        const doc = stack(L(), [["b", 30, 40], ["a", 50, 20]]);
        expect(node(doc, "b").x).toBe(140);
        expect(node(doc, "a").x).toBe(175);
    });
});

describe("auto layout: sizing", () => {
    it("hug on both axes wraps the content and padding", () => {
        const doc = stack(L(), two, { sizing: { h: "hug", v: "hug" } });
        expect(box(doc, "F")).toEqual({ x: 100, y: 100, w: 40 + 50 + 5 + 30 + 20, h: 10 + 40 + 30 });
    });

    it("hug on one axis only", () => {
        const doc = stack(L(), two, { sizing: { h: "fixed", v: "hug" } });
        expect(box(doc, "F")).toMatchObject({ w: 300, h: 80 });
    });

    it("fill children share the room left on the stacking axis", () => {
        expect(node(stack(L(), [["a", 50, 20], ["b", 30, 40, { sizing: { h: "fill", v: "fixed" } }]]), "b").w).toBe(240 - 50 - 5);
        const both = stack(L(), [["a", 50, 20, { sizing: { h: "fill", v: "fixed" } }], ["b", 30, 40, { sizing: { h: "fill", v: "fixed" } }]]);
        expect(node(both, "a").w).toBe(117.5);
        expect(node(both, "b").w).toBe(117.5);
        expect(node(both, "b").x).toBe(140 + 117.5 + 5);
    });

    it("fill on the cross axis stretches to the inner height", () => {
        expect(node(stack(L(), [["a", 50, 20, { sizing: { h: "fixed", v: "fill" } }]]), "a").h).toBe(60);
    });

    it("fill respects min and max width", () => {
        expect(node(stack(L(), [["a", 50, 20, { sizing: { h: "fill", v: "fixed" }, maxW: 100 }]]), "a").w).toBe(100);
        expect(node(stack(L(), [["a", 50, 20, { sizing: { h: "fill", v: "fixed" }, minW: 500 }]]), "a").w).toBe(500);
        expect(node(stack(L(), [["a", 50, 20, { sizing: { h: "fixed", v: "fill" }, maxH: 33 }]]), "a").h).toBe(33);
    });

    it("hug respects the frame's min and max", () => {
        expect(box(stack(L(), two, { sizing: { h: "hug", v: "hug" }, minW: 400, maxH: 50 }), "F")).toMatchObject({ w: 400, h: 50 });
        expect(box(stack(L(), two, { sizing: { h: "hug", v: "hug" }, maxW: 60, minH: 200 }), "F")).toMatchObject({ w: 60, h: 200 });
    });

    it("fill inside a hugging frame acts as fixed", () => {
        const doc = stack(L(), [["a", 50, 20, { sizing: { h: "fill", v: "fixed" } }]], { sizing: { h: "hug", v: "hug" } });
        expect(node(doc, "a").w).toBe(50);
        expect(node(doc, "F").w).toBe(110);
    });

    it("an empty hugging frame shrinks to its padding", () => {
        const doc = applyCommand(add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 300, h: 300 }), { type: "node.update", id: "F", patch: { layout: L(), sizing: { h: "hug", v: "hug" } } });
        expect(box(doc, "F")).toMatchObject({ w: 60, h: 40 });
    });

    it("an empty hugging frame with no padding is still 1px, not 0", () => {
        const doc = applyCommand(add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 300, h: 300 }), { type: "node.update", id: "F", patch: { layout: L({ padding: [0, 0, 0, 0] }), sizing: { h: "hug", v: "hug" } } });
        expect(box(doc, "F")).toMatchObject({ w: 1, h: 1 });
    });
});

describe("auto layout: what takes part in the flow", () => {
    it("hidden children are skipped and don't count for hug", () => {
        const doc = stack(L(), [["a", 50, 20], ["h", 70, 90, { visible: false }], ["b", 30, 40]], { sizing: { h: "hug", v: "hug" } });
        expect(node(doc, "b").x).toBe(195);
        expect(box(doc, "F")).toMatchObject({ w: 145, h: 80 });
    });

    it("absolute children keep their place and don't count", () => {
        const doc = stack(L(), [["a", 50, 20], ["abs", 70, 90, { positioning: "absolute" }], ["b", 30, 40]], { sizing: { h: "hug", v: "hug" } });
        expect(box(doc, "abs")).toEqual({ x: 1100, y: 1000, w: 70, h: 90 });
        expect(node(doc, "b").x).toBe(195);
        expect(box(doc, "F")).toMatchObject({ w: 145, h: 80 });
    });

    it("a rotated child takes the room of its turned box", () => {
        const doc = stack(L(), [["a", 50, 20, { rotation: 90 }], ["b", 30, 40]]);
        // Turned 90° it is 20 wide; x/y are its unturned box around the same centre.
        expect(node(doc, "a").x).toBeCloseTo(140 + 10 - 25, 6);
        expect(node(doc, "b").x).toBeCloseTo(140 + 20 + 5, 6);
    });

    it("strokes included in layout pad the content", () => {
        const doc = stack(L({ strokesIncluded: true, padding: [0, 0, 0, 0] }), two, { strokes: [solid("#000000")], strokeWidth: 4, strokeAlign: "inside" });
        expect(box(doc, "a")).toMatchObject({ x: 104, y: 104 });
        const centred = stack(L({ strokesIncluded: true, padding: [0, 0, 0, 0] }), two, { strokes: [solid("#000000")], strokeWidth: 4, strokeAlign: "center" });
        expect(box(centred, "a")).toMatchObject({ x: 102, y: 102 });
        const outside = stack(L({ strokesIncluded: true, padding: [0, 0, 0, 0] }), two, { strokes: [solid("#000000")], strokeWidth: 4, strokeAlign: "outside" });
        expect(box(outside, "a")).toMatchObject({ x: 100, y: 100 });
    });

    it("moves a child's own children along with it", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 100, y: 100, w: 300, h: 100 });
        doc = add(doc, "frame", "inner", { x: 500, y: 500, w: 50, h: 50 }, "F");
        doc = add(doc, "rect", "deep", { x: 510, y: 520, w: 5, h: 5 }, "inner");
        doc = applyCommand(doc, { type: "node.update", id: "F", patch: { layout: L() } });
        expect(box(doc, "inner")).toMatchObject({ x: 140, y: 110 });
        expect(box(doc, "deep")).toMatchObject({ x: 150, y: 130 });
    });
});

describe("auto layout: wrap", () => {
    const kids: Kid[] = [
        ["a", 40, 10],
        ["b", 40, 20],
        ["c", 40, 10],
    ];
    const wrapL = (patch: Partial<AutoLayout> = {}) => L({ wrap: true, gap: 10, padding: [0, 0, 0, 0], counterGap: 5, ...patch });

    it("wraps onto a new line when the row is full", () => {
        const doc = stack(wrapL(), kids, { w: 100, sizing: { h: "fixed", v: "hug" } });
        expect(box(doc, "a")).toMatchObject({ x: 100, y: 100 });
        expect(box(doc, "b")).toMatchObject({ x: 150, y: 100 });
        // The first line is as tall as its tallest child (20), then the counter gap.
        expect(box(doc, "c")).toMatchObject({ x: 100, y: 125 });
        expect(node(doc, "F").h).toBe(20 + 5 + 10);
    });

    it("uses the gap between lines when no counter gap is set", () => {
        const doc = stack(wrapL({ counterGap: undefined }), kids, { w: 100, sizing: { h: "fixed", v: "hug" } });
        expect(box(doc, "c")).toMatchObject({ y: 130 });
    });

    it("spreads lines apart with align content between", () => {
        const doc = stack(wrapL({ alignContent: "between" }), kids, { w: 100, h: 100 });
        expect(box(doc, "c")).toMatchObject({ y: 190 });
    });

    it("a hugging stack never wraps", () => {
        const doc = stack(wrapL(), kids, { w: 100, sizing: { h: "hug", v: "hug" } });
        expect(node(doc, "c").y).toBe(100);
        expect(node(doc, "F").w).toBe(140);
    });
});

describe("auto layout: nesting", () => {
    it("an inner hugging stack sizes first, then the outer stack places it", () => {
        let doc = add(emptyDoc(), "frame", "O", { x: 0, y: 0, w: 10, h: 10 });
        doc = add(doc, "frame", "I", { x: 0, y: 0, w: 10, h: 10 }, "O");
        doc = add(doc, "rect", "i1", { x: 0, y: 0, w: 20, h: 30 }, "I");
        doc = add(doc, "rect", "i2", { x: 0, y: 0, w: 20, h: 30 }, "I");
        doc = add(doc, "rect", "o2", { x: 0, y: 0, w: 15, h: 15 }, "O");
        doc = applyCommand(doc, { type: "node.update", id: "I", patch: { layout: L({ direction: "vertical", gap: 2, padding: [1, 1, 1, 1] }), sizing: { h: "hug", v: "hug" } } });
        doc = applyCommand(doc, { type: "node.update", id: "O", patch: { layout: L({ gap: 4, padding: [3, 3, 3, 3] }), sizing: { h: "hug", v: "hug" } } });
        expect(box(doc, "I")).toEqual({ x: 3, y: 3, w: 22, h: 64 });
        expect(box(doc, "i2")).toEqual({ x: 4, y: 36, w: 20, h: 30 });
        expect(box(doc, "o2")).toEqual({ x: 29, y: 3, w: 15, h: 15 });
        expect(box(doc, "O")).toEqual({ x: 0, y: 0, w: 3 + 22 + 4 + 15 + 3, h: 70 });
        // Growing an inner child grows both stacks.
        doc = applyCommand(doc, { type: "node.update", id: "i1", patch: { w: 50 } });
        expect(node(doc, "I").w).toBe(52);
        expect(node(doc, "O").w).toBe(3 + 52 + 4 + 15 + 3);
        expect(node(doc, "o2").x).toBe(3 + 52 + 4);
    });

    it("a filling inner stack stretches to its parent and lays out its own children", () => {
        let doc = add(emptyDoc(), "frame", "O", { x: 0, y: 0, w: 200, h: 100 });
        doc = add(doc, "frame", "I", { x: 0, y: 0, w: 10, h: 10 }, "O", { sizing: { h: "fill", v: "fill" } });
        doc = add(doc, "rect", "i1", { x: 0, y: 0, w: 20, h: 20 }, "I");
        doc = applyCommand(doc, { type: "node.update", id: "I", patch: { layout: L({ primary: "end", counter: "end", padding: [0, 0, 0, 0] }) } });
        doc = applyCommand(doc, { type: "node.update", id: "O", patch: { layout: L({ padding: [0, 0, 0, 0] }) } });
        expect(box(doc, "I")).toEqual({ x: 0, y: 0, w: 200, h: 100 });
        expect(box(doc, "i1")).toEqual({ x: 180, y: 80, w: 20, h: 20 });
    });
});

describe("grid layout", () => {
    const grid = (patch: Partial<NonNullable<AutoLayout["grid"]>> = {}) => L({ padding: [0, 0, 0, 0], grid: { columns: 2, rows: null, columnGap: 10, rowGap: 6, ...patch } });

    it("equal cells, row by row", () => {
        const doc = stack(grid(), [["a", 20, 20], ["b", 20, 20], ["c", 20, 20]], { w: 210, h: 106 });
        // Two columns of 100, two rows of 50.
        expect(box(doc, "a")).toMatchObject({ x: 100, y: 100 });
        expect(box(doc, "b")).toMatchObject({ x: 210, y: 100 });
        expect(box(doc, "c")).toMatchObject({ x: 100, y: 156 });
    });

    it("hugging grids take the largest child as the cell", () => {
        const doc = stack(grid(), [["a", 20, 30], ["b", 40, 10], ["c", 5, 5]], { sizing: { h: "hug", v: "hug" } });
        expect(box(doc, "F")).toMatchObject({ w: 40 * 2 + 10, h: 30 * 2 + 6 });
    });

    it("fill children stretch to the cell", () => {
        const doc = stack(grid(), [["a", 20, 20, { sizing: { h: "fill", v: "fill" } }]], { w: 210, h: 106 });
        expect(box(doc, "a")).toMatchObject({ w: 100, h: 106 });
    });

    it("chosen cells and spans: others flow into the first free area", () => {
        const children = [
            { id: "big", gridPosition: { col: 0, row: 0 }, gridSpan: { col: 2, row: 2 } },
            { id: "x" },
            { id: "y" },
            { id: "z", gridSpan: { col: 3, row: 1 } },
        ].map((c) => ({ w: 10, h: 10, sizing: { h: "fixed", v: "fixed" }, ...c }) as unknown as SceneNode);
        const placed = placeChildren({ columns: 3, rows: null, columnGap: 0, rowGap: 0 }, children);
        const at = Object.fromEntries(placed.placements.map((p) => [p.node.id, [p.col, p.row, p.colSpan, p.rowSpan]]));
        expect(at).toEqual({ big: [0, 0, 2, 2], x: [2, 0, 1, 1], y: [2, 1, 1, 1], z: [0, 2, 3, 1] });
        expect(placed.rowCount).toBe(3);
    });

    it("spans wider than the grid are clamped; positions past the edge are pulled in", () => {
        const children = [{ id: "w", gridSpan: { col: 9, row: 1 } }, { id: "p", gridPosition: { col: 7, row: 1 } }].map((c) => ({ w: 1, h: 1, sizing: { h: "fixed", v: "fixed" }, ...c }) as unknown as SceneNode);
        const placed = placeChildren({ columns: 2, rows: null, columnGap: 0, rowGap: 0 }, children);
        const at = Object.fromEntries(placed.placements.map((p) => [p.node.id, [p.col, p.row, p.colSpan]]));
        expect(at).toEqual({ p: [1, 1, 1], w: [0, 0, 2] });
    });

    it("manual positioning continues after the last placed cell", () => {
        const children = [{ id: "p", gridPosition: { col: 1, row: 1 } }, { id: "q" }].map((c) => ({ w: 1, h: 1, sizing: { h: "fixed", v: "fixed" }, ...c }) as unknown as SceneNode);
        const auto = placeChildren({ columns: 2, rows: null, columnGap: 0, rowGap: 0 }, children);
        expect(auto.placements.find((p) => p.node.id === "q")).toMatchObject({ col: 0, row: 0 });
        const manual = placeChildren({ columns: 2, rows: null, columnGap: 0, rowGap: 0, itemsPositioning: "manual" }, children);
        expect(manual.placements.find((p) => p.node.id === "q")).toMatchObject({ col: 0, row: 2 });
    });

    it("track sizes: fixed, fill shares and hug", () => {
        const kids = [{ id: "a", w: 30, h: 12 }, { id: "b", w: 10, h: 12 }, { id: "c", w: 10, h: 40 }].map((c) => ({ sizing: { h: "fixed", v: "fixed" }, ...c }) as unknown as SceneNode);
        const g = { columns: 3, rows: null, columnGap: 10, rowGap: 0, columnSizes: [{ type: "fixed" as const, value: 50 }, { type: "fill" as const, value: 1 }, { type: "fill" as const, value: 3 }], rowSizes: [{ type: "hug" as const, value: 0 }] };
        expect(isAdvancedGrid(g, kids)).toBe(true);
        const plan = planGrid(g, kids, 290, null);
        expect(plan.cols).toEqual([50, 55, 165]);
        expect(plan.rows).toEqual([40]);
        expect(plan.width).toBe(290);
        expect(areaOf(plan, plan.placements[2]!)).toEqual({ x: 125, y: 0, w: 165, h: 40 });
    });

    it("a spanning child tops up the hug tracks it covers", () => {
        const kids = [{ id: "a", w: 100, h: 10, gridSpan: { col: 2, row: 1 } }].map((c) => ({ sizing: { h: "fixed", v: "fixed" }, ...c }) as unknown as SceneNode);
        const plan = planGrid({ columns: 2, rows: null, columnGap: 10, rowGap: 0 }, kids, null, null);
        expect(plan.cols).toEqual([45, 45]);
        expect(plan.width).toBe(100);
    });

    it("advanced grid frames place spanning children and align them in their area", () => {
        const doc = stack(grid({ columnSizes: [{ type: "fixed", value: 50 }, { type: "fixed", value: 70 }] }), [["a", 20, 20, { gridSpan: { col: 2, row: 1 }, gridAlign: { h: "center", v: "end" } }], ["b", 20, 20, { gridAlign: { h: "end", v: "auto" } }]], { sizing: { h: "hug", v: "hug" } });
        expect(box(doc, "F")).toMatchObject({ w: 130, h: 46 });
        expect(box(doc, "a")).toMatchObject({ x: 100 + (130 - 20) / 2, y: 100 });
        expect(box(doc, "b")).toMatchObject({ x: 100 + 50 - 20, y: 126 });
    });
});

describe("layoutIndexAt", () => {
    it("finds the slot from a point along the stack, skipping the moving layer", () => {
        const doc = stack(L(), [["a", 50, 20], ["b", 30, 40], ["c", 30, 40]]);
        expect(layoutIndexAt(doc, "F", "x", 0, 0)).toBe(0);
        expect(layoutIndexAt(doc, "F", "x", 170, 0)).toBe(1);
        expect(layoutIndexAt(doc, "F", "x", 1000, 0)).toBe(3);
        expect(layoutIndexAt(doc, "F", "a", 1000, 0)).toBe(2);
        expect(layoutIndexAt(doc, PAGE, "a", 0, 0)).toBe(0);
    });
});

import { describe, expect, it } from "vitest";

await import("../app");
const { exportBounds } = await import("./effect-bounds");
const { exportSvg } = await import("./export-svg");
const { designDoc } = await import("../test/design-doc");

const shadow = { type: "drop-shadow" as const, visible: true, x: 6, y: 8, blur: 6, spread: 0, color: "#000000", opacity: 0.5, showBehind: false };

describe("exports include what effects reach", () => {
    it("a drop shadow from the Effects list grows the export box", () => {
        const { doc, byName } = designDoc([{ type: "rect", name: "R", x: 20, y: 20, w: 120, h: 80, props: { effects: [shadow] } }]);
        // Blur 6 reaches 9 px; offset 6, 8 moves that right and down.
        expect(exportBounds(doc, byName.R!)).toEqual({ x: 17, y: 19, w: 138, h: 98 });
        expect(exportSvg(doc, byName.R!.id)).toContain('width="138" height="98"');
    });
    it("a frame that doesn't clip shows what hangs out of it", () => {
        const { doc, byName } = designDoc([
            { type: "frame", name: "F", x: 0, y: 0, w: 100, h: 100, props: { clip: false } },
            { type: "rect", name: "Out", x: 80, y: 80, w: 60, h: 60, parent: "F" },
        ]);
        expect(exportBounds(doc, doc.nodes[byName.F!.id]!)).toEqual({ x: 0, y: 0, w: 140, h: 140 });
    });
    it("a clipping frame stays its own size", () => {
        const { doc, byName } = designDoc([
            { type: "frame", name: "F", x: 0, y: 0, w: 100, h: 100 },
            { type: "rect", name: "Out", x: 80, y: 80, w: 60, h: 60, parent: "F", props: { effects: [shadow] } },
        ]);
        expect(exportBounds(doc, doc.nodes[byName.F!.id]!)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
});

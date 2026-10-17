import { describe, expect, it } from "vitest";
import { makeNode } from "./nodes";
import { effectiveSizing, firstBaseline, lineBaselines, sizePillText } from "./selection-chrome";
import type { NagmaDocument, SceneNode } from "./types";

const empty: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} } as unknown as NagmaDocument;

function docWith(...nodes: SceneNode[]): NagmaDocument {
    return { ...empty, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: nodes.filter((n) => !n.parentId).map((n) => n.id) };
}

describe("size pill", () => {
    it("names hug and fill sides, leaves fixed sides bare", () => {
        expect(sizePillText(31, 24, { h: "hug", v: "hug" })).toBe("31 Hug × 24 Hug");
        expect(sizePillText(200, 60, { h: "fixed", v: "hug" })).toBe("200 × 60 Hug");
        expect(sizePillText(134, 198, { h: "fixed", v: "fixed" })).toBe("134 × 198");
        expect(sizePillText(320.456, 10, { h: "fill", v: "fixed" })).toBe("320.5 Fill × 10");
        expect(sizePillText(10, 20)).toBe("10 × 20");
    });

    it("reads hug only on text and auto layout frames, fill only in auto layout", () => {
        const text = makeNode(empty, "text", { x: 0, y: 0, w: 31, h: 24 }, null);
        expect(effectiveSizing(docWith(text), text)).toEqual({ h: "hug", v: "hug" });
        const plain = makeNode(empty, "frame", { x: 0, y: 0, w: 100, h: 100 }, null, { sizing: { h: "hug", v: "fill" } });
        expect(effectiveSizing(docWith(plain), plain)).toEqual({ h: "fixed", v: "fixed" });
        const stack = makeNode(empty, "frame", { x: 0, y: 0, w: 100, h: 100 }, null, { layout: { direction: "vertical" } as SceneNode["layout"], sizing: { h: "hug", v: "hug" } });
        const child = makeNode(empty, "rect", { x: 0, y: 0, w: 100, h: 10 }, stack.id, { sizing: { h: "fill", v: "fixed" } });
        const doc = docWith(stack, child);
        expect(effectiveSizing(doc, stack)).toEqual({ h: "hug", v: "hug" });
        expect(effectiveSizing(doc, child)).toEqual({ h: "fill", v: "fixed" });
        expect(effectiveSizing(doc, { ...child, positioning: "absolute" })).toEqual({ h: "fixed", v: "fixed" });
    });
});

describe("text baselines", () => {
    const node = { x: 10, y: 20, w: 120 };
    const lines = [
        { baseline: 19, x: 0, width: 80 },
        { baseline: 43, x: 4, width: 60 },
        { baseline: 67, x: 0, width: 0 },
    ];

    it("marks the first line's baseline across the whole box when selected", () => {
        expect(firstBaseline(node, lines, 0)).toEqual({ x0: 10, x1: 130, y: 39 });
        // Vertically centred text moves its baseline down with it.
        expect(firstBaseline(node, lines, 5)?.y).toBe(44);
        expect(firstBaseline(node, [], 0)).toBeNull();
    });

    it("underlines each line's text when hovered, skipping empty lines", () => {
        expect(lineBaselines(node, lines, 0)).toEqual([
            { x0: 10, x1: 90, y: 39 },
            { x0: 14, x1: 74, y: 63 },
        ]);
    });
});

describe("size pill placement", () => {
    it("sits 6 below the outline and is 17 tall", async () => {
        const m = await import("./selection-chrome");
        expect([m.SIZE_PILL_GAP, m.SIZE_PILL_HEIGHT]).toEqual([6, 17]);
    });
});

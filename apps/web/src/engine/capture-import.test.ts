// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { describe, expect, it } from "vitest";
import { NotACapture, parseCapture, type Capture, type CaptureBox, type CaptureNode, type CaptureStyle, type CaptureTextStyle } from "./capture-format";
import { captureToDocument, cssColor, gradientPaint } from "./capture-import";
import type { NagmaDocument, SceneNode } from "./types";

// Page captures (Nagma Capture's format) into Design layers: the page frame, auto layout read
// back from flex, grid and stacked blocks when it reproduces the page, text with its fonts and
// runs, pictures, inline SVG, and repeated cards as a component with instances.

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function style(over: Partial<CaptureStyle> = {}): CaptureStyle {
    return {
        display: "block",
        position: "static",
        padding: [0, 0, 0, 0],
        borderWidths: [0, 0, 0, 0],
        borderColors: ["rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(0, 0, 0)"],
        borderStyles: ["none", "none", "none", "none"],
        radii: [0, 0, 0, 0],
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgrounds: [],
        shadows: [],
        opacity: 1,
        overflowX: "visible",
        overflowY: "visible",
        zIndex: null,
        ...over,
    };
}

function textStyle(over: Partial<CaptureTextStyle> = {}): CaptureTextStyle {
    return { family: "Inter", stack: "Inter, sans-serif", size: 16, weight: 400, italic: false, lineHeight: 24, letterSpacing: 0, color: "rgb(17, 24, 39)", align: "left", decoration: "none", transform: "none", whiteSpace: "normal", direction: "ltr", ...over };
}

function box(x: number, y: number, w: number, h: number): CaptureBox {
    return { x, y, w, h };
}

function el(tag: string, b: CaptureBox, over: Partial<CaptureStyle> = {}, children: CaptureNode[] = [], extra: Partial<CaptureNode> = {}): CaptureNode {
    return { tag, name: extra.name ?? tag, box: b, style: style(over), children, ...extra };
}

function text(content: string, b: CaptureBox, over: Partial<CaptureTextStyle> = {}, extra: Partial<CaptureNode["text"]> = {}): CaptureNode {
    return { tag: "#text", name: content, box: b, style: style({ display: "inline" }), text: { content, style: textStyle(over), runs: [], lines: 1, ...extra }, children: [] };
}

function capture(children: CaptureNode[], over: Partial<Capture> = {}): Capture {
    return {
        format: "nagma-capture",
        version: 1,
        title: "Fixture page",
        url: "http://127.0.0.1/fixture.html",
        capturedAt: "2026-10-23T00:00:00.000Z",
        viewport: { w: 1000, h: 800 },
        scroll: { w: 1000, h: 1200 },
        dpr: 2,
        background: "rgb(250, 250, 250)",
        root: el("body", box(0, 0, 1000, 1200), {}, children, { name: "Body" }),
        assets: {},
        fonts: [],
        ...over,
    };
}

function all(doc: NagmaDocument, rootId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        out.push(n);
        n.children.forEach(visit);
    };
    visit(rootId);
    return out;
}

const named = (doc: NagmaDocument, name: string) => Object.values(doc.nodes).find((n) => n.name === name) as SceneNode;

describe("capture files", () => {
    it("rejects what isn't a capture, with a reason", () => {
        expect(() => parseCapture("not json")).toThrow(NotACapture);
        expect(() => parseCapture(JSON.stringify({ name: "Untitled", nodes: {}, roots: [] }))).toThrow("it isn't a page capture.");
        expect(() => parseCapture({ ...capture([]), version: 99 })).toThrow("newer Nagma Capture");
        expect(() => parseCapture({ ...capture([]), root: null })).toThrow("damaged");
        expect(parseCapture(JSON.stringify(capture([]))).title).toBe("Fixture page");
    });
});

describe("the page frame", () => {
    it("is one top frame named after the page, the viewport wide and the page tall", () => {
        const { doc, frameId } = captureToDocument(capture([]));
        const frame = doc.nodes[frameId] as SceneNode;
        expect(doc.name).toBe("Fixture page");
        expect(frame.name).toBe("Fixture page");
        expect([frame.x, frame.y, frame.w, frame.h]).toEqual([0, 0, 1000, 1200]);
        expect(frame.fills[0]).toMatchObject({ type: "solid", color: "#FAFAFA" });
        expect(frame.clip).toBe(true);
        expect(doc.nodes[frame.parentId as string]?.type).toBe("page");
    });
});

describe("auto layout", () => {
    // A nav bar: three links in a row, 24 apart, inside 16/32 padding, centred across.
    const nav = (third: number) =>
        el("nav", box(0, 0, 1000, 72), { display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", columnGap: 24, rowGap: 0, padding: [16, 32, 16, 32], backgroundColor: "rgb(255, 255, 255)" }, [
            el("a", box(32, 20, 80, 32), { backgroundColor: "rgb(238, 238, 238)" }, [], { name: "One" }),
            el("a", box(136, 16, 100, 40), { backgroundColor: "rgb(238, 238, 238)" }, [], { name: "Two" }),
            el("a", box(third, 26, 60, 20), { backgroundColor: "rgb(238, 238, 238)" }, [], { name: "Three" }),
        ], { name: "Nav" });

    it("reads a flex row as a horizontal stack with its gap, padding and alignment", () => {
        const { doc } = captureToDocument(capture([nav(260)]));
        const frame = named(doc, "Nav");
        expect(frame.layout).toMatchObject({ direction: "horizontal", gap: 24, padding: [16, 32, 16, 32], primary: "start", counter: "center" });
        expect(frame.children.map((id) => doc.nodes[id]?.name)).toEqual(["One", "Two", "Three"]);
        expect([named(doc, "Three").x, named(doc, "Three").y]).toEqual([260, 26]);
    });

    it("keeps absolute positions when the stack wouldn't put the children where the page did", () => {
        // The third link is pushed right (an auto margin), so no gap fits all three.
        const { doc } = captureToDocument(capture([nav(700)]));
        const frame = named(doc, "Nav");
        expect(frame.layout).toBeNull();
        expect(named(doc, "Three").x).toBe(700);
    });

    it("reads a column with space between, and absolute children stay out of the flow", () => {
        const col = el("aside", box(0, 0, 200, 400), { display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch" }, [
            el("div", box(0, 0, 200, 50), { backgroundColor: "rgb(1, 2, 3)" }, [], { name: "Top" }),
            el("div", box(0, 350, 200, 50), { backgroundColor: "rgb(1, 2, 3)" }, [], { name: "Bottom" }),
            el("div", box(150, 10, 20, 20), { position: "absolute", backgroundColor: "rgb(200, 0, 0)" }, [], { name: "Badge" }),
        ], { name: "Column" });
        const { doc } = captureToDocument(capture([col]));
        expect(named(doc, "Column").layout).toMatchObject({ direction: "vertical", primary: "between" });
        expect(named(doc, "Badge").positioning).toBe("absolute");
        expect([named(doc, "Badge").x, named(doc, "Bottom").y]).toEqual([150, 350]);
    });

    it("reads a grid's tracks and places each child in its cell", () => {
        const cell = (i: number) => el("div", box(20 + (i % 3) * 110, 20 + Math.floor(i / 3) * 70, 100, 60), { backgroundColor: "rgb(220, 220, 220)" }, [], { name: `Cell ${i}` });
        const grid = el("section", box(0, 0, 360, 170), { display: "grid", gridColumns: [100, 100, 100], gridRows: [60, 60], columnGap: 10, rowGap: 10, padding: [20, 30, 20, 20] }, [0, 1, 2, 3, 4].map(cell), { name: "Grid" });
        const { doc } = captureToDocument(capture([grid]), { components: false });
        const frame = named(doc, "Grid");
        expect(frame.layout?.grid).toMatchObject({ columns: 3, rows: 2, columnGap: 10, rowGap: 10 });
        expect(named(doc, "Cell 4").gridPosition).toEqual({ col: 1, row: 1 });
        expect([named(doc, "Cell 4").x, named(doc, "Cell 4").y]).toEqual([130, 90]);
    });

    it("stacks plain blocks that sit one under another with even spacing", () => {
        const block = (i: number) => el("p", box(40, 30 + i * 60, 300, 40), { backgroundColor: "rgb(240, 240, 240)" }, [], { name: `Block ${i}` });
        const { doc } = captureToDocument(capture([el("article", box(0, 0, 400, 400), {}, [0, 1, 2].map(block), { name: "Article" })]), { components: false });
        expect(named(doc, "Article").layout).toMatchObject({ direction: "vertical", gap: 20, padding: [30, 0, 0, 40] });
    });
});

describe("text", () => {
    it("maps font, size, weight, spacing, colour, alignment and case, with runs as styled ranges", () => {
        const t = text("Hello brave world", box(10, 10, 300, 32), { size: 20, weight: 600, lineHeight: 32, letterSpacing: -0.4, color: "rgb(37, 99, 235)", align: "center", transform: "uppercase", italic: true }, { runs: [{ start: 6, end: 11, style: { weight: 800, color: "rgb(220, 38, 38)" } }] });
        const { doc } = captureToDocument(capture([t]));
        const node = Object.values(doc.nodes).find((n) => n.type === "text") as SceneNode;
        expect(node).toMatchObject({ text: "Hello brave world", fontFamily: "Inter", fontSize: 20, fontWeight: 600, italic: true, lineHeight: 1.6, textAlign: "center", textCase: "upper" });
        expect(node.letterSpacing).toBeCloseTo(-2);
        expect(node.fills[0]).toMatchObject({ type: "solid", color: "#2563EB" });
        expect(node.spans?.[0]).toMatchObject({ start: 6, end: 11, fontWeight: 800 });
        expect(node.spans?.[0]?.fills?.[0]).toMatchObject({ color: "#DC2626" });
    });

    it("draws a family Nagma can't load in Inter and keeps the page's family in the layer name", () => {
        const { doc, substituted } = captureToDocument(capture([text("Brand words", box(0, 0, 200, 24), { family: "Brand Grotesk" })]), { fontFor: (f) => (f === "Brand Grotesk" ? null : f) });
        const node = Object.values(doc.nodes).find((n) => n.type === "text") as SceneNode;
        expect(node.fontFamily).toBe("Inter");
        expect(node.name).toBe("Brand words (Brand Grotesk)");
        expect(substituted).toEqual(["Brand Grotesk"]);
    });

    it("gives generic families a stand-in", () => {
        const { doc } = captureToDocument(capture([text("Code", box(0, 0, 200, 24), { family: "monospace" })]));
        expect(Object.values(doc.nodes).find((n) => n.type === "text")?.fontFamily).toBe("Cousine");
    });
});

describe("pictures, paint and SVG", () => {
    it("makes image fills from the capture's pictures, with ids of their own, and a placeholder for one it couldn't read", () => {
        const page = capture([el("img", box(0, 0, 300, 200), {}, [], { name: "Photo", image: { asset: "a1", fit: "cover" } }), el("img", box(0, 220, 300, 200), {}, [], { name: "Missing", image: { asset: "a2", fit: "cover" } })], { assets: { a1: { url: "http://127.0.0.1/a.png", data: PNG }, a2: { url: "http://127.0.0.1/b.png", data: null } } });
        const { doc, missingImages } = captureToDocument(page);
        const photo = named(doc, "Photo");
        expect(photo.type).toBe("rect");
        const paint = photo.fills.find((p) => p.type === "image");
        expect(paint).toMatchObject({ type: "image", mode: "fill" });
        const id = (paint as { id: string }).id;
        expect(id).not.toBe("a1");
        expect(doc.images[id]).toBe(PNG);
        expect(missingImages).toBe(1);
        expect(named(doc, "Missing").fills[0]).toMatchObject({ type: "solid" });
    });

    it("maps backgrounds, borders, radii, shadows, opacity and clipping", () => {
        const card = el("div", box(0, 0, 200, 100), {
            backgroundColor: "oklch(0.623 0.214 259.815)",
            backgrounds: [{ kind: "gradient", css: "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgba(0, 0, 255, 0.5) 100%)" }],
            borderWidths: [2, 2, 2, 2],
            borderColors: ["rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(0, 0, 0)"],
            borderStyles: ["solid", "solid", "solid", "solid"],
            radii: [12, 12, 12, 12],
            shadows: [{ x: 0, y: 4, blur: 12, spread: -2, color: "rgba(0, 0, 0, 0.25)", inset: false }],
            opacity: 0.8,
            overflowX: "hidden",
            overflowY: "hidden",
        }, [], { name: "Card" });
        const { doc } = captureToDocument(capture([card]));
        const node = named(doc, "Card");
        expect(node.fills.map((p) => p.type)).toEqual(["solid", "linear"]);
        expect(node.fills[0]).toMatchObject({ color: "#2B7FFF" });
        expect(node.fills[1]).toMatchObject({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } });
        expect(node).toMatchObject({ strokeWidth: 2, strokeAlign: "inside", radius: 12, opacity: 0.8, clip: true });
        expect(node.effects?.[0]).toMatchObject({ type: "drop-shadow", y: 4, blur: 12, spread: -2, opacity: 0.25 });
    });

    it("reads the colours and gradients browsers compute", () => {
        expect(cssColor("rgba(10, 20, 30, 0.5)")).toEqual({ hex: "#0A141E", alpha: 0.5 });
        expect(cssColor("rgb(10 20 30 / 25%)")).toEqual({ hex: "#0A141E", alpha: 0.25 });
        expect(cssColor("color(srgb 1 0 0)")).toEqual({ hex: "#FF0000", alpha: 1 });
        expect(cssColor("oklch(1 0 0)")?.hex).toBe("#FFFFFF");
        expect(cssColor("transparent")?.alpha).toBe(0);
        const g = gradientPaint("linear-gradient(to right in oklab, rgb(0, 0, 0), rgb(255, 255, 255) 80%)", 100, 50);
        expect(g?.stops.map((s) => s.position)).toEqual([0, 0.8]);
        expect(gradientPaint("radial-gradient(circle at 20% 30%, red, blue)", 100, 100)?.type).toBe("radial");
    });

    it("turns inline SVG into vector layers in a frame the size of its box", () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" style="fill:rgb(14, 165, 233)"/><path d="M4 12 L8 4 L12 12 Z" style="fill:rgb(255, 255, 255)"/></svg>';
        const { doc } = captureToDocument(capture([el("svg", box(40, 40, 32, 32), {}, [], { name: "Logo", svg })]));
        const frame = named(doc, "Logo");
        expect([frame.type, frame.x, frame.y, frame.w, frame.h]).toEqual(["frame", 40, 40, 32, 32]);
        const leaves = all(doc, frame.id).filter((n) => n.id !== frame.id);
        expect(leaves.length).toBeGreaterThanOrEqual(2);
        expect(leaves.some((n) => n.fills.some((p) => p.type === "solid" && p.color === "#0EA5E9"))).toBe(true);
    });
});

describe("components from repeated cards", () => {
    const card = (i: number, title: string, asset: string) =>
        el("div", box(20 + i * 220, 20, 200, 260), { display: "flex", flexDirection: "column", rowGap: 12, padding: [16, 16, 16, 16], backgroundColor: "rgb(255, 255, 255)", radii: [12, 12, 12, 12] }, [
            el("img", box(36 + i * 220, 36, 168, 120), {}, [], { name: "Image", image: { asset, fit: "cover" } }),
            text(title, box(36 + i * 220, 168, 168, 24), { weight: 600 }),
        ], { name: `Card ${i}` });

    it("makes the first a component and the rest instances, with their own text and pictures", () => {
        const page = capture([el("div", box(0, 0, 700, 300), {}, [card(0, "Ember mug", "a1"), card(1, "Tide bowl", "a2"), card(2, "Moss vase", "a3")], { name: "List" })], { assets: { a1: { url: "1", data: PNG }, a2: { url: "2", data: `${PNG}#2` }, a3: { url: "3", data: `${PNG}#3` } } });
        const { doc, components, instances } = captureToDocument(page);
        expect([components, instances]).toEqual([1, 2]);
        const main = named(doc, "Card 0");
        expect(main.type).toBe("component");
        const copies = Object.values(doc.nodes).filter((n) => n.type === "instance" && !n.sourceId);
        expect(copies.map((c) => c.componentId)).toEqual([main.id, main.id]);
        for (const [i, title] of [[1, "Tide bowl"], [2, "Moss vase"]] as const) {
            const copy = copies.find((c) => c.x === 20 + i * 220) as SceneNode;
            const label = all(doc, copy.id).find((n) => n.type === "text") as SceneNode;
            expect(label.text).toBe(title);
            expect(label.sourceId).toBeTruthy();
            expect(label.overrides).toContain("text");
            const image = all(doc, copy.id).find((n) => n.type === "rect") as SceneNode;
            expect(image.overrides).toContain("fills");
            expect(image.x).toBe(36 + i * 220);
        }
    });

    it("leaves siblings that differ in structure or style alone", () => {
        const odd = card(2, "Moss vase", "a3");
        odd.style.backgroundColor = "rgb(255, 0, 0)";
        const page = capture([el("div", box(0, 0, 700, 300), {}, [card(0, "Ember mug", "a1"), card(1, "Tide bowl", "a2"), odd], { name: "List" })], { assets: { a1: { url: "1", data: PNG }, a2: { url: "2", data: PNG }, a3: { url: "3", data: PNG } } });
        expect(captureToDocument(page).components).toBe(0);
    });
});

import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { defaultEffect } from "./effects";
import { makeNode, normalizeNode } from "./nodes";
import { imagePaint, linearGradient, solid } from "./paint";
import { prepareDocument } from "./store";
import type { NagmaDocument, NodeType, SceneNode } from "./types";
import { PAGE, add, emptyDoc, plain } from "../test/core-fixtures";

// A document with every node type and the document-level data: styles, variables, prototype
// settings, a video sequence, keyframes, interactions, rich text and region fills.
function richDoc(): NagmaDocument {
    let doc = emptyDoc();
    doc = add(doc, "frame", "F", { x: 0, y: 0, w: 400, h: 300 }, PAGE, {
        layout: { direction: "vertical", gap: 8, padding: [8, 8, 8, 8], primary: "start", counter: "center", wrap: false },
        sizing: { h: "fixed", v: "hug" },
        guides: [{ kind: "columns", count: 12, gutter: 20, margin: 10, size: 0, color: "#FF0000", visible: true }],
        flowStart: true,
        flowName: "Main",
        interactions: [{ trigger: "click", actions: [{ type: "navigate", target: "C" }] } as never],
        animation: { tracks: { x: [{ t: 0, v: 0, easing: "linear" }, { t: 500, v: 100, easing: "ease-out", bezier: [0.1, 0.2, 0.3, 0.4] }], opacity: [{ t: 0, v: 1, easing: "hold" }] }, duration: 1000, playback: "loop" },
        variableModes: { col: "m2" },
    });
    doc = add(doc, "rect", "R", { x: 10, y: 10, w: 50, h: 40 }, "F", {
        fills: [solid("#123456", 0.5), linearGradient(), imagePaint("img", "crop")],
        strokes: [solid("#000000")],
        strokeWidth: 2,
        strokeAlign: "outside",
        radii: [1, 2, 3, 4],
        cornerSmoothing: 0.6,
        effects: [defaultEffect("drop-shadow"), defaultEffect("glass"), defaultEffect("noise")],
        constraints: { h: "scale", v: "center" },
        boundVariables: { fills: "v1" },
        exportSettings: [{ format: "PNG", scale: 2, suffix: "@2x" } as never],
        pluginData: { "p:k": "v" },
    });
    doc = add(doc, "ellipse", "E", { x: 10, y: 60, w: 30, h: 30 }, "F", { arc: { start: 0, sweep: 270, inner: 0.5 } });
    doc = add(doc, "text", "T", { x: 10, y: 100, w: 100, h: 20 }, "F", {
        text: "Hello rich\nworld",
        spans: [{ start: 0, end: 5, fontWeight: 700, fills: [solid("#FF0000")] }],
        paragraphs: [{ list: "bullet", level: 1 }, { list: null }],
        lineHeight: 1.5,
        letterSpacing: 2,
        textCase: "upper",
        openType: { liga: false },
    });
    const path = { w: 10, h: 10, subpaths: [{ closed: true, points: [{ x: 0, y: 0, in: null, out: { x: 5, y: 0 } }, { x: 10, y: 10, in: { x: 10, y: 5 }, out: null }, { x: 0, y: 10, in: null, out: null, radius: 2 }] }] };
    doc = add(doc, "vector", "V", { x: 200, y: 0, w: 10, h: 10 }, PAGE, { path, regionFills: [{ id: "a", x: 0.5, y: 0.5 }], strokeCap: "round", strokeCapEnd: "arrow-lines", widthPoints: [{ t: 0, w: 1 }, { t: 1, w: 2 }] });
    doc = applyCommand(doc, {
        type: "batch",
        commands: [
            { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, PAGE, { id: "G" }) },
            { type: "node.create", node: makeNode(doc, "rect", { x: 300, y: 300, w: 10, h: 10 }, "G", { id: "G1" }) },
            { type: "node.create", node: makeNode(doc, "boolean", { x: 0, y: 0, w: 1, h: 1 }, PAGE, { id: "B", booleanOp: "subtract" }) },
            { type: "node.create", node: makeNode(doc, "rect", { x: 500, y: 0, w: 100, h: 100 }, "B", { id: "B1" }) },
            { type: "node.create", node: makeNode(doc, "ellipse", { x: 550, y: 50, w: 100, h: 100 }, "B", { id: "B2" }) },
        ],
    });
    doc = add(doc, "componentSet", "S", { x: 0, y: 600, w: 300, h: 200 });
    doc = add(doc, "component", "C", { x: 10, y: 610, w: 100, h: 100 }, "S", { name: "Size=Large", componentProps: [{ id: "p1", name: "Label", kind: "text", defaultValue: "OK" }], description: "A button" });
    doc = add(doc, "text", "CT", { x: 20, y: 620, w: 50, h: 20 }, "C", { text: "OK", propBindings: { text: "p1" } });
    doc = add(doc, "instance", "I", { x: 400, y: 600, w: 100, h: 100 }, PAGE, { componentId: "C", propValues: { p1: "Go" } });
    const p2 = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: "P2", name: "Second", rulerGuides: [{ axis: "x", at: 10 }] });
    doc = applyCommand(doc, { type: "node.create", node: p2 });
    doc = applyCommand(doc, { type: "image.add", id: "img", data: "data:image/png;base64,AAAA" });
    doc = applyCommand(doc, { type: "styles.set", styles: { colors: [{ id: "s1", name: "Brand/Primary", paint: solid("#336699") }], texts: [{ id: "t1", name: "Body", fontFamily: "Inter", fontSize: 14, fontWeight: 400, italic: false, lineHeight: null, letterSpacing: 0 }], effects: [{ id: "e1", name: "Shadow", shadow: null, blur: 0, effects: [defaultEffect("drop-shadow")] }], grids: [{ id: "g1", name: "12 col", guides: [] }] } });
    doc = applyCommand(doc, { type: "variables.set", variables: [{ id: "col", name: "Theme", modes: [{ id: "m1", name: "Light" }, { id: "m2", name: "Dark" }], defaultModeId: "m1", variables: [{ id: "v1", name: "bg", type: "color", values: { m1: "#ffffff", m2: "#000000" }, scopes: ["all-fills"] }, { id: "v2", name: "gap", type: "number", values: { m1: 8, m2: { alias: "v3" } } }, { id: "v3", name: "base", type: "number", values: { m1: 4, m2: 4 } }] }] });
    doc = applyCommand(doc, { type: "prototype.set", prototype: { scaling: "fit", background: "#111111", device: { id: "iphone-15", landscape: true } } });
    doc = applyCommand(doc, { type: "sequence.set", sequence: { width: 1920, height: 1080, fps: 30, clips: [{ id: "c1", kind: "frame", name: "Intro", frame: "F", duration: 2 }] } });
    doc = applyCommand(doc, { type: "doc.settings", patch: { colorProfile: "p3", pluginData: { "x:y": "z" } } });
    return doc;
}

describe("document serialization", () => {
    it("the rich document has every node type", () => {
        const types = new Set(Object.values(richDoc().nodes).map((n) => n.type));
        const all: NodeType[] = ["page", "frame", "component", "componentSet", "instance", "group", "boolean", "rect", "ellipse", "vector", "text"];
        for (const t of all) expect(types.has(t), t).toBe(true);
    });

    it("JSON round trip through prepareDocument gives the same document", () => {
        const doc = richDoc();
        const back = prepareDocument(JSON.parse(JSON.stringify(doc)) as NagmaDocument);
        expect(back).not.toBeNull();
        expect(plain(back)).toEqual(plain(doc));
    });

    it("a second round trip changes nothing", () => {
        const once = prepareDocument(plain(richDoc()));
        const twice = prepareDocument(plain(once));
        expect(plain(twice)).toEqual(plain(once));
    });

    it("normalizeNode is idempotent for every node of the rich document", () => {
        for (const node of Object.values(richDoc().nodes)) {
            const once = normalizeNode(plain(node));
            expect(plain(normalizeNode(once))).toEqual(plain(once));
            expect(plain(once)).toEqual(plain(node));
        }
    });

    it("loose layers from files saved before pages land on a new first page", () => {
        const legacy = { name: "Old", roots: ["a"], images: {}, nodes: { a: { id: "a", type: "rect", name: "A", x: 1, y: 2, w: 3, h: 4, fill: "#ff0000" } } } as unknown as NagmaDocument;
        const doc = prepareDocument(legacy)!;
        expect(doc.roots).toHaveLength(1);
        const page = doc.nodes[doc.roots[0] as string] as SceneNode;
        expect(page.type).toBe("page");
        expect(page.name).toBe("Page 1");
        expect(page.children).toEqual(["a"]);
        expect(doc.nodes.a?.parentId).toBe(page.id);
        expect(doc.nodes.a?.fills).toEqual([solid("#ff0000")]);
    });

    it("an empty document gets a page; broken input is refused", () => {
        const doc = prepareDocument({ name: "E", nodes: {}, roots: [] } as unknown as NagmaDocument)!;
        expect(doc.roots).toHaveLength(1);
        expect(doc.images).toEqual({});
        expect(prepareDocument(null)).toBeNull();
        expect(prepareDocument({ name: "x" } as unknown as NagmaDocument)).toBeNull();
        expect(prepareDocument({ name: "x", nodes: {}, roots: "nope" } as unknown as NagmaDocument)).toBeNull();
    });
});

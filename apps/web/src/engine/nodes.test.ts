import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { DEFAULT_EFFECT, addEffectCommand, defaultEffect, effectsOf } from "./effects";
import { makeNode, migrateTracks, nextName, normalizeNode } from "./nodes";
import { activePage } from "./page";
import { migratePaints, solid } from "./paint";
import { pixelGrid } from "./pixel-grid";
import type { Effect, NodeType, SceneNode } from "./types";
import { PAGE, add, emptyDoc, node, plain } from "../test/core-fixtures";

afterEach(() => {
    pixelGrid.snap = true;
});

const r = { x: 10.4, y: 20.6, w: 30.5, h: 0.2 };

describe("makeNode defaults", () => {
    const table: [NodeType, string, string | null, "pass-through" | "normal"][] = [
        ["frame", "Frame 1", "#FFFFFF", "pass-through"],
        ["component", "Component 1", "#FFFFFF", "pass-through"],
        ["componentSet", "Component set 1", null, "pass-through"],
        ["instance", "Instance 1", null, "pass-through"],
        ["group", "Group 1", null, "pass-through"],
        ["boolean", "Boolean 1", "#D9D9D9", "normal"],
        ["rect", "Rectangle 1", "#D9D9D9", "normal"],
        ["ellipse", "Ellipse 1", "#D9D9D9", "normal"],
        ["vector", "Vector 1", null, "normal"],
        ["text", "Text", "#000000", "normal"],
    ];
    it.each(table)("%s: name %s, fill %s, blend %s", (type, name, fill, blend) => {
        const n = makeNode(emptyDoc(), type, r, PAGE);
        expect(n.name).toBe(name);
        expect(n.fills).toEqual(fill ? [solid(fill)] : []);
        expect(n.blendMode).toBe(blend);
        expect(n.strokes).toEqual([]);
        expect(n.strokeAlign).toBe("inside");
        expect(n.strokeWidth).toBe(1);
        expect(n.opacity).toBe(1);
        expect(n.visible).toBe(true);
        expect(n.locked).toBe(false);
        expect(n.rotation).toBe(0);
        expect(n.parentId).toBe(PAGE);
        expect(n.children).toEqual([]);
        expect(n.layout).toBeNull();
        expect(n.id).toMatch(/^[\w-]{10}$/);
        expect(n.sizing).toEqual(type === "text" ? { h: "hug", v: "hug" } : { h: "fixed", v: "fixed" });
    });

    it("text starts as 12px regular Inter-style defaults, left aligned, named after its text", () => {
        const t = makeNode(emptyDoc(), "text", r, PAGE);
        expect(t).toMatchObject({ text: "Text", fontSize: 12, fontWeight: 400, textAlign: "left" });
        expect(makeNode(emptyDoc(), "text", r, PAGE, { text: "Hello" }).name).toBe("Hello");
    });

    it("snaps shapes to whole pixels when snapping is on, never below 1px", () => {
        const n = makeNode(emptyDoc(), "rect", r, PAGE);
        expect([n.x, n.y, n.w, n.h]).toEqual([10, 21, 31, 1]);
    });

    it("keeps sub-pixel shapes with snapping off, but frames always land on whole pixels", () => {
        pixelGrid.snap = false;
        const n = makeNode(emptyDoc(), "rect", r, PAGE);
        expect([n.x, n.y, n.w, n.h]).toEqual([10.4, 20.6, 30.5, 1]);
        const f = makeNode(emptyDoc(), "frame", r, PAGE);
        expect([f.x, f.y, f.w, f.h]).toEqual([10, 21, 31, 1]);
        const c = makeNode(emptyDoc(), "componentSet", r, PAGE);
        expect([c.x, c.y]).toEqual([10, 21]);
    });

    it("overrides win over defaults", () => {
        const n = makeNode(emptyDoc(), "rect", r, PAGE, { id: "fixed", name: "Mine", opacity: 0.3, fills: [] });
        expect(n).toMatchObject({ id: "fixed", name: "Mine", opacity: 0.3, fills: [] });
    });

    it("negative sizes from a reversed drag still give a 1px layer", () => {
        const n = makeNode(emptyDoc(), "ellipse", { x: 0, y: 0, w: -20, h: -5 }, PAGE);
        expect(n.w).toBe(1);
        expect(n.h).toBe(1);
    });
});

describe("nextName: numbering per container", () => {
    function doc() {
        let d = emptyDoc();
        d = add(d, "rect", "p1", { x: 0, y: 0, w: 1, h: 1 }, PAGE, { name: "Rectangle 1" });
        d = add(d, "frame", "F", { x: 0, y: 0, w: 100, h: 100 }, PAGE, { name: "Frame 1" });
        d = add(d, "rect", "f1", { x: 0, y: 0, w: 1, h: 1 }, "F", { name: "Rectangle 1" });
        d = add(d, "rect", "f2", { x: 0, y: 0, w: 1, h: 1 }, "F", { name: "Rectangle 7" });
        d = add(d, "rect", "f3", { x: 0, y: 0, w: 1, h: 1 }, "F", { name: "Rectangle 7 copy" });
        d = add(d, "rect", "f4", { x: 0, y: 0, w: 1, h: 1 }, "F", { name: "Ellipse 4" });
        return d;
    }

    it.each([
        ["rect", "F", "Rectangle 8"],
        ["rect", PAGE, "Rectangle 2"],
        ["rect", null, "Rectangle 2"],
        ["ellipse", "F", "Ellipse 5"],
        ["ellipse", PAGE, "Ellipse 1"],
        ["frame", PAGE, "Frame 2"],
        ["frame", "F", "Frame 1"],
        ["rect", "missing-parent", "Rectangle 1"],
    ] as [NodeType, string | null, string][])("%s in %s → %s", (type, parent, expected) => {
        expect(nextName(doc(), type, parent)).toBe(expected);
    });

    it("counts the active page's layers when no parent is given", () => {
        let d = doc();
        const p2 = makeNode(d, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: "P2", name: "Page 2" });
        d = applyCommand(d, { type: "node.create", node: p2 });
        d = add(d, "rect", "q1", { x: 0, y: 0, w: 1, h: 1 }, "P2", { name: "Rectangle 5" });
        activePage.id = "P2";
        expect(nextName(d, "rect")).toBe("Rectangle 6");
        activePage.id = PAGE;
        expect(nextName(d, "rect")).toBe("Rectangle 2");
    });

    it("skips names used inside the page's components", () => {
        let d = doc();
        d = add(d, "component", "C", { x: 0, y: 0, w: 100, h: 100 }, "F", { name: "Button" });
        d = add(d, "rect", "c1", { x: 0, y: 0, w: 1, h: 1 }, "C", { name: "Rectangle 3" });
        expect(nextName(d, "rect", PAGE)).toBe("Rectangle 4");
        expect(nextName(d, "rect", "F")).toBe("Rectangle 8");
    });

    it("makeNode numbers through nextName", () => {
        expect(makeNode(doc(), "rect", r, "F").name).toBe("Rectangle 8");
    });
});

describe("normalizeNode and legacy fields", () => {
    it("fills defaults for a bare saved node", () => {
        const n = normalizeNode({ id: "x", type: "rect" } as SceneNode);
        expect(n).toMatchObject({ id: "x", type: "rect", parentId: null, children: [], visible: true, opacity: 1, blendMode: "normal", strokeAlign: "inside" });
        expect(n.fills).toEqual([]);
        expect(n.strokes).toEqual([]);
    });

    it("converts the old single fill, image and stroke into paint lists", () => {
        const legacy = { id: "x", type: "rect", fill: "#112233", fillOpacity: 0.5, fillVisible: false, image: { id: "img", mode: "fit" }, stroke: "#445566" } as unknown as SceneNode;
        const n = normalizeNode(legacy) as SceneNode & Record<string, unknown>;
        expect(n.fills).toEqual([{ ...solid("#112233", 0.5), visible: false }, { type: "image", id: "img", mode: "fit", opacity: 1, visible: true, blend: "normal" }]);
        expect(n.strokes).toEqual([solid("#445566")]);
        for (const k of ["fill", "fillOpacity", "fillVisible", "stroke", "image"]) expect(k in n).toBe(false);
    });

    it("migratePaints leaves nodes that already have paint lists alone", () => {
        expect(migratePaints({ fills: [], fill: "#000000" })).toEqual({});
        expect(migratePaints({})).toEqual({ fills: [], strokes: [] });
        expect(migratePaints({ image: { id: "i" } })).toEqual({ fills: [{ type: "image", id: "i", mode: "fill", opacity: 1, visible: true, blend: "normal" }], strokes: [] });
        // A malformed legacy fill doesn't make a paint.
        expect(migratePaints({ fill: 12, stroke: null })).toEqual({ fills: [], strokes: [] });
    });

    it("is idempotent", () => {
        const samples: SceneNode[] = [
            { id: "a", type: "text", text: "Hi", fill: "#ff0000" } as unknown as SceneNode,
            { id: "b", type: "frame", children: ["c"], layout: { direction: "horizontal", gap: 4, padding: [1, 2, 3, 4], primary: "start", counter: "center" } } as unknown as SceneNode,
            { id: "c", type: "vector", parentId: "b", shadow: { x: 1, y: 2, blur: 3, color: "#000000", opacity: 0.5 }, blur: 2, animation: { tracks: { shadowX: [{ t: 0, v: 1, easing: "linear" }], strokeTop: [{ t: 0, v: 2, easing: "linear" }] } } } as unknown as SceneNode,
            makeNode(emptyDoc(), "ellipse", r, PAGE, { effects: [defaultEffect("glass")] }),
        ];
        for (const s of samples) {
            const once = normalizeNode(s);
            expect(plain(normalizeNode(once))).toEqual(plain(once));
            expect(plain(normalizeNode(plain(once)))).toEqual(plain(once));
        }
    });

    it("migrates old keyframe track names onto effect indices, folding the legacy shadow and blur into effects", () => {
        const base = makeNode(emptyDoc(), "rect", r, PAGE, { shadow: { x: 1, y: 2, blur: 3, color: "#000000", opacity: 0.5 }, blur: 6 });
        const n = migrateTracks({ ...base, animation: { tracks: { shadowX: [{ t: 0, v: 1, easing: "linear" }], blur: [{ t: 0, v: 9, easing: "linear" }], strokeLeft: [{ t: 0, v: 3, easing: "linear" }], opacity: [{ t: 0, v: 1, easing: "linear" }] } as never } });
        expect(Object.keys(n.animation?.tracks ?? {}).sort()).toEqual(["borderLeft", "fx0.x", "fx1.blur", "opacity"]);
        expect(n.shadow).toBeNull();
        expect(n.blur).toBe(0);
        expect(n.effects?.map((e) => e.type)).toEqual(["drop-shadow", "layer-blur"]);
        // No legacy names: untouched (same object).
        const plainNode = { ...base, animation: { tracks: { x: [{ t: 0, v: 1, easing: "linear" as const }] } } };
        expect(migrateTracks(plainNode)).toBe(plainNode);
    });

    it("drops a legacy effect track when the layer has no such effect", () => {
        const base = makeNode(emptyDoc(), "rect", r, PAGE);
        const n = migrateTracks({ ...base, animation: { tracks: { glassDepth: [{ t: 0, v: 1, easing: "linear" }] } as never } });
        expect(n.animation?.tracks).toEqual({});
    });
});

describe("effects", () => {
    it("reads the legacy shadow and blur as the first rows", () => {
        const n = makeNode(emptyDoc(), "rect", r, PAGE, { shadow: { x: 1, y: 2, blur: 3, color: "#123456", opacity: 0.4 }, blur: 5, effects: [defaultEffect("inner-shadow")] });
        expect(effectsOf(n).map((e) => e.type)).toEqual(["drop-shadow", "layer-blur", "inner-shadow"]);
        expect(effectsOf(n)[0]).toMatchObject({ x: 1, y: 2, blur: 3, color: "#123456", opacity: 0.4, spread: 0 });
        expect(effectsOf(n)[1]).toMatchObject({ blur: 5 });
        expect(effectsOf(makeNode(emptyDoc(), "rect", r, PAGE))).toEqual([]);
    });

    const kinds: Effect["type"][] = ["drop-shadow", "inner-shadow", "layer-blur", "background-blur", "motion-blur", "noise", "texture", "glass", "shader"];
    it.each(kinds)("default %s effect is complete and keeps its type", (type) => {
        const e = defaultEffect(type);
        expect(e.type).toBe(type);
        expect(e.visible).toBe(true);
        for (const k of ["x", "y", "blur", "spread", "opacity"] as const) expect(Number.isFinite(e[k])).toBe(true);
        expect(e.color).toMatch(/^#[0-9A-F]{6}$/i);
        expect(defaultEffect(type, false).visible).toBe(false);
    });

    it("drop shadow default is the reference's 0/4/4 at 25%", () => {
        expect(defaultEffect("drop-shadow")).toEqual({ ...DEFAULT_EFFECT, type: "drop-shadow" });
        expect(DEFAULT_EFFECT).toMatchObject({ x: 0, y: 4, blur: 4, spread: 0, opacity: 0.25 });
    });

    it("adding an effect folds legacy fields into the list, and glass thins the first solid fill", () => {
        let d = add(emptyDoc(), "rect", "R", { x: 0, y: 0, w: 10, h: 10 }, PAGE, { shadow: { x: 1, y: 1, blur: 1, color: "#000000", opacity: 1 } });
        d = applyCommand(d, addEffectCommand([node(d, "R")], "glass"));
        const n = node(d, "R");
        expect(n.shadow).toBeNull();
        expect(n.effects?.map((e) => e.type)).toEqual(["drop-shadow", "glass"]);
        expect(n.fills[0]).toMatchObject({ type: "solid", opacity: 0.1 });
    });
});

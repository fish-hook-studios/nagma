import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import type { NagmaDocument, SceneNode, Transition, Variable, VariableCollection } from "./types";
import {
    addMode,
    addVariable,
    allowedFor,
    bindVariable,
    collectionsOf,
    conditionHolds,
    createCollection,
    deleteCollection,
    deleteVariable,
    deleteVariableGroup,
    duplicateMode,
    duplicateVariable,
    effectiveVariables,
    extendCollection,
    extendedValue,
    fieldInfo,
    findVariable,
    moveMode,
    parseFontStyle,
    previewValue,
    removeMode,
    renameMode,
    renameVariable,
    resolveTransition,
    resolveVariable,
    resolveVariables,
    setDefaultMode,
    setFrameMode,
    setOverride,
    setVariableValue,
    updateVariable,
} from "./variables";
import { editor } from "./store";
import { addNode, blankDoc, collection, current, nodeOf, openInEditor, plain, variable } from "../test/sys-fixtures";

// Variables: collections and modes, aliases, extended collections, scopes, bindings, frame modes,
// transitions and conditions, and undo of every editing action through the editor store.

function withVariables(doc: NagmaDocument, variables: VariableCollection[]): NagmaDocument {
    return applyCommand(doc, { type: "variables.set", variables });
}

// A frame "outer" holding a frame "inner" holding a rectangle "box", plus a loose text layer.
function tree(): NagmaDocument {
    let doc = blankDoc();
    doc = addNode(doc, "frame", "outer", { x: 0, y: 0, w: 400, h: 400 });
    doc = addNode(doc, "frame", "inner", { x: 10, y: 10, w: 200, h: 200 }, "outer");
    doc = addNode(doc, "rect", "box", { x: 20, y: 20, w: 50, h: 50 }, "inner");
    doc = addNode(doc, "text", "label", { x: 500, y: 0, w: 50, h: 20 });
    return doc;
}

const colors = () =>
    collection("colors", ["light", "dark"], [
        variable("bg", "color", { light: "#FFFFFF", dark: "#111111" }),
        variable("fg", "color", { light: "#000000", dark: "#EEEEEE" }),
        variable("accent", "color", { light: { alias: "fg" }, dark: { alias: "fg", opacity: 0.5 } }),
    ]);

const sizes = () =>
    collection("sizes", ["s", "m", "l"], [
        variable("pad", "number", { s: 4, m: 8, l: 16 }),
        variable("radius", "number", { s: 2, m: { alias: "pad" }, l: 99 }),
        variable("label", "string", { s: "Small", m: "Medium", l: "Large" }),
        variable("show", "boolean", { s: false, m: true, l: true }),
    ]);

describe("resolveVariable", () => {
    const doc = withVariables(tree(), [colors(), sizes()]);
    const n = (id: string) => nodeOf(doc, id);

    it.each<[string, string, string | number | boolean | null, number?]>([
        ["literal in the default (first) mode", "bg", "#FFFFFF"],
        ["number", "pad", 4],
        ["string", "label", "Small"],
        ["boolean", "show", false],
        ["alias", "accent", "#000000", 1],
        ["missing variable", "nope", null],
    ])("%s", (_label, id, value, opacity) => {
        const r = resolveVariable(doc, id, null);
        if (value === null) expect(r).toBeNull();
        else {
            expect(r?.value).toBe(value);
            if (opacity !== undefined) expect(r?.opacity).toBe(opacity);
        }
    });

    it("uses the collection's chosen default mode", () => {
        const d = withVariables(tree(), [{ ...colors(), defaultModeId: "dark" }]);
        expect(resolveVariable(d, "bg", null)?.value).toBe("#111111");
    });

    it("ignores a default mode id that no longer exists", () => {
        const d = withVariables(tree(), [{ ...colors(), defaultModeId: "gone" }]);
        expect(resolveVariable(d, "bg", null)?.value).toBe("#FFFFFF");
    });

    it("resolves an alias in the target's mode and multiplies opacity", () => {
        const r = resolveVariable(doc, "accent", n("box"), { modes: { colors: "dark" } });
        expect(r).toEqual({ value: "#EEEEEE", opacity: 0.5 });
    });

    it("follows an alias chain", () => {
        const d = withVariables(tree(), [
            collection("c", ["m"], [variable("a", "number", { m: { alias: "b" } }), variable("b", "number", { m: { alias: "c" } }), variable("c", "number", { m: 7 })]),
        ]);
        expect(resolveVariable(d, "a", null)?.value).toBe(7);
    });

    it.each([
        ["self alias", [variable("a", "number", { m: { alias: "a" } })]],
        ["two-step cycle", [variable("a", "number", { m: { alias: "b" } }), variable("b", "number", { m: { alias: "a" } })]],
        ["three-step cycle", [variable("a", "number", { m: { alias: "b" } }), variable("b", "number", { m: { alias: "c" } }), variable("c", "number", { m: { alias: "a" } })]],
        ["alias to a missing variable", [variable("a", "number", { m: { alias: "ghost" } })]],
    ])("%s resolves to null without hanging", (_label, variables) => {
        const d = withVariables(tree(), [collection("c", ["m"], variables)]);
        const started = Date.now();
        expect(resolveVariable(d, "a", null)).toBeNull();
        expect(Date.now() - started).toBeLessThan(500);
        // Binding a layer to it leaves the layer as it was.
        const bound = applyCommand(d, { type: "node.update", id: "box", patch: { boundVariables: { w: "a" } } });
        expect(nodeOf(bound, "box").w).toBe(50);
    });

    it("a runtime value override wins over the stored one", () => {
        expect(resolveVariable(doc, "pad", null, { values: { pad: 42 } })?.value).toBe(42);
    });

    it("a missing value in the mode resolves to null", () => {
        const d = withVariables(tree(), [collection("c", ["a", "b"], [variable("v", "number", { a: 1 })])]);
        expect(resolveVariable(d, "v", null, { modes: { c: "b" } })).toBeNull();
    });
});

describe("frame modes", () => {
    const base = withVariables(tree(), [colors()]);

    it("a frame's mode applies to its descendants; the nearest ancestor wins", () => {
        let doc = applyCommand(base, { type: "node.update", id: "outer", patch: { variableModes: { colors: "dark" } } });
        expect(resolveVariable(doc, "bg", nodeOf(doc, "box"))?.value).toBe("#111111");
        expect(resolveVariable(doc, "bg", nodeOf(doc, "label"))?.value).toBe("#FFFFFF");
        doc = applyCommand(doc, { type: "node.update", id: "inner", patch: { variableModes: { colors: "light" } } });
        expect(resolveVariable(doc, "bg", nodeOf(doc, "box"))?.value).toBe("#FFFFFF");
        expect(resolveVariable(doc, "bg", nodeOf(doc, "outer"))?.value).toBe("#111111");
    });

    it("a layer's own mode counts, and a stale mode id is skipped", () => {
        let doc = applyCommand(base, { type: "node.update", id: "outer", patch: { variableModes: { colors: "dark" } } });
        doc = applyCommand(doc, { type: "node.update", id: "inner", patch: { variableModes: { colors: "deleted-mode" } } });
        expect(resolveVariable(doc, "bg", nodeOf(doc, "box"))?.value).toBe("#111111");
    });

    it("a forced mode (the player's) beats frame modes", () => {
        const doc = applyCommand(base, { type: "node.update", id: "outer", patch: { variableModes: { colors: "dark" } } });
        expect(resolveVariable(doc, "bg", nodeOf(doc, "box"), { modes: { colors: "light" } })?.value).toBe("#FFFFFF");
    });

    it("setFrameMode changes the bound fill of descendants and undo restores it", () => {
        let doc = applyCommand(base, { type: "node.update", id: "box", patch: { boundVariables: { "fill:0": "bg" } } });
        openInEditor(doc);
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#FFFFFF" });
        const before = current();
        setFrameMode(["outer"], "colors", "dark");
        doc = current();
        expect(doc.nodes.outer?.variableModes).toEqual({ colors: "dark" });
        expect(doc.nodes.box?.fills[0]).toMatchObject({ color: "#111111" });
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
        editor.redo();
        expect(plain(current())).toEqual(plain(doc));
        setFrameMode(["outer"], "colors", null);
        expect(current().nodes.outer?.variableModes).toEqual({});
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#FFFFFF" });
    });
});

describe("extended collections", () => {
    const parent = () => collection("brand", ["light", "dark"], [variable("primary", "color", { light: "#0000FF", dark: "#000088" }), variable("space", "number", { light: 8, dark: 8 })]);
    const ext = (overrides: VariableCollection["overrides"] = {}) => collection("brandB", ["bLight", "bDark"], [variable("own", "number", { bLight: 1, bDark: 2 })], { extends: "brand", overrides });

    it("inherits the parent's variables before its own", () => {
        const doc = withVariables(tree(), [parent(), ext()]);
        const c = collectionsOf(doc)[1] as VariableCollection;
        expect(effectiveVariables(doc, c).map((v) => [v.variable.id, v.inherited])).toEqual([
            ["primary", true],
            ["space", true],
            ["own", false],
        ]);
    });

    it("reads the parent's value in the mode at the same position, unless overridden", () => {
        const doc = withVariables(tree(), [parent(), ext({ primary: { bDark: "#FF0000" } })]);
        const c = collectionsOf(doc)[1] as VariableCollection;
        const primary = findVariable(doc, "primary")?.variable as Variable;
        expect(extendedValue(doc, c, primary, "bLight")).toBe("#0000FF");
        expect(extendedValue(doc, c, primary, "bDark")).toBe("#FF0000");
    });

    it("a layer in the extension's mode reads the variable through it", () => {
        let doc = withVariables(tree(), [parent(), ext({ primary: { bLight: "#00FF00" } })]);
        doc = applyCommand(doc, { type: "node.update", id: "outer", patch: { variableModes: { brandB: "bLight" } } });
        expect(resolveVariable(doc, "primary", nodeOf(doc, "box"))?.value).toBe("#00FF00");
        expect(resolveVariable(doc, "primary", nodeOf(doc, "label"))?.value).toBe("#0000FF");
        expect(resolveVariable(doc, "space", nodeOf(doc, "box"))?.value).toBe(8);
    });

    it("an extension that extends itself, or a pair extending each other, doesn't hang", () => {
        const a = collection("A", ["m"], [variable("x", "number", { m: 1 })], { extends: "B" });
        const b = collection("B", ["m"], [variable("y", "number", { m: 2 })], { extends: "A" });
        const self = collection("S", ["m"], [variable("z", "number", { m: 3 })], { extends: "S" });
        const doc = withVariables(tree(), [a, b, self]);
        expect(() => effectiveVariables(doc, a)).not.toThrow();
        expect(resolveVariable(doc, "x", nodeOf(doc, "box"))?.value).toBe(1);
        expect(resolveVariable(doc, "z", null)?.value).toBe(3);
    });

    it("extendCollection, setOverride and deleting the parent through the editor, each undoable", () => {
        let doc = withVariables(tree(), [parent()]);
        doc = applyCommand(doc, { type: "node.update", id: "box", patch: { boundVariables: { "fill:0": "primary" } } });
        openInEditor(doc);
        const s0 = current();
        const made = extendCollection("brand", "Brand B");
        expect(made).not.toBeNull();
        const e = made as VariableCollection;
        expect(e.modes.map((m) => m.name)).toEqual(["light", "dark"]);
        expect(e.extends).toBe("brand");
        expect(extendCollection("nope")).toBeNull();
        const s1 = current();

        setOverride(e.id, "primary", e.modes[0]?.id ?? "", "#ABCDEF");
        setFrameMode(["outer"], e.id, e.modes[0]?.id ?? "");
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#ABCDEF" });
        const s3 = current();
        setOverride(e.id, "primary", e.modes[0]?.id ?? "", undefined);
        expect(collectionsOf(current()).find((c) => c.id === e.id)?.overrides).toEqual({});
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#0000FF" });
        editor.undo();
        expect(plain(current())).toEqual(plain(s3));

        // Deleting the parent: the extension keeps only its own variables; the bound layer is unbound.
        deleteCollection("brand");
        const after = current();
        const left = collectionsOf(after).find((c) => c.id === e.id);
        expect(left?.extends).toBeUndefined();
        expect(left?.overrides).toBeUndefined();
        expect(after.nodes.box?.boundVariables).toEqual({});
        expect(after.nodes.box?.fills[0]).toMatchObject({ color: "#ABCDEF" });
        expect(resolveVariable(after, "primary", nodeOf(after, "box"))).toBeNull();
        editor.undo();
        expect(plain(current())).toEqual(plain(s3));
        editor.undo();
        editor.undo();
        expect(plain(current())).toEqual(plain(s1));
        editor.undo();
        expect(plain(current())).toEqual(plain(s0));
    });
});

describe("scopes", () => {
    const rect = { type: "rect" } as SceneNode;
    const frame = { type: "frame" } as SceneNode;
    const text = { type: "text" } as SceneNode;

    it.each<[string, SceneNode | undefined, string, string]>([
        ["fill:0", rect, "color", "shape-fill"],
        ["fill:0", frame, "color", "frame-fill"],
        ["fill:0", text, "color", "text-fill"],
        ["fill", undefined, "color", "shape-fill"],
        ["stroke:0", rect, "color", "stroke"],
        ["fill:0:stop:1", text, "color", "text-fill"],
        ["stroke:0:stop:1", rect, "color", "stroke"],
        ["strokeWeight:2", rect, "number", "stroke-width"],
        ["strokeWidth", rect, "number", "stroke-width"],
        ["radius", rect, "number", "corner-radius"],
        ["radius:3", rect, "number", "corner-radius"],
        ["opacity", rect, "number", "opacity"],
        ["w", rect, "number", "width-height"],
        ["maxH", rect, "number", "width-height"],
        ["gap", frame, "number", "gap"],
        ["padding:1", frame, "number", "gap"],
        ["gridColumnGap", frame, "number", "gap"],
        ["guide:0:gutter", frame, "number", "gap"],
        ["shadow:color", rect, "color", "effect-color"],
        ["effect:1:color", rect, "color", "effect-color"],
        ["effect:1:spread", rect, "number", "effect"],
        ["fontSize", text, "number", "font-size"],
        ["lineHeight", text, "number", "line-height"],
        ["letterSpacing", text, "number", "letter-spacing"],
        ["paragraphSpacing", text, "number", "paragraph-spacing"],
        ["paragraphIndent", text, "number", "paragraph-indent"],
        ["fontWeight", text, "number", "font-weight"],
        ["fontFamily", text, "string", "font-family"],
        ["fontStyle", text, "string", "font-style"],
        ["text", text, "string", "text-content"],
        ["visible", rect, "boolean", "all"],
        ["transition:easing", undefined, "easing", "all"],
        ["transition:duration", undefined, "timing", "all"],
    ])("fieldInfo(%s)", (key, node, type, scope) => {
        expect(fieldInfo(key, node)).toEqual({ type, scope });
    });

    // Regression: a colour variable scoped to opacity couldn't be bound to a paint's opacity field.
    it("fill:<i>:opacity is the colour-opacity scope", () => {
        expect(fieldInfo("fill:1:opacity", rect)).toEqual({ type: "color", scope: "color-opacity" });
        expect(fieldInfo("stroke:0:opacity", rect)).toEqual({ type: "color", scope: "color-opacity" });
    });

    it.each<[string, Variable["scopes"], string, SceneNode | undefined, boolean]>([
        ["all scopes", ["all"], "fill:0", rect, true],
        ["no scopes listed means all", undefined, "fill:0", rect, true],
        ["wrong type", ["all"], "w", rect, false],
        ["all-fills covers frame fills", ["all-fills"], "fill:0", frame, true],
        ["all-fills covers text fills", ["all-fills"], "fill:0", text, true],
        ["all-fills doesn't cover strokes", ["all-fills"], "stroke:0", rect, false],
        ["frame-fill only on frames", ["frame-fill"], "fill:0", frame, true],
        ["frame-fill not on shapes", ["frame-fill"], "fill:0", rect, false],
        ["text-fill on text", ["text-fill"], "fill:0", text, true],
        ["stroke scope", ["stroke"], "stroke:0", rect, true],
        ["effect colour", ["effect-color"], "shadow:color", rect, true],
        ["colour-opacity on paint opacity", ["color-opacity"], "fill:0:opacity", rect, true],
    ])("colour variable: %s", (_label, scopes, key, node, allowed) => {
        const v = variable("c", "color", { m: "#000000" }, { scopes });
        expect(allowedFor(v, key, node)).toBe(allowed);
    });

    it.each<[Variable["scopes"], string, boolean]>([
        [["corner-radius"], "radius", true],
        [["corner-radius"], "radius:2", true],
        [["corner-radius"], "w", false],
        [["width-height"], "h", true],
        [["gap"], "padding:0", true],
        [["opacity"], "opacity", true],
        [["font-size"], "fontSize", true],
        [["font-size"], "lineHeight", false],
        [["stroke-width"], "strokeWeight:0", true],
        [["corner-radius"], "visible", false],
    ])("number variable scoped %j on %s → %s", (scopes, key, allowed) => {
        const v = variable("n", "number", { m: 1 }, { scopes });
        expect(allowedFor(v, key, rect)).toBe(allowed);
    });

    it("boolean and string variables", () => {
        expect(allowedFor(variable("b", "boolean", { m: true }), "visible", rect)).toBe(true);
        expect(allowedFor(variable("s", "string", { m: "x" }, { scopes: ["text-content"] }), "text", text)).toBe(true);
        expect(allowedFor(variable("s", "string", { m: "x" }, { scopes: ["font-family"] }), "text", text)).toBe(false);
    });
});

describe("resolveVariables writes bound fields", () => {
    const vars = collection("v", ["m"], [
        variable("color", "color", { m: "#123456" }),
        variable("alpha", "color", { m: "#FF000080" }),
        variable("num", "number", { m: 24 }),
        variable("half", "number", { m: 50 }),
        variable("lh", "number", { m: 150 }),
        variable("str", "string", { m: "Hello" }),
        variable("bold", "string", { m: "Semi Bold Italic" }),
        variable("hide", "boolean", { m: false }),
        variable("fam", "string", { m: "Roboto" }),
    ]);

    function bound(type: SceneNode["type"], boundVariables: Record<string, string>, extra: Partial<SceneNode> = {}): SceneNode {
        let doc = withVariables(blankDoc(), [vars]);
        doc = addNode(doc, type, "n", { x: 0, y: 0, w: 10, h: 10 }, undefined, { boundVariables, ...extra });
        return nodeOf(doc, "n");
    }

    it.each<[string, SceneNode["type"], Record<string, string>, (n: SceneNode) => unknown, unknown, Partial<SceneNode>?]>([
        ["fill colour", "rect", { "fill:0": "color" }, (n) => n.fills[0], { color: "#123456", opacity: 1 }],
        ["legacy fill key", "rect", { fill: "color" }, (n) => n.fills[0], { color: "#123456" }],
        ["stroke colour", "rect", { "stroke:0": "color" }, (n) => n.strokes[0], { color: "#123456" }, { strokes: [{ type: "solid", color: "#000000", opacity: 1, visible: true, blend: "normal" }] }],
        ["paint opacity from an 8-digit hex", "rect", { "fill:0:opacity": "alpha" }, (n) => n.fills[0]?.opacity, 128 / 255],
        ["width", "rect", { w: "num" }, (n) => n.w, 24],
        ["height", "rect", { h: "num" }, (n) => n.h, 24],
        ["radius", "rect", { radius: "num" }, (n) => n.radius, 24],
        ["one corner", "rect", { "radius:2": "num" }, (n) => n.radii, [0, 0, 24, 0]],
        ["opacity is a percentage", "rect", { opacity: "half" }, (n) => n.opacity, 0.5],
        ["visibility", "rect", { visible: "hide" }, (n) => n.visible, false],
        ["text", "text", { text: "str" }, (n) => n.text, "Hello"],
        ["font size", "text", { fontSize: "num" }, (n) => n.fontSize, 24],
        ["line height is a percentage", "text", { lineHeight: "lh" }, (n) => n.lineHeight, 1.5],
        ["font family", "text", { fontFamily: "fam" }, (n) => n.fontFamily, "Roboto"],
        ["font style sets weight and italic", "text", { fontStyle: "bold" }, (n) => [n.fontWeight, n.italic], [600, true]],
        ["one stroke side", "rect", { "strokeWeight:1": "num" }, (n) => [n.strokeWeights, n.strokeWidth], [[1, 24, 1, 1], 24]],
        ["gap", "frame", { gap: "num" }, (n) => n.layout?.gap, 24, { layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } }],
        ["padding (all sides)", "frame", { padding: "num" }, (n) => n.layout?.padding, [24, 24, 24, 24], { layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } }],
        ["one padding side", "frame", { "padding:3": "num" }, (n) => n.layout?.padding, [0, 0, 0, 24], { layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } }],
        ["wrong type is ignored", "rect", { w: "str" }, (n) => n.w, 10],
        ["unknown variable is ignored", "rect", { w: "ghost" }, (n) => n.w, 10],
    ])("%s", (_label, type, boundVariables, read, expected, extra) => {
        const n = bound(type, boundVariables, extra);
        const v = read(n);
        if (typeof expected === "number") expect(v).toBeCloseTo(expected, 6);
        else if (expected && typeof expected === "object" && !Array.isArray(expected)) expect(v).toMatchObject(expected);
        else expect(v).toEqual(expected);
    });

    it("leaves a document without variables untouched (same object)", () => {
        const doc = blankDoc();
        expect(resolveVariables(doc)).toBe(doc);
    });

    it("is stable: a second pass changes nothing", () => {
        let doc = withVariables(tree(), [vars]);
        doc = applyCommand(doc, { type: "node.update", id: "box", patch: { boundVariables: { "fill:0": "color", w: "num", opacity: "half" } } });
        expect(resolveVariables(doc)).toBe(doc);
    });

    it.each<[string, { weight: number; italic: boolean }]>([
        ["Regular", { weight: 400, italic: false }],
        ["Italic", { weight: 400, italic: true }],
        ["Thin", { weight: 100, italic: false }],
        ["Extra Light", { weight: 200, italic: false }],
        ["Light", { weight: 300, italic: false }],
        ["Medium", { weight: 500, italic: false }],
        ["SemiBold", { weight: 600, italic: false }],
        ["Bold", { weight: 700, italic: false }],
        ["Extra Bold Oblique", { weight: 800, italic: true }],
        ["Black", { weight: 900, italic: false }],
        ["700 Italic", { weight: 700, italic: true }],
    ])("parseFontStyle(%s)", (name, expected) => {
        expect(parseFontStyle(name)).toEqual(expected);
    });
});

describe("resolveTransition", () => {
    const doc = withVariables(blankDoc(), [
        collection("motion", ["calm", "snappy"], [
            variable("ease", "easing", { calm: { easing: "ease-in-out" }, snappy: { easing: "custom-bezier", bezier: [0.1, 0.2, 0.3, 0.4] } }),
            variable("dur", "timing", { calm: 600, snappy: -50 }),
            variable("springy", "easing", { calm: { easing: "custom-spring", spring: { mass: 1, stiffness: 200, damping: 10 } }, snappy: { easing: "linear" } }),
            variable("text", "string", { calm: "slow", snappy: "fast" }),
        ]),
    ]);
    const base: Transition = { type: "dissolve", direction: "left", duration: 300, easing: "ease-out" };

    it("returns the transition itself when no variables are set", () => {
        expect(resolveTransition(doc, base)).toBe(base);
    });

    it("takes easing and duration from variables in the default mode", () => {
        expect(resolveTransition(doc, { ...base, easingVariable: "ease", durationVariable: "dur" })).toMatchObject({ easing: "ease-in-out", duration: 600 });
        expect(resolveTransition(doc, { ...base, easingVariable: "springy" })).toMatchObject({ easing: "custom-spring", spring: { stiffness: 200 } });
    });

    it("follows a forced mode, carries a bezier and clamps negative durations to 0", () => {
        const t = resolveTransition(doc, { ...base, easingVariable: "ease", durationVariable: "dur" }, { modes: { motion: "snappy" } });
        expect(t).toMatchObject({ easing: "custom-bezier", bezier: [0.1, 0.2, 0.3, 0.4], duration: 0 });
    });

    it("ignores variables of the wrong type or that are gone", () => {
        expect(resolveTransition(doc, { ...base, easingVariable: "text", durationVariable: "ghost" })).toMatchObject({ easing: "ease-out", duration: 300 });
    });
});

describe("conditionHolds (older single conditions)", () => {
    const doc = withVariables(blankDoc(), [collection("c", ["m"], [variable("n", "number", { m: 5 }), variable("s", "string", { m: "on" }), variable("b", "boolean", { m: true })])]);
    it.each<["==" | "!=" | ">" | "<" | ">=" | "<=", string, string | number | boolean, boolean]>([
        ["==", "n", 5, true],
        ["==", "n", "5", true],
        ["!=", "n", 5, false],
        [">", "n", 4, true],
        ["<", "n", 4, false],
        [">=", "n", 5, true],
        ["<=", "n", 4.9, false],
        ["==", "s", "on", true],
        ["!=", "s", "off", true],
        ["==", "b", true, true],
        ["==", "b", "true", true],
        ["==", "ghost", 1, false],
    ])("%s %s %s → %s", (op, variableId, value, expected) => {
        expect(conditionHolds(doc, { variableId, op, value })).toBe(expected);
    });

    it("uses the player's runtime values", () => {
        expect(conditionHolds(doc, { variableId: "n", op: ">", value: 10 }, { values: { n: 11 } })).toBe(true);
    });
});

describe("editing collections and variables (editor store, undo/redo)", () => {
    let base: NagmaDocument;
    beforeEach(() => {
        base = openInEditor(tree());
    });

    // Runs an action, then checks undo restores the document exactly and redo brings it back.
    function undoable(action: () => void): NagmaDocument {
        const before = current();
        action();
        const after = current();
        expect(after).not.toBe(before);
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
        editor.redo();
        expect(plain(current())).toEqual(plain(after));
        return after;
    }

    it("createCollection: one mode, set as default, a fallback name", () => {
        let made: VariableCollection | null = null;
        undoable(() => {
            made = createCollection("  ");
        });
        const c = made as unknown as VariableCollection;
        expect(c.name).toBe("Collection 1");
        expect(c.modes).toHaveLength(1);
        expect(c.defaultModeId).toBe(c.modes[0]?.id);
        expect(collectionsOf(current())).toHaveLength(1);
        void base;
    });

    it("mode actions: add, duplicate, move, rename, default, remove", () => {
        const c = createCollection("Theme");
        const m1 = c.modes[0]?.id as string;
        const v = addVariable(c.id, "number", "size", 10) as Variable;
        expect(v.values[m1]).toBe(10);
        const col = () => collectionsOf(current()).find((x) => x.id === c.id) as VariableCollection;

        undoable(() => addMode(c.id, "Dark"));
        const m2 = col().modes[1]?.id as string;
        expect(col().modes.map((m) => m.name)).toEqual(["Mode 1", "Dark"]);
        // A new mode starts with the first mode's values.
        expect(col().variables[0]?.values[m2]).toBe(10);

        setVariableValue(c.id, v.id, m2, 20);
        undoable(() => duplicateMode(c.id, m2));
        const copy = col().modes[2];
        expect(copy?.name).toBe("Dark copy");
        expect(col().variables[0]?.values[copy?.id ?? ""]).toBe(20);
        // The copy sits right after its source.
        duplicateMode(c.id, m1);
        expect(col().modes.map((m) => m.name)).toEqual(["Mode 1", "Mode 1 copy", "Dark", "Dark copy"]);
        duplicateMode(c.id, "nope");
        expect(col().modes).toHaveLength(4);

        undoable(() => moveMode(c.id, m2, -1));
        expect(col().modes.map((m) => m.name)).toEqual(["Mode 1", "Dark", "Mode 1 copy", "Dark copy"]);
        const unchanged = current();
        moveMode(c.id, m1, -1);
        moveMode(c.id, col().modes[3]?.id ?? "", 1);
        expect(current()).toBe(unchanged);

        undoable(() => renameMode(c.id, m2, "Night"));
        expect(col().modes[1]?.name).toBe("Night");

        undoable(() => setDefaultMode(c.id, m2));
        expect(col().defaultModeId).toBe(m2);

        // Removing the default mode falls back to the first; its values go with it.
        undoable(() => removeMode(c.id, m2));
        expect(col().modes.some((m) => m.id === m2)).toBe(false);
        expect(col().defaultModeId).toBe(col().modes[0]?.id);
        expect(Object.keys(col().variables[0]?.values ?? {})).not.toContain(m2);

        // The last mode can't be removed.
        while (col().modes.length > 1) removeMode(c.id, col().modes[col().modes.length - 1]?.id ?? "");
        const one = current();
        removeMode(c.id, col().modes[0]?.id ?? "");
        expect(current()).toBe(one);
    });

    it("variable actions: add (each type), duplicate, rename, update, set value", () => {
        const c = createCollection("Tokens");
        const m = c.modes[0]?.id as string;
        const made: Variable[] = [];
        for (const type of ["color", "number", "string", "boolean", "easing", "timing"] as const) {
            undoable(() => {
                made.push(addVariable(c.id, type, "") as Variable);
            });
        }
        expect(made.map((v) => v.values[m])).toEqual(["#000000", 0, "", false, { easing: "ease-in-out" }, 300]);
        expect(made.map((v) => v.name)).toEqual(["color 1", "number 2", "string 3", "boolean 4", "easing 5", "timing 6"]);
        expect(addVariable("no-such-collection", "number", "x")).toBeNull();
        const v = made[1] as Variable;
        undoable(() => duplicateVariable(c.id, v.id));
        const vars = () => collectionsOf(current()).find((x) => x.id === c.id)?.variables ?? [];
        expect(vars()[2]?.name).toBe("number 2 copy");
        expect(vars()[2]?.id).not.toBe(v.id);
        undoable(() => renameVariable(c.id, v.id, "spacing"));
        expect(findVariable(current(), v.id)?.variable.name).toBe("spacing");
        undoable(() => updateVariable(c.id, v.id, { scopes: ["gap"], description: "Gaps" }));
        expect(findVariable(current(), v.id)?.variable).toMatchObject({ scopes: ["gap"], description: "Gaps" });
        undoable(() => setVariableValue(c.id, v.id, m, 12));
        expect(findVariable(current(), v.id)?.variable.values[m]).toBe(12);
    });

    it("bindVariable puts the value on the layer; changing the value follows; unbinding keeps the last look", () => {
        const c = createCollection("Theme");
        const m = c.modes[0]?.id as string;
        const v = addVariable(c.id, "number", "w", 120) as Variable;
        undoable(() => bindVariable(["box", "inner"], "w", v.id));
        expect(current().nodes.box?.w).toBe(120);
        expect(current().nodes.inner?.w).toBe(120);
        expect(current().nodes.box?.boundVariables).toEqual({ w: v.id });
        undoable(() => setVariableValue(c.id, v.id, m, 80));
        expect(current().nodes.box?.w).toBe(80);
        undoable(() => bindVariable(["box"], "w", null));
        expect(current().nodes.box?.boundVariables).toEqual({});
        expect(current().nodes.box?.w).toBe(80);
        setVariableValue(c.id, v.id, m, 30);
        expect(current().nodes.box?.w).toBe(80);
        expect(current().nodes.inner?.w).toBe(30);
        // Unknown layers are skipped.
        const before = current();
        bindVariable(["ghost"], "w", v.id);
        expect(current()).toBe(before);
    });

    it("binding text and visibility on a text layer", () => {
        const c = createCollection("Copy");
        const s = addVariable(c.id, "string", "greeting", "Hi there") as Variable;
        const b = addVariable(c.id, "boolean", "shown", false) as Variable;
        bindVariable(["label"], "text", s.id);
        bindVariable(["label"], "visible", b.id);
        expect(current().nodes.label).toMatchObject({ text: "Hi there", visible: false });
    });

    it("deleteVariable unbinds layers (they keep their look) and aliases fall back to the value", () => {
        const c = createCollection("Theme");
        const m1 = c.modes[0]?.id as string;
        addMode(c.id, "Dark");
        const m2 = collectionsOf(current())[0]?.modes[1]?.id as string;
        const target = addVariable(c.id, "color", "base", "#FF0000") as Variable;
        setVariableValue(c.id, target.id, m2, "#00FF00");
        const alias = addVariable(c.id, "color", "alias", { alias: target.id }) as Variable;
        bindVariable(["box"], "fill:0", target.id);
        bindVariable(["inner"], "fill:0", alias.id);
        setFrameMode(["outer"], c.id, m2);
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#00FF00" });
        const after = undoable(() => deleteVariable(c.id, target.id));
        expect(findVariable(after, target.id)).toBeNull();
        expect(after.nodes.box?.boundVariables).toEqual({});
        expect(after.nodes.box?.fills[0]).toMatchObject({ color: "#00FF00" });
        const left = findVariable(after, alias.id)?.variable;
        expect(left?.values).toEqual({ [m1]: "#FF0000", [m2]: "#00FF00" });
        expect(after.nodes.inner?.fills[0]).toMatchObject({ color: "#00FF00" });
        expect(after.nodes.inner?.boundVariables).toEqual({ "fill:0": alias.id });
    });

    it("deleteVariable of a variable aliased from another collection keeps the alias's look", () => {
        const a = createCollection("Primitives");
        const b = createCollection("Semantic");
        const red = addVariable(a.id, "color", "red", "#FF0000") as Variable;
        const danger = addVariable(b.id, "color", "danger", { alias: red.id }) as Variable;
        bindVariable(["box"], "fill:0", danger.id);
        deleteVariable(a.id, red.id);
        expect(findVariable(current(), danger.id)?.variable.values[b.modes[0]?.id ?? ""]).toBe("#FF0000");
        expect(current().nodes.box?.fills[0]).toMatchObject({ color: "#FF0000" });
    });

    it("deleteCollection unbinds every variable of it", () => {
        const c = createCollection("Gone");
        const v = addVariable(c.id, "number", "w", 77) as Variable;
        bindVariable(["box"], "w", v.id);
        bindVariable(["box"], "h", v.id);
        const after = undoable(() => deleteCollection(c.id));
        expect(collectionsOf(after)).toHaveLength(0);
        expect(after.nodes.box?.boundVariables).toEqual({});
        expect(after.nodes.box).toMatchObject({ w: 77, h: 77 });
    });

    it("previewValue shows aliases resolved", () => {
        const c = createCollection("P");
        const m = c.modes[0]?.id as string;
        const t = addVariable(c.id, "number", "base", 4) as Variable;
        const a = addVariable(c.id, "number", "alias", { alias: t.id }) as Variable;
        const doc = current();
        expect(previewValue(doc, findVariable(doc, a.id)?.variable as Variable, m)).toBe("base → 4");
        expect(previewValue(doc, findVariable(doc, t.id)?.variable as Variable, m)).toBe("4");
    });
});

// Regression: deleting a variable turned aliases to it from another collection into its value in its
// own default mode, whatever mode the alias was for; extended collections kept dangling override
// aliases (and overrides of the deleted variable); deleting a group or a collection left every alias
// to its variables dangling (resolving to nothing).
describe("deleting aliased variables keeps each mode's value", () => {
    // Primitives (Light, Dark): red. Semantic (Light, Dark): danger → red. Brand extends Primitives
    // (its modes BL, BD) and overrides red in BD with an alias to Semantic's danger... and its own
    // override of red itself.
    function doc(): NagmaDocument {
        const prim = collection("prim", ["pl", "pd"], [variable("red", "color", { pl: "#FF0000", pd: "#880000" }), variable("blue", "color", { pl: "#0000FF", pd: "#000088" })]);
        prim.modes = [{ id: "pl", name: "Light" }, { id: "pd", name: "Dark" }];
        prim.variables[0]!.name = "reds/red";
        const sem = collection("sem", ["sl", "sd"], [variable("danger", "color", { sl: { alias: "red" }, sd: { alias: "red" } })]);
        sem.modes = [{ id: "sd", name: "Dark" }, { id: "sl", name: "Light" }];
        const brand = collection("brand", ["bl", "bd"], [variable("accent", "color", { bl: { alias: "red" }, bd: { alias: "red" } })], { extends: "prim", overrides: { red: { bd: "#123456" }, blue: { bd: { alias: "red" } } } });
        let d = blankDoc();
        d = addNode(d, "rect", "box", { x: 0, y: 0, w: 10, h: 10 });
        d = applyCommand(d, { type: "variables.set", variables: [prim, sem, brand] });
        return d;
    }
    const valuesOf = (d: NagmaDocument, id: string) => findVariable(d, id)?.variable.values;

    it("an alias from another collection takes the value of the mode with the same name", () => {
        openInEditor(doc());
        deleteVariable("prim", "red");
        // sem's modes are listed Dark, Light: matched by name, not position.
        expect(valuesOf(current(), "danger")).toEqual({ sl: "#FF0000", sd: "#880000" });
    });

    it("an extended collection's aliases and overrides follow the extension's modes", () => {
        openInEditor(doc());
        const before = current();
        deleteVariable("prim", "red");
        const brand = collectionsOf(current()).find((c) => c.id === "brand");
        // Its own variable's alias in BD reads red through the extension: the BD override.
        expect(valuesOf(current(), "accent")).toEqual({ bl: "#FF0000", bd: "#123456" });
        // The override of the deleted variable is gone; the override aliasing it became a literal.
        expect(brand?.overrides).toEqual({ blue: { bd: "#123456" } });
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
    });

    it("deleting a group rewrites aliases to its variables", () => {
        openInEditor(doc());
        deleteVariableGroup("prim", "reds");
        expect(findVariable(current(), "red")).toBeNull();
        expect(valuesOf(current(), "danger")).toEqual({ sl: "#FF0000", sd: "#880000" });
    });

    it("deleting a collection rewrites aliases to its variables and detaches extensions", () => {
        openInEditor(doc());
        const before = current();
        deleteCollection("prim");
        const list = collectionsOf(current());
        expect(list.map((c) => c.id)).toEqual(["sem", "brand"]);
        expect(valuesOf(current(), "danger")).toEqual({ sl: "#FF0000", sd: "#880000" });
        expect(list[1]?.extends).toBeUndefined();
        expect(list[1]?.overrides).toBeUndefined();
        for (const v of list.flatMap((c) => c.variables)) for (const val of Object.values(v.values)) expect(typeof val === "object" && val && "alias" in val).toBe(false);
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
    });

    it("deleting an unknown variable does nothing (no undo step)", () => {
        openInEditor(doc());
        const steps = editor.get().past.length;
        deleteVariable("prim", "nope");
        expect(editor.get().past.length).toBe(steps);
    });
});

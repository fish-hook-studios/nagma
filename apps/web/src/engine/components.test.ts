// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { beforeEach, describe, expect, it } from "vitest";
import { createComponent, createInstance, detachInstance, resetOverrides, setVariant, swapComponent } from "./actions";
import { applyCommand } from "./commands";
import {
    addToSlot,
    addVariantProperty,
    combineAsVariants,
    convertToSlot,
    createProp,
    deleteProp,
    instanceOverrides,
    nestedInstances,
    pushOverridesToMain,
    removeVariantProperty,
    renameVariantProperty,
    resetAllOverrides,
    resetOverrideKeys,
    resetPropValue,
    updateProp,
    variantConflicts,
} from "./component-actions";
import { assetName, findVariant, mirrorId, propValue, propsOf, setProperties, syncInstances, variantName, variantProps, moveWouldNestItself, wouldNestItself } from "./components";
import { dropLayers } from "../components/layer-drag";
import { editor } from "./store";
import type { ComponentProp, NagmaDocument, SceneNode } from "./types";
import { addNode, blankDoc, current, nodeOf, openInEditor, plain } from "../test/sys-fixtures";

// Components and instances: mirroring, overrides (record, reset, push), nested instances,
// component properties, variants, detaching, nesting guards and deleting a main component; every
// editing action undoes and redoes exactly through the editor store.

const solid = (color: string) => ({ type: "solid" as const, color, opacity: 1, visible: true, blend: "normal" as const });

// "btn": a component with a background and a label. "card": a component holding an instance of
// btn whose label reads "Buy". Instances: i1 and i2 of btn, c1 of card.
function lib(): NagmaDocument {
    let doc = blankDoc();
    doc = addNode(doc, "component", "btn", { x: 0, y: 0, w: 100, h: 40 }, undefined, { name: "Button" });
    doc = addNode(doc, "rect", "bg", { x: 0, y: 0, w: 100, h: 40 }, "btn", { name: "bg", fills: [solid("#3366FF")] });
    doc = addNode(doc, "text", "label", { x: 10, y: 10, w: 40, h: 14 }, "btn", { name: "label", text: "Label" });
    doc = addNode(doc, "component", "card", { x: 300, y: 0, w: 200, h: 200 }, undefined, { name: "Card" });
    doc = addNode(doc, "rect", "cardBg", { x: 300, y: 0, w: 200, h: 200 }, "card", { name: "cardBg", fills: [solid("#FFFFFF")] });
    doc = addNode(doc, "instance", "cardBtn", { x: 320, y: 20, w: 100, h: 40 }, "card", { componentId: "btn", fills: [], overrides: [] });
    doc = applyCommand(doc, { type: "node.update", id: "cardBtn;label", patch: { text: "Buy" } });
    doc = applyCommand(doc, { type: "node.update", id: "cardBtn", patch: { opacity: 0.9 } });
    doc = addNode(doc, "instance", "i1", { x: 0, y: 300, w: 100, h: 40 }, undefined, { componentId: "btn", fills: [], overrides: [] });
    doc = addNode(doc, "instance", "i2", { x: 200, y: 300, w: 100, h: 40 }, undefined, { componentId: "btn", fills: [], overrides: [] });
    doc = addNode(doc, "instance", "c1", { x: 600, y: 300, w: 200, h: 200 }, undefined, { componentId: "card", fills: [], overrides: [] });
    return doc;
}

const fillOf = (doc: NagmaDocument, id: string) => (nodeOf(doc, id).fills[0] as { color?: string } | undefined)?.color;

// Runs an editor action and checks undo restores the document exactly and redo brings it back.
// Selection changes are undo steps of their own in the store; they are stepped over here.
function undoable(action: () => void): NagmaDocument {
    const before = current();
    action();
    const after = current();
    expect(after).not.toBe(before);
    undoDoc();
    expect(plain(current())).toEqual(plain(before));
    redoDoc();
    expect(plain(current())).toEqual(plain(after));
    return after;
}

function undoDoc() {
    while (editor.get().past.at(-1)?.selectionOnly) editor.undo();
    editor.undo();
}

function redoDoc() {
    editor.redo();
    while (editor.get().future[0]?.selectionOnly) editor.redo();
}

describe("instances mirror their component", () => {
    const doc = lib();

    it("an instance holds a copy of each layer with derived ids", () => {
        expect(nodeOf(doc, "i1").children).toEqual([mirrorId("i1", "bg"), mirrorId("i1", "label")]);
        expect(nodeOf(doc, "i1;bg")).toMatchObject({ sourceId: "bg", parentId: "i1", x: 0, y: 300, w: 100, h: 40 });
        expect(fillOf(doc, "i1;bg")).toBe("#3366FF");
        expect(nodeOf(doc, "i1;label").text).toBe("Label");
        expect(nodeOf(doc, "i1").name).toBe("Button");
    });

    it("nested instances mirror through the outer component, with its overrides", () => {
        expect(nodeOf(doc, "c1").children).toEqual(["c1;cardBg", "c1;cardBtn"]);
        expect(nodeOf(doc, "c1;cardBtn")).toMatchObject({ type: "instance", componentId: "btn", sourceId: "cardBtn", opacity: 0.9 });
        expect(nodeOf(doc, "c1;cardBtn;label").text).toBe("Buy");
        expect(nodeOf(doc, "c1;cardBtn;bg")).toMatchObject({ x: 620, y: 320 });
        expect(nestedInstances(doc, "card").map((n) => n.id)).toEqual(["cardBtn"]);
    });

    it("edits to the main component reach every instance, nested ones included", () => {
        let next = applyCommand(doc, { type: "node.update", id: "bg", patch: { fills: [solid("#FF0000")], radius: 8 } });
        for (const id of ["i1;bg", "i2;bg", "cardBtn;bg", "c1;cardBtn;bg"]) {
            expect(fillOf(next, id)).toBe("#FF0000");
            expect(nodeOf(next, id).radius).toBe(8);
        }
        // A new layer in the main appears in its instances; a deleted one goes.
        next = addNode(next, "ellipse", "dot", { x: 80, y: 5, w: 10, h: 10 }, "btn");
        expect(nodeOf(next, "i1").children).toContain("i1;dot");
        expect(next.nodes["c1;cardBtn;dot"]).toBeDefined();
        next = applyCommand(next, { type: "node.delete", ids: ["dot"] });
        expect(next.nodes["i1;dot"]).toBeUndefined();
        expect(next.nodes["c1;cardBtn;dot"]).toBeUndefined();
    });

    it("an edit inside an instance is recorded as an override and survives main edits", () => {
        let next = applyCommand(doc, { type: "node.update", id: "i1;label", patch: { text: "Go", fontSize: 20 } });
        expect(nodeOf(next, "i1;label").overrides).toEqual(["text", "fontSize"]);
        next = applyCommand(next, { type: "node.update", id: "label", patch: { text: "Click", fills: [solid("#00FF00")] } });
        expect(nodeOf(next, "i1;label")).toMatchObject({ text: "Go", fontSize: 20 });
        expect(fillOf(next, "i1;label")).toBe("#00FF00");
        expect(nodeOf(next, "i2;label").text).toBe("Click");
        expect(instanceOverrides(next, "i1")).toEqual([
            { label: "Text content", keys: ["text"] },
            { label: "Text style", keys: ["fontSize"] },
        ]);
    });

    it("position and structure aren't overrides: they follow the main", () => {
        let next = applyCommand(doc, { type: "node.update", id: "i1;bg", patch: { x: 50, ...({ type: "ellipse" } as object) } });
        expect(nodeOf(next, "i1;bg").overrides).toEqual([]);
        next = applyCommand(next, { type: "node.update", id: "bg", patch: { opacity: 0.5 } });
        expect(nodeOf(next, "i1;bg")).toMatchObject({ x: 0, type: "rect", opacity: 0.5 });
    });

    it("the instance's own size, fill and opacity are overrides", () => {
        let next = applyCommand(doc, { type: "node.update", id: "i1", patch: { w: 150, opacity: 0.5, fills: [solid("#000000")] } });
        expect(nodeOf(next, "i1").overrides).toEqual(["w", "opacity", "fills"]);
        next = applyCommand(next, { type: "node.update", id: "btn", patch: { w: 120, opacity: 1, fills: [solid("#FFFFFF")] } });
        expect(nodeOf(next, "i1")).toMatchObject({ w: 150, opacity: 0.5 });
        expect(fillOf(next, "i1")).toBe("#000000");
        expect(nodeOf(next, "i2").w).toBe(120);
    });

    it("an unrelated edit leaves other instances' layers untouched (same objects)", () => {
        expect(syncInstances(doc, doc)).toBe(doc);
        const next = applyCommand(doc, { type: "node.update", id: "i2", patch: { opacity: 0.5 } });
        for (const id of ["c1", "c1;cardBtn", "c1;cardBtn;label", "i1", "i1;bg", "i1;label"]) expect(next.nodes[id]).toBe(doc.nodes[id]);
    });
});

describe("overrides: reset and push (editor)", () => {
    beforeEach(() => {
        openInEditor(lib());
    });

    it("resetOverrideKeys takes listed overrides off; resetAllOverrides takes them all", () => {
        editor.execute({ type: "node.update", id: "i1;label", patch: { text: "Go", fontSize: 20 } });
        editor.execute({ type: "node.update", id: "i1;bg", patch: { fills: [solid("#000000")] } });
        let after = undoable(() => resetOverrideKeys("i1", ["text"]));
        expect(nodeOf(after, "i1;label")).toMatchObject({ text: "Label", fontSize: 20, overrides: ["fontSize"] });
        expect(fillOf(after, "i1;bg")).toBe("#000000");
        after = undoable(() => resetAllOverrides(["i1"]));
        expect(nodeOf(after, "i1;label")).toMatchObject({ text: "Label", fontSize: 12 });
        expect(fillOf(after, "i1;bg")).toBe("#3366FF");
        expect(instanceOverrides(after, "i1")).toEqual([]);
    });

    it("Reset all changes on the selection (actions.resetOverrides)", () => {
        editor.execute({ type: "node.update", id: "i2;label", patch: { text: "Nope" } });
        editor.set({ selection: ["i2"] });
        const after = undoable(() => resetOverrides());
        expect(nodeOf(after, "i2;label").text).toBe("Label");
    });

    it("push overrides to main: the main takes them, every instance follows, the source is clean", () => {
        editor.execute({ type: "node.update", id: "i1;label", patch: { text: "Pushed" } });
        editor.execute({ type: "node.update", id: "i1", patch: { radius: 12 } });
        const after = undoable(() => pushOverridesToMain("i1"));
        expect(nodeOf(after, "label").text).toBe("Pushed");
        expect(nodeOf(after, "btn").radius).toBe(12);
        expect(nodeOf(after, "i2;label").text).toBe("Pushed");
        expect(nodeOf(after, "i2").radius).toBe(12);
        expect(instanceOverrides(after, "i1")).toEqual([]);
        // The card overrides its label, so it keeps "Buy".
        expect(nodeOf(after, "c1;cardBtn;label").text).toBe("Buy");
        // Nothing left to push.
        const now = current();
        pushOverridesToMain("i1");
        expect(current()).toBe(now);
    });

    it("overriding a nested instance's layer inside an outer instance", () => {
        editor.execute({ type: "node.update", id: "c1;cardBtn;label", patch: { text: "Sold out" } });
        editor.execute({ type: "node.update", id: "cardBtn;label", patch: { text: "Add" } });
        expect(nodeOf(current(), "c1;cardBtn;label").text).toBe("Sold out");
        resetOverrideKeys("c1", ["text"]);
        expect(nodeOf(current(), "c1;cardBtn;label").text).toBe("Add");
    });
});

describe("creating components and instances (editor)", () => {
    beforeEach(() => {
        openInEditor(lib());
    });

    it("a frame becomes a component in place", () => {
        editor.execute({ type: "node.create", node: { ...nodeOf(addNode(blankDoc(), "frame", "fr", { x: 900, y: 0, w: 50, h: 50 }), "fr") } });
        editor.set({ selection: ["fr"] });
        const after = undoable(() => createComponent());
        expect(nodeOf(after, "fr").type).toBe("component");
        expect(applyCommand(after, { type: "node.convert", id: "fr", to: "component" })).toBe(after);
    });

    // Regression: making a component from a shape took two undos (the wrapping frame stayed).
    it("a shape is wrapped in a new component, one undo step", () => {
        editor.execute({ type: "node.create", node: nodeOf(addNode(blankDoc(), "rect", "shape", { x: 900, y: 0, w: 30, h: 30 }, undefined, { name: "Shape" }), "shape") });
        editor.set({ selection: ["shape"] });
        const before = current();
        createComponent();
        const after = current();
        const comp = nodeOf(after, after.nodes.shape?.parentId ?? "");
        expect(comp).toMatchObject({ type: "component", name: "Shape", fills: [] });
        undoDoc();
        expect(plain(current())).toEqual(plain(before));
        redoDoc();
        expect(plain(current())).toEqual(plain(after));
    });

    it("layers inside an instance can't become components", () => {
        editor.set({ selection: ["i1;bg"] });
        const before = current();
        createComponent();
        expect(current()).toBe(before);
    });

    it("createInstance places a mirrored instance next to the component", () => {
        const after = undoable(() => createInstance("btn"));
        const inst = Object.values(after.nodes).find((n) => n.type === "instance" && !n.sourceId && !["i1", "i2", "c1", "cardBtn"].includes(n.id)) as SceneNode;
        expect(inst).toMatchObject({ componentId: "btn", x: 140, y: 0, w: 100, h: 40, name: "Button" });
        expect(inst.children.map((id) => nodeOf(after, id).sourceId)).toEqual(["bg", "label"]);
        const none = current();
        createInstance("bg");
        expect(current()).toBe(none);
    });
});

describe("component properties", () => {
    beforeEach(() => {
        openInEditor(lib());
    });

    it("boolean, text and swap properties drive mirrored layers; values reset and delete", () => {
        const icon = addNode(addNode(current(), "component", "iconA", { x: 0, y: 600, w: 10, h: 10 }, undefined, { name: "Icon A" }), "component", "iconB", { x: 50, y: 600, w: 10, h: 10 }, undefined, { name: "Icon B" });
        editor.loadDocument(icon, null);
        editor.execute({ type: "node.create", node: { ...nodeOf(addNode(current(), "instance", "ic", { x: 80, y: 5, w: 10, h: 10 }, "btn", { componentId: "iconA", fills: [], overrides: [] }), "ic") } });
        let show: ComponentProp | null = null;
        let text: ComponentProp | null = null;
        let swap: ComponentProp | null = null;
        undoable(() => {
            show = createProp("btn", { name: "Show bg", kind: "boolean", defaultValue: true }, { nodeId: "bg", field: "visible" });
        });
        text = createProp("btn", { name: "Label", kind: "text", defaultValue: "Label" }, { nodeId: "label", field: "text" });
        swap = createProp("btn", { name: "Icon", kind: "swap", defaultValue: "iconA" }, { nodeId: "ic", field: "swap" });
        const [s, t, w] = [show, text, swap] as unknown as ComponentProp[];
        expect(propsOf(current(), nodeOf(current(), "btn")).map((p) => p.name)).toEqual(["Show bg", "Label", "Icon"]);
        expect(nodeOf(current(), "bg").propBindings).toEqual({ visible: s.id });

        const after = undoable(() => editor.execute({ type: "node.update", id: "i1", patch: { propValues: { [s.id]: false, [t.id]: "Hello", [w.id]: "iconB" } } }));
        expect(nodeOf(after, "i1;bg").visible).toBe(false);
        expect(nodeOf(after, "i1;label").text).toBe("Hello");
        expect(nodeOf(after, "i1;ic").componentId).toBe("iconB");
        expect(nodeOf(after, "i2;bg").visible).toBe(true);
        expect(propValue(after, s, nodeOf(after, "i1"))).toBe(false);
        expect(propValue(after, s, nodeOf(after, "i2"))).toBe(true);

        undoable(() => updateProp("btn", t.id, { defaultValue: "Default text" }));
        expect(nodeOf(current(), "i2;label").text).toBe("Default text");
        expect(nodeOf(current(), "i1;label").text).toBe("Hello");

        undoable(() => resetPropValue("i1", t.id));
        expect(nodeOf(current(), "i1;label").text).toBe("Default text");

        const gone = undoable(() => deleteProp("btn", s.id));
        expect(nodeOf(gone, "bg").propBindings).toEqual(null);
        expect(nodeOf(gone, "i1").propValues).not.toHaveProperty(s.id);
        expect(nodeOf(gone, "i1;bg").visible).toBe(true);
    });

    it("a property default can follow a boolean variable", () => {
        let doc = applyCommand(lib(), { type: "variables.set", variables: [{ id: "c", name: "c", modes: [{ id: "m", name: "m" }], variables: [{ id: "flag", name: "flag", type: "boolean", values: { m: false } }] }] });
        const prop: ComponentProp = { id: "p", name: "Show", kind: "boolean", defaultValue: true, defaultVariable: "flag" };
        doc = applyCommand(doc, { type: "node.update", id: "btn", patch: { componentProps: [prop] } });
        doc = applyCommand(doc, { type: "node.update", id: "bg", patch: { propBindings: { visible: "p" } } });
        expect(propValue(doc, prop, nodeOf(doc, "i1"))).toBe(false);
        expect(nodeOf(doc, "i1;bg").visible).toBe(false);
        // A variable of the wrong type is ignored.
        expect(propValue(doc, { ...prop, defaultVariable: "ghost" }, nodeOf(doc, "i1"))).toBe(true);
    });
});

describe("variant names", () => {
    it.each<[string, Record<string, string>]>([
        ["Size=Large, State=Hover", { Size: "Large", State: "Hover" }],
        ["Size=Large,State=Hover", { Size: "Large", State: "Hover" }],
        [" Size = Large , State = Hover ", { Size: "Large", State: "Hover" }],
        ["Label=a=b", { Label: "a=b" }],
        ["Plain name", { Variant: "Plain name" }],
        ["  Spaced  ", { Variant: "Spaced" }],
        ["Size=", { Size: "" }],
        ["=Large", {}],
        ["Size=Large, ", { Size: "Large" }],
    ])("variantProps(%j)", (name, props) => {
        expect(variantProps(name)).toEqual(props);
    });

    it("variantName joins in order and round-trips", () => {
        expect(variantName({ Size: "Large", State: "Hover" })).toBe("Size=Large, State=Hover");
        const props = { "Has icon": "true", Size: "Extra large" };
        expect(variantProps(variantName(props))).toEqual(props);
    });
});

// A set "Button" with Size × State variants.
function variantDoc(): NagmaDocument {
    let doc = blankDoc();
    doc = addNode(doc, "componentSet", "set", { x: 0, y: 0, w: 500, h: 200 }, undefined, { name: "Button" });
    const variants: [string, string, string][] = [
        ["sm", "Size=Small, State=Default", "#111111"],
        ["smh", "Size=Small, State=Hover", "#222222"],
        ["lg", "Size=Large, State=Default", "#333333"],
        ["lgh", "Size=Large, State=Hover", "#444444"],
    ];
    variants.forEach(([id, name, color], i) => {
        doc = addNode(doc, "component", id, { x: 20 + i * 110, y: 20, w: 100, h: 40 }, "set", { name });
        doc = addNode(doc, "text", `${id}-label`, { x: 30 + i * 110, y: 30, w: 40, h: 14 }, id, { name: "label", text: id, fills: [solid(color)] });
    });
    doc = addNode(doc, "instance", "inst", { x: 0, y: 400, w: 100, h: 40 }, undefined, { componentId: "sm", fills: [], overrides: [] });
    return doc;
}

describe("variants", () => {
    const doc = variantDoc();

    it("setProperties lists each property with its values in order", () => {
        expect(setProperties(doc, "set")).toEqual([
            ["Size", ["Small", "Large"]],
            ["State", ["Default", "Hover"]],
        ]);
        expect(assetName(doc, "lg")).toBe("Button");
        expect(nodeOf(doc, "inst").name).toBe("Button");
        expect(assetName(doc, "ghost")).toBe("Missing component");
    });

    it.each<[Record<string, string>, string]>([
        [{ Size: "Large", State: "Hover" }, "lgh"],
        [{ Size: "Small", State: "Default" }, "sm"],
        [{ Size: "Large" }, "lg"],
        [{ Size: "Large", State: "Nope" }, "lg"],
        [{ Nope: "x" }, "sm"],
    ])("findVariant(%j) → %s", (wanted, id) => {
        expect(findVariant(doc, "set", wanted)).toBe(id);
    });

    it("findVariant on a missing set is null", () => {
        expect(findVariant(doc, "ghost", { Size: "Large" })).toBeNull();
    });

    it("variantConflicts finds variants with the same values", () => {
        expect(variantConflicts(doc, "set")).toEqual([]);
        const dup = applyCommand(doc, { type: "node.update", id: "lgh", patch: { name: "State=Default, Size=Large" } });
        expect(variantConflicts(dup, "set")).toEqual([["lg", "lgh"]]);
    });

    it("setVariant swaps to the matching variant and keeps compatible overrides", () => {
        openInEditor(doc);
        editor.execute({ type: "node.update", id: "inst;sm-label", patch: { text: "Custom" } });
        const after = undoable(() => setVariant("inst", "Size", "Large"));
        expect(nodeOf(after, "inst").componentId).toBe("lg");
        expect(after.nodes["inst;sm-label"]).toBeUndefined();
        expect(nodeOf(after, "inst;lg-label")).toMatchObject({ text: "Custom", overrides: ["text"] });
        expect(fillOf(after, "inst;lg-label")).toBe("#333333");
        // A value no variant has keeps the closest match.
        setVariant("inst", "State", "Hover");
        expect(nodeOf(current(), "inst").componentId).toBe("lgh");
        expect(nodeOf(current(), "inst;lgh-label").text).toBe("Custom");
    });

    it("combineAsVariants builds a set named from the shared path", () => {
        let d = blankDoc();
        d = addNode(d, "component", "a", { x: 0, y: 0, w: 50, h: 50 }, undefined, { name: "Icon/Arrow/Left" });
        d = addNode(d, "component", "b", { x: 100, y: 0, w: 50, h: 50 }, undefined, { name: "Icon/Arrow/Right" });
        d = addNode(d, "component", "c", { x: 200, y: 0, w: 50, h: 50 }, undefined, { name: "Icon/Chevron/Up" });
        openInEditor(d);
        const after = undoable(() => combineAsVariants(["a", "b", "c"]));
        const set = nodeOf(after, nodeOf(after, "a").parentId ?? "");
        expect(set).toMatchObject({ type: "componentSet", name: "Icon", children: ["a", "b", "c"], x: -20, y: -20, w: 290, h: 90 });
        expect(["a", "b", "c"].map((id) => nodeOf(after, id).name)).toEqual(["Property 1=Arrow, Property 2=Left", "Property 1=Arrow, Property 2=Right", "Property 1=Chevron, Property 2=Up"]);
        expect(editor.get().selection).toEqual([set.id]);
    });

    it("combineAsVariants names plain components by their names and keeps variant names", () => {
        let d = blankDoc();
        d = addNode(d, "component", "a", { x: 0, y: 0, w: 50, h: 50 }, undefined, { name: "Card" });
        d = addNode(d, "component", "b", { x: 100, y: 0, w: 50, h: 50 }, undefined, { name: "Kind=Wide" });
        openInEditor(d);
        combineAsVariants(["a", "b"]);
        expect([nodeOf(current(), "a").name, nodeOf(current(), "b").name]).toEqual(["Property 1=Card", "Kind=Wide"]);
        // Fewer than two loose components: nothing happens.
        const now = current();
        combineAsVariants(["a"]);
        expect(current()).toBe(now);
    });

    it("add, rename and remove a variant property, each undoable", () => {
        openInEditor(doc);
        undoable(() => addVariantProperty("set", "Theme", "Light"));
        expect(nodeOf(current(), "sm").name).toBe("Size=Small, State=Default, Theme=Light");
        // Adding a property that exists changes nothing.
        const now = current();
        addVariantProperty("set", "Theme", "Dark");
        expect(current()).toBe(now);
        undoable(() => renameVariantProperty("set", "State", "Status"));
        expect(setProperties(current(), "set").map(([k]) => k)).toEqual(["Size", "Status", "Theme"]);
        undoable(() => removeVariantProperty("set", "Size"));
        expect(nodeOf(current(), "lgh").name).toBe("Status=Hover, Theme=Light");
        removeVariantProperty("set", "Status");
        removeVariantProperty("set", "Theme");
        expect(nodeOf(current(), "sm").name).toBe("Default");
    });

    it("adding a variant property to a lone component wraps it in a set", () => {
        openInEditor(lib());
        const after = undoable(() => addVariantProperty("btn", "Size", "Medium"));
        const set = nodeOf(after, nodeOf(after, "btn").parentId ?? "");
        expect(set).toMatchObject({ type: "componentSet", name: "Button", children: ["btn"] });
        expect(nodeOf(after, "btn").name).toBe("Size=Medium");
        // Its instances keep working and show the set's name.
        expect(nodeOf(after, "i1").name).toBe("Button");
        expect(nodeOf(after, "i1;label").text).toBe("Label");
    });
});

describe("detach", () => {
    beforeEach(() => {
        openInEditor(lib());
    });

    // Regression: a nested instance stretched by constraints when its outer instance was resized
    // snapped back to its component's size on detach (the stretch wasn't an override).
    it("a nested instance stretched by the outer instance's resize keeps its size after detach", () => {
        let doc = blankDoc();
        doc = addNode(doc, "component", "b", { x: 0, y: 0, w: 100, h: 40 }, undefined, { name: "B" });
        doc = addNode(doc, "rect", "b-bg", { x: 0, y: 0, w: 100, h: 40 }, "b", { constraints: { h: "left-right", v: "top-bottom" } });
        doc = addNode(doc, "component", "k", { x: 300, y: 0, w: 200, h: 200 }, undefined, { name: "K" });
        doc = addNode(doc, "instance", "kb", { x: 320, y: 20, w: 100, h: 40 }, "k", { componentId: "b", fills: [], overrides: [], constraints: { h: "left-right", v: "top" } });
        doc = addNode(doc, "instance", "ki", { x: 600, y: 300, w: 200, h: 200 }, undefined, { componentId: "k", fills: [], overrides: [] });
        openInEditor(doc);
        editor.execute({ type: "node.update", id: "ki", patch: { w: 400 } });
        expect(nodeOf(current(), "ki;kb")).toMatchObject({ w: 300 });
        expect(nodeOf(current(), "ki;kb;b-bg")).toMatchObject({ w: 300 });
        const before = current();
        editor.execute({ type: "node.convert", id: "ki", to: "frame" });
        expect(nodeOf(current(), "ki;kb")).toMatchObject({ type: "instance", x: 620, w: 300, h: 40 });
        expect(nodeOf(current(), "ki;kb;b-bg")).toMatchObject({ x: 620, w: 300, h: 40 });
        // Still an instance of b: a later edit to b reaches it, at its own size.
        editor.execute({ type: "node.update", id: "b-bg", patch: { fills: [solid("#00FF00")] } });
        expect(nodeOf(current(), "ki;kb;b-bg")).toMatchObject({ w: 300, fills: [{ color: "#00FF00" }] });
        editor.undo();
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
    });

    it("keeps the look, removes the links and remembers the main", () => {
        editor.execute({ type: "node.update", id: "i1;label", patch: { text: "Mine" } });
        editor.set({ selection: ["i1"] });
        const before = current();
        const after = undoable(() => detachInstance());
        const frame = nodeOf(after, "i1");
        expect(frame.type).toBe("frame");
        expect(frame.componentId).toBeUndefined();
        expect(frame.overrides).toBeUndefined();
        expect(frame.detachedInfo).toEqual({ componentId: "btn" });
        for (const id of frame.children) {
            expect(nodeOf(after, id).sourceId).toBeUndefined();
            expect(nodeOf(after, id).overrides).toBeUndefined();
        }
        expect(nodeOf(after, "i1;label").text).toBe("Mine");
        for (const id of ["i1;bg", "i1;label"]) {
            const { sourceId: _s, overrides: _o, ...was } = nodeOf(before, id);
            expect(plain(nodeOf(after, id))).toEqual(plain(was));
        }
        // It no longer follows the main.
        editor.execute({ type: "node.update", id: "label", patch: { text: "Changed" } });
        expect(nodeOf(current(), "i1;label").text).toBe("Mine");
        expect(nodeOf(current(), "i2;label").text).toBe("Changed");
    });

    // Regression: a nested instance lost the outer component's overrides on detach ("Buy" became "Label").
    it("a nested instance stays an instance and keeps how it looked", () => {
        editor.execute({ type: "node.update", id: "c1;cardBtn;bg", patch: { fills: [solid("#00FF00")] } });
        editor.set({ selection: ["c1"] });
        const before = current();
        const after = undoable(() => detachInstance());
        const nested = nodeOf(after, "c1;cardBtn");
        expect(nested).toMatchObject({ type: "instance", componentId: "btn", opacity: 0.9 });
        expect(nested.sourceId).toBeUndefined();
        expect(nodeOf(after, "c1;cardBtn;label").text).toBe("Buy");
        expect(fillOf(after, "c1;cardBtn;bg")).toBe("#00FF00");
        for (const id of ["c1;cardBtn;label", "c1;cardBtn;bg"]) {
            const pick = (n: SceneNode) => ({ text: n.text, fills: n.fills, x: n.x, y: n.y, w: n.w, h: n.h, visible: n.visible, opacity: n.opacity });
            expect(pick(nodeOf(after, id))).toEqual(pick(nodeOf(before, id)));
        }
        // It follows btn for what wasn't changed.
        editor.execute({ type: "node.update", id: "bg", patch: { radius: 6 } });
        expect(nodeOf(current(), "c1;cardBtn;bg").radius).toBe(6);
        expect(fillOf(current(), "c1;cardBtn;bg")).toBe("#00FF00");
        // And the card no longer reaches it.
        editor.execute({ type: "node.update", id: "cardBtn;label", patch: { text: "Order" } });
        expect(nodeOf(current(), "c1;cardBtn;label").text).toBe("Buy");
    });

    it("a swapped nested instance keeps its swap and its own overrides", () => {
        const withAlt = addNode(addNode(current(), "component", "alt", { x: 0, y: 800, w: 100, h: 40 }, undefined, { name: "Alt" }), "rect", "altBg", { x: 0, y: 800, w: 100, h: 40 }, "alt", { name: "bg", fills: [solid("#AA00AA")] });
        editor.loadDocument(withAlt, null);
        editor.execute({ type: "node.update", id: "c1;cardBtn", patch: { componentId: "alt" } });
        expect(fillOf(current(), "c1;cardBtn;altBg")).toBe("#AA00AA");
        editor.execute({ type: "node.update", id: "c1;cardBtn;altBg", patch: { radius: 9 } });
        editor.set({ selection: ["c1"] });
        const after = undoable(() => detachInstance());
        expect(nodeOf(after, "c1;cardBtn")).toMatchObject({ type: "instance", componentId: "alt" });
        expect(nodeOf(after, "c1;cardBtn").overrides ?? []).not.toContain("componentId");
        expect(nodeOf(after, "c1;cardBtn;altBg")).toMatchObject({ radius: 9, sourceId: "altBg" });
        editor.execute({ type: "node.update", id: "altBg", patch: { fills: [solid("#123123")] } });
        expect(fillOf(current(), "c1;cardBtn;altBg")).toBe("#123123");
    });

    it("converting a component back to a frame", () => {
        const after = applyCommand(lib(), { type: "node.convert", id: "card", to: "frame" });
        expect(nodeOf(after, "card").type).toBe("frame");
        expect(nodeOf(after, "card").detachedInfo).toBeUndefined();
        expect(applyCommand(after, { type: "node.convert", id: "cardBg", to: "frame" })).toBe(after);
    });
});

describe("nesting guards and deleting a main component", () => {
    it("wouldNestItself: inside the component itself or its descendants", () => {
        const doc = lib();
        expect(wouldNestItself(doc, "btn", "btn")).toBe(true);
        expect(wouldNestItself(doc, "btn", "label")).toBe(true);
        expect(wouldNestItself(doc, "btn", "card")).toBe(false);
        expect(wouldNestItself(doc, "card", "cardBg")).toBe(true);
        expect(wouldNestItself(doc, "btn", null)).toBe(false);
    });

    // Regression: a component could take an instance of a component that already contains it,
    // a cycle that grew the file on every edit.
    it("wouldNestItself: a component that (through instances) contains the destination's component", () => {
        const doc = lib();
        // card holds an instance of btn: an instance of card can't go inside btn.
        expect(wouldNestItself(doc, "card", "btn")).toBe(true);
        expect(wouldNestItself(doc, "card", "bg")).toBe(true);
        // One level further: wrap card in "page" component.
        let d = addNode(doc, "component", "screen", { x: 0, y: 1000, w: 400, h: 400 }, undefined, { name: "Screen" });
        d = addNode(d, "instance", "sc", { x: 0, y: 1000, w: 200, h: 200 }, "screen", { componentId: "card", fills: [], overrides: [] });
        expect(wouldNestItself(d, "screen", "btn")).toBe(true);
        expect(wouldNestItself(d, "screen", "card")).toBe(true);
        expect(wouldNestItself(d, "btn", "screen")).toBe(false);
    });

    // Regression: only a dragged instance itself was checked, so a frame holding an instance of card
    // could be dropped into btn (card already contains btn), and the layers panel had no check at all.
    it("moveWouldNestItself looks at every instance in the moved layers", () => {
        let doc = lib();
        doc = addNode(doc, "frame", "holder", { x: 0, y: 600, w: 300, h: 300 }, undefined, { name: "Holder" });
        doc = addNode(doc, "instance", "hc", { x: 0, y: 600, w: 200, h: 200 }, "holder", { componentId: "card", fills: [], overrides: [] });
        expect(moveWouldNestItself(doc, "holder", "btn")).toBe(true);
        expect(moveWouldNestItself(doc, "c1", "btn")).toBe(true);
        expect(moveWouldNestItself(doc, "holder", "card")).toBe(true);
        expect(moveWouldNestItself(doc, "holder", null)).toBe(false);
        expect(moveWouldNestItself(doc, "i1", "card")).toBe(false);
        expect(moveWouldNestItself(doc, "missing", "btn")).toBe(false);
    });

    it("the layers panel refuses to drop a frame holding an instance of card into btn", () => {
        let doc = lib();
        doc = addNode(doc, "frame", "holder", { x: 0, y: 600, w: 300, h: 300 }, undefined, { name: "Holder" });
        doc = addNode(doc, "instance", "hc", { x: 0, y: 600, w: 200, h: 200 }, "holder", { componentId: "card", fills: [], overrides: [] });
        openInEditor(doc);
        const before = current();
        dropLayers(["holder"], { id: "btn", position: "inside" });
        expect(current()).toBe(before);
        // A harmless drop still works.
        dropLayers(["i1"], { id: "card", position: "inside" });
        expect(nodeOf(current(), "i1").parentId).toBe("card");
    });

    // Regression: addToSlot placed any component, so card could go into a slot inside card itself.
    it("addToSlot refuses a component that would end up inside itself", () => {
        let doc = lib();
        doc = addNode(doc, "frame", "slotF", { x: 50, y: 0, w: 40, h: 40 }, "btn", { name: "Slot frame", fills: [] });
        openInEditor(doc);
        convertToSlot("slotF");
        expect(nodeOf(current(), "slotF").propBindings?.slot).toBeTruthy();
        // cardBtn (inside card) mirrors btn, so its slot sits inside card.
        expect(current().nodes["cardBtn;slotF"]).toBeTruthy();
        const before = current();
        addToSlot("cardBtn;slotF", "card");
        expect(current()).toBe(before);
        // Another component is fine.
        addToSlot("i1;slotF", "card");
        expect(nodeOf(current(), "i1;slotF").children.some((c) => current().nodes[c]?.componentId === "card")).toBe(true);
    });

    it("swapComponent refuses a swap that would nest a component in itself", () => {
        openInEditor(lib());
        const before = current();
        swapComponent("cardBtn", "card");
        expect(current()).toBe(before);
    });

    it("deleting the main component leaves instances as they were, and undo brings it back", () => {
        openInEditor(lib());
        const before = current();
        editor.execute({ type: "node.delete", ids: ["btn"] });
        const after = current();
        expect(after.nodes.btn).toBeUndefined();
        expect(nodeOf(after, "i1").children).toEqual(["i1;bg", "i1;label"]);
        expect(nodeOf(after, "i1;label").text).toBe("Label");
        expect(nodeOf(after, "c1;cardBtn;label").text).toBe("Buy");
        expect(assetName(after, "btn")).toBe("Missing component");
        // Editing the orphaned instance still works.
        editor.execute({ type: "node.update", id: "i1;label", patch: { text: "Still here" } });
        expect(nodeOf(current(), "i1;label").text).toBe("Still here");
        editor.undo();
        editor.undo();
        expect(plain(current())).toEqual(plain(before));
        editor.execute({ type: "node.update", id: "label", patch: { text: "Back" } });
        expect(nodeOf(current(), "i1;label").text).toBe("Back");
    });
});

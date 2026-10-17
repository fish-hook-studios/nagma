import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { DEFAULT_OVERLAY, DEFAULT_TRANSITION, actionsOf } from "./prototype";
import {
    animationTime,
    changeTarget,
    displayDoc,
    initialState,
    revertTo,
    runActions,
    runInteraction,
    scrollerOf,
    variableValue,
    type PlayerState,
    type RunContext,
} from "./prototype-runtime";
import type { Interaction, NagmaDocument, OverlaySettings, PrototypeAction, Transition } from "./types";
import { addNode, blankDoc, collection, nodeOf, variable } from "../test/sys-fixtures";

// The prototype player's state machine: navigation, overlays, variables, conditionals, variants,
// scrolling and media, the way back for hover and press, and the document the player draws.

const slide: Transition = { type: "slide-in", direction: "left", duration: 400, easing: "ease-out" };

function protoDoc(): NagmaDocument {
    let doc = blankDoc();
    doc = addNode(doc, "frame", "A", { x: 0, y: 0, w: 300, h: 600 }, undefined, { overflow: "vertical" });
    doc = addNode(doc, "rect", "btn", { x: 10, y: 10, w: 50, h: 20 }, "A");
    doc = addNode(doc, "rect", "far", { x: 10, y: 1500, w: 50, h: 20 }, "A");
    doc = addNode(doc, "frame", "list", { x: 0, y: 100, w: 300, h: 200 }, "A", { overflow: "horizontal" });
    doc = addNode(doc, "rect", "item", { x: 900, y: 120, w: 50, h: 50 }, "list");
    doc = addNode(doc, "frame", "B", { x: 400, y: 0, w: 300, h: 600 });
    doc = addNode(doc, "frame", "C", { x: 800, y: 0, w: 300, h: 600 });
    doc = addNode(doc, "frame", "O", { x: 1200, y: 0, w: 200, h: 100 });
    doc = addNode(doc, "frame", "O2", { x: 1500, y: 0, w: 200, h: 100 });
    doc = addNode(doc, "frame", "S", { x: 0, y: 1000, w: 800, h: 800 }, undefined, { isSection: true });
    doc = addNode(doc, "frame", "D", { x: 50, y: 1050, w: 300, h: 600 }, "S");
    // A variant set (State=Off / State=On) and an instance of Off on screen A.
    doc = addNode(doc, "componentSet", "set", { x: 2000, y: 0, w: 300, h: 100 }, undefined, { name: "Toggle" });
    doc = addNode(doc, "component", "off", { x: 2020, y: 20, w: 60, h: 30 }, "set", { name: "State=Off" });
    doc = addNode(doc, "rect", "offKnob", { x: 2020, y: 20, w: 30, h: 30 }, "off", { fills: [{ type: "solid", color: "#888888", opacity: 1, visible: true, blend: "normal" }] });
    doc = addNode(doc, "component", "on", { x: 2120, y: 20, w: 60, h: 30 }, "set", { name: "State=On" });
    doc = addNode(doc, "rect", "onKnob", { x: 2150, y: 20, w: 30, h: 30 }, "on", { fills: [{ type: "solid", color: "#00AA00", opacity: 1, visible: true, blend: "normal" }] });
    doc = addNode(doc, "instance", "toggle", { x: 100, y: 400, w: 60, h: 30 }, "A", { componentId: "off", fills: [], overrides: [] });
    doc = applyCommand(doc, {
        type: "variables.set",
        variables: [
            collection("vars", ["m"], [variable("count", "number", { m: 1 }), variable("name", "string", { m: "Ada" }), variable("on", "boolean", { m: false }), variable("tint", "color", { m: "#FF0000" })]),
            collection("theme", ["light", "dark"], [variable("bg", "color", { light: "#FFFFFF", dark: "#000000" })], { name: "Theme" }),
        ],
    });
    // The button's fill follows "tint"; screen B's fill follows the theme.
    doc = applyCommand(doc, { type: "node.update", id: "btn", patch: { boundVariables: { "fill:0": "tint" } } });
    doc = applyCommand(doc, { type: "node.update", id: "B", patch: { boundVariables: { "fill:0": "bg" } } });
    return doc;
}

const doc = protoDoc();
const ctx = (source: string | null = "btn", extra: Partial<RunContext> = {}): RunContext => ({ doc, source, now: 1000, ...extra });
const run = (state: PlayerState, actions: PrototypeAction[], c: RunContext = ctx()) => runActions(state, actions, c);
const nav = (target: string | null, transition: Transition = slide): PrototypeAction => ({ type: "navigate", target, transition });

describe("initialState", () => {
    it("starts on the screen with nothing else set", () => {
        expect(initialState("A")).toEqual({ screen: "A", overlays: [], history: [], values: {}, modes: {}, variants: {}, scroll: {}, videos: {}, animations: {} });
    });
});

describe("navigate and back", () => {
    it("navigates, recording history and the transition", () => {
        const { state, effects } = run(initialState("A"), [nav("B")]);
        expect(state.screen).toBe("B");
        expect(state.history).toEqual([{ screen: "A", overlays: [], transition: slide }]);
        expect(effects).toEqual([{ kind: "navigate", from: "A", to: "B", transition: slide, reverse: false }]);
    });

    it("a section destination opens its first frame", () => {
        expect(run(initialState("A"), [nav("S")]).state.screen).toBe("D");
    });

    it.each([null, "ghost"])("a missing destination (%s) does nothing", (target) => {
        const start = initialState("A");
        const { state, effects } = run(start, [nav(target)]);
        expect(state).toBe(start);
        expect(effects).toEqual([]);
    });

    it("an action without a transition uses the default", () => {
        expect(run(initialState("A"), [{ type: "navigate", target: "B" }]).effects[0]).toMatchObject({ transition: DEFAULT_TRANSITION });
    });

    it("back plays the way in backwards, step by step", () => {
        const there = run(initialState("A"), [nav("B"), nav("C", { ...slide, type: "push" })]).state;
        const back1 = run(there, [{ type: "back" }]);
        expect(back1.state.screen).toBe("B");
        expect(back1.effects).toEqual([{ kind: "navigate", from: "C", to: "B", transition: { ...slide, type: "push" }, reverse: true }]);
        const back2 = run(back1.state, [{ type: "back" }]);
        expect(back2.state.screen).toBe("A");
        expect(back2.state.history).toEqual([]);
        const back3 = run(back2.state, [{ type: "back" }]);
        expect(back3.state).toBe(back2.state);
        expect(back3.effects).toEqual([]);
    });

    it("back with only an overlay open closes it", () => {
        const open = run(initialState("A"), [{ type: "overlay", target: "O" }]).state;
        const { state, effects } = run(open, [{ type: "back" }]);
        expect(state.overlays).toEqual([]);
        expect(state.screen).toBe("A");
        expect(effects[0]?.kind).toBe("overlay-close");
    });

    it("navigating from an overlay closes it and back restores it", () => {
        const open = run(initialState("A"), [{ type: "overlay", target: "O" }]).state;
        const moved = run(open, [nav("B")]).state;
        expect(moved.overlays).toEqual([]);
        const back = run(moved, [{ type: "back" }]).state;
        expect(back.screen).toBe("A");
        expect(back.overlays.map((o) => o.id)).toEqual(["O"]);
    });

    it("arriving resets the destination's scroll unless told to keep it", () => {
        let state: PlayerState = { ...initialState("A"), scroll: { A: { x: 0, y: 300 }, list: { x: 50, y: 0 }, B: { x: 0, y: 10 } } };
        state = run(state, [nav("B")]).state;
        expect(state.scroll).toEqual({ A: { x: 0, y: 300 }, list: { x: 50, y: 0 } });
        state = run(state, [{ type: "back", resetScroll: false }]).state;
        expect(state.scroll.A).toEqual({ x: 0, y: 300 });
        state = run(state, [nav("B"), { type: "back" }]).state;
        expect(state.scroll).toEqual({});
    });
});

describe("overlays", () => {
    const settings: OverlaySettings = { ...DEFAULT_OVERLAY, position: "bottom-center", closeOnOutside: true };

    it("opens with the action's settings, else the default", () => {
        const a = run(initialState("A"), [{ type: "overlay", target: "O", overlay: settings, transition: slide }]);
        expect(a.state.overlays).toEqual([{ id: "O", settings, transition: slide }]);
        expect(a.effects).toEqual([{ kind: "overlay-open", entry: { id: "O", settings, transition: slide } }]);
        expect(run(initialState("A"), [{ type: "overlay", target: "O" }]).state.overlays[0]?.settings).toEqual(DEFAULT_OVERLAY);
    });

    it("stacks overlays and closes the top one", () => {
        const two = run(initialState("A"), [{ type: "overlay", target: "O" }, { type: "overlay", target: "O2" }]).state;
        expect(two.overlays.map((o) => o.id)).toEqual(["O", "O2"]);
        const one = run(two, [{ type: "close" }]);
        expect(one.state.overlays.map((o) => o.id)).toEqual(["O"]);
        expect(one.effects).toEqual([{ kind: "overlay-close", entry: two.overlays[1] }]);
        const none = run(run(one.state, [{ type: "close" }]).state, [{ type: "close" }]);
        expect(none.state.overlays).toEqual([]);
        expect(none.effects).toEqual([]);
    });

    it("swap replaces the top overlay, keeping its settings", () => {
        const open = run(initialState("A"), [{ type: "overlay", target: "O", overlay: settings }]).state;
        const { state, effects } = run(open, [{ type: "swap", target: "O2", transition: slide }]);
        expect(state.overlays).toEqual([{ id: "O2", settings, transition: slide }]);
        expect(effects.map((e) => e.kind)).toEqual(["overlay-close", "overlay-open"]);
        // The old overlay leaves with a dissolve while the new one arrives.
        expect(effects[0]).toMatchObject({ entry: { id: "O", transition: { type: "dissolve" } } });
    });

    it("swap with no overlay open swaps the screen without history", () => {
        const { state, effects } = run(initialState("A"), [{ type: "swap", target: "B" }]);
        expect(state.screen).toBe("B");
        expect(state.history).toEqual([]);
        expect(effects[0]).toMatchObject({ kind: "navigate", from: "A", to: "B", reverse: false });
    });
});

describe("variables and conditionals", () => {
    it.each<[string, string, unknown]>([
        ["count", "{{count}} + 1", 2],
        ["count", '"7"', 7],
        ["count", '"abc"', 0],
        ["count", "{{count}} * 10 / 4", 2.5],
        ["name", '{{name}} + " Lovelace"', "Ada Lovelace"],
        ["name", "{{count}} + 1", "2"],
        ["on", "not {{on}}", true],
        ["on", '"TRUE"', true],
        ["on", "1", true],
        ["on", "0", false],
        ["tint", "#00ff00", "#00FF00"],
    ])("set %s to %s", (variableId, expression, value) => {
        const { state } = run(initialState("A"), [{ type: "set-variable", variableId, expression }]);
        expect(state.values[variableId]).toBe(value);
    });

    it.each<[string, PrototypeAction]>([
        ["no variable", { type: "set-variable", expression: "1" }],
        ["no expression", { type: "set-variable", variableId: "count" }],
        ["a broken expression", { type: "set-variable", variableId: "count", expression: "1 +" }],
        ["a missing reference", { type: "set-variable", variableId: "count", expression: "{{ghost}}" }],
    ])("set variable with %s does nothing", (_label, action) => {
        const start = initialState("A");
        expect(run(start, [action]).state).toBe(start);
    });

    it("later actions see earlier ones: increment twice, then branch on the value", () => {
        const inc: PrototypeAction = { type: "set-variable", variableId: "count", expression: "{{count}} + 1" };
        const branch: PrototypeAction = {
            type: "conditional",
            blocks: [
                { condition: "{{count}} >= 5", actions: [nav("C")] },
                { condition: "{{count}} == 3", actions: [nav("B")] },
                { condition: null, actions: [{ type: "overlay", target: "O" }] },
            ],
        };
        expect(run(initialState("A"), [inc, inc, branch]).state.screen).toBe("B");
        expect(run(initialState("A"), [inc, branch]).state.overlays.map((o) => o.id)).toEqual(["O"]);
        expect(run({ ...initialState("A"), values: { count: 10 } }, [branch]).state.screen).toBe("C");
    });

    it("only the first matching block runs, and no match runs nothing", () => {
        const both: PrototypeAction = {
            type: "conditional",
            blocks: [
                { condition: "true", actions: [{ type: "set-variable", variableId: "name", expression: '"first"' }] },
                { condition: "true", actions: [{ type: "set-variable", variableId: "name", expression: '"second"' }] },
            ],
        };
        expect(run(initialState("A"), [both]).state.values.name).toBe("first");
        const none: PrototypeAction = { type: "conditional", blocks: [{ condition: "false", actions: [nav("B")] }, { condition: "{{ghost}} == 1", actions: [nav("C")] }] };
        const start = initialState("A");
        expect(run(start, [none]).state).toBe(start);
        expect(run(start, [{ type: "conditional" }]).state).toBe(start);
    });

    it("conditionals nest", () => {
        const inner: PrototypeAction = { type: "conditional", blocks: [{ condition: "{{on}}", actions: [nav("C")] }, { condition: null, actions: [nav("B")] }] };
        const outer: PrototypeAction = { type: "conditional", blocks: [{ condition: "{{count}} == 1", actions: [inner] }] };
        expect(run(initialState("A"), [outer]).state.screen).toBe("B");
        expect(run({ ...initialState("A"), values: { on: true } }, [outer]).state.screen).toBe("C");
    });

    it("set mode, and VAR_MODE_LOOKUP reads it by collection name or id", () => {
        const start = initialState("A");
        expect(variableValue(doc, start, "mode:Theme")).toBe("light");
        expect(variableValue(doc, start, "mode:theme")).toBe("light");
        const { state } = run(start, [{ type: "set-mode", collectionId: "theme", modeId: "dark" }]);
        expect(state.modes).toEqual({ theme: "dark" });
        expect(variableValue(doc, state, "mode:Theme")).toBe("dark");
        expect(variableValue(doc, state, "mode:nope")).toBeUndefined();
        const branch: PrototypeAction = { type: "conditional", blocks: [{ condition: 'VAR_MODE_LOOKUP("Theme") == "Dark"', actions: [nav("C")] }] };
        expect(run(state, [branch]).state.screen).toBe("C");
        expect(run(start, [{ type: "set-mode", collectionId: "theme" }]).state).toBe(start);
    });

    it("an older interaction with an only-if condition runs as a conditional", () => {
        const legacy: Interaction = { trigger: "click", delay: 0, action: "navigate", target: "B", condition: { variableId: "count", op: ">", value: 0 } };
        expect(actionsOf(legacy)[0]?.type).toBe("conditional");
        expect(runInteraction(initialState("A"), legacy, ctx()).state.screen).toBe("B");
        expect(runInteraction({ ...initialState("A"), values: { count: 0 } }, legacy, ctx()).state.screen).toBe("A");
        const setLegacy: Interaction = { trigger: "click", delay: 0, action: "set-variable", variableId: "name", value: 'say "hi"\nbye' };
        expect(runInteraction(initialState("A"), setLegacy, ctx()).state.values.name).toBe('say "hi"\nbye');
    });
});

describe("change to (variants)", () => {
    it("finds the instance from a layer inside it and records the variant", () => {
        const start = initialState("A");
        expect(changeTarget(doc, start, "toggle;offKnob", "on")).toBe("toggle");
        expect(changeTarget(doc, start, "btn", "on")).toBeNull();
        const { state, effects } = run(start, [{ type: "change-to", target: "on", transition: slide }], ctx("toggle;offKnob"));
        expect(state.variants).toEqual({ toggle: "on" });
        expect(effects).toEqual([{ kind: "change", transition: slide, before: start, instance: "toggle" }]);
        // Toggling back: the instance now shows "on", so it's still the target.
        const back = run(state, [{ type: "change-to", target: "off" }], ctx("toggle"));
        expect(back.state.variants).toEqual({ toggle: "off" });
    });

    it("does nothing without a source or a matching instance", () => {
        const start = initialState("A");
        expect(run(start, [{ type: "change-to", target: "on" }], ctx(null)).state).toBe(start);
        expect(run(start, [{ type: "change-to", target: "on" }], ctx("btn")).state).toBe(start);
        expect(run(start, [{ type: "change-to" }], ctx("toggle")).state).toBe(start);
    });

    it("displayDoc draws the instance as the chosen variant", () => {
        const shown = displayDoc(doc, { values: {}, modes: {}, variants: { toggle: "on" } });
        expect(shown.nodes.toggle?.componentId).toBe("on");
        expect(shown.nodes["toggle;onKnob"]?.fills[0]).toMatchObject({ color: "#00AA00" });
        expect(shown.nodes["toggle;offKnob"]).toBeUndefined();
        // The edited file is untouched.
        expect(doc.nodes.toggle?.componentId).toBe("off");
    });

    it("resetState on arrival puts the destination's variants back", () => {
        const changed: PlayerState = { ...initialState("B"), variants: { toggle: "on" } };
        expect(run(changed, [{ type: "navigate", target: "A", resetState: true }]).state.variants).toEqual({});
        expect(run(changed, [{ type: "navigate", target: "A" }]).state.variants).toEqual({ toggle: "on" });
    });
});

describe("displayDoc", () => {
    it("returns the file itself with no runtime state", () => {
        expect(displayDoc(doc, initialState("A"))).toBe(doc);
    });

    it("applies runtime variable values and modes to bound layers", () => {
        expect(nodeOf(doc, "btn").fills[0]).toMatchObject({ color: "#FF0000" });
        expect(nodeOf(doc, "B").fills[0]).toMatchObject({ color: "#FFFFFF" });
        const shown = displayDoc(doc, { values: { tint: "#0000FF" }, modes: { theme: "dark" }, variants: {} });
        expect(shown.nodes.btn?.fills[0]).toMatchObject({ color: "#0000FF" });
        expect(shown.nodes.B?.fills[0]).toMatchObject({ color: "#000000" });
    });

    it("ignores variants that point at missing layers", () => {
        expect(displayDoc(doc, { values: {}, modes: {}, variants: { ghost: "on", toggle: "missing" } })).toBe(doc);
    });
});

describe("scroll to", () => {
    it("scrolls the screen vertically to the layer, with an offset, clamped", () => {
        expect(scrollerOf(doc, "far")?.id).toBe("A");
        const { state, effects } = run(initialState("A"), [{ type: "scroll-to", target: "far", offset: { x: 0, y: 100 } }], ctx("btn", { maxScroll: () => ({ x: 0, y: 2000 }) }));
        expect(state.scroll.A).toEqual({ x: 0, y: 1400 });
        expect(effects[0]).toMatchObject({ kind: "scroll", frame: "A", from: { x: 0, y: 0 }, to: { x: 0, y: 1400 } });
        const clamped = run(initialState("A"), [{ type: "scroll-to", target: "far" }], ctx("btn", { maxScroll: () => ({ x: 0, y: 1000 }) }));
        expect(clamped.state.scroll.A).toEqual({ x: 0, y: 1000 });
        const above = run(initialState("A"), [{ type: "scroll-to", target: "btn", offset: { x: 0, y: 500 } }]);
        expect(above.state.scroll.A).toEqual({ x: 0, y: 0 });
    });

    it("a horizontal scroller scrolls only sideways", () => {
        expect(scrollerOf(doc, "item")?.id).toBe("list");
        const { state } = run(initialState("A"), [{ type: "scroll-to", target: "item" }]);
        expect(state.scroll.list).toEqual({ x: 900, y: 0 });
    });

    it("a missing target does nothing", () => {
        const start = initialState("A");
        expect(run(start, [{ type: "scroll-to", target: "ghost" }]).state).toBe(start);
    });
});

describe("links, video and animation", () => {
    it.each([
        ["example.com", "https://example.com"],
        ["  http://x.y  ", "http://x.y"],
        ["mailto:a@b.c", "mailto:a@b.c"],
    ])("open link %s", (url, expected) => {
        expect(run(initialState("A"), [{ type: "url", url, newTab: false }]).effects).toEqual([{ kind: "url", url: expected, newTab: false }]);
    });

    it("an empty link does nothing", () => {
        expect(run(initialState("A"), [{ type: "url", url: "  " }]).effects).toEqual([]);
    });

    it("video play, mute, seek and jump", () => {
        const vdoc = applyCommand(doc, { type: "node.update", id: "btn", patch: { fills: [{ type: "image", imageId: "img", scaleMode: "fill", opacity: 1, visible: true, blend: "normal", video: { id: "vid", muted: true } } as never] } });
        const c: RunContext = { doc: vdoc, source: "btn", now: 0, videoTime: () => 12 };
        let state = runActions(initialState("A"), [{ type: "video", target: "btn", video: { op: "play", seconds: 0 } }], c).state;
        expect(state.videos.vid).toMatchObject({ playing: true, muted: true });
        state = runActions(state, [{ type: "video", target: "btn", video: { op: "toggle-mute", seconds: 0 } }], c).state;
        expect(state.videos.vid?.muted).toBe(false);
        state = runActions(state, [{ type: "video", target: "btn", video: { op: "jump", seconds: -20 } }], c).state;
        expect(state.videos.vid).toMatchObject({ seek: 0, token: 1 });
        state = runActions(state, [{ type: "video", target: "btn", video: { op: "seek", seconds: 5 } }], c).state;
        expect(state.videos.vid).toMatchObject({ seek: 5, token: 2 });
        state = runActions(state, [{ type: "video", target: "btn", video: { op: "toggle-play", seconds: 0 } }], c).state;
        expect(state.videos.vid?.playing).toBe(false);
    });

    it("set playhead clamps to the animation and play/pause keep time", () => {
        let adoc = applyCommand(doc, { type: "node.update", id: "A", patch: { animation: { tracks: {}, duration: 1000 } } });
        adoc = applyCommand(adoc, { type: "node.update", id: "btn", patch: { animation: { tracks: { x: [{ t: 0, v: 0, easing: "linear" }, { t: 1000, v: 100, easing: "linear" }] } } } });
        const c = (now: number): RunContext => ({ doc: adoc, source: "btn", now });
        let state = runActions(initialState("A"), [{ type: "set-playhead", target: "btn", playhead: { ms: 5000, play: false } }], c(0)).state;
        expect(animationTime(adoc, state, "btn", 0)).toBe(1000);
        state = runActions(state, [{ type: "set-playhead", target: "btn", playhead: { ms: 200, play: true } }], c(0)).state;
        expect(animationTime(adoc, state, "btn", 300)).toBe(500);
        state = runActions(state, [{ type: "animation", target: "btn", animation: { op: "pause" } }], c(300)).state;
        expect(animationTime(adoc, state, "btn", 900)).toBe(500);
        state = runActions(state, [{ type: "animation", target: "btn", animation: { op: "toggle" } }], c(900)).state;
        expect(animationTime(adoc, state, "btn", 1000)).toBe(600);
        // Navigating to the screen starts its animations from the beginning.
        const arrived = runActions(initialState("B"), [nav("A")], c(50)).state;
        expect(arrived.animations.btn).toEqual({ playing: true, time: 0, since: 50 });
    });
});

describe("revertTo (while hovering / pressing)", () => {
    it("goes back to the screen it left, playing the same transition reversed", () => {
        const before = initialState("A");
        const hover = run(before, [nav("B")]);
        const { state, effects } = revertTo(hover.state, before, hover.effects);
        expect(state.screen).toBe("A");
        expect(state.history).toEqual([]);
        expect(effects).toEqual([{ kind: "navigate", from: "B", to: "A", transition: slide, reverse: true }]);
    });

    it("closes overlays the hover opened, top first", () => {
        const before = initialState("A");
        const hover = run(before, [{ type: "overlay", target: "O" }, { type: "overlay", target: "O2" }]);
        const { state, effects } = revertTo(hover.state, before, hover.effects);
        expect(state.overlays).toEqual([]);
        expect(effects.map((e) => (e.kind === "overlay-close" ? e.entry.id : e.kind))).toEqual(["O2", "O"]);
    });

    it("puts variants back and keeps variables set meanwhile", () => {
        const before = initialState("A");
        const press = run(before, [{ type: "change-to", target: "on", transition: slide }, { type: "set-variable", variableId: "count", expression: "5" }], ctx("toggle"));
        const { state, effects } = revertTo(press.state, before, press.effects);
        expect(state.variants).toEqual({});
        expect(state.values).toEqual({ count: 5 });
        expect(effects).toEqual([{ kind: "change", transition: slide, before: press.state }]);
    });

    it("nothing to revert gives no effects", () => {
        const before = initialState("A");
        expect(revertTo(before, before, []).effects).toEqual([]);
    });
});

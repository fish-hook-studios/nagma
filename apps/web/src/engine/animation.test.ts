import { describe, expect, it } from "vitest";
import {
    animatedDoc,
    animatedNode,
    applyPreset,
    baseValue,
    canMerge,
    canSplit,
    cubicBezier,
    durationOf,
    hasAnimation,
    keyframeAt,
    mergeTracks,
    moveKeyframe,
    PRESETS,
    removeKeyframe,
    removeKeys,
    retimeKeys,
    setDuration,
    setKeyEasing,
    setKeyframe,
    splitTrack,
    trackValue,
    valueAt,
} from "./animation";
import { applyCommand } from "./commands";
import { BEZIERS, bezierAt, easeTransition, SPRINGS, springAt, springDuration, transitionDuration } from "./easing-curves";
import { migrateTracks, normalizeNode } from "./nodes";
import { editor } from "./store";
import type { Animation, Command, Effect, Keyframe, NagmaDocument, SceneNode, Spring, TrackProp } from "./types";
import { addNode, blankDoc, current, nodeOf, openInEditor, plain } from "../test/sys-fixtures";

// Motion: keyframe sampling and easing curves, keyframe editing commands and their undo, presets,
// combined tracks, the animated document, and converting tracks saved under older names.

const k = (t: number, v: number | string, easing: Keyframe["easing"] = "linear", bezier?: Keyframe["bezier"]): Keyframe => (bezier ? { t, v, easing, bezier } : { t, v, easing });

describe("trackValue", () => {
    const line = [k(0, 0), k(1000, 100)];

    it.each<[string, Keyframe[], number, number | string | undefined]>([
        ["empty track", [], 500, undefined],
        ["one key, any time", [k(300, 7)], 0, 7],
        ["one key, after it", [k(300, 7)], 9000, 7],
        ["before the first key holds it", [k(200, 5), k(400, 10)], 0, 5],
        ["after the last key holds it", [k(200, 5), k(400, 10)], 1000, 10],
        ["at a key", line, 1000, 100],
        ["linear midpoint", line, 500, 50],
        ["linear quarter", line, 250, 25],
        ["hold keeps the value", [k(0, 0, "hold"), k(1000, 100)], 999, 0],
        ["hold reaches the next key", [k(0, 0, "hold"), k(1000, 100)], 1000, 100],
        ["three keys, second stretch", [k(0, 0), k(100, 10), k(300, 30)], 200, 20],
        ["negative values", [k(0, -50), k(100, 50)], 50, 0],
        ["colour midpoint", [k(0, "#000000"), k(100, "#FFFFFF")], 50, "#808080"],
        ["colour end", [k(0, "#FF0000"), k(100, "#0000FF")], 100, "#0000FF"],
        ["colour, lower case in", [k(0, "#ff0000"), k(100, "#0000ff")], 50, "#800080"],
        ["position pair", [k(0, "0,0"), k(100, "100,-50")], 50, "50,-25"],
        ["mixed kinds step at the end", [k(0, 1), k(100, "#FFFFFF")], 50, 1],
    ])("%s", (_label, track, t, expected) => {
        const v = trackValue(track, t);
        if (typeof expected === "number") expect(v).toBeCloseTo(expected, 6);
        else expect(v).toBe(expected);
    });

    it.each<[Keyframe["easing"], "below" | "above" | "equal"]>([
        ["linear", "equal"],
        ["ease-in", "below"],
        ["ease-out", "above"],
    ])("%s at the midpoint is %s the linear value", (easing, side) => {
        const v = Number(trackValue([k(0, 0, easing), k(1000, 100)], 250));
        if (side === "equal") expect(v).toBeCloseTo(25, 6);
        if (side === "below") expect(v).toBeLessThan(25);
        if (side === "above") expect(v).toBeGreaterThan(25);
    });

    it("ease-in-out is symmetric", () => {
        const track = [k(0, 0, "ease-in-out"), k(1000, 100)];
        expect(Number(trackValue(track, 500))).toBeCloseTo(50, 3);
        expect(Number(trackValue(track, 250)) + Number(trackValue(track, 750))).toBeCloseTo(100, 3);
    });

    it("a custom bezier on the key shapes its stretch", () => {
        const track = [k(0, 0, "linear", [0.9, 0, 1, 0.1]), k(1000, 100)];
        expect(Number(trackValue(track, 500))).toBeLessThan(10);
    });
});

describe("easing curves", () => {
    const valid: [string, [number, number, number, number]][] = [
        ...Object.entries(BEZIERS).filter(([name]) => !name.includes("back")) as [string, [number, number, number, number]][],
        ["steep", [0.9, 0, 0.1, 1]],
        ["flat ends", [0, 0.9, 1, 0.1]],
        ["custom", [0.17, 0.67, 0.83, 0.67]],
    ];

    it.each(valid)("bezierAt %s: 0 at 0, 1 at 1, monotonic, within [0, 1]", (_name, [x1, y1, x2, y2]) => {
        expect(bezierAt(x1, y1, x2, y2, 0)).toBe(0);
        expect(bezierAt(x1, y1, x2, y2, 1)).toBe(1);
        expect(bezierAt(x1, y1, x2, y2, -0.5)).toBe(0);
        expect(bezierAt(x1, y1, x2, y2, 1.5)).toBe(1);
        let prev = 0;
        for (let i = 1; i <= 200; i++) {
            const y = bezierAt(x1, y1, x2, y2, i / 200);
            expect(y).toBeGreaterThanOrEqual(prev - 1e-6);
            expect(y).toBeGreaterThanOrEqual(-1e-6);
            expect(y).toBeLessThanOrEqual(1 + 1e-6);
            prev = y;
        }
        // The animation module's own copy agrees.
        for (const t of [0.1, 0.33, 0.5, 0.77, 0.95]) expect(cubicBezier(x1, y1, x2, y2, t)).toBeCloseTo(bezierAt(x1, y1, x2, y2, t), 4);
    });

    it("the linear bezier is the identity", () => {
        for (const t of [0.1, 0.25, 0.5, 0.9]) expect(bezierAt(0, 0, 1, 1, t)).toBeCloseTo(t, 6);
    });

    it("back curves overshoot", () => {
        const samples = Array.from({ length: 99 }, (_, i) => bezierAt(...(BEZIERS["ease-out-back"] as [number, number, number, number]), (i + 1) / 100));
        expect(Math.max(...samples)).toBeGreaterThan(1);
    });

    const springs: [string, Spring][] = [...(Object.entries(SPRINGS) as [string, Spring][]), ["critical", { mass: 1, stiffness: 100, damping: 20 }], ["overdamped", { mass: 1, stiffness: 100, damping: 60 }], ["pushed", { mass: 1, stiffness: 200, damping: 20, initialVelocity: 5 }], ["no damping clamp", { mass: 0, stiffness: 0, damping: 0 }]];

    it.each(springs)("spring %s starts at 0 and settles near 1", (name, spring) => {
        expect(springAt(spring, 0)).toBeCloseTo(0, 6);
        const ms = springDuration(spring);
        expect(ms).toBeGreaterThanOrEqual(50);
        expect(ms).toBeLessThanOrEqual(10000);
        if (name !== "no damping clamp") {
            expect(Math.abs(1 - springAt(spring, ms / 1000))).toBeLessThan(0.002);
            expect(Math.abs(1 - springAt(spring, 10))).toBeLessThan(0.001);
        }
        expect(Number.isFinite(springAt(spring, 1))).toBe(true);
    });

    it("bouncy springs overshoot, overdamped ones don't", () => {
        const peak = (s: Spring) => Math.max(...Array.from({ length: 300 }, (_, i) => springAt(s, i / 100)));
        expect(peak(SPRINGS["spring-bouncy"] as Spring)).toBeGreaterThan(1.05);
        expect(peak({ mass: 1, stiffness: 100, damping: 60 })).toBeLessThanOrEqual(1 + 1e-9);
    });

    it.each<[Parameters<typeof easeTransition>[0], number]>([
        [{ easing: "linear" }, 0.3],
        [{ easing: "ease-in" }, 0.3],
        [{ easing: "custom-bezier" }, 0.3],
        [{ easing: "custom-bezier", bezier: [0, 0, 1, 1] }, 0.3],
        [{ easing: "spring-gentle" }, 0.3],
        [{ easing: "custom-spring" }, 0.3],
    ])("easeTransition(%j) is 0 at 0 and 1 at 1, clamped outside", (transition) => {
        expect(easeTransition(transition, 0)).toBeCloseTo(0, 6);
        expect(easeTransition(transition, 1)).toBe(1);
        expect(easeTransition(transition, -1)).toBeCloseTo(0, 6);
        expect(easeTransition(transition, 2)).toBe(1);
    });

    it("transitionDuration: instant is 0, springs work theirs out, negatives clamp", () => {
        expect(transitionDuration({ type: "instant", direction: "left", duration: 500, easing: "linear" })).toBe(0);
        expect(transitionDuration({ type: "dissolve", direction: "left", duration: 500, easing: "linear" })).toBe(500);
        expect(transitionDuration({ type: "dissolve", direction: "left", duration: -5, easing: "linear" })).toBe(0);
        expect(transitionDuration({ type: "dissolve", direction: "left", duration: 500, easing: "spring-quick" })).toBe(springDuration(SPRINGS["spring-quick"] as Spring));
    });
});

// A frame with a rectangle inside it, on a page.
function scene(): NagmaDocument {
    let doc = blankDoc();
    doc = addNode(doc, "frame", "f", { x: 0, y: 0, w: 400, h: 300 });
    doc = addNode(doc, "rect", "r", { x: 10, y: 20, w: 100, h: 50 }, "f", { opacity: 0.8, strokes: [{ type: "solid", color: "#000000", opacity: 1, visible: true, blend: "normal" }] });
    return doc;
}
const tracksOf = (n: SceneNode | undefined) => n?.animation?.tracks ?? {};
const apply = (doc: NagmaDocument, cmd: Command | null) => (cmd ? applyCommand(doc, cmd) : doc);

describe("keyframe commands", () => {
    it("the first key after 0 also records the resting value at 0", () => {
        const doc = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "x", 500, 200));
        expect(tracksOf(doc.nodes.r).x).toEqual([
            { t: 0, v: 10, easing: "ease-in-out" },
            { t: 500, v: 200, easing: "ease-in-out" },
        ]);
        const atZero = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "x", 0, 99, "linear"));
        expect(tracksOf(atZero.nodes.r).x).toEqual([{ t: 0, v: 99, easing: "linear" }]);
    });

    it("keys stay sorted and a key within 1ms is replaced, keeping its easing", () => {
        let doc = scene();
        for (const [t, v] of [[800, 3], [200, 1], [500, 2]] as const) doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "y", t, v));
        doc = apply(doc, setKeyEasing(nodeOf(doc, "r"), "y", 500, { easing: "linear" }));
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "y", 500.4, 9));
        expect(tracksOf(doc.nodes.r).y?.map((key) => [key.t, key.v, key.easing])).toEqual([
            [0, 20, "ease-in-out"],
            [200, 1, "ease-in-out"],
            [500, 9, "linear"],
            [800, 3, "ease-in-out"],
        ]);
        expect(keyframeAt(nodeOf(doc, "r"), "y", 200.5)?.v).toBe(1);
        expect(keyframeAt(nodeOf(doc, "r"), "y", 300)).toBeUndefined();
    });

    it("setKeyEasing sets a custom bezier and clears it again", () => {
        let doc = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "w", 0, 100));
        doc = apply(doc, setKeyEasing(nodeOf(doc, "r"), "w", 0, { easing: "ease-in", bezier: [0.1, 0.2, 0.3, 0.4] }));
        expect(tracksOf(doc.nodes.r).w?.[0]).toEqual({ t: 0, v: 100, easing: "ease-in", bezier: [0.1, 0.2, 0.3, 0.4] });
        doc = apply(doc, setKeyEasing(nodeOf(doc, "r"), "w", 0, { easing: "linear" }));
        expect(tracksOf(doc.nodes.r).w?.[0]).toEqual({ t: 0, v: 100, easing: "linear" });
    });

    it("removeKeyframe removes one key, and the track with its last", () => {
        let doc = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "x", 500, 200));
        doc = apply(doc, removeKeyframe(nodeOf(doc, "r"), "x", 500));
        expect(tracksOf(doc.nodes.r).x).toEqual([{ t: 0, v: 10, easing: "ease-in-out" }]);
        doc = apply(doc, removeKeyframe(nodeOf(doc, "r"), "x", 0));
        expect("x" in tracksOf(doc.nodes.r)).toBe(false);
        expect(hasAnimation(doc.nodes.r)).toBe(false);
    });

    it("moveKeyframe moves a key, replacing one it lands on", () => {
        let doc = scene();
        for (const t of [100, 200, 300]) doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", t, t));
        doc = apply(doc, moveKeyframe(nodeOf(doc, "r"), "x", 100, 250));
        expect(tracksOf(doc.nodes.r).x?.map((key) => [key.t, key.v])).toEqual([
            [0, 10],
            [200, 200],
            [250, 100],
            [300, 300],
        ]);
        doc = apply(doc, moveKeyframe(nodeOf(doc, "r"), "x", 250, 300));
        expect(tracksOf(doc.nodes.r).x?.map((key) => [key.t, key.v])).toEqual([
            [0, 10],
            [200, 200],
            [300, 100],
        ]);
    });

    // Regression: moving a keyframe that isn't there deleted the key at the destination.
    it("moveKeyframe from a time with no key changes nothing", () => {
        let doc = scene();
        for (const t of [100, 200]) doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", t, t));
        const before = tracksOf(doc.nodes.r).x;
        doc = apply(doc, moveKeyframe(nodeOf(doc, "r"), "x", 999, 200));
        expect(tracksOf(doc.nodes.r).x).toEqual(before);
        doc = apply(doc, moveKeyframe(nodeOf(doc, "r"), "y", 0, 100));
        expect("y" in tracksOf(doc.nodes.r)).toBe(false);
    });

    it("retimeKeys shifts several keys on several layers, clamps at 0 and replaces keys landed on", () => {
        let doc = scene();
        for (const t of [100, 200, 300]) doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", t, t));
        doc = apply(doc, setKeyframe(nodeOf(doc, "f"), "opacity", 400, 0.5));
        doc = apply(
            doc,
            retimeKeys(doc, [{ id: "r", prop: "x", t: 100 }, { id: "r", prop: "x", t: 200 }, { id: "f", prop: "opacity", t: 400 }], (ref) => ref.t + 100),
        );
        expect(tracksOf(doc.nodes.r).x?.map((key) => [key.t, key.v])).toEqual([
            [0, 10],
            [200, 100],
            [300, 200],
        ]);
        expect(tracksOf(doc.nodes.f).opacity?.map((key) => key.t)).toEqual([0, 500]);
        doc = apply(doc, retimeKeys(doc, [{ id: "r", prop: "x", t: 200 }], () => -40.6));
        expect(tracksOf(doc.nodes.r).x?.map((key) => [key.t, key.v])).toEqual([
            [0, 100],
            [300, 200],
        ]);
    });

    it("removeKeys removes the listed keys and drops emptied tracks", () => {
        let doc = scene();
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", 100, 1));
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "y", 100, 1));
        doc = apply(doc, removeKeys(doc, [{ id: "r", prop: "x", t: 0 }, { id: "r", prop: "x", t: 100 }, { id: "r", prop: "y", t: 100 }, { id: "ghost", prop: "x", t: 0 }]));
        expect(tracksOf(doc.nodes.r)).toEqual({ y: [{ t: 0, v: 20, easing: "ease-in-out" }] });
    });

    it("setDuration rounds and keeps at least 100ms", () => {
        expect(apply(scene(), setDuration(nodeOf(scene(), "f"), 1234.6)).nodes.f?.animation?.duration).toBe(1235);
        expect(apply(scene(), setDuration(nodeOf(scene(), "f"), 5)).nodes.f?.animation?.duration).toBe(100);
        expect(durationOf(scene(), "r")).toBe(2000);
        const timed = apply(scene(), setDuration(nodeOf(scene(), "f"), 3000));
        expect(durationOf(timed, "r")).toBe(3000);
    });

    it("each command undoes and redoes exactly through the editor", () => {
        openInEditor(scene());
        const steps: (() => Command | null)[] = [
            () => setKeyframe(nodeOf(current(), "r"), "x", 400, 300),
            () => setKeyframe(nodeOf(current(), "r"), "fill", 400, "#FF0000"),
            () => moveKeyframe(nodeOf(current(), "r"), "x", 400, 600),
            () => setKeyEasing(nodeOf(current(), "r"), "x", 0, { easing: "linear" }),
            () => retimeKeys(current(), [{ id: "r", prop: "x", t: 600 }], () => 900),
            () => applyPreset(nodeOf(current(), "f"), "pop", 0),
            () => mergeTracks(nodeOf(current(), "f"), "position"),
            () => splitTrack(nodeOf(current(), "f"), "position"),
            () => removeKeyframe(nodeOf(current(), "r"), "x", 900),
            () => removeKeys(current(), [{ id: "r", prop: "fill", t: 0 }]),
            () => setDuration(nodeOf(current(), "f"), 900),
        ];
        for (const step of steps) {
            const before = current();
            const cmd = step();
            expect(cmd).not.toBeNull();
            editor.execute(cmd as Command);
            const after = current();
            expect(after).not.toBe(before);
            editor.undo();
            expect(plain(current())).toEqual(plain(before));
            editor.redo();
            expect(plain(current())).toEqual(plain(after));
        }
    });
});

describe("presets", () => {
    const n = nodeOf(scene(), "r");
    it.each(PRESETS.map((p) => p.id))("%s keys from t to t + ms and ends at the layer's own values", (preset) => {
        const doc = apply(scene(), applyPreset(n, preset, 200, 500));
        const node = nodeOf(doc, "r");
        expect(hasAnimation(node)).toBe(true);
        for (const [prop, track] of Object.entries(tracksOf(node)) as [TrackProp, Keyframe[]][]) {
            const times = track.map((key) => key.t);
            expect(times).toContain(200);
            expect(times).toContain(700);
            if (preset !== "fade-out") expect(trackValue(track, 700)).toBe(baseValue(n, prop));
        }
        // At the end the layer looks like it did.
        const end = animatedNode(node, 700);
        if (preset === "fade-out") expect(end.opacity).toBe(0);
        else expect({ x: end.x, y: end.y, w: end.w, h: end.h, opacity: end.opacity }).toEqual({ x: n.x, y: n.y, w: n.w, h: n.h, opacity: n.opacity });
    });

    it("fade in starts transparent; slide left starts 120px to the left", () => {
        expect(animatedNode(nodeOf(apply(scene(), applyPreset(n, "fade-in", 0)), "r"), 0).opacity).toBe(0);
        expect(animatedNode(nodeOf(apply(scene(), applyPreset(n, "slide-left", 0)), "r"), 0).x).toBe(n.x - 120);
    });
});

describe("combined tracks", () => {
    it("merges x and y into Position and splits them back", () => {
        let doc = scene();
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", 500, 100));
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "y", 1000, 80));
        expect(canMerge(nodeOf(doc, "r"), "position")).toBe(true);
        const merged = apply(doc, mergeTracks(nodeOf(doc, "r"), "position"));
        const t = tracksOf(merged.nodes.r);
        expect(Object.keys(t)).toEqual(["position"]);
        expect(t.position?.map((key) => [key.t, key.v])).toEqual([
            [0, "10,20"],
            [500, "100,50"],
            [1000, "100,80"],
        ]);
        expect(canSplit(nodeOf(merged, "r"), "position")).toBe(true);
        for (const time of [0, 250, 500, 1000]) expect(valueAt(nodeOf(merged, "r"), "x", time)).toBeCloseTo(Number(valueAt(nodeOf(doc, "r"), "x", time)), 6);
        const split = apply(merged, splitTrack(nodeOf(merged, "r"), "position"));
        expect(tracksOf(split.nodes.r).x?.map((key) => key.v)).toEqual([10, 100, 100]);
        expect(tracksOf(split.nodes.r).y?.map((key) => key.v)).toEqual([20, 50, 80]);
    });

    it("keying x while Position is animated keys Position", () => {
        let doc = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "position", 500, "50,60"));
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "x", 500, 70));
        expect(tracksOf(doc.nodes.r)).toEqual({
            position: [
                { t: 0, v: "10,20", easing: "ease-in-out" },
                { t: 500, v: "70,60", easing: "ease-in-out" },
            ],
        });
    });

    it("Scale merges only equal axes; keying one axis splits it", () => {
        let doc = apply(scene(), setKeyframe(nodeOf(scene(), "r"), "scaleX", 500, 2));
        expect(canMerge(nodeOf(doc, "r"), "scale")).toBe(false);
        expect(mergeTracks(nodeOf(doc, "r"), "scale")).toBeNull();
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "scaleY", 500, 2));
        doc = apply(doc, mergeTracks(nodeOf(doc, "r"), "scale"));
        expect(Object.keys(tracksOf(doc.nodes.r))).toEqual(["scale"]);
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "scaleY", 500, 3));
        expect(Object.keys(tracksOf(doc.nodes.r)).sort()).toEqual(["scaleX", "scaleY"]);
        expect(animatedNode(nodeOf(doc, "r"), 500)).toMatchObject({ scaleX: 2, scaleY: 3 });
    });
});

describe("animatedNode and animatedDoc", () => {
    it("a layer without keys is returned as is", () => {
        const n = nodeOf(scene(), "r");
        expect(animatedNode(n, 500)).toBe(n);
        const doc = scene();
        expect(animatedDoc(doc, 500)).toBe(doc);
    });

    it("writes numbers, the first solid fill, fields and effect values", () => {
        const effects: Effect[] = [{ type: "drop-shadow", visible: true, x: 0, y: 4, blur: 8, spread: 0, color: "#000000", opacity: 0.25 }];
        const animation: Animation = {
            tracks: {
                opacity: [k(0, 0), k(100, 1)],
                fill: [k(0, "#000000"), k(100, "#FFFFFF")],
                strokeWidth: [k(0, 0), k(100, 10)],
                stroke: [k(0, "#FF0000"), k(100, "#FF0000")],
                "fx0.blur": [k(0, 0), k(100, 20)],
                "fx3.blur": [k(0, 0), k(100, 20)],
                radiusTL: [k(0, 0), k(100, 8)],
            },
        };
        const doc = applyCommand(scene(), { type: "node.update", id: "r", patch: { effects, animation } });
        const at = animatedNode(nodeOf(doc, "r"), 50);
        expect(at.opacity).toBeCloseTo(0.5, 6);
        expect(at.fills[0]).toMatchObject({ color: "#808080" });
        expect(at.strokeWidth).toBeCloseTo(5, 6);
        expect(at.strokes[0]).toMatchObject({ color: "#FF0000" });
        expect(at.effects?.[0]?.blur).toBeCloseTo(10, 6);
        expect(at.effects).toHaveLength(1);
        expect(at.radii).toEqual([4, 0, 0, 0]);
        // The stored layer is unchanged.
        expect(nodeOf(doc, "r").opacity).toBe(0.8);
    });

    it("a moving frame carries its children, whose own keys apply on top", () => {
        let doc = apply(scene(), setKeyframe(nodeOf(scene(), "f"), "x", 1000, 100));
        doc = apply(doc, setKeyframe(nodeOf(doc, "r"), "y", 1000, 120));
        const mid = animatedDoc(doc, 500);
        const fx = Number(trackValue(tracksOf(doc.nodes.f).x as Keyframe[], 500));
        expect(mid.nodes.f?.x).toBeCloseTo(fx, 6);
        expect(mid.nodes.r?.x).toBeCloseTo(10 + fx, 6);
        expect(mid.nodes.r?.y).toBeCloseTo(Number(trackValue(tracksOf(doc.nodes.r).y as Keyframe[], 500)), 6);
        const end = animatedDoc(doc, 1000);
        expect(end.nodes.f?.x).toBe(100);
        expect(end.nodes.r).toMatchObject({ x: 110, y: 120 });
        // Each layer at its own time.
        const own = animatedDoc(doc, (n) => (n.id === "f" ? 1000 : 0));
        expect(own.nodes.f?.x).toBe(100);
        expect(own.nodes.r).toMatchObject({ x: 110, y: 20 });
    });
});

describe("migrateTracks (older track names)", () => {
    const keys = [k(0, 1), k(100, 2)];
    const shadow = { x: 1, y: 2, blur: 3, color: "#000000", opacity: 0.5 };
    const glass: Effect = { type: "glass", visible: true, x: 0, y: 0, blur: 4, spread: 0, color: "#FFFFFF", opacity: 1 };
    const noise: Effect = { type: "noise", visible: true, x: 0, y: 0, blur: 0, spread: 0, color: "#000000", opacity: 0.3 };
    const legacy = (tracks: Record<string, Keyframe[]>, extra: Partial<SceneNode> = {}): SceneNode =>
        ({ ...nodeOf(scene(), "r"), shadow, blur: 6, effects: [glass, noise], animation: { tracks: tracks as Animation["tracks"] }, ...extra }) as SceneNode;

    // Effects in order: the legacy shadow (0), the legacy blur (1), then glass (2) and noise (3).
    it.each<[string, string]>([
        ["strokeTop", "borderTop"],
        ["strokeRight", "borderRight"],
        ["strokeBottom", "borderBottom"],
        ["strokeLeft", "borderLeft"],
        ["shadowX", "fx0.x"],
        ["shadowY", "fx0.y"],
        ["shadowBlur", "fx0.blur"],
        ["shadowSpread", "fx0.spread"],
        ["shadowColor", "fx0.color"],
        ["blur", "fx1.blur"],
        ["blurStart", "fx1.startBlur"],
        ["glassRefraction", "fx2.refraction"],
        ["glassDepth", "fx2.depth"],
        ["glassLightAngle", "fx2.lightAngle"],
        ["glassLightIntensity", "fx2.lightIntensity"],
        ["glassDispersion", "fx2.dispersion"],
        ["glassSplay", "fx2.splay"],
        ["noiseSizeX", "fx3.noiseSize"],
        ["noiseSizeY", "fx3.noiseSizeY"],
        ["noiseDensity", "fx3.density"],
        ["noiseOpacity", "fx3.opacity"],
        ["noiseColor2", "fx3.color2"],
    ])("%s → %s", (old, now) => {
        const out = migrateTracks(legacy({ [old]: keys, x: keys }));
        expect(out.animation?.tracks).toEqual({ [now]: keys, x: keys });
    });

    it("folds the legacy shadow and blur into effects so the indices line up", () => {
        const out = migrateTracks(legacy({ shadowX: keys, blur: keys }));
        expect(out.shadow).toBeNull();
        expect(out.blur).toBe(0);
        expect(out.effects?.map((e) => e.type)).toEqual(["drop-shadow", "layer-blur", "glass", "noise"]);
        expect(out.effects?.[0]).toMatchObject({ x: 1, y: 2, blur: 3, opacity: 0.5 });
        expect(out.effects?.[1]).toMatchObject({ blur: 6 });
        // The migrated tracks drive those effects.
        expect(animatedNode(out, 100).effects?.[0]?.x).toBe(2);
        expect(animatedNode(out, 100).effects?.[1]?.blur).toBe(2);
    });

    it("without legacy shadow and blur, indices are the effects list's", () => {
        const out = migrateTracks(legacy({ glassDepth: keys, noiseDensity: keys }, { shadow: null, blur: 0 }));
        expect(out.animation?.tracks).toEqual({ "fx0.depth": keys, "fx1.density": keys });
        expect(out.effects).toEqual([glass, noise]);
    });

    it("a legacy effect track with no such effect is dropped; side tracks don't fold effects", () => {
        const out = migrateTracks(legacy({ glassDepth: keys }, { effects: [] }));
        expect(out.animation?.tracks).toEqual({});
        const sides = migrateTracks(legacy({ strokeTop: keys }));
        expect(sides.shadow).toEqual(shadow);
        expect(sides.animation?.tracks).toEqual({ borderTop: keys });
    });

    it("a new name already present wins over its old name", () => {
        const other = [k(0, 9)];
        expect(migrateTracks(legacy({ strokeTop: keys, borderTop: other })).animation?.tracks).toEqual({ borderTop: other });
        expect(migrateTracks(legacy({ borderTop: other, strokeTop: keys })).animation?.tracks).toEqual({ borderTop: other });
    });

    it("leaves current documents alone (same object) and is idempotent", () => {
        const now = { ...nodeOf(scene(), "r"), animation: { tracks: { x: keys, "fx0.blur": keys, borderTop: keys } } } as SceneNode;
        expect(migrateTracks(now)).toBe(now);
        const plainNode = nodeOf(scene(), "r");
        expect(migrateTracks(plainNode)).toBe(plainNode);
        const once = migrateTracks(legacy({ shadowX: keys, blur: keys, glassDepth: keys, strokeLeft: keys }));
        expect(migrateTracks(once)).toBe(once);
    });

    it("runs when an older saved layer is normalized", () => {
        const saved = { id: "old", type: "rect", shadow, blur: 0, animation: { tracks: { shadowBlur: keys } } } as unknown as SceneNode;
        const out = normalizeNode(saved);
        expect(out.animation?.tracks).toEqual({ "fx0.blur": keys });
        expect(out.effects?.[0]?.type).toBe("drop-shadow");
        expect(out.shadow).toBeNull();
    });
});

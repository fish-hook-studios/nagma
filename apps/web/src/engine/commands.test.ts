import { describe, expect, it } from "vitest";
import { applyCommand, descendants, settle } from "./commands";
import { makeNode } from "./nodes";
import type { Command, NagmaDocument, VectorPath } from "./types";
import { applyPatch, diffDocs, invertPatch } from "./patch";
import { PAGE, add, box, emptyDoc, node, plain, redoOf, run, undoOf } from "../test/core-fixtures";

// A document with something of every kind: a frame with children, a group (inside the frame) with
// a nested group, text, a vector, a component with an instance, and a loose rectangle.
function richDoc(): NagmaDocument {
    let doc = emptyDoc();
    doc = add(doc, "frame", "F", { x: 0, y: 0, w: 400, h: 300 });
    doc = add(doc, "rect", "R1", { x: 10, y: 10, w: 50, h: 40 }, "F");
    doc = add(doc, "ellipse", "E1", { x: 100, y: 20, w: 30, h: 30 }, "F");
    // Groups are created with their contents in one batch (an empty group is removed at once).
    doc = applyCommand(doc, {
        type: "batch",
        commands: [
            { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, "F", { id: "G" }) },
            { type: "node.create", node: makeNode(doc, "rect", { x: 200, y: 100, w: 20, h: 20 }, "G", { id: "G1" }) },
            { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, "G", { id: "GG" }) },
            { type: "node.create", node: makeNode(doc, "rect", { x: 250, y: 150, w: 10, h: 10 }, "GG", { id: "GG1" }) },
        ],
    });
    doc = add(doc, "text", "T", { x: 500, y: 0, w: 10, h: 10 }, PAGE, { text: "Hello" });
    const path: VectorPath = { w: 10, h: 10, subpaths: [{ closed: false, points: [{ x: 0, y: 0, in: null, out: null }, { x: 10, y: 10, in: null, out: null }] }] };
    doc = add(doc, "vector", "V", { x: 600, y: 0, w: 10, h: 10 }, PAGE, { path });
    doc = add(doc, "component", "C", { x: 0, y: 400, w: 100, h: 100 });
    doc = add(doc, "rect", "C1", { x: 10, y: 410, w: 20, h: 20 }, "C");
    doc = add(doc, "instance", "I", { x: 200, y: 400, w: 100, h: 100 }, PAGE, { componentId: "C" });
    doc = add(doc, "rect", "R2", { x: 700, y: 700, w: 40, h: 40 });
    return doc;
}

const square: VectorPath = { w: 50, h: 40, subpaths: [{ closed: true, points: [{ x: 0, y: 0, in: null, out: null }, { x: 50, y: 0, in: null, out: null }, { x: 50, y: 40, in: null, out: null }, { x: 0, y: 40, in: null, out: null }] }] };

type Case = [name: string, command: (doc: NagmaDocument) => Command];

const cases: Case[] = [
    ["create top-level rect", (d) => ({ type: "node.create", node: makeNode(d, "rect", { x: 5, y: 5, w: 5, h: 5 }, PAGE, { id: "N" }) })],
    ["create inside frame at index 0", (d) => ({ type: "node.create", node: makeNode(d, "rect", { x: 5, y: 5, w: 5, h: 5 }, "F", { id: "N" }), index: 0 })],
    ["create with index past the end (clamped)", (d) => ({ type: "node.create", node: makeNode(d, "rect", { x: 5, y: 5, w: 5, h: 5 }, "F", { id: "N" }), index: 99 })],
    ["create with negative index (clamped)", (d) => ({ type: "node.create", node: makeNode(d, "rect", { x: 5, y: 5, w: 5, h: 5 }, "F", { id: "N" }), index: -4 })],
    ["create inside nested group (refits groups)", (d) => ({ type: "node.create", node: makeNode(d, "rect", { x: 300, y: 250, w: 20, h: 20 }, "GG", { id: "N" }) })],
    ["create text", (d) => ({ type: "node.create", node: makeNode(d, "text", { x: 5, y: 5, w: 5, h: 5 }, PAGE, { id: "N", text: "New text" }) })],
    ["update fills", () => ({ type: "node.update", id: "R1", patch: { fills: [{ type: "solid", color: "#FF0000", opacity: 0.5, visible: true, blend: "normal" }] } })],
    ["update adds an optional field", () => ({ type: "node.update", id: "R1", patch: { radii: [1, 2, 3, 4], cornerSmoothing: 0.6 } })],
    ["update removes an optional field (undefined)", () => ({ type: "node.update", id: "T", patch: { fontWeight: undefined } })],
    ["update size of frame (constraints)", () => ({ type: "node.update", id: "F", patch: { w: 600, h: 500 } })],
    ["update frame ignoring constraints", () => ({ type: "node.update", id: "F", patch: { w: 600 }, ignoreConstraints: true })],
    ["update child of group moves the group box", () => ({ type: "node.update", id: "GG1", patch: { x: 380, y: 280 } })],
    ["update text content (re-measured)", () => ({ type: "node.update", id: "T", patch: { text: "A much longer line of text" } })],
    ["update component (instance follows)", () => ({ type: "node.update", id: "C1", patch: { fills: [{ type: "solid", color: "#00FF00", opacity: 1, visible: true, blend: "normal" }] } })],
    ["update instance (override recorded)", () => ({ type: "node.update", id: "I", patch: { opacity: 0.4 } })],
    ["update missing node is a no-op", () => ({ type: "node.update", id: "nope", patch: { x: 1 } })],
    ["delete a leaf", () => ({ type: "node.delete", ids: ["R1"] })],
    ["delete a frame subtree", () => ({ type: "node.delete", ids: ["F"] })],
    ["delete the last child of a nested group (empty group removed)", () => ({ type: "node.delete", ids: ["GG1"] })],
    ["delete every child of a group (both groups removed)", () => ({ type: "node.delete", ids: ["G1", "GG1"] })],
    ["delete parent and child together", () => ({ type: "node.delete", ids: ["G", "G1"] })],
    ["delete component (instance keeps its copy)", () => ({ type: "node.delete", ids: ["C"] })],
    ["delete unknown ids", () => ({ type: "node.delete", ids: ["x", "y"] })],
    ["move one layer", () => ({ type: "node.move", ids: ["R2"], dx: 13, dy: -7 })],
    ["move a frame with its subtree", () => ({ type: "node.move", ids: ["F"], dx: 5, dy: 5 })],
    ["move a frame and its child (child moved once)", () => ({ type: "node.move", ids: ["F", "R1"], dx: 5, dy: 0 })],
    ["move a group", () => ({ type: "node.move", ids: ["G"], dx: -20, dy: 30 })],
    ["reparent into frame", () => ({ type: "node.reparent", id: "R2", parentId: "F" })],
    ["reparent to index 0", () => ({ type: "node.reparent", id: "R2", parentId: "F", index: 0 })],
    ["reparent out of group (group shrinks)", () => ({ type: "node.reparent", id: "G1", parentId: "F" })],
    ["reparent last child out of group (group removed)", () => ({ type: "node.reparent", id: "GG1", parentId: PAGE })],
    ["reorder within parent", () => ({ type: "node.reparent", id: "R1", parentId: "F", index: 2 })],
    ["reparent with huge index", () => ({ type: "node.reparent", id: "R2", parentId: "F", index: 1000 })],
    ["convert frame to component", () => ({ type: "node.convert", id: "F", to: "component" })],
    ["convert component to frame", () => ({ type: "node.convert", id: "C", to: "frame" })],
    ["detach instance", () => ({ type: "node.convert", id: "I", to: "frame" })],
    ["convert rect to vector", () => ({ type: "node.convert", id: "R1", to: "vector", path: square })],
    ["convert ellipse to vector", () => ({ type: "node.convert", id: "E1", to: "vector", path: square })],
    ["rename document", () => ({ type: "doc.rename", name: "Renamed <&>" })],
    ["document settings", () => ({ type: "doc.settings", patch: { colorProfile: "p3", pluginData: { "p:k": "v" }, relaunchData: { p: { open: "Open" } } } })],
    ["sequence", () => ({ type: "sequence.set", sequence: { width: 1920, height: 1080, fps: 30, clips: [{ id: "c1", kind: "frame", name: "Intro", frame: "F", duration: 2 }] } })],
    ["styles", () => ({ type: "styles.set", styles: { colors: [{ id: "s1", name: "Brand", paint: { type: "solid", color: "#123456", opacity: 1, visible: true, blend: "normal" } }], texts: [] } })],
    ["prototype", () => ({ type: "prototype.set", prototype: { scaling: "width", background: "#000000", device: { id: "iphone-15" } } })],
    ["variables", () => ({ type: "variables.set", variables: [{ id: "col", name: "Theme", modes: [{ id: "m1", name: "Light" }], variables: [{ id: "v1", name: "bg", type: "color", values: { m1: "#ffffff" } }] }] })],
    [
        "batch of mixed commands",
        (d) => ({
            type: "batch",
            commands: [
                { type: "node.create", node: makeNode(d, "rect", { x: 1, y: 1, w: 9, h: 9 }, "F", { id: "B1" }) },
                { type: "node.create", node: makeNode(d, "ellipse", { x: 2, y: 2, w: 9, h: 9 }, "F", { id: "B2" }) },
                { type: "node.update", id: "B1", patch: { name: "Batched" } },
                { type: "node.move", ids: ["B2"], dx: 3, dy: 3 },
                { type: "node.delete", ids: ["R2"] },
                { type: "doc.rename", name: "Batched doc" },
            ],
        }),
    ],
    ["empty batch", () => ({ type: "batch", commands: [] })],
    ["turn on auto layout (children restacked)", () => ({ type: "node.update", id: "F", patch: { layout: { direction: "horizontal", gap: 8, padding: [10, 10, 10, 10], primary: "start", counter: "center" }, sizing: { h: "hug", v: "hug" } } })],
    ["rotate a grouped layer (group refits)", () => ({ type: "node.update", id: "G1", patch: { rotation: 45 } })],
    ["flip a frame", () => ({ type: "node.update", id: "F", patch: { flipX: true, rotation: 30 } })],
    ["constraints then resize", (d) => ({ type: "batch", commands: [{ type: "node.update", id: "R1", patch: { constraints: { h: "scale", v: "bottom" } } }, { type: "node.update", id: "F", patch: { w: d.nodes.F!.w * 2, h: 100 } }] })],
    ["create a second page", (d) => ({ type: "node.create", node: makeNode(d, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: "P2", name: "Page 2" }) })],
    ["delete the page", () => ({ type: "node.delete", ids: [PAGE] })],
    ["reparent a layer to the root list", () => ({ type: "node.reparent", id: "R2", parentId: null })],
    ["reorder pages", (d) => ({ type: "batch", commands: [{ type: "node.create", node: makeNode(d, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: "P2" }) }, { type: "node.reparent", id: "P2", parentId: null, index: 0 }] })],
];

describe("commands: apply, undo and redo through patches", () => {
    it.each(cases)("%s", (_name, make) => {
        const before = richDoc();
        const after = applyCommand(before, make(before));
        expect(plain(undoOf(before, after))).toEqual(plain(before));
        expect(plain(redoOf(before, after))).toEqual(plain(after));
        // Undo then redo comes back to the edit.
        expect(plain(redoOf(before, after, undoOf(before, after)))).toEqual(plain(after));
    });

    it("never mutates the input document", () => {
        const before = richDoc();
        const snapshot = plain(before);
        for (const [, make] of cases) applyCommand(before, make(before));
        expect(plain(before)).toEqual(snapshot);
    });
});

describe("commands: semantics", () => {
    it("creates at the clamped index", () => {
        const d = richDoc();
        const n = makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, "F", { id: "N" });
        expect(node(applyCommand(d, { type: "node.create", node: n, index: 0 }), "F").children[0]).toBe("N");
        expect(node(applyCommand(d, { type: "node.create", node: n, index: 99 }), "F").children.at(-1)).toBe("N");
        expect(node(applyCommand(d, { type: "node.create", node: n, index: -3 }), "F").children[0]).toBe("N");
    });

    it("ignores a create whose id exists or whose parent is missing", () => {
        const d = richDoc();
        expect(applyCommand(d, { type: "node.create", node: makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, PAGE, { id: "R1" }) })).toBe(d);
        expect(applyCommand(d, { type: "node.create", node: makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, "ghost", { id: "N" }) })).toBe(d);
    });

    it("batch creates skip duplicates and orphans like single creates", () => {
        const d = richDoc();
        const a = makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, "F", { id: "N1" });
        const after = applyCommand(d, {
            type: "batch",
            commands: [
                { type: "node.create", node: a },
                { type: "node.create", node: { ...a, name: "dupe" } },
                { type: "node.create", node: makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, "ghost", { id: "N2" }) },
                { type: "node.create", node: makeNode(d, "rect", { x: 0, y: 0, w: 5, h: 5 }, "N1", { id: "N3" }), index: 0 },
            ],
        });
        expect(node(after, "N1").name).not.toBe("dupe");
        expect(after.nodes.N2).toBeUndefined();
        expect(node(after, "N1").children).toEqual(["N3"]);
        expect(node(after, "F").children.filter((id) => id === "N1")).toHaveLength(1);
    });

    it("refits groups to their children after edits", () => {
        const d = richDoc();
        expect(box(d, "GG")).toEqual({ x: 250, y: 150, w: 10, h: 10 });
        expect(box(d, "G")).toEqual({ x: 200, y: 100, w: 60, h: 60 });
        const moved = applyCommand(d, { type: "node.update", id: "GG1", patch: { x: 300, y: 200 } });
        expect(box(moved, "GG")).toEqual({ x: 300, y: 200, w: 10, h: 10 });
        expect(box(moved, "G")).toEqual({ x: 200, y: 100, w: 110, h: 110 });
    });

    it("removes groups left empty, nested ones first", () => {
        const d = richDoc();
        const one = applyCommand(d, { type: "node.delete", ids: ["GG1"] });
        expect(one.nodes.GG).toBeUndefined();
        expect(node(one, "G").children).toEqual(["G1"]);
        const both = applyCommand(d, { type: "node.delete", ids: ["G1", "GG1"] });
        expect(both.nodes.G).toBeUndefined();
        expect(node(both, "F").children).toEqual(["R1", "E1"]);
    });

    it("deletes whole subtrees", () => {
        const d = richDoc();
        const sub = [ "F", ...descendants(d, "F")];
        const after = applyCommand(d, { type: "node.delete", ids: ["F"] });
        for (const id of sub) expect(after.nodes[id]).toBeUndefined();
        expect(node(after, PAGE).children).not.toContain("F");
    });

    it("refuses reparent cycles", () => {
        const d = richDoc();
        expect(applyCommand(d, { type: "node.reparent", id: "F", parentId: "F" })).toBe(d);
        expect(applyCommand(d, { type: "node.reparent", id: "F", parentId: "R1" })).toBe(d);
        expect(applyCommand(d, { type: "node.reparent", id: "G", parentId: "GG" })).toBe(d);
        expect(applyCommand(d, { type: "node.reparent", id: "R1", parentId: "ghost" })).toBe(d);
        expect(applyCommand(d, { type: "node.reparent", id: "ghost", parentId: "F" })).toBe(d);
    });

    it("reparent keeps one entry in the new parent and none in the old", () => {
        const d = richDoc();
        const after = applyCommand(d, { type: "node.reparent", id: "R2", parentId: "F", index: 1 });
        expect(node(after, "F").children).toEqual(["R1", "R2", "E1", "G"]);
        expect(node(after, PAGE).children).not.toContain("R2");
        expect(node(after, "R2").parentId).toBe("F");
    });

    it("moves descendants once even when listed with their ancestor", () => {
        const d = richDoc();
        const after = applyCommand(d, { type: "node.move", ids: ["F", "R1", "G"], dx: 10, dy: 0 });
        expect(node(after, "R1").x).toBe(20);
        expect(node(after, "GG1").x).toBe(260);
        expect(node(after, "F").x).toBe(10);
    });

    it("converts only valid shapes to vectors and needs a path", () => {
        const d = richDoc();
        expect(applyCommand(d, { type: "node.convert", id: "T", to: "vector", path: square })).toBe(d);
        expect(applyCommand(d, { type: "node.convert", id: "R1", to: "vector" })).toBe(d);
        const v = node(applyCommand(d, { type: "node.convert", id: "R1", to: "vector", path: square }), "R1");
        expect(v.type).toBe("vector");
        expect(v.path).toEqual(square);
        expect(v.radius).toBe(0);
    });

    it("converts frames and components both ways, and only those", () => {
        const d = richDoc();
        expect(node(applyCommand(d, { type: "node.convert", id: "F", to: "component" }), "F").type).toBe("component");
        expect(applyCommand(d, { type: "node.convert", id: "R1", to: "component" })).toBe(d);
        expect(applyCommand(d, { type: "node.convert", id: "R1", to: "frame" })).toBe(d);
        const detached = applyCommand(d, { type: "node.convert", id: "I", to: "frame" });
        const frame = node(detached, "I");
        expect(frame.type).toBe("frame");
        expect(frame.componentId).toBeUndefined();
        expect(frame.detachedInfo).toEqual({ componentId: "C", componentKey: undefined });
        for (const id of frame.children) expect(node(detached, id).sourceId).toBeUndefined();
    });

    it("instances mirror their component's children", () => {
        const d = richDoc();
        const inst = node(d, "I");
        expect(inst.children).toHaveLength(1);
        const mirror = node(d, inst.children[0] as string);
        expect(mirror.sourceId).toBe("C1");
        expect(mirror.x).toBe(210);
    });

    it("image.add never replaces existing data; image.set only replaces", () => {
        let d = richDoc();
        d = applyCommand(d, { type: "image.add", id: "i", data: "a" });
        expect(applyCommand(d, { type: "image.add", id: "i", data: "b" })).toBe(d);
        expect(applyCommand(d, { type: "image.set", id: "missing", data: "b" })).toBe(d);
        expect(applyCommand(d, { type: "image.set", id: "i", data: "a" })).toBe(d);
        expect(applyCommand(d, { type: "image.set", id: "i", data: "b" }).images.i).toBe("b");
    });

    it("an empty batch or a no-op returns the same document", () => {
        const d = richDoc();
        expect(applyCommand(d, { type: "batch", commands: [] })).toBe(d);
        expect(applyCommand(d, { type: "node.update", id: "ghost", patch: { x: 1 } })).toBe(d);
        expect(applyCommand(d, { type: "node.delete", ids: [] })).toBe(d);
    });

    it("image.add redoes, and its undo keeps the image data (images are never removed by undo)", () => {
        const before = richDoc();
        const after = applyCommand(before, { type: "image.add", id: "img1", data: "data:image/png;base64,AAAA" });
        expect(after.images.img1).toBe("data:image/png;base64,AAAA");
        const undone = undoOf(before, after);
        expect(plain({ ...undone, images: {} })).toEqual(plain({ ...before, images: {} }));
        expect(redoOf(before, after).images.img1).toBe("data:image/png;base64,AAAA");
    });

    it("an image.set undo leaves the image (images are never removed)", () => {
        const d = applyCommand(richDoc(), { type: "image.add", id: "i", data: "a" });
        const after = applyCommand(d, { type: "image.set", id: "i", data: "b" });
        // Images are kept so other layers using them don't break; undo of the replace is not tracked.
        expect(undoOf(d, after).images.i).toBeDefined();
    });

    it("multi-step history replays in reverse back to the start", () => {
        const start = richDoc();
        const steps: NagmaDocument[] = [start];
        const commands: Command[] = [
            { type: "node.move", ids: ["G"], dx: 10, dy: 10 },
            { type: "node.reparent", id: "R2", parentId: "G" },
            { type: "node.update", id: "F", patch: { w: 800 } },
            { type: "node.delete", ids: ["E1"] },
            { type: "node.convert", id: "F", to: "component" },
            { type: "doc.rename", name: "x" },
        ];
        for (const c of commands) steps.push(applyCommand(steps.at(-1) as NagmaDocument, c));
        let current = steps.at(-1) as NagmaDocument;
        for (let i = steps.length - 1; i > 0; i--) {
            current = undoOf(steps[i - 1] as NagmaDocument, steps[i] as NagmaDocument, current);
            expect(plain(current)).toEqual(plain(steps[i - 1]));
        }
        for (let i = 1; i < steps.length; i++) {
            current = redoOf(steps[i - 1] as NagmaDocument, steps[i] as NagmaDocument, current);
            expect(plain(current)).toEqual(plain(steps[i]));
        }
    });

    it("run() helper applies in order", () => {
        const d = run(richDoc(), { type: "node.move", ids: ["R2"], dx: 1, dy: 0 }, { type: "node.move", ids: ["R2"], dx: 1, dy: 0 });
        expect(node(d, "R2").x).toBe(702);
    });
});

// Seeded random edit sequences: each step must undo and redo exactly and leave a consistent tree.
describe("commands: random edit sequences", () => {
    function rng(seed: number) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 2 ** 32;
        };
    }

    // Field-level differences between two documents, readable in a failure message.
    // Numbers are compared to 1e-6: layout re-run in another order can differ in the last bits.
    function differences(got: NagmaDocument, want: NagmaDocument): string[] {
        const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
        const a = JSON.parse(JSON.stringify(got, round)) as NagmaDocument;
        const b = JSON.parse(JSON.stringify(want, round)) as NagmaDocument;
        const out: string[] = [];
        for (const id of new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)])) {
            const x = a.nodes[id] as unknown as Record<string, unknown> | undefined;
            const y = b.nodes[id] as unknown as Record<string, unknown> | undefined;
            if (!x || !y) out.push(`${id}: ${x ? "extra" : "missing"}`);
            else for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${id} (${String(y.type)}).${k}: ${JSON.stringify(x[k])} ≠ ${JSON.stringify(y[k])}`);
        }
        for (const k of ["roots", "name", "styles", "variables", "prototype", "sequence", "images"] as const) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`doc.${k}`);
        return out;
    }

    function consistent(doc: NagmaDocument): string[] {
        const problems: string[] = [];
        for (const [id, n] of Object.entries(doc.nodes)) {
            if (n.parentId) {
                const p = doc.nodes[n.parentId];
                if (!p) problems.push(`${id}: parent ${n.parentId} missing`);
                else if (p.children.filter((c) => c === id).length !== 1) problems.push(`${id}: listed ${p.children.filter((c) => c === id).length} times by ${n.parentId}`);
            } else if (!doc.roots.includes(id)) problems.push(`${id}: no parent and not a root`);
            for (const c of n.children) if (doc.nodes[c]?.parentId !== id) problems.push(`${id}: child ${c} points elsewhere`);
            for (const k of ["x", "y", "w", "h"] as const) if (!Number.isFinite(n[k])) problems.push(`${id}: ${k} = ${n[k]}`);
            if ((n.type === "group" || n.type === "boolean") && n.children.length === 0) problems.push(`${id}: empty ${n.type}`);
        }
        return problems;
    }

    function randomCommand(doc: NagmaDocument, r: () => number, step: number): Command {
        // Layers inside instances are rebuilt from their component (the editor refuses structural
        // edits there), so the random edits leave them alone.
        const ids = Object.keys(doc.nodes).filter((id) => doc.nodes[id]?.type !== "page" && !doc.nodes[id]?.sourceId);
        const pick = <T,>(list: T[]): T => list[Math.floor(r() * list.length)] as T;
        const containers = [PAGE, ...ids.filter((id) => ["frame", "component", "group"].includes(doc.nodes[id]?.type ?? ""))];
        const some = () => ids.filter(() => r() < 0.2);
        const kind = Math.floor(r() * 9);
        const target = ids.length ? pick(ids) : null;
        if (kind === 0 || !target) {
            const type = pick(["rect", "ellipse", "frame", "text"] as const);
            const node = makeNode(doc, type, { x: r() * 500, y: r() * 500, w: 5 + r() * 100, h: 5 + r() * 100 }, pick(containers), { id: `n${step}`, ...(type === "text" ? { text: "word ".repeat(1 + Math.floor(r() * 5)) } : {}) });
            return { type: "node.create", node, index: r() < 0.5 ? undefined : Math.floor(r() * 6) - 1 };
        }
        if (kind === 1) return { type: "node.update", id: target, patch: { x: r() * 500, y: r() * 500, w: 1 + r() * 300, h: 1 + r() * 300 } };
        // Groups have no rotation of their own (turning one turns its layers), so only other layers turn.
        if (kind === 2) return { type: "node.update", id: target, patch: { ...(doc.nodes[target]?.type === "group" || doc.nodes[target]?.type === "boolean" ? {} : { rotation: r() * 360 }), opacity: r(), visible: r() < 0.8, name: `N${step}` } };
        if (kind === 3) {
            const frame = doc.nodes[target]?.type === "frame" ? target : (containers.find((c) => doc.nodes[c]?.type === "frame") ?? target);
            return r() < 0.7
                ? { type: "node.update", id: frame, patch: { layout: { direction: pick(["horizontal", "vertical"] as const), gap: r() * 20, padding: [r() * 10, r() * 10, r() * 10, r() * 10], primary: pick(["start", "center", "end", "between"] as const), counter: pick(["start", "center", "end"] as const), wrap: r() < 0.3 }, sizing: { h: pick(["fixed", "hug"] as const), v: pick(["fixed", "hug"] as const) } } }
                : { type: "node.update", id: frame, patch: { layout: null } };
        }
        if (kind === 4) return { type: "node.update", id: target, patch: { constraints: { h: pick(["left", "right", "center", "left-right", "scale"] as const), v: pick(["top", "bottom", "center", "top-bottom", "scale"] as const) }, sizing: { h: pick(["fixed", "fill", "hug"] as const), v: pick(["fixed", "fill"] as const) } } };
        if (kind === 5) return { type: "node.delete", ids: some().length ? some() : [target] };
        if (kind === 6) return { type: "node.move", ids: [target, ...some()], dx: r() * 40 - 20, dy: r() * 40 - 20 };
        if (kind === 7) {
            // The editor refuses to put a component's instance inside that component.
            const parentId = pick(containers);
            const ancestors: string[] = [];
            for (let p: string | null = parentId; p; p = doc.nodes[p]?.parentId ?? null) ancestors.push(p);
            const moving = [target, ...descendants(doc, target)];
            if (moving.some((id) => ancestors.includes(doc.nodes[id]?.componentId ?? ""))) return { type: "batch", commands: [] };
            return { type: "node.reparent", id: target, parentId, index: r() < 0.5 ? undefined : Math.floor(r() * 5) };
        }
        return { type: "batch", commands: [randomCommand(doc, r, step * 100 + 1), { type: "node.convert", id: target, to: pick(["frame", "component"] as const) }] };
    }

    it.each(Array.from({ length: 100 }, (_, i) => i + 1))("seed %i", (seed) => {
        const r = rng(seed);
        // Without the instance: a size an auto layout or a frame gives an instance isn't an override,
        // so rebuilding it from its component resets that size (a known limit, see the report).
        let doc = applyCommand(richDoc(), { type: "node.delete", ids: ["I"] });
        for (let step = 0; step < 60; step++) {
            const command = randomCommand(doc, r, step);
            const after = applyCommand(doc, command);
            const where = `seed ${seed} step ${step}: ${JSON.stringify(command).slice(0, 300)}`;
            expect(consistent(after), where).toEqual([]);
            // A settled document is a fixed point: settling it again (every layer a new object, as
            // after a patch) changes nothing. Instances stay the same objects: a size an auto layout
            // gave an instance isn't an override, so rebuilding one resets it (a known limit).
            const fresh = { ...after, nodes: Object.fromEntries(Object.entries(after.nodes).map(([id, n]) => [id, n.type === "instance" || n.sourceId ? n : { ...n }])) };
            expect(differences(settle(doc, fresh), after).join("\n"), `settle: ${where}`).toBe("");
            expect(differences(undoOf(doc, after), doc).join("\n"), `undo: ${where}`).toBe("");
            expect(differences(redoOf(doc, after), after).join("\n"), `redo: ${where}`).toBe("");
            doc = after;
        }
    });
});

describe("commands: concurrent edits merged as patches", () => {
    // Two people edit the same document; each applies the other's patch, then undoes their own edit.
    // Nothing may throw, and the tree must stay consistent.
    it.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i", (seed) => {
        let s = seed >>> 0;
        const r = () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 2 ** 32;
        };
        let base = applyCommand(richDoc(), { type: "node.delete", ids: ["I"] });
        for (let round = 0; round < 15; round++) {
            const ids = Object.keys(base.nodes).filter((id) => base.nodes[id]?.type !== "page" && !base.nodes[id]?.sourceId);
            const pick = () => ids[Math.floor(r() * ids.length)] as string;
            const containers = [PAGE, ...ids.filter((id) => base.nodes[id]?.type === "frame" || base.nodes[id]?.type === "group")];
            const edit = (): Command => {
                const k = Math.floor(r() * 5);
                if (k === 0) return { type: "node.delete", ids: [pick()] };
                if (k === 1) return { type: "node.reparent", id: pick(), parentId: containers[Math.floor(r() * containers.length)] as string };
                if (k === 2) return { type: "node.create", node: makeNode(base, "rect", { x: r() * 300, y: r() * 300, w: 10, h: 10 }, containers[Math.floor(r() * containers.length)] as string, { id: `s${seed}r${round}${Math.floor(r() * 1e6)}` }) };
                if (k === 3) return { type: "node.move", ids: [pick()], dx: 5, dy: 5 };
                return { type: "node.update", id: pick(), patch: { opacity: r(), name: `x${round}` } };
            };
            if (!ids.length) break;
            const mine = applyCommand(base, edit());
            const theirs = applyCommand(base, edit());
            const merged = applyPatch(mine, diffDocs(base, theirs));
            const undone = applyPatch(merged, invertPatch(base, diffDocs(base, mine)));
            for (const d of [merged, undone]) {
                for (const [id, n] of Object.entries(d.nodes)) {
                    expect(typeof n.type, `${seed}/${round} ${id}`).toBe("string");
                    if (n.parentId) expect(d.nodes[n.parentId]?.children, `${seed}/${round} ${id}`).toContain(id);
                    for (const c of n.children) expect(d.nodes[c]?.parentId).toBe(id);
                }
            }
            base = undone;
        }
    });
});

describe("commands: instances resized by auto layout", () => {
    // Regression: auto layout resized a filling instance after the instances were rebuilt, so its
    // contents kept the old size until the next edit, and a collaborator applying the same change
    // as a patch (or a redo) got the contents at the new size.
    it("a filling instance's contents follow its new size in the same edit", () => {
        let doc = add(emptyDoc(), "component", "C", { x: 0, y: 500, w: 100, h: 40 });
        doc = add(doc, "rect", "K", { x: 0, y: 500, w: 100, h: 40 }, "C", { constraints: { h: "left-right", v: "top" } });
        doc = add(doc, "frame", "F", { x: 0, y: 0, w: 300, h: 40 }, PAGE, { layout: { direction: "horizontal", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } });
        doc = applyCommand(doc, { type: "node.create", node: makeNode(doc, "instance", { x: 0, y: 0, w: 100, h: 40 }, "F", { id: "I", componentId: "C" }) });
        const before = doc;
        // Fill container: an override on the instance.
        const after = applyCommand(before, { type: "node.update", id: "I", patch: { sizing: { h: "fill", v: "fixed" } } });
        expect(box(after, "I")).toEqual({ x: 0, y: 0, w: 300, h: 40 });
        expect(box(after, "I;K")).toEqual({ x: 0, y: 0, w: 300, h: 40 });
        expect(plain(redoOf(before, after))).toEqual(plain(after));
        // Widening the stack stretches the instance and its contents again.
        const wider = applyCommand(after, { type: "node.update", id: "F", patch: { w: 500 } });
        expect(box(wider, "I;K")).toEqual({ x: 0, y: 0, w: 500, h: 40 });
        expect(plain(redoOf(after, wider))).toEqual(plain(wider));
        expect(plain(undoOf(after, wider))).toEqual(plain(after));
    });
});

describe("commands: layout settles in one edit", () => {
    // Regression: a group between two stacks was refitted only after the outer stack had hugged its
    // old box, so the result moved again on the next edit (and differed for a collaborator applying
    // the same change as a patch).
    it("a stack inside a group inside a stack", () => {
        let doc = add(emptyDoc(), "frame", "O", { x: 0, y: 0, w: 10, h: 10 }, PAGE, { layout: { direction: "horizontal", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" }, sizing: { h: "hug", v: "hug" } });
        doc = applyCommand(doc, {
            type: "batch",
            commands: [
                { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, "O", { id: "G" }) },
                { type: "node.create", node: makeNode(doc, "frame", { x: 0, y: 0, w: 100, h: 200 }, "G", { id: "S" }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 0, y: 0, w: 30, h: 30 }, "S", { id: "k" }) },
            ],
        });
        expect(box(doc, "O")).toMatchObject({ w: 100, h: 200 });
        const before = doc;
        const after = applyCommand(before, { type: "node.update", id: "S", patch: { layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" }, sizing: { h: "hug", v: "hug" } } });
        expect(box(after, "S")).toMatchObject({ w: 30, h: 30 });
        expect(box(after, "G")).toMatchObject({ w: 30, h: 30 });
        expect(box(after, "O")).toMatchObject({ w: 30, h: 30 });
        expect(plain(redoOf(before, after))).toEqual(plain(after));
    });

    // Regression: instances were rebuilt before the layout pass resized their hugging component, so
    // they kept the component's old size until some later edit.
    it("instances follow a hugging component's new size", () => {
        let doc = add(emptyDoc(), "component", "C", { x: 0, y: 0, w: 10, h: 10 }, PAGE, { layout: { direction: "horizontal", gap: 0, padding: [5, 5, 5, 5], primary: "start", counter: "start" }, sizing: { h: "hug", v: "hug" } });
        doc = add(doc, "rect", "a", { x: 0, y: 0, w: 40, h: 20 }, "C");
        doc = add(doc, "rect", "b", { x: 0, y: 0, w: 40, h: 20 }, "C");
        doc = add(doc, "instance", "I", { x: 0, y: 300, w: 10, h: 10 }, PAGE, { componentId: "C" });
        // Fixed width on the instance (its width still follows the component until resized).
        doc = applyCommand(doc, { type: "node.update", id: "I", patch: { sizing: { h: "fixed", v: "hug" } } });
        expect(box(doc, "C")).toMatchObject({ w: 90, h: 30 });
        expect(box(doc, "I")).toMatchObject({ w: 90, h: 30 });
        const before = doc;
        const after = applyCommand(before, { type: "node.update", id: "b", patch: { visible: false } });
        expect(box(after, "C")).toMatchObject({ w: 50, h: 30 });
        expect(box(after, "I")).toMatchObject({ w: 50, h: 30 });
        expect(plain(redoOf(before, after))).toEqual(plain(after));
        expect(plain(undoOf(before, after))).toEqual(plain(before));
    });
});

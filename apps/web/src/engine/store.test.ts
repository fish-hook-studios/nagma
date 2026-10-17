// Loaded first: importing actions.ts alone hits the collab / inspect-settings import cycle (fine in the app bundle).
import "./inspect-settings";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { makeNode } from "./nodes";
import { editor } from "./store";
import { toggleMask } from "./actions";
import { addTransform } from "./repeat-actions";
import type { Command, NagmaDocument } from "./types";
import { PAGE, add, emptyDoc, node, plain } from "../test/core-fixtures";

function start(): NagmaDocument {
    let doc = emptyDoc();
    doc = add(doc, "frame", "F", { x: 0, y: 0, w: 300, h: 200 });
    doc = add(doc, "rect", "A", { x: 10, y: 10, w: 40, h: 40 }, "F");
    doc = add(doc, "ellipse", "B", { x: 100, y: 10, w: 40, h: 40 }, "F");
    doc = add(doc, "text", "T", { x: 400, y: 0, w: 1, h: 1 }, PAGE, { text: "Hi" });
    return doc;
}

beforeEach(() => {
    editor.set({ readOnly: false, selection: [] });
    editor.loadDocument(start(), null);
});

const doc = () => editor.get().doc;

describe("editor history", () => {
    it("undoes and redoes a sequence of mixed commands step by step", () => {
        const commands: Command[] = [
            { type: "node.create", node: makeNode(doc(), "rect", { x: 5, y: 5, w: 10, h: 10 }, "F", { id: "N" }) },
            { type: "node.update", id: "A", patch: { fills: [{ type: "solid", color: "#FF0000", opacity: 1, visible: true, blend: "normal" }], radius: 6 } },
            { type: "node.move", ids: ["F"], dx: 20, dy: 30 },
            { type: "node.reparent", id: "T", parentId: "F", index: 0 },
            { type: "node.update", id: "F", patch: { layout: { direction: "vertical", gap: 4, padding: [8, 8, 8, 8], primary: "start", counter: "start" }, sizing: { h: "hug", v: "hug" } } },
            { type: "node.delete", ids: ["B"] },
            { type: "doc.rename", name: "Edited" },
            { type: "node.convert", id: "F", to: "component" },
        ];
        const snapshots = [plain(doc())];
        for (const c of commands) {
            editor.execute(c);
            snapshots.push(plain(doc()));
        }
        expect(editor.get().past).toHaveLength(commands.length);
        for (let i = commands.length - 1; i >= 0; i--) {
            editor.undo();
            expect(plain(doc())).toEqual(snapshots[i]);
        }
        expect(editor.get().future).toHaveLength(commands.length);
        for (let i = 1; i <= commands.length; i++) {
            editor.redo();
            expect(plain(doc())).toEqual(snapshots[i]);
        }
        expect(editor.get().journal).toHaveLength(commands.length);
    });

    it("a new edit clears the redo list", () => {
        editor.execute({ type: "node.move", ids: ["A"], dx: 1, dy: 0 });
        editor.undo();
        expect(editor.get().future).toHaveLength(1);
        editor.execute({ type: "node.move", ids: ["B"], dx: 1, dy: 0 });
        expect(editor.get().future).toHaveLength(0);
        editor.redo();
        expect(node(doc(), "A").x).toBe(10);
    });

    it("a no-op command records no step", () => {
        editor.execute({ type: "node.update", id: "ghost", patch: { x: 3 } });
        editor.execute({ type: "batch", commands: [] });
        expect(editor.get().past).toHaveLength(0);
    });

    it("undo with an empty history does nothing", () => {
        const before = doc();
        editor.undo();
        editor.redo();
        expect(doc()).toBe(before);
    });

    it("undo after a remote change keeps the remote change", () => {
        editor.execute({ type: "node.update", id: "A", patch: { opacity: 0.5 } });
        // A collaborator renames B, recolours A and adds a layer.
        let remote = applyCommand(doc(), { type: "node.update", id: "B", patch: { name: "Remote B" } });
        remote = applyCommand(remote, { type: "node.update", id: "A", patch: { radius: 9 } });
        remote = add(remote, "rect", "R", { x: 500, y: 500, w: 5, h: 5 });
        editor.receive(remote);
        editor.undo();
        expect(node(doc(), "A").opacity).toBe(1);
        expect(node(doc(), "A").radius).toBe(9);
        expect(node(doc(), "B").name).toBe("Remote B");
        expect(doc().nodes.R).toBeDefined();
        editor.redo();
        expect(node(doc(), "A").opacity).toBe(0.5);
        expect(node(doc(), "A").radius).toBe(9);
        expect(doc().nodes.R).toBeDefined();
    });

    // Regression: undoing an edit to a layer a collaborator had deleted since brought back a
    // fragment of it (only the undone properties: no type, no parent, no children), which broke
    // everything that walks the tree.
    it("undo after a collaborator deleted the edited layer leaves it deleted", () => {
        editor.execute({ type: "node.update", id: "A", patch: { opacity: 0.5, name: "Mine" } });
        editor.receive(applyCommand(doc(), { type: "node.delete", ids: ["A"] }));
        editor.undo();
        expect(doc().nodes.A).toBeUndefined();
        for (const n of Object.values(doc().nodes)) {
            expect(typeof n.type).toBe("string");
            expect(Array.isArray(n.children)).toBe(true);
        }
        editor.redo();
        expect(doc().nodes.A).toBeUndefined();
    });

    it("a collaborator's change to a layer deleted here is dropped; a whole new layer is created", async () => {
        const { applyPatch } = await import("./patch");
        const gone = applyCommand(start(), { type: "node.delete", ids: ["A"] });
        const after = applyPatch(gone, { nodes: { A: { opacity: 0.3, x: 4 } } });
        expect(after.nodes.A).toBeUndefined();
        const created = makeNode(gone, "rect", { x: 0, y: 0, w: 5, h: 5 }, PAGE, { id: "Z" });
        const withZ = applyPatch(gone, { nodes: { Z: created }, roots: gone.roots });
        expect(withZ.nodes.Z).toBeDefined();
        expect(withZ.nodes[PAGE]?.children).toContain("Z");
    });

    it("redo after a collaborator deleted the layer leaves it deleted", () => {
        editor.execute({ type: "node.move", ids: ["B"], dx: 5, dy: 5 });
        editor.undo();
        editor.receive(applyCommand(doc(), { type: "node.delete", ids: ["B"] }));
        editor.redo();
        expect(doc().nodes.B).toBeUndefined();
        for (const n of Object.values(doc().nodes)) expect(typeof n.type).toBe("string");
    });

    it("undoing a create after a remote edit inside it keeps the tree consistent", () => {
        editor.execute({ type: "node.create", node: makeNode(doc(), "frame", { x: 600, y: 0, w: 100, h: 100 }, PAGE, { id: "NF" }) });
        // A collaborator puts a layer inside the new frame.
        editor.receive(add(doc(), "rect", "IN", { x: 610, y: 10, w: 5, h: 5 }, "NF"));
        editor.undo();
        expect(doc().nodes.NF).toBeUndefined();
        // The child goes with its parent rather than dangling.
        expect(doc().nodes.IN).toBeUndefined();
        expect(node(doc(), PAGE).children).not.toContain("NF");
    });

    it("an edit made on a stale base is replayed on top of remote changes", () => {
        const base = doc();
        editor.receive(applyCommand(base, { type: "node.update", id: "B", patch: { name: "Remote" } }));
        editor.execute({ type: "node.move", ids: ["A"], dx: 50, dy: 0 }, base);
        expect(node(doc(), "A").x).toBe(60);
        expect(node(doc(), "B").name).toBe("Remote");
        editor.undo();
        expect(node(doc(), "A").x).toBe(10);
        expect(node(doc(), "B").name).toBe("Remote");
    });

    it("receive with resetHistory clears undo", () => {
        editor.execute({ type: "node.move", ids: ["A"], dx: 1, dy: 0 });
        editor.receive(start(), { resetHistory: true });
        expect(editor.get().past).toHaveLength(0);
        editor.undo();
        expect(node(doc(), "A").x).toBe(10);
    });

    it("executeSilently applies without an undo step", () => {
        editor.executeSilently({ type: "node.move", ids: ["A"], dx: 5, dy: 0 });
        expect(node(doc(), "A").x).toBe(15);
        expect(editor.get().past).toHaveLength(0);
    });

    it("executeSilently after an undo keeps the redo stack (housekeeping such as code re-colouring)", () => {
        editor.execute({ type: "node.move", ids: ["A"], dx: 5, dy: 0 });
        editor.execute({ type: "node.update", id: "A", patch: { name: "Renamed" } });
        editor.undo();
        editor.undo();
        editor.executeSilently({ type: "node.update", id: "A", patch: { opacity: 0.5 } });
        expect(editor.get().future).toHaveLength(2);
        editor.redo();
        editor.redo();
        expect(node(doc(), "A").x).toBe(15);
        expect(node(doc(), "A").name).toBe("Renamed");
        expect(node(doc(), "A").opacity).toBe(0.5);
    });

    it("mergeLast folds two edits into one undo step", () => {
        editor.execute({ type: "node.move", ids: ["A"], dx: 5, dy: 0 });
        editor.execute({ type: "node.update", id: "A", patch: { name: "Moved" } });
        editor.mergeLast();
        expect(editor.get().past).toHaveLength(1);
        editor.undo();
        expect(node(doc(), "A").x).toBe(10);
        expect(node(doc(), "A").name).not.toBe("Moved");
    });

    it("selection is restored by undo and reselected by redo", () => {
        editor.set({ selection: ["A"] });
        editor.execute({ type: "node.delete", ids: ["A"] });
        expect(editor.get().selection).toEqual([]);
        editor.undo();
        expect(editor.get().selection).toEqual(["A"]);
    });

    it("read-only views refuse edits and undo", () => {
        editor.execute({ type: "node.move", ids: ["A"], dx: 5, dy: 0 });
        editor.set({ readOnly: true });
        editor.execute({ type: "node.move", ids: ["A"], dx: 5, dy: 0 });
        expect(node(doc(), "A").x).toBe(15);
        editor.undo();
        expect(node(doc(), "A").x).toBe(15);
        editor.set({ readOnly: false });
    });

    it("keeps at most 200 undo steps", () => {
        for (let i = 0; i < 205; i++) editor.execute({ type: "node.move", ids: ["A"], dx: 1, dy: 0 });
        expect(editor.get().past).toHaveLength(200);
        for (let i = 0; i < 210; i++) editor.undo();
        // The five oldest steps fell off the history.
        expect(node(doc(), "A").x).toBe(15);
    });

    it("applyLocalPatch is one undoable step", () => {
        editor.applyLocalPatch({ nodes: { A: { name: "Patched", x: 99 } } });
        expect(node(doc(), "A").name).toBe("Patched");
        editor.undo();
        expect(node(doc(), "A").x).toBe(10);
        expect(node(doc(), "A").name).not.toBe("Patched");
    });
});

// Regression: an action that edits and then selects its result (duplicate, insert a table, create
// assets, group then mask...) made two undo steps, so the first undo only changed the selection.
describe("a selection made right after an edit joins its undo step", () => {
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const create = (id: string) => editor.execute({ type: "node.create", node: makeNode(doc(), "rect", { x: 5, y: 5, w: 10, h: 10 }, "F", { id }) });

    it("edit then select in the same task is one step: undo removes the result and restores the selection", () => {
        editor.set({ selection: ["A"] });
        const steps = editor.get().past.length;
        const before = plain(doc());
        create("N");
        editor.set({ selection: ["N"] });
        expect(editor.get().past).toHaveLength(steps + 1);
        expect(editor.get().past.at(-1)?.selectionAfter).toEqual(["N"]);
        editor.undo();
        expect(plain(doc())).toEqual(before);
        expect(editor.get().selection).toEqual(["A"]);
        editor.redo();
        expect(doc().nodes.N).toBeTruthy();
        expect(editor.get().selection).toEqual(["N"]);
    });

    it("several selection changes in the same task all fold into the edit", () => {
        const steps = editor.get().past.length;
        create("N");
        editor.set({ selection: ["N"] });
        editor.set({ selection: ["N", "A"] });
        expect(editor.get().past).toHaveLength(steps + 1);
        expect(editor.get().past.at(-1)?.selectionAfter).toEqual(["N", "A"]);
    });

    it("a selection change in a later task is a step of its own", async () => {
        const steps = editor.get().past.length;
        create("N");
        await tick();
        editor.set({ selection: ["N"] });
        expect(editor.get().past).toHaveLength(steps + 2);
        expect(editor.get().past.at(-1)?.selectionOnly).toBe(true);
        editor.undo();
        expect(doc().nodes.N).toBeTruthy();
        expect(editor.get().selection).toEqual([]);
    });

    it("steps merged in the same task stay fresh, and stop being fresh after it", async () => {
        const steps = editor.get().past.length;
        create("N");
        editor.execute({ type: "node.move", ids: ["N"], dx: 3, dy: 0 });
        editor.mergeLast();
        editor.set({ selection: ["N"] });
        expect(editor.get().past).toHaveLength(steps + 1);
        await tick();
        editor.set({ selection: ["A"] });
        expect(editor.get().past).toHaveLength(steps + 2);
        expect(editor.get().past.at(-1)?.selectionOnly).toBe(true);
    });

    it("mergeLast after edit, select, edit folds both edits without swallowing an earlier step", () => {
        editor.execute({ type: "doc.rename", name: "Earlier" });
        return tick().then(() => {
            const steps = editor.get().past.length;
            create("N");
            editor.set({ selection: ["N"] });
            editor.execute({ type: "node.update", id: "N", patch: { name: "Named" } });
            editor.mergeLast();
            expect(editor.get().past).toHaveLength(steps + 1);
            editor.undo();
            expect(doc().nodes.N).toBeUndefined();
            expect(doc().name).toBe("Earlier");
        });
    });

    it("after undo or redo, a selection change is its own step", () => {
        create("N");
        editor.undo();
        const steps = editor.get().past.length;
        editor.set({ selection: ["A"] });
        expect(editor.get().past).toHaveLength(steps + 1);
        expect(editor.get().past.at(-1)?.selectionOnly).toBe(true);
    });
});

// Regression: masking several layers and adding a repeat group first and then edit; with the group's
// selection a step of its own, mergeLast folded the edit into the selection step and the group stayed
// behind as a second undo step.
describe("group-then-edit actions are one undo step", () => {
    it.each([
        ["mask two layers", () => toggleMask()],
        ["add a linear repeat to two layers", () => addTransform("linear")],
    ])("%s, undone once, restores the document", async (_, run) => {
        editor.set({ selection: ["A", "B"] });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const before = plain(doc());
        const steps = editor.get().past.length;
        run();
        expect(plain(doc())).not.toEqual(before);
        expect(editor.get().past).toHaveLength(steps + 1);
        editor.undo();
        expect(plain(doc())).toEqual(before);
        expect(editor.get().selection).toEqual(["A", "B"]);
    });
});

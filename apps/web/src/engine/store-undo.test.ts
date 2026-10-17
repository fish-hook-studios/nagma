import { beforeEach, describe, expect, it } from "vitest";

await import("../app");
const { editor } = await import("./store");
const { addAutoLayout, createComponent, frameSelection, groupSelection, toggleMask } = await import("./actions");
const { addTransform } = await import("./repeat-actions");
const { designDoc } = await import("../test/design-doc");

describe("one action, one undo step", () => {
    let a: string, b: string;
    beforeEach(() => {
        const { doc, byName } = designDoc([
            { type: "rect", name: "A" },
            { type: "rect", name: "B", x: 200 },
        ]);
        a = byName.A!.id;
        b = byName.B!.id;
        editor.loadDocument(doc, null);
        editor.set({ selection: [a, b] });
    });

    it("⌘G then ⌘Z ungroups (the group's selection is part of the grouping step)", () => {
        const doc = editor.get().doc;
        groupSelection();
        expect(editor.get().doc.nodes[editor.get().doc.nodes[a]!.parentId!]!.type).toBe("group");
        editor.undo();
        expect(editor.get().doc).toEqual(doc);
        expect(editor.get().selection).toEqual([a, b]);
        editor.redo();
        const group = editor.get().doc.nodes[a]!.parentId!;
        expect(editor.get().selection).toEqual([group]);
    });

    it("a repeat added to a group already there does not fold in the edit before it", () => {
        groupSelection();
        const group = editor.get().selection[0]!;
        // An unrelated edit, then the repeat.
        editor.execute({ type: "node.update", id: group, patch: { name: "Renamed" } });
        editor.set({ selection: [group] });
        addTransform("linear");
        expect(editor.get().doc.nodes[group]!.repeat).toBeTruthy();
        editor.undo();
        expect(editor.get().doc.nodes[group]!.repeat ?? null).toBeNull();
        expect(editor.get().doc.nodes[group]!.name).toBe("Renamed");
    });

    it("a repeat on loose layers groups and repeats in one step", () => {
        const doc = editor.get().doc;
        addTransform("radial");
        editor.undo();
        expect(editor.get().doc).toEqual(doc);
    });

    for (const [name, run] of [
        ["⇧A add auto layout", () => addAutoLayout()],
        ["⌥⌘K create component", () => createComponent()],
        ["⌥⌘G frame selection", () => frameSelection()],
        ["⌃⌘M use as mask", () => toggleMask()],
    ] as const) {
        it(`${name} on loose layers is one undo step`, () => {
            const doc = editor.get().doc;
            run();
            expect(editor.get().doc).not.toEqual(doc);
            editor.undo();
            expect(editor.get().doc).toEqual(doc);
            expect(editor.get().selection).toEqual([a, b]);
        });
    }

    it("a selection change on its own is still a step", async () => {
        // (Selection changes in quick succession fold together.)
        await new Promise((r) => setTimeout(r, 650));
        editor.set({ selection: [a] });
        editor.undo();
        expect(editor.get().selection).toEqual([a, b]);
    });
});

import { describe, expect, it } from "vitest";

await import("../app");
const { applyPatch, diffDocs } = await import("./patch");
const { editor } = await import("./store");
const { designDoc } = await import("../test/design-doc");

describe("edits to layers deleted elsewhere", () => {
    it("a partial change for a missing layer is dropped instead of making a broken layer", () => {
        const { doc, byName } = designDoc([{ type: "rect", name: "A" }]);
        const id = byName.A!.id;
        const without = applyPatch(doc, { nodes: { [id]: null } });
        expect(() => applyPatch(without, { nodes: { [id]: { x: 5 } } })).not.toThrow();
        expect(applyPatch(without, { nodes: { [id]: { x: 5 } } }).nodes[id]).toBeUndefined();
    });

    it("a drag that ends after a collaborator deleted the layer doesn't throw", () => {
        const { doc, byName } = designDoc([{ type: "rect", name: "A" }, { type: "rect", name: "B", x: 200 }]);
        const a = byName.A!.id;
        editor.loadDocument(doc, null);
        const base = editor.get().doc;
        // The collaborator's delete arrives mid-drag (the drag started from `base`).
        editor.receive(applyPatch(base, { nodes: { [a]: null } }));
        expect(diffDocs(base, editor.get().doc).nodes?.[a]).toBeNull();
        expect(() => editor.execute({ type: "node.move", ids: [a], dx: 10, dy: 0 }, base)).not.toThrow();
        expect(editor.get().doc.nodes[byName.B!.id]).toBeDefined();
    });
});

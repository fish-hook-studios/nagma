import { describe, expect, it, vi } from "vitest";

vi.mock("./doc-store", () => import("../test/memory-doc-store"));

await import("../app");
const { editor } = await import("./store");
const { createFile, openFile } = await import("./files");
const { makeNode } = await import("./nodes");

describe("autosave when switching files", () => {
    it("an edit made just before another file opens is kept", async () => {
        const a = createFile("design", undefined, "A");
        const b = createFile("design", undefined, "B");
        await openFile(a.id);
        const doc = editor.get().doc;
        const node = makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, doc.roots[0] ?? null, { name: "Dropped" });
        editor.execute({ type: "node.create", node });
        // Straight away, as when a dropped .fig opens right after a dropped image is placed:
        // opening B used to cancel A's waiting autosave.
        await openFile(b.id);
        await openFile(a.id);
        expect(editor.get().doc.nodes[node.id]?.name).toBe("Dropped");
    });

    it("reopening the open file doesn't read back an older copy", async () => {
        const a = createFile("design", undefined, "Again");
        await openFile(a.id);
        const doc = editor.get().doc;
        const node = makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, doc.roots[0] ?? null, { name: "Fresh" });
        editor.execute({ type: "node.create", node });
        await openFile(a.id);
        expect(editor.get().doc.nodes[node.id]?.name).toBe("Fresh");
    });

    it("closing the page right after an edit writes it", async () => {
        const { storedDocs } = await import("../test/memory-doc-store");
        const a = createFile("design", undefined, "Closing");
        await openFile(a.id);
        const doc = editor.get().doc;
        const node = makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, doc.roots[0] ?? null, { name: "Last" });
        editor.execute({ type: "node.create", node });
        window.dispatchEvent(new Event("pagehide"));
        await Promise.resolve();
        expect(storedDocs.get(editor.storageKey() ?? "")?.nodes[node.id]?.name).toBe("Last");
    });
});

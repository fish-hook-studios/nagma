import { beforeEach, describe, expect, it } from "vitest";

await import("../app");
const { editor } = await import("./store");
const { copySelection, duplicateSelection, paste, pasteToReplace } = await import("./actions");
const { designDoc } = await import("../test/design-doc");
const { viewport } = await import("./camera");

const node = (id: string) => editor.get().doc.nodes[id]!;
const childOf = (id: string) => node(node(id).children[0]!);

describe("copies move with their contents", () => {
    let ids: Record<string, string>;
    beforeEach(() => {
        const { doc, byName } = designDoc([
            { type: "frame", name: "A", x: 100, y: 300, w: 400, h: 300 },
            { type: "rect", name: "Inside A", x: 150, y: 350, w: 100, h: 100, parent: "A" },
            { type: "frame", name: "B", x: 1000, y: 0, w: 400, h: 300 },
            { type: "rect", name: "Loose", x: 350, y: 250, w: 100, h: 100 },
        ]);
        ids = Object.fromEntries(Object.values(byName).map((n) => [n.name, n.id]));
        editor.loadDocument(doc, null);
        // A view that shows everything, so pasting never moves copies to the middle of the view.
        Object.assign(viewport, { width: 2000, height: 1200 });
        editor.set({ camera: { x: 0, y: 0, zoom: 1 } });
    });

    it("⌘D on a top-level frame puts its contents in the copy", () => {
        editor.set({ selection: [ids.A!] });
        duplicateSelection();
        const copy = node(editor.get().selection[0]!);
        // In place, on top of the original.
        expect(copy.x).toBe(100);
        // The child keeps its place in the frame: 50, 50 from the corner.
        expect(childOf(copy.id).x - copy.x).toBe(50);
        expect(childOf(copy.id).y - copy.y).toBe(50);
    });

    it("pasting a frame's layer into another frame keeps its place in the frame", () => {
        editor.set({ selection: [ids["Inside A"]!] });
        copySelection();
        editor.set({ selection: [ids.B!] });
        paste();
        const pasted = node(editor.get().selection[0]!);
        expect(pasted.parentId).toBe(ids.B);
        expect([pasted.x, pasted.y]).toEqual([1050, 50]);
    });

    // Its offset from the page origin (350, 250) is its place in the frame, which A (400 x 300) can't hold.
    it("a layer from the page that the frame can't hold is centred in it", () => {
        editor.set({ selection: [ids.Loose!] });
        copySelection();
        editor.set({ selection: [ids.A!] });
        paste();
        const pasted = node(editor.get().selection[0]!);
        expect(pasted.parentId).toBe(ids.A);
        expect([pasted.x, pasted.y]).toEqual([250, 400]);
    });

    it("paste to replace brings the copied frame's contents along", () => {
        editor.set({ selection: [ids.A!] });
        copySelection();
        editor.set({ selection: [ids.Loose!] });
        pasteToReplace();
        const placed = node(editor.get().selection[0]!);
        expect([placed.x, placed.y]).toEqual([350, 250]);
        const inner = childOf(placed.id);
        // (Before, the contents stayed where the copied frame was, 50 px from its old corner at 100, 300.)
        expect([inner.x - placed.x, inner.y - placed.y]).toEqual([50, 50]);
    });
});

describe("frame quick-add", async () => {
    const { quickAddFrame } = await import("./frame-tool");
    it("the copy beside the frame takes the next number and brings its contents", () => {
        const { doc, byName } = designDoc([
            { type: "frame", name: "Frame 1", x: 0, y: 0, w: 200, h: 100 },
            { type: "rect", name: "Dot", x: 10, y: 10, w: 20, h: 20, parent: "Frame 1" },
        ]);
        editor.loadDocument(doc, null);
        quickAddFrame(byName["Frame 1"]!.id, true, "right");
        const copy = node(editor.get().selection[0]!);
        expect(copy.name).toBe("Frame 2");
        expect([copy.x, childOf(copy.id).x]).toEqual([240, 250]);
    });
});

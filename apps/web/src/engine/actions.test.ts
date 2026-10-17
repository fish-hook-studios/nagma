import { beforeEach, describe, expect, it } from "vitest";

await import("../app");
const { editor } = await import("./store");
const { addPage, deleteSelection, selectAll } = await import("./actions");
const { designDoc } = await import("../test/design-doc");

describe("select all and delete", () => {
    let page: string;
    beforeEach(() => {
        const built = designDoc([
            { type: "rect", name: "A" },
            { type: "frame", name: "F", x: 200 },
            { type: "rect", name: "Inner", x: 210, parent: "F" },
        ]);
        page = built.page.id;
        editor.loadDocument(built.doc, null);
        editor.set({ selection: [] });
    });

    it("⌘A with nothing selected selects the page's layers, not the page", () => {
        selectAll();
        const { doc, selection } = editor.get();
        expect(selection.map((id) => doc.nodes[id]!.name).sort()).toEqual(["A", "F"]);
    });

    it("⌘A then Delete leaves the page in place", () => {
        selectAll();
        deleteSelection();
        const { doc } = editor.get();
        expect(doc.nodes[page]).toBeDefined();
        expect(doc.nodes[page]!.children).toEqual([]);
    });

    it("a selected page is never deleted as a layer", () => {
        editor.set({ selection: [page] });
        deleteSelection();
        expect(editor.get().doc.nodes[page]!.children).toHaveLength(2);
    });
});

describe("add page", () => {
    it("returns the new page, now shown, so the Pages list can rename it at once", () => {
        editor.loadDocument(designDoc([]).doc, null);
        const id = addPage();
        expect(editor.get().pageId).toBe(id);
        expect(editor.get().doc.nodes[id]!.name).toBe("Page 2");
    });
});

describe("menu items are disabled where they'd do nothing", async () => {
    const { ACTION_BY_ID, actionEnabled } = await import("./menu-actions");
    const enabled = (id: string) => actionEnabled(ACTION_BY_ID.get(id)!);
    it("instance, ungroup, layout, fit, section and point items follow the selection", () => {
        const { doc, byName } = designDoc([
            { type: "rect", name: "R" },
            { type: "frame", name: "Empty", x: 200 },
            { type: "group", name: "G", x: 400 },
            { type: "rect", name: "In G", x: 400, parent: "G" },
            { type: "instance", name: "I", x: 600 },
            { type: "frame", name: "Auto", x: 800, props: { layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } } },
            { type: "rect", name: "In auto", x: 800, parent: "Auto" },
        ]);
        editor.loadDocument(doc, null);
        const on = (name: string) => {
            editor.set({ selection: [byName[name]!.id] });
            return ["mainComponent", "detach", "resetInstance", "ungroup", "noLayout", "resizeToFit", "toSection", "editPoints"].filter(enabled);
        };
        expect(on("R")).toEqual(["editPoints"]);
        expect(on("Empty")).toEqual(["toSection"]);
        expect(on("G")).toEqual(["ungroup", "resizeToFit"]);
        expect(on("I")).toEqual(["mainComponent", "detach", "resetInstance"]);
        expect(on("Auto")).toEqual(["ungroup", "noLayout", "toSection"]);
    });

    it("a pending ⌘R rename is dropped when another file opens", () => {
        editor.set({ renameRequest: "x" });
        editor.loadDocument(designDoc([]).doc, null);
        expect(editor.get().renameRequest).toBeNull();
    });
});

describe("links to a file only on this device", async () => {
    const { copyLink } = await import("./links");
    const { copyPageLink } = await import("./pages");
    it("say the file needs sharing instead of copying a link that opens another file", async () => {
        const writes: string[] = [];
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void writes.push(t) }, configurable: true });
        const { doc, byName } = designDoc([{ type: "rect", name: "A" }]);
        editor.loadDocument(doc, null);
        editor.set({ selection: [byName.A!.id], toast: null });
        await copyLink("selection");
        expect(writes).toEqual([]);
        expect(editor.get().toast).toMatch(/only on this device/);
        editor.set({ toast: null });
        copyPageLink(doc.roots[0]!);
        expect(writes).toEqual([]);
        expect(editor.get().toast).toMatch(/only on this device/);
    });
});

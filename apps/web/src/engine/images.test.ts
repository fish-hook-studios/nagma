import { describe, expect, it, vi } from "vitest";

vi.mock("./doc-store", () => import("../test/memory-doc-store"));

await import("../app");
const { editor } = await import("./store");
const { placeImages } = await import("./images");

describe("dropping files on the canvas", () => {
    it("a .fig goes to the file importer only: its message isn't replaced by 'not an image'", async () => {
        // Not a real .fig, so the importer reports that; before, the image reader then replaced the
        // importer's message (on success too) with "Those files aren't images Nagma can open."
        await placeImages([new File(["x"], "Design.fig")], { x: 0, y: 0 });
        expect(editor.get().toast).toMatch(/^Couldn't open Design\.fig/);
    });
});

describe("Import… from Home", () => {
    it("a file with nothing readable in it doesn't leave an empty file behind", async () => {
        const { importAsNewFiles } = await import("./images");
        const { listFiles } = await import("./files");
        const before = listFiles().length;
        // Not an image (and a "PNG" that isn't one): before, each made and opened an empty design file.
        await importAsNewFiles([new File(["hello"], "notes.txt", { type: "text/plain" })]);
        await importAsNewFiles([new File(["hello"], "fake.png", { type: "image/png" })]);
        expect(listFiles().length).toBe(before);
        const { storedDocs } = await import("../test/memory-doc-store");
        expect(storedDocs.size).toBe(0);
        expect(editor.get().homeOpen).toBe(true);
        expect(editor.get().fileId).toBeNull();
        expect(editor.get().toast).toMatch(/aren't images/);
    });
});

describe("dropping a mix of files on the canvas", () => {
    it("a .sketch or .pptx opens as a file of its own (it was refused as 'not an image')", async () => {
        await placeImages([new File(["x"], "Screens.sketch")], { x: 0, y: 0 });
        expect(editor.get().toast).toMatch(/^Couldn't open Screens\.sketch: it isn.t a \.sketch file/);
        await placeImages([new File(["x"], "Deck.pptx")], { x: 0, y: 0 });
        expect(editor.get().toast).toMatch(/^Couldn't open Deck\.pptx/);
    });
});

describe("files the desktop app hands over", () => {
    it("get a type from their name, so a picture opened from Finder is read as a picture", async () => {
        const { typeForName } = await import("./desktop");
        expect(typeForName("Photo.JPG")).toBe("image/jpeg");
        expect(typeForName("logo.svg")).toBe("image/svg+xml");
        expect(typeForName("Doc.pdf")).toBe("application/pdf");
        expect(typeForName("Design.fig")).toBe("");
    });
});

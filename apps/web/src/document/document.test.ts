import { describe, expect, it, vi } from "vitest";

vi.mock("../engine/doc-store", () => import("../test/memory-doc-store"));
vi.mock("../engine/media", async () => (await import("../test/pdf-engine-node")).memoryMedia());
vi.mock("../engines/pdf-engine", async (orig) => ({ ...(await orig<typeof import("../engines/pdf-engine")>()), loadPdfEngine: (await import("../test/pdf-engine-node")).nodePdfEngine }));

await import("../app");
const { editor } = await import("../engine/store");
const { createFile, openFile, closeTab } = await import("../engine/files");
const { loadPdfEngine } = await import("../engines/pdf-engine");
const { createPdfDocument, PDF_KEY } = await import("./model");
const { docView, edit, syncWorkbench, closeWorkbench, undo, workbench } = await import("./state");
const { imageBytes } = await import("../engine/image-store");

async function newDocument(name: string, pages = 2) {
    const engine = await loadPdfEngine();
    const meta = createFile("docs", await createPdfDocument(name, engine.PdfWorkbench.blank(595, 842, pages)), name);
    await openFile(meta.id);
    await syncWorkbench(true);
    expect(docView.get().status).toBe("ready");
    return meta;
}

async function rotationOf(images: Record<string, string>, page: number): Promise<number> {
    const engine = await loadPdfEngine();
    const bytes = await imageBytes(images, PDF_KEY);
    if (!bytes) throw new Error("no PDF");
    const wb = new engine.PdfWorkbench(bytes, "check");
    try {
        return (JSON.parse(wb.info()) as { pages: { rotation: number }[] }).pages[page]?.rotation ?? -1;
    } finally {
        wb.free();
    }
}

describe("Document: an edit just before leaving the file is kept", () => {
    it("opening another file straight after an edit saves it into this file", async () => {
        const a = await newDocument("A");
        const b = createFile("design", undefined, "B");
        expect(edit({ op: "rotate", pages: [0], degrees: 90 })).toBe(true);
        expect(docView.get().saving).toBe("unsaved");
        // Within the half second before the workbench saves: the save used to be dropped, since
        // by then another file was open.
        await openFile(b.id);
        closeWorkbench();
        await openFile(a.id);
        expect(await rotationOf(editor.get().doc.images, 0)).toBe(90);
    });

    it("closing the tab straight after an edit saves it", async () => {
        const a = await newDocument("C");
        expect(edit({ op: "rotate", pages: [1], degrees: 180 })).toBe(true);
        closeTab(a.id);
        closeWorkbench();
        await openFile(a.id);
        expect(await rotationOf(editor.get().doc.images, 1)).toBe(180);
    });
});

describe("Document: tools per file", () => {
    it("another document opens with the Select tool, not the last file's Redact", async () => {
        await newDocument("Tool A");
        docView.set({ tool: "redact" });
        await newDocument("Tool B");
        expect(docView.get().tool).toBe("select");
    });

    it("another document opens on its first page with no dialog left open from the last file", async () => {
        await newDocument("Long", 6);
        docView.set({ page: 5, dialog: "protect" });
        await newDocument("Short", 3);
        // The page number was carried over (clamped to this file's last page), and the dialog stayed.
        expect(docView.get().page).toBe(0);
        expect(docView.get().dialog).toBeNull();
    });
});

describe("Document: editing a paragraph", () => {
    it("the paragraph editor's batch of line edits undoes in one step", async () => {
        await newDocument("Para", 1);
        const lines = () => (JSON.parse(workbench()?.textLines(0) ?? "[]") as { text: string }[]).map((l) => l.text);
        for (const [k, text] of ["one two three", "four five six"].entries()) edit({ op: "addText", page: 0, rect: [72, 72 + k * 16, 400, 86 + k * 16], text, size: 12 });
        expect(lines()).toEqual(["one two three", "four five six"]);
        // What the paragraph editor sends when the text grows by a line (each line 14 characters wide).
        const { paragraphEdit } = await import("./text");
        const parsed = JSON.parse(workbench()?.textLines(0) ?? "[]");
        const perChar = (parsed[0].rect[2] - parsed[0].rect[0] + parsed[1].rect[2] - parsed[1].rect[0]) / 26;
        const op = paragraphEdit(parsed, [0, 1], 0, "zero one two three four five six", parsed[0].rect[0] + 15.5 * perChar, (s) => s.length);
        expect(op?.op).toBe("batch");
        edit(op as Record<string, unknown>);
        expect(lines()).toEqual(["zero one two", "three four five", "six"]);
        undo();
        expect(lines()).toEqual(["one two three", "four five six"]);
    });
});

describe("Document: inserting pages from files", () => {
    it("a file that can't be read doesn't stop the files after it, and all are reported", async () => {
        await newDocument("Merge", 1);
        const engine = await loadPdfEngine();
        const good = new File([engine.PdfWorkbench.blank(300, 300, 2) as BlobPart], "Good.pdf", { type: "application/pdf" });
        const junk = new File(["not a pdf"], "Junk.pdf", { type: "application/pdf" });
        const { insertFileList } = await import("./actions");
        // Before, the bad file ended the loop: Good.pdf after it never went in.
        expect(await insertFileList([junk, good], 1)).toBe(1);
        expect(workbench()?.pageCount()).toBe(3);
        expect(editor.get().toast).toBe("Added Good.pdf. Couldn't add Junk.pdf: not a PDF or picture Nagma can read.");
    });
});

describe("Document: pictures as pages", () => {
    it("a file that is neither a PDF nor a picture gets one clear message (not the engine's, which repeated the name)", async () => {
        const { asPdf } = await import("./actions");
        await expect(asPdf(new File(["hello"], "notes.txt", { type: "text/plain" }))).rejects.toThrow("it isn't a PDF or a picture Nagma can read.");
        await expect(asPdf(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow("it isn't a PDF or a picture Nagma can read.");
    });
});

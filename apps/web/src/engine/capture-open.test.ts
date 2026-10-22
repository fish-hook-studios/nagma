import { describe, expect, it, vi } from "vitest";

vi.mock("./doc-store", () => import("../test/memory-doc-store"));
// The media store as a map: jsdom has no IndexedDB.
const blobs = new Map<string, Blob>();
vi.mock("./media", async (orig) => ({
    ...(await orig<typeof import("./media")>()),
    storeMedia: vi.fn(async (id: string, blob: Blob) => void blobs.set(id, blob)),
    loadMedia: vi.fn(async (id: string) => blobs.get(id) ?? null),
}));

await import("../app");
const { editor } = await import("./store");
const { listFiles, fileMeta } = await import("./files");
const { importAsNewFiles } = await import("./images");
const { listenForCaptures, openCapture } = await import("./capture-open");

// Opening page captures in the app: a .nagma-capture.json from Import… (or a drop on Home), and
// the extension's hand-over on the window. Each becomes a new Design draft named after the page,
// with its pictures in the media store.

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const style = { display: "block", position: "static", padding: [0, 0, 0, 0], borderWidths: [0, 0, 0, 0], borderColors: ["", "", "", ""], borderStyles: ["none", "none", "none", "none"], radii: [0, 0, 0, 0], backgroundColor: "rgb(255, 255, 255)", backgrounds: [], shadows: [], opacity: 1, overflowX: "visible", overflowY: "visible", zIndex: null };
const page = (title: string, at = "2026-10-23T00:00:00.000Z") => ({
    format: "nagma-capture",
    version: 1,
    title,
    url: `http://127.0.0.1/${title}.html`,
    capturedAt: at,
    viewport: { w: 800, h: 600 },
    scroll: { w: 800, h: 900 },
    dpr: 1,
    background: "rgb(255, 255, 255)",
    root: { tag: "body", name: "Body", box: { x: 0, y: 0, w: 800, h: 900 }, style, children: [{ tag: "img", name: "Hero", box: { x: 0, y: 0, w: 800, h: 300 }, style, image: { asset: "a1", fit: "cover" }, children: [] }] },
    assets: { a1: { url: "http://127.0.0.1/hero.png", data: PNG } },
    fonts: [],
});

const settle = () => new Promise((r) => setTimeout(r, 120));

describe("opening a page capture", () => {
    it("opens a .nagma-capture.json as a new Design draft named after the page, pictures in the media store", async () => {
        const before = listFiles().length;
        await importAsNewFiles([new File([JSON.stringify(page("Pricing"))], "Pricing.nagma-capture.json", { type: "application/json" })]);
        expect(listFiles().length).toBe(before + 1);
        const state = editor.get();
        expect(fileMeta(state.fileId as string)).toMatchObject({ name: "Pricing", kind: "design" });
        const frame = Object.values(state.doc.nodes).find((n) => n.name === "Pricing" && n.type === "frame");
        expect([frame?.w, frame?.h]).toEqual([800, 900]);
        const ref = Object.values(state.doc.images)[0] as string;
        expect(ref.startsWith("media:")).toBe(true);
        expect(blobs.get(ref.slice("media:".length))?.type).toBe("image/png");
        expect(state.toast).toMatch(/^Captured Pricing\./);
    });

    it("refuses a file that isn't a capture and leaves nothing behind", async () => {
        const before = listFiles().length;
        await importAsNewFiles([new File(['{"hello": "world"}'], "Notes.nagma-capture.json", { type: "application/json" })]);
        expect(editor.get().toast).toBe("Couldn't open Notes.nagma-capture.json: it isn't a page capture.");
        expect(listFiles().length).toBe(before);
    });

    it("takes the extension's hand-over from this window only, once per capture", async () => {
        listenForCaptures();
        const replies: string[] = [];
        const spy = vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => void replies.push((data as { type: string }).type));
        const send = (data: unknown, origin = location.origin, source: Window | null = window) => window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
        const before = listFiles().length;
        send({ type: "nagma-capture-hello" });
        expect(replies).toEqual(["nagma-capture-ready"]);
        // Another origin, or another window, is ignored.
        send({ type: "nagma-capture", capture: page("Elsewhere") }, "https://example.invalid");
        send({ type: "nagma-capture", capture: page("Framed") }, location.origin, null);
        await settle();
        expect(listFiles().length).toBe(before);
        send({ type: "nagma-capture", capture: page("Docs", "2026-10-23T01:00:00.000Z") });
        send({ type: "nagma-capture", capture: page("Docs", "2026-10-23T01:00:00.000Z") });
        await settle();
        expect(replies.filter((r) => r === "nagma-capture-received")).toHaveLength(2);
        expect(listFiles().length).toBe(before + 1);
        expect(fileMeta(editor.get().fileId as string)?.name).toBe("Docs");
        spy.mockRestore();
    });

    it("asks how a capture at several widths opens: frames side by side, or a site", async () => {
        const wide = page("Lumen");
        const capture = { ...wide, label: "Desktop", breakpoints: [{ label: "Phone", width: 375, viewport: { w: 375, h: 600 }, scroll: { w: 375, h: 900 }, background: "rgb(255, 255, 255)", root: { ...wide.root, box: { x: 0, y: 0, w: 375, h: 900 }, children: [{ ...wide.root.children[0], box: { x: 0, y: 0, w: 375, h: 200 } }] } }] };
        const pick = async (id: string) => {
            for (let i = 0; i < 50 && !document.querySelector("[data-choice]"); i++) await new Promise((r) => setTimeout(r, 10));
            expect(document.querySelector("#capture-choice-title")?.textContent).toBe("Open Lumen");
            (document.querySelector(`[data-choice="${id}"]`) as HTMLButtonElement).click();
        };
        const before = listFiles().length;
        const asFrames = openCapture(capture);
        await pick("frames");
        await asFrames;
        let state = editor.get();
        expect(fileMeta(state.fileId as string)?.kind).toBe("design");
        expect(Object.values(state.doc.nodes).filter((n) => n.type === "frame" && /^Lumen \d+$/.test(n.name)).map((n) => n.name).sort()).toEqual(["Lumen 375", "Lumen 800"]);
        const asSite = openCapture(capture);
        await pick("site");
        await asSite;
        state = editor.get();
        expect(fileMeta(state.fileId as string)?.kind).toBe("site");
        expect(state.doc.site).toBe(true);
        // Cancelled: nothing opens.
        const none = openCapture(capture);
        await pick("");
        expect(await none).toBeNull();
        expect(listFiles().length).toBe(before + 2);
    });

    it("offers to compare a page captured before with the file it opened as, and adds a Changes page there", async () => {
        const first = page("Changelog", "2026-10-01T09:00:00.000Z");
        await openCapture(first);
        const fileId = editor.get().fileId as string;
        const before = listFiles().length;
        // Captured again: the hero picture is wider and there's a new heading.
        const second = page("Changelog", "2026-10-23T09:00:00.000Z");
        const heading = { tag: "#text", name: "New", path: "body>h1:0>#text:0", box: { x: 20, y: 320, w: 200, h: 30 }, style, text: { content: "New", style: { family: "Inter", stack: "Inter", size: 24, weight: 700, italic: false, lineHeight: 30, letterSpacing: 0, color: "rgb(0, 0, 0)", align: "left", decoration: "none", transform: "none", whiteSpace: "normal", direction: "ltr" }, runs: [], lines: 1 }, children: [] };
        second.root = { ...second.root, children: [{ ...second.root.children[0], box: { x: 0, y: 0, w: 800, h: 280 } }, heading] } as unknown as typeof second.root;
        const opening = openCapture(second);
        for (let i = 0; i < 50 && !document.querySelector("[data-choice]"); i++) await new Promise((r) => setTimeout(r, 10));
        expect([...document.querySelectorAll("[data-choice]")].map((b) => b.textContent)).toEqual(["Open as a new file", "Compare with ChangelogA new page in that file showing what changed", "Cancel"]);
        (document.querySelector('[data-choice="compare"]') as HTMLButtonElement).click();
        expect(await opening).toMatchObject({ id: fileId });
        expect(listFiles().length).toBe(before);
        const state = editor.get();
        expect(state.fileId).toBe(fileId);
        const pageNode = state.doc.nodes[state.pageId];
        expect(pageNode?.name).toMatch(/^Changes /);
        const names = pageNode?.children.map((id) => state.doc.nodes[id]?.name);
        expect(names).toEqual(["Changelog", "What changed"]);
        const list = state.doc.nodes[pageNode?.children[1] as string];
        expect(list?.children.map((id) => state.doc.nodes[id]?.text)).toEqual(expect.arrayContaining(["Added: New"]));
        expect(state.doc.roots.length).toBe(2);
        expect(state.toast).toMatch(/changes? since the last capture of Changelog/);
    });
});

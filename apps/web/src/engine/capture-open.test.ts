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
const { listenForCaptures } = await import("./capture-open");

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
});

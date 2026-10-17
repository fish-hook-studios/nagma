import { deflateSync } from "fflate";
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Images in pasted layers, and every other way a picture is pasted. The layers are a synthetic
// clipboard (a design-file buffer and a note listing image links, as the other design tool writes
// them); `fetch` is stubbed, so the links are fake and the PNG is made here.

vi.mock("./doc-store", () => import("../test/memory-doc-store"));
// The media store keeps images in IndexedDB, which jsdom lacks: kept in memory here.
vi.mock("./media", async (original) => ({ ...(await original<typeof import("./media")>()), storeMedia: vi.fn(async () => undefined), loadMedia: vi.fn(async () => null) }));
// jsdom can't decode pictures, so placing them is recorded instead.
const placed = vi.hoisted(() => [] as File[][]);
vi.mock("./images", async (original) => ({
    ...(await original<typeof import("./images")>()),
    placeImages: vi.fn(async (files: File[]) => {
        placed.push(files);
    }),
}));

await import("../app");
const { editor } = await import("./store");
const { pasteCopiedLayers, retryPastedImages } = await import("./layer-clipboard");
const { copiedImageUrls, pastedImageId } = await import("./clipboard-images");
const { useShortcuts } = await import("../hooks/use-shortcuts");
const { designDoc } = await import("../test/design-doc");
const { viewport } = await import("./camera");
const auth = await import("./auth");
const { CLIPBOARD_MARKERS, FORMAT_MAGIC, IMAGE_HOSTS } = await import("./interop-format");
const IMAGE_HOST = IMAGE_HOSTS[0];

// A 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const SCHEMA = parseSchema(`
package fig;
struct GUID { uint sessionID; uint localID; }
struct Vector { float x; float y; }
struct Matrix { float m00; float m01; float m02; float m10; float m11; float m12; }
message ParentIndex { GUID guid = 1; string position = 2; }
message Image { byte[] hash = 1; string name = 2; }
message Paint { string type = 1; float opacity = 2; bool visible = 3; Image image = 4; Image imageThumbnail = 5; string imageScaleMode = 6; }
message NodeChange {
  GUID guid = 1;
  ParentIndex parentIndex = 2;
  string type = 3;
  string name = 4;
  Vector size = 5;
  Matrix transform = 6;
  Paint[] fillPaints = 7;
}
message Message { NodeChange[] nodeChanges = 1; }
`);

const hashBytes = (seed: number) => Uint8Array.from({ length: 20 }, (_, i) => (seed * 31 + i * 7) & 255);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const FRAME_IMG = hashBytes(1);
const RECT_IMG = hashBytes(2);
const RECT_THUMB = hashBytes(3);
const g = (sessionID: number, localID: number) => ({ sessionID, localID });
const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const imagePaint = (hash: Uint8Array, thumb?: Uint8Array) => ({ type: "IMAGE", opacity: 1, visible: true, image: { hash, name: "Photo" }, ...(thumb ? { imageThumbnail: { hash: thumb, name: "Photo" } } : {}), imageScaleMode: "FILL" });

// A frame whose only content is its image fill, holding a group with an image-filled rectangle.
function copiedBuffer(): Uint8Array {
    const compiled = compileSchema(SCHEMA) as { encodeMessage: (m: unknown) => Uint8Array };
    const message = {
        nodeChanges: [
            { guid: g(0, 0), type: "DOCUMENT", name: "Document" },
            { guid: g(0, 1), parentIndex: { guid: g(0, 0), position: "!" }, type: "CANVAS", name: "Page 1" },
            { guid: g(1, 2), parentIndex: { guid: g(0, 1), position: "!" }, type: "FRAME", name: "Card", size: { x: 198, y: 198 }, transform: at(0, 0), fillPaints: [imagePaint(FRAME_IMG)] },
            { guid: g(1, 3), parentIndex: { guid: g(1, 2), position: "!" }, type: "GROUP", name: "Group", size: { x: 100, y: 100 }, transform: at(10, 10) },
            { guid: g(1, 4), parentIndex: { guid: g(1, 3), position: "!" }, type: "ROUNDED_RECTANGLE", name: "Pic", size: { x: 100, y: 100 }, transform: at(0, 0), fillPaints: [imagePaint(RECT_IMG, RECT_THUMB)] },
        ],
    };
    const u32 = (n: number) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, n, true);
        return b;
    };
    const chunks = [deflateSync(encodeBinarySchema(SCHEMA)), deflateSync(compiled.encodeMessage(message))];
    const parts = [new TextEncoder().encode(FORMAT_MAGIC.design), u32(101), ...chunks.flatMap((c) => [u32(c.length), c])];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const linkFor = (hash: Uint8Array) => `https://${IMAGE_HOST}/img/aaaa/bbbb/${hex(hash)}?Expires=1&Signature=fake`;
function copiedHtml(hashes: Uint8Array[] = [FRAME_IMG, RECT_IMG, RECT_THUMB]): string {
    const meta = { fileKey: "test", pasteID: 1, dataType: "scene", imageHashes: Object.fromEntries(hashes.map((h) => [hex(h), linkFor(h)])) };
    const metaB64 = btoa(JSON.stringify(meta));
    const { buffer, meta: metaMarkers } = CLIPBOARD_MARKERS;
    return `<meta charset="utf-8"><span data-metadata="<!--${metaMarkers.open}${metaB64}${metaMarkers.close}-->"></span><span data-buffer="<!--${buffer.open}${b64(copiedBuffer())}${buffer.close}-->"></span>`;
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(handler: Handler) {
    const calls: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push(url);
            return handler(url, init);
        }),
    );
    return calls;
}
const png = () => new Response(PNG.slice(), { status: 200, headers: { "content-type": "image/png" } });

const settle = async (until: () => boolean) => {
    for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setTimeout(r, 5));
};

function freshDoc() {
    const { doc } = designDoc([]);
    editor.loadDocument(doc, null);
    Object.assign(viewport, { width: 1600, height: 1000 });
    editor.set({ camera: { x: 0, y: 0, zoom: 1 } });
}

const imageFills = () =>
    Object.values(editor.get().doc.nodes)
        .flatMap((n) => n.fills.map((p) => ({ node: n, paint: p })))
        .filter((x) => x.paint.type === "image");

describe("layers pasted from another design tool bring their images", () => {
    beforeEach(freshDoc);
    afterEach(() => vi.unstubAllGlobals());

    it("reads the image links from the copied layers' note", () => {
        const urls = copiedImageUrls(copiedHtml());
        expect(Object.keys(urls).sort()).toEqual([hex(FRAME_IMG), hex(RECT_IMG), hex(RECT_THUMB)].sort());
        expect(urls[hex(FRAME_IMG)]).toBe(linkFor(FRAME_IMG));
    });

    it("places the layers at once and fills in every image (a frame's own fill and a nested layer's) as it arrives", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        const calls = stubFetch(async () => {
            await gate;
            return png();
        });
        expect(await pasteCopiedLayers(copiedHtml())).toBe(true);
        // The layers are there before any image is: fills point at the images, which are pending.
        const fills = imageFills();
        expect(fills.map((f) => f.node.name).sort()).toEqual(["Card", "Pic"]);
        expect(fills.map((f) => (f.paint as { id: string }).id).sort()).toEqual([pastedImageId(hex(FRAME_IMG)), pastedImageId(hex(RECT_IMG))].sort());
        expect(editor.get().doc.images[pastedImageId(hex(FRAME_IMG))]).toBeUndefined();
        expect(editor.get().toast).toMatch(/Fetching 2 images/);
        const steps = editor.get().past.length;
        release();
        await settle(() => Boolean(editor.get().doc.images[pastedImageId(hex(FRAME_IMG))] && editor.get().doc.images[pastedImageId(hex(RECT_IMG))]));
        expect(editor.get().doc.images[pastedImageId(hex(FRAME_IMG))]).toMatch(/^media:/);
        expect(editor.get().doc.images[pastedImageId(hex(RECT_IMG))]).toMatch(/^media:/);
        // Only the images the fills use are fetched (not the preview), straight from their links.
        expect(calls.sort()).toEqual([linkFor(FRAME_IMG), linkFor(RECT_IMG)].sort());
        expect(editor.get().toast).toBe("Images loaded.");
        // The images aren't undo steps of their own: one undo takes the paste away.
        expect(editor.get().past.length).toBe(steps);
        editor.undo();
        expect(imageFills()).toHaveLength(0);
        editor.redo();
        expect(imageFills()).toHaveLength(2);
    });

    it("an expired link keeps the fill on its image and says what to do, with a retry", async () => {
        stubFetch(() => new Response("<Error>AccessDenied</Error>", { status: 403, headers: { "content-type": "application/xml" } }));
        await pasteCopiedLayers(copiedHtml());
        await settle(() => Boolean(editor.get().toastAction));
        expect(editor.get().toast).toBe("Some images couldn't be loaded. Copy the layers again and paste within a few minutes.");
        expect(editor.get().toast).not.toMatch(/—|f[i]gma/i);
        expect(editor.get().toastAction?.label).toBe("Retry loading images");
        // The fills still name their images, so a retry (or a later paste) fills them in.
        expect(imageFills().map((f) => (f.paint as { id: string }).id).sort()).toEqual([pastedImageId(hex(FRAME_IMG)), pastedImageId(hex(RECT_IMG))].sort());
        expect(Object.keys(editor.get().doc.images)).toHaveLength(0);

        // Copied again: the clipboard now has fresh links, and the retry uses them.
        const fresh = copiedHtml();
        vi.stubGlobal("navigator", { ...navigator, clipboard: { read: async () => [{ types: ["text/html"], getType: async () => new Blob([fresh], { type: "text/html" }) }] } });
        stubFetch(() => png());
        editor.get().toastAction?.run();
        await settle(() => Object.keys(editor.get().doc.images).length === 2);
        expect(Object.keys(editor.get().doc.images).sort()).toEqual([pastedImageId(hex(FRAME_IMG)), pastedImageId(hex(RECT_IMG))].sort());
    });

    it("falls back to the image's preview when the image itself can't be fetched", async () => {
        stubFetch((url) => (url.includes(hex(RECT_IMG)) ? new Response("", { status: 403 }) : png()));
        await pasteCopiedLayers(copiedHtml());
        await settle(() => Object.keys(editor.get().doc.images).length === 2);
        expect(editor.get().doc.images[pastedImageId(hex(RECT_IMG))]).toMatch(/^media:/);
    });

    it("goes through the sync server when the browser can't reach the link", async () => {
        vi.spyOn(auth, "authHeaders").mockReturnValue({ authorization: "Bearer test" });
        const calls = stubFetch((url) => {
            if (url.startsWith(`https://${IMAGE_HOST}/`)) throw new TypeError("Failed to fetch");
            return png();
        });
        await pasteCopiedLayers(copiedHtml());
        await settle(() => Object.keys(editor.get().doc.images).length === 2);
        const proxied = calls.filter((u) => u.includes("/image-proxy?url="));
        expect(proxied).toHaveLength(2);
        expect(decodeURIComponent(proxied[0]!.split("url=")[1]!)).toMatch(new RegExp(`^https://${IMAGE_HOST.replace(/\./g, "\\.")}/img/`));
        vi.mocked(auth.authHeaders).mockRestore();
    });

    it("refuses an answer that isn't an image", async () => {
        stubFetch(() => new Response("<html>login</html>", { status: 200, headers: { "content-type": "image/png" } }));
        await pasteCopiedLayers(copiedHtml());
        await settle(() => Boolean(editor.get().toastAction));
        expect(Object.keys(editor.get().doc.images)).toHaveLength(0);
    });

    it("an image already in the file isn't fetched again", async () => {
        stubFetch(() => png());
        await pasteCopiedLayers(copiedHtml());
        await settle(() => Object.keys(editor.get().doc.images).length === 2);
        const calls = stubFetch(() => png());
        await pasteCopiedLayers(copiedHtml());
        expect(calls).toHaveLength(0);
        expect(editor.get().toast).toBe("Pasted.");
    });

    it("retry with nothing left to fetch does nothing", async () => {
        const calls = stubFetch(() => png());
        await retryPastedImages([]);
        expect(calls).toHaveLength(0);
    });
});

// ---- Which kind of clipboard content wins ----

function Shortcuts() {
    useShortcuts();
    return null;
}

interface Clip {
    html?: string;
    text?: string;
    files?: File[];
}
function pasteEvent({ html = "", text = "", files = [] }: Clip) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const data = {
        getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? text : ""),
        files,
        items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
        types: [...(html ? ["text/html"] : []), ...(text ? ["text/plain"] : []), ...(files.length ? ["Files"] : [])],
    };
    Object.defineProperty(event, "clipboardData", { value: data });
    return event;
}

describe("pasting pictures: what wins", () => {
    let root: ReturnType<typeof createRoot>;
    beforeEach(async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        freshDoc();
        placed.length = 0;
        const host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(Shortcuts)));
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        vi.unstubAllGlobals();
        delete (window as { nagmaDesktop?: unknown }).nagmaDesktop;
    });
    const shot = () => new File([PNG.slice()], "image.png", { type: "image/png" });

    it("copied design layers win over a picture and text on the clipboard", async () => {
        stubFetch(() => png());
        window.dispatchEvent(pasteEvent({ html: copiedHtml(), text: "hello", files: [shot()] }));
        await settle(() => imageFills().length === 2);
        expect(imageFills()).toHaveLength(2);
        expect(placed).toHaveLength(0);
    });

    it("a screenshot (image data) pastes as a picture even with HTML and text alongside", async () => {
        window.dispatchEvent(pasteEvent({ html: "<p>caption</p>", text: "caption", files: [shot()] }));
        await settle(() => placed.length > 0);
        expect(placed[0]?.[0]?.type).toBe("image/png");
        expect(Object.values(editor.get().doc.nodes).some((n) => n.type === "text")).toBe(false);
    });

    it("an <img> copied from a web page pastes the picture (data: URI)", async () => {
        window.dispatchEvent(pasteEvent({ html: `<meta charset="utf-8"><img src="data:image/png;base64,${b64(PNG)}">` }));
        await settle(() => placed.length > 0);
        expect(placed[0]?.[0]?.type).toBe("image/png");
    });

    it("an <img> with an https link is fetched and pasted", async () => {
        const calls = stubFetch(() => png());
        window.dispatchEvent(pasteEvent({ html: `<img src="https://example.com/photo.png">` }));
        await settle(() => placed.length > 0);
        expect(calls).toEqual(["https://example.com/photo.png"]);
        expect(placed[0]?.[0]?.name).toBe("photo.png");
    });

    it("a link to a picture pastes the picture", async () => {
        stubFetch(() => png());
        window.dispatchEvent(pasteEvent({ text: "https://example.com/a/cat.jpg?size=2" }));
        await settle(() => placed.length > 0);
        expect(placed).toHaveLength(1);
    });

    it("text with an inline picture stays text", async () => {
        window.dispatchEvent(pasteEvent({ html: `<p>Hello <img src="https://example.com/i.png"> world</p>`, text: "Hello world" }));
        await settle(() => Object.values(editor.get().doc.nodes).some((n) => n.type === "text"));
        expect(placed).toHaveLength(0);
        expect(Object.values(editor.get().doc.nodes).some((n) => n.type === "text")).toBe(true);
    });

    it("the desktop app's clipboard picture is used when the paste event carried nothing", async () => {
        (window as { nagmaDesktop?: unknown }).nagmaDesktop = { platform: "darwin", readClipboardImage: async () => PNG.slice() };
        window.dispatchEvent(pasteEvent({}));
        await settle(() => placed.length > 0);
        expect(placed[0]?.[0]?.type).toBe("image/png");
    });

    it("the desktop fallback ignores bytes that aren't a PNG", async () => {
        (window as { nagmaDesktop?: unknown }).nagmaDesktop = { platform: "darwin", readClipboardImage: async () => new TextEncoder().encode("<svg/>") };
        window.dispatchEvent(pasteEvent({}));
        await new Promise((r) => setTimeout(r, 30));
        expect(placed).toHaveLength(0);
    });
});

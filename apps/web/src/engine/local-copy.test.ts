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
const { createEmptyDocument, fileMeta, listFiles } = await import("./files");
const { importLocalCopy, localCopyJson, localCopyOf, NotANagmaFile, parseLocalCopy } = await import("./local-copy");
const { importAsNewFiles } = await import("./images");
import type { NagmaDocument } from "./types";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = async (blob: Blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

// A video document: a clip on the timeline from a file in the media bin, and a picture.
function videoDocument(): NagmaDocument {
    const base = createEmptyDocument("Eight products");
    return {
        ...base,
        images: { ...base.images, poster: "media:pic1" },
        sequence: {
            width: 3840,
            height: 2160,
            fps: 30,
            clips: [],
            edit: {
                version: 2,
                root: { id: "root", name: "Sequence", width: 3840, height: 2160, fps: 30, background: "#141413", tracks: [{ id: "v1", kind: "video", name: "V1" }], clips: [{ id: "c1", kind: "video", track: "v1", name: "Loop: Design", start: 0, duration: 6, in: 0, speed: 1, media: "m1", props: {}, anim: {}, blend: "normal", effects: [], masks: [] }], markers: [] },
                comps: [],
                media: [{ id: "m1", kind: "video", name: "loop-design.mp4", store: "vid1", poster: "poster", seconds: 13, width: 1440, height: 900, fps: 30, hasAudio: false }],
            },
        },
    };
}

describe("Save local copy", () => {
    it("embeds the media the document references, by store id, with its type and name", async () => {
        blobs.clear();
        blobs.set("vid1", new Blob([bytes("MP4BYTES")], { type: "video/mp4" }));
        blobs.set("pic1", new Blob([bytes("PNGBYTES")], { type: "image/png" }));
        const copy = await localCopyOf(videoDocument());
        expect(copy.localCopy).toBe(1);
        expect(Object.keys(copy.media ?? {}).sort()).toEqual(["pic1", "vid1"]);
        expect(copy.media?.vid1).toMatchObject({ type: "video/mp4", name: "loop-design.mp4" });
        expect(copy.media?.vid1?.data).toMatch(/^data:video\/mp4;base64,/);
        expect(copy.media?.pic1?.name).toBeUndefined();
        // The document itself is unchanged: the references still point at the store.
        expect(copy.images.poster).toBe("media:pic1");
        expect(copy.sequence?.edit?.media[0]?.store).toBe("vid1");
    });

    it("keeps the plain shape for a document with no media", async () => {
        const doc = createEmptyDocument("Plain");
        const copy = await localCopyOf(doc);
        expect(copy).toBe(doc);
        expect(JSON.parse(await localCopyJson(doc))).not.toHaveProperty("media");
    });
});

describe("Import… of a local copy", () => {
    it("round trip: the document and its media come back under the same ids, as a new draft of the right kind", async () => {
        blobs.clear();
        blobs.set("vid1", new Blob([bytes("MP4BYTES")], { type: "video/mp4" }));
        blobs.set("pic1", new Blob([bytes("PNGBYTES")], { type: "image/png" }));
        const doc = videoDocument();
        const json = await localCopyJson(doc);
        // Another browser: nothing in its store.
        blobs.clear();
        const before = listFiles().length;
        const opened = await importLocalCopy(new File([json], "Eight products.nagma.json", { type: "application/json" }));
        expect(opened).toMatchObject({ name: "Eight products", kind: "video" });
        expect(opened.media.sort()).toEqual(["pic1", "vid1"]);
        expect(blobs.get("vid1")?.type).toBe("video/mp4");
        expect(await text(blobs.get("vid1") as Blob)).toBe("MP4BYTES");
        expect(await text(blobs.get("pic1") as Blob)).toBe("PNGBYTES");
        // Open in the editor, in Drafts, with the document as saved (no media wrapper inside it).
        expect(listFiles().length).toBe(before + 1);
        expect(fileMeta(opened.id)).toMatchObject({ name: "Eight products", kind: "video" });
        const state = editor.get();
        expect(state.fileId).toBe(opened.id);
        expect(state.homeOpen).toBe(false);
        expect(state.sequenceView).toBe(true);
        expect(state.doc).not.toHaveProperty("media");
        expect(state.doc).not.toHaveProperty("localCopy");
        expect(state.doc.sequence?.edit?.root.clips[0]?.media).toBe("m1");
        expect(state.doc.sequence?.edit?.media[0]?.store).toBe("vid1");
        expect(state.doc.images.poster).toBe("media:pic1");
        const { storedDocs } = await import("../test/memory-doc-store");
        expect(storedDocs.get(`nagma.file.${opened.id}`)?.sequence?.edit?.media[0]?.store).toBe("vid1");
    });

    it("reads a copy saved without media (the older plain shape) too", async () => {
        const doc = createEmptyDocument("Plain");
        const opened = await importLocalCopy(new File([JSON.stringify(doc)], "Plain.nagma.json"));
        expect(opened).toMatchObject({ name: "Plain", kind: "design", media: [] });
    });

    it("refuses what isn't a Nagma document", () => {
        expect(() => parseLocalCopy("not json")).toThrow(NotANagmaFile);
        expect(() => parseLocalCopy("[1, 2]")).toThrow(NotANagmaFile);
        expect(() => parseLocalCopy(JSON.stringify({ name: "x", nodes: {} }))).toThrow(NotANagmaFile);
        expect(() => parseLocalCopy(JSON.stringify({ ...createEmptyDocument("x"), localCopy: 99, media: {} }))).toThrow(/newer Nagma/);
        expect(() => parseLocalCopy(JSON.stringify({ ...createEmptyDocument("x"), localCopy: 1, media: { a: { data: "nope" } } }))).toThrow(/damaged/);
    });

    it("a rejected file shows the usual message and leaves no file behind", async () => {
        const before = listFiles().length;
        const { storedDocs } = await import("../test/memory-doc-store");
        const stored = storedDocs.size;
        await importAsNewFiles([new File(['{"hello": "world"}'], "Notes.nagma.json", { type: "application/json" })]);
        expect(editor.get().toast).toBe("Couldn't open Notes.nagma.json: it isn't a Nagma file.");
        expect(listFiles().length).toBe(before);
        expect(storedDocs.size).toBe(stored);
    });
});

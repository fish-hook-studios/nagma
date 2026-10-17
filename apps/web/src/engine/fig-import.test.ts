import "../test/prod-fixtures";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, unzipSync, zlibSync, zipSync } from "fflate";
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { describe, expect, it } from "vitest";
import { expectConsistentTree, expectFiniteGeometry } from "../test/prod-fixtures";
import { decodeFig, figChunks, figKind, figToDocument, importFig, isFigFile, parseBinaryPath, parsePathCommands } from "./fig-import";
import { productDocument } from "./fig-products";
import { FORMAT_MAGIC, TEMPLATE_DATA_FIELD } from "./interop-format";
import { prepareDocument } from "./store";
import type { NagmaDocument, SceneNode } from "./types";

// Real slides (.deck) and campaign (.buzz) exports. They are the user's files, so they are not
// in the repo: the tests read them from NAGMA_FIG_FIXTURES (default: the QA scratch folder) and skip
// when they are not there.
const FIXTURES = process.env.NAGMA_FIG_FIXTURES ?? "/private/tmp/claude-501/-Users-ashwath-Coma/f4545b24-95a1-4961-a8ac-8d5dc65ba640/scratchpad/qa-data/suite/fixtures";
const DECK = join(FIXTURES, "Untitled.deck");
const CAMPAIGN = join(FIXTURES, "Untitled.buzz");
const haveDeck = existsSync(DECK);
const haveCampaign = existsSync(CAMPAIGN);
if (!haveDeck || !haveCampaign) console.warn(`fig-import: real .deck/.buzz fixtures not found in ${FIXTURES} (set NAGMA_FIG_FIXTURES); those tests are skipped.`);

type Raw = Record<string, unknown> & { guid?: { sessionID: number; localID: number }; parentIndex?: { guid: { sessionID: number; localID: number }; position: string }; type?: string; name?: string; size?: { x: number; y: number } };
const key = (g: { sessionID: number; localID: number } | undefined) => (g ? `${g.sessionID}:${g.localID}` : "");
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// The zip's canvas and images, read independently of importFig.
function openZip(path: string) {
    const bytes = new Uint8Array(readFileSync(path));
    const entries = unzipSync(bytes);
    const canvas = entries["canvas.fig"] as Uint8Array;
    const images = new Map<string, Uint8Array>();
    for (const [p, d] of Object.entries(entries)) {
        const m = /^images\/([0-9a-f]+)$/.exec(p);
        if (m?.[1]) images.set(m[1], d);
    }
    return { bytes, entries, canvas, images };
}

// Speaker notes text, parsed here without the importer (Lexical JSON: paragraphs of text nodes).
function notesText(json: string): string {
    const root = (JSON.parse(json) as { root: { children: unknown[] } }).root;
    const para = (n: { type?: string; text?: string; children?: unknown[] }): string => (n.type === "text" ? (n.text ?? "") : n.type === "linebreak" ? "\n" : (n.children ?? []).map((c) => para(c as typeof n)).join(""));
    return root.children.map((p) => para(p as { children?: unknown[] })).join("\n").trim();
}

function dataUrlBytes(url: string): Uint8Array {
    const b64 = url.slice(url.indexOf(",") + 1);
    return new Uint8Array(Buffer.from(b64, "base64"));
}

function subtree(doc: NagmaDocument, id: string): SceneNode[] {
    const n = doc.nodes[id];
    if (!n) return [];
    return [n, ...n.children.flatMap((c) => subtree(doc, c))];
}

function expectImagesResolve(doc: NagmaDocument) {
    const missing: string[] = [];
    for (const n of Object.values(doc.nodes)) for (const p of [...n.fills, ...n.strokes]) if (p.type === "image" && !doc.images[p.id]) missing.push(`${n.name}: ${p.id}`);
    expect(missing).toEqual([]);
}

// A saved file reloads unchanged: JSON round trip, then prepareDocument (what loading a file does).
function expectRoundTrip(doc: NagmaDocument) {
    const saved = JSON.parse(JSON.stringify(doc)) as NagmaDocument;
    const loaded = prepareDocument(JSON.parse(JSON.stringify(doc)) as NagmaDocument);
    expect(loaded).toEqual(saved);
    expect(prepareDocument(JSON.parse(JSON.stringify(loaded)) as NagmaDocument)).toEqual(saved);
}

describe.skipIf(!haveDeck)("real slides file (Untitled.deck)", () => {
    const zip = haveDeck ? openZip(DECK) : null;

    it("is a zip with a slides canvas and decodes to one slide in one section", () => {
        if (!zip) return;
        expect(Object.keys(zip.entries).sort()).toEqual(["canvas.fig", "images/", "meta.json", "thumbnail.png"]);
        expect(new TextDecoder().decode(zip.canvas.subarray(0, 8))).toBe(FORMAT_MAGIC.deck);
        expect(figKind(zip.canvas)).toBe("deck");
        const { message, blobs } = decodeFig(zip.canvas);
        const changes = message.nodeChanges as Raw[];
        expect(changes.length).toBeGreaterThan(100);
        expect(blobs.length).toBe((message.blobs as unknown[]).length);
        const count = (t: string) => changes.filter((c) => c.type === t).length;
        expect([count("DOCUMENT"), count("CANVAS"), count("SLIDE_GRID"), count("SLIDE_ROW"), count("SLIDE")]).toEqual([1, 2, 1, 1, 1]);
    });

    it("imports as a slides file: one 1920×1080 slide, its 16 layers, its section and (empty) notes", async () => {
        if (!zip) return;
        const { message } = decodeFig(zip.canvas);
        const changes = message.nodeChanges as Raw[];
        const rawSlides = changes.filter((c) => c.type === "SLIDE");
        const rawRows = changes.filter((c) => c.type === "SLIDE_ROW");

        const result = await importFig(new File([zip.bytes], "Untitled.deck"));
        expect(result.kind).toBe("deck");
        expect(result.doc.name).toBe("Untitled");
        expect(result.product?.rows.map((r) => r.name)).toEqual(rawRows.map((r) => r.name));
        expect(result.product?.rows.flatMap((r) => r.members)).toEqual(rawSlides.map((s) => key(s.guid)));

        const { doc, kind } = productDocument(result);
        expect(kind).toBe("slides");
        expect(doc.slides).toBe(true);
        const page = doc.nodes[doc.roots[0] as string] as SceneNode;
        expect(page.type).toBe("page");
        expect(page.name).toBe("Slides");
        expect(page.deck?.kind).toBe("deck");
        const deck = page.deck as Extract<NonNullable<SceneNode["deck"]>, { kind: "deck" }>;
        expect(deck.sections.map((s) => s.name)).toEqual(["Section"]);
        // The other root is the format's internal canvas (components), kept hidden.
        expect(doc.roots.slice(1).map((id) => doc.nodes[id]?.internal)).toEqual([true]);

        const slides = page.children.map((id) => doc.nodes[id] as SceneNode).filter((n) => n.deck?.kind === "slide");
        expect(slides).toHaveLength(rawSlides.length);
        for (const [i, raw] of rawSlides.entries()) {
            const slide = doc.nodes[result.ids[key(raw.guid)] as string] as SceneNode;
            expect(slide).toBe(slides[i]);
            // A numeric imported name ("1") becomes "Slide 1".
            expect(slide.name).toBe(/^\d*$/.test(String(raw.name).trim()) ? `Slide ${i + 1}` : raw.name);
            expect([slide.type, slide.w, slide.h, slide.clip]).toEqual(["frame", raw.size?.x, raw.size?.y, true]);
            expect(slide.deck).toMatchObject({ kind: "slide", layout: "blank", section: deck.sections[0]?.id });
            // Speaker notes: the file's are an empty paragraph, so the slide carries none.
            const expectedNotes = typeof raw.slideSpeakerNotes === "string" ? notesText(raw.slideSpeakerNotes) : "";
            expect(expectedNotes).toBe("");
            expect(slide.deck?.kind === "slide" ? (slide.deck.notes ?? "") : null).toBe(expectedNotes);
            // Its direct children, in the format's order, with their names.
            const rawKids = changes.filter((c) => key(c.parentIndex?.guid) === key(raw.guid)).sort((a, b) => ((a.parentIndex?.position ?? "") < (b.parentIndex?.position ?? "") ? -1 : 1));
            expect(rawKids).toHaveLength(16);
            expect(slide.children.map((id) => doc.nodes[id]?.name)).toEqual(rawKids.map((k) => k.name));
            expect(slide.children.map((id) => result.ids[key(rawKids[slide.children.indexOf(id)]?.guid)])).toEqual(slide.children);
        }
        expect(slides[0]?.x).toBe(0);
        expect(slides[0]?.y).toBe(0);
        const title = subtree(doc, slides[0]?.id as string).find((n) => n.type === "text" && /^How to use \S+ Slides$/.test(n.text ?? ""));
        expect(title).toBeDefined();
        // The imported theme reads the first slide (white background, the title's font).
        expect(deck.theme.background).toBe("#FFFFFF");
        expect(deck.theme.headingFont).toBe(title?.fontFamily);
        expect(Object.keys(doc.images)).toEqual([]);
        expect(result.skipped).toEqual(expect.arrayContaining(["noise effects", "pattern paints"]));
    });

    // Regression: result.ids pointed at the old ids of instance layers that linking had renamed.
    it("every raw layer it kept maps to a node, the tree is consistent and nothing is NaN", async () => {
        if (!zip) return;
        const result = await importFig(new File([zip.bytes], "Untitled.deck"));
        for (const [guid, id] of Object.entries(result.ids)) expect(result.doc.nodes[id], guid).toBeDefined();
        const { doc } = productDocument(result);
        expectConsistentTree(result.doc);
        expectConsistentTree(doc);
        expectFiniteGeometry(doc);
        expectImagesResolve(doc);
    });

    it("the slides document survives save and reload unchanged", async () => {
        if (!zip) return;
        const { doc } = productDocument(await importFig(new File([zip.bytes], "Untitled.deck")));
        expectRoundTrip(doc);
    });
});

describe.skipIf(!haveCampaign)("real campaign file (Untitled.buzz)", () => {
    const zip = haveCampaign ? openZip(CAMPAIGN) : null;

    it("is a zip with a campaign canvas, four images and one asset in one row", () => {
        if (!zip) return;
        expect(figKind(zip.canvas)).toBe("campaign");
        expect([...zip.images.keys()].sort()).toEqual(["0ee95b78853c81d0a91790e48057e0dea190c08a", "9131b52c523785ecb50ae5773aedf3341ca1296b", "aa3a92d22ba0b905d3d315881aa9fe467b8fc649", "c0e58423ed91fdc05ba2ee0dd035c1606907b171"]);
        const { message } = decodeFig(zip.canvas);
        const changes = message.nodeChanges as Raw[];
        const rows = changes.filter((c) => c.type === "SLIDE_ROW");
        expect(rows.map((r) => r.name)).toEqual(["Row 1"]);
        const assets = changes.filter((c) => key(c.parentIndex?.guid) === key(rows[0]?.guid));
        expect(assets.map((a) => [a.type, a.name, a.size?.x, a.size?.y, (a[TEMPLATE_DATA_FIELD] as { type?: string } | undefined)?.type])).toEqual([["FRAME", "Untitled", 300, 250, "GOOGLE_MED_AD"]]);
    });

    it("imports as a campaign: a 300×250 medium rectangle with its 11 layers, texts and two images", async () => {
        if (!zip) return;
        const { message } = decodeFig(zip.canvas);
        const changes = message.nodeChanges as Raw[];
        const rawAsset = changes.find((c) => c.name === "Untitled" && c.type === "FRAME") as Raw;
        const rawKids = changes.filter((c) => key(c.parentIndex?.guid) === key(rawAsset.guid)).sort((a, b) => ((a.parentIndex?.position ?? "") < (b.parentIndex?.position ?? "") ? -1 : 1));
        // Image paints in the raw message: hash → layer name.
        const rawImages = new Map<string, string>();
        for (const c of changes) for (const p of (c.fillPaints as { type: string; image?: { hash: Uint8Array } }[] | undefined) ?? []) if (p.type === "IMAGE" && p.image) rawImages.set(String(c.name), hex(p.image.hash));
        expect(Object.fromEntries(rawImages)).toEqual({ Logo: "aa3a92d22ba0b905d3d315881aa9fe467b8fc649", Image: "9131b52c523785ecb50ae5773aedf3341ca1296b" });

        const result = await importFig(new File([zip.bytes], "Untitled.buzz"));
        expect(result.kind).toBe("campaign");
        expect(result.product?.sizeType).toEqual({ [key(rawAsset.guid)]: "GOOGLE_MED_AD" });
        const { doc, kind } = productDocument(result);
        expect(kind).toBe("campaign");
        expect(doc.campaign).toBe(true);
        const page = doc.nodes[doc.roots[0] as string] as SceneNode;
        expect(page.name).toBe("Assets");
        expect(page.fills).toEqual([]);
        const pageData = page.campaign as Extract<NonNullable<SceneNode["campaign"]>, { kind: "page" }>;
        expect(pageData.kind).toBe("page");
        expect(pageData.rows.map((r) => r.name)).toEqual(["Row 1"]);

        const asset = doc.nodes[result.ids[key(rawAsset.guid)] as string] as SceneNode;
        expect(page.children).toEqual([asset.id]);
        expect([asset.name, asset.type, asset.x, asset.y, asset.w, asset.h, asset.clip]).toEqual(["Untitled", "frame", 0, 0, 300, 250, true]);
        expect(asset.campaign).toEqual({ kind: "asset", preset: "medium-rectangle", rowId: pageData.rows[0]?.id });
        expect(asset.children.map((id) => doc.nodes[id]?.name)).toEqual(rawKids.map((k) => k.name));
        expect(asset.children.map((id) => doc.nodes[id]?.type)).toEqual(["rect", "rect", "rect", "text", "ellipse", "ellipse", "rect", "text", "ellipse", "text", "group"]);

        const texts = subtree(doc, asset.id).filter((n) => n.type === "text");
        const rawTexts = changes.filter((c) => c.type === "TEXT").map((c) => [c.name, (c.textData as { characters?: string } | undefined)?.characters]);
        expect(texts.map((t) => [t.name, t.text])).toEqual(rawTexts);
        expect(texts.map((t) => t.name)).toEqual(["Subheadline", "Name", "Quote"]);

        // Each image layer shows the bytes of the image its imported paint points at.
        expect(Object.keys(doc.images)).toHaveLength(2);
        for (const [layer, hash] of rawImages) {
            const node = subtree(doc, asset.id).find((n) => n.name === layer) as SceneNode;
            const paint = node.fills.find((p) => p.type === "image");
            expect(paint?.type).toBe("image");
            const url = doc.images[paint?.type === "image" ? paint.id : ""] as string;
            expect(url.startsWith("data:image/")).toBe(true);
            expect(hex(dataUrlBytes(url))).toBe(hex(zip.images.get(hash) as Uint8Array));
        }
    });

    it("the campaign tree is consistent, finite, its images resolve and it survives save and reload", async () => {
        if (!zip) return;
        const result = await importFig(new File([zip.bytes], "Untitled.buzz"));
        const { doc } = productDocument(result);
        expectConsistentTree(doc);
        expectFiniteGeometry(doc);
        expectImagesResolve(doc);
        expectRoundTrip(doc);
    });
});

// ---- Synthetic files: the container, the schema and message, and the product mapping ----

const SCHEMA = parseSchema(`
package fig;
struct GUID { uint sessionID; uint localID; }
struct Vector { float x; float y; }
message ParentIndex { GUID guid = 1; string position = 2; }
message NodeChange {
  GUID guid = 1;
  ParentIndex parentIndex = 2;
  string type = 3;
  string name = 4;
  Vector size = 5;
  string slideSpeakerNotes = 6;
}
message Message { NodeChange[] nodeChanges = 1; }
`);

function u32(n: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
}

function container(magic: string, chunks: Uint8Array[]): Uint8Array {
    const parts: Uint8Array[] = [new TextEncoder().encode(magic), u32(101)];
    for (const c of chunks) parts.push(u32(c.length), c);
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

const g = (sessionID: number, localID: number) => ({ sessionID, localID });
const notesJson = (...paras: string[]) => JSON.stringify({ root: { type: "root", children: paras.map((t) => ({ type: "paragraph", children: t ? t.split("\n").flatMap((s, i) => (i ? [{ type: "linebreak" }, { type: "text", text: s }] : [{ type: "text", text: s }])) : [] })) } });
const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });

// A deck: two rows ("Intro" with two slides, "" with one), with notes on the first two slides.
function deckMessage() {
    return {
        nodeChanges: [
            { guid: g(0, 0), type: "DOCUMENT", name: "Document" },
            { guid: g(0, 1), parentIndex: { guid: g(0, 0), position: "!" }, type: "CANVAS", name: "Page 1" },
            { guid: g(0, 3), parentIndex: { guid: g(0, 1), position: "!" }, type: "SLIDE_GRID", name: "Presentation", transform: at(0, 0) },
            { guid: g(1, 10), parentIndex: { guid: g(0, 3), position: "!" }, type: "SLIDE_ROW", name: "Intro", transform: at(0, 0) },
            { guid: g(1, 20), parentIndex: { guid: g(0, 3), position: '"' }, type: "SLIDE_ROW", name: "  ", transform: at(0, 1200) },
            { guid: g(1, 11), parentIndex: { guid: g(1, 10), position: "!" }, type: "SLIDE", name: "1", size: { x: 1920, y: 1080 }, transform: at(0, 0), slideSpeakerNotes: notesJson("Hello", "Second line\nwith a break") },
            { guid: g(1, 12), parentIndex: { guid: g(1, 10), position: '"' }, type: "SLIDE", name: "Agenda", size: { x: 1920, y: 1080 }, transform: at(2000, 0), slideSpeakerNotes: "not json" },
            { guid: g(1, 21), parentIndex: { guid: g(1, 20), position: "!" }, type: "SLIDE", name: "3", size: { x: 1920, y: 1080 }, transform: at(0, 0) },
            { guid: g(1, 30), parentIndex: { guid: g(1, 11), position: "!" }, type: "TEXT", name: "Title", size: { x: 400, y: 80 }, transform: at(100, 100), textData: { characters: "Welcome" }, fontSize: 96, fontName: { family: "Inter", style: "Bold" } },
        ],
    };
}

describe("figChunks / figKind / decodeFig on synthetic input", () => {
    const schemaBytes = encodeBinarySchema(SCHEMA);
    const compiled = compileSchema(SCHEMA) as { encodeMessage: (m: unknown) => Uint8Array };
    const message = { nodeChanges: [{ guid: g(0, 0), type: "DOCUMENT", name: "Document" }, { guid: g(0, 1), parentIndex: { guid: g(0, 0), position: "!" }, type: "CANVAS", name: "Page 1" }] };
    const good = (magic: string = FORMAT_MAGIC.design) => container(magic, [deflateSync(schemaBytes), deflateSync(compiled.encodeMessage(message))]);

    it.each([
        [FORMAT_MAGIC.design, "design"],
        [FORMAT_MAGIC.deck, "deck"],
        [FORMAT_MAGIC.campaign, "campaign"],
        [FORMAT_MAGIC.board, "board"],
        ["PK\x03\x04xxxx", "design"],
        ["", "design"],
    ])("figKind(%j) is %s", (magic, kind) => {
        expect(figKind(new TextEncoder().encode(magic))).toBe(kind);
    });

    // Regression: the whiteboard header name is 7 bytes padded to the 8-byte header, and the
    // comparison read all 8, so a real whiteboard file never matched and was refused as unknown.
    it.each([`${FORMAT_MAGIC.board}.`, `${FORMAT_MAGIC.board}\0`, `${FORMAT_MAGIC.board} `])("a whiteboard container with the header %j is recognised and decodes", (magic) => {
        const bytes = good(magic);
        expect(new TextDecoder().decode(bytes.subarray(8, 12))).not.toContain("jam");
        expect(figKind(bytes)).toBe("board");
        expect(figChunks(bytes)).toHaveLength(2);
        expect((decodeFig(bytes).message.nodeChanges as unknown[]).length).toBe(2);
    });

    it.each([`${FORMAT_MAGIC.design.slice(0, 7)}x`, `${FORMAT_MAGIC.board.slice(0, 6)}..`, `${FORMAT_MAGIC.board}m`])("a near-miss header %j is still refused", (magic) => {
        expect(() => figChunks(good(magic))).toThrow(/unknown header/);
    });

    it("decodes a well-formed container with the schema it carries", () => {
        const { message: m, blobs } = decodeFig(good());
        expect((m.nodeChanges as Raw[]).map((c) => [c.type, c.name])).toEqual([
            ["DOCUMENT", "Document"],
            ["CANVAS", "Page 1"],
        ]);
        expect(blobs).toEqual([]);
        expect(figChunks(good(FORMAT_MAGIC.deck))).toHaveLength(2);
    });

    it("also reads zlib-wrapped chunks", () => {
        const bytes = container(FORMAT_MAGIC.campaign, [zlibSync(schemaBytes), zlibSync(compiled.encodeMessage(message))]);
        expect((decodeFig(bytes).message.nodeChanges as unknown[]).length).toBe(2);
    });

    const bad: [string, () => Uint8Array][] = [
        ["empty input", () => new Uint8Array()],
        ["random bytes", () => Uint8Array.from({ length: 4096 }, (_, i) => (i * 2654435761) & 0xff)],
        ["a zip header", () => new TextEncoder().encode("PK\x03\x04 not a canvas")],
        ["only the header", () => new TextEncoder().encode(FORMAT_MAGIC.design)],
        ["header and version, no chunks", () => container(FORMAT_MAGIC.design, [])],
        ["one chunk (no document)", () => container(FORMAT_MAGIC.design, [deflateSync(schemaBytes)])],
        ["a chunk length past the end", () => container(FORMAT_MAGIC.design, [deflateSync(schemaBytes)]).slice(0, 20)],
        ["garbage chunks", () => container(FORMAT_MAGIC.design, [Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), Uint8Array.of(9, 9, 9, 9)])],
        ["truncated deflate data", () => { const full = good(); return full.slice(0, full.length - 10); }],
        ["a huge declared length", () => { const b = good(); new DataView(b.buffer).setUint32(12, 0xffffffff, true); return b; }],
        ["a valid schema and a garbage message", () => container(FORMAT_MAGIC.design, [deflateSync(schemaBytes), deflateSync(Uint8Array.from({ length: 64 }, (_, i) => 200 + (i % 50)))])],
        ["a garbage schema and a valid message", () => container(FORMAT_MAGIC.design, [deflateSync(Uint8Array.of(255, 255, 255, 255, 15, 1, 2)), deflateSync(compiled.encodeMessage(message))])],
    ];
    it.each(bad)("decodeFig rejects %s with a clean Error (no hang)", (_, make) => {
        const started = Date.now();
        let thrown: unknown = null;
        try {
            decodeFig(make());
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(String((thrown as Error).message).length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it("importFig rejects a zip without canvas.fig and a non-fig file with clear messages", async () => {
        await expect(importFig(new File([zipSync({ "meta.json": new TextEncoder().encode("{}") })], "x.fig"))).rejects.toThrow("No canvas.fig inside the file.");
        await expect(importFig(new File([new TextEncoder().encode("hello world, not a design file")], "x.deck"))).rejects.toThrow(/unknown header/);
    });

    it.each([
        ["a.fig", true],
        ["A.DECK", true],
        ["b.buzz", true],
        ["c.jam", false],
        ["fig", false],
        ["deck.pdf", false],
    ])("isFigFile(%s) is %s", (name, yes) => {
        expect(isFigFile(new File([], name))).toBe(yes);
    });
});

describe("figToDocument + productDocument on a synthetic deck and campaign", () => {
    it("rows become sections, slides keep their order, names and notes (one line per paragraph)", async () => {
        const result = await figToDocument(deckMessage(), [], new Map(), "Deck", "deck");
        expect(result.product?.rows).toEqual([
            { name: "Intro", members: ["1:11", "1:12"] },
            { name: "  ", members: ["1:21"] },
        ]);
        expect(result.product?.notes).toEqual({ "1:11": "Hello\nSecond line\nwith a break", "1:12": "" });
        const { doc, kind } = productDocument(result);
        expect(kind).toBe("slides");
        const page = doc.nodes[doc.roots[0] as string] as SceneNode;
        const deck = page.deck as Extract<NonNullable<SceneNode["deck"]>, { kind: "deck" }>;
        expect(deck.sections.map((s) => s.name)).toEqual(["Intro", "Section 2"]);
        const slides = ["1:11", "1:12", "1:21"].map((k) => doc.nodes[result.ids[k] as string] as SceneNode);
        expect(slides.map((s) => s.name)).toEqual(["Slide 1", "Agenda", "Slide 3"]);
        expect(slides.map((s) => (s.deck?.kind === "slide" ? s.deck.section : null))).toEqual([deck.sections[0]?.id, deck.sections[0]?.id, deck.sections[1]?.id]);
        expect(slides.map((s) => (s.deck?.kind === "slide" ? (s.deck.notes ?? "") : null))).toEqual(["Hello\nSecond line\nwith a break", "", ""]);
        expect(slides.every((s) => s.clip && s.w === 1920 && s.h === 1080 && s.parentId === page.id)).toBe(true);
        const title = doc.nodes[result.ids["1:30"] as string] as SceneNode;
        expect([title.type, title.text, title.parentId, title.fontWeight]).toEqual(["text", "Welcome", slides[0]?.id, 700]);
        expect(deck.theme.headingFont).toBe("Inter");
        expectConsistentTree(doc);
        expectFiniteGeometry(doc);
        expectRoundTrip(doc);
    });

    it("a campaign grid maps size types to presets, falls back to a size match, then custom", async () => {
        const message = {
            nodeChanges: [
                { guid: g(0, 0), type: "DOCUMENT" },
                { guid: g(0, 1), parentIndex: { guid: g(0, 0), position: "!" }, type: "CANVAS", name: "Page 1" },
                { guid: g(0, 4), parentIndex: { guid: g(0, 1), position: "!" }, type: "SLIDE_GRID", transform: at(0, 0) },
                { guid: g(1, 1), parentIndex: { guid: g(0, 4), position: "!" }, type: "SLIDE_ROW", name: "Ads", transform: at(0, 0) },
                { guid: g(1, 2), parentIndex: { guid: g(1, 1), position: "!" }, type: "FRAME", name: "A", size: { x: 728, y: 90 }, transform: at(0, 0), [TEMPLATE_DATA_FIELD]: { type: "GOOGLE_LEADERBOARD" } },
                { guid: g(1, 3), parentIndex: { guid: g(1, 1), position: '"' }, type: "FRAME", name: "B", size: { x: 1080, y: 1080 }, transform: at(900, 0) },
                { guid: g(1, 4), parentIndex: { guid: g(1, 1), position: "#" }, type: "FRAME", name: "C", size: { x: 333, y: 777 }, transform: at(2100, 0), [TEMPLATE_DATA_FIELD]: { type: "SOMETHING_NEW" } },
            ],
        };
        const result = await figToDocument(message, [], new Map(), "Ads", "campaign");
        const { doc, kind } = productDocument(result);
        expect(kind).toBe("campaign");
        const presets = ["1:2", "1:3", "1:4"].map((k) => doc.nodes[result.ids[k] as string]?.campaign);
        expect(presets.map((p) => (p?.kind === "asset" ? p.preset : null))).toEqual(["leaderboard", "square", "custom"]);
        // Arranged left to right in their row, ASSET_GAP apart.
        const xs = ["1:2", "1:3", "1:4"].map((k) => doc.nodes[result.ids[k] as string]?.x);
        expect(xs).toEqual([0, 728 + 120, 728 + 120 + 1080 + 120]);
        expectConsistentTree(doc);
        expectRoundTrip(doc);
    });

    it("a design file (no slide grid) stays a design document even from a .deck header", async () => {
        const message = { nodeChanges: [{ guid: g(0, 0), type: "DOCUMENT" }, { guid: g(0, 1), parentIndex: { guid: g(0, 0), position: "!" }, type: "CANVAS", name: "Page 1" }, { guid: g(1, 1), parentIndex: { guid: g(0, 1), position: "!" }, type: "FRAME", name: "F", size: { x: 10, y: 10 }, transform: at(5, 5) }] };
        const result = await figToDocument(message, [], new Map(), "D", "deck");
        expect(result.product).toBeNull();
        expect(productDocument(result).kind).toBe("design");
    });

    it("an empty message still gives a document with one page", async () => {
        const result = await figToDocument({}, [], new Map(), "Empty", "design");
        expect(result.doc.roots).toHaveLength(1);
        expect(result.doc.nodes[result.doc.roots[0] as string]?.type).toBe("page");
        expectConsistentTree(result.doc);
    });
});

// ---- Geometry parsers ----

describe("parsePathCommands", () => {
    it.each([
        ["a closed triangle", "M0 0 L10 0 L10 10 Z", [{ closed: true, points: [[0, 0], [10, 0], [10, 10]] }]],
        ["an open line", "M1.5 2 L3e1 -4", [{ closed: false, points: [[1.5, 2], [30, -4]] }]],
        ["lowercase commands read as absolute", "m0 0 l5 5 z", [{ closed: true, points: [[0, 0], [5, 5]] }]],
        ["a closing point on the start is dropped", "M0 0 L10 0 L10 10 L0 0 Z", [{ closed: true, points: [[0, 0], [10, 0], [10, 10]] }]],
        ["two subpaths", "M0 0 L1 1 Z M5 5 L6 6", [{ closed: true, points: [[0, 0], [1, 1]] }, { closed: false, points: [[5, 5], [6, 6]] }]],
        ["a lone move is dropped", "M3 3", []],
        ["empty text", "", []],
        ["lines without a move are ignored", "L1 1 L2 2", []],
        ["a stray number is skipped", "M0 0 7 L4 4", [{ closed: false, points: [[0, 0], [4, 4]] }]],
    ] as [string, string, { closed: boolean; points: [number, number][] }[]][])("%s", (_, text, want) => {
        const got = parsePathCommands(text).map((s) => ({ closed: s.closed, points: s.points.map((p) => [p.x, p.y]) }));
        expect(got).toEqual(want);
    });

    it("a cubic sets the handles on both ends", () => {
        const [sp] = parsePathCommands("M0 0 C10 0 20 10 30 10");
        expect(sp?.points[0]).toEqual({ x: 0, y: 0, in: null, out: { x: 10, y: 0 } });
        expect(sp?.points[1]).toEqual({ x: 30, y: 10, in: { x: 20, y: 10 }, out: null });
    });

    it("a quadratic becomes the equivalent cubic (handles 2/3 of the way to the control point)", () => {
        const [sp] = parsePathCommands("M0 0 Q30 30 60 0");
        expect(sp?.points[0]?.out).toEqual({ x: 20, y: 20 });
        expect(sp?.points[1]).toMatchObject({ x: 60, y: 0, in: { x: 40, y: 20 } });
    });

    it("a closing cubic keeps its incoming handle on the first point", () => {
        const [sp] = parsePathCommands("M0 0 L10 0 C10 5 5 10 0 0 Z");
        expect(sp?.points).toHaveLength(2);
        expect(sp?.points[0]?.in).toEqual({ x: 5, y: 10 });
    });

    // Regression: a command missing its numbers (a truncated path) gave NaN coordinates.
    it.each(["M0 0 L10", "M0 0 L", "M0 0 C1 2 3 4 5", "M0", "M0 0 Q1 1"])("a truncated path %j gives no NaN points", (text) => {
        for (const sp of parsePathCommands(text)) for (const p of sp.points) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            for (const h of [p.in, p.out]) if (h) expect(Number.isFinite(h.x) && Number.isFinite(h.y)).toBe(true);
        }
    });
});

function binPath(ops: (number | number[])[]): Uint8Array {
    const parts: number[][] = [];
    for (const op of ops) {
        if (typeof op === "number") parts.push([op]);
        else {
            const f = new Uint8Array(new Float32Array(op).buffer);
            parts.push([...f]);
        }
    }
    return Uint8Array.from(parts.flat());
}

describe("parseBinaryPath", () => {
    it("move, lines and close make a closed subpath (closing point on the start dropped)", () => {
        const bytes = binPath([1, [0, 0], 2, [10, 0], 2, [10, 10], 2, [0, 0], 0]);
        const sps = parseBinaryPath(bytes);
        expect(sps.map((s) => ({ closed: s.closed, pts: s.points.map((p) => [p.x, p.y]) }))).toEqual([{ closed: true, pts: [[0, 0], [10, 0], [10, 10]] }]);
    });

    it("cubic and quadratic segments set handles", () => {
        const sps = parseBinaryPath(binPath([1, [0, 0], 4, [10, 0, 20, 10, 30, 10], 3, [60, 40, 30, 70]]));
        expect(sps[0]?.points[0]?.out).toEqual({ x: 10, y: 0 });
        expect(sps[0]?.points[1]).toMatchObject({ x: 30, y: 10, in: { x: 20, y: 10 } });
        const q = sps[0]?.points[2];
        expect(q?.x).toBe(30);
        expect(q?.y).toBe(70);
        expect(sps[0]?.points[1]?.out?.x).toBeCloseTo(30 + (2 / 3) * 30);
    });

    it("reads from a subarray at an odd offset (byteOffset respected)", () => {
        const inner = binPath([1, [1, 2], 2, [3, 4]]);
        const outer = new Uint8Array(inner.length + 3);
        outer.set(inner, 3);
        expect(parseBinaryPath(outer.subarray(3)).map((s) => s.points.map((p) => [p.x, p.y]))).toEqual([[[1, 2], [3, 4]]]);
    });

    it.each([
        ["empty", new Uint8Array()],
        ["an unknown opcode", Uint8Array.of(9, 1, 2, 3)],
        ["a truncated move", Uint8Array.of(1, 0, 0)],
        ["a truncated cubic", binPath([1, [0, 0], 4, [1, 2, 3]])],
        ["a close with nothing open", Uint8Array.of(0, 0, 0)],
    ])("%s gives no subpaths and does not throw", (_, bytes) => {
        expect(parseBinaryPath(bytes)).toEqual([]);
    });

    it("a line with no move starts its own subpath", () => {
        expect(parseBinaryPath(binPath([2, [1, 1], 2, [2, 2]])).map((s) => s.points.length)).toEqual([2]);
    });
});

describe("damaged .fig containers", () => {
    const header = (rest: number[]) => Uint8Array.from([...new TextEncoder().encode(FORMAT_MAGIC.design), 0, 0, 0, 0, ...rest]);
    it("zero padding after the header is not read as millions of empty chunks", () => {
        // A big file of zeros after a valid header pushed an empty chunk per 4 bytes until the tab
        // ran out of memory (a 200 MB file crashed it).
        const bytes = new Uint8Array(4 * 1024 * 1024);
        bytes.set(header([]));
        const started = performance.now();
        expect(() => figChunks(bytes)).toThrow("The .fig file has no document in it.");
        expect(performance.now() - started).toBeLessThan(500);
    });
    it("a chunk that runs past the end says the file is cut off", () => {
        expect(() => figChunks(header([100, 0, 0, 0, 1, 2, 3]))).toThrow("The file is damaged: it ends part way through.");
    });
});

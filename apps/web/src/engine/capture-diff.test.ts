// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { describe, expect, it } from "vitest";
import { changeLine, changesPage, diffCaptures, latestCaptureFrame, normalizeUrl } from "./capture-diff";
import type { Capture, CaptureBox, CaptureNode, CaptureStyle } from "./capture-format";
import { captureToDocument } from "./capture-import";
import type { SceneNode } from "./types";

// Two captures of the same page compared layer by layer: matched by the DOM path the importer keeps,
// then text, pictures and places compared; what's new or gone listed once, at its outermost layer.

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const style = (over: Partial<CaptureStyle> = {}): CaptureStyle => ({ display: "block", position: "static", padding: [0, 0, 0, 0], borderWidths: [0, 0, 0, 0], borderColors: ["", "", "", ""], borderStyles: ["none", "none", "none", "none"], radii: [0, 0, 0, 0], backgroundColor: "rgba(0, 0, 0, 0)", backgrounds: [], shadows: [], opacity: 1, overflowX: "visible", overflowY: "visible", zIndex: null, ...over });
const box = (x: number, y: number, w: number, h: number): CaptureBox => ({ x, y, w, h });
const el = (tag: string, b: CaptureBox, path: string, children: CaptureNode[] = [], extra: Partial<CaptureNode> = {}, bg = "rgb(240, 240, 240)"): CaptureNode => ({ tag, name: extra.name ?? tag, box: b, style: style({ backgroundColor: bg }), path, children, ...extra });
const text = (content: string, b: CaptureBox, path: string): CaptureNode => ({
    tag: "#text",
    name: content,
    box: b,
    path,
    style: style({ display: "inline" }),
    text: { content, style: { family: "Inter", stack: "Inter", size: 16, weight: 400, italic: false, lineHeight: b.h, letterSpacing: 0, color: "rgb(0, 0, 0)", align: "left", decoration: "none", transform: "none", whiteSpace: "normal", direction: "ltr" }, runs: [], lines: 1 },
    children: [],
});

function page(version: 1 | 2): Capture {
    const v2 = version === 2;
    const children = [
        text(v2 ? "Plan it together" : "Plan together", box(40, 40, 300, 40), "body>h1:0>#text:0"),
        el("img", box(40, 100, 400, 200), "body>img:0", [], { name: "Hero", image: { asset: v2 ? "b" : "a", fit: "cover" } }),
        el("a", box(v2 ? 60 : 40, 320, 120, 40), "body>a:0", [], { name: "Get started" }),
        // A section that moves down 30 with everything in it.
        el("section", box(0, v2 ? 430 : 400, 600, 100), "body>section:0", [el("div", box(20, v2 ? 450 : 420, 80, 40), "body>section:0>div:0", [], { name: "Card" }), el("div", box(120, v2 ? 450 : 420, 80, 40), "body>section:0>div:1", [], { name: "Card 2" })], { name: "Features" }),
        ...(v2 ? [el("div", box(400, 40, 100, 40), "body>div:9", [el("span", box(410, 50, 20, 20), "body>div:9>span:0", [], { name: "Dot" }, "rgb(0, 200, 0)")], { name: "New badge" })] : [text("Old copy", box(40, 560, 200, 20), "body>p:0>#text:0")]),
    ];
    return {
        format: "nagma-capture",
        version: 1,
        title: "Lumen",
        url: "https://lumen.test/pricing#top",
        capturedAt: v2 ? "2026-10-23T12:00:00.000Z" : "2026-10-01T09:00:00.000Z",
        viewport: { w: 800, h: 600 },
        scroll: { w: 800, h: 600 },
        dpr: 1,
        background: "rgb(255, 255, 255)",
        root: el("body", box(0, 0, 800, 600), "body", children, { name: "Body" }, "rgba(0, 0, 0, 0)"),
        assets: { a: { url: "https://lumen.test/a.png", data: PNG }, b: { url: "https://lumen.test/b.png", data: PNG } },
        fonts: [],
    };
}

describe("comparing two captures of a page", () => {
    const before = captureToDocument(page(1));
    const after = captureToDocument(page(2));
    const changes = diffCaptures(before.doc.nodes, before.frameId, after.doc.nodes, after.frameId);
    const kinds = (kind: string) => changes.filter((c) => c.kind === kind).map((c) => c.name);

    it("finds changed text, changed pictures, moved layers, and what was added and removed", () => {
        expect(kinds("text")).toEqual(["Plan it together"]);
        expect(changes.find((c) => c.kind === "text")).toMatchObject({ before: { text: "Plan together" }, after: { text: "Plan it together" } });
        expect(kinds("image")).toEqual(["Hero"]);
        expect(kinds("moved")).toEqual(["Get started", "Features"]);
        expect(kinds("added")).toEqual(["New badge"]);
        expect(kinds("removed")).toEqual(["Old copy"]);
    });

    it("lists a moved section once, not each layer that moved with it, and what's new at its outermost layer", () => {
        expect(changes.some((c) => c.name === "Card" || c.name === "Card 2")).toBe(false);
        expect(changes.some((c) => c.name === "Dot")).toBe(false);
    });

    it("finds nothing between a capture and itself", () => {
        const again = captureToDocument(page(1));
        expect(diffCaptures(before.doc.nodes, before.frameId, again.doc.nodes, again.frameId)).toEqual([]);
    });

    it("says what changed in a line each", () => {
        expect(changes.map(changeLine)).toContain("Text changed: “Plan together” to “Plan it together”");
        expect(changes.map(changeLine)).toContain("Moved: Get started (+20 x)");
        expect(changes.map(changeLine)).toContain("Removed: Old copy");
    });

    it("makes a Changes page: the new capture, an outline over each change, and the list beside it", () => {
        const made = changesPage(after.doc, after.frameId, changes, new Date("2026-10-23T12:00:00Z"), "2026-10-01T09:00:00.000Z");
        expect(made.page.name).toMatch(/^Changes 23 Oct 2026/);
        const byId = new Map(made.nodes.map((n) => [n.id, n]));
        const top = made.page.children.map((id) => byId.get(id) as SceneNode);
        expect(top.map((n) => n.name)).toEqual(["Lumen", "What changed"]);
        const overlay = byId.get(top[0]?.children[top[0].children.length - 1] as string) as SceneNode;
        expect([overlay.name, overlay.locked]).toEqual(["Changed layers", true]);
        const outlines = overlay.children.map((id) => byId.get(id) as SceneNode);
        expect(outlines).toHaveLength(changes.length);
        const removed = outlines.find((o) => o.name === "Removed: Old copy") as SceneNode;
        expect([removed.x, removed.y]).toEqual([38, 558]);
        expect(removed.strokes[0]).toMatchObject({ color: "#F04438" });
        const list = byId.get(made.page.children[1] as string) as SceneNode;
        expect(list.x).toBe(880);
        expect(byId.get(list.children[0] as string)?.text).toMatch(/^6 changes since 1 Oct 2026/);
        // Every layer's parent is in the page.
        for (const n of made.nodes.slice(1)) expect(byId.has(n.parentId as string)).toBe(true);
    });

    it("finds the latest capture of an address in a file", () => {
        const doc = { ...after.doc, nodes: { ...after.doc.nodes, ...before.doc.nodes }, roots: [...after.doc.roots, ...before.doc.roots] };
        expect(latestCaptureFrame(doc, "https://lumen.test/pricing")?.id).toBe(after.frameId);
        expect(latestCaptureFrame(doc, "https://lumen.test/about")).toBeNull();
        expect(normalizeUrl("https://lumen.test/pricing/#plans")).toBe("https://lumen.test/pricing");
    });
});

describe("changes inside a layer", () => {
    it("don't list the layer as resized when it only grew around them", () => {
        const at = (n: number) => {
            const c = page(1);
            const list = el("ul", box(40, 600, 300, 20 * n), "body>ul:0", Array.from({ length: n }, (_, i) => text(`Item ${i + 1}`, box(60, 600 + 20 * i, 200, 20), `body>ul:0>li:${i}>#text:0`)), { name: "List" });
            c.root = { ...c.root, box: box(0, 0, 800, 620 + 20 * n), children: [...c.root.children, list] };
            return captureToDocument(c);
        };
        const a = at(2);
        const b = at(3);
        const changes = diffCaptures(a.doc.nodes, a.frameId, b.doc.nodes, b.frameId);
        expect(changes.map((c) => `${c.kind} ${c.name}`)).toEqual(["added Item 3"]);
    });
});

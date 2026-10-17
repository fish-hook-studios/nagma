import "../test/prod-fixtures";
import { describe, expect, it } from "vitest";
import { createBoardDocument, makeConnector, makeSticky, makeTable } from "../board/model";
import { createCampaignDocument } from "../campaign/model";
import { createMakeDocument } from "../make/model";
import { createSiteDocument } from "../site/model";
import { addSlideCommands, createSlidesDocument, slideIds } from "../slides/model";
import { applyCommand } from "./commands";
import { createEmptyDocument } from "./files";
import { makeNode } from "./nodes";
import { imagePaint, linearGradient, solid } from "./paint";
import { prepareDocument } from "./store";
import type { NagmaDocument } from "./types";
import { expectConsistentTree } from "../test/prod-fixtures";

// Every product's document saves as JSON and loads back (prepareDocument, as opening a file does)
// unchanged, and loading twice changes nothing more.

function withLayers(doc: NagmaDocument): NagmaDocument {
    const pageId = doc.roots[0] as string;
    let d: NagmaDocument = { ...doc, images: { ...doc.images, pic: "data:image/png;base64,AAAA" } };
    const frame = makeNode(d, "frame", { x: 10, y: 20, w: 300, h: 200 }, pageId, { name: "Card", fills: [linearGradient("#FF0000", "#0000FF")], layout: { direction: "vertical", gap: 8, padding: [4, 4, 4, 4], primary: "start", counter: "center" } });
    d = applyCommand(d, { type: "node.create", node: frame });
    const text = makeNode(d, "text", { x: 20, y: 30, w: 200, h: 30 }, frame.id, { text: "Héllo «wörld» 👋\nline two", fontSize: 18, spans: [{ start: 0, end: 5, fontWeight: 700 }] });
    d = applyCommand(d, { type: "node.create", node: text });
    const img = makeNode(d, "rect", { x: 20, y: 80, w: 100, h: 100 }, frame.id, { fills: [imagePaint("pic", "fill"), solid("#00000080")], radius: 12, opacity: 0.5 });
    d = applyCommand(d, { type: "node.create", node: img });
    const vec = makeNode(d, "vector", { x: 0, y: 0, w: 50, h: 50 }, pageId, { path: { w: 50, h: 50, subpaths: [{ closed: true, points: [{ x: 0, y: 0, in: null, out: { x: 10, y: 0 } }, { x: 50, y: 50, in: null, out: null }] }] } });
    return applyCommand(d, { type: "node.create", node: vec });
}

function expectRoundTrip(doc: NagmaDocument) {
    expectConsistentTree(doc);
    const json = JSON.stringify(doc);
    const saved = JSON.parse(json) as NagmaDocument;
    const loaded = prepareDocument(JSON.parse(json) as NagmaDocument) as NagmaDocument;
    expect(loaded).toEqual(saved);
    expect(JSON.stringify(prepareDocument(JSON.parse(JSON.stringify(loaded)) as NagmaDocument))).toBe(JSON.stringify(loaded));
}

describe("document save / reload round trip", () => {
    it.each([
        ["design", () => withLayers(createEmptyDocument("Design"))],
        ["video", () => withLayers({ ...createEmptyDocument("Video"), sequence: { width: 1920, height: 1080, fps: 30, clips: [] } })],
        [
            "slides",
            () => {
                let d = createSlidesDocument("Deck");
                d = applyCommand(d, { type: "batch", commands: addSlideCommands(d, "title-body", slideIds(d)[0]).commands });
                return d;
            },
        ],
        [
            "board",
            () => {
                let d = createBoardDocument("Board");
                const page = d.roots[0] as string;
                const a = makeSticky(d, 0, 0, "#FFE299", page, "me");
                d = applyCommand(d, { type: "node.create", node: a });
                const b = makeSticky(d, 400, 0, "#FFE299", page, "me");
                d = applyCommand(d, { type: "node.create", node: b });
                d = applyCommand(d, { type: "node.create", node: makeConnector(d, { id: a.id, side: "right", x: 240, y: 120 }, { id: b.id, side: "left", x: 400, y: 120 }, "curved", "#000000", page) });
                return applyCommand(d, { type: "node.create", node: makeTable(d, 0, 400, page, 2, 2, [["a", "b"], ["c", "d"]]) });
            },
        ],
        ["campaign", () => createCampaignDocument("Campaign")],
        ["site", () => withLayers(createSiteDocument("Site"))],
        ["make", () => createMakeDocument("App")],
    ] as [string, () => NagmaDocument][])("%s", (_, make) => {
        expectRoundTrip(make());
    });

    it("rejects what isn't a document", () => {
        expect(prepareDocument(null)).toBeNull();
        expect(prepareDocument({} as NagmaDocument)).toBeNull();
        expect(prepareDocument({ nodes: {}, roots: "x" } as unknown as NagmaDocument)).toBeNull();
    });

    it("a file saved before pages existed gets its layers onto a page", () => {
        const old = { name: "Old", nodes: { a: { ...makeNode({ name: "", nodes: {}, roots: [], images: {} }, "rect", { x: 0, y: 0, w: 10, h: 10 }, null), id: "a" } }, roots: ["a"] } as unknown as NagmaDocument;
        const loaded = prepareDocument(old) as NagmaDocument;
        expect(loaded.roots).toHaveLength(1);
        const page = loaded.nodes[loaded.roots[0] as string];
        expect(page?.type).toBe("page");
        expect(page?.children).toEqual(["a"]);
        expect(loaded.images).toEqual({});
        expectConsistentTree(loaded);
    });
});

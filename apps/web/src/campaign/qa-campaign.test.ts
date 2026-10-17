import "../test/prod-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../engine/commands";
import { makeNode } from "../engine/nodes";
import { activePage } from "../engine/page";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { fillSeries, groupsOf } from "./bulk-edit";
import { FONT_PAIRS, addFontPair } from "./inserts";
import { resizedCopy } from "./resize";
import { campaign } from "./state";
import { addBlankAsset, addBlankLike, asOneStep, assetsOf, campaignPage, createCampaignDocument, firstAsset, inRow, moveAssetToRow, pageData, placeAsset, rowsOf } from "./model";

// Regression tests from the Campaign QA pass (apps/web/qa/QA-campaign-sites-make.md).

function campaignWith(count: number): { doc: NagmaDocument; ids: string[] } {
    let doc = createCampaignDocument("QA");
    const page = campaignPage(doc) as SceneNode;
    activePage.id = page.id;
    const rowId = pageData(doc).rows[0]?.id as string;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const node = makeNode(doc, "frame", { x: i * 1200, y: 0, w: 1080, h: 1080 }, page.id, { name: `A${i + 1}`, campaign: { kind: "asset", preset: "square", rowId } });
        doc = applyCommand(doc, { type: "node.create", node });
        ids.push(node.id);
    }
    return { doc, ids };
}

const doc = () => editor.get().doc;
const layout = () => rowsOf(doc()).map((v) => [v.row.name, v.assets.map((a) => a.name)]);

describe("rows made for an asset undo with it", () => {
    let ids: string[] = [];
    beforeEach(() => {
        const built = campaignWith(3);
        ids = built.ids;
        editor.loadDocument(built.doc, null);
        activePage.id = (campaignPage(built.doc) as SceneNode).id;
    });

    it("dragging a card onto 'Drop for a new row' is one undo step", async () => {
        await inRow("new", (row) => placeAsset(ids[2] as string, row, null));
        expect(layout()).toEqual([
            ["Row 1", ["A1", "A2"]],
            ["Row 2", ["A3"]],
        ]);
        editor.undo();
        // One undo brings back the single row with all three assets (no empty "Row 2" left over).
        expect(layout()).toEqual([["Row 1", ["A1", "A2", "A3"]]]);
        editor.redo();
        expect(layout()).toEqual([
            ["Row 1", ["A1", "A2"]],
            ["Row 2", ["A3"]],
        ]);
    });

    it("Move to row › New row is one undo step", async () => {
        await inRow("new", (row) => moveAssetToRow(ids[0] as string, row));
        expect(pageData(doc()).rows).toHaveLength(2);
        editor.undo();
        expect(pageData(doc()).rows).toHaveLength(1);
        expect(layout()).toEqual([["Row 1", ["A1", "A2", "A3"]]]);
    });

    it("a blank asset added to a new row from the Add dialog is one undo step", async () => {
        await inRow("new", (row) => addBlankAsset("story", row));
        expect(assetsOf(doc())).toHaveLength(4);
        editor.undo();
        expect(assetsOf(doc())).toHaveLength(3);
        expect(pageData(doc()).rows).toHaveLength(1);
    });

    it("the asset strip's + adds a blank black asset of the current size at once, selected", () => {
        const before = editor.get().past.length;
        expect(addBlankLike(ids[0] as string)).toBe(true);
        const added = assetsOf(doc()).find((a) => !ids.includes(a.id));
        expect(added?.name).toBe("Untitled");
        expect([added?.w, added?.h]).toEqual([1080, 1080]);
        expect(added?.fills[0]).toMatchObject({ type: "solid", color: "#000000" });
        expect(editor.get().selection).toEqual([added?.id]);
        expect(editor.get().past.length).toBe(before + 1);
    });

    it("an existing row adds no row and no extra step", async () => {
        const row = pageData(doc()).rows[0]?.id as string;
        const before = editor.get().past.length;
        await inRow(row, (r) => addBlankAsset("square", r));
        expect(editor.get().past.length).toBe(before + 1);
        expect(pageData(doc()).rows).toHaveLength(1);
    });
});

describe("narrowing the selection after undo keeps redo", () => {
    it("a selection set with history: false adds no step and leaves redo alone", () => {
        const built = campaignWith(3);
        editor.loadDocument(built.doc, null);
        activePage.id = (campaignPage(built.doc) as SceneNode).id;
        placeAsset(built.ids[2] as string, pageData(doc()).rows[0]?.id as string, built.ids[0] as string);
        editor.undo();
        expect(editor.get().future).toHaveLength(1);
        // What the asset view does after an undo that selected several assets: keep one asset's layers.
        const past = editor.get().past.length;
        editor.set({ selection: [built.ids[0] as string] }, { history: false });
        expect(editor.get().selection).toEqual([built.ids[0]]);
        expect(editor.get().past.length).toBe(past);
        expect(editor.get().future).toHaveLength(1);
        editor.redo();
        expect(layout()).toEqual([["Row 1", ["A3", "A1", "A2"]]]);
    });
});

describe("font combinations insert what their tile shows", () => {
    it("an upper-case, semibold second line stays upper-case and semibold", () => {
        const built = campaignWith(1);
        editor.loadDocument(built.doc, null);
        activePage.id = (campaignPage(built.doc) as SceneNode).id;
        campaign.set({ current: built.ids[0] as string });
        editor.set({ selection: [built.ids[0] as string] });
        const pair = FONT_PAIRS.find((p) => p.id === "birthday");
        if (!pair) throw new Error("pair missing");
        addFontPair(pair);
        const stack = Object.values(doc().nodes).find((n) => n.name === "Heading and body") as SceneNode;
        const [head, body] = stack.children.map((id) => doc().nodes[id] as SceneNode);
        expect(head?.text).toBe("HAPPY");
        expect(body?.text).toBe("BIRTHDAY");
        expect(body?.fontWeight).toBe(500);
        expect(body?.fontFamily).toBe("Montserrat");
    });
});

describe("the first asset is the asset list's first", () => {
    it("follows the rows, not the order the layers were made in", async () => {
        const built = campaignWith(2);
        editor.loadDocument(built.doc, null);
        activePage.id = (campaignPage(built.doc) as SceneNode).id;
        // A1 (the oldest layer) moves to a new second row: the list now starts with A2.
        await inRow("new", (row) => moveAssetToRow(built.ids[0] as string, row));
        expect(firstAsset(doc())?.name).toBe("A2");
    });
});

describe("fill handle series", () => {
    it.each([
        [["SKU-1"], 2, ["SKU-2", "SKU-3"]],
        [["A-10", "A-20"], 2, ["A-30", "A-40"]],
        [["$9.99"], 2, ["$10.00", "$10.01"]],
        [["1.8", "1.9"], 2, ["2.0", "2.1"]],
        [["-1"], 2, ["0", "1"]],
        [["Floor -2"], 3, ["Floor -1", "Floor 0", "Floor 1"]],
        [["$5.00"], 1, ["$5.01"]],
        [["v09"], 2, ["v10", "v11"]],
        [["1.5", "2"], 2, ["1.5", "2"]],
    ] as [string[], number, string[]][])("fillSeries(%j, %i)", (source, count, want) => {
        expect(fillSeries(source, count)).toEqual(want);
    });
});

describe("Bulk edit rows follow the asset order", () => {
    it("a reordered copy moves in its group, the template still leads", () => {
        let doc = createCampaignDocument("QA");
        const page = campaignPage(doc) as SceneNode;
        activePage.id = page.id;
        const rowId = pageData(doc).rows[0]?.id as string;
        const tpl = makeNode(doc, "frame", { x: 0, y: 0, w: 100, h: 100 }, page.id, { name: "T", campaign: { kind: "asset", preset: "square", rowId, template: true } });
        doc = applyCommand(doc, { type: "node.create", node: tpl });
        const ids: string[] = [];
        for (const [i, name] of ["C1", "C2", "C3"].entries()) {
            const n = makeNode(doc, "frame", { x: 220 * (i + 1), y: 0, w: 100, h: 100 }, page.id, { name, campaign: { kind: "asset", preset: "square", rowId, sourceId: tpl.id } });
            doc = applyCommand(doc, { type: "node.create", node: n });
            ids.push(n.id);
        }
        editor.loadDocument(doc, null);
        activePage.id = page.id;
        // The grip drags C3 above C1.
        placeAsset(ids[2] as string, rowId, ids[0] as string);
        expect(groupsOf(editor.get().doc).map((g) => g.assets.map((a) => a.name))).toEqual([["T", "C3", "C1", "C2"]]);
    });
});

describe("Resize scales a frame without auto layout as a whole", () => {
    it("a 300×250 ad becomes a story: boxes and places scale with the type", () => {
        let doc = createCampaignDocument("QA");
        const page = campaignPage(doc) as SceneNode;
        activePage.id = page.id;
        const rowId = pageData(doc).rows[0]?.id as string;
        const ad = makeNode(doc, "frame", { x: 0, y: 0, w: 300, h: 250 }, page.id, { name: "Ad", campaign: { kind: "asset", preset: "medium-rectangle", rowId } });
        doc = applyCommand(doc, { type: "node.create", node: ad });
        const text = makeNode(doc, "text", { x: 137, y: 175, w: 133, h: 44 }, ad.id, { name: "Sub", text: "Awarded gold", fontSize: 14, sizing: { h: "fixed", v: "hug" } });
        doc = applyCommand(doc, { type: "node.create", node: text });
        const [root, sub] = resizedCopy([doc.nodes[ad.id] as SceneNode, doc.nodes[text.id] as SceneNode], 1080, 1920) as SceneNode[];
        const k = 1080 / 300;
        expect([root?.w, root?.h]).toEqual([1080, 1920]);
        expect(sub?.fontSize).toBe(Math.round(14 * k));
        // Before the fix the box stayed 133 wide at (137, 175) while the type grew to 50px.
        expect(sub?.w).toBeCloseTo(133 * k, 5);
        expect(sub?.x).toBeCloseTo(137 * k, 5);
        expect(sub?.y).toBeCloseTo(175 * k, 5);
    });
});

describe("turning auto layout on from Freeform is one undo step", () => {
    it("Vertical layout on a frame whose layers need reordering", async () => {
        const { chooseFlow } = await import("../components/auto-layout-panel");
        let doc = createCampaignDocument("QA");
        const page = campaignPage(doc) as SceneNode;
        activePage.id = page.id;
        const rowId = pageData(doc).rows[0]?.id as string;
        const asset = makeNode(doc, "frame", { x: 0, y: 0, w: 400, h: 400 }, page.id, { name: "A", campaign: { kind: "asset", preset: "square", rowId } });
        doc = applyCommand(doc, { type: "node.create", node: asset });
        // Made bottom first, so adding auto layout puts them in order (a reparent) before the flow.
        const low = makeNode(doc, "rect", { x: 10, y: 300, w: 50, h: 50 }, asset.id, { name: "Low" });
        doc = applyCommand(doc, { type: "node.create", node: low });
        const high = makeNode(doc, "rect", { x: 10, y: 10, w: 50, h: 50 }, asset.id, { name: "High" });
        doc = applyCommand(doc, { type: "node.create", node: high });
        editor.loadDocument(doc, null);
        activePage.id = page.id;
        editor.set({ selection: [asset.id] });
        const before = editor.get().past.length;
        chooseFlow([editor.get().doc.nodes[asset.id] as SceneNode], "vertical");
        expect(editor.get().doc.nodes[asset.id]?.layout?.direction).toBe("vertical");
        expect(editor.get().past.length).toBe(before + 1);
        // An asset keeps its size preset (it used to hug its layers and shrink to 599×1110).
        const after = editor.get().doc.nodes[asset.id] as SceneNode;
        expect([after.w, after.h, after.sizing.h, after.sizing.v]).toEqual([400, 400, "fixed", "fixed"]);
        editor.undo();
        expect(editor.get().doc.nodes[asset.id]?.layout ?? null).toBeNull();
    });
});

describe("Add all is one undo step", () => {
    it("several assets added by one press undo together", async () => {
        const built = campaignWith(1);
        editor.loadDocument(built.doc, null);
        activePage.id = (campaignPage(built.doc) as SceneNode).id;
        const row = pageData(doc()).rows[0]?.id as string;
        const before = editor.get().past.length;
        await asOneStep(async () => {
            for (const preset of ["square", "story", "banner"]) {
                addBlankAsset(preset, row);
                await Promise.resolve();
            }
        });
        expect(assetsOf(doc())).toHaveLength(4);
        expect(editor.get().past.length).toBe(before + 1);
        editor.undo();
        expect(assetsOf(doc())).toHaveLength(1);
    });
});

import "../test/prod-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../engine/commands";
import { makeNode } from "../engine/nodes";
import { activePage } from "../engine/page";
import { imagePaint, solid } from "../engine/paint";
import { editor, prepareDocument } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { expectConsistentTree } from "../test/prod-fixtures";
import { guessMapping, parseDelimited, parseXlsx, previewRows, runBulk } from "./bulk";
import { fillSeries, parseTsv } from "./bulk-edit";
import { ASSET_GAP, LOCKED, addRow, assetData, assetsOf, campaignPage, createCampaignDocument, deleteAssets, deleteRow, duplicateAssets, fieldValue, fieldValuePatch, moveAssetToRow, moveRow, pageData, reorderAsset, rowsOf } from "./model";
import { resizeCommands, resizeInPlace, resizedCopy } from "./resize";
import type { BulkSource } from "./types";

// ---- Fixtures: a campaign with a template asset (Headline text, Photo image, Button colour) ----

interface Built {
    doc: NagmaDocument;
    page: SceneNode;
    rowId: string;
    template: SceneNode;
    headline: SceneNode;
    photo: SceneNode;
    button: SceneNode;
}

function build(): Built {
    let doc = createCampaignDocument("Spring");
    const page = campaignPage(doc) as SceneNode;
    activePage.id = page.id;
    const rowId = pageData(doc).rows[0]?.id as string;
    doc = { ...doc, images: { img1: "data:image/png;base64,AAAA", img2: "data:image/png;base64,BBBB" } };
    const template = makeNode(doc, "frame", { x: 0, y: 0, w: 1080, h: 1080 }, page.id, { name: "Post", campaign: { kind: "asset", preset: "square", rowId, template: true } });
    doc = applyCommand(doc, { type: "node.create", node: template });
    const field = (name: string, type: "text" | "image" | "color") => ({ kind: "layer" as const, field: name, type, locks: { ...LOCKED, content: false } });
    const headline = makeNode(doc, "text", { x: 100, y: 100, w: 880, h: 120 }, template.id, { name: "Headline", text: "Hello", fontSize: 96, campaign: field("Headline", "text"), constraints: { h: "left-right", v: "top" }, sizing: { h: "fixed", v: "fixed" } });
    doc = applyCommand(doc, { type: "node.create", node: headline });
    const photo = makeNode(doc, "rect", { x: 0, y: 300, w: 1080, h: 600 }, template.id, { name: "Photo", fills: [imagePaint("img1", "fill")], radius: 40, campaign: field("Photo", "image") });
    doc = applyCommand(doc, { type: "node.create", node: photo });
    const button = makeNode(doc, "rect", { x: 880, y: 960, w: 160, h: 80 }, template.id, { name: "Button", fills: [solid("#4F46E5")], campaign: field("Button", "color"), constraints: { h: "right", v: "bottom" } });
    doc = applyCommand(doc, { type: "node.create", node: button });
    const get = (id: string) => doc.nodes[id] as SceneNode;
    return { doc, page: get(page.id), rowId, template: get(template.id), headline: get(headline.id), photo: get(photo.id), button: get(button.id) };
}

function load(b: Built) {
    editor.loadDocument(b.doc, null);
    activePage.id = b.page.id;
}

const doc = () => editor.get().doc;
const assetNames = () => rowsOf(doc()).map((v) => [v.row.name, v.assets.map((a) => a.name)]);
const textOf = (assetId: string, field: string) => {
    const visit = (id: string): SceneNode | undefined => {
        const n = doc().nodes[id];
        if (!n) return undefined;
        if (n.campaign?.kind === "layer" && n.campaign.field === field) return n;
        for (const c of n.children) {
            const hit = visit(c);
            if (hit) return hit;
        }
        return undefined;
    };
    return visit(assetId);
};

// ---- Parsing spreadsheets ----

describe("parseDelimited", () => {
    it.each([
        ["CSV with a header", "Name,Price\nTea,3\nCoffee,4", ["Name", "Price"], [["Tea", "3"], ["Coffee", "4"]]],
        ["TSV wins when the first line has a tab", "a\tb,c\n1\t2,3", ["a", "b,c"], [["1", "2,3"]]],
        ["semicolons when there are no commas", "a;b\n1;2", ["a", "b"], [["1", "2"]]],
        ["quoted cells with commas, quotes and line breaks", 'Title,Body\n"Hi, you","Say ""yes""\nplease"', ["Title", "Body"], [["Hi, you", 'Say "yes"\nplease']]],
        ["CRLF line ends and a BOM", "﻿a,b\r\n1,2\r\n", ["a", "b"], [["1", "2"]]],
        ["blank lines are dropped", "a,b\n\n1,2\n , \n3,4\n", ["a", "b"], [["1", "2"], ["3", "4"]]],
        ["ragged rows pad to the widest", "a\n1,2,3", ["a", "Column 2", "Column 3"], [["1", "2", "3"]]],
        ["blank header cells get names", " ,b\n1,2", ["Column 1", "b"], [["1", "2"]]],
        ["cells are trimmed", "a , b\n  x ,y  ", ["a", "b"], [["x", "y"]]],
        ["empty text", "", [], []],
        ["header only", "a,b", ["a", "b"], []],
    ])("%s", (_, text, columns, rows) => {
        expect(parseDelimited(text)).toEqual({ columns, rows });
    });
});

describe("parseXlsx", () => {
    it("reads the first sheet with shared strings, inline strings, booleans and gaps", async () => {
        const { strToU8, zipSync } = await import("fflate");
        const files = {
            "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId7"/></sheets></workbook>'),
            "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Target="worksheets/data.xml" Type="x"/></Relationships>'),
            "xl/sharedStrings.xml": strToU8('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>Price</t></si><si><r><t>Te</t></r><r><t>a</t></r></si></sst>'),
            "xl/worksheets/data.xml": strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>On sale</t></is></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3" t="b"><v>1</v></c></row><row r="4"><c r="B4"><v>4.5</v></c></row></sheetData></worksheet>'),
        };
        expect(await parseXlsx(zipSync(files))).toEqual({ columns: ["Name", "Price", "On sale"], rows: [["Tea", "", "TRUE"], ["", "4.5", ""]] });
    });
});

describe("guessMapping and previewRows", () => {
    it.each([
        [["Headline", "Photo", "Button"], ["headline", "Photo URL", "price"], { Headline: "headline", Photo: "Photo URL" }],
        [["Sub head"], ["SUBHEAD"], { "Sub head": "SUBHEAD" }],
        [["Title"], [], {}],
        [[], ["a"], {}],
    ] as [string[], string[], Record<string, string>][])("guessMapping(%j, %j)", (fields, columns, want) => {
        expect(guessMapping(fields, columns)).toEqual(want);
    });

    it("previewRows takes the mapped columns, blank for unmapped fields, at most `limit` rows", () => {
        const source: BulkSource = { templateId: "t", columns: ["a", "b"], rows: [["1", "2"], ["3", "4"], ["5", "6"]], mapping: { X: "b", Y: "missing" } };
        expect(previewRows(source, ["X", "Y", "Z"], 2)).toEqual([
            ["2", "", ""],
            ["4", "", ""],
        ]);
    });
});

describe("fillSeries and parseTsv (bulk edit table)", () => {
    it.each([
        [["1", "2"], 3, ["3", "4", "5"]],
        [["5"], 2, ["6", "7"]],
        [["10", "8"], 3, ["6", "4", "2"]],
        [["Item 1", "Item 3"], 2, ["Item 5", "Item 7"]],
        [["v01"], 3, ["v02", "v03", "v04"]],
        [["1", "0"], 2, ["-1", "-2"]],
        [["$5.00"], 1, ["$5.01"]],
        [["a", "b"], 5, ["a", "b", "a", "b", "a"]],
        [["Item 1", "Thing 2"], 2, ["Item 1", "Thing 2"]],
        [["x"], 0, []],
        // Regression: a count down from a two-digit number kept two digits ("08", "07").
        [["10", "9"], 3, ["8", "7", "6"]],
        [["100", "99"], 2, ["98", "97"]],
    ] as [string[], number, string[]][])("fillSeries(%j, %i)", (source, count, want) => {
        expect(fillSeries(source, count)).toEqual(want);
    });

    it.each([
        ["a\tb\nc\td\n", [["a", "b"], ["c", "d"]]],
        ['"x\ty"\t"say ""hi"""\r\n2\t3', [["x\ty", 'say "hi"'], ["2", "3"]]],
        ['"two\nlines"\tz', [["two\nlines", "z"]]],
        ["", [[""]]],
        ["\t", [["", ""]]],
    ] as [string, string[][]][])("parseTsv(%j)", (text, want) => {
        expect(parseTsv(text)).toEqual(want);
    });
});

// ---- Field values ----

describe("fieldValuePatch / fieldValue", () => {
    const b = build();
    it.each([
        ["text: a new value", b.headline, "text", "Bye", { text: "Bye", spans: undefined }],
        ["text: the same value is no change", b.headline, "text", "Hello", null],
        ["color: a new hex", b.button, "color", "#ff0000", "fills"],
        ["color: the same colour in another case is no change", b.button, "color", "#4f46e5", null],
        ["color: not a colour", b.button, "color", "red", null],
        ["image: the same image is no change", b.photo, "image", "img1", null],
        ["image: a new image", b.photo, "image", "img2", "fills"],
    ] as [string, SceneNode, "text" | "color" | "image", string, unknown][])("%s", (_, node, type, value, want) => {
        const patch = fieldValuePatch(node, type, value);
        if (want === "fills") {
            expect(patch?.fills).toBeDefined();
            expect(fieldValue({ ...node, ...patch } as SceneNode, type).toLowerCase()).toBe(value.toLowerCase());
        } else expect(patch).toEqual(want);
    });

    it("a colour field without a solid fill gets one", () => {
        const patch = fieldValuePatch({ ...b.button, fills: [] }, "color", "#00FF00");
        expect(patch?.fills).toEqual([expect.objectContaining({ type: "solid", color: "#00FF00" })]);
    });
});

// ---- Bulk create ----

describe("runBulk", () => {
    let b: Built;
    beforeEach(() => {
        b = build();
        load(b);
    });
    const source = (rows: string[][]): BulkSource => ({ templateId: b.template.id, columns: ["Title", "Pic", "Colour", "Name"], rows, mapping: { Headline: "Title", Photo: "Pic", Button: "Colour" }, nameColumn: "Name" });

    // Regression: selecting the new assets was an undo step of its own, so the first undo only reselected.
    it("makes one asset per data row in a new row, fills the fields, and undoes in one step", async () => {
        const pool = new Map([["spring.png", "img2"], ["spring", "img2"]]);
        const result = await runBulk(source([["One", "spring.png", "#FF0000", "First"], ["Two", "", "#00FF00", ""], ["Three", "nope.png", "bad", "Third"]]), { rowName: "Bulk", pool });
        expect(result).toEqual({ created: 3, updated: 0, removed: 0, failedImages: ["nope.png"] });
        const rows = rowsOf(doc());
        expect(rows.map((r) => r.row.name)).toEqual(["Row 1", "Bulk"]);
        const made = rows[1]?.assets ?? [];
        expect(made.map((a) => a.name)).toEqual(["First", "Post 2", "Third"]);
        expect(made.map((a) => assetData(a)?.bulkIndex)).toEqual([0, 1, 2]);
        expect(made.map((a) => assetData(a)?.sourceId)).toEqual([b.template.id, b.template.id, b.template.id]);
        expect(made.map((a) => textOf(a.id, "Headline")?.text)).toEqual(["One", "Two", "Three"]);
        expect(made.map((a) => fieldValue(textOf(a.id, "Photo") as SceneNode, "image"))).toEqual(["img2", "img1", "img1"]);
        expect(made.map((a) => fieldValue(textOf(a.id, "Button") as SceneNode, "color"))).toEqual(["#FF0000", "#00FF00", "#4F46E5"]);
        // Laid out in the grid, ASSET_GAP apart.
        expect(made.map((a) => a.x)).toEqual([0, 1080 + ASSET_GAP, 2 * (1080 + ASSET_GAP)]);
        expect(made.every((a) => a.y === made[0]?.y && a.y > 1080)).toBe(true);
        expectConsistentTree(doc());
        // The template is untouched.
        expect(textOf(b.template.id, "Headline")?.text).toBe("Hello");

        editor.undo();
        expect(rowsOf(doc()).map((r) => [r.row.name, r.assets.length])).toEqual([["Row 1", 1]]);
        expect(Object.keys(doc().nodes).sort()).toEqual(Object.keys(b.doc.nodes).sort());
        editor.redo();
        expect(rowsOf(doc())[1]?.assets).toHaveLength(3);
    });

    it("running again on the same row updates changed assets, adds new rows and removes gone ones", async () => {
        await runBulk(source([["One", "", "", "A"], ["Two", "", "", "B"], ["Three", "", "", "C"]]), { rowName: "Bulk" });
        const rowId = rowsOf(doc())[1]?.row.id as string;
        const before = rowsOf(doc())[1]?.assets.map((a) => a.id) ?? [];
        const result = await runBulk(source([["One", "", "", "A"], ["2!", "", "", "B2"]]), { rowId });
        expect(result).toEqual({ created: 0, updated: 1, removed: 1, failedImages: [] });
        const after = rowsOf(doc())[1]?.assets ?? [];
        expect(after.map((a) => a.id)).toEqual(before.slice(0, 2));
        expect(after.map((a) => [a.name, textOf(a.id, "Headline")?.text])).toEqual([
            ["A", "One"],
            ["B2", "2!"],
        ]);
        expect(rowsOf(doc()).map((r) => r.row.bulk?.rows.length ?? null)).toEqual([null, 2]);
        const grow = await runBulk(source([["One", "", "", "A"], ["2!", "", "", "B2"], ["New", "", "", "N"]]), { rowId });
        expect(grow).toMatchObject({ created: 1, updated: 0, removed: 0 });
        editor.undo();
        expect(rowsOf(doc())[1]?.assets).toHaveLength(2);
    });

    it("URL images fail cleanly when they can't be fetched", async () => {
        const result = await runBulk(source([["One", "https://example.invalid/a.png", "", ""]]), {});
        expect(result.failedImages).toEqual(["https://example.invalid/a.png"]);
        expect(result.created).toBe(1);
    });

    it("an empty sheet makes an empty row; a missing template throws", async () => {
        const result = await runBulk(source([]), { rowName: "Nothing" });
        expect(result.created).toBe(0);
        expect(rowsOf(doc()).map((r) => r.row.name)).toEqual(["Row 1", "Nothing"]);
        await expect(runBulk({ ...source([]), templateId: "gone" }, {})).rejects.toThrow("The template is gone.");
    });
});

// ---- Resize ----

describe("resizedCopy / resizeCommands", () => {
    const b = build();
    const nodes = [b.template, b.headline, b.photo, b.button];

    it("square → story: type and corners scale with the shorter side, constraints place layers", () => {
        const [root, headline, photo, button] = resizedCopy(nodes, 1080, 1920) as SceneNode[];
        expect([root?.w, root?.h]).toEqual([1080, 1920]);
        expect(headline?.fontSize).toBe(96);
        // left-right keeps both margins.
        expect([headline?.x, headline?.w]).toEqual([100, 880]);
        // right/bottom keep their distance from those edges.
        expect([button?.x, button?.y]).toEqual([880, 1920 - 120]);
        expect(photo?.radius).toBe(40);
    });

    it("square → leaderboard (728×90): everything scales by 90/1080, never below 6px type", () => {
        const [root, headline, photo] = resizedCopy(nodes, 728, 90) as SceneNode[];
        expect([root?.w, root?.h]).toEqual([728, 90]);
        expect(headline?.fontSize).toBe(Math.max(6, Math.round(96 * (90 / 1080))));
        expect(photo?.radius).toBe(Math.round(40 * (90 / 1080)));
        const tiny = resizedCopy([b.template, { ...b.headline, fontSize: 12 }], 100, 10);
        expect(tiny[1]?.fontSize).toBe(6);
    });

    it("an empty list and a same-size resize are no-ops", () => {
        expect(resizedCopy([], 10, 10)).toEqual([]);
        const same = resizedCopy(nodes, 1080, 1080);
        expect(same.map((n) => [n.x, n.y, n.w, n.h, n.fontSize])).toEqual(nodes.map((n) => [n.x, n.y, n.w, n.h, n.fontSize]));
    });

    it("resize in place changes the preset and is one undo step", () => {
        const fresh = build();
        load(fresh);
        expect(resizeCommands(doc(), "nope", "story")).toEqual([]);
        expect(resizeCommands(doc(), fresh.template.id, "not-a-preset")).toEqual([]);
        resizeInPlace(fresh.template.id, "story");
        const t = doc().nodes[fresh.template.id] as SceneNode;
        expect([t.w, t.h, assetData(t)?.preset]).toEqual([1080, 1920, "story"]);
        expect(doc().nodes[fresh.button.id]?.y).toBe(1920 - 120);
        expectConsistentTree(doc());
        editor.undo();
        const back = doc().nodes[fresh.template.id] as SceneNode;
        expect([back.w, back.h, assetData(back)?.preset]).toEqual([1080, 1080, "square"]);
        expect(doc().nodes[fresh.button.id]?.y).toBe(960);
    });
});

// ---- Asset and row operations across selections ----

describe("asset and row operations", () => {
    let b: Built;
    beforeEach(() => {
        b = build();
        load(b);
    });

    // Regression: as above, one undo after Duplicate removes the copies (not just the selection).
    it("duplicate several assets (non-assets in the selection ignored), then undo", () => {
        duplicateAssets([b.template.id, b.headline.id, "missing"]);
        expect(assetNames()).toEqual([["Row 1", ["Post", "Post copy"]]]);
        const copy = rowsOf(doc())[0]?.assets[1] as SceneNode;
        expect(copy.children).toHaveLength(3);
        expect(assetData(copy)).toMatchObject({ template: false, sourceId: b.template.id, rowId: b.rowId });
        expect(copy.x).toBe(1080 + ASSET_GAP);
        expectConsistentTree(doc());
        expect(editor.get().selection).toEqual([copy.id]);
        editor.undo();
        expect(assetNames()).toEqual([["Row 1", ["Post"]]]);
        expect(editor.get().selection).toEqual([]);
        editor.redo();
        expect(assetNames()).toEqual([["Row 1", ["Post", "Post copy"]]]);
        expect(editor.get().selection).toEqual([copy.id]);
    });

    it("empty and non-asset selections do nothing (no undo step)", () => {
        const steps = editor.get().past.length;
        duplicateAssets([]);
        deleteAssets([]);
        deleteAssets([b.headline.id]);
        duplicateAssets(["nope"]);
        expect(editor.get().past.length).toBe(steps);
        expect(doc()).toBe(editor.get().doc);
        expect(doc().nodes[b.headline.id]).toBeDefined();
    });

    it("delete assets with their layers, undo brings them back", () => {
        duplicateAssets([b.template.id]);
        const ids = rowsOf(doc())[0]?.assets.map((a) => a.id) ?? [];
        deleteAssets(ids);
        expect(assetsOf(doc())).toEqual([]);
        expect(doc().nodes[b.headline.id]).toBeUndefined();
        editor.undo();
        expect(assetsOf(doc()).map((a) => a.id)).toEqual(ids);
        expect(doc().nodes[b.headline.id]).toBeDefined();
    });

    it("reorder within a row, move to another row, move and delete rows", () => {
        duplicateAssets([b.template.id]);
        duplicateAssets([b.template.id]);
        const [a, c, d] = rowsOf(doc())[0]?.assets.map((x) => x.id) ?? [];
        reorderAsset(a as string, "last");
        expect(rowsOf(doc())[0]?.assets.map((x) => x.id)).toEqual([c, d, a]);
        reorderAsset(a as string, "earlier");
        expect(rowsOf(doc())[0]?.assets.map((x) => x.id)).toEqual([c, a, d]);
        const steps = editor.get().past.length;
        reorderAsset(c as string, "first");
        expect(editor.get().past.length).toBe(steps);

        const row2 = addRow("Second");
        moveAssetToRow(d as string, row2);
        expect(rowsOf(doc()).map((r) => r.assets.map((x) => x.id))).toEqual([[c, a], [d]]);
        // Rows stack: the second row sits below the first.
        expect(doc().nodes[d as string]?.y).toBeGreaterThan(1080);
        moveRow(row2, -1);
        expect(rowsOf(doc()).map((r) => r.row.name)).toEqual(["Second", "Row 1"]);
        expect(doc().nodes[d as string]?.y).toBe(0);
        moveRow(row2, -1);
        expect(rowsOf(doc()).map((r) => r.row.name)).toEqual(["Second", "Row 1"]);
        deleteRow(row2);
        expect(rowsOf(doc()).map((r) => [r.row.name, r.assets.length])).toEqual([["Row 1", 2]]);
        expect(doc().nodes[d as string]).toBeUndefined();
        editor.undo();
        expect(rowsOf(doc()).map((r) => [r.row.name, r.assets.length])).toEqual([
            ["Second", 1],
            ["Row 1", 2],
        ]);
        expectConsistentTree(doc());
    });

    it("assets of a deleted row's id fall back to the first row", () => {
        const d = { ...doc(), nodes: { ...doc().nodes, [b.template.id]: { ...b.template, campaign: { kind: "asset" as const, preset: "square", rowId: "ghost" } } } };
        expect(rowsOf(d)[0]?.assets.map((a) => a.id)).toEqual([b.template.id]);
    });

    it("a campaign document survives save and reload", () => {
        duplicateAssets([b.template.id]);
        const saved = JSON.parse(JSON.stringify(doc())) as NagmaDocument;
        expect(prepareDocument(JSON.parse(JSON.stringify(doc())) as NagmaDocument)).toEqual(saved);
    });
});

import { nanoid } from "nanoid";
import { applyCommand } from "../engine/commands";
import { storeDataUrl } from "../engine/image-store";
import { makeNode } from "../engine/nodes";
import { imagePaint, solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, Paint, SceneNode } from "../engine/types";
import type { BrandKit, CampaignData, CampaignRow, FieldKind, LayerLocks } from "./types";

// Campaign documents: size presets, the rows of assets on the canvas, templates and their fields.

export interface SizePreset {
    id: string;
    label: string;
    w: number;
    h: number;
    // The size menu's section.
    group: SizeGroup;
}

export type SizeGroup = "Social" | "Ads" | "Video" | "Web" | "Print";
export const SIZE_GROUPS: SizeGroup[] = ["Social", "Ads", "Video", "Web", "Print"];

// Common marketing sizes. Labels say what the size is for rather than naming a network; print sizes
// are at 300 pixels per inch.
export const SIZE_PRESETS: SizePreset[] = [
    { id: "square", label: "Square post", w: 1080, h: 1080, group: "Social" },
    { id: "portrait", label: "Portrait post", w: 1080, h: 1350, group: "Social" },
    { id: "story", label: "Story", w: 1080, h: 1920, group: "Social" },
    { id: "reel-cover", label: "Reel cover", w: 1080, h: 1920, group: "Social" },
    { id: "landscape", label: "Landscape", w: 1920, h: 1080, group: "Social" },
    { id: "wide", label: "Wide post", w: 1600, h: 900, group: "Social" },
    { id: "feed", label: "Feed post", w: 1200, h: 630, group: "Social" },
    { id: "link", label: "Link share", w: 1200, h: 627, group: "Social" },
    { id: "pro-post", label: "Professional post", w: 1200, h: 1200, group: "Social" },
    { id: "pro-square", label: "Professional post, square", w: 1080, h: 1080, group: "Social" },
    { id: "pro-portrait", label: "Professional post, portrait", w: 1080, h: 1350, group: "Social" },
    { id: "pin", label: "Pin", w: 1000, h: 1500, group: "Social" },
    { id: "cover", label: "Cover banner", w: 1640, h: 624, group: "Social" },
    { id: "event-cover", label: "Event cover", w: 1920, h: 1005, group: "Social" },
    { id: "header", label: "Header banner", w: 1500, h: 500, group: "Social" },
    { id: "profile-banner", label: "Profile banner", w: 1584, h: 396, group: "Social" },
    { id: "article-banner", label: "Article cover", w: 1920, h: 1080, group: "Social" },
    // Display and social ad sizes, named by their shape as ad networks commonly describe them.
    { id: "medium-rectangle", label: "Medium rectangle", w: 300, h: 250, group: "Ads" },
    { id: "large-rectangle", label: "Large rectangle", w: 336, h: 280, group: "Ads" },
    { id: "leaderboard", label: "Leaderboard", w: 728, h: 90, group: "Ads" },
    { id: "half-page", label: "Half page", w: 300, h: 600, group: "Ads" },
    { id: "skyscraper", label: "Wide skyscraper", w: 160, h: 600, group: "Ads" },
    { id: "billboard", label: "Billboard", w: 970, h: 250, group: "Ads" },
    { id: "mobile-banner", label: "Mobile banner", w: 320, h: 50, group: "Ads" },
    { id: "photo-ad", label: "Photo ad", w: 1080, h: 1080, group: "Ads" },
    { id: "square-ad", label: "Square ad", w: 1080, h: 1080, group: "Ads" },
    { id: "portrait-ad", label: "Portrait ad", w: 1080, h: 1350, group: "Ads" },
    { id: "pin-ad", label: "Promoted pin", w: 1000, h: 1500, group: "Ads" },
    { id: "sponsored-landscape", label: "Sponsored landscape", w: 1200, h: 628, group: "Ads" },
    { id: "sponsored-square", label: "Sponsored square", w: 1200, h: 1200, group: "Ads" },
    { id: "sponsored-vertical", label: "Sponsored vertical", w: 720, h: 900, group: "Ads" },
    { id: "thumbnail", label: "Video thumbnail", w: 1280, h: 720, group: "Video" },
    { id: "channel-banner", label: "Channel banner", w: 2560, h: 1440, group: "Video" },
    { id: "video-ad", label: "Video ad", w: 1920, h: 1080, group: "Video" },
    { id: "stream-banner", label: "Stream banner", w: 1200, h: 480, group: "Video" },
    { id: "call-background", label: "Video call background", w: 1920, h: 1080, group: "Video" },
    { id: "banner", label: "Banner", w: 1200, h: 400, group: "Web" },
    { id: "wide-banner", label: "Wide banner", w: 1600, h: 400, group: "Web" },
    { id: "ultrawide-banner", label: "Ultrawide banner", w: 2400, h: 400, group: "Web" },
    { id: "letter", label: "Letter flyer", w: 2550, h: 3300, group: "Print" },
    { id: "a4", label: "A4 flyer", w: 1240, h: 1754, group: "Print" },
    { id: "poster", label: "Poster", w: 5400, h: 7200, group: "Print" },
    { id: "card-landscape", label: "Card, landscape", w: 2100, h: 1500, group: "Print" },
    { id: "card-portrait", label: "Card, portrait", w: 1500, h: 2100, group: "Print" },
    { id: "name-tag-portrait", label: "Name tag, portrait", w: 900, h: 1200, group: "Print" },
    { id: "name-tag-landscape", label: "Name tag, landscape", w: 1200, h: 900, group: "Print" },
];

export function presetFor(id: string | undefined): SizePreset | undefined {
    return SIZE_PRESETS.find((p) => p.id === id);
}

export function presetLabel(node: SceneNode): string {
    const data = node.campaign;
    const preset = data?.kind === "asset" ? presetFor(data.preset) : undefined;
    return preset && preset.w === node.w && preset.h === node.h ? preset.label : "Custom";
}

export const DEFAULT_BRAND: BrandKit = {
    colors: [
        { name: "Ink", color: "#14151A" },
        { name: "Paper", color: "#FFFFFF" },
        { name: "Primary", color: "#4F46E5" },
        { name: "Coral", color: "#F2643D" },
        { name: "Mint", color: "#1DB989" },
        { name: "Sun", color: "#F7C948" },
    ],
    texts: [
        { name: "Headline", fontFamily: "Inter", fontSize: 72, fontWeight: 700 },
        { name: "Body", fontFamily: "Inter", fontSize: 32, fontWeight: 400 },
    ],
    logos: [],
};

export const LOCKED: LayerLocks = { content: true, position: true, style: true };

type PageData = Extract<CampaignData, { kind: "page" }>;
type AssetData = Extract<CampaignData, { kind: "asset" }>;
type LayerData = Extract<CampaignData, { kind: "layer" }>;

// A new campaign: one page and an empty first row.
export function createCampaignDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {}, campaign: true };
    const page = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, {
        name: "Assets",
        // No page colour: the canvas shows the editor's own backdrop around the assets.
        fills: [],
        campaign: { kind: "page", rows: [{ id: nanoid(8), name: "Row 1" }], brand: DEFAULT_BRAND },
    });
    return { ...base, nodes: { [page.id]: page }, roots: [page.id] };
}

export function campaignPage(doc: NagmaDocument): SceneNode | undefined {
    for (const id of doc.roots) {
        const page = doc.nodes[id];
        if (page && !page.internal) return page;
    }
    return undefined;
}

export function pageData(doc: NagmaDocument): PageData {
    const data = campaignPage(doc)?.campaign;
    return data?.kind === "page" ? data : { kind: "page", rows: [], brand: DEFAULT_BRAND };
}

export function brandOf(doc: NagmaDocument): BrandKit {
    return pageData(doc).brand ?? DEFAULT_BRAND;
}

export function pageDataCommand(doc: NagmaDocument, patch: Partial<PageData>): Command | null {
    const page = campaignPage(doc);
    if (!page) return null;
    return { type: "node.update", id: page.id, patch: { campaign: { ...pageData(doc), ...patch } } };
}

export function setPageData(patch: Partial<PageData>) {
    const command = pageDataCommand(editor.get().doc, patch);
    if (command) editor.execute(command);
}

export const assetData = (node: SceneNode | undefined): AssetData | null => (node?.campaign?.kind === "asset" ? node.campaign : null);
export const layerData = (node: SceneNode | undefined): LayerData | null => (node?.campaign?.kind === "layer" ? node.campaign : null);

// Every asset on the campaign's page.
export function assetsOf(doc: NagmaDocument): SceneNode[] {
    const page = campaignPage(doc);
    return (page?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && assetData(n)));
}

// The asset a layer belongs to (itself when it is one).
export function assetOf(doc: NagmaDocument, id: string | null | undefined): SceneNode | null {
    let node = id ? doc.nodes[id] : undefined;
    while (node) {
        if (assetData(node)) return node;
        node = node.parentId ? doc.nodes[node.parentId] : undefined;
    }
    return null;
}

export interface RowView {
    row: CampaignRow;
    assets: SceneNode[];
}

// The rows in order with their assets left to right. Assets of a row that's gone join the first.
export function rowsOf(doc: NagmaDocument): RowView[] {
    const rows = pageData(doc).rows;
    const views: RowView[] = rows.map((row) => ({ row, assets: [] }));
    const byId = new Map(views.map((v) => [v.row.id, v]));
    for (const asset of assetsOf(doc)) {
        const view = byId.get(assetData(asset)?.rowId ?? "") ?? views[0];
        view?.assets.push(asset);
    }
    // Left to right along each line of the row (long rows wrap onto more lines).
    for (const v of views) v.assets.sort((a, b) => a.y - b.y || a.x - b.x);
    return views;
}

// The first asset as the asset list numbers them: the first row's first asset (not the oldest layer).
export function firstAsset(doc: NagmaDocument): SceneNode | null {
    for (const view of rowsOf(doc)) if (view.assets[0]) return view.assets[0];
    return null;
}

export function rowName(doc: NagmaDocument, rowId: string): string {
    return pageData(doc).rows.find((r) => r.id === rowId)?.name ?? "Row";
}

// The template's fields, in layer order (top of the asset first).
export function fieldsOf(doc: NagmaDocument, assetId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        if (layerData(node)) out.push(node);
        for (const child of node.children) visit(child);
    };
    for (const child of doc.nodes[assetId]?.children ?? []) visit(child);
    return out;
}

// A field by name inside an asset.
export function fieldNamed(doc: NagmaDocument, assetId: string, field: string): SceneNode | undefined {
    return fieldsOf(doc, assetId).find((n) => layerData(n)?.field === field);
}

export function templatesOf(doc: NagmaDocument): SceneNode[] {
    return assetsOf(doc).filter((a) => assetData(a)?.template);
}

// What kind of field a layer makes by default.
export function fieldKindFor(node: SceneNode): FieldKind {
    if (node.type === "text") return "text";
    if (node.fills.some((p) => p.type === "image")) return "image";
    return "color";
}

// ---- The grid: rows stacked down the page, assets side by side ----

export const ASSET_GAP = 120;
export const ROW_GAP = 280;

// A row holds this many assets on a line, then wraps onto the next.
export const ROW_WRAP = 12;

// Moves that put every asset in its row's place. Rows start at the page's origin; `order` puts a
// row's assets in the given order instead of their places on the canvas.
export function arrangeCommands(doc: NagmaDocument, order?: Map<string, string[]>): Command[] {
    const commands: Command[] = [];
    let y = 0;
    for (const { row, assets: placed } of rowsOf(doc)) {
        const wanted = order?.get(row.id);
        const assets = wanted ? wanted.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)) : placed;
        let x = 0;
        let tallest = 0;
        assets.forEach((asset, i) => {
            if (i > 0 && i % ROW_WRAP === 0) {
                y += tallest + ASSET_GAP;
                x = 0;
                tallest = 0;
            }
            if (asset.x !== x || asset.y !== y) commands.push({ type: "node.move", ids: [asset.id], dx: x - asset.x, dy: y - asset.y });
            x += asset.w + ASSET_GAP;
            tallest = Math.max(tallest, asset.h);
        });
        y += (assets.length ? tallest : 400) + ROW_GAP;
    }
    return commands;
}

// Runs commands and then tidies the grid, as one undo step (selecting the result joins that step:
// the store folds a selection made right after an edit into it).
export function executeArranged(commands: Command[], select?: string[], order?: Map<string, string[]>) {
    const s = editor.get();
    const after = applyCommand(s.doc, { type: "batch", commands });
    const moves = arrangeCommands(after, order);
    editor.execute({ type: "batch", commands: [...commands, ...moves] });
    if (select) editor.set({ selection: select.filter((id) => editor.get().doc.nodes[id]) });
}

export function tidyGrid() {
    const moves = arrangeCommands(editor.get().doc);
    if (moves.length) editor.execute({ type: "batch", commands: moves });
}

// Where a new asset goes before tidying: after the last one in its row.
function endOfRow(doc: NagmaDocument, rowId: string): { x: number; y: number } {
    const view = rowsOf(doc).find((v) => v.row.id === rowId);
    const last = view?.assets[view.assets.length - 1];
    return last ? { x: last.x + last.w + ASSET_GAP, y: last.y } : { x: 100000, y: 100000 };
}

// ---- Rows ----

export function addRow(name?: string): string {
    const doc = editor.get().doc;
    const rows = pageData(doc).rows;
    const row: CampaignRow = { id: nanoid(8), name: name ?? `Row ${rows.length + 1}` };
    setPageData({ rows: [...rows, row] });
    return row.id;
}

// Runs `make` and folds every undo step it records into one (it may be async: starter templates
// draw their pictures first). "Add all" and a new row with its asset undo in one go.
export async function asOneStep(make: () => unknown): Promise<void> {
    const mark = editor.get().past.at(-1);
    await make();
    const past = editor.get().past;
    const from = mark ? past.lastIndexOf(mark) : -1;
    if (mark && from < 0) return;
    for (let made = past.length - 1 - from; made > 1; made--) editor.mergeLast();
}

// Runs `fill` in a row: the one named, or (for "new") a row added for it. The new row and what
// `fill` puts in it undo as one step, so undo never leaves an empty row behind.
export async function inRow(rowId: string, fill: (rowId: string) => unknown): Promise<void> {
    if (rowId !== "new") {
        await fill(rowId);
        return;
    }
    await asOneStep(() => fill(addRow()));
}

export function renameRow(rowId: string, name: string) {
    const rows = pageData(editor.get().doc).rows.map((r) => (r.id === rowId ? { ...r, name } : r));
    setPageData({ rows });
}

export function deleteRow(rowId: string) {
    const doc = editor.get().doc;
    const view = rowsOf(doc).find((v) => v.row.id === rowId);
    const rows = pageData(doc).rows.filter((r) => r.id !== rowId);
    const commands: Command[] = [];
    if (view?.assets.length) commands.push({ type: "node.delete", ids: view.assets.map((a) => a.id) });
    const data = pageDataCommand(doc, { rows });
    if (data) commands.push(data);
    executeArranged(commands, []);
}

export function moveRow(rowId: string, by: -1 | 1) {
    const rows = [...pageData(editor.get().doc).rows];
    const at = rows.findIndex((r) => r.id === rowId);
    const to = at + by;
    if (at < 0 || to < 0 || to >= rows.length) return;
    const [row] = rows.splice(at, 1);
    if (row) rows.splice(to, 0, row);
    const command = pageDataCommand(editor.get().doc, { rows });
    if (command) executeArranged([command]);
}

// ---- Assets ----

export function addBlankAsset(presetId: string, rowId: string, size?: { w: number; h: number }) {
    const doc = editor.get().doc;
    const page = campaignPage(doc);
    if (!page) return;
    const preset = presetFor(presetId);
    const w = size?.w ?? preset?.w ?? 1080;
    const h = size?.h ?? preset?.h ?? 1080;
    const at = endOfRow(doc, rowId);
    const frame = makeNode(doc, "frame", { x: at.x, y: at.y, w, h }, page.id, {
        name: `${preset?.label ?? "Custom"} ${assetsOf(doc).length + 1}`,
        campaign: { kind: "asset", preset: preset ? presetId : "custom", rowId },
    });
    executeArranged([{ type: "node.create", node: frame }], [frame.id]);
}

// The asset strip's "+": a blank asset at once, the size of the one on show and in its row, named
// "Untitled" and filled black, selected. (Other sizes and templates are in New asset.)
export function addBlankLike(assetId: string): boolean {
    const doc = editor.get().doc;
    const page = campaignPage(doc);
    const source = doc.nodes[assetId];
    const data = assetData(source);
    if (!page || !source || !data) return false;
    const at = endOfRow(doc, data.rowId);
    const frame = makeNode(doc, "frame", { x: at.x, y: at.y, w: source.w, h: source.h }, page.id, {
        name: "Untitled",
        fills: [{ type: "solid", color: "#000000", opacity: 1, visible: true, blend: "normal" }],
        campaign: { kind: "asset", preset: data.preset, rowId: data.rowId },
    });
    executeArranged([{ type: "node.create", node: frame }], [frame.id]);
    return true;
}

// A copy of an asset's layers with fresh ids, its root at (x, y) and in `rowId`.
export function copyAsset(doc: NagmaDocument, assetId: string, at: { x: number; y: number }, patch: Partial<AssetData>, name?: string): SceneNode[] {
    const source = doc.nodes[assetId];
    const data = assetData(source);
    if (!source || !data) return [];
    const ids = new Map<string, string>();
    const out: SceneNode[] = [];
    const dx = at.x - source.x;
    const dy = at.y - source.y;
    const visit = (id: string, parentId: string | null) => {
        const node = doc.nodes[id];
        if (!node) return;
        const copyId = nanoid(10);
        ids.set(id, copyId);
        out.push({ ...node, id: copyId, parentId, children: [], x: node.x + dx, y: node.y + dy });
        for (const child of node.children) visit(child, copyId);
    };
    visit(assetId, source.parentId);
    const root = out[0];
    if (root) {
        root.campaign = { ...data, template: false, published: null, sourceId: data.template ? source.id : (data.sourceId ?? null), bulkIndex: null, ...patch };
        if (name) root.name = name;
        // Instance copies keep pointing at the same main component; the clone's own layers are fresh.
        delete root.flowStart;
    }
    return out;
}

export function createCommands(nodes: SceneNode[]): Command[] {
    return nodes.map((node) => ({ type: "node.create" as const, node: { ...node, children: [] } }));
}

// "Duplicate as variant": a copy of the asset next to it in the same row.
export function duplicateAsset(assetId: string) {
    const doc = editor.get().doc;
    const source = doc.nodes[assetId];
    const data = assetData(source);
    if (!source || !data) return;
    const copies = copyAsset(doc, assetId, { x: source.x + source.w + ASSET_GAP / 2, y: source.y }, { rowId: data.rowId }, `${source.name} copy`);
    if (copies[0]) executeArranged(createCommands(copies), [copies[0].id]);
}

export function setTemplate(assetId: string, on: boolean) {
    const node = editor.get().doc.nodes[assetId];
    const data = assetData(node);
    if (!node || !data) return;
    editor.execute({ type: "node.update", id: assetId, patch: { campaign: { ...data, template: on } } });
}

// Puts an asset in a row before another asset (or at the row's end): dragging it in the asset list.
export function placeAsset(assetId: string, rowId: string, beforeId: string | null) {
    const doc = editor.get().doc;
    const node = doc.nodes[assetId];
    const data = assetData(node);
    if (!node || !data || beforeId === assetId) return;
    const ids = (rowsOf(doc).find((v) => v.row.id === rowId)?.assets ?? []).map((a) => a.id).filter((id) => id !== assetId);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(at < 0 ? ids.length : at, 0, assetId);
    const commands: Command[] = data.rowId === rowId ? [] : [{ type: "node.update", id: assetId, patch: { campaign: { ...data, rowId } } }];
    executeArranged(commands, undefined, new Map([[rowId, ids]]));
}

// Moves an asset along its row: to the start, one place earlier or later, or to the end.
export function reorderAsset(assetId: string, to: "first" | "earlier" | "later" | "last") {
    const doc = editor.get().doc;
    const data = assetData(doc.nodes[assetId]);
    if (!data) return;
    const ids = (rowsOf(doc).find((v) => v.row.id === data.rowId)?.assets ?? []).map((a) => a.id);
    const at = ids.indexOf(assetId);
    if (at < 0) return;
    const index = to === "first" ? 0 : to === "last" ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, at + (to === "earlier" ? -1 : 1)));
    if (index === at) return;
    ids.splice(at, 1);
    ids.splice(index, 0, assetId);
    executeArranged([], undefined, new Map([[data.rowId, ids]]));
}

// Copies of several assets, each right after itself.
export function duplicateAssets(ids: string[]) {
    const doc = editor.get().doc;
    const commands: Command[] = [];
    const created: string[] = [];
    for (const id of ids) {
        const source = doc.nodes[id];
        const data = assetData(source);
        if (!source || !data) continue;
        const copies = copyAsset(doc, id, { x: source.x + source.w + ASSET_GAP / 2 + created.length, y: source.y }, { rowId: data.rowId }, `${source.name} copy`);
        if (!copies[0]) continue;
        created.push(copies[0].id);
        commands.push(...createCommands(copies));
    }
    if (commands.length) executeArranged(commands, created);
}

export function deleteAssets(ids: string[]) {
    const doc = editor.get().doc;
    const assets = ids.filter((id) => assetData(doc.nodes[id]));
    if (assets.length) executeArranged([{ type: "node.delete", ids: assets }], []);
}

export function moveAssetToRow(assetId: string, rowId: string) {
    const doc = editor.get().doc;
    const node = doc.nodes[assetId];
    const data = assetData(node);
    if (!node || !data || data.rowId === rowId) return;
    const at = endOfRow(doc, rowId);
    executeArranged([
        { type: "node.update", id: assetId, patch: { campaign: { ...data, rowId } } },
        { type: "node.move", ids: [assetId], dx: at.x - node.x, dy: at.y - node.y },
    ]);
}

// ---- Template fields ----

export function setLayerField(id: string, patch: Partial<LayerData> | null) {
    const doc = editor.get().doc;
    const node = doc.nodes[id];
    if (!node) return;
    if (patch === null) {
        editor.execute({ type: "node.update", id, patch: { campaign: undefined } });
        return;
    }
    const current = layerData(node) ?? { kind: "layer" as const, field: uniqueField(doc, id, node.name), type: fieldKindFor(node), locks: { ...LOCKED, content: false } };
    editor.execute({ type: "node.update", id, patch: { campaign: { ...current, ...patch } } });
}

function uniqueField(doc: NagmaDocument, id: string, name: string): string {
    const asset = assetOf(doc, id);
    const taken = new Set(asset ? fieldsOf(doc, asset.id).map((n) => layerData(n)?.field) : []);
    let field = name.trim() || "Field";
    let n = 2;
    while (taken.has(field)) field = `${name} ${n++}`;
    return field;
}

// The edits a value makes to a field layer.
export function fieldValuePatch(node: SceneNode, type: FieldKind, value: string): Partial<SceneNode> | null {
    if (type === "text") return node.text === value ? null : { text: value, spans: undefined };
    if (type === "image") {
        const at = node.fills.findIndex((p) => p.type === "image");
        const current = at >= 0 ? node.fills[at] : undefined;
        if (current?.type === "image" && current.id === value) return null;
        const paint: Paint = current?.type === "image" ? { ...current, id: value, original: undefined, adjust: undefined, crop: current.mode === "crop" ? undefined : current.crop, mode: current.mode === "crop" ? "fill" : current.mode } : imagePaint(value, "fill");
        const fills = at >= 0 ? node.fills.map((p, i) => (i === at ? paint : p)) : [...node.fills, paint];
        return { fills };
    }
    if (!/^#[0-9a-f]{3,8}$/i.test(value)) return null;
    const at = node.fills.findIndex((p) => p.type === "solid");
    if (at < 0) return { fills: [...node.fills, solid(value)] };
    const current = node.fills[at];
    if (current?.type === "solid" && current.color.toUpperCase() === value.toUpperCase()) return null;
    return { fills: node.fills.map((p, i) => (i === at && p.type === "solid" ? { ...p, color: value } : p)) };
}

export function fieldValue(node: SceneNode, type: FieldKind): string {
    if (type === "text") return node.text ?? "";
    if (type === "image") {
        const paint = node.fills.find((p) => p.type === "image");
        return paint?.type === "image" ? paint.id : "";
    }
    const paint = node.fills.find((p) => p.type === "solid");
    return paint?.type === "solid" ? paint.color : "";
}

// Commands that fill an asset's fields from values by field name.
export function applyValuesCommands(doc: NagmaDocument, assetId: string, values: Record<string, string>, nodes?: SceneNode[]): Command[] {
    const layers = nodes ? nodes.filter((n) => layerData(n)) : fieldsOf(doc, assetId);
    const out: Command[] = [];
    for (const node of layers) {
        const data = layerData(node);
        if (!data) continue;
        const value = values[data.field];
        if (value === undefined || value === "") continue;
        const patch = fieldValuePatch(node, data.type, value);
        if (patch) out.push({ type: "node.update", id: node.id, patch });
    }
    return out;
}

// ---- The starter template ----

// A soft picture for the starter template's photo field (made here, so there's nothing to fetch).
async function placeholderImage(): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const sky = ctx.createLinearGradient(0, 0, 0, 640);
    sky.addColorStop(0, "#9FC6F5");
    sky.addColorStop(1, "#F7D9C4");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 960, 640);
    ctx.fillStyle = "#FFE9A8";
    ctx.beginPath();
    ctx.arc(700, 190, 80, 0, Math.PI * 2);
    ctx.fill();
    const hill = (color: string, base: number, amp: number, phase: number) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, 640);
        for (let x = 0; x <= 960; x += 20) ctx.lineTo(x, base - Math.sin(x / 160 + phase) * amp);
        ctx.lineTo(960, 640);
        ctx.fill();
    };
    hill("#6F9BD1", 420, 60, 0.4);
    hill("#4C7AB8", 500, 40, 2.1);
    hill("#2F5A94", 570, 30, 4);
    return storeDataUrl(canvas.toDataURL("image/png"));
}

function field(field: string, type: FieldKind, locks: Partial<LayerLocks> = {}, brandOnly = false): CampaignData {
    return { kind: "layer", field, type, locks: { ...LOCKED, ...locks }, ...(brandOnly ? { brandOnly } : {}) };
}

// The starter templates' layouts. Every one has the same fields (Photo, Headline, Subhead, Button
// colour and Button label, where it shows them), so Change layout carries the content across.
export type StarterLayout = "stack" | "split" | "overlay" | "headline" | "banner";
export const STARTER_LAYOUTS: { id: StarterLayout; label: string; about: string }[] = [
    { id: "stack", label: "Photo on top", about: "Photo, then the text and a button" },
    { id: "split", label: "Side by side", about: "Photo on one side, text on the other" },
    { id: "overlay", label: "Full bleed", about: "Text over a full-size photo" },
    { id: "headline", label: "Headline", about: "Big type on a brand colour" },
    { id: "banner", label: "Banner", about: "Logo, headline and button in a line" },
];

// The layers of a starter template at (x, y) in w × h: the asset frame first, then its layers.
export async function starterNodes(doc: NagmaDocument, layout: StarterLayout, w: number, h: number, at: { x: number; y: number }, parentId: string, asset: AssetData): Promise<{ nodes: SceneNode[]; images: Command[] }> {
    const brand = brandOf(doc);
    const ink = brand.colors[0]?.color ?? "#14151A";
    const paper = brand.colors[1]?.color ?? "#FFFFFF";
    const primary = brand.colors[2]?.color ?? "#4F46E5";
    const heading = brand.texts[0];
    const body = brand.texts[1];
    const k = Math.min(w, h) / 1080;
    const pad = Math.round(64 * k);
    const scratch: NagmaDocument = { ...doc, nodes: { ...doc.nodes } };
    const nodes: SceneNode[] = [];
    const add = (node: SceneNode) => {
        scratch.nodes[node.id] = node;
        nodes.push(node);
        return node;
    };
    const images: Command[] = [];
    const photoFill = async () => {
        const imageId = nanoid(12);
        images.push({ type: "image.add", id: imageId, data: await placeholderImage() });
        return imageFillPaint(imageId);
    };
    const onPhoto = layout === "overlay" || layout === "headline";
    const textColor = onPhoto ? paper : ink;
    const frameFor = (patch: Partial<SceneNode>) =>
        add(makeNode(scratch, "frame", { x: at.x, y: at.y, w, h }, parentId, { name: "Template", fills: [solid(layout === "headline" ? primary : paper)], campaign: asset, ...patch }));
    const headlineNode = (parent: string, size = heading?.fontSize ?? 72, align: SceneNode["textAlign"] = "left") =>
        add(
            makeNode(scratch, "text", { x: at.x + pad, y: at.y, w: w - pad * 2, h: 80 }, parent, {
                name: "Headline",
                text: "Summer sale starts now",
                fontFamily: heading?.fontFamily ?? "Inter",
                fontSize: Math.max(10, Math.round(size * k)),
                fontWeight: heading?.fontWeight ?? 700,
                lineHeight: 1.1,
                textAlign: align,
                fills: [solid(textColor)],
                sizing: { h: "fill", v: "hug" },
                campaign: field("Headline", "text", { content: false }),
            }),
        );
    const subheadNode = (parent: string, align: SceneNode["textAlign"] = "left") =>
        add(
            makeNode(scratch, "text", { x: at.x + pad, y: at.y, w: w - pad * 2, h: 40 }, parent, {
                name: "Subhead",
                text: "Up to 40% off everything in store and online.",
                fontFamily: body?.fontFamily ?? "Inter",
                fontSize: Math.max(8, Math.round((body?.fontSize ?? 32) * k)),
                fontWeight: body?.fontWeight ?? 400,
                lineHeight: 1.3,
                textAlign: align,
                fills: [solid(textColor, 0.8)],
                sizing: { h: "fill", v: "hug" },
                campaign: field("Subhead", "text", { content: false }),
            }),
        );
    const logoNode = (parent: string) =>
        add(makeNode(scratch, "text", { x: at.x + pad, y: at.y, w: 100, h: 40 }, parent, { name: "Logo", text: "Northwind", fontFamily: heading?.fontFamily ?? "Inter", fontSize: Math.max(8, Math.round(36 * k)), fontWeight: 800, letterSpacing: -2, fills: [solid(onPhoto ? paper : primary)] }));
    const buttonNodes = (parent: string) => {
        const button = add(
            makeNode(scratch, "frame", { x: at.x, y: at.y, w: 200, h: 72 }, parent, {
                name: "Button",
                fills: [solid(layout === "headline" ? paper : primary)],
                radius: 999,
                layout: { direction: "horizontal", gap: 8, padding: [Math.round(20 * k), Math.round(40 * k), Math.round(20 * k), Math.round(40 * k)], primary: "center", counter: "center" },
                sizing: { h: "hug", v: "hug" },
                campaign: field("Button colour", "color", { style: false }, true),
            }),
        );
        add(
            makeNode(scratch, "text", { x: at.x, y: at.y, w: 100, h: 30 }, button.id, {
                name: "Button label",
                text: "Shop now",
                fontFamily: body?.fontFamily ?? "Inter",
                fontSize: Math.max(8, Math.round(28 * k)),
                fontWeight: 600,
                fills: [solid(layout === "headline" ? primary : paper)],
                campaign: field("Button label", "text", { content: false }),
            }),
        );
        return button;
    };
    const footer = (parent: string) => {
        const bar = add(makeNode(scratch, "frame", { x: at.x + pad, y: at.y, w: w - pad * 2, h: 80 }, parent, { name: "Footer", fills: [], clip: false, layout: { direction: "horizontal", gap: 16, padding: [0, 0, 0, 0], primary: "between", counter: "center" }, sizing: { h: "fill", v: "hug" } }));
        logoNode(bar.id);
        buttonNodes(bar.id);
        return bar;
    };
    if (layout === "stack") {
        const frame = frameFor({ layout: { direction: "vertical", gap: Math.round(28 * k), padding: [pad, pad, pad, pad], primary: "start", counter: "start" } });
        add(makeNode(scratch, "rect", { x: at.x + pad, y: at.y + pad, w: w - pad * 2, h: Math.round(h * 0.45) }, frame.id, { name: "Photo", radius: Math.round(28 * k), fills: [await photoFill()], sizing: { h: "fill", v: "fill" }, campaign: field("Photo", "image", { content: false }) }));
        headlineNode(frame.id);
        subheadNode(frame.id);
        footer(frame.id);
    } else if (layout === "split") {
        const frame = frameFor({ layout: { direction: "horizontal", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } });
        add(makeNode(scratch, "rect", { x: at.x, y: at.y, w: Math.round(w / 2), h }, frame.id, { name: "Photo", fills: [await photoFill()], sizing: { h: "fill", v: "fill" }, campaign: field("Photo", "image", { content: false }) }));
        const column = add(makeNode(scratch, "frame", { x: at.x + w / 2, y: at.y, w: Math.round(w / 2), h }, frame.id, { name: "Text", fills: [], layout: { direction: "vertical", gap: Math.round(24 * k), padding: [pad, pad, pad, pad], primary: "center", counter: "start" }, sizing: { h: "fill", v: "fill" } }));
        headlineNode(column.id, (heading?.fontSize ?? 72) * 0.8);
        subheadNode(column.id);
        buttonNodes(column.id);
        logoNode(column.id);
    } else if (layout === "overlay") {
        const frame = frameFor({ fills: [solid(ink)] });
        add(makeNode(scratch, "rect", { x: at.x, y: at.y, w, h }, frame.id, { name: "Photo", fills: [await photoFill()], constraints: { h: "scale", v: "scale" }, campaign: field("Photo", "image", { content: false }) }));
        add(makeNode(scratch, "rect", { x: at.x, y: at.y + h * 0.4, w, h: h * 0.6 }, frame.id, { name: "Shade", fills: [{ type: "linear", stops: [{ position: 0, color: ink, opacity: 0 }, { position: 1, color: ink, opacity: 0.85 }], from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, opacity: 1, visible: true, blend: "normal" }], constraints: { h: "scale", v: "scale" } }));
        const content = add(makeNode(scratch, "frame", { x: at.x, y: at.y + h * 0.5, w, h: h * 0.5 }, frame.id, { name: "Text", fills: [], layout: { direction: "vertical", gap: Math.round(24 * k), padding: [pad, pad, pad, pad], primary: "end", counter: "start" }, constraints: { h: "scale", v: "scale" } }));
        headlineNode(content.id);
        subheadNode(content.id);
        footer(content.id);
    } else if (layout === "headline") {
        const frame = frameFor({ layout: { direction: "vertical", gap: Math.round(32 * k), padding: [pad, pad, pad, pad], primary: "center", counter: "center" } });
        logoNode(frame.id);
        headlineNode(frame.id, (heading?.fontSize ?? 72) * 1.3, "center");
        subheadNode(frame.id, "center");
        buttonNodes(frame.id);
    } else {
        const k2 = Math.min(1, h / 250);
        const frame = frameFor({ layout: { direction: "horizontal", gap: Math.round(24 * k2), padding: [Math.round(16 * k2), Math.round(32 * k2), Math.round(16 * k2), Math.round(32 * k2)], primary: "start", counter: "center" } });
        logoNode(frame.id);
        const text = headlineNode(frame.id);
        text.fontSize = Math.max(10, Math.round(Math.min(h * 0.28, w * 0.04)));
        text.text = "Summer sale starts now";
        buttonNodes(frame.id);
    }
    // Parents list their layers in the order they were made.
    for (const node of nodes) {
        const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
        if (parent && !parent.children.includes(node.id)) parent.children = [...parent.children, node.id];
    }
    return { nodes, images };
}

const imageFillPaint = (id: string): Paint => imagePaint(id, "fill");

// A ready-made template in one of the starter layouts, at the end of a row.
export async function addStarterTemplate(rowId: string, presetId = "square", layout: StarterLayout = "stack") {
    const doc = editor.get().doc;
    const page = campaignPage(doc);
    if (!page) return;
    const preset = presetFor(presetId) ?? (SIZE_PRESETS[0] as SizePreset);
    const at = endOfRow(doc, rowId);
    const { nodes, images } = await starterNodes(doc, layout, preset.w, preset.h, at, page.id, { kind: "asset", preset: preset.id, rowId, template: true });
    if (!nodes[0]) return;
    executeArranged([...images, ...createCommands(nodes)], [nodes[0].id]);
}

// Copies frames from another file into the campaign as templates (with the images they use).
export function importFramesAsTemplates(source: NagmaDocument, frameIds: string[], rowId: string) {
    const doc = editor.get().doc;
    const page = campaignPage(doc);
    if (!page) return;
    const commands: Command[] = [];
    const created: string[] = [];
    const images = new Set<string>();
    let x = endOfRow(doc, rowId).x;
    for (const frameId of frameIds) {
        const frame = source.nodes[frameId];
        if (!frame) continue;
        const preset = SIZE_PRESETS.find((p) => p.w === Math.round(frame.w) && p.h === Math.round(frame.h));
        const dx = x - frame.x;
        const dy = 100000 - frame.y;
        const visit = (id: string, parentId: string, root: boolean) => {
            const node = source.nodes[id];
            if (!node) return;
            const copyId = nanoid(10);
            for (const p of node.fills) if (p.type === "image") images.add(p.id);
            const copy: SceneNode = { ...node, id: copyId, parentId, children: [], x: node.x + dx, y: node.y + dy, rotation: root ? 0 : node.rotation };
            if (root) {
                copy.type = node.type === "component" || node.type === "instance" ? "frame" : node.type;
                copy.campaign = { kind: "asset", preset: preset?.id ?? "custom", rowId, template: true };
                delete copy.componentId;
                delete copy.componentProps;
                created.push(copyId);
            } else if (node.type === "text") {
                // Text layers become editable fields by default; the designer locks what should stay.
                copy.campaign = field(node.name, "text", { content: false });
            } else if (node.fills.some((p) => p.type === "image")) {
                copy.campaign = field(node.name, "image", { content: false });
            }
            commands.push({ type: "node.create", node: copy });
            for (const child of node.children) visit(child, copyId, false);
        };
        visit(frameId, page.id, true);
        x += frame.w + ASSET_GAP;
    }
    const imageCommands: Command[] = [...images].filter((id) => source.images[id] && !doc.images[id]).map((id) => ({ type: "image.add" as const, id, data: source.images[id] as string }));
    // Instances inside need their main components: copied ones keep working only when the
    // components travel too, so instances are detached into plain frames here.
    const plain = commands.map((c) => (c.type === "node.create" && c.node.type === "instance" ? { ...c, node: { ...c.node, type: "frame" as const, componentId: undefined, sourceId: undefined } } : c));
    executeArranged([...imageCommands, ...plain], created);
    return created.length;
}

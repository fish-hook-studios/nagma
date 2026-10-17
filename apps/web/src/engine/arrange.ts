import { matchingLayers } from "./matching";
import { renderSelectionToPng } from "../canvas/render";
import { openRenameDialog } from "./rename-layers";
import { fitRect } from "./camera";
import { exportSelectionSvg } from "./export-svg";
import { inlineImages } from "./image-store";
import { expandGroups, selectionBounds, topLevel } from "./nodes";
import { layerRoots } from "./page";
import { realPages } from "./pages";
import { editor } from "./store";
import { refuseExport } from "./share-settings";
import { applyVector, corners, normalizeAngle, spaceMatrix, worldBounds } from "./transform";
import type { Command, NagmaDocument, SceneNode } from "./types";

// Arrange, selection and edit commands beyond the basics: align, distribute, tidy, rotate, select
// by likeness, opacity keys, property copy and paste, paste to replace, copy as image, rename.

type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

function selectedNodes(): { doc: NagmaDocument; nodes: SceneNode[] } {
    const { doc, selection } = editor.get();
    return { doc, nodes: topLevel(doc, selection).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)) };
}

function moveBy(doc: NagmaDocument, node: SceneNode, dx: number, dy: number): Command {
    const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), Math.round(dx), Math.round(dy));
    return { type: "node.move", ids: [node.id], dx: d.x, dy: d.y };
}

// One layer aligns to its parent frame; several align to their shared bounds. With `toParent`
// (⇧-click in the Design panel) every layer aligns to its own parent frame.
export function alignSelection(mode: AlignMode, toParent = false) {
    const { doc, nodes } = selectedNodes();
    const first = nodes[0];
    if (!first) return;
    const parentNode = nodes.length === 1 && first.parentId ? doc.nodes[first.parentId] : undefined;
    const parent = parentNode?.type === "page" ? undefined : parentNode;
    const shared = parent ? selectionBounds(doc, [parent.id]) : selectionBounds(doc, nodes.map((n) => n.id));
    if (!shared) return;
    const commands = nodes.map((node) => {
        const own = toParent && node.parentId && doc.nodes[node.parentId]?.type !== "page" ? selectionBounds(doc, [node.parentId]) : null;
        const target = own ?? shared;
        const box = selectionBounds(doc, [node.id]) ?? node;
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = target.x - box.x;
        if (mode === "hcenter") dx = target.x + target.w / 2 - (box.x + box.w / 2);
        if (mode === "right") dx = target.x + target.w - (box.x + box.w);
        if (mode === "top") dy = target.y - box.y;
        if (mode === "vcenter") dy = target.y + target.h / 2 - (box.y + box.h / 2);
        if (mode === "bottom") dy = target.y + target.h - (box.y + box.h);
        return moveBy(doc, node, dx, dy);
    });
    editor.execute({ type: "batch", commands });
}

// Even gaps between layers along one axis, keeping the first and last where they are.
export function distributeSelection(axis: "h" | "v") {
    const { doc, nodes } = selectedNodes();
    if (nodes.length < 3) return;
    const boxed = nodes.map((node) => ({ node, box: worldBounds(doc, node) })).sort((a, b) => (axis === "h" ? a.box.x - b.box.x : a.box.y - b.box.y));
    const first = boxed[0] as (typeof boxed)[number];
    const last = boxed[boxed.length - 1] as (typeof boxed)[number];
    const total = axis === "h" ? last.box.x + last.box.w - first.box.x : last.box.y + last.box.h - first.box.y;
    const sizes = boxed.reduce((s, b) => s + (axis === "h" ? b.box.w : b.box.h), 0);
    const gap = (total - sizes) / (boxed.length - 1);
    let cursor = axis === "h" ? first.box.x : first.box.y;
    const commands: Command[] = [];
    for (const { node, box } of boxed) {
        const at = axis === "h" ? box.x : box.y;
        if (Math.abs(cursor - at) > 0.01) commands.push(axis === "h" ? moveBy(doc, node, cursor - at, 0) : moveBy(doc, node, 0, cursor - at));
        cursor += (axis === "h" ? box.w : box.h) + gap;
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Tidy up: lays the selection out on a grid with even spacing, in reading order.
export function tidyUp(gap = 20) {
    const { doc, nodes } = selectedNodes();
    if (nodes.length < 2) return;
    const boxed = nodes.map((node) => ({ node, box: worldBounds(doc, node) }));
    const bounds = selectionBounds(doc, nodes.map((n) => n.id));
    if (!bounds) return;
    // Rows: layers whose vertical centres fall within half a row of each other.
    const sorted = [...boxed].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const rows: (typeof boxed)[] = [];
    for (const item of sorted) {
        const row = rows[rows.length - 1];
        const anchor = row?.[0];
        if (row && anchor && Math.abs(item.box.y + item.box.h / 2 - (anchor.box.y + anchor.box.h / 2)) < Math.max(anchor.box.h, item.box.h) / 2) row.push(item);
        else rows.push([item]);
    }
    const commands: Command[] = [];
    let y = bounds.y;
    for (const row of rows) {
        row.sort((a, b) => a.box.x - b.box.x);
        let x = bounds.x;
        let rowH = 0;
        for (const { node, box } of row) {
            if (Math.abs(x - box.x) > 0.01 || Math.abs(y - box.y) > 0.01) commands.push(moveBy(doc, node, x - box.x, y - box.y));
            x += box.w + gap;
            rowH = Math.max(rowH, box.h);
        }
        y += rowH + gap;
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Rotates each selected layer about its own centre.
export function rotateSelection(degrees: number) {
    const { doc, nodes } = selectedNodes();
    const ids = expandGroups(doc, nodes.map((n) => n.id));
    const commands: Command[] = ids.flatMap((id): Command[] => {
        const node = doc.nodes[id];
        if (!node) return [];
        const pts = corners(doc, node);
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        const inv = spaceMatrix(doc, node.parentId).inverse();
        const c = inv.transformPoint(new DOMPoint(cx, cy));
        return [{ type: "node.update", id, patch: { x: c.x - node.w / 2, y: c.y - node.h / 2, rotation: normalizeAngle(node.rotation + degrees) } }];
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Selection by likeness.

function siblingsScope(doc: NagmaDocument, selection: string[]): string[] {
    const first = selection[0] ? doc.nodes[selection[0]] : undefined;
    return first?.parentId ? (doc.nodes[first.parentId]?.children ?? []) : layerRoots(doc);
}

export function selectInverse() {
    const { doc, selection } = editor.get();
    const scope = siblingsScope(doc, selection);
    editor.set({ selection: scope.filter((id) => !selection.includes(id) && doc.nodes[id]?.visible && !doc.nodes[id]?.locked) });
}

// ⌥⌘A: the selection plus every layer matching it (same name and parent chain in other frames;
// see engine/matching.ts).
export function selectMatching() {
    const { doc, selection } = editor.get();
    if (!selection.length) return;
    const matches = matchingLayers(doc, selection);
    if (matches.length <= selection.length) {
        editor.notify("No matching layers. Matching layers share a name and parent layers in other frames.");
        return;
    }
    editor.set({ selection: matches });
}

function onActivePage(doc: NagmaDocument, node: SceneNode): boolean {
    const page = editor.get().pageId;
    let cursor: SceneNode | undefined = node;
    while (cursor?.parentId) {
        if (cursor.parentId === page) return true;
        cursor = doc.nodes[cursor.parentId];
    }
    return !node.parentId && doc.roots.includes(node.id);
}

export type SameAs = "properties" | "fill" | "stroke" | "effect" | "text" | "font" | "instance" | "variant";

// Select all with the same fill, stroke, text properties, font or main component.
export function selectAllWith(what: SameAs) {
    const { doc, selection } = editor.get();
    const first = selection[0] ? doc.nodes[selection[0]] : undefined;
    if (!first) return;
    // Properties: the whole look (paints, stroke, corners, opacity, effects, blend), as Copy properties takes it.
    const look = (n: SceneNode) => JSON.stringify(LOOK.filter((k) => !TEXT_LOOK.has(k) || n.type === "text").map((k) => n[k] ?? null));
    const sig = (n: SceneNode) =>
        what === "properties" ? `${n.type === "text" ? "text" : "shape"}:${look(n)}`
        : what === "effect" ? JSON.stringify([n.effects ?? [], n.shadow ?? null, n.blur || 0, n.effectStyleId ?? null])
        : what === "fill" ? JSON.stringify(n.fills)
        : what === "stroke" ? JSON.stringify([n.strokes, n.strokeWidth, n.strokeAlign])
        : what === "text" ? JSON.stringify([n.fontFamily, n.fontSize, n.fontWeight, n.italic, n.lineHeight, n.letterSpacing, n.textAlign, n.decoration])
        : what === "font" ? JSON.stringify([n.fontFamily, n.fontWeight, n.italic])
        : what === "variant" ? variantSetOf(doc, n)
        : n.sourceId ?? "";
    const want = sig(first);
    if (what === "instance" && !want) return;
    if (what === "variant" && !want) return editor.notify("Select an instance of a variant.");
    if (what === "effect" && want === JSON.stringify([[], null, 0, null])) return editor.notify("The selected layer has no effects.");
    editor.set({ selection: Object.values(doc.nodes).filter((n) => n.type !== "page" && (what !== "text" && what !== "font" ? true : n.type === "text") && sig(n) === want && onActivePage(doc, n)).map((n) => n.id) });
}

// The component set an instance's variant belongs to ("" for anything else).
function variantSetOf(doc: NagmaDocument, n: SceneNode): string {
    if (n.type !== "instance" || !n.componentId) return "";
    const main = doc.nodes[n.componentId];
    const set = main?.parentId ? doc.nodes[main.parentId] : undefined;
    return set?.type === "componentSet" ? set.id : "";
}

// Number keys set opacity: 1 is 10%, 5 is 50%, 0 is 100%, two quick digits (say 4 then 5) give 45%.
let lastDigit: { digit: number; at: number } | null = null;
export function opacityFromDigit(digit: number) {
    const { doc, selection } = editor.get();
    if (!selection.length) return;
    const now = Date.now();
    let value: number;
    if (lastDigit && now - lastDigit.at < 400) {
        value = (lastDigit.digit * 10 + digit) / 100;
        lastDigit = null;
    } else {
        value = digit === 0 ? 1 : digit / 10;
        lastDigit = { digit, at: now };
    }
    editor.execute({ type: "batch", commands: selection.filter((id) => doc.nodes[id]).map((id) => ({ type: "node.update", id, patch: { opacity: value } })) });
}

// Copy and paste properties: the look of a layer (paints, stroke, radius, opacity, effects, text style).
let propertyClipboard: Partial<SceneNode> | null = null;
const TEXT_LOOK = new Set<keyof SceneNode>(["fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "letterSpacing", "textAlign", "decoration", "textCase", "textStyleId"]);
const LOOK: (keyof SceneNode)[] = ["fills", "strokes", "strokeWidth", "strokeAlign", "strokeJoin", "strokeCap", "dash", "radius", "radii", "cornerSmoothing", "opacity", "shadow", "blur", "effects", "blendMode", "fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "letterSpacing", "textAlign", "decoration", "textCase", "fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId", "boundVariables"];

export function copyProperties() {
    const { doc, selection } = editor.get();
    const node = selection[0] ? doc.nodes[selection[0]] : undefined;
    if (!node) return;
    const out: Partial<SceneNode> = {};
    for (const key of LOOK) if (node[key] !== undefined) (out as Record<string, unknown>)[key] = node[key];
    propertyClipboard = out;
    editor.notify("Properties copied.");
}

// Paste properties also takes the look of a layer copied in another design tool (⌘C or Copy properties there).
export async function pasteProperties() {
    const { selection } = editor.get();
    if (!selection.length) return;
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (!item.types.includes("text/html")) continue;
            const html = await (await item.getType("text/html")).text();
            const { hasCopiedLayers, copiedLayerProperties } = await import("./layer-clipboard");
            if (!hasCopiedLayers(html)) continue;
            const node = await copiedLayerProperties(html);
            if (node) {
                const out: Partial<SceneNode> = {};
                for (const key of LOOK) if (node[key] !== undefined) (out as Record<string, unknown>)[key] = node[key];
                propertyClipboard = out;
            }
        }
    } catch {
        // No access to the system clipboard: use the properties copied here.
    }
    applyProperties();
}

function applyProperties() {
    const { doc, selection } = editor.get();
    if (!propertyClipboard || !selection.length) return;
    const look = propertyClipboard;
    const commands: Command[] = selection.flatMap((id): Command[] => {
        const node = doc.nodes[id];
        if (!node) return [];
        const patch: Partial<SceneNode> = {};
        for (const key of LOOK) {
            if (look[key] === undefined) continue;
            // Text styling only lands on text layers.
            if (node.type !== "text" && ["fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "letterSpacing", "textAlign", "decoration", "textCase", "textStyleId"].includes(key)) continue;
            (patch as Record<string, unknown>)[key] = look[key];
        }
        return [{ type: "node.update", id, patch }];
    });
    editor.execute({ type: "batch", commands });
}

// Copy as PNG (2x) or SVG onto the system clipboard: every selected layer in one image, framed by
// their shared bounds.
export async function copyAs(format: "png" | "svg") {
    if (refuseExport()) return;
    const { doc, selection } = editor.get();
    const ids = topLevel(doc, selection).filter((id) => doc.nodes[id]);
    if (!ids.length) return;
    try {
        if (format === "svg") {
            const svg = exportSelectionSvg(await inlineImages(doc), ids);
            if (svg) await navigator.clipboard.writeText(svg);
        } else {
            const blob = await renderSelectionToPng(doc, ids, 2, "png");
            if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        }
        editor.notify(format === "svg" ? "SVG copied." : "PNG copied.");
    } catch {
        editor.notify("The clipboard isn't available here.");
    }
}

// Zoom to the next or previous top-level frame, in layer order.
export function zoomToFrame(step: 1 | -1) {
    const { doc, selection } = editor.get();
    const frames = layerRoots(doc).filter((id) => {
        const n = doc.nodes[id];
        return n && (n.type === "frame" || n.type === "component" || n.type === "componentSet");
    });
    if (!frames.length) return;
    const current = frames.findIndex((id) => selection.includes(id));
    const next = frames[(current + step + frames.length) % frames.length] as string;
    const node = doc.nodes[next];
    if (!node) return;
    editor.set({ selection: [next] });
    fitRect(worldBounds(doc, node), 80, 4);
}

// ⌘R: the layers panel opens the name of the single selected layer for editing; with several
// layers selected the Rename layers dialog opens (components/rename-dialog.tsx).
export function renameSelection() {
    const { selection, readOnly } = editor.get();
    if (!selection.length || readOnly) return;
    if (selection.length > 1) {
        openRenameDialog();
        return;
    }
    editor.set({ renameRequest: selection[0] ?? null, prefs: { ...editor.get().prefs, leftPanel: "layers", leftPanelOpen: true } });
}

// ⌘ arrows: grow or shrink the selection from its top-left (→ and ↓ grow, ← and ↑ shrink), the
// size fields' keyboard twin. The resized axis stops hugging or filling, as when a size is typed.
export function resizeBy(dw: number, dh: number) {
    const { doc, nodes } = selectedNodes();
    const commands = nodes.flatMap((node): Command[] => {
        if (node.locked) return [];
        if (node.type === "group" || node.type === "boolean") {
            const fx = node.w > 0 ? Math.max(1, node.w + dw) / node.w : 1;
            const fy = node.h > 0 ? Math.max(1, node.h + dh) / node.h : 1;
            return expandGroups(doc, [node.id]).flatMap((id): Command[] => {
                const leaf = doc.nodes[id];
                if (!leaf) return [];
                return [{ type: "node.update", id, patch: { x: node.x + (leaf.x - node.x) * fx, y: node.y + (leaf.y - node.y) * fy, w: Math.max(1, leaf.w * fx), h: Math.max(1, leaf.h * fy) } }];
            });
        }
        const sizing = { ...node.sizing, ...(dw ? { h: "fixed" as const } : {}), ...(dh ? { v: "fixed" as const } : {}) };
        return [{ type: "node.update", id: node.id, patch: { w: Math.max(1, node.w + dw), h: Math.max(1, node.h + dh), sizing } }];
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Page Up / Page Down: the previous or next page (dividers skipped).
export function stepPage(step: 1 | -1) {
    const { doc, pageId } = editor.get();
    const pages = realPages(doc);
    const next = pages[pages.indexOf(pageId) + step];
    if (next) editor.setPage(next);
}

// Copy as text: the words of the selected text layers (and text inside selected frames), in layer order.
export async function copyAsText() {
    if (refuseExport()) return;
    const { doc, selection } = editor.get();
    const words: string[] = [];
    const walk = (id: string) => {
        const node = doc.nodes[id];
        if (!node || node.visible === false) return;
        if (node.type === "text" && node.text) words.push(node.text);
        for (const child of node.children) walk(child);
    };
    for (const id of topLevel(doc, selection)) walk(id);
    if (!words.length) {
        editor.notify("There's no text in the selection.");
        return;
    }
    try {
        await navigator.clipboard.writeText(words.join("\n"));
        editor.notify("Text copied.");
    } catch {
        editor.notify("The clipboard isn't available here.");
    }
}

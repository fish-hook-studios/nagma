import { nanoid } from "nanoid";
import { fitRect, viewport } from "../engine/camera";
import { storeImage } from "../engine/image-store";
import { editor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { SceneNode } from "../engine/types";
import { assetData, assetOf, assetsOf, fieldValuePatch, pageData } from "./model";
import { selectionBounds } from "../engine/nodes";
import { campaign, type RailPanel } from "./state";

// Small actions the campaign's panels share.

// Puts an asset on show: the asset view switches to it; the grid view frames it.
export function showAsset(id: string, add = false) {
    const s = editor.get();
    const node = s.doc.nodes[id];
    if (!node) return;
    editor.set({ selection: add ? [...new Set([...s.selection, id])] : [id], editingTextId: null });
    if (add) return;
    campaign.set({ current: id });
    if (campaign.get().view === "grid") fitRect(worldBounds(s.doc, node), 120, 1);
}

// The asset view's framing: the asset in the middle with room around it for the toolbars.
export function frameCurrent() {
    const id = campaign.get().current;
    const node = id ? editor.get().doc.nodes[id] : undefined;
    if (!node || viewport.width < 50) return;
    // Bulk edit's preview fills its side; the asset view leaves room for the toolbars.
    const bulk = campaign.get().panel === "bulk";
    const padX = bulk ? 16 : Math.max(40, viewport.width * 0.12);
    const padY = bulk ? 48 : Math.max(56, viewport.height * 0.11);
    const zoom = Math.min((viewport.width - padX * 2) / Math.max(node.w, 1), (viewport.height - padY * 2) / Math.max(node.h, 1), 4);
    editor.set({ camera: { zoom, x: viewport.width / 2 - (node.x + node.w / 2) * zoom, y: viewport.height / 2 - (node.y + node.h / 2) * zoom } });
}

export async function replaceImage(node: SceneNode, file: File) {
    const id = nanoid(12);
    const data = await storeImage(file);
    const patch = fieldValuePatch(node, "image", id);
    editor.execute({ type: "batch", commands: [{ type: "image.add", id, data }, ...(patch ? [{ type: "node.update" as const, id: node.id, patch }] : [])] });
}

// Opens bulk create for the selected template (or the first one).
export function openBulk() {
    const s = editor.get();
    const asset = assetOf(s.doc, s.selection[0]);
    const data = assetData(asset ?? undefined);
    campaign.set({ dialog: { kind: "bulk", templateId: data?.template ? asset?.id : (data?.sourceId ?? undefined) } });
}

// Frames every asset, with room on the left for the row labels (about 130 screen pixels).
export function fitAssets() {
    if (campaign.get().view === "asset" && campaign.get().panel !== "bulk") return frameCurrent();
    const doc = editor.get().doc;
    const box = selectionBounds(doc, assetsOf(doc).map((a) => a.id));
    if (!box) return;
    const labels = pageData(doc).rows.length > 1 ? 130 : 0;
    // Room for the pills and toolbars floating over the top and bottom of the canvas.
    const padX = Math.min(48, viewport.width * 0.1);
    const padTop = Math.min(84, viewport.height * 0.15);
    const padBottom = Math.min(76, viewport.height * 0.13);
    const zoom = Math.max(0.02, Math.min(1, (viewport.width - padX * 2 - labels) / Math.max(box.w, 1), (viewport.height - padTop - padBottom) / Math.max(box.h, 1)));
    const left = padX + labels + (viewport.width - padX * 2 - labels - box.w * zoom) / 2;
    const top = padTop + (viewport.height - padTop - padBottom - box.h * zoom) / 2;
    editor.set({ camera: { zoom, x: left - box.x * zoom, y: top - box.y * zoom } });
}

export function openPanel(panel: RailPanel) {
    const s = campaign.get();
    // A second press on an add panel closes it, back to the asset list (or nothing in the grid view).
    if (s.panel === panel && panel !== "assets") campaign.set({ panel: "assets" });
    else campaign.set({ panel });
}

export function setView(view: "asset" | "grid") {
    campaign.set({ view, panel: campaign.get().panel === "bulk" ? "assets" : campaign.get().panel });
    if (view === "grid") window.setTimeout(fitAssets, 30);
}


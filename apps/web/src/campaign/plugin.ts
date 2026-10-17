import { registerCanvasPlugin } from "../canvas/canvas-plugins";
import { hitTest, sceneFocus } from "../canvas/hit-test";
import { PALETTES } from "../canvas/render";
import { worldToScreen } from "../engine/camera";
import { applyCommand } from "../engine/commands";
import { editor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { Camera, NagmaDocument } from "../engine/types";
import { ROW_GAP, assetData, assetOf, assetsOf, duplicateAsset, fieldsOf, layerData, rowsOf } from "./model";
import { STATUS_COLOR, STATUS_LABEL, reviewOf } from "./reviews";
import { isPlaying, prepareVideo, toggleVideo, videoLayers, videoOf } from "./video";
import { campaign, inEditMode, isCampaignDoc } from "./state";

// The campaign's canvas: the asset's name over it in the asset view, row labels beside the grid in
// the grid view, and in Edit mode a press picks a whole asset or one of its fields (dragging a
// field the template lets editors move); a double-click on a text field types in it right there.
// Nothing else on the canvas edits in Edit mode.

let drag: { id: string; base: NagmaDocument; start: { x: number; y: number } } | null = null;

const LABEL = 11;

// The asset view shows one asset (sceneFocus); presses only reach it.
function shownAssets(doc: NagmaDocument) {
    const focus = sceneFocus.id ? doc.nodes[sceneFocus.id] : undefined;
    return focus && assetData(focus) ? [focus] : assetsOf(doc);
}

// The asset view's name label above the asset, in screen space.
function labelRect(doc: NagmaDocument, camera: Camera) {
    const focus = sceneFocus.id ? doc.nodes[sceneFocus.id] : undefined;
    if (!focus || !assetData(focus) || campaign.get().panel === "bulk") return null;
    const at = worldToScreen(camera, focus.x, focus.y);
    const right = worldToScreen(camera, focus.x + focus.w, focus.y).x;
    return { id: focus.id, name: focus.name, x: at.x, y: at.y - LABEL - 6, w: Math.max(40, right - at.x), h: LABEL + 4 };
}

function assetAt(doc: NagmaDocument, x: number, y: number) {
    const assets = shownAssets(doc);
    for (let i = assets.length - 1; i >= 0; i--) {
        const a = assets[i];
        if (a && x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a;
    }
    return null;
}

// The field layer under the point (the innermost one), and whether an editor may move it.
function fieldAt(doc: NagmaDocument, x: number, y: number): { id: string; movable: boolean } | null {
    let node = hitTest(doc, x, y, true);
    while (node && !assetData(node)) {
        const data = layerData(node);
        if (data && (!data.locks.position || !data.locks.content || !data.locks.style)) return { id: node.id, movable: !data.locks.position };
        node = node.parentId ? doc.nodes[node.parentId] : null;
    }
    return null;
}

// The accent as the theme and mode draw it (the page's own token), for the field outlines.
function accent(): string {
    return getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || PALETTES[editor.get().prefs.theme].brand;
}

// ---- Buttons drawn on the canvas: play on videos, and the grid view's + beside an asset ----

const PLAY_R = 14;
const PLUS_R = 10;
// The asset under the pointer in the grid view (its + shows beside it).
let hoverAsset: string | null = null;

function playButtons(doc: NagmaDocument, camera: Camera) {
    if (campaign.get().panel === "bulk" && !sceneFocus.id) return [];
    return shownAssets(doc).flatMap((asset) =>
        videoLayers(doc, asset.id).map((node) => {
            const v = videoOf(node);
            if (v) prepareVideo(v.video);
            const box = worldBounds(doc, node);
            const c = worldToScreen(camera, box.x + box.w / 2, box.y + box.h / 2);
            return { id: node.id, x: c.x, y: c.y };
        }),
    );
}

function plusButton(doc: NagmaDocument, camera: Camera) {
    if (campaign.get().view !== "grid" || sceneFocus.id || !hoverAsset || editor.get().readOnly || inEditMode()) return null;
    const asset = doc.nodes[hoverAsset];
    if (!asset || !assetData(asset)) return null;
    const right = worldToScreen(camera, asset.x + asset.w, asset.y + asset.h / 2);
    return { id: asset.id, x: right.x + PLUS_R + 8, y: right.y };
}

const within = (p: { x: number; y: number }, c: { x: number; y: number }, r: number) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= r * r;

const takesPress = () => inEditMode() && !editor.get().readOnly && editor.get().tool === "move";

const editableText = (doc: NagmaDocument, id: string | null) => {
    const node = id ? doc.nodes[id] : undefined;
    const data = layerData(node);
    return node && node.type === "text" && data?.type === "text" && !data.locks.content ? node : null;
};

// The buttons go ahead of every other canvas tool, so a handle under them doesn't take the press.
registerCanvasPlugin(
    {
        name: "campaign-buttons",
        down(p) {
            if (!isCampaignDoc() || p.button !== 0) return false;
            const s = editor.get();
            if (s.tool !== "move" || s.editingTextId) return false;
            const play = playButtons(s.doc, s.camera).find((b) => within(p.screen, b, PLAY_R));
            if (play) {
                toggleVideo(play.id);
                return true;
            }
            const plus = plusButton(s.doc, s.camera);
            if (plus && within(p.screen, plus, PLUS_R + 2)) {
                duplicateAsset(plus.id);
                return true;
            }
            return false;
        },
        hover(p) {
            if (!isCampaignDoc()) return undefined;
            const s = editor.get();
            // The grid view's + follows the asset under the pointer (and the gap beside it).
            if (campaign.get().view === "grid" && !sceneFocus.id) {
                const near = assetsOf(s.doc).find((a) => p.world.x >= a.x && p.world.x <= a.x + a.w + (PLUS_R * 2 + 16) / s.camera.zoom && p.world.y >= a.y && p.world.y <= a.y + a.h);
                const next = near?.id ?? null;
                if (next !== hoverAsset) {
                    hoverAsset = next;
                    editor.set({});
                }
                const plus = plusButton(s.doc, s.camera);
                if (plus && within(p.screen, plus, PLUS_R + 2)) return "pointer";
            }
            if (playButtons(s.doc, s.camera).some((b) => within(p.screen, b, PLAY_R))) return "pointer";
            return undefined;
        },
    },
    true,
);

registerCanvasPlugin({
    name: "campaign",
    down(p) {
        if (!isCampaignDoc() || p.button !== 0) return false;
        const s = editor.get();
        // The name over the asset picks the asset (any mode).
        const label = labelRect(s.doc, s.camera);
        if (label && editor.get().tool === "move" && p.screen.x >= label.x && p.screen.x <= label.x + label.w && p.screen.y >= label.y && p.screen.y <= label.y + label.h) {
            editor.set({ selection: [label.id], editingTextId: null });
            return true;
        }
        // Design mode, asset view: a press on the asset's own background picks the asset.
        if (!inEditMode() && sceneFocus.id && editor.get().tool === "move" && !p.shiftKey && !s.editingTextId) {
            const focus = s.doc.nodes[sceneFocus.id];
            if (focus && !hitTest(s.doc, p.world.x, p.world.y, p.metaKey || p.ctrlKey) && p.world.x >= focus.x && p.world.x <= focus.x + focus.w && p.world.y >= focus.y && p.world.y <= focus.y + focus.h) {
                editor.set({ selection: [focus.id], editingTextId: null });
                return true;
            }
        }
        if (!takesPress()) return false;
        const asset = assetAt(s.doc, p.world.x, p.world.y);
        if (!asset) {
            editor.set({ selection: [], editingTextId: null });
            return true;
        }
        const field = fieldAt(s.doc, p.world.x, p.world.y);
        if (field) {
            // Picking a field shows it in the Edit panel; fields editors may move also drag.
            editor.set({ selection: [field.id], editingTextId: null });
            if (field.movable) drag = { id: field.id, base: s.doc, start: p.world };
            return true;
        }
        editor.set({ selection: [asset.id], editingTextId: null });
        return true;
    },
    move(p) {
        if (!drag) return;
        const dx = Math.round(p.world.x - drag.start.x);
        const dy = Math.round(p.world.y - drag.start.y);
        editor.preview(applyCommand(drag.base, { type: "node.move", ids: [drag.id], dx, dy }));
    },
    up(p) {
        if (!drag) return;
        const dx = Math.round(p.world.x - drag.start.x);
        const dy = Math.round(p.world.y - drag.start.y);
        const { id, base } = drag;
        drag = null;
        if (dx || dy) editor.execute({ type: "node.move", ids: [id], dx, dy }, base);
        else editor.preview(base);
    },
    hover(p) {
        if (!takesPress()) return undefined;
        const doc = editor.get().doc;
        const field = fieldAt(doc, p.world.x, p.world.y);
        return field?.movable ? "move" : field ? "pointer" : "default";
    },
    // Edit mode: a double-click on a text field types in it; nothing else opens up.
    dblclick(p) {
        if (!takesPress()) return false;
        const doc = editor.get().doc;
        const field = fieldAt(doc, p.world.x, p.world.y);
        const text = editableText(doc, field?.id ?? null);
        if (text) editor.set({ selection: [text.id], editingTextId: text.id });
        return true;
    },
    overlay(ctx, camera) {
        if (!isCampaignDoc()) return;
        const s = editor.get();
        const doc = s.doc;
        ctx.save();
        const label = labelRect(doc, camera);
        if (label) {
            // The asset view: the asset's name over its top left corner, in the accent while the
            // asset or anything inside it is selected (the asset then gets a thin outline too).
            const inside = s.selection.length > 0 && s.selection.every((id) => assetOf(doc, id)?.id === label.id);
            const own = s.selection.includes(label.id);
            ctx.font = `500 ${LABEL}px Inter, system-ui, sans-serif`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            ctx.fillStyle = inside ? PALETTES[s.prefs.theme].brand : s.prefs.theme === "dark" ? "rgba(255,255,255,0.55)" : "rgba(20,21,26,0.55)";
            ctx.fillText(label.name, label.x, label.y + 2, label.w);
            const focus = doc.nodes[label.id];
            if (inside && !own && focus && !s.editingTextId) {
                const a = worldToScreen(camera, focus.x, focus.y);
                const b = worldToScreen(camera, focus.x + focus.w, focus.y + focus.h);
                ctx.strokeStyle = PALETTES[s.prefs.theme].brand;
                ctx.lineWidth = 1;
                ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
            }
        } else {
            // The grid view: row labels beside each row (when there's more than one row).
            const rows = rowsOf(doc);
            const dark = s.prefs.theme === "dark";
            let cursor = 0;
            for (const { row, assets } of rows.length > 1 ? rows : []) {
                const top = assets.length ? Math.min(...assets.map((a) => a.y)) : cursor;
                const left = assets.length ? Math.min(...assets.map((a) => a.x)) : 0;
                const tallest = assets.length ? Math.max(...assets.map((a) => a.y + a.h)) - top : 400;
                cursor = top + tallest + ROW_GAP;
                const at = worldToScreen(camera, left, top);
                // To the left of the row, so it never runs into the frames' own names above them.
                ctx.textAlign = "right";
                ctx.textBaseline = "top";
                ctx.font = "600 12px Inter, system-ui, sans-serif";
                ctx.fillStyle = dark ? "rgba(255,255,255,0.85)" : "rgba(20,21,26,0.85)";
                ctx.fillText(row.name, at.x - 16, at.y);
                ctx.font = "11px Inter, system-ui, sans-serif";
                ctx.fillStyle = dark ? "rgba(255,255,255,0.45)" : "rgba(20,21,26,0.5)";
                ctx.fillText(row.bulk ? `${assets.length} from data` : `${assets.length} asset${assets.length === 1 ? "" : "s"}`, at.x - 16, at.y + 16);
                ctx.textAlign = "left";
                if (!assets.length) {
                    const end = worldToScreen(camera, left + 1080, top + 400);
                    ctx.setLineDash([6, 6]);
                    ctx.strokeStyle = dark ? "rgba(255,255,255,0.2)" : "rgba(20,21,26,0.25)";
                    ctx.strokeRect(at.x, at.y, end.x - at.x, end.y - at.y);
                    ctx.setLineDash([]);
                    ctx.font = "12px Inter, system-ui, sans-serif";
                    ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(20,21,26,0.45)";
                    ctx.textBaseline = "middle";
                    ctx.fillText("Empty row: add an asset or a template", at.x + 16, (at.y + end.y) / 2);
                }
            }
        }
        // Review badges: after the asset's name in the asset view, over each asset's top right in the grid.
        const badge = (assetId: string, x: number, y: number, align: "left" | "right") => {
            const review = reviewOf(assetId);
            if (!review) return;
            const text = STATUS_LABEL[review.status];
            ctx.font = "600 9.5px Inter, system-ui, sans-serif";
            const w = ctx.measureText(text).width + 12;
            const left = align === "left" ? x : x - w;
            ctx.fillStyle = STATUS_COLOR[review.status];
            ctx.beginPath();
            ctx.roundRect(left, y, w, 15, 7.5);
            ctx.fill();
            ctx.fillStyle = review.status === "pending" ? "#000" : "#fff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(text, left + 6, y + 8);
        };
        if (label) {
            ctx.font = `500 ${LABEL}px Inter, system-ui, sans-serif`;
            badge(label.id, label.x + Math.min(label.w, ctx.measureText(label.name).width) + 8, label.y, "left");
        } else if (campaign.get().view === "grid" || campaign.get().panel === "bulk") {
            for (const asset of assetsOf(doc)) {
                const at = worldToScreen(camera, asset.x + asset.w, asset.y);
                badge(asset.id, at.x, at.y - 21, "right");
            }
        }
        // Play buttons on videos (pause while one plays).
        for (const b of playButtons(doc, camera)) {
            const on = isPlaying(b.id);
            ctx.globalAlpha = on ? 0.55 : 0.9;
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.beginPath();
            ctx.arc(b.x, b.y, PLAY_R, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            if (on) {
                ctx.rect(b.x - 5, b.y - 6, 3.5, 12);
                ctx.rect(b.x + 1.5, b.y - 6, 3.5, 12);
            } else {
                ctx.moveTo(b.x - 4, b.y - 7);
                ctx.lineTo(b.x + 7, b.y);
                ctx.lineTo(b.x - 4, b.y + 7);
                ctx.closePath();
            }
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        // The grid view's + beside the asset under the pointer: a copy of it, next to it.
        const plus = plusButton(doc, camera);
        if (plus) {
            ctx.fillStyle = accent();
            ctx.beginPath();
            ctx.arc(plus.x, plus.y, PLUS_R, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(plus.x - 4.5, plus.y);
            ctx.lineTo(plus.x + 4.5, plus.y);
            ctx.moveTo(plus.x, plus.y - 4.5);
            ctx.lineTo(plus.x, plus.y + 4.5);
            ctx.stroke();
        }
        // Edit mode: the selected asset's editable fields get a dashed outline.
        if (campaign.get().mode === "edit") {
            const asset = assetOf(doc, s.selection[0]);
            if (asset) {
                ctx.setLineDash([4, 3]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = accent();
                for (const node of fieldsOf(doc, asset.id)) {
                    const data = layerData(node);
                    if (!data || (data.locks.content && data.locks.style && data.locks.position) || node.id === s.editingTextId) continue;
                    const box = worldBounds(doc, node);
                    const a = worldToScreen(camera, box.x, box.y);
                    const b = worldToScreen(camera, box.x + box.w, box.y + box.h);
                    ctx.globalAlpha = s.selection.includes(node.id) ? 1 : 0.55;
                    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
                }
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            }
        }
        ctx.restore();
    },
});

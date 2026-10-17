// Canvas chrome for interface features that sit on top of the scene: highlighted layers (matching
// layers, rows hovered in menus), Dev status badges, the pen's close badge and smart selection
// handles. The canvas view writes `uiOverlay`; render.ts calls drawUiOverlay once per frame.
import { worldToScreen } from "../engine/camera";
import { editor } from "../engine/store";
import { ui } from "../engine/ui-state";
import { corners, worldBounds } from "../engine/transform";
import type { Camera, NagmaDocument } from "../engine/types";
import { drawDevBadges } from "./dev-badges";
import { drawSmartSelection } from "./smart-selection";
import type { Palette } from "./render";

export const uiOverlay = {
    // Layers outlined besides the hovered one.
    highlights: [] as string[],
    // The dev badge under the pointer.
    devHover: null as string | null,
    // The pen is over the first point of its path, so a click closes it: that point and the pointer
    // (screen positions).
    penClose: null as { anchor: { x: number; y: number }; cursor: { x: number; y: number } } | null,
};

function outline(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, id: string, color: string) {
    const node = doc.nodes[id];
    if (!node) return;
    const pts = corners(doc, node).map((p) => worldToScreen(camera, p.x, p.y));
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

// The pen's close badge: the first point rings, and a small circle rides beside the cursor, the
// way the reference's pen shows that a click will close the shape.
function drawPenClose(ctx: CanvasRenderingContext2D, at: { anchor: { x: number; y: number }; cursor: { x: number; y: number } }, palette: Palette) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.anchor.x, at.anchor.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = palette.brand;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(at.cursor.x + 13, at.cursor.y + 13, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
}

const PAD = "#D946EF";

// Inspect: hovering an auto layout frame tints its padding and the gaps between its children, each
// with its size, the way a developer reads spacing off a design.
function drawSpacing(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, id: string) {
    const node = doc.nodes[id];
    const l = node?.layout;
    if (!node || !l || l.grid || node.rotation) return;
    const box = worldBounds(doc, node);
    const z = camera.zoom;
    const scr = (x: number, y: number, w: number, h: number) => {
        const a = worldToScreen(camera, x, y);
        return { x: a.x, y: a.y, w: w * z, h: h * z };
    };
    const bands: { x: number; y: number; w: number; h: number; value: number }[] = [];
    const [t, r, b, lft] = l.padding;
    if (t) bands.push({ ...scr(box.x, box.y, box.w, t), value: t });
    if (b) bands.push({ ...scr(box.x, box.y + box.h - b, box.w, b), value: b });
    if (lft) bands.push({ ...scr(box.x, box.y + t, lft, box.h - t - b), value: lft });
    if (r) bands.push({ ...scr(box.x + box.w - r, box.y + t, r, box.h - t - b), value: r });
    // Gaps: between neighbours in flow.
    const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is NonNullable<typeof c> => Boolean(c && c.visible && c.positioning !== "absolute"))
        .map((c) => worldBounds(doc, c));
    const horizontal = l.direction === "horizontal";
    kids.sort((a, c) => (horizontal ? a.x - c.x : a.y - c.y));
    for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1];
        const c = kids[i];
        if (!a || !c) continue;
        const gap = horizontal ? c.x - (a.x + a.w) : c.y - (a.y + a.h);
        if (gap <= 0.5) continue;
        bands.push(horizontal ? { ...scr(a.x + a.w, box.y + t, gap, box.h - t - b), value: gap } : { ...scr(box.x + lft, a.y + a.h, box.w - lft - r, gap), value: gap });
    }
    if (!bands.length) return;
    ctx.save();
    ctx.font = "600 10px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const band of bands) {
        ctx.fillStyle = "rgba(217, 70, 239, 0.18)";
        ctx.fillRect(band.x, band.y, band.w, band.h);
        ctx.strokeStyle = "rgba(217, 70, 239, 0.5)";
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(band.x + 0.5, band.y + 0.5, band.w - 1, band.h - 1);
        ctx.setLineDash([]);
        if (band.w < 10 && band.h < 10) continue;
        const label = String(Math.round(band.value * 100) / 100);
        const w = ctx.measureText(label).width + 8;
        const cx = band.x + band.w / 2;
        const cy = band.y + band.h / 2;
        ctx.fillStyle = PAD;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, cy - 8, w, 16, 3);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, cx, cy + 0.5);
    }
    ctx.restore();
}

export function drawUiOverlay(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, palette: Palette, selection: string[]) {
    const selected = new Set(selection);
    for (const id of uiOverlay.highlights) if (!selected.has(id)) outline(ctx, doc, camera, id, palette.brand);
    drawDevBadges(ctx, doc, camera, selection, uiOverlay.devHover);
    const s0 = editor.get();
    if (s0.tool === "move" && !s0.readOnly && s0.mode !== "dev" && !s0.editingVectorId && !s0.editingTextId) drawSmartSelection(ctx, doc, selection, camera);
    const s = editor.get();
    if (s.mode === "dev" && s.hoverId && s.tool === "move") drawSpacing(ctx, doc, camera, s.hoverId);
    if (uiOverlay.penClose && s.penNodeId && s.tool === "pen") drawPenClose(ctx, uiOverlay.penClose, palette);
    const keyBox = ui.get().keyBox;
    if (keyBox) drawKeyBox(ctx, camera, keyBox);
}

// The keyboard selection box (⌥Space): a pink dashed rectangle the arrows move about.
function drawKeyBox(ctx: CanvasRenderingContext2D, camera: Camera, box: { x: number; y: number; w: number; h: number }) {
    const a = worldToScreen(camera, box.x, box.y);
    const b = worldToScreen(camera, box.x + box.w, box.y + box.h);
    ctx.save();
    ctx.strokeStyle = "#E5409A";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    ctx.restore();
}

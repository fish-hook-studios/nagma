import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, SceneNode } from "../../engine/types";
import { vectorUi } from "../../engine/vector-ui";
import { type WidthPoint, nearestOn, outlineOf, pointAt, widthAt, widthPointsOf } from "../../engine/width-profile";
import { addKeyHandler } from "../../hooks/use-vector-shortcuts";
import { type PluginPointer, HANDLE_BLUE, drawDot, drawLabel, registerCanvasPlugin } from "../canvas-plugins";
import { toVectorSpace } from "../vector-edit";

// The Variable width tool (⇧W in point editing): click the stroke to add a width point and drag
// out to set its width, drag a point along the path to move it, drag a point's handles to change
// its width, Delete removes the selected point. The selected point's width is also a field in the
// Design panel.

type Pt = { x: number; y: number };

function editingNode(): SceneNode | null {
    const s = editor.get();
    if (!s.editingVectorId || s.vectorTool !== "width" || s.tool === "pen") return null;
    const node = s.doc.nodes[s.editingVectorId];
    return node && node.type === "vector" ? node : null;
}

function toScreen(doc: NagmaDocument, node: SceneNode, p: Pt): Pt {
    const w = apply(worldMatrix(doc, node), p.x, p.y);
    return worldToScreen(editor.get().camera, w.x, w.y);
}

interface Marker {
    anchor: Pt;
    a: Pt;
    b: Pt;
}

function markers(doc: NagmaDocument, node: SceneNode, points: WidthPoint[]): Marker[] {
    const outline = outlineOf(node);
    return points.flatMap((wp) => {
        const at = pointAt(outline, wp.t);
        if (!at) return [];
        const half = (wp.w * node.strokeWidth) / 2;
        return [
            {
                anchor: toScreen(doc, node, at.p),
                a: toScreen(doc, node, { x: at.p.x + at.n.x * half, y: at.p.y + at.n.y * half }),
                b: toScreen(doc, node, { x: at.p.x - at.n.x * half, y: at.p.y - at.n.y * half }),
            },
        ];
    });
}

let drag: { mode: "width" | "move"; index: number; base: NagmaDocument; node: SceneNode; points: WidthPoint[] } | null = null;
let hoverAt: Pt | null = null;
let label: { at: Pt; text: string } | null = null;

function update(p: PluginPointer): WidthPoint[] | null {
    if (!drag) return null;
    const { node, base } = drag;
    const q = toVectorSpace(base, node, p.world);
    const outline = outlineOf(node);
    const points = drag.points.map((wp) => ({ ...wp }));
    const wp = points[drag.index];
    if (!wp) return null;
    if (drag.mode === "move") {
        const near = nearestOn(outline, q);
        if (near) wp.t = Math.max(0, Math.min(1, near.t));
    } else {
        const at = pointAt(outline, wp.t);
        if (!at) return null;
        const off = Math.abs((q.x - at.p.x) * at.n.x + (q.y - at.p.y) * at.n.y);
        wp.w = Math.max(0, Math.round(((off * 2) / Math.max(node.strokeWidth, 0.0001)) * 100) / 100);
    }
    label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: drag.mode === "move" ? `${Math.round(wp.t * 100)}%` : `${Math.round(wp.w * node.strokeWidth * 10) / 10}` };
    return points;
}

function patch(points: WidthPoint[]) {
    // The selected point keeps its index after sorting.
    const selected = drag ? points[drag.index] : undefined;
    const sorted = [...points].sort((a, b) => a.t - b.t);
    if (selected && vectorUi.get().widthPoint !== sorted.indexOf(selected)) vectorUi.set({ widthPoint: sorted.indexOf(selected) });
    return { widthPoints: sorted, strokeProfile: null };
}

registerCanvasPlugin({
    name: "width-tool",
    down(p) {
        const node = editingNode();
        if (!node || node.strokeWidth <= 0) return false;
        const s = editor.get();
        const points = widthPointsOf(node) ?? [];
        const marks = markers(s.doc, node, points);
        for (let i = marks.length - 1; i >= 0; i--) {
            const m = marks[i] as Marker;
            const near = (q: Pt) => Math.hypot(q.x - p.screen.x, q.y - p.screen.y) <= 6;
            if (near(m.a) || near(m.b)) {
                drag = { mode: "width", index: i, base: s.doc, node, points };
                vectorUi.set({ widthPoint: i });
                return true;
            }
            if (near(m.anchor)) {
                drag = { mode: "move", index: i, base: s.doc, node, points };
                vectorUi.set({ widthPoint: i });
                return true;
            }
        }
        const outline = outlineOf(node);
        const q = toVectorSpace(s.doc, node, p.world);
        const near = nearestOn(outline, q);
        const zoom = s.camera.zoom;
        if (!near || near.dist * zoom > Math.max(8, (node.strokeWidth * zoom) / 2 + 4)) {
            vectorUi.set({ widthPoint: null });
            return false;
        }
        // A new point starts at the width the stroke already has there.
        const added: WidthPoint = { t: near.t, w: points.length ? widthAt(points, near.t) : 1 };
        const next = [...points, added];
        drag = { mode: "width", index: next.length - 1, base: s.doc, node, points: next };
        editor.preview(applyCommand(s.doc, { type: "node.update", id: node.id, patch: patch(next) }));
        return true;
    },
    move(p) {
        const points = update(p);
        if (!drag || !points) return;
        editor.preview(applyCommand(drag.base, { type: "node.update", id: drag.node.id, patch: patch(points) }));
    },
    up(p) {
        const points = update(p) ?? drag?.points ?? null;
        const d = drag;
        if (d && points) editor.execute({ type: "node.update", id: d.node.id, patch: patch(points) }, d.base);
        drag = null;
        label = null;
    },
    hover(p) {
        const node = editingNode();
        if (!node) {
            hoverAt = null;
            return undefined;
        }
        const s = editor.get();
        const near = nearestOn(outlineOf(node), toVectorSpace(s.doc, node, p.world));
        const close = near && near.dist * s.camera.zoom <= Math.max(8, (node.strokeWidth * s.camera.zoom) / 2 + 4);
        const next = close && near ? toScreen(s.doc, node, near.p) : null;
        if (next?.x !== hoverAt?.x || next?.y !== hoverAt?.y) {
            hoverAt = next;
            editor.set({});
        }
        return close ? "crosshair" : "default";
    },
    overlay(ctx) {
        const node = editingNode();
        if (!node) return;
        const doc = editor.get().doc;
        const points = widthPointsOf(node) ?? [];
        const selected = vectorUi.get().widthPoint;
        markers(doc, node, points).forEach((m, i) => {
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(m.a.x, m.a.y);
            ctx.lineTo(m.b.x, m.b.y);
            ctx.stroke();
            drawDot(ctx, m.a.x, m.a.y, 3);
            drawDot(ctx, m.b.x, m.b.y, 3);
            drawDot(ctx, m.anchor.x, m.anchor.y, 4, i === selected ? HANDLE_BLUE : "#FFFFFF");
        });
        if (hoverAt && !drag) drawDot(ctx, hoverAt.x, hoverAt.y, 3.5, "rgba(13,153,255,0.5)");
        if (label) drawLabel(ctx, label.at.x, label.at.y, label.text);
    },
});

// Delete or Backspace removes the selected width point.
addKeyHandler((event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return false;
    const node = editingNode();
    const index = vectorUi.get().widthPoint;
    if (!node || index === null) return false;
    const points = widthPointsOf(node) ?? [];
    if (!points[index]) return false;
    const next = points.filter((_, i) => i !== index);
    editor.execute({ type: "node.update", id: node.id, patch: { widthPoints: next.length ? next : null, strokeProfile: null } });
    vectorUi.set({ widthPoint: null });
    return true;
});

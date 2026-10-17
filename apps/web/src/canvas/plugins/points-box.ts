import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, NodePatch, PathPoint, SceneNode } from "../../engine/types";
import { fitPath, placedSubpaths } from "../../engine/vector";
import { type PluginPointer, HANDLE_BLUE, drawSquare, registerCanvasPlugin } from "../canvas-plugins";
import { hitVertex, toVectorSpace } from "../vector-edit";

// With two or more points selected in point editing, a box around them: drag a corner or an edge
// to scale the points (⇧ keeps the proportions, ⌥ scales from the centre), or just outside a corner
// to rotate them (⇧ in 15° steps). Handles move with their points.

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };
// Handles: corners and edges, as fractions of the box.
const HANDLES: { id: string; fx: number; fy: number }[] = [
    { id: "nw", fx: 0, fy: 0 },
    { id: "n", fx: 0.5, fy: 0 },
    { id: "ne", fx: 1, fy: 0 },
    { id: "e", fx: 1, fy: 0.5 },
    { id: "se", fx: 1, fy: 1 },
    { id: "s", fx: 0.5, fy: 1 },
    { id: "sw", fx: 0, fy: 1 },
    { id: "w", fx: 0, fy: 0.5 },
];

function context(): { node: SceneNode; anchors: { sub: number; index: number }[]; box: Box } | null {
    const s = editor.get();
    if (!s.editingVectorId || s.vectorTool !== "move" || s.tool === "pen") return null;
    const node = s.doc.nodes[s.editingVectorId];
    if (!node) return null;
    const anchors = s.vertices.filter((v) => v.part === "anchor");
    if (anchors.length < 2) return null;
    const subs = placedSubpaths(node);
    const pts = anchors.map((a) => subs[a.sub]?.points[a.index]).filter((p): p is PathPoint => Boolean(p));
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { node, anchors, box };
}

function screenOf(doc: NagmaDocument, node: SceneNode, p: Pt): Pt {
    const w = apply(worldMatrix(doc, node), p.x, p.y);
    return worldToScreen(editor.get().camera, w.x, w.y);
}

function handlePoint(box: Box, fx: number, fy: number): Pt {
    return { x: box.x + box.w * fx, y: box.y + box.h * fy };
}

type Drag = { kind: "scale"; handle: (typeof HANDLES)[number] } | { kind: "rotate"; startAngle: number };

let drag: (Drag & { base: NagmaDocument; node: SceneNode; anchors: { sub: number; index: number }[]; box: Box; start: Pt }) | null = null;

function hit(p: PluginPointer): Drag | null {
    const c = context();
    if (!c) return null;
    const s = editor.get();
    // Points win over the box's handles.
    if (hitVertex(s.doc, c.node, s.camera, s.vertices, p.screen.x, p.screen.y)) return null;
    const screenBox = HANDLES.map((h) => ({ h, at: screenOf(s.doc, c.node, handlePoint(c.box, h.fx, h.fy)) }));
    const tiny = c.box.w * s.camera.zoom < 12 && c.box.h * s.camera.zoom < 12;
    if (tiny) return null;
    for (const { h, at } of screenBox) {
        // A flat box (points in a line) only scales along its length.
        if ((c.box.w < 1e-6 && h.fx !== 0.5) || (c.box.h < 1e-6 && h.fy !== 0.5)) continue;
        if (Math.hypot(at.x - p.screen.x, at.y - p.screen.y) <= 5) return { kind: "scale", handle: h };
    }
    for (const { h, at } of screenBox) {
        if (h.id.length !== 2) continue;
        const d = Math.hypot(at.x - p.screen.x, at.y - p.screen.y);
        if (d > 5 && d <= 16) {
            const center = screenOf(s.doc, c.node, handlePoint(c.box, 0.5, 0.5));
            return { kind: "rotate", startAngle: Math.atan2(p.screen.y - center.y, p.screen.x - center.x) };
        }
    }
    return null;
}

function transformPatch(p: PluginPointer): NodePatch | null {
    if (!drag) return null;
    const { node, base, box, anchors } = drag;
    const q = toVectorSpace(base, node, p.world);
    let map: (pt: Pt) => Pt;
    if (drag.kind === "scale") {
        const h = drag.handle;
        const center = p.altKey;
        const fixed = center ? handlePoint(box, 0.5, 0.5) : handlePoint(box, 1 - h.fx, 1 - h.fy);
        const moving = handlePoint(box, h.fx, h.fy);
        let sx = h.fx === 0.5 ? 1 : Math.abs(moving.x - fixed.x) > 1e-9 ? (q.x - fixed.x) / (moving.x - fixed.x) : 1;
        let sy = h.fy === 0.5 ? 1 : Math.abs(moving.y - fixed.y) > 1e-9 ? (q.y - fixed.y) / (moving.y - fixed.y) : 1;
        if (p.shiftKey) {
            const k = h.fx === 0.5 ? sy : h.fy === 0.5 ? sx : Math.abs(sx) > Math.abs(sy) ? sx : sy;
            sx = k;
            sy = k;
        }
        map = (pt) => ({ x: fixed.x + (pt.x - fixed.x) * sx, y: fixed.y + (pt.y - fixed.y) * sy });
    } else {
        const s = editor.get();
        const c = handlePoint(box, 0.5, 0.5);
        const cs = screenOf(base, node, c);
        let angle = Math.atan2(p.screen.y - cs.y, p.screen.x - cs.x) - drag.startAngle;
        if (p.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
        // The node may be mirrored; turning in screen space is the same turn in its space unless flipped once.
        const m = worldMatrix(s.doc, node);
        if (m.a * m.d - m.b * m.c < 0) angle = -angle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        map = (pt) => ({ x: c.x + (pt.x - c.x) * cos - (pt.y - c.y) * sin, y: c.y + (pt.x - c.x) * sin + (pt.y - c.y) * cos });
    }
    const subs = placedSubpaths(node);
    for (const a of anchors) {
        const sub = subs[a.sub];
        const pt = sub?.points[a.index];
        if (!sub || !pt) continue;
        sub.points[a.index] = { ...map(pt), in: pt.in ? map(pt.in) : null, out: pt.out ? map(pt.out) : null };
    }
    const fitted = fitPath(subs);
    return { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h, path: fitted.path, parametric: null };
}

registerCanvasPlugin({
    name: "points-box",
    down(p) {
        const kind = hit(p);
        const c = context();
        if (!kind || !c) return false;
        drag = { ...kind, base: editor.get().doc, node: c.node, anchors: c.anchors, box: c.box, start: p.screen };
        return true;
    },
    move(p) {
        const patch = transformPatch(p);
        if (!drag || !patch) return;
        editor.preview(applyCommand(drag.base, { type: "node.update", id: drag.node.id, patch }));
    },
    up(p) {
        const patch = transformPatch(p);
        const d = drag;
        drag = null;
        if (!d || !patch) return;
        if (Math.hypot(p.screen.x - d.start.x, p.screen.y - d.start.y) < 2) {
            editor.preview(d.base);
            return;
        }
        editor.execute({ type: "node.update", id: d.node.id, patch }, d.base);
    },
    hover(p) {
        const kind = hit(p);
        if (!kind) return undefined;
        if (kind.kind === "rotate") return "alias";
        const h = kind.handle;
        return h.id === "n" || h.id === "s" ? "ns-resize" : h.id === "e" || h.id === "w" ? "ew-resize" : h.id === "nw" || h.id === "se" ? "nwse-resize" : "nesw-resize";
    },
    overlay(ctx) {
        const c = context();
        if (!c) return;
        const s = editor.get();
        if (c.box.w * s.camera.zoom < 12 && c.box.h * s.camera.zoom < 12) return;
        const corners = [handlePoint(c.box, 0, 0), handlePoint(c.box, 1, 0), handlePoint(c.box, 1, 1), handlePoint(c.box, 0, 1)].map((q) => screenOf(s.doc, c.node, q));
        ctx.strokeStyle = HANDLE_BLUE;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        corners.forEach((q, i) => {
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const h of HANDLES) {
            if ((c.box.w < 1e-6 && h.fx !== 0.5) || (c.box.h < 1e-6 && h.fy !== 0.5)) continue;
            const at = screenOf(s.doc, c.node, handlePoint(c.box, h.fx, h.fy));
            drawSquare(ctx, at.x, at.y, h.id.length === 2 ? 7 : 6);
        }
    },
});

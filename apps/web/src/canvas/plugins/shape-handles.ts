import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, NodePatch, SceneNode } from "../../engine/types";
import { parametricPath, parametricPoints } from "../../engine/vector";
import { type PluginPointer, drawDot, drawLabel, registerCanvasPlugin } from "../canvas-plugins";

// On-canvas handles of a selected polygon or star, like the reference's: Count (drag sideways to add or
// remove points), Ratio for stars (drag the inner point in or out), and Radius (drag from a corner
// towards the middle to round the corners).

type Kind = "count" | "ratio" | "radius";
type Pt = { x: number; y: number };

function target(): SceneNode | null {
    const s = editor.get();
    if (s.editingVectorId || s.tool !== "move" || s.selection.length !== 1 || s.mode === "dev") return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (!node || !node.parametric || node.sourceId || node.locked) return null;
    // Small on screen: no handles, so the shape can still be grabbed.
    if (Math.min(node.w, node.h) * s.camera.zoom < 28) return null;
    return node;
}

function handles(doc: NagmaDocument, node: SceneNode): Record<Kind, Pt | null> & { center: Pt; corner: Pt } {
    const s = editor.get();
    const p = node.parametric!;
    const m = worldMatrix(doc, node);
    const screen = (q: Pt) => {
        const w = apply(m, q.x, q.y);
        return worldToScreen(s.camera, w.x, w.y);
    };
    const pts = parametricPoints(p.kind, p.count, p.ratio, node.x, node.y, node.w, node.h);
    const center = screen({ x: node.x + node.w / 2, y: node.y + node.h / 2 });
    const corner = screen(pts[0] as Pt);
    const toward = { x: center.x - corner.x, y: center.y - corner.y };
    const len = Math.hypot(toward.x, toward.y) || 1;
    const along = Math.min(len * 0.45, 12 + node.radius * s.camera.zoom);
    const radius = { x: corner.x + (toward.x / len) * along, y: corner.y + (toward.y / len) * along };
    const firstEdge = p.kind === "star" ? (pts[2] as Pt) : (pts[1] as Pt);
    const fe = screen(firstEdge);
    const count = { x: center.x + (fe.x - center.x) * 0.55, y: center.y + (fe.y - center.y) * 0.55 };
    const ratio = p.kind === "star" ? screen(pts[1] as Pt) : null;
    return { count, ratio, radius, center, corner };
}

let drag: { kind: Kind; id: string; base: NagmaDocument; start: Pt; node: SceneNode } | null = null;
let label: { at: Pt; text: string } | null = null;

function hit(p: PluginPointer): Kind | null {
    const node = target();
    if (!node) return null;
    const h = handles(editor.get().doc, node);
    for (const kind of ["ratio", "radius", "count"] as Kind[]) {
        const at = h[kind];
        if (at && Math.hypot(at.x - p.screen.x, at.y - p.screen.y) <= 6) return kind;
    }
    return null;
}

function patchFor(p: PluginPointer): NodePatch | null {
    if (!drag) return null;
    const node = drag.node;
    const params = node.parametric!;
    const zoom = editor.get().camera.zoom;
    const h = handles(drag.base, node);
    if (drag.kind === "count") {
        const dx = p.screen.x - drag.start.x;
        const dy = p.screen.y - drag.start.y;
        const step = Math.round((Math.abs(dx) > Math.abs(dy) ? dx : -dy) / 12);
        const count = Math.max(3, Math.min(60, params.count + step));
        label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: `Count ${count}` };
        return { parametric: { ...params, count } };
    }
    if (drag.kind === "ratio" && h.ratio) {
        const ray = { x: h.ratio.x - h.center.x, y: h.ratio.y - h.center.y };
        const len = Math.hypot(ray.x, ray.y) || 1;
        const proj = ((p.screen.x - h.center.x) * ray.x + (p.screen.y - h.center.y) * ray.y) / len;
        const ratio = Math.max(0.01, Math.min(1, (params.ratio * proj) / len));
        label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: `Ratio ${Math.round(ratio * 1000) / 10}%` };
        return { parametric: { ...params, ratio } };
    }
    const ray = { x: h.center.x - h.corner.x, y: h.center.y - h.corner.y };
    const len = Math.hypot(ray.x, ray.y) || 1;
    const proj = ((p.screen.x - h.corner.x) * ray.x + (p.screen.y - h.corner.y) * ray.y) / len;
    const radius = Math.max(0, Math.round((proj - 12) / zoom));
    label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: `Radius ${radius}` };
    return { radius };
}

function withPath(node: SceneNode, patch: NodePatch): NodePatch {
    return { ...patch, path: parametricPath({ ...node, ...patch } as SceneNode) };
}

registerCanvasPlugin({
    name: "shape-handles",
    down(p) {
        const kind = hit(p);
        const node = target();
        if (!kind || !node) return false;
        drag = { kind, id: node.id, base: editor.get().doc, start: p.screen, node };
        return true;
    },
    move(p) {
        const patch = patchFor(p);
        if (!drag || !patch) return;
        editor.preview(applyCommand(drag.base, { type: "node.update", id: drag.id, patch: withPath(drag.node, patch) }));
    },
    up(p) {
        const patch = patchFor(p);
        const d = drag;
        drag = null;
        label = null;
        if (!d || !patch) return;
        editor.execute({ type: "node.update", id: d.id, patch: withPath(d.node, patch) }, d.base);
    },
    hover(p) {
        const kind = hit(p);
        if (!kind) return undefined;
        return kind === "count" ? "ew-resize" : "pointer";
    },
    overlay(ctx) {
        const node = target();
        if (!node) return;
        const h = handles(editor.get().doc, node);
        for (const kind of ["count", "ratio", "radius"] as Kind[]) {
            const at = h[kind];
            if (at) drawDot(ctx, at.x, at.y, kind === "count" ? 4 : 3.5, kind === "count" ? "#0D99FF" : "#FFFFFF");
        }
        if (label) drawLabel(ctx, label.at.x, label.at.y, label.text);
    },
});

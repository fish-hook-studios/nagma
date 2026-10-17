import { leaveVectorEdit } from "../../engine/actions";
import { screenToWorld } from "../../engine/camera";
import { eraseWithBrush, squareBand } from "../../engine/eraser";
import { editor } from "../../engine/store";
import type { SceneNode } from "../../engine/types";
import { type PluginPointer, registerCanvasPlugin } from "../canvas-plugins";
import { toVectorSpace } from "../vector-edit";
import { vectorUi } from "../../engine/vector-ui";

// The Erase tool (⇧E in point editing): drag a round or square brush over the vector to cut that area out
// of it. The trail shows while dragging; the cut happens on release as one undo step.

// The brush diameter on screen: the eraser's weight (in canvas units) at the current zoom.
const size = () => Math.max(2, vectorUi.get().eraserSize * editor.get().camera.zoom);

function editingNode(): SceneNode | null {
    const s = editor.get();
    if (!s.editingVectorId || s.vectorTool !== "erase" || s.tool === "pen") return null;
    const node = s.doc.nodes[s.editingVectorId];
    return node && node.type === "vector" ? node : null;
}

let trail: { x: number; y: number }[] | null = null;
let hover: { x: number; y: number } | null = null;

registerCanvasPlugin({
    name: "eraser",
    down(p) {
        if (!editingNode()) return false;
        trail = [p.screen];
        return true;
    },
    move(p: PluginPointer) {
        if (!trail) return;
        trail.push(p.screen);
        editor.set({});
    },
    up() {
        const node = editingNode();
        const line = trail;
        trail = null;
        if (!node || !line) return;
        const s = editor.get();
        const camera = s.camera;
        // The trail in the vector's own placement space.
        const pts = line.map((q) => toVectorSpace(s.doc, node, screenToWorld(camera, q.x, q.y)));
        const patch = eraseWithBrush(node, pts, vectorUi.get().eraserSize / 2, vectorUi.get().eraserShape);
        if (patch === undefined) {
            editor.set({});
            return;
        }
        if (patch === null) {
            editor.execute({ type: "node.delete", ids: [node.id] });
            leaveVectorEdit();
            editor.set({ selection: [] });
            return;
        }
        editor.execute({ type: "node.update", id: node.id, patch });
        editor.set({ vertices: [] });
    },
    hover(p) {
        if (!editingNode()) {
            if (hover) hover = null;
            return undefined;
        }
        hover = p.screen;
        editor.set({});
        return "none";
    },
    overlay(ctx) {
        if (!editingNode()) return;
        const square = vectorUi.get().eraserShape === "square";
        if (trail && trail.length && square) {
            // The square brush sweeps upright squares: each step's band, filled.
            ctx.fillStyle = "rgba(245, 69, 92, 0.45)";
            ctx.beginPath();
            const r = size() / 2;
            for (let i = 0; i < trail.length; i++) {
                const band = squareBand(trail[Math.max(0, i - 1)]!, trail[i]!, r);
                band.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
                ctx.closePath();
            }
            ctx.fill("nonzero");
        } else if (trail && trail.length) {
            ctx.strokeStyle = "rgba(245, 69, 92, 0.45)";
            ctx.lineWidth = size();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(trail[0]!.x, trail[0]!.y);
            for (const q of trail) ctx.lineTo(q.x, q.y);
            if (trail.length === 1) ctx.lineTo(trail[0]!.x + 0.01, trail[0]!.y);
            ctx.stroke();
        }
        const at = trail?.[trail.length - 1] ?? hover;
        if (at) {
            ctx.beginPath();
            if (square) ctx.rect(at.x - size() / 2, at.y - size() / 2, size(), size());
            else ctx.arc(at.x, at.y, size() / 2, 0, Math.PI * 2);
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 0.75;
            ctx.stroke();
        }
    },
});

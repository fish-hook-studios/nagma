import { worldToScreen } from "../../engine/camera";
import { editor } from "../../engine/store";
import { worldMatrix, apply } from "../../engine/transform";
import type { SceneNode } from "../../engine/types";
import { placedSubpaths, tracePath } from "../../engine/vector";
import { faceAt, isFaceFilled, networkFaces, filledSubpaths } from "../../engine/vector-network";
import { registerCanvasPlugin } from "../canvas-plugins";
import { toVectorSpace } from "../vector-edit";

// The Paint tool's hover: the region of the vector network under the pointer shows diagonal stripes
// (the regions a drag has painted so far too), and the cursor is a droplet with + (fill) or −
// (clear: a filled region, or ⌥).

export const paintPreview: { hovered: string[]; painted: string[] | null; remove: boolean } = { hovered: [], painted: null, remove: false };

function paintingNode(): SceneNode | null {
    const s = editor.get();
    if (!s.editingVectorId || s.vectorTool !== "paint" || s.tool === "pen") return null;
    const node = s.doc.nodes[s.editingVectorId];
    return node && node.type === "vector" ? node : null;
}

function droplet(minus: boolean): string {
    const sign = minus ? '<path d="M15 17h6" stroke="black" stroke-width="3"/><path d="M15 17h6" stroke="white" stroke-width="1.5"/>' : '<path d="M15 17h6M18 14v6" stroke="black" stroke-width="3"/><path d="M15 17h6M18 14v6" stroke="white" stroke-width="1.5"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M9 2C9 2 3 9 3 13a6 6 0 0 0 12 0c0-4-6-11-6-11Z" fill="white" stroke="black" stroke-width="1.2"/>${sign}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 9 18, cell`;
}

let stripes: CanvasPattern | null = null;
function stripePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (stripes) return stripes;
    const tile = document.createElement("canvas");
    tile.width = tile.height = 8;
    const t = tile.getContext("2d");
    if (!t) return null;
    t.strokeStyle = "rgba(13, 153, 255, 0.85)";
    t.lineWidth = 1.5;
    t.beginPath();
    for (const o of [-8, 0, 8]) {
        t.moveTo(o, 8);
        t.lineTo(o + 8, 0);
    }
    t.stroke();
    stripes = ctx.createPattern(tile, "repeat");
    return stripes;
}

registerCanvasPlugin({
    name: "paint-preview",
    hover(p) {
        const node = paintingNode();
        if (!node) {
            if (paintPreview.hovered.length) paintPreview.hovered = [];
            return undefined;
        }
        const subs = placedSubpaths(node);
        const face = faceAt(networkFaces(subs), toVectorSpace(editor.get().doc, node, p.world));
        const hits = face ? [face.id] : [];
        const remove = p.altKey || Boolean(face && isFaceFilled(node, subs, face.id));
        const changed = hits.join() !== paintPreview.hovered.join() || paintPreview.remove !== remove;
        paintPreview.hovered = hits;
        paintPreview.remove = remove;
        if (changed) editor.set({});
        return droplet(remove);
    },
    overlay(ctx, camera) {
        const node = paintingNode();
        if (!node) return;
        const regions = paintPreview.painted ?? paintPreview.hovered;
        if (!regions.length) return;
        const m = worldMatrix(editor.get().doc, node);
        const toScreen = (q: { x: number; y: number }) => {
            const w = apply(m, q.x, q.y);
            return worldToScreen(camera, w.x, w.y);
        };
        const subs = filledSubpaths(placedSubpaths(node), [...new Set(regions)]).map((sub) => ({ ...sub, points: sub.points.map((q) => ({ ...toScreen(q), in: q.in ? toScreen(q.in) : null, out: q.out ? toScreen(q.out) : null })) }));
        const path = new Path2D();
        tracePath(path, subs);
        const pattern = stripePattern(ctx);
        ctx.save();
        ctx.fillStyle = pattern ?? "rgba(13, 153, 255, 0.25)";
        ctx.fill(path, "nonzero");
        ctx.strokeStyle = "#0D99FF";
        ctx.lineWidth = 1;
        ctx.stroke(path);
        ctx.restore();
    },
});

import { effectsOf } from "./effects";
import { selectionBounds } from "./nodes";
import type { NagmaDocument, Rect, SceneNode } from "./types";

// How far a layer's own effects reach past its box: drop shadows (offset, blur and spread) and
// layer or motion blur. A blur fades out over about one and a half times its radius (the canvas and
// SVG blurs both use a deviation of half the radius).
export function effectOutsets(node: SceneNode): { left: number; top: number; right: number; bottom: number } {
    const out = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const e of effectsOf(node)) {
        if (!e.visible) continue;
        if (e.type === "drop-shadow") {
            const r = Math.max(0, e.blur * 1.5 + (e.spread ?? 0));
            out.left = Math.max(out.left, r - e.x);
            out.right = Math.max(out.right, r + e.x);
            out.top = Math.max(out.top, r - e.y);
            out.bottom = Math.max(out.bottom, r + e.y);
        } else if (e.type === "layer-blur" || e.type === "motion-blur") {
            const r = e.blur * 1.5;
            out.left = Math.max(out.left, r);
            out.right = Math.max(out.right, r);
            out.top = Math.max(out.top, r);
            out.bottom = Math.max(out.bottom, r);
        }
    }
    return { left: Math.ceil(out.left), top: Math.ceil(out.top), right: Math.ceil(out.right), bottom: Math.ceil(out.bottom) };
}

// What an export of a layer shows: its box grown by its effects, and by layers inside it that its
// box doesn't clip (a group, or a frame with Clip content off) with their own effects.
export function exportBounds(doc: NagmaDocument, node: SceneNode): Rect | null {
    const box = selectionBounds(doc, [node.id]);
    if (!box) return null;
    const o = effectOutsets(node);
    let x1 = box.x - o.left;
    let y1 = box.y - o.top;
    let x2 = box.x + box.w + o.right;
    let y2 = box.y + box.h + o.bottom;
    const clips = (node.type === "frame" || node.type === "component" || node.type === "instance" || node.type === "componentSet") && node.clip !== false;
    if (!clips) {
        for (const id of node.children) {
            const child = doc.nodes[id];
            if (!child || child.visible === false) continue;
            const b = exportBounds(doc, child);
            if (!b) continue;
            x1 = Math.min(x1, b.x);
            y1 = Math.min(y1, b.y);
            x2 = Math.max(x2, b.x + b.w);
            y2 = Math.max(y2, b.y + b.h);
        }
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

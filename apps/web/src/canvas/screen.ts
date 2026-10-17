import { smartTween } from "../engine/prototype";
import { easeTransition } from "../engine/easing-curves";
import type { Direction, NagmaDocument, SceneNode, Transition } from "../engine/types";
import { drawNode } from "./render";

// Where screens land on a canvas: the prototype player and the motion exporter share this, so an
// exported video plays exactly like the prototype.
export interface Viewport {
    // CSS pixels.
    width: number;
    height: number;
    // Device pixels per CSS pixel.
    dpr: number;
    place: (frame: SceneNode) => { scale: number; x: number; y: number };
}

export const OPPOSITE: Record<Direction, Direction> = { left: "right", right: "left", up: "down", down: "up" };

const VECTOR: Record<Direction, { x: number; y: number }> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

// Centred, scaled down to fit inside a margin (never up).
export function fitPlacement(frame: SceneNode, width: number, height: number, pad = 24) {
    const scale = Math.min(1, (width - pad * 2) / frame.w, (height - pad * 2) / frame.h);
    return { scale, x: (width - frame.w * scale) / 2, y: (height - frame.h * scale) / 2 };
}

// Fills the viewport's width (never scaled up past 1x); tall screens scroll.
export function widthPlacement(frame: SceneNode, width: number, pad = 0) {
    const scale = Math.min(1, (width - pad * 2) / frame.w);
    return { scale, x: (width - frame.w * scale) / 2, y: 0 };
}

// Some layers of a screen, at the screen's placement plus an offset (for pinned layers).
export function drawLayers(ctx: CanvasRenderingContext2D, doc: NagmaDocument, frameId: string, ids: string[], vp: Viewport, offset = { x: 0, y: 0 }) {
    const frame = doc.nodes[frameId];
    if (!frame) return;
    const p = vp.place(frame);
    ctx.save();
    ctx.setTransform(vp.dpr * p.scale, 0, 0, vp.dpr * p.scale, vp.dpr * (p.x + offset.x), vp.dpr * (p.y + offset.y));
    ctx.translate(-frame.x, -frame.y);
    for (const id of ids) {
        const node = doc.nodes[id];
        if (node) drawNode(ctx, doc, node, { editingTextId: null, pixelScale: p.scale * vp.dpr });
    }
    ctx.restore();
}

// Centred and scaled to fill the viewport as far as the aspect ratio allows.
export function fillPlacement(frame: SceneNode, width: number, height: number) {
    const scale = Math.min(width / frame.w, height / frame.h);
    return { scale, x: (width - frame.w * scale) / 2, y: (height - frame.h * scale) / 2 };
}

export function drawScreen(ctx: CanvasRenderingContext2D, doc: NagmaDocument, frameId: string, vp: Viewport, offset = { x: 0, y: 0 }, alpha = 1) {
    const frame = doc.nodes[frameId];
    if (!frame) return;
    const p = vp.place(frame);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setTransform(vp.dpr * p.scale, 0, 0, vp.dpr * p.scale, vp.dpr * (p.x + offset.x), vp.dpr * (p.y + offset.y));
    ctx.translate(-frame.x, -frame.y);
    drawNode(ctx, doc, frame, { editingTextId: null, pixelScale: p.scale * vp.dpr });
    ctx.restore();
}

// One moment of a transition between two screens, `t` from 0 to 1 (before easing).
export function drawTransition(ctx: CanvasRenderingContext2D, doc: NagmaDocument, from: string, to: string, transition: Transition, t: number, reverse: boolean, vp: Viewport) {
    const e = easeTransition(transition, t);
    const { width, height } = vp;
    const dir = reverse ? OPPOSITE[transition.direction] : transition.direction;
    const vector = VECTOR[dir];
    // New content travels in the chosen direction, so it starts on the opposite side.
    const enter = { x: -vector.x * width * (1 - e), y: -vector.y * height * (1 - e) };
    switch (transition.type) {
        case "instant":
            drawScreen(ctx, doc, to, vp);
            break;
        case "dissolve":
            drawScreen(ctx, doc, from, vp);
            drawScreen(ctx, doc, to, vp, undefined, e);
            break;
        case "move-in":
            drawScreen(ctx, doc, from, vp);
            drawScreen(ctx, doc, to, vp, enter);
            break;
        case "move-out":
            // The old screen leaves in the chosen direction, revealing the new one beneath.
            drawScreen(ctx, doc, to, vp);
            drawScreen(ctx, doc, from, vp, { x: vector.x * width * e, y: vector.y * height * e });
            break;
        case "slide-out":
            drawScreen(ctx, doc, to, vp, { x: -vector.x * width * 0.3 * (1 - e), y: -vector.y * height * 0.3 * (1 - e) }, 0.6 + e * 0.4);
            drawScreen(ctx, doc, from, vp, { x: vector.x * width * e, y: vector.y * height * e });
            break;
        case "push":
            drawScreen(ctx, doc, from, vp, { x: vector.x * width * e, y: vector.y * height * e });
            drawScreen(ctx, doc, to, vp, enter);
            break;
        case "slide-in":
            drawScreen(ctx, doc, from, vp, { x: vector.x * width * 0.3 * e, y: vector.y * height * 0.3 * e }, 1 - e * 0.4);
            drawScreen(ctx, doc, to, vp, enter);
            break;
        case "smart": {
            const tween = smartTween(doc, from, to, e);
            drawScreen(ctx, tween.doc, to, vp);
            // Layers that only exist on the old screen fade out in place.
            const toNode = doc.nodes[to];
            const fromNode = doc.nodes[from];
            if (toNode && fromNode) {
                const p = vp.place(toNode);
                for (const node of tween.leaving) {
                    ctx.save();
                    ctx.setTransform(vp.dpr * p.scale, 0, 0, vp.dpr * p.scale, vp.dpr * p.x, vp.dpr * p.y);
                    ctx.translate(-fromNode.x, -fromNode.y);
                    drawNode(ctx, doc, node, { editingTextId: null, pixelScale: p.scale * vp.dpr });
                    ctx.restore();
                }
            }
            break;
        }
    }
}

import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { type FrameHandle, cropFor, cropFramePatch, croppedPaint, endCrop, frameHandleAt, imageCorners, placement, resizeCropFrame, startCrop, withPaint } from "../../engine/image-crop";
import { getImage } from "../../engine/images";
import { firstImagePaint } from "../../engine/photo";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, NodePatch, SceneNode } from "../../engine/types";
import { vectorUi } from "../../engine/vector-ui";
import { addKeyHandler } from "../../hooks/use-vector-shortcuts";
import { type PluginPointer, HANDLE_BLUE, drawDot, registerCanvasPlugin } from "../canvas-plugins";
import { nodeContains } from "../hit-test";
import { toVectorSpace } from "../vector-edit";

// Crop mode on the canvas, as in the reference: the frame's corners and edges (anywhere along a
// side) resize the crop while the image stays put, dragging inside moves the image under the
// frame, the image's corner handles scale it (keeping its proportions), and the part of the image
// outside the frame shows dimmed. A click outside, Enter or Escape keeps the crop; the crop bar's
// Cancel puts the layer back.

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

function active() {
    const s = editor.get();
    const c = croppedPaint(s.doc);
    if (!c) {
        if (vectorUi.get().crop) queueMicrotask(endCrop);
        return null;
    }
    return { ...c, place: placement(s.doc, c.node, c.paint) };
}

function screen(doc: NagmaDocument, node: SceneNode, p: Pt): Pt {
    const w = apply(worldMatrix(doc, node), p.x, p.y);
    return worldToScreen(editor.get().camera, w.x, w.y);
}

type Drag =
    | { kind: "frame"; handle: FrameHandle }
    | { kind: "corner"; index: number }
    | { kind: "image" };

let drag: (Drag & { base: NagmaDocument; node: SceneNode; index: number; place: DOMMatrix; start: Pt; box: Box }) | null = null;

function hit(p: PluginPointer): Drag | null {
    const c = active();
    if (!c) return null;
    const s = editor.get();
    const box = { x: c.node.x, y: c.node.y, w: c.node.w, h: c.node.h };
    const frameCorners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ].map(([fx, fy]) => screen(s.doc, c.node, { x: box.x + box.w * (fx ?? 0), y: box.y + box.h * (fy ?? 0) }));
    const handle = frameHandleAt(frameCorners, p.screen, 6);
    if (handle) return { kind: "frame", handle };
    const corners = imageCorners(c.place).map((q) => screen(s.doc, c.node, q));
    for (let i = 0; i < 4; i++) {
        const at = corners[i] as Pt;
        if (Math.hypot(at.x - p.screen.x, at.y - p.screen.y) <= 7) return { kind: "corner", index: i };
    }
    // Inside the image (or the frame): move the image.
    const q = toVectorSpace(s.doc, c.node, p.world);
    const uv = c.place.inverse().transformPoint(new DOMPoint(q.x, q.y));
    const inImage = uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1;
    const inFrame = q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h;
    return inImage || inFrame ? { kind: "image" } : null;
}

function result(p: PluginPointer): NodePatch | null {
    if (!drag) return null;
    const { node, base, box, start } = drag;
    const q = toVectorSpace(base, node, p.world);
    const s0 = toVectorSpace(base, node, start);
    const paint = node.fills[drag.index];
    if (paint?.type !== "image") return null;
    if (drag.kind === "image") {
        const place = new DOMMatrix().translate(q.x - s0.x, q.y - s0.y).multiply(drag.place);
        return withPaint(node, drag.index, { ...paint, mode: "crop", crop: cropFor(box, place) });
    }
    if (drag.kind === "corner") {
        const corners = imageCorners(drag.place);
        const c = corners[drag.index] as Pt;
        const o = corners[(drag.index + 2) % 4] as Pt;
        const v = { x: c.x - o.x, y: c.y - o.y };
        const len2 = v.x * v.x + v.y * v.y || 1;
        const k = Math.max(0.01, ((q.x - o.x) * v.x + (q.y - o.y) * v.y) / len2);
        const place = new DOMMatrix().translate(o.x, o.y).scale(k, k).translate(-o.x, -o.y).multiply(drag.place);
        return withPaint(node, drag.index, { ...paint, mode: "crop", crop: cropFor(box, place) });
    }
    // Frame handle: the crop region changes, the image stays where it is.
    const next = resizeCropFrame(box, drag.handle, q.x - s0.x, q.y - s0.y, p.shiftKey);
    return cropFramePatch(node, drag.index, paint, next, drag.place);
}

registerCanvasPlugin({
    name: "image-crop",
    down(p) {
        const c = active();
        if (!c) return false;
        const kind = hit(p);
        if (!kind) {
            // A click outside leaves crop mode; the canvas then handles the click as usual.
            endCrop();
            return false;
        }
        drag = { ...kind, base: editor.get().doc, node: c.node, index: c.index, place: c.place, start: p.world, box: { x: c.node.x, y: c.node.y, w: c.node.w, h: c.node.h } };
        return true;
    },
    move(p) {
        const patch = result(p);
        if (!drag || !patch) return;
        editor.preview(applyCommand(drag.base, { type: "node.update", id: drag.node.id, patch }));
    },
    up(p) {
        const patch = result(p);
        const d = drag;
        drag = null;
        if (!d || !patch) return;
        if (Math.hypot(p.world.x - d.start.x, p.world.y - d.start.y) * editor.get().camera.zoom < 1) {
            editor.preview(d.base);
            return;
        }
        editor.execute({ type: "node.update", id: d.node.id, patch }, d.base);
    },
    hover(p) {
        if (!vectorUi.get().crop) return undefined;
        const kind = hit(p);
        if (!kind) return "default";
        if (kind.kind === "image") return "move";
        if (kind.kind === "corner") return kind.index % 2 === 0 ? "nwse-resize" : "nesw-resize";
        const id = kind.handle.id;
        return id === "n" || id === "s" ? "ns-resize" : id === "e" || id === "w" ? "ew-resize" : id === "nw" || id === "se" ? "nwse-resize" : "nesw-resize";
    },
    dblclick(p) {
        const s = editor.get();
        if (vectorUi.get().crop || s.editingVectorId || s.selection.length !== 1) return false;
        const node = s.doc.nodes[s.selection[0] ?? ""];
        const index = firstImagePaint(node);
        if (!node || index < 0 || node.sourceId || !nodeContains(s.doc, node, p.world.x, p.world.y)) return false;
        // Video fills keep their own editor.
        const paint = node.fills[index];
        if (paint?.type === "image" && paint.video) return false;
        startCrop(node.id, index);
        return true;
    },
    overlay(ctx, camera) {
        const c = active();
        if (!c) return;
        const s = editor.get();
        const m = worldMatrix(s.doc, c.node);
        const img = getImage(s.doc, c.paint.id);
        // The whole image, dimmed outside the frame.
        if (img) {
            ctx.save();
            ctx.translate(camera.x, camera.y);
            ctx.scale(camera.zoom, camera.zoom);
            ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
            const pl = c.place;
            ctx.transform(pl.a, pl.b, pl.c, pl.d, pl.e, pl.f);
            ctx.globalAlpha = 0.35;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, 1, 1);
            ctx.restore();
        }
        const corners = imageCorners(c.place).map((q) => screen(s.doc, c.node, q));
        // The whole image's outline and corner handles only show where it reaches past the frame.
        const frameCorners = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ].map(([fx, fy]) => screen(s.doc, c.node, { x: c.node.x + c.node.w * (fx ?? 0), y: c.node.y + c.node.h * (fy ?? 0) }));
        const beyond = corners.some((q, i) => Math.hypot(q.x - (frameCorners[i]?.x ?? 0), q.y - (frameCorners[i]?.y ?? 0)) > 2);
        if (beyond) {
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            corners.forEach((q, i) => {
                if (i) ctx.lineTo(q.x, q.y);
                else ctx.moveTo(q.x, q.y);
            });
            ctx.closePath();
            ctx.stroke();
            for (const q of corners) drawDot(ctx, q.x, q.y, 4);
        }
        const box = { x: c.node.x, y: c.node.y, w: c.node.w, h: c.node.h };
        const frame = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ].map(([fx, fy]) => screen(s.doc, c.node, { x: box.x + box.w * (fx ?? 0), y: box.y + box.h * (fy ?? 0) }));
        // The crop frame as the reference draws it: a dotted edge, L-shaped corner brackets and
        // short bars at the middle of each side, all in the selection blue.
        ctx.save();
        ctx.strokeStyle = HANDLE_BLUE;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        frame.forEach((q, i) => {
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.lineCap = "square";
        const toward = (a: Pt, b: Pt, len: number): Pt => {
            const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const k = Math.min(len, d / 3) / d;
            return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        };
        ctx.beginPath();
        frame.forEach((q, i) => {
            const prev = frame[(i + 3) % 4] as Pt;
            const next = frame[(i + 1) % 4] as Pt;
            const a = toward(q, prev, 10);
            const b = toward(q, next, 10);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(q.x, q.y);
            ctx.lineTo(b.x, b.y);
        });
        frame.forEach((q, i) => {
            const next = frame[(i + 1) % 4] as Pt;
            const mid = { x: (q.x + next.x) / 2, y: (q.y + next.y) / 2 };
            const a = toward(mid, q, 5);
            const b = toward(mid, next, 5);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        });
        ctx.stroke();
        ctx.restore();
    },
});

// Enter or Escape leaves crop mode; ⌫ does nothing to the layer while cropping.
addKeyHandler((event) => {
    if (!vectorUi.get().crop) return false;
    if (event.key === "Enter" || event.key === "Escape") {
        endCrop();
        return true;
    }
    return false;
});

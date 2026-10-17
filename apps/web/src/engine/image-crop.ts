import { getImage } from "./images";
import { firstImagePaint } from "./photo";
import { editor } from "./store";
import type { ImagePaint, NagmaDocument, NodePatch, SceneNode } from "./types";
import { vectorUi } from "./vector-ui";

// Image crop mode, like the reference's: the layer is the crop frame and the image sits behind it. The
// image's placement is kept as a matrix from the image's unit square to the layer's parent space;
// the stored crop (ImagePaint.crop) maps the layer's unit square into the image's unit square, so
// crop = placement⁻¹ · box. Moving the frame leaves the image where it is; moving the image pans
// it under the frame.

type Crop = NonNullable<ImagePaint["crop"]>;

export function cropMatrix(crop: Crop): DOMMatrix {
    const [m00, m01, m02, m10, m11, m12] = crop;
    return new DOMMatrix([m00, m10, m01, m11, m02, m12]);
}

export function matrixCrop(m: DOMMatrix): Crop {
    return [m.a, m.c, m.e, m.b, m.d, m.f];
}

export function boxMatrix(box: { x: number; y: number; w: number; h: number }): DOMMatrix {
    return new DOMMatrix([box.w, 0, 0, box.h, box.x, box.y]);
}

// The image's natural size (1×1 until it has loaded).
export function imageSize(doc: NagmaDocument, paint: ImagePaint): { w: number; h: number } {
    const img = getImage(doc, paint.id);
    if (img && img.naturalWidth > 0) return { w: img.naturalWidth, h: img.naturalHeight };
    return { w: Math.max(1, paint.video?.width ?? 1), h: Math.max(1, paint.video?.height ?? 1) };
}

// Where the image sits (unit square → parent space) for any fill mode.
export function placement(doc: NagmaDocument, node: SceneNode, paint: ImagePaint): DOMMatrix {
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    if (paint.mode === "crop" && paint.crop) {
        const m = cropMatrix(paint.crop);
        if (Math.abs(m.a * m.d - m.b * m.c) > 1e-12) return boxMatrix(box).multiply(m.inverse());
    }
    const size = imageSize(doc, paint);
    const scale = paint.mode === "fit" ? Math.min(box.w / size.w, box.h / size.h) : Math.max(box.w / size.w, box.h / size.h);
    const w = size.w * scale;
    const h = size.h * scale;
    return boxMatrix({ x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
}

export function cropFor(box: { x: number; y: number; w: number; h: number }, place: DOMMatrix): Crop {
    return matrixCrop(place.inverse().multiply(boxMatrix(box)));
}

// The image's four corners in parent space (top-left, top-right, bottom-right, bottom-left of the image).
export function imageCorners(place: DOMMatrix): { x: number; y: number }[] {
    return [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ].map(([u, v]) => {
        const p = place.transformPoint(new DOMPoint(u, v));
        return { x: p.x, y: p.y };
    });
}

// Grows the image (about the frame's centre) until it covers the frame, so no empty corners show.
export function cover(box: { x: number; y: number; w: number; h: number }, place: DOMMatrix): DOMMatrix {
    const inv = place.inverse();
    const corners = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
    ].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
    const inside = corners.every((p) => p.x >= -1e-6 && p.x <= 1 + 1e-6 && p.y >= -1e-6 && p.y <= 1 + 1e-6);
    if (inside) return place;
    // Scale the image about the frame's centre by the factor its unit square needs to hold the corners.
    const c = inv.transformPoint(new DOMPoint(box.x + box.w / 2, box.y + box.h / 2));
    let k = 1;
    for (const p of corners) {
        const room = (v: number, centre: number) => (v > centre ? (v - centre) / Math.max(1e-9, 1 - centre) : (centre - v) / Math.max(1e-9, centre));
        k = Math.max(k, room(p.x, c.x), room(p.y, c.y));
    }
    if (!Number.isFinite(k) || k > 1e4) k = 1;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const scaled = new DOMMatrix().translate(cx, cy).scale(k, k).translate(-cx, -cy).multiply(place);
    // If the centre was near an edge, slide the image so the frame sits inside it.
    const inv2 = scaled.inverse();
    const cs = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
    ].map(([x, y]) => inv2.transformPoint(new DOMPoint(x, y)));
    const minU = Math.min(...cs.map((p) => p.x));
    const maxU = Math.max(...cs.map((p) => p.x));
    const minV = Math.min(...cs.map((p) => p.y));
    const maxV = Math.max(...cs.map((p) => p.y));
    const du = minU < 0 ? minU : maxU > 1 ? maxU - 1 : 0;
    const dv = minV < 0 ? minV : maxV > 1 ? maxV - 1 : 0;
    return scaled.multiply(new DOMMatrix().translate(du, dv));
}

// The paint of the layer being cropped.
export function croppedPaint(doc: NagmaDocument): { node: SceneNode; paint: ImagePaint; index: number } | null {
    const c = vectorUi.get().crop;
    if (!c) return null;
    const node = doc.nodes[c.nodeId];
    const paint = node?.fills[c.paintIndex];
    if (!node || paint?.type !== "image") return null;
    return { node, paint, index: c.paintIndex };
}

export function withPaint(node: SceneNode, index: number, paint: ImagePaint): NodePatch {
    return { fills: node.fills.map((p, i) => (i === index ? paint : p)) };
}

// Enters crop mode on a layer's image fill (the topmost by default), switching the fill to Crop
// mode where the image is now, so nothing moves.
export function startCrop(nodeId?: string, paintIndex?: number) {
    const s = editor.get();
    const id = nodeId ?? s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    const index = paintIndex ?? firstImagePaint(node);
    const paint = node?.fills[index];
    if (!node || paint?.type !== "image" || node.sourceId) {
        editor.notify("Select a layer with an image fill to crop it.");
        return;
    }
    if (s.editingVectorId) editor.set({ editingVectorId: null, vertices: [] });
    // What Cancel puts back: the layer as it was before crop mode (its fill mode included).
    if (vectorUi.get().crop?.nodeId !== node.id) cropStart = { nodeId: node.id, x: node.x, y: node.y, w: node.w, h: node.h, fills: node.fills };
    if (paint.mode !== "crop" || !paint.crop) {
        const place = placement(s.doc, node, paint);
        const box = { x: node.x, y: node.y, w: node.w, h: node.h };
        editor.execute({ type: "node.update", id: node.id, patch: withPaint(node, index, { ...paint, mode: "crop", crop: cropFor(box, paint.mode === "fit" ? place : cover(box, place)) }) });
    }
    editor.set({ selection: [node.id], tool: "move" });
    vectorUi.set({ crop: { nodeId: node.id, paintIndex: index } });
}

let cropStart: { nodeId: string; x: number; y: number; w: number; h: number; fills: SceneNode["fills"] } | null = null;

// Done (✓, Enter, Escape or a click outside): the crop stays.
export function endCrop() {
    cropStart = null;
    if (vectorUi.get().crop) vectorUi.set({ crop: null });
}

// Cancel: the layer goes back to how it was when crop mode began (one undo step), then crop mode ends.
export function cancelCrop() {
    const start = cropStart;
    const node = start ? editor.get().doc.nodes[start.nodeId] : undefined;
    if (start && node) {
        const { nodeId: _id, ...before } = start;
        const changed = node.x !== before.x || node.y !== before.y || node.w !== before.w || node.h !== before.h || node.fills !== before.fills;
        if (changed) editor.execute({ type: "node.update", id: node.id, patch: before });
    }
    endCrop();
}

// "Fit": the frame takes the whole image's proportions and the image fills it (the collapse button).
export function fitCrop() {
    cropAspect("original");
    resetCrop();
    editor.mergeLast();
}

// The crop bar's actions. Each is one undo step.
function change(fn: (node: SceneNode, paint: ImagePaint, place: DOMMatrix, doc: NagmaDocument) => { box?: { x: number; y: number; w: number; h: number }; place: DOMMatrix } | null) {
    const s = editor.get();
    const c = croppedPaint(s.doc);
    if (!c) return;
    const place = placement(s.doc, c.node, c.paint);
    const next = fn(c.node, c.paint, place, s.doc);
    if (!next) return;
    const box = next.box ?? { x: c.node.x, y: c.node.y, w: c.node.w, h: c.node.h };
    const patch: NodePatch = { ...withPaint(c.node, c.index, { ...c.paint, mode: "crop", crop: cropFor(box, next.place) }) };
    if (next.box) Object.assign(patch, { x: box.x, y: box.y, w: box.w, h: box.h });
    editor.execute({ type: "node.update", id: c.node.id, patch });
}

function about(box: { x: number; y: number; w: number; h: number }, m: DOMMatrix): DOMMatrix {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return new DOMMatrix().translate(cx, cy).multiply(m).translate(-cx, -cy);
}

export function rotateCrop90() {
    change((node, _paint, place) => {
        const box = { x: node.x, y: node.y, w: node.w, h: node.h };
        return { place: cover(box, about(box, new DOMMatrix().rotate(90)).multiply(place)) };
    });
}

export function flipCrop(axis: "x" | "y") {
    change((node, _paint, place) => {
        const box = { x: node.x, y: node.y, w: node.w, h: node.h };
        return { place: about(box, new DOMMatrix().scale(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1)).multiply(place) };
    });
}

// Back to the whole image covering the frame (like Fill), keeping the frame.
export function resetCrop() {
    change((node, paint, _place, doc) => {
        const size = imageSize(doc, paint);
        const box = { x: node.x, y: node.y, w: node.w, h: node.h };
        const scale = Math.max(box.w / size.w, box.h / size.h);
        const w = size.w * scale;
        const h = size.h * scale;
        return { place: boxMatrix({ x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }) };
    });
}

// Sets the frame's proportions (width kept, centred), or the image's own with "original".
export function cropAspect(ratio: number | "original") {
    change((node, _paint, place) => {
        let r: number;
        if (ratio === "original") {
            // The image's proportions as it sits now (turned a quarter, width and height swap).
            const [a, b, , d] = imageCorners(place);
            r = Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0)) / Math.max(1e-9, Math.hypot((d?.x ?? 0) - (a?.x ?? 0), (d?.y ?? 0) - (a?.y ?? 0)));
            if (Math.abs(place.b) > Math.abs(place.a)) r = 1 / r;
        } else r = ratio;
        const cy = node.y + node.h / 2;
        const h = node.w / r;
        const box = { x: node.x, y: cy - h / 2, w: node.w, h };
        return { box, place: cover(box, place) };
    });
}

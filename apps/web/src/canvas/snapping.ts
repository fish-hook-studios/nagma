import { editor } from "../engine/store";
import { isEffectivelyVisible, selectionBounds } from "../engine/nodes";
import { worldBounds } from "../engine/transform";
import type { NagmaDocument, Rect } from "../engine/types";

// A guide line in world space, drawn while a snap is active.
export interface Guide {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface SnapResult {
    dx: number;
    dy: number;
    guides: Guide[];
}

interface Line {
    value: number;
    from: number;
    to: number;
}

const SNAP_PX = 5;

// Rects the selection can snap to: its siblings and its parent frame, or every top-level layer.
export function snapTargets(doc: NagmaDocument, moving: string[]): Rect[] {
    if (!editor.get().prefs.snapToObjects) return [];
    const skip = new Set(moving);
    const first = doc.nodes[moving[0] ?? ""];
    const parentId = first?.parentId ?? null;
    const siblings = parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots;
    const rects: Rect[] = [];
    for (const id of siblings) {
        const node = doc.nodes[id];
        if (!node || skip.has(id) || !isEffectivelyVisible(doc, node)) continue;
        rects.push(worldBounds(doc, node));
    }
    const parent = parentId ? doc.nodes[parentId] : undefined;
    if (parent && parent.type !== "page") {
        const b = selectionBounds(doc, [parent.id]);
        if (b) rects.push(b);
    }
    // Ruler guides snap like edges: a guide is a zero-width rect spanning everything.
    const page = doc.nodes[editor.get().pageId];
    for (const g of page?.rulerGuides ?? []) rects.push(g.axis === "x" ? { x: g.at, y: -1e7, w: 0, h: 2e7 } : { x: -1e7, y: g.at, w: 2e7, h: 0 });
    return rects;
}

function xLines(r: Rect): Line[] {
    // A vertical guide is one line; a horizontal guide spans everything and gives no x lines.
    if (r.w === 0) return [{ value: r.x, from: r.y, to: r.y + r.h }];
    if (r.w >= 1e7) return [];
    return [r.x, r.x + r.w / 2, r.x + r.w].map((value) => ({ value, from: r.y, to: r.y + r.h }));
}

function yLines(r: Rect): Line[] {
    if (r.h === 0) return [{ value: r.y, from: r.x, to: r.x + r.w }];
    if (r.h >= 1e7) return [];
    return [r.y, r.y + r.h / 2, r.y + r.h].map((value) => ({ value, from: r.x, to: r.x + r.w }));
}

// Finds the smallest correction that lines up one of `mine` with one of `theirs`, within the threshold.
function bestOffset(mine: number[], theirs: Line[], threshold: number): number | null {
    let best: number | null = null;
    for (const m of mine) {
        for (const t of theirs) {
            const d = t.value - m;
            if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
        }
    }
    return best;
}

// Snaps a moving box (edges and centre) to target edges and centres, and returns the guides to draw.
export function snapRect(box: Rect, targets: Rect[], zoom: number, axes: { x: boolean; y: boolean } = { x: true, y: true }): SnapResult {
    const threshold = SNAP_PX / zoom;
    const tx = targets.flatMap(xLines);
    const ty = targets.flatMap(yLines);
    const dx = axes.x ? (bestOffset([box.x, box.x + box.w / 2, box.x + box.w], tx, threshold) ?? 0) : 0;
    const dy = axes.y ? (bestOffset([box.y, box.y + box.h / 2, box.y + box.h], ty, threshold) ?? 0) : 0;
    const snapped = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    return { dx, dy, guides: guidesFor(snapped, tx, ty, axes) };
}

// Snaps specific edges (for resizing): only the given x and y values move.
export function snapEdges(xs: number[], ys: number[], targets: Rect[], zoom: number): { dx: number; dy: number } {
    const threshold = SNAP_PX / zoom;
    const dx = xs.length ? (bestOffset(xs, targets.flatMap(xLines), threshold) ?? 0) : 0;
    const dy = ys.length ? (bestOffset(ys, targets.flatMap(yLines), threshold) ?? 0) : 0;
    return { dx, dy };
}

export function guidesFor(box: Rect, tx: Line[], ty: Line[], axes: { x: boolean; y: boolean } = { x: true, y: true }): Guide[] {
    const guides: Guide[] = [];
    const eps = 0.01;
    if (axes.x) {
        for (const v of [box.x, box.x + box.w / 2, box.x + box.w]) {
            const hits = tx.filter((t) => Math.abs(t.value - v) < eps);
            if (!hits.length) continue;
            const from = Math.min(box.y, ...hits.map((h) => h.from));
            const to = Math.max(box.y + box.h, ...hits.map((h) => h.to));
            guides.push({ x1: v, y1: from, x2: v, y2: to });
        }
    }
    if (axes.y) {
        for (const v of [box.y, box.y + box.h / 2, box.y + box.h]) {
            const hits = ty.filter((t) => Math.abs(t.value - v) < eps);
            if (!hits.length) continue;
            const from = Math.min(box.x, ...hits.map((h) => h.from));
            const to = Math.max(box.x + box.w, ...hits.map((h) => h.to));
            guides.push({ x1: from, y1: v, x2: to, y2: v });
        }
    }
    return guides;
}

export function guidesForBox(box: Rect, targets: Rect[]): Guide[] {
    return guidesFor(box, targets.flatMap(xLines), targets.flatMap(yLines));
}

// A labelled distance between the selection and another layer, as shown while holding ⌥.
export interface Measure {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    value: number;
}

export function measureBetween(sel: Rect, other: Rect): Measure[] {
    const out: Measure[] = [];
    const contains = other.x <= sel.x && other.y <= sel.y && other.x + other.w >= sel.x + sel.w && other.y + other.h >= sel.y + sel.h;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    if (contains) {
        // Inside a frame: distance from each side of the selection to the frame's sides.
        out.push({ x1: other.x, y1: cy, x2: sel.x, y2: cy, value: sel.x - other.x });
        out.push({ x1: sel.x + sel.w, y1: cy, x2: other.x + other.w, y2: cy, value: other.x + other.w - (sel.x + sel.w) });
        out.push({ x1: cx, y1: other.y, x2: cx, y2: sel.y, value: sel.y - other.y });
        out.push({ x1: cx, y1: sel.y + sel.h, x2: cx, y2: other.y + other.h, value: other.y + other.h - (sel.y + sel.h) });
        return out.filter((m) => m.value > 0);
    }
    const overlapY = Math.max(sel.y, other.y) < Math.min(sel.y + sel.h, other.y + other.h);
    const overlapX = Math.max(sel.x, other.x) < Math.min(sel.x + sel.w, other.x + other.w);
    const midY = overlapY ? (Math.max(sel.y, other.y) + Math.min(sel.y + sel.h, other.y + other.h)) / 2 : cy;
    const midX = overlapX ? (Math.max(sel.x, other.x) + Math.min(sel.x + sel.w, other.x + other.w)) / 2 : cx;
    if (other.x >= sel.x + sel.w) out.push({ x1: sel.x + sel.w, y1: midY, x2: other.x, y2: midY, value: other.x - (sel.x + sel.w) });
    else if (other.x + other.w <= sel.x) out.push({ x1: other.x + other.w, y1: midY, x2: sel.x, y2: midY, value: sel.x - (other.x + other.w) });
    if (other.y >= sel.y + sel.h) out.push({ x1: midX, y1: sel.y + sel.h, x2: midX, y2: other.y, value: other.y - (sel.y + sel.h) });
    else if (other.y + other.h <= sel.y) out.push({ x1: midX, y1: other.y + other.h, x2: midX, y2: sel.y, value: sel.y - (other.y + other.h) });
    return out;
}

// Neighbours of a box: the nearest target on each side that overlaps it on the other axis.
function neighbours(box: Rect, targets: Rect[]) {
    let left: Rect | null = null;
    let right: Rect | null = null;
    let above: Rect | null = null;
    let below: Rect | null = null;
    for (const t of targets) {
        // Skip anything that contains the box (its frame) or overlaps it.
        if (t.x <= box.x && t.y <= box.y && t.x + t.w >= box.x + box.w && t.y + t.h >= box.y + box.h) continue;
        const overlapY = Math.max(box.y, t.y) < Math.min(box.y + box.h, t.y + t.h);
        const overlapX = Math.max(box.x, t.x) < Math.min(box.x + box.w, t.x + t.w);
        if (overlapY) {
            if (t.x + t.w <= box.x && (!left || t.x + t.w > left.x + left.w)) left = t;
            if (t.x >= box.x + box.w && (!right || t.x < right.x)) right = t;
        }
        if (overlapX) {
            if (t.y + t.h <= box.y && (!above || t.y + t.h > above.y + above.h)) above = t;
            if (t.y >= box.y + box.h && (!below || t.y < below.y)) below = t;
        }
    }
    return { left, right, above, below };
}

// Snaps so the gaps to the neighbours on both sides match (the "equal spacing" snap), per axis.
export function snapEqualSpacing(box: Rect, targets: Rect[], zoom: number, axes: { x: boolean; y: boolean }): { dx: number; dy: number } {
    const threshold = SNAP_PX / zoom;
    const n = neighbours(box, targets);
    let dx = 0;
    let dy = 0;
    if (axes.x && n.left && n.right) {
        const gapL = box.x - (n.left.x + n.left.w);
        const gapR = n.right.x - (box.x + box.w);
        const d = (gapR - gapL) / 2;
        if (Math.abs(d) <= threshold) dx = d;
    }
    if (axes.y && n.above && n.below) {
        const gapA = box.y - (n.above.y + n.above.h);
        const gapB = n.below.y - (box.y + box.h);
        const d = (gapB - gapA) / 2;
        if (Math.abs(d) <= threshold) dy = d;
    }
    return { dx, dy };
}

// Distance labels to the neighbours while dragging, like the red measurements in other design tools.
export function dragMeasures(box: Rect, targets: Rect[]): Measure[] {
    const n = neighbours(box, targets);
    const out: Measure[] = [];
    const cy = box.y + box.h / 2;
    const cx = box.x + box.w / 2;
    if (n.left) out.push({ x1: n.left.x + n.left.w, y1: cy, x2: box.x, y2: cy, value: box.x - (n.left.x + n.left.w) });
    if (n.right) out.push({ x1: box.x + box.w, y1: cy, x2: n.right.x, y2: cy, value: n.right.x - (box.x + box.w) });
    if (n.above) out.push({ x1: cx, y1: n.above.y + n.above.h, x2: cx, y2: box.y, value: box.y - (n.above.y + n.above.h) });
    if (n.below) out.push({ x1: cx, y1: box.y + box.h, x2: cx, y2: n.below.y, value: n.below.y - (box.y + box.h) });
    return out.filter((m) => m.value > 0.5 && m.value < 400);
}

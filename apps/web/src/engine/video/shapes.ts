import { nanoid } from "nanoid";
import { type ShapeItemKind, type VClip, type VComp, type VShapeItem, shapeItems, shapeName, shapePropAt } from "./model";

// Shape items as geometry: each item becomes closed or open polylines in pixels from the
// layer's centre (curves are sampled), so Trim Paths can cut them by length and the same
// code draws rectangles, ellipses, stars, polygons and free paths.

export interface Point {
    x: number;
    y: number;
}

export interface Polyline {
    points: Point[];
    closed: boolean;
}

// What an item looks like at a moment: its outlines and the paint to use.
export interface ShapeOutline {
    item: VShapeItem;
    lines: Polyline[];
    strokeWidth: number;
    dashOffset: number;
    opacity: number;
}

const ARC_STEPS = 24;

function rotate(points: Point[], deg: number, cx: number, cy: number): Point[] {
    if (!deg) return points.map((p) => ({ x: p.x + cx, y: p.y + cy }));
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return points.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

// A rounded rectangle centred on the origin (sampled corners), clockwise from the top edge.
function rectPoints(w: number, h: number, radius: number): Point[] {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    const hw = w / 2;
    const hh = h / 2;
    if (r <= 0) return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
    const out: Point[] = [];
    const corners: [number, number, number][] = [
        [hw - r, -hh + r, -Math.PI / 2],
        [hw - r, hh - r, 0],
        [-hw + r, hh - r, Math.PI / 2],
        [-hw + r, -hh + r, Math.PI],
    ];
    for (const [cx, cy, from] of corners) {
        for (let i = 0; i <= ARC_STEPS; i++) {
            const a = from + (i / ARC_STEPS) * (Math.PI / 2);
            out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
    }
    return out;
}

function ellipsePoints(w: number, h: number): Point[] {
    const n = 96;
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        out.push({ x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * h) / 2 });
    }
    return out;
}

function starPoints(w: number, h: number, sides: number, inner: number, star: boolean): Point[] {
    const n = Math.max(3, Math.round(sides));
    const count = star ? n * 2 : n;
    const out: Point[] = [];
    for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
        const k = star && i % 2 ? Math.max(0, Math.min(1, inner / 100)) : 1;
        out.push({ x: (Math.cos(a) * w * k) / 2, y: (Math.sin(a) * h * k) / 2 });
    }
    return out;
}

// An item's outline before trimming.
export function itemOutline(comp: Pick<VComp, "width" | "height">, clip: VClip, item: VShapeItem, lt: number): ShapeOutline {
    const p = (key: Parameters<typeof shapePropAt>[3]) => shapePropAt(comp, clip, item, key, lt);
    const x = p("x");
    const y = p("y");
    const w = Math.max(0, p("w"));
    const h = Math.max(0, p("h"));
    const rot = p("rotation");
    let points: Point[];
    let closed = true;
    switch (item.kind) {
        case "rect":
            points = rectPoints(w, h, p("radius"));
            break;
        case "ellipse":
            points = ellipsePoints(w, h);
            break;
        case "polygon":
            points = starPoints(w, h, p("sides"), 100, false);
            break;
        case "star":
            points = starPoints(w, h, p("sides"), p("inner"), true);
            break;
        default:
            points = item.points ?? [];
            closed = item.closed !== false;
            break;
    }
    const lines: Polyline[] = points.length ? [{ points: rotate(points, rot, x, y), closed }] : [];
    const trimmed = item.trim ? trimLines(lines, p("trimStart") / 100, p("trimEnd") / 100, p("trimOffset") / 360) : lines;
    return { item, lines: trimmed, strokeWidth: Math.max(0, p("strokeWidth")), dashOffset: p("dashOffset"), opacity: Math.max(0, Math.min(1, p("opacity") / 100)) };
}

// Every item of a shape clip at `lt`, in drawing order.
export function shapeOutlines(comp: Pick<VComp, "width" | "height">, clip: VClip, lt: number): ShapeOutline[] {
    return shapeItems(clip).map((item) => itemOutline(comp, clip, item, lt));
}

// ---- Trim Paths ----

function segments(line: Polyline): Point[] {
    return line.closed && line.points.length > 1 ? [...line.points, line.points[0] as Point] : line.points;
}

export function lineLength(line: Polyline): number {
    const pts = segments(line);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i] as Point).x - (pts[i - 1] as Point).x, (pts[i] as Point).y - (pts[i - 1] as Point).y);
    return len;
}

// The part of a polyline between `a` and `b` as distances along it (a < b, both within its length).
function slice(line: Polyline, a: number, b: number): Polyline | null {
    const pts = segments(line);
    const out: Point[] = [];
    let at = 0;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1] as Point;
        const q = pts[i] as Point;
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        const s0 = at;
        const s1 = at + len;
        at = s1;
        if (s1 < a || s0 > b || len === 0) continue;
        const ta = Math.max(0, (a - s0) / len);
        const tb = Math.min(1, (b - s0) / len);
        const from = { x: p.x + (q.x - p.x) * ta, y: p.y + (q.y - p.y) * ta };
        const to = { x: p.x + (q.x - p.x) * tb, y: p.y + (q.y - p.y) * tb };
        if (!out.length) out.push(from);
        out.push(to);
    }
    return out.length > 1 ? { points: out, closed: false } : null;
}

// Trim Paths: keeps the part of each line from `start` to `end` (fractions of its length),
// shifted along it by `offset` (fraction of a turn). A closed line wraps around; the whole
// line, untouched, stays closed.
export function trimLines(lines: Polyline[], start: number, end: number, offset: number): Polyline[] {
    const lo = Math.max(0, Math.min(1, Math.min(start, end)));
    const hi = Math.max(0, Math.min(1, Math.max(start, end)));
    const out: Polyline[] = [];
    for (const line of lines) {
        const len = lineLength(line);
        if (len <= 0) continue;
        if (hi - lo >= 1 - 1e-9) {
            out.push(line);
            continue;
        }
        if (hi - lo <= 1e-9) continue;
        if (line.closed) {
            // Wrap the window around the loop.
            const a = (((lo + offset) % 1) + 1) % 1;
            const span = hi - lo;
            const b = a + span;
            if (b <= 1) {
                const s = slice(line, a * len, b * len);
                if (s) out.push(s);
            } else {
                const first = slice(line, a * len, len);
                const second = slice(line, 0, (b - 1) * len);
                if (first && second) out.push({ points: [...first.points, ...second.points.slice(1)], closed: false });
                else if (first) out.push(first);
                else if (second) out.push(second);
            }
        } else {
            const a = Math.max(0, Math.min(1, lo + offset));
            const b = Math.max(0, Math.min(1, hi + offset));
            if (b - a <= 1e-9) continue;
            const s = slice(line, a * len, b * len);
            if (s) out.push(s);
        }
    }
    return out;
}

// ---- Making items ----

export function newShapeItem(kind: ShapeItemKind, comp: Pick<VComp, "width" | "height">): VShapeItem {
    const item: VShapeItem = { id: nanoid(6), kind, name: shapeName(kind), fill: "#4F7BFF", stroke: null, cap: "round", join: "round", dash: [] };
    if (kind === "path") {
        const s = Math.round(comp.height * 0.3);
        item.points = [{ x: -s, y: s / 2 }, { x: -s / 3, y: -s / 2 }, { x: s / 3, y: s / 2 }, { x: s, y: -s / 2 }];
        item.closed = false;
        item.fill = null;
        item.stroke = "#FFFFFF";
    }
    return item;
}

// The props a new item starts with (its stroke width when it has a stroke).
export function newShapeItemProps(item: VShapeItem, comp: Pick<VComp, "width" | "height">): Record<string, number> {
    const out: Record<string, number> = {};
    if (item.stroke) out[`shape.${item.id}.strokeWidth`] = Math.max(2, Math.round(comp.height / 180));
    if (item.kind === "rect") out[`shape.${item.id}.radius`] = Math.round(comp.height * 0.35 * 0.08);
    return out;
}

// A clip from before shape items, rewritten with its primitive as the first item (so edits
// go through one path). Other clips come back as they are.
export function withShapeItems(clip: VClip): VClip {
    if (clip.shapes || !clip.shape) return clip;
    const [legacy] = shapeItems(clip);
    if (!legacy) return clip;
    const id = nanoid(6);
    const item: VShapeItem = { ...legacy, id };
    const s = clip.shape;
    const props = { ...clip.props, [`shape.${id}.w`]: s.w, [`shape.${id}.h`]: s.h, [`shape.${id}.radius`]: s.radius, [`shape.${id}.sides`]: s.sides, [`shape.${id}.strokeWidth`]: s.strokeWidth };
    const { shape: _shape, ...rest } = clip;
    return { ...rest, props, shapes: [item] };
}

// The bounding box of outlines (for fitting a shape layer's picture), in pixels from the centre.
export function outlineBounds(outlines: ShapeOutline[]): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of outlines) {
        const pad = o.strokeWidth / 2;
        for (const line of o.lines)
            for (const p of line.points) {
                minX = Math.min(minX, p.x - pad);
                minY = Math.min(minY, p.y - pad);
                maxX = Math.max(maxX, p.x + pad);
                maxY = Math.max(maxY, p.y + pad);
            }
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

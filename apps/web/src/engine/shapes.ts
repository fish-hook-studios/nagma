import { makeNode, nextLabelName } from "./nodes";
import { solid } from "./paint";
import { parametricPath } from "./vector";
import { brushById, brushPatch } from "./brushes";
import { vectorUi } from "./vector-ui";
import { editor } from "./store";
import type { NagmaDocument, PathPoint, Rect, SceneNode, Subpath, Tool, VectorPath } from "./types";

// The shape tools beyond rectangles and ellipses draw vectors: lines, arrows, polygons and stars,
// and the freehand pencil and brush.

export type ShapeKind = "line" | "arrow" | "polygon" | "star";

export function isShapeTool(tool: Tool): tool is ShapeKind {
    return tool === "line" || tool === "arrow" || tool === "polygon" || tool === "star";
}

const pt = (x: number, y: number): PathPoint => ({ x, y, in: null, out: null });

// A regular polygon (3 sides, like the reference's default) or a 5-point star inside a box.
export function polygonPath(w: number, h: number, sides = 3): VectorPath {
    const points: PathPoint[] = [];
    for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
        points.push(pt(w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)));
    }
    return { w, h, subpaths: [{ points, closed: true }] };
}

export function starPath(w: number, h: number, count = 5, inner = 0.382): VectorPath {
    const points: PathPoint[] = [];
    for (let i = 0; i < count * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / count;
        const r = i % 2 === 0 ? 1 : inner;
        points.push(pt(w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)));
    }
    return { w, h, subpaths: [{ points, closed: true }] };
}

// A line from `a` to `b` in parent space, as a vector whose box is the line's bounds. Arrows get a
// head at `b`. Returns the box and the path inside it.
export function linePath(a: { x: number; y: number }, b: { x: number; y: number }, arrow: boolean, headSize = 12): { box: Rect; path: VectorPath } {
    const subpaths: Subpath[] = [{ points: [pt(a.x, a.y), pt(b.x, b.y)], closed: false }];
    if (arrow) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const wing = (side: number) => pt(b.x - headSize * Math.cos(angle - side * 0.5), b.y - headSize * Math.sin(angle - side * 0.5));
        subpaths.push({ points: [wing(1), pt(b.x, b.y), wing(-1)], closed: false });
    }
    const xs = subpaths.flatMap((s) => s.points.map((p) => p.x));
    const ys = subpaths.flatMap((s) => s.points.map((p) => p.y));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x);
    const h = Math.max(1, Math.max(...ys) - y);
    const local = subpaths.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x - x, y: p.y - y })) }));
    return { box: { x, y, w, h }, path: { w, h, subpaths: local } };
}

// A shape-tool layer for a drag box (or line end points), in the parent's space.
export function makeShape(doc: NagmaDocument, kind: ShapeKind, a: { x: number; y: number }, b: { x: number; y: number }, parentId: string | null, id?: string): SceneNode {
    if (kind === "line" || kind === "arrow") {
        const { box, path } = linePath(a, b, kind === "arrow");
        return makeNode(doc, "vector", box, parentId, { ...(id ? { id } : {}), name: nextLabelName(doc, kind === "arrow" ? "Arrow" : "Line", parentId), path, fills: [], strokes: [solid("#000000")], strokeWidth: 1, strokeAlign: "center" });
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.max(1, Math.abs(b.x - a.x));
    const h = Math.max(1, Math.abs(b.y - a.y));
    // Polygons and stars stay parametric (count, ratio, corner radius) until their points are edited.
    const parametric = { kind, count: kind === "polygon" ? 3 : 5, ratio: 0.382 } as const;
    const base = makeNode(doc, "vector", { x, y, w, h }, parentId, { ...(id ? { id } : {}), name: nextLabelName(doc, kind === "polygon" ? "Polygon" : "Star", parentId), fills: [solid("#D9D9D9")], strokes: [], parametric: { ...parametric } });
    return { ...base, path: parametricPath(base) };
}

// Ramer–Douglas–Peucker: drops points that stay within `tolerance` of the line between their neighbours.
export function simplify(points: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
    if (points.length < 3) return points;
    const first = points[0];
    const last = points[points.length - 1];
    let index = -1;
    let max = 0;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const d = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / len;
        if (d > max) {
            max = d;
            index = i;
        }
    }
    if (max <= tolerance) return [first, last];
    return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

// A freehand stroke as a smooth vector (Catmull-Rom handles through the simplified samples), in
// parent space. The pencil draws a 3 px round line; the brush uses the brush picked in Draw mode's
// strip (engine/brushes.ts).
export interface DrawSettings {
    color: string;
    size: number;
    style: "pencil" | "marker" | "ink";
}

// Light smoothing of the raw pointer samples (keeps the ends), so simplification follows the
// hand's intent rather than its jitter.
function smoothSamples(samples: { x: number; y: number }[]): { x: number; y: number }[] {
    if (samples.length < 4) return samples;
    let pts = samples;
    for (let pass = 0; pass < 2; pass++) {
        pts = pts.map((p, i) => {
            if (i === 0 || i === pts.length - 1) return p;
            const a = pts[i - 1] as { x: number; y: number };
            const b = pts[i + 1] as { x: number; y: number };
            return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
        });
    }
    return pts;
}

// Ink: the nib presses harder where the hand moves slowly and thins where it moves fast, with
// both ends tapered. Width points along the stroke (t by length, w as a multiple of the weight)
// come from the spacing of the raw pointer samples, which arrive at a steady rate.
function inkWidthPoints(samples: { x: number; y: number }[], zoom: number): { t: number; w: number }[] | null {
    if (samples.length < 3) return null;
    const steps: number[] = [];
    let total = 0;
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1] as { x: number; y: number };
        const b = samples[i] as { x: number; y: number };
        const d = Math.hypot(b.x - a.x, b.y - a.y) * zoom;
        steps.push(d);
        total += d;
    }
    if (total <= 0) return null;
    // Speed relative to a comfortable stroke: slow strokes thicken, quick flicks thin out.
    const typical = Math.max(2, total / steps.length);
    const count = Math.min(24, Math.max(6, Math.round(steps.length / 3)));
    const points: { t: number; w: number }[] = [];
    let run = 0;
    for (let k = 0; k <= count; k++) {
        const t = k / count;
        const target = t * total;
        let i = 0;
        let smoothed = 0;
        let n = 0;
        run = 0;
        // Average the sample speeds around this point of the stroke.
        for (; i < steps.length; i++) {
            run += steps[i] as number;
            if (run >= target) break;
        }
        for (let j = Math.max(0, i - 2); j <= Math.min(steps.length - 1, i + 2); j++) {
            smoothed += steps[j] as number;
            n++;
        }
        const speed = n ? smoothed / n / typical : 1;
        const body = Math.min(1.5, Math.max(0.3, 1.45 - speed * 0.6));
        // Taper the first and last tenth of the stroke to a point.
        const edge = Math.min(t, 1 - t) / 0.12;
        const taper = edge < 1 ? 0.1 + 0.9 * edge * edge : 1;
        points.push({ t, w: Math.round(body * taper * 100) / 100 });
    }
    return points;
}

export function makeFreehand(doc: NagmaDocument, samples: { x: number; y: number }[], parentId: string | null, zoom: number, brush: boolean, id?: string, drawing?: DrawSettings): SceneNode | null {
    // The strip's colour and size apply in Draw mode; in Design mode the pencil is the reference's 3 px black line.
    const draw = editor.get().mode === "draw" ? drawing : undefined;
    const points = simplify(smoothSamples(samples), 1.2 / Math.max(zoom, 0.01));
    if (points.length < 2) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x);
    const h = Math.max(1, Math.max(...ys) - y);
    const local = points.map((p) => ({ x: p.x - x, y: p.y - y }));
    // A straight line (⇧) stays two sharp points.
    const straight = local.length === 2;
    const anchors: PathPoint[] = local.map((p, i) => {
        if (straight) return { x: p.x, y: p.y, in: null, out: null };
        const prev = local[i - 1] ?? p;
        const next = local[i + 1] ?? p;
        const tx = (next.x - prev.x) / 6;
        const ty = (next.y - prev.y) / 6;
        return { x: p.x, y: p.y, in: i === 0 ? null : { x: p.x - tx, y: p.y - ty }, out: i === local.length - 1 ? null : { x: p.x + tx, y: p.y + ty } };
    });
    const path: VectorPath = { w, h, subpaths: [{ points: anchors, closed: false }] };
    const box = { x, y, w, h };
    if (brush) {
        const b = brushById(vectorUi.get().brush, doc);
        return {
            ...makeNode(doc, "vector", box, parentId, {
                ...(id ? { id } : {}),
                name: "Brush",
                path,
                fills: [],
                strokes: [solid(draw?.color ?? "#000000", b.opacity)],
                strokeAlign: "center",
                ...brushPatch(b, draw ? draw.size * 2 : 6),
            }),
            ...box,
        };
    }
    const ink = draw?.style === "ink" && !straight ? inkWidthPoints(samples, zoom) : null;
    return {
        ...makeNode(doc, "vector", box, parentId, {
            ...(id ? { id } : {}),
            name: draw?.style === "ink" ? "Ink" : "Pencil",
            path,
            fills: [],
            // Draw mode's strip picks the colour, size and style; elsewhere the pencil is 3 px and round.
            strokes: [solid(draw?.color ?? "#000000", draw?.style === "marker" ? 0.75 : 1)],
            strokeWidth: draw ? draw.size : 3,
            strokeAlign: "center",
            strokeCap: draw?.style === "marker" ? "square" : "round",
            strokeJoin: "round",
            // Ink varies its width with the speed of the hand.
            ...(ink ? { widthPoints: ink } : {}),
        }),
        ...box,
    };
}

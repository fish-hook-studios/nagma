import type { BooleanOp, PathPoint, Rect, SceneNode, Subpath, VectorPath } from "./types";

type Pt = { x: number; y: number };

// Bezier constant for approximating a quarter circle.
const K = 0.5522847498;

function cubicAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
    const u = 1 - t;
    return {
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
}

// Points along every segment, for bounds and hit tests (curves are sampled finely enough for both).
export function samplePath(subpaths: Subpath[], steps = 24): Pt[][] {
    return subpaths.map((sub) => {
        const out: Pt[] = [];
        const n = sub.points.length;
        const segments = sub.closed ? n : n - 1;
        for (let i = 0; i < segments; i++) {
            const a = sub.points[i];
            const b = sub.points[(i + 1) % n];
            if (!a || !b) continue;
            if (!a.out && !b.in) {
                out.push({ x: a.x, y: a.y });
                continue;
            }
            const c1 = a.out ?? a;
            const c2 = b.in ?? b;
            for (let s = 0; s < steps; s++) out.push(cubicAt(a, c1, c2, b, s / steps));
        }
        const last = sub.points[sub.closed ? 0 : n - 1];
        if (last) out.push({ x: last.x, y: last.y });
        return out;
    });
}

export function pathBounds(subpaths: Subpath[]): Rect | null {
    const pts = samplePath(subpaths).flat();
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function mapPoint(p: PathPoint, f: (q: Pt) => Pt): PathPoint {
    const q = f(p);
    return { x: q.x, y: q.y, in: p.in ? f(p.in) : null, out: p.out ? f(p.out) : null, ...(p.radius ? { radius: p.radius } : {}) };
}

// Points with their own corner radius become an arc between their two segments, as in
// roundedPolygon: cut back along each side (no more than half of it) and joined by a cubic.
// Points with handles, and the ends of an open path, stay sharp.
export function roundPointCorners(subpaths: Subpath[], fallback = 0): Subpath[] {
    if (!fallback && !subpaths.some((sub) => sub.points.some((p) => p.radius))) return subpaths;
    return subpaths.map((sub) => {
        const n = sub.points.length;
        if (n < 3 || (!fallback && !sub.points.some((p) => p.radius))) return sub;
        const points: PathPoint[] = [];
        sub.points.forEach((p, i) => {
            const radius = p.radius ?? fallback;
            const ends = !sub.closed && (i === 0 || i === n - 1);
            const prev = sub.points[(i - 1 + n) % n]!;
            const next = sub.points[(i + 1) % n]!;
            if (radius <= 0 || ends || p.in || p.out) {
                points.push({ x: p.x, y: p.y, in: p.in, out: p.out });
                return;
            }
            // Directions follow the neighbours' handles when the segments are curved.
            const from = prev.out ?? prev;
            const to = next.in ?? next;
            const l1 = Math.hypot(from.x - p.x, from.y - p.y);
            const l2 = Math.hypot(to.x - p.x, to.y - p.y);
            const s1 = Math.hypot(prev.x - p.x, prev.y - p.y);
            const s2 = Math.hypot(next.x - p.x, next.y - p.y);
            if (l1 < 1e-9 || l2 < 1e-9) {
                points.push({ x: p.x, y: p.y, in: null, out: null });
                return;
            }
            const u1 = { x: (from.x - p.x) / l1, y: (from.y - p.y) / l1 };
            const u2 = { x: (to.x - p.x) / l2, y: (to.y - p.y) / l2 };
            const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
            if (theta < 1e-6 || Math.PI - theta < 1e-6) {
                points.push({ x: p.x, y: p.y, in: null, out: null });
                return;
            }
            const cut = Math.min(radius / Math.tan(theta / 2), s1 / 2, s2 / 2);
            const r = cut * Math.tan(theta / 2);
            const k = (4 / 3) * Math.tan((Math.PI - theta) / 4) * r;
            const a = { x: p.x + u1.x * cut, y: p.y + u1.y * cut };
            const b = { x: p.x + u2.x * cut, y: p.y + u2.y * cut };
            points.push({ x: a.x, y: a.y, in: null, out: { x: a.x - u1.x * k, y: a.y - u1.y * k } });
            points.push({ x: b.x, y: b.y, in: { x: b.x - u2.x * k, y: b.y - u2.y * k }, out: null });
        });
        return { closed: sub.closed, points };
    });
}

export function mapSubpaths(subpaths: Subpath[], f: (q: Pt) => Pt): Subpath[] {
    return subpaths.map((sub) => ({ closed: sub.closed, points: sub.points.map((p) => mapPoint(p, f)) }));
}

// Rounds the corners of a closed polygon by `radius`, each corner an arc (as a cubic) tangent to
// both edges, cut back no further than half of each edge.
export function roundedPolygon(pts: { x: number; y: number }[], radius: number): Subpath {
    const n = pts.length;
    if (radius <= 0 || n < 3) return { closed: true, points: pts.map((p) => ({ x: p.x, y: p.y, in: null, out: null })) };
    const points: PathPoint[] = [];
    for (let i = 0; i < n; i++) {
        const p = pts[i] as { x: number; y: number };
        const prev = pts[(i - 1 + n) % n] as { x: number; y: number };
        const next = pts[(i + 1) % n] as { x: number; y: number };
        const l1 = Math.hypot(prev.x - p.x, prev.y - p.y);
        const l2 = Math.hypot(next.x - p.x, next.y - p.y);
        if (l1 < 1e-9 || l2 < 1e-9) continue;
        const u1 = { x: (prev.x - p.x) / l1, y: (prev.y - p.y) / l1 };
        const u2 = { x: (next.x - p.x) / l2, y: (next.y - p.y) / l2 };
        const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
        const theta = Math.acos(cos);
        if (theta < 1e-6 || Math.PI - theta < 1e-6) {
            points.push({ x: p.x, y: p.y, in: null, out: null });
            continue;
        }
        // Distance from the corner to where the arc touches each edge, clamped to half the edges.
        let cut = radius / Math.tan(theta / 2);
        cut = Math.min(cut, l1 / 2, l2 / 2);
        const r = cut * Math.tan(theta / 2);
        const turn = Math.PI - theta;
        const k = (4 / 3) * Math.tan(turn / 4) * r;
        const a = { x: p.x + u1.x * cut, y: p.y + u1.y * cut };
        const b = { x: p.x + u2.x * cut, y: p.y + u2.y * cut };
        points.push({ x: a.x, y: a.y, in: null, out: { x: a.x - u1.x * k, y: a.y - u1.y * k } });
        points.push({ x: b.x, y: b.y, in: { x: b.x - u2.x * k, y: b.y - u2.y * k }, out: null });
    }
    return { closed: true, points };
}

// The corner points of a polygon or star, like the reference: the outer points sit on the ellipse
// inscribed in the box, so a triangle's box reaches below its base and a star's below its lower points.
export function parametricPoints(kind: "polygon" | "star", count: number, ratio: number, x: number, y: number, w: number, h: number): { x: number; y: number }[] {
    const n = Math.max(3, Math.min(60, Math.round(count)));
    const steps = kind === "star" ? n * 2 : n;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < steps; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
        const r = kind === "polygon" || i % 2 === 0 ? 1 : Math.max(0.001, Math.min(1, ratio));
        out.push({ x: x + ((Math.cos(a) * r + 1) / 2) * w, y: y + ((Math.sin(a) * r + 1) / 2) * h });
    }
    return out;
}

export function parametricSubpaths(node: SceneNode): Subpath[] {
    const p = node.parametric;
    if (!p) return [];
    return [roundedPolygon(parametricPoints(p.kind, p.count, p.ratio, node.x, node.y, node.w, node.h), Math.max(0, node.radius))];
}

// The stored path of a parametric shape (kept in step so anything reading `path` sees the shape).
export function parametricPath(node: SceneNode): VectorPath {
    const subpaths = parametricSubpaths({ ...node, x: 0, y: 0 });
    return { w: node.w, h: node.h, subpaths };
}

// A layer's path in its parent's space (where its x, y, w and h live), scaled to its current size.
export function placedSubpaths(node: SceneNode): Subpath[] {
    if (node.parametric) return parametricSubpaths(node);
    const path = node.path;
    if (!path) return [];
    const sx = path.w > 0 ? node.w / path.w : 1;
    const sy = path.h > 0 ? node.h / path.h : 1;
    return mapSubpaths(path.subpaths, (q) => ({ x: node.x + q.x * sx, y: node.y + q.y * sy }));
}

// Turns subpaths placed in parent space into a layer box plus a path relative to it.
export function fitPath(subpaths: Subpath[]): { x: number; y: number; w: number; h: number; path: VectorPath } {
    const b = pathBounds(subpaths) ?? { x: 0, y: 0, w: 0, h: 0 };
    const w = Math.max(b.w, 0.01);
    const h = Math.max(b.h, 0.01);
    return { x: b.x, y: b.y, w, h, path: { w, h, subpaths: mapSubpaths(subpaths, (q) => ({ x: q.x - b.x, y: q.y - b.y })) } };
}

export function tracePath(ctx: CanvasRenderingContext2D | Path2D, subpaths: Subpath[]) {
    for (const sub of subpaths) {
        const first = sub.points[0];
        if (!first) continue;
        ctx.moveTo(first.x, first.y);
        const n = sub.points.length;
        const segments = sub.closed ? n : n - 1;
        for (let i = 0; i < segments; i++) {
            const a = sub.points[i];
            const b = sub.points[(i + 1) % n];
            if (!a || !b) continue;
            if (!a.out && !b.in) ctx.lineTo(b.x, b.y);
            else ctx.bezierCurveTo((a.out ?? a).x, (a.out ?? a).y, (b.in ?? b).x, (b.in ?? b).y, b.x, b.y);
        }
        if (sub.closed) ctx.closePath();
    }
}

// The corner radii of a rectangle or frame, clamped to what fits.
export function cornerRadii(node: SceneNode): [number, number, number, number] {
    const max = Math.max(0, Math.min(node.w, node.h) / 2);
    const r = node.radii ?? [node.radius, node.radius, node.radius, node.radius];
    return r.map((v) => Math.max(0, Math.min(v, max))) as [number, number, number, number];
}

// A rounded rectangle as a closed subpath. Smoothing (0 to 1) stretches each corner's curve past
// the radius and eases it in, the way "squircle" corners look.
export function rectSubpaths(x: number, y: number, w: number, h: number, radii: [number, number, number, number], smoothing = 0): Subpath[] {
    const [tl, tr, br, bl] = radii;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
        const corner = (px: number, py: number): PathPoint => ({ x: px, y: py, in: null, out: null });
        return [{ closed: true, points: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] }];
    }
    const sm = Math.max(0, Math.min(1, smoothing));
    const points: PathPoint[] = [];
    // Each corner: the curve starts `ext` before the corner along the edge and ends `ext` after,
    // with handles of `k` towards the corner. With no smoothing this is the usual circular arc.
    const corner = (cx: number, cy: number, r: number, dx1: number, dy1: number, dx2: number, dy2: number) => {
        if (r <= 0) {
            points.push({ x: cx, y: cy, in: null, out: null });
            return;
        }
        const ext = r * (1 + sm * 0.6);
        const k = r * (K + sm * (1 - K) * 0.9);
        // Approach along (dx1,dy1) into the corner, leave along (dx2,dy2).
        const a = { x: cx - dx1 * ext, y: cy - dy1 * ext };
        const b = { x: cx + dx2 * ext, y: cy + dy2 * ext };
        points.push({ x: a.x, y: a.y, in: null, out: { x: a.x + dx1 * (ext - r + k), y: a.y + dy1 * (ext - r + k) } });
        points.push({ x: b.x, y: b.y, in: { x: b.x - dx2 * (ext - r + k), y: b.y - dy2 * (ext - r + k) }, out: null });
    };
    corner(x, y, tl, 0, -1, 1, 0);
    corner(x + w, y, tr, 1, 0, 0, 1);
    corner(x + w, y + h, br, 0, 1, -1, 0);
    corner(x, y + h, bl, -1, 0, 0, -1);
    // Consecutive points of the same corner share the curve; straight edges between corners.
    return [{ closed: true, points }];
}

// An ellipse, or an arc or ring of it, as closed subpaths (sampled cubic segments).
export function ellipseSubpaths(x: number, y: number, w: number, h: number, arc: { start: number; sweep: number; inner: number } | null): Subpath[] {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    const full = !arc || Math.abs(arc.sweep) >= 360;
    const inner = arc ? Math.max(0, Math.min(0.999, arc.inner)) : 0;
    const pt = (px: number, py: number, ix: number, iy: number, ox: number, oy: number): PathPoint => ({ x: px, y: py, in: { x: px + ix, y: py + iy }, out: { x: px + ox, y: py + oy } });
    const ring = (sx: number, sy: number, reverse: boolean): PathPoint[] => {
        const pts = [
            pt(cx, cy - sy, -sx * K, 0, sx * K, 0),
            pt(cx + sx, cy, 0, -sy * K, 0, sy * K),
            pt(cx, cy + sy, sx * K, 0, -sx * K, 0),
            pt(cx - sx, cy, 0, sy * K, 0, -sy * K),
        ];
        return reverse ? pts.reverse().map((p) => ({ x: p.x, y: p.y, in: p.out, out: p.in })) : pts;
    };
    if (full) {
        const outer: Subpath = { closed: true, points: ring(rx, ry, false) };
        if (inner <= 0) return [outer];
        return [outer, { closed: true, points: ring(rx * inner, ry * inner, true) }];
    }
    // A pie or ring segment: sample the outer arc, then the inner arc back (or the centre).
    const a0 = (arc.start * Math.PI) / 180;
    const a1 = a0 + (arc.sweep * Math.PI) / 180;
    const steps = Math.max(2, Math.ceil(Math.abs(arc.sweep) / 10));
    const at = (angle: number, scale: number): PathPoint => ({ x: cx + Math.cos(angle) * rx * scale, y: cy + Math.sin(angle) * ry * scale, in: null, out: null });
    const points: PathPoint[] = [];
    for (let i = 0; i <= steps; i++) points.push(at(a0 + ((a1 - a0) * i) / steps, 1));
    if (inner > 0) for (let i = steps; i >= 0; i--) points.push(at(a0 + ((a1 - a0) * i) / steps, inner));
    else points.push({ x: cx, y: cy, in: null, out: null });
    return [{ closed: true, points }];
}

// The outline of a basic shape as a path in parent space (for drawing, flattening and booleans).
export function shapeSubpaths(node: SceneNode): Subpath[] {
    // The layer's own corner radius rounds every sharp point of a vector, and the corners of an arc.
    if (node.type === "vector") return roundPointCorners(placedSubpaths(node), Math.max(0, node.radius || 0));
    const { x, y, w, h } = node;
    if (node.type === "ellipse") return node.arc && node.radius > 0 ? roundPointCorners(ellipseSubpaths(x, y, w, h, node.arc), node.radius) : ellipseSubpaths(x, y, w, h, node.arc ?? null);
    return rectSubpaths(x, y, w, h, cornerRadii(node), node.cornerSmoothing ?? 0);
}

let probe: CanvasRenderingContext2D | null = null;

// Whether a point (in the same space as the subpaths) is inside the filled shape, or near an open stroke.
export function pathContains(subpaths: Subpath[], x: number, y: number, tolerance = 4): boolean {
    probe ??= document.createElement("canvas").getContext("2d");
    if (!probe) return false;
    const path = new Path2D();
    tracePath(path, subpaths);
    if (subpaths.some((s) => s.closed) && probe.isPointInPath(path, x, y, "nonzero")) return true;
    probe.lineWidth = tolerance * 2;
    return probe.isPointInStroke(path, x, y);
}

export function booleanContains(op: BooleanOp, hits: boolean[]): boolean {
    if (hits.length === 0) return false;
    if (op === "union") return hits.some(Boolean);
    if (op === "intersect") return hits.every(Boolean);
    if (op === "subtract") return Boolean(hits[0]) && !hits.slice(1).some(Boolean);
    return hits.filter(Boolean).length % 2 === 1;
}

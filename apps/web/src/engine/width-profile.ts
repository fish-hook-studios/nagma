import type { SceneNode } from "./types";
import { placedSubpaths, samplePath, shapeSubpaths } from "./vector";

// Variable width strokes. Width points sit along the whole outline (t from 0 to 1 by length) with a
// width as a multiple of the stroke weight; between points the width eases from one to the next,
// and the ends keep the stroke weight unless a point sits on them. Older files carry a three-stop profile
// (start, middle, end), read as three points.

export type WidthPoint = { t: number; w: number };
type Pt = { x: number; y: number };

export function widthPointsOf(node: SceneNode): WidthPoint[] | null {
    if (node.widthPoints && node.widthPoints.length) return [...node.widthPoints].sort((a, b) => a.t - b.t);
    const p = node.strokeProfile;
    if (p) return [{ t: 0, w: p[0] }, { t: 0.5, w: p[1] }, { t: 1, w: p[2] }];
    return null;
}

export function hasVariableWidth(node: SceneNode): boolean {
    return node.type === "vector" && widthPointsOf(node) !== null;
}

// The width multiplier at t. The ends keep the stroke's own weight unless a point sits there.
export function widthAt(given: WidthPoint[], t: number): number {
    const points = [...given];
    if (points.length && (points[0] as WidthPoint).t > 1e-6) points.unshift({ t: 0, w: 1 });
    if (points.length && (points[points.length - 1] as WidthPoint).t < 1 - 1e-6) points.push({ t: 1, w: 1 });
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return 1;
    if (t <= first.t) return first.w;
    if (t >= last.t) return last.w;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as WidthPoint;
        const b = points[i] as WidthPoint;
        if (t <= b.t) {
            const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
            const e = f * f * (3 - 2 * f);
            return a.w + (b.w - a.w) * e;
        }
    }
    return last.w;
}

// The outline sampled with each point's place along the whole length (0 to 1).
export interface Outline {
    lines: { pts: Pt[]; d: number[] }[];
    total: number;
}

export function outlineOf(node: SceneNode, steps = 16): Outline {
    const subpaths = node.type === "vector" ? placedSubpaths(node) : shapeSubpaths(node);
    const raw = samplePath(subpaths, steps);
    let offset = 0;
    const lines = raw.map((pts) => {
        const d = [offset];
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1] as Pt;
            const b = pts[i] as Pt;
            d.push((d[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
        }
        offset = d[d.length - 1] ?? offset;
        return { pts, d };
    });
    return { lines, total: offset || 1 };
}

// The point at t along the outline, with the unit normal there.
export function pointAt(outline: Outline, t: number): { p: Pt; n: Pt } | null {
    const target = Math.max(0, Math.min(1, t)) * outline.total;
    const lines = outline.lines.filter((l) => l.pts.length >= 2);
    for (let li = 0; li < lines.length; li++) {
        const { pts, d } = lines[li] as { pts: Pt[]; d: number[] };
        if (target > (d[d.length - 1] ?? 0) + 1e-9 && li < lines.length - 1) continue;
        for (let i = 1; i < pts.length; i++) {
            const d0 = d[i - 1] ?? 0;
            const d1 = d[i] ?? 0;
            if (target <= d1 + 1e-9 || i === pts.length - 1) {
                const a = pts[i - 1] as Pt;
                const b = pts[i] as Pt;
                const f = d1 > d0 ? Math.max(0, Math.min(1, (target - d0) / (d1 - d0))) : 0;
                const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, n: { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } };
            }
        }
    }
    return null;
}

// The nearest place on the outline to a point (both in the layer's parent space).
export function nearestOn(outline: Outline, q: Pt): { t: number; p: Pt; dist: number } | null {
    let best: { t: number; p: Pt; dist: number } | null = null;
    for (const { pts, d } of outline.lines) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1] as Pt;
            const b = pts[i] as Pt;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const l2 = dx * dx + dy * dy;
            const f = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
            const p = { x: a.x + dx * f, y: a.y + dy * f };
            const dist = Math.hypot(q.x - p.x, q.y - p.y);
            if (!best || dist < best.dist) {
                const d0 = d[i - 1] ?? 0;
                const d1 = d[i] ?? 0;
                best = { t: (d0 + (d1 - d0) * f) / outline.total, p, dist };
            }
        }
    }
    return best;
}

// The variable-width stroke as a filled outline (in the layer's parent space), for export.
export function ribbonSubpaths(node: SceneNode): import("./types").Subpath[] {
    const points = widthPointsOf(node);
    if (!points) return [];
    const outline = outlineOf(node);
    return outline.lines
        .filter((l) => l.pts.length > 1)
        .map(({ pts, d }) => {
            const left: Pt[] = [];
            const right: Pt[] = [];
            pts.forEach((p, i) => {
                const q = pts[Math.min(i + 1, pts.length - 1)] as Pt;
                const o = pts[Math.max(i - 1, 0)] as Pt;
                const len = Math.hypot(q.x - o.x, q.y - o.y) || 1;
                const nx = -(q.y - o.y) / len;
                const ny = (q.x - o.x) / len;
                const w = (node.strokeWidth * Math.max(0, widthAt(points, (d[i] ?? 0) / outline.total))) / 2;
                left.push({ x: p.x + nx * w, y: p.y + ny * w });
                right.push({ x: p.x - nx * w, y: p.y - ny * w });
            });
            return { closed: true, points: [...left, ...right.reverse()].map((p) => ({ x: p.x, y: p.y, in: null, out: null })) };
        });
}

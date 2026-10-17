import { booleanPaths, subCubic } from "./clip";
import { simplify } from "./shapes";
import type { NodePatch, PathPoint, SceneNode, Subpath } from "./types";
import { fitPath, pathBounds, placedSubpaths } from "./vector";

// The vector eraser: the brush's stroke (round, or a square kept upright) (a band `radius` wide either side of the dragged line) is
// cut out of the vector. Closed shapes lose that area (a real boolean subtract, so the cut edges
// are new path segments); open paths are split where the band crosses them.

type Pt = { x: number; y: number };

// A round-ended band around one segment of the brush, as a polygon. The rounded ends use points
// at fixed angles around each centre, so neighbouring bands share exactly the same points where
// their ends overlap (the union then has no slivers).
const STEPS = 32;
function capsule(a: Pt, b: Pt, r: number): Subpath {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 1e-6) {
        dx = 1;
        dy = 0;
    }
    const heading = Math.atan2(dy, dx);
    const pts: Pt[] = [];
    // Half circle around `c` from angle `from` turning by +π.
    const arc = (c: Pt, from: number) => {
        pts.push({ x: c.x + Math.cos(from) * r, y: c.y + Math.sin(from) * r });
        const step = (Math.PI * 2) / STEPS;
        let k = Math.floor(from / step) + 1;
        while (k * step < from + Math.PI - 1e-9) {
            pts.push({ x: c.x + Math.cos(k * step) * r, y: c.y + Math.sin(k * step) * r });
            k++;
        }
        pts.push({ x: c.x + Math.cos(from + Math.PI) * r, y: c.y + Math.sin(from + Math.PI) * r });
    };
    arc(b, heading - Math.PI / 2);
    arc(a, heading + Math.PI / 2);
    return { closed: true, points: pts.map((p) => ({ x: p.x, y: p.y, in: null, out: null })) };
}

export type EraserShape = "round" | "square";

// Convex hull (counter-clockwise in screen terms), for the square brush's swept segments.
export function hull(points: Pt[]): Pt[] {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Pt[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Pt[] = [];
    for (const p of [...pts].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, p) <= 0) upper.pop();
        upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// A square brush (sides 2r, kept upright) swept along one segment: the hull of its two end squares.
export function squareBand(a: Pt, b: Pt, r: number): Pt[] {
    const corners = (c: Pt) => [
        { x: c.x - r, y: c.y - r },
        { x: c.x + r, y: c.y - r },
        { x: c.x + r, y: c.y + r },
        { x: c.x - r, y: c.y + r },
    ];
    return hull([...corners(a), ...corners(b)]);
}

function insideConvex(p: Pt, poly: Pt[]): boolean {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i] as Pt;
        const b = poly[(i + 1) % poly.length] as Pt;
        const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (Math.abs(c) < 1e-9) continue;
        const s = c > 0 ? 1 : -1;
        if (sign && s !== sign) return false;
        sign = s;
    }
    return true;
}

const polygon = (pts: Pt[]): Subpath => ({ closed: true, points: pts.map((p) => ({ x: p.x, y: p.y, in: null, out: null })) });

// The brush's whole stroke as one area.
export function brushArea(line: Pt[], radius: number, shape: EraserShape = "round"): Subpath[] {
    const pts = simplify(line, radius * 0.3);
    const piece = (a: Pt, b: Pt) => (shape === "square" ? polygon(squareBand(a, b, radius)) : capsule(a, b, radius));
    if (pts.length === 1) return [piece(pts[0] as Pt, pts[0] as Pt)];
    const pieces = [];
    for (let i = 1; i < pts.length; i++) pieces.push([piece(pts[i - 1] as Pt, pts[i] as Pt)]);
    return pieces.length === 1 ? (pieces[0] as Subpath[]) : booleanPaths("union", pieces);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function insideBrush(p: Pt, line: Pt[], r: number, shape: EraserShape = "round"): boolean {
    if (shape === "square") {
        if (line.length === 1) return Math.abs(p.x - (line[0] as Pt).x) <= r && Math.abs(p.y - (line[0] as Pt).y) <= r;
        for (let i = 1; i < line.length; i++) if (insideConvex(p, squareBand(line[i - 1] as Pt, line[i] as Pt, r))) return true;
        return false;
    }
    if (line.length === 1) return Math.hypot(p.x - (line[0] as Pt).x, p.y - (line[0] as Pt).y) <= r;
    for (let i = 1; i < line.length; i++) if (distToSegment(p, line[i - 1] as Pt, line[i] as Pt) <= r) return true;
    return false;
}

interface Seg {
    a: PathPoint;
    b: PathPoint;
}

function segAt(s: Seg, t: number): Pt {
    const c1 = s.a.out ?? s.a;
    const c2 = s.b.in ?? s.b;
    const u = 1 - t;
    return {
        x: u * u * u * s.a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * s.b.x,
        y: u * u * u * s.a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * s.b.y,
    };
}

// Splits open paths, dropping the parts inside the brush.
function eraseOpen(sub: Subpath, line: Pt[], r: number, shape: EraserShape): Subpath[] {
    const out: Subpath[] = [];
    let current: PathPoint[] = [];
    const flush = () => {
        if (current.length >= 2) out.push({ closed: false, points: current });
        current = [];
    };
    for (let i = 0; i + 1 < sub.points.length; i++) {
        const seg: Seg = { a: sub.points[i] as PathPoint, b: sub.points[i + 1] as PathPoint };
        const curved = Boolean(seg.a.out || seg.b.in);
        const N = 48;
        const inside = (t: number) => insideBrush(segAt(seg, t), line, r, shape);
        // Outside intervals of t, with boundaries refined by bisection.
        const intervals: [number, number][] = [];
        let start: number | null = inside(0) ? null : 0;
        let prevT = 0;
        let prevIn = inside(0);
        for (let k = 1; k <= N; k++) {
            const t = k / N;
            const now = inside(t);
            if (now !== prevIn) {
                let lo = prevT;
                let hi = t;
                for (let it = 0; it < 14; it++) {
                    const mid = (lo + hi) / 2;
                    if (inside(mid) === prevIn) lo = mid;
                    else hi = mid;
                }
                const edge = (lo + hi) / 2;
                if (now) {
                    if (start !== null) intervals.push([start, edge]);
                    start = null;
                } else start = edge;
            }
            prevT = t;
            prevIn = now;
        }
        if (start !== null) intervals.push([start, 1]);
        if (intervals.length === 1 && intervals[0]![0] === 0 && intervals[0]![1] === 1) {
            if (!current.length) current.push({ ...seg.a });
            current.push({ ...seg.b });
            continue;
        }
        for (const [t0, t1] of intervals) {
            const piece = curved
                ? subCubic({ a: seg.a, b: seg.b, c1: seg.a.out ?? { x: seg.a.x, y: seg.a.y }, c2: seg.b.in ?? { x: seg.b.x, y: seg.b.y } }, t0, t1)
                : { a: segAt(seg, t0), b: segAt(seg, t1), c1: null, c2: null };
            if (t0 > 0) flush();
            if (!current.length) current.push({ x: piece.a.x, y: piece.a.y, in: t0 === 0 ? seg.a.in : null, out: piece.c1 ? { ...piece.c1 } : null });
            else {
                const last = current[current.length - 1] as PathPoint;
                current[current.length - 1] = { ...last, out: piece.c1 ? { ...piece.c1 } : null };
            }
            current.push({ x: piece.b.x, y: piece.b.y, in: piece.c2 ? { ...piece.c2 } : null, out: t1 === 1 ? seg.b.out : null });
            if (t1 < 1) flush();
        }
        if (!intervals.length) flush();
    }
    flush();
    return out;
}

// The patch after erasing along `line` (in the layer's parent space); null when nothing is left,
// undefined when the brush missed.
export function eraseWithBrush(node: SceneNode, line: Pt[], radius: number, shape: EraserShape = "round"): NodePatch | null | undefined {
    if (!line.length) return undefined;
    const subs = placedSubpaths(node);
    const bounds = pathBounds(subs);
    if (!bounds) return undefined;
    const xs = line.map((p) => p.x);
    const ys = line.map((p) => p.y);
    if (Math.max(...xs) + radius < bounds.x || Math.min(...xs) - radius > bounds.x + bounds.w || Math.max(...ys) + radius < bounds.y || Math.min(...ys) - radius > bounds.y + bounds.h) return undefined;
    const closed = subs.filter((s) => s.closed);
    const open = subs.filter((s) => !s.closed);
    const area = brushArea(line, radius, shape);
    const keptClosed = closed.length ? booleanPaths("subtract", [closed, area]) : [];
    const keptOpen = open.flatMap((s) => eraseOpen(s, line, radius, shape));
    const left = [...keptClosed, ...keptOpen];
    if (!left.length) return null;
    const fitted = fitPath(left);
    return { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h, path: fitted.path, parametric: null };
}

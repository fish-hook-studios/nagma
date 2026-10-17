import type { BooleanOp, PathPoint, Subpath } from "./types";

// Boolean geometry on bezier paths: union, subtract, intersect and exclude producing real paths.
//
// The curves are flattened adaptively into edges that remember where on the original segment they
// came from. Every edge is split where it meets another (crossings, touching ends and overlapping
// collinear runs), coincident pieces are merged, and each piece is kept when the operation's result
// is inside on exactly one side of it (each operand's inside comes from its nonzero winding). The
// kept pieces are chained into rings, and runs that come from one original segment are turned back
// into that segment's exact curve, so circles stay circles and straight edges stay single lines.

type Pt = { x: number; y: number };

// One segment of an input path: a line, or a cubic when it has control points.
interface Segment {
    a: Pt;
    b: Pt;
    c1: Pt | null;
    c2: Pt | null;
}

interface Edge {
    a: Pt;
    b: Pt;
    seg: number;
    t0: number;
    t1: number;
}

// Points closer than this (document units) are the same point.
const SNAP = 1e-5;
// How far a flattened curve may stray from the real one.
const FLATNESS = 0.01;

function lerp(p: Pt, q: Pt, t: number): Pt {
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

function cubicAt(s: Segment, t: number): Pt {
    const c1 = s.c1 ?? s.a;
    const c2 = s.c2 ?? s.b;
    const u = 1 - t;
    return {
        x: u * u * u * s.a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * s.b.x,
        y: u * u * u * s.a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * s.b.y,
    };
}

// The part of a cubic between t0 and t1 (t0 may be greater than t1: the part runs backwards).
export function subCubic(s: Segment, t0: number, t1: number): { a: Pt; c1: Pt; c2: Pt; b: Pt } {
    const c1 = s.c1 ?? s.a;
    const c2 = s.c2 ?? s.b;
    // Blossoming: the control points of the curve restricted to [t0, t1].
    const blossom = (u: number, v: number, w: number): Pt => {
        const l1 = (p: Pt, q: Pt, t: number) => lerp(p, q, t);
        const a1 = l1(s.a, c1, u);
        const b1 = l1(c1, c2, u);
        const d1 = l1(c2, s.b, u);
        const a2 = l1(a1, b1, v);
        const b2 = l1(b1, d1, v);
        return l1(a2, b2, w);
    };
    return { a: blossom(t0, t0, t0), c1: blossom(t0, t0, t1), c2: blossom(t0, t1, t1), b: blossom(t1, t1, t1) };
}

function distToLine(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

// Adaptive flattening: split until both control points lie within the flatness of the chord.
function flattenCubic(s: Segment, seg: number, out: Edge[], tolerance: number) {
    const walk = (t0: number, t1: number, p0: Pt, p1: Pt, depth: number) => {
        const part = subCubic(s, t0, t1);
        const flat = distToLine(part.c1, p0, p1) <= tolerance && distToLine(part.c2, p0, p1) <= tolerance;
        if (flat || depth >= 18) {
            out.push({ a: p0, b: p1, seg, t0, t1 });
            return;
        }
        const tm = (t0 + t1) / 2;
        const pm = cubicAt(s, tm);
        walk(t0, tm, p0, pm, depth + 1);
        walk(tm, t1, pm, p1, depth + 1);
    };
    // Always split once so a loop whose ends coincide still gets flattened.
    const tm = 0.5;
    const pm = cubicAt(s, tm);
    walk(0, tm, s.a, pm, 1);
    walk(tm, 1, pm, s.b, 1);
}

// Merges nearby points so shared corners and intersections are one vertex.
class Snapper {
    private cells = new Map<string, { p: Pt; id: number }[]>();
    points: Pt[] = [];
    snap(p: Pt): number {
        const cx = Math.round(p.x / SNAP);
        const cy = Math.round(p.y / SNAP);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const list = this.cells.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const q of list) if (Math.abs(q.p.x - p.x) <= SNAP && Math.abs(q.p.y - p.y) <= SNAP) return q.id;
            }
        }
        const id = this.points.length;
        this.points.push(p);
        const key = `${cx},${cy}`;
        const list = this.cells.get(key);
        if (list) list.push({ p, id });
        else this.cells.set(key, [{ p, id }]);
        return id;
    }
}

// Winding numbers of one operand, with its edges bucketed into horizontal bands.
class Winding {
    private bands: Edge[][] = [];
    private y0 = 0;
    private bandH = 1;
    constructor(edges: Edge[]) {
        if (!edges.length) return;
        let lo = Infinity;
        let hi = -Infinity;
        for (const e of edges) {
            lo = Math.min(lo, e.a.y, e.b.y);
            hi = Math.max(hi, e.a.y, e.b.y);
        }
        const n = Math.max(1, Math.min(256, Math.ceil(edges.length / 8)));
        this.y0 = lo;
        this.bandH = Math.max(1e-9, (hi - lo) / n);
        this.bands = Array.from({ length: n }, () => []);
        for (const e of edges) {
            const b0 = this.band(Math.min(e.a.y, e.b.y));
            const b1 = this.band(Math.max(e.a.y, e.b.y));
            for (let b = b0; b <= b1; b++) this.bands[b]?.push(e);
        }
    }
    private band(y: number): number {
        return Math.max(0, Math.min(this.bands.length - 1, Math.floor((y - this.y0) / this.bandH)));
    }
    at(p: Pt): number {
        if (!this.bands.length) return 0;
        if (p.y < this.y0 || p.y > this.y0 + this.bandH * this.bands.length) return 0;
        let w = 0;
        for (const e of this.bands[this.band(p.y)] ?? []) {
            const { a, b } = e;
            if (a.y <= p.y) {
                if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
            } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) w--;
        }
        return w;
    }
}

function resultInside(op: BooleanOp, inside: boolean[]): boolean {
    if (!inside.length) return false;
    if (op === "union") return inside.some(Boolean);
    if (op === "intersect") return inside.every(Boolean);
    if (op === "subtract") return Boolean(inside[0]) && !inside.slice(1).some(Boolean);
    return inside.filter(Boolean).length % 2 === 1;
}

// Split parameters where two edges meet (on each edge, between 0 and 1).
function intersect(e: Edge, f: Edge, se: number[], sf: number[]) {
    const r = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
    const s = { x: f.b.x - f.a.x, y: f.b.y - f.a.y };
    const qp = { x: f.a.x - e.a.x, y: f.a.y - e.a.y };
    const denom = r.x * s.y - r.y * s.x;
    const lr = Math.hypot(r.x, r.y);
    const ls = Math.hypot(s.x, s.y);
    if (lr < 1e-12 || ls < 1e-12) return;
    const eps = 1e-9;
    if (Math.abs(denom) <= 1e-10 * lr * ls) {
        // Parallel: only collinear overlaps matter. Each edge splits at the other's ends.
        if (Math.abs(qp.x * r.y - qp.y * r.x) / lr > SNAP) return;
        const rr = lr * lr;
        const ss = ls * ls;
        const onE = (p: Pt) => ((p.x - e.a.x) * r.x + (p.y - e.a.y) * r.y) / rr;
        const onF = (p: Pt) => ((p.x - f.a.x) * s.x + (p.y - f.a.y) * s.y) / ss;
        for (const t of [onE(f.a), onE(f.b)]) if (t > eps && t < 1 - eps) se.push(t);
        for (const t of [onF(e.a), onF(e.b)]) if (t > eps && t < 1 - eps) sf.push(t);
        return;
    }
    const t = (qp.x * s.y - qp.y * s.x) / denom;
    const u = (qp.x * r.y - qp.y * r.x) / denom;
    const tolT = SNAP / lr;
    const tolU = SNAP / ls;
    if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return;
    if (t > eps && t < 1 - eps) se.push(t);
    if (u > eps && u < 1 - eps) sf.push(u);
}

function segmentsOf(sub: Subpath): Segment[] {
    const pts = sub.points;
    const n = pts.length;
    const out: Segment[] = [];
    // Booleans fill areas, so open paths count as closed.
    for (let i = 0; i < n; i++) {
        const a = pts[i] as PathPoint;
        const b = pts[(i + 1) % n] as PathPoint;
        if (n === 1) break;
        const curved = Boolean(a.out || b.in);
        out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, c1: curved ? (a.out ?? { x: a.x, y: a.y }) : null, c2: curved ? (b.in ?? { x: b.x, y: b.y }) : null });
    }
    return out;
}

// Edges of every operand's area, flattened.
function flatten(shapes: Subpath[][], tolerance: number): { segments: Segment[]; perShape: Edge[][] } {
    const segments: Segment[] = [];
    const perShape = shapes.map((subpaths) => {
        const edges: Edge[] = [];
        for (const sub of subpaths) {
            for (const s of segmentsOf(sub)) {
                const id = segments.length;
                segments.push(s);
                if (s.c1 || s.c2) flattenCubic(s, id, edges, tolerance);
                else edges.push({ a: s.a, b: s.b, seg: id, t0: 0, t1: 1 });
            }
        }
        return edges.filter((e) => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) > SNAP / 10);
    });
    return { segments, perShape };
}

interface Piece {
    a: number;
    b: number;
    seg: number;
    t0: number;
    t1: number;
}

// Combines closed shapes (each a list of subpaths, filled nonzero) with a boolean operation. Shapes
// are bottom to top; subtract takes the first shape and cuts away the rest.
export function booleanPaths(op: BooleanOp, shapes: Subpath[][], tolerance = FLATNESS): Subpath[] {
    const { segments, perShape } = flatten(shapes, tolerance);
    const all = perShape.flat();
    if (!all.length) return [];
    const windings = perShape.map((edges) => new Winding(edges));

    // Find every meeting point with a sweep over x.
    const splits: number[][] = all.map(() => []);
    const order = all.map((_, i) => i).sort((i, j) => Math.min(all[i]!.a.x, all[i]!.b.x) - Math.min(all[j]!.a.x, all[j]!.b.x));
    const active: number[] = [];
    for (const i of order) {
        const e = all[i] as Edge;
        const minX = Math.min(e.a.x, e.b.x);
        const minY = Math.min(e.a.y, e.b.y);
        const maxY = Math.max(e.a.y, e.b.y);
        for (let k = active.length - 1; k >= 0; k--) {
            const j = active[k] as number;
            const f = all[j] as Edge;
            if (Math.max(f.a.x, f.b.x) < minX - SNAP) {
                active.splice(k, 1);
                continue;
            }
            if (Math.max(f.a.y, f.b.y) < minY - SNAP || Math.min(f.a.y, f.b.y) > maxY + SNAP) continue;
            intersect(e, f, splits[i] as number[], splits[j] as number[]);
        }
        active.push(i);
    }

    // Split, snap and merge coincident pieces.
    const snapper = new Snapper();
    const pieces = new Map<string, Piece>();
    all.forEach((e, i) => {
        const ts = [0, ...(splits[i] ?? []).sort((p, q) => p - q), 1];
        let prevId = snapper.snap(e.a);
        let prevT = e.t0;
        for (let k = 1; k < ts.length; k++) {
            const u = ts[k] as number;
            const p = k === ts.length - 1 ? e.b : lerp(e.a, e.b, u);
            const id = snapper.snap(p);
            const t = e.t0 + (e.t1 - e.t0) * u;
            if (id !== prevId) {
                const key = prevId < id ? `${prevId}:${id}` : `${id}:${prevId}`;
                if (!pieces.has(key)) pieces.set(key, { a: prevId, b: id, seg: e.seg, t0: prevT, t1: t });
                prevId = id;
                prevT = t;
            }
        }
    });

    // Keep the pieces with the result on one side only, turned so the inside is on their left.
    const P = snapper.points;
    const kept: Piece[] = [];
    for (const piece of pieces.values()) {
        const a = P[piece.a] as Pt;
        const b = P[piece.b] as Pt;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const eps = Math.min(len * 0.25, 1e-3);
        const nx = (-dy / len) * eps;
        const ny = (dx / len) * eps;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const left = resultInside(op, windings.map((w) => w.at({ x: m.x + nx, y: m.y + ny }) !== 0));
        const right = resultInside(op, windings.map((w) => w.at({ x: m.x - nx, y: m.y - ny }) !== 0));
        if (left === right) continue;
        kept.push(left ? piece : { a: piece.b, b: piece.a, seg: piece.seg, t0: piece.t1, t1: piece.t0 });
    }

    // Chain into rings. At a vertex with several ways on, take the sharpest turn so touching rings stay apart.
    const outgoing = new Map<number, Piece[]>();
    for (const piece of kept) {
        const list = outgoing.get(piece.a);
        if (list) list.push(piece);
        else outgoing.set(piece.a, [piece]);
    }
    const used = new Set<Piece>();
    const rings: Piece[][] = [];
    for (const start of kept) {
        if (used.has(start)) continue;
        const ring: Piece[] = [];
        let cur: Piece | undefined = start;
        let guard = 0;
        while (cur && !used.has(cur) && guard++ < kept.length + 1) {
            used.add(cur);
            ring.push(cur);
            if (cur.b === start.a) break;
            const options: Piece[] = (outgoing.get(cur.b) ?? []).filter((p) => !used.has(p));
            if (options.length <= 1) {
                cur = options[0];
                continue;
            }
            const from = P[cur.a] as Pt;
            const at = P[cur.b] as Pt;
            const back = Math.atan2(from.y - at.y, from.x - at.x);
            let best: Piece | undefined;
            let bestAngle = Infinity;
            for (const o of options) {
                const to = P[o.b] as Pt;
                let ang = back - Math.atan2(to.y - at.y, to.x - at.x);
                while (ang <= 0) ang += Math.PI * 2;
                while (ang > Math.PI * 2) ang -= Math.PI * 2;
                if (ang < bestAngle) {
                    bestAngle = ang;
                    best = o;
                }
            }
            cur = best;
        }
        if (ring.length >= 2) rings.push(ring);
    }

    return rings.map((ring) => toSubpath(ring, P, segments)).filter((s): s is Subpath => s !== null);
}

// Turns a ring of pieces back into path points, merging runs of one original segment into its curve.
function toSubpath(ring: Piece[], P: Pt[], segments: Segment[]): Subpath | null {
    const continues = (p: Piece, q: Piece) => p.seg === q.seg && Math.abs(p.t1 - q.t0) < 1e-9;
    // Start the ring at a break between runs so no run wraps around.
    let start = ring.findIndex((p, i) => !continues(ring[(i - 1 + ring.length) % ring.length] as Piece, p));
    if (start < 0) start = 0;
    const ordered = [...ring.slice(start), ...ring.slice(0, start)];
    type Run = { a: Pt; b: Pt; c1: Pt | null; c2: Pt | null };
    const runs: Run[] = [];
    let i = 0;
    while (i < ordered.length) {
        const first = ordered[i] as Piece;
        let last = first;
        let j = i + 1;
        while (j < ordered.length && continues(last, ordered[j] as Piece)) last = ordered[j++] as Piece;
        const seg = segments[first.seg] as Segment;
        const a = P[first.a] as Pt;
        const b = P[last.b] as Pt;
        if (seg.c1 || seg.c2) {
            const part = subCubic(seg, first.t0, last.t1);
            // Keep the snapped ends exactly; nudge the controls by the same amount.
            runs.push({
                a,
                b,
                c1: { x: part.c1.x + a.x - part.a.x, y: part.c1.y + a.y - part.a.y },
                c2: { x: part.c2.x + b.x - part.b.x, y: part.c2.y + b.y - part.b.y },
            });
        } else runs.push({ a, b, c1: null, c2: null });
        i = j;
    }
    // Straight runs that carry on in the same direction become one line.
    const merged: Run[] = [];
    for (const run of runs) {
        const prev = merged[merged.length - 1];
        if (prev && !prev.c1 && !run.c1) {
            const cross = (prev.b.x - prev.a.x) * (run.b.y - run.a.y) - (prev.b.y - prev.a.y) * (run.b.x - run.a.x);
            const dot = (prev.b.x - prev.a.x) * (run.b.x - run.a.x) + (prev.b.y - prev.a.y) * (run.b.y - run.a.y);
            const scale = Math.hypot(prev.b.x - prev.a.x, prev.b.y - prev.a.y) * Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y);
            if (dot > 0 && Math.abs(cross) <= 1e-9 * Math.max(scale, 1e-12)) {
                prev.b = run.b;
                continue;
            }
        }
        merged.push({ ...run });
    }
    if (merged.length > 2) {
        const first = merged[0] as Run;
        const last = merged[merged.length - 1] as Run;
        if (!first.c1 && !last.c1) {
            const cross = (last.b.x - last.a.x) * (first.b.y - first.a.y) - (last.b.y - last.a.y) * (first.b.x - first.a.x);
            const dot = (last.b.x - last.a.x) * (first.b.x - first.a.x) + (last.b.y - last.a.y) * (first.b.y - first.a.y);
            const scale = Math.hypot(last.b.x - last.a.x, last.b.y - last.a.y) * Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y);
            if (dot > 0 && Math.abs(cross) <= 1e-9 * Math.max(scale, 1e-12)) {
                first.a = last.a;
                merged.pop();
            }
        }
    }
    // Rings with no real area (slivers left between nearly coincident curves) are dropped.
    let area = 0;
    let perimeter = 0;
    for (const r of merged) {
        if (r.c1 && r.c2) {
            let prev = r.a;
            for (let k = 1; k <= 8; k++) {
                const t = k / 8;
                const u = 1 - t;
                const q = {
                    x: u * u * u * r.a.x + 3 * u * u * t * r.c1.x + 3 * u * t * t * r.c2.x + t * t * t * r.b.x,
                    y: u * u * u * r.a.y + 3 * u * u * t * r.c1.y + 3 * u * t * t * r.c2.y + t * t * t * r.b.y,
                };
                area += prev.x * q.y - q.x * prev.y;
                perimeter += Math.hypot(q.x - prev.x, q.y - prev.y);
                prev = q;
            }
        } else {
            area += r.a.x * r.b.y - r.b.x * r.a.y;
            perimeter += Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
        }
    }
    area = Math.abs(area) / 2;
    // Thinner than a hundredth of a pixel on average, or smaller than a hundredth of a square pixel.
    if (merged.length < 2 || area < 1e-4 || area < perimeter * 0.005) return null;
    const points: PathPoint[] = merged.map((r) => ({ x: r.a.x, y: r.a.y, in: null, out: r.c1 ? { ...r.c1 } : null }));
    merged.forEach((r, k) => {
        const next = points[(k + 1) % points.length] as PathPoint;
        if (r.c2) next.in = { ...r.c2 };
    });
    return { closed: true, points };
}

// Pure geometry helpers for other tools (eraser, flatten): the union of several shapes.
export function unionPaths(shapes: Subpath[][]): Subpath[] {
    return booleanPaths("union", shapes);
}

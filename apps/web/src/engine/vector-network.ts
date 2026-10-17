import type { PathPoint, RegionFill, SceneNode, Subpath } from "./types";

// Vector networks. A vector's path is a list of subpaths, but points that sit on the same spot are
// one point of the network (they move together), so a point can join any number of segments. The
// segments then divide the plane into regions (faces): the areas enclosed by segments, found by
// walking around the network. Regions are filled or left empty one by one (the Paint tool toggles
// them); `path.filled` lists the filled ones by their signature. Without it, a vector fills like a
// plain path (each closed subpath).

type Pt = { x: number; y: number };

export interface HalfEdge {
    // The segment after point `index` of subpath `sub`, walked forwards or backwards.
    sub: number;
    index: number;
    forward: boolean;
    from: number;
    to: number;
    a: Pt;
    c1: Pt;
    c2: Pt;
    b: Pt;
}

export interface Face {
    // Stable while points move: which segments bound it, and in which direction.
    id: string;
    loop: HalfEdge[];
    // Other parts of the network sitting inside this region (they cut holes in its fill).
    holes: HalfEdge[][];
    // The outline sampled, and its area.
    poly: Pt[];
    area: number;
}

const KEY = 100;
export const weldKey = (p: Pt) => `${Math.round(p.x * KEY)}:${Math.round(p.y * KEY)}`;

function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
    const u = 1 - t;
    return {
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
}

function sample(edges: HalfEdge[], steps = 12): Pt[] {
    const out: Pt[] = [];
    for (const e of edges) for (let k = 0; k < steps; k++) out.push(cubic(e.a, e.c1, e.c2, e.b, k / steps));
    return out;
}

function signedArea(poly: Pt[]): number {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i] as Pt;
        const q = poly[(i + 1) % poly.length] as Pt;
        sum += p.x * q.y - q.x * p.y;
    }
    return sum / 2;
}

export function insidePoly(poly: Pt[], p: Pt): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i] as Pt;
        const b = poly[j] as Pt;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// The direction a half-edge leaves its start point (a little way along the curve, so tangent
// handles and straight lines compare alike).
function departure(e: HalfEdge): number {
    const p = cubic(e.a, e.c1, e.c2, e.b, 0.02);
    return Math.atan2(p.y - e.a.y, p.x - e.a.x);
}

type Seg = { sub: number; index: number; a: Pt; c1: Pt; c2: Pt; b: Pt };

function box(c: Pt[]) {
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function split(c: [Pt, Pt, Pt, Pt], t: number): [[Pt, Pt, Pt, Pt], [Pt, Pt, Pt, Pt]] {
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const [p0, p1, p2, p3] = c;
    const a = lerp(p0, p1);
    const b = lerp(p1, p2);
    const d = lerp(p2, p3);
    const e = lerp(a, b);
    const f = lerp(b, d);
    const m = lerp(e, f);
    return [
        [p0, a, e, m],
        [m, f, d, p3],
    ];
}

// Where two segments cross, as parameter pairs (by subdividing until the boxes are tiny).
function crossings(p: [Pt, Pt, Pt, Pt], q: [Pt, Pt, Pt, Pt], out: [number, number][], ta = [0, 1], tb = [0, 1], depth = 0) {
    const bp = box(p);
    const bq = box(q);
    if (bp.x1 < bq.x0 || bq.x1 < bp.x0 || bp.y1 < bq.y0 || bq.y1 < bp.y0) return;
    const small = (b: ReturnType<typeof box>) => b.x1 - b.x0 < 0.01 && b.y1 - b.y0 < 0.01;
    if (depth > 24 || (small(bp) && small(bq))) {
        const t = [((ta[0] as number) + (ta[1] as number)) / 2, ((tb[0] as number) + (tb[1] as number)) / 2] as [number, number];
        if (!out.some((o) => Math.abs(o[0] - t[0]) < 1e-3 && Math.abs(o[1] - t[1]) < 1e-3)) out.push(t);
        return;
    }
    const [p1, p2] = split(p, 0.5);
    const [q1, q2] = split(q, 0.5);
    const ma = ((ta[0] as number) + (ta[1] as number)) / 2;
    const mb = ((tb[0] as number) + (tb[1] as number)) / 2;
    crossings(p1, q1, out, [ta[0] as number, ma], [tb[0] as number, mb], depth + 1);
    crossings(p1, q2, out, [ta[0] as number, ma], [mb, tb[1] as number], depth + 1);
    crossings(p2, q1, out, [ma, ta[1] as number], [tb[0] as number, mb], depth + 1);
    crossings(p2, q2, out, [ma, ta[1] as number], [mb, tb[1] as number], depth + 1);
}

// Every segment of the network as two half-edges, with the network's points (welded by position).
// Segments that cross are split where they cross, so the crossing is a point of every region round it.
export function networkEdges(subs: Subpath[]): { points: Pt[]; edges: HalfEdge[] } {
    const index = new Map<string, number>();
    const points: Pt[] = [];
    const vertex = (p: Pt) => {
        const key = weldKey(p);
        let i = index.get(key);
        if (i === undefined) {
            i = points.length;
            index.set(key, i);
            points.push({ x: p.x, y: p.y });
        }
        return i;
    };
    const segs: Seg[] = [];
    const seen = new Set<string>();
    subs.forEach((sub, s) => {
        const n = sub.points.length;
        const count = sub.closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
            const a = sub.points[i] as PathPoint;
            const b = sub.points[(i + 1) % n] as PathPoint;
            if (weldKey(a) === weldKey(b)) continue;
            const c1 = a.out ?? a;
            const c2 = b.in ?? b;
            // The same segment drawn twice counts once.
            const sig = [weldKey(a), weldKey(b), weldKey(c1), weldKey(c2)].join("|");
            const rev = [weldKey(b), weldKey(a), weldKey(c2), weldKey(c1)].join("|");
            if (seen.has(sig) || seen.has(rev)) continue;
            seen.add(sig);
            segs.push({ sub: s, index: i, a: { x: a.x, y: a.y }, c1, c2, b: { x: b.x, y: b.y } });
        }
    });
    // Crossings away from the segments' own ends, with the point both pieces share.
    const cuts: { t: number; at: Pt }[][] = segs.map(() => []);
    if (segs.length <= 400) {
        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                const p = segs[i] as Seg;
                const q = segs[j] as Seg;
                const found: [number, number][] = [];
                crossings([p.a, p.c1, p.c2, p.b], [q.a, q.c1, q.c2, q.b], found);
                for (const [ta, tb] of found) {
                    const at = cubic(p.a, p.c1, p.c2, p.b, ta);
                    const end = (seg: Seg) => weldKey(at) === weldKey(seg.a) || weldKey(at) === weldKey(seg.b) || Math.hypot(at.x - seg.a.x, at.y - seg.a.y) < 0.05 || Math.hypot(at.x - seg.b.x, at.y - seg.b.y) < 0.05;
                    if (end(p) && end(q)) continue;
                    if (!end(p)) (cuts[i] as { t: number; at: Pt }[]).push({ t: ta, at });
                    if (!end(q)) (cuts[j] as { t: number; at: Pt }[]).push({ t: tb, at });
                }
            }
        }
    }
    const edges: HalfEdge[] = [];
    segs.forEach((seg, k) => {
        const list = (cuts[k] as { t: number; at: Pt }[]).sort((x, y) => x.t - y.t).filter((c, i, all) => i === 0 || c.t - (all[i - 1] as { t: number }).t > 1e-4);
        let rest: [Pt, Pt, Pt, Pt] = [seg.a, seg.c1, seg.c2, seg.b];
        let done = 0;
        const pieces: [Pt, Pt, Pt, Pt][] = [];
        for (const c of list) {
            const local = (c.t - done) / (1 - done);
            const [head, tail] = split(rest, local);
            head[3] = c.at;
            tail[0] = c.at;
            pieces.push(head);
            rest = tail;
            done = c.t;
        }
        pieces.push(rest);
        pieces.forEach(([a, c1, c2, b], piece) => {
            const from = vertex(a);
            const to = vertex(b);
            if (from === to) return;
            const index = list.length ? seg.index + piece / 1000 : seg.index;
            edges.push({ sub: seg.sub, index, forward: true, from, to, a, c1, c2, b });
            edges.push({ sub: seg.sub, index, forward: false, from: to, to: from, a: b, c1: c2, c2: c1, b: a });
        });
    });
    return { points, edges };
}

const edgeId = (e: HalfEdge) => `${e.sub}.${e.index}${e.forward ? "+" : "-"}`;

// The regions of the network: every bounded face, with the parts of the network nested inside it as holes.
export function networkFaces(subs: Subpath[]): Face[] {
    const { points, edges } = networkEdges(subs);
    if (!edges.length) return [];
    const out = new Map<number, HalfEdge[]>();
    for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
    for (const list of out.values()) list.sort((p, q) => departure(p) - departure(q));
    const twin = (e: HalfEdge) => edges.find((t) => t.sub === e.sub && t.index === e.index && t.forward !== e.forward) as HalfEdge;
    // Walking: at the end of an edge, turn to the next edge clockwise from the way back, so every
    // bounded region is walked with the same orientation and each component's outside the other way.
    const next = (e: HalfEdge): HalfEdge => {
        const list = out.get(e.to) ?? [];
        const back = twin(e);
        const k = list.indexOf(back);
        return list[(k - 1 + list.length) % list.length] as HalfEdge;
    };
    const used = new Set<HalfEdge>();
    const cycles: HalfEdge[][] = [];
    for (const e of edges) {
        if (used.has(e)) continue;
        const cycle: HalfEdge[] = [];
        let cur = e;
        while (!used.has(cur) && cycle.length <= edges.length) {
            used.add(cur);
            cycle.push(cur);
            cur = next(cur);
        }
        cycles.push(cycle);
    }
    // Components (by connectivity), to tell each one's outside from its regions.
    const parent = points.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
    for (const e of edges) parent[find(e.from)] = find(e.to);
    const measured = cycles.map((loop) => {
        const poly = sample(loop);
        return { loop, poly, area: signedArea(poly), comp: find((loop[0] as HalfEdge).from) };
    });
    // With this walk, regions have positive signed area in screen space (y down); outsides negative.
    const regions = measured.filter((c) => c.area > 1e-6);
    const outsides = measured.filter((c) => c.area <= 1e-6);
    return regions.map(({ loop, poly, area, comp }) => {
        const holes: HalfEdge[][] = [];
        for (const o of outsides) {
            if (o.comp === comp || !o.poly.length) continue;
            const probe = o.poly[0] as Pt;
            if (!insidePoly(poly, probe)) continue;
            // Only when no smaller region (of another component) holds it more tightly.
            const tighter = regions.some((r) => r.comp !== o.comp && r.loop !== loop && Math.abs(r.area) < Math.abs(area) && insidePoly(r.poly, probe) && insidePoly(poly, r.poly[0] as Pt));
            if (!tighter) holes.push(o.loop);
        }
        return { id: loop.map(edgeId).sort().join(","), loop, holes, poly, area: Math.abs(area) };
    });
}

// The smallest region under a point (holes excluded), or null.
export function faceAt(faces: Face[], p: Pt): Face | null {
    let best: Face | null = null;
    for (const f of faces) {
        if (!insidePoly(f.poly, p)) continue;
        if (f.holes.some((h) => insidePoly(sample(h), p))) continue;
        if (!best || f.area < best.area) best = f;
    }
    return best;
}

function loopSubpath(loop: HalfEdge[]): Subpath {
    // Each point carries the handle into it from the previous edge and out of it along the next.
    return {
        closed: true,
        points: loop.map((e, i) => {
            const prev = loop[(i - 1 + loop.length) % loop.length] as HalfEdge;
            const inH = prev.c2.x === e.a.x && prev.c2.y === e.a.y ? null : { ...prev.c2 };
            const outH = e.c1.x === e.a.x && e.c1.y === e.a.y ? null : { ...e.c1 };
            return { x: e.a.x, y: e.a.y, in: inH, out: outH };
        }),
    };
}

// The filled area of a vector whose regions are filled one by one: closed subpaths to fill with
// the even-odd rule (holes included).
export function filledSubpaths(subs: Subpath[], filled: string[]): Subpath[] {
    const want = new Set(filled);
    const out: Subpath[] = [];
    for (const f of networkFaces(subs)) {
        if (!want.has(f.id)) continue;
        out.push(loopSubpath(f.loop));
        for (const h of f.holes) out.push(loopSubpath(h));
    }
    return out;
}

// The regions a plain path fills today (closed subpaths, non-zero), to start per-region filling from.
export function initiallyFilled(subs: Subpath[], faces: Face[] = networkFaces(subs)): string[] {
    const closed = subs.filter((s) => s.closed);
    if (!closed.length) return [];
    return faces
        .filter((f) => {
            // A point just inside the region: the centre of a small triangle at its first corner.
            const probe = innerPoint(f);
            return probe ? closed.some((s) => insidePoly(sample(subEdges(s)), probe)) : false;
        })
        .map((f) => f.id);
}

function subEdges(sub: Subpath): HalfEdge[] {
    const n = sub.points.length;
    const out: HalfEdge[] = [];
    for (let i = 0; i < n; i++) {
        const a = sub.points[i] as PathPoint;
        const b = sub.points[(i + 1) % n] as PathPoint;
        out.push({ sub: 0, index: i, forward: true, from: 0, to: 0, a, c1: a.out ?? a, c2: b.in ?? b, b });
    }
    return out;
}

// Some point strictly inside a region (tries the centroid, then points near its outline).
export function innerPoint(f: Face): Pt | null {
    const poly = f.poly;
    if (poly.length < 3) return null;
    const c = poly.reduce((acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }), { x: 0, y: 0 });
    if (insidePoly(poly, c)) return c;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i] as Pt;
        const q = poly[(i + 2) % poly.length] as Pt;
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const probe = { x: m.x * 0.98 + c.x * 0.02, y: m.y * 0.98 + c.y * 0.02 };
        if (insidePoly(poly, probe)) return probe;
    }
    return null;
}

// How many segments meet at each point of the network (a point shared by three or more is a junction).
export function pointDegrees(subs: Subpath[]): Map<string, number> {
    const { points, edges } = networkEdges(subs);
    const degree = new Map<string, number>();
    for (const e of edges) {
        if (!e.forward) continue;
        for (const v of [e.from, e.to]) {
            const key = weldKey(points[v] as Pt);
            degree.set(key, (degree.get(key) ?? 0) + 1);
        }
    }
    return degree;
}

// ---- Per-layer region fills ------------------------------------------------------------------

// The regions of a layer that are filled now: by signature, or, when points were added since, the
// region holding the remembered point. `subs` are the layer's placed subpaths.
export function filledFaces(node: Pick<SceneNode, "x" | "y" | "w" | "h" | "regionFills">, subs: Subpath[], faces: Face[] = networkFaces(subs)): Face[] {
    const fills = node.regionFills ?? [];
    const out = new Set<Face>();
    for (const r of fills) {
        const exact = faces.find((f) => f.id === r.id);
        const found = exact ?? faceAt(faces, { x: node.x + r.x * node.w, y: node.y + r.y * node.h });
        if (found) out.add(found);
    }
    return [...out];
}

// The fill geometry of a vector filled region by region (null when it fills like a plain path).
export function regionFillSubpaths(node: SceneNode, subs: Subpath[]): Subpath[] | null {
    if (!node.regionFills) return null;
    const out: Subpath[] = [];
    for (const f of filledFaces(node, subs)) {
        out.push(loopSubpath(f.loop));
        for (const h of f.holes) out.push(loopSubpath(h));
    }
    return out;
}

// Regions as their remembered form.
export function regionFillsFor(node: Pick<SceneNode, "x" | "y" | "w" | "h">, faces: Face[]): RegionFill[] {
    return faces.map((f) => {
        const p = innerPoint(f) ?? f.poly[0] ?? { x: node.x, y: node.y };
        return { id: f.id, x: node.w ? (p.x - node.x) / node.w : 0, y: node.h ? (p.y - node.y) / node.h : 0 };
    });
}

// The Paint tool: fills (or, with `remove`, clears) the given regions of a layer. The first time,
// the layer's current fill (every closed subpath) becomes per-region fills.
export function paintFaces(node: SceneNode, subs: Subpath[], ids: string[], remove: boolean): RegionFill[] {
    const faces = networkFaces(subs);
    const current = node.regionFills ? filledFaces(node, subs, faces) : faces.filter((f) => initiallyFilled(subs, faces).includes(f.id));
    const set = new Set(current.map((f) => f.id));
    for (const id of ids) {
        if (remove) set.delete(id);
        else set.add(id);
    }
    return regionFillsFor(node, faces.filter((f) => set.has(f.id)));
}

// Whether a region of the layer is filled now.
export function isFaceFilled(node: SceneNode, subs: Subpath[], id: string): boolean {
    const faces = networkFaces(subs);
    if (node.regionFills) return filledFaces(node, subs, faces).some((f) => f.id === id);
    return initiallyFilled(subs, faces).includes(id);
}

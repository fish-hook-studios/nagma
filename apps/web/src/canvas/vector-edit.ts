import { worldToScreen } from "../engine/camera";
import { apply, worldMatrix } from "../engine/transform";
import type { Camera, NagmaDocument, NodePatch, PathPoint, SceneNode, Subpath } from "../engine/types";
import { booleanPaths } from "../engine/clip";
import { fitPath, placedSubpaths, shapeSubpaths } from "../engine/vector";
import { isEffectivelyVisible } from "../engine/nodes";
import { worldBounds } from "../engine/transform";
import { weldKey } from "../engine/vector-network";

type Pt = { x: number; y: number };

// Which part of a path an edit targets: an anchor point or one of its two handles.
export interface VertexRef {
    sub: number;
    index: number;
    part: "anchor" | "in" | "out";
}

export interface ScreenVertex extends VertexRef {
    x: number;
    y: number;
}

// A spot on a segment: the segment after point `index` of subpath `sub`, at parameter t.
export interface SegmentHit {
    sub: number;
    index: number;
    t: number;
    point: Pt;
}

// How dragging one handle moves the other: not at all, keeping the angle, or angle and length.
export type HandleMirror = "none" | "angle" | "both";

// The tools of vector edit mode, as in the floating bar.
export type VectorTool = "move" | "lasso" | "paint" | "bend" | "cut" | "erase" | "builder" | "width";

export function sameRef(a: VertexRef, b: VertexRef) {
    return a.sub === b.sub && a.index === b.index && a.part === b.part;
}

export function isSelected(refs: VertexRef[], sub: number, index: number) {
    return refs.some((r) => r.part === "anchor" && r.sub === sub && r.index === index);
}

function screenMapper(doc: NagmaDocument, node: SceneNode, camera: Camera) {
    const m = worldMatrix(doc, node);
    return (p: Pt) => {
        const w = apply(m, p.x, p.y);
        return worldToScreen(camera, w.x, w.y);
    };
}

// Every anchor and handle of a vector, in screen space. Handles show around selected points and their neighbours.
export function screenVertices(doc: NagmaDocument, node: SceneNode, camera: Camera, selected: VertexRef[]): ScreenVertex[] {
    const toScreen = screenMapper(doc, node, camera);
    const out: ScreenVertex[] = [];
    placedSubpaths(node).forEach((sub, s) => {
        const n = sub.points.length;
        sub.points.forEach((p, i) => {
            const near = selected.some((r) => r.sub === s && (Math.abs(r.index - i) <= 1 || (sub.closed && (r.index === 0 || r.index === n - 1) && (i === 0 || i === n - 1))));
            if (near) {
                if (p.in) out.push({ sub: s, index: i, part: "in", ...toScreen(p.in) });
                if (p.out) out.push({ sub: s, index: i, part: "out", ...toScreen(p.out) });
            }
            out.push({ sub: s, index: i, part: "anchor", ...toScreen(p) });
        });
    });
    return out;
}

export function hitVertex(doc: NagmaDocument, node: SceneNode, camera: Camera, selected: VertexRef[], sx: number, sy: number): VertexRef | null {
    const all = screenVertices(doc, node, camera, selected);
    // Handles first: they sit on top of anchors when a curve is tight.
    const ordered = [...all.filter((v) => v.part !== "anchor"), ...all.filter((v) => v.part === "anchor")];
    for (const v of ordered) if (Math.hypot(v.x - sx, v.y - sy) <= 6) return { sub: v.sub, index: v.index, part: v.part };
    return null;
}

function cubicAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
    const u = 1 - t;
    return {
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
}

function segmentCount(sub: Subpath) {
    return sub.closed ? sub.points.length : sub.points.length - 1;
}

function segmentEnds(sub: Subpath, index: number): { a: PathPoint; b: PathPoint; c1: Pt; c2: Pt } | null {
    const a = sub.points[index];
    const b = sub.points[(index + 1) % sub.points.length];
    if (!a || !b) return null;
    return { a, b, c1: a.out ?? a, c2: b.in ?? b };
}

// The nearest segment within `tolerance` screen pixels of a point.
export function hitSegment(doc: NagmaDocument, node: SceneNode, camera: Camera, sx: number, sy: number, tolerance = 6): SegmentHit | null {
    const toScreen = screenMapper(doc, node, camera);
    let best: SegmentHit | null = null;
    let bestDist = tolerance;
    placedSubpaths(node).forEach((sub, s) => {
        for (let i = 0; i < segmentCount(sub); i++) {
            const seg = segmentEnds(sub, i);
            if (!seg) continue;
            const steps = 32;
            for (let k = 0; k <= steps; k++) {
                const t = k / steps;
                const p = cubicAt(seg.a, seg.c1, seg.c2, seg.b, t);
                const q = toScreen(p);
                const d = Math.hypot(q.x - sx, q.y - sy);
                if (d < bestDist) {
                    bestDist = d;
                    best = { sub: s, index: i, t, point: p };
                }
            }
        }
    });
    return best;
}

// A world point in the vector's own placement space (before its rotation), where its path lives.
export function toVectorSpace(doc: NagmaDocument, node: SceneNode, world: Pt) {
    return apply(worldMatrix(doc, node).inverse(), world.x, world.y);
}

function withPath(subpaths: Subpath[]): NodePatch {
    const fitted = fitPath(subpaths);
    // Editing points turns a parametric polygon or star into a plain vector.
    return { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h, path: fitted.path, parametric: null };
}

// Moves every selected anchor (with handles) by a delta, or a single handle to a point.
export function moveVertices(node: SceneNode, refs: VertexRef[], delta: Pt, to: Pt, mirror: HandleMirror): NodePatch {
    const subs = placedSubpaths(node);
    const handle = refs.find((r) => r.part !== "anchor");
    if (handle && refs.length === 1) return moveHandle(subs, handle, to, mirror);
    refs = welded(subs, refs);
    for (const ref of refs) {
        if (ref.part !== "anchor") continue;
        const sub = subs[ref.sub];
        const point = sub?.points[ref.index];
        if (!sub || !point) continue;
        sub.points[ref.index] = {
            x: point.x + delta.x,
            y: point.y + delta.y,
            in: point.in ? { x: point.in.x + delta.x, y: point.in.y + delta.y } : null,
            out: point.out ? { x: point.out.x + delta.x, y: point.out.y + delta.y } : null,
        };
    }
    // Handles picked together (⇧click) move by the same amount, unless their point moved already.
    for (const ref of refs) {
        if (ref.part === "anchor" || refs.some((r) => r.part === "anchor" && r.sub === ref.sub && r.index === ref.index)) continue;
        const point = subs[ref.sub]?.points[ref.index];
        const h = point?.[ref.part];
        if (!point || !h) continue;
        (subs[ref.sub] as Subpath).points[ref.index] = { ...point, [ref.part]: { x: h.x + delta.x, y: h.y + delta.y } };
    }
    return withPath(subs);
}

// Points of a vector network that sit on the same spot are one point: moving one moves the others.
export function welded(subs: Subpath[], refs: VertexRef[]): VertexRef[] {
    const keys = new Set<string>();
    for (const r of refs) {
        const p = r.part === "anchor" ? subs[r.sub]?.points[r.index] : undefined;
        if (p) keys.add(weldKey(p));
    }
    if (!keys.size) return refs;
    const out = [...refs];
    subs.forEach((sub, s) =>
        sub.points.forEach((p, i) => {
            if (keys.has(weldKey(p)) && !out.some((r) => r.part === "anchor" && r.sub === s && r.index === i)) out.push({ sub: s, index: i, part: "anchor" });
        }),
    );
    return out;
}

function moveHandle(subs: Subpath[], ref: VertexRef, to: Pt, mirror: HandleMirror): NodePatch {
    const sub = subs[ref.sub];
    const point = sub?.points[ref.index];
    if (!sub || !point) return {};
    const other = ref.part === "in" ? point.out : point.in;
    let mirrored = other;
    if (other && mirror !== "none") {
        const len = mirror === "both" ? Math.hypot(to.x - point.x, to.y - point.y) : Math.hypot(other.x - point.x, other.y - point.y);
        const angle = Math.atan2(to.y - point.y, to.x - point.x) + Math.PI;
        mirrored = { x: point.x + Math.cos(angle) * len, y: point.y + Math.sin(angle) * len };
    }
    sub.points[ref.index] = ref.part === "in" ? { ...point, in: { ...to }, out: mirrored } : { ...point, out: { ...to }, in: mirrored };
    return withPath(subs);
}

// Double-click on an anchor: sharp corners get smooth handles along the neighbours, smooth points go sharp.
export function toggleSmooth(node: SceneNode, ref: VertexRef): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[ref.sub];
    const point = sub?.points[ref.index];
    if (!sub || !point) return {};
    sub.points[ref.index] = point.in || point.out ? { x: point.x, y: point.y, in: null, out: null } : smoothed(sub, ref.index);
    return withPath(subs);
}

function smoothed(sub: Subpath, index: number): PathPoint {
    const point = sub.points[index] as PathPoint;
    const n = sub.points.length;
    const prev = sub.points[(index - 1 + n) % n] ?? point;
    const next = sub.points[(index + 1) % n] ?? point;
    const dx = (next.x - prev.x) / 6;
    const dy = (next.y - prev.y) / 6;
    return { x: point.x, y: point.y, in: { x: point.x - dx, y: point.y - dy }, out: { x: point.x + dx, y: point.y + dy } };
}

// The bend tool: dragging an anchor pulls symmetric handles out of it; clicking a smooth point makes it sharp.
export function bendAnchor(node: SceneNode, ref: VertexRef, to: Pt): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[ref.sub];
    const point = sub?.points[ref.index];
    if (!sub || !point) return {};
    sub.points[ref.index] = { x: point.x, y: point.y, out: { ...to }, in: { x: 2 * point.x - to.x, y: 2 * point.y - to.y } };
    return withPath(subs);
}

// The bend tool dragged on a segment: both of its handles move so the curve passes through the
// pointer at the spot that was grabbed (straight segments grow handles). Empty when nothing moved.
export function bendSegment(node: SceneNode, subIndex: number, index: number, t: number, to: Pt): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[subIndex];
    const seg = sub ? segmentEnds(sub, index) : null;
    if (!sub || !seg) return {};
    const k = Math.min(0.85, Math.max(0.15, t));
    const at = cubicAt(seg.a, seg.c1, seg.c2, seg.b, k);
    const scale = 3 * k * (1 - k);
    const d = { x: (to.x - at.x) / scale, y: (to.y - at.y) / scale };
    if (Math.hypot(d.x, d.y) < 0.01) return {};
    const n = sub.points.length;
    const j = (index + 1) % n;
    sub.points[index] = { ...seg.a, out: { x: seg.c1.x + d.x, y: seg.c1.y + d.y } };
    const b = sub.points[j] as PathPoint;
    sub.points[j] = { ...b, in: { x: seg.c2.x + d.x, y: seg.c2.y + d.y } };
    return withPath(subs);
}

export function sharpen(node: SceneNode, ref: VertexRef): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[ref.sub];
    const point = sub?.points[ref.index];
    if (!sub || !point) return {};
    sub.points[ref.index] = { x: point.x, y: point.y, in: null, out: null };
    return withPath(subs);
}

// Removes the selected points. Plain delete takes a point out together with the two segments that
// met at it, so a closed path opens there and an open path splits in two (an end point just gets
// shorter); the neighbours keep their handles. With `heal` (⇧ ⌫) the neighbours are joined by one
// new segment instead, a closed path stays closed, and their handles are re-aimed so the curve runs
// smoothly across the gap. A point of the network that several paths pass through goes from all of
// them. Null when nothing is left.
export function deleteVertices(node: SceneNode, refs: VertexRef[], heal: boolean): NodePatch | null {
    const subs = placedSubpaths(node);
    const bySub = new Map<number, number[]>();
    for (const r of welded(subs, refs)) if (r.part === "anchor") bySub.set(r.sub, [...(bySub.get(r.sub) ?? []), r.index]);
    const out: Subpath[] = [];
    subs.forEach((sub, s) => {
        const indices = bySub.get(s);
        if (!indices?.length) return out.push(sub);
        const removed = new Set(indices);
        if (heal) {
            const n = sub.points.length;
            const touched = new Set<number>();
            for (const i of indices) {
                touched.add((i - 1 + n) % n);
                touched.add((i + 1) % n);
            }
            const kept: PathPoint[] = [];
            const keptTouched: number[] = [];
            sub.points.forEach((p, i) => {
                if (removed.has(i)) return;
                if (touched.has(i)) keptTouched.push(kept.length);
                kept.push(p);
            });
            sub.points = kept;
            for (const i of keptTouched) if (sub.points[i]) sub.points[i] = smoothed(sub, i);
            return out.push(sub);
        }
        // Without healing, the points between removed ones stay joined as they were: a closed path
        // is read from just after one removed point all the way round, so it opens there.
        const n = sub.points.length;
        const first = sub.closed ? (Math.min(...indices) + 1) % n : 0;
        const runs: PathPoint[][] = [[]];
        for (let k = 0; k < n; k++) {
            const i = (first + k) % n;
            if (removed.has(i)) {
                if (runs[runs.length - 1]!.length) runs.push([]);
                continue;
            }
            runs[runs.length - 1]!.push(sub.points[i] as PathPoint);
        }
        for (const run of runs) out.push({ closed: false, points: run });
    });
    const left = out.filter((s) => s.points.length >= 2);
    if (!left.length) return null;
    return withPath(left);
}

function isEndpoint(sub: Subpath, index: number) {
    return !sub.closed && (index === 0 || index === sub.points.length - 1);
}

// Joins two selected end points: of one open path (closing it) or of two paths (merging them). With
// `smooth` the joined points get handles so the seam curves. Null when the selection can't be joined.
export function joinVertices(node: SceneNode, refs: VertexRef[], smooth: boolean): NodePatch | null {
    const subs = placedSubpaths(node);
    const ends = refs.filter((r) => r.part === "anchor" && subs[r.sub] && isEndpoint(subs[r.sub] as Subpath, r.index));
    if (ends.length !== 2) return null;
    const [a, b] = ends as [VertexRef, VertexRef];
    if (a.sub === b.sub) {
        const sub = subs[a.sub] as Subpath;
        if (sub.points.length < 3) return null;
        sub.closed = true;
        if (smooth) {
            sub.points[0] = smoothed(sub, 0);
            sub.points[sub.points.length - 1] = smoothed(sub, sub.points.length - 1);
        }
        return withPath(subs);
    }
    const first = subs[a.sub] as Subpath;
    const second = subs[b.sub] as Subpath;
    // Orient both so the join happens at first's end and second's start.
    const pa = a.index === 0 ? [...first.points].reverse() : [...first.points];
    const pb = b.index === 0 ? [...second.points] : [...second.points].reverse();
    const flip = (p: PathPoint): PathPoint => ({ x: p.x, y: p.y, in: p.out, out: p.in });
    const merged: Subpath = { closed: false, points: [...(a.index === 0 ? pa.map(flip) : pa), ...(b.index === 0 ? pb : pb.map(flip))] };
    const seam = pa.length - 1;
    if (smooth) {
        merged.points[seam] = smoothed(merged, seam);
        merged.points[seam + 1] = smoothed(merged, seam + 1);
    }
    const rest = subs.filter((_, i) => i !== a.sub && i !== b.sub);
    return withPath([...rest, merged]);
}

// Splits a segment at t with de Casteljau, keeping the curve's shape, and returns the new point's index.
function insertAt(sub: Subpath, index: number, t: number): number {
    const seg = segmentEnds(sub, index);
    if (!seg) return index;
    const { a, b, c1, c2 } = seg;
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const curved = Boolean(a.out || b.in);
    const p01 = lerp(a, c1);
    const p12 = lerp(c1, c2);
    const p23 = lerp(c2, b);
    const p012 = lerp(p01, p12);
    const p123 = lerp(p12, p23);
    const mid = lerp(p012, p123);
    const nextIndex = (index + 1) % sub.points.length;
    // A handle that lands on its own anchor (the straight side of a half-curved segment) is no
    // handle: kept, it would sit on top of the anchor and take its clicks, and the point would
    // count as smooth.
    const handle = (h: Pt, at: Pt): Pt | null => (curved && Math.hypot(h.x - at.x, h.y - at.y) > 1e-9 ? h : null);
    sub.points[index] = { ...a, out: handle(p01, a) };
    sub.points[nextIndex] = { ...b, in: handle(p23, b) };
    const point: PathPoint = { x: mid.x, y: mid.y, in: handle(p012, mid), out: handle(p123, mid) };
    sub.points.splice(index + 1, 0, point);
    return index + 1;
}

// Adds an anchor on a segment (pen or bend click on the outline).
export function insertPoint(node: SceneNode, hit: SegmentHit): { patch: NodePatch; ref: VertexRef } | null {
    const subs = placedSubpaths(node);
    const sub = subs[hit.sub];
    if (!sub) return null;
    const index = insertAt(sub, hit.index, hit.t);
    return { patch: withPath(subs), ref: { sub: hit.sub, index, part: "anchor" } };
}

// The cut tool: the path opens at this spot. A closed path becomes open there; an open one splits in two.
export function cutAt(node: SceneNode, hit: SegmentHit): NodePatch | null {
    const subs = placedSubpaths(node);
    const sub = subs[hit.sub];
    if (!sub) return null;
    const index = insertAt(sub, hit.index, hit.t);
    const point = sub.points[index] as PathPoint;
    if (sub.closed) {
        const rotated = [...sub.points.slice(index), ...sub.points.slice(0, index + 1)];
        rotated[rotated.length - 1] = { ...point };
        subs[hit.sub] = { closed: false, points: rotated };
    } else {
        const head: Subpath = { closed: false, points: sub.points.slice(0, index + 1) };
        const tail: Subpath = { closed: false, points: sub.points.slice(index) };
        subs.splice(hit.sub, 1, head, tail);
    }
    return withPath(subs.filter((s) => s.points.length >= 2));
}

// The erase tool: the segment goes away. Null when nothing is left.
export function eraseSegment(node: SceneNode, hit: SegmentHit): NodePatch | null {
    const subs = placedSubpaths(node);
    const sub = subs[hit.sub];
    if (!sub) return null;
    if (sub.closed) {
        const n = sub.points.length;
        const start = (hit.index + 1) % n;
        const rotated = Array.from({ length: n }, (_, k) => sub.points[(start + k) % n] as PathPoint);
        subs[hit.sub] = { closed: false, points: rotated };
    } else {
        const head: Subpath = { closed: false, points: sub.points.slice(0, hit.index + 1) };
        const tail: Subpath = { closed: false, points: sub.points.slice(hit.index + 1) };
        subs.splice(hit.sub, 1, head, tail);
    }
    const left = subs.filter((s) => s.points.length >= 2);
    if (!left.length) return null;
    return withPath(left);
}

// The anchors inside a screen rectangle, or inside a lasso polygon.
export function verticesInRect(doc: NagmaDocument, node: SceneNode, camera: Camera, rect: { x: number; y: number; w: number; h: number }): VertexRef[] {
    return screenVertices(doc, node, camera, [])
        .filter((v) => v.part === "anchor" && v.x >= rect.x && v.x <= rect.x + rect.w && v.y >= rect.y && v.y <= rect.y + rect.h)
        .map(({ sub, index }) => ({ sub, index, part: "anchor" as const }));
}

export function verticesInLasso(doc: NagmaDocument, node: SceneNode, camera: Camera, polygon: Pt[]): VertexRef[] {
    if (polygon.length < 3) return [];
    const inside = (p: Pt) => {
        let hit = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i] as Pt;
            const b = polygon[j] as Pt;
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
        }
        return hit;
    };
    return screenVertices(doc, node, camera, [])
        .filter((v) => v.part === "anchor" && inside(v))
        .map(({ sub, index }) => ({ sub, index, part: "anchor" as const }));
}

// Lines the selected points up on one edge or centre.
export function alignVertices(node: SceneNode, refs: VertexRef[], how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"): NodePatch {
    const subs = placedSubpaths(node);
    const picked = refs.filter((r) => r.part === "anchor").map((r) => ({ r, p: subs[r.sub]?.points[r.index] })).filter((x): x is { r: VertexRef; p: PathPoint } => Boolean(x.p));
    if (picked.length < 2) return {};
    const xs = picked.map((x) => x.p.x);
    const ys = picked.map((x) => x.p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (const { r, p } of picked) {
        const target = how === "left" ? { x: minX } : how === "right" ? { x: maxX } : how === "hcenter" ? { x: (minX + maxX) / 2 } : how === "top" ? { y: minY } : how === "bottom" ? { y: maxY } : { y: (minY + maxY) / 2 };
        const dx = target.x !== undefined ? target.x - p.x : 0;
        const dy = target.y !== undefined ? target.y - p.y : 0;
        (subs[r.sub] as Subpath).points[r.index] = { x: p.x + dx, y: p.y + dy, in: p.in ? { x: p.in.x + dx, y: p.in.y + dy } : null, out: p.out ? { x: p.out.x + dx, y: p.out.y + dy } : null };
    }
    return withPath(subs);
}

// The position of a single selected point, in the layer's parent space.
export function vertexPosition(node: SceneNode, ref: VertexRef): Pt | null {
    const sub = placedSubpaths(node)[ref.sub];
    const p = sub?.points[ref.index];
    return p ? { x: p.x, y: p.y } : null;
}

export function setVertexPosition(node: SceneNode, ref: VertexRef, to: Pt): NodePatch {
    const at = vertexPosition(node, ref);
    if (!at) return {};
    return moveVertices(node, [{ ...ref, part: "anchor" }], { x: to.x - at.x, y: to.y - at.y }, to, "none");
}

// Pen helpers.

// Adds a point to the end of the path being drawn (in the vector's placement space).
export function appendPoint(node: SceneNode, point: PathPoint): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[subs.length - 1];
    if (!sub) return withPath([{ closed: false, points: [point] }]);
    sub.points.push(point);
    return withPath(subs);
}

// Sets the handles of the last point while the pen is dragged: out towards the pointer, in mirrored.
export function shapeLastPoint(node: SceneNode, drag: Pt): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[subs.length - 1];
    const point = sub?.points[sub.points.length - 1];
    if (!sub || !point) return {};
    sub.points[sub.points.length - 1] = { x: point.x, y: point.y, out: { ...drag }, in: { x: 2 * point.x - drag.x, y: 2 * point.y - drag.y } };
    return withPath(subs);
}

// Backspace while drawing: the last point placed comes off again (a path left with no points goes too).
// Null when there is nothing to remove.
export function removeLastPoint(node: SceneNode): NodePatch | null {
    const subs = placedSubpaths(node);
    const sub = subs[subs.length - 1];
    if (!sub || !sub.points.length) return null;
    sub.points.pop();
    if (!sub.points.length) subs.pop();
    return subs.length ? withPath(subs) : null;
}

export function closeLastSubpath(node: SceneNode): NodePatch {
    const subs = placedSubpaths(node);
    const sub = subs[subs.length - 1];
    if (sub) sub.closed = true;
    return withPath(subs);
}

// Picks up an open path at one of its ends so the pen continues it: that subpath moves last, and is
// reversed when the start was clicked, so appending extends from the clicked end.
export function continueFrom(node: SceneNode, ref: VertexRef): NodePatch | null {
    const subs = placedSubpaths(node);
    const sub = subs[ref.sub];
    if (!sub || !isEndpoint(sub, ref.index)) return null;
    const flip = (p: PathPoint): PathPoint => ({ x: p.x, y: p.y, in: p.out, out: p.in });
    const picked: Subpath = ref.index === 0 ? { closed: false, points: [...sub.points].reverse().map(flip) } : sub;
    const rest = subs.filter((_, i) => i !== ref.sub);
    return withPath([...rest, picked]);
}

// Begins another subpath in an existing vector (pen while editing).
export function startSubpath(node: SceneNode, at: Pt): NodePatch {
    const subs = placedSubpaths(node);
    subs.push({ closed: false, points: [{ x: at.x, y: at.y, in: null, out: null }] });
    return withPath(subs);
}

// A brand-new vector's path from its first point.
export function firstPoint(at: Pt): NodePatch {
    return withPath([{ closed: false, points: [{ x: at.x, y: at.y, in: null, out: null }] }]);
}

// Snaps a pen point to 45° steps from the previous one.
export function constrainAngle(from: Pt, to: Pt): Pt {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

// Kept for callers that edit one point at a time.
export function moveVertex(node: SceneNode, ref: VertexRef, to: Pt, breakHandles: boolean): NodePatch {
    const at = vertexPosition(node, ref);
    if (!at) return {};
    return moveVertices(node, [ref], { x: to.x - at.x, y: to.y - at.y }, to, breakHandles ? "none" : "angle");
}

export function deleteVertex(node: SceneNode, ref: VertexRef): NodePatch | null {
    return deleteVertices(node, [ref], false);
}

function containsIn(subs: Subpath[], i: number, p: Pt): boolean {
    const sub = subs[i];
    if (!sub || !sub.closed) return false;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return false;
    const path = new Path2D();
    const first = sub.points[0];
    if (!first) return false;
    path.moveTo(first.x, first.y);
    for (let k = 0; k < sub.points.length; k++) {
        const a = sub.points[k] as PathPoint;
        const b = sub.points[(k + 1) % sub.points.length] as PathPoint;
        if (!a.out && !b.in) path.lineTo(b.x, b.y);
        else path.bezierCurveTo((a.out ?? a).x, (a.out ?? a).y, (b.in ?? b).x, (b.in ?? b).y, b.x, b.y);
    }
    path.closePath();
    return probe.isPointInPath(path, p.x, p.y, "nonzero");
}

// ---- Region tools: shape builder drag and extract, cut across, split ------------------------

// The closed regions (subpaths) under a point, in the vector's placement space.
export function regionsAt(node: SceneNode, p: Pt): number[] {
    const subs = placedSubpaths(node);
    return subs.map((_, i) => i).filter((i) => containsIn(subs, i, p));
}

// Shape builder on release: ⌥ removes the regions, two or more merge, one alone is extracted to
// a layer of its own. `extracted` is the region for that new layer.
export function builderApply(node: SceneNode, hits: number[], remove: boolean): { patch: NodePatch | null; extracted: Subpath[] | null } {
    const subs = placedSubpaths(node);
    const picked = [...new Set(hits)].filter((i) => subs[i]);
    if (!picked.length) return { patch: {}, extracted: null };
    const rest = subs.filter((_, i) => !picked.includes(i));
    if (remove) return { patch: rest.length ? withPath(rest) : null, extracted: null };
    if (picked.length >= 2) {
        const merged = booleanPaths("union", picked.map((i) => [subs[i] as Subpath]));
        return { patch: merged.length ? withPath([...rest, ...merged]) : {}, extracted: null };
    }
    if (!rest.length) return { patch: {}, extracted: null };
    return { patch: withPath(rest), extracted: [subs[picked[0] as number] as Subpath] };
}

// Cut tool dragged across a shape: the closed regions split along the line; the far side becomes
// its own layer. Null when the line crosses nothing.
export function cutAcross(node: SceneNode, a: Pt, b: Pt): { keep: NodePatch; cutOff: Subpath[] } | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const subs = placedSubpaths(node);
    const closed = subs.filter((s) => s.closed);
    if (!closed.length) return null;
    // Two huge half planes either side of the line.
    const ux = dx / len;
    const uy = dy / len;
    const far = 1e6;
    const p0 = { x: a.x - ux * far, y: a.y - uy * far };
    const p1 = { x: a.x + ux * far, y: a.y + uy * far };
    const side = (s: number): Subpath => ({
        closed: true,
        points: [p0, p1, { x: p1.x - uy * far * s, y: p1.y + ux * far * s }, { x: p0.x - uy * far * s, y: p0.y + ux * far * s }].map((q) => ({ x: q.x, y: q.y, in: null, out: null })),
    });
    const left = booleanPaths("intersect", [closed, [side(1)]]);
    const right = booleanPaths("intersect", [closed, [side(-1)]]);
    if (!left.length || !right.length) return null;
    const open = subs.filter((s) => !s.closed);
    return { keep: withPath([...open, ...left]), cutOff: right };
}

// Split vector: each separate path becomes its own layer; closed paths inside another (holes)
// stay with it.
export function splitGroups(node: SceneNode): Subpath[][] {
    const subs = placedSubpaths(node);
    if (subs.length < 2) return [];
    const owner = subs.map((sub, i) => {
        if (!sub.closed) return i;
        const first = sub.points[0];
        if (!first) return i;
        const host = subs.findIndex((other, j) => j !== i && other.closed && containsIn(subs, j, first) && !containsIn(subs, i, other.points[0] ?? first));
        return host >= 0 ? host : i;
    });
    const groups = new Map<number, Subpath[]>();
    subs.forEach((sub, i) => {
        // A hole follows its outermost host.
        let root = owner[i] ?? i;
        for (let guard = 0; guard < 8 && owner[root] !== root; guard++) root = owner[root] ?? root;
        groups.set(root, [...(groups.get(root) ?? []), sub]);
    });
    return groups.size > 1 ? [...groups.values()] : [];
}

// A vector layer from placed subpaths, styled like `like`.
export function vectorFrom(like: SceneNode, subs: Subpath[], id: string, name = like.name): SceneNode {
    const fitted = fitPath(subs);
    return { ...like, id, name, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h, path: fitted.path, parametric: null, children: [], interactions: undefined, flowStart: undefined };
}

// Snap to geometry: a dragged point (world space) lands on the nearest point of another layer, or
// another point of its own, within 6 screen px. Null when none is that close.
export function geometrySnap(doc: NagmaDocument, editing: SceneNode, refs: VertexRef[], world: Pt, zoom: number): Pt | null {
    const limit = 6 / Math.max(zoom, 0.01);
    let best: Pt | null = null;
    let bestD = limit;
    const consider = (p: Pt) => {
        const d = Math.hypot(p.x - world.x, p.y - world.y);
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    };
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "vector" && node.type !== "rect" && node.type !== "ellipse" && node.type !== "frame") continue;
        if (!isEffectivelyVisible(doc, node)) continue;
        const b = worldBounds(doc, node);
        if (world.x < b.x - limit || world.y < b.y - limit || world.x > b.x + b.w + limit || world.y > b.y + b.h + limit) continue;
        const m = worldMatrix(doc, node);
        const subs = node.type === "vector" ? placedSubpaths(node) : node.type === "frame" ? [{ closed: true, points: [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y }, { x: node.x + node.w, y: node.y + node.h }, { x: node.x, y: node.y + node.h }].map((q) => ({ ...q, in: null, out: null })) }] : shapeSubpaths(node);
        subs.forEach((sub, si) => {
            sub.points.forEach((p, pi) => {
                if (node.id === editing.id && refs.some((r) => r.sub === si && r.index === pi)) return;
                consider(apply(m, p.x, p.y));
            });
        });
    }
    return best;
}
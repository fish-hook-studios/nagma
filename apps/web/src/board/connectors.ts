import { editor } from "../engine/store";
import { apply, spaceMatrix, worldBounds } from "../engine/transform";
import type { Command, NagmaDocument, PathPoint, Rect, SceneNode } from "../engine/types";
import type { ConnectorEnd, JamData, Side } from "./types";

// Connectors: where each end sits (on a side of the layer it's attached to, or loose), the route
// between the ends (elbowed, curved or straight), and keeping stored routes in step when the
// layers they join move.

type Connector = Extract<JamData, { kind: "connector" }>;
export interface Pt {
    x: number;
    y: number;
}
interface Placed extends Pt {
    // Outward direction from the layer (unit vector), or null for a loose end.
    dir: Pt | null;
}

const DIRS: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

export function sidePoint(box: Rect, side: Side): Pt {
    if (side === "top") return { x: box.x + box.w / 2, y: box.y };
    if (side === "bottom") return { x: box.x + box.w / 2, y: box.y + box.h };
    if (side === "left") return { x: box.x, y: box.y + box.h / 2 };
    return { x: box.x + box.w, y: box.y + box.h / 2 };
}

// The side of `box` that faces `toward`.
export function facingSide(box: Rect, toward: Pt): Side {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = (toward.x - cx) / Math.max(box.w, 1);
    const dy = (toward.y - cy) / Math.max(box.h, 1);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "bottom" : "top";
}

// The side of `box` closest to a point on or near it.
export function nearestSide(box: Rect, p: Pt): Side {
    const d: [Side, number][] = [
        ["top", Math.abs(p.y - box.y)],
        ["bottom", Math.abs(p.y - (box.y + box.h))],
        ["left", Math.abs(p.x - box.x)],
        ["right", Math.abs(p.x - (box.x + box.w))],
    ];
    d.sort((a, b) => a[1] - b[1]);
    return d[0]?.[0] ?? "right";
}

function attachedBox(doc: NagmaDocument, end: ConnectorEnd): Rect | null {
    const node = end.id ? doc.nodes[end.id] : undefined;
    return node && node.visible ? worldBounds(doc, node) : null;
}

function rough(doc: NagmaDocument, end: ConnectorEnd): Pt {
    const box = attachedBox(doc, end);
    return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: end.x, y: end.y };
}

function place(doc: NagmaDocument, end: ConnectorEnd, other: Pt): Placed {
    const box = attachedBox(doc, end);
    if (!box) return { x: end.x, y: end.y, dir: null };
    if (end.center) {
        // Aimed at the centre: where the line toward the other end leaves the box.
        const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
        const dx = other.x - c.x;
        const dy = other.y - c.y;
        const t = Math.min(Math.abs(dx) > 1e-6 ? box.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? box.h / 2 / Math.abs(dy) : Infinity);
        return Number.isFinite(t) ? { x: c.x + dx * t, y: c.y + dy * t, dir: null } : { ...c, dir: null };
    }
    if (end.at) {
        const p = { x: box.x + end.at.u * box.w, y: box.y + end.at.v * box.h };
        return { ...p, dir: DIRS[nearestSide(box, p)] };
    }
    const side = end.side ?? facingSide(box, other);
    return { ...sidePoint(box, side), dir: DIRS[side] };
}

export interface Route {
    // World points. Curved routes are one cubic: [start, c1, c2, end].
    points: Pt[];
    curved: boolean;
    start: Placed;
    end: Placed;
    // Where the path can be dragged to reshape it (an elbow's middle run, a curve's middle), and
    // along which axis ("x": the run moves sideways; "y": up and down; "n": a curve bows).
    handle?: { at: Pt; axis: "x" | "y" | "n" };
}

export function routeOf(doc: NagmaDocument, jam: Connector): Route {
    const a0 = rough(doc, jam.start);
    const b0 = rough(doc, jam.end);
    const start = place(doc, jam.start, b0);
    const end = place(doc, jam.end, a0);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    if (jam.line === "straight") return { points: [start, end], curved: false, start, end };
    if (jam.line === "curved") {
        const k = Math.max(30, dist / 2.4);
        const toward = (from: Placed, to: Pt): Pt => from.dir ?? { x: (to.x - from.x) / Math.max(dist, 1), y: (to.y - from.y) / Math.max(dist, 1) };
        const da = toward(start, end);
        const db = toward(end, start);
        // A dragged curve bows out by `bend` across the line between its ends.
        const n = { x: -(end.y - start.y) / Math.max(dist, 1), y: (end.x - start.x) / Math.max(dist, 1) };
        const bend = jam.bend ?? 0;
        const points = [start, { x: start.x + da.x * k + n.x * bend, y: start.y + da.y * k + n.y * bend }, { x: end.x + db.x * k + n.x * bend, y: end.y + db.y * k + n.y * bend }, end];
        const route: Route = { points, curved: true, start, end };
        return { ...route, handle: { at: pointAlong(route, 0.5), axis: "n" } };
    }
    if (jam.coords && jam.axis) return { points: customElbow(start, end, jam.axis, jam.coords), curved: false, start, end };
    const bent = elbow(start, end, jam.mid);
    return { points: bent.points, curved: false, start, end, handle: bent.handle };
}

// An elbowed path with dragged segments: from `a` along `axis` to each stored position in turn
// (turning at each), then across to `b`'s line and into `b`.
function customElbow(a: Pt, b: Pt, axis: "h" | "v", coords: number[]): Pt[] {
    const pts: Pt[] = [{ x: a.x, y: a.y }];
    let p: Pt = a;
    let h = axis === "h";
    for (const c of coords) {
        p = h ? { x: c, y: p.y } : { x: p.x, y: c };
        pts.push(p);
        h = !h;
    }
    pts.push(h ? { x: b.x, y: p.y } : { x: p.x, y: b.y });
    pts.push({ x: b.x, y: b.y });
    return simplify(pts);
}

// An elbowed route as a dragged path: the axis of its first segment and its inner segments' positions.
export function elbowCoords(points: Pt[]): { axis: "h" | "v"; coords: number[] } {
    const horizontal = (a: Pt, b: Pt) => Math.abs(a.y - b.y) < 0.01;
    const first = points[0] as Pt;
    const second = (points[1] ?? first) as Pt;
    const axis = horizontal(first, second) && Math.abs(first.x - second.x) > 0.01 ? "h" : "v";
    const coords: number[] = [];
    for (let i = 1; i < points.length - 2; i++) {
        const prev = points[i - 1] as Pt;
        const p = points[i] as Pt;
        coords.push(horizontal(prev, p) ? p.x : p.y);
    }
    return { axis, coords };
}

// The segments of an elbowed route: each one's middle and which way it can be dragged ("x": a
// vertical segment moves sideways; "y": a horizontal one moves up and down).
export function elbowSegments(route: Route): { index: number; at: Pt; axis: "x" | "y"; length: number }[] {
    if (route.curved) return [];
    const out: { index: number; at: Pt; axis: "x" | "y"; length: number }[] = [];
    for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i] as Pt;
        const b = route.points[i + 1] as Pt;
        out.push({ index: i, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, axis: Math.abs(a.y - b.y) < 0.01 ? "y" : "x", length: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    return out;
}

// The path after segment `index` of an elbowed route is dragged to `w`. Inner segments just move;
// the first and last keep a short stub on their object and add a jog (new segments) to reach `w`.
export function dragSegment(route: Route, index: number, w: Pt): { axis: "h" | "v"; coords: number[] } {
    const pts = route.points;
    const { axis, coords } = elbowCoords(pts);
    const n = pts.length - 1;
    const a = pts[0] as Pt;
    const b = pts[n] as Pt;
    const seg = elbowSegments(route)[index];
    if (!seg) return { axis, coords };
    const value = seg.axis === "x" ? w.x : w.y;
    const stub = 24;
    const toward = (from: number, to: number) => Math.sign(to - from) || 1;
    if (index === 0) {
        // Leaving the start: keep a stub, then turn to the dragged line and back (and, on a single
        // straight run, a stub into the end too).
        const next = pts[1] as Pt;
        const stubAt = axis === "h" ? a.x + toward(a.x, next.x) * stub : a.y + toward(a.y, next.y) * stub;
        if (n === 1) return { axis, coords: [stubAt, value, axis === "h" ? b.x - toward(a.x, b.x) * stub : b.y - toward(a.y, b.y) * stub] };
        return { axis, coords: [stubAt, value, ...coords] };
    }
    if (index === n - 1) {
        // Arriving at the end: turn to the dragged line, then a stub into the end.
        const prev = pts[n - 1] as Pt;
        const stubAt = seg.axis === "x" ? b.y - toward(prev.y, b.y) * stub : b.x - toward(prev.x, b.x) * stub;
        return { axis, coords: [...coords, value, stubAt] };
    }
    // An inner segment is set by the corner that starts it.
    const next = [...coords];
    next[index - 1] = value;
    return { axis, coords: next };
}

// An orthogonal route that leaves and enters along the ends' directions.
function elbow(a: Placed, b: Placed, at?: number): { points: Pt[]; handle?: Route["handle"] } {
    const gap = 24;
    const da = a.dir ?? (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: Math.sign(b.x - a.x) || 1, y: 0 } : { x: 0, y: Math.sign(b.y - a.y) || 1 });
    const db = b.dir ?? { x: -da.x, y: -da.y };
    const a1 = { x: a.x + da.x * gap, y: a.y + da.y * gap };
    const b1 = { x: b.x + db.x * gap, y: b.y + db.y * gap };
    const horizA = da.x !== 0;
    const horizB = db.x !== 0;
    let mid: Pt[];
    if (horizA && horizB) {
        // Facing each other with room between: one vertical run halfway.
        const forward = Math.sign(b.x - a.x) === da.x && Math.sign(a.x - b.x) === db.x;
        if (forward) {
            // The vertical run sits `at` of the way across (half way unless dragged).
            const mx = a.x + (b.x - a.x) * (at ?? 0.5);
            mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
            return { points: simplify([a, ...mid, b]), handle: { at: { x: mx, y: (a.y + b.y) / 2 }, axis: "x" } };
        } else if (da.x === db.x) {
            const x = da.x > 0 ? Math.max(a1.x, b1.x) : Math.min(a1.x, b1.x);
            mid = [{ x, y: a.y }, { x, y: b.y }];
        } else {
            const my = (a.y + b.y) / 2;
            mid = [a1, { x: a1.x, y: my }, { x: b1.x, y: my }, b1];
        }
    } else if (!horizA && !horizB) {
        const forward = Math.sign(b.y - a.y) === da.y && Math.sign(a.y - b.y) === db.y;
        if (forward) {
            const my = a.y + (b.y - a.y) * (at ?? 0.5);
            mid = [{ x: a.x, y: my }, { x: b.x, y: my }];
            return { points: simplify([a, ...mid, b]), handle: { at: { x: (a.x + b.x) / 2, y: my }, axis: "y" } };
        } else if (da.y === db.y) {
            const y = da.y > 0 ? Math.max(a1.y, b1.y) : Math.min(a1.y, b1.y);
            mid = [{ x: a.x, y }, { x: b.x, y }];
        } else {
            const mx = (a.x + b.x) / 2;
            mid = [a1, { x: mx, y: a1.y }, { x: mx, y: b1.y }, b1];
        }
    } else if (horizA) {
        // Out sideways, in from above or below: one corner when both legs point the right way.
        const corner = { x: b.x, y: a.y };
        const ok = Math.sign(corner.x - a.x) === da.x && Math.sign(corner.y - b.y) === db.y;
        mid = ok ? [corner] : [a1, { x: a1.x, y: b1.y }, b1];
    } else {
        const corner = { x: a.x, y: b.y };
        const ok = Math.sign(corner.y - a.y) === da.y && Math.sign(corner.x - b.x) === db.x;
        mid = ok ? [corner] : [a1, { x: b1.x, y: a1.y }, b1];
    }
    return { points: simplify([a, ...mid, b]) };
}

function simplify(points: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
        const prev = out[out.length - 2];
        if (prev && last && ((Math.abs(prev.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) || (Math.abs(prev.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01))) out[out.length - 1] = { x: p.x, y: p.y };
        else out.push({ x: p.x, y: p.y });
    }
    return out;
}

// The point halfway along a route (for the label).
export function midpoint(route: Route): Pt {
    return pointAlong(route, 0.5);
}

// The point a fraction `t` of the way along a route.
export function pointAlong(route: Route, t: number): Pt {
    const pts = route.points;
    if (route.curved) {
        const [p0, p1, p2, p3] = pts as [Pt, Pt, Pt, Pt];
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
    }
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).y - (pts[i - 1] as Pt).y);
    let left = total * Math.max(0, Math.min(1, t));
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1] as Pt;
        const b = pts[i] as Pt;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (left <= len && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
        left -= len;
    }
    return pts[0] ?? { x: 0, y: 0 };
}

// The fraction along a route nearest to a point (sampled), kept clear of the very ends.
export function nearestAlong(route: Route, p: Pt): number {
    let best = 0.5;
    let dist = Infinity;
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const q = pointAlong(route, t);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < dist) {
            dist = d;
            best = t;
        }
    }
    return Math.max(0.08, Math.min(0.92, best));
}

// The stored box and path for a route, in the connector's parent space.
export function geometryFor(doc: NagmaDocument, node: SceneNode, route: Route): Partial<SceneNode> {
    const m = spaceMatrix(doc, node.parentId).inverse();
    const local = route.points.map((p) => apply(m, p.x, p.y));
    const xs = local.map((p) => p.x);
    const ys = local.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x);
    const h = Math.max(1, Math.max(...ys) - y);
    let points: PathPoint[];
    if (route.curved) {
        const [p0, p1, p2, p3] = local as [Pt, Pt, Pt, Pt];
        points = [
            { x: p0.x - x, y: p0.y - y, in: null, out: { x: p1.x - x, y: p1.y - y } },
            { x: p3.x - x, y: p3.y - y, in: { x: p2.x - x, y: p2.y - y }, out: null },
        ];
    } else points = local.map((p) => ({ x: p.x - x, y: p.y - y, in: null, out: null }));
    return { x, y, w, h, rotation: 0, path: { w, h, subpaths: [{ closed: false, points }] } };
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.5;

// The first and last points of a connector's stored line, in world space.
export function storedEnds(doc: NagmaDocument, node: SceneNode): [Pt, Pt] | null {
    const path = node.path;
    const pts = path?.subpaths[0]?.points;
    if (!path || !pts || pts.length < 2) return null;
    const m = spaceMatrix(doc, node.parentId);
    const at = (p: PathPoint) => apply(m, node.x + (p.x * node.w) / Math.max(path.w, 1e-6), node.y + (p.y * node.h) / Math.max(path.h, 1e-6));
    return [at(pts[0] as PathPoint), at(pts[pts.length - 1] as PathPoint)];
}

// Updates for connectors whose stored route no longer matches the layers they join, and for ends
// whose layer was deleted (they stay where they were, loose).
export function rerouteCommands(doc: NagmaDocument): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(doc.nodes)) {
        if (node.jam?.kind !== "connector") continue;
        let jam = node.jam;
        for (const key of ["start", "end"] as const) {
            const e = jam[key];
            if (e.id && !doc.nodes[e.id]) jam = { ...jam, [key]: { id: null, side: null, x: e.x, y: e.y } };
        }
        // Loose ends go where the stored line's ends are now (the connector was moved or resized).
        const stored = storedEnds(doc, node);
        if (stored) {
            if (!jam.start.id) jam = { ...jam, start: { ...jam.start, ...stored[0] } };
            if (!jam.end.id) jam = { ...jam, end: { ...jam.end, ...stored[1] } };
        }
        const route = routeOf(doc, jam);
        // Loose-end coordinates follow the placed ends too, so a later detach keeps the spot.
        const startEnd = { ...jam.start, x: route.start.x, y: route.start.y };
        const endEnd = { ...jam.end, x: route.end.x, y: route.end.y };
        jam = { ...jam, start: startEnd, end: endEnd };
        const geo = geometryFor(doc, node, route);
        const path = node.path;
        const samePath = path && geo.path && JSON.stringify(path.subpaths.map((s) => s.points.map((p) => [Math.round(p.x), Math.round(p.y)]))) === JSON.stringify(geo.path.subpaths.map((s) => s.points.map((p) => [Math.round(p.x), Math.round(p.y)])));
        const sameEnds = close(jam.start.x, (node.jam as Connector).start.x) && close(jam.start.y, (node.jam as Connector).start.y) && close(jam.end.x, (node.jam as Connector).end.x) && close(jam.end.y, (node.jam as Connector).end.y) && jam.start.id === (node.jam as Connector).start.id && jam.end.id === (node.jam as Connector).end.id;
        if (samePath && sameEnds && close(geo.x ?? 0, node.x) && close(geo.y ?? 0, node.y) && close(geo.w ?? 0, node.w) && close(geo.h ?? 0, node.h)) continue;
        commands.push({ type: "node.update", id: node.id, patch: { ...geo, jam } });
    }
    return commands;
}

// Other board fixes that follow an edit in the same undo step (a sticky growing with its text).
export const postEditFixes: ((before: NagmaDocument, after: NagmaDocument) => Command[])[] = [];

// After each of your edits on a board, connectors catch up with the layers they join, folded into
// the same undo step.
let scheduled = false;
let before: NagmaDocument | null = null;
editor.onCommit((prev, after) => {
    if (!after.board) return;
    if (!scheduled) before = prev;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
        scheduled = false;
        const s = editor.get();
        if (!s.doc.board || s.readOnly || !before) return;
        // Only fold into the edit that caused this (not an undo or redo, which restore matching routes).
        const fromEdit = s.past.at(-1)?.after === editor.committed();
        // The other fixes answer your edits only: an undo that moves a sticky back over a mind map
        // topic isn't a drop (it made a branch, as a new step that also cost the redo).
        const commands = [...rerouteCommands(editor.committed()), ...newObjectFixes(before, editor.committed()), ...(fromEdit ? postEditFixes.flatMap((fix) => (before ? fix(before, editor.committed()) : [])) : [])];
        if (!commands.length) return;
        editor.execute({ type: "batch", commands });
        if (fromEdit) editor.mergeLast();
    });
});

// The route as drawn right now: attached ends follow their layers (even mid-drag), loose ends
// follow the connector's own line.
export function liveRoute(doc: NagmaDocument, node: SceneNode): Route | null {
    if (node.jam?.kind !== "connector") return null;
    let jam = node.jam;
    const stored = storedEnds(doc, node);
    if (stored) {
        if (!jam.start.id || !doc.nodes[jam.start.id]) jam = { ...jam, start: { ...jam.start, id: null, ...stored[0] } };
        if (!jam.end.id || !doc.nodes[jam.end.id]) jam = { ...jam, end: { ...jam.end, id: null, ...stored[1] } };
    }
    return routeOf(doc, jam);
}

// New sections on a board get a board section's white fill and soft outline (so they show on the
// white board), and new pages the board's white. A new section also goes behind the other objects
// beside it (above other sections only): sections sit at the back of a board, so their opaque fill
// never hides a connector or a sticky it only partly covers.
export function newObjectFixes(before: NagmaDocument, after: NagmaDocument): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(after.nodes)) {
        if (before.nodes[node.id]) continue;
        const fill = node.fills[0];
        const faint = !fill || (fill.type === "solid" && fill.opacity < 0.2);
        if (node.isSection && faint) commands.push({ type: "node.update", id: node.id, patch: { fills: [{ type: "solid", color: "#FFFFFF", opacity: 1, visible: true, blend: "normal" }], strokes: [{ type: "solid", color: "#D9D9D9", opacity: 1, visible: true, blend: "normal" }], strokeWidth: 1, radius: 8 } });
        if (node.isSection && node.parentId) {
            const siblings = after.nodes[node.parentId]?.children ?? [];
            const at = siblings.indexOf(node.id);
            const others = siblings.filter((id) => id !== node.id);
            const firstObject = others.findIndex((id) => !after.nodes[id]?.isSection);
            if (firstObject >= 0 && firstObject < at) commands.push({ type: "node.reparent", id: node.id, parentId: node.parentId, index: firstObject });
        }
        if (node.type === "page" && !node.fills.length) commands.push({ type: "node.update", id: node.id, patch: { fills: [{ type: "solid", color: "#FFFFFF", opacity: 1, visible: true, blend: "normal" }] } });
    }
    return commands;
}

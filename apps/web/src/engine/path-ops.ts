import { booleanPaths } from "./clip";
import { hull } from "./eraser";
import { makeNode } from "./nodes";
import { simplify } from "./shapes";
import { editor } from "./store";
import type { Command, NagmaDocument, NodePatch, PathPoint, SceneNode, Subpath } from "./types";
import { fitPath, placedSubpaths, samplePath, shapeSubpaths } from "./vector";

// Offset path and Simplify path: geometry on a layer's placed subpaths (its parent's space).

type Pt = { x: number; y: number };
export type OffsetJoin = "miter" | "round" | "bevel";

// A subpath as a polyline without repeated points (a closed one doesn't repeat its first point).
function polyline(sub: Subpath, steps = 16): Pt[] {
    const pts = samplePath([sub], steps)[0] ?? [];
    const out: Pt[] = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
    }
    if (sub.closed && out.length > 1) {
        const first = out[0] as Pt;
        const last = out[out.length - 1] as Pt;
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) out.pop();
    }
    return out;
}

const poly = (pts: Pt[]): Subpath => ({ closed: true, points: pts.map((p) => ({ x: p.x, y: p.y, in: null, out: null })) });

function normal(a: Pt, b: Pt): Pt {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

// The area within `r` of a polyline: a band per segment, joined at the corners in the chosen style.
function band(line: Pt[], closed: boolean, r: number, join: OffsetJoin, miterLimit: number): Subpath[] {
    const pieces: Subpath[][] = [];
    const n = line.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        const a = line[i] as Pt;
        const b = line[(i + 1) % n] as Pt;
        const m = normal(a, b);
        pieces.push([poly([{ x: a.x + m.x * r, y: a.y + m.y * r }, { x: b.x + m.x * r, y: b.y + m.y * r }, { x: b.x - m.x * r, y: b.y - m.y * r }, { x: a.x - m.x * r, y: a.y - m.y * r }])]);
    }
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
        const p = line[i] as Pt;
        const prev = line[(i - 1 + n) % n] as Pt;
        const next = line[(i + 1) % n] as Pt;
        const n1 = normal(prev, p);
        const n2 = normal(p, next);
        if (Math.hypot(n1.x - n2.x, n1.y - n2.y) < 1e-3) continue;
        if (join === "round") {
            const ring: Pt[] = [];
            for (let k = 0; k < 24; k++) ring.push({ x: p.x + Math.cos((k / 24) * Math.PI * 2) * r, y: p.y + Math.sin((k / 24) * Math.PI * 2) * r });
            pieces.push([poly(ring)]);
            continue;
        }
        const corners: Pt[] = [p, { x: p.x + n1.x * r, y: p.y + n1.y * r }, { x: p.x + n2.x * r, y: p.y + n2.y * r }, { x: p.x - n1.x * r, y: p.y - n1.y * r }, { x: p.x - n2.x * r, y: p.y - n2.y * r }];
        if (join === "miter") {
            // The miter tip along the bisector, while it stays within the limit (a bevel past it).
            const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
            const len = Math.hypot(bis.x, bis.y);
            const cosHalf = len / 2;
            if (len > 1e-6 && 1 / cosHalf <= miterLimit) {
                const k = r / cosHalf / len;
                corners.push({ x: p.x + bis.x * k, y: p.y + bis.y * k }, { x: p.x - bis.x * k, y: p.y - bis.y * k });
            }
        }
        pieces.push([poly(hull(corners))]);
    }
    if (!pieces.length) return [];
    return pieces.length === 1 ? (pieces[0] as Subpath[]) : booleanPaths("union", pieces);
}

// Offset path: closed shapes grow (positive) or shrink (negative) by `distance`; open paths become
// the outline `distance` either side of them.
export function offsetSubpaths(subs: Subpath[], distance: number, join: OffsetJoin, miterLimit = 4): Subpath[] {
    const r = Math.abs(distance);
    if (r < 1e-6) return subs;
    const closed = subs.filter((s) => s.closed && s.points.length > 1);
    const open = subs.filter((s) => !s.closed && s.points.length > 1);
    const out: Subpath[] = [];
    if (closed.length) {
        const bands = closed.map((s) => band(simplify(polyline(s), 0.05), true, r, join, miterLimit));
        out.push(...(distance > 0 ? booleanPaths("union", [closed, ...bands]) : booleanPaths("subtract", [closed, bands.flat()])));
    }
    for (const s of open) out.push(...band(simplify(polyline(s), 0.05), false, r, join, miterLimit));
    return out;
}

// Simplify path: fewer points within `tolerance` (canvas px) of the original; where the kept points
// turn gently the curve stays smooth, sharp turns stay corners.
export function simplifySubpaths(subs: Subpath[], tolerance: number): Subpath[] {
    if (tolerance <= 0) return subs;
    return subs.map((sub) => {
        const line = polyline(sub, 24);
        if (line.length < 3) return sub;
        let kept: Pt[];
        if (sub.closed) {
            // The line-simplifying pass needs two different ends, so a ring is cut at the point
            // farthest from its first one and each half simplified.
            const first = line[0] as Pt;
            let far = 0;
            line.forEach((p, i) => {
                if (Math.hypot(p.x - first.x, p.y - first.y) > Math.hypot((line[far] as Pt).x - first.x, (line[far] as Pt).y - first.y)) far = i;
            });
            if (far === 0) return sub;
            kept = [...simplify(line.slice(0, far + 1), tolerance).slice(0, -1), ...simplify([...line.slice(far), first], tolerance).slice(0, -1)];
            // The first point stays only when it is a real corner.
            const prev = kept[kept.length - 1] as Pt;
            const next = kept[1] as Pt;
            if (kept.length > 3 && distanceToSegment(first, prev, next) <= tolerance) kept = kept.slice(1);
        } else kept = simplify(line, tolerance);
        if (kept.length < (sub.closed ? 3 : 2)) return sub;
        const n = kept.length;
        const points: PathPoint[] = kept.map((p, i) => {
            const hasPrev = sub.closed || i > 0;
            const hasNext = sub.closed || i < n - 1;
            const prev = kept[(i - 1 + n) % n] as Pt;
            const next = kept[(i + 1) % n] as Pt;
            if (!hasPrev || !hasNext) return { x: p.x, y: p.y, in: null, out: null };
            const a1 = Math.atan2(p.y - prev.y, p.x - prev.x);
            const a2 = Math.atan2(next.y - p.y, next.x - p.x);
            let turn = Math.abs(a2 - a1);
            if (turn > Math.PI) turn = Math.PI * 2 - turn;
            if (turn > (Math.PI / 180) * 70) return { x: p.x, y: p.y, in: null, out: null };
            // Catmull-Rom tangents, a third of the way to each neighbour.
            const tx = (next.x - prev.x) / 2;
            const ty = (next.y - prev.y) / 2;
            const dIn = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
            const dOut = Math.hypot(next.x - p.x, next.y - p.y) / 3;
            const tl = Math.hypot(tx, ty) || 1;
            return { x: p.x, y: p.y, in: { x: p.x - (tx / tl) * dIn, y: p.y - (ty / tl) * dIn }, out: { x: p.x + (tx / tl) * dOut, y: p.y + (ty / tl) * dOut } };
        });
        // A smooth segment that strays from the original by more than the tolerance (a gentle bend
        // next to a long straight run) goes straight instead.
        const at = kept.map((p) => line.indexOf(p));
        for (let i = 0; i < (sub.closed ? n : n - 1); i++) {
            const a = points[i] as PathPoint;
            const b = points[(i + 1) % n] as PathPoint;
            if (!a.out && !b.in) continue;
            const from = at[i] as number;
            const to = at[(i + 1) % n] as number;
            const original = to >= from ? line.slice(from, to + 1) : [...line.slice(from), ...line.slice(0, to + 1)];
            const curve = samplePath([{ closed: false, points: [a, b] }], 32)[0] ?? [];
            if (original.some((q) => distanceToPolyline(q, curve) > tolerance)) {
                points[i] = { ...a, out: null };
                points[(i + 1) % n] = { ...(points[(i + 1) % n] as PathPoint), in: null };
            }
        }
        return { closed: sub.closed, points };
    });
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: Pt, line: Pt[]): number {
    if (line.length === 1) return Math.hypot(p.x - (line[0] as Pt).x, p.y - (line[0] as Pt).y);
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i] as Pt, line[i + 1] as Pt));
    return best;
}

// How many anchor points the subpaths have.
export function pointCount(subs: Subpath[]): number {
    return subs.reduce((n, s) => n + s.points.length, 0);
}

// ---- Commands on the selection ----------------------------------------------------------------

// The layers these work on: vectors, rectangles and ellipses (the point being edited counts too).
export function pathTargets(doc: NagmaDocument = editor.get().doc): SceneNode[] {
    const s = editor.get();
    const ids = s.editingVectorId ? [s.editingVectorId] : s.selection;
    return ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && (n.type === "vector" || n.type === "rect" || n.type === "ellipse") && !n.sourceId));
}

function layerSubpaths(node: SceneNode): Subpath[] {
    return node.type === "vector" ? placedSubpaths(node) : shapeSubpaths(node);
}

// Offset path: an offset copy of each layer, placed above it and selected.
export function offsetSelection(distance: number, join: OffsetJoin, miterLimit: number): number {
    const { doc } = editor.get();
    const commands: Command[] = [];
    const created: string[] = [];
    for (const node of pathTargets()) {
        const out = offsetSubpaths(layerSubpaths(node), distance, join, miterLimit);
        if (!out.length) continue;
        const fitted = fitPath(out);
        const fills = node.fills.length ? node.fills : node.strokes;
        const copy = makeNode(doc, "vector", { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }, node.parentId, {
            // The exact box of the geometry: rounding it to the pixel grid would stretch the path.
            x: fitted.x,
            y: fitted.y,
            w: fitted.w,
            h: fitted.h,
            name: `${node.name} offset`,
            fills: node.type === "vector" && node.path?.subpaths.every((s) => !s.closed) ? node.strokes : fills,
            strokes: [],
            strokeWidth: 0,
            rotation: node.rotation,
            flipX: node.flipX,
            flipY: node.flipY,
            opacity: node.opacity,
            path: fitted.path,
        });
        const siblings = (node.parentId ? doc.nodes[node.parentId]?.children : doc.roots) ?? [];
        commands.push({ type: "node.create", node: copy, index: siblings.indexOf(node.id) + 1 });
        created.push(copy.id);
    }
    if (!commands.length) return 0;
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created, editingVectorId: null, vertices: [] });
    return created.length;
}

// Simplify path: the patch for one layer at a tolerance, or null when nothing would change.
export function simplifyPatch(node: SceneNode, tolerance: number): NodePatch | null {
    const subs = layerSubpaths(node);
    const out = simplifySubpaths(subs, tolerance);
    if (pointCount(out) >= pointCount(subs) && node.type === "vector") return null;
    const fitted = fitPath(out);
    return { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h, path: fitted.path, parametric: null };
}

// The commands that simplify every target (rectangles and ellipses become vectors).
export function simplifyCommands(tolerance: number, doc: NagmaDocument = editor.get().doc): Command[] {
    const commands: Command[] = [];
    for (const node of pathTargets(doc)) {
        const patch = simplifyPatch(node, tolerance);
        if (!patch) continue;
        if (node.type !== "vector") commands.push({ type: "node.convert", id: node.id, to: "vector", path: patch.path ?? undefined });
        commands.push({ type: "node.update", id: node.id, patch });
    }
    return commands;
}

// The dialogs' open state (Offset path…, Simplify path…).
type PathDialog = "offset" | "simplify" | null;
let dialog: PathDialog = null;
const dialogListeners = new Set<() => void>();
export const pathDialog = {
    get: () => dialog,
    subscribe(listener: () => void) {
        dialogListeners.add(listener);
        return () => dialogListeners.delete(listener);
    },
};
export function openPathDialog(which: Exclude<PathDialog, null>) {
    if (!pathTargets().length) {
        editor.notify(`Select a vector, rectangle or ellipse to ${which === "offset" ? "offset" : "simplify"} its path.`);
        return;
    }
    dialog = which;
    for (const l of dialogListeners) l();
}
export function closePathDialog() {
    dialog = null;
    for (const l of dialogListeners) l();
}

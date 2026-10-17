import type { NagmaDocument, RepeatTransform, SceneNode } from "./types";

// Transforms (Draw mode): a transform group repeats its layers, in a row or column (linear) or
// around a centre point (radial). The repeats are generated layers, rebuilt from the group's own
// layers after every edit, so changing the original changes every copy. They are locked (picked
// by selecting the group) and marked `repeatOf`; Apply transforms turns them into ordinary layers.

export const DEFAULT_REPEAT: Record<RepeatTransform["kind"], RepeatTransform> = {
    linear: { kind: "linear", count: 4, spacing: 16, direction: "horizontal", radius: 0 },
    radial: { kind: "radial", count: 8, spacing: 0, direction: "horizontal", radius: 0 },
};

const MAX_COPIES = 72;

// Ids of the generated layers stay the same from one rebuild to the next, so the canvas, the
// layers panel and collaborators see the same layers move rather than new ones appear.
const cloneId = (id: string, k: number) => `${id}~r${k}`;

function sourcesOf(doc: NagmaDocument, group: SceneNode): SceneNode[] {
    return group.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && !n.repeatOf));
}

function boxOf(nodes: SceneNode[]): { x: number; y: number; w: number; h: number } | null {
    if (!nodes.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w);
        y1 = Math.max(y1, n.y + n.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The radial centre: below the originals by the radius (their height when none is set), so the
// copies fan around it like petals.
export function radialCenter(box: { x: number; y: number; w: number; h: number }, t: RepeatTransform): { x: number; y: number } {
    return { x: box.x + box.w / 2, y: box.y + box.h + (t.radius > 0 ? t.radius : box.h / 2) };
}

const normal = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

interface Move {
    dx: number;
    dy: number;
    // Radial: turn about this point.
    angle: number;
    cx: number;
    cy: number;
}

// Copies a layer and what is inside it with new ids, placed by `move`. Groups and booleans have no
// transform of their own, so their layers turn one by one; anything else turns as a whole and
// carries its contents along.
function cloneInto(doc: NagmaDocument, id: string, k: number, parentId: string, move: Move, out: Record<string, SceneNode>, groupId: string, root: boolean): string | null {
    const node = doc.nodes[id];
    if (!node) return null;
    const newId = cloneId(id, k);
    let dx = move.dx;
    let dy = move.dy;
    let rotation = node.rotation;
    const turnsAlone = node.type !== "group" && node.type !== "boolean";
    if (move.angle && turnsAlone) {
        const rad = (move.angle * Math.PI) / 180;
        const lx = node.x + node.w / 2 - move.cx;
        const ly = node.y + node.h / 2 - move.cy;
        dx = move.cx + lx * Math.cos(rad) - ly * Math.sin(rad) - (node.x + node.w / 2);
        dy = move.cy + lx * Math.sin(rad) + ly * Math.cos(rad) - (node.y + node.h / 2);
        rotation = normal(node.rotation + move.angle);
    }
    // Instances fill their contents from their component; only the instance itself is copied.
    const children: string[] = [];
    if (node.type !== "instance") {
        // Inside something that turned as a whole, children only shift with it.
        const inner: Move = move.angle && turnsAlone ? { dx, dy, angle: 0, cx: 0, cy: 0 } : move;
        for (const child of node.children) {
            const c = cloneInto(doc, child, k, newId, inner, out, groupId, false);
            if (c) children.push(c);
        }
    }
    out[newId] = {
        ...node,
        id: newId,
        parentId,
        children,
        x: node.x + dx,
        y: node.y + dy,
        rotation,
        locked: root ? true : node.locked,
        repeatOf: root ? groupId : undefined,
        // A copy never starts a flow or carries a dev status of its own.
        flowStart: undefined,
        devStatus: undefined,
        devReady: undefined,
        interactions: undefined,
        // A transform group copied by an outer one is a still picture of itself.
        repeat: null,
    };
    return newId;
}

// Rebuilds every transform group's copies. Runs with the other settle passes.
export function syncRepeats(doc: NagmaDocument): NagmaDocument {
    let groups: SceneNode[] | null = null;
    for (const n of Object.values(doc.nodes)) {
        if (n.repeat) (groups ??= []).push(n);
    }
    if (!groups) return doc;
    // Inner transform groups first, so outer ones copy their fresh copies.
    const depth = (n: SceneNode) => {
        let d = 0;
        for (let p = n.parentId ? doc.nodes[n.parentId] : undefined; p; p = p.parentId ? doc.nodes[p.parentId] : undefined) d++;
        return d;
    };
    groups.sort((a, b) => depth(b) - depth(a));
    const nodes = { ...doc.nodes };
    for (const stale of groups) {
        const group = nodes[stale.id];
        if (!group?.repeat) continue;
        const work = { ...doc, nodes };
        const sources = sourcesOf(work, group);
        // Drop the old copies (and what is inside them).
        const drop = (id: string) => {
            const n = nodes[id];
            if (!n) return;
            for (const c of n.children) drop(c);
            delete nodes[id];
        };
        for (const id of group.children) if (nodes[id]?.repeatOf) drop(id);
        const box = boxOf(sources);
        const t = group.repeat;
        const count = Math.max(1, Math.min(MAX_COPIES, Math.round(t.count)));
        const copies: string[] = [];
        if (box && count > 1) {
            const center = radialCenter(box, t);
            for (let k = 1; k < count; k++) {
                const move: Move =
                    t.kind === "linear"
                        ? { dx: t.direction === "horizontal" ? k * (box.w + gapOf(t, box.w)) : 0, dy: t.direction === "vertical" ? k * (box.h + gapOf(t, box.h)) : 0, angle: 0, cx: 0, cy: 0 }
                        : { dx: 0, dy: 0, angle: (k * 360) / count, cx: center.x, cy: center.y };
                const out: Record<string, SceneNode> = {};
                for (const s of sources) {
                    const id = cloneInto({ ...doc, nodes }, s.id, k, group.id, move, out, group.id, true);
                    if (id) copies.push(id);
                }
                Object.assign(nodes, out);
            }
        }
        // Copies sit under the originals, so the originals stay on top and easy to pick.
        nodes[group.id] = { ...group, children: [...copies, ...sources.map((s) => s.id)] };
    }
    return { ...doc, nodes };
}

// Apply transforms: the copies become ordinary, editable layers and the group a plain group.
export function bakeRepeat(doc: NagmaDocument, groupId: string): Record<string, Partial<SceneNode>> {
    const group = doc.nodes[groupId];
    const patches: Record<string, Partial<SceneNode>> = {};
    if (!group) return patches;
    for (const id of group.children) {
        const n = doc.nodes[id];
        if (n?.repeatOf) patches[id] = { repeatOf: undefined, locked: false };
    }
    patches[groupId] = { repeat: null };
    return patches;
}

export function isRepeatCopy(node: SceneNode | undefined): boolean {
    return Boolean(node?.repeatOf);
}

// A linear repeat's gap in px: as set, or a percentage of the originals' size.
function gapOf(t: RepeatTransform, size: number): number {
    return t.unit === "relative" ? (t.spacing / 100) * size : t.spacing;
}

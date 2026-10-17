import type { Constraints, Rect, SceneNode } from "./types";

type Nodes = Record<string, SceneNode>;

export const DEFAULT_CONSTRAINTS: Constraints = { h: "left", v: "top" };

function axis(start: number, size: number, oldStart: number, oldSize: number, newStart: number, newSize: number, mode: string): [number, number] {
    const before = start - oldStart;
    const after = oldStart + oldSize - (start + size);
    switch (mode) {
        case "right":
        case "bottom":
            return [newStart + newSize - after - size, size];
        case "left-right":
        case "top-bottom":
            return [newStart + before, Math.max(1, newSize - before - after)];
        case "center":
            return [newStart + newSize / 2 - (oldSize / 2 - before), size];
        case "scale": {
            const k = oldSize > 0 ? newSize / oldSize : 1;
            return [newStart + before * k, Math.max(1, size * k)];
        }
        default:
            return [newStart + before, size];
    }
}

// Where a child goes when its frame's box changes from `from` to `to`, per its constraints.
export function constrain(child: SceneNode, from: Rect, to: Rect): Rect {
    const c = child.constraints ?? DEFAULT_CONSTRAINTS;
    const [x, w] = axis(child.x, child.w, from.x, from.w, to.x, to.w, c.h);
    const [y, h] = axis(child.y, child.h, from.y, from.h, to.y, to.h, c.v);
    return { x, y, w, h };
}

function translate(nodes: Nodes, id: string, dx: number, dy: number) {
    const node = nodes[id];
    if (!node || (dx === 0 && dy === 0)) return;
    nodes[id] = { ...node, x: node.x + dx, y: node.y + dy };
    for (const child of node.children) translate(nodes, child, dx, dy);
}

// Applies a frame's resize to its children (and theirs, when a child frame changes size).
// Mutates `nodes`, which must be a fresh copy. Auto-layout frames are skipped: layout places their children.
export function resizeChildren(nodes: Nodes, parentId: string, from: Rect, to: Rect) {
    const parent = nodes[parentId];
    if (!parent || parent.layout) return;
    if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return;
    for (const id of parent.children) {
        const child = nodes[id];
        if (!child) continue;
        const next = constrain(child, from, to);
        const old = { x: child.x, y: child.y, w: child.w, h: child.h };
        if (child.type === "group" || child.type === "boolean") {
            // Groups pass the resize on to their contents and are refitted afterwards.
            const scaled = next;
            for (const inner of child.children) {
                const node = nodes[inner];
                if (!node) continue;
                const k = { x: old.w > 0 ? scaled.w / old.w : 1, y: old.h > 0 ? scaled.h / old.h : 1 };
                const box = {
                    x: scaled.x + (node.x - old.x) * k.x,
                    y: scaled.y + (node.y - old.y) * k.y,
                    w: Math.max(1, node.w * k.x),
                    h: Math.max(1, node.h * k.y),
                };
                nodes[inner] = { ...node, ...box };
            }
            continue;
        }
        translate(nodes, id, next.x - old.x, next.y - old.y);
        const moved = nodes[id];
        if (!moved) continue;
        if (next.w !== old.w || next.h !== old.h) {
            nodes[id] = { ...moved, w: next.w, h: next.h };
            resizeChildren(nodes, id, { ...old, x: next.x, y: next.y }, next);
        }
    }
}

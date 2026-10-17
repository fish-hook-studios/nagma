// Every layer under a point, for the context menu's "Select layer" submenu.
import { nodeContains } from "../canvas/hit-test";
import { screenToWorld } from "./camera";
import { isFrameLike } from "./components";
import { isEffectivelyVisible, paintOrder } from "./nodes";
import { containsPoint } from "./transform";
import { editor } from "./store";
import type { NagmaDocument, SceneNode } from "./types";

// Clipping frames hide what lies outside them, so a point outside an ancestor that clips misses.
function visibleThroughClips(doc: NagmaDocument, node: SceneNode, x: number, y: number): boolean {
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent && parent.type !== "page") {
        if (isFrameLike(parent) && parent.clip && !containsPoint(doc, parent, x, y)) return false;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return true;
}

// Layers under a world point on the active page, deepest and front-most first: a child always comes
// before the frames and groups that hold it. Hidden layers are left out; locked ones stay (the menu
// marks them) since picking one from a list is how you reach a locked layer.
export function layersUnder(doc: NagmaDocument, x: number, y: number): SceneNode[] {
    const order = paintOrder(doc);
    const hit = new Set<string>();
    const out: SceneNode[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
        const node = order[i];
        if (!node || !isEffectivelyVisible(doc, node)) continue;
        // Groups and booleans have no surface of their own: they are under the point when a child is.
        const holder = node.type === "group" || node.type === "boolean";
        const under = holder ? node.children.some((id) => hit.has(id)) || (node.type === "boolean" && nodeContains(doc, node, x, y)) : nodeContains(doc, node, x, y);
        if (!under || !visibleThroughClips(doc, node, x, y)) continue;
        hit.add(node.id);
        out.push(node);
    }
    // Children come later in paint order than their parents, so walking back to front puts them
    // first already; a frame whose children were all missed still appears after them.
    return out;
}

// The world point under a window position, when that position is over the canvas.
export function worldAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = document.querySelector<HTMLCanvasElement>("main canvas");
    const rect = canvas?.getBoundingClientRect();
    if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    return screenToWorld(editor.get().camera, clientX - rect.left, clientY - rect.top);
}

// Layers under a right-click on the canvas, for the "Select layer" submenu.
export function layersAtClient(clientX: number, clientY: number): SceneNode[] {
    const world = worldAtClient(clientX, clientY);
    return world ? layersUnder(editor.get().doc, world.x, world.y) : [];
}


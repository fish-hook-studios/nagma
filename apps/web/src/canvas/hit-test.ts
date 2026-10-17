import { worldToScreen } from "../engine/camera";
import { isEffectivelyLocked, isEffectivelyVisible, paintOrder, selectionBounds } from "../engine/nodes";
import { isFrameLike } from "../engine/components";
import { isTopLevel, layerRoots } from "../engine/page";
import { fontString } from "../engine/text";
import { booleanHit } from "../engine/booleans";
import { type Point, containsPoint, corners, worldBounds, worldMatrix } from "../engine/transform";
import { pathContains, shapeSubpaths } from "../engine/vector";
import type { Camera, NagmaDocument, Rect, SceneNode } from "../engine/types";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type SelectionHit = { kind: "resize"; handle: Handle; angle: number } | { kind: "rotate"; angle: number };

export const FRAME_LABEL_OFFSET = 6;
export const FRAME_LABEL_SIZE = 11;

function insideAncestorFrames(doc: NagmaDocument, node: SceneNode, x: number, y: number): boolean {
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        if (isFrameLike(parent) && parent.clip && !containsPoint(doc, parent, x, y)) return false;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return true;
}

// The topmost layer under a world point. Top-level frames that hold content are picked by their label,
// so dragging on their background starts a marquee, the way designers expect.
export function hitTest(doc: NagmaDocument, x: number, y: number, deep = false): SceneNode | null {
    const order = paintOrder(doc);
    // A top-level frame's body only counts when nothing inside it is under the pointer, so its
    // children win and an empty spot still selects the frame (a drag there draws a marquee).
    let frame: SceneNode | null = null;
    for (let i = order.length - 1; i >= 0; i--) {
        const node = order[i];
        // Groups have no surface of their own; their children are hit and then promoted to the group.
        if (!node || node.type === "group" || !isEffectivelyVisible(doc, node) || isEffectivelyLocked(doc, node)) continue;
        // Shapes inside a boolean only count through the boolean's combined shape (⌘ reaches them directly).
        if (!deep && hasBooleanAncestor(doc, node)) continue;
        if (!nodeContains(doc, node, x, y) || !insideAncestorFrames(doc, node, x, y)) continue;
        // The single slide view (slides/): only the shown slide's layers, and never the slide itself.
        if (sceneFocus.id && (node.id === sceneFocus.id || !insideFocus(doc, node))) continue;
        if (isFrameLike(node) && isTopLevel(doc, node) && node.children.length > 0 && !deep) {
            frame ??= node;
            continue;
        }
        return node;
    }
    return frame;
}

function insideFocus(doc: NagmaDocument, node: SceneNode): boolean {
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        if (parent.id === sceneFocus.id) return true;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return false;
}

function hasBooleanAncestor(doc: NagmaDocument, node: SceneNode): boolean {
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        if (parent.type === "boolean") return true;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return false;
}

// Like containsPoint, but vectors follow their path and booleans their combined shape.
export function nodeContains(doc: NagmaDocument, node: SceneNode, x: number, y: number): boolean {
    if (node.type !== "vector" && node.type !== "boolean") return containsPoint(doc, node, x, y);
    const p = worldMatrix(doc, node).inverse().transformPoint(new DOMPoint(x, y));
    if (node.type === "boolean") return booleanHit(doc, node, p.x, p.y);
    return pathContains(shapeSubpaths(node), p.x, p.y, Math.max(3, node.strokeWidth));
}

// Slides (slides/): the single slide view shows one slide of the page and hides the others.
export const sceneFocus: { id: string | null } = { id: null };

let labelContext: CanvasRenderingContext2D | null = null;

// Layers that carry a canvas label: top-level frames, and frames inside sections (any depth).
export function labelled(doc: NagmaDocument): string[] {
    const out: string[] = [];
    const visit = (ids: string[]) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            if (!node || !isFrameLike(node)) continue;
            out.push(id);
            if (node.isSection) visit(node.children);
        }
    };
    visit(layerRoots(doc));
    return out;
}

export function frameLabelRect(doc: NagmaDocument, node: SceneNode, camera: Camera): Rect {
    labelContext ??= document.createElement("canvas").getContext("2d");
    let width = node.name.length * 6;
    if (labelContext) {
        labelContext.font = fontString(FRAME_LABEL_SIZE, 500);
        width = labelContext.measureText(node.name).width;
    }
    const box = worldBounds(doc, node);
    const topLeft = worldToScreen(camera, box.x, box.y);
    // A section's name sits inside its top left corner, in bold.
    if (node.isSection) return { x: topLeft.x + 8, y: topLeft.y + 6, w: Math.min(width * 1.1, Math.max(0, box.w * camera.zoom - 16)), h: FRAME_LABEL_SIZE + 4 };
    return {
        x: topLeft.x,
        y: topLeft.y - FRAME_LABEL_OFFSET - FRAME_LABEL_SIZE - 2,
        w: Math.min(width, Math.max(0, box.w * camera.zoom)),
        h: FRAME_LABEL_SIZE + 4,
    };
}

// Top-level frame whose name label sits under a screen point.
export function hitFrameLabel(doc: NagmaDocument, camera: Camera, sx: number, sy: number): SceneNode | null {
    const roots = labelled(doc);
    for (let i = roots.length - 1; i >= 0; i--) {
        const node = doc.nodes[roots[i] ?? ""];
        if (!node || !isFrameLike(node) || !node.visible || node.locked) continue;
        const r = frameLabelRect(doc, node, camera);
        if (sx >= r.x && sx <= r.x + Math.max(r.w, 24) && sy >= r.y && sy <= r.y + r.h) return node;
    }
    return null;
}

// Screen-space corners of the selection box, clockwise from the top-left: a single layer's own
// rotated box, or the world bounds of several layers.
export function selectionCorners(doc: NagmaDocument, selection: string[], camera: Camera): Point[] | null {
    const first = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;
    if (first) return corners(doc, first).map((p) => worldToScreen(camera, p.x, p.y));
    const b = selectionBounds(doc, selection);
    if (!b) return null;
    return [
        worldToScreen(camera, b.x, b.y),
        worldToScreen(camera, b.x + b.w, b.y),
        worldToScreen(camera, b.x + b.w, b.y + b.h),
        worldToScreen(camera, b.x, b.y + b.h),
    ];
}

function distanceToSegment(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insidePolygon(p: Point, pts: Point[]) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (!a || !b) continue;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

const CORNERS: Handle[] = ["nw", "ne", "se", "sw"];
const EDGES: Handle[] = ["n", "e", "s", "w"];

// Resize handles on the corners and edges, and a rotation zone just outside each corner.
export function hitSelection(doc: NagmaDocument, selection: string[], camera: Camera, sx: number, sy: number): SelectionHit | null {
    const pts = selectionCorners(doc, selection, camera);
    if (!pts) return null;
    const p = { x: sx, y: sy };
    const center = { x: pts.reduce((s, q) => s + q.x, 0) / 4, y: pts.reduce((s, q) => s + q.y, 0) / 4 };
    const angleTo = (q: Point) => Math.atan2(q.y - center.y, q.x - center.x);

    for (let i = 0; i < 4; i++) {
        const corner = pts[i];
        const handle = CORNERS[i];
        if (corner && handle && Math.hypot(p.x - corner.x, p.y - corner.y) <= 6) return { kind: "resize", handle, angle: angleTo(corner) };
    }
    for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        const handle = EDGES[i];
        if (a && b && handle && distanceToSegment(p, a, b) <= 4) {
            return { kind: "resize", handle, angle: angleTo({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
        }
    }
    if (!insidePolygon(p, pts)) {
        for (const corner of pts) {
            const d = Math.hypot(p.x - corner.x, p.y - corner.y);
            if (d > 6 && d <= 20) return { kind: "rotate", angle: angleTo(corner) };
        }
    }
    return null;
}

// A resize cursor that matches the handle's on-screen direction, even when the layer is rotated.
export function resizeCursor(angle: number): string {
    const deg = (((angle * 180) / Math.PI) % 180 + 180) % 180;
    if (deg < 22.5 || deg >= 157.5) return "ew-resize";
    if (deg < 67.5) return "nwse-resize";
    if (deg < 112.5) return "ns-resize";
    return "nesw-resize";
}

const ROTATE_SVG = (deg: number) =>
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${deg} 12 12)'><path d='M7 15a6 6 0 0 1 8-8' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='M7 15a6 6 0 0 1 8-8' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round'/><path d='M13.5 4.5l2.5 2.5-2.5 2.5M4.5 13.5l2.5 2.5 2.5-2.5' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></g></svg>`;

export function rotateCursor(angle: number): string {
    const deg = Math.round((angle * 180) / Math.PI + 135);
    return `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG(deg))}") 12 12, crosshair`;
}

// Clicking a layer inside a group selects the group, unless the selection is already inside that group
// (or ⌘ is held for a deep select), the way other design tools let you drill in with double-click.
export function promoteToGroup(doc: NagmaDocument, node: SceneNode, selection: string[], deep: boolean): SceneNode {
    if (deep) return node;
    const entered = new Set<string>();
    for (const id of selection) {
        let parent = doc.nodes[id]?.parentId;
        while (parent) {
            entered.add(parent);
            parent = doc.nodes[parent]?.parentId;
        }
    }
    let result = node;
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent && (parent.type === "group" || parent.type === "boolean") && !entered.has(parent.id)) {
        result = parent;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    // Instances behave like groups too: the whole instance is picked first, then double-click goes in.
    let outer: SceneNode | undefined;
    let walker: SceneNode | undefined = result;
    while (walker && walker.type !== "page") {
        if (walker.type === "instance" && !entered.has(walker.id) && !selection.includes(walker.id)) outer = walker;
        walker = walker.parentId ? doc.nodes[walker.parentId] : undefined;
    }
    return outer && outer.id !== result.id && !entered.has(outer.id) ? outer : result;
}

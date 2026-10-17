import type { NagmaDocument, Rect, SceneNode } from "./types";

export interface Point {
    x: number;
    y: number;
}

// A layer's own transform: rotate and mirror around its centre, in its parent's space.
export function localMatrix(node: SceneNode): DOMMatrix {
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    const sx = node.scaleX ?? 1;
    const sy = node.scaleY ?? 1;
    if (!node.rotation && !node.flipX && !node.flipY && sx === 1 && sy === 1) return new DOMMatrix();
    return new DOMMatrix()
        .translate(cx, cy)
        .rotate(node.rotation)
        .scale((node.flipX ? -1 : 1) * sx, (node.flipY ? -1 : 1) * sy)
        .translate(-cx, -cy);
}

// Maps the space a layer's x/y live in (its parent's space) to world space.
export function parentMatrix(doc: NagmaDocument, node: SceneNode): DOMMatrix {
    const chain: SceneNode[] = [];
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        chain.unshift(parent);
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return chain.reduce((matrix, ancestor) => matrix.multiply(localMatrix(ancestor)), new DOMMatrix());
}

export function spaceMatrix(doc: NagmaDocument, parentId: string | null): DOMMatrix {
    const parent = parentId ? doc.nodes[parentId] : undefined;
    return parent ? parentMatrix(doc, parent).multiply(localMatrix(parent)) : new DOMMatrix();
}

export function worldMatrix(doc: NagmaDocument, node: SceneNode): DOMMatrix {
    return parentMatrix(doc, node).multiply(localMatrix(node));
}

export function apply(matrix: DOMMatrix, x: number, y: number): Point {
    const p = matrix.transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
}

// Converts a world-space movement into a movement in some other space (rotation only, no translation).
export function applyVector(matrix: DOMMatrix, dx: number, dy: number): Point {
    return { x: matrix.a * dx + matrix.c * dy, y: matrix.b * dx + matrix.d * dy };
}

export function corners(doc: NagmaDocument, node: SceneNode): Point[] {
    const m = worldMatrix(doc, node);
    return [
        apply(m, node.x, node.y),
        apply(m, node.x + node.w, node.y),
        apply(m, node.x + node.w, node.y + node.h),
        apply(m, node.x, node.y + node.h),
    ];
}

export function boundsOfPoints(points: Point[]): Rect | null {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function worldBounds(doc: NagmaDocument, node: SceneNode): Rect {
    return boundsOfPoints(corners(doc, node)) ?? { x: node.x, y: node.y, w: node.w, h: node.h };
}

// The world rotation of a layer, in degrees, including every rotated frame above it.
export function worldRotation(doc: NagmaDocument, node: SceneNode): number {
    const m = worldMatrix(doc, node);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

export function isAxisAligned(doc: NagmaDocument, node: SceneNode): boolean {
    const m = worldMatrix(doc, node);
    return Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;
}

// Whether a world point lies inside a layer's own shape (ignoring clipping by frames).
export function containsPoint(doc: NagmaDocument, node: SceneNode, x: number, y: number): boolean {
    const p = apply(worldMatrix(doc, node).inverse(), x, y);
    if (node.type === "ellipse") {
        const rx = node.w / 2;
        const ry = node.h / 2;
        if (rx <= 0 || ry <= 0) return false;
        const dx = (p.x - (node.x + rx)) / rx;
        const dy = (p.y - (node.y + ry)) / ry;
        return dx * dx + dy * dy <= 1;
    }
    return p.x >= node.x && p.x <= node.x + node.w && p.y >= node.y && p.y <= node.y + node.h;
}

export function normalizeAngle(degrees: number): number {
    const a = ((degrees % 360) + 540) % 360 - 180;
    return Math.abs(a) < 1e-9 ? 0 : a;
}

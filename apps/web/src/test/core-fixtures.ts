import { applyCommand } from "../engine/commands";
import { makeNode } from "../engine/nodes";
import { activePage } from "../engine/page";
import { applyPatch, diffDocs, invertPatch } from "../engine/patch";
import type { Command, NagmaDocument, NodeType, Rect, SceneNode } from "../engine/types";

// Shared helpers for the core engine tests: a one-page document, layers with fixed ids, and the
// store's undo and redo mechanism as plain functions.

export const PAGE = "page1";

export function emptyDoc(): NagmaDocument {
    const page = makeNode({ name: "", nodes: {}, roots: [], images: {} }, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: PAGE, name: "Page 1" });
    activePage.id = PAGE;
    return { name: "Test", nodes: { [PAGE]: page }, roots: [PAGE], images: {} };
}

// A layer with a fixed id, created through the real command.
export function add(doc: NagmaDocument, type: NodeType, id: string, rect: Rect, parentId: string | null = PAGE, overrides: Partial<SceneNode> = {}, index?: number): NagmaDocument {
    const node = makeNode(doc, type, rect, parentId, { id, ...overrides });
    return applyCommand(doc, { type: "node.create", node, ...(index === undefined ? {} : { index }) });
}

export function node(doc: NagmaDocument, id: string): SceneNode {
    const n = doc.nodes[id];
    if (!n) throw new Error(`no node ${id}`);
    return n;
}

export function box(doc: NagmaDocument, id: string): Rect {
    const n = node(doc, id);
    return { x: n.x, y: n.y, w: n.w, h: n.h };
}

// Undo exactly as the store does it: replay the inverse of what the edit changed on top of `after`.
export function undoOf(before: NagmaDocument, after: NagmaDocument, current: NagmaDocument = after): NagmaDocument {
    return applyPatch(current, invertPatch(before, diffDocs(before, after)));
}

export function redoOf(before: NagmaDocument, after: NagmaDocument, current: NagmaDocument = before): NagmaDocument {
    return applyPatch(current, diffDocs(before, after));
}

export function run(doc: NagmaDocument, ...commands: Command[]): NagmaDocument {
    return commands.reduce(applyCommand, doc);
}

// JSON-shaped copy without undefined-valued keys, for deep comparisons that ignore key order.
export function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

import { makeNode } from "../engine/nodes";
import type { NagmaDocument, NodeType, SceneNode } from "../engine/types";

// Builds small design documents for tests: one page, then layers added in order (each on the page
// unless a parent is given). Returns the document and the layers by name.
export function designDoc(layers: { type: NodeType; name: string; x?: number; y?: number; w?: number; h?: number; parent?: string; props?: Partial<SceneNode> }[]) {
    let doc: NagmaDocument = { name: "Test", nodes: {}, roots: [], images: {} };
    const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1" });
    doc = { ...doc, nodes: { [page.id]: page }, roots: [page.id] };
    const byName: Record<string, SceneNode> = {};
    for (const l of layers) {
        const parentId = l.parent ? byName[l.parent]!.id : page.id;
        const node = makeNode(doc, l.type, { x: l.x ?? 0, y: l.y ?? 0, w: l.w ?? 100, h: l.h ?? 100 }, parentId, { name: l.name, ...l.props });
        const parent = doc.nodes[parentId]!;
        doc = { ...doc, nodes: { ...doc.nodes, [node.id]: node, [parentId]: { ...parent, children: [...parent.children, node.id] } } };
        byName[l.name] = node;
    }
    return { doc, page: doc.nodes[page.id]!, byName };
}

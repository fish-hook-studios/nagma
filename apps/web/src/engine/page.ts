import type { NagmaDocument, SceneNode } from "./types";

// The page being viewed. Engine helpers read it so they work on "the canvas you're looking at"
// without every caller passing it around; the store keeps it in sync with editor state.
export const activePage = { id: "" };

// Top-level layers of the active page, back to front.
export function layerRoots(doc: NagmaDocument): string[] {
    return doc.nodes[activePage.id]?.children ?? [];
}

export function isPage(node: SceneNode | undefined): boolean {
    return node?.type === "page";
}

// A layer sitting directly on a page (not inside a frame or group).
export function isTopLevel(doc: NagmaDocument, node: SceneNode): boolean {
    return isPage(node.parentId ? doc.nodes[node.parentId] : undefined);
}

// The page a layer lives on.
export function pageOf(doc: NagmaDocument, node: SceneNode): string | null {
    let current: SceneNode | undefined = node;
    while (current && current.type !== "page") current = current.parentId ? doc.nodes[current.parentId] : undefined;
    return current?.id ?? null;
}

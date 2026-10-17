import { reusableAssets } from "./components";
import type { NagmaDocument, SceneNode } from "./types";

// Components as the Assets panel and the swap menu show them: grouped by page, then by the frame
// or section they sit in on that page, then by "/" folders in their names ("Icons/Arrow/Left").

export interface AssetEntry {
    id: string;
    node: SceneNode;
    // The last part of the name, after any "/" folders.
    name: string;
    // Page, frame (if any) and folders, outermost first.
    path: string[];
    description: string;
    // Library entries: the published content hash (for previews).
    hash?: string;
}

export interface AssetFolder {
    name: string;
    path: string[];
    folders: AssetFolder[];
    items: AssetEntry[];
}

function pageAndFrame(doc: NagmaDocument, node: SceneNode): { page: SceneNode | null; frame: SceneNode | null } {
    // Walk up to the page; the last layer before it is the top-level container (unless it is the asset).
    let top: SceneNode | null = null;
    let current: SceneNode | undefined = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (current && current.type !== "page") {
        top = current;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return { page: current ?? null, frame: top };
}

// Splits "Icons / Arrow / Left" into folders and a name.
export function slashParts(name: string): { folders: string[]; leaf: string } {
    const parts = name
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
    const leaf = parts.pop() ?? name;
    return { folders: parts, leaf };
}

// Every reusable asset of a document with its folder path. Assets on the internal page (library
// components cached here) are left out; `only` narrows to published ones.
export function assetEntries(doc: NagmaDocument, only?: (node: SceneNode) => boolean): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const node of reusableAssets(doc)) {
        if (only && !only(node)) continue;
        const { page, frame } = pageAndFrame(doc, node);
        if (page?.internal) continue;
        const { folders, leaf } = slashParts(node.name);
        const path = [page?.name ?? "Page", ...(frame && frame.type !== "componentSet" ? [frame.name] : []), ...folders];
        out.push({ id: node.id, node, name: leaf, path, description: node.description ?? "" });
    }
    return out;
}

export function assetTree(entries: AssetEntry[], rootName = ""): AssetFolder {
    const root: AssetFolder = { name: rootName, path: [], folders: [], items: [] };
    for (const entry of entries) {
        let folder = root;
        for (const part of entry.path) {
            let next = folder.folders.find((f) => f.name === part);
            if (!next) {
                next = { name: part, path: [...folder.path, part], folders: [], items: [] };
                folder.folders.push(next);
            }
            folder = next;
        }
        folder.items.push(entry);
    }
    return root;
}

export function folderAt(root: AssetFolder, path: string[]): AssetFolder | null {
    let folder: AssetFolder | null = root;
    for (const part of path) {
        folder = folder?.folders.find((f) => f.name === part) ?? null;
        if (!folder) return null;
    }
    return folder;
}

export function countItems(folder: AssetFolder): number {
    return folder.items.length + folder.folders.reduce((n, f) => n + countItems(f), 0);
}

// The asset an instance's component belongs to (its set for variants).
export function assetOf(doc: NagmaDocument, componentId: string | undefined): SceneNode | undefined {
    const component = componentId ? doc.nodes[componentId] : undefined;
    if (!component) return undefined;
    const parent = doc.nodes[component.parentId ?? ""];
    return parent?.type === "componentSet" ? parent : component;
}

// Where assets come from: this file, or a library (its published snapshot).
export interface AssetSource {
    id: string;
    name: string;
    local: boolean;
    doc: NagmaDocument;
    entries: AssetEntry[];
}

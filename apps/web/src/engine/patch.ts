import { settle } from "./commands";
import type { NagmaDocument, PrototypeSettings, SceneNode, Sequence, Styles, VariableCollection } from "./types";

// A change to a document as plain data: per-layer property values (null removes a layer), properties
// to delete, and document-level fields. Patches are what collaborators exchange; applying the same
// patches in the same order gives everyone the same document.
export interface DocPatch {
    nodes?: Record<string, Partial<SceneNode> | null>;
    removed?: Record<string, string[]>;
    roots?: string[];
    name?: string;
    images?: Record<string, string>;
    sequence?: Sequence | null;
    styles?: Styles | null;
    prototype?: PrototypeSettings | null;
    variables?: VariableCollection[] | null;
    // The file's colour profile (null: back to sRGB).
    colorProfile?: "srgb" | "p3" | null;
    // Plugin data and relaunch buttons on the document itself (null: none).
    pluginData?: Record<string, string> | null;
    relaunchData?: Record<string, Record<string, string>> | null;
}

function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

export function isEmpty(patch: DocPatch): boolean {
    return !patch.nodes && !patch.removed && !patch.roots && patch.name === undefined && !patch.images && patch.sequence === undefined && patch.styles === undefined && patch.prototype === undefined && patch.variables === undefined && patch.colorProfile === undefined && patch.pluginData === undefined && patch.relaunchData === undefined;
}

// What changed from `from` to `to`, property by property. Documents are immutable, so untouched
// layers are the same objects and are skipped without comparing.
export function diffDocs(from: NagmaDocument, to: NagmaDocument): DocPatch {
    const patch: DocPatch = {};
    if (from.nodes !== to.nodes) {
        const nodes: Record<string, Partial<SceneNode> | null> = {};
        const removed: Record<string, string[]> = {};
        const ids = new Set([...Object.keys(from.nodes), ...Object.keys(to.nodes)]);
        for (const id of ids) {
            const a = from.nodes[id];
            const b = to.nodes[id];
            if (a === b) continue;
            if (!b) {
                nodes[id] = null;
                continue;
            }
            if (!a) {
                nodes[id] = b;
                continue;
            }
            const changed: Record<string, unknown> = {};
            const gone: string[] = [];
            const ra = a as unknown as Record<string, unknown>;
            const rb = b as unknown as Record<string, unknown>;
            for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
                if (!(key in rb) || rb[key] === undefined) {
                    if (key in ra && ra[key] !== undefined) gone.push(key);
                    continue;
                }
                if (!same(ra[key], rb[key])) changed[key] = rb[key];
            }
            if (Object.keys(changed).length) nodes[id] = changed as Partial<SceneNode>;
            if (gone.length) removed[id] = gone;
        }
        if (Object.keys(nodes).length) patch.nodes = nodes;
        if (Object.keys(removed).length) patch.removed = removed;
    }
    if (from.roots !== to.roots && !same(from.roots, to.roots)) patch.roots = to.roots;
    if (from.name !== to.name) patch.name = to.name;
    if (from.sequence !== to.sequence && !same(from.sequence, to.sequence)) patch.sequence = to.sequence ?? null;
    if (from.styles !== to.styles && !same(from.styles, to.styles)) patch.styles = to.styles ?? null;
    if (from.prototype !== to.prototype && !same(from.prototype, to.prototype)) patch.prototype = to.prototype ?? null;
    if (from.variables !== to.variables && !same(from.variables, to.variables)) patch.variables = to.variables ?? null;
    if (from.colorProfile !== to.colorProfile) patch.colorProfile = to.colorProfile ?? null;
    if (from.pluginData !== to.pluginData && !same(from.pluginData, to.pluginData)) patch.pluginData = to.pluginData ?? null;
    if (from.relaunchData !== to.relaunchData && !same(from.relaunchData, to.relaunchData)) patch.relaunchData = to.relaunchData ?? null;
    if (from.images !== to.images) {
        const images: Record<string, string> = {};
        for (const [id, data] of Object.entries(to.images)) if (from.images[id] !== data) images[id] = data;
        if (Object.keys(images).length) patch.images = images;
    }
    return patch;
}

// The patch that undoes `patch` when it was applied to `before` (only the properties it touched).
export function invertPatch(before: NagmaDocument, patch: DocPatch): DocPatch {
    const inverse: DocPatch = {};
    const nodes: Record<string, Partial<SceneNode> | null> = {};
    const removed: Record<string, string[]> = {};
    const touched = new Set([...Object.keys(patch.nodes ?? {}), ...Object.keys(patch.removed ?? {})]);
    for (const id of touched) {
        const old = before.nodes[id];
        const change = patch.nodes?.[id];
        if (!old) {
            nodes[id] = null;
            continue;
        }
        if (change === null) {
            nodes[id] = old;
            continue;
        }
        const restore: Record<string, unknown> = {};
        const gone: string[] = [];
        const ro = old as unknown as Record<string, unknown>;
        for (const key of [...Object.keys(change ?? {}), ...(patch.removed?.[id] ?? [])]) {
            if (key in ro && ro[key] !== undefined) restore[key] = ro[key];
            else gone.push(key);
        }
        if (Object.keys(restore).length) nodes[id] = restore as Partial<SceneNode>;
        if (gone.length) removed[id] = gone;
    }
    if (Object.keys(nodes).length) inverse.nodes = nodes;
    if (Object.keys(removed).length) inverse.removed = removed;
    if (patch.roots) inverse.roots = before.roots;
    if (patch.name !== undefined) inverse.name = before.name;
    if (patch.sequence !== undefined) inverse.sequence = before.sequence ?? null;
    if (patch.styles !== undefined) inverse.styles = before.styles ?? null;
    if (patch.prototype !== undefined) inverse.prototype = before.prototype ?? null;
    if (patch.variables !== undefined) inverse.variables = before.variables ?? null;
    if (patch.colorProfile !== undefined) inverse.colorProfile = before.colorProfile ?? null;
    if (patch.pluginData !== undefined) inverse.pluginData = before.pluginData ?? null;
    if (patch.relaunchData !== undefined) inverse.relaunchData = before.relaunchData ?? null;
    // Images are never removed (other layers may use them), so there's nothing to undo there.
    return inverse;
}

// Makes parent and child links agree after merging concurrent changes: every layer is listed by its
// parent exactly once, lists only name layers that point back, and every page is in the page list.
// The repair is deterministic, so every collaborator ends up with the same tree.
export function repairTree(doc: NagmaDocument): NagmaDocument {
    let nodes = doc.nodes;
    let roots = doc.roots;
    const write = (id: string, node: SceneNode) => {
        if (nodes === doc.nodes) nodes = { ...doc.nodes };
        nodes[id] = node;
    };
    for (const node of Object.values(doc.nodes)) {
        const kids = node.children.filter((id, i, list) => list.indexOf(id) === i && doc.nodes[id]?.parentId === node.id);
        if (kids.length !== node.children.length) write(node.id, { ...node, children: kids });
    }
    const orphans = Object.values(nodes)
        .filter((n) => n.parentId && nodes[n.parentId] && !nodes[n.parentId]?.children.includes(n.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const orphan of orphans) {
        const parent = nodes[orphan.parentId ?? ""];
        if (parent) write(parent.id, { ...parent, children: [...parent.children, orphan.id] });
    }
    // Layers whose parent was deleted by someone else go with it.
    const lost = Object.values(nodes).filter((n) => n.parentId && !nodes[n.parentId]);
    if (lost.length) {
        if (nodes === doc.nodes) nodes = { ...doc.nodes };
        const drop = (id: string) => {
            const n = nodes[id];
            delete nodes[id];
            n?.children.forEach(drop);
        };
        lost.forEach((n) => drop(n.id));
    }
    const pages = roots.filter((id, i, list) => list.indexOf(id) === i && nodes[id] && nodes[id]?.parentId === null);
    const missing = Object.values(nodes)
        .filter((n) => n.parentId === null && !pages.includes(n.id))
        .map((n) => n.id)
        .sort();
    if (pages.length !== roots.length || missing.length) roots = [...pages, ...missing];
    return nodes === doc.nodes && roots === doc.roots ? doc : { ...doc, nodes, roots };
}

// Applies a patch, repairs the tree and recomputes derived layout.
export function applyPatch(doc: NagmaDocument, patch: DocPatch): NagmaDocument {
    if (isEmpty(patch)) return doc;
    const nodes = { ...doc.nodes };
    for (const [id, change] of Object.entries(patch.nodes ?? {})) {
        if (change === null) delete nodes[id];
        else if (nodes[id]) nodes[id] = { ...nodes[id], ...change } as SceneNode;
        // Only a whole layer is created. A change to a layer that is gone (a collaborator deleted it
        // while it was being dragged or edited here, or an undo reaches past their delete) is
        // dropped: merged, it made a layer with no type or children and the tree repair threw.
        else if (typeof change.type === "string" && change.id === id && Array.isArray(change.children)) nodes[id] = change as SceneNode;
    }
    for (const [id, keys] of Object.entries(patch.removed ?? {})) {
        const node = nodes[id];
        if (!node) continue;
        const copy = { ...node } as Record<string, unknown>;
        for (const key of keys) delete copy[key];
        nodes[id] = copy as unknown as SceneNode;
    }
    const raw: NagmaDocument = {
        ...doc,
        nodes,
        roots: patch.roots ?? doc.roots,
        name: patch.name ?? doc.name,
        images: patch.images ? { ...doc.images, ...patch.images } : doc.images,
        sequence: patch.sequence === undefined ? doc.sequence : (patch.sequence ?? undefined),
        styles: patch.styles === undefined ? doc.styles : (patch.styles ?? undefined),
        prototype: patch.prototype === undefined ? doc.prototype : (patch.prototype ?? undefined),
        variables: patch.variables === undefined ? doc.variables : (patch.variables ?? undefined),
        colorProfile: patch.colorProfile === undefined ? doc.colorProfile : (patch.colorProfile ?? undefined),
        pluginData: patch.pluginData === undefined ? doc.pluginData : (patch.pluginData ?? undefined),
        relaunchData: patch.relaunchData === undefined ? doc.relaunchData : (patch.relaunchData ?? undefined),
    };
    return settle(doc, repairTree(raw));
}

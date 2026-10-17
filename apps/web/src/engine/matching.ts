// Matching layers, the reference's rule for "Select matching layers" (⌥⌘A) and multi-edit:
// two layers match when they have the same name, the same kind, and the same chain of parent names
// down from their top-level frame or group, and those top-level containers are different frames
// sitting in the same place (both on the canvas, or both in the same section). Text layers named
// after their own content (never renamed) match on their text style instead of their name.
// Top-level frames themselves never match anything.
import { hitTest } from "../canvas/hit-test";
import { isEffectivelyLocked, isEffectivelyVisible } from "./nodes";
import type { NagmaDocument, SceneNode } from "./types";

function isArena(node: SceneNode | undefined): boolean {
    return Boolean(node && (node.type === "page" || node.isSection));
}

// A text layer still carries the name it got from its content (or the default), so its name is
// not a deliberate one.
export function implicitlyNamed(node: SceneNode): boolean {
    if (node.type !== "text") return false;
    const first = (node.text ?? "").split("\n")[0]?.slice(0, 40) ?? "";
    return node.name === first || node.name === "Text" || /^Text \d+$/.test(node.name);
}

function ownKey(node: SceneNode): string {
    if (implicitlyNamed(node)) return `text-style:${node.textStyleId ?? ""}:${node.fontFamily}:${node.fontSize}:${node.fontWeight}:${node.italic ? 1 : 0}`;
    return `${node.type}:${node.name}`;
}

interface Placement {
    // The top-level frame or group the layer sits in, and where that container lives.
    root: string;
    arena: string;
    signature: string;
}

// Where a layer sits for matching purposes, or null for top-level layers and pages.
export function placementOf(doc: NagmaDocument, node: SceneNode): Placement | null {
    if (node.type === "page" || isArena(node)) return null;
    const chain: SceneNode[] = [];
    let cursor: SceneNode | undefined = node;
    while (cursor) {
        const parent: SceneNode | undefined = cursor.parentId ? doc.nodes[cursor.parentId] : undefined;
        if (!parent) return null;
        if (isArena(parent)) {
            // `cursor` is the top-level container; the layer itself can't be it.
            if (cursor === node) return null;
            const path = chain.map((n) => `${n.type}:${n.name}`).reverse();
            return { root: cursor.id, arena: parent.id, signature: [...path, ownKey(node)].join("/") };
        }
        if (cursor !== node) chain.push(cursor);
        cursor = parent;
    }
    return null;
}

// Every layer that matches any of `ids` (the layers themselves included, when they have a match
// or are matchable). Hidden and locked layers are left out, as they are from canvas selection.
export function matchingLayers(doc: NagmaDocument, ids: string[]): string[] {
    const wanted = new Map<string, Set<string>>();
    const arenas = new Set<string>();
    for (const id of ids) {
        const node = doc.nodes[id];
        const place = node ? placementOf(doc, node) : null;
        if (!place) continue;
        const key = `${place.arena}|${place.signature}`;
        const set = wanted.get(key) ?? new Set<string>();
        set.add(place.root);
        wanted.set(key, set);
        arenas.add(place.arena);
    }
    if (!wanted.size) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const arenaId of arenas) {
        const arena = doc.nodes[arenaId];
        if (!arena) continue;
        for (const rootId of arena.children) {
            const root = doc.nodes[rootId];
            if (!root || root.isSection) continue;
            // Walk the container keeping the chain of parent names, so signatures cost one pass.
            const visit = (list: string[], path: string[]) => {
                for (const id of list) {
                    const node = doc.nodes[id];
                    if (!node) continue;
                    const key = `${arenaId}|${[...path, ownKey(node)].join("/")}`;
                    const sources = wanted.get(key);
                    // Same container as the source only counts for the source itself: matching is
                    // across frames, not within one.
                    if (sources && (!sources.has(rootId) || ids.includes(id)) && !seen.has(id) && isEffectivelyVisible(doc, node) && !isEffectivelyLocked(doc, node)) {
                        seen.add(id);
                        out.push(id);
                    }
                    if (node.children.length) visit(node.children, [...path, `${node.type}:${node.name}`]);
                }
            };
            visit(root.children, []);
        }
    }
    // Only a real match counts: a lone layer with nothing like it elsewhere has no matches.
    return out.length > ids.filter((id) => seen.has(id)).length ? out : [];
}

// With layers selected, the matching layer under a world point (reached however deep it is), so
// ⇧hover can highlight it and ⇧click can add or remove it without drilling in.
export function matchUnder(doc: NagmaDocument, selection: string[], x: number, y: number): string | null {
    if (!selection.length) return null;
    const leaf = hitTest(doc, x, y, true);
    if (!leaf) return null;
    const matches = new Set(matchingLayers(doc, selection));
    if (!matches.size) return null;
    // The deepest layer under the pointer, or the nearest of its parents that matches.
    let cursor: SceneNode | undefined = leaf;
    while (cursor && cursor.type !== "page") {
        if (matches.has(cursor.id)) return cursor.id;
        cursor = cursor.parentId ? doc.nodes[cursor.parentId] : undefined;
    }
    return null;
}

// Whether the selection is a set of matching layers (what multi-edit acts on).
export function isMatchingSet(doc: NagmaDocument, selection: string[]): boolean {
    if (selection.length < 2) return false;
    const first = doc.nodes[selection[0] ?? ""];
    const place = first ? placementOf(doc, first) : null;
    if (!place) return false;
    const roots = new Set<string>();
    for (const id of selection) {
        const node = doc.nodes[id];
        const other = node ? placementOf(doc, node) : null;
        if (!other || other.signature !== place.signature || other.arena !== place.arena || roots.has(other.root)) return false;
        roots.add(other.root);
    }
    return true;
}

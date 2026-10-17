import { addSettler } from "./commands";
import type { NagmaDocument, SceneNode } from "./types";

// "Last edited": every top-level frame and section remembers when something inside it last changed,
// shown under its name in Inspect. Status, annotations and other notes about a design don't count.

const NOT_EDITS = new Set(["devStatus", "devStatusSig", "devStatusNote", "devReady", "devResources", "codeConnect", "annotations", "measurements", "editedAt", "pluginData", "relaunchData"]);

// The frame or section sitting on the page that holds `node` (itself when it is one).
function topFrame(doc: NagmaDocument, node: SceneNode): SceneNode | null {
    let current: SceneNode | undefined = node;
    while (current) {
        const parent: SceneNode | undefined = current.parentId ? doc.nodes[current.parentId] : undefined;
        if (!parent) return null;
        if (parent.type === "page") return current.type === "frame" || current.type === "component" || current.type === "componentSet" || current.isSection ? current : null;
        current = parent;
    }
    return null;
}

// Whether a layer changed in a way that edits the design: notes don't count, and neither does
// moving with its whole frame (layers keep page positions, so they all move when the frame does).
function realEdit(before: NagmaDocument, was: SceneNode | undefined, now: SceneNode, top: SceneNode): boolean {
    if (!was) return true;
    const changed = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => !NOT_EDITS.has(k) && (was as unknown as Record<string, unknown>)[k] !== (now as unknown as Record<string, unknown>)[k]);
    if (!changed.length) return false;
    if (changed.some((k) => k !== "x" && k !== "y")) return true;
    const topWas = before.nodes[top.id];
    return !topWas || now.x - top.x !== was.x - topWas.x || now.y - top.y !== was.y - topWas.y;
}

function stampEdits(before: NagmaDocument, raw: NagmaDocument): NagmaDocument {
    if (before.nodes === raw.nodes) return raw;
    const tops = new Set<string>();
    for (const id in raw.nodes) {
        const now = raw.nodes[id] as SceneNode;
        const was = before.nodes[id];
        if (was === now) continue;
        const top = topFrame(raw, now);
        if (top && !tops.has(top.id) && realEdit(before, was, now, top)) tops.add(top.id);
    }
    for (const id in before.nodes) {
        if (raw.nodes[id]) continue;
        const parentId = before.nodes[id]?.parentId;
        const parent = parentId ? raw.nodes[parentId] : undefined;
        const top = parent && parent.type !== "page" ? topFrame(raw, parent) : null;
        if (top) tops.add(top.id);
    }
    if (!tops.size) return raw;
    const at = Date.now();
    const nodes = { ...raw.nodes };
    for (const id of tops) {
        const n = nodes[id];
        if (n) nodes[id] = { ...n, editedAt: at };
    }
    return { ...raw, nodes };
}

addSettler(stampEdits);

import { nanoid } from "nanoid";
import { viewCenter } from "../engine/actions";
import { editor } from "../engine/store";
import type { Command, SceneNode } from "../engine/types";
import type { ConnectorEnd } from "./types";
import { userStorage } from "../engine/user-storage";

// Your own board templates: a selection saved by name (kept in this browser) and placed again in
// any board, at the middle of the view. Team templates (whole boards shared with a team) live on
// the server with the other team templates.

export interface SavedTemplate {
    id: string;
    name: string;
    createdAt: number;
    // The layers (in board coordinates) and the pictures they use.
    nodes: SceneNode[];
    images: Record<string, string>;
    colors: string[];
}

const KEY = "nagma.board.templates.v1";
const listeners = new Set<() => void>();

export function savedTemplates(): SavedTemplate[] {
    try {
        return JSON.parse(userStorage.getItem(KEY) ?? "[]") as SavedTemplate[];
    } catch {
        return [];
    }
}

function store(list: SavedTemplate[]): boolean {
    try {
        userStorage.setItem(KEY, JSON.stringify(list));
        for (const l of listeners) l();
        return true;
    } catch {
        editor.notify("Couldn't save the template (this browser's storage is full).");
        return false;
    }
}

export function subscribeSaved(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

// Saves the selection (and everything inside it) as a template.
export function saveSelectionAsTemplate(name: string): boolean {
    const { doc, selection } = editor.get();
    const top = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!top.length) return false;
    const nodes: SceneNode[] = [];
    const walk = (n: SceneNode, root: boolean) => {
        nodes.push(root ? { ...n, parentId: null } : n);
        for (const c of n.children) {
            const child = doc.nodes[c];
            if (child) walk(child, false);
        }
    };
    for (const n of top) walk(n, true);
    const json = JSON.stringify(nodes);
    const images = Object.fromEntries(Object.entries(doc.images).filter(([id]) => json.includes(id)));
    const colors = [...new Set(nodes.flatMap((n) => n.fills.filter((f) => f.type === "solid").map((f) => (f.type === "solid" ? f.color : ""))))].filter((c) => c && c !== "#FFFFFF").slice(0, 3);
    const ok = store([{ id: nanoid(8), name: name.trim() || "Untitled template", createdAt: Date.now(), nodes, images, colors }, ...savedTemplates()]);
    if (ok) editor.notify(`Saved "${name.trim() || "Untitled template"}" to your templates`);
    return ok;
}

export function deleteSavedTemplate(id: string) {
    store(savedTemplates().filter((t) => t.id !== id));
}

// Places a saved template in the middle of the view, with new ids (links between its own layers
// kept; anything pointing outside it let go).
export function insertSavedTemplate(t: SavedTemplate) {
    const s = editor.get();
    const ids = new Map(t.nodes.map((n) => [n.id, nanoid(10)]));
    const tops = t.nodes.filter((n) => n.parentId === null);
    const minX = Math.min(...tops.map((n) => n.x));
    const minY = Math.min(...tops.map((n) => n.y));
    const maxX = Math.max(...tops.map((n) => n.x + n.w));
    const maxY = Math.max(...tops.map((n) => n.y + n.h));
    const c = viewCenter();
    const dx = c.x - (minX + maxX) / 2;
    const dy = c.y - (minY + maxY) / 2;
    const remap = (n: SceneNode): SceneNode => {
        const top = n.parentId === null;
        let jam = n.jam;
        if (jam?.kind === "connector") {
            const end = (e: ConnectorEnd) => (e.id && ids.has(e.id) ? { ...e, id: ids.get(e.id) ?? null } : { ...e, id: null, x: e.x + dx, y: e.y + dy });
            jam = { ...jam, start: end(jam.start), end: end(jam.end), coords: undefined, axis: undefined };
        }
        if ((jam?.kind === "stamp" || jam?.kind === "draw") && jam.on) jam = ids.has(jam.on) ? { ...jam, on: ids.get(jam.on) } : { ...jam, on: undefined };
        // Layers keep board coordinates, nested ones too, so everything moves by the same amount.
        return { ...n, id: ids.get(n.id) ?? nanoid(10), parentId: top ? s.pageId : (ids.get(n.parentId ?? "") ?? s.pageId), children: n.children.map((k) => ids.get(k) ?? k), x: n.x + dx, y: n.y + dy, jam };
    };
    const commands: Command[] = [
        ...Object.entries(t.images).filter(([id]) => !s.doc.images[id]).map(([id, data]) => ({ type: "image.add" as const, id, data })),
        // Parents before their children.
        ...t.nodes.map((n) => ({ type: "node.create" as const, node: { ...remap(n), children: [] } })),
    ];
    editor.execute({ type: "batch", commands });
    editor.set({ selection: tops.map((n) => ids.get(n.id) ?? "") });
}

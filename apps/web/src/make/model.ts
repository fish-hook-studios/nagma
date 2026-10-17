import { nanoid } from "nanoid";
import { makeNode } from "../engine/nodes";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import type { MakeData, MakeTurn } from "./types";

// Make documents: one page holding the project (make/types.ts), and the edits made to it.

// How many answers keep a snapshot for "Restore this version".
const MAX_TURNS = 80;

export function createMakeDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {}, make: true };
    const data: MakeData = { kind: "project", files: {}, blobs: {}, turns: [], libraryId: null, published: null };
    const page = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "App", fills: [], make: data });
    return { ...base, nodes: { [page.id]: page }, roots: [page.id] };
}

export function makePage(doc: NagmaDocument): SceneNode | null {
    for (const id of doc.roots) {
        const node = doc.nodes[id];
        if (node?.make) return node;
    }
    return null;
}

const EMPTY: MakeData = { kind: "project", files: {}, blobs: {}, turns: [] };
export function makeData(doc: NagmaDocument): MakeData {
    return makePage(doc)?.make ?? EMPTY;
}

// A short key for a file's content (two 32-bit hashes and the length), so turns share blobs.
export function contentKey(text: string): string {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
    }
    return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${text.length.toString(36)}`;
}

// Changes the project in one undoable step. Blobs no turn points at any more are dropped.
export function updateMake(change: (data: MakeData) => MakeData) {
    const { doc, readOnly } = editor.get();
    const page = makePage(doc);
    if (!page?.make || readOnly) return;
    const next = change(page.make);
    if (next === page.make) return;
    let turns = next.turns;
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    const used = new Set(turns.flatMap((t) => Object.values(t.snapshot ?? {})));
    const blobs: Record<string, string> = {};
    for (const key of used) {
        const text = next.blobs[key];
        if (text !== undefined) blobs[key] = text;
    }
    editor.execute({ type: "node.update", id: page.id, patch: { make: { ...next, turns, blobs } } });
}

// Every file's content after a change, as snapshot keys, with the new contents added as blobs.
export function snapshotOf(files: Record<string, string>, blobs: Record<string, string>): { snapshot: Record<string, string>; blobs: Record<string, string> } {
    const snapshot: Record<string, string> = {};
    const out = { ...blobs };
    for (const [path, text] of Object.entries(files)) {
        const key = contentKey(text);
        snapshot[path] = key;
        out[key] = text;
    }
    return { snapshot, blobs: out };
}

export function filesOfSnapshot(data: MakeData, snapshot: Record<string, string>): Record<string, string> | null {
    const files: Record<string, string> = {};
    for (const [path, key] of Object.entries(snapshot)) {
        const text = data.blobs[key];
        if (text === undefined) return null;
        files[path] = text;
    }
    return files;
}

export function addTurn(turn: Omit<MakeTurn, "id" | "at">): string {
    const id = nanoid(10);
    updateMake((d) => ({ ...d, turns: [...d.turns, { ...turn, id, at: Date.now() }] }));
    return id;
}

// An answer that changes files: they're written, and the turn records what changed and keeps a
// snapshot of the whole project for restoring later.
export function applyAnswer(text: string, written: Record<string, string>, removed: string[], extra: Partial<MakeTurn> = {}) {
    updateMake((d) => {
        const files = { ...d.files };
        const changed: string[] = [];
        for (const [path, content] of Object.entries(written)) {
            if (files[path] !== content) changed.push(path);
            files[path] = content;
        }
        const gone = removed.filter((p) => p in files);
        for (const p of gone) delete files[p];
        const { snapshot, blobs } = snapshotOf(files, d.blobs);
        const turn: MakeTurn = { id: nanoid(10), role: "assistant", text, at: Date.now(), changed, removed: gone, snapshot, ...extra };
        return { ...d, files, blobs, turns: [...d.turns, turn] };
    });
}

// Puts the project back the way an answer left it, as a new turn (so the restore can be undone or
// restored past too).
export function restoreTurn(turnId: string): boolean {
    const data = makeData(editor.get().doc);
    const turn = data.turns.find((t) => t.id === turnId);
    const files = turn?.snapshot ? filesOfSnapshot(data, turn.snapshot) : null;
    if (!turn || !files) return false;
    const index = data.turns.filter((t) => t.role === "assistant").indexOf(turn) + 1;
    const removed = Object.keys(data.files).filter((p) => !(p in files));
    applyAnswer(`Restored the version from answer ${index}.`, files, removed, { restoredFrom: turnId });
    return true;
}

// Hand edits in the Code tab and Point and edit: the file changes, no turn is added.
export function writeFile(path: string, content: string) {
    updateMake((d) => (d.files[path] === content ? d : { ...d, files: { ...d.files, [path]: content } }));
}

export function deleteFile(path: string) {
    updateMake((d) => {
        if (!(path in d.files)) return d;
        const files = { ...d.files };
        delete files[path];
        return { ...d, files };
    });
}

export function renameFile(from: string, to: string) {
    updateMake((d) => {
        if (!(from in d.files) || to in d.files) return d;
        const files: Record<string, string> = {};
        for (const [p, text] of Object.entries(d.files)) files[p === from ? to : p] = text;
        return { ...d, files };
    });
}

export function setLibrary(libraryId: string | null) {
    updateMake((d) => ({ ...d, libraryId }));
}

export function setPublished(published: MakeData["published"], appId?: string) {
    updateMake((d) => ({ ...d, published, ...(appId ? { appId } : {}) }));
}

export const isMakeDoc = () => {
    const s = editor.get();
    return Boolean(s.doc.make) && !s.homeOpen;
};

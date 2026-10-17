import { authHeaders } from "./auth";
import { collab, currentLinkKey, join } from "./collab";
import { rememberShared } from "./files";
import { httpBase } from "./server-url";
import { editor, prepareDocument } from "./store";
import { renderThumb } from "./thumb";
import type { NagmaDocument, SceneNode } from "./types";

// Branching: a copy of a main file to explore in, compared with main, reviewed and merged back.
// The server keeps each branch's starting point, so merges bring only what the branch changed.

export interface BranchInfo {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    author: { id: string; name: string; color: string } | null;
    status: "active" | "archived";
    review: Review | null;
    // The badge: waiting for review, approved, or changes suggested.
    reviewState: "requested" | "approved" | "changes" | null;
    mergedAt: number | null;
    key: string | null;
}

interface Person {
    id: string;
    name: string;
    email: string;
    color: string;
}

export interface Review {
    requestedBy: Person;
    reviewer: Person | null;
    reviewers?: Person[];
    at: number;
    note: string;
    decisions?: Record<string, { decision: "approved" | "changes"; note: string; at: number; by: Person }>;
}

export interface BranchList {
    main: { id: string; name: string; role: string | null; key: string | null };
    branches: BranchInfo[];
}

function keyQuery(): string {
    const key = currentLinkKey();
    return key ? `?key=${encodeURIComponent(key)}` : "";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}${keyQuery()}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

export function currentFile(): string | null {
    return collab.get().fileId;
}

export async function listBranches(fileId = currentFile()): Promise<BranchList | null> {
    if (!fileId) return null;
    return call<BranchList>(`/files/${fileId}/branches`);
}

export async function createBranch(name: string): Promise<void> {
    const fileId = currentFile();
    if (!fileId) throw new Error("Move this file to the server to branch it.");
    const made = await call<{ id: string; keys: { edit: string }; name: string }>(`/files/${fileId}/branches`, { method: "POST", body: JSON.stringify({ name }) });
    openFile(made.id, made.keys.edit, `${editor.get().doc.name} / ${made.name}`);
    editor.notify(`You're on the branch "${made.name}". Changes here stay out of main until you merge.`);
}

// Opens another server file (main or a branch) in this tab, with the key that opens it.
export function openFile(id: string, key: string | null = null, name?: string) {
    const meta = rememberShared(id, name ?? "Shared file", key);
    editor.set({ fileId: meta.id });
    join(id, undefined, key);
}

// Opens main from a branch (or a branch from the list) using the keys the server hands editors.
export async function openMain() {
    const list = await listBranches();
    if (list) openFile(list.main.id, list.main.key, list.main.name);
}

export async function setBranch(id: string, patch: { name?: string; status?: "active" | "archived"; review?: { emails: string; note?: string } | null }) {
    return call<BranchInfo>(`/files/${id}/branch`, { method: "PUT", body: JSON.stringify(patch) });
}

// A reviewer approves the branch, or suggests changes (the note goes on the branch as a comment).
export async function decideReview(id: string, decision: "approved" | "changes", note = "") {
    return call<BranchInfo>(`/files/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) });
}

export async function mergeBranch(id: string): Promise<string> {
    const r = await call<{ main: string }>(`/files/${id}/merge`, { method: "POST", body: "{}" });
    return r.main;
}

// Brings main's changes into the branch. Conflicts (layers both changed) keep the branch's version,
// except the ones listed in `take`, which take main's.
export async function updateFromMain(id: string, take: string[] = []) {
    await call(`/files/${id}/update`, { method: "POST", body: JSON.stringify({ take }) });
    editor.notify("Branch updated with the latest changes from main.");
}

// What updating from main would bring: main's changes since the branch started, and the layers both
// main and the branch changed (conflicts to settle; their pictures are main's version, then the branch's).
export async function mainUpdates(branchId: string): Promise<{ changes: Change[]; conflicts: Change[]; base: NagmaDocument; main: NagmaDocument; branch: NagmaDocument }> {
    const info = await listBranches(branchId);
    if (!info) throw new Error("The branch couldn't be loaded.");
    const [base, main, branch] = await Promise.all([fetchDoc(branchId, "base"), fetchDoc(info.main.id, "doc"), branchId === currentFile() ? Promise.resolve(editor.committed()) : fetchDoc(branchId, "doc")]);
    if (!base || !main || !branch) throw new Error("The branch couldn't be loaded.");
    const changes = compareDocs(base, main);
    const ours = new Set(compareDocs(base, branch, false).filter((c) => c.kind === "changed" && c.type === "frame").map((c) => c.id));
    const conflicts = changes.filter((c) => c.kind === "changed" && c.type === "frame" && ours.has(c.id)).map((c) => ({ ...c, before: c.after, after: renderThumb(branch, 240, 150, c.id) }));
    return { changes, conflicts, base, main, branch };
}

// A bigger before and after picture of one change, for the review's detail view.
export function changePictures(before: NagmaDocument, after: NagmaDocument, c: Change, w = 520, h = 320): { before: string | null; after: string | null } {
    const pic = (doc: NagmaDocument) => {
        if (c.type === "page") return doc.nodes[c.id] ? renderThumb({ ...doc, roots: [c.id, ...doc.roots.filter((r) => r !== c.id)] }, w, h) : null;
        return doc.nodes[c.id] ? renderThumb(doc, w, h, c.id) : null;
    };
    return { before: c.kind === "added" ? null : pic(before), after: c.kind === "removed" ? null : pic(after) };
}

async function fetchDoc(id: string, which: "doc" | "base"): Promise<NagmaDocument | null> {
    const r = await call<{ doc: NagmaDocument }>(`/files/${id}/${which}`);
    return prepareDocument(r.doc);
}

// ---- Comparing a branch with where it started ----

export type ChangeKind = "added" | "changed" | "removed";
export interface Change {
    kind: ChangeKind;
    id: string;
    name: string;
    type: "page" | "frame";
    page: string;
    // Pictures of the layer before (main's copy) and after (the branch's).
    before: string | null;
    after: string | null;
}

// Every layer under a top-level layer, so a change anywhere inside marks it changed.
function subtree(doc: NagmaDocument, id: string): string {
    const out: unknown[] = [];
    const walk = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        out.push(n);
        n.children.forEach(walk);
    };
    walk(id);
    return JSON.stringify(out);
}

function pageThumb(doc: NagmaDocument, pageId: string): string {
    return renderThumb({ ...doc, roots: [pageId, ...doc.roots.filter((r) => r !== pageId)] }, 240, 150);
}

function topLevel(doc: NagmaDocument): SceneNode[] {
    return doc.roots.flatMap((p) => (doc.nodes[p]?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)));
}

export function compareDocs(base: NagmaDocument, branch: NagmaDocument, pictures = true): Change[] {
    const changes: Change[] = [];
    const pageName = (doc: NagmaDocument, n: SceneNode) => doc.nodes[n.parentId ?? ""]?.name ?? "";
    for (const id of branch.roots) {
        const page = branch.nodes[id];
        if (page && !base.nodes[id]) changes.push({ kind: "added", id, name: page.name, type: "page", page: page.name, before: null, after: pictures ? pageThumb(branch, id) : null });
    }
    for (const id of base.roots) {
        const page = base.nodes[id];
        if (page && !branch.nodes[id]) changes.push({ kind: "removed", id, name: page.name, type: "page", page: page.name, before: pictures ? pageThumb(base, id) : null, after: null });
    }
    const baseTop = new Map(topLevel(base).map((n) => [n.id, n]));
    const branchTop = new Map(topLevel(branch).map((n) => [n.id, n]));
    for (const [id, n] of branchTop) {
        const old = baseTop.get(id);
        if (!old) {
            if (base.nodes[n.parentId ?? ""]) changes.push({ kind: "added", id, name: n.name, type: "frame", page: pageName(branch, n), before: null, after: pictures ? renderThumb(branch, 240, 150, id) : null });
        } else if (subtree(base, id) !== subtree(branch, id)) {
            changes.push({ kind: "changed", id, name: n.name, type: "frame", page: pageName(branch, n), before: pictures ? renderThumb(base, 240, 150, id) : null, after: pictures ? renderThumb(branch, 240, 150, id) : null });
        }
    }
    for (const [id, n] of baseTop) {
        if (!branchTop.has(id) && branch.nodes[n.parentId ?? ""]) changes.push({ kind: "removed", id, name: n.name, type: "frame", page: pageName(base, n), before: pictures ? renderThumb(base, 240, 150, id) : null, after: null });
    }
    // File-level things: styles, variables, prototype settings.
    for (const [key, label] of [
        ["styles", "Styles"],
        ["variables", "Variables"],
        ["prototype", "Prototype settings"],
    ] as const) {
        if (JSON.stringify(base[key] ?? null) !== JSON.stringify(branch[key] ?? null)) changes.push({ kind: "changed", id: key, name: label, type: "page", page: "File", before: null, after: null });
    }
    return changes;
}

// The branch's changes since it started (or, from main, a branch's).
export async function branchChanges(branchId: string): Promise<{ changes: Change[]; mainChanged: boolean; base: NagmaDocument; branch: NagmaDocument }> {
    const [base, branch] = await Promise.all([fetchDoc(branchId, "base"), branchId === currentFile() ? Promise.resolve(editor.committed()) : fetchDoc(branchId, "doc")]);
    if (!base || !branch) throw new Error("The branch couldn't be loaded.");
    const info = await listBranches(branchId);
    const main = info ? await fetchDoc(info.main.id, "doc").catch(() => null) : null;
    return { changes: compareDocs(base, branch), mainChanged: main ? compareDocs(base, main, false).length > 0 : false, base, branch };
}

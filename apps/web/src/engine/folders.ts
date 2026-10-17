import { nanoid } from "nanoid";
import { deleteForever, deleteServerForever, duplicateFile, duplicateServerFile, listFiles, patchFiles, putServerMeta, refreshServerFiles, rememberShared, setFileFolder } from "./files";
import type { Team } from "./teams";
import { onScopeChange, userStorage } from "./user-storage";

// Folders. Drafts have folders of their own, kept in this browser beside the file index; a team's
// folders are its projects on the sync server (engine/teams.ts). Both nest to any depth, and Home
// shows them through one shape, FolderItem.

export interface LocalFolder {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: number;
    updatedAt: number;
    trashed?: boolean;
    // The folder whose deletion sent this one to the trash (itself when deleted directly).
    trashedWith?: string | null;
    trashedAt?: number | null;
    color?: string | null;
}

const KEY = "nagma.folders.v1";
let folders: LocalFolder[] | null = null;
const listeners = new Set<() => void>();

function read(): LocalFolder[] {
    if (folders) return folders;
    try {
        folders = JSON.parse(userStorage.getItem(KEY) ?? "[]") as LocalFolder[];
    } catch {
        folders = [];
    }
    return folders;
}

function write(next: LocalFolder[]) {
    folders = next;
    try {
        userStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        // Folders still work for this session.
    }
    for (const l of listeners) l();
}

// Folders from elsewhere (made signed out, engine/guest-drafts.ts) join this account's.
export function adoptFolders(list: LocalFolder[]) {
    const have = new Set(read().map((f) => f.id));
    write([...read(), ...list.filter((f) => !have.has(f.id))]);
}

onScopeChange(() => {
    folders = null;
    for (const l of listeners) l();
});

export function subscribeLocalFolders(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function listLocalFolders(): LocalFolder[] {
    return read();
}

const touch = (id: string | null, list: LocalFolder[]) => (id ? list.map((f) => (f.id === id ? { ...f, updatedAt: Date.now() } : f)) : list);

// The folder and every folder inside it (the folder first).
function subtree(list: { id: string; parentId?: string | null }[], id: string): string[] {
    const out = [id];
    for (let i = 0; i < out.length; i += 1) for (const f of list) if (f.parentId === out[i] && !out.includes(f.id)) out.push(f.id);
    return out;
}

export function createLocalFolder(name: string, parentId: string | null): LocalFolder {
    const folder: LocalFolder = { id: nanoid(10), name: name.trim().slice(0, 60) || "Untitled folder", parentId, createdAt: Date.now(), updatedAt: Date.now() };
    write([...touch(parentId, read()), folder]);
    return folder;
}

export function renameLocalFolder(id: string, name: string) {
    const clean = name.trim().slice(0, 60);
    if (clean) write(read().map((f) => (f.id === id ? { ...f, name: clean, updatedAt: Date.now() } : f)));
}

// Moves a folder (with what's inside it) into another Drafts folder, or to the top of Drafts.
export function setLocalFolderColor(id: string, color: string | null) {
    write(read().map((f) => (f.id === id ? { ...f, color } : f)));
}

export function moveLocalFolder(id: string, parentId: string | null): boolean {
    if (parentId && subtree(read(), id).includes(parentId)) return false;
    write(touch(parentId, read().map((f) => (f.id === id ? { ...f, parentId, updatedAt: Date.now() } : f))));
    return true;
}

// Deleting sends the folder, the folders inside it and their files to the trash, together. Server
// drafts kept in these folders go to the server's trash as well.
export function trashLocalFolder(id: string) {
    const ids = new Set(subtree(read(), id));
    const now = Date.now();
    write(read().map((f) => (ids.has(f.id) && (!f.trashed || f.id === id) ? { ...f, trashed: true, trashedWith: id, trashedAt: now } : f)));
    patchFiles((f) => (f.folderId && ids.has(f.folderId) && !f.trashed && !f.project ? { trashed: true, trashedWith: id, trashedAt: now } : null));
    const shared = listFiles().filter((f) => f.trashedWith === id && f.shared);
    for (const f of shared) void putServerMeta(f.shared as string, { trashed: true });
    if (shared.length) void refreshServerFiles();
}

export function restoreLocalFolder(id: string) {
    const list = read();
    const root = list.find((f) => f.id === id);
    if (!root) return;
    const parent = root.parentId ? list.find((f) => f.id === root.parentId) : null;
    write(list.map((f) => (f.trashedWith === id ? { ...f, trashed: false, trashedWith: null, ...(f.id === id && (!parent || parent.trashed) ? { parentId: null } : {}) } : f)));
    const shared = listFiles().filter((f) => f.trashedWith === id && f.shared);
    patchFiles((f) => (f.trashedWith === id ? { trashed: false, trashedWith: null } : null));
    for (const f of shared) void putServerMeta(f.shared as string, { trashed: false });
    if (shared.length) void refreshServerFiles();
}

export function deleteLocalFolderForever(id: string) {
    const files = listFiles().filter((f) => f.trashedWith === id);
    for (const f of files) {
        if (f.shared) void deleteServerForever(f.shared).catch(() => undefined);
        deleteForever(f.id);
    }
    write(read().filter((f) => f.trashedWith !== id));
}

// Empty trash: the trashed Drafts folders go with the trashed files.
export function emptyLocalFolderTrash(): number {
    const gone = read().filter((f) => f.trashed);
    if (gone.length) write(read().filter((f) => !f.trashed));
    return gone.length;
}

// A copy of the folder next to it, with copies of its folders and files.
export async function duplicateLocalFolder(id: string, parentId?: string | null, top = true): Promise<LocalFolder | null> {
    const source = read().find((f) => f.id === id);
    if (!source) return null;
    const copy = createLocalFolder(top ? `${source.name} (copy)` : source.name, parentId === undefined ? source.parentId : parentId);
    for (const f of listFiles().filter((x) => x.folderId === id && !x.trashed && !x.project)) {
        if (f.shared) {
            const made = await duplicateServerFile(f.shared);
            const entry = rememberShared(made.id, f.name, made.keys.edit, made.kind);
            setFileFolder(entry.id, copy.id);
        } else {
            const made = await duplicateFile(f.id);
            if (made) patchFiles((x) => (x.id === made.id ? { folderId: copy.id, name: f.name } : null));
        }
    }
    for (const child of read().filter((f) => f.parentId === id && !f.trashed)) await duplicateLocalFolder(child.id, copy.id, false);
    return copy;
}

// Folder colours (the server accepts the same set); the first is the default.
export const FOLDER_COLORS: [string, string][] = [
    ["#b1bbd0", "Gray"],
    ["#0d99ff", "Blue"],
    ["#14ae5c", "Green"],
    ["#ffcd29", "Yellow"],
    ["#ffa629", "Orange"],
    ["#f24822", "Red"],
    ["#9747ff", "Purple"],
    ["#ff24bd", "Pink"],
    ["#667799", "Slate"],
];
export const folderColor = (f: Pick<FolderItem, "color">) => f.color ?? FOLDER_COLORS[0][0];

// ---- One shape for both kinds of folder ----

export interface FolderItem {
    id: string;
    name: string;
    parentId: string | null;
    // The team the folder belongs to; null for a Drafts folder in this browser.
    teamId: string | null;
    createdAt: number;
    updatedAt: number;
    trashed: boolean;
    trashedWith: string | null;
    trashedAt: number | null;
    canEdit: boolean;
    // Made by you (every Drafts folder is), and sent to the trash by you.
    mine: boolean;
    trashedByMe: boolean;
    color: string | null;
    // A folder of another team connected to this one: that team's name.
    connectedFrom: string | null;
}

export function allFolders(local: LocalFolder[], teams: Team[], me: string | null): FolderItem[] {
    const out: FolderItem[] = local.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, teamId: null, createdAt: f.createdAt, updatedAt: f.updatedAt, trashed: Boolean(f.trashed), trashedWith: f.trashedWith ?? null, trashedAt: f.trashedAt ?? null, canEdit: true, mine: true, trashedByMe: true, color: f.color ?? null, connectedFrom: null }));
    for (const t of teams) {
        for (const p of t.projects) {
            const role = p.role === undefined ? t.role : p.role;
            out.push({ id: p.id, name: p.name, parentId: p.parentId ?? null, teamId: t.id, createdAt: p.createdAt ?? 0, updatedAt: p.updatedAt ?? p.createdAt ?? 0, trashed: Boolean(p.trashed), trashedWith: p.trashedWith ?? null, trashedAt: p.trashedAt ?? null, canEdit: role === "admin" || role === "edit", mine: Boolean(me && p.createdBy === me), trashedByMe: Boolean(me && p.trashedBy === me), color: p.color ?? null, connectedFrom: p.connectedFrom ?? null });
        }
    }
    return out;
}

// The folders from the top down to `id` (inclusive).
export function folderPath(list: FolderItem[], id: string | null): FolderItem[] {
    const out: FolderItem[] = [];
    const seen = new Set<string>();
    for (let f = id ? list.find((x) => x.id === id) : undefined; f && !seen.has(f.id); f = f.parentId ? list.find((x) => x.id === f?.parentId) : undefined) {
        seen.add(f.id);
        out.unshift(f);
    }
    return out;
}

export function folderSubtree(list: FolderItem[], id: string): Set<string> {
    return new Set(subtree(list, id));
}

// Live child folders of a folder (or of the top of a space: Drafts for teamId null, else the team).
export function childFolders(list: FolderItem[], parentId: string | null, teamId: string | null): FolderItem[] {
    return list.filter((f) => !f.trashed && f.teamId === teamId && (parentId ? f.parentId === parentId : !f.parentId || !list.some((x) => x.id === f.parentId)));
}

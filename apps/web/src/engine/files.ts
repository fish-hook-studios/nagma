import { loadOffline } from "./offline";
import { sharedOpener } from "./shared-opener";
import { nanoid } from "nanoid";
import { deleteDoc, loadDoc, migrateLocalStorage, saveDoc } from "./doc-store";
import { authHeaders } from "./auth";
import { httpBase } from "./server-url";
import { migrateEmbedded, preloadImages } from "./image-store";
import { renderThumb } from "./thumb";
import { makeNode } from "./nodes";
import { createBoardDocument } from "../board/model";
import { createSlidesDocument } from "../slides/model";
import { createCampaignDocument } from "../campaign/model";
import { createSiteDocument } from "../site/model";
import { createMakeDocument } from "../make/model";
import { startScreen } from "./prototype";
import { forgetPrototype, protoFileOf, protoTabId, prototypeView, setPrototypeStart } from "./prototype-view";
import { createSampleDocument } from "./sample";
import { editor, prepareDocument } from "./store";
import type { NagmaDocument } from "./types";
import { onScopeChange, userStorage } from "./user-storage";

// The file library behind the Home screen. Each file is a document kept in this browser
// (IndexedDB; the index of names and pictures in localStorage), or a shared file that lives on
// the sync server and is opened by its id.

export type FileKind = "design" | "docs" | "video" | "board" | "slides" | "campaign" | "site" | "make";

export interface FileMeta {
    id: string;
    name: string;
    kind: FileKind;
    createdAt: number;
    updatedAt: number;
    // A small picture of the first page, as a data URL.
    thumb?: string;
    // A frame chosen with "Set as thumbnail"; otherwise the first page is pictured.
    thumbFrame?: string;
    trashed?: boolean;
    // The sync server's file id when the file is shared (its contents live there, not here).
    shared?: string;
    // The server project the file sits in (shared files only).
    project?: string | null;
    // The link key this browser used to open the shared file, so it can reopen it by itself.
    key?: string | null;
    owner?: string;
    role?: "edit" | "view";
    // The Drafts folder the file sits in (engine/folders.ts); none means the top of Drafts.
    folderId?: string | null;
    // The folder whose deletion sent this file to the trash, so restoring that folder brings it back.
    trashedWith?: string | null;
    trashedAt?: number | null;
    // Server files: the owner's account id, and whether you sent it to the trash.
    ownerId?: string | null;
    trashedByMe?: boolean;
    // Pinned to the top of its folder.
    pinned?: boolean;
}

export const KIND_LABELS: Record<FileKind, string> = { design: "Design file", docs: "Document", video: "Video", board: "Board", slides: "Slides", campaign: "Campaign", site: "Site", make: "Make" };

const INDEX_KEY = "nagma.files.v1";
const LEGACY_KEY = "nagma.doc.v1";
const docKey = (id: string) => `nagma.file.${id}`;

let index: FileMeta[] | null = null;
const listeners = new Set<() => void>();

function read(): FileMeta[] {
    if (index) return index;
    try {
        const raw = userStorage.getItem(INDEX_KEY);
        index = raw ? (JSON.parse(raw) as FileMeta[]) : null;
    } catch {
        index = null;
    }
    if (!index) {
        // First run: the single draft from before the library becomes its first file.
        index = [];
        try {
            const legacy = userStorage.getItem(LEGACY_KEY);
            const doc = legacy ? prepareDocument(JSON.parse(legacy) as NagmaDocument) : null;
            if (doc) {
                const meta: FileMeta = { id: nanoid(10), name: doc.name || "Untitled", kind: "design", createdAt: Date.now(), updatedAt: Date.now() };
                void saveDoc(docKey(meta.id), doc).then(() => userStorage.removeItem(LEGACY_KEY));
                index.push(meta);
            }
        } catch {
            // Nothing to migrate.
        }
        write();
    }
    return index;
}

function write() {
    try {
        userStorage.setItem(INDEX_KEY, JSON.stringify(index ?? []));
    } catch {
        // Quota or privacy mode: the library just won't persist.
    }
    for (const l of listeners) l();
}

// Drafts from elsewhere (made signed out, engine/guest-drafts.ts) join this account's index.
export function adoptDrafts(list: FileMeta[]) {
    const have = new Set(read().map((f) => f.id));
    index = [...list.filter((f) => !have.has(f.id)), ...read()];
    write();
}

export function subscribeFiles(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function listFiles(): FileMeta[] {
    return read();
}

// Open tabs, remembered in this browser so they come back at the next start. A file's prototype
// has a tab of its own ("proto:<file id>", engine/prototype-view.ts), right after the file's.
const TABS_KEY = "nagma.tabs.v1";
let tabs: string[] | null = null;
const tabListeners = new Set<() => void>();
function readTabs(): string[] {
    if (tabs) return tabs;
    try {
        tabs = JSON.parse(userStorage.getItem(TABS_KEY) ?? "[]") as string[];
    } catch {
        tabs = [];
    }
    return tabs;
}
function writeTabs(next: string[]) {
    tabs = next;
    try {
        userStorage.setItem(TABS_KEY, JSON.stringify(next));
    } catch {
        // Tabs still work for this session.
    }
    for (const l of tabListeners) l();
}
// Any file that becomes current (local or shared) gets a tab.
editor.subscribe(() => {
    const id = editor.get().fileId;
    if (id && fileMeta(id) && !readTabs().includes(id)) addTab(id);
});

export function subscribeTabs(listener: () => void) {
    tabListeners.add(listener);
    return () => tabListeners.delete(listener);
}
// Cached per (tabs, index) pair: useSyncExternalStore needs the same array back while nothing changed.
let tabsCache: { tabs: string[]; index: FileMeta[] | null; value: string[] } | null = null;
export function getTabs(): string[] {
    const current = readTabs();
    if (tabsCache && tabsCache.tabs === current && tabsCache.index === index) return tabsCache.value;
    const value = current.filter((id) => {
        const m = fileMeta(protoFileOf(id) ?? id);
        return m && !m.trashed;
    });
    tabsCache = { tabs: current, index, value };
    return value;
}
// A new tab goes at the end, or right after `after` (a prototype's tab next to its file's).
export function addTab(id: string, after?: string) {
    const current = readTabs();
    if (current.includes(id)) return;
    const at = after ? current.indexOf(after) : -1;
    writeTabs(at < 0 ? [...current, id] : [...current.slice(0, at + 1), id, ...current.slice(at + 1)]);
}
// The tab showing now: Home (null), a file, or a file's prototype.
export function currentTab(): string | null {
    const s = editor.get();
    if (s.homeOpen || !s.fileId) return null;
    return s.presentingId ? protoTabId(s.fileId) : s.fileId;
}
// Shows a tab: a file's tab shows the editor, a prototype's tab plays the file's prototype (opening
// the file first when another one is open).
export async function activateTab(id: string) {
    const proto = protoFileOf(id);
    const fileId = proto ?? id;
    if (editor.get().fileId !== fileId && !(await openFile(fileId))) return;
    if (!proto) {
        editor.set({ homeOpen: false, presentingId: null });
        return;
    }
    const doc = editor.get().doc;
    const stored = prototypeView().starts[fileId];
    const start = stored && doc.nodes[stored] ? stored : startScreen(doc, []);
    if (!start) return;
    if (start !== stored) setPrototypeStart(fileId, start);
    editor.set({ homeOpen: false, presentingId: start, hoverId: null, contextMenu: null });
}
// Closed this session, newest first, for File > Reopen Closed Tab and Recently Closed Tabs.
let closed: string[] = [];
export function closedTabs(): { id: string; name: string }[] {
    return closed.flatMap((id) => {
        const m = fileMeta(id);
        return m && !m.trashed ? [{ id, name: m.name }] : [];
    });
}
export function reopenClosedTab(id?: string): boolean {
    const pick = id ?? closedTabs()[0]?.id;
    if (!pick || !fileMeta(pick)) return false;
    closed = closed.filter((t) => t !== pick);
    void openFile(pick);
    return true;
}

export function closeTab(id: string) {
    // Closing a prototype's tab goes back to its file's tab.
    const proto = protoFileOf(id);
    if (proto) {
        writeTabs(readTabs().filter((t) => t !== id));
        forgetPrototype(proto);
        const s = editor.get();
        if (s.fileId === proto && s.presentingId) editor.set({ presentingId: null, homeOpen: false });
        return;
    }
    // The file's last edits are written before it stops being the open file.
    if (editor.get().fileId === id) editor.flushSave();
    closed = [id, ...closed.filter((t) => t !== id)].slice(0, 10);
    // The file's prototype tab plays the file's document, so it closes with it.
    writeTabs(readTabs().filter((t) => t !== id && t !== protoTabId(id)));
    forgetPrototype(id);
    const s = editor.get();
    if (s.fileId === id) {
        const rest = getTabs();
        const next = rest[rest.length - 1];
        if (next) void activateTab(next);
        else editor.set({ fileId: null, homeOpen: true, presentingId: null });
    }
}

export function fileMeta(id: string | null): FileMeta | undefined {
    return id ? read().find((f) => f.id === id) : undefined;
}

function update(id: string, patch: Partial<FileMeta>) {
    index = read().map((f) => (f.id === id ? { ...f, ...patch } : f));
    write();
}

// Changes several files at once (folders move, trash and restore their files together).
export function patchFiles(change: (f: FileMeta) => Partial<FileMeta> | null) {
    let changed = false;
    index = read().map((f) => {
        const patch = change(f);
        if (!patch) return f;
        changed = true;
        return { ...f, ...patch };
    });
    if (changed) write();
}

// Puts a file in a Drafts folder (null: the top of Drafts).
export function setFileFolder(id: string, folderId: string | null) {
    update(id, { folderId });
}

// An empty design file: one page, nothing on it.
export function createEmptyDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {} };
    const page = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1" });
    return { ...base, nodes: { [page.id]: page }, roots: [page.id] };
}

export function createFile(kind: FileKind, doc?: NagmaDocument, name?: string): FileMeta {
    let document = doc ?? (kind === "board" ? createBoardDocument(name ?? "Untitled") : kind === "slides" ? createSlidesDocument(name ?? "Untitled") : kind === "campaign" ? createCampaignDocument(name ?? "Untitled campaign") : kind === "site" ? createSiteDocument(name ?? "Untitled site") : kind === "make" ? createMakeDocument(name ?? "Untitled app") : createEmptyDocument(name ?? "Untitled"));
    if (kind === "video" && !document.sequence) document = { ...document, sequence: { width: 1920, height: 1080, fps: 30, clips: [] } };
    const meta: FileMeta = { id: nanoid(10), name: name ?? document.name ?? "Untitled", kind, createdAt: Date.now(), updatedAt: Date.now() };
    void saveDoc(docKey(meta.id), { ...document, name: meta.name }).catch(() => undefined);
    index = [meta, ...read()];
    write();
    return meta;
}

export async function loadFileDocument(id: string): Promise<NagmaDocument | null> {
    return prepareDocument(await loadDoc(docKey(id)));
}

// Opens a file in the editor. Shared files are joined on the server by the caller (collab.join).
export async function openFile(id: string): Promise<boolean> {
    const meta = fileMeta(id);
    if (!meta) return false;
    // The open file's last edits reach storage first, so reopening it doesn't read an older copy.
    editor.flushSave();
    // A file on the server opens by joining its room (as from Home): its tab, Reopen Closed Tab and
    // the rest otherwise showed the last file's document under this file's name, offline.
    const openShared = sharedOpener();
    if (meta.shared && !meta.trashed && openShared) {
        editor.set({ fileId: id, homeOpen: false, presentingId: null, sequenceView: meta.kind === "video" });
        addTab(id);
        update(id, { updatedAt: Date.now() });
        return openShared(meta);
    }
    // A shared file with no copy here opens from its offline copy (Make available offline) until the
    // server sends it.
    const doc = (await loadFileDocument(id)) ?? (meta.shared ? prepareDocument(await loadOffline(id)) : createEmptyDocument(meta.name));
    // The file id goes first, so the load's commit is credited to this file, not the last one.
    editor.set({ fileId: id, homeOpen: false, presentingId: null, sequenceView: meta.kind === "video" });
    addTab(id);
    if (doc) editor.loadDocument({ ...doc, name: meta.name }, docKey(id));
    update(id, { updatedAt: Date.now() });
    scheduleMigration();
    // Video files picture their sequence (the video editor renders it), and Document files their
    // first page (the PDF workbench draws it).
    if (doc && !meta.thumb && meta.kind !== "video" && !doc.pdf && !doc.make) {
        void preloadImages(doc.images).then(() => {
            try {
                update(id, { thumb: renderThumb(doc) });
            } catch {
                // A picture is a nicety.
            }
        });
    }
    editor.set({ fileId: id, homeOpen: false });
    return true;
}

export function openHome() {
    editor.set({ homeOpen: true, presentingId: null, selection: [], editingTextId: null });
}

export function renameFile(id: string, name: string) {
    update(id, { name });
    if (editor.get().fileId === id && editor.get().doc.name !== name) editor.execute({ type: "doc.rename", name });
}

export function trashFile(id: string) {
    update(id, { trashed: true, trashedAt: Date.now() });
    writeTabs(readTabs().filter((t) => t !== id && t !== protoTabId(id)));
    if (editor.get().fileId === id) editor.set({ fileId: null, homeOpen: true, presentingId: null });
}

export function restoreFile(id: string) {
    update(id, { trashed: false, trashedWith: null });
}

export function deleteForever(id: string) {
    index = read().filter((f) => f.id !== id);
    void deleteDoc(docKey(id));
    write();
}

// Removes a file that was only just made (an import that turned out empty): its tab closes
// without joining the recently closed tabs, the file is deleted, and Home shows again.
export function discardFile(id: string) {
    writeTabs(readTabs().filter((t) => t !== id && t !== protoTabId(id)));
    if (editor.get().fileId === id) {
        // It stops autosaving first, so no save lands after the delete.
        editor.setStorageKey(null);
        editor.set({ fileId: null, homeOpen: true, presentingId: null });
    }
    deleteForever(id);
}

export async function duplicateFile(id: string): Promise<FileMeta | null> {
    const meta = fileMeta(id);
    if (!meta) return null;
    const doc = editor.get().fileId === id ? editor.committed() : await loadFileDocument(id);
    if (!doc) return null;
    const copy = createFile(meta.kind, { ...doc, name: `Copy of ${meta.name}` }, `Copy of ${meta.name}`);
    update(copy.id, { thumb: meta.thumb });
    return copy;
}

// A shared file opened from a link: listed so it can be reopened from Home.
export function rememberShared(sharedId: string, name: string, key?: string | null, kind?: FileKind): FileMeta {
    const existing = read().find((f) => f.shared === sharedId);
    if (existing) {
        update(existing.id, { updatedAt: Date.now(), name, ...(key ? { key } : {}) });
        return { ...existing, name, key: key ?? existing.key };
    }
    const meta: FileMeta = { id: nanoid(10), name, kind: kind ?? "design", createdAt: Date.now(), updatedAt: Date.now(), shared: sharedId, key: key ?? null };
    index = [meta, ...read()];
    write();
    return meta;
}

export function markShared(id: string, sharedId: string) {
    update(id, { shared: sharedId });
}

// Pins a draft to the top of its Drafts folder (team files are pinned on the server).
export function setFilePinned(id: string, pinned: boolean) {
    if (fileMeta(id)) update(id, { pinned });
}

// A picture for the file card made elsewhere (the video editor's frame).
export function setFileThumb(id: string, thumb: string) {
    if (fileMeta(id)) update(id, { thumb });
}

// The frame the open file's card shows, if one was picked.
export function thumbnailFrame(): string | null {
    return fileMeta(editor.get().fileId)?.thumbFrame ?? null;
}

// "Restore default thumbnail": the card goes back to picturing the first page.
export function restoreDefaultThumbnail(id = editor.get().fileId) {
    const meta = fileMeta(id);
    if (!id || !meta?.thumbFrame) return;
    const current = editor.get();
    update(id, { thumbFrame: undefined, ...(current.fileId === id ? { thumb: renderThumb(current.doc, 320, 200) } : {}) });
    editor.notify("Thumbnail restored to the first page.");
}

// "Set as thumbnail" on a frame: the file card shows that frame from now on.
export function setAsThumbnail(frameId: string) {
    const { fileId, doc } = editor.get();
    if (!fileId || !fileMeta(fileId)) return;
    void preloadImages(doc.images).then(() => {
        update(fileId, { thumbFrame: frameId, thumb: renderThumb(editor.get().doc, 320, 200, frameId) });
        editor.notify("Thumbnail set.");
    });
}

export function sampleFile(): FileMeta {
    return createFile("design", createSampleDocument(), "Sample app");
}

// Keeps the library in step with edits: the name, the time, and (a moment later) the picture.
let thumbTimer = 0;
editor.onCommit((_before, after) => {
    const id = editor.get().fileId;
    if (!id) return;
    const meta = fileMeta(id);
    if (!meta) return;
    update(id, { updatedAt: Date.now(), ...(after.name && after.name !== meta.name ? { name: after.name } : {}) });
    window.clearTimeout(thumbTimer);
    // Make files are pictured by their app's preview (make/preview-pane.tsx).
    if ((meta.kind === "video" && editor.get().sequenceView) || after.pdf || after.make) {
        scheduleMigration();
        return;
    }
    thumbTimer = window.setTimeout(() => {
        const current = editor.get();
        if (current.fileId !== id) return;
        void preloadImages(current.doc.images).then(() => {
            try {
                update(id, { thumb: renderThumb(editor.get().doc, 320, 200, fileMeta(id)?.thumbFrame) });
            } catch {
                // A picture is a nicety.
            }
        });
    }, 1500);
    scheduleMigration();
});

// Files that still embed images as data URLs get them moved to the media store, a few per pass,
// without touching undo history.
let migrating = false;
let migrateTimer = 0;
export function scheduleMigration() {
    window.clearTimeout(migrateTimer);
    migrateTimer = window.setTimeout(async () => {
        if (migrating || editor.get().readOnly) return;
        migrating = true;
        try {
            const moved = await migrateEmbedded(editor.get().doc.images);
            if (moved.length) {
                editor.executeSilently({ type: "batch", commands: moved.map((m) => ({ type: "image.set" as const, id: m.id, data: m.ref })) });
                scheduleMigration();
            }
        } finally {
            migrating = false;
        }
    }, 800);
}

// Opens the most recent file at start, or Home when there's nothing yet.
export async function openLastFile(rejoin: (meta: FileMeta) => Promise<boolean>) {
    // Drafts saved by earlier versions move from localStorage into IndexedDB first; the single
    // draft from before the library was imported when the library was made.
    await migrateLocalStorage("nagma.file.");
    if (read().length) userStorage.removeItem(LEGACY_KEY);
    const files = read().filter((f) => !f.trashed);
    const last = [...files].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!last) {
        editor.set({ homeOpen: true });
        return;
    }
    if (!last.shared) {
        await openFile(last.id);
        return;
    }
    // The last file was a shared one: rejoin it on the server, or start on Home if that fails.
    const ok = await rejoin(last);
    if (!ok) editor.set({ fileId: null, homeOpen: true });
}

// ---- The team's files on the sync server ----

export interface ServerFile {
    id: string;
    name: string;
    kind: FileKind;
    updatedAt: number;
    thumb: string | null;
    // Pinned to the top of its folder.
    pinned?: boolean;
    trashed: boolean;
    trashedWith?: string | null;
    trashedAt?: number | null;
    trashedBy?: string | null;
    createdAt?: number | null;
    keys: { edit: string; view: string } | null;
    owner: { id: string; name: string; email: string; color: string } | null;
    role: "edit" | "view";
    project: string | null;
    team: string | null;
    // A file from before accounts that you (a server admin) can make yours.
    claimable?: boolean;
    // You were invited to it, so you can leave it.
    invited?: boolean;
}

let serverFiles: ServerFile[] = [];
let serverOnline = false;
const serverListeners = new Set<() => void>();

export function subscribeServerFiles(listener: () => void) {
    serverListeners.add(listener);
    return () => serverListeners.delete(listener);
}

export function getServerFiles(): ServerFile[] {
    return serverFiles;
}

export function isServerOnline(): boolean {
    return serverOnline;
}

export async function refreshServerFiles(): Promise<void> {
    try {
        const res = await fetch(`${httpBase()}/files`, { headers: authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        serverFiles = (await res.json()) as ServerFile[];
        serverOnline = true;
    } catch {
        serverOnline = false;
    }
    for (const l of serverListeners) l();
}

// Tells the server what a shared file is (its name, kind, picture, trash state). The link key this
// browser opened it with goes along, so people editing through a link can change it too.
export async function putServerMeta(sharedId: string, patch: { name?: string; kind?: FileKind; thumb?: string; trashed?: boolean; pinned?: boolean }): Promise<void> {
    const key = read().find((f) => f.shared === sharedId)?.key ?? serverFiles.find((f) => f.id === sharedId)?.keys?.edit;
    try {
        await fetch(`${httpBase()}/files/${encodeURIComponent(sharedId)}/meta${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "PUT", body: JSON.stringify(patch), headers: { "content-type": "application/json", ...authHeaders() } });
    } catch {
        // Offline: the next edit tries again.
    }
}

// Renames a server file from Home: everyone with it open sees the new name straight away.
export async function renameServerFile(sharedId: string, name: string): Promise<void> {
    await putServerMeta(sharedId, { name });
    const local = read().find((f) => f.shared === sharedId);
    if (local) update(local.id, { name });
    await refreshServerFiles();
}

// Duplicates a server file into your drafts on the server.
export async function duplicateServerFile(sharedId: string): Promise<{ id: string; keys: { edit: string; view: string }; name: string; kind: FileKind }> {
    const key = read().find((f) => f.shared === sharedId)?.key ?? serverFiles.find((f) => f.id === sharedId)?.keys?.edit;
    const res = await fetch(`${httpBase()}/files/${encodeURIComponent(sharedId)}/duplicate${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "POST", headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as { id?: string; keys?: { edit: string; view: string }; name?: string; kind?: FileKind; error?: string };
    if (!res.ok || !data.id || !data.keys) throw new Error(data.error ?? "The server couldn't duplicate that file.");
    await refreshServerFiles();
    return { id: data.id, keys: data.keys, name: data.name ?? "Copy", kind: data.kind ?? "design" };
}

// Makes a file from before accounts yours (server admins only). Its links change.
export async function claimServerFile(sharedId: string): Promise<void> {
    const res = await fetch(`${httpBase()}/files/${encodeURIComponent(sharedId)}/claim`, { method: "POST", headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "The server couldn't claim that file.");
    await refreshServerFiles();
}

// Takes you off a file you were invited to.
export async function leaveServerFile(sharedId: string): Promise<void> {
    const res = await fetch(`${httpBase()}/files/${encodeURIComponent(sharedId)}/leave`, { method: "POST", headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "The server couldn't take you off that file.");
    await refreshServerFiles();
}

// ---- Starred files: kept in this browser, shown under Starred on Home ----

const STARRED_FILES_KEY = "nagma.starredFiles.v1";
let starredFiles: string[] | null = null;
const starListeners = new Set<() => void>();

// A file's star key: its server id when it has one (the same on every listing), else its local id.
export const starKey = (f: Pick<FileMeta, "id" | "shared">) => f.shared ?? f.id;

export function getStarredFiles(): string[] {
    if (starredFiles) return starredFiles;
    try {
        starredFiles = JSON.parse(userStorage.getItem(STARRED_FILES_KEY) ?? "[]") as string[];
    } catch {
        starredFiles = [];
    }
    return starredFiles;
}

export function subscribeStarredFiles(listener: () => void) {
    starListeners.add(listener);
    return () => starListeners.delete(listener);
}

export function toggleStarFile(key: string) {
    const list = getStarredFiles();
    replaceStarredFiles(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
}
// The whole list at once (from the account's saved stars).
export function replaceStarredFiles(list: string[]) {
    starredFiles = list;
    try {
        userStorage.setItem(STARRED_FILES_KEY, JSON.stringify(starredFiles));
    } catch {
        // Stars still work for this session.
    }
    for (const l of starListeners) l();
}

// Another account: its own index, tabs and stars (the app normally reloads for it first).
onScopeChange(() => {
    index = null;
    tabs = null;
    starredFiles = null;
    closed = [];
    for (const l of listeners) l();
    for (const l of tabListeners) l();
    for (const l of starListeners) l();
});

// Shared files also keep the server's picture and kind up to date.
let serverThumbTimer = 0;
editor.onCommit(() => {
    const id = editor.get().fileId;
    const meta = fileMeta(id);
    if (!meta?.shared) return;
    window.clearTimeout(serverThumbTimer);
    serverThumbTimer = window.setTimeout(() => {
        const current = editor.get();
        if (current.fileId !== id) return;
        void preloadImages(current.doc.images).then(() => {
            try {
                const doc = editor.get().doc;
                const thumb = doc.pdf || doc.make ? fileMeta(id)?.thumb : renderThumb(doc);
                void putServerMeta(meta.shared as string, { kind: doc.pdf ? "docs" : meta.kind, ...(thumb ? { thumb } : {}) });
            } catch {
                // A picture is a nicety.
            }
        });
    }, 2500);
});

// Opens a .fig, .deck or .buzz as a new file of the matching kind (design, slides, campaign).
export async function importFigFile(file: File): Promise<FileMeta> {
    const { importFig } = await import("./fig-import");
    const { productDocument } = await import("./fig-products");
    const result = await importFig(file);
    const { skipped } = result;
    const { doc, kind } = productDocument(result);
    const meta = createFile(kind, doc, doc.name);
    await openFile(meta.id);
    editor.notify(skipped.length ? `Opened ${file.name}. Not carried over: ${skipped.join(", ")}.` : `Opened ${file.name}.`);
    return meta;
}

// Import: one picker for every kind of file Nagma opens (engine/images.ts has the list).
export function pickFigFile() {
    void import("./images").then((m) => m.pickImportFiles());
}

// Removes a server file for good (owner or editor), or empties your server trash.
export async function deleteServerForever(sharedId: string): Promise<void> {
    const res = await fetch(`${httpBase()}/files/${sharedId}/forever`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    await refreshServerFiles();
}

export async function emptyServerTrash(): Promise<number> {
    const res = await fetch(`${httpBase()}/files/trash`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const { removed } = (await res.json()) as { removed: number };
    await refreshServerFiles();
    return removed;
}

export function emptyLocalTrash(): number {
    const trashed = read().filter((f) => f.trashed && !f.id.startsWith("server:"));
    for (const f of trashed) deleteForever(f.id);
    return trashed.length;
}

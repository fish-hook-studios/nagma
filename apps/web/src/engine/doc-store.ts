import { legacyStorageReady } from "./legacy-names";
import type { NagmaDocument } from "./types";
import { currentScope, docsDbName, storageFrozen, userStorage } from "./user-storage";

// Local drafts live in IndexedDB, keyed by their file id, with far more room than localStorage.
// Writes are serialised per key, so a burst of autosaves lands in order. Each account (and guest)
// has a database of its own (engine/user-storage.ts); `owner` picks another account's, and is
// otherwise the account signed in when the call is made.

const STORE = "docs";

async function openDb(name: string): Promise<IDBDatabase> {
    // The rename's copy of the old database must land before any account database is adopted.
    await legacyStorageReady();
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const queues = new Map<string, Promise<void>>();

function enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(key, next);
    return next;
}

// Resolves once every write asked for so far has landed (before the page reloads for another account).
export async function docWritesSettled(): Promise<void> {
    await Promise.all([...queues.values()].map((p) => p.catch(() => undefined)));
}

// Images are kept as their own records ("<key>#img#<id>") and written when new or changed (an
// image moved to the media store, a Document's PDF saved again), so an autosave only stores the
// layers. The layers go in as a structured clone, not a JSON string.
const written = new Map<string, Map<string, string>>();
const imageKey = (key: string, id: string) => `${key}#img#${id}`;

interface StoredDoc extends Omit<NagmaDocument, "images"> {
    imageIds: string[];
    // Large documents keep their layers in several records ("<key>#nodes#<i>"): a browser caps
    // one record at about 133 MB, which a big design system file goes past.
    nodeChunks?: number;
}

const NODES_PER_CHUNK = 4000;
const chunkKey = (key: string, i: number) => `${key}#nodes#${i}`;

export function saveDoc(key: string, doc: NagmaDocument, owner: string = currentScope()): Promise<void> {
    // Switching accounts: the page is about to reload, and what it still holds isn't the next account's.
    if (storageFrozen()) return Promise.resolve();
    const name = docsDbName(owner);
    const cacheKey = `${name}|${key}`;
    return enqueue(cacheKey, async () => {
        const db = await openDb(name);
        const { images, ...rest } = doc;
        const ids = Object.keys(images ?? {});
        const done = written.get(cacheKey) ?? new Map<string, string>();
        const fresh = ids.filter((id) => done.get(id) !== images[id]);
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            const store = tx.objectStore(STORE);
            for (const id of fresh) store.put(images[id], imageKey(key, id));
            const entries = Object.entries(rest.nodes);
            if (entries.length <= NODES_PER_CHUNK) store.put({ ...rest, imageIds: ids } satisfies StoredDoc, key);
            else {
                const chunks = Math.ceil(entries.length / NODES_PER_CHUNK);
                for (let i = 0; i < chunks; i++) store.put(Object.fromEntries(entries.slice(i * NODES_PER_CHUNK, (i + 1) * NODES_PER_CHUNK)), chunkKey(key, i));
                store.put({ ...rest, nodes: {}, imageIds: ids, nodeChunks: chunks } satisfies StoredDoc, key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        for (const id of fresh) done.set(id, images[id] as string);
        written.set(cacheKey, done);
        db.close();
    });
}

export async function loadDoc(key: string, owner: string = currentScope()): Promise<NagmaDocument | null> {
    const name = docsDbName(owner);
    const cacheKey = `${name}|${key}`;
    await queues.get(cacheKey);
    try {
        const db = await openDb(name);
        const store = () => db.transaction(STORE, "readonly").objectStore(STORE);
        const get = <T,>(k: string) =>
            new Promise<T | undefined>((resolve, reject) => {
                const req = store().get(k);
                req.onsuccess = () => resolve(req.result as T | undefined);
                req.onerror = () => reject(req.error);
            });
        const raw = await get<string | StoredDoc>(key);
        if (!raw) {
            db.close();
            return null;
        }
        // Older drafts are one JSON string with the images inside.
        if (typeof raw === "string") {
            db.close();
            return JSON.parse(raw) as NagmaDocument;
        }
        const { imageIds, nodeChunks, ...rest } = raw;
        if (nodeChunks) {
            const parts = await Promise.all(Array.from({ length: nodeChunks }, (_, i) => get<NagmaDocument["nodes"]>(chunkKey(key, i))));
            rest.nodes = Object.assign({}, ...parts.map((p) => p ?? {}));
        }
        const images: Record<string, string> = {};
        const entries = await Promise.all((imageIds ?? []).map(async (id) => [id, await get<string>(imageKey(key, id))] as const));
        for (const [id, data] of entries) if (data) images[id] = data;
        written.set(cacheKey, new Map(Object.entries(images)));
        db.close();
        return { ...rest, images } as NagmaDocument;
    } catch {
        return null;
    }
}

export function deleteDoc(key: string, owner: string = currentScope()): Promise<void> {
    // Switching accounts: the page is about to reload, and what it still holds isn't the next account's.
    if (storageFrozen()) return Promise.resolve();
    const name = docsDbName(owner);
    const cacheKey = `${name}|${key}`;
    return enqueue(cacheKey, async () => {
        try {
            const db = await openDb(name);
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                store.delete(key);
                // Its image and layer records too.
                store.delete(IDBKeyRange.bound(`${key}#`, `${key}#\uffff`));
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
            db.close();
            written.delete(cacheKey);
        } catch {
            // Nothing to delete.
        }
    });
}

// Drafts saved in localStorage by earlier versions move into IndexedDB once.
export async function migrateLocalStorage(prefix: string): Promise<number> {
    let moved = 0;
    try {
        const keys = userStorage.keys(prefix);
        for (const key of keys) {
            const raw = userStorage.getItem(key);
            if (!raw) continue;
            try {
                await saveDoc(key, JSON.parse(raw) as NagmaDocument);
                userStorage.removeItem(key);
                moved += 1;
            } catch {
                // Left in localStorage; tried again next start.
            }
        }
    } catch {
        // Storage unavailable.
    }
    return moved;
}

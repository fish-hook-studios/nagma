import { authHeaders } from "./auth";
import { legacyStorageReady } from "./legacy-names";
import { httpBase } from "./server-url";
import type { LibraryItem, LibraryManifest } from "./library-types";

// Where published libraries live. Each library is a manifest (what it holds, with a hash per item)
// plus one record per component (its layers) and per image, so a design system with thousands of
// components is never one giant record. This browser keeps every library it published or used in
// IndexedDB; libraries published from files on the sync server are on the server too, where the
// rest of the team finds them.

const DB = "nagma.libraries";
const MANIFESTS = "manifests";
const ITEMS = "items";

async function openDb(): Promise<IDBDatabase> {
    await legacyStorageReady();
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(MANIFESTS);
            req.result.createObjectStore(ITEMS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
    dbPromise ??= openDb().catch((error) => {
        dbPromise = null;
        throw error;
    });
    return dbPromise;
}

const itemKey = (libraryId: string, key: string) => `${libraryId}|${key}`;

function request<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function localManifests(): Promise<LibraryManifest[]> {
    try {
        const d = await db();
        return await request<LibraryManifest[]>(d.transaction(MANIFESTS, "readonly").objectStore(MANIFESTS).getAll());
    } catch {
        return [];
    }
}

export async function localManifest(id: string): Promise<LibraryManifest | null> {
    try {
        const d = await db();
        return (await request<LibraryManifest | undefined>(d.transaction(MANIFESTS, "readonly").objectStore(MANIFESTS).get(id))) ?? null;
    } catch {
        return null;
    }
}

export async function saveLocalManifest(manifest: LibraryManifest): Promise<void> {
    const d = await db();
    const tx = d.transaction(MANIFESTS, "readwrite");
    tx.objectStore(MANIFESTS).put(manifest, manifest.id);
    await done(tx);
}

export async function deleteLocalLibrary(id: string): Promise<void> {
    const d = await db();
    const tx = d.transaction([MANIFESTS, ITEMS], "readwrite");
    tx.objectStore(MANIFESTS).delete(id);
    tx.objectStore(ITEMS).delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`));
    await done(tx);
}

// Writes item records a few hundred per transaction, so a big library doesn't block the page.
export async function saveLocalItems(libraryId: string, items: [string, LibraryItem][], onProgress?: (n: number) => void): Promise<void> {
    const d = await db();
    for (let i = 0; i < items.length; i += 300) {
        const tx = d.transaction(ITEMS, "readwrite");
        const store = tx.objectStore(ITEMS);
        for (const [key, item] of items.slice(i, i + 300)) store.put(item, itemKey(libraryId, key));
        await done(tx);
        onProgress?.(Math.min(items.length, i + 300));
    }
}

export async function deleteLocalItems(libraryId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const d = await db();
    const tx = d.transaction(ITEMS, "readwrite");
    for (const key of keys) tx.objectStore(ITEMS).delete(itemKey(libraryId, key));
    await done(tx);
}

export async function localItems(libraryId: string, keys: string[]): Promise<Map<string, LibraryItem>> {
    const out = new Map<string, LibraryItem>();
    if (!keys.length) return out;
    try {
        const d = await db();
        const store = d.transaction(ITEMS, "readonly").objectStore(ITEMS);
        await Promise.all(
            keys.map(async (key) => {
                const item = await request<LibraryItem | undefined>(store.get(itemKey(libraryId, key)));
                if (item) out.set(key, item);
            }),
        );
    } catch {
        // Missing items are fetched from the server.
    }
    return out;
}

// ---- The sync server ----

const json = { "content-type": "application/json" };

export async function serverManifests(): Promise<LibraryManifest[]> {
    try {
        const res = await fetch(`${httpBase()}/libraries`, { headers: authHeaders() });
        if (!res.ok) return [];
        return (await res.json()) as LibraryManifest[];
    } catch {
        return [];
    }
}

export async function serverManifest(id: string): Promise<LibraryManifest | null> {
    try {
        const res = await fetch(`${httpBase()}/libraries/${encodeURIComponent(id)}`, { headers: authHeaders() });
        if (!res.ok) return null;
        return (await res.json()) as LibraryManifest;
    } catch {
        return null;
    }
}

export async function serverItems(libraryId: string, keys: string[]): Promise<Map<string, LibraryItem>> {
    const out = new Map<string, LibraryItem>();
    for (let i = 0; i < keys.length; i += 200) {
        try {
            const res = await fetch(`${httpBase()}/libraries/${encodeURIComponent(libraryId)}/items/get`, { method: "POST", headers: { ...json, ...authHeaders() }, body: JSON.stringify({ keys: keys.slice(i, i + 200) }) });
            if (!res.ok) continue;
            const got = (await res.json()) as Record<string, LibraryItem>;
            for (const [k, v] of Object.entries(got)) out.set(k, v);
        } catch {
            // Offline: whatever came through is used.
        }
    }
    return out;
}

// Uploads items in batches of a few megabytes, then the manifest (which makes the version live).
export async function publishToServer(manifest: LibraryManifest, items: [string, LibraryItem][], removed: string[], onProgress?: (n: number) => void): Promise<void> {
    const base = `${httpBase()}/libraries/${encodeURIComponent(manifest.id)}`;
    let batch: Record<string, LibraryItem> = {};
    let size = 0;
    let sent = 0;
    const flush = async () => {
        const count = Object.keys(batch).length;
        if (!count) return;
        const res = await fetch(`${base}/items`, { method: "PUT", headers: { ...json, ...authHeaders() }, body: JSON.stringify({ items: batch }) });
        if (!res.ok) throw new Error(await res.text());
        sent += count;
        onProgress?.(sent);
        batch = {};
        size = 0;
    };
    for (const [key, item] of items) {
        const text = JSON.stringify(item);
        if (size + text.length > 4_000_000) await flush();
        batch[key] = item;
        size += text.length;
    }
    await flush();
    const res = await fetch(base, { method: "PUT", headers: { ...json, ...authHeaders() }, body: JSON.stringify({ manifest, removed }) });
    if (!res.ok) throw new Error(await res.text());
}

export async function unpublishFromServer(id: string): Promise<void> {
    await fetch(`${httpBase()}/libraries/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }).catch(() => undefined);
}

// The product was called Migfa before it was Nagma. What a browser kept under the old name moves
// to the new one here, before anything reads it (main.tsx imports this module first):
//   - localStorage and sessionStorage keys "migfa.*" become "nagma.*";
//   - the IndexedDB databases (drafts, libraries, media, plugins) are copied to their new names,
//     with "migfa.*" record keys renamed the same way, and the old databases are then deleted;
//   - the prototypes kept for offline use move to the new cache.
// The readers of things another copy of the app may still write (clipboard formats, the desktop
// app's bridge, plugins written against the old global) take the old names from `legacy`.
// tools/rename-nagma.sh leaves this file as it is.

const OLD = "migfa";
const NEW = "nagma";

export const legacy = {
    storagePrefix: `${OLD}.`,
    databases: [`${OLD}.docs`, `${OLD}.libraries`, `${OLD}.media`, `${OLD}.plugins`],
    offlineCache: `${OLD}-offline-v1`,
    // Clipboard: rich text (a MIME type, and the HTML flavour's data attribute), easing curves and layers.
    textMime: `application/x-${OLD}-text`,
    textDataAttr: `data-${OLD}-text`,
    easingPrefix: `${OLD}-easing:`,
    layersMarker: `${OLD}/layers:`,
    // Plugins: the API's global.
    pluginGlobal: OLD,
    // Make apps generated before the rename read their access token from this meta tag.
    appTokenMeta: `${OLD}-app-token`,
    // The desktop app (apps/desktop/preload.cjs, main.cjs) before the rename.
    desktopBridge: `${OLD}Desktop`,
    desktopMenu: `__${OLD}Menu`,
} as const;

/** "migfa.x" -> "nagma.x"; anything else as it is. */
export function renamedKey(key: string): string {
    return key.startsWith(legacy.storagePrefix) ? `${NEW}.${key.slice(legacy.storagePrefix.length)}` : key;
}

/** Moves "migfa.*" keys to "nagma.*" (a key already there under the new name wins). Returns the count. */
export function migrateWebStorage(storage: Storage): number {
    let moved = 0;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(legacy.storagePrefix)) keys.push(key);
    }
    for (const key of keys) {
        const next = renamedKey(key);
        const value = storage.getItem(key);
        if (value === null) continue;
        if (storage.getItem(next) !== null) continue;
        // Old and new keys are the same length, so removing first always leaves room for the copy.
        storage.removeItem(key);
        try {
            storage.setItem(next, value);
            moved += 1;
        } catch {
            storage.setItem(key, value);
        }
    }
    return moved;
}

function migrateBrowserStorage() {
    for (const get of [() => localStorage, () => sessionStorage]) {
        try {
            migrateWebStorage(get());
        } catch {
            // Storage unavailable (private mode, a sandboxed frame).
        }
    }
}

// ---- IndexedDB ------------------------------------------------------------------------------------

const done = <T,>(req: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

const finished = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

// The old database if this browser has one; never creates it.
async function openIfExists(name: string): Promise<IDBDatabase | null> {
    try {
        if (typeof indexedDB.databases === "function") {
            const list = await indexedDB.databases();
            if (!list.some((d) => d.name === name)) return null;
        }
    } catch {
        // Fall through to opening it.
    }
    return new Promise((resolve) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(name);
        } catch {
            resolve(null);
            return;
        }
        // A new database means there was none: abort, which also discards it.
        req.onupgradeneeded = (event) => {
            if (event.oldVersion === 0) req.transaction?.abort();
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = (event) => {
            event.preventDefault();
            resolve(null);
        };
    });
}

interface StoreShape {
    name: string;
    keyPath: string | string[] | null;
    autoIncrement: boolean;
    indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
}

async function copyDatabase(from: string, to: string): Promise<void> {
    const old = await openIfExists(from);
    if (!old) return;
    try {
        const names = Array.from(old.objectStoreNames);
        const shapes: StoreShape[] = [];
        if (names.length) {
            const tx = old.transaction(names, "readonly");
            for (const name of names) {
                const s = tx.objectStore(name);
                shapes.push({
                    name,
                    keyPath: s.keyPath,
                    autoIncrement: s.autoIncrement,
                    indexes: Array.from(s.indexNames).map((n) => {
                        const index = s.index(n);
                        return { name: n, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
                    }),
                });
            }
        }
        const fresh = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(to);
            req.onupgradeneeded = () => {
                for (const shape of shapes) {
                    if (req.result.objectStoreNames.contains(shape.name)) continue;
                    const store = req.result.createObjectStore(shape.name, { keyPath: shape.keyPath ?? undefined, autoIncrement: shape.autoIncrement });
                    for (const i of shape.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        let complete = true;
        try {
            for (const shape of shapes) {
                if (!fresh.objectStoreNames.contains(shape.name)) {
                    complete = false;
                    continue;
                }
                const read = old.transaction(shape.name, "readonly").objectStore(shape.name);
                const [keys, values] = await Promise.all([done(read.getAllKeys()), done(read.getAll())]);
                const have = new Set((await done(fresh.transaction(shape.name, "readonly").objectStore(shape.name).getAllKeys())).map((k) => JSON.stringify(k)));
                const tx = fresh.transaction(shape.name, "readwrite");
                const store = tx.objectStore(shape.name);
                keys.forEach((key, i) => {
                    const next = typeof key === "string" ? renamedKey(key) : key;
                    if (have.has(JSON.stringify(next))) return;
                    if (shape.keyPath === null) store.put(values[i], next);
                    else store.put(values[i]);
                });
                await finished(tx);
                const count = await done(fresh.transaction(shape.name, "readonly").objectStore(shape.name).count());
                if (count < keys.length) complete = false;
            }
        } finally {
            fresh.close();
        }
        old.close();
        // Everything is in the new database: the old one goes, so its space comes back. When a tab
        // still has it open the delete waits; the next start tries again (copying only what's missing).
        if (complete)
            await new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(from);
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
            });
    } catch {
        old.close();
    }
}

async function migrateOfflineCache(): Promise<void> {
    if (typeof caches === "undefined") return;
    try {
        if (!(await caches.has(legacy.offlineCache))) return;
        const from = await caches.open(legacy.offlineCache);
        const to = await caches.open(`${NEW}-offline-v1`);
        for (const req of await from.keys()) {
            if (await to.match(req)) continue;
            const res = await from.match(req);
            if (res) await to.put(req, res);
        }
        await caches.delete(legacy.offlineCache);
    } catch {
        // Kept for the next start.
    }
}

let ready: Promise<void> | null = null;

/** Resolves once the old databases and offline cache are under their new names. Openers of those stores wait for it. */
export function legacyStorageReady(): Promise<void> {
    ready ??= (async () => {
        if (typeof indexedDB !== "undefined") await Promise.all(legacy.databases.map((name) => copyDatabase(name, renamedKey(name))));
        await migrateOfflineCache();
    })().catch(() => undefined);
    return ready;
}

// ---- The desktop app before the rename ---------------------------------------------------------------

function adoptOldDesktopBridge() {
    if (typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    // An older desktop app exposes its bridge under the old name.
    if (!w[`${NEW}Desktop`] && w[legacy.desktopBridge]) w[`${NEW}Desktop`] = w[legacy.desktopBridge];
    // ...and calls its menu actions through the old name (engine/desktop.ts sets the new one).
    if (!(legacy.desktopMenu in w))
        Object.defineProperty(w, legacy.desktopMenu, { configurable: true, get: () => w[`__${NEW}Menu`] });
}

migrateBrowserStorage();
adoptOldDesktopBridge();
if (typeof window !== "undefined" && typeof indexedDB !== "undefined") void legacyStorageReady();

import { authHeaders } from "./auth";
import { legacyStorageReady } from "./legacy-names";
import { httpBase } from "./server-url";

// Large media (video files) lives outside the document: in this browser's IndexedDB, and on the
// sync server so collaborators and other devices get it. Reads try the local copy, then the
// server, and keep what they fetch.

const DB = "nagma.media";
const STORE = "blobs";

async function openDb(): Promise<IDBDatabase> {
    await legacyStorageReady();
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function putLocal(id: string, blob: Blob): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function getLocal(id: string): Promise<Blob | null> {
    try {
        const db = await openDb();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
            req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return blob;
    } catch {
        return null;
    }
}

// Media on the server belongs to files: uploads say which file they're for, and reads say which
// file (and link key) they come from, along with the signed-in session.
let context: { fileId: string | null; key: string | null } = { fileId: null, key: null };
// Other files an asset may be reached through (a library it came from), by media id.
const sources = new Map<string, string>();

export function setMediaContext(fileId: string | null, key: string | null) {
    const was = context.fileId;
    context = { fileId, key };
    if (fileId && fileId !== was) void retryUploads();
}

export function hintMediaSource(id: string, fileId: string) {
    sources.set(id, fileId);
}

function mediaUrl(id: string, files: (string | null | undefined)[]) {
    const params = new URLSearchParams();
    for (const f of files) if (f) params.append("file", f);
    if (context.key) params.set("key", context.key);
    const query = params.toString();
    return `${httpBase()}/media/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

// Uploads that haven't reached the server yet (or were made before the file was on the server),
// retried when the file is shared and on the next store.
const pendingUploads = new Map<string, Blob>();

async function upload(id: string, blob: Blob, fileId = context.fileId): Promise<boolean> {
    if (!fileId) {
        pendingUploads.set(id, blob);
        return false;
    }
    try {
        const res = await fetch(mediaUrl(id, [fileId]), { method: "PUT", body: blob, headers: { "content-type": blob.type || "application/octet-stream", ...authHeaders() } });
        if (!res.ok && res.status !== 409) throw new Error(String(res.status));
        pendingUploads.delete(id);
        return true;
    } catch {
        pendingUploads.set(id, blob);
        return false;
    }
}

export async function retryUploads() {
    for (const [id, blob] of [...pendingUploads]) await upload(id, blob);
}

export async function storeMedia(id: string, blob: Blob): Promise<void> {
    // The file it's for is the one open now: another may be open by the time the local copy is
    // written (a Document's save just before switching files went up under the next file).
    const fileId = context.fileId;
    await putLocal(id, blob);
    // The server copy happens in the background; the editor doesn't wait for it.
    void upload(id, blob, fileId);
}

// After a file moves to the server: every asset it uses that's in this browser goes up with it.
export async function uploadUsedMedia(ids: Iterable<string>) {
    for (const id of new Set(ids)) {
        if (pendingUploads.has(id)) continue;
        const local = await getLocal(id);
        if (local) await upload(id, local);
    }
}

export async function loadMedia(id: string): Promise<Blob | null> {
    const local = await getLocal(id);
    if (local) return local;
    try {
        const res = await fetch(mediaUrl(id, [context.fileId, sources.get(id)]), { headers: authHeaders() });
        if (!res.ok) return null;
        const blob = await res.blob();
        await putLocal(id, blob).catch(() => undefined);
        return blob;
    } catch {
        return null;
    }
}

// An address that loads the asset without headers for a few minutes (for media elements).
export async function signedMediaUrl(id: string): Promise<string | null> {
    try {
        const res = await fetch(mediaUrl(id, [context.fileId, sources.get(id)]).replace(`/media/${encodeURIComponent(id)}`, `/media/${encodeURIComponent(id)}/url`), { headers: authHeaders() });
        if (!res.ok) return null;
        const data = (await res.json()) as { url: string };
        return `${httpBase()}${data.url}`;
    } catch {
        return null;
    }
}

// Media ids a document uses: image references, video files, uploaded fonts.
export function mediaIdsIn(value: unknown, out = new Set<string>()): Set<string> {
    if (typeof value === "string") {
        if (value.startsWith("media:")) out.add(value.slice(6));
    } else if (Array.isArray(value)) {
        for (const v of value) mediaIdsIn(v, out);
    } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
            if ((k === "media" || k === "store") && typeof v === "string") out.add(v);
            else if (k === "video" && v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") out.add((v as { id: string }).id);
            else mediaIdsIn(v, out);
        }
    }
    return out;
}

export async function deleteMedia(id: string): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
        db.close();
    } catch {
        // Nothing to do.
    }
}

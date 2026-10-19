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

function mediaUrl(id: string, files: (string | null | undefined)[], action?: "url" | "upload" | "complete") {
    const params = new URLSearchParams();
    for (const f of files) if (f) params.append("file", f);
    if (context.key) params.set("key", context.key);
    const query = params.toString();
    return `${httpBase()}/media/${encodeURIComponent(id)}${action ? `/${action}` : ""}${query ? `?${query}` : ""}`;
}

// ---- Problems people should hear about (a limit reached, a file too large) ----

const errorListeners = new Set<(message: string) => void>();

/** Calls `listener` with a message whenever an upload is refused for a reason worth saying. */
export function onMediaError(listener: (message: string) => void) {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
}

function reportError(message: string) {
    for (const l of errorListeners) l(message);
}

// Why an upload didn't go: `retry` says whether trying again later may work.
class UploadError extends Error {
    readonly retry: boolean;
    readonly quiet: boolean;
    constructor(message: string, retry: boolean, quiet = false) {
        super(message);
        this.retry = retry;
        this.quiet = quiet;
    }
}

async function refusal(res: Response, what: string): Promise<UploadError> {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const message = body?.error ?? `${what} failed (${res.status}).`;
    // 401/403: not signed in, or the file isn't on the server (yet): kept and tried again when it is.
    if (res.status === 401 || res.status === 403) return new UploadError(message, true, true);
    return new UploadError(message, res.status >= 500 || res.status === 429);
}

// The SHA-256 of the bytes as hex, so the server can skip storing the same bytes twice. Very large
// files skip it (hashing them would hold them in memory).
export async function contentHash(blob: Blob): Promise<string | undefined> {
    if (blob.size > 256 * 1024 * 1024 || !globalThis.crypto?.subtle) return undefined;
    try {
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
        return undefined;
    }
}

type UploadPlan = { mode: "direct"; url: string; headers?: Record<string, string>; expires?: number } | { mode: "server" } | { mode: "exists" };

/**
 * Sends one asset to the server's media store. The server says how: straight to its object store
 * with a presigned address (then this says it's complete), to the server itself, or not at all when
 * it has the same bytes already. Servers from before that question get the bytes with PUT.
 * Answers how it went up; throws an UploadError when it didn't.
 */
export async function sendMedia(id: string, blob: Blob, fileId: string): Promise<UploadPlan["mode"]> {
    const type = blob.type || "application/octet-stream";
    const sha256 = await contentHash(blob);
    const json = { "content-type": "application/json", ...authHeaders() };
    const asked = await fetch(mediaUrl(id, [fileId], "upload"), { method: "POST", headers: json, body: JSON.stringify({ type, size: blob.size, sha256 }) });
    let plan: UploadPlan;
    if (asked.status === 404 || asked.status === 405) plan = { mode: "server" };
    else if (!asked.ok) throw await refusal(asked, "The upload");
    else plan = (await asked.json()) as UploadPlan;
    if (plan.mode === "exists") return "exists";
    if (plan.mode === "direct") {
        const put = await fetch(plan.url, { method: "PUT", headers: plan.headers ?? { "content-type": type }, body: blob });
        if (!put.ok) throw new UploadError(`The upload to storage failed (${put.status}).`, true);
        const done = await fetch(mediaUrl(id, [fileId], "complete"), { method: "POST", headers: json, body: JSON.stringify({ sha256 }) });
        if (!done.ok) throw await refusal(done, "Finishing the upload");
        return "direct";
    }
    const res = await fetch(mediaUrl(id, [fileId]), { method: "PUT", body: blob, headers: { "content-type": type, ...authHeaders() } });
    if (!res.ok && res.status !== 409) throw await refusal(res, "The upload");
    return "server";
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
        await sendMedia(id, blob, fileId);
        pendingUploads.delete(id);
        return true;
    } catch (error) {
        const e = error instanceof UploadError ? error : new UploadError(String(error), true, true);
        if (e.retry) pendingUploads.set(id, blob);
        else pendingUploads.delete(id);
        if (!e.quiet) reportError(e.message);
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
    try {
        await putLocal(id, blob);
    } finally {
        // The server copy happens in the background (even when this browser couldn't keep one);
        // the editor doesn't wait for it.
        void upload(id, blob, fileId);
    }
}

// After a file moves to the server: every asset it uses that's in this browser goes up with it.
export async function uploadUsedMedia(ids: Iterable<string>) {
    for (const id of new Set(ids)) {
        if (pendingUploads.has(id)) continue;
        const local = await getLocal(id);
        if (local) await upload(id, local);
    }
}

// ---- Reading: a short-lived address per asset, kept until shortly before it expires ----
// With an object store it's a presigned address in the bucket (or its public address), so the
// bytes come from there; otherwise a signed address on the server.

const readUrls = new Map<string, { url: string; expires: number }>();
const readUrlLoads = new Map<string, Promise<string | null>>();
const URL_MARGIN_MS = 60_000;

export async function mediaReadUrl(id: string): Promise<string | null> {
    const known = readUrls.get(id);
    if (known && known.expires - URL_MARGIN_MS > Date.now()) return known.url;
    let p = readUrlLoads.get(id);
    if (!p) {
        p = (async () => {
            try {
                const res = await fetch(mediaUrl(id, [context.fileId, sources.get(id)], "url"), { headers: authHeaders() });
                if (!res.ok) return null;
                const data = (await res.json()) as { url: string; expires?: number };
                const url = /^https?:\/\//.test(data.url) ? data.url : `${httpBase()}${data.url}`;
                readUrls.set(id, { url, expires: data.expires ?? Date.now() + 5 * 60_000 });
                return url;
            } catch {
                return null;
            } finally {
                readUrlLoads.delete(id);
            }
        })();
        readUrlLoads.set(id, p);
    }
    return p;
}

/** Forgets the addresses kept for reading (after signing in or out, say). */
export function forgetMediaUrls(id?: string) {
    if (id) readUrls.delete(id);
    else readUrls.clear();
}

export async function loadMedia(id: string): Promise<Blob | null> {
    const local = await getLocal(id);
    if (local) return local;
    // Twice at most: an address kept from before may have stopped working.
    for (let attempt = 0; attempt < 2; attempt++) {
        const url = await mediaReadUrl(id);
        if (!url) return null;
        try {
            const res = await fetch(url);
            if (res.ok) {
                const blob = await res.blob();
                await putLocal(id, blob).catch(() => undefined);
                return blob;
            }
        } catch {
            // Tried again with a fresh address.
        }
        forgetMediaUrls(id);
    }
    return null;
}

// An address that loads the asset without headers for a few minutes (for media elements).
export async function signedMediaUrl(id: string): Promise<string | null> {
    return mediaReadUrl(id);
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

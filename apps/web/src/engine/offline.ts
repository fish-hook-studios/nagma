import { imageBlob } from "./image-store";
import { legacyStorageReady } from "./legacy-names";
import type { NagmaDocument } from "./types";

// "Make available offline": the prototype's file, with its images embedded, is kept in the
// browser's cache storage, so the prototype opens from here when the server can't be reached.

const CACHE = "nagma-offline-v1";
const keyOf = (fileId: string) => `/offline/${encodeURIComponent(fileId)}`;

function store(): Promise<Cache> | null {
    // Copies kept under the old name move here first (engine/legacy-names.ts).
    return typeof caches === "undefined" ? null : legacyStorageReady().then(() => caches.open(CACHE));
}

async function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function saveOffline(fileId: string, doc: NagmaDocument): Promise<boolean> {
    const cache = store();
    if (!cache) return false;
    const images: Record<string, string> = {};
    for (const id of Object.keys(doc.images)) {
        const value = doc.images[id] ?? "";
        if (value.startsWith("data:")) images[id] = value;
        else {
            const blob = await imageBlob(doc.images, id).catch(() => null);
            if (blob) images[id] = await readBlob(blob);
        }
    }
    try {
        await (await cache).put(keyOf(fileId), new Response(JSON.stringify({ at: Date.now(), doc: { ...doc, images } }), { headers: { "content-type": "application/json" } }));
        return true;
    } catch {
        return false;
    }
}

export async function removeOffline(fileId: string) {
    const cache = store();
    if (cache) await (await cache).delete(keyOf(fileId)).catch(() => false);
}

export async function hasOffline(fileId: string): Promise<boolean> {
    const cache = store();
    if (!cache) return false;
    return Boolean(await (await cache).match(keyOf(fileId)).catch(() => undefined));
}

export async function loadOffline(fileId: string): Promise<NagmaDocument | null> {
    const cache = store();
    if (!cache) return null;
    const res = await (await cache).match(keyOf(fileId)).catch(() => undefined);
    if (!res) return null;
    try {
        const { doc } = (await res.json()) as { doc: NagmaDocument };
        return doc;
    } catch {
        return null;
    }
}

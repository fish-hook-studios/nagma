import { nanoid } from "nanoid";
import { loadMedia, storeMedia } from "./media";
import type { NagmaDocument } from "./types";

// Document images live in the media store (this browser's IndexedDB, and the sync server), and
// the document holds a short reference: `media:<id>`. Older files that embedded images as data
// URLs still work, and are moved over in the background when they open.

const PREFIX = "media:";

export function isMediaRef(value: string | undefined): boolean {
    return typeof value === "string" && value.startsWith(PREFIX);
}

function mediaId(ref: string) {
    return ref.slice(PREFIX.length);
}

// Object URLs for media images, made once each.
const urls = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
const blobs = new Map<string, Blob>();
const listeners = new Set<() => void>();

// Called whenever an image finishes loading, so canvases can redraw.
export function onImageReady(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

async function resolve(ref: string): Promise<string | null> {
    const id = mediaId(ref);
    const known = urls.get(id);
    if (known) return known;
    let p = loading.get(id);
    if (!p) {
        p = loadMedia(id).then((blob) => {
            if (!blob) return null;
            blobs.set(id, blob);
            const url = URL.createObjectURL(blob);
            urls.set(id, url);
            for (const l of listeners) l();
            return url;
        });
        loading.set(id, p);
    }
    return p;
}

// A URL for an image right now: data URLs as they are, media once fetched (null until then; the
// fetch starts and `onImageReady` fires when it lands).
export function imageSrc(images: Record<string, string>, id: string): string | null {
    const value = images[id];
    if (!value) return null;
    if (!isMediaRef(value)) return value;
    const url = urls.get(mediaId(value));
    if (url) return url;
    void resolve(value);
    return null;
}

export async function imageBlob(images: Record<string, string>, id: string): Promise<Blob | null> {
    const value = images[id];
    if (!value) return null;
    if (!isMediaRef(value)) {
        const res = await fetch(value);
        return res.blob();
    }
    const cached = blobs.get(mediaId(value));
    if (cached) return cached;
    await resolve(value);
    return blobs.get(mediaId(value)) ?? null;
}

export async function imageBytes(images: Record<string, string>, id: string): Promise<Uint8Array | null> {
    const blob = await imageBlob(images, id);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function imageDataUrl(images: Record<string, string>, id: string): Promise<string | null> {
    const value = images[id];
    if (!value) return null;
    if (!isMediaRef(value)) return value;
    const blob = await imageBlob(images, id);
    return blob ? blobToDataUrl(blob) : null;
}

// Stores an image and returns the reference to put in the document.
export async function storeImage(blob: Blob): Promise<string> {
    const { ref, stored } = storeImageNow(blob);
    await stored;
    return ref;
}

// The same, with the reference straight away (this browser can read it at once) for a write that
// can't wait, such as a save just before another file opens; `stored` settles once it's kept.
export function storeImageNow(blob: Blob): { ref: string; stored: Promise<void> } {
    const id = nanoid(12);
    blobs.set(id, blob);
    urls.set(id, URL.createObjectURL(blob));
    return { ref: `${PREFIX}${id}`, stored: storeMedia(id, blob) };
}

export async function storeDataUrl(dataUrl: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    return storeImage(blob);
}

// A copy of the document with every media reference replaced by a data URL, for exporters that
// write self-contained files (SVG, PDF, Lottie).
export async function inlineImages(doc: NagmaDocument, only?: Set<string>): Promise<NagmaDocument> {
    const images = { ...doc.images };
    let changed = false;
    for (const [id, value] of Object.entries(images)) {
        if (!isMediaRef(value) || (only && !only.has(id))) continue;
        const data = await imageDataUrl(doc.images, id);
        if (data) {
            images[id] = data;
            changed = true;
        }
    }
    return changed ? { ...doc, images } : doc;
}

// Resolves every media image in the document, so a render that follows has them all.
export async function preloadImages(images: Record<string, string>): Promise<void> {
    await Promise.all(Object.values(images).filter((v) => isMediaRef(v)).map((ref) => resolve(ref)));
}

// Embedded data URLs become media references, a few at a time, so old files get light.
export async function migrateEmbedded(images: Record<string, string>, limit = 6): Promise<{ id: string; ref: string }[]> {
    const out: { id: string; ref: string }[] = [];
    for (const [id, value] of Object.entries(images)) {
        if (isMediaRef(value) || !value.startsWith("data:")) continue;
        try {
            out.push({ id, ref: await storeDataUrl(value) });
        } catch {
            // Left embedded; tried again next time.
        }
        if (out.length >= limit) break;
    }
    return out;
}

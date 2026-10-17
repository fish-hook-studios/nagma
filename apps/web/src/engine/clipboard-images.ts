import { authHeaders } from "./auth";
import { storeImage } from "./image-store";
import { httpBase } from "./server-url";
import { CLIPBOARD_META_PATTERN } from "./interop-format";
import { editor } from "./store";

// Images for layers pasted from another design tool. Its clipboard carries the layers with each
// image fill's hash, and a note (between its own markers, interop-format.ts) listing a short-lived signed download link per hash.
// The links are fetched by the browser (the image host allows it); when the browser can't reach
// them, the sync server fetches them instead (/image-proxy, image hosts only). The bytes go into
// the media store, so they persist, sync and export like any other image.

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 4;
const HASH = /^[0-9a-f]{40}$/;

// The download link for each image hash in the copied layers' note (https links only).
export function copiedImageUrls(html: string): Record<string, string> {
    const m = CLIPBOARD_META_PATTERN.exec(html);
    if (!m?.[1]) return {};
    try {
        const bytes = Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
        const meta = JSON.parse(new TextDecoder().decode(bytes)) as { imageHashes?: unknown };
        const out: Record<string, string> = {};
        if (!meta.imageHashes || typeof meta.imageHashes !== "object") return out;
        for (const [hash, url] of Object.entries(meta.imageHashes as Record<string, unknown>)) {
            const key = hash.toLowerCase();
            if (!HASH.test(key) || typeof url !== "string") continue;
            try {
                if (new URL(url).protocol === "https:") out[key] = url;
            } catch {
                // Not a link.
            }
        }
        return out;
    } catch {
        return {};
    }
}

// The image type from the first bytes, or null when they aren't an image the canvas can draw.
export function sniffImageType(b: Uint8Array): string | null {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69) return "image/avif";
    return null;
}

export class ImageFetchError extends Error {
    readonly status: number;
    constructor(status: number) {
        super(status ? `The image link answered ${status}.` : "The image couldn't be reached.");
        this.status = status;
    }
}

async function checkedBlob(res: Response): Promise<Blob> {
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES) throw new ImageFetchError(413);
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new ImageFetchError(blob.size ? 413 : 204);
    const type = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
    if (!type) throw new ImageFetchError(415);
    return blob.type === type ? blob : new Blob([blob], { type });
}

async function viaServer(url: string): Promise<Blob> {
    const headers = authHeaders();
    if (!headers.authorization) throw new ImageFetchError(0);
    let res: Response;
    try {
        res = await fetch(`${httpBase()}/image-proxy?url=${encodeURIComponent(url)}`, { headers, signal: AbortSignal.timeout(60_000) });
    } catch {
        throw new ImageFetchError(0);
    }
    if (!res.ok) throw new ImageFetchError(res.status);
    return checkedBlob(res);
}

// One image: straight from its link, or through the sync server when the browser can't reach it
// (a network or cross-origin failure, not an answer such as an expired link's 403).
export async function fetchImage(url: string): Promise<Blob> {
    let res: Response;
    try {
        res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000) });
    } catch {
        return viaServer(url);
    }
    if (!res.ok) throw new ImageFetchError(res.status);
    return checkedBlob(res);
}

// Runs `fn` over the items, at most `limit` at a time.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i] as T, i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

export interface PendingImage {
    // The image id the pasted fills point at.
    id: string;
    hash: string;
    // Links to try in order: the image, then (if the note has it) its smaller preview.
    urls: string[];
}

// Bumped whenever another document opens, so images fetched for a paste don't land in a different file.
let generation = 0;
editor.onOpen(() => {
    generation++;
});

// Fetches the images and adds them to the open document as they arrive (not an undo step of their
// own: undoing the paste removes the layers, and the images are just unused until a redo).
export async function loadPendingImages(pending: PendingImage[], onProgress?: (done: number, total: number) => void): Promise<{ loaded: PendingImage[]; failed: PendingImage[] }> {
    const started = generation;
    const loaded: PendingImage[] = [];
    const failed: PendingImage[] = [];
    let done = 0;
    await mapLimit(pending, CONCURRENCY, async (item) => {
        let blob: Blob | null = null;
        for (const url of item.urls) {
            try {
                blob = await fetchImage(url);
                break;
            } catch {
                // Try the next link.
            }
        }
        if (blob && generation === started) {
            try {
                const ref = await storeImage(blob);
                if (generation === started) {
                    const images = editor.get().doc.images;
                    if (images[item.id]) editor.executeSilently({ type: "image.set", id: item.id, data: ref });
                    else editor.executeSilently({ type: "image.add", id: item.id, data: ref });
                    loaded.push(item);
                } else failed.push(item);
            } catch {
                failed.push(item);
            }
        } else failed.push(item);
        onProgress?.(++done, pending.length);
    });
    return { loaded, failed };
}

// The image id pasted fills use for an image hash: the same hash always gets the same id, so
// pasting it again reuses the image, and a fill whose image couldn't be fetched still names it.
export const pastedImageId = (hash: string) => `img-${hash}`;
export const hashOfPastedImage = (id: string) => (/^img-([0-9a-f]{40})$/.exec(id)?.[1] ?? null);

// Image ids that pasted fills in the open document point at but whose bytes never arrived.
export function missingPastedImages(): string[] {
    const { doc } = editor.get();
    const out = new Set<string>();
    for (const node of Object.values(doc.nodes)) {
        for (const p of [...(node.fills ?? []), ...(node.strokes ?? [])]) if (p.type === "image" && !doc.images[p.id] && hashOfPastedImage(p.id)) out.add(p.id);
    }
    return [...out];
}

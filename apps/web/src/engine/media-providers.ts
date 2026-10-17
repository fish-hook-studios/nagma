import { aiError, aiRequestHeaders, keyNeeded, onAiChange } from "./ai-settings";
import { auth, authHeaders } from "./auth";
import { httpBase } from "./server-url";

// Stock photos and image generation, through the sync server. Stock photos use the server's key
// (NAGMA_STOCK_KEY for an Unsplash- or Pexels-style photo library). Image generation uses the
// person's own image model (Account settings › AI), else the server's (NAGMA_IMAGE_API_URL and
// NAGMA_IMAGE_API_KEY, for signed-in people); without either, the panels say where to add a key.

export interface Providers {
    stock: boolean;
    stockProvider: string;
    image: boolean;
    // No image model for this person: Account settings › AI is where to add one.
    imageKeyNeeded?: boolean;
}

export interface StockPhoto {
    id: string;
    alt: string;
    url: string;
    preview: string;
    w: number;
    h: number;
    color: string | null;
    // Attribution, shown with the photo and kept in the layer's name.
    author: string;
    authorUrl: string;
    source: string;
    sourceUrl: string;
    download?: string | null;
}

let cached: Promise<Providers> | null = null;
// A new key, or signing in or out, changes what's available.
onAiChange(() => (cached = null));
auth.onChange(() => (cached = null));
export function providers(): Promise<Providers> {
    cached ??= fetch(`${httpBase()}/providers`, { headers: aiRequestHeaders() })
        .then((r) => (r.ok ? (r.json() as Promise<Providers>) : { stock: false, stockProvider: "", image: false }))
        .catch(() => ({ stock: false, stockProvider: "", image: false }));
    return cached;
}

async function fail(res: Response): Promise<never> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The server answered ${res.status}.`);
}

export async function searchStock(q: string, page = 1, signal?: AbortSignal): Promise<StockPhoto[]> {
    const res = await fetch(`${httpBase()}/providers/stock?q=${encodeURIComponent(q)}&page=${page}`, { headers: authHeaders(), signal });
    if (!res.ok) return fail(res);
    return (await res.json()) as StockPhoto[];
}

// The full-size photo as a file to place (fetched through the server, which also reports the use).
export async function stockFile(p: StockPhoto): Promise<File> {
    const url = new URL(`${httpBase()}/providers/stock/image`);
    url.searchParams.set("url", p.url);
    if (p.download) url.searchParams.set("download", p.download);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return fail(res);
    const blob = await res.blob();
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `Photo by ${p.author || "unknown"} (${p.source}).${ext}`, { type: blob.type });
}

// Thrown when there's no image model to use; entry points offer the AI settings.
export class ImageKeyNeeded extends Error {}

export async function generateImage(prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536"): Promise<string> {
    const res = await fetch(`${httpBase()}/providers/image`, { method: "POST", headers: { "content-type": "application/json", ...aiRequestHeaders() }, body: JSON.stringify({ prompt, size }) });
    if (!res.ok) {
        const failure = await aiError(res);
        if (keyNeeded(failure)) throw new ImageKeyNeeded(failure.error);
        throw new Error(failure.error);
    }
    return ((await res.json()) as { image: string }).image;
}

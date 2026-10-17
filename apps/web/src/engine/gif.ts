import { imageSrc } from "./image-store";
import type { NagmaDocument } from "./types";

// Animated GIF fills play in the prototype player (the canvas shows their first frame, as the
// reference does). Frames are decoded with ImageDecoder where the browser has it; elsewhere the
// player lays an <img> over the fill so the browser animates it (see the player's overlay list).

interface Frame {
    image: CanvasImageSource;
    // Milliseconds from the start of the loop.
    at: number;
    duration: number;
}
interface Decoded {
    frames: Frame[];
    total: number;
    done: boolean;
}

const decoded = new Map<string, Decoded>();
const kinds = new Map<string, boolean>();
// Whether frames are drawn right now (the player turns this on while it draws).
export const gifPlayback = { on: false };
// The clock the loops run on.
let clock = 0;
export function setGifClock(now: number) {
    clock = now;
}

declare class ImageDecoder {
    constructor(init: { data: ArrayBuffer | ReadableStream; type: string });
    readonly tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null };
    decode(options?: { frameIndex?: number }): Promise<{ image: VideoFrame }>;
    static isTypeSupported(type: string): Promise<boolean>;
}

export function canDecodeGifs(): boolean {
    return typeof ImageDecoder !== "undefined";
}

export function isGif(images: Record<string, string>, id: string): boolean {
    const known = kinds.get(id);
    if (known !== undefined) return known;
    const src = imageSrc(images, id);
    const gif = Boolean(src && (src.startsWith("data:image/gif") || /\.gif($|\?)/i.test(src)));
    kinds.set(id, gif);
    return gif;
}

// Caps so a long GIF doesn't eat the memory: frames past the cap loop early.
const MAX_FRAMES = 240;
const MAX_PIXELS = 96_000_000;

async function decode(id: string, src: string) {
    const entry: Decoded = { frames: [], total: 0, done: false };
    decoded.set(id, entry);
    try {
        const data = await (await fetch(src)).arrayBuffer();
        const decoder = new ImageDecoder({ data, type: "image/gif" });
        await decoder.tracks.ready;
        const count = Math.min(MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 1);
        let pixels = 0;
        for (let i = 0; i < count; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const duration = Math.max(20, (image.duration ?? 100_000) / 1000);
            pixels += image.displayWidth * image.displayHeight;
            const bitmap = await createImageBitmap(image);
            image.close();
            entry.frames.push({ image: bitmap, at: entry.total, duration });
            entry.total += duration;
            if (pixels > MAX_PIXELS) break;
        }
    } catch {
        // Stays a still.
    }
    entry.done = true;
}

// The frame to draw now for an animated GIF image, or undefined to draw the still.
export function gifFrame(doc: NagmaDocument, id: string): CanvasImageSource | undefined {
    if (!gifPlayback.on || !canDecodeGifs() || !isGif(doc.images, id)) return undefined;
    let entry = decoded.get(id);
    if (!entry) {
        const src = imageSrc(doc.images, id);
        if (!src) return undefined;
        void decode(id, src);
        entry = decoded.get(id);
    }
    if (!entry || entry.frames.length < 2 || entry.total <= 0) return undefined;
    const t = clock % entry.total;
    let frame = entry.frames[0];
    for (const f of entry.frames) {
        if (f.at <= t) frame = f;
        else break;
    }
    return frame?.image;
}

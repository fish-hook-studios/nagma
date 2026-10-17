import { type VideoSource, loadVideoEngine } from "../../engines/video-engine";
import { imageBlob } from "../image-store";
import { loadMedia } from "../media";
import type { NagmaDocument } from "../types";
import type { VMedia } from "./model";

// Where the editor's pictures and sound come from: FilmCraft's decoder for exact frames and
// samples (paused previews, export), the browser's own players while playing, and the browser's
// decoders as a fallback for files the engine can't open.

const blobs = new Map<string, Promise<Blob | null>>();
const urls = new Map<string, string>();

export function mediaBlob(store: string): Promise<Blob | null> {
    let p = blobs.get(store);
    if (!p) {
        p = loadMedia(store);
        blobs.set(store, p);
    }
    return p;
}

export async function mediaUrl(store: string): Promise<string | null> {
    const known = urls.get(store);
    if (known) return known;
    const blob = await mediaBlob(store);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(store, url);
    return url;
}

// ---- The engine's decoder ----

const engineSources = new Map<string, Promise<VideoSource | null>>();

export function engineSource(media: VMedia): Promise<VideoSource | null> {
    let p = engineSources.get(media.store);
    if (!p) {
        p = (async () => {
            try {
                const [engine, blob] = await Promise.all([loadVideoEngine(), mediaBlob(media.store)]);
                if (!blob) return null;
                return new engine.VideoSource(media.name, new Uint8Array(await blob.arrayBuffer()));
            } catch {
                return null;
            }
        })();
        engineSources.set(media.store, p);
    }
    return p;
}

// ---- Exact frames ----

interface CachedFrame {
    key: string;
    canvas: HTMLCanvasElement;
}
const frameCache: CachedFrame[] = [];
const FRAME_CACHE = 24;

function cacheFrame(key: string, draw: (canvas: HTMLCanvasElement) => boolean): HTMLCanvasElement | null {
    const hit = frameCache.findIndex((f) => f.key === key);
    if (hit >= 0) {
        const [f] = frameCache.splice(hit, 1);
        if (f) {
            frameCache.push(f);
            return f.canvas;
        }
    }
    const canvas = frameCache.length >= FRAME_CACHE ? (frameCache.shift()?.canvas ?? document.createElement("canvas")) : document.createElement("canvas");
    if (!draw(canvas)) return null;
    frameCache.push({ key, canvas });
    return canvas;
}

// The frame at `seconds` into a video, `scale` of its size (≤ 1), from the engine; files it can't
// read are seeked in a browser player instead.
export async function exactFrame(media: VMedia, seconds: number, scale: number): Promise<CanvasImageSource | null> {
    const fps = media.fps || 30;
    const index = Math.max(0, Math.round(seconds * fps));
    const s = Math.max(0.05, Math.min(1, Math.round(scale * 8) / 8 || 0.125));
    const key = `${media.store}@${index}@${s}`;
    const known = frameCache.find((f) => f.key === key);
    if (known) return cacheFrame(key, () => true);
    const src = await engineSource(media);
    if (src) {
        try {
            const frame = src.frame(Math.min(index / fps, Math.max(0, media.seconds - 0.5 / fps)), s);
            try {
                const rgba = frame.rgba;
                const w = frame.width;
                const h = frame.height;
                return cacheFrame(key, (canvas) => {
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0);
                    return true;
                });
            } finally {
                frame.free();
            }
        } catch {
            // Fall through to the browser.
        }
    }
    const el = await seekPlayer(media, index / fps);
    if (!el) return null;
    return cacheFrame(key, (canvas) => {
        canvas.width = Math.max(1, Math.round(el.videoWidth * s));
        canvas.height = Math.max(1, Math.round(el.videoHeight * s));
        canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
        return true;
    });
}

// A hidden player per file for seeking frame by frame.
const seekers = new Map<string, Promise<HTMLVideoElement | null>>();
const seekerUsed = new Map<string, number>();
let seekChain: Promise<unknown> = Promise.resolve();
// Chrome suspends a paused player nobody has used for a while (about 15 s): its seeks still
// finish, but its picture stops changing, so every frame read from it was the last one it showed
// (an export of a clip the browser decodes came out as one frozen frame). A player idle this long
// is replaced, and one whose seek shows no new frame is replaced and the seek tried again.
const SEEKER_IDLE_MS = 8000;

function newSeeker(media: VMedia): Promise<HTMLVideoElement | null> {
    const p = (async () => {
        const url = await mediaUrl(media.store);
        if (!url) return null;
        const el = document.createElement("video");
        el.muted = true;
        el.preload = "auto";
        el.playsInline = true;
        el.src = url;
        const ok = await new Promise<boolean>((resolve) => {
            el.onloadeddata = () => resolve(true);
            el.onerror = () => resolve(false);
        });
        return ok ? el : null;
    })();
    seekers.set(media.store, p);
    return p;
}

function dropSeeker(store: string) {
    const p = seekers.get(store);
    seekers.delete(store);
    void p?.then((el) => {
        if (!el) return;
        el.removeAttribute("src");
        el.load();
    });
}

// Seeks `el` to `t`: true once the frame there is showing (or nothing needed to change), false
// when the seek finished without a new picture (a suspended player).
function seekTo(el: HTMLVideoElement, media: VMedia, seconds: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const t = Math.max(0, Math.min(seconds, (Number.isFinite(el.duration) ? el.duration : media.seconds) - 0.01));
        if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) return resolve(true);
        const watch = "requestVideoFrameCallback" in el;
        let framed = !watch;
        let seeked = false;
        const finish = (ok: boolean) => {
            el.removeEventListener("seeked", onSeeked);
            window.clearTimeout(limit);
            resolve(ok);
        };
        const onSeeked = () => {
            seeked = true;
            if (framed) return finish(true);
            // The picture for the new time comes with the next presented frame.
            window.setTimeout(() => finish(framed), 400);
        };
        if (watch) el.requestVideoFrameCallback(() => {
            framed = true;
            if (seeked) finish(true);
        });
        el.addEventListener("seeked", onSeeked);
        el.currentTime = t;
        const limit = window.setTimeout(() => finish(framed), 1500);
    });
}

async function seekPlayer(media: VMedia, seconds: number): Promise<HTMLVideoElement | null> {
    const used = seekerUsed.get(media.store) ?? 0;
    if (seekers.has(media.store) && performance.now() - used > SEEKER_IDLE_MS) dropSeeker(media.store);
    seekerUsed.set(media.store, performance.now());
    // One seek at a time per page, in order.
    const run = seekChain.then(async () => {
        let el = await (seekers.get(media.store) ?? newSeeker(media));
        if (!el) return null;
        if (!(await seekTo(el, media, seconds))) {
            dropSeeker(media.store);
            el = await newSeeker(media);
            if (el) await seekTo(el, media, seconds);
        }
        seekerUsed.set(media.store, performance.now());
        return el;
    });
    seekChain = run.catch(() => undefined);
    return run;
}

// ---- Stills ----

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();

export function stillImage(doc: NagmaDocument, imageId: string): Promise<ImageBitmap | null> {
    let p = bitmaps.get(imageId);
    if (!p) {
        p = (async () => {
            try {
                const blob = await imageBlob(doc.images, imageId);
                return blob ? await createImageBitmap(blob) : null;
            } catch {
                return null;
            }
        })();
        bitmaps.set(imageId, p);
    }
    return p;
}

// Already decoded (for synchronous draws), or null.
const ready = new Map<string, ImageBitmap>();
export function stillNow(doc: NagmaDocument, imageId: string): ImageBitmap | null {
    const known = ready.get(imageId);
    if (known) return known;
    void stillImage(doc, imageId).then((b) => b && ready.set(imageId, b));
    return null;
}

// ---- Sound ----

// Decoded by the browser, for files the engine can't read.
const decoded = new Map<string, Promise<AudioBuffer | null>>();

export function browserAudio(media: VMedia): Promise<AudioBuffer | null> {
    let p = decoded.get(media.store);
    if (!p) {
        p = (async () => {
            try {
                const blob = await mediaBlob(media.store);
                if (!blob) return null;
                const ctx = new OfflineAudioContext(2, 1, 48000);
                return await ctx.decodeAudioData(await blob.arrayBuffer());
            } catch {
                return null;
            }
        })();
        decoded.set(media.store, p);
    }
    return p;
}

// `frames` stereo sample frames from `seconds` into the file at `rate` Hz (silence where there's none).
export async function readAudio(media: VMedia, seconds: number, frames: number, rate: number): Promise<Float32Array> {
    const out = new Float32Array(frames * 2);
    if (frames <= 0 || seconds >= media.seconds) return out;
    // The part before the file's start stays silent.
    let skip = 0;
    if (seconds < 0) {
        skip = Math.min(frames, Math.ceil(-seconds * rate));
        seconds = 0;
    }
    const n = frames - skip;
    if (n <= 0) return out;
    const src = await engineSource(media);
    if (src) {
        try {
            const samples = src.audio(seconds, n, rate, 2);
            out.set(samples.subarray(0, n * 2), skip * 2);
            return out;
        } catch {
            // Try the browser.
        }
    }
    const buffer = await browserAudio(media);
    if (!buffer) return out;
    const l = buffer.getChannelData(0);
    const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
    const k = buffer.sampleRate / rate;
    for (let i = 0; i < n; i++) {
        const pos = (seconds * rate + i) * k;
        const a = Math.floor(pos);
        const f = pos - a;
        if (a + 1 >= l.length) break;
        out[(skip + i) * 2] = (l[a] ?? 0) * (1 - f) + (l[a + 1] ?? 0) * f;
        out[(skip + i) * 2 + 1] = (r[a] ?? 0) * (1 - f) + (r[a + 1] ?? 0) * f;
    }
    return out;
}

// Loudness peaks for a waveform, `perSecond` per second, mono, 0..1.
export async function peaksOf(media: VMedia, perSecond: number): Promise<number[]> {
    const rate = 8000;
    const total = Math.min(Math.ceil(media.seconds * rate), rate * 60 * 30);
    const step = Math.max(1, Math.round(rate / perSecond));
    const peaks: number[] = [];
    const chunk = rate * 20;
    for (let at = 0; at < total; at += chunk) {
        const n = Math.min(chunk, total - at);
        const samples = await readAudio(media, at / rate, n, rate);
        for (let i = 0; i < n; i += step) {
            let max = 0;
            for (let j = i; j < Math.min(n, i + step); j++) max = Math.max(max, Math.abs(samples[j * 2] ?? 0), Math.abs(samples[j * 2 + 1] ?? 0));
            peaks.push(Math.round(Math.min(1, max) * 100) / 100);
        }
    }
    return peaks;
}

// ---- Players for playback ----

const players = new Map<string, HTMLMediaElement>();

// A browser player for one clip (video or sound); null until it can play.
export function clipPlayer(key: string, media: VMedia, kind: "video" | "audio"): HTMLMediaElement | null {
    const el = players.get(key);
    if (el) return el.readyState >= 2 ? el : null;
    const made = document.createElement(kind === "video" ? "video" : "audio") as HTMLMediaElement;
    made.preload = "auto";
    if (made instanceof HTMLVideoElement) {
        made.muted = true;
        made.playsInline = true;
    }
    players.set(key, made);
    void mediaUrl(media.store).then((url) => {
        if (url) made.src = url;
    });
    return null;
}

export function allPlayers(): Map<string, HTMLMediaElement> {
    return players;
}

export function pauseAll(except?: Set<string>) {
    for (const [key, el] of players) if (!except?.has(key) && !el.paused) el.pause();
}

export function releasePlayers() {
    for (const el of players.values()) {
        el.pause();
        el.removeAttribute("src");
        el.load();
    }
    players.clear();
}

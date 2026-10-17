import { type Viewport, drawScreen, fillPlacement } from "../canvas/screen";
import { loadVideoEngine } from "../engines/video-engine";
import { storeDataUrl } from "../engine/image-store";
import { makeNode } from "../engine/nodes";
import { rgbaToPng } from "../engine/photo";
import { loadMedia } from "../engine/media";
import { editor } from "../engine/store";
import type { ImagePaint, NagmaDocument, SceneNode, VideoFill } from "../engine/types";
import { exactFrame, importVideo, showLive, videoPaint } from "../engine/video";
import { nanoid } from "nanoid";
import { insertLayers } from "./inserts";

// Video assets: videos uploaded from the Media panel sit on an asset as a layer with a video fill.
// On the canvas a play button plays them (from the trim's start to its end, at their volume);
// the toolbar trims them, sets the volume and picks the poster frame; Export renders the asset
// frame by frame with the sound as MP4, or records it as WebM.

export const videoOf = (node: SceneNode | undefined): { paint: ImagePaint; video: VideoFill; index: number } | null => {
    if (!node) return null;
    const index = node.fills.findIndex((p) => p.type === "image" && Boolean(p.video));
    const paint = node.fills[index];
    return paint?.type === "image" && paint.video ? { paint, video: paint.video, index } : null;
};

export const trimOf = (video: VideoFill) => {
    const start = Math.max(0, Math.min(video.trimStart ?? 0, video.seconds));
    const end = Math.max(start + 0.05, Math.min(video.trimEnd ?? video.seconds, video.seconds));
    return { start, end, length: end - start };
};

// Every layer with a video fill inside an asset (itself included).
export function videoLayers(doc: NagmaDocument, id: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        if (videoOf(n)?.paint.visible !== false && videoOf(n)) out.push(n);
        for (const c of n.children) visit(c);
    };
    visit(id);
    return out;
}

export const hasVideoIn = (doc: NagmaDocument, id: string) => videoLayers(doc, id).length > 0;

// ---- Upload ----

export async function addVideoFile(file: File) {
    editor.notify("Opening video…");
    try {
        const { poster, video } = await importVideo(file);
        insertLayers(
            (asset, scratch) => {
                const k = Math.min((asset.w * 0.8) / Math.max(video.width, 1), (asset.h * 0.8) / Math.max(video.height, 1));
                return [makeNode(scratch, "rect", { x: 0, y: 0, w: Math.max(1, Math.round(video.width * k)), h: Math.max(1, Math.round(video.height * k)) }, asset.id, { name: file.name.replace(/\.[^.]+$/, "") || "Video", fills: [videoPaint(poster.id, video)] })];
            },
            [{ type: "image.add", id: poster.id, data: poster.data }],
        );
        editor.notify("Video added. Press play on it to watch it.");
    } catch (error) {
        editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Places a video already in the file again (from the Media panel).
export function placeVideoPaint(paint: ImagePaint) {
    const video = paint.video;
    if (!video) return;
    insertLayers((asset, scratch) => {
        const k = Math.min((asset.w * 0.8) / Math.max(video.width, 1), (asset.h * 0.8) / Math.max(video.height, 1));
        return [makeNode(scratch, "rect", { x: 0, y: 0, w: Math.max(1, Math.round(video.width * k)), h: Math.max(1, Math.round(video.height * k)) }, asset.id, { name: video.name.replace(/\.[^.]+$/, "") || "Video", fills: [{ ...paint }] })];
    });
}

// ---- Playback on the canvas ----

interface Playing {
    el: HTMLVideoElement;
    url: string;
    posterId: string;
}

const playing = new Map<string, Playing>();
let raf = 0;

export const isPlaying = (nodeId: string) => playing.has(nodeId);

function tick() {
    raf = 0;
    const doc = editor.get().doc;
    for (const [nodeId, p] of playing) {
        const v = videoOf(doc.nodes[nodeId]);
        if (!v) {
            stopVideo(nodeId);
            continue;
        }
        const { start, end } = trimOf(v.video);
        if (p.el.currentTime >= end - 0.02 || p.el.ended) {
            if (v.video.loop) {
                p.el.currentTime = start;
                void p.el.play().catch(() => undefined);
            } else stopVideo(nodeId);
        }
    }
    editor.set({});
    if (playing.size) raf = requestAnimationFrame(tick);
}

// The video files as object URLs, made ahead (the canvas asks while it draws the play buttons), so
// a press can start playing straight away: browsers only play with sound right after a press.
const fileUrls = new Map<string, string | Promise<string | null>>();
export function prepareVideo(video: VideoFill) {
    if (fileUrls.has(video.id)) return;
    fileUrls.set(
        video.id,
        loadMedia(video.id).then((blob) => {
            const url = blob ? URL.createObjectURL(blob) : null;
            if (url) fileUrls.set(video.id, url);
            else fileUrls.delete(video.id);
            return url;
        }),
    );
}

export async function playVideo(nodeId: string) {
    const v = videoOf(editor.get().doc.nodes[nodeId]);
    if (!v || playing.has(nodeId)) return;
    prepareVideo(v.video);
    const known = fileUrls.get(v.video.id);
    const url = typeof known === "string" ? known : await known;
    if (!url) return editor.notify("This video's file is missing from this browser.");
    const el = document.createElement("video");
    el.src = url;
    el.playsInline = true;
    el.preload = "auto";
    el.muted = v.video.muted;
    el.volume = Math.max(0, Math.min(1, v.video.volume ?? 1));
    const { start } = trimOf(v.video);
    if (start > 0) el.addEventListener("loadedmetadata", () => (el.currentTime = start), { once: true });
    playing.set(nodeId, { el, url, posterId: v.paint.id });
    // Started inside the press when the file was ready; without sound if the browser insists.
    const started = el.play().catch(() => {
        el.muted = true;
        return el.play();
    });
    showLive(v.paint.id, el);
    if (!raf) raf = requestAnimationFrame(tick);
    await started.catch(() => {
        stopVideo(nodeId);
        editor.notify("This browser can't play that video.");
    });
}

export function stopVideo(nodeId: string) {
    const p = playing.get(nodeId);
    if (!p) return;
    p.el.pause();
    p.el.removeAttribute("src");
    showLive(p.posterId, null);
    playing.delete(nodeId);
    editor.set({});
}

export function toggleVideo(nodeId: string) {
    if (playing.has(nodeId)) stopVideo(nodeId);
    else void playVideo(nodeId);
}

// Keeps a playing video's sound in step with its settings.
export function syncPlayingSettings(nodeId: string) {
    const p = playing.get(nodeId);
    const v = videoOf(editor.get().doc.nodes[nodeId]);
    if (!p || !v) return;
    p.el.muted = v.video.muted;
    p.el.volume = Math.max(0, Math.min(1, v.video.volume ?? 1));
}

// ---- Editing ----

// Slider drags fold into one undo step: a change merges with the last one when it's the same
// setting on the same layer a moment later.
let lastChange = { key: "", at: 0 };
function folds(key: string, merge: boolean): boolean {
    const now = Date.now();
    const fold = merge && lastChange.key === key && now - lastChange.at < 1000;
    lastChange = { key, at: now };
    return fold;
}

export function setVideo(node: SceneNode, patch: Partial<VideoFill>, merge = false) {
    const v = videoOf(node);
    if (!v) return;
    const paint: ImagePaint = { ...v.paint, video: { ...v.video, ...patch } };
    const fold = folds(`${node.id}:${Object.keys(patch).join()}`, merge);
    editor.execute({ type: "node.update", id: node.id, patch: { fills: node.fills.map((p, i) => (i === v.index ? paint : p)) } });
    if (fold) editor.mergeLast();
    syncPlayingSettings(node.id);
}

// The video's adjustments (drawn as a filter over its frames and poster, never baked in).
export function setVideoAdjust(node: SceneNode, adjust: ImagePaint["adjust"], merge = false) {
    const v = videoOf(node);
    if (!v) return;
    const paint: ImagePaint = { ...v.paint, adjust };
    const fold = folds(`${node.id}:adjust`, merge);
    editor.execute({ type: "node.update", id: node.id, patch: { fills: node.fills.map((p, i) => (i === v.index ? paint : p)) } });
    if (fold) editor.mergeLast();
}

// Makes the frame at `seconds` the video's poster: what shows while it isn't playing (and in pictures).
export async function setPosterFrame(node: SceneNode, seconds: number) {
    const v = videoOf(node);
    if (!v) return;
    const engine = await loadVideoEngine();
    const blob = await loadMedia(v.video.id);
    if (!blob) return editor.notify("This video's file is missing from this browser.");
    const src = new engine.VideoSource(v.video.name, new Uint8Array(await blob.arrayBuffer()));
    let data: string;
    try {
        const frame = src.frame(Math.max(0, Math.min(seconds, v.video.seconds - 0.01)), 1);
        try {
            data = await storeDataUrl(await rgbaToPng(frame.rgba, frame.width, frame.height));
        } finally {
            frame.free();
        }
    } finally {
        src.free();
    }
    const id = nanoid(12);
    const fresh = editor.get().doc.nodes[node.id];
    const now = videoOf(fresh);
    if (!fresh || !now) return;
    stopVideo(node.id);
    editor.execute({ type: "batch", commands: [{ type: "image.add", id, data }, { type: "node.update", id: node.id, patch: { fills: fresh.fills.map((p, i) => (i === now.index ? { ...now.paint, id } : p)) } }] });
}

// ---- Export ----

// How long an asset's video runs: its longest trimmed video.
export function assetDuration(doc: NagmaDocument, assetId: string): number {
    return Math.max(0, ...videoLayers(doc, assetId).map((n) => trimOf(videoOf(n)?.video as VideoFill).length));
}

const fileTime = (video: VideoFill, t: number) => {
    const { start, length } = trimOf(video);
    return start + (video.loop ? t % length : Math.min(t, length - 0.01));
};

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// An asset as an MP4 (exact frames and the mixed sound of its videos, at their volumes).
export async function renderMp4(doc: NagmaDocument, assetId: string, scale: number, onProgress?: (fraction: number) => void): Promise<Blob> {
    const asset = doc.nodes[assetId];
    if (!asset) throw new Error("That asset is gone.");
    const fps = 30;
    const seconds = Math.max(0.5, assetDuration(doc, assetId));
    const frames = Math.max(1, Math.round(seconds * fps));
    const width = Math.max(2, Math.round(asset.w * scale)) & ~1;
    const height = Math.max(2, Math.round(asset.h * scale)) & ~1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const vp: Viewport = { width, height, dpr: 1, place: (f) => fillPlacement(f, width, height) };
    const layers = videoLayers(doc, assetId).map((n) => videoOf(n)).filter((v): v is NonNullable<ReturnType<typeof videoOf>> => Boolean(v));
    const rate = 48000;
    const sound = layers.some((v) => v.video.hasAudio && !v.video.muted && (v.video.volume ?? 1) > 0);
    const engine = await loadVideoEngine();
    const kbps = Math.min(20000, Math.max(1500, Math.round((width * height) / 200)));
    const writer = new engine.Mp4Writer2(width, height, fps, kbps, sound ? rate : 0, 2);
    const sources = new Map<string, Awaited<ReturnType<typeof sourceFor>>>();
    const sourceFor = async (video: VideoFill) => {
        const blob = await loadMedia(video.id);
        if (!blob) return null;
        return new engine.VideoSource(video.name, new Uint8Array(await blob.arrayBuffer()));
    };
    try {
        for (const v of layers) if (!sources.has(v.video.id)) sources.set(v.video.id, await sourceFor(v.video));
        let audioCursor = 0;
        for (let f = 0; f < frames; f++) {
            const t = f / fps;
            for (const v of layers) {
                const frame = await exactFrame(v.paint, fileTime(v.video, t));
                if (frame) showLive(v.paint.id, frame);
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            drawScreen(ctx, doc, assetId, vp);
            const data = ctx.getImageData(0, 0, width, height).data;
            writer.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            if (sound) {
                const until = Math.round(((f + 1) / fps) * rate);
                const n = until - audioCursor;
                if (n > 0) {
                    const out = new Float32Array(n * 2);
                    for (const v of layers) {
                        const src = sources.get(v.video.id);
                        if (!src || !v.video.hasAudio || v.video.muted) continue;
                        const level = Math.max(0, Math.min(1, v.video.volume ?? 1));
                        const samples = src.audio(fileTime(v.video, audioCursor / rate), n, rate, 2);
                        for (let i = 0; i < out.length; i++) out[i] += (samples[i] ?? 0) * level;
                    }
                    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
                    writer.pushAudio(out);
                }
                audioCursor = until;
            }
            if (f % 10 === 9) {
                onProgress?.((f + 1) / frames);
                await yieldToUi();
            }
        }
        const bytes = writer.finish();
        return new Blob([bytes as BlobPart], { type: "video/mp4" });
    } catch (error) {
        writer.free();
        throw error;
    } finally {
        for (const v of layers) showLive(v.paint.id, null);
        for (const src of sources.values()) src?.free();
    }
}

// An asset as a WebM, recorded in real time from the browser's own players (sound included).
export async function recordWebm(doc: NagmaDocument, assetId: string, scale: number, onProgress?: (fraction: number) => void): Promise<Blob> {
    const asset = doc.nodes[assetId];
    if (!asset) throw new Error("That asset is gone.");
    if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video.");
    const seconds = Math.max(0.5, assetDuration(doc, assetId));
    const width = Math.max(2, Math.round(asset.w * scale));
    const height = Math.max(2, Math.round(asset.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    const vp: Viewport = { width, height, dpr: 1, place: (f) => fillPlacement(f, width, height) };
    const layers = videoLayers(doc, assetId).map((n) => videoOf(n)).filter((v): v is NonNullable<ReturnType<typeof videoOf>> => Boolean(v));
    const audio = new AudioContext();
    const mix = audio.createMediaStreamDestination();
    const players: { el: HTMLVideoElement; url: string; v: (typeof layers)[number] }[] = [];
    for (const v of layers) {
        const blob = await loadMedia(v.video.id);
        if (!blob) continue;
        const el = document.createElement("video");
        const url = URL.createObjectURL(blob);
        el.src = url;
        el.playsInline = true;
        await new Promise<void>((resolve) => {
            el.onloadeddata = () => resolve();
            el.onerror = () => resolve();
        });
        el.currentTime = trimOf(v.video).start;
        if (v.video.hasAudio && !v.video.muted) {
            const gain = audio.createGain();
            gain.gain.value = Math.max(0, Math.min(1, v.video.volume ?? 1));
            audio.createMediaElementSource(el).connect(gain).connect(mix);
        } else el.muted = true;
        players.push({ el, url, v });
        showLive(v.paint.id, el);
    }
    const stream = canvas.captureStream(30);
    for (const track of mix.stream.getAudioTracks()) stream.addTrack(track);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(20_000_000, Math.max(1_000_000, width * height * 4)) });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    try {
        await audio.resume();
        recorder.start();
        await Promise.all(players.map((p) => p.el.play().catch(() => undefined)));
        const started = performance.now();
        await new Promise<void>((resolve) => {
            const frame = () => {
                const t = (performance.now() - started) / 1000;
                for (const p of players) {
                    const { start, end } = trimOf(p.v.video);
                    if (p.el.currentTime >= end - 0.02) {
                        if (p.v.video.loop) p.el.currentTime = start;
                        else p.el.pause();
                    }
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, width, height);
                drawScreen(ctx, doc, assetId, vp);
                onProgress?.(Math.min(1, t / seconds));
                if (t >= seconds) resolve();
                else setTimeout(frame, 1000 / 30);
            };
            // Timers rather than animation frames, so a recording in a background tab still finishes.
            frame();
        });
        recorder.stop();
        await done;
        return new Blob(chunks, { type: "video/webm" });
    } finally {
        for (const p of players) {
            p.el.pause();
            URL.revokeObjectURL(p.url);
            showLive(p.v.paint.id, null);
        }
        void audio.close();
    }
}

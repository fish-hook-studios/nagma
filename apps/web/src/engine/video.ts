import { nanoid } from "nanoid";
import { type VideoInfo, type VideoSource, isVideoFile, loadVideoEngine, parseVideoInfo } from "../engines/video-engine";
import { frameAt, makeNode } from "./nodes";
import { imagePaint } from "./paint";
import { storeDataUrl } from "./image-store";
import { rgbaToPng } from "./photo";
import { loadMedia, storeMedia } from "./media";
import { editor } from "./store";
import { apply, spaceMatrix } from "./transform";
import type { Command, ImagePaint, NagmaDocument, SceneNode, VideoFill } from "./types";
import type { VMedia } from "./video/model";

// Video fills: a video file is read by FilmCraft for its facts and poster frame, kept in media
// storage, and placed as an image fill that plays when the design plays (Motion mode, the
// prototype player) and renders exactly, frame by frame with sound, when it's exported.

const sources = new Map<string, Promise<VideoSource>>();

async function source(id: string, name: string): Promise<VideoSource> {
    let s = sources.get(id);
    if (!s) {
        s = (async () => {
            const [engine, blob] = await Promise.all([loadVideoEngine(), loadMedia(id)]);
            if (!blob) throw new Error("This video's file is missing from this browser.");
            return new engine.VideoSource(name, new Uint8Array(await blob.arrayBuffer()));
        })();
        sources.set(id, s);
    }
    return s;
}

// Reads a video file: facts, a poster, and the bytes into media storage. Files FilmCraft can't
// decode (VP8 WebM from screen recorders and browsers) are read by the browser instead, as the
// video editor's media bin does (they failed with "no decoder for VP8 video").
export async function importVideo(file: File): Promise<{ poster: { id: string; data: string }; video: VideoFill }> {
    const engine = await loadVideoEngine();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let read: { info: Pick<VideoInfo, "seconds" | "width" | "height" | "fps" | "hasAudio">; poster: string } | null = null;
    let src: VideoSource | null = null;
    try {
        src = new engine.VideoSource(file.name, bytes);
    } catch {
        // The browser tries below.
    }
    if (src) {
        try {
            const info = parseVideoInfo(src);
            if (!info.hasVideo) throw new Error("That file has no video in it.");
            const frame = src.frame(Math.min(0.5, info.seconds / 2), 1);
            try {
                read = { info, poster: await rgbaToPng(frame.rgba, frame.width, frame.height) };
            } finally {
                frame.free();
            }
        } catch (error) {
            if (error instanceof Error && error.message === "That file has no video in it.") throw error;
        } finally {
            src.free();
        }
    }
    if (!read) {
        const { browserInfo } = await import("./video/import");
        const browser = await browserInfo(file, "video").catch(() => null);
        const info = browser?.info;
        if (!browser?.poster || !info?.seconds || !info.width || !info.height) throw new Error(bytes.length ? "its format isn't supported, or the file is damaged." : "the file is empty.");
        read = { info: { seconds: info.seconds, width: info.width, height: info.height, fps: info.fps ?? 30, hasAudio: info.hasAudio ?? false }, poster: browser.poster };
    }
    const { info } = read;
    const id = nanoid(12);
    await storeMedia(id, file);
    return {
        poster: { id: nanoid(12), data: await storeDataUrl(read.poster) },
        video: { id, name: file.name, seconds: info.seconds, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, loop: true, muted: false },
    };
}

// A video fill as the video editor's media, for its browser-based frame and sound readers.
function asMedia(video: VideoFill): VMedia {
    return { id: video.id, kind: "video", name: video.name, store: video.id, seconds: video.seconds, width: video.width, height: video.height, fps: video.fps || 30, hasAudio: video.hasAudio };
}

export function videoPaint(poster: string, video: VideoFill): ImagePaint {
    return { ...imagePaint(poster, "fill"), video };
}

// Places video files as rectangles at their own size, like images.
export async function placeVideos(files: File[], at: { x: number; y: number }): Promise<string[]> {
    const videos = files.filter((f) => isVideoFile(f));
    if (!videos.length) return [];
    editor.notify("Opening video…");
    const created: string[] = [];
    const commands: Command[] = [];
    const { doc } = editor.get();
    const parentId = frameAt(doc, at.x, at.y);
    const local = apply(spaceMatrix(doc, parentId).inverse(), at.x, at.y);
    let offset = 0;
    for (const file of videos) {
        try {
            const { poster, video } = await importVideo(file);
            // Big videos are shown at half size so they fit on screen; the file keeps its pixels.
            const scale = Math.min(1, 960 / Math.max(video.width, video.height, 1));
            const w = Math.max(1, Math.round(video.width * scale));
            const h = Math.max(1, Math.round(video.height * scale));
            const node = makeNode(doc, "rect", { x: local.x - w / 2 + offset, y: local.y - h / 2 + offset, w, h }, parentId, {
                name: file.name.replace(/\.[^.]+$/, "") || "Video",
                fills: [videoPaint(poster.id, video)],
            });
            commands.push({ type: "image.add", id: poster.id, data: poster.data }, { type: "node.create", node });
            created.push(node.id);
            offset += 24;
        } catch (error) {
            editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (commands.length) {
        editor.execute({ type: "batch", commands });
        editor.set({ selection: created, tool: "move" });
    }
    return created;
}

// ---- Playback: live frames the renderer draws instead of the poster ----

const live = new Map<string, CanvasImageSource>();
const players = new Map<string, HTMLVideoElement>();
const playerUrls = new Map<string, string>();

// The frame to draw for a poster image right now, when its video is playing.
export function liveFrame(posterId: string): CanvasImageSource | undefined {
    return live.get(posterId);
}

// Shows a source as a poster's live frame (or clears it); the prototype player drives its own playback.
export function showLive(posterId: string, source: CanvasImageSource | null) {
    if (source) live.set(posterId, source);
    else live.delete(posterId);
}

export function videoPaints(doc: NagmaDocument): { node: SceneNode; paint: ImagePaint }[] {
    const out: { node: SceneNode; paint: ImagePaint }[] = [];
    for (const node of Object.values(doc.nodes)) for (const paint of node.fills) if (paint.type === "image" && paint.video && paint.visible) out.push({ node, paint });
    return out;
}

// The browser's own player for a video file (one per file), ready after its metadata loads.
export async function getPlayer(video: VideoFill): Promise<HTMLVideoElement | null> {
    const existing = players.get(video.id);
    if (existing) return existing;
    const blob = await loadMedia(video.id);
    if (!blob) return null;
    const el = document.createElement("video");
    el.muted = video.muted;
    el.loop = video.loop;
    el.playsInline = true;
    el.preload = "auto";
    const url = URL.createObjectURL(blob);
    playerUrls.set(video.id, url);
    el.src = url;
    players.set(video.id, el);
    await new Promise<void>((resolve) => {
        el.onloadedmetadata = () => resolve();
        el.onerror = () => resolve();
    });
    return el;
}

export function cachedPlayer(video: VideoFill): HTMLVideoElement | null {
    const el = players.get(video.id);
    return el && el.readyState >= 2 && !Number.isNaN(el.duration) ? el : null;
}

// Puts a player at `seconds` (into the file), playing or paused. False when the browser can't
// decode the file.
export function syncElement(el: HTMLVideoElement, video: VideoFill, seconds: number, playing: boolean, loop = video.loop, muted = video.muted): boolean {
    if (el.readyState < 2 || Number.isNaN(el.duration)) return false;
    const t = Math.min(seconds, Math.max(0, el.duration - 0.01));
    el.loop = loop;
    el.muted = muted;
    if (playing) {
        if (Math.abs(el.currentTime - t) > 0.3) el.currentTime = t;
        if (el.paused) void el.play().catch(() => undefined);
    } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - t) > 0.05) el.currentTime = t;
    }
    return true;
}

// Keeps every video fill on the page at `seconds` (and playing or paused). The browser decodes
// playback; files it can't play fall back to FilmCraft frames.
export function syncPlayback(doc: NagmaDocument, seconds: number, playing: boolean) {
    for (const { paint } of videoPaints(doc)) {
        const video = paint.video;
        if (!video) continue;
        const t = video.loop ? seconds % Math.max(video.seconds, 0.001) : Math.min(seconds, video.seconds);
        void getPlayer(video).then((el) => {
            if (el && syncElement(el, video, t, playing)) live.set(paint.id, el);
            else void exactFrame(paint, t).then((frame) => frame && live.set(paint.id, frame));
        });
    }
}

export function stopPlayback() {
    for (const el of players.values()) el.pause();
    live.clear();
}

// ---- Export: exact frames and audio from FilmCraft ----

const frameCanvases = new Map<string, HTMLCanvasElement>();

export async function exactFrame(paint: ImagePaint, seconds: number): Promise<HTMLCanvasElement | null> {
    const video = paint.video;
    if (!video) return null;
    let canvas = frameCanvases.get(video.id);
    if (!canvas) {
        canvas = document.createElement("canvas");
        frameCanvases.set(video.id, canvas);
    }
    try {
        const src = await source(video.id, video.name);
        const frame = src.frame(seconds, 1);
        try {
            canvas.width = frame.width;
            canvas.height = frame.height;
            const rgba = frame.rgba;
            canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), frame.width, frame.height), 0, 0);
            return canvas;
        } finally {
            frame.free();
        }
    } catch {
        // Not one FilmCraft decodes: the browser's player seeks to the frame.
        const { exactFrame: browserFrame } = await import("./video/sources");
        const frame = await browserFrame(asMedia(video), seconds, 1);
        if (!frame || !("width" in frame)) return null;
        canvas.width = Number(frame.width);
        canvas.height = Number(frame.height);
        canvas.getContext("2d")?.drawImage(frame, 0, 0);
        return canvas;
    }
}

// Sets every video fill's live frame to its exact FilmCraft frame at `seconds`, for export.
export async function syncExact(doc: NagmaDocument, seconds: number) {
    for (const { paint } of videoPaints(doc)) {
        const video = paint.video;
        if (!video) continue;
        const t = video.loop ? seconds % Math.max(video.seconds, 0.001) : Math.min(seconds, video.seconds);
        const frame = await exactFrame(paint, t);
        if (frame) live.set(paint.id, frame);
    }
}

// `frames` stereo samples of one video file from `seconds` into it (silence past its end).
export async function audioOf(video: VideoFill, seconds: number, frames: number, rate: number): Promise<Float32Array> {
    if (!video.hasAudio || seconds >= video.seconds) return new Float32Array(frames * 2);
    try {
        const src = await source(video.id, video.name);
        return src.audio(seconds, frames, rate, 2);
    } catch {
        // The browser decodes what FilmCraft can't (Opus in a VP8 WebM).
        const { readAudio } = await import("./video/sources");
        return readAudio(asMedia(video), seconds, frames, rate);
    }
}

// Mixes the audio of every unmuted video fill for `frames` samples from `seconds`, interleaved stereo.
export async function mixAudio(doc: NagmaDocument, seconds: number, frames: number, rate: number): Promise<Float32Array> {
    const out = new Float32Array(frames * 2);
    for (const { paint } of videoPaints(doc)) {
        const video = paint.video;
        if (!video?.hasAudio || video.muted) continue;
        const t = video.loop ? seconds % Math.max(video.seconds, 0.001) : seconds;
        const samples = await audioOf(video, t, frames, rate);
        for (let i = 0; i < out.length; i++) out[i] += samples[i] ?? 0;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
}

export function hasVideo(doc: NagmaDocument): boolean {
    return videoPaints(doc).length > 0;
}

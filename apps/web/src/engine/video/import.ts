import { nanoid } from "nanoid";
import { isVideoFile, loadVideoEngine, parseVideoInfo } from "../../engines/video-engine";
import { storeDataUrl } from "../image-store";
import { readImage } from "../images";
import { storeMedia } from "../media";
import { rgbaToPng } from "../photo";
import type { Command } from "../types";
import { PEAK_RATE, type VMedia } from "./model";
import { peaksOf } from "./sources";

// Adding files to the media bin: video, sound and stills. FilmCraft reads each file's facts and
// a poster frame; files it can't open are read by the browser instead. The bytes go to media
// storage (this browser and the sync server), the poster into the document's images.

export function isAudioFile(file: { name: string; type?: string }): boolean {
    return Boolean(file.type?.startsWith("audio/")) || /\.(mp3|wav|aac|m4a|flac|ogg|oga|opus|aif|aiff|caf)$/i.test(file.name);
}

export function isMediaFile(file: File): boolean {
    return isVideoFile(file) || isAudioFile(file) || file.type.startsWith("image/");
}

export interface Imported {
    media: VMedia;
    commands: Command[];
}

export async function importMediaFile(file: File): Promise<Imported | null> {
    if (isVideoFile(file) && !isAudioFile(file)) return importAv(file, "video");
    if (isAudioFile(file)) return importAv(file, "audio");
    const image = await readImage(file);
    if (!image) return null;
    return {
        media: { id: nanoid(10), kind: "image", name: file.name, store: image.id, poster: image.id, seconds: 0, width: image.width, height: image.height, fps: 0, hasAudio: false },
        commands: [{ type: "image.add", id: image.id, data: image.data }],
    };
}

async function importAv(file: File, kind: "video" | "audio"): Promise<Imported> {
    const store = nanoid(12);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let media: VMedia = { id: nanoid(10), kind, name: file.name, store, seconds: 0, width: 0, height: 0, fps: 0, hasAudio: kind === "audio" };
    let poster: string | null = null;
    let read = false;
    try {
        const engine = await loadVideoEngine();
        const src = new engine.VideoSource(file.name, bytes);
        try {
            const info = parseVideoInfo(src);
            if (kind === "video" && !info.hasVideo) kind = "audio";
            media = { ...media, kind, seconds: info.seconds, width: info.width, height: info.height, fps: info.fps || 30, hasAudio: info.hasAudio };
            if (kind === "video" && info.hasVideo) {
                const frame = src.frame(Math.min(0.5, info.seconds / 2), Math.min(1, 480 / Math.max(1, info.width)));
                try {
                    poster = await rgbaToPng(frame.rgba, frame.width, frame.height);
                } finally {
                    frame.free();
                }
            }
            read = info.seconds > 0;
        } finally {
            src.free();
        }
    } catch {
        // The browser reads it below.
    }
    if (!read) {
        const browser = await browserInfo(file, kind);
        media = { ...media, ...browser.info };
        poster = browser.poster;
    }
    if (!media.seconds) throw new Error("That file couldn't be read.");
    // Only a file that could be read is kept (and uploaded): a damaged one was stored first.
    await storeMedia(store, file);
    const commands: Command[] = [];
    if (poster) {
        const id = nanoid(12);
        commands.push({ type: "image.add", id, data: await storeDataUrl(poster) });
        media.poster = id;
    }
    if (media.hasAudio) {
        try {
            media.peaks = await peaksOf(media, PEAK_RATE);
            if (!media.peaks.some((p) => p > 0.001) && !read) media.hasAudio = false;
        } catch {
            // No waveform.
        }
    }
    return { media, commands };
}

export async function browserInfo(file: File, kind: "video" | "audio"): Promise<{ info: Partial<VMedia>; poster: string | null }> {
    const url = URL.createObjectURL(file);
    try {
        const el = document.createElement(kind === "video" ? "video" : "audio") as HTMLMediaElement;
        el.preload = "auto";
        el.muted = true;
        el.src = url;
        await new Promise<void>((resolve, reject) => {
            el.onloadeddata = () => resolve();
            el.onerror = () => reject(new Error("That file couldn't be read."));
        });
        // Recordings often report no length until the end has been seen.
        if (!Number.isFinite(el.duration)) {
            el.currentTime = 1e9;
            await new Promise<void>((resolve) => {
                el.ontimeupdate = () => resolve();
                window.setTimeout(resolve, 2000);
            });
        }
        const seconds = Number.isFinite(el.duration) ? el.duration : 0;
        let poster: string | null = null;
        const info: Partial<VMedia> = { seconds, hasAudio: true };
        if (el instanceof HTMLVideoElement) {
            info.width = el.videoWidth;
            info.height = el.videoHeight;
            info.fps = 30;
            el.currentTime = Math.min(0.5, seconds / 2);
            await new Promise<void>((resolve) => {
                el.onseeked = () => resolve();
                window.setTimeout(resolve, 2000);
            });
            const canvas = document.createElement("canvas");
            const k = Math.min(1, 480 / Math.max(1, el.videoWidth));
            canvas.width = Math.max(1, Math.round(el.videoWidth * k));
            canvas.height = Math.max(1, Math.round(el.videoHeight * k));
            canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
            poster = canvas.toDataURL("image/jpeg", 0.85);
        }
        return { info, poster };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function pickFiles(accept: string, onFiles: (files: File[]) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length) onFiles(files);
    };
    input.click();
}

export const MEDIA_ACCEPT = "video/*,audio/*,image/*,.mov,.mkv,.webm,.mxf,.mts,.m2ts,.wav,.mp3,.m4a,.aac,.flac,.ogg";

import { loadMotionEngine } from "../../engines/motion-engine";
import { zipFiles } from "../export";
import { loadVideoEngine } from "../../engines/video-engine";
import type { NagmaDocument } from "../types";
import { mixComp } from "./audio";
import { type VComp, type VProject, compLength } from "./model";
import { renderComp } from "./render";
import { exportAnimatedSvg, exportLottie } from "./vector-export";
import { webmWriter } from "./webm";

// Rendering a composition to a file: MP4 (H.264 video and AAC sound), WebM (VP9 or VP8 video and
// Opus sound, from the browser's encoders), an animated GIF, Lottie or animated SVG (vector-export.ts),
// or one frame as PNG.

export type ExportFormat = "mp4" | "webm" | "gif" | "lottie" | "dotlottie" | "svg" | "png";

export interface ExportSettings {
    format: ExportFormat;
    // Output height in pixels (the width follows the composition's shape).
    height: number;
    fps: number;
    // 0..1: bitrate for MP4.
    quality: number;
    // The in/out range, or the whole composition.
    range: "all" | "inout";
    // PNG: the frame at this time.
    at?: number;
    // GIF: play once or loop forever.
    loop?: boolean;
    // Lottie and SVG: the most pictures for clips drawn frame by frame.
    maxImages?: number;
}

// The last file exported, for checking it (window.__nagmaLastExport in the console too).
export interface ExportedFile {
    blob: Blob;
    name: string;
    seconds: number;
    width: number;
    height: number;
}
let last: ExportedFile | null = null;
export function lastExport(): ExportedFile | null {
    return last;
}
export function setLastExport(file: ExportedFile) {
    last = file;
    (window as unknown as { __nagmaLastExport?: ExportedFile }).__nagmaLastExport = file;
}

export interface ExportProgress {
    frame: number;
    frames: number;
    stage: "video" | "finishing";
}

export function exportRange(comp: VComp, range: ExportSettings["range"]): [number, number] {
    const len = compLength(comp);
    if (range === "inout") {
        const a = comp.inPoint ?? 0;
        const b = comp.outPoint ?? len;
        if (b > a) return [a, b];
    }
    return [0, len];
}

export function outputSize(comp: VComp, height: number): { width: number; height: number } {
    const h = Math.max(2, Math.round(Math.min(height, 4320)));
    const w = Math.round((h * comp.width) / comp.height);
    return { width: Math.max(2, w & ~1), height: Math.max(2, h & ~1) };
}

export async function renderToFile(project: VProject, doc: NagmaDocument, comp: VComp, settings: ExportSettings, onProgress: (p: ExportProgress) => void, cancelled: () => boolean): Promise<Blob | null> {
    const { width, height } = outputSize(comp, settings.format === "gif" ? Math.min(settings.height, 720) : settings.height);
    const scale = height / comp.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const opts = { project, doc, scale, exact: true, tag: "export:" };
    // Effects need the compositor loaded before the first frame.
    if (comp.clips.some((c) => c.effects.length) || project.comps.some((c) => c.clips.some((cl) => cl.effects.length))) await loadMotionEngine();
    if (settings.format === "png") {
        await renderComp(ctx, comp, settings.at ?? 0, opts);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    const [from, to] = exportRange(comp, settings.range);
    const fps = Math.max(1, Math.min(120, settings.fps));
    const frames = Math.max(1, Math.round((to - from) * fps));
    if (settings.format === "lottie" || settings.format === "dotlottie" || settings.format === "svg") {
        const progress = (p: { done: number; total: number }) => onProgress({ frame: p.done, frames: Math.max(1, p.total), stage: "video" });
        const blob = settings.format === "svg" ? await exportAnimatedSvg(project, doc, comp, [from, to], height, settings.maxImages ?? 240, progress, cancelled) : await exportLottie(project, doc, comp, [from, to], height, fps, settings.maxImages ?? 240, progress, cancelled);
        onProgress({ frame: 1, frames: 1, stage: "finishing" });
        if (!blob || settings.format !== "dotlottie") return blob;
        // dotLottie: the animation and a manifest in a zip.
        const id = (comp.name || "animation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "animation";
        const manifest = { version: "1", generator: "Nagma", animations: [{ id, autoplay: true, loop: true, speed: 1 }] };
        const zip = await zipFiles([
            { name: "manifest.json", blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }) },
            { name: `animations/${id}.json`, blob },
        ]);
        return new Blob([zip], { type: "application/zip" });
    }
    if (settings.format === "webm") {
        const rate = 48000;
        const bitrate = Math.min(80_000_000, Math.max(800_000, Math.round(width * height * fps * (0.03 + settings.quality * 0.12))));
        const writer = await webmWriter(canvas, fps, bitrate, { rate, channels: 2 });
        let ok = false;
        try {
            let audioCursor = 0;
            for (let f = 0; f < frames; f++) {
                if (cancelled()) return null;
                await renderComp(ctx, comp, from + f / fps, opts);
                await writer.frame();
                if (writer.hasAudio) {
                    const until = Math.round(((f + 1) / fps) * rate);
                    const n = until - audioCursor;
                    if (n > 0) writer.sound(await mixComp(project, comp, from + audioCursor / rate, n, rate), audioCursor / rate);
                    audioCursor = until;
                }
                onProgress({ frame: f + 1, frames, stage: "video" });
                if (f % 3 === 2) await new Promise((r) => setTimeout(r, 0));
            }
            onProgress({ frame: frames, frames, stage: "finishing" });
            const blob = await writer.finish(to - from);
            ok = true;
            return blob;
        } finally {
            if (!ok) writer.cancel();
        }
    }
    if (settings.format === "gif") {
        const engine = await loadMotionEngine();
        const gifFps = Math.min(fps, 25);
        const gifFrames = Math.max(1, Math.round((to - from) * gifFps));
        const enc = new engine.GifEncoder(width, height, gifFps);
        try {
            for (let f = 0; f < gifFrames; f++) {
                if (cancelled()) {
                    enc.free();
                    return null;
                }
                await renderComp(ctx, comp, from + f / gifFps, opts);
                const data = ctx.getImageData(0, 0, width, height).data;
                enc.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
                onProgress({ frame: f + 1, frames: gifFrames, stage: "video" });
                if (f % 2 === 1) await new Promise((r) => setTimeout(r, 0));
            }
            onProgress({ frame: gifFrames, frames: gifFrames, stage: "finishing" });
            const bytes = enc.finish();
            return new Blob([(settings.loop === false ? playOnce(bytes) : bytes) as BlobPart], { type: "image/gif" });
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }
    const engine = await loadVideoEngine();
    const rate = 48000;
    const kbps = Math.min(80000, Math.max(800, Math.round(((width * height * fps) / 1000) * (0.03 + settings.quality * 0.12))));
    const writer = new engine.Mp4Writer2(width, height, fps, kbps, rate, 2);
    let done = false;
    try {
        let audioCursor = 0;
        for (let f = 0; f < frames; f++) {
            if (cancelled()) return null;
            const t = from + f / fps;
            await renderComp(ctx, comp, t, opts);
            const data = ctx.getImageData(0, 0, width, height).data;
            writer.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            const until = Math.round(((f + 1) / fps) * rate);
            const n = until - audioCursor;
            if (n > 0) writer.pushAudio(await mixComp(project, comp, from + audioCursor / rate, n, rate));
            audioCursor = until;
            onProgress({ frame: f + 1, frames, stage: "video" });
            if (f % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
        onProgress({ frame: frames, frames, stage: "finishing" });
        await new Promise((r) => setTimeout(r, 0));
        const bytes = writer.finish();
        done = true;
        return new Blob([bytes as BlobPart], { type: "video/mp4" });
    } finally {
        if (!done) writer.free();
    }
}

// A GIF that plays once: without the looping extension ("NETSCAPE2.0") browsers stop at the end.
function playOnce(bytes: Uint8Array): Uint8Array {
    const tag = [0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0")];
    for (let i = 13; i < Math.min(bytes.length - tag.length, 4096); i++) {
        if (tag.every((b, k) => bytes[i + k] === b)) {
            // The extension: its 3-byte sub-block (loop count) and the terminator follow the tag.
            const end = i + tag.length + 5;
            const out = new Uint8Array(bytes.length - (end - i));
            out.set(bytes.subarray(0, i), 0);
            out.set(bytes.subarray(end), i);
            return out;
        }
    }
    return bytes;
}

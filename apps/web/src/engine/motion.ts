import { strToU8, zipSync } from "fflate";
import { exportAnimatedSvg } from "./export-svg";
import type { LottieFile } from "./lottie";
import { type Viewport, drawScreen, drawTransition, fillPlacement } from "../canvas/screen";
import { loadMotionEngine, inspectLottie } from "../engines/motion-engine";
import { type Mp4Writer, loadVideoEngine } from "../engines/video-engine";
import { hasVideo, mixAudio, stopPlayback, syncExact } from "./video";
import { download, safeName } from "./export";
import { animatedDoc, durationOf, hasAnimation } from "./animation";
import { inlineImages } from "./image-store";
import { buildLottie, buildLottieFromAnimation } from "./lottie";
import { DEFAULT_TRANSITION, actionsOf, subtree } from "./prototype";
import { transitionDuration } from "./easing-curves";
import { editor } from "./store";
import type { Interaction, NagmaDocument, SceneNode, Transition } from "./types";

// How long a screen stays before a click-driven transition plays, when nothing says otherwise.
export const DEFAULT_HOLD = 1500;
const MAX_STEPS = 12;

export interface Step {
    screen: string;
    // Milliseconds the screen stays before moving on.
    hold: number;
    next: { to: string; transition: Transition } | null;
}

export type MotionFormat = "mp4" | "gif" | "lottie" | "webm" | "dotlottie" | "svganim";

export function transitionMs(t: Transition): number {
    return transitionDuration(t);
}

// The flow from a screen as a timeline: each screen holds (for its delay, or a moment for click
// hotspots), then plays the transition of its first interaction that leads somewhere. The flow
// ends at a screen it has seen before, or one that goes nowhere.
export function buildTimeline(doc: NagmaDocument, startId: string): Step[] {
    const steps: Step[] = [];
    const seen = new Set<string>();
    let current: string | null = startId;
    while (current && doc.nodes[current] && !seen.has(current) && steps.length < MAX_STEPS) {
        seen.add(current);
        const here: string = current;
        const interactions: Interaction[] = subtree(doc, here).flatMap((n) => n.interactions ?? []);
        // Each interaction's first navigation leads on.
        const leads = interactions.flatMap((it) => {
            const nav = actionsOf(it).find((a) => a.type === "navigate" && a.target && doc.nodes[a.target] && a.target !== here);
            return nav?.target ? [{ trigger: it.trigger, delay: it.delay, target: nav.target, transition: nav.transition ?? DEFAULT_TRANSITION }] : [];
        });
        const pick = leads.find((it) => it.trigger === "delay") ?? leads[0];
        if (!pick?.target) {
            steps.push({ screen: current, hold: DEFAULT_HOLD, next: null });
            break;
        }
        steps.push({ screen: current, hold: pick.trigger === "delay" ? Math.max(100, pick.delay) : DEFAULT_HOLD, next: { to: pick.target, transition: pick.transition } });
        current = pick.target;
    }
    // The flow ends on the screen the last transition leads to: a full view of a new screen, or
    // just the arrival when it loops back to one already shown.
    const last = steps[steps.length - 1];
    if (last?.next) steps.push({ screen: last.next.to, hold: steps.some((s) => s.screen === last.next?.to) ? 0 : DEFAULT_HOLD, next: null });
    return steps;
}

export function timelineDuration(steps: Step[]): number {
    return steps.reduce((sum, s) => sum + s.hold + (s.next ? transitionMs(s.next.transition) : 0), 0);
}

// Draws the flow at a time in milliseconds.
export function drawMotionAt(ctx: CanvasRenderingContext2D, doc: NagmaDocument, steps: Step[], time: number, vp: Viewport) {
    let at = 0;
    for (const step of steps) {
        if (time < at + step.hold || !step.next) {
            drawScreen(ctx, doc, step.screen, vp);
            return;
        }
        at += step.hold;
        const ms = transitionMs(step.next.transition);
        if (time < at + ms) {
            drawTransition(ctx, doc, step.screen, step.next.to, step.next.transition, (time - at) / ms, false, vp);
            return;
        }
        at += ms;
    }
    const last = steps[steps.length - 1];
    const end = last?.next ? last.next.to : last?.screen;
    if (end) drawScreen(ctx, doc, end, vp);
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Renders the flow from a screen and saves it as a video, a GIF, or a Lottie animation.
export async function exportMotion(doc: NagmaDocument, startId: string, format: MotionFormat, scale: number) {
    const start = doc.nodes[startId];
    if (!start) return;
    const steps = buildTimeline(doc, startId);
    const name = safeName(start.name);
    if (format === "svganim") {
        editor.notify("Animated SVG exports a frame's Motion keyframes; a prototype flow goes out as MP4, WebM, GIF or Lottie.");
        return;
    }
    if (format === "webm") {
        const duration = timelineDuration(steps);
        await recordWebm(name, Math.max(2, Math.round(start.w * scale)), Math.max(2, Math.round(start.h * scale)), 30, duration, (ctx, ms, vp) => drawMotionAt(ctx, doc, steps, ms, vp));
        return;
    }
    if (format === "lottie" || format === "dotlottie") {
        const fps = 30;
        const json = buildLottie(await inlineImages(doc), steps, fps);
        if (format === "dotlottie") {
            download(dotLottie(json, name), `${name}.lottie`);
            editor.notify("dotLottie saved.");
            return;
        }
        const bytes = new TextEncoder().encode(JSON.stringify(json));
        // EffectCraft reads it back, so what's saved is known to open in a real motion tool.
        let note = "";
        try {
            const info = await inspectLottie(bytes);
            note = ` It has ${info.layers.length} layers over ${info.seconds.toFixed(1)}s.`;
            if (info.warnings.length) console.warn("Lottie warnings:", info.warnings);
        } catch (error) {
            console.warn("Lottie check failed", error);
        }
        download(new Blob([bytes], { type: "application/json" }), `${name}.json`);
        editor.notify(`Lottie saved.${note}`);
        return;
    }
    const fps = format === "gif" ? 15 : 30;
    const duration = timelineDuration(steps);
    const frames = Math.max(1, Math.ceil((duration / 1000) * fps));
    // Even sizes: H.264 works in 2×2 blocks.
    const width = Math.max(2, Math.round(start.w * scale)) & ~1;
    const height = Math.max(2, Math.round(start.h * scale)) & ~1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const vp: Viewport = { width, height, dpr: 1, place: (frame) => fillPlacement(frame, width, height) };
    editor.notify(`Rendering ${format.toUpperCase()}…`);
    const engine = await loadMotionEngine();
    const kbps = Math.min(20000, Math.max(1500, Math.round((width * height) / 250)));
    const encoder = format === "mp4" ? new engine.Mp4Encoder(width, height, fps, kbps) : new engine.GifEncoder(width, height, fps);
    try {
        for (let f = 0; f < frames; f++) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            drawMotionAt(ctx, doc, steps, (f / fps) * 1000, vp);
            const data = ctx.getImageData(0, 0, width, height).data;
            encoder.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            if (f % 10 === 9) {
                editor.notify(`Rendering ${format.toUpperCase()}… ${Math.round(((f + 1) / frames) * 100)}%`);
                await yieldToUi();
            }
        }
        const bytes = encoder.finish();
        download(new Blob([bytes as BlobPart], { type: format === "mp4" ? "video/mp4" : "image/gif" }), `${name}.${format}`);
        editor.notify(`${format.toUpperCase()} saved: ${frames} frames, ${(duration / 1000).toFixed(1)}s.`);
    } catch (error) {
        encoder.free();
        throw error;
    }
}

// Whether a frame has something to export as motion: keyframes, or a prototype flow.
export function isAnimatedFrame(doc: NagmaDocument, frame: SceneNode | undefined): boolean {
    if (!frame) return false;
    const subtree = (id: string): SceneNode[] => {
        const n = doc.nodes[id];
        return n ? [n, ...n.children.flatMap(subtree)] : [];
    };
    const nodes = subtree(frame.id);
    return nodes.some(hasAnimation) || nodes.some((n) => n.interactions?.some((it) => actionsOf(it).some((a) => a.type === "navigate" && a.target)));
}

export interface AnimatedExport {
    format: MotionFormat;
    scale: number;
    fps: number;
    // 0 to 1: video bitrate and GIF colour quality.
    quality: number;
}

// Export › Animated: a frame's Motion keyframes (or, without any, its prototype flow) as MP4,
// GIF or Lottie.
export async function exportAnimated(doc: NagmaDocument, frameId: string, opts: AnimatedExport) {
    const frame = doc.nodes[frameId];
    if (!frame) return;
    const subtree = (id: string): SceneNode[] => {
        const n = doc.nodes[id];
        return n ? [n, ...n.children.flatMap(subtree)] : [];
    };
    if (!subtree(frameId).some(hasAnimation)) {
        await exportMotion(doc, frameId, opts.format, opts.scale);
        return;
    }
    const duration = durationOf(doc, frameId);
    const name = safeName(frame.name);
    if (opts.format === "svganim") {
        const svg = exportAnimatedSvg(await inlineImages(doc), frameId);
        if (!svg) return;
        download(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
        editor.notify("Animated SVG saved: Motion keyframes as CSS animations (position, size, rotation, opacity).");
        return;
    }
    if (opts.format === "webm") {
        await recordWebm(name, Math.max(2, Math.round(frame.w * opts.scale)), Math.max(2, Math.round(frame.h * opts.scale)), opts.fps, duration, (ctx, ms, vp) => drawScreen(ctx, animatedDoc(doc, ms), frameId, vp));
        return;
    }
    if (opts.format === "lottie" || opts.format === "dotlottie") {
        const json = buildLottieFromAnimation(await inlineImages(doc), frameId, opts.fps);
        if (opts.format === "dotlottie") {
            download(dotLottie(json, name), `${name}.lottie`);
            editor.notify("dotLottie saved.");
            return;
        }
        const bytes = new TextEncoder().encode(JSON.stringify(json));
        let note = "";
        try {
            const info = await inspectLottie(bytes);
            note = ` It has ${info.layers.length} layers over ${info.seconds.toFixed(1)}s.`;
        } catch (error) {
            console.warn("Lottie check failed", error);
        }
        download(new Blob([bytes], { type: "application/json" }), `${name}.json`);
        editor.notify(`Lottie saved.${note}`);
        return;
    }
    const fps = opts.format === "gif" ? Math.min(opts.fps, 30) : opts.fps;
    const frames = Math.max(1, Math.round((duration / 1000) * fps));
    const width = Math.max(2, Math.round(frame.w * opts.scale)) & ~1;
    const height = Math.max(2, Math.round(frame.h * opts.scale)) & ~1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const vp: Viewport = { width, height, dpr: 1, place: (f) => fillPlacement(f, width, height) };
    editor.notify(`Rendering ${opts.format.toUpperCase()}…`);
    const kbps = Math.min(40000, Math.max(800, Math.round(((width * height) / 250) * (0.4 + opts.quality * 1.2))));
    const withVideo = hasVideo(doc);
    // MP4 goes through FilmCraft's writer, which also carries the sound of any video fills.
    const rate = 48000;
    const encoder =
        opts.format === "mp4"
            ? new (await loadVideoEngine()).Mp4Writer2(width, height, fps, kbps, withVideo ? rate : 0, 2)
            : new (await loadMotionEngine()).GifEncoder(width, height, fps);
    try {
        let audioCursor = 0;
        for (let f = 0; f <= frames; f++) {
            const seconds = f / fps;
            if (withVideo) await syncExact(doc, seconds);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            drawScreen(ctx, animatedDoc(doc, seconds * 1000), frameId, vp);
            const data = ctx.getImageData(0, 0, width, height).data;
            encoder.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            if (withVideo && opts.format === "mp4") {
                const until = Math.round(((f + 1) / fps) * rate);
                const n = until - audioCursor;
                if (n > 0) (encoder as Mp4Writer).pushAudio(await mixAudio(doc, audioCursor / rate, n, rate));
                audioCursor = until;
            }
            if (f % 10 === 9) {
                editor.notify(`Rendering ${opts.format.toUpperCase()}… ${Math.round((f / frames) * 100)}%`);
                await yieldToUi();
            }
        }
        if (withVideo) stopPlayback();
        const bytes = encoder.finish();
        download(new Blob([bytes as BlobPart], { type: opts.format === "mp4" ? "video/mp4" : "image/gif" }), `${name}.${opts.format}`);
        editor.notify(`${opts.format.toUpperCase()} saved: ${(duration / 1000).toFixed(1)}s at ${fps} fps.`);
    } catch (error) {
        encoder.free();
        throw error;
    }
}


// A dotLottie: a zip with a manifest and the animation JSON, as players expect.
function dotLottie(json: LottieFile, name: string): Blob {
    const manifest = { version: "1.0", generator: "Nagma", author: "", animations: [{ id: name, speed: 1, loop: true, direction: 1 }] };
    const zip = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), [`animations/${name}.json`]: strToU8(JSON.stringify(json)) }, { level: 6 });
    return new Blob([zip as BlobPart], { type: "application/zip" });
}

// WebM through the browser's own encoder: frames are drawn to a canvas in real time and recorded.
async function recordWebm(name: string, width: number, height: number, fps: number, duration: number, draw: (ctx: CanvasRenderingContext2D, ms: number, vp: Viewport) => void) {
    if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    const vp: Viewport = { width, height, dpr: 1, place: (f) => fillPlacement(f, width, height) };
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(20_000_000, Math.max(1_000_000, width * height * 4)) });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    editor.notify(`Recording WebM in real time (${(duration / 1000).toFixed(1)}s)…`);
    recorder.start();
    const frames = Math.max(1, Math.round((duration / 1000) * fps));
    const started = performance.now();
    for (let f = 0; f <= frames; f++) {
        const ms = (f / fps) * 1000;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        draw(ctx, ms, vp);
        track?.requestFrame();
        const wait = started + ms - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    recorder.stop();
    await done;
    download(new Blob(chunks, { type: "video/webm" }), `${name}.webm`);
    editor.notify(`WebM saved: ${(duration / 1000).toFixed(1)}s at ${fps} fps.`);
}

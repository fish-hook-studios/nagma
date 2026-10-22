import { type Viewport, drawScreen, fillPlacement } from "../../canvas/screen";
import { loadMotionEngine } from "../../engines/motion-engine";
import { animatedDoc, durationOf, hasAnimation } from "../animation";
import type { NagmaDocument } from "../types";
import {
    type VBlend,
    type VClip,
    type VComp,
    type VMask,
    type VMedia,
    type VProject,
    type VTitle,
    type VTrack,
    type TransitionKind,
    clipEnd,
    clipsOn,
    compById,
    effectParamsAt,
    keysValue,
    mediaById,
    parentMatrix,
    propAt,
    transformAnimated,
    videoTracks,
} from "./model";
import { LOOKS } from "./presets";
import { shapeOutlines } from "./shapes";
import { clipPlayer, exactFrame, stillImage } from "./sources";

// Draws a composition at a time: each video track bottom to top, each clip through its source,
// crop, masks, colour, effects (EffectCraft's library) and transform, with blend modes,
// transitions between clips, adjustment layers and nested compositions.

export interface RenderOptions {
    project: VProject;
    doc: NagmaDocument;
    // Output pixels per composition pixel.
    scale: number;
    // Exact frames from the decoder (export, paused); otherwise the playing players' frames.
    exact: boolean;
    // Effects off for speed (drafts while scrubbing).
    draft?: boolean;
    // Renders running at the same time (the monitor and an export) use their own canvases.
    tag?: string;
}

interface Ctx extends RenderOptions {
    depth: number;
}

// ---- Canvases, reused per purpose ----

const pool = new Map<string, HTMLCanvasElement>();

function canvas(key: string, w: number, h: number): HTMLCanvasElement {
    let c = pool.get(key);
    if (!c) {
        c = document.createElement("canvas");
        pool.set(key, c);
    }
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
    } else c.getContext("2d")?.clearRect(0, 0, W, H);
    return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("No 2D canvas");
    return g;
}

export function blendOp(blend: VBlend): GlobalCompositeOperation {
    if (blend === "add") return "lighter";
    if (blend === "normal") return "source-over";
    return blend as GlobalCompositeOperation;
}

// ---- What's on a track at a time ----

export type TrackShot =
    | { kind: "clip"; clip: VClip; lt: number }
    | { kind: "transition"; a: VClip | null; b: VClip | null; ta: number; tb: number; p: number; transition: TransitionKind };

function adjacentBefore(on: VClip[], c: VClip, fps: number): VClip | undefined {
    return on.find((o) => o.id !== c.id && Math.abs(clipEnd(o) - c.start) < 0.5 / fps);
}

function adjacentAfter(on: VClip[], c: VClip, fps: number): VClip | undefined {
    return on.find((o) => o.id !== c.id && Math.abs(o.start - clipEnd(c)) < 0.5 / fps);
}

export function trackShot(comp: VComp, track: VTrack, t: number): TrackShot | null {
    const on = clipsOn(comp, track.id).filter((c) => !c.disabled);
    const fps = Math.max(1, comp.fps);
    for (const c of on) {
        if (c.tin && c.tin.duration > 0) {
            const prev = adjacentBefore(on, c, fps);
            const d = c.tin.duration;
            const w0 = prev ? c.start - d / 2 : c.start;
            if (t >= w0 && t < w0 + d) return { kind: "transition", a: prev ?? null, b: c, ta: prev ? t - prev.start : 0, tb: t - c.start, p: (t - w0) / d, transition: c.tin.kind };
        }
        if (c.tout && c.tout.duration > 0 && !adjacentAfter(on, c, fps)) {
            const d = c.tout.duration;
            const w0 = clipEnd(c) - d;
            if (t >= w0 && t < clipEnd(c)) return { kind: "transition", a: c, b: null, ta: t - c.start, tb: 0, p: (t - w0) / d, transition: c.tout.kind };
        }
    }
    const clip = on.find((c) => t >= c.start && t < clipEnd(c));
    return clip ? { kind: "clip", clip, lt: t - clip.start } : null;
}

// Time into the source at `lt` seconds into the clip, running past its edges into the source's
// handles (transitions show a little more of each side).
export function sourceAt(clip: VClip, lt: number, length: number): number {
    // Time remapping: the keyframes say where in the source each moment of the clip is.
    const remap = clip.anim.time;
    const t = remap?.length ? keysValue(remap, lt) : clip.reverse ? clip.in + clip.duration * clip.speed - lt * clip.speed : clip.in + lt * clip.speed;
    return Math.max(0, Math.min(Number.isFinite(length) ? length : t, t));
}

export function timeRemapped(clip: VClip): boolean {
    return (clip.anim.time?.length ?? 0) > 0;
}

// ---- Layer size: media fit inside the frame ----

export function layerSize(project: VProject, comp: VComp, clip: VClip): { w: number; h: number } {
    let mw = comp.width;
    let mh = comp.height;
    const media = mediaById(project, clip.media);
    if ((clip.kind === "video" || clip.kind === "image") && media && media.width > 0 && media.height > 0) {
        mw = media.width;
        mh = media.height;
    } else if (clip.kind === "comp") {
        const nested = compById(project, clip.comp);
        mw = nested.width;
        mh = nested.height;
    } else if (clip.kind === "shape") {
        return { w: comp.width, h: comp.height };
    }
    const fit = Math.min(comp.width / mw, comp.height / mh);
    return { w: mw * fit, h: mh * fit };
}

// ---- Composition ----

export async function renderComp(out: CanvasRenderingContext2D, comp: VComp, t: number, opts: RenderOptions & { depth?: number }): Promise<void> {
    const c: Ctx = { ...opts, depth: opts.depth ?? 0 };
    const W = out.canvas.width;
    const H = out.canvas.height;
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = 1;
    out.globalCompositeOperation = "source-over";
    out.filter = "none";
    if (comp.background && comp.background !== "transparent") {
        out.fillStyle = comp.background;
        out.fillRect(0, 0, W, H);
    } else out.clearRect(0, 0, W, H);
    out.restore();
    if (c.depth > 6) return;
    const tracks = videoTracks(comp);
    const shots = tracks.map((track) => (track.hidden ? null : trackShot(comp, track, t)));
    for (let i = 0; i < tracks.length; i++) {
        const shot = shots[i];
        if (!shot) continue;
        // A matte source (the clip above a matted clip) is used by that clip, not drawn itself.
        const below = shots[i - 1];
        if (below?.kind === "clip" && below.clip.matte && matteSource(shot)) continue;
        if (shot.kind === "clip") {
            if (shot.clip.kind === "audio") continue;
            const matte = shot.clip.matte ? matteSource(shots[i + 1]) : null;
            if (shot.clip.kind === "adjustment") await adjust(out, comp, shot.clip, shot.lt, c, 1);
            else if (matte) await drawMatted(out, comp, shot.clip, shot.lt, matte.clip, matte.lt, c);
            else await drawClip(out, comp, shot.clip, shot.lt, c, { alpha: 1, dx: 0, dy: 0, zoom: 1 });
        } else await drawTransition(out, comp, shot, c);
    }
}

// The shot on the track above a matted clip, when it's a picture that can be a matte.
export function matteSource(shot: TrackShot | null | undefined): Extract<TrackShot, { kind: "clip" }> | null {
    if (!shot || shot.kind !== "clip" || shot.clip.kind === "audio" || shot.clip.kind === "adjustment") return null;
    return shot;
}

interface Mod {
    alpha: number;
    dx: number;
    dy: number;
    zoom: number;
    blur?: number;
}

// Sub-frame samples a motion-blurred clip averages, over a 180 degree shutter (half a frame).
const BLUR_SAMPLES = 8;

async function drawClip(out: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, c: Ctx, mod: Mod) {
    const layer = await renderLayer(comp, clip, lt, c);
    if (!layer) return;
    const s = c.scale;
    const opacity = Math.max(0, Math.min(1, propAt(comp, clip, "opacity", lt) / 100));
    const blurred = Boolean(clip.motionBlur) && !c.draft && transformAnimated(clip);
    let picture: HTMLCanvasElement = layer.canvas;
    let place = (g: CanvasRenderingContext2D) => placeLayer(g, comp, clip, layer, lt, s, mod);
    if (blurred) {
        // The samples average into their own frame (alpha 1/(i+1) keeps a running mean), then
        // that frame goes on with the clip's blend mode and opacity.
        const frame = canvas(`${c.tag ?? ""}B${c.depth}:${clip.id}`, out.canvas.width, out.canvas.height);
        const fg = ctx2d(frame);
        const shutter = 0.5 / Math.max(1, comp.fps);
        for (let i = 0; i < BLUR_SAMPLES; i++) {
            const st = lt - shutter / 2 + (shutter * (i + 0.5)) / BLUR_SAMPLES;
            fg.save();
            fg.globalAlpha = 1 / (i + 1);
            placeLayer(fg, comp, clip, layer, st, s, mod);
            fg.restore();
        }
        picture = frame;
        place = (g) => g.drawImage(picture, 0, 0);
    }
    out.save();
    out.globalAlpha = opacity * mod.alpha;
    out.globalCompositeOperation = blendOp(clip.blend);
    if (mod.blur) out.filter = `blur(${mod.blur * s}px)`;
    place(out);
    out.restore();
}

// Draws a rendered layer where the clip's transform (and its parents') puts it at `lt`.
function placeLayer(out: CanvasRenderingContext2D, comp: VComp, clip: VClip, layer: Layer, lt: number, s: number, mod: Mod) {
    const x = propAt(comp, clip, "x", lt);
    const y = propAt(comp, clip, "y", lt);
    const sx = propAt(comp, clip, "scaleX", lt) / 100;
    const sy = propAt(comp, clip, "scaleY", lt) / 100;
    const rot = (propAt(comp, clip, "rotation", lt) * Math.PI) / 180;
    const ax = propAt(comp, clip, "anchorX", lt);
    const ay = propAt(comp, clip, "anchorY", lt);
    const cx = comp.width / 2;
    const cy = comp.height / 2;
    out.save();
    // Transition zooms scale about the frame's centre.
    out.translate((cx + mod.dx) * s, (cy + mod.dy) * s);
    out.scale(mod.zoom, mod.zoom);
    out.translate(-cx * s, -cy * s);
    if (clip.parent) {
        const p = parentMatrix(comp, clip, lt);
        out.transform(p[0], p[1], p[2], p[3], p[4] * s, p[5] * s);
    }
    out.translate(x * s, y * s);
    out.rotate(rot);
    out.scale(sx, sy);
    out.translate(-(layer.lw / 2 + ax) * s, -(layer.lh / 2 + ay) * s);
    out.drawImage(layer.canvas, -layer.ox, -layer.oy);
    out.restore();
}

interface Layer {
    canvas: HTMLCanvasElement;
    // Where the layer's top left sits in the canvas (effects can grow it).
    ox: number;
    oy: number;
    // The layer's size in composition pixels.
    lw: number;
    lh: number;
}

async function renderLayer(comp: VComp, clip: VClip, lt: number, c: Ctx): Promise<Layer | null> {
    const s = c.scale;
    const { w: lw, h: lh } = layerSize(c.project, comp, clip);
    const key = `${c.tag ?? ""}L${c.depth}:${clip.id}`;
    const cv = canvas(key, lw * s, lh * s);
    const g = ctx2d(cv);
    const W = cv.width;
    const H = cv.height;
    const media = mediaById(c.project, clip.media);
    const drew = await drawSource(g, comp, clip, media, lt, W, H, c);
    if (!drew) return null;
    crop(g, comp, clip, lt, W, H);
    masks(g, comp, clip, lt, W, H, key, s);
    color(g, comp, clip, lt, W, H);
    let layer: Layer = { canvas: cv, ox: 0, oy: 0, lw, lh };
    if (!c.draft) layer = await effects(layer, comp, clip, lt, c, key);
    return layer;
}

async function drawSource(g: CanvasRenderingContext2D, _comp: VComp, clip: VClip, media: VMedia | undefined, lt: number, W: number, H: number, c: Ctx): Promise<boolean> {
    switch (clip.kind) {
        case "video": {
            if (!media) return false;
            const st = sourceAt(clip, lt, media.seconds);
            let frame: CanvasImageSource | null = null;
            if (!c.exact && c.depth === 0) {
                const el = clipPlayer(clip.id, media, "video") as HTMLVideoElement | null;
                if (el && !el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - st) < 0.2) frame = el;
            }
            frame ??= await exactFrame(media, st, Math.min(1, W / Math.max(1, media.width)));
            if (!frame) return false;
            g.imageSmoothingQuality = "high";
            g.drawImage(frame, 0, 0, W, H);
            return true;
        }
        case "image": {
            if (!media) return false;
            const img = await stillImage(c.doc, media.store);
            if (!img) return false;
            g.imageSmoothingQuality = "high";
            if (media.width > 0) g.drawImage(img, 0, 0, W, H);
            else {
                // Files from before the bin knew their size: fit inside the frame.
                const k = Math.min(W / img.width, H / img.height);
                g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
            }
            return true;
        }
        case "solid": {
            g.fillStyle = clip.color ?? "#3355FF";
            g.fillRect(0, 0, W, H);
            return true;
        }
        case "title": {
            if (!clip.title) return false;
            drawTitle(g, clip.title, W, H, c.scale, lt, clip.duration);
            return true;
        }
        case "shape": {
            if (!clip.shapes && !clip.shape) return false;
            drawShape(g, _comp, clip, lt, W, H, c.scale);
            return true;
        }
        case "comp": {
            const nested = c.project.comps.find((n) => n.id === clip.comp);
            if (!nested) return false;
            const inner = canvas(`${c.tag ?? ""}C${c.depth + 1}:${clip.id}`, W, H);
            const st = sourceAt(clip, lt, Infinity);
            await renderComp(ctx2d(inner), nested, st, { ...c, scale: W / Math.max(1, nested.width), depth: c.depth + 1 });
            g.drawImage(inner, 0, 0);
            return true;
        }
        case "frame": {
            const frame = clip.frame ? c.doc.nodes[clip.frame] : undefined;
            if (!frame) return false;
            const animLen = durationOf(c.doc, frame.id);
            const shown = hasAnimation(frame) || frame.children.some((id) => hasAnimation(c.doc.nodes[id])) ? animatedDoc(c.doc, (lt * 1000) % Math.max(animLen, 1)) : c.doc;
            const vp: Viewport = { width: W, height: H, dpr: 1, place: (f) => fillPlacement(f, W, H) };
            drawScreen(g, shown, frame.id, vp);
            return true;
        }
        default:
            return false;
    }
}

// ---- Titles ----

function easeOutCubic(p: number) {
    return 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
}

function easeOutBack(p: number) {
    const k = 1.70158;
    const x = Math.max(0, Math.min(1, p)) - 1;
    return 1 + (k + 1) * x * x * x + k * x * x;
}

export function drawTitle(g: CanvasRenderingContext2D, title: VTitle, W: number, H: number, s: number, lt: number, duration: number) {
    const dur = Math.max(0.05, Math.min(title.animDur, duration / 2));
    const pin = title.animIn === "none" ? 1 : Math.min(1, lt / dur);
    const pout = title.animOut === "none" ? 1 : Math.min(1, (duration - lt) / dur);
    const text = title.uppercase ? title.text.toUpperCase() : title.text;
    const size = title.size * s;
    g.save();
    g.font = `${title.italic ? "italic " : ""}${title.weight} ${size}px "${title.font}", Inter, system-ui, sans-serif`;
    g.textBaseline = "middle";
    g.textAlign = title.align;
    const lines = text.split("\n");
    const lh = size * title.lineHeight;
    // Animations that act on the whole block.
    let alpha = 1;
    let dx = 0;
    let dy = 0;
    let zoom = 1;
    let rot = 0;
    let blur = 0;
    let tracking = title.tracking * s;
    let chars = Infinity;
    let wordsShown = Infinity;
    let wipe = 1;
    const apply = (anim: VTitle["animIn"], p: number, out: boolean) => {
        if (p >= 1) return;
        const e = easeOutCubic(p);
        switch (anim) {
            case "fade":
                alpha *= e;
                break;
            case "rise":
                alpha *= e;
                dy += (1 - e) * size * 0.6 * (out ? -1 : 1);
                break;
            case "drop":
                alpha *= e;
                dy -= (1 - e) * size * 0.6 * (out ? -1 : 1);
                break;
            case "slide-left":
                alpha *= e;
                dx += (1 - e) * W * 0.15 * (out ? -1 : 1);
                break;
            case "slide-right":
                alpha *= e;
                dx -= (1 - e) * W * 0.15 * (out ? -1 : 1);
                break;
            case "zoom":
                alpha *= e;
                zoom *= 0.6 + 0.4 * e;
                break;
            case "pop":
                alpha *= Math.min(1, p * 4);
                zoom *= Math.max(0, easeOutBack(p));
                break;
            case "blur":
                alpha *= e;
                blur = Math.max(blur, (1 - e) * 24 * s);
                break;
            case "typewriter":
                chars = Math.min(chars, Math.floor(p * text.replace(/\n/g, "").length));
                break;
            case "words":
                wordsShown = Math.min(wordsShown, p * text.split(/\s+/).length);
                break;
            case "wipe":
                wipe = Math.min(wipe, e);
                break;
            case "spin":
                alpha *= e;
                rot += (1 - e) * (out ? 1 : -1) * Math.PI * 0.5;
                zoom *= 0.5 + 0.5 * e;
                break;
            case "tracking":
                alpha *= e;
                tracking += (1 - e) * size * 0.5;
                break;
            default:
                break;
        }
    };
    apply(title.animIn, pin, false);
    apply(title.animOut, pout, true);
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (blur > 0.2) g.filter = `blur(${blur}px)`;
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tracking}px`;
    const widths = lines.map((l) => g.measureText(l).width);
    const blockW = Math.max(...widths, 1);
    const blockH = lh * lines.length;
    const anchorX = title.align === "left" ? -blockW / 2 : title.align === "right" ? blockW / 2 : 0;
    g.translate(W / 2 + dx, H / 2 + dy);
    g.rotate(rot);
    g.scale(zoom, zoom);
    if (wipe < 1) {
        const pad = (title.box?.padding ?? 0) * s + size;
        g.beginPath();
        g.rect(-blockW / 2 - pad, -blockH / 2 - pad, (blockW + pad * 2) * wipe, blockH + pad * 2);
        g.clip();
    }
    if (title.box) {
        const pad = title.box.padding * s;
        g.save();
        g.fillStyle = title.box.color;
        g.beginPath();
        g.roundRect(-blockW / 2 - pad, -blockH / 2 - pad, blockW + pad * 2, blockH + pad * 2, title.box.radius * s);
        g.fill();
        g.restore();
    }
    if (title.shadow) {
        g.shadowColor = title.shadow.color;
        g.shadowBlur = title.shadow.blur * s;
        g.shadowOffsetX = title.shadow.x * s;
        g.shadowOffsetY = title.shadow.y * s;
    }
    g.fillStyle = title.color;
    let shownChars = chars;
    let wordIndex = 0;
    lines.forEach((line, i) => {
        const y = -blockH / 2 + lh * (i + 0.5);
        let visible = line;
        if (Number.isFinite(shownChars)) {
            visible = line.slice(0, Math.max(0, shownChars));
            shownChars -= line.length;
        }
        if (Number.isFinite(wordsShown)) {
            // Each word fades in on its turn.
            const words = line.split(/(\s+)/);
            const full = g.measureText(line).width;
            let x = anchorX + (title.align === "center" ? -full / 2 : title.align === "right" ? -full : 0);
            g.textAlign = "left";
            for (const w of words) {
                const width = g.measureText(w).width;
                if (w.trim()) {
                    const a = Math.max(0, Math.min(1, wordsShown - wordIndex));
                    g.globalAlpha = Math.max(0, Math.min(1, alpha)) * a;
                    if (title.stroke && title.stroke.width > 0) strokeText(g, title, w, x, y, s);
                    g.fillText(w, x, y);
                    wordIndex++;
                }
                x += width;
            }
            g.textAlign = title.align;
            return;
        }
        if (title.stroke && title.stroke.width > 0) strokeText(g, title, visible, title.align === "center" ? anchorX : anchorX, y, s);
        g.fillText(visible, anchorX, y);
    });
    g.restore();
}

function strokeText(g: CanvasRenderingContext2D, title: VTitle, text: string, x: number, y: number, s: number) {
    if (!title.stroke) return;
    g.save();
    g.strokeStyle = title.stroke.color;
    g.lineWidth = title.stroke.width * s * 2;
    g.lineJoin = "round";
    g.strokeText(text, x, y);
    g.restore();
}

// ---- Shapes ----

// Each item of a shape layer in order: its outlines (trimmed when Trim Paths is on) filled,
// then stroked with its caps, joins and dashes.
function drawShape(g: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, W: number, H: number, s: number) {
    g.save();
    g.translate(W / 2, H / 2);
    for (const o of shapeOutlines(comp, clip, lt)) {
        if (!o.lines.length || o.opacity <= 0) continue;
        g.save();
        g.globalAlpha = o.opacity;
        g.beginPath();
        for (const line of o.lines) {
            line.points.forEach((p, i) => (i ? g.lineTo(p.x * s, p.y * s) : g.moveTo(p.x * s, p.y * s)));
            if (line.closed) g.closePath();
        }
        if (o.item.fill) {
            g.fillStyle = o.item.fill;
            g.fill();
        }
        if (o.item.stroke && o.strokeWidth > 0) {
            g.strokeStyle = o.item.stroke;
            g.lineWidth = o.strokeWidth * s;
            g.lineCap = o.item.cap;
            g.lineJoin = o.item.join;
            if (o.item.dash.length && o.item.dash.some((d) => d > 0)) {
                g.setLineDash(o.item.dash.map((d) => Math.max(0, d) * s));
                g.lineDashOffset = o.dashOffset * s;
            }
            g.stroke();
        }
        g.restore();
    }
    g.restore();
}

// ---- Crop and masks ----

function crop(g: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, W: number, H: number) {
    const l = propAt(comp, clip, "crop.l", lt) / 100;
    const t = propAt(comp, clip, "crop.t", lt) / 100;
    const r = propAt(comp, clip, "crop.r", lt) / 100;
    const b = propAt(comp, clip, "crop.b", lt) / 100;
    if (l > 0) g.clearRect(0, 0, W * l, H);
    if (t > 0) g.clearRect(0, 0, W, H * t);
    if (r > 0) g.clearRect(W * (1 - r), 0, W * r + 1, H);
    if (b > 0) g.clearRect(0, H * (1 - b), W, H * b + 1);
}

function masks(g: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, W: number, H: number, key: string, s: number) {
    if (!clip.masks.length) return;
    const m = canvas(`M:${key}`, W, H);
    const mg = ctx2d(m);
    const first = clip.masks[0];
    if (first?.mode === "subtract") {
        mg.fillStyle = "#000";
        mg.fillRect(0, 0, W, H);
    }
    clip.masks.forEach((mask, i) => {
        const p = (k: string) => propAt(comp, clip, `mask.${mask.id}.${k}`, lt);
        const feather = Math.max(0, p("feather")) * s;
        const expand = p("expand") * s;
        // The first mask starts from nothing, so an intersect there means add.
        const mode = i === 0 && mask.mode === "intersect" ? "add" : mask.mode;
        mg.save();
        mg.globalAlpha = Math.max(0, Math.min(1, p("opacity") / 100));
        mg.globalCompositeOperation = mode === "subtract" ? "destination-out" : mode === "intersect" ? "destination-in" : "source-over";
        if (feather > 0.5) mg.filter = `blur(${feather}px)`;
        mg.fillStyle = "#000";
        mg.strokeStyle = "#000";
        mg.lineJoin = "round";
        maskPath(mg, mask, p, W, H);
        mg.fill();
        // Expansion grows the shape by stroking its edge; shrinking cuts the edge back off.
        if (expand > 0.5) {
            mg.lineWidth = expand * 2;
            mg.stroke();
        } else if (expand < -0.5 && mode === "add") {
            mg.globalCompositeOperation = "destination-out";
            mg.lineWidth = -expand * 2;
            mg.stroke();
        }
        mg.restore();
    });
    g.save();
    g.globalCompositeOperation = "destination-in";
    g.drawImage(m, 0, 0);
    g.restore();
}

// A mask's outline on a W × H layer: its rectangle, ellipse or path (fractions of the layer).
export function maskPath(g: CanvasRenderingContext2D, mask: VMask, p: (k: string) => number, W: number, H: number) {
    g.beginPath();
    if (mask.shape === "path") {
        const pts = mask.points ?? [];
        pts.forEach((pt, i) => (i ? g.lineTo(pt.x * W, pt.y * H) : g.moveTo(pt.x * W, pt.y * H)));
        g.closePath();
        return;
    }
    const x = p("x") * W;
    const y = p("y") * H;
    const w = p("w") * W;
    const h = p("h") * H;
    if (mask.shape === "ellipse") g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else g.rect(x, y, w, h);
}

// ---- Track mattes: the clip on the track above cuts this clip out ----

async function drawMatted(out: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, matte: VClip, mlt: number, c: Ctx) {
    const W = out.canvas.width;
    const H = out.canvas.height;
    const kind = clip.matte ?? "alpha";
    const key = `${c.tag ?? ""}TM${c.depth}:${clip.id}`;
    // Both sides drawn alone (normal blend, full opacity on the matte), then combined.
    const fill = canvas(key, W, H);
    await drawClip(ctx2d(fill), comp, { ...clip, blend: "normal", matte: null }, lt, c, { alpha: 1, dx: 0, dy: 0, zoom: 1 });
    const cut = canvas(`${key}:m`, W, H);
    const cg = ctx2d(cut);
    await drawClip(cg, comp, { ...matte, blend: "normal", matte: null }, mlt, c, { alpha: 1, dx: 0, dy: 0, zoom: 1 });
    if (kind === "luma" || kind === "luma-inverted") {
        // Brightness becomes coverage.
        const img = cg.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const l = (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0)) * ((d[i + 3] ?? 0) / 255);
            d[i + 3] = kind === "luma" ? l : 255 - l;
        }
        cg.putImageData(img, 0, 0);
    } else if (kind === "alpha-inverted") {
        cg.save();
        cg.globalCompositeOperation = "source-out";
        cg.fillStyle = "#000";
        cg.fillRect(0, 0, W, H);
        cg.restore();
    }
    const fg = ctx2d(fill);
    fg.save();
    fg.globalCompositeOperation = "destination-in";
    fg.drawImage(cut, 0, 0);
    fg.restore();
    out.save();
    out.globalCompositeOperation = blendOp(clip.blend);
    out.drawImage(fill, 0, 0);
    out.restore();
}

// ---- Colour ----

const lookLuts = new Map<string, Float32Array>();
const LUT_N = 17;

function lookLut(id: string): Float32Array | null {
    const known = lookLuts.get(id);
    if (known) return known;
    const look = LOOKS.find((l) => l.id === id);
    if (!look) return null;
    const lut = new Float32Array(LUT_N * LUT_N * LUT_N * 3);
    for (let b = 0; b < LUT_N; b++)
        for (let gg = 0; gg < LUT_N; gg++)
            for (let r = 0; r < LUT_N; r++) {
                const [R, G, B] = look.fn([r / (LUT_N - 1), gg / (LUT_N - 1), b / (LUT_N - 1)]);
                const i = ((b * LUT_N + gg) * LUT_N + r) * 3;
                lut[i] = R;
                lut[i + 1] = G;
                lut[i + 2] = B;
            }
    lookLuts.set(id, lut);
    return lut;
}

function sampleLut(lut: Float32Array, r: number, g: number, b: number, out: number[]) {
    const n = LUT_N - 1;
    const fr = Math.max(0, Math.min(1, r)) * n;
    const fg = Math.max(0, Math.min(1, g)) * n;
    const fb = Math.max(0, Math.min(1, b)) * n;
    const r0 = Math.min(n - 1, Math.floor(fr));
    const g0 = Math.min(n - 1, Math.floor(fg));
    const b0 = Math.min(n - 1, Math.floor(fb));
    const dr = fr - r0;
    const dg = fg - g0;
    const db = fb - b0;
    for (let c = 0; c < 3; c++) {
        const at = (ri: number, gi: number, bi: number) => lut[((bi * LUT_N + gi) * LUT_N + ri) * 3 + c] ?? 0;
        const c00 = at(r0, g0, b0) * (1 - dr) + at(r0 + 1, g0, b0) * dr;
        const c10 = at(r0, g0 + 1, b0) * (1 - dr) + at(r0 + 1, g0 + 1, b0) * dr;
        const c01 = at(r0, g0, b0 + 1) * (1 - dr) + at(r0 + 1, g0, b0 + 1) * dr;
        const c11 = at(r0, g0 + 1, b0 + 1) * (1 - dr) + at(r0 + 1, g0 + 1, b0 + 1) * dr;
        out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db;
    }
}

export function colorActive(comp: VComp, clip: VClip, lt: number): boolean {
    const keys = ["color.exposure", "color.contrast", "color.highlights", "color.shadows", "color.vibrance", "color.temperature", "color.tint", "color.vignette"];
    if (clip.look) return true;
    if (Math.abs(propAt(comp, clip, "color.saturation", lt) - 100) > 0.01) return true;
    return keys.some((k) => Math.abs(propAt(comp, clip, k, lt)) > 0.001);
}

function color(g: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, W: number, H: number) {
    if (!colorActive(comp, clip, lt)) return;
    const p = (k: string) => propAt(comp, clip, `color.${k}`, lt);
    const exposure = Math.pow(2, p("exposure"));
    const contrast = 1 + p("contrast") / 100;
    const hi = p("highlights") / 100;
    const sh = p("shadows") / 100;
    const sat = p("saturation") / 100;
    const vib = p("vibrance") / 100;
    const temp = p("temperature") / 100;
    const tint = p("tint") / 100;
    const vignette = p("vignette") / 100;
    const lut = clip.look ? lookLut(clip.look) : null;
    const amount = Math.max(0, Math.min(1, p("look") / 100));
    // Per-channel curves: exposure, white balance and contrast.
    const curves = [0, 1, 2].map((ch) => {
        const wb = ch === 0 ? 1 + temp * 0.18 + tint * 0.06 : ch === 1 ? 1 - tint * 0.14 : 1 - temp * 0.18 + tint * 0.06;
        const table = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            let v = (i / 255) * exposure * wb;
            v = (v - 0.5) * contrast + 0.5;
            table[i] = v;
        }
        return table;
    });
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const tmp = [0, 0, 0];
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.hypot(cx, cy);
    const [cr, cg, cb] = curves as [Float32Array, Float32Array, Float32Array];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (d[i + 3] === 0) continue;
            let r = cr[d[i] ?? 0] ?? 0;
            let gg = cg[d[i + 1] ?? 0] ?? 0;
            let b = cb[d[i + 2] ?? 0] ?? 0;
            let l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
            if (hi || sh) {
                const lift = hi * 0.5 * Math.max(0, l - 0.5) * 2 + sh * 0.5 * Math.max(0, 0.5 - l) * 2;
                r += lift;
                gg += lift;
                b += lift;
                l += lift;
            }
            let k = sat;
            if (vib) {
                const mx = Math.max(r, gg, b);
                const mn = Math.min(r, gg, b);
                k *= 1 + vib * (1 - Math.min(1, (mx - mn) * 2));
            }
            if (k !== 1) {
                r = l + (r - l) * k;
                gg = l + (gg - l) * k;
                b = l + (b - l) * k;
            }
            if (lut) {
                sampleLut(lut, r, gg, b, tmp);
                r += ((tmp[0] ?? 0) - r) * amount;
                gg += ((tmp[1] ?? 0) - gg) * amount;
                b += ((tmp[2] ?? 0) - b) * amount;
            }
            if (vignette) {
                const dist = Math.hypot(x - cx, y - cy) / maxR;
                const v = 1 - vignette * Math.max(0, dist - 0.35) * 1.4;
                r *= v;
                gg *= v;
                b *= v;
            }
            d[i] = r * 255;
            d[i + 1] = gg * 255;
            d[i + 2] = b * 255;
        }
    }
    g.putImageData(img, 0, 0);
}

// ---- Effects ----

let fxWarned = false;

async function effects(layer: Layer, comp: VComp, clip: VClip, lt: number, c: Ctx, key: string): Promise<Layer> {
    const active = clip.effects.filter((e) => e.enabled);
    if (!active.length) return layer;
    let engine: Awaited<ReturnType<typeof loadMotionEngine>>;
    try {
        engine = await loadMotionEngine();
    } catch {
        return layer;
    }
    let cur = layer;
    let n = 0;
    for (const effect of active) {
        const W = cur.canvas.width;
        const H = cur.canvas.height;
        const data = ctx2d(cur.canvas).getImageData(0, 0, W, H);
        const params = effectParamsAt(comp, clip, effect, lt);
        try {
            const result = engine.applyEffect(effect.fx, JSON.stringify(params), new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength), W, H, c.scale, Math.max(0, lt), comp.fps, hashSeed(effect.id));
            try {
                const out = canvas(`F${n % 2}:${key}`, result.width, result.height);
                const rgba = result.rgba;
                ctx2d(out).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), result.width, result.height), 0, 0);
                cur = { ...cur, canvas: out, ox: cur.ox + result.offsetX, oy: cur.oy + result.offsetY };
                n++;
            } finally {
                result.free();
            }
        } catch (error) {
            if (!fxWarned) {
                fxWarned = true;
                console.warn(`Effect ${effect.name} failed:`, error);
            }
        }
    }
    return cur;
}

function hashSeed(id: string): number {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    return h >>> 0;
}

// ---- Adjustment layers: colour, effects and masks applied to everything below ----

async function adjust(out: CanvasRenderingContext2D, comp: VComp, clip: VClip, lt: number, c: Ctx, alpha: number) {
    const W = out.canvas.width;
    const H = out.canvas.height;
    const key = `${c.tag ?? ""}A${c.depth}:${clip.id}`;
    const cv = canvas(key, W, H);
    const g = ctx2d(cv);
    g.drawImage(out.canvas, 0, 0);
    color(g, comp, clip, lt, W, H);
    let layer: Layer = { canvas: cv, ox: 0, oy: 0, lw: comp.width, lh: comp.height };
    if (!c.draft) layer = await effects(layer, comp, clip, lt, c, key);
    // Masks limit where it applies.
    if (clip.masks.length) {
        const shaped = canvas(`${key}:m`, layer.canvas.width, layer.canvas.height);
        const sg = ctx2d(shaped);
        sg.drawImage(layer.canvas, 0, 0);
        masks(sg, comp, clip, lt, shaped.width, shaped.height, key, c.scale);
        layer = { ...layer, canvas: shaped };
    }
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = Math.max(0, Math.min(1, (propAt(comp, clip, "opacity", lt) / 100) * alpha));
    out.globalCompositeOperation = blendOp(clip.blend);
    out.drawImage(layer.canvas, -layer.ox, -layer.oy);
    out.restore();
}

// ---- Transitions ----

async function drawTransition(out: CanvasRenderingContext2D, comp: VComp, shot: Extract<TrackShot, { kind: "transition" }>, c: Ctx) {
    const W = out.canvas.width;
    const H = out.canvas.height;
    const p = Math.max(0, Math.min(1, shot.p));
    const kind = shot.transition;
    const side = async (clip: VClip | null, lt: number, key: string, mod: Mod): Promise<HTMLCanvasElement | null> => {
        if (!clip || clip.kind === "audio") return null;
        const cv = canvas(`${c.tag ?? ""}T${c.depth}:${key}`, W, H);
        const g = ctx2d(cv);
        if (clip.kind === "adjustment") {
            g.drawImage(out.canvas, 0, 0);
            await adjust(g, comp, clip, lt, c, 1);
        } else await drawClip(g, comp, clip, lt, c, mod);
        return cv;
    };
    const none: Mod = { alpha: 1, dx: 0, dy: 0, zoom: 1 };
    const dir = (k: string): [number, number] => (k.endsWith("left") ? [-1, 0] : k.endsWith("right") ? [1, 0] : k.endsWith("up") ? [0, -1] : [0, 1]);
    if (kind.startsWith("slide") || kind.startsWith("push")) {
        const [ux, uy] = dir(kind);
        // The incoming clip enters from the opposite side of its travel.
        const bOff: Mod = { ...none, dx: -ux * comp.width * (1 - p), dy: -uy * comp.height * (1 - p) };
        const aOff: Mod = kind.startsWith("push") ? { ...none, dx: ux * comp.width * p, dy: uy * comp.height * p } : none;
        const a = await side(shot.a, shot.ta, "a", aOff);
        const b = await side(shot.b, shot.tb, "b", { ...bOff, alpha: shot.a ? 1 : p });
        if (a) out.drawImage(a, 0, 0);
        if (b) out.drawImage(b, 0, 0);
        return;
    }
    if (kind.startsWith("wipe") || kind === "iris") {
        const a = await side(shot.a, shot.ta, "a", none);
        const b = await side(shot.b, shot.tb, "b", none);
        if (a) out.drawImage(a, 0, 0);
        if (b) {
            out.save();
            out.beginPath();
            if (kind === "iris") out.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * p, 0, Math.PI * 2);
            else if (kind === "wipe-right") out.rect(0, 0, W * p, H);
            else if (kind === "wipe-left") out.rect(W * (1 - p), 0, W * p, H);
            else if (kind === "wipe-down") out.rect(0, 0, W, H * p);
            else out.rect(0, H * (1 - p), W, H * p);
            out.clip();
            out.drawImage(b, 0, 0);
            out.restore();
        }
        return;
    }
    if (kind === "dip-black" || kind === "dip-white") {
        const fill = kind === "dip-black" ? "#000000" : "#FFFFFF";
        const first = p < 0.5;
        const cv = first ? await side(shot.a, shot.ta, "a", none) : await side(shot.b, shot.tb, "b", none);
        if (cv) out.drawImage(cv, 0, 0);
        out.save();
        out.globalAlpha = first ? p * 2 : (1 - p) * 2;
        out.fillStyle = fill;
        out.fillRect(0, 0, W, H);
        out.restore();
        return;
    }
    // Dissolves: A × (1 − p) + B × p, added premultiplied so partly transparent layers mix right.
    const zoomA = kind === "zoom-in" ? 1 + p * 0.4 : kind === "zoom-out" ? 1 - p * 0.3 : 1;
    const zoomB = kind === "zoom-in" ? 0.7 + p * 0.3 : kind === "zoom-out" ? 1.4 - p * 0.4 : 1;
    const blurA = kind === "blur" ? p * 30 : 0;
    const blurB = kind === "blur" ? (1 - p) * 30 : 0;
    const a = await side(shot.a, shot.ta, "a", { ...none, zoom: zoomA, blur: blurA });
    const b = await side(shot.b, shot.tb, "b", { ...none, zoom: zoomB, blur: blurB });
    const mixCv = canvas(`${c.tag ?? ""}X${c.depth}`, W, H);
    const mg = ctx2d(mixCv);
    if (a) {
        mg.globalAlpha = 1 - p;
        mg.drawImage(a, 0, 0);
    }
    if (b) {
        mg.globalAlpha = p;
        mg.globalCompositeOperation = "lighter";
        mg.drawImage(b, 0, 0);
    }
    mg.globalAlpha = 1;
    mg.globalCompositeOperation = "source-over";
    out.drawImage(mixCv, 0, 0);
}

// ---- Thumbnails ----

export async function renderStill(project: VProject, doc: NagmaDocument, comp: VComp, t: number, width: number, height: number): Promise<HTMLCanvasElement> {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const g = out.getContext("2d");
    if (!g) return out;
    const s = Math.min(width / comp.width, height / comp.height);
    const frame = document.createElement("canvas");
    frame.width = Math.max(1, Math.round(comp.width * s));
    frame.height = Math.max(1, Math.round(comp.height * s));
    const fg = frame.getContext("2d", { willReadFrequently: true });
    if (fg) await renderComp(fg, comp, t, { project, doc, scale: s, exact: true });
    g.fillStyle = "#111114";
    g.fillRect(0, 0, width, height);
    g.drawImage(frame, (width - frame.width) / 2, (height - frame.height) / 2);
    return out;
}

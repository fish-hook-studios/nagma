import { nanoid } from "nanoid";
import { cubicBezier } from "../animation";
import type { BlendMode, Clip, NagmaDocument, Sequence } from "../types";

// A video file's edit: compositions (the main sequence and nested ones) of video and audio
// tracks holding clips, a media bin, markers and in/out points. Clips are video, audio, stills,
// titles, shapes, solids, adjustment layers, nested compositions, or frames of this file's pages.
// Every numeric property (transform, colour, volume, crop, masks, effect parameters) is a path in
// the clip's `props`, and can be keyframed in `anim` (times are seconds from the clip's start).

export type TrackKind = "video" | "audio";

export interface VTrack {
    id: string;
    kind: TrackKind;
    name: string;
    muted?: boolean;
    solo?: boolean;
    locked?: boolean;
    hidden?: boolean;
}

export type VClipKind = "video" | "audio" | "image" | "title" | "shape" | "solid" | "adjustment" | "comp" | "frame";
export type Ease = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "bezier" | "spring" | "back-in" | "back-out" | "bounce" | "elastic";

export interface VKey {
    t: number;
    v: number;
    // How the value travels to the next key.
    ease?: Ease;
    bezier?: [number, number, number, number];
}

export interface VMedia {
    id: string;
    kind: "video" | "audio" | "image";
    name: string;
    // Video and audio: the media store id; images: the document's image id.
    store: string;
    // A still for thumbnails (document image id).
    poster?: string;
    seconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    // Loudness peaks, 0..1, PEAK_RATE per second (mono).
    peaks?: number[];
    // Frames along the clip for filmstrips (document image ids).
    strip?: string[];
}

export type EffectValue = number | boolean | number[];

export interface VEffect {
    id: string;
    // An effect of the compositor's library (ec.*), or one of the editor's own (mg.*).
    fx: string;
    name: string;
    enabled: boolean;
    params: Record<string, EffectValue>;
}

export type MaskMode = "add" | "subtract" | "intersect";

export interface VMask {
    id: string;
    shape: "rect" | "ellipse" | "path";
    mode: MaskMode;
    // A path mask's vertices, as fractions of the layer (straight segments, always closed).
    points?: { x: number; y: number }[];
    // Geometry (fractions of the layer), feather, expansion and opacity live in props:
    // mask.<id>.x/y/w/h/feather/expand/opacity.
}

// How the clip on the video track above cuts this clip out.
export type MatteKind = "alpha" | "alpha-inverted" | "luma" | "luma-inverted";

export const MATTES: [MatteKind, string][] = [
    ["alpha", "Alpha matte"],
    ["alpha-inverted", "Alpha inverted matte"],
    ["luma", "Luma matte"],
    ["luma-inverted", "Luma inverted matte"],
];

export type ShapeItemKind = "rect" | "ellipse" | "polygon" | "star" | "path";

// One item of a shape layer. Its geometry, stroke width, dash offset, opacity and trim live in
// props and keyframes as shape.<id>.<key> (see SHAPE_KEYS); sizes are composition pixels and the
// item sits at (x, y) from the layer's centre.
export interface VShapeItem {
    id: string;
    kind: ShapeItemKind;
    name: string;
    fill: string | null;
    stroke: string | null;
    cap: CanvasLineCap;
    join: CanvasLineJoin;
    // Dash and gap lengths in pixels; empty for a solid line.
    dash: number[];
    // A free path's vertices, in pixels from the item's centre.
    points?: { x: number; y: number }[];
    closed?: boolean;
    // The Trim Paths modifier (start, end and offset in props).
    trim?: boolean;
}

export const SHAPE_KEYS = ["x", "y", "w", "h", "radius", "sides", "inner", "rotation", "strokeWidth", "dashOffset", "opacity", "trimStart", "trimEnd", "trimOffset"] as const;
export type ShapeKey = (typeof SHAPE_KEYS)[number];

export const SHAPE_PROPS: Record<ShapeKey, PropSpec> = {
    x: { label: "Position X", step: 1, unit: "px" },
    y: { label: "Position Y", step: 1, unit: "px" },
    w: { label: "Width", min: 0, step: 1, unit: "px" },
    h: { label: "Height", min: 0, step: 1, unit: "px" },
    radius: { label: "Corner radius", min: 0, step: 1, unit: "px" },
    sides: { label: "Points", min: 3, max: 64, step: 1 },
    inner: { label: "Inner radius", min: 0, max: 100, step: 1, unit: "%" },
    rotation: { label: "Rotation", step: 1, unit: "°" },
    strokeWidth: { label: "Stroke width", min: 0, step: 1, unit: "px" },
    dashOffset: { label: "Dash offset", step: 1, unit: "px" },
    opacity: { label: "Opacity", min: 0, max: 100, step: 1, unit: "%" },
    trimStart: { label: "Trim start", min: 0, max: 100, step: 1, unit: "%" },
    trimEnd: { label: "Trim end", min: 0, max: 100, step: 1, unit: "%" },
    trimOffset: { label: "Trim offset", step: 1, unit: "°" },
};

export type TitleAnim =
    | "none"
    | "fade"
    | "rise"
    | "drop"
    | "slide-left"
    | "slide-right"
    | "zoom"
    | "pop"
    | "blur"
    | "typewriter"
    | "words"
    | "wipe"
    | "spin"
    | "tracking";

export interface VTitle {
    text: string;
    font: string;
    weight: number;
    italic?: boolean;
    size: number;
    color: string;
    align: "left" | "center" | "right";
    tracking: number;
    lineHeight: number;
    stroke?: { color: string; width: number } | null;
    shadow?: { color: string; blur: number; x: number; y: number } | null;
    box?: { color: string; padding: number; radius: number } | null;
    uppercase?: boolean;
    animIn: TitleAnim;
    animOut: TitleAnim;
    // Seconds each of the in and out animations take.
    animDur: number;
}

export interface VShape {
    kind: "rect" | "ellipse" | "polygon" | "star" | "line";
    fill: string | null;
    stroke: string | null;
    strokeWidth: number;
    w: number;
    h: number;
    radius: number;
    sides: number;
}

export type TransitionKind =
    | "dissolve"
    | "dip-black"
    | "dip-white"
    | "slide-left"
    | "slide-right"
    | "slide-up"
    | "slide-down"
    | "push-left"
    | "push-right"
    | "push-up"
    | "push-down"
    | "wipe-left"
    | "wipe-right"
    | "wipe-up"
    | "wipe-down"
    | "iris"
    | "zoom-in"
    | "zoom-out"
    | "blur";

export interface VTransition {
    kind: TransitionKind;
    duration: number;
}

export interface VClip {
    id: string;
    kind: VClipKind;
    track: string;
    name: string;
    // On the timeline, seconds.
    start: number;
    duration: number;
    // Into the source, seconds (video and audio).
    in: number;
    speed: number;
    reverse?: boolean;
    media?: string;
    comp?: string;
    frame?: string;
    props: Record<string, number>;
    anim: Record<string, VKey[]>;
    blend: VBlend;
    effects: VEffect[];
    masks: VMask[];
    title?: VTitle;
    // A shape layer's items, drawn in order. Files from before shape layers held one primitive
    // in `shape`; shapeItems() reads either.
    shapes?: VShapeItem[];
    shape?: VShape;
    // Solids and shapes without a fill colour.
    color?: string;
    // The clip whose transform this one follows (its position, rotation and scale are measured
    // in the parent's space, with the parent's anchor at the composition's centre).
    parent?: string | null;
    // The clip on the video track above cuts this one out, and isn't drawn itself.
    matte?: MatteKind | null;
    // Drawn as the average of sub-frame samples while its transform is keyframed.
    motionBlur?: boolean;
    // A colour look (presets in looks.ts).
    look?: string;
    // The transition into this clip (from the clip that ends where it starts, or from nothing),
    // and out of it when nothing follows.
    tin?: VTransition | null;
    tout?: VTransition | null;
    // Clips that move, trim and delete together (a video and its sound).
    link?: string | null;
    disabled?: boolean;
    label?: string;
}

export interface VMarker {
    id: string;
    t: number;
    name: string;
    color: string;
}

export interface VComp {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    background: string;
    tracks: VTrack[];
    clips: VClip[];
    markers: VMarker[];
    inPoint?: number | null;
    outPoint?: number | null;
}

export interface VProject {
    version: 2;
    root: VComp;
    comps: VComp[];
    media: VMedia[];
}

export type VBlend = Exclude<BlendMode, "pass-through" | "plus-darker"> | "add";

export const PEAK_RATE = 50;
export const ROOT = "root";

export const BLENDS: [VBlend, string][] = [
    ["normal", "Normal"],
    ["darken", "Darken"],
    ["multiply", "Multiply"],
    ["color-burn", "Color burn"],
    ["lighten", "Lighten"],
    ["screen", "Screen"],
    ["add", "Add"],
    ["color-dodge", "Color dodge"],
    ["overlay", "Overlay"],
    ["soft-light", "Soft light"],
    ["hard-light", "Hard light"],
    ["difference", "Difference"],
    ["exclusion", "Exclusion"],
    ["hue", "Hue"],
    ["saturation", "Saturation"],
    ["color", "Color"],
    ["luminosity", "Luminosity"],
];

// ---- Properties ----

export interface PropSpec {
    label: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
}

export const PROPS: Record<string, PropSpec> = {
    x: { label: "Position X", step: 1, unit: "px" },
    y: { label: "Position Y", step: 1, unit: "px" },
    scaleX: { label: "Scale width", step: 1, unit: "%" },
    scaleY: { label: "Scale height", step: 1, unit: "%" },
    rotation: { label: "Rotation", step: 1, unit: "°" },
    anchorX: { label: "Anchor X", step: 1, unit: "px" },
    anchorY: { label: "Anchor Y", step: 1, unit: "px" },
    opacity: { label: "Opacity", min: 0, max: 100, step: 1, unit: "%" },
    "crop.l": { label: "Crop left", min: 0, max: 100, step: 1, unit: "%" },
    "crop.t": { label: "Crop top", min: 0, max: 100, step: 1, unit: "%" },
    "crop.r": { label: "Crop right", min: 0, max: 100, step: 1, unit: "%" },
    "crop.b": { label: "Crop bottom", min: 0, max: 100, step: 1, unit: "%" },
    "color.exposure": { label: "Exposure", min: -4, max: 4, step: 0.05 },
    "color.contrast": { label: "Contrast", min: -100, max: 100, step: 1 },
    "color.highlights": { label: "Highlights", min: -100, max: 100, step: 1 },
    "color.shadows": { label: "Shadows", min: -100, max: 100, step: 1 },
    "color.saturation": { label: "Saturation", min: 0, max: 200, step: 1, unit: "%" },
    "color.vibrance": { label: "Vibrance", min: -100, max: 100, step: 1 },
    "color.temperature": { label: "Temperature", min: -100, max: 100, step: 1 },
    "color.tint": { label: "Tint", min: -100, max: 100, step: 1 },
    "color.vignette": { label: "Vignette", min: 0, max: 100, step: 1 },
    "color.look": { label: "Look amount", min: 0, max: 100, step: 1, unit: "%" },
    volume: { label: "Volume", min: -60, max: 12, step: 0.5, unit: "dB" },
    pan: { label: "Pan", min: -100, max: 100, step: 1 },
    fadeIn: { label: "Fade in", min: 0, step: 0.1, unit: "s" },
    fadeOut: { label: "Fade out", min: 0, step: 0.1, unit: "s" },
    // Time remapping: seconds into the source at this point of the clip (only read when keyframed).
    time: { label: "Source time", min: 0, step: 0.04, unit: "s" },
};

const STATIC_DEFAULTS: Record<string, number> = {
    scaleX: 100,
    scaleY: 100,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    opacity: 100,
    "crop.l": 0,
    "crop.t": 0,
    "crop.r": 0,
    "crop.b": 0,
    "color.exposure": 0,
    "color.contrast": 0,
    "color.highlights": 0,
    "color.shadows": 0,
    "color.saturation": 100,
    "color.vibrance": 0,
    "color.temperature": 0,
    "color.tint": 0,
    "color.vignette": 0,
    "color.look": 100,
    volume: 0,
    pan: 0,
    fadeIn: 0,
    fadeOut: 0,
};

// The resting value of a property path (position defaults to the composition's centre).
export function defaultProp(comp: Pick<VComp, "width" | "height">, clip: VClip, path: string): number {
    if (path === "x") return comp.width / 2;
    if (path === "y") return comp.height / 2;
    if (path in STATIC_DEFAULTS) return STATIC_DEFAULTS[path] ?? 0;
    if (path === "time") return clip.in;
    const mask = /^mask\.([^.]+)\.(\w+)$/.exec(path);
    if (mask) return { x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0, opacity: 100, expand: 0 }[mask[2] as "x"] ?? 0;
    const shape = /^shape\.([^.]+)\.(\w+)$/.exec(path);
    if (shape) {
        const item = clip.shapes?.find((s) => s.id === shape[1]);
        // A file from before shape items: the primitive's own fields.
        if (!item && clip.shape && shape[1] === LEGACY_SHAPE) {
            const legacy = { w: clip.shape.w, h: clip.shape.h, radius: clip.shape.radius, sides: clip.shape.sides, strokeWidth: clip.shape.strokeWidth, inner: 45 } as Record<string, number>;
            if (shape[2] in legacy) return legacy[shape[2] as string] ?? 0;
        }
        const size = Math.round(comp.height * 0.35);
        return { x: 0, y: 0, w: size, h: size, radius: 0, sides: 5, inner: 45, rotation: 0, strokeWidth: 0, dashOffset: 0, opacity: 100, trimStart: 0, trimEnd: 100, trimOffset: 0 }[shape[2] as "x"] ?? 0;
    }
    const fx = /^fx\.([^.]+)\.(.+)$/.exec(path);
    if (fx) {
        const effect = clip.effects.find((e) => e.id === fx[1]);
        const v = effect?.params[fx[2] ?? ""];
        return typeof v === "number" ? v : 0;
    }
    return 0;
}

export function ease(kind: Ease | undefined, p: number, bezier?: [number, number, number, number]): number {
    if (kind === "bezier" && bezier) return cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], p);
    switch (kind) {
        case "ease-in":
            return cubicBezier(0.42, 0, 1, 1, p);
        case "ease-out":
            return cubicBezier(0, 0, 0.58, 1, p);
        case "ease-in-out":
            return cubicBezier(0.42, 0, 0.58, 1, p);
        case "hold":
            return 0;
        case "spring":
            // A gentle spring: overshoots a little and settles by the next key.
            return p >= 1 ? 1 : 1 - Math.exp(-7 * p) * Math.cos(2.2 * Math.PI * p);
        case "back-in": {
            // Pulls back a little before going.
            const k = 1.70158;
            return p * p * ((k + 1) * p - k);
        }
        case "back-out": {
            const k = 1.70158;
            const q = p - 1;
            return 1 + q * q * ((k + 1) * q + k);
        }
        case "bounce":
            return bounce(p);
        case "elastic":
            return p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
        default:
            return p;
    }
}

// Lands with three ever smaller bounces.
function bounce(p: number): number {
    const n = 7.5625;
    const d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
}

export const EASES: { id: Ease; label: string }[] = [
    { id: "linear", label: "Linear" },
    { id: "ease-in", label: "Ease in" },
    { id: "ease-out", label: "Ease out" },
    { id: "ease-in-out", label: "Ease in and out" },
    { id: "back-in", label: "Back in" },
    { id: "back-out", label: "Back out" },
    { id: "spring", label: "Spring" },
    { id: "elastic", label: "Elastic" },
    { id: "bounce", label: "Bounce" },
    { id: "hold", label: "Hold" },
];

// ---- Shape items ----

// The id shapeItems() gives a file's single primitive from before shape items.
export const LEGACY_SHAPE = "legacy";

// A shape clip's items: the list, or the one primitive older files hold.
export function shapeItems(clip: VClip): VShapeItem[] {
    if (clip.shapes) return clip.shapes;
    const s = clip.shape;
    if (!s) return [];
    const kind: ShapeItemKind = s.kind === "line" ? "path" : s.kind;
    const item: VShapeItem = { id: LEGACY_SHAPE, kind, name: shapeName(kind), fill: s.kind === "line" ? null : s.fill, stroke: s.stroke, cap: "round", join: "round", dash: [] };
    if (s.kind === "line") {
        item.points = [{ x: -s.w / 2, y: 0 }, { x: s.w / 2, y: 0 }];
        item.closed = false;
    }
    return [item];
}

export function shapeName(kind: ShapeItemKind): string {
    return { rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", path: "Path" }[kind];
}

// A shape item's property at `t` seconds into the clip.
export function shapePropAt(comp: Pick<VComp, "width" | "height">, clip: VClip, item: VShapeItem, key: ShapeKey, t: number): number {
    return propAt(comp, clip, `shape.${item.id}.${key}`, t);
}

// ---- Transforms and parenting ----

// A 2D affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(m: Affine, n: Affine): Affine {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

export function invert(m: Affine): Affine {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return IDENTITY;
    const a = m[3] / det;
    const b = -m[1] / det;
    const c = -m[2] / det;
    const d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// The matrix a clip's own position, rotation and scale make, measured about the composition's
// centre: a point at the centre lands at the clip's position. Children of this clip are drawn
// through it.
export function pivotMatrix(comp: Pick<VComp, "width" | "height">, clip: VClip, lt: number): Affine {
    const x = propAt(comp, clip, "x", lt);
    const y = propAt(comp, clip, "y", lt);
    const sx = propAt(comp, clip, "scaleX", lt) / 100;
    const sy = propAt(comp, clip, "scaleY", lt) / 100;
    const r = (propAt(comp, clip, "rotation", lt) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const cx = comp.width / 2;
    const cy = comp.height / 2;
    const lin: Affine = [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
    return multiply(lin, [1, 0, 0, 1, -cx, -cy]);
}

// The chain of parents above a clip, nearest first, stopping at a loop.
export function parentsOf(comp: VComp, clip: VClip): VClip[] {
    const out: VClip[] = [];
    const seen = new Set([clip.id]);
    let cur = clip;
    while (cur.parent) {
        const p = comp.clips.find((c) => c.id === cur.parent);
        if (!p || seen.has(p.id)) break;
        seen.add(p.id);
        out.push(p);
        cur = p;
    }
    return out;
}

// What a clip's parents do to it at `lt` seconds into the clip: the matrix the clip's own
// transform is drawn through (identity without a parent).
export function parentMatrix(comp: VComp, clip: VClip, lt: number): Affine {
    const at = clip.start + lt;
    let m = IDENTITY;
    for (const p of [...parentsOf(comp, clip)].reverse()) m = multiply(m, pivotMatrix(comp, p, at - p.start));
    return m;
}

// Where a clip's anchor point (its position) sits in the composition at `lt`, parents included.
export function anchorWorld(comp: VComp, clip: VClip, lt: number): { x: number; y: number } {
    return apply(parentMatrix(comp, clip, lt), propAt(comp, clip, "x", lt), propAt(comp, clip, "y", lt));
}

// Clips that could be this clip's parent: pictures in the same composition that don't already
// descend from it.
export function parentChoices(comp: VComp, clip: VClip): VClip[] {
    return comp.clips.filter((c) => c.id !== clip.id && c.kind !== "audio" && c.kind !== "adjustment" && !parentsOf(comp, c).some((p) => p.id === clip.id));
}

// Whether a clip's transform changes over time (motion blur has something to blur).
export function transformAnimated(clip: VClip): boolean {
    return ["x", "y", "scaleX", "scaleY", "rotation", "anchorX", "anchorY"].some((k) => (clip.anim[k]?.length ?? 0) > 1);
}

export function keysValue(keys: VKey[], t: number): number {
    const first = keys[0];
    if (!first) return 0;
    if (t <= first.t) return first.v;
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i] as VKey;
        const b = keys[i + 1] as VKey;
        if (t < b.t) {
            const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
            return a.v + (b.v - a.v) * ease(a.ease, p, a.bezier);
        }
    }
    return (keys[keys.length - 1] as VKey).v;
}

// A property's value at `t` seconds into the clip.
export function propAt(comp: Pick<VComp, "width" | "height">, clip: VClip, path: string, t: number): number {
    const keys = clip.anim[path];
    if (keys?.length) return keysValue(keys, t);
    const v = clip.props[path];
    return v ?? defaultProp(comp, clip, path);
}

export function isAnimated(clip: VClip, path: string): boolean {
    return Boolean(clip.anim[path]?.length);
}

// Effect parameters at `t`: numbers come from props/keyframes, the rest as set.
export function effectParamsAt(comp: Pick<VComp, "width" | "height">, clip: VClip, effect: VEffect, t: number): Record<string, EffectValue> {
    const out: Record<string, EffectValue> = { ...effect.params };
    for (const [key, value] of Object.entries(effect.params)) {
        if (typeof value === "number") out[key] = propAt(comp, clip, `fx.${effect.id}.${key}`, t);
    }
    return out;
}

// ---- Reading a document ----

export function emptyComp(id: string, name: string, width: number, height: number, fps: number): VComp {
    return {
        id,
        name,
        width,
        height,
        fps,
        background: "#000000",
        tracks: [
            { id: nanoid(8), kind: "video", name: "V2" },
            { id: nanoid(8), kind: "video", name: "V1" },
            { id: nanoid(8), kind: "audio", name: "A1" },
            { id: nanoid(8), kind: "audio", name: "A2" },
        ],
        clips: [],
        markers: [],
    };
}

export function newClip(kind: VClipKind, track: string, start: number, duration: number, name: string, extra: Partial<VClip> = {}): VClip {
    return { id: nanoid(10), kind, track, name, start, duration, in: 0, speed: 1, props: {}, anim: {}, blend: "normal", effects: [], masks: [], ...extra };
}

// The project in a document, made from a first-generation sequence (clips back to back) when
// the file predates tracks.
export function projectOf(doc: NagmaDocument): VProject {
    const seq = doc.sequence;
    if (seq?.edit) return seq.edit;
    return migrate(seq);
}

const migrated = new WeakMap<object, VProject>();

function migrate(seq: Sequence | undefined): VProject {
    const key = seq ?? migrated;
    const cached = migrated.get(key);
    if (cached) return cached;
    const width = seq?.width ?? 1920;
    const height = seq?.height ?? 1080;
    const fps = seq?.fps ?? 30;
    const root = emptyComp(ROOT, "Sequence", width, height, fps);
    // Stable ids for a migrated file, so repeated reads agree.
    root.tracks = root.tracks.map((t, i) => ({ ...t, id: `t${i}` }));
    const v1 = root.tracks[1]?.id ?? "t1";
    const a1 = root.tracks[2]?.id ?? "t2";
    const media: VMedia[] = [];
    let at = 0;
    for (const old of seq?.clips ?? []) {
        const len = oldLength(old);
        if (old.kind === "video") {
            const id = `m-${old.video.id}`;
            if (!media.some((m) => m.id === id)) {
                media.push({ id, kind: "video", name: old.video.name, store: old.video.id, poster: old.poster, seconds: old.video.seconds, width: old.video.width, height: old.video.height, fps: old.video.fps, hasAudio: old.video.hasAudio });
            }
            const link = old.video.hasAudio ? `l-${old.id}` : null;
            root.clips.push({ ...newClip("video", v1, at, len, old.name, { media: id, in: old.in, link }), id: old.id });
            if (old.video.hasAudio) root.clips.push({ ...newClip("audio", a1, at, len, old.name, { media: id, in: old.in, link, props: old.muted ? { volume: -60 } : {} }), id: `${old.id}-a` });
        } else if (old.kind === "image") {
            const id = `m-${old.image}`;
            if (!media.some((m) => m.id === id)) media.push({ id, kind: "image", name: old.name, store: old.image, poster: old.image, seconds: 0, width: 0, height: 0, fps: 0, hasAudio: false });
            root.clips.push({ ...newClip("image", v1, at, len, old.name, { media: id }), id: old.id });
        } else {
            root.clips.push({ ...newClip("frame", v1, at, len, old.name, { frame: old.frame }), id: old.id });
        }
        at += len;
    }
    const project: VProject = { version: 2, root, comps: [], media };
    migrated.set(key, project);
    return project;
}

function oldLength(clip: Clip): number {
    return clip.kind === "video" ? Math.max(0.04, clip.out - clip.in) : Math.max(0.04, clip.duration);
}

// The document's sequence with this project in it.
export function withProject(project: VProject): Sequence {
    const root = project.root;
    return { width: root.width, height: root.height, fps: root.fps, clips: [], edit: project };
}

export function compById(project: VProject, id: string | null | undefined): VComp {
    if (!id || id === ROOT) return project.root;
    return project.comps.find((c) => c.id === id) ?? project.root;
}

export function replaceComp(project: VProject, comp: VComp): VProject {
    if (comp.id === ROOT) return { ...project, root: comp };
    return { ...project, comps: project.comps.map((c) => (c.id === comp.id ? comp : c)) };
}

export function mediaById(project: VProject, id: string | undefined): VMedia | undefined {
    return id ? project.media.find((m) => m.id === id) : undefined;
}

export function clipEnd(clip: VClip): number {
    return clip.start + clip.duration;
}

export function compLength(comp: VComp): number {
    return comp.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function trackById(comp: VComp, id: string): VTrack | undefined {
    return comp.tracks.find((t) => t.id === id);
}

// Video tracks bottom first (V1 draws under V2), as drawing order.
export function videoTracks(comp: VComp): VTrack[] {
    return comp.tracks.filter((t) => t.kind === "video").reverse();
}

export function audioTracks(comp: VComp): VTrack[] {
    return comp.tracks.filter((t) => t.kind === "audio");
}

export function clipsOn(comp: VComp, trackId: string): VClip[] {
    return comp.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start);
}

// The source's length in seconds (Infinity for stills, titles and the like).
export function sourceLength(project: VProject, clip: VClip): number {
    if (clip.kind === "video" || clip.kind === "audio") return mediaById(project, clip.media)?.seconds ?? Infinity;
    if (clip.kind === "comp") {
        const comp = project.comps.find((c) => c.id === clip.comp);
        return comp ? Math.max(compLength(comp), 0.04) : Infinity;
    }
    return Infinity;
}

// Where in the source the clip is at `t` seconds into it.
export function sourceTime(clip: VClip, t: number): number {
    const len = clip.duration * clip.speed;
    const into = Math.max(0, Math.min(len, t * clip.speed));
    return clip.reverse ? clip.in + len - into : clip.in + into;
}

export function snapTime(t: number, fps: number): number {
    return Math.round(t * fps) / fps;
}

export function hasVisual(clip: VClip): boolean {
    return clip.kind !== "audio";
}


export const TRACK_COLORS: Record<VClipKind, string> = {
    video: "#3B6FD8",
    audio: "#2F8F6A",
    image: "#7A55C7",
    title: "#C4632F",
    shape: "#B8892A",
    solid: "#6B6B73",
    adjustment: "#8C5AA8",
    comp: "#B04A79",
    frame: "#C4632F",
};

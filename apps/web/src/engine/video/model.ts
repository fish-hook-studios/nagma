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
export type Ease = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "bezier" | "spring";

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

export interface VMask {
    id: string;
    shape: "rect" | "ellipse";
    mode: "add" | "subtract";
    // Geometry (fractions of the layer) and feather live in props: mask.<id>.x/y/w/h/feather/opacity.
}

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
    shape?: VShape;
    // Solids and shapes without a fill colour.
    color?: string;
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
    const mask = /^mask\.([^.]+)\.(\w+)$/.exec(path);
    if (mask) return { x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0, opacity: 100, expand: 0 }[mask[2] as "x"] ?? 0;
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
        default:
            return p;
    }
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

import { nanoid } from "nanoid";
import type { EffectSpecInfo } from "../../engines/motion-engine";
import type { TitleAnim, TransitionKind, VClip, VComp, VKey, VShape, VTitle } from "./model";
import { propAt } from "./model";

// The libraries the editor offers: title styles and their in/out animations, transitions,
// colour looks, motion presets (keyframes written onto a clip) and shapes.

export const TITLE_ANIMS: { id: TitleAnim; label: string }[] = [
    { id: "none", label: "None" },
    { id: "fade", label: "Fade" },
    { id: "rise", label: "Rise" },
    { id: "drop", label: "Drop" },
    { id: "slide-left", label: "Slide from right" },
    { id: "slide-right", label: "Slide from left" },
    { id: "zoom", label: "Zoom" },
    { id: "pop", label: "Pop" },
    { id: "blur", label: "Blur" },
    { id: "typewriter", label: "Typewriter" },
    { id: "words", label: "Word by word" },
    { id: "wipe", label: "Wipe" },
    { id: "spin", label: "Spin" },
    { id: "tracking", label: "Tracking in" },
];

export const FONTS = ["Inter", "Helvetica Neue", "Georgia", "Times New Roman", "Courier New", "Futura", "Avenir Next", "Didot", "Impact", "Menlo"];

const BASE: VTitle = {
    text: "Title",
    font: "Inter",
    weight: 700,
    size: 120,
    color: "#FFFFFF",
    align: "center",
    tracking: 0,
    lineHeight: 1.15,
    stroke: null,
    shadow: { color: "#00000099", blur: 12, x: 0, y: 4 },
    box: null,
    animIn: "rise",
    animOut: "fade",
    animDur: 0.6,
};

export interface TitlePreset {
    id: string;
    label: string;
    title: VTitle;
    // Where the title sits, as fractions of the frame.
    at: [number, number];
    duration: number;
}

export const TITLE_PRESETS: TitlePreset[] = [
    { id: "headline", label: "Headline", title: { ...BASE, text: "Headline" }, at: [0.5, 0.5], duration: 4 },
    { id: "subtitle", label: "Subtitle", title: { ...BASE, text: "Subtitle text", size: 54, weight: 500, animIn: "fade", shadow: { color: "#000000CC", blur: 6, x: 0, y: 2 } }, at: [0.5, 0.88], duration: 3 },
    {
        id: "lower-third",
        label: "Lower third",
        title: { ...BASE, text: "Alex Morgan\nProducer", size: 52, weight: 600, align: "left", box: { color: "#111111CC", padding: 24, radius: 8 }, animIn: "slide-right", animOut: "slide-left", shadow: null },
        at: [0.22, 0.8],
        duration: 5,
    },
    { id: "big-bold", label: "Big and bold", title: { ...BASE, text: "BIG NEWS", size: 220, weight: 900, uppercase: true, tracking: -4, animIn: "pop" }, at: [0.5, 0.5], duration: 3 },
    { id: "outline", label: "Outline", title: { ...BASE, text: "Outline", size: 160, color: "#00000000", stroke: { color: "#FFFFFF", width: 4 }, shadow: null, animIn: "tracking" }, at: [0.5, 0.5], duration: 4 },
    { id: "neon", label: "Neon", title: { ...BASE, text: "Neon", size: 150, color: "#FF4FD8", shadow: { color: "#FF4FD8", blur: 40, x: 0, y: 0 }, animIn: "blur" }, at: [0.5, 0.5], duration: 4 },
    { id: "serif", label: "Elegant serif", title: { ...BASE, text: "A Story", font: "Didot", weight: 400, italic: true, size: 140, animIn: "fade", animDur: 1.2, shadow: null }, at: [0.5, 0.5], duration: 5 },
    { id: "typewriter", label: "Typewriter", title: { ...BASE, text: "Once upon a time…", font: "Courier New", weight: 400, size: 72, animIn: "typewriter", animDur: 1.5, shadow: null }, at: [0.5, 0.5], duration: 5 },
    { id: "caption", label: "Caption box", title: { ...BASE, text: "Caption", size: 48, weight: 600, color: "#111111", box: { color: "#FFE14D", padding: 18, radius: 6 }, shadow: null, animIn: "wipe" }, at: [0.5, 0.85], duration: 3 },
    { id: "credits", label: "End card", title: { ...BASE, text: "Thanks for watching", size: 96, weight: 600, animIn: "words", animDur: 1.2 }, at: [0.5, 0.5], duration: 5 },
];

export function titleClipProps(comp: VComp, preset: TitlePreset): Record<string, number> {
    return { x: Math.round(comp.width * preset.at[0]), y: Math.round(comp.height * preset.at[1]) };
}

export function scaledTitle(comp: VComp, title: VTitle): VTitle {
    // Presets are written for 1080 lines.
    const k = comp.height / 1080;
    return { ...title, size: Math.round(title.size * k), box: title.box ? { ...title.box, padding: Math.round(title.box.padding * k) } : null };
}

export const TRANSITIONS: { id: TransitionKind; label: string; group: string }[] = [
    { id: "dissolve", label: "Cross dissolve", group: "Dissolve" },
    { id: "dip-black", label: "Dip to black", group: "Dissolve" },
    { id: "dip-white", label: "Dip to white", group: "Dissolve" },
    { id: "blur", label: "Blur dissolve", group: "Dissolve" },
    { id: "slide-left", label: "Slide left", group: "Slide" },
    { id: "slide-right", label: "Slide right", group: "Slide" },
    { id: "slide-up", label: "Slide up", group: "Slide" },
    { id: "slide-down", label: "Slide down", group: "Slide" },
    { id: "push-left", label: "Push left", group: "Push" },
    { id: "push-right", label: "Push right", group: "Push" },
    { id: "push-up", label: "Push up", group: "Push" },
    { id: "push-down", label: "Push down", group: "Push" },
    { id: "wipe-left", label: "Wipe left", group: "Wipe" },
    { id: "wipe-right", label: "Wipe right", group: "Wipe" },
    { id: "wipe-up", label: "Wipe up", group: "Wipe" },
    { id: "wipe-down", label: "Wipe down", group: "Wipe" },
    { id: "iris", label: "Iris round", group: "Wipe" },
    { id: "zoom-in", label: "Zoom in", group: "Zoom" },
    { id: "zoom-out", label: "Zoom out", group: "Zoom" },
];

export function transitionLabel(kind: TransitionKind): string {
    return TRANSITIONS.find((t) => t.id === kind)?.label ?? kind;
}

// ---- Looks: colour presets, each a function on straight RGB in 0..1 ----

type Rgb = [number, number, number];
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const curve = (x: number, k: number) => {
    // An S-curve of strength k around the middle.
    const y = x < 0.5 ? 0.5 * Math.pow(2 * x, 1 + k) : 1 - 0.5 * Math.pow(2 * (1 - x), 1 + k);
    return Math.max(0, Math.min(1, y));
};

export const LOOKS: { id: string; label: string; fn: (c: Rgb) => Rgb }[] = [
    { id: "warm", label: "Warm", fn: ([r, g, b]) => [r * 1.08 + 0.02, g * 1.02, b * 0.88] },
    { id: "cool", label: "Cool", fn: ([r, g, b]) => [r * 0.9, g * 1.0, b * 1.1 + 0.02] },
    {
        id: "teal-orange",
        label: "Teal and orange",
        fn: ([r, g, b]) => {
            const l = luma(r, g, b);
            const t = Math.max(0, Math.min(1, (l - 0.2) / 0.6));
            return [mix(r * 0.85, r * 1.1 + 0.04, t), mix(g * 1.02, g * 0.98, t), mix(b * 1.15 + 0.04, b * 0.82, t)];
        },
    },
    { id: "mono", label: "Black and white", fn: ([r, g, b]) => { const l = curve(luma(r, g, b), 0.2); return [l, l, l]; } },
    { id: "noir", label: "Noir", fn: ([r, g, b]) => { const l = curve(luma(r, g, b), 0.8) * 0.95; return [l, l, l]; } },
    { id: "sepia", label: "Sepia", fn: ([r, g, b]) => { const l = luma(r, g, b); return [l * 1.07 + 0.05, l * 0.9 + 0.03, l * 0.68]; } },
    { id: "vintage", label: "Faded film", fn: ([r, g, b]) => [0.08 + r * 0.86 + 0.03, 0.06 + g * 0.84, 0.1 + b * 0.74] },
    { id: "punch", label: "High contrast", fn: ([r, g, b]) => [curve(r, 0.7), curve(g, 0.7), curve(b, 0.7)] },
    {
        id: "bleach",
        label: "Bleach bypass",
        fn: ([r, g, b]) => {
            const l = luma(r, g, b);
            return [curve(mix(r, l, 0.6), 0.6), curve(mix(g, l, 0.6), 0.6), curve(mix(b, l, 0.6), 0.6)];
        },
    },
    { id: "cinema", label: "Cinematic", fn: ([r, g, b]) => [curve(r * 0.95 + 0.02, 0.35), curve(g * 0.97 + 0.01, 0.35), curve(b * 1.05 + 0.03, 0.3)] },
    { id: "pastel", label: "Pastel", fn: ([r, g, b]) => { const l = luma(r, g, b); return [0.15 + mix(r, l, 0.35) * 0.85, 0.15 + mix(g, l, 0.35) * 0.85, 0.17 + mix(b, l, 0.35) * 0.83]; } },
    { id: "cross", label: "Cross process", fn: ([r, g, b]) => [curve(r, 0.5) * 1.05, curve(g, 0.3) * 1.05, b * 0.75 + 0.15] },
    { id: "night", label: "Day for night", fn: ([r, g, b]) => { const l = luma(r, g, b); return [l * 0.35, l * 0.5, l * 0.8 + 0.03]; } },
];

// ---- Motion presets: keyframes written onto a clip ----

export interface MotionPreset {
    id: string;
    label: string;
    group: "In" | "Out" | "Loop" | "Camera";
    apply: (comp: VComp, clip: VClip) => VClip;
}

const key = (t: number, v: number, ease: VKey["ease"] = "ease-in-out"): VKey => ({ t, v, ease });

function withKeys(clip: VClip, path: string, keys: VKey[]): VClip {
    // Keys past the clip's end are pulled in.
    const fitted = keys.map((k) => ({ ...k, t: Math.max(0, Math.min(clip.duration, k.t)) }));
    const merged = [...(clip.anim[path] ?? []).filter((k) => !fitted.some((f) => Math.abs(f.t - k.t) < 1e-3)), ...fitted].sort((a, b) => a.t - b.t);
    return { ...clip, anim: { ...clip.anim, [path]: merged } };
}

const IN = 0.6;

function slideIn(dx: number, dy: number) {
    return (comp: VComp, clip: VClip) => {
        const x = propAt(comp, clip, "x", 0);
        const y = propAt(comp, clip, "y", 0);
        let c = clip;
        if (dx) c = withKeys(c, "x", [key(0, x + dx * comp.width, "ease-out"), key(IN, x)]);
        if (dy) c = withKeys(c, "y", [key(0, y + dy * comp.height, "ease-out"), key(IN, y)]);
        return c;
    };
}

function slideOut(dx: number, dy: number) {
    return (comp: VComp, clip: VClip) => {
        const end = clip.duration;
        const x = propAt(comp, clip, "x", end);
        const y = propAt(comp, clip, "y", end);
        let c = clip;
        if (dx) c = withKeys(c, "x", [key(end - IN, x, "ease-in"), key(end, x + dx * comp.width)]);
        if (dy) c = withKeys(c, "y", [key(end - IN, y, "ease-in"), key(end, y + dy * comp.height)]);
        return c;
    };
}

function scaleBoth(clip: VClip, keys: VKey[]): VClip {
    return withKeys(withKeys(clip, "scaleX", keys), "scaleY", keys);
}

export const MOTION_PRESETS: MotionPreset[] = [
    { id: "fade-in", label: "Fade in", group: "In", apply: (comp, c) => withKeys(c, "opacity", [key(0, 0, "linear"), key(IN, propAt(comp, c, "opacity", IN))]) },
    { id: "slide-in-left", label: "Slide in from left", group: "In", apply: slideIn(-1, 0) },
    { id: "slide-in-right", label: "Slide in from right", group: "In", apply: slideIn(1, 0) },
    { id: "slide-in-up", label: "Slide in from below", group: "In", apply: slideIn(0, 1) },
    { id: "slide-in-down", label: "Slide in from above", group: "In", apply: slideIn(0, -1) },
    { id: "pop-in", label: "Pop in", group: "In", apply: (_comp, c) => scaleBoth(withKeys(c, "opacity", [key(0, 0, "linear"), key(0.15, 100)]), [{ t: 0, v: 0, ease: "bezier", bezier: [0.34, 1.56, 0.64, 1] }, key(0.5, 100)]) },
    { id: "zoom-in", label: "Zoom in", group: "In", apply: (_comp, c) => scaleBoth(withKeys(c, "opacity", [key(0, 0, "linear"), key(IN, 100)]), [key(0, 160, "ease-out"), key(IN, 100)]) },
    { id: "spin-in", label: "Spin in", group: "In", apply: (_comp, c) => scaleBoth(withKeys(c, "rotation", [key(0, -180, "ease-out"), key(0.8, 0)]), [key(0, 0, "ease-out"), key(0.8, 100)]) },
    { id: "fade-out", label: "Fade out", group: "Out", apply: (comp, c) => withKeys(c, "opacity", [key(c.duration - IN, propAt(comp, c, "opacity", c.duration - IN), "linear"), key(c.duration, 0)]) },
    { id: "slide-out-left", label: "Slide out to left", group: "Out", apply: slideOut(-1, 0) },
    { id: "slide-out-right", label: "Slide out to right", group: "Out", apply: slideOut(1, 0) },
    { id: "zoom-out", label: "Zoom away", group: "Out", apply: (_comp, c) => scaleBoth(withKeys(c, "opacity", [key(c.duration - IN, 100, "linear"), key(c.duration, 0)]), [key(c.duration - IN, 100, "ease-in"), key(c.duration, 40)]) },
    {
        id: "pulse",
        label: "Pulse",
        group: "Loop",
        apply: (_comp, c) => {
            const keys: VKey[] = [];
            for (let t = 0, i = 0; t <= c.duration + 1e-6; t += 0.5, i++) keys.push(key(t, i % 2 ? 108 : 100));
            return scaleBoth(c, keys);
        },
    },
    {
        id: "shake",
        label: "Camera shake",
        group: "Loop",
        apply: (comp, c) => {
            const x = propAt(comp, c, "x", 0);
            const y = propAt(comp, c, "y", 0);
            const kx: VKey[] = [];
            const ky: VKey[] = [];
            let seed = 7;
            const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
            for (let t = 0; t <= c.duration + 1e-6; t += 1 / 12) {
                kx.push(key(t, x + rnd() * comp.width * 0.008, "linear"));
                ky.push(key(t, y + rnd() * comp.height * 0.008, "linear"));
            }
            return withKeys(withKeys(scaleBoth(c, [key(0, 104, "linear")]), "x", kx), "y", ky);
        },
    },
    {
        id: "float",
        label: "Float",
        group: "Loop",
        apply: (comp, c) => {
            const y = propAt(comp, c, "y", 0);
            const keys: VKey[] = [];
            for (let t = 0, i = 0; t <= c.duration + 1e-6; t += 1, i++) keys.push(key(t, y + (i % 2 ? -1 : 1) * comp.height * 0.015));
            return withKeys(c, "y", keys);
        },
    },
    { id: "ken-burns-in", label: "Slow push in", group: "Camera", apply: (_comp, c) => scaleBoth(c, [key(0, 100, "linear"), key(c.duration, 115)]) },
    { id: "ken-burns-out", label: "Slow pull out", group: "Camera", apply: (_comp, c) => scaleBoth(c, [key(0, 115, "linear"), key(c.duration, 100)]) },
    {
        id: "pan-left",
        label: "Pan left",
        group: "Camera",
        apply: (comp, c) => {
            const x = propAt(comp, c, "x", 0);
            return scaleBoth(withKeys(c, "x", [key(0, x + comp.width * 0.05, "linear"), key(c.duration, x - comp.width * 0.05)]), [key(0, 112, "linear")]);
        },
    },
    {
        id: "pan-right",
        label: "Pan right",
        group: "Camera",
        apply: (comp, c) => {
            const x = propAt(comp, c, "x", 0);
            return scaleBoth(withKeys(c, "x", [key(0, x - comp.width * 0.05, "linear"), key(c.duration, x + comp.width * 0.05)]), [key(0, 112, "linear")]);
        },
    },
];

// ---- Shapes ----

export const SHAPES: { id: VShape["kind"]; label: string }[] = [
    { id: "rect", label: "Rectangle" },
    { id: "ellipse", label: "Ellipse" },
    { id: "polygon", label: "Polygon" },
    { id: "star", label: "Star" },
    { id: "line", label: "Line" },
];

export function newShape(kind: VShape["kind"], comp: VComp): VShape {
    const s = Math.round(comp.height * 0.35);
    return { kind, fill: kind === "line" ? null : "#4F7BFF", stroke: kind === "line" ? "#FFFFFF" : null, strokeWidth: kind === "line" ? Math.max(2, Math.round(comp.height / 180)) : 0, w: kind === "line" ? s * 1.6 : s, h: kind === "line" ? 0 : s, radius: kind === "rect" ? Math.round(s * 0.08) : 0, sides: kind === "star" ? 5 : 6 };
}

export const LABEL_COLORS = ["#3B6FD8", "#2F8F6A", "#7A55C7", "#C4632F", "#B8892A", "#B04A79", "#4F9FB8", "#6B6B73"];

export function newId() {
    return nanoid(10);
}

// Effects the editor offers from the compositor's catalog: the ones that work on a clip's own
// pixels, without names of other products.
const HIDDEN_CATEGORIES = new Set(["3D Channel", "Audio", "Expression Controls", "Immersive Video", "Obsolete", "Paint", "Text", "Time", "Matte", "Utility"]);
const HIDDEN_NAMES = /^(CC |VR )|Key ?light|Mocha|Roto|Warp Stabilizer|Camera Tracker|Camera-Shake|Face |Puppet|Cineon|OCIO|PS Arbitrary|Liquify|Bezier Warp|Mesh Warp|Reshape|Corner Pin|Rolling Shutter|Detail-preserving|Color Stabilizer|Eyedropper|Paint Bucket|Write-on|Scribble|Smart Blur/;

export function usableEffects(list: EffectSpecInfo[]): EffectSpecInfo[] {
    return list.filter((e) => !HIDDEN_CATEGORIES.has(e.category) && !HIDDEN_NAMES.test(e.name));
}

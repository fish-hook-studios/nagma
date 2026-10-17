import { isFrameLike } from "./components";
import { layerRoots } from "./page";
import { easing } from "./prototype";
import { markStaggerTime } from "./text-stagger";
import type { AnimField, AnimProp, Animation, AutoLayout, Command, Effect, EffectField, Keyframe, NagmaDocument, SceneNode, TrackProp } from "./types";

// Motion mode: keyframes on layers, evaluated at a time to draw, play or export the design.

export const DEFAULT_DURATION = 2000;
export const ANIM_PROPS: AnimProp[] = ["x", "y", "w", "h", "rotation", "opacity", "radius", "fill", "scaleX", "scaleY", "trimStart", "trimEnd"];
export const PROP_LABELS: Record<AnimProp, string> = {
    x: "X",
    y: "Y",
    w: "Width",
    h: "Height",
    rotation: "Rotation",
    opacity: "Opacity",
    radius: "Corner radius",
    fill: "Fill",
    scaleX: "Scale X",
    scaleY: "Scale Y",
    trimStart: "Trim start",
    trimEnd: "Trim end",
};

// The other animatable values: how each reads from a layer and writes back.
type Field = { label: string; get: (n: SceneNode) => number | string | undefined; set: (n: SceneNode, v: number | string) => Partial<SceneNode> };
const layoutField = (label: string, read: (l: AutoLayout) => number, write: (l: AutoLayout, v: number) => AutoLayout): Field => ({
    label,
    get: (n) => (n.layout ? read(n.layout) : undefined),
    set: (n, v) => (n.layout ? { layout: write(n.layout, Number(v)) } : {}),
});
const padField = (label: string, i: 0 | 1 | 2 | 3) => layoutField(label, (l) => l.padding[i], (l, v) => ({ ...l, padding: l.padding.map((p, k) => (k === i ? Math.max(0, v) : p)) as AutoLayout["padding"] }));
const cornerField = (label: string, i: 0 | 1 | 2 | 3): Field => ({
    label,
    get: (n) => n.radii?.[i] ?? n.radius,
    set: (n, v) => ({ radii: (n.radii ?? [n.radius, n.radius, n.radius, n.radius]).map((r, k) => (k === i ? Math.max(0, Number(v)) : r)) as [number, number, number, number] }),
});
const sideField = (label: string, i: 0 | 1 | 2 | 3): Field => ({
    label,
    get: (n) => n.strokeWeights?.[i] ?? n.strokeWidth,
    set: (n, v) => ({ strokeWeights: (n.strokeWeights ?? [n.strokeWidth, n.strokeWidth, n.strokeWidth, n.strokeWidth]).map((w, k) => (k === i ? Math.max(0, Number(v)) : w)) as [number, number, number, number] }),
});
export const FIELDS: Record<AnimField, Field> = {
    stroke: {
        label: "Stroke",
        get: (n) => {
            const p = n.strokes.find((s) => s.type === "solid");
            return p?.type === "solid" ? p.color : undefined;
        },
        set: (n, v) => {
            let done = false;
            return { strokes: n.strokes.map((p) => (p.type === "solid" && !done ? ((done = true), { ...p, color: String(v) }) : p)) };
        },
    },
    strokeWidth: { label: "Stroke weight", get: (n) => n.strokeWidth, set: (_n, v) => ({ strokeWidth: Math.max(0, Number(v)) }) },
    gap: layoutField("Gap", (l) => l.gap, (l, v) => ({ ...l, gap: v })),
    counterGap: { label: "Row gap", get: (n) => (n.layout?.wrap ? (n.layout.counterGap ?? 0) : undefined), set: (n, v) => (n.layout ? { layout: { ...n.layout, counterGap: Number(v) } } : {}) },
    padTop: padField("Padding top", 0),
    padRight: padField("Padding right", 1),
    padBottom: padField("Padding bottom", 2),
    padLeft: padField("Padding left", 3),
    radiusTL: cornerField("Top left radius", 0),
    radiusTR: cornerField("Top right radius", 1),
    radiusBR: cornerField("Bottom right radius", 2),
    radiusBL: cornerField("Bottom left radius", 3),
    borderTop: sideField("Top stroke", 0),
    borderRight: sideField("Right stroke", 1),
    borderBottom: sideField("Bottom stroke", 2),
    borderLeft: sideField("Left stroke", 3),
    gridRowGap: { label: "Grid row gap", get: (n) => n.layout?.grid?.rowGap, set: (n, v) => (n.layout?.grid ? { layout: { ...n.layout, grid: { ...n.layout.grid, rowGap: Math.max(0, Number(v)) } } } : {}) },
    gridColumnGap: { label: "Grid column gap", get: (n) => n.layout?.grid?.columnGap, set: (n, v) => (n.layout?.grid ? { layout: { ...n.layout, grid: { ...n.layout.grid, columnGap: Math.max(0, Number(v)) } } } : {}) },
    fontSize: { label: "Font size", get: (n) => (n.type === "text" ? (n.fontSize ?? 12) : undefined), set: (_n, v) => ({ fontSize: Math.max(1, Number(v)) }) },
    letterSpacing: { label: "Letter spacing", get: (n) => (n.type === "text" ? (n.letterSpacing ?? 0) : undefined), set: (_n, v) => ({ letterSpacing: Number(v) }) },
    lineHeight: { label: "Line height", get: (n) => (n.type === "text" && n.lineHeight ? n.lineHeight : undefined), set: (_n, v) => ({ lineHeight: Number(v) }) },
    scale: { label: "Scale", get: (n) => n.scaleX ?? 1, set: (_n, v) => ({ scaleX: Number(v), scaleY: Number(v) }) },
    position: {
        label: "Position",
        get: (n) => `${Math.round(n.x * 100) / 100},${Math.round(n.y * 100) / 100}`,
        set: (_n, v) => {
            const [x, y] = String(v).split(",").map(Number);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {};
        },
    },
};

export const EFFECT_FIELDS: Record<EffectField, string> = {
    x: "X offset",
    y: "Y offset",
    blur: "Blur",
    spread: "Spread",
    color: "Colour",
    opacity: "Opacity",
    depth: "Depth",
    lightAngle: "Light angle",
    lightIntensity: "Light intensity",
    dispersion: "Dispersion",
    splay: "Splay",
    refraction: "Refraction",
    startBlur: "Start blur",
    noiseSize: "Grain width",
    noiseSizeY: "Grain height",
    density: "Density",
    color2: "Second colour",
};

const EFFECT_NAMES: Record<Effect["type"], string> = { "drop-shadow": "Drop shadow", "inner-shadow": "Inner shadow", "layer-blur": "Layer blur", "background-blur": "Background blur", "motion-blur": "Motion blur", noise: "Noise", texture: "Texture", glass: "Glass", shader: "Shader" };

function effectKey(prop: TrackProp): { index: number; field: EffectField } | null {
    const m = /^fx(\d+)\.(\w+)$/.exec(prop);
    return m && m[2] && m[2] in EFFECT_FIELDS ? { index: Number(m[1]), field: m[2] as EffectField } : null;
}

// What an unset glass or noise setting draws as, so a new track starts from the visible value.
const EFFECT_DEFAULTS: Partial<Record<EffectField, (e: Effect) => number | string>> = {
    refraction: () => 0.5,
    depth: () => 20,
    lightAngle: () => -45,
    lightIntensity: () => 0.5,
    dispersion: () => 0,
    splay: () => 0,
    noiseSize: () => 1,
    noiseSizeY: (e) => e.noiseSize ?? 1,
    density: () => 0.5,
    color2: () => "#FFFFFF",
};

function effectValue(e: Effect, field: EffectField): number | string | undefined {
    if (field === "startBlur") return e.progressive?.startBlur;
    const v = (e as unknown as Record<string, unknown>)[field];
    return typeof v === "number" || typeof v === "string" ? v : EFFECT_DEFAULTS[field]?.(e);
}

function withEffectValue(e: Effect, field: EffectField, v: number | string): Effect {
    if (field === "startBlur") return e.progressive && typeof v === "number" ? { ...e, progressive: { ...e.progressive, startBlur: v } } : e;
    return { ...e, [field]: v };
}

// The fields an effect has, by its kind.
function effectFields(e: Effect): EffectField[] {
    switch (e.type) {
        case "drop-shadow":
        case "inner-shadow":
            return ["x", "y", "blur", "spread", "color", "opacity"];
        case "layer-blur":
        case "background-blur":
            return e.progressive ? ["blur", "startBlur"] : ["blur"];
        case "motion-blur":
            return ["blur"];
        case "noise":
            return ["noiseSize", "noiseSizeY", "density", "color", "opacity", "color2"];
        case "texture":
            return ["noiseSize", "noiseSizeY", "blur"];
        case "glass":
            return ["blur", "depth", "lightAngle", "lightIntensity", "refraction", "dispersion", "splay"];
        case "shader":
            return [];
    }
}

// Every value of a layer that can take keyframes: the basics, then the fields it has, then its effects'.
// Path trim only applies to vectors.
export function trackPropsFor(node: SceneNode): TrackProp[] {
    const out: TrackProp[] = ANIM_PROPS.filter((p) => (p !== "trimStart" && p !== "trimEnd") || node.type === "vector");
    for (const key of Object.keys(FIELDS) as AnimField[]) if (FIELDS[key].get(node) !== undefined) out.push(key);
    (node.effects ?? []).forEach((e, i) => {
        for (const f of effectFields(e)) out.push(`fx${i}.${f}`);
    });
    return out;
}

export function trackLabel(node: SceneNode | undefined, prop: TrackProp): string {
    if (prop in PROP_LABELS) return PROP_LABELS[prop as AnimProp];
    if (prop in FIELDS) return FIELDS[prop as AnimField].label;
    const fx = effectKey(prop);
    if (!fx) return prop;
    const effect = node?.effects?.[fx.index];
    return `${effect ? EFFECT_NAMES[effect.type] : `Effect ${fx.index + 1}`} ${EFFECT_FIELDS[fx.field].toLowerCase()}`;
}

export function hasAnimation(node: SceneNode | undefined): boolean {
    return Boolean(node?.animation && (Object.values(node.animation.tracks).some((t) => t && t.length > 0) || node.animation.stagger));
}

// The top-level frame a layer belongs to: its animation sets the duration.
export function animationRoot(doc: NagmaDocument, node: SceneNode): SceneNode {
    let current = node;
    while (current.parentId && doc.nodes[current.parentId] && doc.nodes[current.parentId]?.type !== "page") current = doc.nodes[current.parentId] as SceneNode;
    return current;
}

export function durationOf(doc: NagmaDocument, id: string | null): number {
    const node = id ? doc.nodes[id] : undefined;
    const root = node ? animationRoot(doc, node) : undefined;
    return root?.animation?.duration ?? DEFAULT_DURATION;
}

// Every layer on the page with keyframes, in layer order.
export function animatedLayers(doc: NagmaDocument): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        if (hasAnimation(node)) out.push(node);
        node.children.forEach(visit);
    };
    layerRoots(doc).forEach(visit);
    return out;
}

export function animatedFrames(doc: NagmaDocument): SceneNode[] {
    return layerRoots(doc)
        .map((id) => doc.nodes[id])
        .filter((n): n is SceneNode => Boolean(n && isFrameLike(n) && [n, ...descendantsOf(doc, n)].some(hasAnimation)));
}

function descendantsOf(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    return node.children.flatMap((id) => {
        const child = doc.nodes[id];
        return child ? [child, ...descendantsOf(doc, child)] : [];
    });
}

// A CSS-style cubic bezier: solve x(s) = t for s, then return y(s).
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const x = (s: number) => ((ax * s + bx) * s + cx) * s;
    const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
    let s = t;
    for (let i = 0; i < 8; i++) {
        const err = x(s) - t;
        if (Math.abs(err) < 1e-6) break;
        const d = dx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
    }
    if (s < 0 || s > 1 || Math.abs(x(s) - t) > 1e-4) {
        let lo = 0;
        let hi = 1;
        s = t;
        for (let i = 0; i < 30; i++) {
            if (x(s) < t) lo = s;
            else hi = s;
            s = (lo + hi) / 2;
        }
    }
    return ((ay * s + by) * s + cy) * s;
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function lerpHex(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return t < 0.5 ? a : b;
    return `#${pa.map((v, i) => Math.round(lerp(v, pb[i] ?? v, t)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// Two numbers in one value ("x,y"), eased together.
function lerpPair(a: string, b: string, t: number): string {
    const pa = a.split(",").map(Number);
    const pb = b.split(",").map(Number);
    return pa.map((v, i) => Math.round(lerp(v, pb[i] ?? v, t) * 100) / 100).join(",");
}

// A track's value at time t: held before the first key, after the last, eased in between.
export function trackValue(track: Keyframe[], t: number): number | string | undefined {
    if (!track.length) return undefined;
    const sorted = track;
    if (t <= sorted[0].t) return sorted[0].v;
    const last = sorted[sorted.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (t >= a.t && t <= b.t) {
            const span = Math.max(1, b.t - a.t);
            // A hold keeps the value until the next keyframe.
            if (a.easing === "hold") return a.v;
            const p = (t - a.t) / span;
            const e = a.bezier ? cubicBezier(a.bezier[0], a.bezier[1], a.bezier[2], a.bezier[3], p) : easing(a.easing, p);
            if (typeof a.v === "number" && typeof b.v === "number") return lerp(a.v, b.v, e);
            if (typeof a.v === "string" && typeof b.v === "string") return a.v.includes(",") ? lerpPair(a.v, b.v, e) : lerpHex(a.v, b.v, e);
            return e < 1 ? a.v : b.v;
        }
    }
    return last.v;
}

// The value a property has right now (at time t), or its resting value without keyframes.
export function valueAt(node: SceneNode, prop: TrackProp, t: number): number | string {
    const track = node.animation?.tracks[prop];
    const v = track ? trackValue(track, t) : undefined;
    if (v !== undefined) return v;
    // An axis animated through its combined track.
    const tracks = node.animation?.tracks;
    if ((prop === "x" || prop === "y") && tracks?.position?.length) {
        const both = String(trackValue(tracks.position, t) ?? "").split(",").map(Number);
        const n = both[prop === "x" ? 0 : 1];
        if (n !== undefined && Number.isFinite(n)) return n;
    }
    if ((prop === "scaleX" || prop === "scaleY") && tracks?.scale?.length) {
        const n = Number(trackValue(tracks.scale, t));
        if (Number.isFinite(n)) return n;
    }
    return baseValue(node, prop);
}

export function baseValue(node: SceneNode, prop: TrackProp): number | string {
    if (prop in FIELDS) return FIELDS[prop as AnimField].get(node) ?? 0;
    const fx = effectKey(prop);
    if (fx) {
        const e = node.effects?.[fx.index];
        return (e && effectValue(e, fx.field)) ?? 0;
    }
    if (prop === "fill") {
        const fill = node.fills.find((p) => p.type === "solid");
        return fill?.type === "solid" ? fill.color : "#000000";
    }
    if (prop === "scaleX" || prop === "scaleY") return node[prop] ?? 1;
    if (prop === "trimStart") return node.trimStart ?? 0;
    if (prop === "trimEnd") return node.trimEnd ?? 1;
    return node[prop as Exclude<AnimProp, "fill" | "scaleX" | "scaleY" | "trimStart" | "trimEnd">];
}

// The layer as it looks at time t.
export function animatedNode(node: SceneNode, t: number): SceneNode {
    if (!hasAnimation(node)) return node;
    let out: SceneNode = { ...node };
    for (const prop of Object.keys(node.animation?.tracks ?? {}) as TrackProp[]) {
        const track = node.animation?.tracks[prop];
        if (!track?.length) continue;
        const v = trackValue(track, t);
        if (v === undefined) continue;
        if (prop === "fill") {
            if (typeof v === "string") {
                let done = false;
                out.fills = node.fills.map((p) => (p.type === "solid" && !done ? ((done = true), { ...p, color: v }) : p));
            }
        } else if (prop in FIELDS) {
            out = { ...out, ...FIELDS[prop as AnimField].set(out, v) };
        } else if (effectKey(prop)) {
            const fx = effectKey(prop) as { index: number; field: EffectField };
            const effects = out.effects ?? [];
            const e = effects[fx.index];
            if (e) out.effects = effects.map((x, i) => (i === fx.index ? withEffectValue(e, fx.field, v) : x));
        } else if (typeof v === "number") {
            out[prop as Exclude<AnimProp, "fill">] = v;
        }
    }
    return out;
}

// The whole document at time t (or each layer at its own time, as a prototype plays them). Children
// of a moved frame stay put relative to it: child coordinates are absolute, so a frame's own motion
// is applied to its subtree.
export function animatedDoc(doc: NagmaDocument, time: number | ((node: SceneNode) => number)): NagmaDocument {
    const layers = animatedLayers(doc);
    if (!layers.length) return doc;
    const nodes = { ...doc.nodes };
    for (const node of layers) {
        const t = typeof time === "number" ? time : time(node);
        // A layer inside an animated frame has already been carried along by it; its own
        // keyframes apply on top of that.
        const current = nodes[node.id] ?? node;
        const moved = animatedNode(node, t);
        // Text stagger: the renderer draws each letter or word at this time.
        if (node.animation?.stagger) markStaggerTime(moved, t);
        moved.x += current.x - node.x;
        moved.y += current.y - node.y;
        nodes[node.id] = moved;
        const dx = moved.x - current.x;
        const dy = moved.y - current.y;
        if ((dx || dy) && node.children.length) {
            const shift = (id: string) => {
                const child = nodes[id];
                if (!child) return;
                nodes[id] = { ...child, x: child.x + dx, y: child.y + dy };
                child.children.forEach(shift);
            };
            node.children.forEach(shift);
        }
    }
    return { ...doc, nodes };
}

// ---- Combined tracks: Position animates x and y together, Scale both scale axes. A layer keeps either
// the combined track or the separate ones, never both, so no value is animated twice. ----

export type CombinedProp = "position" | "scale";
export const COMBINED_PARTS: Record<CombinedProp, [AnimProp, AnimProp]> = { position: ["x", "y"], scale: ["scaleX", "scaleY"] };
type Tracks = Partial<Record<TrackProp, Keyframe[]>>;

const withTracks = (node: SceneNode, tracks: Tracks): Command => ({ type: "node.update", id: node.id, patch: { animation: { ...(node.animation ?? { tracks: {} }), tracks } } });
const partAt = (node: SceneNode, tracks: Tracks, part: AnimProp, t: number) => Number(trackValue(tracks[part] ?? [], t) ?? baseValue(node, part));

// The separate tracks as one combined track (keyframes at every time either had). Scale only merges
// when both axes have the same value everywhere; otherwise null.
function mergedTracks(node: SceneNode, tracks: Tracks, combined: CombinedProp): Tracks | null {
    const [a, b] = COMBINED_PARTS[combined];
    const times = Array.from(new Set([...(tracks[a] ?? []), ...(tracks[b] ?? [])].map((k) => k.t))).sort((p, q) => p - q);
    if (!times.length) return tracks;
    const keys: Keyframe[] = [];
    for (const t of times) {
        const va = partAt(node, tracks, a, t);
        const vb = partAt(node, tracks, b, t);
        if (combined === "scale" && Math.abs(va - vb) > 1e-6) return null;
        const from = tracks[a]?.find((k) => k.t === t) ?? tracks[b]?.find((k) => k.t === t);
        keys.push({ t, v: combined === "position" ? `${Math.round(va * 100) / 100},${Math.round(vb * 100) / 100}` : va, easing: from?.easing ?? "ease-in-out", ...(from?.bezier ? { bezier: from.bezier } : {}) });
    }
    const out = { ...tracks, [combined]: keys };
    delete out[a];
    delete out[b];
    return out;
}

// The combined track as the separate ones, keyframe for keyframe.
function splitTracks(tracks: Tracks, combined: CombinedProp): Tracks {
    const keys = tracks[combined];
    if (!keys?.length) return tracks;
    const [a, b] = COMBINED_PARTS[combined];
    const values = (k: Keyframe) => (combined === "position" ? String(k.v).split(",").map(Number) : [Number(k.v), Number(k.v)]);
    const out = { ...tracks, [a]: keys.map((k) => ({ ...k, v: values(k)[0] ?? 0 })), [b]: keys.map((k) => ({ ...k, v: values(k)[1] ?? 0 })) };
    delete out[combined];
    return out;
}

// Whether "Merge" (separate tracks into the combined one) or "Split" (the other way) applies to a layer.
export function canMerge(node: SceneNode, combined: CombinedProp): boolean {
    const tracks = node.animation?.tracks ?? {};
    const [a, b] = COMBINED_PARTS[combined];
    return Boolean((tracks[a]?.length || tracks[b]?.length) && mergedTracks(node, tracks, combined));
}
export const canSplit = (node: SceneNode, combined: CombinedProp) => Boolean(node.animation?.tracks[combined]?.length);
export function mergeTracks(node: SceneNode, combined: CombinedProp): Command | null {
    const merged = mergedTracks(node, node.animation?.tracks ?? {}, combined);
    return merged ? withTracks(node, merged) : null;
}
export const splitTrack = (node: SceneNode, combined: CombinedProp): Command => withTracks(node, splitTracks(node.animation?.tracks ?? {}, combined));

// Sets (or replaces) a keyframe at time t. Adding the first keyframe of a track also records the
// resting value at 0 when t isn't 0, so the layer animates from where it was. A combined track and
// its separate ones don't coexist: keying Position merges x and y tracks into it, keying x or y
// while Position is animated keys Position; Scale merges equal axes, and keying one axis splits it.
export function setKeyframe(node: SceneNode, prop: TrackProp, t: number, v: number | string, ease: Keyframe["easing"] = "ease-in-out"): Command {
    let tracks: Tracks = { ...(node.animation?.tracks ?? {}) };
    if (prop === "position" || prop === "scale") {
        const [a, b] = COMBINED_PARTS[prop];
        if (tracks[a]?.length || tracks[b]?.length) {
            const merged = mergedTracks(node, tracks, prop);
            // Axes that differ stay separate: Scale keys both of them.
            if (!merged) {
                const first = setKeyframe(node, a, t, Number(v), ease);
                const next = first.type === "node.update" ? ({ ...node, ...first.patch } as SceneNode) : node;
                return setKeyframe(next, b, t, Number(v), ease);
            }
            tracks = merged;
        }
    } else if ((prop === "x" || prop === "y") && tracks.position?.length) {
        const x = prop === "x" ? Number(v) : partAt(node, splitTracks(tracks, "position"), "x", t);
        const y = prop === "y" ? Number(v) : partAt(node, splitTracks(tracks, "position"), "y", t);
        return setKeyframe(node, "position", t, `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`, ease);
    } else if ((prop === "scaleX" || prop === "scaleY") && tracks.scale?.length) tracks = splitTracks(tracks, "scale");
    const track = [...(tracks[prop] ?? [])];
    if (!track.length && t > 0) track.push({ t: 0, v: baseValue(node, prop), easing: ease });
    const at = track.findIndex((k) => Math.abs(k.t - t) < 1);
    if (at >= 0) track[at] = { ...track[at], v };
    else track.push({ t, v, easing: ease });
    track.sort((a, b) => a.t - b.t);
    tracks[prop] = track;
    return withTracks(node, tracks);
}

export function removeKeyframe(node: SceneNode, prop: TrackProp, t: number): Command {
    const tracks = { ...(node.animation?.tracks ?? {}) };
    const track = (tracks[prop] ?? []).filter((k) => Math.abs(k.t - t) >= 1);
    if (track.length) tracks[prop] = track;
    else delete tracks[prop];
    return { type: "node.update", id: node.id, patch: { animation: { ...(node.animation ?? { tracks: {} }), tracks } } };
}

export function moveKeyframe(node: SceneNode, prop: TrackProp, from: number, to: number): Command {
    const tracks = { ...(node.animation?.tracks ?? {}) };
    // No key at `from`: nothing moves (and nothing at `to` is replaced).
    if (!(tracks[prop] ?? []).some((k) => Math.abs(k.t - from) < 1)) return { type: "batch", commands: [] };
    const track = (tracks[prop] ?? []).filter((k) => Math.abs(k.t - to) >= 1 || Math.abs(k.t - from) < 1).map((k) => (Math.abs(k.t - from) < 1 ? { ...k, t: to } : k));
    track.sort((a, b) => a.t - b.t);
    tracks[prop] = track;
    return { type: "node.update", id: node.id, patch: { animation: { ...(node.animation ?? { tracks: {} }), tracks } } };
}

export function keyframeAt(node: SceneNode, prop: TrackProp, t: number): Keyframe | undefined {
    return node.animation?.tracks[prop]?.find((k) => Math.abs(k.t - t) < 1);
}

export function setDuration(node: SceneNode, duration: number): Command {
    const animation: Animation = { ...(node.animation ?? { tracks: {} }), duration: Math.max(100, Math.round(duration)) };
    return { type: "node.update", id: node.id, patch: { animation } };
}

// Preset animations, like a motion tool's Animations menu: each writes keyframes from t to t + ms.
export type Preset = "fade-in" | "fade-out" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "scale-up" | "pop";
export const PRESETS: { id: Preset; label: string }[] = [
    { id: "fade-in", label: "Fade in" },
    { id: "fade-out", label: "Fade out" },
    { id: "slide-left", label: "Slide in from left" },
    { id: "slide-right", label: "Slide in from right" },
    { id: "slide-up", label: "Slide in from bottom" },
    { id: "slide-down", label: "Slide in from top" },
    { id: "scale-up", label: "Scale up" },
    { id: "pop", label: "Pop" },
];

function withKey(node: SceneNode, prop: AnimProp, t: number, v: number | string, ease: Keyframe["easing"]): SceneNode {
    const command = setKeyframe(node, prop, t, v, ease);
    return command.type === "node.update" ? { ...node, ...command.patch } : node;
}

export function applyPreset(node: SceneNode, preset: Preset, t: number, ms = 600): Command {
    const end = t + ms;
    let n = node;
    const step = (prop: AnimProp, from: number | string, to: number | string, ease: Keyframe["easing"] = "ease-out") => {
        n = withKey(n, prop, t, from, ease);
        n = withKey(n, prop, end, to, ease);
    };
    const slide = 120;
    switch (preset) {
        case "fade-in":
            step("opacity", 0, node.opacity);
            break;
        case "fade-out":
            step("opacity", node.opacity, 0, "ease-in");
            break;
        case "slide-left":
            step("x", node.x - slide, node.x);
            step("opacity", 0, node.opacity);
            break;
        case "slide-right":
            step("x", node.x + slide, node.x);
            step("opacity", 0, node.opacity);
            break;
        case "slide-up":
            step("y", node.y + slide, node.y);
            step("opacity", 0, node.opacity);
            break;
        case "slide-down":
            step("y", node.y - slide, node.y);
            step("opacity", 0, node.opacity);
            break;
        case "scale-up":
            // Grow from the centre.
            step("w", node.w * 0.5, node.w);
            step("h", node.h * 0.5, node.h);
            step("x", node.x + node.w * 0.25, node.x);
            step("y", node.y + node.h * 0.25, node.y);
            step("opacity", 0, node.opacity);
            break;
        case "pop":
            step("w", node.w * 0.8, node.w);
            step("h", node.h * 0.8, node.h);
            step("x", node.x + node.w * 0.1, node.x);
            step("y", node.y + node.h * 0.1, node.y);
            break;
    }
    return { type: "node.update", id: node.id, patch: { animation: n.animation } };
}

// A keyframe by where it sits: the layer, the property and its time.
export interface KeyRef {
    id: string;
    prop: TrackProp;
    t: number;
}

function groupKeys(refs: KeyRef[]): Map<string, Map<TrackProp, number[]>> {
    const byNode = new Map<string, Map<TrackProp, number[]>>();
    for (const ref of refs) {
        const props = byNode.get(ref.id) ?? new Map<TrackProp, number[]>();
        props.set(ref.prop, [...(props.get(ref.prop) ?? []), ref.t]);
        byNode.set(ref.id, props);
    }
    return byNode;
}

// Moves the given keyframes to new times (`to` maps each old time). A moved key replaces an
// unmoved one it lands on, like dropping a keyframe onto another.
export function retimeKeys(doc: NagmaDocument, refs: KeyRef[], to: (ref: KeyRef) => number): Command {
    const commands: Command[] = [];
    for (const [id, props] of groupKeys(refs)) {
        const node = doc.nodes[id];
        if (!node?.animation) continue;
        const tracks = { ...node.animation.tracks };
        for (const [prop, times] of props) {
            const track = tracks[prop] ?? [];
            const isMoved = (k: Keyframe) => times.some((t) => Math.abs(t - k.t) < 1);
            const moved = track.filter(isMoved).map((k) => ({ ...k, t: Math.max(0, Math.round(to({ id, prop, t: k.t }))) }));
            const kept = track.filter((k) => !isMoved(k) && !moved.some((m) => Math.abs(m.t - k.t) < 1));
            tracks[prop] = [...kept, ...moved].sort((a, b) => a.t - b.t);
        }
        commands.push({ type: "node.update", id, patch: { animation: { ...node.animation, tracks } } });
    }
    return { type: "batch", commands };
}

export function removeKeys(doc: NagmaDocument, refs: KeyRef[]): Command {
    const commands: Command[] = [];
    for (const [id, props] of groupKeys(refs)) {
        const node = doc.nodes[id];
        if (!node?.animation) continue;
        const tracks = { ...node.animation.tracks };
        for (const [prop, times] of props) {
            const track = (tracks[prop] ?? []).filter((k) => !times.some((t) => Math.abs(t - k.t) < 1));
            if (track.length) tracks[prop] = track;
            else delete tracks[prop];
        }
        commands.push({ type: "node.update", id, patch: { animation: { ...node.animation, tracks } } });
    }
    return { type: "batch", commands };
}

// The easing of the stretch that starts at the keyframe at time t.
export function setKeyEasing(node: SceneNode, prop: TrackProp, t: number, ease: Pick<Keyframe, "easing" | "bezier">): Command {
    const tracks = { ...(node.animation?.tracks ?? {}) };
    tracks[prop] = (tracks[prop] ?? []).map((k) => {
        if (Math.abs(k.t - t) >= 1) return k;
        const next: Keyframe = { t: k.t, v: k.v, easing: ease.easing };
        if (ease.bezier) next.bezier = ease.bezier;
        return next;
    });
    return { type: "node.update", id: node.id, patch: { animation: { ...(node.animation ?? { tracks: {} }), tracks } } };
}

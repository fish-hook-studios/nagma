import { animationRoot, trackValue } from "./animation";
import { type Fragment, type LayoutLine, type TextLayout, layoutText, prefixWidth } from "./text-layout";
import type { Command, Keyframe, NagmaDocument, SceneNode, StaggerPreset, TextStagger } from "./types";

// The reference's text stagger: one short animation (offset, rotation, scale, opacity, blur) played
// on every letter, word, line or paragraph, each starting a step after the one before it.

export const STAGGER_UNITS: { id: TextStagger["unit"]; label: string }[] = [
    { id: "letter", label: "Character" },
    { id: "letter-visible", label: "Character (no whitespace)" },
    { id: "word", label: "Word" },
    { id: "line", label: "Line" },
    { id: "paragraph", label: "Paragraph" },
];

export const STAGGER_ORDERS: { id: TextStagger["order"]; label: string }[] = [
    { id: "left-right", label: "Left to right" },
    { id: "right-left", label: "Right to left" },
    { id: "center-out", label: "Center out" },
    { id: "random", label: "Random" },
];

export type StaggerProp = keyof TextStagger["tracks"];
export const STAGGER_PROPS: { id: StaggerProp; label: string }[] = [
    { id: "y", label: "Position Y" },
    { id: "x", label: "Position X" },
    { id: "rotation", label: "Rotation" },
    { id: "scale", label: "Scale" },
    { id: "opacity", label: "Opacity" },
    { id: "blur", label: "Blur" },
];

// The rest value of each property (where an "in" animation ends).
const REST: Record<StaggerProp, number> = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, blur: 0 };

// The reference's text stagger preset defaults: rise 40 px, word by word, half overlapping, ease out.
export function defaultPreset(): StaggerPreset {
    return {
        easing: "ease-out",
        bezier: [0.33, 1, 0.68, 1],
        position: { on: true, from: "top", distance: 40 },
        rotation: { on: false, clockwise: true, amount: 180 },
        scale: { on: false, amount: 120 },
        opacity: { on: true, amount: 0 },
        blur: { on: false, amount: 20 },
    };
}

// Two keys per enabled property, from the starting value to rest, over one unit's duration.
export function presetTracks(preset: StaggerPreset, duration: number): TextStagger["tracks"] {
    const ease: Pick<Keyframe, "easing" | "bezier"> = { easing: preset.easing, ...(preset.bezier ? { bezier: preset.bezier } : {}) };
    const track = (from: number, to: number): Keyframe[] => [
        { t: 0, v: from, ...ease },
        { t: duration, v: to, ...ease },
    ];
    const tracks: TextStagger["tracks"] = {};
    if (preset.position.on) {
        const d = preset.position.distance;
        if (preset.position.from === "top") tracks.y = track(-d, 0);
        if (preset.position.from === "bottom") tracks.y = track(d, 0);
        if (preset.position.from === "left") tracks.x = track(-d, 0);
        if (preset.position.from === "right") tracks.x = track(d, 0);
    }
    if (preset.rotation.on) tracks.rotation = track(preset.rotation.clockwise ? -preset.rotation.amount : preset.rotation.amount, 0);
    if (preset.scale.on) tracks.scale = track(preset.scale.amount / 100, 1);
    if (preset.opacity.on) tracks.opacity = track(preset.opacity.amount / 100, 1);
    if (preset.blur.on) tracks.blur = track(preset.blur.amount, 0);
    return tracks;
}

export function defaultStagger(): TextStagger {
    const preset = defaultPreset();
    return { unit: "word", order: "left-right", delay: 0, duration: 500, overlap: 50, direction: "in", preset, tracks: presetTracks(preset, 500) };
}

// How long the whole stagger runs for a layer.
export function staggerLength(stagger: TextStagger, units: number): number {
    const step = stagger.duration * (1 - Math.max(0, Math.min(100, stagger.overlap)) / 100);
    return stagger.delay + Math.max(0, units - 1) * step + stagger.duration;
}

// The time each layer is drawn at during playback (set by the animated document, read by the renderer).
const clock = new WeakMap<SceneNode, number>();
export function markStaggerTime(node: SceneNode, t: number) {
    clock.set(node, t);
}
export function staggerTimeOf(node: SceneNode): number | null {
    return clock.get(node) ?? null;
}

export interface StaggerPiece {
    fragment: Fragment;
    text: string;
    x: number;
    width: number;
    line: LayoutLine;
    // The unit's centre (rotation and scale turn around it), in layer coordinates.
    cx: number;
    cy: number;
    dx: number;
    dy: number;
    rotation: number;
    scale: number;
    opacity: number;
    blur: number;
    clip: boolean;
}

interface Unit {
    pieces: { fragment: Fragment; from: number; to: number; line: LayoutLine }[];
    visible: boolean;
}

// Splits the laid-out text into the stagger's units.
export function staggerUnits(layout: TextLayout, unit: TextStagger["unit"]): Unit[] {
    const units: Unit[] = [];
    let current: Unit | null = null;
    let paragraph = -1;
    let prevSpace = true;
    let prevLine: LayoutLine | null = null;
    const add = (fragment: Fragment, i: number, line: LayoutLine) => {
        if (!current) return;
        const last = current.pieces[current.pieces.length - 1];
        if (last && last.fragment === fragment && last.to === i) last.to = i + 1;
        else current.pieces.push({ fragment, from: i, to: i + 1, line });
    };
    for (const line of layout.lines) {
        if (unit === "line" || (unit === "paragraph" && line.paragraph !== paragraph)) {
            current = { pieces: [], visible: true };
            units.push(current);
            paragraph = line.paragraph;
        }
        for (const fragment of line.fragments) {
            if (unit === "line" || unit === "paragraph") {
                current?.pieces.push({ fragment, from: 0, to: fragment.text.length, line });
                continue;
            }
            for (let i = 0; i < fragment.text.length; i++) {
                const space = /\s/.test(fragment.text[i] ?? "");
                if (unit === "word") {
                    // A word carries its trailing spaces; a new word starts after a space or a line break.
                    if (!current || (!space && (prevSpace || prevLine !== line))) {
                        current = { pieces: [], visible: true };
                        units.push(current);
                    }
                } else {
                    current = { pieces: [], visible: !space };
                    units.push(current);
                }
                add(fragment, i, line);
                prevSpace = space;
                prevLine = line;
            }
        }
    }
    return units.filter((u) => u.pieces.length);
}

// A stable shuffle, so "random" plays the same way every time.
function ranks(n: number, order: TextStagger["order"], seed: string): number[] {
    const idx = Array.from({ length: n }, (_, i) => i);
    if (order === "right-left") return idx.map((i) => n - 1 - i);
    if (order === "center-out") return idx.map((i) => Math.floor(Math.abs(i - (n - 1) / 2)));
    if (order === "random") {
        let h = 2166136261;
        for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
        const rand = () => {
            h = Math.imul(h ^ (h >>> 15), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return ((h ^= h >>> 16) >>> 0) / 4294967296;
        };
        const shuffled = [...idx];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j] as number, shuffled[i] as number];
        }
        const out = new Array<number>(n);
        shuffled.forEach((unit, rank) => (out[unit] = rank));
        return out;
    }
    return idx;
}

// Every unit's pieces with their values at time t.
export function staggerPieces(node: SceneNode, layout: TextLayout, t: number): StaggerPiece[] {
    const stagger = node.animation?.stagger;
    if (!stagger) return [];
    const units = staggerUnits(layout, stagger.unit);
    // Spaces don't take a turn when the unit skips them.
    const timed = stagger.unit === "letter-visible" ? units.filter((u) => u.visible) : units;
    const rank = ranks(timed.length, stagger.order, node.id);
    const order = new Map(timed.map((u, i) => [u, rank[i] ?? i]));
    const step = stagger.duration * (1 - Math.max(0, Math.min(100, stagger.overlap)) / 100);
    const out: StaggerPiece[] = [];
    units.forEach((unit) => {
        const r = order.get(unit) ?? 0;
        const local = Math.max(0, Math.min(stagger.duration, t - stagger.delay - r * step));
        const at = stagger.direction === "out" ? stagger.duration - local : local;
        const value = (prop: StaggerProp) => {
            const track = stagger.tracks[prop];
            const v = track?.length ? trackValue(track, at) : undefined;
            return typeof v === "number" ? v : REST[prop];
        };
        const values = { dx: value("x"), dy: value("y"), rotation: value("rotation"), scale: value("scale"), opacity: value("opacity"), blur: value("blur") };
        const boxes = unit.pieces.map((p) => {
            const x = p.fragment.x + prefixWidth(p.fragment, p.from);
            return { p, x, width: prefixWidth(p.fragment, p.to) - prefixWidth(p.fragment, p.from) };
        });
        const left = Math.min(...boxes.map((b) => b.x));
        const right = Math.max(...boxes.map((b) => b.x + b.width));
        const top = Math.min(...boxes.map((b) => b.p.line.top));
        const bottom = Math.max(...boxes.map((b) => b.p.line.top + b.p.line.height));
        for (const { p, x, width } of boxes) {
            out.push({ fragment: p.fragment, text: p.fragment.text.slice(p.from, p.to), x, width, line: p.line, cx: (left + right) / 2, cy: (top + bottom) / 2, ...values, clip: Boolean(stagger.clip) });
        }
    });
    return out;
}

// How many units a layer's text splits into (for the timeline length).
export function staggerUnitCount(layout: TextLayout, stagger: TextStagger): number {
    const units = staggerUnits(layout, stagger.unit);
    return stagger.unit === "letter-visible" ? units.filter((u) => u.visible).length : units.length;
}

// Easing curves offered for a stagger, as cubic-bezier control points.
export const STAGGER_EASINGS: { id: string; label: string; easing: Keyframe["easing"]; bezier?: [number, number, number, number] }[] = [
    { id: "linear", label: "Linear", easing: "linear" },
    { id: "ease-in", label: "Ease in", easing: "ease-in", bezier: [0.32, 0, 0.67, 0] },
    { id: "ease-out", label: "Ease out", easing: "ease-out", bezier: [0.33, 1, 0.68, 1] },
    { id: "ease-in-out", label: "Ease in and out", easing: "ease-in-out", bezier: [0.65, 0, 0.35, 1] },
    { id: "ease-in-back", label: "Ease in back", easing: "ease-in-out", bezier: [0.36, 0, 0.66, -0.56] },
    { id: "ease-out-back", label: "Ease out back", easing: "ease-in-out", bezier: [0.34, 1.56, 0.64, 1] },
];

// Sets a text layer's stagger (null removes it), regenerating its tracks from the preset, and
// lengthens the frame's timeline so the last unit finishes.
export function staggerCommands(doc: NagmaDocument, node: SceneNode, stagger: TextStagger | null): Command[] {
    const animation = { ...(node.animation ?? { tracks: {} }) };
    if (!stagger) {
        delete animation.stagger;
        return [{ type: "node.update", id: node.id, patch: { animation } }];
    }
    const next: TextStagger = stagger.preset ? { ...stagger, tracks: presetTracks(stagger.preset, stagger.duration) } : stagger;
    animation.stagger = next;
    const commands: Command[] = [{ type: "node.update", id: node.id, patch: { animation } }];
    const root = animationRoot(doc, node);
    const end = staggerLength(next, staggerUnitCount(layoutText(node), next));
    const current = root.id === node.id ? (animation.duration ?? 0) : (root.animation?.duration ?? 0);
    if (end > current) {
        if (root.id === node.id) animation.duration = Math.ceil(end);
        else commands.push({ type: "node.update", id: root.id, patch: { animation: { ...(root.animation ?? { tracks: {} }), duration: Math.ceil(end) } } });
    }
    return commands;
}

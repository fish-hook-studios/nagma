import { useSyncExternalStore } from "react";
import { drawNode } from "../canvas/render";
import { onImageReady } from "../engine/image-store";
import { subscribeFonts } from "../engine/fonts";
import type { ImagePaint, NagmaDocument, SceneNode } from "../engine/types";
import { slideOf } from "./model";
import type { AnimEffect, ObjectAnimation, SlideDirection, SlideEasing, SlideTransition } from "./types";

// Drawing slides outside the editor's canvas: thumbnails, the grid, the presentation and the
// presenter view. Object animations change how a slide's layers draw (opacity, offset, scale,
// how much text shows); transitions blend one slide into the next.

export interface LayerMod {
    alpha: number;
    dx: number;
    dy: number;
    scale: number;
    // Typewriter: how many characters show.
    chars?: number;
}

// Draws a slide with its top-left at the context's origin, in slide units.
export function drawSlide(ctx: CanvasRenderingContext2D, doc: NagmaDocument, slide: SceneNode, pixelScale: number, mods?: Map<string, LayerMod>, only?: (child: SceneNode) => boolean) {
    const options = { editingTextId: null, pixelScale };
    ctx.save();
    ctx.translate(-slide.x, -slide.y);
    drawNode(ctx, doc, { ...slide, children: [], shadow: null, effects: [] }, options);
    ctx.beginPath();
    ctx.rect(slide.x, slide.y, slide.w, slide.h);
    ctx.clip();
    for (const id of slide.children) {
        const child = doc.nodes[id];
        if (!child || (only && !only(child))) continue;
        const mod = mods?.get(id);
        if (!mod) {
            drawNode(ctx, doc, child, options);
            continue;
        }
        if (mod.alpha <= 0.001) continue;
        ctx.save();
        ctx.globalAlpha *= Math.min(1, mod.alpha);
        ctx.translate(mod.dx, mod.dy);
        if (mod.scale !== 1) {
            const cx = child.x + child.w / 2;
            const cy = child.y + child.h / 2;
            ctx.translate(cx, cy);
            ctx.scale(mod.scale, mod.scale);
            ctx.translate(-cx, -cy);
        }
        let node = child;
        if (mod.chars !== undefined && child.type === "text") {
            const n = Math.max(0, Math.floor(mod.chars));
            node = { ...child, text: (child.text ?? "").slice(0, n), spans: child.spans?.filter((s) => s.start < n).map((s) => ({ ...s, end: Math.min(s.end, n) })) };
        }
        drawNode(ctx, doc, node, options);
        ctx.restore();
    }
    ctx.restore();
}

// ---- Thumbnails ----

// Bumped when images or fonts finish loading, so pictures of slides are drawn again.
let assetsVersion = 0;
const assetListeners = new Set<() => void>();
const bump = () => {
    assetsVersion++;
    for (const l of assetListeners) l();
};
onImageReady(bump);
subscribeFonts(bump);
export function useAssetsVersion(): number {
    return useSyncExternalStore(
        (l) => {
            assetListeners.add(l);
            return () => assetListeners.delete(l);
        },
        () => assetsVersion,
    );
}

// Every layer of a slide, in order: the same list (by identity) means the same picture.
export function slideSignature(doc: NagmaDocument, id: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (nid: string) => {
        const node = doc.nodes[nid];
        if (!node) return;
        out.push(node);
        for (const c of node.children) visit(c);
    };
    visit(id);
    return out;
}

export function sameSignature(a: SceneNode[] | null, b: SceneNode[]): boolean {
    return Boolean(a && a.length === b.length && a.every((n, i) => n === b[i]));
}

// Draws a slide to fill a canvas of the given CSS size.
export function paintSlideCanvas(canvas: HTMLCanvasElement, doc: NagmaDocument, id: string, width: number, mods?: Map<string, LayerMod>) {
    const slide = doc.nodes[id];
    if (!slide) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const height = Math.round((width * slide.h) / slide.w);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = (width * dpr) / slide.w;
    ctx.scale(scale, scale);
    drawSlide(ctx, doc, slide, scale, mods);
}

export function slideDataUrl(doc: NagmaDocument, id: string, width: number): string {
    const canvas = document.createElement("canvas");
    paintSlideCanvas(canvas, doc, id, width);
    return canvas.toDataURL("image/jpeg", 0.85);
}

// ---- Object animations ----

export interface TimedAnimation {
    anim: ObjectAnimation;
    // Milliseconds from the start of its step.
    start: number;
    end: number;
}

// The slide's animations in steps: `auto` plays as the slide comes in, then one step per click.
export function animationSteps(slide: SceneNode | undefined): { auto: TimedAnimation[]; clicks: TimedAnimation[][] } {
    const list = slideOf(slide)?.animations ?? [];
    const auto: TimedAnimation[] = [];
    const clicks: TimedAnimation[][] = [];
    let step = auto;
    let prevStart = 0;
    let prevEnd = 0;
    for (const anim of list) {
        if (anim.trigger === "click") {
            step = [];
            clicks.push(step);
            prevStart = 0;
            prevEnd = 0;
        }
        const base = anim.trigger === "after" ? prevEnd : anim.trigger === "with" ? prevStart : 0;
        const start = base + Math.max(0, anim.delay);
        const end = start + (anim.effect === "appear" ? 0 : Math.max(0, anim.duration));
        step.push({ anim, start, end });
        prevStart = start;
        prevEnd = Math.max(prevEnd, end);
    }
    return { auto, clicks };
}

export function stepLength(step: TimedAnimation[]): number {
    return step.reduce((m, t) => Math.max(m, t.end), 0);
}

const ease = {
    linear: (t: number) => t,
    "ease-in": (t: number) => t * t * t,
    "ease-out": (t: number) => 1 - (1 - t) ** 3,
    "ease-in-out": (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    gentle: (t: number) => 1 - (1 - t) ** 2,
    // Quick: most of the way in the first third. Slow: eases in and out over a long middle.
    quick: (t: number) => 1 - (1 - t) ** 5,
    slow: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
    bouncy: (t: number) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    },
} satisfies Record<SlideEasing, (t: number) => number>;

export function easeOf(easing: SlideEasing): (t: number) => number {
    return ease[easing] ?? ease["ease-out"];
}

const DIRS: Record<SlideDirection, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function effectMod(effect: AnimEffect, p: number, node: SceneNode, direction: SlideDirection = "up"): LayerMod {
    const e = ease["ease-out"](p);
    switch (effect) {
        case "appear":
            return { alpha: p > 0 ? 1 : 0, dx: 0, dy: 0, scale: 1 };
        case "fade":
            return { alpha: e, dx: 0, dy: 0, scale: 1 };
        case "slide": {
            const [vx, vy] = DIRS[direction];
            return { alpha: Math.min(1, e * 1.5), dx: -vx * (1 - e) * 240, dy: -vy * (1 - e) * 240, scale: 1 };
        }
        case "scale":
            return { alpha: e, dx: 0, dy: 0, scale: 0.6 + 0.4 * ease.bouncy(p) };
        case "rise":
            return { alpha: e, dx: 0, dy: (1 - e) * 80, scale: 1 };
        case "typewriter":
            return { alpha: p > 0 ? 1 : 0, dx: 0, dy: 0, scale: 1, chars: p * (node.text ?? "").length };
    }
}

// How each animated layer draws: `shown` click steps have been triggered, the last one `stepTime`
// ms ago; the slide came in `autoTime` ms ago. Layers whose step hasn't come are hidden.
export function animationMods(doc: NagmaDocument, slide: SceneNode, shown: number, stepTime: number, autoTime: number): Map<string, LayerMod> {
    const mods = new Map<string, LayerMod>();
    const { auto, clicks } = animationSteps(slide);
    const apply = (t: TimedAnimation, time: number) => {
        const node = doc.nodes[t.anim.target];
        if (!node || node.parentId !== slide.id) return;
        const p = t.end > t.start ? Math.max(0, Math.min(1, (time - t.start) / (t.end - t.start))) : time >= t.start ? 1 : 0;
        // Leaving plays the entrance backwards: shown until its step comes, gone after it.
        mods.set(node.id, effectMod(t.anim.effect, t.anim.exit ? 1 - p : p, node, t.anim.direction));
    };
    for (const t of auto) apply(t, autoTime);
    clicks.forEach((step, k) => {
        for (const t of step) apply(t, k < shown - 1 ? Infinity : k === shown - 1 ? stepTime : -Infinity);
    });
    return mods;
}

// Everything shown: the slide as it looks once all its steps have played.
export function finalMods(doc: NagmaDocument, slide: SceneNode): Map<string, LayerMod> {
    const { clicks } = animationSteps(slide);
    return animationMods(doc, slide, clicks.length, Infinity, Infinity);
}

// ---- Transitions ----

export const TRANSITIONS: { id: SlideTransition["type"]; label: string }[] = [
    { id: "none", label: "None" },
    { id: "smart", label: "Match animate" },
    { id: "dissolve", label: "Dissolve" },
    { id: "push", label: "Push" },
    { id: "slide-in", label: "Slide in" },
    { id: "slide-out", label: "Slide out" },
    { id: "move-in", label: "Move in" },
    { id: "move-out", label: "Move out" },
];

export const DEFAULT_TRANSITION: SlideTransition = { type: "none", direction: "left", easing: "ease-out", duration: 400 };

// Blends from one slide picture into the next at progress p (0 to 1), in slide units.
export function drawTransition(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    transition: SlideTransition,
    p: number,
    drawFrom: () => void,
    drawTo: () => void,
) {
    const t = easeOf(transition.easing)(Math.max(0, Math.min(1, p)));
    const [vx, vy] = DIRS[transition.direction];
    const layer = (dx: number, dy: number, alpha: number, draw: () => void) => {
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.translate(dx, dy);
        draw();
        ctx.restore();
    };
    switch (transition.type) {
        case "none":
            return drawTo();
        case "dissolve":
        case "smart":
            drawFrom();
            return layer(0, 0, t, drawTo);
        case "slide-in":
            drawFrom();
            return layer(-vx * (1 - t) * w * 0.3, -vy * (1 - t) * h * 0.3, t, drawTo);
        case "slide-out":
            drawTo();
            return layer(vx * t * w * 0.3, vy * t * h * 0.3, 1 - t, drawFrom);
        case "move-in":
            drawFrom();
            return layer(-vx * (1 - t) * w, -vy * (1 - t) * h, 1, drawTo);
        case "move-out":
            drawTo();
            return layer(vx * t * w, vy * t * h, 1, drawFrom);
        case "push":
            layer(vx * t * w, vy * t * h, 1, drawFrom);
            return layer(-vx * (1 - t) * w, -vy * (1 - t) * h, 1, drawTo);
    }
}

// Match animate: layers with the same name on both slides move and resize between them; the
// rest fade out and in. Drawn in slide units, both slides at the origin.
// The old slide is drawn as its steps left it and the new one as it enters (layers waiting for a
// click hidden): before, layers animated in on a click showed during the move and then vanished,
// and ones already animated out came back. Layers hidden on either side aren't matched.
export function drawMatched(ctx: CanvasRenderingContext2D, doc: NagmaDocument, from: SceneNode, to: SceneNode, p: number, easing: SlideEasing, pixelScale: number, fromMods: Map<string, LayerMod> = finalMods(doc, from), toMods: Map<string, LayerMod> = animationMods(doc, to, 0, 0, 0)) {
    const t = easeOf(easing)(Math.max(0, Math.min(1, p)));
    const shown = (mods: Map<string, LayerMod>, n: SceneNode) => (mods.get(n.id)?.alpha ?? 1) > 0.001;
    const fromKids = from.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && shown(fromMods, n as SceneNode));
    const toKids = to.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && shown(toMods, n as SceneNode));
    const byName = new Map(fromKids.map((n) => [n.name, n]));
    const matched = new Map<string, SceneNode>();
    for (const n of toKids) {
        const m = byName.get(n.name);
        if (m && m.type === n.type) {
            matched.set(n.id, m);
            byName.delete(n.name);
        }
    }
    const usedFrom = new Set([...matched.values()].map((n) => n.id));
    // Backgrounds cross-fade; unmatched layers of the old slide fade out.
    drawSlide(ctx, doc, from, pixelScale, fromMods, (c) => !usedFrom.has(c.id) && t < 1);
    ctx.save();
    ctx.globalAlpha *= t;
    drawSlide(ctx, doc, to, pixelScale, toMods, (c) => !matched.has(c.id));
    ctx.restore();
    const options = { editingTextId: null, pixelScale };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, to.w, to.h);
    ctx.clip();
    for (const n of toKids) {
        const m = matched.get(n.id);
        if (!m) continue;
        const lerp = (a: number, b: number) => a + (b - a) * t;
        const node: SceneNode = {
            ...(t < 0.5 ? m : n),
            x: lerp(m.x - from.x, n.x - to.x),
            y: lerp(m.y - from.y, n.y - to.y),
            w: lerp(m.w, n.w),
            h: lerp(m.h, n.h),
            rotation: lerp(m.rotation, n.rotation),
            opacity: lerp(m.opacity, n.opacity),
            children: [],
        };
        if (n.children.length) {
            // Containers are drawn whole at their new place.
            ctx.save();
            ctx.translate(node.x - (n.x - to.x), node.y - (n.y - to.y));
            ctx.translate(-to.x, -to.y);
            drawNode(ctx, doc, n, options);
            ctx.restore();
        } else drawNode(ctx, doc, node, options);
    }
    ctx.restore();
}

// ---- Media ----

// Layers on a slide (at any depth) filled with a video.
export function videoFills(doc: NagmaDocument, slide: SceneNode): { node: SceneNode; paint: ImagePaint }[] {
    const out: { node: SceneNode; paint: ImagePaint }[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node || !node.visible) return;
        for (const paint of node.fills) if (paint.type === "image" && paint.video && paint.visible) out.push({ node, paint });
        for (const c of node.children) visit(c);
    };
    for (const c of slide.children) visit(c);
    return out;
}

export function slideHasVideo(doc: NagmaDocument, slide: SceneNode | undefined): boolean {
    return Boolean(slide && videoFills(doc, slide).length);
}

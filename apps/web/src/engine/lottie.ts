import { ANIM_PROPS, durationOf, hasAnimation, valueAt } from "./animation";
import { isFrameLike } from "./components";
import { type Step, transitionMs } from "./motion";
import { namePath, subtree } from "./prototype";
import { placedSubpaths } from "./vector";
import type { Direction, NagmaDocument, SceneNode, Transition } from "./types";

// Writes a prototype flow as a Lottie animation (bodymovin JSON). Every layer of every screen
// becomes a Lottie layer that lives while its screen is on; transitions become keyframes on
// position, size, opacity and colour, so match animate morphs the way it plays in Nagma.

type Vec = number[];

interface State {
    cx: number;
    cy: number;
    w: number;
    h: number;
    rot: number;
    op: number;
    color: Vec | null;
    radius: number;
}

interface Sample {
    frame: number;
    state: State;
    ease: Transition["easing"];
}

// Cubic beziers for Nagma's easings: [out handle, in handle].
// Back and spring easings overshoot, which a cubic can't; they use their closest cubic here.
const EASE: Record<Transition["easing"], [Vec, Vec]> = {
    linear: [
        [0, 0],
        [1, 1],
    ],
    "ease-in-back": [
        [0.36, 0],
        [0.66, -0.56],
    ],
    "ease-out-back": [
        [0.34, 1.56],
        [0.64, 1],
    ],
    "ease-in-out-back": [
        [0.68, -0.6],
        [0.32, 1.6],
    ],
    "spring-gentle": [
        [0.2, 0.9],
        [0.3, 1],
    ],
    "spring-quick": [
        [0.1, 1.1],
        [0.4, 1],
    ],
    "spring-bouncy": [
        [0.34, 1.56],
        [0.64, 1],
    ],
    "custom-bezier": [
        [0.42, 0],
        [0.58, 1],
    ],
    "custom-spring": [
        [0.2, 0.9],
        [0.3, 1],
    ],
    "spring-slow": [
        [0.25, 0.8],
        [0.4, 1],
    ],
    "ease-in": [
        [0.42, 0],
        [1, 1],
    ],
    "ease-out": [
        [0, 0],
        [0.58, 1],
    ],
    "ease-in-out": [
        [0.42, 0],
        [0.58, 1],
    ],
};

const VECTOR: Record<Direction, { x: number; y: number }> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function rgb(hex: string): Vec | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}

function firstSolid(node: SceneNode) {
    return node.fills.find((p) => p.visible && p.type === "solid") as { color: string; opacity: number } | undefined;
}

function stateOf(node: SceneNode, screen: SceneNode, offset = { x: 0, y: 0 }, fade = 1): State {
    const fill = firstSolid(node);
    return {
        cx: node.x - screen.x + node.w / 2 + offset.x,
        cy: node.y - screen.y + node.h / 2 + offset.y,
        w: node.w,
        h: node.h,
        rot: node.rotation,
        op: node.opacity * fade,
        color: fill ? rgb(fill.color) : null,
        radius: node.radius,
    };
}

// A Lottie property: static when every sample agrees, else keyframes with the easing of the
// segment that starts at each one.
function prop(samples: Sample[], pick: (s: State) => Vec | null, fallback: Vec) {
    const values = samples.map((s) => pick(s.state) ?? fallback);
    const same = values.every((v) => v.every((n, i) => Math.abs(n - (values[0][i] ?? 0)) < 1e-6));
    const scalar = fallback.length === 1;
    if (same || samples.length < 2) return { a: 0, k: scalar ? r3(values[0][0]) : values[0].map(r3) };
    const k = samples.map((s, i) => {
        const v = values[i].map(r3);
        if (i === samples.length - 1) return { t: s.frame, s: v };
        const [o, inn] = EASE[s.ease];
        return { t: s.frame, s: v, o: { x: [o[0]], y: [o[1]] }, i: { x: [inn[0]], y: [inn[1]] } };
    });
    return { a: 1, k };
}

interface Clip {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LottieFile {
    v: string;
    fr: number;
    ip: number;
    op: number;
    w: number;
    h: number;
    nm: string;
    ddd: 0;
    assets: Record<string, unknown>[];
    fonts: { list: Record<string, unknown>[] };
    layers: Record<string, unknown>[];
}

// Layers of a screen, in paint order (back to front), with the clip of the nearest clipping
// ancestor inside the screen.
function paintOrder(doc: NagmaDocument, screen: SceneNode): { node: SceneNode; clip: Clip | null }[] {
    const out: { node: SceneNode; clip: Clip | null }[] = [];
    const visit = (node: SceneNode, clip: Clip | null) => {
        if (!node.visible) return;
        if (node.type === "boolean") {
            out.push({ node, clip });
            return;
        }
        if (node.type !== "group") out.push({ node, clip });
        const own = node !== screen && isFrameLike(node) && node.clip && !node.rotation ? { x: node.x - screen.x, y: node.y - screen.y, w: node.w, h: node.h } : clip;
        for (const id of node.children) {
            const child = doc.nodes[id];
            if (child) visit(child, own);
        }
    };
    visit(screen, null);
    return out;
}

export function buildLottie(doc: NagmaDocument, steps: Step[], fps: number): LottieFile {
    const first = doc.nodes[steps[0]?.screen ?? ""];
    if (!first) throw new Error("Nothing to animate");
    const toFrames = (ms: number) => Math.round((ms / 1000) * fps);
    const size = { w: Math.round(first.w), h: Math.round(first.h) };
    // Frame numbers of each step: when its hold starts, when its transition starts and ends.
    const times: { holdStart: number; transStart: number; transEnd: number }[] = [];
    let at = 0;
    for (const step of steps) {
        const holdStart = at;
        const transStart = holdStart + toFrames(step.hold);
        const transEnd = transStart + (step.next ? toFrames(transitionMs(step.next.transition)) : 0);
        times.push({ holdStart, transStart, transEnd });
        at = transEnd;
    }
    const total = Math.max(1, at);

    const layers: Record<string, unknown>[] = [];
    const assets: Record<string, unknown>[] = [];
    const fonts = new Map<string, Record<string, unknown>>();
    const imageIds = new Map<string, string>();

    steps.forEach((step, i) => {
        const screen = doc.nodes[step.screen];
        if (!screen) return;
        const t = times[i];
        const prev = i > 0 ? steps[i - 1] : null;
        const prevT = i > 0 ? times[i - 1] : null;
        const into = prev?.next?.transition ?? null;
        const out = step.next?.transition ?? null;
        const next = step.next ? doc.nodes[step.next.to] : undefined;
        const prevScreen = prev ? doc.nodes[prev.screen] : undefined;
        const prevNames = prevScreen ? new Set(subtree(doc, prevScreen.id).slice(1).map((n) => namePath(doc, n, prevScreen))) : new Set<string>();
        const nextNodes = next ? new Map(subtree(doc, next.id).slice(1).map((n) => [namePath(doc, n, next), n])) : new Map<string, SceneNode>();
        const enterVector = into ? VECTOR[into.direction] : { x: 0, y: 0 };
        const exitVector = out ? VECTOR[out.direction] : { x: 0, y: 0 };

        for (const { node, clip } of paintOrder(doc, screen)) {
            const key = node === screen ? "" : namePath(doc, node, screen);
            const base = stateOf(node, screen);
            const samples: Sample[] = [];
            let ip = t.holdStart;
            let op = t.transEnd;
            // Coming in.
            if (into && prevT) {
                const ease = into.easing;
                switch (into.type) {
                    case "instant":
                        ip = prevT.transStart;
                        break;
                    case "dissolve":
                        ip = prevT.transStart;
                        samples.push({ frame: prevT.transStart, state: { ...base, op: 0 }, ease }, { frame: prevT.transEnd, state: base, ease });
                        break;
                    case "move-in":
                    case "push":
                    case "slide-in":
                        ip = prevT.transStart;
                        samples.push(
                            { frame: prevT.transStart, state: stateOf(node, screen, { x: -enterVector.x * size.w, y: -enterVector.y * size.h }), ease },
                            { frame: prevT.transEnd, state: base, ease },
                        );
                        break;
                    case "smart":
                        if (node === screen || prevNames.has(key)) {
                            // The old screen's layer morphs into this one and hands over here.
                            ip = prevT.transEnd;
                        } else {
                            ip = prevT.transStart;
                            samples.push({ frame: prevT.transStart, state: { ...base, op: 0 }, ease }, { frame: prevT.transEnd, state: base, ease });
                        }
                        break;
                }
            }
            // Going out.
            if (out && next) {
                const ease = out.easing;
                switch (out.type) {
                    case "instant":
                        op = t.transStart;
                        break;
                    case "dissolve":
                    case "move-in":
                        break;
                    case "push":
                        samples.push({ frame: t.transStart, state: base, ease }, { frame: t.transEnd, state: stateOf(node, screen, { x: exitVector.x * size.w, y: exitVector.y * size.h }), ease });
                        break;
                    case "slide-in":
                        samples.push(
                            { frame: t.transStart, state: base, ease },
                            { frame: t.transEnd, state: stateOf(node, screen, { x: exitVector.x * size.w * 0.3, y: exitVector.y * size.h * 0.3 }, 0.6), ease },
                        );
                        break;
                    case "smart": {
                        const target = node === screen ? next : nextNodes.get(key);
                        samples.push({ frame: t.transStart, state: base, ease });
                        samples.push({ frame: t.transEnd, state: target ? stateOf(target, next) : { ...base, op: 0 }, ease });
                        break;
                    }
                }
            } else if (!out) {
                op = total;
            }
            if (op <= ip) continue;
            if (!samples.length) samples.push({ frame: ip, state: base, ease: "linear" });
            samples.sort((a, b) => a.frame - b.frame);
            const layer = lottieLayer(doc, node, samples, base, clip, { ip, op }, assets, imageIds, fonts);
            if (layer) layers.push(...layer);
        }
    });

    return {
        v: "5.7.4",
        fr: fps,
        ip: 0,
        op: total,
        w: size.w,
        h: size.h,
        nm: first.name,
        ddd: 0,
        assets,
        fonts: { list: [...fonts.values()] },
        // Lottie lists layers front to back.
        layers: layers.reverse(),
    };
}

function transform(samples: Sample[], base: State, anchor: Vec = [0, 0]) {
    return {
        o: prop(samples, (s) => [s.op * 100], [100]),
        r: prop(samples, (s) => [s.rot], [0]),
        p: prop(samples, (s) => [s.cx, s.cy], [base.cx, base.cy]),
        a: { a: 0, k: [...anchor, 0] },
        s: { a: 0, k: [100, 100, 100] },
    };
}

function mask(clip: Clip | null, node: SceneNode, base: State) {
    if (!clip || node.rotation) return {};
    const x0 = clip.x - base.cx;
    const y0 = clip.y - base.cy;
    const x1 = x0 + clip.w;
    const y1 = y0 + clip.h;
    const zero = [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
    ];
    return {
        masksProperties: [
            {
                mode: "a",
                inv: false,
                o: { a: 0, k: 100 },
                x: { a: 0, k: 0 },
                pt: {
                    a: 0,
                    k: {
                        c: true,
                        v: [
                            [x0, y0],
                            [x1, y0],
                            [x1, y1],
                            [x0, y1],
                        ].map((p) => p.map(r3)),
                        i: zero,
                        o: zero,
                    },
                },
            },
        ],
    };
}

function paints(node: SceneNode, samples: Sample[], base: State) {
    const items: Record<string, unknown>[] = [];
    let first = true;
    for (const paint of node.fills) {
        if (!paint.visible) continue;
        if (paint.type === "solid") {
            const color = first ? prop(samples, (s) => s.color, base.color ?? rgb(paint.color) ?? [0, 0, 0]) : { a: 0, k: (rgb(paint.color) ?? [0, 0, 0]).map(r3) };
            first = false;
            items.push({ ty: "fl", c: color, o: { a: 0, k: r3(paint.opacity * 100) }, r: 1, nm: "Fill" });
        } else if (paint.type === "linear" || paint.type === "radial") {
            const stops = paint.stops.flatMap((s) => [s.position, ...(rgb(s.color) ?? [0, 0, 0])]).map(r3);
            const at = (p: { x: number; y: number }) => [r3((p.x - 0.5) * base.w), r3((p.y - 0.5) * base.h)];
            items.push({
                ty: "gf",
                t: paint.type === "radial" ? 2 : 1,
                s: { a: 0, k: at(paint.from) },
                e: { a: 0, k: at(paint.to) },
                g: { p: paint.stops.length, k: { a: 0, k: stops } },
                o: { a: 0, k: r3(paint.opacity * 100) },
                r: 1,
                nm: "Gradient",
            });
        }
    }
    for (const paint of node.strokes) {
        if (!paint.visible || paint.type !== "solid") continue;
        items.push({ ty: "st", c: { a: 0, k: (rgb(paint.color) ?? [0, 0, 0]).map(r3) }, o: { a: 0, k: r3(paint.opacity * 100) }, w: { a: 0, k: node.strokeWidth }, lc: 2, lj: 2, nm: "Stroke" });
    }
    return items;
}

function fontName(node: SceneNode) {
    const family = node.fontFamily ?? "Inter";
    const weight = node.fontWeight ?? 400;
    const style = `${{ 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" }[weight] ?? "Regular"}${node.italic ? " Italic" : ""}`;
    return { name: `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}`, family, style };
}

// A node as Lottie layers: usually one; an image fill adds an image layer under the shape.
function lottieLayer(
    doc: NagmaDocument,
    node: SceneNode,
    samples: Sample[],
    base: State,
    clip: Clip | null,
    span: { ip: number; op: number },
    assets: Record<string, unknown>[],
    imageIds: Map<string, string>,
    fonts: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] | null {
    const common = { ddd: 0, nm: node.name, ip: span.ip, op: span.op, st: 0, sr: 1, bm: 0, ...mask(clip, node, base) };
    if (node.type === "text") {
        const f = fontName(node);
        fonts.set(f.name, { fName: f.name, fFamily: f.family, fStyle: f.style, ascent: 72 });
        const fill = firstSolid(node);
        const fontSize = node.fontSize ?? 16;
        return [
            {
                ...common,
                ty: 5,
                ks: transform(samples, base),
                t: {
                    d: {
                        k: [
                            {
                                s: {
                                    t: (node.text ?? "").replace(/\n/g, "\r"),
                                    f: f.name,
                                    s: fontSize,
                                    fc: (fill ? rgb(fill.color) : null) ?? [0, 0, 0],
                                    j: node.textAlign === "center" ? 2 : node.textAlign === "right" ? 1 : 0,
                                    lh: r3((node.lineHeight ?? 1.21) * fontSize),
                                    ls: 0,
                                    tr: Math.round(((node.letterSpacing ?? 0) / 100) * 1000),
                                    ps: [r3(-base.w / 2), r3(-base.h / 2)],
                                    sz: [r3(base.w), r3(base.h)],
                                },
                                t: 0,
                            },
                        ],
                    },
                    p: {},
                    m: { g: 1, a: { a: 0, k: [0, 0] } },
                    a: [],
                },
            },
        ];
    }
    const out: Record<string, unknown>[] = [];
    const image = node.fills.find((p) => p.visible && p.type === "image");
    if (image && image.type === "image") {
        let id = imageIds.get(image.id);
        const data = doc.images[image.id];
        const natural = imageSize(image.id);
        if (!id && data && natural) {
            id = `image_${assets.length}`;
            imageIds.set(image.id, id);
            assets.push({ id, w: natural.w, h: natural.h, u: "", p: data, e: 1 });
        }
        if (id && natural) {
            out.push({
                ...common,
                nm: `${node.name} image`,
                ty: 2,
                refId: id,
                ks: {
                    ...transform(samples, base, [natural.w / 2, natural.h / 2]),
                    s: prop(samples, (s) => [(s.w / natural.w) * 100, (s.h / natural.h) * 100], [100, 100]),
                },
            });
        }
    }
    let shape: Record<string, unknown> | null = null;
    if (node.type === "ellipse") {
        shape = { ty: "el", p: { a: 0, k: [0, 0] }, s: prop(samples, (s) => [s.w, s.h], [base.w, base.h]), nm: "Ellipse" };
    } else if (node.type === "vector") {
        // The path at the node's size, centred; size changes scale the layer.
        const sub = placedSubpaths(node);
        const paths = sub.map((sp) => ({
            ty: "sh",
            ks: {
                a: 0,
                k: {
                    c: sp.closed,
                    v: sp.points.map((p) => [r3(p.x - node.w / 2), r3(p.y - node.h / 2)]),
                    i: sp.points.map((p) => (p.in ? [r3(p.in.x - p.x), r3(p.in.y - p.y)] : [0, 0])),
                    o: sp.points.map((p) => (p.out ? [r3(p.out.x - p.x), r3(p.out.y - p.y)] : [0, 0])),
                },
            },
            nm: "Path",
        }));
        if (!paths.length) return out.length ? out : null;
        const ks = {
            ...transform(samples, base),
            s: prop(samples, (s) => [(s.w / Math.max(base.w, 1e-6)) * 100, (s.h / Math.max(base.h, 1e-6)) * 100, 100], [100, 100, 100]),
        };
        out.push({ ...common, ty: 4, ks, shapes: [{ ty: "gr", nm: node.name, it: [...paths, ...paints(node, samples, base), TR] }] });
        return out;
    } else if (node.type === "boolean") {
        return out.length ? out : null;
    } else {
        shape = { ty: "rc", d: 1, p: { a: 0, k: [0, 0] }, s: prop(samples, (s) => [s.w, s.h], [base.w, base.h]), r: prop(samples, (s) => [s.radius], [base.radius]), nm: "Rectangle" };
    }
    const items = paints(node, samples, base);
    if (!items.length) return out.length ? out : null;
    out.push({ ...common, ty: 4, ks: transform(samples, base), shapes: [{ ty: "gr", nm: node.name, it: [shape, ...items, TR] }] });
    return out;
}

const TR = { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, nm: "Transform" };

// The pixel size of a stored image, read from the decoded image the canvas already uses.
const sizes = new Map<string, { w: number; h: number }>();

export function noteImageSize(id: string, w: number, h: number) {
    sizes.set(id, { w, h });
}

function imageSize(id: string): { w: number; h: number } | null {
    return sizes.get(id) ?? null;
}

// Export › Animated for a frame with Motion keyframes: every layer becomes a Lottie layer, with a
// sample at each keyframe time so the eased moves come across.
export function buildLottieFromAnimation(doc: NagmaDocument, frameId: string, fps: number): LottieFile {
    const frame = doc.nodes[frameId];
    if (!frame) throw new Error("Nothing to animate");
    const duration = durationOf(doc, frameId);
    const toFrames = (ms: number) => Math.round((ms / 1000) * fps);
    const total = Math.max(1, toFrames(duration));
    const layers: Record<string, unknown>[] = [];
    const assets: Record<string, unknown>[] = [];
    const fonts = new Map<string, Record<string, unknown>>();
    const imageIds = new Map<string, string>();
    for (const { node, clip } of paintOrder(doc, frame)) {
        // Sample times: every keyframe on this layer (and its ancestors, whose motion carries it), plus the ends.
        const times = new Set<number>([0, duration]);
        let current: SceneNode | undefined = node;
        while (current) {
            for (const prop of ANIM_PROPS) for (const k of current.animation?.tracks[prop] ?? []) times.add(Math.min(duration, k.t));
            current = current.parentId ? doc.nodes[current.parentId] : undefined;
        }
        const stateAt = (t: number): State => {
            // Ancestors' position keyframes move this layer too (child coordinates are absolute).
            let dx = 0;
            let dy = 0;
            let p: SceneNode | undefined = node.parentId ? doc.nodes[node.parentId] : undefined;
            while (p && p.type !== "page") {
                if (hasAnimation(p)) {
                    dx += (valueAt(p, "x", t) as number) - p.x;
                    dy += (valueAt(p, "y", t) as number) - p.y;
                }
                p = p.parentId ? doc.nodes[p.parentId] : undefined;
            }
            const at = (prop: "x" | "y" | "w" | "h" | "rotation" | "opacity" | "radius") => valueAt(node, prop, t) as number;
            const fill = valueAt(node, "fill", t);
            const w = at("w");
            const h = at("h");
            return {
                cx: at("x") - frame.x + w / 2 + dx + (node === frame ? frame.x - at("x") : 0),
                cy: at("y") - frame.y + h / 2 + dy + (node === frame ? frame.y - at("y") : 0),
                w,
                h,
                rot: at("rotation"),
                op: at("opacity"),
                color: typeof fill === "string" ? rgb(fill) : null,
                radius: at("radius"),
            };
        };
        const sorted = [...times].sort((a, b) => a - b);
        const easeAt = (t: number) => {
            for (const prop of ANIM_PROPS) {
                const k = node.animation?.tracks[prop]?.find((k) => Math.abs(k.t - t) < 1);
                if (k) return k.easing === "hold" ? ("linear" as const) : k.easing;
            }
            return "ease-in-out" as const;
        };
        const samples: Sample[] = sorted.map((t) => ({ frame: toFrames(t), state: stateAt(t), ease: easeAt(t) }));
        const base = samples[0]?.state ?? stateAt(0);
        const layer = lottieLayer(doc, node, samples.length > 1 ? samples : [{ frame: 0, state: base, ease: "linear" }], base, clip, { ip: 0, op: total }, assets, imageIds, fonts);
        if (layer) layers.push(...layer);
    }
    return {
        v: "5.7.4",
        fr: fps,
        ip: 0,
        op: total,
        w: Math.round(frame.w),
        h: Math.round(frame.h),
        nm: frame.name,
        ddd: 0,
        assets,
        fonts: { list: [...fonts.values()] },
        layers: layers.reverse(),
    };
}

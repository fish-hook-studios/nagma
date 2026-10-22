import type { NagmaDocument } from "../types";
import { type VClip, type VComp, type VProject, clipEnd, clipsOn, propAt, shapeItems, shapePropAt, videoTracks } from "./model";
import { renderComp } from "./render";

// Lottie and animated SVG from the video editor. Every clip on a visible video track becomes a
// layer that shows for the clip's time, with its position, scale, rotation, anchor and opacity
// animated. What it shows:
// - solids and rectangle or ellipse shapes stay vector shapes;
// - anything whose picture doesn't change over the clip (stills, page frames, titles without an
//   in or out animation, shapes and solids with effects) is drawn once, as one image;
// - anything that changes (video, nested sequences, animated titles, keyframed effects, masks or
//   colour) is drawn frame by frame as images, at most `maxImages` across the export.
// Transitions become fades. Sound isn't included (neither format carries it).

export interface VectorProgress {
    done: number;
    total: number;
}

interface Sample {
    t: number;
    x: number;
    y: number;
    sx: number;
    sy: number;
    r: number;
    ax: number;
    ay: number;
    o: number;
}

type Content = { kind: "rect" | "ellipse"; w: number; h: number; radius: number; fill: string | null; stroke: string | null; strokeWidth: number } | { kind: "still"; image: string } | { kind: "frames"; images: { t: number; image: string }[] };

interface LayerPlan {
    clip: VClip;
    // Seconds on the export's timeline.
    from: number;
    to: number;
    samples: Sample[];
    content: Content;
}

const TRANSFORM = ["x", "y", "scaleX", "scaleY", "rotation", "anchorX", "anchorY", "opacity"];

function changesOverTime(clip: VClip): boolean {
    if (clip.kind === "video" || clip.kind === "comp") return true;
    if (clip.kind === "title" && clip.title && (clip.title.animIn !== "none" || clip.title.animOut !== "none")) return true;
    return Object.keys(clip.anim).some((path) => !TRANSFORM.includes(path) && (clip.anim[path]?.length ?? 0) > 1);
}

function isVector(clip: VClip): boolean {
    if (clip.effects.some((e) => e.enabled) || clip.masks.length || clip.look) return false;
    if (Object.entries(clip.props).some(([k, v]) => (k.startsWith("color.") && k !== "color.look" && v !== 0 && k !== "color.saturation") || (k === "color.saturation" && v !== 100) || (k.startsWith("crop.") && v !== 0))) return false;
    if (clip.blend !== "normal") return false;
    if (clip.kind === "solid") return true;
    if (clip.kind !== "shape") return false;
    // One plain rectangle or ellipse: no trim, dashes, rotation or keyframed geometry.
    const items = shapeItems(clip);
    const item = items[0];
    if (items.length !== 1 || !item || (item.kind !== "rect" && item.kind !== "ellipse") || item.trim || item.dash.length) return false;
    return !Object.keys(clip.anim).some((k) => k.startsWith("shape.")) && !clip.props[`shape.${item.id}.rotation`] && !clip.props[`shape.${item.id}.x`] && !clip.props[`shape.${item.id}.y`];
}

// The clip with its transform reset (centred, full size, opaque), to draw its picture alone.
function bare(comp: VComp, clip: VClip): VComp {
    const anim = Object.fromEntries(Object.entries(clip.anim).filter(([k]) => !TRANSFORM.includes(k)));
    const props = { ...clip.props, x: comp.width / 2, y: comp.height / 2, anchorX: 0, anchorY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 };
    return { ...comp, background: "transparent", inPoint: null, outPoint: null, tracks: comp.tracks.filter((t) => t.id === clip.track), clips: [{ ...clip, start: 0, props, anim, tin: null, tout: null }] };
}

function sampleClip(comp: VComp, clip: VClip, from: number, to: number, rate: number): Sample[] {
    const animated = TRANSFORM.some((k) => (clip.anim[k]?.length ?? 0) > 1) || Boolean(clip.tin) || Boolean(clip.tout);
    const times: number[] = [];
    if (!animated) times.push(Math.max(from, clip.start));
    else for (let t = Math.max(from, clip.start); t < Math.min(to, clipEnd(clip)) + 1e-6; t += 1 / rate) times.push(t);
    return times.map((t) => {
        const lt = t - clip.start;
        let o = propAt(comp, clip, "opacity", lt) / 100;
        // Transitions as fades in and out.
        if (clip.tin && lt < clip.tin.duration) o *= Math.max(0, lt / clip.tin.duration);
        const left = clipEnd(clip) - t;
        if (clip.tout && left < clip.tout.duration) o *= Math.max(0, left / clip.tout.duration);
        return { t, x: propAt(comp, clip, "x", lt), y: propAt(comp, clip, "y", lt), sx: propAt(comp, clip, "scaleX", lt), sy: propAt(comp, clip, "scaleY", lt), r: propAt(comp, clip, "rotation", lt), ax: propAt(comp, clip, "anchorX", lt), ay: propAt(comp, clip, "anchorY", lt), o: Math.max(0, Math.min(1, o)) };
    });
}

async function plan(project: VProject, doc: NagmaDocument, comp: VComp, range: [number, number], scale: number, maxImages: number, onProgress: (p: VectorProgress) => void, cancelled: () => boolean): Promise<LayerPlan[] | null> {
    const [from, to] = range;
    const clips: VClip[] = [];
    for (const track of videoTracks(comp)) {
        if (track.hidden) continue;
        for (const clip of clipsOn(comp, track.id)) if (!clip.disabled && clip.kind !== "audio" && clip.kind !== "adjustment" && clipEnd(clip) > from && clip.start < to) clips.push(clip);
    }
    // Frame-by-frame clips share the image budget by their length.
    const moving = clips.filter((c) => !isVector(c) && changesOverTime(c));
    const movingSeconds = moving.reduce((s, c) => s + Math.min(to, clipEnd(c)) - Math.max(from, c.start), 0);
    const stills = clips.length - moving.length;
    const rate = movingSeconds > 0 ? Math.max(1, Math.min(comp.fps, (maxImages - stills) / movingSeconds)) : comp.fps;
    const total = clips.filter((c) => !isVector(c)).reduce((n, c) => n + (changesOverTime(c) ? Math.ceil((Math.min(to, clipEnd(c)) - Math.max(from, c.start)) * rate) : 1), 0);
    let done = 0;
    const W = Math.max(2, Math.round(comp.width * scale));
    const H = Math.max(2, Math.round(comp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas");
    const opts = { project, doc, scale, exact: true, tag: "vector:" };
    const picture = async (alone: VComp, lt: number) => {
        await renderComp(ctx, alone, lt, opts);
        const webp = canvas.toDataURL("image/webp", 0.86);
        return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
    };
    const out: LayerPlan[] = [];
    for (const clip of clips) {
        if (cancelled()) return null;
        const a = Math.max(from, clip.start);
        const b = Math.min(to, clipEnd(clip));
        const samples = sampleClip(comp, clip, a, b, Math.min(comp.fps, 30));
        let content: Content;
        if (isVector(clip)) {
            const item = clip.kind === "shape" ? shapeItems(clip)[0] : undefined;
            const sp = (key: "w" | "h" | "radius" | "strokeWidth") => (item ? shapePropAt(comp, clip, item, key, 0) : 0);
            content = item ? { kind: item.kind as "rect", w: sp("w"), h: sp("h"), radius: sp("radius"), fill: item.fill, stroke: item.stroke, strokeWidth: sp("strokeWidth") } : { kind: "rect", w: comp.width, h: comp.height, radius: 0, fill: clip.color ?? "#000000", stroke: null, strokeWidth: 0 };
        } else if (!changesOverTime(clip)) {
            content = { kind: "still", image: await picture(bare(comp, clip), Math.max(0, a - clip.start)) };
            onProgress({ done: ++done, total });
        } else {
            const images: { t: number; image: string }[] = [];
            const alone = bare(comp, clip);
            for (let t = a; t < b - 1e-6; t += 1 / rate) {
                if (cancelled()) return null;
                images.push({ t, image: await picture(alone, t - clip.start) });
                onProgress({ done: ++done, total });
                if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
            }
            content = { kind: "frames", images };
        }
        out.push({ clip, from: a, to: b, samples, content });
    }
    return out;
}

// The pictures a layer shows, with the time each starts.
function imagesOf(l: LayerPlan): { t: number; image: string }[] {
    const c = l.content;
    if (c.kind === "still") return [{ t: l.from, image: c.image }];
    if (c.kind === "frames") return c.images;
    return [];
}

// ---- Lottie ----

const rgb = (hex: string | null | undefined): [number, number, number, number] => {
    const h = (hex ?? "#000000").replace("#", "");
    const n = (i: number) => (parseInt(h.slice(i, i + 2), 16) || 0) / 255;
    return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
};

const LINEAR = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };

// A property: a plain value, or keyframes (frames on the export's timeline).
function prop(samples: Sample[], value: (s: Sample) => number[], frameOf: (t: number) => number) {
    const first = samples[0];
    if (!first) return { a: 0, k: [0] };
    if (samples.length === 1) return { a: 0, k: value(first) };
    return { a: 1, k: samples.map((s, i) => (i < samples.length - 1 ? { t: frameOf(s.t), s: value(s), ...LINEAR } : { t: frameOf(s.t), s: value(s) })) };
}

export async function exportLottie(project: VProject, doc: NagmaDocument, comp: VComp, range: [number, number], height: number, fps: number, maxImages: number, onProgress: (p: VectorProgress) => void, cancelled: () => boolean): Promise<Blob | null> {
    const scale = height / comp.height;
    const layers = await plan(project, doc, comp, range, scale, maxImages, onProgress, cancelled);
    if (!layers) return null;
    const W = Math.round(comp.width * scale);
    const H = Math.round(comp.height * scale);
    const frameOf = (t: number) => Math.round((t - range[0]) * fps * 1000) / 1000;
    const assets: Record<string, unknown>[] = [];
    const out: Record<string, unknown>[] = [];
    let ind = 1;
    const transform = (l: LayerPlan, anchor: (s: Sample) => number[]) => ({
        a: prop(l.samples, anchor, frameOf),
        p: prop(l.samples, (s) => [s.x * scale, s.y * scale, 0], frameOf),
        s: prop(l.samples, (s) => [s.sx, s.sy, 100], frameOf),
        r: prop(l.samples, (s) => [s.r], frameOf),
        o: prop(l.samples, (s) => [s.o * 100], frameOf),
    });
    // Lottie lists the top layer first.
    for (const l of [...layers].reverse()) {
        const ip = frameOf(l.from);
        const op = frameOf(l.to);
        const name = l.clip.name || l.clip.kind;
        if (l.content.kind === "rect" || l.content.kind === "ellipse") {
            const c = l.content;
            const size = { a: 0, k: [c.w * scale, c.h * scale] };
            const geometry = c.kind === "rect" ? { ty: "rc", nm: "Shape", p: { a: 0, k: [0, 0] }, s: size, r: { a: 0, k: c.radius * scale } } : { ty: "el", nm: "Shape", p: { a: 0, k: [0, 0] }, s: size };
            const items: Record<string, unknown>[] = [geometry];
            if (c.fill) items.push({ ty: "fl", nm: "Fill", c: { a: 0, k: rgb(c.fill) }, o: { a: 0, k: 100 * (rgb(c.fill)[3] ?? 1) }, r: 1 });
            if (c.stroke && c.strokeWidth > 0) items.push({ ty: "st", nm: "Stroke", c: { a: 0, k: rgb(c.stroke) }, o: { a: 0, k: 100 }, w: { a: 0, k: c.strokeWidth * scale }, lc: 2, lj: 2 });
            items.push({ ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
            out.push({ ty: 4, ind: ind++, nm: name, ip, op, st: 0, sr: 1, ks: transform(l, (s) => [s.ax * scale, s.ay * scale, 0]), shapes: [{ ty: "gr", nm: name, it: items }], ao: 0, bm: 0 });
            continue;
        }
        const images = imagesOf(l);
        images.forEach((img, i) => {
            const id = `image_${assets.length}`;
            assets.push({ id, w: W, h: H, u: "", p: img.image, e: 1 });
            const next = images[i + 1];
            out.push({ ty: 2, ind: ind++, nm: images.length > 1 ? `${name} ${i + 1}` : name, refId: id, ip: frameOf(img.t), op: next ? frameOf(next.t) : op, st: 0, sr: 1, ks: transform(l, (s) => [W / 2 + s.ax * scale, H / 2 + s.ay * scale, 0]), ao: 0, bm: 0 });
        });
        void ip;
    }
    const lottie = { v: "5.12.1", fr: fps, ip: 0, op: Math.max(1, frameOf(range[1])), w: W, h: H, nm: comp.name, ddd: 0, assets, layers: out, markers: comp.markers.map((m) => ({ tm: frameOf(m.t), cm: m.name, dr: 0 })) };
    // The sequence's background, as a bottom layer.
    if (comp.background && comp.background !== "transparent") lottie.layers.push({ ty: 1, ind: ind++, nm: "Background", sc: comp.background, sw: W, sh: H, ip: 0, op: lottie.op, st: 0, sr: 1, ks: { a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }, ao: 0, bm: 0 });
    return new Blob([JSON.stringify(lottie)], { type: "application/json" });
}

// ---- Animated SVG (SMIL: plays in browsers on its own, loops) ----

const num = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export async function exportAnimatedSvg(project: VProject, doc: NagmaDocument, comp: VComp, range: [number, number], height: number, maxImages: number, onProgress: (p: VectorProgress) => void, cancelled: () => boolean): Promise<Blob | null> {
    const scale = height / comp.height;
    const layers = await plan(project, doc, comp, range, scale, maxImages, onProgress, cancelled);
    if (!layers) return null;
    const W = Math.round(comp.width * scale);
    const H = Math.round(comp.height * scale);
    const total = Math.max(0.01, range[1] - range[0]);
    const kt = (t: number) => Math.max(0, Math.min(1, (t - range[0]) / total));
    const dur = `dur="${num(total)}s" repeatCount="indefinite"`;
    // Shown only between two times (discrete steps on the loop's clock).
    const window = (a: number, b: number) => {
        const times = [0, kt(a), kt(b)];
        const values = ["hidden", "visible", "hidden"];
        if (times[1] === 0) {
            times.splice(0, 1);
            values.splice(0, 1);
        }
        if ((times[times.length - 1] ?? 1) >= 1) {
            times.pop();
            values.pop();
        }
        return `<animate attributeName="visibility" calcMode="discrete" values="${values.join(";")}" keyTimes="${times.map((t) => num(Math.min(1, t))).join(";")}" ${dur}/>`;
    };
    // A transform or opacity that changes: sampled values, holding the first and last.
    const anim = (l: LayerPlan, attr: string, type: string | null, value: (s: Sample) => string) => {
        const s = l.samples;
        if (s.length < 2) return "";
        const times = [0, ...s.map((x) => kt(x.t)), 1];
        const values = [value(s[0] as Sample), ...s.map(value), value(s[s.length - 1] as Sample)];
        const dedup = times.map((t, i) => [t, values[i]] as const).filter(([t], i, all) => i === 0 || t > (all[i - 1]?.[0] ?? -1));
        const body = `values="${dedup.map(([, v]) => v).join(";")}" keyTimes="${dedup.map(([t]) => num(t)).join(";")}" ${dur}`;
        return type ? `<animateTransform attributeName="transform" type="${type}" additive="sum" ${body}/>` : `<animate attributeName="${attr}" ${body}/>`;
    };
    const parts: string[] = [];
    if (comp.background && comp.background !== "transparent") parts.push(`<rect width="${W}" height="${H}" fill="${esc(comp.background)}"/>`);
    for (const l of layers) {
        const first = l.samples[0] as Sample;
        const stat = l.samples.length < 2;
        const t = (s: Sample) => ({ p: `${num(s.x * scale)} ${num(s.y * scale)}`, r: num(s.r), s: `${num(s.sx / 100)} ${num(s.sy / 100)}`, a: `${num(-s.ax * scale)} ${num(-s.ay * scale)}` });
        const f = t(first);
        const staticTransform = stat ? ` transform="translate(${f.p}) rotate(${f.r}) scale(${f.s}) translate(${f.a})"` : "";
        let content = "";
        if (l.content.kind === "rect" || l.content.kind === "ellipse") {
            const c = l.content;
            const w = c.w * scale;
            const h = c.h * scale;
            const paint = `fill="${c.fill ? esc(c.fill) : "none"}"${c.stroke && c.strokeWidth > 0 ? ` stroke="${esc(c.stroke)}" stroke-width="${num(c.strokeWidth * scale)}"` : ""}`;
            content = c.kind === "rect" ? `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}" rx="${num(c.radius * scale)}" ${paint}/>` : `<ellipse rx="${num(w / 2)}" ry="${num(h / 2)}" ${paint}/>`;
        } else {
            const images = imagesOf(l);
            content = images
                .map((img, i) => {
                    const next = images[i + 1];
                    const show = images.length > 1 ? window(img.t, next ? next.t : l.to) : "";
                    return `<image x="${num(-W / 2)}" y="${num(-H / 2)}" width="${W}" height="${H}" href="${img.image}"${images.length > 1 ? ' visibility="hidden"' : ""}>${show}</image>`;
                })
                .join("");
        }
        const moves = stat
            ? ""
            : [anim(l, "", "translate", (s) => t(s).p), anim(l, "", "rotate", (s) => t(s).r), anim(l, "", "scale", (s) => t(s).s), anim(l, "", "translate", (s) => t(s).a)].join("");
        const opacity = stat ? (first.o < 1 ? ` opacity="${num(first.o)}"` : "") : "";
        const fade = stat ? "" : anim(l, "opacity", null, (s) => num(s.o));
        const whole = l.from <= range[0] && l.to >= range[1];
        parts.push(`<g${whole ? "" : ' visibility="hidden"'}>${whole ? "" : window(l.from, l.to)}<g${staticTransform}${opacity}>${moves}${fade}${content}</g></g>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${esc(comp.name)}</title>${parts.join("")}</svg>`;
    return new Blob([svg], { type: "image/svg+xml" });
}

import { hexToRgba } from "../engine/paint";
import { localMatrix } from "../engine/transform";
import type { Effect, SceneNode } from "../engine/types";

// The newer effects on the canvas: shadows cut out under their layer, progressive blurs, noise,
// texture and glass. render.ts calls these at the right points of drawing a layer.

type Pt = { x: number; y: number };

function scratch(existing: HTMLCanvasElement | undefined, like: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = existing ?? document.createElement("canvas");
    if (canvas.width !== like.width || canvas.height !== like.height) {
        canvas.width = like.width;
        canvas.height = like.height;
    }
    return canvas;
}

function fresh(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const c = canvas.getContext("2d");
    if (!c) return null;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.filter = "none";
    c.clearRect(0, 0, canvas.width, canvas.height);
    return c;
}

// Pools of scratch canvases by nesting depth, so a layer inside a layer gets its own.
const pools = new Map<string, HTMLCanvasElement[]>();
let depth = 0;
function pooled(name: string, like: HTMLCanvasElement): HTMLCanvasElement {
    let list = pools.get(name);
    if (!list) pools.set(name, (list = []));
    const canvas = scratch(list[depth], like);
    list[depth] = canvas;
    return canvas;
}

// ---- Drop shadows that don't show through the layer ----

// A shadow with "Show behind transparent areas" off is drawn on its own canvas, the layer's shape
// is cut out of it, and the rest lands on the canvas. Returns the context to draw the shadow on.
export function beginKnockout(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D | null {
    if (!ctx.canvas.width || !ctx.canvas.height) return null;
    const canvas = pooled("knock", ctx.canvas);
    depth++;
    const c = fresh(canvas);
    if (!c) {
        depth--;
        return null;
    }
    c.setTransform(ctx.getTransform());
    c.globalAlpha = ctx.globalAlpha;
    return c;
}

export function endKnockout(ctx: CanvasRenderingContext2D, c: CanvasRenderingContext2D, cut: (c: CanvasRenderingContext2D) => void, composite: GlobalCompositeOperation = "source-over") {
    depth--;
    c.save();
    c.shadowColor = "transparent";
    c.globalAlpha = 1;
    c.globalCompositeOperation = "destination-out";
    cut(c);
    c.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = composite;
    ctx.drawImage(c.canvas, 0, 0);
    ctx.restore();
}

// ---- Progressive blur ----

export const progressiveOf = (e: Effect) => (e.type === "layer-blur" || e.type === "background-blur") && e.progressive ? e.progressive : null;

// Draws `src` (device pixels) onto `ctx` blurred from `start` at device point `p0` to `end` at
// `p1`: a stack of evenly stepped blurs, each faded in along the ramp over the one before.
export function drawRamped(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, start: number, end: number, p0: Pt, p1: Pt, clip?: (c: CanvasRenderingContext2D) => void) {
    const acc = pooled("rampAcc", ctx.canvas);
    const step = pooled("rampStep", ctx.canvas);
    depth++;
    try {
        const a = fresh(acc);
        const t = fresh(step);
        if (!a || !t) return;
        const steps = Math.max(2, Math.min(8, Math.ceil(Math.abs(end - start) / 2)));
        const radius = (k: number) => Math.max(0, start + ((end - start) * k) / steps);
        // The reference's blur radius is twice the Gaussian's deviation (CSS blur takes the deviation).
        const filter = (r: number) => (r > 0.25 ? `blur(${r / 2}px)` : "none");
        a.filter = filter(radius(0));
        a.drawImage(src, 0, 0);
        a.filter = "none";
        for (let k = 1; k <= steps; k++) {
            t.globalCompositeOperation = "source-over";
            t.clearRect(0, 0, step.width, step.height);
            t.filter = filter(radius(k));
            t.drawImage(src, 0, 0);
            t.filter = "none";
            const g = t.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
            g.addColorStop(Math.max(0, (k - 1) / steps), "rgba(0,0,0,0)");
            g.addColorStop(Math.min(1, k / steps), "rgba(0,0,0,1)");
            t.globalCompositeOperation = "destination-in";
            t.fillStyle = g;
            t.fillRect(0, 0, step.width, step.height);
            a.drawImage(step, 0, 0);
        }
        if (clip) {
            a.globalCompositeOperation = "destination-in";
            clip(a);
            a.globalCompositeOperation = "source-over";
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(acc, 0, 0);
        ctx.restore();
    } finally {
        depth--;
    }
}

// The ramp's ends in device pixels, for a layer drawn in `m` (the layer's own space).
export function rampPoints(m: DOMMatrix, node: SceneNode, p: NonNullable<Effect["progressive"]>): [Pt, Pt] {
    const at = (f: Pt) => {
        const x = node.x + f.x * node.w;
        const y = node.y + f.y * node.h;
        return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    };
    return [at(p.from), at(p.to)];
}

export function layerSpace(ctx: CanvasRenderingContext2D, node: SceneNode): DOMMatrix {
    return ctx.getTransform().multiply(localMatrix(node));
}

// A background blur that ramps: the backdrop under the shape, blurred progressively, inside it.
export function progressiveBackdrop(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, e: Effect, pixelScale: number) {
    const p = e.progressive;
    if (!p || !ctx.canvas.width || !ctx.canvas.height) return;
    const copy = pooled("backdrop", ctx.canvas);
    depth++;
    try {
        const c = fresh(copy);
        if (!c) return;
        c.drawImage(ctx.canvas, 0, 0);
        const m = ctx.getTransform();
        const [p0, p1] = rampPoints(m, node, p);
        drawRamped(ctx, copy, p.startBlur * pixelScale, e.blur * pixelScale, p0, p1, (a) => {
            a.setTransform(m);
            a.fillStyle = "#000";
            a.fill(path);
            a.setTransform(1, 0, 0, 1, 0, 0);
        });
    } finally {
        depth--;
    }
}

// ---- Noise ----

function mulberry(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TILE = 128;
const noiseTiles = new Map<string, HTMLCanvasElement>();

// A 128 × 128 tile of grain cells (one pixel each), the same every time for the same settings. Each
// cell has a random strength (up to the colour's opacity); density is the share of cells that show.
function noiseTile(e: Effect): HTMLCanvasElement | null {
    const type = e.noiseType ?? "mono";
    const density = Math.min(1, Math.max(0, e.density ?? 1));
    const key = `${type}|${density}|${e.color}|${e.opacity}|${e.color2}|${e.opacity2}`;
    const hit = noiseTiles.get(key);
    if (hit) return hit;
    const canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    const c = canvas.getContext("2d");
    if (!c) return null;
    const img = c.createImageData(TILE, TILE);
    const rand = mulberry(7);
    const rgb = (hex: string) => {
        const h = hex.replace("#", "");
        return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
    };
    const first = rgb(e.color);
    const second = rgb(e.color2 ?? "#FFFFFF");
    for (let i = 0; i < TILE * TILE; i++) {
        const on = rand() < density;
        const strength = rand();
        const pick = rand();
        const hue = [rand() * 255, rand() * 255, rand() * 255];
        if (!on) continue;
        let color = first;
        let alpha = e.opacity;
        if (type === "duo" && pick < 0.5) {
            color = second;
            alpha = e.opacity2 ?? 1;
        } else if (type === "multi") color = hue;
        img.data[i * 4] = color[0] ?? 0;
        img.data[i * 4 + 1] = color[1] ?? 0;
        img.data[i * 4 + 2] = color[2] ?? 0;
        img.data[i * 4 + 3] = Math.round(alpha * strength * 255);
    }
    c.putImageData(img, 0, 0);
    if (noiseTiles.size > 64) noiseTiles.clear();
    noiseTiles.set(key, canvas);
    return canvas;
}

// Grain over the layer's shape, in the layer's space so it moves and scales with it.
export function drawNoise(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, e: Effect) {
    const tile = noiseTile(e);
    if (!tile) return;
    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) return;
    const sx = Math.max(0.1, e.noiseSize ?? 0.5);
    const sy = Math.max(0.1, e.noiseSizeY ?? sx);
    pattern.setTransform(new DOMMatrix().translate(node.x, node.y).scale(sx, sy));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pattern;
    ctx.fill(path);
    ctx.restore();
}

// ---- Texture ----

function hash(x: number, y: number, s: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Roughens the finished layer (`src`, device pixels): every grain cell of the layer's own space
// takes its pixels from a random spot up to `radius` away, so edges turn grainy. With clip to
// shape on, nothing lands outside the layer's own outline.
export function drawTextured(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, m: DOMMatrix, e: Effect) {
    const sc = src.getContext("2d");
    if (!sc) return;
    const radius = Math.max(0, e.blur);
    const sizeX = Math.max(0.1, e.noiseSize ?? 0.5);
    const sizeY = Math.max(0.1, e.noiseSizeY ?? sizeX);
    const w = src.width;
    const h = src.height;
    const data = sc.getImageData(0, 0, w, h);
    // The painted area, padded by the reach of the displacement.
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    const d = data.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return;
    const scale = Math.hypot(m.a, m.b) || 1;
    const reach = Math.ceil(radius * scale) + 1;
    x0 = Math.max(0, x0 - reach);
    y0 = Math.max(0, y0 - reach);
    x1 = Math.min(w - 1, x1 + reach);
    y1 = Math.min(h - 1, y1 + reach);
    const inv = m.inverse();
    const out = new ImageData(x1 - x0 + 1, y1 - y0 + 1);
    const o = out.data;
    const clip = e.clipToShape !== false;
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            // The grain cell this device pixel sits in, in the layer's space.
            const lx = inv.a * x + inv.c * y + inv.e;
            const ly = inv.b * x + inv.d * y + inv.f;
            const cx = Math.floor(lx / sizeX);
            const cy = Math.floor(ly / sizeY);
            const dx = (hash(cx, cy, 1) * 2 - 1) * radius;
            const dy = (hash(cx, cy, 2) * 2 - 1) * radius;
            const sx = Math.round(x + (m.a * dx + m.c * dy));
            const sy = Math.round(y + (m.b * dx + m.d * dy));
            const to = ((y - y0) * out.width + (x - x0)) * 4;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const from = (sy * w + sx) * 4;
            let alpha = d[from + 3] ?? 0;
            if (clip) alpha = Math.min(alpha, d[(y * w + x) * 4 + 3] ?? 0);
            o[to] = d[from] ?? 0;
            o[to + 1] = d[from + 1] ?? 0;
            o[to + 2] = d[from + 2] ?? 0;
            o[to + 3] = alpha;
        }
    }
    const tmp = document.createElement("canvas");
    tmp.width = out.width;
    tmp.height = out.height;
    tmp.getContext("2d")?.putImageData(out, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tmp, x0, y0);
    ctx.restore();
}

// ---- Glass ----

// Canvases of a given size, kept by name.
const sized = new Map<string, HTMLCanvasElement>();
function sizedCanvas(name: string, w: number, h: number): CanvasRenderingContext2D | null {
    let canvas = sized.get(name);
    if (!canvas) sized.set(name, (canvas = document.createElement("canvas")));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) return null;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.filter = "none";
    c.clearRect(0, 0, w, h);
    return c;
}

// Under the layer's fills: what is behind it, frosted, and bent near the rim like the edge of a
// thick pane. Within `depth` of the outline the backdrop is pulled from further in (refraction),
// with red and blue pulled by different amounts (dispersion); splay carries the bending further
// toward the middle. The middle stays true.
export function drawGlassBackdrop(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, e: Effect, pixelScale: number) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (!cw || !ch) return;
    const m = ctx.getTransform();
    // The layer's box on the canvas, in device pixels.
    const corners = [
        [node.x, node.y],
        [node.x + node.w, node.y],
        [node.x, node.y + node.h],
        [node.x + node.w, node.y + node.h],
    ].map(([x, y]) => ({ x: m.a * (x ?? 0) + m.c * (y ?? 0) + m.e, y: m.b * (x ?? 0) + m.d * (y ?? 0) + m.f }));
    const depthPx = Math.max(1, (e.depth ?? 20) * pixelScale);
    const refraction = Math.min(1, Math.max(0, e.refraction ?? 0.8));
    const dispersion = Math.min(1, Math.max(0, e.dispersion ?? 0));
    const splay = Math.min(1, Math.max(0, e.splay ?? 0));
    const frost = Math.max(0, e.blur) * pixelScale;
    const reach = Math.ceil(depthPx * refraction * (1 + dispersion * 0.5) + frost * 1.5) + 2;
    const bx0 = Math.floor(Math.min(...corners.map((p) => p.x)));
    const by0 = Math.floor(Math.min(...corners.map((p) => p.y)));
    const bx1 = Math.ceil(Math.max(...corners.map((p) => p.x)));
    const by1 = Math.ceil(Math.max(...corners.map((p) => p.y)));
    // The work area: the box padded by how far a pixel can look, kept on the canvas.
    const x0 = Math.max(0, bx0 - reach);
    const y0 = Math.max(0, by0 - reach);
    const x1 = Math.min(cw, bx1 + reach);
    const y1 = Math.min(ch, by1 + reach);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    // Very large areas (zoomed far in) get the plain frosted backdrop.
    if (w * h > 2_500_000) return frostedBackdrop(ctx, path, frost);
    const back = sizedCanvas("glassBack", w, h);
    const mask = sizedCanvas("glassMask", w, h);
    if (!back || !mask) return;
    back.filter = frost > 0.25 ? `blur(${frost / 2}px)` : "none";
    back.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
    back.filter = "none";
    mask.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    mask.fillStyle = "#000";
    mask.fill(path);
    mask.setTransform(1, 0, 0, 1, 0, 0);
    const B = back.getImageData(0, 0, w, h).data;
    const M = mask.getImageData(0, 0, w, h).data;
    const out = back.createImageData(w, h);
    const O = out.data;
    // Where the work area was cut short by the canvas edge, the layer goes on past it.
    const { dist, smooth, reachIn, band } = glassField(M, w, h, { left: bx0 - reach < 0, top: by0 - reach < 0, right: bx1 + reach > cw, bottom: by1 + reach > ch }, depthPx, splay);
    const distAt = (x: number, y: number) => smooth[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
    const power = 2.5 - splay * 1.7;
    const shift = [1 + dispersion * 0.5, 1, 1 - dispersion * 0.5];
    // Bilinear read of one channel of the backdrop.
    const read = (fx: number, fy: number, k: number) => {
        const x = Math.min(w - 1.001, Math.max(0, fx));
        const y = Math.min(h - 1.001, Math.max(0, fy));
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const tx = x - ix;
        const ty = y - iy;
        const i00 = ((iy * w + ix) << 2) + k;
        const i10 = i00 + 4;
        const i01 = i00 + (w << 2);
        const i11 = i01 + 4;
        const top = (B[i00] ?? 0) * (1 - tx) + (B[i10] ?? 0) * tx;
        const bottom = (B[i01] ?? 0) * (1 - tx) + (B[i11] ?? 0) * tx;
        return top * (1 - ty) + bottom * ty;
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) << 2;
            const a = M[i + 3] ?? 0;
            if (!a) continue;
            const d = dist[y * w + x] ?? 0;
            const t = Math.min(1, d / band);
            const bend = t >= 1 ? 0 : refraction * reachIn * Math.pow(1 - t, power);
            let nx = 0;
            let ny = 0;
            if (bend > 0.05) {
                // The distance rises inward; its slope, averaged over a few pixels, points in.
                const gx = distAt(x + 2, y) - distAt(x - 2, y) + 0.5 * (distAt(x + 2, y + 2) - distAt(x - 2, y + 2) + distAt(x + 2, y - 2) - distAt(x - 2, y - 2));
                const gy = distAt(x, y + 2) - distAt(x, y - 2) + 0.5 * (distAt(x + 2, y + 2) - distAt(x + 2, y - 2) + distAt(x - 2, y + 2) - distAt(x - 2, y - 2));
                const len = Math.hypot(gx, gy);
                if (len > 0) {
                    nx = gx / len;
                    ny = gy / len;
                }
            }
            for (let k = 0; k < 3; k++) {
                const s = bend * (shift[k] ?? 1);
                O[i + k] = read(x + nx * s, y + ny * s, k);
            }
            O[i + 3] = Math.round((a * read(x + nx * bend, y + ny * bend, 3)) / 255);
        }
    }
    mask.putImageData(out, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mask.canvas, x0, y0);
    ctx.restore();
}

// The distance field of a glass layer's outline and its softened copy, kept for the last few
// outlines (they only change when the shape, zoom or depth does).
type GlassField = { dist: Float32Array; smooth: Float32Array; reachIn: number; band: number };
const glassFields = new Map<string, GlassField>();
function glassField(M: Uint8ClampedArray, w: number, h: number, open: { left: boolean; top: boolean; right: boolean; bottom: boolean }, depthPx: number, splay: number): GlassField {
    let hash = 2166136261;
    for (let i = 3; i < M.length; i += 4) hash = Math.imul(hash ^ (M[i] ?? 0), 16777619);
    const key = `${w}x${h}|${hash >>> 0}|${depthPx}|${splay}|${open.left}${open.top}${open.right}${open.bottom}`;
    const hit = glassFields.get(key);
    if (hit) return hit;
    const dist = insideDistance(M, w, h, open);
    // Splay widens the band that bends and softens how it fades toward the middle. Neither goes
    // past the middle of the shape, so the bending meets itself smoothly there.
    let deepest = 0;
    for (let i = 0; i < dist.length; i++) deepest = Math.max(deepest, dist[i] ?? 0);
    const reachIn = Math.max(1, Math.min(depthPx, deepest));
    const band = Math.max(1, Math.min(reachIn * (1 + splay * 2), deepest));
    // A softened copy for the slope, so the bending turns smoothly where edges meet (corners, the
    // middle line) instead of folding.
    const smooth = boxBlur(dist, w, h, Math.max(2, Math.round(band * 0.15)));
    const field = { dist, smooth, reachIn, band };
    if (glassFields.size >= 4) glassFields.delete(glassFields.keys().next().value as string);
    glassFields.set(key, field);
    return field;
}

// How far each pixel inside the mask (alpha at least half) is from the nearest pixel outside it,
// by two chamfer passes (steps of 1 and √2). Beyond an `open` side the mask carries on.
function insideDistance(M: Uint8ClampedArray, w: number, h: number, open: { left: boolean; top: boolean; right: boolean; bottom: boolean }): Float32Array {
    const far = 1e9;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = (M[(i << 2) + 3] ?? 0) >= 128 ? far : 0;
    const D = Math.SQRT2;
    const beyond = (x: number, y: number) => (x < 0 && !open.left) || (y < 0 && !open.top) || (x >= w && !open.right) || (y >= h && !open.bottom);
    const at = (x: number, y: number) => {
        if (x >= 0 && y >= 0 && x < w && y < h) return d[y * w + x] ?? 0;
        return beyond(x, y) ? 0 : (d[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0);
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const v = d[i] ?? 0;
            if (!v) continue;
            d[i] = Math.min(v, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
        }
    }
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const i = y * w + x;
            const v = d[i] ?? 0;
            if (!v) continue;
            d[i] = Math.min(v, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
        }
    }
    return d;
}

// A separable box blur of a float field (two passes each way, close to a Gaussian).
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
    const a = new Float32Array(src);
    const b = new Float32Array(src.length);
    const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
        const n = horizontal ? w : h;
        const lines = horizontal ? h : w;
        const span = 2 * r + 1;
        for (let l = 0; l < lines; l++) {
            const at = (k: number) => from[horizontal ? l * w + Math.min(n - 1, Math.max(0, k)) : Math.min(n - 1, Math.max(0, k)) * w + l] ?? 0;
            let sum = 0;
            for (let k = -r; k <= r; k++) sum += at(k);
            for (let k = 0; k < n; k++) {
                to[horizontal ? l * w + k : k * w + l] = sum / span;
                sum += at(k + r + 1) - at(k - r);
            }
        }
    };
    for (let round = 0; round < 2; round++) {
        pass(a, b, true);
        pass(b, a, false);
    }
    return a;
}

// What is behind the layer, blurred, inside it.
function frostedBackdrop(ctx: CanvasRenderingContext2D, path: Path2D, frost: number) {
    const copy = pooled("glass", ctx.canvas);
    depth++;
    try {
        const c = fresh(copy);
        if (!c) return;
        c.drawImage(ctx.canvas, 0, 0);
        ctx.save();
        ctx.clip(path);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = frost > 0.25 ? `blur(${frost / 2}px)` : "none";
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
    } finally {
        depth--;
    }
}

// Over the fills: light catching the rim on the side facing the light (and faintly the far side),
// as deep as `depth`.
export function drawGlassRim(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, e: Effect, pixelScale: number) {
    const intensity = Math.min(1, Math.max(0, e.lightIntensity ?? 0.8));
    if (intensity <= 0) return;
    const rad = ((e.lightAngle ?? -45) * Math.PI) / 180;
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    const r = Math.hypot(node.w, node.h) / 2;
    const dx = Math.cos(rad) * r;
    const dy = Math.sin(rad) * r;
    const g = ctx.createLinearGradient(cx + dx, cy + dy, cx - dx, cy - dy);
    g.addColorStop(0, hexToRgba(e.color, intensity));
    g.addColorStop(0.45, hexToRgba(e.color, 0));
    g.addColorStop(0.55, hexToRgba(e.color, 0));
    g.addColorStop(1, hexToRgba(e.color, intensity * 0.4));
    const depthPx = Math.max(1, Math.min(e.depth ?? 20, Math.min(node.w, node.h) / 2));
    ctx.save();
    ctx.clip(path);
    ctx.filter = `blur(${Math.max(0.5, depthPx * 0.15 * pixelScale)}px)`;
    ctx.strokeStyle = g;
    ctx.lineWidth = depthPx * 0.5;
    ctx.stroke(path);
    ctx.filter = "none";
    ctx.lineWidth = Math.max(1 / pixelScale, 1);
    ctx.stroke(path);
    ctx.restore();
}

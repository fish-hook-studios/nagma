import type { BrushStroke, DynamicStroke, SceneNode, Subpath } from "./types";
import { type WidthPoint, outlineOf, widthAt, widthPointsOf } from "./width-profile";

// Draw mode's stroke types, drawn as filled outlines along the stroke's centre line:
// - Dynamic: a hand-drawn line whose position and width waver (frequency, wiggle, smoothen).
// - Stretch brushes: a texture pulled along the stroke (bristles, rough edges, a flat nib).
// - Scatter brushes: a shape repeated along the stroke with spacing, wander, size and angle jitter.
// Width profiles (presets, flip, previews) live here too. Everything is seeded by the layer's id,
// so a stroke looks the same every time it is drawn.

type Pt = { x: number; y: number };
export interface StrokePiece {
    pts: Pt[];
    // Each point's place along the whole outline, 0 to 1.
    t: number[];
}

export const DEFAULT_DYNAMIC: DynamicStroke = { frequency: 3, wiggle: 0.6, smoothen: 0.5 };

export function hasStyledStroke(node: SceneNode): boolean {
    return Boolean(node.dynamicStroke || node.brushStroke);
}

// ---- Seeded randomness -------------------------------------------------------------------------

function hashString(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function hash2(seed: number, i: number): number {
    let h = Math.imul(seed ^ Math.imul(i, 0x27d4eb2d), 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
    return ((h >>> 0) % 100000) / 100000;
}

function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Smooth value noise in -1..1.
function noise(seed: number, x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const e = f * f * (3 - 2 * f);
    const a = hash2(seed, i) * 2 - 1;
    const b = hash2(seed, i + 1) * 2 - 1;
    return a + (b - a) * e;
}

// ---- Outline helpers ---------------------------------------------------------------------------

function normals(pts: Pt[]): Pt[] {
    return pts.map((p, i) => {
        const q = pts[Math.min(i + 1, pts.length - 1)] ?? p;
        const o = pts[Math.max(i - 1, 0)] ?? p;
        const dx = q.x - o.x;
        const dy = q.y - o.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
    });
}

function arcLengths(pts: Pt[]): number[] {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push((d[i - 1] ?? 0) + Math.hypot((pts[i]?.x ?? 0) - (pts[i - 1]?.x ?? 0), (pts[i]?.y ?? 0) - (pts[i - 1]?.y ?? 0)));
    return d;
}

function signedArea(poly: Pt[]): number {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i] as Pt;
        const q = poly[(i + 1) % poly.length] as Pt;
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

// A band along the line: half widths per point on each side (left along the normal, right against).
// Round caps add a half circle at each end.
export function band(pts: Pt[], left: number[], right: number[], round: boolean): Pt[] {
    const n = normals(pts);
    const l: Pt[] = [];
    const r: Pt[] = [];
    pts.forEach((p, i) => {
        const nn = n[i] as Pt;
        l.push({ x: p.x + nn.x * (left[i] ?? 0), y: p.y + nn.y * (left[i] ?? 0) });
        r.push({ x: p.x - nn.x * (right[i] ?? 0), y: p.y - nn.y * (right[i] ?? 0) });
    });
    const a = pts[0];
    const z = pts[pts.length - 1];
    const closed = a && z && Math.hypot(a.x - z.x, a.y - z.y) < 1e-6;
    if (!round || closed || pts.length < 2) return [...l, ...r.reverse()];
    // The normal is the direction of travel turned a quarter: sweeping from the left side to the
    // right through the direction of travel rounds the end, and back through the reverse rounds the start.
    const arc = (at: Pt, nn: Pt, radius: number, from: number, sweep: number) => {
        const out: Pt[] = [];
        const base = Math.atan2(nn.y, nn.x) + from;
        for (let k = 1; k < 8; k++) {
            const a = base + (sweep * k) / 8;
            out.push({ x: at.x + Math.cos(a) * radius, y: at.y + Math.sin(a) * radius });
        }
        return out;
    };
    const last = pts.length - 1;
    const endCap = arc(pts[last] as Pt, n[last] as Pt, ((left[last] ?? 0) + (right[last] ?? 0)) / 2, 0, -Math.PI);
    const startCap = arc(pts[0] as Pt, n[0] as Pt, ((left[0] ?? 0) + (right[0] ?? 0)) / 2, Math.PI, -Math.PI);
    return [...l, ...endCap, ...r.reverse(), ...startCap];
}

// The stroke's width multiplier at t (its width profile, when it has one).
function profileOf(node: SceneNode): (t: number) => number {
    const points = node.type === "vector" && !node.dynamicStroke ? widthPointsOf(node) : null;
    return points ? (t) => Math.max(0, widthAt(points, t)) : () => 1;
}

// ---- Dynamic strokes ---------------------------------------------------------------------------

function dynamicPolygons(node: SceneNode, pieces: StrokePiece[], d: DynamicStroke): Pt[][] {
    const seed = hashString(node.id);
    const weight = node.strokeWidth;
    const freq = Math.max(0.01, Math.min(20, d.frequency));
    const wiggle = Math.max(0, d.wiggle);
    const smooth = Math.max(0, Math.min(1, d.smoothen));
    // Two octaves; smoothen fades out the finer one.
    const wave = (s: number, salt: number) => {
        const x = (s * freq) / 160;
        return (noise(seed + salt, x) + (1 - smooth) * 0.5 * noise(seed + salt + 7, x * 3.1)) / (1 + (1 - smooth) * 0.5);
    };
    const round = (node.strokeCap ?? "round") === "round";
    let offset = 0;
    return pieces.map(({ pts }) => {
        const s = arcLengths(pts).map((v) => v + offset);
        offset = (s[s.length - 1] ?? offset) + 1;
        const n = normals(pts);
        const moved = pts.map((p, i) => {
            const shift = wave(s[i] ?? 0, 11) * wiggle * weight * 0.5;
            return { x: p.x + (n[i]?.x ?? 0) * shift, y: p.y + (n[i]?.y ?? 0) * shift };
        });
        const half = pts.map((_, i) => (weight / 2) * Math.max(0.15, 1 + wave(s[i] ?? 0, 29) * Math.min(0.5, 0.2 + wiggle * 0.15)));
        return band(moved, half, half, round);
    });
}

// ---- Brushes -----------------------------------------------------------------------------------

export interface BrushPreset {
    id: string;
    name: string;
    stroke: BrushStroke;
}

// The stretch brushes, each a look of its own drawn below (older files' bristle, dry, rough, nib
// and inkpool strokes still draw as they did).
const stretch = (id: string, name: string): BrushPreset => ({ id, name, stroke: { type: "stretch", name: id, direction: "forward" } });

export const STRETCH_BRUSHES: BrushPreset[] = [
    stretch("pencil", "Pencil"),
    stretch("marker", "Marker"),
    stretch("chalk", "Chalk"),
    stretch("crayon", "Crayon"),
    stretch("watercolour", "Watercolour"),
    stretch("inkpool", "Ink"),
    stretch("felttip", "Felt tip"),
    stretch("nib", "Calligraphy"),
    stretch("airbrush", "Airbrush"),
    stretch("ribbon", "Ribbon"),
    stretch("dotted", "Dotted"),
    stretch("dashed", "Dashed"),
    stretch("zigzag", "Zigzag"),
    stretch("wave", "Wave"),
    stretch("rope", "Rope"),
];

export const SCATTER_BRUSHES: BrushPreset[] = [
    { id: "confetti", name: "Confetti", stroke: { type: "scatter", name: "confetti", gap: 0.9, wiggle: 1.2, sizeJitter: 1, angularJitter: 180, rotation: 0 } },
    { id: "stars", name: "Stars", stroke: { type: "scatter", name: "star", gap: 1.2, wiggle: 0.3, sizeJitter: 0.8, angularJitter: 40, rotation: 0 } },
    { id: "sparkles", name: "Sparkles", stroke: { type: "scatter", name: "sparkle", gap: 1.5, wiggle: 0.8, sizeJitter: 1.2, angularJitter: 20, rotation: 0 } },
    { id: "hearts", name: "Hearts", stroke: { type: "scatter", name: "heart", gap: 1.3, wiggle: 0.2, sizeJitter: 0.5, angularJitter: 15, rotation: 0 } },
    { id: "leaves", name: "Leaves", stroke: { type: "scatter", name: "leaf", gap: 0.8, wiggle: 0, sizeJitter: 0.4, angularJitter: 25, rotation: 45 } },
    { id: "bubbles", name: "Bubbles", stroke: { type: "scatter", name: "bubble", gap: 1.1, wiggle: 0.9, sizeJitter: 1.4, angularJitter: 180, rotation: 0 } },
    { id: "dots", name: "Dots", stroke: { type: "scatter", name: "dot", gap: 1.6, wiggle: 0, sizeJitter: 0, angularJitter: 0, rotation: 0 } },
    { id: "squares", name: "Squares", stroke: { type: "scatter", name: "square", gap: 1.4, wiggle: 0, sizeJitter: 0, angularJitter: 0, rotation: 0 } },
    { id: "triangles", name: "Triangles", stroke: { type: "scatter", name: "triangle", gap: 1.3, wiggle: 0.1, sizeJitter: 0.3, angularJitter: 30, rotation: 0 } },
    { id: "flowers", name: "Flowers", stroke: { type: "scatter", name: "flower", gap: 1.2, wiggle: 0.4, sizeJitter: 0.6, angularJitter: 180, rotation: 0 } },
];

export const BRUSH_PRESETS = [...STRETCH_BRUSHES, ...SCATTER_BRUSHES];

export function brushPresetOf(stroke: BrushStroke | null | undefined): BrushPreset | null {
    if (!stroke) return null;
    if (stroke.type === "stretch") return STRETCH_BRUSHES.find((b) => b.stroke.name === stroke.name) ?? null;
    return SCATTER_BRUSHES.find((b) => b.stroke.name === stroke.name && b.stroke.gap === stroke.gap && b.stroke.wiggle === stroke.wiggle) ?? SCATTER_BRUSHES.find((b) => b.stroke.name === stroke.name) ?? null;
}

// Scatter shapes in a unit box centred on 0, pointing along +x.
const SHAPES: Record<string, Pt[]> = (() => {
    const ring = (n: number, r: (a: number, i: number) => number) => Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const rr = r(a, i);
        return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
    });
    const heart = Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2;
        const x = 16 * Math.sin(a) ** 3;
        const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        return { x: x / 34, y: y / 34 + 0.05 };
    });
    const leaf = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 * Math.abs(Math.sin(a)) ** 0.2 * 0.45 };
    });
    // A bubble: a thick ring open at one side (its highlight), so it reads as an outline.
    const bubble = (() => {
        const out: Pt[] = [];
        const n = 28;
        for (let i = 0; i <= n; i++) {
            const a = 0.35 + (i / n) * (Math.PI * 2 - 0.7);
            out.push({ x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 });
        }
        for (let i = n; i >= 0; i--) {
            const a = 0.35 + (i / n) * (Math.PI * 2 - 0.7);
            out.push({ x: Math.cos(a) * 0.36, y: Math.sin(a) * 0.36 });
        }
        return out;
    })();
    return {
        dot: ring(16, () => 0.5),
        star: ring(10, (_a, i) => (i % 2 ? 0.21 : 0.5)).map((p) => ({ x: p.y, y: -p.x })),
        sparkle: ring(16, (_a, i) => (i % 4 === 0 ? 0.5 : i % 2 ? 0.1 : 0.14)),
        leaf,
        heart,
        bubble,
        // A five-petal rosette.
        flower: ring(40, (a) => 0.5 * (0.62 + 0.38 * Math.cos(a * 5))),
        triangle: ring(3, () => 0.5).map((p) => ({ x: p.x, y: p.y })),
        square: [
            { x: -0.4, y: -0.4 },
            { x: 0.4, y: -0.4 },
            { x: 0.4, y: 0.4 },
            { x: -0.4, y: 0.4 },
        ],
        confetti: [
            { x: -0.5, y: -0.3 },
            { x: 0.5, y: -0.3 },
            { x: 0.5, y: 0.3 },
            { x: -0.5, y: 0.3 },
        ],
    };
})();

export const SCATTER_SHAPES = Object.keys(SHAPES);

function scatterPolygons(node: SceneNode, pieces: StrokePiece[], b: BrushStroke): Pt[][] {
    const rand = random(hashString(node.id));
    const weight = Math.max(0.5, node.strokeWidth);
    const width = profileOf(node);
    const shapes = b.custom?.polys.length ? b.custom.polys : [SHAPES[b.name] ?? SHAPES.dot ?? []];
    const step = Math.max(0.25, b.gap ?? 1) * weight;
    const out: Pt[][] = [];
    let carry = 0;
    for (const { pts, t } of pieces) {
        const d = arcLengths(pts);
        const len = d[d.length - 1] ?? 0;
        let at = carry;
        let i = 1;
        while (at <= len && pts.length > 1) {
            while (i < pts.length - 1 && (d[i] ?? 0) < at) i++;
            const a = pts[i - 1] as Pt;
            const c = pts[i] as Pt;
            const d0 = d[i - 1] ?? 0;
            const d1 = d[i] ?? 0;
            const f = d1 > d0 ? Math.max(0, Math.min(1, (at - d0) / (d1 - d0))) : 0;
            const p = { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f };
            const tt = (t[i - 1] ?? 0) + ((t[i] ?? 0) - (t[i - 1] ?? 0)) * f;
            const heading = Math.atan2(c.y - a.y, c.x - a.x);
            const jitterSize = Math.max(0.08, 1 + (b.sizeJitter ?? 0) * (rand() * 2 - 1) * 0.33);
            const size = weight * width(tt) * jitterSize;
            const angle = heading + (((b.rotation ?? 0) + (b.angularJitter ?? 0) * (rand() * 2 - 1)) * Math.PI) / 180;
            const off = (b.wiggle ?? 0) * weight * (rand() * 2 - 1) * 0.5;
            const cx = p.x - Math.sin(heading) * off;
            const cy = p.y + Math.cos(heading) * off;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            if (size > 0.01) for (const shape of shapes) out.push(shape.map((q) => ({ x: cx + (q.x * cos - q.y * sin) * size, y: cy + (q.x * sin + q.y * cos) * size })));
            at += step;
        }
        carry = Math.max(0, at - len);
    }
    return out;
}

// A custom stretch brush: its outline bent along each piece of the stroke, its length to the
// piece's length and its height to the stroke's width there.
function stretchCustom(node: SceneNode, pieces: StrokePiece[], polys: Pt[][], back: boolean): Pt[][] {
    const weight = node.strokeWidth;
    const width = profileOf(node);
    // Long, straight edges are split so the shape follows the curve.
    const dense = polys.map((poly) => {
        const out: Pt[] = [];
        poly.forEach((a, i) => {
            const b = poly[(i + 1) % poly.length] as Pt;
            const n = Math.max(1, Math.ceil(Math.abs(b.x - a.x) / 0.01));
            for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
        });
        return out;
    });
    const result: Pt[][] = [];
    for (const { pts, t } of pieces) {
        if (pts.length < 2) continue;
        const d = arcLengths(pts);
        const len = d[d.length - 1] ?? 0;
        if (len <= 0) continue;
        const at = (u: number) => {
            const target = Math.max(0, Math.min(1, back ? 1 - u : u)) * len;
            let i = 1;
            while (i < pts.length - 1 && (d[i] ?? 0) < target) i++;
            const a = pts[i - 1] as Pt;
            const c = pts[i] as Pt;
            const d0 = d[i - 1] ?? 0;
            const d1 = d[i] ?? 0;
            const f = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
            const seg = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            const dir = back ? -1 : 1;
            return { p: { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f }, n: { x: (-(c.y - a.y) / seg) * dir, y: ((c.x - a.x) / seg) * dir }, t: (t[i - 1] ?? 0) + ((t[i] ?? 0) - (t[i - 1] ?? 0)) * f };
        };
        for (const poly of dense) {
            result.push(
                poly.map((q) => {
                    const { p, n, t: tt } = at(q.x);
                    const h = weight * width(tt);
                    return { x: p.x + n.x * q.y * h, y: p.y + n.y * q.y * h };
                }),
            );
        }
    }
    return result;
}

function stretchPolygons(node: SceneNode, pieces: StrokePiece[], b: BrushStroke): Pt[][] {
    if (b.custom?.polys.length) return stretchCustom(node, pieces, b.custom.polys, b.direction === "backward");
    const seed = hashString(node.id);
    const weight = node.strokeWidth;
    const width = profileOf(node);
    const back = b.direction === "backward";
    const round = (node.strokeCap ?? "round") === "round";
    const out: Pt[][] = [];
    pieces.forEach(({ pts, t }, pi) => {
        const along = t.map((v) => (back ? 1 - v : v));
        const s = arcLengths(pts);
        const half = pts.map((_, i) => (weight / 2) * width(t[i] ?? 0));
        const n = normals(pts);
        const len = s[s.length - 1] ?? 0;
        // The point and normal at a distance along the piece.
        const at = (d: number) => {
            let i = 1;
            while (i < pts.length - 1 && (s[i] ?? 0) < d) i++;
            const a = pts[i - 1] as Pt;
            const c = pts[i] as Pt;
            const d0 = s[i - 1] ?? 0;
            const d1 = s[i] ?? 0;
            const f = d1 > d0 ? Math.max(0, Math.min(1, (d - d0) / (d1 - d0))) : 0;
            const na = n[i - 1] as Pt;
            const nc = n[i] as Pt;
            return { p: { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f }, n: { x: na.x + (nc.x - na.x) * f, y: na.y + (nc.y - na.y) * f }, h: (half[i - 1] ?? 0) + ((half[i] ?? 0) - (half[i - 1] ?? 0)) * f };
        };
        if (b.name === "pencil") {
            // A hard, thin line with a lightly grained edge.
            const left = half.map((h, i) => h * 0.55 * (1 + 0.18 * noise(seed + pi, (s[i] ?? 0) / Math.max(1, weight * 0.25))));
            const right = half.map((h, i) => h * 0.55 * (1 + 0.18 * noise(seed + pi + 5, (s[i] ?? 0) / Math.max(1, weight * 0.25))));
            out.push(band(pts, left, right, round));
            return;
        }
        if (b.name === "marker") {
            // A flat, even band with squared ends.
            out.push(band(pts, half.map((h) => h * 0.95), half.map((h) => h * 0.95), false));
            return;
        }
        if (b.name === "chalk") {
            // Grainy strands that break up along the stroke.
            const strands = 9;
            for (let k = 0; k < strands; k++) {
                const across = (k / (strands - 1)) * 2 - 1;
                const strandSeed = seed + k * 131 + pi * 7;
                const centre: Pt[] = [];
                const w: number[] = [];
                pts.forEach((p, i) => {
                    const h = half[i] ?? 0;
                    const offset = across * h * 0.9;
                    centre.push({ x: p.x + (n[i]?.x ?? 0) * offset, y: p.y + (n[i]?.y ?? 0) * offset });
                    const grain = noise(strandSeed, (s[i] ?? 0) / Math.max(1.5, weight * 0.3));
                    w.push(Math.max(0, grain + 0.35) * (h / strands) * 1.6);
                });
                out.push(band(centre, w, w, false));
            }
            return;
        }
        if (b.name === "crayon") {
            // Waxy: a solid core with a jagged, broken edge.
            const left = half.map((h, i) => h * (0.75 + 0.3 * Math.abs(noise(seed + pi, (s[i] ?? 0) / Math.max(1, weight * 0.2)))));
            const right = half.map((h, i) => h * (0.75 + 0.3 * Math.abs(noise(seed + pi + 9, (s[i] ?? 0) / Math.max(1, weight * 0.2)))));
            out.push(band(pts, left, right, round));
            return;
        }
        if (b.name === "watercolour") {
            // Soft, swelling edges: two overlapping washes of different widths.
            for (const [salt, k] of [[1, 1.15], [17, 0.8]] as const) {
                const left = half.map((h, i) => h * k * (1 + 0.35 * noise(seed + pi + salt, (s[i] ?? 0) / Math.max(4, weight * 1.5))));
                const right = half.map((h, i) => h * k * (1 + 0.35 * noise(seed + pi + salt + 3, (s[i] ?? 0) / Math.max(4, weight * 1.5))));
                out.push(band(pts, left, right, true));
            }
            return;
        }
        if (b.name === "felttip") {
            // Five tightly packed tips, each a touch different in width.
            const strands = 5;
            for (let k = 0; k < strands; k++) {
                const across = (k / (strands - 1)) * 2 - 1;
                const centre = pts.map((p, i) => ({ x: p.x + (n[i]?.x ?? 0) * across * (half[i] ?? 0) * 0.78, y: p.y + (n[i]?.y ?? 0) * across * (half[i] ?? 0) * 0.78 }));
                const w = half.map((h, i) => (h / strands) * (1.1 + 0.25 * noise(seed + k * 7, (s[i] ?? 0) / Math.max(3, weight))));
                out.push(band(centre, w, w, true));
            }
            return;
        }
        if (b.name === "airbrush") {
            // A soft, feathered spray: many fine strands of random length and offset.
            const strands = 22;
            const rand = random(seed + pi * 13);
            for (let k = 0; k < strands; k++) {
                const across = rand() * 2 - 1;
                const from = rand() * len;
                const length = (0.15 + rand() * 0.5) * len;
                const centre: Pt[] = [];
                const w: number[] = [];
                const steps = Math.max(2, Math.ceil(length / Math.max(2, weight / 2)));
                for (let i = 0; i <= steps; i++) {
                    const d = from + (length * i) / steps;
                    if (d > len) break;
                    const { p, n: nn, h } = at(d);
                    const spread = across * h * 1.1;
                    centre.push({ x: p.x + nn.x * spread, y: p.y + nn.y * spread });
                    // Thin and faint toward the edges of the spray.
                    w.push(Math.max(0.1, h * 0.12 * (1 - Math.abs(across) * 0.8) * Math.sin((i / steps) * Math.PI)));
                }
                if (centre.length > 1) out.push(band(centre, w, w, true));
            }
            return;
        }
        if (b.name === "ribbon") {
            // A twisting ribbon: its width goes thin where it turns over.
            const w = half.map((h, i) => h * (0.12 + 0.88 * Math.abs(Math.cos(((s[i] ?? 0) / Math.max(8, weight * 3)) * Math.PI))));
            out.push(band(pts, w, w, false));
            return;
        }
        if (b.name === "dotted" || b.name === "dashed") {
            const dash = b.name === "dotted" ? weight : weight * 2.5;
            const gap = b.name === "dotted" ? weight * 0.9 : weight * 1.2;
            for (let d = 0; d < len; d += dash + gap) {
                if (b.name === "dotted") {
                    const { p, h } = at(d + dash / 2);
                    out.push(Array.from({ length: 16 }, (_, k) => ({ x: p.x + Math.cos((k / 16) * Math.PI * 2) * h, y: p.y + Math.sin((k / 16) * Math.PI * 2) * h })));
                    continue;
                }
                const to = Math.min(len, d + dash);
                const steps = Math.max(1, Math.ceil((to - d) / Math.max(2, weight / 2)));
                const seg: Pt[] = [];
                const w: number[] = [];
                for (let i = 0; i <= steps; i++) {
                    const { p, h } = at(d + ((to - d) * i) / steps);
                    seg.push(p);
                    w.push(h);
                }
                out.push(band(seg, w, w, round));
            }
            return;
        }
        if (b.name === "zigzag" || b.name === "wave") {
            // The centre line swings across the stroke; the band follows it.
            const period = Math.max(8, weight * 4);
            const centre = pts.map((p, i) => {
                const u = (s[i] ?? 0) / period;
                const swing = b.name === "wave" ? Math.sin(u * Math.PI * 2) : 2 * Math.abs(2 * (u - Math.floor(u + 0.5))) - 1;
                const off = swing * (half[i] ?? 0) * 0.8;
                return { x: p.x + (n[i]?.x ?? 0) * off, y: p.y + (n[i]?.y ?? 0) * off };
            });
            const w = half.map((h) => h * 0.35);
            out.push(band(centre, w, w, round));
            return;
        }
        if (b.name === "rope") {
            // Two strands twisted around each other.
            const period = Math.max(6, weight * 2.2);
            for (const phase of [0, Math.PI]) {
                const centre = pts.map((p, i) => {
                    const off = Math.sin(((s[i] ?? 0) / period) * Math.PI * 2 + phase) * (half[i] ?? 0) * 0.5;
                    return { x: p.x + (n[i]?.x ?? 0) * off, y: p.y + (n[i]?.y ?? 0) * off };
                });
                const w = half.map((h, i) => h * (0.3 + 0.2 * Math.abs(Math.cos(((s[i] ?? 0) / period) * Math.PI * 2 + phase))));
                out.push(band(centre, w, w, true));
            }
            return;
        }
        if (b.name === "rough" || b.name === "inkpool") {
            const amount = b.name === "rough" ? 0.28 : 0.12;
            const scale = b.name === "rough" ? weight * 0.35 : weight * 2;
            const swell = (i: number) => (b.name === "inkpool" ? 1 + 0.5 * Math.exp(-(((along[i] ?? 0) / 0.06) ** 2)) - 0.35 * (along[i] ?? 0) : 1);
            const left = half.map((h, i) => h * swell(i) * (1 + amount * noise(seed + pi, (s[i] ?? 0) / Math.max(1, scale))));
            const right = half.map((h, i) => h * swell(i) * (1 + amount * noise(seed + pi + 5, (s[i] ?? 0) / Math.max(1, scale))));
            out.push(band(pts, left, right, round));
            return;
        }
        if (b.name === "nib") {
            // A flat nib held at 45 degrees: thick across it, thin along it.
            const n = normals(pts);
            const w = half.map((h, i) => {
                const nn = n[i] as Pt;
                const heading = Math.atan2(nn.x, -nn.y);
                return h * (0.12 + 0.88 * Math.abs(Math.sin(heading - Math.PI / 4)));
            });
            out.push(band(pts, w, w, false));
            return;
        }
        // Bristles: thin strands across the width that run dry along the stroke.
        const strands = b.name === "dry" ? 14 : 11;
        const dry = b.name === "dry" ? 0.8 : 0.35;
        for (let k = 0; k < strands; k++) {
            const across = (k / (strands - 1)) * 2 - 1;
            const strandSeed = seed + k * 101 + pi * 7;
            const n = normals(pts);
            const centre: Pt[] = [];
            const w: number[] = [];
            pts.forEach((p, i) => {
                const h = half[i] ?? 0;
                const offset = across * h * 0.86 + noise(strandSeed, (s[i] ?? 0) / Math.max(4, weight * 2)) * h * 0.08;
                centre.push({ x: p.x + (n[i]?.x ?? 0) * offset, y: p.y + (n[i]?.y ?? 0) * offset });
                // Paint thins along the stroke; noise breaks the strand where it runs out.
                const paint = 1 - dry * (along[i] ?? 0) * (0.6 + 0.4 * Math.abs(across)) + 0.7 * noise(strandSeed + 3, (s[i] ?? 0) / Math.max(6, weight * 2));
                const ink = Math.max(0, Math.min(1, (paint - 0.25) * 1.6));
                w.push(ink * (h / strands) * (0.7 + 0.5 * hash2(strandSeed, 1)));
            });
            out.push(band(centre, w, w, false));
        }
    });
    return out;
}

// The styled stroke as filled polygons (all wound the same way), or null for a basic stroke.
export function styledStrokePolygons(node: SceneNode, pieces: StrokePiece[]): Pt[][] | null {
    if (node.strokeWidth <= 0) return null;
    let polys: Pt[][] | null = null;
    if (node.brushStroke?.type === "scatter") polys = scatterPolygons(node, pieces, node.brushStroke);
    else if (node.brushStroke?.type === "stretch") polys = stretchPolygons(node, pieces, node.brushStroke);
    else if (node.dynamicStroke) polys = dynamicPolygons(node, pieces, node.dynamicStroke);
    if (!polys) return null;
    return polys.filter((p) => p.length > 2).map((p) => (signedArea(p) < 0 ? [...p].reverse() : p));
}

// The styled stroke as closed subpaths (in the layer's parent space), for export.
export function styledStrokeSubpaths(node: SceneNode): Subpath[] {
    const outline = outlineOf(node);
    const pieces = outline.lines.filter((l) => l.pts.length > 1).map(({ pts, d }) => ({ pts, t: d.map((v) => v / outline.total) }));
    return (styledStrokePolygons(node, pieces) ?? []).map((poly) => ({ closed: true, points: poly.map((p) => ({ x: p.x, y: p.y, in: null, out: null })) }));
}

// ---- Width profiles ----------------------------------------------------------------------------

export type ProfileId = "uniform" | "wedge" | "taper" | "eye" | "quarter" | "mirrored";

export const WIDTH_PROFILES: { id: ProfileId; label: string; points: WidthPoint[] | null }[] = [
    { id: "uniform", label: "Uniform", points: null },
    { id: "wedge", label: "Wedge", points: [{ t: 0, w: 1 }, { t: 1, w: 0 }] },
    { id: "taper", label: "Taper", points: [{ t: 0, w: 1 }, { t: 1, w: 0.25 }] },
    { id: "eye", label: "Eye", points: [{ t: 0, w: 0 }, { t: 0.5, w: 1 }, { t: 1, w: 0 }] },
    { id: "quarter", label: "Quarter taper", points: [{ t: 0, w: 0.25 }, { t: 0.25, w: 1 }, { t: 1, w: 0.25 }] },
    { id: "mirrored", label: "Mirrored taper", points: [{ t: 0, w: 0.25 }, { t: 0.5, w: 1 }, { t: 1, w: 0.25 }] },
];

// Which preset a layer's width points match ("custom" when edited by hand).
export function profileIdOf(node: SceneNode): ProfileId | "custom" {
    const points = widthPointsOf(node);
    if (!points || points.every((p) => Math.abs(p.w - 1) < 1e-3)) return "uniform";
    for (const preset of WIDTH_PROFILES) {
        const want = preset.points;
        if (!want || want.length !== points.length) continue;
        if (want.every((p, i) => Math.abs(p.t - (points[i]?.t ?? -1)) < 1e-3 && Math.abs(p.w - (points[i]?.w ?? -1)) < 1e-3)) return preset.id;
    }
    return "custom";
}

// The profile reversed along the path.
export function flipWidthPoints(points: WidthPoint[]): WidthPoint[] {
    return points.map((p) => ({ t: Math.round((1 - p.t) * 1e6) / 1e6, w: p.w })).sort((a, b) => a.t - b.t);
}

// A width profile drawn as a filled bar in a w×h box (SVG path data).
export function profilePreviewPath(points: WidthPoint[] | null, w = 64, h = 12, pad = 2): string {
    const n = 40;
    const top: string[] = [];
    const bottom: string[] = [];
    const max = Math.max(1, ...(points ?? []).map((p) => p.w));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = pad + t * (w - pad * 2);
        const r = ((points ? Math.max(0, widthAt(points, t)) : 1) / max) * (h / 2 - 0.5);
        top.push(`${x.toFixed(2)} ${(h / 2 - r).toFixed(2)}`);
        bottom.push(`${x.toFixed(2)} ${(h / 2 + r).toFixed(2)}`);
    }
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
}

// A styled stroke drawn along a gentle wave in a w×h box (SVG path data), for menus and pickers.
export function strokePreviewPath(style: { brushStroke?: BrushStroke | null; dynamicStroke?: DynamicStroke | null }, w = 120, h = 20, weight = 6): string {
    const n = 64;
    const pts: Pt[] = [];
    const t: number[] = [];
    for (let i = 0; i <= n; i++) {
        const f = i / n;
        pts.push({ x: weight + f * (w - weight * 2), y: h / 2 + Math.sin(f * Math.PI * 2) * (h / 2 - weight * 0.9) * 0.6 });
        t.push(f);
    }
    const node = { id: "preview", type: "vector", strokeWidth: weight, strokeCap: "round", ...style } as SceneNode;
    const polys = styledStrokePolygons(node, [{ pts, t }]) ?? [];
    return polys.map((poly) => `M${poly.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L")} Z`).join(" ");
}

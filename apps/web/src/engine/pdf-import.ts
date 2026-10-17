import { nanoid } from "nanoid";
import type { PdfDocument } from "../engines/pdf-engine";
import { DEFAULT_FAMILY, loadFont } from "./fonts";
import { storeDataUrl } from "./image-store";
import { makeNode } from "./nodes";
import { solid } from "./paint";
import { parsePathData } from "./svg-import";
import { clearLayoutCache, layoutText } from "./text-layout";
import { textSize } from "./text";
import type { BlendMode, Command, GradientPaint, ImagePaint, NagmaDocument, Paint, PathPoint, SceneNode, Subpath, TextSpan } from "./types";

// A PDF page as editable layers, like the reference's PDF import: text as text layers (lines that belong
// together joined into one paragraph), drawn shapes as vectors and rectangles, and pictures as
// image layers, in the page's paint order. The page's content comes from the PDF engine
// (engines/pdf-wasm/src/extract.rs) in points, origin at the page's top-left, y down.

type RGBA = [number, number, number, number];
type FillJson = { solid: RGBA } | { type: "linear" | "radial"; from: [number, number]; to: [number, number]; r0?: number; stops: [number, RGBA][] };

interface PathItem {
    t: "path";
    d: string;
    bbox: [number, number, number, number];
    rect?: [number, number, number, number];
    fill: FillJson | null;
    evenOdd: boolean;
    stroke?: { paint: FillJson; width: number; cap: "butt" | "round" | "square"; join: "miter" | "round" | "bevel"; dash: number[] };
    opacity: number;
    blend: string;
    clip: number | null;
    glyphs?: boolean;
}

interface ImageItem {
    t: "image";
    image: number;
    m: [number, number, number, number, number, number];
    opacity: number;
    blend: string;
    clip: number | null;
}

interface TextItem {
    t: "text";
    text: string;
    font: number;
    size: number;
    color: RGBA;
    x: number;
    y: number;
    angle: number;
    hscale: number;
    width: number;
    tracking: number;
    opacity: number;
    blend: string;
    stroke?: { color: RGBA; width: number };
}

type Item = PathItem | ImageItem | TextItem;

interface FontJson {
    name: string;
    family: string | null;
    weight: number | null;
    italic: boolean;
    bold: boolean;
    serif: boolean;
    fixed: boolean;
}

export interface PageContentJson {
    width: number;
    height: number;
    fonts: FontJson[];
    clips: { d: string; evenOdd: boolean }[];
    items: Item[];
}

interface Face {
    family: string;
    weight: number;
    italic: boolean;
}

// ---------------------------------------------------------------------------------------------
// Fonts: the PDF's font name to a family that can draw it here.

const WEIGHTS: [RegExp, number][] = [
    [/(extra|ultra)\s*black|heavy\s*black/i, 950],
    [/black|heavy/i, 900],
    [/(extra|ultra)\s*bold/i, 800],
    [/(semi|demi)\s*bold|demi\b/i, 600],
    [/bold/i, 700],
    [/medium/i, 500],
    [/(extra|ultra)\s*light/i, 200],
    [/thin|hairline/i, 100],
    [/light/i, 300],
    [/book|regular|normal|roman/i, 400],
];

const STYLE_WORDS = /(extra|ultra|semi|demi)?(black|heavy|bold|medium|light|thin|hairline|book|regular|normal|roman|italic|oblique|it|condensed|cond|narrow)$/i;

// Metric-compatible stand-ins (served by Google Fonts) for common fonts that aren't on this computer.
const ALIASES: Record<string, string> = {
    arial: "Arimo",
    helvetica: "Arimo",
    helveticaneue: "Inter",
    timesnewroman: "Tinos",
    times: "Tinos",
    timesroman: "Tinos",
    courier: "Cousine",
    couriernew: "Cousine",
    calibri: "Carlito",
    cambria: "Caladea",
    georgia: "Gelasio",
    segoeui: "Open Sans",
    verdana: "PT Sans",
    tahoma: "PT Sans",
    garamond: "EB Garamond",
    palatino: "Domine",
    bookantiqua: "Domine",
    futura: "Jost",
    gillsans: "Lato",
    avenir: "Nunito Sans",
    avenirnext: "Nunito Sans",
    myriadpro: "PT Sans",
    minionpro: "Crimson Pro",
    sfprotext: "Inter",
    sfprodisplay: "Inter",
    sfpro: "Inter",
    symbol: "Noto Sans Symbols",
    zapfdingbats: "Noto Sans Symbols 2",
};

function spaced(name: string): string {
    return name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-zA-Z])(\d)/g, "$1 $2")
        .replace(/[_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Family, weight and italic read from a PostScript name like "TimesNewRomanPS-BoldItalicMT".
export function parseFontName(font: { name: string; family?: string | null; weight?: number | null; italic?: boolean; bold?: boolean }): Face {
    const raw = font.name.replace(/^[A-Z]{6}\+/, "");
    let [familyPart = "", ...rest] = raw.split(/[-,]/);
    let style = rest.join(" ");
    familyPart = familyPart.replace(/(PSMT|PS|MT|Std|LT|Pro)$/g, (m) => (m === "Pro" ? m : ""));
    // Style words glued to the family ("MontserratSemiBold").
    // (Except where the word belongs to the family: "TimesNewRoman" is Times New Roman, not a
    // "Roman" style of "Times New".)
    for (let i = 0; i < 3; i++) {
        if (/TimesNewRoman$/i.test(familyPart)) break;
        const m = STYLE_WORDS.exec(familyPart);
        if (!m || m.index === 0) break;
        style = `${m[0]} ${style}`;
        familyPart = familyPart.slice(0, m.index);
    }
    style = style.replace(/MT$/, "");
    const family = (font.family?.trim() || spaced(familyPart) || "Inter").replace(/\s+(MT|PS)$/i, "");
    let weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? font.weight ?? 400;
    if (font.bold && weight < 600) weight = 700;
    const italic = /italic|oblique|(^|[^a-z])it($|[^a-z])/i.test(style) || /italic|oblique/i.test(raw) || Boolean(font.italic);
    return { family, weight: Math.min(900, weight), italic };
}

const resolved = new Map<string, Promise<string>>();

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function available(family: string): Promise<boolean> {
    if (family === DEFAULT_FAMILY) return true;
    return (await withTimeout(loadFont(family), 6000, "missing")) === "ready";
}

// The family to draw a PDF font with: its own when Google Fonts or this computer has it, else a
// metric-compatible stand-in, else Inter, Source Serif 4 or a monospace by the font's class.
function resolveFamily(face: Face, font: FontJson): Promise<string> {
    const key = `${face.family}|${font.serif}|${font.fixed}`;
    let hit = resolved.get(key);
    if (!hit) {
        hit = (async () => {
            if (await available(face.family)) return face.family;
            const compact = face.family.toLowerCase().replace(/[^a-z]/g, "");
            const alias = ALIASES[compact] ?? Object.entries(ALIASES).find(([k]) => compact.startsWith(k))?.[1];
            if (alias && (await available(alias))) return alias;
            const lower = face.family.toLowerCase();
            if (font.fixed || /mono|courier|code|consol/.test(lower)) return (await available("Roboto Mono")) ? "Roboto Mono" : DEFAULT_FAMILY;
            if (font.serif || /serif|times|roman|garamond|georgia|minion|baskerville|bodoni|caslon|didot/.test(lower)) return (await available("Source Serif 4")) ? "Source Serif 4" : DEFAULT_FAMILY;
            return DEFAULT_FAMILY;
        })();
        resolved.set(key, hit);
    }
    return hit;
}

// Makes sure the faces in use are loaded, so text measures as it will draw.
async function loadFaces(faces: { face: Face; sample: string }[]) {
    if (typeof document === "undefined" || !document.fonts) return;
    const seen = new Set<string>();
    const loads: Promise<unknown>[] = [];
    for (const { face, sample } of faces) {
        const css = `${face.italic ? "italic " : ""}${face.weight} 16px "${face.family}"`;
        const key = `${css}|${sample}`;
        if (seen.has(key)) continue;
        seen.add(key);
        loads.push(document.fonts.load(css, sample || "A").catch(() => undefined));
    }
    await withTimeout(Promise.all(loads), 8000, []);
    clearLayoutCache();
}

// ---------------------------------------------------------------------------------------------
// Paints and geometry.

function hex(c: RGBA): string {
    const h = (v: number) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
    return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

const BLENDS = new Set(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
function blendOf(b: string): BlendMode {
    return BLENDS.has(b) ? (b as BlendMode) : "normal";
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function paintOf(fill: FillJson, box: Box): Paint {
    if ("solid" in fill) return solid(hex(fill.solid), fill.solid[3]);
    const fx = (x: number) => (box.w ? (x - box.x) / box.w : 0);
    const fy = (y: number) => (box.h ? (y - box.y) / box.h : 0);
    const stops = fill.stops.map(([position, c]) => ({ position, color: hex(c), opacity: c[3] }));
    const paint: GradientPaint = {
        type: fill.type,
        stops,
        from: { x: fx(fill.from[0]), y: fy(fill.from[1]) },
        to: { x: fx(fill.to[0]), y: fy(fill.to[1]) },
        opacity: 1,
        visible: true,
        blend: "normal",
    };
    return paint;
}

function boundsOf(subs: Subpath[]): Box | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (p: { x: number; y: number } | null) => {
        if (!p) return;
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
    };
    for (const s of subs)
        for (const p of s.points) {
            add(p);
            add(p.in);
            add(p.out);
        }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function signedArea(points: PathPoint[]): number {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i] as PathPoint;
        const q = points[(i + 1) % points.length] as PathPoint;
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

function inside(pt: { x: number; y: number }, poly: PathPoint[]): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i] as PathPoint;
        const b = poly[j] as PathPoint;
        if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x) c = !c;
    }
    return c;
}

function reversed(sub: Subpath): Subpath {
    const pts = [...sub.points].reverse().map((p) => ({ x: p.x, y: p.y, in: p.out, out: p.in }));
    return { closed: sub.closed, points: pts };
}

// Layers fill with the non-zero rule. For an even-odd path, each closed subpath is turned so that
// nested ones alternate direction: the same holes under either rule (for paths that don't cross
// themselves, which is nearly all of them).
function evenOddToNonZero(subs: Subpath[]): Subpath[] {
    const closed = subs.filter((s) => s.closed && s.points.length > 2);
    if (closed.length < 2 || closed.length > 400) return subs;
    return subs.map((s) => {
        if (!s.closed || s.points.length < 3) return s;
        const probe = s.points[0] as PathPoint;
        let depth = 0;
        for (const o of closed) if (o !== s && inside(probe, o.points)) depth++;
        const ccw = signedArea(s.points) > 0;
        const want = depth % 2 === 0;
        return ccw === want ? s : reversed(s);
    });
}

function rectOf(r: [number, number, number, number]): Box {
    return { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
}

function intersect(a: Box, b: Box): Box | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

function overlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ---------------------------------------------------------------------------------------------
// Images.

const imageIds = new Map<string, string>();

function fingerprint(rgba: Uint8Array, w: number, h: number): string {
    let a = 2166136261;
    const step = Math.max(4, Math.floor(rgba.length / 4096 / 4) * 4);
    for (let i = 0; i < rgba.length; i += step) {
        a ^= rgba[i] ?? 0;
        a = Math.imul(a, 16777619);
        a ^= rgba[i + 1] ?? 0;
        a = Math.imul(a, 16777619);
        a ^= rgba[i + 3] ?? 0;
        a = Math.imul(a, 16777619);
    }
    return `${w}x${h}:${(a >>> 0).toString(36)}`;
}

const MAX_SIDE = 4096;

async function encodeImage(rgba: Uint8Array, width: number, height: number): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    let out = canvas;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    if (scale < 1) {
        out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(width * scale));
        out.height = Math.max(1, Math.round(height * scale));
        out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
    }
    let opaque = true;
    for (let i = 3; i < rgba.length; i += 4)
        if ((rgba[i] ?? 255) < 255) {
            opaque = false;
            break;
        }
    // Photos as JPEG-quality WebP; WebP keeps transparency too, and falls back to PNG.
    return out.toDataURL("image/webp", opaque ? 0.9 : 0.95);
}

// ---------------------------------------------------------------------------------------------
// Text: runs to lines to paragraphs.

interface Run extends TextItem {
    face: Face;
    index: number;
}

interface Line {
    runs: Run[];
    index: number;
    x: number;
    y: number;
    width: number;
    size: number;
    angle: number;
}

function styleKey(r: Run): string {
    return `${r.face.family}|${r.face.weight}|${r.face.italic}|${Math.round(r.size * 10)}|${r.color.join(",")}`;
}

// Runs on one baseline that follow each other become one line.
function buildLines(runs: Run[]): Line[] {
    const lines: Line[] = [];
    let cur: Line | null = null;
    for (const r of runs) {
        if (cur) {
            const last = cur.runs[cur.runs.length - 1] as Run;
            const rad = (cur.angle * Math.PI) / 180;
            const ux = Math.cos(rad);
            const uy = Math.sin(rad);
            const dx = r.x - cur.x;
            const dy = r.y - cur.y;
            const along = dx * ux + dy * uy;
            const across = Math.abs(-dx * uy + dy * ux);
            const end = cur.width;
            const gap = along - end;
            const size = Math.max(last.size, r.size);
            if (Math.abs(r.angle - cur.angle) < 0.5 && across < size * 0.25 && gap > -size * 0.3 && gap < size * 0.4 && r.stroke === undefined && last.stroke === undefined) {
                cur.runs.push(r);
                cur.width = along + r.width;
                cur.size = Math.max(cur.size, r.size);
                continue;
            }
        }
        cur = { runs: [r], index: r.index, x: r.x, y: r.y, width: r.width, size: r.size, angle: r.angle };
        lines.push(cur);
    }
    return lines;
}

interface Block {
    lines: Line[];
    step: number;
}

// Lines that start at the same left edge, one under the other at an even spacing, in the same
// main style, form a paragraph.
function buildBlocks(lines: Line[]): Block[] {
    const blocks: Block[] = [];
    let cur: Block | null = null;
    for (const line of lines) {
        if (cur) {
            const prev = cur.lines[cur.lines.length - 1] as Line;
            const step = line.y - prev.y;
            const size = prev.size;
            const sameStyle = styleKey(line.runs[0] as Run) === styleKey(prev.runs[0] as Run) && Math.abs(line.size - prev.size) < 0.1;
            if (
                cur.lines.length < 200 &&
                line.angle === 0 &&
                prev.angle === 0 &&
                sameStyle &&
                Math.abs(line.x - prev.x) < Math.max(1, size * 0.15) &&
                step > size * 0.95 &&
                step < size * 2.2 &&
                (cur.lines.length === 1 || Math.abs(step - cur.step) < size * 0.08)
            ) {
                if (cur.lines.length === 1) cur.step = step;
                cur.lines.push(line);
                continue;
            }
        }
        cur = { lines: [line], step: 0 };
        blocks.push(cur);
    }
    return blocks;
}

// The text of a line, with spaces where runs sit apart, and each run's character range.
function lineText(line: Line): { text: string; ranges: { run: Run; start: number; end: number }[] } {
    let text = "";
    const ranges: { run: Run; start: number; end: number }[] = [];
    const rad = (line.angle * Math.PI) / 180;
    let end = 0;
    line.runs.forEach((r, i) => {
        if (i > 0) {
            const along = (r.x - line.x) * Math.cos(rad) + (r.y - line.y) * Math.sin(rad);
            if (along - end > r.size * 0.12 && !text.endsWith(" ")) text += " ";
        }
        const start = text.length;
        text += r.text;
        ranges.push({ run: r, start, end: text.length });
        end = (r.x - line.x) * Math.cos(rad) + (r.y - line.y) * Math.sin(rad) + r.width;
    });
    return { text, ranges };
}

function measureLine(node: SceneNode): number {
    const layout = layoutText(node);
    return layout.lines.reduce((w, l) => Math.max(w, l.left + l.width), 0);
}

// ---------------------------------------------------------------------------------------------

export interface BuildContext {
    doc: NagmaDocument;
    commands: Command[];
    // Image ids added in this import (so a picture used on many pages is stored once).
    added: Set<string>;
}

interface Placed {
    box: Box;
}

// Builds a page's layers inside `frame` (the page frame, already in `ctx.commands`) from the
// extracted content. Returns the page's background colour if the content starts with one.
export async function buildPageLayers(pdf: PdfDocument, page: number, frame: SceneNode, ctx: BuildContext): Promise<{ background: string | null }> {
    const content = pdf.content(page);
    let data: PageContentJson;
    const images: (string | null)[] = [];
    try {
        data = JSON.parse(content.json) as PageContentJson;
        // Decode the page's pictures once each.
        const count = data.items.reduce((n, it) => (it.t === "image" ? Math.max(n, it.image + 1) : n), 0);
        for (let i = 0; i < count; i++) {
            const img = content.image(i);
            if (!img) {
                images.push(null);
                continue;
            }
            try {
                const rgba = img.rgba;
                const key = fingerprint(rgba, img.width, img.height);
                let id = imageIds.get(key);
                if (!id || !ctx.doc.images[id]) {
                    if (!id || !ctx.added.has(id)) {
                        id = nanoid(12);
                        ctx.commands.push({ type: "image.add", id, data: await storeDataUrl(await encodeImage(rgba, img.width, img.height)) });
                        ctx.added.add(id);
                        imageIds.set(key, id);
                    }
                }
                images.push(id);
            } finally {
                img.free();
            }
        }
    } finally {
        content.free();
    }
    const ox = frame.x;
    const oy = frame.y;
    const pageBox: Box = { x: 0, y: 0, w: data.width, h: data.height };
    const items = data.items;

    // A page-sized opaque rectangle first is the page's own background.
    let background: string | null = null;
    let startAt = 0;
    const first = items[0];
    if (first?.t === "path" && first.rect && first.fill && "solid" in first.fill && first.fill.solid[3] >= 0.999 && !first.stroke && first.clip === null && first.opacity >= 0.999) {
        const r = rectOf(first.rect);
        if (r.x <= 1 && r.y <= 1 && r.x + r.w >= pageBox.w - 1 && r.y + r.h >= pageBox.h - 1) {
            background = hex(first.fill.solid);
            startAt = 1;
        }
    }
    const bg = background ?? "#FFFFFF";

    // Faces for text, resolved to families that can draw here.
    const faces = data.fonts.map((f) => parseFontName(f));
    const families = await Promise.all(data.fonts.map((f, i) => resolveFamily(faces[i] as Face, f)));
    const runFaces = faces.map((f, i) => ({ ...f, family: families[i] ?? DEFAULT_FAMILY }));
    const samples = new Map<number, string>();
    for (const it of items) if (it.t === "text") samples.set(it.font, `${samples.get(it.font) ?? ""}${it.text}`.slice(0, 200));
    await loadFaces(runFaces.map((face, i) => ({ face, sample: samples.get(i) ?? "" })));

    // Many shapes of one style in a row (charts, hatching, maps) join into one vector, so a dense
    // page stays light to edit.
    const pathCount = items.reduce((n, it) => n + (it.t === "path" ? 1 : 0), 0);
    const merged: Item[] = [];
    for (let i = startAt; i < items.length; i++) {
        const it = items[i] as Item;
        const prev = merged[merged.length - 1];
        if (pathCount > 600 && it.t === "path" && prev?.t === "path" && !it.rect && !prev.rect && prev.clip === it.clip && prev.evenOdd === it.evenOdd && prev.opacity === it.opacity && JSON.stringify(prev.fill) === JSON.stringify(it.fill) && JSON.stringify(prev.stroke) === JSON.stringify(it.stroke)) {
            merged[merged.length - 1] = { ...prev, d: prev.d + it.d, bbox: [Math.min(prev.bbox[0], it.bbox[0]), Math.min(prev.bbox[1], it.bbox[1]), Math.max(prev.bbox[2], it.bbox[2]), Math.max(prev.bbox[3], it.bbox[3])] };
            continue;
        }
        merged.push(it);
    }

    // Text runs → lines → paragraphs, each placed where its first run is in paint order.
    const runs: Run[] = [];
    merged.forEach((it, index) => {
        if (it.t === "text") runs.push({ ...it, face: runFaces[it.font] ?? { family: DEFAULT_FAMILY, weight: 400, italic: false }, index });
    });
    const blocks = buildBlocks(buildLines(runs));
    const blockAt = new Map<number, Block>();
    for (const b of blocks) blockAt.set((b.lines[0] as Line).index, b);
    const inBlock = new Set<number>();
    for (const b of blocks) for (const l of b.lines) for (const r of l.runs) inBlock.add(r.index);

    const placed: Placed[] = [];
    const out: { node: SceneNode; clip: number | null }[] = [];
    const doc = ctx.doc;

    const addVector = (it: PathItem) => {
        const subs = parsePathData(it.d).map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + ox, y: p.y + oy, in: p.in ? { x: p.in.x + ox, y: p.in.y + oy } : null, out: p.out ? { x: p.out.x + ox, y: p.out.y + oy } : null })) }));
        if (!subs.length) return;
        const geometry = it.evenOdd ? evenOddToNonZero(subs) : subs;
        const b = boundsOf(geometry);
        if (!b) return;
        const box = { x: b.x, y: b.y, w: Math.max(b.w, 0.01), h: Math.max(b.h, 0.01) };
        const pageBox = { x: box.x - ox, y: box.y - oy, w: box.w, h: box.h };
        const fills = it.fill ? [paintOf(it.fill, pageBox)] : [];
        const strokes = it.stroke ? [paintOf(it.stroke.paint, pageBox)] : [];
        // Invisible: an opaque rectangle in the page's colour with nothing under it.
        if (!strokes.length && it.fill && "solid" in it.fill && it.fill.solid[3] >= 0.999 && it.rect && it.clip === null && hex(it.fill.solid) === bg && !placed.some((p) => overlap(p.box, pageBox))) return;
        const common: Partial<SceneNode> = {
            fills,
            strokes,
            strokeWidth: it.stroke ? Math.round(it.stroke.width * 1000) / 1000 : 1,
            strokeAlign: "center",
            strokeCap: it.stroke?.cap ?? "butt",
            strokeJoin: it.stroke?.join ?? "miter",
            dashPattern: it.stroke && it.stroke.dash.length ? it.stroke.dash : null,
            opacity: it.opacity,
            blendMode: blendOf(it.blend),
        };
        let node: SceneNode;
        if (it.rect && !it.stroke?.dash.length) {
            const r = rectOf(it.rect);
            const rb = { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h };
            node = { ...makeNode(doc, "rect", rb, frame.id, { ...common, name: "Rectangle" }), ...rb };
        } else {
            const lines = geometry.length === 1 && geometry[0]?.points.length === 2 && !geometry[0]?.closed && !it.fill;
            const path = { w: box.w, h: box.h, subpaths: geometry.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ x: p.x - box.x, y: p.y - box.y, in: p.in ? { x: p.in.x - box.x, y: p.in.y - box.y } : null, out: p.out ? { x: p.out.x - box.x, y: p.out.y - box.y } : null })) })) };
            node = { ...makeNode(doc, "vector", box, frame.id, { ...common, name: lines ? "Line" : "Vector", path }), ...box };
        }
        placed.push({ box: pageBox });
        out.push({ node, clip: it.clip });
    };

    const addImage = (it: ImageItem) => {
        const id = images[it.image];
        if (!id) return;
        const [a, b, c, d, e, f] = it.m;
        const w = Math.hypot(a, b);
        const h = Math.hypot(c, d);
        if (w < 0.01 || h < 0.01) return;
        const cx = e + (a + c) / 2;
        const cy = f + (b + d) / 2;
        const axis = Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6;
        // Axis-aligned pictures mirror with flips; turned ones turn, and mirror vertically when the
        // placement flips them.
        const rotation = axis ? 0 : Math.round(((Math.atan2(b, a) * 180) / Math.PI) * 100) / 100;
        const flipX = axis && a < 0;
        const flipY = axis ? d < 0 : a * d - b * c < 0;
        const box = { x: cx - w / 2, y: cy - h / 2, w, h };
        const fill: ImagePaint = { type: "image", id, mode: "fill", opacity: 1, visible: true, blend: "normal" };
        let clip = it.clip;
        let rect = box;
        // A picture cut by a rectangular clip shows the cropped part (the reference's crop mode).
        const clipRect = clip !== null ? rectFromD(data.clips[clip]?.d ?? "") : null;
        if (clipRect && axis && !flipX && !flipY) {
            const vis = intersect(box, clipRect);
            if (!vis) return;
            fill.mode = "crop";
            fill.crop = [vis.w / w, 0, (vis.x - box.x) / w, 0, vis.h / h, (vis.y - box.y) / h];
            rect = vis;
            clip = null;
        }
        const placedBox = { x: rect.x + ox, y: rect.y + oy, w: rect.w, h: rect.h };
        const node = { ...makeNode(doc, "rect", placedBox, frame.id, { name: "Image", fills: [fill], opacity: it.opacity, blendMode: blendOf(it.blend), rotation, flipX, flipY }), ...placedBox };
        placed.push({ box: rect });
        out.push({ node, clip });
    };

    const addBlock = (block: Block) => {
        const firstLine = block.lines[0] as Line;
        const parts = block.lines.map(lineText);
        // The main style: the one with the most characters.
        const counts = new Map<string, { run: Run; n: number }>();
        for (const p of parts)
            for (const r of p.ranges) {
                const k = styleKey(r.run);
                const e = counts.get(k) ?? { run: r.run, n: 0 };
                e.n += r.end - r.start;
                counts.set(k, e);
            }
        const main = [...counts.values()].sort((x, y) => y.n - x.n)[0]?.run ?? (firstLine.runs[0] as Run);
        const mainKey = styleKey(main);
        const size = Math.round(main.size * 100) / 100;
        const spansFor = (offsets: number[], ranges: { run: Run; start: number; end: number }[][]): TextSpan[] => {
            const spans: TextSpan[] = [];
            ranges.forEach((rs, li) => {
                for (const r of rs) {
                    if (styleKey(r.run) === mainKey) continue;
                    const start = (offsets[li] ?? 0) + r.start;
                    const end = (offsets[li] ?? 0) + r.end;
                    const span: TextSpan = { start, end };
                    if (r.run.face.family !== main.face.family) span.fontFamily = r.run.face.family;
                    if (r.run.face.weight !== main.face.weight) span.fontWeight = r.run.face.weight;
                    if (r.run.face.italic !== main.face.italic) span.italic = r.run.face.italic;
                    if (Math.abs(r.run.size - main.size) > 0.05) span.fontSize = Math.round(r.run.size * 100) / 100;
                    if (r.run.color.join() !== main.color.join()) span.fills = [solid(hex(r.run.color), r.run.color[3])];
                    spans.push(span);
                }
            });
            return spans;
        };
        const base: Partial<SceneNode> = {
            fontFamily: main.face.family,
            fontWeight: main.face.weight,
            italic: main.face.italic,
            fontSize: size,
            fills: main.stroke ? [] : [solid(hex(main.color), main.color[3])],
            strokes: main.stroke ? [solid(hex(main.stroke.color), main.stroke.color[3])] : [],
            strokeWidth: main.stroke ? main.stroke.width : 1,
            strokeAlign: "center",
            opacity: main.opacity,
            blendMode: blendOf(main.blend),
            textAlign: "left",
            sizing: { h: "hug", v: "hug" },
        };
        // Letter spacing that makes the drawn lines as long as the PDF's (fonts that stand in for
        // the PDF's own measure differently).
        const draftNode = (text: string, spans: TextSpan[], extra: Partial<SceneNode>): SceneNode => makeNode(doc, "text", { x: 0, y: 0, w: 10, h: 10 }, frame.id, { ...base, text, spans: spans.length ? spans : undefined, ...extra });
        const fits: number[] = [];
        const tracking = (main.tracking / main.size) * 100;
        parts.forEach((p, i) => {
            const line = block.lines[i] as Line;
            if (p.text.length < 4) return;
            const measured = measureLine(draftNode(p.text, spansFor([0], [p.ranges]), { letterSpacing: tracking }));
            if (measured <= 0) return;
            const diff = line.width - measured;
            fits.push(tracking + (diff / Math.max(1, p.text.length - 1) / main.size) * 100);
        });
        fits.sort((x, y) => x - y);
        let letterSpacing = fits.length ? (fits[Math.floor(fits.length / 2)] as number) : tracking;
        if (Math.abs(letterSpacing - tracking) < 0.75) letterSpacing = tracking;
        letterSpacing = Math.max(-12, Math.min(30, Math.round(letterSpacing * 100) / 100));
        if (Math.abs(letterSpacing) < 0.05) letterSpacing = 0;
        const lineHeight = block.lines.length > 1 ? Math.round((block.step / main.size) * 1000) / 1000 : null;

        // A paragraph: lines joined with spaces in a fixed-width box, if the layout breaks them
        // exactly where the PDF does (so editing reflows like any text). Otherwise one line each.
        const offsets: number[] = [];
        let soft = "";
        parts.forEach((p, i) => {
            if (i > 0 && !soft.endsWith(" ") && !soft.endsWith("-")) soft += " ";
            offsets.push(soft.length);
            soft += p.text;
        });
        const maxWidth = Math.max(...block.lines.map((l) => l.width));
        let node: SceneNode | null = null;
        if (block.lines.length > 1) {
            const w = Math.ceil(maxWidth * 1.02 + 2);
            const candidate = draftNode(soft, spansFor(offsets, parts.map((p) => p.ranges)), { letterSpacing, lineHeight, sizing: { h: "fixed", v: "hug" }, w });
            const layout = layoutText(candidate);
            const starts = layout.lines.map((l) => l.start);
            if (starts.length === offsets.length && starts.every((s, i) => s === offsets[i])) node = candidate;
        }
        if (!node) {
            const hardOffsets: number[] = [];
            let hard = "";
            parts.forEach((p, i) => {
                if (i > 0) hard += "\n";
                hardOffsets.push(hard.length);
                hard += p.text;
            });
            node = draftNode(hard, spansFor(hardOffsets, parts.map((p) => p.ranges)), { letterSpacing, lineHeight });
        }
        const size2 = textSize(node);
        const layout = layoutText(node);
        const baseline = layout.lines[0]?.baseline ?? main.size * 0.8;
        const w = size2.w;
        const h = size2.h;
        // Put the first baseline's start where the PDF has it, turning around the box's centre.
        const rad = (firstLine.angle * Math.PI) / 180;
        const vx = -w / 2;
        const vy = baseline - h / 2;
        const rx = vx * Math.cos(rad) - vy * Math.sin(rad);
        const ry = vx * Math.sin(rad) + vy * Math.cos(rad);
        const cx = firstLine.x + ox - rx;
        const cy = firstLine.y + oy - ry;
        const name = soft.replace(/\s+/g, " ").trim().slice(0, 40) || "Text";
        const finalNode: SceneNode = { ...node, name, x: cx - w / 2, y: cy - h / 2, w, h, rotation: Math.abs(firstLine.angle) < 0.01 ? 0 : Math.round(firstLine.angle * 100) / 100 };
        placed.push({ box: { x: finalNode.x - ox, y: finalNode.y - oy, w, h } });
        out.push({ node: finalNode, clip: null });
    };

    merged.forEach((it, index) => {
        if (it.t === "path") addVector(it);
        else if (it.t === "image") addImage(it);
        else {
            const block = blockAt.get(index);
            if (block) addBlock(block);
            else if (!inBlock.has(index)) addBlock({ lines: [{ runs: [{ ...it, face: runFaces[it.font] ?? { family: DEFAULT_FAMILY, weight: 400, italic: false }, index }], index, x: it.x, y: it.y, width: it.width, size: it.size, angle: it.angle }], step: 0 });
        }
    });

    // Layers cut by the same clipping path go into a group masked by that path.
    let i = 0;
    while (i < out.length) {
        const entry = out[i] as { node: SceneNode; clip: number | null };
        if (entry.clip === null) {
            ctx.commands.push({ type: "node.create", node: entry.node });
            i++;
            continue;
        }
        const clipId = entry.clip;
        const group = makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, frame.id, { name: "Clip group", fills: [] });
        ctx.commands.push({ type: "node.create", node: group });
        const clip = data.clips[clipId];
        const subs = clip ? parsePathData(clip.d).map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + ox, y: p.y + oy, in: p.in ? { x: p.in.x + ox, y: p.in.y + oy } : null, out: p.out ? { x: p.out.x + ox, y: p.out.y + oy } : null })) })) : [];
        const geometry = clip?.evenOdd ? evenOddToNonZero(subs) : subs;
        const b = boundsOf(geometry);
        if (b) {
            const box = { x: b.x, y: b.y, w: Math.max(b.w, 0.01), h: Math.max(b.h, 0.01) };
            const path = { w: box.w, h: box.h, subpaths: geometry.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ x: p.x - box.x, y: p.y - box.y, in: p.in ? { x: p.in.x - box.x, y: p.in.y - box.y } : null, out: p.out ? { x: p.out.x - box.x, y: p.out.y - box.y } : null })) })) };
            const mask = { ...makeNode(doc, "vector", box, group.id, { name: "Clip", path, fills: [solid("#000000")], isMask: true, maskType: "vector" as const }), ...box };
            ctx.commands.push({ type: "node.create", node: mask });
        }
        while (i < out.length && (out[i] as { clip: number | null }).clip === clipId) {
            const e = out[i] as { node: SceneNode };
            ctx.commands.push({ type: "node.create", node: { ...e.node, parentId: group.id } });
            i++;
        }
    }
    return { background };
}

function rectFromD(d: string): Box | null {
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (!/^M[^MCZ]*L[^MC]*L[^MC]*L[^MC]*Z?$/.test(d) || nums.length < 8) return null;
    const xs = [nums[0], nums[2], nums[4], nums[6]] as number[];
    const ys = [nums[1], nums[3], nums[5], nums[7]] as number[];
    const distinct = (v: number[]) => new Set(v.map((n) => Math.round(n * 10))).size;
    if (distinct(xs) > 2 || distinct(ys) > 2) return null;
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

import { nanoid } from "nanoid";
import type { Capture, CaptureBackground, CaptureNode, CaptureShadow, CaptureStyle, CaptureText, CaptureTextStyle } from "./capture-format";
import { settle } from "./commands";
import { mirrorId } from "./components";
import { syncLayouts } from "./layout";
import { makeNode } from "./nodes";
import { imagePaint, solid } from "./paint";
import { parseColor, svgLayerCommands } from "./svg-import";
import type { AutoLayout, Effect, GradientPaint, GradientStop, NagmaDocument, Paint, SceneNode, TextSpan } from "./types";

// A page capture (engine/capture-format.ts, made by Nagma Capture) as a Design document: one top
// frame named after the page, the viewport's width and the page's full height, holding the page's
// boxes as frames, its text as text layers, its pictures as image fills and its inline SVG as
// vectors. Flex, grid and plain stacked blocks become auto layout when the stack reproduces where
// the browser put every child (checked by running the layout); anything else keeps its absolute
// position. Sibling subtrees with the same structure and style, three or more of them (cards in a
// list), become a component and its instances, with their own text and pictures as overrides.
//
// Pure: no editor, no storage. Pictures stay data URLs in `doc.images`; the caller moves them into
// the media store (engine/capture-open.ts).

export interface CaptureImportOptions {
    // The family Nagma draws a captured family with: the same name when it can load it, another
    // when it should stand in, null when there is none (Inter is used and the page's family is kept
    // in the layer's name). By default generic families get a stand-in and the rest are kept.
    fontFor?: (family: string) => string | null;
    // Repeated siblings become a component and instances (on unless false).
    components?: boolean;
}

export interface CaptureImportResult {
    doc: NagmaDocument;
    // The page's top frame.
    frameId: string;
    // The families the layers use, for loading.
    families: string[];
    // Families that weren't available and fell back to Inter.
    substituted: string[];
    components: number;
    instances: number;
    // Pictures the capture couldn't read (left as grey placeholders).
    missingImages: number;
}

const FALLBACK_FAMILY = "Inter";

// Generic and system families, drawn with metric-compatible or close faces Nagma can load.
const GENERIC: Record<string, string> = {
    "sans-serif": "Arimo",
    serif: "Tinos",
    monospace: "Cousine",
    "system-ui": "Inter",
    "-apple-system": "Inter",
    blinkmacsystemfont: "Inter",
    "ui-sans-serif": "Inter",
    "ui-serif": "Tinos",
    "ui-monospace": "Cousine",
    "ui-rounded": "Inter",
    cursive: "Inter",
    fantasy: "Inter",
    "segoe ui": "Inter",
    "sf pro text": "Inter",
    "sf pro display": "Inter",
    "sf mono": "Cousine",
    menlo: "Cousine",
    monaco: "Cousine",
    consolas: "Cousine",
    "courier new": "Cousine",
    courier: "Cousine",
    "times new roman": "Tinos",
    times: "Tinos",
    arial: "Arimo",
    helvetica: "Arimo",
    "helvetica neue": "Arimo",
};

export function standInFamily(family: string): string {
    return GENERIC[family.trim().toLowerCase()] ?? family;
}

// CSS's generic names (and the system font's aliases): never a family to load by name.
const KEYWORDS = new Set(["sans-serif", "serif", "monospace", "system-ui", "-apple-system", "blinkmacsystemfont", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "cursive", "fantasy", "emoji", "math", "fangsong"]);

export function isGenericFamily(family: string): boolean {
    return KEYWORDS.has(family.trim().toLowerCase());
}

// Without a font check: generic names get their stand-in, named families are kept.
function defaultFontFor(family: string): string {
    return isGenericFamily(family) ? standInFamily(family) : family;
}

// ---- Colours ----

interface Rgba {
    hex: string;
    alpha: number;
}

const hex2 = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function num(token: string | undefined, scale = 1): number {
    if (!token || token === "none") return 0;
    if (token.endsWith("%")) return (parseFloat(token) / 100) * scale;
    return parseFloat(token);
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255, gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255, gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255];
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
    // CIE Lab (D50) to XYZ, adapted to D65, to sRGB.
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const e = 216 / 24389;
    const k = 24389 / 27;
    const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
    const yr = L > k * e ? fy ** 3 : L / k;
    const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
    const X = xr * 0.96422;
    const Y = yr;
    const Z = zr * 0.82521;
    const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z;
    const y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z;
    const z = 0.0122982 * X - 0.020483 * Y + 1.3299098 * Z;
    return [gamma(3.2404542 * x - 1.5371385 * y - 0.4985314 * z) * 255, gamma(-0.969266 * x + 1.8760108 * y + 0.041556 * z) * 255, gamma(0.0556434 * x - 0.2040259 * y + 1.0572252 * z) * 255];
}

// A CSS colour as the browser computes it: rgb(), rgba(), hex, color(srgb …), oklab(), oklch(),
// lab(), lch(), or a name. Null when it can't be read.
export function cssColor(value: string | undefined | null): Rgba | null {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    if (v === "transparent" || v === "none") return { hex: "#000000", alpha: 0 };
    const fn = /^([a-z-]+)\((.*)\)$/s.exec(v);
    if (fn) {
        const name = fn[1] as string;
        const [main = "", alphaPart] = (fn[2] as string).split("/");
        const parts = main.split(/[\s,]+/).filter(Boolean);
        let alpha = alphaPart !== undefined ? num(alphaPart.trim(), 1) : 1;
        let rgb: [number, number, number] | null = null;
        if (name === "rgb" || name === "rgba") {
            if (parts.length >= 4 && alphaPart === undefined) alpha = num(parts[3], 1);
            rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
        } else if (name === "color") {
            const space = parts[0];
            const c = parts.slice(1, 4).map((p) => num(p, 1) * 255) as [number, number, number];
            if (space === "srgb" || space === "display-p3" || space === "a98-rgb" || space === "rec2020" || space === "prophoto-rgb") rgb = c;
            else if (space === "srgb-linear") rgb = c.map((x) => gamma(x / 255) * 255) as [number, number, number];
        } else if (name === "oklab") {
            rgb = oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4));
        } else if (name === "oklch") {
            const L = num(parts[0], 1);
            const C = num(parts[1], 0.4);
            const H = (num(parts[2]) * Math.PI) / 180;
            rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
        } else if (name === "lab") {
            rgb = labToRgb(num(parts[0], 100), num(parts[1], 125), num(parts[2], 125));
        } else if (name === "lch") {
            const H = (num(parts[2]) * Math.PI) / 180;
            const C = num(parts[1], 150);
            rgb = labToRgb(num(parts[0], 100), C * Math.cos(H), C * Math.sin(H));
        } else if (name === "hsl" || name === "hsla") {
            if (parts.length >= 4 && alphaPart === undefined) alpha = num(parts[3], 1);
            const h = (((num(parts[0]) % 360) + 360) % 360) / 360;
            const s = num(parts[1], 1);
            const l = num(parts[2], 1);
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            const t = (x: number) => {
                const k = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
                return (k < 1 / 6 ? p + (q - p) * 6 * k : k < 1 / 2 ? q : k < 2 / 3 ? p + (q - p) * (2 / 3 - k) * 6 : p) * 255;
            };
            rgb = [t(h + 1 / 3), t(h), t(h - 1 / 3)];
        }
        if (!rgb || rgb.some((c) => !Number.isFinite(c))) return null;
        return { hex: toHex(...rgb), alpha: Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1)) };
    }
    const parsed = parseColor(v);
    return parsed ? { hex: parsed.hex.toUpperCase(), alpha: parsed.alpha } : null;
}

// ---- Paints ----

// Splits on commas outside parentheses.
function splitTop(s: string, sep = ","): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === sep && depth === 0) {
            out.push(cur.trim());
            cur = "";
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function angleOf(token: string): number | null {
    const m = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(token.trim());
    if (!m) return null;
    const n = parseFloat(m[1] as string);
    return m[2] === "turn" ? n * 360 : m[2] === "rad" ? (n * 180) / Math.PI : m[2] === "grad" ? n * 0.9 : n;
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135, "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315 };

// Colour stops: "<colour> [<pos> [<pos>]]", with missing positions spread between known ones.
function stopsOf(items: string[], length: number): GradientStop[] {
    const raw: { color: Rgba; pos: number | null }[] = [];
    for (const item of items) {
        const m = /^((?:[a-z-]+\([^)]*\))|#[0-9a-f]+|[a-z]+)\s*(.*)$/i.exec(item.trim());
        if (!m) continue;
        const color = cssColor(m[1]);
        if (!color) continue;
        const positions = (m[2] ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : p.endsWith("px") ? parseFloat(p) / Math.max(1, length) : NaN))
            .filter((p) => Number.isFinite(p));
        if (positions.length === 0) raw.push({ color, pos: null });
        for (const p of positions) raw.push({ color, pos: p });
    }
    if (!raw.length) return [];
    if (raw[0]?.pos === null) (raw[0] as { pos: number | null }).pos = 0;
    const last = raw[raw.length - 1] as { pos: number | null };
    if (last.pos === null) last.pos = 1;
    for (let i = 1; i < raw.length; i++) {
        if (raw[i]?.pos !== null) continue;
        let j = i;
        while (raw[j]?.pos === null) j++;
        const a = raw[i - 1]?.pos as number;
        const b = raw[j]?.pos as number;
        for (let k = i; k < j; k++) (raw[k] as { pos: number | null }).pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    let floor = 0;
    return raw.map((s) => {
        floor = Math.max(floor, s.pos as number);
        return { position: Math.max(0, Math.min(1, floor)), color: s.color.hex, opacity: s.color.alpha };
    });
}

// A CSS gradient as a gradient paint over a w×h box.
export function gradientPaint(css: string, w: number, h: number): GradientPaint | null {
    const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(css.trim());
    if (!m) return null;
    const kind = m[2] as string;
    const args = splitTop(m[3] as string);
    const first = (args[0] ?? "").replace(/\s+in\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/g, "").trim();
    const base = { opacity: 1, visible: true, blend: "normal" as const };
    if (kind === "linear") {
        let angle = 180;
        let rest = args;
        const a = angleOf(first);
        if (a !== null) {
            angle = a;
            rest = args.slice(1);
        } else if (first.startsWith("to ")) {
            const side = first.slice(3).trim();
            if (side in SIDE_ANGLES) {
                angle = SIDE_ANGLES[side] as number;
                // Corners point along the box's diagonal, not at 45°.
                if (side.includes(" ")) {
                    const deg = (Math.atan2(w, h) * 180) / Math.PI;
                    angle = /top/.test(side) ? (/right/.test(side) ? deg : 360 - deg) : /right/.test(side) ? 180 - deg : 180 + deg;
                }
            }
            rest = args.slice(1);
        } else if (first === "" || /^in\s/.test(args[0] ?? "")) rest = args.slice(1);
        const r = (angle * Math.PI) / 180;
        const dx = Math.sin(r);
        const dy = -Math.cos(r);
        const length = Math.abs(w * dx) + Math.abs(h * dy);
        const stops = stopsOf(rest, length);
        if (stops.length < 1) return null;
        const half = length / 2;
        const r4 = (n: number) => Math.round(n * 10000) / 10000;
        return { ...base, type: "linear", stops, from: { x: r4((w / 2 - dx * half) / w), y: r4((h / 2 - dy * half) / h) }, to: { x: r4((w / 2 + dx * half) / w), y: r4((h / 2 + dy * half) / h) } };
    }
    // Radial and conic: centre from "at x y" (50% 50% by default).
    let cx = 0.5;
    let cy = 0.5;
    let rest = args;
    let circle = false;
    if (!cssColor(first.split(/\s+/)[0]) || /\bat\b|circle|ellipse|closest|farthest|from\s/.test(first)) {
        const at = /\bat\s+(\S+)(?:\s+(\S+))?/.exec(first);
        const pos = (t: string | undefined, size: number, fallback: number) => (!t ? fallback : t === "center" ? 0.5 : t === "left" || t === "top" ? 0 : t === "right" || t === "bottom" ? 1 : t.endsWith("%") ? parseFloat(t) / 100 : t.endsWith("px") ? parseFloat(t) / Math.max(1, size) : fallback);
        if (at) {
            cx = pos(at[1], w, 0.5);
            cy = pos(at[2], h, 0.5);
        }
        circle = /circle/.test(first);
        rest = args.slice(1);
    }
    const stops = stopsOf(rest, Math.max(w, h));
    if (stops.length < 1) return null;
    if (kind === "conic") {
        const from = /from\s+(\S+)/.exec(first);
        const a = from ? (angleOf(from[1] as string) ?? 0) : 0;
        const r = ((a - 90) * Math.PI) / 180;
        return { ...base, type: "angular", stops, from: { x: cx, y: cy }, to: { x: cx + Math.cos(r) * 0.5, y: cy + Math.sin(r) * 0.5 } };
    }
    // Farthest corner: the radius reaches the corner furthest from the centre.
    const fx = Math.max(cx, 1 - cx);
    const fy = Math.max(cy, 1 - cy);
    const reach = circle ? Math.hypot(fx * w, fy * h) / w : fx * Math.SQRT2;
    return { ...base, type: "radial", stops, from: { x: cx, y: cy }, to: { x: cx + reach, y: cy } };
}

function fillsOf(style: CaptureStyle, box: { w: number; h: number }, assets: Map<string, string>, missing: { count: number }): Paint[] {
    const out: Paint[] = [];
    const bg = cssColor(style.backgroundColor);
    if (bg && bg.alpha > 0) out.push(solid(bg.hex, bg.alpha));
    // CSS lists the top layer first; paints stack bottom to top.
    for (const layer of [...style.backgrounds].reverse()) {
        const paint = backgroundPaint(layer, box, assets, missing);
        if (paint) out.push(paint);
    }
    return out;
}

function backgroundPaint(layer: CaptureBackground, box: { w: number; h: number }, assets: Map<string, string>, missing: { count: number }): Paint | null {
    if (layer.kind === "gradient") return gradientPaint(layer.css, box.w, box.h);
    const id = assets.get(layer.asset);
    if (!id) {
        missing.count++;
        return null;
    }
    const size = layer.size.trim();
    const repeats = !/no-repeat/.test(layer.repeat) && layer.repeat !== "";
    const mode = size === "cover" ? "fill" : size === "contain" ? "fit" : repeats && (size === "auto" || size === "auto auto") ? "tile" : size === "100% 100%" ? "fill" : "fit";
    return imagePaint(id, mode);
}

function strokeOf(style: CaptureStyle): Partial<SceneNode> {
    const widths = style.borderWidths.map((w, i) => (style.borderStyles[i] === "none" || style.borderStyles[i] === "hidden" ? 0 : w)) as [number, number, number, number];
    if (widths.every((w) => w <= 0)) return {};
    // One colour for the stroke: the first visible side's.
    const side = widths.findIndex((w, i) => w > 0 && (cssColor(style.borderColors[i])?.alpha ?? 0) > 0);
    if (side < 0) return {};
    const color = cssColor(style.borderColors[side]) as Rgba;
    const kind = style.borderStyles[side];
    const width = widths[side] as number;
    const same = widths.every((w) => Math.abs(w - width) < 0.01);
    return {
        strokes: [solid(color.hex, color.alpha)],
        strokeWidth: width,
        strokeAlign: "inside",
        ...(same ? {} : { strokeWeights: widths }),
        ...(kind === "dashed" ? { dash: [width * 3, width * 2] as [number, number] } : kind === "dotted" ? { dash: [width, width] as [number, number], strokeCap: "round" as const } : {}),
    };
}

function shadowEffects(shadows: CaptureShadow[] | undefined): Effect[] {
    const out: Effect[] = [];
    for (const s of [...(shadows ?? [])].reverse()) {
        const c = cssColor(s.color);
        if (!c || c.alpha <= 0) continue;
        out.push({ type: s.inset ? "inner-shadow" : "drop-shadow", visible: true, x: s.x, y: s.y, blur: s.blur, spread: s.spread, color: c.hex, opacity: c.alpha, showBehind: false });
    }
    return out;
}

function effectsOf(style: CaptureStyle): Effect[] {
    const out = shadowEffects(style.shadows);
    const blank = { visible: true, x: 0, y: 0, spread: 0, color: "#000000", opacity: 1 };
    if (style.blur) out.push({ ...blank, type: "layer-blur", blur: style.blur });
    if (style.backdropBlur) out.push({ ...blank, type: "background-blur", blur: style.backdropBlur });
    return out;
}

function radiusOf(style: CaptureStyle, w: number, h: number): Partial<SceneNode> {
    const limit = Math.min(w, h) / 2;
    const r = style.radii.map((v) => Math.max(0, Math.min(limit, v))) as [number, number, number, number];
    if (r.every((v) => v === 0)) return {};
    if (r.every((v) => Math.abs(v - r[0]) < 0.01)) return { radius: r[0] };
    return { radius: r[0], radii: r };
}

const BLENDS = new Set(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-lighter", "plus-darker"]);

function clips(style: CaptureStyle): boolean {
    return style.overflowX !== "visible" || style.overflowY !== "visible";
}

function hasVisuals(node: Partial<SceneNode>): boolean {
    return Boolean(node.fills?.length || node.strokes?.length || node.effects?.length);
}

// ---- Text ----

const TEXT_CASE = { none: "none", uppercase: "upper", lowercase: "lower", capitalize: "title" } as const;
const DECORATION = { none: "none", underline: "underline", "line-through": "strikethrough" } as const;

interface Ctx {
    nodes: Record<string, SceneNode>;
    images: Record<string, string>;
    // Capture asset ids to the document's image ids.
    assets: Map<string, string>;
    missing: { count: number };
    families: Set<string>;
    substituted: Set<string>;
    fontFor: (family: string) => string | null;
    blank: NagmaDocument;
    // Single lines that size themselves: where they sat on the page, to line them up again once
    // measured (centred and right-aligned text grows from its own side).
    anchors: { id: string; align: CaptureTextStyle["align"]; x: number; w: number }[];
}

function family(ctx: Ctx, captured: string): { family: string; missing: boolean } {
    const chosen = ctx.fontFor(captured);
    if (!chosen) {
        ctx.substituted.add(captured);
        ctx.families.add(FALLBACK_FAMILY);
        return { family: FALLBACK_FAMILY, missing: true };
    }
    ctx.families.add(chosen);
    return { family: chosen, missing: false };
}

function spansOf(ctx: Ctx, text: CaptureText, size: number, lineHeight: number): TextSpan[] {
    const spans: TextSpan[] = [];
    for (const run of text.runs) {
        if (run.end <= run.start) continue;
        const s = run.style;
        const span: TextSpan = { start: run.start, end: run.end };
        if (s.color) {
            const c = cssColor(s.color);
            if (c) span.fills = [solid(c.hex, c.alpha)];
        }
        if (s.weight !== undefined) span.fontWeight = s.weight;
        if (s.size !== undefined) {
            span.fontSize = s.size;
            // A line height in px is the same for every size on the line.
            if (!text.lineHeightNormal && s.size > 0) span.lineHeight = lineHeight / s.size;
        }
        if (s.italic !== undefined) span.italic = s.italic;
        if (s.family !== undefined) span.fontFamily = family(ctx, s.family).family;
        if (s.decoration !== undefined) span.decoration = DECORATION[s.decoration] ?? "none";
        if (s.letterSpacing !== undefined) span.letterSpacing = ((s.letterSpacing ?? 0) / (s.size ?? size)) * 100;
        if (s.transform !== undefined) span.textCase = TEXT_CASE[s.transform] ?? "none";
        if (run.href && (s.decoration ?? text.style.decoration) === "underline") span.hyperlink = run.href;
        if (Object.keys(span).length > 2) spans.push(span);
    }
    return spans;
}

function textNode(ctx: Ctx, cn: CaptureNode, parentId: string, inLayout: boolean): SceneNode {
    const t = cn.text as CaptureText;
    const st: CaptureTextStyle = t.style;
    const size = st.size || 16;
    const fam = family(ctx, st.family);
    const color = cssColor(st.color) ?? { hex: "#000000", alpha: 1 };
    const lines = Math.max(1, t.lines || 1);
    const lineHeight = st.lineHeight ?? cn.box.h / lines;
    // "normal" scales with each run's size: the ratio of the largest characters.
    const largest = Math.max(size, ...t.runs.map((r) => r.style.size ?? 0));
    const ratio = t.lineHeightNormal ? lineHeight / largest : lineHeight / size;
    let { x, w } = cn.box;
    const single = lines === 1 && !t.maxLines;
    // Centred or right-aligned text in a box with room to spare keeps the box (its alignment does
    // the placing); other single lines size themselves.
    const roomy = t.textWidth !== undefined && t.textWidth * 1.08 + 2 < w;
    const hugs = single && !(roomy && (st.align === "center" || st.align === "right"));
    // A single line takes its own width, so it never wraps where the page didn't; wrapping text
    // keeps the page's width, with a little room so a slightly wider face doesn't wrap sooner.
    if (!hugs && !inLayout) {
        const extra = 1 + w * 0.005;
        if (st.align === "center") x -= extra / 2;
        else if (st.align === "right") x -= extra;
        w += extra;
    }
    const name = (fam.missing ? `${t.content.slice(0, 40)} (${st.family})` : t.content.slice(0, 40)).replace(/\s+/g, " ").trim() || cn.name;
    const spans = spansOf(ctx, t, size, lineHeight);
    const shadows = shadowEffects(st.shadows);
    return makeNode(ctx.blank, "text", cn.box, parentId, {
        id: nanoid(10),
        name,
        x,
        y: cn.box.y,
        w,
        h: cn.box.h,
        text: t.content,
        fontSize: size,
        fontWeight: st.weight || 400,
        fontFamily: fam.family,
        italic: st.italic,
        lineHeight: ratio,
        letterSpacing: (st.letterSpacing / size) * 100,
        textAlign: st.align,
        decoration: DECORATION[st.decoration] ?? "none",
        textCase: TEXT_CASE[st.transform] ?? "none",
        direction: st.direction,
        fills: [solid(color.hex, color.alpha)],
        sizing: { h: hugs ? "hug" : "fixed", v: "hug" },
        ...(spans.length ? { spans } : {}),
        ...(shadows.length ? { effects: shadows } : {}),
        ...(t.indent ? { paragraphIndent: t.indent } : {}),
        ...(t.maxLines ? { maxLines: t.maxLines, truncate: true, sizing: { h: "fixed", v: "fixed" } } : {}),
        // Linked text is drawn underlined; a link the page doesn't underline stays on its box.
        ...(cn.href && st.decoration === "underline" ? { hyperlink: cn.href } : {}),
    });
}

// ---- Layout ----

const near = (a: number, b: number, tol = 1.01) => Math.abs(a - b) <= tol;

function isFlowChild(cn: CaptureNode): boolean {
    return cn.style.position !== "absolute" && cn.style.position !== "fixed";
}

// Whether the stack puts every child where the browser did: the frame and its children alone,
// run through auto layout.
function reproduces(frame: SceneNode, children: SceneNode[], layout: AutoLayout): boolean {
    const nodes: Record<string, SceneNode> = { [frame.id]: { ...frame, layout, parentId: null, children: children.map((c) => c.id) } };
    for (const c of children) nodes[c.id] = { ...c, children: [], parentId: frame.id };
    const out = syncLayouts({ name: "", nodes, roots: [frame.id], images: {} });
    const f = out.nodes[frame.id] as SceneNode;
    if (!near(f.w, frame.w) || !near(f.h, frame.h)) return false;
    return children.every((c) => {
        const n = out.nodes[c.id] as SceneNode;
        return near(n.x, c.x) && near(n.y, c.y) && near(n.w, c.w) && near(n.h, c.h);
    });
}

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
}

const JUSTIFY: Record<string, AutoLayout["primary"]> = { "flex-start": "start", start: "start", normal: "start", left: "start", center: "center", "flex-end": "end", end: "end", right: "end", "space-between": "between", "space-around": "around", "space-evenly": "evenly" };
const ALIGN: Record<string, AutoLayout["counter"]> = { "flex-start": "start", start: "start", "self-start": "start", normal: "start", stretch: "start", center: "center", "flex-end": "end", end: "end", "self-end": "end", baseline: "baseline", "first baseline": "baseline" };

function unique<T>(items: T[]): T[] {
    return items.filter((v, i) => items.indexOf(v) === i);
}

// The auto layout that reproduces the browser's placement of a container's children, or null.
function fitLayout(frame: SceneNode, style: CaptureStyle, flow: SceneNode[]): { layout: AutoLayout; order: SceneNode[]; grid?: Map<string, Partial<SceneNode>> } | null {
    if (!flow.length || flow.some((c) => c.rotation)) return null;
    const pad = style.padding.map((p, i) => p + (style.borderWidths[i] ?? 0)) as [number, number, number, number];
    const display = style.display;
    if (display === "grid" || display === "inline-grid") return fitGrid(frame, style, flow, pad);
    const flex = display === "flex" || display === "inline-flex";
    let vertical: boolean;
    let order = flow;
    let wrap = false;
    if (flex) {
        const dir = style.flexDirection ?? "row";
        vertical = dir.startsWith("column");
        if (dir.endsWith("reverse")) order = [...flow].reverse();
        wrap = (style.flexWrap ?? "nowrap") !== "nowrap";
    } else {
        // Plain blocks: a column of children, one below the other.
        if (flow.length < 2) return null;
        vertical = true;
        for (let i = 1; i < flow.length; i++) {
            const a = flow[i - 1] as SceneNode;
            const b = flow[i] as SceneNode;
            if (b.y < a.y + a.h - 0.5) return null;
        }
    }
    const start = (c: SceneNode) => (vertical ? c.y : c.x);
    const end = (c: SceneNode) => (vertical ? c.y + c.h : c.x + c.w);
    const measured: number[] = [];
    for (let i = 1; i < order.length; i++) {
        const a = order[i - 1] as SceneNode;
        const b = order[i] as SceneNode;
        if (!wrap || near(vertical ? a.x : a.y, vertical ? b.x : b.y, 0.5)) measured.push(start(b) - end(a));
    }
    if (!flex) {
        const first = order[0] as SceneNode;
        const left = Math.min(...order.map((c) => c.x));
        pad[0] = first.y - frame.y;
        pad[3] = left - frame.x;
    }
    const cssGap = vertical ? style.rowGap : style.columnGap;
    const gaps = unique([...(measured.length && measured.every((g) => near(g, measured[0] as number, 0.6)) ? [median(measured)] : []), ...(cssGap !== undefined ? [cssGap] : []), 0]).filter((g) => g >= 0);
    const primaries = unique<AutoLayout["primary"]>([flex ? (JUSTIFY[style.justifyContent ?? "normal"] ?? "start") : "start", "start", "center", "end", "between"]);
    const counters = unique<AutoLayout["counter"]>([flex ? (ALIGN[style.alignItems ?? "normal"] ?? "start") : "start", "start", "center", "end"]).filter((c) => c !== "baseline");
    const crossGap = vertical ? style.columnGap : style.rowGap;
    for (const gap of gaps)
        for (const primary of primaries)
            for (const counter of counters) {
                const layout: AutoLayout = { direction: vertical ? "vertical" : "horizontal", gap: Math.round(gap * 100) / 100, padding: pad, primary, counter, ...(wrap ? { wrap: true, counterGap: crossGap ?? 0 } : {}) };
                if (reproduces(frame, order, layout)) return { layout, order };
            }
    return null;
}

function fitGrid(frame: SceneNode, style: CaptureStyle, flow: SceneNode[], pad: [number, number, number, number]): { layout: AutoLayout; order: SceneNode[]; grid: Map<string, Partial<SceneNode>> } | null {
    const cols = style.gridColumns ?? [];
    const rows = style.gridRows ?? [];
    if (!cols.length) return null;
    const cg = style.columnGap ?? 0;
    const rg = style.rowGap ?? 0;
    const starts = (tracks: number[], gap: number, origin: number) => {
        const out: number[] = [];
        let at = origin;
        for (const t of tracks) {
            out.push(at);
            at += t + gap;
        }
        return out;
    };
    const colStarts = starts(cols, cg, frame.x + pad[3]);
    const rowStarts = rows.length ? starts(rows, rg, frame.y + pad[0]) : [];
    const placed = new Map<string, Partial<SceneNode>>();
    for (const c of flow) {
        const col = colStarts.findIndex((s) => near(s, c.x, 1.5));
        if (col < 0) return null;
        let span = 1;
        while (col + span < cols.length && (colStarts[col + span] as number) < c.x + c.w - 1) span++;
        const row = rowStarts.length ? rowStarts.findIndex((s) => near(s, c.y, 1.5)) : -1;
        if (rowStarts.length && row < 0) return null;
        let rspan = 1;
        while (row >= 0 && row + rspan < rows.length && (rowStarts[row + rspan] as number) < c.y + c.h - 1) rspan++;
        placed.set(c.id, { gridPosition: { col, row: Math.max(0, row) }, ...(span > 1 || rspan > 1 ? { gridSpan: { col: span, row: rspan } } : {}) });
    }
    const layout: AutoLayout = {
        direction: "horizontal",
        gap: cg,
        padding: pad,
        primary: "start",
        counter: "start",
        grid: { columns: cols.length, rows: rows.length || null, columnGap: cg, rowGap: rg, columnSizes: cols.map((v) => ({ type: "fixed", value: v })), ...(rows.length ? { rowSizes: rows.map((v) => ({ type: "fixed" as const, value: v })) } : {}), itemsPositioning: "manual" },
    };
    const children = flow.map((c) => ({ ...c, ...placed.get(c.id) }));
    if (!reproduces(frame, children, layout)) return null;
    return { layout, order: flow, grid: placed };
}

// ---- Building ----

// Paint order: negative z-index first, then the flow and auto/zero z-index in document order,
// then positive z-index.
function paintOrder(children: CaptureNode[]): CaptureNode[] {
    const key = (c: CaptureNode) => {
        if (isFlowChild(c)) return 0;
        const z = c.style.zIndex ?? 0;
        return z < 0 ? -1 : z > 0 ? 1 : 0;
    };
    return children
        .map((c, i) => ({ c, i, k: key(c), z: c.style.zIndex ?? 0 }))
        .sort((a, b) => a.k - b.k || (a.k !== 0 ? a.z - b.z : 0) || a.i - b.i)
        .map((e) => e.c);
}

function add(ctx: Ctx, node: SceneNode) {
    ctx.nodes[node.id] = node;
    const parent = node.parentId ? ctx.nodes[node.parentId] : undefined;
    if (parent) parent.children.push(node.id);
}

function buildSvg(ctx: Ctx, cn: CaptureNode, parentId: string): string | null {
    const made = svgLayerCommands(cn.svg as string, ctx.blank, { x: cn.box.x, y: cn.box.y }, parentId, cn.name);
    if (!made) return null;
    for (const command of made.commands) {
        if (command.type === "image.add") ctx.images[command.id] = command.data;
        if (command.type !== "node.create") continue;
        const node = { ...command.node, children: [] };
        if (node.id === made.frameId) {
            node.name = cn.name;
            node.opacity = cn.style.opacity;
        }
        add(ctx, node);
    }
    return made.frameId;
}

// Builds a capture node under a parent; returns the layer made (null when it draws nothing).
function build(ctx: Ctx, cn: CaptureNode, parentId: string, inLayout: boolean): string | null {
    if (cn.text) {
        const node = textNode(ctx, cn, parentId, inLayout);
        add(ctx, node);
        if (node.sizing.h === "hug") ctx.anchors.push({ id: node.id, align: cn.text.style.align, x: cn.box.x, w: cn.box.w });
        return node.id;
    }
    if (cn.svg) return buildSvg(ctx, cn, parentId);
    const { style, box } = cn;
    const fills = fillsOf(style, box, ctx.assets, ctx.missing);
    if (cn.image) {
        const id = ctx.assets.get(cn.image.asset);
        if (id) fills.push(imagePaint(id, cn.image.fit === "contain" || cn.image.fit === "scale-down" ? "fit" : "fill"));
        else {
            ctx.missing.count++;
            fills.push(solid("#E5E7EB"));
        }
    }
    const base: Partial<SceneNode> = {
        fills,
        ...strokeOf(style),
        ...radiusOf(style, box.w, box.h),
        effects: effectsOf(style),
        opacity: style.opacity,
        clip: clips(style),
        ...(style.blend && BLENDS.has(style.blend) ? { blendMode: style.blend as SceneNode["blendMode"] } : {}),
        ...(style.rotation ? { rotation: style.rotation } : {}),
        ...(cn.scroll ? { scrollPosition: cn.scroll } : {}),
        ...(cn.href ? { hyperlink: cn.href } : {}),
        ...(style.overflowY === "auto" || style.overflowY === "scroll" ? { overflow: "vertical" as const } : style.overflowX === "auto" || style.overflowX === "scroll" ? { overflow: "horizontal" as const } : {}),
    };
    if (!base.effects?.length) delete base.effects;
    const kids = cn.children;
    // A picture with nothing inside: a rectangle.
    if (cn.image && !kids.length) {
        const node = makeNode(ctx.blank, "rect", box, parentId, { id: nanoid(10), name: cn.name, ...box, ...base, sizing: { h: "fixed", v: "fixed" } });
        add(ctx, node);
        return node.id;
    }
    if (!kids.length && !hasVisuals(base)) return null;
    // A box with no look of its own around a single child that fills it is that child (a heading
    // or a link around its text, a wrapper around a card).
    if (!hasVisuals(base) && !base.clip && kids.length === 1 && style.opacity === 1 && !style.rotation && !cn.scroll) {
        const only = kids[0] as CaptureNode;
        const tol = only.text ? 1.5 : 0.5;
        if (near(only.box.x, box.x, tol) && near(only.box.y, box.y, tol) && near(only.box.w, box.w, tol) && near(only.box.h, box.h, tol) && isFlowChild(only) && (!cn.href || only.text)) {
            const id = build(ctx, { ...only, ...(cn.href && !only.href ? { href: cn.href } : {}) }, parentId, inLayout);
            const made = id ? ctx.nodes[id] : undefined;
            if (made && !only.text && made.type !== "text") made.name = only.name === only.tag || only.name === "Frame" ? cn.name : made.name;
            return id;
        }
    }
    const frame = makeNode(ctx.blank, "frame", box, parentId, { id: nanoid(10), name: cn.name, ...box, ...base, sizing: { h: "fixed", v: "fixed" } });
    add(ctx, frame);
    const ordered = paintOrder(kids);
    // First pass without layout, to know the children's boxes.
    const made: { cn: CaptureNode; id: string }[] = [];
    for (const child of ordered) {
        const id = build(ctx, child, frame.id, false);
        if (id) made.push({ cn: child, id });
    }
    const flowIds = new Set(made.filter((m) => isFlowChild(m.cn)).map((m) => m.id));
    // Flow children in document order (paint order only moves positioned ones).
    const docOrder = kids.flatMap((k) => made.filter((m) => m.cn === k)).filter((m) => flowIds.has(m.id));
    const flow = docOrder.map((m) => ctx.nodes[m.id] as SceneNode);
    const fit = fitLayout(frame, style, flow);
    if (fit) {
        const host = ctx.nodes[frame.id] as SceneNode;
        host.layout = fit.layout;
        const position = new Map(fit.order.map((c, i) => [c.id, i]));
        // The stack order for flow children, the paint order for the rest.
        const flowSorted = [...host.children].filter((id) => flowIds.has(id)).sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
        let k = 0;
        host.children = host.children.map((id) => (flowIds.has(id) ? (flowSorted[k++] as string) : id));
        for (const id of host.children) {
            const child = ctx.nodes[id] as SceneNode;
            if (!flowIds.has(id)) child.positioning = "absolute";
            else if (fit.grid?.has(id)) Object.assign(child, fit.grid.get(id));
            // In a grid, text keeps its cell's width.
            if (child.type === "text" && flowIds.has(id) && fit.layout.grid && child.sizing.h === "hug") child.sizing = { h: "fixed", v: "hug" };
        }
    }
    if (!(ctx.nodes[frame.id] as SceneNode).children.length && !hasVisuals(base)) {
        removeLeaf(ctx, frame.id);
        return null;
    }
    return frame.id;
}

function removeLeaf(ctx: Ctx, id: string) {
    const n = ctx.nodes[id];
    if (!n) return;
    const parent = n.parentId ? ctx.nodes[n.parentId] : undefined;
    if (parent) parent.children = parent.children.filter((c) => c !== id);
    delete ctx.nodes[id];
}

// ---- Components from repeats ----

function paintKey(p: Paint): unknown {
    if (p.type === "solid") return [p.color, Math.round(p.opacity * 100)];
    if (p.type === "image") return ["img", p.mode];
    if (p.type === "linear" || p.type === "radial" || p.type === "angular" || p.type === "diamond") return [p.type, p.stops.map((s) => [s.color, s.position])];
    return p.type;
}

// The structure and style of a subtree, without its text, pictures, names or place.
function signature(nodes: Record<string, SceneNode>, id: string): string {
    const n = nodes[id] as SceneNode;
    const own = [
        n.type,
        n.fills.map(paintKey),
        n.strokes.map(paintKey),
        n.strokeWidth,
        n.strokeWeights,
        Math.round(n.radius),
        n.radii,
        (n.effects ?? []).map((e) => [e.type, e.x, e.y, e.blur, e.color]),
        n.opacity,
        n.clip,
        n.layout ? [n.layout.direction, n.layout.gap, n.layout.padding, n.layout.primary, n.layout.counter, Boolean(n.layout.grid)] : null,
        n.type === "text" ? [n.fontFamily, n.fontSize, n.fontWeight, n.italic, n.lineHeight, n.textAlign, n.textCase, n.sizing.h] : null,
        n.positioning ?? null,
    ];
    return JSON.stringify([own, n.children.map((c) => signature(nodes, c))]);
}

function subtreeSize(nodes: Record<string, SceneNode>, id: string): number {
    return 1 + (nodes[id]?.children ?? []).reduce((s, c) => s + subtreeSize(nodes, c), 0);
}

const SKIP_COMPARE = new Set(["id", "parentId", "children", "sourceId", "overrides", "componentId", "type", "x", "y"]);

// What a copy changes from the component's layer. Instances keep any field they list as an
// override (their place in a grid or stack, their link, their text and pictures).
function differing(a: SceneNode, b: SceneNode): string[] {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: string[] = [];
    for (const key of keys) {
        if (SKIP_COMPARE.has(key)) continue;
        const x = (a as unknown as Record<string, unknown>)[key];
        const y = (b as unknown as Record<string, unknown>)[key];
        if (x === y || JSON.stringify(x) === JSON.stringify(y)) continue;
        out.push(key);
    }
    return out;
}

// Turns a copy of a component's subtree into an instance of it: ids derived from the instance and
// the component's layers, and overrides for what differs (text, pictures, sizes, places).
function makeInstance(nodes: Record<string, SceneNode>, instanceId: string, componentId: string) {
    const inst = nodes[instanceId] as SceneNode;
    const comp = nodes[componentId] as SceneNode;
    const dx = inst.x - comp.x;
    const dy = inst.y - comp.y;
    const rootOverrides = differing(inst, comp);
    const rebuild = (copyId: string, sourceId: string, parentId: string): string => {
        const copy = nodes[copyId] as SceneNode;
        const source = nodes[sourceId] as SceneNode;
        const id = mirrorId(instanceId, sourceId);
        delete nodes[copyId];
        const overrides = differing(copy, source);
        if (!near(copy.x, source.x + dx, 0.01)) overrides.push("x");
        if (!near(copy.y, source.y + dy, 0.01)) overrides.push("y");
        const children = copy.children.map((c, i) => rebuild(c, source.children[i] as string, id));
        nodes[id] = { ...copy, id, parentId, sourceId, overrides, children };
        return id;
    };
    const children = inst.children.map((c, i) => rebuild(c, comp.children[i] as string, instanceId));
    nodes[instanceId] = { ...inst, type: "instance", componentId, overrides: rootOverrides, children };
}

function makeComponents(nodes: Record<string, SceneNode>, rootId: string): { components: number; instances: number } {
    let components = 0;
    let instances = 0;
    // One component per look: the same list item in three lists is one component.
    const mains = new Map<string, string>();
    const visit = (id: string) => {
        const parent = nodes[id];
        if (!parent) return;
        const groups = new Map<string, string[]>();
        for (const c of parent.children) {
            const n = nodes[c];
            if (!n || n.type !== "frame" || subtreeSize(nodes, c) < 3) continue;
            const sig = signature(nodes, c);
            groups.set(sig, [...(groups.get(sig) ?? []), c]);
        }
        const converted = new Set<string>();
        for (const [sig, members] of groups) {
            const known = mains.get(sig);
            if (!known && members.length < 3) continue;
            const main = known ?? (members[0] as string);
            if (!known) {
                (nodes[main] as SceneNode).type = "component";
                mains.set(sig, main);
                components++;
            }
            for (const other of members) {
                if (other === main) continue;
                makeInstance(nodes, other, main);
                instances++;
            }
            for (const m of members) converted.add(m);
        }
        for (const c of nodes[id]?.children ?? []) if (!converted.has(c)) visit(c);
    };
    visit(rootId);
    return { components, instances };
}

// ---- The document ----

export function captureToDocument(capture: Capture, options: CaptureImportOptions = {}): CaptureImportResult {
    const images: Record<string, string> = {};
    // Pictures get ids of their own (image ids are shared across open files, so a capture's short
    // ones would collide).
    const assets = new Map<string, string>();
    for (const [id, asset] of Object.entries(capture.assets ?? {})) {
        if (!asset?.data || !asset.data.startsWith("data:")) continue;
        const own = nanoid(12);
        assets.set(id, own);
        images[own] = asset.data;
    }
    const blank: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} };
    const ctx: Ctx = { anchors: [], nodes: {}, images, assets, missing: { count: 0 }, families: new Set(), substituted: new Set(), fontFor: options.fontFor ?? defaultFontFor, blank };
    const name = capture.title?.trim() || hostName(capture.url) || "Captured page";
    const page = makeNode(blank, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: nanoid(10), name: "Page 1" });
    ctx.nodes[page.id] = page;
    const w = Math.max(1, capture.viewport.w);
    const h = Math.max(capture.viewport.h, capture.scroll?.h ?? 0, 1);
    const bg = cssColor(capture.background);
    const top = makeNode(blank, "frame", { x: 0, y: 0, w, h }, page.id, { id: nanoid(10), name, x: 0, y: 0, w, h, fills: [bg && bg.alpha > 0 ? solid(bg.hex, bg.alpha) : solid("#FFFFFF")], clip: true });
    add(ctx, top);
    build(ctx, capture.root, top.id, false);
    const made = options.components === false ? { components: 0, instances: 0 } : makeComponents(ctx.nodes, top.id);
    const raw: NagmaDocument = { name, nodes: ctx.nodes, roots: [page.id], images: ctx.images };
    let doc = settle({ name, nodes: {}, roots: [], images: {} }, raw);
    doc = reanchor(doc, ctx.anchors);
    return { doc, frameId: top.id, families: [...ctx.families], substituted: [...ctx.substituted], components: made.components, instances: made.instances, missingImages: ctx.missing.count };
}

// Measured single lines outside a stack, moved so they keep the page's alignment: centred on
// the same middle, or ending at the same right edge.
function reanchor(doc: NagmaDocument, anchors: Ctx["anchors"]): NagmaDocument {
    let nodes: Record<string, SceneNode> | null = null;
    for (const a of anchors) {
        const n = (nodes ?? doc.nodes)[a.id];
        if (!n || n.type !== "text") continue;
        const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
        if (parent?.layout && n.positioning !== "absolute") continue;
        const x = a.align === "center" ? a.x + a.w / 2 - n.w / 2 : a.align === "right" ? a.x + a.w - n.w : a.x;
        if (Math.abs(x - n.x) < 0.01) continue;
        nodes ??= { ...doc.nodes };
        nodes[a.id] = { ...n, x };
    }
    return nodes ? settle(doc, { ...doc, nodes }) : doc;
}

function hostName(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

import { nanoid } from "nanoid";
import type { Capture, CaptureBackground, CaptureNode, CaptureShadow, CaptureStateName, CaptureStyle, CaptureText, CaptureTextStyle, CaptureTransition } from "./capture-format";
import { settle } from "./commands";
import { mirrorId } from "./components";
import { syncLayouts } from "./layout";
import { makeNode } from "./nodes";
import { imagePaint, solid } from "./paint";
import { parseColor, svgLayerCommands } from "./svg-import";
import type { StateStyle, SiteNodeData } from "../site/types";
import type { AutoLayout, Effect, GradientPaint, GradientStop, Interaction, NagmaDocument, Paint, SceneNode, TextSpan, Transition } from "./types";

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
    // Elements with hover, press and focus looks become component sets with those variants and
    // prototype interactions between them (on unless false).
    states?: boolean;
}

export interface CaptureImportResult {
    doc: NagmaDocument;
    // The page's top frame (the widest, when it was captured at several widths), and all of them.
    frameId: string;
    frameIds: string[];
    // The families the layers use, for loading.
    families: string[];
    // Families that weren't available and fell back to Inter.
    substituted: string[];
    components: number;
    instances: number;
    // Elements whose interaction states became component sets.
    stateSets: number;
    // Pictures the capture couldn't read (left as grey placeholders).
    missingImages: number;
}

// What the importer keeps on layers (plugin data, so it travels with the file): the page's address
// and when it was captured on the top frame, each layer's DOM path and each picture's source, which
// a later capture of the same page is compared against (engine/capture-diff.ts).
export const CAPTURE_URL = "capture:url";
export const CAPTURE_AT = "capture:at";
export const CAPTURE_WIDTH = "capture:width";
export const CAPTURE_PATH = "capture:path";
export const CAPTURE_SRC = "capture:src";

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

export interface Anchor {
    id: string;
    align: CaptureTextStyle["align"];
    x: number;
    w: number;
}

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
    anchors: Anchor[];
    // Capture asset ids to where the picture came from.
    sources: Map<string, string>;
    // Component sets for interaction states sit beside the page frame, one under another.
    states: boolean;
    pageId: string;
    setsAt: { x: number; y: number };
    stateSets: number;
    // Elements that look and behave alike share one set: by their look, the default variant.
    setsByLook: Map<string, string>;
    // Sites: hover and press looks become the layer's web hover and press states instead.
    siteStates?: boolean;
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
        // Outlined characters that can't be a layer of their own (they wrap across lines): drawn
        // filled in the outline's colour.
        if (s.stroke && !outlinedAlone(run)) {
            const c = cssColor(s.stroke.color);
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

// A run outlined differently from its block that sits on one line: set over the block as a layer of
// its own (outlines are per layer), the block leaving its characters clear.
function outlinedAlone(run: CaptureText["runs"][number]): boolean {
    return Boolean(run.style.stroke && run.rects?.length === 1);
}

function strokePaint(stroke: CaptureTextStyle["stroke"]): Partial<SceneNode> {
    const c = stroke ? cssColor(stroke.color) : null;
    if (!stroke || !c || c.alpha <= 0) return {};
    return { strokes: [solid(c.hex, c.alpha)], strokeWidth: stroke.width, strokeAlign: "center", strokeJoin: "round" };
}

function outlineLayers(ctx: Ctx, cn: CaptureNode, parentId: string): SceneNode[] {
    const t = cn.text as CaptureText;
    const out: SceneNode[] = [];
    for (const run of t.runs) {
        if (!outlinedAlone(run)) continue;
        const rect = run.rects?.[0] as NonNullable<typeof run.rects>[number];
        const st: CaptureTextStyle = { ...t.style, ...run.style };
        const size = st.size || 16;
        const lh = t.style.lineHeight ?? rect.h;
        const content = t.content.slice(run.start, run.end);
        const fam = family(ctx, st.family);
        out.push(
            makeNode(ctx.blank, "text", rect, parentId, {
                id: nanoid(10),
                name: `${content.trim()} (outline)`,
                x: rect.x,
                y: rect.y + (rect.h - lh) / 2,
                w: rect.w,
                h: lh,
                text: content,
                fontSize: size,
                fontWeight: st.weight || 400,
                fontFamily: fam.family,
                italic: st.italic,
                lineHeight: lh / size,
                letterSpacing: (st.letterSpacing / size) * 100,
                textAlign: "left",
                textCase: TEXT_CASE[st.transform] ?? "none",
                direction: st.direction,
                fills: [],
                ...strokePaint(st.stroke),
                sizing: { h: "hug", v: "hug" },
                positioning: "absolute",
                ...(cn.path ? { pluginData: { [CAPTURE_PATH]: `${cn.path}~${run.start}` } } : {}),
            }),
        );
    }
    return out;
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
        ...strokePaint(st.stroke),
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
            if (cn.style.rotation) node.rotation = cn.style.rotation;
        }
        add(ctx, node);
    }
    return made.frameId;
}

// Builds a capture node under a parent; returns the layer made (null when it draws nothing).
// `keepFrame`: the node becomes a frame of its own even when it would fold into its only child or
// draw nothing (a component's root).
function build(ctx: Ctx, cn: CaptureNode, parentId: string, inLayout: boolean, keepFrame = false): string | null {
    if (ctx.states && hasStates(cn)) return buildStateful(ctx, cn, parentId);
    const id = buildLayer(ctx, cn, parentId, inLayout, keepFrame);
    const node = id ? ctx.nodes[id] : undefined;
    if (node && ctx.siteStates && cn.states) {
        const hover = stateStyleOf(cn.states.changes.hover, cn.states.transition);
        const press = stateStyleOf(cn.states.changes.active, cn.states.transition);
        if (hover || press) node.site = { ...((node.site as SiteNodeData | undefined) ?? {}), ...(hover ? { hover } : {}), ...(press ? { press } : {}) };
    }
    if (node) {
        const data: Record<string, string> = { ...(node.pluginData ?? {}) };
        // The innermost element's path stays when a wrapper folds into its child.
        if (cn.path && !data[CAPTURE_PATH]) data[CAPTURE_PATH] = cn.path;
        const src = cn.video?.src || (cn.image ? ctx.sources.get(cn.image.asset) : undefined);
        if (src && !data[CAPTURE_SRC]) data[CAPTURE_SRC] = src;
        if (Object.keys(data).length) node.pluginData = data;
    }
    return id;
}

function buildLayer(ctx: Ctx, cn: CaptureNode, parentId: string, inLayout: boolean, keepFrame: boolean): string | null {
    if (cn.live) {
        // A part the page runs with script: a Live frame running its markup, styles and the
        // capture's behaviour shim in the sandbox (nothing of the page runs anywhere else).
        const node = makeNode(ctx.blank, "live", cn.box, parentId, {
            id: nanoid(10),
            name: cn.name.startsWith("Live: ") ? cn.name : `Live: ${cn.name}`,
            ...cn.box,
            clip: true,
            sizing: { h: "fixed", v: "fixed" },
            live: { kind: "html", source: { html: cn.live.html, css: cn.live.css, js: cn.live.js }, props: {} },
        });
        add(ctx, node);
        return node.id;
    }
    if (cn.text) {
        const node = textNode(ctx, cn, parentId, inLayout);
        add(ctx, node);
        if (node.sizing.h === "hug") ctx.anchors.push({ id: node.id, align: cn.text.style.align, x: cn.box.x, w: cn.box.w });
        for (const outline of outlineLayers(ctx, cn, parentId)) add(ctx, outline);
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
    if (cn.image && !kids.length && !keepFrame) {
        const node = makeNode(ctx.blank, "rect", box, parentId, { id: nanoid(10), name: cn.name, ...box, ...base, sizing: { h: "fixed", v: "fixed" } });
        add(ctx, node);
        return node.id;
    }
    if (!kids.length && !hasVisuals(base) && !keepFrame) return null;
    // A box with no look of its own around a single child that fills it is that child (a heading
    // or a link around its text, a wrapper around a card).
    if (!keepFrame && !hasVisuals(base) && !base.clip && kids.length === 1 && style.opacity === 1 && !style.rotation && !cn.scroll) {
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
    if (!keepFrame && !(ctx.nodes[frame.id] as SceneNode).children.length && !hasVisuals(base)) {
        removeLeaf(ctx, frame.id);
        return null;
    }
    return frame.id;
}

// ---- Interaction states ----

const STATE_ORDER: CaptureStateName[] = ["hover", "active", "focus"];
const STATE_LABEL: Record<CaptureStateName, string> = { hover: "Hover", active: "Pressed", focus: "Focused" };

function hasStates(cn: CaptureNode): boolean {
    return Boolean(cn.states && STATE_ORDER.some((s) => cn.states?.[s]));
}

// A CSS timing function as a prototype easing.
export function easingOf(css: string | undefined): Pick<Transition, "easing" | "bezier"> {
    const v = (css ?? "ease").trim().toLowerCase();
    if (v === "linear" || v.startsWith("linear(") || v.startsWith("steps") || v === "step-start" || v === "step-end") return { easing: "linear" };
    if (v === "ease-in") return { easing: "ease-in" };
    if (v === "ease-out") return { easing: "ease-out" };
    if (v === "ease-in-out") return { easing: "ease-in-out" };
    const m = /^cubic-bezier\(([^)]+)\)$/.exec(v);
    const b = v === "ease" ? [0.25, 0.1, 0.25, 1] : m ? (m[1] as string).split(",").map((n) => parseFloat(n)) : null;
    if (b && b.length === 4 && b.every((n) => Number.isFinite(n))) return { easing: "custom-bezier", bezier: b as [number, number, number, number] };
    return { easing: "ease-out" };
}

// The page's CSS transition as the prototype's: match animated, with its duration and easing
// (instant when the page has none).
export function transitionOf(t: CaptureTransition | null | undefined): Transition {
    if (!t || t.duration <= 0) return { type: "instant", direction: "left", duration: 0, easing: "ease-out" };
    return { type: "smart", direction: "left", duration: Math.round(t.duration), ...easingOf(t.easing) };
}

// Moves a subtree (positions are on the canvas, so every layer in it moves).
function shift(ctx: Ctx, id: string, dx: number, dy: number) {
    const moved = new Set<string>();
    const visit = (n: string) => {
        const node = ctx.nodes[n];
        if (!node) return;
        node.x += dx;
        node.y += dy;
        moved.add(n);
        node.children.forEach(visit);
    };
    visit(id);
    for (const a of ctx.anchors) if (moved.has(a.id)) a.x += dx;
}

// An element with hover, press or focus looks: a component set beside the page (State=Default,
// Hover, Pressed, Focused), with While hovering and While pressing changing to those variants the
// way the page's transition does, and an instance where the element was.
// What makes two stateful elements the same component: everything but their names, places and
// links. (Their text and pictures count: an instance that shows another variant in the prototype
// takes that variant's layers, so a shared set would show the first element's text on hover.)
const LOOK_SKIP = new Set(["name", "path", "href", "x", "y", "stateKey"]);
function lookOf(cn: CaptureNode): string {
    return JSON.stringify(cn, (k, v) => (LOOK_SKIP.has(k) ? undefined : typeof v === "number" ? Math.round(v) : v));
}

function instanceOf(ctx: Ctx, plain: CaptureNode, parentId: string, mainId: string): string | null {
    const copy = build(ctx, plain, parentId, false, true);
    const copied = copy ? ctx.nodes[copy] : undefined;
    const main = ctx.nodes[mainId];
    if (!copy || !copied || !main) return copy;
    if (main.interactions) copied.interactions = main.interactions;
    if (!sameShape(ctx.nodes, copy, mainId)) return copy;
    copied.name = plain.name;
    makeInstance(ctx.nodes, copy, mainId);
    return copy;
}

// Whether two subtrees have the same layers in the same places (an instance mirrors them one to one).
function sameShape(nodes: Record<string, SceneNode>, a: string, b: string): boolean {
    const x = nodes[a];
    const y = nodes[b];
    if (!x || !y || x.children.length !== y.children.length) return false;
    if ((x.type === "text") !== (y.type === "text")) return false;
    return x.children.every((c, i) => sameShape(nodes, c, y.children[i] as string));
}

function buildStateful(ctx: Ctx, cn: CaptureNode, parentId: string): string | null {
    const states = cn.states;
    const plain: CaptureNode = { ...cn, states: undefined };
    if (!states) return build(ctx, plain, parentId, false);
    const look = lookOf(cn);
    const known = ctx.setsByLook.get(look);
    if (known && ctx.nodes[known]) return instanceOf(ctx, plain, parentId, known);
    const looks: { label: string; state: CaptureStateName | null; node: CaptureNode }[] = [{ label: "Default", state: null, node: plain }];
    for (const s of STATE_ORDER) {
        const look = states[s];
        if (look) looks.push({ label: STATE_LABEL[s], state: s, node: { ...look, states: undefined, path: cn.path } });
    }
    const set = makeNode(ctx.blank, "componentSet", { x: ctx.setsAt.x, y: ctx.setsAt.y, w: 1, h: 1 }, ctx.pageId, {
        id: nanoid(10),
        name: cn.name,
        strokes: [solid("#9747FF")],
        dash: [4, 4],
        strokeWidth: 1,
        fills: [],
        radius: 5,
    });
    add(ctx, set);
    const variants: { id: string; state: CaptureStateName | null }[] = [];
    let x = ctx.setsAt.x + 20;
    let tallest = 0;
    for (const look of looks) {
        const id = build(ctx, look.node, set.id, false, true);
        const node = id ? ctx.nodes[id] : undefined;
        if (!id || !node) continue;
        node.type = "component";
        node.name = `State=${look.label}`;
        shift(ctx, id, x - node.x, ctx.setsAt.y + 20 - node.y);
        x += node.w + 20;
        tallest = Math.max(tallest, node.h);
        variants.push({ id, state: look.state });
    }
    const main = variants.find((v) => v.state === null);
    if (!main || variants.length < 2) {
        // Nothing to vary after all: the element as plain layers.
        for (const v of variants) removeSubtree(ctx, v.id);
        removeLeaf(ctx, set.id);
        return build(ctx, plain, parentId, false);
    }
    Object.assign(ctx.nodes[set.id] as SceneNode, { w: x - ctx.setsAt.x, h: tallest + 40 });
    ctx.setsAt.y += tallest + 40 + 40;
    ctx.stateSets++;
    // While hovering and While pressing, from the default and (pressing) from the hover look.
    const transition = transitionOf(states.transition);
    const to = (state: CaptureStateName) => variants.find((v) => v.state === state)?.id;
    const change = (trigger: Interaction["trigger"], target: string | undefined): Interaction[] => (target ? [{ trigger, delay: 0, actions: [{ type: "change-to", target, transition }] }] : []);
    const fromDefault = [...change("hover", to("hover")), ...change("press", to("active"))];
    if (fromDefault.length) (ctx.nodes[main.id] as SceneNode).interactions = fromDefault;
    const hoverId = to("hover");
    if (hoverId && to("active")) (ctx.nodes[hoverId] as SceneNode).interactions = change("press", to("active"));
    ctx.setsByLook.set(look, main.id);
    // The instance: a copy of the default look where the element was, linked to the component.
    return instanceOf(ctx, plain, parentId, main.id);
}

function removeSubtree(ctx: Ctx, id: string) {
    const n = ctx.nodes[id];
    if (!n) return;
    for (const c of [...n.children]) removeSubtree(ctx, c);
    removeLeaf(ctx, id);
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
    const fonts = fontAssets(capture);
    for (const [id, asset] of Object.entries(capture.assets ?? {})) {
        if (!asset?.data || !asset.data.startsWith("data:") || fonts.has(id)) continue;
        const own = nanoid(12);
        assets.set(id, own);
        images[own] = asset.data;
    }
    const blank: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} };
    const sources = new Map(Object.entries(capture.assets ?? {}).map(([id, a]) => [id, a?.url ?? ""]));
    const name = capture.title?.trim() || hostName(capture.url) || "Captured page";
    const page = makeNode(blank, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: nanoid(10), name: "Page 1" });
    const widths = pageWidths(capture);
    const ctx: Ctx = { anchors: [], nodes: {}, images, assets, sources, missing: { count: 0 }, families: new Set(), substituted: new Set(), fontFor: options.fontFor ?? defaultFontFor, blank, states: options.states !== false, pageId: page.id, setsAt: { x: 0, y: 0 }, stateSets: 0, setsByLook: new Map() };
    ctx.nodes[page.id] = page;
    // One frame per width, side by side (named with their width when there are several), and the
    // component sets for states after them.
    const frameIds: string[] = [];
    let x = 0;
    for (const at of widths) {
        const label = widths.length > 1 ? `${name} ${at.width}` : name;
        // Built where the page had it, then moved into its place in the row.
        const top = topFrame(ctx, capture, at, label);
        if (frameIds.length === 0) ctx.setsAt = { x: at.width + 200, y: 0 };
        ctx.states = options.states !== false && frameIds.length === 0;
        build(ctx, at.root, top, false);
        if (x) shift(ctx, top, x, 0);
        frameIds.push(top);
        x += at.width + BREAKPOINT_SPACING;
        if (frameIds.length === 1 && ctx.stateSets) x = Math.max(x, ...Object.values(ctx.nodes).filter((n) => n.type === "componentSet").map((n) => n.x + n.w + BREAKPOINT_SPACING));
    }
    let made = { components: 0, instances: 0 };
    if (options.components !== false)
        for (const id of frameIds) {
            const m = makeComponents(ctx.nodes, id);
            made = { components: made.components + m.components, instances: made.instances + m.instances };
        }
    const raw: NagmaDocument = { name, nodes: ctx.nodes, roots: [page.id], images: ctx.images };
    let doc = settle({ name, nodes: {}, roots: [], images: {} }, raw);
    doc = reanchor(doc, ctx.anchors);
    return { doc, frameId: frameIds[0] as string, frameIds, families: [...ctx.families], substituted: [...ctx.substituted], components: made.components, instances: made.instances, stateSets: ctx.stateSets, missingImages: ctx.missing.count };
}

// Space between the frames of a capture taken at several widths.
const BREAKPOINT_SPACING = 160;

export interface CaptureWidth {
    label: string;
    width: number;
    viewport: { w: number; h: number };
    scroll: { w: number; h: number };
    background: string;
    root: CaptureNode;
}

// The capture's widths, widest first: the capture itself, then its breakpoints.
export function pageWidths(capture: Capture): CaptureWidth[] {
    const main: CaptureWidth = { label: capture.label ?? "Desktop", width: Math.max(1, Math.round(capture.viewport.w)), viewport: capture.viewport, scroll: capture.scroll, background: capture.background, root: capture.root };
    const others = (capture.breakpoints ?? []).map((b) => ({ label: b.label, width: Math.max(1, Math.round(b.viewport.w || b.width)), viewport: b.viewport, scroll: b.scroll, background: b.background, root: b.root }));
    return [main, ...others.filter((b) => b.width !== main.width)].sort((a, b) => b.width - a.width);
}

function topFrame(ctx: Ctx, capture: Capture, at: CaptureWidth, label: string): string {
    const w = at.width;
    const h = Math.max(at.viewport.h, at.scroll?.h ?? 0, 1);
    const bg = cssColor(at.background);
    const top = makeNode(ctx.blank, "frame", { x: 0, y: 0, w, h }, ctx.pageId, { id: nanoid(10), name: label, x: 0, y: 0, w, h, fills: [bg && bg.alpha > 0 ? solid(bg.hex, bg.alpha) : solid("#FFFFFF")], clip: true, pluginData: pageData(capture, w) });
    add(ctx, top);
    return top.id;
}

// A state's changes on the element as a Sites hover or press state (fill, text colour, opacity,
// lift and scale, a shadow), or null when none of them changed.
export function stateStyleOf(changes: Record<string, [string, string]> | undefined, transition: CaptureTransition | null | undefined): StateStyle | null {
    if (!changes) return null;
    const out: StateStyle = {};
    const to = (p: string) => changes[p]?.[1];
    const bg = cssColor(to("background-color"));
    if (bg && bg.alpha > 0) out.fill = bg.hex;
    const color = cssColor(to("color"));
    if (color) out.textColor = color.hex;
    const opacity = to("opacity");
    if (opacity !== undefined && Number.isFinite(parseFloat(opacity))) out.opacity = parseFloat(opacity);
    const m = /matrix\(([^)]+)\)/.exec(to("transform") ?? "");
    if (m) {
        const [a = 1, b = 0, , , , f = 0] = (m[1] as string).split(",").map((n) => parseFloat(n));
        if (Math.abs(f) > 0.01) out.y = Math.round(f * 100) / 100;
        const k = Math.hypot(a, b);
        if (Math.abs(k - 1) > 0.001) out.scale = Math.round(k * 1000) / 1000;
    }
    const translate = to("translate");
    if (translate && translate !== "none") {
        const y = parseFloat(translate.split(/\s+/)[1] ?? "0");
        if (Number.isFinite(y) && Math.abs(y) > 0.01) out.y = y;
    }
    const scale = to("scale");
    if (scale && scale !== "none" && Number.isFinite(parseFloat(scale))) out.scale = parseFloat(scale);
    const shadow = to("box-shadow");
    if (shadow && shadow !== "none") out.shadow = true;
    if (!Object.keys(out).length) return null;
    if (transition && transition.duration > 0) out.duration = transition.duration;
    return out;
}

export interface LayerBuild {
    // The layers made, the parent included (with its new children).
    nodes: Record<string, SceneNode>;
    images: Record<string, string>;
    rootId: string | null;
    // Single lines to line up again once measured (reanchor, after the caller settles).
    anchors: Anchor[];
    families: string[];
    substituted: string[];
    missingImages: number;
}

// One width of a capture built into a frame that already exists (a site breakpoint's): the page's
// body as one frame in it, positions moved to the frame's place. Interaction states become web
// hover and press states; no components are made.
export function buildCaptureLayers(capture: Capture, at: CaptureWidth, parent: SceneNode, options: CaptureImportOptions = {}, images: Record<string, string> = {}): LayerBuild {
    const assets = new Map<string, string>();
    const known = new Map(Object.entries(images).map(([id, data]) => [data, id]));
    const fonts = fontAssets(capture);
    for (const [id, asset] of Object.entries(capture.assets ?? {})) {
        if (!asset?.data || !asset.data.startsWith("data:") || fonts.has(id)) continue;
        const own = known.get(asset.data) ?? nanoid(12);
        assets.set(id, own);
        images[own] = asset.data;
        known.set(asset.data, own);
    }
    const sources = new Map(Object.entries(capture.assets ?? {}).map(([id, a]) => [id, a?.url ?? ""]));
    const blank: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} };
    const ctx: Ctx = { anchors: [], nodes: { [parent.id]: { ...parent, children: [] } }, images, assets, sources, missing: { count: 0 }, families: new Set(), substituted: new Set(), fontFor: options.fontFor ?? defaultFontFor, blank, states: false, siteStates: true, pageId: parent.parentId ?? parent.id, setsAt: { x: 0, y: 0 }, stateSets: 0, setsByLook: new Map() };
    const rootId = build(ctx, at.root, parent.id, false, true);
    if (rootId && (parent.x || parent.y)) shift(ctx, rootId, parent.x, parent.y);
    return { nodes: ctx.nodes, images, rootId, anchors: ctx.anchors, families: [...ctx.families], substituted: [...ctx.substituted], missingImages: ctx.missing.count };
}

// Assets that are font files: never pictures in the document (they stay on this device,
// engine/capture-fonts.ts).
function fontAssets(capture: Capture): Set<string> {
    const out = new Set<string>();
    for (const f of capture.fonts ?? []) for (const face of f.faces ?? []) if (face.asset) out.add(face.asset);
    for (const [id, a] of Object.entries(capture.assets ?? {})) if (a?.data?.startsWith("data:font/")) out.add(id);
    return out;
}

// The top frame's record of where the capture came from.
function pageData(capture: Capture, width: number): Record<string, string> {
    return { [CAPTURE_URL]: capture.url ?? "", [CAPTURE_AT]: capture.capturedAt ?? "", [CAPTURE_WIDTH]: String(Math.round(width)) };
}

// Measured single lines outside a stack, moved so they keep the page's alignment: centred on
// the same middle, or ending at the same right edge.
export function reanchor(doc: NagmaDocument, anchors: Anchor[], rename?: Map<string, string>): NagmaDocument {
    let nodes: Record<string, SceneNode> | null = null;
    for (const a of anchors) {
        const id = rename?.get(a.id) ?? a.id;
        const n = (nodes ?? doc.nodes)[id];
        if (!n || n.type !== "text") continue;
        const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
        if (parent?.layout && n.positioning !== "absolute") continue;
        const x = a.align === "center" ? a.x + a.w / 2 - n.w / 2 : a.align === "right" ? a.x + a.w - n.w : a.x;
        if (Math.abs(x - n.x) < 0.01) continue;
        nodes ??= { ...doc.nodes };
        nodes[id] = { ...n, x };
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

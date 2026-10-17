import { fontBinary } from "./fonts";
import { type FontAxis, type FontInstance, type ParsedFont, type PathCommand, parseFont } from "./font-reader";
import { type CharStyle, styledRuns } from "./rich-text";
import { type Fragment, layoutText, prefixWidth, verticalOffset } from "./text-layout";
import type { Paint, PathPoint, SceneNode, Subpath } from "./types";

// Text as vector outlines, from the font files themselves: each character's glyph (after the
// layer's OpenType substitutions) placed where the canvas draws it, so flattened text looks the
// same as the live text. Used by Flatten (⌥⇧F) and available to booleans.

const parsed = new Map<string, Promise<ParsedFont | null>>();
const ready = new Map<string, ParsedFont | null>();

const keyOf = (family: string, weight: number, italic: boolean) => `${family}|${weight}|${italic}`;

// The font for a style, parsed (cached).
export function loadParsedFont(family: string, weight: number, italic: boolean): Promise<ParsedFont | null> {
    const key = keyOf(family, weight, italic);
    let p = parsed.get(key);
    if (!p) {
        p = fontBinary(family, weight, italic).then((buf) => {
            let font: ParsedFont | null = null;
            try {
                font = buf ? parseFont(buf) : null;
            } catch {
                font = null;
            }
            ready.set(key, font);
            return font;
        });
        parsed.set(key, p);
    }
    return p;
}

// Lets tests and other tools hand in a font file directly.
export function registerFontFile(family: string, weight: number, italic: boolean, buffer: ArrayBuffer) {
    const font = parseFont(buffer);
    const key = keyOf(family, weight, italic);
    ready.set(key, font);
    parsed.set(key, Promise.resolve(font));
    return font;
}

const fontFor = (style: CharStyle) => ready.get(keyOf(style.fontFamily, style.fontVariations.wght ?? style.fontWeight, style.italic));

// The OpenType features a font has (for Type settings › Details), or null if it can't be read.
export async function fontFeatures(family: string, weight: number, italic: boolean): Promise<string[] | null> {
    const font = await loadParsedFont(family, weight, italic);
    return font ? font.features : null;
}

// A variable font's real axes and named instances (fvar), or null if the file can't be read.
export async function fontVariation(family: string, weight: number, italic: boolean): Promise<{ axes: FontAxis[]; instances: FontInstance[] } | null> {
    const font = await loadParsedFont(family, weight, italic);
    return font ? { axes: font.axes, instances: font.instances } : null;
}

// Loads every font a text layer needs for its outlines. Resolves false if one can't be had.
export async function loadTextOutlines(node: SceneNode): Promise<boolean> {
    const styles = styledRuns(node).map((r) => r.style);
    const results = await Promise.all(styles.map((s) => loadParsedFont(s.fontFamily, s.fontVariations.wght ?? s.fontWeight, s.italic)));
    return results.every(Boolean);
}

const DEFAULT_ON = ["liga", "clig", "calt", "ccmp", "locl", "rlig"];

function featureSet(style: CharStyle): Set<string> {
    const set = new Set(DEFAULT_ON);
    for (const [tag, on] of Object.entries(style.openType)) {
        if (on) set.add(tag);
        else set.delete(tag);
    }
    return set;
}

export interface GlyphOutline {
    fills: Paint[];
    subpaths: Subpath[];
}

// Path commands (font units, y up) to subpaths in layer space.
function place(commands: PathCommand[], scale: number, ox: number, oy: number, skew: number, sx = scale): Subpath[] {
    const out: Subpath[] = [];
    let current: PathPoint[] | null = null;
    let last = { x: 0, y: 0 };
    const pt = (x: number, y: number) => ({ x: ox + x * sx + skew * y * scale, y: oy - y * scale });
    for (const c of commands) {
        if (c.op === "M") {
            if (current?.length) out.push({ points: current, closed: true });
            const p = pt(c.x, c.y);
            current = [{ x: p.x, y: p.y, in: null, out: null }];
            last = { x: c.x, y: c.y };
        } else if (c.op === "L") {
            const p = pt(c.x, c.y);
            current?.push({ x: p.x, y: p.y, in: null, out: null });
            last = { x: c.x, y: c.y };
        } else if (c.op === "Q" || c.op === "C") {
            // Quadratic curves become cubics: control points two thirds of the way to the quadratic one.
            const c1 = c.op === "Q" ? { x: last.x + ((c.x1 - last.x) * 2) / 3, y: last.y + ((c.y1 - last.y) * 2) / 3 } : { x: c.x1, y: c.y1 };
            const c2 = c.op === "Q" ? { x: c.x + ((c.x1 - c.x) * 2) / 3, y: c.y + ((c.y1 - c.y) * 2) / 3 } : { x: c.x2, y: c.y2 };
            const prev = current?.[current.length - 1];
            if (prev) prev.out = pt(c1.x, c1.y);
            const p = pt(c.x, c.y);
            current?.push({ x: p.x, y: p.y, in: pt(c2.x, c2.y), out: null });
            last = { x: c.x, y: c.y };
        } else if (c.op === "Z") {
            if (current?.length) {
                // A closing point that repeats the start folds into it.
                const first = current[0] as PathPoint;
                const end = current[current.length - 1] as PathPoint;
                if (current.length > 1 && Math.abs(first.x - end.x) < 1e-6 && Math.abs(first.y - end.y) < 1e-6) {
                    first.in = end.in;
                    current.pop();
                }
                out.push({ points: current, closed: true });
            }
            current = null;
        }
    }
    if (current?.length) out.push({ points: current, closed: true });
    return out;
}

function rect(x: number, y: number, w: number, h: number): Subpath {
    const p = (px: number, py: number): PathPoint => ({ x: px, y: py, in: null, out: null });
    return { points: [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)], closed: true };
}

// One fragment's glyphs (and decoration) in layer-parent space.
function fragmentOutlines(node: SceneNode, f: Fragment, text: string, from: number, x0: number, baseline: number, visible: number): Subpath[] | null {
    const font = fontFor(f.style);
    if (!font) return null;
    const size = f.style.fontSize;
    const scale = size / font.unitsPerEm;
    const coords = font.axes.length ? font.normalize({ wght: f.style.fontVariations.wght ?? f.style.fontWeight, opsz: size, ...f.style.fontVariations }) : undefined;
    // Italic asked of a font file without italics: slanted like the browser does it.
    const skew = f.style.italic && !font.italic ? 0.2 : 0;
    const features = featureSet(f.style);
    const smallCaps = f.caps === "small-caps";
    const fakeSmallCaps = smallCaps && !font.features.includes("smcp");
    if (smallCaps && !fakeSmallCaps) features.add("smcp");
    const chars = [...text.slice(from)];
    // Code points with their index in the fragment's text (for positions).
    const units: { cp: number; at: number; small: boolean }[] = [];
    let at = from;
    for (const ch of chars) {
        const small = fakeSmallCaps && ch !== ch.toUpperCase();
        const shown = small ? ch.toUpperCase() : ch;
        units.push({ cp: shown.codePointAt(0) ?? 32, at, small });
        at += ch.length;
    }
    const gids = units.map((u) => font.glyphIndex(u.cp));
    const glyphs = font.substitute(gids, features);
    const out: Subpath[] = [];
    for (const g of glyphs) {
        const unit = units[g.from];
        if (!unit || /\s/.test(String.fromCodePoint(unit.cp))) continue;
        const x = x0 + prefixWidth(f, unit.at);
        const k = unit.small ? 0.7 : 1;
        const commands = font.glyphPath(g.gid, coords);
        if (commands.length) out.push(...place(commands, scale * k, node.x + x, baseline, skew, scale * k));
    }
    const kind = f.style.decoration !== "none" ? f.style.decoration : f.style.hyperlink ? "underline" : "none";
    if (kind !== "none" && visible > 0) {
        const offset = kind === "strikethrough" ? -size * 0.3 : size * 0.12;
        out.push(rect(node.x + x0 + prefixWidth(f, from), baseline + offset, visible, Math.max(1, size / 14)));
    }
    return out;
}

// Every glyph of a text layer as outlines, grouped by fill (one group when the text has one fill).
// Fonts must be loaded first (loadTextOutlines); returns null while one is missing.
export function textOutlines(node: SceneNode): GlyphOutline[] | null {
    if (node.type !== "text") return null;
    const layout = layoutText(node);
    const dy = node.y + verticalOffset(node, layout);
    const groups = new Map<string, GlyphOutline>();
    const add = (fills: Paint[], subpaths: Subpath[]) => {
        const key = JSON.stringify(fills);
        const g = groups.get(key);
        if (g) g.subpaths.push(...subpaths);
        else groups.set(key, { fills, subpaths: [...subpaths] });
    };
    for (const line of layout.lines) {
        const baseline = dy + line.baseline;
        if (line.marker) {
            const m = line.marker;
            const markerFragment: Fragment = { start: 0, end: 0, text: m.text, x: m.x, width: m.width, style: m.style, font: m.font, tracking: 0, wordSpacing: 0, caps: "normal", ascent: 0, descent: 0 };
            const sub = fragmentOutlines(node, markerFragment, m.text, 0, m.x, baseline, 0);
            if (!sub) return null;
            add(m.style.fills, sub);
        }
        for (const f of line.fragments) {
            const visible = Math.max(0, Math.min(f.x + f.width, line.x + line.width) - f.x);
            const sub = fragmentOutlines(node, f, f.text, 0, f.x, baseline, visible);
            if (!sub) return null;
            add(f.style.fills, sub);
        }
    }
    return [...groups.values()];
}

// All of a text layer's outlines in one list (for booleans and other shape tools), in the same
// space as shapeSubpaths: the layer's parent space, before its rotation.
export function textToSubpaths(node: SceneNode): Subpath[] | null {
    const groups = textOutlines(node);
    return groups ? groups.flatMap((g) => g.subpaths) : null;
}

export async function textToSubpathsAsync(node: SceneNode): Promise<Subpath[] | null> {
    await loadTextOutlines(node);
    return textToSubpaths(node);
}

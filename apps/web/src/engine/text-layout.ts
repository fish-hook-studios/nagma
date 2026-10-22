import type { SceneNode } from "./types";
import { type CharStyle, paragraphStyle, styleAt, styledRuns } from "./rich-text";
import { renderFamily, subscribeFontMetrics } from "./fonts";

// Lays out a text layer the way the canvas draws it: style runs, list markers and indentation,
// word wrapping (greedy, balanced or pretty), mixed sizes on a line, alignment, justification,
// paragraph and list spacing, truncation. Positions are relative to the layer's top-left.

export const AUTO_LINE_HEIGHT = 1.21;

export function fontString(size: number, weight: number, family: string, italic = false) {
    return `${italic ? "italic " : ""}${Math.round(weight)} ${size}px "${family}", system-ui, sans-serif`;
}

// A piece of one line in one style.
export interface Fragment {
    start: number;
    end: number;
    // The characters drawn (letter case applied, same length as start..end).
    text: string;
    x: number;
    width: number;
    style: CharStyle;
    font: string;
    // Letter spacing and extra space per space character (justified lines), in pixels.
    tracking: number;
    wordSpacing: number;
    caps: "normal" | "small-caps";
    ascent: number;
    descent: number;
}

export interface Marker {
    text: string;
    x: number;
    width: number;
    style: CharStyle;
    font: string;
}

export interface LayoutLine {
    start: number;
    // Where the next line starts (after any spaces it wrapped at), or the paragraph's end.
    end: number;
    top: number;
    height: number;
    // Distance from the layer's top to the baseline.
    baseline: number;
    // Left of the line's first character, and the width of its visible (non-trailing-space) text.
    x: number;
    width: number;
    fragments: Fragment[];
    marker?: Marker;
    paragraph: number;
    paragraphStart: boolean;
    paragraphEnd: boolean;
    // A hard end: a paragraph break or the end of the text (not a wrap).
    hard: boolean;
    // Space the line could take (for alignment and justification).
    left: number;
    room: number;
}

export interface TextLayout {
    lines: LayoutLine[];
    // The extent of the text, for auto width and auto height.
    width: number;
    height: number;
    // Truncated: characters from here on are hidden behind the ellipsis.
    truncatedAt: number | null;
}

let measureContext: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D | null {
    if (measureContext) return measureContext;
    if (typeof document === "undefined") return null;
    measureContext = document.createElement("canvas").getContext("2d");
    return measureContext;
}

const widthCache = new Map<string, number>();

export function applyFont(c: CanvasRenderingContext2D, font: string, tracking: number, caps: Fragment["caps"], wordSpacing = 0) {
    c.font = font;
    c.letterSpacing = `${tracking}px`;
    if ("fontVariantCaps" in c) c.fontVariantCaps = caps;
    if ("wordSpacing" in c) c.wordSpacing = `${wordSpacing}px`;
}

export function measureWidth(font: string, tracking: number, caps: Fragment["caps"], text: string): number {
    if (!text) return 0;
    const key = `${font}|${tracking}|${caps}|${text}`;
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;
    const c = ctx();
    let w: number;
    if (c) {
        applyFont(c, font, tracking, caps);
        w = c.measureText(text).width;
    } else {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
        w = text.length * size * 0.5 + text.length * tracking;
    }
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
    return w;
}

// The writing system a run is in, by its first letter outside Latin: lines are measured with that
// script's own letters, since Latin "Hg" says little about Arabic, Hebrew, Indic or Thai text.
export type Script = "latin" | "arabic" | "hebrew" | "devanagari" | "bengali" | "gurmukhi" | "gujarati" | "tamil" | "telugu" | "kannada" | "malayalam" | "sinhala" | "thai" | "cjk";
const SCRIPTS: [Script, RegExp][] = [
    ["arabic", /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/],
    ["hebrew", /[\u0590-\u05FF\uFB1D-\uFB4F]/],
    ["devanagari", /[\u0900-\u097F\uA8E0-\uA8FF]/],
    ["bengali", /[\u0980-\u09FF]/],
    ["gurmukhi", /[\u0A00-\u0A7F]/],
    ["gujarati", /[\u0A80-\u0AFF]/],
    ["tamil", /[\u0B80-\u0BFF]/],
    ["telugu", /[\u0C00-\u0C7F]/],
    ["kannada", /[\u0C80-\u0CFF]/],
    ["malayalam", /[\u0D00-\u0D7F]/],
    ["sinhala", /[\u0D80-\u0DFF]/],
    ["thai", /[\u0E00-\u0E7F]/],
    ["cjk", /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/],
];

export function scriptOf(text: string): Script {
    for (const ch of text) {
        if (ch.charCodeAt(0) < 0x0590) continue;
        for (const [script, re] of SCRIPTS) if (re.test(ch)) return script;
    }
    return "latin";
}

// Letters to measure each script with: a sample spanning its usual heights and depths, and the
// letter whose top stands for "cap height" (the headline, or the tallest common letter).
const SAMPLE: Record<Script, { line: string; cap: string }> = {
    latin: { line: "Hg", cap: "H" },
    arabic: { line: "مرحبا بالعالم", cap: "ا" },
    hebrew: { line: "שלום עולם", cap: "ה" },
    devanagari: { line: "नमस्ते दुनिया", cap: "क" },
    bengali: { line: "বাংলা ভাষা", cap: "ক" },
    gurmukhi: { line: "ਪੰਜਾਬੀ ਭਾਸ਼ਾ", cap: "ਕ" },
    gujarati: { line: "ગુજરાતી ભાષા", cap: "ક" },
    tamil: { line: "தமிழ் மொழி", cap: "க" },
    telugu: { line: "తెలుగు భాష", cap: "క" },
    kannada: { line: "ಕನ್ನಡ ಭಾಷೆ", cap: "ಕ" },
    malayalam: { line: "മലയാളം ഭാഷ", cap: "മ" },
    sinhala: { line: "සිංහල භාෂාව", cap: "ක" },
    thai: { line: "ภาษาไทย", cap: "ก" },
    cjk: { line: "永あ한", cap: "永" },
};

// The height of capital letters (or the script's own top line) above the baseline, for vertical trim.
const capCache = new Map<string, number>();
export function capHeight(font: string, size: number, text = ""): number {
    const script = scriptOf(text);
    const key = `${font}|${script}`;
    const hit = capCache.get(key);
    if (hit !== undefined) return hit;
    const c = ctx();
    let cap = size * 0.7;
    if (c) {
        c.font = font;
        cap = c.measureText(SAMPLE[script].cap).actualBoundingBoxAscent || cap;
    }
    capCache.set(key, cap);
    return cap;
}

// Characters that hang outside the text edge with hanging punctuation on.
const HANG_START = /^[\u201C\u2018"'\u00AB\u2039([\u2014\u2013\u2022*-]/;
const HANG_END = /[\u201D\u2019"'\u00BB\u203A)\].,;:!?\u2014\u2013-]$/;

// A font's ascent and descent: the font's own metrics (TextMetrics fontBoundingBoxAscent and
// Descent: what a browser lays CSS lines out with), measured with the run's script's letters. A
// browser without them falls back to how far that script's letters actually reach, with a little
// room, and to 0.8 and 0.2 of the size at least.
export function metricsFrom(m: Partial<Pick<TextMetrics, "fontBoundingBoxAscent" | "fontBoundingBoxDescent" | "actualBoundingBoxAscent" | "actualBoundingBoxDescent">> | null, size: number): { ascent: number; descent: number } {
    const fa = m?.fontBoundingBoxAscent;
    const fd = m?.fontBoundingBoxDescent;
    if (typeof fa === "number" && typeof fd === "number" && Number.isFinite(fa) && Number.isFinite(fd) && fa + fd > 0) return { ascent: fa, descent: fd };
    const inkUp = Number(m?.actualBoundingBoxAscent) || 0;
    const inkDown = Number(m?.actualBoundingBoxDescent) || 0;
    return { ascent: Math.max(size * 0.8, inkUp * 1.1), descent: Math.max(size * 0.2, inkDown * 1.15) };
}

const metricCache = new Map<string, { ascent: number; descent: number }>();
export function fontMetrics(font: string, size: number, text = ""): { ascent: number; descent: number } {
    const script = scriptOf(text);
    const key = `${font}|${script}`;
    const hit = metricCache.get(key);
    if (hit) return hit;
    const c = ctx();
    let m: TextMetrics | null = null;
    if (c) {
        c.font = font;
        m = c.measureText(SAMPLE[script].line);
    }
    const out = metricsFrom(m, size);
    metricCache.set(key, out);
    return out;
}

// Letter case as drawn. Small caps are drawn with the canvas's small-caps variant instead.
export function casedText(text: string, textCase: CharStyle["textCase"]): string {
    if (textCase === "upper") return text.toUpperCase();
    if (textCase === "lower") return text.toLowerCase();
    if (textCase === "title") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    return text;
}

// Keeps one character per character so positions map back to the text.
function casedSameLength(text: string, textCase: CharStyle["textCase"]): string {
    if (textCase === "none" || textCase === "small-caps") return text;
    // Forced small caps: every letter set as a small capital (lower-cased, then drawn in small caps).
    if (textCase === "small-caps-forced") return text.toLowerCase().length === text.length ? text.toLowerCase() : text;
    const whole = casedText(text, textCase);
    if (whole.length === text.length) return whole;
    let out = "";
    for (const ch of text) {
        const c = casedText(ch, textCase);
        out += c.length === ch.length ? c : ch;
    }
    return out;
}

export interface RunInfo {
    start: number;
    end: number;
    style: CharStyle;
    font: string;
    tracking: number;
    caps: Fragment["caps"];
    lineHeight: number;
    ascent: number;
    descent: number;
    text: string;
}

export function runInfo(style: CharStyle, start: number, end: number, text: string): RunInfo {
    const size = style.fontSize;
    const family = renderFamily(style.fontFamily, style.openType, style.fontVariations);
    const weight = style.fontVariations.wght ?? style.fontWeight;
    const font = fontString(size, weight, family, style.italic);
    const metrics = fontMetrics(font, size, text);
    return {
        start,
        end,
        style,
        font,
        tracking: (style.letterSpacing / 100) * size,
        caps: style.textCase === "small-caps" || style.textCase === "small-caps-forced" || style.openType.smcp ? "small-caps" : "normal",
        lineHeight: (style.lineHeight ?? AUTO_LINE_HEIGHT) * size,
        ascent: metrics.ascent,
        descent: metrics.descent,
        text: casedSameLength(text, style.textCase),
    };
}

// Markers: the reference keeps bullets the same at every level; numbers go 1. a. i. by level.
export function listMarker(list: "bullet" | "number", level: number, counter: number): string {
    if (list === "bullet") return "•";
    const kind = (Math.max(1, level) - 1) % 3;
    if (kind === 1) return `${alpha(counter)}.`;
    if (kind === 2) return `${roman(counter)}.`;
    return `${counter}.`;
}

function alpha(n: number): string {
    let s = "";
    let v = n;
    while (v > 0) {
        v--;
        s = String.fromCharCode(97 + (v % 26)) + s;
        v = Math.floor(v / 26);
    }
    return s || "a";
}

function roman(n: number): string {
    const table: [number, string][] = [
        [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
    ];
    let v = Math.max(1, n);
    let s = "";
    for (const [value, sym] of table) {
        while (v >= value) {
            s += sym;
            v -= value;
        }
    }
    return s;
}

interface Token {
    start: number;
    end: number;
    // Width with and without its trailing spaces.
    width: number;
    visible: number;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯぀-ヿ]/u;

export function layoutText(node: SceneNode): TextLayout {
    const cached = layoutCache.get(node);
    if (cached && cached.gen === generation) return cached.layout;
    const layout = compute(node);
    layoutCache.set(node, { gen: generation, layout });
    return layout;
}

let generation = 0;
const layoutCache = new WeakMap<SceneNode, { gen: number; layout: TextLayout }>();

export function clearLayoutCache() {
    generation++;
    widthCache.clear();
    metricCache.clear();
    capCache.clear();
}

// Fonts that finish loading change measurements.
subscribeFontMetrics(clearLayoutCache);

function compute(node: SceneNode): TextLayout {
    const text = node.text ?? "";
    const wrapWidth = node.sizing.h !== "hug" ? Math.max(1, node.w) : null;
    const infos = styledRuns(node).map((run) => runInfo(run.style, run.start, run.end, text.slice(run.start, run.end)));
    const infoAt = (index: number): RunInfo => {
        let lo = 0;
        let hi = infos.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if ((infos[mid]?.start ?? 0) <= index) lo = mid;
            else hi = mid - 1;
        }
        return infos[lo] as RunInfo;
    };
    // Width of text[a..b) across runs.
    const widthOf = (a: number, b: number) => {
        let w = 0;
        let i = a;
        while (i < b) {
            const info = infoAt(i);
            const e = Math.min(b, info.end);
            w += measureWidth(info.font, info.tracking, info.caps, info.text.slice(i - info.start, e - info.start));
            i = e;
        }
        return w;
    };
    const align = node.textAlign ?? (node.direction === "rtl" ? "right" : "left");
    const rtl = node.direction === "rtl";
    const wrapMode = node.textWrap ?? "auto";
    const paragraphIndent = node.paragraphIndent ?? 0;
    const boxWidth = Math.max(1, node.w);

    const lines: LayoutLine[] = [];
    const counters: number[] = [];
    let p = 0;
    let ps = 0;
    while (ps <= text.length) {
        let pe = text.indexOf("\n", ps);
        if (pe < 0) pe = text.length;
        const para = paragraphStyle(node, p);
        const first = infoAt(Math.min(ps, Math.max(0, text.length - 1)));
        const size = (ps < text.length && text[ps] !== "\n" ? infoAt(ps) : first).style.fontSize;
        const unit = 1.5 * size;
        // Numbering: counts per level, restarting under a new parent item or after plain text.
        let marker: Marker | undefined;
        if (para.list) {
            const level = para.level;
            counters.length = Math.max(counters.length, level + 1);
            for (let l = level + 1; l < counters.length; l++) counters[l] = 0;
            counters[level] = para.list === "number" ? (counters[level] ?? 0) + 1 : 0;
            const style = (ps < pe ? infoAt(ps) : first).style;
            const info = runInfo(style, 0, 0, "");
            const markerText = listMarker(para.list, level, counters[level] ?? 1);
            marker = { text: markerText, x: 0, width: measureWidth(info.font, 0, "normal", markerText), style, font: info.font };
        } else counters.length = 0;
        const hang = Boolean(node.hangingList && para.list);
        const contentLeft = Math.max(0, (hang ? para.level - 1 : para.level) * unit);
        const firstIndent = para.list ? 0 : paragraphIndent;
        // Soft line breaks (U+2028) split the paragraph into segments that wrap on their own.
        let ss = ps;
        let lineInParagraph = 0;
        const paraLines: LayoutLine[] = [];
        while (true) {
            let se = text.indexOf("\u2028", ss);
            if (se < 0 || se > pe) se = pe;
            const roomFor = (i: number) => (wrapWidth === null ? Number.POSITIVE_INFINITY : Math.max(1, wrapWidth - contentLeft - (i === 0 ? firstIndent : 0)));
            const tokens = tokenize(text, ss, se, widthOf, roomFor(1), wrapWidth !== null);
            const breaks = wrapWidth === null ? [0] : breakLines(tokens, (i) => roomFor(lineInParagraph + i), wrapMode);
            breaks.forEach((at, bi) => {
                const next = breaks[bi + 1];
                const a = tokens[at]?.start ?? ss;
                const b = next !== undefined ? (tokens[next]?.start ?? se) : se;
                const indent = lineInParagraph === 0 ? firstIndent : 0;
                paraLines.push(makeLine(a, b, next === undefined, contentLeft + indent, roomFor(lineInParagraph), p, lineInParagraph === 0));
                lineInParagraph++;
            });
            if (se >= pe) break;
            ss = se + 1;
        }
        const firstLine = paraLines[0];
        if (firstLine && marker) {
            firstLine.marker = marker;
            marker.x = para.list === "bullet" ? contentLeft - unit / 2 - marker.width / 2 : contentLeft - size / 3 - marker.width;
        }
        const lastLine = paraLines[paraLines.length - 1];
        if (lastLine) {
            lastLine.paragraphEnd = true;
            lastLine.hard = true;
            lastLine.end = pe;
        }
        lines.push(...paraLines);
        p++;
        if (pe >= text.length) break;
        ps = pe + 1;
    }

    function makeLine(a: number, b: number, segmentEnd: boolean, left: number, room: number, paragraph: number, paragraphStart: boolean): LayoutLine {
        // Trailing spaces at a wrap stay on the line but don't count for its width.
        let visibleEnd = b;
        while (visibleEnd > a && /\s/.test(text[visibleEnd - 1] ?? "")) visibleEnd--;
        if (segmentEnd) visibleEnd = Math.max(visibleEnd, a);
        const drawEnd = b;
        const fragments: Fragment[] = [];
        let i = a;
        let x = 0;
        while (i < drawEnd) {
            const info = infoAt(i);
            const e = Math.min(drawEnd, info.end);
            const slice = info.text.slice(i - info.start, e - info.start).replace(/[\n\u2028]/g, " ");
            const width = measureWidth(info.font, info.tracking, info.caps, slice);
            fragments.push({ start: i, end: e, text: slice, x, width, style: info.style, font: info.font, tracking: info.tracking, wordSpacing: 0, caps: info.caps, ascent: info.ascent, descent: info.descent });
            x += width;
            i = e;
        }
        const width = visibleEnd > a ? widthOf(a, visibleEnd) : 0;
        // Line box: half-leading around each run's own box, aligned on one baseline (as in CSS).
        const metricsOf = fragments.length ? fragments.map((f) => infoAt(f.start)) : [infoAt(Math.max(0, Math.min(a, text.length - 1)))];
        let baseline = 0;
        for (const m of metricsOf) baseline = Math.max(baseline, (m.lineHeight - (m.ascent + m.descent)) / 2 + m.ascent);
        let height = 0;
        for (const m of metricsOf) height = Math.max(height, baseline - ((m.lineHeight - (m.ascent + m.descent)) / 2 + m.ascent) + m.lineHeight);
        return { start: a, end: b, top: 0, height, baseline, x: left, width, fragments, paragraph, paragraphStart, paragraphEnd: false, hard: segmentEnd, left, room };
    }

    // Truncation: keep the first lines and end the last one with an ellipsis.
    let truncatedAt: number | null = null;
    const maxLines = node.truncate === false ? null : (node.maxLines ?? null);
    if (maxLines && maxLines > 0 && lines.length > maxLines) {
        lines.length = maxLines;
        const last = lines[maxLines - 1] as LayoutLine;
        truncatedAt = last.end;
        ellipsize(last, wrapWidth);
    }

    // Vertical placement: paragraph spacing before paragraphs, list spacing between list items.
    let y = 0;
    lines.forEach((line, i) => {
        if (i > 0 && line.paragraphStart) {
            const prevList = paragraphStyle(node, line.paragraph - 1).list;
            const thisList = paragraphStyle(node, line.paragraph).list;
            y += prevList && thisList ? (node.listSpacing ?? 0) : (node.paragraphSpacing ?? 0);
        }
        line.top = y;
        line.baseline += y;
        y += line.height;
    });
    let height = y;
    // Vertical trim: the box runs from the first line's cap height to the last line's baseline.
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    if (node.leadingTrim === "cap" && firstLine && lastLine) {
        const lead = firstLine.fragments[0] ?? null;
        const cap = lead ? capHeight(lead.font, lead.style.fontSize, lead.text) : capHeight(infoAt(0).font, infoAt(0).style.fontSize, infoAt(0).text);
        const trimTop = Math.max(0, firstLine.baseline - cap);
        const trimBottom = Math.max(0, lastLine.top + lastLine.height - lastLine.baseline);
        for (const line of lines) {
            line.top -= trimTop;
            line.baseline -= trimTop;
        }
        height = Math.max(0, y - trimTop - trimBottom);
    }
    const contentWidth = Math.max(0, ...lines.map((l) => l.left + l.width));
    const width = wrapWidth === null ? contentWidth : boxWidth;
    // Horizontal placement within the box (auto width boxes are as wide as their longest line).
    const areaWidth = wrapWidth === null ? contentWidth : boxWidth;
    for (const line of lines) {
        const room = Math.max(0, areaWidth - line.left);
        let offset = 0;
        if (align === "center") offset = (room - line.width) / 2;
        else if (align === "right") offset = room - line.width;
        // Justified: every line but a paragraph's last stretches its spaces to the box width.
        if (align === "justify" && wrapWidth !== null && !line.hard && !line.paragraphEnd) {
            const visible = text.slice(line.start, line.end).replace(/\s+$/, "");
            const spaces = (visible.match(/ /g) ?? []).length;
            if (spaces > 0) {
                const extra = Math.max(0, (room - line.width) / spaces);
                let shift = 0;
                for (const f of line.fragments) {
                    f.x += shift;
                    f.wordSpacing = extra;
                    const inFrag = (text.slice(f.start, Math.min(f.end, line.start + visible.length)).match(/ /g) ?? []).length;
                    f.width += inFrag * extra;
                    shift += inFrag * extra;
                }
                line.width = room;
            }
        }
        if (rtl && align !== "justify") {
            // Right to left: fragments run from the right edge leftwards in reading order.
            let right = line.left + offset + line.width;
            for (const f of line.fragments) {
                f.x = right - f.width;
                right -= f.width;
            }
        } else for (const f of line.fragments) f.x += line.left + offset;
        line.x = line.left + offset;
        if (line.marker) line.marker.x += offset > 0 && align !== "left" ? offset : 0;
        // Hanging punctuation: an opening mark at a left edge moves out past it, a closing mark at a
        // right edge likewise.
        if (node.hangingPunctuation && !rtl && line.fragments.length) {
            const first = line.fragments[0] as Fragment;
            const last = line.fragments[line.fragments.length - 1] as Fragment;
            const visible = last.text.replace(/\s+$/, "");
            let shift = 0;
            if ((align === "left" || align === "justify") && HANG_START.test(first.text)) shift = -measureWidth(first.font, first.tracking, first.caps, first.text.charAt(0));
            else if (align === "right" && HANG_END.test(visible)) shift = measureWidth(last.font, last.tracking, last.caps, visible.slice(-1));
            if (shift) {
                for (const f of line.fragments) f.x += shift;
                line.x += shift;
            }
        }
    }
    return { lines, width, height, truncatedAt };
}

function ellipsize(line: LayoutLine, wrapWidth: number | null) {
    const last = line.fragments[line.fragments.length - 1];
    if (!last) return;
    const room = wrapWidth === null ? Number.POSITIVE_INFINITY : line.room;
    let keep = last.text;
    const fixed = line.fragments.slice(0, -1).reduce((w, f) => w + f.width, 0);
    while (keep.length && fixed + measureWidth(last.font, last.tracking, last.caps, `${keep}…`) > room) keep = keep.slice(0, -1);
    keep = keep.replace(/\s+$/, "");
    last.text = `${keep}…`;
    last.end = last.start + keep.length;
    last.width = measureWidth(last.font, last.tracking, last.caps, last.text);
    line.width = fixed + last.width;
    line.hard = true;
}

// Break opportunities: after spaces, and between CJK characters. A word wider than the box is
// split by character.
function tokenize(text: string, a: number, b: number, widthOf: (a: number, b: number) => number, room: number, wrapping: boolean): Token[] {
    const tokens: Token[] = [];
    let i = a;
    while (i < b) {
        let j = i;
        if (/\s/.test(text[j] ?? "") && j === a) {
            while (j < b && /\s/.test(text[j] ?? "")) j++;
        } else if (CJK.test(text[j] ?? "")) {
            j++;
        } else {
            while (j < b && !/\s/.test(text[j] ?? "") && !CJK.test(text[j] ?? "")) j++;
        }
        let k = j;
        while (k < b && /\s/.test(text[k] ?? "")) k++;
        if (j === i) j = k = Math.max(k, i + 1);
        const visible = widthOf(i, j);
        if (wrapping && visible > room && j - i > 1) {
            // Split an overlong word into pieces that fit.
            let s = i;
            while (s < j) {
                let e = s + 1;
                while (e < j && widthOf(s, e + 1) <= room) e++;
                const end = e === j ? k : e;
                tokens.push({ start: s, end, width: widthOf(s, end), visible: widthOf(s, e) });
                s = e === j ? k : e;
                if (e === j) break;
            }
        } else tokens.push({ start: i, end: k, width: widthOf(i, k), visible });
        i = k;
    }
    return tokens;
}

// Line starts (token indices). Greedy fills each line; balance narrows the measure until the line
// count would grow, so lines come out even; pretty minimises raggedness and avoids a lone last word.
function breakLines(tokens: Token[], room: (line: number) => number, mode: "auto" | "balance" | "pretty"): number[] {
    if (tokens.length === 0) return [0];
    const greedy = (limit: (line: number) => number) => {
        const starts = [0];
        let w = 0;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i] as Token;
            const line = starts.length - 1;
            if (i > starts[line]! && w + t.visible > limit(line) + 0.01) {
                starts.push(i);
                w = t.width;
            } else w += t.width;
        }
        return starts;
    };
    const plain = greedy(room);
    if (mode === "auto" || plain.length < 2) return plain;
    if (mode === "balance") {
        // Same number of lines as greedy, as even as possible: minimise the spread of line widths
        // around the average (every line counts, the last one too).
        const n = plain.length;
        // Long paragraphs keep greedy breaking (like browsers, which balance only short blocks).
        if (n > 12) return plain;
        const total = tokens.reduce((sum, t) => sum + t.width, 0) - ((tokens[tokens.length - 1]?.width ?? 0) - (tokens[tokens.length - 1]?.visible ?? 0));
        const target = total / n;
        const m = tokens.length;
        // best[k][j]: lowest cost to lay tokens[0..j) on k lines.
        const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY));
        const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
        best[0]![0] = 0;
        for (let k = 1; k <= n; k++) {
            for (let j = 1; j <= m; j++) {
                let w = 0;
                for (let i = j - 1; i >= 0; i--) {
                    const t = tokens[i] as Token;
                    const visible = w + t.visible;
                    w += t.width;
                    if (visible > room(k - 1) + 0.01 && i < j - 1) break;
                    const prev = best[k - 1]![i] ?? Number.POSITIVE_INFINITY;
                    if (!Number.isFinite(prev)) continue;
                    const cost = prev + (visible - target) ** 2;
                    if (cost < best[k]![j]!) {
                        best[k]![j] = cost;
                        from[k]![j] = i;
                    }
                }
            }
        }
        if (!Number.isFinite(best[n]![m]!)) return plain;
        const starts: number[] = [];
        let j = m;
        for (let k = n; k >= 1; k--) {
            const i = from[k]![j] ?? 0;
            starts.unshift(i);
            j = i;
        }
        return starts;
    }
    // Pretty: dynamic programming over break points (Knuth–Plass without hyphenation).
    const n = tokens.length;
    const cost = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const from = new Array<number>(n + 1).fill(0);
    const lineNo = new Array<number>(n + 1).fill(0);
    cost[0] = 0;
    for (let j = 1; j <= n; j++) {
        let w = 0;
        for (let i = j - 1; i >= 0; i--) {
            const t = tokens[i] as Token;
            const visible = w + t.visible;
            w += t.width;
            const line = lineNo[i] ?? 0;
            const limit = room(line);
            if (visible > limit + 0.01 && i < j - 1) break;
            if (!Number.isFinite(cost[i]!)) continue;
            const slack = Math.max(0, limit - visible);
            let c: number;
            if (j === n) {
                // The last line may be short, but not a single word under a longer paragraph.
                c = j - i === 1 && i > 0 ? limit * limit * 0.5 : 0;
                if (visible < limit * 0.15 && i > 0) c += limit * limit * 0.25;
            } else c = slack * slack;
            const total = (cost[i] ?? 0) + c;
            if (total < (cost[j] ?? Number.POSITIVE_INFINITY)) {
                cost[j] = total;
                from[j] = i;
                lineNo[j] = line + 1;
            }
        }
    }
    if (!Number.isFinite(cost[n]!)) return plain;
    const starts: number[] = [];
    let j = n;
    while (j > 0) {
        starts.unshift(from[j] ?? 0);
        j = from[j] ?? 0;
    }
    return starts.length ? starts : plain;
}

// Where the caret goes for an index: x, and the line it's on. At a wrap, the caret sits at the
// start of the next line unless `upstream`.
export function caretAt(layout: TextLayout, index: number, upstream = false): { x: number; line: LayoutLine; lineIndex: number } | null {
    const lines = layout.lines;
    if (!lines.length) return null;
    let li = lines.findIndex((l, i) => index >= l.start && (index < l.end || (index === l.end && (l.hard || upstream || i === lines.length - 1))));
    if (li < 0) li = index < (lines[0]?.start ?? 0) ? 0 : lines.length - 1;
    const line = lines[li] as LayoutLine;
    return { x: xAt(line, index), line, lineIndex: li };
}

// The x of an index on a line.
export function xAt(line: LayoutLine, index: number): number {
    if (!line.fragments.length) return line.x;
    for (const f of line.fragments) {
        if (index >= f.start && index <= f.end) return f.x + prefixWidth(f, index - f.start);
    }
    const last = line.fragments[line.fragments.length - 1] as Fragment;
    return index <= line.fragments[0]!.start ? line.fragments[0]!.x : last.x + last.width;
}

// Width of a fragment's first n characters, including justified space.
export function prefixWidth(f: Fragment, n: number): number {
    if (n <= 0) return 0;
    const prefix = f.text.slice(0, n);
    const spaces = f.wordSpacing ? (prefix.match(/ /g) ?? []).length : 0;
    return measureWidth(f.font, f.tracking, f.caps, prefix) + spaces * f.wordSpacing;
}

// The index under a point (layer coordinates, before vertical alignment).
export function indexAt(layout: TextLayout, x: number, y: number): number {
    const lines = layout.lines;
    if (!lines.length) return 0;
    let line = lines[lines.length - 1] as LayoutLine;
    for (const l of lines) {
        if (y < l.top + l.height) {
            line = l;
            break;
        }
    }
    let best = line.start;
    let bestDist = Number.POSITIVE_INFINITY;
    // The last index a click on this line can give: before the wrap's trailing space.
    const lastIndex = line.hard ? line.end : Math.max(line.start, line.end - 1);
    for (let i = line.start; i <= lastIndex; i++) {
        const d = Math.abs(xAt(line, i) - x);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

// Highlight boxes for a range, one per line it touches.
export function rangeRects(layout: TextLayout, start: number, end: number): { x: number; y: number; w: number; h: number }[] {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    if (end <= start) return out;
    for (const line of layout.lines) {
        if (end < line.start || start > line.end || (end === line.start && line.end > line.start)) continue;
        const a = Math.max(start, line.start);
        const b = Math.min(end, line.end);
        const x1 = xAt(line, a);
        let x2 = xAt(line, b);
        // A selected paragraph break shows as a little extra at the line's end.
        if (end > line.end && line.hard) x2 += (line.fragments[0]?.style.fontSize ?? 12) * 0.3;
        if (x2 > x1) out.push({ x: x1, y: line.top, w: x2 - x1, h: line.height });
    }
    return out;
}

// Vertical offset of the text block in its box (top, middle or bottom).
export function verticalOffset(node: SceneNode, layout: TextLayout): number {
    if (node.textAlignV === "middle") return (node.h - layout.height) / 2;
    if (node.textAlignV === "bottom") return node.h - layout.height;
    return 0;
}

// The style a fragment-less empty layer would draw in (for the caret).
export function emptyStyle(node: SceneNode): CharStyle {
    return styleAt(node, 0);
}

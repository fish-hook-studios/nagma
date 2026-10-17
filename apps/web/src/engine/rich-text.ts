import type { Paint, ParagraphStyle, SceneNode, SpanStyle, TextCase, TextDecorationStyle, TextSpan } from "./types";

// Rich text: a text layer's own type settings apply to every character, and `spans` override them
// for ranges (the reference's character style overrides). Spans never overlap and are kept sorted; edits
// work on a per-character view and fold it back into spans.

export const SPAN_KEYS = ["fontFamily", "fontWeight", "fontSize", "italic", "fills", "decoration", "decorationStyle", "decorationOffset", "decorationThickness", "decorationColor", "decorationSkipInk", "letterSpacing", "lineHeight", "hyperlink", "textCase", "openType", "fontVariations", "textStyleId"] as const;
export type SpanKey = (typeof SPAN_KEYS)[number];

// Every character property, resolved.
export interface CharStyle {
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    italic: boolean;
    fills: Paint[];
    decoration: "none" | "underline" | "strikethrough";
    decorationStyle: TextDecorationStyle;
    decorationOffset: number | null;
    decorationThickness: number | null;
    decorationColor: string | null;
    decorationSkipInk: boolean;
    letterSpacing: number;
    lineHeight: number | null;
    hyperlink: string | null;
    textCase: TextCase;
    openType: Record<string, boolean>;
    fontVariations: Record<string, number>;
    textStyleId: string | null;
}

export interface StyledRun {
    start: number;
    end: number;
    style: CharStyle;
    // The overrides the range carries over the layer (empty for plain runs).
    own: SpanStyle;
}

export const MIXED = Symbol("mixed");
export type Mixed = typeof MIXED;

const EMPTY_FEATURES: Record<string, boolean> = {};
const EMPTY_AXES: Record<string, number> = {};

export function baseStyle(node: SceneNode): CharStyle {
    return {
        fontFamily: node.fontFamily ?? "Inter",
        fontWeight: node.fontWeight ?? 400,
        fontSize: node.fontSize ?? 16,
        italic: node.italic ?? false,
        fills: node.fills,
        decoration: node.decoration ?? "none",
        decorationStyle: node.decorationStyle ?? "solid",
        decorationOffset: node.decorationOffset ?? null,
        decorationThickness: node.decorationThickness ?? null,
        decorationColor: node.decorationColor ?? null,
        decorationSkipInk: node.decorationSkipInk ?? true,
        letterSpacing: node.letterSpacing ?? 0,
        lineHeight: node.lineHeight ?? null,
        hyperlink: node.hyperlink ?? null,
        textCase: node.textCase ?? "none",
        openType: node.openType ?? EMPTY_FEATURES,
        fontVariations: node.fontVariations ?? EMPTY_AXES,
        textStyleId: node.textStyleId ?? null,
    };
}

export function ownStyle(span: SpanStyle): SpanStyle {
    const out: SpanStyle = {};
    for (const key of SPAN_KEYS) if (span[key] !== undefined) (out as Record<string, unknown>)[key] = span[key];
    return out;
}

function merged(base: CharStyle, own: SpanStyle): CharStyle {
    const out = { ...base };
    for (const key of SPAN_KEYS) if (own[key] !== undefined) (out as Record<string, unknown>)[key] = own[key];
    // Feature and axis overrides add to the layer's rather than replacing them.
    if (own.openType) out.openType = { ...base.openType, ...own.openType };
    if (own.fontVariations) out.fontVariations = { ...base.fontVariations, ...own.fontVariations };
    return out;
}

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Sorted, clamped, non-empty spans with neighbours of the same style merged.
export function normalizeSpans(spans: TextSpan[] | undefined, length: number): TextSpan[] {
    if (!spans?.length) return [];
    const sorted = spans
        .map((s) => ({ ...ownStyle(s), start: Math.max(0, Math.min(length, s.start)), end: Math.max(0, Math.min(length, s.end)) }))
        .filter((s) => s.end > s.start && Object.keys(s).length > 2)
        .sort((a, b) => a.start - b.start);
    const out: TextSpan[] = [];
    for (const span of sorted) {
        const last = out[out.length - 1];
        if (last && span.start < last.end) span.start = last.end;
        if (span.end <= span.start) continue;
        if (last && last.end === span.start && sameJson(ownStyle(last), ownStyle(span))) last.end = span.end;
        else out.push(span);
    }
    return out;
}

// The text split into runs of one style, covering every character.
const runCache = new WeakMap<SceneNode, StyledRun[]>();
export function styledRuns(node: SceneNode): StyledRun[] {
    const cached = runCache.get(node);
    if (cached) return cached;
    const length = (node.text ?? "").length;
    const base = baseStyle(node);
    const out: StyledRun[] = [];
    let at = 0;
    for (const span of normalizeSpans(node.spans, length)) {
        if (span.start > at) out.push({ start: at, end: span.start, style: base, own: {} });
        const own = ownStyle(span);
        out.push({ start: span.start, end: span.end, style: merged(base, own), own });
        at = span.end;
    }
    if (at < length || out.length === 0) out.push({ start: at, end: length, style: base, own: {} });
    runCache.set(node, out);
    return out;
}

export function hasSpans(node: SceneNode): boolean {
    return Boolean(node.spans?.length);
}

// The style of one character (the last one when `index` is at the end).
export function styleAt(node: SceneNode, index: number): CharStyle {
    const runs = styledRuns(node);
    for (const run of runs) if (index >= run.start && index < run.end) return run.style;
    return runs[runs.length - 1]?.style ?? baseStyle(node);
}

export function ownAt(node: SceneNode, index: number): SpanStyle {
    for (const run of styledRuns(node)) if (index >= run.start && index < run.end) return run.own;
    return {};
}

// The value a property has across a range: one value, or MIXED. An empty range reads the character
// before it (what typing there would continue).
export function rangeValue<K extends keyof CharStyle>(node: SceneNode, start: number, end: number, key: K): CharStyle[K] | Mixed {
    if (end <= start) return styleAt(node, Math.max(0, start - 1))[key];
    let value: CharStyle[K] | undefined;
    let first = true;
    for (const run of styledRuns(node)) {
        if (run.end <= start || run.start >= end) continue;
        if (first) {
            value = run.style[key];
            first = false;
        } else if (!sameJson(value, run.style[key])) return MIXED;
    }
    return first ? baseStyle(node)[key] : (value as CharStyle[K]);
}

// Per character: the override object each one carries (shared references between characters of a run).
function perChar(node: SceneNode): SpanStyle[] {
    const length = (node.text ?? "").length;
    const out: SpanStyle[] = new Array(length);
    for (const run of styledRuns(node)) for (let i = run.start; i < run.end; i++) out[i] = run.own;
    return out;
}

function fromChars(chars: SpanStyle[]): TextSpan[] {
    const out: TextSpan[] = [];
    let i = 0;
    while (i < chars.length) {
        const own = chars[i] ?? {};
        let j = i + 1;
        while (j < chars.length && (chars[j] === own || sameJson(chars[j], own))) j++;
        if (Object.keys(own).length) out.push({ ...own, start: i, end: j });
        i = j;
    }
    return out;
}

// Sets properties on a range; `undefined` values remove the override (back to the layer's value).
export function styleRange(node: SceneNode, start: number, end: number, patch: SpanStyle): TextSpan[] {
    const chars = perChar(node);
    const memo = new Map<SpanStyle, SpanStyle>();
    for (let i = Math.max(0, start); i < Math.min(chars.length, end); i++) {
        const own = chars[i] ?? {};
        let next = memo.get(own);
        if (!next) {
            next = { ...own };
            for (const [key, value] of Object.entries(patch)) {
                if (value === undefined) delete (next as Record<string, unknown>)[key];
                else (next as Record<string, unknown>)[key] = value;
            }
            memo.set(own, next);
        }
        chars[i] = next;
    }
    return fromChars(chars);
}

// A whole-layer edit of these properties: the spans stop overriding them: setting a property with the layer selected sets it on every character.
export function withoutKeys(node: SceneNode, keys: string[]): TextSpan[] | undefined {
    if (!node.spans?.length) return node.spans;
    const strip = new Set(keys);
    if (!node.spans.some((s) => Object.keys(s).some((k) => strip.has(k)))) return node.spans;
    return normalizeSpans(
        node.spans.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !strip.has(k))) as unknown as TextSpan),
        (node.text ?? "").length,
    );
}

// Paragraph i's list settings (the layer's `list` when it has no per-paragraph entry).
export function paragraphStyle(node: SceneNode, i: number): Required<ParagraphStyle> {
    const own = node.paragraphs?.[i];
    const list = own ? (own.list ?? null) : (node.list ?? null);
    const level = own?.level ?? (list ? 1 : 0);
    return { list, level: list ? Math.max(1, level) : Math.max(0, level) };
}

export function paragraphCount(text: string): number {
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

export function paragraphIndex(text: string, offset: number): number {
    let n = 0;
    for (let i = 0; i < Math.min(offset, text.length); i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

// Every paragraph's settings as an explicit list, ready to change some of them.
export function materializeParagraphs(node: SceneNode): ParagraphStyle[] {
    const n = paragraphCount(node.text ?? "");
    return Array.from({ length: n }, (_, i) => {
        const p = paragraphStyle(node, i);
        return { list: p.list, level: p.level };
    });
}

// Drops per-paragraph entries that say the same as the layer, so plain layers stay plain.
export function tidyParagraphs(paragraphs: ParagraphStyle[] | undefined): ParagraphStyle[] | undefined {
    if (!paragraphs?.length) return undefined;
    return paragraphs.some((p) => p.list || (p.level ?? 0) > 0) ? paragraphs.map((p) => ({ list: p.list ?? null, level: p.level ?? 0 })) : undefined;
}

export interface RichText {
    text: string;
    spans: TextSpan[];
    paragraphs?: ParagraphStyle[];
}

// Replaces start..end with `insert`. Inserted characters take `styles` when given (one override
// object per character, as copied), else the style typed into (`typing`, or the character before).
export function spliceText(node: SceneNode, start: number, end: number, insert: string, options: { styles?: SpanStyle[]; typing?: SpanStyle | null; paragraphs?: ParagraphStyle[] } = {}): RichText {
    const text = node.text ?? "";
    const a = Math.max(0, Math.min(text.length, start));
    const b = Math.max(a, Math.min(text.length, end));
    const chars = perChar(node);
    const before = a > 0 ? chars[a - 1] : chars[b];
    const inherit = options.typing ?? before ?? {};
    const inserted = options.styles ?? new Array<SpanStyle>(insert.length).fill(inherit);
    chars.splice(a, b - a, ...inserted.slice(0, insert.length));
    while (chars.length < text.length - (b - a) + insert.length) chars.push(inherit);
    const nextText = text.slice(0, a) + insert + text.slice(b);
    // Paragraph settings: the paragraph the edit starts in keeps its own; new paragraphs copy it
    // (Return in a list item starts another item); pasted ones bring their own when given.
    let paragraphs: ParagraphStyle[] | undefined;
    if (node.paragraphs?.length || options.paragraphs?.length) {
        const list = materializeParagraphs(node);
        const p0 = paragraphIndex(text, a);
        const removed = paragraphCount(text.slice(a, b)) - 1;
        const added = paragraphCount(insert) - 1;
        const copy = list[p0] ?? { list: null, level: 0 };
        const fresh = Array.from({ length: added }, (_, i) => options.paragraphs?.[i + 1] ?? { ...copy });
        paragraphs = tidyParagraphs([...list.slice(0, p0 + 1), ...fresh, ...list.slice(p0 + removed + 1)]);
    }
    return { text: nextText, spans: fromChars(chars), ...(paragraphs !== undefined || node.paragraphs ? { paragraphs } : {}) };
}

// A slice of rich text for the clipboard: every character's full style, so it keeps its look
// when pasted into another layer.
export interface RichClip {
    text: string;
    styles: SpanStyle[];
    paragraphs: ParagraphStyle[];
}

export function sliceRich(node: SceneNode, start: number, end: number): RichClip {
    const text = (node.text ?? "").slice(start, end);
    const styles: SpanStyle[] = [];
    const memo = new Map<CharStyle, SpanStyle>();
    for (const run of styledRuns(node)) {
        for (let i = Math.max(start, run.start); i < Math.min(end, run.end); i++) {
            let full = memo.get(run.style);
            if (!full) {
                const { textStyleId, ...rest } = run.style;
                full = { ...rest, ...(textStyleId ? { textStyleId } : {}) };
                memo.set(run.style, full);
            }
            styles.push(full);
        }
    }
    const p0 = paragraphIndex(node.text ?? "", start);
    const paragraphs = Array.from({ length: paragraphCount(text) }, (_, i) => paragraphStyle(node, p0 + i));
    return { text, styles, paragraphs };
}

// Full character styles relative to another layer: only what differs from its own settings.
export function relativeTo(node: SceneNode, styles: SpanStyle[]): SpanStyle[] {
    const base = baseStyle(node);
    const memo = new Map<SpanStyle, SpanStyle>();
    return styles.map((full) => {
        let own = memo.get(full);
        if (!own) {
            own = {};
            for (const key of SPAN_KEYS) {
                const v = full[key];
                if (v !== undefined && !sameJson(v, base[key])) (own as Record<string, unknown>)[key] = v;
            }
            memo.set(full, own);
        }
        return own;
    });
}

// Word boundaries for double-click selection and ⌥ arrows.
export function wordAt(text: string, index: number): [number, number] {
    const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_'’]/u.test(c);
    let a = index;
    let b = index;
    if (!isWord(text[index]) && isWord(text[index - 1])) {
        a = index - 1;
        b = index - 1;
    }
    if (!isWord(text[a])) return [index, Math.min(text.length, index + 1)];
    while (a > 0 && isWord(text[a - 1])) a--;
    while (b < text.length && isWord(text[b])) b++;
    return [a, b];
}

export function paragraphBounds(text: string, index: number): [number, number] {
    const start = index <= 0 ? 0 : text.lastIndexOf("\n", index - 1) + 1;
    const nl = text.indexOf("\n", index);
    return [start, nl < 0 ? text.length : nl];
}

// Converts styles to the patch a whole-layer edit writes: the layer value, with spans cleared of it.
export function layerPatch(node: SceneNode, patch: Partial<SceneNode>): Partial<SceneNode> {
    const keys = Object.keys(patch).filter((k) => (SPAN_KEYS as readonly string[]).includes(k));
    if (!keys.length || !node.spans?.length) return patch;
    return { ...patch, spans: withoutKeys(node, keys) ?? [] };
}

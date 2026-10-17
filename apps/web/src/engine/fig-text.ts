import type { Paint, ParagraphStyle, SpanStyle, TextSpan } from "./types";

// Rich text from an imported file: textData.characterStyleIDs says which entry of
// textData.styleOverrideTable styles each character (0 or past the end: the layer's own), and
// textData.lines carries each paragraph's list type and indentation. Each entry may name a text
// style (its settings come first) and a fill style.

type Fig = Record<string, unknown>;

interface Context {
    // Resolves a style reference to the style's own node (its fields are the style's settings).
    styleOf: (ref: unknown) => Fig | undefined;
    paints: (list: Fig[] | undefined) => Promise<Paint[]>;
    weightOf: (style: string | undefined) => number;
}

const TEXT_FIELDS = ["fontSize", "fontName", "lineHeight", "letterSpacing", "textCase", "textDecoration"];

// OpenType settings the format stores as named fields, plus raw toggled feature tags.
export function figFeatures(f: Fig): Record<string, boolean> | undefined {
    const out: Record<string, boolean> = {};
    if (f.fontVariantCommonLigatures === false) out.liga = false;
    if (f.fontVariantContextualLigatures === false) out.calt = false;
    if (f.fontVariantDiscretionaryLigatures === true) out.dlig = true;
    if (f.fontVariantHistoricalLigatures === true) out.hlig = true;
    if (f.fontVariantOrdinal === true) out.ordn = true;
    if (f.fontVariantSlashedZero === true) out.zero = true;
    if (f.fontVariantNumericFigure === "LINING") out.lnum = true;
    if (f.fontVariantNumericFigure === "OLDSTYLE") out.onum = true;
    if (f.fontVariantNumericSpacing === "TABULAR") out.tnum = true;
    if (f.fontVariantNumericSpacing === "PROPORTIONAL") out.pnum = true;
    if (f.fontVariantNumericFraction === "DIAGONAL" || f.fontVariantNumericFraction === "STACKED") out.frac = true;
    if (f.fontVariantCaps === "SMALL" || f.fontVariantCaps === "ALL_SMALL") out.smcp = true;
    if (f.fontVariantCaps === "ALL_SMALL") out.c2sc = true;
    if (f.fontVariantPosition === "SUPER") out.sups = true;
    if (f.fontVariantPosition === "SUB") out.subs = true;
    for (const tag of (f.toggledOnOTFeatures as string[] | undefined) ?? []) out[String(tag).toLowerCase()] = true;
    for (const tag of (f.toggledOffOTFeatures as string[] | undefined) ?? []) out[String(tag).toLowerCase()] = false;
    return Object.keys(out).length ? out : undefined;
}

// Axis tags are stored as numbers (four ASCII bytes).
export function figVariations(f: Fig): Record<string, number> | undefined {
    const list = f.fontVariations as { axisTag?: number; axisName?: string; value?: number }[] | undefined;
    if (!list?.length) return undefined;
    const out: Record<string, number> = {};
    for (const v of list) {
        const n = Number(v.axisTag ?? 0);
        const tag = n ? String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255) : (v.axisName ?? "").slice(0, 4);
        if (tag && typeof v.value === "number") out[tag] = v.value;
    }
    return Object.keys(out).length ? out : undefined;
}

function caseOf(v: unknown): SpanStyle["textCase"] | undefined {
    if (v === undefined) return undefined;
    return v === "UPPER" ? "upper" : v === "LOWER" ? "lower" : v === "TITLE" ? "title" : v === "SMALL_CAPS" || v === "SMALL_CAPS_FORCED" ? "small-caps" : "none";
}

// The layer's character settings, as the importer stores them on the node (to compare runs with).
export interface BaseText {
    fontFamily: string;
    fontWeight: number;
    italic: boolean;
    fontSize: number;
    // The layer's line height (a multiple of its size), and in pixels when the format had it in
    // pixels (which stays fixed across sizes).
    lineHeight: number | null;
    lineHeightPx: number | null;
}

async function runStyle(entry: Fig, base: BaseText, ctx: Context): Promise<SpanStyle> {
    // The run's text style first, then what the run sets over it.
    const style = ctx.styleOf(entry.styleIdForText);
    const f: Fig = {};
    if (style) for (const k of TEXT_FIELDS) if (style[k] !== undefined) f[k] = style[k];
    for (const [k, v] of Object.entries(entry)) if (v !== undefined) f[k] = v;
    const out: SpanStyle = {};
    const size = typeof f.fontSize === "number" ? f.fontSize : base.fontSize;
    if (typeof f.fontSize === "number" && f.fontSize !== base.fontSize) out.fontSize = f.fontSize;
    const name = f.fontName as { family?: string; style?: string } | undefined;
    if (name?.family && name.family !== base.fontFamily) out.fontFamily = name.family;
    if (name?.style) {
        const weight = ctx.weightOf(name.style);
        const italic = /italic|oblique/i.test(name.style);
        if (weight !== base.fontWeight) out.fontWeight = weight;
        if (italic !== base.italic) out.italic = italic;
    }
    const lh = f.lineHeight as { value: number; units: string } | undefined;
    if (lh) {
        const v = lh.units === "PERCENT" ? lh.value / 100 : lh.units === "RAW" ? lh.value : lh.value / size;
        if (Math.abs(v - (base.lineHeight ?? -1)) > 1e-6) out.lineHeight = v;
    } else if (base.lineHeightPx !== null && size !== base.fontSize) out.lineHeight = base.lineHeightPx / size;
    const ls = f.letterSpacing as { value: number; units: string } | undefined;
    if (ls) out.letterSpacing = ls.units === "PERCENT" ? ls.value : (ls.value / size) * 100;
    if (f.textDecoration !== undefined) out.decoration = f.textDecoration === "UNDERLINE" ? "underline" : f.textDecoration === "STRIKETHROUGH" ? "strikethrough" : "none";
    const textCase = caseOf(f.textCase === "ORIGINAL" ? "NONE" : f.textCase);
    if (textCase) out.textCase = textCase;
    const link = f.hyperlink as { url?: string } | undefined;
    if (link?.url) out.hyperlink = link.url;
    // A fill style wins over the paints cached next to it (as for layers).
    const fillStyle = ctx.styleOf(entry.styleIdForFill);
    const fillPaints = (fillStyle?.fillPaints as Fig[] | undefined) ?? (entry.fillPaints as Fig[] | undefined);
    if (fillPaints) out.fills = await ctx.paints(fillPaints);
    const features = figFeatures(f);
    if (features) out.openType = features;
    const axes = figVariations(f);
    if (axes) out.fontVariations = axes;
    for (const k of Object.keys(out) as (keyof SpanStyle)[]) if (out[k] === undefined) delete out[k];
    return out;
}

export interface FigRichText {
    spans?: TextSpan[];
    paragraphs?: ParagraphStyle[];
}

export async function figRichText(textData: Fig | undefined, base: BaseText, length: number, ctx: Context): Promise<FigRichText> {
    const out: FigRichText = {};
    if (!textData) return out;
    const ids = (textData.characterStyleIDs as number[] | undefined) ?? [];
    const table = (textData.styleOverrideTable as Fig[] | undefined) ?? [];
    if (ids.length && table.length) {
        const byId = new Map<number, Fig>();
        for (const t of table) byId.set(Number(t.styleID), t);
        const styles = new Map<number, SpanStyle>();
        for (const [id, entry] of byId) styles.set(id, await runStyle(entry, base, ctx));
        const spans: TextSpan[] = [];
        let i = 0;
        const n = Math.min(length, ids.length);
        while (i < n) {
            const id = Number(ids[i] ?? 0);
            let j = i + 1;
            while (j < n && Number(ids[j] ?? 0) === id) j++;
            const style = id ? styles.get(id) : undefined;
            if (style && Object.keys(style).length) spans.push({ ...style, start: i, end: j });
            i = j;
        }
        if (spans.length) out.spans = spans;
    }
    const lines = (textData.lines as { lineType?: string; indentationLevel?: number }[] | undefined) ?? [];
    if (lines.some((l) => (l.lineType && l.lineType !== "PLAIN") || (l.indentationLevel ?? 0) > 0)) {
        out.paragraphs = lines.map((l) => {
            const list = l.lineType === "ORDERED_LIST" ? "number" : l.lineType === "UNORDERED_LIST" ? "bullet" : null;
            return { list, level: list ? Math.max(1, l.indentationLevel ?? 1) : Math.max(0, l.indentationLevel ?? 0) };
        });
    }
    return out;
}


// The format's text stagger preset: an ANIMATION_PRESET_INSTANCE (backed by the
// "motion.preset_name.text_stagger" code component, whose properties hold the settings) with
// textElementDelayBehaviour turned on. Its keyframe tracks animate one unit; the text layer
// consumes them (opacity, translation, rotation, scale) and the preset's own blur effect adds blur.

interface MotionKeyLike {
    t: number;
    v: number | { x: number; y: number } | { r: number; g: number; b: number; a?: number };
    easing: import("./types").Keyframe["easing"];
    bezier?: [number, number, number, number];
}

export interface StaggerContext {
    node: (key: string) => Fig | undefined;
    // Keyframes by track id (already read by the importer).
    tracks: Map<string, MotionKeyLike[]>;
    key: (guid: unknown) => string;
    // Code components by their library key.
    codeComponent: (key: string) => Fig | undefined;
}

const UNITS: Record<string, import("./types").TextStagger["unit"]> = { CHARACTER: "letter", CHARACTER_NO_WHITESPACE: "letter-visible", WORD: "word", LINE: "line", PARAGRAPH: "paragraph" };
const ORDERS: Record<string, import("./types").TextStagger["order"]> = { LEFT_RIGHT: "left-right", RIGHT_LEFT: "right-left", CENTER_OUT: "center-out", RANDOM: "random" };

function propValue(v: Fig | undefined): unknown {
    const value = (v?.value ?? {}) as Fig;
    if (value.textValue !== undefined) return value.textValue;
    if (value.textDataValue) return (value.textDataValue as Fig).characters;
    if (value.floatValue !== undefined) return value.floatValue;
    if (value.boolValue !== undefined) return value.boolValue;
    if (value.easingValue) return (value.easingValue as Fig).easingType;
    return undefined;
}

// The preset instance's settings: the code component's defaults with the instance's assignments.
function presetProps(instance: Fig, ctx: StaggerContext): Record<string, unknown> {
    const backing = (instance.backingCodeComponentId as { assetRef?: { key?: string }; guid?: unknown } | undefined) ?? {};
    const component = backing.assetRef?.key ? ctx.codeComponent(backing.assetRef.key) : backing.guid ? ctx.node(ctx.key(backing.guid)) : undefined;
    const out: Record<string, unknown> = {};
    const names = new Map<string, string>();
    for (const def of (component?.componentPropDefs as Fig[] | undefined) ?? []) {
        const id = ctx.key(def.id);
        names.set(id, String(def.name));
        out[String(def.name)] = propValue(def.varValue as Fig | undefined);
    }
    for (const a of (instance.componentPropAssignments as Fig[] | undefined) ?? []) {
        const name = names.get(ctx.key(a.defID));
        if (name) out[name] = propValue(a.varValue as Fig | undefined);
    }
    return out;
}

// The track a KEYFRAME expression consumes, when it comes from this preset instance.
function presetTrack(variableData: Fig | undefined, presetKey: string, ctx: StaggerContext): string | null {
    const expr = ((variableData?.value as Fig | undefined)?.expressionValue ?? null) as { expressionFunction?: string; expressionArguments?: Fig[] } | null;
    if (!expr || expr.expressionFunction !== "KEYFRAME") return null;
    for (const arg of expr.expressionArguments ?? []) {
        const params = (((arg.value as Fig | undefined)?.keyframeTrackParameterValue as Fig | undefined)?.parameters ?? []) as Fig[];
        for (const param of params) {
            const preset = (param.value as Fig | undefined)?.animationPreset as Fig | undefined;
            if (!preset) continue;
            if (ctx.key((preset.animationPresetId as Fig | undefined)?.guid) !== presetKey) continue;
            const id = ctx.key((preset.keyframeTrackId as Fig | undefined)?.guid);
            if (id) return id;
        }
    }
    return null;
}

// Track ids that belong to text stagger presets (the layer's own motion skips them).
export function staggerTrackIds(changes: Fig[], ctx: Pick<StaggerContext, "key">): Set<string> {
    const presets = new Set<string>();
    for (const c of changes) if (c.type === "ANIMATION_PRESET_INSTANCE" && (c.textElementDelayBehaviour as Fig | undefined)?.enabled) presets.add(ctx.key(c.guid));
    const out = new Set<string>();
    for (const c of changes) if (c.type === "KEYFRAME_TRACK" && presets.has(ctx.key((c.parentIndex as Fig | undefined)?.guid))) out.add(ctx.key(c.guid));
    return out;
}

export function figTextStagger(c: Fig, ctx: StaggerContext): import("./types").TextStagger | null {
    const list = ((c.animationPresets as Fig | undefined)?.presets as Fig[] | undefined) ?? [];
    for (const ref of list) {
        const presetKey = ctx.key((ref.animationPresetId as Fig | undefined)?.guid);
        const instance = ctx.node(presetKey);
        const behaviour = instance?.textElementDelayBehaviour as Fig | undefined;
        if (!instance || !behaviour?.enabled) continue;
        const props = presetProps(instance, ctx);
        const duration = Math.max(10, Number(props.duration ?? 0.5) * 1000);
        // The preset's start on the timeline is in microseconds (a 64-bit number in the file).
        const delay = instance.timelineOffset !== undefined ? Number(instance.timelineOffset) / 1000 : Number(props.delay ?? 0) * 1000;
        const out = (v: MotionKeyLike[], map: (x: MotionKeyLike["v"]) => number | null) =>
            v.flatMap((k) => {
                const value = map(k.v);
                return value === null ? [] : [{ t: k.t, v: value, easing: k.easing, ...(k.bezier ? { bezier: k.bezier } : {}) }];
            });
        const tracks: import("./types").TextStagger["tracks"] = {};
        const num = (x: MotionKeyLike["v"]) => (typeof x === "number" ? x : null);
        for (const entry of ((c.parameterConsumptionMap as Fig | undefined)?.entries as Fig[] | undefined) ?? []) {
            const track = presetTrack(entry.variableData as Fig | undefined, presetKey, ctx);
            const keys = track ? ctx.tracks.get(track) : undefined;
            if (!keys) continue;
            switch (entry.variableField) {
                case "OPACITY":
                    tracks.opacity = out(keys, num);
                    break;
                case "MOTION_TRANSLATION_X":
                    tracks.x = out(keys, num);
                    break;
                case "MOTION_TRANSLATION_Y":
                    tracks.y = out(keys, num);
                    break;
                case "MOTION_TRANSLATION_XY":
                    tracks.x = out(keys, (x) => (typeof x === "object" && "x" in x && !("r" in x) ? x.x : null));
                    tracks.y = out(keys, (x) => (typeof x === "object" && "y" in x && !("r" in x) ? x.y : null));
                    break;
                case "MOTION_ROTATION":
                    tracks.rotation = out(keys, (x) => (typeof x === "number" ? (x * 180) / Math.PI : null));
                    break;
                case "MOTION_SCALE_XY":
                    tracks.scale = out(keys, (x) => (typeof x === "object" && "x" in x ? x.x : typeof x === "number" ? x : null));
                    break;
            }
        }
        // The preset's blur effect animates each unit's blur radius.
        for (const effect of (instance.effects as Fig[] | undefined) ?? []) {
            const track = presetTrack(effect.radiusVar as Fig | undefined, presetKey, ctx);
            const keys = track ? ctx.tracks.get(track) : undefined;
            if (keys) tracks.blur = out(keys, num);
        }
        for (const k of Object.keys(tracks) as (keyof typeof tracks)[]) if (!tracks[k]?.length) delete tracks[k];
        const direction = props.animationDirection === "out" ? "out" : "in";
        // Tracks are stored as an "in" animation; an "out" one plays them backwards.
        if (direction === "out") for (const k of Object.keys(tracks) as (keyof typeof tracks)[]) tracks[k] = (tracks[k] ?? []).map((key) => ({ ...key, t: duration - key.t })).reverse();
        const from = String(props.direction ?? "top") as "top" | "bottom" | "left" | "right";
        const easingType = String(props.easing ?? "OUT_CUBIC");
        const first = Object.values(tracks)[0]?.[0];
        return {
            unit: UNITS[String(behaviour.grouping ?? props.textDelayGrouping ?? "WORD")] ?? "word",
            order: ORDERS[String(behaviour.order ?? props.textDelayOrder ?? "LEFT_RIGHT")] ?? "left-right",
            delay: delay + Number(behaviour.delayMs ?? 0),
            duration,
            overlap: Number(props.presetStaggerOverlap ?? 50),
            direction,
            clip: Boolean(behaviour.clipContent ?? props.clipContent),
            tracks,
            preset: {
                easing: first?.easing ?? (easingType === "LINEAR" ? "linear" : "ease-out"),
                ...(first?.bezier ? { bezier: first.bezier } : {}),
                position: { on: Boolean(props.positionEnabled), from: ["top", "bottom", "left", "right"].includes(from) ? from : "top", distance: Number(props.distance ?? 40) },
                rotation: { on: Boolean(props.rotationEnabled), clockwise: props.rotationDirection !== "counterclockwise", amount: Number(props.rotationAmount ?? 180) },
                scale: { on: Boolean(props.scaleEnabled), amount: Number(props.scaleAmount ?? 120) },
                opacity: { on: Boolean(props.opacityEnabled), amount: Number(props.opacityAmount ?? 0) },
                blur: { on: Boolean(props.blurEnabled), amount: Number(props.blurAmount ?? 20) },
            },
        };
    }
    return null;
}

import { nanoid } from "nanoid";
import { editor } from "./store";
import type { ColorStyle, Command, Effect, EffectStyle, NagmaDocument, Paint, SceneNode, SpanStyle, Styles, TextStyle } from "./types";
import { styleAt, styleRange, withoutKeys } from "./rich-text";
import { sessionRange } from "./text-session";

// Colour and text styles: named values layers can follow. Editing a style updates every layer
// that follows it; detaching keeps the current values and forgets the link.

const EMPTY: Styles = { colors: [], texts: [] };

export function stylesOf(doc: NagmaDocument): Styles {
    return doc.styles ?? EMPTY;
}

function setStyles(next: Styles, extra: Command[] = []) {
    editor.execute({ type: "batch", commands: [{ type: "styles.set", styles: next }, ...extra] });
}

// Colour styles.

export function createColorStyle(name: string, paint: Paint, applyTo?: { ids: string[]; key: "fills" | "strokes" }, variableId?: string): ColorStyle {
    const { doc } = editor.get();
    const style: ColorStyle = { id: nanoid(8), name: name.trim() || `Colour ${stylesOf(doc).colors.length + 1}`, paint, ...(variableId ? { variableId } : {}) };
    const extra: Command[] = applyTo ? applyTo.ids.map((id) => ({ type: "node.update", id, patch: { [applyTo.key]: [paint], [applyTo.key === "fills" ? "fillStyleId" : "strokeStyleId"]: style.id, ...(variableId ? { boundVariables: { ...(doc.nodes[id]?.boundVariables ?? {}), [applyTo.key === "fills" ? "fill:0" : "stroke:0"]: variableId } } : {}) } })) : [];
    setStyles({ ...stylesOf(doc), colors: [...stylesOf(doc).colors, style] }, extra);
    return style;
}

export function applyColorStyle(ids: string[], key: "fills" | "strokes", styleId: string) {
    const { doc } = editor.get();
    const style = stylesOf(doc).colors.find((c) => c.id === styleId);
    if (!style) return;
    editor.execute({
        type: "batch",
        commands: ids.map((id) => ({
            type: "node.update",
            id,
            patch: {
                [key]: [style.paint],
                [key === "fills" ? "fillStyleId" : "strokeStyleId"]: styleId,
                // The style's paint replaces whatever the paints were bound to; a style that follows
                // a variable binds the paint to it instead.
                boundVariables: paintBindings(doc.nodes[id]?.boundVariables, key, style.variableId),
            },
        })),
    });
}

function paintBindings(bound: Record<string, string> | undefined, key: "fills" | "strokes", variableId: string | undefined): Record<string, string> {
    const prefix = key === "fills" ? "fill" : "stroke";
    const next = Object.fromEntries(Object.entries(bound ?? {}).filter(([k]) => k !== prefix && !k.startsWith(`${prefix}:`)));
    if (variableId) next[`${prefix}:0`] = variableId;
    return next;
}

export function detachColorStyle(ids: string[], key: "fills" | "strokes") {
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update", id, patch: { [key === "fills" ? "fillStyleId" : "strokeStyleId"]: null } })) });
}

// Changes a style and every layer following it.
export function updateColorStyle(styleId: string, patch: Partial<Omit<ColorStyle, "id">>) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const style = styles.colors.find((c) => c.id === styleId);
    if (!style) return;
    const next = { ...style, ...patch };
    const extra: Command[] = patch.paint
        ? Object.values(doc.nodes).flatMap((n): Command[] => [
              ...(n.fillStyleId === styleId ? [{ type: "node.update" as const, id: n.id, patch: { fills: [next.paint] } }] : []),
              ...(n.strokeStyleId === styleId ? [{ type: "node.update" as const, id: n.id, patch: { strokes: [next.paint] } }] : []),
          ])
        : [];
    setStyles({ ...styles, colors: styles.colors.map((c) => (c.id === styleId ? next : c)) }, extra);
}

export function deleteColorStyle(styleId: string) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const extra: Command[] = Object.values(doc.nodes).flatMap((n): Command[] =>
        n.fillStyleId === styleId || n.strokeStyleId === styleId
            ? [{ type: "node.update", id: n.id, patch: { ...(n.fillStyleId === styleId ? { fillStyleId: null } : {}), ...(n.strokeStyleId === styleId ? { strokeStyleId: null } : {}) } }]
            : [],
    );
    setStyles({ ...styles, colors: styles.colors.filter((c) => c.id !== styleId) }, extra);
}

// Text styles: every type setting the reference keeps in a style. Character settings can also apply to a
// range of a layer (the range's span names the style); paragraph settings belong to the layer.

const CHAR_KEYS = ["fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "letterSpacing", "decoration", "textCase", "openType", "fontVariations"] as const;
const LAYER_KEYS = ["paragraphSpacing", "paragraphIndent", "listSpacing", "hangingList", "hangingPunctuation", "leadingTrim"] as const;

export function textStyleFrom(node: SceneNode, name: string, at?: number): TextStyle {
    const c = at === undefined ? null : styleAt(node, at);
    return {
        id: nanoid(8),
        name,
        description: "",
        fontFamily: c?.fontFamily ?? node.fontFamily ?? "Inter",
        fontSize: c?.fontSize ?? node.fontSize ?? 16,
        fontWeight: c?.fontWeight ?? node.fontWeight ?? 400,
        italic: c?.italic ?? Boolean(node.italic),
        lineHeight: c ? c.lineHeight : (node.lineHeight ?? null),
        letterSpacing: c?.letterSpacing ?? node.letterSpacing ?? 0,
        paragraphSpacing: node.paragraphSpacing ?? 0,
        paragraphIndent: node.paragraphIndent ?? 0,
        listSpacing: node.listSpacing ?? 0,
        hangingList: Boolean(node.hangingList),
        hangingPunctuation: Boolean(node.hangingPunctuation),
        leadingTrim: node.leadingTrim ?? "none",
        decoration: c?.decoration ?? node.decoration ?? "none",
        textCase: c?.textCase ?? node.textCase ?? "none",
        openType: { ...(c?.openType ?? node.openType ?? {}) },
        fontVariations: { ...(c?.fontVariations ?? node.fontVariations ?? {}) },
    };
}

function charPatch(style: TextStyle): SpanStyle {
    return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        italic: style.italic,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        decoration: style.decoration ?? "none",
        textCase: style.textCase ?? "none",
        openType: style.openType ?? {},
        fontVariations: style.fontVariations ?? {},
    };
}

export function textPatch(style: TextStyle): Partial<SceneNode> {
    return {
        ...(charPatch(style) as Partial<SceneNode>),
        paragraphSpacing: style.paragraphSpacing ?? 0,
        paragraphIndent: style.paragraphIndent ?? 0,
        listSpacing: style.listSpacing ?? 0,
        hangingList: style.hangingList ?? false,
        hangingPunctuation: style.hangingPunctuation ?? false,
        leadingTrim: style.leadingTrim ?? "none",
    };
}

// The whole layer takes the style: its own settings, with spans no longer overriding them.
function layerStyleCommand(node: SceneNode, style: TextStyle): Command {
    const spans = withoutKeys(node, [...CHAR_KEYS, "textStyleId"]);
    return { type: "node.update", id: node.id, patch: { ...textPatch(style), textStyleId: style.id, ...(node.spans?.length ? { spans: spans ?? [] } : {}) } };
}

function styleCommandsFor(doc: NagmaDocument, ids: string[], style: TextStyle): Command[] {
    return ids.flatMap((id): Command[] => {
        const node = doc.nodes[id];
        if (!node || node.type !== "text") return [];
        const range = sessionRange(id);
        // While editing with a range selected, just that range takes the style.
        if (range && range.end > range.start) return [{ type: "node.update", id, patch: { spans: styleRange(node, range.start, range.end, { ...charPatch(style), textStyleId: style.id }) } }];
        return [layerStyleCommand(node, style)];
    });
}

export function createTextStyle(name: string, from: SceneNode, applyTo: string[] = [], extra: Partial<TextStyle> = {}): TextStyle {
    const { doc } = editor.get();
    const range = sessionRange(from.id);
    const style = { ...textStyleFrom(from, name.trim() || `Text ${stylesOf(doc).texts.length + 1}`, range ? range.start : undefined), ...extra };
    setStyles({ ...stylesOf(doc), texts: [...stylesOf(doc).texts, style] }, styleCommandsFor(doc, applyTo, style));
    return style;
}

export function applyTextStyle(ids: string[], styleId: string) {
    const { doc } = editor.get();
    const style = stylesOf(doc).texts.find((t) => t.id === styleId);
    if (!style) return;
    editor.execute({ type: "batch", commands: styleCommandsFor(doc, ids, style) });
}

// Keeps the current look and forgets the link (on the selected range while editing).
export function detachTextStyle(ids: string[]) {
    const { doc } = editor.get();
    editor.execute({
        type: "batch",
        commands: ids.flatMap((id): Command[] => {
            const node = doc.nodes[id];
            if (!node) return [];
            const range = sessionRange(id);
            if (range && range.end > range.start) return [{ type: "node.update", id, patch: { spans: styleRange(node, range.start, range.end, { textStyleId: undefined }) } }];
            return [{ type: "node.update", id, patch: { textStyleId: null, ...(node.spans?.some((s) => s.textStyleId) ? { spans: withoutKeys(node, ["textStyleId"]) ?? [] } : {}) } }];
        }),
    });
}

// Layers and ranges following a style take its new settings; their own range overrides stay.
export function updateTextStyle(styleId: string, patch: Partial<Omit<TextStyle, "id">>) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const style = styles.texts.find((t) => t.id === styleId);
    if (!style) return;
    const next = { ...style, ...patch };
    const changesLook = Object.keys(patch).some((k) => k !== "name" && k !== "description");
    const extra: Command[] = changesLook
        ? Object.values(doc.nodes).flatMap((n): Command[] => {
              if (n.type !== "text") return [];
              const out: Partial<SceneNode> = {};
              if (n.textStyleId === styleId) Object.assign(out, textPatch(next));
              if (n.spans?.some((s) => s.textStyleId === styleId)) {
                  const char = charPatch(next);
                  out.spans = n.spans.map((s) => (s.textStyleId === styleId ? { ...s, ...char } : s));
              }
              return Object.keys(out).length ? [{ type: "node.update", id: n.id, patch: out }] : [];
          })
        : [];
    setStyles({ ...styles, texts: styles.texts.map((t) => (t.id === styleId ? next : t)) }, extra);
}

export function deleteTextStyle(styleId: string) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const extra: Command[] = Object.values(doc.nodes).flatMap((n): Command[] => {
        const patch: Partial<SceneNode> = {};
        if (n.textStyleId === styleId) patch.textStyleId = null;
        if (n.spans?.some((s) => s.textStyleId === styleId)) patch.spans = n.spans.map((s) => (s.textStyleId === styleId ? { ...s, textStyleId: undefined } : s));
        return Object.keys(patch).length ? [{ type: "node.update", id: n.id, patch }] : [];
    });
    setStyles({ ...styles, texts: styles.texts.filter((t) => t.id !== styleId) }, extra);
}

// Text styles used on a layer: its own and any on its ranges.
export function textStylesOn(node: SceneNode): string[] {
    const ids = new Set<string>();
    if (node.textStyleId) ids.add(node.textStyleId);
    for (const s of node.spans ?? []) if (s.textStyleId) ids.add(s.textStyleId);
    return [...ids];
}

export { LAYER_KEYS as TEXT_STYLE_LAYER_KEYS };

// Edits that change a styled layer's own value break the link, as in other design tools, unless
// the edit came from the style itself. The panel calls this before writing paints or type.
export function detachIfStyled(nodes: SceneNode[], what: "fills" | "strokes" | "text"): Command[] {
    const key = what === "fills" ? "fillStyleId" : what === "strokes" ? "strokeStyleId" : "textStyleId";
    return nodes.filter((n) => n[key]).map((n) => ({ type: "node.update", id: n.id, patch: { [key]: null } }));
}

// Effect styles: a drop shadow and layer blur, shared by name.

// Every effect on a layer, the older single shadow and blur fields included.
export function layerEffects(node: SceneNode): Effect[] {
    const legacy: Effect[] = [];
    if (node.shadow) legacy.push({ type: "drop-shadow", visible: true, x: node.shadow.x, y: node.shadow.y, blur: node.shadow.blur, spread: 0, color: node.shadow.color, opacity: node.shadow.opacity });
    if (node.blur > 0) legacy.push({ type: "layer-blur", visible: true, x: 0, y: 0, blur: node.blur, spread: 0, color: "#000000", opacity: 1 });
    return [...legacy, ...(node.effects ?? [])];
}

// What a layer takes from an effect style.
export function effectPatch(style: EffectStyle): Partial<SceneNode> {
    return style.effects ? { effects: style.effects, shadow: null, blur: 0 } : { shadow: style.shadow, blur: style.blur };
}

export function createEffectStyle(name: string, from: SceneNode, applyTo: string[] = []): EffectStyle {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const style: EffectStyle = { id: nanoid(8), name: name.trim() || `Effect ${(styles.effects ?? []).length + 1}`, shadow: null, blur: 0, effects: layerEffects(from) };
    setStyles(
        { ...styles, effects: [...(styles.effects ?? []), style] },
        applyTo.map((id) => ({ type: "node.update", id, patch: { ...effectPatch(style), effectStyleId: style.id } })),
    );
    return style;
}

export function applyEffectStyle(ids: string[], styleId: string) {
    const { doc } = editor.get();
    const style = (stylesOf(doc).effects ?? []).find((e) => e.id === styleId);
    if (!style) return;
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update", id, patch: { ...effectPatch(style), effectStyleId: styleId } })) });
}

export function detachEffectStyle(ids: string[]) {
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update", id, patch: { effectStyleId: null } })) });
}

export function updateEffectStyle(styleId: string, patch: Partial<Omit<EffectStyle, "id">>) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const style = (styles.effects ?? []).find((e) => e.id === styleId);
    if (!style) return;
    const next = { ...style, ...patch };
    const extra: Command[] = Object.values(doc.nodes)
        .filter((n) => n.effectStyleId === styleId)
        .map((n) => ({ type: "node.update", id: n.id, patch: effectPatch(next) }));
    setStyles({ ...styles, effects: (styles.effects ?? []).map((e) => (e.id === styleId ? next : e)) }, extra);
}

export function deleteEffectStyle(styleId: string) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const extra: Command[] = Object.values(doc.nodes)
        .filter((n) => n.effectStyleId === styleId)
        .map((n) => ({ type: "node.update", id: n.id, patch: { effectStyleId: null } }));
    setStyles({ ...styles, effects: (styles.effects ?? []).filter((e) => e.id !== styleId) }, extra);
}

// ---- Shared by every kind ----

export type StyleKind = "color" | "text" | "effect";
export type AnyStyle = ColorStyle | TextStyle | EffectStyle;

export function styleListOf(styles: Styles, kind: StyleKind): AnyStyle[] {
    return kind === "color" ? styles.colors : kind === "text" ? styles.texts : (styles.effects ?? []);
}

function withList(styles: Styles, kind: StyleKind, list: AnyStyle[]): Styles {
    return kind === "color" ? { ...styles, colors: list as ColorStyle[] } : kind === "text" ? { ...styles, texts: list as TextStyle[] } : { ...styles, effects: list as EffectStyle[] };
}

// This file's own styles (library styles copied in are left out).
export function localStyles(doc: NagmaDocument, kind: StyleKind): AnyStyle[] {
    return styleListOf(stylesOf(doc), kind).filter((s) => !s.libraryId);
}

export function findStyle(doc: NagmaDocument, id: string): { kind: StyleKind; style: AnyStyle } | null {
    const styles = stylesOf(doc);
    for (const kind of ["color", "text", "effect"] as const) {
        const style = styleListOf(styles, kind).find((s) => s.id === id);
        if (style) return { kind, style };
    }
    return null;
}

export function updateStyle(kind: StyleKind, id: string, patch: Partial<AnyStyle>) {
    if (kind === "color") updateColorStyle(id, patch as Partial<ColorStyle>);
    else if (kind === "text") updateTextStyle(id, patch as Partial<TextStyle>);
    else updateEffectStyle(id, patch as Partial<EffectStyle>);
}

export function deleteStyle(kind: StyleKind, id: string) {
    if (kind === "color") deleteColorStyle(id);
    else if (kind === "text") deleteTextStyle(id);
    else deleteEffectStyle(id);
}

// A copy right after the original, named "… copy".
export function duplicateStyle(kind: StyleKind, id: string): AnyStyle | null {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const list = styleListOf(styles, kind);
    const i = list.findIndex((s) => s.id === id);
    const source = list[i];
    if (!source) return null;
    const { libraryId: _l, libraryKey: _k, ...rest } = source;
    const copy = { ...structuredClone(rest), id: nanoid(8), name: `${source.name} copy` } as AnyStyle;
    setStyles(withList(styles, kind, [...list.slice(0, i + 1), copy, ...list.slice(i + 1)]));
    return copy;
}

// Adds a style built elsewhere (the style editor's "Create style").
export function addStyle(kind: StyleKind, style: AnyStyle, applyTo: string[] = []) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const patch: Partial<SceneNode> =
        kind === "color"
            ? { fills: [(style as ColorStyle).paint], fillStyleId: style.id }
            : kind === "text"
              ? { ...textPatch(style as TextStyle), textStyleId: style.id }
              : { ...effectPatch(style as EffectStyle), effectStyleId: style.id };
    setStyles(
        withList(styles, kind, [...styleListOf(styles, kind), style]),
        applyTo.map((id) => ({ type: "node.update", id, patch })),
    );
}

// Reorders a kind's styles (drag in the Styles list); names carry the folders.
export function reorderStyles(kind: StyleKind, order: string[], renames: Record<string, string> = {}) {
    const { doc } = editor.get();
    const styles = stylesOf(doc);
    const list = styleListOf(styles, kind);
    const byId = new Map(list.map((s) => [s.id, s]));
    const ordered = order.flatMap((id) => {
        const s = byId.get(id);
        return s ? [renames[id] ? { ...s, name: renames[id] } : s] : [];
    });
    const rest = list.filter((s) => !order.includes(s.id));
    setStyles(withList(styles, kind, [...ordered, ...rest]));
}

export function applyStyle(kind: StyleKind, ids: string[], styleId: string, target: "fills" | "strokes" = "fills") {
    if (kind === "color") applyColorStyle(ids, target, styleId);
    else if (kind === "text") applyTextStyle(ids, styleId);
    else applyEffectStyle(ids, styleId);
}

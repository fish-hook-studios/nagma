import { nanoid } from "nanoid";
import { setPropVariableResolver, variantProps } from "./components";
import { isGradient } from "./paint";
import { easingLabel } from "./easing-curves";
import { editor } from "./store";
import type { Command, EasingValue, NagmaDocument, SceneNode, Transition, Variable, VariableCollection, VariableScope, VariableType, VariableValue } from "./types";

// Variables: named values in collections with modes. A layer binds a field to a variable and the
// field follows it; a frame picks the mode its subtree uses; values can alias other variables.
//
// Binding keys on a layer (`boundVariables`): fill:<i>, stroke:<i>, fill:<i>:opacity, strokeWidth,
// strokeWeight:<side 0-3>, gridColumnGap, gridRowGap, fontStyle (a style name like "Bold Italic"), radius,
// radius:<corner 0-3>, opacity, w, h, minW, maxW, minH, maxH, gap, counterGap, padding:<side 0-3>,
// text, fontSize, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent, fontWeight,
// fontFamily, visible, shadow:color, shadow:blur, effect:<i>:color|blur|x|y|spread,
// guide:<i>:count|size|margin|gutter (layout guides),
// fill:<i>:stop:<j> and stroke:<i>:stop:<j> (gradient stop colours), variant:<property> (instances
// of a variant: the variant whose property reads as the variable's value, as text).
// The older keys "fill", "stroke" and "padding" still work (first paint, all sides).

const EMPTY: VariableCollection[] = [];

export function collectionsOf(doc: NagmaDocument): VariableCollection[] {
    return doc.variables ?? EMPTY;
}

export function findVariable(doc: NagmaDocument, id: string): { variable: Variable; collection: VariableCollection } | null {
    for (const collection of collectionsOf(doc)) for (const variable of collection.variables) if (variable.id === id) return { variable, collection };
    return null;
}

export function isAlias(v: VariableValue | undefined): v is { alias: string; opacity?: number } {
    return typeof v === "object" && v !== null && "alias" in v;
}

export const SCOPE_LABELS: Record<VariableScope, string> = {
    all: "All supported properties",
    "all-fills": "All fills",
    "frame-fill": "Frame fill",
    "shape-fill": "Shape fill",
    "text-fill": "Text fill",
    stroke: "Stroke",
    "effect-color": "Effect colour",
    "corner-radius": "Corner radius",
    "width-height": "Width and height",
    gap: "Gap",
    opacity: "Layer opacity",
    "stroke-width": "Stroke",
    effect: "Effects",
    "font-size": "Font size",
    "line-height": "Line height",
    "letter-spacing": "Letter spacing",
    "paragraph-spacing": "Paragraph spacing",
    "paragraph-indent": "Paragraph indent",
    "font-weight": "Font weight",
    "font-family": "Font family",
    "font-style": "Font style",
    "text-content": "Text content",
    "color-opacity": "Opacity",
};

export const SCOPES_BY_TYPE: Record<VariableType, VariableScope[]> = {
    color: ["all-fills", "frame-fill", "shape-fill", "text-fill", "stroke", "effect-color", "color-opacity"],
    number: ["corner-radius", "width-height", "gap", "opacity", "stroke-width", "effect", "font-size", "line-height", "letter-spacing", "paragraph-spacing", "paragraph-indent", "font-weight"],
    string: ["font-family", "font-style", "text-content"],
    boolean: [],
    easing: [],
    timing: [],
};

// The type a binding key needs, and the scope it falls under (for the picker's filtering).
export function fieldInfo(key: string, node?: SceneNode): { type: VariableType; scope: VariableScope } {
    // Live frames: a prop the code declared, by its type (live:<prop name>).
    if (key.startsWith("live:")) {
        const prop = node?.live?.schema?.find((p) => p.name === key.slice(5));
        const type: VariableType = prop?.type === "number" ? "number" : prop?.type === "boolean" ? "boolean" : prop?.type === "color" ? "color" : "string";
        return { type, scope: "all" };
    }
    if (/^(fill|stroke):\d+:stop:\d+$/.test(key)) return { type: "color", scope: key.startsWith("stroke") ? "stroke" : node?.type === "text" ? "text-fill" : "shape-fill" };
    // Checked before the plain paint keys, which it also starts like.
    if (/^(fill|stroke):\d+:opacity$/.test(key)) return { type: "color", scope: "color-opacity" };
    if (key === "fill" || key.startsWith("fill:")) return { type: "color", scope: node?.type === "text" ? "text-fill" : node && (node.type === "frame" || node.type === "component" || node.type === "instance") ? "frame-fill" : "shape-fill" };
    if (key === "stroke" || key.startsWith("stroke:")) return { type: "color", scope: "stroke" };
    if (/^strokeWeight:[0-3]$/.test(key)) return { type: "number", scope: "stroke-width" };
    if (key === "gridColumnGap" || key === "gridRowGap") return { type: "number", scope: "gap" };
    if (key === "fontStyle") return { type: "string", scope: "font-style" };
    if (key === "transition:easing") return { type: "easing", scope: "all" };
    if (key === "transition:duration") return { type: "timing", scope: "all" };
    if (key === "shadow:color" || /^effect:\d+:color$/.test(key)) return { type: "color", scope: "effect-color" };
    if (key === "shadow:blur" || /^effect:\d+:(blur|x|y|spread)$/.test(key)) return { type: "number", scope: "effect" };
    if (key === "strokeWidth") return { type: "number", scope: "stroke-width" };
    if (key === "radius" || key.startsWith("radius:")) return { type: "number", scope: "corner-radius" };
    if (key === "opacity") return { type: "number", scope: "opacity" };
    if (key === "w" || key === "h" || key === "minW" || key === "maxW" || key === "minH" || key === "maxH") return { type: "number", scope: "width-height" };
    if (key === "gap" || key === "counterGap" || key === "padding" || key.startsWith("padding:")) return { type: "number", scope: "gap" };
    if (/^guide:\d+:(count|size|margin|gutter)$/.test(key)) return { type: "number", scope: "gap" };
    if (key === "fontSize") return { type: "number", scope: "font-size" };
    if (key === "lineHeight") return { type: "number", scope: "line-height" };
    if (key === "letterSpacing") return { type: "number", scope: "letter-spacing" };
    if (key === "paragraphSpacing") return { type: "number", scope: "paragraph-spacing" };
    if (key === "paragraphIndent") return { type: "number", scope: "paragraph-indent" };
    if (key === "fontWeight") return { type: "number", scope: "font-weight" };
    if (key === "fontFamily") return { type: "string", scope: "font-family" };
    if (key === "text") return { type: "string", scope: "text-content" };
    if (key === "visible") return { type: "boolean", scope: "all" };
    return { type: "string", scope: "all" };
}

// Whether a variable may be bound to a field, by type and scope.
export function allowedFor(variable: Variable, key: string, node?: SceneNode): boolean {
    const info = fieldInfo(key, node);
    if (variable.type !== info.type) return false;
    const scopes = variable.scopes ?? ["all"];
    if (scopes.includes("all") || info.scope === "all") return true;
    if (scopes.includes(info.scope)) return true;
    if (info.type === "color" && (info.scope === "frame-fill" || info.scope === "shape-fill" || info.scope === "text-fill") && scopes.includes("all-fills")) return true;
    return false;
}

// The mode a layer resolves a collection in: the nearest ancestor frame that set one, else the
// collection's default mode (its first mode unless chosen otherwise).
function modeFor(doc: NagmaDocument, node: SceneNode | null, collection: VariableCollection, modeOverrides?: Record<string, string>): string {
    const forced = modeOverrides?.[collection.id];
    if (forced && collection.modes.some((m) => m.id === forced)) return forced;
    let current: SceneNode | null | undefined = node;
    while (current) {
        const picked = current.variableModes?.[collection.id];
        if (picked && collection.modes.some((m) => m.id === picked)) return picked;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return collection.defaultModeId && collection.modes.some((m) => m.id === collection.defaultModeId) ? collection.defaultModeId : (collection.modes[0]?.id ?? "");
}

export interface Resolved {
    value: string | number | boolean | EasingValue;
    // Colour aliases can scale the opacity (1 = as is).
    opacity: number;
}

// Extended collections: a collection that extends another carries its variables, resolved in the
// extended collection's own modes (each matching the parent's mode of the same position) with
// per-mode overrides. A layer in a mode of the extended collection reads the variable through it.
export function extensionsOf(doc: NagmaDocument, collectionId: string): VariableCollection[] {
    return collectionsOf(doc).filter((c) => c.extends === collectionId);
}

export function parentOf(doc: NagmaDocument, collection: VariableCollection): VariableCollection | null {
    return collection.extends ? (collectionsOf(doc).find((c) => c.id === collection.extends) ?? null) : null;
}

// Every variable a collection offers: its parent's (through any extension chain), then its own.
export function effectiveVariables(doc: NagmaDocument, collection: VariableCollection, depth = 0): { variable: Variable; inherited: boolean }[] {
    const parent = depth < 8 ? parentOf(doc, collection) : null;
    const inherited = parent ? effectiveVariables(doc, parent, depth + 1).map((v) => ({ variable: v.variable, inherited: true })) : [];
    return [...inherited, ...collection.variables.map((variable) => ({ variable, inherited: false }))];
}

// The extended collection (and its mode) a layer resolves a parent collection's variable through,
// when one is set explicitly on the layer or an ancestor (or forced by the player).
function extensionFor(doc: NagmaDocument, node: SceneNode | null, collection: VariableCollection, modeOverrides?: Record<string, string>): { collection: VariableCollection; mode: string } | null {
    const extensions = extensionsOf(doc, collection.id);
    if (!extensions.length) return null;
    for (const ext of extensions) {
        const forced = modeOverrides?.[ext.id];
        if (forced && ext.modes.some((m) => m.id === forced)) return { collection: ext, mode: forced };
    }
    let current: SceneNode | null | undefined = node;
    while (current) {
        for (const ext of extensions) {
            const picked = current.variableModes?.[ext.id];
            if (picked && ext.modes.some((m) => m.id === picked)) return { collection: ext, mode: picked };
        }
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return null;
}

// The value an extended collection gives a parent's variable in one of its modes: its override,
// else the parent's value in the mode at the same position.
export function extendedValue(doc: NagmaDocument, ext: VariableCollection, variable: Variable, modeId: string): VariableValue | undefined {
    const own = ext.overrides?.[variable.id]?.[modeId];
    if (own !== undefined) return own;
    const parent = parentOf(doc, ext);
    if (!parent) return undefined;
    const index = ext.modes.findIndex((m) => m.id === modeId);
    const parentMode = parent.modes[index]?.id ?? parent.defaultModeId ?? parent.modes[0]?.id ?? "";
    return parent.variables.some((v) => v.id === variable.id) ? variable.values[parentMode] : extendedValue(doc, parent, variable, parentMode);
}

// Follows aliases (with a cycle guard) to a literal, in the mode the layer resolves in.
export function resolveVariable(doc: NagmaDocument, id: string, node: SceneNode | null, overrides?: { values?: Record<string, VariableValue>; modes?: Record<string, string> }, depth = 0): Resolved | null {
    if (depth > 16) return null;
    const found = findVariable(doc, id);
    if (!found) return null;
    const ext = extensionFor(doc, node, found.collection, overrides?.modes);
    const mode = ext ? ext.mode : modeFor(doc, node, found.collection, overrides?.modes);
    const raw = overrides?.values?.[id] ?? (ext ? extendedValue(doc, ext.collection, found.variable, mode) : found.variable.values[mode]);
    if (raw === undefined) return null;
    if (isAlias(raw)) {
        const inner = resolveVariable(doc, raw.alias, node, overrides, depth + 1);
        if (!inner) return null;
        return { value: inner.value, opacity: inner.opacity * (raw.opacity ?? 1) };
    }
    return { value: raw, opacity: 1 };
}

// A readable value for pickers and the Variables window (aliases shown resolved, in the default mode).
export function previewValue(doc: NagmaDocument, variable: Variable, modeId: string): string {
    const raw = variable.values[modeId];
    if (isAlias(raw)) {
        const r = resolveVariable(doc, variable.id, null, { modes: {} });
        const target = findVariable(doc, raw.alias)?.variable.name ?? "?";
        return r ? `${target} → ${valueLabel(r.value)}` : target;
    }
    return raw === undefined ? "" : valueLabel(raw);
}

// A value as the panels print it (timings with their unit, easings by curve).
export function valueLabel(value: VariableValue): string {
    if (isEasingValue(value)) return value.easing === "custom-bezier" && value.bezier ? `cubic-bezier(${value.bezier.map((n) => Math.round(n * 100) / 100).join(", ")})` : easingLabel(value.easing);
    if (isAlias(value)) return "";
    return String(value);
}

// Writes every bound field from its variable. Runs with the other settle passes after each edit.
// `overrides` lets the prototype player show "set variable" and "set mode" changes without editing.
export function resolveVariables(doc: NagmaDocument, overrides?: { values?: Record<string, VariableValue>; modes?: Record<string, string> }): NagmaDocument {
    if (!doc.variables?.length) return doc;
    let nodes = doc.nodes;
    let changed = false;
    for (const node of Object.values(doc.nodes)) {
        const bound = node.boundVariables;
        if (!bound || !Object.keys(bound).length) continue;
        const patch: Partial<SceneNode> = {};
        const num = (key: string, id: string, apply: (v: number) => void) => {
            const r = resolveVariable(doc, id, node, overrides);
            if (r && typeof r.value === "number") apply(r.value);
            void key;
        };
        for (const [key, id] of Object.entries(bound)) {
            const r = resolveVariable(doc, id, node, overrides);
            if (!r) continue;
            const v = r.value;
            const stop = /^(fill|stroke):(\d+):stop:(\d+)$/.exec(key);
            const paintOpacity = /^(fill|stroke):(\d+):opacity$/.exec(key);
            if (paintOpacity && typeof v === "string") {
                // A colour variable scoped to opacity: its alpha (an 8-digit hex, else the alias
                // opacity) sets the paint's opacity.
                const listKey = paintOpacity[1] === "fill" ? "fills" : "strokes";
                const i = Number(paintOpacity[2]);
                const paints = patch[listKey] ?? node[listKey];
                const paint = paints[i];
                const alpha = /^#[0-9a-f]{8}$/i.test(v) ? parseInt(v.slice(7, 9), 16) / 255 : r.opacity;
                if (paint && Math.abs(paint.opacity - alpha) > 1e-6) patch[listKey] = paints.map((p, k) => (k === i ? { ...p, opacity: alpha } : p));
            } else if (stop && typeof v === "string") {
                // A gradient stop's colour.
                const listKey = stop[1] === "fill" ? "fills" : "strokes";
                const i = Number(stop[2]);
                const j = Number(stop[3]);
                const paints = patch[listKey] ?? node[listKey];
                const paint = paints[i];
                if (paint && isGradient(paint)) {
                    const s = paint.stops[j];
                    if (s && (s.color !== v || s.opacity !== r.opacity)) patch[listKey] = paints.map((p, k) => (k === i && isGradient(p) ? { ...p, stops: p.stops.map((x, n) => (n === j ? { ...x, color: v, opacity: r.opacity } : x)) } : p));
                }
            } else if ((key === "fill" || key.startsWith("fill:")) && typeof v === "string") {
                const i = key === "fill" ? 0 : Number(key.slice(5));
                const paints = patch.fills ?? node.fills;
                const paint = paints[i];
                if (paint?.type === "solid" && (paint.color !== v || paint.opacity !== r.opacity)) patch.fills = paints.map((p, k) => (k === i && p.type === "solid" ? { ...p, color: v, opacity: r.opacity } : p));
            } else if ((key === "stroke" || key.startsWith("stroke:")) && typeof v === "string") {
                const i = key === "stroke" ? 0 : Number(key.slice(7));
                const paints = patch.strokes ?? node.strokes;
                const paint = paints[i];
                if (paint?.type === "solid" && (paint.color !== v || paint.opacity !== r.opacity)) patch.strokes = paints.map((p, k) => (k === i && p.type === "solid" ? { ...p, color: v, opacity: r.opacity } : p));
            } else if (key === "shadow:color" && typeof v === "string" && node.shadow && node.shadow.color !== v) patch.shadow = { ...(patch.shadow ?? node.shadow), color: v };
            else if (key === "shadow:blur" && typeof v === "number" && node.shadow && node.shadow.blur !== v) patch.shadow = { ...(patch.shadow ?? node.shadow), blur: v };
            else if (/^effect:\d+:(color|blur|x|y|spread)$/.test(key)) {
                const [, idx, prop] = key.split(":");
                const i = Number(idx);
                const effects = patch.effects ?? node.effects ?? [];
                const e = effects[i];
                const field = prop as "color" | "blur" | "x" | "y" | "spread";
                const fits = field === "color" ? typeof v === "string" : typeof v === "number";
                if (e && fits && e[field] !== v) patch.effects = effects.map((x, k) => (k === i ? { ...x, [field]: v as never } : x));
            } else if ((key === "w" || key === "h" || key === "radius" || key === "strokeWidth" || key === "minW" || key === "maxW" || key === "minH" || key === "maxH" || key === "fontSize" || key === "letterSpacing" || key === "paragraphSpacing" || key === "paragraphIndent" || key === "fontWeight") && typeof v === "number") {
                if (node[key] !== v) (patch as Record<string, unknown>)[key] = v;
            } else if (/^strokeWeight:[0-3]$/.test(key) && typeof v === "number") {
                const i = Number(key.slice(13)) as 0 | 1 | 2 | 3;
                const weights = [...(patch.strokeWeights ?? node.strokeWeights ?? [node.strokeWidth, node.strokeWidth, node.strokeWidth, node.strokeWidth])] as [number, number, number, number];
                if (weights[i] !== v) {
                    weights[i] = Math.max(0, v);
                    patch.strokeWeights = weights;
                    patch.strokeWidth = Math.max(...weights);
                }
            } else if ((key === "gridColumnGap" || key === "gridRowGap") && typeof v === "number" && node.layout?.grid) {
                const grid = patch.layout?.grid ?? node.layout.grid;
                const field = key === "gridColumnGap" ? "columnGap" : "rowGap";
                if (grid[field] !== v) patch.layout = { ...(patch.layout ?? node.layout), grid: { ...grid, [field]: Math.max(0, v) } };
            } else if (key === "fontStyle" && typeof v === "string") {
                // A style name sets the weight and italic together.
                const parsed = parseFontStyle(v);
                if (node.fontWeight !== parsed.weight) patch.fontWeight = parsed.weight;
                if ((node.italic ?? false) !== parsed.italic) patch.italic = parsed.italic;
            } else if (key.startsWith("radius:") && typeof v === "number") {
                const i = Number(key.slice(7)) as 0 | 1 | 2 | 3;
                const radii = [...(patch.radii ?? node.radii ?? [node.radius, node.radius, node.radius, node.radius])] as [number, number, number, number];
                if (radii[i] !== v) {
                    radii[i] = v;
                    patch.radii = radii;
                }
            } else if (key === "lineHeight" && typeof v === "number") {
                if (node.lineHeight !== v / 100) patch.lineHeight = v / 100;
            } else if (key === "opacity" && typeof v === "number") {
                const o = Math.max(0, Math.min(1, v / 100));
                if (node.opacity !== o) patch.opacity = o;
            } else if (key === "gap" && typeof v === "number" && node.layout) {
                if (node.layout.gap !== v) patch.layout = { ...(patch.layout ?? node.layout), gap: v };
            } else if (key === "counterGap" && typeof v === "number" && node.layout) {
                if (node.layout.counterGap !== v) patch.layout = { ...(patch.layout ?? node.layout), counterGap: v };
            } else if (key === "padding" && typeof v === "number" && node.layout) {
                if (node.layout.padding.some((p) => p !== v)) patch.layout = { ...(patch.layout ?? node.layout), padding: [v, v, v, v] };
            } else if (key.startsWith("padding:") && typeof v === "number" && node.layout) {
                const i = Number(key.slice(8));
                const padding = [...(patch.layout?.padding ?? node.layout.padding)] as [number, number, number, number];
                if (padding[i] !== v) {
                    padding[i] = v;
                    patch.layout = { ...(patch.layout ?? node.layout), padding };
                }
            } else if (/^guide:\d+:(count|size|margin|gutter)$/.test(key) && typeof v === "number") {
                // A layout guide's count, cell size, margin or gutter.
                const [, idx, prop] = key.split(":");
                const i = Number(idx);
                const guides = patch.guides ?? node.guides ?? [];
                const g = guides[i];
                const field = prop as "count" | "size" | "margin" | "gutter";
                const value = field === "count" ? Math.max(1, Math.round(v)) : field === "size" ? Math.max(1, v) : Math.max(0, v);
                if (g && g[field] !== value) patch.guides = guides.map((x, k) => (k === i ? { ...x, [field]: value } : x));
            } else if (key === "text" && typeof v === "string" && node.type === "text" && node.text !== v) patch.text = v;
            else if (key === "fontFamily" && typeof v === "string" && node.fontFamily !== v) patch.fontFamily = v;
            else if (key === "visible" && typeof v === "boolean" && node.visible !== v) patch.visible = v;
            else if (key.startsWith("variant:") && node.type === "instance" && typeof v !== "object") {
                const variant = variantFor(doc, patch.componentId ?? node.componentId, key.slice(8), v);
                if (variant && variant !== (patch.componentId ?? node.componentId)) {
                    patch.componentId = variant;
                    // A layer inside an instance keeps its own variant through rebuilds.
                    if (node.sourceId && !(node.overrides ?? []).includes("componentId")) patch.overrides = [...(node.overrides ?? []), "componentId"];
                }
            }
            void num;
        }
        if (Object.keys(patch).length) {
            if (!changed) nodes = { ...nodes };
            nodes[node.id] = { ...node, ...patch };
            changed = true;
        }
    }
    return changed ? { ...doc, nodes } : doc;
}

const STYLE_WEIGHTS: [RegExp, number][] = [
    [/\b(thin|hairline)\b/i, 100],
    [/\b(extra ?light|ultra ?light)\b/i, 200],
    [/\blight\b/i, 300],
    [/\b(medium)\b/i, 500],
    [/\b(semi ?bold|demi ?bold)\b/i, 600],
    [/\b(extra ?bold|ultra ?bold)\b/i, 800],
    [/\b(black|heavy)\b/i, 900],
    [/\bbold\b/i, 700],
];

// A font style name ("Semi Bold Italic", "Light", "700") as a weight and italic flag.
export function parseFontStyle(name: string): { weight: number; italic: boolean } {
    const italic = /italic|oblique/i.test(name);
    const numeric = /^\s*(\d{3})\b/.exec(name);
    if (numeric) return { weight: Number(numeric[1]), italic };
    for (const [re, weight] of STYLE_WEIGHTS) if (re.test(name)) return { weight, italic };
    return { weight: 400, italic };
}

// The variant of the same set as `componentId` with `prop` set to the value (numbers as plain text,
// so 3 picks "Digit=3"), its other properties kept. Null when the set has no such variant.
function variantFor(doc: NagmaDocument, componentId: string | undefined, prop: string, value: string | number | boolean): string | null {
    const current = componentId ? doc.nodes[componentId] : undefined;
    const set = current ? doc.nodes[current.parentId ?? ""] : undefined;
    if (!current || set?.type !== "componentSet") return null;
    const text = typeof value === "number" ? String(Math.round(value * 1e6) / 1e6) : String(value);
    const wanted = { ...variantProps(current.name), [prop]: text };
    for (const id of set.children) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        const props = variantProps(child.name);
        if (Object.entries(wanted).every(([k, x]) => props[k] === x)) return id;
    }
    return null;
}

// ---- Editing collections and variables ----

function setCollections(next: VariableCollection[]) {
    editor.execute({ type: "variables.set", variables: next });
}

export function createCollection(name: string): VariableCollection {
    const { doc } = editor.get();
    const mode = { id: nanoid(6), name: "Mode 1" };
    const collection: VariableCollection = { id: nanoid(8), name: name.trim() || `Collection ${collectionsOf(doc).length + 1}`, modes: [mode], defaultModeId: mode.id, variables: [] };
    setCollections([...collectionsOf(doc), collection]);
    return collection;
}

// A new collection that extends another: it starts with the parent's modes (by name), inherits
// every variable and can override values per mode.
export function extendCollection(parentId: string, name?: string): VariableCollection | null {
    const { doc } = editor.get();
    const parent = collectionsOf(doc).find((c) => c.id === parentId);
    if (!parent) return null;
    const modes = parent.modes.map((m) => ({ id: nanoid(6), name: m.name }));
    const collection: VariableCollection = { id: nanoid(8), name: name?.trim() || `${parent.name} extended`, modes, defaultModeId: modes[0]?.id, variables: [], extends: parent.id, overrides: {} };
    setCollections([...collectionsOf(doc), collection]);
    return collection;
}

// Sets (or clears, with undefined) an extended collection's override of an inherited variable.
export function setOverride(collectionId: string, variableId: string, modeId: string, value: VariableValue | undefined) {
    updateCollection(collectionId, (c) => {
        const forVar = { ...(c.overrides?.[variableId] ?? {}) };
        if (value === undefined) delete forVar[modeId];
        else forVar[modeId] = value;
        const overrides = { ...(c.overrides ?? {}) };
        if (Object.keys(forVar).length) overrides[variableId] = forVar;
        else delete overrides[variableId];
        return { ...c, overrides };
    });
}

export function updateCollection(id: string, fn: (c: VariableCollection) => VariableCollection) {
    const { doc } = editor.get();
    const list = collectionsOf(doc);
    let changed = false;
    const next = list.map((c) => {
        if (c.id !== id) return c;
        const out = fn(c);
        if (out !== c) changed = true;
        return out;
    });
    // Nothing to do (the last mode, a move past the end, an unknown collection): no empty undo step.
    if (changed) setCollections(next);
}

export function deleteCollection(id: string) {
    const { doc } = editor.get();
    const gone = collectionsOf(doc).find((c) => c.id === id);
    if (!gone) return;
    editor.execute(removeVariablesCommand(doc, new Set(gone.variables.map((v) => v.id)), id));
}

export function addMode(collectionId: string, name: string) {
    updateCollection(collectionId, (c) => {
        const mode = { id: nanoid(6), name: name.trim() || `Mode ${c.modes.length + 1}` };
        const first = c.modes[0]?.id ?? "";
        return { ...c, modes: [...c.modes, mode], variables: c.variables.map((v) => ({ ...v, values: { ...v.values, [mode.id]: v.values[first] ?? defaultValue(v.type) } })) };
    });
}

// Duplicate mode: a new column with this mode's values.
export function duplicateMode(collectionId: string, modeId: string) {
    updateCollection(collectionId, (c) => {
        const source = c.modes.find((m) => m.id === modeId);
        if (!source) return c;
        const mode = { id: nanoid(6), name: `${source.name} copy` };
        const at = c.modes.findIndex((m) => m.id === modeId) + 1;
        return { ...c, modes: [...c.modes.slice(0, at), mode, ...c.modes.slice(at)], variables: c.variables.map((v) => ({ ...v, values: { ...v.values, [mode.id]: v.values[modeId] ?? defaultValue(v.type) } })) };
    });
}

// Move a mode's column left or right.
export function moveMode(collectionId: string, modeId: string, direction: -1 | 1) {
    updateCollection(collectionId, (c) => {
        const i = c.modes.findIndex((m) => m.id === modeId);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= c.modes.length) return c;
        const modes = [...c.modes];
        const [m] = modes.splice(i, 1);
        if (m) modes.splice(j, 0, m);
        return { ...c, modes };
    });
}

export function renameMode(collectionId: string, modeId: string, name: string) {
    updateCollection(collectionId, (c) => ({ ...c, modes: c.modes.map((m) => (m.id === modeId ? { ...m, name } : m)) }));
}

export function removeMode(collectionId: string, modeId: string) {
    updateCollection(collectionId, (c) => {
        if (c.modes.length <= 1) return c;
        const modes = c.modes.filter((m) => m.id !== modeId);
        return { ...c, modes, defaultModeId: c.defaultModeId === modeId ? modes[0]?.id : c.defaultModeId, variables: c.variables.map((v) => ({ ...v, values: Object.fromEntries(Object.entries(v.values).filter(([k]) => k !== modeId)) })) };
    });
}

export function setDefaultMode(collectionId: string, modeId: string) {
    updateCollection(collectionId, (c) => ({ ...c, defaultModeId: modeId }));
}

export function defaultValue(type: VariableType): VariableValue {
    if (type === "easing") return { easing: "ease-in-out" };
    if (type === "timing") return 300;
    return type === "color" ? "#000000" : type === "number" ? 0 : type === "boolean" ? false : "";
}

export function isEasingValue(v: VariableValue | undefined): v is EasingValue {
    return typeof v === "object" && v !== null && "easing" in v;
}

// A transition with its easing and duration variables applied (engine/types.ts Transition).
export function resolveTransition(doc: NagmaDocument, transition: Transition, overrides?: { values?: Record<string, VariableValue>; modes?: Record<string, string> }): Transition {
    if (!transition.easingVariable && !transition.durationVariable) return transition;
    let out = transition;
    if (transition.easingVariable) {
        const r = resolveVariable(doc, transition.easingVariable, null, overrides);
        if (r && isEasingValue(r.value)) out = { ...out, easing: r.value.easing, bezier: r.value.bezier ?? out.bezier, spring: r.value.spring ?? out.spring };
    }
    if (transition.durationVariable) {
        const r = resolveVariable(doc, transition.durationVariable, null, overrides);
        if (r && typeof r.value === "number") out = { ...out, duration: Math.max(0, r.value) };
    }
    return out;
}

export function addVariable(collectionId: string, type: VariableType, name: string, value?: VariableValue): Variable | null {
    let created: Variable | null = null;
    updateCollection(collectionId, (c) => {
        const values: Variable["values"] = {};
        for (const m of c.modes) values[m.id] = value ?? defaultValue(type);
        created = { id: nanoid(8), name: name.trim() || `${type} ${c.variables.length + 1}`, type, values, scopes: ["all"] };
        return { ...c, variables: [...c.variables, created] };
    });
    return created;
}

export function duplicateVariable(collectionId: string, variableId: string) {
    updateCollection(collectionId, (c) => {
        const i = c.variables.findIndex((v) => v.id === variableId);
        const v = c.variables[i];
        if (!v) return c;
        const copy: Variable = { ...v, id: nanoid(8), name: `${v.name} copy`, values: { ...v.values } };
        return { ...c, variables: [...c.variables.slice(0, i + 1), copy, ...c.variables.slice(i + 1)] };
    });
}

export function updateVariable(collectionId: string, variableId: string, patch: Partial<Omit<Variable, "id">>) {
    updateCollection(collectionId, (c) => ({ ...c, variables: c.variables.map((v) => (v.id === variableId ? { ...v, ...patch } : v)) }));
}

export function setVariableValue(collectionId: string, variableId: string, modeId: string, value: VariableValue) {
    updateCollection(collectionId, (c) => ({ ...c, variables: c.variables.map((v) => (v.id === variableId ? { ...v, values: { ...v.values, [modeId]: value } } : v)) }));
}

export function renameVariable(collectionId: string, variableId: string, name: string) {
    updateVariable(collectionId, variableId, { name });
}

export function deleteVariable(_collectionId: string, variableId: string) {
    const { doc } = editor.get();
    if (!findVariable(doc, variableId)) return;
    editor.execute(removeVariablesCommand(doc, new Set([variableId])));
}

// The mode of `target` that stands in for mode `modeId` of `from`: the same mode for the same
// collection, the mode at the same position along an extension, else the mode with the same name,
// else the same position, else the default.
function matchingMode(doc: NagmaDocument, from: VariableCollection, modeId: string, target: VariableCollection): string {
    if (from.id === target.id) return modeId;
    const index = from.modes.findIndex((m) => m.id === modeId);
    let up: VariableCollection | null = from;
    for (let i = 0; up && i < 8; i++, up = parentOf(doc, up)) if (up.id === target.id) return target.modes[index]?.id ?? modeFor(doc, null, target);
    const name = from.modes[index]?.name;
    return target.modes.find((m) => m.name === name)?.id ?? target.modes[index]?.id ?? modeFor(doc, null, target);
}

// Removes variables: layers bound to them are unbound (keeping their last look), extended
// collections drop their overrides of them, and every alias to them (a value or an override) becomes
// the literal it resolved to in the matching mode. With `collectionId`, that collection goes too and
// collections extending it lose their parent, keeping only their own variables.
function removeVariablesCommand(doc: NagmaDocument, ids: Set<string>, collectionId?: string): Command {
    const unbind = Object.values(doc.nodes)
        .filter((n) => n.boundVariables && Object.values(n.boundVariables).some((v) => ids.has(v)))
        .map((n) => ({ type: "node.update" as const, id: n.id, patch: { boundVariables: Object.fromEntries(Object.entries(n.boundVariables ?? {}).filter(([, v]) => !ids.has(v))) } }));
    const literal = (c: VariableCollection, modeId: string, val: VariableValue, type: VariableType): VariableValue => {
        if (!isAlias(val) || !ids.has(val.alias)) return val;
        const target = findVariable(doc, val.alias)?.collection;
        const modes: Record<string, string> = { [c.id]: modeId };
        if (target) modes[target.id] = matchingMode(doc, c, modeId, target);
        return resolveVariable(doc, val.alias, null, { modes })?.value ?? defaultValue(type);
    };
    const typeOf = (id: string): VariableType => findVariable(doc, id)?.variable.type ?? "string";
    const collections = collectionsOf(doc).flatMap((c): VariableCollection[] => {
        if (c.id === collectionId) return [];
        if (collectionId && c.extends === collectionId) c = { ...c, extends: undefined, overrides: undefined };
        const variables = c.variables.filter((v) => !ids.has(v.id)).map((v) => ({ ...v, values: Object.fromEntries(Object.entries(v.values).map(([m, val]) => [m, literal(c, m, val, v.type)])) }));
        if (!c.overrides) return [{ ...c, variables }];
        const overrides = Object.fromEntries(
            Object.entries(c.overrides)
                .filter(([varId]) => !ids.has(varId))
                .map(([varId, perMode]) => [varId, Object.fromEntries(Object.entries(perMode).map(([m, val]) => [m, literal(c, m, val, typeOf(varId))]))]),
        );
        return [{ ...c, variables, overrides }];
    });
    return { type: "batch", commands: [{ type: "variables.set", variables: collections }, ...unbind] };
}

// Binds (or unbinds with null) a field of the selected layers to a variable.
export function bindVariable(ids: string[], field: string, variableId: string | null) {
    const { doc } = editor.get();
    editor.execute({
        type: "batch",
        commands: ids.flatMap((id) => {
            const node = doc.nodes[id];
            if (!node) return [];
            const next = { ...(node.boundVariables ?? {}) };
            if (variableId) next[field] = variableId;
            else delete next[field];
            return [{ type: "node.update" as const, id, patch: { boundVariables: next } }];
        }),
    });
}

export function setFrameMode(ids: string[], collectionId: string, modeId: string | null) {
    const { doc } = editor.get();
    editor.execute({
        type: "batch",
        commands: ids.flatMap((id) => {
            const node = doc.nodes[id];
            if (!node) return [];
            const next = { ...(node.variableModes ?? {}) };
            if (modeId) next[collectionId] = modeId;
            else delete next[collectionId];
            return [{ type: "node.update" as const, id, patch: { variableModes: next } }];
        }),
    });
}

// The variable bound to a field across the selection (null when none or mixed).
export function boundTo(nodes: SceneNode[], field: string): string | null {
    const first = nodes[0]?.boundVariables?.[field] ?? null;
    if (!first) return null;
    return nodes.every((n) => n.boundVariables?.[field] === first) ? first : null;
}

// Whether a condition holds, with the player's runtime values.
export function conditionHolds(doc: NagmaDocument, condition: NonNullable<import("./types").Interaction["condition"]>, overrides?: { values?: Record<string, VariableValue>; modes?: Record<string, string> }): boolean {
    const r = resolveVariable(doc, condition.variableId, null, overrides);
    if (!r || typeof r.value === "object") return false;
    const a = r.value;
    const b = condition.value;
    switch (condition.op) {
        case "==":
            return String(a) === String(b);
        case "!=":
            return String(a) !== String(b);
        case ">":
            return Number(a) > Number(b);
        case "<":
            return Number(a) < Number(b);
        case ">=":
            return Number(a) >= Number(b);
        case "<=":
            return Number(a) <= Number(b);
        default:
            return false;
    }
}

// Component properties whose default follows a variable resolve through here.
setPropVariableResolver((doc, id, node) => {
    const r = resolveVariable(doc, id, node);
    return r && typeof r.value !== "object" ? { value: r.value } : null;
});

// Groups ("a/b" name prefixes) in the variables view: rename, ungroup (the variables move up a
// level), duplicate (copies under "<group> copy") and delete (with its variables).

const inGroup = (v: Variable, group: string) => v.name.startsWith(`${group}/`);

export function renameVariableGroup(collectionId: string, group: string, name: string) {
    const parent = group.includes("/") ? group.slice(0, group.lastIndexOf("/") + 1) : "";
    const next = name.includes("/") ? name : parent + name;
    if (!name.trim() || next === group) return;
    updateCollection(collectionId, (c) => ({ ...c, variables: c.variables.map((v) => (inGroup(v, group) ? { ...v, name: next + v.name.slice(group.length) } : v)) }));
}

export function ungroupVariables(collectionId: string, group: string) {
    const parent = group.includes("/") ? group.slice(0, group.lastIndexOf("/") + 1) : "";
    updateCollection(collectionId, (c) => ({ ...c, variables: c.variables.map((v) => (inGroup(v, group) ? { ...v, name: parent + v.name.slice(group.length + 1) } : v)) }));
}

export function duplicateVariableGroup(collectionId: string, group: string) {
    updateCollection(collectionId, (c) => {
        const copies = c.variables.filter((v) => inGroup(v, group)).map((v): Variable => ({ ...v, id: nanoid(8), name: `${group} copy${v.name.slice(group.length)}`, values: { ...v.values } }));
        return { ...c, variables: [...c.variables, ...copies] };
    });
}

export function deleteVariableGroup(collectionId: string, group: string) {
    const { doc } = editor.get();
    const ids = new Set(collectionsOf(doc).find((c) => c.id === collectionId)?.variables.filter((v) => inGroup(v, group)).map((v) => v.id) ?? []);
    if (!ids.size) return;
    editor.execute(removeVariablesCommand(doc, ids));
}

// Moves a collection before another (or to the end), as dragging in the collections list does.
export function moveCollection(id: string, beforeId: string | null) {
    const list = collectionsOf(editor.get().doc);
    const moving = list.find((c) => c.id === id);
    if (!moving || id === beforeId) return;
    const rest = list.filter((c) => c.id !== id);
    const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, moving);
    setCollections(rest);
}

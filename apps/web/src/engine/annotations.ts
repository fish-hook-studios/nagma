import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { editor } from "./store";
import type { Annotation, AnnotationCategory, NagmaDocument, SceneNode } from "./types";

// Annotations and measurements: notes pinned to layers (rich text plus live property values, in a
// category) and distances kept between layers. Both are document data, so they sync and undo.

export const DEFAULT_CATEGORIES: AnnotationCategory[] = [
    { id: "development", label: "Development", color: "#0D99FF" },
    { id: "interaction", label: "Interaction", color: "#9747FF" },
    { id: "accessibility", label: "Accessibility", color: "#14AE5C" },
    { id: "content", label: "Content", color: "#FFA629" },
];

export const CATEGORY_COLORS = ["#0D99FF", "#9747FF", "#14AE5C", "#FFA629", "#F24822", "#FF24BD", "#FFCD29", "#0FB5AE"];

// Categories belong to the file; they're kept on its first page.
export function categories(doc: NagmaDocument): AnnotationCategory[] {
    return doc.nodes[doc.roots[0] ?? ""]?.annotationCategories ?? DEFAULT_CATEGORIES;
}

export function setCategories(list: AnnotationCategory[]) {
    const doc = editor.get().doc;
    const first = doc.roots[0];
    if (first) editor.execute({ type: "node.update", id: first, patch: { annotationCategories: list } });
}

export function categoryOf(doc: NagmaDocument, a: Annotation): AnnotationCategory | null {
    return a.categoryId ? (categories(doc).find((c) => c.id === a.categoryId) ?? null) : null;
}

// ---- Properties an annotation can pin, with their live values ----

export interface PropertyDef {
    key: string;
    label: string;
    applies: (n: SceneNode) => boolean;
    value: (n: SceneNode, doc: NagmaDocument) => string | null;
}

const r = (v: number) => String(Math.round(v * 100) / 100);
const isText = (n: SceneNode) => n.type === "text";
const any = () => true;
const solidHex = (paints: SceneNode["fills"]) => {
    const p = [...paints].reverse().find((x) => x.visible);
    if (!p) return null;
    if (p.type === "solid") return `${p.color.toUpperCase()}${p.opacity < 1 ? ` ${Math.round(p.opacity * 100)}%` : ""}`;
    return p.type === "image" ? "Image" : `${p.type[0]?.toUpperCase()}${p.type.slice(1)} gradient`;
};

export const PROPERTIES: PropertyDef[] = [
    { key: "width", label: "Width", applies: any, value: (n) => r(n.w) },
    { key: "height", label: "Height", applies: any, value: (n) => r(n.h) },
    { key: "minWidth", label: "Min width", applies: (n) => n.minW != null, value: (n) => (n.minW != null ? r(n.minW) : null) },
    { key: "maxWidth", label: "Max width", applies: (n) => n.maxW != null, value: (n) => (n.maxW != null ? r(n.maxW) : null) },
    { key: "minHeight", label: "Min height", applies: (n) => n.minH != null, value: (n) => (n.minH != null ? r(n.minH) : null) },
    { key: "maxHeight", label: "Max height", applies: (n) => n.maxH != null, value: (n) => (n.maxH != null ? r(n.maxH) : null) },
    { key: "fill", label: "Fill", applies: (n) => n.fills.length > 0, value: (n) => solidHex(n.fills) },
    { key: "stroke", label: "Stroke", applies: (n) => n.strokes.length > 0, value: (n) => solidHex(n.strokes) },
    { key: "strokeWeight", label: "Stroke weight", applies: (n) => n.strokes.length > 0, value: (n) => r(n.strokeWidth) },
    { key: "radius", label: "Corner radius", applies: (n) => !isText(n), value: (n) => (n.radii ? n.radii.map(r).join(", ") : r(n.radius)) },
    { key: "opacity", label: "Opacity", applies: any, value: (n) => `${Math.round(n.opacity * 100)}%` },
    { key: "effects", label: "Effects", applies: (n) => Boolean(n.shadow || n.blur || n.effects?.length), value: (n) => [n.shadow ? "Drop shadow" : null, n.blur ? `Blur ${r(n.blur)}` : null, ...(n.effects ?? []).map((e) => e.type)].filter(Boolean).join(", ") || null },
    { key: "fontFamily", label: "Font family", applies: isText, value: (n) => n.fontFamily ?? "Inter" },
    { key: "fontSize", label: "Font size", applies: isText, value: (n) => r(n.fontSize ?? 16) },
    { key: "fontWeight", label: "Font weight", applies: isText, value: (n) => String(n.fontWeight ?? 400) },
    { key: "fontStyle", label: "Font style", applies: isText, value: (n) => (n.italic ? "Italic" : "Normal") },
    { key: "textStyleId", label: "Text style", applies: (n) => isText(n) && Boolean(n.textStyleId), value: (n, doc) => doc.styles?.texts.find((t) => t.id === n.textStyleId)?.name ?? null },
    { key: "lineHeight", label: "Line height", applies: isText, value: (n) => (n.lineHeight == null ? "Auto" : `${r(n.lineHeight * (n.fontSize ?? 16))}`) },
    { key: "letterSpacing", label: "Letter spacing", applies: isText, value: (n) => `${r(n.letterSpacing ?? 0)}%` },
    { key: "textAlign", label: "Text align", applies: isText, value: (n) => n.textAlign ?? "left" },
    { key: "layout", label: "Auto layout", applies: (n) => Boolean(n.layout), value: (n) => (n.layout ? (n.layout.direction === "vertical" ? "Vertical" : "Horizontal") : null) },
    { key: "gap", label: "Gap", applies: (n) => Boolean(n.layout), value: (n) => (n.layout ? r(n.layout.gap) : null) },
    { key: "padding", label: "Padding", applies: (n) => Boolean(n.layout), value: (n) => (n.layout ? n.layout.padding.map(r).join(" ") : null) },
    { key: "alignItems", label: "Alignment", applies: (n) => Boolean(n.layout && !n.layout.grid), value: (n) => (n.layout ? `${n.layout.primary}, ${n.layout.counter}` : null) },
    { key: "gridRowGap", label: "Grid row gap", applies: (n) => Boolean(n.layout?.grid), value: (n) => (n.layout?.grid ? r(n.layout.grid.rowGap) : null) },
    { key: "gridColumnGap", label: "Grid column gap", applies: (n) => Boolean(n.layout?.grid), value: (n) => (n.layout?.grid ? r(n.layout.grid.columnGap) : null) },
    { key: "gridRowCount", label: "Grid rows", applies: (n) => Boolean(n.layout?.grid), value: (n) => (n.layout?.grid ? (n.layout.grid.rows == null ? "Auto" : String(n.layout.grid.rows)) : null) },
    { key: "gridColumnCount", label: "Grid columns", applies: (n) => Boolean(n.layout?.grid), value: (n) => (n.layout?.grid ? String(n.layout.grid.columns) : null) },
    { key: "gridRowAnchorIndex", label: "Grid row", applies: (n) => Boolean(n.gridPosition), value: (n) => (n.gridPosition ? String(n.gridPosition.row + 1) : null) },
    { key: "gridColumnAnchorIndex", label: "Grid column", applies: (n) => Boolean(n.gridPosition), value: (n) => (n.gridPosition ? String(n.gridPosition.col + 1) : null) },
    { key: "gridRowSpan", label: "Grid row span", applies: (n) => Boolean(n.gridSpan), value: (n) => (n.gridSpan ? String(n.gridSpan.row) : null) },
    { key: "gridColumnSpan", label: "Grid column span", applies: (n) => Boolean(n.gridSpan), value: (n) => (n.gridSpan ? String(n.gridSpan.col) : null) },
    { key: "component", label: "Main component", applies: (n) => n.type === "instance", value: (n, doc) => (n.componentId ? (doc.nodes[n.componentId]?.name ?? null) : null) },
];

// Keys saved under an older name.
const LEGACY_KEYS: Record<string, string> = { textStyle: "textStyleId" };

export function propertyDef(key: string): PropertyDef | undefined {
    const k = LEGACY_KEYS[key] ?? key;
    return PROPERTIES.find((p) => p.key === k);
}

export function propertyValue(doc: NagmaDocument, node: SceneNode, key: string): string | null {
    const def = propertyDef(key);
    return def ? def.value(node, doc) : null;
}

// ---- Rich text: only a few safe tags survive ----

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "P", "DIV", "A", "SPAN"]);

export function sanitize(html: string): string {
    const root = document.createElement("div");
    root.innerHTML = html;
    const walk = (el: Element) => {
        for (const child of [...el.children]) {
            if (!ALLOWED.has(child.tagName)) {
                child.replaceWith(...[...child.childNodes]);
                continue;
            }
            for (const attr of [...child.attributes]) {
                const keep = child.tagName === "A" && attr.name === "href" && /^(https?:|mailto:)/i.test(attr.value);
                if (!keep) child.removeAttribute(attr.name);
            }
            if (child.tagName === "A") {
                child.setAttribute("target", "_blank");
                child.setAttribute("rel", "noreferrer");
            }
            walk(child);
        }
    };
    walk(root);
    return root.innerHTML;
}

export function plainText(html: string): string {
    const root = document.createElement("div");
    root.innerHTML = html.replace(/<(br|\/p|\/div|\/li)>/gi, "\n$&");
    return (root.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- Which note is selected or being edited (per viewer) ----

export type NoteRef = { kind: "annotation"; nodeId: string; id: string } | { kind: "measurement"; pageId: string; id: string };

interface NotesState {
    selected: NoteRef | null;
    editing: { nodeId: string; id: string } | null;
    // Categories hidden with "Filter by".
    hidden: string[];
}

let state: NotesState = { selected: null, editing: null, hidden: [] };
const listeners = new Set<() => void>();
export const notes = {
    get: () => state,
    set(patch: Partial<NotesState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(l: () => void) {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};
export function useNotes<T>(pick: (s: NotesState) => T): T {
    return useSyncExternalStore(notes.subscribe, () => pick(state));
}

// ---- Changes ----

export function startAnnotation(nodeId: string) {
    const node = editor.get().doc.nodes[nodeId];
    if (!node) return;
    const id = nanoid(6);
    editor.execute({ type: "node.update", id: nodeId, patch: { annotations: [...(node.annotations ?? []), { id, text: "", html: "", properties: [], categoryId: null }] } });
    editor.set({ selection: [nodeId] });
    notes.set({ editing: { nodeId, id }, selected: { kind: "annotation", nodeId, id } });
}

export function updateAnnotation(nodeId: string, id: string, patch: Partial<Annotation>) {
    const node = editor.get().doc.nodes[nodeId];
    if (!node?.annotations) return;
    editor.execute({ type: "node.update", id: nodeId, patch: { annotations: node.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) } });
}

export function removeAnnotation(nodeId: string, id: string) {
    const node = editor.get().doc.nodes[nodeId];
    if (!node?.annotations) return;
    const rest = node.annotations.filter((a) => a.id !== id);
    editor.execute({ type: "node.update", id: nodeId, patch: { annotations: rest.length ? rest : undefined } });
    notes.set({ selected: null, editing: state.editing?.id === id ? null : state.editing });
}

// Closes the editor; an annotation left empty goes away.
export function finishEditing() {
    const e = state.editing;
    notes.set({ editing: null });
    if (!e) return;
    const a = editor.get().doc.nodes[e.nodeId]?.annotations?.find((x) => x.id === e.id);
    if (a && !a.text.trim() && !(a.properties ?? []).length) removeAnnotation(e.nodeId, e.id);
}

export function addMeasurement(pageId: string, a: string, b: string) {
    const page = editor.get().doc.nodes[pageId];
    if (!page) return;
    const id = nanoid(6);
    editor.execute({ type: "node.update", id: pageId, patch: { measurements: [...(page.measurements ?? []), { id, a, b }] } });
    notes.set({ selected: { kind: "measurement", pageId, id } });
}

export function updateMeasurement(pageId: string, id: string, patch: { label?: string; offset?: number }) {
    const page = editor.get().doc.nodes[pageId];
    if (!page?.measurements) return;
    editor.execute({ type: "node.update", id: pageId, patch: { measurements: page.measurements.map((m) => (m.id === id ? { ...m, ...patch } : m)) } });
}

export function removeMeasurement(pageId: string, id: string) {
    const page = editor.get().doc.nodes[pageId];
    if (!page?.measurements) return;
    editor.execute({ type: "node.update", id: pageId, patch: { measurements: page.measurements.filter((m) => m.id !== id) } });
    notes.set({ selected: null });
}

// Delete or Backspace removes the selected annotation or measurement (before layers are deleted).
window.addEventListener(
    "keydown",
    (event) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        const sel = state.selected;
        if (event.key === "Escape" && (sel || state.editing)) {
            notes.set({ selected: null });
            return;
        }
        if (!sel || (event.key !== "Delete" && event.key !== "Backspace")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sel.kind === "annotation") removeAnnotation(sel.nodeId, sel.id);
        else removeMeasurement(sel.pageId, sel.id);
    },
    true,
);
// Picking layers clears a selected note.
let lastSelection = editor.get().selection;
editor.subscribe(() => {
    const s = editor.get().selection;
    if (s === lastSelection) return;
    lastSelection = s;
    const sel = state.selected;
    if (sel && !(sel.kind === "annotation" && s.length === 1 && s[0] === sel.nodeId)) notes.set({ selected: null });
});

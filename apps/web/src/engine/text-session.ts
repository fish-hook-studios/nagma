import { useSyncExternalStore } from "react";
import { MIXED, type CharStyle, type Mixed, layerPatch, materializeParagraphs, paragraphIndex, rangeValue, styleRange, tidyParagraphs, withoutKeys } from "./rich-text";
import { editor } from "./store";
import type { Command, ParagraphStyle, SceneNode, SpanStyle } from "./types";

// The text being edited: which layer, the selection inside it (anchor and focus, as character
// offsets), and the style the next typed characters get when it was changed at a bare caret.
// The Design panel and the text shortcuts read this to style just the selected range.

export interface TextSession {
    nodeId: string;
    anchor: number;
    focus: number;
    typing: SpanStyle | null;
}

let session: TextSession | null = null;
let version = 0;
const listeners = new Set<() => void>();

export const textSession = {
    get: () => session,
    set(next: TextSession | null) {
        session = next;
        version++;
        for (const l of listeners) l();
    },
    patch(patch: Partial<TextSession>) {
        if (!session) return;
        textSession.set({ ...session, ...patch });
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

// Where a double-click asked the caret to go (canvas coordinates), for the editor to pick up.
let editPoint: { x: number; y: number } | null = null;
export function editTextAt(point: { x: number; y: number } | null) {
    editPoint = point;
}
export function takeEditPoint() {
    const p = editPoint;
    editPoint = null;
    return p;
}

export function useTextSession(): TextSession | null {
    useSyncExternalStore(textSession.subscribe, () => version);
    return session;
}

// The selected range while editing this layer, or null when it isn't being edited.
export function sessionRange(nodeId: string): { start: number; end: number } | null {
    const s = session;
    if (!s || s.nodeId !== nodeId || editor.get().editingTextId !== nodeId) return null;
    return { start: Math.min(s.anchor, s.focus), end: Math.max(s.anchor, s.focus) };
}

// A character property across what the user is styling: the selected range while editing,
// else the whole layer. MIXED when it varies.
export function textValue<K extends keyof CharStyle>(node: SceneNode, key: K): CharStyle[K] | Mixed {
    const range = sessionRange(node.id);
    if (range) {
        const typed = range.start === range.end ? session?.typing?.[key as keyof SpanStyle] : undefined;
        if (typed !== undefined) return typed as CharStyle[K];
        return rangeValue(node, range.start, range.end, key);
    }
    return rangeValue(node, 0, Math.max(1, (node.text ?? "").length), key);
}

export function sharedTextValue<K extends keyof CharStyle>(nodes: SceneNode[], key: K): CharStyle[K] | Mixed {
    let out: CharStyle[K] | Mixed = MIXED;
    let first = true;
    for (const node of nodes) {
        const v = textValue(node, key);
        if (v === MIXED) return MIXED;
        if (first) {
            out = v;
            first = false;
        } else if (JSON.stringify(out) !== JSON.stringify(v)) return MIXED;
    }
    return out;
}

// Commands that set character properties: on the selected range while editing (the layer keeps
// its text style link; the range overrides it), else on whole layers (the layer's own value, with
// spans no longer overriding it). `keepStyle` keeps a whole layer's style link too (⌘B and friends).
export function styleCommands(nodes: SceneNode[], patch: SpanStyle, options: { keepStyle?: boolean } = {}): Command[] {
    return nodes.flatMap((node): Command[] => {
        const range = sessionRange(node.id);
        if (range) {
            if (range.start === range.end) return [];
            return [{ type: "node.update", id: node.id, patch: { spans: styleRange(node, range.start, range.end, patch) } }];
        }
        if (options.keepStyle && node.textStyleId) {
            const length = (node.text ?? "").length;
            return [{ type: "node.update", id: node.id, patch: { spans: styleRange(node, 0, length, patch) } }];
        }
        return [{ type: "node.update", id: node.id, patch: layerPatch(node, patch as Partial<SceneNode>) }];
    });
}

// Applies character properties to what's being styled. At a bare caret they become the style of
// the next characters typed.
export function applyCharStyle(nodes: SceneNode[], patch: SpanStyle, options: { keepStyle?: boolean; detachStyle?: boolean } = {}) {
    const s = session;
    if (s && editor.get().editingTextId === s.nodeId && s.anchor === s.focus && nodes.some((n) => n.id === s.nodeId)) {
        textSession.patch({ typing: { ...(s.typing ?? {}), ...patch } });
        return;
    }
    const commands = styleCommands(nodes, patch, options);
    // Hand edits to a whole styled layer break its link to the style.
    if (options.detachStyle) {
        for (const node of nodes) if (node.textStyleId && !sessionRange(node.id)) commands.push({ type: "node.update", id: node.id, patch: { textStyleId: null } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

// The paragraphs the selection touches while editing, or every paragraph.
export function selectedParagraphs(node: SceneNode): [number, number] {
    const range = sessionRange(node.id);
    const text = node.text ?? "";
    if (!range) return [0, paragraphIndex(text, text.length)];
    return [paragraphIndex(text, range.start), paragraphIndex(text, range.end)];
}

// Changes list settings of the selected paragraphs (all of them for a layer that isn't being edited).
export function updateParagraphs(nodes: SceneNode[], fn: (p: ParagraphStyle, index: number) => ParagraphStyle): Command[] {
    return nodes.map((node) => {
        const [a, b] = selectedParagraphs(node);
        const list = materializeParagraphs(node).map((p, i) => (i >= a && i <= b ? fn(p, i) : p));
        return { type: "node.update", id: node.id, patch: { paragraphs: tidyParagraphs(list) ?? [] } };
    });
}

export { MIXED, withoutKeys };

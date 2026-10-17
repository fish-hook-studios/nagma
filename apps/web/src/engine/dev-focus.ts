import { useSyncExternalStore } from "react";
import { applyCommand } from "./commands";
import { devView } from "./dev-view";
import { displayDoc } from "./prototype-runtime";
import { editor } from "./store";
import type { NagmaDocument } from "./types";

// Inspect's focus view can try things without touching the file: a temporary size for the design
// (type W and H, or drag the handles on its edges) to see how it responds, and a variable mode
// per collection to preview. The canvas shows a derived document; the file itself never changes,
// and leaving the focus view (or Reset) shows the real document again.

export interface FocusOverrides {
    w: number | null;
    h: number | null;
    modes: Record<string, string>;
}

const NONE: FocusOverrides = { w: null, h: null, modes: {} };
let overrides: FocusOverrides = NONE;
// The real document (the last one that didn't come from here) and what was derived from it.
let real: NagmaDocument | null = null;
let derived: NagmaDocument | null = null;
const listeners = new Set<() => void>();

function derive(doc: NagmaDocument, id: string, o: FocusOverrides): NagmaDocument {
    const node = doc.nodes[id];
    if (!node) return doc;
    let next = doc;
    if (o.w !== null || o.h !== null) next = applyCommand(doc, { type: "node.update", id, patch: { w: Math.max(1, o.w ?? node.w), h: Math.max(1, o.h ?? node.h) } });
    if (Object.keys(o.modes).length) next = displayDoc(next, { values: {}, modes: o.modes, variants: {} });
    return next;
}

function isActive(): boolean {
    return overrides.w !== null || overrides.h !== null || Object.keys(overrides.modes).length > 0;
}

function show() {
    const v = devView.get();
    const s = editor.get();
    if (v?.kind !== "focus" || !isActive()) {
        if (derived && s.doc === derived && real) {
            derived = null;
            editor.preview(real);
        }
        derived = null;
        return;
    }
    const base = real ?? s.doc;
    real = base;
    derived = derive(base, v.id, overrides);
    editor.preview(derived);
}

export const focusOverrides = {
    get: () => overrides,
    subscribe(l: () => void) {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useFocusOverrides(): FocusOverrides {
    return useSyncExternalStore(focusOverrides.subscribe, focusOverrides.get, focusOverrides.get);
}

export function setFocusOverrides(patch: Partial<FocusOverrides>) {
    overrides = { ...overrides, ...patch };
    for (const l of listeners) l();
    show();
}

export function resetFocusOverrides() {
    if (!isActive()) return;
    overrides = NONE;
    for (const l of listeners) l();
    show();
}

// The design's size as shown (the override, or its real size).
export function focusSize(id: string): { w: number; h: number } | null {
    const node = (real ?? editor.get().doc).nodes[id];
    if (!node) return null;
    return { w: Math.round(overrides.w ?? node.w), h: Math.round(overrides.h ?? node.h) };
}

// A document that didn't come from here (an edit, a remote change, another page): it becomes
// the real one and the preview is derived again. Leaving the focus view drops the preview.
editor.subscribe(() => {
    const s = editor.get();
    if (derived && s.doc !== derived) {
        real = s.doc;
        if (devView.get()?.kind === "focus" && isActive()) {
            derived = derive(real, (devView.get() as { id: string }).id, overrides);
            queueMicrotask(() => {
                if (editor.get().doc === real) editor.preview(derived as NagmaDocument);
            });
        } else derived = null;
    } else if (!derived) real = s.doc;
});
devView.subscribe(() => {
    if (devView.get()?.kind !== "focus") {
        overrides = NONE;
        for (const l of listeners) l();
        show();
    }
});

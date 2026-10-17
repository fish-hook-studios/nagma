import { useSyncExternalStore } from "react";
import { sceneFocus } from "../canvas/hit-test";
import { fitRect } from "./camera";
import { setMode } from "./modes";
import { pageOf } from "./page";
import { editor } from "./store";
import { worldBounds } from "./transform";
import type { Camera } from "./types";

// Inspect's handoff views: the Ready for dev view (every design with a status, in one list) and
// the focus view (one design alone on the canvas with its inspect panel). Leaving the focus view
// goes back where it was opened from: the list, or the spot on the canvas.

export type DevView = { kind: "list" } | { kind: "focus"; id: string; back: "list" | { pageId: string; camera: Camera; mode: ReturnType<typeof editor.get>["mode"] } } | null;

let view: DevView = null;
const listeners = new Set<() => void>();

function set(next: DevView) {
    view = next;
    sceneFocus.id = next?.kind === "focus" ? next.id : null;
    for (const l of listeners) l();
    // The canvas redraws on editor changes.
    editor.set({});
}

export const devView = {
    get: () => view,
    subscribe(l: () => void) {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useDevView(): DevView {
    return useSyncExternalStore(devView.subscribe, devView.get, devView.get);
}

export function openReadyView() {
    if (editor.get().mode !== "dev") setMode("dev");
    set({ kind: "list" });
}

export function closeDevView() {
    set(null);
}

export function openFocus(id: string, from: "list" | "canvas" = "canvas") {
    const s = editor.get();
    const node = s.doc.nodes[id];
    if (!node) return;
    const back = from === "list" ? "list" : { pageId: s.pageId, camera: s.camera, mode: s.mode };
    if (s.mode !== "dev") setMode("dev");
    const page = pageOf(s.doc, node);
    if (page && page !== editor.get().pageId) editor.setPage(page);
    editor.set({ selection: [id] });
    set({ kind: "focus", id, back });
    setTimeout(() => {
        const n = editor.get().doc.nodes[id];
        if (n) fitRect(worldBounds(editor.get().doc, n), 80, 4);
    }, 30);
}

// The close button: back to the list, or to where the canvas was.
export function leaveFocus() {
    const v = view;
    if (v?.kind !== "focus") return;
    if (v.back === "list") return set({ kind: "list" });
    set(null);
    const back = v.back;
    if (back.pageId !== editor.get().pageId) editor.setPage(back.pageId);
    editor.set({ camera: back.camera });
    if (back.mode !== "dev") setMode(back.mode);
}

// Inspect on page: the design in its place on the canvas, still selected.
export function inspectOnPage() {
    const v = view;
    if (v?.kind !== "focus") return;
    set(null);
    const n = editor.get().doc.nodes[v.id];
    if (n) setTimeout(() => fitRect(worldBounds(editor.get().doc, n), 80, 4), 30);
}

// Leaving Inspect closes both views.
editor.subscribe(() => {
    if (view && editor.get().mode !== "dev") set(null);
});

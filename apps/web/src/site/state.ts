import { useSyncExternalStore } from "react";
import { editor } from "../engine/store";
import type { BreakpointId } from "./types";

// The site editor's own state (per viewer, not part of the document): which panel is open on the
// left, the right panel's tab, the breakpoint in view and the open dialog.

export type SitePanel = "file" | "insert" | "cms";
export type SiteDialog = { kind: "settings"; tab?: "general" | "seo" | "fonts" | "code" } | { kind: "publish" } | { kind: "collection"; id: string } | null;

export interface SiteState {
    panel: SitePanel;
    rightTab: "design" | "interactions";
    // The breakpoint shown ("all" puts the frames side by side).
    view: "all" | BreakpointId;
    dialog: SiteDialog;
    busy: string | null;
    // The add-breakpoint menu, open at this canvas position.
    bpMenu: { x: number; y: number } | null;
    // The inline preview over the canvas (⇧Space).
    inlinePreview: boolean;
    insertTab: "blocks" | "templates";
    // The left panel hidden (its toggle at the top; any rail button shows it again).
    panelHidden: boolean;
    // The CMS: Edit shows the CMS view in place of the canvas; Connect keeps the canvas to connect layers.
    cmsMode: "edit" | "connect";
    // The webpage itself is selected (its layers row or its header on the canvas): the right panel
    // shows Webpage, Position, Selection colors and Export. Any layer selection clears it.
    pageSelected: boolean;
}

let state: SiteState = { panel: "file", rightTab: "design", view: "all", dialog: null, busy: null, bpMenu: null, inlinePreview: false, insertTab: "blocks", panelHidden: false, cmsMode: "edit", pageSelected: false };

// Selecting a layer (or switching page) unselects the webpage.
let lastSelection = editor.get().selection;
let lastPage = editor.get().pageId;
editor.subscribe(() => {
    const { selection, pageId } = editor.get();
    if (selection === lastSelection && pageId === lastPage) return;
    const changed = (selection !== lastSelection && selection.length > 0) || pageId !== lastPage;
    lastSelection = selection;
    lastPage = pageId;
    if (changed && state.pageSelected) site.set({ pageSelected: false });
});
const listeners = new Set<() => void>();

export const site = {
    get: () => state,
    set(patch: Partial<SiteState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useSite<T>(selector: (s: SiteState) => T): T {
    return useSyncExternalStore(site.subscribe, () => selector(state));
}

export const isSiteDoc = () => {
    const s = editor.get();
    return Boolean(s.doc.site) && !s.homeOpen && !s.presentingId;
};

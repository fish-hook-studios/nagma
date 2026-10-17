import { useMemo, useSyncExternalStore } from "react";
import { editor, useEditor } from "../engine/store";
import { slideIds } from "./model";

// The slides editor's own state (per viewer, not part of the document): the slide on screen, the
// single slide or grid view, slides or design mode, the panels, and the presentation in progress.

export interface SlidesState {
    // The slide shown in the single slide view, per file.
    current: Record<string, string>;
    view: "single" | "grid";
    mode: "slides" | "design";
    notesOpen: boolean;
    // The notes card's height in pixels (drag its handle to change it).
    notesHeight: number;
    // The slide itself is selected (its thumbnail, or its background on the canvas, was clicked):
    // the right panel shows the slide's settings rather than "No element selected".
    slideSelected: boolean;
    rightTab: "design" | "animate";
    // Rehearse shows a timer while presenting.
    rehearse: boolean;
    // Slides picked in the list or grid with ⌘-click or ⇧-click, besides the current one.
    picked: string[];
    // Groups folded in the slide list.
    collapsed: string[];
    // The group whose name is being typed (Rename group).
    renaming: string | null;
    exportOpen: boolean;
    // The template library (Browse templates).
    libraryOpen: boolean;
    // The prototype picker: true for a new prototype, or the id of the embed whose prototype changes.
    prototypeOpen: boolean | string;
    // The keyboard shortcuts list behind the "?" button.
    helpOpen: boolean;
    // New slide's panel over the canvas: a template's layouts, or the templates to pick from.
    newSlide: { view: "layouts"; themeId?: string; after?: string | null } | { view: "templates"; after?: string | null } | null;
}

let state: SlidesState = { current: {}, view: "single", mode: "slides", notesOpen: true, notesHeight: 96, slideSelected: true, rightTab: "design", rehearse: false, picked: [], collapsed: [], renaming: null, exportOpen: false, libraryOpen: false, prototypeOpen: false, helpOpen: false, newSlide: null };
const listeners = new Set<() => void>();

export const slides = {
    get: () => state,
    set(patch: Partial<SlidesState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useSlides<T>(selector: (s: SlidesState) => T): T {
    return useSyncExternalStore(slides.subscribe, () => selector(state));
}

// The slide on screen: the one chosen for this file, else the first.
export function currentSlide(): string | null {
    const s = editor.get();
    const ids = slideIds(s.doc);
    const chosen = state.current[s.fileId ?? ""];
    return chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null);
}

export function useCurrentSlide(): string | null {
    useSlides((s) => s.current);
    return useSyncExternalStore(editor.subscribe, currentSlide);
}

export function goToSlide(id: string, keepPicked = false) {
    const fileId = editor.get().fileId ?? "";
    slides.set({ current: { ...state.current, [fileId]: id }, slideSelected: true, ...(keepPicked ? {} : { picked: [] }) });
    const s = editor.get();
    if (s.selection.length || s.editingTextId) editor.set({ selection: [], editingTextId: null });
}

// The slides an action applies to: the picked ones (in deck order) with the current one, or just the current one.
export function selectedSlides(): string[] {
    const ids = slideIds(editor.get().doc);
    const current = currentSlide();
    const set = new Set([...state.picked, ...(current ? [current] : [])]);
    return ids.filter((id) => set.has(id));
}

export function useSelectedSlides(): string[] {
    const picked = useSlides((s) => s.picked);
    const current = useCurrentSlide();
    const doc = useEditor((s) => s.doc);
    return useMemo(() => {
        const set = new Set([...picked, ...(current ? [current] : [])]);
        return slideIds(doc).filter((id) => set.has(id));
    }, [picked, current, doc]);
}

// A click on a slide in the list or grid: ⌘ adds or removes it, ⇧ picks the range from the current one.
export function clickSlide(id: string, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
    const current = currentSlide();
    if ((event.metaKey || event.ctrlKey) && current) {
        const all = selectedSlides();
        if (all.includes(id)) {
            const rest = all.filter((s) => s !== id);
            if (!rest.length) return;
            // Taking the current slide out moves "current" to another picked slide.
            if (id === current) goToSlide(rest[0] as string, true);
            slides.set({ picked: rest.filter((s) => s !== currentSlide()) });
        } else slides.set({ picked: [...all.filter((s) => s !== id), id] });
        return;
    }
    if (event.shiftKey && current) {
        const ids = slideIds(editor.get().doc);
        const a = ids.indexOf(current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
            slides.set({ picked: ids.slice(Math.min(a, b), Math.max(a, b) + 1) });
            return;
        }
    }
    goToSlide(id);
}

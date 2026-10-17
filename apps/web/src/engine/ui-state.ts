// Interface state that isn't part of the document or the editor store: the Find panel and
// requests to the Layers panel. Kept apart so shortcuts, menus and panels can share it.
import { useSyncExternalStore } from "react";
import { viewCenter } from "./actions";
import { rectsIntersect, selectionBounds, topLevel } from "./nodes";
import { editor } from "./store";
import { worldBounds } from "./transform";
import type { FindKind } from "./find";
import type { NagmaDocument, Rect } from "./types";

export interface UiState {
    // Find and replace (⌘F) in the left panel.
    findOpen: boolean;
    findReplace: boolean;
    // What the Find panel last searched for, for Edit › Find next / previous.
    findQuery: { query: string; allPages: boolean; kind: FindKind };
    // Layers collapsed in the Layers panel. A file opens with every layer collapsed, so only the
    // top-level layers of each page show; the panel keeps what you open after that.
    collapsed: Set<string>;
    // Help › Keyboard shortcuts, docked along the bottom.
    shortcutsOpen: boolean;
    // ⌥Space: the keyboard selection box (world space), moved with the arrows; Return selects.
    keyBox: Rect | null;
    // A frame or section whose name label is being edited in place on the canvas.
    labelRename: string | null;
}

// Every layer with children.
function allCollapsed(doc: NagmaDocument): Set<string> {
    return new Set(Object.values(doc.nodes).filter((n) => n.children.length && n.type !== "page").map((n) => n.id));
}

let state: UiState = { findOpen: false, findReplace: false, findQuery: { query: "", allPages: false, kind: "all" }, collapsed: allCollapsed(editor.get().doc), shortcutsOpen: false, keyBox: null, labelRename: null };
const listeners = new Set<() => void>();

export const ui = {
    get: () => state,
    set(patch: Partial<UiState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useUi<T>(selector: (s: UiState) => T): T {
    return useSyncExternalStore(ui.subscribe, () => selector(state));
}

// ⌘F: the Layers panel shows Find; with `replace`, the replace field too.
export function openFind(replace = false) {
    editor.setPrefs({ leftPanel: "layers", leftPanelOpen: true });
    if (editor.get().uiMinimized) editor.set({ uiMinimized: false });
    ui.set({ findOpen: true, findReplace: replace || state.findReplace });
    // The field focuses once the panel is on screen.
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Find"]')?.select());
}

export function closeFind() {
    ui.set({ findOpen: false });
}

editor.onOpen((doc) => ui.set({ collapsed: allCollapsed(doc) }));

export function setCollapsed(next: Set<string>) {
    ui.set({ collapsed: next });
}

// ⌥L (View › Collapse layers): every layer closes, down to the top-level ones.
// Collapse layers (⌥L): everything folds except the way down to the selected layers.
export function collapseLayers() {
    editor.setPrefs({ leftPanel: "layers", leftPanelOpen: true });
    const { doc, selection } = editor.get();
    const collapsed = allCollapsed(doc);
    for (const id of selection) {
        let p = doc.nodes[id]?.parentId ?? null;
        while (p) {
            collapsed.delete(p);
            p = doc.nodes[p]?.parentId ?? null;
        }
    }
    ui.set({ collapsed });
}

// ⌃⇧? and Help › Keyboard shortcuts open the shortcuts panel (again closes it).
export function toggleShortcuts() {
    ui.set({ shortcutsOpen: !state.shortcutsOpen });
}

// ⌥Space starts the keyboard selection box around the selection, or 100 × 100 in the middle of
// the view. The canvas redraws on editor changes, so each change nudges the editor store too.
export function startKeyBox() {
    const { doc, selection } = editor.get();
    const around = selection.length ? selectionBounds(doc, selection) : null;
    const c = viewCenter();
    ui.set({ keyBox: around ?? { x: Math.round(c.x - 50), y: Math.round(c.y - 50), w: 100, h: 100 } });
    editor.set({ selection: [] });
}

// Arrows move the box; with ⌘ they resize it.
export function moveKeyBox(dx: number, dy: number, resize = false) {
    const box = state.keyBox;
    if (!box) return;
    ui.set({ keyBox: resize ? { ...box, w: Math.max(1, box.w + dx), h: Math.max(1, box.h + dy) } : { ...box, x: box.x + dx, y: box.y + dy } });
    editor.set({});
}

export function endKeyBox() {
    ui.set({ keyBox: null });
    editor.set({});
}

// Return selects the layers the box touches: top-level layers of the page, or the children of a
// frame the box lies inside, like a drawn marquee.
export function keyBoxSelect() {
    const box = state.keyBox;
    if (!box) return;
    const { doc, pageId } = editor.get();
    const scope = doc.nodes[pageId]?.children ?? doc.roots;
    const hits = scope.filter((id) => {
        const node = doc.nodes[id];
        return node && node.visible && !node.locked && rectsIntersect(worldBounds(doc, node), box);
    });
    // A box wholly inside one frame picks from that frame's children.
    const frame = hits.length === 1 ? doc.nodes[hits[0] ?? ""] : undefined;
    const inner = frame && frame.children.length && contains(worldBounds(doc, frame), box) ? frame.children.filter((id) => {
        const node = doc.nodes[id];
        return node && node.visible && !node.locked && rectsIntersect(worldBounds(doc, node), box);
    }) : [];
    editor.set({ selection: topLevel(doc, inner.length ? inner : hits) });
    ui.set({ keyBox: null });
}

function contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

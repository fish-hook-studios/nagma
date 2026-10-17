import { frameSelection, groupSelection, toggleSection, ungroupSelection } from "./actions";
import { editor } from "./store";

// The Design panel's layer type menu: turn a frame, group or section into one of the others,
// keeping its name, place in the layer list and children, as one undo step.

export type LayerKind = "frame" | "group" | "section";

export function layerKindOf(node: { type: string; isSection?: boolean }): LayerKind | null {
    if (node.type === "group") return "group";
    if (node.type === "frame") return node.isSection ? "section" : "frame";
    return null;
}

export function convertLayer(id: string, to: LayerKind) {
    const start = editor.get();
    const node = start.doc.nodes[id];
    if (!node) return;
    const from = layerKindOf(node);
    if (!from || from === to) return;
    const mark = start.past.at(-1);
    const name = node.name;
    let result: string | undefined = id;
    if (from === "group") {
        // Wrap the group in a frame of its size, then let the group's layers move up into it.
        editor.set({ selection: [id] });
        frameSelection();
        result = editor.get().selection[0];
        editor.set({ selection: [id] });
        ungroupSelection();
        if (result && to === "section") {
            editor.set({ selection: [result] });
            toggleSection();
        }
    } else if (to === "group") {
        if (!node.children.length) {
            editor.notify("An empty frame can't become a group.");
            return;
        }
        if (from === "section") toggleSection();
        // The frame's layers take its place, then group together.
        editor.set({ selection: [id] });
        ungroupSelection();
        groupSelection();
        result = editor.get().selection[0];
    } else {
        // Frame and section are the same layer with a different role.
        editor.set({ selection: [id] });
        toggleSection();
    }
    if (result && result !== id) editor.execute({ type: "node.update", id: result, patch: { name } });
    editor.set({ selection: result ? [result] : [] });
    // One undo step for the whole conversion.
    for (let guard = 0; guard < 20; guard++) {
        const past = editor.get().past;
        const prev = past.at(-2);
        if (!prev || prev === mark || past.at(-1) === mark) break;
        editor.mergeLast();
    }
}

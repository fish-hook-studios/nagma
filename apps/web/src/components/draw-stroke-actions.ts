import { enterVectorEdit } from "../engine/actions";
import { editor } from "../engine/store";
import { DEFAULT_DYNAMIC, STRETCH_BRUSHES, type BrushPreset } from "../engine/stroke-styles";
import type { SceneNode } from "../engine/types";
import { setVectorTool } from "../engine/vector-actions";
import { updateAll } from "./panel-fields";

// What the Draw-mode stroke controls do: width profile availability and editing, and switching a
// stroke between Basic, Dynamic and Brush.

// Width profiles work on vectors without a dynamic stroke.
export function profileable(nodes: SceneNode[]): boolean {
    return nodes.length > 0 && nodes.every((n) => n.type === "vector" && !n.dynamicStroke);
}

export function editWidthProfile(nodes: SceneNode[]) {
    const node = nodes[0];
    if (nodes.length !== 1 || !node) return;
    enterVectorEdit(node.id);
    if (editor.get().editingVectorId === node.id) setVectorTool("width");
}

export type StrokeType = "basic" | "dynamic" | "brush";

export function strokeTypeOf(n: SceneNode): StrokeType {
    return n.brushStroke ? "brush" : n.dynamicStroke ? "dynamic" : "basic";
}

export function setStrokeType(nodes: SceneNode[], type: StrokeType) {
    updateAll(nodes, (n) => {
        if (type === "basic") return { dynamicStroke: null, brushStroke: null };
        // Dynamic strokes replace width points; both types sit on the centre line without dashes.
        if (type === "dynamic") return { dynamicStroke: n.dynamicStroke ?? { ...DEFAULT_DYNAMIC }, brushStroke: null, widthPoints: null, strokeProfile: null, strokeAlign: "center", dash: null, dashPattern: null };
        return { brushStroke: n.brushStroke ?? { ...(STRETCH_BRUSHES[0] as BrushPreset).stroke }, dynamicStroke: null, strokeAlign: "center", dash: null, dashPattern: null };
    });
}


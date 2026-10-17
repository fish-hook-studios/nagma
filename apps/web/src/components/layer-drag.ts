// Dragging rows in the Layers panel: reorder, or reparent into a frame or group. Built on pointer
// events rather than native drag and drop, so the keyboard keeps working mid-drag: holding Space
// keeps the layers in their current parent (only their order changes), as on the canvas.
import { keys } from "../canvas/keys";
import { rehome } from "../engine/actions";
import { applyCommand, descendants } from "../engine/commands";
import { moveWouldNestItself } from "../engine/components";
import { topLevel } from "../engine/nodes";
import { editor } from "../engine/store";
import type { Command, SceneNode } from "../engine/types";

export type DropPosition = "above" | "below" | "inside";
export interface DropTarget {
    id: string;
    position: DropPosition;
}

// Set after a drag so the click that ends it doesn't also change the selection.
export const layerDragState = { justDragged: false };

const DRAG_THRESHOLD = 4;

function canHold(node: SceneNode): boolean {
    return (node.type === "frame" || node.type === "component" || node.type === "componentSet" || node.type === "group") && !node.isSlice;
}

// The row under a window point and where on it a drop would land.
export function dropTargetAt(clientX: number, clientY: number, ids: string[]): DropTarget | null {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-id]");
    const id = row?.dataset.layerId;
    if (!row || !id) return null;
    const { doc } = editor.get();
    const over = doc.nodes[id];
    if (!over) return null;
    const moving = topLevel(doc, ids);
    if (moving.includes(id) || moving.some((m) => descendants(doc, m).includes(id))) return null;
    const rect = row.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    let position: DropPosition = canHold(over) && ratio > 0.25 && ratio < 0.75 ? "inside" : ratio < 0.5 ? "above" : "below";
    if (keys.space) {
        // Space: no reparenting. Only rows among the dragged layers' own siblings take the drop.
        const parent = doc.nodes[moving[0] ?? ""]?.parentId ?? null;
        if (moving.some((m) => (doc.nodes[m]?.parentId ?? null) !== parent) || over.parentId !== parent) return null;
        if (position === "inside") position = ratio < 0.5 ? "above" : "below";
    }
    return { id, position };
}

// Moves the dragged layers next to (or into) the target row, keeping them in place on the canvas.
export function dropLayers(ids: string[], target: DropTarget) {
    const { doc } = editor.get();
    const over = doc.nodes[target.id];
    if (!over) return;
    const moving = topLevel(doc, ids).filter((id) => id !== target.id && !descendants(doc, id).includes(target.id));
    if (!moving.length) return;
    const destination = target.position === "inside" ? over : over.parentId ? doc.nodes[over.parentId] : undefined;
    if (moving.some((id) => doc.nodes[id]?.sourceId) || destination?.sourceId || destination?.type === "instance") {
        editor.notify("Instances mirror their main component, so their layers can't be rearranged here.");
        return;
    }
    // Sections live on the canvas or inside other sections, never in frames or groups.
    if (moving.some((id) => doc.nodes[id]?.isSection) && destination && destination.type !== "page" && !destination.isSection) {
        editor.notify("Sections can only sit on the canvas or inside another section.");
        return;
    }
    const parentId = target.position === "inside" ? over.id : over.parentId;
    if (moving.some((id) => moveWouldNestItself(doc, id, parentId))) {
        editor.notify("A component can't contain an instance of itself.");
        return;
    }
    let working = doc;
    const commands: Command[] = [];
    // The list shows front-most first, so walk the dragged layers from the bottom of the list up.
    for (const id of [...moving].reverse()) {
        const siblings = (parentId ? working.nodes[parentId]?.children : working.roots) ?? [];
        const without = siblings.filter((item) => item !== id);
        let index = without.length;
        if (target.position !== "inside") {
            const at = without.indexOf(over.id);
            // "Above" in the list means in front of the target, which is later in the children array.
            index = target.position === "above" ? at + 1 : at;
        }
        const step = rehome(working, id, parentId, index);
        commands.push(...step);
        working = applyCommand(working, { type: "batch", commands: step });
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: moving });
}

// Starts tracking a press on a row; past a few pixels it becomes a drag of the selection (or of
// this row). `show` receives the drop target to draw while dragging, and null at the end.
export function beginLayerDrag(event: React.PointerEvent, nodeId: string, list: HTMLElement | null, show: (target: DropTarget | null) => void) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) return;
    const start = { x: event.clientX, y: event.clientY };
    let last = start;
    let ids: string[] | null = null;
    let target: DropTarget | null = null;
    let scroll = 0;
    const update = () => {
        if (!ids) return;
        target = dropTargetAt(last.x, last.y, ids);
        show(target);
    };
    const tick = () => {
        // Near the top or bottom edge, the list scrolls so far rows can be reached.
        const r = list?.getBoundingClientRect();
        if (list && r && ids) {
            const edge = 24;
            const dy = last.y < r.top + edge ? -8 : last.y > r.bottom - edge ? 8 : 0;
            if (dy) {
                list.scrollTop += dy;
                update();
            }
        }
        scroll = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
        last = { x: e.clientX, y: e.clientY };
        if (!ids) {
            if (Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD) return;
            const { selection } = editor.get();
            ids = selection.includes(nodeId) ? selection : [nodeId];
            if (!selection.includes(nodeId)) editor.set({ selection: [nodeId] });
            document.body.style.cursor = "grabbing";
            scroll = requestAnimationFrame(tick);
        }
        update();
    };
    // Space pressed or released mid-drag changes where the layers may go.
    const key = (e: KeyboardEvent) => {
        if (e.code === "Space") requestAnimationFrame(update);
        if (e.key === "Escape" && ids) {
            ids = null;
            target = null;
            show(null);
            finish();
        }
    };
    const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        window.removeEventListener("keyup", key);
        cancelAnimationFrame(scroll);
        document.body.style.cursor = "";
    };
    const up = () => {
        finish();
        if (ids) {
            layerDragState.justDragged = true;
            setTimeout(() => (layerDragState.justDragged = false), 0);
            if (target) dropLayers(ids, target);
        }
        show(null);
    };
    const cancel = () => {
        finish();
        show(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
}

// Click-and-drag down the eye or padlock column: the first row flips, and every row the pointer
// passes over takes the same state, all in one undo step.
export function beginToggleDrag(event: React.PointerEvent, nodeId: string, field: "visible" | "locked") {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const base = editor.get().doc;
    const first = base.nodes[nodeId];
    if (!first) return;
    const value = field === "visible" ? !first.visible : !first.locked;
    const touched: string[] = [nodeId];
    const command = (): Command => ({ type: "batch", commands: touched.map((id) => ({ type: "node.update" as const, id, patch: { [field]: value } })) });
    editor.preview(applyCommand(base, command()));
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const move = (e: PointerEvent) => {
        // Rows count while the pointer stays over the icon column.
        if (e.clientX < column.left - 4 || e.clientX > column.right + 4) return;
        const row = document.elementFromPoint(column.left + column.width / 2, e.clientY)?.closest<HTMLElement>("[data-layer-id]");
        const id = row?.dataset.layerId;
        const node = id ? base.nodes[id] : undefined;
        if (!id || !node || touched.includes(id) || node[field] === value) return;
        touched.push(id);
        editor.preview(applyCommand(base, command()));
    };
    const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        editor.preview(base);
        editor.execute(command(), base);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
}

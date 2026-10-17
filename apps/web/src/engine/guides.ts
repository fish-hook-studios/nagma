import { nanoid } from "nanoid";
import { editor } from "./store";
import type { Command, GridStyle, LayoutGuide, NagmaDocument } from "./types";

// Where a column or row guide's cells fall along a frame's width or height, like the reference's layout
// grids: stretched between the margins, or fixed-width cells from the start or end (offset by the
// margin) or centred, with
// an automatic count that fits as many as there is room for.

export function guideCells(g: LayoutGuide, span: number): { start: number; size: number }[] {
    const gutter = Math.max(0, g.gutter);
    const align = g.align ?? "stretch";
    if (align === "stretch") {
        const count = Math.max(1, Math.round(g.count));
        const cell = (span - g.margin * 2 - gutter * (count - 1)) / count;
        if (cell <= 0) return [];
        return Array.from({ length: count }, (_, i) => ({ start: g.margin + i * (cell + gutter), size: cell }));
    }
    const size = Math.max(1, g.size);
    const room = align === "center" ? span : span - Math.max(0, g.margin);
    const count = g.countAuto ? Math.max(0, Math.floor((room + gutter) / (size + gutter))) : Math.max(1, Math.round(g.count));
    const total = count * size + Math.max(0, count - 1) * gutter;
    const first = align === "start" ? g.margin : align === "end" ? span - g.margin - total : (span - total) / 2;
    return Array.from({ length: count }, (_, i) => ({ start: first + i * (size + gutter), size }));
}

// The reference's default new guide: a 10 px uniform grid in translucent red.
export const DEFAULT_GUIDE: LayoutGuide = { kind: "grid", count: 5, gutter: 20, margin: 0, size: 10, color: "#FF0000", opacity: 0.1, visible: true, align: "stretch" };

// Guide styles: named sets of guides that frames follow; editing a style updates its frames.

const NO_GRIDS: GridStyle[] = [];

export function gridStylesOf(doc: NagmaDocument): GridStyle[] {
    return doc.styles?.grids ?? NO_GRIDS;
}

function setGridStyles(grids: GridStyle[], extra: Command[] = []) {
    const { doc } = editor.get();
    const styles = doc.styles ?? { colors: [], texts: [] };
    editor.execute({ type: "batch", commands: [{ type: "styles.set", styles: { ...styles, grids } }, ...extra] });
}

export function createGridStyle(name: string, guides: LayoutGuide[], applyTo: string[]): GridStyle {
    const { doc } = editor.get();
    const style: GridStyle = { id: nanoid(8), name: name.trim() || `Grid ${gridStylesOf(doc).length + 1}`, guides };
    setGridStyles([...gridStylesOf(doc), style], applyTo.map((id) => ({ type: "node.update", id, patch: { guides, gridStyleId: style.id } })));
    return style;
}

export function applyGridStyle(ids: string[], styleId: string) {
    const style = gridStylesOf(editor.get().doc).find((g) => g.id === styleId);
    if (!style) return;
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update", id, patch: { guides: style.guides, gridStyleId: style.id } })) });
}

export function updateGridStyle(styleId: string, patch: Partial<Omit<GridStyle, "id">>) {
    const { doc } = editor.get();
    const next = gridStylesOf(doc).map((g) => (g.id === styleId ? { ...g, ...patch } : g));
    const style = next.find((g) => g.id === styleId);
    const extra: Command[] = patch.guides && style ? Object.values(doc.nodes).filter((n) => n.gridStyleId === styleId).map((n) => ({ type: "node.update", id: n.id, patch: { guides: style.guides } })) : [];
    setGridStyles(next, extra);
}

export function deleteGridStyle(styleId: string) {
    const { doc } = editor.get();
    const extra: Command[] = Object.values(doc.nodes).filter((n) => n.gridStyleId === styleId).map((n) => ({ type: "node.update", id: n.id, patch: { gridStyleId: null } }));
    setGridStyles(gridStylesOf(doc).filter((g) => g.id !== styleId), extra);
}

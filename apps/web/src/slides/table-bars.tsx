import { Plus } from "@untitledui/icons";
import { useState } from "react";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { type TableModel, cellsIn, insertColumn, insertRow, moveColumn, moveRow, resizeTrack, tableModel, tableOf } from "./tables";

// The bars along a selected table's top and left edges: one per column and row. Click a bar to
// select its cells (⇧ for a range), drag it to move the column or row, drag the line between two
// bars to resize, and press "+" at a line to insert a column or row there.

const BAR = 10;
const OFF = 16;

type Axis = "row" | "column";

export function TableBars() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const camera = useEditor((s) => s.camera);
    const editing = useEditor((s) => s.editingTextId);
    const readOnly = useEditor((s) => s.readOnly);
    const table = selection.length ? tableOf(doc, selection[0]) : null;
    if (!table || editing || readOnly || selection.some((id) => tableOf(doc, id)?.id !== table.id)) return null;
    const model = tableModel(doc, table);
    const z = camera.zoom;
    const left = table.x * z + camera.x;
    const top = table.y * z + camera.y;
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Table rows and columns">
            <Strip axis="column" table={table} model={model} zoom={z} left={left} top={top} selection={selection} />
            <Strip axis="row" table={table} model={model} zoom={z} left={left} top={top} selection={selection} />
        </div>
    );
}

function Strip({ axis, table, model, zoom, left, top, selection }: { axis: Axis; table: SceneNode; model: TableModel; zoom: number; left: number; top: number; selection: string[] }) {
    const sizes = axis === "column" ? model.cols : model.rows;
    const starts = sizes.reduce<number[]>((acc, s, i) => [...acc, (acc[i] ?? 0) + s], [0]);
    const [drag, setDrag] = useState<{ kind: "move"; from: number; to: number } | { kind: "size"; index: number; size: number } | null>(null);
    const [anchor, setAnchor] = useState<number | null>(null);
    const horizontal = axis === "column";
    // Where a track starts, in screen pixels along the strip.
    const at = (i: number) => (starts[i] ?? 0) * zoom;
    const along = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
        const r = (el.parentElement as HTMLElement).getBoundingClientRect();
        return (horizontal ? e.clientX - r.left - left : e.clientY - r.top - top) / zoom;
    };
    const nearestLine = (pos: number) => starts.reduce((best, s, i) => (Math.abs(s - pos) < Math.abs((starts[best] ?? 0) - pos) ? i : best), 0);
    const selected = (i: number) => {
        const ids = cellsIn(model, axis, i);
        return ids.length > 0 && ids.every((id) => selection.includes(id));
    };
    const pick = (i: number, range: boolean) => {
        const from = range && anchor !== null ? Math.min(anchor, i) : i;
        const to = range && anchor !== null ? Math.max(anchor, i) : i;
        const ids = new Set<string>();
        for (let k = from; k <= to; k++) for (const id of cellsIn(model, axis, k)) ids.add(id);
        editor.set({ selection: [...ids] });
        if (!range) setAnchor(i);
    };
    const press = (e: React.PointerEvent<HTMLButtonElement>, i: number) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        const start = { x: e.clientX, y: e.clientY };
        let moved = false;
        const move = (ev: PointerEvent) => {
            if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
            moved = true;
            setDrag({ kind: "move", from: i, to: nearestLine(along(ev, el)) });
        };
        const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setDrag(null);
            if (!moved) return pick(i, ev.shiftKey);
            const line = nearestLine(along(ev, el));
            const to = line > i ? line - 1 : line;
            if (to !== i) (horizontal ? moveColumn : moveRow)(table.id, i, to);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const resize = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        const startPos = horizontal ? e.clientX : e.clientY;
        const startSize = sizes[index] ?? 0;
        const sizeAt = (ev: PointerEvent) => Math.max(24, startSize + ((horizontal ? ev.clientX : ev.clientY) - startPos) / zoom);
        const move = (ev: PointerEvent) => setDrag({ kind: "size", index, size: sizeAt(ev) });
        const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setDrag(null);
            if (Math.abs(sizeAt(ev) - startSize) >= 1) resizeTrack(table.id, axis, index, sizeAt(ev));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const box = (pos: number, length: number): React.CSSProperties =>
        horizontal ? { left: left + pos, top: top - OFF - BAR, width: length, height: BAR } : { top: top + pos, left: left - OFF - BAR, height: length, width: BAR };
    const total = at(sizes.length);
    const label = horizontal ? "column" : "row";
    return (
        <div className="group/strip">
            {/* The strip's hover area, so the "+" buttons show near it. */}
            <div className="pointer-events-auto absolute" style={horizontal ? { left, top: top - OFF - BAR - 22, width: total, height: BAR + 22 } : { top, left: left - OFF - BAR - 22, height: total, width: BAR + 22 }} />
            {sizes.map((_, i) => (
                <button
                    key={`b${i}`}
                    type="button"
                    aria-label={`Select ${label} ${i + 1}`}
                    title={`${horizontal ? "Column" : "Row"} ${i + 1}: click to select, drag to move`}
                    onPointerDown={(e) => press(e, i)}
                    className={`pointer-events-auto absolute rounded-[3px] transition-colors ${selected(i) ? "bg-brand-500" : "bg-brand-500/25 hover:bg-brand-500/60"} ${drag?.kind === "move" && drag.from === i ? "opacity-50" : ""}`}
                    style={box(at(i) + 1, Math.max(4, at(i + 1) - at(i) - 2))}
                />
            ))}
            {starts.map((_, i) => (
                <div key={`l${i}`}>
                    {i > 0 && i < sizes.length && (
                        <div
                            role="separator"
                            aria-label={`Resize ${label} ${i}`}
                            onPointerDown={(e) => resize(e, i - 1)}
                            className={`pointer-events-auto absolute ${horizontal ? "cursor-col-resize" : "cursor-row-resize"}`}
                            style={horizontal ? { left: left + at(i) - 3, top: top - OFF - BAR, width: 6, height: BAR } : { top: top + at(i) - 3, left: left - OFF - BAR, height: 6, width: BAR }}
                        />
                    )}
                    <button
                        type="button"
                        aria-label={`Insert ${label} ${horizontal ? (i === 0 ? "at the left" : `after column ${i}`) : i === 0 ? "at the top" : `after row ${i}`}`}
                        title={`Insert ${label}`}
                        onClick={() => (horizontal ? insertColumn : insertRow)(table.id, i)}
                        className="pointer-events-auto absolute flex size-4 items-center justify-center rounded-full bg-brand-500 text-white opacity-0 shadow transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/strip:opacity-100"
                        style={horizontal ? { left: left + at(i) - 8, top: top - OFF - BAR - 20 } : { top: top + at(i) - 8, left: left - OFF - BAR - 20 }}
                    >
                        <Plus className="size-3" />
                    </button>
                </div>
            ))}
            {drag?.kind === "move" && (
                <div className="absolute bg-brand-500" style={horizontal ? { left: left + at(drag.to) - 1, top: top - OFF - BAR, width: 2, height: OFF + BAR + table.h * zoom } : { top: top + at(drag.to) - 1, left: left - OFF - BAR, height: 2, width: OFF + BAR + table.w * zoom }} />
            )}
            {drag?.kind === "size" && (
                <div className="absolute bg-brand-500" style={horizontal ? { left: left + at(drag.index) + drag.size * zoom - 0.5, top: top - OFF - BAR, width: 1, height: OFF + BAR + table.h * zoom } : { top: top + at(drag.index) + drag.size * zoom - 0.5, left: left - OFF - BAR, height: 1, width: OFF + BAR + table.w * zoom }} />
            )}
        </div>
    );
}

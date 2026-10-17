import { editor } from "../engine/store";
import { layoutText } from "../engine/text-layout";
import type { SceneNode } from "../engine/types";
import { JAM_FONTS, jamOf } from "./model";
import { board } from "./state";
import type { CellStyle, JamData } from "./types";

// Table edits shared by the canvas, the context menu and the context bar: cell text and looks,
// rows and columns (insert, delete, move, duplicate, fit to their text), merged cells, and the
// cells, rows or columns picked inside a table.

type Table = Extract<JamData, { kind: "table" }>;
export type Axis = "row" | "col";
export interface Merge {
    r: number;
    c: number;
    rs: number;
    cs: number;
}
// A block of cells, inclusive.
export interface Range {
    top: number;
    left: number;
    bottom: number;
    right: number;
}

export function patchJamCell(id: string, cell: [number, number], text: string) {
    const node = editor.get().doc.nodes[id];
    const jam = jamOf(node, "table");
    if (!jam) return;
    const [r, c] = cell;
    const cells = jam.cells.map((row, i) => (i === r ? row.map((v, k) => (k === c ? text : v)) : row));
    editor.execute({ type: "node.update", id, patch: { jam: { ...jam, cells } } });
}

// ---- Merged cells ----

export function mergeAt(jam: Table, r: number, c: number): Merge | null {
    return jam.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs) ?? null;
}

// A cell hidden under a merge (every merged cell but its top-left one).
export function covered(jam: Table, r: number, c: number): boolean {
    const m = mergeAt(jam, r, c);
    return Boolean(m && (m.r !== r || m.c !== c));
}

// The cell that owns (r, c): itself, or the top-left of its merge.
export function anchorOf(jam: Table, r: number, c: number): [number, number] {
    const m = mergeAt(jam, r, c);
    return m ? [m.r, m.c] : [r, c];
}

// A block grown until no merge sticks out of it.
export function expand(jam: Table, range: Range): Range {
    let out = { ...range };
    for (let changed = true; changed; ) {
        changed = false;
        for (const m of jam.merges ?? []) {
            const overlaps = m.r <= out.bottom && m.r + m.rs - 1 >= out.top && m.c <= out.right && m.c + m.cs - 1 >= out.left;
            if (!overlaps) continue;
            const next = { top: Math.min(out.top, m.r), left: Math.min(out.left, m.c), bottom: Math.max(out.bottom, m.r + m.rs - 1), right: Math.max(out.right, m.c + m.cs - 1) };
            if (next.top !== out.top || next.left !== out.left || next.bottom !== out.bottom || next.right !== out.right) {
                out = next;
                changed = true;
            }
        }
    }
    return out;
}

// ---- What's picked in a table ----

type Picked = NonNullable<ReturnType<typeof board.get>["tableSel"]>;

export function selRange(sel: Picked): Range {
    return { top: Math.min(sel.r0, sel.r1), left: Math.min(sel.c0, sel.c1), bottom: Math.max(sel.r0, sel.r1), right: Math.max(sel.c0, sel.c1) };
}

// The picked block of the table `id` (merges included), if any.
export function pickedRange(id: string): Range | null {
    const sel = board.get().tableSel;
    const jam = jamOf(editor.get().doc.nodes[id], "table");
    if (!sel || sel.id !== id || !jam) return null;
    return expand(jam, clampRange(jam, selRange(sel)));
}

function clampRange(jam: Table, r: Range): Range {
    const rows = jam.rows.length - 1;
    const cols = jam.cols.length - 1;
    const c = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    return { top: c(r.top, rows), left: c(r.left, cols), bottom: c(r.bottom, rows), right: c(r.right, cols) };
}

export function pickCells(id: string, r0: number, c0: number, r1 = r0, c1 = c0, whole?: Axis) {
    board.set({ tableSel: { id, r0, c0, r1, c1, ...(whole ? { whole } : {}) } });
}

// The whole rows or columns picked (by their grabbers), as indexes.
export function pickedLines(id: string): { axis: Axis; indexes: number[] } | null {
    const sel = board.get().tableSel;
    if (!sel || sel.id !== id || !sel.whole) return null;
    const r = selRange(sel);
    const [lo, hi] = sel.whole === "row" ? [r.top, r.bottom] : [r.left, r.right];
    return { axis: sel.whole, indexes: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) };
}

// ---- Rows and columns ----

function grid<T>(jam: Table, list: T[][] | undefined, blank: T): T[][] {
    return jam.cells.map((row, r) => row.map((_, c) => list?.[r]?.[c] ?? blank));
}

// Rebuilds a table's rows or columns from `perm`: for each new track, the old one it comes from,
// or null for a new empty one. Text, colours, looks and merges travel with their tracks.
function permute(node: SceneNode, jam: Table, axis: Axis, perm: (number | null)[]): { jam: Table; size: Partial<SceneNode> } {
    const tracks = axis === "row" ? jam.rows : jam.cols;
    const total = tracks.reduce((a, b) => a + b, 0) || 1;
    const avg = total / Math.max(1, tracks.length);
    const nextTracks = perm.map((i) => (i === null ? avg : (tracks[i] ?? avg)));
    const nextTotal = nextTracks.reduce((a, b) => a + b, 0);
    const pick = <T>(rows: T[][], blank: () => T): T[][] =>
        axis === "row" ? perm.map((i) => (i === null ? (rows[0] ?? []).map(blank) : (rows[i] ?? []).slice())) : rows.map((row) => perm.map((i) => (i === null ? blank() : (row[i] as T))));
    const cells = pick(jam.cells, () => "");
    const fills = jam.fills ? pick(grid(jam, jam.fills, null as string | null), () => null) : undefined;
    const styles = jam.styles ? pick(grid(jam, jam.styles, null as CellStyle | null), () => null) : undefined;
    // A merge survives while its tracks stay together (it grows over tracks added inside it).
    const merges: Merge[] = [];
    // A duplicated track shows up twice: the original copies (first appearances) keep the merge,
    // growing over copies placed inside it, and a full copy of the merge's tracks gets a merge of
    // its own. (Before, any duplicated track dropped the merge for the original too.)
    const seen = new Map<number, number>();
    const copyOf = perm.map((old) => {
        if (old === null) return 0;
        const k = seen.get(old) ?? 0;
        seen.set(old, k + 1);
        return k;
    });
    for (const m of jam.merges ?? []) {
        const [start, span] = axis === "row" ? [m.r, m.rs] : [m.c, m.cs];
        const inside = (old: number | null | undefined) => old !== null && old !== undefined && old >= start && old < start + span;
        for (let copy = 0; ; copy++) {
            const at = perm.map((old, i) => (inside(old) && copyOf[i] === copy ? i : -1)).filter((i) => i >= 0);
            if (!at.length || (copy > 0 && at.length !== span)) break;
            const lo = Math.min(...at);
            const hi = Math.max(...at);
            let whole = true;
            for (let i = lo; i <= hi; i++) {
                const old = perm[i];
                // Inside the span: this copy's tracks, or (for the original) copies of its own tracks.
                if (old !== null && old !== undefined && (!inside(old) || (copy > 0 && copyOf[i] !== copy))) whole = false;
            }
            if (!whole) continue;
            const next = axis === "row" ? { ...m, r: lo, rs: hi - lo + 1 } : { ...m, c: lo, cs: hi - lo + 1 };
            if (next.rs * next.cs > 1) merges.push(next);
        }
    }
    const out: Table = { ...jam, cells, ...(axis === "row" ? { rows: nextTracks } : { cols: nextTracks }), fills, styles, merges: merges.length ? merges : undefined };
    const size = axis === "row" ? { h: Math.max(8, (node.h * nextTotal) / total) } : { w: Math.max(8, (node.w * nextTotal) / total) };
    return { jam: out, size };
}

function commit(id: string, change: (node: SceneNode, jam: Table) => { jam: Table; size?: Partial<SceneNode> } | null) {
    const node = editor.get().doc.nodes[id];
    const jam = jamOf(node, "table");
    if (!node || !jam) return;
    const next = change(node, jam);
    if (next) editor.execute({ type: "node.update", id, patch: { jam: next.jam, ...next.size } });
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// Adds `count` empty rows or columns before index `at` (at = length appends).
export function insertTracks(id: string, axis: Axis, at: number, count = 1) {
    commit(id, (node, jam) => {
        const n = axis === "row" ? jam.rows.length : jam.cols.length;
        const i = Math.max(0, Math.min(n, at));
        return permute(node, jam, axis, [...range(i), ...Array.from({ length: count }, () => null), ...range(n - i).map((k) => k + i)]);
    });
}

export function deleteTracks(id: string, axis: Axis, indexes: number[]) {
    commit(id, (node, jam) => {
        const n = axis === "row" ? jam.rows.length : jam.cols.length;
        const keep = range(n).filter((i) => !indexes.includes(i));
        // The last row or column can't go (delete the table instead).
        if (!keep.length) return null;
        return permute(node, jam, axis, keep);
    });
    board.set({ tableSel: null });
}

// Moves a block of tracks so it starts at `to` (counted in the table without the block).
export function moveTracks(id: string, axis: Axis, indexes: number[], to: number) {
    commit(id, (node, jam) => {
        const n = axis === "row" ? jam.rows.length : jam.cols.length;
        const rest = range(n).filter((i) => !indexes.includes(i));
        const at = Math.max(0, Math.min(rest.length, to));
        const perm = [...rest.slice(0, at), ...indexes, ...rest.slice(at)];
        if (perm.every((v, i) => v === i)) return null;
        return permute(node, jam, axis, perm);
    });
}

export function duplicateTracks(id: string, axis: Axis, indexes: number[]) {
    commit(id, (node, jam) => {
        const n = axis === "row" ? jam.rows.length : jam.cols.length;
        const last = Math.max(...indexes);
        return permute(node, jam, axis, [...range(last + 1), ...indexes, ...range(n - last - 1).map((k) => k + last + 1)]);
    });
}

// The text layer for a cell's text in `box` (the cell's own look over the table's).
export function cellLayer(node: SceneNode, jam: Table, r: number, c: number, box: { x: number; y: number; w: number; h: number }, text: string): SceneNode {
    const style = jam.styles?.[r]?.[c] ?? null;
    const bold = style?.bold !== undefined ? style.bold : r === 0;
    return {
        ...node,
        type: "text",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        rotation: 0,
        flipX: false,
        flipY: false,
        fills: [{ type: "solid", color: style?.link ? "#0C8CE9" : (style?.color ?? "#1E1E1E"), opacity: 1, visible: true, blend: "normal" }],
        strokes: [],
        shadow: null,
        effects: [],
        fontFamily: style?.font ? JAM_FONTS[style.font].family : (node.fontFamily ?? "Inter"),
        fontSize: style?.size ?? node.fontSize ?? 14,
        fontWeight: bold ? (r === 0 && style?.bold === undefined ? 600 : 700) : 400,
        decoration: style?.link ? "underline" : style?.strike ? "strikethrough" : "none",
        text,
        spans: undefined,
        list: null,
        textAlign: style?.align ?? "left",
        textAlignV: "top",
        sizing: { h: "fixed", v: "fixed" },
        jam: undefined,
    };
}

// Sizes the rows or columns to their text (columns to the widest line, rows to the tallest cell).
export function fitTracks(id: string, axis: Axis, indexes: number[]) {
    commit(id, (node, jam) => {
        const tracks = axis === "row" ? jam.rows : jam.cols;
        const size = axis === "row" ? node.h : node.w;
        const total = tracks.reduce((a, b) => a + b, 0) || 1;
        const abs = tracks.map((t) => (t / total) * size);
        const colTotal = jam.cols.reduce((a, b) => a + b, 0) || 1;
        const colW = jam.cols.map((t) => (t / colTotal) * node.w);
        for (const i of indexes) {
            let want = axis === "row" ? 48 : 64;
            jam.cells.forEach((row, r) =>
                row.forEach((text, c) => {
                    if ((axis === "row" ? r : c) !== i || !text || mergeAt(jam, r, c)) return;
                    if (axis === "col") {
                        const layout = layoutText(cellLayer(node, jam, r, c, { x: 0, y: 0, w: 100000, h: 1000 }, text));
                        want = Math.max(want, layout.lines.reduce((a, l) => Math.max(a, l.width), 0) + 24);
                    } else {
                        const layout = layoutText(cellLayer(node, jam, r, c, { x: 0, y: 0, w: Math.max(1, (colW[c] ?? 160) - 20), h: 100000 }, text));
                        want = Math.max(want, layout.height + 18);
                    }
                }),
            );
            abs[i] = Math.ceil(want);
        }
        const sum = abs.reduce((a, b) => a + b, 0);
        return { jam: axis === "row" ? { ...jam, rows: abs } : { ...jam, cols: abs }, size: axis === "row" ? { h: sum } : { w: sum } };
    });
}

// ---- Cells ----

function eachCell(jam: Table, r: Range, fn: (row: number, col: number) => void) {
    for (let row = r.top; row <= r.bottom; row++) for (let col = r.left; col <= r.right; col++) if (row < jam.rows.length && col < jam.cols.length) fn(row, col);
}

const everything = (jam: Table): Range => ({ top: 0, left: 0, bottom: jam.rows.length - 1, right: jam.cols.length - 1 });

// Changes the look of the cells in a block (every cell when no block is given).
export function styleCells(id: string, block: Range | null, patch: Partial<CellStyle>) {
    commit(id, (_node, jam) => {
        const styles = grid(jam, jam.styles, null as CellStyle | null);
        eachCell(jam, block ?? everything(jam), (row, col) => {
            const next: CellStyle = { ...(styles[row]?.[col] ?? {}), ...patch };
            for (const key of Object.keys(next) as (keyof CellStyle)[]) if (next[key] === undefined || next[key] === null) delete next[key];
            (styles[row] as (CellStyle | null)[])[col] = Object.keys(next).length ? next : null;
        });
        return { jam: { ...jam, styles } };
    });
}

export function fillCells(id: string, block: Range | null, color: string | null) {
    commit(id, (_node, jam) => {
        const fills = grid(jam, jam.fills, null as string | null);
        eachCell(jam, block ?? everything(jam), (row, col) => ((fills[row] as (string | null)[])[col] = color));
        return { jam: { ...jam, fills } };
    });
}

export function clearCells(id: string, block: Range) {
    commit(id, (_node, jam) => {
        const cells = jam.cells.map((row) => row.slice());
        eachCell(jam, block, (row, col) => ((cells[row] as string[])[col] = ""));
        return { jam: { ...jam, cells } };
    });
}

// Merges a block into one cell: the text of its cells joins up in the top-left one.
export function mergeCells(id: string, block: Range) {
    commit(id, (_node, jam) => {
        const r = expand(jam, block);
        if (r.top === r.bottom && r.left === r.right) return null;
        const cells = jam.cells.map((row) => row.slice());
        const texts: string[] = [];
        eachCell(jam, r, (row, col) => {
            const t = cells[row]?.[col];
            if (t) texts.push(t);
            (cells[row] as string[])[col] = "";
        });
        (cells[r.top] as string[])[r.left] = texts.join("\n");
        const merges = (jam.merges ?? []).filter((m) => m.r > r.bottom || m.r + m.rs - 1 < r.top || m.c > r.right || m.c + m.cs - 1 < r.left);
        merges.push({ r: r.top, c: r.left, rs: r.bottom - r.top + 1, cs: r.right - r.left + 1 });
        return { jam: { ...jam, cells, merges } };
    });
    // The merged cell's anchor is the grown block's corner (a covered cell stayed picked when the
    // block grew up or left over an existing merge).
    const jam = jamOf(editor.get().doc.nodes[id], "table");
    const grown = jam ? expand(jam, block) : block;
    pickCells(id, grown.top, grown.left);
}

export function unmergeCells(id: string, block: Range) {
    commit(id, (_node, jam) => {
        const merges = (jam.merges ?? []).filter((m) => m.r > block.bottom || m.r + m.rs - 1 < block.top || m.c > block.right || m.c + m.cs - 1 < block.left);
        if (merges.length === (jam.merges ?? []).length) return null;
        return { jam: { ...jam, merges: merges.length ? merges : undefined } };
    });
}

export function hasMerge(jam: Table, block: Range): boolean {
    return (jam.merges ?? []).some((m) => !(m.r > block.bottom || m.r + m.rs - 1 < block.top || m.c > block.right || m.c + m.cs - 1 < block.left));
}

// The next cell from (r, c) one step in a direction, stepping over merged cells; Tab order (next,
// prev) runs along each row, then on to the next.
export function stepCell(jam: Table, r: number, c: number, dir: "up" | "down" | "left" | "right" | "next" | "prev"): [number, number] | null {
    const rows = jam.rows.length;
    const cols = jam.cols.length;
    const box = mergeAt(jam, r, c) ?? { r, c, rs: 1, cs: 1 };
    if (dir === "next" || dir === "prev") {
        const order: [number, number][] = [];
        for (let i = 0; i < rows; i++) for (let k = 0; k < cols; k++) if (!covered(jam, i, k)) order.push([i, k]);
        const at = order.findIndex(([i, k]) => i === box.r && k === box.c);
        return order[at + (dir === "next" ? 1 : -1)] ?? null;
    }
    const nr = dir === "up" ? box.r - 1 : dir === "down" ? box.r + box.rs : r;
    const nc = dir === "left" ? box.c - 1 : dir === "right" ? box.c + box.cs : c;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
    return anchorOf(jam, nr, nc);
}

import { cloneSubtree } from "../engine/nodes";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { slideAround, themeOf } from "./model";

// Tables on slides: a frame of cell frames, each holding a text. The table keeps its column widths
// and row heights; each cell knows its row and column and how many it spans (merged cells), so
// rows and columns can be inserted, deleted, moved and resized, and cells merged and split.

export interface TableCell {
    id: string;
    r: number;
    c: number;
    rs: number;
    cs: number;
}

export interface TableModel {
    cols: number[];
    rows: number[];
    cells: TableCell[];
}

// Most cells a table holds.
export const MAX_CELLS = 500;

const PAD = 28;

// A table's model: from its own data, or (tables made before it was kept) from where its cells sit.
export function tableModel(doc: NagmaDocument, table: SceneNode): TableModel {
    const kids = table.children.map((c) => doc.nodes[c]).filter((n): n is SceneNode => Boolean(n));
    const data = table.deck?.kind === "table" ? table.deck : null;
    if (data?.cols && data.rows && kids.every((k) => k.deck?.kind === "cell")) {
        return { cols: [...data.cols], rows: [...data.rows], cells: kids.map((k) => (k.deck?.kind === "cell" ? { id: k.id, r: k.deck.r, c: k.deck.c, rs: k.deck.rs ?? 1, cs: k.deck.cs ?? 1 } : { id: k.id, r: 0, c: 0, rs: 1, cs: 1 })) };
    }
    const ys = [...new Set(kids.map((c) => Math.round(c.y)))].sort((a, b) => a - b);
    const xs = [...new Set(kids.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    const cols = xs.map((x) => kids.find((k) => Math.round(k.x) === x)?.w ?? 200);
    const rows = ys.map((y) => kids.find((k) => Math.round(k.y) === y)?.h ?? 100);
    return { cols, rows, cells: kids.map((k) => ({ id: k.id, r: ys.indexOf(Math.round(k.y)), c: xs.indexOf(Math.round(k.x)), rs: 1, cs: 1 })) };
}

// The table a layer belongs to (itself, a cell, or a cell's text).
export function tableOf(doc: NagmaDocument, id: string | undefined): SceneNode | null {
    let node = id ? doc.nodes[id] : undefined;
    while (node) {
        if (node.deck?.kind === "table") return node;
        node = node.parentId ? doc.nodes[node.parentId] : undefined;
    }
    return null;
}

// The cell a layer is (or is inside).
export function cellOf(doc: NagmaDocument, id: string | undefined): SceneNode | null {
    let node = id ? doc.nodes[id] : undefined;
    while (node) {
        const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
        if (parent?.deck?.kind === "table") return node;
        node = parent;
    }
    return null;
}

const sum = (list: number[], to: number) => list.slice(0, to).reduce((a, b) => a + b, 0);

// Places every cell (and its text) from the model, and writes the model on the table.
export function layoutCommands(doc: NagmaDocument, table: SceneNode, model: TableModel): Command[] {
    const out: Command[] = [];
    const data = table.deck?.kind === "table" ? table.deck : { kind: "table" as const };
    const w = sum(model.cols, model.cols.length);
    const h = sum(model.rows, model.rows.length);
    out.push({ type: "node.update", id: table.id, patch: { w, h, deck: { ...data, cols: model.cols, rows: model.rows } } });
    for (const cell of model.cells) {
        const node = doc.nodes[cell.id];
        if (!node) continue;
        const x = table.x + sum(model.cols, cell.c);
        const y = table.y + sum(model.rows, cell.r);
        const cw = sum(model.cols, cell.c + cell.cs) - sum(model.cols, cell.c);
        const ch = sum(model.rows, cell.r + cell.rs) - sum(model.rows, cell.r);
        out.push({ type: "node.update", id: cell.id, patch: { x, y, w: cw, h: ch, deck: { kind: "cell", r: cell.r, c: cell.c, ...(cell.rs > 1 ? { rs: cell.rs } : {}), ...(cell.cs > 1 ? { cs: cell.cs } : {}) } } });
        for (const tid of node.children) {
            const text = doc.nodes[tid];
            if (text?.type !== "text") continue;
            out.push({ type: "node.update", id: tid, patch: { x: x + PAD, w: Math.max(10, cw - PAD * 2), y: y + Math.max(0, (ch - text.h) / 2) } });
        }
    }
    return out;
}

// A blank copy of `from` (a cell), for row or column `r`, `c`.
function blankCell(doc: NagmaDocument, from: SceneNode, tableId: string, r: number, c: number): { cell: TableCell; commands: Command[] } {
    const copies = cloneSubtree(doc, from.id, 0, tableId);
    const commands = copies.map((n, i) => ({ type: "node.create" as const, node: { ...n, children: [], ...(i > 0 && n.type === "text" ? { text: "", spans: undefined } : {}), ...(i === 0 ? { deck: { kind: "cell" as const, r, c } } : {}) } }));
    return { cell: { id: copies[0]?.id ?? "", r, c, rs: 1, cs: 1 }, commands };
}

// The cell covering row r, column c.
export function cellAt(model: TableModel, r: number, c: number): TableCell | undefined {
    return model.cells.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
}

type Edit = (doc: NagmaDocument, table: SceneNode, model: TableModel) => Command[] | string | null;

// Runs an edit on a table's model as one undo step, laying the table out again after it.
export function editTableModel(tableId: string, edit: Edit): boolean {
    const s = editor.get();
    const table = s.doc.nodes[tableId];
    if (!table || s.readOnly) return false;
    const model = tableModel(s.doc, table);
    const made = edit(s.doc, table, model);
    if (typeof made === "string") {
        editor.notify(made);
        return false;
    }
    if (!made) return false;
    let doc = s.doc;
    for (const c of made) doc = applyLocal(doc, c);
    const after = doc.nodes[tableId];
    if (!after) return false;
    editor.execute({ type: "batch", commands: [...made, ...layoutCommands(doc, after, model)] });
    return true;
}

// Commands applied to a scratch copy, so layout sees new cells (only creates and deletes matter).
function applyLocal(doc: NagmaDocument, command: Command): NagmaDocument {
    if (command.type === "node.create") {
        const parent = command.node.parentId ? doc.nodes[command.node.parentId] : undefined;
        const nodes = { ...doc.nodes, [command.node.id]: command.node };
        if (parent) nodes[parent.id] = { ...parent, children: [...parent.children, command.node.id] };
        return { ...doc, nodes };
    }
    return doc;
}

export function insertRow(tableId: string, at: number) {
    editTableModel(tableId, (doc, table, m) => {
        if ((m.rows.length + 1) * m.cols.length > MAX_CELLS) return `Tables hold up to ${MAX_CELLS} cells.`;
        const ref = Math.max(0, Math.min(m.rows.length - 1, at === 0 ? 0 : at - 1));
        const height = m.rows[ref] ?? 100;
        const out: Command[] = [];
        for (const cell of m.cells) {
            if (cell.r >= at) cell.r++;
            else if (cell.r + cell.rs > at) cell.rs++;
        }
        m.rows.splice(at, 0, height);
        for (let c = 0; c < m.cols.length; c++) {
            if (cellAt(m, at, c)) continue;
            // Copy the look of the cell above (below for a new first row, skipping the header's look).
            const source = cellAt(m, at === 0 ? 1 : ref === 0 && m.rows.length > 2 ? Math.min(2, m.rows.length - 1) : at - 1, c);
            const node = source ? doc.nodes[source.id] : undefined;
            if (!node) continue;
            const made = blankCell(doc, node, table.id, at, c);
            out.push(...made.commands);
            m.cells.push(made.cell);
        }
        return out;
    });
}

export function insertColumn(tableId: string, at: number) {
    editTableModel(tableId, (doc, table, m) => {
        if (m.rows.length * (m.cols.length + 1) > MAX_CELLS) return `Tables hold up to ${MAX_CELLS} cells.`;
        const ref = Math.max(0, Math.min(m.cols.length - 1, at === 0 ? 0 : at - 1));
        const width = m.cols[ref] ?? 200;
        const out: Command[] = [];
        for (const cell of m.cells) {
            if (cell.c >= at) cell.c++;
            else if (cell.c + cell.cs > at) cell.cs++;
        }
        m.cols.splice(at, 0, width);
        for (let r = 0; r < m.rows.length; r++) {
            if (cellAt(m, r, at)) continue;
            const source = cellAt(m, r, at === 0 ? 1 : at - 1);
            const node = source ? doc.nodes[source.id] : undefined;
            if (!node) continue;
            const made = blankCell(doc, node, table.id, r, at);
            out.push(...made.commands);
            m.cells.push(made.cell);
        }
        return out;
    });
}

export function deleteRows(tableId: string, list: number[]) {
    editTableModel(tableId, (_doc, _table, m) => {
        const gone = [...new Set(list)].sort((a, b) => b - a);
        if (gone.length >= m.rows.length) return "A table keeps at least one row.";
        const removed: string[] = [];
        for (const i of gone) {
            for (const cell of [...m.cells]) {
                if (cell.r === i && cell.rs === 1) {
                    removed.push(cell.id);
                    m.cells.splice(m.cells.indexOf(cell), 1);
                } else if (cell.r <= i && cell.r + cell.rs > i) cell.rs--;
                else if (cell.r > i) cell.r--;
            }
            m.rows.splice(i, 1);
        }
        return removed.length ? [{ type: "node.delete", ids: removed }] : [];
    });
}

export function deleteColumns(tableId: string, list: number[]) {
    editTableModel(tableId, (_doc, _table, m) => {
        const gone = [...new Set(list)].sort((a, b) => b - a);
        if (gone.length >= m.cols.length) return "A table keeps at least one column.";
        const removed: string[] = [];
        for (const i of gone) {
            for (const cell of [...m.cells]) {
                if (cell.c === i && cell.cs === 1) {
                    removed.push(cell.id);
                    m.cells.splice(m.cells.indexOf(cell), 1);
                } else if (cell.c <= i && cell.c + cell.cs > i) cell.cs--;
                else if (cell.c > i) cell.c--;
            }
            m.cols.splice(i, 1);
        }
        return removed.length ? [{ type: "node.delete", ids: removed }] : [];
    });
}

// Moves a row (or column) to another place; merged cells across rows (columns) keep them still.
export function moveRow(tableId: string, from: number, to: number) {
    editTableModel(tableId, (_doc, _table, m) => {
        if (from === to || to < 0 || to >= m.rows.length) return null;
        if (m.cells.some((c) => c.rs > 1)) return "Split merged cells before moving rows.";
        const order = m.rows.map((_, i) => i);
        order.splice(to, 0, ...order.splice(from, 1));
        m.rows = order.map((i) => m.rows[i] as number);
        for (const cell of m.cells) cell.r = order.indexOf(cell.r);
        return [];
    });
}

export function moveColumn(tableId: string, from: number, to: number) {
    editTableModel(tableId, (_doc, _table, m) => {
        if (from === to || to < 0 || to >= m.cols.length) return null;
        if (m.cells.some((c) => c.cs > 1)) return "Split merged cells before moving columns.";
        const order = m.cols.map((_, i) => i);
        order.splice(to, 0, ...order.splice(from, 1));
        m.cols = order.map((i) => m.cols[i] as number);
        for (const cell of m.cells) cell.c = order.indexOf(cell.c);
        return [];
    });
}

export function resizeTrack(tableId: string, axis: "row" | "column", index: number, size: number) {
    editTableModel(tableId, (_doc, _table, m) => {
        const list = axis === "row" ? m.rows : m.cols;
        if (index < 0 || index >= list.length) return null;
        list[index] = Math.max(24, Math.round(size));
        return [];
    });
}

// Merges the selected cells into one covering the rectangle around them (its text keeps theirs).
export function mergeCells(tableId: string, ids: string[]) {
    editTableModel(tableId, (doc, _table, m) => {
        const chosen = m.cells.filter((c) => ids.includes(c.id));
        if (chosen.length < 2) return null;
        const r0 = Math.min(...chosen.map((c) => c.r));
        const c0 = Math.min(...chosen.map((c) => c.c));
        const r1 = Math.max(...chosen.map((c) => c.r + c.rs));
        const c1 = Math.max(...chosen.map((c) => c.c + c.cs));
        const inside = m.cells.filter((c) => c.r < r1 && c.r + c.rs > r0 && c.c < c1 && c.c + c.cs > c0);
        if (inside.some((c) => c.r < r0 || c.c < c0 || c.r + c.rs > r1 || c.c + c.cs > c1)) return "Those cells don't make a rectangle.";
        const anchor = inside.find((c) => c.r === r0 && c.c === c0);
        if (!anchor) return null;
        const rest = inside.filter((c) => c !== anchor);
        const texts = inside
            .flatMap((c) => doc.nodes[c.id]?.children.map((t) => doc.nodes[t]).filter((t): t is SceneNode => t?.type === "text") ?? [])
            .map((t) => t.text?.trim() ?? "")
            .filter(Boolean);
        const anchorText = doc.nodes[anchor.id]?.children.map((t) => doc.nodes[t]).find((t) => t?.type === "text");
        anchor.rs = r1 - r0;
        anchor.cs = c1 - c0;
        m.cells = m.cells.filter((c) => !rest.includes(c));
        const out: Command[] = [{ type: "node.delete", ids: rest.map((c) => c.id) }];
        if (anchorText) out.push({ type: "node.update", id: anchorText.id, patch: { text: texts.join(" "), spans: undefined } });
        return out;
    });
    // Selecting the merged cell joins the merge's undo step (the store folds it in).
    editor.set({ selection: [ids.find((id) => editor.get().doc.nodes[id]) ?? tableId] });
}

// Splits a merged cell back into single cells (the new ones blank, in its look).
export function splitCell(tableId: string, id: string) {
    editTableModel(tableId, (doc, table, m) => {
        const cell = m.cells.find((c) => c.id === id);
        const node = doc.nodes[id];
        if (!cell || !node || (cell.rs === 1 && cell.cs === 1)) return null;
        const out: Command[] = [];
        for (let r = cell.r; r < cell.r + cell.rs; r++) {
            for (let c = cell.c; c < cell.c + cell.cs; c++) {
                if (r === cell.r && c === cell.c) continue;
                const made = blankCell(doc, node, table.id, r, c);
                out.push(...made.commands);
                m.cells.push(made.cell);
            }
        }
        cell.rs = 1;
        cell.cs = 1;
        return out;
    });
}

// Cells of rows or columns, for selecting them from the edge bars.
export function cellsIn(model: TableModel, axis: "row" | "column", index: number): string[] {
    return model.cells.filter((c) => (axis === "row" ? c.r <= index && c.r + c.rs > index : c.c <= index && c.c + c.cs > index)).map((c) => c.id);
}

// ---- Styling ----

export function setCellFill(ids: string[], color: string | null) {
    const s = editor.get();
    editor.execute({ type: "batch", commands: ids.filter((id) => s.doc.nodes[id]).map((id) => ({ type: "node.update" as const, id, patch: { fills: color ? [solid(color)] : [] } })) });
}

export function setCellTextColor(ids: string[], color: string) {
    const s = editor.get();
    const commands: Command[] = [];
    for (const id of ids) for (const t of s.doc.nodes[id]?.children ?? []) if (s.doc.nodes[t]?.type === "text") commands.push({ type: "node.update", id: t, patch: { fills: [solid(color)], spans: s.doc.nodes[t]?.spans?.map(({ fills: _f, ...rest }) => rest) } });
    editor.execute({ type: "batch", commands });
}

export function setCellTextStyle(ids: string[], patch: Partial<Pick<SceneNode, "fontWeight" | "textAlign" | "fontSize">>) {
    const s = editor.get();
    const commands: Command[] = [];
    for (const id of ids) for (const t of s.doc.nodes[id]?.children ?? []) if (s.doc.nodes[t]?.type === "text") commands.push({ type: "node.update", id: t, patch });
    editor.execute({ type: "batch", commands });
}

export type TableLook = "header" | "banded" | "lined" | "plain";

// A look for the whole table from the slide's template: a header row, banded rows, lines only or
// plain; borders in a colour and width.
export function styleTable(tableId: string, look: TableLook) {
    const s = editor.get();
    const table = s.doc.nodes[tableId];
    if (!table || table.deck?.kind !== "table") return;
    const theme = themeOf(s.doc, slideAround(s.doc, tableId)?.id);
    const model = tableModel(s.doc, table);
    const commands: Command[] = [{ type: "node.update", id: tableId, patch: { deck: { ...table.deck, look } } }];
    for (const cell of model.cells) {
        const header = (look === "header" || look === "banded") && cell.r === 0;
        const fill = header ? theme.accent : look === "banded" && cell.r % 2 === 0 ? theme.surface : look === "plain" || look === "lined" ? null : theme.background;
        commands.push({ type: "node.update", id: cell.id, patch: { fills: fill ? [solid(fill)] : [], strokes: look === "plain" ? [] : [solid(theme.surface)] } });
        for (const t of s.doc.nodes[cell.id]?.children ?? []) if (s.doc.nodes[t]?.type === "text") commands.push({ type: "node.update", id: t, patch: { fills: [solid(header ? theme.background : theme.text)], fontWeight: header ? 700 : 400 } });
    }
    editor.execute({ type: "batch", commands });
}

export function setTableBorder(tableId: string, color: string | null, width?: number) {
    const s = editor.get();
    const table = s.doc.nodes[tableId];
    if (!table) return;
    editor.execute({ type: "batch", commands: table.children.map((id) => ({ type: "node.update" as const, id, patch: { strokes: color ? [solid(color)] : [], ...(width !== undefined ? { strokeWidth: width } : {}) } })) });
}

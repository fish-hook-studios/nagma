import { useRef } from "react";
import { Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { ungroupSelection } from "../engine/actions";
import { restoreDefaultThumbnail, setAsThumbnail, thumbnailFrame } from "../engine/files";
import { collab } from "../engine/collab";
import { ACTION_BY_ID, actionEnabled, actionLabel } from "../engine/menu-actions";
import { screenToWorld } from "../engine/camera";
import { editor, useEditor } from "../engine/store";
import { apply, spaceMatrix } from "../engine/transform";
import type { SceneNode } from "../engine/types";
import { tableGrid } from "./paint";
import { MenuRow } from "../components/left-sidebar";
import { clearCells, deleteTracks, duplicateTracks, expand, fitTracks, hasMerge, insertTracks, mergeCells, moveTracks, pickedRange, unmergeCells } from "./table";
import { board } from "./state";
import { toggleSectionHidden } from "./sections";

// The board's right-click menu: what a whiteboard object can do (clipboard, order, group,
// sections, lock, table rows and columns, export), without the design file's motion, masks,
// booleans, auto layout and components.

type Row = string | { id: string; label: string; shortcut?: string; run: () => void; disabled?: boolean } | "-";

const MENU_CLASS = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

const SHORT: Record<string, string> = { lock: "Lock/Unlock", ungroup: "Ungroup", section: "Create section", pasteHere: "Paste here" };

function cellAtClient(table: SceneNode, client: { x: number; y: number }): [number, number] | undefined {
    const jam = table.jam?.kind === "table" ? table.jam : null;
    const canvas = document.querySelector("[data-board] canvas")?.getBoundingClientRect();
    if (!jam || !canvas) return undefined;
    const s = editor.get();
    const world = screenToWorld(s.camera, client.x - canvas.left, client.y - canvas.top);
    const local = apply(spaceMatrix(s.doc, table.parentId).inverse(), world.x, world.y);
    const { xs, ys } = tableGrid(table, jam);
    const col = xs.findIndex((x, i) => i > 0 && local.x <= x) - 1;
    const row = ys.findIndex((y, i) => i > 0 && local.y <= y) - 1;
    return col >= 0 && row >= 0 && local.x >= table.x && local.y >= table.y ? [row, col] : undefined;
}

// Table rows: insert, delete, move, duplicate and fit the picked rows or columns (or the ones the
// clicked cell is in), merge or unmerge the picked cells, and clear them.
function tableRows(table: SceneNode, cell: [number, number] | undefined): Row[] {
    const jam = table.jam?.kind === "table" ? table.jam : null;
    if (!jam) return [];
    const picked = pickedRange(table.id) ?? (cell ? expand(jam, { top: cell[0], left: cell[1], bottom: cell[0], right: cell[1] }) : null);
    if (!picked) return [];
    const rows = Array.from({ length: picked.bottom - picked.top + 1 }, (_, i) => picked.top + i);
    const cols = Array.from({ length: picked.right - picked.left + 1 }, (_, i) => picked.left + i);
    const many = (n: number, one: string, more: string) => (n > 1 ? more : one);
    const out: Row[] = [
        { id: "rowAbove", label: "Add row above", run: () => insertTracks(table.id, "row", picked.top) },
        { id: "rowBelow", label: "Add row below", run: () => insertTracks(table.id, "row", picked.bottom + 1) },
        { id: "colLeft", label: "Add column left", run: () => insertTracks(table.id, "col", picked.left) },
        { id: "colRight", label: "Add column right", run: () => insertTracks(table.id, "col", picked.right + 1) },
        "-",
        { id: "rowDelete", label: many(rows.length, "Delete row", `Delete ${rows.length} rows`), run: () => deleteTracks(table.id, "row", rows), disabled: rows.length >= jam.rows.length },
        { id: "colDelete", label: many(cols.length, "Delete column", `Delete ${cols.length} columns`), run: () => deleteTracks(table.id, "col", cols), disabled: cols.length >= jam.cols.length },
        { id: "cellClear", label: "Delete content", run: () => clearCells(table.id, picked) },
        "-",
        { id: "rowUp", label: "Move row up", run: () => moveTracks(table.id, "row", rows, picked.top - 1), disabled: picked.top === 0 },
        { id: "rowDown", label: "Move row down", run: () => moveTracks(table.id, "row", rows, picked.top + 1), disabled: picked.bottom >= jam.rows.length - 1 },
        { id: "colLeftMove", label: "Move column left", run: () => moveTracks(table.id, "col", cols, picked.left - 1), disabled: picked.left === 0 },
        { id: "colRightMove", label: "Move column right", run: () => moveTracks(table.id, "col", cols, picked.left + 1), disabled: picked.right >= jam.cols.length - 1 },
        { id: "rowDup", label: many(rows.length, "Duplicate row", "Duplicate rows"), run: () => duplicateTracks(table.id, "row", rows) },
        { id: "colDup", label: many(cols.length, "Duplicate column", "Duplicate columns"), run: () => duplicateTracks(table.id, "col", cols) },
        "-",
        { id: "fitRow", label: "Resize row to fit", run: () => fitTracks(table.id, "row", rows) },
        { id: "fitCol", label: "Resize column to fit", run: () => fitTracks(table.id, "col", cols) },
    ];
    if ((picked.top !== picked.bottom || picked.left !== picked.right) && !hasMerge(jam, picked)) out.push({ id: "merge", label: "Merge cells", run: () => mergeCells(table.id, picked) });
    if (hasMerge(jam, picked)) out.push({ id: "unmerge", label: "Unmerge cells", run: () => unmergeCells(table.id, picked) });
    out.push("-");
    return out;
}

export function BoardContextMenu() {
    const position = useEditor((s) => s.contextMenu);
    return position ? <Body position={position} /> : null;
}

function Body({ position }: { position: { x: number; y: number } }) {
    const state = useEditor((s) => s);
    const anchor = useRef<HTMLDivElement>(null);
    const { doc, selection } = state;
    const nodes = selection.map((id) => doc.nodes[id]).filter((n) => n !== undefined);
    const single = nodes.length === 1 ? nodes[0] : undefined;
    const editing = board.get().editing;
    const table = single?.jam?.kind === "table" ? single : undefined;
    // The cell being typed in, or else the one that was right-clicked.
    const cell = (single && editing?.id === single.id ? editing.cell : undefined) ?? (table ? cellAtClient(table, position) : undefined);
    const section = single?.isSection ? single : undefined;
    const locked = nodes.some((n) => n.locked);

    const rows: Row[] = nodes.length
        ? [
              "copy",
              "cut",
              "pasteHere",
              "duplicate",
              "delete",
              "-",
              "front",
              "forward",
              "backward",
              "back",
              "-",
              ...(nodes.length > 1 ? ["group"] : []),
              ...(nodes.some((n) => n.type === "group") ? ["ungroup"] : []),
              "section",
              ...(section
                  ? [
                        { id: "sectionHide", label: section.jam?.kind === "section" && section.jam.hidden ? "Show contents" : "Hide contents", run: () => toggleSectionHidden(section.id) },
                        { id: "sectionKeep", label: "Delete section, keep contents", shortcut: "⌘ ⌫", run: ungroupSelection },
                        thumbnailFrame() === section.id ? { id: "thumb", label: "Restore default thumbnail", run: () => restoreDefaultThumbnail() } : { id: "thumb", label: "Set as thumbnail", run: () => setAsThumbnail(section.id) },
                    ]
                  : []),
              "-",
              ...(table && table.jam?.kind === "table" ? tableRows(table, cell) : []),
              "lock",
              "-",
              "copyLink",
              "zoomSelection",
              { id: "exportSel", label: "Export selection…", shortcut: "⇧ ⌘ E", run: () => board.set({ exportOpen: true }) },
          ]
        : [
              "pasteHere",
              "selectAll",
              "-",
              "fit",
              { id: "dotGrid", label: board.get().dotGrid ? "Hide dot grid" : "Show dot grid", run: () => board.set({ dotGrid: !board.get().dotGrid }) },
              "toggleComments",
              "-",
              { id: "exportBoard", label: "Export board…", shortcut: "⇧ ⌘ E", run: () => board.set({ exportOpen: true }) },
          ];

    const resolved = rows.map((row) => {
        if (row === "-") return row;
        if (typeof row !== "string") return { ...row, disabled: Boolean(row.disabled) || (locked && row.id !== "thumb") };
        const action = ACTION_BY_ID.get(row);
        if (!action) return "-" as const;
        const label = row === "toggleComments" ? (collab.get().commentsHidden ? "Show comments" : "Hide comments") : row === "lock" ? (locked ? "Unlock" : "Lock") : (SHORT[row] ?? actionLabel(action, state));
        // Locked objects can only be copied, duplicated, unlocked and exported.
        const blocked = locked && !["copy", "duplicate", "lock", "copyLink", "zoomSelection"].includes(row);
        return { id: row, label, shortcut: action.shortcut, run: action.run, disabled: blocked || !actionEnabled(action, state) };
    });
    const trimmed = resolved.filter((r, i, all) => r !== "-" || (i > 0 && all[i - 1] !== "-" && i < all.length - 1));
    const actions = new Map(trimmed.filter((r) => r !== "-").map((r) => [r.id, r]));
    const disabled = [...actions.values()].filter((r) => r.disabled).map((r) => r.id);

    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: position.x, top: position.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && editor.set({ contextMenu: null })} placement="bottom start" offset={2} className={`${MENU_CLASS} max-h-[calc(100vh-16px)] overflow-y-auto`}>
                <AriaMenu
                    autoFocus="first"
                    aria-label="Board actions"
                    className="outline-none"
                    disabledKeys={disabled}
                    onAction={(key) => {
                        editor.set({ contextMenu: null });
                        actions.get(String(key))?.run();
                    }}
                >
                    {trimmed.map((row, i) => (row === "-" ? <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" /> : <MenuRow key={row.id} id={row.id} label={row.label} shortcut={row.shortcut} />))}
                </AriaMenu>
            </AriaPopover>
        </>
    );
}

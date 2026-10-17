import { useSyncExternalStore } from "react";
import { editor } from "../engine/store";
import { STICKY_COLORS } from "./model";
import type { ConnectorCap, ConnectorLine, ShapeKind, StampPick, WashiPattern } from "./types";

// The board editor's own state (per viewer, not part of the document): the board tool in hand and
// each tray's choices, which sticky or shape is being typed in, and view options.

export type BoardTool = "sticky" | "shape" | "connector" | "marker" | "highlighter" | "washi" | "eraser" | "stamp" | "table" | "code" | "sticker";
// "more" is the "+" panel (widgets, stickers, templates and more); "actions" the Actions panel.
export type Tray = "draw" | "sticky" | "shape" | "stamp" | "more" | "actions" | null;

export interface BoardState {
    // Null while one of the editor's own tools (move, hand, text, section, comment) is in use.
    tool: BoardTool | null;
    tray: Tray;
    stickyColor: string;
    // New stickies: square or wide.
    stickyWide: boolean;
    shape: ShapeKind;
    shapeColor: string;
    connectorLine: ConnectorLine;
    // The connector style last used in this file, for the next connector.
    connectorStyle: { color: string; width: number; dashed: boolean; startCap: ConnectorCap; endCap: ConnectorCap };
    drawColor: string;
    highlightColor: string;
    // Thin or thick, per drawing tool.
    markerSize: number;
    highlighterSize: number;
    washi: WashiPattern;
    // An uploaded washi pattern for this session: its image id and data.
    washiImage: { id: string; data: string } | null;
    stamp: StampPick;
    // Stamps used lately (shown in the middle of the stamp wheel), newest first.
    stampRecent: StampPick[];
    // The stamp wheel, open at a point on the board's screen.
    wheel: { x: number; y: number } | null;
    sticker: string;
    // What was used lately from the More panel, newest first.
    recent: string[];
    // A layer (sticky, shape, connector label, table cell) being typed in.
    // `typed`: the edit began with a key already written to the layer (one undo step with it).
    editing: { id: string; cell?: [number, number]; typed?: boolean } | null;
    // Cells picked in a table: from (r0, c0) to (r1, c1), or whole rows or columns (by their grabbers).
    tableSel: { id: string; r0: number; c0: number; r1: number; c1: number; whole?: "row" | "col" } | null;
    dotGrid: boolean;
    shapesPanel: boolean;
    pagesPanel: boolean;
    templatesOpen: boolean;
    // A section the chosen template fills.
    templatesInto: string | null;
    helpOpen: boolean;
    exportOpen: boolean;
    // The voting session you joined, and one whose invitation you ignored.
    voteJoined: string | null;
    voteIgnored: string | null;
    // In a shared file: your ballot in the open session as the server keeps it (votes aren't in the
    // shared document until the session ends), and how many people have voted.
    ballot: { session: string; votes: string[]; voted: number } | null;
    // Asking the host to confirm ending the session for everyone.
    voteEndConfirm: boolean;
    // A section whose title is being typed in place.
    renamingSection: string | null;
    // An embedded link shown large over the board.
    embedMax: string | null;
    // The timer, voting and music panel, open on one of its tabs.
    meetings: "timer" | "voting" | null;
}

let state: BoardState = {
    tool: null,
    tray: null,
    // A board starts with a random sticky colour.
    stickyColor: STICKY_COLORS[2 + Math.floor(Math.random() * (STICKY_COLORS.length - 2))]?.color ?? "#FFE299",
    stickyWide: false,
    shape: "square",
    shapeColor: "#D9D9D9",
    connectorLine: "elbow",
    connectorStyle: { color: "#757575", width: 2, dashed: false, startCap: "none", endCap: "arrow" },
    // The marker starts thin and gray, the highlighter thick and yellow.
    drawColor: "#757575",
    highlightColor: "#FFFAA3",
    markerSize: 4,
    highlighterSize: 28,
    washi: "dots",
    washiImage: null,
    stamp: { kind: "thumbs-up" },
    stampRecent: [],
    wheel: null,
    sticker: "🚀",
    recent: [],
    editing: null,
    tableSel: null,
    dotGrid: true,
    shapesPanel: false,
    pagesPanel: false,
    templatesOpen: false,
    templatesInto: null,
    helpOpen: false,
    exportOpen: false,
    embedMax: null,
    renamingSection: null,
    voteJoined: null,
    voteIgnored: null,
    ballot: null,
    voteEndConfirm: false,
    meetings: null,
};

const listeners = new Set<() => void>();

export const board = {
    get: () => state,
    set(patch: Partial<BoardState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
        // The canvas redraws on editor changes; board-only changes (the tool's hover, the grid) need one too.
        editor.set({});
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useBoard<T>(selector: (s: BoardState) => T): T {
    return useSyncExternalStore(board.subscribe, () => selector(state));
}

// Picks a board tool (or, with null, hands back to the editor's tool).
export function setBoardTool(tool: BoardTool | null, tray: Tray = null) {
    board.set({ tool, tray });
    if (tool) editor.set({ tool: "move" });
}

// Picked table cells go when their table is no longer the selection.
editor.subscribe(() => {
    const sel = state.tableSel;
    if (!sel) return;
    const s = editor.get();
    if (s.selection.length !== 1 || s.selection[0] !== sel.id || !s.doc.nodes[sel.id]) board.set({ tableSel: null });
});

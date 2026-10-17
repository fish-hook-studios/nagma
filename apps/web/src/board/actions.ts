import { nanoid } from "nanoid";
import { askText } from "../components/ask-text";
import { auth } from "../engine/auth";
import { collab } from "../engine/collab";
import { sectionAt } from "../engine/nodes";
import { activePage } from "../engine/page";
import { editor } from "../engine/store";
import { apply, spaceMatrix, worldBounds } from "../engine/transform";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { SHAPE_SIZE, STICKY_SIZE, STICKY_WIDE, TABLE_COL, TABLE_ROW, makeTable, makeConnector, makeShapeNode, makeSticky, shapePath } from "./model";
import { board } from "./state";
import { codeHeight } from "./code";
import { inMindMap, tidyMindMap } from "./mindmap";
import type { ConnectorEnd, JamData, Side } from "./types";

// Board edits shared by the canvas, the toolbar and the context bar.

export function myName(): string {
    return collab.get().me.name || auth.get().user?.name || "Anonymous";
}

// Where a new object goes for a world point: the section under it, or the page; and the point in
// that parent's space.
export function placeAt(doc: NagmaDocument, x: number, y: number) {
    const parentId = sectionAt(doc, x, y) || activePage.id;
    const p = apply(spaceMatrix(doc, parentId).inverse(), x, y);
    return { parentId, x: p.x, y: p.y };
}

export function startEditing(id: string, cell?: [number, number], typed = false) {
    editor.set({ selection: [id] });
    board.set({ editing: { id, ...(cell ? { cell } : {}), ...(typed ? { typed } : {}) } });
}

export function placeSticky(world: { x: number; y: number }, edit = true): string {
    const s = editor.get();
    const at = placeAt(s.doc, world.x, world.y);
    const wide = board.get().stickyWide;
    const node = makeSticky(s.doc, at.x - (wide ? STICKY_WIDE : STICKY_SIZE) / 2, at.y - STICKY_SIZE / 2, board.get().stickyColor, at.parentId, myName(), wide);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
    if (edit) startEditing(node.id);
    return node.id;
}

export function placeShape(box: { x: number; y: number; w: number; h: number }): string {
    const s = editor.get();
    const at = placeAt(s.doc, box.x + box.w / 2, box.y + box.h / 2);
    const node = makeShapeNode(s.doc, board.get().shape, { x: at.x - box.w / 2, y: at.y - box.h / 2, w: box.w, h: box.h }, board.get().shapeColor, at.parentId);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
    return node.id;
}

const OFFSET: Record<Side, { x: number; y: number }> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

// The objects a quick-created note or shape must not land on.
function blockers(doc: NagmaDocument, skip: string) {
    return Object.values(doc.nodes)
        .filter((n) => n.id !== skip && n.visible !== false && (n.jam?.kind === "sticky" || n.jam?.kind === "shape" || n.jam?.kind === "table" || n.jam?.kind === "code"))
        .map((n) => worldBounds(doc, n));
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

// Quick create: a blank copy of a sticky or shape beside it, ready to type in. Repeated on the same
// side, the next one goes below (or beside) the last instead of on top of it. Shapes always get a
// connector; stickies get one when dragged out (`at`, a world point to drop the copy on).
export function addAdjacent(id: string, side: Side = "right", options: { at?: { x: number; y: number }; connect?: boolean; from?: { id: string; side: Side }; stack?: boolean } = {}): string | null {
    const s = editor.get();
    const node = s.doc.nodes[id];
    if (!node || node.locked || (node.jam?.kind !== "sticky" && node.jam?.kind !== "shape" && node.jam?.kind !== "code")) return null;
    const isShape = node.jam.kind === "shape";
    const gap = isShape ? 80 : 24;
    const box = worldBounds(s.doc, node);
    const d = OFFSET[side];
    let cx = box.x + box.w / 2 + d.x * (box.w + gap);
    let cy = box.y + box.h / 2 + d.y * (box.h + gap);
    if (options.at) {
        cx = options.at.x;
        cy = options.at.y;
    } else {
        // Step across the side (down, up, further down...) until there's room.
        const taken = blockers(s.doc, id);
        // (Stacking instead keeps going the same way: the next sibling below the last.)
        const step = options.stack ? { x: d.x * (box.w + gap), y: d.y * (box.h + gap) } : d.x !== 0 ? { x: 0, y: box.h + 24 } : { x: box.w + 24, y: 0 };
        for (let k = 0; k < 24; k++) {
            const n = options.stack ? k : k === 0 ? 0 : k % 2 ? (k + 1) / 2 : -k / 2;
            const spot = { x: cx + step.x * n - box.w / 2, y: cy + step.y * n - box.h / 2, w: box.w, h: box.h };
            if (!taken.some((t) => overlaps(t, spot))) {
                cx = spot.x + box.w / 2;
                cy = spot.y + box.h / 2;
                break;
            }
        }
    }
    const at = placeAt(s.doc, cx, cy);
    const { id: _id, ...rest } = node;
    const made: SceneNode = {
        ...rest,
        id: nanoid(10),
        parentId: at.parentId,
        children: [],
        x: at.x - node.w / 2,
        y: at.y - node.h / 2,
        text: "",
        spans: undefined,
        locked: false,
        jam: node.jam.kind === "sticky" ? { ...node.jam, author: myName(), baseH: undefined } : node.jam,
        ...(node.jam.kind === "sticky" && node.jam.baseH ? { h: node.jam.baseH } : {}),
        ...(node.jam.kind === "code" ? { h: codeHeight("") } : {}),
        ...(isShape && node.jam.kind === "shape" ? { path: shapePath(node.jam.shape, node.w, node.h) } : {}),
    };
    const commands: Command[] = [{ type: "node.create", node: made }];
    // A mind map topic (a sticky topic too) always grows a branch.
    if (isShape || options.connect || options.from || inMindMap(s.doc, node.id)) {
        const page = activePage.id;
        const source = options.from ?? { id: node.id, side };
        const into = options.at ? facing(made, at, box) : options.from ? OPPOSITE[options.from.side] : OPPOSITE[side];
        const a = { id: source.id, side: source.side, x: 0, y: 0 };
        const b = { id: made.id, side: into, x: 0, y: 0 };
        // Branches keep the look of the line leading into the object they grow from (a mind map's
        // curved, arrowless lines); otherwise the last connector style.
        // The central topic has no line into it: its branches out are the look to follow.
        const lines = Object.values(s.doc.nodes);
        const from = options.from ? id : node.id;
        const like = lines.find((n) => n.jam?.kind === "connector" && n.jam.end.id === from) ?? lines.find((n) => n.jam?.kind === "connector" && n.jam.mind && n.jam.start.id === from);
        const line = newConnector(s.doc, a, b, page);
        commands.push({ type: "node.create", node: like?.jam?.kind === "connector" && line.jam?.kind === "connector" ? { ...line, strokes: like.strokes, strokeWidth: like.strokeWidth, jam: { ...line.jam, line: like.jam.line, startCap: like.jam.startCap, endCap: like.jam.endCap, dashed: like.jam.dashed, radius: like.jam.radius, mind: like.jam.mind } } : line });
    }
    editor.execute({ type: "batch", commands });
    // A new branch of a mind map: the map tidies around it.
    if (inMindMap(editor.get().doc, made.id)) tidyMindMap(made.id);
    startEditing(made.id);
    return made.id;
}

// A sibling: another child of whatever this object's incoming connector comes from (a mind map
// branch), placed in the next free spot on that side; with no parent, a copy below.
export function addSibling(id: string): string | null {
    const doc = editor.get().doc;
    const incoming = Object.values(doc.nodes).find((n) => n.jam?.kind === "connector" && n.jam.end.id === id && n.jam.start.id && doc.nodes[n.jam.start.id]);
    if (incoming?.jam?.kind === "connector" && incoming.jam.start.id) {
        const parent = doc.nodes[incoming.jam.start.id];
        const pb = parent ? worldBounds(doc, parent) : null;
        const me = doc.nodes[id];
        const mb = me ? worldBounds(doc, me) : null;
        if (parent && pb && mb) {
            const side: Side = mb.x >= pb.x + pb.w ? "right" : mb.x + mb.w <= pb.x ? "left" : mb.y >= pb.y + pb.h ? "bottom" : "top";
            // A copy of this branch in the next free spot beside it, joined to the same parent.
            return addAdjacent(id, side === "left" || side === "right" ? "bottom" : "right", { from: { id: parent.id, side }, stack: true });
        }
    }
    return addAdjacent(id, "bottom");
}

// The side of a dropped copy that faces the original.
function facing(made: SceneNode, at: { x: number; y: number }, from: { x: number; y: number; w: number; h: number }): Side {
    const dx = from.x + from.w / 2 - at.x;
    const dy = from.y + from.h / 2 - at.y;
    if (Math.abs(dx) / Math.max(made.w, 1) > Math.abs(dy) / Math.max(made.h, 1)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "bottom" : "top";
}

// Changes the board data of the selected objects of a kind.
export function patchJam(ids: string[], change: (jam: JamData, node: SceneNode) => Partial<SceneNode> | null) {
    const s = editor.get();
    const commands: Command[] = [];
    for (const id of ids) {
        const node = s.doc.nodes[id];
        if (!node?.jam) continue;
        const patch = change(node.jam, node);
        if (patch) commands.push({ type: "node.update", id, patch });
    }
    if (commands.length) editor.execute(commands.length === 1 ? (commands[0] as Command) : { type: "batch", commands });
}

export function patchNodes(ids: string[], patch: (node: SceneNode) => Partial<SceneNode> | null) {
    const s = editor.get();
    const commands: Command[] = [];
    for (const id of ids) {
        const node = s.doc.nodes[id];
        const p = node ? patch(node) : null;
        if (p) commands.push({ type: "node.update", id, patch: p });
    }
    if (commands.length) editor.execute(commands.length === 1 ? (commands[0] as Command) : { type: "batch", commands });
}

// A table made from rows of text (pasted from a spreadsheet), at a world point.
export function placeTable(world: { x: number; y: number }, rows: string[][]): string {
    const s = editor.get();
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const at = placeAt(s.doc, world.x, world.y);
    const node = makeTable(s.doc, at.x - (TABLE_COL * cols) / 2, at.y - (TABLE_ROW * rows.length) / 2, at.parentId, cols, Math.max(1, rows.length), rows);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
    return node.id;
}

// Tab- or comma-separated text with at least two rows or columns, as rows of cells.
export function parseTable(text: string): string[][] | null {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    if (text.includes("\t")) {
        const rows = lines.map((l) => l.split("\t"));
        return rows.length > 1 || (rows[0]?.length ?? 0) > 1 ? rows : null;
    }
    return null;
}

export const SHAPE_DEFAULT = SHAPE_SIZE;

// Text formatting for whole objects (stickies, shapes, connector labels, text): the bar's buttons
// and their keys (⌘B, ⌘⇧X, ⌘⇧8, ⌘⇧7).
export type TextFormat = "bold" | "strike" | "bullet" | "number";

export function formatText(ids: string[], format: TextFormat) {
    const nodes = ids.map((id) => editor.get().doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && (n.jam?.kind === "sticky" || n.jam?.kind === "shape" || n.jam?.kind === "connector" || n.type === "text")));
    const first = nodes[0];
    if (!first) return false;
    const on = format === "bold" ? (first.fontWeight ?? 400) >= 600 : format === "strike" ? first.decoration === "strikethrough" : first.list === format;
    patchNodes(
        nodes.map((n) => n.id),
        () => (format === "bold" ? { fontWeight: on ? 400 : 700 } : format === "strike" ? { decoration: on ? "none" : "strikethrough" } : { list: on ? null : format }),
    );
    return true;
}

// ⌘⇧U: whether a key asks for a link.
export function linkForKey(event: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
    return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && (event.key.toLowerCase() === "u" || event.code === "KeyU");
}

// Asks for a link and puts it on stickies, shapes, connectors and text (empty removes it), as the
// bar's Link button does; ⌘⇧U was advertised but did nothing.
export async function askLink(ids: string[]) {
    const first = editor.get().doc.nodes[ids[0] ?? ""];
    if (!first) return;
    const url = await askText("Link", first.hyperlink ?? "https://");
    if (url === null) return;
    patchNodes(ids, () => ({ hyperlink: url.trim() && url.trim() !== "https://" ? url.trim() : null }));
}

// The format a key asks for, if any.
export function formatForKey(event: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): TextFormat | null {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === "b") return "bold";
    if (event.shiftKey && key === "x") return "strike";
    if (event.shiftKey && (key === "8" || key === "*" || event.code === "Digit8")) return "bullet";
    if (event.shiftKey && (key === "7" || key === "&" || event.code === "Digit7")) return "number";
    return null;
}

// A connector in the style last used (colour, weight, dashes and ends).
export function newConnector(doc: NagmaDocument, start: ConnectorEnd, end: ConnectorEnd, parentId: string | null): SceneNode {
    const style = board.get().connectorStyle;
    const node = makeConnector(doc, start, end, board.get().connectorLine, style.color, parentId, { start: style.startCap, end: style.endCap });
    return { ...node, strokeWidth: style.width, jam: node.jam?.kind === "connector" ? { ...node.jam, dashed: style.dashed || undefined } : node.jam };
}

// Remembers a connector's look for the next one.
export function rememberConnector(node: SceneNode | undefined) {
    if (node?.jam?.kind !== "connector") return;
    const stroke = node.strokes.find((p) => p.type === "solid");
    board.set({ connectorStyle: { color: stroke && stroke.type === "solid" ? stroke.color : "#757575", width: node.strokeWidth, dashed: Boolean(node.jam.dashed), startCap: node.jam.startCap, endCap: node.jam.endCap } });
}

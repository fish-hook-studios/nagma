import { nanoid } from "nanoid";
import { HANDLE_BLUE, type PluginPointer, drawDot, registerCanvasPlugin } from "../canvas/canvas-plugins";
import { hitFrameLabel, hitTest, nodeContains } from "../canvas/hit-test";
import { worldToScreen } from "../engine/camera";
import { applyCommand } from "../engine/commands";
import { solid } from "../engine/paint";
import { makeFreehand } from "../engine/shapes";
import { editor } from "../engine/store";
import { apply, spaceMatrix, worldBounds } from "../engine/transform";
import type { Camera, NagmaDocument, Rect, SceneNode } from "../engine/types";
import { addAdjacent, myName, newConnector, placeAt, placeShape, placeSticky, startEditing } from "./actions";
import { type Pt, dragSegment, elbowSegments, facingSide, liveRoute, nearestAlong, pointAlong } from "./connectors";
import { layoutText } from "../engine/text-layout";
import { textSize } from "../engine/text";
import { SHAPE_SIZE, STICKY_SIZE, STICKY_WIDE, TABLE_COL, TABLE_ROW, WASHI_PATTERNS, makeStamp, makeSticker, makeTable, makeWashi, shapePath, stampLook } from "./model";
import { connectorLabel, shapeTextBox, tableGrid, textLayerFor } from "./paint";
import { board, setBoardTool } from "./state";
import { CODE_WIDTH, makeCodeBlock } from "./code";
import { drawBursts, heldStampSize, objectUnder, sendEmote } from "./stamps";
import { drawHands } from "./highfive";
import { widgetClick, widgetCursor } from "./widgets";
import { openWebUrl } from "./links";
import type { ConnectorEnd, JamData, Side } from "./types";
import { type Axis, anchorOf, clearCells, expand, insertTracks, moveTracks, pickCells, pickedLines, pickedRange, selRange, stepCell } from "./table";

// The board's canvas tools: placing stickies, shapes, stamps and tables, drawing connectors,
// marker and highlighter strokes and washi tape, erasing, the quick-create dots around a selected
// sticky or shape, dragging connector ends, and double-click to type.

type Gesture =
    | { kind: "shape"; start: Pt; end: Pt }
    | { kind: "connector"; start: ConnectorEnd; cursor: Pt; target: SceneNode | null; exact: boolean }
    | { kind: "reattach"; id: string; which: "start" | "end"; cursor: Pt; target: SceneNode | null; exact: boolean }
    | { kind: "stroke"; samples: Pt[]; base: NagmaDocument; parentId: string; nodeId: string; highlighter: boolean }
    | { kind: "washi"; start: Pt; end: Pt; base: NagmaDocument; parentId: string; nodeId: string }
    | { kind: "erase"; base: NagmaDocument; erased: Set<string>; trail: Pt[] }
    | { kind: "dot"; id: string; side: Side; start: Pt; cursor: Pt; moved: boolean; target: SceneNode | null }
    | { kind: "stamp"; start: Pt; t0: number }
    | { kind: "table"; start: Pt; end: Pt }
    | { kind: "label"; id: string; base: NagmaDocument }
    | { kind: "bend"; id: string; base: NagmaDocument; segment: number | null }
    | { kind: "tableLine"; id: string; axis: "col" | "row"; index: number; base: NagmaDocument }
    // Dragging rows or columns by their grabbers to a new place (`to` counts without them).
    | { kind: "tableGrab"; id: string; axis: Axis; indexes: number[]; start: Pt; moved: boolean; to: number | null }
    // Dragging across cells to pick a block.
    | { kind: "tableCells"; id: string; r0: number; c0: number }
    // A press on a selected table: a click picks the cell, a drag moves the table.
    | { kind: "tablePress"; id: string; start: Pt; base: NagmaDocument; cell: [number, number]; moved: boolean }
    // ⇧drag on a section's background: a selection box for what's inside it.
    | { kind: "marquee"; section: string; start: Pt; end: Pt };

let gesture: Gesture | null = null;
let hoverWorld: Pt | null = null;
let hoverStamp: string | null = null;

const isBoardDoc = () => Boolean(editor.get().doc.board) && !editor.get().readOnly && !editor.get().homeOpen;

// What a connector end can attach to: anything but connectors and marker strokes.
function attachTarget(doc: NagmaDocument, p: Pt, exclude?: string): SceneNode | null {
    const node = hitTest(doc, p.x, p.y);
    if (!node || node.id === exclude || node.type === "page" || node.locked) return null;
    if (node.jam?.kind === "connector" || node.jam?.kind === "draw" || node.jam?.kind === "washi") return null;
    return node;
}

function endFor(doc: NagmaDocument, target: SceneNode | null, p: Pt, exact: boolean): ConnectorEnd {
    if (!target) return { id: null, side: null, x: p.x, y: p.y };
    const box = worldBounds(doc, target);
    // ⌘ places the end exactly; let go over the centre dot, it aims at the centre; otherwise it
    // snaps to a side (the facing one, chosen as the line moves).
    if (exact) return { id: target.id, side: null, at: { u: (p.x - box.x) / Math.max(box.w, 1), v: (p.y - box.y) / Math.max(box.h, 1) }, x: p.x, y: p.y };
    if (nearCenter(box, p)) return { id: target.id, side: null, center: true, x: p.x, y: p.y };
    return { id: target.id, side: null, x: p.x, y: p.y };
}

// Within reach of a box's centre dot (12 screen pixels).
function nearCenter(box: Rect, p: Pt): boolean {
    const r = 12 / editor.get().camera.zoom;
    return Math.hypot(p.x - (box.x + box.w / 2), p.y - (box.y + box.h / 2)) <= r;
}

// The four quick-create dots around a single selected sticky or shape, in screen space.
function sideDots(camera: Camera): { id: string; side: Side; x: number; y: number }[] {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().editing || board.get().tool) return [];
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (!node || (node.jam?.kind !== "sticky" && node.jam?.kind !== "shape" && node.jam?.kind !== "code") || node.locked) return [];
    const box = worldBounds(s.doc, node);
    const a = worldToScreen(camera, box.x, box.y);
    const b = worldToScreen(camera, box.x + box.w, box.y + box.h);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const off = 18;
    return [
        { id: node.id, side: "top", x: cx, y: a.y - off },
        { id: node.id, side: "right", x: b.x + off, y: cy },
        { id: node.id, side: "bottom", x: cx, y: b.y + off },
        { id: node.id, side: "left", x: a.x - off, y: cy },
    ];
}

function connectorEnds(camera: Camera): { id: string; which: "start" | "end"; x: number; y: number }[] {
    const s = editor.get();
    if (s.selection.length !== 1) return [];
    const node = s.doc.nodes[s.selection[0] ?? ""];
    const route = node ? liveRoute(s.doc, node) : null;
    if (!node || !route) return [];
    const a = worldToScreen(camera, route.start.x, route.start.y);
    const b = worldToScreen(camera, route.end.x, route.end.y);
    return [
        { id: node.id, which: "start", ...a },
        { id: node.id, which: "end", ...b },
    ];
}

const near = (a: Pt, b: Pt, r = 8) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

function strokeNode(g: Extract<Gesture, { kind: "stroke" }>, zoom: number): SceneNode | null {
    const m = spaceMatrix(g.base, g.parentId).inverse();
    const node = makeFreehand(g.base, g.samples.map((p) => apply(m, p.x, p.y)), g.parentId, zoom, false, g.nodeId);
    if (!node) return null;
    const b = board.get();
    const width = g.highlighter ? b.highlighterSize : b.markerSize;
    return {
        ...node,
        name: g.highlighter ? "Highlight" : "Marker",
        strokes: [solid(g.highlighter ? b.highlightColor : b.drawColor, g.highlighter ? 0.85 : 1)],
        strokeWidth: width,
        strokeAlign: "center",
        strokeCap: g.highlighter ? "square" : "round",
        strokeJoin: "round",
        blendMode: g.highlighter ? "multiply" : "normal",
        // Doodles resize in proportion (so a straight one only gets longer or shorter).
        lockAspect: true,
        jam: { kind: "draw", tool: g.highlighter ? "highlighter" : "marker" },
    };
}

function washiNode(g: Extract<Gesture, { kind: "washi" }>): SceneNode {
    const m = spaceMatrix(g.base, g.parentId).inverse();
    const custom = board.get().washi === "custom" ? board.get().washiImage : null;
    if (custom) return { ...makeWashi(g.base, apply(m, g.start.x, g.start.y), apply(m, g.end.x, g.end.y), "custom", "#FFFFFF", g.parentId), id: g.nodeId, fills: [], jam: { kind: "washi", pattern: "custom", color: "#FFFFFF", image: custom.id } };
    const info = WASHI_PATTERNS.find((w) => w.pattern === board.get().washi) ?? WASHI_PATTERNS[0];
    return { ...makeWashi(g.base, apply(m, g.start.x, g.start.y), apply(m, g.end.x, g.end.y), info?.pattern ?? "dots", info?.color ?? "#FF8FB1", g.parentId), id: g.nodeId };
}

function eraseUnder(g: Extract<Gesture, { kind: "erase" }>, p: Pt, zoom: number) {
    const doc = g.base;
    const r = 6 / zoom;
    for (const node of Object.values(doc.nodes)) {
        if (node.jam?.kind !== "draw" || g.erased.has(node.id)) continue;
        const box = worldBounds(doc, node);
        const pad = node.strokeWidth / 2 + r;
        if (p.x < box.x - pad || p.x > box.x + box.w + pad || p.y < box.y - pad || p.y > box.y + box.h + pad) continue;
        if (nodeContains(doc, node, p.x, p.y)) g.erased.add(node.id);
    }
    const remaining = applyCommand(g.base, { type: "node.delete", ids: [...g.erased] });
    editor.preview(remaining);
}

function finishTool() {
    if (!editor.get().prefs.keepTool) setBoardTool(null);
}

registerCanvasPlugin({
    name: "board",
    down(p) {
        if (!isBoardDoc() || p.button !== 0) return false;
        const s = editor.get();
        const b = board.get();
        const w = p.world;
        if (b.editing) board.set({ editing: null });
        if (b.tray && b.tray !== "draw" && b.tray !== "shape" && b.tray !== "sticky" && b.tray !== "stamp") board.set({ tray: null });
        switch (b.tool) {
            case "sticky":
                placeSticky(w);
                finishTool();
                return true;
            case "shape":
                gesture = { kind: "shape", start: w, end: w };
                return true;
            case "connector": {
                const target = attachTarget(s.doc, w);
                gesture = { kind: "connector", start: endFor(s.doc, target, w, p.metaKey || p.ctrlKey), cursor: w, target: null, exact: false };
                return true;
            }
            case "marker":
            case "highlighter": {
                const at = placeAt(s.doc, w.x, w.y);
                gesture = { kind: "stroke", samples: [w], base: s.doc, parentId: at.parentId, nodeId: nanoid(10), highlighter: b.tool === "highlighter" };
                return true;
            }
            case "washi": {
                const at = placeAt(s.doc, w.x, w.y);
                gesture = { kind: "washi", start: w, end: w, base: s.doc, parentId: at.parentId, nodeId: nanoid(10) };
                return true;
            }
            case "eraser":
                gesture = { kind: "erase", base: s.doc, erased: new Set(), trail: [w] };
                eraseUnder(gesture, w, s.camera.zoom);
                return true;
            case "stamp": {
                // Shift-click: an emote burst instead of a stamp.
                if (p.shiftKey) {
                    sendEmote(b.stamp, w);
                    return true;
                }
                // The stamp goes down on release, bigger the longer the press is held.
                gesture = { kind: "stamp", start: w, t0: performance.now() };
                const grow = () => {
                    if (gesture?.kind !== "stamp") return;
                    editor.set({});
                    requestAnimationFrame(grow);
                };
                requestAnimationFrame(grow);
                return true;
            }
            case "code": {
                const at = placeAt(s.doc, w.x, w.y);
                const node = makeCodeBlock(s.doc, at.x - CODE_WIDTH / 2, at.y - 60, at.parentId);
                editor.execute({ type: "node.create", node });
                finishTool();
                startEditing(node.id);
                return true;
            }
            case "sticker": {
                const at = placeAt(s.doc, w.x, w.y);
                const node = makeSticker(s.doc, at.x, at.y, b.sticker, at.parentId, myName());
                editor.execute({ type: "node.create", node });
                editor.set({ selection: [node.id] });
                finishTool();
                return true;
            }
            case "table":
                // Click for a 3×3 table, or drag out as many rows and columns as wanted.
                gesture = { kind: "table", start: w, end: w };
                return true;
        }
        if (s.tool !== "move") return false;
        // A section locked by its background can't be picked up from it.
        const under = hitTest(s.doc, w.x, w.y);
        // Widgets' buttons, options and checkboxes work with a click.
        if (under?.jam?.kind === "widget" && !p.shiftKey && widgetClick(under, w, false)) {
            gesture = null;
            return true;
        }
        if (under?.isSection && p.shiftKey && !under.locked) {
            gesture = { kind: "marquee", section: under.id, start: w, end: w };
            return true;
        }
        if (under?.isSection && under.jam?.kind === "section" && under.jam.lockBg && !p.shiftKey) {
            if (!s.selection.includes(under.id)) {
                editor.set({ selection: [] });
                return true;
            }
        }
        // The quick-create dots and connector ends, while something is selected.
        const dot = sideDots(s.camera).find((d) => near(d, p.screen, 9));
        if (dot) {
            gesture = { kind: "dot", id: dot.id, side: dot.side, start: w, cursor: w, moved: false, target: null };
            return true;
        }
        const reveal = revealChip(s.camera);
        if (reveal && near(reveal.screen, p.screen, 11)) {
            revealText(reveal.id);
            gesture = null;
            return true;
        }
        const handled = tableDown(s.camera, p);
        if (handled) return true;
        const line = tableLineAt(s.camera, p.screen);
        if (line) {
            gesture = { kind: "tableLine", ...line, base: s.doc };
            return true;
        }
        if (b.tableSel) board.set({ tableSel: null });
        const inTable = tableCellAt(s.camera, p.screen);
        if (inTable) {
            if (b.tableSel?.id === inTable.id || p.shiftKey) {
                const sel = b.tableSel;
                if (p.shiftKey && sel?.id === inTable.id) {
                    pickCells(inTable.id, sel.r0, sel.c0, inTable.cell[0], inTable.cell[1]);
                    gesture = { kind: "tableCells", id: inTable.id, r0: sel.r0, c0: sel.c0 };
                } else {
                    pickCells(inTable.id, inTable.cell[0], inTable.cell[1]);
                    gesture = { kind: "tableCells", id: inTable.id, r0: inTable.cell[0], c0: inTable.cell[1] };
                }
                return true;
            }
            gesture = { kind: "tablePress", id: inTable.id, start: w, base: s.doc, cell: inTable.cell, moved: false };
            return true;
        }
        const bendable = bendHandles(s.camera).find((h) => near(h.screen, p.screen, 8));
        if (bendable) {
            gesture = { kind: "bend", id: bendable.id, base: s.doc, segment: bendable.segment };
            return true;
        }
        const label = labelAt(w);
        if (label) {
            gesture = { kind: "label", id: label, base: s.doc };
            return true;
        }
        const end = connectorEnds(s.camera).find((e) => near(e, p.screen, 8));
        if (end) {
            gesture = { kind: "reattach", id: end.id, which: end.which, cursor: w, target: null, exact: false };
            return true;
        }
        return false;
    },
    move(p) {
        const g = gesture;
        if (!g) return;
        const s = editor.get();
        const w = p.world;
        hoverWorld = w;
        if (g.kind === "bend") {
            const patch = bendTo(g.base, g.id, w, g.segment);
            if (patch) editor.preview(applyCommand(g.base, { type: "node.update", id: g.id, patch }));
            return;
        }
        if (g.kind === "label") {
            const node = g.base.nodes[g.id];
            const route = node ? liveRoute(g.base, node) : null;
            if (!node || node.jam?.kind !== "connector" || !route) return;
            editor.preview(applyCommand(g.base, { type: "node.update", id: g.id, patch: { jam: { ...node.jam, labelAt: nearestAlong(route, w) } } }));
            return;
        }
        if (g.kind === "tableGrab" || g.kind === "tableCells" || g.kind === "tablePress") {
            tableMove(g, w, s.camera.zoom);
            return;
        }
        if (g.kind === "shape" || g.kind === "table" || g.kind === "marquee") g.end = w;
        else if (g.kind === "tableLine") {
            const node = g.base.nodes[g.id];
            const jam = node?.jam?.kind === "table" ? node.jam : null;
            if (!node || !jam) return;
            const local = apply(spaceMatrix(g.base, node.parentId).inverse(), w.x, w.y);
            const next = dragTableLine(node, jam, g.axis, g.index, g.axis === "col" ? local.x : local.y);
            editor.preview(applyCommand(g.base, { type: "node.update", id: g.id, patch: { jam: next } }));
            return;
        }
        else if (g.kind === "connector") {
            g.cursor = w;
            g.exact = p.metaKey || p.ctrlKey;
            g.target = attachTarget(s.doc, w, g.start.id ?? undefined);
        } else if (g.kind === "reattach") {
            g.cursor = w;
            g.exact = p.metaKey || p.ctrlKey;
            const node = s.doc.nodes[g.id];
            const other = node?.jam?.kind === "connector" ? node.jam[g.which === "start" ? "end" : "start"].id : null;
            g.target = attachTarget(s.doc, w, other ?? g.id);
            if (g.target?.id === g.id) g.target = null;
        } else if (g.kind === "dot") {
            g.cursor = w;
            if (Math.hypot(w.x - g.start.x, w.y - g.start.y) * s.camera.zoom > 4) g.moved = true;
            g.target = attachTarget(s.doc, w, g.id);
        } else if (g.kind === "stroke") {
            if (p.shiftKey) g.samples = [g.samples[0] ?? w, w];
            else g.samples.push(w);
            const node = strokeNode(g, s.camera.zoom);
            if (node) editor.preview(applyCommand(g.base, { type: "node.create", node }));
            return;
        } else if (g.kind === "washi") {
            g.end = w;
            const custom = board.get().washi === "custom" ? board.get().washiImage : null;
            const base = custom && !g.base.images[custom.id] ? applyCommand(g.base, { type: "image.add", id: custom.id, data: custom.data }) : g.base;
            editor.preview(applyCommand(base, { type: "node.create", node: washiNode(g) }));
            return;
        } else if (g.kind === "erase") {
            // Check along the way from the last point, so a quick swipe still catches thin strokes.
            const last = g.trail[g.trail.length - 1] ?? w;
            const steps = Math.max(1, Math.ceil((Math.hypot(w.x - last.x, w.y - last.y) * s.camera.zoom) / 4));
            for (let i = 1; i <= steps; i++) eraseUnder(g, { x: last.x + ((w.x - last.x) * i) / steps, y: last.y + ((w.y - last.y) * i) / steps }, s.camera.zoom);
            g.trail = [...g.trail.slice(-12), w];
            return;
        }
        editor.set({});
    },
    up(p) {
        const g = gesture;
        gesture = null;
        if (!g) return;
        const s = editor.get();
        const w = p.world;
        if (g.kind === "shape") {
            const dragged = Math.hypot(w.x - g.start.x, w.y - g.start.y) * s.camera.zoom > 6;
            const box: Rect = dragged
                ? { x: Math.min(g.start.x, w.x), y: Math.min(g.start.y, w.y), w: Math.max(8, Math.abs(w.x - g.start.x)), h: Math.max(8, Math.abs(w.y - g.start.y)) }
                : { x: g.start.x - SHAPE_SIZE / 2, y: g.start.y - SHAPE_SIZE / 2, w: SHAPE_SIZE, h: SHAPE_SIZE };
            if (p.shiftKey && dragged) box.w = box.h = Math.max(box.w, box.h);
            const id = placeShape(box);
            finishTool();
            startEditing(id);
            return;
        }
        if (g.kind === "bend") {
            const patch = bendTo(g.base, g.id, w, g.segment);
            if (patch) editor.execute({ type: "node.update", id: g.id, patch }, g.base);
            return;
        }
        if (g.kind === "label") {
            const node = g.base.nodes[g.id];
            const route = node ? liveRoute(g.base, node) : null;
            if (!node || node.jam?.kind !== "connector" || !route) return;
            editor.execute({ type: "node.update", id: g.id, patch: { jam: { ...node.jam, labelAt: nearestAlong(route, w) } } }, g.base);
            return;
        }
        if (g.kind === "table") {
            const dragged = Math.hypot(w.x - g.start.x, w.y - g.start.y) * s.camera.zoom > 8;
            const { cols, rows } = dragged ? tableDims(g.start, w) : { cols: 3, rows: 3 };
            const x = dragged ? Math.min(g.start.x, w.x) : g.start.x - (TABLE_COL * cols) / 2;
            const y = dragged ? Math.min(g.start.y, w.y) : g.start.y - (TABLE_ROW * rows) / 2;
            const at = placeAt(s.doc, x, y);
            const node = makeTable(s.doc, at.x, at.y, at.parentId, cols, rows);
            editor.execute({ type: "node.create", node });
            editor.set({ selection: [node.id] });
            finishTool();
            return;
        }
        if (g.kind === "tableGrab") {
            if (g.moved && g.to !== null) {
                moveTracks(g.id, g.axis, g.indexes, g.to);
                // The moved rows or columns stay picked in their new place.
                const jam = editor.get().doc.nodes[g.id]?.jam;
                const last = jam?.kind === "table" ? (g.axis === "row" ? jam.cols.length : jam.rows.length) - 1 : 0;
                const end = g.to + g.indexes.length - 1;
                if (g.axis === "row") pickCells(g.id, g.to, 0, end, last, "row");
                else pickCells(g.id, 0, g.to, last, end, "col");
            }
            else if (g.moved) editor.set({});
            return;
        }
        if (g.kind === "tableCells") return;
        if (g.kind === "marquee") {
            const box = { x: Math.min(g.start.x, w.x), y: Math.min(g.start.y, w.y), w: Math.abs(w.x - g.start.x), h: Math.abs(w.y - g.start.y) };
            const section = s.doc.nodes[g.section];
            // A click (no drag) picks the section itself.
            if (!section || box.w * s.camera.zoom < 3) return editor.set({ selection: [g.section] });
            const inside = section.children.filter((id) => {
                const n = s.doc.nodes[id];
                if (!n || n.visible === false || n.locked) return false;
                const b = worldBounds(s.doc, n);
                return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
            });
            editor.set({ selection: inside });
            return;
        }
        if (g.kind === "tablePress") {
            if (g.moved) {
                const node = editor.get().doc.nodes[g.id];
                if (node) editor.execute({ type: "node.update", id: g.id, patch: { x: node.x, y: node.y } }, g.base);
            } else {
                const jam = g.base.nodes[g.id]?.jam;
                const [r, c] = jam?.kind === "table" ? anchorOf(jam, g.cell[0], g.cell[1]) : g.cell;
                pickCells(g.id, r, c);
            }
            return;
        }
        if (g.kind === "tableLine") {
            const node = g.base.nodes[g.id];
            const jam = node?.jam?.kind === "table" ? node.jam : null;
            if (!node || !jam) return;
            const local = apply(spaceMatrix(g.base, node.parentId).inverse(), w.x, w.y);
            editor.execute({ type: "node.update", id: g.id, patch: { jam: dragTableLine(node, jam, g.axis, g.index, g.axis === "col" ? local.x : local.y) } }, g.base);
            return;
        }
        if (g.kind === "stamp") {
            // A stamp dropped on a sticky, shape, table or image sticks to it.
            const size = heldStampSize(performance.now() - g.t0);
            const at = placeAt(s.doc, g.start.x, g.start.y);
            const under = objectUnder(s.doc, g.start, "");
            const box = under ? worldBounds(s.doc, under) : null;
            const on = under && box ? { id: under.id, u: (g.start.x - box.x) / Math.max(1, box.w), v: (g.start.y - box.y) / Math.max(1, box.h) } : undefined;
            const node = makeStamp(s.doc, at.x, at.y, board.get().stamp, at.parentId, myName(), size, on);
            editor.execute({ type: "node.create", node });
            return;
        }
        if (g.kind === "connector") {
            const target = attachTarget(s.doc, w, g.start.id ?? undefined);
            const end = endFor(s.doc, target, w, p.metaKey || p.ctrlKey);
            const startPt = { x: g.start.x, y: g.start.y };
            if (!target && !g.start.id && Math.hypot(w.x - startPt.x, w.y - startPt.y) * s.camera.zoom < 8) return editor.set({});
            if (!target && g.start.id && Math.hypot(w.x - startPt.x, w.y - startPt.y) * s.camera.zoom < 8) return editor.set({});
            const at = placeAt(s.doc, w.x, w.y);
            const node = newConnector(s.doc, g.start, end, at.parentId === s.pageId ? at.parentId : s.pageId);
            editor.execute({ type: "node.create", node });
            editor.set({ selection: [node.id] });
            return;
        }
        if (g.kind === "reattach") {
            const node = s.doc.nodes[g.id];
            if (node?.jam?.kind !== "connector") return;
            const end = endFor(s.doc, g.target, w, g.exact);
            editor.execute({ type: "node.update", id: g.id, patch: { jam: { ...node.jam, [g.which]: end } } });
            return;
        }
        if (g.kind === "dot") {
            if (!g.moved) {
                addAdjacent(g.id, g.side);
                return;
            }
            // Dragged from a dot onto empty board: a new copy there, joined to the original.
            const target = attachTarget(s.doc, w, g.id);
            if (!target) {
                addAdjacent(g.id, g.side, { at: w, connect: true });
                return;
            }
            // Onto an object: a connector from that side to it.
            const node = newConnector(s.doc, { id: g.id, side: g.side, x: g.start.x, y: g.start.y }, endFor(s.doc, target, w, false), s.pageId);
            editor.execute({ type: "node.create", node });
            editor.set({ selection: [node.id] });
            return;
        }
        if (g.kind === "stroke") {
            if (p.shiftKey) g.samples = [g.samples[0] ?? w, w];
            else g.samples.push(w);
            let node = strokeNode(g, s.camera.zoom);
            // A highlight drawn over a sticky, shape, table or image sticks to it.
            if (node && g.highlighter && node.jam?.kind === "draw") {
                const box = worldBounds(applyCommand(g.base, { type: "node.create", node }), node);
                const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
                const under = objectUnder(g.base, c, node.id);
                const ub = under ? worldBounds(g.base, under) : null;
                if (under && ub) node = { ...node, jam: { ...node.jam, on: under.id, at: { u: (c.x - ub.x) / Math.max(1, ub.w), v: (c.y - ub.y) / Math.max(1, ub.h) } } };
            }
            if (node) editor.execute({ type: "node.create", node }, g.base);
            else editor.preview(g.base);
            return;
        }
        if (g.kind === "washi") {
            g.end = w;
            const length = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);
            if (length * s.camera.zoom < 6) g.end = { x: g.start.x + 160, y: g.start.y };
            const tape = washiNode(g);
            const custom = tape.jam?.kind === "washi" && tape.jam.image ? board.get().washiImage : null;
            // An uploaded pattern's image comes into the file with the first strip that uses it.
            if (custom && !g.base.images[custom.id]) editor.execute({ type: "batch", commands: [{ type: "image.add", id: custom.id, data: custom.data }, { type: "node.create", node: tape }] }, g.base);
            else editor.execute({ type: "node.create", node: tape }, g.base);
            return;
        }
        if (g.kind === "erase") {
            const last = g.trail[g.trail.length - 1] ?? w;
            const steps = Math.max(1, Math.ceil((Math.hypot(w.x - last.x, w.y - last.y) * s.camera.zoom) / 4));
            for (let i = 1; i <= steps; i++) eraseUnder(g, { x: last.x + ((w.x - last.x) * i) / steps, y: last.y + ((w.y - last.y) * i) / steps }, s.camera.zoom);
            if (g.erased.size) editor.execute({ type: "node.delete", ids: [...g.erased] }, g.base);
            else editor.preview(g.base);
        }
    },
    hover(p) {
        if (!editor.get().doc.board) return undefined;
        // Hovering a stamp shows who added it.
        const over = hitTest(editor.get().doc, p.world.x, p.world.y);
        const stampId = over?.jam?.kind === "stamp" ? over.id : null;
        if (stampId !== hoverStamp) {
            hoverStamp = stampId;
            editor.set({});
        }
        if (!isBoardDoc()) return undefined;
        hoverWorld = p.world;
        const b = board.get();
        if (b.tool) {
            editor.set({});
            return b.tool === "eraser" ? "cell" : "crosshair";
        }
        const s = editor.get();
        if (s.tool !== "move") return undefined;
        if (sideDots(s.camera).some((d) => near(d, p.screen, 9))) return "pointer";
        const widget = hitTest(s.doc, p.world.x, p.world.y);
        if (widget?.jam?.kind === "widget") {
            const cursor = widgetCursor(widget, p.world);
            if (cursor) return cursor;
        }
        const reveal = revealChip(s.camera);
        if (reveal && near(reveal.screen, p.screen, 11)) return "pointer";
        const target = tableTarget(s.camera, p.screen);
        if (JSON.stringify(target) !== JSON.stringify(tableHover)) {
            tableHover = target;
            editor.set({});
        }
        if (target) return target.kind === "grab" ? "grab" : "pointer";
        const line = tableLineAt(s.camera, p.screen);
        if (line) return line.axis === "col" ? "col-resize" : "row-resize";
        if (labelAt(p.world)) return "grab";
        const bendable = bendHandles(s.camera).find((h) => near(h.screen, p.screen, 8));
        if (bendable) return bendable.axis === "x" ? "ew-resize" : bendable.axis === "y" ? "ns-resize" : "move";
        if (connectorEnds(s.camera).some((e) => near(e, p.screen, 8))) return "move";
        return undefined;
    },
    dblclick(p) {
        if (!isBoardDoc()) return false;
        const s = editor.get();
        // Double-click the side of a fixed-width text box: it becomes auto width (point text).
        const only = s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined;
        if (only?.type === "text" && only.sizing.h === "fixed" && !only.rotation) {
            const box = worldBounds(s.doc, only);
            const a = worldToScreen(s.camera, box.x, box.y);
            const z = worldToScreen(s.camera, box.x + box.w, box.y + box.h);
            const onSide = (Math.abs(p.screen.x - a.x) <= 6 || Math.abs(p.screen.x - z.x) <= 6) && p.screen.y >= a.y - 4 && p.screen.y <= z.y + 4;
            if (onSide) {
                const auto = { ...only, sizing: { h: "hug" as const, v: "hug" as const } };
                const size = textSize(auto);
                editor.execute({ type: "node.update", id: only.id, patch: { sizing: auto.sizing, w: size.w, h: size.h } });
                return true;
            }
        }
        // Double-click a section's title to rename it.
        const titled = hitFrameLabel(s.doc, s.camera, p.screen.x, p.screen.y);
        if (titled?.isSection) {
            editor.set({ selection: [titled.id] });
            board.set({ renamingSection: titled.id });
            return true;
        }
        const node = hitTest(s.doc, p.world.x, p.world.y, true);
        const kind = node?.jam?.kind;
        if (!node || !kind) {
            // Double-click on empty board: a sticky, as a quick way to jot something down.
            return false;
        }
        if (node.jam?.kind === "widget" && widgetClick(node, p.world, true)) return true;
        if (node.jam?.kind === "link") {
            // A card opens its page; an embed plays where it is (it's live once selected).
            if (node.jam.embed && node.jam.display !== "minimized") editor.set({ selection: [node.id] });
            else openWebUrl(node.jam.url);
            return true;
        }
        if (kind === "sticky" || kind === "shape" || kind === "connector" || kind === "code") {
            startEditing(node.id);
            return true;
        }
        if (kind === "table" && node.jam?.kind === "table") {
            const { xs, ys } = tableGrid(node, node.jam);
            const local = apply(spaceMatrix(s.doc, node.parentId).inverse(), p.world.x, p.world.y);
            const col = Math.max(0, xs.findIndex((x, i) => i > 0 && local.x <= x) - 1);
            const row = Math.max(0, ys.findIndex((y, i) => i > 0 && local.y <= y) - 1);
            const cell = anchorOf(node.jam, row, col);
            pickCells(node.id, cell[0], cell[1]);
            startEditing(node.id, cell);
            return true;
        }
        return false;
    },
    overlay(ctx, camera) {
        if (!editor.get().doc.board) return;
        drawBursts(ctx, (x, y) => worldToScreen(camera, x, y));
        drawHands(ctx, camera, hoverWorld);
        const hovered = hoverStamp ? editor.get().doc.nodes[hoverStamp] : undefined;
        if (hovered?.jam?.kind === "stamp" && hovered.jam.author) {
            const box = worldBounds(editor.get().doc, hovered);
            const a = worldToScreen(camera, box.x + box.w / 2, box.y + box.h);
            drawTag(ctx, a.x, a.y + 8, hovered.jam.author);
        }
        if (!isBoardDoc()) return;
        const s = editor.get();
        const b = board.get();
        const g = gesture;
        // A ghost of the sticky or shape under the pointer before placing it.
        if (!g && hoverWorld && b.tool === "sticker") {
            const c = worldToScreen(camera, hoverWorld.x, hoverWorld.y);
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.font = `${Math.round(100 * camera.zoom)}px "Apple Color Emoji", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(b.sticker, c.x, c.y);
            ctx.restore();
        }
        if (!g && hoverWorld && b.tool === "code") {
            const a = worldToScreen(camera, hoverWorld.x - CODE_WIDTH / 2, hoverWorld.y - 60);
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#1E1E1E";
            ctx.beginPath();
            ctx.roundRect(a.x, a.y, CODE_WIDTH * camera.zoom, 140 * camera.zoom, 12 * camera.zoom);
            ctx.fill();
            ctx.restore();
        }
        if (!g && hoverWorld && (b.tool === "sticky" || b.tool === "shape" || b.tool === "stamp")) {
            const size = b.tool === "sticky" ? STICKY_SIZE : b.tool === "shape" ? SHAPE_SIZE : 48;
            const width = b.tool === "sticky" && b.stickyWide ? STICKY_WIDE : size;
            const a = worldToScreen(camera, hoverWorld.x - width / 2, hoverWorld.y - size / 2);
            const z = size * camera.zoom;
            const zw = width * camera.zoom;
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = b.tool === "sticky" ? b.stickyColor : b.tool === "shape" ? b.shapeColor : "#FFCD29";
            ctx.beginPath();
            if (b.tool === "stamp" || (b.tool === "shape" && (b.shape === "circle" || b.shape === "ellipse"))) ctx.arc(a.x + z / 2, a.y + z / 2, z / 2, 0, Math.PI * 2);
            else ctx.rect(a.x, a.y, zw, z);
            ctx.fill();
            ctx.restore();
        }
        if (g?.kind === "marquee") {
            const a = worldToScreen(camera, g.start.x, g.start.y);
            const e = worldToScreen(camera, g.end.x, g.end.y);
            ctx.save();
            ctx.fillStyle = "rgba(13,153,255,0.08)";
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.lineWidth = 1;
            ctx.fillRect(Math.min(a.x, e.x), Math.min(a.y, e.y), Math.abs(e.x - a.x), Math.abs(e.y - a.y));
            ctx.strokeRect(Math.min(a.x, e.x) + 0.5, Math.min(a.y, e.y) + 0.5, Math.abs(e.x - a.x), Math.abs(e.y - a.y));
            ctx.restore();
        }
        if (g?.kind === "shape") {
            const a = worldToScreen(camera, g.start.x, g.start.y);
            const e = worldToScreen(camera, g.end.x, g.end.y);
            ctx.save();
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.fillStyle = b.shapeColor;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(Math.min(a.x, e.x), Math.min(a.y, e.y), Math.abs(e.x - a.x), Math.abs(e.y - a.y));
            ctx.restore();
        }
        const outline = (node: SceneNode | null) => {
            if (!node) return;
            const box = worldBounds(s.doc, node);
            const a = worldToScreen(camera, box.x, box.y);
            ctx.save();
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.lineWidth = 2;
            ctx.strokeRect(a.x, a.y, box.w * camera.zoom, box.h * camera.zoom);
            // The side the end will snap to.
            ctx.restore();
        };
        if (g?.kind === "connector" || g?.kind === "reattach" || (g?.kind === "dot" && g.moved)) {
            let from: Pt;
            if (g.kind === "connector") from = { x: g.start.x, y: g.start.y };
            else if (g.kind === "dot") {
                const n = s.doc.nodes[g.id];
                from = n ? sidePt(worldBounds(s.doc, n), g.side) : g.start;
            } else {
                const n = s.doc.nodes[g.id];
                const route = n ? liveRoute(s.doc, n) : null;
                from = route ? (g.which === "start" ? route.end : route.start) : g.cursor;
            }
            let to = g.cursor;
            let centre: Pt | null = null;
            if (g.target) {
                const box = worldBounds(s.doc, g.target);
                centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
                if (nearCenter(box, g.cursor)) to = centre;
                else if (!("exact" in g) || !g.exact) to = sidePt(box, facingSide(box, from));
            }
            outline(g.target);
            // The target's centre dot: let go on it to aim the end at the centre.
            if (centre) {
                const c = worldToScreen(camera, centre.x, centre.y);
                drawDot(ctx, c.x, c.y, 5, to === centre ? HANDLE_BLUE : "#FFFFFF");
            }
            const a = worldToScreen(camera, from.x, from.y);
            const e = worldToScreen(camera, to.x, to.y);
            ctx.save();
            ctx.strokeStyle = "#1E1E1E";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(e.x, e.y);
            ctx.stroke();
            ctx.restore();
            drawDot(ctx, e.x, e.y, 4);
        }
        if (g?.kind === "dot" && g.moved && !g.target) {
            const n = s.doc.nodes[g.id];
            if (n) {
                const a = worldToScreen(camera, g.cursor.x - n.w / 2, g.cursor.y - n.h / 2);
                ctx.save();
                ctx.globalAlpha = 0.5;
                const fill = n.fills.find((f) => f.type === "solid");
                ctx.fillStyle = fill && fill.type === "solid" ? fill.color : "#FFFFFF";
                ctx.fillRect(a.x, a.y, n.w * camera.zoom, n.h * camera.zoom);
                ctx.restore();
            }
        }
        if (g?.kind === "table") {
            const dragged = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) * camera.zoom > 8;
            if (dragged) {
                const { cols, rows } = tableDims(g.start, g.end);
                const a = worldToScreen(camera, Math.min(g.start.x, g.end.x), Math.min(g.start.y, g.end.y));
                const cw = TABLE_COL * camera.zoom;
                const rh = TABLE_ROW * camera.zoom;
                ctx.save();
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.fillRect(a.x, a.y, cw * cols, rh * rows);
                ctx.strokeStyle = HANDLE_BLUE;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let c = 0; c <= cols; c++) {
                    ctx.moveTo(a.x + c * cw, a.y);
                    ctx.lineTo(a.x + c * cw, a.y + rh * rows);
                }
                for (let r = 0; r <= rows; r++) {
                    ctx.moveTo(a.x, a.y + r * rh);
                    ctx.lineTo(a.x + cw * cols, a.y + r * rh);
                }
                ctx.stroke();
                ctx.restore();
                drawTag(ctx, a.x + (cw * cols) / 2, a.y + rh * rows + 8, `${cols} × ${rows}`);
            }
        }
        if (g?.kind === "stamp") {
            // The stamp under the press, growing and wiggling while held.
            const held = performance.now() - g.t0;
            const size = heldStampSize(held) * camera.zoom;
            const info = stampLook(b.stamp);
            const c = worldToScreen(camera, g.start.x, g.start.y);
            ctx.save();
            ctx.translate(c.x, c.y);
            if (held > 250) ctx.rotate(Math.sin(held / 60) * 0.12);
            ctx.beginPath();
            ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = "#FFFFFF";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = info?.color ?? "#FFCD29";
            ctx.fill();
            ctx.font = `${Math.round(size * 0.45)}px "Apple Color Emoji", Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(info?.glyph ?? "", 0, size * 0.03);
            ctx.restore();
        }
        if (g?.kind === "erase") {
            ctx.save();
            ctx.strokeStyle = "rgba(0,0,0,0.25)";
            ctx.lineWidth = 8;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            g.trail.forEach((pt, i) => {
                const q = worldToScreen(camera, pt.x, pt.y);
                if (i === 0) ctx.moveTo(q.x, q.y);
                else ctx.lineTo(q.x, q.y);
            });
            ctx.stroke();
            ctx.restore();
        }
        if (s.tool === "move" && !b.tool) drawTableUi(ctx, camera, g);
        const reveal = !g && s.tool === "move" && !b.tool ? revealChip(camera) : null;
        if (reveal) {
            // A shape's text runs past it: a blue arrow under it shows the rest.
            const { x, y } = reveal.screen;
            ctx.save();
            ctx.fillStyle = HANDLE_BLUE;
            ctx.beginPath();
            ctx.roundRect(x - 14, y - 8, 28, 16, 8);
            ctx.fill();
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.8;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(x - 4, y - 2);
            ctx.lineTo(x, y + 2.5);
            ctx.lineTo(x + 4, y - 2);
            ctx.stroke();
            ctx.restore();
        }
        if (!g && s.tool === "move" && !b.tool) {
            for (const d of sideDots(camera)) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = HANDLE_BLUE;
                ctx.globalAlpha = 0.9;
                ctx.fill();
                ctx.restore();
            }
            for (const e of connectorEnds(camera)) drawDot(ctx, e.x, e.y, 5);
            for (const bendable of bendHandles(camera)) {
                ctx.save();
                ctx.fillStyle = "#FFFFFF";
                ctx.strokeStyle = HANDLE_BLUE;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                const horizontal = bendable.axis === "y";
                ctx.roundRect(bendable.screen.x - (horizontal ? 8 : 3.5), bendable.screen.y - (horizontal ? 3.5 : 8), horizontal ? 16 : 7, horizontal ? 7 : 16, 3.5);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }
    },
});

// A small dark tag under a point (who added a stamp).
function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    ctx.save();
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = "#1E1E1E";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 20, 5);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 10.5);
    ctx.restore();
}

// The selected connector's reshape handles on screen: one on each segment of an elbowed line long
// enough to grab (the first and last add segments when dragged), or a curve's middle.
function bendHandles(camera: Camera): { id: string; screen: Pt; axis: "x" | "y" | "n"; segment: number | null }[] {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().editing) return [];
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (node?.jam?.kind !== "connector" || node.locked) return [];
    const route = liveRoute(s.doc, node);
    if (!route) return [];
    if (node.jam.line === "elbow") {
        return elbowSegments(route)
            .filter((seg) => seg.length * camera.zoom >= 28)
            .map((seg) => ({ id: node.id, screen: worldToScreen(camera, seg.at.x, seg.at.y), axis: seg.axis, segment: seg.index }));
    }
    if (!route.handle) return [];
    return [{ id: node.id, screen: worldToScreen(camera, route.handle.at.x, route.handle.at.y), axis: route.handle.axis, segment: null }];
}

// The connector's shape with a handle dragged to a world point.
function bendTo(doc: NagmaDocument, id: string, w: Pt, segment: number | null): Partial<SceneNode> | null {
    const node = doc.nodes[id];
    if (node?.jam?.kind !== "connector") return null;
    const route = liveRoute(doc, node);
    if (!route) return null;
    if (segment !== null && node.jam.line === "elbow") return { jam: { ...node.jam, mid: undefined, ...dragSegment(route, segment, w) } };
    if (!route.handle) return null;
    const { start, end } = route;
    // A curve: how far across the line between the ends the middle was pulled.
    const flat = liveRoute(doc, { ...node, jam: { ...node.jam, bend: 0 } });
    const mid0 = flat ? pointAlong(flat, 0.5) : route.handle.at;
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const n = { x: -(end.y - start.y) / len, y: (end.x - start.x) / len };
    return { jam: { ...node.jam, bend: ((w.x - mid0.x) * n.x + (w.y - mid0.y) * n.y) / 0.75 } };
}

// The selected connector whose label is under a world point.
function labelAt(w: Pt): string | null {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().editing) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (node?.jam?.kind !== "connector" || !node.text || node.locked) return null;
    const route = liveRoute(s.doc, node);
    if (!route) return null;
    const at = pointAlong(route, node.jam.labelAt ?? 0.5);
    const layout = layoutText(connectorLabel(node, at));
    const half = layout.lines.reduce((a, l) => Math.max(a, l.width), 0) / 2 + 6;
    return Math.abs(w.x - at.x) <= half && Math.abs(w.y - at.y) <= layout.height / 2 + 4 ? node.id : null;
}

// Columns and rows for a table dragged from a to b (one cell per default cell size, up to 20).
function tableDims(a: Pt, b: Pt) {
    return { cols: Math.max(1, Math.min(20, Math.round(Math.abs(b.x - a.x) / TABLE_COL) || 1)), rows: Math.max(1, Math.min(40, Math.round(Math.abs(b.y - a.y) / TABLE_ROW) || 1)) };
}

// An inner column or row line of the selected table under the pointer (to drag it).
function tableLineAt(camera: Camera, screen: Pt): { id: string; axis: "col" | "row"; index: number } | null {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().tool) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    const jam = node?.jam?.kind === "table" ? node.jam : null;
    if (!node || !jam || node.locked) return null;
    const m = spaceMatrix(s.doc, node.parentId);
    const { xs, ys } = tableGrid(node, jam);
    const tl = apply(m, node.x, node.y);
    const br = apply(m, node.x + node.w, node.y + node.h);
    const top = worldToScreen(camera, tl.x, tl.y);
    const bottom = worldToScreen(camera, br.x, br.y);
    const inside = screen.x > top.x - 4 && screen.x < bottom.x + 4 && screen.y > top.y - 4 && screen.y < bottom.y + 4;
    if (!inside) return null;
    for (let i = 1; i < xs.length - 1; i++) {
        const q = worldToScreen(camera, apply(m, xs[i] ?? 0, node.y).x, 0);
        if (Math.abs(q.x - screen.x) <= 4) return { id: node.id, axis: "col", index: i };
    }
    for (let i = 1; i < ys.length - 1; i++) {
        const q = worldToScreen(camera, 0, apply(m, node.x, ys[i] ?? 0).y);
        if (Math.abs(q.y - screen.y) <= 4) return { id: node.id, axis: "row", index: i };
    }
    return null;
}

// The table's shares with line `index` moved to `at` (in the table's parent space), keeping the
// two tracks either side of it at least 24 wide.
function dragTableLine(node: SceneNode, jam: Extract<JamData, { kind: "table" }>, axis: "col" | "row", index: number, at: number) {
    const { xs, ys } = tableGrid(node, jam);
    const edges = axis === "col" ? xs : ys;
    const tracks = axis === "col" ? jam.cols : jam.rows;
    const total = tracks.reduce((a, b) => a + b, 0);
    const size = axis === "col" ? node.w : node.h;
    const lo = (edges[index - 1] ?? 0) + 24;
    const hi = (edges[index + 1] ?? 0) - 24;
    if (hi <= lo) return jam;
    const pos = Math.max(lo, Math.min(hi, at));
    const next = [...tracks];
    next[index - 1] = ((pos - (edges[index - 1] ?? 0)) / size) * total;
    next[index] = (((edges[index + 1] ?? 0) - pos) / size) * total;
    return axis === "col" ? { ...jam, cols: next } : { ...jam, rows: next };
}

function sidePt(box: Rect, side: Side): Pt {
    if (side === "top") return { x: box.x + box.w / 2, y: box.y };
    if (side === "bottom") return { x: box.x + box.w / 2, y: box.y + box.h };
    if (side === "left") return { x: box.x, y: box.y + box.h / 2 };
    return { x: box.x + box.w, y: box.y + box.h / 2 };
}

// ---- Tables: grabbers, insert bars and picked cells ----

let tableHover: { kind: "grab"; axis: Axis; index: number } | { kind: "plus"; axis: Axis; index: number } | null = null;

// The single selected table (unlocked, not rotated), with its row and column edges on screen.
function tableOnScreen(camera: Camera) {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().tool) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    const jam = node?.jam?.kind === "table" ? node.jam : null;
    if (!node || !jam || node.locked || node.rotation) return null;
    const m = spaceMatrix(s.doc, node.parentId);
    const { xs, ys } = tableGrid(node, jam);
    const sx = xs.map((x) => worldToScreen(camera, apply(m, x, node.y).x, 0).x);
    const sy = ys.map((y) => worldToScreen(camera, 0, apply(m, node.x, y).y).y);
    return { node, jam, m, sx, sy, left: sx[0] as number, right: sx[sx.length - 1] as number, top: sy[0] as number, bottom: sy[sy.length - 1] as number };
}

const GRAB = 14;

// What's under the pointer around the selected table: a row or column grabber, or an insert bar
// (between rows or columns in the grabber strips, or along the bottom and right edges).
function tableTarget(camera: Camera, p: Pt): typeof tableHover {
    const t = tableOnScreen(camera);
    if (!t) return null;
    const inRowStrip = p.x >= t.left - GRAB - 8 && p.x < t.left - 2 && p.y >= t.top - 6 && p.y <= t.bottom + 6;
    const inColStrip = p.y >= t.top - GRAB - 8 && p.y < t.top - 2 && p.x >= t.left - 6 && p.x <= t.right + 6;
    if (inRowStrip) {
        const at = t.sy.findIndex((y) => Math.abs(y - p.y) <= 5);
        if (at >= 0) return { kind: "plus", axis: "row", index: at };
        const row = t.sy.findIndex((y, i) => i > 0 && p.y < y) - 1;
        if (row >= 0) return { kind: "grab", axis: "row", index: row };
    }
    if (inColStrip) {
        const at = t.sx.findIndex((x) => Math.abs(x - p.x) <= 5);
        if (at >= 0) return { kind: "plus", axis: "col", index: at };
        const col = t.sx.findIndex((x, i) => i > 0 && p.x < x) - 1;
        if (col >= 0) return { kind: "grab", axis: "col", index: col };
    }
    if (p.y > t.bottom + 3 && p.y < t.bottom + 18 && p.x >= t.left && p.x <= t.right) return { kind: "plus", axis: "row", index: t.sy.length - 1 };
    if (p.x > t.right + 3 && p.x < t.right + 18 && p.y >= t.top && p.y <= t.bottom) return { kind: "plus", axis: "col", index: t.sx.length - 1 };
    return null;
}

// The cell of the selected table under a screen point.
function tableCellAt(camera: Camera, p: Pt): { id: string; cell: [number, number] } | null {
    const t = tableOnScreen(camera);
    if (!t || p.x < t.left || p.x > t.right || p.y < t.top || p.y > t.bottom) return null;
    const col = Math.max(0, t.sx.findIndex((x, i) => i > 0 && p.x <= x) - 1);
    const row = Math.max(0, t.sy.findIndex((y, i) => i > 0 && p.y <= y) - 1);
    return { id: t.node.id, cell: [row, col] };
}

function tableDown(camera: Camera, p: PluginPointer): boolean {
    const target = tableTarget(camera, p.screen);
    const t = tableOnScreen(camera);
    if (!target || !t) return false;
    if (target.kind === "plus") {
        insertTracks(t.node.id, target.axis, target.index);
        const n = target.axis === "row" ? t.jam.cols.length - 1 : t.jam.rows.length - 1;
        if (target.axis === "row") pickCells(t.node.id, target.index, 0, target.index, n, "row");
        else pickCells(t.node.id, 0, target.index, n, target.index, "col");
        tableHover = null;
        gesture = null;
        return true;
    }
    const lines = pickedLines(t.node.id);
    const last = target.axis === "row" ? t.jam.cols.length - 1 : t.jam.rows.length - 1;
    const sel = board.get().tableSel;
    let indexes: number[];
    if (p.shiftKey && lines?.axis === target.axis && sel) {
        // ⇧click: pick through to this row or column.
        if (target.axis === "row") pickCells(t.node.id, sel.r0, 0, target.index, last, "row");
        else pickCells(t.node.id, 0, sel.c0, last, target.index, "col");
        indexes = pickedLines(t.node.id)?.indexes ?? [target.index];
    } else if (lines?.axis === target.axis && lines.indexes.includes(target.index)) indexes = lines.indexes;
    else {
        if (target.axis === "row") pickCells(t.node.id, target.index, 0, target.index, last, "row");
        else pickCells(t.node.id, 0, target.index, last, target.index, "col");
        indexes = [target.index];
    }
    gesture = { kind: "tableGrab", id: t.node.id, axis: target.axis, indexes, start: p.world, moved: false, to: null };
    return true;
}

function tableMove(g: Extract<Gesture, { kind: "tableGrab" | "tableCells" | "tablePress" }>, w: Pt, zoom: number) {
    const doc = editor.get().doc;
    if (g.kind === "tablePress") {
        // Dragging a selected table by a cell moves it.
        if (!g.moved && Math.hypot(w.x - g.start.x, w.y - g.start.y) * zoom <= 4) return;
        g.moved = true;
        const node = g.base.nodes[g.id];
        if (!node) return;
        const inv = spaceMatrix(g.base, node.parentId).inverse();
        const a = apply(inv, g.start.x, g.start.y);
        const b = apply(inv, w.x, w.y);
        editor.preview(applyCommand(g.base, { type: "node.update", id: g.id, patch: { x: node.x + b.x - a.x, y: node.y + b.y - a.y } }));
        return;
    }
    const node = doc.nodes[g.id];
    const jam = node?.jam?.kind === "table" ? node.jam : null;
    if (!node || !jam) return;
    const local = apply(spaceMatrix(doc, node.parentId).inverse(), w.x, w.y);
    const { xs, ys } = tableGrid(node, jam);
    if (g.kind === "tableCells") {
        const track = (edges: number[], v: number) => {
            const i = edges.findIndex((e, k) => k > 0 && v <= e) - 1;
            return i < 0 ? edges.length - 2 : i;
        };
        const col = track(xs, local.x);
        const row = track(ys, local.y);
        const sel = board.get().tableSel;
        if (sel?.r1 !== row || sel?.c1 !== col) pickCells(g.id, g.r0, g.c0, row, col);
        return;
    }
    // Reordering: the edge nearest the pointer is where the rows or columns will go.
    if (!g.moved && Math.hypot(w.x - g.start.x, w.y - g.start.y) * zoom <= 4) return;
    g.moved = true;
    const edges = g.axis === "row" ? ys : xs;
    const at = g.axis === "row" ? local.y : local.x;
    let best = 0;
    edges.forEach((e, i) => {
        if (Math.abs(e - at) < Math.abs((edges[best] ?? 0) - at)) best = i;
    });
    const lo = Math.min(...g.indexes);
    const hi = Math.max(...g.indexes);
    g.to = best <= lo ? best : best > hi + 1 ? best - g.indexes.length : null;
    editor.set({});
    lastGrabEdge = best;
}

let lastGrabEdge = 0;

function drawTableUi(ctx: CanvasRenderingContext2D, camera: Camera, g: Gesture | null) {
    const t = tableOnScreen(camera);
    if (!t) return;
    const range = pickedRange(t.node.id);
    const lines = pickedLines(t.node.id);
    ctx.save();
    // The picked cells.
    if (range) {
        const x = t.sx[range.left] as number;
        const y = t.sy[range.top] as number;
        const w = (t.sx[range.right + 1] as number) - x;
        const h = (t.sy[range.bottom + 1] as number) - y;
        ctx.fillStyle = "rgba(13,153,255,0.08)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = HANDLE_BLUE;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
    }
    // Grabbers: a short pill beside each row and above each column.
    const pill = (x: number, y: number, horizontal: boolean, on: boolean, hover: boolean) => {
        ctx.beginPath();
        if (horizontal) ctx.roundRect(x - 8, y - 3, 16, 6, 3);
        else ctx.roundRect(x - 3, y - 8, 6, 16, 3);
        ctx.fillStyle = on ? HANDLE_BLUE : hover ? "#B3B3B3" : "#D9D9D9";
        ctx.fill();
    };
    for (let r = 0; r < t.sy.length - 1; r++) {
        const on = lines?.axis === "row" && lines.indexes.includes(r);
        const hover = tableHover?.kind === "grab" && tableHover.axis === "row" && tableHover.index === r;
        pill(t.left - GRAB + 2, ((t.sy[r] as number) + (t.sy[r + 1] as number)) / 2, false, on, hover);
    }
    for (let c = 0; c < t.sx.length - 1; c++) {
        const on = lines?.axis === "col" && lines.indexes.includes(c);
        const hover = tableHover?.kind === "grab" && tableHover.axis === "col" && tableHover.index === c;
        pill(((t.sx[c] as number) + (t.sx[c + 1] as number)) / 2, t.top - GRAB + 2, true, on, hover);
    }
    // An insert bar: a blue line across the table with a plus at its end.
    const plus = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = HANDLE_BLUE;
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
    };
    const hover = !g ? tableHover : null;
    if (hover?.kind === "plus") {
        ctx.strokeStyle = HANDLE_BLUE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (hover.axis === "row") {
            const y = t.sy[hover.index] as number;
            const edge = hover.index === t.sy.length - 1;
            ctx.moveTo(t.left, edge ? y + 9 : y);
            ctx.lineTo(t.right, edge ? y + 9 : y);
            ctx.stroke();
            plus(edge ? (t.left + t.right) / 2 : t.left - GRAB + 2, edge ? y + 9 : y);
        } else {
            const x = t.sx[hover.index] as number;
            const edge = hover.index === t.sx.length - 1;
            ctx.moveTo(edge ? x + 9 : x, t.top);
            ctx.lineTo(edge ? x + 9 : x, t.bottom);
            ctx.stroke();
            plus(edge ? x + 9 : x, edge ? (t.top + t.bottom) / 2 : t.top - GRAB + 2);
        }
    }
    // Where dragged rows or columns will land.
    if (g?.kind === "tableGrab" && g.moved && g.id === t.node.id && g.to !== null) {
        ctx.strokeStyle = HANDLE_BLUE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (g.axis === "row") {
            const y = t.sy[lastGrabEdge] as number;
            ctx.moveTo(t.left - 4, y);
            ctx.lineTo(t.right + 4, y);
        } else {
            const x = t.sx[lastGrabEdge] as number;
            ctx.moveTo(x, t.top - 4);
            ctx.lineTo(x, t.bottom + 4);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// Keys while cells are picked (and nobody is typing in one): the arrows move (⇧ grows the block),
// Tab steps through the cells, Return types in the cell, Delete clears the cells, and typing
// replaces the cell's text.
export function tableKey(event: KeyboardEvent): boolean {
    const sel = board.get().tableSel;
    if (!sel || board.get().editing) return false;
    const node = editor.get().doc.nodes[sel.id];
    const jam = node?.jam?.kind === "table" ? node.jam : null;
    if (!node || !jam) return false;
    const range = expand(jam, selRange(sel));
    const key = event.key;
    if (key === "Escape") {
        board.set({ tableSel: null });
        return true;
    }
    if (key.startsWith("Arrow")) {
        const dir = key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : "right";
        if (event.shiftKey) {
            const dr = dir === "up" ? -1 : dir === "down" ? 1 : 0;
            const dc = dir === "left" ? -1 : dir === "right" ? 1 : 0;
            pickCells(sel.id, sel.r0, sel.c0, Math.max(0, Math.min(jam.rows.length - 1, sel.r1 + dr)), Math.max(0, Math.min(jam.cols.length - 1, sel.c1 + dc)));
        } else {
            const next = stepCell(jam, sel.r1, sel.c1, dir);
            if (next) pickCells(sel.id, next[0], next[1]);
        }
        return true;
    }
    if (key === "Tab") {
        const next = stepCell(jam, sel.r1, sel.c1, event.shiftKey ? "prev" : "next");
        if (next) pickCells(sel.id, next[0], next[1]);
        return true;
    }
    const anchor = anchorOf(jam, range.top, range.left);
    if (key === "Enter") {
        startEditing(sel.id, anchor);
        return true;
    }
    if (key === "Backspace" || key === "Delete") {
        clearCells(sel.id, range);
        return true;
    }
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const cells = jam.cells.map((row, r) => (r === anchor[0] ? row.map((v, c) => (c === anchor[1] ? key : v)) : row));
        editor.execute({ type: "node.update", id: sel.id, patch: { jam: { ...jam, cells } } });
        startEditing(sel.id, anchor, true);
        return true;
    }
    return false;
}

// ---- Shapes whose text doesn't fit ----

// The selected shape's "show all text" arrow, when its text runs past the shape.
function revealChip(camera: Camera): { id: string; screen: Pt } | null {
    const s = editor.get();
    if (s.selection.length !== 1 || board.get().editing) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (node?.jam?.kind !== "shape" || !node.text || node.locked) return null;
    const layer = textLayerFor(node);
    if (!layer || layoutText(layer).height <= shapeTextBox(node).h + 1) return null;
    const box = worldBounds(s.doc, node);
    const at = worldToScreen(camera, box.x + box.w / 2, box.y + box.h);
    // Just inside the bottom edge, clear of the quick-create dot below it.
    return { id: node.id, screen: { x: at.x, y: at.y - 12 } };
}

// Grows a shape until all its text shows.
function revealText(id: string) {
    const node = editor.get().doc.nodes[id];
    if (node?.jam?.kind !== "shape") return;
    const layer = textLayerFor(node);
    if (!layer) return;
    const need = layoutText(layer).height;
    let h = node.h;
    for (let i = 0; i < 400 && shapeTextBox({ ...node, h }).h < need; i++) h += 4;
    editor.execute({ type: "node.update", id, patch: { h, path: shapePath(node.jam.shape, node.w, h) } });
}

// Smart selection: when the selected layers sit in a row, a column or a grid with
// equal spacing, pink handles appear in the gaps and a dot on each layer. Dragging a gap handle
// changes every gap at once; dragging a layer's dot moves it to another place in the arrangement,
// and the others close up around it.
import { screenToWorld, worldToScreen } from "../engine/camera";
import { applyCommand } from "../engine/commands";
import { topLevel } from "../engine/nodes";
import { editor } from "../engine/store";
import { applyVector, isAxisAligned, spaceMatrix, worldBounds } from "../engine/transform";
import type { Camera, Command, NagmaDocument, Rect } from "../engine/types";

export const SMART_COLOR = "#E5409A";
const TOLERANCE = 1;

export interface SmartArrangement {
    // Row-major: rows top to bottom, each left to right. A row is one row; a column is rows of one.
    rows: string[][];
    // The equal horizontal gap between neighbours in a row, and vertical gap between rows.
    colGap: number | null;
    rowGap: number | null;
    boxes: Record<string, Rect>;
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

let cache: { doc: NagmaDocument; selection: string[]; result: SmartArrangement | null } | null = null;

// The arrangement of the selection, or null when it isn't evenly spaced (or can't be moved freely).
export function smartArrangement(doc: NagmaDocument, selection: string[]): SmartArrangement | null {
    if (cache && cache.doc === doc && cache.selection === selection) return cache.result;
    const result = detect(doc, selection);
    cache = { doc, selection, result };
    return result;
}

function detect(doc: NagmaDocument, selection: string[]): SmartArrangement | null {
    const ids = topLevel(doc, selection);
    if (ids.length < 2) return null;
    const parentId = doc.nodes[ids[0] ?? ""]?.parentId ?? null;
    const parent = parentId ? doc.nodes[parentId] : undefined;
    // Layers stacked by auto layout are spaced by their frame, not by hand.
    if (parent?.layout) return null;
    const boxes: Record<string, Rect> = {};
    for (const id of ids) {
        const node = doc.nodes[id];
        if (!node || node.parentId !== parentId || node.locked || node.sourceId || !isAxisAligned(doc, node) || node.positioning === "absolute") return null;
        boxes[id] = worldBounds(doc, node);
    }
    const box = (id: string) => boxes[id] as Rect;
    // Rows: layers whose vertical extents overlap, top to bottom; each row left to right.
    const byTop = [...ids].sort((a, b) => box(a).y - box(b).y);
    const rows: string[][] = [];
    let band: { top: number; bottom: number } | null = null;
    for (const id of byTop) {
        const b = box(id);
        if (band && b.y < band.bottom - TOLERANCE) {
            rows[rows.length - 1]?.push(id);
            band.bottom = Math.max(band.bottom, b.y + b.h);
        } else {
            rows.push([id]);
            band = { top: b.y, bottom: b.y + b.h };
        }
    }
    for (const row of rows) row.sort((a, b) => box(a).x - box(b).x);
    const columns = rows[0]?.length ?? 0;
    if (rows.some((row) => row.length !== columns)) return null;
    // Neighbours in a row may not overlap, and every gap must be the same.
    let colGap: number | null = null;
    for (const row of rows) {
        for (let i = 1; i < row.length; i++) {
            const a = box(row[i - 1] ?? "");
            const b = box(row[i] ?? "");
            const gap = b.x - (a.x + a.w);
            if (gap < -TOLERANCE) return null;
            if (colGap === null) colGap = gap;
            else if (!near(gap, colGap)) return null;
        }
    }
    let rowGap: number | null = null;
    for (let r = 1; r < rows.length; r++) {
        const above = rows[r - 1] ?? [];
        const below = rows[r] ?? [];
        const bottom = Math.max(...above.map((id) => box(id).y + box(id).h));
        const top = Math.min(...below.map((id) => box(id).y));
        const gap = top - bottom;
        if (gap < -TOLERANCE) return null;
        if (rowGap === null) rowGap = gap;
        else if (!near(gap, rowGap)) return null;
    }
    // A grid's columns line up: the same left edge down each column.
    if (rows.length > 1 && columns > 1) {
        for (let c = 0; c < columns; c++) {
            const left = box(rows[0]?.[c] ?? "").x;
            if (rows.some((row) => !near(box(row[c] ?? "").x, left))) return null;
        }
        for (const row of rows) {
            const top = box(row[0] ?? "").y;
            if (row.some((id) => !near(box(id).y, top))) return null;
        }
    }
    return { rows, colGap, rowGap, boxes };
}

// Where each layer goes for an order (row-major) and gaps. Columns are as wide as their widest
// layer and rows as tall as their tallest, starting from the arrangement's top-left; a single row
// keeps each layer's own vertical position, and a single column its horizontal one.
export function layoutCommand(doc: NagmaDocument, arrangement: SmartArrangement, order: string[], colGap: number, rowGap: number): Command {
    const { boxes } = arrangement;
    const rows = arrangement.rows.length;
    const columns = arrangement.rows[0]?.length ?? 1;
    const box = (id: string | undefined) => boxes[id ?? ""] ?? { x: 0, y: 0, w: 0, h: 0 };
    const all = order.map(box);
    const startX = Math.min(...all.map((b) => b.x));
    const startY = Math.min(...all.map((b) => b.y));
    const cell = (r: number, c: number) => order[r * columns + c];
    const xs: number[] = [];
    let x = startX;
    for (let c = 0; c < columns; c++) {
        xs.push(x);
        let width = 0;
        for (let r = 0; r < rows; r++) width = Math.max(width, box(cell(r, c)).w);
        x += width + colGap;
    }
    const ys: number[] = [];
    let y = startY;
    for (let r = 0; r < rows; r++) {
        ys.push(y);
        let height = 0;
        for (let c = 0; c < columns; c++) height = Math.max(height, box(cell(r, c)).h);
        y += height + rowGap;
    }
    const commands: Command[] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
            const id = cell(r, c);
            const node = id ? doc.nodes[id] : undefined;
            if (!id || !node) continue;
            const b = box(id);
            const tx = columns === 1 ? b.x : (xs[c] ?? b.x);
            const ty = rows === 1 ? b.y : (ys[r] ?? b.y);
            const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), tx - b.x, ty - b.y);
            if (Math.abs(d.x) > 1e-6 || Math.abs(d.y) > 1e-6) commands.push({ type: "node.move", ids: [id], dx: d.x, dy: d.y });
        }
    }
    return { type: "batch", commands };
}

// Gap handles in screen space: the middle of each gap, and which axis it spaces.
export interface GapHandle {
    axis: "x" | "y";
    x: number;
    y: number;
    // Screen length of the gap, for the drawn line.
    span: number;
}

export function gapHandles(arrangement: SmartArrangement, camera: Camera): GapHandle[] {
    const { boxes, rows } = arrangement;
    const out: GapHandle[] = [];
    for (const row of rows) {
        for (let i = 1; i < row.length; i++) {
            const a = boxes[row[i - 1] ?? ""];
            const b = boxes[row[i] ?? ""];
            if (!a || !b) continue;
            const top = Math.max(a.y, b.y);
            const bottom = Math.min(a.y + a.h, b.y + b.h);
            const p = worldToScreen(camera, (a.x + a.w + b.x) / 2, (top + bottom) / 2);
            out.push({ axis: "x", x: p.x, y: p.y, span: (bottom - top) * camera.zoom });
        }
    }
    const columns = rows[0]?.length ?? 0;
    for (let r = 1; r < rows.length; r++) {
        for (let c = 0; c < columns; c++) {
            const a = boxes[rows[r - 1]?.[c] ?? ""];
            const b = boxes[rows[r]?.[c] ?? ""];
            if (!a || !b) continue;
            const left = Math.max(a.x, b.x);
            const right = Math.min(a.x + a.w, b.x + b.w);
            const p = worldToScreen(camera, (left + right) / 2, (a.y + a.h + b.y) / 2);
            out.push({ axis: "y", x: p.x, y: p.y, span: (right - left) * camera.zoom });
        }
    }
    return out;
}

// The dot on each layer, in screen space.
export function centerDots(arrangement: SmartArrangement, camera: Camera): { id: string; x: number; y: number }[] {
    return arrangement.rows.flat().flatMap((id) => {
        const b = arrangement.boxes[id];
        if (!b || b.w * camera.zoom < 16 || b.h * camera.zoom < 16) return [];
        const p = worldToScreen(camera, b.x + b.w / 2, b.y + b.h / 2);
        return [{ id, x: p.x, y: p.y }];
    });
}

type SmartHit = { kind: "gap"; axis: "x" | "y" } | { kind: "dot"; id: string };

export function hitSmart(doc: NagmaDocument, selection: string[], camera: Camera, sx: number, sy: number): SmartHit | null {
    const arrangement = smartArrangement(doc, selection);
    if (!arrangement) return null;
    for (const h of gapHandles(arrangement, camera)) {
        const along = h.axis === "x" ? Math.abs(sy - h.y) : Math.abs(sx - h.x);
        const across = h.axis === "x" ? Math.abs(sx - h.x) : Math.abs(sy - h.y);
        if (across <= 4 && along <= Math.max(6, Math.min(h.span / 2, 10))) return { kind: "gap", axis: h.axis };
    }
    for (const d of centerDots(arrangement, camera)) if (Math.hypot(d.x - sx, d.y - sy) <= 6) return { kind: "dot", id: d.id };
    return null;
}

// The drag in progress (the canvas view hands its pointer events here while one is active).
interface SmartDrag {
    hit: SmartHit;
    base: NagmaDocument;
    arrangement: SmartArrangement;
    start: { x: number; y: number };
    moved: boolean;
}
let drag: SmartDrag | null = null;
// While dragging a dot: where it is (world) and the slot it would land in, for drawing.
export const smartDragView = { dot: null as { id: string; x: number; y: number } | null, gapLabel: null as { x: number; y: number; text: string } | null };

export function smartDragging(): boolean {
    return drag !== null;
}

export function smartPointerDown(screen: { x: number; y: number }): boolean {
    const s = editor.get();
    if (s.readOnly || s.mode === "dev" || s.tool !== "move") return false;
    const hit = hitSmart(s.doc, s.selection, s.camera, screen.x, screen.y);
    const arrangement = smartArrangement(s.doc, s.selection);
    if (!hit || !arrangement) return false;
    drag = { hit, base: s.doc, arrangement, start: screenToWorld(s.camera, screen.x, screen.y), moved: false };
    return true;
}

function result(world: { x: number; y: number }, shift: boolean): Command | null {
    if (!drag) return null;
    const { arrangement, hit, base, start } = drag;
    const order = arrangement.rows.flat();
    let colGap = arrangement.colGap ?? 0;
    let rowGap = arrangement.rowGap ?? 0;
    if (hit.kind === "gap") {
        const delta = hit.axis === "x" ? world.x - start.x : world.y - start.y;
        const raw = (hit.axis === "x" ? colGap : rowGap) + delta;
        const step = shift ? 10 : 1;
        const next = Math.max(0, Math.round(raw / step) * step);
        if (hit.axis === "x") colGap = next;
        else rowGap = next;
        const label = { x: world.x, y: world.y, text: String(next) };
        smartDragView.gapLabel = label;
        return layoutCommand(base, arrangement, order, colGap, rowGap);
    }
    // Dot: the layer goes to the slot whose centre is nearest the pointer.
    const slots = order.map((id) => arrangement.boxes[id] as Rect);
    let best = 0;
    let bestDistance = Infinity;
    slots.forEach((b, i) => {
        const d = Math.hypot(b.x + b.w / 2 - world.x, b.y + b.h / 2 - world.y);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    });
    const next = order.filter((id) => id !== hit.id);
    next.splice(best, 0, hit.id);
    smartDragView.dot = { id: hit.id, x: world.x, y: world.y };
    return layoutCommand(base, arrangement, next, colGap, rowGap);
}

export function smartPointerMove(world: { x: number; y: number }, shift: boolean) {
    if (!drag) return;
    const zoom = editor.get().camera.zoom;
    if (!drag.moved && Math.hypot(world.x - drag.start.x, world.y - drag.start.y) * zoom < 3) return;
    drag.moved = true;
    const command = result(world, shift);
    if (command) editor.preview(applyCommand(drag.base, command));
}

export function smartPointerUp(world: { x: number; y: number }, shift: boolean) {
    if (!drag) return;
    const current = drag;
    const command = current.moved ? result(world, shift) : null;
    drag = null;
    smartDragView.dot = null;
    smartDragView.gapLabel = null;
    if (command && command.type === "batch" && command.commands.length) editor.execute(command, current.base);
    else editor.preview(current.base);
}

export function smartCursor(hit: SmartHit): string {
    return hit.kind === "dot" ? "grab" : hit.axis === "x" ? "ew-resize" : "ns-resize";
}

// Pink gap handles and layer dots over an evenly spaced selection.
export function drawSmartSelection(ctx: CanvasRenderingContext2D, doc: NagmaDocument, selection: string[], camera: Camera) {
    const arrangement = smartArrangement(doc, selection);
    if (!arrangement && !drag) return;
    const shown = drag ? (smartArrangement(doc, selection) ?? drag.arrangement) : arrangement;
    if (!shown) return;
    ctx.save();
    if (!drag || drag.hit.kind === "gap") {
        for (const h of gapHandles(shown, camera)) {
            const half = Math.max(4, Math.min(h.span / 2 - 2, 8));
            ctx.strokeStyle = SMART_COLOR;
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            ctx.beginPath();
            if (h.axis === "x") {
                ctx.moveTo(h.x, h.y - half);
                ctx.lineTo(h.x, h.y + half);
            } else {
                ctx.moveTo(h.x - half, h.y);
                ctx.lineTo(h.x + half, h.y);
            }
            ctx.stroke();
        }
    }
    for (const d of centerDots(shown, camera)) {
        if (drag?.hit.kind === "dot" && drag.hit.id === d.id) continue;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.strokeStyle = SMART_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    if (smartDragView.dot) {
        const p = worldToScreen(camera, smartDragView.dot.x, smartDragView.dot.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = SMART_COLOR;
        ctx.fill();
    }
    if (smartDragView.gapLabel) {
        const p = worldToScreen(camera, smartDragView.gapLabel.x, smartDragView.gapLabel.y);
        const text = smartDragView.gapLabel.text;
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = SMART_COLOR;
        ctx.beginPath();
        ctx.roundRect(p.x + 10, p.y + 10, w, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.textBaseline = "middle";
        ctx.fillText(text, p.x + 15, p.y + 19.5);
    }
    ctx.restore();
}

import type { AutoLayout, GridTrack, SceneNode } from "./types";

// Grid auto layout like the reference's: columns and rows sized fixed, fill (fr) or hug; children placed
// at their chosen cell or automatically (left to right, top to bottom, into the first free area
// their span fits), spanning several tracks, aligned inside their area.

type Grid = NonNullable<AutoLayout["grid"]>;

export interface Placement {
    node: SceneNode;
    col: number;
    row: number;
    colSpan: number;
    rowSpan: number;
}

export interface GridPlan {
    placements: Placement[];
    cols: number[];
    rows: number[];
    colStarts: number[];
    rowStarts: number[];
    // Content size (tracks and gaps, no padding).
    width: number;
    height: number;
}

// Whether the grid uses anything beyond equal cells (so older files keep their exact layout).
export function isAdvancedGrid(grid: Grid, children: SceneNode[]): boolean {
    return Boolean(grid.columnSizes?.length || grid.rowSizes?.length || grid.autoTracks || grid.itemsPositioning === "manual" || children.some((c) => c.gridPosition || c.gridSpan || (c.gridAlign && (c.gridAlign.h !== "auto" || c.gridAlign.v !== "auto"))));
}

export function placeChildren(grid: Grid, children: SceneNode[]): { placements: Placement[]; rowCount: number; colCount: number } {
    const colCount = Math.max(1, Math.round(grid.columns));
    const taken: boolean[][] = [];
    const free = (col: number, row: number, cs: number, rs: number) => {
        if (col + cs > colCount) return false;
        for (let r = row; r < row + rs; r++) for (let c = col; c < col + cs; c++) if (taken[r]?.[c]) return false;
        return true;
    };
    const take = (col: number, row: number, cs: number, rs: number) => {
        for (let r = row; r < row + rs; r++) {
            taken[r] ??= [];
            for (let c = col; c < col + cs; c++) (taken[r] as boolean[])[c] = true;
        }
    };
    const placements: Placement[] = [];
    const span = (c: SceneNode) => ({ cs: Math.max(1, Math.min(colCount, Math.round(c.gridSpan?.col ?? 1))), rs: Math.max(1, Math.round(c.gridSpan?.row ?? 1)) });
    // Children with a chosen cell go first; the rest flow around them.
    for (const c of children) {
        if (!c.gridPosition) continue;
        const { cs, rs } = span(c);
        const col = Math.max(0, Math.min(colCount - cs, Math.round(c.gridPosition.col)));
        const row = Math.max(0, Math.round(c.gridPosition.row));
        take(col, row, cs, rs);
        placements.push({ node: c, col, row, colSpan: cs, rowSpan: rs });
    }
    let cursor = 0;
    // Manual positioning keeps children in reading order after the last placed cell (no filling of
    // gaps left behind); automatic positioning drops each one into the first free area it fits.
    const manual = grid.itemsPositioning === "manual";
    for (const c of children) {
        if (c.gridPosition) continue;
        const { cs, rs } = span(c);
        let at = cursor;
        if (manual) at = Math.max(at, placements.reduce((n, p) => Math.max(n, p.row * colCount + p.col + 1), 0));
        while (!free(at % colCount, Math.floor(at / colCount), cs, rs)) at++;
        const col = at % colCount;
        const row = Math.floor(at / colCount);
        take(col, row, cs, rs);
        placements.push({ node: c, col, row, colSpan: cs, rowSpan: rs });
        cursor = at + 1;
    }
    const used = placements.reduce((n, p) => Math.max(n, p.row + p.rowSpan), 0);
    return { placements, rowCount: Math.max(grid.rows ?? 0, used, 1), colCount };
}

// Track sizes along one axis. `inner` is the room inside the padding, or null when the frame hugs
// (fill tracks then hug too).
function sizeTracks(count: number, specs: GridTrack[] | undefined, gap: number, inner: number | null, items: { start: number; span: number; size: number; fills: boolean }[], auto?: GridTrack): number[] {
    const spec = (i: number): GridTrack => {
        const s = specs?.[i] ?? auto;
        if (s) return inner === null && s.type === "fill" ? { type: "hug", value: 0 } : s;
        return inner === null ? { type: "hug", value: 0 } : { type: "fill", value: 1 };
    };
    const sizes = Array.from({ length: count }, (_, i) => {
        const s = spec(i);
        return s.type === "fixed" ? Math.max(0, s.value) : 0;
    });
    // Hug tracks take their biggest single-track child, then spanning children top up the hug
    // tracks they cover.
    for (const it of items) {
        if (it.span !== 1 || it.fills) continue;
        if (spec(it.start).type === "hug") sizes[it.start] = Math.max(sizes[it.start] ?? 0, it.size);
    }
    for (const it of items) {
        if (it.span === 1 || it.fills) continue;
        const range = Array.from({ length: it.span }, (_, k) => it.start + k).filter((i) => i < count);
        const hugs = range.filter((i) => spec(i).type === "hug");
        if (!hugs.length) continue;
        const have = range.reduce((sum, i) => sum + (sizes[i] ?? 0), 0) + (range.length - 1) * gap;
        const extra = it.size - have;
        if (extra > 0) for (const i of hugs) sizes[i] = (sizes[i] ?? 0) + extra / hugs.length;
    }
    if (inner !== null) {
        const fills = sizes.map((_, i) => spec(i)).map((s) => (s.type === "fill" ? Math.max(0, s.value || 1) : 0));
        const fr = fills.reduce((a, b) => a + b, 0);
        if (fr > 0) {
            const used = sizes.reduce((a, b, i) => a + (fills[i] ? 0 : b), 0) + Math.max(0, count - 1) * gap;
            const room = Math.max(0, inner - used);
            fills.forEach((f, i) => {
                if (f) sizes[i] = (room * f) / fr;
            });
        }
    }
    return sizes;
}

function starts(sizes: number[], gap: number): number[] {
    const out: number[] = [];
    let at = 0;
    for (const s of sizes) {
        out.push(at);
        at += s + gap;
    }
    return out;
}

export function planGrid(grid: Grid, children: SceneNode[], innerW: number | null, innerH: number | null): GridPlan {
    const { placements, rowCount, colCount } = placeChildren(grid, children);
    const cols = sizeTracks(
        colCount,
        grid.columnSizes,
        grid.columnGap,
        innerW,
        placements.map((p) => ({ start: p.col, span: p.colSpan, size: p.node.w, fills: p.node.sizing.h === "fill" })),
        grid.autoTracks,
    );
    const rows = sizeTracks(
        rowCount,
        grid.rowSizes,
        grid.rowGap,
        innerH,
        placements.map((p) => ({ start: p.row, span: p.rowSpan, size: p.node.h, fills: p.node.sizing.v === "fill" })),
        grid.autoTracks,
    );
    const sum = (a: number[], gap: number) => a.reduce((x, y) => x + y, 0) + Math.max(0, a.length - 1) * gap;
    return { placements, cols, rows, colStarts: starts(cols, grid.columnGap), rowStarts: starts(rows, grid.rowGap), width: sum(cols, grid.columnGap), height: sum(rows, grid.rowGap) };
}

// The area a placement covers, relative to the content's top-left.
export function areaOf(plan: GridPlan, p: Placement): { x: number; y: number; w: number; h: number } {
    const x = plan.colStarts[p.col] ?? 0;
    const y = plan.rowStarts[p.row] ?? 0;
    const lastCol = Math.min(plan.cols.length - 1, p.col + p.colSpan - 1);
    const lastRow = Math.min(plan.rows.length - 1, p.row + p.rowSpan - 1);
    const w = (plan.colStarts[lastCol] ?? 0) + (plan.cols[lastCol] ?? 0) - x;
    const h = (plan.rowStarts[lastRow] ?? 0) + (plan.rows[lastRow] ?? 0) - y;
    return { x, y, w, h };
}

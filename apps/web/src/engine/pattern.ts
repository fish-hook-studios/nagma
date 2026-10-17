import type { PatternPaint } from "./types";

// How a pattern paint's tiles repeat: one cell (the tile plus spacing), and the repeating block
// that holds the stagger for hexagonal layouts with the tile copies inside it.

export interface PatternGrid {
    tileW: number;
    tileH: number;
    blockW: number;
    blockH: number;
    // Where each tile copy sits inside the block (including pieces wrapping in from neighbours).
    copies: { x: number; y: number }[];
    // The block's origin for a box (alignment moves the first tile horizontally).
    origin: (box: { x: number; y: number; w: number; h: number }) => { x: number; y: number };
}

export function patternGrid(paint: PatternPaint, source: { w: number; h: number }): PatternGrid | null {
    const scale = Math.max(0.01, paint.scale || 1);
    const tileW = source.w * scale;
    const tileH = source.h * scale;
    if (tileW < 0.01 || tileH < 0.01) return null;
    const cellW = Math.max(0.01, tileW + paint.spacing.x);
    const cellH = Math.max(0.01, tileH + paint.spacing.y);
    let blockW = cellW;
    let blockH = cellH;
    let copies = [{ x: 0, y: 0 }];
    if (paint.tile === "horizontal-hex") {
        // Every other row shifts by half a cell.
        blockH = cellH * 2;
        copies = [{ x: 0, y: 0 }, { x: cellW / 2, y: cellH }, { x: -cellW / 2, y: cellH }];
    } else if (paint.tile === "vertical-hex") {
        // Every other column shifts by half a cell.
        blockW = cellW * 2;
        copies = [{ x: 0, y: 0 }, { x: cellW, y: cellH / 2 }, { x: cellW, y: -cellH / 2 }];
    }
    // A tile can cross the block's edge (spacing below zero, or the hexagonal stagger), so every
    // copy is drawn again one block over in each direction; the block clips what falls outside.
    copies = copies.flatMap((c) => [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => ({ x: c.x + i * blockW, y: c.y + j * blockH })))).filter((c, i, all) => c.x < blockW && c.x + tileW > 0 && c.y < blockH && c.y + tileH > 0 && all.findIndex((d) => Math.abs(d.x - c.x) < 1e-6 && Math.abs(d.y - c.y) < 1e-6) === i);
    const origin = (box: { x: number; y: number; w: number; h: number }) => ({
        x: paint.align === "center" ? box.x + box.w / 2 - tileW / 2 : paint.align === "end" ? box.x + box.w - tileW : box.x,
        y: box.y,
    });
    return { tileW, tileH, blockW, blockH, copies, origin };
}

export function patternPaint(sourceId: string): PatternPaint {
    return { type: "pattern", sourceId, tile: "rectangular", scale: 1, spacing: { x: 0, y: 0 }, align: "start", opacity: 1, visible: true, blend: "normal" };
}

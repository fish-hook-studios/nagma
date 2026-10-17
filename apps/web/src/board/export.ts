import { renderRegion } from "../canvas/export-render";
import { download, safeName } from "../engine/export";
import { selectionBounds } from "../engine/nodes";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { STICKY_COLORS } from "./model";

// Exporting a board: the whole board or the selection as a PNG, JPG or PDF picture (on the board's
// colour, its dot grid, or nothing), and stickies or tables as CSV.

export type BoardExportFormat = "png" | "jpg" | "pdf" | "csv";
// What the picture is drawn on: the board's colour, nothing (PNG and PDF), or the board's dot grid.
export type BoardExportBackground = "solid" | "transparent" | "grid";

const PAD = 40;

function pageOf(doc: NagmaDocument): SceneNode | undefined {
    return doc.nodes[editor.get().pageId];
}

// The area to draw: the selection, or everything on the page, with a margin.
function region(doc: NagmaDocument, selection: boolean) {
    const ids = selection ? editor.get().selection : (pageOf(doc)?.children ?? []);
    const box = selectionBounds(doc, ids);
    if (!box) return null;
    return { x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 };
}

// The board's picture at `scale`, on the board's colour (with its dot grid), or on nothing.
async function picture(doc: NagmaDocument, selection: boolean, scale: number, format: "png" | "jpeg", background: BoardExportBackground = "solid"): Promise<{ blob: Blob; w: number; h: number } | null> {
    const rect = region(doc, selection);
    const page = pageOf(doc);
    if (!rect || !page) return null;
    const fill = page.fills.find((p) => p.visible && p.type === "solid");
    const bg = fill && fill.type === "solid" ? fill.color : "#FFFFFF";
    const shot = await renderRegion(doc, page.id, rect, scale, "png");
    if (!shot) return null;
    // Lay the drawing over the board colour.
    const bitmap = await createImageBitmap(shot);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (background !== "transparent" || format === "jpeg") {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (background === "grid") {
        // One dot every 24 units, lined up with the board's own grid.
        const step = 24 * scale;
        const r = Math.max(1, scale);
        ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
        const ox = (((-rect.x * scale) % step) + step) % step;
        const oy = (((-rect.y * scale) % step) + step) % step;
        for (let x = ox; x < canvas.width; x += step) for (let y = oy; y < canvas.height; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, 0.92));
    return blob ? { blob, w: rect.w, h: rect.h } : null;
}

function csvCell(text: string): string {
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: string[][]): string {
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// The stickies (in the selection, or on the page) as rows: text, author, colour and section.
export function stickiesCsv(doc: NagmaDocument, ids: string[] | null): string[][] {
    const pageId = editor.get().pageId;
    const within = (n: SceneNode): boolean => {
        let p: SceneNode | undefined = n;
        while (p) {
            if (p.id === pageId) return true;
            p = p.parentId ? doc.nodes[p.parentId] : undefined;
        }
        return false;
    };
    const pick = ids ? new Set(ids) : null;
    const stickies = Object.values(doc.nodes).filter((n) => n.jam?.kind === "sticky" && (pick ? pick.has(n.id) || (n.parentId !== null && pick.has(n.parentId)) : within(n)));
    stickies.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [["Sticky text", "Author", "Color", "Section"]];
    for (const n of stickies) {
        const fill = n.fills.find((p) => p.type === "solid");
        const hex = fill && fill.type === "solid" ? fill.color.toUpperCase() : "";
        const color = STICKY_COLORS.find((c) => c.color.toUpperCase() === hex)?.name ?? hex;
        const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
        const author = n.jam?.kind === "sticky" ? (n.jam.author ?? "") : "";
        rows.push([n.text ?? "", author, color, parent?.isSection ? parent.name : ""]);
    }
    return rows;
}

export function tableCsv(node: SceneNode): string[][] | null {
    return node.jam?.kind === "table" ? node.jam.cells.map((r) => [...r]) : null;
}

// What a CSV export holds for the current selection: a lone table's cells, or the stickies.
export function csvFor(doc: NagmaDocument, selection: boolean): { rows: string[][]; name: string } {
    const ids = selection ? editor.get().selection : null;
    const lone = ids && ids.length === 1 ? doc.nodes[ids[0] ?? ""] : undefined;
    const table = lone ? tableCsv(lone) : null;
    if (table && lone) return { rows: table, name: lone.name };
    return { rows: stickiesCsv(doc, ids), name: `${doc.name || "Board"} stickies` };
}

export async function exportBoard(format: BoardExportFormat, selection: boolean, scale: number, background: BoardExportBackground = "solid"): Promise<boolean> {
    const doc = editor.get().doc;
    const name = safeName(doc.name || "Board");
    if (format === "csv") {
        const { rows, name: csvName } = csvFor(doc, selection);
        if (rows.length <= 1 && rows[0]?.[0] === "Sticky text") {
            editor.notify("No stickies or tables to export.");
            return false;
        }
        download(new Blob([`﻿${toCsv(rows)}`], { type: "text/csv" }), `${safeName(csvName)}.csv`);
        return true;
    }
    if (format === "pdf") {
        const shot = await picture(doc, selection, scale, "png", background);
        if (!shot) return false;
        const { jsPDF } = await import("jspdf");
        const size: [number, number] = [shot.w, shot.h];
        // Compressed (losslessly): without it the board picture went in as raw pixels (3.4 MB for a
        // handful of objects).
        const pdf = new jsPDF({ unit: "pt", format: size, orientation: size[0] > size[1] ? "landscape" : "portrait", compress: true });
        const url = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(shot.blob);
        });
        pdf.addImage(url, "PNG", 0, 0, size[0], size[1]);
        download(pdf.output("blob"), `${name}.pdf`);
        return true;
    }
    const shot = await picture(doc, selection, scale, format === "jpg" ? "jpeg" : "png", background);
    if (!shot) return false;
    download(shot.blob, `${name}${scale === 1 ? "" : `@${scale}x`}.${format}`);
    return true;
}

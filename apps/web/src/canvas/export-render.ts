import { activePage } from "../engine/page";
import { setPaintSpace } from "../engine/paint";
import type { NagmaDocument, Rect } from "../engine/types";
import { type RasterOptions, drawRoots, rasterContext } from "./render";

// Renders everything on a page within a world rectangle: what a slice exports, and exports that
// aren't "contents only". Slices themselves draw nothing, so only what lies under them shows.
export async function renderRegion(doc: NagmaDocument, pageId: string, rect: Rect, scale: number, format: "png" | "jpeg" = "png", options: RasterOptions = {}): Promise<Blob | null> {
    const width = Math.max(1, Math.min(8192, Math.round(rect.w * scale)));
    const height = Math.max(1, Math.min(8192, Math.round(rect.h * scale)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = rasterContext(canvas, options);
    if (!ctx) return null;
    setPaintSpace(doc.colorProfile === "p3" ? "p3" : "srgb");
    if (format === "jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
    }
    ctx.scale(width / rect.w, height / rect.h);
    ctx.translate(-rect.x, -rect.y);
    // drawRoots draws the active page; point it at the slice's page for the moment.
    const previous = activePage.id;
    activePage.id = pageId;
    try {
        drawRoots(ctx, doc, { editingTextId: null, pixelScale: scale });
    } finally {
        activePage.id = previous;
    }
    return new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, options.quality ?? 0.92));
}

import { drawNode } from "../canvas/render";
import { selectionBounds } from "./nodes";
import type { NagmaDocument } from "./types";

// A small picture of a document's first page (or one chosen frame), for file cards on Home.
export function renderThumb(doc: NagmaDocument, width = 320, height = 200, only?: string): string {
    const page = doc.nodes[doc.roots[0] ?? ""];
    // A slides file shows its first slide.
    const firstSlide = doc.slides ? page?.children.find((id) => doc.nodes[id]?.deck?.kind === "slide") : undefined;
    const ids = only && doc.nodes[only] ? [only] : firstSlide ? [firstSlide] : (page?.children ?? []);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = doc.board ? "#FFFFFF" : "#2A2A2E";
    ctx.fillRect(0, 0, width, height);
    const box = ids.length ? selectionBounds(doc, ids) : null;
    if (!box) return canvas.toDataURL("image/jpeg", 0.8);
    const pad = firstSlide && !only ? 0 : 16;
    const scale = Math.min((width - pad * 2) / Math.max(box.w, 1), (height - pad * 2) / Math.max(box.h, 1));
    ctx.translate((width - box.w * scale) / 2, (height - box.h * scale) / 2);
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    for (const id of ids) {
        const node = doc.nodes[id];
        if (node) drawNode(ctx, doc, node, { editingTextId: null, pixelScale: scale });
    }
    return canvas.toDataURL("image/jpeg", 0.8);
}

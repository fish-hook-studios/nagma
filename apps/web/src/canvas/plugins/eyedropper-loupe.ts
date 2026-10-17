import { editor } from "../../engine/store";
import { registerCanvasPlugin } from "../canvas-plugins";

// The eyedropper's magnifier: while picking a colour (the I tool, ⌃C, or a colour picker's
// eyedropper), a round loupe follows the pointer with the pixels under it enlarged, the one that
// will be picked outlined, and its hex value below.

const GRID = 11;
const CELL = 10;

const loupe: { at: { x: number; y: number } | null } = { at: null };

function picking(): boolean {
    const s = editor.get();
    return s.tool === "eyedropper" || s.pickColorInto !== null;
}

registerCanvasPlugin({
    name: "eyedropper-loupe",
    hover(p) {
        if (!picking()) {
            loupe.at = null;
            return undefined;
        }
        loupe.at = p.screen;
        editor.set({});
        return "none";
    },
    overlay(ctx) {
        const at = loupe.at;
        if (!at || !picking()) return;
        const dpr = ctx.getTransform().a || 1;
        const half = Math.floor(GRID / 2);
        let data: Uint8ClampedArray;
        try {
            data = ctx.getImageData(Math.round(at.x * dpr) - half, Math.round(at.y * dpr) - half, GRID, GRID).data;
        } catch {
            return;
        }
        const size = GRID * CELL;
        const x = at.x - size / 2;
        const y = at.y - size / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(at.x, at.y, size / 2, 0, Math.PI * 2);
        ctx.clip();
        for (let row = 0; row < GRID; row++) {
            for (let col = 0; col < GRID; col++) {
                const i = (row * GRID + col) * 4;
                ctx.fillStyle = `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`;
                ctx.fillRect(x + col * CELL, y + row * CELL, CELL, CELL);
            }
        }
        // A faint pixel grid.
        ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
        ctx.lineWidth = 1;
        for (let k = 1; k < GRID; k++) {
            ctx.beginPath();
            ctx.moveTo(x + k * CELL, y);
            ctx.lineTo(x + k * CELL, y + size);
            ctx.moveTo(x, y + k * CELL);
            ctx.lineTo(x + size, y + k * CELL);
            ctx.stroke();
        }
        ctx.restore();
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(at.x, at.y, size / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.arc(at.x, at.y, size / 2 + 1.5, 0, Math.PI * 2);
        ctx.stroke();
        // The pixel that will be picked.
        const c = (half * GRID + half) * 4;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.strokeRect(at.x - CELL / 2, at.y - CELL / 2, CELL, CELL);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(at.x - CELL / 2 - 1.5, at.y - CELL / 2 - 1.5, CELL + 3, CELL + 3);
        const hex = `#${[data[c], data[c + 1], data[c + 2]].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const w = ctx.measureText(hex).width + 14;
        ctx.fillStyle = "rgba(30, 30, 30, 0.92)";
        ctx.beginPath();
        ctx.roundRect(at.x - w / 2, at.y + size / 2 + 8, w, 20, 6);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(hex, at.x, at.y + size / 2 + 18);
        ctx.restore();
    },
});

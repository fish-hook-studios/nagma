import { worldToScreen } from "../../engine/camera";
import { cancelPlace, nextSize, placeInto, placeNext } from "../../engine/place";
import { editor } from "../../engine/store";
import { vectorUi } from "../../engine/vector-ui";
import { addKeyHandler } from "../../hooks/use-vector-shortcuts";
import { type PluginPointer, HANDLE_BLUE, registerCanvasPlugin } from "../canvas-plugins";
import { hitTest } from "../hit-test";

// Placing images and videos: the cursor carries a badge with the next file's thumbnail and the
// number left. Click places it at its natural size, a drag sizes it (keeping its proportions), a
// click on a shape makes it that shape's fill. Escape stops.

const thumbs = new Map<string, HTMLImageElement>();

function thumbImage(src: string | null): HTMLImageElement | null {
    if (!src) return null;
    let img = thumbs.get(src);
    if (!img) {
        img = new Image();
        img.onload = () => editor.set({});
        img.src = src;
        thumbs.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}

let pointer: { x: number; y: number } | null = null;
let drag: { start: { x: number; y: number }; startScreen: { x: number; y: number }; box: { x: number; y: number; w: number; h: number } | null } | null = null;

function placing(): boolean {
    return vectorUi.get().place.length > 0;
}

function sized(p: PluginPointer) {
    if (!drag) return null;
    const ratio = (() => {
        const n = nextSize();
        return n ? n.w / n.h : null;
    })();
    let w = p.world.x - drag.start.x;
    let h = p.world.y - drag.start.y;
    if (ratio) {
        // Keep the image's proportions, following the larger movement.
        if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h || 1) * Math.abs(w)) / ratio;
        else w = Math.sign(w || 1) * Math.abs(h) * ratio;
    }
    return { x: Math.min(drag.start.x, drag.start.x + w), y: Math.min(drag.start.y, drag.start.y + h), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) };
}

registerCanvasPlugin({
    name: "place",
    down(p) {
        if (!placing()) return false;
        drag = { start: p.world, startScreen: p.screen, box: null };
        return true;
    },
    move(p) {
        pointer = p.screen;
        if (!drag) return;
        if (Math.hypot(p.screen.x - drag.startScreen.x, p.screen.y - drag.startScreen.y) > 3) drag.box = sized(p);
        editor.set({});
    },
    up(p) {
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.box) {
            void placeNext(d.start, sized({ ...p }) ?? d.box);
            return;
        }
        // A click on a shape fills it with the image.
        const s = editor.get();
        const hit = hitTest(s.doc, p.world.x, p.world.y, true);
        if (hit && hit.type !== "text" && hit.type !== "group" && hit.type !== "page" && !hit.sourceId && placeInto(hit)) return;
        void placeNext(p.world);
    },
    hover(p) {
        if (!placing()) {
            pointer = null;
            return undefined;
        }
        pointer = p.screen;
        editor.set({});
        return "crosshair";
    },
    overlay(ctx) {
        if (!placing()) return;
        const camera = editor.get().camera;
        if (drag?.box) {
            const a = worldToScreen(camera, drag.box.x, drag.box.y);
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(a.x + 0.5, a.y + 0.5, drag.box.w * camera.zoom, drag.box.h * camera.zoom);
            ctx.setLineDash([]);
        }
        if (!pointer) return;
        const items = vectorUi.get().place;
        const item = items[0];
        if (!item) return;
        // The badge: a small card with the next thumbnail, offset from the cursor, and the count.
        const x = pointer.x + 14;
        const y = pointer.y + 14;
        const img = thumbImage(item.thumb);
        const w = img ? Math.max(24, Math.round((img.naturalWidth / img.naturalHeight) * 44)) : 44;
        const bw = Math.min(88, w) + 8;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.roundRect(x, y, bw, 52, 6);
        ctx.fill();
        ctx.restore();
        if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x + 4, y + 4, bw - 8, 44, 3);
            ctx.clip();
            ctx.drawImage(img, x + 4, y + 4, bw - 8, 44);
            ctx.restore();
        } else {
            // A video: a play triangle.
            ctx.fillStyle = "#2C2C2C";
            ctx.fillRect(x + 4, y + 4, bw - 8, 44);
            ctx.fillStyle = "#FFFFFF";
            ctx.beginPath();
            ctx.moveTo(x + bw / 2 - 6, y + 17);
            ctx.lineTo(x + bw / 2 + 9, y + 26);
            ctx.lineTo(x + bw / 2 - 6, y + 35);
            ctx.closePath();
            ctx.fill();
        }
        if (items.length > 1) {
            const label = String(items.length);
            ctx.font = "600 11px Inter, system-ui, sans-serif";
            const lw = Math.max(18, ctx.measureText(label).width + 10);
            ctx.fillStyle = HANDLE_BLUE;
            ctx.beginPath();
            ctx.roundRect(x + bw - lw / 2, y - 8, lw, 18, 9);
            ctx.fill();
            ctx.fillStyle = "#FFFFFF";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, x + bw, y + 1.5);
            ctx.textAlign = "start";
        }
    },
});

addKeyHandler((event) => {
    if (event.key !== "Escape" || !placing()) return false;
    cancelPlace();
    return true;
});

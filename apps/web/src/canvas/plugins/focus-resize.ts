import { worldToScreen } from "../../engine/camera";
import { focusSize, setFocusOverrides } from "../../engine/dev-focus";
import { devView } from "../../engine/dev-view";
import { editor } from "../../engine/store";
import { worldBounds } from "../../engine/transform";
import { type PluginPointer, drawSquare, registerCanvasPlugin } from "../canvas-plugins";

// Inspect's focus view: handles on the design's right edge, bottom edge and corner resize it
// temporarily (the file doesn't change; engine/dev-focus.ts derives what the canvas shows).

type Handle = "e" | "s" | "se";
let drag: { handle: Handle; start: { x: number; y: number }; w: number; h: number } | null = null;

function focused() {
    const v = devView.get();
    const s = editor.get();
    if (v?.kind !== "focus" || s.mode !== "dev" || s.tool !== "move") return null;
    const node = s.doc.nodes[v.id];
    return node ? { id: v.id, node } : null;
}

function handles(): { handle: Handle; x: number; y: number }[] {
    const f = focused();
    if (!f) return [];
    const s = editor.get();
    const b = worldBounds(s.doc, f.node);
    const at = (x: number, y: number) => worldToScreen(s.camera, x, y);
    const e = at(b.x + b.w, b.y + b.h / 2);
    const so = at(b.x + b.w / 2, b.y + b.h);
    const se = at(b.x + b.w, b.y + b.h);
    return [
        { handle: "e", ...e },
        { handle: "s", ...so },
        { handle: "se", ...se },
    ];
}

function hit(p: PluginPointer): Handle | null {
    for (const h of handles()) if (Math.abs(h.x - p.screen.x) <= 6 && Math.abs(h.y - p.screen.y) <= 6) return h.handle;
    return null;
}

const CURSORS: Record<Handle, string> = { e: "ew-resize", s: "ns-resize", se: "nwse-resize" };

export const focusResizePlugin = {
    name: "focus-resize",
    down(p: PluginPointer) {
        const f = focused();
        const handle = f ? hit(p) : null;
        if (!f || !handle) return false;
        const size = focusSize(f.id);
        if (!size) return false;
        drag = { handle, start: p.world, w: size.w, h: size.h };
        return true;
    },
    move(p: PluginPointer) {
        if (!drag) return;
        const dx = p.world.x - drag.start.x;
        const dy = p.world.y - drag.start.y;
        const w = drag.handle === "s" ? null : Math.max(1, Math.round(drag.w + dx));
        const h = drag.handle === "e" ? null : Math.max(1, Math.round(drag.h + dy));
        setFocusOverrides({ ...(w !== null ? { w } : {}), ...(h !== null ? { h } : {}) });
    },
    up() {
        drag = null;
    },
    hover(p: PluginPointer) {
        const handle = focused() ? hit(p) : null;
        return handle ? CURSORS[handle] : undefined;
    },
    overlay(ctx: CanvasRenderingContext2D) {
        if (!focused()) return;
        for (const h of handles()) drawSquare(ctx, h.x, h.y, 8);
    },
};

registerCanvasPlugin(focusResizePlugin);

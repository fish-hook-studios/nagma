import { editor } from "../../engine/store";
import { clickWidget, widgetAt } from "../../engine/widgets";
import { registerCanvasPlugin } from "../canvas-plugins";
import { hitTest } from "../hit-test";

// Widgets answer clicks: a press on a layer with a click handler runs it (the widget redraws
// itself) instead of selecting or dragging; anywhere else on a widget selects it as usual.

function target(world: { x: number; y: number }) {
    const s = editor.get();
    if (s.tool !== "move" || s.readOnly || s.editingVectorId || s.mode === "dev") return null;
    const found = widgetAt(s.doc, hitTest(s.doc, world.x, world.y, true) ?? undefined);
    return found && found.handler !== null ? { rootId: found.root.id, handler: found.handler } : null;
}

registerCanvasPlugin({
    name: "widget-click",
    down(p) {
        if (p.button !== 0 || p.shiftKey || p.metaKey) return false;
        const hit = target(p.world);
        if (!hit) return false;
        void clickWidget(hit.rootId, hit.handler);
        return true;
    },
    hover(p) {
        return target(p.world) ? "pointer" : undefined;
    },
});

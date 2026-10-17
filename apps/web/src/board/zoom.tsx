import { Minus, Plus } from "@untitledui/icons";
import { viewport, zoomBy, zoomTo, zoomToFit, zoomToSelection } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";
import { useEditor } from "../engine/store";

// The board's zoom controls at the bottom right: out and in. The buttons, the View menu and ⌘+/⌘−
// all halve or double the zoom. And the Recenter button over the toolbar when the view has wandered off the board.


const ITEMS: { id: string; label: string; key: string; run: () => void; needsSelection?: boolean }[] = [
    { id: "in", label: "Zoom in", key: "⌘ +", run: () => zoomBy(2) },
    { id: "out", label: "Zoom out", key: "⌘ −", run: () => zoomBy(0.5) },
    { id: "fit", label: "Zoom to fit", key: "⇧ 1", run: zoomToFit },
    { id: "selection", label: "Zoom to selection", key: "⇧ 2", run: zoomToSelection, needsSelection: true },
    { id: "50", label: "Zoom to 50%", key: "", run: () => zoomTo(0.5) },
    { id: "100", label: "Zoom to 100%", key: "⌘ 0", run: () => zoomTo(1) },
    { id: "200", label: "Zoom to 200%", key: "", run: () => zoomTo(2) },
];

// Out and in as one 65×32 pill (the zoom level and the presets are in the main menu's View menu).
export function BoardZoom() {
    const zoom = useEditor((s) => s.camera.zoom);
    const pct = `${Math.round(zoom * 100)}%`;
    return (
        <div className="pointer-events-auto flex h-8 items-center rounded-full bg-white text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]">
            <button type="button" aria-label="Zoom out" title={`Zoom out (${pct})`} onClick={() => zoomBy(0.5)} className="flex h-8 w-8 items-center justify-center rounded-l-full outline-none hover:bg-black/5"><Minus className="size-4" /></button>
            <span className="h-[18px] w-px bg-black/10" />
            <button type="button" aria-label="Zoom in" title={`Zoom in (${pct})`} onClick={() => zoomBy(2)} className="flex h-8 w-8 items-center justify-center rounded-r-full outline-none hover:bg-black/5"><Plus className="size-4" /></button>
        </div>
    );
}

// The zoom commands and presets, for the main menu's View menu.
export const ZOOM_ITEMS = ITEMS;

// Shown while nothing on the page is in view (and there is something to go back to).
export function Recenter() {
    const lost = useEditor((s) => {
        const page = s.doc.nodes[s.pageId];
        if (!page?.children.length) return false;
        const box = selectionBounds(s.doc, page.children);
        if (!box) return false;
        const { x, y, zoom } = s.camera;
        const view = { x: -x / zoom, y: -y / zoom, w: viewport.width / zoom, h: viewport.height / zoom };
        return box.x > view.x + view.w || box.x + box.w < view.x || box.y > view.y + view.h || box.y + box.h < view.y;
    });
    if (!lost) return null;
    return (
        <button type="button" onClick={zoomToFit} className="pointer-events-auto mb-2 h-8 rounded-full bg-white px-4 text-[12px] font-semibold text-[#1E1E1E] shadow-[0_2px_14px_rgba(0,0,0,0.16)] hover:bg-[#F5F5F5]">
            Recenter
        </button>
    );
}

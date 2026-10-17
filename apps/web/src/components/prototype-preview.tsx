import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { startPresenting } from "../engine/camera";
import { screenOf } from "../engine/prototype";
import { closePreview, openPreview, usePrototypeView } from "../engine/prototype-view";
import { useEditor } from "../engine/store";
import { PrototypePlayer } from "./prototype-player";

const HEADER_H = 28;

// Shift+Space: the selected frame's prototype plays in a panel docked at the canvas's left edge (the
// canvas narrows to make room), as tall as the canvas and as wide as the frame's shape needs. It
// follows the selected frame, and the canvas stays usable beside it. Its right and bottom edges
// resize it (⇧, or Respect aspect ratio, keeps the frame's proportions); Resize to 100% shows the
// frame at its own size.
export function PrototypePreview() {
    const { preview } = usePrototypeView();
    const frame = useEditor((s) => (preview ? s.doc.nodes[preview] : undefined));
    const selected = useEditor((s) => {
        const node = s.doc.nodes[s.selection[0] ?? ""];
        return node ? (screenOf(s.doc, node)?.id ?? null) : null;
    });
    const presenting = useEditor((s) => s.presentingId !== null);

    // Selecting another frame starts the preview over from it.
    useEffect(() => {
        if (preview && selected && selected !== preview) openPreview(selected);
    }, [preview, selected]);

    const ref = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const el = ref.current?.parentElement;
        if (!el) return;
        const measure = () => setBox((b) => (b.width === el.clientWidth && b.height === el.clientHeight ? b : { width: el.clientWidth, height: el.clientHeight }));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [preview]);

    // A size the viewer dragged or asked for; otherwise it follows the frame's shape.
    const [custom, setCustom] = useState<{ w: number; h: number } | null>(null);
    const [respectAspect, setRespectAspect] = useState(true);

    if (!preview || !frame || presenting) return <div ref={ref} hidden />;
    const ideal = ((box.height - HEADER_H) * frame.w) / Math.max(1, frame.h);
    const maxW = Math.max(200, box.width * 0.8);
    const width = Math.round(custom ? Math.max(160, Math.min(custom.w, maxW)) : Math.max(200, Math.min(ideal, box.width * 0.45)));
    const height = custom ? Math.round(Math.max(120, Math.min(custom.h, box.height))) : box.height;
    const ratio = frame.h / Math.max(1, frame.w);

    const startResize = (edge: "right" | "bottom" | "corner") => (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const from = { x: event.clientX, y: event.clientY, w: width, h: height };
        const move = (e: PointerEvent) => {
            let w = edge === "bottom" ? from.w : from.w + e.clientX - from.x;
            let h = edge === "right" ? from.h : from.h + e.clientY - from.y;
            if (respectAspect || e.shiftKey) {
                // The frame keeps its proportions: the dragged side leads.
                if (edge === "bottom") w = (h - HEADER_H) / ratio;
                else h = w * ratio + HEADER_H;
            }
            setCustom({ w, h });
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const handle = "absolute z-10 bg-transparent hover:bg-brand-500/40";
    return (
        <div ref={ref} data-prototype-preview className="relative h-full shrink-0 border-r border-panel-border" style={{ width }}>
            <div className="relative overflow-hidden border-b border-panel-border" style={{ height }}>
            <PrototypePlayer
                panelControls={{
                    respectAspect,
                    onToggleAspect: () => setRespectAspect((on) => !on),
                    onActualSize: () => setCustom({ w: frame.w, h: frame.h + HEADER_H }),
                }}
                key={preview}
                startId={preview}
                variant="panel"
                onClose={closePreview}
                onPopOut={(screenId) => {
                    closePreview();
                    startPresenting(screenId);
                }}
            />
            </div>
            <div role="separator" aria-orientation="vertical" aria-label="Resize the preview" onPointerDown={startResize("right")} className={`${handle} top-0 -right-1 w-2 cursor-ew-resize`} style={{ height }} />
            <div role="separator" aria-orientation="horizontal" aria-label="Resize the preview height" onPointerDown={startResize("bottom")} className={`${handle} left-0 h-2 w-full cursor-ns-resize`} style={{ top: height - 4 }} />
            <div aria-hidden="true" onPointerDown={startResize("corner")} className={`${handle} -right-1 size-3 cursor-nwse-resize`} style={{ top: height - 6 }} />
        </div>
    );
}

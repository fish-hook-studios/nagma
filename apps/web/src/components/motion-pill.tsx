import { Film01, Play } from "@untitledui/icons";
import { hasAnimation } from "../engine/animation";
import { fileMeta } from "../engine/files";
import { setMode } from "../engine/modes";
import { editor, useEditor } from "../engine/store";

// In Design mode, a layer with keyframes offers its timeline right above the toolbar.
// Video files: editing a title on the canvas offers the way back to the sequence.
export function SequencePill() {
    const show = useEditor((s) => !s.sequenceView && fileMeta(s.fileId)?.kind === "video");
    if (!show) return null;
    return (
        <button
            type="button"
            onClick={() => editor.set({ sequenceView: true, mode: "design" })}
            className="pointer-events-auto flex h-8 items-center gap-2 rounded-lg border border-panel-border bg-panel px-3 text-ink shadow-[0_4px_16px_rgba(0,0,0,0.18)] hover:bg-panel-hover"
        >
            <Film01 className="size-3.5 text-brand-500" />
            Back to sequence
        </button>
    );
}

export function MotionPill() {
    const show = useEditor((s) => {
        const subtree = (id: string): boolean => {
            const n = s.doc.nodes[id];
            return Boolean(n && (hasAnimation(n) || n.children.some(subtree)));
        };
        return s.selection.some(subtree);
    });
    if (!show) return null;
    return (
        <button
            type="button"
            onClick={() => setMode("motion")}
            className="pointer-events-auto flex h-8 items-center gap-2 rounded-lg border border-panel-border bg-panel px-3 text-ink shadow-[0_4px_16px_rgba(0,0,0,0.18)] hover:bg-panel-hover"
        >
            <Play className="size-3.5 text-brand-500" />
            Open Motion timeline
        </button>
    );
}

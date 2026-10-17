import { CursorBox } from "@untitledui/icons";
import { useMemo } from "react";
import { selectMatching } from "../engine/arrange";
import { isMatchingSet, matchingLayers } from "../engine/matching";
import { useEditor } from "../engine/store";

// Above the toolbar, like the reference's multi-edit control: when the selection has matching layers in
// other frames it offers to select them all (⌥⌘A); once matching layers are selected it says how
// many are being edited together.
export function MatchingPill() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const busy = useEditor((s) => s.editingTextId !== null || s.editingVectorId !== null || s.penNodeId !== null);
    const state = useMemo(() => {
        if (!selection.length || busy) return null;
        const matches = matchingLayers(doc, selection);
        if (matches.length > selection.length) return { kind: "offer" as const, count: matches.length };
        if (isMatchingSet(doc, selection)) return { kind: "editing" as const, count: selection.length };
        return null;
    }, [doc, selection, busy]);
    if (!state) return null;
    const base = "pointer-events-auto flex h-8 items-center gap-2 rounded-lg border border-panel-border bg-panel px-3 text-ink shadow-[0_4px_16px_rgba(0,0,0,0.18)]";
    if (state.kind === "editing") {
        return (
            <div role="status" className={base}>
                <CursorBox className="size-3.5 text-brand-500" />
                Editing {state.count} matching layers
            </div>
        );
    }
    return (
        <button type="button" onClick={selectMatching} className={`${base} hover:bg-panel-hover`} title="Select matching layers (⌥⌘A)">
            <CursorBox className="size-3.5 text-brand-500" />
            Select {state.count} matching layers
            <span className="text-ink-subtle">⌥⌘A</span>
        </button>
    );
}

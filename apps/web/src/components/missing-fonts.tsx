import { AlertTriangle } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { fontStatus, loadFont } from "../engine/fonts";
import { familiesOf, missingFonts, replaceFonts } from "../engine/font-usage";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { FontPicker } from "./type-controls";
import { useFonts } from "./type-shared";

// Missing fonts: text set in a family that can't be loaded (not on Google Fonts and not
// installed here) is flagged, and Replace fonts swaps each missing family for another everywhere.

// Asks for every family the document uses, so missing ones are found even off screen.
function useCheckAllFonts(doc: NagmaDocument) {
    const families = useMemo(() => {
        const set = new Set<string>();
        for (const node of Object.values(doc.nodes)) for (const f of familiesOf(node)) set.add(f);
        return [...set].sort().join("\n");
    }, [doc]);
    useEffect(() => {
        for (const f of families.split("\n")) if (f) void loadFont(f);
    }, [families]);
}

// In Typography: the selection uses a missing font.
export function MissingFontsNotice({ nodes }: { nodes: SceneNode[] }) {
    useFonts();
    const [open, setOpen] = useState(false);
    const missing = [...new Set(nodes.flatMap(familiesOf))].filter((f) => fontStatus(f) === "missing");
    if (!missing.length) return null;
    return (
        <>
            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={missing.join(", ")}>
                    Missing font: {missing.join(", ")}
                </span>
                <button type="button" onClick={() => setOpen(true)} className="shrink-0 font-medium underline-offset-2 hover:underline">
                    Replace
                </button>
            </div>
            {open && <ReplaceFontsDialog onClose={() => setOpen(false)} />}
        </>
    );
}

// On the page (nothing selected): the file has missing fonts.
export function MissingFontsBanner() {
    useFonts();
    const doc = useEditor((s) => s.doc);
    useCheckAllFonts(doc);
    const [open, setOpen] = useState(false);
    const missing = missingFonts(doc);
    if (!missing.length) return null;
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="flex-1">
                    {missing.length === 1 ? "1 missing font" : `${missing.length} missing fonts`}
                </span>
                <button type="button" onClick={() => setOpen(true)} className="h-6 rounded-md bg-field px-2 text-ink hover:bg-panel-hover">
                    Replace fonts
                </button>
            </div>
            {open && <ReplaceFontsDialog onClose={() => setOpen(false)} />}
        </section>
    );
}

export function ReplaceFontsDialog({ onClose }: { onClose: () => void }) {
    useFonts();
    const doc = useEditor((s) => s.doc);
    useCheckAllFonts(doc);
    const missing = missingFonts(doc);
    const [choice, setChoice] = useState<Record<string, string>>({});
    const apply = () => {
        const map = Object.fromEntries(missing.map((m) => [m.family, choice[m.family] ?? "Inter"]));
        const commands = replaceFonts(editor.get().doc, map);
        if (commands.length) editor.execute({ type: "batch", commands });
        onClose();
    };
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[440px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Replace fonts">
                    <div onKeyDown={(e) => e.stopPropagation()}>
                        <div className="flex h-11 items-center justify-between border-b border-panel-border px-4">
                            <h2 className="text-[12px] font-semibold">Replace fonts</h2>
                            <button type="button" onClick={onClose} aria-label="Close" className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                                ×
                            </button>
                        </div>
                        <div className="space-y-1 p-4">
                            {!missing.length && <p className="text-ink-muted">Every font in this file is available.</p>}
                            {missing.length > 0 && (
                                <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-2 pb-1 text-ink-subtle">
                                    <span>Missing font</span>
                                    <span />
                                    <span>Replace with</span>
                                </div>
                            )}
                            {missing.map((m) => (
                                <div key={m.family} className="grid grid-cols-[1fr_16px_1fr] items-center gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate">{m.family}</div>
                                        <div className="text-ink-subtle">{m.layers === 1 ? "1 layer" : `${m.layers} layers`}</div>
                                    </div>
                                    <span className="text-ink-subtle">→</span>
                                    <FontPicker family={choice[m.family] ?? "Inter"} onPick={(f) => setChoice((c) => ({ ...c, [m.family]: f }))} />
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 border-t border-panel-border px-4 py-3">
                            <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                                Cancel
                            </button>
                            <button type="button" disabled={!missing.length} onClick={apply} className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                                Replace fonts
                            </button>
                        </div>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

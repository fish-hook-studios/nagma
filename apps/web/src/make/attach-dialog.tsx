import { ArrowLeft, Check, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { preloadImages } from "../engine/image-store";
import { renderThumb } from "../engine/thumb";
import type { NagmaDocument } from "../engine/types";
import { designSources, framesOf, loadDesign, selectionInDesign, type DesignSource } from "./frames";
import { attachFrames } from "./generate";
import { make, useMake } from "./state";

// Attach frames from a design file: pick a file, then its frames. The frames selected in the last
// design file you had open are offered first.

function FramePicker({ doc, fileName, onBack }: { doc: NagmaDocument; fileName: string; onBack: () => void }) {
    const frames = framesOf(doc);
    const [chosen, setChosen] = useState<string[]>([]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        void preloadImages(doc.images).then(() => {
            if (!live) return;
            const out: Record<string, string> = {};
            for (const f of framesOf(doc).slice(0, 60)) out[f.id] = renderThumb(doc, 240, 150, f.id);
            setThumbs(out);
        });
        return () => {
            live = false;
        };
    }, [doc]);
    const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    return (
        <>
            <div className="flex items-center gap-2 border-b border-panel-border px-3 py-2">
                <button type="button" aria-label="Back to files" onClick={onBack} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <ArrowLeft className="size-3.5" />
                </button>
                <span className="truncate text-[12px] font-semibold text-ink">{fileName}</span>
                <span className="ml-auto text-[11px] text-ink-muted">{frames.length === 1 ? "1 frame" : `${frames.length} frames`}</span>
            </div>
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto p-3">
                {frames.length === 0 && <div className="col-span-3 py-6 text-center text-[12px] text-ink-muted">This file has no frames.</div>}
                {frames.map((f) => (
                    <button key={f.id} type="button" aria-pressed={chosen.includes(f.id)} onClick={() => toggle(f.id)} className={`relative flex flex-col gap-1 rounded-lg border p-1.5 text-left outline-none ${chosen.includes(f.id) ? "border-brand-500 ring-1 ring-brand-500" : "border-panel-border hover:border-ink-subtle"}`}>
                        {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" className="aspect-[8/5] w-full rounded object-cover" /> : <span className="aspect-[8/5] w-full rounded bg-field" />}
                        <span className="truncate text-[11px] text-ink">{f.name}</span>
                        {chosen.includes(f.id) && (
                            <span className="absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-brand-500 text-white">
                                <Check className="size-3" />
                            </span>
                        )}
                    </button>
                ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-panel-border px-3 py-2">
                <button
                    type="button"
                    disabled={!chosen.length || busy}
                    onClick={() => {
                        setBusy(true);
                        void attachFrames(doc, chosen, fileName).finally(() => make.set({ attachOpen: false }));
                    }}
                    className="h-7 rounded-md bg-brand-500 px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
                >
                    {busy ? "Attaching…" : chosen.length > 1 ? `Attach ${chosen.length} frames` : "Attach frame"}
                </button>
            </div>
        </>
    );
}

const close = () => make.set({ attachOpen: false });

export function AttachDialog() {
    const open = useMake((s) => s.attachOpen);
    return (
        <ModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <Modal className="w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-panel-border bg-panel shadow-2xl outline-none">
                <AttachBody />
            </Modal>
        </ModalOverlay>
    );
}

function AttachBody() {
    const [sources, setSources] = useState<DesignSource[] | null>(null);
    const [picked, setPicked] = useState<{ doc: NagmaDocument; name: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void designSources().then(setSources);
    }, []);
    const [selection] = useState(selectionInDesign);
    return (
                <Dialog aria-label="Attach frames from a design file" className="outline-none">
                    <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
                        <span className="text-[13px] font-semibold text-ink">Attach frames from a design file</span>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <X className="size-3.5" />
                        </button>
                    </div>
                    {picked ? (
                        <FramePicker doc={picked.doc} fileName={picked.name} onBack={() => setPicked(null)} />
                    ) : (
                        <div className="max-h-[60vh] overflow-y-auto p-2">
                            {selection && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        setBusy(true);
                                        void attachFrames(selection.doc, selection.ids, selection.fileName).finally(() => {
                                            setBusy(false);
                                            close();
                                        });
                                    }}
                                    className="mb-2 flex w-full items-center gap-3 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2.5 text-left outline-none hover:bg-brand-500/15"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[12px] font-semibold text-ink">Current selection</span>
                                        <span className="block truncate text-[11px] text-ink-muted">
                                            {selection.ids.length === 1 ? (selection.doc.nodes[selection.ids[0] ?? ""]?.name ?? "1 frame") : `${selection.ids.length} frames`} in {selection.fileName}
                                        </span>
                                    </span>
                                    <span className="text-[11px] font-semibold text-brand-500">{busy ? "Attaching…" : "Attach"}</span>
                                </button>
                            )}
                            <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold text-ink-muted">Design files</div>
                            {sources === null && <div className="px-2 py-4 text-[12px] text-ink-muted">Loading files…</div>}
                            {sources?.length === 0 && <div className="px-2 py-4 text-[12px] text-ink-muted">No design files yet.</div>}
                            {error && <div className="px-2 py-2 text-[12px] text-red-500">{error}</div>}
                            {sources?.map((s) => (
                                <button
                                    key={s.key}
                                    type="button"
                                    onClick={() => {
                                        setError(null);
                                        void loadDesign(s.key)
                                            .then((doc) => (doc ? setPicked({ doc, name: s.name }) : setError("That file couldn't be opened.")))
                                            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                                    }}
                                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-panel-hover"
                                >
                                    {s.thumb ? <img src={s.thumb} alt="" className="h-9 w-14 shrink-0 rounded object-cover" /> : <span className="h-9 w-14 shrink-0 rounded bg-field" />}
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[12px] text-ink">{s.name}</span>
                                        <span className="block text-[11px] text-ink-muted">{s.key.startsWith("server:") ? "Team file" : "In this browser"}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </Dialog>
    );
}

import { useEffect, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { type FileMeta, listFiles, loadFileDocument } from "../engine/files";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { slides, useSlides } from "./state";
import { insertEmbed } from "./widgets";
import { withServer } from "../engine/servers";

// Interactive > Prototype: pick a design file, then the frame its prototype starts on. The slide
// gets an embed that runs that prototype while presenting.

type Start = { id: string; name: string; page: string; flow: boolean };

function startsOf(doc: NagmaDocument): Start[] {
    const out: Start[] = [];
    for (const pageId of doc.roots) {
        const page = doc.nodes[pageId];
        if (!page || page.internal) continue;
        for (const id of page.children) {
            const node = doc.nodes[id];
            if (node && (node.type === "frame" || node.type === "component")) out.push({ id, name: node.flowName || node.name, page: page.name, flow: Boolean(node.flowStart) });
        }
    }
    // Flow starting points first.
    return out.sort((a, b) => Number(b.flow) - Number(a.flow));
}

function prototypeUrl(meta: FileMeta, frame: string): string {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("file", meta.shared ?? meta.id);
    if (meta.key) url.searchParams.set("key", meta.key);
    url.searchParams.set("present", frame);
    url.searchParams.set("embed", "1");
    return withServer(url).toString();
}

export function PrototypePicker() {
    const open = useSlides((s) => s.prototypeOpen);
    const close = () => slides.set({ prototypeOpen: false });
    return (
        <AriaModalOverlay isOpen={open !== false} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <AriaModal className="max-h-[80vh] w-[520px] overflow-y-auto rounded-2xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="Add a prototype" className="p-5 text-[12px] outline-none">{open !== false && <PickerBody target={typeof open === "string" ? open : null} close={close} />}</AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function PickerBody({ target, close }: { target: string | null; close: () => void }) {
    const files = listFiles().filter((f) => f.kind === "design" && !f.trashed);
    const [file, setFile] = useState<FileMeta | null>(null);
    const [starts, setStarts] = useState<Start[] | null>(null);
    useEffect(() => {
        if (!file) return;
        let live = true;
        void loadFileDocument(file.id).then((doc) => live && setStarts(doc ? startsOf(doc) : []));
        return () => {
            live = false;
        };
    }, [file]);
    const pick = (start: Start) => {
        if (!file) return;
        const url = prototypeUrl(file, start.id);
        const prototype = { file: file.id, frame: start.id, name: `${file.name || "Untitled"}: ${start.name}` };
        const node = target ? editor.get().doc.nodes[target] : undefined;
        if (node?.deck?.kind === "embed") {
            const title = node.children.map((c) => editor.get().doc.nodes[c]).find((c): c is SceneNode => c?.name === "Question");
            editor.execute({ type: "batch", commands: [{ type: "node.update", id: node.id, patch: { deck: { ...node.deck, url, prototype } } }, ...(title ? [{ type: "node.update" as const, id: title.id, patch: { text: prototype.name } }] : [])] });
        } else insertEmbed(url, prototype);
        close();
    };
    return (
        <>
            <h2 className="mb-1 text-[14px] font-semibold">{file ? (file.name || "Untitled") : "Add a prototype"}</h2>
            <p className="mb-4 text-ink-muted">{file ? "Pick the frame the prototype starts on." : "Pick the design file with the prototype."}</p>
            {!file ? (
                files.length ? (
                    <ul className="space-y-1">
                        {files.map((f) => (
                            <li key={f.id}>
                                <button type="button" onClick={() => {
                                        setStarts(null);
                                        setFile(f);
                                    }} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                                    {f.thumb ? <img alt="" src={f.thumb} className="h-6 w-9 rounded object-cover" /> : <span className="h-6 w-9 rounded bg-field" />}
                                    <span className="min-w-0 flex-1 truncate">{f.name || "Untitled"}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="py-6 text-center text-ink-muted">No design files yet. Make a prototype in a design file, then add it here.</p>
                )
            ) : !starts ? (
                <p className="py-6 text-center text-ink-muted">Opening the file…</p>
            ) : starts.length ? (
                <ul className="space-y-1">
                    {starts.map((st) => (
                        <li key={st.id}>
                            <button type="button" onClick={() => pick(st)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                                <span className="min-w-0 flex-1 truncate">{st.name}</span>
                                <span className="text-ink-muted">{st.flow ? "Flow start" : st.page}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="py-6 text-center text-ink-muted">This file has no frames to start a prototype on.</p>
            )}
            <div className="mt-4 flex justify-between">
                {file ? (
                    <button type="button" onClick={() => setFile(null)} className="h-8 rounded-md px-3 hover:bg-panel-hover">Back</button>
                ) : (
                    <span />
                )}
                <button type="button" onClick={close} className="h-8 rounded-md px-3 hover:bg-panel-hover">Cancel</button>
            </div>
        </>
    );
}

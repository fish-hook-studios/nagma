import { File06, Upload01, X } from "@untitledui/icons";
import { useState, useSyncExternalStore } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { Select } from "../components/select";
import { createFile, openFile } from "../engine/files";
import { editor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { loadPdfEngine } from "../engines/pdf-engine";
import { asPdf } from "./actions";
import { DOC_BLUE, PAGE_SIZES, type PageSizeId, createPdfDocument } from "./model";

// Starting a Document: a blank PDF (page size, orientation, how many pages) or a PDF (or picture)
// from this computer. Home and the tab bar's + open it.

type Create = (doc: NagmaDocument, name: string) => void | Promise<void>;

let request: { create: Create } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const localCreate: Create = async (doc, name) => {
    const meta = createFile("docs", doc, name);
    await openFile(meta.id);
};

export function openNewDocument(create: Create = localCreate) {
    request = { create };
    emit();
}

function close() {
    request = null;
    emit();
}

// A Document from a PDF or picture file, created with `create` (a new local file by default).
export async function documentFromFile(file: File, create: Create = localCreate): Promise<void> {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const engine = await loadPdfEngine();
    const pdf = await asPdf(file);
    // Make sure it opens (a protected PDF opens with its password later).
    if (isPdf) {
        try {
            new engine.PdfWorkbench(pdf, file.name).free();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.toLowerCase().includes("password")) throw error;
        }
    }
    const name = file.name.replace(/\.[^.]+$/, "") || "Untitled document";
    await create(await createPdfDocument(name, pdf), name);
}

export function NewDocumentDialog() {
    const open = useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => request,
    );
    const [size, setSize] = useState<PageSizeId>("a4");
    const [landscape, setLandscape] = useState(false);
    const [pages, setPages] = useState(1);
    const [busy, setBusy] = useState(false);
    const [over, setOver] = useState(false);
    const create = open?.create ?? localCreate;
    const blank = async () => {
        setBusy(true);
        try {
            const engine = await loadPdfEngine();
            const s = PAGE_SIZES[size];
            const [w, h] = landscape ? [s.height, s.width] : [s.width, s.height];
            const bytes = engine.PdfWorkbench.blank(w, h, pages);
            const name = "Untitled document";
            close();
            await create(await createPdfDocument(name, bytes), name);
        } catch (error) {
            editor.notify(`Couldn't create the document: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };
    const fromFile = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        try {
            close();
            await documentFromFile(file, create);
        } catch (error) {
            editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };
    const pick = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,application/pdf,image/*";
        input.onchange = () => void fromFile(input.files?.[0]);
        input.click();
    };
    return (
        <AriaModalOverlay isOpen={Boolean(open)} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[520px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="New document" className="outline-none">
                    <div className="flex h-12 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[13px] font-semibold">New document</h2>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4 p-4" onKeyDown={(e) => e.stopPropagation()}>
                        <section className="space-y-3 rounded-lg border border-panel-border p-3">
                            <h3 className="flex items-center gap-2 text-[12px] font-semibold">
                                <File06 className="size-4" style={{ color: DOC_BLUE }} /> Blank document
                            </h3>
                            <label className="block space-y-1 text-[11px]">
                                <span className="text-ink-muted">Page size</span>
                                <Select aria-label="Page size" value={size} onChange={(e) => setSize(e.target.value as PageSizeId)} className="h-8 w-full rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink">
                                    {Object.entries(PAGE_SIZES).map(([id, s]) => (
                                        <option key={id} value={id}>
                                            {s.label}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <div className="flex gap-1 text-[11px]">
                                {[false, true].map((l) => (
                                    <button key={String(l)} type="button" aria-pressed={landscape === l} onClick={() => setLandscape(l)} className={`h-7 flex-1 rounded-md border ${landscape === l ? "border-transparent text-white" : "border-panel-border text-ink hover:bg-panel-hover"}`} style={landscape === l ? { background: DOC_BLUE } : undefined}>
                                        {l ? "Landscape" : "Portrait"}
                                    </button>
                                ))}
                            </div>
                            <label className="flex items-center gap-2 text-[11px]">
                                <span className="text-ink-muted">Pages</span>
                                <input type="number" aria-label="Number of pages" min={1} max={500} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className="h-8 w-20 rounded-md border border-panel-border bg-field px-2 text-[12px] outline-none focus:border-brand-500" />
                            </label>
                            <button type="button" disabled={busy} onClick={() => void blank()} className="h-8 w-full rounded-md text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: DOC_BLUE }}>
                                Create
                            </button>
                        </section>
                        <section
                            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-center ${over ? "border-(--doc-accent) bg-(--doc-accent)/10" : "border-panel-border"}`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setOver(true);
                            }}
                            onDragLeave={() => setOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setOver(false);
                                void fromFile(e.dataTransfer.files[0]);
                            }}
                        >
                            <Upload01 className="size-6 text-ink-muted" />
                            <p className="text-[12px] font-semibold">Open a PDF</p>
                            <p className="text-[11px] text-ink-muted">Drop a PDF or a picture here</p>
                            <button type="button" disabled={busy} onClick={pick} className="h-8 rounded-md border border-panel-border px-3 text-[12px] hover:bg-panel-hover disabled:opacity-50">
                                Choose a file…
                            </button>
                        </section>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

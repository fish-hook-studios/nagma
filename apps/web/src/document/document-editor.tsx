import { useEffect, useState } from "react";
import { ActionsPalette } from "../components/actions-palette";
import { NamePrompt } from "../components/collab-ui";
import { ContextMenu } from "../components/context-menu";
import { SaveVersionDialog } from "../components/version-history";
import { editor, useEditor } from "../engine/store";
import { insertFileList, printDocument } from "./actions";
import { PasswordPrompt, ProtectDialog, SignatureDialog, SplitDialog } from "./dialogs";
import { DocInspector } from "./inspector";
import { LeftPanel } from "./left-panel";
import { PDF_KEY } from "./model";
import { OrganizeView } from "./organize";
import { PageStack, fitZoom, scrollToPage, setZoom, useSpacePan } from "./page-view";
import { copySelection } from "./selection-bar";
import { type DocTool, closeWorkbench, docView, edit, redo, saveNow, setTool, syncWorkbench, undo, useDoc } from "./state";
import { DocToolbar, NavBar, SearchBar, ToolOptions } from "./toolbar";

// Document files: a PDF workbench on PdfCraft's engine. Panels on the left (pages, bookmarks,
// comments, fields, attachments, layers), the pages in the middle with the tools above them, and
// properties on the right.

const TOOL_KEYS: Record<string, DocTool> = { v: "select", h: "hand", c: "note", u: "highlight", d: "draw", t: "textbox", s: "sign", e: "edit", r: "redact", f: "fill" };

function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || Boolean(el.closest?.("[role=menu],[role=dialog],[role=listbox]"));
}

function useDocShortcuts() {
    useEffect(() => {
        const active = () => {
            const s = editor.get();
            return Boolean(s.doc.pdf) && !s.homeOpen && !s.presentingId;
        };
        const onKey = (event: KeyboardEvent) => {
            if (!active() || typing(event.target)) return;
            const mod = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            const take = (action: () => void) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                action();
            };
            const d = docView.get();
            if (mod && key === "z") return take(event.shiftKey ? redo : undo);
            if (mod && key === "y") return take(redo);
            if (mod && key === "f") return take(() => docView.set({ searchOpen: true }));
            if (mod && key === "p") return take(() => void printDocument());
            if (mod && key === "s") return take(() => void saveNow().then((ok) => ok && editor.notify("Saved.")));
            if (mod && key === "c") {
                if (d.textSel) take(() => copySelection());
                return;
            }
            if (mod && (key === "=" || key === "+")) return take(() => setZoom(d.zoom * 1.2));
            if (mod && key === "-") return take(() => setZoom(d.zoom / 1.2));
            if (mod && key === "0") return take(() => setZoom(1));
            if (mod && key === "a" && d.view === "organize") return take(() => docView.set({ pageSelection: (d.info?.pages ?? []).map((_, i) => i) }));
            if (mod || event.altKey) return;
            if (key === "escape") return take(() => (d.searchOpen ? docView.set({ searchOpen: false, hits: [], query: "" }) : (setTool("select"), docView.set({ textSel: null, selected: null, view: d.view }))));
            if ((key === "delete" || key === "backspace") && d.selected) return take(() => edit({ op: "deleteAnnotation", page: d.selected?.page, index: d.selected?.index }, { selected: null }));
            if ((key === "delete" || key === "backspace") && d.view === "organize" && d.pageSelection.length) {
                const count = d.info?.pages.length ?? 0;
                if (d.pageSelection.length < count) return take(() => edit({ op: "delete", pages: d.pageSelection }, { pageSelection: [] }));
                return;
            }
            if (d.view === "read" && (key === "arrowright" || key === "pagedown") && !event.shiftKey) return take(() => scrollToPage(d.page + 1));
            if (d.view === "read" && (key === "arrowleft" || key === "pageup") && !event.shiftKey) return take(() => scrollToPage(d.page - 1));
            // ⇧U underlines and ⇧S strikes through; ⇧1 fits the width and ⇧2 the page.
            if (event.shiftKey && !mod && (key === "u" || key === "s")) return take(() => (d.view === "organize" && docView.set({ view: "read" }), setTool(key === "u" ? "underline" : "strikeout")));
            if (event.shiftKey && !mod && (event.code === "Digit1" || event.code === "Digit2")) return take(() => docView.set({ fit: event.code === "Digit1" ? "width" : "page", zoom: fitZoom(event.code === "Digit1" ? "width" : "page") }));
            const tool = TOOL_KEYS[key];
            if (tool && !event.shiftKey) {
                return take(() => {
                    if (tool === "sign" && !d.signature) return docView.set({ dialog: "signature" });
                    if (d.view === "organize") docView.set({ view: "read" });
                    setTool(tool);
                });
            }
        };
        // Whatever the workbench doesn't use stops here, so the design editor's shortcuts and
        // paste don't act on a Document file. (Listening on the document, React's own handlers
        // have already run.)
        const swallow = (event: Event) => {
            if (active() && !typing(event.target)) event.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("keydown", swallow);
        document.addEventListener("paste", swallow);
        document.addEventListener("copy", swallow);
        document.addEventListener("cut", swallow);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            document.removeEventListener("keydown", swallow);
            document.removeEventListener("paste", swallow);
            document.removeEventListener("copy", swallow);
            document.removeEventListener("cut", swallow);
        };
    }, []);
}

// Opens the file's PDF in the engine, and again whenever its content is replaced from elsewhere
// (a restored version, a collaborator's save).
function useWorkbenchSync() {
    const fileId = useEditor((s) => s.fileId);
    const ref = useEditor((s) => s.doc.images[PDF_KEY]);
    useEffect(() => {
        void syncWorkbench();
    }, [fileId, ref]);
    useEffect(() => () => closeWorkbench(), []);
}

function DropZone({ children }: { children: React.ReactNode }) {
    const [over, setOver] = useState(false);
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
            onDragOver={(e) => {
                if (readOnly || !e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target) setOver(false);
            }}
            onDrop={async (e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                setOver(false);
                const all = Array.from(e.dataTransfer.files);
                const files = all.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf" || f.type.startsWith("image/"));
                // Other files were dropped without a word.
                if (!files.length) return editor.notify(all.length === 1 ? `${all[0]?.name} isn't a PDF or picture, so it can't be added.` : "Those files aren't PDFs or pictures, so they can't be added.");
                await insertFileList(files, (docView.get().page ?? 0) + 1);
            }}
        >
            {children}
            {over && <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-(--doc-accent) bg-(--doc-accent)/10 text-[13px] font-semibold text-ink">Drop PDFs or images to insert their pages</div>}
        </div>
    );
}

export function DocumentEditor() {
    useDocShortcuts();
    useWorkbenchSync();
    useSpacePan();
    const status = useDoc((s) => s.status);
    const error = useDoc((s) => s.error);
    const view = useDoc((s) => s.view);
    const toast = useEditor((s) => s.toast);
    const uiHidden = useEditor((s) => s.uiHidden);
    const ready = status === "ready";
    return (
        <div className="relative flex min-h-0 w-full flex-1">
            {!uiHidden && ready && <LeftPanel />}
            <main className="relative flex min-w-0 flex-1 flex-col">
                {ready && !uiHidden && <DocToolbar />}
                {ready && !uiHidden && view === "read" && <ToolOptions />}
                {status === "password" && <PasswordPrompt />}
                {(status === "loading" || status === "idle") && <div className="flex flex-1 items-center justify-center bg-canvas text-[12px] text-ink-muted">Opening document…</div>}
                {status === "error" && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas text-[12px] text-ink-muted">
                        <p>Couldn't open this document: {error}</p>
                        <button type="button" onClick={() => void syncWorkbench(true)} className="h-7 rounded-md border border-panel-border px-3 text-ink hover:bg-panel-hover">
                            Try again
                        </button>
                    </div>
                )}
                {ready && (
                    <DropZone>
                        {view === "organize" ? (
                            <OrganizeView />
                        ) : (
                            <>
                                <PageStack />
                                <SearchBar />
                                <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                                    <NavBar />
                                </div>
                            </>
                        )}
                    </DropZone>
                )}
                {toast && (
                    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex justify-center">
                        <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
                    </div>
                )}
            </main>
            {!uiHidden && ready && <DocInspector />}
            <SignatureDialog />
            <ProtectDialog />
            <SplitDialog />
            <ContextMenu />
            <ActionsPalette />
            <NamePrompt />
            <SaveVersionDialog />
        </div>
    );
}

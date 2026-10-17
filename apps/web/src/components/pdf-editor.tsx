import { Copy01, Download01, FilePlus01, FlipBackward, FlipForward, RefreshCcw01, RefreshCw01, Trash01 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { type PdfDocument, type PdfPageInfo, drawPage, loadPdfEngine, pageInfo } from "../engines/pdf-engine";
import { syncPdf } from "../engine/pdf";
import { imageBytes } from "../engine/image-store";
import { editor, useEditor } from "../engine/store";
import { IconButton } from "./icon-button";

// Thumbnails fit in this many points-as-pixels on their longest side.
const THUMB = 168;

function Thumbnail({ doc, index, info, version }: { doc: PdfDocument; index: number; info: PdfPageInfo; version: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        try {
            drawPage(doc, index, (THUMB / Math.max(info.width, info.height, 1)) * window.devicePixelRatio, canvas);
        } catch {
            // A page the renderer can't draw stays blank; the rest still work.
        }
    }, [doc, index, info.width, info.height, version]);
    const scale = THUMB / Math.max(info.width, info.height, 1);
    return <canvas ref={ref} className="bg-white shadow-sm" style={{ width: info.width * scale, height: info.height * scale }} />;
}

// A page organizer powered by PdfCraft: rotate, reorder, duplicate, insert and delete pages of
// the original PDF. Saving writes the PDF back and updates the page frames in the design.
export function PdfEditor() {
    const target = useEditor((s) => s.pdfEdit);
    const sourceUrl = useEditor((s) => (target ? s.doc.images[target.source] : undefined));
    const images = useEditor((s) => s.doc.images);
    const [doc, setDoc] = useState<PdfDocument | null>(null);
    const [pages, setPages] = useState<PdfPageInfo[]>([]);
    const [selected, setSelected] = useState<number[]>([]);
    const [anchor, setAnchor] = useState(0);
    const [version, setVersion] = useState(0);
    const [changed, setChanged] = useState(false);
    const [status, setStatus] = useState("Loading…");
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState<number | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);

    useEffect(() => {
        if (!sourceUrl) return;
        let cancelled = false;
        let opened: PdfDocument | null = null;
        (async () => {
            try {
                const engine = await loadPdfEngine();
                const bytes = target ? await imageBytes(images, target.source) : null;
                if (!bytes) throw new Error("This PDF's data is missing from this browser and the server.");
                opened = new engine.PdfDoc(bytes);
                if (cancelled) return opened.free();
                if (import.meta.env.DEV) Object.assign(window, { nagmaPdfDoc: opened });
                setDoc(opened);
                setPages(pageInfo(opened));
                setStatus("");
            } catch (error) {
                setStatus(`Couldn't open this PDF: ${error instanceof Error ? error.message : String(error)}`);
            }
        })();
        return () => {
            cancelled = true;
            opened?.free();
        };
        // Opened once per session; saving replaces the source but the open document is already current.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.source]);

    if (!target) return null;

    const refresh = (next: number[]) => {
        if (!doc) return;
        const info = pageInfo(doc);
        setPages(info);
        setSelected(next.filter((i) => i < info.length));
        setVersion((v) => v + 1);
    };

    const run = (command: Record<string, unknown>, next: number[] = selected) => {
        if (!doc) return;
        try {
            doc.execute(JSON.stringify(command));
            setChanged(true);
            setStatus("");
            refresh(next);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
        }
    };

    const sorted = [...selected].sort((a, b) => a - b);
    const none = !doc || selected.length === 0;

    const rotate = (degrees: number) => run({ op: "rotate", pages: sorted, degrees });
    const remove = () => {
        if (selected.length >= pages.length) {
            setStatus("A PDF needs at least one page.");
            return;
        }
        run({ op: "delete", pages: sorted }, []);
    };
    const duplicate = () => {
        const last = sorted[sorted.length - 1] ?? 0;
        run({ op: "duplicate", pages: sorted }, sorted.map((_, i) => last + 1 + i));
    };
    const insertBlank = () => {
        const at = sorted.length ? sorted[sorted.length - 1] + 1 : pages.length;
        const size = pages[at - 1] ?? pages[0] ?? { width: 612, height: 792 };
        run({ op: "insertBlank", at, width: size.width, height: size.height }, [at]);
    };
    // Moves the selection (or the dragged page) so it lands before page `to`.
    const move = (from: number[], to: number) => {
        const before = from.filter((i) => i < to).length;
        const dest = Math.max(0, Math.min(pages.length - from.length, to - before));
        if (from.every((p, k) => p === dest + k)) return;
        run({ op: "move", pages: from, to: dest }, from.map((_, k) => dest + k));
    };
    const history = (redo: boolean) => {
        if (!doc) return;
        try {
            if (redo ? doc.redo() : doc.undo()) {
                setChanged(true);
                refresh(selected);
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
        }
    };

    const click = (index: number, event: React.MouseEvent) => {
        if (event.shiftKey) {
            const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
            setSelected(Array.from({ length: b - a + 1 }, (_, k) => a + k));
            return;
        }
        if (event.metaKey || event.ctrlKey) {
            setSelected((s) => (s.includes(index) ? s.filter((i) => i !== index) : [...s, index]));
        } else {
            setSelected([index]);
        }
        setAnchor(index);
    };

    const close = () => editor.set({ pdfEdit: null });

    const download = () => {
        if (!doc) return;
        const bytes = doc.save(true);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${target.name.replace(/^Page \d+$/, "Document")}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const save = async () => {
        if (!doc) return;
        setBusy(true);
        try {
            await syncPdf(target.source, doc, doc.save(false));
            close();
            editor.notify("PDF pages updated in the design. Undo brings back the old pages.");
        } catch (error) {
            setStatus(`Couldn't save: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        event.stopPropagation();
        const mod = event.metaKey || event.ctrlKey;
        if (event.key === "Escape") close();
        else if ((event.key === "Delete" || event.key === "Backspace") && !none) remove();
        else if (mod && event.key.toLowerCase() === "z") history(event.shiftKey);
        else if (mod && event.key.toLowerCase() === "a") {
            event.preventDefault();
            setSelected(pages.map((_, i) => i));
        } else if (mod && event.key.toLowerCase() === "d" && !none) {
            event.preventDefault();
            duplicate();
        }
    };

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-canvas text-ink outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-panel-border bg-panel px-3">
                <span className="font-semibold">Organize pages</span>
                <span className="truncate text-ink-muted">· {pages.length} {pages.length === 1 ? "page" : "pages"}</span>
                <span className="ml-2 rounded bg-field px-1.5 py-0.5 text-[10px] text-ink-subtle">PdfCraft engine</span>
                <div className="flex-1" />
                <IconButton icon={RefreshCcw01} label="Rotate left" disabled={none} onPress={() => rotate(-90)} />
                <IconButton icon={RefreshCw01} label="Rotate right" disabled={none} onPress={() => rotate(90)} />
                <IconButton icon={Copy01} label="Duplicate" shortcut="⌘ D" disabled={none} onPress={duplicate} />
                <IconButton icon={FilePlus01} label="Insert blank page" disabled={!doc} onPress={insertBlank} />
                <IconButton icon={Trash01} label="Delete" shortcut="⌫" disabled={none} onPress={remove} />
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <IconButton icon={FlipBackward} label="Undo" shortcut="⌘ Z" disabled={!doc} onPress={() => history(false)} />
                <IconButton icon={FlipForward} label="Redo" shortcut="⇧ ⌘ Z" disabled={!doc} onPress={() => history(true)} />
                <IconButton icon={Download01} label="Download PDF" disabled={!doc} onPress={download} />
                <button type="button" onClick={close} className="ml-2 h-7 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={!doc || busy || !changed}
                    onClick={() => void save()}
                    className="h-7 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                    {busy ? "Saving…" : "Save to design"}
                </button>
            </header>
            {status && <div className="border-b border-panel-border bg-panel px-4 py-2 text-ink-muted">{status}</div>}
            <div className="min-h-0 flex-1 overflow-y-auto p-6" onClick={(e) => e.target === e.currentTarget && setSelected([])}>
                <div className="flex flex-wrap gap-x-4 gap-y-6" onClick={(e) => e.target === e.currentTarget && setSelected([])}>
                    {doc &&
                        pages.map((info, index) => {
                            const isSelected = selected.includes(index);
                            return (
                                <div
                                    key={index}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    aria-label={`Page ${index + 1}`}
                                    draggable
                                    onClick={(e) => click(index, e)}
                                    onDragStart={(e) => {
                                        e.dataTransfer.effectAllowed = "move";
                                        setDragging(index);
                                        if (!isSelected) setSelected([index]);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        const box = e.currentTarget.getBoundingClientRect();
                                        setDropAt(e.clientX < box.left + box.width / 2 ? index : index + 1);
                                    }}
                                    onDragEnd={() => {
                                        setDragging(null);
                                        setDropAt(null);
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (dragging !== null && dropAt !== null) {
                                            const from = selected.includes(dragging) ? sorted : [dragging];
                                            move(from, dropAt);
                                        }
                                        setDragging(null);
                                        setDropAt(null);
                                    }}
                                    className="relative flex flex-col items-center gap-2 outline-none"
                                    style={{ width: THUMB + 16 }}
                                >
                                    {dropAt === index && <div className="absolute -left-2.5 top-0 h-[calc(100%-24px)] w-0.5 rounded bg-brand-500" />}
                                    {dropAt === index + 1 && index === pages.length - 1 && (
                                        <div className="absolute -right-2.5 top-0 h-[calc(100%-24px)] w-0.5 rounded bg-brand-500" />
                                    )}
                                    <div
                                        className={`flex items-center justify-center rounded-md p-2 ${isSelected ? "bg-brand-50 ring-2 ring-brand-500" : "hover:bg-panel-hover"} ${dragging !== null && isSelected ? "opacity-50" : ""}`}
                                        style={{ width: THUMB + 16, height: THUMB + 16 }}
                                    >
                                        <Thumbnail doc={doc} index={index} info={info} version={version} />
                                    </div>
                                    <span className={`text-[11px] ${isSelected ? "font-semibold text-brand-500" : "text-ink-muted"}`}>{index + 1}</span>
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}

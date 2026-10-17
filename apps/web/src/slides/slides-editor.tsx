import { notifyKeyNeeded, openAiSettings } from "../engine/ai-settings";
import { ArrowDown, ArrowUp, LinkBroken01, Plus } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { askModel } from "../engine/agent";
import { sceneFocus } from "../canvas/hit-test";
import { CanvasView } from "../canvas/canvas-view";
import { ActionsPalette } from "../components/actions-palette";
import { NamePrompt, ShareButton } from "../components/collab-ui";
import { PresenceAvatars } from "../components/follow-ui";
import { ContextMenu } from "../components/context-menu";
import { ErrorBoundary } from "../components/error-boundary";
import { CommentsPanel } from "../components/comments-ui";
import { SaveVersionDialog, VersionHistoryPanel } from "../components/version-history";
import { useCollab } from "../engine/collab";
import { viewCenter } from "../engine/actions";
import { pickImages } from "../engine/images";
import { viewport } from "../engine/camera";
import { hasCopiedLayers } from "../engine/layer-clipboard";
import { clipboardFiles, htmlImageSources, isImageUrl } from "../engine/paste-images";
import { editor, useEditor } from "../engine/store";
import { useNotesDraft } from "./notes-draft";
import { addSlide, deleteSlides, dropSlides, duplicateSlides, migrateGroups, moveSection, moveSlide, nudgeSlides, renameSection, setNotes, ungroup } from "./actions";
import { ExportSlidesDialog } from "./export-dialog";
import { PresentButton, SlidesInspector } from "./inspector";
import { TemplateLibrary } from "./template-picker";
import { NewSlidePanel } from "./new-slide-panel";
import { setPickerSwatches } from "../components/picker-swatches";
import { SLIDES_ORANGE, groupLabel, slideIds, slideNumbers, slideOf, slidesBySection, templateColors, themeOf } from "./model";
import { SlidePresenter } from "./present";
import { present } from "./show";
import { GridPill, SlideMenu, SlideList, SlideThumb } from "./slide-list";
import { clickSlide, currentSlide, goToSlide, selectedSlides, slides, useCurrentSlide, useSelectedSlides, useSlides } from "./state";
import { SlidesToolbar } from "./toolbar";
import { TableBars } from "./table-bars";
import { PrototypePicker } from "./prototype-picker";
import { cellOf, deleteColumns, deleteRows, tableModel, tableOf } from "./tables";
import { insertEmbed, insertTable, parseCsv } from "./widgets";

// The slides editor: the slide list on the left, the slide (or the grid of every slide) in the
// middle with the presenter notes card and the toolbar under it, and the slide's properties on
// the right. Present takes over the window in the file's present tab.

// Keeps the canvas on the slide being edited, showing only that slide.
function useSlideFocus(container: React.RefObject<HTMLDivElement | null>) {
    const current = useCurrentSlide();
    // The slide moves when slides are reordered or change section: the view follows it.
    const place = useEditor((s) => {
        const n = current ? s.doc.nodes[current] : undefined;
        return n ? `${n.x},${n.y},${n.w},${n.h}` : "";
    });
    useEffect(() => {
        sceneFocus.id = current;
        const fit = () => {
            const id = currentSlide();
            const node = id ? editor.get().doc.nodes[id] : undefined;
            if (!node || viewport.width < 50) return;
            // The slide fills the view: 16px at the sides, a little more above and below.
            const padX = 16;
            const padY = Math.max(28, viewport.height * 0.04);
            const zoom = Math.min((viewport.width - padX * 2) / node.w, (viewport.height - padY * 2) / node.h, 8);
            editor.set({ camera: { zoom, x: viewport.width / 2 - (node.x + node.w / 2) * zoom, y: viewport.height / 2 - (node.y + node.h / 2) * zoom } });
        };
        fit();
        const frame = requestAnimationFrame(fit);
        const el = container.current;
        const observer = new ResizeObserver(() => fit());
        if (el) observer.observe(el);
        editor.set({});
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [current, place, container]);
    useEffect(
        () => () => {
            sceneFocus.id = null;
        },
        [],
    );
}

function useSlidesShortcuts() {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const s = editor.get();
            if (!s.doc.slides || s.homeOpen || s.presentingId || slides.get().mode !== "slides") return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
            if (s.editingTextId) return;
            const mod = event.metaKey || event.ctrlKey;
            const take = () => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            if (mod && event.altKey && event.key === "Enter") return take(), present("current");
            if (mod && event.key === "Enter" && !s.readOnly) return take(), addSlide("title-body");
            if (mod && event.shiftKey && (event.code === "KeyE" || event.key.toLowerCase() === "e")) return take(), slides.set({ exportOpen: true });
            // ⇧⌘K: a picture or video on the slide.
            if (mod && event.shiftKey && !s.readOnly && (event.code === "KeyK" || event.key.toLowerCase() === "k")) return take(), void pickImages(viewCenter);
            // ⇧D: design mode.
            if (event.shiftKey && !mod && !event.altKey && event.code === "KeyD") return take(), slides.set({ mode: "design" });
            const ids = slideIds(s.doc);
            const i = ids.indexOf(currentSlide() ?? "");
            // ⌘[ and ⌘] move the slide (or the selected slides) up or down the deck.
            if (mod && !event.altKey && !s.selection.length && !s.readOnly && (event.code === "BracketLeft" || event.code === "BracketRight" || event.key === "[" || event.key === "]")) return take(), nudgeSlides(event.code === "BracketLeft" || event.key === "[" ? -1 : 1);
            const step = (by: number) => {
                const to = ids[i + by];
                if (to) goToSlide(to);
            };
            // In the grid the slides are what's selected: Delete and ⌘D act on them.
            if (slides.get().view === "grid" && !s.selection.length && !s.readOnly) {
                if (event.key === "Backspace" || event.key === "Delete") return take(), deleteSlides(selectedSlides());
                if (mod && event.code === "KeyD") return take(), duplicateSlides(selectedSlides());
            }
            // Cells of a table: Delete removes whole rows or columns, else empties the cells.
            if ((event.key === "Backspace" || event.key === "Delete") && s.selection.length && !s.readOnly && clearCells(s.selection)) return take();
            if (event.key === "PageDown") return take(), step(1);
            if (event.key === "PageUp") return take(), step(-1);
            if (s.selection.length || mod || event.altKey || event.shiftKey) return;
            if (event.key === "ArrowDown" || event.key === "ArrowRight") return take(), step(1);
            if (event.key === "ArrowUp" || event.key === "ArrowLeft") return take(), step(-1);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
}

function clearCells(selection: string[]): boolean {
    const doc = editor.get().doc;
    const table = tableOf(doc, selection[0]);
    if (!table || table.id === selection[0] || !selection.every((id) => cellOf(doc, id)?.id === id && tableOf(doc, id)?.id === table.id)) return false;
    const model = tableModel(doc, table);
    const whole = (axis: "rows" | "cols") => {
        const out: number[] = [];
        model[axis].forEach((_, i) => {
            const ids = model.cells.filter((c) => (axis === "rows" ? c.r <= i && c.r + c.rs > i : c.c <= i && c.c + c.cs > i)).map((c) => c.id);
            if (ids.every((id) => selection.includes(id))) out.push(i);
        });
        return out;
    };
    const rows = whole("rows");
    const cols = whole("cols");
    if (rows.length && rows.length < model.rows.length && model.cells.filter((c) => selection.includes(c.id)).every((c) => rows.includes(c.r))) deleteRows(table.id, rows);
    else if (cols.length && cols.length < model.cols.length) deleteColumns(table.id, cols);
    else {
        const commands = selection.flatMap((id) => (doc.nodes[id]?.children ?? []).filter((t) => doc.nodes[t]?.type === "text").map((t) => ({ type: "node.update" as const, id: t, patch: { text: "", spans: undefined } })));
        editor.execute({ type: "batch", commands });
    }
    editor.set({ selection: [table.id] });
    return true;
}

// Pasting spreadsheet cells makes a table, pasting a link makes an embed; dropping a CSV file
// makes a table too. Everything else pastes as usual.
function useSlidesPaste() {
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const s = editor.get();
            if (!s.doc.slides || s.readOnly || s.editingTextId || s.presentingId || slides.get().mode !== "slides") return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (clipboardFiles(event.clipboardData).length) return;
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (hasCopiedLayers(html) || htmlImageSources(html).length) return;
            const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
            // A link to a picture pastes as the picture, not an embed.
            if (isImageUrl(text)) return;
            const lines = text.split("\n");
            const grid = lines.map((l) => l.split("\t"));
            const tabular = text.includes("\t") && (lines.length > 1 || (grid[0]?.length ?? 0) > 1);
            const link = /^https?:\/\/\S+$/.test(text.trim());
            if (!tabular && !link) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (tabular) insertTable(grid);
            else insertEmbed(text.trim());
        };
        window.addEventListener("paste", onPaste, true);
        return () => window.removeEventListener("paste", onPaste, true);
    }, []);
}

function onCsvDrop(event: React.DragEvent<HTMLElement>) {
    const file = Array.from(event.dataTransfer.files).find((f) => /\.csv$/i.test(f.name) || f.type === "text/csv");
    if (!file || editor.get().readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    void file.text().then((text) => {
        const rows = parseCsv(text);
        if (rows.length) insertTable(rows);
        else editor.notify(`${file.name} has no rows.`);
    });
}

// "Start with a draft": the model (your own AI key, or the server's shared one) writes presenter
// notes from what's on the slide; without a key, a notice says where to add one.
async function draftNotes(id: string): Promise<boolean> {
    const doc = editor.get().doc;
    const slide = doc.nodes[id];
    if (!slide) return false;
    const texts = slide.children.map((c) => doc.nodes[c]).flatMap((n) => (n?.type === "text" && n.text?.trim() ? [n.text.trim()] : []));
    const prompt = `Write short presenter notes for a slide. Reply with the notes only, as plain text, three to five sentences, no heading. The slide says:\n${texts.join("\n") || "(the slide has no text yet)"}`;
    const reply = await askModel(prompt, doc, slide.children);
    if (!reply?.reply.trim()) {
        if (reply?.keyNeeded) notifyKeyNeeded();
        else if (reply?.error) editor.notify(reply.error, { label: "Open AI settings", run: openAiSettings });
        else editor.notify("The model can't be reached right now. Try again in a moment.");
        return false;
    }
    if (slideOf(editor.get().doc.nodes[id])) setNotes(id, reply.reply.trim(), true);
    return true;
}

function DraftButton({ id, onDraft }: { id: string; onDraft: (text: string) => void }) {
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            disabled={busy}
            onClick={() => {
                setBusy(true);
                void draftNotes(id)
                    .then((ok) => ok && onDraft(slideOf(editor.get().doc.nodes[id])?.notes ?? ""))
                    .finally(() => setBusy(false));
            }}
            className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-white/[0.08] px-2 text-[12px] text-[#c9c9c9] outline-none hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
        >
            <DraftIcon className="size-3.5" />
            {busy ? "Drafting…" : "Start with a draft"}
            <span className="rounded-[3px] border border-white/20 px-[3px] text-[8px] font-semibold leading-[11px] text-[#bdbdbd]">AI</span>
        </button>
    );
}

// Lines of text with a sparkle: a drafted note.
function DraftIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M2.5 4h7M2.5 7.5h5M2.5 11h4" />
            <path d="M12 7.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
    );
}

function NotesPanel() {
    const id = useCurrentSlide();
    const saved = useEditor((s) => slideOf(s.doc.nodes[id ?? ""])?.notes ?? "");
    const readOnly = useEditor((s) => s.readOnly);
    const height = useSlides((s) => s.notesHeight);
    const draft = useNotesDraft(id, saved);
    // Dragging the handle above the card makes it taller or shorter.
    const resize = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = height;
        const move = (ev: PointerEvent) => slides.set({ notesHeight: Math.round(Math.min(Math.max(startH + startY - ev.clientY, 48), window.innerHeight * 0.5)) });
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    return (
        <div aria-label="Presenter notes" className="shrink-0 bg-canvas px-4">
            <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize presenter notes"
                title="Drag to resize"
                onPointerDown={resize}
                className="group flex h-[22px] cursor-row-resize items-center justify-center"
            >
                <span className="h-[3px] w-16 rounded-full bg-[#6f6f6f] group-hover:bg-[#9a9a9a]" />
            </div>
            <div className="relative flex rounded-lg bg-[#111111]" style={{ height }}>
                <textarea
                    aria-label="Presenter notes for this slide"
                    placeholder="Add presenter notes..."
                    value={draft.text}
                    readOnly={readOnly}
                    onChange={(e) => draft.type(e.target.value)}
                    onBlur={(e) => draft.leave(e.target.value)}
                    className="min-h-0 flex-1 resize-none bg-transparent py-5 pl-5 pr-48 text-[14px] leading-normal text-ink outline-none placeholder:text-[#8a8a8a]"
                />
                {id && !readOnly && !draft.text && (
                    <div className="absolute right-5 top-4">
                        <DraftButton id={id} onDraft={draft.replace} />
                    </div>
                )}
            </div>
        </div>
    );
}

function SectionTitle({ id, name, fallback }: { id: string; name: string; fallback: string }) {
    const editing = useSlides((s) => s.renaming === id);
    if (editing) {
        return (
            <input
                autoFocus
                aria-label="Group name"
                defaultValue={name}
                placeholder="Group name"
                onBlur={(e) => {
                    slides.set({ renaming: null });
                    if (e.target.value.trim() !== name) renameSection(id, e.target.value.trim());
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") slides.set({ renaming: null });
                }}
                className="h-7 rounded-md border border-brand-500 bg-field px-1.5 text-[13px] font-semibold text-ink outline-none"
            />
        );
    }
    return (
        <button type="button" title="Double-click to rename" onDoubleClick={() => slides.set({ renaming: id })} className={`rounded px-1 text-[13px] font-semibold hover:bg-panel-hover ${name ? "text-ink" : "text-ink-muted"}`}>
            {name || fallback}
        </button>
    );
}

// Every slide at once, a row per group (a slide outside a group is a row of its own): drag slides
// within and between rows, or onto the gap between rows for a row of their own; reorder rows;
// double-click a slide to edit it.
type GridDrop = { section: string; index: number } | { gap: number };

function GridView() {
    const doc = useEditor((s) => s.doc);
    const current = useCurrentSlide();
    const readOnly = useEditor((s) => s.readOnly);
    const picked = useSelectedSlides();
    const rows = slidesBySection(doc).filter((r) => r.ids.length);
    const all = rows.flatMap((r) => r.ids);
    const numbers = slideNumbers(doc);
    const [dragId, setDragId] = useState<string | null>(null);
    const [target, setTarget] = useState<GridDrop | null>(null);
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const end = () => {
        setDragId(null);
        setTarget(null);
    };
    const drop = (e: React.DragEvent) => {
        e.preventDefault();
        if (dragId && target) {
            if ("gap" in target) {
                const first = rows[target.gap]?.ids[0];
                dropSlides([dragId], first ? (all.slice(all.indexOf(first)).find((id) => id !== dragId) ?? null) : null, false);
            }
            else moveSlide(dragId, target.section, target.index);
        }
        end();
    };
    // The gap above row `r` (r = rows.length: below the last): dropping there makes a row.
    const gap = (r: number) => (
        <div
            key={`gap-${r}`}
            aria-hidden="true"
            className="relative h-4"
            onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (!target || !("gap" in target) || target.gap !== r) setTarget({ gap: r });
            }}
            onDrop={drop}
        >
            {dragId && target && "gap" in target && target.gap === r && <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ background: SLIDES_ORANGE }} />}
        </div>
    );
    let counter = 0;
    return (
        <div aria-label="Slide grid" className="h-full overflow-y-auto bg-canvas px-8 pt-20 pb-24">
            {rows.map(({ section, ids }, r) => (
                <div key={section.id}>
                    {gap(r)}
                    <section aria-label={section.name || groupLabel({ section, ids }, all)} className="group/row mb-2">
                        {(ids.length > 1 || section.name) && (
                            <div className="mb-2 flex items-center gap-1 text-ink-muted">
                                <SectionTitle id={section.id} name={section.name} fallback={groupLabel({ section, ids }, all)} />
                                <span className="text-[11px]">{ids.length} slide{ids.length === 1 ? "" : "s"}</span>
                                {!readOnly && (
                                    <>
                                        <button type="button" aria-label="Move row up" disabled={r === 0} onClick={() => moveSection(section.id, -1)} className="rounded p-1 hover:bg-panel-hover hover:text-ink disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                                        <button type="button" aria-label="Move row down" disabled={r === rows.length - 1} onClick={() => moveSection(section.id, 1)} className="rounded p-1 hover:bg-panel-hover hover:text-ink disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                                        {ids.length > 1 && <button type="button" aria-label="Ungroup" title="Ungroup: each slide becomes a row of its own" onClick={() => ungroup(section.id)} className="rounded p-1 hover:bg-panel-hover hover:text-ink"><LinkBroken01 className="size-3.5" /></button>}
                                    </>
                                )}
                            </div>
                        )}
                        <div
                            className="flex min-h-[140px] flex-wrap gap-5 rounded-lg"
                            onDragOver={(e) => {
                                if (!dragId) return;
                                e.preventDefault();
                                if (e.target === e.currentTarget && (!target || "gap" in target || target.section !== section.id || target.index !== ids.length)) setTarget({ section: section.id, index: ids.length });
                            }}
                            onDrop={drop}
                        >
                            {ids.map((id, i) => {
                                counter++;
                                const info = slideOf(doc.nodes[id]);
                                const n = numbers.get(id);
                                const marker = dragId && target && !("gap" in target) && target.section === section.id && target.index === i && dragId !== id;
                                return (
                                    <div
                                        key={id}
                                        draggable={!readOnly}
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData("text/x-slide", id);
                                            setDragId(id);
                                        }}
                                        onDragOver={(e) => {
                                            if (!dragId) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const at = e.clientX < rect.left + rect.width / 2 ? i : i + 1;
                                            const index = ids.includes(dragId) && ids.indexOf(dragId) < at ? at - 1 : at;
                                            if (!target || "gap" in target || target.section !== section.id || target.index !== index) setTarget({ section: section.id, index });
                                        }}
                                        onDrop={drop}
                                        onDragEnd={end}
                                        onClick={(e) => clickSlide(id, e)}
                                        onDoubleClick={() => {
                                            goToSlide(id);
                                            slides.set({ view: "single" });
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            if (!picked.includes(id)) goToSlide(id);
                                            setMenu({ id, x: e.clientX, y: e.clientY });
                                        }}
                                        className="relative flex flex-col gap-1.5"
                                        aria-label={`Slide ${counter}`}
                                    >
                                        {marker && <div className="absolute -left-3 top-0 h-[135px] w-0.5 rounded" style={{ background: SLIDES_ORANGE }} />}
                                        <div className={`overflow-hidden rounded-md border-2 ${id === current || picked.includes(id) ? "" : "border-transparent hover:border-panel-border"} ${info?.skip ? "opacity-40" : ""}`} style={id === current || picked.includes(id) ? { borderColor: SLIDES_ORANGE } : undefined}>
                                            <SlideThumb id={id} width={240} />
                                        </div>
                                        <span className="text-[11px] text-ink-muted">{info?.skip ? "Skipped" : (n ?? counter)}</span>
                                    </div>
                                );
                            })}
                            {!readOnly && (
                                <button
                                    type="button"
                                    aria-label={`Add slide to ${section.name || "this row"}`}
                                    onClick={() => addSlide("title-body", ids[ids.length - 1] ?? null, undefined, true)}
                                    className="flex h-[135px] w-[240px] items-center justify-center rounded-md border-2 border-dashed border-panel-border text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100"
                                >
                                    <Plus className="size-5" />
                                </button>
                            )}
                        </div>
                    </section>
                </div>
            ))}
            {gap(rows.length)}
            {!readOnly && (
                <button type="button" onClick={() => addSlide("title-body", null)} className="flex h-8 items-center gap-1.5 rounded-md border border-panel-border px-3 text-[12px] text-ink hover:bg-panel-hover">
                    <Plus className="size-3.5" /> Add row
                </button>
            )}
            {menu && <SlideMenu id={menu.id} at={menu} onClose={() => setMenu(null)} />}
        </div>
    );
}

function SingleView() {
    const ref = useRef<HTMLDivElement | null>(null);
    useSlideFocus(ref);
    const notesOpen = useSlides((s) => s.notesOpen);
    const uiHidden = useEditor((s) => s.uiHidden);
    // A press on the slide's own background selects the slide; a press beside it selects nothing.
    const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
        const el = ref.current;
        const id = currentSlide();
        const node = id ? editor.get().doc.nodes[id] : undefined;
        if (!el || !node || e.button !== 0) return;
        const { camera } = editor.get();
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left - camera.x) / camera.zoom;
        const y = (e.clientY - rect.top - camera.y) / camera.zoom;
        const inside = x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h;
        if (inside !== slides.get().slideSelected) slides.set({ slideSelected: inside });
    };
    return (
        <>
            <div ref={ref} className="relative min-h-0 flex-1" onPointerDownCapture={onPointerDownCapture}>
                <ErrorBoundary name="canvas">
                    <CanvasView />
                </ErrorBoundary>
                <TableBars />
            </div>
            {notesOpen && <NotesPanel />}
            {!uiHidden && (
                <div className="flex shrink-0 justify-center bg-canvas pt-3 pb-3">
                    <SlidesToolbar />
                </div>
            )}
        </>
    );
}

export function SlidesEditor() {
    useSlidesShortcuts();
    useSlidesPaste();
    const view = useSlides((s) => s.view);
    const toast = useEditor((s) => s.toast);
    const presenting = useEditor((s) => s.presentingId !== null);
    const uiHidden = useEditor((s) => s.uiHidden);
    const history = useCollab((s) => s.historyOpen);
    const commenting = useEditor((s) => s.tool === "comment");
    const mode = useSlides((s) => s.mode);

    // Every colour picker offers the colours of the slide's template.
    useEffect(() => {
        setPickerSwatches((doc) => (doc.slides ? { title: "Template colors", colors: templateColors(themeOf(doc, currentSlide())) } : null));
        return () => setPickerSwatches(null);
    }, []);

    // Decks from before groups get one row per slide.
    const fileId = useEditor((s) => s.fileId);
    useEffect(() => {
        migrateGroups();
    }, [fileId]);

    // A link to a slide (Copy link) opens on that slide.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const id = params.get("slide");
        if (id && editor.get().doc.nodes[id]) goToSlide(id);
        // A presentation link starts the show.
        if (params.get("present") === "1") {
            const url = new URL(location.href);
            url.searchParams.delete("present");
            window.history.replaceState(window.history.state, "", url);
            present("current");
        }
    }, []);

    return (
        <div data-slides-ui="" className="relative flex min-h-0 w-full flex-1 bg-canvas">
            {!uiHidden && view !== "grid" && <SlideList />}
            <main className="relative flex min-w-0 flex-1 flex-col" onDropCapture={onCsvDrop}>
                {view === "grid" ? (
                    <>
                        <div className="min-h-0 flex-1">
                            <GridView />
                        </div>
                        {!uiHidden && (
                            <>
                                <GridPill />
                                <div className="absolute top-3 right-3 z-20 flex h-12 items-center gap-2 rounded-[13px] bg-panel px-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.25)]">
                                    <PresenceAvatars chevron />
                                    <PresentButton />
                                    <ShareButton className={`h-8! rounded-[5px]! px-3! text-[11px]! ${mode === "slides" ? "bg-[#F24E1E]! hover:bg-[#DA4419]!" : ""}`} />
                                </div>
                                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                                    <SlidesToolbar />
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <SingleView />
                )}
                {!uiHidden && <NewSlidePanel />}
                {toast && (
                    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
                        <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
                    </div>
                )}
            </main>
            {!uiHidden && (history ? <VersionHistoryPanel /> : commenting ? <CommentsPanel /> : view !== "grid" && <SlidesInspector />)}
            <ContextMenu />
            <ActionsPalette />
            <NamePrompt />
            <SaveVersionDialog />
            <ExportSlidesDialog />
            <TemplateLibrary />
            <PrototypePicker />
            {presenting && (
                <ErrorBoundary name="presentation">
                    <SlidePresenter />
                </ErrorBoundary>
            )}
        </div>
    );
}

import { ChevronDown, ChevronRight, EyeOff, Plus } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { LayerRow } from "../components/layers-panel";
import { type DropTarget, beginLayerDrag } from "../components/layer-drag";
import { MenuRow } from "../components/left-sidebar";
import { NagmaLogo } from "../components/nagma-logo";
import { createFile, duplicateFile, fileMeta, openFile, renameFile } from "../engine/files";
import { ACTION_BY_ID, actionEnabled, runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { setCollapsed as storeCollapsed, ui, useUi } from "../engine/ui-state";
import { addSlide, changeLayout, patchSlide, setPublishedTemplate, copySlideLink, deleteSlides, dropGroup, dropSlides, duplicateSlides, exportPdf, exportPngs, groupSlides, moveSlidesToSection, nudgeSlides, renameSection, toggleSkipSlides, ungroup } from "./actions";
import { LAYOUTS, SLIDES_ORANGE, deckOf, groupLabel, slideIds, slideNumbers, slideOf, slidesBySection } from "./model";
import { pickPptx } from "./pptx";
import { present } from "./show";
import { paintSlideCanvas, sameSignature, slideSignature, useAssetsVersion } from "./render";
import { clickSlide, goToSlide, selectedSlides, slides, useCurrentSlide, useSelectedSlides, useSlides } from "./state";

// The left panel: main menu, file name, the view toggle, New slide, and the numbered slide list
// (drag to reorder, right-click for slide actions).

export const MENU_CLASS = "min-w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

// A picture of one slide, drawn again only when something on it changed.
export function SlideThumb({ id, width, className = "" }: { id: string; width: number; className?: string }) {
    const doc = useEditor((s) => s.doc);
    const assets = useAssetsVersion();
    const ref = useRef<HTMLCanvasElement | null>(null);
    const drawn = useRef<{ sig: SceneNode[] | null; width: number; assets: number }>({ sig: null, width: 0, assets: -1 });
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas || !doc.nodes[id]) return;
        const sig = slideSignature(doc, id);
        if (sameSignature(drawn.current.sig, sig) && drawn.current.width === width && drawn.current.assets === assets) return;
        drawn.current = { sig, width, assets };
        paintSlideCanvas(canvas, doc, id, width);
    }, [doc, id, width, assets]);
    const node = doc.nodes[id];
    const height = node ? (width * node.h) / node.w : (width * 9) / 16;
    return <canvas ref={ref} className={`block ${className}`} style={{ width, height }} />;
}

const MAIN_MENU: ({ id: string; label: string; shortcut?: string; run: () => void } | "-")[] = [
    { id: "slidesNew", label: "New slides file", run: () => void openFile(createFile("slides").id) },
    { id: "slidesPptx", label: "Import a .pptx presentation…", run: pickPptx },
    { id: "slidesExport", label: "Export slides…", shortcut: "⇧ ⌘ E", run: () => slides.set({ exportOpen: true }) },
    "-",
    { id: "slidesPresent", label: "Present from current slide", shortcut: "⌥ ⌘ ↵", run: () => present("current") },
    { id: "slidesPresentStart", label: "Present from start", run: () => present("start") },
    { id: "slidesRehearse", label: "Rehearse", run: () => present("start", { rehearse: true, presenterView: true }) },
    "-",
    { id: "slidesGrid", label: "Grid view", run: () => slides.set({ view: slides.get().view === "grid" ? "single" : "grid" }) },
    { id: "slidesNotes", label: "Presenter notes", run: () => slides.set({ notesOpen: !slides.get().notesOpen }) },
    { id: "slidesDesign", label: "Design mode", shortcut: "⇧ D", run: () => slides.set({ mode: "design" }) },
    { id: "slidesShortcuts", label: "Keyboard shortcuts", run: () => slides.set({ helpOpen: true }) },
    "-",
    { id: "slidesTemplates", label: "Browse templates…", run: () => slides.set({ libraryOpen: true }) },
    { id: "slidesPublish", label: "Publish as template", run: () => setPublishedTemplate(!deckOf(editor.get().doc).template) },
];

function MainMenu() {
    const s = useEditor((state) => state);
    const notes = useSlides((st) => st.notesOpen);
    const grid = useSlides((st) => st.view === "grid");
    const published = useEditor((st) => Boolean(deckOf(st.doc).template));
    const actions = ["home", "-", "undo", "redo", "-", "copy", "paste", "duplicate", "delete", "-", "selectAll", "-", "save", "saveVersion", "history"];
    const disabled = actions.filter((a) => {
        const action = ACTION_BY_ID.get(a);
        return action && !actionEnabled(action, s);
    });
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Main menu" className="-ml-1 flex h-7 items-center gap-1 rounded-md px-1 outline-none hover:bg-panel-hover">
                <NagmaLogo size={18} />
                <ChevronDown className="size-3 text-ink-muted" />
            </AriaButton>
            <AriaPopover placement="bottom start" offset={4} className={MENU_CLASS}>
                <AriaMenu
                    aria-label="Main menu"
                    className="outline-none"
                    disabledKeys={disabled}
                    onAction={(key) => {
                        const k = String(key);
                        const own = MAIN_MENU.find((m) => m !== "-" && m.id === k);
                        if (own && own !== "-") own.run();
                        else runAction(k);
                    }}
                >
                    {actions.map((a, i) => {
                        if (a === "-") return <AriaSeparator key={`s${i}`} className="my-1 h-px bg-white/10" />;
                        const action = ACTION_BY_ID.get(a);
                        return action ? <MenuRow key={a} id={a} label={action.label} shortcut={action.shortcut} /> : null;
                    })}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    {MAIN_MENU.map((m, i) =>
                        m === "-" ? (
                            <AriaSeparator key={`m${i}`} className="my-1 h-px bg-white/10" />
                        ) : (
                            <MenuRow key={m.id} id={m.id} label={m.label} shortcut={m.shortcut} checked={m.id === "slidesNotes" ? notes : m.id === "slidesGrid" ? grid : m.id === "slidesPublish" ? published : undefined} />
                        ),
                    )}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function FileTitle() {
    const name = useEditor((s) => s.doc.name);
    const fileId = useEditor((s) => s.fileId);
    const [editing, setEditing] = useState(false);
    const project = fileMeta(fileId)?.project;
    if (editing) {
        return (
            <input
                autoFocus
                aria-label="File name"
                defaultValue={name}
                onBlur={(e) => {
                    setEditing(false);
                    const next = e.target.value.trim();
                    if (next && next !== name) {
                        if (fileId) renameFile(fileId, next);
                        else editor.execute({ type: "doc.rename", name: next });
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(false);
                }}
                className="h-7 w-full rounded-md border border-brand-500 bg-field px-1.5 text-[12px] text-ink outline-none"
            />
        );
    }
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="File" className="group flex min-w-0 flex-col items-start gap-1 rounded-md text-left outline-none">
                <span className="flex max-w-full items-center gap-2.5 text-[14px] font-semibold leading-5 text-ink">
                    <span className="truncate">{name || "Untitled"}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-ink-muted group-hover:text-ink" />
                </span>
                <span className="text-[11px] leading-4 text-ink-muted">{project ? "Project" : "Drafts"}</span>
            </AriaButton>
            <AriaPopover placement="bottom start" offset={4} className={MENU_CLASS}>
                <AriaMenu
                    aria-label="File"
                    className="outline-none"
                    onAction={(key) => {
                        if (key === "rename") setEditing(true);
                        else if (key === "duplicate" && fileId) void duplicateFile(fileId).then((copy) => copy && openFile(copy.id));
                        else if (key === "pdf") void exportPdf();
                        else if (key === "export") slides.set({ exportOpen: true });
                    }}
                >
                    <MenuRow id="rename" label="Rename" />
                    <MenuRow id="duplicate" label="Duplicate" />
                    <MenuRow id="pdf" label="Export to PDF" />
                    <MenuRow id="export" label="Export slides…" shortcut="⇧ ⌘ E" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The right-click menu on a slide in the list or the grid: it acts on every selected slide.
export function SlideMenu({ id, at, onClose }: { id: string; at: { x: number; y: number }; onClose: () => void }) {
    const doc = useEditor((s) => s.doc);
    const picked = useSelectedSlides();
    const node = doc.nodes[id];
    const info = slideOf(node);
    const ref = useRef<HTMLDivElement | null>(null);
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [layoutsOpen, setLayoutsOpen] = useState(false);
    useEffect(() => {
        const close = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) onClose();
        };
        const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("pointerdown", close, true);
        window.addEventListener("keydown", key, true);
        return () => {
            window.removeEventListener("pointerdown", close, true);
            window.removeEventListener("keydown", key, true);
        };
    }, [onClose]);
    if (!node || !info) return null;
    const ids = picked.includes(id) ? picked : [id];
    const many = ids.length > 1;
    const allSkipped = ids.every((s) => slideOf(doc.nodes[s])?.skip);
    const row = "flex h-7 w-full items-center justify-between gap-4 rounded px-2 text-left text-[11px] hover:bg-brand-500";
    const act = (fn: () => void) => () => {
        onClose();
        fn();
    };
    const all = slideIds(doc);
    const groups = slidesBySection(doc);
    const mine = groups.find((g) => g.ids.includes(id));
    const grouped = groups.filter((g) => g.ids.length > 1);
    return (
        <div ref={ref} role="menu" aria-label={many ? `${ids.length} slides` : "Slide"} className={`${MENU_CLASS} fixed z-50 w-52`} style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - 380) }}>
            <button type="button" role="menuitem" className={row} onClick={act(() => duplicateSlides(ids))}>{many ? `Duplicate ${ids.length} slides` : "Duplicate"} <span className="text-white/50">⌘ D</span></button>
            <button type="button" role="menuitem" className={row} onClick={act(() => deleteSlides(ids))}>{many ? `Delete ${ids.length} slides` : "Delete"} <span className="text-white/50">⌫</span></button>
            <button type="button" role="menuitem" className={row} onClick={act(() => toggleSkipSlides(ids))}>{allSkipped ? (many ? "Unskip slides" : "Unskip slide") : many ? "Skip slides" : "Skip slide"}</button>
            {!many && <button type="button" role="menuitem" className={row} onClick={act(() => void copySlideLink(id))}>Copy link</button>}
            <div className="my-1 h-px bg-white/10" />
            {many && <button type="button" role="menuitem" className={row} onClick={act(() => groupSlides(ids))}>Group slides</button>}
            {mine && mine.ids.length > 1 && (
                <>
                    <button type="button" role="menuitem" className={row} onClick={act(() => slides.set({ renaming: mine.section.id }))}>Rename group</button>
                    <button type="button" role="menuitem" className={row} onClick={act(() => ungroup(mine.section.id))}>Ungroup</button>
                </>
            )}
            <div className="relative" onMouseEnter={() => setGroupsOpen(true)} onMouseLeave={() => setGroupsOpen(false)}>
                <button type="button" role="menuitem" aria-haspopup="menu" className={row} onClick={() => setGroupsOpen(true)}>Move to group <span className="text-white/50">›</span></button>
                {groupsOpen && (
                    <div role="menu" className={`${MENU_CLASS} absolute left-full top-0 w-48`}>
                        {grouped.map((g) => (
                            <button key={g.section.id} type="button" role="menuitem" className={row} onClick={act(() => moveSlidesToSection(ids, g.section.id))}>
                                <span className="truncate">{groupLabel(g, all)}</span> {!many && mine === g && "✓"}
                            </button>
                        ))}
                        {grouped.length > 0 && <div className="my-1 h-px bg-white/10" />}
                        <button type="button" role="menuitem" className={row} onClick={act(() => (many ? groupSlides(ids) : moveSlidesToSection(ids, null)))}>New group</button>
                    </div>
                )}
            </div>
            {/* The slide's layout and its footer: in the reference these aren't in the right panel. */}
            {!many && (
                <div className="relative" onMouseEnter={() => setLayoutsOpen(true)} onMouseLeave={() => setLayoutsOpen(false)}>
                    <button type="button" role="menuitem" aria-haspopup="menu" className={row} onClick={() => setLayoutsOpen(true)}>Layout <span className="text-white/50">›</span></button>
                    {layoutsOpen && (
                        <div role="menu" aria-label="Layout" className={`${MENU_CLASS} absolute left-full top-0 max-h-[60vh] w-48 overflow-y-auto`}>
                            {LAYOUTS.map((l) => (
                                <button key={l.id} type="button" role="menuitem" className={row} onClick={act(() => changeLayout(id, l.id))}>
                                    <span className="truncate">{l.label}</span> {info.layout === l.id && "✓"}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {!many && deckOf(doc).footer && (
                <button type="button" role="menuitem" className={row} onClick={act(() => patchSlide(id, { noFooter: !info.noFooter }))}>
                    {info.noFooter ? "Show footer on this slide" : "Hide footer on this slide"}
                </button>
            )}
            <button type="button" role="menuitem" className={row} onClick={act(() => nudgeSlides(-1, ids))}>Move up <span className="text-white/50">⌘ [</span></button>
            <button type="button" role="menuitem" className={row} onClick={act(() => nudgeSlides(1, ids))}>Move down <span className="text-white/50">⌘ ]</span></button>
            <div className="my-1 h-px bg-white/10" />
            <button type="button" role="menuitem" className={row} onClick={act(() => addSlide("title-body", id, undefined, false, true))}>
                Insert slide above
            </button>
            <button type="button" role="menuitem" className={row} onClick={act(() => addSlide("title-body", id))}>Insert slide below</button>
            <button type="button" role="menuitem" className={row} onClick={act(() => void exportPngs(many ? ids : [id]))}>{many ? `Export ${ids.length} slides as PNG` : "Export as PNG"}</button>
        </div>
    );
}

// The selected slide's row: a grey card around the number and the thumbnail (see --slide-selected).

// Shown under a slide's number when the slide comes in with a transition.
function TransitionMark() {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-label="Has a transition" role="img">
            <title>Has a transition</title>
            <rect x="1" y="3" width="6" height="6" rx="1" opacity="0.5" />
            <rect x="5" y="3" width="6" height="6" rx="1" />
        </svg>
    );
}

function ViewButton({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: React.ReactNode }) {
    return (
        <button type="button" role="radio" aria-checked={active} aria-label={label} title={label} onClick={onPress} className={`flex h-6 w-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "bg-panel text-ink ring-1 ring-panel-border ring-inset" : "text-ink hover:bg-panel-hover"}`}>
            {children}
        </button>
    );
}

function SingleViewIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="1.6" y="3.1" width="12.8" height="9.8" rx="1.6" />
            <path d="M5.6 3.1v9.8" />
        </svg>
    );
}

function GridViewIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="1.6" y="3.1" width="5.4" height="4" rx="1.2" />
            <rect x="9" y="3.1" width="5.4" height="4" rx="1.2" />
            <rect x="1.6" y="8.9" width="5.4" height="4" rx="1.2" />
            <rect x="9" y="8.9" width="5.4" height="4" rx="1.2" />
        </svg>
    );
}

type ListDrag = { kind: "slides"; ids: string[] } | { kind: "group"; section: string };

// How far right a dragged slide must go to land indented, inside the group above.
const INDENT_AT = 64;

export function SlideList() {
    const doc = useEditor((s) => s.doc);
    const current = useCurrentSlide();
    const view = useSlides((s) => s.view);
    const slideSelected = useSlides((s) => s.slideSelected);
    const elementSelected = useEditor((s) => s.selection.length > 0);
    const readOnly = useEditor((s) => s.readOnly);
    const picked = useSelectedSlides();
    const collapsed = useSlides((s) => s.collapsed);
    const mode = useSlides((s) => s.mode);
    const newSlide = useSlides((s) => s.newSlide);
    const rows = slidesBySection(doc).filter((r) => r.ids.length);
    const numbers = slideNumbers(doc);
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [drag, setDrag] = useState<ListDrag | null>(null);
    const [drop, setDrop] = useState<{ before: string | null; indent: boolean } | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const all = rows.flatMap((r) => r.ids);

    // The current slide stays in view in the list.
    useEffect(() => {
        listRef.current?.querySelector(`[data-slide-id="${current}"]`)?.scrollIntoView({ block: "nearest" });
    }, [current]);

    const groupOf = (id: string | null | undefined) => rows.find((r) => id && r.ids.includes(id));
    // The slide after `id` as the list shows it: a folded group's first slide stands for the whole group.
    const after = (id: string): string | null => {
        const g = groupOf(id);
        if (g && g.ids[0] === id && g.ids.length > 1 && collapsed.includes(g.section.id)) return all[all.indexOf(g.ids[g.ids.length - 1] as string) + 1] ?? null;
        return all[all.indexOf(id) + 1] ?? null;
    };
    const over = (e: React.DragEvent<HTMLElement>, id: string) => {
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2 ? id : after(id);
        const left = listRef.current?.getBoundingClientRect().left ?? 0;
        const indent = before !== all[0] && e.clientX - left > INDENT_AT;
        if (!drop || drop.before !== before || drop.indent !== indent) setDrop({ before, indent });
    };
    const finish = (e: React.DragEvent) => {
        e.preventDefault();
        if (drag && drop) {
            if (drag.kind === "slides") dropSlides(drag.ids, drop.before, drop.indent);
            else dropGroup(drag.section, drop.before, drop.indent);
        }
        setDrag(null);
        setDrop(null);
    };
    // Where the line shows: indented when the drop joins the group above.
    const lineIndented = (before: string | null) => {
        if (!drop || drop.before !== before) return false;
        const above = before ? all[all.indexOf(before) - 1] : all[all.length - 1];
        return drop.indent || Boolean(before && above && groupOf(above) === groupOf(before));
    };
    const line = (before: string | null, place: "top" | "bottom") =>
        drag && drop && drop.before === before ? <div aria-hidden="true" className={`absolute right-0 h-0.5 rounded ${place === "top" ? "-top-px" : "-bottom-px"}`} style={{ left: lineIndented(before) ? 30 : 0, background: SLIDES_ORANGE }} /> : null;

    const slideRow = (id: string, nested: boolean, group?: { id: string; folded: boolean; size: number }) => {
        const node = doc.nodes[id];
        const info = slideOf(node);
        const n = numbers.get(id);
        const counter = all.indexOf(id) + 1;
        const active = id === current || (picked.length > 1 && picked.includes(id));
        // The slide itself is the selection: the whole row fills; while a layer on it is selected, only the thumbnail is outlined.
        const filled = active && slideSelected && !elementSelected;
        return (
            <div
                key={id}
                data-slide-id={id}
                role="option"
                aria-selected={active}
                aria-level={nested ? 2 : 1}
                aria-label={`Slide ${counter}${info?.skip ? ", skipped" : ""}`}
                draggable={!readOnly}
                onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-slide", id);
                    e.dataTransfer.effectAllowed = "move";
                    setDrag({ kind: "slides", ids: picked.includes(id) && picked.length > 1 ? picked : [id] });
                }}
                onDragOver={(e) => over(e, id)}
                onDrop={finish}
                onDragEnd={() => {
                    setDrag(null);
                    setDrop(null);
                }}
                onClick={(e) => clickSlide(id, e)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (!picked.includes(id)) goToSlide(id);
                    setMenu({ id, x: e.clientX, y: e.clientY });
                }}
                className={`relative flex gap-0 rounded-[6px] py-[7px] pr-[7px] ${nested ? "ml-5" : ""} ${filled ? "bg-[var(--slide-selected)] group-focus-within/list:bg-[#2A5BA8]" : "hover:bg-panel-hover"}`}
            >
                {line(id, "top")}
                <span className={`flex w-7 shrink-0 flex-col items-center gap-1 pt-px text-[12px] leading-4 tabular-nums ${filled || active ? "text-ink" : "text-ink-muted"}`}>
                    {info?.skip ? <EyeOff className="mt-0.5 size-3" aria-label="Skipped" /> : (n ?? counter)}
                    {info?.transition && info.transition.type !== "none" && <TransitionMark />}
                    {group && (
                        <button
                            type="button"
                            aria-expanded={!group.folded}
                            aria-label={group.folded ? `Expand group (${group.size} slides)` : "Collapse group"}
                            title={group.folded ? `Expand group (${group.size} slides)` : "Collapse group"}
                            onClick={(e) => {
                                e.stopPropagation();
                                slides.set({ collapsed: group.folded ? collapsed.filter((c) => c !== group.id) : [...collapsed, group.id] });
                            }}
                            className="flex size-4 items-center justify-center rounded text-ink-muted hover:bg-white/10 hover:text-ink"
                        >
                            {group.folded ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                        </button>
                    )}
                    {group?.folded && <span className="text-[10px] text-ink-muted">+{group.size - 1}</span>}
                </span>
                <div className={`min-w-0 flex-1 overflow-hidden rounded-[3px] border ${filled ? "border-white group-focus-within/list:border-[#406CB1]" : active ? "border-brand-500" : "border-panel-border"} ${info?.skip ? "opacity-40" : ""}`}>
                    <SlideThumb id={id} width={nested ? 168 : 188} />
                </div>
            </div>
        );
    };

    return (
        <aside aria-label="Slides panel" className="flex h-full w-[240px] shrink-0 flex-col border-r border-panel-border bg-panel text-ink">
            <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
                <MainMenu />
                <div className="flex-1" />
                <div role="radiogroup" aria-label="View" className="flex rounded-[5px] bg-field">
                    <ViewButton label="Single slide view" active={view === "single"} onPress={() => slides.set({ view: "single" })}>
                        <SingleViewIcon />
                    </ViewButton>
                    <ViewButton label="Grid view" active={view === "grid"} onPress={() => slides.set({ view: "grid" })}>
                        <GridViewIcon />
                    </ViewButton>
                </div>
            </div>
            <div className="flex px-4 pt-1 pb-3">
                <FileTitle />
            </div>
            <div className="border-b border-panel-border px-2 pb-2">
                <div className="flex h-6 items-stretch rounded-[5px] border border-panel-border">
                <button
                    type="button"
                    data-new-slide-trigger=""
                    aria-expanded={newSlide !== null}
                    disabled={readOnly}
                    onClick={() => slides.set({ newSlide: newSlide ? null : { view: "layouts" } })}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-l-[4px] text-[11px] font-medium text-ink outline-none hover:bg-panel-hover disabled:opacity-50 ${newSlide ? "bg-panel-hover" : ""}`}
                >
                    New slide <ChevronDown className="size-3 text-ink" />
                </button>
                <span className="w-px shrink-0 bg-panel-border" />
                <button type="button" aria-label="Add blank slide" title="Add blank slide" disabled={readOnly} onClick={() => addSlide("blank")} className="flex w-6 shrink-0 items-center justify-center rounded-r-[4px] text-ink outline-none hover:bg-panel-hover disabled:opacity-50">
                    <Plus className="size-4" />
                </button>
                </div>
            </div>
            <div
                ref={listRef}
                role="listbox"
                aria-label="Slides"
                tabIndex={0}
                className="group/list relative min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4 outline-none"
                onDragOver={(e) => {
                    // Below the last slide: the end of the deck.
                    if (!drag || e.target !== e.currentTarget) return;
                    e.preventDefault();
                    const left = e.currentTarget.getBoundingClientRect().left;
                    const indent = e.clientX - left > INDENT_AT;
                    if (!drop || drop.before !== null || drop.indent !== indent) setDrop({ before: null, indent });
                }}
                onDrop={finish}
                onKeyDown={(e) => {
                    if (!current || readOnly) return;
                    const ids = slideIds(doc);
                    const i = ids.indexOf(current);
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const to = ids[i + (e.key === "ArrowDown" ? 1 : -1)];
                        if (to) goToSlide(to);
                    } else if (e.key === "Backspace" || e.key === "Delete") {
                        e.preventDefault();
                        deleteSlides(selectedSlides());
                    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
                        e.preventDefault();
                        duplicateSlides(selectedSlides());
                    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
                        e.preventDefault();
                        slides.set({ picked: slideIds(doc) });
                    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
                        e.preventDefault();
                        if (e.shiftKey) {
                            const g = groupOf(current);
                            if (g && g.ids.length > 1) ungroup(g.section.id);
                        } else groupSlides(selectedSlides());
                    } else if (e.key === "Escape" && picked.length > 1) {
                        e.preventDefault();
                        slides.set({ picked: [] });
                    }
                }}
            >
                {rows.map(({ section, ids }) => {
                    if (ids.length < 2) return ids.map((id) => slideRow(id, false));
                    const folded = collapsed.includes(section.id);
                    return (
                        <div key={section.id} role="group" aria-label={section.name || groupLabel({ section, ids }, all)} className="group/g relative">
                            <GroupName id={section.id} name={section.name} />
                            {!readOnly && (
                                <div
                                    draggable
                                    role="button"
                                    tabIndex={-1}
                                    aria-label="Drag to move the group"
                                    title="Drag to move the group"
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        e.dataTransfer.setData("text/x-slide-group", section.id);
                                        e.dataTransfer.effectAllowed = "move";
                                        setDrag({ kind: "group", section: section.id });
                                    }}
                                    onDragEnd={() => {
                                        setDrag(null);
                                        setDrop(null);
                                    }}
                                    className="absolute -left-1 bottom-2 top-2 z-10 w-[5px] cursor-grab rounded-full bg-brand-500 opacity-0 transition-opacity group-hover/g:opacity-100"
                                />
                            )}
                            {(folded ? ids.slice(0, 1) : ids).map((id, i) => slideRow(id, i > 0, i === 0 ? { id: section.id, folded, size: ids.length } : undefined))}
                        </div>
                    );
                })}
                {drag && drop && drop.before === null && <div aria-hidden="true" className="relative h-2">{line(null, "top")}</div>}
            </div>
            {mode === "design" && current && <SlideLayers slide={current} />}
            {menu && <SlideMenu id={menu.id} at={menu} onClose={() => setMenu(null)} />}
        </aside>
    );
}

// A group's name over its slides (when it has one), typed in place after Rename group.
function GroupName({ id, name }: { id: string; name: string }) {
    const renaming = useSlides((s) => s.renaming === id);
    if (renaming) {
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
                className="mb-1 ml-1 h-6 w-[calc(100%-8px)] rounded-md border border-brand-500 bg-field px-1.5 text-[11px] text-ink outline-none"
            />
        );
    }
    if (!name) return null;
    return (
        <button type="button" title="Double-click to rename" onDoubleClick={() => slides.set({ renaming: id })} className="mb-0.5 ml-1 flex h-5 max-w-full items-center truncate rounded px-1 text-[11px] font-medium text-ink-muted hover:text-ink">
            {name}
        </button>
    );
}

// Design mode: the slide's layers under the slide list (front-most on top, as in the design
// editor's Layers panel). The slide itself is the "Slide N" heading on the right, not a row.
function SlideLayers({ slide }: { slide: string }) {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const hoverId = useEditor((s) => s.hoverId);
    const draw = useEditor((s) => s.mode === "draw");
    const renameRequest = useEditor((s) => s.renameRequest);
    const collapsed = useUi((u) => u.collapsed);
    const [drop, setDrop] = useState<DropTarget | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const toggle = (id: string) => {
        const next = new Set(ui.get().collapsed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        storeCollapsed(next);
    };
    const rows: { node: SceneNode; depth: number }[] = [];
    const visit = (ids: string[], depth: number) => {
        for (let i = ids.length - 1; i >= 0; i--) {
            const node = doc.nodes[ids[i] ?? ""];
            if (!node) continue;
            rows.push({ node, depth });
            if (!collapsed.has(node.id)) visit(node.children, depth + 1);
        }
    };
    visit(doc.nodes[slide]?.children ?? [], 0);
    const selected = new Set(selection);
    const tabStop = rows.find((r) => selected.has(r.node.id))?.node.id ?? rows[0]?.node.id;
    return (
        <section aria-label="Layers" className="flex h-[30%] min-h-40 shrink-0 flex-col border-t border-panel-border">
            <div className="flex h-11 shrink-0 items-center px-4 text-[12px] text-ink-muted">Layers</div>
            <div ref={listRef} role="tree" aria-label="Layers" aria-multiselectable="true" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onPointerLeave={() => editor.set({ hoverId: null })}>
                {rows.map(({ node, depth }) => (
                    <LayerRow
                        key={node.id}
                        node={node}
                        depth={depth}
                        expanded={!collapsed.has(node.id)}
                        onToggle={toggle}
                        drop={drop?.id === node.id ? drop.position : null}
                        onPointerDown={(event) => beginLayerDrag(event, node.id, listRef.current, setDrop)}
                        tabStop={node.id === tabStop}
                        selected={selected.has(node.id)}
                        hovered={hoverId === node.id}
                        draw={draw}
                        renameRequested={renameRequest === node.id}
                    />
                ))}
            </div>
        </section>
    );
}

// The grid view hides both side panels; the file's controls float in a pill at the top left (main
// menu, file name, New slide, the view pair) and the people, Present and Share in one at the right.
export function GridPill() {
    const name = useEditor((s) => s.doc.name);
    const readOnly = useEditor((s) => s.readOnly);
    const view = useSlides((s) => s.view);
    const newSlide = useSlides((s) => s.newSlide);
    return (
        <div className="absolute top-3 left-3 z-20 flex h-12 items-center gap-2 rounded-[13px] bg-panel px-2 text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.25)]">
            <MainMenu />
            <span className="max-w-32 truncate text-[13px] font-semibold">{name || "Untitled"}</span>
            {!readOnly && (
                <button
                    type="button"
                    data-new-slide-trigger=""
                    aria-expanded={newSlide !== null}
                    onClick={() => slides.set({ newSlide: newSlide ? null : { view: "layouts" } })}
                    className="flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                    <Plus className="size-4" /> New slide
                </button>
            )}
            <div role="radiogroup" aria-label="View" className="flex rounded-[5px] bg-field">
                <ViewButton label="Single slide view" active={view === "single"} onPress={() => slides.set({ view: "single" })}>
                    <SingleViewIcon />
                </ViewButton>
                <ViewButton label="Grid view" active={view === "grid"} onPress={() => slides.set({ view: "grid" })}>
                    <GridViewIcon />
                </ViewButton>
            </div>
        </div>
    );
}

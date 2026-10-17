import { Bookmark, Copy01, Download01, Eye, EyeOff, File06, FilePlus01, LayersThree01, MessageSquare01, Paperclip, Plus, RefreshCcw01, RefreshCw01, Trash01 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "../engine/store";
import { extractPages, insertFiles, saveAttachment } from "./actions";
import { type CommentInfo, DOC_BLUE, type OutlineItem, type PageInfo, commentLabel, formatBytes, pdfDate, toHex } from "./model";
import { scrollToPage } from "./page-view";
import { type LeftTab, docView, drawInto, edit, useDoc, workbench } from "./state";
import { FormIcon } from "./icons";
import { askText } from "../components/ask-text";

// The left side: a rail of panels (pages, bookmarks, attachments, layers, comments and form
// fields) and the open panel.

const NONE: never[] = [];

const TABS: { id: LeftTab; label: string; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { id: "pages", label: "Pages", icon: File06 },
    { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
    { id: "comments", label: "Comments", icon: MessageSquare01 },
    { id: "fields", label: "Form fields", icon: FormIcon },
    { id: "attachments", label: "Attachments", icon: Paperclip },
    { id: "layers", label: "Layers", icon: LayersThree01 },
];

export function Thumb({ index, page, width, version }: { index: number; page: PageInfo; width: number; version: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { rootMargin: "300px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const canvas = ref.current;
        if (!visible || !canvas) return;
        const timer = window.setTimeout(() => {
            try {
                drawInto(index, (width / Math.max(1, page.width)) * window.devicePixelRatio, canvas);
            } catch {
                // Left blank.
            }
        }, 30);
        return () => window.clearTimeout(timer);
    }, [visible, version, index, width, page.width, page.height]);
    return <canvas ref={ref} aria-hidden className="block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]" style={{ width, height: (page.height / Math.max(1, page.width)) * width }} />;
}

function SmallButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onPress} className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink disabled:opacity-30">
            {children}
        </button>
    );
}

// Page operations on the chosen pages (or the page in view), shared by the panel and the
// organize grid.
export function pageOps() {
    const s = docView.get();
    const count = s.info?.pages.length ?? 0;
    const chosen = (s.pageSelection.length ? s.pageSelection : [s.page]).filter((p) => p < count).sort((a, b) => a - b);
    return {
        chosen,
        rotate: (degrees: number) => edit({ op: "rotate", pages: chosen, degrees }),
        remove: () => {
            if (chosen.length >= count) return editor.notify("A PDF needs at least one page.");
            edit({ op: "delete", pages: chosen }, { pageSelection: [] });
        },
        duplicate: () => {
            const last = chosen[chosen.length - 1] ?? 0;
            edit({ op: "duplicate", pages: chosen }, { pageSelection: chosen.map((_, k) => last + 1 + k) });
        },
        insertBlank: () => {
            const at = (chosen[chosen.length - 1] ?? count - 1) + 1;
            const size = s.info?.pages[at - 1] ?? s.info?.pages[0] ?? { width: 612, height: 792 };
            edit({ op: "insertBlank", at, width: size.width, height: size.height }, { pageSelection: [at] });
        },
        insertFile: () => void insertFiles((chosen[chosen.length - 1] ?? count - 1) + 1),
        extract: () => extractPages(chosen),
        // Moves `from` so they land before page `to`.
        move: (from: number[], to: number) => {
            const before = from.filter((i) => i < to).length;
            const dest = Math.max(0, Math.min(count - from.length, to - before));
            if (from.every((p, k) => p === dest + k)) return;
            edit({ op: "move", pages: from, to: dest }, { pageSelection: from.map((_, k) => dest + k) });
        },
    };
}

export function clickPage(index: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    const s = docView.get();
    if (e.shiftKey && s.pageSelection.length) {
        const anchor = s.pageSelection[s.pageSelection.length - 1] ?? index;
        const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
        return docView.set({ pageSelection: Array.from({ length: b - a + 1 }, (_, k) => a + k) });
    }
    if (e.metaKey || e.ctrlKey) return docView.set({ pageSelection: s.pageSelection.includes(index) ? s.pageSelection.filter((p) => p !== index) : [...s.pageSelection, index] });
    docView.set({ pageSelection: [index] });
}

// Dragging pages to reorder them (pointer events, so it works with a mouse, a pen or touch):
// `attr` names the attribute holding each page's index; the drop lands before or after the page
// under the pointer along `axis`.
export function usePageDrag(attr: string, axis: "x" | "y", enabled: boolean) {
    const [drag, setDrag] = useState<{ from: number[]; dropAt: number } | null>(null);
    const start = useRef<{ x: number; y: number; from: number[]; moved: boolean; dropAt: number | null } | null>(null);
    const dragged = useRef(false);
    const handlers = (i: number) => ({
        onPointerDown: (e: React.PointerEvent) => {
            if (!enabled || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
            const sel = docView.get().pageSelection;
            start.current = { x: e.clientX, y: e.clientY, from: sel.includes(i) ? [...sel].sort((a, b) => a - b) : [i], moved: false, dropAt: null };
            dragged.current = false;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent) => {
            const st = start.current;
            if (!st || (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6)) return;
            st.moved = true;
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(`[${attr}]`);
            if (!el) return;
            const j = Number(el.getAttribute(attr));
            const r = el.getBoundingClientRect();
            const after = axis === "y" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
            st.dropAt = after ? j + 1 : j;
            setDrag({ from: st.from, dropAt: st.dropAt });
        },
        onPointerUp: () => {
            const st = start.current;
            start.current = null;
            setDrag(null);
            if (st?.moved) {
                dragged.current = true;
                if (st.dropAt !== null) pageOps().move(st.from, st.dropAt);
            }
        },
        onPointerCancel: () => {
            start.current = null;
            setDrag(null);
        },
    });
    // A click that ended a drag isn't a click.
    const wasDrag = () => {
        const d = dragged.current;
        dragged.current = false;
        return d;
    };
    return { drag, handlers, wasDrag };
}

function PagesPanel() {
    const pages = useDoc((s) => s.info?.pages ?? NONE);
    const current = useDoc((s) => s.page);
    const picked = useDoc((s) => s.pageSelection);
    const version = useDoc((s) => s.version);
    const readOnly = useEditor((s) => s.readOnly);
    const { drag, handlers, wasDrag } = usePageDrag("data-thumb", "y", !readOnly);
    const dropAt = drag?.dropAt ?? null;
    const ops = pageOps();
    const listRef = useRef<HTMLDivElement>(null);
    // Keep the page in view visible in the list.
    useEffect(() => {
        listRef.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
    }, [current]);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {!readOnly && (
                <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-panel-border px-2">
                    <SmallButton label="Rotate left" onPress={() => ops.rotate(-90)}>
                        <RefreshCcw01 className="size-3.5" />
                    </SmallButton>
                    <SmallButton label="Rotate right" onPress={() => ops.rotate(90)}>
                        <RefreshCw01 className="size-3.5" />
                    </SmallButton>
                    <SmallButton label="Insert blank page after" onPress={ops.insertBlank}>
                        <Plus className="size-3.5" />
                    </SmallButton>
                    <SmallButton label="Insert pages from a file" onPress={ops.insertFile}>
                        <FilePlus01 className="size-3.5" />
                    </SmallButton>
                    <SmallButton label="Duplicate" onPress={ops.duplicate}>
                        <Copy01 className="size-3.5" />
                    </SmallButton>
                    <SmallButton label="Extract as a new PDF" onPress={ops.extract}>
                        <Download01 className="size-3.5" />
                    </SmallButton>
                    <div className="flex-1" />
                    <SmallButton label="Delete pages" onPress={ops.remove}>
                        <Trash01 className="size-3.5" />
                    </SmallButton>
                </div>
            )}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-3" aria-label="Page thumbnails">
                {pages.map((p, i) => {
                    const chosen = picked.includes(i);
                    return (
                        <div key={i}>
                            {dropAt === i && drag && <div className="mx-6 mb-1 h-0.5 rounded" style={{ background: DOC_BLUE }} />}
                            <button
                                type="button"
                                data-thumb={i}
                                aria-label={`Page ${p.label || i + 1}`}
                                aria-current={i === current ? "page" : undefined}
                                {...handlers(i)}
                                onClick={(e) => {
                                    if (wasDrag()) return;
                                    clickPage(i, e);
                                    scrollToPage(i);
                                }}
                                className="flex w-full touch-none flex-col items-center gap-1 px-6 py-1.5 outline-none focus-visible:bg-panel-hover focus-visible:ring-2 focus-visible:ring-(--doc-accent) focus-visible:ring-inset"
                            >
                                <span className={`rounded-sm p-0.5 ${chosen ? "ring-2" : i === current ? "ring-1 ring-ink-subtle" : ""}`} style={chosen ? { boxShadow: `0 0 0 2px ${DOC_BLUE}` } : undefined}>
                                    <Thumb index={i} page={p} width={124} version={version} />
                                </span>
                                <span className={`text-[11px] ${i === current ? "font-semibold text-ink" : "text-ink-muted"}`}>{p.label || i + 1}</span>
                            </button>
                            {dropAt === pages.length && i === pages.length - 1 && drag && <div className="mx-6 mt-1 h-0.5 rounded" style={{ background: DOC_BLUE }} />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function OutlineRows({ items, path, depth }: { items: OutlineItem[]; path: number[]; depth: number }) {
    const readOnly = useEditor((s) => s.readOnly);
    const [renaming, setRenaming] = useState<number | null>(null);
    return (
        <>
            {items.map((item, i) => {
                const here = [...path, i];
                return (
                    <div key={i}>
                        <div className="group flex items-center gap-1 pr-1" style={{ paddingLeft: 8 + depth * 14 }}>
                            {renaming === i ? (
                                <input
                                    autoFocus
                                    aria-label="Bookmark name"
                                    defaultValue={item.title}
                                    onBlur={(e) => {
                                        setRenaming(null);
                                        if (e.target.value.trim() && e.target.value !== item.title) edit({ op: "renameBookmark", path: here, title: e.target.value.trim() });
                                    }}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                        if (e.key === "Escape") setRenaming(null);
                                    }}
                                    className="h-6 min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 text-[12px] outline-none"
                                />
                            ) : (
                                <button type="button" onClick={() => item.page !== null && scrollToPage(item.page)} onDoubleClick={() => !readOnly && setRenaming(i)} className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[12px] hover:bg-panel-hover">
                                    {item.title || "Untitled"}
                                </button>
                            )}
                            {item.page !== null && <span className="text-[10px] text-ink-subtle">{item.page + 1}</span>}
                            {!readOnly && (
                                <button type="button" aria-label={`Delete bookmark ${item.title}`} onClick={() => edit({ op: "deleteBookmark", path: here })} className="rounded p-0.5 text-ink-subtle opacity-0 hover:text-ink group-hover:opacity-100">
                                    <Trash01 className="size-3" />
                                </button>
                            )}
                        </div>
                        {item.children.length > 0 && <OutlineRows items={item.children} path={here} depth={depth + 1} />}
                    </div>
                );
            })}
        </>
    );
}

function BookmarksPanel() {
    const outline = useDoc((s) => s.info?.outline ?? NONE);
    const readOnly = useEditor((s) => s.readOnly);
    const add = async () => {
        const page = docView.get().page;
        const title = await askText("Bookmark name", `Page ${page + 1}`);
        if (title?.trim()) edit({ op: "addBookmark", parent: [], index: outline.length, title: title.trim(), page });
    };
    return (
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {!readOnly && (
                <button type="button" onClick={add} className="mx-2 mb-2 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3.5" /> Bookmark this page
                </button>
            )}
            {outline.length ? <OutlineRows items={outline} path={[]} depth={0} /> : <Empty text="No bookmarks yet." />}
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="px-4 py-3 text-[12px] text-ink-subtle">{text}</p>;
}

function AttachmentsPanel() {
    const attachments = useDoc((s) => s.info?.attachments ?? NONE);
    if (!attachments.length) return <Empty text="This PDF has no attached files." />;
    return (
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {attachments.map((a, i) => (
                <button key={i} type="button" onClick={() => saveAttachment(i, a.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel-hover">
                    <Paperclip className="size-3.5 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px]">{a.name}</span>
                        <span className="block truncate text-[11px] text-ink-subtle">{[a.description, a.size !== null ? formatBytes(a.size) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Download01 className="size-3.5 text-ink-subtle" />
                </button>
            ))}
        </div>
    );
}

function LayersPanel() {
    const layers = useDoc((s) => s.info?.layers ?? NONE);
    const [hidden, setHidden] = useState<Record<number, boolean>>({});
    if (!layers.length) return <Empty text="This PDF has no layers." />;
    return (
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {layers.map((l, i) => {
                const visible = hidden[i] === undefined ? l.visible : !hidden[i];
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => {
                            const w = workbench();
                            if (w?.setLayerVisible(i, !visible)) {
                                setHidden({ ...hidden, [i]: visible });
                                docView.set({ version: docView.get().version + 1 });
                            }
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-panel-hover"
                    >
                        {visible ? <Eye className="size-3.5 text-ink-muted" /> : <EyeOff className="size-3.5 text-ink-subtle" />}
                        <span className={visible ? "" : "text-ink-subtle"}>{l.name}</span>
                    </button>
                );
            })}
        </div>
    );
}

function CommentRow({ c, replies }: { c: CommentInfo; replies: CommentInfo[] }) {
    const selected = useDoc((s) => s.selected);
    const active = selected?.page === c.page && selected.index === c.index;
    return (
        <button
            type="button"
            onClick={() => {
                docView.set({ selected: { page: c.page, index: c.index }, tool: "select" });
                scrollToPage(c.page, c.rect[1], true);
            }}
            className={`w-full border-b border-panel-border px-3 py-2 text-left ${active ? "bg-panel-hover" : "hover:bg-panel-hover/60"}`}
        >
            <span className="flex items-center gap-1.5 text-[11px]">
                <span className="size-2.5 shrink-0 rounded-full border border-black/20" style={{ background: toHex(c.color) }} />
                <span className="font-semibold text-ink">{c.author || "Unknown"}</span>
                <span className="text-ink-subtle">{commentLabel(c)}</span>
                <span className="flex-1" />
                <span className="text-ink-subtle">{pdfDate(c.modified)}</span>
            </span>
            {c.contents && <span className="mt-1 line-clamp-3 block text-[12px] text-ink">{c.contents}</span>}
            {replies.length > 0 && (
                <span className="mt-1 block text-[11px] text-ink-muted">
                    {replies.length} {replies.length === 1 ? "reply" : "replies"}
                </span>
            )}
        </button>
    );
}

function CommentsPanel() {
    const comments = useDoc((s) => s.info?.comments ?? NONE);
    const [filter, setFilter] = useState("");
    const top = comments.filter((c) => !c.inReplyTo && c.subtype !== "Redact" && (!filter || `${c.author} ${c.contents} ${commentLabel(c)}`.toLowerCase().includes(filter.toLowerCase())));
    const byPage = new Map<number, CommentInfo[]>();
    for (const c of top) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-panel-border p-2">
                <input aria-label="Filter comments" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Filter comments" className="h-7 w-full rounded-md border border-panel-border bg-field px-2 text-[12px] outline-none focus:border-brand-500" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {top.length === 0 && <Empty text="No comments yet. Use the comment and markup tools to add some." />}
                {[...byPage.entries()].map(([page, list]) => (
                    <div key={page}>
                        <div className="sticky top-0 bg-panel px-3 py-1 text-[11px] font-semibold text-ink-muted">Page {page + 1}</div>
                        {list.map((c) => (
                            <CommentRow key={c.index} c={c} replies={comments.filter((r) => r.inReplyTo && r.inReplyTo === c.name)} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function FieldsPanel() {
    const fields = useDoc((s) => s.info?.fields ?? NONE);
    const readOnly = useEditor((s) => s.readOnly);
    if (!fields.length) return <Empty text="This PDF has no form fields." />;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {fields.map((f) => {
                    const w = f.widgets[0];
                    return (
                        <button key={f.name} type="button" onClick={() => w && (docView.set({ tool: "select" }), scrollToPage(w.page, w.rect[1], true))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel-hover">
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px]">
                                    {f.tooltip || f.name}
                                    {f.required && <span className="text-red-400"> *</span>}
                                </span>
                                <span className="block truncate text-[11px] text-ink-subtle">
                                    {f.kind}
                                    {f.value.length ? ` · ${f.value.join(", ")}` : ""}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            {!readOnly && (
                <div className="shrink-0 border-t border-panel-border p-2">
                    <button type="button" onClick={() => edit({ op: "resetForm" })} className="h-7 w-full rounded-md border border-panel-border text-[12px] hover:bg-panel-hover">
                        Clear form
                    </button>
                </div>
            )}
        </div>
    );
}

export function LeftPanel() {
    const tab = useDoc((s) => s.leftTab);
    const open = useDoc((s) => s.leftOpen);
    const info = useDoc((s) => s.info);
    const counts = {
        comments: info?.comments.filter((c) => !c.inReplyTo && c.subtype !== "Redact").length ?? 0,
        fields: info?.fields.length ?? 0,
        attachments: info?.attachments.length ?? 0,
        layers: info?.layers.length ?? 0,
        bookmarks: info?.outline.length ?? 0,
        pages: info?.pages.length ?? 0,
    };
    const label = TABS.find((t) => t.id === tab)?.label ?? "";
    return (
        <div className="flex h-full shrink-0 border-r border-panel-border bg-panel text-ink">
            <nav aria-label="Document panels" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-panel-border py-2">
                {TABS.map(({ id, label: name, icon: Icon }) => {
                    const n = counts[id];
                    return (
                        <button
                            key={id}
                            type="button"
                            aria-label={name}
                            aria-pressed={open && tab === id}
                            title={name}
                            onClick={() => docView.set(open && tab === id ? { leftOpen: false } : { leftTab: id, leftOpen: true })}
                            className={`relative flex size-8 items-center justify-center rounded-md outline-none ${open && tab === id ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}
                        >
                            <Icon className="size-4" />
                            {n > 0 && id !== "pages" && id !== "bookmarks" && <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full px-1 text-center text-[9px] font-semibold leading-[14px] text-white" style={{ background: DOC_BLUE }}>{n > 99 ? "99+" : n}</span>}
                        </button>
                    );
                })}
            </nav>
            {open && (
                <section aria-label={label} className="flex w-52 min-w-0 flex-col">
                    <header className="flex h-10 shrink-0 items-center px-3 text-[12px] font-semibold">
                        {label}
                        {tab === "pages" && <span className="ml-1.5 font-normal text-ink-subtle">{counts.pages}</span>}
                    </header>
                    {tab === "pages" && <PagesPanel />}
                    {tab === "bookmarks" && <BookmarksPanel />}
                    {tab === "attachments" && <AttachmentsPanel />}
                    {tab === "layers" && <LayersPanel />}
                    {tab === "comments" && <CommentsPanel />}
                    {tab === "fields" && <FieldsPanel />}
                </section>
            )}
        </div>
    );
}

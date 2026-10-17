import { DotsHorizontal, Plus, SearchSm } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { addPage, deletePage, duplicatePage } from "../engine/actions";
import { copyPageLink, isDivider, openLinkedPage, reorderPage } from "../engine/pages";
import { editor, useEditor } from "../engine/store";
import { MenuRow } from "./left-sidebar";
import { devStatusList } from "../engine/dev-status";

const DRAG_THRESHOLD = 3;

// The Pages list: click to open, double-click to rename, drag to reorder, right-click (or …) for
// the page menu. Empty pages named with a leading dash are dividers, drawn as a line.
export function PagesList() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    // Inspect marks the pages that hold designs with a status.
    const devMode = useEditor((s) => s.mode === "dev");
    const readyPages = new Set(devMode ? devStatusList(doc).filter((d) => d.status !== "completed").map((d) => d.pageId) : []);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [query, setQuery] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [drag, setDrag] = useState<{ id: string; startY: number; moved: boolean; index: number | null; top: number | null } | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const menuAnchor = useRef<HTMLDivElement>(null);

    // A link to a page opens on it once the file is here.
    useEffect(() => openLinkedPage(doc), [doc]);

    const q = query?.trim().toLowerCase() ?? "";
    const pages = doc.roots.filter((id) => !doc.nodes[id]?.internal).filter((id) => !q || (!isDivider(doc.nodes[id]) && (doc.nodes[id]?.name ?? "").toLowerCase().includes(q)));

    // Where a drag would drop: the gap nearest the pointer, as an index into the list without the page.
    const dropIndex = (clientY: number, id: string): number => {
        const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-page-row]") ?? [])].filter((el) => el.dataset.pageRow !== id);
        const without = doc.roots.filter((r) => r !== id);
        const next = rows.find((el) => {
            const r = el.getBoundingClientRect();
            return clientY < r.top + r.height / 2;
        });
        if (next) return without.indexOf(next.dataset.pageRow ?? "");
        const last = rows[rows.length - 1]?.dataset.pageRow;
        return last ? without.indexOf(last) + 1 : 0;
    };

    // Where the drop line sits for a drop index, relative to the list.
    const lineAt = (index: number, id: string): number | null => {
        const without = doc.roots.filter((r) => r !== id);
        const after = without[index - 1];
        const rows = listRef.current;
        const container = rows?.getBoundingClientRect();
        const target = rows?.querySelector<HTMLElement>(`[data-page-row="${after ?? without[0] ?? ""}"]`);
        const r = target?.getBoundingClientRect();
        if (!container || !r) return null;
        return (after ? r.bottom : r.top) - container.top;
    };
    const indicatorTop = drag?.moved ? drag.top : null;

    const runMenu = (id: string, key: string) => {
        setMenu(null);
        if (key === "link") copyPageLink(id);
        else if (key === "rename") setRenaming(id);
        else if (key === "duplicate") duplicatePage(id);
        else if (key === "delete") void deletePage(id);
    };
    const menuPage = menu ? doc.nodes[menu.id] : undefined;

    return (
        <section className="max-h-56 shrink-0 overflow-y-auto px-2 pt-1 pb-2">
            <div className="flex h-8 items-center justify-between pr-0 pl-2">
                <span className="font-semibold">Pages</span>
                <div className="flex items-center">
                    <AriaButton aria-label="Search pages" onPress={() => setQuery(query === null ? "" : null)} className={`flex size-6 items-center justify-center rounded outline-none hover:bg-panel-hover hover:text-ink ${query !== null ? "text-ink" : "text-ink-muted"}`}>
                        <SearchSm className="size-3.5" />
                    </AriaButton>
                    <AriaButton aria-label="Add page" onPress={() => setRenaming(addPage())} className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                        <Plus className="size-3.5" />
                    </AriaButton>
                </div>
            </div>
            {query !== null && (
                <input
                    autoFocus
                    value={query}
                    placeholder="Search pages"
                    aria-label="Search pages"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") setQuery(null);
                    }}
                    className="mb-1 h-7 w-full rounded-md bg-field px-2 outline-none placeholder:text-ink-subtle"
                />
            )}
            <div ref={listRef} className="relative">
                {pages.map((id) => {
                    const page = doc.nodes[id];
                    if (!page) return null;
                    const divider = isDivider(page);
                    const current = id === pageId;
                    const lifted = drag?.moved && drag.id === id;
                    return (
                        <div
                            key={id}
                            data-page-row={id}
                            onPointerDown={(e) => {
                                if (e.button !== 0 || renaming === id || q) return;
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setDrag({ id, startY: e.clientY, moved: false, index: null, top: null });
                            }}
                            onPointerMove={(e) => {
                                if (!drag || drag.id !== id) return;
                                const moved = drag.moved || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD;
                                if (!moved) return;
                                const index = dropIndex(e.clientY, id);
                                setDrag({ ...drag, moved, index, top: lineAt(index, id) });
                            }}
                            onPointerUp={(e) => {
                                if (!drag || drag.id !== id) return;
                                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                                if (drag.moved && drag.index !== null) reorderPage(id, drag.index);
                                else if (!divider && (e.target as HTMLElement).closest("button") === null) editor.setPage(id);
                                setDrag(null);
                            }}
                            onPointerCancel={() => setDrag(null)}
                            onDoubleClick={() => setRenaming(id)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setMenu({ id, x: e.clientX, y: e.clientY });
                            }}
                            // A 32pt row with its highlight 24 tall inside it (the reference's selected page).
                            className={`group relative isolate flex cursor-default items-center gap-1.5 pr-1 pl-2 before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-1 before:-z-10 before:rounded-[5px] ${divider && renaming !== id ? "h-4" : "h-8"} ${lifted ? "opacity-50" : ""} ${current && !divider ? "font-semibold text-ink before:bg-panel-hover" : "text-ink hover:before:bg-panel-hover"}`}
                        >
                            {renaming === id ? (
                                <input
                                    autoFocus
                                    defaultValue={page.name}
                                    aria-label="Page name"
                                    onFocus={(event) => event.currentTarget.select()}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    className="min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 outline-none"
                                    onBlur={(event) => {
                                        const value = event.target.value.trim();
                                        if (value && value !== page.name) {
                                            if (value.startsWith("-") && page.children.length) editor.notify("A page with content can't become a divider.");
                                            editor.execute({ type: "node.update", id, patch: { name: value } });
                                        }
                                        setRenaming(null);
                                    }}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === "Enter") event.currentTarget.blur();
                                        if (event.key === "Escape") setRenaming(null);
                                    }}
                                />
                            ) : divider ? (
                                <span className="h-px flex-1 bg-ink-subtle opacity-60" aria-label="Divider" />
                            ) : (
                                <>
                                    <span className="min-w-0 flex-1 truncate">{page.name}</span>
                                    {devMode && readyPages.has(page.id) && <span className="size-2 shrink-0 rounded-full bg-[#14AE5C]" title="Has designs ready for development" aria-label="Has designs ready for development" />}
                                    <button
                                        type="button"
                                        aria-label="Page actions"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            const r = e.currentTarget.getBoundingClientRect();
                                            setMenu({ id, x: r.left, y: r.bottom });
                                        }}
                                        className="flex size-6 items-center justify-center rounded text-ink-muted opacity-0 outline-none group-hover:opacity-100 hover:bg-black/20"
                                    >
                                        <DotsHorizontal className="size-3.5" />
                                    </button>
                                </>
                            )}
                        </div>
                    );
                })}
                {indicatorTop !== null && <span className="pointer-events-none absolute right-0 left-2 h-0.5 rounded bg-brand-500" style={{ top: indicatorTop - 1 }} />}
            </div>
            {pages.length === 0 && <p className="px-2 py-1 text-ink-subtle">No pages match.</p>}
            {menu && menuPage && (
                <>
                    <div ref={menuAnchor} className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />
                    <AriaPopover triggerRef={menuAnchor} isOpen onOpenChange={(open) => !open && setMenu(null)} placement="bottom start" className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu aria-label="Page actions" autoFocus="first" className="outline-none" onAction={(k) => runMenu(menu.id, String(k))}>
                            {isDivider(menuPage) ? (
                                <>
                                    <MenuRow id="rename" label="Rename divider" />
                                    <MenuRow id="delete" label="Delete divider" />
                                </>
                            ) : (
                                <>
                                    <MenuRow id="link" label="Copy link to page" />
                                    <AriaSeparator className="my-1 h-px bg-white/10" />
                                    <MenuRow id="rename" label="Rename page" />
                                    <MenuRow id="duplicate" label="Duplicate page" />
                                    <MenuRow id="delete" label="Delete page" />
                                </>
                            )}
                        </AriaMenu>
                    </AriaPopover>
                </>
            )}
        </section>
    );
}

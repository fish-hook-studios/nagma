import { Copy01, Download01, FilePlus01, Plus, RefreshCcw01, RefreshCw01, Scissors01, Trash01 } from "@untitledui/icons";
import { useEditor } from "../engine/store";
import { DOC_BLUE } from "./model";
import { Thumb, clickPage, pageOps, usePageDrag } from "./left-panel";
import { scrollToPage } from "./page-view";
import { docView, useDoc } from "./state";

// Organize pages: every page in a grid to reorder by dragging, rotate, delete, duplicate,
// insert (blank or from other files), extract and split.

function Action({ label, onPress, children, danger, disabled }: { label: string; onPress: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
    return (
        <button type="button" onClick={onPress} disabled={disabled} className={`flex h-7 items-center gap-1.5 rounded-md border border-panel-border px-2 text-[12px] hover:bg-panel-hover disabled:opacity-40 ${danger ? "text-red-400" : "text-ink"}`}>
            {children}
            {label}
        </button>
    );
}

export function OrganizeView() {
    const pages = useDoc((s) => s.info?.pages);
    const picked = useDoc((s) => s.pageSelection);
    const version = useDoc((s) => s.version);
    const readOnly = useEditor((s) => s.readOnly);
    const { drag, handlers, wasDrag } = usePageDrag("data-grid-page", "x", !readOnly);
    const dropAt = drag?.dropAt ?? null;
    const ops = pageOps();
    const list = pages ?? [];
    const none = !picked.length;
    return (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
            <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-panel-border bg-panel px-3 py-1.5 text-ink">
                <span className="mr-2 text-[12px] font-semibold">Organize pages</span>
                <span className="mr-2 text-[11px] text-ink-muted">{none ? `${list.length} pages` : `${picked.length} selected`}</span>
                {!readOnly && (
                    <>
                        <Action label="Left" onPress={() => ops.rotate(-90)} disabled={none}>
                            <RefreshCcw01 className="size-3.5" />
                        </Action>
                        <Action label="Right" onPress={() => ops.rotate(90)} disabled={none}>
                            <RefreshCw01 className="size-3.5" />
                        </Action>
                        <Action label="Duplicate" onPress={ops.duplicate} disabled={none}>
                            <Copy01 className="size-3.5" />
                        </Action>
                        <Action label="Blank page" onPress={ops.insertBlank}>
                            <Plus className="size-3.5" />
                        </Action>
                        <Action label="Insert or merge files" onPress={ops.insertFile}>
                            <FilePlus01 className="size-3.5" />
                        </Action>
                    </>
                )}
                <Action label="Extract" onPress={ops.extract} disabled={none}>
                    <Download01 className="size-3.5" />
                </Action>
                <Action label="Split" onPress={() => docView.set({ dialog: "split" })}>
                    <Scissors01 className="size-3.5" />
                </Action>
                {!readOnly && (
                    <Action label="Delete" danger onPress={ops.remove} disabled={none}>
                        <Trash01 className="size-3.5" />
                    </Action>
                )}
                <div className="flex-1" />
                <button type="button" onClick={() => docView.set({ view: "read" })} className="h-7 rounded-md px-3 text-[12px] font-semibold text-white" style={{ background: DOC_BLUE }}>
                    Done
                </button>
            </div>
            <div aria-label="Page grid" className="min-h-0 flex-1 overflow-y-auto p-6" onClick={(e) => e.target === e.currentTarget && docView.set({ pageSelection: [] })}>
                <div className="flex flex-wrap gap-6">
                    {list.map((p, i) => {
                        const chosen = picked.includes(i);
                        return (
                            <div
                                key={i}
                                role="button"
                                tabIndex={0}
                                aria-label={`Page ${i + 1}`}
                                aria-pressed={chosen}
                                data-grid-page={i}
                                {...handlers(i)}
                                onClick={(e) => !wasDrag() && clickPage(i, e)}
                                // Space or Enter picks the page from the keyboard, as a click does.
                                onKeyDown={(e) => {
                                    if (e.key !== " " && e.key !== "Enter") return;
                                    e.preventDefault();
                                    clickPage(i, e);
                                }}
                                onDoubleClick={() => {
                                    docView.set({ view: "read" });
                                    requestAnimationFrame(() => scrollToPage(i));
                                }}
                                className="relative flex cursor-default touch-none flex-col items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--doc-accent)"
                            >
                                {drag && dropAt === i && <div className="absolute -left-3.5 top-0 h-full w-0.5 rounded" style={{ background: DOC_BLUE }} />}
                                {drag && dropAt === i + 1 && i === list.length - 1 && <div className="absolute -right-3.5 top-0 h-full w-0.5 rounded" style={{ background: DOC_BLUE }} />}
                                <span className="rounded-sm p-0.5" style={chosen ? { boxShadow: `0 0 0 2px ${DOC_BLUE}` } : undefined}>
                                    <Thumb index={i} page={p} width={150} version={version} />
                                </span>
                                <span className={`text-[11px] ${chosen ? "font-semibold text-ink" : "text-ink-muted"}`}>
                                    {i + 1}
                                    {p.rotation ? ` · ${p.rotation}°` : ""}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

import { ArrowLeft, ClockRewind, Link01, X } from "@untitledui/icons";
import { viewport, worldToScreen, zoomToSelection } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";
import { useState } from "react";
import { collab } from "../engine/collab";
import { resetFocusOverrides, setFocusOverrides, useFocusOverrides } from "../engine/dev-focus";
import { collectionsOf } from "../engine/variables";
import { DEV_STATUS_COLORS, DEV_STATUS_LABELS, type DevStatus, devStatusList, devStatusOf, setDevStatus } from "../engine/dev-status";
import { closeDevView, inspectOnPage, leaveFocus, openFocus, openReadyView, useDevView } from "../engine/dev-view";
import { copyLink } from "../engine/links";
import { useEditor } from "../engine/store";
import { renderThumb } from "../engine/thumb";
import type { NagmaDocument } from "../engine/types";
import { Select } from "./select";

// Inspect's Ready for dev view (a list of every design with a status, filtered and sorted) and
// the focus view's bar (back to the list, mark completed, inspect on page, close).

const STATUS_COLORS = DEV_STATUS_COLORS;

type Filter = "all" | "ready" | "completed";
type Sort = "recent" | "page" | "name";

function Thumb({ doc, id }: { doc: NagmaDocument; id: string }) {
    const node = doc.nodes[id];
    const src = renderThumb(doc, 320, 200, id);
    return <img src={src} alt={node ? `${node.name} preview` : ""} className="aspect-[8/5] w-full rounded-t-lg bg-[#2A2A2E] object-contain" />;
}

function StatusBadge({ status }: { status: DevStatus }) {
    return (
        <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-white">
            <span className="size-1.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
            {DEV_STATUS_LABELS[status]}
        </span>
    );
}

export function ReadyForDevView() {
    const doc = useEditor((s) => s.doc);
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<Sort>("recent");
    const all = devStatusList(doc);
    const list = all
        .filter((d) => filter === "all" || (filter === "ready" ? d.status === "ready" || d.status === "changed" : d.status === "completed"))
        .sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "page") return doc.roots.indexOf(a.pageId) - doc.roots.indexOf(b.pageId) || a.name.localeCompare(b.name);
            return (doc.nodes[b.id]?.devReady?.at ?? 0) - (doc.nodes[a.id]?.devReady?.at ?? 0);
        });
    const count = (f: Filter) => all.filter((d) => f === "all" || (f === "ready" ? d.status !== "completed" : d.status === "completed")).length;
    return (
        <div className="absolute inset-0 z-20 flex flex-col bg-canvas text-[12px] text-ink" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <div className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-panel-border bg-panel px-4 whitespace-nowrap">
                <h2 className="text-[13px] font-semibold">Ready for development</h2>
                <span className="rounded-full bg-field px-2 py-0.5 text-[11px] text-ink-muted">{all.length}</span>
                <div className="ml-2 flex shrink-0 rounded-md bg-field p-0.5" role="tablist" aria-label="Filter">
                    {(["all", "ready", "completed"] as const).map((f) => (
                        <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`h-6 rounded px-2 ${filter === f ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                            {f === "all" ? "All" : f === "ready" ? "Ready" : "Completed"} <span className="text-ink-subtle">{count(f)}</span>
                        </button>
                    ))}
                </div>
                <label className="ml-auto flex shrink-0 items-center gap-2 text-ink-muted">
                    Sort by
                    <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 rounded-md border border-panel-border bg-field px-1.5 text-ink">
                        <option value="recent">Recent activity</option>
                        <option value="page">Pages</option>
                        <option value="name">Name (A to Z)</option>
                    </Select>
                </label>
                <button type="button" aria-label="Close" onClick={closeDevView} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <X className="size-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {list.length === 0 ? (
                    <p className="mx-auto mt-16 max-w-sm text-center text-ink-muted">{all.length ? "Nothing matches this filter." : "No designs have a status yet. Designers mark frames, sections and components as ready for dev from the canvas."}</p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                        {list.map((d) => {
                            const node = doc.nodes[d.id];
                            const page = doc.nodes[d.pageId];
                            const at = node?.devReady?.at;
                            return (
                                <button key={d.id} type="button" onClick={() => openFocus(d.id, "list")} className="group relative overflow-hidden rounded-lg border border-panel-border bg-panel text-left outline-none hover:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500">
                                    <Thumb doc={doc} id={d.id} />
                                    <span className="absolute top-2 right-2">
                                        <StatusBadge status={d.status} />
                                    </span>
                                    <span className="block px-3 py-2">
                                        <span className="block truncate font-medium">{d.name}</span>
                                        <span className="block truncate text-[11px] text-ink-muted">
                                            {page?.name}
                                            {at ? ` · ${new Date(at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                                        </span>
                                        {d.note && <span className="mt-1 block truncate text-[11px] text-ink-subtle">{d.note}</span>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// W and H the design is shown at (typing a size previews it; the file stays as it is).
function SizeField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        const n = Number(draft);
        if (draft !== null && Number.isFinite(n) && n >= 1) onCommit(Math.round(n));
        setDraft(null);
    };
    return (
        <label className="flex h-7 items-center gap-1 rounded-md bg-field px-1.5 text-ink-muted" title={`${label === "W" ? "Width" : "Height"} to try (the file doesn't change)`}>
            {label}
            <input
                aria-label={label === "W" ? "Preview width" : "Preview height"}
                value={draft ?? String(value)}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commit}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                        setDraft(null);
                        e.currentTarget.blur();
                    }
                }}
                inputMode="numeric"
                className="w-11 bg-transparent text-ink outline-none"
            />
        </label>
    );
}

export function FocusBar({ id }: { id: string }) {
    const doc = useEditor((s) => s.doc);
    const node = doc.nodes[id];
    const status = devStatusOf(doc, node);
    const fromList = useDevView();
    const overrides = useFocusOverrides();
    const back = fromList?.kind === "focus" && fromList.back === "list";
    const collections = collectionsOf(doc).filter((c) => c.modes.length > 1);
    const trying = overrides.w !== null || overrides.h !== null || Object.keys(overrides.modes).length > 0;
    if (!node) return null;
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-2 overflow-x-auto border-b border-panel-border bg-panel px-3 text-[12px] whitespace-nowrap text-ink" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <button type="button" onClick={openReadyView} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                <ArrowLeft className="size-3.5" />
                See all ready for dev
            </button>
            <span className="mx-1 h-5 w-px bg-panel-border" />
            <span className="max-w-60 shrink-0 truncate font-semibold">{node.name}</span>
            {status && <StatusBadge status={status} />}
            <span className="mx-1 h-5 w-px bg-panel-border" />
            <SizeField label="W" value={Math.round(overrides.w ?? node.w)} onCommit={(w) => setFocusOverrides({ w })} />
            <SizeField label="H" value={Math.round(overrides.h ?? node.h)} onCommit={(h) => setFocusOverrides({ h })} />
            {collections.map((c) => (
                <Select
                    key={c.id}
                    aria-label={`${c.name} mode`}
                    title={`Preview a mode of ${c.name}`}
                    value={overrides.modes[c.id] ?? ""}
                    onChange={(e) => {
                        const modes = { ...overrides.modes };
                        if (e.target.value) modes[c.id] = e.target.value;
                        else delete modes[c.id];
                        setFocusOverrides({ modes });
                    }}
                    className="h-7 max-w-40 rounded-md border border-transparent bg-field px-1 text-ink hover:border-panel-border"
                >
                    <option value="">{c.name}: as designed</option>
                    {c.modes.map((m) => (
                        <option key={m.id} value={m.id}>
                            {c.name}: {m.name}
                        </option>
                    ))}
                </Select>
            ))}
            {trying && (
                <button type="button" onClick={resetFocusOverrides} className="h-7 rounded-md px-2 text-brand-500 hover:bg-panel-hover">
                    Reset
                </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => collab.set({ historyOpen: true })} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink" title="Version history">
                <ClockRewind className="size-3.5" />
                History
            </button>
            {status && status !== "completed" && (
                <button type="button" onClick={() => setDevStatus([id], "completed")} className="h-7 rounded-md bg-brand-500 px-2.5 font-semibold text-white hover:bg-brand-600">
                    Mark as completed
                </button>
            )}
            <button type="button" onClick={() => void copyLink("focus")} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink" title="Copy link to focus view">
                <Link01 className="size-3.5" />
                Copy link
            </button>
            <button type="button" onClick={inspectOnPage} className="h-7 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                Inspect on page
            </button>
            <button type="button" aria-label={back ? "Back to the list" : "Close focus view"} onClick={leaveFocus} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                <X className="size-4" />
            </button>
        </div>
    );
}

export function DevViews() {
    const view = useDevView();
    const mode = useEditor((s) => s.mode);
    if (mode !== "dev") return null;
    if (!view) return <RecenterPill />;
    return view.kind === "list" ? <ReadyForDevView /> : <FocusBar id={view.id} />;
}

// Inspect: when the selection is out of view, a pill above the toolbar brings it back (⇧2).
function RecenterPill() {
    const off = useEditor((s) => {
        const box = s.selection.length ? selectionBounds(s.doc, s.selection) : null;
        if (!box) return false;
        const a = worldToScreen(s.camera, box.x, box.y);
        const b = worldToScreen(s.camera, box.x + box.w, box.y + box.h);
        return b.x < 0 || b.y < 0 || a.x > viewport.width || a.y > viewport.height;
    });
    if (!off) return null;
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-[76px] z-10 flex justify-center">
            <button type="button" onClick={zoomToSelection} className="pointer-events-auto flex h-8 items-center gap-2 rounded-full bg-tooltip px-3 text-[11px] text-white shadow-lg outline-none hover:bg-black focus-visible:ring-2 focus-visible:ring-brand-500">
                Re-center
                <span className="text-white/50">⇧2</span>
            </button>
        </div>
    );
}

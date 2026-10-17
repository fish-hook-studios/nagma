import { ChevronLeft, ChevronRight, Folder, Grid01, List, SearchSm } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { type AssetEntry, type AssetFolder, type AssetSource, assetTree, countItems, folderAt } from "../engine/asset-tree";
import { EntryThumb } from "./asset-thumb";
import { ComponentIcon } from "./component-icons";

// The instance swap menu: it opens on the folder that holds the current component
// (its related components), with preferred instances first when the property names some. A back
// arrow walks up through folders, frames and pages to every library; typing searches them all.

export interface SwapTarget {
    source: AssetSource;
    entry: AssetEntry;
}

type View = { sourceId: string; path: string[] } | null;

const VIEW_KEY = "nagma.swap.view";

function initialMode(): "grid" | "list" {
    try {
        return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
        return "list";
    }
}

export function SwapMenu({
    sources,
    current,
    preferred = [],
    onPick,
    title = "Swap instance",
}: {
    sources: AssetSource[];
    // The asset (component or set) the instance uses now, in whichever source holds it.
    current: { sourceId: string; assetId: string } | null;
    // Asset ids (local or library) to list first.
    preferred?: { sourceId: string; assetId: string }[];
    onPick: (target: SwapTarget) => void;
    title?: string;
}) {
    const [query, setQuery] = useState("");
    const [mode, setModeState] = useState<"grid" | "list">(initialMode);
    const setMode = (m: "grid" | "list") => {
        setModeState(m);
        try {
            localStorage.setItem(VIEW_KEY, m);
        } catch {
            // Remembered for this session only.
        }
    };
    const trees = useMemo(() => new Map(sources.map((s) => [s.id, assetTree(s.entries, s.name)])), [sources]);
    const start = useMemo<View>(() => {
        if (!current) return null;
        const source = sources.find((s) => s.id === current.sourceId);
        const entry = source?.entries.find((e) => e.id === current.assetId);
        return source && entry ? { sourceId: source.id, path: entry.path } : null;
    }, [current, sources]);
    const [view, setView] = useState<View>(start);

    const q = query.trim().toLowerCase();
    const preferredTargets = preferred.flatMap((p) => {
        const source = sources.find((s) => s.id === p.sourceId);
        const entry = source?.entries.find((e) => e.id === p.assetId);
        return source && entry ? [{ source, entry }] : [];
    });

    const items = (list: SwapTarget[]) =>
        mode === "grid" ? (
            <div className="grid grid-cols-3 gap-1.5 p-1">
                {list.map((t) => (
                    <SwapTile key={`${t.source.id}:${t.entry.id}`} target={t} active={current?.assetId === t.entry.id && current.sourceId === t.source.id} onPick={onPick} />
                ))}
            </div>
        ) : (
            <div className="p-1">
                {list.map((t) => (
                    <SwapRow key={`${t.source.id}:${t.entry.id}`} target={t} active={current?.assetId === t.entry.id && current.sourceId === t.source.id} onPick={onPick} />
                ))}
            </div>
        );

    let body: React.ReactNode;
    if (q) {
        const groups = sources
            .map((s) => ({ source: s, hits: s.entries.filter((e) => e.node.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.path.some((p) => p.toLowerCase().includes(q))) }))
            .filter((g) => g.hits.length);
        body = groups.length ? (
            groups.map((g) => (
                <div key={g.source.id}>
                    <div className="px-2 pt-2 text-[11px] font-semibold text-ink-muted">{g.source.name}</div>
                    {items(g.hits.map((entry) => ({ source: g.source, entry })))}
                </div>
            ))
        ) : (
            <p className="px-3 py-4 text-center text-ink-muted">No components match "{query.trim()}"</p>
        );
    } else if (!view) {
        body = (
            <div className="p-1">
                {preferredTargets.length > 0 && (
                    <>
                        <div className="px-2 pt-1 text-[11px] font-semibold text-ink-muted">Preferred</div>
                        {items(preferredTargets)}
                        <div className="mx-2 my-1 border-t border-panel-border" />
                    </>
                )}
                {sources.map((s) => (
                    <button key={s.id} type="button" onClick={() => setView({ sourceId: s.id, path: [] })} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                        <ComponentIcon className="size-3.5 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1 truncate">{s.local ? "Local components" : s.name}</span>
                        <span className="text-ink-subtle">{s.entries.length}</span>
                        <ChevronRight className="size-3.5 text-ink-subtle" />
                    </button>
                ))}
            </div>
        );
    } else {
        const source = sources.find((s) => s.id === view.sourceId);
        const tree = trees.get(view.sourceId);
        const folder: AssetFolder | null = tree ? folderAt(tree, view.path) : null;
        body = source && folder ? (
            <>
                {view.path.length === 0 && preferredTargets.length > 0 && (
                    <>
                        <div className="px-2 pt-2 text-[11px] font-semibold text-ink-muted">Preferred</div>
                        {items(preferredTargets)}
                    </>
                )}
                {folder.folders.length > 0 && (
                    <div className="p-1">
                        {folder.folders.map((f) => (
                            <button key={f.name} type="button" onClick={() => setView({ sourceId: view.sourceId, path: f.path })} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                                <Folder className="size-3.5 shrink-0 text-ink-muted" />
                                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                <span className="text-ink-subtle">{countItems(f)}</span>
                                <ChevronRight className="size-3.5 text-ink-subtle" />
                            </button>
                        ))}
                    </div>
                )}
                {folder.items.length > 0 && items(folder.items.map((entry) => ({ source, entry })))}
                {folder.items.length === 0 && folder.folders.length === 0 && <p className="px-3 py-4 text-center text-ink-muted">Nothing here</p>}
            </>
        ) : (
            <p className="px-3 py-4 text-center text-ink-muted">This library isn't available</p>
        );
    }

    const crumb = view ? [view.path.length ? view.path[view.path.length - 1] : (sources.find((s) => s.id === view.sourceId)?.name ?? "")] : [];
    return (
        <div className="flex w-72 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{title}</span>
                <button type="button" aria-label="List view" aria-pressed={mode === "list"} onClick={() => setMode("list")} className={`flex size-6 items-center justify-center rounded ${mode === "list" ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                    <List className="size-3.5" />
                </button>
                <button type="button" aria-label="Grid view" aria-pressed={mode === "grid"} onClick={() => setMode("grid")} className={`flex size-6 items-center justify-center rounded ${mode === "grid" ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                    <Grid01 className="size-3.5" />
                </button>
            </div>
            <label className="mx-2 mt-2 flex h-7 shrink-0 items-center gap-2 rounded-md border border-panel-border bg-field px-2 text-ink-muted focus-within:border-brand-500">
                <SearchSm className="size-3.5 shrink-0" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search" aria-label="Search components" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            {!q && view && (
                <button
                    type="button"
                    onClick={() => setView(view.path.length ? { sourceId: view.sourceId, path: view.path.slice(0, -1) } : null)}
                    className="mx-1 mt-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-left font-semibold hover:bg-panel-hover"
                >
                    <ChevronLeft className="size-3.5 text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{crumb[0]}</span>
                </button>
            )}
            <div className="max-h-80 min-h-16 overflow-y-auto pb-1">{body}</div>
        </div>
    );
}

function SwapRow({ target, active, onPick }: { target: SwapTarget; active: boolean; onPick: (t: SwapTarget) => void }) {
    return (
        <button
            type="button"
            title={target.entry.description || undefined}
            onClick={() => onPick(target)}
            className={`flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-panel-hover ${active ? "bg-brand-500/15" : ""}`}
        >
            <EntryThumb source={target.source} entry={target.entry} w={64} h={48} className="h-7 w-8 shrink-0 rounded" />
            <span className="min-w-0 flex-1 truncate">{target.entry.name}</span>
            {active && <span className="text-brand-500">✓</span>}
        </button>
    );
}

function SwapTile({ target, active, onPick }: { target: SwapTarget; active: boolean; onPick: (t: SwapTarget) => void }) {
    return (
        <button
            type="button"
            title={target.entry.description ? `${target.entry.name}\n${target.entry.description}` : target.entry.name}
            onClick={() => onPick(target)}
            className={`overflow-hidden rounded-md border text-left ${active ? "border-brand-500" : "border-panel-border hover:border-ink-subtle"}`}
        >
            <EntryThumb source={target.source} entry={target.entry} w={120} h={90} className="aspect-[4/3] w-full" />
            <div className="truncate px-1 py-0.5 text-[10.5px]">{target.entry.name}</div>
        </button>
    );
}

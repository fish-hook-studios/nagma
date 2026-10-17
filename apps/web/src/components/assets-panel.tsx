import { isHiddenName, setHiddenFromPublishing, useLibraryUpdates } from "../engine/library";
import { PointMenu, type PointMenuItem } from "./point-menu";
import { BookOpen01, ChevronDown, ChevronLeft, ChevronRight, Grid01, List, SearchSm } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { type AssetEntry, type AssetFolder, type AssetSource, assetTree, countItems } from "../engine/asset-tree";
import { viewCenter } from "../engine/actions";
import { useEditor } from "../engine/store";
import { encodeAssetDrag, placeAsset, useAssetSources } from "./asset-sources";
import { EntryThumb } from "./asset-thumb";
import { ComponentIcon } from "./component-icons";
import { openLibraries } from "./library-ui";

// Assets: components created in this file, then every library the file has turned
// on (Libraries, the book button). Inside each, components are grouped by page, then by the frame
// they sit in, then by "/" folders in their names. Click to place one, or drag it onto the canvas.

const VIEW_KEY = "nagma.assets.view";

function savedView(): "grid" | "list" {
    try {
        return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
        return "grid";
    }
}

export function AssetsPanel() {
    const sources = useAssetSources();
    const fileName = useEditor((s) => s.doc.name);
    const updateCount = useLibraryUpdates().updates.length;
    const [query, setQuery] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);
    const [view, setViewState] = useState<"grid" | "list">(savedView);
    const setView = (v: "grid" | "list") => {
        setViewState(v);
        try {
            localStorage.setItem(VIEW_KEY, v);
        } catch {
            // This session only.
        }
    };
    const q = query.trim().toLowerCase();
    const current = sources.find((s) => s.id === openId) ?? null;
    const label = (s: AssetSource) => (s.local ? "Created in this file" : s.name);

    const header = (
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
            {current ? (
                <AriaButton aria-label="All assets" onPress={() => setOpenId(null)} className="flex size-7 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <ChevronLeft className="size-4" />
                </AriaButton>
            ) : (
                <span className="w-2" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{current ? label(current) : "Assets"}</span>
            <AriaButton aria-label={view === "grid" ? "Show as list" : "Show as grid"} onPress={() => setView(view === "grid" ? "list" : "grid")} className="flex size-7 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                {view === "grid" ? <List className="size-4" /> : <Grid01 className="size-4" />}
            </AriaButton>
            <AriaButton aria-label={updateCount ? `Libraries, ${updateCount} update${updateCount === 1 ? "" : "s"}` : "Libraries"} onPress={() => openLibraries(updateCount ? "updates" : "libraries")} className="relative flex size-7 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <BookOpen01 className="size-4" />
                {updateCount > 0 && <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-brand-500 ring-2 ring-panel" />}
            </AriaButton>
        </div>
    );
    const search = (
        <div className="shrink-0 px-3 pb-2">
            <label className="flex h-8 items-center gap-2 rounded-md border border-panel-border bg-panel px-2 text-ink-muted focus-within:border-brand-500">
                <SearchSm className="size-4 shrink-0" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={current ? `Search ${label(current)}` : "Search assets"} aria-label="Search assets" onKeyDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-subtle" />
            </label>
        </div>
    );

    let body: React.ReactNode;
    if (q) {
        const scope = current ? [current] : sources;
        const groups = scope.map((s) => ({ source: s, hits: s.entries.filter((e) => e.node.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)) })).filter((g) => g.hits.length);
        body = groups.length ? (
            groups.map((g) => (
                <div key={g.source.id} className="mb-3">
                    <div className="px-1 pb-1 text-[11px] font-semibold text-ink-muted">{label(g.source)}</div>
                    <Items source={g.source} items={g.hits} view={view} />
                </div>
            ))
        ) : (
            <p className="py-3 text-ink-muted">No assets match "{query.trim()}"</p>
        );
    } else if (current) {
        body = <FolderView source={current} folder={assetTree(current.entries, label(current))} view={view} depth={0} />;
    } else {
        body = (
            <>
                {sources.map((s) => (
                    <button key={s.id} type="button" onClick={() => setOpenId(s.id)} className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                        <ComponentIcon className="size-4 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px]">{label(s)}</span>
                            {s.local && <span className="block truncate text-ink-subtle">{fileName}</span>}
                        </span>
                        <span className="text-ink-subtle">{s.entries.length.toLocaleString()}</span>
                        <ChevronRight className="size-3.5 text-ink-subtle" />
                    </button>
                ))}
                {sources.length === 1 && sources[0]?.entries.length === 0 && <p className="mt-3 rounded-md border border-dashed border-panel-border p-3 leading-relaxed text-ink-muted">Select a frame and press ⌥⌘K to make a component, or turn on a library to use its components here.</p>}
                <button type="button" onClick={() => openLibraries("libraries")} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-panel-border text-[12px] hover:bg-panel-hover">
                    <BookOpen01 className="size-3.5" /> Add more libraries
                </button>
            </>
        );
    }
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {header}
            {search}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{body}</div>
        </div>
    );
}

// A folder (page, frame or "/" folder): its sub-folders collapse, its components show below.
function FolderView({ source, folder, view, depth }: { source: AssetSource; folder: AssetFolder; view: "grid" | "list"; depth: number }) {
    return (
        <div>
            {folder.items.length > 0 && <Items source={source} items={folder.items} view={view} />}
            {folder.folders.map((f) => (
                <FolderRow key={f.name} source={source} folder={f} view={view} depth={depth} defaultOpen={folder.folders.length === 1 || depth > 0} />
            ))}
        </div>
    );
}

function FolderRow({ source, folder, view, depth, defaultOpen }: { source: AssetSource; folder: AssetFolder; view: "grid" | "list"; depth: number; defaultOpen: boolean }) {
    const [open, setOpen] = useState(defaultOpen && countItems(folder) <= 200);
    return (
        <div className={depth > 0 ? "pl-2" : ""}>
            <button type="button" onClick={() => setOpen(!open)} className="flex h-8 w-full items-center gap-1 rounded-md px-1 text-left hover:bg-panel-hover">
                {open ? <ChevronDown className="size-3.5 shrink-0 text-ink-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-muted" />}
                <span className={`min-w-0 flex-1 truncate ${depth === 0 ? "font-semibold" : ""}`}>{folder.name}</span>
                <span className="text-ink-subtle">{countItems(folder).toLocaleString()}</span>
            </button>
            {open && <FolderView source={source} folder={folder} view={view} depth={depth + 1} />}
        </div>
    );
}

function Items({ source, items, view }: { source: AssetSource; items: AssetEntry[]; view: "grid" | "list" }) {
    const [shown, setShown] = useState(120);
    const list = useMemo(() => items.slice(0, shown), [items, shown]);
    return (
        <>
            {view === "grid" ? (
                <div className="grid grid-cols-3 gap-1.5 px-1 py-1">
                    {list.map((e) => (
                        <AssetTile key={e.id} source={source} entry={e} />
                    ))}
                </div>
            ) : (
                <div className="py-1">
                    {list.map((e) => (
                        <AssetRow key={e.id} source={source} entry={e} />
                    ))}
                </div>
            )}
            {items.length > shown && (
                <button type="button" onClick={() => setShown(shown + 240)} className="h-7 w-full rounded-md text-brand-500 hover:bg-panel-hover">
                    Show more ({(items.length - shown).toLocaleString()})
                </button>
            )}
        </>
    );
}

function dragProps(source: AssetSource, entry: AssetEntry) {
    return {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("application/x-nagma-asset", encodeAssetDrag(source.id, entry.id));
            e.dataTransfer.effectAllowed = "copy";
        },
        onClick: () => void placeAsset(source.id, entry.id, viewCenter()),
    };
}

function tip(entry: AssetEntry): string {
    return entry.description ? `${entry.name}\n${entry.description}` : entry.name;
}

// Right-click on a component of this file: Hide when publishing / Show when publishing.
function useHideMenu(source: AssetSource, entry: AssetEntry) {
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);
    const node = source.local ? source.doc.nodes[entry.id] : undefined;
    const onContextMenu = (e: React.MouseEvent) => {
        if (!node) return;
        e.preventDefault();
        setAt({ x: e.clientX, y: e.clientY });
    };
    const byName = node ? isHiddenName(node.name) : false;
    const items: PointMenuItem[] = node
        ? [
              node.hiddenFromPublishing
                  ? { id: "show", label: "Show when publishing", run: () => setHiddenFromPublishing({ kind: "component", id: node.id }, false) }
                  : { id: "hide", label: byName ? "Hidden by its name (. or _)" : "Hide when publishing", disabled: byName, run: () => setHiddenFromPublishing({ kind: "component", id: node.id }, true) },
          ]
        : [];
    const menu = at ? <PointMenu at={at} items={items} onClose={() => setAt(null)} label="Component actions" /> : null;
    return { onContextMenu, menu };
}

function AssetTile({ source, entry }: { source: AssetSource; entry: AssetEntry }) {
    const { onContextMenu, menu } = useHideMenu(source, entry);
    return (
        <>
        {menu}
        <button type="button" {...dragProps(source, entry)} onContextMenu={onContextMenu} title={tip(entry)} className="group overflow-hidden rounded-md border border-panel-border bg-field text-left hover:border-brand-500">
            <EntryThumb source={source} entry={entry} w={120} h={96} className="aspect-[5/4] w-full" />
            <div className="truncate px-1 py-0.5 text-[10.5px]">{entry.name}</div>
        </button>
        </>
    );
}

function AssetRow({ source, entry }: { source: AssetSource; entry: AssetEntry }) {
    const { onContextMenu, menu } = useHideMenu(source, entry);
    return (
        <>
        {menu}
        <button type="button" {...dragProps(source, entry)} onContextMenu={onContextMenu} title={tip(entry)} className="flex h-9 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-panel-hover">
            <EntryThumb source={source} entry={entry} w={64} h={48} className="h-7 w-8 shrink-0 rounded" />
            <span className="min-w-0 flex-1">
                <span className="block truncate">{entry.name}</span>
                {entry.description && <span className="block truncate text-[10.5px] text-ink-subtle">{entry.description}</span>}
            </span>
        </button>
        </>
    );
}

import { ArrowDown, ArrowUp, ChevronDown, LayersThree01, LayoutAlt04, Plus, RefreshCw01, Trash01, Upload01, X } from "@untitledui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { drawNode } from "../canvas/render";
import { LayersPanel } from "../components/layers-panel";
import { MenuRow } from "../components/left-sidebar";
import { Select } from "../components/select";
import { duplicateFile, fileMeta, openFile, renameFile } from "../engine/files";
import { listLocalFolders } from "../engine/folders";
import { imageSrc, preloadImages } from "../engine/image-store";
import { useLibrarySummaries, refreshLibraries } from "../engine/library";
import { runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { addLogoFile, pullBrandFromFile, pullBrandFromLibrary, setBrand } from "./brand";
import { openAssetMenu } from "./asset-menu";
import { addBlankLike, addRow, assetData, assetOf, brandOf, deleteRow, duplicateAsset, inRow, moveRow, placeAsset, presetFor, renameRow, rowsOf } from "./model";
import { ReviewBadge } from "./reviews";
import { showAsset } from "./actions";
import { addLogo } from "./inserts";
import { campaign, useCampaign } from "./state";

// The panel beside the rail. Next to the asset view it lists the file's assets (numbered pictures,
// the one on show tinted); the rail's other buttons swap in their own panels (Templates here,
// the rest in add-panels.tsx).

export const PANEL = "flex h-full w-[280px] shrink-0 flex-col border-r border-panel-border bg-panel";

function subtreeRefs(doc: NagmaDocument, id: string, out: unknown[] = []): unknown[] {
    const node = doc.nodes[id];
    if (!node) return out;
    out.push(node);
    for (const c of node.children) subtreeRefs(doc, c, out);
    return out;
}

// One asset drawn on its own, as big as fits in w × h (device pixels), with no backdrop.
export function renderAsset(doc: NagmaDocument, id: string, w: number, h: number): string {
    const node = doc.nodes[id];
    if (!node) return "";
    const scale = Math.min(w / Math.max(node.w, 1), h / Math.max(node.h, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(node.w * scale));
    canvas.height = Math.max(1, Math.round(node.h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.scale(scale, scale);
    ctx.translate(-node.x, -node.y);
    drawNode(ctx, { ...doc, board: false }, node, { editingTextId: null, pixelScale: scale });
    return canvas.toDataURL("image/png");
}

// A picture of one asset, redrawn a moment after its layers change.
export function AssetThumb({ id, width, height, className, cover }: { id: string; width: number; height: number; className?: string; cover?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const [url, setUrl] = useState("");
    const last = useRef<unknown[]>([]);
    useEffect(() => {
        const refs = subtreeRefs(doc, id);
        if (refs.length === last.current.length && refs.every((r, i) => r === last.current[i])) return;
        const timer = window.setTimeout(
            () => {
                last.current = refs;
                void preloadImages(doc.images).then(() => {
                    try {
                        // Small pictures are drawn larger and scaled down: the renderer leaves out what would be too small.
                        setUrl(renderAsset(doc, id, Math.max(width * 2, 240), Math.max(height * 2, 240)));
                    } catch {
                        // A picture is a nicety.
                    }
                });
            },
            url ? 400 : 0,
        );
        return () => window.clearTimeout(timer);
    }, [doc, id, url, width, height]);
    return (
        <span className={`flex items-center justify-center overflow-hidden ${className ?? ""}`} style={{ width, height }}>
            {url ? <img src={url} alt="" className={cover ? "size-full object-cover" : "max-h-full max-w-full object-contain"} draggable={false} /> : null}
        </span>
    );
}

// ---- The file's name, with its menu, over the folder it sits in ----

function FileHeader({ right }: { right?: ReactNode }) {
    const name = useEditor((s) => s.doc.name);
    const fileId = useEditor((s) => s.fileId);
    const readOnly = useEditor((s) => s.readOnly);
    const [editing, setEditing] = useState(false);
    const meta = fileMeta(fileId);
    const folder = meta?.folderId ? listLocalFolders().find((f) => f.id === meta.folderId)?.name : null;
    const where = meta?.shared ? (meta.project ? "Team project" : "Shared with you") : (folder ?? "Drafts");
    const rename = (next: string) => {
        setEditing(false);
        const value = next.trim();
        if (!value || value === name) return;
        if (fileId) renameFile(fileId, value);
        else editor.execute({ type: "doc.rename", name: value });
    };
    return (
        <div className="flex shrink-0 items-start gap-1 pt-[13px] pr-2 pb-[18px] pl-4">
            <div className="min-w-0 flex-1">
                {editing ? (
                    <input
                        autoFocus
                        aria-label="File name"
                        defaultValue={name}
                        onBlur={(e) => rename(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditing(false);
                        }}
                        className="-ml-1 h-5 w-full rounded border border-brand-500 bg-panel px-1 text-[13px] font-semibold text-ink outline-none"
                    />
                ) : (
                    <AriaMenuTrigger>
                        <AriaButton aria-label="File menu" className="-ml-1 flex h-5 max-w-full items-center gap-2 rounded px-1 text-[13px] font-semibold text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                            <span className="truncate">{name || "Untitled"}</span>
                            <ChevronDown className="size-3 shrink-0 text-ink-muted" />
                        </AriaButton>
                        <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                            <AriaMenu
                                aria-label="File"
                                className="outline-none"
                                onAction={(key) => {
                                    if (key === "rename") setEditing(true);
                                    else if (key === "duplicate" && fileId) void duplicateFile(fileId).then((f) => f && openFile(f.id));
                                    else runAction(String(key));
                                }}
                            >
                                <MenuRow id="rename" label="Rename" />
                                <MenuRow id="duplicate" label="Duplicate" />
                                <AriaSeparator className="my-1 h-px bg-white/10" />
                                <MenuRow id="saveVersion" label="Save to version history…" shortcut="⌥ ⌘ S" />
                                <MenuRow id="history" label="Show version history" />
                                <AriaSeparator className="my-1 h-px bg-white/10" />
                                <MenuRow id="home" label="Back to files" />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                )}
                {!readOnly || meta ? <div className="truncate text-[11px] leading-4 text-ink-muted">{where}</div> : null}
            </div>
            {right}
        </div>
    );
}

// "New asset" opens the sizes and templates; + adds a variant of the asset on show.
function NewAssetButton() {
    const current = useCampaign((s) => s.current);
    const exists = useEditor((s) => Boolean(current && s.doc.nodes[current]));
    return (
        <div className="mr-4 ml-[15px] flex h-6 shrink-0 items-stretch rounded-[5px] border border-panel-border text-[11px] text-ink">
            <AriaButton onPress={() => campaign.set({ dialog: { kind: "add" } })} className="flex flex-1 items-center justify-center gap-1.5 rounded-l-[5px] outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                <LayoutAlt04 className="size-4" /> New asset
            </AriaButton>
            <span className="w-px bg-panel-border" />
            <AriaButton
                aria-label={exists ? "Add a variant of this asset" : "Add an asset"}
                onPress={() => (current && exists ? duplicateAsset(current) : campaign.set({ dialog: { kind: "add" } }))}
                className="flex w-6 items-center justify-center rounded-r-[5px] outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500"
            >
                <Plus className="size-4" />
            </AriaButton>
        </div>
    );
}

function RowHeader({ id, name, count, index, total, bulk }: { id: string; name: string; count: number; index: number; total: number; bulk: boolean }) {
    const readOnly = useEditor((s) => s.readOnly);
    const [renaming, setRenaming] = useState(false);
    const icon = "rounded p-0.5 text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-30";
    return (
        <div className="group flex h-8 items-center gap-0.5 pt-1 pr-1 pl-2">
            {renaming ? (
                <input
                    autoFocus
                    aria-label="Row name"
                    defaultValue={name}
                    onBlur={(e) => {
                        setRenaming(false);
                        if (e.target.value.trim() && e.target.value.trim() !== name) renameRow(id, e.target.value.trim());
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(false);
                    }}
                    className="h-5 min-w-0 flex-1 rounded border border-brand-500 bg-panel px-1 text-[11px] text-ink outline-none"
                />
            ) : (
                <button type="button" onDoubleClick={() => !readOnly && setRenaming(true)} title="Double-click to rename" className="min-w-0 flex-1 truncate text-left text-[11px] text-ink-muted">
                    {name} <span className="text-ink-subtle">{count}</span>
                </button>
            )}
            {!readOnly && (
                <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveRow(id, -1)} className={icon}><ArrowUp className="size-3" /></button>
                    <button type="button" aria-label={`Move ${name} down`} disabled={index === total - 1} onClick={() => moveRow(id, 1)} className={icon}><ArrowDown className="size-3" /></button>
                    <button type="button" aria-label={`Add asset to ${name}`} onClick={() => campaign.set({ dialog: { kind: "add", rowId: id } })} className={icon}><Plus className="size-3" /></button>
                    {bulk && <button type="button" aria-label={`Update ${name} from data`} title="Update from data" onClick={() => campaign.set({ dialog: { kind: "bulk", rowId: id } })} className={icon}><RefreshCw01 className="size-3" /></button>}
                    <button type="button" aria-label={`Delete ${name}`} disabled={total < 2} onClick={() => deleteRow(id)} className={icon}><Trash01 className="size-3" /></button>
                </span>
            )}
        </div>
    );
}

const DRAG_TYPE = "application/x-campaign-asset";

function AssetList() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const current = useCampaign((s) => s.current);
    // Where a dragged card would land: before an asset of a row, or at a row's end (null), or a new row.
    const [drop, setDrop] = useState<{ rowId: string; before: string | null } | "new" | null>(null);
    const [dragging, setDragging] = useState(false);
    const rows = rowsOf(doc);
    const selected = new Set(selection.map((id) => assetOf(doc, id)?.id));
    const dragged = (e: React.DragEvent) => (e.dataTransfer.types.includes(DRAG_TYPE) ? true : false);
    const finish = (e: React.DragEvent, target: { rowId: string; before: string | null } | "new") => {
        e.preventDefault();
        const id = e.dataTransfer.getData(DRAG_TYPE);
        setDrop(null);
        setDragging(false);
        if (!id) return;
        void inRow(target === "new" ? "new" : target.rowId, (row) => placeAsset(id, row, target === "new" ? null : target.before));
    };
    let n = 0;
    return (
        <div className="min-h-0 flex-1 overflow-y-auto pt-2 pr-2 pb-4 pl-[7px]" aria-label="Assets" onDragEnd={() => (setDrop(null), setDragging(false))}>
            {rows.map(({ row, assets }, ri) => (
                <section
                    key={row.id}
                    aria-label={row.name}
                    onDragOver={(e) => {
                        if (!dragged(e) || e.target !== e.currentTarget) return;
                        e.preventDefault();
                        setDrop({ rowId: row.id, before: null });
                    }}
                    onDrop={(e) => e.target === e.currentTarget && finish(e, { rowId: row.id, before: null })}
                    className={`pb-1 ${drop && drop !== "new" && drop.rowId === row.id && drop.before === null ? "rounded-md ring-1 ring-brand-500 ring-inset" : ""}`}
                >
                    {(rows.length > 1 || dragging) && <RowHeader id={row.id} name={row.name} count={assets.length} index={ri} total={rows.length} bulk={Boolean(row.bulk)} />}
                    {assets.map((asset, ai) => {
                        n++;
                        const on = asset.id === current;
                        const picked = selected.has(asset.id);
                        const data = assetData(asset);
                        const next = assets[ai + 1]?.id ?? null;
                        const lineHere = drop && drop !== "new" && drop.rowId === row.id && drop.before === asset.id;
                        return (
                            <button
                                key={asset.id}
                                type="button"
                                data-asset={asset.id}
                                aria-current={on}
                                draggable={!readOnly}
                                title={`${asset.name}${data?.template ? " (template)" : ""}, ${presetFor(data?.preset)?.label ?? "Custom"} ${Math.round(asset.w)}x${Math.round(asset.h)}`}
                                onClick={(e) => showAsset(asset.id, e.shiftKey || e.metaKey)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    openAssetMenu(asset.id, e.clientX, e.clientY);
                                }}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData(DRAG_TYPE, asset.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    setDragging(true);
                                }}
                                onDragOver={(e) => {
                                    if (!dragged(e)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const box = e.currentTarget.getBoundingClientRect();
                                    setDrop({ rowId: row.id, before: e.clientY < box.top + box.height / 2 ? asset.id : next });
                                }}
                                onDrop={(e) => {
                                    e.stopPropagation();
                                    finish(e, drop && drop !== "new" ? drop : { rowId: row.id, before: asset.id });
                                }}
                                className={`relative mb-1 flex w-[264px] items-start rounded-[6px] py-2 pr-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${on ? "bg-brand-100" : "hover:bg-panel-hover"}`}
                            >
                                {lineHere && <span aria-hidden="true" className="absolute inset-x-1 -top-[3px] h-0.5 rounded-full bg-brand-500" />}
                                <span className={`w-7 shrink-0 pt-0.5 pr-1.5 text-right text-[11px] ${on ? "text-brand-300" : "text-ink-muted"}`}>{n}</span>
                                <span className={`relative flex rounded-[4px] p-2 ${on ? "bg-brand-50" : picked ? "ring-1 ring-brand-500" : "bg-field"}`}>
                                    <AssetThumb id={asset.id} width={212} height={120} cover className="rounded-[2px]" />
                                    <ReviewBadge assetId={asset.id} className="absolute top-1.5 right-1.5" />
                                </span>
                            </button>
                        );
                    })}
                    {assets.length === 0 && (rows.length > 1 || dragging) && <p className="pointer-events-none px-2.5 py-1 text-[11px] text-ink-subtle">{dragging ? "Drop here" : "No assets yet."}</p>}
                </section>
            ))}
            {dragging && (
                <div
                    onDragOver={(e) => {
                        if (!dragged(e)) return;
                        e.preventDefault();
                        setDrop("new");
                    }}
                    onDrop={(e) => finish(e, "new")}
                    className={`mt-2 ml-2 flex h-8 w-[248px] items-center justify-center rounded-[5px] border border-dashed text-[11px] ${drop === "new" ? "border-brand-500 text-ink" : "border-panel-border text-ink-muted"}`}
                >
                    Drop for a new row
                </div>
            )}
            {!readOnly && !dragging && rows.length > 1 && (
                <button type="button" onClick={() => addRow()} className="mt-2 ml-2 flex h-6 w-[248px] items-center justify-center gap-1 rounded-[5px] border border-dashed border-panel-border text-[11px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3" /> Add row
                </button>
            )}
        </div>
    );
}

export function AssetsPanel() {
    const mode = useCampaign((s) => s.mode);
    const readOnly = useEditor((s) => s.readOnly);
    const [layers, setLayers] = useState(false);
    const showLayers = layers && mode !== "edit";
    return (
        <aside className={PANEL} aria-label="Assets panel">
            <FileHeader
                right={
                    mode !== "edit" && !readOnly ? (
                        <AriaButton aria-label={showLayers ? "Show assets" : "Show layers"} aria-pressed={showLayers} onPress={() => setLayers(!layers)} className={`flex size-6 shrink-0 items-center justify-center rounded-[5px] outline-none hover:bg-panel-hover ${showLayers ? "text-brand-500" : "text-ink-muted"}`}>
                            <LayersThree01 className="size-4" />
                        </AriaButton>
                    ) : null
                }
            />
            {!readOnly && <NewAssetButton />}
            <div className="mt-4 h-px shrink-0 bg-panel-border" />
            {showLayers ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <LayersPanel />
                </div>
            ) : (
                <AssetList />
            )}
        </aside>
    );
}

// ---- The asset strip: the asset list folded beside an open panel ----

// While a rail panel is open the assets keep a narrow strip beside it: a + to add one and a
// picture of each, the one on show outlined in the accent.
export function AssetStrip() {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const current = useCampaign((s) => s.current);
    const assets = rowsOf(doc).flatMap((r) => r.assets);
    return (
        <aside className="flex h-full w-[72px] shrink-0 flex-col items-center border-r border-panel-border bg-field" aria-label="Assets">
            {!readOnly && (
                <>
                    <AriaButton aria-label="Add a blank asset" onPress={() => (current && addBlankLike(current)) || campaign.set({ dialog: { kind: "add" } })} className="mt-3 flex size-12 shrink-0 items-center justify-center rounded-[5px] border border-[#424242] bg-panel text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 [:root[data-theme=light]_&]:border-panel-border">
                        <Plus className="size-4" />
                    </AriaButton>
                    <span className="mt-3 h-px w-full shrink-0 bg-white/10 [:root[data-theme=light]_&]:bg-panel-border" />
                </>
            )}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto pt-3 pb-3">
                {assets.map((asset) => (
                    <button
                        key={asset.id}
                        type="button"
                        aria-label={asset.name}
                        aria-current={asset.id === current}
                        title={asset.name}
                        onClick={(e) => showAsset(asset.id, e.shiftKey || e.metaKey)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            openAssetMenu(asset.id, e.clientX, e.clientY);
                        }}
                        className={`relative flex size-12 shrink-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${asset.id === current ? "bg-brand-50 ring-2 ring-brand-300" : "border border-white/10 hover:border-white/25 [:root[data-theme=light]_&]:border-panel-border"}`}
                    >
                        <AssetThumb id={asset.id} width={34} height={34} className="rounded-[2px]" />
                        <ReviewBadge assetId={asset.id} small className="absolute -top-1 -right-1" />
                    </button>
                ))}
            </div>
        </aside>
    );
}

// ---- A rail panel's frame: its title with a close button ----

export function PanelShell({ title, children, footer, search }: { title: string; children: ReactNode; footer?: ReactNode; search?: ReactNode }) {
    return (
        <aside className={PANEL} aria-label={title}>
            <div className="flex h-12 shrink-0 items-center justify-between pr-3 pl-4">
                <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
                <AriaButton aria-label={`Close ${title}`} onPress={() => campaign.set({ panel: "assets" })} className="flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                    <X className="size-4" />
                </AriaButton>
            </div>
            {search}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="shrink-0 border-t border-panel-border">{footer}</div>}
        </aside>
    );
}

export function BrandKit() {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const mode = useCampaign((s) => s.mode);
    const brand = brandOf(doc);
    const libraries = useLibrarySummaries();
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void refreshLibraries().catch(() => undefined);
    }, []);
    const canEdit = !readOnly && mode !== "edit";
    const pickLogo = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) void addLogoFile(file);
        };
        input.click();
    };
    return (
        <section className="mt-4 space-y-3 border-t border-panel-border px-4 pt-4 pb-4 text-[11px]" aria-label="Brand kit">
            <div>
                <div className="font-semibold text-ink">Brand kit</div>
                <p className="mt-0.5 text-ink-muted">{brand.libraryName ? `From the ${brand.libraryName} library.` : "Set in this campaign."}</p>
                {canEdit && (
                    <div className="mt-1.5 space-y-1.5">
                        <Select
                            aria-label="Pull from library"
                            disabled={busy || !libraries.length}
                            value=""
                            onChange={(e) => {
                                const id = e.target.value;
                                if (!id) return;
                                setBusy(true);
                                void pullBrandFromLibrary(id)
                                    .then((r) => editor.notify(`Brand kit updated: ${r.colors} colours, ${r.texts} text styles, ${r.logos} logos.`))
                                    .catch((err) => editor.notify(err instanceof Error ? err.message : String(err)))
                                    .finally(() => setBusy(false));
                            }}
                            className="h-6 w-full rounded-[5px] border border-panel-border bg-panel px-1.5 text-ink outline-none"
                        >
                            <option value="">{libraries.length ? "Pull from a library…" : "No published libraries"}</option>
                            {libraries.map((l) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </Select>
                        <button type="button" onClick={() => editor.notify(pullBrandFromFile() ? "Brand kit set from this file's styles." : "This file has no colour or text styles yet.")} className="h-6 w-full rounded-[5px] border border-panel-border text-ink hover:bg-panel-hover">
                            Use this file's styles
                        </button>
                    </div>
                )}
            </div>
            <div>
                <div className="mb-1.5 text-ink-muted">Colours</div>
                <div className="grid grid-cols-6 gap-1.5">
                    {brand.colors.map((c, i) => (
                        <label key={`${c.name}-${i}`} title={`${c.name} ${c.color}`} className="relative block">
                            <span className="block aspect-square rounded-[5px] border border-white/10" style={{ background: c.color }} />
                            {canEdit && (
                                <input
                                    type="color"
                                    aria-label={`${c.name} colour`}
                                    value={c.color.slice(0, 7)}
                                    onChange={(e) => setBrand({ colors: brand.colors.map((x, j) => (j === i ? { ...x, color: e.target.value.toUpperCase() } : x)) })}
                                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                                />
                            )}
                        </label>
                    ))}
                    {canEdit && (
                        <button type="button" aria-label="Add colour" onClick={() => setBrand({ colors: [...brand.colors, { name: `Colour ${brand.colors.length + 1}`, color: "#888888" }] })} className="flex aspect-square items-center justify-center rounded-[5px] border border-dashed border-panel-border text-ink-muted hover:bg-panel-hover">
                            <Plus className="size-3" />
                        </button>
                    )}
                </div>
            </div>
            <div>
                <div className="mb-1 text-ink-muted">Text styles</div>
                {brand.texts.map((t) => (
                    <div key={t.name} className="flex items-baseline justify-between gap-2 py-0.5">
                        <span className="truncate text-ink" style={{ fontFamily: t.fontFamily, fontWeight: t.fontWeight }}>{t.name}</span>
                        <span className="shrink-0 text-ink-subtle">{t.fontFamily} {t.fontSize}</span>
                    </div>
                ))}
            </div>
            <div>
                <div className="mb-1.5 flex items-center justify-between text-ink-muted">
                    Logos
                    {canEdit && (
                        <button type="button" aria-label="Upload logo" onClick={pickLogo} className="rounded p-1 text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Upload01 className="size-3" />
                        </button>
                    )}
                </div>
                {brand.logos.length === 0 && <p className="text-ink-subtle">No logos yet. {canEdit ? "Upload one, or pull a library with components named Logo." : ""}</p>}
                <div className="grid grid-cols-3 gap-1.5">
                    {brand.logos.map((l) => (
                        <LogoTile key={l.id} imageId={l.imageId} name={l.name} />
                    ))}
                </div>
            </div>
        </section>
    );
}

export function LogoTile({ imageId, name }: { imageId: string; name: string }) {
    const src = useEditor((s) => s.doc.images[imageId]);
    const readOnly = useEditor((s) => s.readOnly);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        const images = { [imageId]: src ?? "" };
        void preloadImages(images).then(() => {
            if (live) setUrl(imageSrc(images, imageId));
        });
        return () => {
            live = false;
        };
    }, [imageId, src]);
    return (
        <button type="button" title={`Add ${name}`} disabled={readOnly} onClick={() => addLogo(imageId, name)} className="flex aspect-square items-center justify-center rounded-[5px] border border-panel-border bg-white p-1 outline-none hover:ring-1 hover:ring-brand-500">
            {url ? <img src={url} alt={name} className="max-h-full max-w-full object-contain" /> : null}
        </button>
    );
}

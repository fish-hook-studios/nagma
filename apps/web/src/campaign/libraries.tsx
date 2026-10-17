import { ChevronDown, ChevronRight, DotsHorizontal, PuzzlePiece01 } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { componentForAsset, localAssetId, swapTo } from "../components/asset-sources";
import { MenuRow } from "../components/left-sidebar";
import { assetName } from "../engine/components";
import { cachedManifest, checkForUpdates, enabledLibraries, importLibraryStyles, librarySource, openReview, refreshLibraries, setLibraryEnabled, swapLibrary, useEnabledManifests, useLibrarySummaries } from "../engine/library";
import { makeNode } from "../engine/nodes";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { pullBrandFromLibrary } from "./brand";
import { insertLayers } from "./inserts";

// Libraries in the Inserts panel: add a published design library and its components go on the
// asset as instances (its colours, text styles and logos also fill the brand kit); each library's
// menu applies its styles to the file, swaps its content for another library's, reviews its
// updates or removes it. A selected instance swaps to another component from the toolbar.

const MENU = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

// Places an instance of a component (a library's or this file's) in the middle of the asset on show.
export async function insertComponent(sourceId: string, assetId: string) {
    const local = await localAssetId(sourceId, assetId);
    if (!local) return;
    const doc = editor.get().doc;
    const componentId = componentForAsset(doc, local);
    const component = componentId ? doc.nodes[componentId] : undefined;
    if (!component) return;
    insertLayers((asset, scratch) => {
        const k = Math.min(1, (asset.w * 0.8) / Math.max(component.w, 1), (asset.h * 0.8) / Math.max(component.h, 1));
        return [makeNode(scratch, "instance", { x: 0, y: 0, w: Math.max(1, Math.round(component.w * k)), h: Math.max(1, Math.round(component.h * k)) }, asset.id, { name: assetName(doc, component.id), componentId: component.id, fills: [], overrides: [] })];
    });
}

export function AddLibraryMenu() {
    const libraries = useLibrarySummaries();
    const doc = useEditor((s) => s.doc);
    useEffect(() => {
        void refreshLibraries().catch(() => undefined);
    }, []);
    const on = new Set(enabledLibraries(doc).map((l) => l.id));
    return (
        <AriaMenuTrigger>
            <AriaButton className="rounded px-1 text-[11px] font-normal text-brand-500 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-brand-500">Add library</AriaButton>
            <AriaPopover placement="bottom end" offset={4} className={MENU}>
                <AriaMenu
                    aria-label="Libraries"
                    className="outline-none"
                    disabledKeys={[...on]}
                    renderEmptyState={() => <div className="px-2 py-1.5 text-[11px] text-white/60">No published libraries yet.</div>}
                    onAction={(key) => {
                        const summary = libraries.find((l) => l.id === key);
                        if (!summary) return;
                        setLibraryEnabled(summary, true);
                        void pullBrandFromLibrary(summary.id)
                            .then((r) => editor.notify(`${summary.name} added: its components are below; the brand kit took ${r.colors} colours, ${r.texts} text styles and ${r.logos} logos.`))
                            .catch((err) => editor.notify(err instanceof Error ? err.message : String(err)));
                    }}
                >
                    {libraries.map((l) => (
                        <MenuRow key={l.id} id={l.id} label={on.has(l.id) ? `${l.name} (added)` : l.name} />
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function LibraryMenu({ id, name }: { id: string; name: string }) {
    const libraries = useLibrarySummaries().filter((l) => l.id !== id);
    const run = (key: string) => {
        if (key === "styles") {
            void (async () => {
                const ids = cachedManifest(id)?.styles.map((s) => s.style.id) ?? [];
                await importLibraryStyles(id, ids);
                await pullBrandFromLibrary(id);
                editor.notify(`Applied ${ids.length} style${ids.length === 1 ? "" : "s"} from ${name}.`);
            })().catch((err) => editor.notify(err instanceof Error ? err.message : String(err)));
        } else if (key === "updates") {
            void checkForUpdates(true).then(() => openReview(true));
        } else if (key === "remove") {
            const summary = { id, name, version: 0 } as Parameters<typeof setLibraryEnabled>[0];
            setLibraryEnabled(summary, false);
            editor.notify(`${name} removed. Instances already on assets stay as they are.`);
        } else if (key.startsWith("swap:")) {
            const to = key.slice(5);
            void swapLibrary(id, to)
                .then((r) => editor.notify(`Swapped ${r.instances} instance${r.instances === 1 ? "" : "s"} and ${r.styles} style${r.styles === 1 ? "" : "s"}${r.missing.length ? `; ${r.missing.length} had no match` : ""}.`))
                .catch((err) => editor.notify(err instanceof Error ? err.message : String(err)));
        }
    };
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={`${name} options`} className="flex size-5 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <DotsHorizontal className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={4} className={MENU}>
                <AriaMenu aria-label={`${name} options`} className="outline-none" onAction={(key) => run(String(key))}>
                    <MenuRow id="styles" label="Apply styles" />
                    <AriaSubmenuTrigger>
                        <MenuRow id="swap" label="Swap content to" shortcut="›" />
                        <AriaPopover offset={-4} className={MENU}>
                            <AriaMenu aria-label="Swap content to" className="outline-none" onAction={(key) => run(`swap:${String(key)}`)} renderEmptyState={() => <div className="px-2 py-1.5 text-[11px] text-white/60">No other libraries.</div>}>
                                {libraries.map((l) => (
                                    <MenuRow key={l.id} id={l.id} label={l.name} />
                                ))}
                            </AriaMenu>
                        </AriaPopover>
                    </AriaSubmenuTrigger>
                    <MenuRow id="updates" label="Review design updates" />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="remove" label="Remove" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

export function CampaignLibraries({ query }: { query: string }) {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const manifests = useEnabledManifests(doc);
    const links = enabledLibraries(doc);
    const [closed, setClosed] = useState<Set<string>>(new Set());
    if (!links.length) return <p className="px-4 pb-4 text-[11px] text-ink-subtle">Add a design library to place its components on assets and pull its colours, text styles and logos into the brand kit.</p>;
    return (
        <div className="space-y-1 px-[5px] pb-4">
            {links.map((link) => {
                const manifest = manifests.find((m) => m.id === link.id);
                const entries = manifest ? librarySource(manifest).entries.filter((e) => !query || e.name.toLowerCase().includes(query) || e.path.join("/").toLowerCase().includes(query)) : [];
                const open = !closed.has(link.id);
                return (
                    <section key={link.id} aria-label={link.name}>
                        <div className="flex h-6 items-center gap-1 px-1.5 text-[11px]">
                            <button
                                type="button"
                                aria-expanded={open}
                                onClick={() => {
                                    const next = new Set(closed);
                                    if (open) next.add(link.id);
                                    else next.delete(link.id);
                                    setClosed(next);
                                }}
                                className="flex min-w-0 flex-1 items-center gap-1 text-left text-ink"
                            >
                                {open ? <ChevronDown className="size-3 shrink-0 text-ink-muted" /> : <ChevronRight className="size-3 shrink-0 text-ink-muted" />}
                                <span className="truncate font-medium">{link.name}</span>
                                <span className="shrink-0 text-ink-subtle">{manifest ? manifest.components.length : "…"}</span>
                            </button>
                            {!readOnly && <LibraryMenu id={link.id} name={link.name} />}
                        </div>
                        {open && (
                            <div className="grid grid-cols-2 gap-1 px-1.5 pt-0.5">
                                {!manifest && <p className="col-span-2 text-[11px] text-ink-subtle">Loading…</p>}
                                {manifest && entries.length === 0 && <p className="col-span-2 text-[11px] text-ink-subtle">{query ? "Nothing matches." : "No components."}</p>}
                                {entries.map((e) => (
                                    <AriaButton
                                        key={e.id}
                                        isDisabled={readOnly}
                                        aria-label={`Add ${e.name}`}
                                        onPress={() => void insertComponent(link.id, e.id)}
                                        className="flex h-8 min-w-0 items-center gap-1.5 rounded-[5px] bg-field px-1.5 text-left text-[10.5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500"
                                    >
                                        <PuzzlePiece01 className="size-3 shrink-0 text-ink-muted" />
                                        <span className="truncate">{e.name}</span>
                                    </AriaButton>
                                ))}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

// The toolbar's swap menu for a selected instance: another component from this file or a library.
export function SwapContent({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const manifests = useEnabledManifests(doc);
    const local = Object.values(doc.nodes).filter((n) => (n.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet") || n.type === "componentSet");
    return (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-3 py-2.5">
            <div className="font-semibold">Swap content</div>
            {local.length > 0 && (
                <div>
                    <div className="mb-1 text-ink-muted">This file</div>
                    {local.map((c) => (
                        <button key={c.id} type="button" onClick={() => void swapTo(node.id, { sourceId: "local", assetId: c.id })} className="flex h-6 w-full items-center rounded px-1.5 text-left hover:bg-panel-hover">
                            <span className="truncate">{c.name}</span>
                        </button>
                    ))}
                </div>
            )}
            {manifests.map((m) => (
                <div key={m.id}>
                    <div className="mb-1 text-ink-muted">{m.name}</div>
                    {librarySource(m).entries.map((e) => (
                        <button key={e.id} type="button" onClick={() => void swapTo(node.id, { sourceId: m.id, assetId: e.id })} className="flex h-6 w-full items-center rounded px-1.5 text-left hover:bg-panel-hover">
                            <span className="truncate">{e.name}</span>
                        </button>
                    ))}
                </div>
            ))}
            {!local.length && !manifests.length && <p className="text-ink-subtle">Add a library from Inserts to swap in its components.</p>}
        </div>
    );
}

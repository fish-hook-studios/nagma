import { ChevronDown, Code02, HelpCircle, Link01, Plus, X } from "@untitledui/icons";
import { fileLink } from "../engine/links";
import { copyText } from "../engine/dev-code";
import { runAction } from "../engine/menu-actions";
import { useRef, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { categories, propertyDef, categoryOf, notes, propertyValue, removeAnnotation, removeMeasurement, sanitize, useNotes } from "../engine/annotations";
import { type DevStatus, STATUS_COLOR, STATUS_LABEL, addResource, canHaveStatus, compareChanges, comparePictures, effectiveStatus, removeResource, reveal, setStatus, statusFrames } from "../engine/dev";
import { cssFor } from "../engine/dev-css";
import { exportLayers } from "../engine/export";
import { useEditor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { DarkMenu } from "./collab-menu";
import { DEV_NOTIFY_OPTIONS, type DevNotifyChannel, devNotifyChannel, setDevNotifyChannel } from "../engine/dev-notify";
import { askDevChangeNote } from "./dev-status-state";
import { openFocus, openReadyView } from "../engine/dev-view";
import { CompareMainButton, ConnectedCodeEditor, PlaygroundButton } from "./dev-component";
import { Select } from "./select";

// Inspect panel sections: status and Compare changes, dev resources, component info, annotations,
// and export. The code and styles sections stay in dev-panel.tsx.

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="border-b border-panel-border px-3 py-2.5">
            <div className="mb-1.5 flex h-6 items-center justify-between">
                <span className="font-semibold">{title}</span>
                {action}
            </div>
            {children}
        </div>
    );
}

export function StatusDot({ status }: { status: DevStatus }) {
    return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />;
}

// The status of the selected frame: mark it ready, completed, or clear it; compare what changed.
export function StatusControl({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const [comparing, setComparing] = useState(false);
    const [channel, setChannel] = useState<DevNotifyChannel>(devNotifyChannel);
    const box = useRef<HTMLDivElement>(null);
    if (!canHaveStatus(doc, node)) return null;
    const status = effectiveStatus(doc, node);
    const pickChannel = (c: DevNotifyChannel) => {
        setDevNotifyChannel(c);
        setChannel(c);
    };
    // Marking a changed design ready again asks what changed, as every other path does.
    const markReady = () => {
        if (status !== "changed") return setStatus(node.id, "ready");
        const r = box.current?.getBoundingClientRect();
        askDevChangeNote([node.id], r?.left ?? 0, r?.bottom ?? 0);
    };
    return (
        <div ref={box} className="mt-2 flex flex-wrap items-center gap-1.5">
            {status ? (
                <DarkMenu
                    label="Dev status"
                    placement="bottom start"
                    width="w-48"
                    className="flex h-6 items-center gap-1.5 rounded-md border border-panel-border px-2 text-ink outline-none hover:bg-panel-hover"
                    trigger={
                        <>
                            <StatusDot status={status} />
                            {STATUS_LABEL[status]}
                            <ChevronDown className="size-3 text-ink-muted" />
                        </>
                    }
                    items={[
                        { id: "ready", label: status === "changed" ? "Mark as ready again…" : "Ready for dev", checked: status === "ready" },
                        { id: "completed", label: "Completed", checked: status === "completed" },
                        "-",
                        { id: "clear", label: "Remove status" },
                        "-",
                        { section: "Notifications" },
                        ...DEV_NOTIFY_OPTIONS.map(([id, label]) => ({ id: `notify:${id}`, label, checked: channel === id })),
                    ]}
                    onAction={(id) => {
                        if (id.startsWith("notify:")) pickChannel(id.slice(7) as DevNotifyChannel);
                        else if (id === "ready") markReady();
                        else setStatus(node.id, id === "clear" ? null : (id as DevStatus));
                    }}
                />
            ) : (
                <button type="button" onClick={() => setStatus(node.id, "ready")} className="flex h-6 items-center gap-1.5 rounded-md bg-brand-500 px-2 font-semibold text-white hover:bg-brand-600">
                    Mark as ready for dev
                </button>
            )}
            {status && (
                <button type="button" onClick={() => openFocus(node.id)} className="h-6 rounded-md px-1.5 text-brand-500 hover:bg-panel-hover">
                    Open in focus view
                </button>
            )}
            {node.devReady && (status === "changed" || status === "ready") && (
                <button type="button" onClick={() => setComparing(true)} className="h-6 rounded-md px-1.5 text-brand-500 hover:bg-panel-hover">
                    Compare changes
                </button>
            )}
            {node.devReady && <div className="w-full text-[10px] text-ink-subtle">Marked ready by {node.devReady.by}, {new Date(node.devReady.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
            <AriaModalOverlay isOpen={comparing} onOpenChange={setComparing} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
                <AriaModal className="flex max-h-[84vh] w-[760px] flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                    <AriaDialog aria-label="Compare changes" className="flex min-h-0 flex-col outline-none">{comparing && <CompareChanges node={node} doc={doc} close={() => setComparing(false)} />}</AriaDialog>
                </AriaModal>
            </AriaModalOverlay>
        </div>
    );
}

function CompareChanges({ node, doc, close }: { node: SceneNode; doc: NagmaDocument; close: () => void }) {
    const [pics] = useState(() => comparePictures(doc, node));
    const changes = compareChanges(doc, node);
    const [view, setView] = useState<"side" | "overlay" | "changes">("side");
    const [fade, setFade] = useState(0.5);
    return (
        <>
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-border px-4">
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Compare changes · {node.name}</h2>
                <div className="flex rounded-md bg-field p-0.5 text-[11px]">
                    {(["side", "overlay", "changes"] as const).map((v) => (
                        <button key={v} type="button" onClick={() => setView(v)} className={`h-6 rounded px-2 ${view === v ? "bg-panel text-ink shadow-sm" : "text-ink-subtle"}`}>
                            {v === "side" ? "Side by side" : v === "overlay" ? "Overlay" : `Changes (${changes.length})`}
                        </button>
                    ))}
                </div>
                <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                    <X className="size-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[11px]">
                {view === "side" ? (
                    <div className="grid grid-cols-2 gap-3">
                        {(
                            [
                                ["When marked ready", pics.before],
                                ["Now", pics.after],
                            ] as const
                        ).map(([label, src]) => (
                            <figure key={label} className="space-y-1.5">
                                <img src={src} alt={`${node.name}, ${label.toLowerCase()}`} className="w-full rounded-md border border-panel-border" />
                                <figcaption className="text-ink-muted">{label}</figcaption>
                            </figure>
                        ))}
                    </div>
                ) : view === "overlay" ? (
                    <div className="space-y-3">
                        <div className="relative mx-auto w-full max-w-[560px]">
                            <img src={pics.before} alt={`${node.name}, when marked ready`} className="w-full rounded-md border border-panel-border" />
                            <img src={pics.after} alt={`${node.name}, now`} className="absolute inset-0 w-full rounded-md" style={{ opacity: fade }} />
                        </div>
                        <label className="mx-auto flex max-w-[560px] items-center gap-3 text-ink-muted">
                            <span className="shrink-0">When marked ready</span>
                            <input type="range" min={0} max={1} step={0.01} value={fade} onChange={(e) => setFade(Number(e.target.value))} aria-label="Opacity of the current version" className="min-w-0 flex-1 accent-brand-500" />
                            <span className="shrink-0">Now</span>
                        </label>
                    </div>
                ) : changes.length === 0 ? (
                    <p className="text-ink-muted">Nothing has changed since this was marked ready.</p>
                ) : (
                    <div className="space-y-2">
                        {changes.map((c) => (
                            <div key={c.id} className="rounded-md border border-panel-border p-2">
                                <div className="mb-1 flex items-center gap-2">
                                    <span className="font-semibold">{c.name}</span>
                                    <span className={c.kind === "added" ? "text-emerald-500" : c.kind === "removed" ? "text-red-400" : "text-amber-500"}>{c.kind === "added" ? "Added" : c.kind === "removed" ? "Removed" : "Changed"}</span>
                                </div>
                                {c.kind === "changed" && <CodeDiff before={node.devReady?.snapshot[c.id]} after={doc.nodes[c.id]} doc={doc} />}
                                {c.props.map((p) => (
                                    <div key={p.key} className="grid grid-cols-[120px_1fr_1fr] gap-2 py-0.5 font-mono text-[10.5px]">
                                        <span className="text-ink-muted">{p.key}</span>
                                        <span className="break-all text-red-400 line-through decoration-red-400/50">{p.before}</span>
                                        <span className="break-all text-emerald-500">{p.after}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

// The layer's CSS when it was marked ready against now: removed lines struck out, added lines green.
function CodeDiff({ before, after, doc }: { before: SceneNode | undefined; after: SceneNode | undefined; doc: NagmaDocument }) {
    if (!before || !after) return null;
    const a = cssFor(before, doc.images, doc).split("\n").filter(Boolean);
    const b = cssFor(after, doc.images, doc).split("\n").filter(Boolean);
    const removed = a.filter((l) => !b.includes(l));
    const added = b.filter((l) => !a.includes(l));
    if (!removed.length && !added.length) return null;
    return (
        <pre className="mb-1.5 overflow-x-auto rounded bg-field p-1.5 font-mono text-[10.5px] leading-4 whitespace-pre">
            {removed.map((l) => (
                <div key={`-${l}`} className="text-red-400">
                    - {l}
                </div>
            ))}
            {added.map((l) => (
                <div key={`+${l}`} className="text-emerald-500">
                    + {l}
                </div>
            ))}
        </pre>
    );
}

export function DevResources({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const [adding, setAdding] = useState(false);
    const [url, setUrl] = useState("");
    const [name, setName] = useState("");
    const list = node.devResources ?? [];
    // An instance shows its main component's links too (they can only be removed on the component).
    const main = node.type === "instance" && node.componentId ? doc.nodes[node.componentId] : undefined;
    const set = main?.parentId && doc.nodes[main.parentId]?.type === "componentSet" ? doc.nodes[main.parentId] : undefined;
    const inherited = [...(main?.devResources ?? []), ...(set?.devResources ?? [])];
    return (
        <Section
            title="Dev resources"
            action={
                <button type="button" aria-label="Add dev resource" title="Add dev resource" onClick={() => setAdding((v) => !v)} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3.5" />
                </button>
            }
        >
            {list.length === 0 && inherited.length === 0 && !adding && <p className="text-ink-subtle">Link code, docs or tickets to this layer.</p>}
            {inherited.map((r) => (
                <div key={r.id} className="flex h-7 items-center gap-2 rounded px-1 hover:bg-panel-hover" title="From the main component">
                    <Link01 className="size-3.5 shrink-0 text-ink-muted" />
                    <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand-500 hover:underline" title={r.url}>
                        {r.name}
                    </a>
                    <span className="shrink-0 text-[10px] text-ink-subtle">Component</span>
                </div>
            ))}
            {list.map((r) => (
                <div key={r.id} className="group flex h-7 items-center gap-2 rounded px-1 hover:bg-panel-hover">
                    <Link01 className="size-3.5 shrink-0 text-ink-muted" />
                    <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand-500 hover:underline" title={r.url}>
                        {r.name}
                    </a>
                    <button type="button" aria-label={`Remove ${r.name}`} onClick={() => removeResource(node.id, r.id)} className="text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            ))}
            {adding && (
                <form
                    className="mt-1 space-y-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!url.trim()) return;
                        addResource(node.id, name, url.trim());
                        setUrl("");
                        setName("");
                        setAdding(false);
                    }}
                >
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Paste a link" aria-label="Link" className="h-7 w-full rounded-md bg-field px-2 outline-none focus:ring-1 focus:ring-brand-500" />
                    <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Name (optional)" aria-label="Name" className="h-7 w-full rounded-md bg-field px-2 outline-none focus:ring-1 focus:ring-brand-500" />
                    <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setAdding(false)} className="h-6 rounded px-2 text-ink-muted hover:bg-panel-hover">
                            Cancel
                        </button>
                        <button type="submit" className="h-6 rounded bg-brand-500 px-2 font-semibold text-white">
                            Add
                        </button>
                    </div>
                </form>
            )}
        </Section>
    );
}

// The main component behind an instance (or the selected component): name, description, properties.
export function ComponentInfo({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const main = node.type === "instance" && node.componentId ? doc.nodes[node.componentId] : node.type === "component" ? node : undefined;
    if (!main) return null;
    const set = main.parentId && doc.nodes[main.parentId]?.type === "componentSet" ? doc.nodes[main.parentId] : undefined;
    const props = main.componentProps ?? set?.componentProps ?? [];
    const description = main.description ?? set?.description;
    return (
        <Section title="Component">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{set ? `${set.name} / ${main.name}` : main.name}</span>
                {node.type === "instance" && (
                    <button type="button" onClick={() => reveal(doc, main.id)} className="shrink-0 rounded px-1 text-brand-500 hover:bg-panel-hover">
                        Go to main component
                    </button>
                )}
            </div>
            {description ? <p className="mt-1 whitespace-pre-wrap text-ink-muted">{description}</p> : <p className="mt-1 text-ink-subtle">No description.</p>}
            {props.length > 0 && (
                <div className="mt-2 space-y-0.5">
                    {props.map((p) => {
                        const value = node.type === "instance" ? (node.propValues?.[p.id] ?? p.defaultValue) : p.defaultValue;
                        const shown = p.kind === "swap" ? (doc.nodes[String(value)]?.name ?? String(value)) : typeof value === "boolean" ? (value ? "true" : "false") : String(value);
                        return (
                            <div key={p.id} className="flex h-6 items-center justify-between gap-2 rounded bg-field px-1.5">
                                <span className="text-ink-muted">{p.name}</span>
                                <span className="truncate font-mono text-[10.5px]">{shown}</span>
                            </div>
                        );
                    })}
                </div>
            )}
            <CompareMainButton node={node} doc={doc} />
            <PlaygroundButton node={node} doc={doc} />
            <ConnectedCodeEditor node={node} doc={doc} />
        </Section>
    );
}

// Annotations on the layer and measurements that involve it; Filter by category hides others on the canvas.
export function AnnotationsSection({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const pageId = useEditor((s) => s.pageId);
    const hidden = useNotes((s) => s.hidden);
    const page = doc.nodes[pageId];
    const measures = (page?.measurements ?? []).filter((m) => m.a === node.id || m.b === node.id);
    const list = node.annotations ?? [];
    const cats = categories(doc);
    if (!list.length && !measures.length) return null;
    return (
        <Section
            title="Annotations"
            action={
                <DarkMenu
                    label="Filter annotations"
                    className="flex h-6 items-center rounded px-1.5 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                    trigger={<span>Filter</span>}
                    items={cats.map((c) => ({ id: c.id, label: c.label, checked: !hidden.includes(c.id) }))}
                    onAction={(id) => notes.set({ hidden: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id] })}
                />
            }
        >
            {list.map((a, i) => {
                const cat = categoryOf(doc, a);
                return (
                    <div key={a.id} className="group mb-1.5 flex items-start gap-2">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: cat?.color ?? "#1BC47D" }}>
                            {i + 1}
                        </span>
                        <button type="button" onClick={() => notes.set({ editing: { nodeId: node.id, id: a.id } })} className="min-w-0 flex-1 text-left">
                            {cat && <span className="block text-[10px] font-semibold" style={{ color: cat.color }}>{cat.label}</span>}
                            {a.html ? <span className="block [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: sanitize(a.html) }} /> : <span className="block whitespace-pre-wrap">{a.text}</span>}
                            {(a.properties ?? []).map((k) => (
                                <span key={k} className="mt-0.5 flex justify-between gap-2 rounded bg-field px-1.5 py-0.5">
                                    <span className="text-ink-muted">{propertyDef(k)?.label ?? k}</span>
                                    <span className="truncate">{propertyValue(doc, node, k) ?? "None"}</span>
                                </span>
                            ))}
                        </button>
                        <button type="button" aria-label="Remove annotation" onClick={() => removeAnnotation(node.id, a.id)} className="text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}
            {measures.length > 0 && <div className="mt-2 mb-1 font-semibold">Measurements</div>}
            {measures.map((m) => {
                const other = doc.nodes[m.a === node.id ? m.b : m.a];
                return (
                    <div key={m.id} className="group mb-1 flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full bg-[#F24822]" />
                        <span className="min-w-0 flex-1 truncate">{m.a === m.b ? "Width" : `To ${other?.name ?? "a removed layer"}`}{m.label ? ` · ${m.label}` : ""}</span>
                        <button type="button" aria-label="Remove measurement" onClick={() => page && removeMeasurement(page.id, m.id)} className="text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}
        </Section>
    );
}

// Export: the layer's saved export settings (or 1x PNG), each downloadable.
export function DevExport({ nodes, doc }: { nodes: SceneNode[]; doc: NagmaDocument }) {
    const node = nodes[0];
    const [rows, setRows] = useState<{ format: "png" | "jpg" | "svg" | "pdf"; scale: number }[]>(() => node?.exportSettings?.map((e) => ({ format: e.format, scale: e.scale })) ?? [{ format: "png", scale: 1 }]);
    const [busy, setBusy] = useState(false);
    if (!node) return null;
    const select = "h-6 rounded-md bg-field px-1 text-ink outline-none";
    return (
        <Section
            title="Export"
            action={
                <button type="button" aria-label="Add export setting" onClick={() => setRows((r) => [...r, { format: "png", scale: 2 }])} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3.5" />
                </button>
            }
        >
            {rows.map((row, i) => (
                <div key={i} className="mb-1 flex items-center gap-1">
                    <Select aria-label="Scale" value={row.scale} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, scale: Number(e.target.value) } : x)))} className={`${select} w-14`}>
                        {[0.5, 1, 1.5, 2, 3, 4].map((s) => (
                            <option key={s} value={s}>
                                {s}x
                            </option>
                        ))}
                    </Select>
                    <Select aria-label="Format" value={row.format} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, format: e.target.value as typeof row.format } : x)))} className={`${select} flex-1`}>
                        {(["png", "jpg", "svg", "pdf"] as const).map((f) => (
                            <option key={f} value={f}>
                                {f.toUpperCase()}
                            </option>
                        ))}
                    </Select>
                    <button type="button" aria-label="Remove export setting" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="flex size-6 items-center justify-center rounded text-ink-subtle hover:bg-panel-hover hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            ))}
            {rows.length > 0 && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        try {
                            for (const row of rows) await exportLayers(doc, nodes.map((n) => n.id), row.format, row.scale);
                        } finally {
                            setBusy(false);
                        }
                    }}
                    className="mt-1 h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover disabled:opacity-50"
                >
                    {busy ? "Exporting…" : `Export ${nodes.length > 1 ? `${nodes.length} layers` : node.name}`}
                </button>
            )}
        </Section>
    );
}

// Inspect's layers view: frames by status (Ready for dev, Changed, Completed), above the layer tree.
export function DevStatusList() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const list = statusFrames(doc);
    const groups = (["ready", "changed", "completed"] as const).map((status) => ({ status, items: list.filter((x) => x.status === status) }));
    return (
        // Between Pages and Layers, as in the reference: a 40pt title row, then the frames by status.
        <div className="shrink-0 border-t border-panel-border pt-1">
            <div className="flex h-8 items-center gap-1 px-4 text-[11px] font-semibold">
                Ready for development
                {list.length > 0 && <span className="ml-auto font-normal text-ink-subtle">{list.length}</span>}
            </div>
            {list.length > 0 && (
                <button type="button" onClick={openReadyView} className="mx-3 mb-2 h-7 w-[calc(100%-24px)] rounded-md border border-panel-border text-[11px] hover:bg-panel-hover">
                    View all designs
                </button>
            )}
            {(
                <div className="max-h-72 overflow-y-auto pb-2 text-[11px]">
                    {list.length === 0 && (
                        <p className="flex gap-2 px-4 pt-2 pb-3 leading-4 text-ink">
                            <Code02 className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
                            Nothing marked as ready for development yet. Select a section or top level frame to mark it ready for dev.
                        </p>
                    )}
                    {groups
                        .filter((g) => g.items.length)
                        .map((g) => (
                            <div key={g.status}>
                                <div className="flex h-6 items-center gap-1.5 px-3 text-ink-muted">
                                    <StatusDot status={g.status} />
                                    {STATUS_LABEL[g.status]}
                                </div>
                                {g.items.map(({ node, page }) => (
                                    <button key={node.id} type="button" onClick={() => reveal(doc, node.id)} className={`flex h-7 w-full items-center gap-2 pr-3 pl-7 text-left hover:bg-panel-hover ${selection.includes(node.id) ? "bg-brand-100" : ""}`}>
                                        <span className="min-w-0 flex-1 truncate">{node.name}</span>
                                        {page && <span className="max-w-24 shrink-0 truncate text-ink-subtle">{page.name}</span>}
                                    </button>
                                ))}
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
}

// Inspect › Connect to code: what an AI coding tool connected to this file's server (through
// Nagma's MCP server and a personal access token) would get for the selection, and a prompt to
// start from. "+" sets up a token; "?" explains the connection.
export function ConnectToCode({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const [open, setOpen] = useState(true);
    const ids: string[] = [];
    const walk = (id: string) => {
        const n = doc.nodes[id];
        if (!n || ids.length > 2000) return;
        ids.push(id);
        n.children.forEach(walk);
    };
    walk(node.id);
    // About four characters a token, over the layers the tool would be sent.
    const tokens = Math.max(1, Math.round(JSON.stringify(ids.map((id) => doc.nodes[id])).length / 4));
    // The file on this computer (or the server's public address), never the network address.
    const prompt = `Implement this design from Nagma.\n@${fileLink("dev", { local: true })}`;
    const icon = "flex size-6 items-center justify-center rounded-[5px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink";
    return (
        <div className="border-b border-panel-border pb-3">
            <div className="flex h-10 items-center gap-1 pr-2 pl-1">
                <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-6 flex-1 items-center gap-1 rounded-[5px] px-1 text-left font-semibold outline-none">
                    <ChevronDown className={`size-3 text-ink-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                    Connect to code
                </button>
                <button type="button" aria-label="About connecting to code" title="Connect an AI coding tool to this file through Nagma's MCP server" onClick={() => window.open("https://github.com/fish-hook-studios/nagma#readme", "_blank", "noopener")} className={icon}>
                    <HelpCircle className="size-3.5" />
                </button>
                <button type="button" aria-label="Set up a connection" title="Create a personal access token for an AI coding tool" onClick={() => runAction("accountTokens")} className={icon}>
                    <Plus className="size-3.5" />
                </button>
            </div>
            {open && (
                <div className="px-4">
                    <div className="flex h-6 items-center font-semibold">Selection details</div>
                    <div className="grid h-6 grid-cols-[124px_1fr] items-center">
                        <span className="text-ink-muted">Layers</span>
                        <span>{ids.length}</span>
                    </div>
                    <div className="grid h-6 grid-cols-[124px_1fr] items-center">
                        <span className="text-ink-muted">Estimated tokens</span>
                        <span>{tokens}</span>
                    </div>
                    <pre className="mt-2 max-h-[54px] overflow-hidden rounded-[5px] border border-panel-border px-3 py-2 font-mono text-[11px] leading-[18px] whitespace-pre-wrap text-ink [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{prompt}</pre>
                    <button type="button" onClick={() => void copyText(prompt)} className="mt-2 flex h-8 w-full items-center justify-center rounded-[5px] border border-panel-border outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        Copy example prompt
                    </button>
                </div>
            )}
        </div>
    );
}

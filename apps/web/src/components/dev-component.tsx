import { Plus, X } from "@untitledui/icons";
import { nanoid } from "nanoid";
import { useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { applyCommand } from "../engine/commands";
import { CODE_LANGS } from "../engine/dev-code";
import { findVariant, setProperties, variantProps } from "../engine/components";
import { makeNode } from "../engine/nodes";
import { editor } from "../engine/store";
import { renderThumb } from "../engine/thumb";
import type { CodeConnectSnippet, ComponentProp, NagmaDocument, SceneNode } from "../engine/types";
import { Select } from "./select";
import { CodeConnectRepoDialog } from "./code-connect-repo";

// Inspect's component tools: the playground, where a component's variants and properties can be
// tried without touching the file, and the connected code a design system attaches to it.

function mainOf(doc: NagmaDocument, node: SceneNode): { main: SceneNode; set: SceneNode | undefined } | null {
    const main = node.type === "instance" && node.componentId ? doc.nodes[node.componentId] : node.type === "component" ? node : node.type === "componentSet" ? doc.nodes[node.children[0] ?? ""] : undefined;
    if (!main || main.type !== "component") return null;
    const set = main.parentId && doc.nodes[main.parentId]?.type === "componentSet" ? doc.nodes[main.parentId] : undefined;
    return { main, set };
}

// A throwaway copy of the document with one instance of the chosen variant and property values,
// drawn on its own.
function playgroundPicture(doc: NagmaDocument, componentId: string, values: Record<string, boolean | string>): string {
    const component = doc.nodes[componentId];
    if (!component) return "";
    const pageId = (() => {
        let p: SceneNode | undefined = component;
        while (p && p.type !== "page") p = p.parentId ? doc.nodes[p.parentId] : undefined;
        return p?.id ?? doc.roots[0] ?? null;
    })();
    const instance = makeNode(doc, "instance", { x: component.x, y: component.y - component.h - 10000, w: component.w, h: component.h }, pageId, { componentId, fills: [], overrides: [], propValues: values, name: component.name });
    const tmp = applyCommand(doc, { type: "node.create", node: instance });
    return renderThumb(tmp, 560, 320, instance.id);
}

export function Playground({ node, doc, close }: { node: SceneNode; doc: NagmaDocument; close: () => void }) {
    const found = mainOf(doc, node);
    const set = found?.set;
    const [variant, setVariantState] = useState<Record<string, string>>(() => (found ? variantProps(found.main.name) : {}));
    const props: ComponentProp[] = (found?.main.componentProps ?? set?.componentProps ?? []).filter((p) => p.kind !== "slot");
    const [values, setValues] = useState<Record<string, boolean | string>>(() => Object.fromEntries(props.map((p) => [p.id, node.type === "instance" ? (node.propValues?.[p.id] ?? p.defaultValue) : p.defaultValue])));
    const componentId = set ? (findVariant(doc, set.id, variant) ?? found?.main.id ?? "") : (found?.main.id ?? "");
    const picture = playgroundPicture(doc, componentId, values);
    if (!found) return null;
    const axes = set ? setProperties(doc, set.id) : [];
    const swaps = (p: ComponentProp) => Object.values(doc.nodes).filter((n) => n.type === "component" && (!p.preferred?.length || p.preferred.includes(n.id)));
    return (
        <>
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-border px-4">
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Playground · {(set ?? found.main).name}</h2>
                <button
                    type="button"
                    onClick={() => {
                        setVariantState(variantProps(found.main.name));
                        setValues(Object.fromEntries(props.map((p) => [p.id, p.defaultValue])));
                    }}
                    className="h-7 rounded-md px-2 text-brand-500 hover:bg-panel-hover"
                >
                    Reset
                </button>
                <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                    <X className="size-4" />
                </button>
            </div>
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 items-center justify-center bg-[#2A2A2E] p-4">{picture ? <img src={picture} alt={`${(set ?? found.main).name} preview`} className="max-h-full max-w-full rounded" /> : null}</div>
                <div className="w-60 shrink-0 space-y-2 overflow-y-auto border-l border-panel-border p-3 text-[11px]">
                    <p className="text-ink-muted">Try the properties here. The file doesn't change.</p>
                    {axes.map(([name, options]) => (
                        <label key={name} className="grid grid-cols-[80px_1fr] items-center gap-2">
                            <span className="truncate text-ink-muted">{name}</span>
                            <Select aria-label={name} value={variant[name] ?? options[0] ?? ""} onChange={(e) => setVariantState((v) => ({ ...v, [name]: e.target.value }))} className="h-7 rounded-md bg-field px-1.5">
                                {options.map((o) => (
                                    <option key={o} value={o}>
                                        {o}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    ))}
                    {props.map((p) => (
                        <label key={p.id} className="grid grid-cols-[80px_1fr] items-center gap-2">
                            <span className="truncate text-ink-muted">{p.name}</span>
                            {p.kind === "boolean" ? (
                                <input type="checkbox" checked={values[p.id] === true} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.checked }))} aria-label={p.name} className="size-3.5 accent-brand-500" />
                            ) : p.kind === "text" ? (
                                <input value={String(values[p.id] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))} onKeyDown={(e) => e.stopPropagation()} aria-label={p.name} className="h-7 min-w-0 rounded-md bg-field px-2 outline-none focus:ring-1 focus:ring-brand-500" />
                            ) : (
                                <Select aria-label={p.name} value={String(values[p.id] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))} className="h-7 rounded-md bg-field px-1.5">
                                    {swaps(p).map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </label>
                    ))}
                    {!axes.length && !props.length && <p className="text-ink-subtle">This component has no properties to try.</p>}
                </div>
            </div>
        </>
    );
}

export function PlaygroundButton({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const [open, setOpen] = useState(false);
    if (!mainOf(doc, node)) return null;
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="mt-2 h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                Explore component behaviour
            </button>
            <AriaModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
                <AriaModal className="flex h-[440px] w-[820px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                    <AriaDialog aria-label="Playground" className="flex min-h-0 flex-1 flex-col outline-none">
                        {open && <Playground node={node} doc={doc} close={() => setOpen(false)} />}
                    </AriaDialog>
                </AriaModal>
            </AriaModalOverlay>
        </>
    );
}

// Connected code: snippets per language on the component (or its set), edited here.
export function ConnectedCodeEditor({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const found = mainOf(doc, node);
    const host = found ? (found.set ?? found.main) : undefined;
    const [editing, setEditing] = useState<CodeConnectSnippet | null>(null);
    const [repoOpen, setRepoOpen] = useState(false);
    if (!host) return null;
    const list = host.codeConnect ?? [];
    const save = (next: CodeConnectSnippet[]) => editor.execute({ type: "node.update", id: host.id, patch: { codeConnect: next.length ? next : undefined } });
    const field = "h-7 w-full rounded-md bg-field px-2 outline-none focus:ring-1 focus:ring-brand-500";
    return (
        <div className="mt-2">
            <div className="mb-1 flex h-6 items-center justify-between">
                <span className="text-ink-muted">Connected code</span>
                <button
                    type="button"
                    aria-label="Connect code"
                    title="Connect code"
                    onClick={() => setEditing({ id: nanoid(6), lang: "css", name: host.name.replace(/[^a-z0-9]+/gi, ""), code: "" })}
                    className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink"
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
            {list.length === 0 && !editing && <p className="text-ink-subtle">Attach the design system's code for this component. Its instances show it in Code.</p>}
            <button type="button" onClick={() => setRepoOpen(true)} className="mt-1 text-[11px] text-brand-500 hover:underline">
                Connect a repository…
            </button>
            {repoOpen && <CodeConnectRepoDialog onClose={() => setRepoOpen(false)} />}
            {list.map((c) => (
                <div key={c.id} className="group flex h-7 items-center gap-2 rounded px-1 hover:bg-panel-hover">
                    <span className="w-14 shrink-0 text-ink-muted">{CODE_LANGS.find((l) => l.id === c.lang)?.label}</span>
                    <button type="button" onClick={() => setEditing(c)} className="min-w-0 flex-1 truncate text-left">
                        {c.name || "Snippet"}
                    </button>
                    <button type="button" aria-label={`Remove ${c.name}`} onClick={() => save(list.filter((x) => x.id !== c.id))} className="text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            ))}
            {editing && (
                <form
                    className="mt-1 space-y-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!editing.code.trim()) return;
                        const exists = list.some((x) => x.id === editing.id);
                        save(exists ? list.map((x) => (x.id === editing.id ? editing : x)) : [...list, editing]);
                        setEditing(null);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <Select aria-label="Language" value={editing.lang} onChange={(e) => setEditing({ ...editing, lang: e.target.value as CodeConnectSnippet["lang"] })} className={field}>
                        {CODE_LANGS.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.platform} · {l.label}
                            </option>
                        ))}
                    </Select>
                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Component name in code" aria-label="Component name in code" className={field} />
                    <input value={editing.source ?? ""} onChange={(e) => setEditing({ ...editing, source: e.target.value || undefined })} placeholder="Link to the source (optional)" aria-label="Source link" className={field} />
                    <textarea
                        value={editing.code}
                        onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                        placeholder={'<Button variant="{Variant}">{Label}</Button>'}
                        aria-label="Code"
                        rows={4}
                        className="w-full rounded-md bg-field p-2 font-mono text-[10.5px] outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <p className="text-[10px] text-ink-subtle">{"Write {Property} to put in an instance's property value."}</p>
                    <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setEditing(null)} className="h-6 rounded px-2 text-ink-muted hover:bg-panel-hover">
                            Cancel
                        </button>
                        <button type="submit" className="h-6 rounded bg-brand-500 px-2 font-semibold text-white">
                            Save
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}

// Compare with main component: the instance beside its main component, and each overridden
// property with the main component's value and the instance's.
function short(v: unknown): string {
    if (v === undefined || v === null) return "None";
    if (typeof v === "number") return String(Math.round(v * 100) / 100);
    if (typeof v === "string") return v.length > 50 ? `${v.slice(0, 49)}…` : v;
    if (typeof v === "boolean") return v ? "On" : "Off";
    // Paint lists read as their colours (or kinds).
    if (Array.isArray(v) && v.every((p) => p && typeof p === "object" && "type" in p)) return v.length ? v.map((p: { type: string; color?: string }) => (p.type === "solid" ? (p.color ?? "") : p.type)).join(", ") : "None";
    const t = JSON.stringify(v);
    return t.length > 70 ? `${t.slice(0, 69)}…` : t;
}

function MainCompare({ node, doc, close }: { node: SceneNode; doc: NagmaDocument; close: () => void }) {
    const main = node.componentId ? doc.nodes[node.componentId] : undefined;
    if (!main) return null;
    const rows: { id: string; name: string; key: string; before: string; after: string }[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        const source = id === node.id ? main : n.sourceId ? doc.nodes[n.sourceId] : undefined;
        for (const key of n.overrides ?? []) {
            const a = source ? (source as unknown as Record<string, unknown>)[key] : undefined;
            const b = (n as unknown as Record<string, unknown>)[key];
            if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) rows.push({ id, name: n.name, key, before: short(a), after: short(b) });
        }
        n.children.forEach(visit);
    };
    visit(node.id);
    for (const [k, v] of Object.entries(node.propValues ?? {})) {
        const prop = (main.componentProps ?? []).find((p) => p.id === k);
        if (prop && v !== prop.defaultValue) rows.push({ id: `prop-${k}`, name: "Property", key: prop.name, before: short(prop.defaultValue), after: short(v) });
    }
    return (
        <>
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-panel-border px-4">
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Compare with main component · {node.name}</h2>
                <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                    <X className="size-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[11px]">
                <div className="grid grid-cols-2 gap-3">
                    {(
                        [
                            ["Main component", main.id],
                            ["This instance", node.id],
                        ] as const
                    ).map(([label, id]) => (
                        <figure key={label} className="space-y-1.5">
                            <img src={renderThumb(doc, 480, 300, id)} alt={label} className="w-full rounded-md border border-panel-border" />
                            <figcaption className="text-ink-muted">{label}</figcaption>
                        </figure>
                    ))}
                </div>
                {rows.length === 0 ? (
                    <p className="text-ink-muted">This instance has no overrides.</p>
                ) : (
                    <div className="space-y-0.5">
                        {rows.map((r) => (
                            <div key={`${r.id}:${r.key}`} className="grid grid-cols-[110px_90px_1fr_1fr] gap-2 py-0.5 font-mono text-[10.5px]">
                                <span className="truncate font-sans text-ink">{r.name}</span>
                                <span className="truncate text-ink-muted">{r.key}</span>
                                <span className="break-all text-red-400">{r.before}</span>
                                <span className="break-all text-emerald-500">{r.after}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

export function CompareMainButton({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const [open, setOpen] = useState(false);
    if (node.type !== "instance" || !node.componentId || !doc.nodes[node.componentId]) return null;
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="mt-1 h-6 rounded-md px-1 text-brand-500 hover:bg-panel-hover">
                Compare with main component
            </button>
            <AriaModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
                <AriaModal className="flex max-h-[84vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                    <AriaDialog aria-label="Compare with main component" className="flex min-h-0 flex-col outline-none">
                        {open && <MainCompare node={node} doc={doc} close={() => setOpen(false)} />}
                    </AriaDialog>
                </AriaModal>
            </AriaModalOverlay>
        </>
    );
}

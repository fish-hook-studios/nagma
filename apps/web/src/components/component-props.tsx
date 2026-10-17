import { Edit05, Plus, X, XClose } from "@untitledui/icons";
import { useMemo, useState } from "react";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Modal as AriaModal,
    ModalOverlay as AriaModalOverlay,
    Popover as AriaPopover,
    Separator as AriaSeparator,
} from "react-aria-components";
import { type BindField, FIELD_KIND, addVariantProperty, bindProp, createProp, deleteProp, nestedInstances, propDefaultFrom, propHost, removeVariantProperty, renameVariantProperty, setExposed, updateProp } from "../engine/component-actions";
import { assetName, propValue, propsOf, setProperties } from "../engine/components";
import { editor, useEditor } from "../engine/store";
import type { ComponentProp, NagmaDocument, SceneNode } from "../engine/types";
import { collectionsOf, findVariable } from "../engine/variables";
import { useAssetSources, componentForAsset, localAssetId } from "./asset-sources";
import { ComponentIcon } from "./component-icons";
import { type PropEditing, editProp, usePropEditing } from "./component-ui";
import { MenuRow } from "./left-sidebar";
import { SwapMenu } from "./instance-swap";
import { Select } from "./select";
import { DescriptionField, MarkdownView } from "./rich-description";

// Component properties: a Properties list on the main component (create, edit in a
// window, delete), "Apply component property" buttons on the fields of layers inside it
// (visibility, text content, nested instance), which become pills once bound, and the values on
// each instance.

const KIND_LABEL: Record<ComponentProp["kind"] | "variant", string> = { boolean: "Boolean", text: "Text", swap: "Instance swap", slot: "Slot", variant: "Variant" };

// A small diamond-in-a-box: the "component property" mark used on buttons and pills.
export function PropIcon({ className = "size-3" }: { className?: string }) {
    return (
        <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2" />
            <path d="M6 3.4 8.6 6 6 8.6 3.4 6z" strokeLinejoin="round" />
        </svg>
    );
}

function KindIcon({ kind }: { kind: ComponentProp["kind"] | "variant" }) {
    if (kind === "boolean")
        return (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <rect x="1" y="3.5" width="10" height="5" rx="2.5" />
                <circle cx="8.5" cy="6" r="1.3" fill="currentColor" />
            </svg>
        );
    if (kind === "text") return <span className="text-[10px] font-semibold">T</span>;
    if (kind === "swap")
        return (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <path d="M6 1.5 10.5 6 6 10.5 1.5 6z" strokeLinejoin="round" />
            </svg>
        );
    if (kind === "slot")
        return (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.4" aria-hidden="true">
                <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="1.5" />
            </svg>
        );
    return <ComponentIcon className="size-3" />;
}

// ---- Binding a layer's field to a property ----

// The "Apply component property" button next to a field, or the bound property's pill.
export function PropBinding({ node, field }: { node: SceneNode; field: BindField }) {
    const doc = useEditor((s) => s.doc);
    const host = propHost(doc, node);
    if (!host || node.sourceId || node.id === host.id || node.type === "component") return null;
    const kind = FIELD_KIND[field];
    const props = (host.componentProps ?? []).filter((p) => p.kind === kind);
    const bound = node.propBindings?.[field] ? props.find((p) => p.id === node.propBindings?.[field]) : undefined;
    const label = field === "visible" ? "Apply boolean property" : field === "text" ? "Apply text property" : field === "swap" ? "Apply instance swap property" : "Apply slot property";
    const act = (key: React.Key) => {
        const k = String(key);
        if (k === "__new") editProp({ hostId: host.id, propId: null, kind, bind: { nodeId: node.id, field } });
        else if (k === "__detach") bindProp(node.id, field, null);
        else if (k === "__edit" && bound) editProp({ hostId: host.id, propId: bound.id, kind });
        else bindProp(node.id, field, k);
    };
    const menu = (
        <AriaPopover placement="bottom end" className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
            <AriaMenu className="outline-none" onAction={act} aria-label={label}>
                {props.map((p) => (
                    <MenuRow key={p.id} id={p.id} label={p.name} checked={bound?.id === p.id} />
                ))}
                {props.length > 0 && <AriaSeparator className="my-1 h-px bg-white/10" />}
                {bound && <MenuRow id="__edit" label="Edit property" />}
                {bound && <MenuRow id="__detach" label="Detach property" />}
                <MenuRow id="__new" label="Create property…" />
            </AriaMenu>
        </AriaPopover>
    );
    if (bound)
        return (
            <span className="flex items-center gap-0.5">
                <AriaMenuTrigger>
                    <AriaButton aria-label={`${bound.name} property`} className="flex h-6 max-w-[120px] items-center gap-1 rounded-md bg-[#9747FF]/15 px-1.5 text-[#B67CFF] outline-none hover:bg-[#9747FF]/25">
                        <PropIcon />
                        <span className="truncate">{bound.name}</span>
                    </AriaButton>
                    {menu}
                </AriaMenuTrigger>
                <AriaButton aria-label="Detach property" onPress={() => bindProp(node.id, field, null)} className="flex size-5 items-center justify-center rounded text-ink-subtle outline-none hover:bg-panel-hover hover:text-ink">
                    <X className="size-3" />
                </AriaButton>
            </span>
        );
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={label} className="flex size-6 items-center justify-center rounded-md text-ink-subtle outline-none hover:bg-panel-hover hover:text-ink">
                <PropIcon className="size-3.5" />
            </AriaButton>
            {menu}
        </AriaMenuTrigger>
    );
}

// ---- The Properties list on a main component or set ----

// The "+" that creates a component property; on a component set it also adds a variant.
export function CreatePropertyMenu({ host, onAddVariant }: { host: SceneNode; onAddVariant?: () => void }) {
    const add = (key: React.Key) => {
        const k = String(key);
        if (k === "newVariant") return onAddVariant?.();
        editProp({ hostId: host.id, propId: null, kind: k as PropEditing["kind"] });
    };
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Create component property" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Plus className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu className="outline-none" onAction={add} aria-label="Create component property">
                    {onAddVariant && <MenuRow id="newVariant" label="Add variant" />}
                    {onAddVariant && <AriaSeparator className="-mx-1 my-1 h-px bg-white/10" />}
                    <MenuRow id="variant" label="Variant" />
                    <MenuRow id="boolean" label="Boolean" />
                    <MenuRow id="swap" label="Instance swap" />
                    <MenuRow id="text" label="Text" />
                    <MenuRow id="slot" label="Slot" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// `bare` leaves out the "Properties +" heading (the section's own title carries it).
export function PropertiesList({ host, component, bare = false }: { host: SceneNode; component?: SceneNode; bare?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const variants = host.type === "componentSet" ? setProperties(doc, host.id) : [];
    const props = host.componentProps ?? [];
    const nested = component ? nestedInstances(doc, component.id) : host.type === "componentSet" ? host.children.flatMap((id) => nestedInstances(doc, id)) : [];
    return (
        <div className="space-y-1">
            {!bare && (
                <div className="flex h-6 items-center justify-between">
                    <span className="text-ink-muted">Properties</span>
                    <CreatePropertyMenu host={host} />
                </div>
            )}
            {variants.map(([name, values]) => (
                <PropRow key={`v:${name}`} kind="variant" name={name} value={values.join(", ")} onEdit={() => editProp({ hostId: host.id, propId: null, kind: "variant", variantName: name })} onDelete={() => removeVariantProperty(host.id, name)} />
            ))}
            {props.map((p) => (
                <PropRow key={p.id} kind={p.kind} name={p.name} value={describeDefault(doc, p)} description={p.description} onEdit={() => editProp({ hostId: host.id, propId: p.id, kind: p.kind })} onDelete={() => deleteProp(host.id, p.id)} />
            ))}
            {!variants.length && !props.length && <p className="text-ink-subtle">Create properties for the parts of this component that instances can change.</p>}
            {nested.length > 0 && (
                <div className="pt-1">
                    <div className="text-ink-muted">Nested instances</div>
                    {nested.map((n) => (
                        <label key={n.id} className="flex h-6 items-center gap-2" title="Show this nested instance's properties on instances of the component">
                            <input type="checkbox" checked={Boolean(n.exposed)} onChange={(e) => setExposed([n.id], e.target.checked)} className="accent-[#9747FF]" />
                            <KindIcon kind="swap" />
                            <span className="min-w-0 flex-1 truncate">{n.name}</span>
                            <span className="text-ink-subtle">{n.exposed ? "Exposed" : ""}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

function describeDefault(doc: NagmaDocument, p: ComponentProp): string {
    if (p.defaultVariable) return findVariable(doc, p.defaultVariable)?.variable.name ?? "Variable";
    if (p.kind === "boolean") return p.defaultValue ? "True" : "False";
    if (p.kind === "swap") return typeof p.defaultValue === "string" && p.defaultValue ? assetName(doc, p.defaultValue) : "None";
    if (p.kind === "slot") return [p.minItems != null ? `min ${p.minItems}` : "", p.maxItems != null ? `max ${p.maxItems}` : ""].filter(Boolean).join(", ") || "Any layers";
    return String(p.defaultValue);
}

function PropRow({ kind, name, value, description, onEdit, onDelete }: { kind: ComponentProp["kind"] | "variant"; name: string; value: string; description?: string; onEdit: () => void; onDelete: () => void }) {
    return (
        <div className="group/prop flex h-6 items-center gap-2 rounded-md px-1 hover:bg-panel-hover" title={description || undefined}>
            <span className="flex w-4 justify-center text-ink-muted">
                <KindIcon kind={kind} />
            </span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="max-w-[80px] truncate text-ink-subtle group-hover/prop:hidden">{value}</span>
            <span className="hidden items-center group-hover/prop:flex">
                <AriaButton aria-label={`Edit ${name}`} onPress={onEdit} className="flex size-5 items-center justify-center rounded text-ink-muted outline-none hover:text-ink">
                    <Edit05 className="size-3" />
                </AriaButton>
                <AriaButton aria-label={`Delete ${name}`} onPress={onDelete} className="flex size-5 items-center justify-center rounded text-ink-muted outline-none hover:text-ink">
                    <X className="size-3" />
                </AriaButton>
            </span>
        </div>
    );
}

// ---- Values on an instance ----

export function InstancePropValues({ instance, component, nested = false }: { instance: SceneNode; component: SceneNode; nested?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const props = propsOf(doc, component).filter((p) => p.kind !== "slot");
    if (!props.length) return null;
    const values = instance.propValues ?? {};
    const set = (id: string, value: boolean | string) => editor.execute({ type: "node.update", id: instance.id, patch: { propValues: { ...values, [id]: value } } });
    const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    return (
        <div className={`space-y-1.5 ${nested ? "" : ""}`}>
            {props.map((p) => {
                const modified = p.id in values;
                const current = propValue(doc, p, instance);
                return (
                    <div key={p.id} className="flex items-center gap-2" title={p.description || undefined}>
                        <span className={`w-20 shrink-0 truncate ${modified ? "text-ink" : "text-ink-muted"}`}>{p.name}</span>
                        {p.kind === "boolean" ? (
                            <button type="button" role="switch" aria-checked={Boolean(current)} aria-label={p.name} onClick={() => set(p.id, !current)} className={`relative h-4 w-7 shrink-0 rounded-full ${current ? "bg-brand-500" : "bg-ink-subtle/40"}`}>
                                <span className={`absolute top-0.5 size-3 rounded-full bg-white ${current ? "left-[14px]" : "left-0.5"}`} />
                            </button>
                        ) : p.kind === "text" ? (
                            <input key={`${instance.id}:${String(current)}`} defaultValue={String(current)} aria-label={p.name} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value !== String(current) && set(p.id, e.target.value)} className={`${field} flex-1`} />
                        ) : (
                            <SwapValue instance={instance} prop={p} value={String(current)} onPick={(id) => set(p.id, id)} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// An instance swap property's value: the instance swap menu, preferred instances first.
function SwapValue({ instance, prop, value, onPick }: { instance: SceneNode; prop: ComponentProp; value: string; onPick: (id: string) => void }) {
    const doc = useEditor((s) => s.doc);
    const sources = useAssetSources();
    void instance;
    const assetOf = (id: string) => {
        const c = doc.nodes[id];
        const parent = c ? doc.nodes[c.parentId ?? ""] : undefined;
        const asset = parent?.type === "componentSet" ? parent : c;
        if (!asset) return null;
        return asset.libraryId && asset.libraryKey ? { sourceId: asset.libraryId, assetId: asset.libraryKey } : { sourceId: "local", assetId: asset.id };
    };
    const preferred = (prop.preferred ?? []).map(assetOf).filter((x): x is { sourceId: string; assetId: string } => Boolean(x));
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={prop.name} className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-field px-1.5 text-left outline-none hover:ring-1 hover:ring-panel-border">
                <KindIcon kind="swap" />
                <span className="min-w-0 flex-1 truncate">{value ? assetName(doc, value) : "None"}</span>
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label={prop.name}>
                    {({ close }) => (
                        <SwapMenu
                            sources={sources}
                            title={prop.name}
                            current={value ? assetOf(value) : null}
                            preferred={preferred}
                            onPick={async (t) => {
                                close();
                                const local = await localAssetId(t.source.id, t.entry.id);
                                const id = local ? componentForAsset(editor.get().doc, local) : null;
                                if (id) onPick(id);
                            }}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// ---- Description and documentation links ----

export function DescriptionEditor({ node }: { node: SceneNode }) {
    return <DescriptionField key={node.id} value={node} label="Component description" onChange={(patch) => editor.execute({ type: "node.update", id: node.id, patch })} />;
}

// Read-only description for instances and Inspect.
export function DescriptionView({ node }: { node: SceneNode | undefined }) {
    if (!node) return null;
    return <MarkdownView value={node} />;
}

// ---- The property window ----

export function PropertyModalHost() {
    const editing = usePropEditing();
    if (!editing) return null;
    return <PropertyModal key={`${editing.hostId}:${editing.propId ?? editing.variantName ?? "new"}`} editing={editing} />;
}

function PropertyModal({ editing }: { editing: PropEditing }) {
    const doc = useEditor((s) => s.doc);
    const host = doc.nodes[editing.hostId];
    const existing = editing.propId ? (host?.componentProps ?? []).find((p) => p.id === editing.propId) : undefined;
    const variantValues = editing.variantName && host ? (setProperties(doc, host.id).find(([k]) => k === editing.variantName)?.[1] ?? []) : [];
    const [kind, setKind] = useState<PropEditing["kind"]>(existing?.kind ?? editing.kind);
    const [name, setName] = useState(existing?.name ?? editing.variantName ?? defaultName(editing.kind, host?.componentProps ?? []));
    const [description, setDescription] = useState(existing?.description ?? "");
    const initialDefault = existing?.defaultValue ?? (editing.bind ? propDefaultFrom(doc, editing.bind.nodeId, editing.bind.field) : kind === "boolean" ? true : kind === "variant" ? "Default" : "");
    const [value, setValue] = useState<boolean | string>(editing.variantName ? (variantValues[0] ?? "") : initialDefault);
    const [variable, setVariable] = useState<string>(existing?.defaultVariable ?? "");
    const [preferred, setPreferred] = useState<string[]>(existing?.preferred ?? []);
    const [minItems, setMin] = useState<string>(existing?.minItems != null ? String(existing.minItems) : "");
    const [maxItems, setMax] = useState<string>(existing?.maxItems != null ? String(existing.maxItems) : "");
    const [onlyPreferred, setOnly] = useState(Boolean(existing?.onlyPreferred));
    const [stretchChild, setStretchChild] = useState(Boolean(existing?.stretchChildOnInsert));
    const [emptyByDefault, setEmptyByDefault] = useState(Boolean(existing?.displayEmptyByDefault));
    const close = () => editProp(null);
    const creating = !existing && !editing.variantName;
    const kindLocked = Boolean(existing || editing.bind || editing.variantName);
    const variables = useMemo(() => collectionsOf(doc).flatMap((c) => c.variables.filter((v) => (kind === "boolean" ? v.type === "boolean" : kind === "text" ? v.type === "string" : false)).map((v) => ({ id: v.id, label: `${c.name} / ${v.name}` }))), [doc, kind]);
    if (!host) return null;
    const save = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (kind === "variant") {
            if (editing.variantName) {
                if (trimmed !== editing.variantName) renameVariantProperty(host.id, editing.variantName, trimmed);
            } else addVariantProperty(host.type === "componentSet" ? host.id : host.id, trimmed, String(value || "Default"));
            close();
            return;
        }
        const fields: Omit<ComponentProp, "id"> = {
            name: trimmed,
            kind,
            defaultValue: kind === "boolean" ? Boolean(value) : String(value ?? ""),
            ...(description.trim() ? { description: description.trim() } : { description: undefined }),
            defaultVariable: variable || undefined,
            ...(kind === "swap" || kind === "slot" ? { preferred } : {}),
            ...(kind === "slot" ? { minItems: minItems === "" ? null : Math.max(0, Number(minItems) || 0), maxItems: maxItems === "" ? null : Math.max(0, Number(maxItems) || 0), onlyPreferred, stretchChildOnInsert: stretchChild, displayEmptyByDefault: emptyByDefault } : {}),
        };
        if (existing) updateProp(host.id, existing.id, fields);
        else createProp(host.id, fields, editing.bind);
        close();
    };
    const field = "h-8 w-full rounded-md border border-panel-border bg-field px-2 text-ink outline-none focus:border-brand-500";
    const allComponents = Object.values(doc.nodes).filter((n) => n.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet").concat(Object.values(doc.nodes).filter((n) => n.type === "componentSet"));
    return (
        <AriaModalOverlay isOpen isDismissable onOpenChange={(open) => !open && close()} className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            <AriaModal className="w-[320px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label={creating ? "Create component property" : "Edit component property"}>
                    <header className="flex h-11 items-center justify-between border-b border-panel-border px-3">
                        <h2 className="text-[13px] font-semibold">{creating ? "Create component property" : "Edit component property"}</h2>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-4" />
                        </button>
                    </header>
                    <form
                        className="max-h-[65vh] space-y-3 overflow-y-auto p-3 text-[12px]"
                        onSubmit={(e) => {
                            e.preventDefault();
                            save();
                        }}
                    >
                        <label className="block space-y-1">
                            <span className="text-ink-muted">Name</span>
                            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={field} aria-label="Property name" />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-ink-muted">Type</span>
                            <Select value={kind} disabled={kindLocked} onChange={(e) => setKind(e.target.value as PropEditing["kind"])} className={field} aria-label="Property type">
                                {(["variant", "boolean", "swap", "text", "slot"] as const).map((k) => (
                                    <option key={k} value={k}>
                                        {KIND_LABEL[k]}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        {kind !== "slot" && !editing.variantName && (
                            <div className="space-y-1">
                                <span className="text-ink-muted">{kind === "variant" ? "Default value" : "Value"}</span>
                                {kind === "boolean" ? (
                                    <div className="flex gap-1">
                                        {[true, false].map((b) => (
                                            <button key={String(b)} type="button" onClick={() => setValue(b)} disabled={Boolean(variable)} className={`h-8 flex-1 rounded-md border ${value === b ? "border-brand-500 bg-brand-500/15" : "border-panel-border"} disabled:opacity-40`}>
                                                {b ? "True" : "False"}
                                            </button>
                                        ))}
                                    </div>
                                ) : kind === "swap" ? (
                                    <Select value={String(value)} onChange={(e) => setValue(e.target.value)} className={field} aria-label="Default instance">
                                        <option value="">None</option>
                                        {Object.values(doc.nodes)
                                            .filter((n) => n.type === "component")
                                            .map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {doc.nodes[c.parentId ?? ""]?.type === "componentSet" ? `${assetName(doc, c.id)} / ${c.name}` : c.name}
                                                </option>
                                            ))}
                                    </Select>
                                ) : (
                                    <input value={String(value)} disabled={Boolean(variable)} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${field} disabled:opacity-40`} aria-label="Default value" />
                                )}
                            </div>
                        )}
                        {(kind === "boolean" || kind === "text") && (
                            <label className="block space-y-1">
                                <span className="text-ink-muted">Variable for the value</span>
                                <Select value={variable} onChange={(e) => setVariable(e.target.value)} className={field} aria-label="Variable for the default value">
                                    <option value="">None</option>
                                    {variables.map((v) => (
                                        <option key={v.id} value={v.id}>
                                            {v.label}
                                        </option>
                                    ))}
                                </Select>
                                {!variables.length && <span className="block text-ink-subtle">No {kind === "boolean" ? "boolean" : "string"} variables in this file.</span>}
                            </label>
                        )}
                        {(kind === "swap" || kind === "slot") && (
                            <div className="space-y-1">
                                <span className="text-ink-muted">Preferred instances</span>
                                <div className="max-h-36 overflow-y-auto rounded-md border border-panel-border p-1">
                                    {allComponents.map((c) => (
                                        <label key={c.id} className="flex h-6 items-center gap-2 px-1 hover:bg-panel-hover">
                                            <input type="checkbox" checked={preferred.includes(c.id)} onChange={(e) => setPreferred(e.target.checked ? [...preferred, c.id] : preferred.filter((x) => x !== c.id))} className="accent-brand-500" />
                                            <ComponentIcon className="size-3 shrink-0 text-[#B67CFF]" />
                                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                        </label>
                                    ))}
                                    {!allComponents.length && <p className="p-1 text-ink-subtle">No components in this file.</p>}
                                </div>
                            </div>
                        )}
                        {kind === "slot" && (
                            <>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="space-y-1">
                                        <span className="text-ink-muted">Minimum layers</span>
                                        <input type="number" min={0} value={minItems} onChange={(e) => setMin(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={field} aria-label="Minimum layers" />
                                    </label>
                                    <label className="space-y-1">
                                        <span className="text-ink-muted">Maximum layers</span>
                                        <input type="number" min={0} value={maxItems} onChange={(e) => setMax(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={field} aria-label="Maximum layers" />
                                    </label>
                                </div>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={onlyPreferred} onChange={(e) => setOnly(e.target.checked)} className="accent-brand-500" />
                                    Only allow preferred instances
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={stretchChild} onChange={(e) => setStretchChild(e.target.checked)} className="accent-brand-500" />
                                    Stretch layers to fill the slot when inserted
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={emptyByDefault} onChange={(e) => setEmptyByDefault(e.target.checked)} className="accent-brand-500" />
                                    Show the slot empty by default
                                </label>
                            </>
                        )}
                        {kind !== "variant" && (
                            <label className="block space-y-1">
                                <span className="text-ink-muted">Description</span>
                                <textarea value={description} rows={2} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${field} h-auto resize-none py-1.5`} aria-label="Property description" />
                            </label>
                        )}
                        <div className="flex justify-between gap-2 pt-1">
                            {existing ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        deleteProp(host.id, existing.id);
                                        close();
                                    }}
                                    className="h-8 rounded-md px-2 text-red-400 hover:bg-panel-hover"
                                >
                                    Delete property
                                </button>
                            ) : (
                                <span />
                            )}
                            <button type="submit" disabled={!name.trim()} className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-40">
                                {creating ? "Create property" : "Save"}
                            </button>
                        </div>
                    </form>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function defaultName(kind: PropEditing["kind"], props: ComponentProp[]): string {
    const base = kind === "boolean" ? "Show item" : kind === "text" ? "Label" : kind === "swap" ? "Instance" : kind === "slot" ? "Slot" : "Property";
    const used = new Set(props.map((p) => p.name));
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}


// Inspect: the main component of the selection, with its description and documentation links.
export function ComponentInfo({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const component = node.type === "instance" ? doc.nodes[node.componentId ?? ""] : node.type === "component" || node.type === "componentSet" ? node : undefined;
    if (!component) return null;
    const set = doc.nodes[component.parentId ?? ""];
    const main = set?.type === "componentSet" ? set : component;
    const variant = set?.type === "componentSet" ? component.name : null;
    const values = node.type === "instance" ? propsOf(doc, component).map((p) => [p.name, String(propValue(doc, p, node))] as const) : [];
    return (
        <div className="border-b border-panel-border px-3 py-2.5">
            <div className="mb-1.5 flex h-6 items-center gap-1.5 font-semibold text-[#B67CFF]">
                <ComponentIcon className="size-3.5" /> {main.name}
            </div>
            {main.libraryId && <div className="text-ink-subtle">From a library</div>}
            {variant && <div className="truncate text-ink-muted">{variant}</div>}
            {values.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                    <span className="w-20 shrink-0 truncate text-ink-muted">{k}</span>
                    <span className="min-w-0 flex-1 truncate">{v}</span>
                </div>
            ))}
            <div className="mt-1">
                <DescriptionView node={main} />
            </div>
        </div>
    );
}

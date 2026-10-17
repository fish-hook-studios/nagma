import { SearchSm, X } from "@untitledui/icons";
import { useMemo, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Header as AriaHeader, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Section as AriaSection, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { editor, useEditor } from "../engine/store";
import type { SceneNode, Variable, VariableCollection, VariableType } from "../engine/types";
import { SCOPE_LABELS, addVariable, allowedFor, bindVariable, boundTo, collectionsOf, createCollection, effectiveVariables, fieldInfo, findVariable, previewValue, resolveVariable, setFrameMode } from "../engine/variables";
import { MenuRow } from "./left-sidebar";
import { enabledLibraries, importLibraryVariable, libPrefix, useEnabledManifests } from "../engine/library";
import { askText } from "./ask-text";

// Variable binding on the Design panel: a small button opens the picker; a bound field shows the
// variable as a pill with a detach cross, the way design tools do.

const VAR_ICON = (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6z" strokeLinejoin="round" />
        <circle cx="6" cy="6" r="1.4" />
    </svg>
);

function groupsOf(doc: ReturnType<typeof editor.get>["doc"], collections: VariableCollection[], field: string, node: SceneNode | undefined, query: string) {
    const q = query.trim().toLowerCase();
    return collections
        .map((c) => ({
            collection: c,
            variables: effectiveVariables(doc, c).map((e) => e.variable).filter((v) => !v.hidden && allowedFor(v, field, node) && (!q || v.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))),
        }))
        .filter((g) => g.variables.length > 0)
        .map((g) => {
            // "colour/brand/primary" groups by its path.
            const byGroup = new Map<string, Variable[]>();
            for (const v of g.variables) {
                const parts = v.name.split("/");
                const group = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
                byGroup.set(group, [...(byGroup.get(group) ?? []), v]);
            }
            return { ...g, groups: [...byGroup.entries()], preview: (v: Variable) => previewValue(doc, v, g.collection.defaultModeId ?? g.collection.modes[0]?.id ?? "") };
        });
}

export function VariablePicker({ nodes, field, current, onPick, onClose }: { nodes: SceneNode[]; field: string; current: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
    const doc = useEditor((s) => s.doc);
    const collections = collectionsOf(doc);
    const [query, setQuery] = useState("");
    const groups = useMemo(() => groupsOf(doc, collections, field, nodes[0], query), [doc, collections, field, nodes, query]);
    // Enabled libraries' variables not yet used in this file: picking one brings its collection in.
    const manifests = useEnabledManifests(doc);
    const libraryGroups = useMemo(() => {
        const here = new Set(collections.map((c) => c.id));
        const remote = manifests.flatMap((m) => m.variables.filter((c) => !here.has(`${libPrefix(m.id)}${c.id}`)).map((c) => ({ ...c, libraryId: m.id, name: `${c.name} (${m.name})` })));
        return groupsOf(doc, remote, field, nodes[0], query);
    }, [doc, collections, manifests, field, nodes, query]);
    const total = groups.reduce((n, g) => n + g.variables.length, 0) + libraryGroups.reduce((n, g) => n + g.variables.length, 0);
    const pickLibrary = (libraryId: string, id: string) => void importLibraryVariable(libraryId, id).then((local) => local && onPick(local));
    const swatch = (v: Variable) => {
        if (v.type !== "color") return null;
        const r = resolveVariable(doc, v.id, nodes[0] ?? null);
        return <span className="size-4 shrink-0 rounded border border-black/20" style={{ background: typeof r?.value === "string" ? r.value : "#000", opacity: r?.opacity ?? 1 }} />;
    };
    return (
        <div className="w-64">
            <label className="flex h-8 items-center gap-2 border-b border-panel-border px-2 text-ink-muted">
                <SearchSm className="size-3.5" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search variables" aria-label="Search variables" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            <div className="max-h-72 overflow-y-auto p-1">
                {total === 0 && <EmptyPicker field={field} node={nodes[0]} collections={collections} onCreated={onPick} />}
                {groups.map((g) => (
                    <div key={g.collection.id} className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-ink-subtle">{g.collection.name}</div>
                        {g.groups.map(([group, vars]) => (
                            <div key={group}>
                                {group && <div className="px-2 py-0.5 text-[10px] text-ink-subtle">{group}</div>}
                                {vars.map((v) => (
                                    <button key={v.id} type="button" onClick={() => onPick(v.id)} className={`flex h-6 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover ${current === v.id ? "bg-panel-hover" : ""}`}>
                                        {swatch(v)}
                                        <span className="min-w-0 flex-1 truncate">{group ? v.name.slice(group.length + 1) : v.name}</span>
                                        <span className="max-w-24 truncate text-ink-subtle">{g.preview(v)}</span>
                                        {current === v.id && <span className="text-brand-500">✓</span>}
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            {libraryGroups.length > 0 && (
                <div className="max-h-48 overflow-y-auto border-t border-panel-border p-1">
                    {libraryGroups.map((g) => (
                        <div key={g.collection.id} className="mb-1">
                            <div className="px-2 py-1 text-[10px] font-semibold text-ink-subtle">{g.collection.name}</div>
                            {g.variables.slice(0, 200).map((v) => (
                                <button key={v.id} type="button" onClick={() => pickLibrary(g.collection.libraryId ?? "", v.id)} className="flex h-6 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                                    {v.type === "color" && <span className="size-4 shrink-0 rounded border border-black/20" style={{ background: String(g.preview(v)).startsWith("#") ? g.preview(v) : "#888" }} />}
                                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                                    <span className="max-w-24 truncate text-ink-subtle">{g.preview(v)}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            {current && (
                <button type="button" onClick={() => onPick(null)} className="flex h-8 w-full items-center gap-2 border-t border-panel-border px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <X className="size-3.5" /> Detach variable
                </button>
            )}
        </div>
    );
}

// The binding button for a field.
export function VarButton({ nodes, field, label }: { nodes: SceneNode[]; field: string; label?: string }) {
    const ids = nodes.map((n) => n.id);
    const current = boundTo(nodes, field);
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={label ?? `Apply variable to ${field}`} data-var-button={current ? "bound" : ""} className={`flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-panel-hover ${current ? "text-brand-500" : "text-ink-subtle hover:text-ink"}`}>
                {VAR_ICON}
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Variables">
                    {({ close }) => (
                        <VariablePicker
                            nodes={nodes}
                            field={field}
                            current={current}
                            onPick={(id) => {
                                bindVariable(ids, field, id);
                                close();
                            }}
                            onClose={close}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// A field that turns into a variable pill when bound; otherwise the field plus the binding button.
export function Bindable({ nodes, field, children, label }: { nodes: SceneNode[]; field: string; children: React.ReactNode; label?: string }) {
    const doc = useEditor((s) => s.doc);
    const current = boundTo(nodes, field);
    const found = current ? findVariable(doc, current) : null;
    const ids = nodes.map((n) => n.id);
    // Typing "=" in the field opens the variable picker.
    const wrap = useRef<HTMLDivElement>(null);
    const [typing, setTyping] = useState(false);
    if (found) {
        const r = resolveVariable(doc, found.variable.id, nodes[0] ?? null);
        return (
            <div className="flex h-6 min-w-0 flex-1 items-center gap-1">
                <AriaDialogTrigger>
                    <AriaButton
                        aria-label={`${found.collection.name} / ${found.variable.name}`}
                        // Delete or Backspace on the pill detaches the variable.
                        onKeyDown={(e) => {
                            if (e.key === "Backspace" || e.key === "Delete") bindVariable(ids, field, null);
                            else e.continuePropagation();
                        }}
                        className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-brand-500/40 bg-brand-100/60 px-1.5 text-left outline-none hover:border-brand-500">
                        {found.variable.type === "color" && <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: typeof r?.value === "string" ? r.value : "#000", opacity: r?.opacity ?? 1 }} />}
                        <span className="text-ink-subtle">{VAR_ICON}</span>
                        <span className="min-w-0 flex-1 truncate">{found.variable.name.split("/").pop()}</span>
                    </AriaButton>
                    <AriaPopover placement="left top" offset={8} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                        <AriaDialog className="outline-none" aria-label="Variables">
                            {({ close }) => (
                                <VariablePicker
                                    nodes={nodes}
                                    field={field}
                                    current={current}
                                    onPick={(id) => {
                                        bindVariable(ids, field, id);
                                        close();
                                    }}
                                    onClose={close}
                                />
                            )}
                        </AriaDialog>
                    </AriaPopover>
                </AriaDialogTrigger>
                <AriaButton aria-label={`Detach ${label ?? field}`} onPress={() => bindVariable(ids, field, null)} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-subtle outline-none hover:bg-panel-hover hover:text-ink">
                    <X className="size-3" />
                </AriaButton>
            </div>
        );
    }
    return (
        <div
            ref={wrap}
            className="group/bind relative flex min-w-0 flex-1 items-center"
            onKeyDownCapture={(e) => {
                if (e.key !== "=" || !(e.target instanceof HTMLInputElement)) return;
                e.preventDefault();
                e.stopPropagation();
                e.target.blur();
                setTyping(true);
            }}
        >
            <div className="min-w-0 flex-1">{children}</div>
            {/* The binding button sits over the field's right edge and shows on hover, so the field keeps its width. */}
            <span className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 group-hover/bind:opacity-100 focus-within:opacity-100 has-[[data-var-button=bound]]:opacity-100">
                <VarButton nodes={nodes} field={field} label={label ? `Apply variable to ${label}` : undefined} />
            </span>
            <AriaPopover triggerRef={wrap} isOpen={typing} onOpenChange={setTyping} placement="left top" offset={8} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Variables">
                    <VariablePicker
                        nodes={nodes}
                        field={field}
                        current={current}
                        onPick={(id) => {
                            bindVariable(ids, field, id);
                            setTyping(false);
                        }}
                        onClose={() => setTyping(false)}
                    />
                </AriaDialog>
            </AriaPopover>
        </div>
    );
}

// Appearance header: the variable-mode button. Each collection is a submenu with Auto and its
// modes; the button lights up when a frame sets a mode explicitly.
const MODE_ICON = (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M5 2.5 8 4.2v3.6L5 9.5 2 7.8V4.2z" strokeLinejoin="round" />
        <path d="M11 6.5 14 8.2v3.6L11 13.5 8 11.8V8.2z" strokeLinejoin="round" />
    </svg>
);

export function VariableModeButton({ frames }: { frames: SceneNode[] }) {
    const collections = useEditor((s) => collectionsOf(s.doc));
    const doc = useEditor((s) => s.doc);
    // What "Auto" resolves to: the nearest ancestor's mode, else the collection's default.
    const inheritedMode = (c: VariableCollection, frame: SceneNode | undefined) => {
        let p = frame?.parentId ? doc.nodes[frame.parentId] : undefined;
        while (p) {
            const m = p.variableModes?.[c.id];
            if (m) return c.modes.find((x) => x.id === m)?.name ?? "";
            p = p.parentId ? doc.nodes[p.parentId] : undefined;
        }
        return c.modes.find((x) => x.id === (c.defaultModeId ?? c.modes[0]?.id))?.name ?? "";
    };
    if (!collections.length) return null;
    const ids = frames.map((f) => f.id);
    // This file's collections first, then each library's.
    const libraries = enabledLibraries(doc);
    const groups = [{ title: "Created in this file", list: collections.filter((c) => !c.libraryId) }, ...libraries.map((l) => ({ title: l.name, list: collections.filter((c) => c.libraryId === l.id) }))].filter((g) => g.list.length);
    const explicit = collections.some((c) => frames.some((f) => f.variableModes?.[c.id]));
    const menu = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
    const act = (k: React.Key) => {
        const [collectionId, modeId] = String(k).split("::");
        if (collectionId && modeId) setFrameMode(ids, collectionId, modeId === "auto" ? null : modeId);
    };
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Apply variable mode" className={`flex size-6 items-center justify-center rounded outline-none hover:bg-panel-hover ${explicit ? "bg-brand-100/60 text-brand-500" : "text-ink-muted hover:text-ink"}`}>
                {MODE_ICON}
            </AriaButton>
            <AriaPopover placement="bottom end" className={menu}>
                <AriaMenu className="outline-none" onAction={act}>
                    {groups.map(({ title, list }) => (
                        <AriaSection key={title}>
                            <AriaHeader className="px-2 pt-1 pb-1.5 text-[11px] text-white/50">{title}</AriaHeader>
                        {list.map((c) => {
                            const chosen = frames[0]?.variableModes?.[c.id];
                            const name = chosen ? c.modes.find((m) => m.id === chosen)?.name : null;
                            return (
                                <AriaSubmenuTrigger key={c.id}>
                                    <MenuRow id={c.id} label={name ? `${c.name}: ${name}` : c.name} shortcut="›" />
                                    <AriaPopover offset={-4} className={menu}>
                                        <AriaMenu className="outline-none" onAction={act}>
                                            <MenuRow id={`${c.id}::auto`} label={`Auto (${inheritedMode(c, frames[0])})`} checked={!frames.some((f) => f.variableModes?.[c.id])} />
                                            {c.modes.map((m) => (
                                                <MenuRow key={m.id} id={`${c.id}::${m.id}`} label={m.id === (c.defaultModeId ?? c.modes[0]?.id) && c.modes.length > 1 ? `${m.name} (default)` : m.name} checked={frames.every((f) => f.variableModes?.[c.id] === m.id)} />
                                            ))}
                                        </AriaMenu>
                                    </AriaPopover>
                                </AriaSubmenuTrigger>
                            );
                        })}
                        </AriaSection>
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

const TYPE_NAMES: Record<VariableType, string> = { color: "colour", number: "number", string: "string", boolean: "boolean", easing: "easing", timing: "timing" };

// Nothing fits this field: say what it needs, and offer to make one.
function EmptyPicker({ field, node, collections, onCreated }: { field: string; node: SceneNode | undefined; collections: VariableCollection[]; onCreated: (id: string) => void }) {
    const info = fieldInfo(field, node);
    const sameType = collections.flatMap((c) => c.variables.filter((v) => v.type === info.type));
    const hidden = sameType.filter((v) => v.hidden).length;
    const scoped = sameType.length - hidden;
    const create = async () => {
        const name = await askText(`New ${TYPE_NAMES[info.type]} variable`, field.replace(/:\d+$/, ""));
        if (!name) return;
        const collection = collections[0] ?? createCollection("Collection 1");
        const current = node ? (nodeValue(node, field) as string | number | boolean | undefined) : undefined;
        // Easing and timing variables start from the transition's defaults.
        if (info.type === "easing" || info.type === "timing") {
            const v = addVariable(collection.id, info.type, name);
            if (v) onCreated(v.id);
            return;
        }
        const v = addVariable(collection.id, info.type, name, current);
        if (v) onCreated(v.id);
    };
    return (
        <div className="px-2 py-2 text-ink-muted">
            <p>
                {collections.length === 0
                    ? "No variables in this file yet."
                    : sameType.length === 0
                      ? `This field takes a ${TYPE_NAMES[info.type]} variable; the file has none.`
                      : scoped > 0
                        ? `${scoped} ${TYPE_NAMES[info.type]} variable${scoped === 1 ? " is" : "s are"} not scoped to "${SCOPE_LABELS[info.scope]}". Change the scopes in the Variables window.`
                        : `${hidden} ${TYPE_NAMES[info.type]} variable${hidden === 1 ? " is" : "s are"} hidden from pickers.`}
            </p>
            <div className="mt-2 flex flex-col gap-1">
                <button type="button" onClick={create} className="h-6 w-full rounded-md bg-brand-500 px-2 text-[11px] whitespace-nowrap text-white hover:bg-brand-600">
                    Create {TYPE_NAMES[info.type]} variable
                </button>
                <button type="button" onClick={() => editor.setPrefs({ leftPanel: "variables", leftPanelOpen: true })} className="h-6 w-full rounded-md px-2 text-[11px] whitespace-nowrap text-ink hover:bg-panel-hover">
                    Open variables
                </button>
            </div>
        </div>
    );
}

// The field's current literal, so a new variable starts from what the layer shows.
function nodeValue(node: SceneNode, field: string): unknown {
    if (field === "fill" || field.startsWith("fill:")) {
        const p = node.fills[field === "fill" ? 0 : Number(field.slice(5))];
        return p?.type === "solid" ? p.color : undefined;
    }
    if (field === "stroke" || field.startsWith("stroke:")) {
        const p = node.strokes[field === "stroke" ? 0 : Number(field.slice(7))];
        return p?.type === "solid" ? p.color : undefined;
    }
    if (field === "opacity") return Math.round(node.opacity * 100);
    if (field === "visible") return node.visible !== false;
    if (field === "text") return node.text;
    if (field === "gap") return node.layout?.gap;
    if (field === "padding") return node.layout?.padding[0];
    if (field.startsWith("padding:")) return node.layout?.padding[Number(field.slice(8))];
    if (field.startsWith("radius:")) return node.radii?.[Number(field.slice(7))] ?? node.radius;
    const direct = (node as unknown as Record<string, unknown>)[field];
    return typeof direct === "number" || typeof direct === "string" || typeof direct === "boolean" ? direct : undefined;
}

// Layers: a tag with the mode a frame (or page, section, instance) sets explicitly.
export function ModeTag({ node }: { node: SceneNode }) {
    const collections = useEditor((s) => collectionsOf(s.doc));
    const names = Object.entries(node.variableModes ?? {}).flatMap(([cid, mid]) => {
        const c = collections.find((x) => x.id === cid);
        const m = c?.modes.find((x) => x.id === mid);
        return c && m ? [{ c: c.name, m: m.name }] : [];
    });
    if (!names.length) return null;
    return (
        <span title={names.map((n) => `${n.c}: ${n.m}`).join("\n")} className="ml-1 max-w-20 shrink-0 truncate rounded bg-panel-hover px-1 text-[10px] text-ink-muted">
            {names.map((n) => n.m).join(", ")}
        </span>
    );
}

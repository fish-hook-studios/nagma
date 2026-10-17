import { ChevronDown, ChevronRight, Copy01, DotsHorizontal, Maximize01, Minimize01, Plus, SearchSm, Settings01, SwitchVertical01, Trash01, X } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { editor, useEditor } from "../engine/store";
import type { EasingValue, NagmaDocument, Variable, VariableCollection, VariableScope, VariableType, VariableValue } from "../engine/types";
import {
    SCOPES_BY_TYPE,
    SCOPE_LABELS,
    addMode,
    addVariable,
    collectionsOf,
    createCollection,
    deleteCollection,
    deleteVariable,
    deleteVariableGroup,
    duplicateMode,
    duplicateVariable,
    duplicateVariableGroup,
    effectiveVariables,
    extendCollection,
    extendedValue,
    findVariable,
    isAlias,
    isEasingValue,
    moveCollection,
    moveMode,
    parentOf,
    removeMode,
    renameMode,
    renameVariableGroup,
    resolveVariable,
    setDefaultMode,
    setOverride,
    setVariableValue,
    ungroupVariables,
    updateCollection,
    updateVariable,
    valueLabel,
} from "../engine/variables";
import { EASINGS, DEFAULT_BEZIER } from "../engine/easing-curves";
import type { Easing } from "../engine/types";
import { NumberField } from "./number-field";
import { ColorSwatch } from "./color-picker";
import { IconButton } from "./icon-button";
import { MenuRow } from "./left-sidebar";
import { Select } from "./select";
import { PointMenu } from "./point-menu";
import { askText } from "./ask-text";

// The Variables page, laid out like the reference's: collections down the left, the open collection's
// variables as a table with one column per mode, groups from "/" names, typed value cells, an edit
// popover per variable and "Create variable" at the bottom. It fills the editor edge to edge.

const TYPE_LABELS: Record<VariableType, string> = { color: "Color", number: "Number", string: "String", boolean: "Boolean", easing: "Easing", timing: "Timing" };
const field = "h-7 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
const menu = "rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

const ALL_TYPES: VariableType[] = ["color", "number", "string", "boolean", "easing", "timing"];

function TypeIcon({ type, color }: { type: VariableType; color?: string | null }) {
    if (type === "color") return <span className="size-4 shrink-0 rounded border border-black/20" style={{ background: color ?? "#000" }} />;
    return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-panel-hover text-[10px] font-semibold text-ink-muted">
            {type === "number" ? "#" : type === "string" ? "T" : type === "easing" ? "∿" : type === "timing" ? "◷" : "◐"}
        </span>
    );
}

export function VariablesView({ onClose }: { onClose: () => void }) {
    const all = useEditor((s) => collectionsOf(s.doc));
    // Collections from libraries are read in the library's own file, not here.
    const collections = useMemo(() => all.filter((c) => !c.libraryId), [all]);
    const name = useEditor((s) => s.doc.name);
    const [group, setGroup] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<VariableType | "all">("all");
    const [current, setCurrent] = useState<string | null>(null);
    const [sortAZ, setSortAZ] = useState(false);
    const [query, setQuery] = useState("");
    const [renaming, setRenaming] = useState<string | null>(null);
    const [full, setFull] = useState(false);
    const collection = collections.find((c) => c.id === current) ?? collections[0] ?? null;
    const sorted = sortAZ ? [...collections].sort((a, b) => a.name.localeCompare(b.name)) : collections;

    const create = () => {
        const c = createCollection(`Collection ${collections.length + 1}`);
        setCurrent(c.id);
        setRenaming(c.id);
    };

    return (
        // A floating window over the canvas, like the reference's Local variables modal.
        <div
            role="dialog"
            aria-label="Local variables"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !e.defaultPrevented) onClose();
            }}
            className={`absolute z-30 flex overflow-hidden border border-panel-border bg-canvas text-[11px] text-ink shadow-2xl ${full ? "inset-0" : "inset-4 rounded-xl"}`}>
            <aside className="flex w-64 shrink-0 flex-col border-r border-panel-border bg-panel">
                <div className="flex h-10 items-center gap-2 px-3">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{name}</span>
                    <IconButton size="sm" icon={full ? Minimize01 : Maximize01} label={full ? "Minimize" : "Expand to full window"} onPress={() => setFull(!full)} />
                    <IconButton size="sm" icon={X} label="Close variables" onPress={onClose} />
                </div>
                <div className="flex h-8 items-center justify-between pr-1 pl-3">
                    <span className="font-semibold">Collections</span>
                    <div className="flex items-center">
                        <IconButton size="sm" icon={SwitchVertical01} label={sortAZ ? "Sort by created" : "Sort A to Z"} active={sortAZ} onPress={() => setSortAZ(!sortAZ)} />
                        <IconButton size="sm" icon={Plus} label="New collection" onPress={create} />
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                    {sorted.map((c) => (
                        <CollectionRow key={c.id} collection={c} active={collection?.id === c.id} renaming={renaming === c.id} onSelect={() => {
                                setCurrent(c.id);
                                setGroup(null);
                            }} onRename={() => setRenaming(c.id)} onDoneRenaming={() => setRenaming(null)} />
                    ))}
                    {collections.length === 0 && <p className="px-2 py-2 text-ink-muted">No collections yet.</p>}
                    {collection && <GroupTree collection={collection} group={group} onGroup={setGroup} />}
                </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-panel-border px-4">
                    <span className="text-[12px] font-semibold">Variables</span>
                    {collection && (
                        <>
                            <span className="text-ink-subtle">/</span>
                            <span className="text-[12px] font-semibold">{collection.name}</span>
                            <label className="ml-2 flex h-7 w-64 min-w-0 items-center gap-2 rounded-md border border-panel-border px-2 text-ink-muted focus-within:border-brand-500">
                                <SearchSm className="size-3.5" />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search variables" aria-label="Search variables" onKeyDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
                            </label>
                            <Select aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as VariableType | "all")} className="h-7 rounded-md border border-panel-border bg-transparent px-1.5 text-ink outline-none">
                                <option value="all">All types</option>
                                {ALL_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                        {TYPE_LABELS[t]}
                                    </option>
                                ))}
                            </Select>
                        </>
                    )}
                </div>
                {!collection ? (
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                        <h2 className="text-[16px] font-semibold">No variables created in this file</h2>
                        <p className="mt-2 max-w-sm text-[12px] text-ink-muted">Save colours, numbers, text and states to reuse them in styles, prototypes and across modes.</p>
                        <AriaButton onPress={create} className="mt-4 flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:bg-brand-600">
                            <Plus className="size-3.5" /> Create collection
                        </AriaButton>
                    </div>
                ) : (
                    <CollectionTable key={collection.id} collection={collection} query={query} group={group} typeFilter={typeFilter} />
                )}
            </main>
        </div>
    );
}

function CollectionRow({ collection, active, renaming, onSelect, onRename, onDoneRenaming }: { collection: VariableCollection; active: boolean; renaming: boolean; onSelect: () => void; onRename: () => void; onDoneRenaming: () => void }) {
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (renaming) input.current?.select();
    }, [renaming]);
    const commit = (value: string) => {
        const next = value.trim();
        if (next && next !== collection.name) updateCollection(collection.id, (c) => ({ ...c, name: next }));
        onDoneRenaming();
    };
    return (
        // Drag a collection onto another to put it before that one.
        <div
            draggable={!renaming}
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-nagma-collection", collection.id);
            }}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-nagma-collection")) e.preventDefault();
            }}
            onDrop={(e) => {
                const id = e.dataTransfer.getData("application/x-nagma-collection");
                if (!id) return;
                e.preventDefault();
                moveCollection(id, collection.id);
            }}
            className={`group flex h-8 items-center gap-1 rounded-md pr-1 pl-2 ${active ? "bg-panel-hover" : "hover:bg-panel-hover"}`}
        >
            {renaming ? (
                <input
                    ref={input}
                    defaultValue={collection.name}
                    aria-label="Collection name"
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commit(e.currentTarget.value);
                        if (e.key === "Escape") onDoneRenaming();
                    }}
                    onBlur={(e) => commit(e.target.value)}
                    className="h-6 min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 text-ink outline-none"
                />
            ) : (
                <button type="button" onClick={onSelect} onDoubleClick={onRename} className="min-w-0 flex-1 truncate text-left" title={collection.extends ? "Extends another collection" : undefined}>
                    {collection.name}
                    {collection.extends && <span className="ml-1 text-ink-subtle">↳</span>}
                </button>
            )}
            <span className="text-ink-subtle">{collection.variables.length}</span>
            <AriaMenuTrigger>
                <AriaButton aria-label="Collection options" className="flex size-6 items-center justify-center rounded text-ink-subtle opacity-0 outline-none group-hover:opacity-100 hover:bg-panel-hover hover:text-ink">
                    <DotsHorizontal className="size-3.5" />
                </AriaButton>
                <AriaPopover placement="bottom end" className={`w-44 ${menu}`}>
                    <AriaMenu
                        className="outline-none"
                        onAction={(k) => {
                            if (String(k) === "rename") onRename();
                            if (String(k) === "extend") extendCollection(collection.id);
                            if (String(k) === "delete" && window.confirm(`Delete "${collection.name}" and its ${collection.variables.length} variables?`)) deleteCollection(collection.id);
                        }}
                    >
                        <MenuRow id="rename" label="Rename collection" />
                        <MenuRow id="extend" label="Extend collection" />
                        <MenuRow id="delete" label="Delete collection" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

function CollectionTable({ collection, query, group, typeFilter }: { collection: VariableCollection; query: string; group: string | null; typeFilter: VariableType | "all" }) {
    const doc = useEditor((s) => s.doc);
    const [closed, setClosed] = useState<Set<string>>(new Set());
    const [editingName, setEditingName] = useState<string | null>(null);
    const q = query.trim().toLowerCase();
    const parent = parentOf(doc, collection);
    // Groups come from the "a/b/name" convention, in creation order. An extended collection lists
    // what it inherits first, under the parent's name.
    const groups = useMemo(() => {
        const map = new Map<string, { v: Variable; inherited: boolean }[]>();
        for (const { variable: v, inherited } of effectiveVariables(doc, collection)) {
            if (q && !v.name.toLowerCase().includes(q)) continue;
            if (typeFilter !== "all" && v.type !== typeFilter) continue;
            if (group && !v.name.startsWith(`${group}/`)) continue;
            const parts = v.name.split("/");
            const g = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
            const key = inherited ? `\u0000${g}` : g;
            map.set(key, [...(map.get(key) ?? []), { v, inherited }]);
        }
        return [...map.entries()];
    }, [doc, collection, q, group, typeFilter]);
    const toggle = (key: string) =>
        setClosed((c) => {
            const n = new Set(c);
            if (n.has(key)) n.delete(key);
            else n.add(key);
            return n;
        });
    const createVariable = (type: VariableType) => {
        const count = collection.variables.filter((v) => v.type === type).length + 1;
        const v = addVariable(collection.id, type, `${TYPE_LABELS[type]} ${count}`);
        if (v) setEditingName(v.id);
    };
    const cols = collection.modes.length + 2;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-separate border-spacing-0 text-left">
                    <thead className="sticky top-0 z-10 bg-canvas">
                        <tr className="text-ink-muted">
                            <th className="w-72 border-b border-panel-border py-2 pl-4 font-medium">Name</th>
                            {collection.modes.map((m) => (
                                <th key={m.id} className="min-w-44 border-b border-panel-border py-2 pl-2 font-medium">
                                    <ModeHeader collection={collection} mode={m} />
                                </th>
                            ))}
                            <th className="w-20 border-b border-panel-border py-2 pr-3 text-right">
                                <IconButton size="sm" icon={Plus} label="New variable mode" onPress={() => addMode(collection.id, `Mode ${collection.modes.length + 1}`)} />
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(([key, vars]) => {
                            const inherited = key.startsWith("\u0000");
                            const group = inherited ? key.slice(1) : key;
                            const label = inherited ? (group ? `${parent?.name ?? "Inherited"} / ${group}` : `Inherited from ${parent?.name ?? "parent"}`) : group;
                            return <GroupRows key={key} group={group} label={label} vars={vars} open={!closed.has(key)} onToggle={() => toggle(key)} collection={collection} doc={doc} cols={cols} editingName={editingName} onEditName={setEditingName} />;
                        })}
                        {collection.variables.length === 0 && !parent && (
                            <tr>
                                <td colSpan={cols} className="px-4 py-6 text-ink-muted">
                                    No variables yet. Use "Create variable" below. Name a variable "group/name" to put it in a group.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div className="flex h-11 shrink-0 items-center justify-between border-t border-panel-border px-3">
                <AriaMenuTrigger>
                    <AriaButton className="flex h-7 items-center gap-1.5 rounded-md border border-panel-border px-2 text-ink outline-none hover:bg-panel-hover">
                        <Plus className="size-3.5" /> Create variable <ChevronDown className="size-3 text-ink-subtle" />
                    </AriaButton>
                    <AriaPopover placement="top start" className={`w-40 ${menu}`}>
                        <AriaMenu className="outline-none" onAction={(k) => createVariable(String(k) as VariableType)}>
                            {ALL_TYPES.map((t) => (
                                <MenuRow key={t} id={t} label={TYPE_LABELS[t]} />
                            ))}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
                <span className="text-ink-muted">
                    {collection.variables.length} variable{collection.variables.length === 1 ? "" : "s"}{parent ? ` (+${effectiveVariables(doc, collection).filter((v) => v.inherited).length} inherited)` : ""} · {collection.modes.length} mode{collection.modes.length === 1 ? "" : "s"}
                </span>
            </div>
        </div>
    );
}

function ModeHeader({ collection, mode }: { collection: VariableCollection; mode: { id: string; name: string } }) {
    const [renaming, setRenaming] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (renaming) input.current?.select();
    }, [renaming]);
    const isDefault = (collection.defaultModeId ?? collection.modes[0]?.id) === mode.id;
    const index = collection.modes.findIndex((m) => m.id === mode.id);
    const commit = (value: string) => {
        if (value.trim() && value.trim() !== mode.name) renameMode(collection.id, mode.id, value.trim());
        setRenaming(false);
    };
    const exportMode = () => {
        const out = Object.fromEntries(collection.variables.map((v) => [v.name, isAlias(v.values[mode.id]) ? (findVariable(editor.get().doc, (v.values[mode.id] as { alias: string }).alias)?.variable.name ?? null) : v.values[mode.id]]));
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${collection.name} - ${mode.name}.json`;
        a.click();
    };
    const importMode = () => {
        const inputEl = document.createElement("input");
        inputEl.type = "file";
        inputEl.accept = ".json,application/json";
        inputEl.onchange = async () => {
            const file = inputEl.files?.[0];
            if (!file) return;
            try {
                const json = JSON.parse(await file.text()) as Record<string, unknown>;
                let count = 0;
                const walk = (obj: Record<string, unknown>, prefix: string) => {
                    for (const [k, raw] of Object.entries(obj)) {
                        const path = prefix ? `${prefix}/${k}` : k;
                        const value = raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>) ? (raw as Record<string, unknown>).value : raw;
                        if (value && typeof value === "object") {
                            walk(value as Record<string, unknown>, path);
                            continue;
                        }
                        const type: VariableType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : /^#[0-9a-f]{6}$/i.test(String(value)) ? "color" : "string";
                        const cast = type === "number" ? Number(value) : type === "boolean" ? Boolean(value) : String(value);
                        const existing = editor.get().doc.variables?.find((c) => c.id === collection.id)?.variables.find((v) => v.name === path && v.type === type);
                        if (existing) setVariableValue(collection.id, existing.id, mode.id, cast);
                        else {
                            const v = addVariable(collection.id, type, path, cast);
                            if (v) setVariableValue(collection.id, v.id, mode.id, cast);
                        }
                        count++;
                    }
                };
                walk(json, "");
                editor.notify(`Imported ${count} value${count === 1 ? "" : "s"} into ${mode.name}.`);
            } catch (error) {
                editor.notify(`Couldn't import: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        inputEl.click();
    };
    return (
        <div className="group flex items-center gap-1">
            {renaming ? (
                <input ref={input} defaultValue={mode.name} aria-label="Mode name" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(e.currentTarget.value); if (e.key === "Escape") setRenaming(false); }} onBlur={(e) => commit(e.target.value)} className="h-6 min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 font-medium text-ink outline-none" />
            ) : (
                <button type="button" onDoubleClick={() => setRenaming(true)} className="min-w-0 flex-1 truncate text-left font-medium hover:text-ink" title="Double-click to rename">
                    {mode.name}
                    {isDefault && collection.modes.length > 1 && <span className="ml-1 text-ink-subtle">(default)</span>}
                </button>
            )}
            <AriaMenuTrigger>
                <AriaButton aria-label={`${mode.name} options`} className="flex size-6 items-center justify-center rounded text-ink-subtle opacity-0 outline-none group-hover:opacity-100 hover:bg-panel-hover hover:text-ink data-[pressed]:opacity-100">
                    <DotsHorizontal className="size-3.5" />
                </AriaButton>
                <AriaPopover placement="bottom end" className={`w-48 ${menu}`}>
                    <AriaMenu
                        className="outline-none"
                        disabledKeys={[...(index === 0 ? ["left"] : []), ...(index === collection.modes.length - 1 ? ["right"] : []), ...(collection.modes.length === 1 ? ["remove"] : [])]}
                        onAction={(k) => {
                            const key = String(k);
                            if (key === "rename") setRenaming(true);
                            if (key === "duplicate") duplicateMode(collection.id, mode.id);
                            if (key === "default") setDefaultMode(collection.id, mode.id);
                            if (key === "left") moveMode(collection.id, mode.id, -1);
                            if (key === "right") moveMode(collection.id, mode.id, 1);
                            if (key === "import") importMode();
                            if (key === "export") exportMode();
                            if (key === "remove" && window.confirm(`Delete the mode "${mode.name}"?`)) removeMode(collection.id, mode.id);
                        }}
                    >
                        <MenuRow id="rename" label="Rename mode" />
                        <MenuRow id="duplicate" label="Duplicate mode" />
                        <MenuRow id="default" label="Set as default mode" checked={isDefault} />
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="left" label="Move column left" />
                        <MenuRow id="right" label="Move column right" />
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="import" label="Import variables…" />
                        <MenuRow id="export" label="Export mode as JSON" />
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="remove" label="Delete mode" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

function GroupRows({ group, label, vars, open, onToggle, collection, doc, cols, editingName, onEditName }: { group: string; label: string; vars: { v: Variable; inherited: boolean }[]; open: boolean; onToggle: () => void; collection: VariableCollection; doc: NagmaDocument; cols: number; editingName: string | null; onEditName: (id: string | null) => void }) {
    const defaultMode = collection.defaultModeId ?? collection.modes[0]?.id ?? "";
    return (
        <>
            {label && (
                <tr>
                    <td colSpan={cols} className="py-1 pl-3">
                        <button type="button" onClick={onToggle} className="flex h-6 items-center gap-1 rounded px-1 text-ink-muted hover:bg-panel-hover hover:text-ink">
                            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            <span className="font-medium">{label}</span>
                            <span className="text-ink-subtle">{vars.length}</span>
                        </button>
                    </td>
                </tr>
            )}
            {open &&
                vars.map(({ v, inherited }) => (
                    <VariableRow key={v.id} variable={v} inherited={inherited} group={group} collection={collection} doc={doc} defaultMode={defaultMode} editing={editingName === v.id} onEdit={(on) => onEditName(on ? v.id : null)} />
                ))}
        </>
    );
}

function VariableRow({ variable, inherited, group, collection, doc, defaultMode, editing, onEdit }: { variable: Variable; inherited: boolean; group: string; collection: VariableCollection; doc: NagmaDocument; defaultMode: string; editing: boolean; onEdit: (on: boolean) => void }) {
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editing) input.current?.select();
    }, [editing]);
    const r = variable.type === "color" ? resolveVariable(doc, variable.id, null, { modes: { [collection.id]: defaultMode } }) : null;
    const shortName = group ? variable.name.slice(group.length + 1) : variable.name;
    const commit = (value: string) => {
        const next = value.trim();
        const full = group && !next.includes("/") ? `${group}/${next}` : next;
        if (next && full !== variable.name) updateVariable(collection.id, variable.id, { name: full });
        onEdit(false);
    };
    return (
        // ⇧Enter on a highlighted row duplicates the variable.
        <tr
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget || inherited) return;
                if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    duplicateVariable(collection.id, variable.id);
                } else if (e.key === "Enter") onEdit(true);
            }}
            className="group outline-none hover:bg-panel-hover focus-visible:bg-panel-hover"
        >
            <td className="py-0.5 pl-4" style={{ paddingLeft: group ? 28 : 16 }}>
                <div className="flex h-8 items-center gap-2">
                    <TypeIcon type={variable.type} color={typeof r?.value === "string" ? r.value : null} />
                    {editing && !inherited ? (
                        <input ref={input} defaultValue={shortName} aria-label="Variable name" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(e.currentTarget.value); if (e.key === "Escape") onEdit(false); }} onBlur={(e) => commit(e.target.value)} className="h-6 min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 text-ink outline-none" />
                    ) : (
                        <button type="button" onDoubleClick={() => !inherited && onEdit(true)} className={`min-w-0 flex-1 truncate text-left ${inherited ? "text-ink-muted" : ""}`} title={inherited ? "Inherited: rename it in the collection it comes from" : "Double-click to rename"}>
                            {shortName}
                        </button>
                    )}
                    {variable.hidden && <span className="text-ink-subtle" title="Hidden from publishing">◌</span>}
                </div>
            </td>
            {collection.modes.map((m) => (
                <td key={m.id} className="py-0.5 pl-2">
                    {inherited ? <OverrideCell collection={collection} variable={variable} mode={m.id} doc={doc} /> : <ValueCell collection={collection} variable={variable} mode={m.id} doc={doc} />}
                </td>
            ))}
            <td className="py-0.5 pr-2 text-right">
                {!inherited && <span className="flex items-center justify-end opacity-0 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
                    <VariableSettings collection={collection} variable={variable} />
                    <AriaMenuTrigger>
                        <AriaButton aria-label="Variable options" className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <DotsHorizontal className="size-3.5" />
                        </AriaButton>
                        <AriaPopover placement="bottom end" className={`w-44 ${menu}`}>
                            <AriaMenu
                                className="outline-none"
                                onAction={(k) => {
                                    if (String(k) === "rename") onEdit(true);
                                    if (String(k) === "duplicate") duplicateVariable(collection.id, variable.id);
                                    if (String(k) === "delete") deleteVariable(collection.id, variable.id);
                                }}
                            >
                                <MenuRow id="rename" label="Rename variable" />
                                <MenuRow id="duplicate" label="Duplicate variable" icon={Copy01} />
                                <AriaSeparator className="my-1 h-px bg-white/10" />
                                <MenuRow id="delete" label="Delete variable" icon={Trash01} />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                </span>}
            </td>
        </tr>
    );
}

// An inherited variable's cell in an extended collection: the parent's value (greyed) until an
// override is typed; a cross puts the inherited value back.
function OverrideCell({ collection, variable, mode, doc }: { collection: VariableCollection; variable: Variable; mode: string; doc: NagmaDocument }) {
    const own = collection.overrides?.[variable.id]?.[mode];
    const shown = extendedValue(doc, collection, variable, mode);
    const set = (v: VariableValue) => setOverride(collection.id, variable.id, mode, v);
    const text = shown === undefined ? "" : isAlias(shown) ? (findVariable(doc, shown.alias)?.variable.name ?? "") : valueLabel(shown);
    return (
        <div className="flex h-8 items-center gap-1">
            {variable.type === "color" && <ColorSwatch size={5} color={typeof shown === "string" ? shown : "#000000"} label="Override colour" placement="bottom start" onChange={(color) => set(color.toUpperCase())} />}
            {variable.type === "boolean" ? (
                <button type="button" role="switch" aria-checked={Boolean(shown)} aria-label="Override value" onClick={() => set(!shown)} className={`flex items-center gap-2 ${own === undefined ? "opacity-60" : ""}`}>
                    <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${shown ? "bg-brand-500" : "bg-panel-border"}`}>
                        <span className={`size-3 rounded-full bg-white transition-transform ${shown ? "translate-x-3" : ""}`} />
                    </span>
                    <span className="text-ink-muted">{shown ? "True" : "False"}</span>
                </button>
            ) : variable.type === "easing" ? (
                <EasingField value={isEasingValue(shown) ? shown : { easing: "ease-in-out" }} onChange={set} muted={own === undefined} />
            ) : (
                <input
                    key={`${text}|${own === undefined}`}
                    aria-label="Override value"
                    defaultValue={text}
                    placeholder="Inherited"
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
                    onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (!raw) return setOverride(collection.id, variable.id, mode, undefined);
                        if (variable.type === "color") return /^#?[0-9a-f]{6}$/i.test(raw) ? set(`#${raw.replace("#", "").toUpperCase()}`) : undefined;
                        if (variable.type === "number" || variable.type === "timing") return set(Number(raw.replace(/ms$/i, "")) || 0);
                        set(raw);
                    }}
                    className={`${field} w-full ${own === undefined ? "text-ink-muted" : ""}`}
                    title={own === undefined ? "Inherited value. Type to override it." : "Overridden here"}
                />
            )}
            {own !== undefined && <IconButton size="sm" icon={X} label="Use the inherited value" onPress={() => setOverride(collection.id, variable.id, mode, undefined)} />}
        </div>
    );
}

// An easing value: the curve by name, and the control points for a custom bezier.
function EasingField({ value, onChange, muted }: { value: EasingValue; onChange: (v: EasingValue) => void; muted?: boolean }) {
    const bezier = value.bezier ?? DEFAULT_BEZIER;
    return (
        <div className={`flex min-w-0 flex-1 flex-col gap-1 ${muted ? "opacity-70" : ""}`}>
            <Select aria-label="Easing" value={value.easing} onChange={(e) => onChange({ ...value, easing: e.target.value as Easing, ...(e.target.value === "custom-bezier" ? { bezier } : {}) })} className={`${field} w-full`}>
                {EASINGS.map(([id, label]) => (
                    <option key={id} value={id}>
                        {label}
                    </option>
                ))}
            </Select>
            {value.easing === "custom-bezier" && (
                <div className="grid grid-cols-4 gap-1">
                    {(["x1", "y1", "x2", "y2"] as const).map((k, i) => (
                        <NumberField key={k} label="" title={k} step={0.05} value={Math.round((bezier[i] ?? 0) * 100) / 100} onCommit={(v) => { const next = [...bezier] as [number, number, number, number]; next[i] = i % 2 === 0 ? Math.min(1, Math.max(0, v)) : v; onChange({ ...value, bezier: next }); }} />
                    ))}
                </div>
            )}
        </div>
    );
}

// A value cell: a typed editor, or an alias pill (with opacity for colours) pointing at another variable.
function ValueCell({ collection, variable, mode, doc }: { collection: VariableCollection; variable: Variable; mode: string; doc: NagmaDocument }) {
    const value = variable.values[mode];
    const set = (v: VariableValue) => setVariableValue(collection.id, variable.id, mode, v);
    const candidates = collectionsOf(doc).flatMap((c) => c.variables.filter((v) => v.type === variable.type && v.id !== variable.id).map((v) => ({ v, c })));
    const aliasPicker = (
        <AriaDialogTrigger>
            <AriaButton aria-label="Create alias" className="flex size-6 shrink-0 items-center justify-center rounded text-ink-subtle opacity-0 outline-none group-hover:opacity-100 hover:bg-panel-hover hover:text-ink data-[pressed]:opacity-100">
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6z" strokeLinejoin="round" />
                    <circle cx="6" cy="6" r="1.4" />
                </svg>
            </AriaButton>
            <AriaPopover placement="bottom start" className="w-64 rounded-lg border border-panel-border bg-panel-raised p-1 text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Create alias">
                    {({ close }) => (
                        <div className="max-h-64 overflow-y-auto">
                            <div className="px-2 py-1.5 text-ink-muted">Alias to another {TYPE_LABELS[variable.type].toLowerCase()} variable</div>
                            {candidates.length === 0 && <div className="px-2 py-2 text-ink-muted">Nothing of this type to alias yet.</div>}
                            {candidates.map(({ v, c }) => {
                                const rv = v.type === "color" ? resolveVariable(doc, v.id, null, { modes: { [c.id]: c.defaultModeId ?? c.modes[0]?.id ?? "" } }) : null;
                                return (
                                    <button key={v.id} type="button" onClick={() => { set({ alias: v.id, opacity: variable.type === "color" ? 1 : undefined }); close(); }} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover">
                                        <TypeIcon type={v.type} color={typeof rv?.value === "string" ? rv.value : null} />
                                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                                        <span className="text-ink-subtle">{c.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
    if (isAlias(value)) {
        const target = findVariable(doc, value.alias);
        const r = resolveVariable(doc, variable.id, null, { modes: { [collection.id]: mode } });
        return (
            <div className="flex h-8 items-center gap-1">
                <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-brand-500/40 bg-brand-100/60 px-1.5">
                    <TypeIcon type={variable.type} color={typeof r?.value === "string" ? r.value : null} />
                    <span className="min-w-0 flex-1 truncate">{target?.variable.name ?? "Missing variable"}</span>
                </span>
                {variable.type === "color" && (
                    <input type="number" min={0} max={100} aria-label="Alias opacity" defaultValue={Math.round((value.opacity ?? 1) * 100)} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => set({ alias: value.alias, opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })} className="h-7 w-12 rounded-md border border-transparent bg-transparent px-1 text-right outline-none hover:border-panel-border focus:border-brand-500" title="Opacity %" />
                )}
                <IconButton size="sm" icon={X} label="Detach alias" onPress={() => set(r ? r.value : variable.type === "number" || variable.type === "timing" ? 0 : variable.type === "boolean" ? false : variable.type === "color" ? "#000000" : variable.type === "easing" ? { easing: "ease-in-out" } : "")} />
            </div>
        );
    }
    let editorEl: React.ReactNode;
    if (variable.type === "color") {
        const hex = String(value ?? "#000000");
        editorEl = (
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <ColorSwatch size={5} color={hex} label="Colour" placement="bottom start" onChange={(color) => set(color.toUpperCase())} />
                <input key={hex} defaultValue={hex.replace("#", "")} aria-label="Hex" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) && set(`#${e.target.value.trim().replace("#", "").toUpperCase()}`)} className={`${field} w-full uppercase`} />
            </div>
        );
    } else if (variable.type === "boolean") {
        const on = Boolean(value);
        editorEl = (
            <button type="button" role="switch" aria-checked={on} aria-label="Value" onClick={() => set(!on)} className="flex items-center gap-2">
                <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${on ? "bg-brand-500" : "bg-panel-border"}`}>
                    <span className={`size-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
                </span>
                <span className="text-ink-muted">{on ? "True" : "False"}</span>
            </button>
        );
    } else if (variable.type === "number") editorEl = <input type="number" key={String(value)} aria-label="Value" defaultValue={Number(value ?? 0)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => set(Number(e.target.value) || 0)} className={`${field} w-full`} />;
    else if (variable.type === "timing") editorEl = <div className="w-full"><NumberField label="" title="Duration (ms)" unit="ms" min={0} step={50} value={typeof value === "number" ? value : 0} onCommit={(v) => set(Math.max(0, Math.round(v)))} /></div>;
    else if (variable.type === "easing") editorEl = <EasingField value={isEasingValue(value) ? value : { easing: "ease-in-out" }} onChange={set} />;
    else editorEl = <input key={String(value)} aria-label="Value" defaultValue={String(value ?? "")} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => set(e.target.value)} className={`${field} w-full`} />;
    return (
        <div className="flex h-8 items-center gap-1">
            {editorEl}
            {aliasPicker}
        </div>
    );
}

// Per-variable settings, like the reference's edit popover: name, description, code syntax, scoping, publishing.
function VariableSettings({ collection, variable }: { collection: VariableCollection; variable: Variable }) {
    const scopes = variable.scopes ?? ["all"];
    const options = SCOPES_BY_TYPE[variable.type];
    const setScopes = (next: VariableScope[]) => updateVariable(collection.id, variable.id, { scopes: next.length ? next : ["all"] });
    const toggleScope = (s: VariableScope) => {
        if (s === "all") return setScopes(["all"]);
        const without = scopes.filter((x) => x !== "all" && x !== s);
        setScopes(scopes.includes(s) ? without : [...without, s]);
    };
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Edit variable" className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Settings01 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" className="w-72 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-3 outline-none" aria-label="Edit variable">
                    <div className="text-[12px] font-semibold">Edit variable</div>
                    <label className="block">
                        <span className="text-ink-muted">Name</span>
                        <input defaultValue={variable.name} aria-label="Variable name" onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== variable.name && updateVariable(collection.id, variable.id, { name: e.target.value.trim() })} className="mt-1 h-7 w-full rounded-md border border-panel-border bg-field px-2 text-ink outline-none focus:border-brand-500" />
                    </label>
                    <label className="block">
                        <span className="text-ink-muted">Description</span>
                        <textarea defaultValue={variable.description ?? ""} rows={2} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => updateVariable(collection.id, variable.id, { description: e.target.value })} className="mt-1 w-full resize-none rounded-md border border-panel-border bg-field px-2 py-1 text-ink outline-none focus:border-brand-500" />
                    </label>
                    <div>
                        <div className="mb-1 text-ink-muted">Code syntax</div>
                        {(["web", "ios", "android"] as const).map((platform) => (
                            <label key={platform} className="mb-1 flex items-center gap-2">
                                <span className="w-14 text-ink-subtle">{platform === "web" ? "Web" : platform === "ios" ? "iOS" : "Android"}</span>
                                <input defaultValue={variable.codeSyntax?.[platform] ?? ""} placeholder={platform === "web" ? `--${variable.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : ""} aria-label={`${platform} code syntax`} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => updateVariable(collection.id, variable.id, { codeSyntax: { ...(variable.codeSyntax ?? {}), [platform]: e.target.value.trim() || undefined } })} className="h-6 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-1.5 font-mono text-[10px] text-ink outline-none focus:border-brand-500" />
                            </label>
                        ))}
                    </div>
                    {options.length > 0 && (
                        <div>
                            <div className="mb-1 text-ink-muted">Scoping</div>
                            <label className="flex h-6 items-center gap-2">
                                <input type="checkbox" checked={scopes.includes("all")} onChange={() => toggleScope("all")} className="accent-brand-500" /> Show in all supported properties
                            </label>
                            {options.map((s) => (
                                <label key={s} className="flex h-6 items-center gap-2 pl-4">
                                    <input type="checkbox" checked={scopes.includes("all") || scopes.includes(s)} disabled={scopes.includes("all")} onChange={() => toggleScope(s)} className="accent-brand-500" /> {SCOPE_LABELS[s]}
                                </label>
                            ))}
                        </div>
                    )}
                    <label className="flex h-6 items-center gap-2">
                        <input type="checkbox" checked={Boolean(variable.hidden)} onChange={(e) => updateVariable(collection.id, variable.id, { hidden: e.target.checked })} className="accent-brand-500" /> Hide from publishing
                    </label>
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// The selected collection's groups as a tree ("a/b/name" makes groups a and a/b); picking one shows
// only its variables, as in the reference's Variables sidebar.
function GroupTree({ collection, group, onGroup }: { collection: VariableCollection; group: string | null; onGroup: (g: string | null) => void }) {
    const paths = useMemo(() => {
        const set = new Set<string>();
        for (const v of collection.variables) {
            const parts = v.name.split("/").slice(0, -1);
            for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [collection]);
    const [menu, setMenu] = useState<{ at: { x: number; y: number }; group: string } | null>(null);
    const count = (p: string | null) => collection.variables.filter((v) => !p || v.name.startsWith(`${p}/`)).length;
    const row = (p: string | null, label: string, depth: number) => (
        <button
            key={p ?? "__all"}
            type="button"
            onClick={() => onGroup(p)}
            onContextMenu={(e) => {
                if (p === null) return;
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, group: p });
            }}
            className={`flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left ${group === p ? "bg-panel-hover font-medium" : "hover:bg-panel-hover"}`} style={{ paddingLeft: 8 + depth * 12 }}>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-ink-subtle">{count(p)}</span>
        </button>
    );
    if (!paths.length) return null;
    return (
        <div className="mt-3 border-t border-panel-border pt-2">
            {row(null, "All variables", 0)}
            {paths.map((p) => row(p, p.split("/").pop() ?? p, p.split("/").length))}
            {menu && (
                <PointMenu
                    at={menu.at}
                    label="Group actions"
                    onClose={() => setMenu(null)}
                    items={[
                        { id: "rename", label: "Rename group", run: () => void askText("Rename group", menu.group.split("/").pop() ?? menu.group, { confirm: "Rename" }).then((name) => name && renameVariableGroup(collection.id, menu.group, name.trim())) },
                        { id: "ungroup", label: "Ungroup", run: () => ungroupVariables(collection.id, menu.group) },
                        { id: "duplicate", label: "Duplicate group", run: () => duplicateVariableGroup(collection.id, menu.group) },
                        "separator",
                        {
                            id: "delete",
                            label: "Delete group",
                            run: () => {
                                if (group === menu.group || group?.startsWith(`${menu.group}/`)) onGroup(null);
                                deleteVariableGroup(collection.id, menu.group);
                            },
                        },
                    ]}
                />
            )}
        </div>
    );
}

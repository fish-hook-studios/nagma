import { ChevronDown, ChevronRight, Grid01, List, Plus, SearchSm, XClose } from "@untitledui/icons";
import { EFFECT_LABELS, defaultEffect } from "../engine/effects";
import { useMemo, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay, Popover as AriaPopover } from "react-aria-components";
import { slashParts } from "../engine/asset-tree";
import { importLibraryStyles, importLibraryVariable, libPrefix, useEnabledManifests } from "../engine/library";
import type { LibraryManifest } from "../engine/library-types";
import { swatchCss } from "../engine/paint";
import { editor, useEditor } from "../engine/store";
import { type AnyStyle, type StyleKind, addStyle, applyStyle, deleteStyle, duplicateStyle, findStyle, localStyles, updateStyle } from "../engine/styles";
import { FONT_FAMILIES } from "../engine/text";
import type { ColorStyle, Effect, EffectStyle, GradientPaint, Paint, SceneNode, TextStyle } from "../engine/types";
import { bindVariable, collectionsOf, resolveVariable } from "../engine/variables";
import { ColorSwatch } from "./color-picker";
import { NumberField } from "./number-field";
import { type PointMenuItem, PointMenu } from "./point-menu";
import { copyStyleLink, draftFrom, editStyle, useStyleEditing } from "./style-ui";
import { Select } from "./select";
import { DescriptionField } from "./rich-description";

// One style picker for colour, text and effect styles, like the reference's: search, list or grid, a
// library filter (All libraries, This file, each library), "/" folders, a tooltip with the
// description on hover and a right-click menu. The style editor window edits name, description
// and the style's properties.

const KIND_TITLE: Record<StyleKind, string> = { color: "Colour styles", text: "Text styles", effect: "Effect styles" };

interface StyleItem {
    sourceId: string;
    // The id in its source (this file, or the library).
    id: string;
    style: AnyStyle;
    local: boolean;
}

function libraryStyles(manifest: LibraryManifest, kind: StyleKind): StyleItem[] {
    return manifest.styles.filter((s) => s.kind === kind).map((s) => ({ sourceId: manifest.id, id: s.style.id, style: s.style, local: false }));
}

const VIEW_KEY = "nagma.styles.view";
function savedView(): "list" | "grid" {
    try {
        return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
        return "list";
    }
}

export function StylePreview({ kind, style, size = "sm" }: { kind: StyleKind; style: AnyStyle; size?: "sm" | "lg" }) {
    const box = size === "lg" ? "h-12 w-full rounded-md" : "size-4 shrink-0 rounded";
    if (kind === "color") return <span className={`${box} border border-black/20`} style={{ background: swatchCss((style as ColorStyle).paint, {}) }} />;
    if (kind === "text") {
        const t = style as TextStyle;
        return (
            <span className={`${box} flex items-center justify-center overflow-hidden bg-field text-ink ${size === "lg" ? "text-[18px]" : "text-[9px] font-semibold"}`} style={size === "lg" ? { fontFamily: `"${t.fontFamily}", system-ui`, fontWeight: t.fontWeight, fontStyle: t.italic ? "italic" : undefined } : undefined}>
                Ag
            </span>
        );
    }
    const e = style as EffectStyle;
    const first = e.effects?.[0] ?? (e.shadow ? { type: "drop-shadow", x: e.shadow.x, y: e.shadow.y, blur: e.shadow.blur, color: e.shadow.color, opacity: e.shadow.opacity } : null);
    return (
        <span className={`${box} flex items-center justify-center bg-field`}>
            <span className={size === "lg" ? "size-6 rounded bg-white" : "size-2.5 rounded-[2px] bg-white"} style={first && first.type !== "layer-blur" && first.type !== "background-blur" ? { boxShadow: `${first.type === "inner-shadow" ? "inset " : ""}${Math.sign(first.x)}px ${Math.max(1, Math.sign(first.y) * 2)}px ${size === "lg" ? 6 : 3}px ${first.color}` } : { filter: "blur(0.6px)" }} />
        </span>
    );
}

export function StylePicker({ kind, nodes, target = "fills", current, onDone }: { kind: StyleKind; nodes: SceneNode[]; target?: "fills" | "strokes"; current: string | null; onDone: () => void }) {
    const doc = useEditor((s) => s.doc);
    const manifests = useEnabledManifests(doc);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<string>("all");
    const [view, setViewState] = useState<"list" | "grid">(savedView);
    const [menu, setMenu] = useState<{ at: { x: number; y: number }; item: StyleItem } | null>(null);
    const ids = nodes.map((n) => n.id);
    const setView = (v: "list" | "grid") => {
        setViewState(v);
        try {
            localStorage.setItem(VIEW_KEY, v);
        } catch {
            // This session only.
        }
    };
    const sources = useMemo(() => {
        const local = { id: "local", name: "This file", items: localStyles(doc, kind).map((style): StyleItem => ({ sourceId: "local", id: style.id, style, local: true })) };
        const libs = manifests.map((m) => ({ id: m.id, name: m.name, items: libraryStyles(m, kind) })).filter((s) => s.items.length);
        return [local, ...libs];
    }, [doc, manifests, kind]);
    const q = query.trim().toLowerCase();
    const shown = sources.filter((s) => filter === "all" || s.id === filter).map((s) => ({ ...s, items: s.items.filter((i) => !q || i.style.name.toLowerCase().includes(q) || (i.style.description ?? "").toLowerCase().includes(q)) }));
    const isCurrent = (item: StyleItem) => current !== null && (item.local ? current === item.id : current === `${libPrefix(item.sourceId)}${item.id}`);

    const apply = async (item: StyleItem) => {
        let id = item.id;
        if (!item.local) {
            const [mapped] = await importLibraryStyles(item.sourceId, [item.id]);
            if (!mapped) return;
            id = mapped;
        }
        applyStyle(kind, ids, id, target);
        onDone();
    };
    const create = () => {
        const first = nodes[0];
        if (!first) return;
        const draft = draftFrom(kind, first, target, doc);
        if (!draft) return;
        onDone();
        editStyle({ kind, id: null, draft, applyTo: ids, target });
    };
    const menuItems = (item: StyleItem): PointMenuItem[] => [
        ...(item.local
            ? ([
                  { id: "edit", label: "Edit style", run: () => editStyle({ kind, id: item.id }) },
                  { id: "duplicate", label: "Duplicate style", run: () => duplicateStyle(kind, item.id) },
                  { id: "delete", label: "Delete style", run: () => deleteStyle(kind, item.id) },
                  "separator",
              ] as PointMenuItem[])
            : []),
        { id: "link", label: "Copy link to style", run: () => void copyStyleLink(item.local ? item.id : `${libPrefix(item.sourceId)}${item.id}`) },
    ];

    // Colour variables sit beside colour styles, as in the reference's Libraries tab of the fill picker.
    const varField = target === "fills" ? "fill:0" : "stroke:0";
    const colorVars = kind === "color" ? collectionsOf(doc).flatMap((c) => c.variables.filter((v) => v.type === "color" && !v.hidden && (!q || v.name.toLowerCase().includes(q))).map((v) => ({ v, c }))) : [];
    const libraryVars = kind === "color" ? manifests.flatMap((m) => m.variables.flatMap((c) => c.variables.filter((v) => v.type === "color" && (!q || v.name.toLowerCase().includes(q))).map((v) => ({ m, c, v })))).filter(({ m, v }) => !colorVars.some((x) => x.v.id === `${libPrefix(m.id)}${v.id}`)) : [];
    const bound = nodes[0]?.boundVariables?.[varField] ?? null;

    return (
        <div className="flex w-64 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{KIND_TITLE[kind]}</span>
                <button type="button" aria-label={view === "list" ? "Show as grid" : "Show as list"} onClick={() => setView(view === "list" ? "grid" : "list")} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    {view === "list" ? <Grid01 className="size-3.5" /> : <List className="size-3.5" />}
                </button>
                {nodes.length > 0 && (
                    <button type="button" aria-label="Create style" onClick={create} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                        <Plus className="size-3.5" />
                    </button>
                )}
            </div>
            <div className="flex shrink-0 gap-1 p-2">
                <label className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-panel-border bg-field px-1.5 text-ink-muted focus-within:border-brand-500">
                    <SearchSm className="size-3.5 shrink-0" />
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search" aria-label="Search styles" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
                </label>
                <Select aria-label="Library" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-6 max-w-[96px] rounded-md bg-field px-1 text-ink outline-none">
                    <option value="all">All libraries</option>
                    {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name}
                        </option>
                    ))}
                </Select>
            </div>
            <div className="max-h-80 overflow-y-auto px-1 pb-2">
                {shown.map((s) =>
                    s.items.length ? (
                        <div key={s.id} className="mb-1">
                            <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-semibold text-ink-muted">{s.name}</div>
                            <Folders
                                items={s.items}
                                render={(list) =>
                                    view === "grid" ? (
                                        <div className="grid grid-cols-6 gap-1 px-1 py-0.5">
                                            {list.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    title={tooltip(item.style)}
                                                    onClick={() => void apply(item)}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        setMenu({ at: { x: e.clientX, y: e.clientY }, item });
                                                    }}
                                                    className={`flex aspect-square items-center justify-center rounded-md hover:ring-1 hover:ring-ink-subtle ${isCurrent(item) ? "ring-2 ring-brand-500" : ""}`}
                                                >
                                                    <StylePreview kind={kind} style={item.style} />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        list.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                title={tooltip(item.style)}
                                                onClick={() => void apply(item)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setMenu({ at: { x: e.clientX, y: e.clientY }, item });
                                                }}
                                                className={`flex h-6 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover ${isCurrent(item) ? "bg-panel-hover" : ""}`}
                                            >
                                                <StylePreview kind={kind} style={item.style} />
                                                <span className="min-w-0 flex-1 truncate">{slashParts(item.style.name).leaf}</span>
                                                {kind === "text" && <span className="shrink-0 text-ink-subtle">{(item.style as TextStyle).fontSize}</span>}
                                                {isCurrent(item) && <span className="text-brand-500">✓</span>}
                                            </button>
                                        ))
                                    )
                                }
                            />
                        </div>
                    ) : null,
                )}
                {shown.every((s) => !s.items.length) && !colorVars.length && !libraryVars.length && <p className="px-2 py-3 text-center text-ink-muted">{q ? "No styles match." : `No ${KIND_TITLE[kind].toLowerCase()} yet.${nodes.length ? " Click + to create one from the selection." : ""}`}</p>}
                {(colorVars.length > 0 || libraryVars.length > 0) && (
                    <div className="mt-1 border-t border-panel-border pt-1">
                        <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-semibold text-ink-muted">Variables</div>
                        {colorVars.map(({ v, c }) => {
                            const r = resolveVariable(doc, v.id, nodes[0] ?? null);
                            return (
                                <button
                                    key={v.id}
                                    type="button"
                                    title={v.description ? `${v.name}\n${v.description}` : v.name}
                                    onClick={() => {
                                        bindVariable(ids, varField, bound === v.id ? null : v.id);
                                        onDone();
                                    }}
                                    className={`flex h-6 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover ${bound === v.id ? "bg-panel-hover" : ""}`}
                                >
                                    <span className="size-4 shrink-0 rounded border border-black/20" style={{ background: typeof r?.value === "string" ? r.value : "#000", opacity: r?.opacity ?? 1 }} />
                                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                                    <span className="max-w-20 truncate text-ink-subtle">{c.name}</span>
                                </button>
                            );
                        })}
                        {libraryVars.slice(0, 200).map(({ m, c, v }) => (
                            <button
                                key={`${m.id}:${v.id}`}
                                type="button"
                                title={v.description ? `${v.name}\n${v.description}` : v.name}
                                onClick={() =>
                                    void importLibraryVariable(m.id, v.id).then((id) => {
                                        if (id) bindVariable(ids, varField, id);
                                        onDone();
                                    })
                                }
                                className="flex h-6 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-panel-hover"
                            >
                                <span className="size-4 shrink-0 rounded border border-black/20" style={{ background: typeof v.values[c.defaultModeId ?? c.modes[0]?.id ?? ""] === "string" ? String(v.values[c.defaultModeId ?? c.modes[0]?.id ?? ""]) : "#888" }} />
                                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                                <span className="max-w-20 truncate text-ink-subtle">{m.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {menu && <PointMenu at={menu.at} items={menuItems(menu.item)} onClose={() => setMenu(null)} label="Style actions" />}
        </div>
    );
}

function tooltip(style: AnyStyle): string {
    return style.description ? `${style.name}\n${style.description}` : style.name;
}


// Styles grouped by "/" folders: folders collapse, the rest render as given.
function Folders({ items, render }: { items: StyleItem[]; render: (list: StyleItem[]) => React.ReactNode }) {
    const loose = items.filter((i) => slashParts(i.style.name).folders.length === 0);
    const folders = new Map<string, StyleItem[]>();
    for (const i of items) {
        const f = slashParts(i.style.name).folders.join(" / ");
        if (f) folders.set(f, [...(folders.get(f) ?? []), i]);
    }
    return (
        <>
            {loose.length > 0 && render(loose)}
            {[...folders.entries()].map(([name, list]) => (
                <FolderBlock key={name} name={name} list={list} render={render} />
            ))}
        </>
    );
}

function FolderBlock({ name, list, render }: { name: string; list: StyleItem[]; render: (list: StyleItem[]) => React.ReactNode }) {
    const [open, setOpen] = useState(true);
    return (
        <div>
            <button type="button" onClick={() => setOpen(!open)} className="flex h-6 w-full items-center gap-1 px-1 text-left text-[11px] text-ink-muted hover:text-ink">
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                <span className="truncate">{name}</span>
            </button>
            {open && render(list)}
        </div>
    );
}



// ---- The style editor window ----

export function StyleEditorHost() {
    const editing = useStyleEditing();
    const doc = useEditor((s) => s.doc);
    if (!editing) return null;
    const existing = editing.id ? findStyle(doc, editing.id) : null;
    const style = existing?.style ?? editing.draft;
    if (!style) return null;
    return <StyleEditor key={editing.id ?? style.id} kind={editing.kind} style={style} creating={!existing} applyTo={editing.applyTo ?? []} target={editing.target ?? "fills"} />;
}

const WEIGHTS: [number, string][] = [
    [100, "Thin"],
    [200, "Extra Light"],
    [300, "Light"],
    [400, "Regular"],
    [500, "Medium"],
    [600, "Semi Bold"],
    [700, "Bold"],
    [800, "Extra Bold"],
    [900, "Black"],
];
const EFFECT_TYPES = Object.entries(EFFECT_LABELS) as [Effect["type"], string][];

function StyleEditor({ kind, style, creating, applyTo, target }: { kind: StyleKind; style: AnyStyle; creating: boolean; applyTo: string[]; target: "fills" | "strokes" }) {
    const [draft, setDraft] = useState<AnyStyle>(style);
    // Existing styles change as you edit (one undo step per change); new ones wait for Create.
    const change = (patch: Partial<AnyStyle>) => {
        const next = { ...draft, ...patch } as AnyStyle;
        setDraft(next);
        if (!creating) updateStyle(kind, style.id, patch);
    };
    const close = () => editStyle(null);
    const field = "h-8 w-full rounded-md border border-panel-border bg-field px-2 text-ink outline-none focus:border-brand-500";
    const create = () => {
        if (kind === "color" && target === "strokes") {
            addStyle(kind, draft, []);
            applyStyle(kind, applyTo, draft.id, "strokes");
            editor.mergeLast();
        } else addStyle(kind, draft, applyTo);
        close();
    };
    return (
        <AriaModalOverlay isOpen isDismissable onOpenChange={(open) => !open && close()} className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            <AriaModal className="w-[340px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label={creating ? "Create style" : "Edit style"}>
                    <header className="flex h-11 items-center justify-between border-b border-panel-border px-3">
                        <h2 className="text-[13px] font-semibold">{creating ? `Create ${KIND_TITLE[kind].toLowerCase().replace("styles", "style")}` : "Edit style"}</h2>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-4" />
                        </button>
                    </header>
                    <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3 text-[12px]">
                        <StylePreview kind={kind} style={draft} size="lg" />
                        <label className="block space-y-1">
                            <span className="text-ink-muted">Name</span>
                            <input autoFocus={creating} defaultValue={draft.name} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value.trim() && e.target.value !== draft.name && change({ name: e.target.value.trim() })} onChange={(e) => creating && setDraft({ ...draft, name: e.target.value })} className={field} aria-label="Style name" />
                        </label>
                        <div className="space-y-1">
                            <span className="text-ink-muted">Description</span>
                            <DescriptionField value={draft} label="Style description" onChange={(patch) => change(patch)} />
                        </div>
                        <div className="space-y-1.5">
                            <span className="text-ink-muted">Properties</span>
                            {kind === "color" && <PaintFields paint={(draft as ColorStyle).paint} onChange={(paint) => change({ paint } as Partial<ColorStyle>)} />}
                            {kind === "text" && <TextFields style={draft as TextStyle} onChange={(p) => change(p as Partial<AnyStyle>)} />}
                            {kind === "effect" && <EffectFields effects={(draft as EffectStyle).effects ?? []} onChange={(effects) => change({ effects, shadow: null, blur: 0 } as Partial<EffectStyle>)} />}
                        </div>
                    </div>
                    {creating && (
                        <footer className="flex justify-end gap-2 border-t border-panel-border p-3">
                            <button type="button" onClick={close} className="h-8 rounded-md border border-panel-border px-3 text-[12px] hover:bg-panel-hover">
                                Cancel
                            </button>
                            <button type="button" onClick={create} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
                                Create style
                            </button>
                        </footer>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function PaintFields({ paint, onChange }: { paint: Paint; onChange: (p: Paint) => void }) {
    if (paint.type === "solid")
        return (
            <div className="flex items-center gap-2">
                <ColorSwatch color={paint.color} opacity={paint.opacity} label="Style colour" placement="bottom start" onChange={(color, opacity) => onChange({ ...paint, color, opacity })} />
                <input
                    defaultValue={paint.color.replace("#", "").toUpperCase()}
                    key={paint.color}
                    aria-label="Hex"
                    onKeyDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                        const v = e.target.value.trim().replace("#", "");
                        if (/^[0-9a-f]{6}$/i.test(v)) onChange({ ...paint, color: `#${v.toUpperCase()}` });
                    }}
                    className="h-6 min-w-0 flex-1 rounded-md bg-field px-2 text-ink outline-none"
                />
                <div className="w-20">
                    <NumberField label="" title="Opacity" suffix="%" min={0} max={100} value={Math.round(paint.opacity * 100)} onCommit={(v) => onChange({ ...paint, opacity: v / 100 })} />
                </div>
            </div>
        );
    if (paint.type === "image") return <p className="text-ink-muted">Image fill</p>;
    const g = paint as GradientPaint;
    return (
        <div className="space-y-1">
            {g.stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
                    <ColorSwatch color={stop.color} opacity={stop.opacity} label={`Stop ${i + 1}`} placement="bottom start" onChange={(color, opacity) => onChange({ ...g, stops: g.stops.map((s, k) => (k === i ? { ...s, color, opacity } : s)) })} />
                    <span className="flex-1">{stop.color.toUpperCase()}</span>
                    <span className="text-ink-subtle">{Math.round(stop.position * 100)}%</span>
                </div>
            ))}
        </div>
    );
}

function TextFields({ style, onChange }: { style: TextStyle; onChange: (p: Partial<TextStyle>) => void }) {
    const select = "h-6 min-w-0 rounded-md bg-field px-1 text-ink outline-none";
    return (
        <div className="space-y-1.5">
            <Select aria-label="Font" value={style.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })} className={`${select} w-full`}>
                {!FONT_FAMILIES.includes(style.fontFamily) && <option value={style.fontFamily}>{style.fontFamily}</option>}
                {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                        {f}
                    </option>
                ))}
            </Select>
            <div className="grid grid-cols-2 gap-1.5">
                <Select aria-label="Weight" value={`${style.fontWeight}${style.italic ? "i" : ""}`} onChange={(e) => onChange({ fontWeight: Number.parseInt(e.target.value, 10), italic: e.target.value.endsWith("i") })} className={select}>
                    {WEIGHTS.flatMap(([w, label]) => [
                        <option key={w} value={String(w)}>
                            {label}
                        </option>,
                        <option key={`${w}i`} value={`${w}i`}>
                            {label} Italic
                        </option>,
                    ])}
                </Select>
                <NumberField label="Aa" title="Font size" min={1} value={style.fontSize} onCommit={(v) => onChange({ fontSize: v })} />
                <NumberField label="↕" title="Line height (%; 0 is auto)" suffix="%" min={0} value={style.lineHeight === null ? 0 : Math.round(style.lineHeight * 100)} onCommit={(v) => onChange({ lineHeight: v <= 0 ? null : v / 100 })} />
                <NumberField label="↔" title="Letter spacing" suffix="%" value={style.letterSpacing} onCommit={(v) => onChange({ letterSpacing: v })} />
            </div>
        </div>
    );
}

function EffectFields({ effects, onChange }: { effects: Effect[]; onChange: (e: Effect[]) => void }) {
    const patch = (i: number, p: Partial<Effect>) => onChange(effects.map((e, k) => (k === i ? { ...e, ...p } : e)));
    return (
        <div className="space-y-2">
            {effects.map((e, i) => (
                <div key={i} className="space-y-1 rounded-md border border-panel-border p-2">
                    <div className="flex items-center gap-1">
                        <Select aria-label="Effect type" value={e.type} onChange={(ev) => onChange(effects.map((x, k) => (k === i ? defaultEffect(ev.target.value as Effect["type"], x.visible) : x)))} className="h-6 min-w-0 flex-1 rounded-md bg-field px-1 text-ink outline-none">
                            {EFFECT_TYPES.map(([t, label]) => (
                                <option key={t} value={t}>
                                    {label}
                                </option>
                            ))}
                        </Select>
                        <button type="button" onClick={() => onChange(effects.filter((_, k) => k !== i))} aria-label="Remove effect" className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-3.5" />
                        </button>
                    </div>
                    {e.type === "layer-blur" || e.type === "background-blur" || e.type === "motion-blur" ? (
                        <NumberField label="Blur" min={0} value={e.blur} onCommit={(v) => patch(i, { blur: v })} />
                    ) : e.type === "noise" || e.type === "texture" || e.type === "glass" ? (
                        <p className="text-ink-subtle">Its finer settings are edited on a layer; make a style from that layer to keep them.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-1">
                                <NumberField label="X" value={e.x} onCommit={(v) => patch(i, { x: v })} />
                                <NumberField label="Y" value={e.y} onCommit={(v) => patch(i, { y: v })} />
                                <NumberField label="Blur" min={0} value={e.blur} onCommit={(v) => patch(i, { blur: v })} />
                                <NumberField label="Spread" value={e.spread} onCommit={(v) => patch(i, { spread: v })} />
                            </div>
                            <div className="flex items-center gap-2">
                                <ColorSwatch color={e.color} opacity={e.opacity} label="Effect colour" placement="bottom start" onChange={(color, opacity) => patch(i, { color, opacity })} />
                                <span className="flex-1">{e.color.toUpperCase()}</span>
                                <span className="text-ink-subtle">{Math.round(e.opacity * 100)}%</span>
                            </div>
                        </>
                    )}
                </div>
            ))}
            <button type="button" onClick={() => onChange([...effects, { type: "drop-shadow", visible: true, x: 0, y: 4, blur: 12, spread: 0, color: "#000000", opacity: 0.25 }])} className="flex h-6 w-full items-center justify-center gap-1 rounded-md border border-panel-border hover:bg-panel-hover">
                <Plus className="size-3.5" /> Add effect
            </button>
        </div>
    );
}

// The styles button in a section header (Fill, Stroke, Typography, Effects).
export function StyleButton({ kind, nodes, target = "fills", label }: { kind: StyleKind; nodes: SceneNode[]; target?: "fills" | "strokes"; label: string }) {
    const key = kind === "color" ? (target === "fills" ? "fillStyleId" : "strokeStyleId") : kind === "text" ? "textStyleId" : "effectStyleId";
    const first = nodes[0]?.[key] ?? null;
    const current = first && nodes.every((n) => n[key] === first) ? first : null;
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={label} className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Grid01 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label={label}>{({ close }) => <StylePicker kind={kind} nodes={nodes} target={target} current={current} onDone={close} />}</AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

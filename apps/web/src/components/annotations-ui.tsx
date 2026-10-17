import { Bold01, Italic01, Link01, Plus, Trash01, X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { hitTest } from "../canvas/hit-test";
import { type Measure, measureBetween } from "../canvas/snapping";
import { screenToWorld, worldToScreen } from "../engine/camera";
import {
    CATEGORY_COLORS,
    PROPERTIES,
    addMeasurement,
    categories,
    categoryOf,
    finishEditing,
    notes,
    plainText,
    propertyDef,
    propertyValue,
    removeAnnotation,
    removeMeasurement,
    sanitize,
    setCategories,
    updateAnnotation,
    updateMeasurement,
    useNotes,
} from "../engine/annotations";
import { pageOf } from "../engine/page";
import { editor, useEditor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { Annotation, AnnotationCategory, NagmaDocument, Rect, SceneNode } from "../engine/types";
import { DarkMenu } from "./collab-menu";

// Annotations and measurements over the canvas: cards pinned to layers (rich text and live property
// values in a category), the inline editor, and measurement lines you drag between layers.

const MEASURE = "#F24822";
const NOTE = "#1BC47D";

const fmt = (v: number) => String(Math.round(v * 100) / 100);

export function NotesLayer() {
    const mode = useEditor((s) => s.mode);
    const tool = useEditor((s) => s.tool);
    const uiHidden = useEditor((s) => s.uiHidden);
    const presenting = useEditor((s) => s.presentingId !== null);
    const selected = useNotes((s) => s.selected);
    const editing = useNotes((s) => s.editing);
    const shown = useEditor((s) => s.prefs.showAnnotations);
    if (presenting || uiHidden) return null;
    const show = (mode === "dev" && shown) || tool === "annotation" || tool === "measure" || selected !== null || editing !== null;
    return (
        <>
            {show && <Measurements />}
            {show && <AnnotationCards />}
            {tool === "measure" && <MeasureTool />}
        </>
    );
}

// ---- Measurements ----

interface Line extends Measure {
    horizontal: boolean;
}

function linesFor(doc: NagmaDocument, m: { a: string; b: string; offset?: number }): Line[] {
    const a = doc.nodes[m.a];
    const b = doc.nodes[m.b];
    if (!a || !b) return [];
    const ra = worldBounds(doc, a);
    const off = m.offset ?? 0;
    if (m.a === m.b) {
        // Along one layer: its width, just above it.
        const y = ra.y - 12 + off;
        return [{ x1: ra.x, y1: y, x2: ra.x + ra.w, y2: y, value: ra.w, horizontal: true }];
    }
    return measureBetween(ra, worldBounds(doc, b)).map((l) => {
        const horizontal = l.y1 === l.y2;
        return horizontal ? { ...l, y1: l.y1 + off, y2: l.y2 + off, horizontal } : { ...l, x1: l.x1 + off, x2: l.x2 + off, horizontal };
    });
}

function Measurements() {
    const doc = useEditor((s) => s.doc);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const selected = useNotes((s) => s.selected);
    const [editingLabel, setEditingLabel] = useState<string | null>(null);
    // A line being dragged off the design: its offset until released.
    const [live, setLive] = useState<{ id: string; offset: number } | null>(null);
    const page = doc.nodes[pageId];
    const list = (page?.measurements ?? []).map((m) => (live?.id === m.id ? { ...m, offset: live.offset } : m));
    if (!list.length) return null;
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <svg className="absolute inset-0 size-full overflow-visible">
                {list.flatMap((m) =>
                    linesFor(doc, m).map((l, i) => {
                        const a = worldToScreen(camera, l.x1, l.y1);
                        const b = worldToScreen(camera, l.x2, l.y2);
                        const active = selected?.kind === "measurement" && selected.id === m.id;
                        return (
                            <g key={`${m.id}${i}`}>
                                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={MEASURE} strokeWidth={active ? 2 : 1} />
                                {/* End ticks */}
                                {l.horizontal ? (
                                    <>
                                        <line x1={a.x} y1={a.y - 4} x2={a.x} y2={a.y + 4} stroke={MEASURE} />
                                        <line x1={b.x} y1={b.y - 4} x2={b.x} y2={b.y + 4} stroke={MEASURE} />
                                    </>
                                ) : (
                                    <>
                                        <line x1={a.x - 4} y1={a.y} x2={a.x + 4} y2={a.y} stroke={MEASURE} />
                                        <line x1={b.x - 4} y1={b.y} x2={b.x + 4} y2={b.y} stroke={MEASURE} />
                                    </>
                                )}
                                <line
                                    x1={a.x}
                                    y1={a.y}
                                    x2={b.x}
                                    y2={b.y}
                                    stroke="transparent"
                                    strokeWidth={10}
                                    className="pointer-events-auto cursor-pointer"
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        notes.set({ selected: { kind: "measurement", pageId, id: m.id } });
                                        // Dragging moves the line off the design (across its direction).
                                        const start = { x: e.clientX, y: e.clientY };
                                        const base = m.offset ?? 0;
                                        let moved = false;
                                        let pending: number | null = null;
                                        const move = (ev: PointerEvent) => {
                                            const d = l.horizontal ? ev.clientY - start.y : ev.clientX - start.x;
                                            if (!moved && Math.abs(d) < 3) return;
                                            moved = true;
                                            pending = base + d / editor.get().camera.zoom;
                                            setLive({ id: m.id, offset: pending });
                                        };
                                        const up = () => {
                                            window.removeEventListener("pointermove", move);
                                            window.removeEventListener("pointerup", up);
                                            setLive(null);
                                            if (moved && pending !== null) updateMeasurement(pageId, m.id, { offset: Math.round(pending) });
                                        };
                                        window.addEventListener("pointermove", move);
                                        window.addEventListener("pointerup", up);
                                    }}
                                />
                            </g>
                        );
                    }),
                )}
            </svg>
            {list.flatMap((m) =>
                linesFor(doc, m).map((l, i) => {
                    const a = worldToScreen(camera, l.x1, l.y1);
                    const b = worldToScreen(camera, l.x2, l.y2);
                    const active = selected?.kind === "measurement" && selected.id === m.id;
                    const key = `${m.id}${i}`;
                    return (
                        <div key={key} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}>
                            {editingLabel === key ? (
                                <input
                                    autoFocus
                                    defaultValue={m.label ?? fmt(l.value)}
                                    aria-label="Measurement text"
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                        if (e.key === "Escape") setEditingLabel(null);
                                    }}
                                    onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        updateMeasurement(pageId, m.id, { label: v && v !== fmt(l.value) ? v : undefined });
                                        setEditingLabel(null);
                                    }}
                                    className="h-5 w-20 rounded px-1 text-center text-[11px] font-semibold text-white outline-none"
                                    style={{ background: MEASURE }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    title="Double-click to edit the text"
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        notes.set({ selected: { kind: "measurement", pageId, id: m.id } });
                                    }}
                                    onDoubleClick={() => setEditingLabel(key)}
                                    className={`h-[18px] rounded px-1.5 text-[11px] font-semibold whitespace-nowrap text-white ${active ? "ring-2 ring-white/70" : ""}`}
                                    style={{ background: MEASURE }}
                                >
                                    {m.label ?? fmt(l.value)}
                                </button>
                            )}
                            {active && i === 0 && (
                                <button type="button" aria-label="Delete measurement" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeMeasurement(pageId, m.id)} className="absolute top-1/2 left-full ml-1 flex size-[18px] -translate-y-1/2 items-center justify-center rounded bg-tooltip text-white">
                                    <X className="size-3" />
                                </button>
                            )}
                        </div>
                    );
                }),
            )}
        </div>
    );
}

// The Measurement tool: press on a layer, drag to another (or along the same one), release.
function MeasureTool() {
    const doc = useEditor((s) => s.doc);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const [drag, setDrag] = useState<{ from: SceneNode; start: { x: number; y: number }; at: { x: number; y: number }; over: SceneNode | null } | null>(null);
    const [hover, setHover] = useState<SceneNode | null>(null);
    const host = useRef<HTMLDivElement>(null);
    const local = (e: React.PointerEvent) => {
        const box = host.current?.getBoundingClientRect();
        return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
    };
    const hit = (p: { x: number; y: number }) => {
        const w = screenToWorld(editor.get().camera, p.x, p.y);
        return hitTest(editor.get().doc, w.x, w.y, true);
    };
    const outline = (n: SceneNode | null, color: string) => {
        if (!n || !doc.nodes[n.id] || pageOf(doc, n) !== pageId) return null;
        const r: Rect = worldBounds(doc, n);
        const a = worldToScreen(camera, r.x, r.y);
        return <div className="pointer-events-none absolute border" style={{ left: a.x, top: a.y, width: r.w * camera.zoom, height: r.h * camera.zoom, borderColor: color }} />;
    };
    return (
        <div
            ref={host}
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const p = local(e);
                const from = hit(p);
                if (!from) {
                    editor.notify("Press on a layer and drag to another to measure between them.");
                    return;
                }
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDrag({ from, start: p, at: p, over: from });
            }}
            onPointerMove={(e) => {
                const p = local(e);
                const over = hit(p);
                if (drag) setDrag({ ...drag, at: p, over });
                else setHover(over);
            }}
            onPointerUp={(e) => {
                if (!drag) return;
                const over = hit(local(e)) ?? drag.from;
                setDrag(null);
                if (editor.get().readOnly) {
                    editor.notify("You need edit access to add measurements.");
                    return;
                }
                addMeasurement(pageId, drag.from.id, over.id);
            }}
        >
            {outline(drag ? drag.from : hover, MEASURE)}
            {drag && drag.over && drag.over.id !== drag.from.id && outline(drag.over, MEASURE)}
            {drag && (
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
                    <line x1={drag.start.x} y1={drag.start.y} x2={drag.at.x} y2={drag.at.y} stroke={MEASURE} strokeDasharray="4 3" />
                </svg>
            )}
        </div>
    );
}

// ---- Annotation cards ----

function AnnotationCards() {
    const doc = useEditor((s) => s.doc);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const hidden = useNotes((s) => s.hidden);
    const nodes = Object.values(doc.nodes).filter((n) => n.annotations?.length && n.visible && pageOf(doc, n) === pageId);
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {nodes.map((node) => {
                const box = worldBounds(doc, node);
                const corner = worldToScreen(camera, box.x + box.w, box.y);
                const shown = (node.annotations ?? []).filter((a) => !a.categoryId || !hidden.includes(a.categoryId));
                if (!shown.length) return null;
                return (
                    <div key={node.id}>
                        <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white" style={{ left: corner.x, top: corner.y, background: NOTE }} />
                        <span className="absolute h-px" style={{ left: corner.x, top: corner.y, width: 12, background: NOTE }} />
                        <div className="absolute flex w-56 flex-col gap-1.5" style={{ left: corner.x + 12, top: corner.y - 10 }}>
                            {shown.map((a) => (
                                <Card key={a.id} node={node} a={a} doc={doc} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Card({ node, a, doc }: { node: SceneNode; a: Annotation; doc: NagmaDocument }) {
    const selected = useNotes((s) => s.selected?.kind === "annotation" && s.selected.id === a.id);
    const editing = useNotes((s) => s.editing?.id === a.id);
    const cat = categoryOf(doc, a);
    const color = cat?.color ?? NOTE;
    if (editing) return <Editor node={node} a={a} doc={doc} />;
    return (
        <div
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
                e.stopPropagation();
                editor.set({ selection: [node.id] });
                notes.set({ selected: { kind: "annotation", nodeId: node.id, id: a.id } });
            }}
            onDoubleClick={() => notes.set({ editing: { nodeId: node.id, id: a.id } })}
            className={`pointer-events-auto rounded-md border-l-[3px] bg-panel-raised px-2 py-1.5 text-[11px] text-ink shadow-lg ${selected ? "ring-2 ring-brand-500" : ""}`}
            style={{ borderLeftColor: color }}
        >
            {cat && (
                <div className="mb-0.5 text-[10px] font-semibold" style={{ color }}>
                    {cat.label}
                </div>
            )}
            {a.html ? <div className="annotation-rich leading-snug [&_a]:text-brand-500 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: sanitize(a.html) }} /> : a.text && <div className="leading-snug whitespace-pre-wrap">{a.text}</div>}
            {(a.properties ?? []).length > 0 && (
                <div className="mt-1 space-y-0.5">
                    {(a.properties ?? []).map((key) => (
                        <div key={key} className="flex justify-between gap-2 rounded bg-field px-1.5 py-0.5">
                            <span className="text-ink-muted">{propertyDef(key)?.label ?? key}</span>
                            <span className="truncate font-medium">{propertyValue(doc, node, key) ?? "None"}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Editor({ node, a, doc }: { node: SceneNode; a: Annotation; doc: NagmaDocument }) {
    const area = useRef<HTMLDivElement>(null);
    const [managing, setManaging] = useState(false);
    useEffect(() => {
        const el = area.current;
        if (!el) return;
        el.innerHTML = sanitize(a.html ?? (a.text ? a.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c).replace(/\n/g, "<br>") : ""));
        const t = window.setTimeout(() => el.focus(), 30);
        return () => window.clearTimeout(t);
        // Only when opening this annotation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [a.id]);
    const save = () => {
        const html = sanitize(area.current?.innerHTML ?? "");
        const text = plainText(html);
        if (html !== (a.html ?? "") || text !== a.text) updateAnnotation(node.id, a.id, { html, text });
    };
    const exec = (command: string, value?: string) => {
        area.current?.focus();
        document.execCommand(command, false, value);
    };
    const cats = categories(doc);
    const cat = categoryOf(doc, a);
    const props = PROPERTIES.filter((p) => p.applies(node));
    const tb = "flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <div className="pointer-events-auto w-64 rounded-lg border border-panel-border bg-panel-raised text-[11px] text-ink shadow-xl" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-0.5 border-b border-panel-border px-1.5 py-1">
                <button type="button" aria-label="Bold" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} className={tb}>
                    <Bold01 className="size-3.5" />
                </button>
                <button type="button" aria-label="Italic" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} className={tb}>
                    <Italic01 className="size-3.5" />
                </button>
                <button type="button" aria-label="Bulleted list" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} className={`${tb} text-[13px]`}>
                    •
                </button>
                <button type="button" aria-label="Numbered list" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} className={`${tb} text-[10px] font-semibold`}>
                    1.
                </button>
                <LinkButton onLink={(url) => exec("createLink", url)} />
                <div className="flex-1" />
                <DarkMenu
                    label="Category"
                    className="flex h-6 max-w-28 items-center gap-1 rounded px-1.5 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                    width="w-48"
                    trigger={
                        <>
                            <span className="size-2 shrink-0 rounded-full" style={{ background: cat?.color ?? "transparent", border: cat ? undefined : "1px solid currentColor" }} />
                            <span className="truncate">{cat?.label ?? "Category"}</span>
                        </>
                    }
                    items={[{ id: "none", label: "No category", checked: !cat }, ...cats.map((c) => ({ id: c.id, label: c.label, checked: c.id === cat?.id })), "-", { id: "edit", label: "Edit categories…" }]}
                    onAction={(id) => {
                        if (id === "edit") setManaging(true);
                        else updateAnnotation(node.id, a.id, { categoryId: id === "none" ? null : id });
                    }}
                />
            </div>
            <div
                ref={area}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Annotation"
                aria-multiline="true"
                data-placeholder="Add an annotation"
                onBlur={save}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                        e.preventDefault();
                        save();
                        finishEditing();
                    }
                }}
                className="min-h-14 px-2.5 py-2 leading-snug outline-none empty:before:text-ink-subtle empty:before:content-[attr(data-placeholder)] [&_a]:text-brand-500 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4"
            />
            {(a.properties ?? []).length > 0 && (
                <div className="space-y-0.5 px-2 pb-1.5">
                    {(a.properties ?? []).map((key) => (
                        <div key={key} className="group flex items-center justify-between gap-2 rounded bg-field px-1.5 py-0.5">
                            <span className="text-ink-muted">{propertyDef(key)?.label ?? key}</span>
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate font-medium">{propertyValue(doc, node, key) ?? "None"}</span>
                                <button type="button" aria-label="Remove property" onClick={() => updateAnnotation(node.id, a.id, { properties: (a.properties ?? []).filter((k) => k !== key) })} className="text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                                    <X className="size-3" />
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {managing && <CategoryManager cats={cats} close={() => setManaging(false)} />}
            <div className="flex items-center gap-1 border-t border-panel-border px-1.5 py-1">
                <DarkMenu
                    label="Add property"
                    placement="bottom start"
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                    width="w-52"
                    trigger={
                        <>
                            <Plus className="size-3" /> Property
                        </>
                    }
                    items={props.map((p) => ({ id: p.key, label: `${p.label}  ${p.value(node, doc) ?? ""}`, checked: (a.properties ?? []).includes(p.key) }))}
                    onAction={(key) => {
                        const list = a.properties ?? [];
                        updateAnnotation(node.id, a.id, { properties: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] });
                    }}
                />
                <div className="flex-1" />
                <button type="button" aria-label="Delete annotation" title="Delete" onClick={() => removeAnnotation(node.id, a.id)} className={tb}>
                    <Trash01 className="size-3.5" />
                </button>
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        save();
                        finishEditing();
                    }}
                    className="h-6 rounded bg-brand-500 px-2 font-semibold text-white"
                >
                    Done
                </button>
            </div>
        </div>
    );
}

function LinkButton({ onLink }: { onLink: (url: string) => void }) {
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState("https://");
    return (
        <span className="relative">
            <button type="button" aria-label="Link" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                <Link01 className="size-3.5" />
            </button>
            {open && (
                <form
                    className="absolute top-7 left-0 z-10 flex w-56 gap-1 rounded-md bg-tooltip p-1 shadow-xl"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (/^(https?:|mailto:)/i.test(url)) onLink(url);
                        setOpen(false);
                    }}
                >
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link address" className="h-6 min-w-0 flex-1 rounded bg-white/10 px-1.5 text-[11px] text-white outline-none" />
                    <button type="submit" className="h-6 rounded bg-brand-500 px-2 text-[11px] text-white">
                        Add
                    </button>
                </form>
            )}
        </span>
    );
}

// Edit categories: rename, recolour, delete, add. Changes apply to this file.
function CategoryManager({ cats, close }: { cats: AnnotationCategory[]; close: () => void }) {
    const [list, setList] = useState(cats);
    const [newName, setNewName] = useState("");
    const set = (id: string, patch: Partial<AnnotationCategory>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    return (
        <div className="space-y-1.5 border-t border-panel-border p-2">
            <div className="font-semibold">Edit categories</div>
            {list.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5">
                    <button type="button" aria-label={`Colour of ${c.label}`} title="Change colour" onClick={() => set(c.id, { color: CATEGORY_COLORS[(CATEGORY_COLORS.indexOf(c.color) + 1) % CATEGORY_COLORS.length] ?? c.color })} className="size-4 shrink-0 rounded-full" style={{ background: c.color }} />
                    <input value={c.label} onChange={(e) => set(c.id, { label: e.target.value })} aria-label="Category name" className="h-6 min-w-0 flex-1 rounded bg-field px-1.5 outline-none focus:ring-1 focus:ring-brand-500" />
                    <button type="button" aria-label={`Delete ${c.label}`} onClick={() => setList((l) => l.filter((x) => x.id !== c.id))} className="text-ink-subtle hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            ))}
            <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!newName.trim()) return;
                    setList((l) => [...l, { id: `c${Date.now().toString(36)}`, label: newName.trim(), color: CATEGORY_COLORS[l.length % CATEGORY_COLORS.length] ?? NOTE }]);
                    setNewName("");
                }}
            >
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" aria-label="New category" className="h-6 min-w-0 flex-1 rounded bg-field px-1.5 outline-none focus:ring-1 focus:ring-brand-500" />
                <button type="submit" className="h-6 rounded border border-panel-border px-2 hover:bg-panel-hover">
                    Add
                </button>
            </form>
            <div className="flex justify-end gap-1.5">
                <button type="button" onClick={close} className="h-6 rounded px-2 text-ink-muted hover:bg-panel-hover">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setCategories(list.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim() })));
                        close();
                    }}
                    className="h-6 rounded bg-brand-500 px-2 font-semibold text-white"
                >
                    Save
                </button>
            </div>
        </div>
    );
}

import { Maximize01, Minimize01, Stars02, AlignBottom01, AlignCenter, AlignHorizontalCentre01, AlignLeft, AlignLeft01, AlignRight, AlignRight01, AlignTopArrow01, AlignVerticalCenter01, Bold01, ChevronDown, LinkExternal01, Link01, List, Lock01, Plus, Strikethrough01, Trash01, Type01 } from "@untitledui/icons";
import { type ReactNode, useState } from "react";
import { deleteSelection, toggleLock } from "../engine/actions";
import { viewport, worldToScreen } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";
import { hexToRgba, solid } from "../engine/paint";
import { runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { formatText, patchJam, patchNodes, rememberConnector, startEditing } from "./actions";
import { type Range, deleteTracks, expand, fitTracks, fillCells, hasMerge, insertTracks, mergeCells, pickedLines, pickedRange, styleCells, unmergeCells } from "./table";
import { CapGlyph, ConnectorGlyph, ShapeGlyph, WashiGlyph } from "./icons";
import { ADVANCED_SHAPES, CLOUD_SHAPES, BASIC_SHAPES, FLOWCHART_SHAPES, HIGHLIGHT_COLORS, INK_COLORS, JAM_FONTS, LIGHT_COLORS, SECTION_COLORS, SHAPE_COLORS, SHAPE_LABELS, STICKY_COLORS, TEXT_SIZES, WASHI_PATTERNS, edgeOf, shapePath, sizeLabel } from "./model";
import { board, useBoard } from "./state";
import { barCenter } from "./model";
import type { ConnectorCap, JamData, JamFont, ShapeKind } from "./types";
import { askText } from "../components/ask-text";
import { setSectionLockBg, toggleSectionHidden } from "./sections";
import { CODE_LANGUAGES } from "./code";
import { linkToText, openWebUrl, setLinkDisplay } from "./links";
import { generateIdeas, sortStickies, summarizeSelection } from "./ai";

// The dark bar that floats above the selection, with what that kind of board object can change:
// colour, type, size, bold, strikethrough, link, list and author for stickies; shape and fill for
// shapes; line, ends, colour and weight for connectors; colour and weight for marker strokes;
// colour for sections; rows and columns for tables.

function Pop({ label, trigger, children, wide, width, className }: { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; wide?: boolean; width?: string; className?: string }) {
    const [open, setOpen] = useState(false);
    // Opens upward, or downward when the bar sits near the top of the window.
    const [below, setBelow] = useState(false);
    return (
        <span className="relative flex">
            <button type="button" aria-label={label} title={label} aria-expanded={open} onClick={(e) => { setBelow(e.currentTarget.getBoundingClientRect().top < 320); setOpen(!open); }} className={className ?? "flex h-8 items-center gap-1 rounded-md px-1.5 hover:bg-white/10"}>
                {trigger}
                <ChevronDown className="size-3 opacity-70 mr-0.5" />
            </button>
            {open && (
                <div className={`absolute left-0 ${below ? "top-full mt-2" : "bottom-full mb-2"} ${width ?? (wide ? "w-64" : "w-max")} rounded-lg bg-[#2C2C2C] p-2 shadow-xl`} onPointerDown={(e) => e.stopPropagation()}>
                    {children(() => setOpen(false))}
                </div>
            )}
        </span>
    );
}

function Toggle({ label, active, onPress, children }: { label: string; active?: boolean; onPress: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onPress} className={`flex size-8 items-center justify-center rounded-md ${active ? "bg-white/20" : "hover:bg-white/10"}`}>
            {children}
        </button>
    );
}

function Colors({ colors, current, onPick, round = true, cols = 8, custom = false }: { colors: { name: string; color: string }[]; current: string | null; onPick: (c: string) => void; round?: boolean; cols?: number; custom?: boolean }) {
    return (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1.5rem)` }}>
            {colors.map((c) => (
                <button key={c.color} type="button" aria-label={c.name} title={c.name} onClick={() => onPick(c.color)} className={`size-6 ${round ? "rounded-full" : "rounded"} border border-white/20 ${current?.toUpperCase() === c.color ? "ring-2 ring-[#9747FF] ring-offset-1 ring-offset-[#2C2C2C]" : ""}`} style={{ background: c.color }} />
            ))}
            {custom && (
                <label title="Custom colour" className={`relative size-6 cursor-pointer ${round ? "rounded-full" : "rounded"} border border-white/20`} style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
                    <input type="color" aria-label="Custom colour" value={current ?? "#000000"} onChange={(e) => onPick(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                </label>
            )}
        </div>
    );
}

// A shape's fill: solid, see-through, or none (the outline stays).
type FillMode = "fill" | "transparent" | "none";
const fillOpacity = (n: SceneNode | undefined) => {
    const f = n?.fills.find((p) => p.type === "solid");
    return f ? f.opacity : 0;
};
const fillMode = (n: SceneNode | undefined): FillMode => (!fillOf(n) ? "none" : fillOpacity(n) < 0.9 ? "transparent" : "fill");
const baseColor = (n: SceneNode) => fillOf(n) ?? board.get().shapeColor;
const FILL_MODES: { mode: FillMode; label: string; apply: (n: SceneNode) => Partial<SceneNode> }[] = [
    { mode: "fill", label: "Fill", apply: (n) => ({ fills: [solid(baseColor(n), 1)] }) },
    { mode: "transparent", label: "Transparent", apply: (n) => ({ fills: [solid(baseColor(n), 0.35)] }) },
    { mode: "none", label: "No fill", apply: (n) => ({ fills: [], strokes: n.strokes.length ? n.strokes : [solid(edgeOf(baseColor(n)))] }) },
];

// A shape's outline: solid, dashed or none.
type OutlineMode = "solid" | "dashed" | "none";
const outlineMode = (n: SceneNode | undefined): OutlineMode => (!n?.strokes.length ? "none" : n.dash ? "dashed" : "solid");
const OUTLINES: { mode: OutlineMode; label: string; apply: (n: SceneNode) => Partial<SceneNode> }[] = [
    { mode: "solid", label: "Solid", apply: (n) => ({ strokes: n.strokes.length ? n.strokes : [solid(edgeOf(baseColor(n)))], dash: null }) },
    { mode: "dashed", label: "Dashed", apply: (n) => ({ strokes: n.strokes.length ? n.strokes : [solid(edgeOf(baseColor(n)))], dash: [8, 6] }) },
    { mode: "none", label: "None", apply: (n) => (n.fills.length ? { strokes: [], dash: null } : null) ?? {} },
];

const ALIGNS = [
    ["aLeft", AlignLeft01, "Align left"],
    ["aH", AlignHorizontalCentre01, "Align horizontal centers"],
    ["aRight", AlignRight01, "Align right"],
    ["aTop", AlignTopArrow01, "Align top"],
    ["aV", AlignVerticalCenter01, "Align vertical centers"],
    ["aBottom", AlignBottom01, "Align bottom"],
] as const;

const Sep = () => <span className="mx-0.5 h-5 w-px bg-white/15" />;

function fillOf(node: SceneNode | undefined): string | null {
    const f = node?.fills.find((p) => p.type === "solid");
    return f && f.type === "solid" ? f.color : null;
}

function strokeOf(node: SceneNode | undefined): string | null {
    const f = node?.strokes.find((p) => p.type === "solid");
    return f && f.type === "solid" ? f.color : null;
}

// `segments`: the sticky bar's layout, the font, size and formatting as full-height segments, with
// the numbered list, alignment and `extra` (the author switch) under the fonts in the Aa menu.
function TextControls({ ids, nodes, sticky, segments, extra }: { ids: string[]; nodes: SceneNode[]; sticky: boolean; segments?: boolean; extra?: ReactNode }) {
    const first = nodes[0];
    const font = (first?.jam && "font" in first.jam && first.jam.font) || "simple";
    const size = first?.fontSize ?? (sticky ? null : 16);
    const bold = (first?.fontWeight ?? 400) >= 600;
    const strike = first?.decoration === "strikethrough";
    const list = first?.list ?? null;
    const align = first?.textAlign ?? "left";
    const [custom, setCustom] = useState("");
    return (
        <>
            <Pop label="Font" className={segments ? `${segment} w-[64px]` : undefined} trigger={<span className={segments ? "text-[15px]" : "text-[13px] font-semibold"} style={{ fontFamily: JAM_FONTS[font as JamFont].family }}>Aa</span>}>
                {(close) => (
                    <div className="flex flex-col">
                        {(Object.keys(JAM_FONTS) as JamFont[]).map((f) => (
                            <button key={f} type="button" onClick={() => { patchNodes(ids, (n) => ({ fontFamily: JAM_FONTS[f].family, jam: n.jam?.kind === "sticky" || n.jam?.kind === "shape" || n.jam?.kind === "connector" ? { ...n.jam, font: f } : n.jam })); close(); }} className={`rounded px-2 py-1 text-left text-[13px] hover:bg-white/10 ${f === font ? "text-[#C9A7FF]" : ""}`} style={{ fontFamily: JAM_FONTS[f].family }}>
                                {JAM_FONTS[f].label}
                            </button>
                        ))}
                        {segments && (
                            <div className="mt-1 flex flex-col gap-1 border-t border-white/10 pt-1.5">
                                <div className="flex gap-0.5">
                                    {([["left", AlignLeft, "Align left"], ["center", AlignCenter, "Align center"], ["right", AlignRight, "Align right"]] as const).map(([a, Icon, label]) => (
                                        <Toggle key={a} label={label} active={align === a} onPress={() => patchNodes(ids, () => ({ textAlign: a }))}><Icon className="size-4" /></Toggle>
                                    ))}
                                    <Toggle label="Numbered list (⌘⇧7)" active={list === "number"} onPress={() => formatText(ids, "number")}><NumberedIcon /></Toggle>
                                </div>
                                {extra}
                            </div>
                        )}
                    </div>
                )}
            </Pop>
            {segments && <Divider />}
            <Pop label="Text size" className={segments ? `${segment} w-[151px] justify-between pl-3 pr-2.5` : undefined} trigger={<span className={segments ? "text-[12px]" : "w-16 truncate text-left text-[12px]"}>{sizeLabel(size)}</span>}>
                {(close) => (
                    <div className="flex w-36 flex-col">
                        {TEXT_SIZES.filter((t) => sticky || t.size !== null).map((t) => (
                            <button key={t.label} type="button" onClick={() => { patchNodes(ids, () => ({ fontSize: t.size ?? undefined })); close(); }} className={`flex justify-between rounded px-2 py-1 text-left text-[12px] hover:bg-white/10 ${t.size === size ? "text-[#C9A7FF]" : ""}`}>
                                {t.label}
                                <span className="opacity-50">{t.size ?? ""}</span>
                            </button>
                        ))}
                        <form
                            className="mt-1 border-t border-white/10 px-1 pt-1.5"
                            onSubmit={(e) => {
                                e.preventDefault();
                                const v = Math.round(Number(custom));
                                if (v >= 4 && v <= 1000) {
                                    patchNodes(ids, () => ({ fontSize: v }));
                                    setCustom("");
                                    close();
                                }
                            }}
                        >
                            <input aria-label="Custom size" inputMode="numeric" placeholder={size ? String(size) : "Custom"} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))} className="h-7 w-full rounded bg-white/10 px-2 text-[12px] text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-[#9747FF]" />
                        </form>
                    </div>
                )}
            </Pop>
            {segments && <Divider />}
            {segments && <span className="w-1" />}
            <Toggle label="Bold (⌘B)" active={bold} onPress={() => formatText(ids, "bold")}><Bold01 className="size-4" /></Toggle>
            <Toggle label="Strikethrough (⌘⇧X)" active={strike} onPress={() => formatText(ids, "strike")}><Strikethrough01 className="size-4" /></Toggle>
            <Toggle
                label="Link (⌘⇧U)"
                active={Boolean(first?.hyperlink)}
                onPress={async () => {
                    const url = await askText("Link", first?.hyperlink ?? "https://");
                    if (url === null) return;
                    patchNodes(ids, () => ({ hyperlink: url.trim() && url.trim() !== "https://" ? url.trim() : null }));
                }}
            >
                <Link01 className="size-4" />
            </Toggle>
            <Toggle label="Bulleted list (⌘⇧8)" active={list === "bullet"} onPress={() => formatText(ids, "bullet")}><List className="size-4" /></Toggle>
            {segments && <span className="w-1" />}
            {!segments && (
                <Toggle label="Numbered list (⌘⇧7)" active={list === "number"} onPress={() => formatText(ids, "number")}>
                    <NumberedIcon />
                </Toggle>
            )}
            {!segments && <Pop label="Alignment" trigger={align === "center" ? <AlignCenter className="size-4" /> : align === "right" ? <AlignRight className="size-4" /> : <AlignLeft className="size-4" />}>
                {(close) => (
                    <div className="flex gap-0.5">
                        {([["left", AlignLeft, "Align left"], ["center", AlignCenter, "Align center"], ["right", AlignRight, "Align right"]] as const).map(([a, Icon, label]) => (
                            <Toggle key={a} label={label} active={align === a} onPress={() => { patchNodes(ids, () => ({ textAlign: a })); close(); }}><Icon className="size-4" /></Toggle>
                        ))}
                    </div>
                )}
            </Pop>}
        </>
    );
}

const NumberedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2.5 2.5h1v3.5M2.2 6h2.3M2.3 9.6c.3-.6 2-.7 2 .3 0 .8-2.1 1.4-2.1 2.6h2.2M7 4h7M7 8h7M7 12h7" /></svg>
);

// The sticky and section bars' full-height segments and the rules between them.
const segment = "flex h-10 items-center gap-1.5 px-3 hover:bg-white/10";
const Divider = () => <span className="h-10 w-px shrink-0 bg-white/10" />;

const CAPS: { cap: ConnectorCap; label: string }[] = [
    { cap: "none", label: "None" },
    { cap: "arrow", label: "Arrow" },
    { cap: "line-arrow", label: "Line arrow" },
    { cap: "triangle", label: "Reversed triangle" },
    { cap: "diamond", label: "Diamond" },
    { cap: "circle", label: "Circle" },
    { cap: "erd-one", label: "One" },
    { cap: "erd-many", label: "Many" },
    { cap: "erd-only-one", label: "One and only one" },
    { cap: "erd-zero-or-one", label: "Zero or one" },
    { cap: "erd-one-or-many", label: "One or many" },
    { cap: "erd-zero-or-many", label: "Zero or many" },
];

// Corner radius presets for elbowed connectors.
const CORNERS = [0, 4, 12, 24, 48];

// A table's bar. With cells picked (or one being typed in): their fill, text colour, font, size,
// bold, strikethrough, alignment and link, merging, and for whole rows or columns, adding,
// deleting and fitting them. With the whole table: rows, columns and the colours of every cell.
function TableControls({ node }: { node: SceneNode }) {
    const editing = useBoard((s) => s.editing);
    useBoard((s) => s.tableSel);
    const jam = node.jam?.kind === "table" ? node.jam : null;
    if (!jam) return null;
    const cell = editing?.id === node.id ? editing.cell : undefined;
    const block: Range | null = pickedRange(node.id) ?? (cell ? expand(jam, { top: cell[0], left: cell[1], bottom: cell[0], right: cell[1] }) : null);
    const lines = pickedLines(node.id);
    const style = block ? (jam.styles?.[block.top]?.[block.left] ?? null) : (jam.styles?.[1]?.[0] ?? null);
    const fill = block ? (jam.fills?.[block.top]?.[block.left] ?? null) : null;
    const font = style?.font ?? "simple";
    const size = style?.size ?? node.fontSize ?? 14;
    const bold = style?.bold ?? false;
    const align = style?.align ?? "left";
    const btn = "flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] hover:bg-white/10";
    const many = block ? block.top !== block.bottom || block.left !== block.right : false;
    return (
        <>
            {lines ? (
                <>
                    <button type="button" onClick={() => insertTracks(node.id, lines.axis, Math.min(...lines.indexes))} className={btn}><Plus className="size-3.5" />{lines.axis === "row" ? "Above" : "Left"}</button>
                    <button type="button" onClick={() => insertTracks(node.id, lines.axis, Math.max(...lines.indexes) + 1)} className={btn}><Plus className="size-3.5" />{lines.axis === "row" ? "Below" : "Right"}</button>
                    <button type="button" onClick={() => fitTracks(node.id, lines.axis, lines.indexes)} className={btn}>Resize to fit</button>
                    <Toggle label={lines.axis === "row" ? "Delete row" : "Delete column"} onPress={() => deleteTracks(node.id, lines.axis, lines.indexes)}><Trash01 className="size-4" /></Toggle>
                    <Sep />
                </>
            ) : !block ? (
                <>
                    <button type="button" onClick={() => insertTracks(node.id, "row", jam.rows.length)} className={btn}><Plus className="size-3.5" /> Row</button>
                    <button type="button" onClick={() => insertTracks(node.id, "col", jam.cols.length)} className={btn}><Plus className="size-3.5" /> Column</button>
                    <Sep />
                </>
            ) : null}
            <Pop label={block ? "Cell colour" : "Table colour"} width="w-max" trigger={<span className="size-5 rounded border border-white/30" style={{ background: fill ?? "#FFFFFF" }} />}>
                {(close) => (
                    <div className="flex flex-col gap-2">
                        <Colors cols={11} round={false} custom colors={LIGHT_COLORS} current={fill} onPick={(c) => { fillCells(node.id, block, c === "#FFFFFF" ? null : c); if (LIGHT_COLORS.some((k) => k.color === c)) close(); }} />
                        <span className="text-[11px] text-white/60">{block ? "Colours the picked cells." : "Colours every cell; click a cell (or drag across cells) to colour just those."}</span>
                    </div>
                )}
            </Pop>
            <Pop label="Text colour" trigger={<span className="flex size-5 items-center justify-center text-[13px] font-semibold" style={{ color: style?.color ?? "#FFFFFF", textShadow: "0 0 1px #000" }}>A</span>}>
                {(close) => <Colors custom cols={6} colors={INK_COLORS} current={style?.color ?? null} onPick={(c) => { styleCells(node.id, block, { color: c }); if (INK_COLORS.some((k) => k.color === c)) close(); }} />}
            </Pop>
            <Sep />
            <Pop label="Font" trigger={<span className="text-[13px] font-semibold" style={{ fontFamily: JAM_FONTS[font].family }}>Aa</span>}>
                {(close) => (
                    <div className="flex flex-col">
                        {(Object.keys(JAM_FONTS) as JamFont[]).map((f) => (
                            <button key={f} type="button" onClick={() => { styleCells(node.id, block, { font: f }); close(); }} className={`rounded px-2 py-1 text-left text-[13px] hover:bg-white/10 ${f === font ? "text-[#C9A7FF]" : ""}`} style={{ fontFamily: JAM_FONTS[f].family }}>{JAM_FONTS[f].label}</button>
                        ))}
                    </div>
                )}
            </Pop>
            <Pop label="Text size" trigger={<span className="w-8 text-left text-[12px] tabular-nums">{size}</span>}>
                {(close) => (
                    <div className="flex w-32 flex-col">
                        {[12, 14, 16, 24, 40].map((v) => (
                            <button key={v} type="button" onClick={() => { if (block) styleCells(node.id, block, { size: v }); else patchNodes([node.id], () => ({ fontSize: v })); close(); }} className={`rounded px-2 py-1 text-left text-[12px] hover:bg-white/10 ${size === v ? "text-[#C9A7FF]" : ""}`}>{v}</button>
                        ))}
                    </div>
                )}
            </Pop>
            <Toggle label="Bold (⌘B)" active={bold} onPress={() => styleCells(node.id, block, { bold: !bold })}><Bold01 className="size-4" /></Toggle>
            <Toggle label="Strikethrough (⌘⇧X)" active={Boolean(style?.strike)} onPress={() => styleCells(node.id, block, { strike: !style?.strike || undefined })}><Strikethrough01 className="size-4" /></Toggle>
            <Pop label="Alignment" trigger={align === "center" ? <AlignCenter className="size-4" /> : align === "right" ? <AlignRight className="size-4" /> : <AlignLeft className="size-4" />}>
                {(close) => (
                    <div className="flex gap-0.5">
                        {([["left", AlignLeft, "Align left"], ["center", AlignCenter, "Align center"], ["right", AlignRight, "Align right"]] as const).map(([a, Icon, label]) => (
                            <Toggle key={a} label={label} active={align === a} onPress={() => { styleCells(node.id, block, { align: a === "left" ? undefined : a }); close(); }}><Icon className="size-4" /></Toggle>
                        ))}
                    </div>
                )}
            </Pop>
            {block && (
                <Toggle
                    label="Link (⌘⇧U)"
                    active={Boolean(style?.link)}
                    onPress={async () => {
                        const url = await askText("Link", style?.link ?? "https://");
                        if (url === null) return;
                        styleCells(node.id, block, { link: url.trim() && url.trim() !== "https://" ? url.trim() : undefined });
                    }}
                >
                    <Link01 className="size-4" />
                </Toggle>
            )}
            {block && hasMerge(jam, block) ? (
                <>
                    <Sep />
                    <button type="button" onClick={() => unmergeCells(node.id, block)} className={btn}>Unmerge</button>
                </>
            ) : block && many ? (
                <>
                    <Sep />
                    <button type="button" onClick={() => mergeCells(node.id, block)} className={btn}>Merge</button>
                </>
            ) : null}
        </>
    );
}

export function ContextBar() {
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const camera = useEditor((s) => s.camera);
    const tool = useBoard((s) => s.tool);
    const textEditing = useEditor((s) => s.editingTextId);
    const readOnly = useEditor((s) => s.readOnly);
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length || tool || readOnly || textEditing) return null;
    const box = selectionBounds(doc, selection);
    if (!box) return null;
    const kinds = new Set(nodes.map((n) => (n.isSection ? "section" : n.type === "text" ? "text" : (n.jam?.kind ?? "other"))));
    const kind = kinds.size === 1 ? [...kinds][0] : "mixed";
    const ids = nodes.map((n) => n.id);
    const first = nodes[0];
    const top = worldToScreen(camera, box.x + box.w / 2, box.y);
    const bottom = worldToScreen(camera, box.x, box.y + box.h).y;
    const above = top.y > 126;
    let content: ReactNode = null;

    if (kind === "sticky") {
        const jam = first?.jam?.kind === "sticky" ? first.jam : null;
        // 460 wide: colour │ Aa │ size │ B, S, link, bullets │ AI. Numbered lists, alignment and the
        // author switch are in the Aa menu; lock and delete in the right-click menu (⌘⇧L, ⌫).
        content = (
            <>
                <Pop label="Colour" wide className={`${segment} w-[61px] rounded-l-[11px] pl-3 pr-2`} trigger={<span className="size-[18px] rounded-full" style={{ background: fillOf(first) ?? "#fff" }} />}>
                    {(close) => <Colors cols={5} round={false} colors={STICKY_COLORS} current={fillOf(first)} onPick={(c) => { patchNodes(ids, () => ({ fills: [solid(c)] })); board.set({ stickyColor: c }); close(); }} />}
                </Pop>
                <Divider />
                <TextControls
                    ids={ids}
                    nodes={nodes}
                    sticky
                    segments
                    extra={
                        <button type="button" role="switch" aria-checked={jam?.showAuthor !== false} aria-label="Show author" title="Show author" onClick={() => patchJam(ids, (j) => (j.kind === "sticky" ? { jam: { ...j, showAuthor: j.showAuthor === false } } : null))} className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[11px] hover:bg-white/10">
                            <span className={`flex h-4 w-7 items-center rounded-full p-0.5 ${jam?.showAuthor !== false ? "justify-end bg-[#9747FF]" : "bg-white/25"}`}><span className="size-3 rounded-full bg-white" /></span>
                            Show author
                        </button>
                    }
                />
            </>
        );
    } else if (kind === "shape") {
        const shape = first?.jam?.kind === "shape" ? first.jam.shape : "square";
        content = (
            <>
                <Pop label="Shape" wide trigger={<ShapeGlyph shape={shape} stroke="#fff" />}>
                    {(close) => (
                        <div className="grid grid-cols-7 gap-1">
                            {[...BASIC_SHAPES, ...FLOWCHART_SHAPES, ...ADVANCED_SHAPES, ...CLOUD_SHAPES].map((k: ShapeKind) => (
                                <button key={k} type="button" aria-label={SHAPE_LABELS[k]} title={SHAPE_LABELS[k]} onClick={() => { patchNodes(ids, (n) => (n.jam?.kind === "shape" ? { jam: { ...n.jam, shape: k }, path: shapePath(k, n.w, n.h), name: SHAPE_LABELS[k] } : null)); close(); }} className={`flex size-8 items-center justify-center rounded ${k === shape ? "bg-white/20" : "hover:bg-white/10"}`}>
                                    <ShapeGlyph shape={k} stroke="#fff" />
                                </button>
                            ))}
                        </div>
                    )}
                </Pop>
                <Pop label="Fill" width="w-[350px]" trigger={<span className="size-5 rounded-full border border-white/30" style={{ background: fillOf(first) ? hexToRgba(fillOf(first) ?? "#FFFFFF", fillOpacity(first)) : "repeating-linear-gradient(135deg, #fff 0 3px, #f24822 3px 4.5px)" }} />}>
                    {() => (
                        <div className="flex flex-col gap-2">
                            <Colors cols={11} custom colors={SHAPE_COLORS} current={fillOf(first)} onPick={(c) => { patchNodes(ids, (n) => ({ fills: [solid(c, fillOpacity(n) || 1)], strokes: n.strokes.length ? [solid(edgeOf(c))] : [] })); board.set({ shapeColor: c }); }} />
                            <div className="flex gap-1">
                                {FILL_MODES.map((m) => (
                                    <button key={m.mode} type="button" aria-pressed={fillMode(first) === m.mode} onClick={() => patchNodes(ids, (n) => m.apply(n))} className={`h-7 flex-1 rounded text-[11px] ${fillMode(first) === m.mode ? "bg-white/20" : "hover:bg-white/10"}`}>{m.label}</button>
                                ))}
                            </div>
                            <div className="flex gap-1">
                                {OUTLINES.map((o) => (
                                    <button key={o.mode} type="button" aria-label={`${o.label} outline`} title={`${o.label} outline`} aria-pressed={outlineMode(first) === o.mode} onClick={() => patchNodes(ids, (n) => o.apply(n))} className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[11px] ${outlineMode(first) === o.mode ? "bg-white/20" : "hover:bg-white/10"}`}>
                                        <span className={`block w-4 ${o.mode === "none" ? "" : o.mode === "dashed" ? "border-t-2 border-dashed border-white" : "border-t-2 border-white"}`} />
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </Pop>
                <Sep />
                <TextControls ids={ids} nodes={nodes} sticky={false} />
            </>
        );
    } else if (kind === "connector") {
        const jam = first?.jam?.kind === "connector" ? first.jam : null;
        const color = strokeOf(first) ?? "#1E1E1E";
        const thick = (first?.strokeWidth ?? 2) > 3;
        // Each change is remembered for the next connector.
        const remember = () => rememberConnector(editor.get().doc.nodes[ids[0] ?? ""]);
        const setJam = (patch: Partial<Extract<JamData, { kind: "connector" }>>) => {
            patchJam(ids, (j) => (j.kind === "connector" ? { jam: { ...j, ...patch } } : null));
            remember();
        };
        content = (
            <>
                {(["elbow", "curved", "straight"] as const).map((line) => (
                    <Toggle key={line} label={line === "elbow" ? "Elbowed" : line === "curved" ? "Curved" : "Straight"} active={jam?.line === line} onPress={() => { setJam({ line, coords: undefined, axis: undefined, mid: undefined, bend: undefined }); board.set({ connectorLine: line }); }}>
                        <ConnectorGlyph line={line} />
                    </Toggle>
                ))}
                <Sep />
                <Pop label="Colour" trigger={<span className="size-5 rounded-full border border-white/30" style={{ background: color }} />}>
                    {(close) => (
                        <div className="flex flex-col gap-2">
                            <Colors cols={6} custom colors={INK_COLORS} current={color} onPick={(c) => { patchNodes(ids, () => ({ strokes: [solid(c)] })); remember(); close(); }} />
                            <button type="button" role="switch" aria-checked={Boolean(jam?.labelBg)} onClick={() => setJam({ labelBg: !jam?.labelBg })} className="flex items-center justify-between gap-3 rounded px-1 py-1 text-[11px] hover:bg-white/10">
                                Text background
                                <span className={`flex h-4 w-7 items-center rounded-full p-0.5 ${jam?.labelBg ? "justify-end bg-[#9747FF]" : "bg-white/25"}`}><span className="size-3 rounded-full bg-white" /></span>
                            </button>
                        </div>
                    )}
                </Pop>
                <Toggle label={thick ? "Thin" : "Thick"} active={thick} onPress={() => { patchNodes(ids, () => ({ strokeWidth: thick ? 2 : 5 })); remember(); }}>
                    <span className="block w-4 rounded-full bg-white" style={{ height: thick ? 4 : 2 }} />
                </Toggle>
                <Toggle label="Dashed" active={jam?.dashed} onPress={() => setJam({ dashed: !jam?.dashed })}>
                    <span className="block w-4 border-t-2 border-dashed border-white" />
                </Toggle>
                <Sep />
                {(["startCap", "endCap"] as const).map((which) => (
                    <Pop key={which} label={which === "startCap" ? "Start point" : "End point"} trigger={<span className={`flex ${which === "startCap" ? "-scale-x-100" : ""}`}><CapGlyph cap={jam?.[which] ?? "none"} /></span>}>
                        {(close) => (
                            <div className="flex w-48 flex-col">
                                {CAPS.map((c, i) => (
                                    <button key={c.cap} type="button" onClick={() => { setJam({ [which]: c.cap }); close(); }} className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-white/10 ${i === 6 ? "mt-1 border-t border-white/10 pt-1.5" : ""} ${jam?.[which] === c.cap ? "text-[#C9A7FF]" : ""}`}>
                                        <span className={`flex ${which === "startCap" ? "-scale-x-100" : ""}`}><CapGlyph cap={c.cap} /></span>
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Pop>
                ))}
                {jam?.line === "elbow" && (
                    <Pop label="Corner radius" trigger={<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 13 V8 Q3 3 8 3 H13" /></svg>}>
                        {() => (
                            <div className="flex w-52 flex-col gap-2 p-1">
                                <span className="text-[11px] text-white/60">Corner radius</span>
                                <div className="flex items-center gap-2">
                                    <input type="range" aria-label="Corner radius" min={0} max={48} value={jam.radius ?? 12} onChange={(e) => setJam({ radius: Number(e.target.value) })} className="flex-1 accent-[#9747FF]" />
                                    <span className="w-6 text-right text-[12px] tabular-nums">{jam.radius ?? 12}</span>
                                </div>
                                <div className="flex gap-1">
                                    {CORNERS.map((r) => (
                                        <button key={r} type="button" aria-pressed={(jam.radius ?? 12) === r} onClick={() => setJam({ radius: r })} className={`h-6 flex-1 rounded text-[11px] ${(jam.radius ?? 12) === r ? "bg-white/20" : "hover:bg-white/10"}`}>{r}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Pop>
                )}
                <Sep />
                <Toggle label="Add text" onPress={() => first && startEditing(first.id)}><Type01 className="size-4" /></Toggle>
            </>
        );
    } else if (kind === "draw") {
        const color = strokeOf(first) ?? "#1E1E1E";
        const highlighter = first?.jam?.kind === "draw" && first.jam.tool === "highlighter";
        const thick = (first?.strokeWidth ?? 4) > (highlighter ? 20 : 6);
        content = (
            <>
                <Colors custom colors={highlighter ? HIGHLIGHT_COLORS : INK_COLORS} cols={highlighter ? 9 : 13} current={color} onPick={(c) => patchNodes(ids, (n) => ({ strokes: [solid(c, n.strokes[0]?.opacity ?? 1)] }))} />
                <Sep />
                <Toggle label="Thin" active={!thick} onPress={() => patchNodes(ids, (n) => ({ strokeWidth: n.jam?.kind === "draw" && n.jam.tool === "highlighter" ? 12 : 4 }))}><span className="block h-0.5 w-4 rounded-full bg-white" /></Toggle>
                <Toggle label="Thick" active={thick} onPress={() => patchNodes(ids, (n) => ({ strokeWidth: n.jam?.kind === "draw" && n.jam.tool === "highlighter" ? 28 : 12 }))}><span className="block h-1.5 w-4 rounded-full bg-white" /></Toggle>
            </>
        );
    } else if (kind === "washi") {
        content = (
            <>
                {WASHI_PATTERNS.map((w) => (
                    <Toggle key={w.pattern} label={w.label} active={first?.jam?.kind === "washi" && first.jam.pattern === w.pattern} onPress={() => patchJam(ids, (j) => (j.kind === "washi" ? { jam: { ...j, pattern: w.pattern, color: w.color }, fills: [solid(w.color, 0.85)] } : null))}>
                        <WashiGlyph color={w.color} />
                    </Toggle>
                ))}
            </>
        );
    } else if (kind === "section") {
        // 276 wide: colour │ sort │ Organize. Rename, templates, hiding, locking and deleting are in
        // the Organize menu.
        const sec = first;
        const hidden = sec?.jam?.kind === "section" && sec.jam.hidden;
        const lockBg = sec?.jam?.kind === "section" && sec.jam.lockBg;
        const children = () => (sec ? sec.children.filter((id) => doc.nodes[id]) : []);
        const onChildren = (run: () => void) => {
            const kids = children();
            if (!kids.length) return editor.notify("This section is empty.");
            editor.set({ selection: kids });
            run();
        };
        const item = "flex h-7 items-center rounded px-2 text-left text-[12px] hover:bg-[#9747FF]";
        content = (
            <>
                <Pop label="Section colour" wide className={`${segment} w-[61px] rounded-l-[11px] pl-3 pr-2`} trigger={<span className="size-[18px] rounded-full border border-white/30" style={{ background: fillOf(first) ?? "#F2F2F2" }} />}>
                    {(close) => <Colors cols={5} round={false} colors={SECTION_COLORS} current={fillOf(first)} onPick={(c) => { patchNodes(ids, () => ({ fills: [solid(c)] })); close(); }} />}
                </Pop>
                <Divider />
                <Pop label="Sort" className={`${segment} w-[59px]`} trigger={<AlignLeft className="size-4" />}>
                    {(close) => (
                        <div className="flex w-44 flex-col">
                            <button type="button" onClick={() => { close(); onChildren(() => runAction("tidy")); }} className={item}>Tidy up</button>
                            <button type="button" onClick={() => { close(); onChildren(() => void sortStickies()); }} className={item}>Sort stickies by topic</button>
                        </div>
                    )}
                </Pop>
                <Divider />
                <Pop label="Organize" className={`${segment} w-[153px] rounded-r-[11px] pr-2.5`} trigger={<span className="flex items-center gap-2 text-[12px]"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>Organize<span className="rounded-[4px] bg-[#9747FF] px-1 text-[11px] leading-4">New</span></span>}>
                    {(close) => (
                        <div className="flex w-52 flex-col">
                            <button type="button" onClick={() => { close(); onChildren(() => void summarizeSelection()); }} className={item}>Summarize stickies</button>
                            {sec && <button type="button" onClick={() => { close(); board.set({ templatesOpen: true, templatesInto: sec.id }); }} className={item}>Fill with a template…</button>}
                            <span className="my-1 h-px bg-white/10" />
                            {sec && <button type="button" onClick={() => { close(); board.set({ renamingSection: sec.id }); }} className={item}>Rename</button>}
                            {sec && <button type="button" onClick={() => { close(); toggleSectionHidden(sec.id); }} className={item}>{hidden ? "Show contents" : "Hide contents"}</button>}
                            <button type="button" onClick={() => { close(); toggleLock(); }} className={item}>Lock all</button>
                            {sec && <button type="button" onClick={() => { close(); setSectionLockBg(sec.id, !lockBg); }} className={item}>{lockBg ? "Unlock background" : "Lock background only"}</button>}
                            <span className="my-1 h-px bg-white/10" />
                            <button type="button" onClick={() => { close(); deleteSelection(); }} className={item}>Delete</button>
                        </div>
                    )}
                </Pop>
            </>
        );
    } else if (kind === "table" && first?.jam?.kind === "table") {
        content = <TableControls node={first} />;
    } else if (kind === "link" && first?.jam?.kind === "link") {
        const jam = first.jam;
        const url = jam.url;
        const display = jam.display ?? "horizontal";
        content = (
            <>
                {jam.embed && display !== "minimized" ? (
                    <>
                        <button type="button" onClick={() => board.set({ embedMax: first.id })} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] hover:bg-white/10"><Maximize01 className="size-4" />Maximize</button>
                        <button type="button" onClick={() => setLinkDisplay(first.id, "minimized")} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] hover:bg-white/10"><Minimize01 className="size-4" />Minimize</button>
                    </>
                ) : (
                    <Pop label="Display" trigger={<span className="text-[12px]">{display === "vertical" ? "Vertical" : display === "minimized" ? "Minimized" : "Horizontal"}</span>}>
                        {(close) => (
                            <div className="flex w-36 flex-col">
                                {(jam.embed ? (["horizontal", "minimized"] as const) : (["horizontal", "vertical", "minimized"] as const)).map((d) => (
                                    <button key={d} type="button" onClick={() => { setLinkDisplay(first.id, d); close(); }} className={`rounded px-2 py-1 text-left text-[12px] hover:bg-white/10 ${display === d ? "text-[#C9A7FF]" : ""}`}>
                                        {d === "horizontal" ? (jam.embed ? "Expanded" : "Horizontal") : d === "vertical" ? "Vertical" : "Minimized"}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Pop>
                )}
                <Sep />
                <button type="button" onClick={() => openWebUrl(url)} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] hover:bg-white/10"><LinkExternal01 className="size-4" />Open link</button>
                <Toggle label="Copy link" onPress={() => { void navigator.clipboard?.writeText(url); editor.notify("Link copied"); }}><Link01 className="size-4" /></Toggle>
                <button type="button" onClick={() => linkToText(first.id)} className="flex h-8 items-center whitespace-nowrap rounded-md px-2 text-[12px] hover:bg-white/10">Change back to text</button>
            </>
        );
    } else if (kind === "code" && first?.jam?.kind === "code") {
        const lang = first.jam.lang;
        content = (
            <Pop label="Language" trigger={<span className="text-[12px]">{lang}</span>}>
                {(close) => (
                    <div className="grid w-64 grid-cols-2">
                        {CODE_LANGUAGES.map((l) => (
                            <button key={l} type="button" onClick={() => { patchJam(ids, (j) => (j.kind === "code" ? { jam: { ...j, lang: l } } : null)); close(); }} className={`rounded px-2 py-1 text-left text-[12px] hover:bg-white/10 ${l === lang ? "text-[#C9A7FF]" : ""}`}>{l}</button>
                        ))}
                    </div>
                )}
            </Pop>
        );
    } else if (kind === "text") {
        content = (
            <>
                <Pop label="Text colour" wide trigger={<span className="size-5 rounded-full border border-white/30" style={{ background: fillOf(first) ?? "#1E1E1E" }} />}>
                    {(close) => <Colors custom cols={6} colors={INK_COLORS} current={fillOf(first)} onPick={(c) => { patchNodes(ids, () => ({ fills: [solid(c)] })); if (INK_COLORS.some((k) => k.color === c)) close(); }} />}
                </Pop>
                <Sep />
                <TextControls ids={ids} nodes={nodes} sticky={false} />
            </>
        );
    }

    const place = { left: Math.max(260, Math.min(top.x, viewport.width - 260)), top: above ? top.y - 76 : bottom + 32 };
    // The bars differ in width (a table's grows past 700px when tracks are picked), so each is kept
    // inside the canvas by its measured width, again whenever its contents change size.
    const keepInside = (el: HTMLDivElement | null) => {
        if (!el) return;
        const fit = () => {
            const room = (el.offsetParent as HTMLElement | null)?.clientWidth || viewport.width;
            if (room) el.style.left = `${barCenter(top.x, el.offsetWidth, room)}px`;
        };
        fit();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        return () => observer.disconnect();
    };
    // Locked objects show only a closed lock (click it to unlock).
    if (nodes.every((n) => n.locked)) {
        return (
            <div ref={keepInside} className="pointer-events-auto absolute z-10 flex -translate-x-1/2 items-center rounded-xl bg-[#1E1E1E] p-1 text-white shadow-[0_4px_16px_rgba(0,0,0,0.3)]" style={place} role="toolbar" aria-label="Selection" onPointerDown={(e) => e.stopPropagation()}>
                <Toggle label="Unlock" active onPress={toggleLock}><Lock01 className="size-4" /></Toggle>
            </div>
        );
    }
    // The sticky and section bars are segmented: 40 high, full-height rules, no lock or delete.
    const segmented = (kind === "sticky" || kind === "section") && nodes.length === 1 || kind === "sticky";
    return (
        <div
            ref={keepInside}
            className={`pointer-events-auto absolute z-10 flex -translate-x-1/2 items-center rounded-[13px] bg-[#1E1E1E] text-white shadow-[0_4px_16px_rgba(0,0,0,0.3)] ${segmented ? "h-10 overflow-visible px-0" : "gap-0.5 px-1.5 py-1"}`}
            style={place}
            role="toolbar"
            aria-label="Selection"
            onPointerDown={(e) => e.stopPropagation()}
        >
            {nodes.length > 1 && (
                <>
                    <Pop label="Align and arrange" trigger={<AlignLeft01 className="size-4" />}>
                        {(close) => (
                            <div className="flex flex-col gap-1">
                                <div className="flex gap-0.5">
                                    {ALIGNS.map(([id, Icon, label]) => (
                                        <Toggle key={id} label={label} onPress={() => runAction(id)}><Icon className="size-4" /></Toggle>
                                    ))}
                                </div>
                                <div className="flex flex-col border-t border-white/10 pt-1">
                                    {([["distH", "Distribute horizontally"], ["distV", "Distribute vertically"], ["tidy", "Tidy up"]] as const).map(([id, label]) => (
                                        <button key={id} type="button" onClick={() => { runAction(id); close(); }} className="rounded px-2 py-1 text-left text-[12px] hover:bg-white/10">{label}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Pop>
                    <Sep />
                </>
            )}
            {content}
            {kind === "sticky" && <Divider />}
            {kind === "sticky" && (
                <span className="flex h-10 w-[43px] items-center pl-1">
                    <Pop label="AI" className="flex size-8 items-center justify-center rounded-[5px] bg-[#9747FF] hover:bg-[#8638E5]" trigger={<Stars02 className="size-4" />}>
                        {(close) => (
                            <div className="flex w-44 flex-col">
                                {nodes.length > 1 && <button type="button" onClick={() => { close(); void sortStickies(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Sort stickies</button>}
                                <button type="button" onClick={() => { close(); void summarizeSelection(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Summarize</button>
                                {nodes.length === 1 && <button type="button" onClick={() => { close(); void generateIdeas(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Generate ideas</button>}
                            </div>
                        )}
                    </Pop>
                </span>
            )}
            {content && !segmented && <Sep />}
            {(kind === "shape" || kind === "mixed") && (
                <Pop label="AI" trigger={<Stars02 className="size-4" />}>
                    {(close) => (
                        <div className="flex w-44 flex-col">
                            {nodes.length > 1 && <button type="button" onClick={() => { close(); void sortStickies(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Sort stickies</button>}
                            <button type="button" onClick={() => { close(); void summarizeSelection(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Summarize</button>
                            {nodes.length === 1 && <button type="button" onClick={() => { close(); void generateIdeas(); }} className="rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/10">Generate ideas</button>}
                        </div>
                    )}
                </Pop>
            )}
            {!segmented && <Toggle label="Lock" onPress={toggleLock}><Lock01 className="size-4" /></Toggle>}
            {!segmented && <Toggle label="Delete" onPress={deleteSelection}><Trash01 className="size-4" /></Toggle>}
        </div>
    );
}

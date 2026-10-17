import { ChevronDown, Columns01, LayoutGrid01, Rows01, Square } from "@untitledui/icons";
import { useState } from "react";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Separator as AriaSeparator,
} from "react-aria-components";
import { addAutoLayout, removeAutoLayout } from "../engine/actions";
import { isFrameLike } from "../engine/components";
import { editor, useEditor } from "../engine/store";
import type { AutoLayout, Command, GridTrack, NagmaDocument, SceneNode, Sizing } from "../engine/types";
import { placeChildren } from "../engine/grid-layout";
import { MenuRow } from "./left-sidebar";
import { NumberField } from "./number-field";
import { shared, updateAll, useNumberField } from "./panel-fields";
import { Bindable } from "./variable-picker";
import { ROW } from "./panel-section";
import { Select } from "./select";

// The auto layout part of the Layout section, laid out: flow buttons (freeform,
// vertical, horizontal, wrap, grid), the alignment box (with keyboard control), the gap with its
// Auto options, padding that expands to four sides, and the "…" settings. Width and height get a
// sizing menu (fixed, hug, fill, min and max).

const NEW_LAYOUT: AutoLayout = { direction: "horizontal", gap: 10, padding: [10, 10, 10, 10], primary: "start", counter: "start" };

type Flow = "none" | "vertical" | "horizontal" | "wrap" | "grid";

function flowOf(node: SceneNode): Flow {
    const l = node.layout;
    if (!l) return "none";
    if (l.grid) return "grid";
    if (l.wrap) return "wrap";
    return l.direction;
}

function selectedFrames(): SceneNode[] {
    const { doc, selection } = editor.get();
    return selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
}

// Sets the selected frames' flow (adding auto layout to frames without it) as one undo step.
export function chooseFlow(frames: SceneNode[], next: Flow) {
    if (next === "none") return removeAutoLayout();
    const mark = editor.get().past.at(-1);
    if (frames.every((node) => !node.layout)) addAutoLayout();
    const targets = selectedFrames();
    updateAll(targets, (node) => {
        const base = node.layout ?? NEW_LAYOUT;
        if (next === "grid") return { layout: { ...base, grid: base.grid ?? { columns: 2, rows: null, columnGap: 10, rowGap: 10 } } };
        // Wrap keeps the stack horizontal (the reference's wrap flows left to right, then down).
        if (next === "wrap") return { layout: { ...base, direction: "horizontal", wrap: true, grid: null, counterGap: base.counterGap ?? base.gap }, sizing: { ...node.sizing, h: node.sizing.h === "hug" ? "fixed" : node.sizing.h } };
        return { layout: { ...base, direction: next, wrap: false, grid: null, counter: next === "vertical" && base.counter === "baseline" ? "start" : base.counter } };
    });
    // Adding auto layout (which may put the layers in order) and picking its flow undo together.
    const past = editor.get().past;
    const from = mark ? past.lastIndexOf(mark) : -1;
    if (!mark || from >= 0) for (let made = past.length - 1 - from; made > 1; made--) editor.mergeLast();
}

export function FlowButtons({ frames }: { frames: SceneNode[] }) {
    const flow = shared(frames, flowOf);
    // Freeform on a layer without auto layout (a group, a plain frame) is already the case.
    const choose = (next: Flow) => (next === "none" && frames.every((n) => !n.layout) ? undefined : chooseFlow(frames, next));
    // Wrap is a setting of the horizontal flow (a toggle beside the direction), not a flow of its own.
    const direction: Flow | null = flow === "wrap" ? "horizontal" : flow;
    const wrapped = flow === "wrap";
    const modes: { id: Flow; label: string; shortcut?: string; icon: React.ReactNode }[] = [
        { id: "none", label: "Freeform", icon: <Square className="size-3.5" /> },
        { id: "vertical", label: "Vertical layout", shortcut: "⇧ A", icon: <Rows01 className="size-3.5" /> },
        { id: "horizontal", label: "Horizontal layout", shortcut: "⇧ A", icon: <Columns01 className="size-3.5" /> },
        { id: "grid", label: "Grid", icon: <LayoutGrid01 className="size-3.5" /> },
    ];
    const laidOut = frames.every((node) => node.layout);
    return (
        <div className={ROW}>
            <div className="col-span-2 grid h-6 grid-cols-4 rounded-md bg-field" role="radiogroup" aria-label="Layout flow">
                {modes.map(({ id, label, shortcut, icon }) => (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        title={shortcut ? `${label} (${shortcut})` : label}
                        aria-label={label}
                        aria-checked={direction === id}
                        onClick={() => choose(id === "horizontal" && wrapped ? "wrap" : id)}
                        className={`flex h-6 items-center justify-center rounded-md border ${direction === id ? "border-panel-border bg-panel text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                    >
                        {icon}
                    </button>
                ))}
            </div>
            {laidOut ? (
                <button
                    type="button"
                    title="Wrap"
                    aria-label="Wrap"
                    aria-pressed={wrapped}
                    disabled={direction !== "horizontal"}
                    onClick={() => choose(wrapped ? "horizontal" : "wrap")}
                    className={`flex size-6 shrink-0 items-center justify-center rounded-md disabled:opacity-30 ${wrapped ? "bg-brand-100 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}
                >
                    <WrapIcon />
                </button>
            ) : (
                <span />
            )}
        </div>
    );
}

function SlidersIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 2.5v11M11 2.5v11" />
            <circle cx="5" cy="10" r="1.6" fill="var(--color-panel)" />
            <circle cx="11" cy="6" r="1.6" fill="var(--color-panel)" />
        </svg>
    );
}

function WrapIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 4h9a2.5 2.5 0 0 1 0 5H5" />
            <path d="M7 7 5 9l2 2" />
            <path d="M2.5 12.5h4" />
        </svg>
    );
}

const ALIGN = ["start", "center", "end"] as const;
const AUTO_LABELS: Record<"between" | "around" | "evenly", string> = { between: "Space between", around: "Space around", evenly: "Space evenly" };

function isAuto(l: AutoLayout): l is AutoLayout & { primary: "between" | "around" | "evenly" } {
    return l.primary === "between" || l.primary === "around" || l.primary === "evenly";
}

const layoutWrite =
    (pick: (layout: AutoLayout, value: number) => Partial<AutoLayout>) =>
    (_doc: NagmaDocument, node: SceneNode, value: number): Command[] =>
        node.layout ? [{ type: "node.update", id: node.id, patch: { layout: { ...node.layout, ...pick(node.layout, value) } } }] : [];

export function AutoLayoutControls({ frames }: { frames: SceneNode[] }) {
    const first = frames[0]?.layout;
    const [individual, setIndividual] = useState(() => Boolean(first && (first.padding[0] !== first.padding[2] || first.padding[1] !== first.padding[3])));
    const [uniform, setUniform] = useState(false);
    const gap = useNumberField(frames, (n) => n.layout?.gap ?? 0, layoutWrite((_l, v) => ({ gap: v })));
    const rowGap = useNumberField(frames, (n) => n.layout?.counterGap ?? n.layout?.gap ?? 0, layoutWrite((_l, v) => ({ counterGap: v })));
    const usePad = (sides: number[]) =>
        useNumberField(
            frames,
            (n) => n.layout?.padding[sides[0] ?? 0] ?? 0,
            layoutWrite((l, v) => {
                const p = [...l.padding] as AutoLayout["padding"];
                for (const s of uniform ? [0, 1, 2, 3] : sides) p[s] = Math.max(0, v);
                return { padding: p };
            }),
        );
    const padX = usePad([1, 3]);
    const padY = usePad([0, 2]);
    const padT = usePad([0]);
    const padR = usePad([1]);
    const padB = usePad([2]);
    const padL = usePad([3]);
    if (!first) return null;
    const vertical = first.direction === "vertical";
    const grid = Boolean(first.grid);
    const auto = isAuto(first);
    const setLayout = (patch: Partial<AutoLayout>) => updateAll(frames, (node) => ({ layout: node.layout ? { ...node.layout, ...patch } : null }));
    // Padding shorthand like CSS: "8", "8, 16", "8, 16, 4" or "8, 16, 4, 12" (top, right, bottom, left).
    const shorthand = (text: string) => {
        const parts = text.split(/[,\s]+/).filter(Boolean).map(Number);
        if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return false;
        const [a = 0, b = a, c = a, d = b] = parts;
        setLayout({ padding: [a, b, c, d].map((n) => Math.max(0, n)) as AutoLayout["padding"] });
        if (a !== c || b !== d) setIndividual(true);
        return true;
    };
    const padProps = { onText: shorthand, onModClick: () => setUniform(true) };
    const xSymmetric = frames.every((n) => n.layout && n.layout.padding[1] === n.layout.padding[3]);
    const ySymmetric = frames.every((n) => n.layout && n.layout.padding[0] === n.layout.padding[2]);

    const gapMenu = (
        <AriaMenuTrigger>
            <AriaButton aria-label="Gap options" className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-muted outline-none hover:text-ink">
                <ChevronDown className="size-3" />
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    className="outline-none"
                    onAction={(k) => {
                        const key = String(k);
                        if (key === "fixed") setLayout({ primary: "start" });
                        else setLayout({ primary: key as AutoLayout["primary"] });
                    }}
                >
                    <MenuRow id="fixed" label={`Fixed (${first.gap})`} checked={!auto} />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    {(["between", "around", "evenly"] as const).map((k) => (
                        <MenuRow key={k} id={k} label={`Auto: ${AUTO_LABELS[k].toLowerCase()}`} checked={first.primary === k} />
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
    const individualButton = (
        <button
            type="button"
            aria-pressed={individual}
            title={individual ? "Horizontal and vertical padding" : "Individual padding"}
            aria-label="Individual padding"
            onClick={() => setIndividual(!individual)}
            className={`flex size-6 items-center justify-center rounded-md ${individual ? "bg-brand-100 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}
        >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                <rect x="5" y="5" width="6" height="6" rx="1" />
            </svg>
        </button>
    );

    // The reference's block: the 88×56 alignment box beside the gap (one field with a joined
    // chevron) and the settings button, then the padding row and its individual-padding button.
    return (
        <div className="space-y-2" onBlur={() => setUniform(false)}>
            <div className="grid grid-cols-[88px_88px_24px] grid-rows-[24px_24px] gap-x-2 gap-y-2">
                <div className="row-span-2">
                    <AlignBox layout={first} grid={grid} setLayout={setLayout} />
                </div>
                {grid ? (
                    <div className="row-span-2 flex min-w-0 flex-col gap-2">
                        <GridGaps frames={frames} />
                    </div>
                ) : (
                    <div className="flex h-6 min-w-0 overflow-hidden rounded-md bg-field">
                        <div className="min-w-0 flex-1">
                            {auto ? (
                                <button type="button" title={`${AUTO_LABELS[first.primary]}. Type a number to set the gap.`} onClick={() => setLayout({ primary: "start" })} className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-ink">
                                    <span className="text-ink-subtle">{vertical ? "↕" : "↔"}</span>
                                    Auto
                                </button>
                            ) : (
                                <Bindable nodes={frames} field="gap" label="gap">
                                    <NumberField bare label={vertical ? "↕" : "↔"} icon={<GapIcon vertical={vertical} />} title={first.wrap ? "Horizontal gap between items" : "Gap between items"} {...gap} />
                                </Bindable>
                            )}
                        </div>
                        <span aria-hidden="true" className="w-px shrink-0 bg-panel" />
                        {gapMenu}
                    </div>
                )}
                <div className={grid ? "row-span-2" : ""}>
                    <LayoutSettings frames={frames} />
                </div>
                {!grid && (first.wrap ? <NumberField label="↕" title="Vertical gap between rows" {...rowGap} /> : <span />)}
            </div>
            {grid && <GridTracks frames={frames} />}
            {individual ? (
                <>
                    <div className="grid grid-cols-[88px_88px_24px] items-center gap-2">
                        <NumberField label="L" title="Left padding" min={0} {...padL} {...padProps} />
                        <NumberField label="T" title="Top padding" min={0} {...padT} {...padProps} />
                        {individualButton}
                    </div>
                    <div className="grid grid-cols-[88px_88px] items-center gap-2">
                        <NumberField label="R" title="Right padding" min={0} {...padR} {...padProps} />
                        <NumberField label="B" title="Bottom padding" min={0} {...padB} {...padProps} />
                    </div>
                </>
            ) : (
                <div className="grid grid-cols-[88px_88px_24px] items-center gap-2">
                    <Bindable nodes={frames} field="padding" label="padding">
                        <NumberField label="|↔|" icon={<PadIcon axis="x" />} title="Horizontal padding (⌘-click edits all sides; type 8, 16 for vertical, horizontal)" min={0} {...padX} value={xSymmetric ? padX.value : null} {...padProps} />
                    </Bindable>
                    <NumberField label="⊥" icon={<PadIcon axis="y" />} title="Vertical padding (⌘-click edits all sides)" min={0} {...padY} value={ySymmetric ? padY.value : null} {...padProps} />
                    {individualButton}
                </div>
            )}
        </div>
    );
}

function GapIcon({ vertical }: { vertical: boolean }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-3.5 ${vertical ? "" : "rotate-90"}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3h10M3 13h10M6.5 8h3" />
        </svg>
    );
}

function PadIcon({ axis }: { axis: "x" | "y" }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-3.5 ${axis === "y" ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M6 5.5v5M10 5.5v5" />
        </svg>
    );
}

// The 3×3 alignment box. Arrow keys move the alignment, W/A/S/D send it to an edge, X toggles the
// Auto gap and B baseline alignment (horizontal stacks).
function AlignBox({ layout, grid, setLayout }: { layout: AutoLayout; grid: boolean; setLayout: (patch: Partial<AutoLayout>) => void }) {
    const vertical = layout.direction === "vertical" && !grid;
    const auto = isAuto(layout) && !grid;
    const baseline = layout.counter === "baseline";
    // Grid frames keep the vertical alignment of their cells in `primary`, horizontal in `counter`.
    const rowOf = () => ALIGN.indexOf((vertical ? layout.primary : grid ? layout.primary : baseline ? "end" : layout.counter) as (typeof ALIGN)[number]);
    const colOf = () => ALIGN.indexOf((vertical ? (layout.counter === "baseline" ? "start" : layout.counter) : grid ? layout.counter : layout.primary) as (typeof ALIGN)[number]);
    const set = (row: number, col: number) => {
        const r = ALIGN[Math.max(0, Math.min(2, row))] ?? "start";
        const c = ALIGN[Math.max(0, Math.min(2, col))] ?? "start";
        if (grid) return setLayout({ primary: r, counter: c });
        if (vertical) return setLayout({ ...(auto ? {} : { primary: r }), counter: c });
        setLayout({ ...(auto ? {} : { primary: c }), counter: r });
    };
    const cell = (row: number, col: number) => {
        const active = (auto ? (vertical ? col === colOf() : row === rowOf()) : row === rowOf() && col === colOf()) && !(baseline && !vertical);
        const baseActive = baseline && !vertical && (auto || col === colOf());
        return (
            <button key={`${row}-${col}`} type="button" tabIndex={-1} aria-label={`Align ${["top", "middle", "bottom"][row]} ${["left", "centre", "right"][col]}`} aria-pressed={active} onClick={() => set(row, col)} className="group flex items-center justify-center">
                {active ? (
                    <span className="rounded-full bg-brand-500" style={vertical ? { width: 8, height: 3 } : { width: 3, height: 8 }} />
                ) : baseActive && row === 2 ? (
                    <span className="h-0.5 w-3 rounded-full bg-brand-500" />
                ) : (
                    <span className="size-1 rounded-full bg-ink-subtle group-hover:bg-ink-muted" />
                )}
            </button>
        );
    };
    return (
        <div
            role="group"
            tabIndex={0}
            aria-label="Alignment (arrow keys move, W A S D to edges, X auto gap, B baseline)"
            title="Alignment: arrow keys move, W A S D to an edge, X toggles auto gap, B toggles baseline"
            onKeyDown={(e) => {
                const r = Math.max(0, rowOf());
                const c = Math.max(0, colOf());
                const k = e.key.toLowerCase();
                const moves: Record<string, [number, number]> = { arrowup: [r - 1, c], arrowdown: [r + 1, c], arrowleft: [r, c - 1], arrowright: [r, c + 1], w: [0, c], s: [2, c], a: [r, 0], d: [r, 2] };
                const to = moves[k];
                if (to) {
                    e.preventDefault();
                    e.stopPropagation();
                    set(to[0], to[1]);
                } else if (k === "x" && !grid) {
                    e.preventDefault();
                    e.stopPropagation();
                    setLayout({ primary: auto ? "start" : "between" });
                } else if (k === "b" && !vertical && !grid) {
                    e.preventDefault();
                    e.stopPropagation();
                    setLayout({ counter: baseline ? "start" : "baseline" });
                }
            }}
            className="grid h-14 w-[88px] shrink-0 grid-cols-3 grid-rows-3 rounded-md bg-field px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
            {[0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => cell(row, col)))}
        </div>
    );
}

// Auto layout settings ("…"): strokes in layout, canvas stacking, text baseline alignment.
function LayoutSettings({ frames }: { frames: SceneNode[] }) {
    const first = frames[0]?.layout;
    if (!first) return null;
    const set = (patch: Partial<AutoLayout>) => updateAll(frames, (node) => ({ layout: node.layout ? { ...node.layout, ...patch } : null }));
    const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    const horizontal = first.direction === "horizontal" && !first.grid;
    const row = (label: string, control: React.ReactNode) => (
        <label className="grid grid-cols-[96px_1fr] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {control}
        </label>
    );
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Auto layout settings" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <SlidersIcon />
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="w-64 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Auto layout settings">
                    <div className="text-[12px] font-semibold">Auto layout settings</div>
                    {row(
                        "Strokes",
                        <Select aria-label="Strokes" value={shared(frames, (n) => (n.layout?.strokesIncluded ? "in" : "out")) ?? ""} onChange={(e) => set({ strokesIncluded: e.target.value === "in" })} className={field}>
                            <option value="out">Excluded</option>
                            <option value="in">Included</option>
                        </Select>,
                    )}
                    {row(
                        "Canvas stacking",
                        <Select aria-label="Canvas stacking" value={shared(frames, (n) => (n.layout?.reverseZ ? "first" : "last")) ?? ""} onChange={(e) => set({ reverseZ: e.target.value === "first" })} className={field}>
                            <option value="last">Last on top</option>
                            <option value="first">First on top</option>
                        </Select>,
                    )}
                    {first.wrap && !first.grid &&
                        row(
                            "Wrapped lines",
                            <Select aria-label="Wrapped lines" value={shared(frames, (n) => n.layout?.alignContent ?? "auto") ?? ""} onChange={(e) => set({ alignContent: e.target.value as AutoLayout["alignContent"] })} className={field}>
                                <option value="auto">Auto</option>
                                <option value="between">Space between</option>
                            </Select>,
                        )}
                    {horizontal && (
                        <label className="flex h-6 items-center gap-2">
                            <input type="checkbox" checked={first.counter === "baseline"} onChange={(e) => set({ counter: e.target.checked ? "baseline" : "start" })} className="accent-brand-500" />
                            Align text baseline
                        </label>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

const SIZING_LABELS: Record<Sizing, string> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };

// The W and H dropdown: fixed, hug contents, fill container, and min/max limits.
export function SizingMenu({ nodes, axis, onLimits }: { nodes: SceneNode[]; axis: "h" | "v"; onLimits?: () => void }) {
    const doc = useEditor((s) => s.doc);
    const inStack = nodes.every((node) => node.parentId && doc.nodes[node.parentId]?.layout && node.positioning !== "absolute");
    const canHug = nodes.every((node) => node.type === "text" || (isFrameLike(node) && node.layout));
    const limits = inStack || nodes.every((n) => n.layout);
    if (!inStack && !canHug && !limits) return null;
    const value = shared(nodes, (node) => node.sizing[axis]);
    const minKey = axis === "h" ? "minW" : "minH";
    const maxKey = axis === "h" ? "maxW" : "maxH";
    const word = axis === "h" ? "width" : "height";
    const hasLimits = nodes.some((n) => n[minKey] != null || n[maxKey] != null);
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={`${axis === "h" ? "Width" : "Height"} sizing`} className={`flex h-full shrink-0 items-center gap-0.5 pr-2 pl-0.5 text-ink outline-none hover:text-ink ${value === "fixed" && !hasLimits ? "opacity-0 group-hover/field:opacity-100 focus-visible:opacity-100 data-[pressed]:opacity-100" : ""}`}>
                {value === null ? "Mixed" : value === "fixed" ? "" : SIZING_LABELS[value]}
                {/* The icon gains lines while a min or max limit is set. */}
                {hasLimits ? (
                    <svg viewBox="0 0 12 12" className="size-3 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                        <path d="M2 3h8M2 9h8M6 4.5v3" strokeLinecap="round" />
                        <path d="M4 6.5l2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : value === "fixed" ? (
                    <ChevronDown className="size-3 text-ink-muted" />
                ) : null}
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    className="outline-none"
                    onAction={(k) => {
                        const key = String(k);
                        if (key === "fixed" || key === "hug" || key === "fill") return updateAll(nodes, (node) => ({ sizing: { ...node.sizing, [axis]: key } }));
                        if (key === "min") {
                            onLimits?.();
                            return updateAll(nodes, (n) => ({ [minKey]: n[minKey] ?? Math.round(axis === "h" ? n.w : n.h) }));
                        }
                        if (key === "max") {
                            onLimits?.();
                            return updateAll(nodes, (n) => ({ [maxKey]: n[maxKey] ?? Math.round(axis === "h" ? n.w : n.h) }));
                        }
                        if (key === "clear") return updateAll(nodes, () => ({ minW: null, maxW: null, minH: null, maxH: null }));
                    }}
                    disabledKeys={hasLimits ? [] : ["clear"]}
                >
                    <MenuRow id="fixed" label={`Fixed ${word}`} checked={value === "fixed"} />
                    {canHug && <MenuRow id="hug" label="Hug contents" checked={value === "hug"} />}
                    {inStack && <MenuRow id="fill" label="Fill container" checked={value === "fill"} />}
                    {limits && <AriaSeparator className="my-1 h-px bg-white/10" />}
                    {limits && <MenuRow id="min" label={`Add min ${word}`} />}
                    {limits && <MenuRow id="max" label={`Add max ${word}`} />}
                    {limits && <MenuRow id="clear" label="Remove min and max" />}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// Min and max fields, shown while the limits are open (adding one from the W/H menu opens them;
// they close again when the selection changes, as in the reference).
export function LimitFields({ nodes }: { nodes: SceneNode[] }) {
    const keys = (["minW", "maxW", "minH", "maxH"] as const).filter((k) => nodes.some((n) => n[k] != null));
    if (!keys.length) return null;
    const labels = { minW: "Min W", maxW: "Max W", minH: "Min H", maxH: "Max H" };
    return (
        <div className="grid grid-cols-2 gap-1.5">
            {keys.map((key) => (
                <Bindable key={key} nodes={nodes} field={key} label={labels[key]}>
                    <NumberField
                        label={labels[key]}
                        min={0}
                        value={shared(nodes, (n) => n[key] ?? null)}
                        title="Clear the field to remove the limit"
                        onText={(t) => {
                            if (t.trim() !== "") return false;
                            updateAll(nodes, () => ({ [key]: null }));
                            return true;
                        }}
                        onCommit={(v) => updateAll(nodes, () => ({ [key]: v }))}
                    />
                </Bindable>
            ))}
        </div>
    );
}

const gridWrite =
    (pick: (grid: NonNullable<AutoLayout["grid"]>, value: number) => Partial<NonNullable<AutoLayout["grid"]>>) =>
    (_doc: NagmaDocument, node: SceneNode, value: number): Command[] =>
        node.layout?.grid ? [{ type: "node.update", id: node.id, patch: { layout: { ...node.layout, grid: { ...node.layout.grid, ...pick(node.layout.grid, value) } } } }] : [];

function GridGaps({ frames }: { frames: SceneNode[] }) {
    const col = useNumberField(frames, (n) => n.layout?.grid?.columnGap ?? 0, gridWrite((_g, v) => ({ columnGap: v })));
    const row = useNumberField(frames, (n) => n.layout?.grid?.rowGap ?? 0, gridWrite((_g, v) => ({ rowGap: v })));
    return (
        <>
            <Bindable nodes={frames} field="gridColumnGap" label="column gap"><NumberField label="↔" title="Gap between columns" {...col} /></Bindable>
            <Bindable nodes={frames} field="gridRowGap" label="row gap"><NumberField label="↕" title="Gap between rows" {...row} /></Bindable>
        </>
    );
}

function GridTracks({ frames }: { frames: SceneNode[] }) {
    const doc = useEditor((st) => st.doc);
    const [open, setOpen] = useState<"columnSizes" | "rowSizes" | null>(null);
    const cols = useNumberField(frames, (n) => n.layout?.grid?.columns ?? 2, gridWrite((_g, v) => ({ columns: Math.max(1, Math.round(v)) })));
    const rows = shared(frames, (n) => n.layout?.grid?.rows ?? 0);
    const first = frames[0];
    const grid = first?.layout?.grid;
    if (!first || !grid) return null;
    // How many rows the grid has right now (Auto grows with the children).
    const kids = first.children.map((id) => doc.nodes[id]).filter((c): c is SceneNode => Boolean(c && c.visible && c.positioning !== "absolute"));
    const rowCount = placeChildren(grid, kids).rowCount;
    const setGrid = (patch: Partial<NonNullable<AutoLayout["grid"]>>) => updateAll(frames, (n) => (n.layout?.grid ? { layout: { ...n.layout, grid: { ...n.layout.grid, ...patch } } } : {}));
    const hugAxis = (key: "columnSizes" | "rowSizes") => frames.every((n) => n.sizing[key === "columnSizes" ? "h" : "v"] === "hug");
    const tracks = (key: "columnSizes" | "rowSizes", count: number) => {
        const list = Array.from({ length: count }, (_, i) => grid[key]?.[i] ?? (hugAxis(key) ? { type: "hug" as const, value: 0 } : { type: "fill" as const, value: 1 }));
        const write = (i: number, t: GridTrack) => setGrid({ [key]: list.map((x, k) => (k === i ? t : x)) });
        // Moving a track swaps it with its neighbour, its size and the children in it going along
        // (every child is pinned to its cell first, so the others stay where they are).
        const move = (i: number, j: number) => {
            if (j < 0 || j >= list.length) return;
            const col = key === "columnSizes";
            const sizes = [...list];
            [sizes[i], sizes[j]] = [sizes[j] as GridTrack, sizes[i] as GridTrack];
            const swap = (n: number) => (n === i ? j : n === j ? i : n);
            const placed = placeChildren(grid, kids).placements;
            editor.execute({
                type: "batch",
                commands: [
                    { type: "node.update", id: first.id, patch: { layout: { ...(first.layout as AutoLayout), grid: { ...grid, [key]: sizes } } } },
                    ...placed.map((pl) => ({ type: "node.update" as const, id: pl.node.id, patch: { gridPosition: col ? { col: swap(pl.col), row: pl.row } : { col: pl.col, row: swap(pl.row) } } })),
                ],
            });
        };
        return (
            <div className="space-y-1 rounded-md border border-panel-border p-1.5">
                {list.map((t, i) => (
                    <div key={i} className="grid grid-cols-[20px_1fr_64px] items-center gap-1">
                        <span className="group relative text-center text-ink-subtle">
                            <span className="group-hover:invisible">{i + 1}</span>
                            <span className="invisible absolute inset-0 flex flex-col items-center justify-center group-hover:visible">
                                <button type="button" aria-label={`Move ${key === "columnSizes" ? "column" : "row"} ${i + 1} ${key === "columnSizes" ? "left" : "up"}`} disabled={i === 0} onClick={() => move(i, i - 1)} className="h-3 leading-3 hover:text-ink disabled:opacity-30">
                                    ▴
                                </button>
                                <button type="button" aria-label={`Move ${key === "columnSizes" ? "column" : "row"} ${i + 1} ${key === "columnSizes" ? "right" : "down"}`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)} className="h-3 leading-3 hover:text-ink disabled:opacity-30">
                                    ▾
                                </button>
                            </span>
                        </span>
                        <Select
                            aria-label={`${key === "columnSizes" ? "Column" : "Row"} ${i + 1} size`}
                            value={t.type}
                            onChange={(e) => {
                                const type = e.target.value as GridTrack["type"];
                                write(i, { type, value: type === "fill" ? 1 : type === "fixed" ? 100 : 0 });
                            }}
                            className="h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500"
                        >
                            <option value="fixed">Fixed</option>
                            <option value="fill" disabled={hugAxis(key)}>Fill</option>
                            <option value="hug">Hug</option>
                        </Select>
                        {t.type === "hug" ? (
                            <span className="text-center text-ink-subtle">Hug</span>
                        ) : (
                            <NumberField label={t.type === "fill" ? "fr" : "px"} min={t.type === "fill" ? 0.1 : 0} value={t.value} onCommit={(v) => write(i, { ...t, value: v })} />
                        )}
                    </div>
                ))}
                {grid[key]?.length ? (
                    <button type="button" onClick={() => setGrid({ [key]: undefined })} className="h-6 w-full rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                        Reset sizes
                    </button>
                ) : null}
            </div>
        );
    };
    const toggle = (key: "columnSizes" | "rowSizes") => (
        <button type="button" aria-expanded={open === key} title="Track sizes" aria-label={key === "columnSizes" ? "Column sizes" : "Row sizes"} onClick={() => setOpen(open === key ? null : key)} className={`flex size-7 shrink-0 items-center justify-center rounded-md ${open === key ? "bg-brand-100 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
            <ChevronDown className={`size-3 transition-transform ${open === key ? "rotate-180" : ""}`} />
        </button>
    );
    return (
        <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
                <div className="flex min-w-0 items-center gap-0.5">
                    <NumberField label="Cols" min={1} {...cols} />
                    {toggle("columnSizes")}
                </div>
                <div className="flex min-w-0 items-center gap-0.5">
                    <NumberField
                        label="Rows"
                        min={0}
                        value={rows === null ? null : rows === 0 ? rowCount : rows}
                        title="Rows: a number, or Auto (as many as the children need)"
                        onText={(t) => {
                            if (!/^auto$/i.test(t.trim()) && t.trim() !== "") return false;
                            setGrid({ rows: null });
                            return true;
                        }}
                        onCommit={(v) => setGrid({ rows: v > 0 ? Math.round(v) : null })}
                    />
                    {toggle("rowSizes")}
                </div>
            </div>
            {rows === 0 && <p className="text-[10.5px] text-ink-subtle">Rows: Auto ({rowCount}). Type a number to fix it.</p>}
            {open === "columnSizes" && tracks("columnSizes", Math.max(1, Math.round(grid.columns)))}
            {open === "rowSizes" && tracks("rowSizes", rowCount)}
            <div className="grid grid-cols-2 gap-1.5">
                <Select aria-label="Items positioning" title="How children land in cells" value={grid.itemsPositioning ?? "auto"} onChange={(e) => setGrid({ itemsPositioning: e.target.value as "auto" | "manual" })} className="h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500">
                    <option value="auto">Auto flow</option>
                    <option value="manual">Manual</option>
                </Select>
                <Select aria-label="Auto tracks" title="How tracks without a size of their own are sized" value={grid.autoTracks?.type ?? "default"} onChange={(e) => { const type = e.target.value; setGrid({ autoTracks: type === "default" ? undefined : { type: type as GridTrack["type"], value: type === "fill" ? 1 : type === "fixed" ? 100 : 0 } }); }} className="h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500">
                    <option value="default">Tracks: Auto</option>
                    <option value="fill">Tracks: Fill</option>
                    <option value="hug">Tracks: Hug</option>
                    <option value="fixed">Tracks: Fixed</option>
                </Select>
            </div>
        </div>
    );
}

// A child of a grid: its cell (or Auto), span and alignment inside its area.
export function GridChildControls({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((st) => st.doc);
    const inGrid = nodes.length > 0 && nodes.every((n) => n.parentId && doc.nodes[n.parentId]?.layout?.grid && n.positioning !== "absolute");
    if (!inGrid) return null;
    const pos = (axis: "col" | "row") => shared(nodes, (n) => (n.gridPosition ? n.gridPosition[axis] + 1 : 0));
    const setPos = (axis: "col" | "row", v: number | null) =>
        updateAll(nodes, (n) => {
            if (v === null) return { gridPosition: null };
            const parent = doc.nodes[n.parentId ?? ""];
            const kids = (parent?.children ?? []).map((id) => doc.nodes[id]).filter((c): c is SceneNode => Boolean(c && c.visible && c.positioning !== "absolute"));
            // Starting from where it sits now keeps the other axis in place.
            const placed = parent?.layout?.grid ? placeChildren(parent.layout.grid, kids).placements.find((p) => p.node.id === n.id) : undefined;
            const base = n.gridPosition ?? { col: placed?.col ?? 0, row: placed?.row ?? 0 };
            return { gridPosition: { ...base, [axis]: Math.max(0, Math.round(v) - 1) } };
        });
    const span = (axis: "col" | "row") => shared(nodes, (n) => n.gridSpan?.[axis] ?? 1);
    const setSpan = (axis: "col" | "row", v: number) => updateAll(nodes, (n) => ({ gridSpan: { col: n.gridSpan?.col ?? 1, row: n.gridSpan?.row ?? 1, [axis]: Math.max(1, Math.round(v)) } }));
    const align = (axis: "h" | "v") => shared(nodes, (n) => n.gridAlign?.[axis] ?? "auto");
    const setAlign = (axis: "h" | "v", v: "auto" | "start" | "center" | "end") => updateAll(nodes, (n) => ({ gridAlign: { h: n.gridAlign?.h ?? "auto", v: n.gridAlign?.v ?? "auto", [axis]: v } }));
    const select = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    const cellField = (axis: "col" | "row", label: string) => {
        const v = pos(axis);
        return (
            <NumberField
                label={label}
                min={1}
                value={v === null ? null : v === 0 ? null : v}
                title={`${axis === "col" ? "Column" : "Row"} the layer starts in. Type Auto (or clear it) for automatic placement.`}
                onText={(t) => {
                    if (!/^auto$/i.test(t.trim()) && t.trim() !== "") return false;
                    setPos(axis, null);
                    return true;
                }}
                onCommit={(n) => setPos(axis, n)}
            />
        );
    };
    const automatic = nodes.every((n) => !n.gridPosition);
    return (
        <div className="space-y-1.5">
            <div className="flex h-5 items-center justify-between text-ink-muted">
                <span>Grid cell</span>
                {automatic ? <span className="text-ink-subtle">Auto</span> : <button type="button" onClick={() => setPos("col", null)} className="text-ink-muted hover:text-ink">Auto</button>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                {cellField("col", "Col")}
                {cellField("row", "Row")}
                <NumberField label="↔ span" min={1} value={span("col")} onCommit={(v) => setSpan("col", v)} />
                <NumberField label="↕ span" min={1} value={span("row")} onCommit={(v) => setSpan("row", v)} />
                {(["h", "v"] as const).map((axis) => (
                    <Select key={axis} aria-label={axis === "h" ? "Horizontal alignment in cell" : "Vertical alignment in cell"} value={align(axis) ?? ""} onChange={(e) => setAlign(axis, e.target.value as "auto")} className={select}>
                        {align(axis) === null && <option value="">Mixed</option>}
                        <option value="auto">{axis === "h" ? "↔ Auto" : "↕ Auto"}</option>
                        <option value="start">{axis === "h" ? "↔ Left" : "↕ Top"}</option>
                        <option value="center">{axis === "h" ? "↔ Center" : "↕ Middle"}</option>
                        <option value="end">{axis === "h" ? "↔ Right" : "↕ Bottom"}</option>
                    </Select>
                ))}
            </div>
        </div>
    );
}

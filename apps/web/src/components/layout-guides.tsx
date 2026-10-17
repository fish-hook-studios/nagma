import { Eye, EyeOff, Grid01, LinkBroken01, Minus, Plus } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { DEFAULT_GUIDE, applyGridStyle, createGridStyle, deleteGridStyle, gridStylesOf } from "../engine/guides";
import { useEditor } from "../engine/store";
import type { LayoutGuide, SceneNode } from "../engine/types";
import { ColorSwatch } from "./color-picker";
import { IconButton } from "./icon-button";
import { NumberField } from "./number-field";
import { Bindable } from "./variable-picker";
import { updateAll } from "./panel-fields";
import { Select } from "./select";

// Layout guides on frames: a uniform grid by default, or columns and rows that
// stretch between margins or sit left, centre or right (top, centre, bottom) at a fixed width,
// with a count (or Auto), gutter, offset, colour and opacity; guide styles; ⇧G shows and hides them.

// `counted` reads "1 row", "12 columns" (the slides editor's wording).
function summary(g: LayoutGuide, counted = false): string {
    if (g.kind === "grid") return `Grid ${g.size}px`;
    const n = g.countAuto && (g.align ?? "stretch") !== "stretch" ? "Auto" : String(g.count);
    if (counted) return `${n} ${g.kind === "columns" ? "column" : "row"}${n === "1" ? "" : "s"}`;
    return `${g.kind === "columns" ? "Columns" : "Rows"} (${n})`;
}

function KindIcon({ kind }: { kind: LayoutGuide["kind"] }) {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
            {kind === "grid" && <path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />}
            {kind === "columns" && <path d="M6 2.5v11M10 2.5v11" />}
            {kind === "rows" && <path d="M2.5 6h11M2.5 10h11" />}
        </svg>
    );
}

// `strong` sets the heading like a section title (the slides editor shows it as its own section)
// and counts first ("1 row").
// The guide last copied with ⌘C on a highlighted row; ⌘V on the section pastes it.
let guideClipboard: LayoutGuide | null = null;

// `panel` lays it out on the design panel's section rhythm (a 40pt title row, a muted title when empty).
export function LayoutGuideSection({ frames, strong, panel }: { frames: SceneNode[]; strong?: boolean; panel?: boolean }) {
    const shown = useEditor((s) => s.prefs.layoutGuides);
    const styles = useEditor((s) => gridStylesOf(s.doc));
    const single = frames.length === 1 ? frames[0] : undefined;
    const same = frames.every((f) => JSON.stringify(f.guides ?? []) === JSON.stringify(frames[0]?.guides ?? []));
    const guides = same ? (frames[0]?.guides ?? []) : [];
    const styleId = frames.every((f) => f.gridStyleId && f.gridStyleId === frames[0]?.gridStyleId) ? (frames[0]?.gridStyleId ?? null) : null;
    const style = styleId ? styles.find((g) => g.id === styleId) : undefined;
    // Editing guides by hand detaches the style.
    const write = (next: LayoutGuide[]) => updateAll(frames, () => ({ guides: next, gridStyleId: null }));
    const patch = (i: number, p: Partial<LayoutGuide>) => write(guides.map((x, k) => (k === i ? { ...x, ...p } : x)));
    const paste = () => guideClipboard && write([...guides, { ...guideClipboard }]);
    return (
        <div
            className={panel ? (guides.length || !same || style ? "space-y-2 pb-4" : "") : strong ? "space-y-1.5" : "space-y-1.5 pt-1"}
            onKeyDown={(e) => {
                if (!(e.metaKey || e.ctrlKey) || e.target instanceof HTMLInputElement) return;
                if (e.key.toLowerCase() === "v" && guideClipboard) {
                    e.preventDefault();
                    e.stopPropagation();
                    paste();
                }
            }}
        >
            <div className={panel ? `${guides.length || !same || style ? "mb-1 " : ""}flex h-10 items-center justify-between` : "flex h-6 items-center justify-between"}>
                <span className={panel ? `font-semibold ${guides.length || !same || style ? "" : "text-ink-muted"}` : strong ? "font-semibold" : "text-ink-muted"}>Layout guide</span>
                <div className="flex items-center">
                    <GuideStylePicker frames={frames} guides={guides} />
                    <IconButton size="sm" icon={Plus} label="Add layout guide" onPress={() => write([...guides, { ...DEFAULT_GUIDE }])} />
                </div>
            </div>
            {!shown && guides.length > 0 && <p className="text-ink-subtle">Hidden. Show them with ⇧G.</p>}
            {!same && <p className="text-ink-muted">Mixed. Click + to replace them.</p>}
            {style && (
                <div className="flex items-center gap-1">
                    <div className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-field px-2">
                        <Grid01 className="size-3.5 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1 truncate">{style.name}</span>
                    </div>
                    <IconButton size="sm" icon={LinkBroken01} label="Detach style" onPress={() => updateAll(frames, () => ({ gridStyleId: null }))} />
                </div>
            )}
            {!style &&
                guides.map((g, i) => (
                    <div
                        key={i}
                        tabIndex={0}
                        role="group"
                        aria-label={`${summary(g)} guide (⌘C copies it, ⌘V pastes, ⌘D duplicates)`}
                        onKeyDown={(e) => {
                            if (!(e.metaKey || e.ctrlKey) || e.target instanceof HTMLInputElement) return;
                            const k = e.key.toLowerCase();
                            if (k === "c") guideClipboard = { ...g };
                            else if (k === "d") write([...guides.slice(0, i + 1), { ...g }, ...guides.slice(i + 1)]);
                            else return;
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        className={`flex items-center gap-1 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${g.visible ? "" : "opacity-50"}`}
                    >
                        <AriaDialogTrigger>
                            <AriaButton aria-label="Layout guide settings" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-field text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                                <KindIcon kind={g.kind} />
                            </AriaButton>
                            <AriaPopover placement="left top" offset={8} className="w-64 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                                <AriaDialog className="outline-none" aria-label="Layout guide">
                                    <GuideSettings guide={g} index={i} frame={single} onChange={(p) => patch(i, p)} />
                                </AriaDialog>
                            </AriaPopover>
                        </AriaDialogTrigger>
                        <span className="min-w-0 flex-1 truncate">{summary(g, strong)}</span>
                        <IconButton size="sm" icon={g.visible ? Eye : EyeOff} label={g.visible ? "Hide guide" : "Show guide"} onPress={() => patch(i, { visible: !g.visible })} />
                        <IconButton size="sm" icon={Minus} label="Remove guide" onPress={() => write(guides.filter((_, k) => k !== i))} />
                    </div>
                ))}
        </div>
    );
}

function GuideSettings({ guide: g, index, frame, onChange }: { guide: LayoutGuide; index: number; frame?: SceneNode; onChange: (p: Partial<LayoutGuide>) => void }) {
    // With one frame selected, count, size, margin and gutter can follow number variables.
    const bind = (key: "count" | "size" | "margin" | "gutter", label: string, control: React.ReactNode) =>
        frame ? (
            <Bindable nodes={[frame]} field={`guide:${index}:${key}`} label={label}>
                {control}
            </Bindable>
        ) : (
            control
        );
    const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    const align = g.align ?? "stretch";
    const cols = g.kind === "columns";
    const row = (label: string, control: React.ReactNode) => (
        <div className="grid grid-cols-[64px_1fr] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {control}
        </div>
    );
    return (
        <div className="space-y-2">
            <Select
                aria-label="Guide type"
                value={g.kind}
                onChange={(e) => {
                    const kind = e.target.value as LayoutGuide["kind"];
                    // Columns and rows start like the reference's: five, stretched, with 20 px gutters.
                    if (kind === "grid") onChange({ kind, size: g.kind === "grid" ? g.size : 10 });
                    else onChange({ kind, ...(g.kind === "grid" ? { count: 5, gutter: 20, margin: 0, align: "stretch", size: Math.max(10, Math.round(((frame?.w ?? 400) - 80) / 5)) } : {}) });
                }}
                className={`${field} w-full font-semibold`}
            >
                <option value="grid">Grid</option>
                <option value="columns">Columns</option>
                <option value="rows">Rows</option>
            </Select>
            {g.kind === "grid" ? (
                row("Size", bind("size", "grid size", <NumberField label="⊞" title="Grid size" min={1} value={g.size} onCommit={(v) => onChange({ size: v })} />))
            ) : (
                <>
                    {row(
                        "Count",
                        bind(
                            "count",
                            "guide count",
                            <NumberField
                            label="#"
                            title="Count (type Auto to fit as many as there is room for)"
                            min={1}
                            value={g.countAuto && align !== "stretch" ? null : g.count}
                            onText={(t) => {
                                if (!/^auto$/i.test(t.trim())) return false;
                                if (align !== "stretch") onChange({ countAuto: true });
                                return true;
                            }}
                            onCommit={(v) => onChange({ count: Math.max(1, Math.round(v)), countAuto: false })}
                            />,
                        ),
                    )}
                    {g.countAuto && align !== "stretch" && <p className="pl-[72px] text-[10.5px] text-ink-subtle">Auto: as many as fit</p>}
                    {row(
                        "Type",
                        <Select aria-label="Guide alignment" value={align} onChange={(e) => onChange({ align: e.target.value as LayoutGuide["align"] })} className={field}>
                            <option value="stretch">Stretch</option>
                            <option value="start">{cols ? "Left" : "Top"}</option>
                            <option value="center">Center</option>
                            <option value="end">{cols ? "Right" : "Bottom"}</option>
                        </Select>,
                    )}
                    {align !== "stretch" && row(cols ? "Width" : "Height", bind("size", "guide size", <NumberField label={cols ? "W" : "H"} min={1} value={g.size} onCommit={(v) => onChange({ size: v })} />))}
                    {align !== "center" && row(align === "stretch" ? "Margin" : "Offset", bind("margin", "guide margin", <NumberField label="|↔|" min={0} value={g.margin} onCommit={(v) => onChange({ margin: v })} />))}
                    {row("Gutter", bind("gutter", "guide gutter", <NumberField label="↔" min={0} value={g.gutter} onCommit={(v) => onChange({ gutter: v })} />))}
                </>
            )}
            {row(
                "Color",
                <div className="flex items-center gap-1.5">
                    <ColorSwatch color={g.color} opacity={g.opacity ?? (g.kind === "grid" ? 0.35 : 0.12)} label="Guide colour" onChange={(color, opacity) => onChange({ color, opacity })} />
                    <span className="min-w-0 flex-1 truncate uppercase">{g.color.replace("#", "")}</span>
                    <div className="w-16 shrink-0">
                        <NumberField label="" title="Opacity" suffix="%" min={0} max={100} value={Math.round((g.opacity ?? (g.kind === "grid" ? 0.35 : 0.12)) * 100)} onCommit={(v) => onChange({ opacity: v / 100 })} />
                    </div>
                </div>,
            )}
        </div>
    );
}

// The grid button by "Layout guide": apply a guide style, or save the current guides as one.
function GuideStylePicker({ frames, guides }: { frames: SceneNode[]; guides: LayoutGuide[] }) {
    const styles = useEditor((s) => gridStylesOf(s.doc));
    const [name, setName] = useState("");
    const ids = frames.map((f) => f.id);
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Guide styles" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Grid01 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="w-56 rounded-lg border border-panel-border bg-panel-raised p-2 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Guide styles">
                    {({ close }) => (
                        <>
                            {guides.length > 0 && (
                                <form
                                    className="flex gap-1"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        createGridStyle(name, guides, ids);
                                        setName("");
                                        close();
                                    }}
                                >
                                    <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="New style name" aria-label="New guide style name" className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none focus:border-brand-500" />
                                    <button type="submit" className="h-6 rounded-md bg-brand-500 px-2 font-medium text-white">
                                        Create
                                    </button>
                                </form>
                            )}
                            {styles.length === 0 ? (
                                <p className="text-ink-muted">No guide styles yet. Add guides, then name them above to make one.</p>
                            ) : (
                                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                                    {styles.map((st) => (
                                        <button
                                            key={st.id}
                                            type="button"
                                            onClick={() => {
                                                applyGridStyle(ids, st.id);
                                                close();
                                            }}
                                            className={`flex h-6 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-panel-hover ${frames.every((f) => f.gridStyleId === st.id) ? "bg-panel-hover" : ""}`}
                                        >
                                            <Grid01 className="size-3.5 shrink-0 text-ink-muted" />
                                            <span className="min-w-0 flex-1 truncate">{st.name}</span>
                                            <span className="text-ink-subtle">{st.guides.length}</span>
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`Delete ${st.name}`}
                                                title="Delete style"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteGridStyle(st.id);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.stopPropagation();
                                                        deleteGridStyle(st.id);
                                                    }
                                                }}
                                                className="flex size-5 items-center justify-center rounded text-ink-subtle hover:bg-panel-raised hover:text-ink"
                                            >
                                                <Minus className="size-3" />
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

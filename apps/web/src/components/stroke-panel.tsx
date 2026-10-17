import { DotsHorizontal } from "@untitledui/icons";
import { useRef, useState } from "react";
import { applyCommand } from "../engine/commands";
import { editor } from "../engine/store";
import type { NagmaDocument, NodePatch } from "../engine/types";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { isFrameLike } from "../engine/components";
import { DEFAULT_MITER_ANGLE } from "../engine/stroke";
import type { EndCap, SceneNode } from "../engine/types";
import { NumberField } from "./number-field";
import { shared, updateAll, useNumberField } from "./panel-fields";
import { Bindable } from "./variable-picker";
import { BrushSettings, DynamicSettings, FlipProfileButton, SettingsSlidersIcon, WidthProfileMenu } from "./draw-stroke";
import { type StrokeType, setStrokeType, strokeTypeOf } from "./draw-stroke-actions";
import { Select } from "./select";

// The Stroke section's controls, laid out: position, weight, the sides menu (all, one
// side, or custom weights per side) and the "…" advanced settings (style, dashes, caps, join,
// miter angle; end points and variable width on open paths).

type Side = "all" | "top" | "bottom" | "left" | "right" | "custom";
const SIDE_LABELS: Record<Side, string> = { all: "All", top: "Top", bottom: "Bottom", left: "Left", right: "Right", custom: "Custom" };

function sideOf(n: SceneNode): Side {
    if (n.strokeWeights) return "custom";
    const s = n.strokeSides;
    if (!s || (s.top && s.right && s.bottom && s.left)) return "all";
    const on = (["top", "right", "bottom", "left"] as const).filter((k) => s[k]);
    return on.length === 1 ? (on[0] as Side) : "custom";
}

function SideIcon({ side, className = "size-3.5" }: { side: Side; className?: string }) {
    const edge = { top: "M3 3h10", bottom: "M3 13h10", left: "M3 3v10", right: "M13 3v10" } as const;
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="1" strokeWidth="1" strokeOpacity={side === "all" ? 1 : 0.35} strokeDasharray={side === "all" ? undefined : "1.5 1.5"} />
            {side !== "all" && side !== "custom" && <path d={edge[side]} strokeWidth="2" />}
            {side === "custom" && <path d="M3 3h10M3 3v10" strokeWidth="2" />}
        </svg>
    );
}

export function StrokeControls({ nodes }: { nodes: SceneNode[] }) {
    const boxy = nodes.every((n) => n.type === "rect" || isFrameLike(n));
    const weight = useNumberField(nodes, (n) => n.strokeWidth, (_d, n, v) => [{ type: "node.update", id: n.id, patch: { strokeWidth: Math.max(0, v), ...(n.strokeWeights ? { strokeWeights: null } : {}) } }]);
    const side = shared(nodes, sideOf);
    const setSide = (next: Side) =>
        updateAll(nodes, (n) => {
            if (next === "all") return { strokeSides: null, strokeWeights: null };
            if (next === "custom") {
                const s = n.strokeSides ?? { top: true, right: true, bottom: true, left: true };
                const w = n.strokeWidth || 1;
                return { strokeSides: null, strokeWeights: n.strokeWeights ?? [s.top ? w : 0, s.right ? w : 0, s.bottom ? w : 0, s.left ? w : 0] };
            }
            return { strokeWeights: null, strokeSides: { top: next === "top", right: next === "right", bottom: next === "bottom", left: next === "left" } };
        });
    const outlined = "h-6 min-w-0 rounded-md border border-panel-border bg-transparent pl-2 text-ink outline-none hover:border-ink-subtle focus:border-brand-500";
    const useSide = (i: 0 | 1 | 2 | 3) =>
        useNumberField(
            nodes,
            (n) => n.strokeWeights?.[i] ?? n.strokeWidth,
            (_d, n, v) => {
                const w: [number, number, number, number] = [...(n.strokeWeights ?? [n.strokeWidth, n.strokeWidth, n.strokeWidth, n.strokeWidth])] as [number, number, number, number];
                w[i] = Math.max(0, v);
                return [{ type: "node.update", id: n.id, patch: { strokeWeights: w, strokeWidth: Math.max(...w) } }];
            },
        );
    const top = useSide(0);
    const right = useSide(1);
    const bottom = useSide(2);
    const left = useSide(3);
    const preview = usePreview(nodes);
    return (
        <div className="space-y-2">
            {/* The reference's row: an outlined position menu (76), the weight (72), then the
                settings and sides buttons in the trailing columns. */}
            <div className="flex items-center">
                <Select aria-label="Stroke position" value={shared(nodes, (n) => n.strokeAlign) ?? ""} onChange={(e) => { preview(null); updateAll(nodes, () => ({ strokeAlign: e.target.value as SceneNode["strokeAlign"] })); }} onPreview={(v) => preview(v ? () => ({ strokeAlign: v as SceneNode["strokeAlign"] }) : null)} className={`${outlined} w-[76px] shrink-0`}>
                    {shared(nodes, (n) => n.strokeAlign) === null && <option value="">Mixed</option>}
                    <option value="inside">Inside</option>
                    <option value="center">Center</option>
                    <option value="outside">Outside</option>
                </Select>
                <div className="ml-2 w-[72px] shrink-0">
                    <Bindable nodes={nodes} field="strokeWidth" label="stroke weight">
                        <NumberField label="≡" icon={<WeightIcon />} title="Stroke weight" min={0} {...weight} value={side === "custom" ? null : weight.value} />
                    </Bindable>
                </div>
                <span className="ml-auto" />
                <AdvancedStroke nodes={nodes} />
                {boxy && (
                    <span className="ml-1 flex"><AriaMenuTrigger>
                        <AriaButton aria-label={`Stroke sides: ${side ? SIDE_LABELS[side] : "Mixed"}`} className={`flex size-6 items-center justify-center rounded-md outline-none hover:bg-panel-hover ${side === "all" ? "text-ink-muted hover:text-ink" : "bg-brand-100 text-brand-500"}`}>
                            <SideIcon side={side ?? "all"} />
                        </AriaButton>
                        <AriaPopover placement="bottom end" className="w-40 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                            <AriaMenu aria-label="Stroke sides" className="outline-none" onAction={(k) => setSide(String(k) as Side)}>
                                {(["all", "top", "bottom", "left", "right", "custom"] as const).map((k) => (
                                    <AriaMenuItem key={k} id={k} textValue={SIDE_LABELS[k]} className="flex h-6 cursor-default items-center gap-2 rounded-md px-2 text-[12px] outline-none data-[focused]:bg-brand-500">
                                        <span className="w-3 text-center">{side === k ? "✓" : ""}</span>
                                        <SideIcon side={k} />
                                        {SIDE_LABELS[k]}
                                    </AriaMenuItem>
                                ))}
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger></span>
                )}
            </div>
            {boxy && side === "custom" && (
                <div className="grid grid-cols-[88px_88px] gap-2">
                    <Bindable nodes={nodes} field="strokeWeight:0" label="top stroke weight"><NumberField label="T" title="Top weight" min={0} {...top} /></Bindable>
                    <Bindable nodes={nodes} field="strokeWeight:2" label="bottom stroke weight"><NumberField label="B" title="Bottom weight" min={0} {...bottom} /></Bindable>
                    <Bindable nodes={nodes} field="strokeWeight:3" label="left stroke weight"><NumberField label="L" title="Left weight" min={0} {...left} /></Bindable>
                    <Bindable nodes={nodes} field="strokeWeight:1" label="right stroke weight"><NumberField label="R" title="Right weight" min={0} {...right} /></Bindable>
                </div>
            )}
        </div>
    );
}

function WeightIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 4h10M3 8h10M3 12h10" />
        </svg>
    );
}

type Style = "solid" | "dash" | "dotted" | "custom";

// Dotted is a dash of no length with round caps, as the reference describes it.
function styleOf(n: SceneNode): Style {
    if (n.dashPattern?.length) return "custom";
    if (n.dash && n.dash[0] === 0 && n.dash[1] > 0 && n.strokeCap === "round") return "dotted";
    if (n.dash && (n.dash[0] > 0 || n.dash[1] > 0)) return "dash";
    return "solid";
}

// A live look at a stroke setting while its menu option is hovered.
function usePreview(nodes: SceneNode[]) {
    const base = useRef<NagmaDocument | null>(null);
    return (patch: ((n: SceneNode) => NodePatch) | null) => {
        if (!patch) {
            if (base.current) editor.preview(base.current);
            base.current = null;
            return;
        }
        base.current ??= editor.get().doc;
        const start = base.current;
        editor.preview(applyCommand(start, { type: "batch", commands: nodes.flatMap((n) => (start.nodes[n.id] ? [{ type: "node.update" as const, id: n.id, patch: patch(start.nodes[n.id] as SceneNode) }] : [])) }));
    };
}

const END_CAPS: [EndCap, string][] = [
    ["none", "None"],
    ["round", "Round"],
    ["square", "Square"],
    ["arrow-lines", "Line arrow"],
    ["arrow-equilateral", "Triangle arrow"],
    ["triangle", "Reversed triangle"],
    ["circle", "Circle arrow"],
    ["diamond", "Diamond arrow"],
];

// The reference's advanced stroke settings: Basic (style, dashes, join, miter, end points, width profile),
// Dynamic (a hand-drawn line) and Brush (stretch and scatter brushes). Picking a page sets the type.
export function AdvancedStroke({ nodes, trigger = "dots" }: { nodes: SceneNode[]; trigger?: "dots" | "sliders" }) {
    const type = shared(nodes, strokeTypeOf);
    const typed = !nodes.some((n) => n.type === "text" || n.type === "group");
    const style = shared(nodes, styleOf);
    const join = shared(nodes, (n) => n.strokeJoin ?? "miter");
    const openPaths = nodes.every((n) => n.type === "vector" && n.path?.subpaths.some((s) => !s.closed));
    const [patternDraft, setPatternDraft] = useState<string | null>(null);
    const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    const row = (label: string, control: React.ReactNode) => (
        <div className="grid grid-cols-[84px_1fr] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {control}
        </div>
    );
    const stylePatch = (next: Style) => (n: SceneNode): NodePatch => {
        if (next === "solid") return { dash: null, dashPattern: null };
        if (next === "dotted") return { dash: [0, Math.max(1, n.strokeWidth * 2)], dashPattern: null, strokeCap: "round" };
        if (next === "dash") return { dash: n.dash && n.dash[0] > 0 ? n.dash : [10, 10], dashPattern: null };
        return { dashPattern: n.dashPattern ?? [...(n.dash ?? [10, 10])] };
    };
    const preview = usePreview(nodes);
    const setStyle = (next: Style) => {
        preview(null);
        updateAll(nodes, stylePatch(next));
    };
    const pattern = shared(nodes, (n) => (n.dashPattern ?? []).join(", "));
    const caps = (key: "strokeCapStart" | "strokeCapEnd", label: string) =>
        row(
            label,
            <Select aria-label={label} value={shared(nodes, (n) => n[key] ?? "none") ?? ""} onChange={(e) => updateAll(nodes, () => ({ [key]: e.target.value as EndCap }))} className={field}>
                {shared(nodes, (n) => n[key] ?? "none") === null && <option value="">Mixed</option>}
                {END_CAPS.map(([v, l]) => (
                    <option key={v} value={v}>
                        {l}
                    </option>
                ))}
            </Select>,
        );
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Advanced stroke settings" className={`flex items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink ${trigger === "sliders" ? "size-7" : "size-6"}`}>
                {trigger === "sliders" ? <SettingsSlidersIcon className="size-4" /> : <DotsHorizontal className="size-3.5" />}
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="max-h-[85vh] w-64 overflow-y-auto rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Advanced stroke">
                    <div className="text-[12px] font-semibold">Advanced stroke</div>
                    {typed && (
                        <div className="flex rounded-md bg-field p-0.5" role="tablist" aria-label="Stroke type">
                            {(["basic", "dynamic", "brush"] as const satisfies readonly StrokeType[]).map((t) => (
                                <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setStrokeType(nodes, t)} className={`flex h-6 flex-1 items-center justify-center rounded text-[11px] ${type === t ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                    {t === "basic" ? "Basic" : t === "dynamic" ? "Dynamic" : "Brush"}
                                </button>
                            ))}
                        </div>
                    )}
                    {typed && type === "dynamic" && <DynamicSettings nodes={nodes} />}
                    {typed && type === "brush" && <BrushSettings nodes={nodes} />}
                    {(!typed || type === "basic" || type === null) && (
                    <>
                    {row(
                        "Stroke style",
                        <Select aria-label="Stroke style" value={style ?? ""} onChange={(e) => setStyle(e.target.value as Style)} onPreview={(v) => preview(v ? stylePatch(v as Style) : null)} className={field}>
                            {style === null && <option value="">Mixed</option>}
                            <option value="solid">Solid</option>
                            <option value="dash">Dashed</option>
                            <option value="dotted">Dotted</option>
                            <option value="custom">Custom</option>
                        </Select>,
                    )}
                    {style === "dash" &&
                        row(
                            "Dash, gap",
                            <div className="grid grid-cols-2 gap-1">
                                <NumberField label="—" title="Dash" min={0} value={shared(nodes, (n) => n.dash?.[0] ?? 0)} onCommit={(v) => updateAll(nodes, (n) => ({ dash: [v, n.dash?.[1] ?? 0] }))} />
                                <NumberField label="⋯" title="Gap" min={0} value={shared(nodes, (n) => n.dash?.[1] ?? 0)} onCommit={(v) => updateAll(nodes, (n) => ({ dash: [n.dash?.[0] ?? 0, v] }))} />
                            </div>,
                        )}
                    {style === "custom" &&
                        row(
                            "Pattern",
                            <input
                                aria-label="Dash pattern"
                                title="Dash and gap lengths, for example 10, 4, 2, 4"
                                value={patternDraft ?? pattern ?? ""}
                                placeholder="10, 4, 2, 4"
                                onChange={(e) => setPatternDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                onBlur={() => {
                                    if (patternDraft === null) return;
                                    const values = patternDraft.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
                                    if (values.length) updateAll(nodes, () => ({ dashPattern: values.length % 2 ? [...values, ...values] : values }));
                                    setPatternDraft(null);
                                }}
                                className={field}
                            />,
                        )}
                    {style === "dotted" &&
                        row(
                            "Gap",
                            <NumberField label="⋯" title="Gap between dots" min={0} value={shared(nodes, (n) => n.dash?.[1] ?? 0)} onCommit={(v) => updateAll(nodes, () => ({ dash: [0, v] }))} />,
                        )}
                    {(style === "dash" || style === "custom" || style === null) &&
                        row(
                            "Dash cap",
                            <Select aria-label="Dash cap" value={shared(nodes, (n) => n.strokeCap ?? "butt") ?? ""} onChange={(e) => updateAll(nodes, () => ({ strokeCap: e.target.value as SceneNode["strokeCap"] }))} className={field}>
                                <option value="butt">None</option>
                                <option value="round">Round</option>
                                <option value="square">Square</option>
                            </Select>,
                        )}
                    {row(
                        "Join",
                        <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Join">
                            {(["miter", "bevel", "round"] as const).map((j) => (
                                <button key={j} type="button" role="radio" aria-checked={join === j} title={j[0]?.toUpperCase() + j.slice(1)} onClick={() => updateAll(nodes, () => ({ strokeJoin: j }))} className={`flex h-6 flex-1 items-center justify-center rounded ${join === j ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin={j} aria-hidden="true">
                                        <path d="M3 13V4h10" />
                                    </svg>
                                </button>
                            ))}
                        </div>,
                    )}
                    {join === "miter" &&
                        row(
                            "Miter angle",
                            <NumberField label="∠" title="Below this angle a miter join is bevelled" suffix="°" min={1} max={179} value={shared(nodes, (n) => n.miterAngle ?? DEFAULT_MITER_ANGLE)} onCommit={(v) => updateAll(nodes, () => ({ miterAngle: v }))} />,
                        )}
                    {openPaths && (
                        <>
                            <AriaSeparator className="h-px bg-panel-border" />
                            {caps("strokeCapStart", "Start point")}
                            {caps("strokeCapEnd", "End point")}
                        </>
                    )}
                    {nodes.every((n) => n.type === "vector") &&
                        row(
                            "Width profile",
                            <div className="flex min-w-0 items-center gap-1">
                                <WidthProfileMenu nodes={nodes} />
                                <FlipProfileButton nodes={nodes} />
                            </div>,
                        )}
                    </>
                    )}
                    {typed && type !== "basic" && openPaths && (
                        <>
                            <AriaSeparator className="h-px bg-panel-border" />
                            {caps("strokeCapStart", "Start point")}
                            {caps("strokeCapEnd", "End point")}
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

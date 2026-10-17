import { Check, ChevronDown } from "@untitledui/icons";
import { type ReactNode, type SVGProps, useRef } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { DEFAULT_DYNAMIC, SCATTER_BRUSHES, STRETCH_BRUSHES, WIDTH_PROFILES, flipWidthPoints, profileIdOf, profilePreviewPath, strokePreviewPath, type BrushPreset } from "../engine/stroke-styles";
import type { BrushStroke, NagmaDocument, SceneNode } from "../engine/types";
import { applyCommand } from "../engine/commands";
import { customBrushStroke, customBrushes } from "../engine/custom-brushes";
import { editor, useEditor } from "../engine/store";
import { widthPointsOf } from "../engine/width-profile";
import { editWidthProfile, profileable } from "./draw-stroke-actions";
import { NumberField } from "./number-field";
import { shared, updateAll, useNumberField } from "./panel-fields";
import { Bindable } from "./variable-picker";

// Draw mode's Stroke controls: the weight with a slider; position and join as icon toggles with
// the advanced settings beside them; caps as icon toggles, the width profile (a menu of drawn
// profiles plus Edit width profile) and a button that flips the profile along the path. Also the
// Dynamic and Brush pages of the advanced settings.

type Icon = (props: SVGProps<SVGSVGElement>) => ReactNode;

export function WeightIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
            <rect x="2" y="3" width="12" height="1" rx="0.5" />
            <rect x="2" y="6.75" width="12" height="1.75" rx="0.6" />
            <rect x="2" y="11" width="12" height="2.75" rx="0.8" />
        </svg>
    );
}

function PositionIcon({ at, ...props }: SVGProps<SVGSVGElement> & { at: "inside" | "center" | "outside" }) {
    const thick = { inside: "M7.5 15V9.5a2 2 0 0 1 2-2H15", center: "M5 15V7a2 2 0 0 1 2-2h8", outside: "M2.5 15V4.5a2 2 0 0 1 2-2H15" }[at];
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
            <path d="M5 15V7a2 2 0 0 1 2-2h8" strokeWidth="1" strokeOpacity="0.4" strokeDasharray={at === "center" ? undefined : "1.5 1.5"} />
            <path d={thick} strokeWidth="2" />
        </svg>
    );
}

function JoinIcon({ join, ...props }: SVGProps<SVGSVGElement> & { join: "miter" | "round" | "bevel" }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
            <path d="M5 16V5h11" strokeWidth="4" strokeLinejoin={join} strokeMiterlimit="10" />
        </svg>
    );
}

function CapIcon({ cap, ...props }: SVGProps<SVGSVGElement> & { cap: "butt" | "square" | "round" }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
            <path d="M1 8h8" stroke="currentColor" strokeWidth="6" strokeLinecap={cap} />
            <path d="M9 2.5v11" stroke="currentColor" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="1.5 1.5" />
        </svg>
    );
}

export function FlipProfileIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
            <path d="M1.5 4.5 6.5 8l-5 3.5z" />
            <path d="M14.5 4.5 9.5 8l5 3.5z" />
            <rect x="7.4" y="2" width="1.2" height="12" rx="0.6" />
        </svg>
    );
}

export function SettingsSlidersIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" {...props}>
            <path d="M2.5 4.5h3.5M9 4.5h4.5M2.5 11.5h6.5M12 11.5h1.5" />
            <circle cx="7.5" cy="4.5" r="1.5" />
            <circle cx="10.5" cy="11.5" r="1.5" />
        </svg>
    );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            {children}
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// A row of icon toggles in a field-coloured group, one of them on (none when mixed).
function IconGroup<T extends string>({ label, value, options, disabled, onPick }: { label: string; value: T | null; options: { id: T; label: string; icon: Icon }[]; disabled?: boolean; onPick: (id: T) => void }) {
    return (
        <div role="group" aria-label={label} className={`flex h-6 shrink-0 items-center rounded-md bg-field p-0.5 ${disabled ? "opacity-60" : ""}`}>
            {options.map(({ id, label: name, icon: Glyph }) => (
                <Tip key={id} label={name}>
                    <AriaButton
                        aria-pressed={value === id}
                        aria-label={name}
                        isDisabled={disabled}
                        onPress={() => onPick(id)}
                        className={`flex h-6 w-7 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${value === id ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}
                    >
                        <Glyph className="size-4" />
                    </AriaButton>
                </Tip>
            ))}
        </div>
    );
}

const isOpen = (n: SceneNode) => n.type === "vector" && Boolean(n.path?.subpaths.some((s) => !s.closed));

// ---- Width profile ---------------------------------------------------------------------------

function ProfilePreview({ points, className = "h-3 w-16" }: { points: { t: number; w: number }[] | null; className?: string }) {
    return (
        <svg viewBox="0 0 64 12" className={className} aria-hidden="true">
            <path d={profilePreviewPath(points)} fill="currentColor" />
        </svg>
    );
}

export function WidthProfileMenu({ nodes, className = "" }: { nodes: SceneNode[]; className?: string }) {
    const enabled = profileable(nodes);
    const id = shared(nodes, profileIdOf);
    const first = nodes[0];
    const current = id === "custom" && first ? widthPointsOf(first) : (WIDTH_PROFILES.find((p) => p.id === id)?.points ?? null);
    return (
        <AriaMenuTrigger>
            <AriaButton
                aria-label="Width profile"
                isDisabled={!enabled}
                className={`flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent bg-field px-2 text-ink outline-none hover:border-panel-border focus-visible:border-brand-500 disabled:opacity-40 ${className}`}
            >
                <span className="flex min-w-0 flex-1 items-center justify-center">{id === null ? <span className="text-ink-muted">Mixed</span> : <ProfilePreview points={current} className="h-3 w-full max-w-20" />}</span>
                <ChevronDown className="size-3 shrink-0 text-ink-muted" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={4} className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    aria-label="Width profiles"
                    className="outline-none"
                    onAction={(key) => {
                        const k = String(key);
                        if (k === "edit") return editWidthProfile(nodes);
                        const preset = WIDTH_PROFILES.find((p) => p.id === k);
                        if (preset) updateAll(nodes, () => ({ widthPoints: preset.points ? preset.points.map((p) => ({ ...p })) : null, strokeProfile: null }));
                    }}
                >
                    {WIDTH_PROFILES.map((p) => (
                        <AriaMenuItem key={p.id} id={p.id} textValue={p.label} aria-label={p.label} className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none data-[focused]:bg-brand-500">
                            <span className="flex w-3 justify-center">{id === p.id && <Check className="size-3" />}</span>
                            <ProfilePreview points={p.points} className="h-3.5 w-24" />
                        </AriaMenuItem>
                    ))}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <AriaMenuItem id="edit" textValue="Edit width profile" isDisabled={nodes.length !== 1} className="flex h-6 cursor-default items-center rounded-md px-2 pl-7 text-[12px] outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500">
                        Edit width profile
                    </AriaMenuItem>
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

export function FlipProfileButton({ nodes }: { nodes: SceneNode[] }) {
    const enabled = profileable(nodes) && nodes.some((n) => widthPointsOf(n));
    return (
        <Tip label="Flip width profile">
            <AriaButton
                aria-label="Flip width profile"
                isDisabled={!enabled}
                onPress={() =>
                    updateAll(nodes, (n) => {
                        const points = widthPointsOf(n);
                        return points ? { widthPoints: flipWidthPoints(points), strokeProfile: null } : {};
                    })
                }
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-35"
            >
                <FlipProfileIcon className="size-4" />
            </AriaButton>
        </Tip>
    );
}

// ---- The Draw-mode stroke rows --------------------------------------------------------------

const POSITIONS = (["inside", "center", "outside"] as const).map((id) => ({ id, label: id[0]?.toUpperCase() + id.slice(1), icon: (p: SVGProps<SVGSVGElement>) => <PositionIcon at={id} {...p} /> }));
const JOINS = (["miter", "round", "bevel"] as const).map((id) => ({ id, label: id[0]?.toUpperCase() + id.slice(1), icon: (p: SVGProps<SVGSVGElement>) => <JoinIcon join={id} {...p} /> }));
const CAPS = [
    { id: "butt" as const, label: "None", icon: (p: SVGProps<SVGSVGElement>) => <CapIcon cap="butt" {...p} /> },
    { id: "square" as const, label: "Square", icon: (p: SVGProps<SVGSVGElement>) => <CapIcon cap="square" {...p} /> },
    { id: "round" as const, label: "Round", icon: (p: SVGProps<SVGSVGElement>) => <CapIcon cap="round" {...p} /> },
];

export function DrawStrokeControls({ nodes, advanced }: { nodes: SceneNode[]; advanced: ReactNode }) {
    const weight = useNumberField(nodes, (n) => n.strokeWidth, (_d, n, v) => [{ type: "node.update", id: n.id, patch: { strokeWidth: Math.max(0, v), ...(n.strokeWeights ? { strokeWeights: null } : {}) } }]);
    const open = nodes.some(isOpen);
    // Brushes and dynamic strokes sit on the centre line.
    const styled = nodes.some((n) => n.dynamicStroke || n.brushStroke);
    const position = open || styled ? "center" : shared(nodes, (n) => n.strokeAlign);
    const max = Math.max(100, Math.ceil(weight.value ?? 0));
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <div className="w-[76px] shrink-0">
                    <Bindable nodes={nodes} field="strokeWidth" label="stroke weight">
                        <NumberField label="≡" icon={<WeightIcon className="size-3.5" />} title="Stroke weight" min={0} {...weight} />
                    </Bindable>
                </div>
                <input
                    type="range"
                    aria-label="Stroke weight"
                    min={0}
                    max={max}
                    step={0.5}
                    value={weight.value ?? 0}
                    onChange={(e) => weight.onScrub(Number(e.target.value))}
                    onPointerUp={(e) => weight.onScrubEnd(Number(e.currentTarget.value))}
                    onKeyUp={(e) => weight.onScrubEnd(Number(e.currentTarget.value))}
                    className="h-1 min-w-0 flex-1 cursor-pointer accent-brand-500"
                />
            </div>
            <div className="flex items-center gap-1.5">
                <IconGroup label="Stroke position" value={position} options={POSITIONS} disabled={open || styled} onPick={(strokeAlign) => updateAll(nodes, () => ({ strokeAlign }))} />
                <IconGroup label="Join" value={shared(nodes, (n) => n.strokeJoin ?? "miter")} options={JOINS} onPick={(strokeJoin) => updateAll(nodes, () => ({ strokeJoin }))} />
                <span className="flex-1" />
                {advanced}
            </div>
            <div className="flex items-center gap-1.5">
                <IconGroup label="Cap" value={shared(nodes, (n) => n.strokeCap ?? "butt")} options={CAPS} onPick={(strokeCap) => updateAll(nodes, () => ({ strokeCap }))} />
                <WidthProfileMenu nodes={nodes} />
                <FlipProfileButton nodes={nodes} />
            </div>
        </div>
    );
}

// ---- Advanced stroke: stroke types --------------------------------------------------------------

const row = (label: string, control: ReactNode) => (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
        <span className="text-ink-muted">{label}</span>
        {control}
    </div>
);

export function DynamicSettings({ nodes }: { nodes: SceneNode[] }) {
    const set = (key: "frequency" | "wiggle" | "smoothen", v: number) => updateAll(nodes, (n) => ({ dynamicStroke: { ...(n.dynamicStroke ?? DEFAULT_DYNAMIC), [key]: v } }));
    const read = (key: "frequency" | "wiggle" | "smoothen") => shared(nodes, (n) => Math.round((n.dynamicStroke?.[key] ?? DEFAULT_DYNAMIC[key]) * 100) / 100);
    const smooth = read("smoothen");
    return (
        <div className="space-y-2">
            {row("Frequency", <NumberField label="∿" title="Frequency: how often the stroke wavers" min={0.01} max={20} step={0.1} value={read("frequency")} onCommit={(v) => set("frequency", v)} />)}
            {row("Wiggle", <NumberField label="≈" title="Wiggle: how far the stroke wanders" min={0} max={20} step={0.1} value={read("wiggle")} onCommit={(v) => set("wiggle", v)} />)}
            {row("Smoothen", <NumberField label="~" title="Smoothen" suffix="%" min={0} max={100} value={smooth === null ? null : Math.round(smooth * 100)} onCommit={(v) => set("smoothen", v / 100)} />)}
        </div>
    );
}

function BrushSwatch({ preset, active, onPress, onHover }: { preset: BrushPreset; active: boolean; onPress: () => void; onHover: (on: boolean) => void }) {
    return (
        <AriaButton
            aria-label={preset.name}
            aria-pressed={active}
            onPress={onPress}
            onHoverStart={() => onHover(true)}
            onHoverEnd={() => onHover(false)}
            className={`flex h-9 flex-col items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "border-brand-500 bg-brand-100/40" : "border-transparent bg-field hover:border-panel-border"}`}
        >
            <svg viewBox="0 0 120 22" className="h-4 w-full px-1" aria-hidden="true">
                <path d={strokePreviewPath({ brushStroke: preset.stroke }, 120, 22, 7)} fill="currentColor" />
            </svg>
            <span className="text-[10px] leading-3 text-ink-muted">{preset.name}</span>
        </AriaButton>
    );
}

export function BrushSettings({ nodes }: { nodes: SceneNode[] }) {
    const current = shared(nodes, (n) => JSON.stringify(n.brushStroke ?? null));
    const brush = current ? (JSON.parse(current) as BrushStroke | null) : null;
    const set = (patch: Partial<BrushStroke>) => updateAll(nodes, (n) => (n.brushStroke ? { brushStroke: { ...n.brushStroke, ...patch } } : {}));
    const num = (key: "gap" | "wiggle" | "sizeJitter" | "angularJitter" | "rotation") => (brush ? (brush[key] ?? 0) : null);
    const doc = useEditor((s) => s.doc);
    const custom = customBrushes(doc).map((def): BrushPreset => ({ id: `custom-${def.id}`, name: `${def.name} (${def.type})`, stroke: customBrushStroke(def) }));
    const patchFor = (preset: BrushPreset): Partial<SceneNode> => ({ brushStroke: { ...preset.stroke }, dynamicStroke: null, strokeAlign: "center", dash: null, dashPattern: null });
    // Hovering a brush shows it on the selection; leaving puts the stroke back.
    const hoverBase = useRef<NagmaDocument | null>(null);
    const hover = (preset: BrushPreset, on: boolean) => {
        if (on) {
            hoverBase.current ??= editor.get().doc;
            const base = hoverBase.current;
            editor.preview(applyCommand(base, { type: "batch", commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: patchFor(preset) })) }));
        } else if (hoverBase.current) {
            editor.preview(hoverBase.current);
            hoverBase.current = null;
        }
    };
    const pick = (preset: BrushPreset) => {
        if (hoverBase.current) {
            editor.preview(hoverBase.current);
            hoverBase.current = null;
        }
        updateAll(nodes, () => patchFor(preset));
    };
    const isActive = (p: BrushPreset) => Boolean(brush && brush.type === p.stroke.type && brush.name === p.stroke.name && (brush.type === "stretch" || brush.custom || (brush.gap === p.stroke.gap && brush.wiggle === p.stroke.wiggle)));
    return (
        <div className="space-y-2">
            <div className="text-[11px] text-ink-muted">Stretch</div>
            <div className="grid grid-cols-3 gap-1">
                {STRETCH_BRUSHES.map((p) => <BrushSwatch key={p.id} preset={p} active={isActive(p)} onPress={() => pick(p)} onHover={(on) => hover(p, on)} />)}
            </div>
            <div className="text-[11px] text-ink-muted">Scatter</div>
            <div className="grid grid-cols-3 gap-1">
                {SCATTER_BRUSHES.map((p) => <BrushSwatch key={p.id} preset={p} active={isActive(p)} onPress={() => pick(p)} onHover={(on) => hover(p, on)} />)}
            </div>
            {custom.length > 0 && (
                <>
                    <div className="text-[11px] text-ink-muted">Custom</div>
                    <div className="grid grid-cols-3 gap-1">
                        {custom.map((p) => <BrushSwatch key={p.id} preset={p} active={isActive(p)} onPress={() => pick(p)} onHover={(on) => hover(p, on)} />)}
                    </div>
                </>
            )}
            {brush?.type === "stretch" &&
                row(
                    "Direction",
                    <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Direction">
                        {(["forward", "backward"] as const).map((d) => (
                            <button key={d} type="button" role="radio" aria-checked={(brush.direction ?? "forward") === d} onClick={() => set({ direction: d })} className={`flex h-6 flex-1 items-center justify-center rounded text-[11px] ${(brush.direction ?? "forward") === d ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                {d === "forward" ? "Forward" : "Backward"}
                            </button>
                        ))}
                    </div>,
                )}
            {brush?.type === "scatter" && (
                <>
                    {row("Gap", <NumberField label="↔" title="Gap between shapes, in sizes" min={0.25} max={20} step={0.05} value={num("gap")} onCommit={(v) => set({ gap: v })} />)}
                    {row("Wiggle", <NumberField label="≈" title="Wiggle: how far shapes wander off the line" min={0} max={20} step={0.1} value={num("wiggle")} onCommit={(v) => set({ wiggle: v })} />)}
                    {row("Size jitter", <NumberField label="±" title="Size jitter" min={0} max={3} step={0.05} value={num("sizeJitter")} onCommit={(v) => set({ sizeJitter: v })} />)}
                    {row("Angle jitter", <NumberField label="∠" title="Angular jitter" suffix="°" min={-180} max={180} value={num("angularJitter")} onCommit={(v) => set({ angularJitter: v })} />)}
                    {row("Rotation", <NumberField label="↻" title="Rotation" suffix="°" min={-180} max={180} value={num("rotation")} onCommit={(v) => set({ rotation: v })} />)}
                </>
            )}
        </div>
    );
}

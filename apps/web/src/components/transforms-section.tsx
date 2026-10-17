import { Plus } from "@untitledui/icons";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { addTransform, applyTransforms, removeTransform, updateTransform } from "../engine/repeat-actions";
import type { RepeatTransform, SceneNode } from "../engine/types";
import { NumberField } from "./number-field";

// Draw mode's Transforms: repeat the selection in a line or around a centre point without
// copying it by hand. The copies follow the originals until the transform is applied.

function RadialIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
            {Array.from({ length: 8 }, (_, i) => {
                const a = (i * Math.PI) / 4;
                return <circle key={i} cx={8 + Math.cos(a) * 5.2} cy={8 + Math.sin(a) * 5.2} r={1.4} />;
            })}
        </svg>
    );
}

function LinearIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
            <rect x="1" y="5.5" width="3.5" height="5" rx="1" />
            <rect x="6.25" y="5.5" width="3.5" height="5" rx="1" />
            <rect x="11.5" y="5.5" width="3.5" height="5" rx="1" />
        </svg>
    );
}

const KINDS: { id: RepeatTransform["kind"]; label: string; icon: typeof RadialIcon }[] = [
    { id: "radial", label: "Radial repeat", icon: RadialIcon },
    { id: "linear", label: "Linear repeat", icon: LinearIcon },
];

export function TransformsSection({ nodes, draw }: { nodes: SceneNode[]; draw: boolean }) {
    const group = nodes.length === 1 && nodes[0]?.repeat ? nodes[0] : undefined;
    if (!group && !draw) return null;
    const t = group?.repeat;
    const set = (patch: Partial<RepeatTransform>) => group && updateTransform(group.id, patch);
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <h3 className="font-semibold">Transforms</h3>
                {!group && (
                    <AriaMenuTrigger>
                        <AriaButton aria-label="Add transform" className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <Plus className="size-3.5" />
                        </AriaButton>
                        <AriaPopover placement="bottom end" offset={4} className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                            <AriaMenu aria-label="Transforms" className="outline-none" onAction={(k) => addTransform(String(k) as RepeatTransform["kind"])}>
                                {KINDS.map(({ id, label, icon: Icon }) => (
                                    <AriaMenuItem key={id} id={id} className="flex h-6 cursor-default items-center gap-2 rounded-md px-2 text-[12px] outline-none data-[focused]:bg-brand-500">
                                        <Icon className="size-4" />
                                        {label}
                                    </AriaMenuItem>
                                ))}
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                )}
            </div>
            {group && t && (
                <div className="mt-1.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                        {(() => {
                            const Icon = t.kind === "radial" ? RadialIcon : LinearIcon;
                            return <Icon className="size-4 text-ink-muted" />;
                        })()}
                        <span className="flex-1">{t.kind === "radial" ? "Radial repeat" : "Linear repeat"}</span>
                    </div>
                    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                        <span className="text-ink-muted">Count</span>
                        <div className="flex items-center gap-2">
                            <div className="w-16 shrink-0">
                                <NumberField label="#" title="How many in all" min={1} max={72} value={t.count} onCommit={(v) => set({ count: Math.round(v) })} />
                            </div>
                            <input type="range" min={1} max={t.kind === "radial" ? 36 : 24} value={t.count} aria-label="Count" onChange={(e) => set({ count: Number(e.target.value) })} className="h-1 min-w-0 flex-1 accent-brand-500" />
                        </div>
                    </div>
                    {t.kind === "linear" ? (
                        <>
                            <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                                <span className="text-ink-muted">Direction</span>
                                <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Direction">
                                    {(["horizontal", "vertical"] as const).map((d) => (
                                        <button key={d} type="button" role="radio" aria-checked={t.direction === d} onClick={() => set({ direction: d })} className={`flex h-6 flex-1 items-center justify-center rounded text-[11px] ${t.direction === d ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                            {d === "horizontal" ? "Horizontal" : "Vertical"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                                <span className="text-ink-muted">Spacing</span>
                                <div className="flex items-center gap-1">
                                    <NumberField label="↔" title={t.unit === "relative" ? "Space between copies, as a percentage of their size" : "Space between copies"} value={t.spacing} onCommit={(v) => set({ spacing: v })} />
                                    <div className="flex shrink-0 rounded-md bg-field p-0.5" role="radiogroup" aria-label="Spacing unit">
                                        {(["pixels", "relative"] as const).map((u) => (
                                            <button key={u} type="button" role="radio" aria-checked={(t.unit ?? "pixels") === u} title={u === "pixels" ? "Pixels" : "Relative to the size"} onClick={() => set({ unit: u })} className={`flex h-6 w-7 items-center justify-center rounded text-[11px] ${(t.unit ?? "pixels") === u ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                                {u === "pixels" ? "px" : "%"}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                            <span className="text-ink-muted">Radius</span>
                            <NumberField label="r" title="Distance from the originals to the centre (0: half their height)" min={0} value={t.radius} onCommit={(v) => set({ radius: Math.max(0, v) })} />
                        </div>
                    )}
                    <div className="flex gap-1.5 pt-0.5">
                        <button type="button" onClick={() => applyTransforms([group.id])} className="h-6 flex-1 rounded-md border border-panel-border hover:bg-panel-hover">
                            Apply transform
                        </button>
                        <button type="button" onClick={() => removeTransform(group.id)} className="h-6 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                            Remove
                        </button>
                    </div>
                </div>
            )}
            {!group && <p className="mt-1 text-ink-subtle">Repeat the selection in a line or around a point.</p>}
        </section>
    );
}

import { Minus, Plus } from "@untitledui/icons";
import { editor, useEditor } from "../engine/store";
import { STAGGER_EASINGS, STAGGER_ORDERS, STAGGER_UNITS, defaultPreset, defaultStagger, staggerCommands } from "../engine/text-stagger";
import type { SceneNode, StaggerPreset, TextStagger } from "../engine/types";
import { IconButton } from "./icon-button";
import { NumberField } from "./number-field";
import { Segmented, Toggle } from "./type-controls";
import { FIELD } from "./type-shared";
import { Select } from "./select";

// Motion › Text stagger, like the reference's text stagger animation preset: the same short animation
// played on each character, word, line or paragraph in turn. Times are shown in seconds.

export function TextStaggerSection({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const first = nodes[0];
    const stagger = first?.animation?.stagger ?? null;
    const apply = (next: TextStagger | null) => {
        const commands = nodes.flatMap((n) => {
            const node = doc.nodes[n.id];
            return node ? staggerCommands(doc, node, next) : [];
        });
        editor.execute({ type: "batch", commands });
    };
    const set = (patch: Partial<TextStagger>) => stagger && apply({ ...stagger, ...patch });
    const preset: StaggerPreset = stagger?.preset ?? defaultPreset();
    const setPreset = (patch: Partial<StaggerPreset>) => stagger && apply({ ...stagger, preset: { ...preset, ...patch } });
    const row = (label: string, control: React.ReactNode) => (
        <div className="grid grid-cols-[84px_1fr] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {control}
        </div>
    );
    const easing = STAGGER_EASINGS.find((e) => JSON.stringify(e.bezier ?? null) === JSON.stringify(preset.bezier ?? null) && (e.bezier || e.easing === preset.easing))?.id ?? "custom";
    const group = (label: string, on: boolean, toggle: (on: boolean) => void, body: React.ReactNode) => (
        <div className="space-y-1.5 rounded-md border border-panel-border p-2">
            <div className="flex items-center justify-between">
                <span className="font-medium">{label}</span>
                <Toggle label={label} checked={on} onChange={toggle} />
            </div>
            {on && body}
        </div>
    );
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <h3 className="font-semibold">Text stagger</h3>
                {stagger ? <IconButton size="sm" icon={Minus} label="Remove text stagger" onPress={() => apply(null)} /> : <IconButton size="sm" icon={Plus} label="Add text stagger" onPress={() => apply({ ...defaultStagger(), delay: Math.round(editor.get().time) })} />}
            </div>
            {stagger && (
                <div className="mt-1.5 space-y-1.5">
                    {row(
                        "Direction",
                        <Segmented
                            value={stagger.direction}
                            options={[
                                { id: "in", label: "In" },
                                { id: "out", label: "Out" },
                            ]}
                            onChange={(direction) => set({ direction })}
                        />,
                    )}
                    {row(
                        "Each",
                        <Select aria-label="Animate each" value={stagger.unit} onChange={(e) => set({ unit: e.target.value as TextStagger["unit"] })} className={FIELD}>
                            {STAGGER_UNITS.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.label}
                                </option>
                            ))}
                        </Select>,
                    )}
                    {row(
                        "Order",
                        <Select aria-label="Stagger order" value={stagger.order} onChange={(e) => set({ order: e.target.value as TextStagger["order"] })} className={FIELD}>
                            {STAGGER_ORDERS.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.label}
                                </option>
                            ))}
                        </Select>,
                    )}
                    {row("Overlap", <NumberField label="" title="Overlap" min={0} max={100} suffix="%" value={stagger.overlap} onCommit={(overlap) => set({ overlap })} />)}
                    {row("Delay", <NumberField label="" title="Delay" min={0} step={0.1} suffix="s" value={Math.round(stagger.delay) / 1000} onCommit={(v) => set({ delay: Math.max(0, v * 1000) })} />)}
                    {row("Duration", <NumberField label="" title="Duration" min={0.01} step={0.1} suffix="s" value={Math.round(stagger.duration) / 1000} onCommit={(v) => set({ duration: Math.max(10, v * 1000) })} />)}
                    {row(
                        "Easing",
                        <Select
                            aria-label="Easing"
                            value={easing}
                            onChange={(e) => {
                                const pick = STAGGER_EASINGS.find((x) => x.id === e.target.value);
                                if (pick) setPreset({ easing: pick.easing, bezier: pick.bezier });
                            }}
                            className={FIELD}
                        >
                            {easing === "custom" && <option value="custom">Custom</option>}
                            {STAGGER_EASINGS.map((x) => (
                                <option key={x.id} value={x.id}>
                                    {x.label}
                                </option>
                            ))}
                        </Select>,
                    )}
                    {row("Clip content", <Toggle label="Clip content" checked={Boolean(stagger.clip)} onChange={(clip) => set({ clip })} />)}
                    {group(
                        "Position",
                        preset.position.on,
                        (on) => setPreset({ position: { ...preset.position, on } }),
                        <>
                            {row(
                                "From",
                                <Select aria-label="Position from" value={preset.position.from} onChange={(e) => setPreset({ position: { ...preset.position, from: e.target.value as StaggerPreset["position"]["from"] } })} className={FIELD}>
                                    <option value="top">Top</option>
                                    <option value="bottom">Bottom</option>
                                    <option value="left">Left</option>
                                    <option value="right">Right</option>
                                </Select>,
                            )}
                            {row("Distance", <NumberField label="" title="Distance" min={0} value={preset.position.distance} onCommit={(distance) => setPreset({ position: { ...preset.position, distance } })} />)}
                        </>,
                    )}
                    {group(
                        "Rotation",
                        preset.rotation.on,
                        (on) => setPreset({ rotation: { ...preset.rotation, on } }),
                        <>
                            {row(
                                "Direction",
                                <Segmented
                                    value={preset.rotation.clockwise ? "cw" : "ccw"}
                                    options={[
                                        { id: "cw", label: "Clockwise" },
                                        { id: "ccw", label: "Counterclockwise" },
                                    ]}
                                    onChange={(v) => setPreset({ rotation: { ...preset.rotation, clockwise: v === "cw" } })}
                                />,
                            )}
                            {row("Amount", <NumberField label="" title="Rotation amount" suffix="°" value={preset.rotation.amount} onCommit={(amount) => setPreset({ rotation: { ...preset.rotation, amount } })} />)}
                        </>,
                    )}
                    {group("Scale", preset.scale.on, (on) => setPreset({ scale: { ...preset.scale, on } }), row("From", <NumberField label="" title="Scale from" min={0} suffix="%" value={preset.scale.amount} onCommit={(amount) => setPreset({ scale: { ...preset.scale, amount } })} />))}
                    {group("Opacity", preset.opacity.on, (on) => setPreset({ opacity: { ...preset.opacity, on } }), row("From", <NumberField label="" title="Opacity from" min={0} max={100} suffix="%" value={preset.opacity.amount} onCommit={(amount) => setPreset({ opacity: { ...preset.opacity, amount } })} />))}
                    {group("Blur", preset.blur.on, (on) => setPreset({ blur: { ...preset.blur, on } }), row("From", <NumberField label="" title="Blur from" min={0} value={preset.blur.amount} onCommit={(amount) => setPreset({ blur: { ...preset.blur, amount } })} />))}
                </div>
            )}
        </section>
    );
}

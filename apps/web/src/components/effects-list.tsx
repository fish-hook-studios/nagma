import { Check, ChevronDown, Eye, EyeOff, Minus, Plus, XClose } from "@untitledui/icons";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    Menu as AriaMenu,
    MenuItem as AriaMenuItem,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Section as AriaSection,
    Separator as AriaSeparator,
} from "react-aria-components";
import { worldToScreen } from "../engine/camera";
import { worldMatrix } from "../engine/transform";
import { canvasRect } from "./canvas-rect";
import { applyCommand } from "../engine/commands";
import { ADDABLE_EFFECTS, EFFECT_LABELS, addEffectCommand, defaultEffect, effectsOf, isBlurEffect } from "../engine/effects";
import { editor, useEditor } from "../engine/store";
import type { BlendMode, Effect, NagmaDocument, SceneNode } from "../engine/types";
import { BlendIcon, BlendMenu } from "./blend-menu";
import { ColorSwatch } from "./color-picker";
import { IconButton } from "./icon-button";
import { NumberField } from "./number-field";
import { CheckRow, Divider } from "./proto-controls";
import { Bindable } from "./variable-picker";
import { Select } from "./select";
import { Segmented } from "./type-controls";
import { ShaderEditor } from "./shader-editor";

// The Effects section: the + menu of effect kinds, and one row per effect, newest on top. A row is
// a button with the effect's icon and name that opens its settings beside the panel, then
// visibility and remove; rows drag to reorder. Several layers with the same kinds of effects edit
// together, showing Mixed where their values differ.

// Switching type keeps what carries over within shadows and within blurs; other kinds start fresh.
function retype(e: Effect, type: Effect["type"]): Effect {
    if (type === e.type) return e;
    const shadow = (t: Effect["type"]) => t === "drop-shadow" || t === "inner-shadow";
    if (shadow(e.type) && shadow(type)) return { ...e, type };
    if (isBlurEffect(e.type) && isBlurEffect(type)) return { ...e, type, ...(type === "motion-blur" && e.angle === undefined ? { angle: 0 } : {}), ...(type === "motion-blur" ? { progressive: null } : {}) };
    return defaultEffect(type, e.visible);
}

// Progressive blur directions offered in the settings (start to end, in the layer's box).
const RAMPS: { id: string; label: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [
    { id: "down", label: "Top to bottom", from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } },
    { id: "up", label: "Bottom to top", from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
    { id: "right", label: "Left to right", from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
    { id: "left", label: "Right to left", from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } },
];
const rampOf = (p: NonNullable<Effect["progressive"]>) => RAMPS.find((r) => r.from.x === p.from.x && r.from.y === p.from.y && r.to.x === p.to.x && r.to.y === p.to.y)?.id ?? "custom";

function sameKinds(nodes: SceneNode[]): Effect["type"][] | null {
    const first = nodes[0];
    if (!first) return null;
    const kinds = effectsOf(first).map((e) => e.type);
    return nodes.every((n) => {
        const list = effectsOf(n);
        return list.length === kinds.length && list.every((e, i) => e.type === kinds[i]);
    })
        ? kinds
        : null;
}

const MENU_ITEM = "flex h-6 cursor-default items-center gap-2 rounded-md pr-3 pl-1.5 text-[12px] text-white outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500";

// The dark menu of effect kinds: the + button's menu, and the settings header's type switcher
// (with a check on the current kind).
function EffectTypeMenu({ value, onPick, onHover, label, children }: { value?: Effect["type"]; onPick: (type: Effect["type"]) => void; onHover?: (type: Effect["type"] | null) => void; label: string; children: React.ReactNode }) {
    const kinds = value && value !== "shader" && !ADDABLE_EFFECTS.includes(value) ? [...ADDABLE_EFFECTS, value] : ADDABLE_EFFECTS;
    const hover = (t: Effect["type"]) => (onHover ? { onHoverStart: () => onHover(t), onHoverEnd: () => onHover(null) } : {});
    return (
        <AriaMenuTrigger>
            {children}
            <AriaPopover placement="bottom start" offset={4} className="outline-none">
                <div className="min-w-44 rounded-lg bg-tooltip p-1 font-sans text-white shadow-xl">
                    <AriaMenu aria-label={label} className="outline-none" onAction={(key) => { onHover?.(null); onPick(String(key) as Effect["type"]); }}>
                        <AriaSection>
                            {kinds.map((t) => (
                                <AriaMenuItem key={t} id={t} textValue={EFFECT_LABELS[t]} className={MENU_ITEM} {...hover(t)}>
                                    {value !== undefined && <span className="flex w-3 shrink-0 justify-center">{t === value && <Check className="size-3" />}</span>}
                                    <span className="flex size-4 shrink-0 items-center justify-center opacity-80">
                                        <EffectIcon type={t} />
                                    </span>
                                    <span className="truncate">{EFFECT_LABELS[t]}</span>
                                </AriaMenuItem>
                            ))}
                        </AriaSection>
                        <AriaSection>
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <AriaMenuItem id="shader" textValue="Shader" className={MENU_ITEM} {...hover("shader")}>
                                {value !== undefined && <span className="flex w-3 shrink-0 justify-center">{value === "shader" && <Check className="size-3" />}</span>}
                                <span className="flex size-4 shrink-0 items-center justify-center opacity-80">
                                    <ShaderIcon />
                                </span>
                                <span className="truncate">Shader</span>
                            </AriaMenuItem>
                        </AriaSection>
                    </AriaMenu>
                </div>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The section header's +: pick a kind, it lands on top of every selected layer's effects, and its
// settings open (`onAdded` gets its index in the stored list).
export function AddEffectButton({ nodes, onAdded }: { nodes: SceneNode[]; onAdded: (index: number | null) => void }) {
    // Hovering a kind shows it on the selection; leaving puts the layers back.
    const base = useRef<NagmaDocument | null>(null);
    const hover = (type: Effect["type"] | null) => {
        if (!type) {
            if (base.current) editor.preview(base.current);
            base.current = null;
            return;
        }
        base.current ??= editor.get().doc;
        editor.preview(applyCommand(base.current, addEffectCommand(nodes.map((n) => base.current?.nodes[n.id] ?? n), type)));
    };
    return (
        <EffectTypeMenu
            label="Add effect"
            onHover={hover}
            onPick={(type) => {
                if (base.current) editor.preview(base.current);
                base.current = null;
                editor.execute(addEffectCommand(nodes, type));
                const doc = editor.get().doc;
                const now = nodes.map((n) => doc.nodes[n.id] ?? n);
                const kinds = sameKinds(now);
                onAdded(kinds ? kinds.length - 1 : null);
            }}
        >
            <AriaButton aria-label="Add effect" className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                <Plus className="size-3.5" />
            </AriaButton>
        </EffectTypeMenu>
    );
}

// A label on the left (56px) and its controls on the right, as in the settings window.
function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
    return (
        <div className={`grid min-h-6 grid-cols-[56px_minmax(0,1fr)] gap-2 ${top ? "items-start" : "items-center"}`}>
            <span className={`truncate text-ink-muted ${top ? "pt-1.5" : ""}`}>{label}</span>
            <div className="flex min-w-0 flex-col gap-1">{children}</div>
        </div>
    );
}

type ListMap = (list: Effect[], node: SceneNode) => Effect[];

// The effect last copied with ⌘C on a row.
let effectClipboard: Effect | null = null;

export function EffectsList({ nodes, open, onOpenChange }: { nodes: SceneNode[]; open: number | null; onOpenChange: (index: number | null) => void }) {
    const kinds = sameKinds(nodes);
    const base = useRef<NagmaDocument | null>(null);
    const rows = useRef(new Map<number, HTMLDivElement>());
    const [dragging, setDragging] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);
    if (!kinds) return <p className="text-ink-muted">Mixed. Click + to add an effect to every layer.</p>;
    if (kinds.length === 0) return null;
    const lists = nodes.map(effectsOf);
    // Writing always lands in `effects`, retiring the old single shadow and blur fields.
    const command = (map: ListMap) => ({
        type: "batch" as const,
        commands: nodes.map((n, k) => ({ type: "node.update" as const, id: n.id, patch: { effects: map(lists[k] ?? [], n), shadow: null, blur: 0 } })),
    });
    const write = (map: ListMap) => {
        const start = base.current;
        base.current = null;
        editor.execute(command(map), start ?? undefined);
    };
    const preview = (map: ListMap) => {
        base.current ??= editor.get().doc;
        editor.preview(applyCommand(base.current, command(map)));
    };
    const endPreview = () => {
        if (base.current) editor.preview(editor.committed());
        base.current = null;
    };
    const patchAt = (i: number, p: Partial<Effect> | ((e: Effect) => Partial<Effect>)) => (list: Effect[]) => list.map((x, k) => (k === i ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x));
    const sharedAt = <T,>(i: number, pick: (e: Effect) => T): T | null => {
        const first = lists[0]?.[i];
        if (!first) return null;
        const v = pick(first);
        return lists.every((l) => l[i] && pick(l[i] as Effect) === v) ? v : null;
    };
    const legacyCount = nodes.length === 1 && nodes[0] ? (nodes[0].shadow ? 1 : 0) + (nodes[0].blur > 0 ? 1 : 0) : 0;
    // Moves the effect at `from` so it lands at stored index `to`.
    const move = (from: number, to: number) => {
        if (from === to) return;
        if (open !== null) onOpenChange(null);
        write((list) => {
            const next = [...list];
            const [item] = next.splice(from, 1);
            if (item) next.splice(to, 0, item);
            return next;
        });
    };
    const order = kinds.map((_, i) => i).reverse();
    const current = open !== null ? lists[0]?.[open] : undefined;
    // ⌘C, ⌘V and ⌘D on a highlighted row copy, paste (after it) and duplicate the effect.
    const rowKeys = (i: number) => (e: React.KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const k = e.key.toLowerCase();
        const effect = lists[0]?.[i];
        if (k === "c" && effect) effectClipboard = { ...effect };
        else if (k === "v" && effectClipboard) write((list) => [...list.slice(0, i + 1), { ...(effectClipboard as Effect) }, ...list.slice(i + 1)]);
        else if (k === "d" && effect) write((list) => [...list.slice(0, i + 1), { ...effect }, ...list.slice(i + 1)]);
        else return;
        e.preventDefault();
        e.stopPropagation();
    };
    return (
        <div className="space-y-2">
            {order.map((i) => {
                const e = lists[0]?.[i] as Effect;
                const visible = lists.every((l) => l[i]?.visible);
                return (
                    <div
                        key={i}
                        ref={(el) => {
                            if (el) rows.current.set(i, el);
                            else rows.current.delete(i);
                        }}
                        onDragOver={(ev) => {
                            if (dragging === null) return;
                            ev.preventDefault();
                            setOver(i);
                        }}
                        onDrop={(ev) => {
                            ev.preventDefault();
                            if (dragging !== null) move(dragging, i);
                            setDragging(null);
                            setOver(null);
                        }}
                        className={`group/row relative flex items-center ${over === i && dragging !== null && dragging !== i ? (dragging < i ? "before:absolute before:-top-0.5 before:right-0 before:left-0 before:h-0.5 before:bg-brand-500" : "after:absolute after:right-0 after:-bottom-0.5 after:left-0 after:h-0.5 after:bg-brand-500") : ""}`}
                    >
                        <span
                            draggable
                            role="button"
                            aria-label="Drag to reorder"
                            title="Drag to reorder"
                            onDragStart={(ev) => {
                                ev.dataTransfer.effectAllowed = "move";
                                ev.dataTransfer.setData("text/plain", String(i));
                                setDragging(i);
                            }}
                            onDragEnd={() => {
                                setDragging(null);
                                setOver(null);
                            }}
                            className="absolute -left-3 flex h-6 w-3 cursor-grab items-center justify-center text-ink-subtle opacity-0 group-hover/row:opacity-100"
                        >
                            <svg viewBox="0 0 6 12" className="h-3 w-1.5" fill="currentColor" aria-hidden="true">
                                <circle cx="1.5" cy="2" r="1" />
                                <circle cx="4.5" cy="2" r="1" />
                                <circle cx="1.5" cy="6" r="1" />
                                <circle cx="4.5" cy="6" r="1" />
                                <circle cx="1.5" cy="10" r="1" />
                                <circle cx="4.5" cy="10" r="1" />
                            </svg>
                        </span>
                        <AriaButton
                            aria-label={`${EFFECT_LABELS[e.type]} settings`}
                            aria-expanded={open === i}
                            onKeyDown={(ev) => {
                                if (ev.metaKey || ev.ctrlKey) rowKeys(i)(ev as unknown as React.KeyboardEvent);
                                else ev.continuePropagation();
                            }}
                            onPress={() => onOpenChange(open === i ? null : i)}
                            className={`flex h-6 w-[155px] min-w-0 shrink-0 items-center gap-2 rounded-md border pr-2 pl-1.5 text-left outline-none focus-visible:border-brand-500 ${open === i ? "border-transparent bg-brand-100" : "border-panel-border hover:border-ink-subtle"} ${visible ? "text-ink" : "text-ink-subtle"}`}
                        >
                            <span className={`flex size-4 shrink-0 items-center justify-center ${visible ? "text-ink-muted" : "text-ink-subtle"}`}>
                                <EffectIcon type={e.type} />
                            </span>
                            <span className="min-w-0 flex-1 truncate">{EFFECT_LABELS[e.type]}</span>
                        </AriaButton>
                        {/* An outlined 155pt pill, then the eye and remove in the trailing columns. */}
                        <span className="ml-auto" />
                        <IconButton size="sm" icon={visible ? Eye : EyeOff} label={visible ? "Hide effect" : "Show effect"} onPress={() => write(patchAt(i, { visible: !visible }))} />
                        <span className="w-1" />
                        <IconButton
                            size="sm"
                            icon={Minus}
                            label="Remove effect"
                            onPress={() => {
                                if (open !== null) onOpenChange(null);
                                write((list) => list.filter((_, k) => k !== i));
                            }}
                        />
                    </div>
                );
            })}
            {open !== null && current && (
                <SettingsPopover row={() => rows.current.get(open) ?? null} onClose={() => onOpenChange(null)} label={EFFECT_LABELS[current.type]}>
                    <EffectSettings
                        i={open}
                        nodes={nodes}
                        effect={current}
                        bindIndex={open - legacyCount}
                        sharedAt={sharedAt}
                        write={write}
                        preview={preview}
                        endPreview={endPreview}
                        patchAt={patchAt}
                        onClose={() => onOpenChange(null)}
                    />
                </SettingsPopover>
            )}
        </div>
    );
}

// The settings window sits just left of the panel, level with its row. Rows span the section's
// content, which starts 12px in from the panel's edge.
function SettingsPopover({ row, onClose, label, children }: { row: () => HTMLElement | null; onClose: () => void; label: string; children: React.ReactNode }) {
    // Read when the popover positions itself, after the row (maybe just added) is on screen.
    const trigger = { get current() { return row(); } };
    return (
        <AriaPopover
            triggerRef={trigger}
            isOpen
            onOpenChange={(isOpen) => !isOpen && onClose()}
            placement="left top"
            offset={20}
            shouldFlip={false}
            // The ramp handles on the canvas and the row's own button don't close it (the button toggles).
            shouldCloseOnInteractOutside={(target) => !target.closest("[data-ramp-handles]") && !row()?.contains(target)}
            className="w-60 rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none"
        >
            <AriaDialog className="outline-none" aria-label={label}>
                {children}
            </AriaDialog>
        </AriaPopover>
    );
}

// One effect's settings: a header with its kind (a menu to switch it), the blend mode where it
// applies and close, then label and value rows for the kind.
function EffectSettings({
    i,
    nodes,
    effect: e,
    bindIndex,
    sharedAt,
    write,
    preview,
    endPreview,
    patchAt,
    onClose,
}: {
    i: number;
    nodes: SceneNode[];
    effect: Effect;
    bindIndex: number;
    sharedAt: <T>(i: number, pick: (e: Effect) => T) => T | null;
    write: (map: ListMap) => void;
    preview: (map: ListMap) => void;
    endPreview: () => void;
    patchAt: (i: number, p: Partial<Effect> | ((e: Effect) => Partial<Effect>)) => (list: Effect[]) => Effect[];
    onClose: () => void;
}) {
    type Opts = { min?: number; max?: number; unit?: string; title?: string; icon?: React.ReactNode; step?: number };
    // A number field over one effect value; `read` and `put` convert between the stored and shown value.
    const numOf = (read: (x: Effect) => number, put: (v: number) => Partial<Effect>, label: string, opts: Opts = {}) => {
        const value = sharedAt(i, read);
        return (
            <NumberField
                label={label}
                icon={opts.icon}
                title={opts.title ?? label}
                unit={opts.unit}
                min={opts.min}
                max={opts.max}
                step={opts.step}
                value={value === null ? null : Math.round(value * 100) / 100}
                onCommit={(v) => write(patchAt(i, put(v)))}
                onScrub={(v) => preview(patchAt(i, put(v)))}
                onScrubEnd={(v) => write(patchAt(i, put(v)))}
                onRelative={(fn) => write(patchAt(i, (x) => put(fn(read(x)))))}
            />
        );
    };
    const pct = (key: "density" | "lightIntensity", label: string, fallback: number, icon?: React.ReactNode) =>
        numOf((x) => (x[key] ?? fallback) * 100, (v) => ({ [key]: Math.min(1, Math.max(0, v / 100)) }), label, { min: 0, max: 100, unit: "%", icon });
    const blurField = () => {
        const field = numOf((x) => x.blur, (v) => ({ blur: Math.max(0, v) }), "Blur", { min: 0, icon: <FieldIcon kind="blur" /> });
        return bindIndex >= 0 && nodes.length === 1 ? (
            <Bindable nodes={nodes} field={`effect:${bindIndex}:blur`} label="effect blur">
                {field}
            </Bindable>
        ) : (
            field
        );
    };
    const colorRow = (label: string, which: 1 | 2) => {
        const colorOf = (x: Effect) => (which === 1 ? x.color : (x.color2 ?? "#FFFFFF"));
        const put = (c: string, o: number): Partial<Effect> => (which === 1 ? { color: c, opacity: o } : { color2: c, opacity2: o });
        return (
            <Row label={label}>
                <ColorField
                    color={sharedAt(i, colorOf)}
                    opacity={sharedAt(i, (x) => (which === 1 ? x.opacity : (x.opacity2 ?? 1)))}
                    label={which === 1 ? "Effect colour" : "Second colour"}
                    onChange={(c, o) => write(patchAt(i, put(c, o)))}
                    onPreview={(c, o) => preview(patchAt(i, put(c, o)))}
                    onOpacity={(o) => write(patchAt(i, (x) => put(colorOf(x), o)))}
                />
            </Row>
        );
    };
    const check = (label: string, on: boolean, patch: (on: boolean) => Partial<Effect>) => <CheckRow label={label} checked={on} onChange={(v) => write(patchAt(i, patch(v)))} />;
    const shadow = e.type === "drop-shadow" || e.type === "inner-shadow";
    const blend = sharedAt(i, (x) => x.blend ?? "normal");

    let body: React.ReactNode = null;
    if (shadow) {
        body = (
            <>
                <Row label="Position" top>
                    {numOf((x) => x.x, (v) => ({ x: v }), "X", { title: "X offset" })}
                    {numOf((x) => x.y, (v) => ({ y: v }), "Y", { title: "Y offset" })}
                </Row>
                <Row label="Blur">{blurField()}</Row>
                {/* Spread applies to rectangles, ellipses and frames with a visible fill, as in the reference. */}
                {nodes.every((n) => (n.type === "rect" || n.type === "ellipse" || n.type === "frame" || n.type === "component" || n.type === "instance") && n.fills.some((p) => p.visible)) && (
                    <Row label="Spread">{numOf((x) => x.spread, (v) => ({ spread: v }), "Spread", { icon: <FieldIcon kind="spread" /> })}</Row>
                )}
                {colorRow("Color", 1)}
                {e.type === "drop-shadow" && (
                    <>
                        <Divider />
                        {check("Show behind transparent areas", sharedAt(i, (x) => x.showBehind !== false) ?? false, (on) => ({ showBehind: on }))}
                    </>
                )}
            </>
        );
    } else if (e.type === "layer-blur" || e.type === "background-blur") {
        body = (
            <>
                <Segmented
                    value={sharedAt(i, (x) => (x.progressive ? "progressive" : "uniform"))}
                    options={[
                        { id: "uniform", label: "Uniform" },
                        { id: "progressive", label: "Progressive" },
                    ]}
                    onChange={(v) => {
                        const ramp = RAMPS[0] as (typeof RAMPS)[number];
                        write(patchAt(i, v === "progressive" ? { progressive: { startBlur: 0, from: ramp.from, to: ramp.to } } : { progressive: null }));
                    }}
                />
                {e.progressive ? (
                    <>
                        <Row label="Blur" top>
                            {numOf((x) => x.progressive?.startBlur ?? 0, (v) => ({ progressive: { ...(e.progressive as NonNullable<Effect["progressive"]>), startBlur: Math.max(0, v) } }), "Start", { min: 0, icon: <FieldIcon kind="blur-start" />, title: "Blur at the start" })}
                            {numOf((x) => x.blur, (v) => ({ blur: Math.max(0, v) }), "End", { min: 0, icon: <FieldIcon kind="blur" />, title: "Blur at the end" })}
                        </Row>
                        <Row label="Direction">
                            <Select
                                aria-label="Blur direction"
                                value={rampOf(e.progressive)}
                                onChange={(ev) => {
                                    const ramp = RAMPS.find((r) => r.id === ev.target.value);
                                    if (ramp) write(patchAt(i, (x) => ({ progressive: { startBlur: x.progressive?.startBlur ?? 0, from: ramp.from, to: ramp.to } })));
                                }}
                                className="h-6 w-full rounded-md border border-transparent bg-panel-hover pl-2 text-ink hover:border-panel-border"
                            >
                                {RAMPS.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.label}
                                    </option>
                                ))}
                                {rampOf(e.progressive) === "custom" && <option value="custom">Custom</option>}
                            </Select>
                        </Row>
                        {nodes.length === 1 && nodes[0] ? (
                            <>
                                <p className="text-ink-subtle">Drag the handles on the canvas to move where the blur starts and ends.</p>
                                <RampHandles nodeId={nodes[0].id} ramp={e.progressive} onChange={(p) => write(patchAt(i, { progressive: p }))} onPreview={(p) => preview(patchAt(i, { progressive: p }))} />
                            </>
                        ) : null}
                    </>
                ) : (
                    <Row label="Blur">{blurField()}</Row>
                )}
            </>
        );
    } else if (e.type === "motion-blur") {
        body = (
            <>
                <Row label="Blur">{blurField()}</Row>
                <Row label="Angle">{numOf((x) => x.angle ?? 0, (v) => ({ angle: ((v % 360) + 360) % 360 }), "Angle", { unit: "°", icon: <FieldIcon kind="angle" /> })}</Row>
            </>
        );
    } else if (e.type === "noise") {
        const type = sharedAt(i, (x) => x.noiseType ?? "mono");
        body = (
            <>
                <Segmented
                    value={type}
                    options={[
                        { id: "mono", label: "Mono" },
                        { id: "duo", label: "Duo" },
                        { id: "multi", label: "Multi" },
                    ]}
                    onChange={(v) => write(patchAt(i, { noiseType: v }))}
                />
                <Row label="Noise size" top>
                    {numOf((x) => x.noiseSize ?? 0.5, (v) => ({ noiseSize: Math.max(0.1, v) }), "X", { min: 0.1, step: 0.1, title: "Noise width" })}
                    {numOf((x) => x.noiseSizeY ?? x.noiseSize ?? 0.5, (v) => ({ noiseSizeY: Math.max(0.1, v) }), "Y", { min: 0.1, step: 0.1, title: "Noise height" })}
                </Row>
                <Row label="Density">{pct("density", "Density", 1, <FieldIcon kind="density" />)}</Row>
                {type === "multi" ? (
                    <Row label="Opacity">{numOf((x) => x.opacity * 100, (v) => ({ opacity: Math.min(1, Math.max(0, v / 100)) }), "Opacity", { min: 0, max: 100, unit: "%", icon: <FieldIcon kind="opacity" />, title: "Noise opacity" })}</Row>
                ) : (
                    <>
                        {colorRow("Color", 1)}
                        {type === "duo" && colorRow("", 2)}
                    </>
                )}
            </>
        );
    } else if (e.type === "texture") {
        body = (
            <>
                <Row label="Size" top>
                    {numOf((x) => x.noiseSize ?? 0.5, (v) => ({ noiseSize: Math.max(0.1, v) }), "X", { min: 0.1, step: 0.1, title: "Grain width" })}
                    {numOf((x) => x.noiseSizeY ?? x.noiseSize ?? 0.5, (v) => ({ noiseSizeY: Math.max(0.1, v) }), "Y", { min: 0.1, step: 0.1, title: "Grain height" })}
                </Row>
                <Row label="Radius">{numOf((x) => x.blur, (v) => ({ blur: Math.max(0, v) }), "Radius", { min: 0, icon: <FieldIcon kind="radius" />, title: "How far edges move" })}</Row>
                <Divider />
                {check("Clip to shape", sharedAt(i, (x) => x.clipToShape !== false) ?? true, (on) => ({ clipToShape: on }))}
            </>
        );
    } else if (e.type === "shader") {
        const shader = e.shader ?? { code: "", uniforms: [] };
        body = (
            <>
                <ShaderEditor value={shader} onChange={(next) => write(patchAt(i, { shader: next }))} onPreview={(next) => preview(patchAt(i, { shader: next }))} />
                <Row label="Opacity">{numOf((x) => x.opacity * 100, (v) => ({ opacity: Math.min(1, Math.max(0, v / 100)) }), "Opacity", { min: 0, max: 100, unit: "%", icon: <FieldIcon kind="opacity" />, title: "Shader opacity" })}</Row>
            </>
        );
    } else if (e.type === "glass") {
        const slider = (label: string, read: (x: Effect) => number, put: (v: number) => Partial<Effect>, max: number) => (
            <SliderRow label={label} value={sharedAt(i, read)} max={max} onPreview={(v) => preview(patchAt(i, put(v)))} onChange={(v) => write(patchAt(i, put(v)))} />
        );
        body = (
            <>
                <Row label="Light" top>
                    <div className="flex gap-1">
                        <LightPad angle={sharedAt(i, (x) => x.lightAngle ?? -45) ?? -45} onPreview={(a) => preview(patchAt(i, { lightAngle: a }))} onChange={(a) => write(patchAt(i, { lightAngle: a }))} />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {numOf((x) => x.lightAngle ?? -45, (v) => ({ lightAngle: ((((v + 180) % 360) + 360) % 360) - 180 }), "Angle", { unit: "°", icon: <FieldIcon kind="angle" />, title: "Light angle" })}
                            {pct("lightIntensity", "Intensity", 0.8, <FieldIcon kind="light" />)}
                        </div>
                    </div>
                </Row>
                <Divider />
                {slider("Refraction", (x) => Math.round((x.refraction ?? 0.8) * 100), (v) => ({ refraction: v / 100 }), 100)}
                {slider("Depth", (x) => x.depth ?? 20, (v) => ({ depth: Math.max(1, v) }), 100)}
                {slider("Dispersion", (x) => Math.round((x.dispersion ?? 0.5) * 100), (v) => ({ dispersion: v / 100 }), 100)}
                {slider("Frost", (x) => x.blur, (v) => ({ blur: Math.max(0, v) }), 100)}
                {slider("Splay", (x) => Math.round((x.splay ?? 0) * 100), (v) => ({ splay: v / 100 }), 100)}
            </>
        );
    }

    return (
        <>
            <div className="flex h-10 items-center gap-0.5 border-b border-panel-border px-1.5">
                <EffectTypeMenu label="Effect type" value={e.type} onPick={(type) => write((list) => list.map((x, k) => (k === i ? retype(x, type) : x)))}>
                    <AriaButton aria-label="Effect type" className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 font-semibold outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        <span className="flex size-4 shrink-0 items-center justify-center text-ink-muted">
                            <EffectIcon type={e.type} />
                        </span>
                        <span className="truncate">{EFFECT_LABELS[e.type]}</span>
                        <ChevronDown className="size-3 shrink-0 text-ink-subtle mr-0.5" />
                    </AriaButton>
                </EffectTypeMenu>
                <span className="flex-1" />
                {(shadow || e.type === "noise" || e.type === "shader") && (
                    <BlendMenu value={blend} label="Effect blend mode" onChange={(b: BlendMode) => write(patchAt(i, { blend: b }))} onPreview={(b) => (b ? preview(patchAt(i, { blend: b })) : endPreview())}>
                        <AriaButton aria-label="Blend mode" className={`flex size-6 items-center justify-center rounded-md outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 ${blend === "normal" ? "text-ink-muted hover:text-ink" : "bg-brand-100 text-brand-500"}`}>
                            <BlendIcon className="size-3.5" />
                        </AriaButton>
                    </BlendMenu>
                )}
                <AriaButton aria-label="Close" onPress={onClose} className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                    <XClose className="size-3.5" />
                </AriaButton>
            </div>
            <div className="space-y-2 p-3">{body}</div>
        </>
    );
}

// A colour in a field: swatch, hex and opacity.
function ColorField({
    color,
    opacity,
    label,
    onChange,
    onPreview,
    onOpacity,
}: {
    color: string | null;
    opacity: number | null;
    label: string;
    onChange: (color: string, opacity: number) => void;
    onPreview: (color: string, opacity: number) => void;
    onOpacity: (opacity: number) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const hex = color ? color.replace("#", "").toUpperCase() : "Mixed";
    const commit = () => {
        const v = (draft ?? "").replace("#", "").trim();
        const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
        if (/^[0-9a-fA-F]{6}$/.test(full)) onChange(`#${full.toUpperCase()}`, opacity ?? 1);
        setDraft(null);
    };
    return (
        <div className="flex h-6 min-w-0 items-center rounded-md border border-transparent bg-panel-hover focus-within:border-brand-500 hover:border-panel-border">
            <span className="flex w-7 shrink-0 items-center justify-center">
                <ColorSwatch color={color ?? "#000000"} opacity={opacity ?? 1} size={4} label={label} onChange={onChange} onPreview={onPreview} />
            </span>
            <input
                aria-label="Hex colour"
                value={draft ?? hex}
                onFocus={(ev) => {
                    setDraft(hex === "Mixed" ? "" : hex);
                    ev.currentTarget.select();
                }}
                onChange={(ev) => setDraft(ev.target.value)}
                onBlur={commit}
                onKeyDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.key === "Enter") ev.currentTarget.blur();
                    if (ev.key === "Escape") {
                        setDraft(null);
                        ev.currentTarget.blur();
                    }
                }}
                className="h-full min-w-0 flex-1 bg-transparent uppercase outline-none"
            />
            <span className="h-4 w-px shrink-0 bg-panel-border" />
            <BareNumber label="Opacity" unit="%" value={opacity === null ? null : Math.round(opacity * 100)} onCommit={(v) => onOpacity(v / 100)} />
        </div>
    );
}

// A bare number with an optional unit after it: the opacity in a colour field, a slider's value.
function BareNumber({ value, onCommit, label, min = 0, max = 100, unit, className = "w-[52px] pr-2 pl-2" }: { value: number | null; onCommit: (v: number) => void; label: string; min?: number; max?: number; unit?: string; className?: string }) {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = value === null ? "Mixed" : String(value);
    return (
        <label className={`flex h-full shrink-0 items-center ${className}`}>
            <input
                aria-label={label}
                value={draft ?? shown}
                onFocus={(ev) => {
                    setDraft(shown);
                    ev.currentTarget.select();
                }}
                onChange={(ev) => setDraft(ev.target.value)}
                onBlur={() => {
                    const n = Number((draft ?? "").replace(unit ?? "%", "").trim());
                    if (draft !== null && draft !== shown && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
                    setDraft(null);
                }}
                onKeyDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.key === "Enter") ev.currentTarget.blur();
                    if (ev.key === "Escape") {
                        setDraft(shown);
                        ev.currentTarget.blur();
                    }
                    if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && value !== null) {
                        ev.preventDefault();
                        onCommit(Math.min(max, Math.max(min, value + (ev.key === "ArrowUp" ? 1 : -1) * (ev.shiftKey ? 10 : 1))));
                    }
                }}
                className="h-full min-w-0 flex-1 bg-transparent outline-none"
            />
            {unit && <span className="text-ink-subtle">{unit}</span>}
        </label>
    );
}

// A label, a slider and its value, for the glass settings.
function SliderRow({ label, value, max, onChange, onPreview }: { label: string; value: number | null; max: number; onChange: (v: number) => void; onPreview: (v: number) => void }) {
    const [drag, setDrag] = useState<number | null>(null);
    const shown = Math.min(max, drag ?? value ?? 0);
    const end = () => {
        if (drag !== null) onChange(drag);
        setDrag(null);
    };
    return (
        <div className="grid min-h-6 grid-cols-[56px_minmax(0,1fr)_40px] items-center gap-2">
            <span className="truncate text-ink-muted">{label}</span>
            <input
                type="range"
                aria-label={label}
                min={0}
                max={max}
                step={1}
                value={shown}
                onChange={(ev) => {
                    const v = Number(ev.target.value);
                    setDrag(v);
                    onPreview(v);
                }}
                onPointerUp={end}
                onKeyUp={end}
                onBlur={end}
                className="glass-slider h-4 w-full min-w-0"
                style={{ "--fill": `${(shown / max) * 100}%` } as React.CSSProperties}
            />
            <div className="h-6 rounded-md border border-transparent bg-panel-hover focus-within:border-brand-500 hover:border-panel-border">
                <BareNumber label={label} max={max} value={value} onCommit={onChange} className="w-full px-2" />
            </div>
        </div>
    );
}

// The light's direction: a square pad with a dot on a ring; drag the dot to turn the light.
function LightPad({ angle, onChange, onPreview }: { angle: number; onChange: (a: number) => void; onPreview: (a: number) => void }) {
    const [drag, setDrag] = useState<number | null>(null);
    const shown = drag ?? angle;
    const rad = (shown * Math.PI) / 180;
    const r = 19;
    const at = (ev: React.PointerEvent<HTMLDivElement>) => {
        const box = ev.currentTarget.getBoundingClientRect();
        const a = (Math.atan2(ev.clientY - (box.top + box.height / 2), ev.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
        // Shift snaps to 15° steps.
        return Math.round(ev.shiftKey ? Math.round(a / 15) * 15 : a);
    };
    return (
        <div
            role="slider"
            aria-label="Light direction"
            aria-valuenow={Math.round(shown)}
            aria-valuemin={-180}
            aria-valuemax={180}
            tabIndex={0}
            title={`${Math.round(shown)}°`}
            onPointerDown={(ev) => {
                ev.currentTarget.setPointerCapture(ev.pointerId);
                const a = at(ev);
                setDrag(a);
                onPreview(a);
            }}
            onPointerMove={(ev) => {
                if (drag === null) return;
                const a = at(ev);
                setDrag(a);
                onPreview(a);
            }}
            onPointerUp={() => {
                if (drag !== null) onChange(drag);
                setDrag(null);
            }}
            onKeyDown={(ev) => {
                if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
                ev.preventDefault();
                ev.stopPropagation();
                const step = (ev.key === "ArrowRight" ? 1 : -1) * (ev.shiftKey ? 15 : 1);
                onChange(((((angle + step + 180) % 360) + 360) % 360) - 180);
            }}
            className="relative size-[60px] shrink-0 cursor-pointer rounded-md bg-panel-hover text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
            <svg viewBox="-30 -30 60 60" className="size-full" aria-hidden="true">
                <defs>
                    <radialGradient id="glass-light" cx={0.5 + Math.cos(rad) * 0.35} cy={0.5 + Math.sin(rad) * 0.35} r="0.9">
                        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
                        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                    </radialGradient>
                </defs>
                <rect x={-30} y={-30} width={60} height={60} fill="url(#glass-light)" />
                {/* The object the light falls on. */}
                <rect x={-8} y={-8} width={16} height={16} rx={3} fill="#FFFFFF" fillOpacity="0.12" stroke="#FFFFFF" strokeOpacity="0.45" />
                {/* The light: a small sun where it sits. */}
                <g transform={`translate(${Math.cos(rad) * r} ${Math.sin(rad) * r})`} stroke="#0D99FF" strokeWidth={1.4} strokeLinecap="round">
                    <circle r={3} fill="#FFFFFF" />
                    <path d="M0 -6v-1.5M0 6v1.5M-6 0h-1.5M6 0h1.5M-4.2 -4.2l-1 -1M4.2 4.2l1 1M-4.2 4.2l-1 1M4.2 -4.2l1 -1" />
                </g>
            </svg>
            {drag !== null && <span className="pointer-events-none absolute right-0 bottom-0.5 left-0 text-center text-[9px] text-ink-muted">{Math.round(drag)}°</span>}
        </div>
    );
}

// Small marks for the value fields, drawn here.
function FieldIcon({ kind }: { kind: "blur" | "blur-start" | "spread" | "density" | "radius" | "angle" | "light" | "opacity" }) {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            {kind === "blur" && (
                <g fill="currentColor" stroke="none">
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="4.5" cy="8" r="1" />
                    <circle cx="11.5" cy="8" r="1" />
                    <circle cx="8" cy="4.5" r="1" />
                    <circle cx="8" cy="11.5" r="1" />
                    <circle cx="4.5" cy="4.5" r=".6" />
                    <circle cx="11.5" cy="4.5" r=".6" />
                    <circle cx="4.5" cy="11.5" r=".6" />
                    <circle cx="11.5" cy="11.5" r=".6" />
                    <circle cx="1.5" cy="8" r=".5" />
                    <circle cx="14.5" cy="8" r=".5" />
                    <circle cx="8" cy="1.5" r=".5" />
                    <circle cx="8" cy="14.5" r=".5" />
                </g>
            )}
            {kind === "blur-start" && <circle cx="8" cy="8" r="4.5" />}
            {kind === "spread" && (
                <>
                    <circle cx="8" cy="8" r="2.5" />
                    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
                </>
            )}
            {kind === "density" && <path d="M4 4h.01M8 4h.01M12 4h.01M4 8h.01M8 8h.01M12 8h.01M4 12h.01M8 12h.01M12 12h.01" strokeWidth="2" strokeLinecap="round" />}
            {kind === "radius" && <path d="M3 13V8a5 5 0 0 1 5-5h5" strokeLinecap="round" />}
            {kind === "angle" && <path d="M3 13h10M3 13l7-8M7.5 13a4.5 4.5 0 0 0-1.4-3.3" strokeLinecap="round" strokeLinejoin="round" />}
            {kind === "light" && (
                <>
                    <circle cx="8" cy="8" r="3" />
                    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5" strokeLinecap="round" />
                </>
            )}
            {kind === "opacity" && <OpacityMark />}
        </svg>
    );
}

// A small checkerboard square: the opacity mark.
export function OpacityMark() {
    return (
        <>
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M3 3h5v5H3zM8 8h5v5H8z" fill="currentColor" stroke="none" fillOpacity="0.55" />
        </>
    );
}

function ShaderIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M5 11c1.5-4 4.5-4 6-6" strokeLinecap="round" />
        </svg>
    );
}

// Small marks for each kind of effect, drawn here.
export function EffectIcon({ type }: { type: Effect["type"] }) {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            {type === "drop-shadow" && (
                <>
                    <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" />
                    <path d="M12.5 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-6" strokeWidth="2" strokeOpacity="0.5" />
                </>
            )}
            {type === "inner-shadow" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                    <path d="M4.5 11.5v-7h7" strokeWidth="2" strokeOpacity="0.5" />
                </>
            )}
            {type === "layer-blur" && (
                <>
                    <circle cx="8" cy="8" r="5.5" strokeDasharray="1.6 1.6" />
                    <circle cx="8" cy="8" r="2.5" />
                </>
            )}
            {type === "background-blur" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="1.6 1.6" />
                    <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
                </>
            )}
            {type === "noise" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                    <path d="M5 5h.01M8 4.5h.01M11 6h.01M6 8h.01M9.5 8.5h.01M5 11h.01M8 11.5h.01M11 10.5h.01" strokeWidth="1.6" strokeLinecap="round" />
                </>
            )}
            {type === "texture" && <path d="M3 4l1.5-1 1.5 1 1.5-1 1.5 1 1.5-1 1.5 1.2v8.3l-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" />}
            {type === "glass" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
                    <path d="M5 9.5L9.5 5M7 11l4-4" strokeLinecap="round" strokeOpacity="0.6" />
                </>
            )}
            {type === "shader" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                    <path d="M5 11c1.5-4 4.5-4 6-6" strokeLinecap="round" />
                </>
            )}
            {type === "motion-blur" && (
                <>
                    <circle cx="10.5" cy="8" r="3" />
                    <path d="M1.5 6h4M2.5 8h3M1.5 10h4" strokeLinecap="round" />
                </>
            )}
        </svg>
    );
}

// Handles on the canvas for a progressive blur's start and end, while its settings are open.
function RampHandles({ nodeId, ramp, onChange, onPreview }: { nodeId: string; ramp: NonNullable<Effect["progressive"]>; onChange: (r: NonNullable<Effect["progressive"]>) => void; onPreview: (r: NonNullable<Effect["progressive"]>) => void }) {
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    const node = doc.nodes[nodeId];
    const drag = useRef<"from" | "to" | null>(null);
    const rect = canvasRect();
    if (!node || !rect) return null;
    const m = worldMatrix(doc, node);
    const toScreen = (p: { x: number; y: number }) => {
        const w = m.transformPoint(new DOMPoint(node.x + p.x * node.w, node.y + p.y * node.h));
        const s = worldToScreen(camera, w.x, w.y);
        return { x: s.x + rect.left, y: s.y + rect.top };
    };
    const toBox = (clientX: number, clientY: number) => {
        const l = m.inverse().transformPoint(new DOMPoint((clientX - rect.left - camera.x) / camera.zoom, (clientY - rect.top - camera.y) / camera.zoom));
        return { x: node.w ? (l.x - node.x) / node.w : 0, y: node.h ? (l.y - node.y) / node.h : 0 };
    };
    const a = toScreen(ramp.from);
    const b = toScreen(ramp.to);
    const move = (e: React.PointerEvent, commit: boolean) => {
        const part = drag.current;
        if (!part) return;
        const next = { ...ramp, [part]: toBox(e.clientX, e.clientY) };
        if (commit) onChange(next);
        else onPreview(next);
    };
    const handle = (part: "from" | "to", at: { x: number; y: number }, label: string) => (
        <circle
            aria-label={label}
            role="button"
            cx={at.x}
            cy={at.y}
            r={6}
            fill={part === "from" ? "#FFFFFF" : "#0D99FF"}
            stroke={part === "from" ? "#0D99FF" : "#FFFFFF"}
            strokeWidth={2}
            style={{ pointerEvents: "all", cursor: "grab" }}
            onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = part;
            }}
            onPointerMove={(e) => move(e, false)}
            onPointerUp={(e) => {
                move(e, true);
                drag.current = null;
            }}
        />
    );
    return createPortal(
        <svg data-ramp-handles="" className="pointer-events-none fixed inset-0 z-40 size-full overflow-visible" aria-label="Progressive blur handles">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFFFFF" strokeWidth={3} strokeOpacity={0.8} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0D99FF" strokeWidth={1} strokeDasharray="4 3" />
            {handle("from", a, "Blur start")}
            {handle("to", b, "Blur end")}
        </svg>,
        document.body,
    );
}

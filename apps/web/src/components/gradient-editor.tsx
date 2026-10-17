import { Minus, Plus, RefreshCw01, SwitchHorizontal01 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { worldToScreen } from "../engine/camera";
import { gradientAngle, withAngle } from "../engine/paint";
import { useEditor } from "../engine/store";
import { worldMatrix } from "../engine/transform";
import type { GradientPaint, GradientStop, Paint, SceneNode } from "../engine/types";
import { ColorPicker, type ContrastInfo } from "./color-picker";
import { IconButton } from "./icon-button";
import { canvasRect } from "./canvas-rect";
import { NumberField } from "./number-field";
import { VarButton } from "./variable-picker";

// The gradient editor, like the reference's: the stop bar (click to add, drag to move, Delete removes the
// selected stop), flip and rotate, the selected stop's colour, a list of every stop (position,
// colour, position, variable, remove; the selected stop's opacity is in its colour picker), and handles on the canvas to move, turn and stretch the
// gradient and slide its stops.

export interface GradientBinding {
    nodes: SceneNode[];
    // The paint's binding key ("fill:0"); stops bind as "fill:0:stop:1".
    key: string;
}

const sortStops = (stops: GradientStop[]) => [...stops].sort((a, b) => a.position - b.position);

export function GradientEditor({ paint, onChange, onPreview, bind, contrast }: { paint: GradientPaint; onChange: (p: Paint) => void; onPreview: (p: Paint) => void; bind?: GradientBinding; contrast?: ContrastInfo }) {
    const [selected, setSelected] = useState(0);
    const bar = useRef<HTMLDivElement>(null);
    const index = Math.min(selected, paint.stops.length - 1);
    const stop = paint.stops[index];
    const sorted = sortStops(paint.stops);
    const positionAt = (clientX: number) => {
        const rect = bar.current?.getBoundingClientRect();
        if (!rect) return 0;
        return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };
    const setStop = (i: number, patch: Partial<GradientStop>, live = false) => {
        const next = { ...paint, stops: paint.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) };
        if (live) onPreview(next);
        else onChange(next);
    };
    const removeStop = (i: number) => {
        if (paint.stops.length <= 2) return;
        onChange({ ...paint, stops: paint.stops.filter((_, k) => k !== i) });
        setSelected(Math.max(0, Math.min(i, paint.stops.length - 2)));
    };
    const addStop = (position: number) => {
        // A new stop takes the colour already at that point of the gradient.
        const near = sorted.reduce((best, s) => (Math.abs(s.position - position) < Math.abs(best.position - position) ? s : best), sorted[0] ?? { position: 0, color: "#000000", opacity: 1 });
        onChange({ ...paint, stops: [...paint.stops, { position, color: near.color, opacity: near.opacity }] });
        setSelected(paint.stops.length);
    };
    // Flip reverses the stops; rotate turns the gradient a quarter turn about the box centre.
    const flip = () => onChange({ ...paint, stops: paint.stops.map((s) => ({ ...s, position: 1 - s.position })) });
    const rotate = () => {
        const turn = (p: { x: number; y: number }) => ({ x: 0.5 - (p.y - 0.5), y: 0.5 + (p.x - 0.5) });
        onChange({ ...paint, from: turn(paint.from), to: turn(paint.to) });
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            removeStop(index);
        }
    };
    const css = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ")})`;
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1">
                <div
                    ref={bar}
                    tabIndex={0}
                    aria-label="Gradient stops. Click to add a stop; Delete removes the selected one."
                    onKeyDown={onKey}
                    className="relative h-6 min-w-0 flex-1 cursor-copy rounded border border-panel-border outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    style={{ background: `${css}, repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px` }}
                    onPointerDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        addStop(positionAt(e.clientX));
                    }}
                >
                    {paint.stops.map((s, i) => (
                        <button
                            key={i}
                            type="button"
                            aria-label={`Stop at ${Math.round(s.position * 100)}%`}
                            onKeyDown={onKey}
                            className={`absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border-2 shadow outline-none ${i === index ? "border-brand-500" : "border-white"}`}
                            style={{ left: `${s.position * 100}%`, background: s.color }}
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                setSelected(i);
                                e.currentTarget.setPointerCapture(e.pointerId);
                            }}
                            onPointerMove={(e) => {
                                if (e.currentTarget.hasPointerCapture(e.pointerId)) setStop(i, { position: positionAt(e.clientX) }, true);
                            }}
                            onPointerUp={(e) => {
                                if (e.currentTarget.hasPointerCapture(e.pointerId)) setStop(i, { position: positionAt(e.clientX) });
                            }}
                        />
                    ))}
                </div>
                <IconButton size="sm" icon={SwitchHorizontal01} label="Flip gradient" onPress={flip} />
                <IconButton size="sm" icon={RefreshCw01} label="Rotate gradient 90°" onPress={rotate} />
            </div>
            {stop && (
                <ColorPicker
                    color={stop.color}
                    opacity={stop.opacity}
                    contrast={contrast}
                    onChange={(color, opacity) => setStop(index, { color, opacity })}
                    onPreview={(color, opacity) => setStop(index, { color, opacity }, true)}
                />
            )}
            {paint.type !== "radial" && paint.type !== "diamond" && (
                <NumberField
                    label="∠"
                    title="Gradient angle"
                    suffix="°"
                    value={Math.round(gradientAngle(paint))}
                    onCommit={(deg) => {
                        if (paint.type === "linear") onChange(withAngle(paint, deg));
                        else {
                            const rad = (deg * Math.PI) / 180;
                            const len = Math.hypot(paint.to.x - paint.from.x, paint.to.y - paint.from.y) || 0.5;
                            onChange({ ...paint, to: { x: paint.from.x + Math.cos(rad) * len, y: paint.from.y + Math.sin(rad) * len } });
                        }
                    }}
                />
            )}
            <div className="flex h-6 items-center justify-between">
                <span className="font-medium">Stops</span>
                <IconButton size="sm" icon={Plus} label="Add stop" onPress={() => addStop(sorted.length > 1 ? ((sorted[0]?.position ?? 0) + (sorted[1]?.position ?? 1)) / 2 : 0.5)} />
            </div>
            <div className="space-y-1">
                {paint.stops
                    .map((s, i) => ({ s, i }))
                    .sort((a, b) => a.s.position - b.s.position)
                    .map(({ s, i }) => (
                        <div key={i} onFocus={() => setSelected(i)} onPointerDown={() => setSelected(i)} className={`flex items-center gap-1 rounded-md ${i === index ? "bg-panel-hover" : ""}`}>
                            <button type="button" aria-label="Edit stop colour" onClick={() => setSelected(i)} className="size-5 shrink-0 rounded border border-black/20" style={{ background: s.color, opacity: Math.max(0.15, s.opacity) }} />
                            <HexInput value={s.color} onCommit={(color) => setStop(i, { color })} />
                            <div className="w-[60px] shrink-0">
                                <NumberField label="" title="Stop position" suffix="%" min={0} max={100} value={Math.round(s.position * 100)} onCommit={(v) => setStop(i, { position: v / 100 })} />
                            </div>
                            {bind && <VarButton nodes={bind.nodes} field={`${bind.key}:stop:${i}`} label="Apply variable to this stop" />}
                            <IconButton size="sm" icon={Minus} label="Remove stop" disabled={paint.stops.length <= 2} onPress={() => removeStop(i)} />
                        </div>
                    ))}
            </div>
            {bind?.nodes.length === 1 && bind.nodes[0] && <GradientHandles node={bind.nodes[0]} paint={paint} selected={index} onSelect={setSelected} onChange={onChange} onPreview={onPreview} />}
        </div>
    );
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = value.replace("#", "").toUpperCase();
    return (
        <input
            aria-label="Stop hex colour"
            value={draft ?? shown}
            onFocus={(e) => {
                setDraft(shown);
                e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                const v = (draft ?? "").replace("#", "").trim();
                const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
                if (/^[0-9a-f]{6}$/i.test(full)) onCommit(`#${full.toUpperCase()}`);
                setDraft(null);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1.5 text-ink uppercase outline-none hover:border-panel-border focus:border-brand-500"
        />
    );
}

// Handles on the canvas while a gradient is being edited: the start (moves the gradient), the end
// (turns and stretches it) and every stop along the line between them (slides it).
function GradientHandles({ node: initial, paint, selected, onSelect, onChange, onPreview }: { node: SceneNode; paint: GradientPaint; selected: number; onSelect: (i: number) => void; onChange: (p: Paint) => void; onPreview: (p: Paint) => void }) {
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    const node = doc.nodes[initial.id] ?? initial;
    const [rect, setRect] = useState<DOMRect | null>(() => canvasRect());
    const drag = useRef<{ part: "from" | "to" | number; last: GradientPaint } | null>(null);
    useEffect(() => {
        const update = () => setRect(canvasRect());
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    if (!rect) return null;
    const m = worldMatrix(doc, node);
    const toScreen = (p: { x: number; y: number }) => {
        const w = m.transformPoint(new DOMPoint(node.x + p.x * node.w, node.y + p.y * node.h));
        const s = worldToScreen(camera, w.x, w.y);
        return { x: s.x + rect.left, y: s.y + rect.top };
    };
    const toBox = (clientX: number, clientY: number) => {
        const wx = (clientX - rect.left - camera.x) / camera.zoom;
        const wy = (clientY - rect.top - camera.y) / camera.zoom;
        const l = m.inverse().transformPoint(new DOMPoint(wx, wy));
        return { x: node.w ? (l.x - node.x) / node.w : 0, y: node.h ? (l.y - node.y) / node.h : 0 };
    };
    const a = toScreen(paint.from);
    const b = toScreen(paint.to);
    // Stops ride on a rail just beside the line, so the ends stay free to grab.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const along = (t: number) => ({ x: a.x + (b.x - a.x) * t + nx * 14, y: a.y + (b.y - a.y) * t + ny * 14 });
    const move = (e: React.PointerEvent, commit: boolean) => {
        const d = drag.current;
        if (!d) return;
        const p = toBox(e.clientX, e.clientY);
        let next: GradientPaint;
        if (d.part === "from") {
            // The start drags the whole gradient along with it.
            const dx = p.x - paint.from.x;
            const dy = p.y - paint.from.y;
            next = { ...paint, from: p, to: { x: paint.to.x + dx, y: paint.to.y + dy } };
        } else if (d.part === "to") next = { ...paint, to: p };
        else {
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len2 = vx * vx + vy * vy || 1;
            const t = Math.min(1, Math.max(0, ((e.clientX - a.x) * vx + (e.clientY - a.y) * vy) / len2));
            const i = d.part;
            next = { ...paint, stops: paint.stops.map((s, k) => (k === i ? { ...s, position: t } : s)) };
        }
        d.last = next;
        if (commit) onChange(next);
        else onPreview(next);
    };
    const handle = (part: "from" | "to" | number, at: { x: number; y: number }, color: string, active: boolean, label: string) => (
        <g
            key={String(part)}
            aria-label={label}
            role="button"
            style={{ pointerEvents: "all", cursor: "grab" }}
            onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                drag.current = { part, last: paint };
                if (typeof part === "number") onSelect(part);
            }}
            onPointerMove={(e) => move(e, false)}
            onPointerUp={(e) => {
                move(e, true);
                drag.current = null;
            }}
        >
            {typeof part === "number" ? (
                <rect x={at.x - 6} y={at.y - 6} width={12} height={12} rx={2} fill={color} stroke={active ? "#0D99FF" : "#FFFFFF"} strokeWidth={2} />
            ) : (
                <circle cx={at.x} cy={at.y} r={part === "from" ? 6 : 5} fill={part === "from" ? "#FFFFFF" : "#0D99FF"} stroke={part === "from" ? "#0D99FF" : "#FFFFFF"} strokeWidth={2} />
            )}
        </g>
    );
    return createPortal(
        <svg data-gradient-handles="" className="pointer-events-none fixed inset-0 z-40 size-full overflow-visible" aria-label="Gradient handles">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFFFFF" strokeWidth={3} strokeOpacity={0.8} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0D99FF" strokeWidth={1} />
            {handle("from", a, "", false, "Gradient start")}
            {handle("to", b, "", false, "Gradient end")}
            {paint.stops.map((s, i) => handle(i, along(s.position), s.color, i === selected, `Stop at ${Math.round(s.position * 100)}%`))}
        </svg>,
        document.body,
    );
}

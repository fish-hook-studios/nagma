import { useLayoutEffect, useRef, useState } from "react";
import { editor, useEditor } from "../../engine/store";
import type { NagmaDocument } from "../../engine/types";
import { type Ease, type VClip, type VKey, PROPS, compById, keysValue, projectOf } from "../../engine/video/model";
import { moveKey, removeKey, setKeyEase } from "../../engine/video/edit";
import { activeComp, commitComp, currentProject, previewComp, seek, useVideoUi, vui } from "../../engine/video/state";

// The graph editor: one keyframed property's value over the clip, its keyframes dragged in time
// and value, and the selected segment's easing as a curve with two handles.

const EASES: { id: Ease; label: string }[] = [
    { id: "linear", label: "Linear" },
    { id: "ease-in", label: "Ease in" },
    { id: "ease-out", label: "Ease out" },
    { id: "ease-in-out", label: "Ease in and out" },
    { id: "spring", label: "Spring" },
    { id: "hold", label: "Hold" },
];

const PRESET_BEZIER: Record<string, [number, number, number, number]> = {
    linear: [0, 0, 1, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
};

export function GraphEditor() {
    const graph = useVideoUi((s) => s.graph);
    // A different property starts at its first keyframe.
    return <GraphView key={graph ? `${graph.clip}:${graph.path}` : "none"} />;
}

function GraphView() {
    const doc = useEditor((s) => s.doc);
    const graph = useVideoUi((s) => s.graph);
    const compId = useVideoUi((s) => s.compId);
    const time = useVideoUi((s) => s.time);
    const comp = compById(projectOf(doc), compId);
    const clip = graph ? comp.clips.find((c) => c.id === graph.clip) : undefined;
    const keys = clip && graph ? (clip.anim[graph.path] ?? []) : [];
    const boxRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 600, h: 200 });
    const [picked, setPicked] = useState(0);
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        setSize({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    if (!graph || !clip || keys.length === 0) {
        return (
            <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ink-muted">
                Turn on a property's stopwatch in the Inspector, then click its name to edit its curve here.
            </div>
        );
    }
    const path = graph.path;
    const pad = { l: 56, r: 24, t: 18, b: 26 };
    const W = size.w;
    const H = size.h;
    const vals = keys.map((k) => k.v);
    // Sampled curve, so overshooting easings fit too.
    const samples: [number, number][] = [];
    const n = Math.max(40, Math.round(W / 3));
    for (let i = 0; i <= n; i++) {
        const t = (i / n) * clip.duration;
        samples.push([t, keysValue(keys, t)]);
    }
    let lo = Math.min(...vals, ...samples.map((s) => s[1]));
    let hi = Math.max(...vals, ...samples.map((s) => s[1]));
    if (hi - lo < 1e-6) {
        lo -= 1;
        hi += 1;
    }
    const span = hi - lo;
    lo -= span * 0.12;
    hi += span * 0.12;
    const x = (t: number) => pad.l + (t / Math.max(1e-6, clip.duration)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const tOf = (px: number) => Math.max(0, Math.min(clip.duration, ((px - pad.l) / (W - pad.l - pad.r)) * clip.duration));
    const vOf = (py: number) => lo + (1 - (py - pad.t) / (H - pad.t - pad.b)) * (hi - lo);
    const sel = Math.min(picked, keys.length - 1);
    const a = keys[sel] as VKey;
    const b = keys[sel + 1];
    const bez: [number, number, number, number] = a.ease === "bezier" && a.bezier ? a.bezier : (PRESET_BEZIER[a.ease ?? "ease-in-out"] ?? [0.42, 0, 0.58, 1]);

    const edit = (fn: (c: VClip) => VClip, base?: NagmaDocument, preview = false) => {
        const cp = activeComp(base ? projectOf(base) : currentProject());
        const next = { ...cp, clips: cp.clips.map((c) => (c.id === clip.id ? fn(c) : c)) };
        if (preview && base) previewComp(base, next);
        else commitComp(next, base ? projectOf(base) : undefined, base);
    };

    const dragKey = (e: React.PointerEvent, index: number) => {
        e.stopPropagation();
        setPicked(index);
        const base = editor.get().doc;
        const box = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect();
        let last: { t: number; v: number } | null = null;
        const move = (ev: PointerEvent) => {
            const t = Math.round(tOf(ev.clientX - box.left) * comp.fps) / comp.fps;
            const v = Math.round(vOf(ev.clientY - box.top) * 100) / 100;
            last = { t, v };
            edit((c) => moveKey(c, path, index, t, ev.shiftKey ? undefined : v), base, true);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (last) {
                const l = last;
                edit((c) => moveKey(c, path, index, l.t, l.v), base);
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const dragHandle = (e: React.PointerEvent, which: 0 | 1) => {
        e.stopPropagation();
        if (!b) return;
        const base = editor.get().doc;
        const box = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect();
        let curve = bez;
        const move = (ev: PointerEvent) => {
            const t = tOf(ev.clientX - box.left);
            const v = vOf(ev.clientY - box.top);
            const fx = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
            const fy = Math.abs(b.v - a.v) < 1e-9 ? 0 : (v - a.v) / (b.v - a.v);
            const next = [...curve] as [number, number, number, number];
            next[which * 2] = Math.round(fx * 100) / 100;
            next[which * 2 + 1] = Math.round(Math.max(-2, Math.min(3, fy)) * 100) / 100;
            curve = next;
            edit((c) => setKeyEase(c, path, sel, "bezier", next), base, true);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            edit((c) => setKeyEase(c, path, sel, "bezier", curve), base);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const h1 = b ? { x: x(a.t + bez[0] * (b.t - a.t)), y: y(a.v + bez[1] * (b.v - a.v)) } : null;
    const h2 = b ? { x: x(a.t + bez[2] * (b.t - a.t)), y: y(a.v + bez[3] * (b.v - a.v)) } : null;
    const gridLines = 4;
    const playX = x(time - clip.start);

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-panel-border p-2">
                <div className="truncate font-semibold">{PROPS[path]?.label ?? path.replace(/^fx\.[^.]+\./, "")}</div>
                <div className="truncate text-ink-muted">{clip.name}</div>
                <div className="mt-1 text-ink-subtle">Keyframe {sel + 1} of {keys.length}</div>
                <div className="grid grid-cols-1 gap-0.5">
                    {EASES.map((ease) => (
                        <button key={ease.id} type="button" onClick={() => edit((c) => setKeyEase(c, path, sel, ease.id))} className={`h-6 rounded-md px-2 text-left ${a.ease === ease.id ? "bg-brand-500/15 text-ink" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                            {ease.label}
                        </button>
                    ))}
                    <button type="button" onClick={() => edit((c) => setKeyEase(c, path, sel, "bezier", bez))} className={`h-6 rounded-md px-2 text-left ${a.ease === "bezier" ? "bg-brand-500/15 text-ink" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                        Custom curve
                    </button>
                </div>
                <div className="flex-1" />
                <button type="button" onClick={() => edit((c) => removeKey(c, path, sel))} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                    Delete keyframe
                </button>
                <button type="button" onClick={() => vui.set({ graph: null })} className="h-6 rounded-md px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Close graph
                </button>
            </div>
            <div ref={boxRef} className="relative min-h-0 min-w-0 flex-1">
                <svg width={W} height={H} className="absolute inset-0 select-none" onPointerDown={(e) => seek(clip.start + tOf(e.clientX - e.currentTarget.getBoundingClientRect().left))}>
                    {Array.from({ length: gridLines + 1 }, (_, i) => {
                        const v = lo + ((hi - lo) * i) / gridLines;
                        return (
                            <g key={i}>
                                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-panel-border" />
                                <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-ink-subtle text-[10px] tabular-nums">
                                    {Math.round(v * 10) / 10}
                                </text>
                            </g>
                        );
                    })}
                    <path d={samples.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("")} stroke="var(--color-brand-500, #4F7BFF)" strokeWidth={2} fill="none" />
                    {h1 && h2 && b && a.ease !== "hold" && a.ease !== "linear" && (
                        <g>
                            <line x1={x(a.t)} y1={y(a.v)} x2={h1.x} y2={h1.y} stroke="#9CA3AF" strokeDasharray="3 2" />
                            <line x1={x(b.t)} y1={y(b.v)} x2={h2.x} y2={h2.y} stroke="#9CA3AF" strokeDasharray="3 2" />
                            <circle cx={h1.x} cy={h1.y} r={5} fill="#fff" stroke="#4F7BFF" strokeWidth={1.5} className="cursor-move" onPointerDown={(e) => dragHandle(e, 0)} />
                            <circle cx={h2.x} cy={h2.y} r={5} fill="#fff" stroke="#4F7BFF" strokeWidth={1.5} className="cursor-move" onPointerDown={(e) => dragHandle(e, 1)} />
                        </g>
                    )}
                    {keys.map((k, i) => (
                        <rect
                            key={i}
                            x={x(k.t) - 5}
                            y={y(k.v) - 5}
                            width={10}
                            height={10}
                            transform={`rotate(45 ${x(k.t)} ${y(k.v)})`}
                            fill={i === sel ? "#4F7BFF" : "#1f1f23"}
                            stroke="#4F7BFF"
                            strokeWidth={1.5}
                            className="cursor-grab"
                            onPointerDown={(e) => dragKey(e, i)}
                        >
                            <title>{`${Math.round(k.t * 100) / 100}s: ${Math.round(k.v * 100) / 100}`}</title>
                        </rect>
                    ))}
                    {playX >= pad.l && playX <= W - pad.r && <line x1={playX} x2={playX} y1={0} y2={H} stroke="#4F7BFF" strokeOpacity={0.6} />}
                </svg>
            </div>
        </div>
    );
}

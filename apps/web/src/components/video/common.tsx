import { ChevronLeft, ChevronRight, RefreshCcw01 } from "@untitledui/icons";
import { useRef, useState } from "react";
import { editor } from "../../engine/store";
import type { NagmaDocument } from "../../engine/types";
import { type VClip, type VComp, PROPS, isAnimated, propAt } from "../../engine/video/model";
import { resetProp, setProp, toggleAnimated, toggleKeyAt } from "../../engine/video/edit";
import { activeComp, commitComp, currentProject, previewComp, seek, useClipTime, useVideoUi, vui } from "../../engine/video/state";
import { joinColor, splitColor } from "../../engine/video/format";
import { ColorSwatch } from "../color-picker";
import { NumberField } from "../number-field";

// Pieces the video editor's panels share.

export function Section({ title, action, children, open: initial = true }: { title: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; open?: boolean }) {
    const [open, setOpen] = useState(initial);
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-1 font-semibold outline-none">
                    <ChevronRight className={`size-3 shrink-0 text-ink-subtle transition-transform ${open ? "rotate-90" : ""}`} />
                    <span className="truncate">{title}</span>
                </button>
                <div className="flex items-center gap-0.5">{action}</div>
            </div>
            {open && children && <div className="mt-1.5 space-y-1.5">{children}</div>}
        </section>
    );
}

// A keyframe diamond: filled when there's one at the playhead.
export function Diamond({ on, size = 9 }: { on: boolean; size?: number }) {
    return <span className={`block rotate-45 rounded-[1px] border-[1.5px] border-brand-500 ${on ? "bg-brand-500" : "bg-transparent"}`} style={{ width: size, height: size }} />;
}

function Stopwatch({ on }: { on: boolean }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-3.5 ${on ? "text-brand-500" : "text-ink-subtle"}`} fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="9" r="5.2" />
            <path d="M8 9V6.2M6.5 2h3M8 2v1.8" strokeLinecap="round" />
        </svg>
    );
}

// Live edits of one property while dragging: previewed, then one undo step.
function useScrub(clipId: string, path: string, link?: string) {
    const base = useRef<NagmaDocument | null>(null);
    const apply = (value: number, lt: number) => {
        const project = currentProject();
        const comp = activeComp(project);
        const set = (c: VClip) => {
            const once = setProp(c, path, value, lt);
            return link ? setProp(once, link, value, lt) : once;
        };
        return { ...comp, clips: comp.clips.map((c) => (c.id === clipId ? set(c) : c)) };
    };
    return {
        scrub(value: number, lt: number) {
            base.current ??= editor.get().doc;
            previewComp(base.current, apply(value, lt));
        },
        end(value: number, lt: number) {
            const start = base.current ?? editor.get().doc;
            base.current = null;
            commitComp(apply(value, lt), currentProject(), start);
        },
    };
}

function setClipProp(clipId: string, path: string, value: number, lt: number, link?: string) {
    const comp = activeComp();
    const set = (c: VClip) => {
        const once = setProp(c, path, value, lt);
        return link ? setProp(once, link, value, lt) : once;
    };
    commitComp({ ...comp, clips: comp.clips.map((c) => (c.id === clipId ? set(c) : c)) });
}

function editOne(clipId: string, fn: (c: VClip, comp: VComp, path: string) => VClip, paths: string[]) {
    const comp = activeComp();
    commitComp({ ...comp, clips: comp.clips.map((c) => (c.id === clipId ? paths.reduce((cl, p) => fn(cl, comp, p), c) : c)) });
}

// One animatable property: stopwatch, name, value, the keyframe at the playhead, and stepping
// to the previous and next keyframe.
export function PropRow({ clip, comp, path, link, label, min, max, step, unit, scale = 1, decimals = 2 }: { clip: VClip; comp: VComp; path: string; link?: string; label?: string; min?: number; max?: number; step?: number; unit?: string; scale?: number; decimals?: number }) {
    const paths = link ? [path, link] : [path];
    const lt = useClipTime(clip);
    const spec = PROPS[path];
    const animated = isAnimated(clip, path);
    const keys = clip.anim[path] ?? [];
    const here = keys.some((k) => Math.abs(k.t - lt) < 0.5 / comp.fps);
    const value = propAt(comp, clip, path, Math.max(0, Math.min(clip.duration, lt)));
    const scrub = useScrub(clip.id, path, link);
    const k = Math.pow(10, decimals);
    const graph = useVideoUi((s) => s.graph);
    const graphOn = graph?.clip === clip.id && graph.path === path;
    const prev = [...keys].reverse().find((key) => key.t < lt - 1e-3);
    const next = keys.find((key) => key.t > lt + 1e-3);
    const lo = min ?? spec?.min;
    const hi = max ?? spec?.max;
    return (
        <div className="group flex items-center gap-1">
            <button type="button" title={animated ? "Stop animating (keeps the current value)" : "Animate: keyframes from here"} onClick={() => editOne(clip.id, (c, cp, p) => toggleAnimated(cp, c, p, Math.max(0, lt)), paths)} className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-panel-hover">
                <Stopwatch on={animated} />
            </button>
            <span
                title={animated ? "Show this property in the graph editor" : undefined}
                onClick={() => animated && vui.set(graphOn ? { graph: null } : { graph: { clip: clip.id, path }, timelineView: "graph" })}
                className={`w-[78px] shrink-0 truncate ${animated ? "cursor-pointer hover:text-ink" : ""} ${graphOn ? "text-brand-500" : "text-ink-muted"}`}
            >
                {label ?? spec?.label ?? path}
            </span>
            <div className="min-w-0 flex-1">
                <NumberField
                    label=""
                    name={label ?? spec?.label ?? path}
                    value={Math.round(value * scale * k) / k}
                    min={lo !== undefined ? lo * scale : undefined}
                    max={hi !== undefined ? hi * scale : undefined}
                    step={step ?? spec?.step ?? 1}
                    unit={unit ?? (spec?.unit && spec.unit !== "px" ? spec.unit : "")}
                    onCommit={(v) => setClipProp(clip.id, path, v / scale, Math.max(0, lt), link)}
                    onScrub={(v) => scrub.scrub(v / scale, Math.max(0, lt))}
                    onScrubEnd={(v) => scrub.end(v / scale, Math.max(0, lt))}
                />
            </div>
            <div className={`flex shrink-0 items-center ${animated ? "" : "invisible"}`}>
                <button type="button" aria-label="Previous keyframe" disabled={!prev} onClick={() => prev && seek(clip.start + prev.t)} className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink disabled:opacity-30">
                    <ChevronLeft className="size-3" />
                </button>
                <button type="button" aria-label={here ? "Remove keyframe" : "Add keyframe"} onClick={() => editOne(clip.id, (c, cp, p) => toggleKeyAt(cp, c, p, Math.max(0, lt)), paths)} className="flex size-4 items-center justify-center">
                    <Diamond on={here} />
                </button>
                <button type="button" aria-label="Next keyframe" disabled={!next} onClick={() => next && seek(clip.start + next.t)} className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink disabled:opacity-30">
                    <ChevronRight className="size-3" />
                </button>
            </div>
            <button type="button" aria-label="Reset" title="Reset" onClick={() => editOne(clip.id, (c, cp, p) => resetProp(cp, c, p), paths)} className="invisible flex size-4 shrink-0 items-center justify-center text-ink-subtle group-hover:visible hover:text-ink">
                <RefreshCcw01 className="size-3" />
            </button>
        </div>
    );
}

// A slider for a value (colour correction, audio): drag for live changes, one undo step each.
export function SliderRow({ clip, comp, path, label, min, max, step = 1 }: { clip: VClip; comp: VComp; path: string; label: string; min: number; max: number; step?: number }) {
    const lt = useClipTime(clip);
    const value = propAt(comp, clip, path, Math.max(0, Math.min(clip.duration, lt)));
    const scrub = useScrub(clip.id, path);
    const animated = isAnimated(clip, path);
    const keys = clip.anim[path] ?? [];
    const here = keys.some((k) => Math.abs(k.t - lt) < 0.5 / comp.fps);
    return (
        <div className="group flex items-center gap-1">
            <button type="button" title={animated ? "Stop animating" : "Animate"} onClick={() => editOne(clip.id, (c, cp, p) => toggleAnimated(cp, c, p, Math.max(0, lt)), [path])} className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-panel-hover">
                <Stopwatch on={animated} />
            </button>
            <span className="w-[78px] shrink-0 truncate text-ink-muted" onDoubleClick={() => editOne(clip.id, (c, cp, p) => resetProp(cp, c, p), [path])} title="Double-click to reset">
                {label}
            </span>
            <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => scrub.scrub(Number(e.target.value), Math.max(0, lt))}
                onPointerUp={(e) => scrub.end(Number((e.target as HTMLInputElement).value), Math.max(0, lt))}
                onKeyUp={(e) => scrub.end(Number((e.target as HTMLInputElement).value), Math.max(0, lt))}
                className="h-1 min-w-0 flex-1 accent-brand-500"
            />
            <span className="w-9 shrink-0 text-right text-[10px] text-ink-muted tabular-nums">{Math.round(value * 100) / 100}</span>
            <button type="button" aria-label={here ? "Remove keyframe" : "Add keyframe"} onClick={() => editOne(clip.id, (c, cp, p) => toggleKeyAt(cp, c, p, Math.max(0, lt)), [path])} className={`flex size-4 shrink-0 items-center justify-center ${animated ? "" : "invisible"}`}>
                <Diamond on={here} />
            </button>
        </div>
    );
}

export function ColorField({ label, value, onChange, alpha = true }: { label: string; value: string; onChange: (value: string) => void; alpha?: boolean }) {
    const { color, opacity } = splitColor(value);
    return (
        <div className="flex items-center gap-2">
            <span className="w-[78px] shrink-0 truncate pl-6 text-ink-muted">{label}</span>
            <ColorSwatch color={color} opacity={alpha ? opacity : undefined} showOpacity={alpha} label={label} onChange={(c, o) => onChange(joinColor(c, o))} />
            <span className="font-mono text-[10px] text-ink-muted">{color}</span>
        </div>
    );
}

export function Pill({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
    return (
        <button type="button" title={title} onClick={onClick} className={`h-6 rounded-md px-2 font-medium ${active ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
            {children}
        </button>
    );
}

import { Check, ChevronDownDouble, ChevronRight, ChevronUpDouble, Plus, Repeat04 } from "@untitledui/icons";
import { type ReactNode, createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import {
    type KeyRef,
    animatedLayers,
    animationRoot,
    type CombinedProp,
    canMerge,
    durationOf,
    hasAnimation,
    keyframeAt,
    mergeTracks,
    removeKeyframe,
    removeKeys,
    retimeKeys,
    setDuration,
    setKeyEasing,
    setKeyframe,
    splitTrack,
    trackLabel,
    trackPropsFor,
    valueAt,
} from "../engine/animation";
import { applyCommand } from "../engine/commands";
import { BEZIERS, DEFAULT_BEZIER } from "../engine/easing-curves";
import { editor, useEditor } from "../engine/store";
import type { Command, Easing, Keyframe, NagmaDocument, SceneNode, TrackProp } from "../engine/types";
import { BezierCanvas, CurvePreview } from "./easing-editor";
import { IconButton } from "./icon-button";
import { layerIcon } from "./layer-kind";
import { AutoKeyIcon, PauseIcon, PingPongIcon, PlayIcon, PlayOnceIcon, TimelinePanelIcon } from "./toolbar-icons";

// Motion mode's timeline, docked full width under the canvas like the reference's: transport and time
// fields over the layer column, a ruler in seconds with the playhead, the zoom slider and the
// collapse toggle; below, a track per animated layer with a row per keyframed property. Drag
// diamonds to retime them, click the line between two to pick its easing, drag the top edge to resize.

const LEFT = 288; // the layer column, as wide as the left rail and panel above it
const HEADER = 44;
const LAYER_ROW = 28;
const PROP_ROW = 24;
const PAD = 16; // room before 0s so the first diamond isn't clipped
const MIN_PPS = 20;
const MAX_PPS = 2000;
const MIN_HEIGHT = 120;

type Row =
    | { kind: "layer"; node: SceneNode; depth: number; top: number; h: number }
    | { kind: "prop"; node: SceneNode; prop: TrackProp; depth: number; top: number; h: number }
    | { kind: "stagger"; node: SceneNode; depth: number; top: number; h: number };

const refId = (r: KeyRef) => `${r.id}|${r.prop}|${Math.round(r.t)}`;
const parseRef = (s: string): KeyRef => {
    const [id = "", prop, t] = s.split("|");
    return { id, prop: prop as TrackProp, t: Number(t) };
};

// The layer's keyframed values, in the order the Add property menu lists them.
function trackProps(node: SceneNode): TrackProp[] {
    return trackPropsFor(node).filter((p) => node.animation?.tracks[p]?.length);
}

function keysOf(node: SceneNode, props = trackProps(node)): KeyRef[] {
    return props.flatMap((prop) => (node.animation?.tracks[prop] ?? []).map((k) => ({ id: node.id, prop, t: k.t })));
}

// The layers the timeline lists: within the selection's top-level frames, every animated layer and
// every selected one, in layer order, with their depth under that frame.
function trackLayers(doc: NagmaDocument, selection: string[]): { node: SceneNode; depth: number }[] {
    const picked = new Set(selection);
    const roots: SceneNode[] = [];
    for (const id of selection) {
        const node = doc.nodes[id];
        if (!node) continue;
        const root = animationRoot(doc, node);
        if (!roots.includes(root)) roots.push(root);
    }
    const out: { node: SceneNode; depth: number }[] = [];
    const visit = (id: string, depth: number) => {
        const node = doc.nodes[id];
        if (!node) return;
        const shown = hasAnimation(node) || picked.has(id);
        if (shown) out.push({ node, depth });
        node.children.forEach((child) => visit(child, shown ? depth + 1 : depth));
    };
    roots.forEach((root) => visit(root.id, 0));
    return out;
}

// Seconds for the ruler: 0s, 0.5s, 2s.
function secondsLabel(ms: number): string {
    return `${Number((ms / 1000).toFixed(3))}s`;
}

// Ruler spacing: the smallest step whose labels sit at least 64px apart, split into minor ticks.
function tickSteps(pps: number): { major: number; minor: number } {
    const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    const major = steps.find((s) => (s / 1000) * pps >= 64) ?? 60000;
    const lead = Number(String(major)[0]);
    return { major, minor: major / (lead === 2 ? 4 : 5) };
}

// The reference's keyframe easings, by name; "back" curves are stored as their bezier.
const KEY_EASINGS: { id: Easing | "hold"; label: string }[] = [
    { id: "linear", label: "Linear" },
    { id: "ease-in", label: "Ease in" },
    { id: "ease-out", label: "Ease out" },
    { id: "ease-in-out", label: "Ease in and out" },
    { id: "ease-in-back", label: "Ease in back" },
    { id: "ease-out-back", label: "Ease out back" },
    { id: "ease-in-out-back", label: "Ease in and out back" },
    { id: "hold", label: "Hold" },
    { id: "custom-bezier", label: "Custom bezier" },
];

function easingId(k: Keyframe): Easing | "hold" {
    if (k.easing === "hold") return "hold";
    if (!k.bezier) return k.easing;
    const same = (b: number[] | undefined) => Boolean(b && b.every((v, i) => Math.abs(v - (k.bezier?.[i] ?? 0)) < 1e-3));
    const named = (["ease-in-back", "ease-out-back", "ease-in-out-back", "linear", "ease-in", "ease-out", "ease-in-out"] as const).find((id) => same(BEZIERS[id]));
    return named ?? "custom-bezier";
}

function easingPatch(id: Easing | "hold", current: Keyframe): Pick<Keyframe, "easing" | "bezier"> {
    if (id === "hold") return { easing: "hold" };
    if (id === "linear" || id === "ease-in" || id === "ease-out" || id === "ease-in-out") return { easing: id };
    if (id === "custom-bezier") return { easing: "ease-in-out", bezier: current.bezier ?? BEZIERS[current.easing as Easing] ?? DEFAULT_BEZIER };
    return { easing: "ease-in-out", bezier: BEZIERS[id] };
}

function HoldPreview() {
    return (
        <svg viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
            <path d="M3 17h11V3h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            {children}
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// A small time field: shows milliseconds or seconds, accepts "1.5s" or "1500ms" either way.
function TimeField({ label, value, unit, disabled, onCommit }: { label: string; value: number; unit: "ms" | "s"; disabled?: boolean; onCommit: (ms: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = unit === "ms" ? String(Math.round(value)) : String(Number((value / 1000).toFixed(2)));
    const commit = () => {
        if (draft === null) return;
        const text = draft.trim().toLowerCase();
        const n = Number.parseFloat(text);
        setDraft(null);
        if (!Number.isFinite(n)) return;
        const ms = text.endsWith("ms") ? n : text.endsWith("s") ? n * 1000 : unit === "s" ? n * 1000 : n;
        onCommit(Math.max(0, Math.round(ms)));
    };
    return (
        <input
            aria-label={label}
            title={label}
            disabled={disabled}
            value={draft ?? (disabled ? "0" : shown)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                    setDraft(null);
                    e.currentTarget.blur();
                }
            }}
            className="h-6 w-12 rounded-[5px] border border-transparent bg-field px-1.5 text-right text-[11px] text-ink tabular-nums outline-none hover:border-panel-border focus:border-brand-500 disabled:text-ink-subtle"
        />
    );
}

// The zoom slider: a blue filled track with a white knob.
function ZoomSlider({ pps, onChange }: { pps: number; onChange: (pps: number) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const v = Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
    const fromX = (clientX: number) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
        onChange(MIN_PPS * (MAX_PPS / MIN_PPS) ** f);
    };
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label="Zoom timeline"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(v * 100)}
            title="Zoom timeline (⌘ scroll)"
            className="group flex h-6 w-24 cursor-pointer touch-none items-center outline-none"
            onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(MAX_PPS, pps * 1.2));
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(MIN_PPS, pps / 1.2));
            }}
            onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                fromX(e.clientX);
            }}
            onPointerMove={(e) => e.buttons === 1 && fromX(e.clientX)}
        >
            <div ref={ref} className="relative h-1 w-full rounded-full bg-panel-border">
                <div className="absolute inset-y-0 left-0 rounded-full bg-brand-500" style={{ width: `${v * 100}%` }} />
                <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-black/20 group-focus-visible:ring-2 group-focus-visible:ring-brand-500" style={{ left: `${v * 100}%` }} />
            </div>
        </div>
    );
}

export function Timeline() {
    const doc = useEditor((s) => s.doc);
    const time = useEditor((s) => s.time);
    const playing = useEditor((s) => s.playing);
    const autoKey = useEditor((s) => s.autoKey);
    const selection = useEditor((s) => s.selection);
    const prefs = useEditor((s) => s.prefs);
    const [pps, setPps] = useState(100);
    const [scrollX, setScrollX] = useState(0);
    const [viewW, setViewW] = useState(800);
    const [liveHeight, setLiveHeight] = useState<number | null>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
    const [picked, setPicked] = useState<Set<string>>(() => new Set());
    const [pickedProp, setPickedProp] = useState<{ id: string; prop: TrackProp } | null>(null);
    const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    const [easingAt, setEasingAt] = useState<{ id: string; prop: TrackProp; t: number } | null>(null);
    const easingAnchor = useRef<HTMLElement | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const rulerRef = useRef<HTMLDivElement>(null);
    const pendingScroll = useRef<number | null>(null);
    const direction = useRef(1);

    const layers = useMemo(() => trackLayers(doc, selection), [doc, selection]);
    const durationId = selection[0] ?? animatedLayers(doc)[0]?.id ?? null;
    const durationRoot = durationId && doc.nodes[durationId] ? animationRoot(doc, doc.nodes[durationId] as SceneNode) : undefined;
    const duration = durationOf(doc, durationId);
    // With nothing selected the fields read 0, like the reference's; playback still runs the first animated frame.
    const hasDuration = Boolean(durationRoot) && selection.length > 0;
    const unit = prefs.timeUnit;
    const height = prefs.timelineCollapsed ? HEADER : (liveHeight ?? prefs.timelineHeight);

    // Row layout (tops are fixed, so marquee selection can hit-test diamonds).
    const rows: Row[] = [];
    let y = 0;
    for (const { node, depth } of layers) {
        rows.push({ kind: "layer", node, depth, top: y, h: LAYER_ROW });
        y += LAYER_ROW;
        if (collapsed.has(node.id)) continue;
        for (const prop of trackProps(node)) {
            rows.push({ kind: "prop", node, prop, depth, top: y, h: PROP_ROW });
            y += PROP_ROW;
        }
        if (node.animation?.stagger) {
            rows.push({ kind: "stagger", node, depth, top: y, h: PROP_ROW });
            y += PROP_ROW;
        }
    }
    const contentH = y;

    const lastKey = Math.max(0, ...layers.flatMap(({ node }) => keysOf(node).map((k) => k.t)));
    const contentMs = Math.max(duration, lastKey) + 1000;
    const trackW = Math.max(viewW, PAD + (contentMs / 1000) * pps + 40);
    const xOf = (t: number) => PAD + (t / 1000) * pps;

    // Playback: loop, once, or forward then back.
    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const s = editor.get();
            const total = durationOf(s.doc, s.selection[0] ?? animatedLayers(s.doc)[0]?.id ?? null);
            const mode = s.prefs.playback;
            let next = s.time + (now - last) * (mode === "ping-pong" ? direction.current : 1);
            last = now;
            if (mode === "ping-pong") {
                if (next >= total) {
                    next = Math.max(0, total - (next - total));
                    direction.current = -1;
                } else if (next <= 0) {
                    next = Math.min(total, -next);
                    direction.current = 1;
                }
            } else if (next >= total) {
                if (mode === "loop") next = total > 0 ? next % total : 0;
                else {
                    editor.set({ time: total, playing: false });
                    return;
                }
            }
            editor.set({ time: next });
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing]);

    const togglePlay = () => {
        const s = editor.get();
        if (!s.playing && s.prefs.playback !== "ping-pong" && s.time >= duration) editor.set({ time: 0 });
        direction.current = 1;
        editor.set({ playing: !s.playing });
    };

    // Space plays and pauses in Motion mode; holding it to pan the canvas doesn't.
    useEffect(() => {
        let downAt = 0;
        let panned = false;
        const typing = (target: EventTarget | null) => {
            const el = target as HTMLElement | null;
            return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
        };
        const down = (e: KeyboardEvent) => {
            if (e.code !== "Space" || e.repeat || typing(e.target) || editor.get().editingTextId) return;
            downAt = performance.now();
            panned = false;
        };
        const move = (e: PointerEvent) => {
            if (downAt && e.buttons) panned = true;
        };
        const up = (e: KeyboardEvent) => {
            if (e.code !== "Space" || !downAt) return;
            const quick = performance.now() - downAt < 300;
            downAt = 0;
            if (quick && !panned && !typing(e.target)) togglePlay();
        };
        window.addEventListener("keydown", down, true);
        window.addEventListener("keyup", up, true);
        window.addEventListener("pointermove", move, true);
        return () => {
            window.removeEventListener("keydown", down, true);
            window.removeEventListener("keyup", up, true);
            window.removeEventListener("pointermove", move, true);
        };
    });

    // Track viewport width.
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setViewW(Math.max(100, el.clientWidth - LEFT)));
        ro.observe(el);
        return () => ro.disconnect();
    }, [prefs.timelineCollapsed]);

    // Keep the time under the pointer still while zooming.
    useLayoutEffect(() => {
        if (pendingScroll.current === null || !bodyRef.current) return;
        bodyRef.current.scrollLeft = pendingScroll.current;
        setScrollX(bodyRef.current.scrollLeft);
        pendingScroll.current = null;
    }, [pps]);

    const zoomTo = (next: number, anchorPx = viewW / 2) => {
        const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
        const t = (scrollX + anchorPx - PAD) / pps;
        pendingScroll.current = Math.max(0, t * clamped + PAD - anchorPx);
        setPps(clamped);
    };

    // ⌘ or Ctrl + scroll, and trackpad pinch, zoom the timeline.
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const box = el.getBoundingClientRect();
            zoomTo(pps * Math.exp(-e.deltaY * 0.01), Math.max(0, e.clientX - box.left - LEFT));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    });

    // Time at a screen x, measured on the ruler (which shares the tracks' origin and scroll).
    const timeAt = (clientX: number) => {
        const box = rulerRef.current?.getBoundingClientRect();
        if (!box) return 0;
        return Math.max(0, Math.round(((clientX - box.left + scrollX - PAD) / pps) * 1000));
    };

    const scrub = (clientX: number) => editor.set({ time: Math.min(hasDuration ? duration : Infinity, timeAt(clientX)), playing: false });

    // Dragging keyframes, a layer's bar, its ends, or the timeline's end: preview on a base
    // document, commit once as a single undo step.
    const startDrag = (event: React.PointerEvent, build: (base: NagmaDocument, dt: number, shift: boolean) => Command | null, done?: (dt: number) => void) => {
        event.stopPropagation();
        event.preventDefault();
        const base = editor.get().doc;
        const x0 = event.clientX;
        let last: Command | null = null;
        let dt = 0;
        const move = (e: PointerEvent) => {
            dt = Math.round(((e.clientX - x0) / pps) * 1000);
            last = build(base, dt, e.shiftKey);
            if (last) editor.preview(applyCommand(base, last));
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (last && dt !== 0) {
                editor.execute(last, base);
                done?.(dt);
            } else editor.preview(base);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    // Snaps a shift so one of the moved times lands on the playhead (Shift held), within 8px.
    const snapShift = (times: number[], dt: number, shift: boolean) => {
        if (!shift) return dt;
        const reach = (8 / pps) * 1000;
        for (const t of times) if (Math.abs(t + dt - time) < reach) return time - t;
        return dt;
    };

    const moveSelected = (event: React.PointerEvent, refs: KeyRef[]) => {
        const times = refs.map((r) => r.t);
        const minT = Math.min(...times);
        let applied = 0;
        startDrag(
            event,
            (base, raw, shift) => {
                applied = Math.max(-minT, snapShift(times, raw, shift));
                return retimeKeys(base, refs, (r) => r.t + applied);
            },
            () => setPicked(new Set(refs.map((r) => refId({ ...r, t: Math.max(0, Math.round(r.t + applied)) })))),
        );
    };

    const onDiamondDown = (event: React.PointerEvent, ref: KeyRef) => {
        if (event.button !== 0) return;
        bodyRef.current?.focus({ preventScroll: true });
        const id = refId(ref);
        let next = picked;
        if (event.shiftKey) {
            next = new Set(picked);
            if (next.has(id)) next.delete(id);
            else next.add(id);
        } else if (!picked.has(id)) next = new Set([id]);
        setPicked(next);
        setPickedProp(null);
        if (next.has(id)) moveSelected(event, [...next].map(parseRef));
        else event.stopPropagation();
    };

    // A layer's bar: drag the middle to move all its keys, an end to stretch them.
    const onBarDown = (event: React.PointerEvent, node: SceneNode, part: "move" | "start" | "end") => {
        if (event.button !== 0) return;
        const refs = keysOf(node);
        if (!refs.length) return;
        const times = refs.map((r) => r.t);
        const lo = Math.min(...times);
        const hi = Math.max(...times);
        bodyRef.current?.focus({ preventScroll: true });
        setPicked(new Set(refs.map(refId)));
        if (part === "move") return moveSelected(event, refs);
        let f = 1;
        const anchor = part === "end" ? lo : hi;
        startDrag(
            event,
            (base, raw) => {
                const span = hi - lo;
                if (span <= 0) return null;
                f = Math.max(10, part === "end" ? span + raw : span - raw) / span;
                return retimeKeys(base, refs, (r) => anchor + (r.t - anchor) * f);
            },
            () => setPicked(new Set(refs.map((r) => refId({ ...r, t: Math.max(0, Math.round(anchor + (r.t - anchor) * f)) })))),
        );
    };

    const onDurationDown = (event: React.PointerEvent) => {
        if (!durationRoot) return;
        const root = durationRoot;
        startDrag(event, (base, dt, shift) => {
            const node = base.nodes[root.id];
            if (!node) return null;
            let next = Math.max(100, duration + dt);
            if (shift) next = Math.round(next / 100) * 100;
            return setDuration(node, next);
        });
    };

    // Box-select keyframes on the empty track area.
    const onTracksDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        const x0 = event.clientX - box.left;
        const y0 = event.clientY - box.top;
        const before = event.shiftKey ? picked : new Set<string>();
        bodyRef.current?.focus({ preventScroll: true });
        setPickedProp(null);
        let dragged = false;
        const move = (e: PointerEvent) => {
            const x1 = e.clientX - box.left;
            const y1 = e.clientY - box.top;
            if (!dragged && Math.hypot(x1 - x0, y1 - y0) < 3) return;
            dragged = true;
            const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)];
            const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
            const next = new Set(before);
            for (const row of rows) {
                if (row.kind !== "prop") continue;
                const cy = row.top + row.h / 2;
                if (cy < t || cy > b) continue;
                for (const k of row.node.animation?.tracks[row.prop] ?? []) {
                    const kx = xOf(k.t);
                    if (kx >= l && kx <= r) next.add(refId({ id: row.node.id, prop: row.prop, t: k.t }));
                }
            }
            setPicked(next);
            setMarquee({ x0, y0, x1, y1 });
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setMarquee(null);
            if (!dragged) setPicked(before);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if ((event.target as HTMLElement).tagName === "INPUT") return;
        if ((event.key === "Delete" || event.key === "Backspace") && picked.size) {
            event.preventDefault();
            event.stopPropagation();
            editor.execute(removeKeys(doc, [...picked].map(parseRef)));
            setPicked(new Set());
            setPickedProp(null);
        } else if (event.key === "Escape" && (picked.size || pickedProp)) {
            event.stopPropagation();
            setPicked(new Set());
            setPickedProp(null);
        }
    };

    const onResizeDown = (event: React.PointerEvent) => {
        event.preventDefault();
        const y0 = event.clientY;
        const h0 = prefs.timelineCollapsed ? HEADER : prefs.timelineHeight;
        let h = h0;
        const move = (e: PointerEvent) => {
            h = Math.round(Math.min(window.innerHeight * 0.75, Math.max(MIN_HEIGHT, h0 - (e.clientY - y0))));
            setLiveHeight(h);
            if (editor.get().prefs.timelineCollapsed) editor.setPrefs({ timelineCollapsed: false });
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            editor.setPrefs({ timelineHeight: h });
            setLiveHeight(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const anyExpanded = layers.some(({ node }) => !collapsed.has(node.id) && (trackProps(node).length || node.animation?.stagger));
    const { major, minor } = tickSteps(pps);
    const firstTick = Math.max(0, Math.floor((((scrollX - PAD) / pps) * 1000) / minor) * minor);
    const lastTick = ((scrollX + viewW) / pps) * 1000;
    const ticks: number[] = [];
    for (let t = firstTick; t <= lastTick && ticks.length < 2000; t += minor) ticks.push(Math.round(t));
    const playheadColor = autoKey ? "bg-red-500" : "bg-brand-500";
    const playback = prefs.playback;
    const PlaybackIcon = playback === "loop" ? Repeat04 : playback === "once" ? PlayOnceIcon : PingPongIcon;
    const playbackLabel = playback === "loop" ? "Loop" : playback === "once" ? "Once" : "Ping-pong";
    const easingTrack = easingAt ? doc.nodes[easingAt.id]?.animation?.tracks[easingAt.prop] : undefined;
    const easingKey = easingAt ? easingTrack?.find((k) => Math.abs(k.t - easingAt.t) < 1) : undefined;
    const easingNext = easingKey ? easingTrack?.find((k) => k.t > easingKey.t) : undefined;

    return (
        <div role="region" aria-label="Timeline" className="relative flex shrink-0 flex-col border-t border-panel-border bg-panel text-[11px] text-ink" style={{ height }} onKeyDown={onKeyDown}>
            {/* Drag the top edge to resize. */}
            <div aria-hidden className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize" onPointerDown={onResizeDown} />

            {/* Header: transport and time fields over the layer column, the ruler, then zoom and collapse. */}
            <div className="flex shrink-0 items-stretch" style={{ height: HEADER }}>
                <div className="flex shrink-0 items-center gap-1 border-r border-panel-border px-2" style={{ width: LEFT }}>
                    <IconButton size="sm" icon={playing ? PauseIcon : PlayIcon} label={playing ? "Pause" : "Play"} shortcut="Space" onPress={togglePlay} />
                    <IconButton size="sm" icon={AutoKeyIcon} label="Toggle auto-keyframe" active={autoKey} onPress={() => editor.set({ autoKey: !autoKey })} />
                    <div className="ml-1 flex items-center gap-1">
                        <TimeField label="Current time" value={time} unit={unit} onCommit={(ms) => editor.set({ time: hasDuration ? Math.min(duration, ms) : ms, playing: false })} />
                        <TimeField
                            label="Duration"
                            value={duration}
                            unit={unit}
                            disabled={!hasDuration}
                            onCommit={(ms) => {
                                if (durationRoot && ms > 0) editor.execute(setDuration(durationRoot, ms));
                            }}
                        />
                        <Tip label={unit === "ms" ? "Show seconds" : "Show milliseconds"}>
                            <AriaButton
                                aria-label="Time unit"
                                onPress={() => editor.setPrefs({ timeUnit: unit === "ms" ? "s" : "ms" })}
                                className="h-6 min-w-6 rounded-md px-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                                {unit}
                            </AriaButton>
                        </Tip>
                    </div>
                    <IconButton
                        size="sm"
                        icon={PlaybackIcon}
                        label={`Playback: ${playbackLabel}`}
                        onPress={() => editor.setPrefs({ playback: playback === "loop" ? "once" : playback === "once" ? "ping-pong" : "loop" })}
                    />
                    <div className="flex-1" />
                    {layers.length > 0 && (
                        <IconButton
                            size="sm"
                            icon={anyExpanded ? ChevronUpDouble : ChevronDownDouble}
                            label={anyExpanded ? "Collapse layers" : "Expand layers"}
                            onPress={() => setCollapsed(anyExpanded ? new Set(layers.map(({ node }) => node.id)) : new Set())}
                        />
                    )}
                </div>
                {/* Ruler */}
                <div
                    ref={rulerRef}
                    className="relative min-w-0 flex-1 cursor-ew-resize touch-none overflow-hidden select-none"
                    onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        scrub(e.clientX);
                    }}
                    onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e.clientX)}
                >
                    {autoKey && <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-red-500" />}
                    <div className="absolute inset-y-0 left-0" style={{ width: trackW, transform: `translateX(${-scrollX}px)` }}>
                        <div className="absolute inset-x-0 top-0 h-2.5 bg-ink/[0.04]" />
                        {ticks.map((t) => {
                            const isMajor = t % major === 0;
                            return (
                                <div key={t} className="absolute bottom-0" style={{ left: xOf(t) }}>
                                    <div className={`absolute bottom-0 w-px ${isMajor ? "h-2 bg-ink-subtle" : "h-1 bg-ink-subtle/50"}`} />
                                    {isMajor && <span className="absolute bottom-2.5 -translate-x-1/2 text-[10px] whitespace-nowrap text-ink-muted tabular-nums">{secondsLabel(t)}</span>}
                                </div>
                            );
                        })}
                        {hasDuration && (
                            <>
                                <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/15" style={{ left: xOf(duration) }} />
                                <div
                                    role="separator"
                                    aria-label="Drag to change duration"
                                    title={`Duration: ${unit === "ms" ? `${duration}ms` : secondsLabel(duration)}. Drag to change it.`}
                                    className="absolute top-2.5 bottom-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
                                    style={{ left: xOf(duration) }}
                                    onPointerDown={onDurationDown}
                                >
                                    <span className="mx-auto block h-full w-0.5 rounded-full bg-ink-muted" />
                                </div>
                            </>
                        )}
                        <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: xOf(time) }}>
                            <div className={`absolute top-0 bottom-0 w-px ${playheadColor}`} />
                            <div className={`absolute top-0 h-3 w-2.5 -translate-x-1/2 rounded-b-sm ${playheadColor}`} style={{ marginLeft: 0.5 }} />
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 px-2">
                    <ZoomSlider
                        pps={pps}
                        onChange={(next) => {
                            // Zoom around the playhead while it's in view.
                            const at = xOf(time) - scrollX;
                            zoomTo(next, at >= 0 && at <= viewW ? at : viewW / 2);
                        }}
                    />
                    <IconButton
                        size="sm"
                        icon={TimelinePanelIcon}
                        label={prefs.timelineCollapsed ? "Expand timeline" : "Collapse timeline"}
                        onPress={() => editor.setPrefs({ timelineCollapsed: !prefs.timelineCollapsed })}
                    />
                </div>
            </div>

            {/* Body: layer column (sticky) and tracks, scrolled together. */}
            {!prefs.timelineCollapsed && (
                <div ref={bodyRef} tabIndex={-1} className="relative min-h-0 flex-1 overflow-auto border-t border-panel-border outline-none" onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
                    <div className="relative flex" style={{ width: LEFT + trackW, minHeight: "100%" }}>
                        <div className="sticky left-0 z-10 shrink-0 border-r border-panel-border bg-panel" style={{ width: LEFT }}>
                            {rows.map((row) => (
                                <NameCell
                                    key={`${row.kind}-${row.node.id}-${row.kind === "prop" ? row.prop : ""}`}
                                    row={row}
                                    time={time}
                                    selected={selection.includes(row.node.id)}
                                    expanded={!collapsed.has(row.node.id)}
                                    picked={row.kind === "prop" && pickedProp?.id === row.node.id && pickedProp.prop === row.prop}
                                    onToggle={() =>
                                        setCollapsed((c) => {
                                            const next = new Set(c);
                                            if (next.has(row.node.id)) next.delete(row.node.id);
                                            else next.add(row.node.id);
                                            return next;
                                        })
                                    }
                                    onPick={(shift) => {
                                        bodyRef.current?.focus({ preventScroll: true });
                                        if (row.kind === "layer") {
                                            editor.set({ selection: shift ? Array.from(new Set([...selection, row.node.id])) : [row.node.id] });
                                            setPicked(new Set(keysOf(row.node).map(refId)));
                                            setPickedProp(null);
                                        } else if (row.kind === "prop") {
                                            setPickedProp({ id: row.node.id, prop: row.prop });
                                            setPicked(new Set(keysOf(row.node, [row.prop]).map(refId)));
                                        }
                                    }}
                                />
                            ))}
                        </div>
                        <div className="relative flex-1" style={{ width: trackW, height: Math.max(contentH, 1) }} onPointerDown={onTracksDown}>
                            {hasDuration && <div className="pointer-events-none absolute inset-y-0 right-0 border-l border-panel-border bg-black/15" style={{ left: xOf(duration) }} />}
                            {rows.map((row) => (
                                <div
                                    key={`${row.kind}-${row.node.id}-${row.kind === "prop" ? row.prop : ""}`}
                                    className={`absolute inset-x-0 ${row.kind === "layer" ? "border-t border-panel-border/60" : ""} ${row.kind === "prop" && pickedProp?.id === row.node.id && pickedProp.prop === row.prop ? "bg-brand-500/10" : ""}`}
                                    style={{ top: row.top, height: row.h }}
                                >
                                    {row.kind === "layer" && <LayerBar node={row.node} xOf={xOf} showKeys={collapsed.has(row.node.id)} onDown={onBarDown} />}
                                    {row.kind === "stagger" && <StaggerBar node={row.node} xOf={xOf} duration={duration} />}
                                    {row.kind === "prop" && (
                                        <PropTrack
                                            node={row.node}
                                            prop={row.prop}
                                            xOf={xOf}
                                            picked={picked}
                                            openEasing={easingAt}
                                            onDiamondDown={onDiamondDown}
                                            onDiamondDouble={(t) => editor.set({ time: t, playing: false })}
                                            onSegment={(el, t) => {
                                                easingAnchor.current = el;
                                                setEasingAt({ id: row.node.id, prop: row.prop, t });
                                            }}
                                        />
                                    )}
                                </div>
                            ))}
                            {marquee && (
                                <div
                                    className="pointer-events-none absolute z-20 border border-brand-500 bg-brand-500/10"
                                    style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
                                />
                            )}
                        </div>
                        <div className={`pointer-events-none absolute inset-y-0 z-[5] w-px ${playheadColor}`} style={{ left: LEFT + xOf(time) }} />
                    </div>
                </div>
            )}

            <AriaPopover
                triggerRef={easingAnchor}
                isOpen={Boolean(easingAt && easingKey)}
                onOpenChange={(open) => !open && setEasingAt(null)}
                placement="top"
                offset={6}
                className="w-56 rounded-lg border border-panel-border bg-panel-raised p-1 text-[11px] text-ink shadow-xl outline-none"
            >
                <AriaDialog aria-label="Easing" className="outline-none">
                    {easingAt && easingKey && (
                        <EasingMenu
                            k={easingKey}
                            span={easingNext ? easingNext.t - easingKey.t : 0}
                            onEase={(patch) => {
                                const node = editor.get().doc.nodes[easingAt.id];
                                if (node) editor.execute(setKeyEasing(node, easingAt.prop, easingKey.t, patch));
                            }}
                            onSpan={(ms) => {
                                // Changing a stretch's length moves its end key and the ones after it.
                                if (!easingNext) return;
                                const node = editor.get().doc.nodes[easingAt.id];
                                const dt = Math.max(1, ms) - (easingNext.t - easingKey.t);
                                if (!node || !dt) return;
                                const later = (node.animation?.tracks[easingAt.prop] ?? []).filter((k) => k.t >= easingNext.t).map((k) => ({ id: node.id, prop: easingAt.prop, t: k.t }));
                                editor.execute(retimeKeys(editor.get().doc, later, (r) => r.t + dt));
                            }}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </div>
    );
}

// Adds a keyframe at the playhead for any value the layer can animate (stroke, padding, corners,
// effects...), so its track shows.
function AddProperty({ node, time }: { node: SceneNode; time: number }) {
    // Axes animated through Position or Scale aren't offered separately (keying them keys the combined track).
    const tracks = node.animation?.tracks ?? {};
    const free = trackPropsFor(node).filter((p) => !tracks[p]?.length && !((p === "x" || p === "y") && tracks.position?.length) && !((p === "scaleX" || p === "scaleY") && tracks.scale?.length));
    if (!free.length) return null;
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={`Animate a property of ${node.name}`} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-subtle outline-none hover:bg-panel-hover hover:text-ink">
                <Plus className="size-3" />
            </AriaButton>
            <AriaPopover placement="bottom start" className="max-h-80 w-52 overflow-y-auto rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu aria-label="Animate a property" className="outline-none" onAction={(k) => editor.execute(setKeyframe(node, String(k) as TrackProp, time, valueAt(node, String(k) as TrackProp, time)))}>
                    {free.map((p) => (
                        <AriaMenuItem key={p} id={p} className="flex h-7 cursor-default items-center rounded px-2 text-[11px] outline-none data-[focused]:bg-brand-500">
                            {trackLabel(node, p)}
                        </AriaMenuItem>
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function NameCell({ row, time, selected, expanded, picked, onToggle, onPick }: { row: Row; time: number; selected: boolean; expanded: boolean; picked: boolean; onToggle: () => void; onPick: (shift: boolean) => void }) {
    const indent = 8 + Math.min(row.depth, 6) * 12;
    if (row.kind === "layer") {
        const expandable = trackProps(row.node).length > 0 || Boolean(row.node.animation?.stagger);
        return (
            <div
                className={`flex items-center gap-1 border-t border-panel-border/60 pr-2 ${selected ? "bg-brand-500/10" : "hover:bg-panel-hover"}`}
                style={{ height: row.h, paddingLeft: indent }}
                onPointerDown={(e) => e.button === 0 && onPick(e.shiftKey)}
            >
                <button
                    type="button"
                    aria-label={expanded ? "Collapse layer" : "Expand layer"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onToggle}
                    className={`flex size-4 shrink-0 items-center justify-center text-ink-subtle hover:text-ink ${expandable ? "" : "invisible"}`}
                >
                    <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                {createElement(layerIcon(row.node), { className: "size-3.5 shrink-0 text-ink-muted" })}
                <span className="min-w-0 flex-1 truncate">{row.node.name}</span>
                <AddProperty node={row.node} time={time} />
            </div>
        );
    }
    if (row.kind === "stagger") {
        return (
            <div className="flex items-center pr-2 text-ink-muted" style={{ height: row.h, paddingLeft: indent + 38 }}>
                Text stagger
            </div>
        );
    }
    const { node, prop } = row;
    const keyed = keyframeAt(node, prop, time);
    const v = valueAt(node, prop, time);
    return (
        <div
            className={`group flex items-center gap-2 pr-2 ${picked ? "bg-brand-500/10 text-ink" : "text-ink-muted hover:bg-panel-hover"}`}
            style={{ height: row.h, paddingLeft: indent + 38 }}
            onPointerDown={(e) => e.button === 0 && onPick(e.shiftKey)}
        >
            <span className="min-w-0 flex-1 truncate">{trackLabel(node, prop)}</span>
            {(() => {
                // Position and Scale against their separate axes: one or the other, never both.
                const combined: CombinedProp | null = prop === "position" || prop === "scale" ? prop : prop === "x" || prop === "y" ? "position" : prop === "scaleX" || prop === "scaleY" ? "scale" : null;
                if (!combined) return null;
                const split = prop === combined;
                if (!split && !canMerge(node, combined)) return null;
                return (
                    <button
                        type="button"
                        title={split ? `Split into ${combined === "position" ? "X and Y" : "Scale X and Scale Y"} tracks` : `Merge into one ${combined === "position" ? "Position" : "Scale"} track`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                            const command = split ? splitTrack(node, combined) : mergeTracks(node, combined);
                            if (command) editor.execute(command);
                        }}
                        className="hidden h-4 rounded px-1 text-[10px] text-ink-subtle group-hover:block hover:bg-panel-hover hover:text-ink"
                    >
                        {split ? "Split" : "Merge"}
                    </button>
                );
            })()}
            <span className="max-w-20 truncate text-right text-[10px] text-ink-subtle tabular-nums">{typeof v === "number" ? Math.round(v * 100) / 100 : v}</span>
            <button
                type="button"
                aria-label={keyed ? "Remove keyframe" : "Add keyframe"}
                title={keyed ? "Remove keyframe" : "Add keyframe at the playhead"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => editor.execute(keyed ? removeKeyframe(node, prop, time) : setKeyframe(node, prop, time, v))}
                className="flex size-4 shrink-0 items-center justify-center"
            >
                <span className={`block size-[7px] rotate-45 border ${keyed ? "border-brand-500 bg-brand-500" : "border-ink-subtle group-hover:border-ink-muted"}`} />
            </button>
        </div>
    );
}

// A layer's bar from its first keyframe to its last: drag it to move them all, its ends to stretch them.
function LayerBar({ node, xOf, showKeys, onDown }: { node: SceneNode; xOf: (t: number) => number; showKeys: boolean; onDown: (e: React.PointerEvent, node: SceneNode, part: "move" | "start" | "end") => void }) {
    const times = keysOf(node).map((k) => k.t);
    if (!times.length) return null;
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    const left = xOf(lo);
    const width = Math.max(4, xOf(hi) - left);
    return (
        <div
            title="Drag to move this layer's animation; drag an end to change its length"
            className="group absolute top-1/2 h-4 -translate-y-1/2 cursor-grab rounded border border-brand-500/40 bg-brand-500/15 hover:border-brand-500/70 active:cursor-grabbing"
            style={{ left: left - 6, width: width + 12 }}
            onPointerDown={(e) => onDown(e, node, "move")}
        >
            <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover:bg-brand-500/50 group-hover:opacity-100" onPointerDown={(e) => onDown(e, node, "start")} />
            <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover:bg-brand-500/50 group-hover:opacity-100" onPointerDown={(e) => onDown(e, node, "end")} />
            {showKeys &&
                Array.from(new Set(times)).map((t) => (
                    <span key={t} className="pointer-events-none absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-brand-500 bg-panel" style={{ left: xOf(t) - left + 6 }} />
                ))}
        </div>
    );
}

function StaggerBar({ node, xOf, duration }: { node: SceneNode; xOf: (t: number) => number; duration: number }) {
    const stagger = node.animation?.stagger;
    if (!stagger) return null;
    const left = xOf(stagger.delay);
    return <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-brand-500/25" style={{ left, width: Math.max(4, xOf(Math.max(stagger.delay + stagger.duration, duration)) - left) }} />;
}

function PropTrack({
    node,
    prop,
    xOf,
    picked,
    openEasing,
    onDiamondDown,
    onDiamondDouble,
    onSegment,
}: {
    node: SceneNode;
    prop: TrackProp;
    xOf: (t: number) => number;
    picked: Set<string>;
    openEasing: { id: string; prop: TrackProp; t: number } | null;
    onDiamondDown: (e: React.PointerEvent, ref: KeyRef) => void;
    onDiamondDouble: (t: number) => void;
    onSegment: (el: HTMLElement, t: number) => void;
}) {
    const track = node.animation?.tracks[prop] ?? [];
    return (
        <>
            {track.slice(0, -1).map((a, i) => {
                const b = track[i + 1] as Keyframe;
                const open = openEasing?.id === node.id && openEasing.prop === prop && Math.abs(openEasing.t - a.t) < 1;
                const label = KEY_EASINGS.find((e) => e.id === easingId(a))?.label ?? "Easing";
                return (
                    <button
                        key={`s${a.t}`}
                        type="button"
                        aria-label={`Easing: ${label}`}
                        title={`${label}, ${Math.round(b.t - a.t)}ms. Click to change the easing.`}
                        className="group absolute top-1/2 flex h-3 -translate-y-1/2 cursor-pointer items-center outline-none"
                        style={{ left: xOf(a.t) + 5, width: Math.max(0, xOf(b.t) - xOf(a.t) - 10) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => onSegment(e.currentTarget, a.t)}
                    >
                        <span className={`block w-full ${a.easing === "hold" ? "border-t border-dashed" : "h-0.5 rounded-full"} ${open ? "border-brand-500 bg-brand-500" : "border-brand-500/60 bg-brand-500/45 group-hover:border-brand-500 group-hover:bg-brand-500"}`} />
                    </button>
                );
            })}
            {track.map((k) => {
                const ref = { id: node.id, prop, t: k.t };
                const active = picked.has(refId(ref));
                return (
                    <div
                        key={`k${k.t}`}
                        role="button"
                        aria-label={`${trackLabel(node, prop)} keyframe at ${k.t}ms`}
                        title={`${k.t}ms`}
                        onPointerDown={(e) => onDiamondDown(e, ref)}
                        onDoubleClick={() => onDiamondDouble(k.t)}
                        className="absolute top-1/2 z-[6] flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
                        style={{ left: xOf(k.t) }}
                    >
                        <span className={`block size-[9px] rotate-45 rounded-[1px] border-[1.5px] border-brand-500 ${active ? "bg-brand-500" : "bg-panel hover:bg-brand-500/30"}`} />
                    </div>
                );
            })}
        </>
    );
}

// The easing menu for the stretch between two keyframes: the reference's presets, the custom bezier
// editor, and the stretch's length.
function EasingMenu({ k, span, onEase, onSpan }: { k: Keyframe; span: number; onEase: (patch: Pick<Keyframe, "easing" | "bezier">) => void; onSpan: (ms: number) => void }) {
    const current = easingId(k);
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <div>
            <div className="px-2 pt-1 pb-1.5 font-semibold">Easing</div>
            {KEY_EASINGS.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onEase(easingPatch(id, k))}
                    className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${current === id ? "bg-brand-500/15 text-ink" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}
                >
                    <span className="flex size-5 items-center justify-center">
                        {id === "hold" ? <HoldPreview /> : <CurvePreview transition={id === "custom-bezier" ? { easing: "custom-bezier", bezier: k.bezier ?? DEFAULT_BEZIER } : { easing: id }} />}
                    </span>
                    <span className="flex-1">{label}</span>
                    {current === id && <Check className="size-3.5 text-brand-500" />}
                </button>
            ))}
            {current === "custom-bezier" && (
                <div className="mt-1 rounded-md bg-field p-1">
                    <BezierCanvas value={k.bezier ?? DEFAULT_BEZIER} onChange={(bezier) => onEase({ easing: "ease-in-out", bezier })} />
                </div>
            )}
            {span > 0 && (
                <label className="mt-1 flex h-8 items-center gap-2 border-t border-panel-border px-2 pt-1">
                    <span className="flex-1 text-ink-muted">Duration</span>
                    <input
                        aria-label="Duration between keyframes"
                        value={draft ?? String(Math.round(span))}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => {
                            const n = Number.parseFloat(draft ?? "");
                            setDraft(null);
                            if (Number.isFinite(n) && n > 0) onSpan(Math.round(n));
                        }}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="h-6 w-16 rounded-[5px] border border-transparent bg-field px-1.5 text-right text-ink tabular-nums outline-none hover:border-panel-border focus:border-brand-500"
                    />
                    <span className="text-ink-subtle">ms</span>
                </label>
            )}
        </div>
    );
}

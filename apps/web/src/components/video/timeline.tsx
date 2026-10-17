import { CursorBox, Eye, EyeOff, LayersThree01, Link01, Lock01, LockUnlocked01, Plus, Scissors01, Trash01, VolumeMax, VolumeX, ZoomIn, ZoomOut } from "@untitledui/icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { editor, useEditor } from "../../engine/store";
import type { NagmaDocument } from "../../engine/types";
import { addEffect, addShape, addTitle, addTrackOf, applyMotionPreset, applyTransition, deleteSelection, importFiles, insertMedia, openNested, setLinked, setTrack, splitClipAt, zoomTimeline } from "../../engine/video/actions";
import { moveClips, pasteClips, removeTrack, trimClip, withLinked } from "../../engine/video/edit";
import { imageSrc } from "../../engine/image-store";
import { type VClip, type VComp, type VMedia, type VProject, type VTrack, PEAK_RATE, ROOT, TRACK_COLORS, clipEnd, compById, compLength, mediaById, projectOf, snapTime } from "../../engine/video/model";
import { transitionLabel } from "../../engine/video/presets";
import { keyTimes } from "../../engine/video/edit";
import { commitComp, openComp, previewComp, seek, useImagesReady, useVideoUi, vui } from "../../engine/video/state";
import { IconButton } from "../icon-button";
import { Diamond } from "./common";
import { timecode } from "../../engine/video/format";
import { GraphEditor } from "./graph-editor";

// The timeline: video tracks (V1 at the bottom of the stack, drawn first) above audio tracks,
// with a ruler for scrubbing, markers and the in/out range. Clips move between tracks, trim at
// their edges (⌥ ripples), cut with the razor, and take media, effects, transitions, titles and
// motion presets dropped on them.

const HEAD = 168;
const RULER = 30;
const VH = 56;
const AH = 46;
export const MEDIA_MIME = "application/x-nagma-media";
export const LIB_MIME = "application/x-nagma-video-library";

export type LibraryDrag = { type: "effect" | "transition" | "title" | "motion" | "shape"; id: string };

function rowHeight(t: VTrack) {
    return t.kind === "video" ? VH : AH;
}

export function Timeline() {
    const doc = useEditor((s) => s.doc);
    const compId = useVideoUi((s) => s.compId);
    const trail = useVideoUi((s) => s.trail);
    const pps = useVideoUi((s) => s.pxPerSec);
    const tool = useVideoUi((s) => s.tool);
    const snapping = useVideoUi((s) => s.snapping);
    const selection = useVideoUi((s) => s.selection);
    const height = useVideoUi((s) => s.timelineHeight);
    const view = useVideoUi((s) => s.timelineView);
    const setView = (timelineView: "tracks" | "graph") => vui.set({ timelineView });
    useImagesReady();
    const project = projectOf(doc);
    const comp = compById(project, compId);
    const scrollRef = useRef<HTMLDivElement>(null);
    const len = compLength(comp);
    const [viewW, setViewW] = useState(800);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setViewW(el.clientWidth - HEAD));
        ro.observe(el);
        return () => ro.disconnect();
    }, [view]);
    const width = Math.max(viewW, (len + 20) * pps);
    const selected = new Set(selection);
    const linkedSel = selection.length ? comp.clips.filter((c) => selected.has(c.id)) : [];
    const anyLinked = linkedSel.some((c) => c.link);

    const onResizeDown = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const start = height;
        const move = (ev: PointerEvent) => vui.set({ timelineHeight: Math.max(160, Math.min(window.innerHeight - 220, start + (startY - ev.clientY))) });
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const zoomFit = () => vui.set({ pxPerSec: Math.max(4, Math.min(1200, (viewW - 40) / Math.max(1, len))) });

    return (
        <section role="region" aria-label="Timeline" className="relative flex min-w-0 shrink-0 flex-col border-t border-panel-border bg-panel text-[11px] text-ink" style={{ height }}>
            <div aria-hidden className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize" onPointerDown={onResizeDown} />
            <div className="flex min-h-9 min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-panel-border px-2 py-1 whitespace-nowrap">
                <Breadcrumb comp={comp} trail={trail} project={project} />
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <IconButton size="sm" icon={CursorBox} label="Select" shortcut="V" active={tool === "select"} onPress={() => vui.set({ tool: "select" })} />
                <IconButton size="sm" icon={Scissors01} label="Razor" shortcut="C" active={tool === "razor"} onPress={() => vui.set({ tool: "razor" })} />
                <IconButton size="sm" icon={MagnetIcon} label={snapping ? "Snapping on" : "Snapping off"} shortcut="⇧ S" active={snapping} onPress={() => vui.set({ snapping: !snapping })} />
                <IconButton size="sm" icon={Link01} label={anyLinked ? "Unlink" : "Link"} disabled={!selection.length} active={anyLinked} onPress={() => setLinked(!anyLinked)} />
                <IconButton size="sm" icon={Trash01} label="Ripple delete" shortcut="⌥ ⌫" disabled={!selection.length} onPress={() => deleteSelection(true)} />
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <button type="button" title="Add video track" aria-label="Add video track" onClick={() => addTrackOf("video")} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3" /> V
                </button>
                <button type="button" title="Add audio track" aria-label="Add audio track" onClick={() => addTrackOf("audio")} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3" /> A
                </button>
                <div className="min-w-0 flex-1" />
                <div className="flex shrink-0 rounded-md bg-field p-0.5">
                    {(["tracks", "graph"] as const).map((v) => (
                        <button key={v} type="button" onClick={() => setView(v)} className={`h-5 rounded px-2 font-medium capitalize ${view === v ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                            {v === "tracks" ? "Tracks" : "Graph"}
                        </button>
                    ))}
                </div>
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <IconButton size="sm" icon={ZoomOut} label="Zoom out" shortcut="−" onPress={() => zoomTimeline(1 / 1.5)} />
                <input aria-label="Timeline zoom" type="range" min={0} max={100} value={Math.round((Math.log(pps / 4) / Math.log(300)) * 100)} onChange={(e) => vui.set({ pxPerSec: 4 * Math.pow(300, Number(e.target.value) / 100) })} className="h-1 w-20 shrink accent-brand-500" />
                <IconButton size="sm" icon={ZoomIn} label="Zoom in" shortcut="=" onPress={() => zoomTimeline(1.5)} />
                <button type="button" onClick={zoomFit} title="Fit the sequence (\\)" className="h-6 rounded-md px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Fit
                </button>
            </div>
            {view === "graph" ? (
                <GraphEditor />
            ) : (
                <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onWheel={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        zoomTimeline(e.deltaY < 0 ? 1.1 : 1 / 1.1);
                    }
                }}>
                    <div className="relative" style={{ width: HEAD + width }}>
                        <Ruler comp={comp} pps={pps} width={width} />
                        {comp.tracks.map((track) => (
                            <TrackRow key={track.id} project={project} comp={comp} track={track} pps={pps} width={width} tool={tool} snapping={snapping} selected={selected} doc={doc} />
                        ))}
                        <div className="h-16" />
                        <Playhead comp={comp} pps={pps} scrollRef={scrollRef} />
                    </div>
                </div>
            )}
        </section>
    );
}

function Breadcrumb({ comp, trail, project }: { comp: VComp; trail: string[]; project: VProject }) {
    if (comp.id === ROOT && !trail.length) return <span className="flex shrink-0 items-center gap-1.5 px-1 font-semibold"><LayersThree01 className="size-3.5 text-ink-muted" />Sequence</span>;
    return (
        <div className="flex max-w-[40%] min-w-0 shrink items-center gap-1 overflow-hidden px-1">
            {[...trail, comp.id].map((id, i, all) => {
                const c = compById(project, id);
                const last = i === all.length - 1;
                return (
                    <span key={id} className="flex items-center gap-1">
                        <button type="button" disabled={last} onClick={() => openComp(id)} className={`max-w-32 truncate rounded px-1 ${last ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                            {c.id === ROOT ? "Sequence" : c.name}
                        </button>
                        {!last && <span className="text-ink-subtle">›</span>}
                    </span>
                );
            })}
        </div>
    );
}

// ---- Ruler ----

function tickStep(pps: number): number {
    const steps = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find((s) => s * pps >= 70) ?? 600;
}

function Ruler({ comp, pps, width }: { comp: VComp; pps: number; width: number }) {
    const markerSel = useVideoUi((s) => s.marker);
    const step = tickStep(pps);
    const ticks: number[] = [];
    for (let t = 0; t * pps <= width; t += step) ticks.push(t);
    const scrub = (e: React.PointerEvent) => {
        const el = e.currentTarget as HTMLElement;
        const box = el.getBoundingClientRect();
        const at = (x: number) => {
            let t = Math.max(0, (x - box.left) / pps);
            if (vui.get().snapping) t = snapTime(t, comp.fps);
            seek(t);
        };
        el.setPointerCapture(e.pointerId);
        at(e.clientX);
        const move = (ev: PointerEvent) => at(ev.clientX);
        const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
    };
    const inP = comp.inPoint ?? null;
    const outP = comp.outPoint ?? null;
    return (
        <div className="sticky top-0 z-20 flex border-b border-panel-border bg-panel" style={{ height: RULER }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-panel-border bg-panel px-2 text-ink-subtle" style={{ width: HEAD }}>
                {comp.width}×{comp.height} · {comp.fps} fps
            </div>
            <div className="relative cursor-ew-resize touch-none select-none" style={{ width }} onPointerDown={scrub}>
                {(inP !== null || outP !== null) && <div className="absolute inset-y-0 bg-brand-500/15" style={{ left: (inP ?? 0) * pps, width: ((outP ?? compLength(comp)) - (inP ?? 0)) * pps }} />}
                {inP !== null && <div className="absolute top-0 bottom-0 w-0.5 bg-brand-500" style={{ left: inP * pps }} title="In" />}
                {outP !== null && <div className="absolute top-0 bottom-0 w-0.5 bg-brand-500" style={{ left: outP * pps }} title="Out" />}
                {ticks.map((t) => (
                    <div key={t} className="absolute bottom-0" style={{ left: t * pps }}>
                        <div className="absolute bottom-0 h-2 w-px bg-ink-subtle" />
                        <span className="absolute bottom-2.5 left-1 text-[10px] whitespace-nowrap text-ink-muted tabular-nums">{rulerLabel(t, step, comp.fps)}</span>
                    </div>
                ))}
                {comp.markers.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        title={`${m.name} (${timecode(m.t, comp.fps)})`}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            vui.set({ marker: m.id, selection: [], transition: null });
                            seek(m.t);
                        }}
                        className="absolute top-0 -translate-x-1/2"
                        style={{ left: m.t * pps }}
                    >
                        <svg viewBox="0 0 10 14" className="h-3.5 w-2.5">
                            <path d="M0 0h10v9l-5 5-5-5z" fill={m.color} stroke={markerSel === m.id ? "#fff" : "none"} />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    );
}

function rulerLabel(t: number, step: number, fps: number): string {
    if (step < 1) {
        const f = Math.round((t % 1) * fps);
        return f === 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, "0")}` : `${f}f`;
    }
    return `${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, "0")}`;
}

// ---- Playhead ----

function Playhead({ comp, pps, scrollRef }: { comp: VComp; pps: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
    const time = useVideoUi((s) => s.time);
    const playing = useVideoUi((s) => s.playing);
    const x = HEAD + time * pps;
    // Keep it in view while playing.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !playing) return;
        const left = el.scrollLeft + HEAD;
        const right = el.scrollLeft + el.clientWidth;
        if (x > right - 40 || x < left) el.scrollLeft = Math.max(0, x - HEAD - 60);
    }, [x, playing, scrollRef]);
    void comp;
    return (
        <div className="pointer-events-none absolute top-0 bottom-0 z-30" style={{ left: x }}>
            <div className="absolute top-0 bottom-0 w-px bg-brand-500" />
            <div className="absolute top-0 h-3.5 w-3 -translate-x-1/2 rounded-b-sm bg-brand-500" style={{ marginLeft: 0.5 }} />
        </div>
    );
}

// ---- Tracks ----

interface RowProps {
    project: VProject;
    comp: VComp;
    track: VTrack;
    pps: number;
    width: number;
    tool: "select" | "razor";
    snapping: boolean;
    selected: Set<string>;
    doc: NagmaDocument;
}

function TrackRow({ project, comp, track, pps, width, tool, snapping, selected, doc }: RowProps) {
    const h = rowHeight(track);
    const clips = comp.clips.filter((c) => c.track === track.id);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const laneRef = useRef<HTMLDivElement>(null);
    const timeAt = (clientX: number) => {
        const box = laneRef.current?.getBoundingClientRect();
        return box ? Math.max(0, snapTime((clientX - box.left) / pps, comp.fps)) : 0;
    };
    const onDragOver = (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (types.includes(MEDIA_MIME) || types.includes(LIB_MIME) || types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropAt(timeAt(e.clientX));
        }
    };
    const onDrop = (e: React.DragEvent) => {
        setDropAt(null);
        const t = timeAt(e.clientX);
        const mediaIds = e.dataTransfer.getData(MEDIA_MIME);
        if (mediaIds) {
            e.preventDefault();
            insertMedia(JSON.parse(mediaIds) as string[], t, track.id);
            return;
        }
        const lib = e.dataTransfer.getData(LIB_MIME);
        if (lib) {
            e.preventDefault();
            const item = JSON.parse(lib) as LibraryDrag;
            // Effects, transitions and presets don't go onto a locked track's clips.
            if (track.locked && item.type !== "title" && item.type !== "shape") return editor.notify("That track is locked.");
            const hit = clips.find((c) => t >= c.start && t <= clipEnd(c));
            if (item.type === "title") addTitle(item.id, t);
            else if (item.type === "shape") addShape(item.id as "rect", t);
            else if (hit && item.type === "effect") void addEffect(item.id, [hit.id]);
            else if (hit && item.type === "motion") {
                vui.set({ selection: [hit.id] });
                applyMotionPreset(item.id);
            } else if (hit && item.type === "transition") applyTransition(item.id as "dissolve", hit.id, t - hit.start < hit.duration / 2 ? "in" : "out");
            else if (item.type !== "transition") editor.notify("Drop it on a clip.");
            return;
        }
        const files = Array.from(e.dataTransfer.files);
        if (files.length) {
            e.preventDefault();
            void importFiles(files, { at: t, track: track.id });
        }
    };
    return (
        <div className="relative flex border-b border-panel-border/70" style={{ height: h }}>
            <TrackHeader comp={comp} track={track} h={h} />
            <div
                ref={laneRef}
                data-lane={track.id}
                data-pps={pps}
                className={`relative ${track.locked ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(127,127,127,0.06)_6px_12px)]" : ""} ${track.kind === "audio" ? "bg-emerald-500/[0.02]" : ""}`}
                style={{ width, height: h }}
                onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    vui.set({ selection: [], transition: null, marker: null });
                    seek(timeAt(e.clientX));
                }}
                onDragOver={onDragOver}
                onDragLeave={() => setDropAt(null)}
                onDrop={onDrop}
            >
                {clips.map((clip) => (
                    <ClipBox key={clip.id} project={project} comp={comp} clip={clip} track={track} pps={pps} h={h} tool={tool} snapping={snapping} selected={selected.has(clip.id)} doc={doc} />
                ))}
                {dropAt !== null && <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-brand-500" style={{ left: dropAt * pps }} />}
            </div>
        </div>
    );
}

function TrackHeader({ comp, track, h }: { comp: VComp; track: VTrack; h: number }) {
    const set = (patch: Partial<VTrack>) => setTrack(track.id, patch);
    const btn = "flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <div data-track-head={track.id} className="group sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-panel-border bg-panel pr-1 pl-2" style={{ width: HEAD, height: h }}>
            <span className={`flex h-6 w-8 shrink-0 items-center justify-center rounded font-semibold ${track.kind === "video" ? "bg-brand-500/15 text-brand-500" : "bg-emerald-500/15 text-emerald-500"}`}>{track.name}</span>
            <div className="flex-1" />
            {track.kind === "video" ? (
                <button type="button" aria-label={track.hidden ? "Show track" : "Hide track"} title={track.hidden ? "Show track" : "Hide track"} className={btn} onClick={() => set({ hidden: !track.hidden })}>
                    {track.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
            ) : (
                <>
                    <button type="button" aria-label={track.muted ? "Unmute track" : "Mute track"} title={track.muted ? "Unmute" : "Mute"} className={`${btn} ${track.muted ? "bg-amber-500/20 text-amber-500" : ""}`} onClick={() => set({ muted: !track.muted })}>
                        {track.muted ? <VolumeX className="size-3.5" /> : <VolumeMax className="size-3.5" />}
                    </button>
                    <button type="button" aria-label={track.solo ? "Unsolo track" : "Solo track"} title="Solo" className={`${btn} text-[10px] font-bold ${track.solo ? "bg-brand-500/20 text-brand-500" : ""}`} onClick={() => set({ solo: !track.solo })}>
                        S
                    </button>
                </>
            )}
            <button type="button" aria-label={track.locked ? "Unlock track" : "Lock track"} title={track.locked ? "Unlock" : "Lock"} className={`${btn} ${track.locked ? "text-ink" : ""}`} onClick={() => set({ locked: !track.locked })}>
                {track.locked ? <Lock01 className="size-3.5" /> : <LockUnlocked01 className="size-3.5" />}
            </button>
            <button type="button" aria-label="Delete track" title="Delete track" className={`${btn} invisible group-hover:visible`} onClick={() => commitComp(removeTrack(comp, track.id))}>
                <Trash01 className="size-3" />
            </button>
        </div>
    );
}

// ---- Clips ----

function snapPoints(comp: VComp, exclude: Set<string>): number[] {
    const pts = [0, vui.get().time];
    for (const c of comp.clips) {
        if (exclude.has(c.id)) continue;
        pts.push(c.start, clipEnd(c));
    }
    for (const m of comp.markers) pts.push(m.t);
    if (comp.inPoint != null) pts.push(comp.inPoint);
    if (comp.outPoint != null) pts.push(comp.outPoint);
    return pts;
}

// The nearest snap within 8 pixels for any of `edges` moved by `dt`.
function snapShift(points: number[], edges: number[], dt: number, pps: number): number {
    let best = dt;
    let dist = 8 / pps;
    for (const e of edges)
        for (const p of points) {
            const d = Math.abs(e + dt - p);
            if (d < dist) {
                dist = d;
                best = p - e;
            }
        }
    return best;
}

interface ClipProps {
    project: VProject;
    comp: VComp;
    clip: VClip;
    track: VTrack;
    pps: number;
    h: number;
    tool: "select" | "razor";
    snapping: boolean;
    selected: boolean;
    doc: NagmaDocument;
}

function ClipBox({ project, comp, clip, track, pps, h, tool, snapping, selected, doc }: ClipProps) {
    const media = mediaById(project, clip.media);
    const transition = useVideoUi((s) => s.transition);
    const [hoverX, setHoverX] = useState<number | null>(null);
    const left = clip.start * pps;
    const w = Math.max(3, clip.duration * pps);
    const color = clip.label ?? TRACK_COLORS[clip.kind];
    const poster = media?.poster ? imageSrc(doc.images, media.poster) : null;

    const startDrag = (e: React.PointerEvent, mode: "move" | "in" | "out") => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (tool === "razor" && mode === "move") {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            splitClipAt(clip.id, clip.start + (e.clientX - box.left) / pps);
            return;
        }
        const s = vui.get();
        let sel = s.selection;
        if (e.shiftKey || e.metaKey) sel = sel.includes(clip.id) ? sel.filter((id) => id !== clip.id) : [...sel, clip.id];
        else if (!sel.includes(clip.id)) sel = [...withLinked(comp, [clip.id])];
        vui.set({ selection: sel, transition: null, marker: null });
        if (track.locked) return;
        const base = editor.get().doc;
        const startX = e.clientX;
        const startY = e.clientY;
        const ids = withLinked(comp, mode === "move" ? sel : [clip.id]);
        const moving = comp.clips.filter((c) => ids.has(c.id));
        const points = snapping ? snapPoints(comp, ids) : [];
        const copy = e.altKey && mode === "move";
        const ripple = e.altKey && mode !== "move";
        let result: VComp | null = null;
        let moved = false;
        // Window listeners: the clip's element can move to another track's row mid-drag.
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
            moved = true;
            let dt = dx / pps;
            if (mode === "move") {
                if (snapping) dt = snapShift(points, moving.flatMap((c) => [c.start, clipEnd(c)]), dt, pps);
                const dTrack = Math.round((ev.clientY - startY) / h);
                dt = snapTime(dt, comp.fps);
                if (copy) {
                    const pasted = pasteClips(comp, moving, Math.min(...moving.map((c) => c.start)) + dt);
                    result = pasted.comp;
                } else result = moveClips(comp, ids, dt, dTrack);
            } else {
                const edge = mode === "in" ? clip.start : clipEnd(clip);
                if (snapping) dt = snapShift(points, [edge], dt, pps);
                dt = snapTime(dt, comp.fps);
                result = trimClip(project, comp, clip.id, mode, dt, ripple);
            }
            previewComp(base, result);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (moved && result) commitComp(result, projectOf(base), base);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const keys = selected ? keyTimes(clip) : [];
    const tinSel = transition?.clip === clip.id && transition.side === "in";
    const toutSel = transition?.clip === clip.id && transition.side === "out";
    const hasPrev = clip.tin ? comp.clips.some((c) => c.track === clip.track && c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 0.5 / comp.fps) : false;

    return (
        <div
            role="button"
            aria-label={`${clip.name}${clip.kind === "audio" ? " (audio)" : ""}`}
            data-clip-id={clip.id}
            className={`group absolute top-1 bottom-1 overflow-hidden rounded-md border text-white select-none ${selected ? "border-white ring-1 ring-white/80" : "border-black/30"} ${clip.disabled ? "opacity-40" : ""} ${tool === "razor" ? "cursor-[crosshair]" : "cursor-grab active:cursor-grabbing"}`}
            style={{ left, width: w, background: `color-mix(in srgb, ${color} ${selected ? 70 : 55}%, #18181b)` }}
            onPointerDown={(e) => startDrag(e, "move")}
            onPointerMove={(e) => tool === "razor" && setHoverX(e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left)}
            onPointerLeave={() => setHoverX(null)}
            onDoubleClick={() => clip.kind === "comp" && openNested(clip.id)}
            title={`${clip.name} · ${timecode(clip.duration, comp.fps)}${clip.speed !== 1 ? ` · ${Math.round(clip.speed * 100)}%` : ""}`}
        >
            {clip.kind === "video" && poster && <div className="pointer-events-none absolute inset-x-0 top-4 bottom-0 opacity-70" style={{ backgroundImage: `url(${poster})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />}
            {clip.kind === "image" && poster && <div className="pointer-events-none absolute inset-x-0 top-4 bottom-0 opacity-70" style={{ backgroundImage: `url(${poster})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />}
            {clip.kind === "audio" && media?.peaks && <Waveform media={media} clip={clip} w={w} h={h - 8} />}
            <div className="pointer-events-none relative flex h-4 items-center gap-1 truncate bg-black/25 px-1.5 text-[10px] font-medium">
                {clip.kind === "comp" && <LayersThree01 className="size-2.5 shrink-0" />}
                {clip.link && <Link01 className="size-2.5 shrink-0 opacity-70" />}
                <span className="truncate">{clip.name}</span>
                {clip.speed !== 1 && <span className="shrink-0 opacity-70">{Math.round(clip.speed * 100)}%</span>}
                {clip.effects.length > 0 && <span className="shrink-0 rounded bg-white/20 px-1 text-[9px]">fx</span>}
            </div>
            {clip.kind === "title" && clip.title && <div className="pointer-events-none relative truncate px-1.5 pt-0.5 text-[10px] opacity-80">{clip.title.text.replace(/\n/g, " ")}</div>}
            {keys.map((k) => (
                <span key={k} className="pointer-events-none absolute bottom-1 -translate-x-1/2" style={{ left: k * pps }}>
                    <Diamond on size={7} />
                </span>
            ))}
            {clip.tin && clip.tin.duration > 0 && (
                <TransitionChip
                    label={transitionLabel(clip.tin.kind)}
                    left={hasPrev ? 0 : 0}
                    width={(hasPrev ? clip.tin.duration / 2 : clip.tin.duration) * pps}
                    selected={tinSel}
                    onSelect={() => vui.set({ transition: { clip: clip.id, side: "in" }, selection: [], marker: null })}
                    side="in"
                />
            )}
            {clip.tout && clip.tout.duration > 0 && (
                <TransitionChip label={transitionLabel(clip.tout.kind)} left={w - clip.tout.duration * pps} width={clip.tout.duration * pps} selected={toutSel} onSelect={() => vui.set({ transition: { clip: clip.id, side: "out" }, selection: [], marker: null })} side="out" />
            )}
            {tool === "razor" && hoverX !== null && <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white" style={{ left: hoverX }} />}
            {tool === "select" && !track.locked && (
                <>
                    <div className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-white/50" onPointerDown={(e) => startDrag(e, "in")} title="Trim (⌥ ripples)" />
                    <div className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize hover:bg-white/50" onPointerDown={(e) => startDrag(e, "out")} title="Trim (⌥ ripples)" />
                </>
            )}
        </div>
    );
}

function TransitionChip({ label, left, width, selected, onSelect, side }: { label: string; left: number; width: number; selected: boolean; onSelect: () => void; side: "in" | "out" }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={`Transition: ${label}`}
            onPointerDown={(e) => {
                e.stopPropagation();
                onSelect();
            }}
            className={`absolute top-4 bottom-0 z-[5] flex items-center justify-center overflow-hidden border text-[9px] font-semibold ${selected ? "border-white bg-white/45" : "border-white/40 bg-white/25 hover:bg-white/35"} ${side === "in" ? "rounded-r" : "rounded-l"}`}
            style={{ left, width: Math.max(8, width), backgroundImage: "linear-gradient(to top right, transparent calc(50% - 0.5px), rgba(255,255,255,0.6) 50%, transparent calc(50% + 0.5px))" }}
        >
            <span className="truncate px-0.5 drop-shadow">{width > 50 ? label : ""}</span>
        </button>
    );
}

const Waveform = memo(function Waveform({ media, clip, w, h }: { media: VMedia; clip: VClip; w: number; h: number }) {
    const d = useMemo(() => {
        const peaks = media.peaks ?? [];
        const cols = Math.max(1, Math.min(2000, Math.floor(w / 2)));
        const mid = 8 + (h - 8) / 2;
        const amp = (h - 10) / 2;
        let top = "";
        let bottom = "";
        for (let i = 0; i <= cols; i++) {
            const lt = (i / cols) * clip.duration;
            const st = clip.reverse ? clip.in + (clip.duration - lt) * clip.speed : clip.in + lt * clip.speed;
            const p = peaks[Math.floor(st * PEAK_RATE)] ?? 0;
            const x = (i / cols) * w;
            top += `${i ? "L" : "M"}${x.toFixed(1)},${(mid - p * amp).toFixed(1)}`;
            bottom = `L${x.toFixed(1)},${(mid + p * amp).toFixed(1)}${bottom}`;
        }
        return `${top}${bottom}Z`;
    }, [media.peaks, clip.in, clip.duration, clip.speed, clip.reverse, w, h]);
    return (
        <svg className="pointer-events-none absolute inset-0" width={w} height={h + 8} aria-hidden>
            <path d={d} fill="rgba(255,255,255,0.55)" />
        </svg>
    );
});

function MagnetIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
            <path d="M3.5 2.5v5a4.5 4.5 0 009 0v-5M3.5 5.5h3M9.5 5.5h3M6.5 2.5v5a1.5 1.5 0 003 0v-5" strokeLinejoin="round" />
        </svg>
    );
}

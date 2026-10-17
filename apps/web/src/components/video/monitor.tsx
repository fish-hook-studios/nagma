import { FlipBackward, FlipForward, PauseCircle, Play, Repeat04, SkipBack, SkipForward } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editor, useEditor } from "../../engine/store";
import { setProp } from "../../engine/video/edit";
import { propAt } from "../../engine/video/model";
import { jumpEdit, markerAtPlayhead, setInOut, step, togglePlay } from "../../engine/video/actions";
import { compById, compLength, projectOf } from "../../engine/video/model";
import { renderComp } from "../../engine/video/render";
import { syncPlayers } from "../../engine/video/audio";
import { activeComp, commitComp, currentProject, previewComp, useVideoUi, vui } from "../../engine/video/state";
import { IconButton } from "../icon-button";
import { Select } from "../select";
import { timecode } from "../../engine/video/format";

// The program monitor: the open composition at the playhead, with safe-area guides, fit or zoom,
// and the transport (play, frame steps, edit points, in and out, loop).

export function Monitor({ onDropFiles }: { onDropFiles: (files: File[]) => void }) {
    const doc = useEditor((s) => s.doc);
    const compId = useVideoUi((s) => s.compId);
    const time = useVideoUi((s) => s.time);
    const playing = useVideoUi((s) => s.playing);
    const rate = useVideoUi((s) => s.rate);
    const quality = useVideoUi((s) => s.quality);
    const safeArea = useVideoUi((s) => s.safeArea);
    const zoom = useVideoUi((s) => s.monitorZoom);
    const loop = useVideoUi((s) => s.loop);
    const project = projectOf(doc);
    const comp = compById(project, compId);
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [box, setBox] = useState({ w: 640, h: 360 });
    const pump = useRef<{ busy: boolean; dirty: boolean }>({ busy: false, dirty: false });
    const latest = useRef({ doc, compId, time, playing, rate, quality });
    useLayoutEffect(() => {
        latest.current = { doc, compId, time, playing, rate, quality };
    });

    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        setBox({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    const pad = 24;
    const fit = Math.min((box.w - pad * 2) / comp.width, (box.h - pad * 2) / comp.height);
    const viewScale = zoom === "fit" ? Math.max(0.02, fit) : zoom;
    const dpr = window.devicePixelRatio || 1;
    const qualityK = quality === "full" ? 1 : quality === "half" ? 0.5 : quality === "quarter" ? 0.25 : playing && comp.width * comp.height > 1280 * 720 ? 0.5 : 1;
    const renderScale = Math.min(1, viewScale * dpr) * qualityK;
    const cw = Math.max(2, Math.round(comp.width * renderScale));
    const ch = Math.max(2, Math.round(comp.height * renderScale));

    // Renders the latest state; a render in flight finishes first, then the newest wins.
    useEffect(() => {
        const p = pump.current;
        if (p.busy) {
            p.dirty = true;
            return;
        }
        const run = async () => {
            p.busy = true;
            do {
                p.dirty = false;
                const s = latest.current;
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext("2d", { willReadFrequently: true });
                if (!canvas || !ctx) break;
                const proj = projectOf(s.doc);
                const c = compById(proj, s.compId);
                const forward = s.playing && s.rate === 1;
                syncPlayers(proj, c, s.time, forward);
                try {
                    await renderComp(ctx, c, s.time, { project: proj, doc: s.doc, scale: canvas.width / c.width, exact: !forward, tag: "monitor:" });
                } catch (error) {
                    console.warn(error);
                }
            } while (p.dirty);
            p.busy = false;
        };
        void run();
    }, [doc, compId, time, playing, rate, cw, ch]);

    // Stopping playback silences the players.
    useEffect(() => {
        if (playing) return;
        const s = latest.current;
        const proj = projectOf(s.doc);
        syncPlayers(proj, compById(proj, s.compId), s.time, false);
    }, [playing]);

    const len = compLength(comp);
    const dispW = comp.width * viewScale;
    const dispH = comp.height * viewScale;

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
            <div
                ref={boxRef}
                className={`relative min-h-0 flex-1 ${zoom === "fit" ? "overflow-hidden" : "overflow-auto"}`}
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
                }}
                onDrop={(e) => {
                    const files = Array.from(e.dataTransfer.files);
                    if (!files.length) return;
                    e.preventDefault();
                    onDropFiles(files);
                }}
                onDoubleClick={() => vui.set({ monitorZoom: "fit" })}
            >
                <div className="flex min-h-full min-w-full items-center justify-center" style={{ padding: pad, width: zoom === "fit" ? undefined : dispW + pad * 2, height: zoom === "fit" ? undefined : dispH + pad * 2 }}>
                    <div className="relative shrink-0 shadow-[0_8px_30px_rgba(0,0,0,0.35)]" style={{ width: dispW, height: dispH }}>
                        <canvas ref={canvasRef} width={cw} height={ch} aria-label="Program monitor" className="block size-full bg-black" onPointerDown={(e) => dragSelected(e, viewScale)} />
                        {safeArea && <SafeGuides />}
                        {comp.clips.length === 0 && (
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-white/60">
                                <span className="text-[13px] font-semibold text-white/80">Drop video, sound or images here</span>
                                <span>or import them from the Project panel, then drag them to the timeline.</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex min-h-10 min-w-0 shrink-0 flex-wrap items-center gap-1 border-t border-panel-border bg-panel px-2 py-1 whitespace-nowrap">
                <span className="w-[92px] font-mono text-[12px] text-brand-500 tabular-nums" title="Playhead">
                    {timecode(time, comp.fps)}
                </span>
                <div className="flex-1" />
                <IconButton size="sm" icon={MarkIn} label="Mark in" shortcut="I" onPress={() => setInOut("in")} />
                <IconButton size="sm" icon={MarkOut} label="Mark out" shortcut="O" onPress={() => setInOut("out")} />
                <IconButton size="sm" icon={MarkerIcon} label="Add marker" shortcut="M" onPress={markerAtPlayhead} />
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <IconButton size="sm" icon={SkipBack} label="Previous edit" shortcut="↑" onPress={() => jumpEdit(-1)} />
                <IconButton size="sm" icon={FlipBackward} label="Back one frame" shortcut="←" onPress={() => step(-1)} />
                <IconButton icon={playing ? PauseCircle : Play} label={playing ? "Pause" : "Play"} shortcut="Space" active={playing} onPress={togglePlay} />
                <IconButton size="sm" icon={FlipForward} label="Forward one frame" shortcut="→" onPress={() => step(1)} />
                <IconButton size="sm" icon={SkipForward} label="Next edit" shortcut="↓" onPress={() => jumpEdit(1)} />
                <div className="mx-1 h-5 w-px bg-panel-border" />
                <IconButton size="sm" icon={Repeat04} label="Loop playback" active={loop} onPress={() => vui.set({ loop: !loop })} />
                <IconButton size="sm" icon={SafeIcon} label="Safe margins" active={safeArea} onPress={() => vui.set({ safeArea: !safeArea })} />
                <div className="flex-1" />
                {playing && rate !== 1 && <span className="rounded bg-brand-500/15 px-1.5 text-[10px] font-semibold text-brand-500">{rate > 0 ? `${rate}×` : `◀ ${-rate}×`}</span>}
                <Select aria-label="Playback quality" value={quality} onChange={(e) => vui.set({ quality: e.target.value as typeof quality })} className="h-7 w-[86px]">
                    <option value="auto">Auto</option>
                    <option value="full">Full</option>
                    <option value="half">1/2</option>
                    <option value="quarter">1/4</option>
                </Select>
                <Select aria-label="Monitor zoom" value={String(zoom)} onChange={(e) => vui.set({ monitorZoom: e.target.value === "fit" ? "fit" : Number(e.target.value) })} className="h-7 w-[76px]">
                    <option value="fit">Fit</option>
                    <option value="0.25">25%</option>
                    <option value="0.5">50%</option>
                    <option value="1">100%</option>
                    <option value="2">200%</option>
                </Select>
                <span className="w-[92px] text-right font-mono text-[12px] text-ink-muted tabular-nums" title="Duration">
                    {timecode(len, comp.fps)}
                </span>
            </div>
        </div>
    );
}

function SafeGuides() {
    return (
        <div className="pointer-events-none absolute inset-0">
            <div className="absolute border border-white/50" style={{ inset: "5%" }} />
            <div className="absolute border border-dashed border-white/40" style={{ inset: "10%" }} />
            <div className="absolute top-1/2 left-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-white/50" />
            <div className="absolute top-1/2 left-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-white/50" />
        </div>
    );
}

function MarkIn(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
            <path d="M6 3H4v10h2M9 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function MarkOut(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
            <path d="M10 3h2v10h-2M7 5L4 8l3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function MarkerIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
            <path d="M4.5 2.5h7v7L8 13l-3.5-3.5z" strokeLinejoin="round" />
        </svg>
    );
}

function SafeIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" {...props}>
            <rect x="1.5" y="3" width="13" height="10" rx="1" />
            <rect x="4" y="5.2" width="8" height="5.6" strokeDasharray="1.5 1.2" />
        </svg>
    );
}

// Dragging in the monitor moves the selected clip (a keyframe at the playhead when its position
// is animated).
function dragSelected(e: React.PointerEvent, viewScale: number) {
    const s = vui.get();
    const comp = activeComp();
    const clip = comp.clips.find((c) => s.selection.includes(c.id) && c.kind !== "audio" && c.kind !== "adjustment" && s.time >= c.start && s.time < c.start + c.duration);
    if (!clip) return;
    e.preventDefault();
    const base = editor.get().doc;
    const lt = s.time - clip.start;
    const x0 = propAt(comp, clip, "x", lt);
    const y0 = propAt(comp, clip, "y", lt);
    const sx = e.clientX;
    const sy = e.clientY;
    let last: ReturnType<typeof activeComp> | null = null;
    const move = (ev: PointerEvent) => {
        let dx = (ev.clientX - sx) / viewScale;
        let dy = (ev.clientY - sy) / viewScale;
        // ⇧ keeps to one axis.
        if (ev.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
        }
        const moved = setProp(setProp(clip, "x", Math.round(x0 + dx), lt), "y", Math.round(y0 + dy), lt);
        last = { ...comp, clips: comp.clips.map((c) => (c.id === clip.id ? moved : c)) };
        previewComp(base, last);
    };
    const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (last) commitComp(last, currentProject(), base);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
}

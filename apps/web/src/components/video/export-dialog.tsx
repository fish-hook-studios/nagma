import { X } from "@untitledui/icons";
import { useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { download, safeName } from "../../engine/export";
import { editor, useEditor } from "../../engine/store";
import { type ExportFormat, type ExportProgress, type ExportSettings, exportRange, outputSize, renderToFile, setLastExport } from "../../engine/video/export";
import { compById, projectOf } from "../../engine/video/model";
import { useVideoUi, vui } from "../../engine/video/state";
import { Select } from "../select";
import { timecode } from "../../engine/video/format";

// Export: MP4 (H.264 and AAC), WebM (VP9 and Opus), an animated GIF, Lottie, animated SVG, or the
// frame at the playhead as PNG, with size, frame rate, quality, looping and range, and a progress
// bar that can be cancelled.

const FORMATS: { id: ExportFormat; label: string; about: string }[] = [
    { id: "mp4", label: "MP4", about: "H.264 video with AAC sound" },
    { id: "webm", label: "WebM", about: "VP9 video with Opus sound" },
    { id: "gif", label: "GIF", about: "animated GIF, without sound" },
    { id: "lottie", label: "Lottie", about: "Lottie JSON: shapes and solids stay vector, other clips become images, without sound" },
    { id: "dotlottie", label: "dotLottie", about: "the Lottie animation in a compressed .lottie file, without sound" },
    { id: "svg", label: "SVG", about: "animated SVG that plays and loops in browsers: shapes stay vector, other clips become images, without sound" },
    { id: "png", label: "PNG", about: "the frame at the playhead" },
];

export function ExportDialog() {
    const open = useVideoUi((s) => s.exportOpen);
    // Each opening starts from the sequence's own size and rate.
    return open ? <ExportWindow /> : null;
}

function ExportWindow() {
    const open = true;
    const doc = useEditor((s) => s.doc);
    const compId = useVideoUi((s) => s.compId);
    const time = useVideoUi((s) => s.time);
    const project = projectOf(doc);
    const comp = compById(project, compId);
    const hasRange = comp.inPoint != null || comp.outPoint != null;
    const [settings, setSettings] = useState<ExportSettings>({ format: "mp4", height: Math.min(1080, comp.height), fps: comp.fps, quality: 0.6, range: "all", loop: true, maxImages: 240 });
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancel = useRef(false);
    const close = () => {
        if (progress) cancel.current = true;
        vui.set({ exportOpen: false });
        setProgress(null);
        setError(null);
    };
    const [from, to] = exportRange(comp, settings.range);
    const size = outputSize(comp, settings.format === "gif" ? Math.min(settings.height, 720) : settings.height);
    const heights = [...new Set([comp.height, 2160, 1440, 1080, 720, 540, 480, 360].filter((h) => h <= Math.max(comp.height, 2160)))].sort((a, b) => b - a);

    const run = async () => {
        cancel.current = false;
        setError(null);
        setProgress({ frame: 0, frames: 1, stage: "video" });
        try {
            const blob = await renderToFile(project, editor.get().doc, comp, { ...settings, at: time }, (p) => setProgress(p), () => cancel.current);
            if (!blob) return;
            const ext = settings.format === "lottie" ? "json" : settings.format === "dotlottie" ? "lottie" : settings.format;
            const name = `${safeName(doc.name || "Video")}.${ext}`;
            setLastExport({ blob, name, seconds: settings.format === "png" ? 0 : to - from, ...size });
            download(blob, name);
            editor.notify(`${FORMATS.find((f) => f.id === settings.format)?.label ?? ext.toUpperCase()} saved: ${(blob.size / 1024 / 1024).toFixed(1)} MB, ${size.width}×${size.height}${settings.format === "png" ? "" : `, ${(to - from).toFixed(1)}s`}.`);
            vui.set({ exportOpen: false });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setProgress(null);
        }
    };

    const pct = progress ? Math.round((progress.frame / Math.max(1, progress.frames)) * 100) : 0;
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable={!progress} className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            <AriaModal className="w-[480px] rounded-xl border border-panel-border bg-panel-raised text-[12px] text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Export video">
                    <div className="flex h-11 items-center justify-between border-b border-panel-border px-4">
                        <span className="text-[13px] font-semibold">Export</span>
                        <AriaButton aria-label="Close" onPress={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <div className="space-y-3 px-4 py-3">
                        <div role="radiogroup" aria-label="Format" className="grid grid-cols-7 gap-0.5 rounded-md bg-field p-0.5">
                            {FORMATS.map((f) => (
                                <button key={f.id} type="button" role="radio" aria-label={f.label} aria-checked={settings.format === f.id} disabled={Boolean(progress)} title={f.about} onClick={() => setSettings({ ...settings, format: f.id })} className={`h-7 rounded text-[10.5px] font-medium ${settings.format === f.id ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-2">
                            <span className="text-ink-muted">Resolution</span>
                            <Select aria-label="Resolution" value={String(settings.height)} onChange={(e) => setSettings({ ...settings, height: Number(e.target.value) })} className="h-7">
                                {heights.map((h) => {
                                    const s = outputSize(comp, h);
                                    return <option key={h} value={String(h)}>{`${s.width}×${s.height}${h === comp.height ? " (sequence)" : ""}`}</option>;
                                })}
                            </Select>
                            {settings.format !== "png" && (
                                <>
                                    <span className="text-ink-muted">Frame rate</span>
                                    <Select aria-label="Export frame rate" value={String(settings.fps)} onChange={(e) => setSettings({ ...settings, fps: Number(e.target.value) })} className="h-7">
                                        {[...new Set([comp.fps, 12, 15, 24, 25, 30, 50, 60])].sort((a, b) => a - b).map((f) => <option key={f} value={String(f)}>{`${f} fps${f === comp.fps ? " (sequence)" : ""}`}</option>)}
                                    </Select>
                                    <span className="text-ink-muted">Range</span>
                                    <Select aria-label="Range" value={settings.range} onChange={(e) => setSettings({ ...settings, range: e.target.value as ExportSettings["range"] })} className="h-7">
                                        <option value="all">Whole sequence</option>
                                        <option value="inout" disabled={!hasRange}>In to out</option>
                                    </Select>
                                </>
                            )}
                            {settings.format === "gif" && (
                                <>
                                    <span className="text-ink-muted">Playback</span>
                                    <Select aria-label="GIF playback" value={settings.loop === false ? "once" : "loop"} onChange={(e) => setSettings({ ...settings, loop: e.target.value === "loop" })} className="h-7">
                                        <option value="loop">Loop forever</option>
                                        <option value="once">Play once</option>
                                    </Select>
                                </>
                            )}
                            {(settings.format === "lottie" || settings.format === "dotlottie" || settings.format === "svg") && (
                                <>
                                    <span className="text-ink-muted">Images</span>
                                    <Select aria-label="Most images for moving clips" value={String(settings.maxImages ?? 240)} onChange={(e) => setSettings({ ...settings, maxImages: Number(e.target.value) })} className="h-7">
                                        {[60, 120, 240, 480, 960].map((n) => (
                                            <option key={n} value={String(n)}>{`Up to ${n} for moving clips`}</option>
                                        ))}
                                    </Select>
                                </>
                            )}
                            {(settings.format === "mp4" || settings.format === "webm") && (
                                <>
                                    <span className="text-ink-muted">Quality</span>
                                    <Select aria-label="Quality" value={String(settings.quality)} onChange={(e) => setSettings({ ...settings, quality: Number(e.target.value) })} className="h-7">
                                        <option value="0.2">Smaller file</option>
                                        <option value="0.6">Balanced</option>
                                        <option value="1">High</option>
                                    </Select>
                                </>
                            )}
                        </div>
                        <p className="text-ink-subtle">
                            {settings.format === "png"
                                ? `The frame at ${timecode(time, comp.fps)}, ${size.width}×${size.height}.`
                                : `${timecode(from, comp.fps)} to ${timecode(to, comp.fps)} (${(to - from).toFixed(2)}s), ${size.width}×${size.height}, ${FORMATS.find((f) => f.id === settings.format)?.about ?? ""}.`}
                        </p>
                        {progress && (
                            <div className="space-y-1">
                                <div className="h-1.5 overflow-hidden rounded-full bg-field">
                                    <div className="h-full bg-brand-500 transition-[width]" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="flex justify-between text-ink-muted">
                                    <span>{progress.stage === "finishing" ? "Writing the file…" : `Rendering frame ${progress.frame} of ${progress.frames}`}</span>
                                    <span className="tabular-nums">{pct}%</span>
                                </div>
                            </div>
                        )}
                        {error && <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-red-500">Export failed: {error}</p>}
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-panel-border px-4 py-3">
                        <AriaButton onPress={close} className="h-8 rounded-md px-3 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            {progress ? "Stop" : "Cancel"}
                        </AriaButton>
                        <AriaButton isDisabled={Boolean(progress) || (settings.format !== "png" && to - from <= 0)} onPress={() => void run()} className="h-8 rounded-md bg-brand-500 px-3 font-medium text-white outline-none hover:bg-brand-600 disabled:opacity-50">
                            {progress ? "Exporting…" : "Export"}
                        </AriaButton>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

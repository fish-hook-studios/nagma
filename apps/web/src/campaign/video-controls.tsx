import { PauseCircle, PlayCircle, Upload01, VolumeMax, VolumeX } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { NumberField } from "../components/number-field";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { importVideo, videoPaint } from "../engine/video";
import { isPlaying, setPosterFrame, setVideo, setVideoAdjust, toggleVideo, trimOf, videoOf } from "./video";
import type { ImageAdjust } from "../engine/types";

// The video menu in the floating toolbar: play, trim (where it starts and stops), volume, loop,
// the poster frame (what shows when it isn't playing) and replacing the file.

const ROW = "flex h-6 items-center gap-1.5 rounded-[5px] px-1.5 text-[11px] text-ink outline-none hover:bg-panel-hover disabled:opacity-40";

const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function VideoPopover({ node: initial }: { node: SceneNode }) {
    const node = useEditor((s) => s.doc.nodes[initial.id]) ?? initial;
    const v = videoOf(node);
    const [poster, setPoster] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    useEditor((s) => s.camera);
    if (!v) return null;
    const { video } = v;
    const { start, end } = trimOf(video);
    const playing = isPlaying(node.id);
    const volume = Math.round((video.volume ?? 1) * 100);
    const replace = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "video/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            setBusy(true);
            void importVideo(file)
                .then(({ poster: p, video: next }) => {
                    const fresh = editor.get().doc.nodes[node.id];
                    const now = videoOf(fresh);
                    if (!fresh || !now) return;
                    const paint = { ...videoPaint(p.id, { ...next, loop: video.loop, muted: video.muted, volume: video.volume }), mode: now.paint.mode };
                    editor.execute({ type: "batch", commands: [{ type: "image.add", id: p.id, data: p.data }, { type: "node.update", id: node.id, patch: { fills: fresh.fills.map((f, i) => (i === now.index ? paint : f)) } }] });
                })
                .catch((e) => editor.notify(`Couldn't open ${file.name}: ${e instanceof Error ? e.message : String(e)}`))
                .finally(() => setBusy(false));
        };
        input.click();
    };
    return (
        <div className="space-y-2.5 px-3 py-2.5">
            <div className="flex items-center justify-between">
                <span className="truncate font-semibold">{video.name}</span>
                <span className="shrink-0 text-ink-subtle">{time(video.seconds)}</span>
            </div>
            <AriaButton aria-label={playing ? "Pause" : "Play"} onPress={() => toggleVideo(node.id)} className={`${ROW} w-full justify-center border border-panel-border`}>
                {playing ? <PauseCircle className="size-3.5" /> : <PlayCircle className="size-3.5" />} {playing ? "Pause" : "Play"}
            </AriaButton>
            <div>
                <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">Trim</span>
                    <span className="text-ink-subtle">
                        {time(start)} to {time(end)}
                    </span>
                </div>
                <div className="relative h-5">
                    <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-field" />
                    <div className="absolute top-2 h-1 rounded-full bg-brand-500" style={{ left: `${(start / video.seconds) * 100}%`, right: `${100 - (end / video.seconds) * 100}%` }} />
                    <input
                        type="range"
                        aria-label="Trim start"
                        min={0}
                        max={video.seconds}
                        step={0.1}
                        value={start}
                        onChange={(e) => setVideo(node, { trimStart: Math.min(Number(e.target.value), end - 0.1) }, true)}
                        className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                    />
                    <input
                        type="range"
                        aria-label="Trim end"
                        min={0}
                        max={video.seconds}
                        step={0.1}
                        value={end}
                        onChange={(e) => setVideo(node, { trimEnd: Math.max(Number(e.target.value), start + 0.1) }, true)}
                        className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                    />
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                    <NumberField label="In" title="Starts at (seconds)" min={0} max={video.seconds} value={Math.round(start * 10) / 10} onCommit={(n) => setVideo(node, { trimStart: Math.max(0, Math.min(n, end - 0.1)) })} />
                    <NumberField label="Out" title="Stops at (seconds)" min={0} max={video.seconds} value={Math.round(end * 10) / 10} onCommit={(n) => setVideo(node, { trimEnd: Math.min(video.seconds, Math.max(n, start + 0.1)) })} />
                </div>
            </div>
            <div>
                <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">Volume</span>
                    <span className="text-ink-subtle">{video.hasAudio ? (video.muted ? "Muted" : `${volume}%`) : "No sound"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <AriaButton aria-label={video.muted ? "Unmute" : "Mute"} isDisabled={!video.hasAudio} onPress={() => setVideo(node, { muted: !video.muted })} className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover disabled:opacity-40">
                        {video.muted ? <VolumeX className="size-3.5" /> : <VolumeMax className="size-3.5" />}
                    </AriaButton>
                    <input type="range" aria-label="Volume" min={0} max={100} disabled={!video.hasAudio} value={volume} onChange={(e) => setVideo(node, { volume: Number(e.target.value) / 100, muted: false }, true)} className="min-w-0 flex-1 accent-brand-500" />
                </div>
            </div>
            <VideoAdjust node={node} />
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={video.loop} onChange={(e) => setVideo(node, { loop: e.target.checked })} className="accent-brand-500" />
                Loop
            </label>
            <div>
                <div className="mb-1 font-medium">Poster frame</div>
                <div className="flex items-center gap-1.5">
                    <input type="range" aria-label="Poster frame time" min={0} max={video.seconds} step={0.1} value={poster ?? start} onChange={(e) => setPoster(Number(e.target.value))} className="min-w-0 flex-1 accent-brand-500" />
                    <span className="w-10 shrink-0 text-right text-ink-subtle">{time(poster ?? start)}</span>
                </div>
                <AriaButton
                    isDisabled={busy}
                    onPress={() => {
                        setBusy(true);
                        void setPosterFrame(node, poster ?? start)
                            .then(() => editor.notify("Poster frame set."))
                            .finally(() => setBusy(false));
                    }}
                    className={`${ROW} mt-1 w-full justify-center border border-panel-border`}
                >
                    Use this frame
                </AriaButton>
            </div>
            <AriaButton isDisabled={busy} onPress={replace} className={`${ROW} w-full justify-center border border-panel-border`}>
                <Upload01 className="size-3.5" /> {busy ? "Working…" : "Replace video"}
            </AriaButton>
        </div>
    );
}

const ADJUST: { key: keyof ImageAdjust; label: string }[] = [
    { key: "exposure", label: "Exposure" },
    { key: "contrast", label: "Contrast" },
    { key: "saturation", label: "Saturation" },
    { key: "temperature", label: "Temperature" },
    { key: "tint", label: "Tint" },
    { key: "highlights", label: "Highlights" },
    { key: "shadows", label: "Shadows" },
];
const NONE: ImageAdjust = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0 };

// Adjust: the image sliders, for the video's frames.
function VideoAdjust({ node }: { node: SceneNode }) {
    const [open, setOpen] = useState(false);
    const v = videoOf(node);
    if (!v) return null;
    const adjust = v.paint.adjust ?? NONE;
    const changed = ADJUST.some((a) => adjust[a.key]);
    return (
        <div>
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between font-medium">
                Adjust
                <span className="font-normal text-ink-subtle">{changed ? "Edited" : open ? "" : "Off"}</span>
            </button>
            {open && (
                <div className="mt-1 space-y-1">
                    {ADJUST.map((a) => (
                        <label key={a.key} className="grid grid-cols-[72px_1fr_28px] items-center gap-1.5">
                            <span className="text-ink-muted">{a.label}</span>
                            <input type="range" aria-label={a.label} min={-100} max={100} value={adjust[a.key]} onChange={(e) => setVideoAdjust(node, { ...adjust, [a.key]: Number(e.target.value) }, true)} className="min-w-0 accent-brand-500" />
                            <span className="text-right text-ink-subtle">{adjust[a.key]}</span>
                        </label>
                    ))}
                    {changed && (
                        <button type="button" onClick={() => setVideoAdjust(node, undefined)} className="text-brand-500 hover:underline">
                            Reset
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

import { useEffect, useState } from "react";
import { imageBlob, imageSrc } from "../engine/image-store";
import { useEditor } from "../engine/store";
import { getPlayer, showLive } from "../engine/video";
import type { ImagePaint, NagmaDocument, SceneNode } from "../engine/types";
import { videoFills } from "./render";
import { jump, setShow, useShow } from "./show";
import { SlideThumb } from "./slide-list";

// What sits over the show's canvas: video playback and its controls, animated GIFs, clickable
// links, the slide navigator (G), the shortcut list (?) and the rehearsal summary.

// ---- Media and links on the slide ----

// The slide's videos play while it's on screen: those set to autoplay start by themselves, with
// their loop and sound settings; leaving the slide stops them.
function useSlideVideos(doc: NagmaDocument, slide: SceneNode | undefined, active: boolean): Record<string, HTMLVideoElement> {
    const [players, setPlayers] = useState<Record<string, HTMLVideoElement>>({});
    const key = slide && active ? videoFills(doc, slide).map(({ paint }) => `${paint.id}:${paint.video?.id}:${paint.video?.loop}:${paint.video?.muted}:${paint.video?.autoplay}`).join("|") : "";
    useEffect(() => {
        if (!slide || !active) return;
        const fills = videoFills(doc, slide);
        let gone = false;
        const started: { paintId: string; el: HTMLVideoElement }[] = [];
        for (const { paint } of fills) {
            const video = paint.video;
            if (!video) continue;
            void getPlayer(video).then((el) => {
                if (!el || gone) return;
                el.loop = video.loop;
                el.muted = video.muted;
                el.currentTime = 0;
                if (video.autoplay !== false) void el.play().catch(() => undefined);
                showLive(paint.id, el);
                started.push({ paintId: paint.id, el });
                setPlayers((p) => ({ ...p, [paint.id]: el }));
            });
        }
        return () => {
            gone = true;
            for (const { paintId, el } of started) {
                el.pause();
                showLive(paintId, null);
            }
            setPlayers({});
        };
        // The key stands for the slide's videos and their settings.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slide?.id, active, key]);
    return players;
}

function seek(el: HTMLVideoElement, seconds: number) {
    el.currentTime = seconds;
}

function toggleMute(el: HTMLVideoElement) {
    el.muted = !el.muted;
}

function VideoControls({ el }: { el: HTMLVideoElement }) {
    const [, tick] = useState(0);
    useEffect(() => {
        const update = () => tick((n) => n + 1);
        el.addEventListener("play", update);
        el.addEventListener("pause", update);
        el.addEventListener("timeupdate", update);
        return () => {
            el.removeEventListener("play", update);
            el.removeEventListener("pause", update);
            el.removeEventListener("timeupdate", update);
        };
    }, [el]);
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    return (
        <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-black/60 px-2 py-1 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={el.paused ? "Play video" : "Pause video"} onClick={() => (el.paused ? void el.play().catch(() => undefined) : el.pause())} className="flex size-6 items-center justify-center rounded hover:bg-white/15">
                {el.paused ? "▶" : "❚❚"}
            </button>
            <input
                type="range"
                aria-label="Video position"
                min={0}
                max={duration || 1}
                step={0.1}
                value={el.currentTime}
                onChange={(e) => seek(el, Number(e.target.value))}
                className="min-w-0 flex-1 accent-white"
            />
            <button type="button" aria-label={el.muted ? "Turn sound on" : "Mute"} onClick={() => toggleMute(el)} className="rounded px-1 hover:bg-white/15">
                {el.muted ? "Sound off" : "Sound on"}
            </button>
        </div>
    );
}

// GIFs draw as still pictures on the canvas; while presenting they play on top of it.
function useGifs(doc: NagmaDocument, slide: SceneNode | undefined): Set<string> {
    const [gifs, setGifs] = useState<Set<string>>(new Set());
    const ids = slide
        ? slide.children
              .map((c) => doc.nodes[c])
              .flatMap((n) => (n?.fills ?? []).filter((p): p is ImagePaint => p.type === "image" && !p.video).map((p) => p.id))
              .join(",")
        : "";
    useEffect(() => {
        let gone = false;
        const found = new Set<string>();
        void Promise.all(
            ids
                .split(",")
                .filter(Boolean)
                .map(async (id) => {
                    const blob = await imageBlob(doc.images, id).catch(() => null);
                    if (blob?.type === "image/gif") found.add(id);
                }),
        ).then(() => !gone && setGifs(found));
        return () => {
            gone = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ids]);
    return gifs;
}

function linkOf(node: SceneNode): string | null {
    const link = node.hyperlink ?? node.spans?.find((s) => s.hyperlink)?.hyperlink ?? null;
    return link && /^(https?:|mailto:)/.test(link) ? link : null;
}

export function SlideMedia({ slide, box, fit, active }: { slide: SceneNode; box: { x: number; y: number }; fit: number; active: boolean }) {
    const doc = useEditor((s) => s.doc);
    const players = useSlideVideos(doc, slide, active);
    const gifs = useGifs(doc, active ? slide : undefined);
    if (!active) return null;
    const place = (node: SceneNode) => ({ left: box.x + (node.x - slide.x) * fit, top: box.y + (node.y - slide.y) * fit, width: node.w * fit, height: node.h * fit });
    const out: React.ReactNode[] = [];
    for (const { node, paint } of videoFills(doc, slide)) {
        const el = players[paint.id];
        if (el) out.push(<div key={`v${paint.id}`} className="group absolute" style={place(node)}><VideoControls el={el} /></div>);
    }
    for (const id of slide.children) {
        const node = doc.nodes[id];
        if (!node || !node.visible) continue;
        const gif = node.fills.find((p): p is ImagePaint => p.type === "image" && !p.video && gifs.has(p.id));
        const src = gif ? imageSrc(doc.images, gif.id) : null;
        if (gif && src && !node.rotation) {
            out.push(
                <img
                    key={`g${node.id}`}
                    alt={node.altText ?? ""}
                    src={src}
                    className="pointer-events-none absolute"
                    style={{ ...place(node), objectFit: gif.mode === "fit" ? "contain" : "cover", borderRadius: node.radius * fit, opacity: node.opacity }}
                />,
            );
        }
        const link = linkOf(node);
        if (link) {
            out.push(
                <a key={`l${node.id}`} href={link} target="_blank" rel="noreferrer noopener" title={link} aria-label={`Open link: ${link}`} className="absolute cursor-pointer" style={place(node)} onClick={(e) => e.stopPropagation()} />,
            );
        }
    }
    return <>{out}</>;
}

// ---- Navigator, shortcuts and rehearsal ----

export function ShowNavigator() {
    const state = useShow();
    if (!state.navigator) return null;
    return (
        <div role="dialog" aria-label="Go to slide" className="absolute inset-0 z-30 overflow-y-auto bg-[#111114] p-8" style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between text-white">
                <span className="text-[15px] font-semibold">Go to slide</span>
                <button type="button" onClick={() => setShow({ navigator: false })} className="h-8 rounded-lg bg-white/10 px-3 text-[13px] hover:bg-white/20">Close (Esc)</button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {state.order.map((id, i) => (
                    <button key={id} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === state.index} onClick={() => jump(i)} className={`flex flex-col gap-1.5 justify-self-start rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white ${i === state.index ? "bg-[#F24E1E]" : "hover:bg-white/10"}`}>
                        <SlideThumb id={id} width={212} className="rounded" />
                        <span className="px-1 text-[12px] text-white/80">{i + 1}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

const SHOW_KEYS: [string, string][] = [
    ["Next step or slide", "→ ↓ Space Enter N Page Down, or click"],
    ["Previous step or slide", "← ↑ P Page Up Backspace, or right-click"],
    ["First / last slide", "Home / End"],
    ["Go to slide number", "Type the number, then Enter"],
    ["Slide navigator", "G"],
    ["Laser pointer", "L"],
    ["Black screen", "B or ."],
    ["Full screen", "F"],
    ["Shortcuts", "?"],
    ["End the show", "Esc"],
];

export function ShowHelp() {
    const state = useShow();
    if (!state.help) return null;
    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70" style={{ cursor: "default" }} onClick={(e) => (e.stopPropagation(), setShow({ help: false }))}>
            <div role="dialog" aria-label="Presenting shortcuts" className="w-[420px] rounded-xl bg-[#1E1E1E] p-5 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 text-[15px] font-semibold">Presenting shortcuts</div>
                <dl className="space-y-2 text-[13px]">
                    {SHOW_KEYS.map(([label, keys]) => (
                        <div key={label} className="flex justify-between gap-4">
                            <dt className="text-white/85">{label}</dt>
                            <dd className="text-right text-white/55">{keys}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}

function formatTime(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const pad = (n: number) => String(n).padStart(2, "0");
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// At the end of a rehearsal: how long each slide took.
export function RehearsalSummary() {
    const doc = useEditor((s) => s.doc);
    const state = useShow();
    const total = state.order.reduce((sum, id) => sum + (state.timings[id] ?? 0), 0);
    return (
        <div className="w-[360px] rounded-xl bg-[#1E1E1E] p-5 text-left text-white" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex justify-between text-[15px] font-semibold">
                <span>Rehearsal timings</span>
                <span className="font-mono tabular-nums">{formatTime(total)}</span>
            </div>
            <ol className="max-h-[50vh] space-y-1 overflow-y-auto text-[13px]">
                {state.order.map((id, i) => (
                    <li key={id} className="flex justify-between gap-3">
                        <span className="truncate text-white/80">{i + 1}. {doc.nodes[id]?.name ?? "Slide"}</span>
                        <span className="font-mono tabular-nums text-white/60">{formatTime(state.timings[id] ?? 0)}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

import { ArrowDown, ArrowUp, Circle, Download01, Eye, EyeOff, Plus, Square, Trash01 } from "@untitledui/icons";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { type EffectParamSpec, type EffectSpecInfo, effectCatalog } from "../../engines/motion-engine";
import { useCollab } from "../../engine/collab";
import { editor, useEditor } from "../../engine/store";
import { applyMotionPreset } from "../../engine/video/actions";
import { setSpeed } from "../../engine/video/edit";
import { animated, clipCss, clipJson, clipReact } from "../../engine/video/handoff";
import { type VBlend, type VClip, type VComp, type VEffect, type VTitle, BLENDS, ROOT, clipEnd, compById, compLength, mediaById, projectOf, replaceComp } from "../../engine/video/model";
import { FONTS, LOOKS, MOTION_PRESETS, SHAPES, TITLE_ANIMS, TRANSITIONS, LABEL_COLORS } from "../../engine/video/presets";
import { activeComp, commitComp, commitProject, currentProject, useVideoUi, vui } from "../../engine/video/state";
import { PresenceBar, ShareButton } from "../collab-ui";
import { NumberField } from "../number-field";
import { Select } from "../select";
import { VersionHistoryPanel } from "../version-history";
import { ColorField, PropRow, Section, SliderRow } from "./common";
import { FIELD, timecode } from "../../engine/video/format";

// The Inspector: what's picked on the timeline (a clip, a transition) or, with nothing picked,
// the sequence's own settings.

export function Inspector() {
    const history = useCollab((s) => s.historyOpen);
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const compId = useVideoUi((s) => s.compId);
    const selection = useVideoUi((s) => s.selection);
    const transition = useVideoUi((s) => s.transition);
    if (history) return <VersionHistoryPanel />;
    const project = projectOf(doc);
    const comp = compById(project, compId);
    const clips = comp.clips.filter((c) => selection.includes(c.id));
    const visual = clips.find((c) => c.kind !== "audio");
    const audio = clips.find((c) => c.kind === "audio");
    const transClip = transition ? comp.clips.find((c) => c.id === transition.clip) : undefined;

    return (
        <aside data-right-panel="" className="flex h-full w-72 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-panel-border px-3">
                <PresenceBar />
                <div className="flex-1" />
                <button type="button" onClick={() => vui.set({ exportOpen: true })} className="flex h-7 items-center gap-1.5 rounded-md bg-brand-500 px-2.5 font-semibold text-white hover:bg-brand-600">
                    <Download01 className="size-3.5" /> Export
                </button>
                <ShareButton />
            </header>
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border px-3">
                <span className="font-semibold">{transClip ? "Transition" : visual ? kindLabel(visual) : audio ? "Audio clip" : comp.id === ROOT ? "Sequence" : "Nested sequence"}</span>
                {clips.length > 1 && <span className="text-ink-muted">· {clips.length} clips</span>}
            </div>
            <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {transClip && transition ? (
                        <TransitionPanel comp={comp} clip={transClip} side={transition.side} />
                    ) : visual || audio ? (
                        <>
                            {(visual ?? audio) && <ClipSection comp={comp} clip={(visual ?? audio) as VClip} />}
                            {visual && <VisualSections comp={comp} clip={visual} />}
                            {visual && <HandoffSection comp={comp} clip={visual} />}
                            {audio && <AudioSection comp={comp} clip={audio} />}
                        </>
                    ) : (
                        <SequencePanel comp={comp} />
                    )}
                </div>
            </fieldset>
        </aside>
    );
}

// Code for the clip's motion, to hand to developers: CSS, React or JSON, ready to copy.
function HandoffSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    const [tab, setTab] = useState<"css" | "react" | "json">("css");
    const code = tab === "css" ? clipCss(comp, clip) : tab === "react" ? clipReact(clip) : clipJson(comp, clip);
    return (
        <Section title="Code" open={false} action={!animated(clip) ? <span className="text-ink-subtle">No keyframes</span> : undefined}>
            <div className="flex items-center gap-1">
                <div role="tablist" aria-label="Code format" className="flex flex-1 gap-0.5 rounded-md bg-field p-0.5">
                    {(["css", "react", "json"] as const).map((t) => (
                        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-6 flex-1 rounded text-[11px] font-medium uppercase ${tab === t ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                            {t}
                        </button>
                    ))}
                </div>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(code).then(() => editor.notify("Code copied."), () => editor.notify("Couldn't copy the code."))} className="h-7 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                    Copy
                </button>
            </div>
            <pre aria-label="Motion code" className="mt-2 max-h-60 overflow-auto rounded-md bg-field p-2 font-mono text-[10.5px] leading-4 whitespace-pre text-ink">{code}</pre>
        </Section>
    );
}

function kindLabel(clip: VClip): string {
    return { video: "Video clip", audio: "Audio clip", image: "Still image", title: "Title", shape: "Shape", solid: "Color matte", adjustment: "Adjustment layer", comp: "Nested sequence", frame: "Design frame" }[clip.kind];
}

function edit(id: string, fn: (c: VClip, comp: VComp) => VClip) {
    const comp = activeComp();
    commitComp({ ...comp, clips: comp.clips.map((c) => (c.id === id ? fn(c, comp) : c)) });
}

// ---- Sequence ----

const SIZES: [string, number, number][] = [
    ["4K UHD", 3840, 2160],
    ["1080p HD", 1920, 1080],
    ["720p HD", 1280, 720],
    ["Vertical 1080×1920", 1080, 1920],
    ["Square 1080", 1080, 1080],
    ["Portrait 4:5", 1080, 1350],
    ["Cinema 2.39:1", 1920, 804],
];

function SequencePanel({ comp }: { comp: VComp }) {
    const set = (patch: Partial<VComp>) => commitComp({ ...comp, ...patch });
    const preset = SIZES.find(([, w, h]) => w === comp.width && h === comp.height)?.[0] ?? "custom";
    const doc = useEditor((s) => s.doc);
    const project = projectOf(doc);
    return (
        <>
            <Section title="Format">
                {comp.id !== ROOT && (
                    <input aria-label="Sequence name" value={comp.name} onChange={(e) => commitProject(replaceComp(project, { ...comp, name: e.target.value }))} className={`${FIELD} w-full`} />
                )}
                <Select aria-label="Frame size" value={preset} onChange={(e) => {
                    const p = SIZES.find(([n]) => n === e.target.value);
                    if (p) set({ width: p[1], height: p[2] });
                }} className="h-7 w-full">
                    {SIZES.map(([n]) => <option key={n} value={n}>{n}</option>)}
                    <option value="custom">Custom</option>
                </Select>
                <div className="grid grid-cols-2 gap-1.5">
                    <NumberField label="W" min={16} max={8192} value={comp.width} onCommit={(v) => set({ width: Math.round(v / 2) * 2 })} />
                    <NumberField label="H" min={16} max={8192} value={comp.height} onCommit={(v) => set({ height: Math.round(v / 2) * 2 })} />
                </div>
                <label className="flex items-center gap-2">
                    <span className="w-16 text-ink-muted">Frame rate</span>
                    <Select aria-label="Frame rate" value={String(comp.fps)} onChange={(e) => set({ fps: Number(e.target.value) })} className="h-7 flex-1">
                        {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((v) => <option key={v} value={String(v)}>{v} fps</option>)}
                    </Select>
                </label>
                <ColorField label="Background" value={comp.background === "transparent" ? "#00000000" : comp.background} onChange={(v) => set({ background: v })} />
                <div className="text-ink-muted">Duration {timecode(compLength(comp), comp.fps)}</div>
            </Section>
            <Section title="In and out">
                <div className="grid grid-cols-2 gap-1.5">
                    <NumberField label="In" unit="s" step={1 / comp.fps} min={0} value={comp.inPoint != null ? Math.round(comp.inPoint * 100) / 100 : 0} onCommit={(v) => set({ inPoint: v })} />
                    <NumberField label="Out" unit="s" step={1 / comp.fps} min={0} value={Math.round((comp.outPoint ?? compLength(comp)) * 100) / 100} onCommit={(v) => set({ outPoint: v })} />
                </div>
                <button type="button" onClick={() => set({ inPoint: null, outPoint: null })} className="h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                    Clear in and out
                </button>
            </Section>
            <Section title="Markers" action={<span className="text-ink-subtle">M adds one</span>}>
                {comp.markers.length === 0 && <p className="text-ink-muted">No markers yet.</p>}
                {comp.markers.map((m) => (
                    <div key={m.id} className="flex items-center gap-1.5">
                        <input aria-label="Marker colour" type="color" value={m.color} onChange={(e) => set({ markers: comp.markers.map((x) => (x.id === m.id ? { ...x, color: e.target.value } : x)) })} className="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                        <input aria-label="Marker name" value={m.name} onChange={(e) => set({ markers: comp.markers.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} className={`${FIELD} flex-1`} />
                        <button type="button" onClick={() => vui.set({ time: m.t, playing: false })} className="w-16 shrink-0 text-right font-mono text-[10px] text-ink-muted hover:text-ink">
                            {timecode(m.t, comp.fps)}
                        </button>
                        <button type="button" aria-label="Delete marker" onClick={() => set({ markers: comp.markers.filter((x) => x.id !== m.id) })} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Trash01 className="size-3" />
                        </button>
                    </div>
                ))}
            </Section>
        </>
    );
}

// ---- Clip basics ----

function ClipSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    const project = currentProject();
    const media = mediaById(project, clip.media);
    return (
        <Section title="Clip">
            <input aria-label="Clip name" value={clip.name} onChange={(e) => edit(clip.id, (c) => ({ ...c, name: e.target.value }))} className={`${FIELD} w-full`} />
            <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="Start" unit="s" step={1 / comp.fps} min={0} value={Math.round(clip.start * 1000) / 1000} onCommit={(v) => edit(clip.id, (c) => ({ ...c, start: Math.max(0, v) }))} />
                <NumberField label="Length" unit="s" step={1 / comp.fps} min={1 / comp.fps} value={Math.round(clip.duration * 1000) / 1000} onCommit={(v) => edit(clip.id, (c) => ({ ...c, duration: Math.max(1 / comp.fps, (c.kind === "video" || c.kind === "audio") && media ? Math.min(v, (media.seconds - c.in) / c.speed) : v) }))} />
            </div>
            {(clip.kind === "video" || clip.kind === "audio" || clip.kind === "comp") && (
                <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                        <NumberField label="Speed" unit="%" step={5} min={5} max={2000} value={Math.round(clip.speed * 100)} onCommit={(v) => commitComp(setSpeed(comp, clip.id, v / 100))} />
                    </div>
                    <label className="flex items-center gap-1.5 text-ink-muted">
                        <input type="checkbox" checked={Boolean(clip.reverse)} onChange={(e) => edit(clip.id, (c) => ({ ...c, reverse: e.target.checked }))} className="accent-brand-500" />
                        Reverse
                    </label>
                </div>
            )}
            <div className="flex items-center justify-between text-ink-muted">
                <span>
                    {timecode(clip.start, comp.fps)} → {timecode(clipEnd(clip), comp.fps)}
                </span>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!clip.disabled} onChange={(e) => edit(clip.id, (c) => ({ ...c, disabled: !e.target.checked }))} className="accent-brand-500" />
                    Enabled
                </label>
            </div>
            {media && (
                <div className="truncate text-ink-subtle" title={media.name}>
                    {media.name} · {media.width ? `${media.width}×${media.height} · ` : ""}
                    {media.seconds ? `${Math.round(media.seconds * 10) / 10}s` : "still"}
                </div>
            )}
            <div className="flex items-center gap-1">
                <span className="w-12 text-ink-muted">Label</span>
                {LABEL_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Label ${c}`} onClick={() => edit(clip.id, (cl) => ({ ...cl, label: c }))} className={`size-4 rounded-full ${clip.label === c ? "ring-2 ring-white" : ""}`} style={{ background: c }} />
                ))}
            </div>
        </Section>
    );
}

// ---- Everything a picture clip has ----

function VisualSections({ comp, clip }: { comp: VComp; clip: VClip }) {
    return (
        <>
            {clip.kind === "title" && clip.title && <TitleSection comp={comp} clip={clip} title={clip.title} />}
            {clip.kind === "shape" && clip.shape && <ShapeSection clip={clip} />}
            {clip.kind === "frame" && clip.frame && (
                <Section title="Design frame">
                    <button type="button" onClick={() => editor.set({ sequenceView: false, selection: [clip.frame as string], mode: "design" })} className="h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                        Edit on the canvas
                    </button>
                </Section>
            )}
            {clip.kind === "solid" && (
                <Section title="Color matte">
                    <ColorField label="Color" value={clip.color ?? "#3355FF"} onChange={(v) => edit(clip.id, (c) => ({ ...c, color: v }))} />
                </Section>
            )}
            {clip.kind !== "adjustment" && <TransformSection comp={comp} clip={clip} />}
            {clip.kind === "adjustment" && (
                <Section title="Opacity">
                    <PropRow clip={clip} comp={comp} path="opacity" />
                </Section>
            )}
            <Section title="Blend mode">
                <Select aria-label="Blend mode" value={clip.blend} onChange={(e) => edit(clip.id, (c) => ({ ...c, blend: e.target.value as VBlend }))} className="h-7 w-full">
                    {BLENDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
            </Section>
            {clip.kind !== "adjustment" && (
                <Section title="Crop" open={false}>
                    <PropRow clip={clip} comp={comp} path="crop.l" label="Left" />
                    <PropRow clip={clip} comp={comp} path="crop.t" label="Top" />
                    <PropRow clip={clip} comp={comp} path="crop.r" label="Right" />
                    <PropRow clip={clip} comp={comp} path="crop.b" label="Bottom" />
                </Section>
            )}
            <MaskSection comp={comp} clip={clip} />
            <ColorSection comp={comp} clip={clip} />
            <EffectsSection comp={comp} clip={clip} />
            <Section title="Motion presets" open={false}>
                <Select aria-label="Apply a motion preset" value="" onChange={(e) => e.target.value && applyMotionPreset(e.target.value)} className="h-7 w-full">
                    <option value="">Apply a preset…</option>
                    {(["In", "Out", "Loop", "Camera"] as const).map((g) => (
                        <optgroup key={g} label={g}>
                            {MOTION_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </optgroup>
                    ))}
                </Select>
                <TransitionShortcut comp={comp} clip={clip} />
            </Section>
        </>
    );
}

function TransformSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    const [linked, setLinked] = useState(() => (clip.props.scaleX ?? 100) === (clip.props.scaleY ?? 100) && JSON.stringify(clip.anim.scaleX ?? []) === JSON.stringify(clip.anim.scaleY ?? []));
    return (
        <Section
            title="Transform"
            action={
                <button type="button" title="Reset transform" onClick={() => edit(clip.id, (c) => {
                    const props = { ...c.props };
                    const anim = { ...c.anim };
                    for (const k of ["x", "y", "scaleX", "scaleY", "rotation", "anchorX", "anchorY", "opacity"]) {
                        delete props[k];
                        delete anim[k];
                    }
                    return { ...c, props, anim };
                })} className="h-6 rounded-md px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Reset
                </button>
            }
        >
            <PropRow clip={clip} comp={comp} path="x" label="Position X" decimals={1} />
            <PropRow clip={clip} comp={comp} path="y" label="Position Y" decimals={1} />
            {linked ? <ScaleRow clip={clip} comp={comp} onUnlink={() => setLinked(false)} /> : (
                <>
                    <PropRow clip={clip} comp={comp} path="scaleX" label="Scale W" decimals={1} />
                    <PropRow clip={clip} comp={comp} path="scaleY" label="Scale H" decimals={1} />
                    <button type="button" onClick={() => setLinked(true)} className="ml-6 text-brand-500 hover:underline">Uniform scale</button>
                </>
            )}
            <PropRow clip={clip} comp={comp} path="rotation" decimals={1} />
            <PropRow clip={clip} comp={comp} path="anchorX" decimals={1} />
            <PropRow clip={clip} comp={comp} path="anchorY" decimals={1} />
            <PropRow clip={clip} comp={comp} path="opacity" decimals={0} />
        </Section>
    );
}

// Uniform scale drives both axes, keyframes included.
function ScaleRow({ clip, comp, onUnlink }: { clip: VClip; comp: VComp; onUnlink: () => void }) {
    return (
        <div className="space-y-1.5">
            <PropRow clip={clip} comp={comp} path="scaleX" link="scaleY" label="Scale" decimals={1} />
            <button type="button" onClick={onUnlink} className="ml-6 text-brand-500 hover:underline">Scale width and height separately</button>
        </div>
    );
}

// ---- Titles ----

function TitleSection({ comp, clip, title }: { comp: VComp; clip: VClip; title: VTitle }) {
    const set = (patch: Partial<VTitle>) => edit(clip.id, (c) => ({ ...c, title: { ...(c.title as VTitle), ...patch }, ...(patch.text !== undefined ? { name: patch.text.split("\n")[0] || "Title" } : {}) }));
    return (
        <Section title="Text">
            <textarea
                key={`${clip.id}:${title.text}`}
                aria-label="Title text"
                defaultValue={title.text}
                rows={Math.min(5, title.text.split("\n").length + 1)}
                onBlur={(e) => e.target.value !== title.text && set({ text: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full resize-none rounded-md border border-transparent bg-field px-1.5 py-1 text-ink outline-none hover:border-panel-border focus:border-brand-500"
            />
            <div className="grid grid-cols-[1fr_76px] gap-1.5">
                <Select aria-label="Font" value={title.font} onChange={(e) => set({ font: e.target.value })} className="h-7">
                    {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
                <Select aria-label="Weight" value={String(title.weight)} onChange={(e) => set({ weight: Number(e.target.value) })} className="h-7">
                    {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={String(w)}>{w}</option>)}
                </Select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="Size" min={4} max={2000} value={title.size} onCommit={(v) => set({ size: v })} />
                <NumberField label="Track" title="Letter spacing" min={-50} max={400} value={title.tracking} onCommit={(v) => set({ tracking: v })} />
                <NumberField label="Line" title="Line height" step={0.05} min={0.5} max={4} value={title.lineHeight} onCommit={(v) => set({ lineHeight: v })} />
                <Select aria-label="Alignment" value={title.align} onChange={(e) => set({ align: e.target.value as VTitle["align"] })} className="h-7">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </Select>
            </div>
            <div className="flex items-center gap-3 text-ink-muted">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(title.italic)} onChange={(e) => set({ italic: e.target.checked })} className="accent-brand-500" />Italic</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(title.uppercase)} onChange={(e) => set({ uppercase: e.target.checked })} className="accent-brand-500" />All caps</label>
            </div>
            <ColorField label="Fill" value={title.color} onChange={(v) => set({ color: v })} />
            <div className="flex items-center gap-2">
                <label className="flex w-[78px] shrink-0 items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={Boolean(title.stroke)} onChange={(e) => set({ stroke: e.target.checked ? { color: "#000000", width: Math.max(2, Math.round(title.size / 30)) } : null })} className="accent-brand-500" />Stroke</label>
                {title.stroke && (
                    <>
                        <ColorSwatchInline value={title.stroke.color} onChange={(v) => set({ stroke: { ...(title.stroke as { color: string; width: number }), color: v } })} />
                        <div className="flex-1"><NumberField label="W" min={0} max={200} value={title.stroke.width} onCommit={(v) => set({ stroke: { ...(title.stroke as { color: string; width: number }), width: v } })} /></div>
                    </>
                )}
            </div>
            <div className="flex items-center gap-2">
                <label className="flex w-[78px] shrink-0 items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={Boolean(title.shadow)} onChange={(e) => set({ shadow: e.target.checked ? { color: "#000000AA", blur: 12, x: 0, y: 4 } : null })} className="accent-brand-500" />Shadow</label>
                {title.shadow && (
                    <>
                        <ColorSwatchInline value={title.shadow.color} onChange={(v) => set({ shadow: { ...(title.shadow as NonNullable<VTitle["shadow"]>), color: v } })} />
                        <div className="flex-1"><NumberField label="Blur" min={0} max={300} value={title.shadow.blur} onCommit={(v) => set({ shadow: { ...(title.shadow as NonNullable<VTitle["shadow"]>), blur: v } })} /></div>
                    </>
                )}
            </div>
            <div className="flex items-center gap-2">
                <label className="flex w-[78px] shrink-0 items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={Boolean(title.box)} onChange={(e) => set({ box: e.target.checked ? { color: "#000000AA", padding: Math.round(title.size * 0.3), radius: 8 } : null })} className="accent-brand-500" />Box</label>
                {title.box && (
                    <>
                        <ColorSwatchInline value={title.box.color} onChange={(v) => set({ box: { ...(title.box as NonNullable<VTitle["box"]>), color: v } })} />
                        <div className="flex-1"><NumberField label="Pad" min={0} max={400} value={title.box.padding} onCommit={(v) => set({ box: { ...(title.box as NonNullable<VTitle["box"]>), padding: v } })} /></div>
                    </>
                )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
                <label className="space-y-0.5">
                    <span className="text-[10px] text-ink-subtle">Animate in</span>
                    <Select aria-label="Animate in" value={title.animIn} onChange={(e) => set({ animIn: e.target.value as VTitle["animIn"] })} className="h-7 w-full">
                        {TITLE_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </Select>
                </label>
                <label className="space-y-0.5">
                    <span className="text-[10px] text-ink-subtle">Animate out</span>
                    <Select aria-label="Animate out" value={title.animOut} onChange={(e) => set({ animOut: e.target.value as VTitle["animOut"] })} className="h-7 w-full">
                        {TITLE_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </Select>
                </label>
            </div>
            <NumberField label="Speed" title="How long the in and out animations take" unit="s" step={0.1} min={0.05} max={10} value={title.animDur} onCommit={(v) => set({ animDur: v })} />
            <div className="text-[10px] text-ink-subtle">{comp.width}×{comp.height} frame</div>
        </Section>
    );
}

function ColorSwatchInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <span className="shrink-0">
            <ColorFieldBare value={value} onChange={onChange} />
        </span>
    );
}

function ColorFieldBare({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    // The labelled field without its label.
    return (
        <span className="[&>div>span:first-child]:hidden [&>div>span:last-child]:hidden">
            <ColorField label="" value={value} onChange={onChange} />
        </span>
    );
}

// ---- Shapes ----

function ShapeSection({ clip }: { clip: VClip }) {
    const shape = clip.shape;
    if (!shape) return null;
    const set = (patch: Partial<typeof shape>) => edit(clip.id, (c) => ({ ...c, shape: { ...shape, ...patch } }));
    return (
        <Section title="Shape">
            <Select aria-label="Shape" value={shape.kind} onChange={(e) => set({ kind: e.target.value as typeof shape.kind })} className="h-7 w-full">
                {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="W" min={0} value={shape.w} onCommit={(v) => set({ w: v })} />
                <NumberField label="H" min={0} value={shape.h} onCommit={(v) => set({ h: v })} />
                {shape.kind === "rect" && <NumberField label="Radius" min={0} value={shape.radius} onCommit={(v) => set({ radius: v })} />}
                {(shape.kind === "polygon" || shape.kind === "star") && <NumberField label="Points" min={3} max={64} value={shape.sides} onCommit={(v) => set({ sides: Math.round(v) })} />}
            </div>
            <div className="flex items-center gap-2">
                <label className="flex w-[78px] shrink-0 items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={shape.fill !== null} onChange={(e) => set({ fill: e.target.checked ? "#4F7BFF" : null })} className="accent-brand-500" />Fill</label>
                {shape.fill !== null && <ColorSwatchInline value={shape.fill} onChange={(v) => set({ fill: v })} />}
            </div>
            <div className="flex items-center gap-2">
                <label className="flex w-[78px] shrink-0 items-center gap-1.5 text-ink-muted"><input type="checkbox" checked={shape.stroke !== null} onChange={(e) => set({ stroke: e.target.checked ? "#FFFFFF" : null, strokeWidth: shape.strokeWidth || 6 })} className="accent-brand-500" />Stroke</label>
                {shape.stroke !== null && (
                    <>
                        <ColorSwatchInline value={shape.stroke} onChange={(v) => set({ stroke: v })} />
                        <div className="flex-1"><NumberField label="W" min={0} max={400} value={shape.strokeWidth} onCommit={(v) => set({ strokeWidth: v })} /></div>
                    </>
                )}
            </div>
        </Section>
    );
}

// ---- Masks ----

function MaskSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    const add = (shape: "rect" | "ellipse") => edit(clip.id, (c) => ({ ...c, masks: [...c.masks, { id: nanoid(6), shape, mode: "add" }] }));
    return (
        <Section
            title="Masks"
            open={clip.masks.length > 0}
            action={
                <>
                    <button type="button" aria-label="Add rectangle mask" title="Add rectangle mask" onClick={() => add("rect")} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink"><Square className="size-3.5" /></button>
                    <button type="button" aria-label="Add ellipse mask" title="Add ellipse mask" onClick={() => add("ellipse")} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink"><Circle className="size-3.5" /></button>
                </>
            }
        >
            {clip.masks.length === 0 && <p className="text-ink-muted">Masks show part of the clip. Add a rectangle or an ellipse.</p>}
            {clip.masks.map((m, i) => (
                <div key={m.id} className="space-y-1 rounded-md border border-panel-border p-1.5">
                    <div className="flex items-center gap-1.5">
                        <span className="flex-1 font-medium">Mask {i + 1} · {m.shape === "rect" ? "Rectangle" : "Ellipse"}</span>
                        <Select aria-label="Mask mode" value={m.mode} onChange={(e) => edit(clip.id, (c) => ({ ...c, masks: c.masks.map((x) => (x.id === m.id ? { ...x, mode: e.target.value as "add" } : x)) }))} className="h-6 w-24">
                            <option value="add">Add</option>
                            <option value="subtract">Subtract</option>
                        </Select>
                        <button type="button" aria-label="Delete mask" onClick={() => edit(clip.id, (c) => ({ ...c, masks: c.masks.filter((x) => x.id !== m.id) }))} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink"><Trash01 className="size-3" /></button>
                    </div>
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.x`} label="Left" scale={100} unit="%" decimals={1} />
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.y`} label="Top" scale={100} unit="%" decimals={1} />
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.w`} label="Width" scale={100} unit="%" decimals={1} />
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.h`} label="Height" scale={100} unit="%" decimals={1} />
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.feather`} label="Feather" min={0} decimals={0} />
                    <PropRow clip={clip} comp={comp} path={`mask.${m.id}.opacity`} label="Opacity" min={0} max={100} unit="%" decimals={0} />
                </div>
            ))}
        </Section>
    );
}

// ---- Colour ----

function ColorSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    return (
        <Section title="Color" open={false}>
            <div className="flex items-center gap-1.5">
                <span className="w-[78px] shrink-0 pl-6 text-ink-muted">Look</span>
                <Select aria-label="Look" value={clip.look ?? ""} onChange={(e) => edit(clip.id, (c) => ({ ...c, look: e.target.value || undefined }))} className="h-7 flex-1">
                    <option value="">None</option>
                    {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </Select>
            </div>
            {clip.look && <SliderRow clip={clip} comp={comp} path="color.look" label="Look amount" min={0} max={100} />}
            <SliderRow clip={clip} comp={comp} path="color.exposure" label="Exposure" min={-4} max={4} step={0.05} />
            <SliderRow clip={clip} comp={comp} path="color.contrast" label="Contrast" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.highlights" label="Highlights" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.shadows" label="Shadows" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.saturation" label="Saturation" min={0} max={200} />
            <SliderRow clip={clip} comp={comp} path="color.vibrance" label="Vibrance" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.temperature" label="Temperature" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.tint" label="Tint" min={-100} max={100} />
            <SliderRow clip={clip} comp={comp} path="color.vignette" label="Vignette" min={0} max={100} />
        </Section>
    );
}

// ---- Effects ----

function useCatalog(): EffectSpecInfo[] {
    const [list, setList] = useState<EffectSpecInfo[]>([]);
    useEffect(() => {
        let live = true;
        void effectCatalog().then((l) => live && setList(l));
        return () => {
            live = false;
        };
    }, []);
    return list;
}

function EffectsSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    const catalog = useCatalog();
    const move = (id: string, dir: -1 | 1) =>
        edit(clip.id, (c) => {
            const list = [...c.effects];
            const i = list.findIndex((e) => e.id === id);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= list.length) return c;
            [list[i], list[j]] = [list[j] as VEffect, list[i] as VEffect];
            return { ...c, effects: list };
        });
    return (
        <Section title={`Effects${clip.effects.length ? ` (${clip.effects.length})` : ""}`} action={<span className="text-ink-subtle">Library › Effects</span>}>
            {clip.effects.length === 0 && <p className="text-ink-muted">Drag an effect from the Library onto the clip, or double-click one there.</p>}
            {clip.effects.map((effect, i) => {
                const spec = catalog.find((s) => s.id === effect.fx);
                return (
                    <div key={effect.id} className="rounded-md border border-panel-border">
                        <div className="flex items-center gap-1 px-1.5 py-1">
                            <button type="button" aria-label={effect.enabled ? "Turn effect off" : "Turn effect on"} onClick={() => edit(clip.id, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effect.id ? { ...e, enabled: !e.enabled } : e)) }))} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                                {effect.enabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                            </button>
                            <span className={`min-w-0 flex-1 truncate font-medium ${effect.enabled ? "" : "text-ink-muted line-through"}`}>{effect.name}</span>
                            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(effect.id, -1)} className="flex size-5 items-center justify-center rounded text-ink-muted hover:text-ink disabled:opacity-30"><ArrowUp className="size-3" /></button>
                            <button type="button" aria-label="Move down" disabled={i === clip.effects.length - 1} onClick={() => move(effect.id, 1)} className="flex size-5 items-center justify-center rounded text-ink-muted hover:text-ink disabled:opacity-30"><ArrowDown className="size-3" /></button>
                            <button type="button" aria-label="Remove effect" onClick={() => edit(clip.id, (c) => {
                                const anim = Object.fromEntries(Object.entries(c.anim).filter(([k]) => !k.startsWith(`fx.${effect.id}.`)));
                                const props = Object.fromEntries(Object.entries(c.props).filter(([k]) => !k.startsWith(`fx.${effect.id}.`)));
                                return { ...c, effects: c.effects.filter((e) => e.id !== effect.id), anim, props };
                            })} className="flex size-5 items-center justify-center rounded text-ink-muted hover:text-ink"><Trash01 className="size-3" /></button>
                        </div>
                        {effect.enabled && spec && (
                            <div className="space-y-1 border-t border-panel-border px-1.5 py-1.5">
                                {spec.params.filter((p) => p.kind !== "hidden").map((p) => <EffectParam key={p.id} comp={comp} clip={clip} effect={effect} spec={p} />)}
                            </div>
                        )}
                    </div>
                );
            })}
        </Section>
    );
}

function EffectParam({ comp, clip, effect, spec }: { comp: VComp; clip: VClip; effect: VEffect; spec: EffectParamSpec }) {
    const value = effect.params[spec.id] ?? spec.default;
    const setParam = (v: number | boolean | number[]) => edit(clip.id, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effect.id ? { ...e, params: { ...e.params, [spec.id]: v } } : e)) }));
    const label = spec.name;
    if (spec.kind === "bool")
        return (
            <label className="flex items-center gap-1.5 pl-6 text-ink-muted">
                <input type="checkbox" checked={Boolean(value)} onChange={(e) => setParam(e.target.checked)} className="accent-brand-500" /> {label}
            </label>
        );
    if (spec.kind === "enum")
        return (
            <div className="flex items-center gap-1.5">
                <span className="w-[78px] shrink-0 truncate pl-6 text-ink-muted" title={label}>{label}</span>
                <Select aria-label={label} value={String(value)} onChange={(e) => setParam(Number(e.target.value))} className="h-7 min-w-0 flex-1">
                    {(spec.options ?? []).map((o, i) => <option key={i} value={String(i)}>{o}</option>)}
                </Select>
            </div>
        );
    if (spec.kind === "color") {
        const c = Array.isArray(value) ? value : [1, 1, 1, 1];
        const hex = `#${[c[0], c[1], c[2]].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        return (
            <ColorField label={label} value={hex} alpha={false} onChange={(v) => setParam([parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1])} />
        );
    }
    if (spec.kind === "point") {
        const p = Array.isArray(value) ? value : [0.5, 0.5];
        return (
            <div className="flex items-center gap-1.5">
                <span className="w-[78px] shrink-0 truncate pl-6 text-ink-muted" title={label}>{label}</span>
                <NumberField label="X" unit="%" value={Math.round((p[0] ?? 0.5) * 1000) / 10} onCommit={(v) => setParam([v / 100, p[1] ?? 0.5])} />
                <NumberField label="Y" unit="%" value={Math.round((p[1] ?? 0.5) * 1000) / 10} onCommit={(v) => setParam([p[0] ?? 0.5, v / 100])} />
            </div>
        );
    }
    const min = spec.sliderMin ?? spec.min;
    const max = spec.sliderMax ?? spec.max;
    const range = max !== undefined && min !== undefined ? max - min : 0;
    const step = spec.kind === "angle" ? 1 : range > 0 ? (range <= 2 ? 0.01 : range <= 20 ? 0.1 : 1) : 0.1;
    return <PropRow clip={clip} comp={comp} path={`fx.${effect.id}.${spec.id}`} label={label} min={spec.min} max={spec.max} step={step} unit={spec.kind === "angle" ? "°" : spec.kind === "percent" ? "%" : ""} decimals={spec.decimals ?? 2} />;
}

// ---- Audio ----

function AudioSection({ comp, clip }: { comp: VComp; clip: VClip }) {
    return (
        <Section title="Audio">
            <PropRow clip={clip} comp={comp} path="volume" decimals={1} />
            <PropRow clip={clip} comp={comp} path="pan" decimals={0} />
            <PropRow clip={clip} comp={comp} path="fadeIn" decimals={2} />
            <PropRow clip={clip} comp={comp} path="fadeOut" decimals={2} />
        </Section>
    );
}

// ---- Transitions ----

function TransitionPanel({ comp, clip, side }: { comp: VComp; clip: VClip; side: "in" | "out" }) {
    const tr = side === "in" ? clip.tin : clip.tout;
    if (!tr) return <p className="p-3 text-ink-muted">This transition was removed.</p>;
    const set = (patch: Partial<typeof tr> | null) => edit(clip.id, (c) => (side === "in" ? { ...c, tin: patch === null ? null : { ...tr, ...patch } } : { ...c, tout: patch === null ? null : { ...tr, ...patch } }));
    return (
        <Section title={side === "in" ? `Into ${clip.name}` : `Out of ${clip.name}`}>
            <Select aria-label="Transition" value={tr.kind} onChange={(e) => set({ kind: e.target.value as typeof tr.kind })} className="h-7 w-full">
                {["Dissolve", "Slide", "Push", "Wipe", "Zoom"].map((g) => (
                    <optgroup key={g} label={g}>
                        {TRANSITIONS.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </optgroup>
                ))}
            </Select>
            <NumberField label="Length" unit="s" step={1 / comp.fps} min={1 / comp.fps} max={Math.max(1 / comp.fps, clip.duration)} value={Math.round(tr.duration * 100) / 100} onCommit={(v) => set({ duration: v })} />
            <button type="button" onClick={() => {
                set(null);
                vui.set({ transition: null });
            }} className="h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                Remove transition
            </button>
        </Section>
    );
}

function TransitionShortcut({ comp, clip }: { comp: VComp; clip: VClip }) {
    void comp;
    return (
        <button type="button" onClick={() => edit(clip.id, (c) => ({ ...c, tin: c.tin ?? { kind: "dissolve", duration: 0.5 }, tout: c.tout ?? { kind: "dissolve", duration: 0.5 } }))} className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-panel-border hover:bg-panel-hover">
            <Plus className="size-3" /> Fade in and out
        </button>
    );
}

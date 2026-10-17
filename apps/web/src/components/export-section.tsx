import { ChevronDown, DotsHorizontal, Minus, Plus } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { DEFAULT_SETTING, exportWithSettings, parseSize, renderExport, settingLabel } from "../engine/export";
import { type AnimatedExport, exportAnimated, isAnimatedFrame } from "../engine/motion";
import { startScreen } from "../engine/prototype";
import { editor, useEditor } from "../engine/store";
import type { ExportSetting, SceneNode } from "../engine/types";
import { IconButton } from "./icon-button";
import { Section } from "./panel-section";
import { MenuRow } from "./left-sidebar";
import { Select } from "./select";

// The Export section, like the reference's: any number of export rows (size, format, and an options popover
// with the suffix and per-format settings), a preview, and one button that exports every row of
// every selected layer (several files come as a zip). Frames with Motion get Static and Animated tabs.

const SIZES = ["0.5x", "0.75x", "1x", "1.5x", "2x", "3x", "4x", "512w", "512h"];
const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

function SizeField({ setting, onChange }: { setting: ExportSetting; onChange: (s: ExportSetting) => void }) {
    const label = settingLabel(setting);
    // Keyed by the label outside, so a new value starts a fresh draft.
    const [draft, setDraft] = useState(label);
    const commit = (text: string) => {
        const size = parseSize(text);
        if (size) onChange({ ...setting, ...size });
        else setDraft(label);
    };
    const vector = setting.format === "svg" || setting.format === "pdf";
    return (
        <div className={`flex items-center rounded-md bg-field ${vector ? "opacity-40" : ""}`}>
            <input
                aria-label="Export size"
                value={draft}
                disabled={vector}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(draft)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") commit(draft);
                    e.stopPropagation();
                }}
                className="h-6 w-full min-w-0 bg-transparent px-1.5 text-ink outline-none"
            />
            <AriaMenuTrigger>
                <AriaButton aria-label="Size presets" isDisabled={vector} className="flex h-6 w-5 shrink-0 items-center justify-center text-ink-subtle outline-none hover:text-ink">
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom start" className="w-28 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu className="outline-none" aria-label="Size presets" onAction={(k) => commit(String(k))}>
                        {SIZES.map((s) => (
                            <MenuRow key={s} id={s} label={s} checked={s === label} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
    return (
        <label className="flex h-6 items-center gap-2" title={title}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500" />
            <span>{label}</span>
        </label>
    );
}

function Advanced({ setting, onChange }: { setting: ExportSetting; onChange: (s: ExportSetting) => void }) {
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Export settings" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <DotsHorizontal className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="w-60 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Export settings">
                    <div className="text-[12px] font-semibold">Export settings</div>
                    <label className="grid grid-cols-[56px_1fr] items-center gap-2">
                        <span className="text-ink-muted">Suffix</span>
                        <input value={setting.suffix} placeholder="None" onChange={(e) => onChange({ ...setting, suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} className={field} />
                    </label>
                    {setting.format === "svg" ? (
                        <div>
                            <Check label="Outline text" checked={Boolean(setting.svgOutlineText)} onChange={(v) => onChange({ ...setting, svgOutlineText: v })} title="Text as vector shapes, so it looks the same without the font" />
                            <Check label='Include "id" attribute' checked={Boolean(setting.svgIncludeId)} onChange={(v) => onChange({ ...setting, svgIncludeId: v })} title="Layer names become element ids" />
                            <Check label="Simplify stroke" checked={setting.svgSimplifyStroke ?? true} onChange={(v) => onChange({ ...setting, svgSimplifyStroke: v })} title="Inside and outside strokes as centre strokes where possible" />
                        </div>
                    ) : (
                        <>
                            {setting.format === "jpg" && (
                                <label className="grid grid-cols-[56px_1fr_36px] items-center gap-2">
                                    <span className="text-ink-muted">Quality</span>
                                    <input type="range" min={10} max={100} value={Math.round((setting.jpgQuality ?? 0.9) * 100)} aria-label="JPG quality" onChange={(e) => onChange({ ...setting, jpgQuality: Number(e.target.value) / 100 })} className="h-1 w-full accent-brand-500" />
                                    <span className="text-right text-ink-subtle">{Math.round((setting.jpgQuality ?? 0.9) * 100)}%</span>
                                </label>
                            )}
                            {setting.format === "pdf" && (
                                <label className="grid grid-cols-[56px_1fr] items-center gap-2">
                                    <span className="text-ink-muted">Quality</span>
                                    <Select aria-label="PDF quality" value={setting.pdfQuality ?? "medium"} onChange={(e) => onChange({ ...setting, pdfQuality: e.target.value as ExportSetting["pdfQuality"] })} className={field}>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </Select>
                                </label>
                            )}
                            {setting.format !== "pdf" && (
                                <>
                                    <label className="grid grid-cols-[56px_1fr] items-center gap-2">
                                        <span className="text-ink-muted">Resampling</span>
                                        <Select aria-label="Image resampling" value={setting.resampling ?? "smooth"} onChange={(e) => onChange({ ...setting, resampling: e.target.value as ExportSetting["resampling"] })} className={field} title="Smooth blends scaled images; Detailed keeps their pixels sharp">
                                            <option value="smooth">Smooth</option>
                                            <option value="detailed">Detailed</option>
                                        </Select>
                                    </label>
                                    <label className="grid grid-cols-[56px_1fr] items-center gap-2">
                                        <span className="text-ink-muted">Profile</span>
                                        <Select aria-label="Colour profile" value={setting.colorProfile ?? "document"} onChange={(e) => onChange({ ...setting, colorProfile: e.target.value as ExportSetting["colorProfile"] })} className={field}>
                                            <option value="document">Same as document</option>
                                            <option value="srgb">sRGB</option>
                                            <option value="p3">Display P3</option>
                                        </Select>
                                    </label>
                                </>
                            )}
                            <Check label="Contents only" checked={setting.contentsOnly ?? true} onChange={(v) => onChange({ ...setting, contentsOnly: v })} title="Off: everything showing within the layer's bounds is exported too" />
                            {setting.format !== "pdf" && <Check label="Use absolute bounds" checked={Boolean(setting.absoluteBounds)} onChange={(v) => onChange({ ...setting, absoluteBounds: v })} title="Export the layer's full extent, including what its clipping hides (text overflow, for one)" />}
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// `label`: what the export button calls the layer, when not its name (Slides: the deck's name).
export function ExportSection({ nodes, label: named }: { nodes: SceneNode[]; label?: string }) {
    const settings = nodes[0]?.exportSettings ?? [];
    const write = (next: ExportSetting[]) => {
        editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: { exportSettings: next } })) });
    };
    const add = () => {
        const last = settings[settings.length - 1];
        if (!last) return write([{ ...DEFAULT_SETTING }]);
        const scale = Math.min(4, Math.floor((last.constraint && last.constraint !== "scale" ? 1 : last.scale) + 1));
        write([...settings, { ...DEFAULT_SETTING, format: last.format, scale, suffix: `@${scale}x` }]);
    };
    const [tab, setTab] = useState<"static" | "animated">("static");
    const [anim, setAnim] = useState<AnimatedExport>({ format: "mp4", scale: 1, fps: 30, quality: 1 });
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const doc = useEditor((s) => s.doc);
    const screen = useEditor((s) => startScreen(s.doc, nodes.map((n) => n.id)));
    const animated = isAnimatedFrame(doc, screen ? doc.nodes[screen] : undefined);
    const ids = nodes.map((n) => n.id).join(",");
    const first = settings[0];

    // The preview: the first row's export of the first layer, as an image.
    useEffect(() => {
        if (!showPreview || !first || !nodes[0]) {
            setPreview(null);
            return;
        }
        let url: string | null = null;
        let live = true;
        const timer = window.setTimeout(async () => {
            const file = await renderExport(editor.get().doc, nodes[0]!.id, first.format === "pdf" ? { ...first, format: "png" } : first);
            if (!file || !live) return;
            url = URL.createObjectURL(file.blob);
            setPreview(url);
        }, 200);
        return () => {
            live = false;
            window.clearTimeout(timer);
            if (url) URL.revokeObjectURL(url);
        };
        // Re-render when the layers or the first row change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showPreview, ids, JSON.stringify(first), doc]);

    const run = async () => {
        setBusy(true);
        try {
            if (tab === "animated" && screen) await exportAnimated(doc, screen, anim);
            else {
                const count = await exportWithSettings(
                    doc,
                    nodes.map((n) => n.id),
                    (id) => doc.nodes[id]?.exportSettings ?? settings,
                    nodes.length === 1 ? nodes[0]?.name : doc.name,
                );
                if (!count) editor.notify("Nothing to export.");
            }
        } catch (error) {
            console.error(error);
            editor.notify("Export failed. Try another format, or fewer layers.");
        } finally {
            setBusy(false);
        }
    };

    const label = `Export ${named ?? (nodes.length === 1 ? nodes[0]?.name : `${nodes.length} layers`)}`;
    const row = (text: string, control: React.ReactNode) => (
        <label className="grid grid-cols-[72px_1fr] items-center gap-1.5">
            <span className="text-ink-muted">{text}</span>
            {control}
        </label>
    );
    const button = "h-6 w-full truncate rounded-md border border-panel-border px-2 font-medium outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";

    return (
        <Section title="Export" action={<IconButton size="sm" icon={Plus} label="Add export setting" onPress={add} />}>
            {settings.length > 0 && (
                <>
                    {animated && (
                        <div className="grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5">
                            {(["static", "animated"] as const).map((t) => (
                                <button key={t} type="button" onClick={() => setTab(t)} className={`h-6 rounded text-[11px] font-medium ${tab === t ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                    {t === "static" ? "Static" : "Animated"}
                                </button>
                            ))}
                        </div>
                    )}
                    {(tab === "static" || !animated) && (
                        <>
                            {settings.map((setting, i) => {
                                const change = (next: ExportSetting) => write(settings.map((s, k) => (k === i ? next : s)));
                                return (
                                    <div key={i} className="grid grid-cols-[88px_1fr_24px_24px] items-center gap-1">
                                        <SizeField key={settingLabel(setting)} setting={setting} onChange={change} />
                                        <Select aria-label="Export format" value={setting.format} onChange={(e) => change({ ...setting, format: e.target.value as ExportSetting["format"] })} className={field}>
                                            <option value="png">PNG</option>
                                            <option value="jpg">JPG</option>
                                            <option value="svg">SVG</option>
                                            <option value="pdf">PDF</option>
                                        </Select>
                                        <Advanced setting={setting} onChange={change} />
                                        <IconButton size="sm" icon={Minus} label="Remove export setting" onPress={() => write(settings.filter((_, k) => k !== i))} />
                                    </div>
                                );
                            })}
                            <AriaButton isDisabled={busy} onPress={() => void run()} className={button}>
                                {busy ? "Exporting…" : label}
                            </AriaButton>
                            <button type="button" onClick={() => setShowPreview(!showPreview)} className="flex h-6 items-center gap-1 text-ink-muted hover:text-ink">
                                <ChevronDown className={`size-3 transition-transform ${showPreview ? "" : "-rotate-90"}`} /> Preview
                            </button>
                            {showPreview && (
                                <div className="flex max-h-48 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:12px_12px] p-2">
                                    {preview ? <img src={preview} alt="Export preview" className="max-h-44 max-w-full object-contain" /> : <span className="text-ink-subtle">Rendering…</span>}
                                </div>
                            )}
                        </>
                    )}
                    {animated && tab === "animated" && (
                        <>
                            {row(
                                "Format",
                                <Select aria-label="Animated format" value={anim.format} onChange={(e) => setAnim({ ...anim, format: e.target.value as AnimatedExport["format"] })} className={field}>
                                    <option value="mp4">MP4</option>
                                    <option value="webm">WebM</option>
                                    <option value="gif">GIF</option>
                                    <option value="lottie">Lottie</option>
                                    <option value="dotlottie">dotLottie</option>
                                    <option value="svganim">Animated SVG</option>
                                </Select>,
                            )}
                            {row(
                                "Size",
                                <Select aria-label="Animated size" value={anim.scale} disabled={["lottie", "dotlottie", "svganim"].includes(anim.format)} onChange={(e) => setAnim({ ...anim, scale: Number(e.target.value) })} className={`${field} disabled:opacity-40`}>
                                    {[0.5, 0.75, 1, 1.5, 2, 3, 4].map((v) => (
                                        <option key={v} value={v}>
                                            {v}x
                                        </option>
                                    ))}
                                </Select>,
                            )}
                            {row(
                                "Quality",
                                <Select aria-label="Animated quality" value={anim.quality} disabled={["lottie", "dotlottie", "svganim", "webm"].includes(anim.format)} onChange={(e) => setAnim({ ...anim, quality: Number(e.target.value) })} className={`${field} disabled:opacity-40`}>
                                    <option value={1}>High</option>
                                    <option value={0.6}>Medium</option>
                                    <option value={0.3}>Low</option>
                                </Select>,
                            )}
                            {row(
                                "Frame rate",
                                <Select aria-label="Animated frame rate" value={anim.fps} onChange={(e) => setAnim({ ...anim, fps: Number(e.target.value) })} className={field}>
                                    {[24, 30, 60].map((v) => (
                                        <option key={v} value={v}>
                                            {v} fps
                                        </option>
                                    ))}
                                </Select>,
                            )}
                            <AriaButton isDisabled={busy || !screen} onPress={() => void run()} className={button}>
                                {busy ? "Exporting…" : `Export ${screen ? doc.nodes[screen]?.name : "frame"}`}
                            </AriaButton>
                        </>
                    )}
                </>
            )}
        </Section>
    );
}

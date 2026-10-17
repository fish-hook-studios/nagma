import { Eye, EyeOff, LinkBroken01, Minus, Plus, XClose } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { applyCommand } from "../engine/commands";
import { readImage } from "../engine/images";
import { imagePaint, isGradient, linearGradient, solid, swatchCss, withAngle } from "../engine/paint";
import { shaderPaint } from "../engine/shaders";
import { ShaderEditor } from "./shader-editor";
import { imageSrc } from "../engine/image-store";
import { endCrop, rotateCrop90, startCrop } from "../engine/image-crop";
import { useVectorUi, vectorUi } from "../engine/vector-ui";
import { AdjustSliders } from "./image-section";
import { editor, useEditor, type Theme } from "../engine/store";
import { PALETTES } from "../canvas/render";
import { fillCommands, fillsOf } from "../engine/text-paints";
import { useTextSession } from "../engine/text-session";
import { applyColorStyle, createColorStyle, detachColorStyle, stylesOf } from "../engine/styles";
import { StyleButton } from "./style-picker";
import { bindVariable, boundTo, findVariable, resolveVariable } from "../engine/variables";
import { Bindable, VarButton } from "./variable-picker";
import { BlendIcon, BlendMenu } from "./blend-menu";
import { PatternEditor } from "./pattern-editor";
import { type GradientBinding, GradientEditor } from "./gradient-editor";
import { patternPaint } from "../engine/pattern";
import { importVideo, videoPaint } from "../engine/video";
import type { ImagePaint, NagmaDocument, Paint, SceneNode, VideoFill } from "../engine/types";
import { type ColorLibrary, type ContrastInfo, ColorPicker, LibraryTab } from "./color-picker";
import { backdropColor } from "../engine/contrast";
import { IconButton } from "./icon-button";
import { NumberField } from "./number-field";
import { Select } from "./select";
import { Section } from "./panel-section";

type PaintKey = "fills" | "strokes";

const TYPE_LABELS: Record<Paint["type"], string> = { solid: "Solid", linear: "Linear", radial: "Radial", angular: "Angular", diamond: "Diamond", image: "Image", pattern: "Pattern", shader: "Shader" };

const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

function samePaints(nodes: SceneNode[], key: PaintKey): Paint[] | null {
    // Text fills can vary by range (rich text): read them through the text's styles.
    const read = (node: SceneNode) => (key === "fills" ? fillsOf(node) : node[key]);
    const first = nodes[0] ? read(nodes[0]) : null;
    if (!first) return null;
    const json = JSON.stringify(first);
    return nodes.every((node) => JSON.stringify(read(node)) === json) ? first : null;
}

// Writes a paint list to every selected layer, as one undo step (or as a live preview while scrubbing).
function usePaintWriter(nodes: SceneNode[], key: PaintKey) {
    const base = useRef<NagmaDocument | null>(null);
    const command = (paints: Paint[]) => ({
        type: "batch" as const,
        commands: nodes.flatMap((node) => (key === "fills" ? fillCommands(node, paints) : [{ type: "node.update" as const, id: node.id, patch: { [key]: paints } }])),
    });
    return {
        commit: (paints: Paint[]) => {
            const start = base.current;
            base.current = null;
            editor.execute(command(paints), start ?? undefined);
        },
        preview: (paints: Paint[]) => {
            base.current ??= editor.get().doc;
            editor.preview(applyCommand(base.current, command(paints)));
        },
    };
}

// A paint list: newest (top-most) paint first, each with swatch, value, opacity, visibility.
// `large` is Draw mode's row: a big swatch with the value over its opacity and kind.
// `page` is the no-selection panel's Page colour: one pill and the eye, no remove (a page always has
// its background).
export function PaintList({ nodes, paintKey, title, children, large, page, action }: { nodes: SceneNode[]; paintKey: PaintKey; title: string; children?: React.ReactNode; large?: boolean; page?: boolean; action?: React.ReactNode }) {
    useTextSession();
    const paints = samePaints(nodes, paintKey);
    const writer = usePaintWriter(nodes, paintKey);
    const styles = useEditor((s) => stylesOf(s.doc).colors);
    const styleKey = paintKey === "fills" ? "fillStyleId" : "strokeStyleId";
    const styleId = nodes.every((n) => n[styleKey] && n[styleKey] === nodes[0]?.[styleKey]) ? (nodes[0]?.[styleKey] ?? null) : null;
    const style = styleId ? styles.find((c) => c.id === styleId) : undefined;
    const ids = nodes.map((n) => n.id);
    // The colour behind a single layer, for the picker's contrast check (fills only).
    const backdrop = useEditor((s) => {
        const only = nodes.length === 1 ? s.doc.nodes[nodes[0]?.id ?? ""] : undefined;
        return only && paintKey === "fills" && only.type !== "page" ? backdropColor(s.doc, only) : null;
    });
    const contrast: ContrastInfo | undefined = backdrop ? { backdrop, node: nodes[0] ?? null } : undefined;
    const libraryFor = (bindKey: string): ColorLibrary => ({
        node: nodes[0] ?? null,
        style: styleId,
        variable: boundTo(nodes, bindKey),
        onStyle: (id) => applyColorStyle(ids, paintKey, id),
        onVariable: (id) => bindVariable(ids, bindKey, id),
    });
    const add = () => {
        const fresh = solid(paintKey === "strokes" ? "#000000" : nodes.every((n) => n.type === "text") ? "#111111" : "#D9D9D9");
        // With mixed paints, adding replaces them all, as other design tools do.
        writer.commit(paints ? [...paints, fresh] : [fresh]);
    };
    // Editing a paint by hand detaches the style; the style's own edits come through engine/styles.
    const commit = (next: Paint[]) => {
        if (style) detachColorStyle(ids, paintKey);
        writer.commit(next);
        if (style) editor.mergeLast();
    };
    // A page without a colour of its own shows the canvas colour of the current theme, which
    // editing makes its own.
    const theme = useEditor((s) => s.prefs.theme);
    const list = page && paints && paints.length === 0 ? [solid(canvasColor(theme))] : paints;
    return (
        <Section
            title={title}
            action={
                page ? (
                    action
                ) : (
                    <>
                        <StyleButton kind="color" nodes={nodes} target={paintKey} label={`${title} styles`} />
                        <IconButton size="sm" icon={Plus} label={`Add ${title.toLowerCase()}`} onPress={add} />
                    </>
                )
            }
        >
            {style ? (
                <div className="flex items-center gap-1">
                    <div className="flex h-6 w-[155px] min-w-0 shrink-0 items-center gap-[5px] rounded-md bg-field pr-2 pl-[5px]">
                        <span className="size-3.5 shrink-0 rounded-sm border border-black/10" style={{ background: swatchCss(style.paint, {}) }} />
                        <span className="min-w-0 flex-1 truncate">{style.name}</span>
                    </div>
                    <span className="ml-auto" />
                    <IconButton size="sm" icon={LinkBroken01} label="Detach style" onPress={() => detachColorStyle(ids, paintKey)} />
                    <IconButton size="sm" icon={Minus} label="Remove" onPress={() => commit([])} />
                </div>
            ) : list === null ? (
                <p className="flex h-6 items-center text-ink-subtle">Click + to replace mixed content</p>
            ) : (
                list
                    .map((paint, index) => ({ paint, index }))
                    .reverse()
                    .map(({ paint, index }) => (
                        <PaintRow
                            key={index}
                            large={large}
                            page={page}
                            paint={paint}
                            nodes={nodes}
                            bindKey={`${paintKey === "fills" ? "fill" : "stroke"}:${index}`}
                            library={libraryFor(`${paintKey === "fills" ? "fill" : "stroke"}:${index}`)}
                            contrast={contrast}
                            onChange={(next) => commit(list.map((p, i) => (i === index ? next : p)))}
                            onPreview={(next) => writer.preview(list.map((p, i) => (i === index ? next : p)))}
                            onRemove={() => commit(list.filter((_, i) => i !== index))}
                            // A paint that is the layer's only one can become a colour style.
                            onCreateStyle={list.length === 1 ? () => createColorStyle("", paint, { ids, key: paintKey }) : undefined}
                        />
                    ))
            )}
            {children && ((paints !== null && paints.length > 0) || style) && children}
        </Section>
    );
}

// The canvas colour of the current theme, from the palette the canvas itself paints with (the CSS
// token lags a render behind a theme switch, which showed the Light colour in Dark).
function canvasColor(theme: Theme): string {
    return PALETTES[theme].canvas.toUpperCase();
}

function PaintRow({
    page,
    paint,
    nodes,
    bindKey,
    onChange,
    onPreview,
    onRemove,
    library,
    contrast,
    large,
    onCreateStyle,
}: {
    page?: boolean;
    large?: boolean;
    onCreateStyle?: () => void;
    paint: Paint;
    nodes: SceneNode[];
    bindKey: string;
    library?: ColorLibrary;
    contrast?: ContrastInfo;
    onChange: (p: Paint) => void;
    onPreview: (p: Paint) => void;
    onRemove: () => void;
}) {
    const images = useEditor((s) => s.doc.images);
    const doc = useEditor((s) => s.doc);
    const [draft, setDraft] = useState<string | null>(null);
    // The row is highlighted while its paint popover is open, as in the reference.
    const [open, setOpen] = useState(false);
    const hex = paint.type === "solid" ? paint.color.replace("#", "").toUpperCase() : null;
    // A paint bound to a colour variable shows the variable as a pill instead of a hex value.
    const legacyKey = bindKey.endsWith(":0") ? bindKey.slice(0, -2) : null;
    const boundId = boundTo(nodes, bindKey) ?? (legacyKey ? boundTo(nodes, legacyKey) : null);
    const bound = boundId ? findVariable(doc, boundId) : null;
    const resolved = boundId ? resolveVariable(doc, boundId, nodes[0] ?? null) : null;
    // Pasting an image onto the swatch replaces the paint with it (⌘V while the swatch is focused).
    const pasteImage = async (event: React.ClipboardEvent) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        const image = await readImage(file);
        if (!image) return;
        editor.execute({ type: "image.add", id: image.id, data: image.data });
        onChange(paint.type === "image" ? { ...paint, id: image.id, original: undefined, adjust: undefined, video: undefined } : { ...imagePaint(image.id), opacity: paint.opacity, visible: paint.visible, blend: paint.blend });
    };
    const swatch = (big: boolean) => (
        <AriaDialogTrigger isOpen={open} onOpenChange={setOpen}>
            <span className="flex shrink-0" onPaste={(e) => void pasteImage(e)}>
                <AriaButton
                    aria-label="Edit paint"
                    className={`${big ? "size-9 rounded-md" : "size-3.5 rounded-sm"} shrink-0 overflow-hidden border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
                    style={{ background: swatchCss(paint, images) }}
                />
            </span>
            <AriaPopover
                placement="left top"
                offset={12}
                // The gradient's canvas handles, and the crop frame and its bar, live outside the
                // popover; using them keeps it open.
                shouldCloseOnInteractOutside={(el) => !el.closest("[data-gradient-handles]") && !el.closest("[data-crop-ui]") && !(el instanceof HTMLCanvasElement && vectorUi.get().crop)}
                className="w-60 rounded-xl border border-panel-border bg-panel-raised text-ink shadow-xl outline-none"
            >
                <AriaDialog className="outline-none" aria-label="Paint">
                    {({ close }) => <PaintEditor paint={paint} onChange={onChange} onPreview={onPreview} library={library} contrast={contrast} bind={{ nodes, key: bindKey }} onClose={close} onCreateStyle={onCreateStyle} onRemove={page ? undefined : onRemove} />}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
    const valueField = (
        <>
            {bound ? (
                <span className="flex h-5 min-w-0 flex-1 items-center gap-1 rounded border border-brand-500/40 bg-brand-100/60 px-1" title={`${bound.collection.name} / ${bound.variable.name} (${typeof resolved?.value === "string" ? resolved.value : ""})`}>
                    <span className="shrink-0 text-ink-subtle">
                        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6z" strokeLinejoin="round" />
                            <circle cx="6" cy="6" r="1.4" />
                        </svg>
                    </span>
                    <span className="min-w-0 flex-1 truncate">{bound.variable.name.split("/").pop()}</span>
                </span>
            ) : hex !== null ? (
                <input
                    aria-label="Hex colour"
                    value={draft ?? hex}
                    onFocus={(event) => {
                        setDraft(hex);
                        event.currentTarget.select();
                    }}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                        const value = (draft ?? "").replace("#", "").trim();
                        const full =
                            value.length === 3
                                ? value
                                      .split("")
                                      .map((c) => c + c)
                                      .join("")
                                : value;
                        if (/^[0-9a-fA-F]{6}$/.test(full) && paint.type === "solid") onChange({ ...paint, color: `#${full.toUpperCase()}` });
                        setDraft(null);
                    }}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="min-w-0 flex-1 bg-transparent uppercase outline-none"
                />
            ) : (
                <span className="min-w-0 flex-1 truncate">{TYPE_LABELS[paint.type]}</span>
            )}
        </>
    );
    if (large) {
        return (
            <div className="flex items-center gap-2">
                {swatch(true)}
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <div className="flex h-5 min-w-0 items-center rounded border border-transparent px-0.5 focus-within:border-brand-500 hover:border-panel-border">{valueField}</div>
                    <span className="truncate px-0.5 text-[11px] text-ink-muted">
                        {Math.round(paint.opacity * 100)}% · {TYPE_LABELS[paint.type]}
                    </span>
                </div>
                <IconButton size="sm" icon={paint.visible ? Eye : EyeOff} label={paint.visible ? "Hide" : "Show"} onPress={() => onChange({ ...paint, visible: !paint.visible })} />
                <IconButton size="sm" icon={Minus} label="Remove" onPress={onRemove} />
            </div>
        );
    }
    // One pill: swatch and value, a rule, the opacity; then the eye and remove outside it. The row
    // runs the panel's full width so its highlight does.
    return (
        <div className={`-mr-2 -ml-[15px] flex items-center pr-2 pl-[15px] ${open ? "bg-panel-border" : ""}`}>
            <div className={`group/paint flex h-6 min-w-0 items-center rounded-md border border-transparent bg-field focus-within:border-brand-500 hover:border-panel-border ${page ? "w-[182.5px] shrink-0" : "w-[155px] shrink-0"}`}>
                <div className="relative flex h-full min-w-0 flex-1 items-center gap-[5px] pr-1 pl-[4px]">
                    {swatch(false)}
                    {valueField}
                    {/* Over the value's end, shown on hover or focus, so the hex value keeps its width. */}
                    {paint.type === "solid" && !bound && (
                        <span className="absolute top-1/2 right-0.5 flex -translate-y-1/2 rounded bg-field opacity-0 group-focus-within/paint:opacity-100 group-hover/paint:opacity-100 has-[[data-pressed],[aria-expanded=true]]:opacity-100">
                            <VarButton nodes={nodes} field={bindKey} label="Apply variable to this paint" />
                        </span>
                    )}
                </div>
                <span aria-hidden="true" className="h-full w-px shrink-0 bg-panel" />
                <div className="w-[54px] shrink-0">
                    <Bindable nodes={nodes} field={`${bindKey}:opacity`} label="paint opacity">
                        <NumberField
                            bare
                            label=""
                            title="Paint opacity"
                            suffix="%"
                            min={0}
                            max={100}
                            value={Math.round(paint.opacity * 100)}
                            onCommit={(v) => onChange({ ...paint, opacity: v / 100 })}
                            onScrub={(v) => onPreview({ ...paint, opacity: v / 100 })}
                            onScrubEnd={(v) => onChange({ ...paint, opacity: v / 100 })}
                        />
                    </Bindable>
                </div>
            </div>
            <span className="ml-auto" />
            {paint.type === "solid" && bound && <IconButton size="sm" icon={LinkBroken01} label="Detach variable" onPress={() => { bindVariable(nodes.map((n) => n.id), bindKey, null); if (legacyKey) bindVariable(nodes.map((n) => n.id), legacyKey, null); }} />}
            <span>
                <IconButton size="sm" icon={paint.visible ? Eye : EyeOff} label={paint.visible ? "Hide" : "Show"} onPress={() => onChange({ ...paint, visible: !paint.visible })} />
            </span>
            {!page && (
                <span className="ml-1">
                    <IconButton size="sm" icon={Minus} label="Remove" onPress={onRemove} />
                </span>
            )}
        </div>
    );
}

// The popover editor for one paint, laid out like the reference's: Custom and Libraries tabs with
// create-style and close buttons, a row of paint kinds with the blend mode at its end, then the
// colour, gradient, pattern, image (with its adjustments) or video.
type Kind = "solid" | "gradient" | "pattern" | "image" | "video" | "shader";
const KIND_LABELS: Record<Kind, string> = { solid: "Solid", gradient: "Gradient", pattern: "Pattern", image: "Image", video: "Video", shader: "Shader" };

function kindOf(paint: Paint): Kind {
    return paint.type === "solid" ? "solid" : paint.type === "pattern" ? "pattern" : paint.type === "shader" ? "shader" : paint.type === "image" ? (paint.video ? "video" : "image") : "gradient";
}

function NoneIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M4.2 11.8 11.8 4.2" />
        </svg>
    );
}

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
    const common = { viewBox: "0 0 16 16", className, fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true } as const;
    if (kind === "solid")
        return (
            <svg {...common}>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <rect x="4.5" y="4.5" width="7" height="7" rx="0.5" fill="currentColor" stroke="none" />
            </svg>
        );
    if (kind === "gradient")
        return (
            <svg {...common}>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                {[5, 8, 11].flatMap((y, r) => [5, 8, 11].map((x, c) => <circle key={`${x}-${y}`} cx={x} cy={y} r={0.35 + (r + c) * 0.18} fill="currentColor" stroke="none" />))}
            </svg>
        );
    if (kind === "pattern")
        return (
            <svg {...common}>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <path d="M2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11" />
            </svg>
        );
    if (kind === "image")
        return (
            <svg {...common}>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <path d="m3 12 3.3-3.6 2.2 2.2 1.6-1.6L13 12" strokeLinejoin="round" />
                <circle cx="10" cy="5.8" r="1" fill="currentColor" stroke="none" />
            </svg>
        );
    if (kind === "video")
        return (
            <svg {...common}>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <path d="M6.6 5.6v4.8L10.4 8z" fill="currentColor" stroke="none" />
            </svg>
        );
    return (
        <svg {...common}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
            <path d="M4.5 6c1.2-1 2.3 1 3.5 0s2.3 1 3.5 0M4.5 8.5c1.2-1 2.3 1 3.5 0s2.3 1 3.5 0M4.5 11c1.2-1 2.3 1 3.5 0s2.3 1 3.5 0" strokeLinecap="round" />
        </svg>
    );
}

function PaintEditor({
    paint,
    onChange,
    onPreview,
    library,
    contrast,
    bind,
    onClose,
    onCreateStyle,
    onRemove,
}: {
    paint: Paint;
    onChange: (p: Paint) => void;
    onPreview: (p: Paint) => void;
    onRemove?: () => void;
    library?: ColorLibrary;
    contrast?: ContrastInfo;
    bind?: GradientBinding;
    onClose?: () => void;
    onCreateStyle?: () => void;
}) {
    const images = useEditor((s) => s.doc.images);
    const [tab, setTab] = useState<"custom" | "libraries">(() => (library && (library.style || library.variable) ? "libraries" : "custom"));
    const switchKind = (kind: Kind) => {
        if (kind === kindOf(paint)) return;
        const firstColor = paint.type === "solid" ? paint.color : isGradient(paint) ? (paint.stops[0]?.color ?? "#D9D9D9") : "#D9D9D9";
        const common = { opacity: paint.opacity, visible: paint.visible, blend: paint.blend };
        if (kind === "solid") return onChange({ ...solid(firstColor), ...common });
        if (kind === "image") return pickImage((id) => onChange({ ...imagePaint(id), ...common }));
        if (kind === "pattern") return onChange({ ...patternPaint(""), ...common });
        if (kind === "video") return pickVideo((poster, video) => onChange({ ...videoPaint(poster, video), ...common }));
        if (kind === "shader") return onChange({ ...shaderPaint(), ...common });
        // A new gradient fades the current colour out to transparent.
        const faded = linearGradient(firstColor, firstColor);
        onChange({ ...withAngle({ ...faded, stops: faded.stops.map((s, i) => (i === 1 ? { ...s, opacity: 0 } : s)) }, 90), ...common });
    };
    const switchGradient = (type: "linear" | "radial" | "angular" | "diamond") => {
        if (!isGradient(paint) || paint.type === type) return;
        onChange(type === "linear" ? withAngle({ ...paint, type }, 90) : { ...paint, type, from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } });
    };
    const kind = kindOf(paint);
    const headerButton = "flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500";
    return (
        <div className="select-none">
            <div className="flex h-10 items-center gap-0.5 border-b border-panel-border pr-2 pl-2" role="tablist" aria-label="Paint source">
                {(library ? (["custom", "libraries"] as const) : (["custom"] as const)).map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-6 rounded-md px-2 font-semibold ${tab === t ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {t === "custom" ? "Custom" : "Libraries"}
                    </button>
                ))}
                <span className="ml-auto" />
                {onCreateStyle && (
                    <button type="button" aria-label="Create style" title="Create style" onClick={() => { onCreateStyle(); setTab("libraries"); }} className={headerButton}>
                        <Plus className="size-4" />
                    </button>
                )}
                {onClose && (
                    <button type="button" aria-label="Close" onClick={onClose} className={headerButton}>
                        <XClose className="size-4" />
                    </button>
                )}
            </div>
            {library && tab === "libraries" ? (
                <div className="p-3">
                    <LibraryTab library={library} />
                </div>
            ) : (
                <>
                    {/* Paint kinds on a 28pt pitch, then the blend mode and "none" (removes the paint). */}
                    <div className="flex h-10 items-center border-b border-panel-border px-1.5" role="radiogroup" aria-label="Paint type">
                        {(["solid", "gradient", "pattern", "image", "video", "shader"] as const).map((k) => (
                            <button key={k} type="button" role="radio" aria-checked={kind === k} aria-label={KIND_LABELS[k]} title={KIND_LABELS[k]} onClick={() => switchKind(k)} className={`flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${kind === k ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                                <KindIcon kind={k} className="size-4" />
                            </button>
                        ))}
                        <span className="ml-auto" />
                        <BlendMenu value={paint.blend} onChange={(blend) => onChange({ ...paint, blend })} onPreview={(blend) => onPreview(blend ? { ...paint, blend } : paint)}>
                            <AriaButton aria-label="Blend mode" className={`${headerButton} size-7 ${paint.blend !== "normal" ? "text-brand-500" : ""}`}>
                                <BlendIcon className="size-4" />
                            </AriaButton>
                        </BlendMenu>
                        {onRemove && (
                            <button type="button" aria-label="No paint" title="No paint" onClick={() => { onRemove(); onClose?.(); }} className={`${headerButton} size-7`}>
                                <NoneIcon />
                            </button>
                        )}
                    </div>
                    <div className="space-y-3 p-4">
                        {paint.type === "solid" && (
                            <ColorPicker color={paint.color} opacity={paint.opacity} onChange={(color, opacity) => onChange({ ...paint, color, opacity })} onPreview={(color, opacity) => onPreview({ ...paint, color, opacity })} contrast={contrast} />
                        )}
                        {paint.type === "shader" && <ShaderEditor value={paint} onChange={(next) => onChange({ ...paint, ...next })} onPreview={(next) => onPreview({ ...paint, ...next })} />}
                        {isGradient(paint) && (
                            <>
                                <Select aria-label="Gradient type" value={paint.type} onChange={(e) => switchGradient(e.target.value as "linear" | "radial" | "angular" | "diamond")} className={`${field} w-full`}>
                                    <option value="linear">Linear</option>
                                    <option value="radial">Radial</option>
                                    <option value="angular">Angular</option>
                                    <option value="diamond">Diamond</option>
                                </Select>
                                <GradientEditor paint={paint} onChange={onChange} onPreview={onPreview} bind={bind} contrast={contrast} />
                            </>
                        )}
                        {paint.type === "pattern" && <PatternEditor paint={paint} onChange={onChange} onPreview={onPreview} />}
                        {paint.type === "image" && !paint.video && <ImageEditor paint={paint} images={images} onChange={onChange} onPreview={onPreview} />}
                        {paint.type === "image" && paint.video && <VideoEditor paint={paint} images={images} onChange={onChange} onPreview={onPreview} />}
                    </div>
                </>
            )}
        </div>
    );
}

// The light checkerboard behind transparent images.
const CHECKER = "repeating-conic-gradient(#E6E6E6 0% 25%, #FFFFFF 0% 50%) 0 0 / 16px 16px";

// An image fill: how it is scaled (Fill, Fit, Crop, Tile) with a quarter-turn button, the picture
// on a checkerboard (hover to replace it or open it in Photo), then the adjustment sliders.
// Choosing Crop (or opening a cropped image) shows the crop frame on the canvas.
function ImageEditor({ paint, images, onChange, onPreview }: { paint: ImagePaint; images: Record<string, string>; onChange: (p: Paint) => void; onPreview: (p: Paint) => void }) {
    const cropping = useVectorUi((s) => s.crop !== null);
    useEffect(() => {
        if (paint.mode === "crop" && !vectorUi.get().crop) cropPaint(paint);
        // Only when the popover opens on a cropped image.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const rotate = () => {
        if (paint.mode === "crop") {
            if (!cropping) cropPaint(paint);
            rotateCrop90();
        } else onChange({ ...paint, rotation: ((paint.rotation ?? 0) + 90) % 360 });
    };
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <Select
                    aria-label="Image scaling"
                    value={paint.mode}
                    onChange={(e) => {
                        const mode = e.target.value as ImagePaint["mode"];
                        // Crop opens crop mode on the canvas, starting from where the image is now.
                        if (mode === "crop") cropPaint(paint);
                        else {
                            if (cropping) endCrop();
                            onChange({ ...paint, mode });
                        }
                    }}
                    className={`${field} w-[120px]`}
                >
                    <option value="fill">Fill</option>
                    <option value="fit">Fit</option>
                    <option value="crop">Crop</option>
                    <option value="tile">Tile</option>
                </Select>
                <IconButton size="sm" icon={RotateQuarterIcon} label="Rotate 90°" onPress={rotate} />
            </div>
            <div className="group/img relative aspect-square overflow-hidden rounded-md" style={{ background: CHECKER }}>
                <div className="absolute inset-0 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${imageSrc(images, paint.id) ?? ""})` }} role="img" aria-label="Image preview" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/30 opacity-0 transition-opacity group-hover/img:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => pickImage((id) => onChange({ ...paint, id, original: undefined, adjust: undefined }))} className="h-6 rounded-md bg-brand-500 px-3 font-medium text-white">
                        Upload from computer
                    </button>
                    <button type="button" onClick={() => openPhotoEditorFor(paint)} className="h-6 rounded-md bg-tooltip px-3 font-medium text-white">
                        Edit in Photo…
                    </button>
                </div>
            </div>
            {paint.mode === "tile" && (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">Scale</span>
                    <div className="w-[88px]">
                        <NumberField label="" title="Tile scale" suffix="%" min={1} max={1000} value={Math.round((paint.tileScale ?? 0.5) * 100)} onCommit={(v) => onChange({ ...paint, tileScale: v / 100 })} onScrub={(v) => onPreview({ ...paint, tileScale: v / 100 })} onScrubEnd={(v) => onChange({ ...paint, tileScale: v / 100 })} />
                    </div>
                </div>
            )}
            {paint.mode !== "crop" && (paint.rotation ?? 0) % 90 !== 0 && (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">Rotation</span>
                    <div className="w-[88px]">
                        <NumberField label="" title="Rotation" suffix="°" value={paint.rotation ?? 0} onCommit={(v) => onChange({ ...paint, rotation: ((v % 360) + 360) % 360 })} onScrub={(v) => onPreview({ ...paint, rotation: ((v % 360) + 360) % 360 })} onScrubEnd={(v) => onChange({ ...paint, rotation: ((v % 360) + 360) % 360 })} />
                    </div>
                </div>
            )}
            <AdjustSliders paint={paint} onChange={onChange} compact />
        </div>
    );
}

function RotateQuarterIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M8 6.2 11.6 9.8 8 13.4 4.4 9.8z" />
            <path d="M5 4.6A5 5 0 0 1 12.4 5" />
            <path d="M12.6 2.6 12.4 5 10 4.8" />
        </svg>
    );
}

// A video fill: the poster, the file's facts, and how it plays.
function VideoEditor({ paint, images, onChange, onPreview }: { paint: ImagePaint; images: Record<string, string>; onChange: (p: Paint) => void; onPreview: (p: Paint) => void }) {
    const video = paint.video;
    if (!video) return null;
    const mm = Math.floor(video.seconds / 60);
    const ss = Math.round(video.seconds % 60).toString().padStart(2, "0");
    return (
        <div className="space-y-2">
            <div className="relative h-28 overflow-hidden rounded-md border border-panel-border bg-field bg-cover bg-center" style={{ backgroundImage: `url(${imageSrc(images, paint.id) ?? ""})` }}>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100">
                    <button type="button" onClick={() => pickVideo((poster, v) => onChange({ ...paint, id: poster, video: v }))} className="h-6 rounded-md bg-brand-500 px-3 font-medium text-white">
                        Upload from computer
                    </button>
                </div>
            </div>
            <div className="truncate text-ink-muted" title={video.name}>
                {video.name} · {video.width}×{video.height} · {mm}:{ss}
                {video.hasAudio ? " · sound" : ""}
            </div>
            <Select aria-label="Video scaling" value={paint.mode} onChange={(e) => {
                const mode = e.target.value as ImagePaint["mode"];
                // Crop opens crop mode on the canvas (the poster frame stands in for the video).
                if (mode === "crop") cropPaint(paint);
                else onChange({ ...paint, mode });
            }} className={`${field} w-full`}>
                <option value="fill">Fill</option>
                <option value="fit">Fit</option>
                <option value="crop">Crop</option>
                <option value="tile">Tile</option>
            </Select>
            {paint.mode === "tile" && (
                <NumberField label="Scale" suffix="%" min={1} max={1000} value={Math.round((paint.tileScale ?? 0.5) * 100)} onCommit={(v) => onChange({ ...paint, tileScale: v / 100 })} onScrub={(v) => onPreview({ ...paint, tileScale: v / 100 })} onScrubEnd={(v) => onChange({ ...paint, tileScale: v / 100 })} />
            )}
            {paint.mode === "crop" && (
                <button type="button" onClick={() => cropPaint(paint)} className="h-6 w-full rounded-md bg-field text-ink hover:bg-panel-hover">
                    Crop video
                </button>
            )}
            <div className="flex gap-3">
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={video.loop} onChange={(e) => onChange({ ...paint, video: { ...video, loop: e.target.checked } })} className="accent-brand-500" /> Loop
                </label>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={video.muted} onChange={(e) => onChange({ ...paint, video: { ...video, muted: e.target.checked } })} className="accent-brand-500" /> Muted
                </label>
            </div>
            <div className="text-ink-subtle">Plays in Motion mode and the prototype player; exports frame by frame with sound.</div>
        </div>
    );
}

function pickVideo(done: (poster: string, video: VideoFill) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,.mov,.mkv,.webm,.mxf";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            editor.notify("Opening video…");
            const { poster, video } = await importVideo(file);
            editor.execute({ type: "image.add", id: poster.id, data: poster.data });
            done(poster.id, video);
        } catch (error) {
            editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    input.click();
}

// Crop mode for this paint on the selected layer.
function cropPaint(paint: ImagePaint) {
    const s = editor.get();
    const node = s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined;
    const index = node?.fills.findIndex((p) => p === paint || (p.type === "image" && p.id === paint.id)) ?? -1;
    if (node && index >= 0) startCrop(node.id, index);
    else editor.notify("Select one layer to crop its image.");
}

function openPhotoEditorFor(paint: ImagePaint) {
    const s = editor.get();
    const id = s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    const index = node?.fills.findIndex((p) => p === paint || (p.type === "image" && p.id === paint.id)) ?? -1;
    if (!node || index < 0) return;
    editor.set({ photoEdit: { nodeId: node.id, paintIndex: index } });
}

function pickImage(done: (id: string) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const image = await readImage(file);
        if (!image) return;
        editor.execute({ type: "image.add", id: image.id, data: image.data });
        done(image.id);
    };
    input.click();
}


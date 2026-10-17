import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold01, ChevronDown, Copy01, DotsHorizontal, Download01, Edit05, Image01, Italic01, Lock01, LockUnlocked01, Maximize02, Scissors01, Trash01, Type01, Underline01, Upload01 } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Header as AriaHeader,
    Popover as AriaPopover,
    Section as AriaSection,
    Separator as AriaSeparator,
} from "react-aria-components";
import { AlignRow } from "../components/align-row";
import { AutoLayoutControls, FlowButtons } from "../components/auto-layout-panel";
import { AddEffectButton, EffectsList } from "../components/effects-list";
import { ImageSection } from "../components/image-section";
import { MenuRow } from "../components/left-sidebar";
import { NumberField } from "../components/number-field";
import { PaintList } from "../components/paint-list";
import { FontPicker, WeightSelect } from "../components/type-controls";
import { deleteSelection, duplicateSelection } from "../engine/actions";
import { worldToScreen } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";
import { MIXED, type Mixed } from "../engine/rich-text";
import { editor, useEditor } from "../engine/store";
import { ensureFont } from "../engine/text";
import { applyCharStyle, sharedTextValue, useTextSession } from "../engine/text-session";
import type { SceneNode } from "../engine/types";
import { replaceImage } from "./actions";
import { AssetExportSettings, FieldsList, ImageField, Swatches } from "./edit-panel";
import { SIZE_GROUPS, STARTER_LAYOUTS, assetData, assetOf, brandOf, duplicateAsset, fieldValuePatch, layerData, presetFor, SIZE_PRESETS, templatesOf } from "./model";
import { StarterPicture } from "./template-library";
import { applyLayout, loadTeamAssetTemplates, useTeamAssetTemplates, type LayoutSource } from "./templates";
import { VideoPopover } from "./video-controls";
import { SwapContent } from "./libraries";
import { videoOf } from "./video";
import { AssetThumb } from "./left-panel";
import { collectionsOf, setFrameMode } from "../engine/variables";
import { useTeams } from "../engine/teams";
import { useAuth } from "../engine/auth";
import { removeBackground } from "./remove-background";
import { resizeInPlace } from "./resize";
import { AssetCard, LayerCard } from "./template-panel";
import { campaign, useCampaign } from "./state";

// The floating toolbar over the selection, in place of a properties panel (Design mode brings the
// design editor's panel instead). Its controls follow what's selected:
// - a shape or picture: fill, stroke, corner radius (and the image) | Effects | position, align, lock
// - text: colour, paragraph | font, weight, size, bold, italic, underline, align | Effects | position, more
// - an asset: its size, background, layout | the template settings
// Every control opens a small menu under the toolbar. In Edit mode only what the template opens up
// is offered.

const POP = "max-h-[70vh] overflow-y-auto rounded-lg border border-panel-border bg-panel text-[11px] text-ink shadow-xl outline-none";
const ITEM = "flex h-6 shrink-0 items-center gap-1.5 rounded-[5px] px-1 text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 data-[pressed]:bg-panel-hover disabled:opacity-40";
const ICON_ITEM = "flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 data-[pressed]:bg-panel-hover disabled:opacity-40";
const FIELD = "flex h-6 shrink-0 items-center gap-1 rounded-[5px] bg-field px-1.5 text-left text-[11px] text-ink outline-none hover:bg-panel-hover";
// The outlined dropdowns of the toolbar (size, font, weight): a 1pt ring on the toolbar's fill.
const OUTLINED = "flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-panel-border pr-1.5 pl-2 text-left text-[11px] text-ink outline-none hover:bg-panel-hover";
const MENU = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

const value = <T,>(v: T | Mixed): T | null => (v === MIXED ? null : v);

function Chevron() {
    return <ChevronDown className="size-3 shrink-0 text-ink" />;
}

// A toolbar control that opens a menu of controls under the toolbar.
function Pop({ label, children, content, width = "w-64", icon }: { label: string; children: ReactNode; content: ReactNode; width?: string; icon?: boolean }) {
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={label} className={icon ? ICON_ITEM : ITEM}>
                {children}
            </AriaButton>
            <AriaPopover placement="bottom" offset={8} className={`${POP} ${width}`}>
                <AriaDialog aria-label={label} className="outline-none">
                    {content}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function Divider() {
    return <span className="h-10 w-px shrink-0 bg-panel-border" />;
}

function Swatch({ node, paintKey }: { node: SceneNode; paintKey: "fills" | "strokes" }) {
    const paint = node[paintKey].find((p) => p.visible);
    const style = paint?.type === "solid" ? { background: paint.color } : paint?.type === "image" ? { background: "repeating-conic-gradient(#999 0% 25%, #ddd 0% 50%) 0 0 / 6px 6px" } : paint ? { background: "linear-gradient(135deg, #888, #ddd)" } : undefined;
    return <span className={`block size-3.5 rounded-[3px] ${paint ? "" : "border border-dashed border-ink-subtle"}`} style={style} />;
}

// Three lines, the way the stroke and paragraph menus are marked.
function LinesIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <path d="M3 4h10M3 8h10M3 12h10" />
            <path d="M3 4h10" strokeWidth="2.4" />
        </svg>
    );
}

function CornerIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M4 13V8a4 4 0 0 1 4-4h5" />
        </svg>
    );
}

function PositionIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="2.5" y="2.5" width="4" height="4" rx="0.8" />
            <rect x="9.5" y="2.5" width="4" height="4" rx="0.8" />
            <rect x="2.5" y="9.5" width="4" height="4" rx="0.8" />
            <rect x="9.5" y="9.5" width="4" height="4" rx="0.8" />
        </svg>
    );
}

// Four points, the text toolbar's mark for position.
function AnchorIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2.5c.4 2.6 2.9 5.1 5.5 5.5-2.6.4-5.1 2.9-5.5 5.5-.4-2.6-2.9-5.1-5.5-5.5 2.6-.4 5.1-2.9 5.5-5.5z" />
        </svg>
    );
}

function TemplateIcon({ on }: { on: boolean }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-4 ${on ? "text-brand-500" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3.5 12.5 8 8 12.5 3.5 8z" />
            <circle cx="8" cy="1.6" r=".7" fill="currentColor" stroke="none" />
            <circle cx="8" cy="14.4" r=".7" fill="currentColor" stroke="none" />
            <circle cx="1.6" cy="8" r=".7" fill="currentColor" stroke="none" />
            <circle cx="14.4" cy="8" r=".7" fill="currentColor" stroke="none" />
        </svg>
    );
}

function update(nodes: SceneNode[], patch: (n: SceneNode) => Partial<SceneNode>) {
    editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: patch(n) })) });
}

const shared = <T,>(nodes: SceneNode[], pick: (n: SceneNode) => T): T | null => {
    const first = nodes[0];
    if (!first) return null;
    const v = pick(first);
    return nodes.every((n) => pick(n) === v) ? v : null;
};

function EffectsPopover({ nodes }: { nodes: SceneNode[] }) {
    const [open, setOpen] = useState<number | null>(null);
    return (
        <div className="px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="font-semibold">Effects</span>
                <AddEffectButton nodes={nodes} onAdded={setOpen} />
            </div>
            <EffectsList nodes={nodes} open={open} onOpenChange={setOpen} />
            {nodes.every((n) => !n.effects?.length && !n.shadow && !n.blur) && <p className="text-ink-muted">No effects yet. Click + to add a shadow, blur or texture.</p>}
        </div>
    );
}

function PositionPopover({ nodes, asset }: { nodes: SceneNode[]; asset: SceneNode | null }) {
    const ox = asset?.x ?? 0;
    const oy = asset?.y ?? 0;
    const x = shared(nodes, (n) => Math.round(n.x - ox));
    const y = shared(nodes, (n) => Math.round(n.y - oy));
    return (
        <div className="space-y-2 px-3 py-2.5">
            <div className="font-semibold">Position</div>
            <AlignRow nodes={nodes} />
            <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="X" value={x} onCommit={(v) => editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.move" as const, ids: [n.id], dx: v + ox - n.x, dy: 0 })) })} />
                <NumberField label="Y" value={y} onCommit={(v) => editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.move" as const, ids: [n.id], dx: 0, dy: v + oy - n.y })) })} />
                <NumberField label="W" min={1} value={shared(nodes, (n) => Math.round(n.w))} onCommit={(v) => update(nodes, () => ({ w: Math.max(1, v) }))} />
                <NumberField label="H" min={1} value={shared(nodes, (n) => Math.round(n.h))} onCommit={(v) => update(nodes, () => ({ h: Math.max(1, v) }))} />
                <NumberField label="°" title="Rotation" value={shared(nodes, (n) => Math.round(n.rotation))} onCommit={(v) => update(nodes, () => ({ rotation: v }))} />
                <NumberField label="%" title="Opacity" min={0} max={100} value={shared(nodes, (n) => Math.round(n.opacity * 100))} onCommit={(v) => update(nodes, () => ({ opacity: Math.min(1, Math.max(0, v / 100)) }))} />
            </div>
        </div>
    );
}

const TEXT_ALIGNS = [
    { id: "left", label: "Align left", icon: AlignLeft },
    { id: "center", label: "Align centre", icon: AlignCenter },
    { id: "right", label: "Align right", icon: AlignRight },
    { id: "justify", label: "Justify", icon: AlignJustify },
] as const;

function AlignPopover({ nodes }: { nodes: SceneNode[] }) {
    const texts = nodes.every((n) => n.type === "text");
    const current = shared(nodes, (n) => n.textAlign ?? "left");
    return (
        <div className="space-y-2 px-3 py-2.5">
            {texts && (
                <>
                    <div className="font-semibold">Text alignment</div>
                    <div role="radiogroup" aria-label="Text alignment" className="grid grid-cols-4 gap-0.5 rounded-md bg-field p-0.5">
                        {TEXT_ALIGNS.map(({ id, label, icon: Icon }) => (
                            <button key={id} type="button" role="radio" aria-checked={current === id} aria-label={label} title={label} onClick={() => update(nodes, () => ({ textAlign: id }))} className={`flex h-6 items-center justify-center rounded ${current === id ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                <Icon className="size-3.5" />
                            </button>
                        ))}
                    </div>
                </>
            )}
            <div className="font-semibold">Align in the asset</div>
            <AlignRow nodes={nodes} />
            <p className="text-ink-subtle">⇧-click to align each layer to its parent.</p>
        </div>
    );
}

function AlignIcon({ nodes }: { nodes: SceneNode[] }) {
    const current = nodes.every((n) => n.type === "text") ? shared(nodes, (n) => n.textAlign ?? "left") : "left";
    const Icon = TEXT_ALIGNS.find((a) => a.id === current)?.icon ?? AlignLeft;
    return <Icon className="size-3.5" />;
}

function RemoveBackgroundButton({ node }: { node: SceneNode }) {
    const [busy, setBusy] = useState(false);
    const has = node.fills.some((p) => p.type === "image");
    return (
        <AriaButton
            aria-label="Remove background"
            isDisabled={!has || busy}
            onPress={() => {
                setBusy(true);
                void removeBackground(node.id)
                    .then((ok) => editor.notify(ok ? "Background removed." : "Couldn't read that image."))
                    .catch((e) => editor.notify(`Couldn't remove the background: ${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setBusy(false));
            }}
            className={ITEM}
        >
            <Scissors01 className="size-3.5" /> {busy ? "Working…" : "Remove background"}
        </AriaButton>
    );
}

// The lock at the end: whether editors may change the layer (a template field) and what stays locked.
function FieldLock({ node }: { node: SceneNode }) {
    const field = layerData(node);
    return (
        <Pop icon label={field ? "Editable field" : "Locked for editors"} content={<LayerCard node={node} bare />}>
            {field ? <LockUnlocked01 className="size-3.5" /> : <Lock01 className="size-3.5" />}
        </Pop>
    );
}

// ---- Text: the type controls in the bar itself ----

// The size field with its stepper, like a design tool's: type a size, or nudge it by one.
function SizeStepper({ nodes }: { nodes: SceneNode[] }) {
    const size = value(sharedTextValue(nodes, "fontSize"));
    const display = size === null ? "Mixed" : String(Math.round(size * 10) / 10);
    const [draft, setDraft] = useState(display);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setDraft(display);
    }, [display]);
    const commit = (next: number) => {
        const v = Math.max(1, Math.round(next * 10) / 10);
        applyCharStyle(nodes, { fontSize: v }, { detachStyle: true });
    };
    const step = (by: number) => {
        if (size !== null) commit(size + by);
    };
    const arrow = "flex h-[11px] w-3.5 items-center justify-center text-ink-muted hover:text-ink";
    return (
        <div className={`${FIELD} w-[72px] gap-0 pr-1 pl-2`} title="Font size">
            <input
                aria-label="Font size"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => {
                    focused.current = true;
                    e.currentTarget.select();
                }}
                onBlur={() => {
                    focused.current = false;
                    const n = Number.parseFloat(draft);
                    if (Number.isFinite(n) && n !== size) commit(n);
                    else setDraft(display);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                        setDraft(display);
                        (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        step((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
                    }
                    e.stopPropagation();
                }}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none"
            />
            <span className="flex flex-col">
                <button type="button" aria-label="Larger" tabIndex={-1} onClick={() => step(1)} className={arrow}>
                    <svg viewBox="0 0 8 6" className="h-1.5 w-2" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M1 4.5 4 1.5l3 3" /></svg>
                </button>
                <button type="button" aria-label="Smaller" tabIndex={-1} onClick={() => step(-1)} className={arrow}>
                    <svg viewBox="0 0 8 6" className="h-1.5 w-2" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M1 1.5 4 4.5l3-3" /></svg>
                </button>
            </span>
        </div>
    );
}

function StyleToggle({ label, on, icon: Icon, onPress }: { label: string; on: boolean; icon: typeof Bold01; onPress: () => void }) {
    return (
        <AriaButton aria-label={label} aria-pressed={on} onPress={onPress} className={`${ICON_ITEM} ${on ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
            <Icon className="size-3.5" />
        </AriaButton>
    );
}

// Line height, letter spacing and the space between paragraphs.
function ParagraphPopover({ nodes }: { nodes: SceneNode[] }) {
    const size = value(sharedTextValue(nodes, "fontSize"));
    const lh = value(sharedTextValue(nodes, "lineHeight"));
    const tracking = value(sharedTextValue(nodes, "letterSpacing"));
    return (
        <div className="space-y-2 px-3 py-2.5">
            <div className="font-semibold">Paragraph</div>
            <NumberField label="Line height" title="Line height" min={0} suffix="%" value={lh === null || lh === undefined ? (size === null ? null : 120) : Math.round(lh * 100)} onCommit={(v) => applyCharStyle(nodes, { lineHeight: Math.max(0.1, v / 100) }, { detachStyle: true })} />
            <NumberField label="Letter spacing" title="Letter spacing" suffix="%" value={tracking ?? 0} onCommit={(v) => applyCharStyle(nodes, { letterSpacing: v }, { detachStyle: true })} />
            <NumberField label="Paragraph spacing" title="Paragraph spacing" min={0} value={shared(nodes, (n) => n.paragraphSpacing ?? 0)} onCommit={(v) => update(nodes, () => ({ paragraphSpacing: Math.max(0, v) }))} />
        </div>
    );
}

function TextTools({ nodes, asset }: { nodes: SceneNode[]; asset: SceneNode | null }) {
    useTextSession();
    const first = nodes[0];
    if (!first) return null;
    const single = nodes.length === 1 ? first : null;
    const family = value(sharedTextValue(nodes, "fontFamily"));
    const weight = value(sharedTextValue(nodes, "fontWeight"));
    const italic = value(sharedTextValue(nodes, "italic"));
    const decoration = value(sharedTextValue(nodes, "decoration"));
    const set = (patch: Parameters<typeof applyCharStyle>[1]) => applyCharStyle(nodes, patch, { detachStyle: true });
    const bold = weight !== null && weight >= 600;
    return (
        <>
            <Pop label="Text colour" content={<PaintList nodes={nodes} paintKey="fills" title="Text colour" />}>
                <Swatch node={first} paintKey="fills" />
                <Chevron />
            </Pop>
            <Pop label="Paragraph" width="w-60" content={<ParagraphPopover nodes={nodes} />}>
                <LinesIcon />
                <Chevron />
            </Pop>
            <Divider />
            <FontPicker
                family={family}
                className="h-6 w-[124px] rounded-[5px] border border-panel-border bg-transparent! px-2 text-[11px]"
                placement="bottom start"
                onPick={(next) => {
                    ensureFont(next, () => editor.refreshText());
                    set({ fontFamily: next });
                }}
            />
            <WeightSelect weight={weight} italic={italic} className={`${OUTLINED} w-[79px] text-ink-muted`} onChange={(fontWeight, it) => set({ fontWeight, italic: it })} />
            <SizeStepper nodes={nodes} />
            <StyleToggle label="Bold" on={bold} icon={Bold01} onPress={() => set({ fontWeight: bold ? 400 : 700 })} />
            <StyleToggle label="Italic" on={Boolean(italic)} icon={Italic01} onPress={() => set({ italic: !italic })} />
            <StyleToggle label="Underline" on={decoration === "underline"} icon={Underline01} onPress={() => set({ decoration: decoration === "underline" ? "none" : "underline" })} />
            <Pop label="Alignment" content={<AlignPopover nodes={nodes} />}>
                <AlignIcon nodes={nodes} />
                <Chevron />
            </Pop>
            <Divider />
            <Pop label="Effects" content={<EffectsPopover nodes={nodes} />}>
                <span className="px-0.5">Effects</span>
                <Chevron />
            </Pop>
            <Divider />
            <Pop label="Position" content={<PositionPopover nodes={nodes} asset={asset} />}>
                <AnchorIcon />
                <Chevron />
            </Pop>
            <Pop
                icon
                label="More"
                content={
                    <div className="space-y-1 p-2">
                        {single && <LayerCard node={single} bare />}
                        <div className="border-t border-panel-border pt-1">
                            <AriaButton className={`${ITEM} w-full`} onPress={duplicateSelection}>
                                <Copy01 className="size-3.5" /> Duplicate
                            </AriaButton>
                            <AriaButton className={`${ITEM} w-full`} onPress={deleteSelection}>
                                <Trash01 className="size-3.5" /> Delete
                            </AriaButton>
                        </div>
                    </div>
                }
            >
                <DotsHorizontal className="size-3.5" />
            </Pop>
        </>
    );
}

// ---- Shapes and pictures ----

function LayerTools({ nodes, asset }: { nodes: SceneNode[]; asset: SceneNode | null }) {
    const first = nodes[0];
    if (!first) return null;
    const single = nodes.length === 1 ? first : null;
    const image = single && single.fills.some((p) => p.type === "image") ? single : null;
    const cornered = nodes.every((n) => n.type === "rect" || n.type === "frame" || n.type === "vector" || n.type === "instance" || n.type === "component");
    return (
        <>
            <Pop label="Fill" content={<PaintList nodes={nodes} paintKey="fills" title="Fill" />}>
                <Swatch node={first} paintKey="fills" />
                <Chevron />
            </Pop>
            <Pop label="Stroke" content={<PaintList nodes={nodes} paintKey="strokes" title="Stroke" />}>
                <LinesIcon />
                <Chevron />
            </Pop>
            {cornered && (
                <Pop
                    label="Corner radius"
                    width="w-48"
                    content={
                        <div className="space-y-2 px-3 py-2.5">
                            <div className="font-semibold">Corner radius</div>
                            <NumberField label="◜" title="Corner radius" min={0} value={shared(nodes, (n) => n.radius)} onCommit={(v) => update(nodes, () => ({ radius: Math.max(0, v), radii: null }))} />
                        </div>
                    }
                >
                    <CornerIcon />
                    <Chevron />
                </Pop>
            )}
            {image && videoOf(image) && (
                <Pop label="Video" width="w-72" content={<VideoPopover node={image} />}>
                    <VideoIcon />
                    <Chevron />
                </Pop>
            )}
            {image && !videoOf(image) && (
                <Pop
                    label="Image"
                    content={
                        <div className="py-1">
                            <ImageSection node={image} />
                            <div className="px-2 pb-2">
                                <RemoveBackgroundButton node={image} />
                            </div>
                        </div>
                    }
                >
                    <Image01 className="size-3.5" />
                    <Chevron />
                </Pop>
            )}
            {single?.type === "instance" && (
                <Pop label="Swap content" width="w-60" content={<SwapContent node={single} />}>
                    <SwapIcon />
                    <Chevron />
                </Pop>
            )}
            <Divider />
            <Pop label="Effects" content={<EffectsPopover nodes={nodes} />}>
                <span className="px-0.5">Effects</span>
                <Chevron />
            </Pop>
            <Divider />
            <Pop icon label="Position" content={<PositionPopover nodes={nodes} asset={asset} />}>
                <PositionIcon />
            </Pop>
            <Pop label="Alignment" content={<AlignPopover nodes={nodes} />}>
                <AlignIcon nodes={nodes} />
                <Chevron />
            </Pop>
            {single && <FieldLock node={single} />}
        </>
    );
}

// ---- Assets ----

// The asset's size: a preset (resizes in place, its layers reflow) or Resize to… for copies.
function SizeMenu({ asset }: { asset: SceneNode }) {
    const data = assetData(asset);
    const preset = presetFor(data?.preset);
    const label = preset && preset.w === asset.w && preset.h === asset.h ? `${preset.label} ${preset.w}x${preset.h}` : `Custom ${Math.round(asset.w)}x${Math.round(asset.h)}`;
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Asset size" isDisabled={readOnly} className={`${OUTLINED} w-[174px]`}>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <Chevron />
            </AriaButton>
            <AriaPopover placement="bottom start" offset={8} className={`${MENU} max-h-[60vh] overflow-y-auto`}>
                <AriaMenu
                    aria-label="Asset size"
                    className="outline-none"
                    onAction={(key) => {
                        if (key === "resize") campaign.set({ dialog: { kind: "resize", assetId: asset.id } });
                        else resizeInPlace(asset.id, String(key));
                    }}
                >
                    {SIZE_GROUPS.map((g) => (
                        <AriaSection key={g} aria-label={g}>
                            <AriaHeader className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-white/50">{g}</AriaHeader>
                            {SIZE_PRESETS.filter((p) => p.group === g).map((p) => (
                                <MenuRow key={p.id} id={p.id} label={`${p.label} ${p.w}x${p.h}`} checked={preset?.id === p.id && p.w === asset.w && p.h === asset.h} />
                            ))}
                        </AriaSection>
                    ))}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="resize" label="Resize to… (make copies)" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function SwapIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5" />
        </svg>
    );
}

function VideoIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" />
            <path d="m10.5 7 4-2.5v7l-4-2.5" />
        </svg>
    );
}

// The asset's border: its colour, weight, and a solid or dashed line.
function BorderPopover({ asset }: { asset: SceneNode }) {
    const dashed = Boolean(asset.dash);
    const set = (patch: Partial<SceneNode>) => editor.execute({ type: "node.update", id: asset.id, patch });
    return (
        <div className="space-y-2 pb-2.5">
            <PaintList nodes={[asset]} paintKey="strokes" title="Border" />
            <div className="grid grid-cols-2 gap-1.5 px-3">
                <NumberField label="W" title="Border weight" min={0} value={asset.strokeWidth} onCommit={(v) => set({ strokeWidth: Math.max(0, v), strokeAlign: "inside" })} />
                <div role="radiogroup" aria-label="Border style" className="grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5">
                    {([false, true] as const).map((d) => (
                        <button key={String(d)} type="button" role="radio" aria-checked={dashed === d} onClick={() => set({ dash: d ? [Math.max(4, asset.strokeWidth * 3), Math.max(3, asset.strokeWidth * 2)] : null })} className={`h-6 rounded text-[11px] ${dashed === d ? "bg-panel text-ink shadow-sm" : "text-ink-muted"}`}>
                            {d ? "Dashed" : "Solid"}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Change layout: Browse other layouts (the starters, this file's templates and the team's), which
// rebuild the asset with its content kept; Customize the one it has (direction, spacing, order).
function LayoutPopover({ asset }: { asset: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const user = useAuth((s) => s.user);
    const teams = useTeams();
    const [tab, setTab] = useState<"browse" | "customize">("browse");
    const [busy, setBusy] = useState<string | null>(null);
    const teamId = teams[0]?.id ?? null;
    const team = useTeamAssetTemplates(user ? teamId : null);
    useEffect(() => {
        if (user && teamId) void loadTeamAssetTemplates(teamId).catch(() => undefined);
    }, [user, teamId]);
    const others = templatesOf(doc).filter((t) => t.id !== asset.id);
    const apply = (key: string, source: LayoutSource) => {
        setBusy(key);
        applyLayout(asset.id, source)
            .catch((e) => editor.notify(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(null));
    };
    const tile = "flex flex-col overflow-hidden rounded-md bg-field text-left outline-none hover:ring-1 hover:ring-brand-500 disabled:opacity-50";
    const tabClass = (on: boolean) => `h-6 flex-1 rounded text-[11px] ${on ? "bg-panel font-semibold text-ink shadow-sm" : "text-ink-muted"}`;
    const reverse = () => editor.execute({ type: "batch", commands: asset.children.map((id) => ({ type: "node.reparent" as const, id, parentId: asset.id, index: 0 })) });
    return (
        <div className="px-3 py-2.5">
            <div role="tablist" aria-label="Change layout" className="mb-2 flex gap-0.5 rounded-md bg-field p-0.5">
                <button type="button" role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} className={tabClass(tab === "browse")}>
                    Browse
                </button>
                <button type="button" role="tab" aria-selected={tab === "customize"} onClick={() => setTab("customize")} className={tabClass(tab === "customize")}>
                    Customize
                </button>
            </div>
            {tab === "browse" ? (
                <div className="max-h-[52vh] space-y-2 overflow-y-auto">
                    <div className="text-ink-muted">Layouts</div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {STARTER_LAYOUTS.map((l) => (
                            <button key={l.id} type="button" disabled={busy !== null} title={l.about} onClick={() => apply(l.id, { kind: "starter", layout: l.id })} className={tile}>
                                <StarterPicture layout={l.id} w={asset.w} h={asset.h} />
                                <span className="truncate px-1.5 py-1 text-[10.5px]">{busy === l.id ? "Applying…" : l.label}</span>
                            </button>
                        ))}
                    </div>
                    {others.length > 0 && (
                        <>
                            <div className="text-ink-muted">In this file</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {others.map((t) => (
                                    <button key={t.id} type="button" disabled={busy !== null} onClick={() => apply(t.id, { kind: "file", assetId: t.id })} className={tile}>
                                        <span className="flex aspect-[4/3] items-center justify-center bg-canvas">
                                            <AssetThumb id={t.id} width={110} height={80} />
                                        </span>
                                        <span className="truncate px-1.5 py-1 text-[10.5px]">{busy === t.id ? "Applying…" : t.name}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {team && team.length > 0 && (
                        <>
                            <div className="text-ink-muted">Your team</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {team.map((t) => (
                                    <button key={t.id} type="button" disabled={busy !== null} onClick={() => apply(t.id, { kind: "team", template: t })} className={tile}>
                                        <span className="flex aspect-[4/3] items-center justify-center bg-canvas">{t.thumb ? <img src={t.thumb} alt="" className="max-h-full max-w-full object-contain" /> : null}</span>
                                        <span className="truncate px-1.5 py-1 text-[10.5px]">{busy === t.id ? "Applying…" : t.name}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <p className="text-ink-subtle">Text, images and colours carry over to fields with the same name.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <FlowButtons frames={[asset]} />
                    {asset.layout && <AutoLayoutControls frames={[asset]} />}
                    <AriaButton className={`${ITEM} w-full justify-center border border-panel-border`} onPress={reverse} isDisabled={asset.children.length < 2}>
                        Reverse the order
                    </AriaButton>
                </div>
            )}
        </div>
    );
}

// Variable modes: the asset's mode in each collection that has more than one (a language, a brand),
// switching every bound text and colour inside it.
function ModesPop({ asset }: { asset: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const collections = collectionsOf(doc).filter((c) => c.modes.length > 1);
    if (!collections.length) return null;
    const label = collections.map((c) => c.modes.find((m) => m.id === asset.variableModes?.[c.id])?.name).filter(Boolean).join(", ") || "Modes";
    return (
        <Pop
            label="Variable modes"
            width="w-60"
            content={
                <div className="space-y-2 px-3 py-2.5">
                    <div className="font-semibold">Variable modes</div>
                    {collections.map((c) => (
                        <label key={c.id} className="grid grid-cols-[80px_1fr] items-center gap-2">
                            <span className="truncate text-ink-muted">{c.name}</span>
                            <select aria-label={`${c.name} mode`} value={asset.variableModes?.[c.id] ?? ""} onChange={(e) => setFrameMode([asset.id], c.id, e.target.value || null)} className="h-6 rounded-[5px] border border-panel-border bg-panel px-1.5 text-[11px] text-ink outline-none">
                                <option value="">Default ({c.modes.find((m) => m.id === (c.defaultModeId ?? c.modes[0]?.id))?.name})</option>
                                {c.modes.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </label>
                    ))}
                </div>
            }
        >
            <span className="max-w-20 truncate px-0.5">{label}</span>
            <Chevron />
        </Pop>
    );
}

// What else can be done with the asset: a variant, copies in other sizes, its export.
function AssetActions({ asset }: { asset: SceneNode }) {
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <div className="space-y-1 p-2">
            {!readOnly && (
                <>
                    <AriaButton className={`${ITEM} w-full`} onPress={() => duplicateAsset(asset.id)}>
                        <Copy01 className="size-3.5" /> Duplicate as variant
                    </AriaButton>
                    <AriaButton className={`${ITEM} w-full`} onPress={() => campaign.set({ dialog: { kind: "resize", assetId: asset.id } })}>
                        <Maximize02 className="size-3.5" /> Resize to…
                    </AriaButton>
                </>
            )}
            <AriaButton className={`${ITEM} w-full`} onPress={() => campaign.set({ dialog: { kind: "export", ids: [asset.id] } })}>
                <Download01 className="size-3.5" /> Export this asset…
            </AriaButton>
            {!readOnly && (
                <div className="border-t border-panel-border px-1.5 pt-2">
                    <div className="mb-1 text-[10px] text-ink-subtle">Export settings</div>
                    <AssetExportSettings asset={asset} />
                </div>
            )}
        </div>
    );
}

function AssetTools({ asset, full }: { asset: SceneNode; full: boolean }) {
    return (
        <>
            <SizeMenu asset={asset} />
            {full ? (
                <>
                    {/* The background, with the asset's border under it (the toolbar has one fill control). */}
                    <Pop
                        label="Background"
                        content={
                            <>
                                <PaintList nodes={[asset]} paintKey="fills" title="Background" />
                                <div className="border-t border-panel-border pt-1">
                                    <BorderPopover asset={asset} />
                                </div>
                            </>
                        }
                    >
                        <Swatch node={asset} paintKey="fills" />
                        <Chevron />
                    </Pop>
                    <Pop label="Change layout" width="w-72" content={<LayoutPopover asset={asset} />}>
                        <LinesIcon />
                        <Chevron />
                    </Pop>
                    <ModesPop asset={asset} />
                    <Divider />
                    <Pop
                        label="Template"
                        content={
                            <>
                                <AssetCard asset={asset} bare />
                                <div className="border-t border-panel-border">
                                    <AssetActions asset={asset} />
                                </div>
                            </>
                        }
                    >
                        <TemplateIcon on={Boolean(assetData(asset)?.template)} />
                        <Chevron />
                    </Pop>
                </>
            ) : (
                <>
                    <Pop label="Fields" content={<div className="w-72 p-1"><FieldsList asset={asset} /></div>} width="w-72">
                        <Edit05 className="size-3.5" />
                        <span>Fields</span>
                        <Chevron />
                    </Pop>
                    <Pop icon label="More asset actions" content={<AssetActions asset={asset} />}>
                        <DotsHorizontal className="size-3.5" />
                    </Pop>
                </>
            )}
        </>
    );
}

// Edit mode, a field selected: only what the template opens up.
function FieldTools({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const data = layerData(node);
    if (!data) return null;
    const brand = brandOf(doc);
    const solid = node.fills.find((p) => p.type === "solid");
    const color = solid?.type === "solid" ? solid.color : "";
    const setColor = (c: string) => {
        const patch = fieldValuePatch(node, "color", c);
        if (patch) editor.execute({ type: "node.update", id: node.id, patch });
    };
    return (
        <>
            <span className="px-1.5 text-[11px] font-medium text-ink-muted">{data.field}</span>
            {data.type === "text" && !data.locks.content && (
                <AriaButton aria-label="Edit text" className={ITEM} onPress={() => editor.set({ selection: [node.id], editingTextId: node.id })}>
                    <Type01 className="size-3.5" /> Edit text
                </AriaButton>
            )}
            {data.type === "image" && !data.locks.content && (
                <>
                    <AriaButton aria-label={`Replace ${data.field}`} className={ITEM} onPress={() => pickImage(node)}>
                        <Upload01 className="size-3.5" /> Replace
                    </AriaButton>
                    <Pop label="Image settings" content={<div className="p-3"><ImageField node={node} /></div>}>
                        <Image01 className="size-3.5" />
                        <Chevron />
                    </Pop>
                </>
            )}
            {!data.locks.style && (
                <Pop label={`${data.field} colour`} width="w-56" content={<div className="p-3"><Swatches label={`${data.field} colour`} colors={brand.colors} current={color} onPick={setColor} allowCustom={!data.brandOnly} /></div>}>
                    <span className="block size-3.5 rounded-[3px]" style={{ background: color || "transparent" }} />
                    <Chevron />
                </Pop>
            )}
        </>
    );
}

function pickImage(node: SceneNode) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) void replaceImage(node, file);
    };
    input.click();
}

export function ContextToolbar() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const camera = useEditor((s) => s.camera);
    const readOnly = useEditor((s) => s.readOnly);
    const editing = useEditor((s) => s.editingTextId);
    const mode = useCampaign((s) => s.mode);
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [room, setRoom] = useState(0);
    // The top-right cluster (people, Export, Share): its left edge and bottom, so the toolbar never
    // runs under it.
    const [cluster, setCluster] = useState<{ left: number; bottom: number } | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (el.offsetWidth !== width) setWidth(el.offsetWidth);
        const parent = el.parentElement?.clientWidth ?? 0;
        if (parent !== room) setRoom(parent);
        const corner = el.parentElement?.querySelector<HTMLElement>(":scope > [data-campaign-topright]");
        const next = corner ? { left: corner.offsetLeft, bottom: corner.offsetTop + corner.offsetHeight } : null;
        if (next?.left !== cluster?.left || next?.bottom !== cluster?.bottom) setCluster(next);
    }, [selection, camera, mode, doc, width, room, cluster]);
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length || readOnly || mode === "design") return null;
    const asset = assetOf(doc, nodes[0]?.id);
    const assets = new Set(nodes.map((n) => assetOf(doc, n.id)?.id));
    const box = selectionBounds(doc, selection);
    if (!box) return null;
    const full = mode !== "edit";
    const onlyAsset = nodes.length === 1 && asset && nodes[0]?.id === asset.id ? asset : null;
    const many = assets.size > 1 || (nodes.length > 1 && nodes.every((n) => assetData(n)));
    let content: ReactNode;
    if (many) {
        const ids = [...assets].filter((id): id is string => Boolean(id));
        content = (
            <>
                <span className="px-1.5 text-[11px] text-ink-muted">{ids.length} assets</span>
                <AriaButton className={ITEM} onPress={() => campaign.set({ dialog: { kind: "export", ids } })}>
                    <Download01 className="size-3.5" /> Export
                </AriaButton>
            </>
        );
    } else if (onlyAsset) content = <AssetTools asset={onlyAsset} full={full} />;
    else if (full && nodes.every((n) => n.type === "text")) content = <TextTools nodes={nodes} asset={asset} />;
    else if (full) content = <LayerTools nodes={nodes} asset={asset} />;
    else if (nodes.length === 1 && nodes[0] && layerData(nodes[0])) content = <FieldTools node={nodes[0]} />;
    else return null;
    // Above the asset (with room for its name), centred on the selection, kept on screen.
    const top = worldToScreen(camera, box.x, (asset ?? nodes[0])?.y ?? box.y).y - 69;
    const center = worldToScreen(camera, box.x + box.w / 2, 0).x;
    const half = width / 2;
    let y = Math.max(12, top);
    // Beside the top-right cluster the toolbar stops 8 short of it; where there's no room beside
    // it, the toolbar drops below the cluster instead.
    let right = room;
    if (cluster && room && y < cluster.bottom + 8) {
        if (cluster.left >= width + 16) right = cluster.left;
        else y = cluster.bottom + 8;
    }
    const left = room ? Math.min(Math.max(center, half + 8), right - half - 8) : center;
    return (
        <div
            ref={ref}
            role="toolbar"
            aria-label="Selection"
            data-campaign-toolbar=""
            style={{ left, top: y, opacity: editing && !full ? 0.4 : 1 }}
            className="absolute z-10 flex h-10 w-max -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-[12px] bg-panel px-2 text-ink shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.35)]"
        >
            {content}
        </div>
    );
}

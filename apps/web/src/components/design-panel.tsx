import { AlignBottom01, AlignLeft, AlignRight, AlignHorizontalCentre01, AlignTopArrow01, AlignVerticalCenter01, ChevronDown, Eye, EyeOff, LinkBroken01, Minus, Reflect01, Reflect02, Code02, DotsHorizontal } from "@untitledui/icons";
import { useRef, useState } from "react";
import {
    Button as AriaButton,
    Tooltip as AriaTooltip,
    TooltipTrigger as AriaTooltipTrigger,
    Checkbox as AriaCheckbox,
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Collection as AriaCollection,
    Header as AriaHeader,
    Menu as AriaMenu,
    Section as AriaSection,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
} from "react-aria-components";
import { PRESETS, type Preset, applyPreset, hasAnimation, keyframeAt, removeKeyframe, setKeyframe, trackLabel, trackPropsFor, valueAt } from "../engine/animation";
import { applyCommand } from "../engine/commands";
import { isFrameLike } from "../engine/components";
import { expandGroups } from "../engine/nodes";
import { editor, useEditor } from "../engine/store";
import type { AnimProp, Constraints, Command, EffectStyle, NagmaDocument, NodePatch, SceneNode, TrackProp } from "../engine/types";
import { TypographySection } from "./typography-panel";
import { TextStaggerSection } from "./text-stagger-panel";
import { MissingFontsBanner } from "./missing-fonts";
import { ColorSwatch } from "./color-picker";
import { IconButton } from "./icon-button";
import { PaintList } from "./paint-list";
import { isImageLayer } from "../engine/photo";
import { HeaderActions } from "./header-actions";
import { AlignRow } from "./align-row";
import { AdvancedStroke, StrokeControls } from "./stroke-panel";
import { DrawStrokeControls } from "./draw-stroke";
import { LayoutGuideSection } from "./layout-guides";
import { BlendSelect, LayerBlendButton } from "./blend-menu";
import { AutoLayoutControls, FlowButtons, GridChildControls, LimitFields, SizingMenu } from "./auto-layout-panel";
import { AddEffectButton, EffectsList, OpacityMark } from "./effects-list";
import { PresenceBar, PresentButton, ShareButton } from "./collab-ui";
import { subtree } from "../engine/prototype";
import { DEFAULT_CONSTRAINTS } from "../engine/constraints";
import { PrototypePanel } from "./prototype-panel";
import { MenuRow } from "./left-sidebar";
import { DevStatusButton } from "./dev-status";
import { ZoomMenu } from "./zoom-menu";
import { ComponentSection } from "./component-section";
import { DescriptionEditor, PropBinding } from "./component-props";
import { StyleButton } from "./style-picker";
import { LocalStyles } from "./local-styles";
import { NumberField } from "./number-field";
import { ShapeParams } from "./shape-params";
import { ExportSection } from "./export-section";
import { ViewerProperties } from "./viewer-properties";
import { CommentsPanel } from "./comments-ui";
import { TransformsSection } from "./transforms-section";
import { WidthPointField } from "./width-point-field";
import { type HandleMirror, setVertexPosition, vertexPosition } from "../canvas/vector-edit";
import { alignSelectedVertices } from "../engine/vector-actions";
import { FRAME_PRESETS } from "../engine/presets";
import { groupRotation, rotateGroup } from "../engine/group-transform";
import { addAutoLayout, flipSelection, removeAutoLayout, resizeToFit } from "../engine/actions";
import { rotateSelection } from "../engine/arrange";
import { HeaderSection, JOINED, JOINED_BUTTON, PAIR, ROW, SECTION, Section } from "./panel-section";
import { type LayerKind, convertLayer, layerKindOf } from "../engine/layer-convert";
import { findVariable } from "../engine/variables";
import { Bindable, ModeTag, VarButton, VariableModeButton } from "./variable-picker";
import { detachEffectStyle, stylesOf } from "../engine/styles";
import { Select } from "./select";
import { RelaunchButtons } from "./relaunch-buttons";
import { LiveSections } from "./live-section";
import { type BuiltinLang, copyAsCode } from "../engine/dev-code";
import { devStatusOf, devStatusTargets, setDevStatus } from "../engine/dev-status";

const TYPE_LABELS: Record<SceneNode["type"], string> = {
    page: "Page",
    frame: "Frame",
    component: "Component",
    componentSet: "Component set",
    instance: "Instance",
    boolean: "Boolean",
    vector: "Vector",
    group: "Group",
    rect: "Rectangle",
    ellipse: "Ellipse",
    text: "Text",
    live: "Live frame",
};

// A line is an open two-point path; an arrow is a line with an end point shape. Polygons and stars
// stay parametric. Slices are export regions. Everything else reads from its type.
function labelOf(node: SceneNode): string {
    if (node.isSlice) return "Slice";
    if (isImageLayer(node)) return "Image";
    if (node.parametric) return node.parametric.kind === "star" ? "Star" : "Polygon";
    if (node.type === "vector") {
        const subs = node.path?.subpaths ?? [];
        const line = subs.length === 1 && !subs[0]?.closed && subs[0]?.points.length === 2 && subs[0].points.every((p) => !p.in && !p.out);
        if (line) return (node.strokeCapEnd ?? "none") !== "none" || (node.strokeCapStart ?? "none") !== "none" ? "Arrow" : "Line";
    }
    return TYPE_LABELS[node.type];
}

function shared<T>(nodes: SceneNode[], pick: (node: SceneNode) => T): T | null {
    const first = nodes[0];
    if (!first) return null;
    const value = pick(first);
    return nodes.every((node) => pick(node) === value) ? value : null;
}

function updateAll(nodes: SceneNode[], patch: (node: SceneNode) => NodePatch) {
    editor.execute({ type: "batch", commands: nodes.map((node) => ({ type: "node.update" as const, id: node.id, patch: patch(node) })) });
}

// Binds a number field to the selection: shared value, typed edits, and scrubbing as one undo step.
function useField(nodes: SceneNode[], read: (node: SceneNode) => number, write: (doc: NagmaDocument, node: SceneNode, value: number) => Command[]) {
    const base = useRef<NagmaDocument | null>(null);
    const ids = nodes.map((node) => node.id);
    const build = (doc: NagmaDocument, value: number | ((current: number) => number)): Command => ({
        type: "batch",
        commands: ids.flatMap((id) => {
            const node = doc.nodes[id];
            return node ? write(doc, node, typeof value === "function" ? value(read(node)) : value) : [];
        }),
    });
    return {
        value: shared(nodes, (node) => Math.round(read(node) * 100) / 100),
        onCommit: (value: number) => editor.execute(build(editor.get().doc, value)),
        // "+10" on a Mixed field moves each layer from its own value.
        onRelative: (apply: (current: number) => number) => editor.execute(build(editor.get().doc, apply)),
        onScrub: (value: number) => {
            base.current ??= editor.get().doc;
            editor.preview(applyCommand(base.current, build(base.current, value)));
        },
        onScrubEnd: (value: number) => {
            const start = base.current ?? editor.get().doc;
            base.current = null;
            editor.execute(build(start, value), start);
        },
    };
}

const set =
    (key: keyof NodePatch) =>
    (_doc: NagmaDocument, node: SceneNode, value: number): Command[] => [{ type: "node.update", id: node.id, patch: { [key]: value } }];

// Width and height. A group has no size of its own, so its contents are scaled from its top-left.
const sizeWrite =
    (key: "w" | "h") =>
    (doc: NagmaDocument, node: SceneNode, value: number): Command[] => {
        if (node.type !== "group") {
            // Typing a size fixes that axis, so it stops hugging or filling. A locked ratio moves the other axis too.
            const axis = key === "w" ? "h" : "v";
            const other = key === "w" ? "h" : "w";
            // The locked ratio is the one taken when the lock was set, so rounding never drifts it.
            const target = node.targetAspectRatio && node.targetAspectRatio.w > 0 && node.targetAspectRatio.h > 0 ? node.targetAspectRatio : { w: node.w, h: node.h };
            const ratio = node.lockAspect && node[key] > 0 ? { [other]: Math.max(1, Math.round(key === "w" ? (value * target.h) / target.w : (value * target.w) / target.h)) } : {};
            return [{ type: "node.update", id: node.id, patch: { [key]: value, ...ratio, sizing: { ...node.sizing, [axis]: "fixed", ...(node.lockAspect ? { [axis === "h" ? "v" : "h"]: "fixed" } : {}) } } }];
        }
        const factor = node[key] > 0 ? value / node[key] : 1;
        return expandGroups(doc, [node.id]).flatMap((id): Command[] => {
            const leaf = doc.nodes[id];
            if (!leaf) return [];
            return key === "w"
                ? [{ type: "node.update", id, patch: { x: node.x + (leaf.x - node.x) * factor, w: Math.max(1, leaf.w * factor) } }]
                : [{ type: "node.update", id, patch: { y: node.y + (leaf.y - node.y) * factor, h: Math.max(1, leaf.h * factor) } }];
        });
    };

// X and Y are shown relative to the parent frame, as in other design tools.
function parentOrigin(doc: NagmaDocument, node: SceneNode) {
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    return parent ? { x: parent.x, y: parent.y } : { x: 0, y: 0 };
}

export function DesignPanel() {
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const motion = useEditor((s) => s.mode === "motion");
    const drawMode = useEditor((s) => s.mode === "draw");
    const tab = useEditor((s) => (s.mode === "motion" || s.mode === "draw" ? "design" : s.rightTab));
    const readOnly = useEditor((s) => s.readOnly);
    const editingVectorId = useEditor((s) => s.editingVectorId);
    const setTab = (rightTab: "design" | "prototype") => editor.set({ rightTab });
    const [viewerTab, setViewerTab] = useState<"comment" | "properties">("properties");
    const nodes = selection.map((id) => doc.nodes[id]).filter((node): node is SceneNode => Boolean(node));

    return (
        <aside data-right-panel="" className="flex h-full w-60 shrink-0 flex-col border-l border-panel-border bg-panel">
            {/* One 80pt block above the rule: people, Present ⌄ and a 32pt Share (48), then the tabs and zoom (32). */}
            <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-2">
                <PresenceBar chevron />
                <div className="flex-1" />
                <PresentButton />
                <ShareButton size="lg" className="" />
            </header>
            <div className="flex h-[33px] shrink-0 items-start gap-1 border-b border-panel-border px-2">
                {motion ? (
                    // Motion mode names itself instead of the Design and Prototype tabs, like the reference's.
                    <div className="flex h-6 items-center gap-1.5 px-2">
                        <span className="font-semibold text-ink">Motion</span>
                        <span className="rounded-full border border-panel-border px-1.5 text-[10px] leading-4 text-ink-muted">Beta</span>
                    </div>
                ) : drawMode && !readOnly ? (
                    // Draw mode: a "Draw" title in place of the Design and Prototype tabs.
                    <div className="flex h-6 items-center px-2 font-semibold text-ink">Draw</div>
                ) : readOnly ? (
                    // View access: Comment and Properties instead of Design and Prototype.
                    (["comment", "properties"] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setViewerTab(key)}
                            className={`h-6 rounded-md px-[7.25px] font-semibold ${viewerTab === key ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}
                        >
                            {key === "comment" ? "Comments" : "Properties"}
                        </button>
                    ))
                ) : (
                    (["design", "prototype"] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setTab(key)}
                            className={`h-6 rounded-md px-[7.25px] font-semibold capitalize ${tab === key ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}
                        >
                            {key}
                        </button>
                    ))
                )}
                <div className="flex-1" />
                <ZoomMenu />
            </div>
            {readOnly && !motion ? (
                <div className="min-h-0 flex-1 overflow-y-auto">{viewerTab === "comment" ? <CommentsPanel embedded /> : <ViewerProperties nodes={nodes} />}</div>
            ) : (
                // A disabled fieldset turns every control below into read-only (version previews in Motion mode).
                <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {tab === "prototype" ? <PrototypePanel /> : editingVectorId ? <VectorPointsPanel /> : nodes.length === 0 ? <PagePanel /> : <SelectionPanel nodes={nodes} />}
                    </div>
                </fieldset>
            )}
        </aside>
    );
}

// Nothing selected: the page's colour (one pill and the eye; its title button sets the page's
// variable modes and opens the variables), the local styles, and Export. The file's colour profile
// is set from the colour picker's footer.
function PagePanel() {
    const page = useEditor((s) => s.doc.nodes[s.pageId]);
    const doc = useEditor((s) => s.doc);
    const roots = (page?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    return (
        <>
            <MissingFontsBanner />
            <RelaunchButtons nodes={[]} />
            {page && (
                <PaintList nodes={[page]} paintKey="fills" title="Page" page action={<VariableModeButton frames={[page]} />}>
                    {Object.keys(page.variableModes ?? {}).length > 0 && <ModeTag node={page} />}
                </PaintList>
            )}
            <LocalStyles />
            {roots.length > 0 && <ExportSection nodes={roots} />}
        </>
    );
}

// Motion mode: a diamond next to a value adds or removes a keyframe at the playhead.
function KeyDiamond({ nodes, prop }: { nodes: SceneNode[]; prop: AnimProp }) {
    const time = useEditor((s) => s.time);
    const keyed = nodes.every((n) => keyframeAt(n, prop, time));
    const tracked = nodes.some((n) => n.animation?.tracks[prop]?.length);
    return (
        <button
            type="button"
            aria-label={keyed ? `Remove ${prop} keyframe` : `Add ${prop} keyframe`}
            title={keyed ? "Remove keyframe" : "Add keyframe at the playhead"}
            onClick={() =>
                editor.execute({
                    type: "batch",
                    commands: nodes.map((n) => (keyed ? removeKeyframe(n, prop, time) : setKeyframe(n, prop, time, valueAt(n, prop, time)))),
                })
            }
            className={`flex h-6 w-5 shrink-0 items-center justify-center text-[11px] ${keyed ? "text-brand-500" : tracked ? "text-brand-500/60" : "text-ink-subtle hover:text-ink"}`}
        >
            {keyed || tracked ? "◆" : "◇"}
        </button>
    );
}

function AnimationsSection({ nodes }: { nodes: SceneNode[] }) {
    const time = useEditor((s) => s.time);
    const [preset, setPreset] = useState<Preset>("fade-in");
    const animated = nodes.some(hasAnimation);
    const select = "h-6 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    return (
        <Section
            title="Animations"
            action={
                animated ? (
                    <IconButton
                        size="sm"
                        icon={Minus}
                        label="Remove all keyframes"
                        onPress={() => editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: { animation: undefined } })) })}
                    />
                ) : undefined
            }
        >
            <div className="flex gap-1.5">
                <Select aria-label="Animation preset" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={select}>
                    {PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </Select>
                <AriaButton
                    onPress={() => editor.execute({ type: "batch", commands: nodes.map((n) => applyPreset(n, preset, time)) })}
                    className="h-6 rounded-md border border-panel-border px-2 font-medium outline-none hover:bg-panel-hover"
                >
                    Add
                </AriaButton>
            </div>
            <PropertyKeyRow nodes={nodes} />
            {animated && <div className="text-ink-muted">{nodes.map((n) => Object.values(n.animation?.tracks ?? {}).filter((t) => t?.length).length).reduce((a, b) => a + b, 0)} animated values. Drag a layer or change a value to add keyframes at the playhead.</div>}
        </Section>
    );
}

// Keyframes any animatable property (corner radii, stroke, spacing, text, each effect's values...) at
// the playhead with its current value; the same values as the timeline's Animate a property menu.
function PropertyKeyRow({ nodes }: { nodes: SceneNode[] }) {
    const time = useEditor((s) => s.time);
    const first = nodes[0];
    const options = first ? trackPropsFor(first).filter((p) => nodes.every((n) => trackPropsFor(n).includes(p))) : [];
    const [prop, setProp] = useState<TrackProp>("radiusTL");
    const chosen = options.includes(prop) ? prop : options[0];
    if (!chosen) return null;
    const select = "h-6 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    return (
        <div className="flex gap-1.5">
            <Select aria-label="Property to keyframe" value={chosen} onChange={(e) => setProp(e.target.value as TrackProp)} className={select}>
                {options.map((p) => (
                    <option key={p} value={p}>
                        {trackLabel(first, p)}
                    </option>
                ))}
            </Select>
            <AriaButton
                aria-label={`Add ${trackLabel(first, chosen)} keyframe`}
                onPress={() => editor.execute({ type: "batch", commands: nodes.map((n) => setKeyframe(n, chosen, time, valueAt(n, chosen, time))) })}
                className="flex h-6 items-center gap-1 rounded-md border border-panel-border px-2 outline-none hover:bg-panel-hover"
            >
                ◆ Key
            </AriaButton>
        </div>
    );
}

export function SelectionPanel({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const motion = useEditor((s) => s.mode === "motion");
    const draw = useEditor((s) => s.mode === "draw");
    const autoKey = useEditor((s) => s.autoKey);
    const time = useEditor((s) => s.time);
    // In Motion mode with auto keyframe on, editing a value records a keyframe at the playhead.
    const keyed = (prop: AnimProp, plain: (doc: NagmaDocument, node: SceneNode, value: number) => Command[], toValue: (node: SceneNode, value: number) => number = (_n, v) => v) =>
        motion && autoKey ? (_d: NagmaDocument, node: SceneNode, value: number) => [setKeyframe(node, prop, time, toValue(node, value))] : plain;
    const now = (node: SceneNode, prop: Extract<AnimProp, "x" | "y" | "w" | "h" | "rotation" | "opacity" | "radius">) => (motion ? (valueAt(node, prop, time) as number) : node[prop]);
    const texts = nodes.filter((node) => node.type === "text");
    const allText = texts.length === nodes.length;
    const frames = nodes.filter((node) => isFrameLike(node));
    const allFrames = frames.length > 0 && frames.length === nodes.length;
    // Sections are canvas organisers: no auto layout, clipping, constraints or layout guides.
    const allSections = allFrames && frames.every((node) => node.isSection);
    const type = shared(nodes, (node) => node.type);
    // Constraints apply to layers inside a frame that isn't laying them out (or that they ignore).
    const canConstrain =
        !allSections &&
        nodes.every((node) => {
            const parent = doc.nodes[node.parentId ?? ""];
            return parent && isFrameLike(parent) && (!parent.layout || node.positioning === "absolute");
        });
    const [constraintsOpen, setConstraintsOpen] = useState(true);
    // Min and max fields show once asked for; a new selection hides them again (the key resets this).
    const [limitsOpen, setLimitsOpen] = useState(false);
    const locked = nodes.length > 0 && nodes.every((node) => node.lockAspect);
    const allSlices = nodes.every((node) => node.isSlice);

    const x = useField(
        nodes,
        (node) => now(node, "x") - parentOrigin(doc, node).x,
        keyed("x", (d, node, value) => [{ type: "node.move", ids: [node.id], dx: value + parentOrigin(d, node).x - node.x, dy: 0 }], (node, value) => value + parentOrigin(doc, node).x),
    );
    const y = useField(
        nodes,
        (node) => now(node, "y") - parentOrigin(doc, node).y,
        keyed("y", (d, node, value) => [{ type: "node.move", ids: [node.id], dx: 0, dy: value + parentOrigin(d, node).y - node.y }], (node, value) => value + parentOrigin(doc, node).y),
    );
    // Size changes keep the layer's centre-relative placement simple: grow from the top-left.
    const w = useField(nodes, (node) => now(node, "w"), keyed("w", sizeWrite("w")));
    const h = useField(nodes, (node) => now(node, "h"), keyed("h", sizeWrite("h")));
    const hasGroup = nodes.some((node) => node.type === "group");
    const paintNodes = hasGroup ? expandGroups(doc, nodes.map((n) => n.id)).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)) : nodes;
    // A group's rotation is its layers' (they turn about the group's centre).
    const rotation = useField(
        nodes,
        (node) => (node.type === "group" ? groupRotation(doc, node) : now(node, "rotation")),
        (d, node, value) =>
            node.type === "group"
                ? rotateGroup(d, node, value - groupRotation(d, node))
                : keyed("rotation", (_d, n, v) => [{ type: "node.update", id: n.id, patch: { rotation: ((((v + 180) % 360) + 360) % 360) - 180 } }])(d, node, value),
    );
    const opacity = useField(
        nodes,
        (node) => now(node, "opacity") * 100,
        keyed("opacity", (_d, node, value) => [{ type: "node.update", id: node.id, patch: { opacity: value / 100 } }], (_n, value) => value / 100),
    );
    const radius = useField(nodes, (node) => now(node, "radius"), keyed("radius", set("radius")));
    const key = (prop: AnimProp) => (motion ? <KeyDiamond nodes={nodes} prop={prop} /> : null);

    const visible = nodes.every((node) => node.visible);
    const devTargets = devStatusTargets(doc, nodes.map((n) => n.id));
    const devMarkable = devTargets.length > 0 && devTargets.length === nodes.length;
    const devMarked = devMarkable && devTargets.some((n) => devStatusOf(doc, n));
    // A single instance's header block names its component (the swap menu) in place of "Instance".
    const instanceHeader = nodes.length === 1 && nodes[0]?.type === "instance";
    // The header's buttons as in the reference: Copy as code (frames), the layer's own actions, and
    // More (⋯), which holds "Mark as ready for dev" until a status is set (then its pill shows).
    const headerActions = (
        <div className="flex items-center gap-1">
            {allFrames && <CopyCodeMenu />}
            <HeaderActions nodes={nodes} />
            {devMarked && <DevStatusButton ids={nodes.map((n) => n.id)} />}
            <HeaderMoreMenu ids={nodes.map((n) => n.id)} canMark={devMarkable && !devMarked} describe={nodes.length === 1 && nodes[0]?.type === "componentSet" ? nodes[0] : undefined} />
        </div>
    );
    const autoLayout = allFrames && frames.every((node) => node.layout);
    // Frames and groups get the flow buttons (a group becomes an auto layout frame); instances and
    // sections don't.
    const flowable = !allText && !nodes.some((n) => n.type === "instance") && ((allFrames && !allSections) || (nodes.length > 0 && nodes.every((n) => n.type === "group")));

    return (
        <>
            {instanceHeader ? (
                // The instance block has its own More menu (main component, reset, detach).
                <ComponentSection
                    nodes={nodes}
                    actions={
                        <>
                            <HeaderActions nodes={nodes} />
                            {devMarkable && <DevStatusButton ids={nodes.map((n) => n.id)} />}
                        </>
                    }
                />
            ) : (
                <HeaderSection
                    title={nodes.length === 1 && nodes[0] && layerKindOf(nodes[0]) && !nodes[0].sourceId && !nodes[0].isSlice ? <LayerTypeMenu node={nodes[0]} /> : nodes.length > 1 ? `${nodes.length} layers` : allSections ? "Section" : nodes[0] ? labelOf(nodes[0]) : TYPE_LABELS[type ?? "rect"]}
                    action={headerActions}
                />
            )}
            <RelaunchButtons nodes={nodes} />
            {!motion && nodes.length === 1 && nodes[0]?.type === "live" && <LiveSections node={nodes[0]} />}
            {!instanceHeader && <ComponentSection nodes={nodes} />}
            {motion && <AnimationsSection nodes={nodes} />}
            {motion && nodes.every((n) => n.type === "text") && <TextStaggerSection nodes={nodes} />}

            {/* Draw mode: the position controls follow the header without a title row. */}
            <Section title="Position" className={draw ? "pt-1 [&>div:first-child]:hidden" : ""}>
                <AlignRow nodes={nodes} />
                <div className={ROW}>
                    <div className="flex min-w-0 items-center"><NumberField label="X" {...x} />{key("x")}</div>
                    <div className="flex min-w-0 items-center"><NumberField label="Y" {...y} />{key("y")}</div>
                    {canConstrain ? <IconButton size="sm" icon={ConstraintsIcon} label={constraintsOpen ? "Hide constraints" : "Constraints"} active={constraintsOpen} onPress={() => setConstraintsOpen(!constraintsOpen)} /> : <span />}
                </div>
                {canConstrain && constraintsOpen && <ConstraintsBody nodes={nodes} />}
                <div className={ROW}>
                    <div className="flex min-w-0 items-center"><NumberField label="∠" icon={<RotationIcon className="size-3.5" />} title="Rotation" unit="°" {...rotation} />{!hasGroup && key("rotation")}</div>
                    <div className={JOINED}>
                        <JoinedButton icon={Rotate90Icon} label="Rotate 90° right" onPress={() => rotateSelection(90)} />
                        <JoinedButton icon={Reflect01} label="Flip horizontal" shortcut="⇧ H" onPress={() => flipSelection("x")} />
                        <JoinedButton icon={Reflect02} label="Flip vertical" shortcut="⇧ V" onPress={() => flipSelection("y")} />
                    </div>
                </div>
            </Section>

            <Section
                title={autoLayout ? "Auto layout" : "Layout"}
                action={
                    autoLayout ? (
                        <IconButton size="sm" icon={AutoLayoutIcon} label="Remove auto layout" shortcut="⌥ ⇧ A" active onPress={removeAutoLayout} />
                    ) : flowable ? (
                        <>
                            {nodes.some((n) => n.children.length > 0) && !hasGroup && <IconButton size="sm" icon={ResizeToFitIcon} label="Resize to fit" shortcut="⌥ ⇧ ⌘ R" onPress={resizeToFit} />}
                            <IconButton size="sm" icon={AutoLayoutIcon} label="Add auto layout" shortcut="⇧ A" onPress={addAutoLayout} />
                        </>
                    ) : undefined
                }
            >
                {flowable && <FlowButtons frames={autoLayout ? frames : nodes} />}
                {allText && <TextResizeRow nodes={nodes} />}
                <div className={ROW}>
                    <div className="flex min-w-0 items-center">
                        <Bindable nodes={nodes} field="w" label="width">
                            <NumberField label="W" min={1} {...w} trailing={<SizingMenu nodes={nodes} axis="h" onLimits={() => setLimitsOpen(true)} />} />
                        </Bindable>
                        {key("w")}
                    </div>
                    <div className="relative flex min-w-0 items-center">
                        {locked && !hasGroup && <span aria-hidden="true" className="absolute top-1/2 -left-[9px] h-2 w-[10px] -translate-y-1/2 bg-field" />}
                        <Bindable nodes={nodes} field="h" label="height">
                            <NumberField label="H" min={1} {...h} trailing={<SizingMenu nodes={nodes} axis="v" onLimits={() => setLimitsOpen(true)} />} />
                        </Bindable>
                        {key("h")}
                    </div>
                    {!hasGroup ? (
                        <IconButton size="sm" icon={AspectIcon} label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"} active={locked} onPress={() => updateAll(nodes, (n) => ({ lockAspect: !locked, targetAspectRatio: locked ? null : { w: n.w, h: n.h } }))} />
                    ) : (
                        <span />
                    )}
                </div>
                {allText && nodes.some((n) => n.pathId) && (
                    <div className={PAIR}>
                        <NumberField label="Start" title="Where along the path the text starts" suffix="%" min={0} max={100} value={shared(nodes, (n) => Math.round((n.textPathStart ?? 0) * 100))} onCommit={(v) => updateAll(nodes, () => ({ textPathStart: Math.max(0, Math.min(1, v / 100)) }))} />
                    </div>
                )}
                {!hasGroup && hasLimits(nodes) && !limitsOpen && (
                    <button type="button" onClick={() => setLimitsOpen(true)} className="flex h-6 items-center gap-1 text-ink-muted hover:text-ink">
                        Min and max limits set. Show
                    </button>
                )}
                {!hasGroup && limitsOpen && <LimitFields nodes={nodes} />}
                {!hasGroup && (nodes.some((n) => n.parentId && doc.nodes[n.parentId]?.layout) || nodes.some((n) => n.layout)) && <LayoutChildOptions nodes={nodes} />}
                <GridChildControls nodes={nodes} />
                {autoLayout && <AutoLayoutControls frames={frames} />}
                {allFrames && !allSections && (
                    <AriaCheckbox
                        isSelected={frames.every((node) => node.clip)}
                        onChange={(clip) => updateAll(nodes, () => ({ clip }))}
                        className="group flex h-6 cursor-default items-center gap-2 outline-none"
                    >
                        <span className="flex size-4 items-center justify-center rounded-[3px] border border-ink-subtle group-data-[selected]:border-brand-500 group-data-[selected]:bg-brand-500">
                            <svg viewBox="0 0 12 12" className="hidden size-3 group-data-[selected]:block" aria-hidden="true">
                                <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </span>
                        Clip content
                    </AriaCheckbox>
                )}
            </Section>

            <Section
                title="Appearance"
                action={
                    draw ? undefined :
                    <div className="group/vis flex items-center gap-1">
                        {nodes.length === 1 && nodes[0] && <PropBinding node={nodes[0]} field="visible" />}
                        {allFrames && <VariableModeButton frames={frames} />}
                        <span className={nodes.some((n) => n.boundVariables?.visible) ? "" : "hidden group-hover/vis:inline-flex"}>
                            <VarButton nodes={nodes} field="visible" label="Apply variable to visibility" />
                        </span>
                        <IconButton
                            size="sm"
                            icon={visible ? Eye : EyeOff}
                            label={visible ? "Hide" : "Show"}
                            onPress={() => updateAll(nodes, () => ({ visible: !visible }))}
                        />
                        <LayerBlendButton nodes={nodes} />
                    </div>
                }
            >
                {draw && (
                    // Draw mode: opacity as a field and a slider with the eye, then the blend mode.
                    <>
                        <div className="grid h-6 grid-cols-[66px_minmax(0,1fr)_24px] items-center gap-2">
                            <NumberField label="◐" icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><OpacityMark /></svg>} title="Opacity" unit="%" min={0} max={100} {...opacity} />
                            <input
                                type="range"
                                min={0}
                                max={100}
                                aria-label="Opacity"
                                value={typeof opacity.value === "number" ? opacity.value : 100}
                                // A drag previews and commits once, as one undo step.
                                onChange={(e) => opacity.onScrub(Number(e.target.value))}
                                onPointerUp={(e) => opacity.onScrubEnd(Number(e.currentTarget.value))}
                                onKeyUp={(e) => opacity.onScrubEnd(Number(e.currentTarget.value))}
                                className="glass-slider w-full"
                                style={{ "--fill": `${typeof opacity.value === "number" ? opacity.value : 100}%` } as React.CSSProperties}
                            />
                            <IconButton size="sm" icon={visible ? Eye : EyeOff} label={visible ? "Hide" : "Show"} onPress={() => updateAll(nodes, () => ({ visible: !visible }))} />
                        </div>
                        <div className="w-[184px]">
                            <BlendSelect
                                passThrough
                                value={nodes.every((n) => (n.blendMode ?? "normal") === (nodes[0]?.blendMode ?? "normal")) ? (nodes[0]?.blendMode ?? "normal") : null}
                                onChange={(blendMode) => updateAll(nodes, () => ({ blendMode }))}
                            />
                        </div>
                    </>
                )}
                {!draw && <div className={ROW}>
                    <div className="flex min-w-0 items-center"><Bindable nodes={nodes} field="opacity" label="opacity"><NumberField label="◐" icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><OpacityMark /></svg>} title="Opacity" unit="%" min={0} max={100} {...opacity} /></Bindable>{key("opacity")}</div>
                    {!allText && !hasGroup && !allSlices && !nodes.some((n) => n.type === "boolean") ? (
                        <div className="flex min-w-0 items-center">
                            <Bindable nodes={nodes} field="radius" label="corner radius"><NumberField label="◜" icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M3.5 13V8a4.5 4.5 0 0 1 4.5-4.5h5" strokeLinecap="round" /></svg>} title="Corner radius" min={0} {...radius} /></Bindable>
                            {key("radius")}
                        </div>
                    ) : (
                        <span />
                    )}
                    {!allText && !hasGroup && !allSlices && nodes.every((n) => n.type === "rect" || isFrameLike(n)) ? <CornerPopover nodes={nodes} /> : nodes.every((n) => n.type === "ellipse") ? <ArcPopover nodes={nodes} /> : <span />}
                </div>}
                {nodes.every((n) => n.parametric) && <ShapeParams nodes={nodes} />}
                {allSections && (
                    <label className="flex h-6 items-center justify-between">
                        <span className="text-ink-muted">Hide contents</span>
                        <input type="checkbox" checked={frames.every((n) => n.sectionContentsHidden)} onChange={(e) => updateAll(nodes, () => ({ sectionContentsHidden: e.target.checked }))} className="accent-brand-500" />
                    </label>
                )}
                {nodes.every((n) => n.type === "instance") && nodes.some((n) => (n.scaleFactor ?? 1) !== 1) && (
                    <div className={PAIR}>
                        <NumberField label="Scale" title="Scale factor of the instance" suffix="%" min={1} max={10000} value={shared(nodes, (n) => Math.round((n.scaleFactor ?? 1) * 100))} onCommit={(v) => editor.execute({ type: "batch", commands: nodes.map((n) => scaleInstanceCommand(n, v / 100)) })} />
                    </div>
                )}
                {nodes.length === 1 && nodes[0]?.detachedInfo && <DetachedRow node={nodes[0]} />}
                {nodes.some((n) => n.isMask) && (
                    <Select aria-label="Mask type" value={shared(nodes, (n) => n.maskType ?? "alpha") ?? "alpha"} onChange={(e) => updateAll(nodes, () => ({ maskType: e.target.value as SceneNode["maskType"] }))} className="h-6 w-full rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500">
                        <option value="alpha">Mask: alpha</option>
                        <option value="vector">Mask: vector (outline)</option>
                        <option value="luminance">Mask: luminance</option>
                    </Select>
                )}
            </Section>

            {allText && <TypographySection nodes={nodes} />}

            {/* A group's Fill and Stroke read and write the layers inside it (Mixed until replaced). */}
            <PaintList nodes={paintNodes} paintKey="fills" title="Fill" large={draw} />

            <PaintList nodes={paintNodes} paintKey="strokes" title="Stroke" large={draw}>
                {draw ? <DrawStrokeControls nodes={paintNodes} advanced={<AdvancedStroke nodes={paintNodes} trigger="sliders" />} /> : <StrokeControls nodes={paintNodes} />}
            </PaintList>

            <TransformsSection nodes={nodes} draw={draw} />

            {/* Groups take effects too: shadows and blurs apply to everything inside them. */}
            <EffectsSection key={nodes.map((n) => n.id).join()} nodes={nodes} />

            {/* Selection colors sit under Effects, as in the reference's panel. */}
            {nodes.some((n) => n.children.length > 0) && <SelectionColors nodes={nodes} />}

            {allFrames && !allSections && !nodes.some((n) => n.isSlice) && (
                <section className={SECTION}>
                    <LayoutGuideSection frames={frames} strong panel />
                </section>
            )}

            <ExportSection nodes={nodes} />
        </>
    );
}

// Text resizing lives in Layout, like the reference: auto width, auto height or a fixed box, as
// three icon segments (184 wide). Truncation is in Type settings.
function TextResizeRow({ nodes }: { nodes: SceneNode[] }) {
    const resize = shared(nodes, (node) => (node.sizing.h === "hug" ? "width" : node.sizing.v === "hug" ? "height" : "fixed"));
    const options: { id: "width" | "height" | "fixed"; label: string; path: string }[] = [
        { id: "width", label: "Auto width", path: "M3 4v8M5.5 8h7.5M10.5 5.5 13 8l-2.5 2.5" },
        { id: "height", label: "Auto height", path: "M4 3.5v9M12 3.5v9M6.5 6h3M6.5 8h3M6.5 10h3" },
        { id: "fixed", label: "Fixed size", path: "M3.5 3.5h9v9h-9zM6 6.5h4M6 9.5h4" },
    ];
    return (
        <div className={ROW}>
            <div className="col-span-2 grid h-6 grid-cols-3 rounded-md bg-field" role="radiogroup" aria-label="Resizing">
                {options.map((o) => (
                    <button
                        key={o.id}
                        type="button"
                        role="radio"
                        title={o.label}
                        aria-label={o.label}
                        aria-checked={resize === o.id}
                        onClick={() => updateAll(nodes, () => ({ sizing: o.id === "width" ? { h: "hug", v: "hug" } : o.id === "height" ? { h: "fixed", v: "hug" } : { h: "fixed", v: "fixed" } }))}
                        className={`flex h-6 items-center justify-center rounded-md border ${resize === o.id ? "border-panel-border bg-panel text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                    >
                        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d={o.path} />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    );
}

// Which way each layer follows its frame when the frame is resized. The diagram's lines toggle pins,
// as in other design tools; the menus offer every option.
function ConstraintsBody({ nodes }: { nodes: SceneNode[] }) {
    const h = shared(nodes, (node) => (node.constraints ?? DEFAULT_CONSTRAINTS).h);
    const v = shared(nodes, (node) => (node.constraints ?? DEFAULT_CONSTRAINTS).v);
    const setH = (value: Constraints["h"]) => updateAll(nodes, (node) => ({ constraints: { ...(node.constraints ?? DEFAULT_CONSTRAINTS), h: value } }));
    const setV = (value: Constraints["v"]) => updateAll(nodes, (node) => ({ constraints: { ...(node.constraints ?? DEFAULT_CONSTRAINTS), v: value } }));
    // Clicking a side pins it; clicking the opposite side too pins both; clicking again unpins.
    const toggleH = (side: "left" | "right") => {
        const has = (x: string | null) => x === side || x === "left-right";
        const other = side === "left" ? "right" : "left";
        const hasOther = h === other || h === "left-right";
        if (has(h)) setH(hasOther ? other : "center");
        else setH(hasOther ? "left-right" : side);
    };
    const toggleV = (side: "top" | "bottom") => {
        const has = (x: string | null) => x === side || x === "top-bottom";
        const other = side === "top" ? "bottom" : "top";
        const hasOther = v === other || v === "top-bottom";
        if (has(v)) setV(hasOther ? other : "center");
        else setV(hasOther ? "top-bottom" : side);
    };
    const on = (active: boolean) => (active ? "bg-brand-500" : "bg-ink-subtle/50 group-hover:bg-ink-muted");
    const select = "h-6 w-full min-w-0 rounded-md border border-panel-border bg-transparent px-2 text-ink outline-none hover:border-ink-subtle focus:border-brand-500";
    // The reference's block: the two constraint menus stacked (88 wide) beside the 88×56 diagram.
    return (
        <div className="grid grid-flow-col grid-cols-[88px_88px] grid-rows-[24px_24px] gap-2">
                    <Select
                        aria-label="Horizontal constraint"
                        value={h ?? ""}
                        onChange={(e) => setH(e.target.value as Constraints["h"])}
                        className={select}
                    >
                        {h === null && <option value="">Mixed</option>}
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="left-right">Left and right</option>
                        <option value="center">Center</option>
                        <option value="scale">Scale</option>
                    </Select>
                    <Select
                        aria-label="Vertical constraint"
                        value={v ?? ""}
                        onChange={(e) => setV(e.target.value as Constraints["v"])}
                        className={select}
                    >
                        {v === null && <option value="">Mixed</option>}
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                        <option value="top-bottom">Top and bottom</option>
                        <option value="center">Center</option>
                        <option value="scale">Scale</option>
                    </Select>
                <div className="relative row-span-2 h-14 w-[88px] rounded-md bg-field">
                    <div className="absolute inset-x-[26px] inset-y-[16px] rounded-sm border border-ink-subtle/60" />
                    <button
                        type="button"
                        aria-label="Pin top"
                        onClick={() => toggleV("top")}
                        className="group absolute top-1 left-1/2 flex h-4 w-5 -translate-x-1/2 justify-center"
                    >
                        <span className={`h-3 w-0.5 rounded ${on(v === "top" || v === "top-bottom")}`} />
                    </button>
                    <button
                        type="button"
                        aria-label="Pin bottom"
                        onClick={() => toggleV("bottom")}
                        className="group absolute bottom-1 left-1/2 flex h-4 w-5 -translate-x-1/2 items-end justify-center"
                    >
                        <span className={`h-3 w-0.5 rounded ${on(v === "bottom" || v === "top-bottom")}`} />
                    </button>
                    <button
                        type="button"
                        aria-label="Pin left"
                        onClick={() => toggleH("left")}
                        className="group absolute top-1/2 left-1 flex h-5 w-4 -translate-y-1/2 items-center"
                    >
                        <span className={`h-0.5 w-3 rounded ${on(h === "left" || h === "left-right")}`} />
                    </button>
                    <button
                        type="button"
                        aria-label="Pin right"
                        onClick={() => toggleH("right")}
                        className="group absolute top-1/2 right-1 flex h-5 w-4 -translate-y-1/2 items-center justify-end"
                    >
                        <span className={`h-0.5 w-3 rounded ${on(h === "right" || h === "left-right")}`} />
                    </button>
                    <button
                        type="button"
                        aria-label="Centre horizontally"
                        onClick={() => setH("center")}
                        className="group absolute top-1/2 left-1/2 flex h-3 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    >
                        <span className={`h-0.5 w-3 rounded ${on(h === "center")}`} />
                    </button>
                    <button
                        type="button"
                        aria-label="Centre vertically"
                        onClick={() => setV("center")}
                        className="group absolute top-1/2 left-1/2 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 justify-center"
                    >
                        <span className={`h-3 w-0.5 rounded ${on(v === "center")}`} />
                    </button>
                </div>
        </div>
    );
}

// Vector edit mode: the selected points' alignment, position and handle mirroring, then the layer's paints.
function VectorPointsPanel() {
    const doc = useEditor((s) => s.doc);
    const id = useEditor((s) => s.editingVectorId);
    const vertices = useEditor((s) => s.vertices);
    const mirror = useEditor((s) => s.handleMirror);
    const node = id ? doc.nodes[id] : undefined;
    if (!node) return null;
    const anchors = vertices.filter((v) => v.part === "anchor");
    const single = anchors.length === 1 ? anchors[0] : undefined;
    const at = single ? vertexPosition(node, single) : null;
    const origin = parentOrigin(doc, node);
    const setPos = (axis: "x" | "y", value: number) => {
        if (!single || !at) return;
        const to = axis === "x" ? { x: value + origin.x, y: at.y } : { x: at.x, y: value + origin.y };
        editor.execute({ type: "node.update", id: node.id, patch: setVertexPosition(node, single, to) });
    };
    const mirrors: { id: HandleMirror; label: string }[] = [
        { id: "none", label: "No mirroring" },
        { id: "angle", label: "Mirror angle" },
        { id: "both", label: "Mirror angle and length" },
    ];
    const many = anchors.length >= 2;
    return (
        <>
            <Section title="Vector">
                <div className="mb-2 flex items-center gap-0.5">
                    <IconButton size="sm" icon={AlignLeft} label="Align points left" disabled={!many} onPress={() => alignSelectedVertices("left")} />
                    <IconButton size="sm" icon={AlignHorizontalCentre01} label="Align points horizontal centres" disabled={!many} onPress={() => alignSelectedVertices("hcenter")} />
                    <IconButton size="sm" icon={AlignRight} label="Align points right" disabled={!many} onPress={() => alignSelectedVertices("right")} />
                    <span className="mx-1 h-4 w-px bg-panel-border" />
                    <IconButton size="sm" icon={AlignTopArrow01} label="Align points top" disabled={!many} onPress={() => alignSelectedVertices("top")} />
                    <IconButton size="sm" icon={AlignVerticalCenter01} label="Align points vertical centres" disabled={!many} onPress={() => alignSelectedVertices("vcenter")} />
                    <IconButton size="sm" icon={AlignBottom01} label="Align points bottom" disabled={!many} onPress={() => alignSelectedVertices("bottom")} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <NumberField label="X" value={at ? Math.round((at.x - origin.x) * 100) / 100 : null} onCommit={(v) => setPos("x", v)} />
                    <NumberField label="Y" value={at ? Math.round((at.y - origin.y) * 100) / 100 : null} onCommit={(v) => setPos("y", v)} />
                </div>
                <div className="mt-2 flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Handle mirroring">
                    {mirrors.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={mirror === m.id}
                            title={m.label}
                            onClick={() => editor.set({ handleMirror: m.id })}
                            className={`h-6 flex-1 rounded text-[10.5px] ${mirror === m.id ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                        >
                            {m.id === "none" ? "None" : m.id === "angle" ? "Angle" : "Angle + length"}
                        </button>
                    ))}
                </div>
                <WidthPointField node={node} />
                <p className="mt-2 text-ink-subtle">{anchors.length === 0 ? "Click a point, drag or lasso to select. Double-click a point to toggle smooth. ⌘click the outline to add a point." : `${anchors.length} point${anchors.length === 1 ? "" : "s"} selected`}</p>
            </Section>
            <SelectionPanel nodes={[node]} />
        </>
    );
}


// Frame header: the frame's type is a dropdown of size presets, like a design tool's "Frame ▾".
// The selection header's layer type menu, like the reference's: convert a frame, group or section into one
// of the others, and (frames) pick a device or paper size.
function LayerTypeMenu({ node }: { node: SceneNode }) {
    const kind = layerKindOf(node);
    const current = kind === "frame" ? FRAME_PRESETS.flatMap((g) => g.items).find((p) => p.w === node.w && p.h === node.h) : undefined;
    const label = isImageLayer(node) ? "Image" : current ? current.name : kind === "section" ? "Section" : kind === "group" ? "Group" : TYPE_LABELS[node.type];
    const kinds: { id: LayerKind; label: string }[] = [
        { id: "frame", label: "Frame" },
        { id: "group", label: "Group" },
        { id: "section", label: "Section" },
    ];
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Layer type" className="flex h-6 items-center gap-1 rounded-md px-1 -ml-1 font-semibold outline-none hover:bg-panel-hover">
                {label}
                <ChevronDown className="size-3 text-ink-subtle mr-1" />
            </AriaButton>
            <AriaPopover placement="bottom start" className="max-h-[70vh] w-56 overflow-y-auto rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    className="outline-none"
                    onAction={(key) => {
                        const k = String(key);
                        if (k.startsWith("kind:")) return convertLayer(node.id, k.slice(5) as LayerKind);
                        const [w, h] = k.split("x").map(Number);
                        if (w && h) editor.execute({ type: "node.update", id: node.id, patch: { w, h, sizing: { h: "fixed", v: "fixed" } } });
                    }}
                >
                    <AriaSection className="mb-1">
                        <AriaCollection items={kinds.map((k) => ({ ...k, key: `kind:${k.id}` }))}>
                            {(k) => <MenuRow id={k.key} label={k.label} checked={k.id === kind} />}
                        </AriaCollection>
                    </AriaSection>
                    {kind === "frame" &&
                        FRAME_PRESETS.map((g) => (
                            <AriaSection key={g.group} className="mb-1 border-t border-white/10 pt-1">
                                <AriaHeader className="px-2 py-1 text-[10px] font-semibold text-white/50">{g.group}</AriaHeader>
                                <AriaCollection items={g.items.map((p) => ({ id: `${p.w}x${p.h}`, ...p }))}>
                                    {(p) => <MenuRow id={p.id} label={p.name} shortcut={`${p.w} × ${p.h}`} checked={p.w === node.w && p.h === node.h} />}
                                </AriaCollection>
                            </AriaSection>
                        ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// Stroke ends, corners and dashes.
// Every colour used in the selection and its children, each editable in one place.
export function SelectionColors({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const [expanded, setExpanded] = useState(false);
    const all = nodes.flatMap((n) => subtree(doc, n.id));
    const groups = new Map<string, { color: string; opacity: number; uses: { id: string; key: "fills" | "strokes"; index: number }[]; variableId?: string }>();
    for (const node of all) {
        for (const key of ["fills", "strokes"] as const) {
            node[key].forEach((paint, index) => {
                if (paint.type !== "solid" || !paint.visible) return;
                const variableId = node.boundVariables?.[`${key === "fills" ? "fill" : "stroke"}:${index}`];
                const id = variableId ?? `${paint.color.toUpperCase()}@${Math.round(paint.opacity * 100)}`;
                const g = groups.get(id) ?? { color: paint.color.toUpperCase(), opacity: paint.opacity, uses: [], variableId };
                g.uses.push({ id: node.id, key, index });
                groups.set(id, g);
            });
        }
    }
    if (groups.size < 1) return null;
    const apply = (g: { uses: { id: string; key: "fills" | "strokes"; index: number }[] }, patch: Partial<{ color: string; opacity: number }>) => {
        const byNode = new Map<string, { key: "fills" | "strokes"; index: number }[]>();
        for (const u of g.uses) byNode.set(u.id, [...(byNode.get(u.id) ?? []), u]);
        editor.execute({
            type: "batch",
            commands: [...byNode.entries()].map(([id, uses]) => {
                const node = doc.nodes[id] as SceneNode;
                const out: NodePatch = {};
                for (const key of ["fills", "strokes"] as const) {
                    const hits = uses.filter((u) => u.key === key);
                    if (hits.length) out[key] = node[key].map((p, i) => (hits.some((u) => u.index === i) && p.type === "solid" ? { ...p, ...patch } : p));
                }
                return { type: "node.update" as const, id, patch: out };
            }),
        });
    };
    const list = [...groups.entries()];
    // Many colours fold into the title row as swatches, the way the reference shows them; "+N"
    // (or a swatch) unfolds the rows.
    const folded = list.length > 3 && !expanded;
    return (
        <Section
            title="Selection colors"
            muted={false}
            action={
                folded ? (
                    <button type="button" aria-label="Show all selection colors" onClick={() => setExpanded(true)} className="flex h-6 items-center gap-1.5 rounded-md px-1 outline-none hover:bg-panel-hover">
                        {list.slice(0, 3).map(([id, g]) => (
                            <span key={id} className="size-4 rounded-full border border-black/15" style={{ background: g.color, opacity: g.opacity }} />
                        ))}
                        <span className="text-ink-muted">+{list.length - 3}</span>
                    </button>
                ) : undefined
            }
        >
            {!folded &&
                list.map(([id, g]) => {
                    const bound = g.variableId ? findVariable(doc, g.variableId) : null;
                    return (
                        <div key={id} className="flex items-center" title={`${g.uses.length} use${g.uses.length === 1 ? "" : "s"}`}>
                            <div className="flex h-6 w-[155px] shrink-0 items-center rounded-md border border-transparent bg-field hover:border-panel-border focus-within:border-brand-500">
                                <div className="flex h-full min-w-0 flex-1 items-center gap-[5px] pr-1 pl-[4px]">
                                    <ColorSwatch size={3.5} color={g.color} opacity={g.opacity} label="Selection colour" onChange={(color, opacity) => apply(g, { color, opacity })} />
                                    {bound ? (
                                        <span className="min-w-0 flex-1 truncate" title={`${bound.collection.name} / ${bound.variable.name}`}>{bound.variable.name.split("/").pop()}</span>
                                    ) : (
                                        <input
                                            key={g.color}
                                            aria-label="Hex colour"
                                            defaultValue={g.color.replace("#", "")}
                                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
                                            onBlur={(e) => { const v = e.target.value.replace("#", "").trim(); if (/^[0-9a-f]{6}$/i.test(v)) apply(g, { color: `#${v.toUpperCase()}` }); }}
                                            className="min-w-0 flex-1 bg-transparent uppercase outline-none"
                                        />
                                    )}
                                </div>
                                <span aria-hidden="true" className="h-full w-px shrink-0 bg-panel" />
                                <div className="w-[54px] shrink-0">
                                    <NumberField bare label="" title="Opacity" suffix="%" min={0} max={100} value={Math.round(g.opacity * 100)} onCommit={(v) => apply(g, { opacity: v / 100 })} />
                                </div>
                            </div>
                        </div>
                    );
                })}
        </Section>
    );
}

// Effect styles: apply one, or make one from the current shadow and blur.
const NO_EFFECTS: EffectStyle[] = [];


// Effects: the styles button and the + menu, the style in use, then a row per effect. Adding one
// opens its settings.
function EffectsSection({ nodes }: { nodes: SceneNode[] }) {
    const [open, setOpen] = useState<number | null>(null);
    return (
        <Section
            title="Effects"
            action={
                <>
                    <StyleButton kind="effect" nodes={nodes} label="Effect styles" />
                    <AddEffectButton nodes={nodes} onAdded={setOpen} />
                </>
            }
        >
            {nodes.every((n) => n.effectStyleId && n.effectStyleId === nodes[0]?.effectStyleId) && <EffectStyleRow nodes={nodes} />}
            <EffectsList nodes={nodes} open={open} onOpenChange={setOpen} />
        </Section>
    );
}

function EffectStyleRow({ nodes }: { nodes: SceneNode[] }) {
    const effects = useEditor((s) => stylesOf(s.doc).effects ?? NO_EFFECTS);
    const style = effects.find((e) => e.id === nodes[0]?.effectStyleId);
    if (!style) return null;
    return (
        <div className="flex items-center gap-1">
            <div className="flex h-6 min-w-0 flex-1 items-center rounded-md bg-field px-2">
                <span className="min-w-0 flex-1 truncate">{style.name}</span>
            </div>
            <IconButton size="sm" icon={LinkBroken01} label="Detach effect style" onPress={() => detachEffectStyle(nodes.map((n) => n.id))} />
        </div>
    );
}


// Independent corner radii and corner smoothing.
// Independent corners: the icon by the radius field opens the four corners, smoothing and the iOS preset.
function CornerPopover({ nodes }: { nodes: SceneNode[] }) {
    const independent = nodes.some((n) => n.radii);
    const at = (i: 0 | 1 | 2 | 3) => shared(nodes, (n) => (n.radii ?? [n.radius, n.radius, n.radius, n.radius])[i]);
    const set = (i: 0 | 1 | 2 | 3, v: number) =>
        updateAll(nodes, (n) => {
            const r: [number, number, number, number] = [...(n.radii ?? [n.radius, n.radius, n.radius, n.radius])] as [number, number, number, number];
            r[i] = Math.max(0, v);
            return { radii: r };
        });
    const smoothing = shared(nodes, (n) => Math.round((n.cornerSmoothing ?? 0) * 100));
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Independent corners" className={`flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-panel-hover ${independent ? "text-brand-500" : "text-ink-muted hover:text-ink"}`}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M13 7V5a2 2 0 0 0-2-2H9M3 9v2a2 2 0 0 0 2 2h2M13 9v2a2 2 0 0 1-2 2H9" />
                </svg>
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="w-60 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Corner radius">
                    <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold">Corner radius</span>
                        <button type="button" onClick={() => updateAll(nodes, (n) => ({ radii: independent ? null : [n.radius, n.radius, n.radius, n.radius] }))} className="text-ink-muted hover:text-ink">
                            {independent ? "Use one radius" : "Independent corners"}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                        <Bindable nodes={nodes} field="radius:0" label="top left radius"><NumberField label="◜" title="Top left" min={0} value={at(0)} onCommit={(v) => set(0, v)} /></Bindable>
                        <Bindable nodes={nodes} field="radius:1" label="top right radius"><NumberField label="◝" title="Top right" min={0} value={at(1)} onCommit={(v) => set(1, v)} /></Bindable>
                        <Bindable nodes={nodes} field="radius:3" label="bottom left radius"><NumberField label="◟" title="Bottom left" min={0} value={at(3)} onCommit={(v) => set(3, v)} /></Bindable>
                        <Bindable nodes={nodes} field="radius:2" label="bottom right radius"><NumberField label="◞" title="Bottom right" min={0} value={at(2)} onCommit={(v) => set(2, v)} /></Bindable>
                    </div>
                    <label className="grid grid-cols-[1fr_auto_40px] items-center gap-2">
                        <span className="text-ink-muted">Corner smoothing</span>
                        <input type="range" min={0} max={100} value={smoothing ?? 0} aria-label="Corner smoothing" onChange={(e) => updateAll(nodes, () => ({ cornerSmoothing: Number(e.target.value) / 100 }))} className="h-1 w-16 accent-brand-500" />
                        <span className="text-right font-mono text-[10px] text-ink-subtle">{smoothing ?? "–"}%</span>
                    </label>
                    <button type="button" onClick={() => updateAll(nodes, () => ({ cornerSmoothing: 0.6 }))} className="h-6 rounded-md border border-panel-border px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                        iOS (60%)
                    </button>
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// An instance's scale factor: the instance and everything in it resized about its top-left, the
// way the Scale tool does it, with the factor remembered for the field.
function scaleInstanceCommand(node: SceneNode, factor: number): Command {
    const doc = editor.get().doc;
    const k = factor / (node.scaleFactor ?? 1);
    const commands: Command[] = [{ type: "node.update", id: node.id, patch: { scaleFactor: factor, w: Math.max(1, node.w * k), h: Math.max(1, node.h * k) } }];
    const visit = (id: string) => {
        const child = doc.nodes[id];
        if (!child) return;
        commands.push({ type: "node.update", id, patch: { x: node.x + (child.x - node.x) * k, y: node.y + (child.y - node.y) * k, w: Math.max(1, child.w * k), h: Math.max(1, child.h * k), ...(child.type === "text" && child.fontSize ? { fontSize: child.fontSize * k } : {}), strokeWidth: child.strokeWidth * k, radius: child.radius * k } });
        child.children.forEach(visit);
    };
    node.children.forEach(visit);
    return { type: "batch", commands };
}

// A frame that was detached from an instance: where it came from, with a way back to the component.
function DetachedRow({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const main = node.detachedInfo ? doc.nodes[node.detachedInfo.componentId] : undefined;
    return (
        <div className="flex h-6 items-center justify-between gap-2 text-ink-muted">
            <span className="min-w-0 truncate" title={main ? `Detached from ${main.name}` : "Detached from a component that is no longer in this file"}>
                Detached from {main?.name ?? "a removed component"}
            </span>
            {main && (
                <button type="button" onClick={() => editor.set({ selection: [main.id] })} className="shrink-0 hover:text-ink">
                    Go to main
                </button>
            )}
        </div>
    );
}

// Ellipse arcs: start angle, sweep and the inner ratio (a ring), from the trailing button of the
// Appearance row (the reference has no arc row there).
function ArcPopover({ nodes }: { nodes: SceneNode[] }) {
    const arced = nodes.some((n) => n.arc && (n.arc.start !== 0 || n.arc.sweep !== 360 || n.arc.inner !== 0));
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Arc" className={`flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-panel-hover ${arced ? "text-brand-500" : "text-ink-muted hover:text-ink"}`}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                    <path d="M13 8a5 5 0 1 1-5-5" />
                    <path d="M8 8V3M8 8h5" strokeOpacity="0.5" />
                </svg>
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="w-60 rounded-lg border border-panel-border bg-panel-raised p-3 text-ink shadow-xl outline-none">
                <AriaDialog className="space-y-2 outline-none" aria-label="Arc">
                    <span className="text-[12px] font-semibold">Arc</span>
                    <ArcOptions nodes={nodes} />
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function ArcOptions({ nodes }: { nodes: SceneNode[] }) {
    const arcOf = (n: SceneNode) => n.arc ?? { start: 0, sweep: 360, inner: 0 };
    const set = (patch: Partial<{ start: number; sweep: number; inner: number }>) => updateAll(nodes, (n) => ({ arc: { ...arcOf(n), ...patch } }));
    return (
        <div className="grid grid-cols-3 gap-1">
            <NumberField label="Start" suffix="°" value={shared(nodes, (n) => arcOf(n).start)} onCommit={(v) => set({ start: v })} />
            <NumberField label="Sweep" suffix="°" min={-360} max={360} value={shared(nodes, (n) => arcOf(n).sweep)} onCommit={(v) => set({ sweep: v })} />
            <NumberField label="Ratio" suffix="%" min={0} max={99} value={shared(nodes, (n) => Math.round(arcOf(n).inner * 100))} onCommit={(v) => set({ inner: v / 100 })} />
        </div>
    );
}

// Absolute positioning inside auto layout, and min/max limits.
function LayoutChildOptions({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const inStack = nodes.every((node) => node.parentId && doc.nodes[node.parentId]?.layout);
    const absolute = nodes.every((n) => n.positioning === "absolute");
    return (
        <div className="space-y-1">
            {inStack && (
                <label className="flex h-6 items-center justify-between">
                    <span className="text-ink-muted">Ignore auto layout</span>
                    <input type="checkbox" checked={absolute} onChange={(e) => updateAll(nodes, () => ({ positioning: e.target.checked ? "absolute" : "auto" }))} className="accent-brand-500" />
                </label>
            )}
        </div>
    );
}


// Whether any layer carries a min or max limit.
function hasLimits(nodes: SceneNode[]): boolean {
    return nodes.some((n) => n.minW != null || n.maxW != null || n.minH != null || n.maxH != null);
}

// One button of a joined group (rotate and flip), with the panel's tooltip.
function JoinedButton({ icon: Icon, label, shortcut, onPress }: { icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string; shortcut?: string; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton aria-label={label} onPress={onPress} className={JOINED_BUTTON}>
                <Icon className="size-3.5" />
            </AriaButton>
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// Panel glyphs drawn for Nagma: rotation angle, a quarter turn, constraints, auto layout, resize to
// fit and the aspect-ratio lock.
function RotationIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" {...props}>
            <path d="M3.5 3.5v9h9" />
            <path d="M3.5 7.5a5 5 0 0 1 5 5" />
        </svg>
    );
}

function Rotate90Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M8 6.5 11 9.5 8 12.5 5 9.5z" />
            <path d="M4.5 5.5A5 5 0 0 1 11.5 4" />
            <path d="M11.8 2v2.2H9.6" />
        </svg>
    );
}

function ConstraintsIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeOpacity="0.5" />
            <path d="M6 5h4M8 5v6" />
        </svg>
    );
}

function AutoLayoutIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true" {...props}>
            <rect x="2.5" y="2.5" width="4" height="11" rx="1" />
            <rect x="9.5" y="2.5" width="4" height="5" rx="1" />
            <path d="M11.5 9.5v4M9.5 11.5h4" strokeLinecap="round" />
        </svg>
    );
}

function ResizeToFitIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M2.5 2.5 6 6M6 3.5V6H3.5M13.5 2.5 10 6M10 3.5V6h2.5M2.5 13.5 6 10M6 12.5V10H3.5M13.5 13.5 10 10M10 12.5V10h2.5" />
        </svg>
    );
}

function AspectIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M5.5 8V5.5H8M10.5 8v2.5H8" />
        </svg>
    );
}

const CODE_LANGS: { id: BuiltinLang; label: string }[] = [
    { id: "css", label: "Copy as CSS" },
    { id: "tailwind", label: "Copy as Tailwind" },
    { id: "swiftui", label: "Copy as iOS (SwiftUI)" },
    { id: "compose", label: "Copy as Android (Compose)" },
];

function CopyCodeMenu() {
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Copy as code" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                <Code02 className="size-4" />
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu aria-label="Copy as code" className="outline-none" onAction={(k) => void copyAsCode(String(k) as BuiltinLang)}>
                    {CODE_LANGS.map((l) => (
                        <MenuRow key={l.id} id={l.id} label={l.label} />
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// `describe`: a component set, whose description is edited here (in a popover under More) rather
// than in its Properties block.
function HeaderMoreMenu({ ids, canMark, describe }: { ids: string[]; canMark: boolean; describe?: SceneNode }) {
    const button = useRef<HTMLButtonElement>(null);
    const [describing, setDescribing] = useState(false);
    return (
        <>
            <AriaMenuTrigger>
                <AriaButton ref={button} aria-label="More actions" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                    <DotsHorizontal className="size-4" />
                </AriaButton>
                <AriaPopover placement="bottom end" className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        aria-label="More actions"
                        className="outline-none"
                        disabledKeys={canMark ? [] : ["ready"]}
                        onAction={(k) => {
                            const key = String(k);
                            if (key === "ready") setDevStatus(ids, "ready");
                            else if (key === "describe") setDescribing(true);
                            else void copyAsCode(key as BuiltinLang);
                        }}
                    >
                        {describe && <MenuRow id="describe" label={describe.description || describe.descriptionMarkdown ? "Edit description…" : "Add description…"} />}
                        <MenuRow id="ready" label="Mark as ready for dev" />
                        {CODE_LANGS.map((l) => (
                            <MenuRow key={l.id} id={l.id} label={l.label} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            {describe && (
                <AriaPopover triggerRef={button} isOpen={describing} onOpenChange={setDescribing} placement="bottom end" offset={6} className="w-[240px] rounded-lg border border-panel-border bg-panel p-2 text-[11px] text-ink shadow-xl outline-none">
                    <AriaDialog aria-label="Description" className="outline-none">
                        <DescriptionEditor node={describe} />
                    </AriaDialog>
                </AriaPopover>
            )}
        </>
    );
}

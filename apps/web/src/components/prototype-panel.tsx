import { File04, Link01, Minus, Play, Plus, XClose } from "@untitledui/icons";
import { FlowDescription } from "./flow-description";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { startPresenting, zoomToSelection } from "../engine/camera";
import { CATEGORY_LABELS, DEVICES, deviceById, matchingDevice, rotates } from "../engine/devices";
import { actionsOf, screenOf, screens } from "../engine/prototype";
import { copyFlowLink, flowLabel, flowsOf, nextFlowName } from "../engine/prototype-flows";
import { editor, useEditor } from "../engine/store";
import type { ImagePaint, Interaction, NagmaDocument, PrototypeAction, PrototypeSettings, SceneNode, Trigger } from "../engine/types";
import { ColorSwatch } from "./color-picker";
import { IconButton } from "./icon-button";
import { menuKey, shortActionLabel, shortTriggerLabel } from "../engine/interaction-text";
import { openInteractionAt } from "../canvas/prototype-connections";
import { closeInteraction, useProtoUi } from "../engine/prototype-ui";
import { InteractionWindow } from "./interaction-editor";
import { ActionIcon, Pick } from "./proto-controls";
import { NumberField } from "./number-field";
import { Select } from "./select";

const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children?: React.ReactNode }) {
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <h3 className="font-semibold">{title}</h3>
                {action}
            </div>
            {children && <div className="mt-1.5 space-y-1.5">{children}</div>}
        </section>
    );
}

function setInteractions(node: SceneNode, interactions: Interaction[]) {
    editor.execute({ type: "node.update", id: node.id, patch: { interactions } });
}

// The main component's version of a layer inside (or being) an instance, whose interactions it inherits.
function inheritedFrom(doc: NagmaDocument, node: SceneNode): SceneNode | null {
    if (node.sourceId) return doc.nodes[node.sourceId] ?? null;
    if (node.type === "instance" && node.componentId) return doc.nodes[node.componentId] ?? null;
    return null;
}

const NEXT_TRIGGERS: Trigger[] = ["click", "drag", "hover", "press", "mouse-enter", "mouse-leave", "mouse-down", "mouse-up", "delay", "key"];

// The icon for an interaction row: its first action, or a list mark for several.
function rowIcon(it: Interaction): string {
    const actions = actionsOf(it);
    if (actions.length === 0) return "none";
    if (actions.length > 1) return actions.some((a) => a.type === "conditional") ? "conditional" : "navigate";
    return menuKey(actions[0] as PrototypeAction);
}

// The Prototype tab, like the reference's: flow starting point, interactions and scroll behaviour for a
// selection (with prototype settings a click away); device, background and flows with nothing
// selected; then tips until they are dismissed.
// Prototype › Build as app: the selected frames (or every frame on the page) go to a new app file
// as its starting point, pictured and described for the app builder.
async function buildAsApp() {
    const s = editor.get();
    const picked = s.selection.map((id) => (s.doc.nodes[id] ? screenOf(s.doc, s.doc.nodes[id])?.id : undefined)).filter((id): id is string => Boolean(id));
    const ids = [...new Set(picked.length ? picked : screens(s.doc).map((n) => n.id))];
    if (!ids.length) return editor.notify("Add a frame to build it as an app.");
    const doc = s.doc;
    const name = doc.name || "Untitled";
    const [{ createFile, openFile }, { attachFrames }] = await Promise.all([import("../engine/files"), import("../make/generate")]);
    await openFile(createFile("make", undefined, `${name} app`).id);
    await attachFrames(doc, ids, name);
}

export function PrototypePanel() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const editing = useProtoUi((s) => s.editing);
    const node = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;
    const isScreen = Boolean(node && screenOf(doc, node)?.id === node.id && !node.isSection);
    const flows = flowsOf(doc);
    const source = node ? inheritedFrom(doc, node) : null;
    const overridden = Boolean(node?.overrides?.includes("interactions"));
    const videoFill = node?.fills.find((p): p is ImagePaint => p.type === "image" && Boolean(p.video));

    // Leaving the tab closes the Interaction window.
    useEffect(() => () => closeInteraction(), []);

    return (
        <>
            {/* The design's frames as a starting point for an app in a new Make file. */}
            <div className="border-b border-section-rule py-[13px] pr-2 pl-4">
                <AriaButton onPress={() => void buildAsApp()} className="flex h-8 w-full items-center justify-center rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                    Build as app
                </AriaButton>
            </div>
            {node && isScreen && <FlowStartSection node={node} />}
            {node ? (
                <Section
                    title="Interactions"
                    action={
                        <IconButton
                            size="sm"
                            icon={Plus}
                            label="Add interaction"
                            onPress={() => {
                                const used = new Set((node.interactions ?? []).map((it) => it.trigger));
                                // A new interaction takes the next free trigger and no action yet, and opens.
                                const next: Interaction = { trigger: NEXT_TRIGGERS.find((t) => !used.has(t)) ?? "click", delay: 800, actions: [] };
                                const index = (node.interactions ?? []).length;
                                setInteractions(node, [...(node.interactions ?? []), next]);
                                openInteractionAt(node.id, index, document.activeElement);
                            }}
                        />
                    }
                >
                    {source && (node.interactions ?? []).length > 0 && (
                        <div className="flex h-6 items-center justify-between text-ink-subtle">
                            <span>{overridden ? "Changed on this instance" : "From the main component"}</span>
                            {overridden && (
                                <button
                                    type="button"
                                    className="rounded px-1 hover:bg-panel-hover hover:text-ink"
                                    onClick={() => editor.execute({ type: "node.update", id: node.id, patch: { overrides: (node.overrides ?? []).filter((k) => k !== "interactions"), interactions: source.interactions } })}
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                    )}
                    {node.interactions?.map((interaction, index) => {
                        const open = editing?.node === node.id && editing.interaction === index;
                        return (
                            <div key={index} data-interaction-row="" className={`group flex h-6 items-center rounded-md ${open ? "bg-panel-hover" : "hover:bg-panel-hover"}`}>
                                <AriaButton
                                    aria-label={`${shortTriggerLabel(interaction)}, ${shortActionLabel(doc, interaction)}`}
                                    onPress={(e) => openInteractionAt(node.id, index, e.target as Element)}
                                    className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
                                >
                                    <span className="w-[72px] shrink-0 truncate">{shortTriggerLabel(interaction)}</span>
                                    <ActionIcon kind={rowIcon(interaction)} className="size-3.5 shrink-0 text-ink-muted" />
                                    <span className="min-w-0 flex-1 truncate">{shortActionLabel(doc, interaction)}</span>
                                </AriaButton>
                                <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                                    <IconButton
                                        size="sm"
                                        icon={Minus}
                                        label="Remove interaction"
                                        onPress={() => {
                                            if (open) closeInteraction();
                                            setInteractions(node, (node.interactions ?? []).filter((_, i) => i !== index));
                                        }}
                                    />
                                </span>
                            </div>
                        );
                    })}
                </Section>
            ) : (
                <>
                    <DeviceSection />
                    <FlowsSection flows={flows} />
                </>
            )}
            {node && videoFill?.video && <VideoSection node={node} paint={videoFill} />}
            {node && !node.isSection && (node.type === "frame" || !isScreen) && (
                <Section title="Scroll behavior">
                    {!isScreen && (
                        <PanelRow label="Position">
                            <Pick
                                label="Scroll position"
                                value={node.scrollPosition ?? "parent"}
                                groups={[
                                    [
                                        { id: "parent", label: "Scroll with parent" },
                                        // Inside auto layout, only absolutely positioned layers can stay fixed.
                                        { id: "fixed", label: "Fixed", disabled: Boolean(doc.nodes[node.parentId ?? ""]?.layout) && node.positioning !== "absolute" },
                                        { id: "sticky", label: "Sticky" },
                                    ],
                                ]}
                                onChange={(v) => editor.execute({ type: "node.update", id: node.id, patch: { scrollPosition: v as SceneNode["scrollPosition"] } })}
                            />
                        </PanelRow>
                    )}
                    {node.type === "frame" && (
                        <PanelRow label="Overflow">
                            <Pick
                                label="Overflow scrolling"
                                value={node.overflow ?? "none"}
                                groups={[
                                    [
                                        { id: "none", label: "No scrolling" },
                                        { id: "vertical", label: "Vertical" },
                                        { id: "horizontal", label: "Horizontal" },
                                        { id: "both", label: "Both directions" },
                                    ],
                                ]}
                                onChange={(v) => editor.execute({ type: "node.update", id: node.id, patch: { overflow: v as SceneNode["overflow"] } })}
                            />
                        </PanelRow>
                    )}
                    {node.type === "frame" && node.overflow && node.overflow !== "none" && !contentOverflows(doc, node) && (
                        <p className="flex gap-1.5 text-[11px] leading-snug text-amber-500" role="note">
                            <span aria-hidden="true">!</span>
                            For scrolling to work, the content needs to be bigger than the frame.
                        </p>
                    )}
                </Section>
            )}
            {node && <PrototypeSettingsButton />}
            <Tips />
            <InteractionWindow />
        </>
    );
}

// Whether a frame's content reaches past its edges in the direction it scrolls.
function contentOverflows(doc: NagmaDocument, frame: SceneNode): boolean {
    let right = 0;
    let bottom = 0;
    for (const id of frame.children) {
        const c = doc.nodes[id];
        if (!c?.visible) continue;
        right = Math.max(right, c.x + c.w - frame.x);
        bottom = Math.max(bottom, c.y + c.h - frame.y);
    }
    const pad = frame.layout?.padding ?? [0, 0, 0, 0];
    const wide = right + pad[1] > frame.w + 0.5;
    const tall = bottom + pad[2] > frame.h + 0.5;
    return frame.overflow === "horizontal" ? wide : frame.overflow === "vertical" ? tall : wide || tall;
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {children}
        </div>
    );
}

// A top-level frame's flow starting point: its name, the frame it starts on and a description.
function FlowStartSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const [describing, setDescribing] = useState(Boolean(node.flowDescription));
    const frames = screens(doc).filter((s) => !s.isSection);
    const moveTo = (id: string) => {
        if (id === node.id) return;
        editor.execute({
            type: "batch",
            commands: [
                { type: "node.update", id: node.id, patch: { flowStart: false, flowName: undefined, flowDescription: undefined } },
                { type: "node.update", id, patch: { flowStart: true, flowName: flowLabel(doc, node), flowDescription: node.flowDescription } },
            ],
        });
        editor.set({ selection: [id] });
    };
    return (
        <Section
            title="Flow starting point"
            action={
                node.flowStart ? (
                    <IconButton size="sm" icon={Minus} label="Remove starting point" onPress={() => editor.execute({ type: "node.update", id: node.id, patch: { flowStart: false } })} />
                ) : (
                    <IconButton size="sm" icon={Plus} label="Add flow starting point" onPress={() => editor.execute({ type: "node.update", id: node.id, patch: { flowStart: true, flowName: node.flowName ?? nextFlowName(doc) } })} />
                )
            }
        >
            {node.flowStart && (
                <>
                    <div className="flex items-center gap-1">
                        <input
                            key={`${node.id}-name`}
                            defaultValue={flowLabel(doc, node)}
                            aria-label="Flow name"
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            onBlur={(e) => e.target.value.trim() && editor.execute({ type: "node.update", id: node.id, patch: { flowName: e.target.value.trim() } })}
                            className={`${field} w-0 flex-1`}
                        />
                        <Pick label="Starting frame" value={node.id} groups={[frames.map((f) => ({ id: f.id, label: f.name, disabled: Boolean(f.flowStart) && f.id !== node.id }))]} onChange={moveTo} className="w-0 flex-1" />
                        <IconButton size="sm" icon={File04} label={describing ? "Hide description" : "Add a description"} active={describing} onPress={() => setDescribing(!describing)} />
                    </div>
                    {describing && (
                        <textarea
                            key={`${node.id}-description`}
                            defaultValue={node.flowDescription ?? ""}
                            aria-label="Flow description"
                            placeholder="Add a description (**bold**, *italic*, links, - lists)"
                            rows={2}
                            onKeyDown={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                                const value = e.target.value.trim();
                                if (value !== (node.flowDescription ?? "")) editor.execute({ type: "node.update", id: node.id, patch: { flowDescription: value || undefined } });
                            }}
                            className="w-full resize-none rounded-md border border-transparent bg-field px-1.5 py-1 leading-snug text-ink outline-none hover:border-panel-border focus:border-brand-500"
                        />
                    )}
                </>
            )}
        </Section>
    );
}

function FlowsSection({ flows }: { flows: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    return (
        <Section title="Flow starting points">
            {flows.length === 0 ? (
                <p className="leading-relaxed text-ink-muted">Select a frame and add a flow starting point, or drag a connection from a frame to start one.</p>
            ) : (
                flows.map((flow) => (
                    <div key={flow.id} className="group rounded-md px-1 hover:bg-panel-hover">
                        <div className="flex h-6 items-center gap-2">
                            <Play className="size-3.5 shrink-0 text-[#4FA3FF]" />
                            <AriaButton
                                aria-label={`Select ${flowLabel(doc, flow)}`}
                                onPress={() => {
                                    editor.set({ selection: [flow.id] });
                                    zoomToSelection();
                                }}
                                className="min-w-0 flex-1 truncate text-left outline-none"
                            >
                                {flowLabel(doc, flow)}
                            </AriaButton>
                            <span className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                                <IconButton size="sm" icon={Link01} label="Copy link to flow" onPress={() => copyFlowLink(flow.id)} />
                                <IconButton size="sm" icon={Play} label="Present flow" onPress={() => startPresenting(flow.id)} />
                            </span>
                        </div>
                        {flow.flowDescription && <FlowDescription text={flow.flowDescription} className="pb-1 pl-[22px] leading-snug text-ink-subtle" linkClass="text-brand-500 underline" />}
                    </div>
                ))
            )}
        </Section>
    );
}

// "Show prototype settings": device, background and flows, in a window beside the panel.
function PrototypeSettingsButton() {
    const doc = useEditor((s) => s.doc);
    const flows = flowsOf(doc);
    return (
        <div className="border-b border-panel-border px-3 py-2.5">
            <AriaDialogTrigger>
                <AriaButton className="flex h-6 w-full items-center justify-center rounded-md border border-panel-border text-ink outline-none hover:bg-panel-hover focus-visible:border-brand-500">Show prototype settings</AriaButton>
                <AriaPopover placement="left top" offset={12} className="outline-none">
                    <AriaDialog aria-label="Prototype settings" className="max-h-[80vh] w-64 overflow-y-auto rounded-lg border border-panel-border bg-panel-raised text-[11px] text-ink shadow-2xl outline-none">
                        <div className="flex h-10 items-center border-b border-panel-border px-3 font-semibold">Prototype settings</div>
                        <DeviceSection />
                        <FlowsSection flows={flows} />
                    </AriaDialog>
                </AriaPopover>
            </AriaDialogTrigger>
        </div>
    );
}

const TIPS: { id: string; title: string; body: string; icon: React.ReactNode }[] = [
    {
        id: "connect",
        title: "Creating a connection",
        body: "Select a frame or object in a frame and use the circular node to drag a connection to another frame.",
        icon: (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2.5" y="6.5" width="6" height="11" rx="1" />
                <rect x="15.5" y="6.5" width="6" height="11" rx="1" />
                <path d="M8.5 12c3 0 3-3 6.5-3" />
                <circle cx="8.5" cy="12" r="1.6" fill="currentColor" />
            </svg>
        ),
    },
    {
        id: "remove",
        title: "Removing a connection",
        body: "To delete a connection, click and drag on either end.",
        icon: (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2.5" y="6.5" width="6" height="11" rx="1" />
                <path d="M8.5 12c3 0 4 3 7 3" strokeDasharray="2 2" />
                <path d="M17 13l3 3M20 13l-3 3" />
            </svg>
        ),
    },
    {
        id: "play",
        title: "Running your prototype",
        body: "Use the play button in the toolbar to play your prototype. If there are no connections, the play button can be used to play a presentation of your frames.",
        icon: (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M8 5.5v13l10-6.5z" />
            </svg>
        ),
    },
];

const TIPS_KEY = "nagma.prototype.tips.dismissed";

function loadDismissed(): string[] {
    try {
        return JSON.parse(localStorage.getItem(TIPS_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}

// Tips on how to prototype, each dismissed for good with its ×.
function Tips() {
    const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
    const shown = TIPS.filter((t) => !dismissed.includes(t.id));
    if (!shown.length) return null;
    const dismiss = (id: string) => {
        const next = [...dismissed, id];
        setDismissed(next);
        try {
            localStorage.setItem(TIPS_KEY, JSON.stringify(next));
        } catch {
            // Not remembered in private windows.
        }
    };
    return (
        <div className="space-y-2 px-3 py-3">
            {shown.map((tip) => (
                <div key={tip.id} className="relative flex gap-2.5 rounded-lg border border-panel-border p-2.5 pr-7">
                    <span className="shrink-0 text-ink-muted">{tip.icon}</span>
                    <div className="min-w-0">
                        <p className="font-semibold">{tip.title}</p>
                        <p className="mt-0.5 leading-snug text-ink-muted">{tip.body}</p>
                    </div>
                    <span className="absolute top-1.5 right-1.5">
                        <IconButton size="sm" icon={XClose} label={`Dismiss tip: ${tip.title}`} onPress={() => dismiss(tip.id)} />
                    </span>
                </div>
            ))}
        </div>
    );
}

// Playback of a video fill in the prototype: autoplay, loop and sound.
function VideoSection({ node, paint }: { node: SceneNode; paint: ImagePaint }) {
    const video = paint.video;
    if (!video) return null;
    const set = (patch: Partial<NonNullable<ImagePaint["video"]>>) =>
        editor.execute({ type: "node.update", id: node.id, patch: { fills: node.fills.map((p) => (p === paint && p.type === "image" && p.video ? { ...p, video: { ...p.video, ...patch } } : p)) } });
    const row = (label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
        <label className={`flex h-6 items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500" />
            <span className="text-ink-muted">{label}</span>
        </label>
    );
    return (
        <Section title="Video">
            {row("Autoplay", video.autoplay !== false, (autoplay) => set({ autoplay }))}
            {row("Loop", video.loop, (loop) => set({ loop }))}
            {row("Sound", !video.muted, (on) => set({ muted: !on }), !video.hasAudio)}
        </Section>
    );
}

const DEFAULT_PROTOTYPE: PrototypeSettings = { scaling: "fit", background: "#111114" };

// Device and background, at the top of the Prototype tab when nothing is selected.
function DeviceSection() {
    const settings = useEditor((s) => s.doc.prototype ?? DEFAULT_PROTOTYPE);
    const set = (patch: Partial<PrototypeSettings>) => editor.execute({ type: "prototype.set", prototype: { ...settings, ...patch } });
    // With no device chosen, a frame made from a device preset picks that device.
    const start = useEditor((s) => flowsOf(s.doc)[0] ?? screens(s.doc)[0]);
    const auto = !settings.device && start ? matchingDevice(start.w, start.h) : null;
    const dev = settings.device ?? (auto ? { id: auto.id } : { id: "none" });
    const setDevice = (patch: Partial<NonNullable<PrototypeSettings["device"]>>) => set({ device: { ...dev, ...patch } });
    const device = deviceById(dev.id);
    return (
        <>
            <Section title="Device">
                <Select
                    aria-label="Device"
                    value={dev.id}
                    onChange={(e) => {
                        const next = deviceById(e.target.value);
                        setDevice({ id: e.target.value, color: next?.colors[0]?.name, landscape: rotates(next) ? dev.landscape : false });
                    }}
                    className={`${field} w-full`}
                >
                    <option value="none">None</option>
                    {CATEGORY_LABELS.map(([cat, label]) => (
                        <optgroup key={cat} label={label}>
                            {DEVICES.filter((d) => d.category === cat).map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                    <option value="custom">Custom size</option>
                </Select>
                {auto && <p className="text-ink-subtle">Matches {start?.name}'s size.</p>}
                {device && device.colors.length > 1 && (
                    <label className="flex items-center gap-2">
                        <span className="w-16 text-ink-muted">Model</span>
                        <Select aria-label="Device colour" value={dev.color ?? device.colors[0]?.name} onChange={(e) => setDevice({ color: e.target.value })} className={`${field} flex-1`}>
                            {device.colors.map((c) => (
                                <option key={c.name} value={c.name}>
                                    {c.name}
                                </option>
                            ))}
                        </Select>
                    </label>
                )}
                {rotates(device) && (
                    <div className="grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5" role="radiogroup" aria-label="Orientation">
                        {[false, true].map((landscape) => (
                            <button
                                key={String(landscape)}
                                type="button"
                                role="radio"
                                aria-checked={Boolean(dev.landscape) === landscape}
                                onClick={() => setDevice({ landscape })}
                                className={`flex h-6 items-center justify-center gap-1.5 rounded ${Boolean(dev.landscape) === landscape ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}
                            >
                                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
                                    {landscape ? <rect x="1" y="3" width="10" height="6" rx="1.2" /> : <rect x="3" y="1" width="6" height="10" rx="1.2" />}
                                </svg>
                                {landscape ? "Landscape" : "Portrait"}
                            </button>
                        ))}
                    </div>
                )}
                {dev.id === "custom" && (
                    <div className="grid grid-cols-2 gap-1">
                        <NumberField label="W" title="Width" min={1} value={dev.width ?? 1280} onCommit={(width) => setDevice({ width })} />
                        <NumberField label="H" title="Height" min={1} value={dev.height ?? 800} onCommit={(height) => setDevice({ height })} />
                    </div>
                )}
                {device && <p className="text-ink-subtle">{dev.landscape && rotates(device) ? `${device.height} × ${device.width}` : `${device.width} × ${device.height}`}</p>}
            </Section>
            <Section title="Background">
                <label className="flex items-center gap-2">
                    <ColorSwatch color={settings.background} label="Prototype background" onChange={(background) => set({ background })} />
                    <span className="text-ink-subtle">{settings.background.replace("#", "").toUpperCase()}</span>
                </label>
            </Section>
            <Section title="Scaling">
                <Select aria-label="Prototype scaling" value={settings.scaling} onChange={(e) => set({ scaling: e.target.value as PrototypeSettings["scaling"] })} className={`${field} w-full`}>
                    <option value="fit">Fit: scale down to fit</option>
                    <option value="width">Fit width</option>
                </Select>
                <p className="text-ink-subtle">How the player shows screens when it opens; viewers can still change it from the options menu.</p>
            </Section>
        </>
    );
}

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Clock, Minus, Plus, Target04, XClose } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { animationStyles, createAnimationStyle, describeTransition, followStyle, updateAnimationStyle } from "../engine/animation-styles";
import { transitionDuration, easeTransition } from "../engine/easing-curves";
import { literal } from "../engine/expressions";
import { ACTION_GROUPS, TRIGGER_GROUPS, actionLabel, animatedLayersOn, actionOfKind, actionSummary, keyLabel, menuKey, triggerLabel, variantsFor, videoLayers } from "../engine/interaction-text";
import { DEFAULT_OVERLAY, DEFAULT_TRANSITION, actionAt, destinations, normalizeInteraction, overlaySettingsFor, screenOf, shareOverlayCommands, subtree, updateActionAt } from "../engine/prototype";
import { anchorPoint } from "../canvas/prototype-connections";
import { type PopoverSide, placePopover } from "../engine/popover-placement";
import { type InteractionEdit, closeInteraction, useProtoUi } from "../engine/prototype-ui";
import { canvasRect } from "./canvas-rect";
import { videosOf } from "../engine/prototype-runtime";
import { editor, useEditor } from "../engine/store";
import type { AnimationOp, Direction, Interaction, NagmaDocument, OverlaySettings, PrototypeAction, SceneNode, Transition, TransitionType, Trigger, TriggerDevice, VariableType, VideoOp } from "../engine/types";
import { collectionsOf, findVariable, resolveTransition } from "../engine/variables";
import { VariablePicker } from "./variable-picker";
import { askText } from "./ask-text";
import { ColorSwatch } from "./color-picker";
import { EasingButton } from "./easing-editor";
import { ExpressionField } from "./expression-field";
import { NumberField } from "./number-field";
import { Select } from "./select";
import { ActionIcon, CheckRow, ExpressionText, KEEP_OPEN, OutlineFields, Pick, type PickOption, Row, TriggerIcon, VariableChip } from "./proto-controls";
import { GamepadWatcher, TRIGGER_DEVICES, gamepadButtons, isController } from "../engine/gamepad";

// The Interaction popover, like the reference's: opened from a prototype connection it sits beside it on the
// canvas with a caret pointing at it, following it as the canvas pans and zooms; it holds the
// trigger and one action as label and value rows. With several actions, or a Conditional, it widens
// into two panes: the trigger and an ordered list of actions (if / else branches indented) on the
// left, and the picked action's settings on the right.

const TRANSITION_GROUPS: [TransitionType, string][][] = [
    [
        ["instant", "Instant"],
        ["dissolve", "Dissolve"],
        ["smart", "Match animate"],
    ],
    [
        ["move-in", "Move in"],
        ["move-out", "Move out"],
        ["push", "Push"],
        ["slide-in", "Slide in"],
        ["slide-out", "Slide out"],
    ],
];

const POSITIONS: [OverlaySettings["position"], string][] = [
    ["center", "Center"],
    ["top-left", "Top left"],
    ["top-center", "Top center"],
    ["top-right", "Top right"],
    ["bottom-left", "Bottom left"],
    ["bottom-center", "Bottom center"],
    ["bottom-right", "Bottom right"],
    ["manual", "Manual"],
];

const DIRECTIONS: [Direction, typeof ArrowLeft, string][] = [
    ["left", ArrowLeft, "Left"],
    ["right", ArrowRight, "Right"],
    ["down", ArrowDown, "Down"],
    ["up", ArrowUp, "Up"],
];

const input = "h-6 w-full min-w-0 rounded-[5px] border border-panel-border bg-transparent px-2 text-ink outline-none hover:border-ink-subtle focus:border-brand-500";

function isDirectional(type: TransitionType) {
    return type === "move-in" || type === "move-out" || type === "push" || type === "slide-in" || type === "slide-out";
}

// ---- Paths into the action tree (see walkActions) ----

// What is picked in the two-pane list: an action, one branch of a conditional (`block` may be one
// past the last, the "else" that doesn't exist yet), or an empty "Add action" row in a list.
type Picked = { kind: "action"; path: number[] } | { kind: "block"; path: number[]; block: number } | { kind: "new"; list: number[] };

function listAt(actions: PrototypeAction[], list: number[]): PrototypeAction[] {
    if (!list.length) return actions;
    const cond = actionAt(actions, list.slice(0, -1));
    return cond?.blocks?.[list[list.length - 1] ?? 0]?.actions ?? [];
}

// Changes one list of actions: the top level, or a conditional's branch (one past the last branch
// adds an "else").
function mapList(actions: PrototypeAction[], list: number[], fn: (list: PrototypeAction[]) => PrototypeAction[]): PrototypeAction[] {
    if (!list.length) return fn(actions);
    const condPath = list.slice(0, -1);
    const b = list[list.length - 1] ?? 0;
    const cond = actionAt(actions, condPath);
    if (!cond) return actions;
    const blocks = [...(cond.blocks ?? [])];
    const block = blocks[b];
    if (block) blocks[b] = { ...block, actions: fn(block.actions) };
    else blocks.push({ condition: null, actions: fn([]) });
    return updateActionAt(actions, condPath, { ...cond, blocks });
}

function hasConditional(actions: PrototypeAction[]) {
    return actions.some((a) => a.type === "conditional");
}

function valid(actions: PrototypeAction[], p: Picked): boolean {
    if (p.kind === "action") return Boolean(actionAt(actions, p.path));
    if (p.kind === "block") return actionAt(actions, p.path)?.type === "conditional";
    return p.list.length === 0 || actionAt(actions, p.list.slice(0, -1))?.type === "conditional";
}

function firstPick(actions: PrototypeAction[], path: number[] | null): Picked {
    if (path && actionAt(actions, path)) return actionAt(actions, path)?.type === "conditional" ? { kind: "block", path, block: 0 } : { kind: "action", path };
    if (actions[0]) return actions[0].type === "conditional" ? { kind: "block", path: [0], block: 0 } : { kind: "action", path: [0] };
    return { kind: "new", list: [] };
}

// ---- The window ----

export function InteractionWindow() {
    const edit = useProtoUi((s) => s.editing);
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const node = edit ? doc.nodes[edit.node] : undefined;
    const raw = edit && node ? node.interactions?.[edit.interaction] : undefined;

    // Gone (undone, deleted) or the selection moved to another layer: close.
    useEffect(() => {
        if (edit && (!raw || !selection.includes(edit.node))) closeInteraction();
    }, [edit, raw, selection]);

    if (!edit || !node || !raw) return null;
    return createPortal(<Window key={`${edit.node}:${edit.interaction}`} doc={doc} node={node} index={edit.interaction} interaction={raw} startPath={edit.path} y={edit.y} anchor={edit.anchor} readOnly={readOnly} />, document.body);
}

// Popover geometry: widths for one and two panes, the gap to the connection (the caret sits in it),
// and room kept above the canvas's floating toolbar.
// 240 wide (241 with its border), as the reference's.
const WIDTH = 240;
const WIDTH_TWO_PANE = 480;
const CARET_GAP = 12;
const TOOLBAR_ROOM = 64;

// The caret: a small rotated square on the popover's edge, its two outer sides bordered so the
// popover's outline runs around it as one line.
const CARET: Record<PopoverSide, { cls: string; style: (at: number) => React.CSSProperties }> = {
    bottom: { cls: "border-t border-l", style: (at) => ({ left: at - 6, top: -6 }) },
    top: { cls: "border-b border-r", style: (at) => ({ left: at - 6, bottom: -6 }) },
    right: { cls: "border-b border-l", style: (at) => ({ top: at - 6, left: -6 }) },
    left: { cls: "border-t border-r", style: (at) => ({ top: at - 6, right: -6 }) },
};

const TABBABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Window({ doc, node, index, interaction, startPath, y, anchor, readOnly }: { doc: NagmaDocument; node: SceneNode; index: number; interaction: Interaction; startPath: number[] | null; y: number; anchor: InteractionEdit["anchor"]; readOnly: boolean }) {
    const it = normalizeInteraction(interaction);
    const actions = it.actions ?? [];
    const [picked, setPicked] = useState<Picked>(() => firstPick(actions, startPath));
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);
    // Follows its connection as the canvas pans and zooms, and the window as it resizes.
    const camera = useEditor((s) => s.camera);
    const hidden = useProtoUi((s) => s.hidden);
    const [, setViewport] = useState(0);
    useEffect(() => {
        const resize = () => setViewport((n) => n + 1);
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    // The canvas draws the connection as selected while this is open; redraw when it closes.
    useEffect(() => () => editor.set({}), []);

    // Clicking a connection inside an open window's interaction picks that action.
    useEffect(() => {
        if (startPath) setPicked(firstPick(actions, startPath));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new path is asked for
    }, [startPath?.join(".")]);

    const pick = valid(actions, picked) ? picked : firstPick(actions, null);
    const twoPane = actions.length > 1 || hasConditional(actions) || (pick.kind === "new" && actions.length > 0);

    const setInteraction = (next: Interaction) => editor.execute({ type: "node.update", id: node.id, patch: { interactions: (node.interactions ?? []).map((x, i) => (i === index ? next : x)) } });
    const set = (patch: Partial<Interaction>) => setInteraction({ ...it, ...patch });
    const setActions = (next: PrototypeAction[]) => set({ actions: next });

    // A press outside closes the popover, except in its own menus and windows (portaled elsewhere).
    // While one of those is open the rest of the page, this popover included, is inert under it, so
    // any press (inside the popover or out) only closes that menu.
    // Escape closes it too, unless a menu or a window of its own has the focus (Escape closes that).
    useEffect(() => {
        const keep = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(`[${KEEP_OPEN}], [role="dialog"], [role="menu"], [role="listbox"], [data-interaction-row], [data-testid="underlay"]`));
        const down = (e: PointerEvent) => {
            if (ref.current?.closest("[inert]") || ref.current?.contains(e.target as Node) || keep(e.target)) return;
            closeInteraction();
        };
        const key = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as Element | null;
            if (t?.closest?.('[role="menu"], [role="listbox"]') || (t && t !== document.body && !ref.current?.contains(t) && t.closest?.('[role="dialog"]'))) return;
            e.stopPropagation();
            closeInteraction();
        };
        window.addEventListener("pointerdown", down, true);
        window.addEventListener("keydown", key, true);
        return () => {
            window.removeEventListener("pointerdown", down, true);
            window.removeEventListener("keydown", key, true);
        };
    }, []);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
        ro.observe(el);
        setHeight(el.offsetHeight);
        return () => ro.disconnect();
    }, []);

    // Tab and Shift-Tab cycle through the popover's controls.
    const onKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key !== "Tab" || !ref.current) return;
        const all = [...ref.current.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.offsetParent !== null);
        const first = all[0];
        const last = all[all.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    const width = twoPane ? WIDTH_TWO_PANE : WIDTH;
    const canvas = canvasRect();
    const panel = document.querySelector("[data-right-panel]")?.getBoundingClientRect();
    const point = anchor && canvas && !hidden ? anchorPoint(doc, camera, anchor) : null;
    let place: { left: number; top: number; side: PopoverSide | null; caret: number };
    let maxHeight: number;
    if (point && canvas) {
        // Beside its connection on the canvas, never under the side panels or the toolbar.
        const bounds = { left: canvas.left, top: canvas.top, right: Math.min(canvas.right, panel?.left ?? canvas.right), bottom: canvas.bottom - TOOLBAR_ROOM };
        const p = placePopover({ anchor: { x: canvas.left + point.x, y: canvas.top + point.y }, size: { w: width, h: Math.max(height, 120) }, bounds, gap: CARET_GAP });
        place = { left: p.x, top: p.y, side: p.side, caret: p.caret };
        maxHeight = bounds.bottom - bounds.top - 16;
    } else {
        // No connection on the canvas (an action without a destination, or connections hidden):
        // beside the right panel, level with the row it was opened from.
        // Docked: its right edge on the panel's left edge, its top 4pt above the row, no caret.
        const right = panel ? panel.left : window.innerWidth - 240;
        place = { left: right - width, top: Math.max(56, Math.min(window.innerHeight - Math.max(height, 120) - 8, y - 4)), side: null, caret: 0 };
        maxHeight = window.innerHeight - 64;
    }

    const addAction = () => {
        const list = pick.kind === "action" ? pick.path.slice(0, -1) : pick.kind === "block" ? [...pick.path, pick.block] : pick.kind === "new" ? pick.list : [];
        setPicked({ kind: "new", list });
    };

    const iconButton = "flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-brand-500";
    const header = (
        <div className="flex h-10 shrink-0 cursor-default items-center gap-1 border-b border-panel-border pr-2 pl-[23px] select-none">
            {twoPane && <Target04 className="mr-0.5 size-3.5 text-ink-muted" />}
            <span className="flex-1 font-semibold">Interaction</span>
            {!twoPane && !readOnly && (
                <button type="button" aria-label="Add action" onClick={addAction} className={iconButton}>
                    <Plus className="size-4" />
                </button>
            )}
            <button type="button" aria-label="Close" onClick={closeInteraction} className={iconButton}>
                <XClose className="size-4" />
            </button>
        </div>
    );

    const insert = (list: number[], action: PrototypeAction) => {
        const at = listAt(actions, list).length;
        setActions(mapList(actions, list, (l) => [...l, action]));
        setPicked(action.type === "conditional" ? { kind: "block", path: [...list, at], block: 0 } : { kind: "action", path: [...list, at] });
    };

    const remove = () => {
        if (pick.kind === "action") {
            setActions(updateActionAt(actions, pick.path, null));
            setPicked(firstPick(updateActionAt(actions, pick.path, null), null));
        } else if (pick.kind === "block") {
            const cond = actionAt(actions, pick.path);
            const blocks = (cond?.blocks ?? []).filter((_, b) => b !== pick.block);
            const next = cond && blocks.some((b) => b.condition !== null) ? updateActionAt(actions, pick.path, { ...cond, blocks }) : updateActionAt(actions, pick.path, null);
            setActions(next);
            setPicked(firstPick(next, null));
        } else setPicked(firstPick(actions, null));
    };

    const settings = (
        <Settings
            doc={doc}
            owner={node}
            actions={actions}
            pick={pick}
            onActions={setActions}
            onPick={setPicked}
            onInsert={insert}
        />
    );

    const caret = place.side ? CARET[place.side] : null;
    return (
        <div ref={ref} role="dialog" aria-label="Interaction" {...{ [KEEP_OPEN]: "" }} onKeyDown={onKeyDown} className="fixed z-40 text-[11px] text-ink" style={{ left: place.left, top: place.top, width }}>
            <OutlineFields.Provider value={true}>
                <div className="flex flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-raised shadow-2xl" style={{ maxHeight }}>
                    {header}
                    <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 overflow-hidden border-0 p-0">
                        {twoPane ? (
                            <div className="flex h-[360px] min-h-0 w-full">
                                <div className="flex w-[208px] shrink-0 flex-col border-r border-panel-border">
                                    <div className="flex flex-col gap-2 px-3 py-3">
                                        <TriggerRows it={it} owner={node} onChange={set} compact />
                                    </div>
                                    <div className="h-px shrink-0 bg-panel-border" />
                                    <ActionTree doc={doc} actions={actions} pick={pick} onPick={setPicked} onActions={setActions} />
                                    <div className="flex h-9 shrink-0 items-center gap-0.5 border-t border-panel-border px-2">
                                        <button type="button" aria-label="Add action" onClick={addAction} className={iconButton}>
                                            <Plus className="size-3.5" />
                                        </button>
                                        <button type="button" aria-label="Remove action" onClick={remove} className={iconButton}>
                                            <Minus className="size-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">{settings}</div>
                            </div>
                        ) : (
                            <div className="flex min-h-0 w-full flex-col gap-2 overflow-y-auto px-4 py-3">
                                <TriggerRows it={it} owner={node} onChange={set} />
                                <Rule />
                                {settings}
                            </div>
                        )}
                    </fieldset>
                </div>
            </OutlineFields.Provider>
            {caret && <span aria-hidden="true" className={`pointer-events-none absolute size-3 rotate-45 border-panel-border bg-panel-raised ${caret.cls}`} style={caret.style(place.caret)} />}
        </div>
    );
}

// A section break across the popover: one 1px line, edge to edge.
function Rule() {
    return <div role="separator" className="-mx-4 my-1 h-px shrink-0 bg-panel-border" />;
}

// ---- Trigger ----

function TriggerRows({ it, owner, onChange, compact }: { it: Interaction; owner: SceneNode; onChange: (patch: Partial<Interaction>) => void; compact?: boolean }) {
    const hasVideo = videosOf(owner).length > 0;
    const isLiveFrame = owner.type === "live";
    const groups: PickOption[][] = TRIGGER_GROUPS.map((g) =>
        g
            .filter((t) => hasVideo || (t !== "video-end" && t !== "video-time") || t === it.trigger)
            .filter((t) => isLiveFrame || t !== "live-event" || t === it.trigger)
            .map((t) => ({ id: t, label: triggerLabel(t), icon: <TriggerIcon trigger={t} className="size-3.5" /> })),
    ).filter((g) => g.length > 0);
    const events = owner.live?.events ?? [];
    const trigger = <Pick label="Trigger" value={it.trigger} groups={groups} onChange={(t) => onChange(t === "live-event" && !it.event && events[0] ? { trigger: t, event: events[0] } : { trigger: t as Trigger })} icon={<TriggerIcon trigger={it.trigger} className="size-3.5" />} />;
    return (
        <>
            {compact ? trigger : <Row label="Trigger">{trigger}</Row>}
            {it.trigger === "key" && (
                <Row label="Device">
                    <Select aria-label="Device" value={it.device ?? "keyboard"} onChange={(e) => onChange({ device: e.target.value as TriggerDevice, key: undefined, button: undefined })} className={`${input} px-1`}>
                        {TRIGGER_DEVICES.map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </Row>
            )}
            {it.trigger === "key" && !isController(it.device) && (
                <Row label="Key">
                    <input
                        aria-label="Key"
                        placeholder="Press a key or combination"
                        value={keyLabel(it.key)}
                        readOnly
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (e.key === "Tab" && !it.key) return;
                            // Modifiers alone wait for the key they go with.
                            if (["Shift", "Meta", "Control", "Alt"].includes(e.key)) return;
                            const mods = [e.shiftKey ? "Shift" : "", e.ctrlKey ? "Control" : "", e.altKey ? "Alt" : "", e.metaKey ? "Meta" : ""].filter(Boolean);
                            onChange({ key: [...mods, e.key].join("+") });
                        }}
                        className={`${input} caret-transparent`}
                    />
                </Row>
            )}
            {it.trigger === "key" && isController(it.device) && <GamepadButtonPicker it={it} onChange={onChange} />}
            {(it.trigger === "mouse-enter" || it.trigger === "mouse-leave" || it.trigger === "mouse-down" || it.trigger === "mouse-up") && (
                <Row label="Delay">
                    <NumberField label="" icon={<Clock className="size-3" />} title="Delay before the actions run (ms)" unit="ms" min={0} step={50} value={it.triggerDelay ?? 0} onCommit={(triggerDelay) => onChange({ triggerDelay })} />
                </Row>
            )}
            {it.trigger === "delay" && (
                <Row label="Delay">
                    <NumberField label="" icon={<Clock className="size-3" />} title="Delay (ms)" unit="ms" min={0} step={50} value={it.delay} onCommit={(delay) => onChange({ delay })} />
                </Row>
            )}
            {it.trigger === "live-event" && (
                <Row label="Event">
                    {events.length > 0 ? (
                        <Select aria-label="Event" value={it.event ?? ""} onChange={(e) => onChange({ event: e.target.value })} className={`${input} px-1`}>
                            {[...(it.event && !events.includes(it.event) ? [it.event] : []), ...events].map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </Select>
                    ) : (
                        <input aria-label="Event" placeholder="submit" value={it.event ?? ""} onChange={(e) => onChange({ event: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} className={input} />
                    )}
                </Row>
            )}
            {it.trigger === "video-time" && (
                <Row label="Time">
                    <NumberField label="" icon={<Clock className="size-3" />} title="Time in the video (seconds)" unit="s" min={0} step={0.5} value={it.videoTime ?? 0} onCommit={(videoTime) => onChange({ videoTime })} />
                </Row>
            )}
        </>
    );
}

// Which controller button: pick from the list, or press one on a connected controller.
function GamepadButtonPicker({ it, onChange }: { it: Interaction; onChange: (patch: Partial<Interaction>) => void }) {
    const device = it.device ?? "controller";
    const [listening, setListening] = useState(false);
    useEffect(() => {
        if (!listening) return;
        const watcher = new GamepadWatcher();
        watcher.poll();
        let frame = 0;
        const tick = () => {
            const pressed = watcher.poll()[0];
            if (pressed) {
                onChange({ button: pressed.index });
                setListening(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [listening, onChange]);
    return (
        <Row label="Button">
            <Select aria-label="Controller button" value={it.button ?? ""} onChange={(e) => onChange({ button: e.target.value === "" ? undefined : Number(e.target.value) })} className={`${input} px-1`}>
                <option value="">Choose a button</option>
                {gamepadButtons(device).map((b) => (
                    <option key={b.index} value={b.index}>
                        {b.label}
                    </option>
                ))}
            </Select>
            <button type="button" onClick={() => setListening((l) => !l)} title="Press a button on the controller to pick it" className={`h-7 shrink-0 rounded-md px-2 ${listening ? "bg-brand-500 text-white" : "bg-field text-ink-muted hover:text-ink"}`}>
                {listening ? "Press…" : "Record"}
            </button>
        </Row>
    );
}

// ---- The action list (two panes) ----

function useVariableInfo(doc: NagmaDocument) {
    return (id: string): { name: string; type?: VariableType } => {
        const found = findVariable(doc, id);
        return found ? { name: found.variable.name, type: found.variable.type } : { name: "Missing variable" };
    };
}

function ActionLine({ doc, action }: { doc: NagmaDocument; action: PrototypeAction }) {
    const info = useVariableInfo(doc);
    const name = (id: string | null | undefined) => (id ? doc.nodes[id]?.name : undefined) ?? "None";
    switch (action.type) {
        case "set-variable":
            return (
                <span className="flex min-w-0 items-center gap-1">
                    Set {action.variableId ? <VariableChip {...info(action.variableId)} /> : <span className="text-ink-subtle">variable</span>}
                </span>
            );
        case "navigate":
            return <span className="truncate">Navigate to {name(action.target)}</span>;
        case "set-mode": {
            const c = collectionsOf(doc).find((x) => x.id === action.collectionId);
            const m = c?.modes.find((x) => x.id === action.modeId);
            return <span className="truncate">{m ? `Set ${c?.name} to ${m.name}` : "Set variable mode"}</span>;
        }
        default:
            return <span className="truncate">{actionSummary(doc, action)}</span>;
    }
}

function ActionTree({ doc, actions, pick, onPick, onActions }: { doc: NagmaDocument; actions: PrototypeAction[]; pick: Picked; onPick: (p: Picked) => void; onActions: (next: PrototypeAction[]) => void }) {
    const info = useVariableInfo(doc);
    const [drag, setDrag] = useState<{ list: string; from: number } | null>(null);
    const same = (a: number[], b: number[]) => a.join(".") === b.join(".");
    const isPicked = (p: Picked) =>
        (p.kind === "action" && pick.kind === "action" && same(p.path, pick.path)) ||
        (p.kind === "block" && pick.kind === "block" && same(p.path, pick.path) && p.block === pick.block) ||
        (p.kind === "new" && pick.kind === "new" && same(p.list, pick.list));

    const row = (key: string, p: Picked, depth: number, content: React.ReactNode, dragProps?: React.HTMLAttributes<HTMLDivElement>) => (
        <div
            key={key}
            role="option"
            aria-selected={isPicked(p)}
            tabIndex={-1}
            onClick={() => onPick(p)}
            {...dragProps}
            className={`flex h-6 cursor-default items-center gap-1.5 rounded-md pr-1.5 ${isPicked(p) ? "bg-brand-500/20 text-ink" : "hover:bg-panel-hover"}`}
            style={{ paddingLeft: 6 + depth * 14 }}
        >
            {depth > 0 && <span className="-ml-1 text-ink-subtle">└</span>}
            {content}
        </div>
    );

    const render = (list: PrototypeAction[], listPath: number[], depth: number): React.ReactNode[] => {
        const out: React.ReactNode[] = [];
        const listKey = listPath.join(".");
        list.forEach((action, i) => {
            const path = [...listPath, i];
            const dragProps: React.HTMLAttributes<HTMLDivElement> = {
                draggable: true,
                onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    setDrag({ list: listKey, from: i });
                },
                onDragOver: (e) => {
                    if (drag?.list === listKey) e.preventDefault();
                },
                onDrop: (e) => {
                    e.preventDefault();
                    if (!drag || drag.list !== listKey || drag.from === i) return setDrag(null);
                    const from = drag.from;
                    onActions(
                        mapList(actions, listPath, (l) => {
                            const next = [...l];
                            const [item] = next.splice(from, 1);
                            if (item) next.splice(i, 0, item);
                            return next;
                        }),
                    );
                    onPick({ kind: "action", path });
                    setDrag(null);
                },
                onDragEnd: () => setDrag(null),
            };
            if (action.type !== "conditional") {
                out.push(
                    row(
                        path.join("."),
                        { kind: "action", path },
                        depth,
                        <>
                            <ActionIcon kind={menuKey(action)} className="size-3.5 shrink-0 text-ink-muted" />
                            <span className="min-w-0 flex-1 truncate">
                                <ActionLine doc={doc} action={action} />
                            </span>
                        </>,
                        dragProps,
                    ),
                );
                return;
            }
            const blocks = action.blocks ?? [];
            const hasElse = blocks.some((b) => b.condition === null);
            blocks.forEach((block, b) => {
                const label = block.condition === null ? "else" : b === 0 ? "if" : "else if";
                out.push(
                    row(
                        `${path.join(".")}:${b}`,
                        { kind: "block", path, block: b },
                        depth,
                        <>
                            {b === 0 && <ActionIcon kind="conditional" className="size-3.5 shrink-0 text-ink-muted" />}
                            <span className={`shrink-0 ${b === 0 ? "" : "pl-5"} font-medium`}>{label}</span>
                            {block.condition !== null && (block.condition ? <ExpressionText src={block.condition} nameOf={info} /> : <span className="truncate text-ink-subtle">condition</span>)}
                        </>,
                        b === 0 ? dragProps : undefined,
                    ),
                );
                out.push(...render(block.actions, [...path, b], depth + 1));
                out.push(row(`${path.join(".")}:${b}:new`, { kind: "new", list: [...path, b] }, depth + 1, <span className="text-ink-subtle">Add action</span>));
            });
            if (!hasElse) {
                out.push(row(`${path.join(".")}:else`, { kind: "block", path, block: blocks.length }, depth, <span className="pl-5 font-medium">else</span>));
                out.push(row(`${path.join(".")}:else:new`, { kind: "new", list: [...path, blocks.length] }, depth + 1, <span className="text-ink-subtle">Add action</span>));
            }
        });
        return out;
    };

    return (
        <div role="listbox" aria-label="Actions" className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5">
            {render(actions, [], 0)}
            {pick.kind === "new" && pick.list.length === 0 && row("new", pick, 0, <span className="text-ink-subtle">Add action</span>)}
        </div>
    );
}

// ---- Settings of the picked action ----

function actionGroups(doc: NagmaDocument, owner: SceneNode, current: string, allowConditional: boolean): PickOption[][] {
    const hasVariants = variantsFor(doc, owner).length > 0;
    const hasVideo = videoLayers(doc, owner).length > 0;
    const hasAnimation = animatedLayersOn(doc, owner).length > 0;
    const isAnimation = (k: string) => k === "animation" || k === "set-playhead";
    return ACTION_GROUPS.map((g) =>
        g
            .filter((k) => (allowConditional || k !== "conditional") && (!k.startsWith("video") || hasVideo || current.startsWith("video")) && (!isAnimation(k) || hasAnimation || isAnimation(current)))
            .map((k) => ({ id: k, label: actionLabel(k), icon: <ActionIcon kind={k} className="size-3.5" />, disabled: k === "change-to" && !hasVariants && current !== "change-to" })),
    );
}

function Settings({
    doc,
    owner,
    actions,
    pick,
    onActions,
    onPick,
    onInsert,
}: {
    doc: NagmaDocument;
    owner: SceneNode;
    actions: PrototypeAction[];
    pick: Picked;
    onActions: (next: PrototypeAction[]) => void;
    onPick: (p: Picked) => void;
    onInsert: (list: number[], action: PrototypeAction) => void;
}) {
    // Inside a conditional, actions can't be conditionals themselves.
    const nested = (pick.kind === "action" && pick.path.length > 1) || (pick.kind === "new" && pick.list.length > 0);
    if (pick.kind === "new") {
        return (
            <Row label="Action">
                <Pick label="Action" value="none" groups={actionGroups(doc, owner, "none", !nested)} onChange={(k) => k !== "none" && onInsert(pick.list, actionOfKind(k, null, doc, owner))} />
            </Row>
        );
    }
    if (pick.kind === "block") return <ConditionSettings doc={doc} owner={owner} actions={actions} pick={pick} onActions={onActions} onPick={onPick} nested={pick.path.length > 1} />;
    const action = actionAt(actions, pick.path);
    if (!action) return null;
    if (action.type === "conditional") return <ConditionSettings doc={doc} owner={owner} actions={actions} pick={{ path: pick.path, block: 0 }} onActions={onActions} onPick={onPick} nested={pick.path.length > 1} />;
    return (
        <ActionSettings
            doc={doc}
            owner={owner}
            action={action}
            allowConditional={!nested}
            onChange={(next) => {
                onActions(updateActionAt(actions, pick.path, next));
                if (!next) onPick(firstPick(updateActionAt(actions, pick.path, null), null));
                else if (next.type === "conditional") onPick({ kind: "block", path: pick.path, block: 0 });
            }}
        />
    );
}

function ConditionSettings({ doc, owner, actions, pick, onActions, onPick, nested }: { doc: NagmaDocument; owner: SceneNode; actions: PrototypeAction[]; pick: { path: number[]; block: number }; onActions: (next: PrototypeAction[]) => void; onPick: (p: Picked) => void; nested: boolean }) {
    const cond = actionAt(actions, pick.path);
    if (!cond) return null;
    const blocks = cond.blocks ?? [];
    const block = blocks[pick.block];
    const setCond = (next: PrototypeAction | null) => onActions(updateActionAt(actions, pick.path, next));
    const elseIndex = blocks.findIndex((b) => b.condition === null);
    return (
        <>
            <Row label="Action">
                <Pick
                    label="Action"
                    value="conditional"
                    groups={actionGroups(doc, owner, "conditional", !nested)}
                    onChange={(k) => {
                        if (k === "conditional") return;
                        const next = k === "none" ? null : actionOfKind(k, null, doc, owner);
                        setCond(next);
                        onPick(next ? { kind: "action", path: pick.path } : firstPick(updateActionAt(actions, pick.path, null), null));
                    }}
                />
            </Row>
            {block && block.condition !== null ? (
                <>
                    <Row label={pick.block === 0 ? "Condition" : "Else if"} align="start">
                        <div className="min-w-0 flex-1">
                            <ExpressionField key={`${pick.path.join(".")}:${pick.block}`} label="Condition" value={block.condition} placeholder="For example, count > 3" types={["boolean", "number"]} onChange={(condition) => setCond({ ...cond, blocks: blocks.map((b, i) => (i === pick.block ? { ...b, condition } : b)) })} />
                        </div>
                    </Row>
                    <div className="flex gap-1 pl-[76px]">
                        <button
                            type="button"
                            onClick={() => {
                                const next = [...blocks];
                                const at = elseIndex >= 0 ? elseIndex : next.length;
                                next.splice(at, 0, { condition: "", actions: [] });
                                setCond({ ...cond, blocks: next });
                                onPick({ kind: "block", path: pick.path, block: at });
                            }}
                            className="h-6 rounded px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink"
                        >
                            Add else if
                        </button>
                    </div>
                </>
            ) : (
                <p className="pl-[76px] leading-snug text-ink-subtle">Runs when no condition above is true.</p>
            )}
        </>
    );
}

export function ActionSettings({ doc, owner, action, allowConditional, onChange }: { doc: NagmaDocument; owner: SceneNode; action: PrototypeAction | null; allowConditional: boolean; onChange: (next: PrototypeAction | null) => void }) {
    const key = action ? menuKey(action) : "none";
    const actionRow = (
        <Row label="Action">
            <Pick label="Action" value={key} groups={actionGroups(doc, owner, key, allowConditional)} onChange={(k) => k !== key && onChange(k === "none" ? null : actionOfKind(k, action, doc, owner))} />
        </Row>
    );
    if (!action) return actionRow;
    const type = action.type;
    const t = action.transition ?? DEFAULT_TRANSITION;
    const setT = (next: Transition) => onChange({ ...action, transition: next });
    const set = (patch: Partial<PrototypeAction>) => onChange({ ...action, ...patch });
    return (
        <>
            {actionRow}
            {(type === "navigate" || type === "overlay" || type === "swap") && (
                <Row label={type === "overlay" ? "Overlay" : type === "swap" ? "Swap with" : "Destination"}>
                    <DestinationPick doc={doc} value={action.target ?? null} onChange={(target) => set({ target })} />
                </Row>
            )}
            {type === "change-to" && (
                <Row label="Destination">
                    <Pick
                        label="Variant"
                        value={action.target ?? null}
                        placeholder={variantsFor(doc, owner).length ? "Choose a variant" : "Only works on a variant"}
                        groups={[variantsFor(doc, owner).map((v) => ({ id: v.id, label: v.name }))]}
                        onChange={(target) => set({ target })}
                    />
                </Row>
            )}
            {type === "scroll-to" && <ScrollTarget action={action} owner={owner} doc={doc} onChange={onChange} />}
            {type === "url" && (
                <>
                    <Row label="URL">
                        <input
                            key={action.url}
                            aria-label="Link"
                            placeholder="https://"
                            defaultValue={action.url ?? ""}
                            onBlur={(e) => e.target.value.trim() !== (action.url ?? "") && set({ url: e.target.value.trim() })}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className={input}
                        />
                    </Row>
                    <div className="pl-[76px]">
                        <CheckRow label="Open in new tab" checked={action.newTab ?? true} onChange={(newTab) => set({ newTab })} />
                    </div>
                </>
            )}
            {(type === "overlay" || type === "swap") && <OverlayOptions action={action} onChange={onChange} />}
            {type === "set-variable" && <SetVariable doc={doc} action={action} onChange={onChange} />}
            {type === "set-mode" && <SetMode doc={doc} action={action} onChange={onChange} />}
            {type === "video" && <VideoAction action={action} owner={owner} doc={doc} onChange={onChange} />}
            {(type === "animation" || type === "set-playhead") && <AnimationAction action={action} owner={owner} doc={doc} onChange={onChange} />}
            {(type === "navigate" || type === "overlay" || type === "swap" || type === "change-to") && (
                <>
                    <Rule />
                    <AnimationRows transition={t} onChange={setT} limited={type === "change-to"} />
                </>
            )}
            {type === "scroll-to" && (
                <>
                    <Rule />
                    <Row label="Animation">
                        <Pick
                            label="Animation"
                            value={t.type === "instant" ? "instant" : "animate"}
                            groups={[
                                [
                                    { id: "instant", label: "Instant" },
                                    { id: "animate", label: "Animate" },
                                ],
                            ]}
                            onChange={(v) => setT({ ...t, type: v === "instant" ? "instant" : "smart" })}
                        />
                    </Row>
                    {t.type !== "instant" && <EasingRows transition={t} onChange={setT} />}
                </>
            )}
            {(type === "navigate" || type === "overlay" || type === "swap" || type === "back" || type === "change-to") && <StateSection doc={doc} action={action} onChange={onChange} />}
        </>
    );
}

function DestinationPick({ doc, value, onChange }: { doc: NagmaDocument; value: string | null; onChange: (id: string | null) => void }) {
    const all = destinations(doc);
    return (
        <Pick
            label="Destination"
            value={value ?? "none"}
            groups={[
                [{ id: "none", label: "None" }],
                all.filter((s) => !s.isSection).map((s) => ({ id: s.id, label: s.name })),
                all.filter((s) => s.isSection).map((s) => ({ id: s.id, label: `${s.name} (section)` })),
            ]}
            onChange={(id) => onChange(id === "none" ? null : id)}
        />
    );
}

// The easing and duration rows: each can follow an easing or timing variable instead of a value.
// The variable button sits over the field's right end and shows on hover (or while one is bound),
// so the fields keep the full width.
function EasingRows({ transition: t, onChange }: { transition: Transition; onChange: (next: Transition) => void }) {
    const doc = useEditor((s) => s.doc);
    const shown = resolveTransition(doc, t);
    const spring = shown.easing.startsWith("spring") || shown.easing === "custom-spring";
    const pill = (id: string, onDetach: () => void) => {
        const found = findVariable(doc, id);
        return (
            <span className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-brand-500/50 bg-brand-500/10 pr-7 pl-2" title={found ? `${found.collection.name} / ${found.variable.name}` : "Missing variable"}>
                <span className="min-w-0 flex-1 truncate">{found?.variable.name.split("/").pop() ?? "Missing variable"}</span>
                <button type="button" aria-label="Detach variable" onClick={onDetach} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-subtle hover:bg-panel-hover hover:text-ink">
                    <XClose className="size-3" />
                </button>
            </span>
        );
    };
    const bind = (field: "transition:easing" | "transition:duration", current: string | undefined, onPick: (id: string | null) => void, inset: string, children: React.ReactNode) => (
        <div className="group/bind relative flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 flex-1">{children}</div>
            <span className={`absolute top-1/2 -translate-y-1/2 ${current ? "right-1" : `${inset} opacity-0 group-hover/bind:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100`}`}>
                <TransitionVarButton field={field} current={current ?? null} onPick={onPick} />
            </span>
        </div>
    );
    return (
        <>
            <Row label="Easing">
                {bind(
                    "transition:easing",
                    t.easingVariable,
                    (id) => onChange({ ...t, easingVariable: id ?? undefined }),
                    "right-6",
                    t.easingVariable ? pill(t.easingVariable, () => onChange({ ...t, easingVariable: undefined })) : <EasingButton transition={t} onChange={onChange} />,
                )}
            </Row>
            <Row label="Duration">
                {t.durationVariable ? (
                    bind("transition:duration", t.durationVariable, (id) => onChange({ ...t, durationVariable: id ?? undefined }), "right-1", pill(t.durationVariable, () => onChange({ ...t, durationVariable: undefined })))
                ) : spring ? (
                    <span className="flex h-7 w-full items-center gap-1.5 rounded-md bg-field px-2 text-ink-subtle" title="A spring's length comes from its physics">
                        <Clock className="size-3.5" />
                        {transitionDuration(shown)}ms
                    </span>
                ) : (
                    bind(
                        "transition:duration",
                        undefined,
                        (id) => onChange({ ...t, durationVariable: id ?? undefined }),
                        "right-1",
                        <div className="min-w-0 flex-1 [&_label]:h-7">
                            <NumberField label="" icon={<Clock className="size-3.5" />} title="Duration (ms)" unit="ms" min={1} step={50} value={t.duration} onCommit={(duration) => onChange({ ...t, duration })} />
                        </div>,
                    )
                )}
            </Row>
        </>
    );
}

// The variable button for a transition field (no layer: easing and timing variables have no scopes).
function TransitionVarButton({ field, current, onPick }: { field: string; current: string | null; onPick: (id: string | null) => void }) {
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={`Apply variable to ${field === "transition:easing" ? "easing" : "duration"}`} className={`flex size-5 shrink-0 items-center justify-center rounded bg-panel-raised outline-none hover:bg-panel-hover ${current ? "text-brand-500" : "text-ink-subtle hover:text-ink"}`}>
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6z" strokeLinejoin="round" />
                    <circle cx="6" cy="6" r="1.4" />
                </svg>
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Variables">
                    {({ close }) => (
                        <VariablePicker
                            nodes={[]}
                            field={field}
                            current={current}
                            onPick={(id) => {
                                onPick(id);
                                close();
                            }}
                            onClose={close}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// The Animation row with the transition's settings under it. Animation styles live in the
// Animation menu: follow one, save this transition as a new style, push its values to the style
// followed, or detach from it.
function AnimationRows({ transition: t, onChange: set, limited }: { transition: Transition; onChange: (next: Transition) => void; limited?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const styles = animationStyles(doc);
    const current = t.styleId ? styles.find((s) => s.id === t.styleId) : undefined;
    const types = (limited ? TRANSITION_GROUPS.slice(0, 1) : TRANSITION_GROUPS).map((g) => g.map(([id, label]) => ({ id, label })));
    const styleOptions: PickOption[] = styles.map((s) => ({ id: `style:${s.id}`, label: s.name, icon: <StyleIcon /> }));
    const styleActions: PickOption[] = [{ id: "__create", label: "Create style from this transition" }];
    if (current) styleActions.push({ id: "__update", label: `Update "${current.name}" with these values` }, { id: "__detach", label: "Detach style" });
    // Changing a value by hand detaches the transition from its animation style.
    const onChange = (next: Transition) => set(t.styleId ? { ...next, styleId: null } : next);
    const pickAnimation = (id: string) => {
        if (id === "__create") {
            void askText("Create animation style", `Animation ${styles.length + 1}`, { confirm: "Create style", hint: describeTransition(t) }).then((name) => {
                if (name === null) return;
                const style = createAnimationStyle(name, t);
                set(followStyle(style));
                editor.mergeLast();
            });
            return;
        }
        if (id === "__update") return current && updateAnimationStyle(current.id, { transition: t });
        if (id === "__detach") return set({ ...t, styleId: null });
        if (id.startsWith("style:")) {
            const style = styles.find((s) => `style:${s.id}` === id);
            if (style) set(followStyle(style));
            return;
        }
        onChange({ ...t, type: id as TransitionType });
    };
    return (
        <>
            <Row label="Animation">
                <Pick
                    label="Animation"
                    value={current ? `style:${current.id}` : t.type}
                    groups={[...types, styleOptions, styleActions]}
                    headings={[...types.map(() => undefined), "Animation styles", styleOptions.length ? undefined : "Animation styles"]}
                    icon={current ? <StyleIcon /> : undefined}
                    onChange={pickAnimation}
                />
            </Row>
            {isDirectional(t.type) && (
                <>
                    <CheckRow label="Animate matching layers" checked={Boolean(t.matchLayers)} onChange={(matchLayers) => onChange({ ...t, matchLayers })} />
                    <Row label="Direction">
                        <div role="radiogroup" aria-label="Direction" className="grid h-6 w-full grid-cols-4 rounded-[5px] bg-field">
                            {DIRECTIONS.map(([dir, Icon, label]) => (
                                <button
                                    key={dir}
                                    type="button"
                                    role="radio"
                                    aria-label={label}
                                    aria-checked={t.direction === dir}
                                    onClick={() => onChange({ ...t, direction: dir })}
                                    className={`flex items-center justify-center rounded-md border outline-none focus-visible:border-brand-500 ${t.direction === dir ? "border-panel-border bg-panel-raised text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                                >
                                    <Icon className="size-3.5" />
                                </button>
                            ))}
                        </div>
                    </Row>
                </>
            )}
            {t.type !== "instant" && (
                <>
                    <EasingRows transition={t} onChange={onChange} />
                    <TransitionPreview transition={t} />
                </>
            )}
        </>
    );
}

// An animation style's mark in the Animation menu and field: four dots, as for other styles.
function StyleIcon() {
    return (
        <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="3.5" r="1.5" />
            <circle cx="8.5" cy="3.5" r="1.5" />
            <circle cx="3.5" cy="8.5" r="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" />
        </svg>
    );
}

const VEC: Record<Direction, { x: number; y: number }> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

// The preview's two little screens: where the action starts (a thin blue header) and the
// destination (a deep one), drawn side by side as they meet mid-transition.
const PREVIEW = { w: 210, h: 96, sw: 48, sh: 60 };
const PREVIEW_BLUE = "#0D99FF";

// A looping sketch of the animation: the starting screen in the middle and the destination beside
// it, moving as the prototype will (a push slides both, a move in slides the destination over).
function TransitionPreview({ transition }: { transition: Transition }) {
    const a = useRef<SVGGElement>(null);
    const b = useRef<SVGGElement>(null);
    const tRef = useRef(transition);
    useEffect(() => {
        tRef.current = transition;
    }, [transition]);
    useEffect(() => {
        let raf = 0;
        let start = performance.now();
        const W = PREVIEW.sw;
        const H = PREVIEW.sh;
        const tick = (now: number) => {
            const t = tRef.current;
            const length = Math.min(2000, Math.max(120, transitionDuration(t)));
            const hold = 700;
            const total = hold + length + hold;
            let el = now - start;
            if (el > total) {
                start = now;
                el = 0;
            }
            const p = Math.min(1, Math.max(0, (el - hold) / length));
            const e = easeTransition(t, p);
            const v = VEC[t.direction];
            const enter = { x: -v.x * W * (1 - e), y: -v.y * H * (1 - e) };
            let pa = { x: 0, y: 0, o: 1 };
            let pb = { x: 0, y: 0, o: 1 };
            let bOnTop = true;
            switch (t.type) {
                case "dissolve":
                case "smart":
                    pb = { x: 0, y: 0, o: e };
                    break;
                case "move-in":
                    pb = { ...enter, o: 1 };
                    break;
                case "move-out":
                    pa = { x: v.x * W * e, y: v.y * H * e, o: 1 };
                    bOnTop = false;
                    break;
                case "push":
                    pa = { x: v.x * W * e, y: v.y * H * e, o: 1 };
                    pb = { ...enter, o: 1 };
                    break;
                case "slide-in":
                    pa = { x: v.x * W * 0.3 * e, y: v.y * H * 0.3 * e, o: 1 - e * 0.4 };
                    pb = { ...enter, o: 1 };
                    break;
                case "slide-out":
                    pb = { x: -v.x * W * 0.3 * (1 - e), y: -v.y * H * 0.3 * (1 - e), o: 0.6 + e * 0.4 };
                    pa = { x: v.x * W * e, y: v.y * H * e, o: 1 };
                    bOnTop = false;
                    break;
                default:
                    pb = { x: 0, y: 0, o: p > 0 ? 1 : 0 };
            }
            const ga = a.current;
            const gb = b.current;
            if (ga && gb) {
                ga.setAttribute("transform", `translate(${pa.x} ${pa.y})`);
                ga.setAttribute("opacity", String(pa.o));
                gb.setAttribute("transform", `translate(${pb.x} ${pb.y})`);
                gb.setAttribute("opacity", String(pb.o));
                const parent = ga.parentNode;
                if (parent) {
                    if (bOnTop && parent.lastChild !== gb) parent.appendChild(gb);
                    if (!bOnTop && parent.lastChild !== ga) parent.appendChild(ga);
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);
    const { w, h, sw, sh } = PREVIEW;
    const screen = (header: number) => (
        <>
            <rect x="0" y="0" width={sw} height={sh} className="fill-panel" />
            <rect x="0" y="0" width={sw} height={header} fill={PREVIEW_BLUE} />
            <rect x="0.5" y="0.5" width={sw - 1} height={sh - 1} fill="none" className="stroke-ink-subtle" />
        </>
    );
    return (
        <div className="-mx-[2px] flex h-24 items-center justify-center overflow-hidden rounded-[5px] bg-field" aria-hidden="true">
            <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
                <g transform={`translate(${(w - sw) / 2} ${(h - sh) / 2})`}>
                    <g ref={a}>{screen(4)}</g>
                    <g ref={b}>{screen(11)}</g>
                </g>
            </svg>
        </div>
    );
}

// The collapsible State section: what resets when the action runs.
function StateSection({ doc, action, onChange }: { doc: NagmaDocument; action: PrototypeAction; onChange: (next: PrototypeAction) => void }) {
    const [open, setOpen] = useState(false);
    const dest = action.target ? subtree(doc, action.target) : [];
    const instances = dest.some((n) => n.type === "instance") || Boolean(action.resetState);
    const videos = dest.some((n) => videosOf(n).length > 0) || Boolean(action.resetVideo);
    return (
        <>
            <Rule />
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-ml-1.5 flex h-7 items-center gap-1 self-start rounded-md pr-1.5 pl-1 font-semibold outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                <ChevronRight className={`size-3 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`} />
                State
            </button>
            {open && (
                <div>
                    <CheckRow label="Reset scroll position" hint="Scrolled frames on the destination start back at the top" checked={action.resetScroll ?? action.type === "navigate"} onChange={(resetScroll) => onChange({ ...action, resetScroll })} />
                    {instances && <CheckRow label="Reset component state" hint="Interactive components on the destination go back to their first variant" checked={action.resetState ?? false} onChange={(resetState) => onChange({ ...action, resetState })} />}
                    {videos && <CheckRow label="Reset video state" hint="Videos on the destination start from the beginning" checked={action.resetVideo ?? false} onChange={(resetVideo) => onChange({ ...action, resetVideo })} />}
                </div>
            )}
        </>
    );
}

function OverlayOptions({ action, onChange }: { action: PrototypeAction; onChange: (next: PrototypeAction) => void }) {
    const doc = useEditor((s) => s.doc);
    // Settings belong to the overlay frame: a new connection to it starts from them, and a change
    // here applies to every connection that opens it (one undo step).
    const overlay = action.overlay ?? (action.target ? overlaySettingsFor(doc, action.target) : null) ?? DEFAULT_OVERLAY;
    const set = (patch: Partial<OverlaySettings>) => {
        const next = { ...overlay, ...patch };
        onChange({ ...action, overlay: next });
        if (!action.target) return;
        const commands = shareOverlayCommands(editor.get().doc, action.target, next);
        if (commands.length) {
            editor.execute({ type: "batch", commands });
            editor.mergeLast();
        }
    };
    return (
        <>
            <Row label="Position">
                <Pick label="Overlay position" value={overlay.position} groups={[POSITIONS.slice(0, 7).map(([id, label]) => ({ id, label })), [{ id: "manual", label: "Manual" }]]} onChange={(position) => set({ position: position as OverlaySettings["position"] })} />
            </Row>
            {overlay.position === "manual" && (
                <Row label="Offset">
                    <NumberField label="X" value={overlay.x} onCommit={(x) => set({ x })} />
                    <NumberField label="Y" value={overlay.y} onCommit={(y) => set({ y })} />
                </Row>
            )}
            <div className="pl-[76px]">
                <CheckRow label="Close when clicking outside" checked={overlay.closeOnOutside} onChange={(closeOnOutside) => set({ closeOnOutside })} />
                <div className="flex items-center gap-2">
                    <CheckRow label="Add background" checked={overlay.background} onChange={(background) => set({ background })} />
                    {overlay.background && <ColorSwatch size={5} color={overlay.backgroundColor} opacity={overlay.backgroundOpacity} label="Overlay background colour" onChange={(backgroundColor, backgroundOpacity) => set({ backgroundColor, backgroundOpacity })} />}
                </div>
            </div>
        </>
    );
}

function ScrollTarget({ action, owner, doc, onChange }: { action: PrototypeAction; owner: SceneNode; doc: NagmaDocument; onChange: (next: PrototypeAction) => void }) {
    const screen = screenOf(doc, owner);
    const layers = screen ? subtree(doc, screen.id).slice(1) : [];
    const offset = action.offset ?? { x: 0, y: 0 };
    return (
        <>
            <Row label="Destination">
                <Pick label="Scroll target" value={action.target ?? null} placeholder="Choose a layer" groups={[layers.map((l) => ({ id: l.id, label: l.name }))]} onChange={(target) => onChange({ ...action, target })} />
            </Row>
            <Row label="Offset">
                <NumberField label="X" title="Offset X" value={offset.x} onCommit={(x) => onChange({ ...action, offset: { ...offset, x } })} />
                <NumberField label="Y" title="Offset Y" value={offset.y} onCommit={(y) => onChange({ ...action, offset: { ...offset, y } })} />
            </Row>
        </>
    );
}

const TYPE_MARK: Record<VariableType, string> = { color: "◐", number: "#", string: "T", boolean: "◑", easing: "∿", timing: "◷" };

function SetVariable({ doc, action, onChange }: { doc: NagmaDocument; action: PrototypeAction; onChange: (next: PrototypeAction) => void }) {
    const collections = collectionsOf(doc);
    const all = collections.flatMap((c) => c.variables.map((v) => ({ v, c })));
    const chosen = all.find((x) => x.v.id === action.variableId);
    const expr = action.expression ?? "";
    return (
        <>
            <Row label="Target">
                <Pick
                    label="Variable"
                    value={action.variableId ?? null}
                    placeholder={all.length ? "Choose a variable" : "No variables in this file"}
                    groups={collections.map((c) => c.variables.map((v) => ({ id: v.id, label: collections.length > 1 ? `${c.name}/${v.name}` : v.name, icon: <span className="text-[10px]">{TYPE_MARK[v.type]}</span> })))}
                    onChange={(variableId) => onChange({ ...action, variableId })}
                />
            </Row>
            <Row label="Value" align="start">
                <div className="min-w-0 flex-1">
                    {chosen?.v.type === "color" ? (
                        <div className="flex h-6 items-center gap-2 rounded-md bg-field px-1.5">
                            <ColorSwatch size={5} color={/^#[0-9A-F]{6}$/i.test(expr) ? expr : "#000000"} label="Value" onChange={(color) => onChange({ ...action, expression: literal(color) })} />
                            <span className="truncate text-ink-muted">{expr.replace("#", "") || "Choose a colour"}</span>
                        </div>
                    ) : chosen?.v.type === "boolean" && (expr === "true" || expr === "false" || !expr) ? (
                        <div className="flex items-center gap-1">
                            <Pick
                                label="Value"
                                value={expr || "true"}
                                groups={[
                                    [
                                        { id: "true", label: "True" },
                                        { id: "false", label: "False" },
                                    ],
                                    [{ id: "toggle", label: "Toggle (not current)" }],
                                ]}
                                onChange={(v) => onChange({ ...action, expression: v === "toggle" ? `not {{${chosen.v.id}}}` : v })}
                            />
                        </div>
                    ) : (
                        <ExpressionField key={action.variableId} label="Value" value={expr} placeholder={chosen?.v.type === "number" ? "For example, count + 1" : "Value or expression"} types={chosen ? [chosen.v.type] : undefined} onChange={(expression) => onChange({ ...action, expression })} />
                    )}
                </div>
            </Row>
        </>
    );
}

function SetMode({ doc, action, onChange }: { doc: NagmaDocument; action: PrototypeAction; onChange: (next: PrototypeAction) => void }) {
    const collections = collectionsOf(doc);
    const c = collections.find((x) => x.id === action.collectionId) ?? collections[0];
    return (
        <>
            <Row label="Collection">
                <Pick label="Collection" value={c?.id ?? null} placeholder="No collections" groups={[collections.map((x) => ({ id: x.id, label: x.name }))]} onChange={(collectionId) => onChange({ ...action, collectionId, modeId: undefined })} />
            </Row>
            <Row label="Mode">
                <Pick label="Mode" value={action.modeId ?? null} placeholder="Choose a mode" groups={[(c?.modes ?? []).map((m) => ({ id: m.id, label: m.name }))]} onChange={(modeId) => onChange({ ...action, collectionId: c?.id, modeId })} />
            </Row>
        </>
    );
}

function AnimationAction({ action, owner, doc, onChange }: { action: PrototypeAction; owner: SceneNode; doc: NagmaDocument; onChange: (next: PrototypeAction) => void }) {
    const layers = animatedLayersOn(doc, owner);
    const playhead = action.playhead ?? { ms: 0, play: false };
    return (
        <>
            <Row label="Target">
                <Pick label="Animated layer" value={action.target ?? null} placeholder={layers.length ? "Choose a layer" : "No animations on this screen"} groups={[layers.map((l) => ({ id: l.id, label: l.name }))]} onChange={(target) => onChange({ ...action, target })} />
            </Row>
            {action.type === "animation" ? (
                <Row label="Playback">
                    <Pick
                        label="Playback"
                        value={action.animation?.op ?? "toggle"}
                        groups={[
                            [
                                { id: "play", label: "Play" },
                                { id: "pause", label: "Pause" },
                                { id: "toggle", label: "Toggle" },
                            ],
                        ]}
                        onChange={(v) => onChange({ ...action, animation: { op: v as AnimationOp } })}
                    />
                </Row>
            ) : (
                <>
                    <Row label="Time">
                        <NumberField label="" icon={<Clock className="size-3" />} title="Playhead time (ms)" unit="ms" min={0} step={50} value={playhead.ms} onCommit={(ms) => onChange({ ...action, playhead: { ...playhead, ms } })} />
                    </Row>
                    <Row label="Then">
                        <Pick
                            label="After setting the playhead"
                            value={playhead.play ? "play" : "pause"}
                            groups={[
                                [
                                    { id: "play", label: "Play" },
                                    { id: "pause", label: "Stay paused" },
                                ],
                            ]}
                            onChange={(v) => onChange({ ...action, playhead: { ...playhead, play: v === "play" } })}
                        />
                    </Row>
                </>
            )}
        </>
    );
}

function VideoAction({ action, owner, doc, onChange }: { action: PrototypeAction; owner: SceneNode; doc: NagmaDocument; onChange: (next: PrototypeAction) => void }) {
    const op = action.video ?? { op: "toggle-play" as VideoOp, seconds: 0 };
    const group = menuKey(action);
    const layers = videoLayers(doc, owner);
    const setOp = (patch: Partial<typeof op>) => onChange({ ...action, video: { ...op, ...patch } });
    return (
        <>
            <Row label="Target">
                <Pick label="Video" value={action.target ?? null} placeholder={layers.length ? "Choose a video" : "No videos on this screen"} groups={[layers.map((l) => ({ id: l.id, label: l.name }))]} onChange={(target) => onChange({ ...action, target })} />
            </Row>
            {group === "video:play" && (
                <Row label="Playback">
                    <Pick
                        label="Playback"
                        value={op.op}
                        groups={[
                            [
                                { id: "play", label: "Play" },
                                { id: "pause", label: "Pause" },
                                { id: "toggle-play", label: "Play/pause" },
                            ],
                        ]}
                        onChange={(v) => setOp({ op: v as VideoOp })}
                    />
                </Row>
            )}
            {group === "video:mute" && (
                <Row label="Sound">
                    <Pick
                        label="Sound"
                        value={op.op}
                        groups={[
                            [
                                { id: "mute", label: "Mute" },
                                { id: "unmute", label: "Unmute" },
                                { id: "toggle-mute", label: "Mute/unmute" },
                            ],
                        ]}
                        onChange={(v) => setOp({ op: v as VideoOp })}
                    />
                </Row>
            )}
            {group === "video:time" && (
                <>
                    <Row label="Time">
                        <Pick
                            label="Time"
                            value={op.op === "seek" ? "seek" : op.seconds < 0 ? "back" : "forward"}
                            groups={[
                                [
                                    { id: "seek", label: "Jump to time" },
                                    { id: "forward", label: "Jump forward" },
                                    { id: "back", label: "Jump backward" },
                                ],
                            ]}
                            onChange={(v) => {
                                const amount = Math.abs(op.seconds) || 5;
                                setOp(v === "seek" ? { op: "seek", seconds: Math.abs(op.seconds) } : { op: "jump", seconds: v === "back" ? -amount : amount });
                            }}
                        />
                    </Row>
                    <Row label="Seconds">
                        <NumberField label="" icon={<Clock className="size-3" />} title="Seconds" unit="s" min={0} step={0.5} value={Math.abs(op.seconds)} onCommit={(n) => setOp({ seconds: op.op === "jump" && op.seconds < 0 ? -n : n })} />
                    </Row>
                </>
            )}
        </>
    );
}

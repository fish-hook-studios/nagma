import { describe } from "./expressions";
import { DEFAULT_OVERLAY, DEFAULT_TRANSITION, actionsOf, destinations, screenOf } from "./prototype";
import { hasAnimation } from "./animation";
import { videosOf } from "./prototype-runtime";
import type { ActionType, AnimationOp, Interaction, NagmaDocument, PrototypeAction, SceneNode, Trigger, VideoOp } from "./types";
import { gamepadButtonLabel } from "./gamepad";
import { findVariable } from "./variables";

// Names, defaults and one-line summaries for prototype triggers and actions (the Interaction details
// popover and the canvas use them).

export const TRIGGERS: [Trigger, string][] = [
    ["none", "None"],
    ["click", "On click"],
    ["drag", "On drag"],
    ["hover", "While hovering"],
    ["press", "While pressing"],
    ["key", "Key/Gamepad"],
    ["mouse-enter", "Mouse enter"],
    ["mouse-leave", "Mouse leave"],
    ["mouse-down", "Mouse down"],
    ["mouse-up", "Mouse up"],
    ["delay", "After delay"],
    ["video-time", "When video hits"],
    ["video-end", "When video ends"],
];

// The action menu. Video actions share one action type with an operation.
export const ACTION_MENU: [string, string][] = [
    ["navigate", "Navigate to"],
    ["change-to", "Change to"],
    ["back", "Back"],
    ["scroll-to", "Scroll to"],
    ["url", "Open link"],
    ["overlay", "Open overlay"],
    ["swap", "Swap overlay"],
    ["close", "Close overlay"],
    ["set-variable", "Set variable"],
    ["set-mode", "Set variable mode"],
    ["conditional", "Conditional"],
    ["video:play", "Play/pause video"],
    ["video:mute", "Mute/unmute video"],
    ["video:time", "Set video time"],
    ["animation", "Play/pause animation"],
    ["set-playhead", "Set playhead"],
];

// The trigger menu in the reference's groups (video triggers only for layers with a video fill).
export const TRIGGER_GROUPS: Trigger[][] = [["none"], ["click", "drag", "hover", "press", "key"], ["mouse-enter", "mouse-leave", "mouse-down", "mouse-up"], ["delay"], ["video-end", "video-time"]];

// The action menu in the reference's groups; "none" stands for no action.
export const ACTION_GROUPS: string[][] = [["none"], ["navigate", "change-to", "back", "scroll-to", "url"], ["set-variable", "set-mode", "conditional"], ["overlay", "swap", "close"], ["video:play", "video:mute", "video:time", "animation", "set-playhead"]];

export function actionLabel(key: string): string {
    return key === "none" ? "None" : (ACTION_MENU.find(([id]) => id === key)?.[1] ?? key);
}

export function triggerLabel(t: Trigger): string {
    return TRIGGERS.find(([id]) => id === t)?.[1] ?? t;
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", " ": "Space", Enter: "↵", Escape: "Esc", Backspace: "⌫", Tab: "⇥", Shift: "⇧", Meta: "⌘", Control: "⌃", Alt: "⌥" };

// A recorded key as shown in the panel: arrows as arrows, letters in capitals.
export function keyLabel(key: string | undefined): string {
    if (!key) return "";
    // Combinations are written with + between the modifiers and the key ("Shift+Meta+k").
    const parts = key.length > 1 && key.includes("+") ? key.split("+") : [key];
    return parts.map((k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join("");
}

// The short trigger name on an interaction row ("Click", "Key (→)", "After delay").
export function shortTriggerLabel(it: Pick<Interaction, "trigger" | "key" | "device" | "button">): string {
    switch (it.trigger) {
        case "none":
            return "None";
        case "click":
            return "Click";
        case "drag":
            return "Drag";
        case "hover":
            return "Hover";
        case "press":
            return "Press";
        case "key":
            if (it.device && it.device !== "keyboard") return `Gamepad (${gamepadButtonLabel(it.device, it.button) || "button"})`;
            return it.key ? `Key (${keyLabel(it.key)})` : "Key";
        case "delay":
            return "After delay";
        case "video-end":
            return "Video ends";
        case "video-time":
            return "Video hits";
        default:
            return triggerLabel(it.trigger);
    }
}

// The short target on an interaction row: where it goes, or what kind of step it is.
export function shortActionLabel(doc: NagmaDocument, it: Interaction): string {
    const actions = actionsOf(it);
    const first = actions[0];
    if (!first) return "None";
    if (actions.length > 1) return actions.some((a) => a.type === "conditional") ? "Conditional" : `${actions.length} actions`;
    const name = (id: string | null | undefined) => (id ? doc.nodes[id]?.name : undefined);
    switch (first.type) {
        case "navigate":
        case "overlay":
        case "swap":
        case "change-to":
        case "scroll-to":
            return name(first.target) ?? "None";
        case "conditional":
            return "Conditional";
        case "set-variable":
            return first.variableId ? (findVariable(doc, first.variableId)?.variable.name ?? "Set variable") : "Set variable";
        case "animation":
        case "set-playhead":
            return name(first.target) ?? "None";
        default:
            return actionSummary(doc, first);
    }
}

export function menuKey(action: PrototypeAction): string {
    if (action.type !== "video") return action.type;
    const op = action.video?.op ?? "play";
    return op === "play" || op === "pause" || op === "toggle-play" ? "video:play" : op === "mute" || op === "unmute" || op === "toggle-mute" ? "video:mute" : "video:time";
}

// A new action of a kind, keeping what still applies from the old one.
export function actionOfKind(key: string, old: PrototypeAction | null, doc: NagmaDocument, owner: SceneNode | undefined): PrototypeAction {
    const keepTarget = (types: ActionType[]) => (old && types.includes(old.type) ? old.target : undefined);
    const transition = old?.transition ?? { ...DEFAULT_TRANSITION };
    const own = owner ? screenOf(doc, owner)?.id : undefined;
    const firstScreen = destinations(doc).find((s) => s.id !== own)?.id ?? null;
    switch (key) {
        case "navigate":
        case "overlay":
        case "swap": {
            const a: PrototypeAction = { type: key, target: keepTarget(["navigate", "overlay", "swap"]) ?? firstScreen, transition };
            if (key === "navigate") a.resetScroll = true;
            if (key !== "navigate") a.overlay = old?.overlay ?? { ...DEFAULT_OVERLAY };
            return a;
        }
        case "change-to":
            return { type: "change-to", target: variantsFor(doc, owner)[0]?.id ?? null, transition: { ...transition, type: transition.type === "instant" ? "instant" : "smart" } };
        case "back":
            return { type: "back" };
        case "close":
            return { type: "close" };
        case "scroll-to":
            return { type: "scroll-to", target: null, transition: { ...transition, type: "instant" }, offset: { x: 0, y: 0 } };
        case "url":
            return { type: "url", url: "", newTab: true };
        case "set-variable":
            return { type: "set-variable", variableId: undefined, expression: "" };
        case "set-mode":
            return { type: "set-mode" };
        case "conditional":
            return { type: "conditional", blocks: [{ condition: "", actions: [] }] };
        case "animation":
            return { type: "animation", target: keepTarget(["animation", "set-playhead"]) ?? animatedLayersOn(doc, owner)[0]?.id ?? null, animation: { op: "toggle" } };
        case "set-playhead":
            return { type: "set-playhead", target: keepTarget(["animation", "set-playhead"]) ?? animatedLayersOn(doc, owner)[0]?.id ?? null, playhead: { ms: 0, play: false } };
        case "video:play":
            return { type: "video", target: keepTarget(["video"]) ?? videoLayers(doc, owner)[0]?.id ?? null, video: { op: "toggle-play", seconds: 0 } };
        case "video:mute":
            return { type: "video", target: keepTarget(["video"]) ?? videoLayers(doc, owner)[0]?.id ?? null, video: { op: "toggle-mute", seconds: 0 } };
        default:
            return { type: "video", target: keepTarget(["video"]) ?? videoLayers(doc, owner)[0]?.id ?? null, video: { op: "seek", seconds: 0 } };
    }
}

// Variants "Change to" can pick: the set the layer's component (or instance) belongs to.
export function variantsFor(doc: NagmaDocument, owner: SceneNode | undefined): SceneNode[] {
    let current = owner;
    while (current) {
        if (current.type === "component" && doc.nodes[current.parentId ?? ""]?.type === "componentSet") break;
        if (current.type === "instance" && current.componentId && doc.nodes[doc.nodes[current.componentId]?.parentId ?? ""]?.type === "componentSet") {
            current = doc.nodes[current.componentId];
            break;
        }
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    const set = current ? doc.nodes[current.parentId ?? ""] : undefined;
    return (set?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => n?.type === "component");
}

// Layers with a video fill on the owner's screen.
export function videoLayers(doc: NagmaDocument, owner: SceneNode | undefined): SceneNode[] {
    const screen = owner ? screenOf(doc, owner) : null;
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        if (videosOf(n).length) out.push(n);
        n.children.forEach(visit);
    };
    if (screen) visit(screen.id);
    else if (owner) visit(owner.id);
    return out;
}

// Layers with keyframe animations on the owner's screen.
export function animatedLayersOn(doc: NagmaDocument, owner: SceneNode | undefined): SceneNode[] {
    const screen = owner ? screenOf(doc, owner) : null;
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        if (hasAnimation(n)) out.push(n);
        n.children.forEach(visit);
    };
    if (screen) visit(screen.id);
    else if (owner) visit(owner.id);
    return out;
}

// One line describing an action, for summary rows.
export function actionSummary(doc: NagmaDocument, action: PrototypeAction): string {
    const name = (id: string | null | undefined) => (id ? doc.nodes[id]?.name : undefined);
    const varName = (id: string) => findVariable(doc, id)?.variable.name ?? "Missing variable";
    switch (action.type) {
        case "navigate":
            return name(action.target) ?? "None";
        case "change-to":
            return name(action.target) ?? "Change to";
        case "back":
            return "Back";
        case "scroll-to":
            return `Scroll to ${name(action.target) ?? "None"}`;
        case "url":
            return action.url || "Open link";
        case "overlay":
            return `Open ${name(action.target) ?? "overlay"}`;
        case "swap":
            return `Swap with ${name(action.target) ?? "overlay"}`;
        case "close":
            return "Close overlay";
        case "set-variable":
            return action.variableId ? `Set ${varName(action.variableId)}` : "Set variable";
        case "set-mode":
            return "Set variable mode";
        case "conditional": {
            const c = action.blocks?.[0]?.condition;
            return c ? `If ${describe(c, varName)}` : "Conditional";
        }
        case "video": {
            const op = action.video?.op;
            const labels: Record<VideoOp, string> = { play: "Play", pause: "Pause", "toggle-play": "Play/pause", mute: "Mute", unmute: "Unmute", "toggle-mute": "Mute/unmute", jump: "Jump", seek: "Set time of" };
            return `${op ? labels[op] : "Play"} ${name(action.target) ?? "video"}`;
        }
        case "animation": {
            const labels: Record<AnimationOp, string> = { play: "Play", pause: "Pause", toggle: "Play/pause" };
            return `${labels[action.animation?.op ?? "toggle"]} ${name(action.target) ?? "animation"}`;
        }
        case "set-playhead":
            return `Set playhead of ${name(action.target) ?? "animation"} to ${Math.round(action.playhead?.ms ?? 0)}ms`;
    }
}

export function interactionSummary(doc: NagmaDocument, it: Interaction): { trigger: string; action: string } {
    const actions = actionsOf(it);
    const first = actions[0];
    const rest = actions.length > 1 ? ` and ${actions.length - 1} more` : "";
    return { trigger: triggerLabel(it.trigger), action: first ? actionSummary(doc, first) + rest : "None" };
}


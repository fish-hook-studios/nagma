import { isFrameLike } from "./components";
import { layerRoots } from "./page";
import { easeTransition } from "./easing-curves";
import { literal } from "./expressions";
import type { Command, Interaction, NagmaDocument, OverlaySettings, PrototypeAction, SceneNode, Transition } from "./types";

export const DEFAULT_TRANSITION: Transition = { type: "instant", direction: "left", duration: 300, easing: "ease-out" };

export function navigateTo(target: string | null): Interaction {
    return { trigger: "click", delay: 800, actions: [navigateAction(target)] };
}

export function navigateAction(target: string | null): PrototypeAction {
    return { type: "navigate", target, transition: { ...DEFAULT_TRANSITION } };
}

// The actions of an interaction, in order. Older files stored one action (and an optional
// "only if" condition) on the interaction itself; those read as a one-action list, the condition
// becoming a conditional around it.
export function actionsOf(interaction: Interaction): PrototypeAction[] {
    if (interaction.actions) return interaction.actions;
    if (!interaction.action) return [];
    const action: PrototypeAction = { type: interaction.action };
    if (interaction.target !== undefined) action.target = interaction.target;
    if (interaction.url) action.url = interaction.url;
    if (interaction.transition) action.transition = interaction.transition;
    if (interaction.overlay) action.overlay = interaction.overlay;
    if (interaction.variableId) action.variableId = interaction.variableId;
    if (interaction.value !== undefined && typeof interaction.value !== "object") action.expression = literal(interaction.value);
    if (interaction.collectionId) action.collectionId = interaction.collectionId;
    if (interaction.modeId) action.modeId = interaction.modeId;
    const c = interaction.condition;
    if (c) return [{ type: "conditional", blocks: [{ condition: `{{${c.variableId}}} ${c.op} ${literal(c.value)}`, actions: [action] }] }];
    return [action];
}

// The interaction in the current shape: its actions in a list, without the older single-action fields.
export function normalizeInteraction(interaction: Interaction): Interaction {
    if (interaction.actions && !interaction.action) return interaction;
    const { trigger, delay, key, videoTime } = interaction;
    const out: Interaction = { trigger, delay, actions: actionsOf(interaction) };
    if (key !== undefined) out.key = key;
    if (videoTime !== undefined) out.videoTime = videoTime;
    return out;
}

// Every action of an interaction, including those inside conditionals, with its path of indexes
// (action index, then block index and action index for each conditional level).
export function walkActions(actions: PrototypeAction[], visit: (action: PrototypeAction, path: number[]) => void, path: number[] = []) {
    actions.forEach((action, i) => {
        visit(action, [...path, i]);
        action.blocks?.forEach((block, b) => walkActions(block.actions, visit, [...path, i, b]));
    });
}

// Replaces (or with null removes) the action at a path from walkActions.
export function updateActionAt(actions: PrototypeAction[], path: number[], next: PrototypeAction | null): PrototypeAction[] {
    const [i, b, ...rest] = path;
    if (i === undefined) return actions;
    if (b === undefined) return next ? actions.map((a, k) => (k === i ? next : a)) : actions.filter((_, k) => k !== i);
    return actions.map((a, k) =>
        k === i ? { ...a, blocks: (a.blocks ?? []).map((block, bi) => (bi === b ? { ...block, actions: updateActionAt(block.actions, rest, next) } : block)) } : a,
    );
}

export function actionAt(actions: PrototypeAction[], path: number[]): PrototypeAction | undefined {
    const [i, b, ...rest] = path;
    const a = i === undefined ? undefined : actions[i];
    if (!a || b === undefined) return a;
    const block = a.blocks?.[b];
    return block ? actionAt(block.actions, rest) : undefined;
}

// Where a prototype can go: top-level frames, and sections (which open at their first frame).
export function destinations(doc: NagmaDocument): SceneNode[] {
    return layerRoots(doc)
        .map((id) => doc.nodes[id])
        .filter((node): node is SceneNode => Boolean(node && (isFrameLike(node) || node.isSection)));
}

// A destination as a screen: a section resolves to its first frame.
export function resolveDestination(doc: NagmaDocument, id: string | null | undefined): string | null {
    const node = id ? doc.nodes[id] : undefined;
    if (!node) return null;
    if (!node.isSection) return node.id;
    for (const child of node.children) {
        const c = doc.nodes[child];
        if (c && isFrameLike(c) && !c.isSection) return c.id;
        const inner = resolveDestination(doc, child);
        if (inner && inner !== child) return inner;
    }
    return null;
}

// The top-level frame (screen) that holds a layer.
export function screenOf(doc: NagmaDocument, node: SceneNode): SceneNode | null {
    let current: SceneNode | undefined = node;
    while (current) {
        const parent: SceneNode | undefined = current.parentId ? doc.nodes[current.parentId] : undefined;
        if (parent?.type === "page") return isFrameLike(current) ? current : null;
        current = parent;
    }
    return null;
}

// Screens a prototype can show: the top-level frames on the active page.
export function screens(doc: NagmaDocument): SceneNode[] {
    return layerRoots(doc)
        .map((id) => doc.nodes[id])
        .filter((node): node is SceneNode => Boolean(node && isFrameLike(node)));
}

// Where a prototype starts: the screen holding the selection, else a flow start, else the first screen.
export function startScreen(doc: NagmaDocument, selection: string[]): string | null {
    const selected = doc.nodes[selection[0] ?? ""];
    const fromSelection = selected ? screenOf(doc, selected) : null;
    if (fromSelection) return fromSelection.id;
    const all = screens(doc);
    return (all.find((s) => s.flowStart) ?? all[0])?.id ?? null;
}

// Eased progress for a named curve (custom curves need the transition: see easeTransition).
export function easing(kind: Transition["easing"], t: number): number {
    return easeTransition({ easing: kind }, t);
}

export const DEFAULT_OVERLAY: OverlaySettings = { position: "center", x: 0, y: 0, background: true, backgroundColor: "#000000", backgroundOpacity: 0.45, closeOnOutside: false };

export function namePath(doc: NagmaDocument, node: SceneNode, root: SceneNode): string {
    const names: string[] = [];
    let current: SceneNode | undefined = node;
    while (current && current.id !== root.id) {
        names.unshift(current.name);
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return names.join("/");
}

export function subtree(doc: NagmaDocument, id: string): SceneNode[] {
    const node = doc.nodes[id];
    if (!node) return [];
    return [node, ...node.children.flatMap((child) => subtree(doc, child))];
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return t < 0.5 ? a : b;
    return `#${pa.map((v, i) => Math.round(lerp(v, pb[i] ?? v, t)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// Match animate: the target screen at time t, with every layer that also exists (by name path) on the
// source screen moved, sized, faded and recoloured from its old state. Layers only on the target fade in.
// Returns a document to draw plus the source-only layers to fade out.
export function smartTween(doc: NagmaDocument, fromId: string, toId: string, t: number): { doc: NagmaDocument; leaving: SceneNode[] } {
    return smartTweenDocs(doc, fromId, doc, toId, t);
}

// Match animate between two versions of the file (say, before and after a component changed variant):
// layers of `toId` in `doc` move from where their namesakes under `fromId` were in `before`.
export function smartTweenDocs(before: NagmaDocument, fromId: string, doc: NagmaDocument, toId: string, t: number): { doc: NagmaDocument; leaving: SceneNode[] } {
    const from = before.nodes[fromId];
    const to = doc.nodes[toId];
    if (!from || !to) return { doc, leaving: [] };
    const sources = new Map(subtree(before, fromId).slice(1).map((node) => [namePath(before, node, from), node]));
    const matched = new Set<string>();
    const nodes = { ...doc.nodes };
    for (const node of subtree(doc, toId).slice(1)) {
        const key = namePath(doc, node, to);
        const source = sources.get(key);
        if (!source) {
            nodes[node.id] = { ...node, opacity: node.opacity * t };
            continue;
        }
        matched.add(source.id);
        // Positions are compared relative to each screen's corner.
        const sx = source.x - from.x + to.x;
        const sy = source.y - from.y + to.y;
        const fills = node.fills.map((paint, i) => {
            const old = source.fills[i];
            return paint.type === "solid" && old?.type === "solid" ? { ...paint, color: lerpColor(old.color, paint.color, t), opacity: lerp(old.opacity, paint.opacity, t) } : paint;
        });
        nodes[node.id] = {
            ...node,
            x: lerp(sx, node.x, t),
            y: lerp(sy, node.y, t),
            w: lerp(source.w, node.w, t),
            h: lerp(source.h, node.h, t),
            opacity: lerp(source.opacity, node.opacity, t),
            radius: lerp(source.radius, node.radius, t),
            rotation: lerp(source.rotation, node.rotation, t),
            fills,
        };
    }
    const leaving = subtree(before, fromId)
        .slice(1)
        .filter((node) => !matched.has(node.id) && node.parentId === fromId)
        .map((node) => ({ ...node, opacity: node.opacity * (1 - t) }));
    return { doc: { ...doc, nodes }, leaving };
}

// Overlay settings belong to the overlay: changing them on one connection changes every
// connection that opens the same frame. Returns the commands that bring the others in line.
export function shareOverlayCommands(doc: NagmaDocument, target: string, overlay: OverlaySettings): Command[] {
    const same = JSON.stringify(overlay);
    const deep = (actions: PrototypeAction[]): { list: PrototypeAction[]; changed: boolean } => {
        let changed = false;
        const list = actions.map((a) => {
            let next = a;
            if (a.type === "overlay" && a.target === target && JSON.stringify(a.overlay ?? null) !== same) {
                next = { ...a, overlay: { ...overlay } };
                changed = true;
            }
            if (a.blocks) {
                const blocks = a.blocks.map((b) => {
                    const r = deep(b.actions);
                    if (r.changed) changed = true;
                    return r.changed ? { ...b, actions: r.list } : b;
                });
                if (blocks.some((b, i) => b !== a.blocks?.[i])) next = { ...next, blocks };
            }
            return next;
        });
        return { list, changed };
    };
    const out: Command[] = [];
    for (const n of Object.values(doc.nodes)) {
        if (!n.interactions?.length) continue;
        let touched = false;
        const interactions = n.interactions.map((it) => {
            const r = deep(actionsOf(it));
            if (!r.changed) return it;
            touched = true;
            return { ...normalizeInteraction(it), actions: r.list };
        });
        if (touched) out.push({ type: "node.update", id: n.id, patch: { interactions } });
    }
    return out;
}

// The settings an overlay already has on another connection, for a new one to the same frame.
export function overlaySettingsFor(doc: NagmaDocument, target: string): OverlaySettings | null {
    for (const n of Object.values(doc.nodes)) {
        for (const it of n.interactions ?? []) {
            let found: OverlaySettings | null = null;
            walkActions(actionsOf(it), (a) => {
                if (!found && a.type === "overlay" && a.target === target && a.overlay) found = a.overlay;
            });
            if (found) return found;
        }
    }
    return null;
}

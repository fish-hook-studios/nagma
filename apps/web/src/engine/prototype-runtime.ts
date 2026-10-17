import { animatedDoc, durationOf, hasAnimation } from "./animation";
import { syncInstances } from "./components";
import { MODE_PREFIX, test as testExpression, evaluate, type Value } from "./expressions";
import { syncLayouts } from "./layout";
import { DEFAULT_OVERLAY, DEFAULT_TRANSITION, actionsOf, overlaySettingsFor, resolveDestination, screenOf } from "./prototype";
import type { Interaction, NagmaDocument, OverlaySettings, PrototypeAction, SceneNode, Transition, VariableValue } from "./types";
import { collectionsOf, findVariable, resolveVariable, resolveVariables } from "./variables";

// The running prototype: which screen and overlays are showing, the variables' runtime values and
// modes, each interactive component's current variant, scroll positions, video playback and layer
// animations. Actions
// run in order against this state, and each step can ask the player to animate (an Effect).

export interface OverlayEntry {
    id: string;
    settings: OverlaySettings;
    // How it opened; closing plays it backwards.
    transition: Transition;
}

export interface VideoState {
    playing: boolean;
    muted: boolean;
    // A jump the player should make: to `seek` seconds, once per `token`.
    seek: number | null;
    token: number;
}

// A layer animation's playhead: at `time` milliseconds when `since` (a performance.now() time), and
// moving on from there while playing.
export interface AnimationClock {
    playing: boolean;
    time: number;
    since: number;
}

export interface HistoryEntry {
    screen: string;
    overlays: OverlayEntry[];
    // The navigation that left this screen, played backwards by Back.
    transition: Transition;
}

export interface PlayerState {
    screen: string;
    overlays: OverlayEntry[];
    history: HistoryEntry[];
    values: Record<string, VariableValue>;
    modes: Record<string, string>;
    // Instance id → the variant it shows now ("Change to").
    variants: Record<string, string>;
    // Frame id (screens included) → scroll offset in document pixels.
    scroll: Record<string, { x: number; y: number }>;
    // Video file id → playback.
    videos: Record<string, VideoState>;
    // Animated layer id → its playhead. Layers without one rest at the start.
    animations: Record<string, AnimationClock>;
}

export type Effect =
    | { kind: "navigate"; from: string; to: string; transition: Transition; reverse: boolean }
    | { kind: "overlay-open"; entry: OverlayEntry }
    | { kind: "overlay-close"; entry: OverlayEntry }
    // A component changed variant (`instance`, when known: the animation is scoped to it).
    | { kind: "change"; transition: Transition; before: PlayerState; instance?: string }
    | { kind: "scroll"; frame: string; from: { x: number; y: number }; to: { x: number; y: number }; transition: Transition }
    | { kind: "url"; url: string; newTab: boolean };

export interface RunContext {
    // The file as edited (no runtime changes).
    doc: NagmaDocument;
    // The layer whose interaction runs.
    source: string | null;
    // Seconds into a video now (for "jump forward/backward").
    videoTime?: (videoId: string) => number;
    // How far a frame can scroll, in document pixels.
    maxScroll?: (frameId: string) => { x: number; y: number };
    // The time now (performance.now()), for animation playheads.
    now?: number;
}

export function initialState(screen: string): PlayerState {
    return { screen, overlays: [], history: [], values: {}, modes: {}, variants: {}, scroll: {}, videos: {}, animations: {} };
}

// ---- Layer animations ----

// How far a playhead has run, before the animation's playback (once, loop, ping-pong) applies.
function elapsed(clock: AnimationClock, now: number): number {
    return clock.playing ? clock.time + Math.max(0, now - clock.since) : clock.time;
}

function playbackOf(doc: NagmaDocument, id: string): { duration: number; playback: "once" | "loop" | "ping-pong" } {
    let root = doc.nodes[id];
    while (root?.parentId && doc.nodes[root.parentId] && doc.nodes[root.parentId]?.type !== "page") root = doc.nodes[root.parentId];
    return { duration: Math.max(0, durationOf(doc, id)), playback: root?.animation?.playback ?? "once" };
}

// The time an animated layer shows, in milliseconds.
export function animationTime(doc: NagmaDocument, state: Pick<PlayerState, "animations">, id: string, now: number): number {
    const clock = state.animations[id];
    if (!clock) return 0;
    const { duration, playback } = playbackOf(doc, id);
    const t = elapsed(clock, now);
    if (duration <= 0) return 0;
    if (playback === "loop") return t % duration;
    if (playback === "ping-pong") {
        const r = t % (duration * 2);
        return r <= duration ? r : duration * 2 - r;
    }
    return Math.min(t, duration);
}

// Whether a playhead is moving (a "once" animation that reached its end has stopped).
export function animationPlaying(doc: NagmaDocument, state: Pick<PlayerState, "animations">, id: string, now: number): boolean {
    const clock = state.animations[id];
    if (!clock?.playing) return false;
    const { duration, playback } = playbackOf(doc, id);
    return playback !== "once" || elapsed(clock, now) < duration;
}

// The animated layers in a subtree (the layer itself included).
export function animatedIn(doc: NagmaDocument, rootId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        if (hasAnimation(n)) out.push(n);
        n.children.forEach(visit);
    };
    visit(rootId);
    return out;
}

// A screen or overlay appeared: its animations play from the start.
export function startAnimations(state: PlayerState, doc: NagmaDocument, rootId: string, now: number): PlayerState {
    const layers = animatedIn(doc, rootId);
    if (!layers.length) return state;
    const animations = { ...state.animations };
    for (const n of layers) animations[n.id] = { playing: true, time: 0, since: now };
    return { ...state, animations };
}

// The file with each animated layer drawn at its playhead.
export function animatedState(doc: NagmaDocument, state: Pick<PlayerState, "animations">, now: number): NagmaDocument {
    return animatedDoc(doc, (node) => animationTime(doc, state, node.id, now));
}

// The current value of a variable while playing.
export function variableValue(doc: NagmaDocument, state: Pick<PlayerState, "values" | "modes">, id: string): Value | undefined {
    // VAR_MODE_LOOKUP: a collection's current mode, by the collection's id or name.
    if (id.startsWith(MODE_PREFIX)) {
        const key = id.slice(MODE_PREFIX.length).trim().toLowerCase();
        const c = collectionsOf(doc).find((x) => x.id.toLowerCase() === key || x.name.toLowerCase() === key);
        if (!c) return undefined;
        const modeId = state.modes[c.id] ?? c.defaultModeId ?? c.modes[0]?.id;
        return c.modes.find((m) => m.id === modeId)?.name ?? "";
    }
    const r = resolveVariable(doc, id, null, { values: state.values, modes: state.modes });
    return r && typeof r.value !== "object" ? r.value : undefined;
}

// The file as the player shows it: variants swapped, variables at their runtime values.
export function displayDoc(doc: NagmaDocument, state: Pick<PlayerState, "values" | "modes" | "variants">): NagmaDocument {
    let next = doc;
    const swaps = Object.entries(state.variants).filter(([id, variant]) => doc.nodes[id] && doc.nodes[variant] && doc.nodes[id]?.componentId !== variant);
    if (swaps.length) {
        const nodes = { ...doc.nodes };
        for (const [id, variant] of swaps) {
            const node = nodes[id];
            if (node) nodes[id] = { ...node, componentId: variant };
        }
        next = { ...doc, nodes };
    }
    const overrides = { values: state.values, modes: state.modes };
    const hasRuntime = Object.keys(state.values).length || Object.keys(state.modes).length;
    if (!swaps.length && !hasRuntime) return doc;
    next = resolveVariables(next, overrides);
    if (next === doc) return doc;
    // Only the instances whose layers changed (a swapped variant, a variable-bound variant or
    // field) rebuild; then auto layout places what moved (padding, sizes, visibility).
    if (needsInstanceSync(doc, next)) next = resolveVariables(syncInstances(next, doc), overrides);
    return syncLayouts(next);
}

// Whether a change reaches instance contents: an instance shows another variant, or a layer of a
// component changed (its instances copy it). Fields set on plain layers need no rebuild.
function needsInstanceSync(before: NagmaDocument, doc: NagmaDocument): boolean {
    for (const id in doc.nodes) {
        const node = doc.nodes[id];
        const old = before.nodes[id];
        if (node === old || !node) continue;
        if (!old || (node.type === "instance" && node.componentId !== old.componentId)) return true;
        let current: SceneNode | undefined = node;
        while (current) {
            if (current.type === "component") return true;
            current = current.parentId ? doc.nodes[current.parentId] : undefined;
        }
    }
    return false;
}

// The instance a "Change to" acts on: the nearest instance (from the layer up) showing a variant of
// the same set as the destination.
export function changeTarget(doc: NagmaDocument, state: PlayerState, sourceId: string, variantId: string): string | null {
    const set = doc.nodes[variantId]?.parentId;
    if (!set) return null;
    let current: SceneNode | undefined = doc.nodes[sourceId];
    while (current) {
        if (current.type === "instance") {
            const showing = state.variants[current.id] ?? current.componentId;
            if (showing && doc.nodes[showing]?.parentId === set) return current.id;
        }
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return null;
}

// Every video file behind a layer's fills.
export function videosOf(node: SceneNode | undefined): string[] {
    if (!node) return [];
    return node.fills.flatMap((p) => (p.type === "image" && p.video ? [p.video.id] : []));
}

function videoIdsIn(doc: NagmaDocument, rootId: string): string[] {
    const out: string[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        out.push(...videosOf(n));
        n.children.forEach(visit);
    };
    visit(rootId);
    return out;
}

function within(doc: NagmaDocument, id: string, rootId: string): boolean {
    let current: SceneNode | undefined = doc.nodes[id];
    while (current) {
        if (current.id === rootId) return true;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return false;
}

// The frame that scrolls to bring a layer into view: its nearest ancestor with overflow scrolling,
// else its screen.
export function scrollerOf(doc: NagmaDocument, id: string): SceneNode | null {
    let current: SceneNode | undefined = doc.nodes[id]?.parentId ? doc.nodes[doc.nodes[id]?.parentId ?? ""] : undefined;
    while (current) {
        if (current.type !== "page" && current.overflow && current.overflow !== "none") return current;
        const parent: SceneNode | undefined = current.parentId ? doc.nodes[current.parentId] : undefined;
        if (!parent || parent.type === "page") return current;
        current = parent;
    }
    const node = doc.nodes[id];
    return node ? screenOf(doc, node) : null;
}

function coerce(doc: NagmaDocument, variableId: string, value: Value): VariableValue {
    const type = findVariable(doc, variableId)?.variable.type;
    if (type === "number") return typeof value === "number" ? value : Number(value) || 0;
    if (type === "boolean") return typeof value === "boolean" ? value : String(value).toLowerCase() === "true" || value === 1;
    return String(value);
}

// Runs actions in order. Later actions see what earlier ones did (a variable set first is read by a
// conditional after it).
export function runActions(start: PlayerState, actions: PrototypeAction[], ctx: RunContext): { state: PlayerState; effects: Effect[] } {
    let state = start;
    const effects: Effect[] = [];
    const lookup = (id: string) => variableValue(ctx.doc, state, id);
    const step = (action: PrototypeAction) => {
        const { doc } = ctx;
        const transition = action.transition ?? DEFAULT_TRANSITION;
        switch (action.type) {
            case "conditional": {
                for (const block of action.blocks ?? []) {
                    if (block.condition === null || testExpression(block.condition, lookup)) {
                        block.actions.forEach(step);
                        break;
                    }
                }
                return;
            }
            case "set-variable": {
                if (!action.variableId || !action.expression) return;
                const v = evaluate(action.expression, lookup);
                if (v === undefined) return;
                state = { ...state, values: { ...state.values, [action.variableId]: coerce(doc, action.variableId, v) } };
                return;
            }
            case "set-mode": {
                if (action.collectionId && action.modeId) state = { ...state, modes: { ...state.modes, [action.collectionId]: action.modeId } };
                return;
            }
            case "url": {
                const url = (action.url ?? "").trim();
                if (url) effects.push({ kind: "url", url: /^[a-z]+:/i.test(url) ? url : `https://${url}`, newTab: action.newTab ?? true });
                return;
            }
            case "back": {
                if (state.overlays.length && !state.history.length) {
                    // Nothing to go back to but an overlay: close it.
                    const entry = state.overlays[state.overlays.length - 1];
                    if (entry) effects.push({ kind: "overlay-close", entry });
                    state = { ...state, overlays: state.overlays.slice(0, -1) };
                    return;
                }
                const previous = state.history[state.history.length - 1];
                if (!previous) return;
                effects.push({ kind: "navigate", from: state.screen, to: previous.screen, transition: previous.transition, reverse: true });
                state = { ...state, screen: previous.screen, overlays: previous.overlays, history: state.history.slice(0, -1) };
                state = manageState(state, ctx, previous.screen, action);
                return;
            }
            case "close": {
                const entry = state.overlays[state.overlays.length - 1];
                if (!entry) return;
                effects.push({ kind: "overlay-close", entry });
                state = { ...state, overlays: state.overlays.slice(0, -1) };
                return;
            }
            case "navigate": {
                const to = resolveDestination(doc, action.target);
                if (!to) return;
                const from = state.overlays.length ? state.screen : state.screen;
                effects.push({ kind: "navigate", from, to, transition, reverse: false });
                state = { ...state, history: [...state.history, { screen: state.screen, overlays: state.overlays, transition }], screen: to, overlays: [] };
                state = manageState(state, ctx, to, action);
                return;
            }
            case "overlay": {
                const id = resolveDestination(doc, action.target);
                if (!id) return;
                const entry: OverlayEntry = { id, settings: action.overlay ?? overlaySettingsFor(doc, id) ?? DEFAULT_OVERLAY, transition };
                effects.push({ kind: "overlay-open", entry });
                state = { ...state, overlays: [...state.overlays, entry] };
                state = manageState(state, ctx, id, action);
                return;
            }
            case "swap": {
                const id = resolveDestination(doc, action.target);
                if (!id) return;
                const old = state.overlays[state.overlays.length - 1];
                if (!old) {
                    // Swap with no overlay open swaps the screen itself.
                    effects.push({ kind: "navigate", from: state.screen, to: id, transition, reverse: false });
                    state = startAnimations({ ...state, screen: id }, doc, id, ctx.now ?? performance.now());
                    return;
                }
                const entry: OverlayEntry = { id, settings: action.overlay ?? old.settings, transition };
                effects.push({ kind: "overlay-close", entry: { ...old, transition: { ...transition, type: transition.type === "instant" ? "instant" : "dissolve" } } });
                effects.push({ kind: "overlay-open", entry });
                state = { ...state, overlays: [...state.overlays.slice(0, -1), entry] };
                state = manageState(state, ctx, id, action);
                return;
            }
            case "change-to": {
                if (!action.target || !ctx.source) return;
                const instance = changeTarget(doc, state, ctx.source, action.target);
                if (!instance) return;
                const before = state;
                state = { ...state, variants: { ...state.variants, [instance]: action.target } };
                effects.push({ kind: "change", transition, before, instance });
                return;
            }
            case "scroll-to": {
                const target = action.target ? doc.nodes[action.target] : undefined;
                if (!target) return;
                const frame = scrollerOf(doc, target.id);
                if (!frame) return;
                const offset = action.offset ?? { x: 0, y: 0 };
                const max = ctx.maxScroll?.(frame.id) ?? { x: Infinity, y: Infinity };
                const wantX = frame.overflow === "horizontal" || frame.overflow === "both" ? target.x - frame.x - offset.x : 0;
                const wantY = frame.overflow === "horizontal" ? 0 : target.y - frame.y - offset.y;
                const to = { x: Math.max(0, Math.min(max.x, wantX)), y: Math.max(0, Math.min(max.y, wantY)) };
                const from = state.scroll[frame.id] ?? { x: 0, y: 0 };
                effects.push({ kind: "scroll", frame: frame.id, from, to, transition });
                state = { ...state, scroll: { ...state.scroll, [frame.id]: to } };
                return;
            }
            case "animation":
            case "set-playhead": {
                if (!action.target || !doc.nodes[action.target]) return;
                const now = ctx.now ?? performance.now();
                const animations = { ...state.animations };
                for (const n of animatedIn(doc, action.target)) {
                    const at = animationTime(doc, state, n.id, now);
                    const playing = animationPlaying(doc, state, n.id, now);
                    if (action.type === "set-playhead") {
                        const p = action.playhead ?? { ms: 0, play: false };
                        animations[n.id] = { playing: p.play, time: Math.max(0, Math.min(playbackOf(doc, n.id).duration, p.ms)), since: now };
                        continue;
                    }
                    const op = action.animation?.op ?? "toggle";
                    const play = op === "play" || (op === "toggle" && !playing);
                    if (!play) animations[n.id] = { playing: false, time: at, since: now };
                    else if (!playing) {
                        // Playing an animation that ran to its end starts it over.
                        const { duration, playback } = playbackOf(doc, n.id);
                        animations[n.id] = { playing: true, time: playback === "once" && at >= duration ? 0 : at, since: now };
                    }
                }
                state = { ...state, animations };
                return;
            }
            case "video": {
                const node = action.target ? doc.nodes[action.target] : undefined;
                const op = action.video;
                if (!node || !op) return;
                const videos = { ...state.videos };
                for (const id of videosOf(node)) {
                    const cur = videos[id] ?? { playing: false, muted: false, seek: null, token: 0 };
                    const fill = node.fills.find((p) => p.type === "image" && p.video?.id === id);
                    const baseMuted = fill?.type === "image" ? Boolean(fill.video?.muted) : false;
                    const muted = videos[id] ? cur.muted : baseMuted;
                    let next: VideoState = { ...cur, muted };
                    if (op.op === "play") next.playing = true;
                    if (op.op === "pause") next.playing = false;
                    if (op.op === "toggle-play") next.playing = !cur.playing;
                    if (op.op === "mute") next.muted = true;
                    if (op.op === "unmute") next.muted = false;
                    if (op.op === "toggle-mute") next.muted = !muted;
                    if (op.op === "seek") next = { ...next, seek: Math.max(0, op.seconds), token: cur.token + 1 };
                    if (op.op === "jump") next = { ...next, seek: Math.max(0, (ctx.videoTime?.(id) ?? 0) + op.seconds), token: cur.token + 1 };
                    videos[id] = next;
                }
                state = { ...state, videos };
                return;
            }
        }
    };
    actions.forEach(step);
    return { state, effects };
}

// State management on arrival: reset the destination's scroll, its components' variants and its videos.
// Older interactions (no setting) reset scroll, which is what they did before.
// The destination's animations play from the start.
function manageState(state: PlayerState, ctx: RunContext, rootId: string, action: PrototypeAction): PlayerState {
    const { doc } = ctx;
    let next = startAnimations(state, doc, rootId, ctx.now ?? performance.now());
    if (action.resetScroll ?? true) {
        const scroll = Object.fromEntries(Object.entries(state.scroll).filter(([id]) => !within(doc, id, rootId)));
        next = { ...next, scroll };
    }
    if (action.resetState) {
        const variants = Object.fromEntries(Object.entries(state.variants).filter(([id]) => !within(doc, id, rootId)));
        next = { ...next, variants };
    }
    if (action.resetVideo) {
        const videos = { ...next.videos };
        for (const id of videoIdsIn(doc, rootId)) {
            const cur = videos[id];
            videos[id] = { playing: cur?.playing ?? false, muted: cur?.muted ?? false, seek: 0, token: (cur?.token ?? 0) + 1 };
        }
        next = { ...next, videos };
    }
    return next;
}

export function runInteraction(state: PlayerState, interaction: Interaction, ctx: RunContext) {
    return runActions(state, actionsOf(interaction), ctx);
}

// "While hovering" and "While pressing": what to put back when the pointer leaves or lets go.
// `ran` are the effects the hover or press made, so the way back plays the same animations.
export function revertTo(current: PlayerState, before: PlayerState, ran: Effect[]): { state: PlayerState; effects: Effect[] } {
    const effects: Effect[] = [];
    const state: PlayerState = { ...current, variants: before.variants, overlays: before.overlays, screen: before.screen, history: before.history };
    if (current.screen !== before.screen) {
        const nav = ran.find((e): e is Extract<Effect, { kind: "navigate" }> => e.kind === "navigate");
        effects.push({ kind: "navigate", from: current.screen, to: before.screen, transition: nav?.transition ?? DEFAULT_TRANSITION, reverse: true });
    } else if (current.overlays.length > before.overlays.length) {
        for (const entry of current.overlays.slice(before.overlays.length).reverse()) effects.push({ kind: "overlay-close", entry });
    }
    if (current.variants !== before.variants) {
        const change = ran.find((e): e is Extract<Effect, { kind: "change" }> => e.kind === "change");
        effects.push({ kind: "change", transition: change?.transition ?? DEFAULT_TRANSITION, before: current });
    }
    return { state, effects };
}

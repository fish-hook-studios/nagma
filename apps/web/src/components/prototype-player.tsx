import { ArrowLeft, ArrowRight, Check, ChevronDown, Expand01, LayoutLeft, LinkExternal01, MessageCircle01, Minimize01, RefreshCcw01, Sliders04, XClose } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Header as AriaHeader, Section as AriaSection, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { nodeContains } from "../canvas/hit-test";
import { type Box, bezelPad, drawBezel, drawBezelOverlay, screenRadius } from "../canvas/device-frame";
import { type Viewport, OPPOSITE, drawLayers, drawScreen, drawTransition } from "../canvas/screen";
import { drawNode } from "../canvas/render";
import { stopPresenting } from "../engine/camera";
import { collab, sendPresence, useCollab } from "../engine/collab";
import { follow, setSpotlight, stopFollowing } from "../engine/follow";
import { usePresentTabs } from "../engine/desktop";
import { closeTab } from "../engine/files";
import { protoTabId } from "../engine/prototype-view";
import { Avatar } from "./avatar";
import { ShareButton } from "./collab-ui";
import { FlowDescription } from "./flow-description";
import { NagmaLogo } from "./nagma-logo";
import { CATEGORY_LABELS, DEVICES, type Device, deviceById, deviceScreen, matchingDevice } from "../engine/devices";
import { easeTransition, transitionDuration } from "../engine/easing-curves";
import { hexToRgba } from "../engine/paint";
import { applyCommand } from "../engine/commands";
import { hasOffline, removeOffline, saveOffline } from "../engine/offline";
import { isEffectivelyVisible } from "../engine/nodes";
import { DEFAULT_TRANSITION, actionsOf, smartTweenDocs } from "../engine/prototype";
import { copyFlowLink, flowFor, flowLabel, flowsOf, frameList } from "../engine/prototype-flows";
import { type Effect, type OverlayEntry, type PlayerState, animatedState, displayDoc, initialState, revertTo, runInteraction, startAnimations } from "../engine/prototype-runtime";
import { editor, useEditor } from "../engine/store";
import type { Interaction, NagmaDocument, OverlaySettings, SceneNode, Transition, Trigger } from "../engine/types";
import { resolveTransition } from "../engine/variables";
import { cachedPlayer, getPlayer, showLive, stopPlayback, videoPaints } from "../engine/video";
import { presentLinkOptions } from "../engine/present-link";
import { GamepadWatcher, isController } from "../engine/gamepad";
import { canDecodeGifs, gifPlayback, isGif, setGifClock } from "../engine/gif";

// ---- Viewer options, remembered per browser ----

type Scaling = "fit" | "width" | "fill" | "responsive" | "actual";
interface Options {
    scaling: Scaling;
    hints: boolean;
    hideUi: boolean;
    sidebar: boolean;
    // With a device set: draw its frame around the screen.
    deviceFrame: boolean;
    // The viewer's keys (R restart, arrows, Z scaling, F, C); off, they reach the prototype only.
    shortcuts: boolean;
    // Accessibility: transitions become a short dissolve; Tab moves a visible focus between hotspots.
    reduceMotion: boolean;
    focusOutlines: boolean;
    // The device switcher: the file's device (undefined), just the frame ("none"), or another device.
    device?: string;
}
const OPTIONS_KEY = "nagma.player.v1";
const SCALINGS: [Scaling, string][] = [
    ["fit", "Fit, scale down to fit"],
    ["width", "Fit width"],
    ["fill", "Fill"],
    ["responsive", "Responsive"],
    ["actual", "Actual size"],
];

function loadOptions(fallback: Scaling): Options {
    const hideUi = presentLinkOptions.hideUi;
    presentLinkOptions.hideUi = false;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const base: Options = { scaling: fallback, hints: true, hideUi, sidebar: false, deviceFrame: true, shortcuts: true, reduceMotion: reduce, focusOutlines: false };
    try {
        const raw = localStorage.getItem(OPTIONS_KEY);
        return raw ? { ...base, ...(JSON.parse(raw) as Partial<Options>), hideUi } : base;
    } catch {
        return base;
    }
}

function saveOptions(options: Options) {
    try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
        // Private windows: options last for the session only.
    }
}

// ---- Geometry ----

const VECTOR = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } } as const;
const NO_OVERLAY: OverlaySettings = { position: "center", x: 0, y: 0, background: false, backgroundColor: "#000000", backgroundOpacity: 0, closeOnOutside: false };

interface Stage {
    // Where a screen sits (CSS pixels).
    place: (frame: SceneNode) => { scale: number; x: number; y: number };
    // A device's screen clips the prototype.
    clip: { box: Box; radius: number } | null;
    // The area the screen shows through, for travel distances and scrolling.
    view: Box;
    device: { device: Device; color: number; screen: Box; s: number; landscape: boolean } | null;
}

// The preview panel is sized to the frame, so it fits edge to edge (margin 0).
function makeStage(area: Box, scaling: Scaling, margin = 24, deviceFrame = true, setting: DeviceSetting | undefined = undefined): Stage {
    const ds = deviceScreen(setting);
    if (!ds) {
        const place = (f: SceneNode) => {
            const scale =
                scaling === "actual" || scaling === "responsive" ? 1 : scaling === "width" ? area.w / f.w : scaling === "fill" ? Math.min(area.w / f.w, area.h / f.h) : Math.min(1, (area.w - margin * 2) / f.w, (area.h - margin * 2) / f.h);
            const x = area.x + (area.w - f.w * scale) / 2;
            const y = f.h * scale <= area.h ? area.y + (area.h - f.h * scale) / 2 : area.y;
            return { scale, x, y };
        };
        return { place, clip: null, view: area, device: null };
    }
    // Without its frame the device is just its screen.
    const kind = deviceFrame ? (ds.device?.bezel ?? "none") : "none";
    const landscape = Boolean(setting?.landscape && ds.w > ds.h);
    const pad = bezelPad(kind, landscape);
    const outer = { w: ds.w + pad.left + pad.right, h: ds.h + pad.top + pad.bottom };
    const fitAll = Math.min((area.w - margin * 2) / outer.w, (area.h - margin * 2) / outer.h);
    const d = scaling === "actual" ? 1 : scaling === "fill" || scaling === "width" || scaling === "responsive" ? fitAll : Math.min(1, fitAll);
    const ox = area.x + (area.w - outer.w * d) / 2;
    const oy = area.y + Math.max(0, (area.h - outer.h * d) / 2);
    const screen: Box = { x: ox + pad.left * d, y: oy + pad.top * d, w: ds.w * d, h: ds.h * d };
    const presentation = ds.device?.category === "presentation";
    const place = (f: SceneNode) => {
        // A device shows the frame at its own width (taller frames scroll); a presentation fits it.
        const scale = presentation ? Math.min(screen.w / f.w, screen.h / f.h) : screen.w / f.w;
        const x = screen.x + (screen.w - f.w * scale) / 2;
        const y = presentation ? screen.y + (screen.h - f.h * scale) / 2 : screen.y;
        return { scale, x, y };
    };
    const colors = ds.device?.colors ?? [];
    const color = Math.max(0, colors.findIndex((c) => c.name === setting?.color));
    return {
        place,
        clip: { box: screen, radius: screenRadius(kind) * d },
        view: screen,
        device: ds.device && deviceFrame ? { device: ds.device, color, screen, s: d, landscape } : null,
    };
}

type DeviceSetting = NonNullable<NonNullable<NagmaDocument["prototype"]>["device"]>;

// The device the viewer picked in the switcher, or the file's.
function viewerDevice(doc: NagmaDocument, choice: string | undefined, start?: SceneNode): DeviceSetting | undefined {
    if (choice === undefined) {
        const own = doc.prototype?.device;
        if (own || !start) return own;
        // No device chosen yet: a frame made from a device preset shows in that device.
        const match = matchingDevice(start.w, start.h);
        return match ? { id: match.id, landscape: start.w > start.h && match.width < match.height } : undefined;
    }
    if (choice === "none") return undefined;
    const own = doc.prototype?.device;
    return own?.id === choice ? own : { id: choice };
}

// Responsive: the screen takes the view's size (its layers follow their constraints and auto
// layout); a screen that scrolls keeps its height.
function responsiveDoc(doc: NagmaDocument, screenId: string, view: Box): NagmaDocument {
    const frame = doc.nodes[screenId];
    if (!frame || (Math.round(frame.w) === Math.round(view.w) && Math.round(frame.h) === Math.round(view.h))) return doc;
    const scrolls = frame.overflow === "vertical" || frame.overflow === "both";
    const h = scrolls && frame.h > view.h ? frame.h : view.h;
    return applyCommand(doc, { type: "node.update", id: screenId, patch: { w: Math.max(1, Math.round(view.w)), h: Math.max(1, Math.round(h)) } });
}

// Reduce motion: anything that moves becomes a short dissolve.
function calm(t: Transition, on: boolean): Transition {
    if (!on || t.type === "instant" || t.type === "dissolve") return t;
    return { ...t, type: "dissolve", duration: Math.min(t.duration || 200, 200), easing: "linear" };
}

// Whether the prototype's device draws a frame (a bezel) that can be shown or hidden.
function hasDeviceFrame(setting: Parameters<typeof deviceScreen>[0]): boolean {
    const kind = deviceScreen(setting)?.device?.bezel;
    return Boolean(kind && kind !== "none");
}

// Where an overlay frame sits over its screen, in document units relative to the screen's corner.
function overlayOffset(screen: SceneNode, overlay: SceneNode, settings: OverlaySettings, viewH: number): { x: number; y: number } {
    const w = screen.w;
    const h = Math.min(screen.h, viewH);
    const p = settings.position;
    if (p === "manual") return { x: settings.x, y: settings.y };
    const x = p.endsWith("left") ? 0 : p.endsWith("right") ? w - overlay.w : (w - overlay.w) / 2;
    const y = p.startsWith("top") ? 0 : p.startsWith("bottom") ? h - overlay.h : (h - overlay.h) / 2;
    return { x, y };
}

// Frames with overflow scrolling: their descendants shift by the frame's scroll offset (the screens
// in `skip` scroll by moving the whole drawing instead).
function scrolledDoc(doc: NagmaDocument, offsets: Record<string, { x: number; y: number }>, skip: Set<string>): NagmaDocument {
    const entries = Object.entries(offsets).filter(([id, o]) => !skip.has(id) && (o.x || o.y) && doc.nodes[id]);
    if (!entries.length) return doc;
    const nodes = { ...doc.nodes };
    const shift = (id: string, dx: number, dy: number) => {
        const n = nodes[id];
        if (!n) return;
        nodes[id] = { ...n, x: n.x - dx, y: n.y - dy };
        for (const c of n.children) shift(c, dx, dy);
    };
    for (const [id, o] of entries) for (const c of doc.nodes[id]?.children ?? []) shift(c, o.x, o.y);
    return { ...doc, nodes };
}

function scrollableAt(doc: NagmaDocument, screenId: string, x: number, y: number): SceneNode | null {
    let found: SceneNode | null = null;
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n || !n.visible) return;
        if (n.id !== screenId && n.overflow && n.overflow !== "none" && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) found = n;
        n.children.forEach(visit);
    };
    visit(screenId);
    return found;
}

// How far a frame's content reaches past its edges.
function contentOverflow(doc: NagmaDocument, frame: SceneNode): { x: number; y: number } {
    let right = frame.x + frame.w;
    let bottom = frame.y + frame.h;
    for (const id of frame.children) {
        const n = doc.nodes[id];
        if (!n || !n.visible) continue;
        right = Math.max(right, n.x + n.w);
        bottom = Math.max(bottom, n.y + n.h);
    }
    return { x: Math.max(0, right - frame.x - frame.w), y: Math.max(0, bottom - frame.y - frame.h) };
}

function pinned(doc: NagmaDocument, screenId: string): SceneNode[] {
    const screen = doc.nodes[screenId];
    return (screen?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && (n.scrollPosition === "fixed" || n.scrollPosition === "sticky")));
}

// The topmost layer under a point with an interaction for one of the triggers, walking up from the
// layer hit to its nearest ancestor that has one.
function interactiveAt(doc: NagmaDocument, screenId: string, x: number, y: number, triggers: Trigger[]): { node: SceneNode; interaction: Interaction } | null {
    const order: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node || !isEffectivelyVisible(doc, node)) return;
        order.push(node);
        node.children.forEach(visit);
    };
    visit(screenId);
    for (let i = order.length - 1; i >= 0; i--) {
        const node = order[i];
        if (!node || node.type === "group" || !nodeContains(doc, node, x, y)) continue;
        let current: SceneNode | undefined = node;
        while (current) {
            for (const trigger of triggers) {
                const interaction = current.interactions?.find((it) => it.trigger === trigger);
                if (interaction) return { node: current, interaction };
            }
            if (current.id === screenId) break;
            current = current.parentId ? doc.nodes[current.parentId] : undefined;
        }
    }
    return null;
}

function linkAt(doc: NagmaDocument, screenId: string, x: number, y: number): string | null {
    let found: string | null = null;
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n || !n.visible) return;
        if (n.hyperlink && nodeContains(doc, n, x, y)) found = n.hyperlink;
        n.children.forEach(visit);
    };
    visit(screenId);
    return found;
}

function subtreeOf(doc: NagmaDocument, id: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        out.push(n);
        n.children.forEach(visit);
    };
    visit(id);
    return out;
}

const topOf = (st: PlayerState) => st.overlays[st.overlays.length - 1]?.id ?? st.screen;

// ---- Animations in flight ----

interface Running {
    start: number;
    duration: number;
    transition: Transition;
}
type NavAnim = Running & { from: string; to: string; reverse: boolean };
type OverlayAnim = Running & { entry: OverlayEntry; closing: boolean };
type ChangeAnim = Running & { before: NagmaDocument; screen: string };
type ScrollAnim = Running & { from: { x: number; y: number }; to: { x: number; y: number } };

function progress(a: Running, now: number): number {
    return a.duration <= 0 ? 1 : Math.min(1, (now - a.start) / a.duration);
}

// While hovering / while pressing: the state before, where the hotspot was, and what ran.
interface Held {
    node: string;
    rect: Box;
    before: PlayerState;
    ran: Effect[];
}

// Plays a prototype full screen: the device, the screens and their interactions, with the reference's
// presentation chrome (flows sidebar, bottom bar, options) around it.
// Where the player sits: a prototype tab (the area under the tab bar, with its toolbar), or the
// preview panel docked on the canvas (a slim header; keys reach it only while it has focus).
type Variant = "tab" | "panel";
const TOOLBAR_H = 36;
const HEADER_H = 28;

export function PrototypePlayer({
    startId,
    variant = "tab",
    active = true,
    onClose,
    onPopOut,
    panelControls,
}: {
    startId: string;
    variant?: Variant;
    // The preview panel's size controls (Resize to 100%, Respect aspect ratio).
    panelControls?: PanelControls;
    // A prototype tab stays mounted while its file's tab shows, hidden and still.
    active?: boolean;
    onClose?: () => void;
    onPopOut?: (screenId: string) => void;
}) {
    const base = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    // The first screen's animations play from the start.
    const stateRef = useRef<PlayerState>(null as unknown as PlayerState);
    if (!stateRef.current) stateRef.current = startAnimations(initialState(startId), base, startId, performance.now());
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    const state = stateRef.current;
    // The file as the state shows it, worked out once per change of state (timers, the draw loop and
    // rendering all ask for it).
    const shownRef = useRef<{ base: NagmaDocument; st: Pick<PlayerState, "values" | "modes" | "variants">; doc: NagmaDocument } | null>(null);
    const shownDoc = (b: NagmaDocument, st: Pick<PlayerState, "values" | "modes" | "variants">) => {
        const c = shownRef.current;
        if (c && c.base === b && c.st.values === st.values && c.st.modes === st.modes && c.st.variants === st.variants) return c.doc;
        const d = displayDoc(b, st);
        shownRef.current = { base: b, st, doc: d };
        return d;
    };
    const shown = shownDoc(base, state);
    const docRef = useRef(shown);
    const baseRef = useRef(base);
    baseRef.current = base;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 1, height: 1 });
    const [options, setOptionsState] = useState<Options>(() => loadOptions(base.prototype?.scaling === "width" ? "width" : "fit"));
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const setOptions = (patch: Partial<Options>) =>
        setOptionsState((o) => {
            const next = { ...o, ...patch };
            saveOptions(next);
            return next;
        });
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [flowId, setFlowId] = useState<string | null>(() => flowFor(base, startId)?.id ?? null);
    const comments = useCollab((s) => s.comments);
    const background = base.prototype?.background ?? "#111114";

    const nav = useRef<NavAnim | null>(null);
    const overlayAnims = useRef<OverlayAnim[]>([]);
    const change = useRef<ChangeAnim | null>(null);
    // Components changing variant at the same time each animate on their own (interactive
    // components with "after delay" loops run side by side).
    const changes = useRef(new Map<string, ChangeAnim>());
    // "After delay" timers by the layer they belong to, so a component that changed variant can start
    // its new variant's timers without restarting everyone else's.
    // They fire on the first frame at or after they're due, and never on the frame that started them,
    // so a loop of short delays advances once per frame.
    const delayTimers = useRef(new Map<string, { due: number; frame: number; interaction: Interaction }[]>());
    const frameCount = useRef(0);
    const scrolls = useRef(new Map<string, ScrollAnim>());
    const flash = useRef(0);
    // The hotspot Tab moved to (focus outlines).
    const focusedHotspot = useRef<string | null>(null);
    const hovered = useRef<string | null>(null);
    const hoverHeld = useRef<Held | null>(null);
    const pressHeld = useRef<Held | null>(null);
    const pressStart = useRef<{ x: number; y: number; fired: boolean } | null>(null);
    // On drag: the interaction being dragged, where the drag started, the screen it goes to (for a
    // navigate with a direction, the destination slides with the pointer) and how far along it is.
    const drag = useRef<{ node: string; interaction: Interaction; start: { x: number; y: number }; to: string | null; transition: Transition; t: number; axis: { x: number; y: number } | null } | null>(null);
    // Let go early: the destination slides back.
    const snapBack = useRef<(Running & { to: string; t0: number }) | null>(null);
    const dragged = useRef(false);
    // GIF fills in browsers without ImageDecoder: <img> elements laid over the fills.
    const [gifOverlays, setGifOverlays] = useState<{ key: string; src: string; box: Box; radius: number }[]>([]);
    const videoSeen = useRef(new Map<string, { token: number; last: number; ended: boolean }>());
    // Screens gone back from, newest last, for the preview's forward button.
    const ahead = useRef<string[]>([]);

    // The player fills its box (the tab's area, or the panel), not the window.
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const measure = () => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) setSize((s) => (s.width === Math.round(r.width) && s.height === Math.round(r.height) ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const top = topOf(state);
    const panel = variant === "panel";
    const ui = panel || !options.hideUi;
    const sidebarW = !panel && ui && options.sidebar ? 240 : 0;
    const commentsW = !panel && ui && commentsOpen ? 280 : 0;
    const barH = panel ? HEADER_H : ui ? TOOLBAR_H : 0;
    // In a tab, the device switcher and Restart sit in a strip along the bottom.
    const bottomH = !panel && ui ? 44 : 0;
    const area: Box = { x: sidebarW, y: barH, w: Math.max(1, size.width - sidebarW - commentsW), h: Math.max(1, size.height - barH - bottomH) };
    const deviceSetting = viewerDevice(shown, options.device, shown.nodes[startId]);
    const responsive = options.scaling === "responsive" && !deviceScreen(deviceSetting);
    // Responsive: the screen at the view's size, worked out once per change (the draw loop asks too).
    const responsiveRef = useRef<{ on: boolean; w: number; h: number; from: NagmaDocument | null; screen: string; key: string; doc: NagmaDocument | null }>({ on: false, w: 0, h: 0, from: null, screen: "", key: "", doc: null });
    responsiveRef.current.on = responsive;
    responsiveRef.current.w = area.w;
    responsiveRef.current.h = area.h;
    const viewDoc = (d: NagmaDocument, screen: string): NagmaDocument => {
        const r = responsiveRef.current;
        if (!r.on) return d;
        const key = `${Math.round(r.w)}x${Math.round(r.h)}`;
        if (r.from === d && r.screen === screen && r.key === key && r.doc) return r.doc;
        const out = responsiveDoc(d, screen, { x: 0, y: 0, w: r.w, h: r.h });
        Object.assign(r, { from: d, screen, key, doc: out });
        return out;
    };
    const doc = viewDoc(shown, state.screen);
    docRef.current = doc;
    const stage = makeStage(area, options.scaling, panel ? 0 : 24, options.deviceFrame, deviceSetting);
    const stageRef = useRef(stage);
    stageRef.current = stage;

    // Placement of a frame: the screen on the stage; overlays relative to the screen under them.
    const placeOf = (id: string, st: PlayerState = stateRef.current) => {
        const d = docRef.current;
        const sg = stageRef.current;
        const screen = d.nodes[st.screen];
        const frame = d.nodes[id];
        if (!frame) return { scale: 1, x: 0, y: 0 };
        if (!screen || id === st.screen) return sg.place(frame);
        const p = sg.place(screen);
        const entry = st.overlays.find((o) => o.id === id) ?? overlayAnims.current.find((a) => a.entry.id === id)?.entry;
        const off = overlayOffset(screen, frame, entry?.settings ?? NO_OVERLAY, (sg.view.y + sg.view.h - p.y) / p.scale);
        return { scale: p.scale, x: p.x + off.x * p.scale, y: p.y + off.y * p.scale };
    };

    const scrollOf = (frameId: string, now = performance.now()) => {
        const anim = scrolls.current.get(frameId);
        if (anim) {
            const e = easeTransition(anim.transition, progress(anim, now));
            return { x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
        }
        return stateRef.current.scroll[frameId] ?? { x: 0, y: 0 };
    };

    const maxScroll = (frameId: string) => {
        const d = docRef.current;
        const frame = d.nodes[frameId];
        if (!frame) return { x: 0, y: 0 };
        const st = stateRef.current;
        if (frameId === st.screen || st.overlays.some((o) => o.id === frameId)) {
            // A screen scrolls when it's taller than the view it shows through.
            const p = placeOf(frameId);
            const sg = stageRef.current;
            return { x: 0, y: Math.max(0, frame.h - (sg.view.y + sg.view.h - p.y) / p.scale) };
        }
        return contentOverflow(d, frame);
    };

    const videoTime = (videoId: string) => {
        for (const { paint } of videoPaints(docRef.current)) if (paint.video?.id === videoId) return cachedPlayer(paint.video)?.currentTime ?? 0;
        return 0;
    };

    // Applies a new state and starts the animations its effects ask for.
    const commit = (next: PlayerState, raw: Effect[]) => {
        const now = performance.now();
        // Transitions bound to easing or timing variables read them at the player's runtime values;
        // with Reduce motion on, movement then becomes a short dissolve.
        const reduce = optionsRef.current.reduceMotion;
        const live = (t: Transition) => calm(resolveTransition(docRef.current, t, { values: next.values, modes: next.modes }), reduce);
        const effects = raw.map((e): Effect => {
            if (e.kind === "navigate" || e.kind === "change" || e.kind === "scroll") return { ...e, transition: live(e.transition) };
            if (e.kind === "overlay-open" || e.kind === "overlay-close") return { ...e, entry: { ...e.entry, transition: live(e.entry.transition) } };
            return e;
        });
        for (const effect of effects) {
            if (effect.kind === "url") {
                if (effect.newTab) window.open(effect.url, "_blank", "noopener");
                else window.location.href = effect.url;
            } else if (effect.kind === "navigate") {
                nav.current = { from: effect.from, to: effect.to, reverse: effect.reverse, transition: effect.transition, start: now, duration: transitionDuration(effect.transition) };
                overlayAnims.current = [];
                change.current = null;
            } else if (effect.kind === "overlay-open" || effect.kind === "overlay-close") {
                const duration = transitionDuration(effect.entry.transition);
                overlayAnims.current = overlayAnims.current.filter((a) => a.entry.id !== effect.entry.id);
                if (duration > 0) overlayAnims.current.push({ entry: effect.entry, closing: effect.kind === "overlay-close", transition: effect.entry.transition, start: now, duration });
            } else if (effect.kind === "change") {
                const duration = transitionDuration(effect.transition);
                const anim = duration > 0 ? { before: shownDoc(baseRef.current, effect.before), screen: next.screen, transition: effect.transition, start: now, duration } : null;
                if (effect.instance && effect.transition.type === "smart") {
                    if (anim) changes.current.set(effect.instance, anim);
                    else changes.current.delete(effect.instance);
                } else change.current = anim;
                // The new variant's own "after delay" interactions start once this change has played.
                if (effect.instance) startDelays(effect.instance, next, duration);
            } else if (effect.kind === "scroll") {
                const duration = transitionDuration(effect.transition);
                if (duration > 0) scrolls.current.set(effect.frame, { from: effect.from, to: effect.to, transition: effect.transition, start: now, duration });
                else scrolls.current.delete(effect.frame);
            }
        }
        stateRef.current = next;
        rerender();
    };

    // Starts the "after delay" interactions under `rootId` as the given state shows them (a changed
    // component shows its new variant's), after `after` milliseconds plus each one's own delay.
    function startDelays(rootId: string, st: PlayerState, after: number) {
        const shown = shownDoc(baseRef.current, st);
        const now = performance.now();
        for (const node of subtreeOf(shown, rootId)) {
            delayTimers.current.delete(node.id);
            const list = (node.interactions ?? []).filter((it) => it.trigger === "delay").map((interaction) => ({ due: now + after + interaction.delay, frame: frameCount.current, interaction }));
            if (list.length) delayTimers.current.set(node.id, list);
        }
    }

    // Fires the "after delay" interactions that are due, earliest first. Ones started while firing
    // wait for the next frame.
    function fireDelays(now: number) {
        const frame = ++frameCount.current;
        for (let guard = 0; guard < 500; guard++) {
            let next: { node: string; at: number; due: number; interaction: Interaction } | null = null;
            for (const [node, list] of delayTimers.current) {
                list.forEach((t, at) => {
                    if (t.frame < frame && t.due <= now && (!next || t.due < next.due)) next = { node, at, due: t.due, interaction: t.interaction };
                });
            }
            if (!next) return;
            const { node, at, interaction } = next as { node: string; at: number; interaction: Interaction };
            const list = delayTimers.current.get(node) ?? [];
            list.splice(at, 1);
            if (!list.length) delayTimers.current.delete(node);
            run(interaction, node);
        }
    }

    // Controller buttons going down fire the "key" interactions set to that controller.
    const pads = useRef(new GamepadWatcher());
    const fireGamepad = () => {
        const pressed = pads.current.poll();
        if (!pressed.length) return;
        for (const node of subtreeOf(docRef.current, topOf(stateRef.current))) {
            for (const it of node.interactions ?? []) {
                if (it.trigger !== "key" || !isController(it.device) || it.button === undefined) continue;
                if (pressed.some((p) => p.index === it.button && GamepadWatcher.matches(it.device, p.kind))) run(it, node.id);
            }
        }
    };

    // Mouse enter, leave, down and up can wait a moment before they run.
    const runLater = (interaction: Interaction, source: string | null) => {
        const wait = interaction.triggerDelay ?? 0;
        if (wait > 0) window.setTimeout(() => run(interaction, source), wait);
        else run(interaction, source);
    };

    const run = (interaction: Interaction, source: string | null) => {
        const st = stateRef.current;
        const result = runInteraction(st, interaction, { doc: baseRef.current, source, videoTime, maxScroll, now: performance.now() });
        commit(result.state, result.effects);
        if (result.effects.some((e) => e.kind === "navigate" && !e.reverse)) ahead.current = [];
        return result.effects;
    };

    const restart = (to: string) => {
        ahead.current = [];
        nav.current = null;
        overlayAnims.current = [];
        change.current = null;
        scrolls.current.clear();
        hoverHeld.current = null;
        pressHeld.current = null;
        videoSeen.current.clear();
        for (const { paint } of videoPaints(baseRef.current)) {
            const el = paint.video ? cachedPlayer(paint.video) : null;
            if (el) el.currentTime = 0;
        }
        stateRef.current = startAnimations(initialState(to), baseRef.current, to, performance.now());
        rerender();
    };

    const goTo = (to: string, reverse = false) => {
        const st = stateRef.current;
        if (!docRef.current.nodes[to] || to === st.screen) return;
        const transition: Transition = { ...DEFAULT_TRANSITION };
        commit(
            startAnimations({ ...st, screen: to, overlays: [], history: reverse ? st.history.slice(0, -1) : [...st.history, { screen: st.screen, overlays: st.overlays, transition }] }, baseRef.current, to, performance.now()),
            [{ kind: "navigate", from: st.screen, to, transition, reverse }],
        );
    };

    const list = useMemo(() => frameList(base, flowId), [base, flowId]);
    // Next and previous step through the flow's frames (or every frame in canvas order).
    const next = () => {
        const to = list[list.indexOf(stateRef.current.screen) + 1];
        if (to) goTo(to);
    };
    const back = () => {
        const st = stateRef.current;
        if (st.overlays.length) {
            const entry = st.overlays[st.overlays.length - 1];
            if (entry) commit({ ...st, overlays: st.overlays.slice(0, -1) }, [{ kind: "overlay-close", entry }]);
            return;
        }
        const previous = st.history[st.history.length - 1];
        if (previous) {
            ahead.current.push(st.screen);
            commit(startAnimations({ ...st, screen: previous.screen, overlays: previous.overlays, history: st.history.slice(0, -1) }, baseRef.current, previous.screen, performance.now()), [{ kind: "navigate", from: st.screen, to: previous.screen, transition: previous.transition, reverse: true }]);
            return;
        }
        const to = list[list.indexOf(st.screen) - 1];
        if (to) {
            ahead.current.push(st.screen);
            goTo(to, true);
        }
    };
    const forward = () => {
        const to = ahead.current.pop();
        if (to) goTo(to);
    };

    // "After delay" interactions start when a screen or overlay appears.
    useEffect(() => {
        startDelays(top, stateRef.current, 0);
        const timers = delayTimers.current;
        return () => timers.clear();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restart timers only when the top frame changes
    }, [top]);

    // Videos that appear start (or not) as their fills say.
    useEffect(() => {
        const st = stateRef.current;
        const videos = { ...st.videos };
        let changed = false;
        for (const id of [st.screen, ...st.overlays.map((o) => o.id)]) {
            for (const node of subtreeOf(docRef.current, id)) {
                for (const paint of node.fills) {
                    if (paint.type !== "image" || !paint.video || videos[paint.video.id]) continue;
                    videos[paint.video.id] = { playing: paint.video.autoplay !== false, muted: paint.video.muted, seek: null, token: 0 };
                    changed = true;
                }
            }
        }
        if (changed) {
            stateRef.current = { ...st, videos };
            rerender();
        }
    }, [top, state.screen]);

    // Draws the base screen: scrolled, with pinned layers in place, mid animation if a component is
    // changing variant.
    const drawScreenAt = (ctx: CanvasRenderingContext2D, d: NagmaDocument, screenId: string, vp: Viewport, now: number, push: { x: number; y: number }) => {
        const st = stateRef.current;
        const ch = change.current;
        let source = d;
        let leaving: SceneNode[] = [];
        let fadeFrom: NagmaDocument | null = null;
        let fade = 1;
        // Components changing variant on this screen, each mid match animate.
        const instanceLeaving: { before: NagmaDocument; nodes: SceneNode[]; instance: string }[] = [];
        for (const [instance, anim] of changes.current) {
            if (anim.screen !== screenId) continue;
            const t = progress(anim, now);
            const tween = smartTweenDocs(anim.before, instance, source, instance, easeTransition(anim.transition, t));
            source = tween.doc;
            if (tween.leaving.length) instanceLeaving.push({ before: anim.before, nodes: tween.leaving, instance });
            if (t >= 1) changes.current.delete(instance);
        }
        if (ch && ch.screen === screenId) {
            const t = progress(ch, now);
            const e = easeTransition(ch.transition, t);
            if (ch.transition.type === "smart") {
                const tween = smartTweenDocs(ch.before, screenId, d, screenId, e);
                source = tween.doc;
                leaving = tween.leaving;
            } else if (ch.transition.type !== "instant") {
                fadeFrom = ch.before;
                fade = e;
            }
            if (t >= 1) change.current = null;
        }
        const animated: Record<string, { x: number; y: number }> = { ...st.scroll };
        for (const id of scrolls.current.keys()) animated[id] = scrollOf(id, now);
        const drawn = scrolledDoc(source, animated, new Set([screenId]));
        const screen = drawn.nodes[screenId];
        if (!screen) return;
        const p = vp.place(screen);
        const sy = scrollOf(screenId, now).y;
        const offset = { x: push.x, y: -sy * p.scale + push.y };
        if (fadeFrom) drawScreen(ctx, scrolledDoc(fadeFrom, animated, new Set([screenId])), screenId, vp, offset);
        const pins = pinned(drawn, screenId);
        const alpha = fadeFrom ? fade : 1;
        if (pins.length) {
            const hidden = { ...drawn, nodes: { ...drawn.nodes } };
            for (const n of pins) hidden.nodes[n.id] = { ...n, visible: false };
            drawScreen(ctx, hidden, screenId, vp, offset, alpha);
            for (const n of pins) {
                const rel = n.y - screen.y;
                const stick = n.scrollPosition === "sticky" ? -Math.min(sy, rel) * p.scale : 0;
                drawLayers(ctx, drawn, screenId, [n.id], vp, { x: push.x, y: stick + push.y });
            }
        } else drawScreen(ctx, drawn, screenId, vp, offset, alpha);
        const from = ch?.before.nodes[screenId];
        for (const item of instanceLeaving) {
            const fromScreen = item.before.nodes[screenId];
            if (!fromScreen) continue;
            ctx.save();
            ctx.setTransform(vp.dpr * p.scale, 0, 0, vp.dpr * p.scale, vp.dpr * (p.x + offset.x), vp.dpr * (p.y + offset.y));
            ctx.translate(-fromScreen.x, -fromScreen.y);
            for (const node of item.nodes) drawNode(ctx, item.before, node, { editingTextId: null, pixelScale: p.scale * vp.dpr });
            ctx.restore();
        }
        if (leaving.length && ch && from) {
            ctx.save();
            ctx.setTransform(vp.dpr * p.scale, 0, 0, vp.dpr * p.scale, vp.dpr * (p.x + offset.x), vp.dpr * (p.y + offset.y));
            ctx.translate(-from.x, -from.y);
            for (const node of leaving) drawNode(ctx, ch.before, node, { editingTextId: null, pixelScale: p.scale * vp.dpr });
            ctx.restore();
        }
    };

    // Keeps each video on screen playing, paused, muted and at the time the prototype says, and fires
    // the video triggers ("When video hits", "When video ends").
    const syncVideos = (d: NagmaDocument, st: PlayerState) => {
        const visibleIds = new Set<string>();
        const visiblePaints = new Set<string>();
        for (const id of [st.screen, ...st.overlays.map((o) => o.id)]) {
            for (const node of subtreeOf(d, id)) {
                for (const p of node.fills) {
                    if (p.type === "image" && p.video) {
                        visiblePaints.add(p.id);
                        visibleIds.add(p.video.id);
                    }
                }
            }
        }
        const handled = new Set<string>();
        for (const { node, paint } of videoPaints(d)) {
            const video = paint.video;
            if (!video) continue;
            if (!visiblePaints.has(paint.id)) {
                if (!visibleIds.has(video.id)) cachedPlayer(video)?.pause();
                continue;
            }
            const el = cachedPlayer(video);
            if (!el) {
                void getPlayer(video);
                continue;
            }
            showLive(paint.id, el);
            if (handled.has(video.id)) continue;
            handled.add(video.id);
            const vs = st.videos[video.id] ?? { playing: video.autoplay !== false, muted: video.muted, seek: null, token: 0 };
            const seen = videoSeen.current.get(video.id) ?? { token: 0, last: el.currentTime, ended: false };
            if (vs.token !== seen.token) {
                if (vs.seek !== null) el.currentTime = Math.min(Math.max(0, el.duration - 0.01), vs.seek);
                seen.token = vs.token;
                seen.last = el.currentTime;
                seen.ended = false;
            }
            const t = el.currentTime;
            if (!el.ended && t + 0.1 < el.duration) seen.ended = false;
            const wrapped = t + 0.25 < seen.last;
            const ended = !seen.ended && (el.ended || (wrapped && video.loop));
            const fire: Interaction[] = [];
            for (const it of node.interactions ?? []) {
                if (it.trigger === "video-time") {
                    const at = Math.min(it.videoTime ?? 0, Math.max(0, el.duration - 0.05));
                    if ((seen.last < at && t >= at) || (wrapped && at <= t)) fire.push(it);
                }
                if (it.trigger === "video-end" && ended) fire.push(it);
            }
            if (ended) {
                seen.ended = !video.loop;
                // A finished video rests on its last frame, stopped; playing it again starts over.
                if (!video.loop && vs.playing) stateRef.current = { ...stateRef.current, videos: { ...stateRef.current.videos, [video.id]: { ...vs, playing: false } } };
            }
            seen.last = t;
            videoSeen.current.set(video.id, seen);
            const now = stateRef.current.videos[video.id] ?? vs;
            el.loop = video.loop;
            el.muted = now.muted;
            if (now.playing && el.paused) {
                // Playing a finished video starts it over.
                if (el.ended) el.currentTime = 0;
                void el.play().catch(() => undefined);
            }
            if (!now.playing && !el.paused) el.pause();
            for (const it of fire) queueMicrotask(() => run(it, node.id));
        }
    };

    // Without ImageDecoder, animated GIF fills on the top frame get an <img> over them (the browser
    // animates those); the still underneath keeps the layout.
    const gifSeen = useRef("");
    const placeGifOverlays = () => {
        if (canDecodeGifs()) return;
        const st = stateRef.current;
        const d = docRef.current;
        const id = topOf(st);
        const frame = d.nodes[id];
        if (!frame || nav.current || drag.current) {
            if (gifSeen.current) {
                gifSeen.current = "";
                setGifOverlays([]);
            }
            return;
        }
        const p = placeOf(id);
        const sy = scrollOf(id).y;
        const out: { key: string; src: string; box: Box; radius: number }[] = [];
        for (const node of subtreeOf(d, id)) {
            if (!isEffectivelyVisible(d, node) || node.rotation) continue;
            for (const paint of node.fills) {
                if (paint.type !== "image" || paint.video || !paint.visible || !isGif(d.images, paint.id)) continue;
                const src = d.images[paint.id];
                if (!src) continue;
                out.push({ key: `${node.id}:${paint.id}`, src, box: { x: p.x + (node.x - frame.x) * p.scale, y: p.y + (node.y - frame.y - sy) * p.scale, w: node.w * p.scale, h: node.h * p.scale }, radius: node.radius * p.scale });
            }
        }
        const sig = out.map((o) => `${o.key}:${Math.round(o.box.x)},${Math.round(o.box.y)},${Math.round(o.box.w)},${Math.round(o.box.h)}`).join("|");
        if (sig !== gifSeen.current) {
            gifSeen.current = sig;
            setGifOverlays(out);
        }
    };

    // Draw loop (none while the tab is hidden).
    useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        let frameId = 0;
        const draw = (now: number) => {
            const dpr = window.devicePixelRatio || 1;
            fireDelays(now);
            fireGamepad();
            gifPlayback.on = true;
            setGifClock(now);
            const st = stateRef.current;
            // Animated layers drawn at their playheads, every frame.
            const d = animatedState(viewDoc(shownDoc(baseRef.current, st), st.screen), st, now);
            docRef.current = d;
            const sg = stageRef.current;
            syncVideos(d, st);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (sg.device) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                const dev = sg.device;
                const color = dev.device.colors[dev.color] ?? dev.device.colors[0];
                if (color) drawBezel(ctx, dev.device.bezel, color, dev.screen, dev.s, dev.landscape);
            }
            ctx.save();
            if (sg.clip) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.beginPath();
                ctx.roundRect(sg.clip.box.x, sg.clip.box.y, sg.clip.box.w, sg.clip.box.h, sg.clip.radius);
                ctx.fillStyle = "#000";
                ctx.fill();
                ctx.clip();
            }
            const vp: Viewport = { width: sg.view.w, height: sg.view.h, dpr, place: (frame) => sg.place(frame) };
            // Overlays opening with Push move the screen under them.
            let push = { x: 0, y: 0 };
            for (const a of overlayAnims.current) {
                const frame = d.nodes[a.entry.id];
                const screen = d.nodes[st.screen];
                if (a.transition.type !== "push" || !frame || !screen) continue;
                const p = sg.place(screen);
                const e = easeTransition(a.transition, progress(a, now));
                const amount = a.closing ? 1 - e : e;
                const v = VECTOR[a.transition.direction];
                push = { x: v.x * frame.w * p.scale * amount, y: v.y * frame.h * p.scale * amount };
            }
            const pushed = st.overlays.find((o) => o.transition.type === "push" && !overlayAnims.current.some((a) => a.entry.id === o.id));
            if (pushed) {
                const frame = d.nodes[pushed.id];
                const screen = d.nodes[st.screen];
                if (frame && screen) {
                    const p = sg.place(screen);
                    const v = VECTOR[pushed.transition.direction];
                    push = { x: v.x * frame.w * p.scale, y: v.y * frame.h * p.scale };
                }
            }
            const navAnim = nav.current;
            const dragging = drag.current;
            const snap = snapBack.current;
            if (navAnim) {
                const t = progress(navAnim, now);
                drawTransition(ctx, d, navAnim.from, navAnim.to, navAnim.transition, t, navAnim.reverse, vp);
                if (t >= 1) nav.current = null;
            } else if (dragging?.to && d.nodes[dragging.to]) {
                // On drag: the destination follows the pointer.
                drawTransition(ctx, d, st.screen, dragging.to, { ...dragging.transition, easing: "linear" }, dragging.t, false, vp);
            } else if (snap && d.nodes[snap.to]) {
                const t = snap.t0 * (1 - progress(snap, now));
                drawTransition(ctx, d, st.screen, snap.to, { ...snap.transition, easing: "linear" }, t, false, vp);
                if (progress(snap, now) >= 1) snapBack.current = null;
            } else drawScreenAt(ctx, d, st.screen, vp, now, push);
            // Overlays, each over its dimmed background; closing ones play their animation backwards.
            const closing = overlayAnims.current.filter((a) => a.closing && !st.overlays.some((o) => o.id === a.entry.id));
            const shown: { entry: OverlayEntry; anim: OverlayAnim | null }[] = [
                ...st.overlays.map((entry) => ({ entry, anim: overlayAnims.current.find((a) => a.entry.id === entry.id && !a.closing) ?? null })),
                ...closing.map((anim) => ({ entry: anim.entry, anim })),
            ];
            // Without a device, overlays (and their dim) stay inside the screen they open over.
            const base = d.nodes[st.screen];
            ctx.save();
            if (!sg.clip && base && shown.length) {
                const p = sg.place(base);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.beginPath();
                ctx.rect(p.x + push.x, Math.max(sg.view.y, p.y + push.y), base.w * p.scale, Math.min(base.h * p.scale, sg.view.y + sg.view.h - Math.max(sg.view.y, p.y)));
                ctx.clip();
            }
            for (const { entry, anim } of shown) {
                const frame = d.nodes[entry.id];
                if (!frame || navAnim) continue;
                const raw = anim ? easeTransition(anim.transition, progress(anim, now)) : 1;
                const amount = anim?.closing ? 1 - raw : raw;
                if (entry.settings.background) {
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.globalAlpha = Math.max(0, Math.min(1, amount));
                    ctx.fillStyle = hexToRgba(entry.settings.backgroundColor, entry.settings.backgroundOpacity);
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
                const tr = entry.transition;
                const p = placeOf(entry.id);
                let offset = { x: 0, y: 0 };
                let alpha = 1;
                if (anim && amount < 1) {
                    const dir = VECTOR[tr.type === "move-out" || tr.type === "slide-out" ? OPPOSITE[tr.direction] : tr.direction];
                    // Travel from just outside the view, on the side the overlay comes from.
                    const travelX = dir.x > 0 ? p.x + frame.w * p.scale - sg.view.x : dir.x < 0 ? sg.view.x + sg.view.w - p.x : 0;
                    const travelY = dir.y > 0 ? p.y + frame.h * p.scale - sg.view.y : dir.y < 0 ? sg.view.y + sg.view.h - p.y : 0;
                    if (tr.type === "dissolve" || tr.type === "smart") alpha = amount;
                    else if (tr.type === "move-in" || tr.type === "move-out" || tr.type === "push") offset = { x: -dir.x * travelX * (1 - amount), y: -dir.y * travelY * (1 - amount) };
                    else if (tr.type === "slide-in" || tr.type === "slide-out") {
                        offset = { x: -dir.x * travelX * 0.3 * (1 - amount), y: -dir.y * travelY * 0.3 * (1 - amount) };
                        alpha = amount;
                    }
                }
                const scrolled = scrolledDoc(d, st.scroll, new Set([entry.id]));
                drawScreen(ctx, scrolled, entry.id, { ...vp, place: () => p }, { x: offset.x, y: offset.y - scrollOf(entry.id, now).y * p.scale }, alpha);
            }
            ctx.restore();
            overlayAnims.current = overlayAnims.current.filter((a) => progress(a, now) < 1);
            for (const [id, a] of scrolls.current) {
                if (progress(a, now) >= 1) scrolls.current.delete(id);
            }
            // Hotspot hints after a click that did nothing.
            if (now < flash.current) {
                const id = topOf(st);
                const screen = d.nodes[id];
                if (screen) {
                    const p = placeOf(id);
                    const sy = scrollOf(id, now).y;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    ctx.strokeStyle = "rgba(79, 163, 255, 0.9)";
                    ctx.fillStyle = "rgba(79, 163, 255, 0.18)";
                    for (const node of subtreeOf(d, id)) {
                        if (!node.visible || !node.interactions?.length || node.id === id) continue;
                        const r = { x: p.x + (node.x - screen.x) * p.scale, y: p.y + (node.y - screen.y - sy) * p.scale, w: node.w * p.scale, h: node.h * p.scale };
                        ctx.fillRect(r.x, r.y, r.w, r.h);
                        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
                    }
                }
            }
            // The hotspot keyboard focus is on.
            const focusNode = options.focusOutlines && focusedHotspot.current ? d.nodes[focusedHotspot.current] : undefined;
            if (focusNode) {
                const id = topOf(st);
                const screen = d.nodes[id];
                if (screen && subtreeOf(d, id).some((n) => n.id === focusNode.id)) {
                    const p = placeOf(id);
                    const sy = scrollOf(id, now).y;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    ctx.strokeStyle = "#0D99FF";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(p.x + (focusNode.x - screen.x) * p.scale - 3, p.y + (focusNode.y - screen.y - sy) * p.scale - 3, focusNode.w * p.scale + 6, focusNode.h * p.scale + 6);
                } else focusedHotspot.current = null;
            }
            // Comment pins on this screen.
            if (commentsOpen) {
                const screen = d.nodes[st.screen];
                if (screen) {
                    const p = placeOf(screen.id);
                    const sy = scrollOf(screen.id, now).y;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    for (const c of comments) {
                        if (c.pageId !== pageId || c.resolved || c.x < screen.x || c.y < screen.y || c.x > screen.x + screen.w || c.y > screen.y + screen.h) continue;
                        const x = p.x + (c.x - screen.x) * p.scale;
                        const y = p.y + (c.y - screen.y - sy) * p.scale;
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(x, y - 12);
                        ctx.arc(x + 12, y - 12, 12, Math.PI, Math.PI * 2.5);
                        ctx.closePath();
                        ctx.fillStyle = c.author.color;
                        ctx.fill();
                    }
                }
            }
            ctx.restore();
            if (sg.device) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                drawBezelOverlay(ctx, sg.device.device.bezel, sg.device.screen, sg.device.s, sg.device.landscape);
            }
            gifPlayback.on = false;
            placeGifOverlays();
            frameId = requestAnimationFrame(draw);
        };
        frameId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frameId);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop reads refs; it restarts when the view changes
    }, [size, background, options, commentsOpen, comments, pageId, active]);

    useEffect(() => () => stopPlayback(), []);
    useEffect(() => {
        if (!active) stopPlayback();
    }, [active]);

    // Screen point → document point on the top frame.
    const origin = () => canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const toDoc = (clientX: number, clientY: number) => {
        const st = stateRef.current;
        const id = topOf(st);
        const frame = docRef.current.nodes[id];
        if (!frame) return null;
        const p = placeOf(id);
        const sy = scrollOf(id).y;
        const o = origin();
        const raw = { x: frame.x + (clientX - o.left - p.x) / p.scale, y: frame.y + (clientY - o.top - p.y) / p.scale };
        for (const n of pinned(docRef.current, id)) {
            const rel = n.y - frame.y;
            const at = n.scrollPosition === "sticky" ? n.y - Math.min(sy, rel) : n.y;
            if (raw.x >= n.x && raw.x <= n.x + n.w && raw.y >= at && raw.y <= at + n.h) return { x: raw.x, y: raw.y - at + n.y };
        }
        return { x: raw.x, y: raw.y + sy };
    };
    const hitDoc = () => scrolledDoc(docRef.current, stateRef.current.scroll, new Set([topOf(stateRef.current)]));
    const clientRect = (node: SceneNode): Box => {
        const id = topOf(stateRef.current);
        const frame = docRef.current.nodes[id];
        const p = placeOf(id);
        const sy = scrollOf(id).y;
        const o = origin();
        return frame ? { x: o.left + p.x + (node.x - frame.x) * p.scale, y: o.top + p.y + (node.y - frame.y - sy) * p.scale, w: node.w * p.scale, h: node.h * p.scale } : { x: 0, y: 0, w: 0, h: 0 };
    };
    const inside = (r: Box, x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

    // While hovering / while pressing end: back to how things were.
    const release = (held: React.MutableRefObject<Held | null>) => {
        const h = held.current;
        held.current = null;
        if (!h) return;
        const result = revertTo(stateRef.current, h.before, h.ran);
        commit(result.state, result.effects);
    };

    const onWheel = (event: React.WheelEvent) => {
        const st = stateRef.current;
        const id = topOf(st);
        const at = toDoc(event.clientX, event.clientY);
        const frame = at ? scrollableAt(hitDoc(), id, at.x, at.y) : null;
        const target = frame ? (docRef.current.nodes[frame.id] ?? frame) : docRef.current.nodes[id];
        if (!target) return;
        const max = maxScroll(target.id);
        const cur = scrollOf(target.id);
        const p = placeOf(id);
        const horizontal = target.overflow === "horizontal" || target.overflow === "both";
        const vertical = target.id === id || target.overflow === "vertical" || target.overflow === "both" || !target.overflow;
        const nextScroll = {
            x: horizontal ? Math.min(max.x, Math.max(0, cur.x + event.deltaX / p.scale)) : 0,
            y: vertical ? Math.min(max.y, Math.max(0, cur.y + event.deltaY / p.scale)) : 0,
        };
        scrolls.current.delete(target.id);
        stateRef.current = { ...st, scroll: { ...st.scroll, [target.id]: nextScroll } };
    };

    // The preview panel has focus after a click in it, until a click elsewhere (the canvas may not
    // take focus, so focus alone can't tell).
    const focused = useRef(false);
    useEffect(() => {
        if (!panel) return;
        const onDown = (event: PointerEvent) => {
            const root = rootRef.current;
            focused.current = Boolean(root?.contains(event.target as Node));
            const el = document.activeElement as HTMLElement | null;
            if (!focused.current && el && root?.contains(el)) el.blur();
        };
        window.addEventListener("pointerdown", onDown, true);
        return () => window.removeEventListener("pointerdown", onDown, true);
    }, [panel]);
    const presentTabs = usePresentTabs();
    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        // With View > Always Show Tabs When Presenting, the whole window goes full screen.
        else void (presentTabs ? document.documentElement : rootRef.current)?.requestFullscreen?.().catch(() => undefined);
    };
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const onChange = () => setFullscreen(document.fullscreenElement !== null);
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!active) return;
            if (panel && !(focused.current || rootRef.current?.contains(document.activeElement))) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            // "Key/gamepad" interactions on the top frame come first (a combination lists its
            // modifiers before the key, so every one must be held).
            const pressed = [event.shiftKey ? "shift" : "", event.ctrlKey ? "control" : "", event.altKey ? "alt" : "", event.metaKey ? "meta" : "", event.key.toLowerCase()].filter(Boolean).sort().join("+");
            for (const node of subtreeOf(docRef.current, topOf(stateRef.current))) {
                const it = node.interactions?.find((i) => i.trigger === "key" && !isController(i.device) && i.key && (i.key.length > 1 && i.key.includes("+") ? i.key.toLowerCase().split("+").sort().join("+") : i.key.toLowerCase()) === pressed);
                if (it) {
                    event.preventDefault();
                    event.stopPropagation();
                    run(it, node.id);
                    return;
                }
            }
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const key = event.key.toLowerCase();
            const handled = () => {
                event.preventDefault();
                event.stopPropagation();
            };
            // Focus outlines: Tab and ⇧Tab move between the screen's hotspots, Return clicks one.
            if (options.focusOutlines && key === "tab") {
                handled();
                const hotspots = subtreeOf(docRef.current, topOf(stateRef.current)).filter((n) => n.visible && n.id !== topOf(stateRef.current) && n.interactions?.some((i) => i.trigger === "click" || i.trigger === "press" || i.trigger === "mouse-down" || i.trigger === "mouse-up"));
                if (!hotspots.length) return;
                const at = hotspots.findIndex((n) => n.id === focusedHotspot.current);
                const step = event.shiftKey ? -1 : 1;
                focusedHotspot.current = (hotspots[(at + step + hotspots.length) % hotspots.length] ?? hotspots[0])?.id ?? null;
                return;
            }
            if (options.focusOutlines && key === "enter" && focusedHotspot.current) {
                const node = docRef.current.nodes[focusedHotspot.current];
                const it = node?.interactions?.find((i) => i.trigger === "click") ?? node?.interactions?.find((i) => i.trigger === "press" || i.trigger === "mouse-down" || i.trigger === "mouse-up");
                if (node && it) {
                    handled();
                    focusedHotspot.current = null;
                    run(it, node.id);
                    return;
                }
            }
            // With shortcuts off, only Escape (and ⇧Space in the panel) belong to the viewer.
            if (!options.shortcuts && key !== "escape" && !(panel && key === " " && event.shiftKey)) return;
            // Shift+Space and Escape close the preview; in a tab, Escape leaves full screen or hidden UI.
            if (panel && (key === "escape" || (key === " " && event.shiftKey))) {
                handled();
                onClose?.();
            } else if (key === "escape") {
                if (!options.hideUi && !document.fullscreenElement) return;
                handled();
                if (options.hideUi) setOptions({ hideUi: false });
                else void document.exitFullscreen();
            } else if (key === "r") {
                handled();
                restart(flowId ?? startId);
            } else if (key === " " || key === "arrowright" || key === "n") {
                handled();
                next();
            } else if (key === "arrowleft" || key === "backspace") {
                handled();
                back();
            } else if (key === "z") {
                handled();
                const order: Scaling[] = ["fit", "width", "fill", "actual"];
                setOptions({ scaling: order[(order.indexOf(options.scaling) + 1) % order.length] ?? "fit" });
            } else if (key === "f" && !panel) {
                handled();
                toggleFullscreen();
            } else if (key === "c" && !panel) {
                handled();
                setCommentsOpen((o) => !o);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    // A prototype tab's toolbar tucks away while the pointer rests on the stage.
    const [idle, setIdle] = useState(false);
    const idleTimer = useRef(0);
    const wake = (y: number) => {
        if (idle) setIdle(false);
        window.clearTimeout(idleTimer.current);
        if (y > TOOLBAR_H + 12) idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
    };
    useEffect(() => {
        if (panel || !active) return;
        setIdle(false);
        idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
        return () => window.clearTimeout(idleTimer.current);
    }, [panel, active]);
    const fileId = useEditor((s) => s.fileId);
    // Presenting: the screen you're on goes to the room, so a spotlight or a follower can match it.
    const screenNow = state.screen;
    useEffect(() => {
        if (panel) return;
        collab.set({ prototypeScreen: active ? screenNow : null });
        sendPresence(true);
    }, [panel, active, screenNow]);
    useEffect(() => {
        if (panel) return;
        return () => {
            collab.set({ prototypeScreen: null });
            sendPresence(true);
        };
    }, [panel]);
    // Following someone who is presenting (or their spotlight): go where they are.
    const followed = useCollab((s) => (s.following ? s.peers[s.following]?.prototype?.screen : undefined));
    useEffect(() => {
        if (!followed || panel || !active) return;
        if (followed !== stateRef.current.screen && docRef.current.nodes[followed]) goTo(followed);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- goTo reads refs
    }, [followed, panel, active]);
    // Make available offline: the file and its images kept in this browser, refreshed as it changes.
    const [offline, setOffline] = useState(false);
    useEffect(() => {
        if (!fileId || panel) return;
        let live = true;
        void hasOffline(fileId).then((on) => live && setOffline(on));
        return () => {
            live = false;
        };
    }, [fileId, panel]);
    useEffect(() => {
        if (!offline || !fileId) return;
        const timer = window.setTimeout(() => void saveOffline(fileId, base), 3000);
        return () => window.clearTimeout(timer);
    }, [offline, fileId, base]);
    const toggleOffline = () => {
        if (!fileId) return;
        if (offline) {
            void removeOffline(fileId);
            setOffline(false);
            editor.notify("This prototype is no longer kept offline.");
            return;
        }
        void saveOffline(fileId, base).then((ok) => {
            setOffline(ok);
            editor.notify(ok ? "Available offline: this prototype opens from this browser without a connection." : "This browser can't keep files offline.");
        });
    };

    const flows = flowsOf(base);
    const current = doc.nodes[state.screen];
    const screenComments = current ? comments.filter((c) => c.pageId === pageId && c.x >= current.x && c.y >= current.y && c.x <= current.x + current.w && c.y <= current.y + current.h) : [];

    return (
        <div
            ref={rootRef}
            data-player={variant}
            hidden={!active}
            className={panel ? "relative h-full w-full overflow-hidden select-none" : "absolute inset-0 z-40 overflow-hidden select-none"}
            style={{ background }}
            onMouseMove={panel ? undefined : (event) => wake(event.clientY - event.currentTarget.getBoundingClientRect().top)}
        >
            <canvas
                ref={canvasRef}
                className="block"
                width={Math.round(size.width * (window.devicePixelRatio || 1))}
                height={Math.round(size.height * (window.devicePixelRatio || 1))}
                style={{ width: size.width, height: size.height, cursor: "default" }}
                onWheel={onWheel}
                onPointerMove={(event) => {
                    const x = event.clientX;
                    const y = event.clientY;
                    if (hoverHeld.current && !inside(hoverHeld.current.rect, x, y)) release(hoverHeld);
                    const at = toDoc(x, y);
                    const d = hitDoc();
                    const id = topOf(stateRef.current);
                    const hot = at ? interactiveAt(d, id, at.x, at.y, ["click", "press", "mouse-down", "mouse-up", "drag"]) : null;
                    event.currentTarget.style.cursor = hot ? "pointer" : "default";
                    // While hovering and mouse enter fire on arrival; mouse leave when the pointer goes.
                    const over = at ? interactiveAt(d, id, at.x, at.y, ["hover", "mouse-enter", "mouse-leave"]) : null;
                    if (over && hovered.current !== over.node.id && !hoverHeld.current) {
                        const enter = over.node.interactions?.find((i) => i.trigger === "hover") ?? over.node.interactions?.find((i) => i.trigger === "mouse-enter");
                        if (enter) {
                            const before = stateRef.current;
                            const rect = clientRect(over.node);
                            const ran = enter.trigger === "hover" ? run(enter, over.node.id) : (runLater(enter, over.node.id), []);
                            if (enter.trigger === "hover") hoverHeld.current = { node: over.node.id, rect, before, ran };
                        }
                    }
                    if (hovered.current && hovered.current !== over?.node.id) {
                        const left = d.nodes[hovered.current];
                        const it = left?.interactions?.find((i) => i.trigger === "mouse-leave");
                        if (it) runLater(it, left?.id ?? null);
                    }
                    hovered.current = over?.node.id ?? null;
                    const dg = drag.current;
                    if (dg) {
                        // Progress: how far the pointer travelled against the direction the new
                        // content comes from, over the screen's size that way (120px for the rest).
                        const dx = x - dg.start.x;
                        const dy = y - dg.start.y;
                        const screen = docRef.current.nodes[stateRef.current.screen];
                        const p = placeOf(stateRef.current.screen);
                        let t: number;
                        if (dg.axis && screen) {
                            const size = (dg.axis.x ? screen.w : screen.h) * p.scale;
                            t = (dx * dg.axis.x + dy * dg.axis.y) / Math.max(1, size);
                        } else t = Math.hypot(dx, dy) / 120;
                        dg.t = Math.min(1, Math.max(0, t));
                    }
                }}
                onClick={(event) => {
                    if (nav.current) return;
                    // A drag that moved isn't a click.
                    if (dragged.current) {
                        dragged.current = false;
                        return;
                    }
                    const at = toDoc(event.clientX, event.clientY);
                    const st = stateRef.current;
                    const id = topOf(st);
                    const hot = at ? interactiveAt(hitDoc(), id, at.x, at.y, ["click"]) : null;
                    if (hot) {
                        run(hot.interaction, hot.node.id);
                        return;
                    }
                    const linked = at ? linkAt(hitDoc(), id, at.x, at.y) : null;
                    if (linked?.startsWith("node:")) {
                        // A layer linked to a frame goes there, like a navigate interaction.
                        run({ trigger: "click", delay: 0, actions: [{ type: "navigate", target: linked.slice(5), transition: { ...DEFAULT_TRANSITION } }] }, null);
                        return;
                    }
                    if (linked) {
                        window.open(/^[a-z]+:/i.test(linked) ? linked : `https://${linked}`, "_blank", "noopener");
                        return;
                    }
                    const entry = st.overlays[st.overlays.length - 1];
                    const overlay = entry ? docRef.current.nodes[entry.id] : undefined;
                    if (entry && overlay && at && entry.settings.closeOnOutside && (at.x < overlay.x || at.y < overlay.y || at.x > overlay.x + overlay.w || at.y > overlay.y + overlay.h)) {
                        commit({ ...st, overlays: st.overlays.slice(0, -1) }, [{ kind: "overlay-close", entry }]);
                        return;
                    }
                    // Clicking where nothing happens shows every hotspot for a moment.
                    if (options.hints) flash.current = performance.now() + 600;
                }}
                onPointerDown={(event) => {
                    const at = toDoc(event.clientX, event.clientY);
                    if (!at) return;
                    pressStart.current = { x: event.clientX, y: event.clientY, fired: false };
                    const d = hitDoc();
                    const id = topOf(stateRef.current);
                    const press = interactiveAt(d, id, at.x, at.y, ["press"]);
                    if (press) {
                        const before = stateRef.current;
                        const rect = clientRect(press.node);
                        const ran = run(press.interaction, press.node.id);
                        pressHeld.current = { node: press.node.id, rect, before, ran };
                    }
                    const down = interactiveAt(d, id, at.x, at.y, ["mouse-down"]);
                    if (down) runLater(down.interaction, down.node.id);
                    const dragHit = interactiveAt(d, id, at.x, at.y, ["drag"]);
                    if (dragHit && !nav.current) {
                        const first = actionsOf(dragHit.interaction).find((a) => a.type === "navigate" || a.type === "overlay" || a.type === "change-to" || a.type === "swap" || a.type === "back");
                        const transition = first?.transition ?? DEFAULT_TRANSITION;
                        const directional = transition.type === "move-in" || transition.type === "move-out" || transition.type === "push" || transition.type === "slide-in" || transition.type === "slide-out";
                        const to = first?.type === "navigate" && first.target && docRef.current.nodes[first.target] ? first.target : null;
                        drag.current = { node: dragHit.node.id, interaction: dragHit.interaction, start: { x: event.clientX, y: event.clientY }, to, transition, t: 0, axis: directional ? VECTOR[transition.direction] : null };
                        snapBack.current = null;
                    }
                }}
                onPointerUp={(event) => {
                    pressStart.current = null;
                    const dg = drag.current;
                    drag.current = null;
                    if (dg) {
                        dragged.current = dg.t > 0.05;
                        if (dg.t >= 0.4) {
                            const effects = run(dg.interaction, dg.node);
                            // The animation carries on from where the drag left it.
                            const n = nav.current;
                            if (n && effects.some((e) => e.kind === "navigate")) n.start = performance.now() - dg.t * n.duration;
                        } else if (dg.to && dg.t > 0) snapBack.current = { to: dg.to, t0: dg.t, transition: dg.transition, start: performance.now(), duration: Math.max(80, dg.t * 240) };
                    }
                    if (pressHeld.current) release(pressHeld);
                    const at = toDoc(event.clientX, event.clientY);
                    if (!at) return;
                    const up = interactiveAt(hitDoc(), topOf(stateRef.current), at.x, at.y, ["mouse-up"]);
                    if (up) runLater(up.interaction, up.node.id);
                }}
                onPointerCancel={() => {
                    pressStart.current = null;
                    drag.current = null;
                    if (pressHeld.current) release(pressHeld);
                }}
                onPointerLeave={() => {
                    if (hoverHeld.current) release(hoverHeld);
                    if (pressHeld.current) release(pressHeld);
                }}
            />
            {gifOverlays.map((g) => (
                <img key={g.key} src={g.src} alt="" aria-hidden="true" className="pointer-events-none absolute object-cover" style={{ left: g.box.x, top: g.box.y, width: g.box.w, height: g.box.h, borderRadius: g.radius }} />
            ))}
            {sidebarW > 0 && (
                <aside className="absolute bottom-0 left-0 flex w-60 flex-col border-r border-white/10 bg-[#1E1E20] text-[12px] text-white/85" style={{ top: barH }}>
                    <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-white/50">Flows</div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
                        {flows.length === 0 && <p className="px-1.5 leading-relaxed text-white/50">This prototype has no flows.</p>}
                        {flows.map((f) => (
                            <div key={f.id} className={`rounded-md ${f.id === flowId ? "bg-white/10 text-white" : "hover:bg-white/5"}`}>
                                <AriaButton
                                    onPress={() => {
                                        setFlowId(f.id);
                                        restart(f.id);
                                    }}
                                    className="block w-full px-2 pt-1.5 pb-1.5 text-left outline-none"
                                >
                                    <span className="block truncate">{flowLabel(base, f)}</span>
                                </AriaButton>
                                {f.flowDescription && <FlowDescription text={f.flowDescription} className="-mt-1 px-2 pb-1.5 text-[11px] leading-snug text-white/50" linkClass="text-[#4FA3FF] underline" />}
                            </div>
                        ))}
                    </div>
                </aside>
            )}
            {commentsW > 0 && (
                <aside className="absolute right-0 bottom-0 flex w-[280px] flex-col border-l border-white/10 bg-[#1E1E20] text-[12px] text-white/85" style={{ top: barH }}>
                    <div className="flex h-10 items-center justify-between px-3">
                        <span className="font-semibold">Comments</span>
                        <PlayerIcon icon={XClose} label="Close comments" onPress={() => setCommentsOpen(false)} />
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                        {screenComments.length === 0 && <p className="leading-relaxed text-white/50">No comments on this screen.</p>}
                        {screenComments.map((c) => (
                            <div key={c.id} className="rounded-md bg-white/5 p-2">
                                <div className="mb-1 flex items-center gap-1.5">
                                    <span className="size-2 rounded-full" style={{ background: c.author.color }} />
                                    <span className="font-medium">{c.author.name}</span>
                                    {c.resolved && <span className="text-white/40">Resolved</span>}
                                </div>
                                <p className="leading-snug whitespace-pre-wrap">{c.text}</p>
                                {c.replies.map((r) => (
                                    <p key={r.id} className="mt-1.5 border-l border-white/10 pl-2 leading-snug">
                                        <span className="font-medium">{r.author.name}</span> {r.text}
                                    </p>
                                ))}
                            </div>
                        ))}
                    </div>
                </aside>
            )}
            {panel ? (
                <PreviewHeader
                    canBack={state.history.length > 0 || state.overlays.length > 0 || list.indexOf(state.screen) > 0}
                    canForward={ahead.current.length > 0}
                    onBack={back}
                    onForward={forward}
                    onRestart={() => restart(flowId ?? startId)}
                    options={options}
                    setOptions={setOptions}
                    onPopOut={() => onPopOut?.(stateRef.current.screen)}
                    onClose={() => onClose?.()}
                    panelControls={panelControls}
                />
            ) : ui ? (
                <>
                    <div
                        className="absolute inset-x-0 top-0 flex h-9 items-center gap-0.5 border-b border-white/10 bg-[#2C2C2C] px-1.5 text-[12px] text-white/85 transition-transform duration-200"
                        style={{ transform: idle ? "translateY(-100%)" : undefined }}
                    >
                        <AriaMenuTrigger>
                            <AriaButton aria-label="Main menu" className="flex h-7 items-center gap-1 rounded-md px-1.5 outline-none hover:bg-white/10">
                                <NagmaLogo size={18} />
                                <ChevronDown className="size-3 text-white/60 mr-0.5" />
                            </AriaButton>
                            <AriaPopover placement="bottom start" className={POPOVER}>
                                <AriaMenu
                                    aria-label="Main menu"
                                    className="outline-none"
                                    onAction={(key) => {
                                        if (key === "file") stopPresenting();
                                        else if (key === "link") copyFlowLink(flowId ?? startId);
                                        else if (key === "linkHidden") copyFlowLink(flowId ?? startId, true);
                                        else if (key === "restart") restart(flowId ?? startId);
                                        else if (key === "full") toggleFullscreen();
                                        else if (key === "hide") setOptions({ hideUi: true });
                                        else if (key === "close") {
                                            if (fileId) closeTab(protoTabId(fileId));
                                            else stopPresenting();
                                        }
                                    }}
                                >
                                    <MenuRow id="file" label="Back to file" />
                                    <MenuRow id="link" label="Copy prototype link" />
                                    <MenuRow id="linkHidden" label="Copy link with the UI hidden" />
                                    <AriaSeparator className="my-1 h-px bg-white/10" />
                                    <MenuRow id="restart" label="Restart" hint="R" />
                                    <MenuRow id="full" label={fullscreen ? "Exit full screen" : "Full screen"} hint="F" />
                                    <MenuRow id="hide" label="Hide UI" />
                                    <AriaSeparator className="my-1 h-px bg-white/10" />
                                    <MenuRow id="close" label="Close tab" />
                                </AriaMenu>
                            </AriaPopover>
                        </AriaMenuTrigger>
                        <PlayerIcon size="sm" icon={LayoutLeft} label={options.sidebar ? "Hide sidebar" : "Show sidebar"} active={options.sidebar} onPress={() => setOptions({ sidebar: !options.sidebar })} />
                        <PlayerIcon size="sm" icon={MessageCircle01} label="Comments" shortcut="C" active={commentsOpen} onPress={() => setCommentsOpen((o) => !o)} />
                        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
                            <AriaMenuTrigger>
                                <AriaButton aria-label="Flows" className="pointer-events-auto flex h-7 max-w-[40vw] items-center gap-1 rounded-md px-2 font-medium text-white outline-none hover:bg-white/10">
                                    <span className="truncate">{base.name || "Untitled"}</span>
                                    <ChevronDown className="size-3 shrink-0 text-white/60" />
                                </AriaButton>
                                <AriaPopover placement="bottom" className={POPOVER}>
                                    <AriaMenu
                                        aria-label="Flows"
                                        className="outline-none"
                                        disabledKeys={flows.length ? [] : ["none"]}
                                        onAction={(key) => {
                                            const k = String(key);
                                            if (k === "sidebar") setOptions({ sidebar: !options.sidebar });
                                            else if (base.nodes[k]) {
                                                setFlowId(k);
                                                restart(k);
                                            }
                                        }}
                                    >
                                        {flows.length === 0 && <MenuRow id="none" label="No flows in this file" />}
                                        {flows.map((f) => (
                                            <MenuRow key={f.id} id={f.id} label={flowLabel(base, f)} checked={f.id === flowId} />
                                        ))}
                                        <AriaSeparator className="my-1 h-px bg-white/10" />
                                        <MenuRow id="sidebar" label={options.sidebar ? "Hide flows" : "Show flows"} />
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaMenuTrigger>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                            <PresenterAvatars />
                            <ShareButton label="Share prototype" className="mr-1" />
                            <OptionsMenu options={options} setOptions={setOptions} onFullScreen={toggleFullscreen} hasDevice={hasDeviceFrame(deviceSetting)} offline={fileId ? { on: offline, toggle: toggleOffline } : undefined} />
                            <PlayerIcon size="sm" icon={fullscreen ? Minimize01 : Expand01} label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onPress={toggleFullscreen} />
                        </div>
                    </div>
                    <DeviceSwitcher doc={base} start={base.nodes[startId]} choice={options.device} onChange={(device) => setOptions({ device })} style={{ left: sidebarW + area.w / 2 }} />
                    <AriaButton
                        onPress={() => restart(flowId ?? startId)}
                        className="absolute bottom-3 flex h-8 items-center gap-2 rounded-full bg-[#2C2C2C]/95 pr-1.5 pl-3 text-[12px] text-white/85 shadow-lg outline-none hover:bg-[#383838] hover:text-white"
                        style={{ right: commentsW + 12 }}
                    >
                        Restart
                        <kbd className="flex h-5 min-w-5 items-center justify-center rounded bg-white/10 px-1 font-sans text-[11px] text-white/60">R</kbd>
                    </AriaButton>
                </>
            ) : (
                // With the UI hidden, a strip along the top brings it back.
                <div className="group absolute inset-x-0 top-0 flex h-10 justify-center">
                    <AriaButton onPress={() => setOptions({ hideUi: false })} className="mt-2 h-7 rounded-md bg-black/60 px-3 text-[12px] text-white opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100">
                        Show UI
                    </AriaButton>
                </div>
            )}
        </div>
    );
}

// The people here: you (Spotlight me) and anyone else presenting this prototype (click to follow).
function PresenterAvatars() {
    const me = useCollab((s) => s.me);
    const spotlight = useCollab((s) => s.spotlight);
    const following = useCollab((s) => s.following);
    const peers = useCollab((s) => s.peers);
    const presenting = Object.values(peers).filter((p) => p.prototype);
    return (
        <span className="mr-1 flex items-center gap-0.5">
            {presenting.map((p) => (
                <AriaButton key={p.userId} aria-label={following === p.userId ? `Stop following ${p.name}` : `Follow ${p.name}`} onPress={() => (following === p.userId ? stopFollowing() : follow(p.userId))} className={`rounded-full outline-none ${following === p.userId ? "ring-2 ring-offset-1 ring-offset-[#2C2C2C]" : ""}`} style={{ ["--tw-ring-color" as string]: p.color }}>
                    <Avatar name={p.name || "Someone"} color={p.color} size={24} />
                </AriaButton>
            ))}
            <AriaMenuTrigger>
                <AriaButton aria-label="Your avatar" className={`rounded-full outline-none ${spotlight ? "ring-2 ring-offset-1 ring-offset-[#2C2C2C]" : ""}`} style={{ ["--tw-ring-color" as string]: me.color }}>
                    <Avatar name={me.name || "You"} color={me.color} size={24} />
                </AriaButton>
                <AriaPopover placement="bottom end" className={POPOVER}>
                    <AriaMenu aria-label="Presenting" className="outline-none" onAction={(k) => k === "spotlight" && setSpotlight(!spotlight)}>
                        <MenuRow id="spotlight" label={spotlight ? "Stop spotlighting" : "Spotlight me"} checked={spotlight} />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </span>
    );
}

// The bottom switcher: the frame on its own, or in a device (the file's, or another one picked here
// for this viewer).
function DeviceSwitcher({ doc, start, choice, onChange, style }: { doc: NagmaDocument; start?: SceneNode; choice: string | undefined; onChange: (device: string | undefined) => void; style: React.CSSProperties }) {
    const own = viewerDevice(doc, undefined, start)?.id;
    const current = viewerDevice(doc, choice, start);
    const inDevice = Boolean(deviceScreen(current)?.device);
    const name = deviceById(current?.id)?.name ?? "Device";
    const seg = (on: boolean) => `flex h-6 items-center gap-1 rounded-full px-2.5 outline-none ${on ? "bg-white/15 text-white" : "text-white/70 hover:text-white"}`;
    return (
        <div role="group" aria-label="Show the prototype in" className="absolute bottom-3 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-full bg-[#2C2C2C]/95 p-1 text-[12px] shadow-lg" style={style}>
            <AriaButton aria-pressed={!inDevice} onPress={() => onChange("none")} className={seg(!inDevice)}>
                Frame
            </AriaButton>
            <AriaMenuTrigger>
                <AriaButton aria-pressed={inDevice} className={seg(inDevice)}>
                    <span className="max-w-40 truncate">{inDevice ? name : "Device"}</span>
                    <ChevronDown className="size-3 opacity-60" />
                </AriaButton>
                <AriaPopover placement="top" className={`${POPOVER} max-h-[60vh] w-60 overflow-y-auto`}>
                    <AriaMenu
                        aria-label="Devices"
                        className="outline-none"
                        onAction={(key) => {
                            const k = String(key);
                            onChange(k === "file" || k === own ? undefined : k);
                        }}
                    >
                        {own && <MenuRow id="file" label={`File's device: ${deviceById(own)?.name ?? own}`} checked={choice === undefined} />}
                        {CATEGORY_LABELS.map(([category, label]) => (
                            <AriaSection key={category}>
                                <AriaHeader className="px-2 pt-2 pb-1 text-[11px] text-white/45">{label}</AriaHeader>
                                {DEVICES.filter((d) => d.category === category).map((d) => (
                                    <MenuRow key={d.id} id={d.id} label={d.name} checked={inDevice && current?.id === d.id && choice !== undefined} />
                                ))}
                            </AriaSection>
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

function PlayerIcon({ icon: Icon, label, shortcut, active, size = "md", onPress }: { icon: typeof XClose; label: string; shortcut?: string; active?: boolean; size?: "sm" | "md"; onPress: () => void }) {
    return (
        <AriaButton
            aria-label={shortcut ? `${label} (${shortcut})` : label}
            onPress={onPress}
            className={`flex ${size === "sm" ? "size-7" : "size-8"} items-center justify-center rounded-md outline-none ${active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
        >
            <Icon className="size-4" />
        </AriaButton>
    );
}

const POPOVER = "z-[60] min-w-56 rounded-lg border border-white/10 bg-[#2C2C2E] p-1 shadow-xl outline-none";
const MENU_ITEM = "flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[12px] text-white/85 outline-none data-[disabled]:text-white/40 data-[focused]:bg-brand-500 data-[focused]:text-white";

function MenuRow({ id, label, hint, checked }: { id: string; label: string; hint?: string; checked?: boolean }) {
    return (
        <AriaMenuItem id={id} textValue={label} className={MENU_ITEM}>
            <span className="w-4">{checked && <Check className="size-3.5" />}</span>
            <span className="flex-1 truncate">{label}</span>
            {hint && <span className="text-white/40">{hint}</span>}
        </AriaMenuItem>
    );
}

// The preview panel's header: history and restart on the left; options, open in a tab and close on the right.
function PreviewHeader({
    canBack,
    canForward,
    onBack,
    onForward,
    onRestart,
    options,
    setOptions,
    onPopOut,
    onClose,
    panelControls,
}: {
    panelControls?: PanelControls;
    canBack: boolean;
    canForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onRestart: () => void;
    options: Options;
    setOptions: (patch: Partial<Options>) => void;
    onPopOut: () => void;
    onClose: () => void;
}) {
    const icon = "flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink disabled:text-ink-subtle/50 disabled:hover:bg-transparent";
    const device = useEditor((st) => st.doc.prototype?.device);
    return (
        <div className="absolute inset-x-0 top-0 flex items-center gap-0.5 border-b border-panel-border bg-panel px-1 text-ink" style={{ height: HEADER_H }}>
            <AriaButton aria-label="Back" isDisabled={!canBack} onPress={onBack} className={icon}>
                <ArrowLeft className="size-3.5" />
            </AriaButton>
            <AriaButton aria-label="Forward" isDisabled={!canForward} onPress={onForward} className={icon}>
                <ArrowRight className="size-3.5" />
            </AriaButton>
            <AriaButton aria-label="Restart (R)" onPress={onRestart} className={icon}>
                <RefreshCcw01 className="size-3.5" />
            </AriaButton>
            <div className="ml-auto flex items-center gap-0.5">
                <OptionsMenu options={options} setOptions={setOptions} compact hasDevice={hasDeviceFrame(device)} panelControls={panelControls} />
                <AriaButton aria-label="Open in new tab" onPress={onPopOut} className={icon}>
                    <LinkExternal01 className="size-3.5" />
                </AriaButton>
                <AriaButton aria-label="Close preview (Shift Space)" onPress={onClose} className={icon}>
                    <XClose className="size-3.5" />
                </AriaButton>
            </div>
        </div>
    );
}

// Extra rows for the preview panel's Options (its size), and the tab's offline copy.
interface PanelControls {
    respectAspect: boolean;
    onToggleAspect: () => void;
    onActualSize: () => void;
}

// Scaling, hotspot hints, shortcuts and accessibility; in a tab, also offline, full screen and hiding
// the UI; in the preview panel, its size.
function OptionsMenu({
    options,
    setOptions,
    compact,
    onFullScreen,
    hasDevice,
    panelControls,
    offline,
}: {
    options: Options;
    setOptions: (patch: Partial<Options>) => void;
    compact?: boolean;
    onFullScreen?: () => void;
    hasDevice?: boolean;
    panelControls?: PanelControls;
    offline?: { on: boolean; toggle: () => void };
}) {
    return (
        <AriaMenuTrigger>
            <AriaButton
                aria-label="Options"
                className={
                    compact
                        ? "flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                        : "flex size-7 items-center justify-center rounded-md text-white/75 outline-none hover:bg-white/10 hover:text-white"
                }
            >
                <Sliders04 className={compact ? "size-3.5" : "size-4"} />
            </AriaButton>
            <AriaPopover placement="bottom end" className={`${POPOVER} w-64`}>
                <AriaMenu
                    aria-label="Options"
                    className="outline-none"
                    onAction={(key) => {
                        const k = String(key);
                        if (k === "hints") setOptions({ hints: !options.hints });
                        else if (k === "device") setOptions({ deviceFrame: !options.deviceFrame });
                        else if (k === "shortcuts") setOptions({ shortcuts: !options.shortcuts });
                        else if (k === "offline") offline?.toggle();
                        else if (k === "hide") setOptions({ hideUi: true });
                        else if (k === "full") onFullScreen?.();
                        else if (k === "actual100") panelControls?.onActualSize();
                        else if (k === "aspect") panelControls?.onToggleAspect();
                        else if (SCALINGS.some(([id]) => id === k)) setOptions({ scaling: k as Scaling });
                    }}
                >
                    {SCALINGS.map(([id, label]) => (
                        <MenuRow key={id} id={id} label={label} checked={options.scaling === id} />
                    ))}
                    {panelControls && (
                        <>
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <MenuRow id="actual100" label="Resize to 100%" />
                            <MenuRow id="aspect" label="Respect aspect ratio" checked={panelControls.respectAspect} />
                        </>
                    )}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="shortcuts" label="Enable shortcuts" checked={options.shortcuts} />
                    <MenuRow id="hints" label="Show hotspot hints on click" checked={options.hints} />
                    {offline && <MenuRow id="offline" label="Make available offline" checked={offline.on} />}
                    <AriaSubmenuTrigger>
                        <MenuRow id="a11y" label="Accessibility settings" hint="›" />
                        <AriaPopover className={`${POPOVER} w-56`}>
                            <AriaMenu
                                aria-label="Accessibility settings"
                                className="outline-none"
                                onAction={(key) => {
                                    if (key === "motion") setOptions({ reduceMotion: !options.reduceMotion });
                                    else if (key === "focus") setOptions({ focusOutlines: !options.focusOutlines });
                                }}
                            >
                                <MenuRow id="motion" label="Reduce motion" checked={options.reduceMotion} />
                                <MenuRow id="focus" label="Show focus outlines" checked={options.focusOutlines} />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaSubmenuTrigger>
                    {hasDevice && <MenuRow id="device" label="Show device frame" checked={options.deviceFrame} />}
                    {!compact && <MenuRow id="full" label="Full screen" hint="F" />}
                    {!compact && <MenuRow id="hide" label="Hide UI" />}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

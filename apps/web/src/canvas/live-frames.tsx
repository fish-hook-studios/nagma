import { useEffect, useMemo, useRef, useState } from "react";
import { viewport } from "../engine/camera";
import { isFrameLike } from "../engine/components";
import { LIVE_SANDBOX, declareCommand, documentNetwork, isLive, liveAppSrcdoc, liveProps, liveSrcdoc, liveVariables, sourceOf } from "../engine/live";
import { useLiveApp } from "../engine/live-app";
import { isEffectivelyVisible } from "../engine/nodes";
import { pageOf } from "../engine/page";
import { editor, useEditor } from "../engine/store";
import { worldBounds, worldMatrix } from "../engine/transform";
import type { Camera, NagmaDocument, Rect, SceneNode } from "../engine/types";
import { type LiveMessage, clearErrors, enterLive, liveMounted, liveShown, noteError, noteEvent, routeFrame, snapshotKey, storeSnapshot, useLiveUi } from "./live-snapshots";

// Live frames on the canvas: each visible one runs in a sandboxed frame (scripts only, its own
// opaque origin, network off unless the document allows origins) laid over the canvas, following
// the camera and the layer's transform, clipped by the frames around it. Pointer events pass
// through to the canvas until the person enters the frame (double-click, also in view-only files;
// Escape or a click outside leaves). Frames that are off screen, too small to read, or past the
// first dozen show their last picture on the canvas instead. A running frame that a layer above it
// overlaps pauses to its picture (so the canvas draws the stack in order) and comes back when
// nothing covers it; the canvas's selection and handles draw on a layer above every frame
// (canvas-view.tsx).

const MAX_LIVE = 12;
const MIN_PX = 24;
const SNAPSHOT_SCALE = 2;

interface Placed {
    node: SceneNode;
    // The layer's box to the screen (CSS matrix), relative to the clip box.
    matrix: string;
    clip: Rect;
    opacity: number;
    // The props and variable values the code gets, as JSON (so a change is a string compare).
    input: string;
    zoom: number;
    screen: Rect;
    // A layer above it overlaps it: shown as its picture until uncovered.
    paused: boolean;
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Whether a layer (or what it holds) draws anything over the box.
function drawsOver(doc: NagmaDocument, node: SceneNode, box: Rect, depth = 0): boolean {
    if (!node.visible || node.isSlice || node.opacity <= 0 || depth > 40) return false;
    const bounds = worldBounds(doc, node);
    const container = isFrameLike(node) || node.type === "group" || node.type === "boolean";
    if (!container) return meets(bounds, box);
    const paints = node.fills.some((f) => f.visible !== false) || node.strokes.some((f) => f.visible !== false) || (node.effects ?? []).some((e) => e.visible !== false);
    if (paints && meets(bounds, box)) return true;
    if (isFrameLike(node) && node.clip && !meets(bounds, box)) return false;
    return node.children.some((id) => {
        const child = doc.nodes[id];
        return child ? drawsOver(doc, child, box, depth + 1) : false;
    });
}

// Whether any layer stacked above this one (its later siblings, and its ancestors' later siblings)
// overlaps it.
export function coveredAbove(doc: NagmaDocument, node: SceneNode): boolean {
    const box = worldBounds(doc, node);
    let child: SceneNode = node;
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        const at = parent.children.indexOf(child.id);
        for (const id of parent.children.slice(at + 1)) {
            const above = doc.nodes[id];
            if (above && drawsOver(doc, above, box)) return true;
        }
        if (parent.type === "page") break;
        child = parent;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return false;
}

function intersect(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

function toScreen(camera: Camera, r: Rect): Rect {
    return { x: r.x * camera.zoom + camera.x, y: r.y * camera.zoom + camera.y, w: r.w * camera.zoom, h: r.h * camera.zoom };
}

// The Live frames to run now, most important first: the one being used, the selected ones, then
// the largest on screen.
function placeLiveFrames(doc: NagmaDocument, pageId: string, camera: Camera, view: { width: number; height: number }, keep: Set<string>, entered: string | null): Placed[] {
    const screenBox = { x: 0, y: 0, w: view.width, h: view.height };
    const out: (Placed & { rank: number })[] = [];
    for (const node of Object.values(doc.nodes)) {
        if (!isLive(node) || pageOf(doc, node) !== pageId || !isEffectivelyVisible(doc, node)) continue;
        const screen = toScreen(camera, worldBounds(doc, node));
        const shown = intersect(screen, screenBox);
        if (!keep.has(node.id) && (shown.w <= 0 || shown.h <= 0 || screen.w < MIN_PX || screen.h < MIN_PX)) continue;
        // Clipped by every frame around it that clips its contents.
        let clip = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
        let opacity = node.opacity;
        let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
        while (parent && parent.type !== "page") {
            opacity *= parent.opacity;
            if (isFrameLike(parent) && parent.clip && !parent.isSection) clip = intersect(clip, toScreen(camera, worldBounds(doc, parent)));
            parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
        }
        if (clip.w <= 0 || clip.h <= 0) continue;
        const m = new DOMMatrix([camera.zoom, 0, 0, camera.zoom, camera.x - clip.x, camera.y - clip.y]).multiply(worldMatrix(doc, node)).translate(node.x, node.y);
        out.push({
            node,
            matrix: `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`,
            clip,
            opacity,
            input: JSON.stringify({ props: liveProps(doc, node), variables: liveVariables(doc, node) }),
            zoom: camera.zoom,
            screen,
            // The one in use keeps running whatever lies on it.
            paused: node.id !== entered && coveredAbove(doc, node),
            rank: keep.has(node.id) ? 1e12 : screen.w * screen.h,
        });
    }
    return out
        .sort((a, b) => b.rank - a.rank)
        .slice(0, MAX_LIVE)
        .map(({ rank: _rank, ...p }) => p);
}

export function LiveFrames() {
    const doc = useEditor((s) => s.doc);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const selection = useEditor((s) => s.selection);
    // Motion mode draws the design at the playhead and presenting draws the player: pictures there.
    const hidden = useEditor((s) => s.mode === "motion" || s.presentingId !== null);
    const entered = useLiveUi((s) => s.entered);

    // Leaving: Escape (when the frame doesn't have the keyboard), or the layer going away.
    useEffect(() => {
        if (!entered) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            e.preventDefault();
            enterLive(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [entered]);
    useEffect(() => {
        if (entered && (!doc.nodes[entered] || hidden)) enterLive(null);
    }, [doc, entered, hidden]);

    const placed = useMemo(() => {
        if (hidden) return [];
        const keep = new Set(selection.filter((id) => doc.nodes[id]?.type === "live"));
        if (entered) keep.add(entered);
        return placeLiveFrames(doc, pageId, camera, viewport, keep, entered);
    }, [doc, pageId, camera, selection, entered, hidden]);
    // The document's network, the same for every frame (a change reloads them).
    const network = useMemo(() => documentNetwork(doc).join(" "), [doc]);

    if (!placed.length) return null;
    return (
        <div data-live-layer="" className="pointer-events-none absolute inset-0 overflow-hidden">
            {placed.map((p) => (
                <LiveItem key={p.node.id} placed={p} network={network} entered={entered === p.node.id} selected={selection.includes(p.node.id)} />
            ))}
        </div>
    );
}

// The frame's document: built with the props of the moment it loads (later props go by message, so
// the running code keeps its state), again only when the code, the app's bundle or the network change.
function useFrameDocument(node: SceneNode, network: string, input: string): string {
    const live = node.live;
    const app = useLiveApp(live?.kind === "app" ? live.files : undefined);
    const inputRef = useRef(input);
    inputRef.current = input;
    const source = sourceOf(node);
    const key = JSON.stringify([live?.kind ?? "html", live?.kind === "app" ? (app?.key ?? null) : source, network]);
    return useMemo(() => {
        const now = JSON.parse(inputRef.current) as { props: Record<string, unknown>; variables: Record<string, unknown> };
        const options = { allow: network ? network.split(" ") : [], variables: now.variables, title: node.name };
        return live?.kind === "app" ? liveAppSrcdoc(app, now.props, options) : liveSrcdoc(source, now.props, options);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the code, its bundle or the network change
    }, [key]);
}

function LiveItem({ placed, network, entered, selected }: { placed: Placed; network: string; entered: boolean; selected: boolean }) {
    const { node, clip, matrix, opacity, input, zoom, screen, paused } = placed;
    const id = node.id;
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const srcdoc = useFrameDocument(node, network, input);
    const app = useLiveApp(node.live?.kind === "app" ? node.live.files : undefined);

    const snapTimer = useRef(0);
    const askSnapshot = (delay = 350) => {
        window.clearTimeout(snapTimer.current);
        snapTimer.current = window.setTimeout(() => frame.current?.contentWindow?.postMessage({ nl: 1, type: "snapshot", id, scale: SNAPSHOT_SCALE }, "*"), delay);
    };

    useEffect(() => {
        setReady(false);
        clearErrors(id);
        liveShown.delete(id);
    }, [id, srcdoc]);

    useEffect(() => {
        liveMounted.add(id);
        editor.set({});
        return () => {
            liveMounted.delete(id);
        };
    }, [id]);

    // What the app's bundle couldn't compile shows with the frame's errors.
    useEffect(() => {
        for (const message of app?.errors ?? []) noteError(id, message);
    }, [id, app]);

    // Covered by a layer above: the canvas shows its picture (taken now) in its place in the stack.
    useEffect(() => {
        if (!ready) return;
        if (paused) {
            frame.current?.contentWindow?.postMessage({ nl: 1, type: "snapshot", id, scale: SNAPSHOT_SCALE }, "*");
            liveShown.delete(id);
        } else liveShown.add(id);
        editor.set({});
    }, [paused, ready, id]);

    useEffect(() => {
        const off = routeFrame(frame.current?.contentWindow, (m: LiveMessage) => {
            const s = editor.get();
            const current = s.doc.nodes[id];
            if (!current) return;
            if (m.type === "ready") {
                setReady(true);
                askSnapshot(200);
            } else if (m.type === "declare") {
                if (s.readOnly) return;
                const command = declareCommand(current, m.schema, m.events);
                if (command) editor.execute(command);
            } else if (m.type === "emit" && typeof m.name === "string") {
                noteEvent(id, m.name, m.detail);
                askSnapshot();
            } else if (m.type === "error" && typeof m.message === "string") {
                noteError(id, `${m.message}${typeof m.line === "number" && m.line > 0 ? ` (line ${m.line})` : ""}`);
            } else if (m.type === "snapshot" && typeof m.data === "string" && m.id === id) {
                void storeSnapshot(id, snapshotKey(s.doc, current), m.data);
            } else if (m.type === "changed") {
                askSnapshot(0);
            } else if (m.type === "escape") {
                enterLive(null);
                document.querySelector<HTMLElement>('[data-region="canvas"]')?.focus();
            }
        });
        return () => {
            off();
            window.clearTimeout(snapTimer.current);
            liveShown.delete(id);
            editor.set({});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one route per frame window
    }, [id]);

    // New props and variable values go to the running code.
    useEffect(() => {
        if (!ready) return;
        const data = JSON.parse(input) as { props: unknown; variables: unknown };
        frame.current?.contentWindow?.postMessage({ nl: 1, type: "props", props: data.props, variables: data.variables }, "*");
        askSnapshot();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input, ready]);

    // The frame takes the pointer and keyboard while entered; a picture is taken on the way out.
    useEffect(() => {
        if (entered) frame.current?.focus();
        else if (ready) askSnapshot(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entered]);

    const outline = entered ? 2 : 1.5;
    const k = Math.max(zoom, 0.01);
    return (
        <>
            <div className="absolute overflow-hidden" data-live-paused={paused ? "" : undefined} style={{ left: clip.x, top: clip.y, width: clip.w, height: clip.h, visibility: paused ? "hidden" : undefined }}>
                <div
                    data-live-frame={id}
                    className="absolute top-0 left-0 origin-top-left overflow-hidden"
                    style={{ width: node.w, height: node.h, transform: matrix, opacity, borderRadius: node.radius || undefined }}
                >
                    <iframe
                        ref={frame}
                        title={node.name}
                        sandbox={LIVE_SANDBOX}
                        srcDoc={srcdoc}
                        tabIndex={entered ? 0 : -1}
                        className="block h-full w-full border-0 bg-transparent"
                        style={{ pointerEvents: entered ? "auto" : "none", colorScheme: "light" }}
                    />
                    {(selected || entered) && (
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 ${outline / k}px ${entered ? "#7048E8" : "#0D99FF"}`, borderRadius: node.radius || undefined }} />
                    )}
                </div>
            </div>
            {entered && (
                <div className="pointer-events-none absolute z-[1] rounded-md bg-[#7048E8] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white shadow" style={{ left: screen.x, top: Math.max(4, screen.y - 22) }}>
                    Using Live frame · Esc to leave
                </div>
            )}
        </>
    );
}

// A Live frame in the prototype player: the same sandbox, taking the pointer, at its place on the
// screen. Its events are the layer's "On event" triggers.
export function PlayerLiveFrame({ node, input, box, radius, onEmit }: { node: SceneNode; input: string; box: Rect; radius: number; onEmit: (name: string) => void }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const emitRef = useRef(onEmit);
    emitRef.current = onEmit;
    const network = useEditor((s) => documentNetwork(s.doc).join(" "));
    const srcdoc = useFrameDocument(node, network, input);
    useEffect(() => {
        const off = routeFrame(frame.current?.contentWindow, (m) => {
            if (m.type === "ready") {
                setReady(true);
                liveShown.add(node.id);
            }
            if (m.type === "emit" && typeof m.name === "string") emitRef.current(m.name);
        });
        return () => {
            off();
            liveShown.delete(node.id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one route per frame window
    }, []);
    useEffect(() => {
        if (!ready) return;
        const data = JSON.parse(input) as { props: unknown; variables: unknown };
        frame.current?.contentWindow?.postMessage({ nl: 1, type: "props", props: data.props, variables: data.variables }, "*");
    }, [input, ready]);
    return (
        <div className="absolute overflow-hidden" style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius || undefined }}>
            <div className="origin-top-left" style={{ width: node.w, height: node.h, transform: `scale(${box.w / Math.max(1, node.w)}, ${box.h / Math.max(1, node.h)})` }}>
                <iframe ref={frame} title={node.name} sandbox={LIVE_SANDBOX} srcDoc={srcdoc} className="block h-full w-full border-0 bg-transparent" style={{ colorScheme: "light" }} />
            </div>
        </div>
    );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { viewport } from "../engine/camera";
import { isFrameLike } from "../engine/components";
import { LIVE_SANDBOX, declareCommand, isLive, liveProps, liveSrcdoc, liveVariables, sourceOf } from "../engine/live";
import { isEffectivelyVisible } from "../engine/nodes";
import { pageOf } from "../engine/page";
import { editor, useEditor } from "../engine/store";
import { worldBounds, worldMatrix } from "../engine/transform";
import type { Camera, NagmaDocument, Rect, SceneNode } from "../engine/types";
import { type LiveMessage, clearErrors, enterLive, liveShown, noteError, noteEvent, routeFrame, snapshotKey, storeSnapshot, useLiveUi } from "./live-snapshots";

// Live frames on the canvas: each visible one runs in a sandboxed frame (scripts only, its own
// opaque origin, network off unless allowed) laid over the canvas, following the camera and the
// layer's transform, clipped by the frames around it. Pointer events pass through to the canvas
// until the person enters the frame (double-click; Escape or a click outside leaves). Frames that
// are off screen, too small to read, or past the first dozen show their last picture on the canvas
// instead.

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
function placeLiveFrames(doc: NagmaDocument, pageId: string, camera: Camera, view: { width: number; height: number }, keep: Set<string>): Placed[] {
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
        return placeLiveFrames(doc, pageId, camera, viewport, keep);
    }, [doc, pageId, camera, selection, entered, hidden]);

    if (!placed.length) return null;
    return (
        <div data-live-layer="" className="pointer-events-none absolute inset-0 overflow-hidden">
            {placed.map((p) => (
                <LiveItem key={p.node.id} placed={p} entered={entered === p.node.id} selected={selection.includes(p.node.id)} />
            ))}
        </div>
    );
}

function LiveItem({ placed, entered, selected }: { placed: Placed; entered: boolean; selected: boolean }) {
    const { node, clip, matrix, opacity, input, zoom, screen } = placed;
    const id = node.id;
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const source = sourceOf(node);
    const allow = node.live?.allow;
    const sourceKey = JSON.stringify([source, allow ?? []]);
    // The document is built with the props of the moment it loads; later props go by message, so
    // the running code keeps its state.
    const inputRef = useRef(input);
    inputRef.current = input;
    const srcdoc = useMemo(() => {
        const now = JSON.parse(inputRef.current) as { props: Record<string, unknown>; variables: Record<string, unknown> };
        return liveSrcdoc(source, now.props, { allow, variables: now.variables, title: node.name });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the code or its network changes
    }, [sourceKey]);

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
        const off = routeFrame(frame.current?.contentWindow, (m: LiveMessage) => {
            const s = editor.get();
            const current = s.doc.nodes[id];
            if (!current) return;
            if (m.type === "ready") {
                setReady(true);
                liveShown.add(id);
                editor.set({});
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
            <div className="absolute overflow-hidden" style={{ left: clip.x, top: clip.y, width: clip.w, height: clip.h }}>
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
                <div className="pointer-events-none absolute rounded-md bg-[#7048E8] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white shadow" style={{ left: screen.x, top: Math.max(4, screen.y - 22) }}>
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
    const inputRef = useRef(input);
    inputRef.current = input;
    const emitRef = useRef(onEmit);
    emitRef.current = onEmit;
    const source = sourceOf(node);
    const allow = node.live?.allow;
    const sourceKey = JSON.stringify([source, allow ?? []]);
    const srcdoc = useMemo(() => {
        const now = JSON.parse(inputRef.current) as { props: Record<string, unknown>; variables: Record<string, unknown> };
        return liveSrcdoc(source, now.props, { allow, variables: now.variables, title: node.name });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the code or its network changes
    }, [sourceKey]);
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

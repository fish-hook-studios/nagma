import { nanoid } from "nanoid";
import { defaultPropsFor } from "../engine/menu-extras";
import { useEffect, useRef, useState } from "react";
import { fitRect, screenToWorld, viewport, zoomAt, zoomToFit } from "../engine/camera";
import { applyCommand, applyWithoutLayout, descendants } from "../engine/commands";
import { expandGroups, frameAt, isEffectivelyLocked, isEffectivelyVisible, makeNode, nextName, normalizeRect, rectsIntersect, sectionAt, selectionBounds, topLevel } from "../engine/nodes";
import { type Prefs, editor, useEditor } from "../engine/store";
import {
    type Point,
    apply,
    applyVector,
    containsPoint,
    corners,
    isAxisAligned,
    normalizeAngle,
    spaceMatrix,
    worldBounds,
    worldMatrix,
} from "../engine/transform";
import type { Camera, Command, NagmaDocument, NodeType, Rect, SceneNode, Tool } from "../engine/types";
import { type Handle, hitFrameLabel, hitSelection, hitTest, nodeContains, promoteToGroup, resizeCursor, rotateCursor } from "./hit-test";
import {
    type VertexRef,
    appendPoint,
    bendAnchor,
    closeLastSubpath,
    constrainAngle,
    continueFrom,
    cutAt,
    eraseSegment,
    firstPoint,
    hitSegment,
    hitVertex,
    insertPoint,
    isSelected,
    moveVertices,
    screenVertices,
    shapeLastPoint,
    bendSegment,
    vertexPosition,
    startSubpath,
    toVectorSpace,
    builderApply,
    cutAcross,
    regionsAt,
    geometrySnap,
    vectorFrom,
    toggleSmooth,
    verticesInLasso,
    verticesInRect,
} from "./vector-edit";
import { paintPreview } from "./plugins/paint-preview";
import { duplicateInPlace, enterVectorEdit, isLastDuplicate, leaveVectorEdit, recordDuplicateMove, rehome } from "../engine/actions";
import { decodeAssetDrag, placeAsset, swapTo } from "../components/asset-sources";
import { firstImagePaint, openPhotoEditor } from "../engine/photo";
import { collab, setCursor as setCollabCursor } from "../engine/collab";
import { beginCommentDraft } from "../engine/comments";
import { placeImages } from "../engine/images";
import { ModeBanner } from "../components/collab-ui";
import { CanvasOverlays } from "../components/canvas-overlays";
import { startAnnotation } from "../engine/annotations";
import { animatedDoc, setKeyframe, valueAt } from "../engine/animation";
import { hasVideo, stopPlayback, syncPlayback } from "../engine/video";
import { solid } from "../engine/paint";
import { snapPx } from "../engine/pixel-grid";
import { lastFrameSize, rememberFrameSize } from "../engine/presets";
import { type DrawSettings, type ShapeKind, isShapeTool, makeFreehand, makeShape } from "../engine/shapes";
import { isFrameLike, moveWouldNestItself } from "../engine/components";
import { activePage, isTopLevel } from "../engine/page";
import { layoutIndexAt } from "../engine/layout";
import { keys } from "./keys";
import { matchUnder, matchingLayers } from "../engine/matching";
import { hitDevBadge } from "./dev-badges";
import { uiOverlay } from "./ui-overlay";
import { ui } from "../engine/ui-state";
import { hitSmart, smartCursor, smartDragging, smartPointerDown, smartPointerMove, smartPointerUp } from "./smart-selection";
import { markReady, openDevStatusMenu } from "../components/dev-status-state";
import { type Guide, type Measure, dragMeasures, guidesForBox, measureBetween, snapEdges, snapEqualSpacing, snapRect, snapTargets } from "./snapping";
import { PALETTES, RULER_SIZE, renderScene } from "./render";
import { protoHover, protoPointerDown, protoPointerMove, protoPointerUp } from "./prototype-connections";
import { TextEditor } from "./text-editor";
import { drawPluginOverlays, pluginDoubleClick, pluginDown, pluginMove, pluginUp } from "./canvas-plugins";
import { focusResizePlugin } from "./plugins/focus-resize";
import "./vector-plugins";
import "./plugins/layout-handles";
import { editTextAt } from "../engine/text-session";
import { allBrushes } from "../engine/brushes";
import { paintToolFill, vectorUi } from "../engine/vector-ui";
import { placedSubpaths } from "../engine/vector";
import { faceAt, isFaceFilled, networkFaces, paintFaces } from "../engine/vector-network";

type Gesture =
    | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
    | { kind: "create"; type: NodeType; shape?: ShapeKind; variant?: "section" | "slice"; start: Point; base: NagmaDocument; parentId: string | null; nodeId: string; moved: boolean; targets: Rect[] }
    | { kind: "freehand"; samples: Point[]; base: NagmaDocument; parentId: string | null; nodeId: string; brush: boolean }
    | { kind: "move"; start: Point; base: NagmaDocument; ids: string[]; moved: boolean; targets: Rect[]; box: Rect | null }
    | { kind: "resize"; handle: Handle; start: Point; base: NagmaDocument; ids: string[]; bounds: Rect; targets: Rect[]; scale?: boolean }
    | { kind: "rotate"; base: NagmaDocument; ids: string[]; center: Point; startAngle: number }
    | { kind: "marquee"; start: Point; scope: string[]; baseSelection: string[]; clickSelect?: string; toggle?: boolean; dragged?: boolean }
    | { kind: "vertex"; nodeId: string; refs: VertexRef[]; base: NagmaDocument; start: Point; moved: boolean }
    | { kind: "bend"; nodeId: string; ref: VertexRef; base: NagmaDocument; moved: boolean }
    | { kind: "bendSegment"; nodeId: string; sub: number; index: number; t: number; base: NagmaDocument }
    | { kind: "vmarquee"; nodeId: string; start: Point; lasso: boolean; points: Point[]; baseRefs: VertexRef[]; moved: boolean }
    | { kind: "builder"; nodeId: string; hits: number[]; remove: boolean }
    | { kind: "paint"; nodeId: string; hits: string[]; remove: boolean }
    | { kind: "cutline"; nodeId: string; start: Point; screenStart: Point; end: Point; moved: boolean; seg: ReturnType<typeof hitSegment> }
    | { kind: "guide"; axis: "x" | "y"; index: number; base: NagmaDocument }
    | { kind: "focusResize" }
    | { kind: "pen"; nodeId: string; base: NagmaDocument; start: Point; dragging: boolean }
    | { kind: "connect"; from: string }
    | { kind: "zoom"; start: Point; screen: Point; out: boolean; dragged: boolean };

const DRAG_THRESHOLD = 3;

// The ruler guide under a screen point (within 4 px), as its index on the page.
function guideAt(doc: NagmaDocument, pageId: string, camera: Camera, p: Point): number | null {
    const guides = doc.nodes[pageId]?.rulerGuides ?? [];
    for (let i = guides.length - 1; i >= 0; i--) {
        const g = guides[i] as { axis: "x" | "y"; at: number };
        const at = g.axis === "x" ? camera.x + g.at * camera.zoom : camera.y + g.at * camera.zoom;
        if (Math.abs((g.axis === "x" ? p.x : p.y) - at) <= 4) return i;
    }
    return null;
}

// Shift while dragging points: along the dominant axis only.
function axisLock(d: Point): Point {
    return Math.abs(d.x) >= Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y };
}

// A world point expressed in the coordinate space of a parent frame (or the canvas).
function toSpace(doc: NagmaDocument, parentId: string | null, p: Point): Point {
    return apply(spaceMatrix(doc, parentId).inverse(), p.x, p.y);
}

export function CanvasView() {
    const colorProfile = useEditor((s) => (s.prefs.colorManaged ? (s.doc.colorProfile ?? "srgb") : "srgb"));
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    // A right-button press while "Right-click and drag to pan" is on.
    const rightPanRef = useRef<{ moved: boolean; x: number; y: number; meta: boolean } | null>(null);
    const marqueeRef = useRef<Rect | null>(null);
    const lassoRef = useRef<Point[] | null>(null);
    const guidesRef = useRef<Guide[]>([]);
    const measuresRef = useRef<Measure[]>([]);
    // The Eyedropper: reads the pixel under the pointer from the drawn canvas. In Design mode it
    // becomes the selection's fill; it's always copied, so Inspect can paste it.
    const sampleColor = (screen: Point) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const px = ctx.getImageData(Math.round(screen.x * dpr), Math.round(screen.y * dpr), 1, 1).data;
        const hex = `#${[px[0], px[1], px[2]].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        const s = editor.get();
        if (s.pickColorInto) {
            const into = s.pickColorInto;
            editor.set({ pickColorInto: null, tool: "move" });
            into(hex);
            return;
        }
        if (s.mode !== "dev" && !s.readOnly && s.selection.length) {
            editor.execute({
                type: "batch",
                commands: s.selection.map((id) => {
                    const node = s.doc.nodes[id];
                    const fills = node?.fills.length ? node.fills.map((p, i) => (i === 0 && p.type === "solid" ? { ...p, color: hex } : p)) : [solid(hex)];
                    return { type: "node.update" as const, id, patch: { fills } };
                }),
            });
        }
        void navigator.clipboard?.writeText(hex).catch(() => undefined);
        editor.notify(`${hex} copied${s.mode !== "dev" && s.selection.length ? " and applied to the fill" : ""}.`);
    };
    const [size, setSize] = useState({ width: 0, height: 0 });
    // Null means "use the active tool's cursor"; set while hovering handles or panning.
    const [cursor, setCursor] = useState<string | null>(null);
    const tool = useEditor((s) => s.tool);
    const editingTextId = useEditor((s) => s.editingTextId);
    const presenting = useEditor((s) => s.presentingId !== null);

    // Keep the canvas sized to its container, at device resolution.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let first = true;
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const { width, height } = entry.contentRect;
            const previous = { width: viewport.width, height: viewport.height };
            viewport.width = width;
            viewport.height = height;
            setSize({ width, height });
            if (first && width > 0) {
                first = false;
                zoomToFit();
            } else if (!first) {
                // Keep whatever was in the middle of the canvas in the middle while the window resizes.
                const { camera } = editor.get();
                editor.set({
                    camera: { ...camera, x: camera.x + (width - previous.width) / 2, y: camera.y + (height - previous.height) / 2 },
                });
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // Redraw on any editor change, once per frame.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", colorProfile === "p3" ? { colorSpace: "display-p3" } : undefined);
        if (!canvas || !ctx) return;
        let frame = 0;
        const draw = () => {
            frame = 0;
            const s = editor.get();
            // Video fills follow the playhead in Motion mode, and rest on their poster elsewhere.
            if (s.mode === "motion" && hasVideo(s.doc)) syncPlayback(s.doc, s.time / 1000, s.playing);
            else if (s.mode !== "motion" && !s.presentingId) stopPlayback();
            // A drawing error must never take the editor down: report it and keep the UI alive.
            try {
                renderScene(
                    ctx,
                    size.width,
                    size.height,
                    // Motion mode shows the design at the playhead.
                    s.mode === "motion" ? animatedDoc(s.doc, s.time) : s.doc,
                    s.camera,
                    {
                        prototype:
                        s.rightTab === "prototype" && !s.uiHidden
                            ? { connecting: null }
                            : null,
                    // Hiding multiplayer cursors hides the pointers; collaborators' selections still show.
                    peers: Object.values(collab.get().peers)
                        .filter((p) => p.pageId === s.pageId)
                        .map((p) => (s.prefs.multiplayerCursors ? p : { ...p, cursor: null })),
                    vectorEdit: s.editingVectorId ? { nodeId: s.editingVectorId, vertices: s.vertices, lasso: lassoRef.current } : null,
                        pen: s.penNodeId && s.tool === "pen" ? { nodeId: s.penNodeId, cursor: gestureRef.current ? null : s.penCursor } : null,
                        marquee: marqueeRef.current,
                        guides: guidesRef.current,
                        measures: gestureRef.current ? measuresRef.current : altMeasures(s.doc, s.selection, s.hoverId),
                        editingTextId: s.editingTextId,
                        hoverId: gestureRef.current ? null : s.hoverId,
                        // "Hide canvas UI during changes": no selection box while dragging, resizing or rotating.
                        selection: s.prefs.hideUiDuringChanges && gestureRef.current && ["move", "resize", "rotate"].includes(gestureRef.current.kind) ? [] : s.selection,
                        rulers: s.prefs.rulers && !s.uiHidden && !s.doc.board && !s.doc.slides && !s.doc.campaign && !s.doc.site,
                        rulerGuides: s.uiHidden ? [] : (s.doc.nodes[s.pageId]?.rulerGuides ?? []),
                        presenting: s.presentingId !== null,
                        pixelGrid: s.prefs.pixelGrid,
                        outlines: s.prefs.outlines,
                        showDimensions: s.prefs.showDimensions && !s.doc.board && !s.doc.slides && !s.doc.campaign,
                        layoutGuides: s.prefs.layoutGuides,
                        showSlices: s.prefs.showSlices,
                        maskOutlines: s.prefs.maskOutlines,
                        frameOutlines: s.prefs.frameOutlines,
                        pixelPreview: s.prefs.pixelPreview,
                        pixelPreviewScale: s.prefs.pixelPreviewScale,
                        viewOnly: s.readOnly && s.mode !== "dev",
                        unmanagedColor: !s.prefs.colorManaged,
                    },
                    PALETTES[s.prefs.theme],
                );
                if (!s.presentingId && !s.uiHidden) drawPluginOverlays(ctx, s.camera);
            } catch (error) {
                console.error("Canvas draw failed", error);
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(draw);
        };
        draw();
        const unsubscribe = editor.subscribe(schedule);
        const unsubscribeCollab = collab.subscribe(schedule);
        void document.fonts?.ready.then(schedule);
        return () => {
            unsubscribe();
            unsubscribeCollab();
            cancelAnimationFrame(frame);
        };
    }, [size, colorProfile]);

    // Wheel pans; pinch or Cmd/Ctrl + wheel zooms around the pointer. Needs a non-passive listener.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            if (editor.get().presentingId) return;
            const { camera } = editor.get();
            const rect = container.getBoundingClientRect();
            // "Use scroll wheel zoom": the wheel zooms (⇧ still scrolls sideways).
            if (event.ctrlKey || event.metaKey || (editor.get().prefs.scrollZoom && !event.shiftKey)) {
                const direction = editor.get().prefs.invertZoom ? 1 : -1;
                const factor = Math.exp(direction * event.deltaY * (event.ctrlKey && !event.metaKey ? 0.01 : 0.002));
                editor.set({ camera: zoomAt(camera, event.clientX - rect.left, event.clientY - rect.top, camera.zoom * factor) });
            } else {
                const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
                const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
                editor.set({ camera: { ...camera, x: camera.x - dx, y: camera.y - dy } });
            }
        };
        container.addEventListener("wheel", onWheel, { passive: false });
        return () => container.removeEventListener("wheel", onWheel);
    }, []);

    const local = (event: { clientX: number; clientY: number }) => {
        const rect = containerRef.current?.getBoundingClientRect();
        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    };

    // What canvas plugins see of a pointer event.
    const pointer = (event: React.PointerEvent | React.MouseEvent) => {
        const screen = local(event);
        return { screen, world: screenToWorld(editor.get().camera, screen.x, screen.y), shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, button: event.button };
    };

    const onRuler = (p: Point) => {
        const s = editor.get();
        return s.prefs.rulers && !s.uiHidden && !s.doc.board && !s.doc.slides && !s.doc.campaign && !s.doc.site && (p.x < RULER_SIZE || p.y < RULER_SIZE);
    };

    // The right-click menu at a window point (selecting what's under it first).
    const contextMenuAt = (clientX: number, clientY: number, deep: boolean) => {
        const s = editor.get();
        if (s.presentingId || s.editingTextId) return;
        const p = local({ clientX, clientY });
        const world = screenToWorld(s.camera, p.x, p.y);
        const raw = hitFrameLabel(s.doc, s.camera, p.x, p.y) ?? hitTest(s.doc, world.x, world.y, deep);
        const hit = raw ? promoteToGroup(s.doc, raw, s.selection, deep) : null;
        // Right-clicking something outside the selection selects it first.
        if (hit && !s.selection.includes(hit.id)) editor.set({ selection: [hit.id] });
        if (!hit) editor.set({ selection: [] });
        editor.set({ contextMenu: { x: clientX, y: clientY } });
    };

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const s = editor.get();
        if (s.editingTextId || s.presentingId) return;
        containerRef.current?.focus();
        const screen = local(event);
        const world = screenToWorld(s.camera, screen.x, screen.y);
        // Dragging out of a ruler makes a guide; grabbing a guide moves it (back onto the ruler removes it).
        if (onRuler(screen)) {
            if (s.readOnly || event.button !== 0) return;
            const axis: "x" | "y" = screen.x < RULER_SIZE && screen.y >= RULER_SIZE ? "x" : screen.y < RULER_SIZE && screen.x >= RULER_SIZE ? "y" : "x";
            const page = s.doc.nodes[s.pageId];
            if (!page) return;
            const guides = [...(page.rulerGuides ?? []), { axis, at: axis === "x" ? world.x : world.y }];
            editor.execute({ type: "node.update", id: page.id, patch: { rulerGuides: guides } });
            event.currentTarget.setPointerCapture(event.pointerId);
            gestureRef.current = { kind: "guide", axis, index: guides.length - 1, base: editor.get().doc };
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        if (s.tool === "move" && event.button === 0 && !s.readOnly && !s.editingVectorId) {
            const hit = guideAt(s.doc, s.pageId, s.camera, screen);
            if (hit !== null) {
                const page = s.doc.nodes[s.pageId];
                const axis = page?.rulerGuides?.[hit]?.axis ?? "x";
                gestureRef.current = { kind: "guide", axis, index: hit, base: s.doc };
                return;
            }
        }

        // Holding Z: a click zooms in at the pointer (⌥ zooms out), a drag zooms to the box.
        if (keys.z && event.button === 0) {
            gestureRef.current = { kind: "zoom", start: world, screen, out: event.altKey, dragged: false };
            return;
        }
        if (event.button === 1 || keys.space || s.tool === "hand") {
            gestureRef.current = { kind: "pan", startX: screen.x, startY: screen.y, camX: s.camera.x, camY: s.camera.y };
            setCursor("grabbing");
            return;
        }
        // "Right-click and drag to pan": a right press pans; let go without moving, it's a right-click.
        if (event.button === 2 && s.prefs.rightClickPan) {
            gestureRef.current = { kind: "pan", startX: screen.x, startY: screen.y, camX: s.camera.x, camY: s.camera.y };
            rightPanRef.current = { moved: false, x: event.clientX, y: event.clientY, meta: event.metaKey || event.ctrlKey };
            return;
        }
        if (event.button !== 0) return;
        // Read-only (view links, version previews): select, pan and comment, nothing that edits.
        // Inspect is for looking, not editing.
        const readOnly = s.readOnly || s.mode === "dev";
        if (readOnly && !LOOK_TOOLS.has(s.tool)) editor.set({ tool: "move" });
        if (!readOnly && pluginDown(pointer(event))) return;
        // Inspect's focus view: the temporary-resize handles work although the canvas is read-only.
        if (readOnly && s.mode === "dev" && focusResizePlugin.down(pointer(event))) {
            gestureRef.current = { kind: "focusResize" };
            return;
        }

        // Point editing. The vector bar's tool decides what a press does; the pen keeps drawing on this vector.
        if (s.editingVectorId && s.tool !== "pen") {
            const node = s.doc.nodes[s.editingVectorId];
            if (!node) {
                leaveVectorEdit();
                return;
            }
            const vec = toVectorSpace(s.doc, node, world);
            const ref = hitVertex(s.doc, node, s.camera, s.vertices, screen.x, screen.y);
            const seg = ref ? null : hitSegment(s.doc, node, s.camera, screen.x, screen.y);
            const tool = s.vectorTool;
            if (!ref && !seg && (event.metaKey || event.ctrlKey)) {
                // ⌘click another vector (or shape) switches point editing to it.
                const other = hitTest(s.doc, world.x, world.y, true);
                if (other && other.id !== node.id && (other.type === "vector" || other.type === "rect" || other.type === "ellipse")) {
                    leaveVectorEdit();
                    enterVectorEdit(other.id);
                    return;
                }
            }
            if (tool === "bend") {
                if (ref?.part === "anchor") {
                    editor.set({ vertices: [ref] });
                    gestureRef.current = { kind: "bend", nodeId: node.id, ref, base: s.doc, moved: false };
                    return;
                }
                if (ref) {
                    editor.set({ vertices: [ref] });
                    gestureRef.current = { kind: "vertex", nodeId: node.id, refs: [ref], base: s.doc, start: vec, moved: false };
                    return;
                }
                if (seg) {
                    // Dragging a segment bends it through the pointer, without adding a point.
                    editor.set({ vertices: [] });
                    gestureRef.current = { kind: "bendSegment", nodeId: node.id, sub: seg.sub, index: seg.index, t: seg.t, base: s.doc };
                    return;
                }
            }
            if (tool === "cut") {
                // Click on the path splits it there; drag across the shape divides it.
                gestureRef.current = { kind: "cutline", nodeId: node.id, start: vec, screenStart: screen, end: vec, moved: false, seg };
                return;
            }
            if (tool === "erase") {
                if (!seg) return;
                const patch = eraseSegment(node, seg);
                if (patch) editor.execute({ type: "node.update", id: node.id, patch });
                else {
                    editor.execute({ type: "node.delete", ids: [node.id] });
                    leaveVectorEdit();
                    editor.set({ selection: [] });
                }
                editor.set({ vertices: [] });
                return;
            }
            if (tool === "builder") {
                // Drag over regions to merge them, click one to pull it out, ⌥ to remove.
                gestureRef.current = { kind: "builder", nodeId: node.id, hits: regionsAt(node, vec), remove: event.altKey };
                return;
            }
            // The Variable width tool's points (canvas/plugins/width-tool.ts) took any press on the
            // stroke; elsewhere it does nothing.
            if (tool === "width") return;
            if (tool === "paint") {
                // Click a region of the network to fill it, or a filled one to clear it (⌥ always
                // clears); dragging carries on over more regions the same way.
                const subs = placedSubpaths(node);
                const face = faceAt(networkFaces(subs), vec);
                gestureRef.current = { kind: "paint", nodeId: node.id, hits: face ? [face.id] : [], remove: event.altKey || Boolean(face && isFaceFilled(node, subs, face.id)) };
                paintPreview.painted = gestureRef.current.hits;
                paintPreview.remove = gestureRef.current.remove;
                return;
            }
            if (tool === "lasso") {
                gestureRef.current = { kind: "vmarquee", nodeId: node.id, start: screen, lasso: true, points: [screen], baseRefs: event.shiftKey ? s.vertices : [], moved: false };
                return;
            }
            if (ref) {
                let refs: VertexRef[];
                // ⇧click handles to pick several; they then move together.
                if (ref.part !== "anchor") refs = event.shiftKey ? [...s.vertices.filter((r) => !(r.part === ref.part && r.sub === ref.sub && r.index === ref.index)), ref] : [ref];
                else if (event.shiftKey) refs = isSelected(s.vertices, ref.sub, ref.index) ? s.vertices.filter((r) => !(r.part === "anchor" && r.sub === ref.sub && r.index === ref.index)) : [...s.vertices.filter((r) => r.part === "anchor"), ref];
                else refs = isSelected(s.vertices, ref.sub, ref.index) ? s.vertices : [ref];
                editor.set({ vertices: refs });
                gestureRef.current = { kind: "vertex", nodeId: node.id, refs, base: s.doc, start: vec, moved: false };
                return;
            }
            if (seg && (event.metaKey || event.ctrlKey)) {
                // ⌘click on the outline adds a point there.
                const added = insertPoint(node, seg);
                if (added) {
                    editor.execute({ type: "node.update", id: node.id, patch: added.patch });
                    editor.set({ vertices: [added.ref] });
                }
                return;
            }
            // Drag on empty space selects points in a rectangle; a plain click inside clears, outside leaves.
            gestureRef.current = { kind: "vmarquee", nodeId: node.id, start: screen, lasso: false, points: [], baseRefs: event.shiftKey ? s.vertices : [], moved: false };
            return;
        }

        if (s.tool === "eyedropper") {
            sampleColor(screen);
            return;
        }
        if (s.tool === "annotation") {
            const hit = hitTest(s.doc, world.x, world.y, true);
            if (!hit) {
                editor.notify("Click a layer to annotate it.");
                return;
            }
            // The annotation opens in its inline editor next to the layer.
            startAnnotation(hit.id);
            return;
        }
        if (!readOnly && s.tool === "textpath") {
            const hit = hitTest(s.doc, world.x, world.y, true);
            if (!hit || (hit.type !== "vector" && hit.type !== "ellipse" && hit.type !== "rect")) {
                editor.notify("Click a path, line or shape to run text along it.");
                return;
            }
            const box = worldBounds(s.doc, hit);
            const node = makeNode(s.doc, "text", { x: box.x, y: box.y - 24, w: box.w, h: box.h + 48 }, hit.parentId, { name: "Text on path", text: "Text on path", pathId: hit.id, sizing: { h: "fixed", v: "fixed" } });
            editor.execute({ type: "node.create", node });
            editor.set({ selection: [node.id], tool: "move" });
            return;
        }

        if (s.tool === "comment") {
            // Comments work on local files too (kept in this browser) and on shared ones. Dragging
            // comments on an area.
            const host = containerRef.current?.getBoundingClientRect();
            beginCommentDraft(s.pageId, world, (cx, cy) => screenToWorld(editor.get().camera, cx - (host?.left ?? 0), cy - (host?.top ?? 0)), editor.get().camera.zoom);
            return;
        }

        if (!readOnly && s.tool === "pen") {
            let pen = s.penNodeId ? s.doc.nodes[s.penNodeId] : undefined;
            const edited = !pen && s.editingVectorId ? s.doc.nodes[s.editingVectorId] : undefined;
            if (edited) {
                // While editing a vector, the pen continues an open path from its end, adds a point on
                // the outline, or starts another subpath in the same layer.
                const ref = hitVertex(s.doc, edited, s.camera, [], screen.x, screen.y);
                const seg = ref ? null : hitSegment(s.doc, edited, s.camera, screen.x, screen.y);
                const resume = ref?.part === "anchor" ? continueFrom(edited, ref) : null;
                if (resume) {
                    editor.execute({ type: "node.update", id: edited.id, patch: resume });
                    editor.set({ penNodeId: edited.id, vertices: [] });
                    return;
                }
                if (seg) {
                    const added = insertPoint(edited, seg);
                    if (added) {
                        editor.execute({ type: "node.update", id: edited.id, patch: added.patch });
                        editor.set({ vertices: [added.ref] });
                    }
                    return;
                }
                // A point in the middle of a path: a new segment branches out of it (a junction).
                const at = ref?.part === "anchor" ? (vertexPosition(edited, ref) ?? toVectorSpace(s.doc, edited, world)) : toVectorSpace(s.doc, edited, world);
                editor.execute({ type: "node.update", id: edited.id, patch: startSubpath(edited, at) });
                editor.set({ penNodeId: edited.id, vertices: [] });
                pen = editor.get().doc.nodes[edited.id];
                if (pen) gestureRef.current = { kind: "pen", nodeId: pen.id, base: editor.get().doc, start: world, dragging: false };
                return;
            }
            if (pen) {
                // Clicking the first point closes the shape and ends the path.
                const subs = pen.path?.subpaths ?? [];
                const sub = subs[subs.length - 1];
                const first = screenVertices(s.doc, pen, s.camera, []).find((v) => v.part === "anchor" && v.sub === subs.length - 1 && v.index === 0);
                if (sub && sub.points.length >= 2 && first && Math.hypot(first.x - screen.x, first.y - screen.y) <= 8) {
                    uiOverlay.penClose = null;
                    editor.execute({ type: "node.update", id: pen.id, patch: closeLastSubpath(pen) });
                    editor.finishPen();
                    if (!s.editingVectorId) editor.set({ tool: "move" });
                    return;
                }
                // Clicking another point of the same vector joins the new segment to it (a point of
                // the network can have any number of segments) and ends this path.
                const onPoint = sub && sub.points.length >= 1 ? hitVertex(s.doc, pen, s.camera, [], screen.x, screen.y) : null;
                const lastIndex = (sub?.points.length ?? 1) - 1;
                if (onPoint?.part === "anchor" && !(onPoint.sub === subs.length - 1 && onPoint.index === lastIndex)) {
                    const target = vertexPosition(pen, onPoint);
                    if (target) {
                        uiOverlay.penClose = null;
                        editor.execute({ type: "node.update", id: pen.id, patch: appendPoint(pen, { x: target.x, y: target.y, in: null, out: null }) });
                        editor.finishPen();
                        if (!s.editingVectorId) editor.set({ tool: "move" });
                        return;
                    }
                }
                let at = toVectorSpace(s.doc, pen, world);
                const last = sub?.points[sub.points.length - 1];
                if (event.shiftKey && last) at = constrainAngle(last, at);
                editor.execute({ type: "node.update", id: pen.id, patch: appendPoint(pen, { x: at.x, y: at.y, in: null, out: null }) });
                gestureRef.current = { kind: "pen", nodeId: pen.id, base: editor.get().doc, start: world, dragging: false };
                return;
            }
            const parentId = frameAt(s.doc, world.x, world.y);
            const at = toSpace(s.doc, parentId, world);
            const node = makeNode(s.doc, "vector", { x: at.x, y: at.y, w: 1, h: 1 }, parentId, {
                name: nextName(s.doc, "vector", parentId),
                fills: [],
                strokes: [solid("#000000")],
                strokeAlign: "center",
                strokeWidth: 1,
                ...firstPoint(at),
            });
            editor.execute({ type: "node.create", node });
            editor.set({ penNodeId: node.id, selection: [node.id] });
            gestureRef.current = { kind: "pen", nodeId: node.id, base: editor.get().doc, start: world, dragging: false };
            return;
        }

        if (!readOnly && (s.tool === "pencil" || s.tool === "brush" || (s.tool === "pen" && s.mode === "draw")) && (event.metaKey || event.ctrlKey)) {
            // ⌘click a stroke to sample its colour and size into the draw strip.
            const hit = hitTest(s.doc, world.x, world.y, true);
            const stroke = hit?.strokes.find((p) => p.visible && p.type === "solid");
            if (hit && stroke?.type === "solid") {
                editor.setPrefs({ drawColor: stroke.color, drawSize: Math.max(1, Math.round(hit.strokeWidth)) });
                // The brush too: the one whose look the stroke carries (a custom brush by its id).
                const sampled = hit.brushStroke ? allBrushes(s.doc).find((b) => b.stroke && b.stroke.type === hit.brushStroke?.type && (hit.brushStroke.custom ? b.stroke.custom?.id === hit.brushStroke.custom.id : b.stroke.name === hit.brushStroke.name && (b.stroke.type === "stretch" || b.stroke.gap === hit.brushStroke.gap))) : undefined;
                if (sampled) vectorUi.set({ brush: sampled.id });
                editor.notify(`Sampled ${stroke.color} at ${Math.round(hit.strokeWidth)}${sampled ? `, ${sampled.name}` : ""}.`);
            } else editor.notify("⌘click a stroke to sample its properties.");
            return;
        }
        if (!readOnly && (s.tool === "pencil" || s.tool === "brush")) {
            const parentId = frameAt(s.doc, world.x, world.y);
            gestureRef.current = { kind: "freehand", samples: [world], base: s.doc, parentId, nodeId: nanoid(10), brush: s.tool === "brush" };
            return;
        }

        if (!readOnly && (s.tool === "frame" || s.tool === "section" || s.tool === "slice" || s.tool === "rect" || s.tool === "ellipse" || s.tool === "text" || isShapeTool(s.tool))) {
            const shape = isShapeTool(s.tool) ? s.tool : undefined;
            const variant = s.tool === "section" || s.tool === "slice" ? s.tool : undefined;
            const type: NodeType = shape ? "vector" : variant ? "frame" : (s.tool as NodeType);
            // A section lives on the canvas or in another section, never inside a frame.
            const parentId = variant === "section" ? sectionAt(s.doc, world.x, world.y) : frameAt(s.doc, world.x, world.y);
            const node = makeNode(s.doc, type, { x: 0, y: 0, w: 1, h: 1 }, parentId);
            const targets = createTargets(s.doc, parentId);
            const snap = snapEdges([world.x], [world.y], targets, s.camera.zoom);
            const start = { x: snapPx(world.x + snap.dx), y: snapPx(world.y + snap.dy) };
            gestureRef.current = { kind: "create", type, shape, variant, start, base: s.doc, parentId, nodeId: node.id, moved: false, targets };
            return;
        }

        // Prototype tab: the link handle, connections (select, drag an end to retarget) and flow tags.
        if (s.rightTab === "prototype" && !s.uiHidden && event.button === 0 && protoPointerDown(screen, world, readOnly)) {
            gestureRef.current = { kind: "connect", from: "" };
            return;
        }

        // A dev status badge beside a frame or section name: marks it ready, or opens its status menu.
        const badge = s.tool === "move" && !readOnly ? hitDevBadge(s.doc, s.camera, s.selection, screen.x, screen.y) : null;
        if (badge) {
            if (badge.status) openDevStatusMenu([badge.id], event.clientX, event.clientY + 8);
            else markReady([badge.id], event.clientX, event.clientY + 8);
            return;
        }
        // Move tool: selection handles first, then layers, then frame labels, then marquee.
        const handleHit = s.selection.length && !readOnly ? withoutBoardRotate(s.doc, s.selection, hitSelection(s.doc, s.selection, s.camera, screen.x, screen.y)) : null;
        // Smart selection: a gap handle or a layer's dot in an evenly spaced selection.
        if (!handleHit && s.selection.length > 1 && smartPointerDown(screen)) return;
        if (handleHit && s.selection.some((id) => s.doc.nodes[id]?.sourceId)) {
            // Layers inside an instance follow the component's geometry.
            editor.notify("Layers inside an instance can't be resized or rotated. Change the main component, or detach the instance.");
            return;
        }
        if (handleHit?.kind === "resize") {
            const bounds = selectionBounds(s.doc, s.selection);
            const ids = topLevel(s.doc, s.selection);
            if (bounds)
                gestureRef.current = { kind: "resize", handle: handleHit.handle, start: world, base: s.doc, ids, bounds, targets: snapTargets(s.doc, ids), scale: s.tool === "scale" };
            return;
        }
        if (handleHit?.kind === "rotate") {
            const ids = topLevel(s.doc, s.selection);
            const single = ids.length === 1 ? s.doc.nodes[ids[0] ?? ""] : undefined;
            const pts = single ? corners(s.doc, single) : null;
            const b = selectionBounds(s.doc, ids);
            const center = pts
                ? { x: pts.reduce((sum, p) => sum + p.x, 0) / 4, y: pts.reduce((sum, p) => sum + p.y, 0) / 4 }
                : b
                  ? { x: b.x + b.w / 2, y: b.y + b.h / 2 }
                  : world;
            gestureRef.current = { kind: "rotate", base: s.doc, ids, center, startAngle: Math.atan2(world.y - center.y, world.x - center.x) };
            return;
        }

        const deep = event.metaKey || event.ctrlKey;
        // ⇧click on a layer matching the selection adds or removes it, however deep it is.
        const match = event.shiftKey && !deep ? matchUnder(s.doc, s.selection, world.x, world.y) : null;
        if (match) {
            editor.set({ selection: s.selection.includes(match) ? s.selection.filter((id) => id !== match) : [...s.selection, match] });
            return;
        }
        const labelHit = hitFrameLabel(s.doc, s.camera, screen.x, screen.y);
        const raw = labelHit ?? hitTest(s.doc, world.x, world.y, deep);
        const hit = raw ? promoteToGroup(s.doc, raw, s.selection, deep) : null;
        // A top-level frame that isn't selected works like the canvas: a drag on its body draws a
        // marquee over its children, a plain click selects the frame (its label always grabs it).
        if (hit && !labelHit && !readOnly && isFrameLike(hit) && !hit.isSection && isTopLevel(s.doc, hit) && !s.selection.includes(hit.id) && !event.shiftKey && !event.altKey && !deep) {
            gestureRef.current = { kind: "marquee", start: world, scope: hit.children, baseSelection: [], clickSelect: hit.id };
            return;
        }
        // ⇧drag across frames holding matching layers: the marquee adds or removes only those.
        const shiftMatches = event.shiftKey && !deep && (!hit || (!labelHit && isFrameLike(hit) && isTopLevel(s.doc, hit))) ? matchingLayers(s.doc, s.selection) : [];
        if (shiftMatches.length) {
            gestureRef.current = { kind: "marquee", start: world, scope: shiftMatches, baseSelection: s.selection, toggle: true };
            return;
        }
        // ⌘drag that starts on a frame's empty background draws a deep marquee instead of moving the frame.
        if (hit && deep && !labelHit && !readOnly && isFrameLike(hit) && hit.children.length > 0 && !s.selection.includes(hit.id)) {
            if (!event.shiftKey) editor.set({ selection: [] });
            gestureRef.current = { kind: "marquee", start: world, scope: deepMarqueeScope(s.doc, s.pageId), baseSelection: event.shiftKey ? s.selection : [], toggle: event.shiftKey, clickSelect: event.shiftKey ? undefined : hit.id };
            return;
        }
        if (hit) {
            let selection = s.selection;
            if (event.shiftKey) {
                selection = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
            } else if (!selection.includes(hit.id)) {
                selection = [hit.id];
            }
            editor.set({ selection });
            if (!readOnly && selection.includes(hit.id) && !selection.some((id) => s.doc.nodes[id]?.sourceId)) {
                // ⌥drag moves a copy and leaves the original behind.
                const ids = event.altKey ? duplicateInPlace() : topLevel(s.doc, selection);
                const base = editor.get().doc;
                gestureRef.current = {
                    kind: "move",
                    start: world,
                    base,
                    ids,
                    moved: false,
                    targets: snapTargets(base, ids),
                    box: selectionBounds(base, ids),
                };
            }
            return;
        }

        const container = frameAt(s.doc, world.x, world.y);
        // ⌘drag reaches the deepest layers anywhere on the page; ⇧drag adds to (or removes from) the selection.
        const scope = deep ? deepMarqueeScope(s.doc, s.pageId) : container ? (s.doc.nodes[container]?.children ?? []) : s.doc.roots;
        const baseSelection = event.shiftKey ? s.selection : [];
        if (!event.shiftKey) editor.set({ selection: [] });
        gestureRef.current = { kind: "marquee", start: world, scope, baseSelection, toggle: event.shiftKey };
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const screen = local(event);
        const s = editor.get();
        if (s.presentingId) return;
        const world = screenToWorld(s.camera, screen.x, screen.y);
        const gesture = gestureRef.current;
        // Collaborators see your cursor.
        setCollabCursor(world);
        if (smartDragging()) {
            smartPointerMove(world, event.shiftKey);
            return;
        }
        if (!gesture && pluginMove(pointer(event), setCursor)) return;
        if (gesture?.kind === "focusResize") {
            focusResizePlugin.move(pointer(event));
            return;
        }
        if (!gesture && s.mode === "dev" && focusResizePlugin.hover(pointer(event))) {
            setCursor(focusResizePlugin.hover(pointer(event)) ?? null);
            return;
        }

        if (!gesture && s.tool === "pen") {
            // Over the path's first point (with at least two placed), a click closes the shape.
            const pen = s.penNodeId ? s.doc.nodes[s.penNodeId] : undefined;
            const subs = pen?.path?.subpaths ?? [];
            const first = pen && (subs[subs.length - 1]?.points.length ?? 0) >= 2 ? screenVertices(s.doc, pen, s.camera, []).find((v) => v.part === "anchor" && v.sub === subs.length - 1 && v.index === 0) : undefined;
            uiOverlay.penClose = first && Math.hypot(first.x - screen.x, first.y - screen.y) <= 8 ? { anchor: { x: first.x, y: first.y }, cursor: screen } : null;
            if (s.penNodeId) editor.set({ penCursor: world });
            setCursor(null);
            return;
        }
        if (!gesture && s.editingVectorId) {
            const node = s.doc.nodes[s.editingVectorId];
            const onPoint = node ? Boolean(hitVertex(s.doc, node, s.camera, s.vertices, screen.x, screen.y)) : false;
            const onEdge = node && !onPoint ? Boolean(hitSegment(s.doc, node, s.camera, screen.x, screen.y)) : false;
            const tool = s.vectorTool;
            setCursor(tool === "cut" || tool === "erase" ? (onEdge ? "crosshair" : "default") : tool === "paint" || tool === "builder" ? "cell" : tool === "width" ? "ns-resize" : onPoint ? "move" : onEdge && tool === "bend" ? "copy" : null);
            return;
        }
        if (!gesture) {
            if (s.tool !== "move" || keys.space || onRuler(screen)) {
                // The Frame tool tracks the top-level frame under the pointer for its quick-add "+".
                const frameHover = s.tool === "frame" && !keys.space && !onRuler(screen) ? topFrameUnder(s.doc, world) : null;
                if ((frameHover ?? null) !== s.hoverId) editor.set({ hoverId: frameHover ?? null });
                setCursor(onRuler(screen) ? "default" : null);
                return;
            }
            const handleHit = s.selection.length ? withoutBoardRotate(s.doc, s.selection, hitSelection(s.doc, s.selection, s.camera, screen.x, screen.y)) : null;
            if (handleHit) {
                setCursor(handleHit.kind === "resize" ? resizeCursor(handleHit.angle) : rotateCursor(handleHit.angle));
                if (s.hoverId) editor.set({ hoverId: null });
                return;
            }
            const smart = s.selection.length > 1 && !s.readOnly && s.mode !== "dev" ? hitSmart(s.doc, s.selection, s.camera, screen.x, screen.y) : null;
            if (smart) {
                setCursor(smartCursor(smart));
                if (s.hoverId) editor.set({ hoverId: null });
                return;
            }
            const badge = hitDevBadge(s.doc, s.camera, s.selection, screen.x, screen.y);
            if ((badge?.id ?? null) !== uiOverlay.devHover) {
                uiOverlay.devHover = badge?.id ?? null;
                editor.set({});
            }
            if (badge) {
                setCursor("pointer");
                return;
            }
            if (s.rightTab === "prototype" && !s.uiHidden) {
                const proto = protoHover(screen);
                if (proto.over) {
                    setCursor(proto.cursor);
                    if (s.hoverId) editor.set({ hoverId: null });
                    return;
                }
            }
            const guide = guideAt(s.doc, s.pageId, s.camera, screen);
            if (guide !== null) {
                setCursor(s.doc.nodes[s.pageId]?.rulerGuides?.[guide]?.axis === "x" ? "ew-resize" : "ns-resize");
                return;
            }
            setCursor(null);
            const deep = event.metaKey || event.ctrlKey;
            const raw = hitFrameLabel(s.doc, s.camera, screen.x, screen.y) ?? hitTest(s.doc, world.x, world.y, deep);
            let hoverId = raw && s.prefs.highlightHover ? promoteToGroup(s.doc, raw, s.selection, deep).id : null;
            // ⇧hover with a selection highlights the matching layer under the pointer.
            if (event.shiftKey && !deep && s.prefs.highlightHover) hoverId = matchUnder(s.doc, s.selection, world.x, world.y) ?? hoverId;
            if (hoverId !== s.hoverId) editor.set({ hoverId });
            return;
        }

        switch (gesture.kind) {
            case "pan":
                if (rightPanRef.current && Math.hypot(screen.x - gesture.startX, screen.y - gesture.startY) > 3 && !rightPanRef.current.moved) {
                    rightPanRef.current.moved = true;
                    setCursor("grabbing");
                }
                editor.set({ camera: { ...s.camera, x: gesture.camX + screen.x - gesture.startX, y: gesture.camY + screen.y - gesture.startY } });
                return;
            case "zoom":
                if (!gesture.dragged && Math.hypot(screen.x - gesture.screen.x, screen.y - gesture.screen.y) < DRAG_THRESHOLD) return;
                gesture.dragged = true;
                marqueeRef.current = normalizeRect(gesture.start.x, gesture.start.y, world.x, world.y);
                editor.set({});
                return;
            case "connect":
                protoPointerMove(world);
                return;
            case "vertex": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                const snapped = s.prefs.snapToGeometry && !event.ctrlKey && gesture.refs.length === 1 && gesture.refs[0]?.part === "anchor" ? geometrySnap(gesture.base, node, gesture.refs, world, s.camera.zoom) : null;
                const vec = toVectorSpace(gesture.base, node, snapped ?? world);
                if (!gesture.moved && Math.hypot(vec.x - gesture.start.x, vec.y - gesture.start.y) * s.camera.zoom < DRAG_THRESHOLD) return;
                gesture.moved = true;
                // Snapped, the point itself lands on the other point.
                const anchor = snapped && gesture.refs[0] ? placedSubpaths(node)[gesture.refs[0].sub]?.points[gesture.refs[0].index] : undefined;
                const delta = anchor ? { x: vec.x - anchor.x, y: vec.y - anchor.y } : event.shiftKey ? axisLock({ x: vec.x - gesture.start.x, y: vec.y - gesture.start.y }) : { x: vec.x - gesture.start.x, y: vec.y - gesture.start.y };
                const patch = moveVertices(node, gesture.refs, delta, vec, event.altKey ? "none" : s.handleMirror);
                editor.preview(applyCommand(gesture.base, { type: "node.update", id: node.id, patch }));
                return;
            }
            case "bendSegment": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                editor.preview(applyCommand(gesture.base, { type: "node.update", id: node.id, patch: bendSegment(node, gesture.sub, gesture.index, gesture.t, toVectorSpace(gesture.base, node, world)) }));
                return;
            }
            case "bend": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                const vec = toVectorSpace(gesture.base, node, world);
                const sv = screenVertices(gesture.base, node, s.camera, []).find((v) => v.part === "anchor" && v.sub === gesture.ref.sub && v.index === gesture.ref.index);
                if (!gesture.moved && sv && Math.hypot(sv.x - screen.x, sv.y - screen.y) < DRAG_THRESHOLD) return;
                gesture.moved = true;
                editor.preview(applyCommand(gesture.base, { type: "node.update", id: node.id, patch: bendAnchor(node, gesture.ref, vec) }));
                return;
            }
            case "guide": {
                const page = gesture.base.nodes[s.pageId];
                if (!page) return;
                const guides = [...(page.rulerGuides ?? [])];
                const at = Math.round(gesture.axis === "x" ? world.x : world.y);
                guides[gesture.index] = { axis: gesture.axis, at };
                editor.preview(applyCommand(gesture.base, { type: "node.update", id: page.id, patch: { rulerGuides: guides } }));
                setCursor(gesture.axis === "x" ? "ew-resize" : "ns-resize");
                return;
            }
            case "paint": {
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                const face = faceAt(networkFaces(placedSubpaths(node)), toVectorSpace(s.doc, node, world));
                if (face && !gesture.hits.includes(face.id)) {
                    gesture.hits.push(face.id);
                    editor.set({});
                }
                return;
            }
            case "builder": {
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                for (const i of regionsAt(node, toVectorSpace(s.doc, node, world))) if (!gesture.hits.includes(i)) gesture.hits.push(i);
                return;
            }
            case "cutline": {
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                gesture.end = toVectorSpace(s.doc, node, world);
                if (!gesture.moved && Math.hypot(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y) < DRAG_THRESHOLD) return;
                gesture.moved = true;
                lassoRef.current = [gesture.screenStart, screen];
                editor.set({});
                return;
            }
            case "vmarquee": {
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                if (!gesture.moved && Math.hypot(screen.x - gesture.start.x, screen.y - gesture.start.y) < DRAG_THRESHOLD) return;
                gesture.moved = true;
                let hits: VertexRef[];
                if (gesture.lasso) {
                    gesture.points.push(screen);
                    lassoRef.current = gesture.points;
                    hits = verticesInLasso(s.doc, node, s.camera, gesture.points);
                } else {
                    const rect = normalizeRect(gesture.start.x, gesture.start.y, screen.x, screen.y);
                    const a = screenToWorld(s.camera, rect.x, rect.y);
                    const b = screenToWorld(s.camera, rect.x + rect.w, rect.y + rect.h);
                    marqueeRef.current = normalizeRect(a.x, a.y, b.x, b.y);
                    hits = verticesInRect(s.doc, node, s.camera, rect);
                }
                const merged = [...gesture.baseRefs.filter((r) => r.part === "anchor"), ...hits.filter((h) => !isSelected(gesture.baseRefs, h.sub, h.index))];
                editor.set({ vertices: merged });
                return;
            }
            case "pen": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                if (!gesture.dragging && Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * s.camera.zoom < DRAG_THRESHOLD) return;
                gesture.dragging = true;
                // Dragging while placing a point pulls out symmetric handles for a smooth curve.
                const patch = shapeLastPoint(node, toVectorSpace(gesture.base, node, world));
                editor.preview(applyCommand(gesture.base, { type: "node.update", id: node.id, patch }));
                return;
            }
            case "freehand": {
                // ⇧ draws a straight line from where the stroke started.
                if (event.shiftKey) gesture.samples = [gesture.samples[0] ?? world, world];
                else gesture.samples.push(world);
                const node = makeFreehand(gesture.base, gesture.samples.map((p) => toSpace(gesture.base, gesture.parentId, p)), gesture.parentId, s.camera.zoom, gesture.brush, gesture.nodeId, drawSettings(s.prefs));
                if (node) editor.preview(applyCommand(gesture.base, { type: "node.create", node }));
                return;
            }
            case "create": {
                const snap = snapEdges([world.x], [world.y], gesture.targets, s.camera.zoom);
                const rect = createRect(gesture, { x: world.x + snap.dx, y: world.y + snap.dy }, event.shiftKey, event.altKey);
                const span = Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * s.camera.zoom;
                if (span > DRAG_THRESHOLD) gesture.moved = true;
                if (!gesture.moved) return;
                const created = applyCommand(gesture.base, createCommand(gesture, rect, { x: world.x + snap.dx, y: world.y + snap.dy }, event.shiftKey, event.altKey));
                const box = selectionBounds(created, [gesture.nodeId]);
                guidesRef.current = box ? guidesForBox(box, gesture.targets) : [];
                editor.preview(created);
                editor.set({ selection: [gesture.nodeId] });
                return;
            }
            case "move": {
                let dx = world.x - gesture.start.x;
                let dy = world.y - gesture.start.y;
                if (!gesture.moved && Math.hypot(dx, dy) * s.camera.zoom < DRAG_THRESHOLD) return;
                gesture.moved = true;
                const snapped = snapMove(gesture, dx, dy, event.shiftKey, s.camera.zoom, event.ctrlKey && !event.metaKey);
                guidesRef.current = snapped.guides;
                measuresRef.current = snapped.measures;
                editor.preview(applyCommand(gesture.base, dropCommand(gesture.base, gesture.ids, snapped.dx, snapped.dy, world)));
                return;
            }
            case "resize": {
                const point = snapResizePoint(gesture, world, event.shiftKey, s.camera.zoom, event.ctrlKey && !event.metaKey);
                const next = applyCommand(gesture.base, resizeCommand(gesture, point, event.shiftKey, event.altKey, event.metaKey || event.ctrlKey));
                const box = selectionBounds(next, gesture.ids);
                guidesRef.current = box ? guidesForBox(box, gesture.targets) : [];
                editor.preview(next);
                return;
            }
            case "rotate":
                editor.preview(applyCommand(gesture.base, rotateCommand(gesture, world, event.shiftKey || Boolean(gesture.base.board))));
                setCursor(rotateCursor(Math.atan2(world.y - gesture.center.y, world.x - gesture.center.x)));
                return;
            case "marquee": {
                if (!gesture.dragged && Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * s.camera.zoom < DRAG_THRESHOLD) return;
                gesture.dragged = true;
                const rect = normalizeRect(gesture.start.x, gesture.start.y, world.x, world.y);
                marqueeRef.current = rect;
                const pick = (ids: string[]) =>
                    ids.filter((id) => {
                        const node = s.doc.nodes[id];
                        return node && isEffectivelyVisible(s.doc, node) && !isEffectivelyLocked(s.doc, node) && rectsIntersect(rect, worldBounds(s.doc, node));
                    });
                // A marquee begun inside a frame that grows to take in the whole frame selects layers
                // on the page instead, the frame among them.
                const home = gesture.clickSelect ? s.doc.nodes[gesture.clickSelect] : undefined;
                const homeBox = home ? worldBounds(s.doc, home) : null;
                const takesFrame = homeBox && rect.x <= homeBox.x && rect.y <= homeBox.y && rect.x + rect.w >= homeBox.x + homeBox.w && rect.y + rect.h >= homeBox.y + homeBox.h;
                const hits = pick(takesFrame ? (s.doc.nodes[s.pageId]?.children ?? []) : gesture.scope);
                let next = gesture.toggle ? [...gesture.baseSelection.filter((id) => !hits.includes(id)), ...hits.filter((id) => !gesture.baseSelection.includes(id))] : Array.from(new Set([...gesture.baseSelection, ...hits]));
                // Once a top-level frame is in the selection, only other top-level layers join it.
                const topLevelId = (id: string) => {
                    const n = s.doc.nodes[id];
                    return Boolean(n && isTopLevel(s.doc, n));
                };
                if (next.some((id) => topLevelId(id) && isFrameLike(s.doc.nodes[id] as SceneNode))) next = next.filter(topLevelId);
                editor.set({ selection: next });
                return;
            }
        }
    };

    const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        marqueeRef.current = null;
        guidesRef.current = [];
        measuresRef.current = [];
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (smartDragging()) {
            const s0 = editor.get();
            const p0 = local(event);
            smartPointerUp(screenToWorld(s0.camera, p0.x, p0.y), event.shiftKey);
            return;
        }
        if (pluginUp(pointer(event))) return;
        if (!gesture) return;
        if (gesture.kind === "focusResize") {
            focusResizePlugin.up();
            return;
        }
        const s = editor.get();
        const world = screenToWorld(s.camera, local(event).x, local(event).y);

        switch (gesture.kind) {
            case "pan": {
                setCursor(null);
                const right = rightPanRef.current;
                rightPanRef.current = null;
                if (right && !right.moved) contextMenuAt(right.x, right.y, right.meta);
                return;
            }
            case "zoom": {
                const box = normalizeRect(gesture.start.x, gesture.start.y, world.x, world.y);
                if (gesture.dragged && box.w > 0 && box.h > 0) fitRect(box, 0, 256);
                else editor.set({ camera: zoomAt(s.camera, gesture.screen.x, gesture.screen.y, s.camera.zoom * (gesture.out ? 0.5 : 2)) });
                return;
            }
            case "connect":
                protoPointerUp(world);
                return;
            case "vertex": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node || !gesture.moved) return;
                const snapped = s.prefs.snapToGeometry && !event.ctrlKey && gesture.refs.length === 1 && gesture.refs[0]?.part === "anchor" ? geometrySnap(gesture.base, node, gesture.refs, world, s.camera.zoom) : null;
                const vec = toVectorSpace(gesture.base, node, snapped ?? world);
                // Snapped, the point itself lands on the other point.
                const anchor = snapped && gesture.refs[0] ? placedSubpaths(node)[gesture.refs[0].sub]?.points[gesture.refs[0].index] : undefined;
                const delta = anchor ? { x: vec.x - anchor.x, y: vec.y - anchor.y } : event.shiftKey ? axisLock({ x: vec.x - gesture.start.x, y: vec.y - gesture.start.y }) : { x: vec.x - gesture.start.x, y: vec.y - gesture.start.y };
                const patch = moveVertices(node, gesture.refs, delta, vec, event.altKey ? "none" : s.handleMirror);
                editor.execute({ type: "node.update", id: node.id, patch }, gesture.base);
                return;
            }
            case "bend": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                if (gesture.moved) {
                    editor.execute({ type: "node.update", id: node.id, patch: bendAnchor(node, gesture.ref, toVectorSpace(gesture.base, node, world)) }, gesture.base);
                } else {
                    // A click with the bend tool turns a smooth point sharp, and a sharp one smooth.
                    editor.preview(gesture.base);
                    editor.execute({ type: "node.update", id: node.id, patch: toggleSmooth(node, gesture.ref) });
                }
                return;
            }
            case "bendSegment": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node) return;
                const patch = bendSegment(node, gesture.sub, gesture.index, gesture.t, toVectorSpace(gesture.base, node, world));
                editor.preview(gesture.base);
                if (Object.keys(patch).length) editor.execute({ type: "node.update", id: node.id, patch }, gesture.base);
                return;
            }
            case "guide": {
                setCursor(null);
                const page = gesture.base.nodes[s.pageId];
                if (!page) return;
                const screenAt = local(event);
                const guides = [...(page.rulerGuides ?? [])];
                // Dropped back on a ruler: the guide goes away.
                if (onRuler(screenAt)) guides.splice(gesture.index, 1);
                else guides[gesture.index] = { axis: gesture.axis, at: Math.round(gesture.axis === "x" ? world.x : world.y) };
                editor.execute({ type: "node.update", id: page.id, patch: { rulerGuides: guides } }, gesture.base);
                return;
            }
            case "builder": {
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                const { patch, extracted } = builderApply(node, gesture.hits, gesture.remove);
                if (patch === null) {
                    editor.execute({ type: "node.delete", ids: [node.id] });
                    leaveVectorEdit();
                    editor.set({ selection: [] });
                } else if (extracted) {
                    const index = (s.doc.nodes[node.parentId ?? ""]?.children ?? s.doc.roots).indexOf(node.id) + 1;
                    editor.execute({ type: "batch", commands: [{ type: "node.update", id: node.id, patch }, { type: "node.create", node: vectorFrom({ ...node, ...patch }, extracted, nanoid(10)), index }] });
                } else if (Object.keys(patch).length) editor.execute({ type: "node.update", id: node.id, patch });
                editor.set({ vertices: [] });
                return;
            }
            case "paint": {
                paintPreview.painted = null;
                const node = s.doc.nodes[gesture.nodeId];
                if (!node || !gesture.hits.length) return;
                // The regions take the layer's fill (the paint colour when it has none yet).
                const regionFills = paintFaces(node, placedSubpaths(node), gesture.hits, gesture.remove);
                const fills = node.fills.length || gesture.remove ? node.fills : [paintToolFill(s.prefs.drawColor)];
                editor.execute({ type: "node.update", id: node.id, patch: { regionFills, fills } });
                editor.set({ vertices: [] });
                return;
            }
            case "cutline": {
                lassoRef.current = null;
                const node = s.doc.nodes[gesture.nodeId];
                if (!node) return;
                if (!gesture.moved) {
                    if (!gesture.seg) return;
                    const patch = cutAt(node, gesture.seg);
                    if (patch) editor.execute({ type: "node.update", id: node.id, patch });
                    editor.set({ vertices: [] });
                    return;
                }
                const cut = cutAcross(node, gesture.start, gesture.end);
                if (!cut) {
                    editor.set({});
                    return;
                }
                const index = (s.doc.nodes[node.parentId ?? ""]?.children ?? s.doc.roots).indexOf(node.id) + 1;
                editor.execute({ type: "batch", commands: [{ type: "node.update", id: node.id, patch: cut.keep }, { type: "node.create", node: vectorFrom({ ...node, ...cut.keep }, cut.cutOff, nanoid(10)), index }] });
                editor.set({ vertices: [] });
                return;
            }
            case "vmarquee": {
                lassoRef.current = null;
                if (gesture.moved) {
                    editor.set({});
                    return;
                }
                const node = s.doc.nodes[gesture.nodeId];
                const inside = node && (nodeContains(s.doc, node, world.x, world.y) || hitSegment(s.doc, node, s.camera, local(event).x, local(event).y));
                if (inside) editor.set({ vertices: [] });
                else leaveVectorEdit();
                return;
            }
            case "pen": {
                const node = gesture.base.nodes[gesture.nodeId];
                if (!node || !gesture.dragging) return;
                const patch = shapeLastPoint(node, toVectorSpace(gesture.base, node, world));
                editor.execute({ type: "node.update", id: node.id, patch }, gesture.base);
                editor.mergeLast();
                return;
            }
            case "freehand": {
                const node = makeFreehand(gesture.base, gesture.samples.map((p) => toSpace(gesture.base, gesture.parentId, p)), gesture.parentId, s.camera.zoom, gesture.brush, gesture.nodeId, drawSettings(s.prefs));
                if (node) {
                    editor.execute({ type: "node.create", node }, gesture.base);
                    editor.set({ selection: [node.id] });
                } else editor.preview(gesture.base);
                return;
            }
            case "create": {
                const snap = snapEdges([world.x], [world.y], gesture.targets, s.camera.zoom);
                let rect = createRect(gesture, { x: world.x + snap.dx, y: world.y + snap.dy }, event.shiftKey, event.altKey && gesture.moved);
                if (gesture.type === "text") {
                    // Click: auto-width text at the pointer. Drag: a fixed-width box that wraps and grows downwards.
                    const at = toSpace(gesture.base, gesture.parentId, gesture.start);
                    const box = gesture.moved ? { x: rect.x, y: rect.y, w: Math.max(8, rect.w), h: 20 } : { x: at.x, y: at.y - 10, w: 1, h: 20 };
                    const node = makeNode(gesture.base, "text", box, gesture.parentId, {
                        ...defaultPropsFor("text"),
                        id: gesture.nodeId,
                        text: "",
                        sizing: gesture.moved ? { h: "fixed", v: "hug" } : { h: "hug", v: "hug" },
                    });
                    editor.execute({ type: "node.create", node }, gesture.base);
                    editor.set({ selection: [node.id], editingTextId: node.id, tool: "move" });
                    return;
                }
                let end = { x: world.x + snap.dx, y: world.y + snap.dy };
                if (!gesture.moved) {
                    // A click places a 100 × 100 shape with its top-left at the pointer; the Frame
                    // tool reuses the size of the last top-level frame made this session.
                    const at = toSpace(gesture.base, gesture.parentId, gesture.start);
                    const size = isTopFrameGesture(gesture) ? lastFrameSize() : { w: 100, h: 100 };
                    rect = { x: at.x, y: at.y, w: size.w, h: size.h };
                    // A click with a line tool draws a 100 px line to the right.
                    end = { x: gesture.start.x + 100, y: gesture.start.y };
                }
                editor.execute(createCommand(gesture, rect, end, event.shiftKey, event.altKey && gesture.moved), gesture.base);
                if (gesture.variant === "section") adoptIntoSection(gesture.nodeId, gesture.parentId);
                if (isTopFrameGesture(gesture) && gesture.moved) rememberFrameSize(rect.w, rect.h);
                // "Keep tool selected after use" leaves the shape tool active for the next shape.
                editor.set({ selection: [gesture.nodeId], ...(s.prefs.keepTool ? {} : { tool: "move" as const }) });
                return;
            }
            case "move": {
                if (!gesture.moved) {
                    editor.preview(gesture.base);
                    if (!event.shiftKey) {
                        const deep = event.metaKey || event.ctrlKey;
                        const raw = hitTest(gesture.base, world.x, world.y, deep);
                        if (raw) editor.set({ selection: [promoteToGroup(gesture.base, raw, s.selection, deep).id] });
                    }
                    return;
                }
                const snapped = snapMove(gesture, world.x - gesture.start.x, world.y - gesture.start.y, event.shiftKey, s.camera.zoom, event.ctrlKey && !event.metaKey);
                if (s.mode === "motion" && s.autoKey) {
                    // Auto keyframe: the drag records where the layers are at the playhead.
                    const commands: Command[] = [];
                    for (const id of gesture.ids) {
                        const node = gesture.base.nodes[id];
                        if (!node) continue;
                        const d = applyVector(spaceMatrix(gesture.base, node.parentId).inverse(), snapped.dx, snapped.dy);
                        let next = node;
                        const kx = setKeyframe(next, "x", s.time, (valueAt(node, "x", s.time) as number) + d.x);
                        if (kx.type === "node.update") next = { ...next, ...kx.patch };
                        const ky = setKeyframe(next, "y", s.time, (valueAt(node, "y", s.time) as number) + d.y);
                        if (ky.type === "node.update") next = { ...next, ...ky.patch };
                        commands.push({ type: "node.update", id, patch: { animation: next.animation } });
                    }
                    editor.execute({ type: "batch", commands }, gesture.base);
                    return;
                }
                editor.execute(dropCommand(gesture.base, gesture.ids, snapped.dx, snapped.dy, world), gesture.base);
                // Moving a fresh duplicate sets the distance ⌘D repeats.
                if (isLastDuplicate(gesture.ids)) recordDuplicateMove(gesture.ids, snapped.dx, snapped.dy);
                return;
            }
            case "resize":
                if (s.doc !== gesture.base)
                    editor.execute(resizeCommand(gesture, snapResizePoint(gesture, world, event.shiftKey, s.camera.zoom, event.ctrlKey && !event.metaKey), event.shiftKey, event.altKey, event.metaKey || event.ctrlKey), gesture.base);
                return;
            case "rotate":
                if (s.doc !== gesture.base) {
                    editor.execute(rotateCommand(gesture, world, event.shiftKey || Boolean(gesture.base.board)), gesture.base);
                    // Turning a fresh duplicate sets the turn ⌘D repeats.
                    const first = gesture.ids[0] ?? "";
                    const before = gesture.base.nodes[first];
                    const after = editor.get().doc.nodes[first];
                    if (before && after && isLastDuplicate(gesture.ids)) recordDuplicateMove(gesture.ids, 0, 0, normalizeAngle(after.rotation - before.rotation));
                }
                setCursor(null);
                return;
            case "marquee":
                // A click (no drag) on a top-level frame's body selects the frame itself.
                if (gesture.clickSelect && !gesture.dragged) editor.set({ selection: [gesture.clickSelect], hoverId: null });
                else editor.set({ hoverId: null });
                return;
        }
    };

    const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const s = editor.get();
        if (s.presentingId) return;
        const p = local(event);
        const world = screenToWorld(s.camera, p.x, p.y);
        if (s.tool === "pen" || s.readOnly) return;
        if (pluginDoubleClick(pointer(event))) return;
        // In point editing, double-clicking a point switches it between sharp and smooth.
        if (s.editingVectorId) {
            const node = s.doc.nodes[s.editingVectorId];
            const ref = node ? hitVertex(s.doc, node, s.camera, s.vertices, p.x, p.y) : null;
            if (node && ref?.part === "anchor") editor.execute({ type: "node.update", id: node.id, patch: toggleSmooth(node, ref) });
            return;
        }
        // Double-clicking a frame or section label edits the name right there on the canvas.
        const label = hitFrameLabel(s.doc, s.camera, p.x, p.y);
        if (label) {
            editor.set({ selection: [label.id] });
            ui.set({ labelRename: label.id });
            return;
        }
        const selectedNode = s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined;
        // Images open in the photo editor rather than turning into a vector.
        if (selectedNode && firstImagePaint(selectedNode) >= 0 && nodeContains(s.doc, selectedNode, world.x, world.y)) {
            openPhotoEditor(selectedNode.id);
            return;
        }
        if (
            selectedNode &&
            (selectedNode.type === "vector" || selectedNode.type === "rect" || selectedNode.type === "ellipse") &&
            !selectedNode.sourceId &&
            nodeContains(s.doc, selectedNode, world.x, world.y)
        ) {
            enterVectorEdit(selectedNode.id);
            return;
        }
        const leaf = hitTest(s.doc, world.x, world.y, true);
        if (!leaf) return;
        // Step one level into the selected group (or frame) towards the layer under the pointer.
        let target = leaf;
        const chain: string[] = [];
        let cursor: string | null = leaf.id;
        while (cursor) {
            chain.unshift(cursor);
            cursor = s.doc.nodes[cursor]?.parentId ?? null;
        }
        const current = s.selection.length === 1 ? s.selection[0] : undefined;
        const at = current ? chain.indexOf(current) : -1;
        if (at >= 0 && at < chain.length - 1) {
            const next = s.doc.nodes[chain[at + 1] ?? ""];
            if (next) target = next;
        } else {
            target = promoteToGroup(s.doc, leaf, s.selection, false);
        }
        if (target.type === "text") {
            editTextAt(world);
            editor.set({ selection: [target.id], editingTextId: target.id });
        }
        else editor.set({ selection: [target.id] });
    };

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            data-region="canvas"
            className="relative h-full w-full touch-none overflow-hidden outline-none select-none"
            style={{ cursor: presenting ? "default" : (cursor ?? toolCursor(tool)) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
                setCollabCursor(null);
                if (!gestureRef.current && editor.get().hoverId) editor.set({ hoverId: null });
            }}
            onDoubleClick={onDoubleClick}
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("application/x-nagma-asset")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                }
            }}
            onDrop={(event) => {
                const s = editor.get();
                const p = local(event);
                const world = screenToWorld(s.camera, p.x, p.y);
                // A component dragged from the Assets panel lands as an instance under the pointer.
                const asset = event.dataTransfer.getData("application/x-nagma-asset");
                if (asset) {
                    event.preventDefault();
                    // ⌥drop onto an instance swaps it for the dragged component.
                    const under = event.altKey ? hitTest(s.doc, world.x, world.y, false) : null;
                    let target: SceneNode | null = under;
                    while (target && target.type !== "instance") target = target.parentId ? (s.doc.nodes[target.parentId] ?? null) : null;
                    // Library components are copied into the file first.
                    const { sourceId, assetId } = decodeAssetDrag(asset);
                    if (target) void swapTo(target.id, { sourceId, assetId });
                    else void placeAsset(sourceId, assetId, world);
                    return;
                }
                const files = Array.from(event.dataTransfer.files);
                if (!files.length) return;
                event.preventDefault();
                void placeImages(files, world);
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                // While right-dragging pans, the menu waits for the button to come up without a drag.
                if (rightPanRef.current) return;
                // Preferences › Ctrl+click opens right click menus, when off: ⌃-click stays a click.
                if (!editor.get().prefs.ctrlClickMenus && event.ctrlKey && event.button === 0) return;
                contextMenuAt(event.clientX, event.clientY, event.metaKey || event.ctrlKey);
            }}
        >
            {/* A Display P3 file draws on a P3 canvas (a canvas's colour space is fixed once it is made). */}
            <canvas
                key={colorProfile}
                ref={canvasRef}
                width={Math.round(size.width * (window.devicePixelRatio || 1))}
                height={Math.round(size.height * (window.devicePixelRatio || 1))}
                style={{ width: size.width, height: size.height }}
                className="block"
            />
            {editingTextId && <TextEditor nodeId={editingTextId} />}
            <CanvasOverlays />
            <ModeBanner />
        </div>
    );
}

// The top-level frame under a point (the Frame tool's quick-add target), or null on bare canvas.
function topFrameUnder(doc: NagmaDocument, world: Point): string | null {
    let id: string | null = frameAt(doc, world.x, world.y);
    let node = id ? doc.nodes[id] : undefined;
    if (!node || node.type === "page") return null;
    while (node && !isTopLevel(doc, node) && !doc.nodes[node.parentId ?? ""]?.isSection) {
        id = node.parentId;
        node = id ? doc.nodes[id] : undefined;
    }
    return node && isFrameLike(node) && !node.isSection ? node.id : null;
}

// The ⌘ marquee's candidates: the deepest layers on the page (layers without children), at any depth.
function deepMarqueeScope(doc: NagmaDocument, pageId: string): string[] {
    return descendants(doc, pageId).filter((id) => {
        const node = doc.nodes[id];
        return node && !node.children.length && node.type !== "page";
    });
}

// Layers a new shape can snap to while it is drawn: the contents of the frame it goes into, and the frame.
function createTargets(doc: NagmaDocument, parentId: string | null): Rect[] {
    const ids = parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots;
    const rects = ids.flatMap((id) => {
        const node = doc.nodes[id];
        return node && node.visible ? [worldBounds(doc, node)] : [];
    });
    const parent = parentId && doc.nodes[parentId]?.type !== "page" ? selectionBounds(doc, [parentId]) : null;
    return parent ? [...rects, parent] : rects;
}

// The drag offset after shift-locking an axis and snapping the moved box to nearby edges and centres.
function snapMove(gesture: Extract<Gesture, { kind: "move" }>, rawDx: number, rawDy: number, lockAxis: boolean, zoom: number, noSnap = false) {
    let dx = rawDx;
    let dy = rawDy;
    let axes = { x: true, y: true };
    if (lockAxis) {
        if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0;
            axes = { x: true, y: false };
        } else {
            dx = 0;
            axes = { x: false, y: true };
        }
    }
    // "Snap to pixel grid" rounds unsnapped moves to whole pixels; frames and sections always do.
    const grid = gesture.ids.every((id) => isFrameLike(gesture.base.nodes[id])) ? Math.round : snapPx;
    if (!gesture.box) return { dx: grid(dx), dy: grid(dy), guides: [] as Guide[], measures: [] as Measure[] };
    const moved = { ...gesture.box, x: gesture.box.x + dx, y: gesture.box.y + dy };
    // Holding Control drags freely, without snapping to other layers.
    if (noSnap) {
        const fx = grid(moved.x) - gesture.box.x;
        const fy = grid(moved.y) - gesture.box.y;
        return { dx: fx, dy: fy, guides: [] as Guide[], measures: parentMeasures(gesture, { ...gesture.box, x: gesture.box.x + fx, y: gesture.box.y + fy }) };
    }
    const snap = snapRect(moved, gesture.targets, zoom, axes);
    // Edges and centres first; otherwise equal spacing between the neighbours on both sides.
    const equal = snapEqualSpacing(moved, gesture.targets, zoom, { x: axes.x && snap.dx === 0, y: axes.y && snap.dy === 0 });
    const sx = snap.dx !== 0 ? snap.dx : equal.dx;
    const sy = snap.dy !== 0 ? snap.dy : equal.dy;
    // Snapped results stay exact; unsnapped ones land on the pixel grid when it is on.
    const fx = sx !== 0 ? dx + sx : grid(moved.x) - gesture.box.x;
    const fy = sy !== 0 ? dy + sy : grid(moved.y) - gesture.box.y;
    const final = { ...gesture.box, x: gesture.box.x + fx, y: gesture.box.y + fy };
    // Distance labels: to the neighbours while something snapped, else to the edges of the parent frame.
    const measures = sx !== 0 || sy !== 0 ? dragMeasures(final, gesture.targets) : parentMeasures(gesture, final);
    return { dx: fx, dy: fy, guides: snap.guides, measures };
}

// While dragging inside a frame: how far the layer is from the frame's edges.
function parentMeasures(gesture: Extract<Gesture, { kind: "move" }>, box: Rect): Measure[] {
    const parentId = gesture.base.nodes[gesture.ids[0] ?? ""]?.parentId;
    const parent = parentId ? gesture.base.nodes[parentId] : undefined;
    if (!parent || parent.type === "page") return [];
    const frame = selectionBounds(gesture.base, [parent.id]);
    return frame ? measureBetween(box, frame) : [];
}

// Nudges the pointer so the edges being dragged snap to nearby edges and centres.
function snapResizePoint(gesture: Extract<Gesture, { kind: "resize" }>, world: Point, keepRatio: boolean, zoom: number, noSnap = false): Point {
    const single = gesture.ids.length === 1 ? gesture.base.nodes[gesture.ids[0] ?? ""] : undefined;
    if (noSnap || keepRatio || (single && !isAxisAligned(gesture.base, single))) return world;
    const b = gesture.bounds;
    const dx = world.x - gesture.start.x;
    const dy = world.y - gesture.start.y;
    const xs: number[] = [];
    const ys: number[] = [];
    if (gesture.handle.includes("w")) xs.push(b.x + dx);
    if (gesture.handle.includes("e")) xs.push(b.x + b.w + dx);
    if (gesture.handle.includes("n")) ys.push(b.y + dy);
    if (gesture.handle.includes("s")) ys.push(b.y + b.h + dy);
    const snap = snapEdges(xs, ys, gesture.targets, zoom);
    return { x: world.x + snap.dx, y: world.y + snap.dy };
}

// Distances shown while holding ⌥: from the selection to the hovered layer, or to its parent frame.
function altMeasures(doc: NagmaDocument, selection: string[], hoverId: string | null): Measure[] {
    // Inspect shows distances to the hovered layer without a modifier.
    if ((!keys.alt && editor.get().mode !== "dev") || selection.length === 0) return [];
    if (!keys.alt && (!hoverId || selection.includes(hoverId))) return [];
    const sel = selectionBounds(doc, selection);
    if (!sel) return [];
    let otherId = hoverId && !selection.includes(hoverId) ? hoverId : null;
    const parentId = doc.nodes[selection[0] ?? ""]?.parentId ?? null;
    otherId ??= parentId && doc.nodes[parentId]?.type !== "page" ? parentId : null;
    const other = otherId ? selectionBounds(doc, [otherId]) : null;
    return other ? measureBetween(sel, other) : [];
}

function toolCursor(tool: Tool): string {
    if (keys.z) return keys.alt ? "zoom-out" : "zoom-in";
    if (tool === "hand" || keys.space) return "grab";
    if (tool === "pen" || tool === "pencil" || tool === "brush" || isShapeTool(tool)) return "crosshair";
    if (tool === "comment") return "cell";
    if (tool === "text") return "text";
    if (tool !== "move") return "crosshair";
    return "default";
}

// A plain frame drawn on the canvas (or in a section): the one whose size the session remembers.
function isTopFrameGesture(gesture: Extract<Gesture, { kind: "create" }>): boolean {
    const parent = gesture.parentId ? gesture.base.nodes[gesture.parentId] : undefined;
    return gesture.type === "frame" && !gesture.variant && (!parent || parent.type === "page" || Boolean(parent.isSection));
}

// ⌥ draws from the center: the press is the middle and the box grows both ways.
function createRect(gesture: Extract<Gesture, { kind: "create" }>, world: Point, square: boolean, fromCenter = false): Rect {
    const a = toSpace(gesture.base, gesture.parentId, gesture.start);
    let b = toSpace(gesture.base, gesture.parentId, world);
    if (square) {
        const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        b = { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
    }
    if (fromCenter) return normalizeRect(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
    return normalizeRect(a.x, a.y, b.x, b.y);
}

function createCommand(gesture: Extract<Gesture, { kind: "create" }>, rect: Rect, end: Point, constrain: boolean, fromCenter = false): Command {
    if (gesture.shape) {
        let a = toSpace(gesture.base, gesture.parentId, gesture.start);
        let b = toSpace(gesture.base, gesture.parentId, end);
        if (gesture.shape === "line" || gesture.shape === "arrow") {
            // Shift snaps a line to 45° steps.
            if (constrain) {
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
                b = { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
            }
            // ⌥: the press is the line's midpoint.
            if (fromCenter) a = { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
            return { type: "node.create", node: makeShape(gesture.base, gesture.shape, a, b, gesture.parentId, gesture.nodeId) };
        }
        return { type: "node.create", node: makeShape(gesture.base, gesture.shape, { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, gesture.parentId, gesture.nodeId) };
    }
    const extra =
        gesture.variant === "section"
            ? { name: "Section", isSection: true, clip: false, fills: [solid("#FFFFFF", 0.04)] }
            : gesture.variant === "slice"
              ? { name: "Slice", isSlice: true, clip: false, fills: [] }
              : {};
    const node = makeNode(gesture.base, gesture.type, rect, gesture.parentId, { ...(gesture.variant ? {} : defaultPropsFor(gesture.type)), id: gesture.nodeId, ...extra });
    // A new layer goes on top of its parent's layers, whatever is selected.
    return { type: "node.create", node };
}

// Moves layers by a world-space offset, converted into each layer's own parent space.
function moveCommand(doc: NagmaDocument, ids: string[], dx: number, dy: number): Command {
    return {
        type: "batch",
        commands: ids.flatMap((id): Command[] => {
            const node = doc.nodes[id];
            if (!node) return [];
            const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), dx, dy);
            return [{ type: "node.move", ids: [id], dx: d.x, dy: d.y }];
        }),
    };
}

// One undo step for a drag: the move, plus moving layers into whichever frame they were dropped on.
// Inside an auto-layout frame a drag reorders the stack instead of moving freely.
function dropCommand(base: NagmaDocument, ids: string[], dx: number, dy: number, pointer: Point): Command {
    const commands: Command[] = [];
    const free: string[] = [];
    for (const id of ids) {
        const node = base.nodes[id];
        const parent = node?.parentId ? base.nodes[node.parentId] : undefined;
        if (node && parent?.layout && containsPoint(base, parent, pointer.x, pointer.y)) {
            const at = toSpace(base, parent.id, pointer);
            commands.push({ type: "node.reparent", id, parentId: parent.id, index: layoutIndexAt(base, parent.id, id, at.x, at.y) });
        } else {
            free.push(id);
        }
    }
    if (free.length === 0) return { type: "batch", commands };

    const move = moveCommand(base, free, dx, dy);
    const moved = applyWithoutLayout(base, move);
    commands.push(move);
    for (const id of free) {
        const node = moved.nodes[id];
        if (!node) continue;
        const pts = corners(moved, node);
        const center = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
        const exclude = new Set([id, ...descendants(moved, id)]);
        // Frames on the canvas (or in a section) only move between the canvas and sections, the
        // way sections collect frames; everything else joins the frame under its centre.
        const onCanvas = isFrameLike(node) && (isTopLevel(moved, node) || Boolean(moved.nodes[node.parentId ?? ""]?.isSection));
        // Holding Space while dropping keeps the layer in its current parent.
        let target = keys.space ? (node.parentId ?? activePage.id) : onCanvas ? sectionAt(moved, center.x, center.y, exclude) : frameAt(moved, center.x, center.y, exclude);
        // A layer larger than the frame under it stays where it is instead of being swallowed.
        const box = worldBounds(moved, node);
        const under = target ? moved.nodes[target] : undefined;
        if (under && under.type !== "page" && target !== node.parentId) {
            const ub = worldBounds(moved, under);
            if (box.w > ub.w || box.h > ub.h) target = node.parentId ?? activePage.id;
        }
        // A component can't end up inside itself (an instance of it, or a frame holding one, dropped into it).
        if (moveWouldNestItself(moved, id, target)) target = node.parentId ?? target;
        const targetNode = target ? moved.nodes[target] : undefined;
        if (targetNode?.layout) {
            // Dropped into a stack: slot it in by position.
            const at = toSpace(moved, target, pointer);
            commands.push({ type: "node.reparent", id, parentId: target, index: layoutIndexAt(moved, targetNode.id, id, at.x, at.y) });
            continue;
        }
        if (target === node.parentId) continue;
        // Keep the layer where it is on screen while it changes coordinate space.
        const at = toSpace(moved, target, center);
        const worldAngle = angleOf(worldMatrix(moved, node));
        const parentAngle = angleOf(spaceMatrix(moved, target));
        commands.push(
            { type: "node.reparent", id, parentId: target },
            {
                type: "node.update",
                id,
                patch: { x: snapPx(at.x - node.w / 2), y: snapPx(at.y - node.h / 2), rotation: normalizeAngle(worldAngle - parentAngle) },
            },
        );
    }
    return { type: "batch", commands };
}

function angleOf(m: DOMMatrix): number {
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

// A new section collects the layers it was drawn around: siblings that sit wholly inside it.
function adoptIntoSection(sectionId: string, parentId: string | null) {
    const doc = editor.get().doc;
    const section = doc.nodes[sectionId];
    if (!section) return;
    const box = worldBounds(doc, section);
    const siblings = parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots;
    const inside = siblings.filter((id) => {
        const node = doc.nodes[id];
        if (!node || id === sectionId) return false;
        const b = worldBounds(doc, node);
        return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
    });
    if (!inside.length) return;
    editor.execute({ type: "batch", commands: inside.flatMap((id) => rehome(doc, id, sectionId)) });
    editor.mergeLast();
}

// Tools that only look, so they stay usable in Inspect and view-only files.
const LOOK_TOOLS = new Set<Tool>(["move", "hand", "comment", "annotation", "measure", "eyedropper"]);

function drawSettings(prefs: Prefs): DrawSettings {
    return { color: prefs.drawColor, size: prefs.drawSize, style: prefs.drawStyle };
}

// ⌘ (ignoreConstraints) leaves a resized frame's children where they are.
function resizeCommand(gesture: Extract<Gesture, { kind: "resize" }>, world: Point, keepRatio: boolean, fromCenter = false, ignoreConstraints = false): Command {
    if (gesture.scale) return scaleCommand(gesture, world, fromCenter);
    const single = gesture.ids.length === 1 ? gesture.base.nodes[gesture.ids[0] ?? ""] : undefined;
    if (single && single.type !== "group" && single.type !== "boolean") {
        // Work in the layer's own unrotated space, then put the new box back where it belongs.
        const m = worldMatrix(gesture.base, single);
        const inv = m.inverse();
        const p0 = apply(inv, gesture.start.x, gesture.start.y);
        const p1 = apply(inv, world.x, world.y);
        const flip = editor.get().prefs.flipWhileResizing;
        // A layer with its aspect ratio locked always resizes in proportion.
        const raw = resizeRect({ x: single.x, y: single.y, w: single.w, h: single.h }, gesture.handle, p1.x - p0.x, p1.y - p0.y, keepRatio || Boolean(single.lockAspect), fromCenter, flip);
        // "Flip objects while resizing": dragging past the opposite edge mirrors the layer.
        const flipX = flip && raw.w < 0;
        const flipY = flip && raw.h < 0;
        const r = { x: Math.min(raw.x, raw.x + raw.w), y: Math.min(raw.y, raw.y + raw.h), w: Math.abs(raw.w), h: Math.abs(raw.h) };
        const centerWorld = apply(m, r.x + r.w / 2, r.y + r.h / 2);
        const c = toSpace(gesture.base, single.parentId, centerWorld);
        return {
            type: "node.update",
            id: single.id,
            ...(ignoreConstraints ? { ignoreConstraints } : {}),
            patch: {
                x: snapPx(c.x - r.w / 2),
                y: snapPx(c.y - r.h / 2),
                w: Math.max(1, snapPx(r.w)),
                h: Math.max(1, snapPx(r.h)),
                sizing: fixedOn(single, gesture.handle),
                ...(flipX ? { flipX: !single.flipX } : {}),
                ...(flipY ? { flipY: !single.flipY } : {}),
            },
        };
    }

    const b = gesture.bounds;
    const next = resizeRect(b, gesture.handle, world.x - gesture.start.x, world.y - gesture.start.y, keepRatio, fromCenter);
    const scaleX = b.w > 0 ? next.w / b.w : 1;
    const scaleY = b.h > 0 ? next.h / b.h : 1;
    // Groups resize by scaling what's inside them.
    const commands: Command[] = expandGroups(gesture.base, gesture.ids).flatMap((id): Command[] => {
        const node = gesture.base.nodes[id];
        if (!node) return [];
        const box = worldBounds(gesture.base, node);
        const centerWorld = { x: next.x + (box.x + box.w / 2 - b.x) * scaleX, y: next.y + (box.y + box.h / 2 - b.y) * scaleY };
        const w = Math.max(1, snapPx(node.w * scaleX));
        const h = Math.max(1, snapPx(node.h * scaleY));
        const c = toSpace(gesture.base, node.parentId, centerWorld);
        return [{ type: "node.update", id, patch: { x: snapPx(c.x - w / 2), y: snapPx(c.y - h / 2), w, h, sizing: fixedOn(node, gesture.handle) } }];
    });
    return { type: "batch", commands };
}

// The Scale tool (K): everything in the selection, children included, scales by one factor,
// along with text sizes, stroke weights, corner radii and auto layout spacing.
function scaleCommand(gesture: Extract<Gesture, { kind: "resize" }>, world: Point, fromCenter: boolean): Command {
    const b = gesture.bounds;
    const next = resizeRect(b, gesture.handle, world.x - gesture.start.x, world.y - gesture.start.y, true, fromCenter);
    const k = b.w > 0 ? Math.max(0.01, next.w / b.w) : 1;
    const ids = Array.from(new Set(gesture.ids.flatMap((id) => [id, ...descendants(gesture.base, id)])));
    const commands: Command[] = ids.flatMap((id): Command[] => {
        const node = gesture.base.nodes[id];
        if (!node) return [];
        const box = worldBounds(gesture.base, node);
        const centerWorld = { x: next.x + (box.x + box.w / 2 - b.x) * k, y: next.y + (box.y + box.h / 2 - b.y) * k };
        const w = Math.max(1, node.w * k);
        const h = Math.max(1, node.h * k);
        const c = toSpace(gesture.base, node.parentId, centerWorld);
        const patch: Partial<SceneNode> = { x: c.x - w / 2, y: c.y - h / 2, w, h, strokeWidth: node.strokeWidth * k, radius: node.radius * k };
        if (node.radii) patch.radii = node.radii.map((r) => r * k) as SceneNode["radii"];
        if (node.type === "text") {
            patch.fontSize = (node.fontSize ?? 16) * k;
            patch.sizing = { h: "fixed", v: "fixed" };
            // Rich text ranges with their own size scale too.
            if (node.spans?.some((s) => s.fontSize)) patch.spans = node.spans.map((s) => (s.fontSize ? { ...s, fontSize: s.fontSize * k } : s));
        }
        if (node.layout) patch.layout = { ...node.layout, gap: node.layout.gap * k, padding: node.layout.padding.map((p) => p * k) as typeof node.layout.padding };
        if (node.shadow) patch.shadow = { ...node.shadow, x: node.shadow.x * k, y: node.shadow.y * k, blur: node.shadow.blur * k };
        return [{ type: "node.update", id, patch }];
    });
    return { type: "batch", commands };
}

// Dragging a side makes that axis a fixed size (no longer hugging or filling).
function fixedOn(node: SceneNode, handle: Handle): SceneNode["sizing"] {
    return {
        h: handle.includes("e") || handle.includes("w") ? "fixed" : node.sizing.h,
        v: handle.includes("n") || handle.includes("s") ? "fixed" : node.sizing.v,
    };
}

function resizeRect(b: Rect, handle: Handle, dx: number, dy: number, keepRatio: boolean, fromCenter = false, allowFlip = false): Rect {
    let left = b.x;
    let top = b.y;
    let right = b.x + b.w;
    let bottom = b.y + b.h;
    if (handle.includes("w")) left += dx;
    if (handle.includes("e")) right += dx;
    if (handle.includes("n")) top += dy;
    if (handle.includes("s")) bottom += dy;
    // ⌥: the opposite edge moves the other way, so the centre stays put.
    if (fromCenter) {
        if (handle.includes("w")) right -= dx;
        if (handle.includes("e")) left -= dx;
        if (handle.includes("n")) bottom -= dy;
        if (handle.includes("s")) top -= dy;
    }

    if (keepRatio && b.w > 0 && b.h > 0) {
        const ratio = b.w / b.h;
        const width = Math.abs(right - left);
        const height = Math.abs(bottom - top);
        if (handle === "n" || handle === "s" || (handle.length === 2 && height * ratio > width)) {
            const w = height * ratio;
            if (handle === "n" || handle === "s") {
                const cx = b.x + b.w / 2;
                left = cx - w / 2;
                right = cx + w / 2;
            } else if (handle.includes("w")) left = right - w;
            else right = left + w;
        } else {
            const h = width / ratio;
            if (handle === "e" || handle === "w") {
                const cy = b.y + b.h / 2;
                top = cy - h / 2;
                bottom = cy + h / 2;
            } else if (handle.includes("n")) top = bottom - h;
            else bottom = top + h;
        }
    }
    // With flipping allowed, a crossed-over box keeps its sign so the caller can mirror the layer.
    if (allowFlip) return { x: left, y: top, w: right - left, h: bottom - top };
    return normalizeRect(left, top, right, bottom);
}

// On a board, objects turn in 15° steps, and stickies, tables, code blocks, link cards and
// connectors don't turn at all (their rotate handles do nothing).
function withoutBoardRotate(doc: NagmaDocument, selection: string[], hit: ReturnType<typeof hitSelection>): ReturnType<typeof hitSelection> {
    if (hit?.kind !== "rotate" || !doc.board) return hit;
    const fixed = selection.some((id) => ["sticky", "table", "code", "link", "connector"].includes(doc.nodes[id]?.jam?.kind ?? ""));
    return fixed ? null : hit;
}

function rotateCommand(gesture: Extract<Gesture, { kind: "rotate" }>, world: Point, snap: boolean): Command {
    const angle = Math.atan2(world.y - gesture.center.y, world.x - gesture.center.x);
    let delta = ((angle - gesture.startAngle) * 180) / Math.PI;
    const single = gesture.ids.length === 1 ? gesture.base.nodes[gesture.ids[0] ?? ""] : undefined;
    const ids = expandGroups(gesture.base, gesture.ids);
    if (snap) {
        // Shift snaps the result (one layer) or the turn (several) to 15° steps.
        if (single) delta = Math.round((single.rotation + delta) / 15) * 15 - single.rotation;
        else delta = Math.round(delta / 15) * 15;
    }
    const rad = (delta * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const commands: Command[] = ids.flatMap((id): Command[] => {
        const node = gesture.base.nodes[id];
        if (!node) return [];
        const pts = corners(gesture.base, node);
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4 - gesture.center.x;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4 - gesture.center.y;
        const centerWorld = { x: gesture.center.x + cx * cos - cy * sin, y: gesture.center.y + cx * sin + cy * cos };
        const c = toSpace(gesture.base, node.parentId, centerWorld);
        return [
            {
                type: "node.update",
                id,
                patch: { x: c.x - node.w / 2, y: c.y - node.h / 2, rotation: normalizeAngle(Math.round((node.rotation + delta) * 100) / 100) },
            },
        ];
    });
    return { type: "batch", commands };
}

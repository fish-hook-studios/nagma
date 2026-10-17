import { worldToScreen } from "../engine/camera";
import { isFrameLike } from "../engine/components";
import { DEFAULT_TRANSITION, navigateAction, actionAt, actionsOf, destinations, normalizeInteraction, screenOf, updateActionAt, walkActions } from "../engine/prototype";
import { flowLabel, inAnyFlow, nextFlowName } from "../engine/prototype-flows";
import { canvasRect } from "../components/canvas-rect";
import { type ConnectionRef, closeInteraction, openInteraction, protoUi, sameRef } from "../engine/prototype-ui";
import { selectionBounds } from "../engine/nodes";
import { layerRoots } from "../engine/page";
import { editor } from "../engine/store";
import { fontString } from "../engine/text";
import { containsPoint } from "../engine/transform";
import type { Camera, Command, NagmaDocument, PrototypeAction, Rect, SceneNode } from "../engine/types";
import { hitTest } from "./hit-test";

// Prototype connections ("noodles") on the canvas: drawn from each interactive layer to where its
// actions lead, selectable (Delete removes one), with a draggable arrow end to retarget, a hover
// highlight, the blue handle for drawing new ones, and flow starting point labels you can drag.

const PROTO = "#0D99FF";
// The flow tag of a frame that isn't selected: a light blue with dark text.
const PROTO_LIGHT = "#BDE3FF";
type Pt = { x: number; y: number };

export interface Connection {
    ref: ConnectionRef;
    action: PrototypeAction;
    a: Pt;
    b: Pt;
    c1: Pt;
    c2: Pt;
    // Back has no destination: it ends in a small return marker.
    back: boolean;
    retargetable: boolean;
}

function curve(a: Pt, b: Pt): { c1: Pt; c2: Pt } {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    const backwards = b.x < a.x;
    return { c1: { x: a.x + dx, y: a.y }, c2: { x: backwards ? b.x + dx : b.x - dx, y: b.y } };
}

// Where a connection lands on a box: the near side, high on frames and centred on layers.
function landing(from: Rect, to: Rect, frame: boolean): { x: number; y: number } {
    const y = frame ? to.y + Math.min(to.h / 2, 40) : to.y + to.h / 2;
    return to.x >= from.x + from.w ? { x: to.x, y } : { x: to.x + to.w, y };
}

// Layers whose interactions are drawn: not copies inside instances, nor instances that only inherit
// their main component's (the reference draws those on the main component).
function drawsOwn(node: SceneNode): boolean {
    if (node.sourceId) return false;
    if (node.type === "instance" && !(node.overrides ?? []).includes("interactions")) return false;
    return true;
}

export function connections(doc: NagmaDocument, camera: Camera): Connection[] {
    const out: Connection[] = [];
    const drag = protoUi.get().drag;
    const visit = (ids: string[]) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            if (!node || !node.visible) continue;
            if (drawsOwn(node) && node.interactions?.length) {
                const from = selectionBounds(doc, [node.id]);
                if (from) {
                    node.interactions.forEach((it, i) => {
                        walkActions(actionsOf(it), (action, path) => {
                            const ref = { node: node.id, interaction: i, path };
                            const a = worldToScreen(camera, from.x + from.w, from.y + from.h / 2);
                            if (action.type === "back") {
                                const b = { x: a.x + 36, y: a.y - 22 };
                                out.push({ ref, action, a, b, ...curve(a, b), back: true, retargetable: false });
                                return;
                            }
                            const kinds = ["navigate", "overlay", "swap", "scroll-to", "change-to", "video"];
                            if (!kinds.includes(action.type)) return;
                            const target = action.target ? doc.nodes[action.target] : undefined;
                            const to = target ? selectionBounds(doc, [target.id]) : null;
                            if (!target || !to) return;
                            const frame = action.type === "navigate" || action.type === "overlay" || action.type === "swap";
                            const land = landing(from, to, frame);
                            let b = worldToScreen(camera, land.x, land.y);
                            if (drag?.kind === "retarget" && sameRef(drag.ref, ref)) b = worldToScreen(camera, drag.cursor.x, drag.cursor.y);
                            out.push({ ref, action, a, b, ...curve(a, b), back: false, retargetable: true });
                        });
                    });
                }
            }
            visit(node.children);
        }
    };
    visit(layerRoots(doc));
    return out;
}

export function bezierPoint(c: Connection, t: number): Pt {
    const u = 1 - t;
    return {
        x: u * u * u * c.a.x + 3 * u * u * t * c.c1.x + 3 * u * t * t * c.c2.x + t * t * t * c.b.x,
        y: u * u * u * c.a.y + 3 * u * u * t * c.c1.y + 3 * u * t * t * c.c2.y + t * t * t * c.b.y,
    };
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// How near (screen pixels) a press must be to a connection's line, and to its arrow end, to grab it:
// generous, since the line is thin.
const HIT_LINE = 8;
const HIT_END = 10;

// The connection under a screen point; `end` when it's the arrow end (drag it to retarget), and `t`
// how far along the curve (0 to 1) the point is.
export function hitConnection(list: Connection[], x: number, y: number): { conn: Connection; end: boolean; t: number } | null {
    const p = { x, y };
    for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (!c) continue;
        if (Math.hypot(c.b.x - x, c.b.y - y) <= HIT_END) return { conn: c, end: c.retargetable, t: 1 };
    }
    let best: { conn: Connection; end: boolean; t: number; d: number } | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (!c) continue;
        let prev = c.a;
        for (let k = 1; k <= 24; k++) {
            const next = bezierPoint(c, k / 24);
            const d = distToSegment(p, prev, next);
            // The nearest line wins where two run close together.
            if (d <= HIT_LINE && (!best || d < best.d - 0.5)) best = { conn: c, end: false, t: (k - 0.5) / 24, d };
            prev = next;
        }
    }
    return best && { conn: best.conn, end: best.end, t: best.t };
}

// The point (canvas pixels) an open Interaction popover points at: on its connection's curve, or
// null when that connection isn't drawn.
export function anchorPoint(doc: NagmaDocument, camera: Camera, anchor: { ref: ConnectionRef; t: number }): Pt | null {
    if (protoUi.get().hidden) return null;
    const c = connections(doc, camera).find((x) => sameRef(x.ref, anchor.ref));
    return c ? bezierPoint(c, c.back ? Math.min(anchor.t, 0.5) : anchor.t) : null;
}

// Opens the Interaction popover for a layer's interaction from a row in the panel, docked beside
// the panel level with the row.
export function openInteractionAt(node: string, interaction: number, el: Element | null) {
    const s = editor.get();
    const rect = canvasRect();
    const c = protoUi.get().hidden ? undefined : connections(s.doc, s.camera).find((x) => x.ref.node === node && x.ref.interaction === interaction);
    const mid = c ? bezierPoint(c, 0.5) : null;
    const visible = mid && rect && mid.x >= 0 && mid.y >= 0 && mid.x <= rect.width && mid.y <= rect.height;
    const y = el?.getBoundingClientRect().top ?? 120;
    // Opened from the Prototype tab's row it docks to the right panel (the connection is still
    // shown selected); only a press on the connection on the canvas anchors it there.
    if (c && visible) protoUi.set({ selected: c.ref });
    openInteraction({ node, interaction, path: null, y, anchor: null });
    redraw();
}

// Where a layer's link handle sits: just right of its middle, in screen space.
export function handlePoint(doc: NagmaDocument, camera: Camera, id: string): Pt | null {
    const box = selectionBounds(doc, [id]);
    if (!box) return null;
    const p = worldToScreen(camera, box.x + box.w, box.y + box.h / 2);
    return { x: p.x + 12, y: p.y };
}

// The flow start tag: a pill outside the frame's top left corner, flush with its left edge, with
// the flow's name and a play-in-a-window mark.
function flowTagRect(ctx: CanvasRenderingContext2D | null, doc: NagmaDocument, camera: Camera, frame: SceneNode): Rect {
    const box = selectionBounds(doc, [frame.id]) ?? { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    const corner = worldToScreen(camera, box.x, box.y);
    const name = flowLabel(doc, frame);
    let w = name.length * 7;
    if (ctx) {
        ctx.save();
        ctx.font = fontString(12, 600);
        w = ctx.measureText(name).width;
        ctx.restore();
    }
    const width = w + 40;
    return { x: corner.x - width, y: corner.y, w: width, h: 24 };
}

let measure: CanvasRenderingContext2D | null = null;
function hitFlowTag(doc: NagmaDocument, camera: Camera, x: number, y: number): SceneNode | null {
    measure ??= document.createElement("canvas").getContext("2d");
    for (const id of layerRoots(doc)) {
        const node = doc.nodes[id];
        if (!node?.flowStart || !node.visible) continue;
        const r = flowTagRect(measure, doc, camera, node);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return node;
    }
    return null;
}

function drawFlowTag(ctx: CanvasRenderingContext2D, r: Rect, name: string, ghost = false, selected = false) {
    ctx.save();
    ctx.globalAlpha = ghost ? 0.75 : 1;
    const solid = selected || ghost;
    ctx.fillStyle = solid ? PROTO : PROTO_LIGHT;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, [5, 0, 0, 5]);
    ctx.fill();
    const ink = solid ? "#FFFFFF" : "#1E1E1E";
    ctx.fillStyle = ink;
    ctx.font = fontString(12, 600);
    ctx.textBaseline = "middle";
    ctx.fillText(name, r.x + 8, r.y + r.h / 2 + 0.5);
    // A window with a play mark, after the name.
    const ix = r.x + r.w - 22;
    const iy = r.y + r.h / 2 - 6;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(ix + 0.5, iy + 0.5, 12, 12, 1.5);
    ctx.moveTo(ix + 0.5, iy + 3.5);
    ctx.lineTo(ix + 12.5, iy + 3.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ix + 5, iy + 5.5);
    ctx.lineTo(ix + 8.5, iy + 8);
    ctx.lineTo(ix + 5, iy + 10.5);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

// Frames some interaction opens as an overlay (or swaps in), on this page.
function overlayTargets(doc: NagmaDocument): Set<string> {
    const out = new Set<string>();
    const visit = (actions: PrototypeAction[]) => {
        for (const a of actions) {
            if ((a.type === "overlay" || a.type === "swap") && a.target && doc.nodes[a.target]?.visible) out.add(a.target);
            for (const b of a.blocks ?? []) visit(b.actions);
        }
    };
    for (const n of Object.values(doc.nodes)) for (const it of n.interactions ?? []) visit(actionsOf(it));
    const roots = new Set(layerRoots(doc));
    return new Set([...out].filter((id) => roots.has(id)));
}

// The overlay marker: a small badge above the frame's top right corner, two stacked panes.
function drawOverlayMarker(ctx: CanvasRenderingContext2D, corner: Pt) {
    const x = corner.x - 20;
    const y = corner.y - 26;
    ctx.save();
    ctx.fillStyle = PROTO;
    ctx.beginPath();
    ctx.roundRect(x, y, 20, 20, 5);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(x + 4.5, y + 4.5, 8, 8, 1.5);
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 8, 8, 8, 1.5);
    ctx.fill();
    ctx.restore();
}

function strokeNoodle(ctx: CanvasRenderingContext2D, c: { a: Pt; b: Pt; c1: Pt; c2: Pt }, width: number, alpha: number) {
    ctx.beginPath();
    ctx.moveTo(c.a.x, c.a.y);
    ctx.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.b.x, c.b.y);
    ctx.strokeStyle = PROTO;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// An open chevron at the destination end.
function arrowHead(ctx: CanvasRenderingContext2D, c: { b: Pt; c2: Pt }, size: number, alpha = 1) {
    const angle = Math.atan2(c.b.y - c.c2.y, c.b.x - c.c2.x);
    ctx.save();
    ctx.translate(c.b.x, c.b.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-size, -size);
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size);
    ctx.strokeStyle = PROTO;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.restore();
}

// The hollow dot where a connection starts.
function startDot(ctx: CanvasRenderingContext2D, p: Pt) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = PROTO;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

// A small circle with a return arrow, where a Back connection ends.
function backMarker(ctx: CanvasRenderingContext2D, p: Pt, strong: boolean) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = strong ? PROTO : "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = PROTO;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = strong ? "#FFFFFF" : PROTO;
    ctx.beginPath();
    ctx.arc(p.x + 0.5, p.y + 0.5, 3.5, -Math.PI / 2, Math.PI / 2);
    ctx.moveTo(p.x + 0.5, p.y - 3);
    ctx.lineTo(p.x - 3.5, p.y - 3);
    ctx.moveTo(p.x - 1.5, p.y - 5);
    ctx.lineTo(p.x - 3.5, p.y - 3);
    ctx.lineTo(p.x - 1.5, p.y - 1);
    ctx.stroke();
    ctx.restore();
}

// What a new or moved connection would land on at a world point.
function dropTarget(doc: NagmaDocument, from: SceneNode, world: Pt, kind: PrototypeAction["type"] | "new"): { node: SceneNode; type: PrototypeAction["type"] } | null {
    const own = screenOf(doc, from);
    const variants = variantSiblings(doc, from);
    if (kind === "change-to" || kind === "new") {
        const v = variants.find((n) => containsPoint(doc, n, world.x, world.y) && !isAncestor(doc, n.id, from.id));
        if (v) return { node: v, type: "change-to" };
        if (kind === "change-to") return null;
    }
    if (kind === "scroll-to" || kind === "video" || kind === "new") {
        const hit = hitTest(doc, world.x, world.y, true);
        if (hit && own && hit.id !== own.id && isAncestor(doc, own.id, hit.id) && !isAncestor(doc, hit.id, from.id) && hit.id !== from.id) {
            if (kind === "video" && !hit.fills.some((p) => p.type === "image" && p.video)) return null;
            if (kind !== "video") return { node: hit, type: "scroll-to" };
            return { node: hit, type: "video" };
        }
        if (kind !== "new") return null;
    }
    const dest = [...destinations(doc)].reverse().find((n) => n.id !== own?.id && containsPoint(doc, n, world.x, world.y));
    if (!dest) return null;
    if (kind === "new") {
        // From inside a frame that opens as an overlay, new connections swap the overlay.
        const asOverlay = own && Object.values(doc.nodes).some((n) => n.interactions?.some((it) => actionsOf(it).some((a) => a.type === "overlay" && a.target === own.id)));
        return { node: dest, type: asOverlay ? "swap" : "navigate" };
    }
    return { node: dest, type: kind };
}

function isAncestor(doc: NagmaDocument, ancestor: string, id: string): boolean {
    let current: SceneNode | undefined = doc.nodes[id];
    while (current) {
        if (current.id === ancestor) return true;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return false;
}

// The variants of the set a layer sits in (for "Change to").
function variantSiblings(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    let current: SceneNode | undefined = node;
    while (current) {
        const parent: SceneNode | undefined = current.parentId ? doc.nodes[current.parentId] : undefined;
        if (current.type === "component" && parent?.type === "componentSet") return parent.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => n?.type === "component");
        current = parent;
    }
    return [];
}

function outline(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, node: SceneNode) {
    const box = selectionBounds(doc, [node.id]);
    if (!box) return;
    const p = worldToScreen(camera, box.x, box.y);
    ctx.save();
    ctx.strokeStyle = PROTO;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, box.w * camera.zoom, box.h * camera.zoom);
    ctx.restore();
}

// Draws every connection, flow starting points and the selection's link handle.
export function drawConnections(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, selection: string[]) {
    const ui = protoUi.get();
    ctx.save();
    const selected = new Set(selection);
    if (!ui.hidden) {
        const open = ui.editing?.anchor?.ref ?? null;
        for (const c of connections(doc, camera)) {
            // The connection an open Interaction popover points at shows as selected.
            const isSelected = sameRef(ui.selected, c.ref) || sameRef(open, c.ref);
            const isHover = sameRef(ui.hover, c.ref);
            const strong = isSelected || isHover || selected.has(c.ref.node);
            strokeNoodle(ctx, c, isSelected ? 2.5 : 2, strong ? 1 : 0.55);
            if (c.back) backMarker(ctx, c.b, isSelected || isHover);
            else arrowHead(ctx, c, 6, strong ? 1 : 0.55);
            if (strong) startDot(ctx, c.a);
            if (isSelected && c.retargetable) {
                ctx.beginPath();
                ctx.arc(c.b.x, c.b.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = "#FFFFFF";
                ctx.fill();
                ctx.strokeStyle = PROTO;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
        for (const id of overlayTargets(doc)) {
            const box = selectionBounds(doc, [id]);
            if (box) drawOverlayMarker(ctx, worldToScreen(camera, box.x + box.w, box.y));
        }
        for (const id of layerRoots(doc)) {
            const node = doc.nodes[id];
            if (!node?.flowStart || !node.visible) continue;
            if (ui.drag?.kind === "flow" && ui.drag.from === node.id) continue;
            drawFlowTag(ctx, flowTagRect(ctx, doc, camera, node), flowLabel(doc, node), false, selected.has(node.id));
        }
    }
    const drag = ui.drag;
    if (drag?.kind === "new") {
        const from = doc.nodes[drag.from];
        const box = selectionBounds(doc, [drag.from]);
        if (from && box) {
            const a = worldToScreen(camera, box.x + box.w, box.y + box.h / 2);
            const b = worldToScreen(camera, drag.cursor.x, drag.cursor.y);
            const c = { a, b, ...curve(a, b) };
            strokeNoodle(ctx, c, 2, 1);
            arrowHead(ctx, c, 8);
            const target = dropTarget(doc, from, drag.cursor, "new");
            if (target) outline(ctx, doc, camera, target.node);
        }
    } else if (drag?.kind === "retarget") {
        const from = doc.nodes[drag.ref.node];
        const action = from?.interactions?.[drag.ref.interaction] ? actionAt(actionsOf(from.interactions[drag.ref.interaction] as NonNullable<typeof from.interactions>[number]), drag.ref.path) : undefined;
        const target = from && action ? dropTarget(doc, from, drag.cursor, action.type) : null;
        if (target) outline(ctx, doc, camera, target.node);
    } else if (drag?.kind === "flow") {
        const from = doc.nodes[drag.from];
        const p = worldToScreen(camera, drag.cursor.x, drag.cursor.y);
        if (from) {
            const r = flowTagRect(ctx, doc, camera, from);
            drawFlowTag(ctx, { ...r, x: p.x - 10, y: p.y - r.h / 2 }, flowLabel(doc, from), true);
            const target = flowDrop(doc, drag.cursor, from.id);
            if (target) outline(ctx, doc, camera, target);
        }
    }
    const source = selection.length === 1 ? selection[0] : undefined;
    const node = source ? doc.nodes[source] : undefined;
    if (!drag && node && node.type !== "page" && !node.isSection) {
        const h = handlePoint(doc, camera, node.id);
        if (h) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = PROTO;
            ctx.fill();
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(h.x - 3.5, h.y);
            ctx.lineTo(h.x + 3.5, h.y);
            ctx.moveTo(h.x, h.y - 3.5);
            ctx.lineTo(h.x, h.y + 3.5);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function flowDrop(doc: NagmaDocument, world: Pt, from: string): SceneNode | null {
    for (const id of [...layerRoots(doc)].reverse()) {
        const n = doc.nodes[id];
        if (n && n.id !== from && isFrameLike(n) && !n.isSection && !n.flowStart && n.visible && containsPoint(doc, n, world.x, world.y)) return n;
    }
    return null;
}

// ---- Pointer gestures (called by the canvas on the Prototype tab) ----

function redraw() {
    editor.set({});
}

// Pointer down: grab the link handle, a connection's arrow end or a flow's tag, or select a
// connection. Returns true when the press is handled here (and a drag may follow).
export function protoPointerDown(screen: Pt, world: Pt, readOnly: boolean): boolean {
    const s = editor.get();
    const ui = protoUi.get();
    if (!readOnly && s.selection.length === 1) {
        const id = s.selection[0] ?? "";
        const h = handlePoint(s.doc, s.camera, id);
        const node = s.doc.nodes[id];
        if (h && node && node.type !== "page" && !node.isSection && Math.hypot(h.x - screen.x, h.y - screen.y) <= 9) {
            protoUi.set({ drag: { kind: "new", from: id, cursor: world }, selected: null });
            return true;
        }
    }
    if (ui.hidden) {
        if (ui.selected) protoUi.set({ selected: null });
        return false;
    }
    if (!readOnly) {
        const tag = hitFlowTag(s.doc, s.camera, screen.x, screen.y);
        if (tag) {
            editor.set({ selection: [tag.id] });
            protoUi.set({ drag: { kind: "flow", from: tag.id, cursor: world }, selected: null });
            return true;
        }
    }
    const hit = hitConnection(connections(s.doc, s.camera), screen.x, screen.y);
    if (hit) {
        protoUi.set({ selected: hit.conn.ref, hover: hit.conn.ref, drag: hit.end && !readOnly ? { kind: "retarget", ref: hit.conn.ref, cursor: world } : null });
        editor.set({ selection: [hit.conn.ref.node] });
        // Clicking a connection opens its interaction in a popover pointing at the click.
        openInteraction({ node: hit.conn.ref.node, interaction: hit.conn.ref.interaction, path: hit.conn.ref.path, y: clientY(screen.y), anchor: { ref: hit.conn.ref, t: hit.t } });
        return true;
    }
    if (ui.selected) protoUi.set({ selected: null });
    return false;
}

function clientY(y: number): number {
    return (canvasRect()?.top ?? 0) + y;
}

export function protoDragging(): boolean {
    return protoUi.get().drag !== null;
}

export function protoPointerMove(world: Pt) {
    const drag = protoUi.get().drag;
    if (!drag) return;
    protoUi.set({ drag: { ...drag, cursor: world } });
    redraw();
}

function setActions(doc: NagmaDocument, nodeId: string, interactionIndex: number, update: (actions: PrototypeAction[]) => PrototypeAction[]): Command | null {
    const node = doc.nodes[nodeId];
    const it = node?.interactions?.[interactionIndex];
    if (!node || !it) return null;
    const normal = normalizeInteraction(it);
    const actions = update(normal.actions ?? []);
    // An interaction left with no actions goes too.
    const interactions = actions.length ? node.interactions?.map((x, i) => (i === interactionIndex ? { ...normal, actions } : x)) : node.interactions?.filter((_, i) => i !== interactionIndex);
    return { type: "node.update", id: nodeId, patch: { interactions } };
}

export function protoPointerUp(world: Pt) {
    const drag = protoUi.get().drag;
    protoUi.set({ drag: null });
    if (!drag) return;
    const s = editor.get();
    const doc = s.doc;
    if (drag.kind === "new") {
        const from = doc.nodes[drag.from];
        const target = from ? dropTarget(doc, from, world, "new") : null;
        if (!from || !target) return redraw();
        const base = navigateAction(target.node.id);
        const action: PrototypeAction =
            target.type === "navigate"
                ? base
                : target.type === "scroll-to" || target.type === "change-to"
                  ? { type: target.type, target: target.node.id, transition: { ...(base.transition ?? DEFAULT_TRANSITION), type: "smart" } }
                  : { type: target.type, target: target.node.id, transition: base.transition };
        const commands: Command[] = [{ type: "node.update", id: from.id, patch: { interactions: [...(from.interactions ?? []), { trigger: "click", delay: 800, actions: [action] }] } }];
        // The first connection from a frame outside every flow starts a flow there.
        const screen = screenOf(doc, from);
        if (screen && !screen.flowStart && (target.type === "navigate" || target.type === "swap") && !inAnyFlow(doc, screen.id)) {
            commands.push({ type: "node.update", id: screen.id, patch: { flowStart: true, flowName: screen.flowName ?? nextFlowName(doc) } });
        }
        editor.execute(commands.length === 1 ? (commands[0] as Command) : { type: "batch", commands });
        const ref = { node: from.id, interaction: from.interactions?.length ?? 0, path: [0] };
        protoUi.set({ selected: ref });
        // A new connection opens its interaction.
        const end = editor.get();
        openInteraction({ ...ref, y: clientY(worldToScreen(end.camera, world.x, world.y).y), anchor: { ref, t: 0.5 } });
        return;
    }
    if (drag.kind === "retarget") {
        const from = doc.nodes[drag.ref.node];
        const it = from?.interactions?.[drag.ref.interaction];
        const action = it ? actionAt(actionsOf(it), drag.ref.path) : undefined;
        if (!from || !it || !action) return redraw();
        const target = dropTarget(doc, from, world, action.type);
        // Dropping the end on nothing removes the connection.
        const cmd = setActions(doc, from.id, drag.ref.interaction, (actions) => updateActionAt(actions, drag.ref.path, target ? { ...action, target: target.node.id } : null));
        if (cmd) editor.execute(cmd);
        protoUi.set({ selected: target ? drag.ref : null, hover: null });
        return;
    }
    if (drag.kind === "flow") {
        const from = doc.nodes[drag.from];
        const target = flowDrop(doc, world, drag.from);
        if (!from || !target) return redraw();
        editor.execute({
            type: "batch",
            commands: [
                { type: "node.update", id: from.id, patch: { flowStart: false, flowName: undefined, flowDescription: undefined } },
                { type: "node.update", id: target.id, patch: { flowStart: true, flowName: from.flowName ?? flowLabel(doc, from), flowDescription: from.flowDescription } },
            ],
        });
        editor.set({ selection: [target.id] });
    }
}

// Hover over a connection: highlight it. True when the pointer is on one (or on a flow tag).
export function protoHover(screen: Pt): { over: boolean; cursor: string | null } {
    const s = editor.get();
    const ui = protoUi.get();
    if (ui.hidden) return { over: false, cursor: null };
    if (hitFlowTag(s.doc, s.camera, screen.x, screen.y)) return { over: true, cursor: s.readOnly ? "pointer" : "grab" };
    const hit = hitConnection(connections(s.doc, s.camera), screen.x, screen.y);
    const next = hit?.conn.ref ?? null;
    if (!sameRef(next, ui.hover) && (next || ui.hover)) {
        protoUi.set({ hover: next });
        redraw();
    }
    return { over: Boolean(hit), cursor: hit ? (hit.end && !s.readOnly ? "grab" : "pointer") : null };
}

// Delete or Backspace with a connection selected removes that action.
export function deleteSelectedConnection(): boolean {
    const ui = protoUi.get();
    const s = editor.get();
    if (!ui.selected || s.rightTab !== "prototype" || s.readOnly) return false;
    const ref = ui.selected;
    const cmd = setActions(s.doc, ref.node, ref.interaction, (actions) => updateActionAt(actions, ref.path, null));
    protoUi.set({ selected: null, hover: null });
    closeInteraction();
    if (cmd) editor.execute(cmd);
    return true;
}

// ⇧E: show or hide prototype connections.
export function toggleConnections() {
    const hidden = !protoUi.get().hidden;
    protoUi.set({ hidden, selected: null, hover: null });
    editor.notify(hidden ? "Prototype connections hidden" : "Prototype connections shown");
    redraw();
}

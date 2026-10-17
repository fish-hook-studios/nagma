import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, NodePatch, SceneNode } from "../../engine/types";
import { type PluginPointer, drawDot, drawLabel, registerCanvasPlugin } from "../canvas-plugins";
import { sceneFocus } from "../hit-test";

// On-canvas handles of a selected rectangle, frame, component or instance (a dot inside each
// corner: drag it towards the middle to round every corner, ⌥-drag to round just that one) and of
// a selected ellipse (the arc's start and end on the outline, and the ring's inner ratio from the
// middle), the way the reference shows them: only while the pointer is over the layer.

type Pt = { x: number; y: number };
type Kind = { corner: 0 | 1 | 2 | 3 } | { arc: "start" | "sweep" | "ratio" };

// Corners in the order of `radii`: top-left, top-right, bottom-right, bottom-left.
const SIGNS: [number, number][] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
];
const INSET = 12;
const MIN_SIDE = 40;

function target(): SceneNode | null {
    const s = editor.get();
    if (s.editingVectorId || s.editingTextId || s.tool !== "move" || s.selection.length !== 1 || s.mode === "dev" || s.readOnly) return null;
    // A scene shown on its own (the campaign editor's asset view) keeps its corners plain.
    if (sceneFocus.id) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (!node || node.parametric || node.sourceId || node.locked || node.isSection || node.isSlice) return null;
    if (node.type !== "rect" && node.type !== "frame" && node.type !== "component" && node.type !== "instance" && node.type !== "ellipse") return null;
    // Small on screen: no handles, so the layer can still be grabbed and resized.
    if (Math.min(node.w, node.h) * s.camera.zoom < MIN_SIDE) return null;
    return node;
}

// Whether the hovered layer is this one or inside it.
function pointerOver(doc: NagmaDocument, id: string): boolean {
    let at = editor.get().hoverId;
    for (let depth = 0; at && depth < 64; depth++) {
        if (at === id) return true;
        at = doc.nodes[at]?.parentId ?? null;
    }
    return false;
}

function toScreen(doc: NagmaDocument, node: SceneNode, local: Pt): Pt {
    const w = apply(worldMatrix(doc, node), node.x + local.x, node.y + local.y);
    return worldToScreen(editor.get().camera, w.x, w.y);
}

function toLocal(doc: NagmaDocument, node: SceneNode, world: Pt): Pt {
    const p = apply(worldMatrix(doc, node).inverse(), world.x, world.y);
    return { x: p.x - node.x, y: p.y - node.y };
}

const radiiOf = (node: SceneNode): [number, number, number, number] => node.radii ?? [node.radius, node.radius, node.radius, node.radius];
const arcOf = (node: SceneNode) => node.arc ?? { start: 0, sweep: 360, inner: 0 };

// Where a corner's dot sits: on the diagonal, as far in as the radius (at least a few pixels in).
function cornerLocal(node: SceneNode, i: 0 | 1 | 2 | 3, radius: number, zoom: number): Pt {
    const [sx, sy] = SIGNS[i]!;
    const d = Math.min(Math.max(radius, INSET / zoom), Math.min(node.w, node.h) / 2);
    const x = sx > 0 ? d : node.w - d;
    const y = sy > 0 ? d : node.h - d;
    return { x, y };
}

function onEllipse(node: SceneNode, degrees: number, scale = 1): Pt {
    const a = (degrees * Math.PI) / 180;
    return { x: node.w / 2 + (node.w / 2) * scale * Math.cos(a), y: node.h / 2 + (node.h / 2) * scale * Math.sin(a) };
}

function handles(doc: NagmaDocument, node: SceneNode): { kind: Kind; at: Pt }[] {
    const zoom = editor.get().camera.zoom;
    if (node.type === "ellipse") {
        const arc = arcOf(node);
        const inset = Math.min(0.92, 1 - INSET / zoom / Math.max(1, Math.min(node.w, node.h) / 2));
        const mid = arc.start + arc.sweep / 2;
        const out: { kind: Kind; at: Pt }[] = [{ kind: { arc: "ratio" }, at: toScreen(doc, node, onEllipse(node, mid, arc.inner)) }];
        if (Math.abs(arc.sweep) < 360) out.push({ kind: { arc: "start" }, at: toScreen(doc, node, onEllipse(node, arc.start, inset)) });
        out.push({ kind: { arc: "sweep" }, at: toScreen(doc, node, onEllipse(node, arc.start + arc.sweep, inset)) });
        return out;
    }
    const radii = radiiOf(node);
    return ([0, 1, 2, 3] as const).map((i) => ({ kind: { corner: i }, at: toScreen(doc, node, cornerLocal(node, i, radii[i], zoom)) }));
}

function hit(p: PluginPointer): Kind | null {
    const node = target();
    if (!node) return null;
    // The last drawn (sweep, or the bottom-left corner) wins when dots overlap.
    const list = handles(editor.get().doc, node).reverse();
    return list.find((h) => Math.hypot(h.at.x - p.screen.x, h.at.y - p.screen.y) <= 6)?.kind ?? null;
}

let drag: { kind: Kind; node: SceneNode; base: NagmaDocument; start: Pt; moved: boolean } | null = null;
let label: { at: Pt; text: string } | null = null;

const angleOf = (node: SceneNode, local: Pt) => (Math.atan2((local.y - node.h / 2) / (node.h / 2 || 1), (local.x - node.w / 2) / (node.w / 2 || 1)) * 180) / Math.PI;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;
const round = (n: number) => Math.round(n * 100) / 100;

function patchFor(p: PluginPointer): NodePatch | null {
    if (!drag) return null;
    const { node, kind } = drag;
    const local = toLocal(drag.base, node, p.world);
    label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: "" };
    if ("corner" in kind) {
        const i = kind.corner;
        const [sx, sy] = SIGNS[i]!;
        // Distance moved inwards along the corner's diagonal.
        const along = (q: Pt) => ((sx > 0 ? q.x : node.w - q.x) + (sy > 0 ? q.y : node.h - q.y)) / 2;
        const startRadius = radiiOf(node)[i];
        const radius = Math.max(0, Math.min(Math.min(node.w, node.h) / 2, Math.round(startRadius + along(local) - along(drag.start))));
        label.text = `Radius ${radius}`;
        if (p.altKey) {
            const radii = [...radiiOf(node)] as [number, number, number, number];
            radii[i] = radius;
            return { radii };
        }
        return { radius, radii: null };
    }
    const arc = arcOf(node);
    const snap = (deg: number) => (p.shiftKey ? Math.round(deg / 15) * 15 : deg);
    if (kind.arc === "ratio") {
        const dx = (local.x - node.w / 2) / (node.w / 2 || 1);
        const dy = (local.y - node.h / 2) / (node.h / 2 || 1);
        const inner = Math.max(0, Math.min(0.99, Math.hypot(dx, dy)));
        label.text = `Ratio ${Math.round(inner * 100)}%`;
        return { arc: { ...arc, inner: round(inner) } };
    }
    const angle = snap(wrap(angleOf(node, local)));
    if (kind.arc === "start") {
        label.text = `Start ${Math.round(angle)}°`;
        return { arc: { ...arc, start: round(angle) } };
    }
    let sweep = wrap(angle - arc.start);
    // Back at the start: a whole ellipse again.
    if (sweep < 1) sweep = Math.abs(arc.sweep) > 180 ? 360 : 0.01;
    label.text = `Sweep ${Math.round(sweep * 10) / 10}°`;
    return { arc: { ...arc, sweep: round(sweep) } };
}

registerCanvasPlugin({
    name: "corner-handles",
    down(p) {
        const kind = hit(p);
        const node = target();
        if (!kind || !node) return false;
        const base = editor.get().doc;
        drag = { kind, node, base, start: toLocal(base, node, p.world), moved: false };
        return true;
    },
    move(p) {
        const patch = patchFor(p);
        if (!drag || !patch) return;
        drag.moved = true;
        editor.preview(applyCommand(drag.base, { type: "node.update", id: drag.node.id, patch }));
    },
    up(p) {
        const patch = patchFor(p);
        const d = drag;
        drag = null;
        label = null;
        if (!d || !patch || !d.moved) return;
        editor.execute({ type: "node.update", id: d.node.id, patch }, d.base);
    },
    hover(p) {
        return hit(p) ? "pointer" : undefined;
    },
    overlay(ctx) {
        const node = target();
        if (!node) return;
        // As in the reference, the dots show while the pointer is over the layer (or one is dragged).
        if (!drag && !pointerOver(editor.get().doc, node.id)) return;
        for (const h of handles(editor.get().doc, node)) drawDot(ctx, h.at.x, h.at.y, 3.5);
        if (label?.text) drawLabel(ctx, label.at.x, label.at.y, label.text);
    },
});

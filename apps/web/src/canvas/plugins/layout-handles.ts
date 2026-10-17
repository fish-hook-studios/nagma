import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { AutoLayout, Command, NagmaDocument, SceneNode } from "../../engine/types";
import { type PluginPointer, HANDLE_BLUE, drawLabel, registerCanvasPlugin } from "../canvas-plugins";
import { hitSelection, sceneFocus } from "../hit-test";

// On-canvas auto layout handles of a selected stack: a bar in the middle of each padding band
// (drag to change that side; ⌥ changes the opposite side with it, ⌥⇧ all four) and one between
// neighbouring children for the gap. Double-clicking a selection edge makes that axis hug its
// contents; ⌥ double-click makes it fill its auto layout parent.

type Pt = { x: number; y: number };
type Kind = { side: 0 | 1 | 2 | 3 } | { gap: true };

const PINK = "#F24E9F";
const MIN_SIDE = 48;

const isFrameLike = (n: SceneNode) => n.type === "frame" || n.type === "component" || n.type === "instance";

function target(): SceneNode | null {
    const s = editor.get();
    if (s.editingVectorId || s.editingTextId || s.tool !== "move" || s.selection.length !== 1 || s.mode === "dev" || s.readOnly) return null;
    if (sceneFocus.id) return null;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (!node || !node.layout || !isFrameLike(node) || node.locked || node.isSection) return null;
    if (Math.min(node.w, node.h) * s.camera.zoom < MIN_SIDE) return null;
    return node;
}

function toScreen(doc: NagmaDocument, node: SceneNode, local: Pt): Pt {
    const w = apply(worldMatrix(doc, node), node.x + local.x, node.y + local.y);
    return worldToScreen(editor.get().camera, w.x, w.y);
}

function toLocal(doc: NagmaDocument, node: SceneNode, world: Pt): Pt {
    const p = apply(worldMatrix(doc, node).inverse(), world.x, world.y);
    return { x: p.x - node.x, y: p.y - node.y };
}

// The layout's children that take part in the flow, in order.
function flowChildren(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    return node.children.map((id) => doc.nodes[id]).filter((c): c is SceneNode => Boolean(c && c.visible !== false && c.positioning !== "absolute"));
}

// Handles in screen space, each with the direction a drag along it measures (local units).
function handles(doc: NagmaDocument, node: SceneNode): { kind: Kind; at: Pt; vertical: boolean }[] {
    const l = node.layout as AutoLayout;
    const [t, r, b, lft] = l.padding;
    const zoom = editor.get().camera.zoom;
    // A band thinner than a few pixels still gets its bar just inside the edge.
    const inset = (p: number) => Math.max(p / 2, 4 / zoom);
    const out: { kind: Kind; at: Pt; vertical: boolean }[] = [
        { kind: { side: 0 }, at: toScreen(doc, node, { x: node.w / 2, y: inset(t) }), vertical: true },
        { kind: { side: 1 }, at: toScreen(doc, node, { x: node.w - inset(r), y: node.h / 2 }), vertical: false },
        { kind: { side: 2 }, at: toScreen(doc, node, { x: node.w / 2, y: node.h - inset(b) }), vertical: true },
        { kind: { side: 3 }, at: toScreen(doc, node, { x: inset(lft), y: node.h / 2 }), vertical: false },
    ];
    // The gap handle sits between the first two children (not for grids, wraps or an auto gap).
    const kids = flowChildren(doc, node);
    if (!l.grid && !l.wrap && l.primary !== "between" && kids.length >= 2) {
        const [a, c] = kids as [SceneNode, SceneNode];
        const horizontal = l.direction === "horizontal";
        const mid = horizontal ? { x: (a.x + a.w + c.x) / 2 - node.x, y: node.h / 2 } : { x: node.w / 2, y: (a.y + a.h + c.y) / 2 - node.y };
        out.push({ kind: { gap: true }, at: toScreen(doc, node, mid), vertical: !horizontal });
    }
    return out;
}

function hit(p: PluginPointer): Kind | null {
    const node = target();
    if (!node) return null;
    return handles(editor.get().doc, node).find((h) => Math.abs(h.at.x - p.screen.x) <= 7 && Math.abs(h.at.y - p.screen.y) <= 7)?.kind ?? null;
}

// ⌥ and ⇧ count when held at the press or at any point of the drag.
let drag: { kind: Kind; node: SceneNode; base: NagmaDocument; start: Pt; moved: boolean; alt: boolean; shift: boolean } | null = null;
let label: { at: Pt; text: string } | null = null;

function commandFor(p: PluginPointer): Command | null {
    if (!drag) return null;
    const { node, kind } = drag;
    const l = node.layout as AutoLayout;
    const local = toLocal(drag.base, node, p.world);
    const dx = local.x - drag.start.x;
    const dy = local.y - drag.start.y;
    label = { at: { x: p.screen.x, y: p.screen.y + 16 }, text: "" };
    if ("gap" in kind) {
        const gap = Math.max(0, Math.round(l.gap + (l.direction === "horizontal" ? dx : dy)));
        label.text = `Gap ${gap}`;
        return { type: "node.update", id: node.id, patch: { layout: { ...l, gap } } };
    }
    const side = kind.side;
    // Inwards is positive: down for the top, left for the right, and so on.
    const inward = side === 0 ? dy : side === 1 ? -dx : side === 2 ? -dy : dx;
    const value = Math.max(0, Math.round(l.padding[side] + inward));
    const alt = p.altKey || drag.alt;
    const all = alt && (p.shiftKey || drag.shift);
    const padding = [...l.padding] as AutoLayout["padding"];
    if (all) padding.fill(value);
    else {
        padding[side] = value;
        if (alt) padding[(side + 2) % 4] = value;
    }
    label.text = alt && !all ? `${side % 2 ? "Horizontal" : "Vertical"} padding ${value}` : `Padding ${value}`;
    return { type: "node.update", id: node.id, patch: { layout: { ...l, padding } } };
}

// Double-clicking an edge: hug on that axis, or (⌥) fill the auto layout parent.
function sizeFromEdge(p: PluginPointer): boolean {
    const s = editor.get();
    if (s.readOnly || s.tool !== "move" || s.selection.length !== 1 || s.editingVectorId || s.editingTextId) return false;
    const node = s.doc.nodes[s.selection[0] ?? ""];
    if (!node) return false;
    const h = hitSelection(s.doc, s.selection, s.camera, p.screen.x, p.screen.y);
    if (h?.kind !== "resize" || h.handle.length !== 1) return false;
    const axis = h.handle === "e" || h.handle === "w" ? "h" : "v";
    const parent = node.parentId ? s.doc.nodes[node.parentId] : undefined;
    if (p.altKey) {
        if (!parent?.layout || node.positioning === "absolute") return false;
        editor.execute({ type: "node.update", id: node.id, patch: { sizing: { ...node.sizing, [axis]: "fill" } } });
        return true;
    }
    const canHug = node.type === "text" || (isFrameLike(node) && Boolean(node.layout));
    if (!canHug) return false;
    editor.execute({ type: "node.update", id: node.id, patch: { sizing: { ...node.sizing, [axis]: "hug" } } });
    return true;
}

registerCanvasPlugin({
    name: "layout-handles",
    down(p) {
        const kind = hit(p);
        const node = target();
        if (!kind || !node) return false;
        const base = editor.get().doc;
        drag = { kind, node, base, start: toLocal(base, node, p.world), moved: false, alt: p.altKey, shift: p.shiftKey };
        return true;
    },
    move(p) {
        if (drag) {
            drag.alt ||= p.altKey;
            drag.shift ||= p.shiftKey;
        }
        const command = commandFor(p);
        if (!drag || !command) return;
        drag.moved = true;
        editor.preview(applyCommand(drag.base, command));
    },
    up(p) {
        const command = commandFor(p);
        const d = drag;
        drag = null;
        label = null;
        if (!d || !command || !d.moved) return;
        editor.execute(command, d.base);
    },
    hover(p) {
        const kind = hit(p);
        if (!kind) return undefined;
        const node = target();
        const vertical = "gap" in kind ? node?.layout?.direction !== "horizontal" : kind.side % 2 === 0;
        return vertical ? "ns-resize" : "ew-resize";
    },
    dblclick(p) {
        return sizeFromEdge(p);
    },
    overlay(ctx) {
        const node = target();
        if (!node) return;
        for (const h of handles(editor.get().doc, node)) {
            const [w, hgt] = h.vertical ? [12, 4] : [4, 12];
            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = "gap" in h.kind ? PINK : HANDLE_BLUE;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(h.at.x - w / 2, h.at.y - hgt / 2, w, hgt, 2);
            ctx.fill();
            ctx.stroke();
        }
        if (label?.text) drawLabel(ctx, label.at.x, label.at.y, label.text);
    },
});

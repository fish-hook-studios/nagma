import { nanoid } from "nanoid";
import { type VectorTool, type VertexRef, alignVertices, deleteVertices, joinVertices, screenVertices, splitGroups, vectorFrom } from "../canvas/vector-edit";
import { editor } from "./store";
import type { Command, Paint, SceneNode } from "./types";

// Commands of vector edit mode (the floating bar, its menu and keys), plus the fill and stroke
// shortcuts that work on any selection.

function editing(): SceneNode | null {
    const s = editor.get();
    return s.editingVectorId ? (s.doc.nodes[s.editingVectorId] ?? null) : null;
}

export function setVectorTool(tool: VectorTool) {
    editor.set({ vectorTool: tool });
}

export function selectAllVertices() {
    const s = editor.get();
    const node = editing();
    if (!node) return;
    const all = screenVertices(s.doc, node, s.camera, [])
        .filter((v) => v.part === "anchor")
        .map(({ sub, index }): VertexRef => ({ sub, index, part: "anchor" }));
    editor.set({ vertices: all });
}

// Delete removes the points; "heal" (⇧⌫) re-curves the neighbours over the gap. An empty path removes the layer.
export function deleteSelectedVertices(heal: boolean) {
    const s = editor.get();
    const node = editing();
    if (!node || !s.vertices.length) return;
    const patch = deleteVertices(node, s.vertices, heal);
    if (patch) editor.execute({ type: "node.update", id: node.id, patch });
    else {
        editor.execute({ type: "node.delete", ids: [node.id] });
        editor.set({ editingVectorId: null, selection: [] });
    }
    editor.set({ vertices: [] });
}

export function joinSelectedVertices(smooth: boolean) {
    const s = editor.get();
    const node = editing();
    if (!node) return;
    const patch = joinVertices(node, s.vertices, smooth);
    if (!patch) {
        editor.notify("Select two end points of open paths to join them.");
        return;
    }
    editor.execute({ type: "node.update", id: node.id, patch });
    editor.set({ vertices: [] });
}

export function alignSelectedVertices(how: Parameters<typeof alignVertices>[2]) {
    const s = editor.get();
    const node = editing();
    if (!node || s.vertices.length < 2) return;
    editor.execute({ type: "node.update", id: node.id, patch: alignVertices(node, s.vertices, how) });
}

// Fill and stroke shortcuts: ⌥/ removes fills, ⇧/ removes strokes, ⇧X swaps them.
function eachSelected(fn: (node: SceneNode) => Partial<SceneNode> | null) {
    const s = editor.get();
    const ids = s.editingVectorId ? [s.editingVectorId] : s.selection;
    editor.execute({
        type: "batch",
        commands: ids.flatMap((id) => {
            const node = s.doc.nodes[id];
            const patch = node ? fn(node) : null;
            return patch ? [{ type: "node.update" as const, id, patch }] : [];
        }),
    });
}

export function removeFills() {
    eachSelected((n) => (n.fills.length ? { fills: [] } : null));
}

export function removeStrokes() {
    eachSelected((n) => (n.strokes.length ? { strokes: [] } : null));
}

export function swapFillAndStroke() {
    eachSelected((n) => ({ fills: n.strokes as Paint[], strokes: n.fills as Paint[] }));
}

// The selected points' own corner radius (sharp points only; 0 makes them sharp again).
export function setVertexRadius(radius: number) {
    const s = editor.get();
    const node = editing();
    const path = node?.path;
    if (!node || !path || node.parametric) return;
    const anchors = s.vertices.filter((v) => v.part === "anchor");
    if (!anchors.length) return;
    const r = Math.max(0, Math.round(radius * 100) / 100);
    const subpaths = path.subpaths.map((sub, si) => ({
        closed: sub.closed,
        points: sub.points.map((p, pi) => {
            if (!anchors.some((v) => v.sub === si && v.index === pi)) return p;
            const { radius: _old, ...rest } = p;
            return r > 0 ? { ...rest, radius: r } : rest;
        }),
    }));
    editor.execute({ type: "node.update", id: node.id, patch: { path: { ...path, subpaths } } });
}

// The radius the selected points share, or null when they differ (or none is selected).
export function selectedVertexRadius(node: SceneNode | null, vertices: VertexRef[]): number | null {
    const anchors = vertices.filter((v) => v.part === "anchor");
    if (!node?.path || !anchors.length) return null;
    const values = new Set(anchors.map((v) => node.path!.subpaths[v.sub]?.points[v.index]?.radius ?? 0));
    return values.size === 1 ? [...values][0]! : null;
}

// Split vector: a vector made of separate paths becomes one layer per path (holes stay with the
// shape around them), each keeping the original's look.
export function splitVector() {
    const { doc, selection } = editor.get();
    const commands: Command[] = [];
    const created: string[] = [];
    for (const id of selection) {
        const node = doc.nodes[id];
        if (!node || node.type !== "vector") continue;
        const groups = splitGroups(node);
        if (groups.length < 2) continue;
        const parent = doc.nodes[node.parentId ?? ""];
        const index = (parent?.children ?? doc.roots).indexOf(node.id);
        const [first, ...rest] = groups;
        if (!first) continue;
        const kept = vectorFrom(node, first, node.id);
        commands.push({ type: "node.update", id: node.id, patch: { x: kept.x, y: kept.y, w: kept.w, h: kept.h, path: kept.path, parametric: null } });
        created.push(node.id);
        rest.forEach((subs, k) => {
            const copy = vectorFrom(node, subs, nanoid(10), `${node.name} ${k + 2}`);
            commands.push({ type: "node.create", node: copy, index: index + 1 + k });
            created.push(copy.id);
        });
    }
    if (!commands.length) {
        editor.notify("Nothing to split: the vector is one path.");
        return;
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created });
}

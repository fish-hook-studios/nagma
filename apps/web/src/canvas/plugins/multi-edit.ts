import { worldToScreen } from "../../engine/camera";
import { applyCommand } from "../../engine/commands";
import { enterVectorEdit } from "../../engine/actions";
import { editor } from "../../engine/store";
import { apply, worldMatrix } from "../../engine/transform";
import type { NagmaDocument, SceneNode } from "../../engine/types";
import { vectorUi } from "../../engine/vector-ui";
import { fitPath, placedSubpaths, shapeSubpaths } from "../../engine/vector";
import { addKeyHandler } from "../../hooks/use-vector-shortcuts";
import { type PluginPointer, HANDLE_BLUE, drawSquare, registerCanvasPlugin } from "../canvas-plugins";
import { hitTest } from "../hit-test";
import { type VertexRef, hitVertex, moveVertices, screenVertices, toVectorSpace } from "../vector-edit";

// Editing several vectors in one session: ⇧click another shape while editing points
// (or press Enter with several shapes selected) and its points show too. Clicking one of its
// points makes it the layer being edited, so every tool works on it, and the others stay in the
// session until you leave.

const EDITABLE = new Set(["vector", "rect", "ellipse"]);

function editable(node: SceneNode | undefined): node is SceneNode {
    return Boolean(node && EDITABLE.has(node.type) && !node.sourceId && !node.locked);
}

// Rectangles and ellipses become vectors when they join the session.
function asVector(id: string) {
    const node = editor.get().doc.nodes[id];
    if (node && (node.type === "rect" || node.type === "ellipse")) editor.execute({ type: "node.convert", id, to: "vector", path: fitPath(shapeSubpaths(node)).path });
}

function extras(): SceneNode[] {
    const s = editor.get();
    if (!s.editingVectorId) return [];
    return vectorUi
        .get()
        .extraVectors.filter((id) => id !== s.editingVectorId)
        .map((id) => s.doc.nodes[id])
        .filter((n): n is SceneNode => Boolean(n && n.type === "vector"));
}

// The session ends with the edit.
editor.subscribe(() => {
    if (editor.get().editingVectorId || !vectorUi.get().extraVectors.length) return;
    queueMicrotask(() => {
        if (!editor.get().editingVectorId && vectorUi.get().extraVectors.length) vectorUi.set({ extraVectors: [] });
    });
});

let drag: { id: string; refs: VertexRef[]; base: NagmaDocument; start: { x: number; y: number } } | null = null;

function extraVertexAt(p: PluginPointer): { node: SceneNode; ref: VertexRef } | null {
    const s = editor.get();
    for (const node of extras()) {
        const ref = hitVertex(s.doc, node, s.camera, [], p.screen.x, p.screen.y);
        if (ref && ref.part === "anchor") return { node, ref };
    }
    return null;
}

registerCanvasPlugin({
    name: "multi-edit",
    down(p) {
        const s = editor.get();
        if (!s.editingVectorId || s.tool === "pen" || (s.vectorTool !== "move" && s.vectorTool !== "lasso")) return false;
        const primary = s.doc.nodes[s.editingVectorId];
        // A point of another vector in the session: it becomes the edited layer and the drag moves the point.
        const other = extraVertexAt(p);
        if (other) {
            const list = [...vectorUi.get().extraVectors.filter((id) => id !== other.node.id), s.editingVectorId];
            vectorUi.set({ extraVectors: list });
            editor.set({ editingVectorId: other.node.id, selection: [other.node.id, ...list], vertices: [other.ref] });
            drag = { id: other.node.id, refs: [other.ref], base: editor.get().doc, start: toVectorSpace(s.doc, other.node, p.world) };
            return true;
        }
        if (!p.shiftKey || !primary) return false;
        // ⇧click on the edited layer's own points keeps adding to the point selection.
        if (hitVertex(s.doc, primary, s.camera, s.vertices, p.screen.x, p.screen.y)) return false;
        const hit = hitTest(s.doc, p.world.x, p.world.y, true);
        if (!editable(hit ?? undefined) || !hit || hit.id === primary.id || vectorUi.get().extraVectors.includes(hit.id)) return false;
        asVector(hit.id);
        const list = [...vectorUi.get().extraVectors, hit.id];
        vectorUi.set({ extraVectors: list });
        editor.set({ selection: [s.editingVectorId, ...list] });
        return true;
    },
    move(p) {
        if (!drag) return;
        const node = drag.base.nodes[drag.id];
        if (!node) return;
        const vec = toVectorSpace(drag.base, node, p.world);
        const patch = moveVertices(node, drag.refs, { x: vec.x - drag.start.x, y: vec.y - drag.start.y }, vec, p.altKey ? "none" : editor.get().handleMirror);
        editor.preview(applyCommand(drag.base, { type: "node.update", id: node.id, patch }));
    },
    up(p) {
        const d = drag;
        drag = null;
        if (!d) return;
        const node = d.base.nodes[d.id];
        if (!node) return;
        const vec = toVectorSpace(d.base, node, p.world);
        if (Math.hypot(vec.x - d.start.x, vec.y - d.start.y) * editor.get().camera.zoom < 2) {
            editor.preview(d.base);
            return;
        }
        const patch = moveVertices(node, d.refs, { x: vec.x - d.start.x, y: vec.y - d.start.y }, vec, p.altKey ? "none" : editor.get().handleMirror);
        editor.execute({ type: "node.update", id: node.id, patch }, d.base);
    },
    hover(p) {
        return extraVertexAt(p) ? "move" : undefined;
    },
    overlay(ctx) {
        const s = editor.get();
        for (const node of extras()) {
            const m = worldMatrix(s.doc, node);
            ctx.strokeStyle = HANDLE_BLUE;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const sub of placedSubpaths(node)) {
                const n = sub.points.length;
                const segs = sub.closed ? n : n - 1;
                const at = (q: { x: number; y: number }) => {
                    const w = apply(m, q.x, q.y);
                    return worldToScreen(s.camera, w.x, w.y);
                };
                const first = sub.points[0];
                if (!first) continue;
                const f = at(first);
                ctx.moveTo(f.x, f.y);
                for (let i = 0; i < segs; i++) {
                    const a = sub.points[i];
                    const b = sub.points[(i + 1) % n];
                    if (!a || !b) continue;
                    const pb = at(b);
                    if (!a.out && !b.in) ctx.lineTo(pb.x, pb.y);
                    else {
                        const c1 = at(a.out ?? a);
                        const c2 = at(b.in ?? b);
                        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, pb.x, pb.y);
                    }
                }
                if (sub.closed) ctx.closePath();
            }
            ctx.stroke();
            for (const v of screenVertices(s.doc, node, s.camera, [])) if (v.part === "anchor") drawSquare(ctx, v.x, v.y, 6);
        }
    },
});

// Enter with several shapes selected edits all of them.
addKeyHandler((event) => {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    const s = editor.get();
    if (s.editingVectorId || s.selection.length < 2) return false;
    const nodes = s.selection.map((id) => s.doc.nodes[id]);
    if (!nodes.every((n) => editable(n))) return false;
    const [first, ...rest] = s.selection as [string, ...string[]];
    for (const id of rest) asVector(id);
    enterVectorEdit(first);
    vectorUi.set({ extraVectors: rest });
    editor.set({ selection: [first, ...rest] });
    return true;
});

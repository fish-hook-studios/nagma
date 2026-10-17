import { booleanResult } from "./booleans";
import { editor } from "./store";
import type { BrushStroke, Command, CustomBrushDef, NagmaDocument, SceneNode } from "./types";
import { samplePath, shapeSubpaths } from "./vector";

// Custom brushes (Create brush): a closed shape becomes a stretch brush (pulled along the stroke)
// or a scatter brush (repeated along it). The file keeps a list on its first page; each stroke
// carries its brush's shape too, so a pasted stroke brings its brush along.

const MAX_POINTS = 600;

function outlineOf(doc: NagmaDocument, node: SceneNode): { x: number; y: number }[][] {
    const subs = node.type === "boolean" ? booleanResult(doc, node) : node.type === "vector" || node.type === "rect" || node.type === "ellipse" ? shapeSubpaths(node) : [];
    const closed = subs.filter((s) => s.closed && s.points.length > 1);
    const polys = samplePath(closed, 10).filter((p) => p.length > 2);
    const total = polys.reduce((n, p) => n + p.length, 0);
    if (total <= MAX_POINTS) return polys;
    const keep = Math.ceil(total / MAX_POINTS);
    return polys.map((p) => p.filter((_, i) => i % keep === 0)).filter((p) => p.length > 2);
}

export function canMakeBrush(doc: NagmaDocument, node: SceneNode | undefined): boolean {
    return Boolean(node && outlineOf(doc, node).length);
}

function normalise(polys: { x: number; y: number }[][], type: "stretch" | "scatter"): { x: number; y: number }[][] {
    const xs = polys.flatMap((p) => p.map((q) => q.x));
    const ys = polys.flatMap((p) => p.map((q) => q.y));
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(1e-6, Math.max(...xs) - x0);
    const h = Math.max(1e-6, Math.max(...ys) - y0);
    const r = (n: number) => Math.round(n * 10000) / 10000;
    if (type === "stretch") return polys.map((p) => p.map((q) => ({ x: r((q.x - x0) / w), y: r((q.y - y0) / h - 0.5) })));
    const size = Math.max(w, h);
    return polys.map((p) => p.map((q) => ({ x: r((q.x - x0 - w / 2) / size), y: r((q.y - y0 - h / 2) / size) })));
}

// The brushes this file knows: the saved list plus any carried by strokes in it.
export function customBrushes(doc: NagmaDocument): CustomBrushDef[] {
    const saved = doc.nodes[doc.roots[0] ?? ""]?.customBrushes ?? [];
    const seen = new Set(saved.map((b) => b.id));
    const out = [...saved];
    for (const n of Object.values(doc.nodes)) {
        const c = n.brushStroke?.custom;
        if (c && !seen.has(c.id)) {
            seen.add(c.id);
            out.push({ ...c, type: n.brushStroke?.type ?? "stretch" });
        }
    }
    return out;
}

export function customBrushStroke(def: CustomBrushDef): BrushStroke {
    const custom = { id: def.id, name: def.name, polys: def.polys };
    return def.type === "stretch"
        ? { type: "stretch", name: `custom:${def.id}`, direction: "forward", custom }
        : { type: "scatter", name: `custom:${def.id}`, gap: 1.2, wiggle: 0, sizeJitter: 0, angularJitter: 0, rotation: 0, custom };
}

export function createBrush(type: "stretch" | "scatter") {
    const { doc, selection } = editor.get();
    const node = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;
    if (!node) return;
    const outline = outlineOf(doc, node);
    if (!outline.length) {
        editor.notify("Brushes are made from a closed shape. Outline an open stroke first (⌥⌘O).");
        return;
    }
    const first = doc.roots[0];
    if (!first) return;
    const list = doc.nodes[first]?.customBrushes ?? [];
    const def: CustomBrushDef = { id: `${node.id}-${type}-${list.length + 1}`, name: node.name, type, polys: normalise(outline, type) };
    editor.execute({ type: "node.update", id: first, patch: { customBrushes: [...list, def] } });
    editor.notify(`${type === "stretch" ? "Stretch" : "Scatter"} brush "${node.name}" added to the brush menu.`);
}

export function deleteCustomBrush(id: string) {
    const { doc } = editor.get();
    const first = doc.roots[0];
    const list = first ? (doc.nodes[first]?.customBrushes ?? []) : [];
    if (first && list.some((b) => b.id === id)) editor.execute({ type: "node.update", id: first, patch: { customBrushes: list.filter((b) => b.id !== id) } });
}

// Pasting strokes that use custom brushes saves those brushes in this file.
export function registerBrushCommands(doc: NagmaDocument, nodes: SceneNode[]): Command[] {
    const first = doc.roots[0];
    if (!first) return [];
    const list = doc.nodes[first]?.customBrushes ?? [];
    const add: CustomBrushDef[] = [];
    for (const n of nodes) {
        const c = n.brushStroke?.custom;
        if (c && !list.some((b) => b.id === c.id) && !add.some((b) => b.id === c.id)) add.push({ ...c, type: n.brushStroke?.type ?? "stretch" });
    }
    return add.length ? [{ type: "node.update", id: first, patch: { customBrushes: [...list, ...add] } }] : [];
}

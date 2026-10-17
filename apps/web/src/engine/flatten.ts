import { areaOf } from "./booleans";
import { booleanPaths } from "./clip";
import { isFrameLike } from "./components";
import { makeNode, topLevel } from "./nodes";
import { solid } from "./paint";
import { editor } from "./store";
import { parentMatrix, spaceMatrix } from "./transform";
import type { Command, NagmaDocument, SceneNode, Subpath } from "./types";
import { fitPath, mapSubpaths, shapeSubpaths } from "./vector";

// Flatten (⌘E, ⌥⇧F in point editing): the selection becomes one vector layer with the combined
// geometry. Shapes keep their own outlines as separate paths (filled together), booleans and groups
// give their combined shape, and text gives its outline. A single rectangle, ellipse or vector keeps
// its layer and just turns into a vector.

function stackOrder(doc: NagmaDocument, ids: string[]): string[] {
    const order = new Map<string, number>();
    let i = 0;
    const visit = (list: string[]) => {
        for (const id of list) {
            order.set(id, i++);
            visit(doc.nodes[id]?.children ?? []);
        }
    };
    visit(doc.roots);
    return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

// A layer's geometry in the space of `parentId` (the flattened layer's parent).
function geometryIn(doc: NagmaDocument, node: SceneNode, parentId: string | null, normalize: boolean): Subpath[] {
    let area: Subpath[];
    if (node.type === "vector" || node.type === "rect" || node.type === "ellipse") {
        // Open paths stay open; closed ones are turned the same way so they fill together.
        const own = areaOf(doc, node);
        const open = own.filter((s) => !s.closed);
        const closed = own.filter((s) => s.closed);
        area = [...(normalize && closed.length ? booleanPaths("union", [closed]) : closed), ...open];
    } else area = areaOf(doc, node);
    const toWorld = parentMatrix(doc, node);
    const toTarget = spaceMatrix(doc, parentId).inverse().multiply(toWorld);
    if (toTarget.isIdentity) return area;
    return mapSubpaths(area, (p) => {
        const q = toTarget.transformPoint(new DOMPoint(p.x, p.y));
        return { x: q.x, y: q.y };
    });
}

export function flattenNodes(doc: NagmaDocument, ids: string[]): { commands: Command[]; id: string } | null {
    const ordered = stackOrder(doc, topLevel(doc, ids)).filter((id) => {
        const n = doc.nodes[id];
        return n && n.type !== "page" && !isFrameLike(n);
    });
    if (!ordered.length) return null;
    const single = ordered.length === 1 ? doc.nodes[ordered[0] as string] : undefined;
    if (single && (single.type === "rect" || single.type === "ellipse")) {
        return { commands: [{ type: "node.convert", id: single.id, to: "vector", path: fitPath(shapeSubpaths(single)).path }], id: single.id };
    }
    if (single?.type === "vector") return null;
    const top = doc.nodes[ordered[ordered.length - 1] as string] as SceneNode;
    const parentId = top.parentId;
    const subpaths = ordered.flatMap((id) => geometryIn(doc, doc.nodes[id] as SceneNode, parentId, ordered.length > 1));
    if (!subpaths.length) return null;
    const fitted = fitPath(subpaths);
    // The vector keeps the top layer's look (text has no stroke, so it keeps its fill).
    const node = makeNode(doc, "vector", { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }, parentId, {
        // The exact box of the geometry: rounding it to the pixel grid would stretch the path.
        x: fitted.x,
        y: fitted.y,
        w: fitted.w,
        h: fitted.h,
        name: single ? single.name : "Vector",
        path: fitted.path,
        fills: top.type === "group" ? [solid("#D9D9D9")] : top.fills,
        strokes: top.strokes,
        strokeWidth: top.strokeWidth,
        strokeAlign: top.strokeAlign,
        strokeCap: top.strokeCap,
        strokeJoin: top.strokeJoin,
        dash: top.dash ?? null,
        opacity: top.opacity,
        blendMode: top.blendMode,
        shadow: top.shadow,
        effects: top.effects,
        blur: top.blur,
        constraints: top.constraints,
    });
    const siblings = parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots;
    const index = siblings.indexOf(top.id) + 1;
    return { commands: [{ type: "node.create", node, index }, { type: "node.delete", ids: ordered }], id: node.id };
}

export function flattenSelection() {
    const { doc, selection } = editor.get();
    if (!selection.length) return;
    if (selection.some((id) => doc.nodes[id]?.sourceId)) {
        editor.notify("Layers inside an instance can't be flattened. Detach the instance first.");
        return;
    }
    const result = flattenNodes(doc, selection);
    if (!result) {
        if (!selection.some((id) => doc.nodes[id]?.type === "vector")) editor.notify("Select shapes, text, groups or booleans to flatten. Frames stay frames.");
        return;
    }
    editor.execute({ type: "batch", commands: result.commands });
    editor.set({ selection: [result.id] });
}

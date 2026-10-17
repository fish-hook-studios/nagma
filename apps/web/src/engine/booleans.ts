import { loadTextOutlines, textToSubpaths } from "./font-outlines";
import { booleanPaths } from "./clip";
import { localMatrix } from "./transform";
import type { BooleanOp, NagmaDocument, SceneNode, Subpath } from "./types";
import { booleanContains, mapSubpaths, pathContains, rectSubpaths, shapeSubpaths } from "./vector";

// Text in a boolean, a flatten or an outlined SVG. Glyph outlines need a font parser; until one is
// available the text's box stands in for its letters, so a boolean with text still has the right
// extent. When a glyph helper lands, return its outlines here and make hasGlyphOutlines true.
export function hasGlyphOutlines(): boolean {
    return true;
}

// Text takes part by its letters (engine/font-outlines.ts). Until its font file has loaded, the
// text's box stands in, and the load is started so the next change uses the real outlines.
const requested = new Set<string>();
export function textSubpaths(node: SceneNode): Subpath[] {
    const glyphs = textToSubpaths(node);
    if (glyphs && glyphs.length) return glyphs;
    const key = `${node.fontFamily}|${node.fontWeight}|${node.italic}`;
    if (!requested.has(key)) {
        requested.add(key);
        void loadTextOutlines(node).catch(() => undefined);
    }
    return rectSubpaths(node.x, node.y, node.w, node.h, [0, 0, 0, 0]);
}

function toPoint(m: DOMMatrix, p: { x: number; y: number }) {
    const q = m.transformPoint(new DOMPoint(p.x, p.y));
    return { x: q.x, y: q.y };
}

// One layer's filled area in its parent's space (its own rotation and flips applied). Groups give
// the union of their children; booleans give their own result.
export function areaOf(doc: NagmaDocument, child: SceneNode): Subpath[] {
    const m = localMatrix(child);
    const place = (subpaths: Subpath[]) => (m.isIdentity ? subpaths : mapSubpaths(subpaths, (p) => toPoint(m, p)));
    if (child.type === "boolean") return place(booleanResult(doc, child));
    if (child.type === "group" || child.type === "frame" || child.type === "component" || child.type === "instance") {
        const parts = child.children
            .map((id) => doc.nodes[id])
            .filter((c): c is SceneNode => Boolean(c && c.visible))
            .map((c) => areaOf(doc, c))
            .filter((s) => s.length);
        const own = child.type === "group" ? [] : [shapeSubpaths(child)];
        const all = [...own, ...parts];
        if (!all.length) return [];
        return place(all.length === 1 ? (all[0] as Subpath[]) : booleanPaths("union", all));
    }
    if (child.type === "text") return place(textSubpaths(child));
    return place(shapeSubpaths(child));
}

// Each child's outline in the boolean's space, bottom to top.
export function booleanShapes(doc: NagmaDocument, node: SceneNode): Subpath[][] {
    return node.children.flatMap((id) => {
        const child = doc.nodes[id];
        if (!child || !child.visible) return [];
        const area = areaOf(doc, child);
        return area.length ? [area] : [];
    });
}

// Results are cached until the boolean or anything inside it changes (documents are immutable,
// so "changed" means "a different object").
const cache = new Map<string, { deps: SceneNode[]; op: BooleanOp; result: Subpath[] }>();

function dependencies(doc: NagmaDocument, node: SceneNode, out: SceneNode[] = []): SceneNode[] {
    for (const id of node.children) {
        const child = doc.nodes[id];
        if (!child) continue;
        out.push(child);
        dependencies(doc, child, out);
    }
    return out;
}

// The boolean's combined shape as real paths, in the boolean's own space.
export function booleanResult(doc: NagmaDocument, node: SceneNode): Subpath[] {
    const op = node.booleanOp ?? "union";
    const deps = dependencies(doc, node);
    const hit = cache.get(node.id);
    if (hit && hit.op === op && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.result;
    let result: Subpath[] = [];
    try {
        result = booleanPaths(op, booleanShapes(doc, node));
    } catch (error) {
        console.error("Boolean failed", error);
    }
    cache.set(node.id, { deps, op, result });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return result;
}

// Whether a point in the boolean's space is inside the combined shape.
export function booleanHit(doc: NagmaDocument, node: SceneNode, x: number, y: number): boolean {
    const result = booleanResult(doc, node);
    if (result.length) return pathContains(result, x, y, 0);
    const hits = booleanShapes(doc, node).map((subpaths) => pathContains(subpaths, x, y, 0));
    return booleanContains(node.booleanOp ?? "union", hits);
}

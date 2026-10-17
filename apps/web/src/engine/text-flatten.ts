import { loadTextOutlines, textOutlines } from "./font-outlines";
import { makeNode } from "./nodes";
import { editor } from "./store";
import type { Command, SceneNode } from "./types";
import { fitPath } from "./vector";

// Flatten on text (⌘E, ⌥⇧F, Object › Flatten): each text layer becomes a vector of its glyph
// outlines, read from the font files, in the same place, size, rotation and look. Text with more
// than one fill becomes a group with a vector per fill.

const NAME_KEYS: (keyof SceneNode)[] = ["opacity", "blendMode", "rotation", "flipX", "flipY", "strokes", "strokeWidth", "strokeAlign", "shadow", "blur", "effects", "constraints", "visible", "locked", "isMask", "maskType", "animation", "interactions", "exportSettings", "positioning"];

export async function flattenText(ids: string[]): Promise<void> {
    const start = editor.get().doc;
    const texts = ids.map((id) => start.nodes[id]).filter((n): n is SceneNode => Boolean(n) && n.type === "text");
    if (!texts.length) return;
    const loaded = await Promise.all(texts.map(loadTextOutlines));
    if (loaded.some((ok) => !ok)) {
        editor.notify("Some fonts couldn't be loaded, so that text wasn't flattened.");
    }
    const doc = editor.get().doc;
    const commands: Command[] = [];
    const created: string[] = [];
    let working = doc;
    texts.forEach((stale, i) => {
        const node = doc.nodes[stale.id];
        if (!node || !loaded[i]) return;
        const groups = textOutlines(node);
        if (!groups?.length || !groups.some((g) => g.subpaths.length)) return;
        const keep = Object.fromEntries(NAME_KEYS.filter((k) => node[k] !== undefined).map((k) => [k, node[k]])) as Partial<SceneNode>;
        const siblings = node.parentId ? (doc.nodes[node.parentId]?.children ?? []) : doc.roots;
        const index = siblings.indexOf(node.id);
        const vectors = groups
            .filter((g) => g.subpaths.length)
            .map((g) => {
                const fitted = fitPath(g.subpaths);
                // Rotation turns about the layer's centre; keep the text's centre so the glyphs stay put.
                const v = makeNode(working, "vector", { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }, node.parentId, { name: node.name, path: fitted.path, fills: g.fills, ...keep });
                working = { ...working, nodes: { ...working.nodes, [v.id]: v } };
                return v;
            });
        const pivot = (v: SceneNode): SceneNode => {
            if (!node.rotation && !node.flipX && !node.flipY) return v;
            // The text rotated about its own centre; place the vector so it rotates about the same point.
            const cx = node.x + node.w / 2;
            const cy = node.y + node.h / 2;
            const vx = v.x + v.w / 2 - cx;
            const vy = v.y + v.h / 2 - cy;
            const a = (node.rotation * Math.PI) / 180;
            const sx = node.flipX ? -1 : 1;
            const sy = node.flipY ? -1 : 1;
            const rx = Math.cos(a) * vx * sx - Math.sin(a) * vy * sy;
            const ry = Math.sin(a) * vx * sx + Math.cos(a) * vy * sy;
            return { ...v, x: cx + rx - v.w / 2, y: cy + ry - v.h / 2 };
        };
        if (vectors.length === 1) {
            const v = pivot(vectors[0] as SceneNode);
            commands.push({ type: "node.create", node: v, index });
            created.push(v.id);
        } else {
            const group = makeNode(working, "group", { x: node.x, y: node.y, w: node.w, h: node.h }, node.parentId, { name: node.name, ...keep, rotation: 0, flipX: false, flipY: false });
            working = { ...working, nodes: { ...working.nodes, [group.id]: group } };
            commands.push({ type: "node.create", node: group, index });
            for (const v of vectors) commands.push({ type: "node.create", node: { ...pivot(v), parentId: group.id, opacity: 1, effects: undefined, shadow: null, blur: 0 } });
            created.push(group.id);
        }
        commands.push({ type: "node.delete", ids: [node.id] });
    });
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created });
}

import { resizeChildren } from "../engine/constraints";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, NodePatch, SceneNode } from "../engine/types";
import { ASSET_GAP, assetData, copyAsset, createCommands, executeArranged, presetFor } from "./model";

// "Resize to…": a copy of an asset in another size, next to it in its row. Auto-layout frames
// reflow by themselves (fill and hug children take up the new space); other frames move their
// layers by their constraints. Type, padding, gaps and corners scale with the shorter side, so a
// square post becomes a story with the same text size and a banner with smaller type.

export function resizedCopy(nodes: SceneNode[], w: number, h: number): SceneNode[] {
    const root = nodes[0];
    if (!root) return nodes;
    const k = Math.min(w / root.w, h / root.h);
    const byId: Record<string, SceneNode> = {};
    for (const node of nodes) byId[node.id] = { ...node };
    const scaleNode = (node: SceneNode): SceneNode => {
        const next: SceneNode = { ...node };
        if (node.fontSize) next.fontSize = Math.max(6, Math.round(node.fontSize * k));
        if (node.spans?.length) next.spans = node.spans.map((s) => (s.fontSize ? { ...s, fontSize: Math.max(6, Math.round(s.fontSize * k)) } : s));
        if (node.radius && node.radius < 900) next.radius = Math.round(node.radius * k);
        if (node.strokeWidth && node.strokes.length) next.strokeWidth = Math.max(1, node.strokeWidth * k);
        if (node.layout) {
            next.layout = {
                ...node.layout,
                gap: Math.round(node.layout.gap * k),
                padding: node.layout.padding.map((p) => Math.round(p * k)) as [number, number, number, number],
            };
        }
        return next;
    };
    // Layers inside auto layout that keep their own size scale with the type.
    const insideLayout = (node: SceneNode) => Boolean(node.parentId && byId[node.parentId]?.layout && node.positioning !== "absolute");
    for (const node of nodes) {
        if (node.id === root.id) continue;
        let next = scaleNode(byId[node.id] as SceneNode);
        if (insideLayout(node)) {
            if (node.sizing.h === "fixed") next = { ...next, w: Math.max(1, Math.round(node.w * k)) };
            if (node.sizing.v === "fixed") next = { ...next, h: Math.max(1, Math.round(node.h * k)) };
        }
        byId[node.id] = next;
    }
    let from = { x: root.x, y: root.y, w: root.w, h: root.h };
    const to = { x: root.x, y: root.y, w, h };
    byId[root.id] = { ...scaleNode(root), w, h };
    if (!root.layout) {
        // Without auto layout the layers first scale with the type (their places and sizes, so a
        // 14px line in a 133px box doesn't become 50px type in the same box), then follow their
        // constraints from that scaled frame into the new shape.
        if (k !== 1) {
            for (const node of nodes) {
                if (node.id === root.id) continue;
                const cur = byId[node.id] as SceneNode;
                const own = insideLayout(node) ? {} : { w: Math.max(1, cur.w * k), h: Math.max(1, cur.h * k) };
                byId[node.id] = { ...cur, x: root.x + (cur.x - root.x) * k, y: root.y + (cur.y - root.y) * k, ...own };
            }
            from = { ...from, w: root.w * k, h: root.h * k };
        }
        resizeChildren(byId, root.id, from, to);
    }
    return nodes.map((n) => byId[n.id] as SceneNode);
}

export function resizeAsset(assetId: string, targets: { presetId: string; w: number; h: number }[]) {
    const doc = editor.get().doc;
    const source = doc.nodes[assetId];
    const data = assetData(source);
    if (!source || !data) return;
    const commands = [];
    const created: string[] = [];
    let x = source.x + source.w + ASSET_GAP / 2;
    for (const target of targets) {
        const label = presetFor(target.presetId)?.label ?? `${target.w} × ${target.h}`;
        const copies = copyAsset(doc, assetId, { x, y: source.y }, { rowId: data.rowId, preset: target.presetId, sourceId: data.template ? source.id : (data.sourceId ?? null), bulkIndex: null }, `${source.name} · ${label}`);
        if (!copies.length) continue;
        const resized = resizedCopy(copies, target.w, target.h);
        // Side by side after the source, in the order asked for (the grid tidies the spacing).
        x += 1;
        created.push(resized[0]?.id ?? "");
        commands.push(...createCommands(resized));
    }
    if (commands.length) executeArranged(commands, created);
}

// The updates that resize an asset in place (its layers reflow like Resize to… does).
export function resizeCommands(doc: NagmaDocument, assetId: string, presetId: string): Command[] {
    const asset = doc.nodes[assetId];
    const preset = presetFor(presetId);
    const data = assetData(asset);
    if (!asset || !preset || !data) return [];
    const nodes: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        nodes.push(n);
        for (const c of n.children) visit(c);
    };
    visit(asset.id);
    const resized = resizedCopy(nodes, preset.w, preset.h);
    // The root goes first; its layers' own updates then put each one where the reflow wants it.
    return resized.map((n) => {
        const patch: NodePatch = Object.fromEntries(Object.entries(n).filter(([k]) => k !== "id" && k !== "type" && k !== "parentId" && k !== "children"));
        if (n.id === asset.id) patch.campaign = { ...data, preset: presetId };
        return { type: "node.update" as const, id: n.id, patch };
    });
}

export function resizeInPlace(assetId: string, presetId: string) {
    const commands = resizeCommands(editor.get().doc, assetId, presetId);
    if (commands.length) executeArranged(commands);
}

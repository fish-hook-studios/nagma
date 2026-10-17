import { nanoid } from "nanoid";
import { viewCenter } from "../engine/actions";
import { applyCommand } from "../engine/commands";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { myName } from "./actions";
import { postEditFixes } from "./connectors";
import { makeConnector, makeShapeNode, makeSticky } from "./model";
import type { Side } from "./types";

// Mind maps: a central topic with branches, joined by connectors marked as mind map lines. Adding a
// branch (⌘ Return, ⌘ ⇧ Return), or dropping a sticky or shape onto a topic, tidies the map: each
// topic's branches stack on its side, centred on it.

export type MindMapStyle = "boxes" | "stickies" | "simple";

export const MIND_MAP_STYLES: { style: MindMapStyle; label: string; colors: string[] }[] = [
    { style: "boxes", label: "Boxes", colors: ["#E4CCFF", "#C2E5FF", "#CDF4D3"] },
    { style: "stickies", label: "Stickies", colors: ["#FFE299", "#A8DAFF", "#B3EFBD"] },
    { style: "simple", label: "Simple", colors: ["#FFFFFF", "#FFFFFF", "#FFFFFF"] },
];

const GAP_X = 80;
const GAP_Y = 24;

const isMindLine = (n: SceneNode | undefined) => n?.jam?.kind === "connector" && Boolean(n.jam.mind);

function edges(doc: NagmaDocument) {
    const out: { from: string; to: string }[] = [];
    for (const n of Object.values(doc.nodes)) if (isMindLine(n) && n.jam?.kind === "connector" && n.jam.start.id && n.jam.end.id) out.push({ from: n.jam.start.id, to: n.jam.end.id });
    return out;
}

// Whether a layer is a topic in a mind map.
export function inMindMap(doc: NagmaDocument, id: string): boolean {
    return edges(doc).some((e) => e.from === id || e.to === id);
}

// Moves to tidy the mind map that `id` belongs to (its root stays put).
export function layoutCommands(doc: NagmaDocument, id: string): Command[] {
    const all = edges(doc).filter((e) => doc.nodes[e.from] && doc.nodes[e.to]);
    let root = id;
    const seen = new Set<string>();
    for (let parent = all.find((e) => e.to === root); parent && !seen.has(parent.from); parent = all.find((e) => e.to === root)) {
        seen.add(root);
        root = parent.from;
    }
    const kids = (n: string) => all.filter((e) => e.to !== root && e.from === n).map((e) => e.to);
    const box = (n: string) => worldBounds(doc, doc.nodes[n] as SceneNode);
    const placed = new Map<string, { x: number; y: number }>();
    const visiting = new Set<string>();
    const height = (n: string): number => {
        if (visiting.has(n)) return 0;
        visiting.add(n);
        const k = kids(n);
        const h = Math.max(box(n).h, k.reduce((a, c) => a + height(c), 0) + GAP_Y * Math.max(0, k.length - 1));
        visiting.delete(n);
        return h;
    };
    const byY = (list: string[]) => list.sort((a, b) => box(a).y + box(a).h / 2 - (box(b).y + box(b).h / 2));
    const place = (list: string[], edgeX: number, cy: number, side: "left" | "right") => {
        const sizes = list.map((c) => height(c));
        const total = sizes.reduce((a, b) => a + b, 0) + GAP_Y * Math.max(0, list.length - 1);
        let y = cy - total / 2;
        list.forEach((c, i) => {
            const b = box(c);
            const ccy = y + (sizes[i] ?? 0) / 2;
            const x = side === "right" ? edgeX : edgeX - b.w;
            if (!placed.has(c)) {
                placed.set(c, { x, y: ccy - b.h / 2 });
                place(byY(kids(c)), side === "right" ? x + b.w + GAP_X : x - GAP_X, ccy, side);
            }
            y += (sizes[i] ?? 0) + GAP_Y;
        });
    };
    const r = box(root);
    const rcx = r.x + r.w / 2;
    const first = kids(root);
    const right = byY(first.filter((c) => box(c).x + box(c).w / 2 >= rcx));
    const left = byY(first.filter((c) => box(c).x + box(c).w / 2 < rcx));
    placed.set(root, { x: r.x, y: r.y });
    place(right, r.x + r.w + GAP_X, r.y + r.h / 2, "right");
    place(left, r.x - GAP_X, r.y + r.h / 2, "left");
    const commands: Command[] = [];
    for (const [n, at] of placed) {
        const node = doc.nodes[n];
        if (!node || n === root) continue;
        const b = box(n);
        const dx = at.x - b.x;
        const dy = at.y - b.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) commands.push({ type: "node.update", id: n, patch: { x: node.x + dx, y: node.y + dy } });
    }
    // Branch lines leave the side facing their branch.
    for (const line of Object.values(doc.nodes)) {
        if (!isMindLine(line) || line.jam?.kind !== "connector" || !line.jam.start.id || !line.jam.end.id) continue;
        const from = placed.get(line.jam.start.id);
        const to = placed.get(line.jam.end.id);
        if (!from || !to) continue;
        const sideOut: Side = to.x >= from.x ? "right" : "left";
        const sideIn: Side = sideOut === "right" ? "left" : "right";
        if (line.jam.start.side !== sideOut || line.jam.end.side !== sideIn) commands.push({ type: "node.update", id: line.id, patch: { jam: { ...line.jam, start: { ...line.jam.start, side: sideOut }, end: { ...line.jam.end, side: sideIn } } } });
    }
    return commands;
}

// Tidies the map `id` is in, folded into the last undo step.
export function tidyMindMap(id: string) {
    const commands = layoutCommands(editor.get().doc, id);
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.mergeLast();
}

function topic(doc: NagmaDocument, style: MindMapStyle, text: string, x: number, y: number, color: string, page: string, root = false): SceneNode {
    if (style === "stickies") return { ...makeSticky(doc, x - 120, y - 120, color, page, myName()), text, name: text };
    const w = root ? 240 : 200;
    const h = root ? 100 : 72;
    const shape = makeShapeNode(doc, "rounded", { x: x - w / 2, y: y - h / 2, w, h }, color, page);
    if (style === "simple") return { ...shape, text, name: text, fills: [], strokes: root ? [solid("#1E1E1E")] : [], fontSize: root ? 24 : 18 };
    return { ...shape, text, name: text, fontSize: root ? 24 : 16 };
}

// A new mind map in the middle of the view: a central topic and four branches, tidied.
export function insertMindMap(style: MindMapStyle = "boxes") {
    const s = editor.get();
    const c = viewCenter();
    const page = s.pageId;
    const colors = style === "boxes" ? ["#C2E5FF", "#CDF4D3", "#FFE0C2", "#FFC2EC"] : style === "stickies" ? ["#A8DAFF", "#B3EFBD", "#FFD3A8", "#FFA8DB"] : ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"];
    const root = topic(s.doc, style, "Central topic", c.x, c.y, style === "boxes" ? "#E4CCFF" : style === "stickies" ? "#FFE299" : "#FFFFFF", page, true);
    const nodes: SceneNode[] = [root];
    [[1, -1], [1, 1], [-1, -1], [-1, 1]].forEach(([sx, sy], i) => {
        const b = topic(s.doc, style, "Idea", c.x + (sx ?? 1) * 360, c.y + (sy ?? 1) * 120, colors[i] ?? "#FFFFFF", page);
        const right = (sx ?? 1) > 0;
        const line = makeConnector(s.doc, { id: root.id, side: right ? "right" : "left", x: 0, y: 0 }, { id: b.id, side: right ? "left" : "right", x: 0, y: 0 }, style === "stickies" ? "elbow" : "curved", "#757575", page, { start: "none", end: "none" });
        nodes.push(b, line.jam?.kind === "connector" ? { ...line, jam: { ...line.jam, mind: true } } : line);
    });
    editor.execute({ type: "batch", commands: nodes.map((node) => ({ type: "node.create" as const, node })) });
    tidyMindMap(root.id);
    editor.set({ selection: [root.id] });
}

// Dropping a sticky or shape onto a topic makes it a branch of that topic.
function attachDropped(before: NagmaDocument, after: NagmaDocument): Command[] {
    for (const node of Object.values(after.nodes)) {
        const prev = before.nodes[node.id];
        if (!prev || (prev.x === node.x && prev.y === node.y) || (node.jam?.kind !== "sticky" && node.jam?.kind !== "shape")) continue;
        const all = edges(after);
        if (all.some((e) => e.to === node.id || e.from === node.id)) continue;
        const b = worldBounds(after, node);
        const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const target = Object.values(after.nodes).find((t) => {
            if (t.id === node.id || !all.some((e) => e.from === t.id || e.to === t.id)) return false;
            const tb = worldBounds(after, t);
            return c.x >= tb.x && c.x <= tb.x + tb.w && c.y >= tb.y && c.y <= tb.y + tb.h;
        });
        if (!target) continue;
        const like = Object.values(after.nodes).find((n) => isMindLine(n) && n.jam?.kind === "connector" && (n.jam.start.id === target.id || n.jam.end.id === target.id));
        if (like?.jam?.kind !== "connector") continue;
        const tb = worldBounds(after, target);
        const right = c.x >= tb.x + tb.w / 2;
        const line: SceneNode = { ...like, id: nanoid(10), text: "", jam: { ...like.jam, start: { id: target.id, side: right ? "right" : "left", x: 0, y: 0 }, end: { id: node.id, side: right ? "left" : "right", x: 0, y: 0 }, labelAt: undefined, coords: undefined, axis: undefined } };
        // Put it beside the topic first, then tidy.
        const nudge: Command = { type: "node.update", id: node.id, patch: { x: node.x + (right ? tb.x + tb.w + GAP_X - b.x : tb.x - GAP_X - b.w - b.x), y: node.y } };
        const create: Command = { type: "node.create", node: line };
        const next = applyCommand(applyCommand(after, nudge), create);
        return [nudge, create, ...layoutCommands(next, node.id)];
    }
    return [];
}

postEditFixes.push(attachDropped);

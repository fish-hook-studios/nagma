import { rehome } from "./actions";
import { applyCommand } from "./commands";
import { isFrameLike } from "./components";
import { makeNode, topLevel } from "./nodes";
import { editor } from "./store";
import { worldBounds } from "./transform";
import type { AutoLayout, Command, NagmaDocument, Rect, SceneNode } from "./types";

// Suggest auto layout (⌃⇧A): reads how the selection's layers already sit and turns frames and
// groups into auto layout that keeps them in place: the direction from how they line up, the gap
// from the spaces between them, padding from the insets, alignment from shared edges. Layers in
// several rows become a vertical stack of horizontal rows. Works bottom-up through nested layers.

const TOL = 1.5;

interface Work {
    doc: NagmaDocument;
    commands: Command[];
}

function run(w: Work, command: Command) {
    w.doc = applyCommand(w.doc, command);
    w.commands.push(command);
}

function kidsOf(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    return node.children.map((id) => doc.nodes[id]).filter((c): c is SceneNode => Boolean(c && c.visible && c.positioning !== "absolute"));
}

// Whether the boxes follow one another along an axis without overlapping.
function inLine(boxes: Rect[], vertical: boolean): boolean {
    const sorted = [...boxes].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
    for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i - 1] as Rect;
        const n = sorted[i] as Rect;
        if (vertical ? n.y < p.y + p.h - TOL : n.x < p.x + p.w - TOL) return false;
    }
    return true;
}

function boundsOf(boxes: Rect[]): Rect {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// Shared left/top, centre or right/bottom edges across the stack.
function crossAlign(boxes: Rect[], vertical: boolean): AutoLayout["counter"] {
    const near = (vals: number[]) => Math.max(...vals) - Math.min(...vals) <= TOL;
    const start = boxes.map((b) => (vertical ? b.x : b.y));
    const mid = boxes.map((b) => (vertical ? b.x + b.w / 2 : b.y + b.h / 2));
    const end = boxes.map((b) => (vertical ? b.x + b.w : b.y + b.h));
    if (near(start)) return "start";
    if (near(mid)) return "center";
    if (near(end)) return "end";
    return "start";
}

// Rows of layers that share vertical space, top to bottom.
function rowsOf(items: { id: string; box: Rect }[]): { id: string; box: Rect }[][] {
    const sorted = [...items].sort((a, b) => a.box.y - b.box.y);
    const rows: { id: string; box: Rect; bottom: number }[][] = [];
    let bottom = -Infinity;
    for (const it of sorted) {
        const row = rows[rows.length - 1];
        if (row && it.box.y < bottom - TOL) {
            row.push({ ...it, bottom: it.box.y + it.box.h });
            bottom = Math.max(bottom, it.box.y + it.box.h);
        } else {
            rows.push([{ ...it, bottom: it.box.y + it.box.h }]);
            bottom = it.box.y + it.box.h;
        }
    }
    return rows;
}

// Gives one container auto layout from its children's placement. `owned` containers were made
// here (or were groups), so they hug their content.
function layoutContainer(w: Work, id: string, owned: boolean): boolean {
    const node = w.doc.nodes[id];
    if (!node || node.layout || !isFrameLike(node) || node.isSection || node.type === "instance") return false;
    const kids = kidsOf(w.doc, node);
    if (!kids.length || kids.some((k) => k.rotation % 90 !== 0)) return false;
    const items = kids.map((k) => ({ id: k.id, box: worldBounds(w.doc, k) }));
    const boxes = items.map((i) => i.box);
    const row = inLine(boxes, false);
    const col = inLine(boxes, true);
    let vertical: boolean;
    if (row && col) {
        const spread = (pick: (b: Rect) => number) => Math.max(...boxes.map(pick)) - Math.min(...boxes.map(pick));
        vertical = spread((b) => b.y + b.h / 2) >= spread((b) => b.x + b.w / 2);
    } else if (row || col) vertical = col;
    else {
        // Several rows: each row becomes a horizontal stack inside a vertical one.
        const rows = rowsOf(items);
        if (rows.length < 2 || rows.some((r) => !inLine(r.map((i) => i.box), false))) return false;
        rows.forEach((r) => {
            if (r.length < 2) return;
            const b = boundsOf(r.map((i) => i.box));
            const index = Math.min(...r.map((i) => w.doc.nodes[node.id]?.children.indexOf(i.id) ?? 0));
            const frame = makeNode(w.doc, "frame", b, node.id, { name: "Row", fills: [], clip: false });
            run(w, { type: "node.create", node: frame, index });
            const ordered = [...r].sort((a, c) => a.box.x - c.box.x);
            ordered.forEach((it, k) => rehome(w.doc, it.id, frame.id, k).forEach((c) => run(w, c)));
            layoutContainer(w, frame.id, true);
        });
        return layoutContainer(w, node.id, owned);
    }
    const sorted = [...items].sort((a, b) => (vertical ? a.box.y - b.box.y : a.box.x - b.box.x));
    const spaces: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const p = (sorted[i - 1] as { box: Rect }).box;
        const n = (sorted[i] as { box: Rect }).box;
        spaces.push(vertical ? n.y - (p.y + p.h) : n.x - (p.x + p.w));
    }
    const gap = spaces.length ? Math.max(0, Math.round(spaces.reduce((a, b) => a + b, 0) / spaces.length)) : 0;
    const outer = worldBounds(w.doc, node);
    const inner = boundsOf(boxes);
    const padding: AutoLayout["padding"] = owned
        ? [0, 0, 0, 0]
        : [Math.max(0, Math.round(inner.y - outer.y)), Math.max(0, Math.round(outer.x + outer.w - (inner.x + inner.w))), Math.max(0, Math.round(outer.y + outer.h - (inner.y + inner.h))), Math.max(0, Math.round(inner.x - outer.x))];
    // Even spacing reads as a fixed gap; uneven spacing that fills the frame reads as space between.
    const even = spaces.every((s) => Math.abs(s - gap) <= TOL * 2);
    const primary: AutoLayout["primary"] = even || owned ? "start" : "between";
    const counter = crossAlign(boxes, vertical);
    sorted.forEach((it, k) => run(w, { type: "node.reparent", id: it.id, parentId: node.id, index: k }));
    run(w, {
        type: "node.update",
        id: node.id,
        patch: { layout: { direction: vertical ? "vertical" : "horizontal", gap, padding, primary, counter }, sizing: owned ? { h: "hug", v: "hug" } : { h: "fixed", v: "fixed" } },
    });
    return true;
}

// A group's children move into a frame in the group's place, so they can be laid out.
function groupToFrame(w: Work, id: string): string | null {
    const group = w.doc.nodes[id];
    if (!group || group.type !== "group" || !group.parentId) return null;
    const parent = w.doc.nodes[group.parentId];
    const index = parent?.children.indexOf(group.id) ?? 0;
    const frame = makeNode(w.doc, "frame", worldBounds(w.doc, group), group.parentId, { name: group.name, fills: [], clip: false });
    run(w, { type: "node.create", node: frame, index });
    [...group.children].forEach((child, k) => rehome(w.doc, child, frame.id, k).forEach((c) => run(w, c)));
    return frame.id;
}

function visit(w: Work, id: string): void {
    let node = w.doc.nodes[id];
    if (!node || node.type === "instance" || node.type === "boolean" || node.sourceId) return;
    let owned = false;
    if (node.type === "group") {
        const frameId = groupToFrame(w, id);
        if (!frameId) return;
        node = w.doc.nodes[frameId];
        owned = true;
        if (!node) return;
    }
    for (const child of [...node.children]) {
        const c = w.doc.nodes[child];
        if (c && c.children.length && (c.type === "group" || isFrameLike(c))) visit(w, child);
    }
    layoutContainer(w, node.id, owned);
}

export function suggestAutoLayout() {
    const { doc, selection } = editor.get();
    const ids = topLevel(doc, selection);
    if (!ids.length) return;
    const w: Work = { doc, commands: [] };
    let targets = ids;
    // Loose layers get a frame around them first.
    if (ids.length > 1 || (ids[0] && !isFrameLike(doc.nodes[ids[0]] as SceneNode) && doc.nodes[ids[0]]?.type !== "group")) {
        const first = doc.nodes[ids[0] ?? ""];
        const parentId = first?.parentId ?? null;
        if (!first || ids.some((id) => doc.nodes[id]?.parentId !== parentId)) {
            editor.notify("Select layers in the same frame to suggest auto layout.");
            return;
        }
        const b = boundsOf(ids.map((id) => worldBounds(doc, doc.nodes[id] as SceneNode)));
        const parent = parentId ? doc.nodes[parentId] : undefined;
        const index = Math.max(...ids.map((id) => parent?.children.indexOf(id) ?? 0)) + 1;
        const frame = makeNode(doc, "frame", b, parentId, { name: "Frame", fills: [], clip: false });
        run(w, { type: "node.create", node: frame, index });
        ids.forEach((id, k) => rehome(w.doc, id, frame.id, k).forEach((c) => run(w, c)));
        visit(w, frame.id);
        const made = w.doc.nodes[frame.id];
        if (made && !made.layout) layoutContainer(w, frame.id, true);
        targets = [frame.id];
    } else {
        for (const id of ids) {
            const node = w.doc.nodes[id];
            if (node?.layout) for (const child of node.children) visit(w, child);
            else visit(w, id);
        }
        targets = ids.map((id) => (w.doc.nodes[id] ? id : null)).filter((id): id is string => Boolean(id));
    }
    if (!w.commands.length) {
        editor.notify("No auto layout to suggest: the layers overlap.");
        return;
    }
    editor.execute({ type: "batch", commands: w.commands });
    if (targets.length) editor.set({ selection: targets });
}

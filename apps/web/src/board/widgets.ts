import { nanoid } from "nanoid";
import { askText } from "../components/ask-text";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import { apply, worldMatrix } from "../engine/transform";
import type { SceneNode } from "../engine/types";
import { placeAt } from "./actions";
import type { JamData } from "./types";
import { voterId } from "./voting";
import { reassert } from "../engine/reassert";

// Built-in widgets: interactive cards on the board that anyone in the file can use. A poll (click
// an option to vote, again to take it back), a checklist (tick items off), and a counter. Each
// person's poll vote is kept by their id; everything is shared through the document.

type Widget = Extract<JamData, { kind: "widget" }>;
export type WidgetKind = Widget["widget"];

export const WIDGET_W = 320;
const HEADER = 48;
const ROW = 36;
const FOOTER = 40;

export function widgetHeight(jam: Widget): number {
    if (jam.widget === "counter") return HEADER + 96;
    return HEADER + jam.items.length * ROW + FOOTER;
}

const TITLES: Record<WidgetKind, string> = { poll: "Poll", checklist: "Checklist", counter: "Counter" };

export function placeWidget(world: { x: number; y: number }, widget: WidgetKind): string {
    const s = editor.get();
    const at = placeAt(s.doc, world.x, world.y);
    const items = widget === "poll" ? ["Option 1", "Option 2", "Option 3"] : widget === "checklist" ? ["First thing", "Second thing"] : [];
    const jam: Widget = { kind: "widget", widget, title: widget === "poll" ? "What should we do?" : TITLES[widget], items: items.map((text) => ({ id: nanoid(6), text })), count: 0 };
    const h = widgetHeight(jam);
    const node = makeNode(s.doc, "rect", { x: at.x - WIDGET_W / 2, y: at.y - h / 2, w: WIDGET_W, h }, at.parentId, { name: TITLES[widget], fills: [solid("#FFFFFF")], radius: 12, jam });
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
    return node.id;
}

// Changes a widget from what it holds now: dialogs answer later, and a vote or another item may
// have arrived meanwhile (writing the copy from before the dialog dropped them).
function update(node: SceneNode, change: (jam: Widget) => Widget) {
    const live = editor.get().doc.nodes[node.id];
    const now = live?.jam?.kind === "widget" ? live.jam : null;
    if (!now) return;
    const jam = change(now);
    editor.execute({ type: "node.update", id: node.id, patch: { jam, h: widgetHeight(jam) } });
}

// A point in the widget's own unrotated box (the space of its x/y), so a rotated widget's rows
// still answer where they're drawn.
function local(node: SceneNode, world: { x: number; y: number }) {
    return apply(worldMatrix(editor.get().doc, node).inverse(), world.x, world.y);
}

// What a point (in the widget's own box) is over.
type Zone = { kind: "item"; index: number; part: "check" | "text" } | { kind: "add" } | { kind: "title" } | { kind: "minus" } | { kind: "plus" } | null;
function zoneAt(node: SceneNode, jam: Widget, x: number, y: number): Zone {
    const lx = x - node.x;
    const ly = y - node.y;
    if (ly < HEADER) return { kind: "title" };
    if (jam.widget === "counter") {
        const cy = node.y + HEADER + 48;
        if (Math.hypot(x - (node.x + 48), y - cy) < 20) return { kind: "minus" };
        if (Math.hypot(x - (node.x + node.w - 48), y - cy) < 20) return { kind: "plus" };
        return null;
    }
    const index = Math.floor((ly - HEADER) / ROW);
    if (index >= 0 && index < jam.items.length) return { kind: "item", index, part: lx < 44 ? "check" : "text" };
    if (index === jam.items.length) return { kind: "add" };
    return null;
}

// A click on a widget: true when it did something (so it isn't also a select or move).
export function widgetClick(node: SceneNode, world: { x: number; y: number }, double: boolean): boolean {
    const jam = node.jam?.kind === "widget" ? node.jam : null;
    if (!jam || node.locked) return false;
    const p = local(node, world);
    const zone = zoneAt(node, jam, p.x, p.y);
    if (!zone) return false;
    if (zone.kind === "title") {
        if (!double) return false;
        void askText("Title", jam.title).then((title) => title !== null && update(node, (j) => ({ ...j, title: title.trim() || TITLES[j.widget] })));
        return true;
    }
    const item = zone.kind === "item" ? jam.items[zone.index] : undefined;
    if (double) {
        // A double-click's two presses already counted (or toggled) as clicks; the double-click
        // itself only opens an item's text to change it.
        if (item && zone.kind === "item" && zone.part === "text") {
            // Double-click an item to change it (an empty one is removed).
            void askText(jam.widget === "poll" ? "Option" : "Item", item.text).then((text) => {
                if (text === null) return;
                update(node, (j) => ({ ...j, items: text.trim() ? j.items.map((i) => (i.id === item.id ? { ...i, text: text.trim() } : i)) : j.items.filter((i) => i.id !== item.id) }));
            });
        }
        return true;
    }
    if (zone.kind === "minus" || zone.kind === "plus") {
        update(node, (j) => ({ ...j, count: (j.count ?? 0) + (zone.kind === "plus" ? 1 : -1) }));
        return true;
    }
    if (zone.kind === "add") {
        void askText(jam.widget === "poll" ? "New option" : "New item", "").then((text) => text?.trim() && update(node, (j) => ({ ...j, items: [...j.items, { id: nanoid(6), text: text.trim() }] })));
        return true;
    }
    if (!item || zone.kind !== "item") return false;
    if (jam.widget === "checklist") {
        if (zone.part !== "check") return false;
        update(node, (j) => ({ ...j, items: j.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) }));
        return true;
    }
    // A poll: one vote per person; clicking your option again takes it back.
    const me = voterId();
    const live = editor.get().doc.nodes[node.id];
    const before = live?.jam?.kind === "widget" ? live.jam : jam;
    const choice = before.items.find((i) => i.id === item.id)?.votes?.includes(me) ? null : item.id;
    update(node, (j) => withVote(j, me, choice));
    // Kept even when someone else's vote lands at the same moment (engine/reassert.ts).
    reassert(`board-poll:${node.id}:${me}`, {
        alive: (doc) => doc.nodes[node.id]?.jam?.kind === "widget",
        restore: (doc) => {
            const n = doc.nodes[node.id];
            const j = n?.jam?.kind === "widget" ? n.jam : null;
            if (!j || !j.items.some((i) => i.id === choice || choice === null)) return null;
            const now = j.items.find((i) => i.votes?.includes(me))?.id ?? null;
            if (now === choice && j.items.every((i) => i.id === choice || !i.votes?.includes(me))) return null;
            const next = withVote(j, me, choice);
            return { type: "node.update", id: node.id, patch: { jam: next, h: widgetHeight(next) } };
        },
    });
    return true;
}

// A poll with your one vote on `choice` (none when null).
function withVote(j: Widget, me: string, choice: string | null): Widget {
    return { ...j, items: j.items.map((i) => ({ ...i, votes: [...(i.votes ?? []).filter((v) => v !== me), ...(i.id === choice ? [me] : [])] })) };
}

export function widgetCursor(node: SceneNode, world: { x: number; y: number }): string | undefined {
    const jam = node.jam?.kind === "widget" ? node.jam : null;
    if (!jam) return undefined;
    const p = local(node, world);
    const zone = zoneAt(node, jam, p.x, p.y);
    if (!zone || zone.kind === "title" || (jam.widget === "checklist" && zone.kind === "item" && zone.part === "text")) return undefined;
    return "pointer";
}

export function drawWidget(ctx: CanvasRenderingContext2D, node: SceneNode, jam: Widget) {
    const { x, y, w, h } = node;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.14)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#E6E6E6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "600 15px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#1E1E1E";
    ctx.fillText(jam.title, x + 16, y + HEADER / 2, w - 32);
    ctx.fillStyle = "#EDEDED";
    ctx.fillRect(x, y + HEADER - 1, w, 1);
    if (jam.widget === "counter") {
        const cy = y + HEADER + 48;
        ctx.font = "700 40px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#1E1E1E";
        ctx.fillText(String(jam.count ?? 0), x + w / 2, cy + 2);
        for (const [cx, sign] of [[x + 48, "−"], [x + w - 48, "+"]] as const) {
            ctx.beginPath();
            ctx.arc(cx, cy, 18, 0, Math.PI * 2);
            ctx.fillStyle = "#9747FF";
            ctx.fill();
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "600 22px Inter, system-ui, sans-serif";
            ctx.fillText(sign, cx, cy + 1);
        }
        ctx.restore();
        return;
    }
    const total = jam.items.reduce((a, i) => a + (i.votes?.length ?? 0), 0);
    const me = voterId();
    jam.items.forEach((item, i) => {
        const ry = y + HEADER + i * ROW;
        const cy = ry + ROW / 2;
        if (jam.widget === "poll") {
            const votes = item.votes?.length ?? 0;
            ctx.fillStyle = "#F2E9FF";
            ctx.beginPath();
            ctx.roundRect(x + 12, ry + 4, Math.max(0, (w - 24) * (total ? votes / total : 0)), ROW - 8, 6);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + 26, cy, 7, 0, Math.PI * 2);
            ctx.strokeStyle = "#9747FF";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            if (item.votes?.includes(me)) {
                ctx.beginPath();
                ctx.arc(x + 26, cy, 4, 0, Math.PI * 2);
                ctx.fillStyle = "#9747FF";
                ctx.fill();
            }
            ctx.textAlign = "right";
            ctx.font = "600 13px Inter, system-ui, sans-serif";
            ctx.fillStyle = "#5C5C5C";
            ctx.fillText(String(votes), x + w - 16, cy);
        } else {
            ctx.beginPath();
            ctx.roundRect(x + 18, cy - 8, 16, 16, 4);
            ctx.fillStyle = item.done ? "#9747FF" : "#FFFFFF";
            ctx.fill();
            ctx.strokeStyle = item.done ? "#9747FF" : "#B3B3B3";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            if (item.done) {
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(x + 22, cy);
                ctx.lineTo(x + 25, cy + 3);
                ctx.lineTo(x + 30, cy - 3);
                ctx.stroke();
            }
        }
        ctx.textAlign = "left";
        ctx.font = "400 13px Inter, system-ui, sans-serif";
        ctx.fillStyle = item.done ? "#9E9E9E" : "#1E1E1E";
        ctx.fillText(item.text, x + 44, cy, w - 88);
        if (item.done) {
            const tw = Math.min(ctx.measureText(item.text).width, w - 88);
            ctx.fillRect(x + 44, cy, tw, 1);
        }
    });
    ctx.textAlign = "left";
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#9747FF";
    ctx.fillText(jam.widget === "poll" ? `+ Add option${total ? ` · ${total} vote${total === 1 ? "" : "s"}` : ""}` : `+ Add item · ${jam.items.filter((i) => i.done).length} of ${jam.items.length} done`, x + 16, y + h - FOOTER / 2);
    ctx.restore();
}

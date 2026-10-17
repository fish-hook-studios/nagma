import { isFrameLike } from "./components";
import type { NagmaDocument, SceneNode, Sizing } from "./types";

// Pure helpers for the selection chrome drawn on the canvas: the size pill under a selection
// ("31 Hug × 24 Hug") and the baselines a text layer shows while it is selected or hovered.

// The sizing a layer really has on each axis: hug only counts for text and auto layout frames,
// fill only inside an auto layout parent (an absolute child is out of the flow). A stale value
// left on a plain frame reads as fixed, the way the panel shows it.
export function effectiveSizing(doc: NagmaDocument, node: SceneNode): { h: Sizing; v: Sizing } {
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const inFlow = Boolean(parent?.layout) && node.positioning !== "absolute";
    const canHug = node.type === "text" || (isFrameLike(node) && Boolean(node.layout));
    const one = (s: Sizing | undefined): Sizing => (s === "hug" && canHug ? "hug" : s === "fill" && inFlow ? "fill" : "fixed");
    return { h: one(node.sizing?.h), v: one(node.sizing?.v) };
}

// The size pill sits 6pt below the selection's outline and is 17pt tall, as in the reference.
export const SIZE_PILL_GAP = 6;
export const SIZE_PILL_HEIGHT = 17;

export function formatSize(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
}

const WORD: Record<Sizing, string> = { fixed: "", hug: " Hug", fill: " Fill" };

// The size pill's text: each side's size, followed by Hug or Fill when that side isn't fixed.
export function sizePillText(w: number, h: number, sizing?: { h: Sizing; v: Sizing }): string {
    return `${formatSize(w)}${sizing ? WORD[sizing.h] : ""} × ${formatSize(h)}${sizing ? WORD[sizing.v] : ""}`;
}

export interface Segment {
    x0: number;
    x1: number;
    y: number;
}

interface LineLike {
    baseline: number;
    x: number;
    width: number;
}

// A selected text layer's baseline mark: its first line's baseline, across the whole box (in the
// layer's parent space, before its rotation). `offsetY` is the vertical alignment's shift.
export function firstBaseline(node: Pick<SceneNode, "x" | "y" | "w">, lines: LineLike[], offsetY: number): Segment | null {
    const first = lines[0];
    if (!first) return null;
    const y = node.y + offsetY + first.baseline;
    return { x0: node.x, x1: node.x + node.w, y };
}

// Hovering a text layer underlines every line where its text runs (empty lines have nothing).
export function lineBaselines(node: Pick<SceneNode, "x" | "y">, lines: LineLike[], offsetY: number): Segment[] {
    return lines.filter((l) => l.width > 0).map((l) => ({ x0: node.x + l.x, x1: node.x + l.x + l.width, y: node.y + offsetY + l.baseline }));
}

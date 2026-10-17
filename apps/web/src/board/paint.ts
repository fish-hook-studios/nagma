import { boardPainter } from "../canvas/render";
import { getImage } from "../engine/images";
import { drawTextLayer } from "../canvas/text-render";
import { hexToRgba } from "../engine/paint";
import { solid } from "../engine/paint";
import { layoutText } from "../engine/text-layout";
import { apply, spaceMatrix } from "../engine/transform";
import type { Camera, NagmaDocument, SceneNode } from "../engine/types";
import { type Pt, liveRoute, pointAlong } from "./connectors";
import { drawCodeBlock } from "./code";
import { drawLink } from "./links";
import { drawWidget } from "./widgets";
import { ICON_SHAPES, stampLook, textOn } from "./model";
import { board } from "./state";
import { cellLayer, covered, mergeAt } from "./table";
import { mentionSpans } from "./mentions";
import type { ConnectorCap, JamData } from "./types";

// Draws board objects: sticky and shape text (fitted to the note), the sticky's author, connectors
// with their arrowheads and labels, stamps, tables and washi tape, and the dot grid behind it all.

const STICKY_PAD = 16;
const AUTHOR_SPACE = 22;
// Auto text on a sticky: the largest of these that fits the note; past the smallest, the note grows.
const FIT_SIZES = [32, 28, 24, 20, 18, 16];

export function stickyTextBox(node: SceneNode) {
    return { x: node.x + STICKY_PAD, y: node.y + STICKY_PAD, w: Math.max(1, node.w - STICKY_PAD * 2), h: Math.max(1, node.h - STICKY_PAD * 2 - AUTHOR_SPACE) };
}

export function shapeTextBox(node: SceneNode) {
    // Icon cards keep their text under the icon.
    if (node.jam?.kind === "shape" && ICON_SHAPES.includes(node.jam.shape)) return { x: node.x + 8, y: node.y + node.h * 0.62, w: Math.max(1, node.w - 16), h: Math.max(1, node.h * 0.34) };
    const inset = node.jam?.kind === "shape" && ["diamond", "triangle", "triangle-down", "circle", "ellipse", "star"].includes(node.jam.shape) ? 0.18 : 0.06;
    return { x: node.x + node.w * inset + 8, y: node.y + node.h * inset + 4, w: Math.max(1, node.w * (1 - inset * 2) - 16), h: Math.max(1, node.h * (1 - inset * 2) - 8) };
}

function textColorOf(node: SceneNode): string {
    const jam = node.jam;
    if (jam && "textColor" in jam && jam.textColor) return jam.textColor;
    const fill = node.fills.find((p) => p.visible && p.type === "solid");
    return fill && fill.type === "solid" && fill.opacity > 0.4 ? textOn(fill.color) : "#1E1E1E";
}

// A text layer standing in for the object's text, laid out in `box`.
function textNode(node: SceneNode, box: { x: number; y: number; w: number; h: number }, size: number, color: string): SceneNode {
    return {
        ...node,
        type: "text",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        rotation: 0,
        flipX: false,
        flipY: false,
        fills: [solid(color)],
        strokes: [],
        shadow: null,
        effects: [],
        fontSize: size,
        sizing: { h: "fixed", v: "fixed" },
        jam: undefined,
    };
}

const fitted = new WeakMap<SceneNode, SceneNode>();

// The sticky's or shape's text as a text layer, its size fitted (Auto) or as chosen.
export function textLayerFor(node: SceneNode): SceneNode | null {
    if (!node.text) return null;
    const cached = fitted.get(node);
    if (cached) return cached;
    const sticky = node.jam?.kind === "sticky";
    const box = sticky ? stickyTextBox(node) : shapeTextBox(node);
    const color = textColorOf(node);
    let layer = textNode(node, box, node.fontSize ?? 16, color);
    if (sticky && !node.fontSize) {
        // Fitted against the note's own size, not the height it has grown to.
        const baseH = node.jam?.kind === "sticky" && node.jam.baseH ? node.jam.baseH : node.h;
        const fitH = Math.max(1, baseH - STICKY_PAD * 2 - AUTHOR_SPACE);
        for (const size of FIT_SIZES) {
            layer = textNode(node, box, size, color);
            const layout = layoutText(layer);
            const wide = layout.lines.some((l) => l.left + l.width > box.w + 0.5);
            // A word split across lines doesn't fit either.
            const text = layer.text ?? "";
            const split = layout.lines.some((l) => !l.paragraphEnd && /\S/.test(text[l.end - 1] ?? "") && /\S/.test(text[l.end] ?? ""));
            if (layout.height <= fitH && !wide && !split) break;
        }
    }
    // @mentions in bold blue.
    const mentions = mentionSpans(node);
    if (mentions.length) layer = { ...layer, spans: [...(layer.spans ?? []), ...mentions] };
    fitted.set(node, layer);
    return layer;
}

// How tall a sticky needs to be for its text.
export function stickyHeightFor(node: SceneNode): number {
    const layer = textLayerFor(node);
    if (!layer) return 0;
    return layoutText(layer).height + STICKY_PAD * 2 + AUTHOR_SPACE;
}

function drawObjectText(ctx: CanvasRenderingContext2D, node: SceneNode, pixelScale: number) {
    if (board.get().editing?.id === node.id) return;
    const layer = textLayerFor(node);
    if (!layer) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(node.x, node.y, node.w, node.h);
    ctx.clip();
    drawTextLayer(ctx, layer, pixelScale);
    ctx.restore();
}

function drawAuthor(ctx: CanvasRenderingContext2D, node: SceneNode, author: string) {
    ctx.save();
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = hexToRgba(textColorOf(node), 0.55);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(author, node.x + STICKY_PAD, node.y + node.h - 12, node.w - STICKY_PAD * 2);
    ctx.restore();
}

function capSize(width: number) {
    return Math.max(10, width * 4.5);
}

function drawCap(ctx: CanvasRenderingContext2D, cap: ConnectorCap, tip: Pt, from: Pt, width: number, color: string) {
    if (cap === "none") return;
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const s = capSize(width);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    if (cap === "arrow") {
        ctx.moveTo(0, 0);
        ctx.lineTo(-s, -s * 0.55);
        ctx.lineTo(-s, s * 0.55);
        ctx.closePath();
        ctx.fill();
    } else if (cap === "line-arrow") {
        ctx.moveTo(-s, -s * 0.6);
        ctx.lineTo(0, 0);
        ctx.lineTo(-s, s * 0.6);
        ctx.stroke();
    } else if (cap === "triangle") {
        ctx.moveTo(-s, 0);
        ctx.lineTo(0, -s * 0.55);
        ctx.lineTo(0, s * 0.55);
        ctx.closePath();
        ctx.fill();
    } else if (cap === "diamond") {
        ctx.moveTo(0, 0);
        ctx.lineTo(-s / 2, -s / 2.4);
        ctx.lineTo(-s, 0);
        ctx.lineTo(-s / 2, s / 2.4);
        ctx.closePath();
        ctx.fill();
    } else if (cap === "circle") {
        ctx.arc(-s / 3, 0, s / 3, 0, Math.PI * 2);
        ctx.fill();
    } else drawErdCap(ctx, cap, s);
    ctx.restore();
}

// Crow's foot ends (the tip at 0, the line coming in from the left): bars for "one", a fork for
// "many", and an open ring for "zero".
function drawErdCap(ctx: CanvasRenderingContext2D, cap: ConnectorCap, s: number) {
    const half = s * 0.55;
    const bar = (x: number) => {
        ctx.moveTo(x, -half);
        ctx.lineTo(x, half);
    };
    const fork = () => {
        ctx.moveTo(0, -half);
        ctx.lineTo(-s, 0);
        ctx.lineTo(0, half);
    };
    const ring = (x: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, 0, s * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
    };
    ctx.lineCap = "butt";
    if (cap === "erd-one") bar(-s * 0.55);
    else if (cap === "erd-only-one") {
        bar(-s * 0.45);
        bar(-s * 0.85);
    } else if (cap === "erd-many") fork();
    else if (cap === "erd-one-or-many") {
        fork();
        bar(-s * 1.25);
    } else if (cap === "erd-zero-or-one") {
        bar(-s * 0.45);
        ctx.stroke();
        ring(-s * 1.1);
    } else if (cap === "erd-zero-or-many") {
        fork();
        ctx.stroke();
        ring(-s * 1.35);
    }
    ctx.stroke();
}

// How far a cap eats into the line, so the stroke doesn't poke through the arrowhead.
function inset(cap: ConnectorCap, width: number) {
    return cap === "arrow" || cap === "diamond" ? capSize(width) * 0.6 : cap === "circle" ? capSize(width) * 0.3 : 0;
}

function pull(a: Pt, b: Pt, by: number): Pt {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6 || by <= 0) return a;
    const t = Math.min(by, d * 0.5) / d;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawConnector(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, jam: Extract<JamData, { kind: "connector" }>, pixelScale: number) {
    const route = liveRoute(doc, node);
    if (!route) return;
    const m = spaceMatrix(doc, node.parentId).inverse();
    const pts = route.points.map((p) => apply(m, p.x, p.y));
    if (pts.length < 2) return;
    const stroke = node.strokes.find((p) => p.visible && p.type === "solid");
    const color = stroke && stroke.type === "solid" ? stroke.color : "#1E1E1E";
    const width = node.strokeWidth;
    const first = pts[0] as Pt;
    const last = pts[pts.length - 1] as Pt;
    const second = pts[1] as Pt;
    const beforeLast = pts[pts.length - 2] as Pt;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (jam.dashed) ctx.setLineDash([width * 4, width * 3]);
    ctx.beginPath();
    const start = pull(first, second, inset(jam.startCap, width));
    const end = pull(last, beforeLast, inset(jam.endCap, width));
    ctx.moveTo(start.x, start.y);
    if (route.curved) ctx.bezierCurveTo(second.x, second.y, beforeLast.x, beforeLast.y, end.x, end.y);
    else {
        // Elbows get rounded corners (12 unless set).
        for (let i = 1; i < pts.length - 1; i++) {
            const p = pts[i] as Pt;
            const n = pts[i + 1] as Pt;
            ctx.arcTo(p.x, p.y, n.x, n.y, Math.min(jam.radius ?? 12, Math.hypot(n.x - p.x, n.y - p.y) / 2, Math.hypot(p.x - (pts[i - 1] as Pt).x, p.y - (pts[i - 1] as Pt).y) / 2));
        }
        ctx.lineTo(end.x, end.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    drawCap(ctx, jam.startCap, first, second, width, color);
    drawCap(ctx, jam.endCap, last, beforeLast, width, color);
    ctx.restore();
    // The label sits along the line (half way unless dragged) on a plate: the board's colour so
    // the line breaks around it, or the line's colour with its background on.
    if (node.text && board.get().editing?.id !== node.id) {
        const mid = pointAlong({ ...route, points: pts }, jam.labelAt ?? 0.5);
        const ink = jam.labelBg ? textOn(color) : "#1E1E1E";
        const layer = connectorLabel(node, mid, ink);
        const layout = layoutText(layer);
        const w = layout.lines.reduce((a, l) => Math.max(a, l.width), 0);
        const page = doc.nodes[doc.roots.find((r) => isAncestor(doc, r, node.id)) ?? ""];
        const pageFill = page?.fills.find((f) => f.type === "solid");
        ctx.save();
        ctx.fillStyle = jam.labelBg ? color : pageFill && pageFill.type === "solid" ? pageFill.color : "#FFFFFF";
        ctx.beginPath();
        ctx.roundRect(mid.x - w / 2 - 6, mid.y - layout.height / 2 - 3, w + 12, layout.height + 6, 4);
        ctx.fill();
        ctx.restore();
        drawTextLayer(ctx, { ...layer, y: mid.y - layout.height / 2, h: layout.height }, pixelScale);
    }
}

export function connectorLabel(node: SceneNode, mid: Pt, ink = "#1E1E1E"): SceneNode {
    return textNode(node, { x: mid.x - 120, y: mid.y - 12, w: 240, h: 24 }, node.fontSize ?? 14, ink) as SceneNode & { textAlign: "center" };
}

function isAncestor(doc: NagmaDocument, ancestor: string, id: string): boolean {
    let n: SceneNode | undefined = doc.nodes[id];
    while (n) {
        if (n.id === ancestor) return true;
        n = n.parentId ? doc.nodes[n.parentId] : undefined;
    }
    return false;
}

function drawStamp(ctx: CanvasRenderingContext2D, node: SceneNode, jam: Extract<JamData, { kind: "stamp" }>) {
    const info = stampLook({ kind: jam.stamp, glyph: jam.glyph, face: jam.face });
    const r = Math.min(node.w, node.h) / 2;
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    ctx.fillStyle = info.color;
    ctx.fill();
    const text = info.glyph;
    const emoji = /\p{Extended_Pictographic}/u.test(text);
    ctx.font = `${emoji ? 400 : 800} ${Math.round(r * (emoji ? 0.95 : text.length > 1 ? 0.8 : 1))}px Inter, system-ui, "Apple Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(text, cx, cy + r * 0.06);
    ctx.restore();
}

// A table's column and row edges, in its own box (tracks are shares of the width and height).
export function tableGrid(node: SceneNode, jam: Extract<JamData, { kind: "table" }>) {
    const cw = jam.cols.reduce((a, b) => a + b, 0) || 1;
    const rh = jam.rows.reduce((a, b) => a + b, 0) || 1;
    const xs = [node.x];
    for (const c of jam.cols) xs.push((xs[xs.length - 1] as number) + (c / cw) * node.w);
    const ys = [node.y];
    for (const r of jam.rows) ys.push((ys[ys.length - 1] as number) + (r / rh) * node.h);
    return { xs, ys };
}

// A cell's box; the top-left cell of a merge covers the whole merged block.
export function cellBox(node: SceneNode, jam: Extract<JamData, { kind: "table" }>, row: number, col: number) {
    const { xs, ys } = tableGrid(node, jam);
    const m = mergeAt(jam, row, col);
    const [r0, c0, rs, cs] = m && m.r === row && m.c === col ? [m.r, m.c, m.rs, m.cs] : [row, col, 1, 1];
    const x = xs[c0] ?? node.x;
    const y = ys[r0] ?? node.y;
    return { x, y, w: (xs[c0 + cs] ?? x) - x, h: (ys[r0 + rs] ?? y) - y };
}

// Where a cell's text sits inside its box.
export function cellTextBox(box: { x: number; y: number; w: number; h: number }) {
    return { x: box.x + 10, y: box.y + 8, w: Math.max(1, box.w - 20), h: Math.max(1, box.h - 16) };
}

function drawTable(ctx: CanvasRenderingContext2D, node: SceneNode, jam: Extract<JamData, { kind: "table" }>, pixelScale: number) {
    const { xs, ys } = tableGrid(node, jam);
    const fill = node.fills.find((p) => p.visible && p.type === "solid");
    const base = fill && fill.type === "solid" ? fill.color : "#FFFFFF";
    ctx.save();
    // Each cell's background (the first row reads as a header), then the lines between cells
    // (left out inside merged blocks).
    jam.cells.forEach((row, r) =>
        row.forEach((_, c) => {
            if (covered(jam, r, c)) return;
            const box = cellBox(node, jam, r, c);
            ctx.fillStyle = jam.fills?.[r]?.[c] ?? base;
            ctx.fillRect(box.x, box.y, box.w, box.h);
            if (r === 0 && !jam.fills?.[r]?.[c]) {
                ctx.fillStyle = "rgba(0,0,0,0.05)";
                ctx.fillRect(box.x, box.y, box.w, (ys[1] ?? box.y) - box.y);
            }
        }),
    );
    ctx.strokeStyle = "#B3B3B3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(node.x, node.y, node.w, node.h);
    for (let c = 1; c < xs.length - 1; c++) {
        const x = xs[c] as number;
        for (let r = 0; r < ys.length - 1; r++) {
            const m = mergeAt(jam, r, c);
            if (m && m.c < c) continue;
            ctx.moveTo(x, ys[r] as number);
            ctx.lineTo(x, ys[r + 1] as number);
        }
    }
    for (let r = 1; r < ys.length - 1; r++) {
        const y = ys[r] as number;
        for (let c = 0; c < xs.length - 1; c++) {
            const m = mergeAt(jam, r, c);
            if (m && m.r < r) continue;
            ctx.moveTo(xs[c] as number, y);
            ctx.lineTo(xs[c + 1] as number, y);
        }
    }
    ctx.stroke();
    ctx.restore();
    const editing = board.get().editing;
    jam.cells.forEach((row, r) =>
        row.forEach((text, c) => {
            if (!text || covered(jam, r, c) || (editing?.id === node.id && editing.cell?.[0] === r && editing.cell?.[1] === c)) return;
            const box = cellBox(node, jam, r, c);
            ctx.save();
            ctx.beginPath();
            ctx.rect(box.x, box.y, box.w, box.h);
            ctx.clip();
            drawTextLayer(ctx, cellLayer(node, jam, r, c, cellTextBox(box), text), pixelScale);
            ctx.restore();
        }),
    );
}

function drawWashi(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, jam: Extract<JamData, { kind: "washi" }>) {
    const { x, y, w, h } = node;
    if (jam.pattern === "custom" && jam.image) {
        // An uploaded pattern, scaled to the strip's height and repeated along it.
        const img = getImage(doc, jam.image);
        ctx.save();
        ctx.globalAlpha *= 0.92;
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        if (img) {
            const k = h / Math.max(1, img.naturalHeight);
            for (let px = x; px < x + w; px += img.naturalWidth * k) ctx.drawImage(img, px, y, img.naturalWidth * k, h);
        } else {
            ctx.fillStyle = "#E6E6E6";
            ctx.fillRect(x, y, w, h);
        }
        ctx.restore();
        return;
    }
    const teeth = Math.max(3, Math.round(h / 6));
    ctx.save();
    ctx.globalAlpha *= 0.88;
    ctx.beginPath();
    // Torn ends: a small zigzag at each side.
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    for (let i = 1; i <= teeth; i++) ctx.lineTo(x + w + (i % 2 ? -4 : 0), y + (h * i) / teeth);
    ctx.lineTo(x, y + h);
    for (let i = teeth - 1; i >= 0; i--) ctx.lineTo(x + (i % 2 ? 4 : 0), y + (h * i) / teeth);
    ctx.closePath();
    ctx.fillStyle = jam.color;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 3;
    if (jam.pattern === "dots") {
        for (let px = x + 8; px < x + w; px += 14) for (let py = y + 7; py < y + h; py += 14) {
            ctx.beginPath();
            ctx.arc(px + ((py - y) % 28 > 13 ? 7 : 0), py, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (jam.pattern === "stripes") {
        ctx.beginPath();
        for (let px = x - h; px < x + w + h; px += 12) {
            ctx.moveTo(px, y + h);
            ctx.lineTo(px + h, y);
        }
        ctx.stroke();
    } else if (jam.pattern === "grid") {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let px = x; px < x + w; px += 9) {
            ctx.moveTo(px, y);
            ctx.lineTo(px, y + h);
        }
        for (let py = y; py < y + h; py += 9) {
            ctx.moveTo(x, py);
            ctx.lineTo(x + w, py);
        }
        ctx.stroke();
    } else if (jam.pattern === "waves") {
        ctx.lineWidth = 2;
        for (const row of [0.33, 0.66]) {
            ctx.beginPath();
            for (let px = x; px <= x + w; px += 2) ctx.lineTo(px, y + h * row + Math.sin((px - x) / 5) * 3);
            ctx.stroke();
        }
    } else if (jam.pattern === "checks") {
        for (let px = x, i = 0; px < x + w; px += h / 2, i++) for (let row = 0; row < 2; row++) if ((i + row) % 2) ctx.fillRect(px, y + (row * h) / 2, h / 2, h / 2);
    } else if (jam.pattern === "stars") {
        ctx.font = `${Math.round(h * 0.42)}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,240,170,0.9)";
        for (let px = x + 5, i = 0; px < x + w; px += h * 0.7, i++) ctx.fillText("★", px, y + h * (i % 2 ? 0.32 : 0.68));
    } else if (jam.pattern === "hearts") {
        ctx.font = `${Math.round(h * 0.5)}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        for (let px = x + 6; px < x + w; px += h * 0.8) ctx.fillText("♥", px, y + h / 2);
    }
    ctx.restore();
}

// A section whose contents are hidden: soft diagonal stripes and a note in the middle.
function drawHiddenSection(ctx: CanvasRenderingContext2D, node: SceneNode) {
    const { x, y, w, h } = node;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, node.radius ?? 0);
    ctx.clip();
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let d = -h; d < w; d += 28) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
    }
    ctx.stroke();
    const label = "Contents hidden";
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    const bw = tw + 52;
    const bx = x + w / 2 - bw / 2;
    const by = y + h / 2 - 20;
    ctx.fillStyle = "#FFFFFF";
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 40, 20);
    ctx.fill();
    ctx.shadowColor = "transparent";
    // A closed eye.
    ctx.strokeStyle = "#1E1E1E";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    const ex = bx + 22;
    const ey = by + 18;
    ctx.beginPath();
    ctx.moveTo(ex - 8, ey);
    ctx.quadraticCurveTo(ex, ey + 7, ex + 8, ey);
    for (const k of [-5, 0, 5]) {
        ctx.moveTo(ex + k, ey + 3.5);
        ctx.lineTo(ex + k * 1.3, ey + 7);
    }
    ctx.stroke();
    ctx.fillStyle = "#1E1E1E";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + 38, by + 20.5);
    ctx.restore();
}

boardPainter.draw = (ctx, doc, node, options, phase) => {
    const jam = node.jam;
    if (!jam || !doc.board) return false;
    if (phase === "replace") {
        if (jam.kind === "connector") drawConnector(ctx, doc, node, jam, options.pixelScale);
        else if (jam.kind === "stamp") drawStamp(ctx, node, jam);
        else if (jam.kind === "table") drawTable(ctx, node, jam, options.pixelScale);
        else if (jam.kind === "washi") drawWashi(ctx, doc, node, jam);
        else if (jam.kind === "link") drawLink(ctx, node, jam);
        else if (jam.kind === "widget") drawWidget(ctx, node, jam);
        else if (jam.kind === "sticker") {
            const size = Math.min(node.w, node.h);
            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,0.2)";
            ctx.shadowBlur = size * 0.06;
            ctx.shadowOffsetY = size * 0.02;
            ctx.font = `${Math.round(size * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(jam.glyph, node.x + node.w / 2, node.y + node.h / 2 + size * 0.04);
            ctx.restore();
        }
        else if (jam.kind === "code") drawCodeBlock(ctx, node, jam.lang, board.get().editing?.id === node.id);
        else return false;
        return true;
    }
    if (jam.kind === "section" && jam.hidden) drawHiddenSection(ctx, node);
    else if (jam.kind === "sticky") {
        drawObjectText(ctx, node, options.pixelScale);
        if (jam.showAuthor !== false && jam.author) drawAuthor(ctx, node, jam.author);
    } else if (jam.kind === "shape") drawObjectText(ctx, node, options.pixelScale);
    return false;
};

// Section titles as pills in a deeper shade of the section's colour.
boardPainter.sectionLabel = (ctx, _doc, node, r, active) => {
    if (!node.name) return true;
    const fill = node.fills.find((f) => f.type === "solid");
    const base = fill && fill.type === "solid" ? fill.color : "#FFFFFF";
    const hex = base.replace("#", "");
    const ch = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) || 255) * 0.86);
    ctx.save();
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const w = Math.min(ctx.measureText(node.name).width + 16, Math.max(24, r.w + 40));
    const x = r.x - 4;
    const y = r.y - 4;
    const h = 22;
    ctx.fillStyle = `rgb(${ch(0)}, ${ch(2)}, ${ch(4)})`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    if (active) {
        ctx.strokeStyle = "#0D99FF";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(x, y, w - 6, h);
    ctx.clip();
    ctx.fillStyle = "#1E1E1E";
    ctx.fillText(node.name, x + 8, y + h / 2 + 0.5);
    ctx.restore();
    return true;
};

// The dot grid: one dot every 24 units, thinned out when zoomed far out.
boardPainter.backdrop = (ctx: CanvasRenderingContext2D, width: number, height: number, doc: NagmaDocument, camera: Camera) => {
    if (!doc.board || !board.get().dotGrid) return;
    let step = 24 * camera.zoom;
    while (step < 12) step *= 2;
    const ox = ((camera.x % step) + step) % step;
    const oy = ((camera.y % step) + step) % step;
    const r = Math.max(0.8, Math.min(1.4, camera.zoom));
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    for (let x = ox; x < width; x += step) for (let y = oy; y < height; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    ctx.restore();
};

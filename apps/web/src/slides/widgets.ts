import { cloneSubtree, makeNode } from "../engine/nodes";
import { MAX_CELLS, deleteColumns, deleteRows, insertColumn, insertRow, tableModel } from "./tables";
import { parametricPath } from "../engine/vector";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import { reassert } from "../engine/reassert";
import type { Command, NagmaDocument, SceneNode, TextSpan } from "../engine/types";
import { deckBatch, deckOf, roleSize, roleStyle, slideAround, slideIds, themeOf } from "./model";
import { currentSlide } from "./state";
import type { DeckData, DeckTheme, NumberFormat } from "./types";

// Things the + menu and the Interactive tray put on a slide: tables, code blocks and charts made
// of ordinary layers, and live widgets (polls, alignment scales, live stamps, embeds) that the
// audience answers while presenting.

export type WidgetKind = "table" | "code" | "chart" | LiveKind | ShapeKind;

// Live elements: the audience answers or watches them while presenting.
export type LiveKind = "poll" | "scale" | "stamps" | "embed" | "facepile" | "video-link";
export const LIVE_KINDS: LiveKind[] = ["poll", "scale", "stamps", "embed", "facepile", "video-link"];

// Shapes with text: a shape and a centred text that resize together.
export type ShapeKind = "text-rect" | "text-rounded" | "text-ellipse" | "text-diamond" | "text-triangle" | "text-star" | "text-cross" | "text-arrow-left" | "text-arrow-right" | "text-bubble";

export const TEXT_SHAPES: { id: ShapeKind; label: string }[] = [
    { id: "text-rect", label: "Rectangle with text" },
    { id: "text-rounded", label: "Rounded rectangle with text" },
    { id: "text-ellipse", label: "Ellipse with text" },
    { id: "text-diamond", label: "Diamond with text" },
    { id: "text-triangle", label: "Triangle with text" },
    { id: "text-star", label: "Star with text" },
    { id: "text-cross", label: "Cross with text" },
    { id: "text-arrow-left", label: "Left arrow with text" },
    { id: "text-arrow-right", label: "Right arrow with text" },
    { id: "text-bubble", label: "Speech bubble with text" },
];

// The outlines of the shapes without a layer type of their own, in a 1×1 box.
const OUTLINES: Partial<Record<ShapeKind, [number, number][]>> = {
    "text-triangle": [[0.5, 0], [1, 1], [0, 1]],
    "text-cross": [[1 / 3, 0], [2 / 3, 0], [2 / 3, 1 / 3], [1, 1 / 3], [1, 2 / 3], [2 / 3, 2 / 3], [2 / 3, 1], [1 / 3, 1], [1 / 3, 2 / 3], [0, 2 / 3], [0, 1 / 3], [1 / 3, 1 / 3]],
    "text-arrow-right": [[0, 0.3], [0.62, 0.3], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.7], [0, 0.7]],
    "text-arrow-left": [[1, 0.3], [0.38, 0.3], [0.38, 0], [0, 0.5], [0.38, 1], [0.38, 0.7], [1, 0.7]],
    "text-bubble": [[0, 0], [1, 0], [1, 0.76], [0.36, 0.76], [0.14, 1], [0.2, 0.76], [0, 0.76]],
};

// Square shapes are 420 a side; the wide ones 520 × 280 (the bubble a little taller).
function shapeSize(kind: ShapeKind): { w: number; h: number } {
    if (kind === "text-rect" || kind === "text-rounded" || kind === "text-arrow-left" || kind === "text-arrow-right") return { w: 520, h: 280 };
    if (kind === "text-bubble") return { w: 520, h: 360 };
    return { w: 420, h: 420 };
}

// The box the shape's text sits in, inset from its outline.
function textInset(kind: ShapeKind, w: number, h: number): { l: number; t: number; r: number; b: number } {
    switch (kind) {
        case "text-diamond":
            return { l: w * 0.22, t: h * 0.22, r: w * 0.22, b: h * 0.22 };
        case "text-star":
            return { l: w * 0.3, t: h * 0.36, r: w * 0.3, b: h * 0.26 };
        case "text-triangle":
            return { l: w * 0.25, t: h * 0.45, r: w * 0.25, b: 24 };
        case "text-cross":
            return { l: w / 3, t: h / 3, r: w / 3, b: h / 3 };
        case "text-arrow-right":
            return { l: 24, t: h * 0.3, r: w * 0.38, b: h * 0.3 };
        case "text-arrow-left":
            return { l: w * 0.38, t: h * 0.3, r: 24, b: h * 0.3 };
        case "text-bubble":
            return { l: 32, t: 32, r: 32, b: h * 0.24 + 32 };
        default:
            return { l: 32, t: 32, r: 32, b: 32 };
    }
}

const MONO = "JetBrains Mono";

function label(doc: NagmaDocument, parentId: string, x: number, y: number, w: number, content: string, size: number, color: string, extra: Partial<SceneNode> = {}): SceneNode {
    return makeNode(doc, "text", { x, y, w, h: size * 1.3 }, parentId, {
        name: content.slice(0, 24) || "Text",
        text: content,
        fontSize: size,
        sizing: { h: "fixed", v: "hug" },
        fills: [solid(color)],
        ...extra,
    });
}

// Each new layer is made against the document as it will be once the ones before it exist.
class Builder {
    commands: Command[] = [];
    doc: NagmaDocument;
    constructor(doc: NagmaDocument) {
        this.doc = doc;
    }
    add(node: SceneNode): SceneNode {
        this.commands.push({ type: "node.create", node });
        this.doc = { ...this.doc, nodes: { ...this.doc.nodes, [node.id]: node } };
        return node;
    }
}

// An empty table of a size picked on the insert grid, with a header row.
export function blankTable(rows: number, cols: number): string[][] {
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Heading ${c + 1}` : "")));
}

const SAMPLE_TABLE = [
    ["Name", "Status", "Owner"],
    ["Row 1", "Row 1", "Row 1"],
    ["Row 2", "Row 2", "Row 2"],
    ["Row 3", "Row 3", "Row 3"],
];

// A table of frames, a header row first, sized to fit the slide.
function tableNodes(b: Builder, slide: SceneNode, theme: DeckTheme, data: string[][] = SAMPLE_TABLE) {
    const rows = Math.max(1, data.length);
    const cols = Math.max(1, ...data.map((r) => r.length));
    // Cells stay big enough for a word and its padding: a 40-column paste made negative text
    // widths and a 400-row one 2px rows (a table that big runs past the slide instead).
    const cw = Math.max(96, Math.min(440, Math.floor((slide.w - 240) / cols)));
    const rh = Math.max(40, Math.min(110, Math.floor((slide.h - 160) / rows)));
    const pad = Math.min(28, Math.floor(cw / 6));
    const size = Math.max(14, Math.min(32, Math.round(rh * 0.3)));
    const x0 = slide.x + (slide.w - cw * cols) / 2;
    const y0 = slide.y + (slide.h - rh * rows) / 2;
    const table = b.add(makeNode(b.doc, "frame", { x: x0, y: y0, w: cw * cols, h: rh * rows }, slide.id, { name: "Table", fills: [], radius: 12, clip: true, deck: { kind: "table", cols: Array.from({ length: cols }, () => cw), rows: Array.from({ length: rows }, () => rh), look: "banded" } }));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const header = r === 0;
            const cell = b.add(
                makeNode(b.doc, "frame", { x: x0 + c * cw, y: y0 + r * rh, w: cw, h: rh }, table.id, {
                    name: `Cell ${r + 1}.${c + 1}`,
                    fills: [solid(header ? theme.accent : r % 2 ? theme.surface : theme.background)],
                    strokes: [solid(theme.surface)],
                    strokeWidth: 2,
                    deck: { kind: "cell", r, c },
                }),
            );
            b.add(
                label(b.doc, cell.id, cell.x + pad, cell.y + rh / 2 - size * 0.7, cw - pad * 2, data[r]?.[c] ?? "", size, header ? theme.background : theme.text, {
                    fontFamily: theme.bodyFont,
                    fontWeight: header ? 700 : 400,
                }),
            );
        }
    }
    return table;
}

const SAMPLE_CODE = `function greet(name) {\n  // Say hello\n  const words = ["Hello", name];\n  return words.join(", ") + "!";\n}`;

function codeNodes(b: Builder, slide: SceneNode) {
    const w = 1200;
    const h = 520;
    const x = slide.x + (slide.w - w) / 2;
    const y = slide.y + (slide.h - h) / 2;
    const frame = b.add(makeNode(b.doc, "frame", { x, y, w, h }, slide.id, { name: "Code block", fills: [solid("#1E1E24")], radius: 20, clip: true }));
    const code = label(b.doc, frame.id, x + 56, y + 56, w - 112, SAMPLE_CODE, 34, "#E6E6E6", { name: "Code", fontFamily: MONO, lineHeight: 1.5, deck: { kind: "code", lang: "js" } });
    b.add({ ...code, spans: highlight(SAMPLE_CODE, "js") });
    return frame;
}

const SAMPLE_CHART = { labels: ["Q1", "Q2", "Q3", "Q4", "Q5"], values: [40, 65, 52, 80, 95] };

// The bars, axis and labels of a chart, inside its frame.
function chartLayers(b: Builder, frame: SceneNode, theme: DeckTheme, labels: string[], given: number[]) {
    const { x, y, w, h } = frame;
    // Only finite values draw ("1e999" is Infinity, which made every bar NaN).
    const values = given.map((v) => (Number.isFinite(v) ? v : 0));
    const count = Math.max(1, values.length);
    const max = Math.max(1, ...values.map((v) => Math.abs(v)));
    const bw = Math.min(160, (w / count) * 0.6);
    const gap = (w - bw * count) / (count + 1);
    b.add(makeNode(b.doc, "rect", { x, y: y + h - 64, w, h: 3 }, frame.id, { name: "Axis", fills: [solid(theme.muted)] }));
    values.forEach((v, i) => {
        const bh = Math.max(2, ((h - 120) * Math.max(0, v)) / max);
        const bx = x + gap + i * (bw + gap);
        const name = labels[i] ?? String(i + 1);
        b.add(makeNode(b.doc, "rect", { x: bx, y: y + h - 64 - bh, w: bw, h: bh }, frame.id, { name: `Bar ${name}`, fills: [solid(theme.accent)], radius: 8 }));
        b.add(label(b.doc, frame.id, bx - 20, y + h - 50, bw + 40, name, 28, theme.muted, { textAlign: "center", fontFamily: theme.bodyFont }));
        b.add(label(b.doc, frame.id, bx - 20, y + h - 64 - bh - 44, bw + 40, String(v), 28, theme.text, { textAlign: "center", fontFamily: theme.bodyFont, fontWeight: 700 }));
    });
}

function chartNodes(b: Builder, slide: SceneNode, theme: DeckTheme) {
    const w = 1200;
    const h = 600;
    const x = slide.x + (slide.w - w) / 2;
    const y = slide.y + (slide.h - h) / 2;
    const frame = b.add(makeNode(b.doc, "frame", { x, y, w, h }, slide.id, { name: "Chart", fills: [], clip: false, deck: { kind: "chart", ...SAMPLE_CHART } }));
    chartLayers(b, frame, theme, SAMPLE_CHART.labels, SAMPLE_CHART.values);
    return frame;
}

// The chart's data, from its deck data (charts made before it was kept: read from the bars).
export function chartData(doc: NagmaDocument, frame: SceneNode): { labels: string[]; values: number[] } {
    if (frame.deck?.kind === "chart" && frame.deck.values) return { labels: frame.deck.labels ?? [], values: frame.deck.values };
    const kids = frame.children.map((c) => doc.nodes[c]).filter((n): n is SceneNode => Boolean(n));
    const bars = kids.filter((n) => n.name.startsWith("Bar "));
    const values = bars.map((bar) => Number(kids.find((t) => t.type === "text" && Math.abs(t.y + 44 - bar.y) < 2 && Math.abs(t.x + 20 - bar.x) < 2)?.text ?? 0) || 0);
    return { labels: bars.map((bar) => bar.name.slice(4)), values };
}

// Draws the chart again from new data.
export function setChartData(frameId: string, labels: string[], given: number[]) {
    const values = given.map((v) => (Number.isFinite(v) ? v : 0));
    const s = editor.get();
    const frame = s.doc.nodes[frameId];
    if (!frame || frame.deck?.kind !== "chart" || s.readOnly) return;
    const b = new Builder(s.doc);
    b.commands.push({ type: "node.delete", ids: [...frame.children] });
    b.commands.push({ type: "node.update", id: frameId, patch: { deck: { kind: "chart", labels, values } } });
    chartLayers(b, frame, themeOf(s.doc, slideAround(s.doc, frameId)?.id), labels, values);
    editor.execute({ type: "batch", commands: b.commands });
    // The old bars are gone: the chart itself stays selected.
    editor.set({ selection: [frameId] });
}

// ---- Tables ----

// Adds a row at the bottom or a column at the right (in the last one's look), or removes the last.
export function editTable(tableId: string, op: "add-row" | "add-column" | "remove-row" | "remove-column") {
    const s = editor.get();
    const table = s.doc.nodes[tableId];
    if (!table || s.readOnly) return;
    const model = tableModel(s.doc, table);
    if (op === "add-row") insertRow(tableId, model.rows.length);
    else if (op === "add-column") insertColumn(tableId, model.cols.length);
    else if (op === "remove-row") deleteRows(tableId, [model.rows.length - 1]);
    else deleteColumns(tableId, [model.cols.length - 1]);
}

function shapeWithText(b: Builder, slide: SceneNode, theme: DeckTheme, kind: ShapeKind) {
    const { w, h } = shapeSize(kind);
    const x = slide.x + (slide.w - w) / 2;
    const y = slide.y + (slide.h - h) / 2;
    const stretch = { constraints: { h: "left-right" as const, v: "top-bottom" as const } };
    const name = TEXT_SHAPES.find((t) => t.id === kind)?.label.replace(" with text", "") ?? "Shape";
    const frame = b.add(makeNode(b.doc, "frame", { x, y, w, h }, slide.id, { name, fills: [], clip: false }));
    const fill = [solid(theme.accent)];
    const outline = OUTLINES[kind];
    if (kind === "text-ellipse") b.add(makeNode(b.doc, "ellipse", { x, y, w, h }, frame.id, { name: "Shape", fills: fill, ...stretch }));
    else if (kind === "text-diamond" || kind === "text-star") {
        const shape = makeNode(b.doc, "vector", { x, y, w, h }, frame.id, { name: "Shape", fills: fill, strokes: [], parametric: kind === "text-star" ? { kind: "star", count: 5, ratio: 0.382 } : { kind: "polygon", count: 4, ratio: 0.382 }, ...stretch });
        b.add({ ...shape, path: parametricPath(shape) });
    } else if (outline) {
        const path = { w, h, subpaths: [{ closed: true, points: outline.map(([px, py]) => ({ x: px * w, y: py * h, in: null, out: null })) }] };
        b.add(makeNode(b.doc, "vector", { x, y, w, h }, frame.id, { name: "Shape", fills: fill, strokes: [], path, ...stretch }));
    } else b.add(makeNode(b.doc, "rect", { x, y, w, h }, frame.id, { name: "Shape", fills: fill, radius: kind === "text-rounded" ? 40 : 0, ...stretch }));
    const pad = textInset(kind, w, h);
    b.add(
        label(b.doc, frame.id, x + pad.l, y + pad.t, w - pad.l - pad.r, "Text", 40, theme.background, {
            name: "Text",
            h: h - pad.t - pad.b,
            textAlign: "center",
            textAlignV: "middle",
            sizing: { h: "fixed", v: "fixed" },
            fontFamily: theme.bodyFont,
            fontWeight: 600,
            ...stretch,
        }),
    );
    return frame;
}

// Live widgets draw as a card on the slide; while presenting, the card takes answers.
function cardNodes(b: Builder, slide: SceneNode, theme: DeckTheme, kind: LiveKind, url = "https://example.com", prototype?: { file: string; frame: string; name: string }) {
    const w = kind === "stamps" ? 1400 : kind === "facepile" ? 900 : kind === "video-link" ? 1280 : 1100;
    const h = kind === "poll" ? 620 : kind === "scale" ? 420 : kind === "facepile" ? 260 : 720;
    const x = slide.x + (slide.w - w) / 2;
    const y = slide.y + (slide.h - h) / 2;
    const data: DeckData =
        kind === "poll"
            ? { kind, question: "What should we do next?", options: ["Option A", "Option B", "Option C"], votes: {} }
            : kind === "scale"
              ? { kind, question: "How confident are we?", left: "Not at all", right: "Very", votes: {} }
              : kind === "stamps"
                ? { kind, prompt: "Stamp your reaction", stamps: [] }
                : kind === "facepile"
                  ? { kind }
                  : kind === "video-link"
                    ? { kind, url: url === "https://example.com" ? "" : url, autoplay: false }
                    : { kind, url, ...(prototype ? { prototype } : {}) };
    const name = kind === "poll" ? "Poll" : kind === "scale" ? "Alignment scale" : kind === "stamps" ? "Live stamps" : kind === "facepile" ? "Facepile" : kind === "video-link" ? "Video" : prototype ? "Prototype" : "Embed";
    const surface = kind === "video-link" ? "#111111" : theme.surface;
    const card = b.add(makeNode(b.doc, "frame", { x, y, w, h }, slide.id, { name, fills: [solid(surface)], radius: kind === "facepile" ? h / 2 : 28, clip: true, deck: data }));
    const title =
        data.kind === "poll" || data.kind === "scale" ? data.question : data.kind === "stamps" ? data.prompt : data.kind === "facepile" ? "Watching now" : data.kind === "video-link" ? data.url || "Paste a video link in the right panel" : prototype ? prototype.name : data.kind === "embed" ? data.url : "";
    if (data.kind !== "facepile") b.add(label(b.doc, card.id, x + 56, y + 48, w - 112, title, 44, kind === "video-link" ? "#FFFFFF" : theme.text, { name: "Question", fontFamily: theme.headingFont, fontWeight: 700 }));
    if (data.kind === "poll") {
        pollRows(b, card, theme, data.options);
    } else if (data.kind === "scale") {
        b.add(makeNode(b.doc, "rect", { x: x + 80, y: y + 220, w: w - 160, h: 12 }, card.id, { name: "Track", fills: [solid(theme.muted)], radius: 6 }));
        b.add(label(b.doc, card.id, x + 56, y + 290, 400, data.left, 32, theme.muted, { name: "Left label", fontFamily: theme.bodyFont }));
        b.add(label(b.doc, card.id, x + w - 456, y + 290, 400, data.right, 32, theme.muted, { name: "Right label", fontFamily: theme.bodyFont, textAlign: "right" }));
    } else if (data.kind === "stamps") {
        b.add(label(b.doc, card.id, x + 56, y + h - 100, w - 112, "Click anywhere on the card to stamp while presenting", 28, theme.muted, { name: "Hint", fontFamily: theme.bodyFont }));
    } else if (data.kind === "facepile") {
        // Circles standing in for the audience's faces.
        for (let i = 0; i < 5; i++) b.add(makeNode(b.doc, "ellipse", { x: x + 60 + i * 110, y: y + 60, w: 140, h: 140 }, card.id, { name: `Face ${i + 1}`, fills: [solid(i % 2 ? theme.muted : theme.accent)], strokes: [solid(theme.surface)], strokeWidth: 8 }));
        b.add(label(b.doc, card.id, x + 640, y + 104, 220, "+ more", 36, theme.muted, { name: "Count", fontFamily: theme.bodyFont }));
    } else if (data.kind === "video-link") {
        const play = makeNode(b.doc, "vector", { x: x + w / 2 - 60, y: y + h / 2 - 70, w: 120, h: 140 }, card.id, { name: "Play", fills: [solid("#FFFFFF")], strokes: [], parametric: { kind: "polygon", count: 3, ratio: 0.5 }, rotation: 90 });
        b.add({ ...play, path: parametricPath(play) });
        b.add(label(b.doc, card.id, x + 56, y + h - 100, w - 112, "Plays here while presenting", 28, "#BBBBBB", { name: "Hint", fontFamily: theme.bodyFont }));
    } else {
        b.add(label(b.doc, card.id, x + 56, y + 140, w - 112, prototype ? "The prototype runs here while presenting." : "Shows the page live while presenting. Change the address in the card's settings.", 30, theme.muted, { name: "Hint", fontFamily: theme.bodyFont }));
    }
    return card;
}

// Pasted spreadsheet cells (tab-separated) or a dropped CSV become a table on the slide on screen.
export function insertTable(data: string[][]) {
    const s = editor.get();
    const slideId = currentSlide();
    const slide = slideId ? s.doc.nodes[slideId] : undefined;
    if (!slide || s.readOnly) return;
    // Up to MAX_CELLS cells: as many rows as fit at the pasted width.
    const width = Math.min(MAX_CELLS, Math.max(1, ...data.map((r) => r.length)));
    const cells = data.slice(0, Math.max(1, Math.floor(MAX_CELLS / width))).map((r) => r.slice(0, width));
    if (data.length * Math.max(...data.map((r) => r.length)) > MAX_CELLS) editor.notify(`Tables hold up to ${MAX_CELLS} cells; the rest was left out.`);
    const b = new Builder(s.doc);
    const made = tableNodes(b, slide, themeOf(s.doc, slide.id), cells);
    editor.execute({ type: "batch", commands: b.commands });
    // Selecting the new table joins the same undo step (the store folds it in).
    editor.set({ selection: [made.id], tool: "move" });
}

// Rows of a CSV file (quoted fields may hold commas, quotes and line breaks).
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") {
            row.push(field);
            field = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else field += ch;
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((f) => f.trim()));
}

// The poll's option rows (what the slide, its thumbnail and exports show) for these options.
function pollRows(b: Builder, card: SceneNode, theme: DeckTheme, options: string[]) {
    const { x, y, w } = card;
    options.forEach((option, i) => {
        const row = b.add(makeNode(b.doc, "rect", { x: x + 56, y: y + 160 + i * 130, w: w - 112, h: 104 }, card.id, { name: `Option ${i + 1}`, fills: [solid(theme.background)], radius: 16 }));
        b.add(label(b.doc, card.id, row.x + 36, row.y + 30, row.w - 72, option, 36, theme.text, { name: `Option ${i + 1} label`, fontFamily: theme.bodyFont }));
    });
}

// New options for a poll: its rows are drawn again (added options had no row, removed ones kept
// theirs) and the votes follow their options. One undo step.
export function setPollOptions(cardId: string, options: string[]) {
    const s = editor.get();
    const card = s.doc.nodes[cardId];
    const data = card?.deck;
    if (!card || data?.kind !== "poll" || s.readOnly || !options.length) return;
    const b = new Builder(s.doc);
    const old = card.children.filter((id) => /^Option \d+( label)?$/.test(s.doc.nodes[id]?.name ?? ""));
    if (old.length) b.commands.push({ type: "node.delete", ids: old });
    // The card grows to hold every row.
    b.commands.push({ type: "node.update", id: cardId, patch: { h: Math.max(620, 160 + options.length * 130 + 60), deck: { ...data, options, votes: remapVotes(data.votes, data.options, options) } } });
    pollRows(b, card, themeOf(s.doc, slideAround(s.doc, cardId)?.id), options);
    editor.execute({ type: "batch", commands: b.commands });
}

// Poll votes are kept by option index: when the options are edited, a vote follows its option's
// text to its new place and is dropped with a removed option (votes moved onto other options).
export function remapVotes(votes: Record<string, number>, before: string[], after: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [who, i] of Object.entries(votes)) {
        const text = before[i];
        const at = text === undefined ? -1 : after.indexOf(text);
        if (at >= 0) out[who] = at;
    }
    return out;
}

// A video page link plays in its embeddable form.
export function embeddable(url: string): string {
    const yt = url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([\w-]{6,})/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vimeo = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    return url;
}

// The player address for a video element: from its start time, playing by itself if asked.
// A link typed without its scheme ("youtube.com/embed/...") gets https; anything that isn't a web
// address plays nothing (a bad link used to throw and take the whole presentation down).
export function videoEmbedUrl(input: string, start = 0, autoplay = false): string {
    const url = /^[a-z][\w+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
    let out: URL;
    try {
        out = new URL(embeddable(url));
    } catch {
        return "about:blank";
    }
    if (out.protocol !== "https:" && out.protocol !== "http:") return "about:blank";
    if (embeddable(url) === url && !/\/embed\/|player\./.test(url)) return out.toString();
    if (start > 0) out.searchParams.set("start", String(Math.round(start)));
    if (autoplay) out.searchParams.set("autoplay", "1");
    if (start > 0 && out.hostname.includes("vimeo")) out.hash = `t=${Math.round(start)}s`;
    return out.toString();
}

// Video site links (watch pages, short links, embeds).
export function isVideoLink(url: string): boolean {
    return /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/|(?:player\.)?vimeo\.com\/)/.test(url);
}

// A pasted link becomes an embed that shows the page live while presenting (a video link, a
// video element); a prototype from a design file is an embed that knows which one it shows.
export function insertEmbed(url: string, prototype?: { file: string; frame: string; name: string }) {
    const s = editor.get();
    const slideId = currentSlide();
    const slide = slideId ? s.doc.nodes[slideId] : undefined;
    if (!slide || s.readOnly) return;
    const b = new Builder(s.doc);
    const video = !prototype && isVideoLink(url);
    const made = cardNodes(b, slide, themeOf(s.doc, slide.id), video ? "video-link" : "embed", video ? url : embeddable(url), prototype);
    editor.execute({ type: "batch", commands: b.commands });
    editor.set({ selection: [made.id], tool: "move" });
}

// Puts a widget in the middle of the slide on screen and selects it.
export function insertWidget(kind: WidgetKind) {
    const s = editor.get();
    const slideId = currentSlide();
    const slide = slideId ? s.doc.nodes[slideId] : undefined;
    if (!slide || s.readOnly) return;
    const theme = themeOf(s.doc, slide.id);
    const b = new Builder(s.doc);
    const made =
        kind === "table"
            ? tableNodes(b, slide, theme)
            : kind === "code"
              ? codeNodes(b, slide)
              : kind === "chart"
                ? chartNodes(b, slide, theme)
                : kind.startsWith("text-")
                  ? shapeWithText(b, slide, theme, kind as ShapeKind)
                  : cardNodes(b, slide, theme, kind as LiveKind);
    editor.execute({ type: "batch", commands: b.commands });
    editor.set({ selection: [made.id], tool: "move" });
}

// ---- Code highlighting ----

export const CODE_LANGUAGES: { id: string; label: string }[] = [
    { id: "js", label: "JavaScript" },
    { id: "ts", label: "TypeScript" },
    { id: "py", label: "Python" },
    { id: "html", label: "HTML" },
    { id: "css", label: "CSS" },
    { id: "json", label: "JSON" },
    { id: "rust", label: "Rust" },
    { id: "go", label: "Go" },
    { id: "swift", label: "Swift" },
    { id: "kotlin", label: "Kotlin" },
    { id: "sql", label: "SQL" },
    { id: "sh", label: "Shell" },
    { id: "plain", label: "Plain text" },
];

const words = (list: string) => new Set(list.split(" "));
const JS = "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of true false null undefined this yield static get set super delete void";
const KEYWORDS: Record<string, Set<string>> = {
    js: words(JS),
    ts: words(`${JS} type interface enum implements private public protected readonly as keyof declare namespace abstract any number string boolean never unknown`),
    py: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield None True False global nonlocal async await print self"),
    rust: words("fn let mut pub struct enum impl trait use mod crate self Self match if else for while loop return break continue as ref move where true false const static unsafe async await dyn"),
    go: words("func package import var const type struct interface map chan go defer return if else for range switch case default break continue select true false nil"),
    swift: words("func let var class struct enum protocol extension import return if else guard for in while switch case default break continue true false nil self init deinit public private static async await throws try"),
    kotlin: words("fun val var class object interface data sealed import package return if else when for in while do break continue true false null this init private public override suspend"),
    sql: words("select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct null is in like count sum avg primary key"),
    sh: words("if then else elif fi for in do done while case esac function return export local echo cd exit"),
    css: new Set<string>(),
    html: new Set<string>(),
    json: words("true false null"),
    plain: new Set<string>(),
};

const PALETTES = {
    dark: { keyword: "#FF7AB2", string: "#FC6A5D", comment: "#7F8C98", number: "#D9C97C", fn: "#67B7A4", tag: "#5DD8FF", plain: "#E6E6E6", background: "#1E1E24" },
    light: { keyword: "#AD3DA4", string: "#D12F1B", comment: "#707F8C", number: "#272AD8", fn: "#3E8087", tag: "#0B4F79", plain: "#1F1F24", background: "#F6F7F9" },
};

export function codeColors(theme: "dark" | "light" = "dark") {
    return PALETTES[theme];
}

// Coloured runs for code in a language: keywords, strings, comments, numbers, called functions,
// and tags or properties for markup and stylesheets.
export function highlight(code: string, lang = "js", theme: "dark" | "light" = "dark"): TextSpan[] {
    const spans: TextSpan[] = [];
    if (lang === "plain") return spans;
    const colors = PALETTES[theme];
    const keywords = KEYWORDS[lang] ?? KEYWORDS.js ?? new Set<string>();
    const hashComments = lang === "py" || lang === "sh";
    const comment = lang === "sql" ? "--[^\\n]*" : hashComments ? "#[^\\n]*" : lang === "html" ? "<!--[\\s\\S]*?-->" : lang === "json" ? "(?!)" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const tag = lang === "html" ? "<\\/?[A-Za-z][\\w-]*" : lang === "css" ? "[.#]?[A-Za-z-][\\w-]*(?=\\s*[:{,])" : "(?!)";
    const re = new RegExp(`(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(${tag})|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
        if (!m[0]) {
            re.lastIndex++;
            continue;
        }
        const start = m.index;
        const end = start + m[0].length;
        let color: string | null = null;
        if (m[1]) color = colors.comment;
        else if (m[2]) color = colors.string;
        else if (m[3]) color = colors.tag;
        else if (m[4]) color = colors.number;
        else if (m[5]) {
            const word = lang === "sql" ? m[5].toLowerCase() : m[5];
            if (keywords.has(word)) color = colors.keyword;
            else if (code[end] === "(") color = colors.fn;
        }
        if (color) spans.push({ start, end, fills: [solid(color)] });
    }
    return spans;
}

// Changes a code block's language or colour theme, colouring it again.
export function setCodeStyle(textId: string, patch: { lang?: string; theme?: "dark" | "light" }) {
    const s = editor.get();
    const node = s.doc.nodes[textId];
    if (!node || node.deck?.kind !== "code" || s.readOnly) return;
    const data = { ...node.deck, ...patch };
    const colors = codeColors(data.theme);
    const commands: Command[] = [{ type: "node.update", id: textId, patch: { deck: data, fills: [solid(colors.plain)], spans: highlight(node.text ?? "", data.lang, data.theme) } }];
    const frame = node.parentId ? s.doc.nodes[node.parentId] : undefined;
    if (frame && frame.type === "frame" && patch.theme) commands.push({ type: "node.update", id: frame.id, patch: { fills: [solid(colors.background)] } });
    editor.execute({ type: "batch", commands });
}

// Code blocks colour themselves again after their text changes. The blocks waiting add up, so a
// second edit within the wait doesn't drop the first block's re-colouring.
let pending = 0;
const waiting = new Set<string>();
editor.onCommit((before, after) => {
    if (!after.slides) return;
    let any = false;
    for (const node of Object.values(after.nodes)) {
        if (node.deck?.kind !== "code" || node.type !== "text") continue;
        const old = before.nodes[node.id];
        if (old && old.text === node.text) continue;
        waiting.add(node.id);
        any = true;
    }
    if (!any) return;
    window.clearTimeout(pending);
    const run = () => {
        const s = editor.get();
        if (s.readOnly) return;
        // Wait until typing is done.
        if (s.editingTextId) {
            pending = window.setTimeout(run, 400);
            return;
        }
        const commands: Command[] = [];
        for (const id of waiting) {
            const node = s.doc.nodes[id];
            if (node?.type === "text" && node.deck?.kind === "code") commands.push({ type: "node.update", id: node.id, patch: { spans: highlight(node.text ?? "", node.deck.lang, node.deck.theme) } });
        }
        waiting.clear();
        if (commands.length) editor.executeSilently({ type: "batch", commands });
    };
    pending = window.setTimeout(run, 300);
});

// ---- Slide numbers ----

// A slide number put anywhere on the slide (it reads the slide's place in the deck, kept up to date).
export function insertSlideNumber() {
    const s = editor.get();
    const slideId = currentSlide();
    const slide = slideId ? s.doc.nodes[slideId] : undefined;
    if (!slide || s.readOnly) return;
    const theme = themeOf(s.doc, slide.id);
    const node = makeNode(s.doc, "text", { x: slide.x + slide.w / 2 - 120, y: slide.y + slide.h - 120, w: 240, h: 30 }, slide.id, {
        name: "Slide number",
        text: "",
        fontSize: roleSize("slide-number"),
        sizing: { h: "fixed", v: "hug" },
        textAlign: "center",
        ...roleStyle(theme, "slide-number"),
        deck: { kind: "text", role: "slide-number", placed: true, format: deckOf(s.doc).numberFormat ?? "plain" },
    });
    editor.execute(deckBatch(s.doc, [{ type: "node.create", node }]));
    editor.set({ selection: [node.id], tool: "move" });
}

// Puts a copy of a placed slide number, at the same spot, on every slide that has none.
export function numberAllSlides(textId: string) {
    const s = editor.get();
    const source = s.doc.nodes[textId];
    const from = slideAround(s.doc, textId);
    if (!source || !from || s.readOnly) return;
    const commands: Command[] = [];
    for (const id of slideIds(s.doc)) {
        const slide = s.doc.nodes[id];
        if (!slide || id === from.id) continue;
        const has = slide.children.some((c) => {
            const d = s.doc.nodes[c]?.deck;
            return d?.kind === "text" && d.role === "slide-number" && d.placed;
        });
        if (has) continue;
        const copy = cloneSubtree(s.doc, textId, 0, id)[0];
        if (copy) commands.push({ type: "node.create", node: { ...copy, children: [], x: slide.x + (source.x - from.x), y: slide.y + (source.y - from.y), ...roleStyle(themeOf(s.doc, id), "slide-number") } });
    }
    if (commands.length) editor.execute(deckBatch(s.doc, commands));
    editor.notify(commands.length ? `Slide numbers added to ${commands.length} slide${commands.length === 1 ? "" : "s"}.` : "Every slide has a slide number.");
}

export function setNumberFormatOf(textId: string, format: NumberFormat) {
    const s = editor.get();
    const node = s.doc.nodes[textId];
    if (node?.deck?.kind !== "text") return;
    editor.execute(deckBatch(s.doc, [{ type: "node.update", id: textId, patch: { deck: { ...node.deck, format } } }]));
}

// ---- Live answers ----

type Answers = Extract<DeckData, { kind: "poll" | "scale" }>;
type Stamps = Extract<DeckData, { kind: "stamps" }>;

// Your answer to a poll or scale, written over what the layer holds now and kept even when
// someone answering at the same moment writes on top of it (engine/reassert.ts); before, one of
// two answers given together was lost.
export function answer(id: string, me: string, value: number) {
    const live = (doc: NagmaDocument) => {
        const d = doc.nodes[id]?.deck;
        return d?.kind === "poll" || d?.kind === "scale" ? (d as Answers) : null;
    };
    const restore = (doc: NagmaDocument): Command | null => {
        const d = live(doc);
        if (!d || d.votes[me] === value) return null;
        return { type: "node.update", id, patch: { deck: { ...d, votes: { ...d.votes, [me]: value } } as DeckData } };
    };
    const now = restore(editor.get().doc);
    if (now) editor.execute(now);
    reassert(`slides-answer:${id}:${me}`, { alive: (doc) => Boolean(live(doc)), restore });
}

// A stamp on a live stamps card, kept the same way.
export function addStamp(id: string, stamp: Stamps["stamps"][number]) {
    const live = (doc: NagmaDocument) => {
        const d = doc.nodes[id]?.deck;
        return d?.kind === "stamps" ? d : null;
    };
    const restore = (doc: NagmaDocument): Command | null => {
        const d = live(doc);
        if (!d || d.stamps.some((s) => s.id === stamp.id)) return null;
        return { type: "node.update", id, patch: { deck: { ...d, stamps: [...d.stamps, stamp] } } };
    };
    const now = restore(editor.get().doc);
    if (now) editor.execute(now);
    reassert(`slides-stamp:${id}:${stamp.id}`, { alive: (doc) => Boolean(live(doc)), restore });
}

import type { Rect } from "./model";

// A page's text layer from the engine: one box per glyph (view space), in reading order, with
// the line each sits on and whether a word break comes before it. Search, selection and the text
// markup tools all work from it.

export interface TextLayer {
    boxes: number[];
    text: string[];
    line: number[];
    space: boolean[];
    // The page's text as one string, and for each of its characters the glyph it came from (-1
    // for spaces and line breaks added between glyphs).
    joined: string;
    glyphAt: number[];
    // Where each glyph starts in `joined`.
    startOf: number[];
}

export function buildTextLayer(raw: { boxes: number[]; text: string[]; line: number[]; space: boolean[] }): TextLayer {
    let joined = "";
    const glyphAt: number[] = [];
    const startOf: number[] = [];
    raw.text.forEach((t, i) => {
        if (i > 0) {
            const brk = raw.line[i] !== raw.line[i - 1] ? "\n" : raw.space[i] ? " " : "";
            if (brk) {
                joined += brk;
                glyphAt.push(-1);
            }
        }
        startOf.push(joined.length);
        for (let k = 0; k < t.length; k++) glyphAt.push(i);
        joined += t;
    });
    return { ...raw, joined, glyphAt, startOf };
}

export function glyphRect(layer: TextLayer, i: number): Rect {
    const b = layer.boxes;
    return [b[i * 4] ?? 0, b[i * 4 + 1] ?? 0, b[i * 4 + 2] ?? 0, b[i * 4 + 3] ?? 0];
}

// The glyph under (or nearest to) a point, within `slack` points.
export function glyphAtPoint(layer: TextLayer, x: number, y: number, slack = 12): number | null {
    let best: number | null = null;
    let bestDist = slack;
    for (let i = 0; i < layer.text.length; i++) {
        const [x0, y0, x1, y1] = glyphRect(layer, i);
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
        // Being on the line matters more than being near the glyph sideways.
        const d = dx + dy * 3;
        if (d < bestDist || (d === 0 && best === null)) {
            best = i;
            bestDist = d;
            if (d === 0) break;
        }
    }
    return best;
}

// One rectangle per line for glyphs `from..=to`.
export function rangeRects(layer: TextLayer, from: number, to: number): Rect[] {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const rects = new Map<number, Rect>();
    for (let i = a; i <= b && i < layer.text.length; i++) {
        if (!layer.text[i]?.trim()) continue;
        const r = glyphRect(layer, i);
        const line = layer.line[i] ?? 0;
        const cur = rects.get(line);
        rects.set(line, cur ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])] : r);
    }
    return [...rects.values()];
}

export function rangeText(layer: TextLayer, from: number, to: number): string {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const start = layer.startOf[a] ?? 0;
    const endGlyph = layer.startOf[b] ?? 0;
    return layer.joined.slice(start, endGlyph + (layer.text[b]?.length ?? 1));
}

export interface SearchHit {
    page: number;
    from: number;
    to: number;
    rects: Rect[];
}

export function findInLayer(layer: TextLayer, page: number, query: string, caseSensitive = false): SearchHit[] {
    const q = caseSensitive ? query : query.toLowerCase();
    if (!q.trim()) return [];
    const hay = caseSensitive ? layer.joined : layer.joined.toLowerCase();
    const hits: SearchHit[] = [];
    let at = hay.indexOf(q);
    while (at >= 0 && hits.length < 500) {
        let from = -1;
        let to = -1;
        for (let k = at; k < at + q.length; k++) {
            const g = layer.glyphAt[k] ?? -1;
            if (g < 0) continue;
            if (from < 0) from = g;
            to = g;
        }
        if (from >= 0) hits.push({ page, from, to, rects: rangeRects(layer, from, to) });
        at = hay.indexOf(q, at + Math.max(1, q.length));
    }
    return hits;
}

// A line of text on a page, as the workbench lists it (textLines).
export type TextLine = { text: string; rect: [number, number, number, number]; size: number; font: string; decodable: boolean };

// Breaks text into lines no wider than `width`, measured like the page's own text.
function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (line && measure(next) > width) {
                out.push(line);
                line = word;
            } else line = next;
        }
        out.push(line);
    }
    return out;
}

// The edit that puts `text` in place of a paragraph's lines (`picked`), wrapped to its width
// (`right` is its right edge): each line gets its share, lines left over are emptied, and more lines
// than before go below in the same size. One batch, so one Undo puts the paragraph back. Null
// when the text is unchanged.
export function paragraphEdit(lines: TextLine[], picked: number[], index: number, text: string, right: number, measure: (s: string) => number): Record<string, unknown> | null {
    const parts = picked.map((i) => lines[i]).filter((l): l is TextLine => Boolean(l));
    const first = parts[0];
    if (!first) return null;
    const original = parts.map((l) => l.text).join(" ");
    if (text.replace(/\s+/g, " ").trim() === original.replace(/\s+/g, " ").trim()) return null;
    const left = Math.min(...parts.map((l) => l.rect[0]));
    const top = Math.min(...parts.map((l) => l.rect[1]));
    // How the page's font compares with the one measured here.
    const ratio = parts.reduce((a, l) => a + (l.rect[2] - l.rect[0]), 0) / Math.max(1, parts.reduce((a, l) => a + measure(l.text), 0));
    const wrapped = wrapText(text, right - left, (s) => measure(s) * (ratio || 1));
    const step = parts.length > 1 ? ((parts[parts.length - 1] as TextLine).rect[1] - first.rect[1]) / (parts.length - 1) : first.size * 1.25;
    const edits: Record<string, unknown>[] = picked.map((line, k) => ({ op: "editTextLine", page: index, line, text: wrapped[k] ?? "" }));
    for (let k = picked.length; k < wrapped.length; k++) {
        const y = top + step * k;
        edits.push({ op: "addText", page: index, rect: [left, y, right, y + first.size * 1.3], text: wrapped[k] ?? "", size: first.size });
    }
    return { op: "batch", label: "Edit paragraph", edits };
}

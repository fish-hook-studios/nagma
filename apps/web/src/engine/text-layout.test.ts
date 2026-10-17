import { describe, expect, it } from "vitest";
import { makeNode } from "./nodes";
import { textSize } from "./text";
import { caretAt, casedText, indexAt, layoutText, listMarker, rangeRects, verticalOffset } from "./text-layout";
import type { SceneNode } from "./types";
import { PAGE, emptyDoc } from "../test/core-fixtures";

// jsdom has no canvas, so text is measured with the fixed-width fallback: every character is half
// the font size wide. At 10px that is 5px a character; auto line height is 1.21 × 10 = 12.1.
const CH = 5;
const LH = 12.1;

function text(content: string, extra: Partial<SceneNode> = {}): SceneNode {
    return makeNode(emptyDoc(), "text", { x: 0, y: 0, w: 100, h: 20 }, PAGE, { text: content, fontSize: 10, ...extra });
}
const fixed = (content: string, w: number, extra: Partial<SceneNode> = {}) => text(content, { w, sizing: { h: "fixed", v: "hug" }, ...extra });
const lineTexts = (n: SceneNode) => layoutText(n).lines.map((l) => (n.text ?? "").slice(l.start, l.end));

describe("text layout: sizing and wrapping", () => {
    it("auto width is the longest line, one line per paragraph", () => {
        const l = layoutText(text("Hello"));
        expect(l.lines).toHaveLength(1);
        expect(l.width).toBe(5 * CH);
        expect(l.height).toBeCloseTo(LH, 9);
        expect(textSize(text("Hello"))).toEqual({ w: 25, h: 13 });
        const two = text("ab\nlonger");
        expect(layoutText(two).lines).toHaveLength(2);
        expect(textSize(two)).toEqual({ w: 30, h: Math.ceil(2 * LH) });
    });

    it("wraps at spaces at a fixed width; trailing spaces don't count", () => {
        const n = fixed("aaaa bbbb cccc", 50);
        expect(lineTexts(n)).toEqual(["aaaa bbbb ", "cccc"]);
        const l = layoutText(n);
        expect(l.lines[0]!.width).toBe(9 * CH);
        expect(l.width).toBe(50);
        expect(textSize(n)).toEqual({ w: 50, h: Math.ceil(2 * LH) });
    });

    it.each([
        [100, 1],
        [45, 2],
        [20, 3],
    ])("width %i gives %i lines", (w, count) => {
        expect(layoutText(fixed("aaaa bbbb cccc", w)).lines).toHaveLength(count);
    });

    it("splits a word wider than the box", () => {
        const n = fixed("abcdefghij", 20);
        expect(lineTexts(n)).toEqual(["abcd", "efgh", "ij"]);
    });

    it("breaks between CJK characters", () => {
        expect(layoutText(fixed("漢字漢字漢字", 15)).lines).toHaveLength(2);
    });

    it("soft line breaks split a paragraph without starting a new one", () => {
        const l = layoutText(text("one two"));
        expect(l.lines).toHaveLength(2);
        expect(l.lines[1]!.paragraphStart).toBe(false);
        expect(l.lines.map((x) => x.paragraph)).toEqual([0, 0]);
    });

    it("explicit line height and paragraph spacing", () => {
        const l = layoutText(text("a\nb", { lineHeight: 2, paragraphSpacing: 7 }));
        expect(l.lines[0]!.height).toBe(20);
        expect(l.lines[1]!.top).toBe(27);
        expect(l.height).toBe(47);
    });

    it("empty text is one empty line with the font's height", () => {
        const l = layoutText(text(""));
        expect(l.lines).toHaveLength(1);
        expect(l.lines[0]).toMatchObject({ start: 0, end: 0, width: 0 });
        expect(l.height).toBeCloseTo(LH, 9);
        expect(textSize(text(""))).toEqual({ w: 1, h: 13 });
        expect(caretAt(l, 0)).toMatchObject({ lineIndex: 0, x: 0 });
        expect(indexAt(l, 50, 50)).toBe(0);
    });

    it("a trailing newline adds an empty last line", () => {
        expect(layoutText(text("abc\n")).lines).toHaveLength(2);
    });

    it("letter spacing widens every character", () => {
        expect(layoutText(text("abcd", { letterSpacing: 10 })).width).toBe(4 * CH + 4 * 1);
    });
});

describe("text layout: alignment", () => {
    it.each([
        ["left", 0],
        ["center", 40],
        ["right", 80],
    ] as const)("%s puts a 20px line at %i in a 100px box", (align, x) => {
        const l = layoutText(fixed("abcd", 100, { textAlign: align }));
        expect(l.lines[0]!.x).toBe(x);
        expect(l.lines[0]!.fragments[0]!.x).toBe(x);
    });

    it("justified lines stretch to the box, the paragraph's last line doesn't", () => {
        const l = layoutText(fixed("aa bb cc dd ee", 40, { textAlign: "justify" }));
        expect(l.lines.length).toBeGreaterThan(1);
        expect(l.lines[0]!.width).toBe(40);
        expect(l.lines.at(-1)!.width).toBeLessThan(40);
    });

    it("right to left runs fragments from the right edge", () => {
        const l = layoutText(fixed("abcd", 100, { direction: "rtl", textAlign: undefined }));
        expect(l.lines[0]!.x).toBe(80);
    });

    it("vertical alignment offsets the block in its box", () => {
        const n = text("a", { h: 50, sizing: { h: "fixed", v: "fixed" } });
        const l = layoutText(n);
        expect(verticalOffset({ ...n, textAlignV: "top" }, l)).toBe(0);
        expect(verticalOffset({ ...n, textAlignV: "middle" }, l)).toBeCloseTo((50 - LH) / 2, 9);
        expect(verticalOffset({ ...n, textAlignV: "bottom" }, l)).toBeCloseTo(50 - LH, 9);
    });
});

describe("text layout: truncation", () => {
    it("cuts after max lines with an ellipsis", () => {
        const n = fixed("aaaa bbbb cccc dddd", 50, { truncate: true, maxLines: 1 });
        const l = layoutText(n);
        expect(l.lines).toHaveLength(1);
        expect(l.truncatedAt).toBe(l.lines[0]!.end);
        const last = l.lines[0]!.fragments.at(-1)!;
        expect(last.text.endsWith("…")).toBe(true);
        expect(l.lines[0]!.width).toBeLessThanOrEqual(50);
    });

    it("max lines doesn't apply with truncation off, or when the text fits", () => {
        expect(layoutText(fixed("aaaa bbbb cccc dddd", 50, { truncate: false, maxLines: 1 })).lines).toHaveLength(2);
        expect(layoutText(fixed("aaaa", 50, { truncate: true, maxLines: 1 })).truncatedAt).toBeNull();
    });
});

describe("text layout: lists", () => {
    it.each([
        ["bullet", 1, 3, "•"],
        ["number", 1, 3, "3."],
        ["number", 2, 1, "a."],
        ["number", 2, 27, "aa."],
        ["number", 3, 4, "iv."],
        ["number", 4, 2, "2."],
    ] as const)("%s at level %i, item %i → %s", (list, level, n, marker) => {
        expect(listMarker(list, level, n)).toBe(marker);
    });

    it("numbers count per level and restart after plain text", () => {
        const n = text("one\ntwo\nsub\nthree\nplain\nfour", { paragraphs: [{ list: "number", level: 1 }, { list: "number", level: 1 }, { list: "number", level: 2 }, { list: "number", level: 1 }, { list: null }, { list: "number", level: 1 }] });
        expect(layoutText(n).lines.map((l) => l.marker?.text ?? null)).toEqual(["1.", "2.", "a.", "3.", null, "1."]);
    });

    it("list items are indented one level and the marker sits in the indent", () => {
        const l = layoutText(text("item", { list: "bullet" }));
        expect(l.lines[0]!.left).toBe(15);
        expect(l.lines[0]!.marker!.x).toBeLessThan(15);
        expect(l.lines[0]!.marker!.x).toBeGreaterThanOrEqual(0);
    });

    it("list spacing goes between items, paragraph spacing elsewhere", () => {
        const l = layoutText(text("a\nb\nc", { paragraphs: [{ list: "bullet" }, { list: "bullet" }, { list: null }], listSpacing: 3, paragraphSpacing: 9 }));
        expect(l.lines[1]!.top - l.lines[0]!.top).toBeCloseTo(LH + 3, 9);
        expect(l.lines[2]!.top - l.lines[1]!.top).toBeCloseTo(LH + 9, 9);
    });
});

describe("text layout: caret and hit testing", () => {
    const samples: [string, SceneNode][] = [
        ["one line", text("Hello world")],
        ["wrapped", fixed("aaaa bbbb cccc dddd", 50)],
        ["paragraphs", text("ab\n\ncd")],
        ["centred", fixed("ab cd ef", 30, { textAlign: "center" })],
    ];

    it.each(samples)("%s: indexAt(caretAt(i)) round trips", (_name, n) => {
        const l = layoutText(n);
        const length = (n.text ?? "").length;
        for (let i = 0; i <= length; i++) {
            const c = caretAt(l, i);
            expect(c).not.toBeNull();
            const back = indexAt(l, c!.x, c!.line.top + c!.line.height / 2);
            expect(back).toBe(i);
        }
    });

    it("at a wrap the caret goes to the next line, or stays with upstream", () => {
        const l = layoutText(fixed("aaaa bbbb", 25));
        const wrapAt = l.lines[0]!.end;
        expect(caretAt(l, wrapAt)!.lineIndex).toBe(1);
        expect(caretAt(l, wrapAt, true)!.lineIndex).toBe(0);
    });

    it("clicks past the end land at the end; above the text, on the first line", () => {
        const l = layoutText(text("abc\ndef"));
        expect(indexAt(l, 999, 999)).toBe(7);
        expect(indexAt(l, -10, -10)).toBe(0);
        expect(indexAt(l, 999, 1)).toBe(3);
    });

    it("range rectangles cover each line of the selection", () => {
        const l = layoutText(fixed("aaaa bbbb cccc", 50));
        const rects = rangeRects(l, 2, 12);
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ x: 2 * CH, y: 0 });
        expect(rects[1]!.y).toBeCloseTo(LH, 9);
        expect(rangeRects(l, 4, 4)).toEqual([]);
    });
});

describe("letter case", () => {
    it.each([
        ["upper", "hello world", "HELLO WORLD"],
        ["lower", "Hello World", "hello world"],
        ["title", "hello big world", "Hello Big World"],
        ["none", "MiXeD", "MiXeD"],
    ] as const)("%s", (mode, input, out) => {
        expect(casedText(input, mode)).toBe(out);
    });

    it("upper case keeps one character per character for layout (ß)", () => {
        const l = layoutText(text("straße", { textCase: "upper" }));
        expect(l.lines[0]!.fragments[0]!.text).toHaveLength(6);
    });
});

describe("text layout: random text", () => {
    function rng(seed: number) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 2 ** 32;
        };
    }
    const pieces = ["a", "bb", "word", " ", "  ", "\n", " ", "漢", "longwordwithoutspaces", "é", "—", "."];

    it.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i: lines cover the text in order and every index round trips", (seed) => {
        const r = rng(seed);
        const pick = <T,>(l: T[]): T => l[Math.floor(r() * l.length)] as T;
        const content = Array.from({ length: Math.floor(r() * 30) }, () => pick(pieces)).join("");
        const n = text(content, {
            w: 1 + Math.floor(r() * 120),
            sizing: r() < 0.3 ? { h: "hug", v: "hug" } : { h: "fixed", v: "hug" },
            textAlign: pick(["left", "center", "right", "justify"] as const),
            textWrap: pick(["auto", "balance", "pretty"] as const),
            list: pick([null, "bullet", "number"] as const),
            paragraphIndent: r() < 0.3 ? 7 : 0,
            letterSpacing: r() < 0.3 ? 5 : 0,
        });
        const l = layoutText(n);
        expect(l.lines.length).toBeGreaterThan(0);
        expect(l.lines[0]!.start).toBe(0);
        expect(l.lines.at(-1)!.end).toBe(content.length);
        for (let i = 1; i < l.lines.length; i++) {
            expect(l.lines[i]!.start).toBeGreaterThanOrEqual(l.lines[i - 1]!.end - 0);
            expect(l.lines[i]!.top).toBeGreaterThan(l.lines[i - 1]!.top);
        }
        for (const line of l.lines) for (const f of line.fragments) expect(Number.isFinite(f.x) && Number.isFinite(f.width)).toBe(true);
        expect(Number.isFinite(l.height) && Number.isFinite(l.width)).toBe(true);
        for (let i = 0; i <= content.length; i++) {
            const c = caretAt(l, i);
            expect(c).not.toBeNull();
            expect(Number.isFinite(c!.x)).toBe(true);
            // Indexes inside a line come back from a click at their caret (a wrap's two positions are the same spot).
            const back = indexAt(l, c!.x, c!.line.top + c!.line.height / 2);
            if (back !== i) {
                const other = caretAt(l, back);
                expect(Math.abs(other!.x - c!.x) < 1e-6 && other!.lineIndex === c!.lineIndex, `index ${i} → ${back} in ${JSON.stringify(content)}`).toBe(true);
            }
        }
    });
});

import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { postEditFixes } from "./connectors";

// Code blocks: a dark card with the language at the top and monospaced, syntax-coloured code that
// sets the block's height (only its width is up to you).

export const CODE_LANGUAGES = ["C++", "CSS", "Go", "GraphQL", "HTML", "JavaScript", "JSON", "Kotlin", "Python", "React", "Ruby", "Rust", "SQL", "Swift", "TypeScript"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const CODE_FONT = 14;
export const CODE_LINE = 20;
export const CODE_HEADER = 36;
export const CODE_PAD = 16;
export const CODE_WIDTH = 440;
const MIN_LINES = 4;

export function codeHeight(text: string): number {
    const lines = Math.max(MIN_LINES, (text || "").split("\n").length);
    return CODE_HEADER + CODE_PAD + lines * CODE_LINE + CODE_PAD;
}

export function makeCodeBlock(doc: NagmaDocument, x: number, y: number, parentId: string | null, lang: CodeLanguage = "TypeScript", text = ""): SceneNode {
    return makeNode(doc, "rect", { x, y, w: CODE_WIDTH, h: codeHeight(text) }, parentId, {
        name: "Code block",
        fills: [solid("#1E1E1E")],
        radius: 12,
        text,
        fontFamily: "Roboto Mono",
        fontSize: CODE_FONT,
        fontWeight: 400,
        textAlign: "left",
        textAlignV: "top",
        jam: { kind: "code", lang },
    });
}

// The box the code is typed in, in the block's own coordinates.
export function codeTextBox(node: SceneNode) {
    return { x: node.x + CODE_PAD + 28, y: node.y + CODE_HEADER + CODE_PAD, w: Math.max(1, node.w - CODE_PAD * 2 - 28), h: Math.max(1, node.h - CODE_HEADER - CODE_PAD * 2) };
}

const KEYWORDS: Record<string, string[]> = {
    common: ["if", "else", "for", "while", "return", "break", "continue", "switch", "case", "default", "try", "catch", "finally", "throw", "new", "class", "import", "from", "export", "true", "false", "null", "in", "of", "do", "struct", "enum", "interface", "type", "public", "private", "protected", "static", "async", "await", "yield"],
    TypeScript: ["const", "let", "var", "function", "extends", "implements", "undefined", "this", "typeof", "keyof", "as", "readonly"],
    JavaScript: ["const", "let", "var", "function", "extends", "undefined", "this", "typeof"],
    React: ["const", "let", "function", "return", "useState", "useEffect", "props", "this"],
    Python: ["def", "lambda", "pass", "None", "True", "False", "and", "or", "not", "is", "with", "as", "elif", "self", "global", "raise"],
    Go: ["func", "package", "var", "const", "go", "defer", "chan", "map", "range", "nil", "select"],
    Rust: ["fn", "let", "mut", "impl", "trait", "pub", "use", "mod", "match", "Self", "self", "loop", "where", "crate"],
    Swift: ["func", "let", "var", "guard", "self", "Self", "nil", "protocol", "extension", "init"],
    Kotlin: ["fun", "val", "var", "when", "object", "data", "this", "null", "init"],
    Ruby: ["def", "end", "elsif", "unless", "module", "nil", "self", "do", "puts", "require"],
    "C++": ["int", "char", "void", "auto", "const", "namespace", "using", "std", "template", "nullptr", "virtual", "include"],
    SQL: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join", "left", "right", "inner", "on", "group", "by", "order", "limit", "and", "or", "not", "as", "create", "table", "primary", "key"],
    GraphQL: ["query", "mutation", "subscription", "fragment", "on", "type", "schema", "input"],
    CSS: [],
    HTML: [],
    JSON: [],
};

const COLORS = { text: "#E6E6E6", keyword: "#FF7AB2", string: "#9EE493", number: "#FFC943", comment: "#8A8A8A", tag: "#78C1FF", punct: "#B3B3B3" };

// Splits a line into coloured pieces.
export function highlight(line: string, lang: string): { text: string; color: string }[] {
    const words = new Set([...(KEYWORDS.common ?? []), ...(KEYWORDS[lang] ?? [])].map((w) => (lang === "SQL" ? w.toLowerCase() : w)));
    const out: { text: string; color: string }[] = [];
    // A comment starts only outside strings ("https://x.com" isn't one), so it's one more kind
    // of token, tried where each token starts.
    const comment = lang === "Python" || lang === "Ruby" ? "#.*$" : lang === "SQL" ? "--.*$" : lang === "HTML" ? "<!--.*$" : "\\/\\/.*$";
    const re = new RegExp(`(${comment})|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)|(\\b\\d+(?:\\.\\d+)?\\b)|(<\\/?[A-Za-z][\\w-]*|\\/?>)|([A-Za-z_$][\\w$]*)|(\\s+)|([^\\w\\s])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
        const [whole, note, str, num, tag, word] = m;
        const color = note ? COLORS.comment : str ? COLORS.string : num ? COLORS.number : tag && (lang === "HTML" || lang === "React") ? COLORS.tag : word ? (words.has(lang === "SQL" ? word.toLowerCase() : word) ? COLORS.keyword : lang === "CSS" && /^[a-z-]+$/.test(word) ? COLORS.tag : COLORS.text) : COLORS.punct;
        out.push({ text: whole, color });
    }
    return out;
}

export function drawCodeBlock(ctx: CanvasRenderingContext2D, node: SceneNode, lang: string, editing: boolean) {
    const { x, y, w, h } = node;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#1E1E1E";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.shadowColor = "transparent";
    // Header: three dots and the language.
    ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(x + 18 + i * 14, y + CODE_HEADER / 2, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
    });
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#B3B3B3";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(lang, x + w - CODE_PAD, y + CODE_HEADER / 2);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, y + CODE_HEADER, w, 1);
    // Line numbers and code.
    ctx.beginPath();
    ctx.rect(x, y + CODE_HEADER, w, h - CODE_HEADER);
    ctx.clip();
    ctx.font = `${CODE_FONT}px "Roboto Mono", ui-monospace, monospace`;
    ctx.textBaseline = "alphabetic";
    const lines = (node.text ?? "").split("\n");
    const count = Math.max(MIN_LINES, lines.length);
    for (let i = 0; i < count; i++) {
        const base = y + CODE_HEADER + CODE_PAD + i * CODE_LINE + CODE_FONT;
        ctx.textAlign = "right";
        ctx.fillStyle = "#5C5C5C";
        ctx.fillText(String(i + 1), x + CODE_PAD + 16, base);
        if (editing) continue;
        ctx.textAlign = "left";
        let cx = x + CODE_PAD + 28;
        for (const piece of highlight(lines[i] ?? "", lang)) {
            ctx.fillStyle = piece.color;
            ctx.fillText(piece.text, cx, base);
            cx += ctx.measureText(piece.text).width;
        }
    }
    ctx.restore();
}

// Code blocks are as tall as their code.
function codeGrowth(before: NagmaDocument, after: NagmaDocument): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(after.nodes)) {
        if (node.jam?.kind !== "code") continue;
        const prev = before.nodes[node.id];
        if (prev && prev.text === node.text && prev.h === node.h) continue;
        const h = codeHeight(node.text ?? "");
        if (Math.abs(h - node.h) > 0.5) commands.push({ type: "node.update", id: node.id, patch: { h } });
    }
    return commands;
}

postEditFixes.push(codeGrowth);

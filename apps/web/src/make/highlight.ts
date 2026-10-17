// Syntax colouring for the Code tab: a small tokenizer for TypeScript/JSX, CSS, JSON, HTML and
// Markdown, giving escaped HTML with classes the code pane colours. It only colours; it never
// changes the text, so the coloured layer lines up with the textarea above it.

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KEYWORDS = new Set(
    "import export from default const let var function return if else for while do switch case break continue new class extends interface type enum implements as async await try catch finally throw typeof instanceof in of void null undefined true false this super yield keyof readonly public private protected static declare satisfies".split(" "),
);

type Rule = [RegExp, string | ((m: string) => string)];

const span = (cls: string) => (m: string) => `<span class="hl-${cls}">${esc(m)}</span>`;

const SCRIPT: Rule[] = [
    [/^\/\/[^\n]*/, span("comment")],
    [/^\/\*[\s\S]*?(\*\/|$)/, span("comment")],
    [/^`(?:\\[\s\S]|[^`\\])*`?/, span("string")],
    [/^"(?:\\.|[^"\\\n])*"?/, span("string")],
    [/^'(?:\\.|[^'\\\n])*'?/, span("string")],
    [/^<\/?[A-Za-z][\w.:-]*/, (m) => `${esc(m.startsWith("</") ? "</" : "<")}<span class="hl-tag">${esc(m.replace(/^<\/?/, ""))}</span>`],
    [/^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?n?/, span("number")],
    [/^[A-Za-z_$][\w$-]*(?==[{"'])/, span("attr")],
    [/^[A-Za-z_$][\w$]*/, (m) => (KEYWORDS.has(m) ? span("keyword")(m) : /^[A-Z]/.test(m) ? span("type")(m) : esc(m))],
];

const CSS: Rule[] = [
    [/^\/\*[\s\S]*?(\*\/|$)/, span("comment")],
    [/^"(?:\\.|[^"\\\n])*"?|^'(?:\\.|[^'\\\n])*'?/, span("string")],
    [/^@[\w-]+/, span("keyword")],
    [/^#[0-9a-fA-F]{3,8}\b/, span("number")],
    [/^-?\d[\d.]*(px|rem|em|%|vh|vw|s|ms|deg|fr)?/, span("number")],
    [/^[\w-]+(?=\s*:)/, span("attr")],
    [/^[.#]?[A-Za-z_][\w-]*/, span("tag")],
];

const JSON_RULES: Rule[] = [
    [/^"(?:\\.|[^"\\\n])*"(?=\s*:)/, span("attr")],
    [/^"(?:\\.|[^"\\\n])*"?/, span("string")],
    [/^-?\d[\d.eE+-]*/, span("number")],
    [/^(true|false|null)\b/, span("keyword")],
];

const MARKDOWN: Rule[] = [
    [/^#{1,6} [^\n]*/, span("keyword")],
    [/^`[^`\n]*`?/, span("string")],
    [/^\*\*[^*\n]+\*\*/, span("tag")],
    [/^(?:[-*+]|\d+\.) (?=\S)/, span("number")],
    [/^\[[^\]\n]*\]\([^)\n]*\)/, span("attr")],
];

const HTML: Rule[] = [
    [/^<!--[\s\S]*?(-->|$)/, span("comment")],
    [/^"(?:[^"\n])*"?/, span("string")],
    [/^<\/?[A-Za-z][\w:-]*/, (m) => `${esc(m.startsWith("</") ? "</" : "<")}<span class="hl-tag">${esc(m.replace(/^<\/?/, ""))}</span>`],
    [/^[A-Za-z-]+(?==)/, span("attr")],
];

function rulesFor(path: string): Rule[] {
    if (/\.(tsx?|jsx?|mjs)$/.test(path)) return SCRIPT;
    if (/\.css$/.test(path)) return CSS;
    if (/\.json$/.test(path)) return JSON_RULES;
    if (/\.(md|mdx)$/.test(path)) return MARKDOWN;
    if (/\.html?$/.test(path)) return HTML;
    return [];
}

export function highlight(path: string, text: string): string {
    const rules = rulesFor(path);
    if (!rules.length) return esc(text);
    let out = "";
    let i = 0;
    // Very long files are coloured only at the start, to keep typing quick.
    const limit = Math.min(text.length, 200_000);
    let plain = "";
    while (i < limit) {
        const rest = text.slice(i, i + 4000);
        let matched = false;
        // Only try rules at token starts (after a non-word character), so words aren't split.
        const prev = i > 0 ? text[i - 1] : "";
        if (!/[\w$]/.test(prev ?? "")) {
            for (const [re, fmt] of rules) {
                const m = re.exec(rest);
                if (m && m[0]) {
                    out += esc(plain);
                    plain = "";
                    out += typeof fmt === "string" ? `<span class="hl-${fmt}">${esc(m[0])}</span>` : fmt(m[0]);
                    i += m[0].length;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) {
            plain += text[i];
            i++;
        }
    }
    return out + esc(plain) + esc(text.slice(limit));
}

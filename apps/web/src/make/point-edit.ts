import type { PickedElement } from "./types";

// Point and edit's direct changes: the picked element's text and colours, written into its source
// (the preview tells which file and line made the element).

export function sourceOf(picked: PickedElement): { path: string; line: number } {
    const at = picked.src.lastIndexOf(":");
    return { path: picked.src.slice(0, at), line: Number(picked.src.slice(at + 1)) };
}

function lineStart(source: string, line: number): number {
    let at = 0;
    for (let i = 1; i < line; i++) {
        const next = source.indexOf("\n", at);
        if (next < 0) return source.length;
        at = next + 1;
    }
    return at;
}

// The element's text, when it's written out in the JSX near its line (not computed).
export function canEditText(source: string, picked: PickedElement): boolean {
    return Boolean(picked.text) && findText(source, picked) >= 0;
}

function findText(source: string, picked: PickedElement): number {
    const { line } = sourceOf(picked);
    const from = lineStart(source, line);
    const window = source.slice(from, lineStart(source, line + 20));
    // Text in JSX keeps its words; the preview reports them with whitespace collapsed.
    const words = picked.text.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = new RegExp(words.join("\\s+")).exec(window);
    return match ? from + match.index : -1;
}

export function replaceText(source: string, picked: PickedElement, next: string): string | null {
    const at = findText(source, picked);
    if (at < 0) return null;
    const words = picked.text.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = new RegExp(words.join("\\s+")).exec(source.slice(at));
    if (!match) return null;
    const safe = /[{}<>]/.test(next) ? `{${JSON.stringify(next)}}` : next;
    return source.slice(0, at) + safe + source.slice(at + match[0].length);
}

// The opening tag of the element: from "<tag" on its line to the ">" that closes it (braces and
// strings inside attributes skipped).
function openingTag(source: string, picked: PickedElement): { start: number; end: number } | null {
    const { line } = sourceOf(picked);
    const from = lineStart(source, line);
    const re = new RegExp(`<${picked.tag}(?=[\\s>/])`, "g");
    re.lastIndex = from;
    const m = re.exec(source);
    if (!m || m.index > lineStart(source, line + 1)) return null;
    let depth = 0;
    let quote: string | null = null;
    for (let i = m.index + 1; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === quote && source[i - 1] !== "\\") quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return { start: m.index, end: source[i - 1] === "/" ? i - 1 : i };
    }
    return null;
}

export function canEditStyle(source: string, picked: PickedElement): boolean {
    return openingTag(source, picked) !== null;
}

// Sets one inline style on the element: added to its style={{ … }} (replacing that property), or
// as a new style attribute.
export function setStyle(source: string, picked: PickedElement, prop: string, value: string): string | null {
    const tag = openingTag(source, picked);
    if (!tag) return null;
    const head = source.slice(tag.start, tag.end);
    const entry = `${prop}: ${JSON.stringify(value)}`;
    const style = /\sstyle=\{\{/.exec(head);
    let next: string;
    if (style) {
        const open = style.index + style[0].length;
        // The object's end: the "}}" that closes it.
        let depth = 2;
        let close = -1;
        for (let i = open; i < head.length; i++) {
            if (head[i] === "{") depth++;
            else if (head[i] === "}") {
                depth--;
                if (depth === 1) {
                    close = i;
                    break;
                }
            }
        }
        if (close < 0) return null;
        const body = head.slice(open, close);
        const existing = new RegExp(`(^|[,{\\s])${prop}\\s*:\\s*("[^"]*"|'[^']*'|[^,}]+)`).exec(body);
        const replaced = existing ? body.slice(0, existing.index + existing[1]!.length) + entry + body.slice(existing.index + existing[0].length) : `${body.trim() ? `${body.replace(/\s*,?\s*$/, "")}, ` : " "}${entry} `;
        next = head.slice(0, open) + replaced + head.slice(close);
    } else {
        const name = head.match(/^<[\w.-]+/)?.[0] ?? "";
        next = `${name} style={{ ${entry} }}${head.slice(name.length)}`;
    }
    return source.slice(0, tag.start) + next + source.slice(tag.end);
}

// Computed colours ("rgb(…)") as #rrggbb for colour inputs.
export function toHex(color: string): string {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(color);
    if (!m) return color.startsWith("#") ? color.slice(0, 7) : "#000000";
    return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

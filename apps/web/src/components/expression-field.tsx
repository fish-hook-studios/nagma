import { useEffect, useRef, useState } from "react";
import { problem } from "../engine/expressions";
import { useEditor } from "../engine/store";
import type { Variable, VariableType } from "../engine/types";
import { collectionsOf } from "../engine/variables";

// An expression box like the reference's: type numbers, text in quotes, operators (+ - * / == != < > and or
// not) and variables, which show as pills. Typing a variable's name offers it; pick it with a click,
// Enter or Tab. Stored as text with variables written {{id}}.

const PILL = "inline-flex items-center rounded bg-panel-hover px-1 py-px text-ink mx-px whitespace-nowrap";

const TYPE_MARK: Record<VariableType, string> = { color: "◐", number: "#", string: "T", boolean: "◑", easing: "∿", timing: "◷" };

function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MARK = "mr-0.5 text-[10px] opacity-70";
const OPERATORS = /(==|!=|&lt;=|&gt;=|&lt;|&gt;|\+|\*|\/|\band\b|\bor\b|\bnot\b|(?<![\w.])-(?=\s))/g;

// Variables as pills with their type mark; operators in pink, like the reference's expression editor.
function toHtml(value: string, nameOf: (id: string) => string, typeOf: (id: string) => VariableType | undefined): string {
    return value
        .split(/(\{\{[^}]+\}\})/g)
        .map((part) => {
            const m = /^\{\{([^}]+)\}\}$/.exec(part);
            if (!m) return escapeHtml(part).replace(OPERATORS, '<span class="text-pink-500">$1</span>');
            const id = (m[1] ?? "").trim();
            const type = typeOf(id);
            return `<span contenteditable="false" data-var="${escapeHtml(id)}" class="${PILL}">${type ? `<span class="${MARK}">${TYPE_MARK[type]}</span>` : ""}${escapeHtml(nameOf(id))}</span>`;
        })
        .join("");
}

function serialize(root: HTMLElement): string {
    let out = "";
    root.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) out += (node.textContent ?? "").replace(/ /g, " ");
        else if (node instanceof HTMLElement && node.dataset.var) out += `{{${node.dataset.var}}}`;
        else if (node instanceof HTMLElement && node.tagName === "BR") out += "";
        else if (node instanceof HTMLElement) out += serialize(node);
    });
    return out;
}

// The word being typed just before the caret, for suggestions.
function wordAtCaret(): { node: Text; start: number; end: number; word: string } | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent ?? "";
    const end = sel.anchorOffset;
    let start = end;
    while (start > 0 && /[\p{L}\p{N}_/]/u.test(text[start - 1] ?? "")) start--;
    const word = text.slice(start, end);
    // Keywords and numbers aren't variable names.
    if (!word || /^\d/.test(word) || /^(and|or|not|true|false)$/i.test(word)) return null;
    return { node: node as Text, start, end, word };
}

export function ExpressionField({
    value,
    onChange,
    placeholder,
    label,
    types,
}: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    label: string;
    // Which variable types to offer first (all are offered).
    types?: VariableType[];
}) {
    const collections = useEditor((s) => collectionsOf(s.doc));
    const all: { v: Variable; collection: string }[] = collections.flatMap((c) => c.variables.map((v) => ({ v, collection: c.name })));
    const nameOf = (id: string) => all.find((x) => x.v.id === id)?.v.name ?? "Missing variable";
    const typeOf = (id: string) => all.find((x) => x.v.id === id)?.v.type;
    const ref = useRef<HTMLDivElement>(null);
    const focused = useRef(false);
    const [draft, setDraft] = useState(value);
    const [query, setQuery] = useState<string | null>(null);
    const [active, setActive] = useState(0);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || focused.current) return;
        el.innerHTML = toHtml(value, nameOf, typeOf);
        setDraft(value);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- names are read when the value changes
    }, [value, collections]);

    // Variables by name; typing "mode" offers each collection's current mode (VAR_MODE_LOOKUP).
    type Match = { v: Variable; collection: string; text?: undefined } | { v?: undefined; text: string; label: string; collection: string };
    const modeMatches: Match[] = query !== null && query.length >= 2 && /^(mo|va|lo)/i.test(query) ? collections.map((c) => ({ text: `VAR_MODE_LOOKUP("${c.name.replace(/"/g, "'")}")`, label: `Mode of ${c.name}`, collection: "Variable mode" })) : [];
    const matches: Match[] = query === null ? [] : [...all.filter((x) => !query || x.v.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(types?.includes(b.v.type) ?? 0) - Number(types?.includes(a.v.type) ?? 0)), ...modeMatches].slice(0, 8);

    const refresh = () => {
        const el = ref.current;
        if (!el) return;
        setDraft(serialize(el));
        const w = wordAtCaret();
        setQuery(w ? w.word : null);
        setActive(0);
    };

    const insert = (pick: Match) => {
        const el = ref.current;
        if (!el) return;
        const w = wordAtCaret();
        let pill: Node;
        if (pick.v) {
            const variable = pick.v;
            const span = document.createElement("span");
            span.contentEditable = "false";
            span.dataset.var = variable.id;
            span.className = PILL;
            const mark = document.createElement("span");
            mark.className = MARK;
            mark.textContent = TYPE_MARK[variable.type];
            span.append(mark, variable.name);
            pill = span;
        } else pill = document.createTextNode(pick.text);
        const space = document.createTextNode(" ");
        const sel = window.getSelection();
        if (w) {
            const after = w.node.splitText(w.start);
            after.textContent = (after.textContent ?? "").slice(w.end - w.start);
            w.node.parentNode?.insertBefore(pill, after);
            w.node.parentNode?.insertBefore(space, after);
        } else if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            range.insertNode(space);
            range.insertNode(pill);
        } else {
            el.append(pill, space);
        }
        const range = document.createRange();
        range.setStartAfter(space);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
        setQuery(null);
        setDraft(serialize(el));
    };

    const commit = () => {
        const el = ref.current;
        if (!el) return;
        const next = serialize(el).replace(/\s+/g, " ").trim();
        if (next !== value) onChange(next);
    };

    // Problems show once you leave the field, not while you type.
    const error = editing ? null : problem(draft);
    return (
        <div className="relative">
            <div
                ref={ref}
                role="textbox"
                aria-label={label}
                contentEditable
                suppressContentEditableWarning
                data-placeholder={placeholder ?? "Type an expression"}
                className={`min-h-7 w-full rounded-md border bg-field px-1.5 py-1 leading-5 text-ink outline-none empty:before:text-ink-subtle empty:before:content-[attr(data-placeholder)] ${error ? "border-red-500/70" : "border-transparent hover:border-panel-border focus:border-brand-500"}`}
                onFocus={() => {
                    focused.current = true;
                    setEditing(true);
                    refresh();
                }}
                onBlur={() => {
                    focused.current = false;
                    setEditing(false);
                    setQuery(null);
                    commit();
                }}
                onInput={refresh}
                onKeyUp={(e) => {
                    if (e.key.startsWith("Arrow") && e.key !== "ArrowUp" && e.key !== "ArrowDown") refresh();
                }}
                onPaste={(e) => {
                    e.preventDefault();
                    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (matches.length && query !== null) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
                            return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            const pick = matches[active];
                            if (pick) insert(pick);
                            return;
                        }
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setQuery(null);
                            return;
                        }
                    }
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                    }
                }}
            />
            {editing && query !== null && matches.length > 0 && (
                <div role="listbox" aria-label="Variables" className="absolute top-full right-0 left-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-panel-border bg-panel-raised p-1 shadow-lg">
                    {matches.map((m, i) => (
                        <div
                            key={m.v ? m.v.id : m.text}
                            role="option"
                            aria-selected={i === active}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                insert(m);
                            }}
                            onMouseEnter={() => setActive(i)}
                            className={`flex h-7 cursor-default items-center gap-2 rounded px-1.5 ${i === active ? "bg-brand-500 text-white" : ""}`}
                        >
                            <span className="w-3 text-center text-[10px] opacity-70">{m.v ? TYPE_MARK[m.v.type] : "ƒ"}</span>
                            <span className="min-w-0 flex-1 truncate">{m.v ? m.v.name : m.label}</span>
                            <span className={`truncate text-[11px] ${i === active ? "text-white/70" : "text-ink-subtle"}`}>{m.collection}</span>
                        </div>
                    ))}
                </div>
            )}
            {error && <p className="mt-0.5 text-[11px] text-red-500">{error}</p>}
        </div>
    );
}

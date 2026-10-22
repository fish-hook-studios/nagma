import { useRef } from "react";
import { highlight } from "./highlight";

// The code editor Make's Files view and a Live frame's Code section share: a textarea over a
// coloured copy of its text (the colouring never changes the text, so the two line up), line
// numbers, Tab for four spaces and ⌘S to save straight away.

const COLOURS = ".hl-keyword{color:#A855F7}.hl-string{color:#16A34A}.hl-number{color:#EA580C}.hl-comment{color:#8A8F98;font-style:italic}.hl-tag{color:#2563EB}.hl-attr{color:#0891B2}.hl-type{color:#CA8A04}";

export function CodeEditor({
    path,
    value,
    onChange,
    onCommit,
    readOnly = false,
    label,
    compact = false,
}: {
    // Picks the colouring by its extension ("index.html", "style.css", "main.js").
    path: string;
    value: string;
    onChange: (text: string) => void;
    // Leaving the field or ⌘S: save now.
    onCommit?: () => void;
    readOnly?: boolean;
    label: string;
    // Smaller text and gutter for narrow panels.
    compact?: boolean;
}) {
    const gutter = useRef<HTMLPreElement>(null);
    const coloured = useRef<HTMLPreElement>(null);
    const lines = value.split("\n").length;
    const pad = compact ? "px-2 py-1.5" : "px-3 py-2";
    return (
        <>
            <style>{COLOURS}</style>
            <div className={`flex min-h-0 flex-1 font-mono ${compact ? "text-[11px] leading-[16px]" : "text-[12px] leading-[18px]"}`}>
                <pre ref={gutter} aria-hidden="true" className={`${compact ? "w-7 py-1.5 pr-1" : "w-11 py-2 pr-2"} m-0 shrink-0 overflow-hidden border-r border-panel-border text-right text-ink-subtle select-none`}>
                    {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
                </pre>
                <div className="relative min-w-0 flex-1">
                    {/* The coloured copy under the (transparent) text being edited. */}
                    <pre ref={coloured} aria-hidden="true" className={`pointer-events-none absolute inset-0 m-0 overflow-hidden ${pad} whitespace-pre text-ink`} dangerouslySetInnerHTML={{ __html: `${highlight(path, value)}\n` }} />
                    <textarea
                        aria-label={label}
                        value={value}
                        readOnly={readOnly}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        onChange={(e) => onChange(e.target.value)}
                        onBlur={() => onCommit?.()}
                        onScroll={(e) => {
                            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
                            if (coloured.current) {
                                coloured.current.scrollTop = e.currentTarget.scrollTop;
                                coloured.current.scrollLeft = e.currentTarget.scrollLeft;
                            }
                        }}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Tab" && !e.shiftKey && !readOnly) {
                                e.preventDefault();
                                const el = e.currentTarget;
                                const { selectionStart: a, selectionEnd: b } = el;
                                onChange(`${value.slice(0, a)}    ${value.slice(b)}`);
                                requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
                            }
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                                e.preventDefault();
                                onCommit?.();
                            }
                        }}
                        wrap="off"
                        className={`absolute inset-0 h-full w-full resize-none bg-transparent ${pad} text-transparent caret-ink outline-none selection:bg-brand-500/30`}
                    />
                </div>
            </div>
        </>
    );
}

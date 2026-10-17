import { useEffect, useRef, useState } from "react";
import { useEditor } from "../engine/store";

interface NumberFieldProps {
    label: string;
    value: number | null; // null means the selection has mixed values
    onCommit: (value: number) => void;
    onScrub?: (value: number) => void;
    onScrubEnd?: (value: number) => void;
    // Relative edits ("+10", "-=4", "*2", "/2" typed on their own): each layer changes from its own
    // value, which is how a Mixed field is edited. Without it, they apply to the shown value.
    onRelative?: (apply: (current: number) => number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    // A unit written right after the number, in the text ("300ms"), instead of a separate suffix.
    unit?: string;
    title?: string;
    // Sees the typed text first; returning true means it was handled (e.g. padding shorthand "8, 16").
    onText?: (text: string) => boolean;
    // ⌘-click (Ctrl-click) on the field.
    onModClick?: () => void;
    // The name shown above the field when Property labels is on (else taken from the title).
    caption?: string;
    // Drawn in place of the label text (the label still names the field for captions).
    icon?: React.ReactNode;
    // What a null value reads as ("Mixed" unless the field has an Auto state of its own).
    nullLabel?: string;
    // The field's name for screen readers when the label beside it isn't text (or is empty).
    name?: string;
    // Drawn inside the field after the value (the W and H fields' "Hug" / "Fill" menu).
    trailing?: React.ReactNode;
    // No fill or outline of its own: the field sits inside a combined pill (paint rows).
    bare?: boolean;
}

const CAPTIONS: Record<string, string> = { X: "X", Y: "Y", W: "Width", H: "Height" };

// A short name for the field: the caption, the title up to its first clause, or the label.
function captionOf(caption: string | undefined, title: string | undefined, label: string): string | null {
    if (caption) return caption;
    if (title) return title.split(/ \(|\. |: /)[0] ?? title;
    return CAPTIONS[label] ?? (label.length > 1 && /\w/.test(label) ? label : null);
}

// A compact design-tool number input: type a value or maths ("120+16", "(390-32)/2"), use the arrow
// keys (⇧ for 10), or drag the label to scrub (⇧ moves ten times faster, ⌥ ten times slower).
export function NumberField(props: NumberFieldProps) {
    const labels = useEditor((s) => s.prefs.propertyLabels);
    const field = <Field {...props} />;
    const text = labels ? captionOf(props.caption, props.title, props.label) : null;
    if (!text) return field;
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[10px] text-ink-subtle">{text}</span>
            {field}
        </div>
    );
}

function Field({ label, icon, value, onCommit, onScrub, onScrubEnd, onRelative, min = -Infinity, max = Infinity, step = 1, suffix, unit = "", title, onText, onModClick, nullLabel = "Mixed", name, trailing, bare }: NumberFieldProps) {
    // Arrow keys move by the nudge preferences (⇧ for the big nudge), scaled to the field's step.
    const nudgeSmall = useEditor((s) => s.prefs.nudgeSmall);
    const nudgeBig = useEditor((s) => s.prefs.nudgeBig);
    const format = (n: number) => formatNumber(n) + unit;
    const display = value === null ? nullLabel : format(value);
    const [draft, setDraft] = useState(display);
    const focused = useRef(false);
    const scrub = useRef<{ lastX: number; value: number; start: number; moved: boolean } | null>(null);

    useEffect(() => {
        if (!focused.current) setDraft(display);
    }, [display]);

    const clamp = (n: number) => Math.min(max, Math.max(min, n));

    const commitDraft = () => {
        if (draft === display) return;
        if (onText && onText(draft)) return;
        // The unit may be typed or left in place ("300ms", "+50ms").
        const text = unit ? draft.split(unit).join("") : draft;
        const relative = parseRelative(text);
        if (relative) {
            const apply = (current: number) => clamp(relative(current));
            if (onRelative) {
                onRelative(apply);
                setDraft(display);
                return;
            }
            if (value !== null) {
                const next = apply(value);
                setDraft(format(next));
                if (next !== value) onCommit(next);
                return;
            }
        }
        const parsed = evaluate(text);
        if (parsed === null) {
            setDraft(display);
            return;
        }
        const next = clamp(parsed);
        setDraft(format(next));
        if (next !== value) onCommit(next);
    };

    return (
        <label
            title={title}
            className={bare ? "flex h-6 min-w-0 items-center" : "group/field flex h-6 min-w-0 items-center rounded-md border border-transparent bg-field focus-within:border-brand-500 hover:border-panel-border"}
        >
            <span
                className={`flex h-full shrink-0 cursor-ew-resize items-center justify-center text-ink-subtle select-none ${label.length > 2 ? "pr-1 pl-1.5" : label || icon ? "w-6" : "w-1.5"}`}
                onPointerDown={(event) => {
                    if (value === null) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    scrub.current = { lastX: event.clientX, value, start: value, moved: false };
                }}
                onPointerMove={(event) => {
                    const s = scrub.current;
                    if (!s) return;
                    // Speed follows the keys held right now, so it can change mid-drag.
                    const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
                    const dx = event.clientX - s.lastX;
                    s.lastX = event.clientX;
                    if (!dx) return;
                    const fine = event.altKey ? Math.min(step, 0.1) : step;
                    s.value = clamp(s.value + dx * step * factor);
                    const next = Math.round(s.value / fine) * fine;
                    s.moved = true;
                    setDraft(format(next));
                    onScrub?.(next);
                }}
                onPointerUp={() => {
                    const s = scrub.current;
                    scrub.current = null;
                    if (!s || !s.moved) return;
                    const next = Number(formatNumber(s.value));
                    if (onScrub) onScrubEnd?.(next);
                    else if (next !== s.start) onCommit(next);
                }}
            >
                {icon ?? label}
            </span>
            <input
                aria-label={name}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPointerDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && onModClick) onModClick();
                }}
                onFocus={(event) => {
                    focused.current = true;
                    event.currentTarget.select();
                }}
                onBlur={() => {
                    focused.current = false;
                    commitDraft();
                }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                        setDraft(display);
                        event.currentTarget.blur();
                    }
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        const amount = step === 1 ? (event.shiftKey ? nudgeBig : nudgeSmall) : step * (event.shiftKey ? 10 : 1);
                        const delta = event.key === "ArrowUp" ? amount : -amount;
                        if (value === null) {
                            onRelative?.((current) => clamp(current + delta));
                            return;
                        }
                        const next = clamp(value + delta);
                        setDraft(format(next));
                        onCommit(next);
                    }
                }}
                className="h-full w-full min-w-0 bg-transparent pr-1 outline-none"
            />
            {suffix && <span className="pr-2 text-ink-subtle">{suffix}</span>}
            {trailing}
        </label>
    );
}

function formatNumber(n: number): string {
    return String(Math.round(n * 100) / 100);
}

// "+10", "*2", "/2", "-=4": a change to apply to the current value; "50%" is a share of it. A plain
// "-10" is a number.
function parseRelative(input: string): ((current: number) => number) | null {
    const text = input.trim().replace(/,/g, ".");
    const pct = /^(-?\d*\.?\d+)\s*%$/.exec(text);
    if (pct) {
        const share = Number(pct[1]) / 100;
        return (c) => c * share;
    }
    const m = /^([+*/]|-=)\s*(.+)$/.exec(text);
    if (!m) return null;
    const amount = evaluate(m[2] ?? "");
    if (amount === null) return null;
    if (m[1] === "+") return (c) => c + amount;
    if (m[1] === "-=") return (c) => c - amount;
    if (m[1] === "*") return (c) => c * amount;
    return amount === 0 ? null : (c) => c / amount;
}

// Numbers with + - * / and parentheses ("120+16", "(390-32)/2", "-8"), read without eval.
function evaluate(input: string): number | null {
    const text = input.trim().replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/");
    if (!text) return null;
    let i = 0;
    const peek = () => {
        while (text[i] === " ") i++;
        return text[i];
    };
    const number = (): number | null => {
        const c = peek();
        if (c === "(") {
            i++;
            const v = sum();
            if (v === null || peek() !== ")") return null;
            i++;
            return v;
        }
        if (c === "-" || c === "+") {
            i++;
            const v = number();
            return v === null ? null : c === "-" ? -v : v;
        }
        const m = /^\d*\.?\d+(?:e[-+]?\d+)?/i.exec(text.slice(i));
        if (!m) return null;
        i += m[0].length;
        return Number(m[0]);
    };
    const product = (): number | null => {
        let v = number();
        while (v !== null && (peek() === "*" || peek() === "/")) {
            const op = text[i++];
            const r = number();
            if (r === null) return null;
            v = op === "*" ? v * r : v / r;
        }
        return v;
    };
    const sum = (): number | null => {
        let v = product();
        while (v !== null && (peek() === "+" || peek() === "-")) {
            const op = text[i++];
            const r = product();
            if (r === null) return null;
            v = op === "+" ? v + r : v - r;
        }
        return v;
    };
    const result = sum();
    if (result === null || peek() !== undefined || !Number.isFinite(result)) return null;
    return result;
}

import { useEffect, useRef, useSyncExternalStore } from "react";

// A small in-app dialog that asks for one line of text (a name, a link), in place of the
// browser's prompt(), which the desktop app doesn't support. askText resolves with the text, or
// null when cancelled.

interface AskOptions {
    placeholder?: string;
    confirm?: string;
    hint?: string;
    // A question without a field (askConfirm), and a red confirm button for something destructive.
    noInput?: boolean;
    danger?: boolean;
}

interface Ask extends AskOptions {
    title: string;
    value: string;
    resolve: (value: string | null) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function askText(title: string, initial = "", options: AskOptions = {}): Promise<string | null> {
    current?.resolve(null);
    return new Promise((resolve) => {
        current = { title, value: initial, resolve, ...options };
        emit();
    });
}

// Asks to confirm something (deleting a page with layers): resolves true when confirmed.
export async function askConfirm(title: string, hint: string, confirm = "OK", danger = false): Promise<boolean> {
    return (await askText(title, "", { hint, confirm, noInput: true, danger })) !== null;
}

function finish(value: string | null) {
    const ask = current;
    current = null;
    emit();
    ask?.resolve(value);
}

export function AskTextDialog() {
    const ask = useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => current,
    );
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ask) requestAnimationFrame(() => input.current?.select());
    }, [ask]);
    if (!ask) return null;
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onPointerDown={(e) => e.target === e.currentTarget && finish(null)}>
            <form
                role="dialog"
                aria-modal="true"
                aria-labelledby="ask-text-title"
                className="w-80 rounded-xl border border-panel-border bg-panel p-4 text-ink shadow-2xl"
                onSubmit={(e) => {
                    e.preventDefault();
                    finish(input.current?.value ?? "");
                }}
            >
                <label id="ask-text-title" className="mb-2 block text-[12px] font-semibold" htmlFor="ask-text">
                    {ask.title}
                </label>
                {ask.hint && <p className="mb-2 text-[12px] text-ink-muted">{ask.hint}</p>}
                {ask.noInput ? (
                    <button type="button" autoFocus className="sr-only" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), finish(null))}>
                        {ask.title}
                    </button>
                ) : (
                <input
                    id="ask-text"
                    ref={input}
                    defaultValue={ask.value}
                    placeholder={ask.placeholder}
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            finish(null);
                        }
                    }}
                    className="h-8 w-full rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500"
                />
                )}
                <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => finish(null)} className="h-7 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                        Cancel
                    </button>
                    <button type="submit" className={`h-7 rounded-md px-3 text-[12px] text-white ${ask.danger ? "bg-red-500 hover:bg-red-600" : "bg-brand-500 hover:bg-brand-600"}`}>
                        {ask.confirm ?? "OK"}
                    </button>
                </div>
            </form>
        </div>
    );
}

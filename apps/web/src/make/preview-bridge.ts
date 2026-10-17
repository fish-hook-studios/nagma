import { useSyncExternalStore } from "react";

// Talking to the running preview from outside the preview pane: the properties panel stages
// changes in it, "Copy as design layers" reads it, drawing takes its picture, and comment pins
// follow its scrolling. The preview pane registers its frame and passes on what the app answers.

let target: Window | null = null;
const waiting = new Map<string, (value: unknown) => void>();
let scroll = { x: 0, y: 0 };
const listeners = new Set<() => void>();

export function setPreviewWindow(win: Window | null) {
    target = win;
}

export function postToPreview(message: Record<string, unknown>) {
    target?.postMessage({ mk: 1, ...message }, "*");
}

// Asks the preview for something and waits for its answer (or gives up after a while).
export function askPreview<T>(type: "layers" | "capture", extra: Record<string, unknown> = {}, timeout = 15000): Promise<T | null> {
    if (!target) return Promise.resolve(null);
    const key = type === "capture" ? `capture:${String(extra.id ?? "")}` : type;
    return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
            waiting.delete(key);
            resolve(null);
        }, timeout);
        waiting.set(key, (value) => {
            window.clearTimeout(timer);
            resolve(value as T);
        });
        postToPreview({ type, ...extra });
    });
}

// The preview pane hands over answers here; true when one was waited for.
export function answered(key: string, value: unknown): boolean {
    const done = waiting.get(key);
    if (!done) return false;
    waiting.delete(key);
    done(value);
    return true;
}

export function setPreviewScroll(x: number, y: number) {
    if (x === scroll.x && y === scroll.y) return;
    scroll = { x, y };
    for (const l of listeners) l();
}

export function usePreviewScroll(): { x: number; y: number } {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => scroll,
    );
}

import { useSyncExternalStore } from "react";

// Which style editor is open (one at a time, over the whole app).
export type EditorRequest = { mode: "create"; nodeIds: string[] } | { mode: "edit"; styleId: string } | null;
let request: EditorRequest = null;
const listeners = new Set<() => void>();
export function setTextStyleRequest(next: EditorRequest) {
    request = next;
    for (const l of listeners) l();
}
export function openTextStyleEditor(next: EditorRequest) {
    setTextStyleRequest(next);
}
export function useTextStyleRequest() {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => request,
    );
}


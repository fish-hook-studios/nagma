import { useSyncExternalStore } from "react";

// ⌘K (and ⇧⌘U) on text: opens the link field in the Design panel's Typography section for the
// selected range or layer, instead of a browser prompt.

let open = 0;
const listeners = new Set<() => void>();

export function openLinkEditor() {
    open++;
    for (const l of listeners) l();
}

export function useLinkRequests(): number {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => open,
    );
}

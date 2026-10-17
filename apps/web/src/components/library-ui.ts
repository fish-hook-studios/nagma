import { useSyncExternalStore } from "react";
import { refreshLibraries } from "../engine/library";

// Which library windows are open (Libraries, Publish).

export type Tab = "file" | "updates" | "libraries";
interface UiState {
    libraries: Tab | null;
    publish: boolean;
}
let ui: UiState = { libraries: null, publish: false };
const uiListeners = new Set<() => void>();
export function setUi(patch: Partial<UiState>) {
    ui = { ...ui, ...patch };
    for (const l of uiListeners) l();
}
export function useUi(): UiState {
    return useSyncExternalStore(
        (l) => {
            uiListeners.add(l);
            return () => uiListeners.delete(l);
        },
        () => ui,
    );
}

export function openLibraries(tab: Tab = "libraries") {
    setUi({ libraries: tab });
    void refreshLibraries();
}
export function openPublish() {
    setUi({ publish: true, libraries: null });
}


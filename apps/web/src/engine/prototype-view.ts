import { useSyncExternalStore } from "react";
import { userStorage } from "./user-storage";

// Where a prototype plays, like a design tool's desktop app: Present opens the file's prototype in a
// tab of its own beside the file's tab, and Shift+Space previews the selected frame in a panel docked
// on the canvas.

// A prototype tab sits in the tab list as "proto:<file id>", so stored tabs (plain file ids) still load.
const PREFIX = "proto:";
export const protoTabId = (fileId: string) => `${PREFIX}${fileId}`;
export const protoFileOf = (tabId: string): string | null => (tabId.startsWith(PREFIX) ? tabId.slice(PREFIX.length) : null);

interface PrototypeView {
    // The frame each file's prototype tab starts on ("" for a file that isn't in the library).
    starts: Record<string, string>;
    // Bumped by every Present, so the tab's player starts over.
    run: number;
    // The frame the preview panel plays, if it's open.
    preview: string | null;
}

const STARTS_KEY = "nagma.protoTabs.v1";
function loadStarts(): Record<string, string> {
    try {
        return JSON.parse(userStorage.getItem(STARTS_KEY) ?? "{}") as Record<string, string>;
    } catch {
        return {};
    }
}

let view: PrototypeView = { starts: loadStarts(), run: 0, preview: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PrototypeView>) {
    view = { ...view, ...patch };
    if (patch.starts) {
        try {
            userStorage.setItem(STARTS_KEY, JSON.stringify(view.starts));
        } catch {
            // The tab still starts on its frame this session.
        }
    }
    for (const l of listeners) l();
}

export function prototypeView(): PrototypeView {
    return view;
}

export function subscribePrototypeView(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function usePrototypeView(): PrototypeView {
    return useSyncExternalStore(subscribePrototypeView, prototypeView);
}

export function setPrototypeStart(fileId: string, frameId: string) {
    set({ starts: { ...view.starts, [fileId]: frameId }, run: view.run + 1 });
}

export function forgetPrototype(fileId: string) {
    if (!(fileId in view.starts)) return;
    const starts = { ...view.starts };
    delete starts[fileId];
    set({ starts });
}

export function openPreview(frameId: string) {
    set({ preview: frameId });
}

export function closePreview() {
    if (view.preview) set({ preview: null });
}

import { useSyncExternalStore } from "react";
import { devStatusOf, devStatusTargets, setDevStatus } from "../engine/dev-status";
import { editor } from "../engine/store";
import { openFocus } from "../engine/dev-view";

// Where the status menu is open (window coordinates), for which layers, and whether it is asking
// for the reason a changed design is ready again.
interface MenuState {
    ids: string[];
    x: number;
    y: number;
    asking: boolean;
}
let menu: MenuState | null = null;
const listeners = new Set<() => void>();
export function setDevMenu(next: MenuState | null) {
    menu = next;
    for (const l of listeners) l();
}
export function openDevStatusMenu(ids: string[], x: number, y: number) {
    setDevMenu({ ids, x, y, asking: false });
}
// Marking a changed design ready again asks what changed first.
export function askDevChangeNote(ids: string[], x: number, y: number) {
    setDevMenu({ ids, x, y, asking: true });
}
export function useDevMenu() {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => menu,
    );
}

// Picks the right action for "Mark as ready for dev": straight away, or with a note when changed.
export function markReady(ids: string[], x: number, y: number) {
    const { doc } = editor.get();
    if (ids.some((id) => devStatusOf(doc, doc.nodes[id]) === "changed")) askDevChangeNote(ids, x, y);
    else setDevStatus(ids, "ready");
}

// Context menu rows for the selected frames and sections.
export function devStatusMenuItems(x: number, y: number): { id: string; label: string; run: () => void }[] {
    const { doc, selection } = editor.get();
    const targets = devStatusTargets(doc, selection);
    if (!targets.length || targets.length !== selection.length) return [];
    const ids = targets.map((n) => n.id);
    const statuses = new Set(targets.map((n) => devStatusOf(doc, n)));
    const only = statuses.size === 1 ? [...statuses][0] : undefined;
    if (only === null) return [{ id: "devReady", label: "Mark as ready for dev", run: () => markReady(ids, x, y) }];
    return [
        ...(only !== "ready" ? [{ id: "devReady", label: "Mark as ready for dev", run: () => markReady(ids, x, y) }] : []),
        ...(only === "ready" ? [{ id: "devDone", label: "Mark as completed", run: () => setDevStatus(ids, "completed") }] : []),
        { id: "devRemove", label: "Remove status", run: () => setDevStatus(ids, null) },
        ...(ids.length === 1 ? [{ id: "devFocus", label: "Show in focus view", run: () => openFocus(ids[0] as string) }] : []),
    ];
}


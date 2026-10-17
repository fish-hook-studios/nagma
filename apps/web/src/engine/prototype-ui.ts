import { useSyncExternalStore } from "react";

// Canvas state for prototype connections: which one the pointer is over, which is selected, a drag
// in progress (a new connection, moving an arrow's end, or a flow's start label), and whether
// connections show at all (⇧E).

export interface ConnectionRef {
    node: string;
    interaction: number;
    // Index path to the action (see walkActions).
    path: number[];
}

export type ProtoDrag =
    | { kind: "new"; from: string; cursor: { x: number; y: number } }
    | { kind: "retarget"; ref: ConnectionRef; cursor: { x: number; y: number } }
    | { kind: "flow"; from: string; cursor: { x: number; y: number } };

// The Interaction popover: which layer's interaction is open, the action picked inside it (a path as
// in walkActions), and where it points. `anchor` is the connection it points at and how far along
// its curve (0 to 1), so it follows the connection as the canvas pans and zooms; without one (the
// connection isn't drawn or is off the canvas) it sits beside the right panel, `y` client pixels down.
export interface InteractionEdit {
    node: string;
    interaction: number;
    path: number[] | null;
    y: number;
    anchor?: { ref: ConnectionRef; t: number } | null;
}

interface ProtoUi {
    hover: ConnectionRef | null;
    selected: ConnectionRef | null;
    drag: ProtoDrag | null;
    hidden: boolean;
    editing: InteractionEdit | null;
}

const KEY = "nagma.prototype.connections.hidden";

function loadHidden(): boolean {
    try {
        return localStorage.getItem(KEY) === "1";
    } catch {
        return false;
    }
}

let state: ProtoUi = { hover: null, selected: null, drag: null, hidden: loadHidden(), editing: null };
const listeners = new Set<() => void>();

export const protoUi = {
    get: () => state,
    set(patch: Partial<ProtoUi>) {
        state = { ...state, ...patch };
        if ("hidden" in patch) {
            try {
                localStorage.setItem(KEY, state.hidden ? "1" : "0");
            } catch {
                // Not remembered in private windows.
            }
        }
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useProtoUi<T>(selector: (s: ProtoUi) => T): T {
    return useSyncExternalStore(protoUi.subscribe, () => selector(state));
}

export function sameRef(a: ConnectionRef | null, b: ConnectionRef | null): boolean {
    return Boolean(a && b && a.node === b.node && a.interaction === b.interaction && a.path.join(".") === b.path.join("."));
}

export function openInteraction(edit: InteractionEdit) {
    protoUi.set({ editing: edit });
}

export function closeInteraction() {
    if (state.editing) protoUi.set({ editing: null });
}

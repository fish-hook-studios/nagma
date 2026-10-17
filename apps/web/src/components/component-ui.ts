import { useSyncExternalStore } from "react";
import type { BindField } from "../engine/component-actions";
import type { ComponentProp } from "../engine/types";

// The component property window: create a property (optionally binding a layer's field to it), or
// edit an existing one.
export interface PropEditing {
    hostId: string;
    propId: string | null;
    kind: ComponentProp["kind"] | "variant";
    bind?: { nodeId: string; field: BindField };
    // Variant properties are edited by name.
    variantName?: string;
}

let editing: PropEditing | null = null;
const listeners = new Set<() => void>();

export function editProp(next: PropEditing | null) {
    editing = next;
    for (const l of listeners) l();
}

export function usePropEditing(): PropEditing | null {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => editing,
    );
}

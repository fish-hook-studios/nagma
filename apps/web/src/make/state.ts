import { useSyncExternalStore } from "react";
import type { MakeAttachment, PickedElement } from "./types";

// The Make editor's own state (per viewer, not part of the document): which tab and device the
// preview shows, the open file in Code, Point and edit, the prompt being written and its
// attachments, and the answer being generated.

export type MakeView = "preview" | "code";
export type Device = "desktop" | "tablet" | "mobile";
// The device frame's colours (Preview settings › Color).
export const FRAME_COLORS = { graphite: "#3A3A3C", silver: "#D9D9DE", lavender: "#C9B8E8" } as const;
export type SidePanel = "comments" | null;
export type MakeDialog = "github" | "settings" | "library" | null;

// A change staged in the properties panel, by the element's source ("path:line"): written into the
// code only on Apply.
export interface StagedEdit {
    text?: string;
    style: Record<string, string>;
}

export interface AiStatus {
    available: boolean;
    model: string | null;
    models?: { id: string; label: string }[];
    // The server has a GitHub token of its own.
    github?: boolean;
    signedIn: boolean;
    // No AI key to use (yours or the server's): Account settings › AI is where to add one.
    keyNeeded?: boolean;
    // Whose key answers: "own" or the server's "shared" one, and its provider.
    source?: "own" | "shared";
    provider?: string;
    // The server couldn't be reached at all.
    offline?: boolean;
}

export interface Busy {
    status: string;
    files: string[];
    startedAt: number;
    abort: AbortController | null;
}

export interface MakeState {
    view: MakeView;
    device: Device;
    openFile: string | null;
    picking: boolean;
    picked: PickedElement | null;
    prompt: string;
    attachments: MakeAttachment[];
    busy: Busy | null;
    ai: AiStatus | null;
    // The preview's latest error (cleared when the app runs again).
    error: string | null;
    // Bumped to reload the preview.
    reload: number;
    side: SidePanel;
    attachOpen: boolean;
    // The edit tool: every element picked (⇧ click adds), and the changes staged for them.
    picks: PickedElement[];
    staged: Record<string, StagedEdit>;
    // Plan first, or build straight away.
    mode: "build" | "plan";
    // Prompts sent while an answer was being made, sent in turn.
    queue: string[];
    // Drawing on the preview to show a change.
    drawing: boolean;
    // Placing a comment pin on the preview (C, or F6 with the keyboard).
    commenting: boolean;
    dialog: MakeDialog;
    // Preview settings: the device frame's colour and the area around the preview (null: the theme's).
    frameColor: "none" | "graphite" | "silver" | "lavender";
    previewBg: string | null;
    // The Publish popover (Settings › Domains opens it too).
    publishOpen: boolean;
}

let state: MakeState = { view: "preview", device: "desktop", openFile: null, picking: false, picked: null, prompt: "", attachments: [], busy: null, ai: null, error: null, reload: 0, side: null, attachOpen: false, picks: [], staged: {}, mode: "build", queue: [], drawing: false, commenting: false, dialog: null, frameColor: "none", previewBg: null, publishOpen: false };
const listeners = new Set<() => void>();

export const make = {
    get: () => state,
    set(patch: Partial<MakeState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useMake<T>(selector: (s: MakeState) => T): T {
    return useSyncExternalStore(make.subscribe, () => selector(state));
}

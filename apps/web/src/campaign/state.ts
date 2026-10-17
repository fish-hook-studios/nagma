import { useSyncExternalStore } from "react";
import { editor } from "../engine/store";

// The campaign editor's own state (per viewer, not part of the document): the mode, which rail
// panel is open, the asset or grid view, the asset on show and which dialog is open.

// "campaign" is the product's own editor (the floating toolbar over the selection); "design" swaps
// in the full design editor (its toolbar and Design panel) around the same rail and panels; "edit"
// is what people who may only view get: the fields the templates open up, nothing else.
export type CampaignMode = "campaign" | "design" | "edit";
// The rail's panels. "assets" is the asset list beside the asset view; "bulk" is the Bulk edit table.
export type RailPanel = "assets" | "templates" | "text" | "media" | "inserts" | "plugins" | "bulk" | "reviews";
export type CampaignView = "asset" | "grid";
export type Dialog =
    | { kind: "bulk"; templateId?: string; rowId?: string }
    | { kind: "resize"; assetId: string }
    | { kind: "export"; ids?: string[]; all?: boolean }
    | { kind: "import" }
    | { kind: "add"; rowId?: string }
    | { kind: "review"; ids: string[] }
    | { kind: "publish" }
    | null;

export interface CampaignState {
    mode: CampaignMode;
    panel: RailPanel;
    view: CampaignView;
    // The asset the asset view shows (and Bulk edit previews).
    current: string | null;
    dialog: Dialog;
    busy: string | null;
}

let state: CampaignState = { mode: "campaign", panel: "assets", view: "asset", current: null, dialog: null, busy: null };
const listeners = new Set<() => void>();

export const campaign = {
    get: () => state,
    set(patch: Partial<CampaignState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
        // The canvas draws Edit mode's highlights, so it redraws on a mode change.
        editor.set({});
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useCampaign<T>(selector: (s: CampaignState) => T): T {
    return useSyncExternalStore(campaign.subscribe, () => selector(state));
}

export const isCampaignDoc = () => {
    const s = editor.get();
    return Boolean(s.doc.campaign) && !s.homeOpen && !s.presentingId;
};

export const inEditMode = () => isCampaignDoc() && state.mode === "edit";
// The product's own editor (the floating toolbar), as opposed to the full design editor.
export const inCampaignMode = () => isCampaignDoc() && state.mode !== "design";

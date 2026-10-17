import { inspectSettings } from "./inspect-settings";
import { editor } from "./store";
import type { EditorMode } from "./types";

// Switches the editor's mode. Each mode starts on the tool it's for, and leaving Motion stops
// playback so the design shows its resting state.
export function setMode(mode: EditorMode) {
    const s = editor.get();
    if (s.mode === mode) return;
    // The team's admins can keep Inspect to editors or to themselves.
    const team = inspectSettings.get();
    if (mode === "dev" && !team.canInspect) {
        editor.notify(team.settings?.access === "admins" ? "Only team admins can use Inspect on this team." : "Only people who can edit can use Inspect on this team.");
        return;
    }
    const tool = mode === "draw" ? "pencil" : s.tool === "pencil" || s.tool === "brush" || mode === "dev" ? "move" : s.tool;
    editor.set({ mode, tool, playing: false, time: mode === "motion" ? s.time : 0, editingTextId: null, editingVectorId: null, vertices: [] });
    if (mode === "dev") editor.notify("Inspect: look at layers and copy code. Switch back to Design to edit.");
}

export function openActions() {
    editor.set({ actionsOpen: true });
}

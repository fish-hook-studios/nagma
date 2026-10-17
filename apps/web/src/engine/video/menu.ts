import { collab, openSaveVersion } from "../collab";
import { download } from "../export";
import { editor } from "../store";
import { toggleShortcuts } from "../ui-state";
import {
    addAdjustment,
    addShape,
    addSolid,
    addTitle,
    addTrackOf,
    copySelection,
    deleteSelection,
    duplicateSelection,
    jumpEdit,
    jumpKey,
    markerAtPlayhead,
    nudgeSelection,
    openNested,
    shuttle,
    pasteAtPlayhead,
    pickMedia,
    precomposeSelection,
    saveFramePng,
    selectAll,
    setInOut,
    setLinked,
    splitAtPlayhead,
    step,
    toggleEnabled,
    togglePlay,
    zoomTimeline,
} from "./actions";
import { compLength } from "./model";
import { activeComp, clipboard, seek, vui } from "./state";

// The selected clip when it's a nested sequence.
function selectedNested(): string | null {
    const id = vui.get().selection[0];
    const clip = id ? activeComp().clips.find((c) => c.id === id) : undefined;
    return clip?.kind === "comp" ? clip.id : null;
}

// The whole sequence in the timeline's width.
export function fitTimeline() {
    const comp = activeComp();
    const w = (document.querySelector('[aria-label="Timeline"]') as HTMLElement | null)?.clientWidth ?? 900;
    vui.set({ pxPerSec: Math.max(4, Math.min(1200, (w - 220) / Math.max(1, compLength(comp)))) });
}

// The video editor's commands, for its main menu and the desktop app's menu bar.

export interface VideoAction {
    id: string;
    label: string;
    shortcut?: string;
    enabled?: () => boolean;
    checked?: () => boolean;
    run: () => void;
}

const hasSel = () => vui.get().selection.length > 0;

export const VIDEO_ACTIONS: VideoAction[] = [
    { id: "v:import", label: "Import media…", shortcut: "⌘ I", run: () => pickMedia() },
    { id: "v:export", label: "Export…", shortcut: "⌘ E", run: () => vui.set({ exportOpen: true }) },
    { id: "v:frame", label: "Export frame as PNG", shortcut: "⇧ ⌘ E", run: () => void saveFramePng() },
    {
        id: "v:save",
        label: "Save local copy…",
        run: () => {
            const doc = editor.get().doc;
            download(new Blob([JSON.stringify(doc)], { type: "application/json" }), `${doc.name || "Untitled"}.nagma.json`);
        },
    },
    { id: "v:version", label: "Save to version history…", shortcut: "⌥ ⌘ S", run: openSaveVersion },
    { id: "v:history", label: "Show version history", run: () => collab.set({ historyOpen: true }) },
    { id: "v:undo", label: "Undo", shortcut: "⌘ Z", enabled: () => editor.get().past.length > 0, run: () => editor.undo() },
    { id: "v:redo", label: "Redo", shortcut: "⇧ ⌘ Z", enabled: () => editor.get().future.length > 0, run: () => editor.redo() },
    { id: "v:cut", label: "Cut", shortcut: "⌘ X", enabled: hasSel, run: () => copySelection(true) },
    { id: "v:copy", label: "Copy", shortcut: "⌘ C", enabled: hasSel, run: () => copySelection() },
    { id: "v:paste", label: "Paste at playhead", shortcut: "⌘ V", enabled: () => clipboard.length > 0, run: pasteAtPlayhead },
    { id: "v:duplicate", label: "Duplicate", shortcut: "⌘ D", enabled: hasSel, run: duplicateSelection },
    { id: "v:delete", label: "Delete", shortcut: "⌫", enabled: () => hasSel() || Boolean(vui.get().transition || vui.get().marker), run: () => deleteSelection(false) },
    { id: "v:ripple", label: "Ripple delete", shortcut: "⌥ ⌫", run: () => deleteSelection(true) },
    { id: "v:selectAll", label: "Select all clips", shortcut: "⌘ A", run: selectAll },
    { id: "v:deselect", label: "Deselect", shortcut: "Esc", enabled: hasSel, run: () => vui.set({ selection: [], transition: null, marker: null }) },
    { id: "v:split", label: "Split at playhead", shortcut: "S", run: splitAtPlayhead },
    { id: "v:splitK", label: "Split at playhead (add edit)", shortcut: "⌘ K", run: splitAtPlayhead },
    { id: "v:razor", label: "Razor tool", shortcut: "C", checked: () => vui.get().tool === "razor", run: () => vui.set({ tool: vui.get().tool === "razor" ? "select" : "razor" }) },
    { id: "v:select", label: "Selection tool", shortcut: "V", checked: () => vui.get().tool === "select", run: () => vui.set({ tool: "select" }) },
    { id: "v:link", label: "Link clips", shortcut: "⌘ L", enabled: hasSel, run: () => setLinked(true) },
    { id: "v:unlink", label: "Unlink clips", shortcut: "⇧ ⌘ L", enabled: hasSel, run: () => setLinked(false) },
    { id: "v:enable", label: "Enable or disable clip", shortcut: "⇧ E", enabled: hasSel, run: toggleEnabled },
    { id: "v:nest", label: "Nest into a sequence", shortcut: "⌘ G", enabled: hasSel, run: precomposeSelection },
    { id: "v:title", label: "Title", shortcut: "T", run: () => addTitle() },
    { id: "v:lower", label: "Lower third", run: () => addTitle("lower-third") },
    { id: "v:subtitle", label: "Subtitle", run: () => addTitle("subtitle") },
    { id: "v:rect", label: "Rectangle", run: () => addShape("rect") },
    { id: "v:ellipse", label: "Ellipse", run: () => addShape("ellipse") },
    { id: "v:star", label: "Star", run: () => addShape("star") },
    { id: "v:solid", label: "Color matte", run: () => addSolid() },
    { id: "v:adjust", label: "Adjustment layer", run: () => addAdjustment() },
    { id: "v:vtrack", label: "Add video track", run: () => addTrackOf("video") },
    { id: "v:atrack", label: "Add audio track", run: () => addTrackOf("audio") },
    { id: "v:play", label: "Play or pause", shortcut: "Space", run: togglePlay },
    { id: "v:prevFrame", label: "Back one frame", shortcut: "←", run: () => step(-1) },
    { id: "v:nextFrame", label: "Forward one frame", shortcut: "→", run: () => step(1) },
    { id: "v:prevEdit", label: "Previous edit", shortcut: "↑", run: () => jumpEdit(-1) },
    { id: "v:nextEdit", label: "Next edit", shortcut: "↓", run: () => jumpEdit(1) },
    { id: "v:in", label: "Mark in", shortcut: "I", run: () => setInOut("in") },
    { id: "v:out", label: "Mark out", shortcut: "O", run: () => setInOut("out") },
    { id: "v:clearInOut", label: "Clear in and out", shortcut: "⌥ X", run: () => setInOut("clear") },
    { id: "v:marker", label: "Add marker", shortcut: "M", run: markerAtPlayhead },
    { id: "v:snap", label: "Snapping", shortcut: "⇧ S", checked: () => vui.get().snapping, run: () => vui.set({ snapping: !vui.get().snapping }) },
    { id: "v:safe", label: "Safe margins", checked: () => vui.get().safeArea, run: () => vui.set({ safeArea: !vui.get().safeArea }) },
    { id: "v:loop", label: "Loop playback", checked: () => vui.get().loop, run: () => vui.set({ loop: !vui.get().loop }) },
    { id: "v:zoomIn", label: "Zoom timeline in", shortcut: "=", run: () => zoomTimeline(1.5) },
    { id: "v:zoomOut", label: "Zoom timeline out", shortcut: "-", run: () => zoomTimeline(1 / 1.5) },
    { id: "v:fit", label: "Fit the sequence in the timeline", shortcut: "\\", run: () => fitTimeline() },
    { id: "v:shuttleBack", label: "Play backwards (faster each press)", shortcut: "J", run: () => shuttle(-1) },
    { id: "v:shuttleStop", label: "Stop", shortcut: "K", run: () => shuttle(0) },
    { id: "v:shuttleForward", label: "Play forwards (faster each press)", shortcut: "L", run: () => shuttle(1) },
    { id: "v:start", label: "Go to start", shortcut: "Home", run: () => seek(0) },
    { id: "v:end", label: "Go to end", shortcut: "End", run: () => seek(compLength(activeComp())) },
    { id: "v:prevKey", label: "Previous keyframe", shortcut: "[", run: () => jumpKey(-1) },
    { id: "v:nextKey", label: "Next keyframe", shortcut: "]", run: () => jumpKey(1) },
    { id: "v:nudgeLeft", label: "Nudge clips left a frame", shortcut: "⌥ ←", enabled: hasSel, run: () => nudgeSelection(-1) },
    { id: "v:nudgeRight", label: "Nudge clips right a frame", shortcut: "⌥ →", enabled: hasSel, run: () => nudgeSelection(1) },
    { id: "v:openNested", label: "Open nested sequence", shortcut: "↵", enabled: () => selectedNested() !== null, run: () => {
        const id = selectedNested();
        if (id) openNested(id);
    } },
    { id: "v:panel", label: "Show or hide the left panel", shortcut: "⌘ \\", checked: () => vui.get().leftOpen, run: () => vui.set({ leftOpen: !vui.get().leftOpen }) },
    { id: "v:effects", label: "Effects…", run: () => vui.set({ leftOpen: true, leftTab: "library", libraryTab: "effects" }) },
    { id: "v:transitions", label: "Transitions…", run: () => vui.set({ leftOpen: true, leftTab: "library", libraryTab: "transitions" }) },
    { id: "v:presets", label: "Motion presets…", run: () => vui.set({ leftOpen: true, leftTab: "library", libraryTab: "motion" }) },
    { id: "v:shortcuts", label: "Keyboard shortcuts", shortcut: "⌃ ⇧ ?", run: toggleShortcuts },
];

export const VIDEO_ACTION_BY_ID = new Map(VIDEO_ACTIONS.map((a) => [a.id, a]));

export function runVideoAction(id: string) {
    const action = VIDEO_ACTION_BY_ID.get(id);
    if (action && (action.enabled?.() ?? true)) action.run();
}

export type VideoMenuNode = string | { sub: string; label: string; items: VideoMenuNode[] };

// The in-app main menu.
export const VIDEO_MENU: VideoMenuNode[] = [
    { sub: "file", label: "File", items: ["v:import", "-", "v:export", "v:frame", "-", "v:save", "v:version", "v:history"] },
    { sub: "edit", label: "Edit", items: ["v:undo", "v:redo", "-", "v:cut", "v:copy", "v:paste", "v:duplicate", "v:delete", "v:ripple", "-", "v:selectAll", "v:deselect"] },
    { sub: "clip", label: "Clip", items: ["v:split", "v:splitK", "v:razor", "v:select", "-", "v:nudgeLeft", "v:nudgeRight", "-", "v:link", "v:unlink", "v:enable", "v:nest", "v:openNested"] },
    { sub: "graphics", label: "Graphics", items: ["v:title", "v:lower", "v:subtitle", "-", "v:rect", "v:ellipse", "v:star", "-", "v:solid", "v:adjust"] },
    { sub: "sequence", label: "Sequence", items: ["v:vtrack", "v:atrack", "-", "v:in", "v:out", "v:clearInOut", "v:marker", "-", "v:snap"] },
    { sub: "playback", label: "Playback", items: ["v:play", "v:shuttleBack", "v:shuttleStop", "v:shuttleForward", "-", "v:prevFrame", "v:nextFrame", "v:prevEdit", "v:nextEdit", "v:prevKey", "v:nextKey", "v:start", "v:end", "-", "v:loop", "v:safe", "-", "v:zoomIn", "v:zoomOut", "v:fit", "v:panel"] },
    { sub: "library", label: "Library", items: ["v:effects", "v:transitions", "v:presets"] },
    "-",
    "v:shortcuts",
];

// The desktop menu bar's file menus while a video is open; its menu titles are fixed (File,
// Edit, Object, Text, Arrange, Vector, Plugins, Widgets), so the video's menus sit in them.
export const VIDEO_DESKTOP_SPEC: Record<string, (string | { sub: string; items: string[] })[]> = {
    app: [],
    file: ["v:import", "v:export", "v:frame", "-", "v:version", "v:history"],
    edit: ["v:duplicate", "v:delete", "v:ripple", "-", "v:deselect"],
    view: [],
    object: ["v:split", "v:razor", "v:select", "-", "v:link", "v:unlink", "v:enable", "v:nest", "-", "v:vtrack", "v:atrack"],
    text: ["v:title", "v:lower", "v:subtitle"],
    arrange: ["v:in", "v:out", "v:clearInOut", "v:marker", "-", "v:snap", "v:loop", "v:safe"],
    vector: ["v:rect", "v:ellipse", "v:star", "-", "v:solid", "v:adjust"],
    plugins: ["v:effects", "v:transitions"],
    widgets: ["v:presets"],
    help: ["v:shortcuts"],
};

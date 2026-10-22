import { useSyncExternalStore } from "react";
import { onImageReady } from "../image-store";
import { collab } from "../collab";
import { applyCommand } from "../commands";
import { editor } from "../store";
import type { Command, NagmaDocument } from "../types";
import { type VClip, type VComp, type VProject, ROOT, compById, projectOf, replaceComp, withProject } from "./model";

// The video editor's own view state (playhead, selection, zoom, panels) and the helpers that
// turn edits of the project into undoable commands on the document.

export type VTool = "select" | "razor";
export type LeftTab = "project" | "library";
export type LibraryTab = "effects" | "transitions" | "titles" | "motion" | "shapes";

export interface VideoUi {
    // Seconds into the open composition.
    time: number;
    playing: boolean;
    // Shuttle speed (J/K/L): negative plays backwards.
    rate: number;
    compId: string;
    // Compositions opened inside each other, outermost first.
    trail: string[];
    selection: string[];
    // A transition picked on the timeline: the clip it belongs to and its side.
    transition: { clip: string; side: "in" | "out" } | null;
    marker: string | null;
    pxPerSec: number;
    tool: VTool;
    snapping: boolean;
    leftTab: LeftTab;
    libraryTab: LibraryTab;
    leftOpen: boolean;
    quality: "auto" | "full" | "half" | "quarter";
    safeArea: boolean;
    monitorZoom: number | "fit";
    loop: boolean;
    timelineHeight: number;
    exportOpen: boolean;
    graph: { clip: string; path: string } | null;
    timelineView: "tracks" | "graph";
    mediaSelection: string[];
    importing: number;
    // The Comment tool: clicks on the monitor leave comment pins; the Inspector lists the threads.
    commenting: boolean;
    // A path mask whose vertices are being edited on the monitor.
    maskEdit: { clip: string; mask: string } | null;
}

let state: VideoUi = {
    time: 0,
    playing: false,
    rate: 1,
    compId: ROOT,
    trail: [],
    selection: [],
    transition: null,
    marker: null,
    pxPerSec: 80,
    tool: "select",
    snapping: true,
    leftTab: "project",
    libraryTab: "effects",
    leftOpen: true,
    quality: "auto",
    safeArea: false,
    monitorZoom: "fit",
    loop: false,
    timelineHeight: 300,
    exportOpen: false,
    graph: null,
    timelineView: "tracks",
    mediaSelection: [],
    importing: 0,
    commenting: false,
    maskEdit: null,
};

const listeners = new Set<() => void>();

export const vui = {
    get: () => state,
    set(patch: Partial<VideoUi>) {
        // Picking clips lets go of a picked transition or marker: one is picked at a time (a title
        // added after picking a transition left the transition in the inspector, and ⌫ then
        // removed the transition, not the title).
        if (patch.selection?.length) patch = { transition: null, marker: null, ...patch };
        // Mask vertex editing belongs to one clip: picking another ends it.
        if (patch.selection && state.maskEdit && !patch.selection.includes(state.maskEdit.clip)) patch = { maskEdit: null, ...patch };
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(l: () => void) {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

// For checking the video editor from the browser console while developing (the editor is window.nagma).
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { nagmaVideo: vui });

export function useVideoUi<T>(pick: (s: VideoUi) => T): T {
    return useSyncExternalStore(vui.subscribe, () => pick(state));
}

// Clips copied with ⌘C, kept across compositions.
export let clipboard: VClip[] = [];
export function setClipboard(clips: VClip[]) {
    clipboard = clips;
}

// ---- The project in the open document ----

export function currentProject(): VProject {
    return projectOf(editor.get().doc);
}

export function activeComp(project = currentProject()): VComp {
    return compById(project, state.compId);
}

export function projectCommand(project: VProject): Command {
    return { type: "sequence.set", sequence: withProject(project) };
}

// Saves an edited project as one undo step.
export function commitProject(project: VProject, base?: NagmaDocument) {
    editor.execute(projectCommand(project), base);
}

export function commitComp(comp: VComp, project = currentProject(), base?: NagmaDocument) {
    commitProject(replaceComp(project, comp), base);
}

// Live drags: shown without history, then saved once from where they started.
export function previewComp(base: NagmaDocument, comp: VComp) {
    editor.preview(applyCommand(base, projectCommand(replaceComp(projectOf(base), comp))));
}

export function editClips(fn: (clip: VClip, comp: VComp) => VClip, ids: Iterable<string> = state.selection) {
    const project = currentProject();
    const comp = activeComp(project);
    const set = new Set(ids);
    commitComp({ ...comp, clips: comp.clips.map((c) => (set.has(c.id) ? fn(c, comp) : c)) }, project);
}

export function editClip(id: string, fn: (clip: VClip, comp: VComp) => VClip) {
    editClips(fn, [id]);
}

export function openComp(id: string) {
    const trail = id === ROOT ? [] : [...state.trail.filter((c) => c !== id), state.compId].filter((c) => c !== id);
    vui.set({ compId: id, trail: id === ROOT ? [] : trail, selection: [], time: 0, playing: false, transition: null });
}

// The Comment tool on or off (off lets go of an unposted comment).
export function toggleCommenting(on = !state.commenting) {
    vui.set({ commenting: on });
    if (!on) collab.set({ draft: null });
}

export function seek(t: number) {
    vui.set({ time: Math.max(0, t), playing: false, rate: 1 });
}

// Seconds into a clip at the playhead.
export function useClipTime(clip: VClip): number {
    const time = useVideoUi((s) => s.time);
    return time - clip.start;
}

// Redraws when stored pictures (posters) finish loading.
let imageTick = 0;
const imageListeners = new Set<() => void>();
onImageReady(() => {
    imageTick++;
    for (const l of imageListeners) l();
});
export function useImagesReady(): number {
    return useSyncExternalStore(
        (l) => {
            imageListeners.add(l);
            return () => imageListeners.delete(l);
        },
        () => imageTick,
    );
}

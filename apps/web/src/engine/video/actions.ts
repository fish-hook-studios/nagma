import { nanoid } from "nanoid";
import { download, safeName } from "../export";
import { editor } from "../store";
import { effectCatalog } from "../../engines/motion-engine";
import {
    type TransitionKind,
    type VClip,
    type VComp,
    type VEffect,
    type ShapeItemKind,
    type VMedia,
    type VTrack,
    ROOT,
    clipEnd,
    compById,
    compLength,
    newClip,
    replaceComp,
    snapTime,
} from "./model";
import {
    addMarker,
    addShapeItem,
    addTrack,
    clipAfter,
    clipBefore,
    closeGap,
    duplicateClips,
    keyTimes,
    linkClips,
    pasteClips,
    placeGenerated,
    placeMedia,
    precompose,
    removeClips,
    rippleDelete,
    setTransition,
    splitAt,
    updateTrack,
    withLinked,
} from "./edit";
import { importMediaFile, MEDIA_ACCEPT, pickFiles } from "./import";
import { MOTION_PRESETS, TITLE_PRESETS, scaledTitle, titleClipProps } from "./presets";
import { newShapeItem, newShapeItemProps } from "./shapes";
import { activeComp, clipboard, commitComp, commitProject, currentProject, openComp, seek, setClipboard, vui } from "./state";

// What the editor's buttons, menus and keys do.

export function selectedClips(comp: VComp = activeComp()): VClip[] {
    const ids = new Set(vui.get().selection);
    return comp.clips.filter((c) => ids.has(c.id));
}

// The selected clips and their linked partners that may be changed: clips on locked tracks are
// left as they are (nudging, cutting, duplicating, nesting or disabling moved and changed them).
function editableSelection(comp: VComp = activeComp()): Set<string> {
    const locked = new Set(comp.tracks.filter((t) => t.locked).map((t) => t.id));
    return new Set([...withLinked(comp, vui.get().selection)].filter((id) => !locked.has(comp.clips.find((c) => c.id === id)?.track ?? "")));
}

function at(): number {
    const comp = activeComp();
    return snapTime(vui.get().time, comp.fps);
}

// ---- Media ----

export async function importFiles(files: File[], place?: { at: number; track?: string }) {
    vui.set({ importing: vui.get().importing + files.length });
    const fileId = editor.get().fileId;
    const added: VMedia[] = [];
    const commands = [];
    // What couldn't be added is said along with what was (each file's message replaced the one
    // before, so "Added 4 files." hid the files that failed).
    const problems: string[] = [];
    for (const file of files) {
        try {
            const result = await importMediaFile(file);
            if (!result) {
                problems.push(`${file.name} isn't a video, sound or image file.`);
                continue;
            }
            added.push(result.media);
            commands.push(...result.commands);
        } catch (error) {
            problems.push(`Couldn't add ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            vui.set({ importing: Math.max(0, vui.get().importing - 1) });
        }
    }
    const report = (lead: string) => {
        const text = [lead, ...problems].filter(Boolean).join(" ");
        if (text) editor.notify(text);
    };
    // Another file was opened while these were read: they don't belong in it.
    if (editor.get().fileId !== fileId) return report(added.length ? "The import stopped: another file was opened." : "");
    if (!added.length) return report("");
    let project = currentProject();
    project = { ...project, media: [...project.media, ...added] };
    let comp = compById(project, vui.get().compId);
    // The first video sets an empty sequence's size and rate.
    const firstVideo = added.find((m) => m.kind === "video");
    if (firstVideo && !comp.clips.length && comp.id === ROOT && firstVideo.width > 0) {
        comp = { ...comp, width: firstVideo.width, height: firstVideo.height, fps: Math.round(firstVideo.fps) || comp.fps };
    }
    let ids: string[] = [];
    if (place) {
        const placed = placeMedia(project, comp, added, place.at, place.track, place.track);
        comp = placed.comp;
        ids = placed.ids;
    }
    project = replaceComp(project, comp);
    editor.execute({ type: "batch", commands: [...commands, { type: "sequence.set", sequence: { width: project.root.width, height: project.root.height, fps: project.root.fps, clips: [], edit: project } }] });
    vui.set({ mediaSelection: added.map((m) => m.id), ...(ids.length ? { selection: ids } : {}) });
    report(added.length === 1 ? `Added ${added[0]?.name ?? "media"}.` : `Added ${added.length} files.`);
}

export function pickMedia(place?: { at: number; track?: string }) {
    pickFiles(MEDIA_ACCEPT, (files) => void importFiles(files, place));
}

// Media from the bin onto the timeline at the playhead (or `t`).
export function insertMedia(ids: string[], t = at(), track?: string) {
    const project = currentProject();
    const media = ids.map((id) => project.media.find((m) => m.id === id)).filter((m): m is VMedia => Boolean(m));
    if (!media.length) return;
    const placed = placeMedia(project, activeComp(project), media, t, track, track);
    commitComp(placed.comp, project);
    vui.set({ selection: placed.ids });
}

export function removeMedia(ids: string[]) {
    const project = currentProject();
    const gone = new Set(ids);
    const strip = (c: VComp): VComp => ({ ...c, clips: c.clips.filter((cl) => !cl.media || !gone.has(cl.media)) });
    commitProject({ ...project, media: project.media.filter((m) => !gone.has(m.id)), root: strip(project.root), comps: project.comps.map(strip) });
    vui.set({ mediaSelection: [] });
}

export function renameMedia(id: string, name: string) {
    const project = currentProject();
    commitProject({ ...project, media: project.media.map((m) => (m.id === id ? { ...m, name } : m)) });
}

// ---- Generated clips ----

export function addTitle(presetId = "headline", t = at()) {
    const preset = TITLE_PRESETS.find((p) => p.id === presetId) ?? TITLE_PRESETS[0];
    if (!preset) return;
    const project = currentProject();
    const comp = activeComp(project);
    const clip = newClip("title", "", t, preset.duration, preset.title.text.split("\n")[0] ?? "Title", { title: scaledTitle(comp, preset.title), props: titleClipProps(comp, preset) });
    const placed = placeGenerated(comp, clip);
    commitComp(placed.comp, project);
    vui.set({ selection: [placed.id] });
}

// A shape layer holding one item of `kind` ("line" from older menus is a two-point path).
export function addShape(kind: ShapeItemKind | "line", t = at()) {
    const project = currentProject();
    const comp = activeComp(project);
    const item = newShapeItem(kind === "line" ? "path" : kind, comp);
    if (kind === "line") {
        const w = Math.round(comp.height * 0.35 * 0.8);
        item.points = [{ x: -w, y: 0 }, { x: w, y: 0 }];
        item.name = "Line";
    }
    const clip = newClip("shape", "", t, 5, item.name, { shapes: [item], props: newShapeItemProps(item, comp) });
    const placed = placeGenerated(comp, clip);
    commitComp(placed.comp, project);
    vui.set({ selection: [placed.id] });
}

// Another item on the selected shape layer (or a new shape layer when none is selected).
export function addShapeItemToSelection(kind: ShapeItemKind, t = at()) {
    const project = currentProject();
    const comp = activeComp(project);
    const target = selectedClips(comp).find((c) => c.kind === "shape");
    if (!target) return addShape(kind, t);
    const item = newShapeItem(kind, comp);
    commitComp({ ...comp, clips: comp.clips.map((c) => (c.id === target.id ? addShapeItem(comp, c, item) : c)) }, project);
}

export function addSolid(color = "#1E1E24", t = at()) {
    const project = currentProject();
    const comp = activeComp(project);
    const placed = placeGenerated(comp, newClip("solid", "", t, 5, "Color matte", { color }));
    commitComp(placed.comp, project);
    vui.set({ selection: [placed.id] });
}

export function addAdjustment(t = at()) {
    const project = currentProject();
    const comp = activeComp(project);
    const placed = placeGenerated(comp, newClip("adjustment", "", t, 5, "Adjustment layer"));
    commitComp(placed.comp, project);
    vui.set({ selection: [placed.id] });
}

// ---- Editing ----

export function splitAtPlayhead() {
    const comp = activeComp();
    const sel = vui.get().selection;
    // With clips selected, only they (and their linked partners) are cut.
    const ids = sel.length ? withLinked(comp, sel) : undefined;
    const result = splitAt(comp, at(), ids);
    if (!result.created.length) {
        editor.notify("Nothing under the playhead to cut.");
        return;
    }
    commitComp(result.comp);
}

export function splitClipAt(id: string, t: number) {
    const comp = activeComp();
    const result = splitAt(comp, snapTime(t, comp.fps), withLinked(comp, [id]));
    if (result.created.length) commitComp(result.comp);
}

export function deleteSelection(ripple: boolean) {
    const s = vui.get();
    const comp = activeComp();
    if (s.transition) {
        const on = comp.clips.find((c) => c.id === s.transition?.clip)?.track;
        if (comp.tracks.find((t) => t.id === on)?.locked) return;
        commitComp(setTransition(comp, s.transition.clip, s.transition.side, null));
        vui.set({ transition: null });
        return;
    }
    if (s.marker) {
        commitComp({ ...comp, markers: comp.markers.filter((m) => m.id !== s.marker) });
        vui.set({ marker: null });
        return;
    }
    if (!s.selection.length) {
        if (ripple) {
            // ⌥⌫ on an empty spot closes the gap there.
            const track = comp.tracks.find((t) => !t.locked && comp.clips.some((c) => c.track === t.id && c.start > s.time));
            if (track) commitComp(closeGap(comp, track.id, s.time));
        }
        return;
    }
    const ids = editableSelection(comp);
    commitComp(ripple ? rippleDelete(comp, ids) : removeClips(comp, ids));
    vui.set({ selection: [] });
}

export function duplicateSelection() {
    const comp = activeComp();
    const result = duplicateClips(comp, editableSelection(comp));
    if (!result.created.length) return;
    commitComp(result.comp);
    vui.set({ selection: result.created });
}

export function copySelection(cut = false) {
    const comp = activeComp();
    const ids = withLinked(comp, vui.get().selection);
    const clips = comp.clips.filter((c) => ids.has(c.id));
    if (!clips.length) return;
    setClipboard(structuredClone(clips));
    if (cut) {
        commitComp(removeClips(comp, editableSelection(comp)));
        vui.set({ selection: [] });
    }
    editor.notify(cut ? "Cut." : clips.length === 1 ? "Copied 1 clip." : `Copied ${clips.length} clips.`);
}

export function pasteAtPlayhead() {
    if (!clipboard.length) return;
    const result = pasteClips(activeComp(), clipboard, at());
    commitComp(result.comp);
    vui.set({ selection: result.created });
}

// Every clip that can be picked: clips on locked tracks can't be (as when clicking them).
export function selectAll() {
    const comp = activeComp();
    const locked = new Set(comp.tracks.filter((t) => t.locked).map((t) => t.id));
    vui.set({ selection: comp.clips.filter((c) => !locked.has(c.track)).map((c) => c.id) });
}

export function setLinked(on: boolean) {
    const comp = activeComp();
    commitComp(linkClips(comp, new Set(vui.get().selection), on));
}

export function toggleEnabled() {
    const comp = activeComp();
    const editable = editableSelection(comp);
    const sel = selectedClips(comp).filter((c) => editable.has(c.id));
    if (!sel.length) return;
    const off = !sel.every((c) => c.disabled);
    const ids = new Set(sel.map((c) => c.id));
    commitComp({ ...comp, clips: comp.clips.map((c) => (ids.has(c.id) ? { ...c, disabled: off } : c)) });
}

export function nudgeSelection(frames: number) {
    const comp = activeComp();
    const ids = editableSelection(comp);
    if (!ids.size) return;
    const dt = frames / comp.fps;
    commitComp({ ...comp, clips: comp.clips.map((c) => (ids.has(c.id) ? { ...c, start: Math.max(0, c.start + dt) } : c)) });
}

// Changes a track (mute, solo, lock, hide, name). Locking it lets go of its clips, so nothing
// selected sits on a locked track.
export function setTrack(id: string, patch: Partial<VTrack>) {
    const comp = activeComp();
    commitComp(updateTrack(comp, id, patch));
    if (patch.locked) {
        const on = new Set(comp.clips.filter((c) => c.track === id).map((c) => c.id));
        const selection = vui.get().selection;
        if (selection.some((c) => on.has(c))) vui.set({ selection: selection.filter((c) => !on.has(c)) });
    }
}

export function addTrackOf(kind: "video" | "audio") {
    commitComp(addTrack(activeComp(), kind));
}

// ---- Transitions ----

// Puts a transition on the cut nearest the playhead on the selected clip, or at its start.
export function applyTransition(kind: TransitionKind, clipId?: string, side?: "in" | "out", duration = 0.8) {
    const comp = activeComp();
    const t = vui.get().time;
    const clip = comp.clips.find((c) => c.id === (clipId ?? vui.get().selection[0])) ?? comp.clips.filter((c) => c.kind !== "audio").sort((a, b) => Math.min(Math.abs(a.start - t), Math.abs(clipEnd(a) - t)) - Math.min(Math.abs(b.start - t), Math.abs(clipEnd(b) - t)))[0];
    if (!clip) {
        editor.notify("Add a clip first.");
        return;
    }
    let target = clip;
    let s = side ?? (Math.abs(clipEnd(clip) - t) < Math.abs(clip.start - t) ? "out" : "in");
    // A transition between two clips belongs to the incoming one.
    if (s === "out") {
        const next = clipAfter(comp, clip);
        if (next) {
            target = next;
            s = "in";
        }
    }
    const d = Math.min(duration, target.duration, s === "in" && clipBefore(comp, target) ? (clipBefore(comp, target)?.duration ?? duration) * 2 : duration);
    commitComp(setTransition(comp, target.id, s, { kind, duration: Math.max(1 / comp.fps, d) }));
    vui.set({ transition: { clip: target.id, side: s }, selection: [] });
}

// ---- Effects and presets ----

export async function addEffect(fx: string, ids = vui.get().selection) {
    const catalog = await effectCatalog();
    const spec = catalog.find((e) => e.id === fx);
    if (!spec) return;
    const comp = activeComp();
    const targets = comp.clips.filter((c) => ids.includes(c.id) && c.kind !== "audio");
    if (!targets.length) {
        editor.notify("Select a clip to add an effect to.");
        return;
    }
    const params: VEffect["params"] = {};
    for (const p of spec.params) if (p.kind !== "hidden") params[p.id] = p.default;
    const set = new Set(targets.map((c) => c.id));
    commitComp({ ...comp, clips: comp.clips.map((c) => (set.has(c.id) ? { ...c, effects: [...c.effects, { id: nanoid(8), fx, name: spec.name, enabled: true, params: structuredClone(params) }] } : c)) });
}

export function applyMotionPreset(id: string) {
    const preset = MOTION_PRESETS.find((p) => p.id === id);
    const comp = activeComp();
    const sel = selectedClips(comp).filter((c) => c.kind !== "audio");
    if (!preset || !sel.length) {
        editor.notify("Select a clip to animate.");
        return;
    }
    const ids = new Set(sel.map((c) => c.id));
    commitComp({ ...comp, clips: comp.clips.map((c) => (ids.has(c.id) ? preset.apply(comp, c) : c)) });
}

// ---- Nesting ----

export function precomposeSelection() {
    const project = currentProject();
    const comp = activeComp(project);
    const ids = editableSelection(comp);
    if (!ids.size) {
        editor.notify("Select clips to nest.");
        return;
    }
    const n = project.comps.length + 1;
    const result = precompose(project, comp, ids, `Nested sequence ${n}`);
    if (!result) return;
    commitProject(replaceComp(result.project, result.comp));
    vui.set({ selection: [result.id] });
}

export function openNested(clipId: string) {
    const clip = activeComp().clips.find((c) => c.id === clipId);
    if (clip?.kind === "comp" && clip.comp) openComp(clip.comp);
}

// ---- Playhead, markers, in and out ----

export function step(frames: number) {
    const comp = activeComp();
    seek(snapTime(vui.get().time, comp.fps) + frames / comp.fps);
}

// The previous or next edit point (clip edges, markers, keyframes of the selection).
export function jumpEdit(dir: 1 | -1) {
    const comp = activeComp();
    const t = vui.get().time;
    const points = new Set<number>([0, compLength(comp)]);
    for (const c of comp.clips) {
        points.add(c.start);
        points.add(clipEnd(c));
    }
    const sorted = [...points].sort((a, b) => a - b);
    const next = dir > 0 ? sorted.find((p) => p > t + 1e-4) : [...sorted].reverse().find((p) => p < t - 1e-4);
    if (next !== undefined) seek(next);
}

export function jumpKey(dir: 1 | -1) {
    const clip = selectedClips()[0];
    if (!clip) return;
    const t = vui.get().time - clip.start;
    const times = keyTimes(clip);
    const next = dir > 0 ? times.find((k) => k > t + 1e-4) : [...times].reverse().find((k) => k < t - 1e-4);
    if (next !== undefined) seek(clip.start + next);
}

export function markerAtPlayhead() {
    const comp = activeComp();
    commitComp(addMarker(comp, at(), `Marker ${comp.markers.length + 1}`));
}

export function setInOut(which: "in" | "out" | "clear") {
    const comp = activeComp();
    const t = at();
    if (which === "clear") commitComp({ ...comp, inPoint: null, outPoint: null });
    else if (which === "in") commitComp({ ...comp, inPoint: t, outPoint: comp.outPoint !== undefined && comp.outPoint !== null && comp.outPoint <= t ? null : comp.outPoint });
    else commitComp({ ...comp, outPoint: t, inPoint: comp.inPoint !== undefined && comp.inPoint !== null && comp.inPoint >= t ? null : comp.inPoint });
}

export function togglePlay() {
    const s = vui.get();
    const comp = activeComp();
    const len = compLength(comp);
    if (!s.playing && s.time >= len - 1e-3) vui.set({ time: comp.inPoint ?? 0 });
    vui.set({ playing: !s.playing, rate: 1 });
}

// J/K/L: each J or L press doubles the speed in its direction; K stops.
export function shuttle(dir: -1 | 0 | 1) {
    const s = vui.get();
    if (dir === 0) {
        vui.set({ playing: false, rate: 1 });
        return;
    }
    const same = s.playing && Math.sign(s.rate) === dir;
    const rate = same ? Math.max(-16, Math.min(16, s.rate * 2)) : dir;
    vui.set({ playing: true, rate });
}

export function zoomTimeline(factor: number) {
    vui.set({ pxPerSec: Math.max(4, Math.min(1200, vui.get().pxPerSec * factor)) });
}

// ---- Frame export ----

export async function saveFramePng() {
    const { renderToFile } = await import("./export");
    const project = currentProject();
    const comp = activeComp(project);
    const blob = await renderToFile(project, editor.get().doc, comp, { format: "png", height: comp.height, fps: comp.fps, quality: 1, range: "all", at: vui.get().time }, () => undefined, () => false);
    if (blob) download(blob, `${safeName(editor.get().doc.name || "Frame")} ${vui.get().time.toFixed(2)}s.png`);
}

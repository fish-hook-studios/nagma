import { nanoid } from "nanoid";
import {
    type Ease,
    type MaskMode,
    type TrackKind,
    type VClip,
    type VComp,
    type VKey,
    type VMarker,
    type VMask,
    type VMedia,
    type VProject,
    type VShapeItem,
    type VTrack,
    type VTransition,
    clipEnd,
    clipsOn,
    compLength,
    defaultProp,
    emptyComp,
    keysValue,
    newClip,
    propAt,
    sourceLength,
} from "./model";
import { newShapeItemProps, withShapeItems } from "./shapes";

// Edits on a composition: placing media, moving, trimming, cutting, ripple deletes, keyframes,
// transitions and markers. Each takes and returns plain data; the editor runs the result as one
// undoable command.

const EPS = 1e-4;

export function mapClips(comp: VComp, ids: Set<string>, fn: (clip: VClip) => VClip): VComp {
    return { ...comp, clips: comp.clips.map((c) => (ids.has(c.id) ? fn(c) : c)) };
}

// The clips that go with these (linked video and sound).
export function withLinked(comp: VComp, ids: Iterable<string>): Set<string> {
    const out = new Set(ids);
    const links = new Set(comp.clips.filter((c) => out.has(c.id) && c.link).map((c) => c.link));
    for (const c of comp.clips) if (c.link && links.has(c.link)) out.add(c.id);
    return out;
}

// Frees [start, end) on a track: clips there are trimmed, split around the range, or removed.
export function clearRange(comp: VComp, trackId: string, start: number, end: number, keep: Set<string> = new Set()): VComp {
    const clips: VClip[] = [];
    for (const c of comp.clips) {
        if (c.track !== trackId || keep.has(c.id) || clipEnd(c) <= start + EPS || c.start >= end - EPS) {
            clips.push(c);
            continue;
        }
        const before = start - c.start;
        const after = clipEnd(c) - end;
        if (before > EPS) clips.push(trimTail(c, before));
        if (after > EPS) clips.push({ ...trimHead(c, c.duration - after), id: before > EPS ? nanoid(10) : c.id, tin: null });
    }
    return { ...comp, clips };
}

// The clip shortened to `duration` from its end.
function trimTail(c: VClip, duration: number): VClip {
    return { ...c, duration, in: c.reverse ? c.in + (c.duration - duration) * c.speed : c.in, tout: null, anim: cutKeys(c.anim, 0, duration) };
}

// The clip with its first `cut` seconds removed.
function trimHead(c: VClip, cut: number): VClip {
    const into = c.reverse ? 0 : cut * c.speed;
    return { ...c, start: c.start + cut, duration: c.duration - cut, in: c.in + into, anim: shiftKeys(c.anim, -cut) };
}

function shiftKeys(anim: Record<string, VKey[]>, dt: number): Record<string, VKey[]> {
    const out: Record<string, VKey[]> = {};
    for (const [k, keys] of Object.entries(anim)) out[k] = keys.map((key) => ({ ...key, t: key.t + dt }));
    return out;
}

// Keys kept between 0 and `end` (values at the edges stay as they were).
function cutKeys(anim: Record<string, VKey[]>, from: number, end: number): Record<string, VKey[]> {
    const out: Record<string, VKey[]> = {};
    for (const [k, keys] of Object.entries(anim)) {
        if (!keys.length) continue;
        const inside = keys.filter((key) => key.t >= from - EPS && key.t <= end + EPS);
        if (inside.length === keys.length) {
            out[k] = keys;
            continue;
        }
        const edge: VKey[] = [];
        if (!inside.some((key) => Math.abs(key.t - from) < EPS) && keys.some((key) => key.t < from)) edge.push({ t: from, v: keysValue(keys, from), ease: "linear" });
        const tail: VKey[] = [];
        if (!inside.some((key) => Math.abs(key.t - end) < EPS) && keys.some((key) => key.t > end)) tail.push({ t: end, v: keysValue(keys, end), ease: "linear" });
        out[k] = [...edge, ...inside, ...tail];
    }
    return out;
}

// ---- Tracks ----

export function addTrack(comp: VComp, kind: TrackKind): VComp {
    const n = comp.tracks.filter((t) => t.kind === kind).length + 1;
    const track: VTrack = { id: nanoid(8), kind, name: `${kind === "video" ? "V" : "A"}${n}` };
    // Video tracks stack upward (new ones on top); audio downward.
    const tracks = kind === "video" ? [track, ...comp.tracks] : [...comp.tracks, track];
    return { ...comp, tracks };
}

export function removeTrack(comp: VComp, id: string): VComp {
    const track = comp.tracks.find((t) => t.id === id);
    if (!track || comp.tracks.filter((t) => t.kind === track.kind).length <= 1) return comp;
    return renameTracks({ ...comp, tracks: comp.tracks.filter((t) => t.id !== id), clips: comp.clips.filter((c) => c.track !== id) });
}

function renameTracks(comp: VComp): VComp {
    const video = comp.tracks.filter((t) => t.kind === "video");
    const audio = comp.tracks.filter((t) => t.kind === "audio");
    return {
        ...comp,
        tracks: comp.tracks.map((t) => (/^[VA]\d+$/.test(t.name) ? { ...t, name: t.kind === "video" ? `V${video.length - video.indexOf(t)}` : `A${audio.indexOf(t) + 1}` } : t)),
    };
}

export function updateTrack(comp: VComp, id: string, patch: Partial<VTrack>): VComp {
    return { ...comp, tracks: comp.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

// A track of `kind` free over [start, end), from `prefer` outward, adding one if none is.
export function freeTrack(comp: VComp, kind: TrackKind, start: number, end: number, prefer?: string): { comp: VComp; track: string } {
    const tracks = comp.tracks.filter((t) => t.kind === kind && !t.locked);
    const ordered = kind === "video" ? [...tracks].reverse() : tracks;
    const startAt = Math.max(0, ordered.findIndex((t) => t.id === prefer));
    for (const t of [...ordered.slice(startAt), ...ordered.slice(0, startAt)]) {
        if (!comp.clips.some((c) => c.track === t.id && c.start < end - EPS && clipEnd(c) > start + EPS)) return { comp, track: t.id };
    }
    const next = addTrack(comp, kind);
    const added = kind === "video" ? next.tracks[0] : next.tracks[next.tracks.length - 1];
    return { comp: next, track: added?.id ?? "" };
}

// ---- Placing ----

// Media placed at `at`: a video brings its sound on an audio track, linked. Overwrites what's
// there on the target tracks.
export function placeMedia(project: VProject, comp: VComp, media: VMedia[], at: number, videoTrack?: string, audioTrack?: string): { comp: VComp; ids: string[] } {
    let next = comp;
    const ids: string[] = [];
    let t = at;
    for (const m of media) {
        const len = m.kind === "image" ? 5 : Math.max(0.04, m.seconds);
        const link = m.kind === "video" && m.hasAudio ? nanoid(8) : null;
        if (m.kind !== "audio") {
            // An explicit track is overwritten; otherwise the clip goes to the first free one.
            let target = videoTrack && next.tracks.some((tr) => tr.id === videoTrack && tr.kind === "video") ? videoTrack : "";
            if (!target) ({ comp: next, track: target } = freeTrack(next, "video", t, t + len));
            next = clearRange(next, target, t, t + len);
            const clip = newClip(m.kind === "image" ? "image" : "video", target, t, len, m.name.replace(/\.[^.]+$/, ""), { media: m.id, link });
            next = { ...next, clips: [...next.clips, clip] };
            ids.push(clip.id);
        }
        if (m.kind === "audio" || link) {
            let target = audioTrack && next.tracks.some((tr) => tr.id === audioTrack && tr.kind === "audio") ? audioTrack : "";
            if (!target) ({ comp: next, track: target } = freeTrack(next, "audio", t, t + len));
            next = clearRange(next, target, t, t + len);
            const clip = newClip("audio", target, t, len, m.name.replace(/\.[^.]+$/, ""), { media: m.id, link });
            next = { ...next, clips: [...next.clips, clip] };
            ids.push(clip.id);
        }
        t += len;
    }
    void project;
    return { comp: next, ids };
}

// A generated clip (title, shape, solid, adjustment layer) on a free video track at `at`.
export function placeGenerated(comp: VComp, clip: Omit<VClip, "track">, prefer?: string): { comp: VComp; id: string } {
    const { comp: next, track } = freeTrack(comp, "video", clip.start, clip.start + clip.duration, prefer);
    return { comp: { ...next, clips: [...next.clips, { ...clip, track } as VClip] }, id: clip.id };
}

// ---- Moving ----

// Moves clips by `dt` seconds and `dTrack` tracks (of their own kind), overwriting what they
// land on. Clips can't go before 0 or onto locked tracks.
export function moveClips(comp: VComp, ids: Set<string>, dt: number, dTrack: number): VComp {
    const moving = comp.clips.filter((c) => ids.has(c.id));
    if (!moving.length) return comp;
    const minStart = Math.min(...moving.map((c) => c.start));
    const shift = Math.max(-minStart, dt);
    const byKind = (kind: TrackKind) => comp.tracks.filter((t) => t.kind === kind);
    const targetTrack = (c: VClip): string => {
        const kind = comp.tracks.find((t) => t.id === c.track)?.kind ?? "video";
        const list = byKind(kind);
        const i = list.findIndex((t) => t.id === c.track);
        // dTrack counts rows downward on screen; for audio tracks that's the next one.
        const j = Math.max(0, Math.min(list.length - 1, i + dTrack));
        const t = list[j];
        return t && !t.locked ? t.id : c.track;
    };
    const moved = moving.map((c) => ({ ...c, start: c.start + shift, track: targetTrack(c) }));
    let next: VComp = { ...comp, clips: comp.clips.filter((c) => !ids.has(c.id)) };
    for (const c of moved) next = clearRange(next, c.track, c.start, clipEnd(c));
    return { ...next, clips: [...next.clips, ...moved] };
}

// ---- Trimming ----

// Moves a clip's start (`edge` "in") or end ("out") by `dt`, within its source and its
// neighbours. A ripple trim moves what follows on the track with it.
export function trimClip(project: VProject, comp: VComp, id: string, edge: "in" | "out", dt: number, ripple = false): VComp {
    const clip = comp.clips.find((c) => c.id === id);
    if (!clip) return comp;
    const ids = withLinked(comp, [id]);
    const minLen = 1 / Math.max(1, comp.fps);
    const srcLen = sourceLength(project, clip);
    const neighbours = (c: VClip) => clipsOn(comp, c.track).filter((o) => !ids.has(o.id));
    let delta = dt;
    for (const c of comp.clips.filter((o) => ids.has(o.id))) {
        if (edge === "in") {
            // Earlier start: within the source head and after the previous clip.
            const head = c.reverse ? (srcLen - (c.in + c.duration * c.speed)) / c.speed : c.in / c.speed;
            const prev = neighbours(c).filter((o) => clipEnd(o) <= c.start + EPS).at(-1);
            const lo = -Math.min(Number.isFinite(head) ? head : Infinity, ripple ? Infinity : c.start - (prev ? clipEnd(prev) : 0));
            delta = Math.max(lo, Math.min(c.duration - minLen, delta));
            if (!ripple) delta = Math.max(delta, -c.start);
        } else {
            const tail = c.reverse ? c.in / c.speed : (srcLen - (c.in + c.duration * c.speed)) / c.speed;
            const next = neighbours(c).find((o) => o.start >= clipEnd(c) - EPS);
            const hi = Math.min(Number.isFinite(tail) ? tail : Infinity, ripple ? Infinity : (next ? next.start : Infinity) - clipEnd(c));
            delta = Math.min(hi, Math.max(-(c.duration - minLen), delta));
        }
    }
    if (Math.abs(delta) < EPS) return comp;
    let next = mapClips(comp, ids, (c) => {
        if (edge === "out") return { ...c, duration: c.duration + delta, in: c.reverse ? c.in - delta * c.speed : c.in, anim: delta < 0 ? cutKeys(c.anim, 0, c.duration + delta) : c.anim };
        if (ripple) return trimHeadRipple(c, delta);
        return trimHeadBy(c, delta);
    });
    if (ripple) {
        // What follows moves by the change in length.
        const change = edge === "out" ? delta : -delta;
        const pivot = Math.max(...comp.clips.filter((c) => ids.has(c.id)).map((c) => (edge === "out" ? clipEnd(c) : c.start)));
        const tracks = new Set(comp.clips.filter((c) => ids.has(c.id)).map((c) => c.track));
        next = { ...next, clips: next.clips.map((c) => (!ids.has(c.id) && tracks.has(c.track) && c.start >= pivot - EPS ? { ...c, start: Math.max(0, c.start + change) } : c)) };
    }
    return next;
}

function trimHeadBy(c: VClip, delta: number): VClip {
    const into = c.reverse ? 0 : delta * c.speed;
    return { ...c, start: c.start + delta, duration: c.duration - delta, in: c.in + into, anim: shiftKeys(c.anim, -delta) };
}

// A ripple trim at the head keeps the clip's start and changes how much of the source shows.
function trimHeadRipple(c: VClip, delta: number): VClip {
    const into = c.reverse ? 0 : delta * c.speed;
    return { ...c, duration: c.duration - delta, in: c.in + into, anim: shiftKeys(c.anim, -delta) };
}

// Changes a clip's speed: its length follows so the same source plays.
export function setSpeed(comp: VComp, id: string, speed: number): VComp {
    const s = Math.max(0.05, Math.min(20, speed));
    const ids = withLinked(comp, [id]);
    return mapClips(comp, ids, (c) => {
        const src = c.duration * c.speed;
        const duration = src / s;
        const k = c.duration / duration;
        const anim: Record<string, VKey[]> = {};
        for (const [p, keys] of Object.entries(c.anim)) anim[p] = keys.map((key) => ({ ...key, t: key.t / k }));
        return { ...c, speed: s, duration, anim };
    });
}

// ---- Cutting ----

// Cuts clips under `t` in two (all unlocked tracks, or only `ids`).
export function splitAt(comp: VComp, t: number, ids?: Set<string>): { comp: VComp; created: string[] } {
    const locked = new Set(comp.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
    const hit = comp.clips.filter((c) => !locked.has(c.track) && (!ids || ids.has(c.id)) && c.start < t - EPS && clipEnd(c) > t + EPS);
    if (!hit.length) return { comp, created: [] };
    const links = new Map<string, string>();
    const created: string[] = [];
    const clips: VClip[] = [];
    for (const c of comp.clips) {
        if (!hit.includes(c)) {
            clips.push(c);
            continue;
        }
        const cut = t - c.start;
        const a = trimTail(c, cut);
        const b = { ...trimHead(c, cut), id: nanoid(10), tin: null, tout: c.tout } as VClip;
        if (c.link) {
            if (!links.has(c.link)) links.set(c.link, nanoid(8));
            b.link = links.get(c.link) ?? null;
        }
        created.push(b.id);
        clips.push(a, b);
    }
    return { comp: { ...comp, clips }, created };
}

// ---- Deleting ----

export function removeClips(comp: VComp, ids: Set<string>): VComp {
    return { ...comp, clips: comp.clips.filter((c) => !ids.has(c.id)) };
}

// Removes clips and closes the gaps they leave on their tracks.
export function rippleDelete(comp: VComp, ids: Set<string>): VComp {
    const removed = comp.clips.filter((c) => ids.has(c.id));
    let clips = comp.clips.filter((c) => !ids.has(c.id));
    // Latest first, so earlier shifts don't move later ranges.
    for (const r of [...removed].sort((a, b) => b.start - a.start)) {
        const gapEnd = clipEnd(r);
        clips = clips.map((c) => (c.track === r.track && c.start >= gapEnd - EPS ? { ...c, start: Math.max(0, c.start - r.duration) } : c));
    }
    return { ...comp, clips };
}

// Closes the empty space under `t` on a track.
export function closeGap(comp: VComp, trackId: string, t: number): VComp {
    const on = clipsOn(comp, trackId);
    const prev = on.filter((c) => clipEnd(c) <= t + EPS).at(-1);
    const next = on.find((c) => c.start >= t - EPS);
    if (!next) return comp;
    const gap = next.start - (prev ? clipEnd(prev) : 0);
    if (gap <= EPS) return comp;
    return { ...comp, clips: comp.clips.map((c) => (c.track === trackId && c.start >= next.start - EPS ? { ...c, start: c.start - gap } : c)) };
}

// ---- Copy and duplicate ----

export function copyOf(clip: VClip, start: number): VClip {
    return { ...structuredClone(clip), id: nanoid(10), start };
}

export function duplicateClips(comp: VComp, ids: Set<string>): { comp: VComp; created: string[] } {
    const src = comp.clips.filter((c) => ids.has(c.id));
    if (!src.length) return { comp, created: [] };
    const start = Math.min(...src.map((c) => c.start));
    const end = Math.max(...src.map(clipEnd));
    return pasteClips(comp, src, end, start);
}

// Pasted clips keep their spacing; `at` is where the earliest lands.
export function pasteClips(comp: VComp, clips: VClip[], at: number, from = Math.min(...clips.map((c) => c.start))): { comp: VComp; created: string[] } {
    const links = new Map<string, string>();
    const copies = clips.map((c) => {
        const copy = copyOf(c, at + (c.start - from));
        if (c.link) {
            if (!links.has(c.link)) links.set(c.link, nanoid(8));
            copy.link = links.get(c.link) ?? null;
        }
        if (!comp.tracks.some((t) => t.id === copy.track)) {
            const kind = c.kind === "audio" ? "audio" : "video";
            copy.track = comp.tracks.find((t) => t.kind === kind)?.id ?? copy.track;
        }
        return copy;
    });
    let next = comp;
    for (const c of copies) next = clearRange(next, c.track, c.start, clipEnd(c));
    return { comp: { ...next, clips: [...next.clips, ...copies] }, created: copies.map((c) => c.id) };
}

export function linkClips(comp: VComp, ids: Set<string>, on: boolean): VComp {
    const link = on ? nanoid(8) : null;
    return mapClips(comp, ids, (c) => ({ ...c, link }));
}

// ---- Properties and keyframes ----

// Sets a property: on a keyframed property it adds or moves the keyframe at `t` (seconds into the clip).
export function setProp(clip: VClip, path: string, value: number, t: number): VClip {
    const keys = clip.anim[path];
    if (keys?.length) return { ...clip, anim: { ...clip.anim, [path]: putKey(keys, t, value) } };
    return { ...clip, props: { ...clip.props, [path]: value } };
}

function putKey(keys: VKey[], t: number, v: number, ease?: Ease): VKey[] {
    const at = keys.findIndex((k) => Math.abs(k.t - t) < 1e-3);
    if (at >= 0) return keys.map((k, i) => (i === at ? { ...k, v } : k));
    const prev = [...keys].reverse().find((k) => k.t < t);
    return [...keys, { t, v, ease: ease ?? prev?.ease ?? "ease-in-out", ...(prev?.bezier ? { bezier: prev.bezier } : {}) }].sort((a, b) => a.t - b.t);
}

// The stopwatch: on, the property gets a keyframe at `t` with its current value; off, the
// keyframes go and the value at `t` stays.
export function toggleAnimated(comp: VComp, clip: VClip, path: string, t: number): VClip {
    const value = propAt(comp, clip, path, t);
    if (clip.anim[path]?.length) {
        const anim = { ...clip.anim };
        delete anim[path];
        return { ...clip, anim, props: { ...clip.props, [path]: value } };
    }
    return { ...clip, anim: { ...clip.anim, [path]: [{ t, v: value, ease: "ease-in-out" }] } };
}

// Adds a keyframe at `t` with the current value, or removes the one there.
export function toggleKeyAt(comp: VComp, clip: VClip, path: string, t: number): VClip {
    const keys = clip.anim[path] ?? [];
    const at = keys.findIndex((k) => Math.abs(k.t - t) < 0.5 / Math.max(1, comp.fps));
    if (at >= 0) return { ...clip, anim: { ...clip.anim, [path]: keys.filter((_, i) => i !== at) } };
    return { ...clip, anim: { ...clip.anim, [path]: putKey(keys, t, propAt(comp, clip, path, t)) } };
}

export function setKeyEase(clip: VClip, path: string, index: number, ease: Ease, bezier?: [number, number, number, number]): VClip {
    const keys = clip.anim[path];
    if (!keys?.[index]) return clip;
    return { ...clip, anim: { ...clip.anim, [path]: keys.map((k, i) => (i === index ? { ...k, ease, ...(bezier ? { bezier } : { bezier: undefined }) } : k)) } };
}

export function moveKey(clip: VClip, path: string, index: number, t: number, v?: number): VClip {
    const keys = clip.anim[path];
    if (!keys?.[index]) return clip;
    const moved = keys.map((k, i) => (i === index ? { ...k, t: Math.max(0, t), ...(v !== undefined ? { v } : {}) } : k)).sort((a, b) => a.t - b.t);
    return { ...clip, anim: { ...clip.anim, [path]: moved } };
}

export function removeKey(clip: VClip, path: string, index: number): VClip {
    const keys = clip.anim[path];
    if (!keys) return clip;
    return { ...clip, anim: { ...clip.anim, [path]: keys.filter((_, i) => i !== index) } };
}

export function resetProp(comp: VComp, clip: VClip, path: string): VClip {
    const props = { ...clip.props };
    delete props[path];
    const anim = { ...clip.anim };
    delete anim[path];
    void comp;
    return { ...clip, props, anim };
}

// Every keyframe time of a clip (for the timeline's diamonds and stepping between keys).
export function keyTimes(clip: VClip): number[] {
    const times = new Set<number>();
    for (const keys of Object.values(clip.anim)) for (const k of keys) times.add(Math.round(k.t * 1000) / 1000);
    return [...times].sort((a, b) => a - b);
}

// ---- Transitions ----

// The clip that ends where `clip` starts on its track (the outgoing side of its transition).
export function clipBefore(comp: VComp, clip: VClip): VClip | undefined {
    return comp.clips.find((c) => c.track === clip.track && c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 1 / Math.max(1, comp.fps));
}

export function clipAfter(comp: VComp, clip: VClip): VClip | undefined {
    return comp.clips.find((c) => c.track === clip.track && c.id !== clip.id && Math.abs(c.start - clipEnd(clip)) < 1 / Math.max(1, comp.fps));
}

export function setTransition(comp: VComp, id: string, side: "in" | "out", transition: VTransition | null): VComp {
    return mapClips(comp, new Set([id]), (c) => (side === "in" ? { ...c, tin: transition } : { ...c, tout: transition }));
}

// ---- Markers and in/out ----

export function addMarker(comp: VComp, t: number, name = "Marker", color = "#4FA3FF"): VComp {
    const marker: VMarker = { id: nanoid(8), t, name, color };
    return { ...comp, markers: [...comp.markers.filter((m) => Math.abs(m.t - t) > 1e-3), marker].sort((a, b) => a.t - b.t) };
}

export function removeMarker(comp: VComp, id: string): VComp {
    return { ...comp, markers: comp.markers.filter((m) => m.id !== id) };
}

// ---- Nesting ----

// Moves clips into a new composition and puts one clip of it in their place.
export function precompose(project: VProject, comp: VComp, ids: Set<string>, name: string): { project: VProject; comp: VComp; id: string } | null {
    const inside = comp.clips.filter((c) => ids.has(c.id));
    if (!inside.length) return null;
    const start = Math.min(...inside.map((c) => c.start));
    const end = Math.max(...inside.map(clipEnd));
    const nested = emptyComp(nanoid(8), name, comp.width, comp.height, comp.fps);
    nested.background = "transparent";
    // Same track layout as the source, holding just these clips.
    const usedTracks = comp.tracks.filter((t) => inside.some((c) => c.track === t.id));
    nested.tracks = usedTracks.map((t) => ({ ...t, id: t.id, muted: false, solo: false, locked: false, hidden: false }));
    if (!nested.tracks.some((t) => t.kind === "video")) nested.tracks.unshift({ id: nanoid(8), kind: "video", name: "V1" });
    if (!nested.tracks.some((t) => t.kind === "audio")) nested.tracks.push({ id: nanoid(8), kind: "audio", name: "A1" });
    nested.clips = inside.map((c) => ({ ...c, start: c.start - start, link: c.link }));
    const lowest = comp.tracks.filter((t) => t.kind === "video" && inside.some((c) => c.track === t.id)).at(-1) ?? comp.tracks.find((t) => t.kind === "video");
    const clip = newClip("comp", lowest?.id ?? "", start, end - start, name, { comp: nested.id });
    const without = removeClips(comp, ids);
    const placed = clearRange(without, clip.track, clip.start, clipEnd(clip));
    return { project: { ...project, comps: [...project.comps, nested] }, comp: { ...placed, clips: [...placed.clips, clip] }, id: clip.id };
}

export function compDuration(comp: VComp): number {
    return Math.max(compLength(comp), 0);
}

export function defaultOf(comp: VComp, clip: VClip, path: string): number {
    return defaultProp(comp, clip, path);
}

// ---- Time remapping ----

// Turns time remapping on (keys at the clip's ends saying where the source is now, so nothing
// moves until a key is changed) or off (speed and reverse take over again).
export function toggleTimeRemap(clip: VClip): VClip {
    if (clip.anim.time?.length) {
        const { time: _time, ...anim } = clip.anim;
        return { ...clip, anim };
    }
    const len = clip.duration * clip.speed;
    const a = clip.reverse ? clip.in + len : clip.in;
    const b = clip.reverse ? clip.in : clip.in + len;
    return { ...clip, anim: { ...clip.anim, time: [{ t: 0, v: a, ease: "linear" }, { t: clip.duration, v: b, ease: "linear" }] } };
}

// ---- Parenting and the anchor point ----

export function setParent(clip: VClip, parent: string | null): VClip {
    return { ...clip, parent: parent ?? null };
}

// Moves the anchor point by (dx, dy) in the layer's own pixels and the position with it, so the
// picture stays where it is while the point it rotates and scales about moves.
export function moveAnchor(comp: VComp, clip: VClip, dx: number, dy: number, t: number): VClip {
    const sx = propAt(comp, clip, "scaleX", t) / 100;
    const sy = propAt(comp, clip, "scaleY", t) / 100;
    const r = (propAt(comp, clip, "rotation", t) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    // The anchor's move, seen through the clip's own scale and rotation, is how far the picture
    // would jump; the position follows by that much.
    const px = dx * sx * cos - dy * sy * sin;
    const py = dx * sx * sin + dy * sy * cos;
    let next = setProp(clip, "anchorX", propAt(comp, clip, "anchorX", t) + dx, t);
    next = setProp(next, "anchorY", propAt(comp, clip, "anchorY", t) + dy, t);
    next = setProp(next, "x", propAt(comp, clip, "x", t) + px, t);
    return setProp(next, "y", propAt(comp, clip, "y", t) + py, t);
}

// ---- Masks ----

export function addMask(clip: VClip, shape: VMask["shape"], mode: MaskMode = "add"): { clip: VClip; id: string } {
    const id = nanoid(6);
    const mask: VMask = { id, shape, mode };
    // A path starts as a diamond in the middle of the layer, ready to be reshaped.
    if (shape === "path") mask.points = [{ x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }, { x: 0.5, y: 0.8 }, { x: 0.2, y: 0.5 }];
    return { clip: { ...clip, masks: [...clip.masks, mask] }, id };
}

export function updateMask(clip: VClip, id: string, patch: Partial<VMask>): VClip {
    return { ...clip, masks: clip.masks.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

export function removeMask(clip: VClip, id: string): VClip {
    const prefix = `mask.${id}.`;
    const props = Object.fromEntries(Object.entries(clip.props).filter(([k]) => !k.startsWith(prefix)));
    const anim = Object.fromEntries(Object.entries(clip.anim).filter(([k]) => !k.startsWith(prefix)));
    return { ...clip, masks: clip.masks.filter((m) => m.id !== id), props, anim };
}

// A path mask's vertex moved to (x, y), fractions of the layer.
export function moveMaskPoint(clip: VClip, id: string, index: number, x: number, y: number): VClip {
    return updateMask(clip, id, { points: (clip.masks.find((m) => m.id === id)?.points ?? []).map((p, i) => (i === index ? { x, y } : p)) });
}

// A vertex added after `after` (or at the end), fractions of the layer.
export function addMaskPoint(clip: VClip, id: string, x: number, y: number, after?: number): VClip {
    const points = [...(clip.masks.find((m) => m.id === id)?.points ?? [])];
    const at = after === undefined ? points.length : Math.max(0, Math.min(points.length, after + 1));
    points.splice(at, 0, { x, y });
    return updateMask(clip, id, { points });
}

export function removeMaskPoint(clip: VClip, id: string, index: number): VClip {
    const points = clip.masks.find((m) => m.id === id)?.points ?? [];
    if (points.length <= 3) return clip;
    return updateMask(clip, id, { points: points.filter((_, i) => i !== index) });
}

// ---- Shape items ----

export function addShapeItem(comp: VComp, clip: VClip, item: VShapeItem): VClip {
    const base = withShapeItems(clip);
    return { ...base, shapes: [...(base.shapes ?? []), item], props: { ...base.props, ...newShapeItemProps(item, comp) } };
}

export function updateShapeItem(clip: VClip, id: string, patch: Partial<VShapeItem>): VClip {
    const base = withShapeItems(clip);
    return { ...base, shapes: (base.shapes ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeShapeItem(clip: VClip, id: string): VClip {
    const base = withShapeItems(clip);
    const prefix = `shape.${id}.`;
    const props = Object.fromEntries(Object.entries(base.props).filter(([k]) => !k.startsWith(prefix)));
    const anim = Object.fromEntries(Object.entries(base.anim).filter(([k]) => !k.startsWith(prefix)));
    return { ...base, shapes: (base.shapes ?? []).filter((s) => s.id !== id), props, anim };
}

// Moves an item up (towards the front, later in the list) or down by one.
export function moveShapeItem(clip: VClip, id: string, dir: -1 | 1): VClip {
    const base = withShapeItems(clip);
    const list = [...(base.shapes ?? [])];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return base;
    [list[i], list[j]] = [list[j] as VShapeItem, list[i] as VShapeItem];
    return { ...base, shapes: list };
}

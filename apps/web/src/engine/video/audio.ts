import { type VClip, type VComp, type VProject, audioTracks, clipEnd, mediaById, propAt } from "./model";
import { sourceAt } from "./render";
import { allPlayers, clipPlayer, pauseAll } from "./sources";
import { readAudio } from "./sources";

// Sound: the mix of a composition's audio tracks (volume and pan keyframes, fades, transitions,
// speed, mute and solo, nested compositions), for export; and the browser players kept in step
// with the playhead for playback.

export function dbToGain(db: number): number {
    return db <= -59.9 ? 0 : Math.pow(10, db / 20);
}

function audible(comp: VComp): Set<string> {
    const tracks = audioTracks(comp);
    const solo = tracks.some((t) => t.solo);
    return new Set(tracks.filter((t) => !t.muted && (!solo || t.solo)).map((t) => t.id));
}

// A clip's gain at `lt` seconds into it: volume, fades and its transitions.
export function clipGain(comp: VComp, clip: VClip, lt: number): number {
    let g = dbToGain(propAt(comp, clip, "volume", lt));
    const fadeIn = propAt(comp, clip, "fadeIn", lt);
    const fadeOut = propAt(comp, clip, "fadeOut", lt);
    if (fadeIn > 0 && lt < fadeIn) g *= Math.max(0, lt / fadeIn);
    if (fadeOut > 0 && lt > clip.duration - fadeOut) g *= Math.max(0, (clip.duration - lt) / fadeOut);
    if (clip.tin && clip.tin.duration > 0 && lt < clip.tin.duration) g *= Math.max(0, lt / clip.tin.duration);
    if (clip.tout && clip.tout.duration > 0 && lt > clip.duration - clip.tout.duration) g *= Math.max(0, (clip.duration - lt) / clip.tout.duration);
    return g;
}

// Adds `frames` stereo frames of the composition's sound from `start` seconds into `out`.
export async function mixInto(project: VProject, comp: VComp, start: number, frames: number, rate: number, out: Float32Array, depth = 0): Promise<void> {
    if (depth > 6) return;
    const end = start + frames / rate;
    const tracks = audible(comp);
    for (const clip of comp.clips) {
        if (clip.disabled || clipEnd(clip) <= start || clip.start >= end) continue;
        if (clip.kind === "comp") {
            const nested = project.comps.find((c) => c.id === clip.comp);
            if (!nested) continue;
            // A nested composition's sound plays at its own pace, gained by the clip's volume.
            const from = Math.max(start, clip.start);
            const to = Math.min(end, clipEnd(clip));
            const n = Math.round((to - from) * rate);
            if (n <= 0) continue;
            const inner = new Float32Array(n * 2);
            await mixInto(project, nested, sourceAt(clip, from - clip.start, Infinity), n, rate, inner, depth + 1);
            const offset = Math.round((from - start) * rate);
            const pan = propAt(comp, clip, "pan", from - clip.start) / 100;
            for (let i = 0; i < n && offset + i < frames; i++) {
                const g = clipGain(comp, clip, from - clip.start + i / rate);
                out[(offset + i) * 2] = (out[(offset + i) * 2] ?? 0) + (inner[i * 2] ?? 0) * g * Math.min(1, 1 - pan);
                out[(offset + i) * 2 + 1] = (out[(offset + i) * 2 + 1] ?? 0) + (inner[i * 2 + 1] ?? 0) * g * Math.min(1, 1 + pan);
            }
            continue;
        }
        if (clip.kind !== "audio" || !tracks.has(clip.track)) continue;
        const media = mediaById(project, clip.media);
        if (!media?.hasAudio) continue;
        const from = Math.max(start, clip.start);
        const to = Math.min(end, clipEnd(clip));
        const n = Math.round((to - from) * rate);
        if (n <= 0) continue;
        const lt0 = from - clip.start;
        // The source span these output frames cover, read once and resampled for speed.
        const srcA = sourceAt(clip, lt0, media.seconds);
        const srcB = sourceAt(clip, lt0 + n / rate, media.seconds);
        const lo = Math.min(srcA, srcB);
        const span = Math.max(1, Math.round(Math.abs(srcB - srcA) * rate) + 2);
        const src = await readAudio(media, lo, span, rate);
        const offset = Math.round((from - start) * rate);
        for (let i = 0; i < n && offset + i < frames; i++) {
            const lt = lt0 + i / rate;
            const st = sourceAt(clip, lt, media.seconds);
            const pos = (st - lo) * rate;
            const a = Math.max(0, Math.min(span - 2, Math.floor(pos)));
            const f = Math.max(0, Math.min(1, pos - a));
            const l = (src[a * 2] ?? 0) * (1 - f) + (src[(a + 1) * 2] ?? 0) * f;
            const r = (src[a * 2 + 1] ?? 0) * (1 - f) + (src[(a + 1) * 2 + 1] ?? 0) * f;
            // Gain and pan move every few milliseconds, which is smooth enough.
            const g = i % 64 === 0 || i === 0 ? clipGain(comp, clip, lt) : clipGain(comp, clip, lt0 + (i - (i % 64)) / rate);
            const pan = propAt(comp, clip, "pan", lt) / 100;
            out[(offset + i) * 2] = (out[(offset + i) * 2] ?? 0) + l * g * Math.min(1, 1 - pan);
            out[(offset + i) * 2 + 1] = (out[(offset + i) * 2 + 1] ?? 0) + r * g * Math.min(1, 1 + pan);
        }
    }
}

export async function mixComp(project: VProject, comp: VComp, start: number, frames: number, rate: number): Promise<Float32Array> {
    const out = new Float32Array(frames * 2);
    await mixInto(project, comp, start, frames, rate, out);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
    return out;
}

// ---- Playback ----

// Keeps a browser player per clip under the playhead playing at the right place, speed and
// volume (video players stay silent; sound comes from the audio clips).
export function syncPlayers(project: VProject, comp: VComp, t: number, playing: boolean, prefix = "", depth = 0, gainIn = 1): Set<string> {
    const live = new Set<string>();
    if (depth > 6) return live;
    const tracks = audible(comp);
    for (const clip of comp.clips) {
        if (clip.disabled) continue;
        const lead = playing ? 0.5 : 0;
        if (t < clip.start - lead || t >= clipEnd(clip)) continue;
        const lt = t - clip.start;
        if (clip.kind === "comp") {
            const nested = project.comps.find((c) => c.id === clip.comp);
            if (nested && lt >= 0) for (const k of syncPlayers(project, nested, sourceAt(clip, lt, Infinity), playing, `${prefix}${clip.id}/`, depth + 1, gainIn * clipGain(comp, clip, lt))) live.add(k);
            continue;
        }
        if (clip.kind !== "video" && clip.kind !== "audio") continue;
        const media = mediaById(project, clip.media);
        if (!media) continue;
        if (clip.kind === "audio" && (!tracks.has(clip.track) || !media.hasAudio)) continue;
        const key = `${prefix}${clip.id}`;
        // Nested and reversed video plays from exact frames; only the top level uses players.
        if (clip.kind === "video" && (depth > 0 || clip.reverse)) continue;
        const el = clipPlayer(key, media, clip.kind);
        live.add(key);
        if (!el) continue;
        const st = sourceAt(clip, Math.max(0, lt), media.seconds);
        const rate = Math.max(0.0625, Math.min(16, clip.speed));
        if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
        if (clip.kind === "audio") {
            el.muted = false;
            el.volume = Math.max(0, Math.min(1, clipGain(comp, clip, Math.max(0, lt)) * gainIn));
        }
        const active = lt >= 0;
        if (playing && active && !clip.reverse) {
            if (Math.abs(el.currentTime - st) > 0.25) el.currentTime = st;
            if (el.paused) void el.play().catch(() => undefined);
        } else {
            if (!el.paused) el.pause();
            if (Math.abs(el.currentTime - st) > 0.04) el.currentTime = st;
        }
    }
    if (depth === 0) pauseAll(live);
    return live;
}

export function stopPlayers() {
    for (const el of allPlayers().values()) if (!el.paused) el.pause();
}

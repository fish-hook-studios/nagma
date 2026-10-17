import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "../engine/store";
import type { Command, NagmaDocument } from "../engine/types";
import type { BoardTimer, JamData } from "./types";

// The board's timer, shared with everyone in the file: it lives on the first page, so starting,
// pausing or adding time shows for all collaborators. While it runs with music on, a soft loop
// plays; a chime sounds when it ends.

type BoardJam = Extract<JamData, { kind: "board" }>;

function boardPage() {
    const doc = editor.get().doc;
    return doc.nodes[doc.roots[0] ?? ""];
}

export function boardJam(): BoardJam {
    const page = boardPage();
    return page?.jam?.kind === "board" ? page.jam : { kind: "board" };
}

// The command that changes the board's shared data (timer, voting) from what `doc` holds.
export function boardJamCommand(doc: NagmaDocument, patch: (jam: BoardJam) => Partial<BoardJam>): Command | null {
    const page = doc.nodes[doc.roots[0] ?? ""];
    if (!page) return null;
    const jam: BoardJam = page.jam?.kind === "board" ? page.jam : { kind: "board" };
    return { type: "node.update", id: page.id, patch: { jam: { ...jam, ...patch(jam) } } };
}

export function setBoardJam(patch: Partial<BoardJam>) {
    const command = boardJamCommand(editor.get().doc, () => patch);
    // Not an undo step: a timer or vote isn't an edit of the board.
    if (command) editor.executeSilently(command);
}

export function startTimer(ms: number) {
    const clamped = Math.max(1000, Math.min(MAX_TIMER, ms));
    const timer: BoardTimer = { total: clamped, endsAt: Date.now() + clamped, left: clamped, music: boardJam().timer?.music ?? true, track: boardJam().timer?.track ?? "calm" };
    setBoardJam({ timer });
}

export function pauseTimer() {
    const t = boardJam().timer;
    if (!t?.endsAt) return;
    setBoardJam({ timer: { ...t, endsAt: null, left: Math.max(0, t.endsAt - Date.now()) } });
}

export function resumeTimer() {
    const t = boardJam().timer;
    if (!t || t.endsAt) return;
    setBoardJam({ timer: { ...t, endsAt: Date.now() + t.left } });
}

export function addTime(ms: number) {
    const t = boardJam().timer;
    if (!t) return startTimer(ms);
    setBoardJam({ timer: t.endsAt ? { ...t, total: t.total + ms, endsAt: t.endsAt + ms } : { ...t, total: t.total + ms, left: t.left + ms } });
}

export function stopTimer() {
    setBoardJam({ timer: null });
}

export function toggleMusic() {
    const t = boardJam().timer;
    if (t) setBoardJam({ timer: { ...t, music: !t.music } });
}

export function setTrack(track: string) {
    const t = boardJam().timer;
    if (t) setBoardJam({ timer: { ...t, track, music: true } });
}

// The longest timer: 99:59.
export const MAX_TIMER = (99 * 60 + 59) * 1000;

export function formatTime(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---- Sound ----

let audio: AudioContext | null = null;
let loop = 0;

function ctx(): AudioContext | null {
    try {
        audio ??= new AudioContext();
        if (audio.state === "suspended") void audio.resume();
        return audio;
    } catch {
        return null;
    }
}

// Everyone hears the same track; each person sets their own volume (0 to 1).
let volume = 1;
let master: GainNode | null = null;

function out(a: AudioContext): AudioNode {
    if (!master) {
        master = a.createGain();
        master.connect(a.destination);
    }
    master.gain.value = volume;
    return master;
}

export function musicVolume() {
    return volume;
}

export function setMusicVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volume;
}

function tone(freq: number, at: number, length: number, level = 0.05, wave: OscillatorType = "sine") {
    const a = ctx();
    if (!a) return;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, a.currentTime + at);
    gain.gain.linearRampToValueAtTime(level, a.currentTime + at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + length);
    osc.connect(gain).connect(out(a));
    osc.start(a.currentTime + at);
    osc.stop(a.currentTime + at + length + 0.05);
}

// A soft drum hit: filtered noise (a kick low, a hat high).
function hit(at: number, high: boolean, level = 0.05) {
    const a = ctx();
    if (!a) return;
    const length = high ? 0.05 : 0.18;
    const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** (high ? 4 : 2);
    const src = a.createBufferSource();
    src.buffer = buffer;
    const filter = a.createBiquadFilter();
    filter.type = high ? "highpass" : "lowpass";
    filter.frequency.value = high ? 7000 : 140;
    const gain = a.createGain();
    gain.gain.value = level * (high ? 0.5 : 2.5);
    src.connect(filter).connect(gain).connect(out(a));
    src.start(a.currentTime + at);
}

// The music tracks: a chord loop each, with its own pace and sound, and on some a melody (one
// note per step, 0 for a rest) and a soft beat.
export const TRACKS: { id: string; label: string; chords: number[][]; bar: number; wave: OscillatorType; step: number; melody?: number[][]; beat?: boolean }[] = [
    { id: "calm", label: "Calm", bar: 2000, wave: "sine", step: 0.25, chords: [[261.6, 329.6, 392.0, 493.9], [220.0, 261.6, 329.6, 392.0], [174.6, 220.0, 261.6, 329.6], [196.0, 246.9, 293.7, 349.2]] },
    { id: "focus", label: "Focus", bar: 2400, wave: "triangle", step: 0.4, chords: [[220.0, 261.6, 329.6, 440.0], [196.0, 246.9, 293.7, 392.0], [174.6, 220.0, 261.6, 349.2], [164.8, 207.7, 246.9, 329.6]] },
    { id: "bright", label: "Bright", bar: 1600, wave: "sine", step: 0.16, chords: [[293.7, 370.0, 440.0, 587.3], [329.6, 415.3, 493.9, 659.3], [246.9, 293.7, 370.0, 493.9], [220.0, 277.2, 329.6, 440.0]] },
    { id: "lofi", label: "Lo-fi", bar: 2400, wave: "triangle", step: 0.05, beat: true, chords: [[220.0, 261.6, 329.6, 392.0], [174.6, 220.0, 261.6, 329.6], [196.0, 246.9, 293.7, 349.2], [164.8, 196.0, 246.9, 293.7]], melody: [[659.3, 0, 587.3, 523.3], [523.3, 0, 440.0, 0], [587.3, 523.3, 493.9, 0], [493.9, 0, 392.0, 0]] },
    { id: "ambient", label: "Ambient", bar: 4000, wave: "sine", step: 0.6, chords: [[130.8, 196.0, 261.6, 329.6], [110.0, 164.8, 220.0, 261.6], [87.3, 130.8, 174.6, 220.0], [98.0, 146.8, 196.0, 246.9]], melody: [[783.99, 0, 0, 659.3], [0, 523.3, 0, 0], [698.5, 0, 0, 0], [0, 0, 587.3, 0]] },
];

let bar = 0;
let playing: string | null = null;

function startMusic(trackId = "calm") {
    if (loop && playing === trackId) return;
    stopMusic();
    const track = TRACKS.find((t) => t.id === trackId) ?? (TRACKS[0] as (typeof TRACKS)[number]);
    playing = track.id;
    const play = () => {
        const i0 = bar++ % track.chords.length;
        const chord = track.chords[i0] ?? [];
        const seconds = track.bar / 1000;
        chord.forEach((f, i) => tone(f, i * track.step, track.id === "ambient" ? seconds : 1.4, 0.035, track.wave));
        tone((chord[0] ?? 220) / 2, 0, seconds - 0.1, 0.04);
        const melody = track.melody?.[i0] ?? [];
        melody.forEach((f, i) => f && tone(f, (i * seconds) / melody.length, (seconds / melody.length) * 0.9, 0.03, "sine"));
        if (track.beat) {
            for (let k = 0; k < 4; k++) {
                hit((k * seconds) / 4, false);
                hit((k * seconds) / 4 + seconds / 8, true);
            }
        }
    };
    play();
    loop = window.setInterval(play, track.bar);
}

function stopMusic() {
    window.clearInterval(loop);
    loop = 0;
    playing = null;
}

function chime() {
    [784, 988, 1175].forEach((f, i) => tone(f, i * 0.18, 0.9, 0.08));
}

// The timer's time left, ticking. Its sound is useTimerSound's, used once (by the always-shown
// pill): when every reader played it, closing the panel stopped the music for everyone's timer
// and 00:00 chimed twice.
export function useBoardTimer(): { timer: BoardTimer | null; left: number } {
    const timer = useEditor((s) => {
        const page = s.doc.nodes[s.doc.roots[0] ?? ""];
        return page?.jam?.kind === "board" ? (page.jam.timer ?? null) : null;
    });
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!timer?.endsAt) return;
        const id = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [timer?.endsAt]);
    const left = timer ? (timer.endsAt ? Math.max(0, timer.endsAt - now) : timer.left) : 0;
    return { timer, left };
}

// The music while the timer runs, and at 00:00 the chime plus `onEnd` (the pill shakes); only when
// you saw it run out, not when you open a file whose timer ended earlier.
export function useTimerSound(onEnd?: () => void): { timer: BoardTimer | null; left: number } {
    const { timer, left } = useBoardTimer();
    const running = Boolean(timer?.endsAt) && left > 0;
    useEffect(() => {
        if (running && timer?.music) startMusic(timer.track);
        else stopMusic();
        return stopMusic;
    }, [running, timer?.music, timer?.track]);
    const ended = Boolean(timer?.endsAt) && left === 0;
    const sawRunning = useRef(false);
    const end = useRef(onEnd);
    useEffect(() => {
        end.current = onEnd;
    });
    useEffect(() => {
        if (running) sawRunning.current = true;
        else if (ended && sawRunning.current) {
            sawRunning.current = false;
            chime();
            end.current?.();
        } else sawRunning.current = false;
    }, [running, ended]);
    return { timer, left };
}

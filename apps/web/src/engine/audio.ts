import { useSyncExternalStore } from "react";
import { authHeaders } from "./auth";
import { collab, currentLinkKey, onRtc, sendPresence, sendRtc } from "./collab";
import { httpBase } from "./server-url";
import { editor } from "./store";

// Audio in a file: everyone who joins talks to everyone else, browser to browser (WebRTC), with the
// sync server passing the connection details along. The server can name STUN and TURN servers
// (NAGMA_ICE_SERVERS); without them people on the same network still connect. Live captions use
// the browser's speech recognition and go to the others as text with your presence.

interface Link {
    pc: RTCPeerConnection;
    audio: HTMLAudioElement;
    level: () => number;
}

let local: MediaStream | null = null;
let context: AudioContext | null = null;
const links = new Map<string, Link>();
let iceServers: RTCIceServer[] = [];
let localLevel: (() => number) | null = null;
let recognition: { start: () => void; stop: () => void; onresult: unknown; onend: unknown; continuous: boolean; interimResults: boolean; lang: string } | null = null;

// Who's speaking right now (by presence id, "me" for you), polled a few times a second.
let speaking: Record<string, boolean> = {};
const speakingListeners = new Set<() => void>();
export function useSpeaking(): Record<string, boolean> {
    return useSyncExternalStore(
        (l) => {
            speakingListeners.add(l);
            return () => speakingListeners.delete(l);
        },
        () => speaking,
    );
}

function meter(stream: MediaStream): () => number {
    context ??= new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    return () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) ** 2;
        return Math.sqrt(sum / data.length) / 128;
    };
}

let levelTimer: number | undefined;
function watchLevels() {
    window.clearInterval(levelTimer);
    levelTimer = window.setInterval(() => {
        const next: Record<string, boolean> = {};
        if (localLevel && !collab.get().audio.muted) next.me = localLevel() > 0.04;
        for (const [id, link] of links) next[id] = link.level() > 0.04;
        if (JSON.stringify(next) !== JSON.stringify(speaking)) {
            speaking = next;
            for (const l of speakingListeners) l();
        }
    }, 200);
}

function linkTo(peerId: string): Link {
    const existing = links.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    let level = () => 0;
    for (const track of local?.getTracks() ?? []) pc.addTrack(track, local as MediaStream);
    pc.onicecandidate = (e) => {
        if (e.candidate) sendRtc(peerId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        audio.srcObject = stream;
        void audio.play().catch(() => undefined);
        level = meter(stream);
        link.level = () => level();
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") drop(peerId);
    };
    const link: Link = { pc, audio, level: () => level() };
    links.set(peerId, link);
    return link;
}

function drop(peerId: string) {
    const link = links.get(peerId);
    if (!link) return;
    links.delete(peerId);
    link.pc.close();
    link.audio.srcObject = null;
}

async function call(peerId: string) {
    const { pc } = linkTo(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendRtc(peerId, { sdp: pc.localDescription?.toJSON() });
}

onRtc((from, signal) => {
    if (!collab.get().audio.on) return;
    void (async () => {
        const { pc } = linkTo(from);
        const sdp = signal.sdp as RTCSessionDescriptionInit | undefined;
        if (sdp) {
            await pc.setRemoteDescription(sdp);
            if (sdp.type === "offer") {
                await pc.setLocalDescription(await pc.createAnswer());
                sendRtc(from, { sdp: pc.localDescription?.toJSON() });
            }
        } else if (signal.candidate) await pc.addIceCandidate(signal.candidate as RTCIceCandidateInit).catch(() => undefined);
    })();
});

// Keeps a connection to everyone in the call: the one with the lower id calls the other.
function sync() {
    const s = collab.get();
    if (!s.audio.on || !s.myId) return;
    const inCall = Object.values(s.peers).filter((p) => p.audio);
    for (const p of inCall) if (!links.has(p.userId) && s.myId < p.userId) void call(p.userId);
    for (const id of [...links.keys()]) if (!inCall.some((p) => p.userId === id)) drop(id);
}
collab.subscribe(() => {
    const s = collab.get();
    if (s.audio.on && s.status !== "live") void leaveAudio();
    else sync();
});

export async function joinAudio() {
    const s = collab.get();
    if (s.status !== "live" || s.audio.on) return;
    try {
        local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
        editor.notify("Nagma can't use your microphone. Allow it in the browser's site settings.");
        return;
    }
    try {
        const key = currentLinkKey();
        const res = await fetch(`${httpBase()}/rtc/config?file=${encodeURIComponent(s.fileId ?? "")}${key ? `&key=${encodeURIComponent(key)}` : ""}`, { headers: authHeaders() });
        if (res.ok) iceServers = ((await res.json()) as { iceServers: RTCIceServer[] }).iceServers ?? [];
    } catch {
        iceServers = [];
    }
    localLevel = meter(local);
    void context?.resume();
    collab.set({ audio: { on: true, muted: false, captions: false } });
    sendPresence(true);
    watchLevels();
    sync();
}

export async function leaveAudio() {
    for (const id of [...links.keys()]) drop(id);
    for (const t of local?.getTracks() ?? []) t.stop();
    local = null;
    localLevel = null;
    stopCaptions();
    window.clearInterval(levelTimer);
    speaking = {};
    for (const l of speakingListeners) l();
    collab.set({ audio: { on: false, muted: false, captions: false }, caption: null });
    sendPresence(true);
}

export function toggleMute() {
    const a = collab.get().audio;
    const muted = !a.muted;
    for (const t of local?.getAudioTracks() ?? []) t.enabled = !muted;
    collab.set({ audio: { ...a, muted } });
    sendPresence(true);
}

// ---- Captions: what you say, as text under your name for everyone in the call ----

type RecognitionCtor = new () => NonNullable<typeof recognition>;

export function captionsSupported(): boolean {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

let captionTimer: number | undefined;
function startCaptions() {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return false;
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => {
        if (collab.get().audio.muted) return;
        const r = e.results[e.results.length - 1];
        const text = r?.[0]?.transcript?.trim() ?? "";
        collab.set({ caption: text.slice(-200) || null });
        sendPresence();
        window.clearTimeout(captionTimer);
        captionTimer = window.setTimeout(() => {
            collab.set({ caption: null });
            sendPresence(true);
        }, 4000);
    };
    // Recognition stops on its own after a pause; it starts again while captions are on.
    recognition.onend = () => {
        if (collab.get().audio.captions && recognition) recognition.start();
    };
    recognition.start();
    return true;
}

function stopCaptions() {
    const r = recognition;
    recognition = null;
    r?.stop();
}

export function toggleCaptions() {
    const a = collab.get().audio;
    if (!a.captions && !captionsSupported()) {
        editor.notify("This browser can't make captions. Others still see their own.");
        collab.set({ audio: { ...a, captions: true } });
        return;
    }
    if (a.captions) stopCaptions();
    else startCaptions();
    collab.set({ audio: { ...a, captions: !a.captions } });
}

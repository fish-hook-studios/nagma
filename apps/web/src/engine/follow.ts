import { viewport } from "./camera";
import { type Presence, collab, sendPresence } from "./collab";
import { editor } from "./store";

// Following: your view tracks someone else's (page, position and zoom) until you do anything
// yourself. Spotlight asks everyone to follow you. Cursor chat is a short message on your cursor.

// A spotlight you stepped out of; it's left alone until that person spotlights again.
let declined: string | null = null;

export function follow(userId: string | null) {
    if (userId && !collab.get().peers[userId]) return;
    collab.set({ following: userId });
    if (userId) apply(collab.get().peers[userId]);
}

export function stopFollowing() {
    const s = collab.get();
    if (!s.following) return;
    const peer = s.peers[s.following];
    if (peer?.spotlight) declined = peer.userId;
    collab.set({ following: null });
}

export function setSpotlight(on: boolean) {
    collab.set({ spotlight: on, following: on ? null : collab.get().following });
    sendPresence(true);
    editor.notify(on ? "Spotlight on: everyone in the file follows your view." : "Spotlight off.");
}

// Matches a person's view: their page, their zoom, and the same point at the centre.
function apply(peer: Presence | undefined) {
    if (!peer) return;
    const e = editor.get();
    if (peer.pageId && peer.pageId !== e.pageId && e.doc.nodes[peer.pageId]) editor.setPage(peer.pageId);
    const cam = peer.camera;
    if (!cam || !cam.zoom) return;
    const cx = ((cam.w || viewport.width) / 2 - cam.x) / cam.zoom;
    const cy = ((cam.h || viewport.height) / 2 - cam.y) / cam.zoom;
    const camera = { zoom: cam.zoom, x: viewport.width / 2 - cx * cam.zoom, y: viewport.height / 2 - cy * cam.zoom };
    const now = editor.get().camera;
    if (Math.abs(now.x - camera.x) > 0.5 || Math.abs(now.y - camera.y) > 0.5 || Math.abs(now.zoom - camera.zoom) > 1e-4) editor.set({ camera });
}

// A spotlight starting gives a few seconds to say "Not now" before your view follows.
const SPOTLIGHT_COUNTDOWN = 3000;
let countdown: number | undefined;

export function declineSpotlight() {
    const prompt = collab.get().spotlightPrompt;
    window.clearTimeout(countdown);
    if (prompt) declined = prompt.userId;
    collab.set({ spotlightPrompt: null });
}

export function joinSpotlightNow() {
    const prompt = collab.get().spotlightPrompt;
    window.clearTimeout(countdown);
    collab.set({ spotlightPrompt: null });
    if (prompt && collab.get().peers[prompt.userId]?.spotlight) {
        collab.set({ following: prompt.userId });
        apply(collab.get().peers[prompt.userId]);
    }
}

// Ask to spotlight: the person gets a prompt to spotlight themselves.
export function askToSpotlight(userId: string) {
    const peer = collab.get().peers[userId];
    if (!peer) return;
    collab.set({ ask: { to: userId, id: Math.random().toString(36).slice(2, 10) } });
    sendPresence(true);
    editor.notify(`Asked ${peer.name || "them"} to spotlight.`);
    window.setTimeout(() => {
        collab.set({ ask: null });
        sendPresence(true);
    }, 10_000);
}

export function answerSpotlightAsk(yes: boolean) {
    collab.set({ askedToSpotlight: null });
    if (yes) setSpotlight(true);
}

const seenAsks = new Set<string>();
let lastSpotlights = new Set<string>();
collab.subscribe(() => {
    const s = collab.get();
    // Someone asked you to spotlight.
    for (const p of Object.values(s.peers)) {
        if (!p.ask || p.ask.to !== s.myId || seenAsks.has(p.ask.id)) continue;
        seenAsks.add(p.ask.id);
        if (!s.spotlight) collab.set({ askedToSpotlight: { userId: p.userId, name: p.name || "Someone", color: p.color } });
    }
    // Someone started spotlighting: after a short countdown you follow them (unless you're the one
    // presenting, or you say "Not now").
    const spot = Object.values(s.peers).filter((p) => p.spotlight);
    const now = new Set(spot.map((p) => p.userId));
    for (const p of spot) {
        if (!lastSpotlights.has(p.userId)) {
            if (declined === p.userId) declined = null;
            if (!s.spotlight && s.following !== p.userId) {
                lastSpotlights = now;
                window.clearTimeout(countdown);
                collab.set({ spotlightPrompt: { userId: p.userId, name: p.name || "Someone", color: p.color, until: Date.now() + SPOTLIGHT_COUNTDOWN } });
                countdown = window.setTimeout(joinSpotlightNow, SPOTLIGHT_COUNTDOWN);
                return;
            }
        }
    }
    // The spotlight ended before the countdown did.
    if (s.spotlightPrompt && !now.has(s.spotlightPrompt.userId)) {
        window.clearTimeout(countdown);
        collab.set({ spotlightPrompt: null });
        return;
    }
    if (declined && !now.has(declined)) declined = null;
    lastSpotlights = now;
    if (s.following) {
        const peer = s.peers[s.following];
        if (!peer) {
            collab.set({ following: null });
            return;
        }
        apply(peer);
    }
});

// Any input of your own (clicking or scrolling the canvas, a key) stops following.
function interrupt(event: Event) {
    if (!collab.get().following) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("[data-follow-ui]")) return;
    if (event instanceof KeyboardEvent && ["Shift", "Meta", "Control", "Alt"].includes(event.key)) return;
    stopFollowing();
}
window.addEventListener("pointerdown", interrupt, true);
window.addEventListener("wheel", interrupt, { capture: true, passive: true });
window.addEventListener("keydown", interrupt, true);

// ---- Cursor chat ----

let chatTimer: number | undefined;

export function openCursorChat() {
    if (collab.get().status !== "live") {
        editor.notify("Cursor chat works in shared files.");
        return;
    }
    collab.set({ chatOpen: true });
}

export function setChat(text: string) {
    window.clearTimeout(chatTimer);
    collab.set({ chat: text || null });
    sendPresence();
}

// Sends the message and starts a new one; it stays on your cursor a few seconds for others.
export function sendChat(text: string) {
    collab.set({ chat: text || null });
    sendPresence(true);
    window.clearTimeout(chatTimer);
    chatTimer = window.setTimeout(() => {
        collab.set({ chat: null });
        sendPresence(true);
    }, 5000);
}

export function closeCursorChat() {
    collab.set({ chatOpen: false });
    window.clearTimeout(chatTimer);
    chatTimer = window.setTimeout(() => {
        collab.set({ chat: null });
        sendPresence(true);
    }, 2000);
}

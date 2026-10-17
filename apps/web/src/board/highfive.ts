import { worldToScreen } from "../engine/camera";
import { collab, myCursor, sendPresence } from "../engine/collab";
import { editor } from "../engine/store";
import type { Camera } from "../engine/types";
import { playBurst } from "./stamps";

// High fives: hold H (or shake the pointer left and right) to raise a hand over your cursor; bump
// it into someone else's raised hand and you both get a burst. Letting go of H, a click, Esc or a
// few idle seconds put the hand down.

let idle = 0;
const recent = new Map<string, number>();

function onBoard() {
    const s = editor.get();
    return Boolean(s.doc.board) && !s.homeOpen;
}

export function setHighFive(on: boolean) {
    if (collab.get().highFive === on) return;
    collab.set({ highFive: on });
    sendPresence(true);
    editor.set({});
    window.clearTimeout(idle);
    if (on) idle = window.setTimeout(() => setHighFive(false), 6000);
}

// Holding H: a tap still picks the hand tool; held past a moment, the hand goes up.
let holdTimer = 0;
window.addEventListener("keydown", (e) => {
    if (!onBoard() || e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.repeat) return;
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => setHighFive(true), 450);
});
window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() !== "h") return;
    window.clearTimeout(holdTimer);
    if (collab.get().highFive) setHighFive(false);
});
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && collab.get().highFive) setHighFive(false);
});
window.addEventListener("pointerdown", () => {
    if (collab.get().highFive) setHighFive(false);
});

// A shake: the pointer reversing left/right four times, quickly and widely, within half a second.
let turns: number[] = [];
let lastX = 0;
let lastDir = 0;
window.addEventListener("pointermove", (e) => {
    if (!onBoard()) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (Math.abs(dx) > 12) {
        const dir = Math.sign(dx);
        if (dir !== lastDir) {
            const now = performance.now();
            turns = [...turns.filter((t) => now - t < 500), now];
            lastDir = dir;
            if (turns.length >= 5 && !collab.get().highFive) {
                turns = [];
                setHighFive(true);
            }
        }
    }
    if (collab.get().highFive) {
        window.clearTimeout(idle);
        idle = window.setTimeout(() => setHighFive(false), 6000);
        bump();
    }
});

// Two raised hands within reach of each other: a high five (once a second per person).
function bump() {
    const me = myCursor();
    if (!me) return;
    const zoom = editor.get().camera.zoom;
    for (const peer of Object.values(collab.get().peers)) {
        if (!peer.highFive || !peer.cursor || peer.pageId !== editor.get().pageId) continue;
        if (Math.hypot(peer.cursor.x - me.x, peer.cursor.y - me.y) * zoom > 44) continue;
        const now = performance.now();
        if (now - (recent.get(peer.userId) ?? 0) < 1200) continue;
        recent.set(peer.userId, now);
        playBurst("🙌", (me.x + peer.cursor.x) / 2, (me.y + peer.cursor.y) / 2);
        editor.notify(`High five with ${peer.name || "a collaborator"}!`);
    }
}

// Collaborators bumping into your hand see it from their side; you see it when theirs reaches yours.
collab.subscribe(() => {
    if (collab.get().highFive) bump();
});

// Raised hands over cursors: yours (where the pointer is) and everyone else's.
export function drawHands(ctx: CanvasRenderingContext2D, camera: Camera, pointer: { x: number; y: number } | null) {
    const hands: { x: number; y: number }[] = [];
    if (collab.get().highFive && pointer) hands.push(pointer);
    for (const peer of Object.values(collab.get().peers)) if (peer.highFive && peer.cursor && peer.pageId === editor.get().pageId) hands.push(peer.cursor);
    for (const h of hands) {
        const at = worldToScreen(camera, h.x, h.y);
        ctx.save();
        ctx.font = '30px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("✋", at.x + 6, at.y - 4);
        ctx.restore();
    }
}

import { nanoid } from "nanoid";
import { collab, sendPresence } from "../engine/collab";
import { editor } from "../engine/store";
import { apply, spaceMatrix, worldBounds } from "../engine/transform";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { postEditFixes } from "./connectors";
import { sameStamp, stampLook } from "./model";
import { board } from "./state";
import type { StampPick } from "./types";

// Stamps stick to the object they're dropped on and move with it; while placing one, holding the
// press makes it grow. Emotes (Shift-click with the stamp tool) burst a stamp's emoji for everyone
// in the file for a moment, without adding anything to the board.

// Stamp sizes while held down: it grows a step every third of a second, four times.
export function heldStampSize(ms: number): number {
    const steps = Math.max(0, Math.min(4, Math.floor((ms - 250) / 330) + 1));
    return 48 + steps * 24;
}

// The smallest board object or image under a point (a stamp sits on top, so hit testing finds the stamp).
export function objectUnder(doc: NagmaDocument, p: { x: number; y: number }, skip: string): SceneNode | null {
    let best: SceneNode | null = null;
    let area = Infinity;
    for (const n of Object.values(doc.nodes)) {
        if (n.id === skip || n.visible === false || n.type === "page" || n.isSection) continue;
        const kind = n.jam?.kind;
        const image = n.fills.some((f) => f.type === "image");
        if (!(kind === "sticky" || kind === "shape" || kind === "table" || image)) continue;
        const b = worldBounds(doc, n);
        if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
        if (b.w * b.h < area) {
            area = b.w * b.h;
            best = n;
        }
    }
    return best;
}

function center(doc: NagmaDocument, node: SceneNode) {
    const b = worldBounds(doc, node);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

// After an edit: stuck stamps follow their object; a stamp moved by itself sticks to what it now
// sits on (or to nothing).
function stampFollow(before: NagmaDocument, after: NagmaDocument): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(after.nodes)) {
        const jam = node.jam;
        if (jam?.kind !== "stamp" && !(jam?.kind === "draw" && jam.tool === "highlighter")) continue;
        const loose = jam.kind === "stamp" ? { kind: "stamp" as const, stamp: jam.stamp, glyph: jam.glyph, face: jam.face, author: jam.author } : { kind: "draw" as const, tool: jam.tool };
        const prev = before.nodes[node.id];
        const moved = prev && (prev.x !== node.x || prev.y !== node.y || prev.parentId !== node.parentId);
        const target = jam.on ? after.nodes[jam.on] : undefined;
        const targetMoved = target && before.nodes[target.id] && JSON.stringify(worldBounds(before, before.nodes[target.id] as SceneNode)) !== JSON.stringify(worldBounds(after, target));
        if (moved && !targetMoved) {
            // Re-stick where it was put down.
            const c = center(after, node);
            const sticky = objectUnder(after, c, node.id);
            if (sticky) {
                const b = worldBounds(after, sticky);
                const at = { u: (c.x - b.x) / Math.max(1, b.w), v: (c.y - b.y) / Math.max(1, b.h) };
                if (jam.on !== sticky.id || Math.abs((jam.at?.u ?? 0) - at.u) > 1e-4 || Math.abs((jam.at?.v ?? 0) - at.v) > 1e-4) commands.push({ type: "node.update", id: node.id, patch: { jam: { ...jam, on: sticky.id, at } } });
            } else if (jam.on) commands.push({ type: "node.update", id: node.id, patch: { jam: loose } });
            continue;
        }
        if (!jam.on) continue;
        if (!target) {
            commands.push({ type: "node.update", id: node.id, patch: { jam: loose } });
            continue;
        }
        const b = worldBounds(after, target);
        const want = { x: b.x + (jam.at?.u ?? 0.5) * b.w, y: b.y + (jam.at?.v ?? 0.5) * b.h };
        const now = center(after, node);
        if (Math.abs(want.x - now.x) < 0.5 && Math.abs(want.y - now.y) < 0.5) continue;
        const local = apply(spaceMatrix(after, node.parentId).inverse(), want.x, want.y);
        commands.push({ type: "node.update", id: node.id, patch: { x: local.x - node.w / 2, y: local.y - node.h / 2 } });
    }
    return commands;
}

postEditFixes.push(stampFollow);

// ---- Emotes ----

interface Burst {
    glyph: string;
    x: number;
    y: number;
    start: number;
    seed: number;
}

export const bursts: Burst[] = [];
const BURST_MS = 1600;
let frame = 0;

function animate() {
    const now = performance.now();
    for (let i = bursts.length - 1; i >= 0; i--) if (now - (bursts[i]?.start ?? 0) > BURST_MS) bursts.splice(i, 1);
    editor.set({});
    frame = bursts.length ? requestAnimationFrame(animate) : 0;
}

export function playBurst(glyph: string, x: number, y: number) {
    bursts.push({ glyph, x, y, start: performance.now(), seed: Math.random() * 1000 });
    if (!frame) frame = requestAnimationFrame(animate);
}

export function sendEmote(stamp: StampPick, world: { x: number; y: number }) {
    const glyph = stampLook(stamp).glyph;
    playBurst(glyph, world.x, world.y);
    collab.set({ emote: { id: nanoid(8), glyph, x: world.x, y: world.y } });
    sendPresence(true);
}

// Others' emotes play once each.
const seen = new Set<string>();
collab.subscribe(() => {
    for (const peer of Object.values(collab.get().peers)) {
        const e = peer.emote;
        if (!e || seen.has(e.id)) continue;
        seen.add(e.id);
        if (peer.pageId === editor.get().pageId && editor.get().doc.board) playBurst(e.glyph, e.x, e.y);
    }
});

// The bursts, drawn over the board: a handful of the emoji rising, spreading and fading.
export function drawBursts(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }) {
    const now = performance.now();
    for (const b of bursts) {
        const t = Math.min(1, (now - b.start) / BURST_MS);
        const at = toScreen(b.x, b.y);
        for (let i = 0; i < 7; i++) {
            const angle = -Math.PI / 2 + (i - 3) * 0.32 + Math.sin(b.seed + i) * 0.12;
            const dist = 30 + t * (90 + ((b.seed * (i + 3)) % 50));
            const size = 22 + ((i * 7 + b.seed) % 14);
            ctx.save();
            ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45);
            ctx.font = `${Math.round(size * (0.7 + t * 0.5))}px "Apple Color Emoji", "Segoe UI Emoji", Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(b.glyph, at.x + Math.cos(angle) * dist, at.y + Math.sin(angle) * dist);
            ctx.restore();
        }
    }
}

// ---- The stamp wheel ----

// Stamps with `pick` (and keeps it among the recent ones).
export function pickStamp(pick: StampPick) {
    const b = board.get();
    board.set({ stamp: pick, tool: "stamp", tray: null, wheel: null, stampRecent: [pick, ...b.stampRecent.filter((s) => !sameStamp(s, pick))].slice(0, 3) });
    editor.set({ tool: "move" });
}

// Where the pointer last was over the board (the E key opens the wheel there).
let pointer: { x: number; y: number } | null = null;
window.addEventListener("pointermove", (e) => {
    pointer = (e.target as Element | null)?.closest?.("[data-board]") ? { x: e.clientX, y: e.clientY } : pointer;
});

// Opens the wheel at the pointer (`atPointer`) or above the toolbar.
export function openWheel(atPointer = false) {
    const main = document.querySelector("[data-board]")?.getBoundingClientRect();
    const point = atPointer && pointer ? pointer : { x: (main?.left ?? 0) + (main?.width ?? window.innerWidth) / 2, y: (main?.bottom ?? window.innerHeight) - 200 };
    // The wheel replaces whatever option bar was open (shapes, stickies, drawing, actions) and the
    // tool that bar belonged to.
    const tool = board.get().tool;
    board.set({ wheel: point, tray: null, shapesPanel: false, ...(tool && tool !== "stamp" ? { tool: null } : {}) });
}

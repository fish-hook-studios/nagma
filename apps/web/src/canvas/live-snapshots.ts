import { useSyncExternalStore } from "react";
import { notifyImageReady } from "../engine/image-store";
import { LIVE_SANDBOX, isLive, liveDocument } from "../engine/live";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";

// Pictures of Live frames, so they show wherever the canvas draws (thumbnails, exports, the
// layers that are offscreen or too small to run live): the last PNG each frame sent back, by layer.
// Also the one message listener every Live frame's sandbox talks through, and the small state the
// canvas and the Inspector share (the frame being used, errors, the last event).

interface Snapshot {
    // What the picture shows (the frame's document and size when it was taken).
    key: string;
    data: string;
    img: HTMLImageElement;
}

const snapshots = new Map<string, Snapshot>();

// The frame's document and size: a different key means the picture is out of date.
export function snapshotKey(doc: NagmaDocument, node: SceneNode): string {
    return `${Math.round(node.w)}x${Math.round(node.h)}:${hash(liveDocument(doc, node))}`;
}

function hash(text: string): string {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36) + text.length.toString(36);
}

export function liveSnapshot(id: string): HTMLImageElement | null {
    const s = snapshots.get(id);
    return s && s.img.complete && s.img.naturalWidth > 0 ? s.img : null;
}

export function liveSnapshotData(id: string): string | null {
    return snapshots.get(id)?.data ?? null;
}

export function liveSnapshotKey(id: string): string | null {
    return snapshots.get(id)?.key ?? null;
}

export function storeSnapshot(id: string, key: string, data: string): Promise<void> {
    if (!data.startsWith("data:image/png")) return Promise.resolve();
    const current = snapshots.get(id);
    if (current && current.data === data) {
        current.key = key;
        return Promise.resolve();
    }
    const img = new Image();
    const loaded = new Promise<void>((resolve) => {
        img.onload = () => {
            resolve();
            notifyImageReady();
            editor.set({});
        };
        img.onerror = () => resolve();
    });
    img.src = data;
    snapshots.set(id, { key, data, img });
    return loaded;
}

// Layers whose live frame is showing over the canvas right now: the canvas leaves their picture
// out underneath (it would double up through transparent parts). Only the editor's own canvas pass
// skips them; thumbnails and exports always draw the picture.
export const liveShown = new Set<string>();
let canvasPass = false;
export function setCanvasPass(on: boolean) {
    canvasPass = on;
}
export function skipSnapshot(id: string): boolean {
    return canvasPass && liveShown.has(id);
}

// ---- Messages from the sandboxes ----

export interface LiveMessage {
    nl: 1;
    type: "ready" | "declare" | "emit" | "error" | "snapshot" | "escape" | "changed";
    [key: string]: unknown;
}

const routes = new Map<Window, (m: LiveMessage) => void>();
let listening = false;

export function routeFrame(win: Window | null | undefined, handler: (m: LiveMessage) => void): () => void {
    if (!win) return () => undefined;
    if (!listening) {
        listening = true;
        window.addEventListener("message", (e) => {
            const d = e.data as LiveMessage | null;
            if (!d || d.nl !== 1 || !e.source) return;
            routes.get(e.source as Window)?.(d);
        });
    }
    routes.set(win, handler);
    return () => {
        if (routes.get(win) === handler) routes.delete(win);
    };
}

// ---- Shared state ----

export interface LiveEvent {
    name: string;
    detail: unknown;
    at: number;
}

interface LiveUi {
    // The Live frame the person is using (double-click enters, Escape leaves).
    entered: string | null;
    errors: Record<string, string[]>;
    lastEvent: Record<string, LiveEvent>;
}

let ui: LiveUi = { entered: null, errors: {}, lastEvent: {} };
const subscribers = new Set<() => void>();

export const liveUi = {
    get: () => ui,
    set(patch: Partial<LiveUi>) {
        ui = { ...ui, ...patch };
        for (const fn of subscribers) fn();
    },
    subscribe(fn: () => void) {
        subscribers.add(fn);
        return () => void subscribers.delete(fn);
    },
};

export function useLiveUi<T>(pick: (s: LiveUi) => T): T {
    return useSyncExternalStore(liveUi.subscribe, () => pick(ui));
}

export function enterLive(id: string | null) {
    if (liveUi.get().entered !== id) liveUi.set({ entered: id });
}

export function noteError(id: string, message: string) {
    const list = [...(ui.errors[id] ?? []), message].slice(-5);
    liveUi.set({ errors: { ...ui.errors, [id]: list } });
}

export function clearErrors(id: string) {
    if (!ui.errors[id]?.length) return;
    const errors = { ...ui.errors };
    delete errors[id];
    liveUi.set({ errors });
}

export function noteEvent(id: string, name: string, detail: unknown) {
    liveUi.set({ lastEvent: { ...ui.lastEvent, [id]: { name, detail, at: Date.now() } } });
}

// ---- Pictures for exports and thumbnails ----

// Runs a Live frame off screen at its own size, waits for it to draw, and keeps its picture.
async function pictureOffscreen(doc: NagmaDocument, node: SceneNode, key: string, scale: number): Promise<void> {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", LIVE_SANDBOX);
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.max(1, Math.round(node.w))}px;height:${Math.max(1, Math.round(node.h))}px;border:0;opacity:0;pointer-events:none;`;
    frame.srcdoc = liveDocument(doc, node);
    document.body.appendChild(frame);
    let off = () => undefined as void;
    try {
        await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 5000);
            const asked = `${node.id}:${Date.now()}`;
            off = routeFrame(frame.contentWindow, (m) => {
                if (m.type === "ready") window.setTimeout(() => frame.contentWindow?.postMessage({ nl: 1, type: "snapshot", id: asked, scale }, "*"), 150);
                if (m.type === "snapshot" && m.id === asked) {
                    window.clearTimeout(timer);
                    if (typeof m.data === "string") void storeSnapshot(node.id, key, m.data).then(resolve);
                    else resolve();
                }
            });
        });
    } finally {
        off();
        frame.remove();
    }
}

function liveIn(doc: NagmaDocument, ids: string[]): SceneNode[] {
    const out: SceneNode[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const node = doc.nodes[id];
        if (!node) return;
        if (isLive(node) && node.visible) out.push(node);
        for (const child of node.children) walk(child);
    };
    for (const id of ids) walk(id);
    return out;
}

// Before an export or a thumbnail: every Live frame in these layers has an up-to-date picture.
export async function ensureLiveSnapshots(doc: NagmaDocument, ids: string[], scale = 2): Promise<void> {
    if (typeof document === "undefined") return;
    const stale = liveIn(doc, ids).filter((node) => liveSnapshotKey(node.id) !== snapshotKey(doc, node));
    await Promise.all(stale.map((node) => pictureOffscreen(doc, node, snapshotKey(doc, node), scale).catch(() => undefined)));
}

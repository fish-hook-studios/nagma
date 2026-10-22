import { nanoid } from "nanoid";
import { CAPTURE_AT, CAPTURE_PATH, CAPTURE_SRC, CAPTURE_URL } from "./capture-import";
import { makeNode } from "./nodes";
import { solid } from "./paint";
import type { NagmaDocument, SceneNode } from "./types";

// What changed on a page between two captures of it, layer by layer (Phase 5): layers are matched by
// the DOM path the importer kept on them (and their name), then compared for text, pictures and
// place. Pure: the "Changes" page it makes is a set of new layers for the caller to add.

export type ChangeKind = "text" | "image" | "moved" | "added" | "removed";

export interface LayerState {
    id: string;
    name: string;
    // Relative to the page frame.
    box: { x: number; y: number; w: number; h: number };
    text?: string;
}

export interface CaptureChange {
    kind: ChangeKind;
    path: string;
    name: string;
    before?: LayerState;
    after?: LayerState;
}

const MOVE = 2;

interface Entry {
    node: SceneNode;
    key: string;
    path: string;
    box: LayerState["box"];
    parent: string | null;
}

// The layers under a page frame that a capture made, keyed by DOM path (and kind, and a count for
// the rare repeat), with their boxes relative to the frame.
function entries(nodes: Record<string, SceneNode>, frameId: string): Map<string, Entry> {
    const frame = nodes[frameId];
    const out = new Map<string, Entry>();
    if (!frame) return out;
    const seen = new Map<string, number>();
    const visit = (id: string, parent: string | null) => {
        const n = nodes[id];
        if (!n) return;
        const path = n.pluginData?.[CAPTURE_PATH];
        let mine = parent;
        if (path && id !== frameId) {
            const base = `${path}|${n.type === "text" ? "text" : "box"}`;
            const k = seen.get(base) ?? 0;
            seen.set(base, k + 1);
            const key = k ? `${base}#${k}` : base;
            out.set(key, { node: n, key, path, box: { x: n.x - frame.x, y: n.y - frame.y, w: n.w, h: n.h }, parent });
            mine = key;
        }
        n.children.forEach((c) => visit(c, mine));
    };
    visit(frameId, null);
    return out;
}

function state(e: Entry): LayerState {
    return { id: e.node.id, name: e.node.name, box: e.box, ...(e.node.type === "text" ? { text: e.node.text ?? "" } : {}) };
}

function pictureOf(n: SceneNode): string | null {
    const src = n.pluginData?.[CAPTURE_SRC];
    if (src) return src;
    const img = n.fills.find((p) => p.type === "image");
    return img && img.type === "image" ? img.id : null;
}

// Layers moved (or resized) by more than a couple of pixels, relative to their parent when the
// parent moved too (so a section that moved down doesn't list everything in it).
function moved(a: Entry, b: Entry, before: Map<string, Entry>, after: Map<string, Entry>): boolean {
    const pa = a.parent ? before.get(a.parent) : undefined;
    const pb = b.parent ? after.get(b.parent) : undefined;
    const rel = (e: Entry, p: Entry | undefined) => ({ x: e.box.x - (p?.box.x ?? 0), y: e.box.y - (p?.box.y ?? 0) });
    const ra = pa && pb && a.parent === b.parent ? rel(a, pa) : a.box;
    const rb = pa && pb && a.parent === b.parent ? rel(b, pb) : b.box;
    // Text sizes (and, centred or right-aligned, places across) follow its words: a text whose
    // words changed has moved only when it moved down or up.
    if (a.node.type === "text" && (a.node.text ?? "") !== (b.node.text ?? "")) return Math.abs(ra.y - rb.y) > MOVE;
    const sized = a.node.type === "text" ? false : Math.abs(a.box.w - b.box.w) > MOVE || Math.abs(a.box.h - b.box.h) > MOVE;
    return Math.abs(ra.x - rb.x) > MOVE || Math.abs(ra.y - rb.y) > MOVE || sized;
}

export function diffCaptures(beforeNodes: Record<string, SceneNode>, beforeFrame: string, afterNodes: Record<string, SceneNode>, afterFrame: string): CaptureChange[] {
    const before = entries(beforeNodes, beforeFrame);
    const after = entries(afterNodes, afterFrame);
    const pairs = new Map<string, string>();
    for (const key of before.keys()) if (after.has(key)) pairs.set(key, key);
    // Layers without a match by path: the same name and kind, nearest first (a path that shifted
    // because something was added before it).
    const lostBefore = [...before.values()].filter((e) => !pairs.has(e.key));
    const takenAfter = new Set(pairs.values());
    for (const a of lostBefore) {
        const candidates = [...after.values()].filter((b) => !takenAfter.has(b.key) && b.node.type === a.node.type && b.node.name === a.node.name);
        candidates.sort((p, q) => Math.hypot(p.box.x - a.box.x, p.box.y - a.box.y) - Math.hypot(q.box.x - a.box.x, q.box.y - a.box.y));
        const b = candidates[0];
        if (!b) continue;
        pairs.set(a.key, b.key);
        takenAfter.add(b.key);
    }
    const out: CaptureChange[] = [];
    for (const [ka, kb] of pairs) {
        const a = before.get(ka) as Entry;
        const b = after.get(kb) as Entry;
        const base = { path: b.path, name: b.node.name, before: state(a), after: state(b) };
        if (a.node.type === "text" && b.node.type === "text" && (a.node.text ?? "") !== (b.node.text ?? "")) out.push({ kind: "text", ...base });
        const pa = pictureOf(a.node);
        const pb = pictureOf(b.node);
        if ((pa || pb) && pa !== pb) out.push({ kind: "image", ...base });
        if (moved(a, b, before, after)) out.push({ kind: "moved", ...base });
    }
    // Added and removed: only the outermost (a new section, not everything in it).
    const matchedAfter = new Set(pairs.values());
    const matchedBefore = new Set(pairs.keys());
    for (const b of after.values()) {
        if (matchedAfter.has(b.key) || (b.parent && !matchedAfter.has(b.parent) && after.has(b.parent))) continue;
        out.push({ kind: "added", path: b.path, name: b.node.name, after: state(b) });
    }
    for (const a of before.values()) {
        if (matchedBefore.has(a.key) || (a.parent && !matchedBefore.has(a.parent) && before.has(a.parent))) continue;
        out.push({ kind: "removed", path: a.path, name: a.node.name, before: state(a) });
    }
    // A layer that only grew or shrank because of a change inside it isn't a change of its own.
    const inner = (c: CaptureChange) => out.some((o) => o !== c && o.path.startsWith(`${c.path}>`));
    const kept = out.filter((c) => !(c.kind === "moved" && onlyResized(c) && inner(c)));
    const order: ChangeKind[] = ["text", "image", "added", "removed", "moved"];
    const top = (c: CaptureChange) => (c.after ?? c.before)?.box.y ?? 0;
    return kept.sort((p, q) => top(p) - top(q) || order.indexOf(p.kind) - order.indexOf(q.kind));
}

// ---- The page that shows them ----

export const CHANGE_COLORS: Record<ChangeKind, string> = { text: "#F79009", image: "#7A5AF8", moved: "#2E90FA", added: "#12B76A", removed: "#F04438" };
const LABEL: Record<ChangeKind, string> = { text: "Text changed", image: "Picture changed", moved: "Moved", added: "Added", removed: "Removed" };

const short = (s: string, n = 48) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Same place, another size.
function onlyResized(c: CaptureChange): boolean {
    if (!c.before || !c.after) return false;
    return Math.abs(c.after.box.x - c.before.box.x) <= MOVE && Math.abs(c.after.box.y - c.before.box.y) <= MOVE;
}

export function changeLine(c: CaptureChange): string {
    const what = short(c.name, 40);
    if (c.kind === "text") return `${LABEL.text}: “${short(c.before?.text ?? "", 40)}” to “${short(c.after?.text ?? "", 40)}”`;
    if (c.kind === "moved" && c.before && c.after) {
        const dx = Math.round(c.after.box.x - c.before.box.x);
        const dy = Math.round(c.after.box.y - c.before.box.y);
        const resized = Math.abs(c.after.box.w - c.before.box.w) > MOVE || Math.abs(c.after.box.h - c.before.box.h) > MOVE;
        const by = [dx ? `${dx > 0 ? "+" : ""}${dx} x` : "", dy ? `${dy > 0 ? "+" : ""}${dy} y` : ""].filter(Boolean).join(", ");
        if (!by && resized) return `Resized: ${what}, now ${Math.round(c.after.box.w)} × ${Math.round(c.after.box.h)}`;
        return `${LABEL.moved}: ${what}${by ? ` (${by})` : ""}${resized ? `, now ${Math.round(c.after.box.w)} × ${Math.round(c.after.box.h)}` : ""}`;
    }
    return `${LABEL[c.kind]}: ${what}`;
}

export interface ChangesPage {
    page: SceneNode;
    // Every layer of the page (the page first, parents before children).
    nodes: SceneNode[];
    outlines: number;
}

// A page named "Changes <date>": the new capture's layers as they are, an outline over each changed
// layer (removed ones where they were) in a locked layer on top of the frame's contents, and beside
// the frame another listing the changes.
export function changesPage(capture: NagmaDocument, captureFrame: string, changes: CaptureChange[], when: Date, since?: string): ChangesPage {
    const blank: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} };
    const page = makeNode(blank, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: nanoid(10), name: `Changes ${dateText(when)}` });
    const out: SceneNode[] = [page];
    const frame = capture.nodes[captureFrame] as SceneNode;
    const source = capture.nodes[frame.parentId as string] as SceneNode;
    // The capture's page content (its frame and the component sets beside it), under the new page.
    const copy = (id: string, parentId: string) => {
        const n = capture.nodes[id];
        if (!n) return;
        out.push({ ...n, parentId, children: [...n.children] });
        n.children.forEach((c) => copy(c, id));
    };
    for (const id of source.children) copy(id, page.id);
    page.children = [...source.children];
    // Outlines, in a locked layer of their own on top of the frame's contents.
    const overlay = makeNode(blank, "frame", { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, frame.id, { id: nanoid(10), name: "Changed layers", fills: [], clip: false, locked: true, positioning: "absolute" });
    out.push(overlay);
    const host = out.find((n) => n.id === frame.id) as SceneNode;
    host.children = [...host.children, overlay.id];
    let outlines = 0;
    const seen = new Set<string>();
    for (const c of changes) {
        const box = (c.after ?? c.before)?.box;
        if (!box) continue;
        const key = `${c.kind}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.w)}|${Math.round(box.h)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rect = makeNode(blank, "rect", { x: frame.x + box.x - 2, y: frame.y + box.y - 2, w: Math.max(4, box.w + 4), h: Math.max(4, box.h + 4) }, overlay.id, {
            id: nanoid(10),
            name: `${LABEL[c.kind]}: ${short(c.name, 40)}`,
            fills: c.kind === "removed" ? [solid(CHANGE_COLORS.removed, 0.08)] : [],
            strokes: [solid(CHANGE_COLORS[c.kind])],
            strokeWidth: 2,
            strokeAlign: "center",
            radius: 3,
            ...(c.kind === "removed" ? { dash: [6, 4] as [number, number] } : {}),
        });
        out.push(rect);
        overlay.children.push(rect.id);
        outlines++;
    }
    // The list, beside the frame.
    const listX = frame.x + frame.w + 80;
    const lines = changes.slice(0, 200);
    const list = makeNode(blank, "frame", { x: listX, y: frame.y, w: 480, h: 100 }, page.id, {
        id: nanoid(10),
        name: "What changed",
        fills: [solid("#FFFFFF")],
        strokes: [solid("#EAECF0")],
        strokeWidth: 1,
        radius: 12,
        layout: { direction: "vertical", gap: 8, padding: [24, 24, 24, 24], primary: "start", counter: "start" },
        sizing: { h: "fixed", v: "hug" },
    });
    out.push(list);
    page.children.push(list.id);
    const text = (content: string, size: number, weight: number, color: string) => {
        const t = makeNode(blank, "text", { x: listX + 24, y: frame.y, w: 432, h: size * 1.4 }, list.id, {
            id: nanoid(10),
            name: short(content, 40),
            text: content,
            fontSize: size,
            fontWeight: weight,
            fontFamily: "Inter",
            lineHeight: 1.4,
            fills: [solid(color)],
            sizing: { h: "fill", v: "hug" },
        });
        out.push(t);
        list.children.push(t.id);
    };
    const counts = (["text", "image", "added", "removed", "moved"] as ChangeKind[]).map((k) => [k, changes.filter((c) => c.kind === k).length] as const).filter(([, n]) => n);
    text(changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}${since ? ` since ${dateText(new Date(since))}` : ""}` : `No changes${since ? ` since ${dateText(new Date(since))}` : ""}`, 18, 700, "#101828");
    if (counts.length) text(counts.map(([k, n]) => `${LABEL[k]} ${n}`).join(" · "), 13, 500, "#475467");
    for (const c of lines) text(changeLine(c), 13, 400, CHANGE_COLORS[c.kind]);
    if (changes.length > lines.length) text(`and ${changes.length - lines.length} more`, 13, 400, "#475467");
    return { page, nodes: out, outlines };
}

function dateText(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// The latest capture of a page in a document: its frame (by capture:url, newest capture:at).
export function latestCaptureFrame(doc: NagmaDocument, url: string): SceneNode | null {
    const want = normalizeUrl(url);
    let best: SceneNode | null = null;
    for (const pageId of doc.roots) {
        for (const id of doc.nodes[pageId]?.children ?? []) {
            const n = doc.nodes[id];
            const at = n?.pluginData?.[CAPTURE_URL];
            if (!n || !at || normalizeUrl(at) !== want) continue;
            if (!best || (n.pluginData?.[CAPTURE_AT] ?? "") > (best.pluginData?.[CAPTURE_AT] ?? "")) best = n;
        }
    }
    return best;
}

// Addresses that are the same page: without the fragment, and the trailing slash of the path.
export function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        u.hash = "";
        if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
        return u.href;
    } catch {
        return url.split("#")[0] ?? url;
    }
}

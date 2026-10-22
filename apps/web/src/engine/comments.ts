import { nanoid } from "nanoid";
import { hitTest } from "../canvas/hit-test";
import { viewport } from "./camera";
import { browserId } from "./client-id";
import { collab, sendMessage } from "./collab";
import { storeMedia } from "./media";
import { editor } from "./store";
import { worldBounds } from "./transform";
import type { NagmaDocument, SceneNode } from "./types";
import { userStorage } from "./user-storage";

// Comments: threads pinned to the canvas (and to the layer under the pin, so they move with it),
// with replies, reactions, @mentions and image attachments. Shared files keep them on the server,
// which checks every change against who is asking; local files keep them in this browser.

export interface Author {
    // Account id, or "g:<browser id>" for guests.
    uid?: string;
    name: string;
    color: string;
}

export interface Attachment {
    id: string;
    name: string;
    type: string;
    w: number;
    h: number;
}

export interface Reaction {
    uid: string;
    name: string;
}

export interface CommentMessage {
    id: string;
    author: Author;
    text: string;
    createdAt: number;
    editedAt?: number;
    attachments?: Attachment[];
    // Account ids (or guest ids) of the people @mentioned.
    mentions?: string[];
    reactions?: Record<string, Reaction[]>;
}

export interface Comment extends CommentMessage {
    pageId: string;
    // Where the pin sits in world coordinates (used when it isn't attached to a layer).
    x: number;
    y: number;
    // The layer the pin is attached to, and the pin's offset from that layer's top left.
    nodeId?: string | null;
    offset?: { x: number; y: number } | null;
    replies: CommentMessage[];
    resolved: boolean;
    resolvedBy?: Author | null;
    // A comment on an area: the box reaches back up and left from the pin by this much (world units).
    region?: { w: number; h: number } | null;
}

export type CommentOp =
    | { op: "add"; comment: Comment }
    | { op: "reply"; threadId: string; reply: CommentMessage }
    | { op: "edit"; threadId: string; messageId: string; text: string; mentions: string[] }
    | { op: "delete"; threadId: string; messageId?: string }
    | { op: "resolve"; threadId: string; resolved: boolean }
    | { op: "move"; threadId: string; pageId: string; x: number; y: number; nodeId: string | null; offset: { x: number; y: number } | null }
    | { op: "react"; threadId: string; messageId: string; emoji: string };

// ---- Identity ----

// Who "you" are for comments: the server's answer when live, else your account or this browser.
export function myUid(): string {
    const s = collab.get();
    if (s.uid) return s.uid;
    return s.accountId ? s.accountId : `g:${browserId()}`;
}

// ---- The same rules the server applies, for local files and optimistic updates ----

export function applyCommentOp(list: Comment[], op: CommentOp, actor: Author & { uid: string }, isEditor: boolean): Comment[] | string {
    const thread = "threadId" in op ? list.find((c) => c.id === op.threadId) : undefined;
    const mine = (m: CommentMessage | undefined) => Boolean(m?.author.uid && m.author.uid === actor.uid);
    const replace = (next: Comment) => list.map((c) => (c.id === next.id ? next : c));
    switch (op.op) {
        case "add":
            if (!op.comment.text.trim() && !op.comment.attachments?.length) return "Write something first.";
            return [...list, { ...op.comment, author: actor }];
        case "reply":
            if (!thread) return "That comment was deleted.";
            if (!op.reply.text.trim() && !op.reply.attachments?.length) return "Write something first.";
            return replace({ ...thread, replies: [...thread.replies, { ...op.reply, author: actor }] });
        case "edit": {
            if (!thread) return "That comment was deleted.";
            const target = op.messageId === thread.id ? thread : thread.replies.find((m) => m.id === op.messageId);
            if (!target) return "That reply was deleted.";
            if (!mine(target)) return "Only the author can edit a comment.";
            const edited = { text: op.text.trim(), editedAt: Date.now(), mentions: op.mentions };
            return replace(target === thread ? { ...thread, ...edited } : { ...thread, replies: thread.replies.map((m) => (m.id === target.id ? { ...m, ...edited } : m)) });
        }
        case "delete": {
            if (!thread) return list;
            if (!op.messageId || op.messageId === thread.id) {
                if (!mine(thread) && !isEditor) return "Only the author or an editor can delete this thread.";
                return list.filter((c) => c.id !== thread.id);
            }
            const target = thread.replies.find((m) => m.id === op.messageId);
            if (!target) return list;
            if (!mine(target) && !isEditor) return "Only the author or an editor can delete this reply.";
            return replace({ ...thread, replies: thread.replies.filter((m) => m.id !== target.id) });
        }
        case "resolve":
            if (!thread) return "That comment was deleted.";
            return replace({ ...thread, resolved: op.resolved, resolvedBy: op.resolved ? actor : null });
        case "move":
            if (!thread) return "That comment was deleted.";
            if (!mine(thread) && !isEditor) return "Only the author or an editor can move this comment.";
            return replace({ ...thread, pageId: op.pageId, x: op.x, y: op.y, nodeId: op.nodeId, offset: op.offset });
        case "react": {
            if (!thread) return "That comment was deleted.";
            const toggle = <T extends CommentMessage>(m: T): T => {
                const reactions = { ...(m.reactions ?? {}) };
                const who = reactions[op.emoji] ?? [];
                const has = who.some((r) => r.uid === actor.uid);
                const next = has ? who.filter((r) => r.uid !== actor.uid) : [...who, { uid: actor.uid, name: actor.name }];
                if (next.length) reactions[op.emoji] = next;
                else delete reactions[op.emoji];
                return { ...m, reactions };
            };
            if (op.messageId === thread.id) return replace(toggle(thread));
            return replace({ ...thread, replies: thread.replies.map((m) => (m.id === op.messageId ? toggle(m) : m)) });
        }
    }
}

// ---- Local files: comments and read state live in this browser ----

const localKey = (fileId: string) => `nagma.comments.${fileId}`;
const readsKey = (fileId: string) => `nagma.comment-reads.${fileId}`;

export function loadLocalComments(fileId: string | null) {
    if (!fileId) {
        collab.set({ comments: [], reads: {} });
        return;
    }
    try {
        const comments = JSON.parse(userStorage.getItem(localKey(fileId)) ?? "[]") as Comment[];
        const reads = JSON.parse(userStorage.getItem(readsKey(fileId)) ?? "{}") as Record<string, number>;
        collab.set({ comments: Array.isArray(comments) ? comments : [], reads });
    } catch {
        collab.set({ comments: [], reads: {} });
    }
}

function saveLocal() {
    const fileId = editor.get().fileId;
    if (!fileId) return;
    try {
        userStorage.setItem(localKey(fileId), JSON.stringify(collab.get().comments));
        userStorage.setItem(readsKey(fileId), JSON.stringify(collab.get().reads));
    } catch {
        editor.notify("This browser's storage is full, so the comment wasn't kept.");
    }
}

// Follows the open local file.
let lastLocalFile: string | null | undefined;
editor.subscribe(() => {
    const fileId = editor.get().fileId;
    if (fileId === lastLocalFile) return;
    lastLocalFile = fileId;
    if (collab.get().status === "local") loadLocalComments(fileId);
});
// Leaving a shared file brings back the local file's own comments.
let lastStatus = collab.get().status;
collab.subscribe(() => {
    const status = collab.get().status;
    if (status === lastStatus) return;
    const wasShared = lastStatus !== "local";
    lastStatus = status;
    if (status === "local" && wasShared) loadLocalComments(editor.get().fileId);
});

// ---- Running a change ----

function run(op: CommentOp): boolean {
    const s = collab.get();
    const actor = { uid: myUid(), name: s.me.name || "Guest", color: s.me.color };
    const isEditor = s.status === "local" || s.role === "edit";
    const next = applyCommentOp(s.comments, op, actor, isEditor);
    if (typeof next === "string") {
        editor.notify(next);
        return false;
    }
    collab.set({ comments: next });
    if (s.status === "local") saveLocal();
    else sendMessage({ type: "comment.op", op });
    return true;
}

// Comments on a video composition's monitor live on a page of their own, "video:<comp>", with
// the pin in the composition's pixels; there's no layer to attach to.
export const VIDEO_PAGE = "video:";

export function videoCommentPage(compId: string): string {
    return `${VIDEO_PAGE}${compId}`;
}

// The layer a pin at a world point attaches to: the top-level frame under it, else the layer under it.
export function anchorAt(doc: NagmaDocument, x: number, y: number, pageId?: string): { nodeId: string | null; offset: { x: number; y: number } | null } {
    if (pageId?.startsWith(VIDEO_PAGE)) return { nodeId: null, offset: null };
    const hit = hitTest(doc, x, y, true) ?? hitTest(doc, x, y);
    if (!hit) return { nodeId: null, offset: null };
    let top: SceneNode = hit;
    while (top.parentId && doc.nodes[top.parentId] && doc.nodes[top.parentId]?.type !== "page") top = doc.nodes[top.parentId] as SceneNode;
    const box = worldBounds(doc, top);
    return { nodeId: top.id, offset: { x: x - box.x, y: y - box.y } };
}

// The page a thread is on: its layer's page when it's attached to one (layers moved to another page
// take their comments along), else the page it was left on.
export function commentPageId(doc: NagmaDocument, c: Pick<Comment, "pageId" | "nodeId">): string {
    let node = c.nodeId ? doc.nodes[c.nodeId] : undefined;
    while (node && node.type !== "page" && node.parentId) node = doc.nodes[node.parentId];
    return node?.type === "page" ? node.id : c.pageId;
}

// Where a pin is now: on its layer (which may have moved), or where it was put.
export function pinPoint(doc: NagmaDocument, c: Comment): { x: number; y: number } {
    const node = c.nodeId ? doc.nodes[c.nodeId] : undefined;
    if (node && c.offset) {
        const box = worldBounds(doc, node);
        return { x: box.x + c.offset.x, y: box.y + c.offset.y };
    }
    return { x: c.x, y: c.y };
}

// The video editor listens for comments on its compositions (it opens the right one).
const videoCommentListeners = new Set<(compId: string) => void>();
export function onVideoComment(listener: (compId: string) => void) {
    videoCommentListeners.add(listener);
    return () => {
        videoCommentListeners.delete(listener);
    };
}

export function startDraft(pageId: string, x: number, y: number) {
    collab.set({ draft: { pageId, x, y }, openComment: null });
}

// The Comment tool's press: a click leaves a pin; a drag marks out an area, with the pin where the
// drag ends (its bottom right corner). `toWorld` maps window points to the canvas.
export function beginCommentDraft(pageId: string, start: { x: number; y: number }, toWorld: (clientX: number, clientY: number) => { x: number; y: number }, zoom: number) {
    collab.set({ draft: { pageId, x: start.x, y: start.y, dragging: true }, openComment: null });
    const onMove = (ev: PointerEvent) => {
        const w = toWorld(ev.clientX, ev.clientY);
        const dx = Math.abs(w.x - start.x);
        const dy = Math.abs(w.y - start.y);
        if (Math.max(dx, dy) * zoom < 6) return collab.set({ draft: { pageId, x: start.x, y: start.y, dragging: true } });
        collab.set({ draft: { pageId, x: Math.max(start.x, w.x), y: Math.max(start.y, w.y), region: { w: dx, h: dy }, dragging: true } });
    };
    // Listened for in the capture phase: the canvas stops these events on their way up.
    const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        const d = collab.get().draft;
        if (d) collab.set({ draft: { ...d, dragging: false } });
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
}

// The area a region comment covers, in world units, or null for a pin.
export function regionBox(doc: NagmaDocument, c: Pick<Comment, "region" | "x" | "y" | "nodeId" | "offset">): { x: number; y: number; w: number; h: number } | null {
    if (!c.region) return null;
    const p = pinPoint(doc, c as Comment);
    return { x: p.x - c.region.w, y: p.y - c.region.h, w: c.region.w, h: c.region.h };
}

export function addComment(text: string, mentions: string[] = [], attachments: Attachment[] = []): string | null {
    const draft = collab.get().draft;
    if (!draft || (!text.trim() && !attachments.length)) return null;
    const anchor = anchorAt(editor.get().doc, draft.x, draft.y, draft.pageId);
    const id = nanoid(10);
    const { dragging: _dragging, ...at } = draft;
    const ok = run({ op: "add", comment: { id, author: collab.get().me, text: text.trim(), createdAt: Date.now(), replies: [], resolved: false, ...at, ...anchor, mentions, attachments, reactions: {} } });
    if (!ok) return null;
    collab.set({ draft: null, openComment: id });
    markRead(id);
    return id;
}

export function replyTo(threadId: string, text: string, mentions: string[] = [], attachments: Attachment[] = []) {
    if (!text.trim() && !attachments.length) return;
    run({ op: "reply", threadId, reply: { id: nanoid(10), author: collab.get().me, text: text.trim(), createdAt: Date.now(), mentions, attachments, reactions: {} } });
    markRead(threadId);
}

export function editMessage(threadId: string, messageId: string, text: string, mentions: string[] = []) {
    run({ op: "edit", threadId, messageId, text, mentions });
}

export function deleteMessage(threadId: string, messageId?: string) {
    if (run({ op: "delete", threadId, messageId }) && (!messageId || messageId === threadId) && collab.get().openComment === threadId) collab.set({ openComment: null });
}

export function setResolved(threadId: string, resolved: boolean) {
    run({ op: "resolve", threadId, resolved });
    if (resolved && collab.get().openComment === threadId && !collab.get().commentFilters.resolved) collab.set({ openComment: null });
}

export function moveComment(threadId: string, pageId: string, x: number, y: number) {
    const anchor = anchorAt(editor.get().doc, x, y, pageId);
    run({ op: "move", threadId, pageId, x, y, ...anchor });
}

export function react(threadId: string, messageId: string, emoji: string) {
    run({ op: "react", threadId, messageId, emoji });
}

// ---- Read state ----

// The newest message in a thread written by someone else.
function lastFromOthers(c: Comment, me: string): number {
    return [c, ...c.replies].filter((m) => m.author.uid !== me).reduce((t, m) => Math.max(t, m.createdAt, m.editedAt ?? 0), 0);
}

export function isUnread(c: Comment, reads: Record<string, number>, me = myUid()): boolean {
    const last = lastFromOthers(c, me);
    return last > 0 && last > (reads[c.id] ?? 0);
}

export function markRead(threadId: string, unread = false) {
    const reads = { ...collab.get().reads, [threadId]: unread ? 0 : Date.now() };
    collab.set({ reads });
    if (collab.get().status === "local") saveLocal();
    else sendMessage({ type: "comment.read", reads: { [threadId]: reads[threadId] } });
}

export function markAllRead() {
    const now = Date.now();
    const reads = { ...collab.get().reads };
    for (const c of collab.get().comments) reads[c.id] = now;
    collab.set({ reads });
    if (collab.get().status === "local") saveLocal();
    else sendMessage({ type: "comment.read", reads });
}

// ---- Attachments: images go to the media store; comments keep their ids ----

export async function attachImage(file: File): Promise<Attachment | null> {
    if (!file.type.startsWith("image/")) {
        editor.notify("Attach an image (PNG, JPG, GIF or WebP).");
        return null;
    }
    if (file.size > 20 * 1024 * 1024) {
        editor.notify("That image is over 20 MB.");
        return null;
    }
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            resolve({ w: img.naturalWidth, h: img.naturalHeight });
            URL.revokeObjectURL(url);
        };
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = url;
    });
    const id = `att${nanoid(12)}`;
    await storeMedia(id, file);
    return { id, name: file.name.slice(0, 120), type: file.type, ...size };
}

// ---- @mentions ----

export interface Person {
    uid: string;
    name: string;
    color: string;
    email?: string;
    // A group to mention all at once (@everyone, @team, a user group), and how many it reaches.
    group?: boolean;
    count?: number;
}

// "@Name" tokens in text that match someone, as their ids.
export function mentionsIn(text: string, people: Person[]): string[] {
    const found = new Set<string>();
    for (const p of people) if (p.name && text.includes(`@${p.name}`)) found.add(p.uid);
    return [...found];
}

export function mentionsMe(m: CommentMessage, me = myUid()): boolean {
    return (m.mentions ?? []).includes(me) || (m.mentions ?? []).includes("group:everyone");
}

// ---- Formatting: comment text is plain text with a little markup ----
// "~~text~~" is struck through; lines starting "- " are a bulleted list, "1. " a numbered one.

export type Block = { kind: "text"; text: string } | { kind: "bullets"; items: string[] } | { kind: "numbers"; items: string[]; start: number };

export function commentBlocks(text: string): Block[] {
    const out: Block[] = [];
    for (const line of text.split("\n")) {
        const bullet = /^\s*[-•*] (.*)$/.exec(line);
        const number = /^\s*(\d+)[.)] (.*)$/.exec(line);
        const last = out[out.length - 1];
        if (bullet) {
            if (last?.kind === "bullets") last.items.push(bullet[1] ?? "");
            else out.push({ kind: "bullets", items: [bullet[1] ?? ""] });
        } else if (number) {
            if (last?.kind === "numbers") last.items.push(number[2] ?? "");
            else out.push({ kind: "numbers", items: [number[2] ?? ""], start: Number(number[1]) || 1 });
        } else if (last?.kind === "text") last.text += `\n${line}`;
        else out.push({ kind: "text", text: line });
    }
    return out;
}

// Splits text into plain and struck-through runs.
export function strikeRuns(text: string): { text: string; strike: boolean }[] {
    return text.split(/(~~[^~\n]+~~)/).filter(Boolean).map((part) => (/^~~[^~\n]+~~$/.test(part) ? { text: part.slice(2, -2), strike: true } : { text: part, strike: false }));
}

// Editing helpers for the composer: each takes the text and selection and returns new ones.
export interface Edit {
    text: string;
    start: number;
    end: number;
}

export function toggleStrike({ text, start, end }: Edit): Edit {
    const inner = text.slice(start, end);
    if (text.slice(start - 2, start) === "~~" && text.slice(end, end + 2) === "~~") return { text: text.slice(0, start - 2) + inner + text.slice(end + 2), start: start - 2, end: end - 2 };
    if (/^~~[\s\S]*~~$/.test(inner) && inner.length >= 4) return { text: text.slice(0, start) + inner.slice(2, -2) + text.slice(end), start, end: end - 4 };
    return { text: `${text.slice(0, start)}~~${inner}~~${text.slice(end)}`, start: start + 2, end: end + 2 };
}

// Turns the selected lines into a list (or back into plain lines when they already are one).
export function toggleList({ text, start, end }: Edit, kind: "bullets" | "numbers"): Edit {
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const toBreak = text.indexOf("\n", end);
    const to = toBreak < 0 ? text.length : toBreak;
    const lines = text.slice(from, to).split("\n");
    const marker = kind === "bullets" ? /^- / : /^\d+[.)] /;
    const all = lines.every((l) => marker.test(l));
    const next = lines.map((l, i) => {
        const bare = l.replace(/^(- |\d+[.)] )/, "");
        return all ? bare : kind === "bullets" ? `- ${bare}` : `${i + 1}. ${bare}`;
    });
    const joined = next.join("\n");
    const out = text.slice(0, from) + joined + text.slice(to);
    return { text: out, start: from, end: from + joined.length };
}

// ⇧Enter inside a list starts the next item (an empty item ends the list).
export function continueList({ text, start }: Edit): Edit | null {
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const line = text.slice(from, start);
    const bullet = /^- (.*)$/.exec(line);
    const number = /^(\d+)[.)] (.*)$/.exec(line);
    if (!bullet && !number) return null;
    if ((bullet?.[1] ?? number?.[2] ?? "") === "") {
        const out = text.slice(0, from) + text.slice(start);
        return { text: out, start: from, end: from };
    }
    const marker = bullet ? "- " : `${Number(number?.[1]) + 1}. `;
    const out = `${text.slice(0, start)}\n${marker}${text.slice(start)}`;
    const pos = start + 1 + marker.length;
    return { text: out, start: pos, end: pos };
}

// ⇧C: hide or show comments on the canvas.
export function toggleCommentsHidden() {
    const hidden = !collab.get().commentsHidden;
    collab.set({ commentsHidden: hidden });
    editor.notify(hidden ? "Comments hidden. Press ⇧C to show them." : "Comments shown.");
}

// A link to a comment (?comment=…) opens its thread once the comments are in.
let linked = new URL(location.href).searchParams.get("comment");
// Opens a thread once its file's comments arrive (a notification opening another file).
export function openCommentWhenLoaded(id: string) {
    linked = id;
}
collab.subscribe(() => {
    if (!linked) return;
    const c = collab.get().comments.find((x) => x.id === linked);
    if (!c) return;
    linked = null;
    const url = new URL(location.href);
    url.searchParams.delete("comment");
    history.replaceState(null, "", url);
    setTimeout(() => {
        const page = commentPageId(editor.get().doc, c);
        if (editor.get().pageId !== page) editor.setPage(page);
        const s = editor.get();
        const p = pinPoint(s.doc, c);
        editor.set({ tool: "comment", camera: { ...s.camera, x: viewport.width / 2 - p.x * s.camera.zoom, y: viewport.height / 2 - p.y * s.camera.zoom } });
        collab.set({ openComment: c.id });
        markRead(c.id);
    }, 0);
});

export function timeAgo(ms: number) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
    return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Shows a comment's pin on screen: moves to its page and centres it, then opens the thread.
export function goToComment(c: Comment) {
    const page = commentPageId(editor.get().doc, c);
    if (page.startsWith(VIDEO_PAGE)) {
        // A video comment: its composition opens on the monitor, with the thread.
        for (const l of videoCommentListeners) l(page.slice(VIDEO_PAGE.length));
        collab.set({ openComment: c.id, draft: null });
        markRead(c.id);
        return;
    }
    if (editor.get().pageId !== page) editor.setPage(page);
    const s = editor.get();
    const p = pinPoint(s.doc, c);
    editor.set({ camera: { ...s.camera, x: viewport.width / 2 - p.x * s.camera.zoom - 120, y: viewport.height / 2 - p.y * s.camera.zoom } });
    collab.set({ openComment: c.id, draft: null });
    markRead(c.id);
}


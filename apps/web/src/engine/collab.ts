import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { type DocPatch, applyPatch, diffDocs, isEmpty } from "./patch";
import { mediaIdsIn, setMediaContext, uploadUsedMedia } from "./media";
import { auth, authHeaders, token } from "./auth";
import { httpBase, syncBase } from "./server-url";
import { fileMeta, markShared, putServerMeta, rememberShared } from "./files";
import { setSharedOpener } from "./shared-opener";
import { editor, prepareDocument } from "./store";
import { viewport } from "./camera";
import type { NagmaDocument } from "./types";
import type { Comment } from "./comments";
import { browserId } from "./client-id";
import { userScopedKey, userStorage } from "./user-storage";
import { linkedServer, remoteLinkBase, shareableUrl, withServer } from "./servers";
import { createPresenceThrottle, PRESENCE_HZ } from "./presence-throttle";
import { type MissedOp, combinePending, reconnectDelay, resumeFrom } from "./reconnect";

// Real-time collaboration: connects to the sync server, sends this person's edits as patches,
// merges everyone else's, and shares cursors, selections and comments.

export interface User {
    name: string;
    color: string;
}

export interface Presence extends User {
    userId: string;
    cursor: { x: number; y: number } | null;
    selection: string[];
    pageId: string | null;
    // Signed-in people: their account.
    accountId?: string;
    // Where they're looking (camera plus the size of their canvas), for following them.
    camera?: { x: number; y: number; zoom: number; w: number; h: number } | null;
    // Presenting their view to everyone (Spotlight), and a cursor chat message.
    spotlight?: boolean;
    chat?: string | null;
    mode?: string | null;
    // The last emote burst they sent on a board (a new id each time).
    emote?: { id: string; glyph: string; x: number; y: number } | null;
    // In high-five mode (a hand over their cursor on a board).
    highFive?: boolean;
    // Asking someone to spotlight (a new id each time).
    ask?: { to: string; id: string } | null;
    // In the audio call, muted, and what they're saying (live captions).
    audio?: boolean;
    muted?: boolean;
    caption?: string | null;
    // Presenting a prototype: the screen they're on.
    prototype?: { screen: string } | null;
}

export interface Viewer {
    uid: string;
    name: string;
    color: string;
    at: number;
}

export type { Comment, CommentMessage } from "./comments";

// The Comments sidebar's sort and filters.
export interface CommentFilters {
    sort: "date" | "unread";
    resolved: boolean;
    mine: boolean;
    page: boolean;
    search: string;
}

export type Status = "local" | "connecting" | "live" | "offline";
// "prototype" opens only the prototype player.
export type Role = "edit" | "view" | "prototype";

export interface VersionMeta {
    id: string;
    createdAt: number;
    name: string | null;
    description?: string | null;
    auto: boolean;
    author: User & { uid?: string | null };
    // Checkpoints the server adds itself (restoring, merging a branch) say why.
    label?: string;
    restoredFrom?: string;
}

interface CollabState {
    status: Status;
    fileId: string | null;
    me: User;
    myId: string | null;
    peers: Record<string, Presence>;
    comments: Comment[];
    // Your id for comments (account, or this browser for guests), and when you last read each thread.
    uid: string | null;
    accountId: string | null;
    reads: Record<string, number>;
    // ⇧C hides comment pins; the sidebar's sort and filters.
    commentsHidden: boolean;
    commentFilters: CommentFilters;
    // A comment being written, at a canvas point.
    draft: { pageId: string; x: number; y: number; region?: { w: number; h: number }; dragging?: boolean } | null;
    // The comment thread that's open.
    openComment: string | null;
    // What this link allows, and (for editors) the keys for handing out links.
    role: Role | null;
    keys: { edit: string; view: string } | null;
    // What the file's link allows ("none": only invited people), as the server last said.
    access: { link: "edit" | "view" | "prototype" | "none"; owner: string | null; project: string | null; viewersCanExport?: boolean } | null;
    versions: VersionMeta[];
    // When this file is a branch: its main file and name. `branchesChanged` ticks when the server
    // says branches changed; `branchDialog` is the branching dialog that's open.
    branch: { of: string; name: string } | null;
    branchesChanged: number;
    // Ticks when the server changed the file's campaign reviews (approvals withdrawn by an edit).
    reviewsChanged: number;
    branchDialog: null | "create" | "review" | "list" | "update";
    // Everyone who has opened the file; whose view you're following; your spotlight and cursor chat.
    viewers: Viewer[];
    following: string | null;
    spotlight: boolean;
    chat: string | null;
    emote: { id: string; glyph: string; x: number; y: number } | null;
    highFive: boolean;
    // The prototype screen you're presenting, shared with the room (spotlight and follow).
    prototypeScreen: string | null;
    chatOpen: boolean;
    // Version history in the right sidebar, and the "Save to version history" dialog.
    historyOpen: boolean;
    saveVersionOpen: boolean;
    // The version whose info the dialog edits (null: saving a new one).
    editingVersion: string | null;
    // A past version being looked at instead of the live file.
    previewing: { id: string; doc: NagmaDocument } | null;
    // A file that turned you away: why (its link needs a password, the link expired, you need to be
    // invited, or you need to sign in to share), so you can unlock it or ask for access.
    gate: AccessGate | null;
    // Changes the server hasn't confirmed (kept in this browser while offline).
    unsynced: number;
    // Spotlight: someone started one and you follow when the countdown ends (unless "Not now");
    // someone asked you to spotlight; and your own ask to someone else.
    spotlightPrompt: { userId: string; name: string; color: string; until: number } | null;
    askedToSpotlight: { userId: string; name: string; color: string } | null;
    ask: { to: string; id: string } | null;
    // The audio call: whether you're in it, muted, showing captions, and your own live caption.
    audio: { on: boolean; muted: boolean; captions: boolean };
    caption: string | null;
}

export interface AccessGate {
    fileId: string;
    key: string | null;
    reason: "password" | "expired" | "no-access" | "sign-in";
    signedIn: boolean;
    requested: boolean;
}

// The multiplayer palette: the same saturated accents the reference hands out (red, orange, yellow, green, blue, purple, pink).
const COLORS = ["#F24822", "#FFA629", "#FFCD29", "#14AE5C", "#0D99FF", "#9747FF", "#FF24BD"];
const USER_KEY = "nagma.user.v1";

function loadUser(): User {
    try {
        const raw = localStorage.getItem(USER_KEY);
        if (raw) {
            const user = JSON.parse(raw) as User;
            // Identities saved with an older palette move onto the current one.
            return COLORS.includes(user.color) ? user : { ...user, color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#0D99FF" };
        }
    } catch {
        // Fall through to a fresh identity.
    }
    return { name: "", color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#0D99FF" };
}

let state: CollabState = {
    status: "local",
    fileId: null,
    me: loadUser(),
    myId: null,
    peers: {},
    comments: [],
    uid: null,
    accountId: auth.get().user?.id ?? null,
    reads: {},
    commentsHidden: false,
    commentFilters: { sort: "date", resolved: false, mine: false, page: false, search: "" },
    draft: null,
    openComment: null,
    role: null,
    keys: null,
    access: null,
    versions: [],
    branch: null,
    branchesChanged: 0,
    reviewsChanged: 0,
    branchDialog: null,
    viewers: [],
    following: null,
    spotlight: false,
    chat: null,
    emote: null,
    highFive: false,
    prototypeScreen: null,
    chatOpen: false,
    historyOpen: false,
    saveVersionOpen: false,
    editingVersion: null,
    previewing: null,
    gate: null,
    unsynced: 0,
    spotlightPrompt: null,
    askedToSpotlight: null,
    ask: null,
    audio: { on: false, muted: false, captions: false },
    caption: null,
};
let linkKey: string | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<CollabState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
}

export const collab = {
    get: () => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    set,
};

export function useCollab<T>(selector: (s: CollabState) => T): T {
    return useSyncExternalStore(collab.subscribe, () => selector(state));
}

export function setMyName(name: string, color?: string) {
    const me = { ...state.me, name: name.trim() || "Guest", ...(color ? { color } : {}) };
    try {
        localStorage.setItem(USER_KEY, JSON.stringify(me));
    } catch {
        // The name still applies for this session.
    }
    set({ me });
    sendPresence(true);
}

// ---- Connection ----

let socket: WebSocket | null = null;
let confirmed: NagmaDocument | null = null;
// The server's version of `confirmed`: after a dropped connection, the server sends only what
// happened since (when it still has it) instead of the whole file.
let confirmedVersion: number | null = null;
let pending: { id: string; patch: DocPatch }[] = [];
// Presence updates a second the room allows (the server lowers it for busy rooms).
let presenceHz = PRESENCE_HZ;
// The server turned this connection away for having too many open (per account): no retrying on
// our own until asked.
let connectionsCapped = false;

// Audio call signalling (engine/audio.ts): connection details to and from one other person.
const rtcHandlers = new Set<(from: string, signal: Record<string, unknown>) => void>();
export function onRtc(handler: (from: string, signal: Record<string, unknown>) => void) {
    rtcHandlers.add(handler);
    return () => rtcHandlers.delete(handler);
}
export function sendRtc(to: string, signal: Record<string, unknown>) {
    sendRaw({ type: "rtc", to, signal });
}

// Changes sent to the server that it hasn't confirmed yet (offline, or on their way).
export function unsyncedCount(): number {
    return state.status === "local" ? 0 : pending.length;
}

// Unconfirmed changes are kept in this browser too, so edits made offline survive a reload and sync
// when the file opens again (for up to 30 days).
const PENDING_KEY = (fileId: string) => `nagma.pending.${fileId}`;
const PENDING_DAYS = 30;
function keepPending() {
    const fileId = state.fileId;
    if (!fileId) return;
    try {
        if (pending.length) userStorage.setItem(PENDING_KEY(fileId), JSON.stringify({ at: Date.now(), pending }));
        else userStorage.removeItem(PENDING_KEY(fileId));
    } catch {
        // Storage full: they're kept for this page only.
    }
    if (state.unsynced !== pending.length) set({ unsynced: pending.length });
}
function keptPending(fileId: string): { id: string; patch: DocPatch }[] {
    try {
        const raw = JSON.parse(userStorage.getItem(PENDING_KEY(fileId)) ?? "null") as { at: number; pending: { id: string; patch: DocPatch }[] } | null;
        if (!raw || Date.now() - raw.at > PENDING_DAYS * 24 * 60 * 60 * 1000) return [];
        return Array.isArray(raw.pending) ? raw.pending : [];
    } catch {
        return [];
    }
}

// The unsynced changes dialog: try the server again now, or drop what hasn't synced.
export function retrySync() {
    retry = 0;
    connectionsCapped = false;
    if (state.fileId && state.status !== "live") connect();
}
export function discardUnsynced() {
    pending = [];
    keepPending();
    rebuildLocal();
}
let retry = 0;
let initialDoc: NagmaDocument | null = null;
let applyingRemote = false;

function serverUrl(fileId: string) {
    return `${syncBase()}/files/${fileId}`;
}

export { httpBase };

function sendRaw(message: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// For other modules: every message from the file's room (audio chat listens for its own).
export const roomListeners = new Set<(message: Record<string, unknown>) => void>();

// For the other collaboration modules (comments, follow, versions): a message to the file's room.
export function sendMessage(message: Record<string, unknown>) {
    sendRaw(message);
}

// Your view is the server's document plus your edits it hasn't confirmed yet.
function rebuildLocal() {
    // While looking at an old version, the live file keeps updating in the background only.
    if (!confirmed || state.previewing) return;
    applyingRemote = true;
    editor.receive(pending.reduce((doc, p) => applyPatch(doc, p.patch), confirmed));
    applyingRemote = false;
}

function connect() {
    const fileId = state.fileId;
    if (!fileId) return;
    set({ status: state.status === "live" ? "offline" : "connecting" });
    const ws = new WebSocket(serverUrl(fileId));
    socket = ws;
    ws.onopen = () => {
        // Back again after a drop: ask for what happened since the last version we have.
        const since = confirmed && confirmedVersion !== null ? confirmedVersion : undefined;
        ws.send(JSON.stringify({ type: "hello", user: state.me, initial: initialDoc, key: linkKey, token: token(), clientId: browserId(), since }));
    };
    ws.onmessage = (event) => {
        let message: Record<string, unknown>;
        try {
            message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
            return;
        }
        for (const listener of roomListeners) listener(message);
        switch (message.type) {
            case "snapshot": {
                retry = 0;
                if (typeof message.presenceHz === "number") presenceHz = message.presenceHz;
                if (message.resume && confirmed && confirmedVersion !== null) {
                    // Only what was missed: move forward, drop our own edits the server already
                    // has, and send the rest again.
                    const resumed = resumeFrom(confirmed, confirmedVersion, (message.ops as MissedOp[]) ?? [], pending);
                    if (!resumed) {
                        // The history had a gap: start over with the whole file.
                        confirmedVersion = null;
                        ws.close();
                        return;
                    }
                    confirmed = resumed.doc;
                    confirmedVersion = resumed.version;
                    pending = combinePending(confirmed, resumed.pending, diffDocs, () => nanoid(8));
                    keepPending();
                    joined(message, false);
                    break;
                }
                const doc = prepareDocument(message.doc as NagmaDocument | null);
                if (!doc) {
                    editor.notify("That shared file doesn't exist (yet). You're working on your own copy.");
                    leave();
                    return;
                }
                const created = initialDoc !== null;
                initialDoc = null;
                const role = (message.role as Role) ?? "edit";
                const keys = (message.keys as CollabState["keys"]) ?? null;
                // Creators get their edit key now; keep it in the address so a reload still works.
                if (keys && !linkKey) {
                    linkKey = keys.edit;
                    const url = new URL(location.href);
                    url.searchParams.set("key", keys.edit);
                    history.replaceState(null, "", url);
                }
                setMediaContext(state.fileId, linkKey);
                // A file just moved to the server takes the media it uses along.
                if (created && role === "edit") void uploadUsedMedia(mediaIdsIn(doc));
                // Opened from a link: list it on Home so it can be reopened, with the key that worked.
                if (state.fileId) {
                    const meta = rememberShared(state.fileId, doc.name || "Shared file", linkKey ?? (keys ? keys.edit : null));
                    if (editor.get().fileId !== meta.id) editor.set({ fileId: meta.id, homeOpen: false });
                }
                const firstLoad = confirmed === null;
                confirmed = doc;
                confirmedVersion = typeof message.version === "number" ? message.version : null;
                if (!firstLoad) pending = combinePending(confirmed, pending, diffDocs, () => nanoid(8));
                joined(message, firstLoad);
                if (firstLoad) {
                    applyingRemote = true;
                    editor.receive(doc, { resetHistory: true, opened: true });
                    applyingRemote = false;
                    // Changes made here while offline last time go up now (the server's order wins).
                    pending = state.role === "edit" && state.fileId ? combinePending(doc, keptPending(state.fileId), diffDocs, () => nanoid(8)) : [];
                    if (pending.length) {
                        for (const p of pending) sendRaw({ type: "patch", id: p.id, patch: p.patch });
                        rebuildLocal();
                        editor.notify(`Syncing ${pending.length} change${pending.length === 1 ? "" : "s"} made while offline.`);
                    }
                    keepPending();
                }
                if (firstLoad) openFromLink();
                break;
            }
            case "reset": {
                // The whole file was replaced (a version restored, a branch merged): start from it.
                const doc = prepareDocument(message.doc as NagmaDocument | null);
                if (!doc) break;
                confirmed = doc;
                if (typeof message.version === "number") confirmedVersion = message.version;
                pending = [];
                keepPending();
                if (state.previewing) set({ previewing: null });
                editor.set({ readOnly: state.role !== "edit" });
                applyingRemote = true;
                editor.receive(doc, { resetHistory: true });
                applyingRemote = false;
                if (message.by && message.by !== state.me.name) editor.notify(`${String(message.by)} replaced the file with another version.`);
                break;
            }
            case "asset-reviews":
                set({ reviewsChanged: state.reviewsChanged + 1 });
                break;
            case "branches":
                set({ branchesChanged: state.branchesChanged + 1 });
                break;
            case "notice":
                editor.notify(String(message.text ?? ""));
                break;
            case "patch": {
                if (!confirmed) return;
                const patch = message.patch as DocPatch;
                confirmed = applyPatch(confirmed, patch);
                if (typeof message.version === "number") confirmedVersion = message.version;
                if (message.from === state.myId && pending[0]?.id === message.id) {
                    // Our own edit, now confirmed; the view already shows it.
                    pending = pending.slice(1);
                    keepPending();
                } else {
                    rebuildLocal();
                }
                break;
            }
            case "ack": {
                // An edit sent again after a reconnect that the server already had.
                pending = pending.filter((p) => p.id !== message.id);
                keepPending();
                break;
            }
            case "presence":
            case "presences": {
                // One person's update, or several gathered by the server in one message.
                const list = message.type === "presence" ? [message.presence as Presence] : ((message.presences as Presence[]) ?? []);
                const peers = { ...state.peers };
                for (const p of list) if (p?.userId && p.userId !== state.myId) peers[p.userId] = p;
                set({ peers });
                break;
            }
            case "presence-rate":
                if (typeof message.hz === "number") presenceHz = message.hz;
                break;
            case "rate-limited": {
                // The server holds our changes and applies them at its pace; nothing is lost.
                const at = Date.now();
                if (at - lastRateNotice > 60_000) editor.notify(String(message.text ?? "Sending changes more slowly: the server limits how many it takes a second."));
                lastRateNotice = at;
                break;
            }
            case "leave": {
                const peers = { ...state.peers };
                const gone = Array.isArray(message.userIds) ? (message.userIds as string[]) : [String(message.userId)];
                for (const id of gone) delete peers[id];
                set({ peers, ...(state.following && gone.includes(state.following) ? { following: null } : {}) });
                break;
            }
            case "comments":
                set({ comments: message.comments as Comment[] });
                break;
            // Someone else marked a design ready for dev or completed: a toast, and a desktop
            // notification when this browser asked for them.
            case "dev.status": {
                const notice = message.notice as { text?: string; status?: string } | undefined;
                if (!notice?.text) break;
                editor.notify(notice.text);
                if (typeof Notification !== "undefined" && Notification.permission === "granted" && userStorage.getItem("nagma.devNotify.v1") !== "none") {
                    try {
                        new Notification(notice.status === "completed" ? "Completed" : "Ready for dev", { body: notice.text });
                    } catch {
                        // The toast said it.
                    }
                }
                break;
            }
            case "comment.denied":
                editor.notify(String(message.reason ?? "That comment change wasn't allowed."));
                set({ comments: message.comments as Comment[] });
                break;
            case "denied": {
                const gate: AccessGate = { fileId: state.fileId ?? "", key: linkKey?.split("~")[0] ?? null, reason: (message.reason as AccessGate["reason"]) ?? "no-access", signedIn: Boolean(message.signedIn), requested: Boolean(message.requested) };
                leave();
                if (gate.fileId) set({ gate });
                else editor.notify("That link doesn't give access to this file. Ask for a new link.");
                break;
            }
            case "rejected": {
                // Waiting for an editor's spot (the file has as many editors as it allows): kept, and
                // sent again when this person can edit.
                if (message.reason === "editors-full") break;
                // A change the server refused (view-only): drop it and show the file as it is.
                pending = pending.filter((p) => p.id !== message.id);
                keepPending();
                rebuildLocal();
                break;
            }
            case "keys":
                set({ keys: message.keys as CollabState["keys"] });
                break;
            case "rtc":
                for (const h of rtcHandlers) h(String(message.from), message.signal as Record<string, unknown>);
                break;
            case "access":
                // An editor changed the file's share settings while it was open.
                set({ access: (message.access as CollabState["access"]) ?? state.access });
                break;
            case "role": {
                // Your access changed while the file was open.
                const role = message.role as Role;
                set({ role, keys: (message.keys as CollabState["keys"]) ?? (role === "edit" ? state.keys : null) });
                editor.set({ readOnly: role !== "edit" });
                editor.notify(role === "edit" ? "You can edit this file now." : "This file is view only for you now.");
                // Changes kept while waiting for an editor's spot go up now.
                if (role === "edit") for (const p of pending) sendRaw({ type: "patch", id: p.id, patch: p.patch });
                break;
            }
            case "versions":
                set({ versions: (message.versions as VersionMeta[]) ?? [] });
                break;
            case "version": {
                const doc = prepareDocument(message.doc as NagmaDocument | null);
                if (!doc) {
                    editor.notify("That version couldn't be loaded.");
                    break;
                }
                set({ previewing: { id: String(message.id), doc } });
                editor.set({ readOnly: true, selection: [], editingTextId: null });
                applyingRemote = true;
                editor.receive(doc);
                applyingRemote = false;
                break;
            }
        }
    };
    ws.onclose = (event) => {
        if (socket !== ws || !state.fileId) return;
        set({ status: "offline" });
        // Too many connections open for this account: wait to be asked (the unsynced changes dialog).
        if (event.code === 4029) {
            connectionsCapped = true;
            editor.notify(event.reason || "This account has too many connections open. Close some tabs, then try again.");
            return;
        }
        if (connectionsCapped) return;
        // Exponential backoff with jitter, up to 15 seconds between attempts.
        retry += 1;
        setTimeout(() => {
            if (socket === ws && state.fileId && !connectionsCapped) connect();
        }, reconnectDelay(retry));
    };
}

let lastRateNotice = 0;

// In the room (a whole snapshot, or a resume): the role, keys and people in it, then everything
// still pending goes up again.
function joined(message: Record<string, unknown>, firstLoad: boolean) {
    const role = (message.role as Role) ?? "edit";
    const keys = (message.keys as CollabState["keys"]) ?? null;
    editor.set({ readOnly: role !== "edit" });
    set({ role, keys, access: (message.access as CollabState["access"]) ?? null, branch: (message.branch as CollabState["branch"]) ?? null });
    if (message.capped && typeof message.cappedText === "string") editor.notify(message.cappedText);
    const peers: Record<string, Presence> = {};
    for (const p of (message.peers as Presence[]) ?? []) peers[p.userId] = p;
    set({ status: "live", myId: String(message.you), peers, comments: (message.comments as Comment[]) ?? [], reads: (message.reads as Record<string, number>) ?? {}, viewers: (message.viewers as Viewer[]) ?? [], uid: typeof message.uid === "string" ? message.uid : null });
    if (!firstLoad) {
        // Reconnected: send again anything that wasn't confirmed before the connection dropped.
        for (const p of pending) sendRaw({ type: "patch", id: p.id, patch: p.patch });
        rebuildLocal();
    }
    presence.reset();
    sendPresence(true);
}

// Your committed edits go to the server as patches.
editor.onCommit((before, after) => {
    if (applyingRemote || !state.fileId || state.status === "local") return;
    // Edits in another file (a local draft open while this room is still connected) never go to this room.
    const open = fileMeta(editor.get().fileId);
    if (open && open.shared !== state.fileId) return;
    const patch = diffDocs(before, after);
    if (isEmpty(patch)) return;
    const id = nanoid(8);
    pending.push({ id, patch });
    keepPending();
    sendRaw({ type: "patch", id, patch });
});

// Opens a shared file with a link key. With `initial`, the file is created on the server from that document.
export function join(fileId: string, initial?: NagmaDocument, key?: string | null) {
    socket?.close();
    confirmed = null;
    pending = [];
    initialDoc = initial ?? null;
    linkKey = key ?? null;
    // A link password unlocked earlier in this tab goes along with the key.
    const pass = linkKey && !linkKey.includes("~") ? sessionPass(fileId) : null;
    if (pass) linkKey = `${linkKey}~${pass}`;
    editor.setStorageKey(null);
    set({ fileId, status: "connecting", gate: null, peers: {}, comments: [], reads: {}, uid: null, role: null, keys: null, versions: [], previewing: null, branch: null });
    const url = new URL(location.href);
    url.searchParams.set("file", fileId);
    if (linkKey) url.searchParams.set("key", linkKey.split("~")[0] ?? "");
    else url.searchParams.delete("key");
    history.replaceState(null, "", url);
    connect();
}

// The link key this file was opened with (with the pass a link password gave, if any).
export function currentLinkKey(): string | null {
    return linkKey ?? new URL(location.href).searchParams.get("key");
}

const PASS_KEY = (fileId: string) => `nagma.linkPass.${fileId}`;
function sessionPass(fileId: string): string | null {
    try {
        return sessionStorage.getItem(userScopedKey(PASS_KEY(fileId)));
    } catch {
        return null;
    }
}

// Tries a link password; on success the file opens.
export async function unlockLink(password: string): Promise<string | null> {
    const gate = state.gate;
    if (!gate) return null;
    const res = await fetch(`${httpBase()}/files/${gate.fileId}/unlock`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ password }) });
    const data = (await res.json().catch(() => ({}))) as { pass?: string; error?: string };
    if (!res.ok || data.pass === undefined) return data.error ?? "That password isn't right.";
    try {
        sessionStorage.setItem(userScopedKey(PASS_KEY(gate.fileId)), data.pass);
    } catch {
        // This tab only.
    }
    join(gate.fileId, undefined, gate.key ? `${gate.key}~${data.pass}` : null);
    return null;
}

// Asks the file's owner for access (or, for a viewer, edit access). Answers show in their notifications.
export async function requestAccess(fileId: string, role: "view" | "edit", note = ""): Promise<string | null> {
    try {
        const res = await fetch(`${httpBase()}/files/${fileId}/requests`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ role, note }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return data.error ?? "The server refused that.";
        if (state.gate?.fileId === fileId) set({ gate: { ...state.gate, requested: true } });
        return null;
    } catch {
        return "The server can't be reached.";
    }
}

export function closeGate() {
    set({ gate: null });
}

// Rejoins a shared file at start (the last one open), resolving once the server answers: true when
// it's live, false when access was denied or the server can't be reached in time.
export function rejoinShared(meta: { id: string; shared?: string; key?: string | null; kind?: string }): Promise<boolean> {
    if (!meta.shared) return Promise.resolve(false);
    editor.set({ fileId: meta.id, homeOpen: false, sequenceView: meta.kind === "video" });
    join(meta.shared, undefined, meta.key ?? null);
    return new Promise((resolve) => {
        const started = performance.now();
        const check = () => {
            if (state.status === "live") return resolve(true);
            if (state.status === "local" || performance.now() - started > 8000) {
                if (state.status !== "local") leave();
                return resolve(false);
            }
            setTimeout(check, 100);
        };
        check();
    });
}

// Opening a server file's tab (files.ts openFile) joins its room, unless this is its room already.
setSharedOpener((meta) => {
    if (!meta.shared) return false;
    if (state.fileId === meta.shared && state.status !== "local") return true;
    join(meta.shared, undefined, meta.key ?? null);
    return true;
});

// Shares the current local document as a new collaborative file.
export function shareCurrent(): string {
    const fileId = nanoid(12);
    join(fileId, editor.committed());
    const local = editor.get().fileId;
    if (local) {
        markShared(local, fileId);
        const meta = fileMeta(local);
        setTimeout(() => void putServerMeta(fileId, { kind: meta?.kind ?? "design", thumb: meta?.thumb }), 1500);
    }
    return fileId;
}

export function leave() {
    const ws = socket;
    socket = null;
    ws?.close();
    confirmed = null;
    pending = [];
    linkKey = null;
    setMediaContext(null, null);
    editor.setStorageKey(editor.get().fileId ? `nagma.file.${editor.get().fileId}` : null);
    editor.set({ readOnly: false });
    set({ fileId: null, status: "local", peers: {}, comments: [], reads: {}, uid: null, myId: null, role: null, keys: null, versions: [], previewing: null, branch: null });
    const url = new URL(location.href);
    url.searchParams.delete("file");
    url.searchParams.delete("key");
    history.replaceState(null, "", url);
}

// When Nagma is open on "localhost", share links use this computer's network address instead,
// so they work from other devices on the same network.
let lanHost: string | null = null;
// The server's configured public address (NAGMA_PUBLIC_URL), when it has one.
let publicUrl: string | null = null;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
if (LOOPBACK.includes(location.hostname) || privateHost(location.hostname)) {
    fetch(`${httpBase()}/health`)
        .then((res) => res.json() as Promise<{ addresses?: string[]; publicUrl?: string | null }>)
        .then((info) => {
            if (LOOPBACK.includes(location.hostname)) lanHost = info.addresses?.[0] ?? null;
            publicUrl = typeof info.publicUrl === "string" && /^https?:\/\//.test(info.publicUrl) ? info.publicUrl.replace(/\/+$/, "") : null;
            set({});
        })
        .catch(() => undefined);
}

// A private IPv4 address (10/8, 172.16/12, 192.168/16, 169.254/16).
export function privateHost(host: string): boolean {
    const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function publicAddress(): string | null {
    return publicUrl;
}

// Signed-in people are known by their account name and colour.
auth.onChange((user) => {
    set({ accountId: user?.id ?? null });
    if (user) setMyName(user.name, user.color);
    if (state.fileId) connect();
});
const signedIn = auth.get().user;
if (signedIn && state.me.name !== signedIn.name) state = { ...state, me: { ...state.me, name: signedIn.name, color: signedIn.color } };

export function lanAddress(): string | null {
    return lanHost;
}

// A link that lets people edit, or only view (and comment).
export function shareLink(role: "edit" | "view" = "edit"): string {
    // On another server, its own address; on This computer, the network address for other devices.
    const url = remoteLinkBase() ? shareableUrl() : new URL(location.href);
    if (lanHost && !remoteLinkBase()) url.hostname = lanHost;
    if (state.fileId) url.searchParams.set("file", state.fileId);
    const key = state.keys?.[role];
    if (key) url.searchParams.set("key", key);
    return withServer(url).toString();
}

// Makes new links; anyone opening the old ones from now on is turned away.
export function resetLinks() {
    sendRaw({ type: "keys.reset" });
}

// ---- Version history ----

export function requestVersions() {
    sendRaw({ type: "versions" });
}

export function saveVersion(name: string, description = "") {
    sendRaw({ type: "version.save", name, description });
}

// Names a version, edits its info, or (both null) deletes the info.
export function updateVersion(id: string, name: string | null, description: string | null) {
    sendRaw({ type: "version.update", id, name, description });
}

export function previewVersion(id: string) {
    sendRaw({ type: "version.get", id });
}

// Back to the live file (with everything that happened while previewing).
export function exitPreview() {
    if (!state.previewing) return;
    set({ previewing: null });
    editor.set({ readOnly: state.role !== "edit" });
    rebuildLocal();
}

// Brings the file back to how it was in a version. The server keeps two checkpoints (before and
// after) and everyone gets the restored file.
export function restoreVersion(id = state.previewing?.id) {
    if (!id || state.role !== "edit") return;
    sendRaw({ type: "version.restore", id });
    editor.notify("Version restored. Version history keeps the file as it was before.");
}

// ⌥⌘S: the "Save to version history" dialog (shared files, editors).
export function openSaveVersion() {
    if (state.status === "local") {
        editor.notify("Share this file to keep versions on the server.");
        set({ historyOpen: true });
        return;
    }
    if (state.role !== "edit") {
        editor.notify("Only editors can save versions.");
        return;
    }
    set({ saveVersionOpen: true });
}

// A link that opens this file on a version (people need edit access to see it).
export function versionLink(id: string): string {
    const url = new URL(shareLink("edit"));
    url.searchParams.set("version", id);
    return url.toString();
}

// Opening a link with ?version=…, ?node-id=…, ?mode=dev or ?comment=… lands there.
const opened = new URL(location.href).searchParams;
function openFromLink() {
    const version = opened.get("version");
    if (version && state.role === "edit") {
        set({ historyOpen: true });
        previewVersion(version);
    }
    for (const listener of linkListeners) listener(opened);
}
const linkListeners = new Set<(params: URLSearchParams) => void>();
export function onLinkOpened(listener: (params: URLSearchParams) => void) {
    linkListeners.add(listener);
}

// ---- Presence ----

let cursor: { x: number; y: number } | null = null;

// At most 20 updates a second (5 in rooms the server calls busy), the latest state each time;
// nothing while this tab is hidden or when nothing changed; the camera 5 times a second.
const presence = createPresenceThrottle({
    build: () => {
        const s = editor.get();
        return { type: "presence", name: state.me.name, color: state.me.color, cursor, selection: s.selection, pageId: s.pageId, camera: { ...s.camera, w: viewport.width, h: viewport.height }, spotlight: state.spotlight, chat: state.chat, mode: s.mode, emote: state.emote, highFive: state.highFive, ask: state.ask, audio: state.audio.on, muted: state.audio.muted, caption: state.audio.on ? state.caption : null, prototype: state.prototypeScreen ? { screen: state.prototypeScreen } : null };
    },
    send: (payload) => {
        if (state.status === "live") sendRaw(payload);
    },
    hz: () => presenceHz,
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
});
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.status === "live") presence.visible();
    });
}

// Something people see changed (pointer, selection, page, camera, call state…). `force` is kept for
// callers; every update goes through the same throttle (the next free slot is at most 50 ms away).
export function sendPresence(_force = false) {
    if (state.status !== "live") return;
    presence.changed();
}

export function setCursor(world: { x: number; y: number } | null) {
    cursor = world;
    sendPresence();
}

// Switching tabs to another file (a local draft, or a different shared file) leaves this file's
// room first, so edits made there never reach this file. That holds while the room is connecting
// or offline too: left joined, the room took the editor back when the server answered again,
// replacing the other file's document (and its saved copy) with this one.
let lastEditorFile = editor.get().fileId;
editor.subscribe(() => {
    const id = editor.get().fileId;
    if (id === lastEditorFile) return;
    lastEditorFile = id;
    // A file that is this room's (opened from its link, or its listing on Home) stays joined.
    if (id && state.fileId && state.status !== "local" && fileMeta(id) && fileMeta(id)?.shared !== state.fileId) leave();
});

// Selections and page changes are shared too.
let lastSelection: string[] = [];
let lastPage = "";
let lastCamera = editor.get().camera;
editor.subscribe(() => {
    const s = editor.get();
    if (s.selection !== lastSelection || s.pageId !== lastPage) {
        lastSelection = s.selection;
        lastPage = s.pageId;
        sendPresence(true);
    } else if (s.camera !== lastCamera) {
        // Panning and zooming are shared (throttled) so people can follow you.
        lastCamera = s.camera;
        sendPresence();
    }
});

// Your cursor on the canvas (world coordinates), for cursor chat.
export function myCursor() {
    return cursor;
}

// Version history moved to the right sidebar; an old left-panel choice falls back to Layers.
if ((editor.get().prefs.leftPanel as string) === "history") editor.setPrefs({ leftPanel: "layers" });

// Opening a link with ?file=…&key=… joins that file.
const params = new URL(location.href).searchParams;
const fromUrl = params.get("file");
// A link to a file on another server (?server=…) waits for the offer to switch to it
// (components/server-picker.tsx ServerLinkPrompt).
if (fromUrl && /^[A-Za-z0-9_-]{6,64}$/.test(fromUrl) && !linkedServer()) join(fromUrl, undefined, params.get("key"));

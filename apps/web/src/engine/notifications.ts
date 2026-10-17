import { useSyncExternalStore } from "react";
import { accountView, type NoticeKind } from "./account";
import { auth, authHeaders } from "./auth";
import type { FileKind } from "./files";
import { httpBase } from "./server-url";
import { userStorage } from "./user-storage";
import { withServer } from "./servers";

// Home's bell: comments that mention you, replies in threads you're part of, new comments on your
// files, @mentions on boards, designs marked ready for dev or completed, invitations to files,
// folders and teams, and requests to answer, across everything you can open on the server. What
// you've read is kept with the account. New ones can also show as desktop notifications (the
// browser's, or the desktop app's own through its bridge), for the kinds your settings allow.

export interface Notice {
    id: string;
    // Notices about a team (invites, seat requests) have no file.
    fileId: string;
    fileName: string;
    kind: FileKind;
    key: string | null;
    // Comment notices point at their thread; status notices and board mentions at the layer.
    threadId: string | null;
    nodeId?: string | null;
    author: { name: string; color: string };
    text: string;
    at: number;
    why:
        | "mention"
        | "reply"
        | "comment"
        | "ready"
        | "completed"
        | "invite"
        | "access-request"
        | "access-granted"
        | "access-denied"
        | "review-request"
        | "review"
        | "asset-review-request"
        | "asset-review"
        | "team-invite"
        | "folder-invite"
        | "folder-connected"
        | "team-request"
        | "team-request-approved"
        | "team-request-denied"
        | "seat-changed";
    resolved: boolean;
    // An access request to answer (and how it was answered).
    request?: { id: string; role: "edit" | "view" | "prototype"; status: "pending" | "approved" | "denied"; decidedBy: { name: string } | null };
    // A seat, credit or access request on a team, for its admins.
    teamRequest?: { teamId: string; id: string; kind: "seat" | "credits" | "access"; seat: string; status: "pending" | "approved" | "denied" };
    teamId?: string;
    // Branch reviews: the branch the notice is about.
    branchId?: string | null;
}

export type NoticeFilter = "all" | "mentions" | "invites" | "requests";

export function noticeCategory(n: Notice): Exclude<NoticeFilter, "all"> | null {
    if (n.why === "mention") return "mentions";
    if (n.why === "invite" || n.why === "team-invite" || n.why === "folder-invite" || n.why === "folder-connected") return "invites";
    if (n.why === "access-request" || n.why === "team-request" || n.why === "review-request" || n.why === "asset-review-request") return "requests";
    return null;
}

// Which notification setting covers a notice.
export function noticeKind(n: Notice): NoticeKind {
    if (n.why === "mention") return "mentions";
    if (n.why === "reply" || n.why === "comment") return "comments";
    if (n.why === "ready" || n.why === "completed") return "devStatus";
    if (n.why === "review" || n.why === "review-request" || n.why === "asset-review" || n.why === "asset-review-request") return "reviews";
    if (noticeCategory(n) === "invites") return "invites";
    return "requests";
}

// Approves or denies someone's request for access to a file.
export async function answerRequest(fileId: string, requestId: string, approve: boolean): Promise<string | null> {
    try {
        const res = await fetch(`${httpBase()}/files/${fileId}/requests/${requestId}`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ approve }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return res.ok ? null : (data.error ?? "The server refused that.");
    } catch {
        return "The server can't be reached.";
    }
}

// Approves or denies a team member's seat, credit or access request (team admins).
export async function answerTeamRequest(teamId: string, requestId: string, approve: boolean): Promise<string | null> {
    try {
        const res = await fetch(`${httpBase()}/teams/${teamId}/admin/decide`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ id: requestId, approve }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return res.ok ? null : (data.error ?? "The server refused that.");
    } catch {
        return "The server can't be reached.";
    }
}

// Replies to the comment thread a notice is about, without opening the file.
export async function replyToNotice(n: Notice, text: string): Promise<string | null> {
    try {
        const res = await fetch(`${httpBase()}/notifications/reply`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ fileId: n.fileId, threadId: n.threadId, text }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return res.ok ? null : (data.error ?? "The reply wasn't sent.");
    } catch {
        return "The server can't be reached.";
    }
}

// What the bell says a notice is about, around the author and file names.
export function noticeVerb(n: Notice): [string, string] {
    switch (n.why) {
        case "mention":
            return [n.threadId ? "mentioned you in" : "mentioned you on", ""];
        case "reply":
            return ["replied in", ""];
        case "comment":
            return ["commented on", ""];
        case "ready":
            return ["marked a design ready for dev in", ""];
        case "completed":
            return ["completed a design in", ""];
        case "invite":
            return ["shared", "with you"];
        case "access-request":
            return [n.request?.role === "edit" ? "asks to edit" : "asks for access to", ""];
        case "access-granted":
            return ["gave you access to", ""];
        case "access-denied":
            return ["declined your request for", ""];
        case "review-request":
            return ["asked you to review a branch of", ""];
        case "review":
            return [/suggest/i.test(n.text) ? "suggested changes on a branch of" : "approved a branch of", ""];
        case "asset-review-request":
            return ["asked you to review assets in", ""];
        case "asset-review":
            return [/^Requested changes/.test(n.text) ? "requested changes to an asset in" : "approved an asset in", ""];
        case "team-invite":
            return ["added you to the team", ""];
        case "folder-invite":
            return ["shared the folder", "with you"];
        case "folder-connected":
            return ["connected the folder", ""];
        case "team-request":
            return ["sent a request in", ""];
        case "team-request-approved":
            return ["approved your request in", ""];
        case "team-request-denied":
            return ["declined your request in", ""];
        case "seat-changed":
            return ["changed your seat in", ""];
    }
}

export async function fetchNotices(): Promise<Notice[]> {
    try {
        const res = await fetch(`${httpBase()}/notifications`, { headers: authHeaders() });
        if (!res.ok) return [];
        return (await res.json()) as Notice[];
    } catch {
        return [];
    }
}

// ---- The inbox: the newest notices and what's been read, shared by the bell and the desktop app ----

interface Inbox {
    list: Notice[];
    readAt: number;
    read: string[];
    loaded: boolean;
}
let inbox: Inbox = { list: [], readAt: 0, read: [], loaded: false };
const listeners = new Set<() => void>();
const setInbox = (patch: Partial<Inbox>) => {
    inbox = { ...inbox, ...patch };
    for (const l of listeners) l();
};
export function subscribeInbox(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function useInbox(): Inbox {
    return useSyncExternalStore(subscribeInbox, () => inbox);
}
export const inboxState = () => inbox;
export const isUnread = (n: Notice, state: Pick<Inbox, "readAt" | "read"> = inbox) => n.at > state.readAt && !state.read.includes(n.id);

export async function refreshNotices(): Promise<void> {
    if (!auth.get().user) return setInbox({ list: [], readAt: 0, read: [], loaded: true });
    const [list, state] = await Promise.all([
        fetchNotices(),
        fetch(`${httpBase()}/notifications/state`, { headers: authHeaders() })
            .then((r) => (r.ok ? (r.json() as Promise<{ readAt: number; read: string[] }>) : null))
            .catch(() => null),
    ]);
    setInbox({ list, readAt: state?.readAt ?? inbox.readAt, read: state?.read ?? inbox.read, loaded: true });
    pushDesktop(list);
}

async function postRead(body: { ids?: string[] }) {
    try {
        const res = await fetch(`${httpBase()}/notifications/read`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
        if (res.ok) setInbox((await res.json()) as { readAt: number; read: string[] });
    } catch {
        // Unread dots come back next time.
    }
}
export function markAllRead() {
    setInbox({ readAt: Date.now(), read: [] });
    void postRead({});
}
export function markRead(ids: string[]) {
    const fresh = ids.filter((id) => !inbox.read.includes(id));
    if (!fresh.length) return;
    setInbox({ read: [...inbox.read, ...fresh] });
    void postRead({ ids: fresh });
}

// ---- Desktop notifications ----

export type PushPermission = NotificationPermission | "unsupported" | "app";
type Bridge = { notify?: (n: { title: string; text: string; url: string }) => void };
const bridge = (window as unknown as { nagmaDesktop?: Bridge }).nagmaDesktop;

export function pushPermission(): PushPermission {
    if (bridge?.notify) return "app";
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
export async function askPushPermission(): Promise<PushPermission> {
    if (bridge?.notify || typeof Notification === "undefined") return pushPermission();
    return await Notification.requestPermission();
}

// The address that opens a notice's file (and its comment).
export function noticeUrl(n: Notice): string {
    const url = new URL(location.origin + location.pathname);
    if (n.fileId) url.searchParams.set("file", n.fileId);
    if (n.key) url.searchParams.set("key", n.key);
    if (n.threadId) url.searchParams.set("comment", n.threadId);
    return withServer(url).toString();
}
export const noticeTitle = (n: Notice) => {
    const [verb, after] = noticeVerb(n);
    return `${n.author.name} ${verb} ${n.fileName}${after ? ` ${after}` : ""}`;
};

const PUSHED_KEY = "nagma.notifications.pushed.v1";
function pushDesktop(list: Notice[]) {
    const permission = pushPermission();
    if (permission !== "granted" && permission !== "app") return;
    let since = 0;
    try {
        since = Number(userStorage.getItem(PUSHED_KEY) ?? 0) || 0;
        // The first look after turning them on only sets the mark: nothing old pops up.
        userStorage.setItem(PUSHED_KEY, String(Math.max(since, ...list.map((n) => n.at))));
    } catch {
        return;
    }
    if (!since) return;
    const prefs = accountView()?.notify;
    for (const n of list.filter((x) => x.at > since && isUnread(x)).slice(0, 5)) {
        if (prefs && prefs[noticeKind(n)]?.desktop === false) continue;
        const note = { title: noticeTitle(n), text: n.text.slice(0, 200), url: noticeUrl(n) };
        if (bridge?.notify) bridge.notify(note);
        else {
            const shown = new Notification(note.title, { body: note.text, tag: n.id });
            shown.onclick = () => {
                window.focus();
                location.href = note.url;
            };
        }
    }
}

// Checked every minute while signed in, wherever you are in the app.
window.setInterval(() => void refreshNotices(), 60_000);
auth.onChange(() => void refreshNotices());
void refreshNotices();

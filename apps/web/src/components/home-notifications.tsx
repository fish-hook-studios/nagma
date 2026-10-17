import { Bell01, Settings01 } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { openAccountSettings } from "../engine/account";
import { leaveServerFile, refreshServerFiles } from "../engine/files";
import { type Notice, type NoticeFilter, answerRequest, answerTeamRequest, isUnread, markAllRead, markRead, noticeCategory, noticeVerb, refreshNotices, replyToNotice, useInbox } from "../engine/notifications";
import { editor } from "../engine/store";
import { refreshTeams } from "../engine/teams";
import { Avatar } from "./avatar";

// The bell on Home and in the admin console: the 50 newest notifications, filtered to mentions,
// invites or requests, with their actions right here (approve or deny a request, reply to a comment,
// open or decline an invitation), Mark all as read, and a way to the notification settings.

function ago(t: number): string {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const FILTERS: [NoticeFilter, string][] = [
    ["all", "All"],
    ["mentions", "Mentions"],
    ["invites", "Invites"],
    ["requests", "Requests"],
];

export function NotificationsButton({ signedIn, onOpen }: { signedIn: boolean; onOpen: (n: Notice) => void }) {
    const inbox = useInbox();
    const [filter, setFilter] = useState<NoticeFilter>("all");
    const list = signedIn ? inbox.list : [];
    const unread = list.filter((n) => isUnread(n, inbox)).length;
    const shown = list.filter((n) => filter === "all" || noticeCategory(n) === filter);
    return (
        <AriaDialogTrigger onOpenChange={(o) => o && void refreshNotices()}>
            <AriaButton aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} className="relative flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Bell01 className="size-4 text-ink" />
                {unread > 0 && <span className="absolute top-[3px] right-[3px] size-[7px] rounded-full bg-[#f24822] ring-2 ring-panel" />}
            </AriaButton>
            <AriaPopover placement="bottom start" offset={6} className="w-[380px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="Notifications" className="outline-none">
                    {({ close }) => (
                        <>
                            <div className="flex h-11 items-center gap-1 border-b border-panel-border pr-2 pl-3">
                                <span className="flex-1 text-[12.5px] font-semibold">Notifications</span>
                                {signedIn && (
                                    <button type="button" disabled={!unread} onClick={markAllRead} className="h-6 rounded px-2 text-[11.5px] text-link outline-none hover:bg-panel-hover disabled:text-ink-subtle disabled:hover:bg-transparent">
                                        Mark all as read
                                    </button>
                                )}
                                {signedIn && (
                                    <button
                                        type="button"
                                        aria-label="Notification settings"
                                        title="Notification settings"
                                        onClick={() => {
                                            close();
                                            openAccountSettings("notifications");
                                        }}
                                        className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                                    >
                                        <Settings01 className="size-3.5" />
                                    </button>
                                )}
                            </div>
                            {signedIn && (
                                <div role="tablist" aria-label="Show" className="flex gap-1 border-b border-panel-border px-2 py-1.5">
                                    {FILTERS.map(([id, label]) => {
                                        const count = id === "all" ? 0 : list.filter((n) => noticeCategory(n) === id && isUnread(n, inbox)).length;
                                        return (
                                            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`h-6 rounded-[5px] px-2 text-[11.5px] outline-none ${filter === id ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
                                                {label}
                                                {count > 0 && <span className="ml-1 text-ink-subtle">{count}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="max-h-[440px] overflow-y-auto p-1">
                                {!signedIn && <p className="p-3 text-ink-muted">Sign in to get notified about mentions, replies, invites, requests and dev statuses.</p>}
                                {signedIn && shown.length === 0 && <p className="p-3 text-ink-muted">{filter === "all" ? "Nothing yet. Mentions, replies, invites, requests and dev statuses show up here." : `No ${filter} yet.`}</p>}
                                {shown.map((n) => (
                                    <NoticeRow
                                        key={n.id}
                                        n={n}
                                        unread={isUnread(n, inbox)}
                                        onOpen={() => {
                                            markRead([n.id]);
                                            close();
                                            onOpen(n);
                                        }}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function NoticeRow({ n, unread, onOpen }: { n: Notice; unread: boolean; onOpen: () => void }) {
    const [replying, setReplying] = useState(false);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [verb, after] = noticeVerb(n);
    const done = (error: string | null) => {
        if (error) editor.notify(error);
        markRead([n.id]);
        void refreshNotices();
    };
    const answer = (approve: boolean) => {
        if (n.request) void answerRequest(n.fileId, n.request.id, approve).then(done);
        else if (n.teamRequest) void answerTeamRequest(n.teamRequest.teamId, n.teamRequest.id, approve).then(done);
    };
    const pending = n.request?.status === "pending" || n.teamRequest?.status === "pending";
    const status = n.request?.status ?? n.teamRequest?.status;
    const opens = Boolean(n.fileId) && n.why !== "access-denied";
    const canReply = Boolean(n.threadId) && (n.why === "mention" || n.why === "reply" || n.why === "comment");
    return (
        <div className={`rounded-md p-2 hover:bg-panel-hover ${unread ? "bg-brand-500/5" : ""}`}>
            <div className="flex items-start gap-2">
                <Avatar name={n.author.name} color={n.author.color} size={24} />
                <button type="button" disabled={!opens} onClick={onOpen} className="min-w-0 flex-1 text-left">
                    <span className="block text-[11.5px] leading-[16px]">
                        <b>{n.author.name}</b> {verb} <b>{n.fileName}</b>
                        {after ? ` ${after}` : ""}
                    </span>
                    {n.text && <span className="mt-0.5 line-clamp-2 block text-ink-muted [overflow-wrap:anywhere]">{n.why === "ready" || n.why === "completed" ? n.text.replace(/^[^"]*(?=")/, "").trim() || n.text : n.text}</span>}
                    <span className="mt-0.5 block text-[10.5px] text-ink-subtle">{ago(n.at)}</span>
                </button>
                {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                {pending && (
                    <>
                        <button type="button" onClick={() => answer(true)} className="h-6 rounded bg-brand-500 px-2 text-[11px] font-semibold text-white hover:bg-brand-600">
                            Approve
                        </button>
                        <button type="button" onClick={() => answer(false)} className="h-6 rounded border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                            Deny
                        </button>
                    </>
                )}
                {!pending && status && <span className="text-[11px] text-ink-subtle">{status === "approved" ? "Approved" : "Denied"}</span>}
                {n.why === "invite" && (
                    <>
                        <button type="button" onClick={onOpen} className="h-6 rounded bg-brand-500 px-2 text-[11px] font-semibold text-white hover:bg-brand-600">
                            Open file
                        </button>
                        <button type="button" onClick={() => void leaveServerFile(n.fileId).then(() => (refreshServerFiles(), done(null)), (e: unknown) => done(e instanceof Error ? e.message : String(e)))} className="h-6 rounded border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                            Decline
                        </button>
                    </>
                )}
                {(n.why === "team-invite" || n.why === "folder-invite" || n.why === "folder-connected") && (
                    <button type="button" onClick={() => void refreshTeams().then(() => done(null))} className="h-6 rounded border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                        Show in sidebar
                    </button>
                )}
                {canReply && !replying && (
                    <button type="button" onClick={() => setReplying(true)} className="h-6 rounded border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                        Reply
                    </button>
                )}
            </div>
            {replying && (
                <form
                    className="mt-1.5 flex gap-1 pl-8"
                    onKeyDown={(e) => e.stopPropagation()}
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!text.trim()) return;
                        setBusy(true);
                        void replyToNotice(n, text.trim()).then((error) => {
                            setBusy(false);
                            if (error) return editor.notify(error);
                            setText("");
                            setReplying(false);
                            editor.notify(`Reply sent in ${n.fileName}.`);
                            done(null);
                        });
                    }}
                >
                    <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" aria-label={`Reply to ${n.author.name}`} className="h-7 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-2 text-[11.5px] outline-none focus:border-brand-500" />
                    <button type="submit" disabled={busy || !text.trim()} className="h-7 rounded-md bg-brand-500 px-2 text-[11px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                        Send
                    </button>
                </form>
            )}
        </div>
    );
}

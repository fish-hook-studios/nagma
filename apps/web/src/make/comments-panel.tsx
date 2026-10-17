import { Check, X } from "@untitledui/icons";
import { useState } from "react";
import { Avatar } from "../components/avatar";
import { MentionInput } from "../components/comments-ui";
import { collab, useCollab } from "../engine/collab";
import { addComment, isUnread, markRead, myUid, replyTo, setResolved, startDraft, timeAgo, type Comment } from "../engine/comments";
import { editor, useEditor } from "../engine/store";
import { makePage } from "./model";
import { make } from "./state";

// Comments on a Make file: the file's comment threads (the same ones every file has, synced the
// same way), written from a box at the top since there's no canvas to pin them to.

function Thread({ c }: { c: Comment }) {
    const reads = useCollab((s) => s.reads);
    const [open, setOpen] = useState(false);
    const unread = isUnread(c, reads, myUid());
    return (
        <div className="border-b border-panel-border px-3 py-2.5 text-[11.5px]">
            {[c, ...(open ? c.replies : [])].map((m, i) => (
                <div key={m.id} className={`flex gap-2 ${i ? "mt-2" : ""}`}>
                    <Avatar name={m.author.name || "Guest"} color={m.author.color} size={20} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className={`truncate ${unread && !i ? "font-semibold" : "font-medium"} text-ink`}>{m.author.name || "Guest"}</span>
                            <span className="shrink-0 text-ink-subtle">{timeAgo(m.createdAt)}</span>
                            {!i && (
                                <button type="button" aria-label={c.resolved ? "Reopen thread" : "Resolve thread"} title={c.resolved ? "Reopen" : "Resolve"} onClick={() => setResolved(c.id, !c.resolved)} className={`ml-auto flex size-5 items-center justify-center rounded ${c.resolved ? "text-emerald-500" : "text-ink-subtle hover:text-ink"}`}>
                                    <Check className="size-3.5" />
                                </button>
                            )}
                        </div>
                        <div className="mt-0.5 break-words whitespace-pre-wrap text-ink">{m.text}</div>
                    </div>
                </div>
            ))}
            {open ? (
                <div className="mt-2">
                    <MentionInput placeholder="Reply" submitLabel="Reply" onSubmit={(text, mentions, attachments) => replyTo(c.id, text, mentions, attachments)} onCancel={() => setOpen(false)} />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => {
                        setOpen(true);
                        markRead(c.id);
                    }}
                    className="mt-1.5 ml-7 text-ink-muted hover:text-ink"
                >
                    {c.replies.length ? (c.replies.length === 1 ? "1 reply" : `${c.replies.length} replies`) : "Reply"}
                </button>
            )}
        </div>
    );
}

export function MakeComments() {
    const comments = useCollab((s) => s.comments);
    const pageId = useEditor((s) => makePage(s.doc)?.id ?? s.pageId);
    const reads = useCollab((s) => s.reads);
    const [filter, setFilter] = useState<"open" | "resolved" | "all" | "mine" | "pinned">("open");
    const [sort, setSort] = useState<"newest" | "oldest" | "unread">("newest");
    const me = myUid();
    const last = (c: Comment) => Math.max(c.createdAt, ...c.replies.map((r) => r.createdAt));
    const list = comments
        .filter((c) => (filter === "open" ? !c.resolved : filter === "resolved" ? c.resolved : filter === "mine" ? c.author.uid === me || c.replies.some((r) => r.author.uid === me) : filter === "pinned" ? c.x !== 0 || c.y !== 0 : true))
        .sort((a, b) => (sort === "oldest" ? a.createdAt - b.createdAt : sort === "unread" ? Number(isUnread(b, reads, me)) - Number(isUnread(a, reads, me)) || last(b) - last(a) : last(b) - last(a)));
    return (
        <aside className="flex h-full w-72 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
            <header className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border px-3">
                <span className="flex-1 text-[12px] font-semibold text-ink">Comments</span>
                <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as "open")} className="h-6 rounded bg-field px-1 text-[11px] text-ink outline-none">
                    <option value="open">Open</option>
                    <option value="resolved">Resolved</option>
                    <option value="mine">Mine</option>
                    <option value="pinned">On the preview</option>
                    <option value="all">All</option>
                </select>
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "newest")} className="h-6 rounded bg-field px-1 text-[11px] text-ink outline-none">
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="unread">Unread first</option>
                </select>
                <button type="button" aria-label="Close comments" onClick={() => make.set({ side: null })} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <X className="size-3.5" />
                </button>
            </header>
            <div className="border-b border-panel-border p-2">
                <MentionInput
                    placeholder="Add a comment"
                    submitLabel="Post"
                    onSubmit={(text, mentions, attachments) => {
                        startDraft(pageId, 0, 0);
                        if (!addComment(text, mentions, attachments)) {
                            collab.set({ draft: null });
                            editor.notify("Couldn't post that comment.");
                        }
                    }}
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {list.length === 0 && <div className="px-4 py-6 text-center leading-relaxed text-ink-muted">{comments.length ? "No comments match." : "No comments yet. Use the comment tool above the preview, or press F6, to pin one to the app."}</div>}
                {list.map((c) => (
                    <Thread key={c.id} c={c} />
                ))}
            </div>
        </aside>
    );
}

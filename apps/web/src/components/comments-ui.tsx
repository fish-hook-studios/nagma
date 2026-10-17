import { Attachment01, Check, Dotpoints01, DotsHorizontal, FaceSmile, FilterLines, List, MessageCircle01, SearchSm, Strikethrough01, X } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { screenToWorld, viewport, worldToScreen } from "../engine/camera";
import { TOOLBAR_SPACE, popupLeft, popupTop } from "../engine/comment-popup";
import { collab, useCollab } from "../engine/collab";
import {
    type Attachment,
    type Comment,
    type CommentMessage,
    type Person,
    addComment,
    attachImage,
    commentBlocks,
    commentPageId,
    continueList,
    deleteMessage,
    goToComment,
    timeAgo,
    editMessage,
    isUnread,
    markAllRead,
    markRead,
    mentionsIn,
    mentionsMe,
    moveComment,
    myUid,
    pinPoint,
    react,
    regionBox,
    replyTo,
    setResolved,
    strikeRuns,
    toggleList,
    toggleStrike,
    type Edit,
} from "../engine/comments";
import { type Gif, STICKERS, gifFile, searchGifs, stickerFile, stickerUrl } from "../engine/stickers";
import { loadMedia } from "../engine/media";
import { usePeople } from "../engine/people";
import { editor, useEditor } from "../engine/store";
import { Avatar } from "./avatar";
import { DarkMenu } from "./collab-menu";
import { PresenceBar, PresentButton, ShareButton } from "./collab-ui";
import { ZoomMenu } from "./zoom-menu";

const EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🎉", "👀", "✅", "🔥", "🙏", "👏", "💯", "🤔", "😍", "🚀", "👎"];

// Who may do what to a message (the server checks again).
function canChange(m: CommentMessage): { edit: boolean; remove: boolean } {
    const s = collab.get();
    const mine = Boolean(m.author.uid && m.author.uid === myUid());
    const editor = s.status === "local" || s.role === "edit";
    return { edit: mine, remove: mine || editor };
}

// ---- Attachments ----

function useMediaUrl(id: string): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        let made: string | null = null;
        void loadMedia(id).then((blob) => {
            if (!blob || !live) return;
            made = URL.createObjectURL(blob);
            setUrl(made);
        });
        return () => {
            live = false;
            if (made) URL.revokeObjectURL(made);
        };
    }, [id]);
    return url;
}

function AttachmentThumb({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
    const url = useMediaUrl(a.id);
    return (
        <span className="relative inline-block">
            <a href={url ?? undefined} target="_blank" rel="noreferrer" title={a.name} className="block size-14 overflow-hidden rounded-md border border-panel-border bg-field bg-cover bg-center" style={url ? { backgroundImage: `url(${url})` } : undefined}>
                <span className="sr-only">{a.name}</span>
            </a>
            {onRemove && (
                <button type="button" aria-label="Remove attachment" onClick={onRemove} className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-tooltip text-white">
                    <X className="size-2.5" />
                </button>
            )}
        </span>
    );
}

// ---- Writing: a text box with @mention suggestions and image attachments ----

export function MentionInput({
    initial = "",
    placeholder,
    submitLabel,
    autoFocus,
    allowAttach = true,
    onSubmit,
    onCancel,
}: {
    initial?: string;
    placeholder: string;
    submitLabel: string;
    autoFocus?: boolean;
    allowAttach?: boolean;
    onSubmit: (text: string, mentions: string[], attachments: Attachment[]) => void;
    onCancel?: () => void;
}) {
    const [text, setText] = useState(initial);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
    const [active, setActive] = useState(0);
    const area = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const people = usePeople();
    // The canvas takes focus on pointer up, so focus once the click has finished.
    useEffect(() => {
        if (!autoFocus) return;
        const t = window.setTimeout(() => area.current?.focus(), 30);
        return () => window.clearTimeout(t);
    }, [autoFocus]);
    const matches = query ? people.filter((p) => p.name.toLowerCase().includes(query.text.toLowerCase()) || p.email?.toLowerCase().startsWith(query.text.toLowerCase())).slice(0, 6) : [];

    const findQuery = (value: string, caret: number) => {
        const before = value.slice(0, caret);
        const at = before.lastIndexOf("@");
        if (at < 0 || (at > 0 && !/\s/.test(before[at - 1] ?? ""))) return setQuery(null);
        const typed = before.slice(at + 1);
        if (/[\n@]/.test(typed) || typed.length > 30) return setQuery(null);
        setQuery({ start: at, text: typed });
        setActive(0);
    };
    const pick = (p: Person) => {
        if (!query) return;
        const caret = query.start + 1 + query.text.length;
        const next = `${text.slice(0, query.start)}@${p.name} ${text.slice(caret)}`;
        setText(next);
        setQuery(null);
        requestAnimationFrame(() => {
            const pos = query.start + p.name.length + 2;
            area.current?.focus();
            area.current?.setSelectionRange(pos, pos);
        });
    };
    // Applies a formatting change to the text and keeps the selection on it.
    const apply = (fn: (e: Edit) => Edit | null) => {
        const el = area.current;
        const next = fn({ text, start: el?.selectionStart ?? text.length, end: el?.selectionEnd ?? text.length });
        if (!next) return false;
        setText(next.text);
        requestAnimationFrame(() => {
            area.current?.focus();
            area.current?.setSelectionRange(next.start, next.end);
        });
        return true;
    };
    const submit = () => {
        if (busy || (!text.trim() && !attachments.length)) return;
        onSubmit(text, mentionsIn(text, people), attachments);
        setText("");
        setAttachments([]);
    };
    const attach = async (files: FileList | File[] | null) => {
        if (!files?.length) return;
        setBusy(true);
        try {
            const added: Attachment[] = [];
            for (const f of Array.from(files).slice(0, 10 - attachments.length)) {
                const a = await attachImage(f);
                if (a) added.push(a);
            }
            setAttachments((list) => [...list, ...added]);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="relative" onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), void attach(e.clipboardData.files))}>
            <textarea
                ref={area}
                autoFocus={autoFocus}
                value={text}
                rows={2}
                placeholder={placeholder}
                aria-label={placeholder}
                onChange={(e) => {
                    setText(e.target.value);
                    findQuery(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (matches.length && query) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                            return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            const p = matches[active];
                            if (p) pick(p);
                            return;
                        }
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setQuery(null);
                            return;
                        }
                    }
                    const mod = e.metaKey || e.ctrlKey;
                    // ⌘⇧X strikes through; ⌘⇧7 numbers, ⌘⇧8 bullets the lines; ⇧Enter continues a list.
                    if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
                        e.preventDefault();
                        apply(toggleStrike);
                        return;
                    }
                    if (mod && e.shiftKey && (e.code === "Digit7" || e.code === "Digit8")) {
                        e.preventDefault();
                        apply((x) => toggleList(x, e.code === "Digit7" ? "numbers" : "bullets"));
                        return;
                    }
                    if (e.key === "Enter" && e.shiftKey && apply(continueList)) {
                        e.preventDefault();
                        return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                    }
                    if (e.key === "Escape") onCancel?.();
                }}
                className="w-full resize-none rounded-md bg-field px-2 py-1.5 text-[12px] text-ink outline-none focus:ring-1 focus:ring-brand-500"
            />
            {matches.length > 0 && query && (
                <div role="listbox" aria-label="People to mention" className="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl">
                    {matches.map((p, i) => (
                        <button
                            key={p.uid}
                            type="button"
                            role="option"
                            aria-selected={i === active}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                pick(p);
                            }}
                            className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] ${i === active ? "bg-brand-500" : "hover:bg-white/10"}`}
                        >
                            {p.group ? <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px]">@</span> : <Avatar name={p.name} color={p.color} size={18} />}
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            {p.group ? <span className="truncate text-white/50">{p.count ?? 0} {p.count === 1 ? "person" : "people"}</span> : p.email && <span className="truncate text-white/50">{p.email}</span>}
                        </button>
                    ))}
                </div>
            )}
            {attachments.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {attachments.map((a) => (
                        <AttachmentThumb key={a.id} a={a} onRemove={() => setAttachments((list) => list.filter((x) => x.id !== a.id))} />
                    ))}
                </div>
            )}
            <div className="mt-1.5 flex items-center gap-1">
                <button type="button" title="Mention someone" aria-label="Mention someone" onClick={() => {
                    const next = `${text}${text && !text.endsWith(" ") ? " " : ""}@`;
                    setText(next);
                    setQuery({ start: next.length - 1, text: "" });
                    area.current?.focus();
                }} className="flex size-6 items-center justify-center rounded text-[13px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                    @
                </button>
                <button type="button" title="Strikethrough (⌘⇧X)" aria-label="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(toggleStrike)} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Strikethrough01 className="size-3.5" />
                </button>
                <button type="button" title="Bulleted list (⌘⇧8)" aria-label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((x) => toggleList(x, "bullets"))} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Dotpoints01 className="size-3.5" />
                </button>
                <button type="button" title="Numbered list (⌘⇧7)" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((x) => toggleList(x, "numbers"))} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <List className="size-3.5" />
                </button>
                {allowAttach && (
                    <>
                        <GifPicker disabled={busy || attachments.length >= 10} onPick={(file) => void attach([file])} />
                        <button type="button" title="Attach an image" aria-label="Attach an image" onClick={() => fileInput.current?.click()} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Attachment01 className="size-3.5" />
                        </button>
                        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => {
                            void attach(e.target.files);
                            e.target.value = "";
                        }} />
                    </>
                )}
                <div className="flex-1" />
                {onCancel && (
                    <button type="button" onClick={onCancel} className="h-6 rounded-md px-2 text-[11px] text-ink-muted hover:bg-panel-hover">
                        Cancel
                    </button>
                )}
                <button type="button" disabled={busy || (!text.trim() && !attachments.length)} onClick={submit} className="h-6 rounded-md bg-brand-500 px-2.5 text-[11px] font-semibold text-white disabled:opacity-40">
                    {busy ? "Uploading" : submitLabel}
                </button>
            </div>
        </div>
    );
}

// A run of message text with @mentions picked out and ~~struck~~ parts struck through.
function Inline({ text, people }: { text: string; people: Person[] }) {
    const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
    const pattern = names.length ? new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g") : null;
    return (
        <>
            {strikeRuns(text).map((run, r) => {
                const parts = pattern ? run.text.split(pattern) : [run.text];
                const inner = parts.map((part, i) =>
                    i % 2 === 1 ? (
                        <span key={i} className="rounded bg-brand-100 px-0.5 font-medium text-brand-500">
                            {part}
                        </span>
                    ) : (
                        <span key={i}>{part}</span>
                    ),
                );
                return run.strike ? <s key={r}>{inner}</s> : <span key={r}>{inner}</span>;
            })}
        </>
    );
}

// Message text: paragraphs and bulleted or numbered lists.
function RichText({ text, people, inline }: { text: string; people: Person[]; inline?: boolean }) {
    if (inline) return <Inline text={text.replace(/^\s*[-*] /gm, "• ")} people={people} />;
    return (
        <>
            {commentBlocks(text).map((b, i) =>
                b.kind === "text" ? (
                    <span key={i} className="block">
                        <Inline text={b.text} people={people} />
                    </span>
                ) : b.kind === "bullets" ? (
                    <ul key={i} className="my-0.5 list-disc pl-4">
                        {b.items.map((item, j) => (
                            <li key={j}>
                                <Inline text={item} people={people} />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <ol key={i} start={b.start} className="my-0.5 list-decimal pl-4">
                        {b.items.map((item, j) => (
                            <li key={j}>
                                <Inline text={item} people={people} />
                            </li>
                        ))}
                    </ol>
                ),
            )}
        </>
    );
}

// GIFs (with a provider key on the server) and the built-in animated stickers.
function GifPicker({ onPick, disabled }: { onPick: (file: File) => void; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [gifs, setGifs] = useState<Gif[] | null>(null);
    const [provider, setProvider] = useState<boolean | null>(null);
    useEffect(() => {
        if (!open) return;
        let live = true;
        const t = window.setTimeout(() => {
            void searchGifs(query).then((list) => {
                if (!live) return;
                setProvider(list !== null);
                setGifs(list);
            });
        }, query ? 300 : 0);
        return () => {
            live = false;
            window.clearTimeout(t);
        };
    }, [open, query]);
    const pick = async (file: Promise<File>) => {
        setOpen(false);
        onPick(await file);
    };
    return (
        <span className="relative">
            <button type="button" title="GIFs and stickers" aria-label="GIFs and stickers" disabled={disabled} onClick={() => setOpen((v) => !v)} className={`flex h-6 items-center justify-center rounded px-1 text-[10px] font-bold hover:bg-panel-hover hover:text-ink disabled:opacity-40 ${open ? "text-ink" : "text-ink-muted"}`}>
                GIF
            </button>
            {open && (
                <div className="absolute bottom-7 left-0 z-30 w-64 rounded-lg border border-panel-border bg-panel-raised p-2 shadow-xl" onKeyDown={(e) => e.stopPropagation()}>
                    {provider && <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search GIFs" aria-label="Search GIFs" className="mb-2 h-7 w-full rounded-md bg-field px-2 text-[11px] text-ink outline-none focus:ring-1 focus:ring-brand-500" />}
                    <div className="max-h-56 overflow-y-auto">
                        {provider && gifs && gifs.length > 0 && (
                            <div className="mb-2 grid grid-cols-3 gap-1">
                                {gifs.map((g) => (
                                    <button key={g.id} type="button" title={g.title} onClick={() => void pick(gifFile(g))} className="aspect-square overflow-hidden rounded bg-field">
                                        <img src={g.preview} alt={g.title} className="size-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                        {provider && gifs?.length === 0 && <p className="mb-2 text-[11px] text-ink-muted">No GIFs found.</p>}
                        <div className="mb-1 text-[10px] font-semibold text-ink-subtle uppercase">Stickers</div>
                        <div className="grid grid-cols-4 gap-1">
                            {STICKERS.map((st) => (
                                <button key={st.id} type="button" title={st.name} aria-label={st.name} onClick={() => void pick(stickerFile(st))} className="aspect-square rounded p-1 hover:bg-panel-hover">
                                    <img src={stickerUrl(st)} alt="" className="size-full" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </span>
    );
}

function Reactions({ thread, m }: { thread: Comment; m: CommentMessage }) {
    const me = myUid();
    const entries = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length);
    if (!entries.length) return null;
    return (
        <div className="mt-1 flex flex-wrap gap-1">
            {entries.map(([emoji, who]) => {
                const mine = who.some((r) => r.uid === me);
                return (
                    <button
                        key={emoji}
                        type="button"
                        title={who.map((r) => r.name).join(", ")}
                        onClick={() => react(thread.id, m.id, emoji)}
                        className={`flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] ${mine ? "border-brand-500 bg-brand-100 text-brand-500" : "border-panel-border text-ink-muted hover:border-ink-subtle"}`}
                    >
                        <span>{emoji}</span>
                        <span>{who.length}</span>
                    </button>
                );
            })}
        </div>
    );
}

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="relative">
            <button type="button" title="Add reaction" aria-label="Add reaction" onClick={() => setOpen((v) => !v)} className="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                <FaceSmile className="size-3.5" />
            </button>
            {open && (
                <div className="absolute top-6 right-0 z-30 grid w-44 grid-cols-8 gap-0.5 rounded-lg bg-tooltip p-1.5 shadow-xl" onMouseLeave={() => setOpen(false)}>
                    {EMOJI.map((e) => (
                        <button
                            key={e}
                            type="button"
                            onClick={() => {
                                onPick(e);
                                setOpen(false);
                            }}
                            className="flex size-5 items-center justify-center rounded text-[13px] hover:bg-white/15"
                        >
                            {e}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
}

function Message({ thread, m, people }: { thread: Comment; m: CommentMessage; people: Person[] }) {
    const [editing, setEditing] = useState(false);
    const can = canChange(m);
    const isThread = m.id === thread.id;
    return (
        <div className="group flex gap-2">
            <Avatar name={m.author.name || "Guest"} color={m.author.color} size={22} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[11px]">
                    <span className="truncate font-semibold">{m.author.name || "Guest"}</span>
                    <span className="shrink-0 text-ink-subtle">{timeAgo(m.createdAt)}</span>
                    {m.editedAt && <span className="shrink-0 text-ink-subtle">(edited)</span>}
                    <span className="flex-1" />
                    <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <EmojiPicker onPick={(e) => react(thread.id, m.id, e)} />
                        {(can.edit || can.remove) && (
                            <DarkMenu
                                label="Comment actions"
                                trigger={<DotsHorizontal className="size-3.5" />}
                                className="flex size-5 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                                width="w-40"
                                items={[...(can.edit ? [{ id: "edit", label: "Edit" }] : []), ...(can.remove ? [{ id: "delete", label: isThread ? "Delete thread" : "Delete" }] : [])]}
                                onAction={(id) => (id === "edit" ? setEditing(true) : deleteMessage(thread.id, isThread ? undefined : m.id))}
                            />
                        )}
                    </span>
                </div>
                {editing ? (
                    <div className="mt-1">
                        <MentionInput
                            autoFocus
                            initial={m.text}
                            placeholder="Edit comment"
                            submitLabel="Save"
                            allowAttach={false}
                            onCancel={() => setEditing(false)}
                            onSubmit={(text, mentions) => {
                                editMessage(thread.id, m.id, text, mentions);
                                setEditing(false);
                            }}
                        />
                    </div>
                ) : (
                    m.text && (
                        <div className="text-[12px] leading-snug break-words whitespace-pre-wrap">
                            <RichText text={m.text} people={people} />
                        </div>
                    )
                )}
                {(m.attachments?.length ?? 0) > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {m.attachments?.map((a) => <AttachmentThumb key={a.id} a={a} />)}
                    </div>
                )}
                <Reactions thread={thread} m={m} />
            </div>
        </div>
    );
}

function copyCommentLink(c: Comment) {
    const url = new URL(location.href);
    url.searchParams.set("comment", c.id);
    void navigator.clipboard.writeText(url.toString()).then(
        () => editor.notify("Link to comment copied."),
        () => editor.notify("The browser didn't allow copying."),
    );
}

// An open thread: every message, reactions, and a reply box.
function Thread({ comment, at }: { comment: Comment; at: { x: number; y: number } }) {
    const end = useRef<HTMLDivElement>(null);
    const people = usePeople();
    useEffect(() => {
        end.current?.scrollIntoView({ block: "nearest" });
    }, [comment.replies.length]);
    const can = canChange(comment);
    return (
        <div
            className="pointer-events-auto absolute flex w-80 flex-col rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl"
            style={{ left: popupLeft(at.x, 320), top: popupTop(at.y - 30, 200), maxHeight: Math.max(200, Math.min(420, viewport.height - TOOLBAR_SPACE - popupTop(at.y - 30, 200))) }}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-panel-border px-3">
                <span className="text-[12px] font-semibold">Comment</span>
                <div className="flex items-center gap-0.5">
                    <DarkMenu
                        label="Thread actions"
                        trigger={<DotsHorizontal className="size-3.5" />}
                        width="w-44"
                        items={[{ id: "unread", label: "Mark as unread" }, { id: "link", label: "Copy link" }, ...(can.remove ? ["-" as const, { id: "delete", label: "Delete thread" }] : [])]}
                        onAction={(id) => {
                            if (id === "unread") {
                                markRead(comment.id, true);
                                collab.set({ openComment: null });
                            }
                            if (id === "link") copyCommentLink(comment);
                            if (id === "delete") deleteMessage(comment.id);
                        }}
                    />
                    <button type="button" title={comment.resolved ? "Reopen" : "Resolve"} aria-label={comment.resolved ? "Reopen" : "Resolve"} onClick={() => setResolved(comment.id, !comment.resolved)} className={`flex size-6 items-center justify-center rounded-md hover:bg-panel-hover ${comment.resolved ? "text-emerald-500" : "text-ink-muted"}`}>
                        <Check className="size-3.5" />
                    </button>
                    <button type="button" title="Close" aria-label="Close" onClick={() => collab.set({ openComment: null })} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover">
                        <X className="size-3.5" />
                    </button>
                </div>
            </div>
            {comment.resolved && <div className="border-b border-panel-border bg-field px-3 py-1.5 text-[11px] text-ink-muted">Resolved{comment.resolvedBy ? ` by ${comment.resolvedBy.name}` : ""}</div>}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {[comment, ...comment.replies].map((m) => (
                    <Message key={m.id} thread={comment} m={m} people={people} />
                ))}
                <div ref={end} />
            </div>
            <div className="shrink-0 border-t border-panel-border p-2">
                <MentionInput key={comment.id} autoFocus placeholder="Reply" submitLabel="Reply" onSubmit={(text, mentions, attachments) => replyTo(comment.id, text, mentions, attachments)} />
            </div>
        </div>
    );
}

function Composer({ at }: { at: { x: number; y: number } }) {
    return (
        <div className="pointer-events-auto absolute w-72 rounded-lg border border-panel-border bg-panel-raised p-2 shadow-xl" style={{ left: popupLeft(at.x, 288), top: popupTop(at.y - 8, 112) }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <MentionInput autoFocus placeholder="Add a comment" submitLabel="Post" onCancel={() => collab.set({ draft: null })} onSubmit={(text, mentions, attachments) => addComment(text, mentions, attachments)} />
        </div>
    );
}

// The threads the canvas shows: open ones, plus resolved ones when the sidebar asks for them.
function pinsFor(doc: ReturnType<typeof editor.get>["doc"], comments: Comment[], pageId: string, showResolved: boolean, open: string | null) {
    return comments.filter((c) => commentPageId(doc, c) === pageId && (!c.resolved || showResolved || c.id === open));
}

// A region comment's area on screen: shown while its thread is open or its pin is hovered.
function RegionBox({ box, camera, strong }: { box: { x: number; y: number; w: number; h: number }; camera: { x: number; y: number; zoom: number }; strong?: boolean }) {
    const a = worldToScreen(camera, box.x, box.y);
    return <span className={`absolute rounded-sm border-2 ${strong ? "border-brand-500 bg-brand-500/10" : "border-brand-500/70 bg-brand-500/5"}`} style={{ left: a.x, top: a.y, width: box.w * camera.zoom, height: box.h * camera.zoom }} />;
}

// Pins closer than this on screen gather into one numbered bubble (zoomed out, crowded areas).
const CLUSTER_PX = 26;

function clusterPins(pins: { c: Comment; at: { x: number; y: number } }[], keep: string | null) {
    const groups: { at: { x: number; y: number }; items: Comment[] }[] = [];
    for (const p of pins) {
        const near = p.c.id === keep ? undefined : groups.find((g) => !g.items.some((c) => c.id === keep) && Math.hypot(g.at.x - p.at.x, g.at.y - p.at.y) < CLUSTER_PX);
        if (near) {
            near.items.push(p.c);
            near.at = { x: (near.at.x * (near.items.length - 1) + p.at.x) / near.items.length, y: (near.at.y * (near.items.length - 1) + p.at.y) / near.items.length };
        } else groups.push({ at: p.at, items: [p.c] });
    }
    return groups;
}

// Several pins in one place: clicking zooms in until they come apart.
function Cluster({ items, at, unread }: { items: Comment[]; at: { x: number; y: number }; unread: boolean }) {
    const zoomIn = () => {
        const s = editor.get();
        const pts = items.map((c) => pinPoint(s.doc, c));
        const minX = Math.min(...pts.map((p) => p.x));
        const maxX = Math.max(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const host = { w: window.innerWidth * 0.5, h: window.innerHeight * 0.5 };
        const zoom = Math.min(8, Math.max(s.camera.zoom * 2, Math.min(host.w / Math.max(1, maxX - minX), host.h / Math.max(1, maxY - minY))));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        // The cluster stays where it is on screen while zooming in around it.
        editor.set({ camera: { ...s.camera, zoom, x: at.x - cx * zoom, y: at.y - cy * zoom } });
    };
    const authors = [...new Map(items.map((c) => [c.author.uid ?? c.author.name, c.author])).values()].slice(0, 2);
    return (
        <button
            type="button"
            aria-label={`${items.length} comments here. Zoom in to see them.`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={zoomIn}
            className="pointer-events-auto absolute flex -translate-y-full items-center gap-0.5 rounded-full rounded-bl-none border-2 border-white bg-white p-0.5 pr-1.5 shadow-lg transition-transform hover:scale-110"
            style={{ left: at.x, top: at.y }}
        >
            <span className="flex -space-x-2">
                {authors.map((a, i) => (
                    <Avatar key={i} name={a.name || "Guest"} color={a.color} size={22} />
                ))}
            </span>
            <span className="text-[11px] font-semibold text-neutral-800">{items.length}</span>
            {unread && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-brand-500" />}
        </button>
    );
}

function Pin({ c, doc, unread, onHover }: { c: Comment; doc: ReturnType<typeof editor.get>["doc"]; unread: boolean; onHover?: (on: boolean) => void }) {
    const camera = useEditor((s) => s.camera);
    const open = useCollab((s) => s.openComment);
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const world = pinPoint(doc, c);
    const p = drag ?? worldToScreen(camera, world.x, world.y);
    const count = 1 + c.replies.length;
    return (
        <button
            type="button"
            aria-label={`Comment by ${c.author.name}${unread ? ", unread" : ""}`}
            onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const start = { x: e.clientX, y: e.clientY };
                let moved = false;
                const allowed = canChange(c).remove;
                const onMove = (ev: PointerEvent) => {
                    if (!allowed) return;
                    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
                    moved = true;
                    setDrag({ x: ev.clientX - host.left, y: ev.clientY - host.top });
                };
                const onUp = (ev: PointerEvent) => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    setDrag(null);
                    if (moved) {
                        // Re-anchored where it was dropped, to the layer under it.
                        const w = screenToWorld(editor.get().camera, ev.clientX - host.left, ev.clientY - host.top);
                        moveComment(c.id, editor.get().pageId, w.x, w.y);
                        return;
                    }
                    if (open === c.id) collab.set({ openComment: null });
                    else {
                        collab.set({ openComment: c.id, draft: null });
                        markRead(c.id);
                    }
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
            }}
            onPointerEnter={() => onHover?.(true)}
            onPointerLeave={() => onHover?.(false)}
            className={`pointer-events-auto absolute flex -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 bg-white p-0.5 shadow-lg transition-transform hover:scale-110 ${open === c.id ? "border-brand-500" : "border-white"} ${drag ? "cursor-grabbing" : "cursor-pointer"}`}
            style={{ left: p.x, top: p.y }}
        >
            <span className={c.resolved ? "opacity-50 grayscale" : ""}>
                <Avatar name={c.author.name || "Guest"} color={c.author.color} size={22} />
            </span>
            {c.resolved && <Check className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-emerald-500 p-0.5 text-white" />}
            {unread && !c.resolved && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-brand-500" />}
            {count > 1 && <span className="sr-only">{count} messages</span>}
        </button>
    );
}

// Comment pins on the canvas, the composer for a new comment, and the open thread.
export function CommentLayer() {
    const comments = useCollab((s) => s.comments);
    const draft = useCollab((s) => s.draft);
    const open = useCollab((s) => s.openComment);
    const hidden = useCollab((s) => s.commentsHidden);
    const reads = useCollab((s) => s.reads);
    const showResolved = useCollab((s) => s.commentFilters.resolved);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const doc = useEditor((s) => s.doc);
    const presenting = useEditor((s) => s.presentingId !== null);
    const [hover, setHover] = useState<string | null>(null);
    if (presenting) return null;
    const me = myUid();
    const visible = hidden ? [] : pinsFor(doc, comments, pageId, showResolved, open);
    const openThread = open ? comments.find((c) => c.id === open && commentPageId(doc, c) === pageId) : undefined;
    const groups = clusterPins(
        visible.map((c) => {
            const w = pinPoint(doc, c);
            return { c, at: worldToScreen(camera, w.x, w.y) };
        }),
        open,
    );
    const shownRegion = [openThread, visible.find((c) => c.id === hover)].map((c) => (c ? regionBox(doc, c) : null));
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {shownRegion.map((box, i) => box && <RegionBox key={i} box={box} camera={camera} strong={i === 0} />)}
            {groups.map((g) =>
                g.items.length > 1 ? (
                    <Cluster key={g.items[0]?.id} items={g.items} at={g.at} unread={g.items.some((c) => isUnread(c, reads, me))} />
                ) : (
                    g.items[0] && <Pin key={g.items[0].id} c={g.items[0]} doc={doc} unread={isUnread(g.items[0], reads, me)} onHover={(on) => setHover(on ? (g.items[0]?.id ?? null) : null)} />
                ),
            )}
            {draft && draft.pageId === pageId && (
                <>
                    {draft.region && <RegionBox box={{ x: draft.x - draft.region.w, y: draft.y - draft.region.h, w: draft.region.w, h: draft.region.h }} camera={camera} strong />}
                    <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500 shadow" style={{ left: worldToScreen(camera, draft.x, draft.y).x, top: worldToScreen(camera, draft.x, draft.y).y }} />
                    {!draft.dragging && <Composer at={worldToScreen(camera, draft.x, draft.y)} />}
                </>
            )}
            {openThread && !hidden && (() => {
                const w = pinPoint(doc, openThread);
                return <Thread comment={openThread} at={worldToScreen(camera, w.x, w.y)} />;
            })()}
        </div>
    );
}

// ---- The Comments sidebar (right panel while the Comment tool is on) ----

// The comments list. `presence`: the design editor's right panel, with the people / Present / Share row
// above "Comments" and the zoom menu (the same 80pt block as Design). `embedded`: inside a panel that
// already has its header (view access's Comment tab), so only the search row and the list.
export function CommentsPanel({ presence, embedded }: { presence?: boolean; embedded?: boolean } = {}) {
    const comments = useCollab((s) => s.comments);
    const filters = useCollab((s) => s.commentFilters);
    const reads = useCollab((s) => s.reads);
    const open = useCollab((s) => s.openComment);
    const hidden = useCollab((s) => s.commentsHidden);
    const pageId = useEditor((s) => s.pageId);
    const doc = useEditor((s) => s.doc);
    const people = usePeople();
    const setFilters = (patch: Partial<typeof filters>) => collab.set({ commentFilters: { ...collab.get().commentFilters, ...patch } });
    const me = myUid();
    const list = useMemo(() => {
        const q = filters.search.trim().toLowerCase();
        const involved = (c: Comment) => [c, ...c.replies].some((m) => m.author.uid === me || mentionsMe(m, me));
        const out = comments.filter(
            (c) =>
                (filters.resolved || !c.resolved) &&
                (!filters.page || commentPageId(doc, c) === pageId) &&
                (!filters.mine || involved(c)) &&
                (!q || [c, ...c.replies].some((m) => m.text.toLowerCase().includes(q) || m.author.name.toLowerCase().includes(q))),
        );
        const last = (c: Comment) => Math.max(c.createdAt, ...c.replies.map((r) => r.createdAt));
        return out.sort((a, b) => {
            if (filters.sort === "unread") {
                const ua = isUnread(a, reads, me) ? 1 : 0;
                const ub = isUnread(b, reads, me) ? 1 : 0;
                if (ua !== ub) return ub - ua;
            }
            return last(b) - last(a);
        });
    }, [comments, filters, reads, pageId, me, doc]);
    const unreadCount = comments.filter((c) => !c.resolved && isUnread(c, reads, me)).length;
    const searchRow = (
        <div className="flex h-[41px] shrink-0 items-center gap-1 border-b border-panel-border pr-2 pl-2">
            <label className="flex h-6 min-w-0 flex-1 items-center gap-[6px] rounded-[5px] bg-field px-[6px] text-ink-muted focus-within:ring-1 focus-within:ring-brand-500">
                <SearchSm className="size-3.5 shrink-0" />
                <input
                    value={filters.search}
                    onChange={(e) => setFilters({ search: e.target.value })}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") {
                            setFilters({ search: "" });
                            e.currentTarget.blur();
                        }
                    }}
                    placeholder="Search"
                    aria-label="Search comments"
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle"
                />
            </label>
            <DarkMenu
                label="Sort and filter comments"
                className="ml-[4px] flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover"
                trigger={<FilterLines className="size-4" />}
                items={[
                    { section: "Sort" },
                    { id: "date", label: "Sort by date", checked: filters.sort === "date" },
                    { id: "unread", label: "Sort by unread", checked: filters.sort === "unread" },
                    "-",
                    { section: "Filter" },
                    { id: "mine", label: "Only your threads", checked: filters.mine },
                    { id: "page", label: "Only this page", checked: filters.page },
                    { id: "resolved", label: "Show resolved comments", checked: filters.resolved },
                ]}
                onAction={(id) => {
                    if (id === "date" || id === "unread") setFilters({ sort: id });
                    if (id === "mine" || id === "page" || id === "resolved") setFilters({ [id]: !filters[id] });
                }}
            />
            <DarkMenu
                label="More comment options"
                className="ml-[4px] flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover"
                trigger={<DotsHorizontal className="size-4" />}
                items={[
                    { id: "read", label: "Mark all as read", disabled: unreadCount === 0 },
                    { id: "hide", label: hidden ? "Show comments" : "Hide comments", shortcut: "⇧ C" },
                ]}
                onAction={(id) => {
                    if (id === "read") markAllRead();
                    if (id === "hide") collab.set({ commentsHidden: !hidden });
                }}
            />
        </div>
    );
    const body = (
        <>
            {searchRow}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {list.length === 0 && (
                    <div className="flex gap-[10px] px-4 pt-[20px] leading-[16px] text-ink">
                        <MessageCircle01 className="mt-[-1px] size-[18px] shrink-0" />
                        <span>{comments.length === 0 ? "No comments yet. Click anywhere in the file to leave one, ask a question or give feedback." : "No comments match this search or these filters."}</span>
                    </div>
                )}
                {list.map((c) => {
                    const unread = isUnread(c, reads, me);
                    const page = doc.nodes[commentPageId(doc, c)];
                    const lastReply = c.replies[c.replies.length - 1];
                    return (
                        <button key={c.id} type="button" onClick={() => goToComment(c)} className={`flex w-full gap-2 border-b border-panel-border px-3 py-2.5 text-left hover:bg-panel-hover ${open === c.id ? "bg-panel-hover" : ""}`}>
                            <span className="relative mt-0.5">
                                <Avatar name={c.author.name || "Guest"} color={c.author.color} size={22} />
                                {unread && <span className="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-brand-500" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1">
                                    <span className={`truncate ${unread ? "font-semibold" : "font-medium"}`}>{c.author.name || "Guest"}</span>
                                    <span className="shrink-0 text-ink-subtle">{timeAgo(Math.max(c.createdAt, lastReply?.createdAt ?? 0))}</span>
                                    {c.resolved && <Check className="ml-auto size-3 shrink-0 text-emerald-500" />}
                                </span>
                                <span className={`mt-0.5 line-clamp-3 break-words whitespace-pre-wrap ${unread ? "text-ink" : "text-ink-muted"}`}>
                                    <RichText inline text={c.text || (c.attachments?.length ? "Image" : "")} people={people} />
                                </span>
                                <span className="mt-1 flex items-center gap-2 text-ink-subtle">
                                    {c.replies.length > 0 && <span>{c.replies.length === 1 ? "1 reply" : `${c.replies.length} replies`}</span>}
                                    {!filters.page && page && <span className="truncate">{page.name}</span>}
                                    {(c.attachments?.length ?? 0) > 0 && <Attachment01 className="size-3" />}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </>
    );
    if (embedded) return <div className="flex h-full min-h-0 flex-col">{body}</div>;
    return (
        <aside data-right-panel="" className="flex h-full w-60 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
            {presence && (
                <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-2">
                    <PresenceBar chevron />
                    <div className="flex-1" />
                    <PresentButton />
                    <ShareButton size="lg" className="" />
                </header>
            )}
            <div className={`flex shrink-0 items-start gap-1 border-b border-panel-border px-2 ${presence ? "h-[33px]" : "h-[41px] items-center"}`}>
                <span className="flex h-6 flex-1 items-center px-2 font-semibold text-ink">Comments</span>
                {presence && <ZoomMenu />}
            </div>
            {body}
        </aside>
    );
}

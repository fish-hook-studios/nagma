import { ArrowLeft, ChevronLeft, ChevronRight, MessageCircle01, Play, X } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { drawNode } from "../canvas/render";
import { startPresenting } from "../engine/camera";
import { useCollab } from "../engine/collab";
import { type Comment, pinPoint, replyTo, setResolved, startDraft, addComment, timeAgo } from "../engine/comments";
import { openHome } from "../engine/files";
import { selectionBounds } from "../engine/nodes";
import { isDivider } from "../engine/pages";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { PrototypePlayer } from "./prototype-player";

// The phone viewer: a file or prototype link opened on a phone-width screen shows the design to look
// at and comment on, made for touch. Frames of the page stack in a feed; tapping one opens it full
// screen, where pinching zooms, dragging pans, swiping moves between frames and a double tap toggles
// 2x. Comments are pins on the frames and a sheet of threads with replies.

// Narrow screens (and ?view=mobile on any screen) use the phone viewer for links to files.
export function wantsMobileViewer(): boolean {
    const params = new URLSearchParams(location.search);
    if (params.get("view") === "mobile") return true;
    if (params.get("view") === "desktop") return false;
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
}

export function useMobileViewer(): boolean {
    const [on, setOn] = useState(wantsMobileViewer);
    useEffect(() => {
        const mq = window.matchMedia?.("(max-width: 640px)");
        const update = () => setOn(wantsMobileViewer());
        mq?.addEventListener("change", update);
        return () => mq?.removeEventListener("change", update);
    }, []);
    return on;
}

// A frame drawn at a width (device pixels), as a picture.
function frameImage(doc: NagmaDocument, id: string, width: number): { src: string; w: number; h: number } | null {
    const box = selectionBounds(doc, [id]);
    const node = doc.nodes[id];
    if (!box || !node) return null;
    const scale = Math.min(4, width / Math.max(box.w, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    drawNode(ctx, doc, node, { editingTextId: null, pixelScale: scale });
    return { src: canvas.toDataURL("image/png"), w: box.w, h: box.h };
}

function frameOf(doc: NagmaDocument, c: Comment, frames: SceneNode[]): SceneNode | undefined {
    const p = pinPoint(doc, c);
    return frames.find((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);
}

export function MobileViewer() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const presentingId = useEditor((s) => s.presentingId);
    const comments = useCollab((s) => s.comments);
    const [open, setOpen] = useState<string | null>(null);
    const [sheet, setSheet] = useState(false);
    const [thread, setThread] = useState<string | null>(null);
    const pages = doc.roots.map((id) => doc.nodes[id]).filter((p): p is SceneNode => Boolean(p) && !isDivider(p));
    const frames = (doc.nodes[pageId]?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && n.visible !== false && n.w > 0 && n.h > 0));
    const live = comments.filter((c) => !c.resolved && c.pageId === pageId);
    const width = Math.min(1600, Math.round((window.innerWidth || 390) * (window.devicePixelRatio || 2)));
    // Pictures are drawn once per document version.
    const images = useMemo(() => new Map(frames.map((f) => [f.id, frameImage(doc, f.id, width)])), [doc, pageId, width]); // eslint-disable-line react-hooks/exhaustive-deps
    const flow = frames.find((f) => f.flowStart) ?? null;

    if (presentingId) {
        return (
            <div className="relative h-full w-full bg-black">
                <PrototypePlayer startId={presentingId} active />
            </div>
        );
    }
    const openFrame = open ? frames.find((f) => f.id === open) : undefined;
    return (
        <div className="flex h-full w-full flex-col bg-canvas text-[14px] text-ink" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-panel-border bg-panel px-2">
                <button type="button" aria-label="Back to files" onClick={openHome} className="flex size-10 items-center justify-center rounded-lg active:bg-panel-hover">
                    <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{doc.name || "Untitled"}</div>
                    {pages.length > 1 && (
                        <select aria-label="Page" value={pageId} onChange={(e) => editor.setPage(e.target.value)} className="max-w-full bg-transparent text-[12px] text-ink-muted outline-none">
                            {pages.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                {flow && (
                    <button type="button" aria-label="Play prototype" onClick={() => startPresenting(flow.id)} className="flex size-10 items-center justify-center rounded-lg active:bg-panel-hover">
                        <Play className="size-5" />
                    </button>
                )}
                <button type="button" aria-label="Comments" onClick={() => setSheet(true)} className="relative flex size-10 items-center justify-center rounded-lg active:bg-panel-hover">
                    <MessageCircle01 className="size-5" />
                    {live.length > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-brand-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">{live.length}</span>}
                </button>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
                {frames.length === 0 && <p className="pt-16 text-center text-ink-muted">This page is empty.</p>}
                <div className="mx-auto flex max-w-xl flex-col gap-6">
                    {frames.map((f) => {
                        const img = images.get(f.id);
                        const count = live.filter((c) => frameOf(doc, c, frames)?.id === f.id).length;
                        return (
                            <button key={f.id} type="button" onClick={() => setOpen(f.id)} className="block text-left">
                                <span className="mb-1.5 flex items-center gap-2 text-[12px] text-ink-muted">
                                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                    {count > 0 && <span>{count === 1 ? "1 comment" : `${count} comments`}</span>}
                                </span>
                                {img && <img src={img.src} alt={f.name} className="w-full rounded-lg bg-panel shadow-lg" style={{ aspectRatio: `${img.w} / ${img.h}` }} />}
                            </button>
                        );
                    })}
                </div>
            </main>
            {openFrame && (
                <FrameView
                    key={openFrame.id}
                    doc={doc}
                    frame={openFrame}
                    image={images.get(openFrame.id) ?? null}
                    comments={live.filter((c) => frameOf(doc, c, frames)?.id === openFrame.id)}
                    onClose={() => setOpen(null)}
                    onStep={(d) => {
                        const i = frames.findIndex((f) => f.id === openFrame.id);
                        const next = frames[i + d];
                        if (next) setOpen(next.id);
                    }}
                    onThread={(id) => (setThread(id), setSheet(true))}
                    position={`${frames.findIndex((f) => f.id === openFrame.id) + 1} of ${frames.length}`}
                />
            )}
            {sheet && <CommentSheet comments={live} doc={doc} frames={frames} thread={thread} onThread={setThread} onFrame={(id) => (setSheet(false), setOpen(id))} onClose={() => (setSheet(false), setThread(null))} />}
        </div>
    );
}

// One frame full screen: pinch to zoom, drag to pan, swipe for the next frame, double tap for 2x,
// and the Comment button to drop a pin where you tap next.
function FrameView({ doc, frame, image, comments, onClose, onStep, onThread, position }: { doc: NagmaDocument; frame: SceneNode; image: { src: string; w: number; h: number } | null; comments: Comment[]; onClose: () => void; onStep: (d: number) => void; onThread: (id: string) => void; position: string }) {
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [placing, setPlacing] = useState(false);
    const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
    const [text, setText] = useState("");
    const stage = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<{ start: typeof view; dist: number; mid: { x: number; y: number }; origin: { x: number; y: number }; moved: boolean; at: number } | null>(null);
    const lastTap = useRef(0);
    const box = stage.current?.getBoundingClientRect();
    const fit = image && box ? Math.min(box.width / image.w, box.height / image.h) : 1;

    const centre = () => {
        const list = [...pointers.current.values()];
        return { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };
    };
    const spread = () => {
        const [a, b] = [...pointers.current.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    // A tap on the picture as a point in the document.
    const toWorld = (clientX: number, clientY: number) => {
        const img = stage.current?.querySelector("img")?.getBoundingClientRect();
        if (!img || !image) return null;
        return { x: frame.x + ((clientX - img.left) / img.width) * image.w, y: frame.y + ((clientY - img.top) / img.height) * image.h };
    };

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-black text-white" role="dialog" aria-label={frame.name}>
            <div className="flex h-12 shrink-0 items-center gap-2 px-2" style={{ marginTop: "env(safe-area-inset-top)" }}>
                <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 items-center justify-center rounded-lg active:bg-white/10">
                    <X className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{frame.name}</div>
                    <div className="text-[11px] text-white/60">{position}</div>
                </div>
                <button type="button" aria-label="Previous frame" onClick={() => onStep(-1)} className="flex size-10 items-center justify-center rounded-lg active:bg-white/10">
                    <ChevronLeft className="size-5" />
                </button>
                <button type="button" aria-label="Next frame" onClick={() => onStep(1)} className="flex size-10 items-center justify-center rounded-lg active:bg-white/10">
                    <ChevronRight className="size-5" />
                </button>
                <button type="button" onClick={() => setPlacing(!placing)} className={`h-9 rounded-full px-3 text-[13px] font-semibold ${placing ? "bg-brand-500" : "bg-white/15"}`}>
                    {placing ? "Tap to place" : "Comment"}
                </button>
            </div>
            <div
                ref={stage}
                className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
                onPointerDown={(e) => {
                    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                        // Synthetic or already-ended pointers can't be captured; the gesture still works.
                    }
                    gesture.current = { start: view, dist: spread(), mid: centre(), origin: { x: e.clientX, y: e.clientY }, moved: false, at: Date.now() };
                }}
                onPointerMove={(e) => {
                    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
                    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    const g = gesture.current;
                    const c = centre();
                    if (Math.hypot(c.x - g.mid.x, c.y - g.mid.y) > 6) g.moved = true;
                    if (pointers.current.size >= 2 && g.dist > 0) {
                        g.moved = true;
                        const scale = Math.min(8, Math.max(1, (g.start.scale * spread()) / g.dist));
                        setView({ scale, x: g.start.x + (c.x - g.mid.x), y: g.start.y + (c.y - g.mid.y) });
                    } else if (g.start.scale > 1) setView({ ...g.start, x: g.start.x + (c.x - g.mid.x), y: g.start.y + (c.y - g.mid.y) });
                }}
                onPointerUp={(e) => {
                    const g = gesture.current;
                    pointers.current.delete(e.pointerId);
                    if (pointers.current.size) {
                        // One finger lifted from a pinch: carry on from here with the other.
                        gesture.current = { start: view, dist: 0, mid: centre(), origin: centre(), moved: true, at: Date.now() };
                        return;
                    }
                    gesture.current = null;
                    if (!g) return;
                    const dx = e.clientX - g.origin.x;
                    // A quick sideways swipe at 1x moves to the next or previous frame.
                    if (g.start.scale <= 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.origin.y) * 1.5 && Date.now() - g.at < 600) return onStep(dx < 0 ? 1 : -1);
                    if (g.moved) return;
                    if (placing) {
                        const w = toWorld(e.clientX, e.clientY);
                        if (w) setDraft(w);
                        setPlacing(false);
                        return;
                    }
                    const now = Date.now();
                    if (now - lastTap.current < 300) setView(view.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2, x: 0, y: 0 });
                    lastTap.current = now;
                }}
                onPointerCancel={(e) => {
                    pointers.current.delete(e.pointerId);
                    gesture.current = null;
                }}
            >
                {image && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative" style={{ width: image.w * fit, height: image.h * fit, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
                            <img src={image.src} alt={frame.name} draggable={false} className="h-full w-full" />
                            {comments.map((c, i) => {
                                const p = pinPoint(doc, c);
                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        aria-label={`Comment by ${c.author.name}`}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={() => onThread(c.id)}
                                        className="absolute flex size-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none bg-brand-500 text-[11px] font-semibold text-white shadow-lg"
                                        style={{ left: ((p.x - frame.x) / image.w) * 100 + "%", top: ((p.y - frame.y) / image.h) * 100 + "%", transform: `translate(-50%, -100%) scale(${1 / view.scale})`, transformOrigin: "bottom left" }}
                                    >
                                        {i + 1}
                                    </button>
                                );
                            })}
                            {draft && <span className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500" style={{ left: ((draft.x - frame.x) / image.w) * 100 + "%", top: ((draft.y - frame.y) / image.h) * 100 + "%" }} />}
                        </div>
                    </div>
                )}
            </div>
            {draft && (
                <form
                    className="flex gap-2 border-t border-white/10 bg-panel p-2 text-ink"
                    style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!text.trim()) return;
                        startDraft(doc.nodes[frame.parentId ?? ""]?.type === "page" ? (frame.parentId as string) : editor.get().pageId, draft.x, draft.y);
                        if (addComment(text)) {
                            setDraft(null);
                            setText("");
                        }
                    }}
                >
                    <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" aria-label="Comment" className="h-10 min-w-0 flex-1 rounded-lg bg-field px-3 text-[15px] outline-none" />
                    <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-lg px-3 text-ink-muted">
                        Cancel
                    </button>
                    <button type="submit" disabled={!text.trim()} className="h-10 rounded-lg bg-brand-500 px-4 font-semibold text-white disabled:opacity-50">
                        Post
                    </button>
                </form>
            )}
        </div>
    );
}

// The comments of the page as a bottom sheet: threads, then one thread with its replies.
function CommentSheet({ comments, doc, frames, thread, onThread, onFrame, onClose }: { comments: Comment[]; doc: NagmaDocument; frames: SceneNode[]; thread: string | null; onThread: (id: string | null) => void; onFrame: (id: string) => void; onClose: () => void }) {
    const [reply, setReply] = useState("");
    const open = thread ? comments.find((c) => c.id === thread) : undefined;
    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
            <div className="flex max-h-[80%] flex-col rounded-t-2xl bg-panel text-ink" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Comments">
                <div className="flex h-12 shrink-0 items-center gap-2 border-b border-panel-border px-3">
                    {open && (
                        <button type="button" aria-label="All comments" onClick={() => onThread(null)} className="flex size-9 items-center justify-center rounded-lg active:bg-panel-hover">
                            <ArrowLeft className="size-5" />
                        </button>
                    )}
                    <span className="flex-1 font-semibold">{open ? "Comment" : `Comments (${comments.length})`}</span>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg active:bg-panel-hover">
                        <X className="size-5" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {!open && comments.length === 0 && <p className="p-6 text-center text-ink-muted">No comments on this page yet. Open a frame and tap Comment.</p>}
                    {!open &&
                        comments.map((c) => {
                            const f = frameOf(doc, c, frames);
                            return (
                                <button key={c.id} type="button" onClick={() => onThread(c.id)} className="block w-full border-b border-panel-border px-4 py-3 text-left active:bg-panel-hover">
                                    <span className="flex items-center gap-2 text-[12px] text-ink-muted">
                                        <span className="font-semibold text-ink">{c.author.name || "Someone"}</span>
                                        <span>{timeAgo(c.createdAt)}</span>
                                        {f && <span className="min-w-0 flex-1 truncate text-right">{f.name}</span>}
                                    </span>
                                    <span className="mt-1 line-clamp-2 block">{c.text}</span>
                                    {c.replies.length > 0 && <span className="mt-1 block text-[12px] text-brand-500">{c.replies.length === 1 ? "1 reply" : `${c.replies.length} replies`}</span>}
                                </button>
                            );
                        })}
                    {open && (
                        <div className="space-y-3 p-4">
                            {[open, ...open.replies].map((m) => (
                                <div key={m.id}>
                                    <div className="flex items-center gap-2 text-[12px] text-ink-muted">
                                        <span className="font-semibold text-ink">{m.author.name || "Someone"}</span>
                                        <span>{timeAgo(m.createdAt)}</span>
                                    </div>
                                    <p className="mt-0.5 whitespace-pre-wrap">{m.text}</p>
                                </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                                {frameOf(doc, open, frames) && (
                                    <button type="button" onClick={() => onFrame(frameOf(doc, open, frames)?.id as string)} className="h-9 rounded-lg border border-panel-border px-3 text-[13px]">
                                        Show on frame
                                    </button>
                                )}
                                <button type="button" onClick={() => (setResolved(open.id, true), onThread(null))} className="h-9 rounded-lg border border-panel-border px-3 text-[13px]">
                                    Resolve
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                {open && (
                    <form
                        className="flex gap-2 border-t border-panel-border p-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!reply.trim()) return;
                            replyTo(open.id, reply);
                            setReply("");
                        }}
                    >
                        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply" aria-label="Reply" className="h-10 min-w-0 flex-1 rounded-lg bg-field px-3 text-[15px] outline-none" />
                        <button type="submit" disabled={!reply.trim()} className="h-10 rounded-lg bg-brand-500 px-4 font-semibold text-white disabled:opacity-50">
                            Send
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

import { useEffect, useRef, useState } from "react";
import { MentionInput } from "../components/comments-ui";
import { collab, useCollab } from "../engine/collab";
import { addComment, startDraft } from "../engine/comments";
import { editor, useEditor } from "../engine/store";
import { attachImage } from "./generate";
import { makePage } from "./model";
import { askPreview, usePreviewScroll } from "./preview-bridge";
import { make, useMake } from "./state";

// What sits over the preview: comment pins (placed with a click while commenting, or with the
// keyboard: F6, the arrow keys and Enter) and the drawing layer (draw or write on the app to show a
// change; the drawing goes into the prompt as a picture of the app with the marks on it).

// The overlay's own size in CSS pixels, so clicks map to the app's coordinates even when the
// preview is scaled down to fit.
function localPoint(el: HTMLElement, clientX: number, clientY: number) {
    const r = el.getBoundingClientRect();
    const scale = r.width / Math.max(1, el.offsetWidth);
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
}

export function CommentPins() {
    const commenting = useMake((s) => s.commenting);
    const comments = useCollab((s) => s.comments);
    const openId = useCollab((s) => s.openComment);
    const pageId = useEditor((s) => makePage(s.doc)?.id ?? s.pageId);
    const scroll = usePreviewScroll();
    const box = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

    // F6: a keyboard cursor to place a pin without the mouse.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "F6") {
                e.preventDefault();
                const el = box.current;
                make.set({ commenting: true, picking: false, drawing: false });
                setCursor({ x: (el?.offsetWidth ?? 400) / 2, y: (el?.offsetHeight ?? 300) / 2 });
                return;
            }
            if (!cursor) return;
            const step = e.shiftKey ? 50 : 10;
            const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (moves[e.key]) {
                e.preventDefault();
                const [dx, dy] = moves[e.key] as [number, number];
                setCursor((c) => (c ? { x: Math.max(0, c.x + dx), y: Math.max(0, c.y + dy) } : c));
            } else if (e.key === "Enter") {
                e.preventDefault();
                setDraft({ x: cursor.x + scroll.x, y: cursor.y + scroll.y });
                setCursor(null);
            } else if (e.key === "Escape") {
                setCursor(null);
                make.set({ commenting: false });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cursor, scroll]);

    const pins = comments.filter((c) => c.pageId === pageId && !c.resolved && (c.x !== 0 || c.y !== 0));
    return (
        <div
            ref={box}
            aria-hidden={!commenting}
            className={`absolute inset-0 overflow-hidden ${commenting ? "cursor-crosshair" : "pointer-events-none"}`}
            onClick={(e) => {
                if (!commenting || e.target !== e.currentTarget || !box.current) return;
                const p = localPoint(box.current, e.clientX, e.clientY);
                setDraft({ x: p.x + scroll.x, y: p.y + scroll.y });
            }}
        >
            {pins.map((c, i) => (
                <button
                    key={c.id}
                    type="button"
                    aria-label={`Comment by ${c.author.name || "Guest"}: ${c.text.slice(0, 60)}`}
                    title={c.text}
                    onClick={() => {
                        make.set({ side: "comments" });
                        collab.set({ openComment: c.id, historyOpen: false });
                    }}
                    className={`pointer-events-auto absolute flex size-6 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white text-[10px] font-semibold text-white shadow-md ${openId === c.id ? "bg-brand-500" : "bg-ink"}`}
                    style={{ left: c.x - scroll.x, top: c.y - scroll.y }}
                >
                    {i + 1}
                </button>
            ))}
            {cursor && <div aria-label="Comment cursor: arrow keys move it, Enter places a comment" role="status" className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-500 bg-brand-500/20" style={{ left: cursor.x, top: cursor.y }} />}
            {draft && (
                <div className="pointer-events-auto absolute z-10 w-64 rounded-lg border border-panel-border bg-panel p-2 shadow-xl" style={{ left: Math.max(4, draft.x - scroll.x), top: Math.max(4, draft.y - scroll.y) }} onClick={(e) => e.stopPropagation()}>
                    <MentionInput
                        autoFocus
                        placeholder="Add a comment"
                        submitLabel="Post"
                        onCancel={() => setDraft(null)}
                        onSubmit={(text, mentions, attachments) => {
                            startDraft(pageId, Math.round(draft.x), Math.round(draft.y));
                            if (!addComment(text, mentions, attachments)) {
                                collab.set({ draft: null });
                                editor.notify("Couldn't post that comment.");
                            }
                            setDraft(null);
                            make.set({ commenting: false, side: "comments" });
                        }}
                    />
                </div>
            )}
        </div>
    );
}

type Mark = { kind: "pen"; points: { x: number; y: number }[] } | { kind: "note"; x: number; y: number; text: string };

export function DrawLayer() {
    const drawing = useMake((s) => s.drawing);
    if (!drawing) return null;
    return <Drawing />;
}

function Drawing() {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [marks, setMarks] = useState<Mark[]>([]);
    const [tool, setTool] = useState<"pen" | "note">("pen");
    const [busy, setBusy] = useState(false);
    const live = useRef<Mark | null>(null);
    const colour = "#E5383B";

    const paint = (ctx: CanvasRenderingContext2D, list: Mark[]) => {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const m of list) {
            if (m.kind === "pen") {
                ctx.strokeStyle = colour;
                ctx.lineWidth = 4;
                ctx.beginPath();
                m.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                ctx.stroke();
            } else {
                ctx.font = "600 15px Inter, system-ui, sans-serif";
                const w = ctx.measureText(m.text).width + 14;
                ctx.fillStyle = colour;
                ctx.beginPath();
                ctx.roundRect(m.x, m.y - 13, w, 26, 6);
                ctx.fill();
                ctx.fillStyle = "#FFFFFF";
                ctx.fillText(m.text, m.x + 7, m.y + 5);
            }
        }
    };
    useEffect(() => {
        const el = canvas.current;
        if (!el) return;
        el.width = el.offsetWidth;
        el.height = el.offsetHeight;
        const ctx = el.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, el.width, el.height);
        paint(ctx, live.current ? [...marks, live.current] : marks);
    });

    const finish = async () => {
        const el = canvas.current;
        if (!el || !marks.length) return make.set({ drawing: false });
        setBusy(true);
        const shot = await askPreview<string>("capture", { id: "draw", full: true });
        const out = document.createElement("canvas");
        out.width = el.width;
        out.height = el.height;
        const ctx = out.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, out.width, out.height);
        if (shot) {
            const img = new Image();
            img.src = shot;
            await img.decode().catch(() => undefined);
            ctx.drawImage(img, 0, 0, out.width, out.height);
        }
        paint(ctx, marks);
        const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
        if (blob) await attachImage(blob, "Drawing on the preview");
        const notes = marks.filter((m): m is Extract<Mark, { kind: "note" }> => m.kind === "note").map((m) => m.text);
        const s = make.get();
        make.set({ drawing: false, prompt: s.prompt || `Change the app as marked in the attached drawing${notes.length ? `: ${notes.join("; ")}` : "."}` });
        setBusy(false);
        if (!shot) editor.notify("The app's picture couldn't be taken, so only the drawing was attached.");
    };

    const bar = "h-7 rounded-md px-2 text-[11px] font-medium";
    return (
        <div className="absolute inset-0 z-10">
            <canvas
                ref={canvas}
                aria-label="Drawing layer"
                className="absolute inset-0 h-full w-full cursor-crosshair"
                onPointerDown={(e) => {
                    const p = localPoint(e.currentTarget, e.clientX, e.clientY);
                    if (tool === "note") {
                        const text = window.prompt("Note");
                        if (text?.trim()) setMarks((m) => [...m, { kind: "note", x: p.x, y: p.y, text: text.trim().slice(0, 120) }]);
                        return;
                    }
                    e.currentTarget.setPointerCapture(e.pointerId);
                    live.current = { kind: "pen", points: [p] };
                    setMarks((m) => [...m]);
                }}
                onPointerMove={(e) => {
                    if (live.current?.kind !== "pen") return;
                    live.current.points.push(localPoint(e.currentTarget, e.clientX, e.clientY));
                    setMarks((m) => [...m]);
                }}
                onPointerUp={() => {
                    const done = live.current;
                    live.current = null;
                    if (done) setMarks((m) => [...m, done]);
                }}
            />
            <div role="toolbar" aria-label="Drawing" className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-panel-border bg-panel p-1 shadow-lg">
                <button type="button" aria-pressed={tool === "pen"} onClick={() => setTool("pen")} className={`${bar} ${tool === "pen" ? "bg-brand-500 text-white" : "text-ink hover:bg-panel-hover"}`}>
                    Draw
                </button>
                <button type="button" aria-pressed={tool === "note"} onClick={() => setTool("note")} className={`${bar} ${tool === "note" ? "bg-brand-500 text-white" : "text-ink hover:bg-panel-hover"}`}>
                    Note
                </button>
                <button type="button" disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))} className={`${bar} text-ink hover:bg-panel-hover disabled:opacity-40`}>
                    Undo
                </button>
                <button type="button" onClick={() => make.set({ drawing: false })} className={`${bar} text-ink hover:bg-panel-hover`}>
                    Cancel
                </button>
                <button type="button" disabled={busy || !marks.length} onClick={() => void finish()} className={`${bar} bg-brand-500 text-white disabled:opacity-40`}>
                    {busy ? "Adding…" : "Add to prompt"}
                </button>
            </div>
        </div>
    );
}
